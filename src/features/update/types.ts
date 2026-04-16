import type { Config } from "@config";

export type LocationSourceConfigMap = NonNullable<Config["skills"]["locations"][string]["source"]>;

export type GitInfo = {
    remote?: string;
    branch?: string;
    commit?: string;
    date?: string;
};

export type RawSkill = {
    locationName: string;
    locationRoot: string;
    filePath: string;
    locationTags?: string[];
    locationSourceConfig?: LocationSourceConfigMap;
};

export type SkillRow = {
    id: string;
    /** Short hash prefix of `id`; stored in DB and shown as the public skill id in CLI output. */
    shortId: string;
    /** Parsed from frontmatter `version` when present. */
    version: string | null;
    /** ISO-8601 timestamp resolved per occurrence; duplicate IDs keep the earliest timestamp in load(). */
    date: string | null;
    /** Per-name rank (1 oldest, N latest), computed in load(). */
    versionOrder: number;
    name: string | null;
    description: string | null;
    metadata: Record<string, unknown>;
    fallback: boolean;
    approved: "approved" | "ignore" | null;
    rating: number | null;
    tags: string[];
    note: string | null;
};

export type SkillOccurrenceRow = {
    skillId: string;
    sourceId: string;
    location: string;
    subpath: string;
};

export type SourceRow = GitInfo & {
    id: string;
    name: string;
    /** Source root relative to the configured location root. Empty when the source root is the location root. */
    rootSubpath: string;
    git: boolean;
    approved: "approved" | "ignore" | null;
    rating: number | null;
    tags: string[];
    note: string | null;
};

export type TransformedSkill = {
    source: SourceRow;
    skill: SkillRow;
    occurrence: SkillOccurrenceRow;
    /** Config `[skills.locations.*].tags` merged into `skills.tags` on update. */
    locationTags?: string[];
};
