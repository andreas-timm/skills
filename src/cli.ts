#!/usr/bin/env bun

import {
    installDefaultCommandHelp,
    installSubcommandHelp,
    registerCompletionCommands,
    run,
} from "@andreas-timm/cli";
import { registerApproveCommands } from "@features/approve/cli";
import { registerListCommands } from "@features/list/cli";
import { registerLocationCommands } from "@features/location/cli";
import { registerSearchCommands } from "@features/search/cli";
import { registerShowCommands } from "@features/show/cli";
import { registerSkillCommands } from "@features/skill/cli.ts";
import { registerStatusCommands } from "@features/status/cli";
import { registerUpdateCommands } from "@features/update/cli";
import { registerVirusTotalCommands } from "@features/virustotal/cli";
import { registerZipCommands } from "@features/zip/cli";
import { cac } from "cac";
import packageJson from "../package.json";

const cli = cac(Object.keys(packageJson.bin)[0]);
cli.usage("[command] [options]");

cli.option("-v, --verbose", "Enable verbose logging");
cli.version(packageJson.version);

registerUpdateCommands(cli);
registerSkillCommands(cli);
registerSearchCommands(cli);
registerShowCommands(cli);
registerStatusCommands(cli);
registerListCommands(cli);
registerLocationCommands(cli);
registerApproveCommands(cli);
registerZipCommands(cli);
registerVirusTotalCommands(cli);
registerCompletionCommands(cli);
installDefaultCommandHelp(cli, { compactCommandsSection: true });
installSubcommandHelp(cli);

await run(cli);
