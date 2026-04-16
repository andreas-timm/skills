import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferSourceRoot } from "./source";

describe("inferSourceRoot", () => {
    it("uses git root when .git exists on the path to the location root", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-source-test-"));
        try {
            const gitRoot = join(root, "proj");
            const nested = join(gitRoot, "a", "b");
            await mkdir(nested, { recursive: true });
            await writeFile(join(gitRoot, ".git"), "ref: refs/heads/main\n");

            const { sourceRoot, git, useLocationName } = inferSourceRoot(nested, root);
            expect(git).toBe(true);
            expect(useLocationName).toBe(false);
            expect(sourceRoot).toBe(gitRoot);
            expect(inferSourceRoot(nested, root).sourceRootSubpath).toBe("proj");
            expect(inferSourceRoot(nested, root).occurrenceSubpath).toBe("a/b");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("uses top-level folder under location when not a git repo", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-source-test-"));
        try {
            const top = join(root, "pkg");
            const deep = join(top, "x", "y");
            await mkdir(deep, { recursive: true });

            const { sourceRoot, sourceRootSubpath, occurrenceSubpath, git, useLocationName } =
                inferSourceRoot(deep, root);
            expect(git).toBe(false);
            expect(useLocationName).toBe(false);
            expect(sourceRoot).toBe(top);
            expect(sourceRootSubpath).toBe("pkg");
            expect(occurrenceSubpath).toBe("pkg/x/y");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("picks the closest git root when both the location root and a nested folder are git repos", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-source-test-"));
        try {
            const nestedGit = join(root, "pkg");
            const skillDir = join(nestedGit, "a", "b");
            await mkdir(skillDir, { recursive: true });
            await writeFile(join(root, ".git"), "ref: refs/heads/main\n");
            await writeFile(join(nestedGit, ".git"), "ref: refs/heads/main\n");

            const { sourceRoot, sourceRootSubpath, occurrenceSubpath, git, useLocationName } =
                inferSourceRoot(skillDir, root);
            expect(git).toBe(true);
            expect(useLocationName).toBe(false);
            expect(sourceRoot).toBe(nestedGit);
            expect(sourceRootSubpath).toBe("pkg");
            expect(occurrenceSubpath).toBe("a/b");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("treats a `.git`-suffix folder with a nested `.git` entry as a git repo", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-source-test-"));
        try {
            const repoLikeDir = join(root, "everything-claude-code.git");
            const skillDir = join(repoLikeDir, "docs", "tr", "skills", "api-design");
            await mkdir(skillDir, { recursive: true });
            await writeFile(join(root, ".git"), "ref: refs/heads/main\n");
            await writeFile(join(repoLikeDir, ".git"), "ref: refs/heads/main\n");

            const { sourceRoot, sourceRootSubpath, occurrenceSubpath, git, useLocationName } =
                inferSourceRoot(skillDir, root);
            expect(git).toBe(true);
            expect(useLocationName).toBe(false);
            expect(sourceRoot).toBe(repoLikeDir);
            expect(sourceRootSubpath).toBe("everything-claude-code.git");
            expect(occurrenceSubpath).toBe("docs/tr/skills/api-design");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("treats a `.git`-suffix folder without a nested `.git` entry as a non-git source", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-source-test-"));
        try {
            const repoLikeDir = join(root, "everything-claude-code.git");
            const skillDir = join(repoLikeDir, "docs", "tr", "skills", "api-design");
            await mkdir(skillDir, { recursive: true });
            await writeFile(join(root, ".git"), "ref: refs/heads/main\n");

            const { sourceRoot, sourceRootSubpath, occurrenceSubpath, git, useLocationName } =
                inferSourceRoot(skillDir, root);
            expect(git).toBe(false);
            expect(useLocationName).toBe(false);
            expect(sourceRoot).toBe(repoLikeDir);
            expect(sourceRootSubpath).toBe("everything-claude-code.git");
            expect(occurrenceSubpath).toBe("everything-claude-code.git/docs/tr/skills/api-design");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("flags useLocationName when the top-level folder is the skill folder itself", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-source-test-"));
        try {
            const skillDir = join(root, "pkg");
            await mkdir(skillDir, { recursive: true });

            const { sourceRoot, sourceRootSubpath, occurrenceSubpath, git, useLocationName } =
                inferSourceRoot(skillDir, root);
            expect(git).toBe(false);
            expect(useLocationName).toBe(true);
            expect(sourceRoot).toBe(root);
            expect(sourceRootSubpath).toBe("");
            expect(occurrenceSubpath).toBe("pkg");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("flags useLocationName when the skill lives directly at the location root", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-source-test-"));
        try {
            const { sourceRoot, sourceRootSubpath, occurrenceSubpath, git, useLocationName } =
                inferSourceRoot(root, root);
            expect(git).toBe(false);
            expect(useLocationName).toBe(true);
            expect(sourceRoot).toBe(root);
            expect(sourceRootSubpath).toBe("");
            expect(occurrenceSubpath).toBe("");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
