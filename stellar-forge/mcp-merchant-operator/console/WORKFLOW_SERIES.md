# Recurring customer work

The merchant operator keeps a complete procedure for a returning customer: who receives it, what useful output they need, which original workflow performs it, and the source and period selected for each run.

Open **Workflows → Recurring customer work** in the existing merchant Console. The same work is available through `starforge merchant-workflow-series` and the typed `MerchantWorkflowSeriesClient`.

## Coordinate deliveries across customers

**Customer delivery agenda**, at the top of Recurring customer work, brings every
series in the selected profile into one due-date table. Select the due window,
search by customer, task or source, and choose a work status. The totals cover
every matching period; Previous and Next show its complete pages.

The agenda includes unfinished saved work overdue before the selected window.
Its **Today** date follows the browser's local date and can be selected explicitly.
Saved periods retain the customer and task from their original series edition.
Disabling new work keeps their existing progress visible. Calendar proposals use
the current enabled edition; a saved key, including a canceled key, already owns
that period. Manual series show their saved periods.

Choose **Open period** to continue the original work, or **Plan period** to select
a proposed period's source, purpose and complete inputs in the existing editor.
The original first-start and run controls perform execution.

**Export calendar** includes every matching period across all pages. It produces
private, all-day deadline events with the full task, period, source and original
identifiers. Proposed periods are tentative; cancellations retain canceled event
status. Event identities stay stable when a proposal becomes a saved period and
when a customer profile is received elsewhere. The file is a dated snapshot;
refresh the agenda and export again to obtain later progress. A calendar
application controls how it imports or updates an existing event.

The same operation is available through the installed client and terminal:

~~~sh
starforge merchant-workflow-series agenda \
  --url http://127.0.0.1:3211/operator/ --profile ORIGINAL_PROFILE_ID \
  --from 2026-10-12 --to 2026-11-11 --today 2026-10-12 \
  --status open --output /private/operator/customer-agenda.json

starforge merchant-workflow-series agenda-calendar \
  --url http://127.0.0.1:3211/operator/ --profile ORIGINAL_PROFILE_ID \
  --from 2026-10-12 --to 2026-11-11 --today 2026-10-12 \
  --output /private/operator/customer-deadlines.ics
~~~

Select the actual dates and profile. `agenda` returns `nextOffset`, complete
counts and the selected page. `agenda-calendar` exports the complete selection
regardless of its page offset. `--query`, `--status`, `--no-overdue` and
`--no-proposals` refine either operation; `--input` accepts the complete
`AgendaRequest` JSON instead. The typed client's `agenda` and `agendaCalendar`
methods use these same Console operations.

Calendar serialization follows [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545):
CRLF content lines, UTF-8 line folding, escaped text, stable UIDs and one-day
DATE events. Its transparent events represent delivery deadlines.

## Complete a customer period in the browser

1. Open the original merchant profile. Save the complete native procedure in **Workflows**, or install its original [workflow recipe](WORKFLOW_RECIPES.md). Include the existing native review, publication and customer-export steps that this customer actually needs.
2. In **Recurring customer work**, choose **New series**. Select that saved workflow and name the customer, task and useful output. The series retains the exact workflow revision and its complete default inputs.
3. Choose a manual, daily, weekly or monthly calendar. Save the series edition. A calendar suggests whole periods; each cycle starts when the operator chooses **Start original workflow**.
4. Select **New period or source edition**, or choose a proposed calendar period. Enter a stable key, full period, due date, actual source reference and reason this work is useful. Review the complete inputs, including customer-specific identifiers and versions.
5. Choose **Review complete cycle**. The review shows every original native request, explicit mappings, required results and operator pauses, together with the currently configured tool contracts. Resolve a changed contract in the original workflow and select its new saved edition.
6. Choose **Save reviewed cycle**, then **Review first start**. The saved cycle can be received on another host before this review. Start it against the currently bound original host when ready.
7. Choose **Open original run and customer receiving**. All original native results, recovery, pause and handover controls remain there. On a completed customer export, use **Prepare customer** and receive its complete files in **Customers**.
8. For the next period, select the next dates and actual source. The earlier period, its complete inputs and native results remain available in the series history.

The screen retains a full pending action before dispatch. After a lost response, **Continue original action** sends the same saved request. A changed customer period uses a separately reviewed key.

## Series editions and cycle keys

A series edition contains the customer, task, selected workflow revision, complete default input object, explicit cycle mappings, calendar and whether new work is enabled. Save another edition when the procedure or customer defaults change. Existing cycles keep their selected edition.

A cycle key identifies one original customer task within the series. Its cycle ID and native run ID are derived from that series and key. The same key, source and inputs reopen the original saved work. A request that reuses the key with a different source, period or input is rejected with the original conflict.

For a corrected or changed source, choose a new readable key such as `2026-10-source-2` and link its **Earlier cycle**. Retain the actual source reference in **Selected source edition or reference** and explain the useful change. Two cycles can cover the same dates when their customer tasks differ.

Turning off **Enable new work in this series** prevents preparation and first starts. Existing original runs remain accessible through their native controls. A planned cycle can be canceled with a retained reason until its original run is reserved. After reservation, use the original run's pause, recovery and handover controls.

## Carry complete period values into native inputs

A series can map its saved cycle values into the complete workflow inputs. The original workflow then maps those inputs into its saved native requests.

For example, a workflow whose declared inputs already contain `period` and `sourceEdition` can use:

```json
{
  "baseInputs": {
    "period": { "start": "", "end": "" },
    "sourceEdition": ""
  },
  "cycleBindings": [
    { "target": "/period/start", "pointer": "/period/start" },
    { "target": "/period/end", "pointer": "/period/end" },
    { "target": "/sourceEdition", "pointer": "/sourceEdition" }
  ]
}
```

Use the actual input names and structures selected by the original workflow. Bindings target existing containers; each target receives one complete value. Supported cycle values are `/id`, `/runId`, `/key`, `/label`, `/period/start`, `/period/end`, `/dueDate`, `/sourceEdition` and `/reason`.

The complete input object is limited to 16 MiB, and the complete review/action request to 32 MiB. A period's saved source note is a reference to the actual selected material; any native source bodies or manifests needed for execution belong in the original complete workflow inputs or native source records.

Calendar dates use `YYYY-MM-DD` and inclusive period endpoints. Daily and weekly intervals advance from the saved anchor date. Monthly intervals retain the anchor's day, clipping each boundary to that month's final day. A January 31 anchor therefore produces boundaries on February 28 and March 31 in a non-leap year. Calendar queries return full periods that overlap the requested window and include `nextFrom` for the next page.

## Use the same complete work from a terminal

The installed command is:

```sh
starforge merchant-workflow-series --help
```

For an existing source checkout, replace the installed prefix with:

```sh
node stellar-forge/mcp-merchant-operator/console/workflow-series-cli.mjs
```

Use the Console URL returned by the existing merchant host and its original access-token environment. The commands below use `http://127.0.0.1:3211/operator/` as an example. Keep private request and output files in your existing private operator directory.

Save the original series request in `series.json`. It contains a stable `requestId`, series `id`, original `profileId`, current `expectedRevision` (zero for a new series), customer/task, actual `workflowId` and `workflowRevision`, complete inputs, bindings, cadence and enabled state.

```sh
starforge merchant-workflow-series save \
  --url http://127.0.0.1:3211/operator/ \
  --input /private/operator/series.json \
  --output /private/operator/series-saved.json
```

Save the complete period request in `period.json`. Its fields are `seriesId`, `seriesRevision`, `key`, `label`, `period.start`, `period.end`, `dueDate`, `sourceEdition`, `reason`, optional `previousCycleId` and the complete `inputs` object. Omitting inputs selects that series edition's complete defaults.

```sh
starforge merchant-workflow-series prepare \
  --url http://127.0.0.1:3211/operator/ \
  --input /private/operator/period.json \
  --output /private/operator/period-review.json

starforge merchant-workflow-series plan \
  --url http://127.0.0.1:3211/operator/ \
  --input /private/operator/period-review.json \
  --output /private/operator/period-saved.json
```

Read the returned original `cycle.id` from the complete saved period. Select that ID for the current host review:

```sh
starforge merchant-workflow-series start-prepare \
  --url http://127.0.0.1:3211/operator/ \
  --id ORIGINAL_CYCLE_ID \
  --output /private/operator/period-start-review.json

starforge merchant-workflow-series start \
  --url http://127.0.0.1:3211/operator/ \
  --input /private/operator/period-start-review.json \
  --wait \
  --output /private/operator/period-started.json
```

Each preparation file contains the full review and frozen action. Use the same file when a response is lost. A complete preparation that becomes stale can be reopened in the browser or prepared again from its exact original cycle. New complete output filenames retain new returned state; an identical completed file reopens under its existing name.

The original run may pause at a native review, await recovery or finish. Inspect it with `run --id ORIGINAL_RUN_ID` or the browser. `resume`, `pause`, `resolve` and `handover` accept the original native control request with its displayed revision.

## Receive the complete customer elsewhere

Finish the original customer transfer in **Customers**. Capture the complete profile and every complete customer delivery local to this source Console:

```sh
starforge merchant-workflow-series capture \
  --url http://127.0.0.1:3211/operator/ \
  --profile ORIGINAL_PROFILE_ID \
  --directory /private/receiving/customer-october
```

Use repeated `--delivery ORIGINAL_DELIVERY_ID` options to select specific complete customer exports. The directory contains:

| Path | Complete contents |
| --- | --- |
| `profile.json` | Original profile, host bindings, saved native request revisions and returns, workflow definitions and runs, recipes, every series edition and saved cycle, cancellations, and customer metadata |
| `selection.json` | The retained original profile snapshot and exactly selected customer deliveries/files |
| `customers/DELIVERY_ID/files/…` | Every selected file with its original relative name, complete length and SHA-256 |
| `handover.json` | Completed handover selection and full file manifest |

The first profile snapshot remains fixed for that directory. Rerun `capture` after an interrupted download: completed original files reopen, and an unfinished file is received again from its original download endpoint. A later period or updated profile uses a new directory.

Copy the entire private directory to the receiving operator. Open the received customer files and import the original profile into their configured Console:

```sh
starforge merchant-workflow-series receive \
  --url http://127.0.0.1:4211/operator/ \
  --directory /private/receiving/customer-october

starforge merchant-workflow-series reopen \
  --directory /private/receiving/customer-october
```

`receive` imports through the existing complete-profile API. All saved cycles, earlier native returns and receiving ownership travel with it. The complete customer files remain available at the returned absolute paths for the original customer application, including offline use through `reopen`.

For a planned cycle, review and bind the imported profile to the receiving host, then choose **Review first start**. For a run that already began, use the original owner's explicit handover and retain the resulting complete profile before receiving it. That run continues under its existing run identity.

Customer transfers still in progress and completed transfers owned by another workspace remain in the full profile and are listed under `otherDeliveries`. Select their original receiving operation to obtain those files. The completed handover's file list names the exact customer files available in this directory.

## Typed integration

The installed distribution exports `./merchant/console/series` and `./merchant/console/series-handover`, including adjacent TypeScript declarations. From a source checkout:

```js
import {
  MerchantWorkflowSeriesClient,
  writeWorkflowSeriesFile
} from './stellar-forge/mcp-merchant-operator/console/workflow-series-client.mjs';

const client = new MerchantWorkflowSeriesClient({
  url: consoleUrl,
  tokenEnv: 'MCP_ACCESS_TOKEN',
  environment
});

try {
  const prepared = await client.prepareCycle(completePeriodRequest);
  await writeWorkflowSeriesFile('/private/operator/period-review.json', prepared);
  // Present prepared.review and later pass this same saved value to saveCycle.
  const saved = await client.saveCycle(prepared);
  const start = await client.prepareStart(saved.cycle.id);
  await writeWorkflowSeriesFile('/private/operator/period-start-review.json', start);
  // Present start.review; startCycle reopens an already-started original run.
  await client.startCycle(start);
  const progress = await client.waitCycle(saved.cycle.id, { timeoutMs: 120000 });
  console.log(progress.status);
} finally {
  client.close();
}
```

Use `list`, paged `series`, `calendar`, `cycle`, `capture` and `receive` to operate the same records. The client uses the existing Console transport, token handling, native execution owner and atomic receiving writer.

## Operate the complete native receiving journey

The maintained native receiver continues the original merchant and recipe operation into two recurring customer periods. It retains the same private operation directory, original installation, seven-call merchant run, eight-call recipe run, both Console workspaces and the complete earlier customer archives.

From the complete source, run:

```sh
node stellar-forge/mcp-merchant-operator/receiving/workflow-series-journey.mjs \
  --directory ORIGINAL_PRIVATE_OPERATION_DIRECTORY \
  --chromium ACTUAL_CHROMIUM_EXECUTABLE \
  --playwright-module ACTUAL_INSTALLED_PLAYWRIGHT_MODULE \
  --source-commit COMPLETE_SELECTED_SOURCE_COMMIT
```

The original programme completes first and reopens its completed outputs on a continuation. Recurring work then adds a complete second OpenAPI source edition, plans the first calendar period in the browser, recovers an accepted Start response under the original saved action, and commissions the next period through the typed client. Both periods use the installed original eight-step native workflow. Each produces and receives its complete six-file customer. The receiver captures the complete recurring profile and both customers, imports through the other original Console, and closes and reopens both workspaces with the same original run and customer identities.

Continue an interrupted attempt with the same directory. The full frozen requests and current progress are in `workflow-series-receiving-checkpoint.json`; completion is retained in `workflow-series-native-run.json`. Native customer archives, all individual customer files and the full profile stay alongside the original operation. Browser inspection images are transient and are recorded separately under `inspections`; mandatory `artifacts` contain the files needed for customer receiving and restoration. Older completed reports remain unchanged, and their exact named browser inspection images are optional when reopened.

### Restore the complete native workspace

Keep the full merchant configuration, release store and customer-export store, both Console directories, retained merchant inputs, all required customer/profile files and the complete native reports. The source receiver's archive includes these directories. Restore the archive at its recorded original receiving path, so the saved operation, profiles, workflow and customer identifiers remain the same.

The local `native-access-token` is an execution credential and is supplied separately from the customer archive. If it is absent after restoration, the native entry generates a fresh private local token and passes it through the real `startMerchantMcp` launcher as `MCP_ACCESS_TOKEN`. Saved calls and completed reports keep their original identities and bytes.

Running the same completed recurring entry opens both restored Consoles on fresh loopback ports. It reads the original 24 recipe/recurring calls and seven baseline calls, both completed periods, the original installation editions, all four complete customer archives and each of their six files, and the thirteen-file recurring handover. The reopened result is written separately to `workflow-series-reopened.json`; the completed programme reports are preserved. This receiving path does not need the earlier browser inspection images.

The original `run-series-native.py` source receiver also accepts `--restore-archive`. Select the complete packet that matches the archive manifest and the original paths recorded there:

```sh
python3 run-series-native.py --source-packet series-source-map.json \
  --restore-archive merchant-original-native-artifacts.tar.gz \
  --work-dir ORIGINAL_WORK_DIRECTORY --directory ORIGINAL_RECEIVING_DIRECTORY \
  --node ACTUAL_NODE --node-modules ACTUAL_INSTALLED_NODE_MODULES \
  --chromium ACTUAL_CHROMIUM_EXECUTABLE --playwright-module ACTUAL_PLAYWRIGHT_MODULE
```

The receiver keeps an existing workspace as a private backup, streams the exact archived files into the original receiving path, restores any original configured source inputs, and runs the completed entry through its actual launch and customer APIs. A fresh native completion follows this same archive extraction and reopen path before producing the customer delivery summary.

## Merchant agent tools

The configured Merchant provider operates the complete original recurring-work lifecycle, native run recovery, customer receiving, complete handover files and agenda calendar export. See [WORKFLOW_SERIES_AGENT.md](WORKFLOW_SERIES_AGENT.md) for connection configuration, the full operating flow and receiving instructions.


## Inspect the completed application before delivery

Before presenting the completed application or its reports as ready, open the exact outgoing version with the populated customer workspace, look at its rendered screens or real screenshots, and operate the important controls. Review the screenshare width and relevant narrow/mobile width, empty, loading and error states, downloads, exports and reopening. Fix unreadable, clipped, overflowing, unstyled or broken output in the same application. Capturing screenshots without viewing them, source review and HTTP responses do not replace this inspection.

Use plain industrial presentation: readable tables, clear hierarchy, consistent typography and spacing, restrained controls and useful labels. Keep the original workflows and computations. Continue through observed repairs and the existing receiving programme; use focused checks rather than a broad suite. Carry this requirement into delegated receiving work and any standalone application handoff. This implements the repository's owner-directed rendered-product inspection instruction, version 2026-10-13.1.
