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
        const symlinkedSkillRoot = await mkdtemp(join(tmpdir(), "skills-extract-link-target-"));
        try {
            await writeSkill(join(root, "beta", "SKILL.md"));
            await writeSkill(join(root, "alpha", "nested", "SKILL.md"));
            await writeSkill(join(root, ".hidden", "SKILL.md"));
            await writeSkill(join(root, "visible", ".hidden", "SKILL.md"));

            const symlinkTarget = join(root, "target.md");
            await writeFile(symlinkTarget, "# Symlinked Skill\n", "utf-8");
            await mkdir(join(root, "linked"), { recursive: true });
            await symlink(symlinkTarget, join(root, "linked", "SKILL.md"));

            await writeSkill(join(symlinkedSkillRoot, "SKILL.md"));
            await symlink(symlinkedSkillRoot, join(root, "symlinked-skill"), "dir");

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
                {
                    locationName: "packages",
                    locationRoot: root,
                    filePath: join(root, "symlinked-skill", "SKILL.md"),
                    locationTags: ["review"],
                    locationSourceConfig: sourceConfig,
                },
            ]);
        } finally {
            await rm(root, { recursive: true, force: true });
            await rm(symlinkedSkillRoot, { recursive: true, force: true });
        }
    });

    it("skips missing optional locations", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-extract-test-"));
        try {
            const rows = await lastValueFrom(
                extract([
                    {
                        name: "agent:codex",
                        root: join(root, "missing"),
                        optional: true,
                    },
                ]).pipe(toArray()),
            );

            expect(rows).toEqual([]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("explains missing configured locations", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-extract-test-"));
        const missingRoot = join(root, "missing");
        try {
            await expect(
                lastValueFrom(
                    extract([
                        {
                            name: "agent-local",
                            root: missingRoot,
                            configPath: "~/.config/skills/config.toml",
                            configKey: "skills.locations.agent-local.dir",
                        },
                    ]).pipe(toArray()),
                ),
            ).rejects.toThrow(
                `Missing required skill location "agent-local": ${missingRoot} does not exist. This folder is configured in \`~/.config/skills/config.toml\` as \`skills.locations.agent-local.dir\`.`,
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
