# Customer portfolio edition refresh

This is the original Source Monitoring workspace's explicit customer-data update workflow. It compares two complete retained portfolios with the same customer key, preserves every original FtM entity, and lets a named reviewer retain or continue an existing case. It does not dispatch a provider request, decide that an entity is sanctioned, buy data, or automatically close a case.

## Use the original application

Open **Portfolio refresh** in the existing Monitoring navigation. Choose the earlier and following customer portfolios. The whole population is compared using the original FtM comparison implementation: added, removed, changed and unchanged counterparts, exact property values, value-order changes, other original fields and source record positions. Search and change filters affect the visible page only; both reports contain the complete population.

Open **Inspect and review** for a counterparty. Read either original entity, exact changed attributes and every original case. Case identity and relevance remain separate. The screen distinguishes cases still on the earlier portfolio, already continued cases, and cases on another retained edition.

Choose one explicit course:
- **Retain** records a named review against the exact earlier case revision and leaves that case unchanged.
- **Continue** revises the same original case against the following portfolio. Choose identity and relevance explicitly and supply reviewer/reason. The case's native source edition, candidate and monitoring profile remain retained.
- **Source only** records an attributed source review without marking or changing any case.

An absent following counterparty cannot be continued. Removal does not retire a case. A case on another portfolio is not silently rebased. The original case remains available through **Open original case**. Existing finite review cycles retain their original populations and historical case revisions; this workflow does not rewrite them.

A previous native match response belongs to its original portfolio. Continuation does not carry that response as evidence about the following portfolio. An optional replacement must be an actual retained RECEIVED response for the following portfolio and selected candidate. No provider dispatch occurs here.

## Recovery and competing edits

Before sending, the browser persists the original request ID and complete choices in its existing workspace-scoped local storage. **Continue original review** resends those exact choices. **Read original request status** reconciles an already committed result. A missing result alone does not discard an uncertain request.

A definitive rejection leaves an attributed local request history and allows a newly reviewed request. An uncertain network response retains the original pending request. Changed choices under a reused request ID are rejected. Native case revision checks reject a stale edit. A successful case revision and refresh receipt commit in one original SQLite transaction; neither can be committed alone.

The complete original case predecessor chain is verified with the maintained review-cycle verifier, including revision hashes, previous links, stable identity and chronology. Later legitimate case edits leave the captured review valid and the UI labels it historical. Comparison receipt replay precedes any new case timestamp or revision generation.

## Original CLI and client

From this application source use the original Python CLI, with the workspace already selected:

~~~sh
PYTHON -B ndjson/opensanctions/cli.py --workspace WORKSPACE portfolio-refresh-prepare --before EARLIER_PORTFOLIO_ID --after FOLLOWING_PORTFOLIO_ID
PYTHON -B ndjson/opensanctions/cli.py --workspace WORKSPACE portfolio-refreshes
PYTHON -B ndjson/opensanctions/cli.py --workspace WORKSPACE portfolio-refresh --id COMPARISON_ID
PYTHON -B ndjson/opensanctions/cli.py --workspace WORKSPACE portfolio-refresh-command --request PRIVATE_AUTHORED_REQUEST.json
PYTHON -B ndjson/opensanctions/cli.py --workspace WORKSPACE portfolio-refresh-request --request-id ORIGINAL_REQUEST_ID
PYTHON -B ndjson/opensanctions/cli.py --workspace WORKSPACE portfolio-refresh-report --id COMPARISON_ID --output Portfolio_Refresh.json
PYTHON -B ndjson/opensanctions/cli.py --workspace WORKSPACE portfolio-refresh-report --id COMPARISON_ID --output Portfolio_Refresh.html --html
~~~

Use actual retained identifiers. A continuation request is:

~~~json
{
  "requestId": "ORIGINAL_EXPLICIT_REQUEST_ID",
  "comparisonId": "ACTUAL_COMPARISON_ID",
  "entityId": "ACTUAL_COUNTERPARTY_ID",
  "caseId": "ACTUAL_CASE_ID",
  "expectedCaseRevision": "ACTUAL_CURRENT_CASE_REVISION",
  "decision": "continue",
  "resolution": "undecided",
  "relevance": "undecided",
  "reviewer": "Named reviewer",
  "reason": "The reviewer's authored explanation"
}
~~~

The displayed undecided values are examples of supported explicit choices, not automatic defaults. For retain omit resolution/relevance/matchRequest; for source-only use decision reviewed and omit all case fields. The native model accepts its existing resolution/relevance enums.

The original typed Monitoring client exposes GET portfolio-refreshes, portfolio-refresh, portfolio-refresh-request and portfolio-refresh-report; POST portfolio-refresh-prepare and portfolio-refresh-command. Its original private connection and workspace header remain authoritative. API return fields include exact comparison population, case revision and request result, without copying shared credentials.

## Full export and independent reopen

The original workspace exporter includes both additive tables, all prior case events, original builds, source bytes and object attachments. It validates comparison and review history before export. Original import validates the same history inside its existing acceptance transaction. Older archives without refresh tables remain accepted with empty additive collections.

The immutable comparison retains both original source descriptors, including the author's labels and timestamps. Native cold import may assign local source labels/times; receiving validates stable source ID, byte count and inventory while reports retain the captured originals.

Reports are complete snapshots of the immutable comparison and current original case observations, not a new report-edition registry. JSON includes its source snapshot SHA; HTML includes all source descriptors, changed attributes, attributed events and cases. Later case edits may create a different report snapshot. Existing CLI output with different bytes is protected; select a new output path.

The original **gleif-monitoring-receive** course optionally continues into this workflow using **--refresh-selection PRIVATE_REFRESH_SELECTION.json**. Keep all original1853 arguments and select a new receiving output for a different authored course. The optional file contains:

~~~json
{
  "beforePortfolio": "ACTUAL_EARLIER_PORTFOLIO_ID",
  "reviews": [
    {
      "entityId": "ACTUAL_COUNTERPARTY_ID",
      "decision": "reviewed",
      "reviewer": "Named reviewer",
      "reason": "Authored source review"
    }
  ]
}
~~~

For actual cases include caseId, expectedCaseRevision and the explicit retain/continue fields above. The receiver binds the deterministic comparison and request IDs to this complete original intent. It saves each exact request, full comparison, JSON/HTML reports and the complete Monitoring archive. Independent receiving reopens each request/result and compares both report files byte-for-byte. The final original receipt contains portfolioRefresh with comparisonId, beforePortfolio, afterPortfolio, requests/results, report descriptors and coldReopened.

The course has no new model, provider request or parallel runner. Original1853 source-only invocations retain their exact prior intent shape and behavior when the optional selection is omitted.

## Native and visible delivery

Continue the existing DCE4/8415 original receiving operation with the complete cumulative source. Open and personally use the exact original and received applications at desktop/screenshare and 390px. Operate populated/empty/filter/error states, both entity reads, case opening, explicit retain/continue, an actual stale revision and original-request recovery, report/FtM downloads and independent reopened history. Open the HTML, JSON, original FtM, CSV attachments and the extracted working archive. View the actual captured screenshots. Correct the first real exception or unreadable control in the same source/operation.

Source and controlled V8 checks do not establish native Python, browser layout or attachment acceptance. Record actual commands, application revision, files, operation outcomes and viewed artifacts with the existing receiver.

## Repository delivery instruction, carried in full

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



## Assignment and signed review completion

The original [Review cycles customer workflow](PORTFOLIO_REVIEW_CYCLES.md) freezes the selected customer pair, assigns existing cases, and binds completion to the exact attributed retain or continue event. It includes supervisor sign-off, reopening, full reports and the same original receiving course. Source-dataset cycles remain distinct.
