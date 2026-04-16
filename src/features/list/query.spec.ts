import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    listSkillOccurrences,
    listSkills,
    listSkillsByFullIds,
    listSkillVersions,
    listSources,
} from "./query";

const tempRoots: string[] = [];

afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop();
        if (!root) continue;
        await rm(root, { recursive: true, force: true });
    }
});

describe("missing db", () => {
    it("returns empty rows for read-only list queries", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-list-query-"));
        tempRoots.push(root);
        const dbPath = join(root, "missing.sqlite");

        expect(listSources(dbPath)).toEqual([]);
        expect(listSkills(dbPath)).toEqual([]);
        expect(listSkillsByFullIds(dbPath, ["missing"])).toEqual([]);
        expect(listSkillVersions(dbPath)).toEqual([]);
        expect(listSkillOccurrences(dbPath, "missing")).toEqual([]);
    });
});

describe("listSkills", () => {
    it("includes primary location and source details for the latest skill version", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-list-query-"));
        tempRoots.push(root);
        const dbPath = join(root, "skills.sqlite");
        const db = new Database(dbPath, { create: true });

        try {
            db.run(`
                CREATE TABLE sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    date TEXT
                );
                CREATE TABLE skills (
                    id TEXT PRIMARY KEY,
                    short_id TEXT NOT NULL,
                    date TEXT,
                    version_order INTEGER NOT NULL,
                    name TEXT,
                    version TEXT,
                    description TEXT,
                    approved TEXT,
                    rating REAL,
                    tags TEXT,
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

            db.query(`INSERT INTO sources (id, name, date) VALUES ($id, $name, $date)`).run({
                $id: "source-old",
                $name: "source-old-name",
                $date: "2026-04-01T00:00:00.000Z",
            });
            db.query(`INSERT INTO sources (id, name, date) VALUES ($id, $name, $date)`).run({
                $id: "source-new",
                $name: "source-new-name",
                $date: "2026-04-20T00:00:00.000Z",
            });

            db.query(
                `INSERT INTO skills (
                    id, short_id, date, version_order, name, version, description, approved, rating, tags, note
                ) VALUES (
                    $id, $short_id, $date, $version_order, $name, $version, $description, $approved, $rating, $tags, $note
                )`,
            ).run({
                $id: "skill-v1",
                $short_id: "skill-v1",
                $date: "2026-04-02T00:00:00.000Z",
                $version_order: 1,
                $name: "python-testing",
                $version: "1.0.0",
                $description: "first version",
                $approved: null,
                $rating: null,
                $tags: null,
                $note: null,
            });
            db.query(
                `INSERT INTO skills (
                    id, short_id, date, version_order, name, version, description, approved, rating, tags, note
                ) VALUES (
                    $id, $short_id, $date, $version_order, $name, $version, $description, $approved, $rating, $tags, $note
                )`,
            ).run({
                $id: "skill-v2",
                $short_id: "skill-v2",
                $date: "2026-04-21T00:00:00.000Z",
                $version_order: 2,
                $name: "python-testing",
                $version: "2.0.0",
                $description: "second version",
                $approved: null,
                $rating: null,
                $tags: null,
                $note: null,
            });

            db.query(
                `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                 VALUES ($skill_id, $source_id, $subpath, $location)`,
            ).run({
                $skill_id: "skill-v1",
                $source_id: "source-old",
                $subpath: "skills/python-testing/v1",
                $location: "archive",
            });
            db.query(
                `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                 VALUES ($skill_id, $source_id, $subpath, $location)`,
            ).run({
                $skill_id: "skill-v2",
                $source_id: "source-old",
                $subpath: "skills/python-testing/v2-old",
                $location: "legacy",
            });
            db.query(
                `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                 VALUES ($skill_id, $source_id, $subpath, $location)`,
            ).run({
                $skill_id: "skill-v2",
                $source_id: "source-new",
                $subpath: "skills/python-testing/v2-new",
                $location: "packages",
            });

            const rows = listSkills(dbPath);

            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                id: "skill-v2",
                version_count: 2,
                duplicate: 1,
                location: "packages",
                source_name: "source-new-name",
                status: undefined,
            });

            expect(
                listSkillVersions(dbPath, "skill-v1").map((row) => ({
                    id: row.id,
                    duplicate: row.duplicate,
                })),
            ).toEqual([
                { id: "skill-v2", duplicate: 1 },
                { id: "skill-v1", duplicate: 0 },
            ]);
            expect(listSkillVersions(dbPath, "skill-v1").map((row) => row.id)).toEqual([
                "skill-v2",
                "skill-v1",
            ]);
            expect(listSkillVersions(dbPath, "python-testing@1.0.0").map((row) => row.id)).toEqual([
                "skill-v2",
                "skill-v1",
            ]);
            expect(
                listSkillOccurrences(dbPath, "python-testing").map((row) => row.subpath),
            ).toEqual(["skills/python-testing/v2-old", "skills/python-testing/v2-new"]);
        } finally {
            db.close();
        }
    });

    it("counts only duplicate locations across versions", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-list-query-"));
        tempRoots.push(root);
        const dbPath = join(root, "skills.sqlite");
        const db = new Database(dbPath, { create: true });

        try {
            db.run(`
                CREATE TABLE sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    date TEXT
                );
                CREATE TABLE skills (
                    id TEXT PRIMARY KEY,
                    short_id TEXT NOT NULL,
                    date TEXT,
                    version_order INTEGER NOT NULL,
                    name TEXT,
                    version TEXT,
                    description TEXT,
                    approved TEXT,
                    rating REAL,
                    tags TEXT,
                    note TEXT
                );
                CREATE TABLE skill_occurrences (
                    skill_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    subpath TEXT NOT NULL,
                    location TEXT NOT NULL,
                    PRIMARY KEY (skill_id, source_id, subpath)
                );

                INSERT INTO sources (id, name, date)
                VALUES ('source', 'affaan-m/everything-claude-code', '2026-03-22T22:39:00.000Z');

                INSERT INTO skills (
                    id, short_id, date, version_order, name, version, description, approved, rating, tags, note
                ) VALUES
                    ('skill-v1', 'skill-v1', '2026-02-20T09:11:00.000Z', 1, 'springboot-verification', NULL, 'version one', NULL, NULL, NULL, NULL),
                    ('skill-v2', 'skill-v2', '2026-02-23T16:00:00.000Z', 2, 'springboot-verification', NULL, 'version two', NULL, NULL, NULL, NULL),
                    ('skill-v3', 'skill-v3', '2026-03-22T22:37:00.000Z', 3, 'springboot-verification', NULL, 'version three', NULL, NULL, NULL, NULL),
                    ('skill-v4', 'skill-v4', '2026-03-22T22:39:00.000Z', 4, 'springboot-verification', NULL, 'version four', NULL, NULL, NULL, NULL);

                INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                VALUES
                    ('skill-v1', 'source', 'docs/ja-JP/skills/springboot-verification', 'packages'),
                    ('skill-v2', 'source', 'skills/springboot-verification', 'packages'),
                    ('skill-v3', 'source', 'docs/tr/skills/springboot-verification', 'packages'),
                    ('skill-v4', 'source', 'docs/zh-CN/skills/springboot-verification', 'packages');
            `);

            const rows = listSkills(dbPath);

            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                id: "skill-v4",
                version_count: 4,
                duplicate: 0,
            });
            expect(
                listSkillVersions(dbPath, "springboot-verification").map((row) => row.duplicate),
            ).toEqual([0, 0, 0, 0]);
        } finally {
            db.close();
        }
    });

    it("treats approved locations as effective skill approval without writing the skill flag", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-list-query-"));
        tempRoots.push(root);
        const dbPath = join(root, "skills.sqlite");
        const db = new Database(dbPath, { create: true });

        try {
            db.run(`
                CREATE TABLE sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    date TEXT
                );
                CREATE TABLE skills (
                    id TEXT PRIMARY KEY,
                    short_id TEXT NOT NULL,
                    date TEXT,
                    version_order INTEGER NOT NULL,
                    name TEXT,
                    version TEXT,
                    description TEXT,
                    approved TEXT,
                    rating REAL,
                    tags TEXT,
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

            db.query(`INSERT INTO sources (id, name, date) VALUES ($id, $name, $date)`).run({
                $id: "source-trusted",
                $name: "trusted-source",
                $date: "2026-04-20T00:00:00.000Z",
            });
            db.query(
                `INSERT INTO skills (
                    id, short_id, date, version_order, name, version, description, approved, rating, tags, note
                ) VALUES (
                    $id, $short_id, $date, $version_order, $name, $version, $description, $approved, $rating, $tags, $note
                )`,
            ).run({
                $id: "skill-trusted",
                $short_id: "skill-trusted",
                $date: "2026-04-21T00:00:00.000Z",
                $version_order: 1,
                $name: "trusted skill",
                $version: null,
                $description: "from approved location",
                $approved: null,
                $rating: null,
                $tags: null,
                $note: null,
            });
            db.query(
                `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                 VALUES ($skill_id, $source_id, $subpath, $location)`,
            ).run({
                $skill_id: "skill-trusted",
                $source_id: "source-trusted",
                $subpath: "trusted-skill",
                $location: "trusted",
            });

            const rows = listSkills(dbPath, {
                approvedLocations: ["trusted"],
            });

            expect(rows[0]).toMatchObject({
                id: "skill-trusted",
                status: "approved",
            });
            expect(
                db
                    .query<{ approved: string | null }, []>(
                        `SELECT approved FROM skills WHERE id = 'skill-trusted'`,
                    )
                    .get()?.approved,
            ).toBeNull();
        } finally {
            db.close();
        }
    });
});
