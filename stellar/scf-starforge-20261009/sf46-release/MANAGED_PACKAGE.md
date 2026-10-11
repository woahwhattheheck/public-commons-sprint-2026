# Managed merchant package installation

Install a maintained `@tokenjunkielabs/starforge-merchant` package into the
original SF46 versioned home. Each release keeps the package's original
`source/` tree, `package.json`, `manifest.json`, README and license. The existing
installer supplies staging, active and previous release selection, a stable
`forge.mjs` entry point, and separate merchant configuration and state.

Use Node 22.16 or later and a local filesystem on one host. The original
installation uses atomic rename and hard links for its update records.

## Select the package directory

The input is the directory containing the maintained package's `package.json`,
`manifest.json` and `source/`. For an existing local npm installation this is
`node_modules/@tokenjunkielabs/starforge-merchant`. A `.tgz` delivery can also be
extracted into a new directory using the host's ordinary archive tools; npm
archives contain that same directory under `package/`.

The installed command is:

```sh
npx --no-install starforge installation --help
```

From a current source checkout, the same command can run directly. This also
allows a retained earlier package to enter the managed installation:

```sh
node stellar/scf-starforge-20261009/sf46-release/package-cli.mjs --help
```

The examples below use the installed alias. Substitute the direct Node command
when working from source. Choose absolute paths for the package and private home:

```sh
STARFORGE_PACKAGE_DIR=/absolute/path/to/package
STARFORGE_INSTALLATION=/absolute/private/starforge

npx --no-install starforge installation inspect "$STARFORGE_PACKAGE_DIR"
```

Inspection reports the original package name and version, source commit,
`sourceManifestSha256`, source count and bytes, mapped native commands, runtime
declarations and separate dependency entries. Every original manifest entry is
checked against its declared bytes, SHA-256 and Git blob identity. Root package
files and their metadata are checked against the same source declarations.

When the delivery supplies its manifest SHA-256, pass that exact value:

```sh
npx --no-install starforge installation inspect "$STARFORGE_PACKAGE_DIR" \
  --expect-manifest PUBLISHED_MANIFEST_SHA256
```

`--expect-manifest` refers to the exact bytes of the package's `manifest.json`.
The archive checksum identifies the `.tgz` file; the prepared SF46 `digest`
identifies the installed release. Each value keeps its own file and purpose.

## Install and reopen the managed home

```sh
npx --no-install starforge installation install "$STARFORGE_PACKAGE_DIR" \
  --home "$STARFORGE_INSTALLATION" \
  --expect-manifest PUBLISHED_MANIFEST_SHA256

npx --no-install starforge installation status --home "$STARFORGE_INSTALLATION"
```

Omit `--expect-manifest` when inspecting and installing without an externally
supplied manifest comparison. The first installation needs a new or empty home,
outside the original package directory, and becomes active automatically.

The install result includes the original install `state`, `releaseId`, release
`digest`, `activeReleaseId`, `staged`, `releaseDirectory`, configuration and state
paths, plus the package version, source commit and original manifest hash. The
manager prepares a temporary complete release, passes its exact digest to the
original installer, then removes only its own temporary directory.

The stable entry point is stored in the home. It works in a new terminal without
the command's original npm application or source checkout:

```sh
node "$STARFORGE_INSTALLATION/forge.mjs" status
```

| Home path | Purpose |
| --- | --- |
| `forge.mjs`, `release-core.mjs` | Original installed manager |
| `installation.json`, `active.json` | Home identity and active/previous release selection |
| `releases/RELEASE_ID/` | Complete versioned package and SF46 release manifest |
| `config/` | Operator configuration retained across code upgrades |
| `state/` | Merchant workspaces, journals and retained operational files |

The installed package still contains its original `package.json` export and bin
paths. Imports beneath `source/` resolve through the same directory structure.
The package's existing `node_modules/` and `package-lock.json`, when present in
the input, remain separate dependency state; prepare copies the original
manifested source into the release.

## Start the original merchant workspace

The `starforge` native command runs the original toolkit, including its
workspace `init`, `run` and `source` commands. Keep the merchant workspace inside
the home's retained configuration directory:

```sh
node "$STARFORGE_INSTALLATION/forge.mjs" run starforge -- init \
  --dir "$STARFORGE_INSTALLATION/config/merchant" --template dataset

node "$STARFORGE_INSTALLATION/forge.mjs" run starforge -- run \
  --workspace "$STARFORGE_INSTALLATION/config/merchant" -- --port 0
```

The original seller and operations launcher print their actual addresses. Open
the operations address for the merchant dashboard. The dataset starter uses the
maintained example configuration; its `/dataset` request returns the original
HTTP 402 challenge until the native payment runtime and merchant terms are
configured. Edit the workspace's existing `seller.json` and dataset through the
normal merchant workflow. Ctrl-C reaches the running command's shutdown path.

The first `--` belongs to the installation manager. The second `--` in the
workspace launch belongs to the original toolkit and forwards seller options.
Arguments keep their original boundaries and the caller's working directory.
Absolute configuration and state paths work across operator terminals.

Every mapped native command remains available directly:

```sh
npx --no-install starforge installation run buyer --home "$STARFORGE_INSTALLATION" -- --help
node "$STARFORGE_INSTALLATION/forge.mjs" run operations -- --help
node "$STARFORGE_INSTALLATION/forge.mjs" run starforge -- source
```

`status.commands` is the exact installed map. `status.commandCatalog` identifies
the maintained catalog and the original SF46 compatibility aliases.

## Stage an upgrade, activate it and roll back

Retain the next supplied package in its own directory, then install it into the
same home:

```sh
npx --no-install starforge installation install /absolute/path/to/next-package \
  --home "$STARFORGE_INSTALLATION" \
  --expect-manifest NEXT_PUBLISHED_MANIFEST_SHA256

npx --no-install starforge installation status --home "$STARFORGE_INSTALLATION"
```

Later installs are staged. Use the exact `releaseId` returned by that install to
select the new source for subsequent launches:

```sh
npx --no-install starforge installation activate RELEASE_ID --home "$STARFORGE_INSTALLATION"
npx --no-install starforge installation rollback --home "$STARFORGE_INSTALLATION"
```

`install ... --activate` combines staging and selection. Repeating installation
of the same prepared identity reuses the existing release. The release digest
also records the exact original SF46 manager bytes used for preparation.

Activation changes source for new launches. A running merchant retains its
selected code until the original process exits; use its normal drain/shutdown
flow, then launch through the home again. Merchant configuration, databases and
journals remain in their existing paths throughout activation and rollback.
Data migration and recovery follow the original merchant's own procedures.

The original manager retains the previous release and serializes local update
operations. A competing live update reports its process; continue the intended
update after that operation exits. An interrupted first install resumes with
the same package and the same manager source, preserving its original release
digest. A completed staged release can be selected with `activate` after restart.
Old releases remain available in the home for explicit operator management.

## Optional runtime packages

Run the original installed dependency doctor:

```sh
npx --no-install starforge installation doctor --home "$STARFORGE_INSTALLATION"
npx --no-install starforge installation doctor --home "$STARFORGE_INSTALLATION" --feature postgres
npx --no-install starforge installation doctor --home "$STARFORGE_INSTALLATION" --native
```

The selected release's maintained doctor reports actual local imports and
runtime availability. A requested missing feature or native runtime returns its
original failing exit status. The package retains its declared optional
dependency versions and peer ranges.

For a source-only managed release, use the original package setup in the exact
`releaseDirectory` returned by install or status:

```sh
cd /absolute/private/starforge/releases/ACTUAL_RELEASE_ID
npm install --ignore-scripts --omit=dev
node /absolute/private/starforge/forge.mjs doctor --feature postgres
```

Use the existing package declarations. Keep `package.json` and all source files
unchanged so the release continues to match its digest. The dependency tree and
deployment lockfile remain separate from the verified source. The
[merchant distribution guide](../distribution/README.md) provides the original
feature-specific setup and merchant connection instructions.

## Adopt a completed runtime

The original [runtime installer](../distribution/RUNTIME_INSTALL.md) retains the
supplied archive, its original package, the selected dependency profile and its
completed lockfile in one directory. Choose that directory's final location
before preparation; its recorded installation identity includes absolute paths.
Complete the original runtime installation until its inspection reports `READY`.
Place the managed home, retained preparation output and temporary directory
outside that entire runtime directory, including its dependency subtree.

Use the current `starforge installation` CLI to adopt that completed directory:

```sh
STARFORGE_RUNTIME_DIR=/absolute/private/starforge-runtime-v1

npx --no-install starforge installation inspect-runtime "$STARFORGE_RUNTIME_DIR" \
  --expect-manifest PUBLISHED_MANIFEST_SHA256

npx --no-install starforge installation adopt-runtime "$STARFORGE_RUNTIME_DIR" \
  --home "$STARFORGE_INSTALLATION" \
  --expect-manifest PUBLISHED_MANIFEST_SHA256
```

The direct Node equivalent uses the current checkout's
`sf46-release/package-cli.mjs adopt-runtime ...`. This is also the adoption
entry point when the original supplied archive predates the installation alias.
The existing home `forge.mjs` remains the launcher for selected releases.

Adoption verifies the original archive and completed runtime through the
original installer, prepares the exact original `package/` contents for SF46,
and binds the runtime identity into `release.json`. The runtime's original
directory remains its source and dependency home. The managed release records
its installation ID, profile ID, profile file hash, lockfile hash, source commit,
source manifest hash and absolute location. These fields contribute to the
managed release digest and release ID.

| Location | Content and ownership |
| --- | --- |
| `RUNTIME/package/package.json` and `RUNTIME/package/source/` | Original supplied package, retained by the runtime installer |
| `RUNTIME/runtime-profile.json` and `RUNTIME/package.json` | Original selected profile and its exact dependency declarations |
| `RUNTIME/package-lock.json` and `RUNTIME/node_modules/` | Completed dependency operation, retained at its recorded runtime location |
| `HOME/releases/ID/package.json` and `HOME/releases/ID/source/` | Exact original package bytes copied by the existing SF46 installer |
| `HOME/releases/ID/release.json` | Verified source release and the immutable runtime selection |
| `HOME/releases/ID/node_modules` | Link to that runtime's dependency directory when the profile selects dependencies |
| `HOME/config/` and `HOME/state/` | Existing merchant configuration and operational data |

A profile with zero selected dependencies is valid: it requires no
`node_modules` link. The original profile still checks its requested Node,
Python, platform and host commands. Dependencies remain owned by the original
runtime installer; use its upgrade workflow to prepare a new runtime directory,
then adopt that completed directory into the same managed home.

The existing SF46 installer performs attachment while holding its original
update lock, after copying and verifying source and before changing the active
release. It creates the expected link or reopens that exact existing link.
Unexpected dependency content produces an error with its path. A failed
attachment leaves the previous active release selected; repeat `adopt-runtime`
with the same runtime and home to resume the verified source installation.

The first completed adoption becomes active. Later adoptions are staged unless
`--activate` is supplied. A different runtime profile or completed lockfile gets
a different managed release identity, even when its source commit is the same.
Use the usual `activate RELEASE_ID` and `rollback` commands to select code and
its retained dependency selection together.

Read the selected release's actual runtime through its copied source imports:

```sh
npx --no-install starforge installation runtime-status \
  --home "$STARFORGE_INSTALLATION" --load

# Inspect a staged runtime using the releaseId returned by adopt-runtime.
npx --no-install starforge installation runtime-status \
  --home "$STARFORGE_INSTALLATION" --release RELEASE_ID --load
```

`runtime-status` checks the binding, original profile and lockfile, exact
dependency link, and the original profile against the managed source. `--load`
also asks the original profile inspector to load its selected imports. The
result includes the original runtime paths, selected versions, host inspection
and managed source directory. The existing `doctor --feature NAME` and
`doctor --native` commands continue to use the selected source's original
dependency doctor.

For a retained local preparation, `prepare-runtime RUNTIME_DIRECTORY --out
NEW_DIRECTORY` creates the same source release with its runtime binding. Keep
the original runtime at its recorded location and use the current
`adopt-runtime` command for installation. The current original installer
requires its runtime preparation callback for these bound manifests, so source
selection follows completed attachment.

## Retain a portable prepared release

`prepare` creates a complete SF46 release at a new output path whose parent
directory already exists. Use it when handing the same installable source to
another operator or retaining an exact prepared release for recovery:

```sh
npx --no-install starforge installation prepare "$STARFORGE_PACKAGE_DIR" \
  --out /absolute/deliveries/starforge-prepared \
  --expect-manifest PUBLISHED_MANIFEST_SHA256
```

Retain the returned `id`, `digest`, source manifest hash and `manager` source
identities with that complete directory. The original installer can consume it
directly after transfer:

```sh
node /absolute/deliveries/starforge-prepared/forge.mjs install \
  /absolute/deliveries/starforge-prepared --home /absolute/private/starforge \
  --expect PREPARED_RELEASE_DIGEST
```

The prepared release is retained at the requested path. Temporary preparation is
specific to `installation install`; a cleanup failure is reported as
`temporaryCleanup` alongside the original completed result or original error.

## Application imports

The maintained distribution exposes the same operations for an operator
application:

```js
import { inspectMerchantPackage, prepareMerchantPackage }
  from '@tokenjunkielabs/starforge-merchant/installation';
import { installMerchantPackage }
  from '@tokenjunkielabs/starforge-merchant/installation/cli';
import { status, activate, rollback, runNative }
  from '@tokenjunkielabs/starforge-merchant/installation/product';
import { adoptMerchantRuntime, inspectInstalledRuntime }
  from '@tokenjunkielabs/starforge-merchant/installation/runtime';

const selected = await inspectMerchantPackage(packageDirectory, { expectedManifest });
const installed = await installMerchantPackage({
  packageDirectory,
  home: installationDirectory,
  expectedManifest: selected.sourceManifestSha256,
});
const current = await status(installed.home);

const adopted = await adoptMerchantRuntime({
  directory: completedRuntimeDirectory,
  home: installationDirectory,
  expectedManifest: runtimeSourceManifestSha256,
});
const runtime = await inspectInstalledRuntime({
  home: adopted.home,
  releaseId: adopted.releaseId,
  load: true,
});
```

`prepareMerchantPackage({ packageDirectory, output, expectedManifest })` retains
the explicit output; `installMerchantPackage` owns its temporary preparation.
`prepareMerchantRuntime({ directory, output, expectedManifest })` retains a
runtime-bound preparation; `adoptMerchantRuntime` owns its temporary source
preparation and delegates copying, locking and selection to the original
installer. Its returned `runtimeInstallation` includes the actual attachment
and source-based profile inspection.
Importing the CLI module leaves command execution with the caller. `main(args)`
returns the original doctor or native command exit status, and the installed bin
propagates that status to the operating system.
