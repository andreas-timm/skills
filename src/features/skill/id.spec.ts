import { describe, expect, it } from "bun:test";
import { SHORT_SKILL_ID_LENGTH, shortSkillId } from "./id";

describe("shortSkillId", () => {
    it("uses the configured short skill id length", () => {
        expect(SHORT_SKILL_ID_LENGTH).toBe(8);
        expect(shortSkillId("0123456789abcdef")).toBe("01234567");
    });
});
