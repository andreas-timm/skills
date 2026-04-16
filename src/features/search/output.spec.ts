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

    it("marks approved skills in the skill column", () => {
        const output = renderSearchHitsTable([{ ...SAMPLE_HIT, status: "approved" }], 120, {
            showScore: false,
        });

        expect(output).toContain("azure helper ✅");
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

    it("marks approved skills in compact output", () => {
        const output = renderSearchHitsCompact([{ ...SAMPLE_HIT, status: "approved" }], 120, {
            showScore: false,
        });

        expect(output).toContain("azure helper ✅");
    });
});
