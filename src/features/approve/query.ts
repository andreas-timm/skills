import { Database } from "bun:sqlite";
import { shortSkillId } from "@features/skill/id";
import { resolveSkillReferenceInDb } from "@features/skill/reference";
import { type ApprovalStatus, parseApprovalStatus } from "./status";

export type ApprovalPatch = {
    status?: ApprovalStatus;
    rating?: number;
    tags?: string[];
    note?: string;
};

type ApprovalRow = {
    status: string | null;
    rating: number | null;
    tags: string[];
    note: string | null;
};

type ApprovalRowRaw = {
    status: string | null;
    rating: number | null;
    tags: string | null;
    note: string | null;
};

export type SourceApprovalRow = ApprovalRow & {
    source_id: string;
};

export type SkillApprovalRow = ApprovalRow & {
    skill_id: string;
};

function parseTags(rawTags: string | null): string[] {
    if (!rawTags) {
        return [];
    }

    try {
        const parsed = JSON.parse(rawTags);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((tag): tag is string => typeof tag === "string");
    } catch {
        return [];
    }
}

function validatePatch(patch: ApprovalPatch): void {
    if (
        patch.status === undefined &&
        patch.rating === undefined &&
        patch.tags === undefined &&
        patch.note === undefined
    ) {
        throw new Error("Provide at least one of --status, --rating, --tags, or --note.");
    }

    if (
        patch.rating !== undefined &&
        (!Number.isInteger(patch.rating) || patch.rating < 1 || patch.rating > 10)
    ) {
        throw new Error("Rating must be an integer between 1 and 10.");
    }
}

function ensureTargetExists(
    db: Database,
    table: "sources" | "skills",
    id: string,
    label: "Source" | "Skill",
): void {
    const row = db
        .query<{ found: number }, [string]>(`SELECT 1 AS found FROM ${table} WHERE id = ?`)
        .get(id);

    if (!row) {
        throw new Error(`${label} not found: ${id}`);
    }
}

function resolveSkillPrimaryKey(db: Database, ref: string): string {
    const skill = resolveSkillReferenceInDb(db, ref);
    if (!skill) {
        throw new Error(`Skill not found: ${ref}`);
    }
    return skill.id;
}

function skillPublicId(db: Database, primaryKey: string): string {
    const row = db
        .query<{ short_id: string | null }, [string]>(`SELECT short_id FROM skills WHERE id = ?`)
        .get(primaryKey);
    const s = row?.short_id;
    if (s !== null && s !== undefined && s !== "") {
        return s;
    }
    return shortSkillId(primaryKey);
}

function approveCurrentSourceSkills(db: Database, sourceId: string): void {
    db.query<never, [string]>(
        `UPDATE skills
         SET approved = 'approved'
         WHERE id IN (
            SELECT skill_id
            FROM skill_occurrences
            WHERE source_id = ?
         )`,
    ).run(sourceId);
}

function setApproval(
    dbPath: string,
    targetId: string,
    patch: ApprovalPatch,
    options: {
        targetTable: "sources" | "skills";
        targetLabel: "Source" | "Skill";
    },
): ApprovalRow {
    const normalizedPatch: ApprovalPatch = {
        ...patch,
        status: patch.status === undefined ? undefined : parseApprovalStatus(patch.status),
    };

    validatePatch(normalizedPatch);

    const db = new Database(dbPath);
    try {
        db.run("PRAGMA foreign_keys = ON;");
        const resolvedTargetId =
            options.targetTable === "skills" ? resolveSkillPrimaryKey(db, targetId) : targetId;
        if (options.targetTable === "sources") {
            ensureTargetExists(db, options.targetTable, targetId, options.targetLabel);
        }

        const approvalTargetKey = resolvedTargetId;

        const updates: string[] = [];
        const binds: Record<string, unknown> = {
            $id: approvalTargetKey,
        };
        if (normalizedPatch.status !== undefined) {
            updates.push("approved = $approved");
            binds.$approved = normalizedPatch.status;
        }
        if (normalizedPatch.rating !== undefined) {
            updates.push("rating = $rating");
            binds.$rating = normalizedPatch.rating;
        }
        if (normalizedPatch.tags !== undefined) {
            updates.push("tags = $tags");
            binds.$tags = JSON.stringify(normalizedPatch.tags);
        }
        if (normalizedPatch.note !== undefined) {
            updates.push("note = $note");
            binds.$note = normalizedPatch.note;
        }

        const update = db.prepare(
            `UPDATE ${options.targetTable}
             SET ${updates.join(", ")}
             WHERE id = $id`,
        ) as { run(args: Record<string, unknown>): unknown };
        const selectApproval = db.query<ApprovalRowRaw, [string]>(
            `SELECT approved AS status, rating, tags, note
             FROM ${options.targetTable}
             WHERE id = ?`,
        );

        db.transaction(() => {
            update.run(binds);

            if (options.targetTable === "sources" && normalizedPatch.status === "approved") {
                approveCurrentSourceSkills(db, approvalTargetKey);
            }
        })();
        const row = selectApproval.get(approvalTargetKey);

        if (!row) {
            throw new Error(
                `Failed to load updated ${options.targetLabel.toLowerCase()} approval for ${targetId}.`,
            );
        }

        const returnRow = {
            status: row.status,
            rating: row.rating,
            tags: parseTags(row.tags),
            note: row.note,
        };
        if (options.targetTable === "skills") {
            return {
                ...returnRow,
                skill_id: skillPublicId(db, approvalTargetKey),
            } as ApprovalRow;
        }
        return returnRow;
    } finally {
        db.close();
    }
}

export function setSourceApproval(
    dbPath: string,
    sourceId: string,
    patch: ApprovalPatch,
): SourceApprovalRow {
    return {
        source_id: sourceId,
        ...setApproval(dbPath, sourceId, patch, {
            targetTable: "sources",
            targetLabel: "Source",
        }),
    };
}

export function setSkillApproval(
    dbPath: string,
    skillId: string,
    patch: ApprovalPatch,
): SkillApprovalRow {
    return setApproval(dbPath, skillId, patch, {
        targetTable: "skills",
        targetLabel: "Skill",
    }) as SkillApprovalRow;
}
