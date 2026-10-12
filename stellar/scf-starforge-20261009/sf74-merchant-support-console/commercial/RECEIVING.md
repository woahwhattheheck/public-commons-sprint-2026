# Complete quotation receiving and pricing recovery

The original SF74 commercial application can retain a quotation with the complete SF97 workspace that produced its selected route prices. This companion captures the selected saved plan, attaches the original pricing and cost backup to the same merchant case, carries it through the existing full case/source package, and reopens that plan and its supplier originals at the receiving end.

It uses the existing [commercial application](../COMMERCIAL.md), [case package](../CASE_SOURCE_PACKAGE.md), [SF97 planning model](../../sf97-merchant-revenue-ops/PLANNING.md) and [supplier-cost workspace](../../sf97-merchant-revenue-ops/economics/README.md). The pricing model continues to calculate route prices, the case store continues to own revisions and history, the case-package engine continues to own complete delivery, and the original cost archive engine continues to inspect and restore its own backup.

## What travels together

| Retained item | Native source | Receiving check |
| --- | --- | --- |
| Selected plan and scenario | The original saved SF97 planning record | Original plan identity, selected scenario, save request and reproduced source review |
| Seller, terms, observation and pricing manifest | That plan's saved pricing version | Complete original bytes, lengths and SHA-256 values |
| Pricing and cost workspace | Original `WORKSPACE_BACKUP` export | Complete native TAR, manifest, export request and SHA-256 |
| Applied supplier costs | The pricing version's original `costOrigin` | Cost-edition manifest, four saved supplier-cost files and every bound original supplier file/receipt |
| Quotation and responses | The original SF74 commissioning materials | Exact quotation ID/hash and preserved source-case identity |
| Case and source history | The existing full case/source package | Complete retained case history, all source editions and every native original, including unattached files |
| Receiving case | Original case-package receiver | Native new local case UUID, imported revision and unchanged original case lineage |
| Reopened commercial workspace | Original SF97 restore and planning APIs | Same saved plan, scenario, version, source identity, cost edition and supplier originals |

The native planning download is the original plan record. Its private stored file contains that same record inside the original hash envelope. The adapter checks both representations correctly; it does not replace the stored envelope with the downloaded view.

A cost quotation remains a quotation after receiving. A supplier bill, credit note or cost source keeps its original kind and currency. A technical receiving result does not add a payment, supplier debit, customer response or service activation.

## Open the original operator first

Use the existing Support listener with its private case directory, then open `/commercial`. The commercial page provides case selection, saved pricing-source review, implementation and service fees, explicit route volumes, quotation previews, immutable published editions, customer responses and exports.

Use the source-native selection that belongs to this merchant. Review the seller and route identities, the actual observation interval, the selected source version and the supplier-cost basis. An operator binding reason records why this saved pricing source belongs with the selected case; it does not change those original identities.

The commands below can be run from the `sf74-merchant-support-console` directory:

```sh
node commercial/receiving-cli.mjs --help
```

All file and directory arguments are absolute, normalized private paths. Commands do not accept credentials, provider keys, an arbitrary replacement pricing file or a replacement seller URL. Keep each full package, receiver workspace and restored pricing workspace in its own private directory. The original case-package checks enforce source/receiver separation.

The examples use shell variables for real selections made by the operator. A value such as `$QUOTE_SHA` means the exact SHA-256 returned for the selected original quote, not a placeholder to invent.

## 1. Capture a saved plan and the complete original backup

Select an already saved plan in SF97. `--scenario-id` is optional: omission keeps that plan's saved selection, or its original baseline when no scenario was selected. The backup request is a new UUID dedicated to this original export.

```sh
node commercial/receiving-cli.mjs capture \
  --pricing-directory "$PRICING_WORKSPACE" \
  --pricing-config "$SAVED_SELLER" \
  --pricing-snapshot "$SAVED_OBSERVATION" \
  --plan-id "$PLAN_ID" \
  --backup-request "$BACKUP_REQUEST" \
  --out "$RECEIVING_SOURCE"
```

For an original saved history source, supply `--pricing-history` instead of `--pricing-snapshot`. Exactly one is required. No live Operations URL is accepted here.

This action reads the original saved plan/version and calls the existing full-workspace backup export. It creates four retained files:

| File | Contents |
| --- | --- |
| `receiving-source.json` | Completed request and exact original file/selection bindings |
| `pricing-source.json` | The commercial model's complete original five-file selected source |
| `pricing-workspace.tar` | The original full SF97 workspace backup, unchanged |
| `backup-receipt.json` | The original backup export receipt, unchanged |

The returned `sourceSha256` identifies `receiving-source.json`; it differs from the selected pricing source ID and the TAR SHA-256. Retain all three identities.

The completed source index is written last through the original case artifact writer. Retrying the same plan, scenario, backup UUID and destination reopens the completed files. Once that source is complete, replay does not require the authoring paths to remain in place. An unfinished capture still uses its original selected inputs and cannot overwrite different retained bytes.

The inline archive uses the original 48 MiB individual-material limit. Existing commissioning materials and their Base64 encoding must also fit the original 64 MiB commissioning limit. A new attachment may therefore need less than 48 MiB of remaining capacity. If the original backup is larger, it remains available from the cost export workspace; use the existing native source-bundle delivery owner for the larger original. This companion does not truncate, split, or silently omit part of a workspace.

## 2. Inspect the exact receiving source

```sh
node commercial/receiving-cli.mjs inspect-source \
  --from "$RECEIVING_SOURCE" \
  --source-sha "$SOURCE_SHA"
```

Inspection reads all retained pricing/receipt files and streams the complete original archive inspection. It checks the selected plan's native envelope, each source pricing file, and any applied cost edition with all of its original supplier file and receipt bindings.

The CLI returns the complete selection and file descriptors. The original file contents remain in the retained source directory. The library API also returns the exact five-file pricing source for the original commercial receiver.

## 3. Attach the original source and backup to the same case

Open the case in the commercial page or read it through the existing `merchant-commercial read` command. Review its current revision and the merchant/source relationship.

```sh
node commercial/receiving-cli.mjs attach \
  --cases-dir "$SENDER_CASES" \
  --case "$SENDER_CASE_ID" \
  --revision "$REVIEWED_CASE_REVISION" \
  --from "$RECEIVING_SOURCE" \
  --source-sha "$SOURCE_SHA" \
  --pricing-request "$PRICING_RECEIVE_REQUEST" \
  --attachment-request "$BACKUP_ATTACH_REQUEST" \
  --actor "$OPERATOR" \
  --binding-reason-file "$BINDING_REASON_FILE"
```

Use `--binding-reason` for literal text instead of the file option. Exactly one is required; the reason is limited to 4,000 UTF-8 bytes. Both request values are distinct UUIDs. The operator name uses the original 200-byte limit.

Two native operations are retained:

1. The original commercial model receives the exact selected pricing file under `pricing-request`.
2. The original commissioning model attaches the complete TAR under `attachment-request`.

The archive material retains the selected source ID, backup UUID/hash/size, original workspace snapshot, applied cost origin and explicit binding reason. Its original archive bytes are retained in the original commissioning blob store. The case store preserves all earlier service, implementation, quote, response and source history.

If the first operation succeeds and the second is interrupted, repeat the same command with the original reviewed case revision and both original UUIDs. The commercial receiver recovers its first operation before checking the current revision. The attachment then uses the current native case revision and its own original request. A UUID reused for different source bytes, actor, reason or archive is rejected.

Refresh the commercial page after attachment. The pricing source is now available in the existing quotation source selector. The archive appears with the case's original materials.

## 4. Review scope and publish the original quotation

Use the existing commercial page or `commercial-cli.mjs` actions to:

- Choose the case's actual implementation and service source editions when they apply.
- Select the retained SF97 pricing source.
- Enter explicit monthly request volumes for every selected route.
- Review the complete customer scope, deliverables, exclusions, payment and acceptance terms.
- Preview, then publish the exact reviewed draft with the original preview hash and request UUID.

Implementation and service fees use the original commercial model. Route prices and route economics use the original SF97 model. Missing supplier costs or an unavailable observation denominator remain visible in the original pricing review; an import does not fill them with zero.

A published quotation is immutable. A scope, volume, fee or source correction creates a new quotation edition with its original parent. Preserve the old edition and responses. Do not overwrite the old supplier CSV, saved cost edition or pricing version to make an existing quote look current.

Record a customer response only when it was actually observed. The original `receive` action requires the exact quote ID/hash, response status, observed timestamp and source/reference. Technical receiving and internal operator review belong to their actual native records; they must not be presented as an outside customer's acceptance.

## 5. Inspect and export the selected quotation with complete case history

```sh
node commercial/receiving-cli.mjs inspect-case \
  --cases-dir "$SENDER_CASES" \
  --case "$SENDER_CASE_ID" \
  --revision "$DELIVERY_CASE_REVISION" \
  --quote "$QUOTE_ID" \
  --quote-sha "$QUOTE_SHA" \
  --archive-sha "$ARCHIVE_SHA"
```

For a quotation with pricing, the adapter requires its complete original backup. If that source has multiple retained backups, `--archive-sha` chooses the exact one. A quotation without pricing can use the same complete-case package without a pricing archive.

```sh
node commercial/receiving-cli.mjs export \
  --cases-dir "$SENDER_CASES" \
  --case "$SENDER_CASE_ID" \
  --revision "$DELIVERY_CASE_REVISION" \
  --quote "$QUOTE_ID" \
  --quote-sha "$QUOTE_SHA" \
  --archive-sha "$ARCHIVE_SHA" \
  --source-dir "$SENDER_NATIVE_SOURCES" \
  --out "$COMPLETE_CASE_PACKAGE" \
  --export-id "$CASE_EXPORT_ID"
```

`--source-dir` is needed when the case history references native source bundles. It may be omitted for a case containing only inline original files. The original source owner determines any Python/native prerequisites. `--python` forwards the selected interpreter to that existing factory. `--generated-at` pins the native export time when the caller requires it; otherwise the original exporter retains its first time for replay.

This delegates to `exportCaseSourcePackage`. It exports the full reachable original case history, its source bundles and all original files through the same native engines. It does not create a quotation-only archive. The exact chosen quote and pricing archive are returned alongside the original complete-package manifest SHA-256.

Keep the **whole directory**, including `case-source-package.json`, original case store/history, native source archives and inline originals. Sending only the displayed quote or only `merchant-workspace.json` does not carry that full package.

## 6. Receive into an independent native case and source store

```sh
node commercial/receiving-cli.mjs receive \
  --from "$RECEIVED_COMPLETE_PACKAGE" \
  --sha256 "$CASE_PACKAGE_MANIFEST_SHA" \
  --out "$PACKAGE_RECEIVING_STATE" \
  --cases-dir "$RECEIVER_CASES" \
  --source-dir "$RECEIVER_NATIVE_SOURCES" \
  --request-id "$CASE_RECEIVING_REQUEST" \
  --actor "$RECEIVER" \
  --quote "$QUOTE_ID" \
  --quote-sha "$QUOTE_SHA" \
  --archive-sha "$ARCHIVE_SHA"
```

The adapter first pins the exact selected quote and archive in the original complete-package manifest/workspace. It retains that selection and delegates all copying, native source receiving, history preservation, original-file verification and case creation to `receiveCaseSourcePackage`.

The result returns the native receiving case UUID, imported revision, current revision, original case history and the selected quote's original source-case identity. The imported quote is not rewritten to make it appear authored in the receiver's new local case.

Repeat the same request, actor, package SHA, quote SHA, archive SHA and receiving directories after interruption. If the native receiver has already retained the full package, replay uses those files even if the sender directory moved. The original receiver preserves legitimate later edits to the receiving case; the adapter verifies the imported quotation at its imported revision.

Open that new case through the original Support listener and `/commercial`. Both old and later quotation editions, their original responses, selected pricing source and full history remain inspectable.

## 7. Restore and reopen the original pricing and cost workspace

Use the receiving case UUID and imported revision returned by step 6:

```sh
node commercial/receiving-cli.mjs restore-pricing \
  --cases-dir "$RECEIVER_CASES" \
  --case "$RECEIVER_CASE_ID" \
  --revision "$IMPORTED_CASE_REVISION" \
  --quote "$QUOTE_ID" \
  --quote-sha "$QUOTE_SHA" \
  --archive-sha "$ARCHIVE_SHA" \
  --archive "$RETAINED_ARCHIVE_FILE" \
  --out "$RESTORED_PRICING_WORKSPACE"
```

Keep the retained archive outside the restore destination. The archive is recovered from the case's original material bytes and published create-only. The native `restoreCostWorkspace` performs the full restore and its own interrupted-restore recovery.

The adapter then opens the original SF97 model using the selected restored version's seller and snapshot/history files. It opens the original planning model and reproduces the exact five-file commercial source. For a cost-linked pricing version it also reopens the exact cost edition and hashes every bound supplier original. The output returns the original plan/scenario/version IDs, cost-edition identity and the correct restored source paths for the normal SF97 operator.

This is a local source/workspace restoration. It starts no seller, facilitator or buyer, changes no live price and makes no provider request. A later live installation or price release follows the existing native operator's explicit selection and process.

## Corrections and interruption recovery

| Situation | Original continuation |
| --- | --- |
| Source capture completed; authoring paths moved | Repeat capture with its original plan, scenario, backup UUID and destination, or inspect the retained source |
| Pricing received; archive attachment interrupted | Repeat attach with both original UUIDs and the same source/reason/actor |
| Quote or case changed after review | Read the current native revision and review a new intended operation; preserve the previous quote |
| Supplier original or allocation needs correction | Retain a new source/cost edition in SF97, save the original new pricing/plan, capture a new backup and publish a child quotation |
| Complete package export interrupted | Repeat the same native export ID, selected case revision and directory |
| Package received but sender folder disappeared | Repeat the original receive request against its retained receiving directory; the native receiver reuses the retained package |
| Receiving case has later edits | Inspect the imported revision for delivery identity; the current case keeps its legitimate later history |
| Archive restored but response was lost | Repeat native restore with the same archive hash and destination; reopen the same plan/source |
| Selected destination contains different bytes | Preserve it and use the matching original destination or a new explicitly selected destination; no overwrite occurs |

All commands accept `--report FILE`. The first complete report contains the exact command request and full result. It is retained through the original atomic case writer. Same-request retries preserve that first report while returning current native results; a different request cannot replace it. The report is a convenience for operating records, not a replacement for the native case, package, archive or receiving state.

## Callable integration contract

Import from `commercial/receiving.mjs`:

| Function | Purpose |
| --- | --- |
| `captureCommercialReceivingSource({model,planning,planId,scenarioId,backupRequestId,directory})` | Retain the existing selected plan and original full backup |
| `inspectCommercialReceivingSource({directory,expectedSourceSha256})` | Verify all receiving originals without mutating a case |
| `attachCommercialReceivingSource({store,casesDirectory,id,expectedRevision,pricingRequestId,attachmentRequestId,actor,bindingReason,directory,expectedSourceSha256})` | Use the original pricing receive and commissioning material operations |
| `inspectCommercialCase({store,casesDirectory,id,revision,quoteId,quoteSha256,archiveSha256})` | Review exact case, quote, pricing and original archive identities |
| `exportCommercialCasePackage({store,casesDirectory,id,revision,quoteId,quoteSha256,archiveSha256,directory,exportId,sourceDelivery,generatedAt,python,environment,signal})` | Delegate complete native case/source export with quote selection |
| `receiveCommercialCasePackage({directory,receivingDirectory,casesDirectory,sourceDelivery,requestId,actor,expectedManifestSha256,quoteId,quoteSha256,archiveSha256,python,environment,signal})` | Delegate original independent receiving and compare retained quote/backup identity |
| `restoreCommercialPricingWorkspace({store,casesDirectory,id,revision,quoteId,quoteSha256,archiveSha256,archive,directory})` | Restore and reopen the complete original SF97 workspace |

`sourceDelivery` is the actual `createCaseSourceDelivery` result, including its original directory, service and source resolvers. Its owner closes it after the operation. The CLI opens and closes that same factory; it creates no second archive service.

`commercialReceivingCli(argv, {environment, signal})` is exported from `commercial/receiving-cli.mjs` for the existing command owner to forward. All model inputs, private paths and receiving selections remain host/operator controlled.

## Working with retained original operating data

The completed Commons native06 cost workflow has an original saved plan, cost-linked pricing version and complete 42-file backup. That is a coherent input for this companion's matching merchant case. Its original supplier tariff source remains a quote and its original native observer result retains its operated transport classification. Reusing those inputs for a quotation and independent restore adds no new acquisition, provider debit, chain transaction or customer purchase.

An unrelated merchant case must use its own source and scope. Preserve original customer identity and responses, and label internal operator receiving by its actual role. The software supports full customer delivery; an application demonstration does not itself establish external customer acceptance.
