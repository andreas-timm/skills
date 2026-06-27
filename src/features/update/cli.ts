import { registerCommands } from "@andreas-timm/cli";
import { getLogger } from "@andreas-timm/logger";
import { EmbedDeviceSchema, EmbedDtypeSchema, loadConfig } from "@config";
import { runEmbedForConfig } from "@features/update/embed-command";
import { extract } from "@features/update/extract";
import { load, reset } from "@features/update/load";
import { expandSkillLocationSettings, resolveSkillsDbPath } from "@features/update/paths";
import { transform } from "@features/update/transform";
import type { CAC } from "cac";

const logger = getLogger();

export function registerUpdateCommands(cli: CAC): void {
    registerCommands(
        cli,
        ["update"],
        "Scan configured and agent skill locations for SKILL.md files and write/update the SQLite db",
        (command) => {
            command
                .option("--embed", "Refresh embeddings after update completes")
                .option(
                    "--device <device>",
                    "Embedding device override (e.g. cpu, coreml, webgpu). Implies --embed.",
                )
                .option(
                    "--dtype <dtype>",
                    "Embedding data type override (e.g. fp32, fp16). Implies --embed.",
                )
                .action(async (opts: { embed?: boolean; device?: string; dtype?: string }) => {
                    const device =
                        opts.device !== undefined
                            ? EmbedDeviceSchema.parse(opts.device)
                            : undefined;
                    const dtype =
                        opts.dtype !== undefined ? EmbedDtypeSchema.parse(opts.dtype) : undefined;
                    const config = await loadConfig();
                    const settings = expandSkillLocationSettings(config);
                    const locations = Object.entries(settings).map(
                        ([name, { root, optional, tags, source, configPath, configKey }]) => ({
                            name,
                            root,
                            ...(optional !== undefined ? { optional } : {}),
                            ...(tags !== undefined ? { tags } : {}),
                            ...(source !== undefined ? { sourceConfig: source } : {}),
                            ...(configPath !== undefined ? { configPath } : {}),
                            ...(configKey !== undefined ? { configKey } : {}),
                        }),
                    );
                    const dbPath = resolveSkillsDbPath(config);
                    logger.info(
                        `Scanning ${locations.length} location(s): ${locations.map((l) => l.name).join(", ")}`,
                    );

                    const pipeline$ = transform(extract(locations));
                    await load(dbPath, pipeline$);

                    if (opts.embed || device !== undefined || dtype !== undefined) {
                        await runEmbedForConfig(config, { device, dtype });
                    }
                });
        },
    );

    registerCommands(cli, ["reset"], "Clear all data from the skill SQLite db", (command) => {
        command.action(async () => {
            const config = await loadConfig();
            const dbPath = resolveSkillsDbPath(config);
            await reset(dbPath);
        });
    });
}
