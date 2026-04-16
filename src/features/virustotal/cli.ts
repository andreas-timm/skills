import type { CliOptionItem, CliOptionRawScalar } from "@andreas-timm/cli";
import {
    addCommandOptions,
    parsePositiveInteger,
    processCommandRawOptions,
    registerCommands,
} from "@andreas-timm/cli";
import type { CAC } from "cac";
import type { SkillZipStyle } from "../zip/deterministic-zip.ts";
import type { VirusTotalActionOptions } from "./virustotal.ts";

type VirusTotalCliOptions = {
    style?: SkillZipStyle;
    timeout?: number;
    pollInterval?: number;
    json?: boolean;
};

const VIRUSTOTAL_OPTIONS = [
    {
        rawName: "--style <style>",
        description: "Archive layout to upload: unix (default) or dos; matches the zip command",
        config: { default: "unix", choices: ["unix", "dos"] },
    },
    {
        rawName: "--timeout <seconds>",
        description: "Maximum seconds to wait for VirusTotal analysis",
        config: {
            default: 300,
            type: [(value: CliOptionRawScalar) => parsePositiveInteger(value, "--timeout")],
        },
    },
    {
        rawName: "--poll-interval <seconds>",
        description: "Seconds between analysis status checks",
        config: {
            default: 15,
            type: [(value: CliOptionRawScalar) => parsePositiveInteger(value, "--poll-interval")],
        },
    },
    {
        rawName: "--json",
        description: "Emit upload, analysis, and file report as JSON",
    },
] as const satisfies readonly CliOptionItem[];

export function registerVirusTotalCommands(cli: CAC): void {
    registerCommands(
        cli,
        ["virustotal <skill_id>"],
        "Upload a deterministic skill zip to VirusTotal and show the scan report",
        (command) => {
            addCommandOptions(command, VIRUSTOTAL_OPTIONS).action(
                async (skillId: string, rawOptions: VirusTotalCliOptions) => {
                    const options = processCommandRawOptions<VirusTotalCliOptions>(rawOptions);
                    const { virustotalAction } = await import("./virustotal.ts");
                    const actionOptions: VirusTotalActionOptions = {
                        skill: skillId,
                        style: options.style,
                        timeoutSeconds: options.timeout,
                        pollIntervalSeconds: options.pollInterval,
                        json: options.json,
                    };
                    await virustotalAction(actionOptions);
                },
            );
        },
    );
}
