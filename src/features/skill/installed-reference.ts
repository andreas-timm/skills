import { basename } from "node:path";
import { shortSkillId } from "@features/skill/id";
import type { InstalledSkill } from "@features/skill/run-ls.ts";

function parseInstalledVersionedReference(
    reference: string,
): { name: string; version: string } | null {
    const suffixIndex = reference.lastIndexOf("@");
    if (suffixIndex <= 0 || suffixIndex === reference.length - 1) {
        return null;
    }

    const name = reference.slice(0, suffixIndex);
    const version = reference.slice(suffixIndex + 1);
    if (name.trim() === "" || version.trim() === "") {
        return null;
    }

    return { name, version };
}

function installedSkillVersionMatches(skill: InstalledSkill, referenceVersion: string): boolean {
    const version = skill.version?.trim();
    if (version) {
        return version === referenceVersion;
    }

    return referenceVersion === "v1" || referenceVersion === "1";
}

export function resolveInstalledSkillReference(
    skills: readonly InstalledSkill[],
    reference: string,
): InstalledSkill | null {
    const byId = skills.find(
        (skill) => skill.id === reference || shortSkillId(skill.id) === reference,
    );
    if (byId) {
        return byId;
    }

    const versionedReference = parseInstalledVersionedReference(reference);
    if (versionedReference) {
        return (
            skills.find(
                (skill) =>
                    skill.name === versionedReference.name &&
                    installedSkillVersionMatches(skill, versionedReference.version),
            ) ?? null
        );
    }

    return (
        skills.find((skill) => skill.name === reference) ??
        skills.find((skill) => basename(skill.rootDir) === reference) ??
        null
    );
}
