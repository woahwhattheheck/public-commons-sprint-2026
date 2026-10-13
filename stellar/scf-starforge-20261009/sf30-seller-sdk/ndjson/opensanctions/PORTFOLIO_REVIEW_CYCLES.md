# Customer portfolio refresh in original Review cycles

A customer portfolio refresh can now enter the same native assignment, due date, completion, supervisor sign-off, reopening and full receiving workflow used for source-dataset changes. The two source kinds stay distinct. This uses the original review-cycle event store and original case/refresh decisions.

## Create and assign

First prepare an exact same-customer portfolio comparison in **Portfolio refresh**. Cases may still belong to the earlier edition or may already have been explicitly continued to the following edition. The cycle freezes all unmerged cases on either selected portfolio whose counterparties belong to the complete compared population. Cases on another portfolio are outside this selected scope; no title or name guesses are used.

In **Review cycles**, select a named review operator. In Create a review cycle choose from the **Customer portfolio refresh** option group. Source dataset comparisons remain in their separate group. Enter label, scope note, supervisor, optional due date and optional exact case subset. Blank subset selects the full eligible case population. Explicitly excluded cases stay in the frozen report. Added counterparties without a case remain in the complete comparison but do not invent an assignment or a case.

Assign each case through the original assignment form. The existing reviewer ID identifies the assigned person and supervisor. This records responsibility in the authorized local workspace; it is not a replacement authentication system.

## Complete against the actual original decision

The cycle shows original customer attribute changes and its frozen case. **Open original portfolio review** opens that exact comparison/counterparty in the existing desk. **Open original case decision** retains its usual behavior.

Save a named retain or continue decision in Portfolio refresh. Return to the cycle, refresh and select that actual original attributed review from the completion form. The selection is initially empty. Completion verifies the full original refresh event, its exact comparison/case/counterparty, the retained beforeCase for retain or afterCase for continue, the current native case revision, the original event time and the assigned reviewer's name.

A source-only review does not complete an existing case assignment. REVIEWED also requires the source edition, candidate and monitoring policy to match the frozen cycle. If those changed, retain FOLLOW_UP or deliberately create a new cycle for that scope. FOLLOW_UP can omit a refresh event and never qualifies for supervisor sign-off.

An explicit retain decision can complete review of the customer change while keeping the original case and its identity/relevance states. A supervisor report confirms completion of this authored workflow; it does not assert a legal conclusion, identity match or relevance outcome. Continue requires the original refresh engine's separate explicit identity and relevance choices. Neither cycle action dispatches a provider call.

## Sign off, reopen and recover

The original supervisor sign-off observes every selected current case revision, requires every selected assignment to be REVIEWED and freezes the full source/comparison/case/event evidence in an immutable report. If a case changes after completion, sign-off rejects it and the UI marks the completion stale. Reopen through the original form, review the actual current case and save a new attributed completion.

Existing IndexedDB drafts, original command UUIDs, expected cycle versions, saved-request recovery and branch-scoped headers remain. A lost response reuses the exact native request; old events are replayed before any new write. Source-dataset cycles without sourceKind retain their exact original command, observation, report and archive meaning.

Download full cycle JSON and each exact signed JSON/HTML report. The complete source comparison includes every counterparty, original descriptors, exact changes and all frozen case snapshots. The selected/excluded roster, assignments, source review request/result, complete case ancestry and sign-off remain in the original full Monitoring workspace export.

## Native CLI and receiving

Use the original **cycle-command**, **cycle**, **cycle-request** HTTP route, **cycle-report**, export and import interfaces. Native create commands add only body.sourceKind = portfolio_refresh and use the actual customer comparison ID in body.comparison. Existing source-dataset command bodies omit this field entirely.

Customer completion bodies contain the original caseId/caseRevision/disposition/note/evidence fields plus **portfolioReviewRequestId**. Supply the actual saved retain/continue request ID for REVIEWED; null is supported for FOLLOW_UP. All other cycle actions keep their original schema.

The same maintained **gleif-monitoring-receive --refresh-selection PRIVATE_FILE** can receive a complete authored cycle. Its optional selection.cycle has **create** and **commands**. Each item supplies an original canonical UUID requestId, actor object and native body. The receiver fills only the exact original comparison, cycle ID, expected version and first-retained command time. It saves the full command before dispatch and reuses that exact file on retry.

Example structure, with real existing identities and authored decisions substituted:

~~~json
{
  "beforePortfolio": "ACTUAL_EARLIER_PORTFOLIO_ID",
  "reviews": [
    {
      "entityId": "ACTUAL_COUNTERPARTY_ID",
      "caseId": "ACTUAL_CASE_ID",
      "expectedCaseRevision": "ACTUAL_CASE_REVISION",
      "decision": "retain",
      "reviewer": "Assigned reviewer",
      "reason": "Authored decision"
    }
  ],
  "cycle": {
    "create": {
      "requestId": "00000000-0000-4000-8000-000000000001",
      "actor": {"id": "supervisor-id", "name": "Supervisor"},
      "body": {
        "label": "Customer refresh review",
        "scopeNote": "Authored complete selection",
        "caseIds": ["ACTUAL_CASE_ID"],
        "supervisor": {"id": "supervisor-id", "name": "Supervisor"},
        "dueAt": null
      }
    },
    "commands": [
      {
        "requestId": "00000000-0000-4000-8000-000000000002",
        "action": "assign",
        "actor": {"id": "supervisor-id", "name": "Supervisor"},
        "body": {
          "caseId": "ACTUAL_CASE_ID",
          "reviewer": {"id": "reviewer-id", "name": "Assigned reviewer"},
          "dueAt": null,
          "note": "Authored assignment"
        }
      },
      {
        "requestId": "00000000-0000-4000-8000-000000000003",
        "action": "complete",
        "actor": {"id": "reviewer-id", "name": "Assigned reviewer"},
        "reviewIndex": 0,
        "body": {"disposition": "REVIEWED", "note": "Authored completion", "evidence": []}
      },
      {
        "requestId": "00000000-0000-4000-8000-000000000004",
        "action": "signoff",
        "actor": {"id": "supervisor-id", "name": "Supervisor"},
        "body": {"note": "Authored supervisor review", "evidence": []}
      }
    ]
  }
}
~~~

Use new canonical UUIDs for a new actual course. Repeating the same output uses saved original UUIDs/commands. reviewIndex is an explicit zero-based choice from this same selection.reviews array; the receiver binds only its actual returned case revision and retained request ID. It cannot turn source-only review into case completion. For a manually selected follow-up without reviewIndex, supply its native case binding and null portfolioReviewRequestId.

The original driver retains the complete cycle snapshot, every command/result and every signed report, then exports the full original workspace. Cold receiving reads the same revision, replays every original command to its identical frozen result and opens each complete signed report with identical bytes/SHA. Time-dependent overdue display observations do not replace the retained cycle revision or original snapshot. A different authored course or genuinely progressed cycle requires a new output rather than overwriting prior evidence.

## Source and delivery

The additive portfolio_review_cycles.py is included in the original Python application binding and NDJSON distribution support files. The original cycle command/API remains authoritative. A compact portfolio-cycle-reviews read route supplies actual saved event choices; the typed client admits that read. The original CLI exposes the same choices with `portfolio-cycle-reviews --comparison-id ACTUAL_COMPARISON_ID`. Full case and report originals remain in existing tables and source objects.

Continue the SAME DCE4/8415 receiving operation, current handoff1791904895.792659. Use its retained complete original inputs. Personally operate assignments, due dates, explicit source choices, completion, stale/reopen, sign-off, pending-request recovery and downloads in both original and independently received applications at desktop/screenshare and 390px. Open every actual HTML/JSON/FtM/CSV/ZIP and extracted working project. Inspect screenshots you capture and repair the same source if anything is clipped, unreadable or broken. Source or controlled V8 execution does not establish native Python or visible acceptance.

## Local demo browser custody — original owner direction

From **16:00 UTC on 13 October 2026**, Bryce's local Codex in-app browser belongs entirely to Bryce for his demo. Do not navigate, reload, click, type, capture, inspect, resize, open or close tabs, or run automated checks on that browser. Leave selected demo/report tabs intact. Resume it only after Bryce explicitly says the meeting is over or releases it; no end time is assumed.

Engineering, source integration, shell work and Slack continue. Existing cloud workers may use their isolated browsers. This restriction does not create a new native operation or authorize borrowing another person's browser. Original direction: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791906463475599 .

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



