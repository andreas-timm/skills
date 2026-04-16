import { join } from "node:path";
import type { Config } from "@config";
import { expandHome } from "@libs/path";

export { expandHome };

/** Per named location: expanded root path and optional defaults from config. */
export type SkillLocationSettings = {
    root: string;
    tags?: string[];
    approved?: boolean;
    source?: Config["skills"]["locations"][string]["source"];
};

export function resolveDbPath(rawPath: string, rootDir: string): string {
    if (rawPath.startsWith("/") || rawPath.startsWith("~")) {
        return expandHome(rawPath);
    }
    return join(rootDir, rawPath);
}

/** SQLite DB path from config. */
export function resolveSkillsDbPath(config: Config): string {
    return resolveDbPath(config.skills.db_path, config.root_dir);
}

/** Location name → settings (`dir` expanded, optional tags / approved). */
export function expandSkillLocationSettings(config: Config): Record<string, SkillLocationSettings> {
    const out: Record<string, SkillLocationSettings> = {};
    for (const [name, loc] of Object.entries(config.skills.locations)) {
        out[name] = {
            root: expandHome(loc.dir),
            ...(loc.tags !== undefined ? { tags: loc.tags } : {}),
            ...(loc.approved !== undefined ? { approved: loc.approved } : {}),
            ...(loc.source !== undefined ? { source: loc.source } : {}),
        };
    }
    return out;
}

/** Location name → absolute root path (`~` expanded). */
export function expandSkillLocationRoots(config: Config): Record<string, string> {
    const settings = expandSkillLocationSettings(config);
    return Object.fromEntries(Object.entries(settings).map(([name, s]) => [name, s.root]));
}
