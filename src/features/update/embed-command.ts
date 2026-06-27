import { join } from "node:path";
import { getLogger } from "@andreas-timm/logger";
import type { Config, EmbedDevice, EmbedDtype } from "@config";
import { expandHome } from "@libs/path";
import { embed } from "./embed-run";
import { expandSkillLocationRoots, resolveSkillsDbPath } from "./paths";

const logger = getLogger();

export type EmbedOverrides = {
    device?: EmbedDevice;
    dtype?: EmbedDtype;
};

export async function runEmbedForConfig(
    config: Config,
    overrides: EmbedOverrides = {},
): Promise<void> {
    const locationRoots = expandSkillLocationRoots(config);
    const dbPath = resolveSkillsDbPath(config);
    const rawModels = config.embed.models_dir;
    const modelsDir =
        rawModels.startsWith("/") || rawModels.startsWith("~")
            ? expandHome(rawModels)
            : join(config.root_dir, rawModels);

    const device = overrides.device ?? config.embed.device;
    const dtype = overrides.dtype ?? config.embed.dtype;

    logger.info(
        `Embedding skills from ${dbPath} using ${config.embed.model} (device: ${device}, dtype: ${dtype})`,
    );

    await embed({
        dbPath,
        locationRoots,
        model: config.embed.model,
        dim: config.embed.dim,
        cacheDir: modelsDir,
        batchSize: config.embed.batch_size,
        chunkTokens: config.embed.chunk_tokens,
        chunkOverlap: config.embed.chunk_overlap,
        device,
        dtype,
    });
}
