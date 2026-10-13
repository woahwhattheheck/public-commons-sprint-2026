# Source reports in Original sources

The existing **Original sources** screen offers available original source editions for preview and import, and lists readable reports already retained in the selected Workspace. The catalogue includes primary HTML documents and HTML report companions of scientific tables. The original source kind, role, ID, vintage and publisher reference remain visible.

This joins three existing uses:

- Open the fixed 192-record assessment association review and inspect the assessment-publisher and station-publisher HUC assignments alongside programme associations.
- Open the complete 705-station / 2,329-assessment source-scope review, including source-selection boundaries and all retained original records.
- Open the original 159-station assessment context report carried as a companion of the original table, then inspect its related native station and complete assessment source entries.

**Open Station geography** continues into the registered native station desk. The **Open Regional watersheds** control continues into the already registered regional desk. That desk retains its existing source selection, native-network analysis, saved regional views and programme workflow.

## Import an edition included with the application

1. Select the intended Workspace and open **Original sources → Review retained reports**.
2. Under **Available source editions**, choose the actual source edition. The table shows its original source count, file count, source vintages and readable report titles.
3. Choose **Preview and import**. This opens the existing source form with that exact registered manifest selected.
4. Choose **Preview source**, inspect the original entries and metadata, then **Import this source edition**. The existing `source.import` task retains the original files in this Workspace.
5. When the task completes, return to the same panel and choose **Open report** or **Inspect retained edition**. A source edition already retained here is identified by its original manifest SHA256.

The installed application automatically offers the completed 192-record association report, the 705-station source-scope report, the complete station assessment sources, the all-editions station source selection when installed, and the original regional watershed sources. It discovers their actual manifests; it does not pre-import data or create a scientific calculation.

**Refresh available editions** rereads those manifests and any configured source directories. A partially installed edition shows its missing or changed-size members under **Source files need attention**, allowing the original source package to be restored before import. Readiness uses manifest metadata and file sizes; the existing Workspace importer verifies the original source bytes and declared hashes during the import.

The native all-editions manifest is:

```text
source/station-assessment-context/native159-source-context-20261013/sources-all-editions.json
```

Its eight original source entries support the maintained three-edition selection of 293 assessment records at 164 sites. The additional draft inventory keeps its original draft status. The readable **published** station context report within that collection still represents its original 192 records and 159 sites; its title, tables and bytes stay unchanged. The all-editions source collection and the published report therefore appear with their own source-derived labels.

For another original edition, start the maintained operator with an explicit `--source-manifest /absolute/edition/sources.json`, or point `--source-root` at the actual edition directory. Existing explicit registrations keep their order and identity. Configured edition directories admit immediate `sources*.json`, `*.sources.json`, `*-sources.json` or `source-manifest.json` files; an application directory also supplies the known bundled report paths. This also recognizes the regional edition’s original `complete-sources.json` and `complete-native-sources.json` when its directory is the configured source root. No recursive search of Workspaces or source bodies occurs.

From the complete application directory, an existing Workspace can be opened with:

```sh
python -B operator/server.py --workspace /absolute/workspace --source-root /absolute/source-edition
```

The installed report paths are discovered without extra flags. Keep the existing operator-state and other source options for an already running operation; restart that same operator after installing the updated application. A manifest changed after explicit registration remains bound to the original registered hash until the operator is restarted with its new edition.

## Open an existing retained report

1. Select the intended Workspace, then open **Original sources**.
2. Choose **Review retained reports**, or scroll to **Source reports and regional context**.
3. Search by title, source ID, edition or report type. Choose **Open report**.
4. Use the report’s original search, source drilldown, record selection, CSV / JSON download and saved-review controls. Reports that have several readable documents expose an exact original-member selector.
5. Expand **All retained report and source files** for individual original files, relative paths, byte counts and SHA256 values.

The report panel remains mounted while ordinary Workspace metadata refreshes. Changing the report document intentionally opens that document anew. Switching Workspaces removes the old panel and cancels stale results before the new source catalogue opens.

**Inspect source edition** opens the existing source detail dialog. **Original import manifest** downloads its retained original manifest. Publisher links open separately from the report and application.

## Receive a report ZIP through the existing source workflow

Choose **Import report ZIP** in the report panel. This opens the existing source preview in archive mode with `sources.json` selected as the exact manifest member.

Upload the complete report ZIP, preview its original source metadata, then choose **Import source edition**. The existing operation queue performs the import; the report appears after the source catalogue refreshes.

The exact member is useful because a complete report can also carry nested original source manifests. For an archive whose import manifest has another name, replace the field with the filename reported by its export. The source preview identifies the exact manifest and original file selection; the queued Workspace import verifies the source bytes.

The two completed portable report editions in the application are:

| Report | Original output directory | Readable document | Portable archive |
| --- | --- | --- | --- |
| Fixed 192-record assessment associations | `results/assessment-association-review-20261013/` | `OPEN_ASSESSMENT_ASSOCIATIONS.html` | `assessment-associations.zip` |
| Complete native station and statewide assessment source scope | `results/assessment-source-scope-review-20261013/` | `OPEN_SOURCE_SCOPE.html` | `source-scope-report.zip` |

An operator with the application’s original files can also import either directory’s `sources.json` through the existing native command:

```sh
python -B -m model.cli --workspace /absolute/workspace source-import /absolute/application/results/assessment-source-scope-review-20261013/sources.json
```

The source-scope report retains the full 705-feature and 2,329-record inventories. Its 246 matched assessment records cover 209 native stations. The original fixed-domain review remains a separate 192-record / 159-site report. Source coverage and the two publisher HUC assignments remain distinct from a native polygon membership calculation.

## Receive the original station context and actionable sources

The complete native station and assessment source edition lives at:

```text
source/station-assessment-context/native159-source-context-20261013/sources-complete.json
```

It declares seven original source entries. The context entry keeps its original table kind and `STATION_ASSESSMENT_CONTEXT` role; its readable report is `results/OPEN_STATION_ASSESSMENTS.html`. Related entries retain the three primary native location sources, the supplemental WQP coordinate context, and both complete original assessment editions.

Select this installed edition under **Available source editions**, or import the actual manifest with the existing source command:

```sh
python -B -m model.cli --workspace /absolute/workspace source-import /absolute/application/source/station-assessment-context/native159-source-context-20261013/sources-complete.json
```

The resulting report opens in Source reports. Its related source list points to the entries in the same retained edition. The native geography desk keeps its existing source selection and calculation controls.

### Continue the native all-editions study

After importing `sources-all-editions.json` and the original 217-HUC watershed source, choose **Open Station geography**. This opens the existing `station-geography` desk; its original queued `station.geography.build` action remains the producer.

The maintained prepared study is `upper-savannah-assessments-all-editions-164`. It selects the three original assessment inventories together and the original native location sources. For the existing native command and independent receiving Workspace:

```sh
python -B -m model.station_study \
  --workspace /absolute/current-workspace \
  --build \
  --study-id upper-savannah-assessments-all-editions-164 \
  --receive-workspace /absolute/receiving-workspace \
  --create-receiving-workspace
```

Use the actual current Workspace and the original operation’s receiving directory. In the maintained assessment context controls, select the completed geography and the original watershed source; all three inventories start selected together. The existing native producer renders the full 293-record selection. Assessment-publisher HUC, station-publisher HUC and native polygon membership retain their separate meanings, and draft records retain their source edition status.

The published context HTML already present in Source Reports remains the completed 192-record original. The native all-editions workflow produces its own current retained result from the larger source selection.


## Download and reopen a complete retained source edition

**Download report and source edition** builds a portable ZIP from the current retained collection. This remains available after importing an original ZIP, even when the outer uploaded ZIP itself was not listed as a source companion.

The export includes every original source entry and companion in that collection, each at its exact original manifest-relative `source_path`. It retains the original manifest bytes and all source IDs, kinds, vintages, metadata and relationships. Reimport therefore restores the actionable native source entries as well as the readable report.

The download message supplies the exact import-manifest member and archive SHA256. It normally uses top-level `sources.json`. If that name is already occupied by an original source member, the export selects a distinct top-level manifest filename and displays it for the next import.

On export, original files are streamed and checked against their retained byte count and SHA256. Duplicate paths with different source identities fail before a usable archive is published. Small archives use ordinary ZIP32 members; genuinely large original files retain standard ZIP64 support. Generated archives are cached in the existing operator state by their complete original source selection.

## Implementation and receiving contract

The additive provider is `operator/source_reports.py`, registered by `operator/extensions/source-reports.json`. The frontend is `operator/web/source_reports.mjs` with its grayscale stylesheet. Narrow hooks in the existing `operator/web/app.mjs` mount the panel, open the existing source form with an exact registered-manifest selection or optional archive default, and reset the panel on a Workspace change.

The current application needs all five implementation files plus this guide. Restart the existing operator after installing the complete application cohort so its original extension registry loads the provider and assets. Existing model, source import, source refresh, delivery picker, station geography and regional desk ownership stays with those maintained components.

The provider exposes:

- `GET /api/source-reports/catalog`: available registered editions, readiness metadata and retained reports without source-body reads or whole-edition hashing. An explicit `refresh=1` refreshes the selected installed/configured manifests.
- `GET /api/source-reports/detail`: the selected source entry’s original member inventory and relationships.
- `POST /api/source-reports/archive`: the complete original collection as a portable source archive.
- `/api/file/source-reports/{workspace_key}/{collection_id}/{entry_key}/{member...}`: one exact member from that selected entry’s retained `view_path` inventory.

The preview route preserves original HTML bytes. It uses an opaque-origin sandbox with only original inline script hashes, downloads, printing and separate publisher windows enabled. It provides no same-origin application authority, network-fetch permission, form submission or nested frame capability. Relative links stay within the selected source member route. The generic original file endpoint and application content policy remain unchanged.

The archive path deliberately uses original `source_path` names, while the preview path uses entry-specific `view_path` names. This distinction preserves both relative report navigation and a complete original manifest on reimport, including the cross-directory assessment source companions.
