import { Database } from "bun:sqlite";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { getLogger } from "@andreas-timm/logger";
import { loadConfig } from "@config";
import {
    AGENT_NAMES,
    AGENT_SKILLS_DIRS,
    type AgentName,
    LOCAL_SKILLS_DIR,
} from "@features/agent/skills-dir";
import { approvedLocationNames, effectiveApprovalStatus } from "@features/approve/effective";
import { type ApprovalStatus, isApprovalStatus } from "@features/approve/status";
import { resolveSkillReferenceInDb } from "@features/skill/reference";
import { expandSkillLocationRoots, resolveSkillsDbPath } from "@features/update/paths";
import {
    createVerifiedSkillZip,
    type ResolvedZipTarget,
    resolveDirectSkillPath,
    resolveIndexedZipTarget,
} from "@features/zip/zip-action";
import { unzipSync } from "fflate";
import matter from "gray-matter";

export type InstallActionOptions = {
    skill: string;
    force?: boolean;
    global?: boolean | string;
};

export type InstallSkillOptions = InstallActionOptions & {
    cwd?: string;
    dbPath?: string;
    homeDir?: string;
    locationRoots?: Record<string, string>;
    approvedLocations?: readonly string[];
};

export type InstallSkillResult = {
    skillName: string;
    rootDir: string;
    targetDir: string;
    sha256: string;
    size: number;
    entries: string[];
};

type ErrorWithCode = {
    code?: string;
};

type IndexedInstallContext = {
    dbPath: string;
    locationRoots: Record<string, string>;
    approvedLocations: readonly string[];
};

type IndexedSkillApproval = {
    fullId: string;
    displayId: string;
    name: string | null;
    status: ApprovalStatus | null;
};

const logger = getLogger();

export class UnapprovedSkillInstallError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UnapprovedSkillInstallError";
    }
}

export async function installAction(options: InstallActionOptions): Promise<void> {
    let result: InstallSkillResult;
    try {
        result = await installSkill(options);
    } catch (error) {
        if (error instanceof UnapprovedSkillInstallError) {
            logger.warn(`Warning: ${error.message}`);
            process.exitCode = 1;
            return;
        }
        throw error;
    }

    console.log(`Installed ${result.skillName} to ${formatDisplayTarget(result.targetDir)}`);
}

export async function installSkill(options: InstallSkillOptions): Promise<InstallSkillResult> {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const target = await resolveInstallTarget(options);
    const skillName = await readSkillName(target.rootDir);
    const targetDir = path.join(resolveInstallSkillsDir(cwd, options), skillName);
    const zip = await createVerifiedSkillZip(target, {
        skill: options.skill,
    });

    await extractSkillZip(zip.bytes, targetDir);

    return {
        skillName,
        rootDir: target.rootDir,
        targetDir,
        sha256: zip.sha256,
        size: zip.size,
        entries: zip.entries,
    };
}

function formatDisplayTarget(targetDir: string): string {
    const relativeTarget = path.relative(process.cwd(), targetDir);
    if (
        relativeTarget !== "" &&
        !relativeTarget.startsWith("..") &&
        !path.isAbsolute(relativeTarget)
    ) {
        return relativeTarget;
    }

    return targetDir;
}

function isAgentName(value: string): value is AgentName {
    return Object.hasOwn(AGENT_SKILLS_DIRS, value);
}

function resolveGlobalInstallAgentName(
    value: Exclude<InstallActionOptions["global"], undefined | false>,
): AgentName {
    if (value === true) {
        return "default";
    }

    if (typeof value === "string" && isAgentName(value)) {
        return value;
    }

    throw new Error(
        `Unknown global user agent ${JSON.stringify(value)}. Use one of: ${AGENT_NAMES.join(", ")}.`,
    );
}

function expandHomeDir(rawPath: string, homeDir: string): string {
    if (rawPath === "~") {
        return homeDir;
    }
    if (rawPath.startsWith("~/")) {
        return path.join(homeDir, rawPath.slice(2));
    }
    return rawPath;
}

function resolveInstallSkillsDir(
    cwd: string,
    options: Pick<InstallSkillOptions, "global" | "homeDir">,
): string {
    if (options.global === undefined || options.global === false) {
        return path.resolve(cwd, LOCAL_SKILLS_DIR);
    }

    const agentName = resolveGlobalInstallAgentName(options.global);
    return path.resolve(expandHomeDir(AGENT_SKILLS_DIRS[agentName], options.homeDir ?? homedir()));
}

async function resolveInstallTarget(options: InstallSkillOptions): Promise<ResolvedZipTarget> {
    const directPath = await resolveDirectSkillPath(options.skill);
    if (directPath) {
        if (!options.force) {
            throw new UnapprovedSkillInstallError(
                `Skill path ${directPath} is not indexed as an approved skill. Use --force to install anyway.`,
            );
        }
        return {
            rootDir: directPath,
            expectedSha256: null,
        };
    }

    const context = await resolveIndexedInstallContext(options);
    const approval = readIndexedSkillApproval(
        context.dbPath,
        options.skill,
        new Set(context.approvedLocations),
    );
    if (!approval) {
        throw new Error(`Skill path or indexed skill id not found: ${options.skill}`);
    }
    if (approval.status !== "approved" && !options.force) {
        throw new UnapprovedSkillInstallError(
            formatUnapprovedIndexedSkillMessage(options.skill, approval),
        );
    }

    return resolveIndexedZipTarget(approval.fullId, {
        dbPath: context.dbPath,
        locationRoots: context.locationRoots,
    });
}

async function resolveIndexedInstallContext(
    options: InstallSkillOptions,
): Promise<IndexedInstallContext> {
    if (options.dbPath !== undefined && options.locationRoots !== undefined) {
        return {
            dbPath: options.dbPath,
            locationRoots: options.locationRoots,
            approvedLocations: options.approvedLocations ?? [],
        };
    }

    const config = await loadConfig();
    return {
        dbPath: options.dbPath ?? resolveSkillsDbPath(config),
        locationRoots: options.locationRoots ?? expandSkillLocationRoots(config),
        approvedLocations: options.approvedLocations ?? approvedLocationNames(config),
    };
}

function parseInstallApprovalStatus(status: string | null): ApprovalStatus | null {
    return status !== null && isApprovalStatus(status) ? status : null;
}

function readIndexedSkillApproval(
    dbPath: string,
    skill: string,
    approvedLocations: ReadonlySet<string>,
): IndexedSkillApproval | null {
    const db = new Database(dbPath, { readonly: true });
    try {
        const resolved = resolveSkillReferenceInDb(db, skill);
        if (!resolved) {
            return null;
        }

        const row = db
            .query<{ approved: string | null }, { $id: string }>(
                `SELECT approved
                 FROM skills
                 WHERE id = $id`,
            )
            .get({ $id: resolved.id });
        const locations = db
            .query<{ location: string }, { $id: string }>(
                `SELECT location
                 FROM skill_occurrences
                 WHERE skill_id = $id`,
            )
            .all({ $id: resolved.id })
            .map((occurrence) => occurrence.location);

        return {
            fullId: resolved.id,
            displayId: resolved.short_id ?? resolved.id,
            name: resolved.name,
            status: effectiveApprovalStatus(
                parseInstallApprovalStatus(row?.approved ?? null),
                locations,
                approvedLocations,
            ),
        };
    } finally {
        db.close();
    }
}

function formatUnapprovedIndexedSkillMessage(
    skill: string,
    approval: IndexedSkillApproval,
): string {
    const identity =
        approval.name && approval.name !== skill
            ? `${approval.name} (${approval.displayId})`
            : approval.displayId;
    const statusMessage =
        approval.status === "ignore" ? "is marked ignore and is not approved" : "is not approved";
    return `Skill ${identity} ${statusMessage}. Use --force to install anyway.`;
}

async function readSkillName(rootDir: string): Promise<string> {
    const skillPath = path.join(rootDir, "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    const metadata = parseFrontmatter(content);
    const rawName = metadata.name;

    if (typeof rawName !== "string") {
        throw new Error(`Skill frontmatter is missing string "name": ${skillPath}`);
    }

    return assertSafeSkillName(rawName, skillPath);
}

function parseFrontmatter(content: string): Record<string, unknown> {
    try {
        const { data } = matter(content);
        return data as Record<string, unknown>;
    } catch {
        return parseFallbackFrontmatter(content);
    }
}

function parseFallbackFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const block = match[1] ?? "";
    const data: Record<string, unknown> = {};
    let currentKey: string | null = null;
    let currentValue = "";
    const commit = () => {
        if (currentKey !== null) {
            data[currentKey] = currentValue.trim().replace(/^["']|["']$/g, "");
        }
    };

    for (const line of block.split(/\r?\n/)) {
        const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
        if (kv) {
            commit();
            currentKey = kv[1] ?? null;
            currentValue = kv[2] ?? "";
        } else if (currentKey !== null) {
            currentValue += ` ${line.trim()}`;
        }
    }

    commit();
    return data;
}

function assertSafeSkillName(name: string, skillPath: string): string {
    const trimmed = name.trim();
    if (
        trimmed === "" ||
        trimmed === "." ||
        trimmed === ".." ||
        trimmed.includes("/") ||
        trimmed.includes("\\") ||
        trimmed.includes("\0")
    ) {
        throw new Error(`Invalid skill name in ${skillPath}: ${JSON.stringify(name)}`);
    }
    return trimmed;
}

async function extractSkillZip(bytes: Uint8Array, targetDir: string): Promise<void> {
    const parentDir = path.dirname(targetDir);
    await mkdir(parentDir, { recursive: true });
    await assertMissing(targetDir);

    const stagingDir = await mkdtemp(path.join(parentDir, ".install-"));
    try {
        const archive = unzipSync(bytes);
        const entryNames = Object.keys(archive).sort();
        for (const entryName of entryNames) {
            const entryBytes = archive[entryName];
            if (entryBytes === undefined) {
                throw new Error(`Missing ZIP entry bytes: ${entryName}`);
            }
            const outputPath = resolveArchiveOutputPath(stagingDir, entryName);
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, entryBytes);
        }

        await rename(stagingDir, targetDir);
    } catch (error) {
        await rm(stagingDir, { recursive: true, force: true });
        throw error;
    }
}

async function assertMissing(targetDir: string): Promise<void> {
    try {
        await lstat(targetDir);
    } catch (error) {
        const code = (error as ErrorWithCode).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
            return;
        }
        throw error;
    }

    throw new Error(`Skill already installed at ${targetDir}`);
}

function resolveArchiveOutputPath(rootDir: string, entryName: string): string {
    const normalized = entryName.replaceAll("\\", "/");
    if (normalized === "" || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
        throw new Error(`Invalid ZIP entry path: ${entryName}`);
    }

    const parts = normalized.split("/");
    if (parts.some((part) => part === "" || part === "." || part === "..")) {
        throw new Error(`Invalid ZIP entry path: ${entryName}`);
    }

    const outputPath = path.resolve(rootDir, ...parts);
    const resolvedRoot = path.resolve(rootDir);
    if (outputPath !== resolvedRoot && !outputPath.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`ZIP entry escapes install directory: ${entryName}`);
    }

    return outputPath;
}
