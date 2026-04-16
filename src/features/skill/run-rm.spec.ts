import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shortSkillId } from "@features/skill/id";
import { createDeterministicSkillZip } from "@features/zip/deterministic-zip";
import { removeInstalledSkill } from "./run-rm.ts";

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "skills-rm-"));
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

describe("removeInstalledSkill", () => {
    test("removes an installed skill by frontmatter name", async () => {
        const projectDir = await createTempProject();
        const skillDir = await writeInstalledSkill(
            projectDir,
            "demo-folder",
            "---\nname: demo-skill\ndescription: Demo\n---\n# Demo\n",
        );
        await mkdir(path.join(skillDir, "scripts"));
        await writeFile(path.join(skillDir, "scripts/setup.sh"), "echo setup");

        const result = await removeInstalledSkill("demo-skill", {
            cwd: projectDir,
        });

        expect(result.skillName).toBe("demo-skill");
        expect(result.rootDir).toBe(skillDir);
        expect(await pathExists(skillDir)).toBe(false);
    });

    test("removes a disabled skill by frontmatter name", async () => {
        const projectDir = await createTempProject();
        const skillDir = await writeDisabledSkill(
            projectDir,
            "demo-folder",
            "---\nname: demo-skill\ndescription: Demo\n---\n# Demo\n",
        );
        await mkdir(path.join(skillDir, "scripts"));
        await writeFile(path.join(skillDir, "scripts/setup.sh"), "echo setup");

        const result = await removeInstalledSkill("demo-skill", {
            cwd: projectDir,
        });

        expect(result.skillName).toBe("demo-skill");
        expect(result.rootDir).toBe(skillDir);
        expect(await pathExists(skillDir)).toBe(false);
    });

    test("removes an installed skill by folder name", async () => {
        const projectDir = await createTempProject();
        const skillDir = await writeInstalledSkill(
            projectDir,
            "demo-folder",
            "---\nname: demo-skill\n---\n# Demo\n",
        );

        await removeInstalledSkill("demo-folder", { cwd: projectDir });

        expect(await pathExists(skillDir)).toBe(false);
    });

    test("removes an installed skill by short id", async () => {
        const projectDir = await createTempProject();
        const skillDir = await writeInstalledSkill(
            projectDir,
            "demo-skill",
            "---\nname: demo-skill\n---\n# Demo\n",
        );
        const zip = await createDeterministicSkillZip({ rootDir: skillDir });

        await removeInstalledSkill(shortSkillId(zip.sha256), {
            cwd: projectDir,
        });

        expect(await pathExists(skillDir)).toBe(false);
    });

    test("leaves installed skills in place when the reference is missing", async () => {
        const projectDir = await createTempProject();
        const skillDir = await writeInstalledSkill(
            projectDir,
            "demo-skill",
            "---\nname: demo-skill\n---\n# Demo\n",
        );

        await expect(removeInstalledSkill("missing-skill", { cwd: projectDir })).rejects.toThrow(
            "Installed skill not found",
        );

        await expect(readFile(path.join(skillDir, "SKILL.md"), "utf-8")).resolves.toContain(
            "demo-skill",
        );
    });

    test("rejects ambiguous skill names", async () => {
        const projectDir = await createTempProject();
        const firstSkillDir = await writeInstalledSkill(
            projectDir,
            "first",
            "---\nname: duplicate-skill\ndescription: First\n---\n# Demo\n",
        );
        const secondSkillDir = await writeInstalledSkill(
            projectDir,
            "second",
            "---\nname: duplicate-skill\ndescription: Second\n---\n# Demo\n",
        );

        await expect(removeInstalledSkill("duplicate-skill", { cwd: projectDir })).rejects.toThrow(
            "Installed skill reference is ambiguous",
        );
        expect(await pathExists(firstSkillDir)).toBe(true);
        expect(await pathExists(secondSkillDir)).toBe(true);
    });
});
