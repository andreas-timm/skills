import { createTable, resolveTableWidth } from "@andreas-timm/cli-table";
import type { SkillHit } from "@features/search/query";
import stringWidth from "string-width";

/** Horizontal gap between columns (`chars.middle` width). */
const COLUMN_GAP = 1;
const SHORT_ID_HEADER = "short_id";
const SHORT_ID_WIDTH_CAP = 12;

export type SearchRenderOptions = {
    showScore?: boolean;
};

export function writeJsonOutput(hits: SkillHit[]): void {
    process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`);
}

export function resolveSearchTableWidth(widthOpt: number | string | undefined): number {
    return resolveTableWidth(widthOpt);
}

/** Caps so very long source/skill strings wrap and width flows to description. */
const SOURCE_WIDTH_CAP = 22;
const SKILL_WIDTH_CAP = 26;

function normalizeCellNewlines(text: string): string {
    return text.replace(/\r\n/g, "\n");
}

/** Widest display width of any single line (for multiline cell text). */
function maxLineStringWidth(text: string): number {
    const lines = normalizeCellNewlines(text).split("\n");
    return Math.max(0, ...lines.map((line) => stringWidth(line)));
}

/**
 * Multiline source cell: keep explicit newlines; otherwise break path segments
 * on `/` so `owner\n/repo` stacks vertically (still word-wraps when narrower).
 */
function formatSourceColumnText(name: string): string {
    const n = normalizeCellNewlines(name);
    if (n.includes("\n")) {
        return n;
    }
    return n.replaceAll("/", "\n/s");
}

function sourceCellDisplay(hit: SkillHit): string {
    const occurrence = hit.primaryOccurrence;
    if (!occurrence) return "-";
    const location = occurrence.location.trim();
    const suffix = hit.occurrences.length > 1 ? ` (+${hit.occurrences.length - 1} more)` : "";
    const name = `${occurrence.sourceName}${suffix}`.trim();
    const source = formatSourceColumnText(name);
    if (!location) return source;
    if (location === source) return location;
    return `${location}\n${source}`;
}

/** Collapse whitespace and newlines for a single-line cell. */
function singleLineCell(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

function sourceCellSingleLine(hit: SkillHit): string {
    if (!hit.primaryOccurrence) return "-";
    const suffix = hit.occurrences.length > 1 ? ` (+${hit.occurrences.length - 1} more)` : "";
    return singleLineCell(
        `${hit.primaryOccurrence.location}|${hit.primaryOccurrence.sourceName}${suffix}`,
    );
}

function shortIdCellText(hit: SkillHit): string {
    return hit.skillId || "-";
}

function skillCellText(hit: SkillHit): string {
    const name = hit.name ?? hit.primaryOccurrence?.subpath ?? "";
    return hit.status === "approved" ? `${name} ✅` : name;
}

/**
 * cli-table3 inserts `chars.middle` between columns; total row width is
 * approximately sum(colWidths) + (numCols - 1) * COLUMN_GAP.
 *
 * Source and skill use only the width they need (capped); **description gets
 * all remaining inner width** so it is as wide as possible.
 */
function columnWidthsForSearchTable(
    totalWidth: number,
    hits: SkillHit[],
    options: SearchRenderOptions = {},
): number[] {
    const showScore = options.showScore ?? true;
    const gap = COLUMN_GAP;
    const numCols = showScore ? 5 : 4;
    const separatorTotal = (numCols - 1) * gap;
    const inner = Math.max(40, totalWidth - separatorTotal);
    const scoreW = showScore ? 7 : 0;

    const shortIdContentMax = Math.max(
        stringWidth(SHORT_ID_HEADER),
        ...hits.map((h) => stringWidth(shortIdCellText(h))),
    );
    const sourceContentMax = Math.max(
        stringWidth("source"),
        ...hits.map((h) => maxLineStringWidth(sourceCellDisplay(h))),
    );
    const skillContentMax = Math.max(
        stringWidth("skill"),
        ...hits.map((h) => stringWidth(skillCellText(h) || "-")),
    );

    const minShortId = stringWidth(SHORT_ID_HEADER);
    const minSource = 4;
    const minSkill = 5;
    const shortIdW = Math.max(minShortId, Math.min(shortIdContentMax, SHORT_ID_WIDTH_CAP));
    let sourceW = Math.max(minSource, Math.min(sourceContentMax, SOURCE_WIDTH_CAP));
    let skillW = Math.max(minSkill, Math.min(skillContentMax, SKILL_WIDTH_CAP));

    let descW = inner - shortIdW - scoreW - sourceW - skillW;
    if (descW < 12) {
        while (descW < 12 && (sourceW > minSource || skillW > minSkill)) {
            if (sourceW > minSource && sourceW >= skillW) {
                sourceW -= 1;
            } else if (skillW > minSkill) {
                skillW -= 1;
            } else {
                sourceW -= 1;
            }
            descW = inner - shortIdW - scoreW - sourceW - skillW;
        }
    }

    return showScore
        ? [shortIdW, sourceW, skillW, scoreW, descW]
        : [shortIdW, sourceW, skillW, descW];
}

/**
 * Compact table: source measured as one line (no `/` split); source column may be
 * wider than {@link SOURCE_WIDTH_CAP}. Description ellipsed; no wrap.
 */
function columnWidthsForCompactTable(
    totalWidth: number,
    hits: SkillHit[],
    options: SearchRenderOptions = {},
): number[] {
    const showScore = options.showScore ?? true;
    const gap = COLUMN_GAP;
    const numCols = showScore ? 5 : 4;
    const separatorTotal = (numCols - 1) * gap;
    const inner = Math.max(40, totalWidth - separatorTotal);
    const scoreW = showScore ? 7 : 0;

    const shortIdContentMax = Math.max(
        stringWidth(SHORT_ID_HEADER),
        ...hits.map((h) => stringWidth(singleLineCell(shortIdCellText(h)))),
    );
    const sourceContentMax = Math.max(
        stringWidth("source"),
        ...hits.map((h) => stringWidth(sourceCellSingleLine(h))),
    );
    const skillContentMax = Math.max(
        stringWidth("skill"),
        ...hits.map((h) => stringWidth(singleLineCell(skillCellText(h) || "-"))),
    );

    const minShortId = stringWidth(SHORT_ID_HEADER);
    const minSource = 4;
    const minSkill = 5;
    const shortIdW = Math.max(minShortId, Math.min(shortIdContentMax, SHORT_ID_WIDTH_CAP));
    const maxSourceW = inner - shortIdW - scoreW - minSkill - 12;
    let sourceW = Math.max(minSource, Math.min(sourceContentMax, Math.max(minSource, maxSourceW)));
    let skillW = Math.max(minSkill, Math.min(skillContentMax, SKILL_WIDTH_CAP));

    let descW = inner - shortIdW - scoreW - sourceW - skillW;
    if (descW < 12) {
        while (descW < 12 && (sourceW > minSource || skillW > minSkill)) {
            if (sourceW > minSource && sourceW >= skillW) {
                sourceW -= 1;
            } else if (skillW > minSkill) {
                skillW -= 1;
            } else {
                sourceW -= 1;
            }
            descW = inner - shortIdW - scoreW - sourceW - skillW;
        }
    }

    return showScore
        ? [shortIdW, sourceW, skillW, scoreW, descW]
        : [shortIdW, sourceW, skillW, descW];
}

export function renderSearchHitsTable(
    hits: SkillHit[],
    totalWidth: number,
    options: SearchRenderOptions = {},
): string {
    const showScore = options.showScore ?? true;
    const colWidths = columnWidthsForSearchTable(totalWidth, hits, options);
    const table = createTable({
        head: showScore
            ? [SHORT_ID_HEADER, "source", "skill", "score", "description"]
            : [SHORT_ID_HEADER, "source", "skill", "description"],
        colWidths,
        aligns: showScore ? [{ index: 3, type: "right" }] : [],
        columnGap: COLUMN_GAP,
        wordWrap: true,
        wrapOnWordBoundary: true,
    });

    for (const hit of hits) {
        const row = [shortIdCellText(hit), sourceCellDisplay(hit), skillCellText(hit)];
        if (showScore) {
            row.push(hit.score.toFixed(3));
        }
        row.push(hit.description ? normalizeCellNewlines(hit.description) : "");
        table.push(row);
    }

    return `${table.toString()}\n`;
}

/**
 * Truncates to at most `maxWidth` display columns, appending `…` when shortened.
 */
function ellipsisToDisplayWidth(text: string, maxWidth: number): string {
    const normalized = singleLineCell(text);
    if (maxWidth <= 0) {
        return "";
    }
    if (stringWidth(normalized) <= maxWidth) {
        return normalized;
    }
    const ellipsis = "…";
    const ellipsisW = stringWidth(ellipsis);
    if (maxWidth <= ellipsisW) {
        let out = "";
        for (const ch of ellipsis) {
            const next = out + ch;
            if (stringWidth(next) > maxWidth) {
                break;
            }
            out = next;
        }
        return out;
    }
    const budget = maxWidth - ellipsisW;
    let out = "";
    for (const ch of normalized) {
        const next = out + ch;
        if (stringWidth(next) > budget) {
            break;
        }
        out = next;
    }
    return `${out}${ellipsis}`;
}

/**
 * Borderless table, one row per hit: `source` on a single line (no `/` split),
 * `description` ellipsed to the column width; column gap is {@link COLUMN_GAP}.
 */
export function renderSearchHitsCompact(
    hits: SkillHit[],
    lineWidth: number,
    options: SearchRenderOptions = {},
): string {
    const showScore = options.showScore ?? true;
    const w = Math.max(20, lineWidth);
    const colWidths = columnWidthsForCompactTable(w, hits, options);
    const shortIdW = colWidths[0] ?? stringWidth(SHORT_ID_HEADER);
    const sourceW = colWidths[1] ?? 4;
    const skillW = colWidths[2] ?? 5;
    const descCol = colWidths[showScore ? 4 : 3] ?? 12;
    const table = createTable({
        head: showScore
            ? [SHORT_ID_HEADER, "source", "skill", "score", "description"]
            : [SHORT_ID_HEADER, "source", "skill", "description"],
        colWidths,
        aligns: showScore ? [{ index: 3, type: "right" }] : [],
        columnGap: COLUMN_GAP,
        wordWrap: false,
    });

    for (const hit of hits) {
        const shortIdRaw = singleLineCell(shortIdCellText(hit));
        const sourceRaw = sourceCellSingleLine(hit);
        const skillRaw = singleLineCell(skillCellText(hit));
        const row = [
            ellipsisToDisplayWidth(shortIdRaw, shortIdW),
            ellipsisToDisplayWidth(sourceRaw, sourceW),
            ellipsisToDisplayWidth(skillRaw, skillW),
        ];
        if (showScore) {
            row.push(hit.score.toFixed(3));
        }
        row.push(hit.description ? ellipsisToDisplayWidth(hit.description, descCol) : "");
        table.push(row);
    }

    return `${table.toString()}\n`;
}
