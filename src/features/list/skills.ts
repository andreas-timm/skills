import { createTable, resolveTableWidth } from "@andreas-timm/cli-table";
import { getLogger } from "@andreas-timm/logger";
import { loadConfig } from "@config";
import { approvedLocationNames } from "@features/approve/effective";
import {
    listSkillOccurrences,
    listSkills,
    listSkillVersions,
    type SkillListRow,
    type SkillOccurrenceListRow,
    type SkillVersionListRow,
} from "@features/list/query";
import { toPublicSkillVersion } from "@features/skill/version";
import { resolveSkillsDbPath } from "@features/update/paths";
import { formatDateUtc } from "@libs/date";
import stringWidth from "string-width";
import { formatApprovalSummary, normalizeInline } from "./format";
import { renderSkillListTable } from "./table";

export { formatSkillListName } from "./table";

const logger = getLogger();

const COLUMN_GAP = 1;
const MIN_DESCRIPTION_WIDTH = 12;
const SKILL_LIST_SORT_FIELDS = ["date", "approved", "name", "source", "location"] as const;

type SkillListSortField = (typeof SKILL_LIST_SORT_FIELDS)[number];

function compareNullableStringsAsc(left: string | null, right: string | null): number {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right);
}

function compareNullableStringsDesc(left: string | null, right: string | null): number {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return right.localeCompare(left);
}

function compareSkillListRowsByField(
    left: SkillListRow,
    right: SkillListRow,
    field: SkillListSortField,
): number {
    switch (field) {
        case "date":
            return compareNullableStringsDesc(left.date, right.date);
        case "approved":
            return Number(right.status === "approved") - Number(left.status === "approved");
        case "name":
            return compareNullableStringsAsc(left.name, right.name);
        case "source":
            return compareNullableStringsAsc(left.source_name, right.source_name);
        case "location":
            return compareNullableStringsAsc(left.location, right.location);
    }
}

export function parseSkillListSort(rawSort: string | undefined): SkillListSortField[] {
    if (rawSort === undefined || rawSort.trim() === "") {
        return [];
    }

    return rawSort
        .split(",")
        .map((field) => field.trim().toLowerCase())
        .filter(Boolean)
        .map((field) => {
            if (!SKILL_LIST_SORT_FIELDS.includes(field as SkillListSortField)) {
                throw new Error(
                    `Invalid --sort field "${field}". Supported fields: ${SKILL_LIST_SORT_FIELDS.join(", ")}.`,
                );
            }
            return field as SkillListSortField;
        });
}

export function sortSkillListRows(
    rows: readonly SkillListRow[],
    sortFields: readonly SkillListSortField[],
): SkillListRow[] {
    if (sortFields.length === 0) {
        return [...rows];
    }

    return [...rows].sort((left, right) => {
        for (const field of sortFields) {
            const fieldComparison = compareSkillListRowsByField(left, right, field);
            if (fieldComparison !== 0) {
                return fieldComparison;
            }
        }
        return left.id.localeCompare(right.id);
    });
}

export function applySkillListOptions(
    rows: readonly SkillListRow[],
    opts: { limit?: number; sort?: string },
): SkillListRow[] {
    const sortFields = parseSkillListSort(opts.sort);
    const sortedRows = sortSkillListRows(rows, sortFields);
    return opts.limit === undefined ? sortedRows : sortedRows.slice(0, opts.limit);
}

export function displaySubpath(sourceName: string, subpath: string): string {
    const normalizedSource = sourceName.replaceAll("\\", "/").replace(/^\/+/, "");
    const normalizedSubpath = subpath.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!normalizedSource || !normalizedSubpath) {
        return subpath;
    }

    const repoName = normalizedSource.split("/").filter(Boolean).at(-1);
    const prefixes = new Set<string>([normalizedSource]);
    if (repoName) {
        prefixes.add(repoName);
        prefixes.add(repoName.toLowerCase().endsWith(".git") ? repoName : `${repoName}.git`);
    }

    for (const candidate of prefixes) {
        const prefix = `${candidate}/`;
        if (normalizedSubpath.startsWith(prefix)) {
            return normalizedSubpath.slice(prefix.length);
        }
    }
    return subpath;
}

export function formatOccurrenceDetail(
    occurrence: Pick<SkillOccurrenceListRow, "location" | "source_name" | "subpath">,
): string {
    return `${occurrence.location} | ${occurrence.source_name} | ${displaySubpath(occurrence.source_name, occurrence.subpath)}`;
}

function widestCell(cells: string[]): number {
    return Math.max(
        0,
        ...cells.flatMap((cell) => cell.split("\n").map((line) => stringWidth(line))),
    );
}

export async function skillsAction(opts: {
    json?: boolean;
    full?: boolean;
    limit?: number;
    sort?: string;
    width?: number;
}): Promise<void> {
    const config = await loadConfig();
    const dbPath = resolveSkillsDbPath(config);
    const skills = applySkillListOptions(
        listSkills(dbPath, {
            approvedLocations: approvedLocationNames(config),
        }),
        opts,
    );
    const outputSkills = skills.map(toPublicSkillVersion);

    if (opts.json) {
        process.stdout.write(`${JSON.stringify(outputSkills, null, 2)}\n`);
        return;
    }

    if (skills.length === 0) {
        logger.warn("No skills found");
        return;
    }

    process.stdout.write(renderSkillListTable(skills, { width: opts.width }));
}

export async function skillVersionsAction(opts: {
    skill?: string;
    json?: boolean;
    full?: boolean;
    all?: boolean;
    width?: number | string;
}): Promise<void> {
    const config = await loadConfig();
    const dbPath = resolveSkillsDbPath(config);
    const rows = listSkillVersions(dbPath, opts.skill, {
        approvedLocations: approvedLocationNames(config),
    });
    const outputRows = rows.map((row: SkillVersionListRow) => toPublicSkillVersion(row));
    if (opts.json) {
        process.stdout.write(`${JSON.stringify(outputRows, null, 2)}\n`);
        return;
    }
    if (rows.length === 0) {
        logger.warn("No skill versions found");
        return;
    }
    const tableWidth = resolveTableWidth(opts.width, { fallback: 120 });
    const full = opts.full ?? false;
    const all = opts.all ?? false;
    const renderedRows = outputRows.map((row) => ({
        id: row.id,
        date: formatDateUtc(row.date),
        version: row.version,
        name: row.name ?? "-",
        duplicates: `${row.duplicate}`,
        description: row.description ? normalizeInline(row.description) : "-",
        approval: formatApprovalSummary(row, { full }) ?? "",
    }));
    const widths = {
        id: widestCell(renderedRows.map((row) => row.id)),
        date: widestCell(renderedRows.map((row) => row.date)),
        version: widestCell(renderedRows.map((row) => row.version)),
        name: widestCell(renderedRows.map((row) => row.name)),
        duplicates: widestCell(renderedRows.map((row) => row.duplicates)),
        approval: widestCell(renderedRows.map((row) => row.approval)),
    };
    const fixedInner =
        widths.id +
        widths.date +
        widths.version +
        widths.name +
        widths.duplicates +
        widths.approval +
        (Object.keys(widths).length + 1) * COLUMN_GAP;
    const descMeasured = widestCell(renderedRows.map((row) => row.description));
    const descWidth = full
        ? descMeasured
        : Math.max(MIN_DESCRIPTION_WIDTH, tableWidth - fixedInner);
    const table = createTable({
        columnGap: COLUMN_GAP,
        colWidths: [
            widths.id,
            widths.date,
            widths.version,
            widths.name,
            widths.duplicates,
            descWidth,
            widths.approval,
        ],
        wordWrap: !full,
        wrapOnWordBoundary: true,
    });
    const tableWithLine = table as typeof table & {
        pushLine: (content: string, options?: { indent?: number }) => void;
    };
    for (const row of renderedRows) {
        table.push([
            row.id,
            row.date,
            row.version,
            row.name,
            row.duplicates,
            row.description,
            row.approval,
        ]);
        if (all) {
            tableWithLine.pushLine(
                listSkillOccurrences(dbPath, row.id).map(formatOccurrenceDetail).join("\n"),
            );
        }
    }
    process.stdout.write(`${table.toString()}\n`);
}
