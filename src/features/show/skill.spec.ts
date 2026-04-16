import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shortSkillId } from "@features/skill/id";
import { createDeterministicSkillZip } from "@features/zip/deterministic-zip";
import { parse as parseYaml } from "yaml";
import type { SkillOccurrence } from "./query";
import {
    formatNameGroupTextOutput,
    formatShowSkillTextOutput,
    getInstalledSkillOutput,
    type ShowSkillOutput,
} from "./skill";

const tempRoots: string[] = [];

async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "skills-show-installed-"));
    tempRoots.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function skillOccurrence(overrides: Partial<SkillOccurrence> = {}): SkillOccurrence {
    return {
        source_id: "source-main-id",
        source_name: "source-main",
        source_git: false,
        source_remote: null,
        source_branch: null,
        source_commit: null,
        source_date: "2026-04-20T10:30:00.000Z",
        location: "packages",
        subpath: "skills/demo/v3",
        ...overrides,
    };
}

function showSkillOutput(overrides: Partial<ShowSkillOutput> = {}): ShowSkillOutput {
    return {
        id: "abc12345",
        full_id: "abc12345-full",
        version: null,
        date: "2026-04-20T10:30:00.000Z",
        version_order: 3,
        name: "demo-skill",
        description: "Demo skill",
        metadata: {},
        fallback: false,
        status: null,
        rating: null,
        tags: [],
        note: null,
        source: "source-main",
        location: "packages",
        subpath: "skills/demo/v3",
        occurrences: [skillOccurrence()],
        related_versions: [],
        path: "/tmp/demo-skill/SKILL.md",
        content: "# Demo\nBody\n",
        ...overrides,
    };
}

describe("formatShowSkillTextOutput", () => {
    it("omits the selected version label from duplicate occurrence rows", () => {
        const output = formatShowSkillTextOutput(
            showSkillOutput({
                version: "2.0.0",
                version_order: 4,
                occurrences: [
                    skillOccurrence(),
                    skillOccurrence({
                        source_name: "source-copy",
                        source_date: "2026-04-21T10:30:00.000Z",
                        location: "archive",
                        subpath: "skills/demo/copy",
                    }),
                ],
                related_versions: [
                    {
                        id: "v1",
                        version: "1.0.0",
                        version_order: 1,
                        date: "2026-04-18T10:30:00.000Z",
                        location: "archive",
                        source: "source-old",
                        subpath: "skills/demo/v1",
                    },
                ],
            }),
        );

        const parsed = parseYaml(output);
        expect(parsed).toMatchObject({
            version: "2.0.0",
        });
        expect(parsed.duplicates).toEqual([
            {
                location: "archive",
                source: "source-copy",
                subpath: "skills/demo/copy",
                date: "2026-04-21 10:30",
            },
        ]);
    });

    it("renders show output with calculated version and skill_content literal", () => {
        const output = formatShowSkillTextOutput(
            showSkillOutput({
                occurrences: [
                    skillOccurrence(),
                    skillOccurrence({
                        location: "archive",
                        source_name: "source-old",
                        source_date: "2026-04-18T10:30:00.000Z",
                        subpath: "skills/demo/v1",
                    }),
                    skillOccurrence({
                        location: "legacy",
                        source_name: "source-mid",
                        source_date: "2026-04-19T10:30:00.000Z",
                        subpath: "skills/demo/v2",
                    }),
                ],
            }),
        );

        expect(output).toBe(`id: abc12345
version: v3
name: demo-skill
description: Demo skill
location: packages
source: source-main
subpath: skills/demo/v3
path: /tmp/demo-skill/SKILL.md
date: 2026-04-20 10:30
duplicates:
  - location: archive
    source: source-old
    subpath: skills/demo/v1
    date: 2026-04-18 10:30
  - location: legacy
    source: source-mid
    subpath: skills/demo/v2
    date: 2026-04-19 10:30
skill_content: |-
  # Demo
  Body
`);
        expect(parseYaml(output)).toMatchObject({
            id: "abc12345",
            version: "v3",
            subpath: "skills/demo/v3",
            duplicates: [
                {
                    location: "archive",
                    source: "source-old",
                    subpath: "skills/demo/v1",
                    date: "2026-04-18 10:30",
                },
                {
                    location: "legacy",
                    source: "source-mid",
                    subpath: "skills/demo/v2",
                    date: "2026-04-19 10:30",
                },
            ],
            skill_content: "# Demo\nBody",
        });
        expect(parseYaml(output)).not.toHaveProperty("approval");
        expect(parseYaml(output)).not.toHaveProperty("status");
        expect(parseYaml(output)).not.toHaveProperty("fallback_parser");
    });

    it("renders fallback_parser only when the fallback parser was used", () => {
        const fallbackOutput = formatShowSkillTextOutput(
            showSkillOutput({
                fallback: true,
            }),
        );
        const normalOutput = formatShowSkillTextOutput(
            showSkillOutput({
                fallback: false,
            }),
        );

        expect(parseYaml(fallbackOutput)).toMatchObject({
            fallback_parser: "yes",
        });
        expect(parseYaml(normalOutput)).not.toHaveProperty("fallback_parser");
    });

    it("renders status when the selected skill has one", () => {
        const output = formatShowSkillTextOutput(
            showSkillOutput({
                status: "approved",
            }),
        );

        expect(parseYaml(output)).toMatchObject({
            status: "approved",
        });
        expect(parseYaml(output)).not.toHaveProperty("approval");
    });

    it("renders duplicates when there is at least one extra occurrence", () => {
        const output = formatShowSkillTextOutput(
            showSkillOutput({
                occurrences: [
                    skillOccurrence(),
                    skillOccurrence({
                        location: "legacy",
                        source_name: "source-mid",
                        source_date: "2026-04-19T10:30:00.000Z",
                        subpath: "skills/demo/v2",
                    }),
                ],
            }),
        );

        expect(parseYaml(output)).toMatchObject({
            duplicates: [
                {
                    location: "legacy",
                    source: "source-mid",
                    subpath: "skills/demo/v2",
                    date: "2026-04-19 10:30",
                },
            ],
        });
    });
});

describe("formatNameGroupTextOutput", () => {
    it("renders each version with location, source, and date", () => {
        expect(
            formatNameGroupTextOutput({
                name: "demo-skill",
                versions: [showSkillOutput()],
            }),
        ).toBe(`name: demo-skill
versions:
  - id: abc12345
    version: v3
    location: packages
    source: source-main
    date: 2026-04-20 10:30
`);
    });
});

describe("getInstalledSkillOutput", () => {
    it("resolves installed skills using the same local inventory as skills ls", async () => {
        const projectDir = await createTempProject();
        const skillDir = join(projectDir, ".agents", "skills", "local-demo");
        const skillMarkdown = `---
name: local-demo
description: Local demo skill.
version: 2.0.0
---
# Local Demo
`;
        await mkdir(skillDir, { recursive: true });
        const skillPath = join(skillDir, "SKILL.md");
        await writeFile(skillPath, skillMarkdown, "utf-8");
        const modifiedAt = new Date("2026-04-22T08:15:00.000Z");
        await utimes(skillPath, modifiedAt, modifiedAt);

        const zip = await createDeterministicSkillZip({ rootDir: skillDir });
        const shortId = shortSkillId(zip.sha256);

        const byShortId = await getInstalledSkillOutput(shortId, projectDir);
        expect(byShortId).toMatchObject({
            id: shortId,
            full_id: zip.sha256,
            version: "2.0.0",
            version_order: 1,
            name: "local-demo",
            description: "Local demo skill.",
            date: modifiedAt.toISOString(),
            location: projectDir,
            source: "installed",
            subpath: ".agents/skills/local-demo",
            path: skillPath,
            content: skillMarkdown,
            occurrences: [
                {
                    source_date: modifiedAt.toISOString(),
                    location: projectDir,
                },
            ],
        });

        await expect(
            getInstalledSkillOutput("local-demo@2.0.0", projectDir),
        ).resolves.toMatchObject({
            full_id: zip.sha256,
        });
    });
});
