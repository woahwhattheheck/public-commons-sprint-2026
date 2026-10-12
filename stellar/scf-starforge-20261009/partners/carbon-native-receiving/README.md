# Stellarcarbon and GiveCredit native receiving

Operation: `SCF-CARBON-NATIVE-8D45-20261012`.

This parcel contains the two complete Merchant applications, their original relative imports and browser assets, a current source comparison repair, the complete original customer handover and one native receiving caller. It uses the existing Node 22 or newer runtime, native Chromium and the already-installed `@stellar/stellar-sdk` 16.3 peer for mainnet acquisition.

## Source and receiving ownership

The source closure is pinned to Merchant merge `2c96fbc71b15c39082e695c66fdb9220d751c9ac`, containing Stellarcarbon PR 451 and GiveCredit PR 543. The comparison repair is merged in Merchant PR 647 (2df972e7de8aa0319e2247ca152c92781fa7c0f0) and Commons PR 2560 (f52b8968d19554c957271d859541db10c84f81a8). The source manifest explicitly identifies every merged full-file postimage and its original Git blob. Original application code, authored documentation and each carried file have exact byte lengths and Git blob SHA1 identities. All file contents are included.

Keep acceptance, the real host paths, the run and useful returned artifacts in the original PREP12 operation:
https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791839364496019?thread_ts=1791829516.730339

The private source page holds every required download:
https://app.notion.com/p/3f7dd7723100817c823fcba75f623f48?pvs=204

## Assemble the full source

Download the manifest, every source part it names, the three existing editable-handover parts, and `receive-source.mjs.txt` into one directory. Preserve the published filenames. The bootstrap checks every complete source part, exact file identity, source path, and handover-part and whole-handover SHA256 before writing a new private source directory.

```sh
node --input-type=module - /absolute/downloads /absolute/new-carbon-source < /absolute/downloads/receive-source.mjs.txt
```

The source directory must be new. The bootstrap creates its own receiving directory and reconstructs the original complete handover there. Its manifest also retains the original source pin and the ten complete comparison repair postimages.

## Run the native desks and whole receiving journey

Use the receiving host's actual Chromium path. If the Stellar SDK is installed elsewhere, pass the full path to its existing ESM entry point with `--sdk-module`; omit that option when the carried application resolves the installed peer normally.

```sh
node /absolute/new-carbon-source/receiving/receive-native.mjs --source-root /absolute/new-carbon-source --output /absolute/new-carbon-run --chromium /absolute/existing/chromium --sdk-module /absolute/existing/stellar-sdk/lib/esm/index.js --actor "Native receiving operator"
```

The output directory must be new and is created with private permissions. The caller performs these connected operations:

1. Receive and seal both complete original Stellarcarbon editions and all saved customer/project/assignment and statement versions in the native file store.
2. Serve the desk over its original HTTP API; traverse every source table; export original NDJSON and all 29 current API bodies; inspect the real November and July contributions, certificate 153331 and the repaired whole-edition comparison.
3. Export the five November and five July customer files and compare their actual bytes with the already-issued full files.
4. Receive the entire carbon handover into a second independent native directory, make the next operator edit, and preserve the original workspace and saved statements.
5. Receive both carbon sources into GiveCredit, acquire the complete original configured mainnet ledger with the shipped native collector, and optionally receive an existing authorized original registry export. Export the actual ledger, pools, original choices and a ledger-date donor statement with all nine native export files.
6. Receive the whole GiveCredit workspace independently, make the next operator edit, and preserve the first workspace.
7. Operate the actual Chromium forms: create and revise a customer and project from an unassigned original recipient and memo, assign the exact original contribution, preview and save two immutable statement versions, and download all five exports with completed native browser bytes. Compare both original editions and download their complete CSV and JSON.
8. Export and receive the complete carbon handover through the browser file input, make the next independent customer edit and retain its downloaded editable state. Open the original GiveCredit ledger and source-dated pools, export and reimport the complete original carbon edition, and retain its existing source identity.
9. Review the actual registry donation when an authorized registry edition is supplied. An existing original payment assignment can be revised; a new assignment is made only when an original direct receipt, successful transaction, network, payer, asset and amount uniquely identify the source payment. Revise and preview the native GiveCredit statement, download all nine files, and reopen its first immutable version.
10. Export and receive the whole GiveCredit workspace through the browser file input, save the next independent operator edit, and retain its complete downloaded state. Save screenshots and native browser observations throughout the original form journey.
11. Close every original server and reopen all four independently received stores. Read the preserved statement versions, complete original source identities, new customer edit and GiveCredit name against their actual browser-downloaded workspaces. Reopen the selected original accounting case and its saved invoice preview and schedules when configured.

To receive a complete existing ledger edition, supply `--ledger-source /absolute/original-ledger.json`. To include an authorized existing registry edition, supply `--registry-source /absolute/original-registry.json`. The source contracts preserve registry records and native ledger records separately.

To use a particular original capture selection, supply `--capture-options /absolute/capture-options.json`. The options are the original `captureLedger` API: network, networkPassphrase, rpcUrl, horizonUrl, archiveRpcUrl, contractId/contractIds, accounts, transactionHashes, from/before, startLedger/endLedger and original asset metadata. The default is the exact mainnet GiveCredit source deployment and original official RPC/Horizon/archive providers. The collector never signs or submits a transaction.

The optional `--from YYYY-MM-DD --before YYYY-MM-DD` controls the resulting donor statement's half-open reporting period; it does not silently trim acquired source relations. When omitted, the statement covers its retained original donor-call dates or the retained capture dates when no donor calls are present.

A provider interruption retains the entire native capture checkpoint in the run directory. Recover it through the same accepted operation with `--capture-checkpoint /absolute/prior-run/givecredit-ledger-capture-checkpoint.json`; use a new receiving output directory for the recovered attempt and preserve the earlier one. The original capture query and selected bounds must match. Inspect any existing live process before starting another attempt.

Add `--keep-open` to leave the two browser-received desks open after the completed journey and archive. The caller prints their actual loopback URLs and writes a sibling `.live-reopened.json` before waiting for SIGINT or SIGTERM. The closed receiving snapshot and its complete archive remain available.

## Actual original data and worked periods

The April 14 published backup preserves seven NDJSON tables at `stellarcarbon/sc-data@d7c10873e98993616af561dd3d00a6e0ae81e3cc`. The current mainnet edition was acquired from 21:04:15 to 21:20:08 UTC on October 12, 2026. It retains 40 contributions, 25 certificates and 44 allocation rows, all original request URLs, both terminal empty list responses and every certificate detail. Totals are 52.440 CARBON contributed, 52.000 allocated and 0.440 remaining.

The full handover SHA256 is `e0b77bcbea5bc6ffe67d504013477e7cfc12b64fb89e63dd5603a4fdc4d95e1c`. It retains both source seals and November versions 1 and 2 plus July version 1. Its source-derived customer label groups original recipient GC53…FXZ6Y; the project describes its original natural-gas contribution memos.

The current November statement is 1.177 contributed, 1.177 allocated and zero remaining. Certificate 323885 allocated 1.019 on February 13, 2026; certificate 153331 allocated the final 0.158 on July 23. Its November retirement-date register has zero certificates.

The July statement is 3.282 contributed, 2.842 allocated and 0.440 remaining. Its separate retirement-date register includes certificate 153331 once at 3 VCUs. That certificate's allocation rows divide 0.158 to November and 2.842 to July.

Fresh acquisition starts both native lists from the beginning and follows terminal pages and relation closure. Certificate 153331 is lower than the prior edition's maximum certificate ID, so a maximum-ID incremental shortcut would miss the real November completion. The checkpoint is for resuming the same capture.

## Source comparison behavior

The API edition covers five tables. Distribution and minted-block tables are unavailable there; their earlier source counts remain visible without fabricated deletions. Exact decimal equivalence applies only to original amount fields. Date-only equivalence applies only to declared civil dates and their original naive midnight representation; timestamp and timezone changes remain material. Formatting and field availability have their own retained source differences.

The current provider explicitly reports seven instrument metadata pairs with year 0001 and zero total vintage quantity, plus one changed instrument total. Both desks preserve these eight original reported changes and label source placeholders. Certificate VCUs and transaction allocations remain separate original values. JSON and comparison CSV retain the complete original before/after details.

## Returned artifacts

The run directory contains the useful reports and original files, whole source editions, complete original and received handovers, private editable workspaces, screenshots, browser observations and `receiving.json`. After Chromium and all stores close, the caller streams this whole operated directory and the complete received application source into a sibling `.tar.gz` archive, with a complete original member inventory and SHA256 descriptor. The descriptor is outside the archive so its archive digest cannot refer to itself. The latter records the actual stage results, runtime, paths and exact output digests. Use `--archive-path /absolute/sibling/carbon-native-receiving.tar.gz` to select the final archive location. It must be outside both the operated output and the received source root. The default is the output directory name followed by `.tar.gz`. The matching `.tar.gz.json` descriptor contains every original member, byte count and digest; `_delivery/ORIGINAL_MEMBERS.json` is also embedded in the archive. Preserve the full archive and descriptor through the native host's existing durable file route and return their actual file IDs, hashes and useful source diagnostics in PREP12. Keep company-facing delivery with root8D45.

All three original application guides are retained in the parcel. No repository-wide build or test suite is part of this operator journey.

## Existing maintained accounting case

The host can add `--accounting-directory /absolute/original-maintained-accounting` and its source binding through `--expected-accounting-workspace-id` and `--expected-accounting-sources-sha256`. The original workspace and its lease remain authoritative. Its original customer and plan selection is saved in the receiving output.

Use `--accounting-config /absolute/selected-original-case.json` for the selected original source customer and proposed billing terms. Its fields are:

- `customerId`: the actual maintained accounting customer; if omitted, an exact original recipient reference can select an existing record.
- `carbonCustomerId`, `statementId`, `statementVersion`: the actual retained source customer and saved report.
- `createCustomerFromRecipient: true`: an explicit operator instruction to save a customer grouping from the original recipient label and reference when that record is new.
- `invoice`: the proposed service fee, `currency:{code,scale}`, `issueDate`, `dueDate` and note selected for the internal draft. Root's current Stellarcarbon offer is EUR 1,500 with two EUR 750 commercial milestones. These are proposed terms.
- `plan`: an optional complete native schedule-generation selection against an already-issued original invoice for that same customer, including invoiceId, balanceDate, firstDueDate, count and one of intervalMonths/intervalDays.

The caller links the actual customer, saves a revised carbon statement while preserving the issued customer-file versions, creates or recovers the original invoice draft, exports its whole HTML/JSON/CSV preview, and reads all existing schedules and retained schedule files for that customer. A selected original issued invoice can receive a new schedule draft and its original review. Invoice issuance, payment entry and schedule activation stay with the actual case's native operation and source events. The run records the accounting source/case selection state explicitly alongside the two application results.
