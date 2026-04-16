export const SHORT_SKILL_ID_LENGTH = 8;

export function shortSkillId(id: string): string {
    return id.slice(0, SHORT_SKILL_ID_LENGTH);
}
