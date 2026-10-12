# Product source selections

The original distribution builder can package a complete product from the same
Git commit as the full toolkit. A committed recipe chooses base registrations,
whole source-owned contributions, component directories and explicit support
files. The existing Git reader, source manifest, runtime profile, installer,
Applications launcher and recovery commands remain the distribution workflow.

## Build a product

Run the maintained builder from a repository that contains the selected commit:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection water-operations --out /absolute/water-release

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection woo-merchant --out /absolute/woo-release

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection openapi-merchant --out /absolute/openapi-release

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --ref ORIGINAL_COMMIT \
  --selection grant-reviewer --out /absolute/grant-reviewer-release
```

Use any selection ID from the table below in the same build command and give
that product its own output directory.

Replace `ORIGINAL_COMMIT` with the full original commit SHA. Each output directory
belongs to one source commit and selection. The packaged receipt names the
archive, SHA-256, installed/source bytes, source acquisition and materialization.
The manifest adds `sourceSelection`: original recipe ID, title, path, Git blob,
SHA-256 and byte length. Its recipe also appears in the normal file inventory
and `distributionInputs`.

The package version includes both the commit and selection, for example
`0.1.0-source.g0123456789ab.selection.water-operations`. The full package retains
the original `0.1.0-source.g0123456789ab` version form.

| Selection | Product | Original Applications | Complete installed workflow |
| --- | --- | --- | --- |
| `water-operations` | USGS observations, editions, Water workspace, merchant and complete customer files | Water, Buyer, merchant console | [Operating guide](selections/WATER_OPERATIONS.md) |
| `woo-merchant` | Existing WooCommerce orders, native checkout, Operations, purchased files and refunds | WooCommerce, Buyer, merchant console | [Operating guide](selections/WOO_MERCHANT.md) |
| `openapi-merchant` | OpenAPI/Postman/HAR authoring, route worksheets, policy editions, seller releases and complete receiving | API merchant authoring, Buyer, merchant console | [Operating guide](selections/OPENAPI_MERCHANT.md) |
| `grant-reviewer` | Retained purchase/source review, complete native Buyer results and closed receiving handover | Grant purchase reviewer | [Operating guide](selections/GRANT_REVIEWER.md) |
| `iati-operator` | IATI aid-finance source intake, review, native editions and complete operator exports | IATI aid finance | [Operating guide](selections/IATI_OPERATOR.md) |
| `redis-applications` | Redis/Valkey commissioning, native products, customer clients, complete exports and cutover comparison | Redis, Buyer, merchant console | [Operating guide](selections/REDIS_APPLICATIONS.md) |
| `safe-review` | Original Safe transaction intake, simulation purchase, retained result comparison and portable receiving | Safe simulation buyer, Tenderly, Buyer | [Operating guide](selections/SAFE_REVIEW.md) |
| `study-research` | Source editions, property research, reports, PostgreSQL publishing and complete customer receiving | Study Source Refresh, PostgreSQL workspace and publisher, Buyer, merchant console | [Operating guide](selections/STUDY_RESEARCH.md) |
| `all` or no flag on a new build | Complete maintained toolkit | All registered applications | [Runtime installation](RUNTIME_INSTALL.md) |

The [API merchant installation and handover guide](selections/OPENAPI_MERCHANT.md)
continues from its selected archive through managed authoring, source-bound policies,
MCP/CLI files, complete package receiving, SF82 releases and customer reopening.

Use the product's installed `starforge --help` and `starforge registrations`
for its included commands. Selected packages expose their explicit named package
exports; the full toolkit's broad root `index.mjs` is excluded. This prevents
its unrelated re-exports from forcing every product into a selected package.
The original modules, their exports and implementations are unchanged.

## Continue the same build

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/checkout --out /absolute/water-release --resume
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/water-release --status
```

An omitted selection on resume inherits the saved selection. An explicit
different selection, including `--selection all` for a selected output, returns
`DISTRIBUTION_SOURCE_SELECTION_CONFLICT`. Use a new output for a different
product. A completed build returns its original verified archive without another
pack. The retained source commit, original output lock and partial-file recovery
retain their existing behavior.

For offline builds add `--offline` after the original source objects have been
acquired in that repository. Recipes and selected contributions are read in
small batches before product sources; unselected contribution JSON does not
travel in the selected archive.

## Install and operate the original product

Use the returned archive path and SHA-256 with the original installer. Select
its dependency profile from the complete installed workflow linked above:

| Selected product | Profile flags for the complete installed edition |
| --- | --- |
| `openapi-merchant`, `safe-review`, `water-operations`, `woo-merchant` | `--native --feature schema --feature openapi --feature mcp --operator` |
| `redis-applications` | `--native --feature redis --feature schema --feature openapi --feature mcp --operator` |
| `study-research` | `--native --feature schema --feature openapi --feature mcp --feature postgres --operator` |
| `grant-reviewer` | `--native --feature mcp --operator` |
| `iati-operator` | `--operator` |

The following example uses the common merchant profile. Substitute the flags
from the product's row and keep that product's original runtime directory.
The selected recipe and its contribution declarations determine the available
dependency groups; the installer resolves the actual profile and lock.

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/customer-runtime --archive /absolute/product-release/ORIGINAL.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 --native \
  --feature schema --feature openapi --feature mcp --operator
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/customer-runtime
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/customer-runtime --load --source
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /absolute/customer-runtime -- source
```

The selected archive supplies its own contribution and recipe inputs to the
runtime profile. Exact dependency selection, npm cache use, native probes, READY
state, retained lock, offline transfer and installation recovery remain the
existing installer operations. An existing complete dependency tree can be
received through the maintained `--adopt-existing` option; it must satisfy the
selected original profile and retained lock.

Register that READY runtime in the original Runtime workspace, then use its
Applications tab to review, save, start, open, stop and reopen the product's
existing application. Installed source is separate from the existing customer
project, WordPress site, merchant state, outbox, buyer operation and downloaded
files. Use those original paths and operation identities through upgrades.

## Maintain a recipe

Recipes live in `distribution/selections/ID.json` and use schema
`stellar-forge.distribution-source-selection.v1`. The filename must match the ID.
`base.commands` and `base.exports` explicitly name existing base declarations;
`base.features` names the original feature or package-manifest groups.
`base.applicationProviders` and `base.merchantProviders` name base providers
when the base declares any. `base.browserAssets` selects an existing base browser
server and its original mapping manifest.

`contributions` selects complete existing contribution IDs. The builder composes
them after base selection; a conflict between included owners remains an error.
Unselected contributions do not participate. Their source ownership, command
descriptions, providers, dependencies, browser assets and support files remain
the original contribution's declarations.

`components` selects complete original directory roots; `supportFiles` selects
explicit original files. Optional `excludeFiles` adds exact file exclusions to
the original base exclusions. A required command, export, provider, runtime
manifest or static import cannot be excluded successfully. The optional
`product` object selects existing source README/bin and product metadata through
the maintained product-package contract. When that object omits `repository`,
the selected product inherits only `base.product.repository` when present.
An explicit recipe repository remains authoritative. README and executable
selection continue to use the recipe and the original product-package defaults;
unrelated base executables are not inherited. If the base has no repository
override, the maintained package default remains in effect. This keeps a
standalone product's source identity without bringing other products' bins
into its selected archive.

Required command and export targets, selected provider modules, runtime package
manifests, and browser server/manifests are retained as explicit runtime seeds.
The original static ESM and browser-map closure then includes their dependencies.
Complete component directories retain Python modules, template files, generated
plugin inputs, browser resources and other paths loaded dynamically. A new
product recipe therefore needs its original operational receiving journey,
including restart and downloaded files, as well as a successful build. Static
module closure cannot prove that a dynamically constructed pathname is present.

Installed declaration reading checks the original recipe and every contribution
against the retained file inventory. A runtime cannot switch recipes or add an
unselected registration file inside an existing selected package.

## Receiving and measurements

Build the selected products from the same original commit as a full release.
Compare the receipt's `sourceFiles`, `sourceBytes`, `archiveBytes`,
`installedBytes` and acquisition metrics. Report actual measured results with
that commit; the command/provider counts alone are not a size or memory measure.

Receive each archive through the original unpacker and runtime profile. Confirm
that Applications and merchant provider catalogs contain its selected entries,
that installed command help matches its registrations, and that the original
product can complete its saved native journey. Reopen the same output with
`--resume`, and confirm an explicit different selection cannot reuse it.
