import { Database } from "bun:sqlite";

export type ResolvedSkillReference = {
    id: string;
    short_id: string | null;
    name: string | null;
    version: string | null;
    version_order: number;
};

type VersionedSkillReference = {
    name: string;
    version: string;
    versionOrder: number | null;
};

const SELECT_SKILL_REFERENCE = `SELECT s.id,
                                       s.short_id,
                                       s.name,
                                       s.version,
                                       s.version_order
                                FROM skills s`;

function parseVersionOrder(value: string): number | null {
    const match = /^v?([1-9]\d*)$/.exec(value);
    if (!match) {
        return null;
    }

    const versionOrder = Number(match[1]);
    return Number.isSafeInteger(versionOrder) ? versionOrder : null;
}

function parseVersionedSkillReference(reference: string): VersionedSkillReference | null {
    const suffixIndex = reference.lastIndexOf("@");
    if (suffixIndex <= 0 || suffixIndex === reference.length - 1) {
        return null;
    }

    const name = reference.slice(0, suffixIndex);
    const version = reference.slice(suffixIndex + 1);
    if (name.trim() === "" || version.trim() === "") {
        return null;
    }

    return {
        name,
        version,
        versionOrder: parseVersionOrder(version),
    };
}

export function resolveSkillReferenceInDb(
    db: Database,
    reference: string,
): ResolvedSkillReference | null {
    const byId = db
        .query<ResolvedSkillReference, { $id: string }>(
            `${SELECT_SKILL_REFERENCE}
             WHERE s.id = $id OR s.short_id = $id
             ORDER BY s.id
             LIMIT 1`,
        )
        .get({ $id: reference });
    if (byId) {
        return byId;
    }

    const versionedReference = parseVersionedSkillReference(reference);
    if (versionedReference) {
        const byFrontmatterVersion = db
            .query<ResolvedSkillReference, { $name: string; $version: string }>(
                `${SELECT_SKILL_REFERENCE}
                 WHERE s.name = $name
                   AND s.version = $version
                 ORDER BY s.version_order DESC, s.id
                 LIMIT 1`,
            )
            .get({
                $name: versionedReference.name,
                $version: versionedReference.version,
            });

        if (byFrontmatterVersion) {
            return byFrontmatterVersion;
        }

        if (versionedReference.versionOrder !== null) {
            const byGeneratedVersion = db
                .query<ResolvedSkillReference, { $name: string; $version_order: number }>(
                    `${SELECT_SKILL_REFERENCE}
                     WHERE s.name = $name
                       AND (s.version IS NULL OR trim(s.version) = '')
                       AND s.version_order = $version_order
                     ORDER BY s.id
                     LIMIT 1`,
                )
                .get({
                    $name: versionedReference.name,
                    $version_order: versionedReference.versionOrder,
                });

            if (byGeneratedVersion) {
                return byGeneratedVersion;
            }
        }
    }

    const latestByName = db
        .query<ResolvedSkillReference, { $name: string }>(
            `${SELECT_SKILL_REFERENCE}
             WHERE s.name = $name
             ORDER BY s.version_order DESC, s.id
             LIMIT 1`,
        )
        .get({ $name: reference });
    if (latestByName) {
        return latestByName;
    }

    return db
        .query<ResolvedSkillReference, { $subpath: string }>(
            `${SELECT_SKILL_REFERENCE}
             JOIN skill_occurrences o ON o.skill_id = s.id
             WHERE o.subpath = $subpath
             ORDER BY s.version_order DESC, s.id
             LIMIT 1`,
        )
        .get({ $subpath: reference });
}

export function resolveSkillReference(
    dbPath: string,
    reference: string,
): ResolvedSkillReference | null {
    const db = new Database(dbPath, { readonly: true });
    try {
        return resolveSkillReferenceInDb(db, reference);
    } finally {
        db.close();
    }
}
