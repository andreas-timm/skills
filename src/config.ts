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

// Mirrors @huggingface/transformers DeviceType. Default "cpu" runs on the ONNX
// Runtime CPU backend everywhere; "coreml" / "webgpu" use the Apple GPU/Neural
// Engine on macOS arm64 (both opt-in, with per-op CPU fallback).
export const EmbedDeviceSchema = z.enum([
    "auto",
    "cpu",
    "gpu",
    "coreml",
    "webgpu",
    "cuda",
    "dml",
    "wasm",
    "webnn",
    "webnn-npu",
    "webnn-gpu",
    "webnn-cpu",
]);
export type EmbedDevice = z.infer<typeof EmbedDeviceSchema>;

// Mirrors @huggingface/transformers DataType. CoreML/GPU backends often prefer
// "fp16"; the CPU backend uses "fp32".
export const EmbedDtypeSchema = z.enum([
    "auto",
    "fp32",
    "fp16",
    "q8",
    "int8",
    "uint8",
    "q4",
    "bnb4",
    "q4f16",
    "q2",
    "q2f16",
    "q1",
    "q1f16",
]);
export type EmbedDtype = z.infer<typeof EmbedDtypeSchema>;

export const EmbedConfigSchema = z
    .object({
        model: z.string(),
        dim: z.number().int().positive(),
        models_dir: z.string(),
        batch_size: z.number().int().positive(),
        chunk_tokens: z.number().int().positive(),
        chunk_overlap: z.number().int().nonnegative(),
        device: EmbedDeviceSchema.default("cpu"),
        dtype: EmbedDtypeSchema.default("fp32"),
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
