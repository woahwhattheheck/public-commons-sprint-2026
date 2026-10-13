# Saved run programme case console

Open **Run programmes → Saved programmes → Open → Native case console** on an original case row. The console opens the retained native calculation even when it was started from the command line and has no operator task.

For Tim: open a programme case to see its original process, saved error and log, then continue the same programme’s unfinished work.

## What the page shows

The heading retains the exact saved programme case key and title. The programme state and completed-case count come from the maintained programme manager. A saved `running` state with no active programme lock is shown as `interrupted`; a native run and the programme’s own output-verification attempt remain separate records.

The original native run shows its current lock, phase, retained model stages, source run for any reused stage, storage observation and native execution history. The programme receipt also retains its current phase, selected run, original requested subset, selected-case coordinator attempts and comparison errors. A programme can fail while its native model is complete, for example during verification or comparison; the console retains both outcomes.

**Original process attempts** uses the same reader as the Parameter studies console. It reads both supervised operator workers and the original isolated Gura CLI receipts. Select an older attempt to inspect its actual return code, request hash and available process logs. **Follow latest attempt** returns to the newest usable retained receipt.

**Read from start** begins at byte zero of the selected log. Each read is limited to 64 KiB; subsequent refreshes continue from the returned offset. Rewinding or changing history pages cancels the prior read, so a delayed response cannot overwrite the newly selected position. Changing the workspace or closing the detail view stops its polling.

Saved memory and group counters retain the original observing process and time. A supervisor’s observation after a child exits remains labelled as the supervisor’s observation. Shared-group event totals do not attribute the event to a particular child.

## Continue the original programme

**Continue unfinished programme runs** submits the existing `compute.programme.run` action with the saved `programme_id`. It uses the original programme view’s task identity, failed-task resume and native worker path. The control becomes available after the native run, workspace batch lease, original programme and matching operator task are inactive.

This action continues the saved programme’s unfinished work. To run a selected subset, return to the programme’s existing case checkboxes and **Run selected cases**. Neither path changes the saved parameter profiles, land cover, model-family selection or completed native outputs.

An active programme can be creating comparisons or reports even when the selected native run has finished. In that case the console shows the programme’s actual phase and keeps continuation disabled. **Open original operator task** appears when that selected attempt’s actual task is present in the current operator. **Open native run** opens the maintained native run view.

**Download case record** saves the current read: exact programme and native bindings, the visible attempt-history page, selected receipts, current log chunk and continuation action. It is a point-in-time observation; the full retained workspace continues to hold all attempts and logs.

## API and original bindings

`GET /api/programmes/execution` accepts the existing workspace key plus:

| Field | Meaning |
| --- | --- |
| `programme_id` | Exact saved programme identity |
| `run_id` | A native run bound into that original programme |
| `attempt_id` | Optional original `worker:` or `isolated:` receipt ID |
| `stream` | `native`, or a stream retained by the selected attempt |
| `log_offset` | Optional nonnegative byte offset |
| `expected_attempt_id` | Previous selected receipt, used to reset offsets safely |
| `history_offset` | Nonnegative attempt-page offset |
| `limit` | Attempt-page size, up to 100; default 25 |

`model.programme_case_status.read(workspace, programme_id, run_id, **options)` validates the original programme schema, workspace, selection digest and every matching case’s exact `native_selection`. The response includes `upstate.programme-case-console/v1`, a compact current programme snapshot, all original case aliases for the selected run and the common native receipt/log response.

The same `model.parameter_case_status.read_run` implementation serves both programme and Parameter studies callers. The original Parameter studies `read` and browser `attachParameterCaseConsole` interfaces remain compatible. The shared browser controller’s programme mode changes only its bound endpoint, identity field, displayed owner state and existing continuation action.

## Receiving an existing original programme

From the current application root and its equipped Python, inspect a programme/run already present in the receiving workspace:

```python
from model.workspace import Workspace
from model.programme_case_status import read

workspace = Workspace("ACTUAL_RETAINED_WORKSPACE")
value = read(workspace, "ACTUAL_PROGRAMME_ID", "ACTUAL_NATIVE_RUN_ID")
print(value["programme_state"], value["programme_active"])
print(value["native"]["state"], value["history"]["total"])
print(value["log"]["path"], value["log"]["offset"], value["log"]["next_offset"])
```

Use the original receiving IDs. Open that same programme in the browser, select its case, and compare the selected receipt’s request hash, actual return code and log path with the saved files. Existing GURA-NATIVE-01 remains the receiving operation for its original native cases.
