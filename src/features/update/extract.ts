import { opendir } from "node:fs/promises";
import { join } from "node:path";
import type { LocationSourceConfigMap, RawSkill } from "@features/update/types";
import { defer, from, mergeMap, type Observable } from "rxjs";

export type SkillLocation = {
    name: string;
    root: string;
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

async function scanSkillFiles(dir: string, files: string[]): Promise<void> {
    const entries = await openDirectory(dir);
    for await (const entry of entries) {
        const entryPath = join(dir, entry.name);
        if (entry.name === SKILL_FILE_NAME && (entry.isFile() || entry.isSymbolicLink())) {
            files.push(entryPath);
        }
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
            await scanSkillFiles(entryPath, files);
        }
    }
}

async function findSkillFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    await scanSkillFiles(root, files);
    return files.sort((a, b) => a.localeCompare(b));
}

export function extract(locations: SkillLocation[]): Observable<RawSkill> {
    return from(locations).pipe(
        mergeMap(({ name, root, tags, sourceConfig }) =>
            defer(async () => {
                const files = await findSkillFiles(root);
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
