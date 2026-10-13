# Regional opening in the original operating journey

For the current registered Guided journey, use [Regional saved views](REGIONAL_SAVED_VIEW.md) and `install_regional_saved_view.py`. The original `install_regional_journey.py` entrypoint delegates to that current installer automatically. The original direct-host composition remains available for earlier applications.

The regional opening joins retained watershed context, a saved biophysical profile, native model records and decision studies in the existing operator workspace. It adds a regional panel to the original Guided journey and opens the existing desks with the exact selected records.

## Install into the current application

First compose the current operator and its Guided journey, extension host and retained desks, Profile workbench, Decision studies, and Regional watersheds provider. Keep the original regional engine and source loader. This package adds two web files and applies exact named joins to six existing files.

Decode this packet into a separate source directory, then use the application's Python:

```sh
python /path/to/regional-source/operator/install_regional_journey.py \
  --application /path/to/current-application \
  --source-root /path/to/regional-source
```

The installer holds the original shared `.locks/extension-install.lock` while staging, parsing and replacing source. It stages every changed file before writing, parses Python, parses JavaScript with an existing Node executable when available, and preserves the current application around each exact opening hook. It records before/after hashes and backs up changed members beside the application. A repeated installation recognizes identical hooks. The exact previously published R1 regional members can be upgraded through declared preimages. A differing hook reports its path and name so the current receiver can reconcile that source without replacing the surrounding code.

The two added web assets are explicitly registered in the original server's static-file allowlist. The original module loader, capabilities, queue, workspace registry and file-ticket downloads remain authoritative. Restart the original operator after installing the composed source.

## Open the prepared regional workspace

Use the original regional bootstrap, `source_tools/open_regional_workflow.py`, to prepare or reopen the same native Workspace. Its `regional-workflow-opening.json` records the original project, saved watershed report, exact saved HUC selection, scientific profile and optional native experiment or completed runs. Use the bootstrap's own `--help` for its current source/data arguments.

1. Open the private operator URL printed by the original server. Select the intended workspace using its existing workspace control.
2. Open **Guided journey**. In **Regional starting point**, choose `regional-workflow-opening.json` with **Open a prepared regional workflow**. The same import is available in the original reopen step.
3. The journey opens its inputs step. It selects the saved profile and regional HUC context from the receipt, then resolves their original retained records. For the prepared Lower Tugaloo opening, the saved membership is HUC12 `030601020507`.
4. Use **Open exact saved selection** to open the original Regional watersheds desk. It receives the saved export ID, validates the underlying report and opens the same HUC membership. Its normal context filters, individual watershed inspector, source records and retained downloads remain available.
5. Return through the original journey rail. Use **Open selected profile workbench** to inspect the named scientific profile, its source edition, native coefficient table, working revisions and recorded reviews.
6. Select a complete retained model grid when one is available. The journey displays its actual reporting-boundary source, hydrologic-domain source, coordinate system and cell resolution. Its existing native grid inspector and Spatial review remain available from the same panel.

Opening import checks the native project identity. Operator workspace registration keys can change after portable restore, so the current registered workspace is used for reads while the unchanged native project ID binds the receipt. The profile table's exact SHA-256 and source references are checked when present. The saved watershed export is opened through its original API; report SHA-256, source fingerprint, HUC membership and the full report/export relationship must match. Optional source IDs must resolve to the source edition used by that report.

The regional HUC selection is retained context. The selected native model grid supplies the actual calculation and reporting geography. Both are displayed separately so the saved HUC choice remains traceable alongside the original grid.

## Continue through native calculation and decisions

The original journey still owns baseline, grid, profile, scenario, run, comparison, map, delivery and portable backup selections. Existing forms create or revise those native records through the original queue. The original inputs step now prefers the journey's selected profile and grid, with the baseline as a fallback, so pre-run profile inspection and later scientific revisions show their actual source editions.

A receipt may contain a completed baseline and alternative plus their original input-selection objects. The import resolves both runs and compares those unchanged input selections. It retains the receipt's selected profile. If that profile differs from the supplied run's profile, the original grid and scenario are retained while the active run selection is left ready for a new native calculation with the chosen profile. The original baseline remains available for later comparison.

On **Choose a prepared study** or **Compare completed runs**, the new **Retained comparisons and decisions** section offers:

- **Native scenario experiment:** selects an actual saved experiment and displays its original baseline run, grid, requested alternatives and native models.
- **Open original experiment:** invokes the existing Experiments controller and its retained experiment view.
- **Configure decision from this experiment:** opens Decision studies after that desk has mounted, then asks its original provider for the selected experiment's editable decision configuration. An existing unsaved preparation draft for the same experiment is restored.
- **Saved decision study:** records the actual study ID and selected native revision. **Open saved decision revision** opens that immutable revision and its original run history.

The original experiment plan supplies scenario and profile identities, including pending planned cases. The retained summary supplies actual metric units and paired outcomes. Enter costs, capacity, metric scales and weights in Decision studies; save through the original receiver so it binds the native cells and their source trace. If a required native pair is not complete, use the original experiment view and queue to finish it.

The existing profile and decision browser journeys cover editing, native calculation, export and receive workflows. This opening layer joins those original tools and preserves their browser drafts on desk transitions.

## Reopen and portable transfer

Export **Journey selections** and **Operating notes** from the original journey. Both include the saved regional context and selected experiment/decision identities. The selection JSON uses the original `upstate.operating-journey/v1` envelope with a `regional` member of schema `upstate.regional-journey/v1`.

After reopening the workspace or restoring its complete original archive, import that journey JSON. The operator resolves the native selections, saved watershed report/export and exact decision revision again. Original archive verification remains responsible for retained model, source and export files.

The opening receipt uses schema `upstate.regional-workflow-opening/v1`. Supported fields are:

| Field | Original record checked |
| --- | --- |
| workspace_id | Native workspace project ID |
| operator_workspace_key | Launcher hint for the existing workspace picker |
| watershed_report_id / watershed_report_sha256 | Full retained regional report and its bytes |
| watershed_export_id / selected_huc12s | Exact saved watershed selection and membership |
| source_fingerprint | Original regional source-file edition |
| source_collection_id / source_id | Optional imported regional source IDs, checked together |
| profile_id | Saved native scientific profile |
| profile_source_collection_id / biophysical_source_id | Profile's actual source references |
| profile_table_sha256 | Profile's original coefficient-table bytes |
| baseline_run_id / alternative_run_id | Optional original native runs |
| baseline_run_selection / alternative_run_selection | Optional unchanged input selections of those runs |
| baseline_grid_id / alternative_grid_id | Optional explicit grid identity cross-checks |
| experiment_id | Optional saved native experiment |
| decision_study_id / decision_revision | Optional exact saved decision revision |

An experiment summary hash in the launcher receipt records the state observed at opening. Experiment progress can legitimately advance; this layer opens the same native experiment ID and displays its current retained state.

## Operate the native browser opening

The accompanying script uses an existing Playwright/Chromium installation and the private URL printed by the original operator:

```sh
node source/run_regional_workflow_browser.mjs \
  --url-file /private/operator-url.txt \
  --opening /path/to/workspace/regional-workflow-opening.json \
  --workspace CURRENT_OPERATOR_WORKSPACE_KEY \
  --output /path/to/regional-browser-run \
  --video
```

The explicit workspace flag is useful after restore; otherwise the driver resolves the receipt's native project among the original workspace choices. It operates the visible receipt import, exact watershed selection, Profile workbench, optional retained native experiment and Decision studies, then downloads the original journey selections and operating notes. It reloads the operator, reimports those exported selections and compares the same native/context identities. When an experiment is supplied, it also edits an unsaved decision-preparation title and confirms that the draft survives a journey roundtrip.

The driver writes screenshots, optional video, downloaded original selections/notes, and `journey.json` with actual native record identities and step results. The private operator URL and capability are redacted from journal errors and terminal output. Model and decision calculations continue through the existing native experiment and decision browser workflows.

## Composition API

`attachOperatingJourney(host)` now exposes `selectOpening(receipt)`. The normal operator UI invokes this through its existing file import.

`createExtensionHost(host)` exposes `openDesk(extensionId, method, ...args)`. It captures the selected workspace, navigates to the registered view, waits for the original factory and asynchronous mount, then checks that the same view and workspace are still active before invoking the named opening method.

| Registered view | Opening method |
| --- | --- |
| watershed-context | openSelection(exportId) |
| profile-workbench | open(profileId) |
| robust-workbench | open(studyId, revision) or prepare(experimentId) |
| experiments | Existing experiment-show dispatch through the native Experiments controller |

Original `openExtension` behavior remains available for capabilities that do not require a mounted view. The integration declaration records every named source join. The model calculations, regional classifications and solver algorithms retain their existing implementations.

## Source lineage

This composition reads the current operator/Guided journey from F0C9JNCF2JC, the retained desk host from F0C8J5C2DC3, saved-selection Regional watersheds from F0C8J7BMGUB, the existing Profile workbench, and the final Decision studies UI in F0C8QM4TW5Q. The regional bootstrap is F0C9K8UE8V6. The underlying regional engine/data and loader are F0C8JV7PJUV and F0C8QA3KZ42. The named joins preserve these native implementations.
