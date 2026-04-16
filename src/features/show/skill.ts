import { access, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { getLogger } from "@andreas-timm/logger";
import { loadConfig } from "@config";
import { approvedLocationNames } from "@features/approve/effective";
import {
    getPrimaryOccurrencePathInfo,
    getSkill,
    type ShowSkillNameGroup,
    type ShowSkillRelatedVersion,
    type ShowSkillVersion,
    type SkillOccurrence,
} from "@features/show/query";
import { shortSkillId } from "@features/skill/id";
import { type InstalledSkill, listInstalledSkills } from "@features/skill/run-ls.ts";
import {
    type PublicSkillVersionFields,
    publicSkillVersion,
    type SkillVersionFields,
    toPublicSkillVersion,
} from "@features/skill/version";
import { expandSkillLocationRoots, resolveSkillsDbPath } from "@features/update/paths";
import { resolveOccurrenceDir } from "@features/update/source";
import { formatDateUtc } from "@libs/date";
import { Scalar, stringify as stringifyYaml } from "yaml";

const logger = getLogger();

type ShowSkillActionOptions = {
    cwd?: string;
    json?: boolean;
};

export type ShowSkillOutput = ShowSkillVersion & {
    path: string;
    content: string;
};

function withPublicRelatedVersions<T extends ShowSkillVersion>(
    skill: T,
): PublicSkillVersionFields<Omit<T, "related_versions">> & {
    related_versions: Array<PublicSkillVersionFields<ShowSkillRelatedVersion>>;
} {
    return {
        ...toPublicSkillVersion(skill),
        related_versions: skill.related_versions.map(toPublicSkillVersion),
    };
}

function withPublicNameGroupVersions(group: ShowSkillNameGroup): {
    name: string;
    versions: Array<
        PublicSkillVersionFields<Omit<ShowSkillVersion, "related_versions">> & {
            related_versions: Array<PublicSkillVersionFields<ShowSkillRelatedVersion>>;
        }
    >;
} {
    return {
        ...group,
        versions: group.versions.map(withPublicRelatedVersions),
    };
}

function writeJsonOutput(skill: ShowSkillOutput | ShowSkillNameGroup): void {
    const output = isNameGroup(skill)
        ? withPublicNameGroupVersions(skill)
        : withPublicRelatedVersions(skill);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

export function formatSkillVersionLabel(skill: SkillVersionFields): string {
    return publicSkillVersion(skill);
}

function formatFieldValue(value: string | null | undefined): string {
    return value && value.trim() !== "" ? value : "-";
}

function stringifyCliYaml(value: unknown): string {
    return stringifyYaml(value, {
        lineWidth: 0,
    });
}

function skillContentScalar(content: string): Scalar<string> {
    const scalar = new Scalar(content.replace(/\r\n/g, "\n").replace(/\n$/, ""));
    scalar.type = Scalar.BLOCK_LITERAL;
    return scalar;
}

function formatDuplicateOccurrence(occurrence: SkillOccurrence): {
    location: string;
    source: string;
    subpath: string;
    date: string;
} {
    return {
        location: formatFieldValue(occurrence.location),
        source: formatFieldValue(occurrence.source_name),
        subpath: formatFieldValue(occurrence.subpath),
        date: formatDateUtc(occurrence.source_date),
    };
}

export function formatShowSkillTextOutput(skill: ShowSkillOutput): string {
    const duplicateOccurrences = skill.occurrences.slice(1);
    return stringifyCliYaml({
        id: skill.id,
        version: formatSkillVersionLabel(skill),
        name: formatFieldValue(skill.name),
        description: formatFieldValue(skill.description),
        location: formatFieldValue(skill.location),
        source: formatFieldValue(skill.source),
        subpath: formatFieldValue(skill.subpath),
        path: skill.path,
        date: formatDateUtc(skill.date),
        ...(skill.status ? { status: skill.status } : {}),
        ...(skill.fallback ? { fallback_parser: "yes" } : {}),
        ...(duplicateOccurrences.length >= 1
            ? {
                  duplicates: duplicateOccurrences.map((occurrence) =>
                      formatDuplicateOccurrence(occurrence),
                  ),
              }
            : {}),
        skill_content: skillContentScalar(skill.content),
    });
}

function writeTextOutput(skill: ShowSkillOutput): void {
    process.stdout.write(formatShowSkillTextOutput(skill));
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function parseInstalledVersionedReference(
    reference: string,
): { name: string; version: string } | null {
    const suffixIndex = reference.lastIndexOf("@");
    if (suffixIndex <= 0 || suffixIndex === reference.length - 1) {
        return null;
    }

    const name = reference.slice(0, suffixIndex);
    const version = reference.slice(suffixIndex + 1);
    if (name.trim() === "" || version.trim() === "") {
        return null;
    }

    return { name, version };
}

function installedSkillVersionMatches(skill: InstalledSkill, referenceVersion: string): boolean {
    const version = skill.version?.trim();
    if (version) {
        return version === referenceVersion;
    }

    return referenceVersion === "v1" || referenceVersion === "1";
}

export function resolveInstalledSkillReference(
    skills: readonly InstalledSkill[],
    reference: string,
): InstalledSkill | null {
    const byId = skills.find(
        (skill) => skill.id === reference || shortSkillId(skill.id) === reference,
    );
    if (byId) {
        return byId;
    }

    const versionedReference = parseInstalledVersionedReference(reference);
    if (versionedReference) {
        return (
            skills.find(
                (skill) =>
                    skill.name === versionedReference.name &&
                    installedSkillVersionMatches(skill, versionedReference.version),
            ) ?? null
        );
    }

    return (
        skills.find((skill) => skill.name === reference) ??
        skills.find((skill) => basename(skill.rootDir) === reference) ??
        null
    );
}

function installedSkillSubpath(skill: InstalledSkill, cwd: string): string {
    return relative(resolve(cwd), skill.rootDir).replaceAll("\\", "/");
}

function toInstalledShowSkillOutput(
    skill: InstalledSkill,
    content: string,
    cwd: string,
    modifiedAt: Date,
): ShowSkillOutput {
    const subpath = installedSkillSubpath(skill, cwd);
    const location = resolve(cwd);
    const date = modifiedAt.toISOString();
    return {
        id: shortSkillId(skill.id),
        full_id: skill.id,
        version: skill.version ?? null,
        version_order: 1,
        date,
        name: skill.name,
        description: skill.description ?? null,
        metadata: {},
        fallback: false,
        status: null,
        rating: null,
        tags: [],
        note: null,
        source: "installed",
        location,
        subpath,
        occurrences: [
            {
                source_id: "installed",
                source_name: "installed",
                source_git: false,
                source_remote: null,
                source_branch: null,
                source_commit: null,
                source_date: date,
                location,
                subpath,
            },
        ],
        related_versions: [],
        path: skill.path,
        content,
    };
}

export async function getInstalledSkillOutput(
    reference: string,
    cwd = process.cwd(),
): Promise<ShowSkillOutput | null> {
    const installedSkill = resolveInstalledSkillReference(
        await listInstalledSkills(cwd, { includeDisabled: true }),
        reference,
    );
    if (!installedSkill) {
        return null;
    }

    return toInstalledShowSkillOutput(
        installedSkill,
        await readFile(installedSkill.path, "utf-8"),
        cwd,
        (await stat(installedSkill.path)).mtime,
    );
}

export function formatNameGroupTextOutput(group: ShowSkillNameGroup): string {
    return stringifyCliYaml({
        name: group.name,
        versions: group.versions.map((version) => ({
            id: version.id,
            version: formatSkillVersionLabel(version),
            location: formatFieldValue(version.location),
            source: formatFieldValue(version.source),
            date: formatDateUtc(version.date),
        })),
    });
}

function writeNameGroupTextOutput(group: ShowSkillNameGroup): void {
    process.stdout.write(formatNameGroupTextOutput(group));
}

function isNameGroup(value: ShowSkillNameGroup | ShowSkillVersion): value is ShowSkillNameGroup {
    return "versions" in value;
}

export async function skillAction(skill: string, opts: ShowSkillActionOptions): Promise<void> {
    const config = await loadConfig();
    const dbPath = resolveSkillsDbPath(config);
    const resolvedSkill = (await pathExists(dbPath))
        ? getSkill(dbPath, skill, {
              approvedLocations: approvedLocationNames(config),
          })
        : null;

    if (!resolvedSkill) {
        const installedSkill = await getInstalledSkillOutput(skill, opts.cwd);
        if (installedSkill) {
            if (opts.json) {
                writeJsonOutput(installedSkill);
                return;
            }
            writeTextOutput(installedSkill);
            return;
        }

        logger.warn(`Skill not found: ${skill}`);
        process.exitCode = 1;
        return;
    }

    if (isNameGroup(resolvedSkill)) {
        if (opts.json) {
            writeJsonOutput(resolvedSkill);
            return;
        }
        writeNameGroupTextOutput(resolvedSkill);
        return;
    }

    const firstOccurrence = getPrimaryOccurrencePathInfo(dbPath, resolvedSkill.full_id);
    if (!firstOccurrence) {
        logger.warn(`Skill has no occurrences: ${skill}`);
        process.exitCode = 1;
        return;
    }

    const roots = expandSkillLocationRoots(config);
    const locationRoot = roots[firstOccurrence.location];
    if (!locationRoot) {
        logger.warn(
            `Unknown location "${firstOccurrence.location}" in config — add it under [skills.locations].`,
        );
        process.exitCode = 1;
        return;
    }

    const skillPath = join(
        resolveOccurrenceDir({
            locationRoot,
            sourceGit: firstOccurrence.sourceGit,
            sourceRootSubpath: firstOccurrence.sourceRootSubpath,
            subpath: firstOccurrence.subpath,
        }),
        "SKILL.md",
    );

    let content: string;
    try {
        content = await readFile(skillPath, "utf-8");
    } catch (error) {
        logger.warn(
            `Cannot read ${skillPath}: ${(error as Error).message}. Run \`skills update\` if the index is stale.`,
        );
        process.exitCode = 1;
        return;
    }

    const output: ShowSkillOutput = {
        ...resolvedSkill,
        path: skillPath,
        content,
    };

    if (opts.json) {
        writeJsonOutput(output);
        return;
    }

    writeTextOutput(output);
}
