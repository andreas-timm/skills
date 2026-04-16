import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export type InferredSource = {
    /**
     * Path used to key the source. For git sources, the git root. For non-git sources, either the top-level
     * folder under the location root, or the location root itself when {@link useLocationName} is `true`.
     */
    sourceRoot: string;
    /** True when a `.git` entry was found on the path from the skill folder up to (and including) the location root. */
    git: boolean;
    /**
     * True when the source represents the location itself rather than a distinct folder beneath it. This is the
     * "top-level folder is the skill folder itself" case from the README (including the degenerate case where
     * the skill lives directly at the location root). Callers should use the configured location name as the
     * source's display name in this case. Always `false` when {@link git} is `true`.
     */
    useLocationName: boolean;
    /**
     * Path from the location root to the source root. Empty when the source root is the location root itself.
     */
    sourceRootSubpath: string;
    /**
     * Stored skill path. Git sources use a path relative to the repo root; all other sources keep the historical
     * location-relative path so existing source semantics remain unchanged.
     */
    occurrenceSubpath: string;
};

function normalizeSubpath(value: string): string {
    return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function resolveOccurrenceDir(params: {
    locationRoot: string;
    sourceGit: boolean;
    sourceRootSubpath: string;
    subpath: string;
}): string {
    const sourceRoot = resolve(params.locationRoot, params.sourceRootSubpath);
    if (params.sourceGit) {
        return resolve(sourceRoot, params.subpath);
    }
    return resolve(params.locationRoot, params.subpath);
}

/**
 * Infer the source for a skill file per the rules in README.md > Terminology > Source:
 *
 * 1. The closest git repository root found while walking up from the skill folder, but not above the
 *    location root (a `.git` file or directory counts).
 * 2. Otherwise, the top-level parent folder for the skill under the location root.
 * 3. If that top-level folder is the skill folder itself (or the skill is directly at the location root),
 *    the source represents the location and callers should use the location name as its display name.
 */
export function inferSourceRoot(skillDir: string, locationRoot: string): InferredSource {
    const root = resolve(locationRoot);
    const skill = resolve(skillDir);
    const skillSubpath = normalizeSubpath(relative(root, skill));
    let d = skill;

    for (;;) {
        if (existsSync(join(d, ".git"))) {
            return {
                sourceRoot: d,
                git: true,
                useLocationName: false,
                sourceRootSubpath: normalizeSubpath(relative(root, d)),
                occurrenceSubpath: normalizeSubpath(relative(d, skill)),
            };
        }
        // Some package mirrors store repository contents in folders ending with `.git`
        // without a nested `.git` entry. Treat the closest such parent as the source root.
        if (d !== root && basename(d).toLowerCase().endsWith(".git")) {
            return {
                sourceRoot: d,
                git: false,
                useLocationName: false,
                sourceRootSubpath: normalizeSubpath(relative(root, d)),
                occurrenceSubpath: skillSubpath,
            };
        }
        if (d === root) {
            break;
        }
        const parent = dirname(d);
        if (parent === d) {
            break;
        }
        if (!(parent === root || parent.startsWith(root + sep))) {
            break;
        }
        d = parent;
    }

    const first = skillSubpath.split("/").filter(Boolean)[0];

    if (!first) {
        return {
            sourceRoot: root,
            git: false,
            useLocationName: true,
            sourceRootSubpath: "",
            occurrenceSubpath: skillSubpath,
        };
    }

    const topLevel = resolve(root, first);
    if (topLevel === skill) {
        return {
            sourceRoot: root,
            git: false,
            useLocationName: true,
            sourceRootSubpath: "",
            occurrenceSubpath: skillSubpath,
        };
    }
    return {
        sourceRoot: topLevel,
        git: false,
        useLocationName: false,
        sourceRootSubpath: normalizeSubpath(relative(root, topLevel)),
        occurrenceSubpath: skillSubpath,
    };
}
