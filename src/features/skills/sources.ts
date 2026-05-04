import { getLogger } from "@andreas-timm/logger";
import { loadConfig } from "@config";
import { resolveSkillsDbPath } from "@features/update/paths";
import { formatDateUtc } from "@libs/date";
import stringWidth from "string-width";
import { formatApprovalSummary, padEndWide } from "./format";
import { listSources } from "./query";

const logger = getLogger();

export async function sourcesAction(opts: { json?: boolean }): Promise<void> {
    const config = await loadConfig();
    const dbPath = resolveSkillsDbPath(config);
    const sources = listSources(dbPath);

    if (opts.json) {
        process.stdout.write(`${JSON.stringify(sources, null, 2)}\n`);
        return;
    }

    if (sources.length === 0) {
        logger.warn("No sources found");
        return;
    }

    const nameW = Math.max(...sources.map((b) => stringWidth(b.name)));
    for (const source of sources) {
        const name = padEndWide(source.name, nameW);
        const remote = source.remote ?? "-";
        const branch = source.branch ?? "-";
        const date = formatDateUtc(source.date);
        const shortSha = source.commit ? source.commit.slice(0, 7) : "-";
        const gitFlag = source.git ? "git" : "local";
        const approval = formatApprovalSummary(source);
        const approvalSuffix = approval ? ` ${approval}` : "";

        process.stdout.write(
            `${source.id} ${date} ${name} [${gitFlag}] ${remote} (${branch}, ${shortSha})${approvalSuffix}\n`,
        );
    }
}
