import type { Dirent } from "node:fs";
import { opendir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { LocationSourceConfigMap, RawSkill } from "@features/update/types";
import { defer, from, mergeMap, type Observable } from "rxjs";

export type SkillLocation = {
    name: string;
    root: string;
    optional?: boolean;
    tags?: string[];
    sourceConfig?: LocationSourceConfigMap;
};

const SKILL_FILE_NAME = "SKILL.md";

function formatScanError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function openDirectory(dir: string) {
    try {
        return await opendir(dir);
    } catch (error) {
        throw new Error(`failed to open ${dir}: ${formatScanError(error)}`, { cause: error });
    }
}

async function maybeRealpath(path: string): Promise<string | undefined> {
    try {
        return await realpath(path);
    } catch {
        return undefined;
    }
}

function isNotFoundError(error: unknown): boolean {
    let current = error;
    while (current && typeof current === "object") {
        if ("code" in current && current.code === "ENOENT") {
            return true;
        }
        current = "cause" in current ? current.cause : undefined;
    }
    return false;
}

async function statEntry(path: string) {
    try {
        return await stat(path);
    } catch {
        return undefined;
    }
}

async function isSkillFile(entry: Dirent, path: string): Promise<boolean> {
    if (entry.name !== SKILL_FILE_NAME) {
        return false;
    }
    if (entry.isFile()) {
        return true;
    }
    if (!entry.isSymbolicLink()) {
        return false;
    }

    return Boolean((await statEntry(path))?.isFile());
}

async function isScannableDirectory(entry: Dirent, path: string): Promise<boolean> {
    if (entry.name.startsWith(".")) {
        return false;
    }
    if (entry.isDirectory()) {
        return true;
    }
    if (!entry.isSymbolicLink()) {
        return false;
    }

    return Boolean((await statEntry(path))?.isDirectory());
}

async function scanSkillFiles(
    dir: string,
    files: string[],
    visitedDirs: Set<string> = new Set(),
): Promise<void> {
    const canonicalDir = await maybeRealpath(dir);
    if (canonicalDir) {
        if (visitedDirs.has(canonicalDir)) {
            return;
        }
        visitedDirs.add(canonicalDir);
    }

    const entries = await openDirectory(dir);
    for await (const entry of entries) {
        const entryPath = join(dir, entry.name);
        if (await isSkillFile(entry, entryPath)) {
            files.push(entryPath);
        }
        if (await isScannableDirectory(entry, entryPath)) {
            await scanSkillFiles(entryPath, files, visitedDirs);
        }
    }
}

async function findSkillFiles(root: string, optional = false): Promise<string[]> {
    const files: string[] = [];
    try {
        await scanSkillFiles(root, files);
    } catch (error) {
        if (optional && isNotFoundError(error)) {
            return [];
        }
        throw error;
    }
    return files.sort((a, b) => a.localeCompare(b));
}

export function extract(locations: SkillLocation[]): Observable<RawSkill> {
    return from(locations).pipe(
        mergeMap(({ name, root, optional, tags, sourceConfig }) =>
            defer(async () => {
                const files = await findSkillFiles(root, optional);
                return files.map(
                    (filePath): RawSkill => ({
                        locationName: name,
                        locationRoot: root,
                        filePath,
                        locationTags: tags,
                        locationSourceConfig: sourceConfig,
                    }),
                );
            }).pipe(mergeMap((items) => from(items))),
        ),
    );
}
