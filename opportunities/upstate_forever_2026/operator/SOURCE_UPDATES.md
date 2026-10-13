# Source updates in the Upper Savannah scientific workbench

The source-update workspace compares two retained source editions, identifies the original profiles, scenarios, grids and runs that depend on them, and prepares replacement cases through the existing scientific application. It also measures observed land-cover transitions between two retained Annual NLCD rasters and imports reusable change layers into the study.

Open the running scientific workbench through its current startup URL. Choose **Source updates** in the navigation. The page uses the workbench's selected workspace and capability, and submits long operations to the same durable operator queue.

## Import and compare source editions

1. In **Original sources**, import the original manifest and files for the replacement edition. Keep a complete manifest for the model case you intend to update. Source IDs should remain stable across editions when the source serves the same purpose.
2. Open **Source updates**. Select the earlier and replacement source editions.
3. Review the source mapping. Identical source IDs are selected automatically. Select an explicit replacement when an ID has changed. The comparison never substitutes a source merely because its role or title looks similar.
4. Select **Compare editions**. Inspect the changed inputs and the affected profiles, scenarios, grids and runs.
5. Resolve a missing replacement or incompatible source kind in the original manifest or the mapping, and compare again. Give the update a useful title and select **Save update plan**.

The saved plan includes the source choices and dependency snapshots. Source contents, companion files, physical interpretation metadata and citation metadata are compared separately. A new citation date is visible in the plan; actual changed model inputs determine which dependent cases require native computation.

The plan uses the complete dependency graph of the selected source edition. A changed raster can affect downstream transport across the contributing domain. Native NDR and SDR cases therefore use the original complete grid and model-domain preparation pathway.

## Prepare and run the refreshed study

Choose the saved plan in **Continue a saved update**.

- **Prepare refreshed cases** recreates the dependent profiles, scenario masks, grids and prepared runs with replacement source identities. The earlier source edition and its cases remain available for comparison.
- **Prepare and run models** continues the saved update through the original native engine and prepares compatible completed-run comparisons.
- **Download selected plan** saves the edition assessment and retained execution state as JSON.

The operation checkpoints replacement identities after each dependent item. **Progress and recovery** shows queue state, request details, results and errors. After an interrupted or failed operation, correct the affected source or runtime condition and use **Resume this operation**. A saved plan can also be continued from its current checkpoints.

Compatible completed cases produce alternative-minus-baseline change maps on their shared valid coverage. The retained comparison includes the area and annual mass excluded where only one edition has valid output. Changes to the actual spatial grid or study geometry appear with an explanation in the comparison row.

Model execution uses the scientific application's installed NDR/SDR runtime. Input preparation uses the retained source files and the original grid specification. The application source includes the precise required native runtime version and scientific parameter profiles.

## Measure land-cover change

1. Choose the earlier and later retained classified land-cover rasters.
2. Enter their actual product years if the source entries do not already identify them. A manifest capture date is not a raster observation year.
3. Leave the class filters empty to include all supported classes, or enter the original class codes for the transitions of interest. For example, an earlier forest class and a later developed class select observed forest-to-developed transitions in those input products.
4. Select polygon zones and the original zone identity field when per-zone areas are needed.
5. Select **Create change layers**.

The default requires the same projected metre grid in both rasters. When the original rasters differ in grid alignment, explicitly choose nearest-neighbor alignment of the later raster to the earlier grid. The result records that decision. Cell areas are calculated from the actual affine transform and reported in hectares.

The output includes a full class-transition table, valid and missing coverage accounting, a transition raster, a selected-change raster, a summary and its source manifest. With polygon creation selected, the chosen changed cells also become a vector scenario mask. When no selected changes exist, the operation retains its raster and table outputs and reports that a polygon mask is unavailable. Optional zone tables use actual polygon geometry. Read the generated summary for the precise area and overlap conventions used.

Outputs are imported into **Original sources** with their original input identities and content hashes. Select **Open change layers** to download their files. The polygon mask can then be selected by the application's existing scenario editor. A mask identifies where to apply a scenario; it does not choose the replacement land-cover class or scenario parameter values for the operator.

See [the land-cover method](../source/landcover-change/METHOD.md) for exact categorical values, input rules, area handling and output interpretation.

## Installation into an existing application

Retain the source-update bundle beside the current application and run:

`python3 -B install_source_refresh.py --application /absolute/path/to/upper-savannah-application`

The installer copies the feature modules, web assets, method documentation and a reusable installer into the current application. It adds the action and route integration before the existing operator startup and adds the Source updates navigation entry. Current server and page changes from other features are preserved. The installer records installed file identities and writes an installation intent before replacing files, so an interrupted update can resume. Earlier published versions are recognized by their exact delivered file hashes. Changed file preimages remain under `source/source-refresh-install/preimages`; completed state is `source/source-refresh-install/current.json`. Independently edited feature files are identified by path for composition with the received source.

Start or restart the original operator with its normal workspace arguments. Open its current startup URL and choose **Source updates**. Its direct page is `/web/source-refresh.html`.

In the current cumulative application, the installer uses the authored ECSA extension registry. `operator/extensions/source-updates.json` declares the exact task, route, state and browser bindings. Source updates opens inside the existing navigation, follows the current workspace and receives the host's state refreshes. Its stylesheet and element IDs are scoped to its own panel. Form choices are retained per workspace. The standalone page uses the same controller and original authenticated APIs.

The default `--integration auto` selects the registered host when its actual server join is present. It removes this feature's exact earlier launcher and navigation tag while retaining the other desk joins. `--integration registry` requires that host; `--integration standalone` supports the original application. If a later host installation encounters the retained legacy launcher, the provider defers to the registry so its actions have one owner.

The installer is designed for the recovered original application entrypoint and the later cumulative operator entrypoint. Apply it to the receiver's complete current source tree so the other scientific, GIS, community and review features are available together.

The feature uses these original application interfaces:

| Interface | Purpose |
| --- | --- |
| Workspace.sources, source_file | Read retained editions and original source files |
| save_profile, save_scenario | Recreate source-bound scientific selections |
| prepare_grid, prepare_run, run, compare_runs | Continue through original native model operations |
| _save, _get, _list | Retain immutable update plans and change-layer records |
| Operator action queue | Queue, continue, observe and recover long operations |
| Existing authenticated file downloads | Receive retained land-cover outputs |

New operator actions are `source.refresh.plan`, `source.refresh.apply` and `source.refresh.landcover`. The page reads `/api/source-refresh` and `/api/source-refresh/plan`; edition preview uses `/api/source-refresh/preview`. Authentication, host validation, source retention and task identity follow the original operator.

## Receiving and exercising the complete feature

Use a real retained study containing an earlier source collection, its source-bound cases and a replacement collection. In the running operator, compare editions, inspect the affected case identities, save the update, prepare its replacement cases, continue a native run, and inspect the resulting comparison. Reopen the workspace and confirm the saved plan and replacement identities are still available.

For the land-cover path, select the actual two-year classified rasters for the study, compute the changes, open the retained output layers, and use the polygon mask in an existing scenario. Check the generated area table and map together at a known changed location. When using the optional zones, compare the selected zone totals with their actual geometry.

A receiving session should retain its application root, startup command, installed runtime version, actual source collection and plan IDs, resulting run IDs, output paths and one screenshot of the completed operator path in the original project thread. These connect the integrated source to the running study.

### Concurrent use in the shared application

Source comparisons retain their exact source choices. Changing editions or source mappings while a comparison is loading discards the superseded response; saving checks the current choices again. Plan details track the selected plan and its retained progress timestamp, so idle application refreshes reuse the displayed details while changed progress reloads them. Workspace changes and closed desks discard their outstanding responses. An aborted mount from an earlier workspace cannot replace the newly opened desk with an old error.

## Existing source refresh plans

The common desk lists both retained source-refresh plan formats. It reopens and applies each plan through the engine that created it, preserving the original plan identity and retained progress. Printable HTML and CSV reports use the selected saved plan. Export complete study submits the original workspace backup operation and includes the model inputs, source editions, results, and update progress. Existing `/source-refresh` links, class-based clients and command-line report/export operations continue to work.

## Retained requests in the current operator

Source updates saves a request identity and its complete selection before submitting a plan, native preparation, model execution, land-cover comparison or complete-study export. If the connection ends before acknowledgement, **Continue a submitted selection** retrieves the same original task. A failed or interrupted acknowledged task retains the existing **Resume this operation** control. Changing the source choices creates a separate request. A fresh completed plan save captures the current native dependency snapshot; a fresh completed archive export includes the project's later work. Pending retries retain the earlier intent.

The update title, source replacements, selected plan and land-cover choices survive leaving the desk and reopening the same workspace. The existing operation queue remains responsible for execution and queued cancellation. Complete exports include both immutable refresh-plan formats and their native execution state.

## Operate the original source update and receiving copy

The public application's complete source is maintained under
`opportunities/upstate_forever_2026`. Use the current checkout with its original
operator and both retained plan engines. The installer also supports receiving
the complete component beside another current application and shares the
existing extension-install lock.

The operated browser journey takes actual retained source collections and
optional explicit source-ID mappings:

```bash
node source/run_source_updates_browser.mjs \
  --url-file /private/current-operator-url.txt \
  --workspace ORIGINAL_OPERATOR_WORKSPACE_KEY \
  --from-collection EARLIER_RETAINED_COLLECTION \
  --to-collection REPLACEMENT_RETAINED_COLLECTION \
  --mapping /path/to/selected-original-source-ids.json \
  --title "Upper Savannah source update" \
  --run-models --transfer --video \
  --output /path/to/source-update-journey
```

The mapping is the same original-ID-to-replacement-ID object used by the desk;
null leaves a source unmapped. Omit the argument to use the retained same-ID
matches. Select actual study editions and inspect any concrete dependency
message before execution. The driver operates the existing controls, first
rejecting an identical-edition selection, then saving and preparing the real
update, executing the native models when requested, downloading the original
plan and HTML/CSV reports, and reopening the saved plan in a fresh browser.
With `--transfer`, it downloads the ordinary complete archive, verifies its
native ticket, restores that exact ZIP through the original form, and opens the
same immutable update and progress in the independent receiving workspace.

Screenshots, optional browser video, original downloads and the completed step
journal are saved in the selected output directory. The private operator URL
and capability are redacted. A native failure leaves its actual task identity
and exception in that same journal and the original operator queue, so
continuation uses the saved operation.

### Existing plan bookmarks

The original root-selective `/source-refresh` page remains available. Its catalogue keeps the original root-selective plans. An existing direct source-edition plan bookmark opens that exact plan in the common Source updates page, preserving its workspace; the common desk lists both formats. Direct `/web/source-refresh.html?workspace=...&plan_id=...` bookmarks also reopen the selected original plan after capability bootstrap.
