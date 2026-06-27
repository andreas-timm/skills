import { createTable, isPipedOutput, type TableWidth } from "@andreas-timm/cli-table";
import { loadConfig } from "@config";
import { shortSkillId } from "@features/skill/id";
import { resolveSkillsDbPath } from "@features/update/paths";
import { formatDateUtc } from "@libs/date";
import { type InstallRecord, listInstalls } from "./installs";

function resolveInstallsTableWidth(): TableWidth {
    return isPipedOutput() ? "full" : "terminal";
}

function formatProject(record: InstallRecord): string {
    if (!record.projectDir) return "-";
    return record.gitBranch ? `${record.projectDir} @${record.gitBranch}` : record.projectDir;
}

export function formatInstalls(records: readonly InstallRecord[]): string {
    const table = createTable({
        head: ["when", "skill", "scope", "where", "project"],
        tableWidth: resolveInstallsTableWidth(),
        wordWrap: true,
    });

    for (const record of records) {
        table.push([
            formatDateUtc(record.installedAt),
            `${record.name} (${shortSkillId(record.skillId)})`,
            record.scope,
            record.targetDir,
            formatProject(record),
        ]);
    }

    return `${table.toString()}\n`;
}

export async function installsAction(): Promise<void> {
    const config = await loadConfig();
    const records = listInstalls(resolveSkillsDbPath(config));

    if (records.length === 0) {
        process.stdout.write("No recorded installs.\n");
        return;
    }

    process.stdout.write(formatInstalls(records));
}
