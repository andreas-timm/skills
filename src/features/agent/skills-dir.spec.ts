import { describe, expect, test } from "bun:test";
import {
    AGENT_DISABLED_SKILLS_DIRS,
    AGENT_SKILLS_DIRS,
    agentSkillsDir,
    CURRENT_AGENTS_DIR,
    GLOBAL_AGENTS_DIRS,
    LOCAL_DISABLED_SKILLS_DIR,
    LOCAL_SKILLS_DIR,
    SUPPORTED_SKILLS_SUBDIRS,
} from "./skills-dir";

describe("skills-dir", () => {
    test("derives local skill folders from the current agent folder", () => {
        expect(LOCAL_SKILLS_DIR).toBe(`${CURRENT_AGENTS_DIR}/${SUPPORTED_SKILLS_SUBDIRS.enabled}`);
        expect(LOCAL_DISABLED_SKILLS_DIR).toBe(
            `${CURRENT_AGENTS_DIR}/${SUPPORTED_SKILLS_SUBDIRS.disabled}`,
        );
    });

    test("derives global skill folders from global agent folders", () => {
        expect(AGENT_SKILLS_DIRS.default).toBe(
            `${GLOBAL_AGENTS_DIRS.default}/${SUPPORTED_SKILLS_SUBDIRS.enabled}`,
        );
        expect(AGENT_DISABLED_SKILLS_DIRS.default).toBe(
            `${GLOBAL_AGENTS_DIRS.default}/${SUPPORTED_SKILLS_SUBDIRS.disabled}`,
        );
        expect(agentSkillsDir("default", "disabled")).toBe(AGENT_DISABLED_SKILLS_DIRS.default);
        expect(AGENT_SKILLS_DIRS.antigravity).toBe(
            `${GLOBAL_AGENTS_DIRS.antigravity}/${SUPPORTED_SKILLS_SUBDIRS.enabled}`,
        );
        expect(AGENT_DISABLED_SKILLS_DIRS.antigravity).toBe(
            `${GLOBAL_AGENTS_DIRS.antigravity}/${SUPPORTED_SKILLS_SUBDIRS.disabled}`,
        );
    });
});
