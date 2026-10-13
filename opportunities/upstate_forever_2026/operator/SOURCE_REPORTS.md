# Source reports in Original sources

The existing **Original sources** screen now lists readable reports retained with a source edition. The catalogue includes primary HTML documents and HTML report companions of scientific tables. The original source kind, role, ID, vintage and publisher reference remain visible.

This joins three existing uses:

- Open the fixed 192-record assessment association review and inspect the assessment-publisher and station-publisher HUC assignments alongside programme associations.
- Open the complete 705-station / 2,329-assessment source-scope review, including source-selection boundaries and all retained original records.
- Open the original 159-station assessment context report carried as a companion of the original table, then inspect its related native station and complete assessment source entries.

The **Open Regional watersheds** control continues into the already registered regional desk. That desk retains its existing source selection, native-network analysis, saved regional views and programme workflow.

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

The exact member is useful because a complete report can also carry nested original source manifests. For an archive whose import manifest has another name, replace the field with the filename reported by its export. The source preview validates the selected manifest and its files before import.

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

Import that actual manifest with the existing source command, or register it through the maintained operator’s `--source-manifest` option:

```sh
python -B -m model.cli --workspace /absolute/workspace source-import /absolute/application/source/station-assessment-context/native159-source-context-20261013/sources-complete.json
```

The resulting report opens in Source reports. Its related source list points to the entries in the same retained edition. The native geography desk keeps its existing source selection and calculation controls.

## Download and reopen a complete retained source edition

**Download report and source edition** builds a portable ZIP from the current retained collection. This remains available after importing an original ZIP, even when the outer uploaded ZIP itself was not listed as a source companion.

The export includes every original source entry and companion in that collection, each at its exact original manifest-relative `source_path`. It retains the original manifest bytes and all source IDs, kinds, vintages, metadata and relationships. Reimport therefore restores the actionable native source entries as well as the readable report.

The download message supplies the exact import-manifest member and archive SHA256. It normally uses top-level `sources.json`. If that name is already occupied by an original source member, the export selects a distinct top-level manifest filename and displays it for the next import.

On export, original files are streamed and checked against their retained byte count and SHA256. Duplicate paths with different source identities fail before a usable archive is published. Small archives use ordinary ZIP32 members; genuinely large original files retain standard ZIP64 support. Generated archives are cached in the existing operator state by their complete original source selection.

## Implementation and receiving contract

The additive provider is `operator/source_reports.py`, registered by `operator/extensions/source-reports.json`. The frontend is `operator/web/source_reports.mjs` with its grayscale stylesheet. Narrow hooks in the existing `operator/web/app.mjs` mount the panel, open the existing source form with an optional archive default, and reset the panel on a Workspace change.

The current application needs all five implementation files plus this guide. Restart the existing operator after installing the complete application cohort so its original extension registry loads the provider and assets. Existing model, source import, source refresh, delivery picker, station geography and regional desk ownership stays with those maintained components.

The provider exposes:

- `GET /api/source-reports/catalog`: retained report metadata without source-file reads or whole-edition hashing.
- `GET /api/source-reports/detail`: the selected source entry’s original member inventory and relationships.
- `POST /api/source-reports/archive`: the complete original collection as a portable source archive.
- `/api/file/source-reports/{workspace_key}/{collection_id}/{entry_key}/{member...}`: one exact member from that selected entry’s retained `view_path` inventory.

The preview route preserves original HTML bytes. It uses an opaque-origin sandbox with only original inline script hashes, downloads, printing and separate publisher windows enabled. It provides no same-origin application authority, network-fetch permission, form submission or nested frame capability. Relative links stay within the selected source member route. The generic original file endpoint and application content policy remain unchanged.

The archive path deliberately uses original `source_path` names, while the preview path uses entry-specific `view_path` names. This distinction preserves both relative report navigation and a complete original manifest on reimport, including the cross-directory assessment source companions.
