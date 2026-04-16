#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

type PackageJson = {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
};

const root = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;

const externalPackages = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
].sort();

rmSync(join(root, "dist"), { force: true, recursive: true });

const result = spawnSync(
    "bun",
    [
        "build",
        "src/cli.ts",
        "--target",
        "bun",
        "--format",
        "esm",
        ...externalPackages.flatMap((name) => ["--external", name]),
        "--outfile",
        "dist/cli.js",
    ],
    {
        cwd: root,
        stdio: "inherit",
    },
);

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

chmodSync(join(root, "dist", "cli.js"), 0o755);
