import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { from, of } from "rxjs";
import { listSources } from "../list/query";
import { computeVersionOrders, load, type VersionOrderRow } from "./load";
import type { TransformedSkill } from "./types";

function orderOf(rows: VersionOrderRow[]): Record<string, number> {
    return Object.fromEntries(computeVersionOrders(rows).entries());
}

function makeItem(
    overrides: {
        source?: Partial<TransformedSkill["source"]>;
        skill?: Partial<TransformedSkill["skill"]>;
        occurrence?: Partial<TransformedSkill["occurrence"]>;
        locationTags?: TransformedSkill["locationTags"];
    } = {},
): TransformedSkill {
    return {
        source: {
            id: "source-1",
            name: "source-one",
            rootSubpath: "",
            git: false,
            approved: null,
            rating: null,
            tags: [],
            note: null,
            ...overrides.source,
        },
        skill: {
            id: "skill-1",
            shortId: "skill-1",
            version: null,
            date: "2026-01-01T00:00:00.000Z",
            versionOrder: 0,
            name: "calendar helper",
            description: "Schedule calendar events and meetings",
            metadata: {},
            fallback: false,
            approved: null,
            rating: null,
            tags: [],
            note: null,
            ...overrides.skill,
        },
        occurrence: {
            skillId: overrides.skill?.id ?? "skill-1",
            sourceId: overrides.source?.id ?? "source-1",
            location: "local",
            subpath: "calendar-helper",
            ...overrides.occurrence,
        },
        ...(overrides.locationTags !== undefined ? { locationTags: overrides.locationTags } : {}),
    };
}

describe("computeVersionOrders", () => {
    it("orders by date ascending when versions are missing", () => {
        const orders = orderOf([
            {
                id: "c",
                name: "skill-a",
                version: null,
                date: "2026-01-03T00:00:00.000Z",
            },
            { id: "a", name: "skill-a", version: null, date: null },
            {
                id: "b",
                name: "skill-a",
                version: null,
                date: "2026-01-01T00:00:00.000Z",
            },
        ]);
        expect(orders.a).toBe(1);
        expect(orders.b).toBe(2);
        expect(orders.c).toBe(3);
    });

    it("uses semver-like ordering at equal dates", () => {
        const date = "2026-01-02T00:00:00.000Z";
        const orders = orderOf([
            { id: "x", name: "skill-a", version: "1.2.10", date },
            { id: "y", name: "skill-a", version: "1.2.9", date },
            { id: "z", name: "skill-a", version: "1.2.0", date },
        ]);
        expect(orders.z).toBe(1);
        expect(orders.y).toBe(2);
        expect(orders.x).toBe(3);
    });

    it("gives newer dated no-version rows higher order than older versioned rows", () => {
        const orders = orderOf([
            { id: "versioned", name: "skill-a", version: "1.0.0", date: null },
            {
                id: "dated-no-version",
                name: "skill-a",
                version: null,
                date: "2026-03-01T00:00:00.000Z",
            },
        ]);
        expect(orders.versioned).toBe(1);
        expect(orders["dated-no-version"]).toBe(2);
    });

    it("does not let duplicate skill ids consume another version order", () => {
        const orders = orderOf([
            {
                id: "same-skill",
                name: "skill-a",
                version: null,
                date: "2026-01-01T00:00:00.000Z",
            },
            {
                id: "new-skill",
                name: "skill-a",
                version: null,
                date: "2026-02-01T00:00:00.000Z",
            },
            {
                id: "same-skill",
                name: "skill-a",
                version: null,
                date: "2026-03-01T00:00:00.000Z",
            },
        ]);

        expect(orders["same-skill"]).toBe(1);
        expect(orders["new-skill"]).toBe(2);
    });
});

describe("load", () => {
    it("stores the latest skill modified date for non-git sources", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-load-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            await load(
                dbPath,
                from([
                    makeItem({
                        skill: {
                            id: "skill-1",
                            shortId: "skill-1",
                            date: "2026-01-01T00:00:00.000Z",
                        },
                        occurrence: { subpath: "source/skill-1" },
                    }),
                    makeItem({
                        skill: {
                            id: "skill-2",
                            shortId: "skill-2",
                            name: "reminder helper",
                            date: "2026-01-03T00:00:00.000Z",
                        },
                        occurrence: { subpath: "source/skill-2" },
                    }),
                ]),
            );

            const sources = listSources(dbPath);
            expect(sources).toHaveLength(1);
            expect(sources[0]?.date).toBe("2026-01-03T00:00:00.000Z");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("keeps git source dates from git metadata", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-load-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            await load(
                dbPath,
                of(
                    makeItem({
                        source: {
                            git: true,
                            remote: "https://github.com/acme/repo.git",
                            branch: "main",
                            commit: "abcdef1234567890",
                            date: "2026-01-02T00:00:00.000Z",
                        },
                        skill: {
                            date: "2026-01-03T00:00:00.000Z",
                        },
                    }),
                ),
            );

            const sources = listSources(dbPath);
            expect(sources).toHaveLength(1);
            expect(sources[0]?.date).toBe("2026-01-02T00:00:00.000Z");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("keeps duplicate skill ids on the first version order across locations", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-load-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            await load(
                dbPath,
                from([
                    makeItem({
                        source: { id: "source-main", name: "source-main" },
                        skill: {
                            id: "skill-old",
                            shortId: "skill-old",
                            date: "2026-01-01T00:00:00.000Z",
                            name: "calendar helper",
                        },
                        occurrence: {
                            location: "packages",
                            subpath: "skills/calendar-helper",
                        },
                    }),
                    makeItem({
                        source: { id: "source-main", name: "source-main" },
                        skill: {
                            id: "skill-new",
                            shortId: "skill-new",
                            date: "2026-02-01T00:00:00.000Z",
                            name: "calendar helper",
                        },
                        occurrence: {
                            location: "packages",
                            subpath: "skills/calendar-helper-new",
                        },
                    }),
                    makeItem({
                        source: { id: "source-mirror", name: "source-mirror" },
                        skill: {
                            id: "skill-old",
                            shortId: "skill-old",
                            date: "2026-03-01T00:00:00.000Z",
                            name: "calendar helper",
                        },
                        occurrence: {
                            location: "mirror",
                            subpath: "mirror/calendar-helper",
                        },
                    }),
                ]),
            );

            const db = new Database(dbPath, { readonly: true });
            try {
                const skills = db
                    .query<
                        {
                            id: string;
                            date: string | null;
                            version_order: number;
                        },
                        []
                    >(
                        `SELECT id, date, version_order
                         FROM skills
                         ORDER BY id`,
                    )
                    .all();
                const occurrences = db
                    .query<{ skill_id: string }, []>(
                        `SELECT skill_id
                         FROM skill_occurrences
                         WHERE skill_id = 'skill-old'`,
                    )
                    .all();

                expect(skills).toEqual([
                    {
                        id: "skill-new",
                        date: "2026-02-01T00:00:00.000Z",
                        version_order: 2,
                    },
                    {
                        id: "skill-old",
                        date: "2026-01-01T00:00:00.000Z",
                        version_order: 1,
                    },
                ]);
                expect(occurrences).toHaveLength(2);
            } finally {
                db.close();
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("populates the text search index for names and descriptions", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-load-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            const item = makeItem({
                source: {
                    rootSubpath: "repo.git",
                },
                skill: {
                    date: null,
                },
            });

            await load(dbPath, of(item));

            const db = new Database(dbPath, { readonly: true });
            try {
                const rows = db
                    .query<{ skill_id: string }, { $query: string }>(
                        `SELECT skill_id
                         FROM skills_fts
                         WHERE skills_fts MATCH $query`,
                    )
                    .all({ $query: "calendar" });
                const sources = db
                    .query<{ root_subpath: string }, []>(`SELECT root_subpath FROM sources`)
                    .all();

                expect(rows).toEqual([{ skill_id: "skill-1" }]);
                expect(sources).toEqual([{ root_subpath: "repo.git" }]);
            } finally {
                db.close();
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("omits name and description from stored skill metadata", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-load-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            await load(
                dbPath,
                of(
                    makeItem({
                        skill: {
                            metadata: {
                                description: "duplicate description",
                                name: "duplicate name",
                                version: "1.2.3",
                                x_test: true,
                            },
                        },
                    }),
                ),
            );

            const db = new Database(dbPath, { readonly: true });
            try {
                const row = db
                    .query<
                        {
                            description: string | null;
                            metadata: string;
                            name: string | null;
                        },
                        []
                    >(
                        `SELECT name, description, metadata
                         FROM skills
                         WHERE id = 'skill-1'`,
                    )
                    .get();

                expect(row?.name).toBe("calendar helper");
                expect(row?.description).toBe("Schedule calendar events and meetings");
                expect(JSON.parse(row?.metadata ?? "{}")).toEqual({
                    version: "1.2.3",
                    x_test: true,
                });
            } finally {
                db.close();
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("migrates old source table and occurrence column names", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-load-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            const db = new Database(dbPath, { create: true });
            try {
                db.run(`
                    CREATE TABLE bundles (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        root_subpath TEXT NOT NULL DEFAULT '',
                        git INTEGER NOT NULL DEFAULT 0,
                        remote TEXT,
                        branch TEXT,
                        "commit" TEXT,
                        date TEXT,
                        approved TEXT,
                        rating INTEGER,
                        tags TEXT NOT NULL DEFAULT '[]',
                        note TEXT
                    );
                    CREATE TABLE skill_occurrences (
                        skill_id TEXT NOT NULL,
                        bundle_id TEXT NOT NULL,
                        subpath TEXT NOT NULL,
                        location TEXT NOT NULL,
                        PRIMARY KEY (skill_id, bundle_id, subpath)
                    );
                    CREATE INDEX idx_skill_occurrences_bundle_id
                        ON skill_occurrences(bundle_id);
                `);
            } finally {
                db.close();
            }

            await load(dbPath, of(makeItem()));

            const migrated = new Database(dbPath, { readonly: true });
            try {
                const oldTable = migrated
                    .query<{ name: string }, []>(
                        `SELECT name FROM sqlite_master WHERE name = 'bundles'`,
                    )
                    .get();
                const newTable = migrated
                    .query<{ name: string }, []>(
                        `SELECT name FROM sqlite_master WHERE name = 'sources'`,
                    )
                    .get();
                const occurrenceColumns = migrated
                    .query<{ name: string }, []>(`PRAGMA table_info(skill_occurrences)`)
                    .all()
                    .map((row) => row.name);

                expect(oldTable).toBeNull();
                expect(newTable?.name).toBe("sources");
                expect(occurrenceColumns).toContain("source_id");
                expect(occurrenceColumns).not.toContain("bundle_id");
            } finally {
                migrated.close();
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("adds the virustotal report column to existing skills tables", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-load-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            const db = new Database(dbPath, { create: true });
            try {
                db.run(`
                    CREATE TABLE skills (
                        id TEXT PRIMARY KEY,
                        short_id TEXT NOT NULL,
                        version TEXT,
                        date TEXT,
                        version_order INTEGER NOT NULL DEFAULT 0,
                        name TEXT,
                        description TEXT,
                        metadata TEXT NOT NULL DEFAULT '{}',
                        fallback INTEGER NOT NULL DEFAULT 0,
                        approved TEXT,
                        rating INTEGER,
                        tags TEXT NOT NULL DEFAULT '[]',
                        note TEXT
                    );
                `);
            } finally {
                db.close();
            }

            await load(dbPath, of(makeItem()));

            const migrated = new Database(dbPath, { readonly: true });
            try {
                const columns = migrated
                    .query<{ name: string }, []>(`PRAGMA table_info(skills)`)
                    .all()
                    .map((row) => row.name);

                expect(columns).toContain("virustotal");
            } finally {
                migrated.close();
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("preserves stored VirusTotal reports for unchanged skill ids", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-load-test-"));
        const dbPath = join(root, "skills.sqlite");
        const report = JSON.stringify({
            virustotal: {
                analysis_id: "analysis-id",
            },
        });
        try {
            await load(dbPath, of(makeItem()));

            const db = new Database(dbPath);
            try {
                db.query<never, [string]>(
                    `UPDATE skills SET virustotal = ? WHERE id = 'skill-1'`,
                ).run(report);
            } finally {
                db.close();
            }

            await load(
                dbPath,
                of(
                    makeItem({
                        skill: {
                            description: "changed description",
                        },
                    }),
                ),
            );

            const reloaded = new Database(dbPath, { readonly: true });
            try {
                const row = reloaded
                    .query<{ virustotal: string | null }, []>(
                        `SELECT virustotal FROM skills WHERE id = 'skill-1'`,
                    )
                    .get();

                expect(row?.virustotal).toBe(report);
            } finally {
                reloaded.close();
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("rebuilds occurrences when a prior migration left a foreign key to bundles", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-load-test-"));
        const dbPath = join(root, "skills.sqlite");
        try {
            const db = new Database(dbPath, { create: true });
            try {
                db.run(`
                    CREATE TABLE sources (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        root_subpath TEXT NOT NULL DEFAULT '',
                        git INTEGER NOT NULL DEFAULT 0,
                        remote TEXT,
                        branch TEXT,
                        "commit" TEXT,
                        date TEXT,
                        approved TEXT,
                        rating INTEGER,
                        tags TEXT NOT NULL DEFAULT '[]',
                        note TEXT
                    );
                    CREATE TABLE skill_occurrences (
                        skill_id TEXT NOT NULL,
                        source_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
                        subpath TEXT NOT NULL,
                        location TEXT NOT NULL,
                        PRIMARY KEY (skill_id, source_id, subpath)
                    );
                `);
            } finally {
                db.close();
            }

            await load(dbPath, of(makeItem()));

            const migrated = new Database(dbPath, { readonly: true });
            try {
                const foreignTables = migrated
                    .query<{ table: string }, []>(`PRAGMA foreign_key_list(skill_occurrences)`)
                    .all()
                    .map((row) => row.table);

                expect(foreignTables).toContain("sources");
                expect(foreignTables).not.toContain("bundles");
            } finally {
                migrated.close();
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
