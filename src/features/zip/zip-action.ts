import { Database } from "bun:sqlite";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "@config";
import { getPrimaryOccurrencePathInfo } from "@features/show/query";
import { expandSkillLocationRoots, resolveSkillsDbPath } from "@features/update/paths";
import { resolveOccurrenceDir } from "@features/update/source";
import {
    createDeterministicSkillZip,
    type SkillZipResult,
    type SkillZipStyle,
    sha256Hex,
} from "./deterministic-zip.ts";

export type ZipActionOptions = {
    skill: string;
    style?: SkillZipStyle;
    /** `-o` / `--output` with no path (cac passes `true`), or `"-"` → zip to stdout; string path → file; omit → sha256 only */
    output?: string | boolean;
    json?: boolean;
};

type ErrorWithCode = {
    code?: string;
};

export type ResolvedZipTarget = {
    rootDir: string;
    expectedSha256: string | null;
};

export type IndexedZipTargetOptions = {
    dbPath: string;
    locationRoots: Record<string, string>;
};

export async function zipAction(options: ZipActionOptions): Promise<void> {
    const target = await resolveZipTarget(options.skill);
    const result = await createVerifiedSkillZip(target, {
        skill: options.skill,
        style: options.style,
    });

    const out = options.output;

    if (options.json) {
        if (typeof out === "string" && out !== "-") {
            await writeZipFile(out, result.bytes, result.sha256);
        }
        console.log(
            JSON.stringify(
                {
                    path: target.rootDir,
                    style: result.style,
                    sha256: result.sha256,
                    size: result.size,
                    entries: result.entries,
                    output: outputTargetForJson(out),
                },
                null,
                2,
            ),
        );
        return;
    }

    if (out === undefined) {
        console.log(result.sha256);
        return;
    }

    if (out === true || out === "-") {
        await writeStdoutBinary(result.bytes);
        return;
    }

    if (typeof out === "string") {
        await writeZipFile(out, result.bytes, result.sha256);
    }
}

export async function resolveZipTarget(skill: string): Promise<ResolvedZipTarget> {
    const directPath = await resolveDirectSkillPath(skill);
    if (directPath) {
        return {
            rootDir: directPath,
            expectedSha256: null,
        };
    }

    const config = await loadConfig();
    return resolveIndexedZipTarget(skill, {
        dbPath: resolveSkillsDbPath(config),
        locationRoots: expandSkillLocationRoots(config),
    });
}

export async function createVerifiedSkillZip(
    target: ResolvedZipTarget,
    options: { skill?: string; style?: SkillZipStyle } = {},
): Promise<SkillZipResult> {
    const result = await createDeterministicSkillZip({
        rootDir: target.rootDir,
        style: options.style,
    });
    verifyCreatedZipSkillId({
        actualSha256: result.sha256,
        expectedSha256: target.expectedSha256,
        rootDir: target.rootDir,
        skill: options.skill,
    });
    return result;
}

export function verifyCreatedZipSkillId({
    actualSha256,
    expectedSha256,
    rootDir,
    skill,
}: {
    actualSha256: string;
    expectedSha256: string | null;
    rootDir: string;
    skill?: string;
}): void {
    if (expectedSha256 === null || actualSha256 === expectedSha256) {
        return;
    }

    const label = skill ? ` for ${skill}` : "";
    throw new Error(
        `Created zip SHA-256 does not match indexed skill id${label}: expected ${expectedSha256}, got ${actualSha256}. The skill folder may have changed since the last index update: ${rootDir}`,
    );
}

export function resolveIndexedZipTarget(
    skillId: string,
    options: IndexedZipTargetOptions,
): ResolvedZipTarget {
    const fullSkillId = resolveIndexedSkillId(options.dbPath, skillId);
    if (!fullSkillId) {
        throw new Error(`Skill path or indexed skill id not found: ${skillId}`);
    }

    const firstOccurrence = getPrimaryOccurrencePathInfo(options.dbPath, fullSkillId);
    if (!firstOccurrence) {
        throw new Error(`Skill has no occurrences: ${skillId}`);
    }

    const locationRoot = options.locationRoots[firstOccurrence.location];
    if (!locationRoot) {
        throw new Error(
            `Unknown location "${firstOccurrence.location}" in config: add it under [skills.locations].`,
        );
    }

    return {
        rootDir: resolveOccurrenceDir({
            locationRoot,
            sourceGit: firstOccurrence.sourceGit,
            sourceRootSubpath: firstOccurrence.sourceRootSubpath,
            subpath: firstOccurrence.subpath,
        }),
        expectedSha256: fullSkillId,
    };
}

export function resolveIndexedSkillId(dbPath: string, skillId: string): string | null {
    const db = new Database(dbPath, { readonly: true });
    try {
        const exact = db
            .query<{ id: string }, { $id: string }>(
                `SELECT s.id
                 FROM skills s
                 WHERE s.id = $id
                 LIMIT 1`,
            )
            .get({ $id: skillId });
        if (exact) {
            return exact.id;
        }

        const shortMatches = db
            .query<{ id: string }, { $id: string }>(
                `SELECT s.id
                 FROM skills s
                 WHERE s.short_id = $id
                 ORDER BY s.id
                 LIMIT 2`,
            )
            .all({ $id: skillId });

        if (shortMatches.length > 1) {
            throw new Error(
                `Ambiguous skill short id "${skillId}" matches multiple skills; use the full SHA-256 id.`,
            );
        }

        return shortMatches[0]?.id ?? null;
    } finally {
        db.close();
    }
}

export async function resolveDirectSkillPath(skill: string): Promise<string | null> {
    const candidate = path.resolve(skill);
    try {
        const stats = await stat(candidate);
        if (stats.isDirectory()) {
            return candidate;
        }
        if (stats.isFile() && path.basename(candidate) === "SKILL.md") {
            return path.dirname(candidate);
        }
        throw new Error(`Skill path must be a directory or SKILL.md: ${candidate}`);
    } catch (error) {
        const code = (error as ErrorWithCode).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
            return null;
        }
        throw error;
    }
}

function outputTargetForJson(out: string | boolean | undefined): string | null {
    if (out === undefined) return null;
    if (out === true || out === "-") return "-";
    if (typeof out === "string") return path.resolve(out);
    return null;
}

async function writeZipFile(
    outputPath: string,
    bytes: Uint8Array,
    expectedSha256: string,
): Promise<void> {
    const resolvedOutputPath = path.resolve(outputPath);
    await writeFile(resolvedOutputPath, bytes);
    const writtenSha256 = sha256Hex(await readFile(resolvedOutputPath));
    if (writtenSha256 !== expectedSha256) {
        throw new Error(
            `Written zip SHA-256 mismatch for ${resolvedOutputPath}: expected ${expectedSha256}, got ${writtenSha256}.`,
        );
    }
}

async function writeStdoutBinary(bytes: Uint8Array): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        process.stdout.write(Buffer.from(bytes), (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
