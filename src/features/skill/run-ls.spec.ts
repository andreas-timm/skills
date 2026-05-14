import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_DISABLED_SKILLS_DIR_LIST, AGENT_SKILLS_DIR_LIST } from "@features/agent/skills-dir";
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
        const agentSkillPath = await realpath(join(agentSkillDir, "SKILL.md"));
        const codexSkillPath = await realpath(join(codexSkillDir, "SKILL.md"));
        const geminiSkillPath = await realpath(join(geminiSkillDir, "SKILL.md"));
        const agentSkillRoot = await realpath(agentSkillDir);
        const codexSkillRoot = await realpath(codexSkillDir);
        const geminiSkillRoot = await realpath(geminiSkillDir);

        expect(await listInstalledSkills(projectDir, { global: true, homeDir })).toEqual([
            {
                description: "Agent skill.",
                id: agentZip.sha256,
                modifiedAt: agentModifiedAt,
                name: "agent-demo",
                path: agentSkillPath,
                rootDir: agentSkillRoot,
            },
            {
                description: "Codex skill.",
                id: codexZip.sha256,
                modifiedAt: codexModifiedAt,
                name: "codex-demo",
                path: codexSkillPath,
                rootDir: codexSkillRoot,
            },
            {
                description: "Gemini skill.",
                id: geminiZip.sha256,
                modifiedAt: geminiModifiedAt,
                name: "gemini-demo",
                path: geminiSkillPath,
                rootDir: geminiSkillRoot,
            },
        ]);
    });

    test("discovers disabled global skills when requested", async () => {
        const projectDir = await createTempProject();
        const homeDir = await createTempProject();
        const disabledSkillDir = join(homeDir, ".codex/disabled_skills/codex-disabled");
        await mkdir(disabledSkillDir, { recursive: true });
        await writeFile(
            join(disabledSkillDir, "SKILL.md"),
            "---\nname: codex-disabled\ndescription: Disabled Codex skill.\n---\n# Codex\n",
        );
        const modifiedAt = new Date("2026-05-14T09:00:00.000Z");
        await utimes(join(disabledSkillDir, "SKILL.md"), modifiedAt, modifiedAt);
        const zip = await createDeterministicSkillZip({
            rootDir: disabledSkillDir,
        });
        const skillPath = await realpath(join(disabledSkillDir, "SKILL.md"));
        const rootDir = await realpath(disabledSkillDir);

        expect(await listInstalledSkills(projectDir, { global: true, homeDir })).toEqual([]);
        expect(
            await listInstalledSkills(projectDir, {
                global: true,
                homeDir,
                includeDisabled: true,
            }),
        ).toEqual([
            {
                description: "Disabled Codex skill.",
                disabled: true,
                id: zip.sha256,
                modifiedAt,
                name: "codex-disabled",
                path: skillPath,
                rootDir,
            },
        ]);
    });

    test("deduplicates global skills by resolved SKILL.md source", async () => {
        const projectDir = await createTempProject();
        const homeDir = await createTempProject();
        const sourceSkillDir = join(projectDir, "source/git-commit");
        const claudeSkillsDir = join(homeDir, ".claude/skills");
        const piSkillsDir = join(homeDir, ".pi/agent/skills");
        const piSkillDir = join(piSkillsDir, "git-commit");
        await mkdir(sourceSkillDir, { recursive: true });
        await mkdir(claudeSkillsDir, { recursive: true });
        await mkdir(piSkillDir, { recursive: true });
        await writeFile(
            join(sourceSkillDir, "SKILL.md"),
            "---\nname: git-commit\ndescription: Commit messages.\n---\n# Commit\n",
        );
        await symlink(sourceSkillDir, join(claudeSkillsDir, "git-commit"), "dir");
        await symlink(join(sourceSkillDir, "SKILL.md"), join(piSkillDir, "SKILL.md"), "file");
        const modifiedAt = new Date("2026-05-07T19:47:28.000Z");
        await utimes(join(sourceSkillDir, "SKILL.md"), modifiedAt, modifiedAt);
        const zip = await createDeterministicSkillZip({
            rootDir: sourceSkillDir,
        });
        const sourcePath = await realpath(join(sourceSkillDir, "SKILL.md"));
        const sourceRootDir = await realpath(sourceSkillDir);

        const skills = await listInstalledSkills(projectDir, { global: true, homeDir });

        expect(skills).toEqual([
            {
                description: "Commit messages.",
                id: zip.sha256,
                modifiedAt,
                name: "git-commit",
                path: sourcePath,
                rootDir: sourceRootDir,
                sourceRootDir,
            },
        ]);
    });

    test("discovers skills from node_modules folders", async () => {
        const projectDir = await createTempProject();
        const localSkillDir = join(projectDir, ".agents/skills/local-demo");
        const scopedSkillDir = join(projectDir, "node_modules/@acme/tool/skills/alpha-node");
        const workspaceSkillDir = join(
            projectDir,
            "packages/app/node_modules/plain-tool/skills/beta-node",
        );
        const ignoredSkillDir = join(projectDir, "vendor/plain-tool/skills/ignored");
        await mkdir(localSkillDir, { recursive: true });
        await mkdir(scopedSkillDir, { recursive: true });
        await mkdir(workspaceSkillDir, { recursive: true });
        await mkdir(ignoredSkillDir, { recursive: true });
        await writeFile(join(localSkillDir, "SKILL.md"), "---\nname: local-demo\n---\n# Local\n");
        await writeFile(
            join(scopedSkillDir, "SKILL.md"),
            "---\nname: alpha-node\ndescription: Scoped package skill.\n---\n# Alpha\n",
        );
        await writeFile(
            join(workspaceSkillDir, "SKILL.md"),
            "---\nname: beta-node\ndescription: Plain package skill.\n---\n# Beta\n",
        );
        await writeFile(
            join(ignoredSkillDir, "SKILL.md"),
            "---\nname: ignored-node\n---\n# Ignored\n",
        );
        const alphaModifiedAt = new Date("2026-04-25T08:00:00.000Z");
        const betaModifiedAt = new Date("2026-04-26T09:00:00.000Z");
        await utimes(join(scopedSkillDir, "SKILL.md"), alphaModifiedAt, alphaModifiedAt);
        await utimes(join(workspaceSkillDir, "SKILL.md"), betaModifiedAt, betaModifiedAt);
        const alphaZip = await createDeterministicSkillZip({
            rootDir: scopedSkillDir,
        });
        const betaZip = await createDeterministicSkillZip({
            rootDir: workspaceSkillDir,
        });

        expect(await listInstalledSkills(projectDir, { nodeModules: true })).toEqual([
            {
                description: "Scoped package skill.",
                id: alphaZip.sha256,
                modifiedAt: alphaModifiedAt,
                name: "alpha-node",
                nodeModulePackageName: "@acme/tool",
                path: join(scopedSkillDir, "SKILL.md"),
                rootDir: scopedSkillDir,
            },
            {
                description: "Plain package skill.",
                id: betaZip.sha256,
                modifiedAt: betaModifiedAt,
                name: "beta-node",
                nodeModulePackageName: "plain-tool",
                path: join(workspaceSkillDir, "SKILL.md"),
                rootDir: workspaceSkillDir,
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

    test("can include disabled user-level agent folders for global listings", () => {
        expect(
            resolveInstalledSkillSearchRoots("/project", {
                global: true,
                homeDir: "/home/user",
                includeDisabled: true,
            }),
        ).toEqual([
            "/home/user/.agents/skills",
            "/home/user/.agents/disabled_skills",
            "/home/user/.codex/skills",
            "/home/user/.codex/disabled_skills",
            "/home/user/.claude/skills",
            "/home/user/.claude/disabled_skills",
            "/home/user/.gemini/skills",
            "/home/user/.gemini/disabled_skills",
            "/home/user/.gemini/antigravity/skills",
            "/home/user/.gemini/antigravity/disabled_skills",
            "/home/user/.pi/agent/skills",
            "/home/user/.pi/agent/disabled_skills",
            "/home/user/.config/openode/skills",
            "/home/user/.config/openode/disabled_skills",
        ]);
        expect(AGENT_DISABLED_SKILLS_DIR_LIST).toHaveLength(7);
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

    test("renders node_modules provenance while keeping indexed metadata", () => {
        const output = renderInstalledSkills(
            resolveInstalledSkillRows(
                [
                    {
                        description: "Node module skill.",
                        id: "1234567890abcdef",
                        modifiedAt: new Date("2026-04-25T08:00:00.000Z"),
                        name: "node-demo",
                        nodeModulePackageName: "@acme/tool",
                        path: "/project/node_modules/@acme/tool/skills/node-demo/SKILL.md",
                        rootDir: "/project/node_modules/@acme/tool/skills/node-demo",
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
                        name: "indexed-node-demo",
                        version: null,
                        description: "Indexed node description.",
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
            { width: 0, nodeModules: true },
        );

        expect(output).toContain("12345678");
        expect(output).toContain("indexed-node-demo ✅");
        expect(output).toContain("node_modules");
        expect(output).toContain("@acme/tool");
        expect(output).toContain("Indexed node description.");
    });

    test("renders resolved source provenance for global symlink skills", () => {
        const output = renderInstalledSkills(
            resolveInstalledSkillRows(
                [
                    {
                        description: "Commit messages.",
                        id: "1234567890abcdef",
                        modifiedAt: new Date("2026-05-07T19:47:28.000Z"),
                        name: "git-commit",
                        path: "/source/git-commit/SKILL.md",
                        rootDir: "/source/git-commit",
                        sourceRootDir: "/source/git-commit",
                    },
                ],
                [],
            ),
            "/project",
            { global: true, width: 0 },
        );

        expect(output).toContain("git-commit                          Commit messages.");
        expect(output).toContain("                              /source/git-commit");
        expect(output).not.toContain(" | source | ");
        expect(output).toContain("Commit messages.");
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

    test("renders an empty node_modules message", () => {
        expect(renderInstalledSkills([], "/project", { nodeModules: true })).toBe(
            "No node_modules skills found under /project\n",
        );
    });
});
