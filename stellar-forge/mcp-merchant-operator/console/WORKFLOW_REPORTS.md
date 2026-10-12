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

## Command-line reporting and receiving

The installed command is `starforge merchant-workflow-reports`. It uses the same authenticated loopback Console as the existing OpenAPI workflow and recurring-series clients. Keep the existing Console running, with its bearer token in the selected environment variable. The default variable is `MCP_ACCESS_TOKEN`. `--token-env` selects another existing variable.

The example IDs and port below are placeholders. Read the current saved profiles and workflow history, then use their original identifiers:

```sh
starforge merchant-workflow-reports profiles \
  --url http://127.0.0.1:7788/operator/
starforge merchant-workflow-reports list \
  --url http://127.0.0.1:7788/operator/ \
  --profile original-profile-id
starforge merchant-workflow-reports run \
  --url http://127.0.0.1:7788/operator/ \
  --run original-current-run
```

`list` returns the original authorized workflow definitions and saved runs. Select a baseline with the same workflow ID. A single-run report omits `--baseline`.

### Capture every format

```sh
starforge merchant-workflow-reports capture \
  --url http://127.0.0.1:7788/operator/ \
  --run original-current-run \
  --baseline original-baseline-run \
  --directory ./private-reports/october-period
```

Capture creates a private directory and retains four complete files:

| File | Contents |
|---|---|
| `report.json` | Exact selected archive, computed report, selection and original content digest |
| `report.html` | Standalone readable report with the complete retained request, result and recovery context |
| `steps.csv` | Every compared step, outcome, duration and original identity |
| `changes.csv` | Every changed value, including explicit presence information |

The JSON packet is published first through the existing Console atomic file writer. Repeating the same capture reopens that first packet and finishes any missing formats. It does not fetch a newer report after the original JSON has been saved. A different run selection, later snapshot, or different existing output bytes requires another directory. The returned file records contain the actual saved path, byte length and SHA-256.

To build only the original JSON, use `build --run … --baseline … --output /private/path/report.json`. Output files use existing private parent directories, matching the original Console clients.

### Work with the saved report offline

The browser's report JSON and the client packet use the same schema. They can be inspected and rendered without a running Console or bearer token:

```sh
starforge merchant-workflow-reports inspect \
  --input ./received/report.json
starforge merchant-workflow-reports export \
  --input ./received/report.json \
  --directory ./private-reports/received-period
starforge merchant-workflow-reports reopen \
  --directory ./private-reports/received-period
```

`inspect` validates the whole packet and recomputes its report from the original history. `export` writes all four formats through the existing immutable writer. `reopen` checks every complete export against its retained report and returns the original selection and exact file identities. It leaves the saved output bytes in place.

### Review, receive and reopen the original history

Use the receiving workstation's original Console URL and token environment:

```sh
starforge merchant-workflow-reports review \
  --url http://127.0.0.1:8899/operator/ \
  --directory ./private-reports/received-period

starforge merchant-workflow-reports receive \
  --url http://127.0.0.1:8899/operator/ \
  --directory ./private-reports/received-period

starforge merchant-workflow-reports history \
  --url http://127.0.0.1:8899/operator/ \
  --run original-current-run \
  --baseline original-baseline-run
```

Both review and receive accept exactly one of `--input` for a complete JSON packet or `--directory` for all four saved report exports. Receiving reviews that same packet through the existing authorization engine, imports it using its original content digest, and reads back its original profile and selected runs. The optional `--expected-sha256` binds a script to a previously selected report digest.

A lost receiving response is continued by submitting the same saved packet. The original archive import is idempotent. If import completes and a later history read fails, the client error carries `receivingCompleted: true` and the received record; the CLI includes that record in its error result. `history` can reopen those same original run IDs. Existing longer local history is retained, so the reopened revision can be later than the report's frozen revision.

`--output` can retain the full result of a command using the existing atomic writer. The terminal output for capture, offline export, reopening and receiving summarizes the saved selection and files; the complete JSON result is available through an explicit output file.

## Typed operator client

The maintained distribution exports `./merchant/console/reports`, with adjacent TypeScript declarations. From a source checkout, import the original module:

```js
import {
  MerchantWorkflowReportClient,
  writeWorkflowReportExports,
  reopenWorkflowReportExports,
  readWorkflowReportFile
} from './stellar-forge/mcp-merchant-operator/console/workflow-report-client.mjs';

const source = new MerchantWorkflowReportClient({
  url: 'http://127.0.0.1:7788/operator/',
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
try {
  const available = await source.workflows('original-profile-id');
  const captured = await source.capture({
    runId: 'original-current-run',
    baselineRunId: 'original-baseline-run',
    directory: './private-reports/october-period'
  });
  const reopened = await reopenWorkflowReportExports({
    directory: captured.directory
  });
  console.log(available.runs.length, reopened.contentSha256);
} finally {
  source.close();
}

const receiver = new MerchantWorkflowReportClient({
  url: 'http://127.0.0.1:8899/operator/',
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
try {
  const packet = await readWorkflowReportFile(
    './private-reports/october-period/report.json'
  );
  const reviewed = await receiver.review(packet);
  const result = await receiver.receive(packet, {
    expectedContentSha256: reviewed.contentSha256
  });
  console.log(result.received.reportSha256, result.history.run.id);
} finally {
  receiver.close();
}
```

The client exposes host/profile reads, workflow/run listing, report construction, review, receiving, current history and resumed capture. Offline helpers reopen original report files and render all export formats. The typed interfaces preserve selected run IDs, revisions, complete native request/result records, changed-value presence, receiving results and file identities.

The client reuses `OpenApiWorkflowClient` for connection pinning, bearer transport, origin handling, cancellation and failed-write outcome reporting. The report backend remains the existing `workflow-reports.mjs` service; all control and receiving pass through its existing authorization and import engine. Recurring periods use their original run IDs, and installed series behavior stays in the maintained series-aware Console store and service.
