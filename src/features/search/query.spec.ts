import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "@features/update/load";
import type { TransformedSkill } from "@features/update/types";
import { of } from "rxjs";
import { searchSkills } from "./query";

describe("searchSkills", () => {
    it("uses text search over skill names and descriptions by default", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-search-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            const items: TransformedSkill[] = [
                {
                    source: {
                        id: "source-1",
                        name: "source-one",
                        rootSubpath: "",
                        git: false,
                        approved: null,
                        rating: null,
                        tags: [],
                        note: null,
                    },
                    skill: {
                        id: "skill-1",
                        shortId: "skill-1",
                        version: null,
                        date: null,
                        versionOrder: 0,
                        name: "calendar helper",
                        description: "Schedule events and calendar updates",
                        metadata: {},
                        fallback: false,
                        approved: null,
                        rating: null,
                        tags: [],
                        note: null,
                    },
                    occurrence: {
                        skillId: "skill-1",
                        sourceId: "source-1",
                        location: "local",
                        subpath: "calendar-helper",
                    },
                },
                {
                    source: {
                        id: "source-2",
                        name: "source-two",
                        rootSubpath: "",
                        git: false,
                        approved: null,
                        rating: null,
                        tags: [],
                        note: null,
                    },
                    skill: {
                        id: "skill-2",
                        shortId: "skill-2",
                        version: null,
                        date: null,
                        versionOrder: 0,
                        name: "meeting bot",
                        description: "Calendar scheduling workflows for project teams",
                        metadata: {},
                        fallback: false,
                        approved: null,
                        rating: null,
                        tags: [],
                        note: null,
                    },
                    occurrence: {
                        skillId: "skill-2",
                        sourceId: "source-2",
                        location: "local",
                        subpath: "meeting-bot",
                    },
                },
            ];

            await load(dbPath, of(...items));

            const hits = await searchSkills({
                dbPath,
                query: "calendar",
            });

            expect(hits.map((hit) => hit.name)).toEqual(["calendar helper", "meeting bot"]);
            expect(hits[0]?.primaryOccurrence?.sourceName).toBe("source-one");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("orders approved text hits before applying the limit", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-search-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            const items: TransformedSkill[] = [
                {
                    source: {
                        id: "source-unapproved",
                        name: "source-unapproved",
                        rootSubpath: "",
                        git: false,
                        approved: null,
                        rating: null,
                        tags: [],
                        note: null,
                    },
                    skill: {
                        id: "skill-unapproved",
                        shortId: "skill-unapproved",
                        version: null,
                        date: null,
                        versionOrder: 0,
                        name: "calendar",
                        description: "Calendar calendar calendar workflows",
                        metadata: {},
                        fallback: false,
                        approved: null,
                        rating: null,
                        tags: [],
                        note: null,
                    },
                    occurrence: {
                        skillId: "skill-unapproved",
                        sourceId: "source-unapproved",
                        location: "local",
                        subpath: "calendar",
                    },
                },
                {
                    source: {
                        id: "source-approved",
                        name: "source-approved",
                        rootSubpath: "",
                        git: false,
                        approved: null,
                        rating: null,
                        tags: [],
                        note: null,
                    },
                    skill: {
                        id: "skill-approved",
                        shortId: "skill-approved",
                        version: null,
                        date: null,
                        versionOrder: 0,
                        name: "workflow helper",
                        description: "Calendar integration helper",
                        metadata: {},
                        fallback: false,
                        approved: null,
                        rating: null,
                        tags: [],
                        note: null,
                    },
                    occurrence: {
                        skillId: "skill-approved",
                        sourceId: "source-approved",
                        location: "trusted",
                        subpath: "workflow-helper",
                    },
                },
            ];

            await load(dbPath, of(...items));

            const hits = await searchSkills({
                dbPath,
                query: "calendar",
                limit: 1,
                approvedLocations: ["trusted"],
            });

            expect(hits.map((hit) => hit.skillId)).toEqual(["skill-approved"]);
            expect(hits[0]?.status).toBe("approved");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("falls back to LIKE search when the FTS index is missing", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-search-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
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
                        name TEXT,
                        description TEXT
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
                    $id: "source-legacy",
                    $name: "legacy-source",
                    $date: "2026-04-01T00:00:00.000Z",
                });
                db.query(
                    `INSERT INTO skills (id, short_id, name, description)
                     VALUES ($id, $short_id, $name, $description)`,
                ).run({
                    $id: "skill-legacy",
                    $short_id: "skill-legacy",
                    $name: "project planner",
                    $description: "Meeting assistant for roadmap planning",
                });
                db.query(
                    `INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
                     VALUES ($skill_id, $source_id, $subpath, $location)`,
                ).run({
                    $skill_id: "skill-legacy",
                    $source_id: "source-legacy",
                    $subpath: "project-planner",
                    $location: "legacy",
                });
            } finally {
                db.close();
            }

            const hits = await searchSkills({
                dbPath,
                query: "meeting assistant",
            });

            expect(hits).toHaveLength(1);
            expect(hits[0]?.name).toBe("project planner");
            expect(hits[0]?.primaryOccurrence?.location).toBe("legacy");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
