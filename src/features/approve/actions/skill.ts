import { getLogger } from "@andreas-timm/logger";
import type { HelpPrinter } from "@features/approve/options";
import { setSkillApproval } from "@features/approve/query";
import { parseApproveOptions, resolveConfiguredDbPath, writeJsonOutput } from "./shared";

const logger = getLogger();

export async function skillAction(
    skillId: string,
    rawOptions: Record<string, unknown>,
    command: HelpPrinter,
): Promise<void> {
    const { patch, json } = parseApproveOptions(command, rawOptions);
    const dbPath = await resolveConfiguredDbPath();
    const approval = setSkillApproval(dbPath, skillId, patch);

    if (json) {
        writeJsonOutput(approval);
        return;
    }

    logger.info(`Updated skill approval for ${skillId}`);
}
