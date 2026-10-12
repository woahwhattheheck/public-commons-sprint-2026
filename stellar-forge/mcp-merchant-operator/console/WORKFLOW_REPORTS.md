# Workflow reports and receiving

The Workflows page can compare a saved run with another run of the same workflow, export its complete selected history, and receive that history into an operator profile.

## Build and inspect a report

1. Open **Workflows**, select a profile, and open a retained run.
2. In **Workflow report**, choose a baseline run from the same saved workflow. The latest earlier run is initially selected when available. Choose **No baseline** for a single-run handover.
3. Choose **Build report**. The report retains the current and baseline run revisions together with their exact saved workflow editions.
4. Review the run summary, then open a step comparison. Use the original-request and recovery-result buttons to inspect the existing native calls.
5. Use **Show changed steps only** to focus on changed source, arguments, results and execution outcomes.

Steps are matched by their stable step identifiers. Added and removed steps, changed position or name, bindings, required values, pause settings, tool identity and saved native-contract fingerprints appear separately. Complete native-definition comparisons are available when the original recipe installation retained those definitions. Ad hoc saved requests retain their original contract fingerprints.

The comparison distinguishes the saved argument template, the arguments prepared after workflow bindings, the effective native request used after recovery, and the returned result. Missing JSON members differ from JSON null. Change pointers use the normal JSON Pointer escaping: `~1` represents a slash and `~0` a tilde.

Required native result values show PASS, FAIL, MISSING or UNAVAILABLE against the selected effective result. A recovered step retains its failed or pending original request, linked recovery attempts, selected recovery call and the operator's resolution note.

The step-change filter uses source, arguments, results and execution outcomes. Timing appears in its own columns. A duration delta is current minus baseline. Run duration uses creation through completion, or through the last retained update for an unfinished run. Native totals sum completed linked calls, including recovery attempts. Compare inputs, workflow editions, hosts and owners alongside these measurements.

The displayed report is a fixed snapshot. When retained run history advances, the page offers a new build while existing downloads continue to use the displayed revisions.

## Export formats

| Download | Contents | Use |
| --- | --- | --- |
| Report JSON | Sealed report, selected runs, required workflow editions, complete original drafts, native calls and results, recovery history, recipe installations and profile host-binding history | Receiving, durable handover and further analysis |
| HTML | Summary, complete comparisons, native results, original run events and saved source in one standalone document | Offline reading and review; expand the source sections as needed |
| Steps CSV | One row per stable step with outcomes, source identities, native contracts, original and effective call IDs, timing and recovery notes | Step-level analysis |
| Changes CSV | Every changed JSON value with its field, pointer, presence flags and complete baseline/current JSON | Detailed comparison and downstream analysis |

CSV cells are quoted and protected from spreadsheet formula evaluation. HTML escapes retained content, loads no remote resources, and uses a neutral printable layout. JSON preserves the original native JSON strings and digests.

The browser renders changed values in groups of 30 to keep a large report responsive. Downloads contain all changes. Full values can be expanded in the page.

A complete portable report is limited to 128 MiB. A single run can reduce a two-run export. The existing full-profile export remains available for a larger profile handover. Report files contain the selected native arguments, returned data and profile binding details, so their contents can be reviewed before delivery.

## Receive and reopen

Choose a report JSON file under **Receive a report**, then **Review selected file**. The preview shows the original profile, selected run revisions, source workspace, current execution owner, included records and report digest.

**Receive reviewed report** imports the complete selected archive through the existing Console receiving transaction. The page selects the received profile, opens the original run and builds a report from the retained history.

Receiving uses original identifiers and conflict checks. Existing longer run histories remain in place. Repeated receiving of the same archive is idempotent. Conflicting immutable request revisions, original request identities and terminal native results use the original archive conflict handling. The current dispatcher predicate is forwarded to the existing import path.

Execution ownership is retained in the run and handover events. Continue and handover actions remain available through the original workflow controls after opening the received run.

The report archive selects the required source closure: current and optional baseline run; each referenced workflow edition; the original recipe installation and its first edition when present; original/prepared drafts; calls; and linked recovery drafts and calls. It also preserves the original profile's binding history. Other customer-delivery archives retain their existing receiving workflow.

## Authenticated Console API

These routes use the existing operator authentication, origin checks and per-tool authorization.

| Method and route | Request | Response |
| --- | --- | --- |
| GET `/operator/api/workflow-report?run=RUN_ID&baseline=BASELINE_RUN_ID` | Optional baseline; both runs must belong to the same profile and saved workflow | `{ packet }` |
| POST `/operator/api/workflow-report-review` | `{ packet }` | Original profile, computed report, report/archive digests and receiving workspace |
| POST `/operator/api/workflow-report-receive` | `{ packet, expectedContentSha256 }` using the reviewed report digest | Original import result, selected run identities and their retained revisions |

The report JSON envelope is:

```json
{
  "schema": "stellar-forge.merchant-workflow-report.v1",
  "selection": {
    "runId": "original-current-run",
    "baselineRunId": "original-baseline-run"
  },
  "archive": {
    "schema": "stellar-forge.merchant-operator-profile.v1"
  },
  "report": {},
  "contentSha256": "SHA-256 of canonical envelope fields excluding this field"
}
```

This example shows the envelope shape. Exported archives and report objects contain their complete original fields.

Review validates the complete existing archive, selection closure and report checksum, then recomputes the analysis from the original records. Receiving repeats that validation and checks the selected report digest before invoking the same archive import transaction. Every included saved request and native call passes through the existing tool authorization.

## Embedding and source

`createMerchantWorkflowReports({ store, requireTool, requireOpen, isActiveCall })` exposes `view`, `review` and `receive`. The existing Console service supplies its current dispatcher predicate as `isActiveCall: call => active.has(call.id)`.

The store exports `validateConsoleArchive(packet)` so report review and original profile import share one validator. Existing schema checks, host-binding history and the import transaction remain the source of receiving behavior.

`public/workflow-report-format.mjs` provides the HTML, steps CSV and changes CSV formatters. `public/workflow-reports.mjs` supplies the report and receiving interface within the existing Workflows page. The page forwards its existing `loadProfiles` callback to reopen the received selection.

Recurring customer periods use their original workflow run IDs, so a cycle can be compared with another period of the same saved workflow through this report view.
