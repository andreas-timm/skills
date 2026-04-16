import type { LocationSourceConfigMap, RawSkill } from "@features/update/types";
import { $ } from "bun";
import { defer, from, mergeMap, type Observable } from "rxjs";

export type SkillLocation = {
    name: string;
    root: string;
    tags?: string[];
    sourceConfig?: LocationSourceConfigMap;
};

export function extract(locations: SkillLocation[]): Observable<RawSkill> {
    return from(locations).pipe(
        mergeMap(({ name, root, tags, sourceConfig }) =>
            defer(async () => {
                const scan = await $`fd -g SKILL.md ${root}`.nothrow().quiet();
                if (scan.exitCode !== 0) {
                    throw new Error(`fd failed: ${scan.stderr.toString()}`);
                }
                const files = scan.stdout
                    .toString()
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean);
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
