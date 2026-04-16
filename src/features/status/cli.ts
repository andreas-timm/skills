import { registerCommands } from "@andreas-timm/cli";
import type { CAC } from "cac";

export function registerStatusCommands(cli: CAC): void {
    const runStatus = async (): Promise<void> => {
        const { statusAction } = await import("./status");
        await statusAction();
    };

    registerCommands(cli, ["status"], "Show config and database status", (command) => {
        command.action(runStatus);
    });
}
