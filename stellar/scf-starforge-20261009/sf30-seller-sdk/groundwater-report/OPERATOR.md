# Groundwater Report Desk

The Report Desk publishes an existing frozen groundwater report through the maintained SF30 file-product service and receives its actual SF88 buyer output into the original scientific receiving engine and, when explicitly selected, SF47 Operations.

It does not dispatch a solver, create a model scenario, sign a buyer payment, settle a transaction, or infer customer acceptance. Its original records contain the selected report, offers, saved buyer evidence, file receiving review and exact Operations requests/results.

## Install and open

Use this component from the maintained Merchant Workspace distribution or the complete original repository. It uses Node 22+ on Linux, the original Linux state lease, and the installed Groundwater Python core from the same source distribution. The reviewed scientific application is installed separately; received archive code is never imported.

```bash
node cli.mjs init --desk /private/report-desk
node cli.mjs serve --desk /private/report-desk \
  --source /private/original-groundwater-workspace \
  --application /installed/groundwater \
  --python /private/original-python/bin/python \
  --operations-url-file /private/original-operations-launch.json \
  --launch-file /private/report-desk-launch-1.json
```

The scientific source and Operations connection are optional for a buyer-only receiving desk. The source connection always opens the existing original workspace. It never initializes a replacement scientific database.

The printed launch link contains local access credentials. Keep its JSON file private. The server binds to 127.0.0.1, verifies Host/Origin, requires its original bearer token, and binds every API route to the persistent report desk UUID. A new server launch uses a new explicit launch-file name; it never overwrites an old launch record.

The neutral operator interface provides frozen reports, file publication, buyer preparation, report receiving, original-operation recovery, and complete handover. Enter the actual recording operator. Drafts and retained request metadata are scoped to this origin and desk UUID. Uploaded bytes stay out of browser persistent storage. After a reload, reselect the same files if their original server operation did not finish saving them.

## Select the scientific report

Open **Frozen reports**, inspect the exact report, and use that selection for publication. The original core verifies the frozen report and all four original exports before returning their descriptors.

The source view preserves the original project/report/run, source/edition/result SHA-256 values, technical review, time semantics, native unit declarations and source findings. In the publisher TWRI example this includes the executable/prose recharge discrepancy and the differing legacy/MF6 declared units. The original steady solution, aquifer mapping, mask exclusions, indexed budget records, rates and listing volumes stay in the complete report. This component copies the exports byte for byte and does no scientific recalculation.

A frozen report is distinct from a complete editable scientific workspace backup. The Report Desk contains the report package's full native inputs, outputs, source and figure closure; retain the scientific application's own full workspace backup for its original editable model history.

## Freeze native file offers

Choose a stable publication operation ID, exact report/manifest/ZIP hashes, public title, description, usage/attribution, reason, HTTPS origin, fixed versioned path prefix and original payment terms.

The service title follows the original compiler's 1–32 printable ASCII character bound. Public description plus usage/attribution must fit the original native description bound of 2,048 characters. Payment amounts are exact atomic decimal strings. This receiving adapter currently uses the original Stellar testnet/pubnet SF88→SF47 contract; native payment terms are validated by the maintained compiler.

The complete ZIP is required. JSON, HTML and CSV companions may be separately offered. The original HTML references report members and scientific figures, so use the full ZIP for complete context. Companions preserve the original bytes.

Each file is at most 16 MiB and total selected route bytes are at most 64 MiB, the maintained responseAsset limits. A larger report is rejected as a complete file; it is never truncated, silently split or relabelled. The separately owned large-object distribution workflow remains the path for larger assets.

The adapter freezes the original file bytes, creates the original native asset bundle, exports its public catalog and records the exact source/offer join. A valid bundle naming another asset or payment offer is rejected. Recovery of an incomplete publication may fill only missing identical members from its already frozen source. A completed publication with missing or changed artifacts returns unavailable; it does not snapshot current data.

The resulting private publication directory contains:

- `frozen/`: selected unchanged scientific exports.
- `bundle/seller.json`, `bundle/manifest.json`, and content-addressed `bundle/assets/`: original SF30 portable asset bundle.
- `catalog.json`: original public resource catalog with exact asset size/hash/type/name and public offer terms.
- `source.phase.json`, `seller-config.phase.json`, `publication.json`: reviewed scientific source and native offer bindings.
- `request.json` and `result.json`: first request and completion for this publication.

Only the original public catalog is intended for buyer discovery. The desk, source projection, access files, handoffs and complete desk backups remain private.

## Serve through the original merchant

The UI's **Start local service** uses the maintained SF30 server with the exact verified bundle. Its default is CHALLENGE_ONLY: a request receives the original offer/payment challenge and no protected file bytes.

For the configured original native facilitator, select it explicitly at trusted server launch:

```bash
node cli.mjs serve-publication --desk /private/report-desk \
  --operation ORIGINAL_PUBLICATION_ID \
  --facilitator https://original-facilitator.example
```

A local facilitator additionally requires `--allow-local-facilitator`. The original native SDK validates payment, buffers the exact response before settlement and releases it only through its normal protocol. The desk does not replace the facilitator, signer, settlement ledger, acquisition store or public reverse-proxy deployment. Configure the actual HTTPS origin and forwarding to match the frozen offer. Start/stop drains the same original service before the process returns.

## Prepare and receive the buyer's actual operation

There are two preparation paths:

1. The publishing operator selects the original publication and a offered format.
2. An independent buyer selects the complete public catalog, its exact resource row and accepted-payment option.

Both call the original pure SF88 `prepareReview`, retain its unchanged configuration and exact pinned file expectation, and dispatch no purchase. Download the configuration and use the maintained SF88 buyer's existing authorized signing/execution/recovery controls.

After that original buyer operation completes, retain its real response file. Use **Capture selected original jobs** only for the existing Inbox and explicit intent IDs. The first capture attempt is durable before the original exporter runs. If a response is lost, inspect its same saved handoff; a missing publication after an ambiguous attempt does not trigger a fresh timestamped capture.

To receive a report, select:

- The original public catalog.
- The saved private SF88 operations handoff.
- The actual complete ZIP received by that buyer.
- The explicit original catalog row, payment option and Inbox job.

The maintained SF88 reader interprets the original saved request/attempt/terminal/recovery/finalization evidence. This adapter requires verified output size/hash and matches the exact asset, URL/method and original accepted terms. Actual settlement and verified file output are reported independently.

The original Groundwater package reader then verifies unique members, manifest, all named file bytes and report/source/edition/run/result identities. Its original artifact receipt remains `unreviewed`. The Report Desk records a separate attributed decision, `received` or `changes_requested`, with the actual purpose/reason. This review does not claim field validation, independent customer usage, grant completion, or merchant order acceptance.

## Join the existing Operations case

Configure the original private SF47 access link at trusted server launch. In the receiving preview choose the actual existing case, buyer deployment and purchase association. The UI displays the native current version, exact preview SHA, existing matches, conflicts and source rows; it does not match by display name.

The original transaction sequence is:

1. `buyer.receive`: selected original job into the explicit native purchase/deployment.
2. `source.add`: exact receiving review JSON as a source in that same case.
3. `purchase.observe`: append that source to the selected purchase while retaining every current payment, output, order and timestamp field.

Each command is durably saved before dispatch and uses its original request ID. An uncertain reply resumes that identical request through native idempotency before CAS. The source capture is not recreated.

Exact same-source buyer re-receiving preserves the latest existing purchase. A historical handoff cannot regress newer output/status observations. A handoff with no merchant-order observation preserves independently recorded FULFILLED/CANCELLED/REFUNDED/PENDING state.

A definite version conflict retains the original partial request and evidence. Inspect it in **Operations & recovery** and the original case before making any new reviewed selection. Do not replace the original payment or infer a new one from an unavailable response. The desk does not silently rewrite a stale saved command with a new version.

The report ZIP remains in the report desk; the linked case source contains its exact archive/manifest/source/run hashes, member inventory, technical-source identity and attributed receiving review. The case's existing complete export carries this source and purchase association; the complete desk export carries the actual report bytes.

## Full handover and restore

**Export complete desk** verifies completed publications/receivings and freezes all original desk files into a complete manifest-bound ZIP. The archive must be outside the active desk. It includes original report products, catalogs, buyer configurations/handoffs, actual response ZIPs, receiving files/reviews and exact Operations request/receipt history. It excludes live lease files and incomplete atomic staging files. Previous external ZIP exports are represented by their original records rather than recursively embedding other archives.

An export snapshots the files before its own completion receipt. This avoids a self-referential manifest. The saved export request and exact manifest remain the original operation; completed export replay verifies its original archive and refuses a missing or changed one.

```bash
node cli.mjs export --desk /private/report-desk --input /private/export-request.json
node cli.mjs restore --desk /private/report-desk --input /private/restore-request.json
```

Restore requires the original full ZIP path, exact size/hash and a new destination. It delegates bootstrap recovery to the original Groundwater destination-intent helper and native lock. A stopped restore resumes that exact request; unknown files or a different archive are rejected. The returned `directory` is the restored desk. Open it with the installed reviewed code; no uploaded JavaScript or Python is executed.

The same desk and operation IDs are preserved. Completed publication/receiving reads verify their original artifacts. Old absolute source or external-export paths remain historical facts; completed frozen report reads use the restored relative files. Reconnect the original Operations server explicitly if further native case actions are intended.

## Merchant provider and file receiving

The source-owned `groundwater-reports` contribution registers the `groundwaterReports` provider using the maintained provider contract. The host configuration input is `groundwaterReportConnection`, a private file using `connection.example.json`.

Each alias pins the existing desk UUID and native directory. The provider refuses a changed desk. Source, installed code, original Inbox, export root and receiving root are administrator configuration, not caller-selected filesystem roots. File export/restore and buyer response destinations stay inside their configured roots.

Tools list desks, read native state/source/results, perform explicit original actions and receive original file ranges. File range reads use the maintained `RetainedFileReads` with a verified immutable native descriptor, the complete expected hash, original read ID and explicit release. They do not create another export or capture.

## Native continuation

`native-workflow.mjs` consumes an actual frozen report, original reviewed offer fields and explicit buyer intent. It runs native bundle/catalog/preparation, the real challenge-only service, and optionally the actual operator browser. It returns PREPARED_AWAITING_ORIGINAL_BUYER until the existing authorized buyer supplies its saved handoff and real response. No synthetic transaction is substituted.

Continuing the same input with that explicit receiving section verifies the original report/purchase, records the chosen receiving/Operations association, exports the complete desk and restores/reopens the original artifacts. The full source driver does not execute a solver or a buyer payment. The caller owns durable saving before its producing process ends.

No native Groundwater report purchase or report-desk receiving is claimed by source publication alone. The original scientific runtime remains its own recorded operation.
