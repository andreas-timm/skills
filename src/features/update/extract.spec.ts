import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { lastValueFrom, toArray } from "rxjs";
import { extract } from "./extract";

async function writeSkill(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "# Skill\n", "utf-8");
}

describe("extract", () => {
    it("discovers SKILL.md files with native filesystem discovery", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-extract-test-"));
        try {
            await writeSkill(join(root, "beta", "SKILL.md"));
            await writeSkill(join(root, "alpha", "nested", "SKILL.md"));
            await writeSkill(join(root, ".hidden", "SKILL.md"));
            await writeSkill(join(root, "visible", ".hidden", "SKILL.md"));

            const symlinkTarget = join(root, "target.md");
            await writeFile(symlinkTarget, "# Symlinked Skill\n", "utf-8");
            await mkdir(join(root, "linked"), { recursive: true });
            await symlink(symlinkTarget, join(root, "linked", "SKILL.md"));

            const sourceConfig = {
                source: {
                    ignore: [join(root, "beta", "**")],
                },
            };
            const rows = await lastValueFrom(
                extract([{ name: "packages", root, tags: ["review"], sourceConfig }]).pipe(
                    toArray(),
                ),
            );

            expect(rows).toEqual([
                {
                    locationName: "packages",
                    locationRoot: root,
                    filePath: join(root, "alpha", "nested", "SKILL.md"),
                    locationTags: ["review"],
                    locationSourceConfig: sourceConfig,
                },
                {
                    locationName: "packages",
                    locationRoot: root,
                    filePath: join(root, "beta", "SKILL.md"),
                    locationTags: ["review"],
                    locationSourceConfig: sourceConfig,
                },
                {
                    locationName: "packages",
                    locationRoot: root,
                    filePath: join(root, "linked", "SKILL.md"),
                    locationTags: ["review"],
                    locationSourceConfig: sourceConfig,
                },
            ]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
