const fs = require("fs/promises");
const path = require("path");
const semanticReleaseChangelog = require("@semantic-release/changelog");

const DEFAULT_CHANGELOG_FILE = "CHANGELOG.md";

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasVersionSection(content, version) {
    const escapedVersion = escapeRegExp(version);
    const versionHeading = new RegExp(
        `^#{1,6}\\s+(?:\\[[vV]?${escapedVersion}\\](?:\\([^\\n)]*\\))?|[vV]?${escapedVersion})(?:\\s|$)`,
        "m",
    );

    return versionHeading.test(content);
}

async function readChangelog(changelogPath) {
    try {
        return await fs.readFile(changelogPath, "utf8");
    } catch (error) {
        if (error && error.code === "ENOENT") {
            return "";
        }

        throw error;
    }
}

async function verifyConditions(pluginConfig = {}, context) {
    return semanticReleaseChangelog.verifyConditions(pluginConfig, context);
}

async function prepare(pluginConfig = {}, context) {
    const version = context.nextRelease && context.nextRelease.version;
    const changelogFile = pluginConfig.changelogFile || DEFAULT_CHANGELOG_FILE;
    const changelogPath = path.resolve(context.cwd, changelogFile);

    if (version) {
        const content = await readChangelog(changelogPath);

        if (hasVersionSection(content, version)) {
            context.logger.log(
                "Skip %s: version %s already exists in the changelog",
                changelogPath,
                version,
            );
            return;
        }
    }

    return semanticReleaseChangelog.prepare(pluginConfig, context);
}

module.exports = {
    prepare,
    verifyConditions,
};
