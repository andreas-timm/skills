import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { getLogger } from "@andreas-timm/logger";
import type {
    SkillOccurrenceRow,
    SkillRow,
    SourceRow,
    TransformedSkill,
} from "@features/update/types";
import { lastValueFrom, type Observable, toArray } from "rxjs";

const logger = getLogger();

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    root_subpath TEXT NOT NULL DEFAULT '',
    git      INTEGER NOT NULL DEFAULT 0,
    remote   TEXT,
    branch   TEXT,
    "commit" TEXT,
    date     TEXT,
    approved TEXT CHECK (approved IS NULL OR approved IN ('approved', 'ignore')),
    rating   INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 10)),
    tags     TEXT NOT NULL DEFAULT '[]',
    note     TEXT
);

CREATE TABLE IF NOT EXISTS skills (
    id          TEXT PRIMARY KEY,
    short_id    TEXT NOT NULL,
    version     TEXT,
    date        TEXT,
    version_order INTEGER NOT NULL DEFAULT 0,
    name        TEXT,
    description TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',
    fallback    INTEGER NOT NULL DEFAULT 0,
    approved    TEXT CHECK (approved IS NULL OR approved IN ('approved', 'ignore')),
    rating      INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 10)),
    tags        TEXT NOT NULL DEFAULT '[]',
    note        TEXT,
    virustotal  TEXT
);

CREATE TABLE IF NOT EXISTS skill_occurrences (
    skill_id  TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    subpath   TEXT NOT NULL,
    location  TEXT NOT NULL,
    PRIMARY KEY (skill_id, source_id, subpath)
);

CREATE INDEX IF NOT EXISTS idx_skill_occurrences_skill_id ON skill_occurrences(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_occurrences_source_id ON skill_occurrences(source_id);

CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
    name,
    description,
    skill_id UNINDEXED,
tokenize = 'unicode61'
);
`;

function ensureSchema(db: Database): void {
    migrateSourceSchema(db);
    db.run(SCHEMA);

    const sourceColumns = tableColumns(db, "sources");
    if (!sourceColumns.includes("root_subpath")) {
        db.run(`ALTER TABLE sources ADD COLUMN root_subpath TEXT NOT NULL DEFAULT ''`);
    }
    ensureRatingColumn(db, "sources", sourceColumns);
    const skillColumns = tableColumns(db, "skills");
    ensureRatingColumn(db, "skills", skillColumns);
    ensureVirusTotalColumn(db, skillColumns);
}

function quoteSqlIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}

function tableExists(db: Database, tableName: string): boolean {
    const row = db
        .query<{ found: number }, { $name: string }>(
            `SELECT 1 AS found
             FROM sqlite_master
             WHERE type IN ('table', 'view') AND name = $name
             LIMIT 1`,
        )
        .get({ $name: tableName });
    return row !== null;
}

function tableColumns(db: Database, tableName: string): string[] {
    return db
        .query<{ name: string }, []>(`PRAGMA table_info(${quoteSqlIdentifier(tableName)})`)
        .all()
        .map((row) => row.name);
}

function foreignKeyTables(db: Database, tableName: string): string[] {
    return db
        .query<{ table: string }, []>(`PRAGMA foreign_key_list(${quoteSqlIdentifier(tableName)})`)
        .all()
        .map((row) => row.table);
}

function migrateSourceSchema(db: Database): void {
    if (tableExists(db, "bundles") && !tableExists(db, "sources")) {
        db.run(`ALTER TABLE bundles RENAME TO sources`);
    }

    if (tableExists(db, "skill_occurrences")) {
        const occurrenceColumns = tableColumns(db, "skill_occurrences");
        const occurrenceForeignTables = foreignKeyTables(db, "skill_occurrences");
        if (
            occurrenceForeignTables.includes("bundles") ||
            occurrenceColumns.includes("bundle_id") ||
            !occurrenceColumns.includes("source_id")
        ) {
            db.run(`DROP INDEX IF EXISTS idx_skill_occurrences_bundle_id`);
            db.run(`DROP INDEX IF EXISTS idx_skill_occurrences_source_id`);
            db.run(`DROP TABLE skill_occurrences`);
        }
    }

    db.run(`DROP INDEX IF EXISTS idx_skill_occurrences_bundle_id`);
}

function ensureRatingColumn(
    db: Database,
    tableName: "sources" | "skills",
    columns: string[],
): void {
    if (columns.includes("rating")) return;
    if (columns.includes("score")) {
        db.run(`ALTER TABLE ${tableName} RENAME COLUMN score TO rating`);
        return;
    }
    db.run(
        `ALTER TABLE ${tableName} ADD COLUMN rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 10))`,
    );
}

function ensureVirusTotalColumn(db: Database, columns: string[]): void {
    if (columns.includes("virustotal")) return;
    db.run(`ALTER TABLE skills ADD COLUMN virustotal TEXT`);
}

function normalizeDate(value: string | null | undefined): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString();
}

function maxDate(
    current: string | null | undefined,
    candidate: string | null | undefined,
): string | null {
    const currentDate = normalizeDate(current);
    const candidateDate = normalizeDate(candidate);
    if (currentDate === null) {
        return candidateDate;
    }
    if (candidateDate === null) {
        return currentDate;
    }
    return candidateDate > currentDate ? candidateDate : currentDate;
}

function minDate(
    current: string | null | undefined,
    candidate: string | null | undefined,
): string | null {
    const currentDate = normalizeDate(current);
    const candidateDate = normalizeDate(candidate);
    if (currentDate === null) {
        return candidateDate;
    }
    if (candidateDate === null) {
        return currentDate;
    }
    return candidateDate < currentDate ? candidateDate : currentDate;
}

function metadataForStorage(metadata: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(metadata).filter(([key]) => key !== "name" && key !== "description"),
    );
}

function resolveSourceDate(source: SourceRow, skill: SkillRow): string | null {
    if (source.git) {
        return normalizeDate(source.date);
    }
    return maxDate(source.date, skill.date);
}

function compareSemverLike(a: string | null, b: string | null): number {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    const ap = a.split(".");
    const bp = b.split(".");
    const maxLen = Math.max(ap.length, bp.length);
    for (let i = 0; i < maxLen; i++) {
        const as = ap[i];
        const bs = bp[i];
        if (as === bs) continue;
        if (as === undefined) return -1;
        if (bs === undefined) return 1;
        const an = Number(as);
        const bn = Number(bs);
        const aNumeric = Number.isInteger(an) && String(an) === as;
        const bNumeric = Number.isInteger(bn) && String(bn) === bs;
        if (aNumeric && bNumeric) {
            if (an < bn) return -1;
            if (an > bn) return 1;
            continue;
        }
        const cmp = as.localeCompare(bs);
        if (cmp !== 0) return cmp;
    }
    return a.localeCompare(b);
}

export type VersionOrderRow = {
    id: string;
    name: string | null;
    version: string | null;
    date: string | null;
};

export function computeVersionOrders(rows: VersionOrderRow[]): Map<string, number> {
    const uniqueRows = new Map<string, VersionOrderRow>();
    for (const row of rows) {
        if (!uniqueRows.has(row.id)) {
            uniqueRows.set(row.id, row);
        }
    }

    const byName = new Map<string, VersionOrderRow[]>();
    for (const row of uniqueRows.values()) {
        const key = row.name ?? "";
        const items = byName.get(key);
        if (items) items.push(row);
        else byName.set(key, [row]);
    }
    const result = new Map<string, number>();
    for (const [, items] of byName) {
        items.sort((a, b) => {
            const ad = a.date ?? "";
            const bd = b.date ?? "";
            const dateCmp = ad.localeCompare(bd);
            if (dateCmp !== 0) return dateCmp;
            const aHasVersion = a.version ? 0 : 1;
            const bHasVersion = b.version ? 0 : 1;
            if (aHasVersion !== bHasVersion) return aHasVersion - bHasVersion;
            const versionCmp = compareSemverLike(a.version, b.version);
            if (versionCmp !== 0) return versionCmp;
            return a.id.localeCompare(b.id);
        });
        for (const [index, row] of items.entries()) {
            result.set(row.id, index + 1);
        }
    }
    return result;
}

function readExistingVirusTotalReports(db: Database): Map<string, string> {
    if (!tableColumns(db, "skills").includes("virustotal")) {
        return new Map();
    }

    const rows = db
        .query<{ id: string; virustotal: string | null }, []>(
            `SELECT id, virustotal
             FROM skills
             WHERE virustotal IS NOT NULL`,
        )
        .all();
    return new Map(
        rows
            .filter((row): row is { id: string; virustotal: string } => Boolean(row.virustotal))
            .map((row) => [row.id, row.virustotal]),
    );
}

export async function load(dbPath: string, source: Observable<TransformedSkill>): Promise<void> {
    const items = await lastValueFrom(source.pipe(toArray()));

    await mkdir(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath, { create: true });
    try {
        ensureSchema(db);
        const existingVirusTotalReports = readExistingVirusTotalReports(db);

        const sources = new Map<string, SourceRow>();
        const skills = new Map<string, SkillRow>();
        const occurrences: SkillOccurrenceRow[] = [];

        for (const item of items) {
            const existingSource = sources.get(item.source.id);
            const sourceDate = resolveSourceDate(item.source, item.skill);
            if (!existingSource) {
                sources.set(item.source.id, {
                    ...item.source,
                    date: sourceDate ?? undefined,
                });
            }

            if (existingSource && !existingSource.git) {
                existingSource.date = maxDate(existingSource.date, sourceDate) ?? undefined;
            }

            const existingSkill = skills.get(item.skill.id);
            if (!existingSkill) {
                skills.set(item.skill.id, {
                    ...item.skill,
                    date: normalizeDate(item.skill.date),
                    tags: [...new Set(item.skill.tags)].sort((a, b) => a.localeCompare(b)),
                });
            } else {
                existingSkill.date = minDate(existingSkill.date, item.skill.date);
                const mergedTags = new Set<string>([...existingSkill.tags, ...item.skill.tags]);
                existingSkill.tags = [...mergedTags].sort((a, b) => a.localeCompare(b));
            }

            occurrences.push(item.occurrence);
        }

        const sortedSources = [...sources.values()].sort((a, b) => a.id.localeCompare(b.id));
        const sortedSkills = [...skills.values()].sort((a, b) => a.id.localeCompare(b.id));
        const sortedOccurrences = [...occurrences].sort((a, b) => {
            const bySkill = a.skillId.localeCompare(b.skillId);
            if (bySkill !== 0) return bySkill;
            const bySource = a.sourceId.localeCompare(b.sourceId);
            if (bySource !== 0) return bySource;
            return a.subpath.localeCompare(b.subpath);
        });

        const insertSource = db.prepare(
            `INSERT INTO sources (id, name, root_subpath, git, remote, branch, "commit", date, approved, rating, tags, note)
             VALUES ($id, $name, $root_subpath, $git, $remote, $branch, $commit, $date, $approved, $rating, $tags, $note)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 root_subpath = excluded.root_subpath,
                 git = excluded.git,
                 remote = excluded.remote,
                 branch = excluded.branch,
                 "commit" = excluded."commit",
                 date = excluded.date,
                 approved = excluded.approved,
                 rating = excluded.rating,
                 tags = excluded.tags,
                 note = excluded.note`,
        );
        const insertSkill = db.prepare(
            `INSERT INTO skills (id, short_id, version, date, version_order, name, description, metadata, fallback, approved, rating, tags, note, virustotal)
             VALUES ($id, $short_id, $version, $date, $version_order, $name, $description, $metadata, $fallback, $approved, $rating, $tags, $note, $virustotal)
             ON CONFLICT(id) DO UPDATE SET
                 short_id = excluded.short_id,
                 version = excluded.version,
                 date = excluded.date,
                 version_order = excluded.version_order,
                 name = excluded.name,
                 description = excluded.description,
                 metadata = excluded.metadata,
                 fallback = excluded.fallback,
                 approved = excluded.approved,
                 rating = excluded.rating,
                 tags = excluded.tags,
                 note = excluded.note,
                 virustotal = excluded.virustotal`,
        );
        const insertOccurrence = db.prepare(
            `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
             VALUES ($skill_id, $source_id, $subpath, $location)
             ON CONFLICT(skill_id, source_id, subpath) DO NOTHING`,
        );
        const insertSkillFts = db.prepare(
            `INSERT INTO skills_fts (name, description, skill_id)
             VALUES ($name, $description, $skill_id)`,
        );
        const updateVersionOrder = db.prepare(
            `UPDATE skills SET version_order = $version_order WHERE id = $id`,
        );

        db.transaction(() => {
            db.run("DELETE FROM skills_fts");
            db.run("DELETE FROM skill_occurrences");
            db.run("DELETE FROM skills");
            db.run("DELETE FROM sources");
            for (const source of sortedSources) {
                insertSource.run({
                    $id: source.id,
                    $name: source.name,
                    $root_subpath: source.rootSubpath,
                    $git: source.git ? 1 : 0,
                    $remote: source.remote ?? null,
                    $branch: source.branch ?? null,
                    $commit: source.commit ?? null,
                    $date: source.date ?? null,
                    $approved: source.approved ?? null,
                    $rating: source.rating ?? null,
                    $tags: JSON.stringify(source.tags),
                    $note: source.note ?? null,
                });
            }
            for (const skill of sortedSkills) {
                insertSkill.run({
                    $id: skill.id,
                    $short_id: skill.shortId,
                    $version: skill.version,
                    $date: normalizeDate(skill.date),
                    $version_order: skill.versionOrder,
                    $name: skill.name,
                    $description: skill.description,
                    $metadata: JSON.stringify(metadataForStorage(skill.metadata)),
                    $fallback: skill.fallback ? 1 : 0,
                    $approved: skill.approved ?? null,
                    $rating: skill.rating ?? null,
                    $tags: JSON.stringify(skill.tags),
                    $note: skill.note ?? null,
                    $virustotal: existingVirusTotalReports.get(skill.id) ?? null,
                });
                insertSkillFts.run({
                    $name: skill.name,
                    $description: skill.description,
                    $skill_id: skill.id,
                });
            }
            for (const occurrence of sortedOccurrences) {
                insertOccurrence.run({
                    $skill_id: occurrence.skillId,
                    $source_id: occurrence.sourceId,
                    $subpath: occurrence.subpath,
                    $location: occurrence.location,
                });
            }
            const orderRows = db
                .query<VersionOrderRow, []>(`SELECT id, name, version, date FROM skills`)
                .all();
            const orders = computeVersionOrders(orderRows);
            for (const [id, versionOrder] of orders) {
                updateVersionOrder.run({
                    $id: id,
                    $version_order: versionOrder,
                });
            }
        })();

        logger.info(
            `Wrote ${dbPath} (${sortedSources.length} sources, ${sortedSkills.length} skills, ${sortedOccurrences.length} occurrences)`,
        );
    } finally {
        db.close();
    }
}

export async function reset(dbPath: string): Promise<void> {
    await mkdir(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath, { create: true });
    try {
        ensureSchema(db);
        db.transaction(() => {
            db.run("DELETE FROM skills_fts");
            db.run("DELETE FROM skill_occurrences");
            db.run("DELETE FROM skills");
            db.run("DELETE FROM sources");
        })();
        logger.info(`Cleared ${dbPath}`);
    } finally {
        db.close();
    }
}
