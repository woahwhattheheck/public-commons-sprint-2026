# Customer review returns

This is the complete recipient-return continuation of the original OpenLineage customer service-review workflow. It reads the actual immutable customer review saved by customer-service-review.mjs. An operator prepares a separately saved recipient request, exports an editable document, receives the complete returned JSON and explicitly retains the reviewed response in the same original workspace.

The recipient's entries remain attributed statements. Receiving a response appends its exact original text and operator note; it does not edit an assessment, incident, quality evaluation, disposition, comparison, follow-up or customer review. A later customer review edition is a different original source and receives a distinct request.

## Maintained source and ownership

The original customer service-review source is F0C8YRLSNJ0, complete 509,207-byte source packet SHA-256 7f5d36182b69cf5ca513c1fc51e3ca521d0b475a2feaa322f398db97d2b8158d, based on public Merchant 92596081bf3117eda3b184c40fc34b75aed45c61. Its original writer remains the owner of shared store/catalog/CLI/browser inventory and application-version composition. These thirteen additive files form the recipient-return feature. Original v1–v10 source inventories and receiving contracts remain exact; the combined successor gets its own inventory after all original v10 UI leaves are joined.

The existing original Service Levels/Quality cases and installed package receiving identities remain selected. The new feature attaches to a real saved customer review in that same workspace. No additional native business case is required.

## Operator course

1. Open the original authenticated workspace and a saved customer review. Its complete source edition includes the selected original observations, historical decisions, source/evidence references and operator narrative. Prepare and save that review using the existing customer-review workflow first.
2. Open **Customer review returns**. Select the saved edition, intended recipient, organisation/reference, requesting operator and instructions. Open **Preview complete request** and read the full source/recipient preview. **Save recipient request** records its immutable complete source and the exact reviewed preview through the original workspace revision and operation journal.
3. Select that saved request and download the **editable recipient review**. Open this exact HTML, read its scope/narrative and original records, and operate its fields at the actual presentation width and 390px. Complete editable HTML and working JSON can carry entered responses between devices; the response JSON is the file to return. Outbound delivery uses the existing relationship owner's agreed channel.
4. In the editable document, enter respondent name, organisation and role/reference. Each original item has Not yet reviewed, Acknowledged, Question or Change requested plus a comment. Questions and requested changes require an explanation. Overall acknowledgment requires all original items to be acknowledged. The document retains all complete original record bodies behind their disclosure controls and the entire review edition.
5. Download the complete response JSON. The outgoing complete UTF-8 JSON is checked against the same 8 MB receiver limit; compact JSON is used when pretty formatting would exceed it. If the complete response is still too large, the full editable document remains available and the operator can agree a smaller selected review. Download requests keep the changed-work reminder because browser file saving may still be cancelled. The offline editor preserves an unchanged exported response's identity. Editing its entered content creates a new response edition. Open the downloaded file to inspect the exact entered fields and item/source identities. Save or reopen the editable document/working copy to continue incomplete work.
6. In the operator desk choose the original recipient request and open the returned JSON. The complete original text is retained before preview. **Preview returned response** verifies the original workspace/request/source hashes, every selected item identity and every complete item-source hash. Read the intended recipient alongside the respondent's self-entered attribution and each returned statement.
7. Enter the receiving operator and note, then **Retain reviewed response**. The exact displayed preview hash and original file text are written through the native workspace journal and expected revision. A response does not overwrite a preceding response; a reused response identity with changed content is rejected.
8. Open full saved history. Download complete JSON and printable HTML. Both retain the original recipient request, source edition, all received responses, original return bytes and receiving notes. The editable recipient download remains scoped to its one original request.
9. Export the complete original workspace using its maintained export/verify/receive path. Receive it into an explicitly chosen independent directory with the matching full application source. Open the original request, all responses and the same downloaded reports. The validator checks saved hashes, original native receipts, prior revision previews, exact source editions and complete response content after reopening.

Recipient identity fields are entered attribution, not an authentication claim. The designated recipient is bound to the saved request; the operator reviews who actually supplied the returned document through the existing channel.

## Recovery and working copies

The operator desk keeps a versioned IndexedDB working copy per original workspace. Before a mutation leaves the browser, the exact action/arguments, operation ID, original expected revision, selected workspace and active instance are committed in that working copy. A second tab cannot silently replace that record: a revision conflict disables writes until the retained working copy is deliberately reopened. Download the current working copy before replacing entered material.

**Replay original save** repeats its exact operation and body. An accepted native operation returns its original result through the existing journal. **Inspect original save** reads the actual original operation record. If the operation is absent only at the same revision, preserve it and replay it. A received definitive input rejection (HTTP 400, 413 or 422) is saved beside its exact pending request. If a subsequent original-operation lookup confirms absence, the operator can deliberately archive that rejected request and return to a new preview. Transport, authorization and uncertain errors keep the original request pending. If it is absent at a later committed revision, the older revision can no longer be admitted; its full request is archived in local history and the operator must open a new preview before a new save.

If the service restarts, use **Reconnect same workspace**. The original application's existing reconnect callback verifies its actual identity; this desk then binds its retained request to the new instance without changing its operation ID/body. Switching to a different workspace rejects the continuation.

The recipient document uses browser storage only as an optional convenience. Its page states whether those entries were retained. Download the complete editable document or working JSON before leaving the device. Opening another working copy asks before replacing unsaved entries. Import never sends a native request.

## Original-source adapter

review-return-source.mjs uses state.customerServiceReviews and verifies the complete saved body against contentSha256 and the original workspace. It maps the actual preview.document title/customer/period and retains the full immutable saved review. The selected response items are complete assessments, evaluations, comparisons, incidents, dispositions, follow-ups and evidence results from preview.originals. IDs are group + ":" + original ID so identical identifiers in different collections stay distinct. All other original source/edition/event records remain in the complete review itself.

The adapter never re-evaluates observations or reads today's mutable incident/disposition heads. A request keeps the exact review snapshot with which it was saved. Receiving a whole workspace validates that this saved source still equals its original customer review.

## Serial shared composition

Keep the original writer's current full shared files. The package contains no replacement shared store, catalog, CLI, app or inventory.

- Store imports: dispatchReviewReturns from review-return-store.mjs; validateReviewReturns and ReviewReturnError from review-return.mjs; resolveReviewReturnSource from review-return-source.mjs.
- In the original dispatch, route actions beginning "review-return." to dispatchReviewReturns(this, action, args). Translate ReviewReturnError to the existing WorkspaceError with its status, following the existing customer-review dispatch.
- Call validateReviewReturns(state, resolveReviewReturnSource) from both the normal state validation and complete/deep receiving validation, after the original customer review validation. Preserve the original customer review validator and historical revision reconstruction.
- Add reviewReturnTools from review-return-catalog.mjs to the existing catalog. Eight actions cover overview, original operation lookup, request preview/save, response preview/save, complete history and complete report download. The original MCP/HTTP/merchant transports continue to use that catalog and dispatch.
- The direct CLI leaf is independently executable. If adding a main CLI group, import reviewReturnMain and route only the new review-return group without rewriting existing commands.
- Add the new source leaves to the following application inventory while preserving the whole exact version10 inventory as a legacy receiver. Include all thirteen files, including the complete guide and typed client, in the complete application export.
- Serve review-return-ui.mjs, review-return-drafts.mjs and review-return.css through the existing browser-assets manifest and loader.
- Mount mountReviewReturnDesk(element, {request, identity, reconnect, onSaved}) from the existing authenticated operator UI. request(action,args) must call the original full action transport and return the decoded body; identity() returns the original current {workspaceId,instanceId}; reconnect() is the application's existing explicit identity verification/reconnection; onSaved refreshes its outer current revision. The module starts no server and reads no token itself.
- Keep the returned desk handle and await desk.close() from the original operator's close/drain path before closing shared resources. close() freezes controls, waits for its active operation and outer onSaved callback, and persists changed working state or retained state with a prior storage failure, including completed native-operation history. A storage conflict rejects close with the desk's download/reopen controls available; its exact native pending request remains retained. destroy() is the same awaited close method. Public refresh rejects once closing starts. The host's onSaved callback must refresh ordinary outer state without calling or awaiting this desk's refresh or close/drain methods itself.
- Add the stylesheet and a clearly labelled Customer review returns navigation entry/section to the current customer-review UI. Keep the original service-review editor and complete original app dialogs, routes and draft behavior.

Browser filenames/DOM mounts must be added to the same current application owner, after its four original UI leaves have been composed. A source inventory describes the actual full union; do not claim a future filename until its full body is present.

## Direct CLI and client

The direct command uses a complete request file and its exact UTF-8 byte SHA-256 for every action:

node review-return-cli.mjs --workspace /absolute/original/workspace --request /absolute/retained-action.json --expected-request-sha256 HASH --out /absolute/new-result.json

For HTTP use --url, optional --token-file and the actual --instance-id. The complete request file has schema commons.openlineage.review-return-action.v1, the original workspaceId, one declared action and its full args. A mutation's args include the original operationId, expectedRevision and expectedPreviewSha256. Keep the same file for resumed operations. Reports write the complete original report text. Other actions write the immutable native receipt without its transient replay flag. Outputs are create-only; identical complete existing output is reopened.

ReviewReturnClient extends the maintained LineageClient. It uses that client's authenticated original workspace/instance transport; it does not add another connection or endpoint. Full typed method signatures accompany it.

## Scope of recipient and internal downloads

The editable recipient HTML includes one complete selected review edition, its intended-recipient request and current entered response. It does not contain unrelated workspace reviews, other recipients' requests, other customers' return histories or the whole workspace.

The complete history JSON/HTML is the operator's record of all responses to the selected recipient request. The whole original workspace export remains the operator's full working source, with all customers/reviews and original file objects. Use the specific recipient document for the specific recipient.

The complete selected original review can itself contain sensitive source or evidence metadata chosen by the review author. Review the actual full outgoing edition through the original customer service-review workflow before sending it.

## Current delivery status and actual receiving

This carrier contains full implementation source and the complete operating course. The original application's writer composes it with the actual saved-review source and the existing equipped receiver opens the resulting exact application and outgoing documents. Syntax and source checks support integration; actual product opening/controls/downloads and independent receiving belong to the same complete original operation.

The reviewer should use a populated original saved review with multiple record groups. Exercise a recipient question and an acknowledgment, reopen its working JSON and editable HTML, preserve the exact returned file, preview/adopt it and replay the original operation. Then inspect full history, a source mismatch return, same-response changed-content rejection, stale native revision, retained pending request after service restart and explicit reconnect, at desktop and 390px. These are useful operating states of the real product, not a new test suite.

Every actual screenshot captured must be viewed. Open the exact downloadable HTML/JSON and complete receiving export, including their full usable contents. Repair the outgoing product directly if any control, source selection or layout is wrong. Record actual current source, workspace, operation and final output in the original OpenLineage thread.


## Complete applicable owner instructions

# Repository delivery instructions

Use the current README and the existing product's build/receiving guide. Coordinate through the original implementation and receiving owners, preserve concurrent source, and carry work through its authorized delivery.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

## GitHub Actions zero spend — existing owner instruction

Keep GitHub Actions disabled in this repository's provider settings and preserve the disabled source policy in [.github/hosted-ci-policy.json](.github/hosted-ci-policy.json). Every workflow job must retain the established literal-false condition, including manual dispatch and reusable jobs. Preserve its original condition inside the wrapper, and preserve the complete steps, commands, source and delivery artifacts.

Run focused product work in the existing cloud Linux or original local receiving operation. A public repository, available free minutes, cloud admission failure or a missing green check does not authorize enabling or dispatching hosted Actions. Do not set `HOSTED_CI=on`, add scheduled hosted runs or choose a paid runner. Keep source-native receiving moving with its original owner and saved operation.

Before publishing workflow changes, use the maintained Commons `tools/hosted_ci_gate.py --zero-spend REPO_ROOT` and `--check REPO_ROOT` source operation where that existing runtime is available. Its canonical wrapper is `${{ (false) && (ORIGINAL_CONDITION) }}`; the original condition is retained for native continuation. Provider disablement, the whole-account spending budget and dated billing remain separate controls; preserve current artifacts and their original custody.

This carries Bryce's existing zero-spend instruction from [Commons RULES, CI and spend](https://github.com/woahwhattheheck/commons/blob/main/RULES.md#4-ci-and-spend) into this repository's consumed entry guidance. Original cost coordination: https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791755765336589 .


# GitHub: no private repos, no Actions spend (owner mandate, Bryce 2026-10-09)

## Rule
- GitHub work happens **only on PUBLIC repos**. Coordination happens in **Slack or on-machine**.
- **Never** create or push to a **private** repo.
- **Never** add, enable, or depend on **GitHub Actions / workflows** — no `.github/workflows`,
  no cron `schedule:`, no `pull_request_target`, no governance/collision/ship-enforcer CI.
- Public-repo Actions minutes are free; **private-repo Actions minutes are the only kind GitHub bills.**

## Why
On 2026-10-09 the swarm had wired its own governance/coordination CI onto private repos. The
private `woahwhattheheck/commons` repo alone had **40,000 workflow runs** and was still queuing
new jobs on every push/PR (`open-door-guard`, `muhlnickel-spec-guard`, `pr-collision-notice`,
`source-parses`), plus `smb-showcase-inventory` (10,122), `LocalDeviceAgent` (2,199) and others.
That blew past Bryce's deliberately-low billing tripwire and tried to charge the card he keeps
empty as a backstop. Bryce's standing policy is that this work belongs in Slack / on-machine /
public repos, never private GitHub with CI.

## Enforcement (standing, automatic)
- Guard: `C:/Users/lucys/.commons/github-actions-guard/guard_actions.py`
  - Reads `github/woahwhattheheck` and `github/tokenjunkielabs` from the shared vault in-process
    (never prints the token), lists each account's owned non-archived **private** repos, and
    disables Actions on any where it is still enabled. Idempotent; GitHub API only; no model, no cost.
  - Scheduled task **`TJLabs-GitHub-Actions-Guard`** runs it every **5 minutes** (survives reboots).
    Log: `C:/Users/lucys/.commons/github-actions-guard/guard.log`.
  - Add any new owner account to the `ACCOUNTS` list in the guard.
- Do **not** disable, delete, or route around the guard or this policy.

## On 2026-10-09 the guard's one-time baseline disabled Actions on:
- woahwhattheheck (17 private): commons, commons-ship-enforcer, pack-market, smb-showcase-inventory,
  LocalDeviceAgent, charttrace, whitebox-estimation, webmcp-pad, tjlabs-review-quarantine, deathstar,
  tjlabs-publication-gate-validation, mwdoc-fin-2026-001-response, muhlnickel, motel-ops-suite,
  harborline-origin, commons-storage-recovery-2026-08-27, aquatrace-lims.
- tokenjunkielabs (3 private): swarm-telemetry-custody, tjlabs-review-quarantine, relay-control-plane.
- Nothing was deleted and no repo visibility was changed; only Actions was turned off (reversible).

## If something genuinely needs CI
It doesn't, under this policy. Move the work to a public repo, to Slack, or on-machine — or stop
and ask Bryce. Bryce controls any change to this rule.


## Clarification (Bryce, 2026-10-09): GitHub is not a messaging surface
`commons` and any private repo are NOT coordination/messaging surfaces. Opening or merging a PR to
announce a claim, post status, record DONE/RELEASE, hand off, or say anything is banned — "WE HAVE
SLACK." All coordination (TAKE/ACK/DONE/RELEASE/handoffs/status/notes, carrying the wo-/op-id) goes
in Slack. A PR exists ONLY to ship real reviewed PRODUCT to a PUBLIC upstream repo as an actual
deliverable (bounty/competition/customer). The private-commons PR-as-message pattern is what
generated 40,000 Actions runs and blew the billing tripwire. Order posted to #coordination
2026-10-09 ("PR-MESSAGING-STOP").


<!-- bryce-rendered-product-inspection:begin -->
Owner rule: before presenting client/prospect-facing products and ALL attachments, literally open, observe and normally use the exact outgoing rendered version as its user/recipient would; view screenshots and attachment contents, fix defects, then ship. Metadata/source/tests/checklists/receipts do not substitute; no review or test theatre, parallel review bureaucracy, or approval gate. For video use available high-quality generative voice/TTS with natural professional delivery, use applicable generative media capabilities when helpful, and watch/listen to the final export for clarity, pronunciation, pacing, timing and audio alignment. Apply `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` (portable: `docs/policies/rendered-product-inspection-policy.md`). Focused internal validation only; all existing owner controls remain in force.
<!-- bryce-rendered-product-inspection:end -->

