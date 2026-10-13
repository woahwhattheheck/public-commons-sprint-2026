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
3. Use **Refresh report**, which queues the original `experiment.summarize` action. The retained task ID allows the same receiving directory to resume.
4. Confirm the same saved bridge's baseline/alternative run pair is in the actual completed land-cover pairs. Compare native rows, pairs, selection, model families and pollutant list before and after report refresh.
5. Download the original HTML, CSV and JSON through their rendered file links; verify the bytes and digest against the original operator tickets.
6. Reload the browser, reopen the same experiment and compare its retained scientific selection/results again.

The output directory includes `receiving.json`, original inspection and before/after summary JSON, original downloaded reports, three screenshots, and optional video. The capability is redacted from retained diagnostics. Report generation timestamps and report-file digests can change on summary refresh; scientific results and case identities must remain equal.

The current preserved implementation was reviewed against the maintained r7 experiment controller/provider and Conservation v8 source. Actual native/browser execution is recorded by this receiving command in the host's output directory.
