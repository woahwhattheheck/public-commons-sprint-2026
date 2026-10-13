# CKAN and DCAT catalog operations

This selected distribution contains the original catalog workspace, browser, merchant MCP tools and managed Applications workflow. Operators can receive complete CKAN editions or DCAT-US catalogs, review original schema and semantic findings, compare saved snapshots, select or roll back a catalog release, and transfer the complete retained workspace to another host.

## Build and install the selected original source

Use the maintained distribution builder against a complete immutable public checkout. Replace the example paths and COMMIT with the actual selected source and output:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/public-checkout --ref COMMIT \
  --selection ckan-dcat --out /absolute/private/ckan-dcat-package
```

Continue that same output with `--resume` after interruption. Its original manifest retains the selected commit, recipe bytes, every complete source member and the archive identity. Follow [the maintained runtime installation guide](source/stellar/scf-starforge-20261009/distribution/README.md) for the generated package. Keep the source package, installation, customer catalog workspace and Python environments in their original separate directories.

The recipe selects the complete CKAN source family and all declared vendor, profile and runtime files. Original Python modules, JSON schemas, RDF shapes and contexts, licenses, notices and dependency locks travel explicitly with the package. The builder also follows the maintained JavaScript import and browser route declarations for original publisher, merchant, buyer and Runtime dependencies.

## Operate the original workspace

For a new DCAT catalog, select its source origin and an owned private directory:

```sh
starforge dcat init --workspace /absolute/private/catalog --origin https://publisher.example/
starforge dcat serve --workspace /absolute/private/catalog --port 0
```

Open the private URL returned by the original listener. Reopen an existing project with the same serve command. Keep one owner of that project; the configured merchant MCP and Applications routes operate through the same native model and its original lease.

Use [Catalogue migration](source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/MIGRATION_OPERATING.md) for original editions, exact typed mappings, full reviews, release selection and rollback. [Recurring catalogs](source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/RECURRING_CATALOGS.md) covers saved source configurations and acquisition receipts. [Semantic validation](source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/SEMANTIC_CATALOGS.md) and [saved snapshot comparison](source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/SEMANTIC_COMPARISONS.md) keep JSON-schema acceptance, RDF/SHACL findings, coverage qualifications and attributed operator decisions distinct.

The existing CKAN browser also retains complete DataStore captures, capture plans, reviewed refreshes and remote catalog publication. Read the saved original operation and exact response before continuing an interrupted action. The [merchant workflow](source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/MCP_WORKFLOW.md) supplies the authenticated agent interface over that same project.

## Prepare Python and receive a customer installation

The original GSA migration engine uses its retained Poetry lock and Python 3.13 requirement. An explicitly selected Python 3.12 installation uses the original [portable profile](source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/PORTABLE_RUNTIME.md), its full pinned requirements export and the unchanged source selection. The interpreter path and profile are host settings.

Native semantic work uses its own original [prepared runtime](source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/SEMANTIC_RUNTIME.md). The [semantic runtime transfer](source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/SEMANTIC_RUNTIME_TRANSFER.md) carries the exact retained wheelhouse, lock, original worker source and sender receipt to a separately prepared recipient environment. Retained catalogs and historical semantic outputs remain readable without a new Python run.

Use [DCAT receiving](source/stellar/scf-starforge-20261009/distribution/runtime-workspace/DCAT_RECEIVING.md) for the complete original catalog archive, selected runtime, environment file and managed Application preparation/save/replay. [Application setup](source/stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATION_SETUP.md) describes saved requests and historical outcomes. Preserve the same operation ID, source selection, original archive digest and retained receiving directories when continuing. Host credentials are supplied through the existing private environment contract.

## Hand over and reopen

Export the complete original workspace and receive that exact archive at a separate recipient directory:

```sh
starforge dcat archive --workspace /absolute/private/catalog --out /absolute/private/catalog.ckanw
starforge dcat inspect-archive --file /absolute/private/catalog.ckanw --sha256 ACTUAL_ARCHIVE_SHA256
starforge dcat receive --file /absolute/private/catalog.ckanw --sha256 ACTUAL_ARCHIVE_SHA256 \
  --workspace /absolute/private/received-catalog
```

Retain original catalog editions, source configurations and response files, full migration reviews, candidates, semantic profiles/runs/artifacts and attributed decisions, selected releases and rollback history. The receive result identifies the actual new directory; reopen it with the original catalog server or managed Application workflow.

## Demonstrate the exact outgoing version

Source publication and package composition do not establish an installed or rendered customer result. Continue the existing customer receiving operation with this exact source and its actual input/archive identities. Operate the important original controls, including source import, retained findings and paging, an operator review, saved snapshot comparison, workspace download, receiving and independent reopening as applicable to the supplied customer material.

The producing peer must open and LOOK at the actual desktop and narrow screens or their screenshots, including populated, loading, empty and error states that apply. Open every outgoing attachment and complete download, and check its actual content after reopening. Retain the exact version, original requests, full stdout/stderr, screenshots and observed result alongside the customer delivery. Reuse the current native owner and its journal to finish the whole catalog workflow.
