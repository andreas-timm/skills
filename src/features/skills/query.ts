import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { SHORT_SKILL_ID_LENGTH } from "@features/skill/id";
import { resolveSkillReferenceInDb } from "@features/skill/reference";

export type ListApprovalStatus = "approved";

export type SourceListRow = {
    id: string;
    name: string;
    git: boolean;
    remote: string | null;
    branch: string | null;
    commit: string | null;
    date: string | null;
    status: ListApprovalStatus | undefined;
    rating: number | null;
    tags: string[];
    note: string | null;
};

export type SkillListRow = {
    id: string;
    date: string | null;
    version_order: number;
    version_count: number;
    duplicate: number;
    name: string | null;
    version: string | null;
    description: string | null;
    location: string | null;
    source_name: string | null;
    status: ListApprovalStatus | undefined;
    rating: number | null;
    tags: string[];
    note: string | null;
};

export type SkillListRowByFullId = SkillListRow & {
    full_id: string;
};

export type SkillVersionListRow = {
    id: string;
    date: string | null;
    version_order: number;
    name: string | null;
    version: string | null;
    duplicate: number;
    description: string | null;
    status: ListApprovalStatus | undefined;
    rating: number | null;
    tags: string[];
    note: string | null;
};

export type SkillOccurrenceListRow = {
    skill_id: string;
    source_id: string;
    source_name: string;
    source_date: string | null;
    location: string;
    subpath: string;
};

type ApprovalColumns = {
    status: string | null;
    rating: number | null;
    tags: string | null;
    note: string | null;
};

type SourceListRowRaw = Omit<SourceListRow, "status" | "tags" | "git"> & {
    status: string | null;
    tags: string | null;
    git: number;
};

type SkillListRowRaw = Omit<SkillListRow, "status" | "tags"> & {
    status: string | null;
    tags: string | null;
};

type SkillListRowByFullIdRaw = Omit<SkillListRowByFullId, "status" | "tags"> & {
    status: string | null;
    tags: string | null;
};

type SkillVersionListRowRaw = Omit<SkillVersionListRow, "status" | "tags"> & {
    status: string | null;
    tags: string | null;
};

type EffectiveApprovalOptions = {
    approvedLocations?: readonly string[];
};

function parseTags(rawTags: string | null): string[] {
    if (!rawTags) {
        return [];
    }

    try {
        const parsed = JSON.parse(rawTags);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((tag): tag is string => typeof tag === "string");
    } catch {
        return [];
    }
}

function parseListApprovalStatus(rawStatus: string | null): ListApprovalStatus | undefined {
    return rawStatus === "approved" ? rawStatus : undefined;
}

function mapApprovalColumns<TRow extends ApprovalColumns>(
    row: TRow,
): Omit<TRow, "status" | "tags"> & {
    status: ListApprovalStatus | undefined;
    tags: string[];
} {
    return {
        ...row,
        status: parseListApprovalStatus(row.status),
        tags: parseTags(row.tags),
    };
}

function buildEffectiveSkillStatusSql(
    skillAlias: string,
    approvedLocations: readonly string[] = [],
): { sql: string; bind: Record<string, string> } {
    const locations = [...new Set(approvedLocations)].filter(Boolean);
    if (locations.length === 0) {
        return { sql: `${skillAlias}.approved`, bind: {} };
    }

    const bind: Record<string, string> = {};
    const placeholders = locations.map((location, index) => {
        const key = `$approved_location_${index}`;
        bind[key] = location;
        return key;
    });

    return {
        sql: `CASE
                 WHEN ${skillAlias}.approved IS NOT NULL THEN ${skillAlias}.approved
                 WHEN EXISTS (
                    SELECT 1
                    FROM skill_occurrences approval_occurrence
                    WHERE approval_occurrence.skill_id = ${skillAlias}.id
                      AND approval_occurrence.location IN (${placeholders.join(", ")})
                 ) THEN 'approved'
                 ELSE NULL
              END`,
        bind,
    };
}

export function listSources(dbPath: string): SourceListRow[] {
    if (!existsSync(dbPath)) {
        return [];
    }

    const db = new Database(dbPath, { readonly: true });
    try {
        return db
            .query<SourceListRowRaw, []>(
                `SELECT b.id,
                        b.name,
                        b.git,
                        b.remote,
                        b.branch,
                        b."commit" AS "commit",
                        b.date,
                        b.approved AS status,
                        b.rating,
                        b.tags,
                        b.note
                 FROM sources b
                 ORDER BY b.name, b.id`,
            )
            .all()
            .map((row) => {
                const mapped = mapApprovalColumns(row);
                return {
                    ...mapped,
                    git: row.git !== 0,
                };
            });
    } finally {
        db.close();
    }
}

export function listSkills(dbPath: string, options: EffectiveApprovalOptions = {}): SkillListRow[] {
    if (!existsSync(dbPath)) {
        return [];
    }

    const db = new Database(dbPath, { readonly: true });
    try {
        const effectiveStatus = buildEffectiveSkillStatusSql("s", options.approvedLocations);
        return db
            .query<SkillListRowRaw, Record<string, string>>(
                `WITH primary_occurrences AS (
                    SELECT o.skill_id,
                           o.location,
                           b.name AS source_name,
                           ROW_NUMBER() OVER (
                               PARTITION BY o.skill_id
                               ORDER BY COALESCE(b.date, '') DESC,
                                        o.location,
                                        b.name,
                                        o.subpath,
                                        o.source_id
                           ) AS rn
                    FROM skill_occurrences o
                    JOIN sources b ON b.id = o.source_id
                 ),
                 per_version_duplicates AS (
                    SELECT s.id,
                           s.name,
                           CASE
                              WHEN COUNT(o.skill_id) > 1 THEN COUNT(o.skill_id) - 1
                              ELSE 0
                           END AS duplicate
                    FROM skills s
                    LEFT JOIN skill_occurrences o ON o.skill_id = s.id
                    GROUP BY s.id, s.name
                 ),
                 skill_counts AS (
                    SELECT name,
                           COUNT(*) AS version_count,
                           SUM(duplicate) AS duplicate
                    FROM per_version_duplicates
                    GROUP BY name
                 )
                 SELECT COALESCE(NULLIF(s.short_id, ''), substr(s.id, 1, ${SHORT_SKILL_ID_LENGTH})) AS id,
                        s.date,
                        s.version_order,
                        sc.version_count,
                        sc.duplicate,
                        s.name,
                        s.version,
                        s.description,
                        po.location,
                        po.source_name,
                        ${effectiveStatus.sql} AS status,
                        s.rating,
                        s.tags,
                        s.note
                 FROM skills s
                 LEFT JOIN primary_occurrences po
                   ON po.skill_id = s.id
                  AND po.rn = 1
                 JOIN skill_counts sc
                   ON sc.name IS s.name
                 WHERE s.version_order = (
                    SELECT MAX(s2.version_order) FROM skills s2 WHERE s2.name = s.name
                 )
                 ORDER BY s.name, s.id`,
            )
            .all(effectiveStatus.bind)
            .map((row) => mapApprovalColumns(row));
    } finally {
        db.close();
    }
}

export function listSkillsByFullIds(
    dbPath: string,
    ids: readonly string[],
    options: EffectiveApprovalOptions = {},
): SkillListRowByFullId[] {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (uniqueIds.length === 0 || !existsSync(dbPath)) {
        return [];
    }

    const db = new Database(dbPath, { readonly: true });
    try {
        const effectiveStatus = buildEffectiveSkillStatusSql("s", options.approvedLocations);
        const bind: Record<string, string> = { ...effectiveStatus.bind };
        const idPlaceholders = uniqueIds.map((id, index) => {
            const key = `$id_${index}`;
            bind[key] = id;
            return key;
        });

        return db
            .query<SkillListRowByFullIdRaw, Record<string, string>>(
                `WITH primary_occurrences AS (
                    SELECT o.skill_id,
                           o.location,
                           b.name AS source_name,
                           ROW_NUMBER() OVER (
                               PARTITION BY o.skill_id
                               ORDER BY COALESCE(b.date, '') DESC,
                                        o.location,
                                        b.name,
                                        o.subpath,
                                        o.source_id
                           ) AS rn
                    FROM skill_occurrences o
                    JOIN sources b ON b.id = o.source_id
                 ),
                 per_version_duplicates AS (
                    SELECT s.id,
                           s.name,
                           CASE
                              WHEN COUNT(o.skill_id) > 1 THEN COUNT(o.skill_id) - 1
                              ELSE 0
                           END AS duplicate
                    FROM skills s
                    LEFT JOIN skill_occurrences o ON o.skill_id = s.id
                    GROUP BY s.id, s.name
                 ),
                 skill_counts AS (
                    SELECT name,
                           COUNT(*) AS version_count,
                           SUM(duplicate) AS duplicate
                    FROM per_version_duplicates
                    GROUP BY name
                 )
                 SELECT s.id AS full_id,
                        COALESCE(NULLIF(s.short_id, ''), substr(s.id, 1, ${SHORT_SKILL_ID_LENGTH})) AS id,
                        s.date,
                        s.version_order,
                        sc.version_count,
                        sc.duplicate,
                        s.name,
                        s.version,
                        s.description,
                        po.location,
                        po.source_name,
                        ${effectiveStatus.sql} AS status,
                        s.rating,
                        s.tags,
                        s.note
                 FROM skills s
                 LEFT JOIN primary_occurrences po
                   ON po.skill_id = s.id
                  AND po.rn = 1
                 JOIN skill_counts sc
                   ON sc.name IS s.name
                 WHERE s.id IN (${idPlaceholders.join(", ")})
                 ORDER BY s.name, s.id`,
            )
            .all(bind)
            .map((row) => mapApprovalColumns(row));
    } finally {
        db.close();
    }
}

export function listSkillVersions(
    dbPath: string,
    skill?: string,
    options: EffectiveApprovalOptions = {},
): SkillVersionListRow[] {
    if (!existsSync(dbPath)) {
        return [];
    }

    const db = new Database(dbPath, { readonly: true });
    try {
        const effectiveStatus = buildEffectiveSkillStatusSql("s", options.approvedLocations);
        let whereSql = "";
        const bind: Record<string, string> = { ...effectiveStatus.bind };
        if (skill) {
            const resolvedSkill = resolveSkillReferenceInDb(db, skill);
            if (resolvedSkill?.name) {
                whereSql = "WHERE s.name = $name";
                bind.$name = resolvedSkill.name;
            } else if (resolvedSkill) {
                whereSql = "WHERE s.id = $id";
                bind.$id = resolvedSkill.id;
            } else {
                whereSql = "WHERE s.name = $name";
                bind.$name = skill;
            }
        }
        return db
            .query<SkillVersionListRowRaw, Record<string, string>>(
                `SELECT COALESCE(NULLIF(s.short_id, ''), substr(s.id, 1, ${SHORT_SKILL_ID_LENGTH})) AS id,
                        s.date,
                        s.version_order,
                        s.name,
                        s.version,
                        (
                           SELECT CASE
                              WHEN COUNT(*) > 1 THEN COUNT(*) - 1
                              ELSE 0
                           END
                           FROM skill_occurrences o
                           WHERE o.skill_id = s.id
                        ) AS duplicate,
                        s.description,
                        ${effectiveStatus.sql} AS status,
                        s.rating,
                        s.tags,
                        s.note
                 FROM skills s
                 ${whereSql}
                 ORDER BY s.name, s.version_order DESC, s.id`,
            )
            .all(bind)
            .map((row) => mapApprovalColumns(row));
    } finally {
        db.close();
    }
}

export function listSkillOccurrences(dbPath: string, skill: string): SkillOccurrenceListRow[] {
    if (!existsSync(dbPath)) {
        return [];
    }

    const db = new Database(dbPath, { readonly: true });
    try {
        const resolvedSkill = resolveSkillReferenceInDb(db, skill);
        if (!resolvedSkill) {
            return [];
        }

        return db
            .query<SkillOccurrenceListRow, { $id: string }>(
                `SELECT COALESCE(NULLIF(s.short_id, ''), substr(s.id, 1, ${SHORT_SKILL_ID_LENGTH})) AS skill_id,
                        o.source_id,
                        b.name AS source_name,
                        b.date AS source_date,
                        o.location,
                        o.subpath
                 FROM skills s
                 JOIN skill_occurrences o ON o.skill_id = s.id
                 JOIN sources b ON b.id = o.source_id
                 WHERE s.id = $id
                 ORDER BY COALESCE(b.date, ''), o.location, o.subpath`,
            )
            .all({ $id: resolvedSkill.id });
    } finally {
        db.close();
    }
}
