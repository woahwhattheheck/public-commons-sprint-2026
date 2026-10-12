# Source-owned distribution registrations

The pinned Git builder, installed CLI, `doctor` and runtime profiles compose the
base configuration and every direct `contributions/*.json` file through
`specification.mjs`. Each source owns its commands, exported interfaces, runtime
features and original browser asset registrations. The existing base works
without a contributions directory.

## Inspect the installed inventory

```sh
starforge registrations
starforge registrations --source mssql
starforge registrations --command mssql
starforge doctor --feature mssql
```

The first command returns source IDs, original paths and registration counts.
`--source` returns one file's complete declarations. `--command` returns its
effective entrypoint, description and declaring sources. Installed output
includes the original archive commit. Use `--source base` for legacy entries.

Seller providers keep their registrations in [contributions/](contributions/).
Each file combines the provider's existing commands and help, exported interfaces,
runtime declarations and browser contracts. For example,
[postgres.json](contributions/postgres.json) owns the PostgreSQL source and publisher
commands, their interfaces, the original driver manifest and browser entry;
[mssql.json](contributions/mssql.json) does the same for SQL Server.

The directory includes native databases, file and table sources, geographic and
statistical data, scholarly and financial feeds, upstream services, and application
providers. Run `starforge registrations` for the current provider list. A command
can have a different name from its source: `water-quality` belongs to
`wqx-water-quality`, `census-publisher` to `census-acs`, and the original Goldrush
example product to `goldrush`.

Shared seller operations, job delivery, dataset publishing, payment and customer
components keep their existing base registrations. The source-owned files cover
the provider implementations under `sf30-seller-sdk`; independently maintained
buyer and MCP joins use their own current registration owners. A contributor can
locate either kind with `starforge registrations --command NAME`.

When extending a listed provider, edit its existing contribution. Keep command
help beside its command registration; the CLI prints it automatically. Driver
versions stay in the original component package manifest. The base keeps the
shared SF30 component, so these provider files need no duplicate component entry.

## Add one source

Create `contributions/example-source.json` with the following shape, replacing
the illustrated paths with actual maintained files. Omit unused fields.

```json
{
  "schema": "stellar-forge.merchant-distribution-contribution.v1",
  "id": "example-source",
  "description": "Example source data products",
  "components": ["stellar/scf-starforge-20261009/example-source"],
  "commands": {
    "example-source": "stellar/scf-starforge-20261009/example-source/cli.mjs"
  },
  "commandDescriptions": {
    "example-source": "Prepare, operate and receive the data product"
  },
  "exports": {
    "./seller/example-source": "./source/stellar/scf-starforge-20261009/example-source/index.mjs"
  },
  "runtimePackageManifests": {
    "example-source": "stellar/scf-starforge-20261009/example-source/package.json"
  },
  "browserAssets": [{
    "server": "stellar/scf-starforge-20261009/example-source/workspace/server.mjs",
    "manifest": "stellar/scf-starforge-20261009/example-source/workspace/browser-assets.json"
  }]
}
```

`id` must equal the lowercase filename without `.json`; `base` is reserved.
Use a short, single-line description. A source already inside a maintained
component, such as `sf30-seller-sdk`, does not need another component entry.

| Field | Registration |
| --- | --- |
| `components` | Original source directories included by the builder. |
| `supportFiles` | Explicit additional original files. |
| `excludeFiles` | Explicit omissions under the original builder rules. |
| `commands` | Lowercase command names mapped to original Node `.mjs` entrypoints. |
| `commandDescriptions` | Help for commands declared in the same file. |
| `exports` | Explicit package exports, including ordered conditional exports. |
| `runtimePackageManifests` | Features mapped to original pinned JSON package manifests. |
| `nativePeers` | Original native dependency version and import probe declarations. |
| `featurePeers` | Per-feature dependency declarations and original probes. |
| `browserAssets` | Original server and asset-manifest pairs. |

The built-in `init`, `run`, `doctor`, `source`, `help` and `registrations` command
names are reserved. Repository source paths must be relative and remain inside
the selected source. Package exports select explicit files under `./source/`.
Command arguments and process lifecycle use the existing CLI.

Keep dependency versions in the original component manifest when available.
`featurePeers` can select its actual exported import subpath. A runtime profile
records the original package-manifest path for a manifest-backed dependency,
and the contribution path for a directly declared dependency. Original version
selection and native-driver preparation still apply.

Browser servers keep using `readBrowserAssets`. Contributions give the existing
collector those same server manifests. [BROWSER_ASSETS.md](BROWSER_ASSETS.md)
defines the URL mapping and original asset closure.

## Composition and migration

The base is read first; contribution files are sorted by filename. The directory
is flat so Git and filesystem discovery select the same inventory.

Lists preserve base order and append new values once. Different map definitions
or browser manifests for the same server fail with
`DISTRIBUTION_REGISTRATION_CONFLICT`, naming the key and both source files.
Identical definitions can coexist during migration, with both owners recorded.
Conditional export order is preserved and is part of the compared definition.

Move an existing source's registrations into its contribution without changing
their values, then inspect the effective commands and exports. Other sources
can keep using the base. New source commands generate their own help, so adding
them does not require a central CLI help edit.

## Build and receive the original archive

Use the existing builder with the selected checkout and immutable Git ref:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/path/to/checkout --ref ORIGINAL_COMMIT \
  --out /absolute/private/merchant-package --offline
```

The builder reads and packages the original declaration bytes from that commit.
It preserves source paths, import collection, browser assets and archive rules.
The manifest records `distributionInputs` with Git blobs, lengths and SHA-256
digests, and `distributionContributions` with source IDs and paths. It retains
the existing source file inventory and runtime dependency metadata.

Installed CLI and runtime loading compare the declaration inventory and bytes
with the original manifest. Missing, added or changed contributions are reported
before command selection or runtime preparation. A checkout uses its current
files; package its committed ref for delivery.
