# Complete application source and native receiving

Use one pinned cumulative source checkout for the operation. The complete application is `opportunities/upstate_forever_2026` beneath that checkout. The maintained component catalogue is `integration/application_components.json`; the same catalogue drives source assembly and cumulative installation.

## What the selected edition carries

The source selection explicitly includes the original Implementation store, saved revisions, attachment and report handling, the original Greenwood plan and its two scientific source bodies, and the complete native receiving course. It includes Monitoring's current campaign-to-fieldwork and observed-context modules; Monitoring depends on the existing Implementation family.

The Parameter studies family carries paired-result checkpoints, the original GIS difference-map and report exporter, and the Gura suite exporter. The separate Scenario experiments workflow keeps its original source and namespace. Project transfer carries the source-acquisition and Implementation verification helpers, plus the current scientific study receiving helper when present in this edition.

The original utility family selects both `utility_observed_context.sources.json` and `source/utility-source-context-20261013.json` as native source manifests. The existing closure validator resolves each original primary and companion relative to its own manifest and checks its declared bytes and SHA256. Together those two source editions contain 54 distinct files and 5,521,858 bytes. Their complete data include the original 217-HUC network, ARJWS/Pioneer utility selections, original microbial and nutrient records, daily flow context, derived interpretation and offline reports. Source programme/state acreage and original geometric relationships keep their existing meanings.

## Receive the current application

Set the following paths from the existing operation:

```sh
UPSTATE_SOURCE=/absolute/pinned/checkout/opportunities/upstate_forever_2026
UPSTATE_APPLICATION=/absolute/existing-operation/application-received
UPSTATE_OPERATION=/absolute/existing-operation
UPSTATE_PYTHON=/absolute/existing/interpreter
```

The source and output application directories must be distinct. Preserve the existing Workspace separately. With the current complete checkout:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/source_tools/install_cumulative_application.py" \
  --source "$UPSTATE_SOURCE" \
  --output "$UPSTATE_APPLICATION" \
  --archive "$UPSTATE_OPERATION/upper-savannah-application.zip"
```

This is the existing cumulative installer. It inventories source bytes, validates the selected component closure, runs the maintained component joins in a staging directory, checks the installed source, and publishes the application and ZIP. Its result contains the actual installation path and component inventory. A failed native attempt retains its actual staged source and `CUMULATIVE_INSTALLATION_FAILURE.json`; use that exception and its exact member path to repair the same operation.

For an already integrated full source directory that needs a portable carrier rather than installation, use the existing assembler:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/source_tools/application_assembly.py" \
  "$UPSTATE_SOURCE" --edition ACTUAL_PINNED_EDITION \
  --operation-id ACTUAL_EXISTING_OPERATION \
  --source-map "$UPSTATE_OPERATION/application-source.json.gz" \
  --zip "$UPSTATE_OPERATION/application-source.zip"
```

The assembler retains original file modes and source identity and applies the same explicit family checks. Keep the actual source commit fixed while a running model or acquisition records its implementation.

## Updating only the maintained Monitoring family

The Monitoring installer now chooses the live maintained application source when it runs from a complete current checkout. Its retained older `src/` package remains available when the current application is absent. An explicit source root accepts either the complete repository or its application directory:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/integrations/monitoring/install_monitoring.py" \
  "$UPSTATE_APPLICATION" --source-root "$UPSTATE_SOURCE" --check
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/integrations/monitoring/install_monitoring.py" \
  "$UPSTATE_APPLICATION" --source-root "$UPSTATE_SOURCE"
```

`current_application_files.json` names the current owned modules and the existing Implementation/Workspace dependencies. The current mode requires the registered extension host and those dependencies already installed, including the separately maintained Monitoring report-source family used by the current adapter. A complete cumulative install supplies them together. For an older partial target, install the existing Implementation family through `install_implementation.py` and the maintained shared host before adding this current Monitoring family.

The installer reads every selected source, retains its exact identity, recognizes its own packaged/predecessor versions, and refuses to overwrite an unrelated current module. It rechecks both source identities and destination preimages under the existing installation lock. Existing shared dispatch/browser migration, staged syntax checks, backup and rollback behavior remain with the original installer. Its result states whether it selected maintained application source or the retained original package.

## Complete the original receiving course

From the installed application, use the existing operation output directories:

```sh
cd "$UPSTATE_APPLICATION"
"$UPSTATE_PYTHON" -B source_tools/receive_utility_source_context.py \
  --out "$UPSTATE_OPERATION/utility-receiving"
"$UPSTATE_PYTHON" -B source_tools/receive_implementation.py \
  --workspace /absolute/actual/existing/workspace \
  --operation "$UPSTATE_OPERATION/field12-receiving"
```

The first command uses ordinary Python 3.10 or later and retained original source bytes to produce the real regional and utility packets. The second imports the actual original Greenwood plan, retains original source attachments and its native report, captures the existing Workspace and application through Project transfer, restores them to a fresh location, and reopens the exact saved plan revision. Each command returns its own actual `receiving.json` and output paths.

In the received operator, open Project transfer and the completed receiving operation. Open its retained Implementation row to select the restored Workspace and exact saved revision. The Handover view supplies the retained report and attachment downloads. In Monitoring, select an actual saved campaign revision and use Campaign fieldwork to continue through the same Implementation store and report path. Original source questions remain tasks until the operator records real work.

For native Parameter studies, use the already prepared study and its actual scientific interpreter. Its existing run/resume path retains paired-result progress, difference GeoTIFFs and report artifacts; the current Gura suite produces verified per-study exports and the final aggregate ZIP. The source installer does not create a replacement scientific study or receiving operation.
