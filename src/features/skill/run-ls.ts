import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "@config";
import {
    AGENT_SKILLS_DIR_LIST,
    LOCAL_DISABLED_SKILLS_DIR,
    LOCAL_SKILLS_DIR,
} from "@features/agent/skills-dir";
import { approvedLocationNames } from "@features/approve/effective";
import {
    listSkillsByFullIds,
    type SkillListRow,
    type SkillListRowByFullId,
} from "@features/list/query";
import { renderSkillListTable } from "@features/list/table";
import { shortSkillId } from "@features/skill/id";
import { resolveSkillsDbPath } from "@features/update/paths";
import { createDeterministicSkillZip } from "@features/zip/deterministic-zip";

const SKILL_FILE = "SKILL.md";

export interface InstalledSkill {
    description?: string;
    disabled?: true;
    id: string;
    modifiedAt: Date;
    name: string;
    path: string;
    rootDir: string;
    version?: string;
}

export interface ListInstalledSkillsOptions {
    global?: boolean;
    homeDir?: string;
    includeDisabled?: boolean;
}

type RenderInstalledSkillsOptions = ListInstalledSkillsOptions & {
    width?: number;
};

type InstalledSkillSearchRoot = {
    disabled?: true;
    path: string;
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

async function listInstalledSkillsInDir(
    skillsDir: string,
    options: { disabled?: true } = {},
): Promise<InstalledSkill[]> {
    if (!(await pathExists(skillsDir))) {
        return [];
    }

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

        const metadata = readFrontmatter(await readFile(skillPath, "utf8"));
        const zip = await createDeterministicSkillZip({ rootDir: skillDir });
        const skill: InstalledSkill = {
            description: metadata.description,
            id: zip.sha256,
            modifiedAt: skillFileStat.mtime,
            name: metadata.name || entry.name,
            path: skillPath,
            rootDir: skillDir,
            version: metadata.version,
        };
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

export async function listInstalledSkills(
    cwd = process.cwd(),
    options: ListInstalledSkillsOptions = {},
): Promise<InstalledSkill[]> {
    const skills = (
        await Promise.all(
            resolveInstalledSkillSearchRootEntries(cwd, options).map((root) =>
                listInstalledSkillsInDir(root.path, {
                    disabled: root.disabled,
                }),
            ),
        )
    ).flat();

    return skills.sort(
        (left, right) =>
            left.name.localeCompare(right.name) || left.rootDir.localeCompare(right.rootDir),
    );
}

export type InstalledSkillListRow = SkillListRow & {
    disabled?: true;
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
        location: null,
        source_name: null,
        status: undefined,
        rating: null,
        tags: [],
        note: null,
    };
    if (skill.disabled) {
        row.disabled = true;
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
