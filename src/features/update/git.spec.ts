import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { getFileLastCommitDate } from "./git";

describe("getFileLastCommitDate", () => {
    it("returns null for untracked files", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-git-test-"));
        try {
            await $`git -C ${root} init`.quiet();
            await writeFile(join(root, "SKILL.md"), "# test\n", "utf-8");
            const date = await getFileLastCommitDate(root, "SKILL.md");
            expect(date).toBeNull();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("returns ISO date for tracked files", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-git-test-"));
        try {
            await $`git -C ${root} init`.quiet();
            await mkdir(join(root, "skill"), { recursive: true });
            await writeFile(join(root, "skill", "SKILL.md"), "# test\n", "utf-8");
            await $`git -C ${root} add skill/SKILL.md`.quiet();
            await $`git -C ${root} -c user.email=test@example.com -c user.name=Test commit -m "add skill"`.quiet();
            const date = await getFileLastCommitDate(root, "skill/SKILL.md");
            expect(date).not.toBeNull();
            expect(() => new Date(date as string).toISOString()).not.toThrow();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
