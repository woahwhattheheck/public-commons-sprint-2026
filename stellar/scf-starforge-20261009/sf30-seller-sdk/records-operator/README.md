# Records operator

A complete operator application for original contract/rate policy, custody inventory, service events and invoice lines. It retains source bytes, mappings and correction editions, uses the original offsite-records reconciliation engine, and delivers full AP, inventory, transition and reporting outputs with a portable receiving workflow.

The maintained Python workspace supplies saves, revision history, private previews, authentication, browser draft recovery and portable export. This product uses those original services. The installed Applications lifecycle and setup are described in [INSTALL.md](INSTALL.md).

## Complete operating workflow

The browser at `/records-operator/` provides eight connected views:

- Overview of the selected period/edition, source status and saved calculation.
- Original CSV/JSON source import, exact field/value mapping, ledger policy and source inspection.
- Paged reconciliation with original rows, explicit mapped-cell corrections and attributed findings review.
- Inventory, selected transition waves, assignments and five recorded receiving checkpoints.
- Explicit monthly agency/contract reporting, source coverage, original percentage calculation and retained remittance references.
- Complete supplied requirement questions and cost-catalog references, with attributed draft/reviewed responses.
- Customer field mapping, actual safe projected values, original report downloads and full handoff commands.
- Saved history, immutable result inspection, source restoration and retained local draft recovery.

A reviewer disposition is retained beside the original finding. It does not rewrite billed source, turn an unresolved row into collected savings, or execute a records transfer. The customer map uses the same sanitized invoice projection in the browser, native customer output and complete export.

## Run with the existing native runtime

Use Node 22.13+ and Python 3.11+ in the existing environment. The runtime source root contains:

`stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/model.mjs`

The source root may be the maintained repository or the `source/` directory of the installed merchant package. The browser manifest also uses the existing `distribution/browser-assets.mjs` loader. Setup and the original installed Applications controls are in [INSTALL.md](INSTALL.md).

Prepare the actual supplied inputs as described in [INPUT_HANDOFF.md](INPUT_HANDOFF.md) and [CORE_CONTRACT.md](CORE_CONTRACT.md). The application expects a complete `workspace.json` and the exact relative capture/reference files it names.

From this product directory:

```sh
node workbench.mjs create --source-root RUNTIME_SOURCE --dir NEW_OPERATION --dataset INPUT/workspace.json
node workbench.mjs serve --source-root RUNTIME_SOURCE --dir NEW_OPERATION --port 8431
```

Open the full original operator URL printed by `serve`. Its token uses the maintained workspace's private local session mechanism. The default server remains loopback; the application does not create an external service or a second database.

Without `--plan`, creation is explicitly configured for local private previews. Any later seller deployment uses the actual original runtime/payment declaration supplied for that deployment. Private data review does not use a signer or provider account.

## Original calculations and source semantics

The original engine lives in `smb-showcase-inventory/apps/offsite_records_storage_invoice_reconciliation`. The packaged `offsite_records_storage_invoice_reconciliation/` is the same original source, carried so a receiving operator can reopen the application. The V2 extension is merged in [original PR2199](https://github.com/woahwhattheheck/smb-showcase-inventory/pull/2199), commit `2ca0540e094d855f59562abe67b22d0e5a87768c`. The packaged engine is its identical `2fab04fc144a0872c872f80cba53edabf68e0082` source.

V1 retains its original integer quantity/rate contract. V2 retains exact decimal quantity and rate text, signed integer invoice amounts, explicit rounding, unit/fixed/graduated/volume/percentage pricing, minimum/maximum amounts and declared credit linkage/methods. [PRICING_V2.md](PRICING_V2.md) specifies the exact rules, unresolved inputs and original compiler interfaces.

The operator supplies the real entity/provider/currency and closed start-inclusive/end-exclusive period. Source timestamps use explicit whole-second UTC; monthly reporting additionally requires an actual IANA reporting timezone. The application does not infer a timezone, billing period, contract percentage or credit convention.

Known partial-month amounts remain available. The report also identifies whether the supplied source period covers the whole calendar month in the declared timezone. A complete arithmetic subtotal is distinct from a complete monthly report or an actual filing.

## Native functions

The existing private preview API executes these original application functions against one saved revision:

| Function | Result |
| --- | --- |
| `inspect_records` | Whole selected-source assessment plus a requested paged source, invoice, finding, inventory, reference, review or customer-projection view |
| `build_records` | Selected counts, exact reconciliation, review/transition/monthly status and complete handoff instructions |
| `customer_records` | The safe customer report and compact customer files from the same saved source |

Function input shapes and all inspection views are in [CORE_CONTRACT.md](CORE_CONTRACT.md). Native source capacity is 8 MiB per file, 32 MiB and 512 files per revision. The compact native output limit is 1 MiB; full row exports use the same processor's streaming exporter.

The original engine admits at most 2,500 cartons, 10,000 service events, 10,000 invoice rows, 100 sites and 512 rates per analysis. A named analysis covers at most 90 days. The operator can retain additional named periods in the same original workspace.

## Deliver every selected row

Save the working source and complete `build_records` in the original application. Use that exact completed preview ID:

```sh
node workbench.mjs handoff --source-root RUNTIME_SOURCE --dir OPERATION --preview BUILD_PREVIEW_ID --out NEW_HANDOFF
```

The wrapper reads the preview's immutable saved revision, reconstructs its exact original files, invokes the same full exporter and verifies all file identities. It retains an interrupted operation for continuation. A completed handoff is reopened and verified when the same command is repeated.

`customer/` contains the selected full CSV/NDJSON, AP reconciliation, inventory/transition, configured monthly output, supplied requirement/catalog references, changes, readable report and field interpretation. Customer summary/report files use the same projection whether the outer delivery is customer-only or a complete operator package.

`operator/` additionally contains original normalized input, calculation, mapped/source/error records, private reviews/corrections, fee basis, native preview and the unchanged full portable workspace. `operator/application/` carries nineteen application, engine, browser, managed-launch and operating-guide files. `operator/install/records-operator.json` carries the original distribution declaration. Every included source/output file has its exact byte count and digest in the handoff manifests.

From the handoff directory, the receiving operator uses the included application:

```sh
node operator/application/workbench.mjs reopen --source-root RUNTIME_SOURCE --dir NEW_RECEIVING_OPERATION --bundle operator/workspace.python-workspace.json
node operator/application/workbench.mjs serve --source-root RUNTIME_SOURCE --dir NEW_RECEIVING_OPERATION --port 8431
```

The maintained runtime is an explicit existing dependency. `operator/REOPEN.md` gives those commands and explains the saved source/preview identity. The operator can inspect the retained result without another calculation, restore an earlier source as a new revision, and continue an actual correction in the same workspace.

## Source and operating guides

[CORE_CONTRACT.md](CORE_CONTRACT.md) gives the complete saved schema and original API. [INPUT_HANDOFF.md](INPUT_HANDOFF.md) describes actual source fields and mappings. [OPERATIONS.md](OPERATIONS.md) covers corrections, review, transition, reporting, delivery and receiving. [UI.md](UI.md) describes the browser controls. [INSTALL.md](INSTALL.md) covers the installed Applications lifecycle.

Keep original source data, procurement materials and company-specific terms in their authorized project destination. This generic application distribution contains no issuer packet, company ledger, customer quote, account credential or private receiving operation.
