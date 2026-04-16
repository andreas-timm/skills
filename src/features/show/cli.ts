import { registerCommands } from "@andreas-timm/cli";
import type { CAC } from "cac";

export function registerShowCommands(cli: CAC): void {
    registerCommands(
        cli,
        ["show <skill_ref>"],
        "Show an indexed skill by id, short id, name@version, latest name, or subpath",
        (command) => {
            command
                .option("--json", "Emit the resolved skill as JSON")
                .action(async (skill: string, opts: { json?: boolean }) => {
                    const { skillAction } = await import("./skill");
                    await skillAction(skill, opts);
                });
        },
    );
}
