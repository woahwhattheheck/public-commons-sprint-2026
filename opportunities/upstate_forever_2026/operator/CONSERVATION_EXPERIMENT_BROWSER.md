# Conservation: reopen a completed native experiment

This receiving continuation uses the original Upper Savannah operator, a completed Conservation browser receiving result, and a native experiment already attached to a saved scenario in the same study. It retains the experiment's native plan IDs separately from the browser's manual two-unit plan.

## Run on the existing receiving host

Use the local startup receipt already emitted by the original operator. Keep its authenticated URL and capability local. Supply the completed `receiving.json` from `operator/conservation_browser_receiving.py`, then the actual experiment ID retained under that study's saved scenario.

```sh
/opt/pyvenv/bin/python operator/conservation_experiment_browser_receiving.py \
  --operator-receipt /absolute/path/to/operator-startup.json \
  --conservation-receiving /absolute/path/to/conservation-browser/receiving.json \
  --experiment-id ACTUAL_RETAINED_EXPERIMENT_ID \
  --output /absolute/path/to/conservation-experiment-browser \
  --chromium /usr/bin/chromium \
  --record-video
```

The Python environment needs the original application's existing Playwright installation and Chromium. The supplied native experiment must be complete. Its existing Run programmes operation continues scientific execution when needed; resume this same receiving directory after it completes.

## What the continuation drives

1. Open the same study in Conservation plans and follow its existing native experiment control.
2. Open the maintained experiment desk and retain the complete original inspection.
3. Use **Refresh report**, which queues the original `experiment.summarize` action. Save the exact request and operation identity before its response, then retain the accepted task ID. The same directory recovers that original operation if a response is lost and resumes its interrupted summary task once.
4. Confirm the same saved bridge's baseline/alternative run pair is in the actual completed land-cover pairs. Compare native rows, pairs, selection, model families and pollutant list before and after report refresh.
5. Download the original HTML, CSV and JSON through their rendered file links; verify the bytes and digest against the original operator tickets.
6. Reload the browser, reopen the same experiment through its original Conservation study and saved-scenario control, and compare the retained scientific selection/results again. This route continues to work when the experiment is on another catalogue page.

The output directory includes `receiving.json`, original inspection and before/after summary JSON, original downloaded reports, three screenshots, and optional video. The capability is redacted from retained diagnostics. Report generation timestamps and report-file digests can change on summary refresh; scientific results and case identities must remain equal.

## Resume the same receiving operation

Run the same command with the same output directory after a process or connection interruption. The first pre-refresh scientific summary is saved and its file identity is recorded before any report action. A retry verifies and reopens that same snapshot, preserving the original comparison even when the previous summary task already completed. `receiving.json` retains `summary_operation`, the original action body and `operation_id`, before the browser receives its queue response. If the accepted task ID is missing, the command sends that exact retained request to the original idempotent action endpoint and continues its returned task. Once a task ID is known, polling verifies its Workspace, action and selected experiment; an interrupted task uses the existing task-resume endpoint once. The original summary action refreshes the saved reports without starting the native model cases.

Every opening follows the same study's retained scenario and original experiment ID. It therefore does not depend on an experiment remaining in the current page of the separate experiment catalogue. The three screenshots, original report downloads and reopened result records are retained in the host's output directory.
