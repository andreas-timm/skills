import { Database } from "bun:sqlite";
import { effectiveApprovalStatus } from "@features/approve/effective";
import { type ApprovalStatus, isApprovalStatus } from "@features/approve/status";
import { SHORT_SKILL_ID_LENGTH } from "@features/skill/id";
import { resolveSkillReferenceInDb } from "@features/skill/reference";

export type SkillOccurrence = {
    source_id: string;
    source_name: string;
    source_git: boolean;
    source_remote: string | null;
    source_branch: string | null;
    source_commit: string | null;
    source_date: string | null;
    location: string;
    subpath: string;
};

export type ShowSkillVersion = {
    id: string;
    full_id: string;
    version: string | null;
    date: string | null;
    version_order: number;
    name: string | null;
    description: string | null;
    metadata: Record<string, unknown>;
    fallback: boolean;
    status: ApprovalStatus | null;
    rating: number | null;
    tags: string[];
    note: string | null;
    source: string | null;
    location: string | null;
    subpath: string | null;
    occurrences: SkillOccurrence[];
    related_versions: ShowSkillRelatedVersion[];
};

export type ShowSkillNameGroup = {
    name: string;
    versions: ShowSkillVersion[];
};

export type ShowSkillRelatedVersion = {
    id: string;
    version: string | null;
    version_order: number;
    date: string | null;
    source: string | null;
    location: string | null;
    subpath: string | null;
};

type ShowSkillVersionRaw = Omit<
    ShowSkillVersion,
    | "metadata"
    | "fallback"
    | "tags"
    | "source"
    | "location"
    | "subpath"
    | "occurrences"
    | "related_versions"
    | "full_id"
    | "status"
> & {
    full_id: string;
    metadata: string;
    fallback: number;
    status: string | null;
    tags: string | null;
};

type SkillOccurrenceRaw = Omit<SkillOccurrence, "source_git"> & {
    source_git: number;
};

type PrimaryOccurrencePathInfo = {
    location: string;
    subpath: string;
    source_git: number;
    source_root_subpath: string;
};

type EffectiveApprovalOptions = {
    approvedLocations?: readonly string[];
};

const SELECT_SKILL = `SELECT COALESCE(NULLIF(s.short_id, ''), substr(s.id, 1, ${SHORT_SKILL_ID_LENGTH})) AS id,
                             s.id AS full_id,
                             s.version,
                             s.date,
                             s.version_order,
                             s.name,
                             s.description,
                             s.metadata,
                             s.fallback,
                             s.approved AS status,
                             s.rating,
                             s.tags,
                             s.note
                      FROM skills s`;

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

function parseMetadata(rawMetadata: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(rawMetadata);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
            return {};
        }
        return parsed as Record<string, unknown>;
    } catch {
        return {};
    }
}

function parseShowApprovalStatus(rawStatus: string | null): ApprovalStatus | null {
    return rawStatus && isApprovalStatus(rawStatus) ? rawStatus : null;
}

function mapSkillRow(row: ShowSkillVersionRaw): ShowSkillVersion {
    return {
        ...row,
        metadata: parseMetadata(row.metadata),
        fallback: row.fallback !== 0,
        status: parseShowApprovalStatus(row.status),
        tags: parseTags(row.tags),
        source: null,
        location: null,
        subpath: null,
        occurrences: [],
        related_versions: [],
    };
}

function getOccurrences(db: Database, skillId: string): SkillOccurrence[] {
    return db
        .query<SkillOccurrenceRaw, { $skillId: string }>(
            `SELECT o.source_id,
                    b.name AS source_name,
                    b.git AS source_git,
                    b.remote AS source_remote,
                    b.branch AS source_branch,
                    b."commit" AS source_commit,
                    b.date AS source_date,
                    o.location,
                    o.subpath
             FROM skill_occurrences o
             JOIN sources b ON b.id = o.source_id
             WHERE o.skill_id = $skillId
             ORDER BY COALESCE(b.date, ''), o.location, o.subpath`,
        )
        .all({ $skillId: skillId })
        .map((row) => ({
            ...row,
            source_git: row.source_git !== 0,
        }));
}

function mapSkillWithOccurrences(
    db: Database,
    row: ShowSkillVersionRaw,
    approvedLocations: ReadonlySet<string>,
): ShowSkillVersion {
    const mapped = mapSkillRow(row);
    mapped.occurrences = getOccurrences(db, row.full_id);
    const primaryOccurrence = mapped.occurrences[0];
    mapped.source = primaryOccurrence?.source_name ?? null;
    mapped.location = primaryOccurrence?.location ?? null;
    mapped.subpath = primaryOccurrence?.subpath ?? null;
    mapped.status = effectiveApprovalStatus(
        mapped.status,
        mapped.occurrences.map((occurrence) => occurrence.location),
        approvedLocations,
    );
    return mapped;
}

function toRelatedVersion(version: ShowSkillVersion): ShowSkillRelatedVersion {
    return {
        id: version.id,
        version: version.version,
        version_order: version.version_order,
        date: version.date,
        source: version.source,
        location: version.location,
        subpath: version.subpath,
    };
}

function attachRelatedVersions(
    db: Database,
    version: ShowSkillVersion,
    approvedLocations: ReadonlySet<string>,
): ShowSkillVersion {
    if (!version.name) {
        return version;
    }

    version.related_versions = getVersionsByName(db, version.name, approvedLocations)
        .filter((related) => related.full_id !== version.full_id)
        .map(toRelatedVersion);

    return version;
}

function getVersionByFullId(
    db: Database,
    skillId: string,
    approvedLocations: ReadonlySet<string>,
): ShowSkillVersion | null {
    const row = db
        .query<ShowSkillVersionRaw, { $id: string }>(
            `${SELECT_SKILL}
             WHERE s.id = $id`,
        )
        .get({ $id: skillId });
    if (!row) {
        return null;
    }

    return attachRelatedVersions(
        db,
        mapSkillWithOccurrences(db, row, approvedLocations),
        approvedLocations,
    );
}

function getVersionsByName(
    db: Database,
    name: string,
    approvedLocations: ReadonlySet<string>,
): ShowSkillVersion[] {
    return db
        .query<ShowSkillVersionRaw, { $name: string }>(
            `${SELECT_SKILL}
             WHERE s.name = $name
             ORDER BY s.version_order, s.id`,
        )
        .all({ $name: name })
        .map((row) => mapSkillWithOccurrences(db, row, approvedLocations));
}

function hasSourceRootSubpathColumn(db: Database): boolean {
    return db
        .query<{ name: string }, []>(`PRAGMA table_info(sources)`)
        .all()
        .some((row) => row.name === "root_subpath");
}

export function getSkill(
    dbPath: string,
    reference: string,
    options: EffectiveApprovalOptions = {},
): ShowSkillVersion | ShowSkillNameGroup | null {
    const db = new Database(dbPath, { readonly: true });
    try {
        const approvedLocations = new Set(options.approvedLocations ?? []);
        const resolvedSkill = resolveSkillReferenceInDb(db, reference);
        if (!resolvedSkill) {
            return null;
        }
        return getVersionByFullId(db, resolvedSkill.id, approvedLocations);
    } finally {
        db.close();
    }
}

export function getPrimaryOccurrencePathInfo(
    dbPath: string,
    skillId: string,
): {
    location: string;
    subpath: string;
    sourceGit: boolean;
    sourceRootSubpath: string;
} | null {
    const db = new Database(dbPath, { readonly: true });
    try {
        const rootSubpathExpr = hasSourceRootSubpathColumn(db)
            ? `COALESCE(b.root_subpath, '')`
            : `''`;
        const row = db
            .query<PrimaryOccurrencePathInfo, { $skillId: string }>(
                `SELECT o.location,
                        o.subpath,
                        b.git AS source_git,
                        ${rootSubpathExpr} AS source_root_subpath
                 FROM skill_occurrences o
                 JOIN sources b ON b.id = o.source_id
                 WHERE o.skill_id = $skillId
                 ORDER BY COALESCE(b.date, ''), o.location, o.subpath
                 LIMIT 1`,
            )
            .get({ $skillId: skillId });
        if (!row) {
            return null;
        }
        return {
            location: row.location,
            subpath: row.subpath,
            sourceGit: row.source_git !== 0,
            sourceRootSubpath: row.source_root_subpath,
        };
    } finally {
        db.close();
    }
}
