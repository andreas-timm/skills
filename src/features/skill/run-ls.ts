import type { Dirent } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { loadConfig } from "@config";
import {
    AGENT_SKILLS_DIR_LIST,
    LOCAL_DISABLED_SKILLS_DIR,
    LOCAL_SKILLS_DIR,
} from "@features/agent/skills-dir";
import { approvedLocationNames } from "@features/approve/effective";
import { shortSkillId } from "@features/skill/id";
import { resolveSkillsDbPath } from "@features/update/paths";
import { createDeterministicSkillZip } from "@features/zip/deterministic-zip";
import { listSkillsByFullIds, type SkillListRow, type SkillListRowByFullId } from "../skills/query";
import { renderSkillListTable } from "../skills/table";

const SKILL_FILE = "SKILL.md";

export interface InstalledSkill {
    description?: string;
    disabled?: true;
    id: string;
    modifiedAt: Date;
    name: string;
    nodeModulePackageName?: string;
    path: string;
    rootDir: string;
    sourceRootDir?: string;
    version?: string;
}

export interface ListInstalledSkillsOptions {
    global?: boolean;
    homeDir?: string;
    includeDisabled?: boolean;
    nodeModules?: boolean;
}

type RenderInstalledSkillsOptions = ListInstalledSkillsOptions & {
    width?: number;
};

type InstalledSkillSearchRoot = {
    disabled?: true;
    path: string;
};

type ListInstalledSkillsInDirOptions = {
    disabled?: true;
    resolveSource?: boolean;
};

function readFrontmatter(markdown: string): Record<string, string> {
    if (!markdown.startsWith("---\n")) {
        return {};
    }

    const endMarkerIndex = markdown.indexOf("\n---", 4);
    if (endMarkerIndex === -1) {
        return {};
    }

    const frontmatter = markdown.slice(4, endMarkerIndex);
    const metadata: Record<string, string> = {};

    for (const line of frontmatter.split("\n")) {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        if (!key) {
            continue;
        }

        metadata[key] = value.replace(/^["']|["']$/g, "");
    }

    return metadata;
}

function expandHomeDir(path: string, homeDir: string): string {
    if (path === "~") {
        return homeDir;
    }
    if (path.startsWith("~/")) {
        return join(homeDir, path.slice(2));
    }
    return path;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

export function resolveInstalledSkillSearchRoots(
    cwd = process.cwd(),
    options: ListInstalledSkillsOptions = {},
): string[] {
    if (options.nodeModules) {
        return [resolve(cwd, "node_modules")];
    }

    return resolveInstalledSkillSearchRootEntries(cwd, options).map((root) => root.path);
}

function resolveInstalledSkillSearchRootEntries(
    cwd = process.cwd(),
    options: ListInstalledSkillsOptions = {},
): InstalledSkillSearchRoot[] {
    const roots: InstalledSkillSearchRoot[] = options.global
        ? AGENT_SKILLS_DIR_LIST.map((dir) => ({
              path: resolve(expandHomeDir(dir, options.homeDir ?? homedir())),
          }))
        : [
              { path: resolve(cwd, LOCAL_SKILLS_DIR) },
              ...(options.includeDisabled
                  ? [
                        {
                            disabled: true,
                            path: resolve(cwd, LOCAL_DISABLED_SKILLS_DIR),
                        } as const,
                    ]
                  : []),
          ];

    return [...new Map(roots.map((root) => [root.path, root])).values()];
}

function splitPathSegments(path: string): string[] {
    return path.split(/[\\/]+/).filter(Boolean);
}

function resolveNodeModulePackageName(skillPath: string): string | undefined {
    const segments = splitPathSegments(resolve(skillPath));

    for (let index = segments.length - 1; index >= 0; index--) {
        if (segments[index] !== "node_modules") {
            continue;
        }

        const packageName = segments[index + 1];
        if (!packageName) {
            continue;
        }

        if (packageName.startsWith("@")) {
            const scopedName = segments[index + 2];
            return scopedName ? `${packageName}/${scopedName}` : packageName;
        }

        return packageName;
    }

    return undefined;
}

async function maybeRealpath(path: string): Promise<string | undefined> {
    try {
        return await realpath(path);
    } catch {
        return undefined;
    }
}

async function findNodeModulesDirs(cwd: string): Promise<string[]> {
    const root = resolve(cwd);
    const nodeModulesDirs: string[] = [];
    const visitedDirs = new Set<string>();

    async function walk(dir: string): Promise<void> {
        const canonicalDir = await maybeRealpath(dir);
        if (!canonicalDir || visitedDirs.has(canonicalDir)) {
            return;
        }
        visitedDirs.add(canonicalDir);

        if (basename(dir) === "node_modules") {
            nodeModulesDirs.push(dir);
            return;
        }

        let entries: Dirent[];
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            if ([".git", ".hg", ".svn"].includes(entry.name)) {
                continue;
            }
            if (!entry.isDirectory() && !entry.isSymbolicLink()) {
                continue;
            }

            const childPath = join(dir, entry.name);
            const childStat = await stat(childPath).catch(() => undefined);
            if (childStat?.isDirectory()) {
                await walk(childPath);
            }
        }
    }

    await walk(root);

    return [...new Set(nodeModulesDirs)].sort((left, right) => left.localeCompare(right));
}

async function listSkillFilesUnderNodeModulesDir(nodeModulesDir: string): Promise<string[]> {
    const skillPaths: string[] = [];
    const visitedDirs = new Set<string>();

    async function walk(dir: string): Promise<void> {
        const canonicalDir = await maybeRealpath(dir);
        if (!canonicalDir || visitedDirs.has(canonicalDir)) {
            return;
        }
        visitedDirs.add(canonicalDir);

        let entries: Dirent[];
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            if (entry.name === ".bin") {
                continue;
            }

            const entryPath = join(dir, entry.name);
            if (entry.isFile()) {
                if (entry.name === SKILL_FILE) {
                    skillPaths.push(entryPath);
                }
                continue;
            }

            if (!entry.isDirectory() && !entry.isSymbolicLink()) {
                continue;
            }

            const entryStat = await stat(entryPath).catch(() => undefined);
            if (entryStat?.isDirectory()) {
                await walk(entryPath);
            } else if (entryStat?.isFile() && entry.name === SKILL_FILE) {
                skillPaths.push(entryPath);
            }
        }
    }

    await walk(nodeModulesDir);

    return skillPaths;
}

async function listNodeModulesSkills(cwd: string): Promise<InstalledSkill[]> {
    const nodeModulesDirs = await findNodeModulesDirs(cwd);
    const skillPaths = (
        await Promise.all(nodeModulesDirs.map((dir) => listSkillFilesUnderNodeModulesDir(dir)))
    )
        .flat()
        .sort((left, right) => left.localeCompare(right));
    const skills: InstalledSkill[] = [];

    for (const skillPath of skillPaths) {
        const skillFileStat = await stat(skillPath);
        if (!skillFileStat.isFile()) {
            continue;
        }

        const rootDir = dirname(skillPath);
        const metadata = readFrontmatter(await readFile(skillPath, "utf8"));
        const zip = await createDeterministicSkillZip({ rootDir });
        const skill: InstalledSkill = {
            description: metadata.description,
            id: zip.sha256,
            modifiedAt: skillFileStat.mtime,
            name: metadata.name || basename(rootDir),
            nodeModulePackageName: resolveNodeModulePackageName(skillPath),
            path: skillPath,
            rootDir,
            version: metadata.version,
        };
        skills.push(skill);
    }

    return skills.sort(
        (left, right) =>
            left.name.localeCompare(right.name) || left.rootDir.localeCompare(right.rootDir),
    );
}

async function listInstalledSkillsInDir(
    skillsDir: string,
    options: ListInstalledSkillsInDirOptions = {},
): Promise<InstalledSkill[]> {
    if (!(await pathExists(skillsDir))) {
        return [];
    }

    const resolvedSkillsDir = options.resolveSource
        ? ((await maybeRealpath(skillsDir)) ?? skillsDir)
        : skillsDir;
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills: InstalledSkill[] = [];

    for (const entry of entries) {
        if (entry.name.startsWith(".")) {
            continue;
        }

        const skillDir = join(skillsDir, entry.name);
        const skillDirStat = await stat(skillDir);
        if (!skillDirStat.isDirectory()) {
            continue;
        }

        const skillPath = join(skillDir, SKILL_FILE);
        if (!(await pathExists(skillPath))) {
            continue;
        }
        const skillFileStat = await stat(skillPath);
        if (!skillFileStat.isFile()) {
            continue;
        }

        const expectedResolvedSkillPath = join(resolvedSkillsDir, entry.name, SKILL_FILE);
        const resolvedSkillPath = options.resolveSource
            ? ((await maybeRealpath(skillPath)) ?? skillPath)
            : skillPath;
        const resolvedSkillDir = options.resolveSource ? dirname(resolvedSkillPath) : skillDir;
        const metadata = readFrontmatter(await readFile(resolvedSkillPath, "utf8"));
        const zip = await createDeterministicSkillZip({ rootDir: resolvedSkillDir });
        const skill: InstalledSkill = {
            description: metadata.description,
            id: zip.sha256,
            modifiedAt: skillFileStat.mtime,
            name: metadata.name || entry.name,
            path: resolvedSkillPath,
            rootDir: resolvedSkillDir,
            version: metadata.version,
        };
        if (options.resolveSource && resolvedSkillPath !== resolve(expectedResolvedSkillPath)) {
            skill.sourceRootDir = resolvedSkillDir;
        }
        if (options.disabled) {
            skill.disabled = true;
        }
        skills.push(skill);
    }

    return skills.sort(
        (left, right) =>
            left.name.localeCompare(right.name) || left.rootDir.localeCompare(right.rootDir),
    );
}

function dedupeInstalledSkillsBySource(skills: readonly InstalledSkill[]): InstalledSkill[] {
    const skillsBySource = new Map<string, InstalledSkill>();

    for (const skill of skills) {
        if (!skillsBySource.has(skill.path)) {
            skillsBySource.set(skill.path, skill);
        }
    }

    return [...skillsBySource.values()];
}

export async function listInstalledSkills(
    cwd = process.cwd(),
    options: ListInstalledSkillsOptions = {},
): Promise<InstalledSkill[]> {
    if (options.nodeModules) {
        return listNodeModulesSkills(cwd);
    }

    const skills = (
        await Promise.all(
            resolveInstalledSkillSearchRootEntries(cwd, options).map((root) =>
                listInstalledSkillsInDir(root.path, {
                    disabled: root.disabled,
                    resolveSource: options.global,
                }),
            ),
        )
    ).flat();

    const uniqueSkills = options.global ? dedupeInstalledSkillsBySource(skills) : skills;

    return uniqueSkills.sort(
        (left, right) =>
            left.name.localeCompare(right.name) || left.rootDir.localeCompare(right.rootDir),
    );
}

export type InstalledSkillListRow = SkillListRow & {
    disabled?: true;
    sourceRootDir?: string;
};

function fallbackSkillListRow(skill: InstalledSkill): InstalledSkillListRow {
    const row: InstalledSkillListRow = {
        id: shortSkillId(skill.id),
        date: skill.modifiedAt.toISOString(),
        version_order: 1,
        version_count: 1,
        duplicate: 0,
        name: skill.name,
        version: skill.version ?? null,
        description: skill.description ?? null,
        location: skill.nodeModulePackageName ? "node_modules" : null,
        source_name: skill.nodeModulePackageName ?? null,
        status: undefined,
        rating: null,
        tags: [],
        note: null,
    };
    if (skill.disabled) {
        row.disabled = true;
    }
    if (skill.sourceRootDir) {
        row.sourceRootDir = skill.sourceRootDir;
    }
    return row;
}

export function resolveInstalledSkillRows(
    skills: readonly InstalledSkill[],
    indexedSkills: readonly SkillListRowByFullId[],
): InstalledSkillListRow[] {
    const indexedByFullId = new Map(indexedSkills.map((skill) => [skill.full_id, skill]));

    return skills.map((skill) => {
        const indexedSkill = indexedByFullId.get(skill.id);
        const row: InstalledSkillListRow = indexedSkill
            ? { ...indexedSkill }
            : fallbackSkillListRow(skill);
        if (skill.disabled) {
            row.disabled = true;
        }
        if (skill.nodeModulePackageName) {
            row.location = "node_modules";
            row.source_name = skill.nodeModulePackageName;
        }
        if (skill.sourceRootDir) {
            row.sourceRootDir = skill.sourceRootDir;
        }
        return row;
    });
}

export async function listIndexedInstalledSkills(
    skills: readonly InstalledSkill[],
    dbPath: string,
    options: { approvedLocations?: readonly string[] } = {},
): Promise<SkillListRowByFullId[]> {
    if (skills.length === 0 || !(await pathExists(dbPath))) {
        return [];
    }

    return listSkillsByFullIds(
        dbPath,
        skills.map((skill) => skill.id),
        options,
    );
}

export function renderInstalledSkills(
    skills: readonly InstalledSkillListRow[],
    cwd = process.cwd(),
    options: RenderInstalledSkillsOptions = {},
): string {
    const skillsDirs = resolveInstalledSkillSearchRoots(cwd, options);
    if (skills.length === 0) {
        if (options.nodeModules) {
            return `No node_modules skills found under ${resolve(cwd)}\n`;
        }
        if (skillsDirs.length === 1) {
            return `No installed skills found in ${skillsDirs[0]}\n`;
        }
        return `No installed skills found in:\n${skillsDirs.map((skillsDir) => `- ${skillsDir}`).join("\n")}\n`;
    }

    return renderSkillListTable(skills, options);
}

export async function runLs(
    cwd = process.cwd(),
    options: ListInstalledSkillsOptions = {},
): Promise<void> {
    const listOptions: ListInstalledSkillsOptions = {
        ...options,
        includeDisabled: options.includeDisabled ?? !options.global,
    };
    const installedSkills = await listInstalledSkills(cwd, listOptions);
    if (installedSkills.length === 0) {
        process.stdout.write(renderInstalledSkills([], cwd, listOptions));
        return;
    }

    const config = await loadConfig();
    const indexedSkills = await listIndexedInstalledSkills(
        installedSkills,
        resolveSkillsDbPath(config),
        {
            approvedLocations: approvedLocationNames(config),
        },
    );
    process.stdout.write(
        renderInstalledSkills(
            resolveInstalledSkillRows(installedSkills, indexedSkills),
            cwd,
            listOptions,
        ),
    );
}
