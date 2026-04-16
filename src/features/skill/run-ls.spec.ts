import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_SKILLS_DIR_LIST } from "@features/agent/skills-dir";
import { shortSkillId } from "@features/skill/id";
import { load } from "@features/update/load";
import { createDeterministicSkillZip } from "@features/zip/deterministic-zip";
import { of } from "rxjs";
import {
    listIndexedInstalledSkills,
    listInstalledSkills,
    renderInstalledSkills,
    resolveInstalledSkillRows,
    resolveInstalledSkillSearchRoots,
} from "./run-ls.ts";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "agent-history-list-"));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("listInstalledSkills", () => {
    test("returns an empty list when no project skills directory exists", async () => {
        const projectDir = await createTempProject();

        expect(await listInstalledSkills(projectDir)).toEqual([]);
    });

    test("discovers installed skills from SKILL.md frontmatter", async () => {
        const projectDir = await createTempProject();
        const skillsDir = join(projectDir, ".agents/skills");
        await mkdir(join(skillsDir, "beta"), { recursive: true });
        await mkdir(join(skillsDir, "alpha"), { recursive: true });
        await writeFile(join(skillsDir, ".npm-skills-manifest.json"), "{}");
        await writeFile(
            join(skillsDir, "beta", "SKILL.md"),
            "---\nname: beta-skill\ndescription: Handles beta work.\n---\n# Beta\n",
        );
        await writeFile(join(skillsDir, "alpha", "SKILL.md"), "# Alpha\n");
        const alphaModifiedAt = new Date("2026-04-20T10:00:00.000Z");
        const betaModifiedAt = new Date("2026-04-21T11:00:00.000Z");
        await utimes(join(skillsDir, "alpha", "SKILL.md"), alphaModifiedAt, alphaModifiedAt);
        await utimes(join(skillsDir, "beta", "SKILL.md"), betaModifiedAt, betaModifiedAt);
        const alphaZip = await createDeterministicSkillZip({
            rootDir: join(skillsDir, "alpha"),
        });
        const betaZip = await createDeterministicSkillZip({
            rootDir: join(skillsDir, "beta"),
        });

        expect(await listInstalledSkills(projectDir)).toEqual([
            {
                id: alphaZip.sha256,
                modifiedAt: alphaModifiedAt,
                name: "alpha",
                path: join(skillsDir, "alpha", "SKILL.md"),
                rootDir: join(skillsDir, "alpha"),
            },
            {
                description: "Handles beta work.",
                id: betaZip.sha256,
                modifiedAt: betaModifiedAt,
                name: "beta-skill",
                path: join(skillsDir, "beta", "SKILL.md"),
                rootDir: join(skillsDir, "beta"),
            },
        ]);
    });

    test("discovers disabled project skills when requested", async () => {
        const projectDir = await createTempProject();
        const disabledSkillsDir = join(projectDir, ".agents/disabled_skills");
        const disabledSkillDir = join(disabledSkillsDir, "demo");
        await mkdir(disabledSkillDir, { recursive: true });
        await writeFile(
            join(disabledSkillDir, "SKILL.md"),
            "---\nname: disabled-demo\ndescription: Disabled demo.\n---\n# Demo\n",
        );
        const modifiedAt = new Date("2026-04-24T12:00:00.000Z");
        await utimes(join(disabledSkillDir, "SKILL.md"), modifiedAt, modifiedAt);
        const zip = await createDeterministicSkillZip({
            rootDir: disabledSkillDir,
        });

        expect(await listInstalledSkills(projectDir)).toEqual([]);
        expect(await listInstalledSkills(projectDir, { includeDisabled: true })).toEqual([
            {
                description: "Disabled demo.",
                disabled: true,
                id: zip.sha256,
                modifiedAt,
                name: "disabled-demo",
                path: join(disabledSkillDir, "SKILL.md"),
                rootDir: disabledSkillDir,
            },
        ]);
    });

    test("discovers global skills from user-level agent folders", async () => {
        const projectDir = await createTempProject();
        const homeDir = await createTempProject();
        const localSkillsDir = join(projectDir, ".agents/skills");
        const agentSkillDir = join(homeDir, ".agents/skills/agent-demo");
        const codexSkillDir = join(homeDir, ".codex/skills/codex-demo");
        const geminiSkillDir = join(homeDir, ".gemini/antigravity/skills/gemini-demo");
        await mkdir(join(localSkillsDir, "local-demo"), { recursive: true });
        await mkdir(agentSkillDir, { recursive: true });
        await mkdir(codexSkillDir, { recursive: true });
        await mkdir(geminiSkillDir, { recursive: true });
        await writeFile(
            join(localSkillsDir, "local-demo", "SKILL.md"),
            "---\nname: local-demo\n---\n# Local\n",
        );
        await writeFile(
            join(agentSkillDir, "SKILL.md"),
            "---\nname: agent-demo\ndescription: Agent skill.\n---\n# Agent\n",
        );
        await writeFile(
            join(codexSkillDir, "SKILL.md"),
            "---\nname: codex-demo\ndescription: Codex skill.\n---\n# Codex\n",
        );
        await writeFile(
            join(geminiSkillDir, "SKILL.md"),
            "---\nname: gemini-demo\ndescription: Gemini skill.\n---\n# Gemini\n",
        );
        const agentModifiedAt = new Date("2026-04-21T08:00:00.000Z");
        const codexModifiedAt = new Date("2026-04-22T09:00:00.000Z");
        const geminiModifiedAt = new Date("2026-04-23T10:00:00.000Z");
        await utimes(join(agentSkillDir, "SKILL.md"), agentModifiedAt, agentModifiedAt);
        await utimes(join(codexSkillDir, "SKILL.md"), codexModifiedAt, codexModifiedAt);
        await utimes(join(geminiSkillDir, "SKILL.md"), geminiModifiedAt, geminiModifiedAt);
        const agentZip = await createDeterministicSkillZip({
            rootDir: agentSkillDir,
        });
        const codexZip = await createDeterministicSkillZip({
            rootDir: codexSkillDir,
        });
        const geminiZip = await createDeterministicSkillZip({
            rootDir: geminiSkillDir,
        });

        expect(await listInstalledSkills(projectDir, { global: true, homeDir })).toEqual([
            {
                description: "Agent skill.",
                id: agentZip.sha256,
                modifiedAt: agentModifiedAt,
                name: "agent-demo",
                path: join(agentSkillDir, "SKILL.md"),
                rootDir: agentSkillDir,
            },
            {
                description: "Codex skill.",
                id: codexZip.sha256,
                modifiedAt: codexModifiedAt,
                name: "codex-demo",
                path: join(codexSkillDir, "SKILL.md"),
                rootDir: codexSkillDir,
            },
            {
                description: "Gemini skill.",
                id: geminiZip.sha256,
                modifiedAt: geminiModifiedAt,
                name: "gemini-demo",
                path: join(geminiSkillDir, "SKILL.md"),
                rootDir: geminiSkillDir,
            },
        ]);
    });

    test("hydrates installed skills from indexed rows by zip id", async () => {
        const projectDir = await createTempProject();
        const skillsDir = join(projectDir, ".agents/skills");
        const skillDir = join(skillsDir, "demo");
        await mkdir(skillDir, { recursive: true });
        await writeFile(
            join(skillDir, "SKILL.md"),
            "---\nname: local-demo\ndescription: Local description.\n---\n# Demo\n",
        );

        const installedSkills = await listInstalledSkills(projectDir);
        const zip = await createDeterministicSkillZip({ rootDir: skillDir });
        const dbPath = join(projectDir, "skills.sqlite");
        await load(
            dbPath,
            of({
                source: {
                    id: "source-1",
                    name: "source-one",
                    rootSubpath: "",
                    git: false,
                    approved: null,
                    rating: null,
                    tags: [],
                    note: null,
                },
                skill: {
                    id: zip.sha256,
                    shortId: shortSkillId(zip.sha256),
                    version: "2.0.0",
                    date: "2026-04-20T00:00:00.000Z",
                    versionOrder: 0,
                    name: "indexed-demo",
                    description: "Indexed description.",
                    metadata: {},
                    fallback: false,
                    approved: "approved",
                    rating: null,
                    tags: [],
                    note: null,
                },
                occurrence: {
                    skillId: zip.sha256,
                    sourceId: "source-1",
                    location: "packages",
                    subpath: "source-one/demo",
                },
            }),
        );

        const rows = resolveInstalledSkillRows(
            installedSkills,
            await listIndexedInstalledSkills(installedSkills, dbPath),
        );

        expect(rows).toMatchObject([
            {
                id: shortSkillId(zip.sha256),
                date: "2026-04-20T00:00:00.000Z",
                name: "indexed-demo",
                version: "2.0.0",
                description: "Indexed description.",
                location: "packages",
                source_name: "source-one",
                status: "approved",
                version_count: 1,
                duplicate: 0,
            },
        ]);
    });
});

describe("resolveInstalledSkillSearchRoots", () => {
    test("uses the project skill folder by default", () => {
        expect(resolveInstalledSkillSearchRoots("/project")).toEqual(["/project/.agents/skills"]);
    });

    test("can include the project disabled skills folder", () => {
        expect(
            resolveInstalledSkillSearchRoots("/project", {
                includeDisabled: true,
            }),
        ).toEqual(["/project/.agents/skills", "/project/.agents/disabled_skills"]);
    });

    test("uses all user-level agent folders for global listings", () => {
        expect(
            resolveInstalledSkillSearchRoots("/project", {
                global: true,
                homeDir: "/home/user",
            }),
        ).toEqual([
            "/home/user/.agents/skills",
            "/home/user/.codex/skills",
            "/home/user/.claude/skills",
            "/home/user/.gemini/skills",
            "/home/user/.gemini/antigravity/skills",
            "/home/user/.pi/agent/skills",
            "/home/user/.config/openode/skills",
        ]);
        expect(AGENT_SKILLS_DIR_LIST).toHaveLength(7);
    });
});

describe("renderInstalledSkills", () => {
    test("uses the SKILL.md modified date for unindexed installed skills", () => {
        const modifiedAt = new Date("2026-04-22T08:15:00.000Z");
        const rows = resolveInstalledSkillRows(
            [
                {
                    description: "Build Bun CLIs.",
                    id: "1234567890abcdef",
                    modifiedAt,
                    name: "bun-cli",
                    path: "/project/.agents/skills/bun-cli/SKILL.md",
                    rootDir: "/project/.agents/skills/bun-cli",
                },
            ],
            [],
        );

        expect(rows[0]?.date).toBe(modifiedAt.toISOString());

        const output = renderInstalledSkills(rows, "/project", { width: 0 });
        expect(output).toContain("2026-04-22 08:15");
    });

    test("renders the shared skill list table", () => {
        const output = renderInstalledSkills(
            resolveInstalledSkillRows(
                [
                    {
                        description: "Build Bun CLIs.",
                        id: "1234567890abcdef",
                        modifiedAt: new Date("2026-04-22T08:15:00.000Z"),
                        name: "bun-cli",
                        path: "/project/.agents/skills/bun-cli/SKILL.md",
                        rootDir: "/project/.agents/skills/bun-cli",
                    },
                ],
                [],
            ),
            "/project",
            { width: 0 },
        );

        expect(output).toContain("12345678");
        expect(output).toContain("1|0");
        expect(output).toContain("bun-cli");
        expect(output).toContain("Build Bun CLIs.");
        expect(output).not.toContain("Installed skills in");
    });

    test("renders disabled skills with a disabled marker", () => {
        const output = renderInstalledSkills(
            resolveInstalledSkillRows(
                [
                    {
                        description: "Disabled local skill.",
                        disabled: true,
                        id: "1234567890abcdef",
                        modifiedAt: new Date("2026-04-24T12:00:00.000Z"),
                        name: "local-demo",
                        path: "/project/.agents/disabled_skills/local-demo/SKILL.md",
                        rootDir: "/project/.agents/disabled_skills/local-demo",
                    },
                ],
                [
                    {
                        full_id: "1234567890abcdef",
                        id: "12345678",
                        date: "2026-04-20T00:00:00.000Z",
                        version_order: 1,
                        version_count: 1,
                        duplicate: 0,
                        name: "indexed-demo",
                        version: null,
                        description: "Indexed description.",
                        location: "packages",
                        source_name: "source-one",
                        status: "approved",
                        rating: null,
                        tags: [],
                        note: null,
                    },
                ],
            ),
            "/project",
            { width: 0 },
        );

        expect(output).toContain("indexed-demo ✅ 🚫 disabled");
        expect(output).toContain("Indexed description.");
    });

    test("renders an empty message", () => {
        expect(renderInstalledSkills([], "/project")).toBe(
            "No installed skills found in /project/.agents/skills\n",
        );
    });

    test("renders an empty global message with every searched folder", () => {
        expect(
            renderInstalledSkills([], "/project", {
                global: true,
                homeDir: "/home/user",
            }),
        ).toBe(
            [
                "No installed skills found in:",
                "- /home/user/.agents/skills",
                "- /home/user/.codex/skills",
                "- /home/user/.claude/skills",
                "- /home/user/.gemini/skills",
                "- /home/user/.gemini/antigravity/skills",
                "- /home/user/.pi/agent/skills",
                "- /home/user/.config/openode/skills",
                "",
            ].join("\n"),
        );
    });
});
