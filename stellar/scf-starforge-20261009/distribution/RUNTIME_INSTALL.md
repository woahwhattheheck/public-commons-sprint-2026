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

Installation uses npm's configured registry and cache. It installs the generated exact dependency selection with lifecycle scripts disabled, writes a dependency lock, and checks that the selected package versions can be resolved and imported from the original source locations. A populated npm cache can be used explicitly:

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

The resolver checks an explicit pin against every selected declaration for that package. It rejects an incompatible version or a pin for an unselected dependency. Native module import failures remain visible in inspection and must be resolved in the selected runtime before it becomes `READY`.

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
| `install-state.json` | Current installation phase, attempts, selected npm operation, log path, and completed lock digest. |
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
