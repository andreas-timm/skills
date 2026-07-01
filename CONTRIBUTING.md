# Contributing

## Update db

`skills update` runs an `extract -> transform -> load` ETL pipeline in [src/features/update](src/features/update):

- **Extract:** [extract.ts](src/features/update/extract.ts) runs `fd -g SKILL.md` under each configured location.
- **Transform:** [transform.ts](src/features/update/transform.ts) infers source, resolves cached git info, applies ignore globs, and parses frontmatter with [`gray-matter`](https://github.com/jonschlinkert/gray-matter).
- **Load:** [load.ts](src/features/update/load.ts) writes `sources` and `skills` in one deterministic transaction.
