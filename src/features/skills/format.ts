import type { ApprovalStatus } from "@features/approve/status.ts";
import stringWidth from "string-width";

export function normalizeInline(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

export function padEndWide(text: string, width: number): string {
    const pad = width - stringWidth(text);
    return pad > 0 ? text + " ".repeat(pad) : text;
}

export function fitWide(text: string, width: number): string {
    return padEndWide(truncate(text, width), width);
}

export function truncate(text: string, max: number): string {
    const normalized = normalizeInline(text);
    if (stringWidth(normalized) <= max) return normalized;
    let out = "";
    let w = 0;
    for (const ch of normalized) {
        const cw = stringWidth(ch);
        if (w + cw > max - 1) break;
        out += ch;
        w += cw;
    }
    return `${out}…`;
}

export function formatApprovalSummary(
    approval: {
        status: ApprovalStatus | null | undefined;
        rating: number | null;
        tags: string[];
        note: string | null;
    },
    opts: { full?: boolean } = {},
): string | null {
    const parts: string[] = [];

    if (approval.status) {
        parts.push(approval.status);
    }
    if (approval.rating !== null) {
        parts.push(`${approval.rating}/10`);
    }
    if (approval.tags.length > 0) {
        parts.push(`#${approval.tags.join(",#")}`);
    }
    if (approval.note) {
        const note = opts.full ? normalizeInline(approval.note) : truncate(approval.note, 48);
        parts.push(parts.length > 0 ? `— ${note}` : note);
    }

    return parts.length > 0 ? `[${parts.join(" ")}]` : null;
}
