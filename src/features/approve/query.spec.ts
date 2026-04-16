import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSkillApproval, setSourceApproval } from "./query";

const tempRoots: string[] = [];

afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop();
        if (!root) continue;
        await rm(root, { recursive: true, force: true });
    }
});

describe("setSourceApproval", () => {
    it("marks all current skills in the source as approved", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-approve-query-"));
        tempRoots.push(root);
        const dbPath = join(root, "skills.sqlite");
        const db = new Database(dbPath, { create: true });

        try {
            db.run(`
                CREATE TABLE sources (
                    id TEXT PRIMARY KEY,
                    approved TEXT,
                    rating INTEGER,
                    tags TEXT NOT NULL DEFAULT '[]',
                    note TEXT
                );
                CREATE TABLE skills (
                    id TEXT PRIMARY KEY,
                    short_id TEXT NOT NULL,
                    approved TEXT,
                    rating INTEGER,
                    tags TEXT NOT NULL DEFAULT '[]',
                    note TEXT
                );
                CREATE TABLE skill_occurrences (
                    skill_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    subpath TEXT NOT NULL,
                    location TEXT NOT NULL,
                    PRIMARY KEY (skill_id, source_id, subpath)
                );
            `);
            db.query(`INSERT INTO sources (id) VALUES (?)`).run("source-1");
            db.query(`INSERT INTO sources (id) VALUES (?)`).run("source-2");
            db.query(`INSERT INTO skills (id, short_id) VALUES (?, ?)`).run("skill-1", "skill-1");
            db.query(`INSERT INTO skills (id, short_id) VALUES (?, ?)`).run("skill-2", "skill-2");
            db.query(`INSERT INTO skills (id, short_id) VALUES (?, ?)`).run(
                "other-skill",
                "other-skill",
            );
            db.query(
                `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                 VALUES (?, ?, ?, ?)`,
            ).run("skill-1", "source-1", "one", "local");
            db.query(
                `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                 VALUES (?, ?, ?, ?)`,
            ).run("skill-2", "source-1", "two", "local");
            db.query(
                `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                 VALUES (?, ?, ?, ?)`,
            ).run("other-skill", "source-2", "other", "local");
        } finally {
            db.close();
        }

        const approval = setSourceApproval(dbPath, "source-1", {
            status: "approved",
        });

        expect(approval.status).toBe("approved");

        const checkDb = new Database(dbPath, { readonly: true });
        try {
            const rows = checkDb
                .query<{ id: string; approved: string | null }, []>(
                    `SELECT id, approved FROM skills ORDER BY id`,
                )
                .all();
            expect(rows).toEqual([
                { id: "other-skill", approved: null },
                { id: "skill-1", approved: "approved" },
                { id: "skill-2", approved: "approved" },
            ]);
        } finally {
            checkDb.close();
        }
    });
});

describe("setSkillApproval", () => {
    it("resolves skill references before updating approval", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-approve-query-"));
        tempRoots.push(root);
        const dbPath = join(root, "skills.sqlite");
        const db = new Database(dbPath, { create: true });

        try {
            db.run(`
                CREATE TABLE skills (
                    id TEXT PRIMARY KEY,
                    short_id TEXT NOT NULL,
                    name TEXT,
                    version TEXT,
                    version_order INTEGER NOT NULL,
                    approved TEXT,
                    rating INTEGER,
                    tags TEXT NOT NULL DEFAULT '[]',
                    note TEXT
                );
                CREATE TABLE skill_occurrences (
                    skill_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    subpath TEXT NOT NULL,
                    location TEXT NOT NULL,
                    PRIMARY KEY (skill_id, source_id, subpath)
                );

                INSERT INTO skills (id, short_id, name, version, version_order)
                VALUES
                    ('skill-v1', 'short-v1', 'demo-skill', NULL, 1),
                    ('skill-v2', 'short-v2', 'demo-skill', NULL, 2);
            `);
        } finally {
            db.close();
        }

        const approval = setSkillApproval(dbPath, "demo-skill", {
            status: "approved",
        });

        expect(approval).toMatchObject({
            skill_id: "short-v2",
            status: "approved",
        });

        const checkDb = new Database(dbPath, { readonly: true });
        try {
            const rows = checkDb
                .query<{ id: string; approved: string | null }, []>(
                    `SELECT id, approved FROM skills ORDER BY id`,
                )
                .all();
            expect(rows).toEqual([
                { id: "skill-v1", approved: null },
                { id: "skill-v2", approved: "approved" },
            ]);
        } finally {
            checkDb.close();
        }
    });
});
