import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { loadConfig } from "@config";
import { resolveSkillsDbPath } from "@features/update/paths";
import type { SkillZipResult, SkillZipStyle } from "@features/zip/deterministic-zip.ts";
import {
    createVerifiedSkillZip,
    type ResolvedZipTarget,
    resolveZipTarget,
} from "@features/zip/zip-action.ts";
import { stringify as stringifyYaml } from "yaml";

const VIRUSTOTAL_API_BASE_URL = "https://www.virustotal.com/api/v3";
const DIRECT_UPLOAD_SIZE_LIMIT_BYTES = 32_000_000;
const LARGE_UPLOAD_SIZE_LIMIT_BYTES = 650_000_000;
const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_POLL_INTERVAL_SECONDS = 15;
const DETECTION_REPORT_LIMIT = 25;

const VIRUSTOTAL_STAT_KEYS = [
    "malicious",
    "suspicious",
    "harmless",
    "undetected",
    "timeout",
    "confirmed-timeout",
    "failure",
    "type-unsupported",
] as const;

type VirusTotalStatKey = (typeof VIRUSTOTAL_STAT_KEYS)[number];

export type VirusTotalStats = Partial<Record<VirusTotalStatKey, number>>;

export type VirusTotalAnalysisResult = {
    category?: string;
    engine_name?: string;
    engine_update?: string;
    engine_version?: string;
    method?: string;
    result?: string | null;
};

export type VirusTotalUploadResponse = {
    data?: {
        id?: string;
        type?: string;
    };
};

export type VirusTotalUploadUrlResponse = {
    data?: string;
};

export type VirusTotalAnalysisResponse = {
    data?: {
        id?: string;
        type?: string;
        attributes?: {
            date?: number;
            results?: Record<string, VirusTotalAnalysisResult>;
            stats?: VirusTotalStats;
            status?: string;
        };
        links?: {
            self?: string;
        };
    };
};

export type VirusTotalFileReportResponse = {
    data?: {
        id?: string;
        type?: string;
        attributes?: {
            last_analysis_date?: number;
            last_analysis_results?: Record<string, VirusTotalAnalysisResult>;
            last_analysis_stats?: VirusTotalStats;
            meaningful_name?: string;
            names?: string[];
            reputation?: number;
            sha256?: string;
            size?: number;
            times_submitted?: number;
            total_votes?: {
                harmless?: number;
                malicious?: number;
            };
            type_description?: string;
        };
        links?: {
            self?: string;
        };
    };
};

export type VirusTotalClient = {
    uploadFile(input: {
        bytes: Uint8Array;
        filename: string;
        size: number;
    }): Promise<VirusTotalUploadResponse>;
    getAnalysis(id: string): Promise<VirusTotalAnalysisResponse>;
    getFileReport(sha256: string): Promise<VirusTotalFileReportResponse>;
};

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;
type HeadersInput = ConstructorParameters<typeof Headers>[0];
type FetchLike = (input: FetchInput, init?: FetchInit) => Promise<Response>;

export type VirusTotalActionOptions = {
    skill: string;
    style?: SkillZipStyle;
    timeoutSeconds?: number;
    pollIntervalSeconds?: number;
    json?: boolean;
    client?: VirusTotalClient;
    apiKey?: string;
};

export type VirusTotalReportInput = {
    skill: string;
    target: ResolvedZipTarget;
    zip: SkillZipResult;
    upload: VirusTotalUploadResponse;
    analysis: VirusTotalAnalysisResponse;
    fileReport: VirusTotalFileReportResponse;
};

export type VirusTotalStoredReport = {
    skill: string;
    path: string;
    stored_at: string;
    zip: {
        sha256: string;
        size: number;
        style: SkillZipStyle;
        entries: string[];
    };
    virustotal: {
        analysis_id: string;
        file_id: string;
        status: string;
        report_url: string;
        api_report_url: string;
        last_analysis_date?: string;
        type?: string;
        reputation?: number;
        stats: VirusTotalStats;
        detections: Array<{
            engine: string;
            category: string;
            result: string;
        }>;
        detections_truncated?: number;
        upload: VirusTotalUploadResponse;
        analysis: VirusTotalAnalysisResponse;
        file_report: VirusTotalFileReportResponse;
    };
};

export async function virustotalAction(options: VirusTotalActionOptions): Promise<void> {
    const config = await loadConfig();
    const dbPath = resolveSkillsDbPath(config);
    const target = await resolveZipTarget(options.skill);
    const existingIndexedReport = target.expectedSha256
        ? readSkillVirusTotalReport(dbPath, target.expectedSha256)
        : null;
    if (existingIndexedReport) {
        writeProgress(
            `Existing VirusTotal report found in skills.virustotal for ${target.expectedSha256}`,
        );
        writeVirusTotalReport(existingIndexedReport, Boolean(options.json), {
            exists: true,
        });
        return;
    }

    const zip = await createVerifiedSkillZip(target, {
        skill: options.skill,
        style: options.style,
    });
    const existingReport = readSkillVirusTotalReport(dbPath, zip.sha256);
    if (existingReport) {
        writeProgress(`Existing VirusTotal report found in skills.virustotal for ${zip.sha256}`);
        writeVirusTotalReport(existingReport, Boolean(options.json), {
            exists: true,
        });
        return;
    }

    if (zip.size > LARGE_UPLOAD_SIZE_LIMIT_BYTES) {
        throw new Error(
            `Skill archive is too large for VirusTotal upload: ${formatBytes(
                zip.size,
            )}. Maximum supported size is ${formatBytes(LARGE_UPLOAD_SIZE_LIMIT_BYTES)}.`,
        );
    }

    const apiKey = options.apiKey ?? (await resolveVirusTotalApiKey(config.virustotal?.api_key));
    const client = options.client ?? createVirusTotalClient({ apiKey });
    writeProgress(
        `Uploading ${formatBytes(zip.size)} ${zip.style} skill zip to VirusTotal (${zip.sha256})`,
    );
    const upload = await client.uploadFile({
        bytes: zip.bytes,
        filename: createUploadFilename(options.skill),
        size: zip.size,
    });
    const analysisId = getUploadAnalysisId(upload);
    writeProgress(`VirusTotal analysis id: ${analysisId}`);

    const analysis = await waitForCompletedAnalysis(client, analysisId, {
        timeoutSeconds: options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        pollIntervalSeconds: options.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
        onStatus: (status) => writeProgress(`VirusTotal status: ${status}`),
    });
    const fileReport = await client.getFileReport(zip.sha256);
    const reportInput: VirusTotalReportInput = {
        skill: options.skill,
        target,
        zip,
        upload,
        analysis,
        fileReport,
    };
    const report = buildVirusTotalStoredReport(reportInput);
    const stored = writeSkillVirusTotalReport(dbPath, zip.sha256, report);
    if (stored) {
        writeProgress(`Stored VirusTotal report in skills.virustotal for ${zip.sha256}`);
    } else {
        writeProgress(
            `VirusTotal report was not stored because no indexed skill row exists for ${zip.sha256}`,
        );
    }

    writeVirusTotalReport(report, Boolean(options.json));
}

export function createVirusTotalClient({
    apiKey,
    baseUrl = VIRUSTOTAL_API_BASE_URL,
    fetchImpl = fetch,
}: {
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: FetchLike;
}): VirusTotalClient {
    async function requestJson<T>(pathOrUrl: string, init: FetchInit = {}): Promise<T> {
        const url = buildVirusTotalUrl(baseUrl, pathOrUrl);
        const response = await fetchImpl(url, {
            ...init,
            headers: buildVirusTotalHeaders(apiKey, init.headers),
        });
        if (!response.ok) {
            throw new Error(await formatVirusTotalHttpError(response, url));
        }

        const body = await response.text();
        if (body.trim() === "") {
            throw new Error(`VirusTotal returned an empty response for ${url}`);
        }

        try {
            return JSON.parse(body) as T;
        } catch (error) {
            throw new Error(
                `VirusTotal returned invalid JSON for ${url}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { cause: error },
            );
        }
    }

    async function getLargeUploadUrl(): Promise<string> {
        const response = await requestJson<VirusTotalUploadUrlResponse>("/files/upload_url");
        if (typeof response.data !== "string" || response.data.trim() === "") {
            throw new Error("VirusTotal upload_url response did not include an upload URL.");
        }
        return response.data;
    }

    return {
        async uploadFile({ bytes, filename, size }) {
            const uploadUrl =
                size > DIRECT_UPLOAD_SIZE_LIMIT_BYTES ? await getLargeUploadUrl() : "/files";
            return requestJson<VirusTotalUploadResponse>(uploadUrl, {
                method: "POST",
                body: createUploadFormData(bytes, filename),
            });
        },
        getAnalysis(id) {
            return requestJson<VirusTotalAnalysisResponse>(`/analyses/${encodeURIComponent(id)}`);
        },
        getFileReport(sha256) {
            return requestJson<VirusTotalFileReportResponse>(
                `/files/${encodeURIComponent(sha256)}`,
            );
        },
    };
}

export async function resolveVirusTotalApiKey(rawApiKey: string | undefined): Promise<string> {
    const value = rawApiKey?.trim();
    if (!value) {
        throw new Error(
            'Missing config value virustotal.api_key. Add [virustotal] api_key = "..." to ~/.config/skills/config.toml or local.toml.',
        );
    }

    if (!value.startsWith("!")) {
        return value;
    }

    const command = value.slice(1).trim();
    if (!command) {
        throw new Error("virustotal.api_key shell command is empty.");
    }

    const output = await runShellCommand(command);
    const apiKey = output.trim();
    if (!apiKey) {
        throw new Error("virustotal.api_key shell command produced no output.");
    }
    return apiKey;
}

export async function waitForCompletedAnalysis(
    client: Pick<VirusTotalClient, "getAnalysis">,
    analysisId: string,
    options: {
        timeoutSeconds: number;
        pollIntervalSeconds: number;
        sleep?: (ms: number) => Promise<void>;
        now?: () => number;
        onStatus?: (status: string, analysis: VirusTotalAnalysisResponse) => void;
    },
): Promise<VirusTotalAnalysisResponse> {
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;
    const timeoutMs = options.timeoutSeconds * 1000;
    const pollIntervalMs = options.pollIntervalSeconds * 1000;
    const deadline = now() + timeoutMs;
    let lastStatus: string | undefined;

    while (true) {
        const analysis = await client.getAnalysis(analysisId);
        const status = getAnalysisStatus(analysis);
        if (status !== lastStatus) {
            options.onStatus?.(status, analysis);
            lastStatus = status;
        }
        if (status === "completed") {
            return analysis;
        }

        const remainingMs = deadline - now();
        if (remainingMs <= 0) {
            throw new Error(
                `VirusTotal analysis ${analysisId} did not complete within ${options.timeoutSeconds} seconds; last status: ${status}.`,
            );
        }

        await sleep(Math.min(pollIntervalMs, remainingMs));
    }
}

export function formatVirusTotalTextReport(input: VirusTotalStoredReport): string {
    return stringifyYaml(
        {
            skill: input.skill,
            path: input.path,
            zip: input.zip,
            virustotal: {
                analysis_id: input.virustotal.analysis_id,
                file_id: input.virustotal.file_id,
                status: input.virustotal.status,
                report_url: input.virustotal.report_url,
                api_report_url: input.virustotal.api_report_url,
                ...(input.virustotal.last_analysis_date
                    ? {
                          last_analysis_date: input.virustotal.last_analysis_date,
                      }
                    : {}),
                ...(input.virustotal.type ? { type: input.virustotal.type } : {}),
                ...(typeof input.virustotal.reputation === "number"
                    ? { reputation: input.virustotal.reputation }
                    : {}),
                stats: input.virustotal.stats,
                detections: input.virustotal.detections,
                ...(input.virustotal.detections_truncated
                    ? {
                          detections_truncated: input.virustotal.detections_truncated,
                      }
                    : {}),
            },
        },
        { lineWidth: 0 },
    );
}

function writeVirusTotalReport(
    report: VirusTotalStoredReport,
    json: boolean,
    options: { exists?: boolean } = {},
) {
    if (json) {
        const output = options.exists ? { exists: true, ...report } : report;
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        return;
    }

    if (options.exists) {
        process.stdout.write("exists: yes\n");
    }
    process.stdout.write(formatVirusTotalTextReport(report));
}

export function buildVirusTotalStoredReport(
    input: VirusTotalReportInput,
    now: Date = new Date(),
): VirusTotalStoredReport {
    const analysisAttributes = input.analysis.data?.attributes;
    const fileAttributes = input.fileReport.data?.attributes;
    const allDetections = collectDetections(
        fileAttributes?.last_analysis_results ?? analysisAttributes?.results,
    );
    const detections = allDetections.slice(0, DETECTION_REPORT_LIMIT);
    const lastAnalysisDate = formatUnixSeconds(
        fileAttributes?.last_analysis_date ?? analysisAttributes?.date,
    );

    return {
        skill: input.skill,
        path: input.target.rootDir,
        stored_at: now.toISOString(),
        zip: {
            sha256: input.zip.sha256,
            size: input.zip.size,
            style: input.zip.style,
            entries: input.zip.entries,
        },
        virustotal: {
            analysis_id: getUploadAnalysisId(input.upload),
            file_id: input.fileReport.data?.id ?? input.zip.sha256,
            status: getAnalysisStatus(input.analysis),
            report_url: `https://www.virustotal.com/gui/file/${input.zip.sha256}/detection`,
            api_report_url: `${VIRUSTOTAL_API_BASE_URL}/files/${input.zip.sha256}`,
            ...(lastAnalysisDate ? { last_analysis_date: lastAnalysisDate } : {}),
            ...(fileAttributes?.type_description ? { type: fileAttributes.type_description } : {}),
            ...(typeof fileAttributes?.reputation === "number"
                ? { reputation: fileAttributes.reputation }
                : {}),
            stats: normalizeStats(fileAttributes?.last_analysis_stats ?? analysisAttributes?.stats),
            detections,
            ...(allDetections.length > detections.length
                ? {
                      detections_truncated: allDetections.length - detections.length,
                  }
                : {}),
            upload: input.upload,
            analysis: input.analysis,
            file_report: input.fileReport,
        },
    };
}

export function writeSkillVirusTotalReport(
    dbPath: string,
    skillId: string,
    report: VirusTotalStoredReport,
): boolean {
    if (!existsSync(dbPath)) {
        return false;
    }

    const db = new Database(dbPath);
    try {
        if (!tableExists(db, "skills")) {
            return false;
        }
        ensureSkillVirusTotalColumn(db);
        const result = db
            .query<never, { $id: string; $virustotal: string }>(
                `UPDATE skills
                 SET virustotal = $virustotal
                 WHERE id = $id`,
            )
            .run({
                $id: skillId,
                $virustotal: JSON.stringify(report, null, 2),
            });
        return result.changes > 0;
    } finally {
        db.close();
    }
}

export function readSkillVirusTotalReport(
    dbPath: string,
    skillId: string,
): VirusTotalStoredReport | null {
    if (!existsSync(dbPath)) {
        return null;
    }

    const db = new Database(dbPath, { readonly: true });
    try {
        if (!tableExists(db, "skills") || !tableColumns(db, "skills").includes("virustotal")) {
            return null;
        }

        const row = db
            .query<{ virustotal: string | null }, { $id: string }>(
                `SELECT virustotal
                 FROM skills
                 WHERE id = $id`,
            )
            .get({ $id: skillId });
        const rawReport = row?.virustotal?.trim();
        if (!rawReport) {
            return null;
        }

        try {
            return JSON.parse(rawReport) as VirusTotalStoredReport;
        } catch (error) {
            throw new Error(
                `Stored VirusTotal report for ${skillId} is not valid JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { cause: error },
            );
        }
    } finally {
        db.close();
    }
}

function buildVirusTotalUrl(baseUrl: string, pathOrUrl: string): string {
    if (/^https?:\/\//.test(pathOrUrl)) {
        return pathOrUrl;
    }

    return `${baseUrl.replace(/\/+$/, "")}/${pathOrUrl.startsWith("/") ? pathOrUrl.slice(1) : pathOrUrl}`;
}

function quoteSqlIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}

function tableExists(db: Database, tableName: string): boolean {
    const row = db
        .query<{ found: number }, { $name: string }>(
            `SELECT 1 AS found
             FROM sqlite_master
             WHERE type IN ('table', 'view') AND name = $name
             LIMIT 1`,
        )
        .get({ $name: tableName });
    return row !== null;
}

function tableColumns(db: Database, tableName: string): string[] {
    return db
        .query<{ name: string }, []>(`PRAGMA table_info(${quoteSqlIdentifier(tableName)})`)
        .all()
        .map((row) => row.name);
}

function ensureSkillVirusTotalColumn(db: Database): void {
    if (tableColumns(db, "skills").includes("virustotal")) {
        return;
    }
    db.run(`ALTER TABLE skills ADD COLUMN virustotal TEXT`);
}

function buildVirusTotalHeaders(apiKey: string, headers: HeadersInput | undefined): Headers {
    const merged = new Headers(headers);
    merged.set("accept", "application/json");
    merged.set("x-apikey", apiKey);
    return merged;
}

function createUploadFormData(bytes: Uint8Array, filename: string): FormData {
    const formData = new FormData();
    formData.append("file", new Blob([bytes], { type: "application/zip" }), filename);
    return formData;
}

function getUploadAnalysisId(response: VirusTotalUploadResponse): string {
    const analysisId = response.data?.id;
    if (!analysisId) {
        throw new Error("VirusTotal upload response did not include an analysis id.");
    }
    return analysisId;
}

function getAnalysisStatus(response: VirusTotalAnalysisResponse): string {
    return response.data?.attributes?.status ?? "unknown";
}

function normalizeStats(stats: VirusTotalStats | undefined): VirusTotalStats {
    const normalized: VirusTotalStats = {};
    for (const key of VIRUSTOTAL_STAT_KEYS) {
        const value = stats?.[key];
        if (typeof value === "number") {
            normalized[key] = value;
        }
    }
    return normalized;
}

function collectDetections(results: Record<string, VirusTotalAnalysisResult> | undefined): Array<{
    engine: string;
    category: string;
    result: string;
}> {
    if (!results) {
        return [];
    }

    return Object.entries(results)
        .map(([engine, result]) => {
            const category = result.category ?? "";
            return {
                engine: result.engine_name ?? engine,
                category,
                result: result.result ?? "-",
            };
        })
        .filter((result) => result.category === "malicious" || result.category === "suspicious")
        .sort(compareDetections);
}

function compareDetections(
    a: { engine: string; category: string },
    b: { engine: string; category: string },
): number {
    const categoryOrder = detectionCategoryOrder(a.category) - detectionCategoryOrder(b.category);
    if (categoryOrder !== 0) return categoryOrder;
    return a.engine.localeCompare(b.engine);
}

function detectionCategoryOrder(category: string): number {
    if (category === "malicious") return 0;
    if (category === "suspicious") return 1;
    return 2;
}

async function runShellCommand(command: string): Promise<string> {
    const shell = process.env.SHELL || "/bin/sh";
    const processHandle = Bun.spawn([shell, "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        processHandle.exited,
        new Response(processHandle.stdout).text(),
        new Response(processHandle.stderr).text(),
    ]);

    if (exitCode !== 0) {
        const message = stderr.trim() || stdout.trim() || "no output";
        throw new Error(
            `virustotal.api_key shell command failed with exit code ${exitCode}: ${message}`,
        );
    }

    return stdout;
}

async function formatVirusTotalHttpError(response: Response, url: string): Promise<string> {
    const body = await response.text();
    const detail = parseVirusTotalErrorDetail(body);
    return `VirusTotal request failed (${response.status} ${response.statusText}) for ${url}${
        detail ? `: ${detail}` : ""
    }`;
}

function parseVirusTotalErrorDetail(body: string): string | null {
    if (body.trim() === "") {
        return null;
    }

    try {
        const parsed = JSON.parse(body) as {
            error?: { code?: string; message?: string };
        };
        const code = parsed.error?.code;
        const message = parsed.error?.message;
        if (code && message) return `${code}: ${message}`;
        if (message) return message;
        if (code) return code;
    } catch {
        return body.trim().slice(0, 500);
    }

    return body.trim().slice(0, 500);
}

function createUploadFilename(skill: string): string {
    const sanitized = skill.replaceAll(/[^A-Za-z0-9._-]+/g, "_").replaceAll(/^_+|_+$/g, "");
    return `${sanitized || "skill"}.zip`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const mib = bytes / (1024 * 1024);
    if (mib >= 1) return `${mib.toFixed(2)} MiB`;
    return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatUnixSeconds(seconds: number | undefined): string | undefined {
    if (typeof seconds !== "number") {
        return undefined;
    }
    return new Date(seconds * 1000).toISOString();
}

function writeProgress(message: string): void {
    process.stderr.write(`${message}\n`);
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
