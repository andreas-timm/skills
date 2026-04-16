import { mkdir } from "node:fs/promises";
import { getLogger } from "@andreas-timm/logger";
import { env, pipeline } from "@huggingface/transformers";
import { verbose } from "../verbose";

const logger = getLogger();

export type Embedder = {
    dim: number;
    embed: (texts: string[]) => Promise<Float32Array[]>;
    embedQuery: (text: string) => Promise<Float32Array>;
};

export async function createEmbedder(params: {
    model: string;
    cacheDir: string;
    dim: number;
}): Promise<Embedder> {
    const { model, cacheDir, dim } = params;
    await mkdir(cacheDir, { recursive: true });
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;
    if (verbose) {
        logger.info(`Loading embedder ${model} (cache: ${cacheDir})`);
    }
    const extractor = await pipeline("feature-extraction", model, {
        dtype: "fp32",
    });
    const runExtract = async (prefixed: string[]): Promise<Float32Array[]> => {
        const output = await extractor(prefixed, {
            pooling: "mean",
            normalize: true,
        });
        const data = output.data as Float32Array;
        const [n, d] = output.dims as [number, number];
        if (d !== dim) {
            throw new Error(`Model returned dim ${d} but config says ${dim}`);
        }
        const out: Float32Array[] = [];
        for (let i = 0; i < n; i++) {
            out.push(data.slice(i * d, (i + 1) * d));
        }
        return out;
    };
    return {
        dim,
        embed: async (texts: string[]): Promise<Float32Array[]> => {
            // nomic-embed-text expects task-prefixed inputs; "search_document: " for indexing.
            return runExtract(texts.map((t) => `search_document: ${t}`));
        },
        embedQuery: async (text: string): Promise<Float32Array> => {
            const [vec] = await runExtract([`search_query: ${text}`]);
            if (!vec) throw new Error("Embedder returned no vector for query");
            return vec;
        },
    };
}

export function floatToBlob(vec: Float32Array): Buffer {
    return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}
