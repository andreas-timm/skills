import { createTable, isPipedOutput, type TableWidth } from "@andreas-timm/cli-table";
import type { SkillListRow } from "@features/list/query";
import { toPublicSkillVersion } from "@features/skill/version";
import { formatDateUtc } from "@libs/date";
import { normalizeInline } from "./format";

const COLUMN_GAP = 1;

export type SkillListTableSkill = Pick<
    SkillListRow,
    | "id"
    | "date"
    | "version_order"
    | "version_count"
    | "duplicate"
    | "name"
    | "version"
    | "description"
    | "location"
    | "source_name"
    | "status"
> & {
    disabled?: true;
};

type RenderedSkillListTableRow = {
    id: string;
    date: string;
    version: string;
    name: string;
    description: string;
};

export function resolveSkillListTableWidth(width?: number): TableWidth {
    if (width !== undefined) {
        return width === 0 ? "full" : width;
    }
    return isPipedOutput() ? "full" : "terminal";
}

export function formatSkillListName(
    skill: Pick<SkillListRow, "name" | "location" | "source_name" | "status"> & {
        disabled?: true;
    },
    full?: boolean,
): string {
    const approved = skill.status === "approved" ? " ✅" : "";
    const disabled = skill.disabled ? " 🚫 disabled" : "";
    const content = [`${skill.name ?? "-"}${approved}${disabled}`];

    if (skill.location) {
        content.push(skill.location);
    }

    if (skill.source_name && skill.location !== skill.source_name) {
        content.push(skill.source_name);
    }

    return full ? content.join(" | ") : content.join("\n");
}

function toRenderedSkillListTableRows(
    skills: readonly SkillListTableSkill[],
    tableWidth: TableWidth,
): RenderedSkillListTableRow[] {
    return skills.map(toPublicSkillVersion).map((skill) => {
        return {
            id: skill.id,
            date: formatDateUtc(skill.date),
            version: `${skill.version_count}|${skill.duplicate}`,
            name: formatSkillListName(skill, tableWidth === "full"),
            description: skill.description ? normalizeInline(skill.description) : "-",
        };
    });
}

export function renderSkillListTable(
    skills: readonly SkillListTableSkill[],
    options: { tableWidth?: TableWidth; width?: number } = {},
): string {
    const tableWidth = options.tableWidth ?? resolveSkillListTableWidth(options.width);
    const rows = toRenderedSkillListTableRows(skills, tableWidth);
    const table = createTable({
        columnGap: COLUMN_GAP,
        columns: [
            { index: 0, width: 8 },
            { index: 1, width: tableWidth === "full" ? 16 : 10 },
            { index: 2, width: 3 },
            {
                index: 3,
                fit: "content",
                maxWidth: tableWidth === "full" ? undefined : 35,
            },
        ],
        wordWrap: true,
        tableWidth,
    });

    for (const row of rows) {
        table.push([row.id, row.date, row.version, row.name, row.description]);
    }

    return `${table.toString()}\n`;
}
