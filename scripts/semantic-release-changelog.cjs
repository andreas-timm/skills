const semanticReleaseChangelog = require("@semantic-release/changelog");
const { DEFAULT_CHANGELOG_FILE, changelogHasVersion } = require("./changelog-version.cjs");

async function verifyConditions(pluginConfig = {}, context) {
    return semanticReleaseChangelog.verifyConditions(pluginConfig, context);
}

async function prepare(pluginConfig = {}, context) {
    const version = context.nextRelease && context.nextRelease.version;
    const changelogFile = pluginConfig.changelogFile || DEFAULT_CHANGELOG_FILE;

    if (version) {
        const { changelogPath, exists } = await changelogHasVersion({
            changelogFile,
            cwd: context.cwd,
            version,
        });

        if (exists) {
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
