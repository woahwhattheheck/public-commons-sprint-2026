# Utility energy product package

This source selection packages the complete Utility energy workflow through the existing Starforge distribution builder, runtime installer, Applications registry and merchant MCP host. Its original Python owner receives UtilityAPI and Green Button sources, retains source editions and reviews, queries native interval data, reconciles bills, prepares the original publisher and exports a complete customer workspace.

The selection is named `utility-energy`. Its two installed product commands are `utility-energy` and the compatible alias `dataset-utility-energy`. The original installation, runtime, merchant, buyer, dataset, release and MCP commands selected by the recipe remain available.

## What the package contains

| Area | Retained implementation |
| --- | --- |
| Utility intake and review | The whole original Utility energy directory, source contracts, Green Button examples, source-priority controls, interval analysis and bill reconciliation |
| Native source and editions | The whole original NDJSON and XML directories, their source inventory, mapping, build, comparison, query, portable export and restore |
| Publication and customer files | The whole original Socrata publisher, dataset refresh and native release/customer components, plus Utility's original publisher bridge |
| Managed operation | The original distribution/runtime workspace, source-owned Utility Applications provider, managed source binding and original CLI owner lifetime |
| Agent and client operation | The current merchant MCP host, the complete Utility provider contribution, 22 Utility tools, original retained file readers and Utility HTTP client |
| Complete receiving | The original one-invocation receiver, browser/client driver, MCP and managed callbacks, original source declarations and receiving guides |

The recipe selects whole existing contributions and component directories. It also explicitly retains every member of the 63-file Utility receiving declaration. The original static import closure and browser resource collection still run during packaging. A declared member, relative import, selected provider or required browser resource that is missing remains a build error.

The product keeps its original source paths and file bytes. The selected package manifest records the complete original Git commit, every retained file, and the recipe's own path, Git blob, SHA-256 and byte length. Its version has the normal form `0.1.0-source.gCOMMIT.selection.utility-energy`.

## Build from an immutable source cut

Use a complete repository-shaped checkout containing this committed recipe. Set the ref to the full commit selected for the release. Run the original builder:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source \
  --ref FULL_ORIGINAL_COMMIT \
  --selection utility-energy \
  --out /absolute/utility-release
```

The receipt supplies the actual archive path, SHA-256, source count, source bytes, installed bytes and acquisition results. Keep that receipt with the archive. Use its measurements when sizing the receiving host.

The collector includes the original PR1959 correction for explicitly declared data under fixture paths. The Utility source contracts retain the Green Button XML examples under `utility-energy/examples/` and the exact original license under `utility-energy/contracts/GreenButtonAlliance-LICENSE.txt`.

Continue an interrupted build in its same output directory:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source --out /absolute/utility-release --resume
```

The existing build journal binds the source commit and selection. An explicit different selection cannot reuse that output. A completed build verifies and returns its retained archive. Use `--offline` after the selected original Git objects have been acquired.

## Install the original runtime

Pass the returned archive and hash to the maintained installer. Select the exact features needed by the intended runtime. The schema, OpenAPI and MCP groups below match this product selection and support the merchant and agent receiving path:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /absolute/utility-runtime \
  --archive /absolute/utility-release/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /absolute/utility-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /absolute/utility-runtime --load --source
```

The profile resolves the selected package's original declarations and exact versions. The original installer owns its package lock, dependency installation, native probes, lease, recovery and READY record. If a complete retained dependency graph is already available, the existing `--adopt-existing` path validates it through that same profile and lock before accepting it. Keep any existing runtime or customer workspace at its original path.

Python 3.11 or later and the original Linux `flock` command are part of the operator profile. The original XML reader also requires Expat 2.6 or later in that selected Python runtime. The Utility source retains its Python requirement declaration. The full browser receiving invocation takes the host's existing Playwright module and Chromium executable as explicit paths.

Register the READY runtime in the original Runtime workspace. Select the Utility application, review the retained workspace and source binding, then prepare and start it through the original managed worker. Its authenticated console descriptor belongs to that same Python owner. Closing a borrowed client leaves the owner intact; stopping the application drains the listener and active requests before the workspace lease closes. The complete managed callback exercises both start/stop and reopen.

## Continue the original customer operation

The complete receiver is retained at:

`operations/scf-utility-energy-receiving-20261012/run-receiving.py`

Its input is one private JSON configuration file. Use the actual installed repository-shaped source directory, original runtime directory, native executables and the retained original operation report:

```json
{
  "sourceRoot": "/absolute/utility-runtime/package/source",
  "sourceManifest": "/absolute/utility-runtime/package/source/operations/scf-utility-energy-receiving-20261012/source-manifest-891b.json",
  "nodeExecutable": "/absolute/node",
  "pythonExecutable": "/absolute/python3",
  "chromium": "/absolute/chrome-headless-shell",
  "playwright": "/absolute/playwright/index.mjs",
  "originalReport": "/retained/Utility_Original_Customer_Operation_20261012.json",
  "reconstructOriginal": true,
  "outputDirectory": "/retained/utility-receiving",
  "artifactDirectory": "/retained/utility-delivery",
  "runtimeDirectory": "/absolute/utility-runtime"
}
```

Then invoke that selected Python directly:

```sh
/absolute/python3 /absolute/utility-runtime/package/source/operations/scf-utility-energy-receiving-20261012/run-receiving.py /private/utility-receiving.json
```

Use one original source receiving mode: its closed core directory, its complete portable workspace, or explicitly selected reconstruction. Reconstruction reuses the exact retained public input bytes and compares its results to the accepted original report. It does not turn a missing old portable file into a claimed recovery.

The retained original report is 56,586 bytes with SHA-256:

```text
08ae13edf0ce8c7f5e23ae3c214cc00be104486ec41982dd60ccd9ba5eb9b966
```

That completed core operation records 20 original imports, 1,340 selected rows across 14 native pages, two reviews, two builds, one comparison and two reconciliations. The overlapping day source changes 96 reviewed rows while 1,244 remain unchanged. The native snapshot is:

```text
62266c0da32ddf56f862c7e3467a45a89278d59795238c12512bfbcaded5f8cf
```

The separate `source-manifest-891b.json` records the 891b implementation identities: 62 members are identical to the preceding declaration; the shared retained-download member includes its original subsequent lease-close recovery. The first declaration remains intact for its own cut. The recipe and installer additionally bind the package's actual build commit; the source declaration identifies the reviewed implementation bytes. Every declared member is checked by byte length, SHA-256 and Git blob before a customer owner opens. Select the declaration that matches the package rather than editing source to satisfy a stale declaration.

## Receiving phases and recovery

The original receiver completes these phases in one operation:

1. Verify the complete source declaration, original report and actual imported operator/publisher modules.
2. Reuse or reconstruct the original core, then compare its source, rows, editions and snapshot to the retained completed result.
3. Complete the existing browser and HTTP-client workflow over the same customer, including retained source-priority review and downloads.
4. Borrow that Python owner, verify the complete 22-name Utility MCP catalog, and exercise the original status, inventory, records, inspection, interval series, export, retained-file and client-reopen workflow.
5. Export through the original CLI, restore into a new receiver and query the same 1,340-row native snapshot.
6. Use the original READY runtime and managed Applications worker for two complete start/stop passes with the same source and customer identities.
7. Save the complete report, customer package, portable workspace and combined delivery bundle.

The journal retains each completed phase and its original artifacts. A failed later phase continues from those retained results. An uncertain operation or export stays attached to its original identity; do not initialize a parallel workspace to obtain a second result.

Completed delivery is persisted before optional upload targets are used. The completion path verifies the retained bundle and finishes outstanding transfers without dispatching earlier product phases. The detailed receiving guide documents the original transfer target format. Keep its opaque upload identities and exact source bytes together.

For hosts with temporary invocation-local storage, transfer the resulting artifacts before that invocation ends. The archive and operation report should remain available independently of the process that produced them. Use the original source package and final delivery files when reopening on another host.

## Source references

- [Utility operator, native units, source contracts and customer workflow](../../sf30-seller-sdk/utility-energy/README.md)
- [Utility managed Applications contract](../../sf30-seller-sdk/utility-energy/MANAGED_APPLICATION.md)
- [Utility MCP and retained file receiving](../../../../stellar-forge/mcp-merchant-operator/UTILITY_ENERGY_WORKSPACE.md)
- [Complete customer receiver and transfer recovery](../../../../operations/scf-utility-energy-receiving-20261012/README.md)
- [Original distribution selection and recovery contract](../SOURCE_SELECTIONS.md)
- [Original complete-source collector correction, PR1959](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1959)
