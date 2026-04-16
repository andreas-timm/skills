import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    buildVirusTotalStoredReport,
    createVirusTotalClient,
    formatVirusTotalTextReport,
    readSkillVirusTotalReport,
    resolveVirusTotalApiKey,
    type VirusTotalAnalysisResponse,
    waitForCompletedAnalysis,
    writeSkillVirusTotalReport,
} from "./virustotal.ts";

describe("resolveVirusTotalApiKey", () => {
    it("returns a trimmed literal API key", async () => {
        await expect(resolveVirusTotalApiKey("  vt-key  ")).resolves.toBe("vt-key");
    });

    it("resolves API keys from shell commands prefixed with !", async () => {
        await expect(resolveVirusTotalApiKey("!printf 'shell-key\\n'")).resolves.toBe("shell-key");
    });

    it("rejects missing API keys", async () => {
        await expect(resolveVirusTotalApiKey(undefined)).rejects.toThrow(
            "Missing config value virustotal.api_key",
        );
    });
});

describe("createVirusTotalClient", () => {
    it("uploads small files to the direct file endpoint with the API key header", async () => {
        const requests: Array<{
            url: string;
            init?: Parameters<typeof fetch>[1];
        }> = [];
        const client = createVirusTotalClient({
            apiKey: "vt-key",
            baseUrl: "https://vt.example/api/v3",
            fetchImpl: async (input, init) => {
                requests.push({ url: String(input), init });
                return new Response(JSON.stringify({ data: { id: "analysis-id" } }), {
                    status: 200,
                });
            },
        });

        const response = await client.uploadFile({
            bytes: new Uint8Array([1, 2, 3]),
            filename: "skill.zip",
            size: 3,
        });

        expect(response.data?.id).toBe("analysis-id");
        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toBe("https://vt.example/api/v3/files");
        expect(new Headers(requests[0]?.init?.headers).get("x-apikey")).toBe("vt-key");
        expect(requests[0]?.init?.body).toBeInstanceOf(FormData);
    });
});

describe("waitForCompletedAnalysis", () => {
    it("polls until VirusTotal reports completion", async () => {
        const statuses = ["queued", "in-progress", "completed"];
        const seen: string[] = [];
        const client = {
            async getAnalysis(): Promise<VirusTotalAnalysisResponse> {
                return {
                    data: {
                        attributes: {
                            status: statuses.shift() ?? "completed",
                        },
                    },
                };
            },
        };

        const result = await waitForCompletedAnalysis(client, "analysis-id", {
            timeoutSeconds: 10,
            pollIntervalSeconds: 1,
            sleep: async () => {},
            onStatus: (status) => seen.push(status),
        });

        expect(result.data?.attributes?.status).toBe("completed");
        expect(seen).toEqual(["queued", "in-progress", "completed"]);
    });

    it("fails when the analysis does not complete before the timeout", async () => {
        let now = 0;
        const client = {
            async getAnalysis(): Promise<VirusTotalAnalysisResponse> {
                return {
                    data: {
                        attributes: {
                            status: "queued",
                        },
                    },
                };
            },
        };

        await expect(
            waitForCompletedAnalysis(client, "analysis-id", {
                timeoutSeconds: 1,
                pollIntervalSeconds: 1,
                now: () => now,
                sleep: async (ms) => {
                    now += ms;
                },
            }),
        ).rejects.toThrow("did not complete within 1 seconds");
    });
});

describe("formatVirusTotalTextReport", () => {
    it("renders report metadata, stats, and malicious detections", () => {
        const output = formatVirusTotalTextReport(makeStoredReport());

        expect(output).toContain("analysis_id: analysis-id");
        expect(output).toContain(
            "report_url: https://www.virustotal.com/gui/file/abc123/detection",
        );
        expect(output).toContain("malicious: 1");
        expect(output).toContain("engine: MalwareEngine");
        expect(output).toContain("result: Demo.Trojan");
        expect(output).not.toContain("CleanEngine");
    });
});

describe("writeSkillVirusTotalReport", () => {
    it("adds the virustotal column when needed and stores report JSON", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "skills-vt-report-"));
        try {
            const dbPath = path.join(root, "skills.sqlite");
            const db = new Database(dbPath, { create: true });
            try {
                db.run(`
                    CREATE TABLE skills (
                        id TEXT PRIMARY KEY,
                        short_id TEXT NOT NULL
                    );
                    INSERT INTO skills (id, short_id)
                    VALUES ('abc123', 'abc123');
                `);
            } finally {
                db.close();
            }

            const stored = writeSkillVirusTotalReport(dbPath, "abc123", makeStoredReport());

            expect(stored).toBe(true);
            const updated = new Database(dbPath, { readonly: true });
            try {
                const columns = updated
                    .query<{ name: string }, []>(`PRAGMA table_info(skills)`)
                    .all()
                    .map((row) => row.name);
                const row = updated
                    .query<{ virustotal: string | null }, []>(
                        `SELECT virustotal FROM skills WHERE id = 'abc123'`,
                    )
                    .get();
                const parsed = JSON.parse(row?.virustotal ?? "{}") as {
                    virustotal?: { analysis_id?: string };
                };

                expect(columns).toContain("virustotal");
                expect(parsed.virustotal?.analysis_id).toBe("analysis-id");
            } finally {
                updated.close();
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("returns false when no indexed skill row exists", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "skills-vt-report-"));
        try {
            const dbPath = path.join(root, "skills.sqlite");
            const db = new Database(dbPath, { create: true });
            try {
                db.run(`
                    CREATE TABLE skills (
                        id TEXT PRIMARY KEY,
                        short_id TEXT NOT NULL,
                        virustotal TEXT
                    );
                `);
            } finally {
                db.close();
            }

            expect(writeSkillVirusTotalReport(dbPath, "missing", makeStoredReport())).toBe(false);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe("readSkillVirusTotalReport", () => {
    it("reads an existing stored report by full skill id", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "skills-vt-report-"));
        try {
            const dbPath = path.join(root, "skills.sqlite");
            const report = makeStoredReport();
            const db = new Database(dbPath, { create: true });
            try {
                db.run(`
                    CREATE TABLE skills (
                        id TEXT PRIMARY KEY,
                        short_id TEXT NOT NULL,
                        virustotal TEXT
                    );
                `);
                db.query<never, [string]>(
                    `INSERT INTO skills (id, short_id, virustotal)
                     VALUES ('abc123', 'abc123', ?)`,
                ).run(JSON.stringify(report));
            } finally {
                db.close();
            }

            expect(readSkillVirusTotalReport(dbPath, "abc123")?.virustotal.analysis_id).toBe(
                "analysis-id",
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("returns null when the report is missing", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "skills-vt-report-"));
        try {
            const dbPath = path.join(root, "skills.sqlite");
            const db = new Database(dbPath, { create: true });
            try {
                db.run(`
                    CREATE TABLE skills (
                        id TEXT PRIMARY KEY,
                        short_id TEXT NOT NULL,
                        virustotal TEXT
                    );
                    INSERT INTO skills (id, short_id)
                    VALUES ('abc123', 'abc123');
                `);
            } finally {
                db.close();
            }

            expect(readSkillVirusTotalReport(dbPath, "abc123")).toBeNull();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

function makeStoredReport() {
    return buildVirusTotalStoredReport(
        {
            skill: "demo",
            target: {
                rootDir: "/tmp/demo",
                expectedSha256: null,
            },
            zip: {
                bytes: new Uint8Array([1, 2, 3]),
                sha256: "abc123",
                size: 3,
                entries: ["SKILL.md"],
                style: "unix",
            },
            upload: {
                data: {
                    id: "analysis-id",
                    type: "analysis",
                },
            },
            analysis: {
                data: {
                    id: "analysis-id",
                    type: "analysis",
                    attributes: {
                        status: "completed",
                        stats: {
                            malicious: 1,
                            suspicious: 0,
                        },
                    },
                },
            },
            fileReport: {
                data: {
                    id: "abc123",
                    type: "file",
                    attributes: {
                        last_analysis_date: 1_700_000_000,
                        last_analysis_stats: {
                            malicious: 1,
                            suspicious: 0,
                            harmless: 9,
                            undetected: 2,
                        },
                        last_analysis_results: {
                            CleanEngine: {
                                category: "harmless",
                                engine_name: "CleanEngine",
                                result: "clean",
                            },
                            MalwareEngine: {
                                category: "malicious",
                                engine_name: "MalwareEngine",
                                result: "Demo.Trojan",
                            },
                        },
                        type_description: "ZIP",
                    },
                },
            },
        },
        new Date("2026-04-25T00:00:00.000Z"),
    );
}
