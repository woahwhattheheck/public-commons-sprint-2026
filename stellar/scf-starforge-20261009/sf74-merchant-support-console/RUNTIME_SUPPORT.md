# Runtime support in the merchant case desk

The existing SF74 case now carries a merchant's original runtime packet, its repair follow-up, native delivery reconciliation and operator ownership. The original SF93 collector and SF97 reconciler remain responsible for their source products. SF74 imports their files and connects them to its saved case lifecycle.

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
| Inspect packet | `/api/runtime/inspect` | `files` mapping original filenames to canonical base64; optional `inputs` and selected `routeId` to attach |
| Review captures | `/api/runtime/review` | `supportText`, current case `inputs` |
| Prepare transfer | `/api/runtime/export` | `workspaceText`, `supportText`, `metadata` |
| Open transfer | `/api/runtime/import` | `handoffText` |

`runtime-support.mjs` exports the file intake, codec, comparison and handoff functions for existing callers. `runtime-desk.mjs` mounts this stage inside the existing page. The original private case store accepts optional `supportText`; omission preserves the prior attachment for older clients, and explicit `null` removes it from the new version. Workspace and runtime objects publish completely before the existing atomic case-head update.

Each original file is limited to 2,000,000 bytes, a two-capture runtime case to 38,000,000 bytes, and a complete portable handoff to 60,000,000 bytes. No oversized source is silently truncated. For longer native journals, retain a coherent source export within these limits or use the original filesystem reconciliation tool directly.
