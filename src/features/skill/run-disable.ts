import { access, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { LOCAL_DISABLED_SKILLS_DIR } from "@features/agent/skills-dir";
import { listInstalledSkills } from "./run-ls.ts";
import { resolveInstalledSkillForRemoval } from "./run-rm.ts";

export interface DisableInstalledSkillOptions {
    cwd?: string;
}

export interface DisableInstalledSkillResult {
    id: string;
    path: string;
    rootDir: string;
    skillName: string;
    targetDir: string;
    targetPath: string;
}

function resolveCwd(cwd?: string): string {
    return path.resolve(cwd ?? process.cwd());
}

function resolveLocalDisabledSkillsDir(cwd: string): string {
    return path.resolve(cwd, LOCAL_DISABLED_SKILLS_DIR);
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

function formatDisplayTarget(targetDir: string, cwd = process.cwd()): string {
    const relativeTarget = path.relative(cwd, targetDir);
    if (
        relativeTarget !== "" &&
        !relativeTarget.startsWith("..") &&
        !path.isAbsolute(relativeTarget)
    ) {
        return relativeTarget;
    }

    return targetDir;
}

export async function disableInstalledSkill(
    skillRef: string,
    options: DisableInstalledSkillOptions = {},
): Promise<DisableInstalledSkillResult> {
    const cwd = resolveCwd(options.cwd);
    const skill = resolveInstalledSkillForRemoval(await listInstalledSkills(cwd), skillRef, cwd);
    const targetDir = path.join(resolveLocalDisabledSkillsDir(cwd), path.basename(skill.rootDir));

    if (await pathExists(targetDir)) {
        throw new Error(`Disabled skill already exists at ${targetDir}`);
    }

    await mkdir(path.dirname(targetDir), { recursive: true });
    await rename(skill.rootDir, targetDir);

    const relativeSkillPath = path.relative(skill.rootDir, skill.path);
    const targetPath = path.join(targetDir, relativeSkillPath);

    return {
        id: skill.id,
        path: skill.path,
        rootDir: skill.rootDir,
        skillName: skill.name,
        targetDir,
        targetPath,
    };
}

export async function runDisable(
    skillRef: string,
    options: DisableInstalledSkillOptions = {},
): Promise<void> {
    const cwd = resolveCwd(options.cwd);
    const result = await disableInstalledSkill(skillRef, { cwd });
    console.log(
        `Disabled ${result.skillName}: ${formatDisplayTarget(
            result.rootDir,
            cwd,
        )} -> ${formatDisplayTarget(result.targetDir, cwd)}`,
    );
}
