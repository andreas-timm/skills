import { join } from "node:path";
import { registerCommands } from "@andreas-timm/cli";
import { getLogger } from "@andreas-timm/logger";
import { loadConfig } from "@config";
import { approvedLocationNames } from "@features/approve/effective";
import {
    renderSearchHitsCompact,
    renderSearchHitsTable,
    resolveSearchTableWidth,
    writeJsonOutput,
} from "@features/search/output";
import { searchSkills } from "@features/search/query";
import { resolveSkillsDbPath } from "@features/update/paths";
import { expandHome } from "@libs/path";
import type { CAC } from "cac";

const logger = getLogger();

export function registerSearchCommands(cli: CAC): void {
    registerCommands(
        cli,
        ["search <query>"],
        "Search indexed skills by name/description; use --embed for semantic search",
        (command) => {
            command
                .option("--limit, --l <n>", "Number of skills to return", {
                    default: 10,
                })
                .option(
                    "--embed",
                    "Use embedding search instead of the default name/description text search",
                )
                .option(
                    "--kinds <kinds>",
                    "Comma-separated chunk kinds to search with --embed (name,description,content)",
                )
                .option("--json", "Emit results as JSON")
                .option("--width, -w <n>", "Table width in columns (0 = full terminal width)")
                .option(
                    "-c, --compact",
                    "Borderless table (1-space columns): one-line source, ellipsed description",
                )
                .action(
                    async (
                        query: string,
                        opts: {
                            limit?: number | string;
                            embed?: boolean;
                            kinds?: string;
                            json?: boolean;
                            width?: number | string;
                            compact?: boolean;
                        },
                    ) => {
                        const config = await loadConfig();
                        const dbPath = resolveSkillsDbPath(config);
                        const approvedLocations = approvedLocationNames(config);
                        const limit =
                            typeof opts.limit === "string"
                                ? Number.parseInt(opts.limit, 10)
                                : (opts.limit ?? 10);
                        const kinds = opts.kinds
                            ?.split(",")
                            .map((s) => s.trim())
                            .filter(Boolean);
                        if (kinds && kinds.length > 0 && !opts.embed) {
                            throw new Error("`--kinds` is only supported together with `--embed`.");
                        }

                        const hits = opts.embed
                            ? await (() => {
                                  const rawModels = config.embed.models_dir;
                                  const cacheDir =
                                      rawModels.startsWith("/") || rawModels.startsWith("~")
                                          ? expandHome(rawModels)
                                          : join(config.root_dir, rawModels);
                                  return searchSkills({
                                      mode: "embed",
                                      dbPath,
                                      query,
                                      model: config.embed.model,
                                      dim: config.embed.dim,
                                      cacheDir,
                                      limit,
                                      kinds,
                                      approvedLocations,
                                  });
                              })()
                            : await searchSkills({
                                  mode: "text",
                                  dbPath,
                                  query,
                                  limit,
                                  approvedLocations,
                              });

                        if (opts.json) {
                            writeJsonOutput(hits);
                            return;
                        }

                        if (hits.length === 0) {
                            logger.warn("No matches found");
                            return;
                        }

                        const tableWidth = resolveSearchTableWidth(opts.width);
                        process.stdout.write(
                            opts.compact
                                ? renderSearchHitsCompact(hits, tableWidth, {
                                      showScore: Boolean(opts.embed),
                                  })
                                : renderSearchHitsTable(hits, tableWidth, {
                                      showScore: Boolean(opts.embed),
                                  }),
                        );
                    },
                );
        },
    );
}
