# Recurring customer work through Merchant tools

The Merchant agent provider operates the existing Console's profiles, workflows,
recipes, recurring periods, native runs and customer receiving. It uses the same
saved requests, native results, revisions and recovery controls.

The source-owned `merchant-console` distribution contribution includes this
provider. Configure `workflowSeriesConnection` to advertise the
`merchant_workflow_series_*` tools.

## Connect an existing Console

Start the original authenticated Console with its existing configuration and
private Console directory:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /srv/merchant/merchant-mcp.json \
  --operator-console-dir /srv/merchant/console \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN
~~~

Read its displayed workspace ID. Create an owned private connection file, mode
0600, using that actual ID and the existing token environment variable:

~~~json
{
  "schema": "stellar-forge.workflow-series-connection.v1",
  "consoles": {
    "operations": {
      "label": "Customer operations",
      "workspaceId": "REPLACE_WITH_THE_ORIGINAL_WORKSPACE_ID",
      "url": "http://127.0.0.1:3211/operator/",
      "tokenEnv": "MCP_ACCESS_TOKEN"
    },
    "receiving": {
      "label": "Receiving workstation",
      "workspaceId": "REPLACE_WITH_THE_RECEIVING_WORKSPACE_ID",
      "urlEnv": "CUSTOMER_CONSOLE_URL",
      "tokenEnv": "CUSTOMER_CONSOLE_TOKEN",
      "incoming": {
        "customer_october": {
          "directory": "/srv/customer/received/october",
          "expectedContentSha256": "REPLACE_WITH_THE_COMPLETE_HANDOVER_SHA256"
        }
      }
    }
  }
}
~~~

Add `"workflowSeriesConnection":"./workflow-series-connection.json"` to the
complete existing Merchant configuration. Retain its schema, original sources,
release store, exports directory and other provider settings.

Each Console declares exactly one of `url`, `urlFile` or `urlEnv`. A URL file is
an owned private regular UTF-8 file containing the original Console URL. The
connection accepts `http://127.0.0.1:PORT/operator/`. Its token environment name
is required. The provider pins the selected URL and token for its lifetime and
checks the original workspace ID before each Console operation. Restart the
agent connection after intentionally changing an endpoint or token.

The Console and agent may use the same Merchant host. A separate Merchant agent
may also attach to an explicitly started Console. Starting the stdio Merchant
agent alone does not create a Console or its database.

Incoming handovers are host-declared directories containing the complete
`profile.json`, `selection.json`, `handover.json` and all customer members.
Their expected hash is the original handover document's `contentSha256`.

## Select the customer and original workflow

Use these full tool names with the selected `console` alias:

| Tool suffix | Operation |
| --- | --- |
| `connections` | List Console aliases, saved workspace IDs and named incoming handovers |
| `host` | Read the current host fingerprint and complete native tool composition |
| `profiles`, `profile` | Read all customer profiles or one complete customer record |
| `profile_save` | Create a stable profile `id` and `name`, or edit with its current `expectedRevision` |
| `profile_bind` | Bind with the current profile revision and reviewed host fingerprint; retain binding history |
| `tools`, `tool` | Read all native tool pages or one complete selected tool definition |
| `draft`, `draft_save` | Read or save a complete original native request used by a workflow step |
| `workflows`, `workflow` | Read original workflow definitions, runs and selected revisions |
| `workflow_save` | Save the complete original Console workflow request under `input` |
| `recipes`, `recipe_installation` | Read saved original recipe installations and their complete run inputs |
| `recipe_prepare`, `recipe_install` | Prepare an original recipe and install its complete unchanged preparation |
| `recipe_export` | Export the complete reusable original recipe |

Prefix each suffix with `merchant_workflow_series_`. For example,
`merchant_workflow_series_profile` takes `{"console":"operations","id":"customer-profile"}`.

Read the original profile and current host before binding or preparing new work.
`profile_bind` takes `id`, `expectedRevision`, `expectedHostFingerprint` and an
optional reviewed `expectedCompositionFingerprint`. Draft and workflow saves require a stable `input.id` so an interrupted reply can reopen the original request. A workflow retains its exact
saved revision and native tool bindings. Recipe installation takes the full
preparation returned by `recipe_prepare`, including the original recipe, review,
input selections and install request.

## Save the recurring task

Call `merchant_workflow_series_save` with the original save request under `input`:

| Field | Meaning |
| --- | --- |
| `requestId` | Stable identifier for this exact save request |
| `id`, `profileId` | Original series and customer profile |
| `expectedRevision` | Zero for a new series, otherwise its current saved revision |
| `name`, `customer`, `task` | Readable customer work |
| `workflowId`, `workflowRevision` | Exact original native workflow definition |
| `baseInputs` | Complete workflow input object |
| `cycleBindings` | Explicit period-to-input JSON Pointer mappings |
| `cadence` | Manual cadence, or day/week/month interval and anchor date |
| `enabled` | Whether the series accepts new periods |

Each cycle binding has a `target` input pointer and a `pointer` selecting an
original period value. Supported period pointers are `/id`, `/runId`, `/key`,
`/label`, `/period/start`, `/period/end`, `/dueDate`, `/sourceEdition` and `/reason`.
The Console resolves those bindings into the complete saved period inputs.

`merchant_workflow_series_list` lists the customer's series. `get` reads one
complete series edition and its period-history page. Follow `nextOffset` through
every returned page.

## Plan, execute and recover a period

`calendar` proposes dates for one saved series. `agenda` presents saved,
overdue and proposed work in the selected customer date window, including current
native run state. Follow the original pagination.

| Tool suffix | Input and result |
| --- | --- |
| `cycle_prepare` | Select series ID/revision, stable key, label, actual period dates, due date, source edition, reason, previous-period link and complete inputs. Returns a full sealed preparation. |
| `cycle_save` | Pass the complete unchanged preparation. Returns the original saved period. |
| `cycle_start_prepare` | Select the saved period ID. Returns its full first-start review or existing run. |
| `cycle_start` | Pass the complete unchanged first-start preparation. The Console dispatches and checkpoints its original native workflow. |
| `call_start` | Dispatch the stable original saved request through the Console, retaining its native call ID for recovery |
| `call_recovery` | Read original native inspection and recovery controls for the selected saved call |
| `cycle`, `run`, `call` | Read the complete saved period, run or original native call and return |
| `cycle_wait` | Wait for completion, pause or recovery, or return the current state at the selected interval |
| `run_pause`, `run_resume` | Control the original run using its displayed current revision |
| `run_resolve` | Select the original completed recovery call, step and retained operator note |
| `run_handover` | Select the destination workspace, host fingerprint, original handover ID and note |
| `cycle_cancel` | Cancel a period before its native run is reserved, retaining the request and reason |

Keep every returned preparation complete, including review, action, hashes and
original inputs. The Console rechecks the revision, current host, native tools
and inputs immediately before reserving the first run. Repeating an accepted
start opens the same original run.

When a run pauses for its original review, read the native call and review before
resuming. A transport error can carry `outcomeUnknown: true`. Reopen the same
period, run, call or import; use its saved state to continue. The provider
preserves the original error and does not retry a native mutation internally.

Once a run is reserved, its original pause and recovery controls govern that
work. Date proposals and calendar export do not start a run.

## Deliver all customer files

Call `customer_receive` with the complete original customer selection under `input`: its customer `profileId`, export `family`, optional `workspace`, original `exportId`, `expectedManifestSha256` and reviewed `expectedHostFingerprint`. The Console customer owner collects every original export file. For an OpenAPI maintenance/receiving run, `customer_receive_run` derives that selection from its completed export `runId`. Use `customer_wait` or the profile to read the same receiving record. `customer_pause` pauses that original transfer by its delivery `id`; reopening the same complete selection continues its retained file state.

Capture a named complete handover with `merchant_workflow_series_handover_capture`:

~~~json
{
  "console": "operations",
  "handoverId": "customer-october",
  "profileId": "customer-profile"
}
~~~

The original capture retains its first complete profile snapshot and every
selected completed local customer export. An explicit `deliveryIds` array selects
particular exports. Repeating a capture continues those original files. Select a
new handover ID for a later customer edition.

The result lists the original manifest and **every transferable file**:
`profile.json`, `selection.json`, `handover.json` and all customer members, each
with exact bytes and SHA256. The complete profile file includes every retained
workflow, run, call, period and host binding.

Call `handover_file` for each listed member with the original `console`,
`handoverId`, displayed `expectedContentSha256`, exact `file` path and its
`expectedSha256`. Supply a byte `offset` and `limit` up to 196,608 bytes.
Decode returned base64 data and continue with the same `readId` and hash until
`nextOffset` is null.

The existing retained-file reader checks the complete original bytes before its
first chunk and releases the descriptor at EOF. Use `handover_file_release` when
ending early. After expiration or restart, reopen the same original file at the
retained offset with its expected hash.

`handover_reopen` verifies the complete retained handover and every file. `handover_reopen`, `handover_file` and `handover_file_release` can select either a captured `handoverId` or a host-declared `incoming` alias. Incoming selections use their original directory and declared handover SHA256, so the receiving agent can read every customer byte through the same file tools.
Captures live under the private exports directory at
`workflow-series-handovers/<console>/<handoverId>/`.

Receive the complete handover on another declared Console using `handover_receive`:

~~~json
{
  "console": "receiving",
  "sourceConsole": "operations",
  "handoverId": "customer-october"
}
~~~

For a host-declared external directory, use
`{"console":"receiving","incoming":"customer_october"}`. The original importer
reconciles the entire profile and recurring history. Its manifest keeps the
complete customer files in the selected handover directory. Review the
destination host and bind the profile before preparing new native work.

`profile_export` and `profile_import` also support complete direct profile
exchange. Export returns the archive object, original response byte count and
SHA256. Use the customer handover when the delivery includes the exported files.

## Export the complete agenda calendar

`merchant_workflow_series_agenda_calendar` takes the same customer, date window
and filters as `agenda`. Its `content` is the complete iCalendar document and its
`filename` is the proposed calendar filename. It includes the full matching
selection across pages. Preserve its original calendar escaping and line endings
when saving the content.

## Original clients and lifecycle

Existing code can continue using the typed `MerchantWorkflowSeriesClient` from
`./merchant/console/series`. The provider is exported at
`./merchant/console/series-agent`. Both use the original Console API.

The source-owned provider declares provider concurrency because the started
Console workflow invokes its native tools through the same Merchant operator.
The original SQLite transactions, revisions, review digests and dispatcher
control these operations.

Provider shutdown aborts its own HTTP requests and polling waits, drains accepted
agent calls and closes retained file descriptors. The Console retains ownership
of accepted native work. Whole-host shutdown continues through the existing
Console and provider lifecycle owners.

Read [WORKFLOW_SERIES.md](WORKFLOW_SERIES.md) for the original series formats,
calendar rules and typed customer handover.

## Continue the complete native receiving customer

The distribution command `merchant-workflow-series-agent-receive` takes the
complete extracted output of the original two-period receiving programme. Run it
from the source checkout with its existing dependencies:

~~~sh
node stellar-forge/mcp-merchant-operator/receiving/workflow-series-agent-journey.mjs \
  --original-directory /srv/merchant/original-complete-native \
  --directory /srv/merchant/customer-agent-continuation \
  --source-commit THE_SELECTED_40_CHARACTER_SOURCE_COMMIT
~~~

The original directory must contain its complete reports, both saved Console
databases, native source inputs, release store, received customer files and
`series-customer-handover`. The command copies that complete saved customer into
the owned continuation directory before opening its archived receiving Console.
It retains the source workspace IDs, calls, native returns and two finished
periods.

The command calls the actual configured tools over Merchant MCP. It saves a
complete original request and an eight-step workflow that pauses after the first
native return, adds a new series edition with the existing complete inputs and
cadence, and prepares the next linked calendar period. It reads and retains that
first native call before resuming the same run through customer generation and
the owned merchant's stop.

The receiving Console imports the original handover, then receives the new
complete customer edition. Every original and new handover member is streamed
through the agent file tools into private files with its displayed byte count and
SHA256. Both native hosts close and reopen; the command checks the same saved
calls, periods and run before completing.

The continuation directory contains the complete reopened original customer,
the new receiving Console, the original and updated complete customer handovers,
the full agenda calendar, and one resumable native checkpoint. Repeating the same
command uses those saved request, period, run and receiving identities. A native
recovery condition remains attached to that exact run for its original recovery
controls.

The selected commit identifies the source base. The native checkpoint also retains
the complete nine-file agent and transport source selection with actual byte counts and hashes,
so locally prepared source and a later published edition remain distinguishable.

### Receive the original outbox and continue native recovery

The complete native receiver carries the original settlement outbox into its
private customer copy. It changes only the local source-directory fields in the
copied producer and binding records, retaining their complete previous bytes and
hashes in the receiving checkpoint. Every original outbox member remains present.
The original archive, customer identifiers and accepted release remain intact.

If an earlier start failed because that copied outbox still named its original
machine directory, continuation reads the original recovery controls, creates a
saved request with `recoveryOf` linked to the failed call, and dispatches the same
native start arguments. It resolves the original workflow step with that complete
returned call, then resumes the same run. The handover retains the failed attempt,
its linked recovery, all eight successful native steps and the original customer
history. Other native failures are returned with their original saved error.
