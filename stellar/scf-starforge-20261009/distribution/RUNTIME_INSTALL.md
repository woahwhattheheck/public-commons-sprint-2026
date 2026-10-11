# Customer runtime installation and recovery

Install one original Starforge merchant archive with the native dependencies selected from that archive's own declarations. The installer retains the original package at `DIRECTORY/package/`, places the selected dependency tree at `DIRECTORY/node_modules/`, and returns both absolute roots for the original host, container, and release workflows.

Each installation occupies a new private directory. An upgrade prepares a second directory and preserves the previous one for the existing deployment workflow's rollback.

## Requirements and command entry

Use Linux with Node.js 22.16 or newer, Python 3.11 or newer, npm, and the `flock` command from util-linux. A selected original dependency manifest can require a newer Node version; the resolved profile records the effective requirement. The parent directory must already exist at its real absolute path. The installer creates its child directory with mode `0700` for the current operator.

Run the maintained toolkit's `starforge runtime-install` command. The equivalent direct source entry is:

```sh
node /absolute/maintained/source/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs --help
```

The maintained installer can consume an earlier original archive. Its runtime selection comes from that selected archive's source, even when the installer itself comes from a newer toolkit. Use the maintained command for subsequent installation and recovery operations; `run` dispatches into the selected archive's own original CLI.

## Prepare, install, and run

Choose a new directory and supply the original archive together with its complete SHA-256 digest:

```sh
starforge runtime-install prepare \
  --dir /srv/starforge/runtimes/merchant-01 \
  --archive /srv/starforge/downloads/original-merchant.tgz \
  --sha256 REPLACE_WITH_ORIGINAL_ARCHIVE_SHA256 \
  --operator

starforge runtime-install install --dir /srv/starforge/runtimes/merchant-01

starforge runtime-install inspect \
  --dir /srv/starforge/runtimes/merchant-01 --load --source

starforge runtime-install run \
  --dir /srv/starforge/runtimes/merchant-01 -- source
```

Preparation verifies the archive digest, original manifest, original package metadata, and every declared source file before selecting the runtime profile. The original source paths and package bytes are retained. The preparation result includes the source commit, package version, profile identity, selected dependencies, entrypoint, `sourceRoot`, and `dependencyRoot`.

Installation uses npm's configured registry and cache. It extracts the generated exact dependency selection with lifecycle scripts disabled, writes a dependency lock, and checks that the selected package versions resolve and import from the original source locations. A selected dependency with an explicit native preparation declaration then runs its supported original install hook under the same installation lock. Readiness includes an actual operation of that native binding. A populated npm cache can be used explicitly:

```sh
starforge runtime-install install \
  --dir /srv/starforge/runtimes/merchant-01 \
  --offline --cache /srv/starforge/npm-cache
```

The first installation uses `npm install`. A retained lock selects `npm ci` for a subsequent installation attempt. Both explicitly select local project mode, disable workspaces, and set the prefix to this runtime directory, so inherited global, location, workspace, or prefix configuration cannot redirect installation. They also use `--ignore-scripts`, `--no-audit`, `--no-fund`, `--legacy-peer-deps`, a hoisted dependency layout, and omission of development dependencies. The exact selected top-level versions live in the profile; the resulting lock retains the resolved transitive dependency tree.

Once the installation is `READY`, original commands can create and operate a merchant workspace outside the runtime directory:

```sh
starforge runtime-install run \
  --dir /srv/starforge/runtimes/merchant-01 -- \
  init --dir /srv/starforge/workspaces/merchant --template application

starforge runtime-install run \
  --dir /srv/starforge/runtimes/merchant-01 -- \
  run --workspace /srv/starforge/workspaces/merchant --operations-port 8081
```

The original workspace launcher owns merchant behavior and its configuration. Its default launch serves challenge-only requests. Pass the original facilitator and operator options when configuring native payment operation. `run` forwards arguments as an argument array and forwards shutdown signals to the original command.

## Select dependencies from the original release

Preparation without `--native` or `--feature` selects the base profile. `--native` includes the original native payment peers. Repeat `--feature NAME` for the original optional adapter groups required by the merchant. `--operator` records the Linux, Python, and `flock` host requirements in the profile.

For example, a new native PostgreSQL runtime can be prepared with:

```sh
starforge runtime-install prepare \
  --dir /srv/starforge/runtimes/merchant-postgres-01 \
  --archive /srv/starforge/downloads/original-merchant.tgz \
  --sha256 REPLACE_WITH_ORIGINAL_ARCHIVE_SHA256 \
  --native --feature postgres --operator
```

Use the companion `runtime-profile catalog --source-root ABSOLUTE_ORIGINAL_SOURCE_ROOT` command to inspect the groups declared by a selected source tree. [RUNTIME.md](RUNTIME.md) describes profile resolution, source identity, package probes, and compatible explicit pins.

An original exact declaration keeps that exact version. For an original supported range, the resolver records the requested range and selects its declared compatible baseline unless an explicit compatible pin is supplied. `--pins FILE.json` accepts an object mapping package names to exact versions, for example:

```json
{
  "@stellar/stellar-sdk": "16.3.1"
}
```

The resolver checks an explicit pin against every selected declaration for that package. It rejects an incompatible version or a pin for an unselected dependency. Import and native operation failures remain visible in inspection and must be resolved in the selected runtime before it becomes `READY`.

## Native SQLite preparation and restart

The optional `node-agents` feature comes from the original [Node agent runtime manifest](../sf88-operator-buyer-cli/node/examples/agents/runtime-package.json). Its `better-sqlite3` dependency is explicitly marked `native: "sqlite"` in the maintained distribution. The runtime profile retains that declaration and exact version. Ordinary feature selection does not execute other packages' lifecycle scripts.

```sh
starforge runtime-install prepare \
  --dir /srv/starforge/runtimes/node-agents-01 \
  --archive /srv/starforge/downloads/original-merchant.tgz \
  --sha256 REPLACE_WITH_ORIGINAL_ARCHIVE_SHA256 \
  --feature node-agents --operator

starforge runtime-install install --dir /srv/starforge/runtimes/node-agents-01
starforge runtime-install inspect --dir /srv/starforge/runtimes/node-agents-01 --load
starforge runtime-install run --dir /srv/starforge/runtimes/node-agents-01 -- buyer-agent --help
```

After the initial script-free npm install, the installer records the resolved dependency lock before native preparation. It checks the selected package's identity, exact version, original install hook and local installation path, then runs `npm rebuild better-sqlite3@EXACT_VERSION` with lifecycle execution enabled for that declared package. The generated package also carries its explicit npm lifecycle allowance. All npm operations keep the original private project scope and retained flock descriptor.

The package's own hook selects a matching prebuilt binary or builds its bundled SQLite source with node-gyp. A source build needs Python, make and a C/C++ compiler; the existing installation log records their actual outcome. Native preparation leaves the dependency lock unchanged. The isolated readiness child opens SQLite, performs a transaction and read, obtains the SQLite version and closes the database. It records Node version, native module ABI, platform and architecture. This check also runs when `--load` is omitted; that option controls the other selected import probes. It uses an in-memory database and leaves customer stores outside the runtime untouched.

A failed or interrupted native preparation retains `dependencyInstall`, `stage`, `nativePreparation` and the current log in `install-state.json`. Resume the same original directory:

```sh
starforge runtime-install resume --dir /srv/starforge/runtimes/node-agents-01
```

When the retained profile, lock and dependency imports still match, resume continues the native stage without running npm ci over that tree. If the binding already works, it adopts the completed attempt. A surviving npm child retains the original kernel lock until that child exits, so an interrupted parent cannot create a second writer.

### Offline source preparation

The prebuild downloader used by better-sqlite3 does not implement npm's offline mode. For an offline native build, the installer invokes the package's original `build-release` command directly and gives node-gyp verified local Node headers as explicit arguments. It validates that source command and its lifecycle hooks along with the package identity. The prebuild downloader is not invoked, so its configuration cannot override offline source preparation. A header prefix must contain `include/node/node_version.h`, `config.gypi`, `common.gypi`, `node.h` and `node_api.h`. The version and module ABI must match the Node executable running this installation.

```sh
starforge runtime-install resume \
  --dir /srv/starforge/runtimes/node-agents-01 \
  --offline --cache /srv/starforge/npm-cache \
  --node-headers /srv/toolchains/node-24.19.0
```

The installer also checks the running Node prefix and the usual local node-gyp header caches when no prefix is supplied. Missing or mismatched headers leave a concrete native preparation error and the resolved dependency tree for the same resume command. An already working binding passes its native check without a rebuild. `--node-headers` can also select a matching local source build for an online install, upgrade or recovery.

A completed runtime is checked again before an original command is launched. If the Node ABI, installed binding, selected source or lock changes, use the original fresh-directory `recover` workflow. The new directory installs the same transitive lock and prepares its binding for the current host; the previous runtime remains available to the original activation and rollback workflow.

For the complete customer checkpoint, purchase recovery and tool workflow, continue with [NODE_AGENTS.md](NODE_AGENTS.md). The original engine and framework integration are in [PR1201](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1201); installed aliases and feature selection are in [PR1246](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1246).

Native preparation uses the documented [npm rebuild lifecycle and exact package selector](https://docs.npmjs.com/cli/v11/commands/npm-rebuild/), the package's [prebuild source-mode option](https://github.com/prebuild/prebuild-install#help) and [node-gyp local header support](https://github.com/nodejs/node-gyp#command-options).

## Retained installation files

| Path under the runtime directory | Purpose |
| --- | --- |
| `source.tgz` | The retained original archive, checked against the supplied SHA-256 digest. |
| `preparation.json` | Original archive identity, original input path, selected options, and Python executable, retained before extraction. |
| `package/manifest.json` | The original release's source and package-file manifest. |
| `package/package.json` | The original toolkit package metadata. |
| `package/source/` | The original source tree, including its retained repository-relative paths. |
| `runtime-profile.json` | Exact selection, declared constraints, source-input hashes, host requirements, and profile identity. |
| `package.json` | The generated dependency package for this runtime selection. |
| `node_modules/` | Installed dependencies resolved through the ancestors of the original source files. |
| `package-lock.json` | Resolved dependency lock; its digest is retained when the installation becomes ready. |
| `runtime-install.json` | Archive, profile, directory, original entrypoint, and source/dependency root identities. |
| `install-state.json` | Current installation phase/stage, attempts, completed dependency lock, native preparation, selected npm operation, log path, and completed lock digest. |
| `install-N-UUID.log` | A private log for one npm attempt, with a distinct filename for interruption recovery. |
| `RUNBOOK.md` | Installation-specific source identity, paths, and operating commands. |

The original package directory remains separate from npm's dependency target. A source under `DIRECTORY/package/source/` naturally resolves shared dependencies from `DIRECTORY/node_modules/`.

## Observe and resume an interrupted installation

`inspect` returns the recorded phase and current readiness report. `--load` imports the selected package entrypoints; `--source` checks the complete retained original package against the original archive and manifest. Without `--source`, inspection still verifies the installation plan, profile identity, selected source declarations, package versions, and dependency-lock identity.

| Recorded phase | Meaning and operation |
| --- | --- |
| `PREPARED` | Original archive and profile are ready for `install`. |
| `INSTALLING` | An npm attempt was started; `resume` checks the live installation before choosing another attempt. |
| `FAILED` | The retained attempt needs inspection or resumption; its log and error remain available. |
| `READY` | The completed installation has a recorded lock and matched selected runtime. `install` can reopen it after inspection. |

Resume a prepared or interrupted installation in its existing directory:

```sh
starforge runtime-install resume \
  --dir /srv/starforge/runtimes/merchant-01 --offline \
  --cache /srv/starforge/npm-cache
```

`resume` uses the same operation as `install`. If an interrupted attempt already left matching dependencies, successful imports, and a dependency lock, the installer records that existing completion and returns `recoveredExistingInstall: true`. It keeps the original attempt count and avoids another npm invocation.

The installer uses a retained Linux kernel file lock. The npm child inherits that lock, so a still-running npm process continues to exclude another writer if its parent disappears. A concurrent installer returns `RUNTIME_INSTALL_ALREADY_RUNNING` and CLI exit code `75`. Leave the lock file in place and resume after the active process finishes. Other CLI failures return `1`; successful commands return `0`. An inspection whose readiness result is false also returns `1`.

If a previously ready runtime's dependency tree or recorded lock changes, recover it into a new directory. This preserves the previous runtime path for the original deployment workflow.

## Upgrade and recover into a new directory

Upgrade supplies a new original archive and digest. Unspecified native, feature, operator, and explicit-pin selections are inherited from the previous runtime and resolved against the new archive's declarations:

```sh
starforge runtime-install upgrade \
  --from /srv/starforge/runtimes/merchant-01 \
  --dir /srv/starforge/runtimes/merchant-02 \
  --archive /srv/starforge/downloads/original-merchant-new.tgz \
  --sha256 REPLACE_WITH_NEW_ORIGINAL_ARCHIVE_SHA256

starforge runtime-install compare \
  --before /srv/starforge/runtimes/merchant-01 \
  --after /srv/starforge/runtimes/merchant-02
```

The comparison reports source and profile identities plus added, removed, or changed dependency versions. An exact recovery preserves the original selection and archive:

```sh
starforge runtime-install recover \
  --from /srv/starforge/runtimes/merchant-01 \
  --dir /srv/starforge/runtimes/merchant-recovered-01 \
  --offline --cache /srv/starforge/npm-cache
```

When the previous complete plan has the same source and profile, recovery carries its dependency lock into the new directory and installs with `npm ci`. A ready source runtime must still match its recorded lock before that lock is carried forward.

The same `recover` command also handles interruption during archive copying, extraction, or later preparation. It reads the retained `preparation.json` options, checks the retained archive's digest, and prepares the original source again in the new directory. If copying the archive was itself interrupted, recovery uses the explicitly retained original input path with the same expected digest. Keep that original input available until preparation has finished. The recovery result includes `recoveredPreparation: true` when this path was used. The selected Python executable is retained and reused.

### Hand the runtime to the existing deployment workflow

Use the returned absolute `sourceRoot` and `dependencyRoot` together when preparing the original host, container, or SF46 release workflow. A runtime at `/srv/starforge/runtimes/merchant-02` has:

| Deployment input | Value |
| --- | --- |
| `sourceRoot` | `/srv/starforge/runtimes/merchant-02/package/source` |
| `dependencyRoot` | `/srv/starforge/runtimes/merchant-02` |
| Original CLI entrypoint | `/srv/starforge/runtimes/merchant-02/package/source/stellar/scf-starforge-20261009/distribution/cli.mjs` |

For a container using bind mounts, retain both absolute paths and mount the selected dependency root as required by the original container plan. For a source-baked image, the image producer maps the original source input hashes into its selected image paths. The original deployment component owns activation, shutdown, readiness observation, previous selection, and rollback; select the new runtime through that existing workflow.

## Programmatic API

Import `./runtime-install.mjs`, or the maintained package export `@tokenjunkielabs/starforge-merchant/runtime-install`:

| Export | Operation |
| --- | --- |
| `prepareRuntimeInstall({directory, archive, sha256, native, features, pins, operator, python})` | Retain and verify one original archive, resolve its exact profile, and prepare a new directory. |
| `installRuntime({directory, offline, cache, npm})` | Install, resume, or reopen a ready runtime under the kernel lease. |
| `inspectRuntimeInstall({directory, load, source, python})` | Read the retained plan and inspect dependencies, lock, and optionally the complete original source. |
| `upgradeRuntime({from, directory, archive, sha256, native, features, pins, operator, python, offline, cache, npm, install})` | Prepare and optionally install a new source/profile selection, with a comparison to the previous runtime. |
| `recoverRuntime({from, directory, python, offline, cache, npm, install})` | Recover either a complete installation or interrupted preparation into a fresh directory. |
| `compareRuntimeInstalls({before, after})` | Compare exact source/profile identities and dependency versions. |
| `runtimeCommand({directory, args})` | Check the selected ready runtime and return the original executable, argument array, working directory, and roots. |
| `launchRuntime({directory, args})` | Invoke that original command with inherited terminal streams and shutdown-signal forwarding. |

`upgradeRuntime` and `recoverRuntime` install by default. Use `install: false` to prepare the new directory for a separate controlled installation step. The programmatic upgrade API accepts explicit `native: false`, `operator: false`, `features: []`, or `pins: {}` when removing an inherited selection. Omitted selection fields preserve the original values. A custom Python executable supplied during preparation is stored for future inspection, upgrade, and recovery.
