import { addCommandOptions, registerCommands } from "@andreas-timm/cli";
import type { CAC } from "cac";
import { APPROVE_COMMAND_OPTIONS } from "./options";

export function registerApproveCommands(cli: CAC): void {
    registerCommands(
        cli,
        ["approve source <source_id>"],
        "Set approval metadata for an indexed source",
        (command) => {
            addCommandOptions(command, APPROVE_COMMAND_OPTIONS).action(
                async (id: string, rawOptions: Record<string, unknown>) => {
                    const { sourceAction } = await import("./actions/source");
                    await sourceAction(id, rawOptions, command);
                },
            );
        },
    );

    registerCommands(
        cli,
        ["approve skill <skill_id>"],
        "Set approval metadata for an indexed skill",
        (command) => {
            addCommandOptions(command, APPROVE_COMMAND_OPTIONS).action(
                async (skillId: string, rawOptions: Record<string, unknown>) => {
                    const { skillAction } = await import("./actions/skill");
                    await skillAction(skillId, rawOptions, command);
                },
            );
        },
    );
}
