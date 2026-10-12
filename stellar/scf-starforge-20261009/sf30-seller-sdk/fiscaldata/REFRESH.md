# Saved Fiscal refresh plans

A saved refresh plan turns a reviewed Fiscal edition into a repeatable analyst workflow. It retains the original source revision, chosen fields, source units and scale annotations, null markers, row keys, query capabilities, comparison selection and authored briefing context. Each run freezes that plan revision and its actual dated query before it starts the original Treasury capture worker.

The complete flow is:

1. Select a READY baseline and save its plan.
2. Preview the exact Treasury query for an explicit UTC as-of date.
3. Start the run. It retains each original capture, edition, comparison and export request before execution.
4. Review any changed source schema in the existing edition editor. The run retains its capture and waits for the exact READY review.
5. Download the complete comparison, offline briefing and source handover.
6. Explicitly promote the completed candidate when it should become the next baseline.

The prior baseline remains selected until step 6. A refreshed source, edited plan, completed report or server restart does not implicitly replace it.

## Open the existing operator

Use the installed command or the original source CLI:

~~~sh
starforge fiscaldata workspace --dir /private/treasury --port 0
# Or, from the original source tree:
node stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata/cli.mjs \
  workspace --dir /private/treasury --port 0
~~~

Choose **Saved refresh plans** in the original browser. The managed Applications launch and named Merchant MCP browser expose this same page and model. Their existing operator identity, authenticated listener, origin checks, process ownership and Stop lifecycle remain in force.

The source CLI supports Node 22+ on Linux with util-linux flock. A managed installed profile may declare a more specific Node runtime; use its original launcher. A source refresh and analyst report require no payer configuration. The existing publisher and buyer retain their separate native terms, signing and approval interfaces.

### First plan

Choose a READY edition as the baseline. The definition shows its complete field and query rules. Field review remains in **Review editions**; select a different READY baseline if the source interpretation needs to change.

Enter a plan name, row keys and exact measures. Comparison keys are published field names, and must identify a complete source row. Measures must already be reviewed as measures in the baseline. The original comparison engine retains decimal precision and original source units.

Add a briefing title, audience and authored notes. These accompany the original data-driven report. They are frozen into each run, so editing a plan later does not alter an earlier report.

### Capture policies

| Policy | Retained behavior |
|---|---|
| Repeat the saved source query | Reuses the exact baseline source ID, revision and SHA-256, including endpoint, filters, sort order and page size. |
| Rolling date window | Creates an original source query for each run, with the exact endpoint, sort and page size plus an explicitly authored base filter and UTC date range. Its creation request ID is retained before the source is saved. |

For a rolling window, choose an original source field reviewed as a date, a number of calendar days, a publication lag and the additional source filter. The window ends on **as-of date minus lag**, includes that end date, and contains the stated number of calendar days. A seven-day window as of 2026-10-12 with a one-day lag requests 2026-10-05 through 2026-10-11. Treasury may report only the dates on which it publishes observations; the workflow does not create missing weekend or holiday rows.

The base filter is an explicit operator choice. The software does not guess which clauses in an earlier source query to remove. Leave the base filter empty when the date window should be the only filter. Preview shows the complete resulting original Treasury URL before Run is enabled.

A run freezes its as-of date. Resuming it tomorrow requests the original selected interval. Start a new run for a new period.

## Original model API

All public actions use the existing API:

~~~js
const response = await model.dispatch(action, payload);
// response.result is the action result.
// response.state is the original Fiscal workspace snapshot.
~~~

Keep the original model open for a browser or embedded caller. A standalone caller closes it when finished. There is one kernel workspace lease and one serial writer; the refresh helper borrows original internal operations inside that writer. It does not open a second model or create a second capture worker.

### Save a plan

~~~json
{
  "requestId": "treasury-debt-plan-20261012",
  "name": "Daily federal debt review",
  "baselineEditionId": "YOUR_READY_EDITION_ID",
  "expectedBaselineSha256": "YOUR_READY_EDITION_SHA256",
  "capture": {
    "mode": "window",
    "dateField": "record_date",
    "days": 7,
    "lagDays": 1,
    "baseFilter": ""
  },
  "comparison": {
    "keyFields": ["record_date"],
    "measureFields": ["tot_pub_debt_out_amt"]
  },
  "briefing": {
    "title": "Federal debt — dated source review",
    "audience": "Finance and policy colleagues",
    "notes": "Compare the published stock observations on their stated dates. Keep the complete source and field interpretation with this report.",
    "rowsPerPage": 200
  },
  "notes": "Review Treasury publication changes before selecting the next baseline."
}
~~~

Call **refresh.plans.save**. Replace the example edition ID/hash and published field names with the exact selected native edition; the API validates them.

For an edit, add id and expectedRevision from the current saved plan, and use a new requestId. The resulting plan retains every prior definition, baseline and request identity. An identical request replay returns the existing saved plan. Reusing a request ID with different input is rejected.

The read actions are:

| Action | Input | Result |
|---|---|---|
| refresh.plans.list | optional offset, limit | items, offset, limit, total, nextOffset |
| refresh.plans.get | id | Full definition, current revision/SHA and complete versions |
| refresh.runs.list | optional planId, offset, limit | The same complete pagination envelope |
| refresh.runs.get | id | Full frozen run, native step inputs/results, schema changes, review and delivery identities |

List limits are 1–100; follow nextOffset until null. Snapshot and named status add refreshPlans and refreshRuns summaries. The original default workspace limits retain up to 128 plans and 256 runs, with up to 128 complete versions per plan. Existing configurable capture, edition, comparison and export ceilings continue to apply.

### Preview and start

~~~js
const selected = {
  planId: savedPlan.id,
  expectedRevision: savedPlan.revision,
  expectedPlanSha256: savedPlan.sha256,
  asOf: '2026-10-12'
};
const preview = (await model.dispatch('refresh.runs.preview', selected)).result;
// Review preview.sourceUrl, preview.period, preview.baseline and preview.review.
const run = (await model.dispatch('refresh.runs.start', {
  ...selected, requestId: 'treasury-debt-period-20261012'
})).result;
await model.startWorker();
~~~

Preview is a read and performs no source fetch. Start retains a new run and its exact plan before execution. One unfinished run is admitted per plan. Continue or cancel that run before selecting another period for that plan.

The browser server and named MCP automatically start their existing worker for an explicit start, resume or accepted review. A raw model caller calls startWorker. Opening a retained model by itself does not launch background captures.

### Pause, resume and cancel

Use the current full run revision:

~~~js
await model.dispatch('refresh.runs.pause', {
  id: run.id, expectedRevision: run.revision
});
~~~

The same input shape applies to **refresh.runs.resume** and **refresh.runs.cancel**. Re-read the run after any revision conflict. Each control intent is retained before it changes the linked original capture. Only the existing capture worker owns and aborts its network operation.

Pause retains the selected date interval and every native stage. Resume continues those same inputs. Cancelling a run preserves all completed source and native records. A cancelled capture is not converted into a new capture under the old run; cancel the run and start a new period instead.

A server stop drains the current serial operation and closes the existing native worker. On reopening, the run and its original requests remain available. Explicit Resume starts its continuation.

### Changed source schema

The workflow compares every original captured field’s name, declared type, label and format with the baseline capture. It retains the exact before/after differences. Matching old fields are copied into the original DRAFT edition, including the reviewed names, roles, units, scales, notes, null markers and supported query rules.

An added, removed or changed metadata field requires review. A newly ambiguous null/empty-string observation or an existing null-marker collision also opens the review path. Native source or storage failures retain a failed resumable stage, rather than being presented as a completed field review.

Open **Edition review** from the saved run. Inspect original source fields, edit the interpretation, save and build the edition. If a previous candidate is already READY and needs correction, create another native edition from this same exact capture, review/build it, and select that READY result for the run.

Accept the exact selected result:

~~~js
await model.dispatch('refresh.runs.review', {
  id: currentRun.id,
  expectedRevision: currentRun.revision,
  editionId: readyCandidate.id,
  expectedEditionSha256: readyCandidate.sha256,
  requestId: 'treasury-debt-period-20261012-reviewed'
});
await model.startWorker();
~~~

This accepts only a READY edition of the run’s exact complete capture. Compared published fields must retain compatible reviewed roles, source units, scale annotations and null markers. If the intended interpretation has changed, save an appropriate new plan instead of silently changing the basis of the existing comparison.

The original edition editor and native build remain the authority for field validation. Refresh does not fabricate a schema-acceptance record or overwrite an immutable READY edition.

## Complete report and handover

A completed run retains:

| Native result | Identity and use |
|---|---|
| Actual Treasury capture | Complete original response bytes, selected source revision, page observations and consistency records |
| READY candidate edition | Original CSV/JSONL, complete field/unit/key/null review and native dataset configuration |
| Exact comparison | Pinned baseline/candidate hashes, every matched/unmatched row and original exact-decimal measures |
| Comparison source export | The complete original comparison delivery and both source selections |
| Offline briefing | Original briefing.tar.gz, authored context, dated-measure CSV, complete row pages and source archive |
| Refresh handover | Frozen plan and completed run, field-rules guide, complete comparison source and offline report |

The run’s delivery.id selects an ordinary native export. Download **delivery.tar.gz** through the existing authenticated file route, CLI or bounded MCP reader. Its manifest lists every exact member. The handover contains:

- refresh-plan.json and refresh-run.json;
- FIELD_RULES.md;
- comparison-source.tar.gz;
- briefing.tar.gz, briefing.json, briefing.md and briefing-manifest.json;
- dated-measures.csv;
- the original native manifest.json and DELIVERY.md.

Extract briefing.tar.gz and open index.html for the usable offline report. All report row pages and full change detail are retained. The full comparison archive includes both original source captures and reviews.

For stock measures such as debt balances, each observation is a value on its stated date. The briefing preserves source units, scale annotations and the original comparison’s stated aggregation semantics. A sum of daily stock observations is not a period balance or a flow. Numeric values retain the original decimal strings; refresh does not rescale, round or synthesize source rows.

### Explicitly select the next baseline

After reviewing the complete handover:

~~~js
await model.dispatch('refresh.baseline.promote', {
  planId: currentPlan.id,
  expectedRevision: currentPlan.revision,
  runId: completedRun.id,
  expectedRunRevision: completedRun.revision,
  requestId: 'treasury-debt-baseline-20261012'
});
~~~

Promotion requires a COMPLETE run of the current exact plan revision. It saves a new plan version with that run’s exact READY candidate and its full reviewed source rules. The original plan, baseline and completed run remain immutable in their retained history.

If the plan was edited after the run started, the old run remains useful and fully downloadable. It does not replace the edited plan’s baseline. Select its READY candidate while creating the intended successor plan.

## CLI continuation

The existing CLI handles the same action payloads and follows the existing worker:

~~~sh
node fiscaldata/cli.mjs action --dir /private/treasury \
  --action refresh.plans.save --input refresh-plan.json

node fiscaldata/cli.mjs action --dir /private/treasury \
  --action refresh.runs.preview --input selected-period.json

node fiscaldata/cli.mjs action --dir /private/treasury \
  --action refresh.runs.start --input refresh-run.json --wait

node fiscaldata/cli.mjs action --dir /private/treasury \
  --action refresh.runs.resume --input current-run.json --wait

node fiscaldata/cli.mjs worker --dir /private/treasury --once
~~~

The selected-period input contains planId, expectedRevision, expectedPlanSha256 and asOf. The start input adds its stable requestId. The current-run control input contains id and expectedRevision.

--wait follows refresh start/resume/review as well as the original capture actions. It emits actual native stage changes and full resulting delivery identities. Exit 0 means the selected worker reached a stopping state without a failure; inspect the returned status for COMPLETE, PAUSED or CANCELLED. Exit 2 means the selected refresh requires schema review; its original capture and run remain retained. Exit 1 reports an actual failure.

--once processes the existing queued captures and refresh runs, then closes the original writer. It does not poll for future periods indefinitely. An external scheduler can call the same preview/start or resume API with retained request IDs; no hidden schedule is created by a plan.

Close the browser or named model before using a separate CLI writer against the same directory.

## Named Merchant MCP

Two tools compose the existing Fiscal adapter:

| Tool | Actions | Native mapping |
|---|---|---|
| merchant_fiscaldata_refresh_plan | list, get, save, promote | refresh.plans.*; promote maps to refresh.baseline.promote |
| merchant_fiscaldata_refresh_run | list, get, preview, start, pause, resume, cancel, review | refresh.runs.* |

Each takes workspace, action and payload. Payloads are the original JSON action inputs above. The adapter retains its established result/state envelope, operator action history, host-declared workspace and source identity. Read actions remain reads. Status sections refreshPlans and refreshRuns have complete pagination. Refresh handover and report files use the existing merchant_fiscaldata_file and its exact expectedSha256/readId continuation.

The typed/native client may call these original tools; the browser, CLI, MCP and embedding caller all use the same saved records.

## Checkpoint, move and resume

The original portable checkpoint now includes refresh-plans and refresh-runs alongside sources, captures, editions, comparisons and exports. The original source inventory and package hash cover them.

Receive into an empty private target through the existing receiveFiscalSourcePackage or CLI receive action. Unfinished capture and refresh work is paused; a schema-review phase remains REVIEW_REQUIRED. The receiver retains the original record under its restoration history, including all prior source/capture/build/report request identities.

Reopen the same received workspace, inspect the saved run, and explicitly Resume or accept its exact READY review. A saved in-flight report can reproduce its original bytes from the durable original export timestamp and request. A completed run and its baseline remain complete; receiving does not promote a candidate.

Each native stage is selected in the run before the corresponding original action is invoked. Capture/source/edition/comparison/export/briefing creation reuses its native retained request. The older edition-review API is reconciled only against its exact stored next-revision postimage; a later operator edit is preserved and returned for explicit review. Publication acknowledgements are reconciled by reading the exact already-written record before updating the original in-memory request index.

## Source and ownership

- refresh.mjs is the plan/run coordinator. It borrows the original model’s internal functions under its one writer.
- workspace-model.mjs registers its two record groups, original worker progression and complete native export handover.
- workspace-ui/refresh.js mounts inside the existing browser and uses the same authenticated action route.
- portable.mjs retains and pauses original refresh state during source receiving.
- managed.mjs includes the helper and browser module in the original selected/executed source fingerprint.
- The existing Fiscal CLI and Merchant MCP leaf/catalog expose the same documented actions.
- Capture, exact-decimal comparison, original dataset loading, report rendering, publisher release and buyer payment engines retain their established roles.

The independent original briefing receiving operation and existing installed Applications receiving keep their pinned source versions. This additive product is adopted through the normal next installed source selection.
