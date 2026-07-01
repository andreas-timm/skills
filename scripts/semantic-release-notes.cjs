const path = require("path");
const notesGenerator = require("@semantic-release/release-notes-generator");
const {
    DEFAULT_CHANGELOG_FILE,
    extractSection,
    readChangelog,
} = require("./changelog-version.cjs");

// Prefer a hand-written changelog section for the release notes. When
// CHANGELOG.md already contains a section for the version being released, use
// it verbatim as the release notes (GitHub Release body, release commit
// message). Otherwise fall back to the commit-derived notes from
// @semantic-release/release-notes-generator. This must replace, not sit beside,
// release-notes-generator in the plugin list: semantic-release concatenates the
// output of every generateNotes plugin.
async function generateNotes(pluginConfig = {}, context) {
    const version = context.nextRelease && context.nextRelease.version;
    const changelogFile = pluginConfig.changelogFile || DEFAULT_CHANGELOG_FILE;

    if (version) {
        const changelogPath = path.resolve(context.cwd, changelogFile);
        const content = await readChangelog(changelogPath);
        const section = extractSection(content, version);

        if (section) {
            context.logger.log(
                "Using prepared %s section for version %s",
                changelogFile,
                version,
            );
            return section;
        }
    }

    return notesGenerator.generateNotes(pluginConfig, context);
}

module.exports = {
    generateNotes,
};
