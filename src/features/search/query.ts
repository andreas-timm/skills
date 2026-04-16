import { Database } from "bun:sqlite";
import { effectiveApprovalStatus } from "@features/approve/effective";
import { type ApprovalStatus, isApprovalStatus } from "@features/approve/status";
import { SHORT_SKILL_ID_LENGTH } from "@features/skill/id";
import { createEmbedder } from "@libs/embedder";

export type SkillOccurrence = {
    sourceId: string;
    sourceName: string;
    location: string;
    subpath: string;
    date: string | null;
};

export type SkillHit = {
    skillId: string;
    occurrences: SkillOccurrence[];
    primaryOccurrence: SkillOccurrence | null;
    name: string | null;
    description: string | null;
    status: ApprovalStatus | null;
    score: number;
    maxScore: number;
    meanScore: number;
    matches: { kind: string; text: string; score: number }[];
};

type ChunkRow = {
    chunk_id: string;
    skill_id: string;
    skill_public_id: string;
    kind: string;
    text: string;
    embedding: Buffer;
    name: string | null;
    description: string | null;
};

type OccurrenceRow = {
    skill_public_id: string;
    source_id: string;
    source_name: string;
    location: string;
    subpath: string;
    date: string | null;
};

type TextSearchRow = {
    skill_public_id: string;
    name: string | null;
    description: string | null;
    score: number;
};

type ApprovedRankSql = {
    sql: string;
    bind: Record<string, string>;
};

type TextSearchParams = {
    dbPath: string;
    query: string;
    limit?: number;
    mode?: "text";
    approvedLocations?: readonly string[];
};

type EmbedSearchParams = {
    dbPath: string;
    query: string;
    model: string;
    dim: number;
    cacheDir: string;
    limit?: number;
    kinds?: string[];
    snippetsPerSkill?: number;
    mode: "embed";
    approvedLocations?: readonly string[];
};

type SkillStatusRow = {
    skill_public_id: string;
    status: string | null;
};

function blobToFloat(buf: Buffer, dim: number): Float32Array {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const view = new Float32Array(ab);
    if (view.length !== dim) {
        throw new Error(`Stored vector dim ${view.length} does not match expected ${dim}`);
    }
    return view;
}

function dot(a: Float32Array, b: Float32Array): number {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
    return s;
}

function loadOccurrences(db: Database): Map<string, SkillOccurrence[]> {
    const occurrenceRows = db
        .query<OccurrenceRow, []>(
            `SELECT COALESCE(NULLIF(s.short_id, ''), substr(s.id, 1, ${SHORT_SKILL_ID_LENGTH})) AS skill_public_id,
                    o.source_id,
                    b.name AS source_name,
                    o.location,
                    o.subpath,
                    b.date
             FROM skill_occurrences o
             JOIN skills s ON s.id = o.skill_id
             JOIN sources b ON b.id = o.source_id`,
        )
        .all();
    const occurrencesBySkill = new Map<string, SkillOccurrence[]>();
    for (const row of occurrenceRows) {
        const arr = occurrencesBySkill.get(row.skill_public_id);
        const occurrence = {
            sourceId: row.source_id,
            sourceName: row.source_name,
            location: row.location,
            subpath: row.subpath,
            date: row.date,
        } satisfies SkillOccurrence;
        if (arr) arr.push(occurrence);
        else occurrencesBySkill.set(row.skill_public_id, [occurrence]);
    }
    for (const [, arr] of occurrencesBySkill) {
        arr.sort((a, b) => {
            const dateCmp = (b.date ?? "").localeCompare(a.date ?? "");
            if (dateCmp !== 0) return dateCmp;
            return a.subpath.localeCompare(b.subpath);
        });
    }
    return occurrencesBySkill;
}

function hasTable(db: Database, tableName: string): boolean {
    const row = db
        .query<{ name: string }, { $name: string }>(
            `SELECT name
             FROM sqlite_master
             WHERE type IN ('table', 'view') AND name = $name`,
        )
        .get({ $name: tableName });
    return row !== null;
}

function hasColumn(db: Database, tableName: string, columnName: string): boolean {
    return db
        .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
        .all()
        .some((row) => row.name === columnName);
}

function parseSearchApprovalStatus(rawStatus: string | null | undefined): ApprovalStatus | null {
    return rawStatus && isApprovalStatus(rawStatus) ? rawStatus : null;
}

function loadSkillStatuses(db: Database): Map<string, ApprovalStatus | null> {
    if (!hasColumn(db, "skills", "approved")) {
        return new Map();
    }

    const rows = db
        .query<SkillStatusRow, []>(
            `SELECT COALESCE(NULLIF(short_id, ''), substr(id, 1, ${SHORT_SKILL_ID_LENGTH})) AS skill_public_id,
                    approved AS status
             FROM skills`,
        )
        .all();

    return new Map(rows.map((row) => [row.skill_public_id, parseSearchApprovalStatus(row.status)]));
}

function resolveHitStatus(
    skillId: string,
    occurrences: SkillOccurrence[],
    statusBySkill: Map<string, ApprovalStatus | null>,
    approvedLocations: ReadonlySet<string>,
): ApprovalStatus | null {
    return effectiveApprovalStatus(
        statusBySkill.get(skillId) ?? null,
        occurrences.map((occurrence) => occurrence.location),
        approvedLocations,
    );
}

function escapeLike(value: string): string {
    return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function isTextSearchFallbackEligible(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return (
        message.includes("parse error") ||
        message.includes("syntax error") ||
        message.includes("unterminated string")
    );
}

function buildApprovedRankSql(
    skillAlias: string,
    approvedLocations: readonly string[],
    hasApprovedColumn: boolean,
): ApprovedRankSql {
    const locations = [...new Set(approvedLocations)].filter(Boolean);
    const bind: Record<string, string> = {};
    const locationSql =
        locations.length === 0
            ? "0"
            : `EXISTS (
                   SELECT 1
                   FROM skill_occurrences approval_occurrence
                   WHERE approval_occurrence.skill_id = ${skillAlias}.id
                     AND approval_occurrence.location IN (${locations
                         .map((location, index) => {
                             const key = `$approved_location_${index}`;
                             bind[key] = location;
                             return key;
                         })
                         .join(", ")})
               )`;

    if (!hasApprovedColumn) {
        return {
            sql: `CASE WHEN ${locationSql} THEN 1 ELSE 0 END`,
            bind,
        };
    }

    return {
        sql: `CASE
                 WHEN ${skillAlias}.approved = 'approved' THEN 1
                 WHEN ${skillAlias}.approved IS NULL AND ${locationSql} THEN 1
                 ELSE 0
              END`,
        bind,
    };
}

function searchSkillsByTextFts(
    db: Database,
    query: string,
    limit: number,
    approvedRank: ApprovedRankSql,
): TextSearchRow[] {
    const scoreSql = `-bm25(skills_fts, 10.0, 1.0)`;
    const bind: Record<string, string | number> = {
        ...approvedRank.bind,
        $query: query,
        $limit: limit,
    };
    return db
        .query<TextSearchRow, typeof bind>(
            `SELECT COALESCE(NULLIF(s.short_id, ''), substr(s.id, 1, ${SHORT_SKILL_ID_LENGTH})) AS skill_public_id,
                    s.name,
                    s.description,
                    ${scoreSql} AS score,
                    ${approvedRank.sql} AS approved_rank
             FROM skills_fts
             JOIN skills s ON s.id = skills_fts.skill_id
             WHERE skills_fts MATCH $query
             ORDER BY approved_rank DESC,
                      ${scoreSql} DESC,
                      COALESCE(s.name, '') ASC,
                      skill_public_id ASC
             LIMIT $limit`,
        )
        .all(bind);
}

function searchSkillsByTextLike(
    db: Database,
    query: string,
    limit: number,
    approvedRank: ApprovedRankSql,
): TextSearchRow[] {
    const normalizedQuery = query.trim().toLowerCase();
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
        return [];
    }

    const bind: Record<string, string | number> = {
        ...approvedRank.bind,
        $query: normalizedQuery,
        $query_like: `%${escapeLike(normalizedQuery)}%`,
        $limit: limit,
    };
    const whereSql = terms
        .map((term, index) => {
            const key = `$term${index}`;
            bind[key] = `%${escapeLike(term)}%`;
            return `(lower(COALESCE(s.name, '')) LIKE ${key} ESCAPE '\\' OR lower(COALESCE(s.description, '')) LIKE ${key} ESCAPE '\\')`;
        })
        .join(" AND ");
    const scoreParts = [
        `CASE WHEN lower(COALESCE(s.name, '')) = $query THEN 1000 ELSE 0 END`,
        `CASE WHEN lower(COALESCE(s.name, '')) LIKE $query_like ESCAPE '\\' THEN 200 ELSE 0 END`,
        `CASE WHEN lower(COALESCE(s.description, '')) LIKE $query_like ESCAPE '\\' THEN 50 ELSE 0 END`,
        ...terms.flatMap((_, index) => [
            `CASE WHEN lower(COALESCE(s.name, '')) LIKE $term${index} ESCAPE '\\' THEN 20 ELSE 0 END`,
            `CASE WHEN lower(COALESCE(s.description, '')) LIKE $term${index} ESCAPE '\\' THEN 5 ELSE 0 END`,
        ]),
    ];
    const scoreSql = scoreParts.join(" + ");

    return db
        .query<TextSearchRow, typeof bind>(
            `SELECT COALESCE(NULLIF(s.short_id, ''), substr(s.id, 1, ${SHORT_SKILL_ID_LENGTH})) AS skill_public_id,
                    s.name,
                    s.description,
                    (${scoreSql}) AS score,
                    ${approvedRank.sql} AS approved_rank
             FROM skills s
             WHERE ${whereSql}
             ORDER BY approved_rank DESC,
                      score DESC,
                      COALESCE(s.name, '') ASC,
                      skill_public_id ASC
             LIMIT $limit`,
        )
        .all(bind);
}

function compareSkillHitsBySearchOrder(left: SkillHit, right: SkillHit): number {
    const approvalComparison =
        Number(right.status === "approved") - Number(left.status === "approved");
    if (approvalComparison !== 0) {
        return approvalComparison;
    }

    const scoreComparison = right.score - left.score;
    if (scoreComparison !== 0) {
        return scoreComparison;
    }

    const nameComparison = (left.name ?? "").localeCompare(right.name ?? "");
    if (nameComparison !== 0) {
        return nameComparison;
    }

    return left.skillId.localeCompare(right.skillId);
}

function orderSearchHits(hits: SkillHit[], limit: number): SkillHit[] {
    return hits.sort(compareSkillHitsBySearchOrder).slice(0, limit);
}

function buildTextMatches(row: TextSearchRow): SkillHit["matches"] {
    const matches: SkillHit["matches"] = [];
    if (row.name) {
        matches.push({ kind: "name", text: row.name, score: row.score });
    }
    if (row.description) {
        matches.push({
            kind: "description",
            text: row.description,
            score: row.score,
        });
    }
    return matches;
}

function searchSkillsByText(
    db: Database,
    query: string,
    limit: number,
    approvedLocations: readonly string[] = [],
): SkillHit[] {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
        return [];
    }

    let rows: TextSearchRow[];
    const approvedRank = buildApprovedRankSql(
        "s",
        approvedLocations,
        hasColumn(db, "skills", "approved"),
    );
    if (hasTable(db, "skills_fts")) {
        try {
            rows = searchSkillsByTextFts(db, trimmedQuery, limit, approvedRank);
        } catch (error) {
            if (!isTextSearchFallbackEligible(error)) {
                throw error;
            }
            rows = searchSkillsByTextLike(db, trimmedQuery, limit, approvedRank);
        }
    } else {
        rows = searchSkillsByTextLike(db, trimmedQuery, limit, approvedRank);
    }

    if (rows.length === 0) {
        return [];
    }

    const occurrencesBySkill = loadOccurrences(db);
    const statusBySkill = loadSkillStatuses(db);
    const approvedLocationSet = new Set(approvedLocations);
    const hits = rows.map((row) => {
        const occurrences = occurrencesBySkill.get(row.skill_public_id) ?? [];
        return {
            skillId: row.skill_public_id,
            occurrences,
            primaryOccurrence: occurrences[0] ?? null,
            name: row.name,
            description: row.description,
            status: resolveHitStatus(
                row.skill_public_id,
                occurrences,
                statusBySkill,
                approvedLocationSet,
            ),
            score: row.score,
            maxScore: row.score,
            meanScore: row.score,
            matches: buildTextMatches(row),
        } satisfies SkillHit;
    });
    return orderSearchHits(hits, limit);
}

async function searchSkillsByEmbedding(
    db: Database,
    params: EmbedSearchParams,
): Promise<SkillHit[]> {
    const limit = params.limit ?? 10;
    const snippetsPerSkill = params.snippetsPerSkill ?? 3;

    const metaRow = db
        .query<{ value: string }, { $k: string }>(`SELECT value FROM embed_meta WHERE key = $k`)
        .get({ $k: "model" });
    if (metaRow && metaRow.value !== params.model) {
        throw new Error(
            `DB was embedded with model ${metaRow.value}, but config uses ${params.model}. Re-run \`skills update --embed\`.`,
        );
    }

    const where: string[] = [];
    const bind: Record<string, string> = {};
    if (params.kinds && params.kinds.length > 0) {
        const placeholders = params.kinds.map((_, i) => `$kind${i}`);
        where.push(`c.kind IN (${placeholders.join(", ")})`);
        params.kinds.forEach((kind, i) => {
            bind[`$kind${i}`] = kind;
        });
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = db
        .query<ChunkRow, typeof bind>(
            `SELECT c.id AS chunk_id, c.skill_id,
                    COALESCE(NULLIF(s.short_id, ''), substr(s.id, 1, ${SHORT_SKILL_ID_LENGTH})) AS skill_public_id,
                    c.kind, c.text, c.embedding,
                    s.name, s.description
             FROM skill_chunks c
             JOIN skills s ON s.id = c.skill_id
             ${whereSql}`,
        )
        .all(bind);

    if (rows.length === 0) return [];

    const embedder = await createEmbedder({
        model: params.model,
        cacheDir: params.cacheDir,
        dim: params.dim,
    });
    const qvec = await embedder.embedQuery(params.query);

    type ScoredChunk = {
        skillId: string;
        name: string | null;
        description: string | null;
        kind: string;
        text: string;
        score: number;
    };
    const scored: ScoredChunk[] = rows.map((r) => ({
        skillId: r.skill_public_id,
        name: r.name,
        description: r.description,
        kind: r.kind,
        text: r.text,
        score: dot(qvec, blobToFloat(r.embedding, params.dim)),
    }));

    const bySkill = new Map<string, ScoredChunk[]>();
    for (const s of scored) {
        const arr = bySkill.get(s.skillId);
        if (arr) arr.push(s);
        else bySkill.set(s.skillId, [s]);
    }

    const occurrencesBySkill = loadOccurrences(db);
    const statusBySkill = loadSkillStatuses(db);
    const approvedLocations = new Set(params.approvedLocations ?? []);
    const hits: SkillHit[] = [];
    for (const [skillId, chunks] of bySkill) {
        chunks.sort((a, b) => b.score - a.score);
        const max = chunks[0]?.score ?? 0;
        const mean = chunks.reduce((acc, c) => acc + c.score, 0) / chunks.length;
        const first = chunks[0];
        if (!first) continue;
        const occurrences = occurrencesBySkill.get(skillId) ?? [];
        hits.push({
            skillId,
            occurrences,
            primaryOccurrence: occurrences[0] ?? null,
            name: first.name,
            description: first.description,
            status: resolveHitStatus(skillId, occurrences, statusBySkill, approvedLocations),
            score: 0.7 * max + 0.3 * mean,
            maxScore: max,
            meanScore: mean,
            matches: chunks.slice(0, snippetsPerSkill).map((c) => ({
                kind: c.kind,
                text: c.text,
                score: c.score,
            })),
        });
    }

    return orderSearchHits(hits, limit);
}

export async function searchSkills(
    params: TextSearchParams | EmbedSearchParams,
): Promise<SkillHit[]> {
    const db = new Database(params.dbPath, { readonly: true });
    try {
        if (params.mode === "embed") {
            return await searchSkillsByEmbedding(db, params);
        }
        return searchSkillsByText(db, params.query, params.limit ?? 10, params.approvedLocations);
    } finally {
        db.close();
    }
}
