import { describe, expect, it } from "bun:test";
import { renderSearchHitsCompact, renderSearchHitsTable } from "./output";
import type { SkillHit } from "./query";

const SAMPLE_HIT: SkillHit = {
    skillId: "skill-1",
    occurrences: [
        {
            sourceId: "source-1",
            sourceName: "source-one",
            location: "local",
            subpath: "azure-helper",
            date: "2026-04-23T00:00:00.000Z",
        },
    ],
    primaryOccurrence: {
        sourceId: "source-1",
        sourceName: "source-one",
        location: "local",
        subpath: "azure-helper",
        date: "2026-04-23T00:00:00.000Z",
    },
    name: "azure helper",
    description: "Help with Azure-related workflows",
    status: null,
    tags: [],
    score: 123.456,
    maxScore: 123.456,
    meanScore: 123.456,
    matches: [],
};

describe("renderSearchHitsTable", () => {
    it("omits the score column for normal text search output", () => {
        const [header, row] = renderSearchHitsTable([SAMPLE_HIT], 120, {
            showScore: false,
        })
            .trimEnd()
            .split("\n");

        expect(header).toContain("short_id");
        expect(row?.trimStart().startsWith(SAMPLE_HIT.skillId)).toBe(true);
        expect(header).toContain("source");
        expect(header).toContain("skill");
        expect(header).toContain("description");
        expect(header).not.toContain("score");
    });

    it("keeps the score column for embedding search output", () => {
        const [header] = renderSearchHitsTable([SAMPLE_HIT], 120, {
            showScore: true,
        })
            .trimEnd()
            .split("\n");

        expect(header).toContain("score");
    });

    it("places the badge in an untitled column after skill", () => {
        const [header, row] = renderSearchHitsTable([{ ...SAMPLE_HIT, status: "approved" }], 120, {
            showScore: false,
        })
            .trimEnd()
            .split("\n");

        expect(header).toContain("skill");
        expect(header).not.toContain("type");
        // Badge renders to the right of the skill name on the row.
        const r = row ?? "";
        expect(r.indexOf("✅")).toBeGreaterThan(r.indexOf("azure helper"));
    });

    it("renders the approved badge in the type column", () => {
        const output = renderSearchHitsTable([{ ...SAMPLE_HIT, status: "approved" }], 120, {
            showScore: false,
        });

        expect(output).toContain("✅");
        // Skill column shows the plain name; the emoji lives in the type column.
        expect(output).toContain("azure helper");
    });

    it("renders an emoji badge for a recognized type tag", () => {
        const output = renderSearchHitsTable([{ ...SAMPLE_HIT, tags: ["corporate"] }], 120, {
            showScore: false,
        });

        expect(output).toContain("🏢");
    });

    it("renders type tag and approved badges together in canonical order", () => {
        const output = renderSearchHitsTable(
            [{ ...SAMPLE_HIT, status: "approved", tags: ["corporate", "verified"] }],
            120,
            { showScore: false },
        );

        // verified folds onto certified (📜); approved (✅) renders last.
        expect(output).toContain("🏢 📜 ✅");
    });

    it("splits a slashed source name on '/' without injecting a stray character", () => {
        const occurrence = {
            sourceId: "source-1",
            sourceName: "google/skills",
            location: "packages",
            subpath: "skills/cloud/google-cloud-recipe-auth",
            date: "2026-04-23T00:00:00.000Z",
        };
        const output = renderSearchHitsTable(
            [{ ...SAMPLE_HIT, occurrences: [occurrence], primaryOccurrence: occurrence }],
            120,
            { showScore: false },
        );

        expect(output).toContain("/skills");
        expect(output).not.toContain("/sskills");
    });
});

describe("renderSearchHitsCompact", () => {
    it("omits the score column for normal compact output", () => {
        const [header, row] = renderSearchHitsCompact([SAMPLE_HIT], 120, {
            showScore: false,
        })
            .trimEnd()
            .split("\n");

        expect(header).toContain("short_id");
        expect(row?.trimStart().startsWith(SAMPLE_HIT.skillId)).toBe(true);
        expect(header).toContain("source");
        expect(header).toContain("skill");
        expect(header).toContain("description");
        expect(header).not.toContain("score");
    });

    it("keeps the score column for embedding compact output", () => {
        const [header] = renderSearchHitsCompact([SAMPLE_HIT], 120, {
            showScore: true,
        })
            .trimEnd()
            .split("\n");

        expect(header).toContain("score");
    });

    it("marks approved skills in the untitled type column of compact output", () => {
        const output = renderSearchHitsCompact([{ ...SAMPLE_HIT, status: "approved" }], 120, {
            showScore: false,
        });

        const [header] = output.trimEnd().split("\n");
        expect(header).not.toContain("type");
        expect(output).toContain("✅");
        expect(output).toContain("azure helper");
    });
});
