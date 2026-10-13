# Receive the original Regional Observation Atlas

The Regional Observation Atlas enters **Sources → Source reports** as one original typed scientific source. Its retained recipe, original geometries, cohort membership, figures, offline explorer and source tables travel together. The application renders that source with the maintained scientific formatter; the original author's report and explorer remain source companions.

Run the command with the Python environment already used for the application. It delegates to the existing Workspace, report queue, report export, full project backup and selected-study transfer. It does not invoke an ecosystem model.

## Adopt an already received full project

The original0730 project is `b9d5d257-c6bb-4f07-b975-8e8c63705db3`. Its saved atlas collection is `d26f8ca0c91bea165e0a8c6b3cfbbc6ebc451ab405b09d0b956a4646144a2084`; source ID is `regional-observation-atlas-20261013`. Use these IDs with that actual retained project.

From its received application directory:

```sh
python -B source_tools/receive_regional_atlas.py \
  --workspace /absolute/original/workspace \
  --output /absolute/atlas-adoption \
  --source-collection d26f8ca0c91bea165e0a8c6b3cfbbc6ebc451ab405b09d0b956a4646144a2084 \
  --source-id regional-observation-atlas-20261013
```

The output must be separate from application and Workspace. This first call adopts the saved source and writes `source-selection.json`. Open Sources, select the retained document in Source reports, and use the existing report controls. The recipe's exact project ID must match the Workspace. Every selected original companion and the original scientific binding are verified.

Continue that selection through complete rendering and receiving:

```sh
python -B source_tools/receive_regional_atlas.py \
  --workspace /absolute/original/workspace \
  --output /absolute/atlas-adoption --resume --receive
```

The maintained `source/observed-report-20261013/receive_operator.py` renders the selected edition; downloads PDF, HTML, Markdown and report data; checks every report ZIP member; makes and receives the full editable Workspace; and exports and receives the selected scientific study. `receiving/scientific-report-receiving.json` records the original queue task IDs, report edition, restored Workspaces, exact file identities and browser continuation. `regional-atlas-receiving.json` links the same outcome.

A first call may also include `--receive`. Repeat a started operation with `--resume --receive`, preserving the original output. The maintained receiver owns reconciliation of its original task and edition state. Completed adoption no longer needs the external atlas folder: continuation reads its retained source objects. If interruption preceded the first saved selection, repeat the initial source arguments with `--resume` in the otherwise lock-only output.

## Adopt the original extracted atlas

Use the original `regional-atlas.sources.json` produced by the atlas author:

```sh
python -B source_tools/receive_regional_atlas.py \
  --workspace /absolute/original/workspace \
  --output /absolute/atlas-adoption \
  --manifest /absolute/original-atlas/regional-atlas.sources.json --receive
```

The command imports the manifest unchanged through `Workspace.import_sources`. It verifies all declared files before and after import and compares selected retained objects with the original identities. If the manifest contains multiple typed reports, add its actual `--source-id`. The source recipe and manifest are preserved byte for byte.

If import is interrupted before its receipt is saved, preserve the original manifest and companions for continuation. Once the source receipt exists, resume uses its retained collection and source ID and accepts the saved selection rather than replacement source arguments.

Optional `--title` and `--contact-json` belong to first adoption and are frozen in `atlas-selection.json`. A requested different source selection or presentation uses a separate output edition. Previous reports and original source objects stay available.

## Original scientific meaning

The initial atlas's 217 HUC12 polygons, 36 station points, 729 routine-observation memberships and 12 intersecting source-water HUCs describe that saved selection. Eight intersecting HUCs have observations in its selected microbial cohort. The other four lack observations in that selected cohort; this does not establish absence of monitoring generally.

The original recipe and tables supply these quantities. The receiver contains no fixed atlas counts and does not infer a new cohort from display labels. Unsimplified geographic support, boundary and overlap memberships, measurement references, and the distinction between source-water protection areas and upstream watershed areas remain with their producer. Source-water and station-geography editions retain distinct IDs and directories.

The completed atlas ZIP and original report remain intact. A new scientific edition does not overwrite them. Configurable regeneration belongs to the atlas producer and must explicitly bind selected geography, observation cohort and source-water study before producing another manifest.

## Complete installed source and continuation

The `scientific-report-receiving` fragment installs this command and guide with the complete receiving family. Installed optional `model/scientific_tables.py` and `model/scientific_map_figures.py` join new rendering identities; their exact source bytes travel with new reports. Saved previews and completed editions keep their original identities.

For the actual browser continuation, add `--browser-node /absolute/node` to the same `--resume --receive` command; `--video` forwards the existing capture option. The receiver uses the ordinary application operator and existing browser course. Use the currently authorized browser environment and original receiver.

`--timeout` and `--upload-limit-gib` can change on continuation without changing the original source selection. Full Workspace archives can be large: preserve original output roots and use the existing native receiver's available space.
