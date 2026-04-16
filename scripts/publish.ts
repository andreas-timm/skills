#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

import { packageFileName, root } from "./shared.ts";

const extraPublishArgs = process.argv.slice(2);
const publishArgs = ["publish", `./packs/${packageFileName}`, "--access", "public"];

if (process.env.npm_config_registry) {
    publishArgs.push("--registry", process.env.npm_config_registry);
}

if (process.env.npm_config_otp) {
    publishArgs.push("--otp", process.env.npm_config_otp);
}

const pack = spawnSync("bun", ["run", "pack"], { cwd: root, stdio: "inherit" });
if (pack.status !== 0) {
    process.exit(pack.status ?? 1);
}

publishArgs.push(...extraPublishArgs);

const publish = spawnSync("npm", publishArgs, { cwd: root, stdio: "inherit" });
process.exit(publish.status ?? 1);
