# Reviewed plan amendments in Grant Operations

Use **Delivery & cash → Plan amendments** in the existing SF47 workspace to change the selected planning baseline of an existing operating case. The original planner remains the source of saved budget, milestone, cost and calendar revisions. This page receives one of those exact revisions, shows the complete comparison, retains an operator review, and applies that selection to the same case.

Recorded work, invoices, invoice allocations, cash, award observations, purchases, delivery outcomes, source attachments and previous reviews keep their original identities. Each amendment edition retains the complete before and selected plans, the case snapshot used for comparison, its changed fields, original record links and explicit decision.

## Select and review the change

1. Save the intended change through the ordinary planner. For a partial amendment, start from the intended baseline, edit only the selected parts, and save that complete native revision. Its original content SHA-256 identifies the proposal.
2. Open the existing Delivery & cash case, then **Plan amendments**. Select **New amendment draft** and the exact saved planning revision. The page shows both the current case baseline and every available original saved revision.
3. Enter an as-of date, reason and decision basis. An internal planning decision can use **Internal plan**. An issuer or customer decision also requires its retained source document, original reference and date. Attach that original file through the case's existing Sources view, then select it here.
4. Review **Package attribution in the selected revision**. Supply each required package mapping and its reason, then choose **Preview complete amendment**. Read the complete changed-field table, original and selected record attribution, saved delivery selections, package amounts and hours, and original payment-derived clocks.
5. Save the proposal. Reopen its saved edition, record **Approve** or **Return for changes**, and retain the recording operator, statement and source references. This is the existing operator's explicit decision; the application does not introduce another authority or review role.
6. For an approved compatible edition, select the acknowledgment and apply that exact edition to the case. The native request binds the case version, amendment edition and hash. The result reports the newly selected plan revision while retaining the original case ID.

A later revision of a proposal is another immutable amendment edition. An applied amendment remains fixed; the next change starts a separate amendment. Historical proposals and decisions remain available from the same page.

## Package identity and commercial exposure

The package attribution editor supports explicit reassignment when the selected plan retires a package or moves its work to another tranche. Choose an existing package in the selected revision, or **Explicitly unassigned**, and record a reason. A tranche change that keeps the same package ID uses an explicit mapping to that same ID. Leaving **Keep current attribution** retains the existing association and requires that a referenced package still exists in the same tranche.

The proposal, review and application retain these mappings and the complete before and after work, invoice and deployment records. The application changes the chosen budget attribution, native record version and update time. It preserves record identities, quantities, amounts, state, original recording operator and source fields. Invoice lines retain their original IDs, so existing cash allocations continue to identify the same invoice lines. Multiple original packages can map to one selected package; individual observations and their amounts remain separate.

New browser drafts include the mapping editor. For an earlier saved proposal, use **Enable reviewed package reassignment**, preview the new inputs, and save a new proposal edition. Earlier proposals retain their original comparison and review. Native clients enable this flow by including `packageMappings` in the existing amendment inputs; an empty array explicitly selects current-package reconciliation without changing any actual record attribution.

Saved completion assignments and installation editions retain the plan under which they were recorded. The preview lists those selections for review under the amended revision; Tranche completion prepares the current package draft while retaining the earlier saved assignments. Submitted and accepted outcome scope remains protected by the original delivery decision rules.

The comparison exposes each package's planned amount, recorded invoice amount, recorded payments and recorded hours. It displays the remaining amount or hours and any recorded excess separately. Reducing a budget below recorded invoices, payments or hours therefore leaves that excess visible. Cash allocations remain attached to their original invoices and invoice lines.

These values use the existing native operating report. A remaining planning amount describes the difference from those retained observations; it does not establish an unrecorded contract balance or a bank balance. The selected plan's own calendar start is shown separately from the existing case calendar start. Payment-derived completion clocks are compared in full and must remain unchanged.

## Completion assignments after a package change

Applying an amendment changes the case's selected planning baseline. Open **Tranche completion** to review the assignments against that baseline. The current package list shows the amended scope, hours, budget and calendar alongside the original payment-derived deadline.

A saved assignment row retains the native plan content SHA-256 used when it was saved. When the case selects a different plan, the completion page keeps the earlier saved inputs and marks the tranche for review. Existing assignment fields with the same package identity are carried into the current package list. Added packages start with their native planned dates and empty assignment fields; retired packages remain visible in the earlier saved inputs and original case history.

For unsaved browser edits, use **Keep draft against current case**. The page joins edited rows by package identity to the current package set and retains the complete earlier draft, including retired rows, in a separate expandable section. A linked work observation or deployment whose attribution changed stays visible in its selector so the operator can review it. Choose the current owners and links, then **Save assignments**. This saves the current plan basis even when the remaining assignment text is identical.

**Download assignment draft** exports the current fields and retained earlier draft together. **Open saved assignments** downloads an edited or retained draft before replacing the current fields with the native saved selection. A delayed read keeps the case version and plan basis that were actually requested. A late accepted save is reconciled against the current native assignment row, so a later plan amendment cannot be mistaken for the basis of the earlier request.

Prepare a new completion form after the current tranche assignments have been reviewed and saved. The preview identifies a changed planning basis, changed package set or changed work/deployment association in its existing findings. Earlier prepared forms, actual submission receipts and issuer outcomes continue to reopen with their original frozen source.

An issuer-confirmed deadline extension keeps the assignment plan basis from the original save. Recording that extension does not accept a later package revision. The original payment-derived deadline and the issuer's recorded extension continue to appear together.

The complete operating-case export retains these assignments, their source events, the complete amendment history and all saved native planning revisions. Import resolves each completion row against the planning baseline at its original assignment save, including legacy rows saved before the plan-basis field was added. Historical preparations are validated against their original snapshots; current assignments are opened against the case's current selected plan.

New completion previews and prepared forms retain the same complete case source, including selected installation editions and work/invoice intake references. Earlier prepared forms keep their original bytes and preview hashes; import reproduces their original reference selection and independently checks the complete frozen snapshot before reopening them.

## Concurrent edits and interrupted requests

The original native case version is checked inside the same Workspace transaction used by other operations. Saving and reviewing a proposal advance the case version. An unchanged business snapshot keeps the same amendment preview identity across those own workflow events. New work, sources, invoices, cash, completion assignments or other business changes require a fresh comparison and a newly saved proposal edition.

The browser retains each local amendment draft in IndexedDB with its own identity and revision. Another tab cannot silently overwrite that draft. The page preserves later text while a request is in flight.

Before dispatch, the exact native request is retained in the local draft. If its reply is lost, **Retry exact request** sends that same body and request ID. A committed result is recovered through the original native replay mechanism. Its saved amendment identity is applied to the originating draft on normal completion and replay. A later local edit remains local; it cannot create a duplicate proposal merely because the original reply was uncertain.

An authentication failure retains the pending request. Renew access through the existing workspace sign-in and reopen the same draft. A known native rejection can be explicitly resolved while keeping the entered text. Download the complete local draft when handing an unresolved browser operation to the same original operator. If browser retention fails, a persistent recovery panel appears without replacing the visible fields. Its complete download includes proposal inputs, review statement and sources, application note and displayed acknowledgment. **Download fields and reopen saved draft** retains that current selection as a file before loading the original saved browser edition; the native pending request remains available for exact replay.

## Native API

The original access token, origin rules, Workspace lease and transaction remain in effect.

| Operation | Native route |
|---|---|
| Current baseline, saved revisions and amendment heads | GET /api/operations/{case}/amendments |
| Complete selected edition and history | GET /api/operations/{case}/amendments/{amendment}?revision={edition} |
| Full comparison | POST /api/operations/{case}/amendment-preview |
| Save, review or apply | POST /api/operations/{case}/command |
| Complete operating case and original planner history | GET /api/operations/{case}/export.zip |

The preview body is:

    {
      "expectedVersion": 12,
      "inputs": {
        "selectedRevision": 4,
        "expectedContentSha256": "<actual native planning content SHA-256>",
        "asOfDate": "2026-10-12",
        "packageMappings": [],
        "reason": "Retain the selected package estimate and delivery change.",
        "basis": {
          "kind": "INTERNAL_PLAN",
          "reference": "",
          "date": null,
          "sourceIds": [],
          "note": "Recorded internal planning decision."
        }
      }
    }

An explicit mapping has the shape `{ "fromCostId": "original-package-id", "toCostId": "selected-package-id", "note": "Reason for the new budget attribution" }`. Use the exact IDs shown in the current and selected native revisions. A `toCostId` value of `null` explicitly leaves the retained observation unassigned. Every mapping requires its reason; removing a referenced package without a mapping produces a preview conflict. The complete mapping array is part of the reviewed preview identity.

Every mutation uses the original command envelope:

    {
      "expectedVersion": 12,
      "requestId": "<one original request ID>",
      "actor": "<recording operator>",
      "note": "<reason for this operation>",
      "action": "amendment.save",
      "data": {
        "amendmentId": null,
        "expectedRevision": 0,
        "inputs": "<the complete inputs object used for preview>",
        "expectedPreviewSha256": "<actual returned preview SHA-256>"
      }
    }

For a revised proposal, supply its existing amendmentId and exact expectedRevision. Review data contains amendmentId, expectedRevision, expectedAmendmentSha256, expectedPreviewSha256, decision, statement and sourceIds. Apply data contains amendmentId, expectedRevision, expectedAmendmentSha256 and acknowledgeBaselineChange:true. Use the native response's actual case version and original amendment identifiers rather than the illustrative numbers above.

The headless CLI adds **operations amendments**, **operations amendment-show** and **operations amendment-preview** to the existing workspace entry point. Selection flags are --case, --amendment, optional --revision, --expected-version and --inputs as appropriate. Save/review/apply use the existing **operations command** entry with --action amendment.save, amendment.review or amendment.apply and the original --data, --actor, --request-id, --expected-version and --note selections.

The maintained typed client exposes read('amendments', selection), read('amendment', selection), amendmentPreview(caseId, expectedVersion, inputs), and the same original command(caseId, body). The Merchant operator exposes merchant_grant_amendments, merchant_grant_amendment and merchant_grant_amendment_preview; merchant_grant_case_command carries the three native mutation actions. Original verified model-input references and original request replay remain selected through that provider.

## Complete receiving and historical plans

The ordinary operating-case ZIP now includes amendment-history.json and amendment-changes.csv when a case has amendments. operations.json retains every complete amendment edition. planning.zip still contains the original source and every native planning revision. Existing source files, work/intake originals, invoice and cash records, commercial records, installations, forecasts, portfolios and reviews travel through the same complete export.

Import verifies every amendment hash and edition chain against the native event history, the original planning source and saved revision, the selected business snapshot, review and application. The final selected baseline must join the original case-creation pin through the complete applied chain. Work and invoices created together by original source intake are reconstructed from that intake's exact retained native snapshots. Applied reassignment then continues those same records through the amendment event's complete before and after attribution. Receiving verifies the reviewed mapping, preserved observation fields, exact native versions, original records and resulting record collection.

Older forecasts, portfolios, installations and work/intake selections are checked against the plan that applied at their original case version. Their saved snapshots remain unchanged when the case later adopts a different baseline. A receiving workspace imports the complete case through its ordinary native import and reopens both the current selected plan and all historical amendment editions.

Each case supports up to 50 amendment identities and 300 total editions within a 12 MiB complete amendment-history bound. The original 32 MiB complete operating-bundle bound also applies. A mutation which would exceed that complete export bound rolls back within the original transaction, preserving the previously exportable case.

## Source and operating validation

The implementation is in operations_amendments.py, operations_amendments.mjs and operations_amendments.css, composed into the original Operations, HTTP, CLI, agent client and managed launch source. The grant-operations distribution selects the complete existing SF47 component.

Run the included native walkthrough from the selected source checkout and retain its complete source and output directory together. For a receiving office, open the complete operating-case ZIP through the existing workspace import so the original planner, proposal editions and native records remain available.


## Complete native operating example

The included amendment_receiving.py uses the installed original Workspace and Operations modules. Run it from the selected source checkout with an absolute, private operating directory:

    python3 stellar/scf_2026/sf47_budget_model/workspace/amendment_receiving.py \
      --root /absolute/path/to/amendment-operating-work

It creates a clearly labelled WALKTHROUGH case from the retained public proposal source. The complete CSV intake, invoice and cash allocations are internal exercise records. The workflow retains a historical forecast, saves a partial allocation change as a complete native revision, preserves a later planner revision, rejects an outdated case review, applies and replays the exact accepted amendment, then exports and receives the full case in two fresh native workspaces.

Each issued request and phase is retained in output/amendment-receiving-checkpoint.json. The result and original archives remain under output; repeated invocation uses the same completed phase results and verifies its retained artifacts. Use the ordinary operating-case import for a selected exported case. Keep the full source and output directory together when handing over the completed exercise.

The original amendment workflow completed three native executions on October 12. The final execution used merged PR533 and preserved its complete source, case and output in `SF47_Grant_Amendment_Complete_Receiving_20261012.zip`: 2,717,055 bytes, 135 members, SHA-256 `446c655a71348c0302f837f251c895dbefc8338bb9fb7abcc244b34ba7ba39ac`. That execution completed all ten operating phases: revision adoption, rejection of an outdated review after a case edit, accepted-request replay, complete export and cold receiving, preservation of a later receiving-office edit, and a second receiving/reopen. It retained five amendment editions in labelled WALKTHROUGH cases. The earlier two successful executions remain separate historical results of the original workflow.


## Continue the retained case with explicit package reassignment

A completed native run can continue from its original case, first receiver, or second receiver using the same checkpoint and database. Restore the complete saved operating directory, then run the current source against that directory. For example, to continue the retained first receiver:

    python3 stellar/scf_2026/sf47_budget_model/workspace/amendment_receiving.py \
      --root /absolute/path/to/amendment-operating-work \
      --continue-packages receiver

The other selections are `original` and `second-receiver`. Select the database that contains the original work the receiving operator is continuing. The first invocation retains that route and case identity under `packageContinuation` in the existing checkpoint; subsequent invocations use that same selection. The source reader checks the selected existing SQLite case and its complete original source bytes before opening it through Workspace. A missing checkpoint or selected database requires restoring the original operating directory.

This continuation starts after the ten original phases. It uses the selected case's retained invoice and work records, then saves a planned Deployment and complete Installation referencing their original package and source. A labelled WALKTHROUGH grant receipt supplies the native payment date for Completion. The full original tranche assignments and preparation retain both work-intake and Installation references. A saved native forecast and delivery portfolio preserve their original source before the amendment.

The next saved planning revision replaces one referenced package identity while retaining its selected budget, scope, timing and planning assignments. The normal amendment preview, save, review and apply operations carry one explicit mapping from that package to its successor. The native comparison includes the complete original work, invoice and Deployment records. Application retains their identifiers, original quantities, cash records and sources, with complete before and after attribution in the same amendment history.

The continuation reopens the database and replays the accepted application, verifies the original forecast, portfolio, Installation and preparation editions, then opens the amended Completion draft. It preserves the original assignments as `previousInputs`, reconciles every current tranche package, and saves a current preparation through the same native Completion API. Both preparations retain complete original snapshots, source references and hashes.

Finally, the ordinary operating-case export carries all original source files, planning revisions, amendment editions, records, work intakes, Installation editions, forecasts, portfolios, assignments and prepared reviews. A dedicated receiving workspace imports that exact complete ZIP. The continuation preserves a later receiving-office note, replays the same import, reopens the database, and writes the full successor handover.

### Retained continuation and delivery

The original checkpoint's completed phases and original result remain available. The continuation retains nineteen additional phase results, its selected native planning request, every exact command body, the complete import identity, and returned native receipts. Previews and full source artifacts are written before their dependent native operations. Run the same command again after an interruption: an accepted request is replayed with its original identity, and an already completed phase is reused. A changed native source produces the original conflict together with the retained command and phase, so the receiving operator can recover the same operation.

Continuation artifacts use the `Package_` filename prefix under the original `output` directory:

| Artifact | Complete retained content |
|---|---|
| `Package_Before_Mapping.zip` | Original records, Installation, historical Completion, forecast and portfolio before reassignment |
| `Package_Applied_Amendment.json` | Accepted native amendment and complete record attribution changes |
| `Package_Historical_Completion_Preparation.json` and `Package_Current_Completion_Preparation.json` | The exact original and current prepared Completion snapshots |
| `Package_Complete_Case.zip` | Full source case after mapping and current Completion |
| `Package_First_Received_Case.zip` | Complete native receiving result before the later receiving-office edit |
| `Package_Received_Complete_Handover.zip` | Complete successor case after import replay and database reopen |
| `package-receiving-result.json` | Actual case selection, receipts, completed phases and artifact identities |

Keep the checkpoint, selected database directories and complete output directory together for further receiving. Artifact identities use their full byte lengths and SHA-256 values. Relocated original outputs are checked by their retained filename under the restored output directory. The result records success only after the complete native case import, historical validation, source readback, accepted-request replay and final reopen have returned successfully.
