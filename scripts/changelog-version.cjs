const fs = require("fs/promises");
const path = require("path");

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

async function changelogHasVersion({ changelogFile = DEFAULT_CHANGELOG_FILE, cwd, version }) {
    const changelogPath = path.resolve(cwd, changelogFile);
    const content = await readChangelog(changelogPath);

    return {
        changelogPath,
        exists: hasVersionSection(content, version),
    };
}

function extractSection(content, version) {
    const escapedVersion = escapeRegExp(version);
    const headingRegex = new RegExp(
        `^#{1,6}\\s+(?:\\[[vV]?${escapedVersion}\\](?:\\([^\\n)]*\\))?|[vV]?${escapedVersion})(?:\\s|$)`,
        "m",
    );

    const match = headingRegex.exec(content);
    if (!match) {
        return null;
    }

    const start = match.index;
    const nextHeadingRegex =
        /^#{1,6}\s+(?:\[[vV]?\d+\.\d+\.\d+[^\]\n]*\](?:\([^\n)]*\))?|[vV]?\d+\.\d+\.\d+)(?:\s|$)/gm;
    nextHeadingRegex.lastIndex = start + match[0].length;

    const next = nextHeadingRegex.exec(content);
    const end = next ? next.index : content.length;

    const section = content.slice(start, end).trim();
    return section || null;
}

module.exports = {
    DEFAULT_CHANGELOG_FILE,
    changelogHasVersion,
    extractSection,
    hasVersionSection,
    readChangelog,
};
