# Runtime support in the merchant case desk

The existing SF74 case carries a merchant's original runtime packet or retained usage period, its repair follow-up, native delivery reconciliation and operator ownership. The original SF30 history producer, SF93 collector and SF97 analyzer/reconciler remain responsible for their source products. SF74 imports their exact files and connects them to its saved case lifecycle.

## Collect from the existing seller

Use the seller and operations addresses printed by the original SF30 or native commerce launcher. The existing collector reads only the original health, offers, snapshot and metrics endpoints:

```sh
node stellar/scf-starforge-20261009/sf93-seller-support-bundle/bundle.mjs \
  --seller http://127.0.0.1:8423 --ops http://127.0.0.1:8424 \
  --out /private/support/merchant-before
```

The parent directory must exist; the output directory is create-only. Keep all four resulting files together: `bundle.json`, `operator-brief.md`, `metrics.prom` and `manifest.json`. For a follow-up, use a new output directory. An existing retained packet can be imported without collecting again.

Start the same merchant case desk with Node 22 or newer:

```sh
node stellar/scf-starforge-20261009/sf74-merchant-support-console/server.mjs \
  --cases-dir /private/merchant-cases --port 8784
```

## Attach, review, save and resume

1. Open the merchant case or start a new one. Enter the actual route and buyer settings in **Diagnose**, and record the owner, next action and follow-up in **Cases**. You can use runtime support without running a diagnosis.
2. In **Runtime**, select the four original packet files together. Choose **Inspect selected files**. SF74 checks original file hashes, manifest/session agreement and the original runtime structure before offering its advertised routes.
3. Select the route matching the current case method and choose **Attach to case**. This explicitly maps an operator-provided packet to the current case. The packet does not contain or independently establish the public merchant origin. The mapping retains the exact case inputs; subsequent input changes visibly separate the saved capture from the current case.
4. Review selected-route HTTP outcomes and the original runtime alerts. For a repair follow-up, select **After / follow-up** and import a new original packet. The interval view subtracts cumulative counters only within the same observer session, start time, seller mode and unchanged case mapping, in chronological order with no counter regression. A restarted seller has a separate window. Observer errors or detachment remain visible. Starts and finishes in an interval can belong to different requests.
5. Choose **Save case**. The original bytes and mapping are saved under the same revision as the workspace and follow-up metadata. An interrupted or stale save preserves the existing case and browser draft. Selected files must be attached or explicitly cleared before saving so they cannot be silently omitted.
6. Reopen the case after restart, or open an earlier **Saved version**. Runtime source checks and the original native reconciler run again on the retained files. Opening an earlier version creates a draft; saving it retains all intervening history.

Each attached capture has original-file downloads. **Remove before/after** removes a capture from the current draft only; a later save preserves the old capture in prior versions. No journal writer or merchant control is opened by intake, save, reopen or review.

## Optional original native delivery records

Attach all three optional files to a runtime capture:

| File | Original source |
| --- | --- |
| `report.json` | SF97 `analyze.mjs` report from the same original seller session and configuration |
| `events.ndjson` | Copied original SF98 native-success event journal |
| `deliveries.ndjson` | Copied original SF98 delivery-state journal |

Use a coherent retained journal pair. Empty journals are permitted; incomplete final records, conflicting event IDs, orphan delivery records and invalid original states are rejected by the original native reconciler. SF74 does not open the live outbox to obtain these files or synthesize a revenue report from the smaller SF93 packet.

The integration calls the original `sf97-merchant-revenue-ops/native-reconcile.mjs` **reconcile(report, events, deliveries)**. Original method, network, asset, amount, recipient-option matching and delivery outcomes stay intact. The UI shows the selected route's native notices, inbox acceptance, pending/exhausted delivery, event assignments and original repair flags. The complete original files remain retained for wider accounting review.

A same-session SF97 report can have a different capture time. Its own window is displayed; an exact source-snapshot match is distinguished from a separate snapshot in that session. HTTP counters are never assigned to a payment option, callback acceptance is not treated as customer fulfillment, and the case workflow status is not changed by a diagnostic result.

## Support a merchant across restarts

Use **Retained period across restarts** when a case needs the original saved usage history rather than one process snapshot. Obtain `history.json` from the existing operations console or its `/history.json?from=YYYY-MM-DD&to=YYYY-MM-DD` endpoint. Its optional `routeId` selects one original route. Keep the export unchanged and create the matching original SF97 report:

```sh
node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/analyze.mjs \
  --config /private/merchant/seller.json \
  --terms /private/merchant/pricing.json \
  --history /private/captures/history.json \
  --output /private/reviews/NEW-support-period
```

The original [SF97 period guide](../sf97-merchant-revenue-ops/README.md#review-a-retained-period-across-seller-restarts) covers history retention, live selection and merchant pricing. A saved pricing-workspace version also provides its original `history.json` and `report.json` downloads. The case desk does not rebuild a pricing report from counters or create a replacement support packet.

1. Set the case's actual method and resource. In **Runtime**, choose **Retained period across restarts** and the baseline or follow-up position.
2. Select `history.json` and its matching `report.json` together. Optionally choose both copied original SF98 journals. Journals are a pair; omitting them means native delivery was not supplied, while supplying two empty files represents an actual empty source pair.
3. **Inspect selected files** checks the exact history SHA-256 in the SF97 report, normalizes both original history representations, and calls the existing native reconciler for its report, route and complete payment-option checks. A report created from a different export is rejected even when the date labels or totals look alike. Original seller/terms hashes remain attached; the case mapping itself does not authenticate a public merchant.
4. Select the exact retained method and path. Current configured routes, older path/method variants and removed routes remain distinct. A current route with no saved observations is explicitly labeled; its absence is not measured zero traffic. Changing a path or case mapping never silently moves observations to a current quote.
5. Attach and review. The case shows original UTC days, saved session states and intervals, selected-route membership, all retained variants for the route, original payment-option identities, native event decisions and excluded-event reasons. Per-day starts and completions may belong to different requests. P95 is the original aggregate histogram bound.
6. Save the case, reopen it or an earlier saved version, and prepare the same complete support handoff. The original history, report and optional journal bytes remain downloadable and accompany the existing notes, owner and follow-up. You can remove a draft attachment while keeping earlier saved versions.

The original history validator checks retained day/route/session structure and aggregate conservation; SF74 does not create another history writer. Modern history exports carry exact per-session UTC day/route membership. Earlier original exports remain supported with their coarser session/day coverage. Interrupted checkpoints end at their saved capture times; quiet gaps between sessions remain gaps. An active session's retained counters also stop at its captured checkpoint. Reopening a case reads its saved files without polling a merchant.

### Compare a repair over time

Two period attachments for the same case inputs and exact method/path show their independent observed counts and response shares. When the first selected UTC period ends before the second starts and both retain the selected route, the view also shows changes in percentage points for 2xx, 402, 5xx and disconnected shares. HTTP shares use actual response counts; disconnect share uses completed outcomes. Empty denominators remain unknown. Differences do not establish that a repair caused a change in traffic.

Overlapping or reversed selections display both original periods without subtracting totals or claiming a rate change. They may include the same requests or native events. Different method/path variants, case mappings, or a process packet paired with a period retain separate views. The existing same-session SF93 before/after counter subtraction is unchanged.

For a current selected route, native assignment uses the original SF97 complete option and recipient identity together with actual saved session/day/route coverage. The existing reconciler leaves events in session gaps, outside the selected dates/route, or without saved route coverage out of its option totals. Older or ambiguous route variants remain unassigned. A case mapped to a historical path can inspect those event decisions; current saved payment-option outcomes are labeled as current reference data. Atomic quantities remain separate for every native option. No report total is summed across the two attachments.

### Original incident handoff

The existing SF93 incident operator can continue importing its unchanged four-file packets through `inspectRuntimeFiles` and `exportRuntimeHandoff`. Its incident ID, registered merchant ID, acknowledgment, status and timestamps belong in the original handoff metadata notes and next action. This case can then retain the incident packet beside a separately selected period or follow-up capture. Incident collection, acknowledgment, notifications and recovery remain with the original SF93 service; the case does not operate a second watcher.

## Prepare a workorder from this case

The **Prepare a merchant workorder** stage can use **Attached runtime case** directly. A runtime incident or retained period does not need a separate SF70 diagnosis. The same original SF77 builder owns the commercial terms and generates the workorder JSON, readable HTML and acceptance checklist.

1. Attach and review the original runtime sources. The latest attached capture's saved merchant mapping must match the current case; an earlier baseline may retain its distinct mapping and comparison result. The original method, observed route and any recorded resource, catalog, buyer origin, network and recipient remain explicit. Optional unmapped fields stay unfilled; this path does not require an unrelated catalog or CORS diagnosis.
2. Choose **Attached runtime case** as the workorder source. Both attached captures and their actual original comparison are included. A process packet or retained period is supported; overlaps, restarts, path changes and missing coverage keep their original interpretation.
3. Enter the relationship owner's reference, merchant name, scope and exclusions, concrete deliverables, acceptance criteria and proposed delivery window. The existing commercial fields record the owner's proposal and its source record. Empty delivery fields remain empty; the builder does not invent a service, fee, acceptance or customer agreement.
4. Choose **Create workorder**. Source-recorded HTTP/native conditions and coverage/scope context remain distinct. The original review, source file digests, exact observed route, current option/recipient identities and native event decisions stay with the packet. The original case mapping is an operator mapping, not an authenticated merchant identity.
5. Download the readable workorder, JSON and checklist. Save the case to retain its source choice, original attachments and raw delivery/commercial draft fields. Reopening restores those inputs; creating the workorder again produces a newly dated packet from the same retained sources. Earlier case versions retain their own scope and terms. Changing sources, mapping or terms retires the previous on-screen result.
6. Prepare the complete support handoff below when another operator needs the source case. It includes the saved workorder choice and draft terms as well as the original runtime files. The same original SF77 CLI can create the commercial packet from that complete handoff and an explicit owner terms JSON:

```sh
node stellar/scf-starforge-20261009/sf77-merchant-workorder/workorder.mjs \
  --handoff /private/merchant-case.merchant-support.json \
  --terms /private/merchant-owner-terms.json \
  --out /private/workorders/NEW-runtime-workorder
```

The original diagnostic source choice remains available and keeps its SF70/SF76 repair review. The workorder does not poll a merchant, operate an incident service, send an offer or alter payment state.

## Complete private handoff

Choose **Prepare support handoff** from the current draft. It produces two explicit downloads:

- A readable offline HTML report containing the saved mappings, before/after outcomes, original native reconciliation, operator review queue, case owner, follow-up and notes. Dynamic strings are escaped; the document uses no scripts or remote assets.
- A `.merchant-support.json` file retaining the exact original workspace text, runtime files, metadata and SHA-256 references. Open it through **Open a complete support handoff** to create a new case draft in another instance. Validation completes before the editor changes.

The original `.merchant-workspace.json` transfer remains compatible and contains its original diagnosis/terms scope. Use the complete support handoff for runtime attachments and follow-up metadata. For all case history, stop the server and back up its whole private directory using the existing case-desk procedure.

Actual merchant sources, recipient terms, event identities and operator notes remain private. Export prepares files locally; sending a file or recording an agreement remains a separate authorized action. A digest identifies exact retained bytes and does not authenticate an external source.

## Local interfaces and storage

All runtime endpoints require the same literal-loopback Host and exact local Origin as the existing case API. They accept source bytes, never browser-supplied filesystem paths or arbitrary URLs.

| Operation | POST endpoint | Body |
| --- | --- | --- |
| Inspect packet or period | `/api/runtime/inspect` | `files` mapping original filenames to canonical base64; optional `inputs` and selected `routeId` to attach; a period also requires the exact selected `path` |
| Review captures | `/api/runtime/review` | `supportText`, current case `inputs` |
| Prepare transfer | `/api/runtime/export` | `workspaceText`, `supportText`, `metadata` |
| Open transfer | `/api/runtime/import` | `handoffText` |
| Build runtime workorder | `/api/workorder` | Original `supportText`, current case `inputs`, and `terms` as canonical base64 owner terms JSON; diagnostic source fields are omitted |

`runtime-support.mjs` exports the file intake, codec, comparison and handoff functions for existing callers. `runtime-desk.mjs` mounts this stage inside the existing page. The original private case store accepts optional `supportText`; omission preserves the prior attachment for older clients, and explicit `null` removes it from the new version. Workspace and runtime objects publish completely before the existing atomic case-head update.

The original `stellar-forge.merchant-runtime-case.v1` and `stellar-forge.merchant-support-handoff.v1` schemas remain. A period is identified by its original `history.json`; it contains that file, `report.json`, and optionally both journals. A session packet retains its original four required files and optional native trio. These input forms cannot be mixed inside one capture. Period mappings add `scope.path`; existing session mappings and saved case summaries remain compatible. Period case summaries add `periodCaptures` without duplicating daily counters in the case list.

Session packet files retain the 2,000,000-byte limit. A period capture accepts at most 64 MiB of **combined original source bytes**, including its history, report and journals; no single period file can exceed that total. The two-capture runtime file is capped at 192 MiB after base64/JSON encoding, and the complete portable handoff at 224 MiB. Oversized sources fail before attachment or saving. Select fewer actual retained days or one route through the original export, and generate its matching report, to reduce a period. Longer original journals can be reconciled through the existing filesystem CLI. No input is truncated or rewritten to fit.
