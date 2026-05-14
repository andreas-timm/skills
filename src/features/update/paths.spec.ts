import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "@config";
import { agentSkillLocationName } from "@features/agent/skills-dir";
import { expandSkillLocationRoots, expandSkillLocationSettings } from "./paths";

const config = {
    root_dir: "/tmp/skills",
    skills: {
        db_path: "skills.sqlite",
        locations: {
            packages: {
                dir: "/tmp/packages",
                tags: ["review"],
                approved: true,
            },
        },
    },
    embed: {
        model: "test-model",
        dim: 128,
        models_dir: "/tmp/models",
        batch_size: 8,
        chunk_tokens: 256,
        chunk_overlap: 32,
    },
} satisfies Config;

describe("expandSkillLocationSettings", () => {
    it("includes configured locations and optional agent skill directories", () => {
        const settings = expandSkillLocationSettings(config);

        expect(settings.packages).toEqual({
            root: "/tmp/packages",
            tags: ["review"],
            approved: true,
        });
        expect(settings[agentSkillLocationName("codex")]).toEqual({
            root: join(homedir(), ".codex/skills"),
            optional: true,
        });
    });
});

describe("expandSkillLocationRoots", () => {
    it("resolves roots for agent skill locations", () => {
        const roots = expandSkillLocationRoots(config);

        expect(roots[agentSkillLocationName("claude")]).toBe(join(homedir(), ".claude/skills"));
    });
});
