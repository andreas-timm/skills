import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { shortSkillId } from "@features/skill/id";
import { createDeterministicSkillZip } from "./deterministic-zip.ts";
import {
    createVerifiedSkillZip,
    resolveIndexedSkillId,
    resolveIndexedZipTarget,
} from "./zip-action.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop();
        if (!root) continue;
        await rm(root, { recursive: true, force: true });
    }
});

async function createIndexedSkillFixture(): Promise<{
    dbPath: string;
    locationRoot: string;
    skillDir: string;
    skillId: string;
    shortId: string;
}> {
    const root = await mkdtemp(path.join(tmpdir(), "skills-zip-action-"));
    tempRoots.push(root);

    const locationRoot = path.join(root, "location");
    const skillDir = path.join(locationRoot, "source", "demo");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
        path.join(skillDir, "SKILL.md"),
        "---\nname: demo\ndescription: Demo\n---\n\n# Demo\n",
        "utf-8",
    );

    const zip = await createDeterministicSkillZip({ rootDir: skillDir });
    const dbPath = path.join(root, "skills.sqlite");
    const shortId = shortSkillId(zip.sha256);
    const db = new Database(dbPath, { create: true });
    try {
        db.run(`
            CREATE TABLE sources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                root_subpath TEXT NOT NULL DEFAULT '',
                git INTEGER NOT NULL DEFAULT 0,
                date TEXT
            );
            CREATE TABLE skills (
                id TEXT PRIMARY KEY,
                short_id TEXT NOT NULL
            );
            CREATE TABLE skill_occurrences (
                skill_id TEXT NOT NULL,
                source_id TEXT NOT NULL,
                subpath TEXT NOT NULL,
                location TEXT NOT NULL,
                PRIMARY KEY (skill_id, source_id, subpath)
            );

            INSERT INTO sources (id, name, git, date)
            VALUES ('source-1', 'source', 0, '2026-04-24T00:00:00.000Z');
            INSERT INTO skills (id, short_id)
            VALUES ('${zip.sha256}', '${shortId}');
            INSERT INTO skill_occurrences (skill_id, source_id, subpath, location)
            VALUES ('${zip.sha256}', 'source-1', 'source/demo', 'local');
        `);
    } finally {
        db.close();
    }

    return {
        dbPath,
        locationRoot,
        skillDir,
        skillId: zip.sha256,
        shortId,
    };
}

describe("resolveIndexedZipTarget", () => {
    it("finds the skill folder by full or short skill id", async () => {
        const fixture = await createIndexedSkillFixture();

        expect(resolveIndexedSkillId(fixture.dbPath, fixture.skillId)).toBe(fixture.skillId);
        expect(resolveIndexedSkillId(fixture.dbPath, fixture.shortId)).toBe(fixture.skillId);

        expect(
            resolveIndexedZipTarget(fixture.shortId, {
                dbPath: fixture.dbPath,
                locationRoots: { local: fixture.locationRoot },
            }),
        ).toEqual({
            rootDir: fixture.skillDir,
            expectedSha256: fixture.skillId,
        });
    });

    it("rejects ambiguous short skill ids", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "skills-zip-action-"));
        tempRoots.push(root);
        const dbPath = path.join(root, "skills.sqlite");
        const db = new Database(dbPath, { create: true });
        try {
            db.run(`
                CREATE TABLE skills (
                    id TEXT PRIMARY KEY,
                    short_id TEXT NOT NULL
                );

                INSERT INTO skills (id, short_id)
                VALUES
                    ('deadbeef11111111111111111111111111111111111111111111111111111111', 'deadbeef'),
                    ('deadbeef22222222222222222222222222222222222222222222222222222222', 'deadbeef');
            `);
        } finally {
            db.close();
        }

        expect(() => resolveIndexedSkillId(dbPath, "deadbeef")).toThrow(
            'Ambiguous skill short id "deadbeef"',
        );
    });
});

describe("createVerifiedSkillZip", () => {
    it("rejects a rebuilt zip whose SHA-256 no longer matches the indexed id", async () => {
        const fixture = await createIndexedSkillFixture();
        await writeFile(
            path.join(fixture.skillDir, "SKILL.md"),
            "---\nname: demo\ndescription: Changed\n---\n\n# Demo\n",
            "utf-8",
        );

        await expect(
            createVerifiedSkillZip(
                {
                    rootDir: fixture.skillDir,
                    expectedSha256: fixture.skillId,
                },
                { skill: fixture.shortId },
            ),
        ).rejects.toThrow("Created zip SHA-256 does not match indexed skill id");
    });
});
