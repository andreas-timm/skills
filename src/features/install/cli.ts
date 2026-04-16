import {
    addCommandOptions,
    type CliOptionItem,
    type CliOptionRawScalar,
    processCommandRawOptions,
    registerCommands,
} from "@andreas-timm/cli";
import { AGENT_NAMES, type AgentName } from "@features/agent/skills-dir";
import type { CAC } from "cac";

type InstallCommandOptions = {
    force?: boolean;
    global?: AgentName;
};

const INSTALL_COMMAND_OPTIONS = [
    {
        rawName: "--force",
        description: "Install even when the skill is not approved",
    },
    {
        rawName: "--global, -g [user_agent]",
        description: "Install into a user-level agent skills folder",
        config: {
            type: [(value: CliOptionRawScalar) => (value === true ? "default" : value)],
            choices: AGENT_NAMES,
        },
    },
] as const satisfies readonly CliOptionItem[];

export function registerInstallCommands(cli: CAC): void {
    registerCommands(
        cli,
        ["install <skill_id>"],
        "Install a skill into the current project or a user-level agent folder",
        (command) => {
            addCommandOptions(command, INSTALL_COMMAND_OPTIONS).action(
                async (skillId: string, rawOptions: Record<string, unknown>) => {
                    const options = processCommandRawOptions<InstallCommandOptions>(rawOptions);
                    const { installAction } = await import("./install-action");
                    await installAction({
                        skill: skillId,
                        force: Boolean(options.force),
                        global: options.global,
                    });
                },
            );
        },
    );
}
