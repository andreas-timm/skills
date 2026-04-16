import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { getLogger } from "@andreas-timm/logger";
import { shortSkillId } from "@features/skill/id";
import { getFileLastCommitDate, getGitInfo } from "@features/update/git";
import { type InferredSource, inferSourceRoot } from "@features/update/source";
import type { RawSkill, SourceRow, TransformedSkill } from "@features/update/types";
import { createDeterministicSkillZip } from "@features/zip/deterministic-zip";
import { expandHome } from "@libs/path";
import matter from "gray-matter";
import { filter, mergeMap, type Observable } from "rxjs";
import { verbose } from "../../verbose";

const logger = getLogger();

function hashId(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sourceDisplayName(sourceRoot: string, remote: string | undefined): string {
    if (remote) {
        const match = remote.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
        if (match) return `${match[1]}/${match[2]}`;
    }
    return basename(sourceRoot);
}

function normalizeGlobPath(value: string): string {
    return value.replaceAll("\\", "/");
}

function normalizeGlobPattern(value: string): string {
    return normalizeGlobPath(expandHome(value.trim()));
}

function ignoredBySourceConfig(
    filePath: string,
    sourceName: string,
    locationSourceConfig: RawSkill["locationSourceConfig"],
): boolean {
    const ignorePatterns = locationSourceConfig?.[sourceName]?.ignore;
    if (!ignorePatterns?.length) return false;

    const normalizedFilePath = normalizeGlobPath(resolve(filePath));
    return ignorePatterns.some((pattern) => {
        const normalizedPattern = normalizeGlobPattern(pattern);
        return (
            normalizedPattern !== "" && new Bun.Glob(normalizedPattern).match(normalizedFilePath)
        );
    });
}

type ParsedFrontmatter = {
    metadata: Record<string, unknown>;
    fallback: boolean;
};

function parseFallback(content: string): Record<string, unknown> {
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

function parseFrontmatter(content: string, filePath: string): ParsedFrontmatter {
    try {
        const { data } = matter(content);
        return { metadata: data as Record<string, unknown>, fallback: false };
    } catch (error) {
        const metadata = parseFallback(content);
        if (Object.keys(metadata).length === 0) {
            logger.warn(`Failed to parse frontmatter in ${filePath}: ${(error as Error).message}`);
        }
        return { metadata, fallback: true };
    }
}

async function resolveSource(
    locationName: string,
    inferredSource: InferredSource,
    sourceCache: Map<string, Promise<SourceRow>>,
): Promise<SourceRow> {
    const { sourceRoot, sourceRootSubpath, git, useLocationName } = inferredSource;
    const cacheKey = `${locationName}\0${sourceRoot}`;
    let pending = sourceCache.get(cacheKey);
    if (!pending) {
        pending = (async () => {
            const id = hashId(cacheKey);
            if (git) {
                const gitInfo = await getGitInfo(sourceRoot);
                return {
                    id,
                    name: sourceDisplayName(sourceRoot, gitInfo.remote),
                    rootSubpath: sourceRootSubpath,
                    git: true,
                    approved: null,
                    rating: null,
                    tags: [],
                    note: null,
                    ...gitInfo,
                } satisfies SourceRow;
            }
            return {
                id,
                name: useLocationName ? locationName : basename(sourceRoot),
                rootSubpath: sourceRootSubpath,
                git: false,
                approved: null,
                rating: null,
                tags: [],
                note: null,
            } satisfies SourceRow;
        })();
        sourceCache.set(cacheKey, pending);
    }
    return pending;
}

export function transform(rawSkills: Observable<RawSkill>): Observable<TransformedSkill> {
    const sourceCache = new Map<string, Promise<SourceRow>>();
    return rawSkills.pipe(
        mergeMap(
            async ({
                locationName,
                locationRoot,
                filePath,
                locationTags,
                locationSourceConfig,
            }): Promise<TransformedSkill | null> => {
                const skillDir = dirname(filePath);
                const inferredSource = inferSourceRoot(skillDir, locationRoot);
                const sourceRow = await resolveSource(locationName, inferredSource, sourceCache);
                if (ignoredBySourceConfig(filePath, sourceRow.name, locationSourceConfig)) {
                    if (verbose) {
                        logger.info(
                            `Skipping ${filePath}: ignored by source config for ${sourceRow.name}`,
                        );
                    }
                    return null;
                }

                const content = await readFile(filePath, "utf-8");
                const { metadata, fallback } = parseFrontmatter(content, filePath);
                const subpath = inferredSource.occurrenceSubpath;
                const zip = await createDeterministicSkillZip({
                    rootDir: skillDir,
                });
                const id = zip.sha256;

                const name = typeof metadata.name === "string" ? metadata.name : null;
                if (!name) {
                    if (verbose) {
                        logger.warn(`Skipping ${filePath}: missing 'name' frontmatter`);
                    }
                    return null;
                }

                let sourceDate: string | null = null;
                if (sourceRow.git) {
                    const relativeSkillFile = relative(
                        inferredSource.sourceRoot,
                        filePath,
                    ).replaceAll("\\", "/");
                    const date = await getFileLastCommitDate(
                        inferredSource.sourceRoot,
                        relativeSkillFile,
                    );
                    sourceDate = date;
                }
                if (sourceDate === null) {
                    sourceDate = new Date((await stat(filePath)).mtimeMs).toISOString();
                }

                const description =
                    typeof metadata.description === "string" ? metadata.description : null;
                const version = typeof metadata.version === "string" ? metadata.version : null;

                const normalizedTags = locationTags?.length
                    ? [...new Set(locationTags)]
                    : undefined;

                return {
                    source: sourceRow,
                    skill: {
                        id,
                        shortId: shortSkillId(id),
                        version,
                        date: sourceDate,
                        versionOrder: 0,
                        name,
                        description,
                        metadata,
                        fallback,
                        approved: null,
                        rating: null,
                        tags: normalizedTags ?? [],
                        note: null,
                    },
                    occurrence: {
                        skillId: id,
                        sourceId: sourceRow.id,
                        location: locationName,
                        subpath,
                    },
                    ...(normalizedTags !== undefined ? { locationTags: normalizedTags } : {}),
                } satisfies TransformedSkill;
            },
            16,
        ),
        filter((item): item is TransformedSkill => item !== null),
    );
}
