import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type InstallRecord, listInstalls, recordInstall, removeInstallRecord } from "./installs";

async function makeTempDir(): Promise<string> {
    return mkdtemp(path.join(tmpdir(), "skills-installs-"));
}

function makeRecord(overrides: Partial<InstallRecord> = {}): InstallRecord {
    return {
        skillId: "a".repeat(64),
        name: "demo-skill",
        targetDir: "/project/.agents/skills/demo-skill",
        scope: "local",
        installedAt: "2026-06-27T10:00:00.000Z",
        projectDir: "/project",
        gitRemote: "git@github.com:acme/project.git",
        gitBranch: "main",
        gitCommit: "c".repeat(40),
        ...overrides,
    };
}

describe("install state", () => {
    it("returns an empty list when the database is absent", () => {
        expect(listInstalls("/nonexistent/skills.sqlite")).toEqual([]);
    });

    it("records and reads back an install", async () => {
        const dir = await makeTempDir();
        const dbPath = path.join(dir, "skills.sqlite");
        try {
            const record = makeRecord();
            await recordInstall(dbPath, record);

            expect(listInstalls(dbPath)).toEqual([record]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("upserts on the install location instead of duplicating", async () => {
        const dir = await makeTempDir();
        const dbPath = path.join(dir, "skills.sqlite");
        try {
            await recordInstall(dbPath, makeRecord({ installedAt: "2026-06-27T10:00:00.000Z" }));
            await recordInstall(
                dbPath,
                makeRecord({
                    installedAt: "2026-06-28T12:00:00.000Z",
                    skillId: "b".repeat(64),
                    gitBranch: "feature",
                }),
            );

            const records = listInstalls(dbPath);
            expect(records).toHaveLength(1);
            expect(records[0]?.skillId).toBe("b".repeat(64));
            expect(records[0]?.gitBranch).toBe("feature");
            expect(records[0]?.installedAt).toBe("2026-06-28T12:00:00.000Z");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("orders multiple installs newest first", async () => {
        const dir = await makeTempDir();
        const dbPath = path.join(dir, "skills.sqlite");
        try {
            await recordInstall(
                dbPath,
                makeRecord({
                    targetDir: "/project/.agents/skills/old",
                    installedAt: "2026-06-01T00:00:00.000Z",
                }),
            );
            await recordInstall(
                dbPath,
                makeRecord({
                    targetDir: "/project/.agents/skills/new",
                    installedAt: "2026-06-20T00:00:00.000Z",
                }),
            );

            const targets = listInstalls(dbPath).map((record) => record.targetDir);
            expect(targets).toEqual([
                "/project/.agents/skills/new",
                "/project/.agents/skills/old",
            ]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("preserves null project and git fields", async () => {
        const dir = await makeTempDir();
        const dbPath = path.join(dir, "skills.sqlite");
        try {
            const record = makeRecord({
                projectDir: null,
                gitRemote: null,
                gitBranch: null,
                gitCommit: null,
            });
            await recordInstall(dbPath, record);

            expect(listInstalls(dbPath)[0]).toEqual(record);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("removes the record for an install location", async () => {
        const dir = await makeTempDir();
        const dbPath = path.join(dir, "skills.sqlite");
        try {
            const record = makeRecord();
            await recordInstall(dbPath, record);
            removeInstallRecord(dbPath, record.targetDir);

            expect(listInstalls(dbPath)).toEqual([]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("ignores removal when the database is absent", () => {
        expect(() => removeInstallRecord("/nonexistent/skills.sqlite", "/x")).not.toThrow();
    });
});
