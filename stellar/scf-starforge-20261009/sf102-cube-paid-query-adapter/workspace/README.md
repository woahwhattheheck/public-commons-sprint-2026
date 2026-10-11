# Cube merchant browser workspace

Build a paid analytics API from the merchant's actual Cube member catalog. This
workspace gives the original [Cube onboarding workflow](../onboarding/README.md)
a browser interface for selecting members, authoring reports, reviewing complete
payment choices, saving versions and handing the result to a merchant or buyer.

## Open a workspace

From the repository root, use Node 22 or later and the original `/meta` response
saved from the merchant's Cube deployment:

```sh
node stellar/scf-starforge-20261009/sf102-cube-paid-query-adapter/workspace/server.mjs \
  --state /private/cube-browser \
  --metadata /private/cube-meta.json \
  --plan /private/merchant-plan.json
```

The optional `--plan` imports an existing original
`stellar-forge.cube-merchant-plan.v1` file. Omit it to start with an empty report
plan and enter the merchant's service, backend and payment terms in the browser.
Use `--port PORT` for a fixed loopback port; the default chooses an available one.
Open the complete URL printed by the command.

To obtain the original metadata file, use the existing onboarding
`capture-meta` command or an already saved Cube response. The metadata's member
names, kinds and time granularities feed the existing native compiler. The
browser searches that exact catalog; it retains the source bytes and excludes
members that the original inspector marks private.

Reopen the same workspace later:

```sh
node stellar/scf-starforge-20261009/sf102-cube-paid-query-adapter/workspace/server.mjs \
  --state /private/cube-browser
```

Its source snapshot, saved merchant versions, exported packages, backend results
and customer reviews survive the original source files being moved. An updated
Cube schema starts a new workspace with its new metadata. Supplying a different
`--metadata` to an existing workspace reports the mismatch.

## Compose reports

Enter the merchant's service name and public HTTPS origin, its fixed Cube API
origin and load path, and the **name** of the environment variable containing its
Cube authorization header. The same launch environment supplies that variable
when a saved report is probed. Backend time, concurrency, byte and row limits
remain original adapter settings.

Add a named report, then select actual measures, dimensions and segments from
the searchable member catalog. The editor keeps the fixed `/reports/REPORT-ID`
route used by the native adapter. Choose a time dimension with **Use for time**,
set its granularity, and use **Set time grouping** to apply it.

The query controls author the original document format:

| Control | Original query and input fields |
| --- | --- |
| Select a member | Fixed `measures`, `dimensions` or `segments` member list |
| Expose date window | First `timeDimensions` entry's start/end substitutions, two required date inputs and original `range` guard |
| Expose row offset | `offset: {"$param":"offset"}` and a bounded integer input |
| Add enum filter | One fixed filter member and `equals` operator, with one required public enum |
| Original report JSON | Complete supported query, inputs, ordering, range and report-specific terms |

Enter an exact example and description for every input. Dates are calendar
dates, enums retain exact strings, and integer examples are entered as whole
numbers. The original compiler checks that each input is used and that its
example renders correctly. The date guard's `maxDays` compares the difference
between the two dates; Cube includes both endpoint dates.

Set complete default payment choices for the service. Each keeps its original
network, token, recipient, atomic amount, timeout and optional `extra` fields in
order. A report can inherit those terms or define its own complete choices.
Amounts stay strings throughout editing, review and export.

**Import plan** and **Download plan** exchange the same native plan JSON used by
the existing CLI. Browser edits are retained in this tab's session storage.
Saving produces a durable native version; the header distinguishes local edits
from the selected saved version.

## Review and save

**Review plan** calls `compileCubeMerchantPlan` from the original onboarding
module. It shows each report's actual selected members, required inputs,
rendered Cube example, public request URL and every original payment option.
Member-kind, query-template, example, date-range and payment errors use that
same compiler's messages.

**Save version** calls the original `createCubeWorkspace`. Each successful save
creates a new private immutable version. Saved versions are paginated and can
be reopened in a new process or browser tab. A failed or interrupted save is
shown as unavailable if its native manifest is incomplete; existing versions
remain usable.

The working plan and selected saved version are separate. Backend reads,
exports and buyer preparation operate on a selected saved version. Save current
edits before taking its handoff through those actions.

## Produce the merchant and customer handoff

**Run backend read** calls the original `probeCubeReport` once for the selected
saved example using the configured environment authorization. It shows the
original status, row count, elapsed time and retained response. The preview
stops at 32 KiB; complete response and original receipt files can be downloaded.

**Export selected version** calls the original `exportCubePackage` and
`inspectCubePackage`. The UI displays the actual output directory, original
launch command, four public customer files, and the private merchant files.
The package keeps the original metadata and plan with its seller configuration,
catalog, OpenAPI and launch entry point. Existing destinations and versions are
preserved because each export uses a new generated directory.

Run the printed command to start the exported merchant with the original
seller and operations launchers. Add the merchant's existing facilitator URL
for the native payment runtime. The original seller controls admission,
verification, settlement, response release and graceful shutdown. Its developer
portal and the separate private operations listener keep their existing URLs.

The **Prepare customer operation** form selects one report, one original
payment option, concrete query strings and a stable intent ID. It calls the
original `prepareCubePackageBuyer`, retains the resulting review configuration,
and displays its native review command. Continue the existing SF88 buyer
workspace and execution flow with that same request.

## Application interface

```js
import { startCubeWorkbench } from './workspace/server.mjs';

const workspace = await startCubeWorkbench({
  directory: '/private/cube-browser',
  metadataPath: '/private/cube-meta.json', // First creation only.
  planPath: '/private/merchant-plan.json', // Optional on first creation.
  port: 0,
});

console.log(workspace.url);
// Later, close this private browser listener and wait for its active operation.
await workspace.close();
```

`openCubeWorkbench` in `model.mjs` exposes the same local application model:
`bootstrap`, `members`, `preview`, `save`, `listVersions`, `inspectVersion`,
`exportVersion`, `inspectExport`, `probe`, `buyer` and `download`. The mutable
browser document is a native merchant plan; durable versions, probes, packages
and buyer configurations are created and read by their original factories.

The private HTTP listener uses a per-process bearer token in the printed URL
fragment, exact Host checks and same-origin mutation requests. Credentials are
read only by the original backend handler in the server environment. File
downloads select a fixed workspace item and known filename; the browser API
accepts no arbitrary local file path. Keep this operator listener on loopback.

The six files in this directory are a consumer of `../onboarding/`. Distribute
both directories with the original SF102 and SF30 runtime. The original
onboarding factories retain query compilation, storage, backend transport,
package generation and buyer preparation ownership.
