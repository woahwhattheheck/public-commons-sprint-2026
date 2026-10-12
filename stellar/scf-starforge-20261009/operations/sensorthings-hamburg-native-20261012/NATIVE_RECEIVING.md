# Receive the original Hamburg operation

The source operation is `SCF_SENSORTHINGS_HAMBURG_NATIVE_1B40_20261012`. The complete immutable recording contains **28 native-consumable original responses**; the separate twelve-row discovery page remains in the full source package. The recording contains the service root, selected catalogue page, two opening/closing stream brackets, both complete seven-page windows and each selected entity graph.

| Recording identity | Value |
| --- | --- |
| File | `native-recording.json` |
| Complete bytes | 2965230 |
| SHA-256 | `34fb0322092a51525e94beda0d6c3b21548b7261d65d80909b27eb6fa6a2d466` |
| Git blob | `4b9e8382f140101fc2279ce4b18f00826382fb61` |
| Representation | Complete original connector UTF-8 text, with both full original tool responses |
| Provider HTTP method, status and headers | Not exposed; unknown |

## Original operation and workspace

Use the maintained SensorThings source at the immutable commit containing this guide. Its normal source dependencies and installation remain those of the existing SCF package. `receive-hamburg.mjs` uses `openSensorThingsWorkspace`, the original capture queue, native SF30 dataset preparation and the original complete source exporter. It adds no store, scheduler, provider credentials or new HTTP client.

The source and catalogue action payloads and operation IDs match the original capture work order. The fixed-window plan and the two captures have explicit new phase suffixes:

- `_SOURCE` and `_CATALOG`: original source and catalogue selection.
- `_PLAN_WINDOW`: the complete fixed query.
- `_WINDOW1_CAPTURE` and `_WINDOW2_CAPTURE`: the two distinct actual acquired editions.
- `_COMPARE_WINDOWS`: the native comparison.
- `_WINDOW1_REVIEW` / `_WINDOW2_REVIEW`, followed by `_DATASET` and `_EXPORT`: the exact source review and complete native delivery artifacts.

The recording selects repeated URL occurrences by their actual source position. Reopening validates native request/response identities and reconstructs which original occurrences were consumed. It never fetches a replacement if a response is absent. The recording and original filenames, clocks, counts and SHA identities remain intact.

## Receive both complete source editions

Choose the same private native workspace already assigned to this operation. Keep this operation with its existing host owner; do not run a second writer against that workspace.

From the selected package source root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/receive-hamburg.mjs \
  --workspace /absolute/original/hamburg-workspace \
  --recording /absolute/source-package/native-recording.json \
  --sha256 34fb0322092a51525e94beda0d6c3b21548b7261d65d80909b27eb6fa6a2d466 \
  --bytes 2965230
```

The command receives both complete original source editions, runs the existing native comparison, retains its actual result in the original workspace and returns actual workspace, plan, capture and edition IDs. It checks 660 unique string-valued observations per edition, the full selected recording closure and the unchanged original comparison.

The script refuses a different source identity, unexpected native rows, unresolved failed source attempts or a comparison that disagrees with the retained originals. The retained workspace remains available for source inspection. No later same-URL source response is substituted for a failed request.

After a process interruption, reopen **the same path, recording and command** with `--resume`. This follows its original interrupted queue. A failed original request requires inspecting its retained error; the script does not silently retry it or advance to another source occurrence.

## Review the actual native editions

Read the returned summaries and source warnings first. The source report's analysis IDs are not native edition IDs. Bind the review to the actual returned edition IDs:

```json
{
  "schema": "stellar-forge.sensorthings-hamburg-review.v1",
  "operationId": "SCF_SENSORTHINGS_HAMBURG_NATIVE_1B40_20261012",
  "actor": "THE RESPONSIBLE RECEIVING OPERATOR",
  "editions": [
    {
      "window": "window-1",
      "editionId": "ACTUAL FIRST NATIVE EDITION ID",
      "decision": "accept",
      "note": "The complete original query, category meanings, acquisition receipts and observed coverage were reviewed. Point observations do not establish duration, availability, utilization or provider QA.",
      "acknowledgeIssues": []
    },
    {
      "window": "window-2",
      "editionId": "ACTUAL SECOND NATIVE EDITION ID",
      "decision": "accept",
      "note": "The second complete window and original source warnings were reviewed. Observation records are unchanged; closing source metadata extends beyond the fixed window. No atomic snapshot or state duration is claimed.",
      "acknowledgeIssues": []
    }
  ]
}
```

This is a shape example, not a completed review. Use the responsible operator's actual identity, substantive notes and the exact issue codes they reviewed. The existing engine requires all non-notice source warnings and row issues to be acknowledged before acceptance. Do not populate issue acknowledgements from an unseen report.

Repeat the same command with `--review /absolute/operator/hamburg-review.json`. It reuses both completed capture operations, records the two exact reviews, prepares the native observations datasets and exports each full original source edition with its source objects and review history. The result lists the actual source-transfer and dataset file selections and complete file identities.

This internal acceptance applies to the retained source edition. It does not assert publisher QA approval, validate an inferred current operator or approve a customer commercial engagement.

## Deliver the full source and native dataset through the maintained client

The command returns the original source export IDs and dataset IDs. Select one returned file group using the current private workspace connection:

```json
{"kind":"transfer","id":"ACTUAL SOURCE EXPORT ID"}
```

or:

```json
{"kind":"dataset","id":"ACTUAL NATIVE DATASET ID"}
```

Use the existing `sensorthings inspect-download` and `sensorthings download` commands against the original listener, with the actual manifest ID/hash and a new receiving directory. The full installed client and held-file resume examples are in [DISTRIBUTION.md](../../sf30-seller-sdk/sensorthings/DISTRIBUTION.md) and [RECEIVING.md](../../sf30-seller-sdk/sensorthings/RECEIVING.md).

The complete source archive can be selected from the receiving host's source inbox through the existing `edition.import` action. Match its original filename, bytes and SHA-256. The receiving workspace verifies the whole declared closure and retains the original review as receipt evidence. A receiving operator makes their own review; an existing edition's current local review/history is preserved.

The original `release.prepare`, managed release lifecycle, publisher buyer actions and SF88 `buyer.receive` remain available for actual merchant/customer acquisition. Use the host-bound original buyer workspace, concrete selected release and explicit payment configuration. This source receipt does not create a paid offer, signature, reservation, payment or customer acceptance.

## Operational report and analysis integration

[The completed source report](reports/window-1/index.html) and both full JSON/CSV results were calculated from the exact originals in Functions V8. Native intake validates the independent existing-engine representation; it does not rewrite those earlier source calculation receipts.

The reusable `operational.mjs` accepts the exact complete source texts and acquisition receipts identified in `report-recipe.json`. Its `analyzeStatusWindow`, `compareStatusWindows` and `statusWindowTables` functions preserve string codes, original time fields and unknown validity intervals. `operational-report.mjs` renders the complete source-linked result without external scripts. The original Helgoland analysis and managed Desk joins consume the same native editions and writer; categorical strings must not pass through numeric `parseFloat` chart paths.

## Reproduce the complete report from retained sources

The standalone report CLI reads `report-recipe.json`, validates the complete declared original body/receipt closure, calculates both windows with the existing exact-number/time functions, checks their selected analysis/result/comparison identities, and exports the complete originals, JSON results, ten CSV tables and offline HTML to a separate directory. It does not open a SensorThings workspace or contact a provider.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sensorthings/status-report.mjs \
  --sources /absolute/source-package \
  --recipe /absolute/source-package/report-recipe.json \
  --out /absolute/new/report-delivery
```

Its `operation.json` binds the original recipe, source manifest and actual runtime module bytes. Completed outputs reopen only after all saved file identities match. Interrupted output prefixes remain separate; the same operation publishes only matching complete files. A completed Node reproduction has its own actual execution receipt and does not replace the earlier Functions V8 receipt. The exact source used for the earlier published calculation and HTML is retained under `calculation-source/`; the current renderer takes an explicit execution note for later callers.

## Current evidence

The complete acquisition, exact-source calculation, source-only receiving review and Git publication are complete. The native receiving command is prepared and V8 syntax-parsed, but native module loading, actual workspace receiving, browser inspection, archive restore and merchant/customer acquisition have **not yet executed** for this operation. Their actual receipts will be added after the same assigned host completes them. The original acquired source and report identities are already immutable and do not depend on that later execution.
