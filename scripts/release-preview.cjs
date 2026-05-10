const { spawnSync } = require("child_process");
const path = require("path");
const { changelogHasVersion } = require("./changelog-version.cjs");

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "g");
const RELEASE_PREVIEW_ARGS = [
    "--dry-run",
    "--no-ci",
    "--plugins",
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
];

function stripAnsi(value) {
    return value.replace(ANSI_PATTERN, "");
}

function findNextVersion(output) {
    const plainOutput = stripAnsi(output);
    const nextVersion = /\bThe next release version is ([^\s]+)/.exec(plainOutput);
    const releaseNoteVersion = /\bRelease note for version ([^:\s]+):/.exec(plainOutput);

    return (nextVersion && nextVersion[1]) || (releaseNoteVersion && releaseNoteVersion[1]) || null;
}

function suppressReleaseNotes(output, version) {
    const lines = output.split(/\r?\n/);
    const releaseNoteIndex = lines.findIndex((line) =>
        stripAnsi(line).includes(`Release note for version ${version}:`),
    );

    if (releaseNoteIndex === -1) {
        return output;
    }

    const visibleOutput = lines.slice(0, releaseNoteIndex).join("\n");
    return visibleOutput ? `${visibleOutput}\n` : "";
}

async function main() {
    const semanticReleaseBin = require.resolve("semantic-release/bin/semantic-release.js");
    const result = spawnSync(process.execPath, [semanticReleaseBin, ...RELEASE_PREVIEW_ARGS], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: process.env,
    });

    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    const output = `${stdout}${stderr}`;
    const version = findNextVersion(output);

    if (version) {
        const { changelogPath, exists } = await changelogHasVersion({
            cwd: process.cwd(),
            version,
        });

        if (exists) {
            process.stdout.write(suppressReleaseNotes(output, version));
            process.stdout.write(
                `[release:preview] ${path.relative(
                    process.cwd(),
                    changelogPath,
                )} already contains ${version}; no CHANGELOG.md update would be made.\n`,
            );
            process.exit(result.status === null ? 1 : result.status);
        }
    }

    process.stdout.write(stdout);
    process.stderr.write(stderr);

    if (result.error) {
        process.stderr.write(`${result.error.message}\n`);
        process.exit(1);
    }

    process.exit(result.status === null ? 1 : result.status);
}

main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
});
