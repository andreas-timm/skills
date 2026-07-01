import { mkdir } from "node:fs/promises";
import { getLogger } from "@andreas-timm/logger";
import { verbose } from "../verbose";

const logger = getLogger();
type Transformers = typeof import("@huggingface/transformers");

export type Embedder = {
    dim: number;
    embed: (texts: string[]) => Promise<Float32Array[]>;
    embedQuery: (text: string) => Promise<Float32Array>;
};

function isMissingTransformersError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return (
        error.message.includes("@huggingface/transformers") &&
        (error.message.includes("Cannot find package") ||
            error.message.includes("Cannot find module") ||
            error.message.includes("Could not resolve"))
    );
}

async function loadTransformers(): Promise<Pick<Transformers, "env" | "pipeline">> {
    try {
        return await import("@huggingface/transformers");
    } catch (error) {
        if (!isMissingTransformersError(error)) throw error;
        throw new Error(
            "Embedding search requires the optional @huggingface/transformers package. Install it alongside the CLI, then rerun the embedding command.",
            { cause: error },
        );
    }
}

type PipelineOptions = NonNullable<Parameters<Transformers["pipeline"]>[2]>;

export async function createEmbedder(params: {
    model: string;
    cacheDir: string;
    dim: number;
    device?: string;
    dtype?: string;
}): Promise<Embedder> {
    const { model, cacheDir, dim, device, dtype = "fp32" } = params;
    const { env, pipeline } = await loadTransformers();
    await mkdir(cacheDir, { recursive: true });
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;
    if (verbose) {
        logger.info(
            `Loading embedder ${model} (cache: ${cacheDir}, device: ${device ?? "default"}, dtype: ${dtype})`,
        );
    }
    const options: PipelineOptions = { dtype: dtype as PipelineOptions["dtype"] };
    // Omit `device` entirely when unset so Transformers.js picks the env default.
    if (device) options.device = device as PipelineOptions["device"];
    const extractor = await pipeline("feature-extraction", model, options);
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
