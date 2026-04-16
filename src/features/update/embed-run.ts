import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getLogger } from "@andreas-timm/logger";
import { type Chunk, chunkSkill } from "@features/update/embed-chunk";
import { resolveOccurrenceDir } from "@features/update/source";
import { createEmbedder, type Embedder, floatToBlob } from "@libs/embedder";
import matter from "gray-matter";
import { verbose } from "../../verbose";

const logger = getLogger();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS skill_chunks (
    id           TEXT PRIMARY KEY,
    skill_id     TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    chunk_index  INTEGER NOT NULL,
    text         TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding    BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_chunks_skill_id ON skill_chunks(skill_id);

CREATE TABLE IF NOT EXISTS embed_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`;

type SkillRow = {
    id: string;
    subpath: string;
    location: string;
    sourceGit: boolean;
    sourceRootSubpath: string;
    name: string | null;
    description: string | null;
};

type SkillRowRaw = Omit<SkillRow, "sourceGit" | "sourceRootSubpath"> & {
    source_git: number;
    source_root_subpath: string;
};

type ExistingChunk = { id: string; content_hash: string };

async function readBody(
    locationRoots: Record<string, string>,
    skill: Pick<SkillRow, "sourceGit" | "sourceRootSubpath" | "location" | "subpath">,
): Promise<string> {
    const root = locationRoots[skill.location];
    if (!root) {
        throw new Error(`Unknown skill location "${skill.location}"`);
    }
    const file = join(
        resolveOccurrenceDir({
            locationRoot: root,
            sourceGit: skill.sourceGit,
            sourceRootSubpath: skill.sourceRootSubpath,
            subpath: skill.subpath,
        }),
        "SKILL.md",
    );
    const raw = await readFile(file, "utf-8");
    try {
        return matter(raw).content;
    } catch {
        return raw.replace(/^---[\s\S]*?---\r?\n?/, "");
    }
}

function resetIfModelChanged(db: Database, model: string, dim: number): boolean {
    const rows = db
        .query<{ key: string; value: string }, []>(`SELECT key, value FROM embed_meta`)
        .all();
    const meta = new Map(rows.map((r) => [r.key, r.value]));
    const prevModel = meta.get("model");
    const prevDim = meta.get("dim");
    const changed =
        (prevModel !== undefined && prevModel !== model) ||
        (prevDim !== undefined && prevDim !== String(dim));
    if (changed) {
        logger.info(
            `Embedding model changed (${prevModel}/${prevDim} → ${model}/${dim}); wiping chunks`,
        );
        db.run("DELETE FROM skill_chunks");
    }
    db.prepare(
        `INSERT INTO embed_meta (key, value) VALUES ($k, $v)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run({ $k: "model", $v: model });
    db.prepare(
        `INSERT INTO embed_meta (key, value) VALUES ($k, $v)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run({ $k: "dim", $v: String(dim) });
    return changed;
}

async function embedBatched(
    embedder: Embedder,
    chunks: Chunk[],
    batchSize: number,
): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const vectors = await embedder.embed(batch.map((c) => c.text));
        out.push(...vectors);
    }
    return out;
}

export async function embed(params: {
    dbPath: string;
    locationRoots: Record<string, string>;
    model: string;
    dim: number;
    cacheDir: string;
    batchSize: number;
    chunkTokens: number;
    chunkOverlap: number;
}): Promise<void> {
    const db = new Database(params.dbPath, { readwrite: true });
    try {
        db.run("PRAGMA journal_mode = WAL");
        db.run("PRAGMA busy_timeout = 10000");
        db.run(SCHEMA);
        resetIfModelChanged(db, params.model, params.dim);

        const skills = db
            .query<SkillRowRaw, []>(
                `SELECT s.id,
                        s.name,
                        s.description,
                        o.location,
                        o.subpath,
                        b.git AS source_git,
                        COALESCE(b.root_subpath, '') AS source_root_subpath
                 FROM skills s
                 JOIN skill_occurrences o ON o.rowid = (
                    SELECT o2.rowid
                    FROM skill_occurrences o2
                    WHERE o2.skill_id = s.id
                    ORDER BY o2.location, o2.subpath
                    LIMIT 1
                 )
                 JOIN sources b ON b.id = o.source_id
                 ORDER BY s.id`,
            )
            .all()
            .map((row) => ({
                id: row.id,
                name: row.name,
                description: row.description,
                location: row.location,
                subpath: row.subpath,
                sourceGit: row.source_git !== 0,
                sourceRootSubpath: row.source_root_subpath,
            }));
        if (skills.length === 0) {
            logger.warn("No skills in DB — nothing to embed");
            return;
        }

        const embedder = await createEmbedder({
            model: params.model,
            cacheDir: params.cacheDir,
            dim: params.dim,
        });

        const insert = db.prepare(
            `INSERT INTO skill_chunks
                 (id, skill_id, kind, chunk_index, text, content_hash, embedding)
             VALUES ($id, $skill_id, $kind, $chunk_index, $text, $hash, $embedding)
             ON CONFLICT(id) DO UPDATE SET
                 kind = excluded.kind,
                 chunk_index = excluded.chunk_index,
                 text = excluded.text,
                 content_hash = excluded.content_hash,
                 embedding = excluded.embedding`,
        );
        const deleteStale = db.prepare(
            `DELETE FROM skill_chunks WHERE skill_id = $skill_id AND id NOT IN (SELECT value FROM json_each($keep))`,
        );
        const existingStmt = db.prepare<ExistingChunk, { $skill_id: string }>(
            `SELECT id, content_hash FROM skill_chunks WHERE skill_id = $skill_id`,
        );

        const formatDuration = (ms: number): string => {
            const s = Math.max(0, Math.round(ms / 1000));
            const m = Math.floor(s / 60);
            const rem = s % 60;
            return m > 0 ? `${m}m${rem}s` : `${rem}s`;
        };

        type Plan = {
            skill: SkillRow;
            chunks: Chunk[];
            toEmbed: Chunk[];
        };

        if (verbose) {
            logger.info(`Planning ${skills.length} skills...`);
        }
        const plans: Plan[] = [];
        let totalChunks = 0;
        let totalToEmbed = 0;
        for (const skill of skills) {
            let body = "";
            try {
                body = await readBody(params.locationRoots, skill);
            } catch (err) {
                logger.warn(`Cannot read body for ${skill.subpath}: ${(err as Error).message}`);
            }
            const chunks = chunkSkill({
                name: skill.name,
                description: skill.description,
                body,
                chunkTokens: params.chunkTokens,
                chunkOverlap: params.chunkOverlap,
            });
            totalChunks += chunks.length;
            if (chunks.length === 0) {
                plans.push({ skill, chunks, toEmbed: [] });
                continue;
            }
            const existingByChunkId = new Map<string, string>();
            for (const row of existingStmt.all({ $skill_id: skill.id })) {
                existingByChunkId.set(row.id, row.content_hash);
            }
            const toEmbed: Chunk[] = [];
            for (const c of chunks) {
                const chunkId = `${skill.id}#${c.chunkIndex}`;
                if (existingByChunkId.get(chunkId) !== c.contentHash) {
                    toEmbed.push(c);
                }
            }
            totalToEmbed += toEmbed.length;
            plans.push({ skill, chunks, toEmbed });
        }

        if (verbose) {
            logger.info(
                `${totalToEmbed}/${totalChunks} chunks need embedding across ${skills.length} skills`,
            );
        }

        let totalEmbedded = 0;
        let skillsProcessed = 0;
        const startMs = Date.now();
        let lastLogMs = startMs;

        for (const { skill, chunks, toEmbed } of plans) {
            skillsProcessed++;
            if (chunks.length === 0) continue;

            let vectors: Float32Array[] = [];
            if (toEmbed.length > 0) {
                vectors = await embedBatched(embedder, toEmbed, params.batchSize);
            }

            const keep = chunks.map((c) => `${skill.id}#${c.chunkIndex}`);
            db.transaction(() => {
                for (let i = 0; i < toEmbed.length; i++) {
                    const c = toEmbed[i];
                    const v = vectors[i];
                    if (!c || !v) continue;
                    insert.run({
                        $id: `${skill.id}#${c.chunkIndex}`,
                        $skill_id: skill.id,
                        $kind: c.kind,
                        $chunk_index: c.chunkIndex,
                        $text: c.text,
                        $hash: c.contentHash,
                        $embedding: floatToBlob(v),
                    });
                }
                deleteStale.run({
                    $skill_id: skill.id,
                    $keep: JSON.stringify(keep),
                });
            })();

            totalEmbedded += toEmbed.length;
            if (toEmbed.length > 0) {
                logger.info(
                    `  ${skill.subpath}: ${toEmbed.length}/${chunks.length} chunks embedded`,
                );
            }

            if (totalToEmbed > 0) {
                const now = Date.now();
                const finishedThisPass = totalEmbedded >= totalToEmbed && toEmbed.length > 0;
                if (now - lastLogMs >= 10_000 || finishedThisPass) {
                    const elapsed = now - startMs;
                    const rate = totalEmbedded / elapsed;
                    const remaining = rate > 0 ? (totalToEmbed - totalEmbedded) / rate : 0;
                    const etaDate = new Date(now + remaining);
                    const pct = Math.round((totalEmbedded / totalToEmbed) * 100);
                    logger.info(
                        `Progress: ${skillsProcessed}/${skills.length} skills, ${totalEmbedded}/${totalToEmbed} chunks (${pct}%) — elapsed ${formatDuration(elapsed)}, ETA ${formatDuration(remaining)} (~${etaDate.toLocaleTimeString()})`,
                    );
                    lastLogMs = now;
                }
            }
        }

        logger.info(
            `Embedded ${totalEmbedded} new/changed chunks (${totalChunks} total) across ${skills.length} skills`,
        );
    } finally {
        db.close();
    }
}
