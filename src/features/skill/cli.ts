import {
    addCommandOptions,
    type CliOptionItem,
    processCommandRawOptions,
    registerCommands,
} from "@andreas-timm/cli";
import type { CAC } from "cac";

type LsCommandOptions = {
    global?: boolean;
};

const LS_COMMAND_OPTIONS = [
    {
        rawName: "--global, -g",
        description: "List skills installed in user-level agent folders",
    },
] as const satisfies readonly CliOptionItem[];

export function registerLsCommands(cli: CAC): void {
    registerSkillCommands(cli);
}

export function registerSkillCommands(cli: CAC): void {
    registerCommands(cli, ["ls"], "List installed skills", (command) => {
        addCommandOptions(command, LS_COMMAND_OPTIONS).action(
            async (rawOptions: Record<string, unknown>) => {
                const options = processCommandRawOptions<LsCommandOptions>(rawOptions);
                const { runLs } = await import("./run-ls.ts");
                await runLs(process.cwd(), {
                    global: Boolean(options.global),
                });
            },
        );
    });

    registerCommands(
        cli,
        ["rm <skill_ref>"],
        "Remove an installed skill from the current project",
        (command) => {
            command.action(async (skillRef: string) => {
                const { runRm } = await import("./run-rm.ts");
                await runRm(skillRef);
            });
        },
    );

    registerCommands(
        cli,
        ["disable <skill_ref>"],
        "Disable an installed skill in the current project",
        (command) => {
            command.action(async (skillRef: string) => {
                const { runDisable } = await import("./run-disable.ts");
                await runDisable(skillRef);
            });
        },
    );

    registerCommands(
        cli,
        ["enable <skill_ref>"],
        "Enable a disabled skill in the current project",
        (command) => {
            command.action(async (skillRef: string) => {
                const { runEnable } = await import("./run-enable.ts");
                await runEnable(skillRef);
            });
        },
    );
}
