import { access, mkdir, rename, rmdir } from "node:fs/promises";
import path from "node:path";
import { LOCAL_DISABLED_SKILLS_DIR, LOCAL_SKILLS_DIR } from "@features/agent/skills-dir";
import { shortSkillId } from "@features/skill/id";
import { type InstalledSkill, listInstalledSkills } from "./run-ls.ts";

export interface EnableDisabledSkillOptions {
    cwd?: string;
}

export interface EnableDisabledSkillResult {
    id: string;
    path: string;
    rootDir: string;
    skillName: string;
    targetDir: string;
    targetPath: string;
}

type ErrorWithCode = {
    code?: string;
};

function resolveCwd(cwd?: string): string {
    return path.resolve(cwd ?? process.cwd());
}

function resolveLocalDisabledSkillsDir(cwd: string): string {
    return path.resolve(cwd, LOCAL_DISABLED_SKILLS_DIR);
}

function resolveLocalSkillsDir(cwd: string): string {
    return path.resolve(cwd, LOCAL_SKILLS_DIR);
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

function disabledSkillReferences(skill: InstalledSkill): ReadonlySet<string> {
    const references = new Set([
        skill.id,
        shortSkillId(skill.id),
        skill.name,
        path.basename(skill.rootDir),
    ]);

    if (skill.version) {
        references.add(`${skill.name}@${skill.version}`);
    }

    return references;
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

function formatAmbiguousSkill(skill: InstalledSkill, cwd: string): string {
    return `- ${skill.name} (${shortSkillId(skill.id)}) at ${formatDisplayTarget(skill.rootDir, cwd)}`;
}

async function removeDisabledSkillsDirIfEmpty(cwd: string): Promise<void> {
    try {
        await rmdir(resolveLocalDisabledSkillsDir(cwd));
    } catch (error) {
        const code = (error as ErrorWithCode).code;
        if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") {
            return;
        }
        throw error;
    }
}

export function resolveDisabledSkillForEnable(
    skills: readonly InstalledSkill[],
    skillRef: string,
    cwd = process.cwd(),
): InstalledSkill {
    const reference = skillRef.trim();
    if (reference === "") {
        throw new Error("Skill reference is required");
    }

    const matches = skills
        .filter((skill) => skill.disabled)
        .filter((skill) => disabledSkillReferences(skill).has(reference));

    if (matches.length === 0) {
        throw new Error(
            `Disabled skill not found in ${resolveLocalDisabledSkillsDir(cwd)}: ${skillRef}`,
        );
    }

    if (matches.length > 1) {
        throw new Error(
            [
                `Disabled skill reference is ambiguous: ${skillRef}`,
                ...matches.map((skill) => formatAmbiguousSkill(skill, cwd)),
            ].join("\n"),
        );
    }

    const skill = matches[0];
    if (!skill) {
        throw new Error(
            `Disabled skill not found in ${resolveLocalDisabledSkillsDir(cwd)}: ${skillRef}`,
        );
    }

    return skill;
}

export async function enableDisabledSkill(
    skillRef: string,
    options: EnableDisabledSkillOptions = {},
): Promise<EnableDisabledSkillResult> {
    const cwd = resolveCwd(options.cwd);
    const skill = resolveDisabledSkillForEnable(
        await listInstalledSkills(cwd, { includeDisabled: true }),
        skillRef,
        cwd,
    );
    const targetDir = path.join(resolveLocalSkillsDir(cwd), path.basename(skill.rootDir));

    if (await pathExists(targetDir)) {
        throw new Error(`Installed skill already exists at ${targetDir}`);
    }

    await mkdir(path.dirname(targetDir), { recursive: true });
    await rename(skill.rootDir, targetDir);
    await removeDisabledSkillsDirIfEmpty(cwd);

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

export async function runEnable(
    skillRef: string,
    options: EnableDisabledSkillOptions = {},
): Promise<void> {
    const cwd = resolveCwd(options.cwd);
    const result = await enableDisabledSkill(skillRef, { cwd });
    console.log(
        `Enabled ${result.skillName}: ${formatDisplayTarget(
            result.rootDir,
            cwd,
        )} -> ${formatDisplayTarget(result.targetDir, cwd)}`,
    );
}
