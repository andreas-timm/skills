import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { from, lastValueFrom, toArray } from "rxjs";
import { transform } from "./transform";

const problematic = `---
name: django-verification
description: Verification loop for Django projects: migrations, linting, tests with coverage, security scans, and deployment readiness checks before release or PR.
---

# body
`;

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

describe("frontmatter parsing — django-verification SKILL.md", () => {
    it("gray-matter fails on unquoted colon inside description value", () => {
        expect(() => matter(problematic)).toThrow(/incomplete explicit mapping pair|mapping/i);
    });

    it("parseFallback recovers name and full description", () => {
        const data = parseFallback(problematic);
        expect(data.name).toBe("django-verification");
        expect(data.description).toBe(
            "Verification loop for Django projects: migrations, linting, tests with coverage, security scans, and deployment readiness checks before release or PR.",
        );
    });
});

async function writeSkill(filePath: string, name: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
        filePath,
        `---
name: ${name}
description: ${name} description
---

# ${name}
`,
    );
}

describe("transform source config ignores", () => {
    it("skips full-path glob matches only for the configured source", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-transform-test-"));
        try {
            const ignored = join(root, "source-one", "ignored", "demo", "SKILL.md");
            const kept = join(root, "source-one", "kept", "demo", "SKILL.md");
            const samePathOtherSource = join(root, "other-source", "ignored", "demo", "SKILL.md");
            await writeSkill(ignored, "ignored skill");
            await writeSkill(kept, "kept skill");
            await writeSkill(samePathOtherSource, "other source skill");

            const rows = await lastValueFrom(
                transform(
                    from(
                        [ignored, kept, samePathOtherSource].map((filePath) => ({
                            locationName: "packages",
                            locationRoot: root,
                            filePath,
                            locationSourceConfig: {
                                "source-one": {
                                    ignore: [`${root}/source-one/ignored/**`],
                                },
                            },
                        })),
                    ),
                ).pipe(toArray()),
            );

            expect(
                rows
                    .map((row) => row.skill.name)
                    .toSorted((a, b) => String(a).localeCompare(String(b))),
            ).toEqual(["kept skill", "other source skill"]);
            expect(rows.map((row) => row.source.name).toSorted()).toEqual([
                "other-source",
                "source-one",
            ]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
