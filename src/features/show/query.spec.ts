import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSkill, type ShowSkillVersion } from "./query";

const tempRoots: string[] = [];

afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop();
        if (!root) continue;
        await rm(root, { recursive: true, force: true });
    }
});

describe("getSkill", () => {
    it("includes primary source, location, and related versions", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-show-query-"));
        tempRoots.push(root);
        const dbPath = join(root, "skills.sqlite");
        const db = new Database(dbPath, { create: true });

        try {
            db.run(`
                CREATE TABLE sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    git INTEGER NOT NULL DEFAULT 0,
                    remote TEXT,
                    branch TEXT,
                    "commit" TEXT,
                    date TEXT
                );
                CREATE TABLE skills (
                    id TEXT PRIMARY KEY,
                    short_id TEXT NOT NULL,
                    version TEXT,
                    date TEXT,
                    version_order INTEGER NOT NULL,
                    name TEXT,
                    description TEXT,
                    metadata TEXT NOT NULL DEFAULT '{}',
                    fallback INTEGER NOT NULL DEFAULT 0,
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

            const insertBundle = db.query(
                `INSERT INTO sources (id, name, date) VALUES ($id, $name, $date)`,
            );
            insertBundle.run({
                $id: "source-old",
                $name: "source-old-name",
                $date: "2026-04-18T00:00:00.000Z",
            });
            insertBundle.run({
                $id: "source-mid",
                $name: "source-mid-name",
                $date: "2026-04-19T00:00:00.000Z",
            });
            insertBundle.run({
                $id: "source-main",
                $name: "source-main-name",
                $date: "2026-04-20T00:00:00.000Z",
            });

            const insertSkill = db.query(
                `INSERT INTO skills (
                    id, short_id, version, date, version_order, name, description, metadata, fallback, approved, rating, tags, note
                ) VALUES (
                    $id, $short_id, $version, $date, $version_order, $name, $description, '{}', 0, NULL, NULL, '[]', NULL
                )`,
            );
            insertSkill.run({
                $id: "skill-v1",
                $short_id: "skill-v1",
                $version: null,
                $date: "2026-04-18T10:30:00.000Z",
                $version_order: 1,
                $name: "demo-skill",
                $description: "first version",
            });
            insertSkill.run({
                $id: "skill-v2",
                $short_id: "skill-v2",
                $version: null,
                $date: "2026-04-19T10:30:00.000Z",
                $version_order: 2,
                $name: "demo-skill",
                $description: "second version",
            });
            insertSkill.run({
                $id: "skill-v3",
                $short_id: "skill-v3",
                $version: null,
                $date: "2026-04-20T10:30:00.000Z",
                $version_order: 3,
                $name: "demo-skill",
                $description: "third version",
            });
            insertSkill.run({
                $id: "skill-semver",
                $short_id: "skill-semver",
                $version: "1.2.3",
                $date: "2026-04-20T11:30:00.000Z",
                $version_order: 1,
                $name: "semver-skill",
                $description: "declared version",
            });

            const insertOccurrence = db.query(
                `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                 VALUES ($skill_id, $source_id, $subpath, $location)`,
            );
            insertOccurrence.run({
                $skill_id: "skill-v1",
                $source_id: "source-old",
                $subpath: "skills/demo/v1",
                $location: "archive",
            });
            insertOccurrence.run({
                $skill_id: "skill-v2",
                $source_id: "source-mid",
                $subpath: "skills/demo/v2",
                $location: "legacy",
            });
            insertOccurrence.run({
                $skill_id: "skill-v3",
                $source_id: "source-main",
                $subpath: "skills/demo/v3",
                $location: "packages",
            });
            insertOccurrence.run({
                $skill_id: "skill-semver",
                $source_id: "source-main",
                $subpath: "skills/semver",
                $location: "packages",
            });

            const skill = getSkill(dbPath, "skill-v3") as ShowSkillVersion;

            expect(skill).toMatchObject({
                id: "skill-v3",
                source: "source-main-name",
                location: "packages",
                subpath: "skills/demo/v3",
            });
            expect(skill.related_versions).toEqual([
                {
                    id: "skill-v1",
                    version: null,
                    version_order: 1,
                    date: "2026-04-18T10:30:00.000Z",
                    source: "source-old-name",
                    location: "archive",
                    subpath: "skills/demo/v1",
                },
                {
                    id: "skill-v2",
                    version: null,
                    version_order: 2,
                    date: "2026-04-19T10:30:00.000Z",
                    source: "source-mid-name",
                    location: "legacy",
                    subpath: "skills/demo/v2",
                },
            ]);

            const byVersionOrder = getSkill(dbPath, "demo-skill@1") as ShowSkillVersion;
            expect(byVersionOrder).toMatchObject({
                id: "skill-v1",
                version_order: 1,
                description: "first version",
                source: "source-old-name",
                location: "archive",
                subpath: "skills/demo/v1",
            });
            expect(byVersionOrder.related_versions.map((item) => item.id)).toEqual([
                "skill-v2",
                "skill-v3",
            ]);

            const byVersionLabel = getSkill(dbPath, "demo-skill@v2") as ShowSkillVersion;
            expect(byVersionLabel).toMatchObject({
                id: "skill-v2",
                version_order: 2,
                description: "second version",
            });

            const byDeclaredVersion = getSkill(dbPath, "semver-skill@1.2.3") as ShowSkillVersion;
            expect(byDeclaredVersion).toMatchObject({
                id: "skill-semver",
                version: "1.2.3",
                version_order: 1,
                description: "declared version",
            });

            const byName = getSkill(dbPath, "demo-skill") as ShowSkillVersion;
            expect(byName).toMatchObject({
                id: "skill-v3",
                version_order: 3,
                description: "third version",
                source: "source-main-name",
                location: "packages",
                subpath: "skills/demo/v3",
            });
            expect(byName.related_versions.map((item) => item.id)).toEqual([
                "skill-v1",
                "skill-v2",
            ]);

            const bySubpath = getSkill(dbPath, "skills/demo/v2") as ShowSkillVersion;
            expect(bySubpath).toMatchObject({
                id: "skill-v2",
                version_order: 2,
                description: "second version",
            });
        } finally {
            db.close();
        }
    });
});
