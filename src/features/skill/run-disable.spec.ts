import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shortSkillId } from "@features/skill/id";
import { createDeterministicSkillZip } from "@features/zip/deterministic-zip";
import { disableInstalledSkill } from "./run-disable.ts";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "skills-disable-"));
    tempDirs.push(dir);
    return dir;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function writeInstalledSkill(
    projectDir: string,
    folderName: string,
    markdown: string,
): Promise<string> {
    const skillDir = path.join(projectDir, ".agents/skills", folderName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), markdown, "utf-8");
    return skillDir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("disableInstalledSkill", () => {
    test("moves an installed skill into the disabled skills folder by frontmatter name", async () => {
        const projectDir = await createTempProject();
        const skillDir = await writeInstalledSkill(
            projectDir,
            "demo-folder",
            "---\nname: demo-skill\ndescription: Demo\n---\n# Demo\n",
        );
        await mkdir(path.join(skillDir, "scripts"));
        await writeFile(path.join(skillDir, "scripts/setup.sh"), "echo setup");

        const result = await disableInstalledSkill("demo-skill", {
            cwd: projectDir,
        });
        const disabledSkillDir = path.join(projectDir, ".agents/disabled_skills/demo-folder");

        expect(result.skillName).toBe("demo-skill");
        expect(result.rootDir).toBe(skillDir);
        expect(result.targetDir).toBe(disabledSkillDir);
        expect(await pathExists(skillDir)).toBe(false);
        expect(await readFile(path.join(disabledSkillDir, "SKILL.md"), "utf-8")).toContain(
            "demo-skill",
        );
        expect(await readFile(path.join(disabledSkillDir, "scripts/setup.sh"), "utf-8")).toBe(
            "echo setup",
        );
    });

    test("moves an installed skill by short id", async () => {
        const projectDir = await createTempProject();
        const skillDir = await writeInstalledSkill(
            projectDir,
            "demo-skill",
            "---\nname: demo-skill\n---\n# Demo\n",
        );
        const zip = await createDeterministicSkillZip({ rootDir: skillDir });

        await disableInstalledSkill(shortSkillId(zip.sha256), {
            cwd: projectDir,
        });

        expect(await pathExists(skillDir)).toBe(false);
        expect(await pathExists(path.join(projectDir, ".agents/disabled_skills/demo-skill"))).toBe(
            true,
        );
    });

    test("leaves the installed skill in place when the disabled target already exists", async () => {
        const projectDir = await createTempProject();
        const skillDir = await writeInstalledSkill(
            projectDir,
            "demo-skill",
            "---\nname: demo-skill\n---\n# Demo\n",
        );
        await mkdir(path.join(projectDir, ".agents/disabled_skills/demo-skill"), {
            recursive: true,
        });

        await expect(disableInstalledSkill("demo-skill", { cwd: projectDir })).rejects.toThrow(
            "Disabled skill already exists",
        );

        expect(await pathExists(skillDir)).toBe(true);
    });
});
