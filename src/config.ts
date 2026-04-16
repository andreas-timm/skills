import { join } from "node:path";
import { load } from "@andreas-timm/config";
import { z } from "zod";

export const LocationSourceSchema = z
    .object({
        ignore: z.array(z.string()).optional(),
    })
    .strict();

export const LocationSchema = z.object({
    dir: z.string(),
    tags: z.array(z.string()).optional(),
    approved: z.boolean().optional(),
    source: z.record(z.string(), LocationSourceSchema).optional(),
});

export const SkillsSchema = z
    .object({
        db_path: z.string(),
        locations: z.record(z.string(), LocationSchema).default({}),
    })
    .strict();

export const EmbedConfigSchema = z
    .object({
        model: z.string(),
        dim: z.number().int().positive(),
        models_dir: z.string(),
        batch_size: z.number().int().positive(),
        chunk_tokens: z.number().int().positive(),
        chunk_overlap: z.number().int().nonnegative(),
    })
    .strict();

export const VirusTotalConfigSchema = z
    .object({
        api_key: z.string().optional(),
    })
    .strict();

export const ConfigSchema = z
    .object({
        root_dir: z.string(),
        skills: SkillsSchema,
        embed: EmbedConfigSchema,
        virustotal: VirusTotalConfigSchema.optional(),
    })
    .strict();

export type Config = z.infer<typeof ConfigSchema>;
const rootDir = join(import.meta.dir, "..");
export const USER_CONFIG_PATH = "~/.config/skills/config.toml";
const configFiles = ["global.toml", USER_CONFIG_PATH, "local.toml"];
let cached: Promise<Config> | undefined;

export function loadConfig(): Promise<Config> {
    cached ??= load(ConfigSchema, rootDir, configFiles) as Promise<Config>;
    return cached;
}

export function resetConfig() {
    cached = undefined;
}
