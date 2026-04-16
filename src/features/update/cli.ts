import { registerCommands } from "@andreas-timm/cli";
import { getLogger } from "@andreas-timm/logger";
import { loadConfig } from "@config";
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
        "Scan skills.locations for SKILL.md files and write/update the SQLite db",
        (command) => {
            command
                .option("--embed", "Refresh embeddings after update completes")
                .action(async (opts: { embed?: boolean }) => {
                    const config = await loadConfig();
                    const settings = expandSkillLocationSettings(config);
                    const locations = Object.entries(settings).map(
                        ([name, { root, tags, source }]) => ({
                            name,
                            root,
                            ...(tags !== undefined ? { tags } : {}),
                            ...(source !== undefined ? { sourceConfig: source } : {}),
                        }),
                    );
                    const dbPath = resolveSkillsDbPath(config);
                    logger.info(
                        `Scanning ${locations.length} location(s): ${locations.map((l) => l.name).join(", ")}`,
                    );

                    const pipeline$ = transform(extract(locations));
                    await load(dbPath, pipeline$);

                    if (opts.embed) {
                        await runEmbedForConfig(config);
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
