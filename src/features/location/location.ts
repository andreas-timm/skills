import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createTable } from "@andreas-timm/cli-table";
import { getLogger } from "@andreas-timm/logger";
import { loadConfig, resetConfig, USER_CONFIG_PATH } from "@config";
import { parse, stringify } from "@iarna/toml";
import { expandHome } from "@libs/path";

const logger = getLogger();
const UPDATE_REMINDER =
    "Location changes do not update the skills DB automatically. Run `skills update` (or `skills update --embed`).";

type LocationOptions = {
    tags?: string;
    approved?: boolean;
    config?: string;
};

type LocalConfig = {
    skills?: {
        locations?: Record<string, LocationEntry>;
    };
};

type LocationEntry = {
    dir?: string;
    tags?: string[];
    approved?: boolean;
};

function parseTags(rawTags: string): string[] {
    return rawTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function getConfigPath(configPath: string | undefined): string {
    const rawPath = configPath ?? USER_CONFIG_PATH;
    if (rawPath.startsWith("~")) return expandHome(rawPath);
    return resolve(rawPath);
}

async function readLocalConfig(path: string): Promise<LocalConfig> {
    try {
        const raw = await readFile(path, "utf8");
        return (parse(raw) as LocalConfig) ?? {};
    } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") return {};
        throw error;
    }
}

async function writeLocalConfig(path: string, config: LocalConfig): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const output = stringify(config);
    await writeFile(path, output);
}

function ensureLocations(config: LocalConfig): Record<string, LocationEntry> {
    if (!config.skills) config.skills = {};
    if (!config.skills.locations) config.skills.locations = {};
    return config.skills.locations;
}

export async function setLocationAction(
    name: string,
    dirArg: string | undefined,
    options: LocationOptions,
): Promise<void> {
    const configPath = getConfigPath(options.config);
    const config = await readLocalConfig(configPath);
    const locations = ensureLocations(config);
    const existing = locations[name];
    const dir =
        dirArg !== undefined && String(dirArg).trim() !== "" ? String(dirArg).trim() : undefined;

    if (!existing) {
        if (!dir) {
            throw new Error(
                `Directory is required when creating location "${name}" (pass <dir> as the second argument)`,
            );
        }
        locations[name] = {
            dir,
            ...(options.tags !== undefined ? { tags: parseTags(options.tags) } : {}),
            ...(options.approved !== undefined ? { approved: options.approved } : {}),
        };
        await writeLocalConfig(configPath, config);
        resetConfig();
        logger.info(`Set location "${name}" in ${configPath}`);
        logger.info(UPDATE_REMINDER);
        return;
    }

    locations[name] = {
        ...existing,
        ...(dir !== undefined ? { dir } : {}),
        ...(options.tags !== undefined ? { tags: parseTags(options.tags) } : {}),
        ...(options.approved !== undefined ? { approved: options.approved } : {}),
    };
    await writeLocalConfig(configPath, config);
    resetConfig();
    logger.info(`Updated location "${name}" in ${configPath}`);
    logger.info(UPDATE_REMINDER);
}

export async function removeLocationAction(
    name: string,
    options: { config?: string },
): Promise<void> {
    const configPath = getConfigPath(options.config);
    const config = await readLocalConfig(configPath);
    const locations = config.skills?.locations;
    if (!locations || !(name in locations)) {
        throw new Error(`Location "${name}" not found in ${configPath}`);
    }
    delete locations[name];
    await writeLocalConfig(configPath, config);
    resetConfig();
    logger.info(`Removed location "${name}" from ${configPath}`);
    logger.info(UPDATE_REMINDER);
}

export async function listLocationAction(): Promise<void> {
    const config = await loadConfig();
    const rows = Object.entries(config.skills.locations).map(([name, value]) => ({
        name,
        dir: value.dir,
        approved: value.approved ?? false,
        tags: value.tags ?? [],
    }));

    if (rows.length === 0) {
        logger.info("No configured locations.");
        return;
    }

    const table = createTable({
        head: ["name", "dir", "approved", "tags"],
        wordWrap: true,
        aligns: [
            { index: 0, type: "left" },
            { index: 1, type: "left" },
            { index: 2, type: "left" },
            { index: 3, type: "left" },
        ],
    });

    for (const row of rows) {
        const tags = row.tags.length > 0 ? row.tags.join(",") : "-";
        table.push([row.name, row.dir, String(row.approved), tags]);
    }

    process.stdout.write(`${table.toString()}\n`);
}
