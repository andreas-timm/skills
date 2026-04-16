import type { GitInfo } from "@features/update/types";
import { $ } from "bun";

async function runText(cmd: ReturnType<typeof $>): Promise<string | undefined> {
    const result = await cmd.nothrow().quiet();
    if (result.exitCode !== 0) return undefined;
    const value = result.stdout.toString().trim();
    return value || undefined;
}

export async function getGitInfo(repoPath: string): Promise<GitInfo> {
    const [remote, branch, commit, date] = await Promise.all([
        runText($`git -C ${repoPath} config --get remote.origin.url`),
        runText($`git -C ${repoPath} rev-parse --abbrev-ref HEAD`),
        runText($`git -C ${repoPath} rev-parse HEAD`),
        runText($`git -C ${repoPath} log -1 --format=%cI`),
    ]);
    return { remote, branch, commit, date };
}

export async function getFileLastCommitDate(
    repoPath: string,
    relativePath: string,
): Promise<string | null> {
    const value = await runText($`git -C ${repoPath} log -1 --format=%cI -- ${relativePath}`);
    return value ?? null;
}
