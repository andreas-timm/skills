import { getGitInfo } from "@features/update/git";
import { $ } from "bun";

/** Project context captured at install time (the "project" and "project info"). */
export type InstallProjectInfo = {
    projectDir: string;
    gitRemote: string | null;
    gitBranch: string | null;
    gitCommit: string | null;
};

async function gitToplevel(cwd: string): Promise<string | null> {
    const result = await $`git -C ${cwd} rev-parse --show-toplevel`.nothrow().quiet();
    if (result.exitCode !== 0) return null;
    const value = result.stdout.toString().trim();
    return value || null;
}

/**
 * Resolve the project the install was run from: the enclosing git repo when
 * available, otherwise `cwd`, plus that repo's git provenance.
 */
export async function collectInstallProjectInfo(cwd: string): Promise<InstallProjectInfo> {
    const projectDir = (await gitToplevel(cwd)) ?? cwd;
    const git = await getGitInfo(projectDir);
    return {
        projectDir,
        gitRemote: git.remote ?? null,
        gitBranch: git.branch ?? null,
        gitCommit: git.commit ?? null,
    };
}
