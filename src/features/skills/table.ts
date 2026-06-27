import { createTable, isPipedOutput, type TableWidth } from "@andreas-timm/cli-table";
import { typeBadges } from "@features/approve/skill-types";
import { toPublicSkillVersion } from "@features/skill/version";
import { formatDateUtc } from "@libs/date";
import stringWidth from "string-width";
import { normalizeInline } from "./format";
import type { SkillListRow } from "./query";

const COLUMN_GAP = 1;
const ID_COLUMN_WIDTH = 8;
const DATE_COLUMN_WIDTH = 16;
const VERSION_COLUMN_WIDTH = 3;
const DETAIL_NAME_COLUMN_WIDTH = 35;
const DETAIL_LINE_INDENT =
    ID_COLUMN_WIDTH + DATE_COLUMN_WIDTH + VERSION_COLUMN_WIDTH + COLUMN_GAP * 3;

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
    | "tags"
> & {
    disabled?: true;
    sourceRootDir?: string;
};

type RenderedSkillListTableRow = {
    id: string;
    date: string;
    detail?: string;
    version: string;
    name: string;
    type: string;
    description: string;
};

export function resolveSkillListTableWidth(width?: number): TableWidth {
    if (width !== undefined) {
        return width === 0 ? "full" : width;
    }
    return isPipedOutput() ? "full" : "terminal";
}

export function formatSkillListName(
    skill: Pick<SkillListRow, "name" | "location" | "source_name"> & {
        disabled?: true;
    },
    full?: boolean,
): string {
    const disabled = skill.disabled ? " 🚫 disabled" : "";
    const content = [`${skill.name ?? "-"}${disabled}`];

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
            detail: skill.sourceRootDir,
            version: `${skill.version_count}|${skill.duplicate}`,
            name: formatSkillListName(skill, tableWidth === "full"),
            type: typeBadges(skill.status, skill.tags),
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
    const hasDetailRows = rows.some((row) => row.detail);
    // Width the badge column explicitly: `fit: "content"` mis-measures some
    // single-codepoint emoji (e.g. ✅) and clips them to an ellipsis.
    const typeWidth = Math.max(0, ...rows.map((row) => stringWidth(row.type)));
    const hasTypeRows = typeWidth > 0;
    const table = createTable({
        columnGap: COLUMN_GAP,
        columns: [
            { index: 0, width: ID_COLUMN_WIDTH },
            { index: 1, width: DATE_COLUMN_WIDTH },
            { index: 2, width: VERSION_COLUMN_WIDTH },
            {
                index: 3,
                fit: "content",
                minWidth: hasDetailRows ? DETAIL_NAME_COLUMN_WIDTH : undefined,
                maxWidth: tableWidth === "full" ? undefined : 35,
            },
            // Only reserve a type column when at least one row carries a badge.
            ...(hasTypeRows ? [{ index: 4, width: typeWidth } as const] : []),
        ],
        wordWrap: true,
        tableWidth,
    });

    for (const row of rows) {
        const cells = [row.id, row.date, row.version, row.name];
        if (hasTypeRows) {
            cells.push(row.type);
        }
        cells.push(row.description);
        table.push(cells);
        if (row.detail) {
            table.pushLine(row.detail, { indent: DETAIL_LINE_INDENT });
        }
    }

    return `${table.toString()}\n`;
}
