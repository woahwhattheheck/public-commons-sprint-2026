# Saved native case console

Open **Parameter studies → saved study → Native case console** on an original case. The console works for cases created or executed through the original Gura command-line course and for cases supervised by the operator.

The first section reads the maintained native run journal and its actual execution lock. It shows the current phase, selected native model stages, retained source stages and available space on the run filesystem. A running workspace coordinator is shown separately from the selected case, so an old completed case does not imply that the remaining cohort has stopped.

## Original attempts and logs

The attempt table combines the two existing receipt families:

| Entrypoint | Retained original source |
| --- | --- |
| Operator worker | `runs/<run_id>/supervision/<execution_id>/` |
| Gura isolated case | `gura-receiving/native-case-processes/<run_id>/<attempt_id>/` |

Every request must select the same project and native run. Operator requests also retain the exact native selection and their original request digest. Gura receipts retain their original request-body hash when published by the current course. Historical request paths remain provenance when a Workspace is transferred; physical reads resolve inside the reopened Workspace.

Choose **Open attempt** to inspect that retained worker or command-line invocation. The original native model log spans all attempts of its native run. **Worker process**, **stdout** and **stderr** select the separate process logs that actually exist for the chosen entrypoint. Reads start at the last64KiB; **Read from start** reads the same original file from its beginning. Each request reads at most64KiB, and the browser keeps a limited visible tail while the full file remains retained.

**Follow latest attempt** returns to the newest original receipt. Attempt pages have25 rows; changing pages does not change the selected attempt. **Refresh saved status** controls polling. Closing the dialog, replacing it or changing Workspace prevents a stale response from updating another view.

The selected resource observation keeps its original observing process and timestamp. Operator heartbeats describe the owned worker. The isolated course's after-return observation comes from its supervisor and is labeled accordingly. Group memory event counts include other processes sharing the cgroup. Only the original interruption record identifies an observed signal or counter difference; this console does not infer a cause from a large memory value or lifetime counter.

## Continue the same saved work

**Resume remaining study cases** submits the existing `parameter-study.run` action with the original saved study ID. It remains unavailable while the selected run, its workspace batch coordinator, or the same study's operator task is active. The original engine verifies completed cases and resumes its unfinished work.

Where the retained worker's task exists in the current operator, **Open original operator task** opens that task and its existing calculation console, Stop and reconnect controls. This is the way to reconnect an already-owned worker. Original CLI operations continue through their maintained command and operation owner.

**Download case record** exports the selected run status, original case binding, current history page, selected request/receipts, resource observations and bounded displayed log. The complete source files remain in the original Workspace and its normal portable archive.

For Tim: open a case to see what the original calculation actually did, read its saved output, and continue the same study without rebuilding its scientific selection.

## Native receiving

Use the existing equipped GURA-NATIVE-01 Workspace and its retained partial study. The API calls the maintained `native_execution.inspect_execution` and `parameter_studies.native_case_context`; it performs no model execution or saved-state mutation.

From the product root, compile the changed Python sources with the equipped interpreter:
```python
from pathlib import Path
for name in ("model/parameter_case_status.py", "operator/parameter_study_api.py", "operator/server.py"):
    compile(Path(name).read_bytes(), name, "exec")
```

Open an actual retained isolated case, compare its request/return hash and stdout/stderr text to the same original files, select an earlier attempt, and reopen the same study. The original run IDs, case selections and all source/stage/output descriptors remain unchanged.
