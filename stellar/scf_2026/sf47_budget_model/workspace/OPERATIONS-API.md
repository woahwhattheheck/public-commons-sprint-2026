# SF47 delivery and cash operations — source contract

This is an extension of the original SF47 planning workspace. It preserves budget.py, the current candidate and all planning revisions. It uses the existing Workspace connection, mutex, process lease and idempotent `_transaction` method, and creates only `ops_*` tables.

## Public interfaces

`operations.py`: `Operations(workspace)` with `list(plan_id=None)`, `create(body)`, `read(id)`, `command(id,body)`, `history(id,after=0,limit=100)`, `source(id,source_id)`, `report(id)`, `export(id)`, `import_bundle(raw,name,request_id,actor)`.

`operations_http.py`: `read(handler,parsed)`, `write(handler,parsed)`, `register_static(STATIC)`. Invoke after the original access guard, before planner route matching/body consumption. Existing Problem errors, response helpers and access control remain authoritative.

`operations.mjs`: `mountOperations({container,api,plan,inform,mutationId})`. Render inside the existing app through a Delivery & cash nav entry. This view uses its own versioned commands; preserve planner drafts and hide the planning save bar while it is shown. New `operations.css` is scoped to this root.

`operations_cli.py` exports `register(subparsers, common)` and `operate(workspace, args)`. Registration adds one `operations` command with nested `args.operation`, performs no I/O and preserves `args.command == 'operations'`. The existing CLI passes its already-open Workspace; this module owns exact output files. No second launcher or lock.

## API

GET/POST `/api/operations`, GET `/api/operations/{id}`, POST `/api/operations/{id}/command`, GET `/api/operations/{id}/report`, GET `/api/operations/{id}/history?after=0&limit=100`, GET `/api/operations/{id}/sources/{sourceId}`, GET `/api/operations/{id}/reviews/{reviewId}`, GET `/api/operations/{id}/export.zip`, POST `/api/operations/import`, POST `/api/operations/intake`.

GET list returns `{cases:[{id,planId,planRevision,version,state,name,mode,updatedAt}]}`; optional `?planId=...` filters it. GET history returns `{events,nextAfter,currentVersion}` and supports page sizes1–200. Source downloads preserve exact bytes and use attachment disposition.

Raw ZIP import takes `?name=...`, `X-Request-ID` and URI-encoded `X-Recorded-By`. JSON source intake takes the same selection fields as create plus `packetBase64`; the importer chooses OPERATIONS mode and accepts only the supported original pre-award packet. No source packet ships in the public module.

Create: `{planId,selectedRevision,expectedContentSha256,name,mode,actor,requestId,calendarStart?}`. Mode is OPERATIONS or WALKTHROUGH. Pin the exact source/scenario/planning/report and saved revision. Creating a case does not create an award or alter a plan.

Command: `{expectedVersion,requestId,actor,note,action,data}`. Use the original idempotency transaction. Conflicting case version returns409 OPERATIONS_CONFLICT. Closed cases accept only reopen; old close reviews remain retained.

GET case response: `{program,plan,records,sources,report,reviews}`. Mutation responses are compact receipts: `{id,version,action,kind?,recordId?,businessSha256?}`; read the case after acceptance. Create/import additionally return the receiving original plan identity. Never treat a mutation receipt as a complete case. Record arrays: contributors, work, invoices, cash, awards, deployments, purchases, outcomes. Attachments are private, byte/hash-preserved and only downloaded explicitly.

Actions: source.add, contributor.save, work.save/submit/accept/reopen/void, invoice.save/review/dispute/reopen/void, cash.record/void, award.save, deployment.save, purchase.record/observe/void, outcome.save, review, close, reopen.

## Business distinctions

Actual work carries contributor, optional original cost ID, ISO dates, decimal hours and PREAWARD/GRANT/CUSTOMER/INTERNAL basis. Internal work acceptance is distinct from an external tranche decision. Invoices retain source, contributor, number, dates and exact USD line amounts. Payment allocations determine partial payment/open balance independently of invoice review.

Cash retains original direction, category, date, currency/network/asset, decimal quantity, external reference, optional sourced USD valuation and invoice allocations. No transfer is performed. Reference identity prevents duplicate counting. Non-USD unvalued quantities remain separate. Real refunds are separate cash records; correction voids preserve history. Forecast capital and conditional grant payments never become observed cash automatically.

Award stages and tranche outcomes are explicitly recorded from their original sources. No award, acceptance, customer relationship or payment is inferred. Deployment records retain MERCHANT/BUYER role, TEAM_OPERATED/INDEPENDENT_OPERATOR/CUSTOMER participation, environment, release/source identity and explicit acceptance. Purchases retain original transaction, ledger, stroops, response bytes/hash, request/reservation/merchant-operation joins. TESTNET records remain product operations, outside real revenue.

Review freezes the full case/report with its digest and unresolved items. Close compares that unchanged business state; reopening preserves the original review. Complete ZIP includes the original planner bundle, pinned revision, records/history/reviews, exact source bytes, summaries and CSVs. Original access keys are excluded.

## Receiving run

Use one explicitly labeled WALKTHROUGH case for the complete work/invoice/cash/deployment/close/export/reopen sequence. A separate OPERATIONS case can adopt the actual interest acknowledgement and seven team-operated native testnet purchases. Both keep their original factual stage and source references.


## Source joins and receiving behavior

A case's plan content SHA is the original hash of scenario and planning. Its retained report, saved time and revision note are also preserved. The nested planner archive may contain later revisions; only the selected immutable revision and exact original source identity must match the case's pin before import.

Import validates the original request identity, source program fields, unique frozen-review identities and conflicting original receipt before invoking the original planner importer. Native imports retain all saved reports and source bytes. The receiving plan ID is new, and the selected revision is reread from that new plan. Aggregate exports retain one SQLite read snapshot through the original connection and mutex.

Purchase recovery uses purchase.observe with the existing ID and a reason. Original transaction, intent, request, operation and other known authority joins cannot silently switch. Participation/operator/environment are snapshotted from the original deployment. A later cancellation cannot erase paymentAttempted; complete output does not by itself prove settlement. Missing original intent/timing data is retained as missing.

Review returns a compact receipt with recordId and businessSha256. Close data is {reviewId,expectedReviewSha256}. Review/close/reopen require a note. A changed business snapshot returns409 REVIEW_CONFLICT. The state contains original frozen-review metadata; GET the review ID for its full snapshot and report.

## Minimal original-source integration

The only existing browser/server files changed are server.py, app.mjs and index.html. server.py registers the two static assets and calls operations_http.read/write after its original guard. app.mjs mounts the new view inside its existing main panel and hides the planning save bar while the view is active. index.html loads the scoped stylesheet and labels the original exports as planning exports.

The optional CLI registration already accepted by the original CLI owner remains unchanged. budget.py, sf10_current_candidate.json, model.py, native forecasting, original source bytes and original private process ownership are preserved.

OPERATIONS.md describes the complete operator flow. operations_walkthrough.py attaches to the existing server and retains a private request checkpoint for the single receiving workflow; it creates no additional server or external payment.

## Browser mount lifetime

`mountOperations({container, api, plan, inform, mutationId})` returns `{ready, refresh, dispose, root}` immediately. Await `ready` for the initial retained-case read. The original app calls `dispose()` before replacing this view or closing access. A disposed view suppresses later messages, downloads and rendering, and checks its lifetime immediately before an API dispatch and after its response. File reading and hashing can finish privately after navigation, but cannot submit a new mutation from the old view.

An already-dispatched mutation keeps its original request identity and native receipt. Disposal does not replay that request or infer that it was rejected. Reopening the case reads its retained version, records and history through the original workspace.
