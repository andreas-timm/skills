import { registerCommands } from "@andreas-timm/cli";
import type { CAC } from "cac";
import type { SkillZipStyle } from "./deterministic-zip.ts";
import type { ZipActionOptions } from "./zip-action.ts";

export function registerZipCommands(cli: CAC): void {
    registerCommands(
        cli,
        ["zip <skill_id>"],
        "Build and verify a deterministic skill zip; print SHA-256 only, or write zip bytes with -o / --output",
        (command) => {
            command
                .option(
                    "--style <style>",
                    "Archive layout: 'unix' (default, DEFLATE+UT/ux extras) or 'dos' (DEFLATE, no extras)",
                    { default: "unix" },
                )
                .option(
                    "-o, --output [path]",
                    "Write zip bytes to stdout (-o with no path), to a file (-o <path>), or use -o=- for stdout; omit to print only SHA-256",
                )
                .option("--json", "Emit path, style, sha256, size, and entries as JSON")
                .action(
                    async (
                        skillId: string,
                        opts: {
                            output?: string | boolean;
                            style?: SkillZipStyle;
                            json?: boolean;
                        },
                    ) => {
                        const { zipAction } = await import("./zip-action.ts");
                        const zipOptions: ZipActionOptions = {
                            skill: skillId,
                            style: opts.style,
                            output: opts.output,
                            json: opts.json,
                        };
                        await zipAction(zipOptions);
                    },
                );
        },
    );
}
