# Prior decisions in a continuing reconciliation

This workspace carries an engineer's selected earlier decisions from a frozen report into a different run of the same comparison pair. It records a new disposition on each selected later subject and keeps the earlier report, original decision, review and application available in the resulting report and portable handover.

Open **Prior decisions** from Dataset reconciliation. The screen uses the original local DuckDB workspace, private launch capability, request journal and portable warehouse.

## Complete operator workflow

### 1. Choose the original report and the receiving run

On **Choose comparison**, choose the saved pair. In **Earlier frozen report**, choose the original run and one of its frozen reports. In **Later run**, choose a different run of that same pair.

The catalogs have explicit Previous and Next controls. A selected record stays visible when it came from another page. Complete identifiers can also open an original pair, report or target run directly. The screen shows the source report's frozen decision revision and the receiving run's current decision revision.

The source report determines which earlier decisions enter the review. Edits made to its original run after the report was frozen do not enter that report. To use those later decisions, first freeze a new report in the original reconciliation workspace.

Enter an **Engineering basis** explaining the continuing comparison, its intended source meanings and any capture-window changes. This explanation travels with the immutable review. It does not change the native compatibility or value checks.

Select **Create decision review**. This saves a review at the displayed target decision revision. It does not apply any earlier decision.

### 2. Review the complete findings

The review retains the complete original source and target review records, including their definitions, source editions, scopes, column meanings, comparison rules and normalization policies. Open the policy checks and capture changes before choosing decisions.

All earlier decision candidates remain in the catalog, including those that cannot be applied:

| Native state | Screen label | What the engineer should inspect |
| --- | --- | --- |
| ELIGIBLE | Available | The earlier resolved disposition, matched later subject and passed native checks. |
| PRIOR_OPEN | Earlier decision open | The earlier report contains an open disposition, with no resolved decision to carry. |
| POLICY_CHANGED | Policy changed | The returned source-meaning, scope, mapping, normalization or comparison-policy differences. |
| GROUP_MISSING | Group missing | The original key group is absent from the receiving run. |
| VALUES_CHANGED | Values changed | The complete original values or canonical comparison have changed. |
| ROW_MISSING | Row missing | The original row does not occur in the receiving run. |
| ROW_AMBIGUOUS | Row ambiguous | More than one row could receive this particular row decision. |
| TARGET_REVIEWED | Already reviewed | A decision already exists for the later subject, including an OPEN decision. |

Each candidate has its original decision sequence. It retains the full earlier decision, the original and matched later subjects, any existing target decision, reasons and individual check results. Row candidates also expose exact occurrence counts and their original/later group IDs. The row basis distinguishes a complete group plus a unique row from the explicit unresolved-key, row-local comparison.

The native engine compares complete original data. A group disposition stays attached to its entire key group and its complete row multiset. A row disposition with a known group requires unchanged complete native group bags on both sides, as well as an unambiguous exact same-side original-row match. For example, an unchanged source value cannot inherit its earlier exception decision after the corresponding target value changes. A row whose key is unresolved has no paired group: it uses the explicit row-local exact-content basis, without asserting that an opposite-side finding is unchanged. Matching a display name alone does not establish continuity between sources.

Choose **Inspect** to open the complete candidate. The earlier and later panels show the original disposition and target subject side by side. **Inspect original row** opens every original and canonical field using its native representation. **Inspect all group rows** opens the complete paged original-row catalog for that group, including duplicate occurrences.

The state and subject filters affect the visible catalog. They do not remove records from the saved review or discard selections on other pages. **Download all candidates** reads every original page before offering one complete JSON file; it does not silently export only the visible page.

### 3. Select and apply the intended decisions

Nothing is preselected. Select individual available decisions, use **Select available on this page**, or explicitly choose **Select all available decisions**. The last action reads the entire available-candidate catalog before changing the selection.

The selection count includes every selected page. **Inspect complete selection** opens the complete original candidate records for the selected decision sequences. **Clear selection** clears the draft selection while retaining the immutable review.

Enter the **Engineer** and **Reason for this selection**. Both become part of the original application. Select **Apply selected decisions** to apply exactly those available candidates.

One reviewed selection can be applied per review. A different selection needs a new review. An application never overwrites an existing target decision. The native transaction checks the exact target revision again; a staff edit made after this review was prepared requires a new review of that current revision.

The completed application shows:

- Its own original identifier and the source report and review.
- The target run's prior and resulting decision revisions.
- Every selected earlier decision sequence, matched later subject, new decision sequence and resulting outcome.
- The engineer, reason and application time.

A later staff edit remains visible as a newer target revision when the current run is refreshed. The application record continues to describe its original transaction.

### 4. Freeze the result and prepare the complete handover

Open **Saved applications**. Reopen an original review or application from the complete paged history. Refresh the current target run if other staff have continued reviewing it.

Choose **Freeze current target report**. This uses the original report writer at the displayed target revision. When a continuing review is open, the report also compares against its original source run through the existing previous-run report path.

Open the frozen report and inspect **Complete decision carry-forward lineage**. The report retains references to the applications and reviews that produced its carried decisions, original frozen reports and all ancestral source editions. Each original record can be reopened without applying another decision.

Choose **Prepare complete handover**. The original export pipeline prepares its normal portable warehouse and complete source-backed report package. In addition to the usual report queries and original files, the package contains:

- The full saved query named `decision_carry`, with every candidate from the report's applied reviews, the selected flag and actual new decision sequence.
- Original frozen reports under `decision-carry/reports/<report_id>.json`.
- Original review records under `decision-carry/reviews/<review_id>.json`.
- Original application records under `decision-carry/applications/<application_id>.json`.
- Original source files for every source edition referenced by the retained lineage.
- The complete portable warehouse with the native review, application, decision and request records.

The file catalog includes every declared original filename, byte length and SHA-256. It is paged without dropping files. **Save all files to a folder** preserves their relative paths where the browser supports directory access. Otherwise, download the complete individual files from the catalog. The existing streaming download path checks the delivered byte length against the manifest and aborts an incomplete stream.

The report JSON is a useful review copy. The full exported warehouse and declared source files are the continuation package.

## Reopening and interrupted requests

Before sending a review, application, report or handover operation, the browser retains the original request identifier and complete JSON body in the same request store used by Dataset reconciliation.

**Saved requests** combines this screen's retained requests with the original reconciliation and export journals. Each local request shows the browser state, last observed native state, full body, original result and any returned error.

- **Inspect original request** reads the original native journal. It does not resume or apply anything.
- **Open saved result** opens the original completed review, application, report or handover.
- **Continue original request** first reads that same request. A complete request returns its original result. A retained unfinished request uses the original resume route. If the native journal confirms that exact identifier is absent, the action sends the original retained body and identifier.
- A transport failure remains a response-unknown browser record. Reloading the page or refreshing a catalog does not send a replacement application.

If an application for the current review is unfinished, the review screen links to that original request and keeps another selection from being submitted through that review. A newer target decision revision requires a new review; its earlier selection and requests remain retained for inspection.

Browser storage is required before a new operation can be sent. Existing native records can still be read when browser storage is unavailable. Reopen using the original private workspace launch link if the listener rejects the capability. The capability is carried in the launch fragment or current tab storage, not in exported report data.

## Saved selections and direct workspace links

The screen stores the current comparison, engineering basis, engineer and reason. Selected candidate identifiers are retained separately for each original review. Moving to another original record first retains the existing draft.

The dedicated route is `/reconciliation/carry-forward`; the same listener also accepts `/carry-forward`. The following optional query selectors read or adopt one original record:

| Query parameter | Read action |
| --- | --- |
| source_report_id | Select the original frozen report and its original pair/run. |
| review_id | Reopen an immutable decision review and its retained draft selection. |
| application_id | Reopen the original application and its review. |
| request_id | Inspect and adopt the exact reconciliation request; do not resume it. |

Use one selector per link. The normal reconciliation request cards use the original request selector, and report lineage links use the original source-report selector. The private launch capability continues to use the same fragment and tab-storage convention as the existing workspace.

## Native HTTP contract

All routes use the original `/api/reconciliation` namespace unless otherwise stated. The browser sends the existing `X-DuckDB-Capability` and `X-DuckDB-Workspace-ID` headers.

Create a saved review with POST `/carry-review` and these complete fields:

```json
{
  "request_id": "original 32-hex request identifier",
  "workspace_id": "original 32-hex workspace identifier",
  "source_report_id": "original 64-hex frozen report identifier",
  "target_run_id": "original 64-hex receiving run identifier",
  "expected_revision": 0,
  "scope_basis": "Engineer-written continuing comparison basis"
}
```

Apply one explicit selection with POST `/carry-apply`:

```json
{
  "request_id": "original 32-hex request identifier",
  "workspace_id": "original 32-hex workspace identifier",
  "review_id": "original 64-hex review identifier",
  "review_sha256": "the exact saved review SHA-256",
  "expected_revision": 0,
  "candidate_ids": [1, 4],
  "actor": "Engineer",
  "reason": "Why these selected earlier dispositions still apply"
}
```

These are field-shape examples. Supply the original real identifiers, the displayed target revision and actual selected candidate sequences; the placeholder strings are not executable identifiers.

Read the native records and complete pages with:

| Relative route | Result |
| --- | --- |
| GET /carry-reviews?target_run_id=…&offset=0&limit=100 | Original review catalog for the receiving run. |
| GET /carry-reviews/<review_id> | Complete immutable review. |
| GET /carry-reviews/<review_id>/candidates?state=…&kind=…&offset=0&limit=100 | Complete candidate page, including total and next_offset. |
| GET /carry-reviews/<review_id>/candidates/<candidate_id> | One complete candidate. |
| GET /carry-applications?target_run_id=…&offset=0&limit=100 | Original application catalog. |
| GET /carry-applications/<application_id> | Complete immutable application. |
| GET /requests/<request_id> | Original native request. |
| POST /requests/<request_id>/resume | Explicit continuation of that request with its original workspace identity. |

The original pair, run, report, raw-row, report export and workspace transfer routes remain the source of those records. Reports use the existing report writer. Complete handovers use the existing export journal at `/api/requests/<request_id>` and its original resume route.

## Command line and agent continuation

The installed Python package exposes the same journal through its existing
DuckDB command. Keep the private listener closed when the command needs the
warehouse writer. Supply absolute paths to your original retained JSON bodies.

```sh
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile carry-review --request-file /absolute/private/carry-review.json
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile carry-reviews --target-run-id ORIGINAL_RUN_ID --offset 0 --limit 100
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile carry-review-read ORIGINAL_REVIEW_ID
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile carry-candidates ORIGINAL_REVIEW_ID --offset 0 --limit 100
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile carry-candidate ORIGINAL_REVIEW_ID --candidate-id ORIGINAL_SEQUENCE
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile carry-apply --request-file /absolute/private/carry-apply.json
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile carry-applications --target-run-id ORIGINAL_RUN_ID --offset 0 --limit 100
python -m stellar_forge_buyer.duckdb_cli --workspace /absolute/private/workspace reconcile carry-application ORIGINAL_APPLICATION_ID
```

Replace the named identifiers with the actual returned original IDs. Candidate
pages also accept `--state` and `--kind group|row`. Follow each page's
`next_offset` until it is null. The existing `request`, `resume`, `report`,
`export`, `export-request` and `resume-export` commands keep their original
request and recovery behavior. The review and application request files use
the exact HTTP body shapes above, including `workspace_id`.

The installed JavaScript export is `./buyer/duckdb/reconciliation`; its source
is `stellar-forge/mcp-paid-agent/duckdb-reconciliation-client.mjs`. Open
`openDuckDBReconciliationClient` with the existing MCP client, registered
workspace alias and expected original workspace ID. The new methods are:

| Client method | Native operation |
| --- | --- |
| prepareCarry(body) | reconcile-prepare-carry |
| carryReviews({target_run_id, offset, limit}) | reconcile-carry-reviews |
| carryReview(reviewId) | reconcile-carry-review |
| carryCandidates(reviewId, {state, kind, offset, limit}) | reconcile-carry-candidates |
| carryCandidate(reviewId, candidateId) | reconcile-carry-candidate |
| applyCarry(body) | reconcile-apply-carry |
| carryApplications({target_run_id, offset, limit}) | reconcile-carry-applications |
| carryApplication(applicationId) | reconcile-carry-application |

These operations use the original `sf43_discover_review_and_pay` tool with its
DuckDB action and registered alias. Agent mutation bodies retain the original
`request_id`, expected revision and complete selected body, but omit
`workspace_id`: the existing native adapter injects the identity pinned by
the registration. Do not reconstruct original numeric values through
JavaScript numbers; all eligibility arithmetic and typed row comparisons
remain in DuckDB.

After applying, use the same client's `saveReport`, `exportReport`,
`inspectExport` and complete `download` operations. The original receiver
checks every declared file, keeps byte-range progress and preserves the
original report digest and workspace identity. Close only this adapter when
finished. The full receiving commands in `OPERATING.md` reopen a new sparse
working warehouse from the complete package, with all prior decisions and
request histories intact.

## Continue the original visible receiving workflow

The source-owned receiving function is
`sf88-operator-buyer-cli/native-receiving/decision-carry-browser.mjs`, relative
to the selected `stellar/scf-starforge-20261009` source. It operates this same
panel and the original request journals. The caller supplies an already running
local workspace and the existing installed browser:

~~~js
const result = await runDecisionCarryBrowserReceiving({
  url: originalPrivateLaunchUrl,
  input: {
    operation_id: originalOperationId,
    source_commit: selectedSourceCommit,
    workspace_id: originalWorkspaceId,
    pair_id: selectedPairId,
    source_report_id: frozenEarlierReportId,
    target_run_id: laterRunId,
    scope_basis: reviewedEngineeringBasis,
    actor: reviewingEngineer,
    reason: explicitSelectionReason,
  },
  outputDirectory: originalReceivingDirectory,
  playwright: installedPlaywrightModuleOrAbsolutePath,
  chromium: installedChromiumExecutable,
});
~~~

Import the named function from the complete selected source file. Preserve the
same input and output directory when continuing an interrupted operation. Keep
the private launch URL with the local caller. The function starts its own browser
context, closes that context on exit, and leaves the existing workspace listener
under its original owner's control.

This receiving operation reads every candidate in the selected review and
explicitly selects **all eligible decisions** after opening their complete
selection. Choose its input only when that complete eligible set is the
engineer's intended selection. Use the ordinary panel for a smaller selection.
At least one eligible decision is required. The function inspects representative
original rows and groups for every available kind/state, reopens the same
application and request after reload, freezes the actual target report, then
downloads every declared handover file through the panel's supported individual
file controls. It does not turn an ineligible source or changed policy into an
eligible one.

The returned `download_directory` and `manifest_sha256` identify the complete
original handover. Inspect and receive that directory with the existing
reconciliation package commands above, retaining the original workspace UUID.
The result also records the actual review, application, report, export and
request IDs. The browser profile remains beside the receiving directory so a
continuation can recover its original request IDs; keep it private and exclude
it from the customer handover. A completed browser return verifies all saved
handover file lengths and hashes again. Browser screenshots and its diagnostic
journal are internal operating records, separate from the original handover.
