import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDeterministicSkillZip } from "./deterministic-zip.ts";

const featureRoot = import.meta.dir;

describe("skill zip / VirusTotal file hash", () => {
    it("dos style: tests/01/slack → 3fb592fd…", async () => {
        const result = await createDeterministicSkillZip({
            rootDir: path.join(featureRoot, "tests/01/slack"),
            style: "dos",
        });
        expect(result.sha256).toBe(
            "3fb592fd566fd42495c863b285303d4092debb58c912e91498f4e523dd4b60dc",
        );
        expect(result.entries).toEqual(["SKILL.md", "_meta.json"]);
    });

    it("unix style: tests/02/slack → c3613d…", async () => {
        const result = await createDeterministicSkillZip({
            rootDir: path.join(featureRoot, "tests/02/slack"),
            style: "unix",
        });
        expect(result.sha256).toBe(
            "c3613d008ae0449d1a0a5ada66eda3af5e1fd8603650dde255179bcd86fe374a",
        );
        expect(result.entries).toEqual(["SKILL.md"]);
    });
});

describe("skill zip symlink handling", () => {
    it("dereferences symlinked SKILL.md target within root", async () => {
        const rootDir = await mkdtemp(path.join(tmpdir(), "skill-zip-in-root-"));
        try {
            const targetPath = path.join(rootDir, "real-skill.md");
            const linkPath = path.join(rootDir, "SKILL.md");
            await writeFile(
                targetPath,
                "---\nname: symlink-skill\ndescription: in root\n---\n\n# body\n",
                "utf-8",
            );
            await symlink("real-skill.md", linkPath);

            const result = await createDeterministicSkillZip({ rootDir });
            expect(result.entries).toEqual(["SKILL.md", "real-skill.md"]);
        } finally {
            await rm(rootDir, { recursive: true, force: true });
        }
    });

    it("dereferences symlinks whose targets are outside the skill root", async () => {
        const rootDir = await mkdtemp(path.join(tmpdir(), "skill-zip-out-root-"));
        const outsideDir = await mkdtemp(path.join(tmpdir(), "skill-zip-outside-"));
        try {
            const outsideFile = path.join(outsideDir, "external.md");
            await writeFile(
                outsideFile,
                "---\nname: external\ndescription: outside\n---\n",
                "utf-8",
            );
            await symlink(outsideFile, path.join(rootDir, "SKILL.md"));

            const result = await createDeterministicSkillZip({ rootDir });
            expect(result.entries).toEqual(["SKILL.md"]);
        } finally {
            await rm(outsideDir, { recursive: true, force: true });
            await rm(rootDir, { recursive: true, force: true });
        }
    });

    it("dereferences symlinked directories", async () => {
        const rootDir = await mkdtemp(path.join(tmpdir(), "skill-zip-link-dir-"));
        const outsideDir = await mkdtemp(path.join(tmpdir(), "skill-zip-scripts-"));
        try {
            await writeFile(
                path.join(rootDir, "SKILL.md"),
                "---\nname: linked-dir\ndescription: scripts link\n---\n",
                "utf-8",
            );
            await writeFile(
                path.join(outsideDir, "setup.sh"),
                "#!/usr/bin/env bash\necho setup\n",
                "utf-8",
            );
            await symlink(outsideDir, path.join(rootDir, "scripts"));

            const result = await createDeterministicSkillZip({ rootDir });
            expect(result.entries).toEqual(["SKILL.md", "scripts/setup.sh"]);
        } finally {
            await rm(outsideDir, { recursive: true, force: true });
            await rm(rootDir, { recursive: true, force: true });
        }
    });
});
