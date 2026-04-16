import { Database } from "bun:sqlite";
import { accessSync, constants, existsSync } from "node:fs";
import { loadConfig, USER_CONFIG_PATH } from "@config";
import { resolveSkillsDbPath } from "@features/update/paths";
import { expandHome } from "@libs/path";

type DbStatus = "ok" | "missing" | "unreadable" | "invalid";

export type StatusDbSummary = {
    sources: {
        total: number;
        gitFlag: number;
    };
    skills: {
        total: number;
        fallbackFlag: number;
        embedCreated: boolean;
        embedded: number;
        embeddedChunks: number;
    };
};

function getDbStatus(dbPath: string): DbStatus {
    if (!existsSync(dbPath)) {
        return "missing";
    }

    try {
        accessSync(dbPath, constants.R_OK);
    } catch {
        return "unreadable";
    }

    let db: Database | undefined;
    try {
        db = new Database(dbPath, { readonly: true });
        db.query("SELECT name FROM sqlite_master LIMIT 1").get();
        return "ok";
    } catch {
        return "invalid";
    } finally {
        db?.close();
    }
}

type StatusTableName = "sources" | "skills" | "skill_chunks" | "embed_meta";

function quoteSqlIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}

function tableExists(db: Database, tableName: StatusTableName): boolean {
    const row = db
        .query<{ present: number }, { $name: string }>(
            `SELECT 1 AS present
             FROM sqlite_master
             WHERE name = $name
             LIMIT 1`,
        )
        .get({ $name: tableName });
    return row !== null;
}

function columnExists(db: Database, tableName: StatusTableName, column: string): boolean {
    if (!tableExists(db, tableName)) return false;
    return db
        .query<{ name: string }, []>(`PRAGMA table_info(${quoteSqlIdentifier(tableName)})`)
        .all()
        .some((row) => row.name === column);
}

function countRows(db: Database, tableName: StatusTableName): number {
    if (!tableExists(db, tableName)) return 0;
    const row = db
        .query<{ count: number }, []>(
            `SELECT COUNT(*) AS count FROM ${quoteSqlIdentifier(tableName)}`,
        )
        .get();
    return row?.count ?? 0;
}

function countFlaggedRows(db: Database, tableName: StatusTableName, column: string): number {
    if (!columnExists(db, tableName, column)) return 0;
    const row = db
        .query<{ count: number }, []>(
            `SELECT COUNT(*) AS count
             FROM ${quoteSqlIdentifier(tableName)}
             WHERE ${quoteSqlIdentifier(tableName)}.${quoteSqlIdentifier(column)} != 0`,
        )
        .get();
    return row?.count ?? 0;
}

function countEmbeddedSkills(db: Database): number {
    if (!columnExists(db, "skill_chunks", "skill_id")) return 0;
    const row = db
        .query<{ count: number }, []>(`SELECT COUNT(DISTINCT skill_id) AS count FROM skill_chunks`)
        .get();
    return row?.count ?? 0;
}

export function readStatusDbSummary(db: Database): StatusDbSummary {
    const embeddedChunks = countRows(db, "skill_chunks");
    return {
        sources: {
            total: countRows(db, "sources"),
            gitFlag: countFlaggedRows(db, "sources", "git"),
        },
        skills: {
            total: countRows(db, "skills"),
            fallbackFlag: countFlaggedRows(db, "skills", "fallback"),
            embedCreated: embeddedChunks > 0,
            embedded: countEmbeddedSkills(db),
            embeddedChunks,
        },
    };
}

export function formatStatusDbSummary(summary: StatusDbSummary): string {
    const lines = [
        "sources:",
        `- total: ${summary.sources.total}`,
        `- git flag: ${summary.sources.gitFlag}`,
        "skills:",
        `- total: ${summary.skills.total}`,
        `- fallback flag: ${summary.skills.fallbackFlag}`,
        `- embed created: ${summary.skills.embedCreated ? "yes" : "no"}`,
    ];

    if (summary.skills.embedded > 0) {
        lines.push(`- embedded skills: ${summary.skills.embedded}`);
    }
    if (summary.skills.embeddedChunks > 0) {
        lines.push(`- embedded chunks: ${summary.skills.embeddedChunks}`);
    }

    return lines.join("\n");
}

export async function statusAction(): Promise<void> {
    const config = await loadConfig();
    const dbPath = resolveSkillsDbPath(config);
    const dbStatus = getDbStatus(dbPath);
    const userConfigPath = expandHome(USER_CONFIG_PATH);
    const locationCount = Object.keys(config.skills.locations).length;

    process.stdout.write(`user config path: ${userConfigPath}\n`);
    process.stdout.write(`locations: ${locationCount}\n`);
    process.stdout.write(`db path: ${dbPath}\n`);
    process.stdout.write(`db status: ${dbStatus}\n`);

    if (dbStatus !== "ok") {
        return;
    }

    let db: Database | undefined;
    try {
        db = new Database(dbPath, { readonly: true });
        process.stdout.write(`${formatStatusDbSummary(readStatusDbSummary(db))}\n`);
    } finally {
        db?.close();
    }
}
