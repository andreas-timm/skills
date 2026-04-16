import { getLogger } from "@andreas-timm/logger";
import type { HelpPrinter } from "@features/approve/options";
import { setSourceApproval } from "@features/approve/query";
import { parseApproveOptions, resolveConfiguredDbPath, writeJsonOutput } from "./shared";

const logger = getLogger();

export async function sourceAction(
    id: string,
    rawOptions: Record<string, unknown>,
    command: HelpPrinter,
): Promise<void> {
    const { patch, json } = parseApproveOptions(command, rawOptions);
    const dbPath = await resolveConfiguredDbPath();
    const approval = setSourceApproval(dbPath, id, patch);

    if (json) {
        writeJsonOutput(approval);
        return;
    }

    logger.info(`Updated source approval for ${id}`);
}
