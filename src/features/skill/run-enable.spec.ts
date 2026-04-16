import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shortSkillId } from "@features/skill/id";
import { createDeterministicSkillZip } from "@features/zip/deterministic-zip";
import { enableDisabledSkill } from "./run-enable.ts";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "skills-enable-"));
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

async function writeDisabledSkill(
    projectDir: string,
    folderName: string,
    markdown: string,
): Promise<string> {
    const skillDir = path.join(projectDir, ".agents/disabled_skills", folderName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), markdown, "utf-8");
    return skillDir;
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("enableDisabledSkill", () => {
    test("moves a disabled skill into the installed skills folder by frontmatter name", async () => {
        const projectDir = await createTempProject();
        const disabledSkillDir = await writeDisabledSkill(
            projectDir,
            "demo-folder",
            "---\nname: demo-skill\ndescription: Demo\n---\n# Demo\n",
        );
        await mkdir(path.join(disabledSkillDir, "scripts"));
        await writeFile(path.join(disabledSkillDir, "scripts/setup.sh"), "echo setup");

        const result = await enableDisabledSkill("demo-skill", {
            cwd: projectDir,
        });
        const skillDir = path.join(projectDir, ".agents/skills/demo-folder");

        expect(result.skillName).toBe("demo-skill");
        expect(result.rootDir).toBe(disabledSkillDir);
        expect(result.targetDir).toBe(skillDir);
        expect(await pathExists(disabledSkillDir)).toBe(false);
        expect(await pathExists(path.join(projectDir, ".agents/disabled_skills"))).toBe(false);
        expect(await readFile(path.join(skillDir, "SKILL.md"), "utf-8")).toContain("demo-skill");
        expect(await readFile(path.join(skillDir, "scripts/setup.sh"), "utf-8")).toBe("echo setup");
    });

    test("moves a disabled skill by short id and keeps disabled folder when another skill remains", async () => {
        const projectDir = await createTempProject();
        const disabledSkillDir = await writeDisabledSkill(
            projectDir,
            "demo-skill",
            "---\nname: demo-skill\n---\n# Demo\n",
        );
        await writeDisabledSkill(
            projectDir,
            "other-skill",
            "---\nname: other-skill\n---\n# Other\n",
        );
        const zip = await createDeterministicSkillZip({
            rootDir: disabledSkillDir,
        });

        await enableDisabledSkill(shortSkillId(zip.sha256), {
            cwd: projectDir,
        });

        expect(await pathExists(disabledSkillDir)).toBe(false);
        expect(await pathExists(path.join(projectDir, ".agents/skills/demo-skill"))).toBe(true);
        expect(await pathExists(path.join(projectDir, ".agents/disabled_skills"))).toBe(true);
    });

    test("leaves the disabled skill in place when the installed target already exists", async () => {
        const projectDir = await createTempProject();
        const disabledSkillDir = await writeDisabledSkill(
            projectDir,
            "demo-skill",
            "---\nname: demo-skill\n---\n# Demo\n",
        );
        await mkdir(path.join(projectDir, ".agents/skills/demo-skill"), {
            recursive: true,
        });

        await expect(enableDisabledSkill("demo-skill", { cwd: projectDir })).rejects.toThrow(
            "Installed skill already exists",
        );

        expect(await pathExists(disabledSkillDir)).toBe(true);
    });

    test("does not enable an already installed active skill", async () => {
        const projectDir = await createTempProject();
        const skillDir = path.join(projectDir, ".agents/skills/demo-skill");
        await mkdir(skillDir, { recursive: true });
        await writeFile(path.join(skillDir, "SKILL.md"), "---\nname: demo-skill\n---\n# Demo\n");

        await expect(enableDisabledSkill("demo-skill", { cwd: projectDir })).rejects.toThrow(
            "Disabled skill not found",
        );

        expect(await pathExists(skillDir)).toBe(true);
    });
});
