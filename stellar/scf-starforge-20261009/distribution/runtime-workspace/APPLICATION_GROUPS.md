# Saved Application launch groups

Launch groups keep an ordered selection of existing saved Applications and a durable run that points to each member's original managed operation. Open **Runtime workspace → Launch groups** to prepare a demo, restart a working set, or run a sequence of original tools.

## Browser workflow

1. Choose **Create group**, enter a name, add saved Applications, and use **Move up / Move down** to set their order. Save the group.
2. Choose **Review a new run**. Each member shows its saved revision, runtime, managed home, release, command, original inputs and provider source. Resolve any member error, then review again.
3. Choose **Start reviewed group**. The group run and every member's stable request UUID are retained before the first member is dispatched.
4. Choose **Continue: …** to start the next member. Earlier members must have launched their original command or finished. A member sharing an original workspace with an earlier member waits until that earlier operation finishes.
5. Use **Original output** for the exact member's retained worker log and result. **Open Application** returns to the original Applications view and its private navigation, terminal and operation controls.

The group editor retains its unsaved draft in the browser. Definitions, revisions, current run and run history are saved in the private runtime workspace. Reopening the browser or server restores the selected group and its original operations.

### Partial failures and remaining review

**Recover original request** invokes the existing Application recovery for that member's retained UUID. A dispatch response lost after acceptance is reconciled through that same request. The group never assigns a new request UUID to recover a member.

If a remaining saved Application, provider source, input, resource selection, runtime or selected release changes, the member requires **Review remaining members**. Applying that review updates only members without an original run. Already launched members retain their original revision, request, review, status and output.

A managed home's revision is a concurrency token. Before every new member dispatch, the group obtains a fresh original start review and compares its complete approved identity, apart from that token and review timestamps. If only the home revision changed, the group retains the fresh token and submits it through the original start guard. Source, selected release, command and input changes still require a new review.

A final failed, cancelled or reconciled original outcome may be accepted with **Accept result; allow next**. This records the exact outcome the operator accepted and permits the ordered sequence to continue. Its original result stays visible. A completed worker that retained an `EXITED` or `LAUNCH_FAILED` command is displayed as failed. Only an original `COMPLETED` result with exit code zero advances automatically; a recovered outcome without a command result requires explicit acceptance. An interrupted operation must be recovered or stopped before a final outcome can be accepted.

**Stop group** first retains the stop intent, prevents further member launches, then calls the original stop path for every outstanding member. Use **Retry stopping group** after a transient stop failure. The history remains available.

The browser retains the exact mutation request before sending it. If its response is interrupted, **Recover saved request** replays that body. A repeated group start reopens its existing run; a repeated continuation targets its original explicit member and does not advance another one.

## CLI and model

Use the existing `runtime-workspace` command and a private JSON request file. IDs below are placeholders for IDs returned by the original Applications and group APIs.

Create a named selection:

```json
{
  "requestId": "<fresh UUID retained by the caller>",
  "label": "Merchant operations",
  "applicationIds": ["<saved Application ID>", "<saved Application ID>"]
}
```

```sh
runtime-workspace application-group-save --workspace /private/operator --request /private/group.json
runtime-workspace application-groups --workspace /private/operator
runtime-workspace application-group-review --workspace /private/operator --group-id GROUP_ID
```

To edit a definition, include its `groupId` and current `expectedRevision` in the save request. The ordered selection is limited to 1–32 distinct saved Applications. An edit preserves the earlier definition and its run history.

Start a reviewed group with the returned review ID:

```json
{
  "groupId": "<group ID>",
  "requestId": "<fresh group-run UUID retained by the caller>",
  "reviewId": "<group review ID>"
}
```

```sh
runtime-workspace application-group-start --workspace /private/operator --request /private/start-group.json
runtime-workspace application-groups --workspace /private/operator --group-id GROUP_ID
```

Continue the explicit next member using the run's current version:

```json
{
  "groupId": "<group ID>",
  "runId": "<group-run UUID>",
  "applicationId": "<next saved Application ID>",
  "expectedVersion": 3
}
```

```sh
runtime-workspace application-group-continue --workspace /private/operator --request /private/continue-group.json
runtime-workspace application-group-review --workspace /private/operator --group-id GROUP_ID --run-id RUN_UUID
runtime-workspace application-group-apply-review --workspace /private/operator --request /private/remaining-review.json
runtime-workspace application-group-member --workspace /private/operator --request /private/member-action.json
runtime-workspace application-group-stop --workspace /private/operator --group-id GROUP_ID --run-id RUN_UUID
runtime-workspace application-output --workspace /private/operator --application-id APPLICATION_ID --operation-id ORIGINAL_UUID
```

The remaining-review request contains `groupId`, `runId`, `reviewId` and the reviewed `expectedVersion`. Member actions contain `groupId`, `runId`, `applicationId`, and `action` (`recover`, `stop`, or `accept-result`). Accepting a final result also requires the current `expectedVersion`.

`application-groups` accepts `--run-id` to open a retained run and `--limit` / `--cursor` for history pages. The default page is 20 runs, the maximum is 50, and the next cursor is returned in `selected.history.nextCursor`.

`openRuntimeWorkspace()` exposes the same jobs as `applicationGroupsState`, `applicationGroupsSave`, `applicationGroupsReview`, `applicationGroupsStart`, `applicationGroupsContinue`, `applicationGroupsApplyReview`, `applicationGroupsMember`, and `applicationGroupsStop`. The browser uses the corresponding authenticated loopback `/api/application-groups/*` routes.

## Retained records

- `application-groups/<group-id>/group.json`: current named ordered definition.
- `application-groups/<group-id>/revisions/<revision>.json`: immutable earlier definition.
- `application-groups/<group-id>/current.json`: current group-run pointer.
- `application-groups/<group-id>/runs/<run-uuid>.json`: approvals, stable member UUIDs, progress and stop intent.
- `application-group-reviews/<review-id>.json`: exact full or remaining-member review.

Original Application records stay under `applications/<application-id>/runs/<original-uuid>.json`; worker requests, state and logs stay in the original `operations/<original-uuid>/` directories. Group actions acquire a per-group kernel lease, then call the existing Application start/recovery/stop functions and their original resource locks. There is no additional worker or background queue.

## Installed source and original receiving

The complete group workflow is included in the public Runtime distribution. The original Applications lifecycle remains the sole start, recovery and stop writer. The two group browser assets are declared in `browser-assets.json`; the backend is reached through the installed Runtime model. Existing public workbook results, saved connection selection, complete output pages/downloads and workspace receiving keep their original entry points.

Continue the existing Runtime/Applications receiving operation using its actual saved Applications and private workspace. Keep the selected Application IDs, original provider inputs, group ID and per-member request IDs with that operation. On the existing browser and installed CLI:

1. Open Launch groups at the presentation width and a narrow width. Save and reorder the existing selected Applications, reopen the group and inspect every retained input/source in its review.
2. Start the reviewed group and reopen the same request after an interrupted response. Confirm its original member operation and output are retained. Continue one explicit next member and inspect shared-workspace waiting when the selected members share a resource.
3. For a remaining member with an actual changed saved input, use Review remaining members. Keep earlier member operations unchanged. Recover or stop the original member through its saved request; accept an exact final failed outcome only when that outcome was actually returned.
4. Open an earlier group run, browse its complete original output, freeze and restore a selected span, download the whole selected original bytes, and reopen that file. Keep existing terminal controls usable.
5. Reopen the same group through the installed CLI, and then through the original workspace backup/receiving continuation. Retained history stays readable while new launches use the original receiving/adoption checks. Keep the same existing host/runtime and return its complete source selection, actual results and viewed screens to its original operation.

The original group records and command examples above are shared by both consumers. This composition changes the installed availability of that workflow; current native results belong to the existing receiving operation.

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
