# @andreas-timm/skills

Local-first skill registry and approval CLI for agent skills.

This is a concept tool and research prototype, not a polished production registry. It indexes configured folders for `SKILL.md` files, records git provenance in SQLite, installs only approved skill artifacts, and supports full-text or embedding search.

## Motivation

Agent skills can teach an agent to use tools, run commands, write files, call APIs, and automate real workflows. Installing a third-party skill is therefore closer to adding a dependency than copying a prompt.

This project treats skills as versioned, reviewable software artifacts. The intended flow is: stage sources locally, run `skills update`, inspect exact versions, approve trusted locations, sources, or skill IDs, then install approved artifacts into a project or global agent profile.

## Compared with Vercel's `skills` CLI

[Vercel Labs' `skills`](https://github.com/vercel-labs/skills) ([skills.sh](https://skills.sh/)) makes the open skill ecosystem easy to browse and install directly from remote or local sources.

This tool takes a more conservative path:

- **Local intake:** skills are indexed from configured folders; remote sources should be staged first.
- **Approval gates:** locations, source snapshots, and exact artifacts can be approved before installation.
- **Deterministic identity:** each skill version is packaged as a deterministic ZIP and identified by its SHA-256 hash.
- **Local search:** full-text search works from the local SQLite catalog; embeddings add semantic search after `update --embed`.
- **Review signals:** approvals can carry status, rating, tags, and notes; `skills virustotal <skill_id>` can store VirusTotal analysis.

## Requirements

- [Bun](https://bun.sh)
- [`fd`](https://github.com/sharkdp/fd), used to scan for `SKILL.md`
- `git`, used to record remote, branch, commit, and date when available

## Install

```sh
bun add -g @andreas-timm/skills
```

## Quick Start

```sh
skills --help
skills location set main ~/data/skills
skills update
skills search "react"
skills show "SKILL_NAME"
```

By default, `skills install <skill_id>` writes to the current project's `.agents/skills/<skill_name>` folder. Use `--global`, `-g`, or an agent name such as `--global codex` for user-level installs.

## Core Concepts

- **Skill file:** the `SKILL.md` entrypoint.
- **Skill folder:** the folder containing `SKILL.md`.
- **Skill name:** the frontmatter `name` value.
- **Location:** a named configured root folder under `skills.locations`.
- **Source:** the nearest git repo under the location, otherwise the first top-level folder or the location name.
- **Bundle:** a planned grouping layer for related skills from a source; not implemented yet.

## Source Ignores

Each location can define source-specific ignore globs. The source key must match the indexed source display name: `owner/repo` for GitHub remotes, otherwise the source folder or location name.

```toml
[skills.locations.packages]
dir = "~/data/skills"

[skills.locations.packages.source."owner/repo"]
ignore = [
    "~/data/skills/repo/drafts/**",
    "~/data/skills/repo/tmp/**/SKILL.md",
]
```

During `skills update`, each discovered full path is matched against the inferred source's ignore list using Bun glob syntax. Matches are skipped before indexing.

## Skill References

Commands that accept `<skill_ref>` or `[skill_ref]` resolve references in this order:

1. Full deterministic ZIP SHA-256 `id`.
2. Stored `short_id`, when unambiguous.
3. `name@version`, using frontmatter `version` or a generated label such as `v3` or `3`.
4. `name`, resolving to the latest indexed version for that name.

`name@version` is a convenience lookup, not a secure artifact identity. Exact operations should use `<skill_id>`, either the full `id` or an unambiguous `short_id`. This shared resolution is used by `show <skill_ref>` and `versions [skill_ref]`.

```sh
skills zip <skill_id>
skills approve skill <skill_id>
```

`skills zip <skill_id>` also accepts a direct path to a skill folder. Indexed ZIPs are rebuilt and hash-checked before success is reported.

## Versions and Duplicates

`version` is the public version field: frontmatter `version` when present, otherwise a generated `v<version_order>` label. `version_order` is internal metadata used to sort versions, pick the latest version, and generate fallback labels.

`duplicate` is the count of extra indexed locations for the same concrete skill version. `skills versions [skill_ref] --all` shows every indexed occurrence, while `skills show [skill_ref]` shows the selected version's primary location plus duplicates.

## Approval Model

Approval has three scopes:

- **Location approval:** `approved = true` under `[skills.locations.<name>]`, or `skills location set <name> <dir> --approved`, supplies effective approval for skills under that location without writing per-row flags.
- **Source approval:** `skills approve source <source-id> --status approved` marks the current indexed source snapshot and its current skill rows as approved.
- **Skill approval:** `skills approve skill <skill_id> --status approved` marks one exact indexed artifact as approved.

`skills install <skill_id>` uses the effective approval check. Direct skill statuses such as `approved` or `ignore` win; location approval only fills in when the skill row has no direct status. Unapproved or ignored skills are blocked unless `--force` is passed.

## Update Pipeline

`skills update` runs an `extract -> transform -> load` ETL pipeline in [src/features/update](src/features/update):

- **Extract:** [extract.ts](src/features/update/extract.ts) runs `fd -g SKILL.md` under each configured location.
- **Transform:** [transform.ts](src/features/update/transform.ts) infers source, resolves cached git info, applies ignore globs, and parses frontmatter with [`gray-matter`](https://github.com/jonschlinkert/gray-matter).
- **Load:** [load.ts](src/features/update/load.ts) writes `sources` and `skills` in one deterministic transaction.

## Deterministic ZIPs

Skill IDs are based on a deterministic ZIP of each skill folder, implemented in [src/features/zip/deterministic-zip.ts](src/features/zip/deterministic-zip.ts), plus a SHA-256 hash of that archive.

Symlinks are resolved while packaging: entry names keep the symlink path, bytes come from the resolved target, symlinked directories are traversed under that path, and invalid targets are rejected.

This produces stable content identities without mutating source repositories.
