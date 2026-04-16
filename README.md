# @andreas-timm/skills

Local-first skill registry and approval CLI for agent skills.

This is a concept tool and research prototype. It presents a local-first, approval-based model for managing agent skills; it is not yet a polished production package or a complete registry implementation.

The CLI scans configured folders for `SKILL.md` files, parses their frontmatter, captures git info for each containing repo, and writes the result to a SQLite database. The default `search` command uses full-text search over skill names and descriptions, while `search -e` (`--embed`) uses semantic embeddings after `update --embed`.

## Compared with Vercel's `skills` CLI

[Vercel Labs' `skills`](https://github.com/vercel-labs/skills) ([skills.sh](https://skills.sh/)) make the open agent skills ecosystem easy to browse and install. Their core path is direct installation, for example `npx skills add <owner/repo>`, from GitHub, GitLab, arbitrary git URLs, or local paths into many agent-specific skill folders.

**Key differences:**

- **Quarantined local intake.** Unlike Vercel's direct `npx skills add <owner/repo>` install path, this tool installs from indexed local artifacts only. Internet sources are expected to be cloned, mirrored, reviewed, or scanned into quarantine first.
- **Locations.** Skills are indexed from configured local scan roots rather than installed directly from remote repositories.
  - `location`: the configured scan folder.
  - `source`: the closest git repository root, otherwise the first top-level folder under the location.
  - `bundle`: a planned grouping layer for related skills from a source; not implemented yet.
  - Tags are stored and surfaced in list/query paths, but higher-level tag workflows are still incomplete.
- **Approval before use.** Locations can be trusted in config, sources can be approved as indexed snapshots, and individual skill artifacts can be approved by ID. `skills install` blocks unapproved or ignored skills unless forced.
- **Versioning.** Content identity and display version are separate.
  - Primary identity is the SHA-256 hash of a deterministic ZIP archive, compatible with VirusTotal's file-hash model.
  - If frontmatter has `version`, that original version is displayed.
  - If frontmatter has no version, generated virtual versions such as `v3` are displayed.
- **VirusTotal checks.** `skills virustotal <skill_id>` uploads the deterministic skill ZIP, waits for analysis, and stores the report on the indexed skill row when possible.
- **Embedded local search.** The default search uses SQLite full-text search over indexed names and descriptions. After `update --embed`, `search --embed` can run semantic search over indexed skill chunks.
- **Review metadata.** Approval records can carry status, rating, tags, and notes.

## Install

```sh
bun add -g @andreas-timm/skills
```

The published package installs the `skills` CLI. It runs on Bun and expects `bun`, `fd`, and `git` to be available on `$PATH`.

For npm-based global installations, Bun is still required because the executable uses a Bun shebang:

```sh
npm install -g @andreas-timm/skills
```

## Usage

```sh
skills --help
skills location set packages ~/data/skills
skills update
skills search "react"
skills show "SKILL_NAME"
```

## Motivation

Agent skills are becoming a real supply chain.

A skill is not just a README or a prompt. It can teach an agent how to use tools, run commands, read and write files, call APIs, and automate real workflows. Installing a third-party skill is therefore closer to adding a dependency to an automation environment than copying a snippet of documentation.

The public skill ecosystem is growing quickly: repositories, marketplaces, search engines, aggregators, and skill managers are making skills easier to discover and install. That is useful, but discovery is not trust. An agent should not install and use arbitrary skills from the internet just because they were easy to find.

This project is a local-first skill bank for a zero-trust workflow.

The goal is to collect skills from trusted local repositories and selected external sources after they have been staged locally, index them, make them searchable, inspect their provenance, approve exact versions, and then install only the approved skills into a project or global agent profile.

The current implementation scans configured local folders for `SKILL.md` files, stores structured metadata in SQLite, captures git provenance, computes deterministic ZIP-based skill IDs, keeps a text index for fast name/description lookup, can refresh semantic embeddings for vector search, supports approval metadata, gates installation on approval, and can upload skill archives to VirusTotal. The broader direction is to turn that index into a fuller control plane for skill review, bundle management, tag workflows, version promotion, and installation.

The design is guided by a few principles:

- **Local-first catalog.** Keep a searchable local inventory of skills collected from private repositories and quarantined clones or mirrors of selected external sources. Remote APIs and public aggregators can be added later, but the initial trust boundary is local.
- **Search before installation.** Index metadata, descriptions, source paths, repository state, full-text search data, and embeddings so humans or agents can discover relevant skills without blindly installing them.
- **Explicit approval.** A third-party skill should not become usable merely because it exists in the catalog. A specific skill version should have a reviewable approval state before it can be installed.
- **Version skills even when upstream does not.** Skills often change without formal releases. The tool should track content versions, source commits when available, and local history so installed skills can be compared against the catalog.
- **Install into the right scope.** A skill may be installed into the current project, for example `.agents/skills`, or into a global/profile-level agent configuration. The tool should show what is installed where and which installed skills have newer approved versions available.
- **Deterministic identity.** A concrete skill version has a stable fingerprint: deterministic packaging of the skill directory into a ZIP and a SHA-256 content hash for that package.
- **Defense in depth.** Hashes, provenance, local approvals, and optional malware or threat-intelligence checks are signals, not guarantees. The point is to make trust decisions explicit, auditable, and repeatable.

[OpenClaw’s ClawHub security model](https://openclaw.ai/blog/virustotal-partnership) is a useful reference point: published skills are described as deterministically packaged, SHA-256 hashed, checked against VirusTotal, and uploaded for fresh analysis when needed. This project aims to make local skill identifiers compatible with that kind of ecosystem-level fingerprinting where possible, while still preserving a local approval workflow.

In short: this tool is not just a skill search CLI. It is the beginning of a local skill registry for agents—one that treats skills as powerful, versioned, reviewable software artifacts rather than things to install on trust.

## Requirements

- [Bun](https://bun.sh)
- [`fd`](https://github.com/sharkdp/fd) on `$PATH` (used to scan for `SKILL.md`)
- `git` (used when a source is a git repository: remote / branch / commit / date)

## Terminology

- **Skill entrypoint / skill file**: the `SKILL.md` file.
- **Skill folder**: the folder that contains the skill file (`SKILL.md`).
- **Skill name**: the value defined in the `name` key in the skill file frontmatter.
- **Location**: a named map entry in `skills.locations`; each location points to a root folder where skills are searched recursively. A location can be used as a quarantine or staging folder.
- **Source**:
  - first, the closest git repository root found while walking up from the skill folder, but not above the location root;
  - if no git repository is found, the top-level parent folder for the skill under the location root;
  - if that top-level folder is the skill folder itself, use the location name.
- **Bundle**: a planned grouping layer for related skills from a source; not implemented yet.

## Location Source Ignores

Each location can define a `source` object. Its keys are source names, and each source entry can define `ignore` as a list of string patterns. The source key must match the indexed source display name: `owner/repo` for GitHub remotes, otherwise the source folder name, or the location name when the source is the location itself.

```toml
[skills.locations.packages]
dir = "~/data/skills"

[skills.locations.packages.source."owner/repo"]
ignore = [
    "~/data/skills/repo/drafts/**",
    "~/data/skills/repo/tmp/**/SKILL.md",
]
```

During `skills update`, each discovered `SKILL.md` full path is matched against the `ignore` list for its inferred source using Bun glob syntax. Matching skills are skipped before frontmatter parsing and indexing.

## Skill Identification

Commands that accept `<skill_ref>` or `[skill_ref]` resolve skill references in this order:

1. `id` — the full SHA-256 hash of the deterministic ZIP archive for the skill folder.
2. `short_id` — the stored short hash prefix of `id`.
3. `name@version` — the skill frontmatter `name` plus either the frontmatter `version` value or a generated version label such as `v3` / `3`.
4. `name` — the latest indexed version for that skill name.

`name@version` is only a convenience lookup. It is not safe for operations that require an exact artifact identity because frontmatter names and versions are not guaranteed to be unique, can change independently of the content, and may not stay consistent with the generated skill `id`.

This shared logic is used by `show <skill_ref>` and `versions [skill_ref]`. For `versions [skill_ref]`, the resolved skill identifies the skill name whose versions are listed; omitting `[skill_ref]` lists all indexed versions.

If `show <skill_ref>` does not find a matching indexed database row, it falls back to the local installed skills inventory shown by `skills ls` for the current directory.

Commands that operate on an exact skill artifact use `<skill_id>`: `zip <skill_id>` and `approve skill <skill_id>`. `<skill_id>` means either the full `id` or the stored `short_id` when it is unambiguous.

The `zip <skill_id>` command also accepts a direct filesystem path to a skill folder. Direct paths are resolved before indexed skill references.
When `zip <skill_id>` resolves through the index, it rebuilds the deterministic ZIP and verifies that the created archive's SHA-256 still matches the indexed skill id before reporting success.

## Skill Versions

`version` is the public version field. It is always either the skill frontmatter `version` value or, when frontmatter has no version, a generated `v<version_order>` label.

`version_order` is internal metadata. It is used to sort versions for a skill name, pick the latest version, and generate the fallback public version label when frontmatter `version` is missing.

Commands that output skills should show `version`, not `version_order`. Commands that accept `name@version` as a convenience lookup first resolve explicit frontmatter versions; generated labels such as `name@v3` or `name@3` only match rows whose frontmatter version is missing.

## Skill Duplicates

`duplicate` is the count of extra indexed locations for the same concrete skill version. The first indexed location is the version's primary provenance, so a version that appears once has `duplicate = 0`; a version that appears in three source paths has `duplicate = 2`.

`skills versions [skill_ref] --all` still shows every indexed occurrence for each version, including the primary provenance location. The `duplicate` value is only the count column.

`skills show [skill_ref]` shows the selected version's primary `subpath` next to its `location` and `source`. It uses `duplicates` for additional indexed locations of that same selected version, and every duplicate row reports that occurrence's `location`, `source`, `subpath`, and source `date`.

## Approval model

Approval has three scopes: location, source, and skill. The scopes are intentionally different because they answer different trust questions.

- **Location approval** is configured, not stored per row. Set `approved = true` on a `[skills.locations.<name>]` entry, or use `skills location set <name> <dir> --approved`. Every skill occurrence under that named location is then treated as approved by read paths such as `skills --json`, `versions`, and `show`, but no `approved` flag is written to the `skills` or `sources` rows merely because the location is trusted.
- **Source approval** is a snapshot decision over the current indexed contents of a source. Running `skills approve source <source-id> --status approved` writes `approved = 'approved'` to the source row and also writes `approved = 'approved'` to every skill row that currently occurs in that source. New skill versions discovered later are separate skill rows and must be approved separately or through a later source approval.
- **Skill approval** is the narrowest approval. Running `skills approve skill <skill_id> --status approved` writes `approved = 'approved'` to the exact skill row identified by that content ID in the SQLite database.

When a skill has a direct database status such as `approved` or `ignore`, that direct skill status is shown first. Location approval only supplies an effective `approved` status when the skill row itself has no direct status.

`skills install <skill_id>` uses the same effective approval check. Unapproved or ignored skills are not installed by default; pass `--force` to install one anyway.

By default, `skills install` writes to the current project's `.agents/skills/<skill_name>` folder. Pass `--global` or `-g` to install to `~/.agents/skills/<skill_name>`, or pass a user agent name such as `--global codex` to install to that agent's user-level skills folder. Supported names are `default`, `codex`, `claude`, `gemini`, `antigravity`, `pi`, and `openode`.

## Pipeline

`extract → transform → load`, wired via an [RxJS](https://rxjs.dev) ETL pipeline in [src/features/update](src/features/update).

- **extract** ([extract.ts](src/features/update/extract.ts)) — runs `fd -g SKILL.md` under each configured location root and emits one `RawSkill` per match (location name, root path, file path).
- **transform** ([transform.ts](src/features/update/transform.ts)) — infers a source (git root walking upward within the location, else top-level folder under the location), resolves git info for git-backed sources (cached), applies any configured per-source full-path ignore globs, then reads each remaining file, and parses frontmatter with [`gray-matter`](https://github.com/jonschlinkert/gray-matter). If `gray-matter` throws, a regex-based fallback parser runs and the row is flagged `fallback = 1`. Skills without a `name` field are dropped.
- **load** ([load.ts](src/features/update/load.ts)) — collects the stream and writes `sources` and `skills` in a single transaction (clear-then-insert, sorted by key for deterministic output).

## Deterministic ZIP symlink behavior

Skill identities are based on a deterministic ZIP of each skill folder (`src/features/zip/deterministic-zip.ts`) and a SHA-256 hash of that archive.

When a file in the skill folder is a symlink, bundling resolves it on the fly:

- The ZIP entry name stays the symlink path (stable archive structure).
- The file bytes come from the resolved target.
- Symlink targets may be inside or outside the skill root.
- Symlinked directories are traversed under the symlink path.
- Symlink targets that are neither files nor directories are rejected.

This preserves deterministic identities without mutating files in the source repositories.
