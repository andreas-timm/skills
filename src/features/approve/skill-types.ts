/**
 * Recognized skill/source "types" and their emoji badges.
 *
 * Types are a multi-valued set stored in the existing `tags` column: any tag
 * that matches a key here (after alias + case normalization) renders as its
 * emoji in search output. The `approved` type is additionally driven by the
 * approval status, so an approved skill shows ✅ even without an `approved` tag.
 *
 * Declaration order is the canonical render order; `approved` is last so an
 * approved-only hit still renders as `<name> ✅` exactly as before.
 */
export const TYPE_EMOJIS = {
    official: "🏛️",
    corporate: "🏢",
    branded: "🏷️",
    certified: "📜",
    partner: "🤝",
    community: "👥",
    experimental: "🧪",
    deprecated: "⚠️",
    approved: "✅",
} as const;

export type SkillType = keyof typeof TYPE_EMOJIS;

/** Aliases fold onto a canonical type (e.g. `verified` ≈ certs). */
const TYPE_ALIASES: Record<string, SkillType> = {
    verified: "certified",
    cert: "certified",
    certs: "certified",
};

const CANONICAL_ORDER = Object.keys(TYPE_EMOJIS) as SkillType[];

/** Resolve a raw tag to a canonical {@link SkillType}, or null if unrecognized. */
export function normalizeType(raw: string): SkillType | null {
    const key = raw.trim().toLowerCase();
    if (key in TYPE_EMOJIS) {
        return key as SkillType;
    }
    return TYPE_ALIASES[key] ?? null;
}

/** Emoji for a raw tag, or null if it is not a recognized type. */
export function typeEmoji(raw: string): string | null {
    const type = normalizeType(raw);
    return type ? TYPE_EMOJIS[type] : null;
}

/**
 * Emoji badge suffix for a hit: the approval status (✅ when approved) plus any
 * recognized type tags, de-duplicated and rendered in canonical order. Returns
 * "" when there is nothing to show.
 */
export function typeBadges(
    status: string | null | undefined,
    tags: readonly string[] = [],
): string {
    const present = new Set<SkillType>();
    if (status === "approved") {
        present.add("approved");
    }
    for (const tag of tags) {
        const type = normalizeType(tag);
        if (type) {
            present.add(type);
        }
    }
    return CANONICAL_ORDER.filter((type) => present.has(type))
        .map((type) => TYPE_EMOJIS[type])
        .join(" ");
}
