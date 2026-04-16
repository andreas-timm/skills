import { describe, expect, it } from "bun:test";
import { ConfigSchema } from "@config";

const baseConfig = {
    root_dir: "/tmp/skills",
    skills: {
        db_path: "skills.sqlite",
        locations: {
            packages: {
                dir: "/tmp/packages",
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
};

describe("ConfigSchema", () => {
    it("defaults missing skill locations to an empty object", () => {
        const parsed = ConfigSchema.parse({
            ...baseConfig,
            skills: {
                db_path: "skills.sqlite",
            },
        });

        expect(parsed.skills.locations).toEqual({});
    });

    it("accepts source ignore config on a skill location", () => {
        const parsed = ConfigSchema.parse({
            ...baseConfig,
            skills: {
                ...baseConfig.skills,
                locations: {
                    packages: {
                        dir: "/tmp/packages",
                        source: {
                            "owner/repo": {
                                ignore: ["/tmp/packages/repo/drafts/**"],
                            },
                        },
                    },
                },
            },
        });

        expect(parsed.skills.locations.packages?.source?.["owner/repo"]?.ignore).toEqual([
            "/tmp/packages/repo/drafts/**",
        ]);
    });

    it("accepts optional VirusTotal config", () => {
        const apiKeyField = "api_key";
        const apiKeyCommand = "!op read op://private/virustotal/api_key";
        const parsed = ConfigSchema.parse({
            ...baseConfig,
            virustotal: {
                [apiKeyField]: apiKeyCommand,
            },
        });

        expect(parsed.virustotal?.api_key).toBe(apiKeyCommand);
    });
});
