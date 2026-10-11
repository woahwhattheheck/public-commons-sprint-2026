# Select and inspect a merchant runtime

A merchant source archive declares the optional Node packages used by its
native payment runtime and individual source adapters. A runtime profile turns
that selected archive's declarations into one exact dependency list. Keep the
profile with the installation or container that consumes it so an upgrade can
retain the previous working dependency selection.

The profile reads the selected package's `source/` directory. Its input is the
original `distribution.json` plus the original component package manifests;
an installed archive also supplies its existing `manifest.json`. The profile
retains each declaration's byte count and SHA-256, the package version and
source commit, the selected feature groups, exact versions, and original import
probes. An archive whose declaration bytes no longer match its own source
manifest cannot produce a profile.

## Select the installed source

These examples assume the supplied merchant package is installed beneath an
application directory. Set the paths to that actual installation:

```sh
export STARFORGE_APP=/absolute/merchant-application
export STARFORGE_SOURCE="$STARFORGE_APP/node_modules/@tokenjunkielabs/starforge-merchant/source"

npx --no-install starforge runtime-profile catalog \
  --source-root "$STARFORGE_SOURCE"
```

The current source manifest provides these feature groups. `catalog` reads the
actual selected archive, including later groups added by their original source
owners.

| Selection | Original source declaration |
| --- | --- |
| `--native` | Native peers in `distribution/distribution.json` |
| `--feature schema` | The existing `payment-auto-catalog/package.json` |
| `--feature openapi` | The original OpenAPI parser manifest |
| `--feature postgres` | The original PostgreSQL driver and cursor manifest |
| `--feature mysql` | The original MySQL adapter manifest |
| `--feature mongodb` | The original MongoDB adapter manifest |
| `--feature s3` | The original S3 adapter manifest |
| `--feature graphql` | The original GraphQL merchant manifest |
| `--feature mcp` | The original paid MCP client/server manifest |

For a native PostgreSQL merchant with schema validation, resolve the selected
profile before creating its installation directory:

```sh
npx --no-install starforge runtime-profile resolve \
  --source-root "$STARFORGE_SOURCE" \
  --native --feature postgres --feature schema --operator

npx --no-install starforge runtime-profile create \
  --directory /absolute/new-merchant-runtime \
  --source-root "$STARFORGE_SOURCE" \
  --native --feature postgres --feature schema --operator
```

`create` writes `profile.json` and `package.json` in a private new directory.
Repeating the identical command reopens those exact files; changed selections
need a different directory. If the first write was interrupted, the same
selection can finish its missing file while retaining the existing matching
one. Existing differing files are preserved.

The generated `package.json` has exact selected runtime dependencies, an
explicit Node engine requirement, `private: true`, and no lifecycle scripts.
It is the dependency input for the maintained runtime installer or image
builder. The original merchant archive remains its separate source package.
The installer can compose that archive with `profile.packageJson.dependencies`
and use npm's normal lockfile for transitive dependency resolution.

## Version selection

Exact component pins stay exact. When several selected groups require the same
package, one selected version must satisfy every original declaration. Group
provenance and each import probe remain attached to the resulting dependency.

A declared stable caret or tilde range uses its compatible minimum version.
For example, the current native declaration `^16.3.0` selects `16.3.0` and
records `selection: "DECLARED_BASELINE"`; the original range remains in
`requested`. This choice is reproducible from the selected source without a
registry query. It expresses neither a newest-version lookup nor an observation
of the machine's installed packages.

An operator with an accepted exact version inside that declared range can
retain it explicitly:

```sh
npx --no-install starforge runtime-profile resolve \
  --source-root "$STARFORGE_SOURCE" --native \
  --pin @stellar/stellar-sdk@16.3.0
```

The selected dependency then records `EXPLICIT_PIN`. A pin outside any selected
declaration, an undeclared package, or conflicting exact source versions is an
error. The profile currently understands stable exact versions and caret or
tilde ranges. A new declaration syntax requires the profile reader to support
its actual meaning before that version can be selected.

Node begins at the distribution's existing `22.16.0` minimum and is raised if
a selected component declares a higher minimum. `--operator` adds the original
Linux host, Python 3.11 or newer, and `flock` requirements used by the operator
workflows. A source-only dependency profile can omit that flag when those
operator workflows are outside its installation.

## Inspect the original installation

After the maintained installer or image builder has installed the selected
packages, inspect the same profile against the actual application:

```sh
npx --no-install starforge runtime-profile inspect \
  --profile /absolute/new-merchant-runtime/profile.json \
  --directory "$STARFORGE_APP" \
  --source-root "$STARFORGE_SOURCE" --load
```

The inspector first matches the profile back to the selected installed source.
It resolves every package from each original component's location, including
the package's advertised subpath. It then reads the actual resolved package
identity and version, including packages that hide `package.json` behind their
exports map. A resolvable entry at a different version is `VERSION_MISMATCH`.
Missing entries and metadata failures remain visible by feature and probe.

`--load` imports the matching entries in one separate Node process. This catches
an entry that resolves but cannot load, including an unavailable native binding
after installation with lifecycle scripts disabled. A failed or timed-out
import returns `LOAD_FAILED`; the source adapter's normal runtime still owns
connections, credentials, requests and application startup. Import diagnostics
do not add install scripts or replace native packages with approximations.

With `--operator`, the same report checks the running Node version, Linux,
`python3 --version` and `flock --version`. Use `--python /absolute/python3` for
the actual Python executable selected by the operator host. The command exits
zero when its requested checks are ready and one when they are incomplete.

If a dependency directory has no selected merchant source, the report marks
the source as `DEPENDENCIES_ONLY` and inspects packages from that directory.
This lets an image builder inspect a prepared dependency layer. To verify the
complete original installation, supply its actual `--source-root` as above.

For an installed toolkit, omitting `--source-root` from `inspect` searches the
application's `source/` and installed merchant package location. `resolve` and
`create` instead default to the source containing the invoked profile module;
use an explicit source root when preparing another archive's runtime.

## JavaScript integration

The maintained module is
`stellar/scf-starforge-20261009/distribution/runtime-profile.mjs`.

```js
import {
  runtimeCatalog,
  resolveRuntimeProfile,
  createRuntimeProfile,
  verifyRuntimeProfile,
  verifyRuntimeSource,
  inspectRuntimeProfile,
} from './runtime-profile.mjs';

const profile = await resolveRuntimeProfile({
  sourceRoot: selectedArchiveSource,
  native: true,
  features: ['postgres', 'schema'],
  operator: true,
  pins: { '@stellar/stellar-sdk': '16.3.0' },
});

verifyRuntimeProfile(profile);
await verifyRuntimeSource(profile, { sourceRoot: selectedArchiveSource });
await createRuntimeProfile({ directory: newProfileDirectory, profile });

const inspection = await inspectRuntimeProfile(profile, {
  directory: installedApplicationDirectory,
  sourceRoot: installedArchiveSource,
  load: true,
  python: '/usr/bin/python3',
});
```

`runtimeCatalog` returns the original groups and input source descriptors.
`resolveRuntimeProfile` returns schema `stellar-forge.runtime-profile.v1`, a
SHA-256 `profileId` over its complete canonical content, the exact dependency
array, host requirements, and generated `packageJson`.
`verifyRuntimeProfile` checks content identity, exact dependency consistency
and the generated package contract. `verifyRuntimeSource` re-resolves the
profile against the selected source's original declarations and requires the
same identity. An installer should use both before an installation mutation.

Runtime profiles retain no environment-variable values, provider credentials,
wallets or merchant private state. Keep the installation's existing npm lock,
selected source archive and previous profile together for the maintained
upgrade and recovery workflow.
