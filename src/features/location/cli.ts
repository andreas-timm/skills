import { registerCommands } from "@andreas-timm/cli";
import type { CAC } from "cac";

type SetLocationOptions = {
    tags?: string;
    approved?: boolean;
    config?: string;
};

type RemoveLocationOptions = {
    config?: string;
};

export function registerLocationCommands(cli: CAC): void {
    registerCommands(
        cli,
        ["location set <name> [dir]"],
        "Create or update a named skills location in the user config",
        (command) => {
            command
                .option(
                    "--tags <tags>",
                    "Comma-separated tags; when updating, replaces existing tags",
                )
                .option(
                    "--approved",
                    "Set location approved=true (omit to leave unchanged when updating)",
                )
                .option(
                    "--config <path>",
                    "Override config file path (defaults to USER_CONFIG_PATH)",
                )
                .action(
                    async (name: string, dir: string | undefined, options: SetLocationOptions) => {
                        const { setLocationAction } = await import("./location");
                        await setLocationAction(name, dir, options);
                    },
                );
        },
    );

    registerCommands(
        cli,
        ["location remove <name>"],
        "Remove a named skills location from the user config",
        (command) => {
            command
                .option(
                    "--config <path>",
                    "Override config file path (defaults to USER_CONFIG_PATH)",
                )
                .action(async (name: string, options: RemoveLocationOptions) => {
                    const { removeLocationAction } = await import("./location");
                    await removeLocationAction(name, options);
                });
        },
    );

    registerCommands(cli, ["location list"], "List configured skills locations", (command) => {
        command.action(async () => {
            const { listLocationAction } = await import("./location");
            await listLocationAction();
        });
    });
}
