import {
    addCommandOptions,
    type CliOptionItem,
    type CliOptionRawScalar,
    type OptionsBase,
    parsePositiveInteger,
    processCommandRawOptions,
    registerCommands,
} from "@andreas-timm/cli";
import type { CAC } from "cac";

type ListCommandOptions = OptionsBase & {
    json?: boolean;
    limit?: number;
    sort?: string;
    width?: number;
};

type ListSourcesCommandOptions = OptionsBase & {
    json?: boolean;
};

type ListVersionsCommandOptions = OptionsBase & {
    json?: boolean;
    all?: boolean;
    width?: number;
};

const JSON_OPTION = {
    rawName: "--json",
    description: "Emit results as JSON",
} as const satisfies CliOptionItem;

const WIDTH_OPTION = {
    rawName: "--width, -w <n>",
    description: "Table width in columns",
    config: {
        type: [
            (v: CliOptionRawScalar) =>
                v === undefined ? undefined : parsePositiveInteger(v, "--width"),
        ],
    },
} as const satisfies CliOptionItem;

const LIMIT_OPTION = {
    rawName: "--limit, -l <n>",
    description: "Limit number of skills returned",
    config: {
        type: [
            (v: CliOptionRawScalar) =>
                v === undefined ? undefined : parsePositiveInteger(v, "--limit"),
        ],
    },
} as const satisfies CliOptionItem;

const SORT_OPTION = {
    rawName: "--sort, -s <fields>",
    description: "Sort by comma-separated fields: date, approved, name, source, location",
    config: {
        type: [(v: CliOptionRawScalar) => (v === undefined ? undefined : String(v))],
    },
} as const satisfies CliOptionItem;

const ALL_OPTION = {
    rawName: "--all, -a",
    description: "Show all occurrences for each version as a second line",
} as const satisfies CliOptionItem;

const LIST_COMMAND_OPTIONS = [
    JSON_OPTION,
    LIMIT_OPTION,
    SORT_OPTION,
    WIDTH_OPTION,
] as const satisfies readonly CliOptionItem[];

const LIST_SOURCES_COMMAND_OPTIONS = [JSON_OPTION] as const satisfies readonly CliOptionItem[];

const LIST_VERSIONS_COMMAND_OPTIONS = [
    JSON_OPTION,
    ALL_OPTION,
    WIDTH_OPTION,
] as const satisfies readonly CliOptionItem[];

export function registerListCommands(cli: CAC): void {
    addCommandOptions(
        cli.command("", "List indexed skills from the skill SQLite db"),
        LIST_COMMAND_OPTIONS,
    ).action(async (rawOptions: Record<string, unknown>): Promise<void> => {
        const options = processCommandRawOptions<ListCommandOptions>(rawOptions);
        const { skillsAction } = await import("./skills");
        await skillsAction(options);
    });

    registerCommands(
        cli,
        ["sources"],
        "List indexed sources from the skill SQLite db",
        (command) => {
            addCommandOptions(command, LIST_SOURCES_COMMAND_OPTIONS).action(
                async (rawOptions: Record<string, unknown>) => {
                    const options = processCommandRawOptions<ListSourcesCommandOptions>(rawOptions);
                    const { sourcesAction } = await import("./sources");
                    await sourcesAction(options);
                },
            );
        },
    );

    registerCommands(
        cli,
        ["versions [skill_ref]"],
        "List indexed skill versions (optionally filtered by skill reference)",
        (command) => {
            addCommandOptions(command, LIST_VERSIONS_COMMAND_OPTIONS).action(
                async (skill: string | undefined, rawOptions: Record<string, unknown>) => {
                    const options =
                        processCommandRawOptions<ListVersionsCommandOptions>(rawOptions);
                    const { skillVersionsAction } = await import("./skills");
                    await skillVersionsAction({
                        skill,
                        json: options.json,
                        all: options.all,
                        width: options.width,
                    });
                },
            );
        },
    );
}
