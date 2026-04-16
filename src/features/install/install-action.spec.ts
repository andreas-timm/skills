import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shortSkillId } from "@features/skill/id";
import { createDeterministicSkillZip } from "@features/zip/deterministic-zip";
import { installSkill } from "./install-action";

async function makeTempDir(prefix: string): Promise<string> {
    return mkdtemp(path.join(tmpdir(), prefix));
}

async function writeSkill(rootDir: string, skillMarkdown: string): Promise<void> {
    await mkdir(rootDir, { recursive: true });
    await writeFile(path.join(rootDir, "SKILL.md"), skillMarkdown, "utf-8");
}

async function createIndexedSkillFixture(
    options: { approved?: "approved" | "ignore" | null; location?: string } = {},
): Promise<{
    root: string;
    dbPath: string;
    location: string;
    locationRoot: string;
    projectDir: string;
    skillDir: string;
    skillId: string;
    shortId: string;
}> {
    const root = await makeTempDir("skills-install-indexed-");
    const location = options.location ?? "local";
    const locationRoot = path.join(root, "location");
    const projectDir = path.join(root, "project");
    const skillDir = path.join(locationRoot, "source", "demo");
    await writeSkill(skillDir, "---\nname: demo-skill\ndescription: Demo\n---\n\n# Demo\n");

    const zip = await createDeterministicSkillZip({ rootDir: skillDir });
    const shortId = shortSkillId(zip.sha256);
    const dbPath = path.join(root, "skills.sqlite");
    const db = new Database(dbPath, { create: true });
    try {
        db.run(`
            CREATE TABLE sources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                root_subpath TEXT NOT NULL DEFAULT '',
                git INTEGER NOT NULL DEFAULT 0,
                date TEXT
            );
            CREATE TABLE skills (
                id TEXT PRIMARY KEY,
                short_id TEXT NOT NULL,
                name TEXT,
                version TEXT,
                version_order INTEGER NOT NULL,
                approved TEXT
            );
            CREATE TABLE skill_occurrences (
                skill_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                subpath TEXT NOT NULL,
                location TEXT NOT NULL,
                PRIMARY KEY (skill_id, source_id, subpath)
            );
        `);
        db.query(
            `INSERT INTO sources (id, name, git, date)
             VALUES ($id, $name, $git, $date)`,
        ).run({
            $id: "source-1",
            $name: "source",
            $git: 0,
            $date: "2026-04-24T00:00:00.000Z",
        });
        db.query(
            `INSERT INTO skills (id, short_id, name, version, version_order, approved)
             VALUES ($id, $short_id, $name, $version, $version_order, $approved)`,
        ).run({
            $id: zip.sha256,
            $short_id: shortId,
            $name: "demo-skill",
            $version: null,
            $version_order: 1,
            $approved: options.approved ?? null,
        });
        db.query(
            `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
             VALUES ($skill_id, $source_id, $subpath, $location)`,
        ).run({
            $skill_id: zip.sha256,
            $source_id: "source-1",
            $subpath: "source/demo",
            $location: location,
        });
    } finally {
        db.close();
    }

    return {
        root,
        dbPath,
        location,
        locationRoot,
        projectDir,
        skillDir,
        skillId: zip.sha256,
        shortId,
    };
}

describe("installSkill", () => {
    it("extracts a forced direct skill path into .agents/skills/<name>", async () => {
        const sourceDir = await makeTempDir("skills-install-source-");
        const projectDir = await makeTempDir("skills-install-project-");
        try {
            await writeSkill(
                sourceDir,
                "---\nname: demo-skill\ndescription: Demo\n---\n\n# Demo\n",
            );
            await mkdir(path.join(sourceDir, "scripts"));
            await writeFile(
                path.join(sourceDir, "scripts", "setup.sh"),
                "#!/usr/bin/env bash\necho setup\n",
                "utf-8",
            );

            const result = await installSkill({
                skill: sourceDir,
                cwd: projectDir,
                force: true,
            });

            expect(result.skillName).toBe("demo-skill");
            expect(result.entries).toEqual(["SKILL.md", "scripts/setup.sh"]);
            expect(result.targetDir).toBe(path.join(projectDir, ".agents", "skills", "demo-skill"));
            await expect(
                readFile(path.join(result.targetDir, "SKILL.md"), "utf-8"),
            ).resolves.toContain("name: demo-skill");
            await expect(
                readFile(path.join(result.targetDir, "scripts", "setup.sh"), "utf-8"),
            ).resolves.toContain("echo setup");
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
            await rm(projectDir, { recursive: true, force: true });
        }
    });

    it("extracts a forced direct skill path into global agent skills folders", async () => {
        const sourceDir = await makeTempDir("skills-install-source-");
        const projectDir = await makeTempDir("skills-install-project-");
        const homeDir = await makeTempDir("skills-install-home-");
        try {
            await writeSkill(
                sourceDir,
                "---\nname: demo-skill\ndescription: Demo\n---\n\n# Demo\n",
            );

            const cases: Array<{
                global: boolean | string;
                targetSubpath: string;
            }> = [
                { global: true, targetSubpath: ".agents/skills" },
                { global: "default", targetSubpath: ".agents/skills" },
                { global: "codex", targetSubpath: ".codex/skills" },
                { global: "claude", targetSubpath: ".claude/skills" },
                { global: "gemini", targetSubpath: ".gemini/skills" },
                {
                    global: "antigravity",
                    targetSubpath: ".gemini/antigravity/skills",
                },
                { global: "pi", targetSubpath: ".pi/agent/skills" },
                {
                    global: "openode",
                    targetSubpath: ".config/openode/skills",
                },
            ];

            for (const testCase of cases) {
                const result = await installSkill({
                    skill: sourceDir,
                    cwd: projectDir,
                    force: true,
                    global: testCase.global,
                    homeDir,
                });

                expect(result.targetDir).toBe(
                    path.join(homeDir, testCase.targetSubpath, "demo-skill"),
                );
                await expect(
                    readFile(path.join(result.targetDir, "SKILL.md"), "utf-8"),
                ).resolves.toContain("name: demo-skill");
                await rm(result.targetDir, { recursive: true, force: true });
            }
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
            await rm(projectDir, { recursive: true, force: true });
            await rm(homeDir, { recursive: true, force: true });
        }
    });

    it("rejects unknown global agent names", async () => {
        const sourceDir = await makeTempDir("skills-install-source-");
        const projectDir = await makeTempDir("skills-install-project-");
        const homeDir = await makeTempDir("skills-install-home-");
        try {
            await writeSkill(
                sourceDir,
                "---\nname: demo-skill\ndescription: Demo\n---\n\n# Demo\n",
            );

            await expect(
                installSkill({
                    skill: sourceDir,
                    cwd: projectDir,
                    force: true,
                    global: "unknown",
                    homeDir,
                }),
            ).rejects.toThrow("Unknown global user agent");
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
            await rm(projectDir, { recursive: true, force: true });
            await rm(homeDir, { recursive: true, force: true });
        }
    });

    it("does not overwrite an existing installed skill", async () => {
        const sourceDir = await makeTempDir("skills-install-source-");
        const projectDir = await makeTempDir("skills-install-project-");
        try {
            await writeSkill(
                sourceDir,
                "---\nname: demo-skill\ndescription: Demo\n---\n\n# Demo\n",
            );
            const installedDir = path.join(projectDir, ".agents", "skills", "demo-skill");
            await mkdir(installedDir, { recursive: true });
            await writeFile(path.join(installedDir, "SKILL.md"), "existing", "utf-8");

            await expect(
                installSkill({
                    skill: sourceDir,
                    cwd: projectDir,
                    force: true,
                }),
            ).rejects.toThrow("Skill already installed");
            await expect(readFile(path.join(installedDir, "SKILL.md"), "utf-8")).resolves.toBe(
                "existing",
            );
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
            await rm(projectDir, { recursive: true, force: true });
        }
    });

    it("uses fallback frontmatter parsing for descriptions with colons", async () => {
        const sourceDir = await makeTempDir("skills-install-source-");
        const projectDir = await makeTempDir("skills-install-project-");
        try {
            await writeSkill(
                sourceDir,
                `---
name: django-verification
description: Verification loop for Django projects: migrations, linting, tests.
---

# Django
`,
            );

            const result = await installSkill({
                skill: sourceDir,
                cwd: projectDir,
                force: true,
            });

            expect(result.skillName).toBe("django-verification");
            await expect(
                readFile(path.join(result.targetDir, "SKILL.md"), "utf-8"),
            ).resolves.toContain("Verification loop");
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
            await rm(projectDir, { recursive: true, force: true });
        }
    });

    it("rejects skill names that cannot be used as a local subfolder", async () => {
        const sourceDir = await makeTempDir("skills-install-source-");
        const projectDir = await makeTempDir("skills-install-project-");
        try {
            await writeSkill(sourceDir, "---\nname: ../escape\ndescription: Demo\n---\n\n# Demo\n");

            await expect(
                installSkill({
                    skill: sourceDir,
                    cwd: projectDir,
                    force: true,
                }),
            ).rejects.toThrow("Invalid skill name");
        } finally {
            await rm(sourceDir, { recursive: true, force: true });
            await rm(projectDir, { recursive: true, force: true });
        }
    });

    it("installs an approved indexed skill by default", async () => {
        const fixture = await createIndexedSkillFixture({
            approved: "approved",
        });
        try {
            const result = await installSkill({
                skill: fixture.shortId,
                cwd: fixture.projectDir,
                dbPath: fixture.dbPath,
                locationRoots: { [fixture.location]: fixture.locationRoot },
            });

            expect(result.sha256).toBe(fixture.skillId);
            await expect(
                readFile(path.join(result.targetDir, "SKILL.md"), "utf-8"),
            ).resolves.toContain("name: demo-skill");
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it("treats approved locations as install approval", async () => {
        const fixture = await createIndexedSkillFixture({
            location: "trusted",
        });
        try {
            const result = await installSkill({
                skill: fixture.shortId,
                cwd: fixture.projectDir,
                dbPath: fixture.dbPath,
                locationRoots: { [fixture.location]: fixture.locationRoot },
                approvedLocations: ["trusted"],
            });

            expect(result.skillName).toBe("demo-skill");
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it("rejects an unapproved indexed skill by default", async () => {
        const fixture = await createIndexedSkillFixture();
        try {
            await expect(
                installSkill({
                    skill: fixture.shortId,
                    cwd: fixture.projectDir,
                    dbPath: fixture.dbPath,
                    locationRoots: {
                        [fixture.location]: fixture.locationRoot,
                    },
                }),
            ).rejects.toThrow("is not approved");

            await expect(
                readFile(
                    path.join(fixture.projectDir, ".agents", "skills", "demo-skill", "SKILL.md"),
                    "utf-8",
                ),
            ).rejects.toThrow();
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it("allows force installing an unapproved indexed skill", async () => {
        const fixture = await createIndexedSkillFixture();
        try {
            const result = await installSkill({
                skill: fixture.shortId,
                cwd: fixture.projectDir,
                dbPath: fixture.dbPath,
                locationRoots: { [fixture.location]: fixture.locationRoot },
                force: true,
            });

            expect(result.skillName).toBe("demo-skill");
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });

    it("does not let location approval override an ignored skill", async () => {
        const fixture = await createIndexedSkillFixture({
            approved: "ignore",
            location: "trusted",
        });
        try {
            await expect(
                installSkill({
                    skill: fixture.shortId,
                    cwd: fixture.projectDir,
                    dbPath: fixture.dbPath,
                    locationRoots: {
                        [fixture.location]: fixture.locationRoot,
                    },
                    approvedLocations: ["trusted"],
                }),
            ).rejects.toThrow("marked ignore");
        } finally {
            await rm(fixture.root, { recursive: true, force: true });
        }
    });
});
