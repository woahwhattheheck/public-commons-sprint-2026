# Receive and reopen the Communities workspace

The receiving command carries the existing community source, table, intervention plan, immutable revision and complete report through a workspace backup and a new operator process. It uses the application's ordinary browser forms, task queue and file downloads.

It can start from an empty workspace or continue the same saved operation. The included workflow uses the retained seventeen-row RFP Table 1 edition. Its two proposed interventions retain their source communities, explicit work descriptions and unset costs. Scientific model results can be attached through the optional context selection.

## Required application and runtime

Use a complete checkout of the application that includes this guide, `operator/community_receiving.py`, `operator/community_receiving.mjs`, and the registered source manifest at `source/communities-rfp-20261012/source-manifest.json`. Use its existing Python environment, Node runtime, Playwright package and Chromium executable.

The current operator sends `Connection: close` with its JSON, static-file and download responses. The receiving command packages this actual server source and compares it with the restored application before reopening. This avoids carrying an older server into a new receiving attempt.

Choose the complete commit of the application being received as `APPLICATION_REVISION`. Keep that value stable when continuing the same edition. A newer application commit receives a separate backup and restored copy while retaining earlier archives.

## Complete receiving command

Set the variables to the existing application, runtime and private operation directories, then run:

~~~bash
"$GIS_PYTHON" -B "$APPLICATION/operator/community_receiving.py" \
  --output "$RECEIVING_OUTPUT" \
  --workspace "$COMMUNITY_WORKSPACE" \
  --source-revision "$APPLICATION_REVISION" \
  --node "$NODE" \
  --node-modules "$NODE_MODULES" \
  --chromium "$CHROMIUM"
~~~

`NODE_MODULES` must contain `playwright/index.mjs`. `CHROMIUM` and `NODE` select the installed executables. The Python command passes its own interpreter to the original archive and CLI receiving steps.

Use the same `RECEIVING_OUTPUT` and `COMMUNITY_WORKSPACE` to continue an existing operation. The driver checks the project's retained identity before proceeding. Keep the output directory private: it contains the operation history, saved browser state, original records and screenshots.

If an existing scientific context should accompany the plan, add `--context "$CONTEXT_JSON"`. That file may select `source_collection_ids`, `grid_id`, `baseline_run_id`, `scenario_run_ids` and `delivery_id`. The ordinary native form validates these exact source and completed-result selections.

The default browser observation interval is 1,800 seconds. Use `--browser-timeout-seconds` to choose a different positive interval for the same retained operation. After correcting the concrete cause of a failed task, `--resume-failed-tasks` permits that original task to resume.

## What the command carries through

1. Open the actual local operator and retain the registered source preview and import.
2. Import the complete community table, compare the utility and geographic selections, and retain the chosen source edition.
3. Save a complete intervention plan, create its immutable technical revision, and build the original editable report.
4. Receive all twelve report members, including the HTML preview, original table, editable CSVs, Markdown, JSON and complete report ZIP.
5. Create a scientific-workspace backup, restore it into a new directory, and read the original source, plans and report through the restored workspace.
6. Stop the first operator, open the delivered application in a new process, read the same project through its CLI, and reopen its browser, report preview and downloads.

The source/plan/report stages retain their original task and request identities. The operation checks original source hashes, the seventeen unique geographic rows, the two utility summaries, plan revision lineage and exact downloaded ZIP members.

## Continue an application edition

For a new `APPLICATION_REVISION`, the browser records distinct backup and restore stages under that revision and writes the archive beneath:

~~~text
browser/application-editions/APPLICATION_REVISION/complete-community-workspace.zip
~~~

It retains the preceding archive as a prior delivery edition. Existing community source, table, plan and report stages are reused; the updated application is packaged into its own archive.

After the same application edition completes the first restore segment, a later invocation can continue directly with the delivered application's CLI and reopened browser. The driver verifies the received archive, source identities and delivered application files before doing so.

The received application and workspace paths come from the original restore result. They are never inferred from a different operation or silently replaced by another checkout.

## Retained results and diagnosis

The operation writes `community-receiving-result.json` in `RECEIVING_OUTPUT`. Browser progress and results remain in `browser/community-browser-progress.json` and `browser/community-browser-result.json`.

Each attempt has a separate `attempt-NNN` directory containing the browser stdout/stderr, delivered CLI output and `delivered-server.stderr`. These files locate a transport or process failure at the actual receiving stage. The browser records failures with the operator capability redacted.

A failed attempt preserves its task identities, downloads, workspace and earlier delivery editions. Continue with the same operation directories after resolving its recorded cause.

## Use an already running operator

The same browser continuation is callable directly when the operation owner already has the actual server running:

~~~bash
"$NODE" "$APPLICATION/operator/community_receiving.mjs" \
  --control "$PRIVATE_CONTROL_JSON" \
  --source-revision "$APPLICATION_REVISION" \
  --mode operate
~~~

The private control JSON supplies `operator_url`, `workspace_key`, `output`, `node_modules`, `chromium` and `python`. The URL must contain that server's current capability fragment. The Python driver creates and removes its own temporary control file.

To reopen an already received workspace, use the received application's browser program, the new server's actual control values, the same browser output directory, and `--mode reopen`. The original spelling `--mode reopened` remains supported.

`operator/COMMUNITY_OPERATOR_JOIN.md` describes the host integration and the underlying community source, item and task contracts.
