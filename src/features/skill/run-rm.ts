import { rm } from "node:fs/promises";
import path from "node:path";
import { getLogger } from "@andreas-timm/logger";
import { loadConfig } from "@config";
import { LOCAL_SKILLS_DIR } from "@features/agent/skills-dir";
import { removeInstallRecord } from "@features/install/installs";
import { shortSkillId } from "@features/skill/id";
import { resolveSkillsDbPath } from "@features/update/paths";
import {
    type InstalledSkill,
    listInstalledSkills,
    resolveInstalledSkillSearchRoots,
} from "./run-ls.ts";

export interface RemoveInstalledSkillOptions {
    cwd?: string;
}

export interface RemoveInstalledSkillResult {
    id: string;
    path: string;
    rootDir: string;
    skillName: string;
}

function resolveCwd(cwd?: string): string {
    return path.resolve(cwd ?? process.cwd());
}

function resolveLocalSkillsDir(cwd: string): string {
    return resolveInstalledSkillSearchRoots(cwd)[0] ?? path.resolve(cwd, LOCAL_SKILLS_DIR);
}

function formatNotFoundMessage(skillRef: string, roots: readonly string[]): string {
    if (roots.length === 1) {
        return `Installed skill not found in ${roots[0] ?? ""}: ${skillRef}`;
    }

    return [
        `Installed skill not found: ${skillRef}`,
        "Searched:",
        ...roots.map((root) => `- ${root}`),
    ].join("\n");
}

function installedSkillReferences(skill: InstalledSkill): ReadonlySet<string> {
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

export function resolveInstalledSkillForRemoval(
    skills: readonly InstalledSkill[],
    skillRef: string,
    cwd = process.cwd(),
    options: { searchRoots?: readonly string[] } = {},
): InstalledSkill {
    const reference = skillRef.trim();
    if (reference === "") {
        throw new Error("Skill reference is required");
    }

    const matches = skills.filter((skill) => installedSkillReferences(skill).has(reference));

    if (matches.length === 0) {
        throw new Error(
            formatNotFoundMessage(skillRef, options.searchRoots ?? [resolveLocalSkillsDir(cwd)]),
        );
    }

    if (matches.length > 1) {
        throw new Error(
            [
                `Installed skill reference is ambiguous: ${skillRef}`,
                ...matches.map((skill) => formatAmbiguousSkill(skill, cwd)),
            ].join("\n"),
        );
    }

    const skill = matches[0];
    if (!skill) {
        throw new Error(
            formatNotFoundMessage(skillRef, options.searchRoots ?? [resolveLocalSkillsDir(cwd)]),
        );
    }

    return skill;
}

export async function removeInstalledSkill(
    skillRef: string,
    options: RemoveInstalledSkillOptions = {},
): Promise<RemoveInstalledSkillResult> {
    const cwd = resolveCwd(options.cwd);
    const searchRoots = resolveInstalledSkillSearchRoots(cwd, {
        includeDisabled: true,
    });
    const skill = resolveInstalledSkillForRemoval(
        await listInstalledSkills(cwd, { includeDisabled: true }),
        skillRef,
        cwd,
        { searchRoots },
    );

    await rm(skill.rootDir, { recursive: true });

    return {
        id: skill.id,
        path: skill.path,
        rootDir: skill.rootDir,
        skillName: skill.name,
    };
}

async function forgetInstallRecord(targetDir: string): Promise<void> {
    try {
        const config = await loadConfig();
        removeInstallRecord(resolveSkillsDbPath(config), targetDir);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        getLogger().warn(`Warning: failed to clear install state: ${reason}`);
    }
}

export async function runRm(
    skillRef: string,
    options: RemoveInstalledSkillOptions = {},
): Promise<void> {
    const cwd = resolveCwd(options.cwd);
    const result = await removeInstalledSkill(skillRef, { cwd });
    await forgetInstallRecord(result.rootDir);
    console.log(`Removed ${result.skillName} from ${formatDisplayTarget(result.rootDir, cwd)}`);
}
