export type SkillVersionFields = {
    version: string | null;
    version_order: number;
};

export type PublicSkillVersionFields<T extends SkillVersionFields> = Omit<
    T,
    "version" | "version_order"
> & {
    version: string;
};

export function generatedSkillVersion(versionOrder: number): string {
    return `v${versionOrder}`;
}

export function publicSkillVersion(skill: SkillVersionFields): string {
    const version = skill.version?.trim();
    return version && version.length > 0 ? version : generatedSkillVersion(skill.version_order);
}

export function toPublicSkillVersion<T extends SkillVersionFields>(
    skill: T,
): PublicSkillVersionFields<T> {
    const output = {
        ...skill,
        version: publicSkillVersion(skill),
    };
    delete (output as { version_order?: number }).version_order;
    return output as PublicSkillVersionFields<T>;
}
