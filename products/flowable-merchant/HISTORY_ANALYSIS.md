# Workflow history analysis

The existing Flowable workspace now analyses one explicitly selected, saved process capture. Open **History analysis**, select exact definition editions and a UTC process-start window, then review completed durations, open ages, tasks, repeated activity occurrences and coverage. The analysis does not contact or mutate the engine.

## Population and calculations

The population is processes whose original `startTime` falls in **[from, to)** and whose captured `processDefinitionId` is selected. Require **from < to <= asOf <= capture.startedAt**. Every date is shown in UTC. Timestamps retain the native millisecond precision; impossible calendar dates and unsupported timestamp shapes are rejected or recorded as source-quality observations.

For processes ended at or before asOf, the original native state controls classification: completed enters completed-duration statistics, cancelled is reported as terminated. An unrecognized native state remains unknown-ended. If native state is absent, deletion-reason inference is explicitly labeled in the row. Tasks use their native deletion reason. Activities are reported as ended with completion unknown: the pinned native REST response omits cancellation state and deletion reason, so ended activity durations are separately named and never labeled completed or terminated. A missing end or an end after asOf contributes an open age of asOf minus start. An ended process is not automatically a successful business outcome. Open ages and termination durations do not enter completed-duration statistics.

Median and nearest-rank p90 use completed process/task samples; activity statistics use the separately named ended sample with unknown completion. Mean is calculated with an exact integer sum and truncated to three decimal milliseconds. All elapsed metrics include weekends and nights. Parallel task durations overlap; summing them does not produce end-to-end process duration. Claim delay uses the retained claim timestamp and does not reconstruct assignment history.

Repeated occurrences count each task/activity key within a process. They can represent intentional repetition, parallel activity, compensation or rework; the report does not infer a cause. A child tied to a different definition edition remains in its own task/activity group, with an explicit source-quality observation. Parent definition is the captured history value and may reflect migration.

## Source coverage

The original capture paged the native collections completely and retained source pages. These are sequential reads, not a transactional snapshot. History-level configuration, retention, deletion, permissions and concurrent changes can limit the population. Record those facts in the required coverage note. Captured definitions can be absent after deployment deletion; choose available exact editions and retain the original native export.

Malformed selected rows are listed by original collection and ID. No rate or performance conclusion should silently count them as complete observations. Non-cohort task/activity counts include all rows outside the selected parent population.

This module caps each input collection at 250,000 rows, the selected report at 100,000 rows and the complete analysis bundle at 64 MiB. Narrow the selection or obtain an appropriately scoped original capture when needed.

## Open and use the workspace

1. Open the installed original Flowable workspace with the operator's existing connection and credentials.
2. Select a saved process portfolio, or use **Refresh engine** to create an original capture through its existing action.
3. Open **History analysis**. Select definition editions, title, from/to/asOf and the coverage note.
4. Run **Analyse saved history**. Review the process, task and activity tables and source-quality observations.
5. Download the complete source bundle, standalone HTML, selected CSVs and selection JSON. The HTML is readable without a service or network request.
6. Reopen the downloaded source bundle. Its complete original inventory bytes must match the saved source hash, and recalculating the report must match every value.
7. Use **Export complete original workspace** to include all original response pages, deployment resources, saved revisions and history. Receive this NDJSON with the existing Handover controls.

**Open authored reference** is an explicit demonstration. It includes six selected process histories over two authored definition editions, one non-cohort process, eight tasks and eight activities. It demonstrates completed/open/terminated observations, a later known end, repeated work and a child definition change. It represents no native or customer result. Expected v1 completed median is 36 hours and p90 48 hours; v2 completed duration is 12 hours.

## Native receiving command

The local model must open the original source workspace and a distinct receiving workspace. The receiver uses the original export/stage/adopt methods and preserves the exact original capture revision and inventory bytes. It freezes the first adoption request before dispatch, so a lost response reopens the original expected revision instead of creating another operation.

Create a complete selection JSON:

```json
{
  "connectionId": "SELECTED_SAVED_CONNECTION_ID",
  "portfolioId": "SELECTED_SAVED_PORTFOLIO_ID",
  "revision": 2,
  "selection": {
    "title": "Selected workflow history",
    "definitionIds": ["ORIGINAL_NATIVE_DEFINITION_ID"],
    "from": "2026-10-01T00:00:00Z",
    "to": "2026-10-08T00:00:00Z",
    "asOf": "2026-10-12T00:00:00Z",
    "retentionNote": "Replace with the actual operator-reviewed source coverage."
  }
}
```

```sh
flowable-history-analysis --workspace /absolute/original-workspace --receiver /absolute/independent-workspace --selection /absolute/history-selection.json --operation ORIGINAL_HISTORY_REVIEW_OPERATION --out /absolute/history-delivery
flowable-history-analysis --bundle /absolute/history-delivery/history.history.json
```

The first command closes and reopens the independent receiver, rereads the same original capture and reproduces the same bundle hash. Preserve the same operation, source/receiver workspace IDs, selection and output directory on retry. Output contains the complete original-workspace NDJSON, analysis bundle, HTML, three CSVs, original adoption input and receiving receipt.

Local SDK exports are `./seller/flowable/workspace/history-analysis`, `history-report` and `history-delivery`. The analysis reader accepts the actual local workspace model, including `sourceFile`; an HTTP client uses the existing authenticated workspace's `/api/history-analysis` service. No second engine or data store is introduced.

## Original contracts

`history-source-contract.json` pins the three original Flowable 8 history response classes and the maintained portfolio reader. Native task rows retain taskDefinitionKey, processInstanceId, processDefinitionId, claimTime, startTime, endTime and deletion reason. Activities retain activityId/activityType and their exact original IDs, but expose no completion/cancellation reason. Process rows retain native state, and the report preserves that source field and its classification basis. Original source exports remain authoritative for fields beyond the selected report.

## Exact-version opening course

On the existing equipped Flowable opening operation, load this source edition and use its existing engine/capture. Open the actual History analysis panel at a normal presentation width and a narrow width; view the screenshots yourself. Exercise an empty selection, the authored reference, original capture analysis, invalid dates, changed definition selection, loading/error display, pagination, all six downloads and source-bundle reopening. Literally open the final HTML and CSV files and use the complete project/archive normally. Then run the same independent native receiving command and reopen its returned workspace. Retain the exact source/artifact identities and any material issue, repair the affected result, and continue the actual handover.

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
