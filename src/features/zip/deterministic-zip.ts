import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { type DeflateOptions, deflateSync as fflateDeflateSync } from "fflate";
import pako from "pako";

const textEncoder = new TextEncoder();
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

/**
 * Two zip layouts that reproduce the reference archives byte-for-byte.
 *
 * - `dos`:  DEFLATE via `fflate` level 6, DOS-style headers (no extras,
 *           create_system=0, create_version=2.0, external_attr=0).
 *           Matches `tmp/01_zip/01/slack-1.0.0.zip`.
 * - `unix`: DEFLATE via `pako` level 6 (zlib 1.2.x-compatible), Unix-style
 *           headers with UT (mtime+atime) + ux (uid/gid) extras,
 *           create_system=3, create_version=3.0, external_attr=0x81a40000,
 *           internal_attr=1.
 *           Matches `tmp/01_zip/02/skills/slack.zip`.
 *
 * Node's bundled zlib (1.3.1) produces byte-different DEFLATE output at the
 * same level; we use `pako` so the Unix-style archive stays reproducible.
 */
export type SkillZipStyle = "dos" | "unix";

/** Default Unix mtime: 1980-01-01 00:00:00 in UTC+01:00 (used by the reference unix zip). */
export const DEFAULT_UNIX_MTIME_SECONDS = 315529200;

export type IgnoreContext = {
    absolutePath: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
};

export type SkillZipOptions = {
    /** Root folder containing SKILL.md and any skill assets/scripts. */
    rootDir: string;

    /** Archive layout. Defaults to `unix`. */
    style?: SkillZipStyle;

    /** DEFLATE level (0-9). Defaults to 6 so both reference zips reproduce. */
    level?: number;

    /** Unix mtime for UT/ux extra fields (seconds since epoch). Only used when `style === "unix"`. */
    unixMtime?: number;

    /** Unix uid embedded in the ux extra field. */
    unixUid?: number;

    /** Unix gid embedded in the ux extra field. */
    unixGid?: number;

    /** By default, `node_modules` is skipped. */
    includeNodeModules?: boolean;

    /** By default, VCS folders are skipped. */
    includeVcs?: boolean;

    /** Optional project-specific ignore hook. Return true to skip the path. */
    ignore?: (relativePath: string, context: IgnoreContext) => boolean;
};

export type SkillZipResult = {
    /** In-memory zip bytes. */
    bytes: Uint8Array;
    /** SHA-256 of `bytes` — same digest VirusTotal uses to identify the file. */
    sha256: string;
    size: number;
    entries: string[];
    style: SkillZipStyle;
};

type FileCandidate = {
    name: string;
    absolutePath: string;
};

type ZipEntry = {
    name: string;
    data: Uint8Array;
};

async function readFileBytes(filePath: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(filePath));
}

export async function createDeterministicSkillZip(
    options: SkillZipOptions,
): Promise<SkillZipResult> {
    const rootDir = path.resolve(options.rootDir);
    const style: SkillZipStyle = options.style ?? "unix";
    const level = options.level ?? 6;

    const candidates = await collectFiles(rootDir, options);

    const entries: ZipEntry[] = [];
    for (const candidate of candidates) {
        entries.push({
            name: candidate.name,
            data: await readFileBytes(candidate.absolutePath),
        });
    }

    entries.sort((a, b) => compareStrings(a.name, b.name));

    const bytes = buildZip(entries, style, level, {
        unixMtime: options.unixMtime ?? DEFAULT_UNIX_MTIME_SECONDS,
        unixUid: options.unixUid ?? 501,
        unixGid: options.unixGid ?? 20,
    });

    return {
        bytes,
        sha256: sha256Hex(bytes),
        size: bytes.byteLength,
        entries: entries.map((entry) => entry.name),
        style,
    };
}

export function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

async function collectFiles(rootDir: string, options: SkillZipOptions): Promise<FileCandidate[]> {
    const files: FileCandidate[] = [];
    const activeDirectories = new Set<string>();

    async function walk(absoluteDir: string, relativeDir: string): Promise<void> {
        const canonicalDirectory = await realpath(absoluteDir);
        if (activeDirectories.has(canonicalDirectory)) {
            throw new Error(
                `Symlink directory cycle detected in skill archive: ${relativeDir || "."}`,
            );
        }
        activeDirectories.add(canonicalDirectory);

        const dirents = await readdir(absoluteDir, { withFileTypes: true });
        dirents.sort((a, b) => compareStrings(a.name, b.name));

        try {
            for (const dirent of dirents) {
                const relativePath = normalizeZipPath(
                    relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name,
                );
                const absolutePath = path.join(absoluteDir, dirent.name);
                const context: IgnoreContext = {
                    absolutePath,
                    isDirectory: dirent.isDirectory(),
                    isFile: dirent.isFile(),
                    isSymbolicLink: dirent.isSymbolicLink(),
                };

                if (shouldIgnore(relativePath, context, options)) continue;

                if (dirent.isSymbolicLink()) {
                    const resolvedPath = await realpath(absolutePath);
                    const targetStats = await stat(resolvedPath);
                    if (targetStats.isDirectory()) {
                        await walk(resolvedPath, relativePath);
                        continue;
                    }
                    if (!targetStats.isFile()) {
                        throw new Error(
                            `Symlink target must be a file or directory in deterministic skill archives: ${relativePath}`,
                        );
                    }

                    files.push({
                        name: relativePath,
                        absolutePath: resolvedPath,
                    });
                    continue;
                }

                if (dirent.isDirectory()) {
                    await walk(absolutePath, relativePath);
                } else if (dirent.isFile()) {
                    files.push({ name: relativePath, absolutePath });
                } else {
                    throw new Error(
                        `Unsupported filesystem entry in skill archive: ${relativePath}`,
                    );
                }
            }
        } finally {
            activeDirectories.delete(canonicalDirectory);
        }
    }

    await walk(rootDir, "");
    files.sort((a, b) => compareStrings(a.name, b.name));
    return files;
}

function shouldIgnore(
    relativePath: string,
    context: IgnoreContext,
    options: SkillZipOptions,
): boolean {
    const parts = relativePath.split("/");
    const basename = parts[parts.length - 1];

    if (!options.includeVcs && [".git", ".hg", ".svn"].some((vcs) => parts.includes(vcs))) {
        return true;
    }
    if (!options.includeNodeModules && parts.includes("node_modules")) {
        return true;
    }
    if (basename === ".DS_Store" || basename === "Thumbs.db") {
        return true;
    }

    return options.ignore?.(relativePath, context) ?? false;
}

function normalizeZipPath(input: string): string {
    const normalized = input.replaceAll("\\", "/");
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
        throw new Error(`Invalid ZIP path: ${input}`);
    }

    const parts = normalized.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
        throw new Error(`Invalid ZIP path segment in: ${input}`);
    }

    return parts.join("/");
}

type UnixMeta = {
    unixMtime: number;
    unixUid: number;
    unixGid: number;
};

function buildZip(
    entries: ZipEntry[],
    style: SkillZipStyle,
    level: number,
    unix: UnixMeta,
): Uint8Array {
    if (entries.length > UINT16_MAX) {
        throw new Error("ZIP64 is not implemented: too many entries.");
    }

    const dosTime = 0;
    const dosDate = 0x0021; // 1980-01-01

    const localParts: Uint8Array[] = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = textEncoder.encode(normalizeZipPath(entry.name));
        if (nameBytes.byteLength > UINT16_MAX) {
            throw new Error(`ZIP filename too long: ${entry.name}`);
        }

        const compressed = deflate(entry.data, style, level);
        if (compressed.byteLength > UINT32_MAX || entry.data.byteLength > UINT32_MAX) {
            throw new Error(`ZIP64 is not implemented: file too large: ${entry.name}`);
        }
        if (offset > UINT32_MAX) {
            throw new Error("ZIP64 is not implemented: archive too large.");
        }

        const crc = crc32(entry.data);
        const localOffset = offset;

        const {
            extraLocal,
            extraCentral,
            createSystem,
            createVersion,
            internalAttr,
            externalAttr,
        } =
            style === "unix"
                ? unixFields(unix)
                : {
                      extraLocal: new Uint8Array(0),
                      extraCentral: new Uint8Array(0),
                      createSystem: 0,
                      createVersion: 20,
                      internalAttr: 0,
                      externalAttr: 0,
                  };

        const local = new Uint8Array(30 + nameBytes.byteLength + extraLocal.byteLength);
        const lv = new DataView(local.buffer);
        setU32(lv, 0, 0x04034b50);
        setU16(lv, 4, 20);
        setU16(lv, 6, 0);
        setU16(lv, 8, 8);
        setU16(lv, 10, dosTime);
        setU16(lv, 12, dosDate);
        setU32(lv, 14, crc);
        setU32(lv, 18, compressed.byteLength);
        setU32(lv, 22, entry.data.byteLength);
        setU16(lv, 26, nameBytes.byteLength);
        setU16(lv, 28, extraLocal.byteLength);
        local.set(nameBytes, 30);
        local.set(extraLocal, 30 + nameBytes.byteLength);

        localParts.push(local, compressed);
        offset += local.byteLength + compressed.byteLength;

        const central = new Uint8Array(46 + nameBytes.byteLength + extraCentral.byteLength);
        const cv = new DataView(central.buffer);
        setU32(cv, 0, 0x02014b50);
        cv.setUint8(4, createVersion);
        cv.setUint8(5, createSystem);
        setU16(cv, 6, 20);
        setU16(cv, 8, 0);
        setU16(cv, 10, 8);
        setU16(cv, 12, dosTime);
        setU16(cv, 14, dosDate);
        setU32(cv, 16, crc);
        setU32(cv, 20, compressed.byteLength);
        setU32(cv, 24, entry.data.byteLength);
        setU16(cv, 28, nameBytes.byteLength);
        setU16(cv, 30, extraCentral.byteLength);
        setU16(cv, 32, 0);
        setU16(cv, 34, 0);
        setU16(cv, 36, internalAttr);
        setU32(cv, 38, externalAttr);
        setU32(cv, 42, localOffset);
        central.set(nameBytes, 46);
        central.set(extraCentral, 46 + nameBytes.byteLength);
        centralParts.push(central);
    }

    const centralOffset = offset;
    const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
    if (centralOffset > UINT32_MAX || centralSize > UINT32_MAX) {
        throw new Error("ZIP64 is not implemented: central directory too large.");
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    setU32(ev, 0, 0x06054b50);
    setU16(ev, 4, 0);
    setU16(ev, 6, 0);
    setU16(ev, 8, entries.length);
    setU16(ev, 10, entries.length);
    setU32(ev, 12, centralSize);
    setU32(ev, 16, centralOffset);
    setU16(ev, 20, 0);

    return concatBytes([...localParts, ...centralParts, eocd]);
}

function deflate(data: Uint8Array, style: SkillZipStyle, level: number): Uint8Array {
    if (style === "dos") {
        return fflateDeflateSync(data, {
            level: level as DeflateOptions["level"],
        });
    }
    return pako.deflateRaw(data, {
        level: level as unknown as pako.DeflateFunctionOptions["level"],
    });
}

function unixFields(unix: UnixMeta): {
    extraLocal: Uint8Array;
    extraCentral: Uint8Array;
    createSystem: number;
    createVersion: number;
    internalAttr: number;
    externalAttr: number;
} {
    // UT (Extended timestamp): signature 0x5455 "UT".
    // Local:  flags=0x03 (mod+access), mtime, atime  → 9 bytes payload.
    // Central: flags=0x03, mtime                     → 5 bytes payload.
    const utLocal = new Uint8Array(4 + 9);
    const utLocalView = new DataView(utLocal.buffer);
    setU16(utLocalView, 0, 0x5455);
    setU16(utLocalView, 2, 9);
    utLocalView.setUint8(4, 0x03);
    setI32(utLocalView, 5, unix.unixMtime);
    setI32(utLocalView, 9, unix.unixMtime);

    const utCentral = new Uint8Array(4 + 5);
    const utCentralView = new DataView(utCentral.buffer);
    setU16(utCentralView, 0, 0x5455);
    setU16(utCentralView, 2, 5);
    utCentralView.setUint8(4, 0x03);
    setI32(utCentralView, 5, unix.unixMtime);

    // ux (Info-ZIP new Unix): signature 0x7875 "ux".
    // Payload: version(1), uid_size(1), uid(4), gid_size(1), gid(4) → 11 bytes.
    const ux = new Uint8Array(4 + 11);
    const uxView = new DataView(ux.buffer);
    setU16(uxView, 0, 0x7875);
    setU16(uxView, 2, 11);
    uxView.setUint8(4, 0x01);
    uxView.setUint8(5, 0x04);
    setU32(uxView, 6, unix.unixUid);
    uxView.setUint8(10, 0x04);
    setU32(uxView, 11, unix.unixGid);

    return {
        extraLocal: concatBytes([utLocal, ux]),
        extraCentral: concatBytes([utCentral, ux]),
        createSystem: 3, // Unix
        createVersion: 30, // 3.0
        internalAttr: 1, // text
        externalAttr: 0x81a40000, // -rw-r--r-- regular file
    };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.byteLength;
    }
    return out;
}

function setU16(view: DataView, offset: number, value: number): void {
    view.setUint16(offset, value, true);
}

function setU32(view: DataView, offset: number, value: number): void {
    view.setUint32(offset, value >>> 0, true);
}

function setI32(view: DataView, offset: number, value: number): void {
    view.setInt32(offset, value | 0, true);
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC32_TABLE[i] = c >>> 0;
}

export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        const idx = (crc ^ byte) & 0xff;
        crc = (CRC32_TABLE[idx] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
