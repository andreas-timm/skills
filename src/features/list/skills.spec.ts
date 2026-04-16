import { describe, expect, it } from "bun:test";
import { resolveTableWidth } from "@andreas-timm/cli-table";
import type { SkillListRow } from "./query";
import {
    applySkillListOptions,
    displaySubpath,
    formatOccurrenceDetail,
    formatSkillListName,
    parseSkillListSort,
} from "./skills";

function skillListRow(overrides: Partial<SkillListRow>): SkillListRow {
    return {
        id: "skill",
        date: null,
        version_order: 1,
        version_count: 1,
        duplicate: 0,
        name: null,
        version: null,
        description: null,
        location: null,
        source_name: null,
        status: undefined,
        rating: null,
        tags: [],
        note: null,
        ...overrides,
    };
}

describe("resolveTableWidth", () => {
    it("uses terminal fallback when option is undefined", () => {
        expect(resolveTableWidth(undefined, { fallback: 120 })).toBe(120);
    });

    it("maps width=0 to terminal width", () => {
        expect(resolveTableWidth(0, { fallback: 95 })).toBe(95);
    });

    it("enforces a minimum explicit width", () => {
        expect(resolveTableWidth(8, { min: 20, fallback: 95 })).toBe(20);
    });
});

describe("displaySubpath", () => {
    it("strips an exact source-name prefix", () => {
        expect(displaySubpath("source-one", "source-one/skills/calendar")).toBe("skills/calendar");
    });

    it("strips a repo basename with optional `.git` suffix", () => {
        expect(
            displaySubpath(
                "affaan-m/everything-claude-code",
                "everything-claude-code.git/docs/tr/skills/verification-loop",
            ),
        ).toBe("docs/tr/skills/verification-loop");
    });
});

describe("formatOccurrenceDetail", () => {
    it("renders location, source, and normalized subpath with pipes", () => {
        expect(
            formatOccurrenceDetail({
                location: "packages",
                source_name: "affaan-m/everything-claude-code",
                subpath: "everything-claude-code.git/docs/ja-JP/skills/python-testing",
            }),
        ).toBe("packages | affaan-m/everything-claude-code | docs/ja-JP/skills/python-testing");
    });
});

describe("formatSkillListName", () => {
    it("renders name, location, and source on separate lines", () => {
        expect(
            formatSkillListName({
                name: "python-testing",
                location: "packages",
                source_name: "affaan-m/everything-claude-code",
                status: undefined,
            }),
        ).toBe("python-testing\npackages\naffaan-m/everything-claude-code");
    });

    it("marks disabled skills in the name cell", () => {
        expect(
            formatSkillListName({
                disabled: true,
                name: "python-testing",
                location: "packages",
                source_name: "affaan-m/everything-claude-code",
                status: undefined,
            }),
        ).toBe("python-testing 🚫 disabled\npackages\naffaan-m/everything-claude-code");
    });
});

describe("parseSkillListSort", () => {
    it("parses comma-separated sort fields", () => {
        expect(parseSkillListSort("date, approved,name")).toEqual(["date", "approved", "name"]);
    });

    it("rejects unsupported sort fields", () => {
        expect(() => parseSkillListSort("rating")).toThrow('Invalid --sort field "rating"');
    });

    it("rejects misspelled sort fields", () => {
        expect(() => parseSkillListSort("appproved")).toThrow('Invalid --sort field "appproved"');
    });
});

describe("applySkillListOptions", () => {
    it("sorts rows by requested fields before applying limit", () => {
        const rows = [
            skillListRow({
                id: "bravo",
                name: "bravo",
                location: "two",
                source_name: "source-b",
            }),
            skillListRow({
                id: "charlie",
                name: "charlie",
                location: "one",
                source_name: "source-c",
            }),
            skillListRow({
                id: "alpha",
                name: "alpha",
                location: "one",
                source_name: "source-a",
            }),
        ];

        expect(
            applySkillListOptions(rows, {
                sort: "location,name",
                limit: 2,
            }).map((row) => row.id),
        ).toEqual(["alpha", "charlie"]);
    });

    it("sorts date newest first and approved rows first", () => {
        const rows = [
            skillListRow({
                id: "older-approved",
                date: "2026-04-20T00:00:00.000Z",
                status: "approved",
            }),
            skillListRow({
                id: "newer-unapproved",
                date: "2026-04-21T00:00:00.000Z",
            }),
            skillListRow({
                id: "newer-approved",
                date: "2026-04-21T00:00:00.000Z",
                status: "approved",
            }),
        ];

        expect(
            applySkillListOptions(rows, {
                sort: "date,approved",
            }).map((row) => row.id),
        ).toEqual(["newer-approved", "newer-unapproved", "older-approved"]);
    });
});
