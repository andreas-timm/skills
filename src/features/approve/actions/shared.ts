import { parsePositiveInteger, processCommandRawOptions } from "@andreas-timm/cli";
import { loadConfig } from "@config";
import type { ApproveOptions, HelpPrinter } from "@features/approve/options";
import type { ApprovalPatch } from "@features/approve/query";
import { parseApprovalStatus } from "@features/approve/status";
import { resolveSkillsDbPath } from "@features/update/paths";

function parseTags(rawTags: string): string[] {
    return rawTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
}

export function parseApproveOptions(
    command: HelpPrinter,
    rawOptions: Record<string, unknown>,
): { patch: ApprovalPatch; json: boolean } {
    const options = processCommandRawOptions<ApproveOptions>(rawOptions);
    const patch: ApprovalPatch = {};

    if (options.status !== undefined) {
        patch.status = parseApprovalStatus(options.status);
    }

    if (options.rating !== undefined) {
        const rating = parsePositiveInteger(options.rating, "rating");
        if (rating > 10) {
            throw new Error("Rating must be between 1 and 10.");
        }
        patch.rating = rating;
    }

    if (options.tags !== undefined) {
        patch.tags = parseTags(options.tags);
    }

    if (options.note !== undefined) {
        patch.note = options.note;
    }

    if (Object.keys(patch).length === 0) {
        command.outputHelp();
        throw new Error("Provide at least one of --status, --rating, --tags, or --note.");
    }

    return {
        patch,
        json: Boolean(options.json),
    };
}

export async function resolveConfiguredDbPath(): Promise<string> {
    const config = await loadConfig();
    return resolveSkillsDbPath(config);
}

export function writeJsonOutput(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
