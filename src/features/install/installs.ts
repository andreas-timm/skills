import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** A single recorded install: where a skill was installed, when, and from which project. */
export type InstallRecord = {
    skillId: string;
    name: string;
    /** Absolute path the skill was installed to (the "where"). */
    targetDir: string;
    /** "local" for a project install, otherwise the global agent name. */
    scope: string;
    /** ISO timestamp of the install (the "when"). */
    installedAt: string;
    /** Project directory the install was run from (git toplevel or cwd). */
    projectDir: string | null;
    gitRemote: string | null;
    gitBranch: string | null;
    gitCommit: string | null;
};

type InstallRow = {
    skill_id: string;
    name: string;
    target_dir: string;
    scope: string;
    installed_at: string;
    project_dir: string | null;
    git_remote: string | null;
    git_branch: string | null;
    git_commit: string | null;
};

const INSTALLS_SCHEMA = `
CREATE TABLE IF NOT EXISTS installs (
    skill_id     TEXT NOT NULL,
    name         TEXT NOT NULL,
    target_dir   TEXT NOT NULL PRIMARY KEY,
    scope        TEXT NOT NULL,
    installed_at TEXT NOT NULL,
    project_dir  TEXT,
    git_remote   TEXT,
    git_branch   TEXT,
    git_commit   TEXT
);
`;

/** Create the installs table when missing. Safe to call repeatedly. */
export function ensureInstallsSchema(db: Database): void {
    db.run(INSTALLS_SCHEMA);
}

function installsTableExists(db: Database): boolean {
    const row = db
        .query<{ found: number }, []>(
            `SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'installs' LIMIT 1`,
        )
        .get();
    return row !== null;
}

function rowToRecord(row: InstallRow): InstallRecord {
    return {
        skillId: row.skill_id,
        name: row.name,
        targetDir: row.target_dir,
        scope: row.scope,
        installedAt: row.installed_at,
        projectDir: row.project_dir,
        gitRemote: row.git_remote,
        gitBranch: row.git_branch,
        gitCommit: row.git_commit,
    };
}

/**
 * Persist an install record into the SQLite catalog. The install location
 * (`target_dir`) is the natural key, so re-installing to the same path refreshes
 * the existing row rather than appending a duplicate.
 */
export async function recordInstall(dbPath: string, record: InstallRecord): Promise<void> {
    await mkdir(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath, { create: true });
    try {
        ensureInstallsSchema(db);
        db.query(
            `INSERT INTO installs (
                skill_id, name, target_dir, scope, installed_at,
                project_dir, git_remote, git_branch, git_commit
            ) VALUES (
                $skill_id, $name, $target_dir, $scope, $installed_at,
                $project_dir, $git_remote, $git_branch, $git_commit
            )
            ON CONFLICT(target_dir) DO UPDATE SET
                skill_id = excluded.skill_id,
                name = excluded.name,
                scope = excluded.scope,
                installed_at = excluded.installed_at,
                project_dir = excluded.project_dir,
                git_remote = excluded.git_remote,
                git_branch = excluded.git_branch,
                git_commit = excluded.git_commit`,
        ).run({
            $skill_id: record.skillId,
            $name: record.name,
            $target_dir: record.targetDir,
            $scope: record.scope,
            $installed_at: record.installedAt,
            $project_dir: record.projectDir,
            $git_remote: record.gitRemote,
            $git_branch: record.gitBranch,
            $git_commit: record.gitCommit,
        });
    } finally {
        db.close();
    }
}

/** Read all install records, newest first. Returns [] when the DB or table is absent. */
export function listInstalls(dbPath: string): InstallRecord[] {
    if (!existsSync(dbPath)) return [];
    const db = new Database(dbPath, { readonly: true });
    try {
        if (!installsTableExists(db)) return [];
        return db
            .query<InstallRow, []>(
                `SELECT skill_id, name, target_dir, scope, installed_at,
                        project_dir, git_remote, git_branch, git_commit
                 FROM installs
                 ORDER BY installed_at DESC, target_dir ASC`,
            )
            .all()
            .map(rowToRecord);
    } finally {
        db.close();
    }
}

/** Drop the recorded state for an install location. No-op when the DB or table is absent. */
export function removeInstallRecord(dbPath: string, targetDir: string): void {
    if (!existsSync(dbPath)) return;
    const db = new Database(dbPath);
    try {
        if (!installsTableExists(db)) return;
        db.query(`DELETE FROM installs WHERE target_dir = $target_dir`).run({
            $target_dir: targetDir,
        });
    } finally {
        db.close();
    }
}
