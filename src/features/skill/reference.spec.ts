import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { resolveSkillReferenceInDb } from "./reference";

function createSkillReferenceDb(): Database {
    const db = new Database(":memory:");
    db.run(`
        CREATE TABLE skills (
            id TEXT PRIMARY KEY,
            short_id TEXT,
            name TEXT,
            version TEXT,
            version_order INTEGER NOT NULL
        );
        CREATE TABLE skill_occurrences (
            skill_id TEXT NOT NULL,
            subpath TEXT NOT NULL
        );
    `);
    return db;
}

describe("resolveSkillReferenceInDb", () => {
    it("uses version_order as a generated version only when frontmatter version is missing", () => {
        const db = createSkillReferenceDb();
        try {
            db.run(`
                INSERT INTO skills (id, short_id, name, version, version_order)
                VALUES
                    ('generated-v1', 'generated-v1', 'demo', NULL, 1),
                    ('declared-v2', 'declared-v2', 'demo', '2.0.0', 2);
            `);

            expect(resolveSkillReferenceInDb(db, "demo@v1")?.id).toBe("generated-v1");
            expect(resolveSkillReferenceInDb(db, "demo@2.0.0")?.id).toBe("declared-v2");
            expect(resolveSkillReferenceInDb(db, "demo@v2")).toBeNull();
        } finally {
            db.close();
        }
    });

    it("prefers an explicit frontmatter version over the same generated label", () => {
        const db = createSkillReferenceDb();
        try {
            db.run(`
                INSERT INTO skills (id, short_id, name, version, version_order)
                VALUES
                    ('generated-v2', 'generated-v2', 'demo', NULL, 2),
                    ('declared-v2', 'declared-v2', 'demo', 'v2', 3);
            `);

            expect(resolveSkillReferenceInDb(db, "demo@v2")?.id).toBe("declared-v2");
        } finally {
            db.close();
        }
    });
});
