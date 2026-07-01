# [0.3.0](https://github.com/andreas-timm/skills/compare/0.2.0...0.3.0) (2026-06-30)

GPU-accelerated embedding search, broader skill discovery across agents and `node_modules`, and install tracking.

### Embedding search

* Embeddings run on the GPU by default — WebGPU for Apple M-series acceleration — with configurable `device` and `dtype`.
* The transformers backend is now an optional peer that is loaded lazily, so it is only required when embeddings are used.
* Existing embeddings are preserved across re-runs instead of being recomputed for unchanged skills.

### Skill discovery

* Skills are indexed from agent skill directories and from packages under `node_modules`, and can be installed from `node_modules`.
* Symlinked skill directories are followed, and globally symlinked skills are de-duplicated.
* Skill scanning uses a native directory walker instead of shelling out to `fd`.

### CLI

* New `installs` command, with installs recording where, when, and in which project they happened.
* Skill and search listings show a type emoji badge in a dedicated column.

### Tooling

* Release artifacts are GPG-signed and the changelog/release tooling is more reliable.

# [0.2.0](https://github.com/andreas-timm/skills/compare/0.1.4...0.2.0) (2026-05-03)


### Features

* add description to global command ([e473f7a](https://github.com/andreas-timm/skills/commit/e473f7adce4b587b59e571ad1c1cf27fbfaa171c))
* register install commands in CLI ([51686d1](https://github.com/andreas-timm/skills/commit/51686d1af0566fef15a6f719e951205715da3220))
