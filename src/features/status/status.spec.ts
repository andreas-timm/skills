import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { formatStatusDbSummary, readStatusDbSummary } from "./status";

describe("status db summary", () => {
    it("formats source and skill status instead of raw db tables", () => {
        const db = new Database(":memory:", { create: true });
        try {
            db.run(`
                CREATE TABLE sources (
                    id TEXT PRIMARY KEY,
                    git INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE skills (
                    id TEXT PRIMARY KEY,
                    fallback INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE skill_chunks (
                    id TEXT PRIMARY KEY,
                    skill_id TEXT NOT NULL
                );
                CREATE VIRTUAL TABLE skills_fts USING fts5(name);

                INSERT INTO sources (id, git)
                VALUES ('source-1', 1), ('source-2', 0);
                INSERT INTO skills (id, fallback)
                VALUES ('skill-1', 1), ('skill-2', 0), ('skill-3', 0);
                INSERT INTO skill_chunks (id, skill_id)
                VALUES
                    ('skill-1#0', 'skill-1'),
                    ('skill-1#1', 'skill-1'),
                    ('skill-2#0', 'skill-2');
                INSERT INTO skills_fts (name) VALUES ('ignored shadow table');
            `);

            expect(formatStatusDbSummary(readStatusDbSummary(db))).toBe(`sources:
- total: 2
- git flag: 1
skills:
- total: 3
- fallback flag: 1
- embed created: yes
- embedded skills: 2
- embedded chunks: 3`);
        } finally {
            db.close();
        }
    });

    it("reports missing optional embed tables as not created", () => {
        const db = new Database(":memory:", { create: true });
        try {
            db.run(`
                CREATE TABLE sources (
                    id TEXT PRIMARY KEY,
                    git INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE skills (
                    id TEXT PRIMARY KEY,
                    fallback INTEGER NOT NULL DEFAULT 0
                );

                INSERT INTO sources (id, git) VALUES ('source-1', 0);
                INSERT INTO skills (id, fallback) VALUES ('skill-1', 0);
            `);

            expect(readStatusDbSummary(db)).toEqual({
                sources: {
                    total: 1,
                    gitFlag: 0,
                },
                skills: {
                    total: 1,
                    fallbackFlag: 0,
                    embedCreated: false,
                    embedded: 0,
                    embeddedChunks: 0,
                },
            });
            expect(formatStatusDbSummary(readStatusDbSummary(db))).toBe(`sources:
- total: 1
- git flag: 0
skills:
- total: 1
- fallback flag: 0
- embed created: no`);
        } finally {
            db.close();
        }
    });
});
