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


## Typed scientific documents and assessment editions

Available source editions includes original `document` entries and `OBSERVED_CONTEXT` recipes even when the edition has no HTML preview. This keeps the original source kind, role, identifier, vintage, file paths and manifest identity. Discovery does not convert a JSON recipe into an HTML report or render a second interpretation.

The maintained bundled manifests now include these original source families:

| Original manifest | Scientific report source | Intake |
| --- | --- | --- |
| `source/north-carolina-assessment-2022/sources.json` | `ncdeq-final-2022-savannah-scientific-report` | Original NC2022 assessment context and document recipe |
| `source/georgia-assessment-2024/publisher-savannah-20261013/sources.json` | `ga2024-gis-observed-report` | Original GA2024 assessment documents, including its separate report-section source |
| `nc_assessment_history.sources.json` | `nc-assessment-history-2008-2022` | Original assessment-history recipe and retained HTML companion |
| `eighteenmile_trace_metals.sources.json` | Original manifest's trace-metals source ID | Original scientific document and retained companions |

All source family files must be present in the existing application or configured source root. This provider addition does not replace those families or acquire their input data. Missing declared files remain visible as source-file issues, and the existing import remains unavailable until its original manifest is ready.

### Preview, import and append the exact retained studies

1. In **Sources**, search the available editions by title, source ID, role, vintage or document path. The contents list identifies a typed **Scientific report source** independently of any HTML preview.
2. Choose **Preview and import**. This opens the original registered-manifest import form. Inspect its exact source records and files, then use the existing **Import source edition** queue action. The native Workspace import remains responsible for file hashes and source identity.
3. Refresh Sources after that original import completes. The edition is matched to retained collections by the original manifest SHA256. **Inspect retained edition** opens the existing source record even when no HTML report exists.
4. Choose **Add source studies to report** beside the retained edition. The action appends only that exact collection's `document` entries with role `OBSERVED_CONTEXT` to the original ordered scientific-report composer. It passes the original `source_collection_id` and `source_id` pairs; it does not infer IDs from titles or silently choose another collection.
5. Review the ordered selection, title and contact fields, then use the composer's existing preview and saved-report controls. The original `observed_context` binding validates each recipe schema, section/table structure and retained body/companion hashes. A discoverable document is not a promise that its scientific recipe is valid.

Appending preserves the existing source order, current nonempty title and other draft fields. A pair already selected is not added again. A pending report write must first complete or be recovered using the composer's existing controls; an unrelated draft alone does not prevent adding these sources.

HTML preview routes remain limited to actual retained HTML members. A document-only NC2022 or GA2024 edition therefore opens through source inspection and the scientific composer. Its JSON recipe is not placed in the HTML iframe. A recipe with an original report companion continues to use that exact readable document through the existing preview.

### Same-operation native receiving

Use the existing NC2022/GA2024 source operation and its original Workspace, source manifests, source files and domain selections. If its source import has already completed, reopen that retained collection. If the original operator was already running when the application source changed, follow that operation's normal restart/continuation procedure so the maintained provider is loaded. Do not start another model, assessment calculation or source acquisition solely to exercise discovery.

For this intake continuation, retain the actual manifest SHA, registered source ID, completed original import task ID, returned collection ID and selected source IDs. Inspect the original import metadata, append each assessment recipe, then inspect the original scientific preview's ordered source identities. Download and reopen the actual final report and its source files. Continue the existing saved-edition, full/selected Workspace export and receiving course when those phases are already part of the accepted operation.

The producing peer must run the exact outgoing application and LOOK at the actual Sources and report screens: desktop/screenshare and narrow/mobile, ready and missing-file editions, empty/search results, loading and actionable errors. Operate import, append, preview, downloads and reopen. Check readable titles, source IDs, tables and controls without clipping or overflow. Literally open the final HTML/PDF/source documents and extracted archive contents. Source review, controlled-DOM checks, HTTP responses and captured-but-unviewed screenshots do not replace this inspection; repair defects in the original implementation.

### Provider and client contract

`/api/source-reports/catalog` retains its existing `reports` array for HTML previews. Each `available_editions` row additionally returns `documents`: exact original source ID, title, kind, role, vintage, manifest-relative path and a `scientific_report` dispatch label. It also returns `retained_scientific_sources` only from collections whose original manifest SHA matches that row.

The client invokes the existing nested scientific composer with:

```javascript
scientific.openForSources({
  workspace_key: currentWorkspace,
  sources: exactRetainedCollectionSources,
  title: originalEditionTitle,
  selection_mode: 'append'
});
```

The incoming source list is validated against the original current scientific catalogue. Current Workspace and generation guards reject stale selections. Existing saved-edition `openForStudy` navigation, report draft recovery, source import ownership and HTML member transport remain intact.


## Transfer a complete retained document edition

**Retained source editions** lists typed document collections already present in the Workspace. It reads the retained source records, so this list remains usable after restoring a project without the original installed publisher directory. The available-edition discovery list and original HTML report previews remain separate.

For a document-only assessment recipe or any other listed original document edition:

1. Choose **Inspect retained edition** to inspect its original collection and source records.
2. Choose **Download complete source edition**. The original archive writer exports every entry and companion in that collection at its original manifest-relative `source_path`, plus the exact retained original manifest bytes. The response is admitted only when it matches the chosen Workspace, collection, manifest hash and declared source roster.
3. Keep the ZIP and its displayed SHA256. Expand **Original import identity** and retain the exact manifest member name and original manifest SHA256. If an original source already occupies top-level `sources.json`, the writer selects a distinct top-level manifest filename; no source path or manifest body is rewritten.
4. Extract and open the actual documents and source files as part of outgoing inspection. Use the existing source import in the receiving Workspace, or choose **Reimport downloaded edition** to open that form in archive mode with the correct manifest member already selected.
5. Upload the downloaded ZIP, inspect the exact original metadata, then queue **Import source edition** through the existing operation. Check the returned source entry IDs, kinds, roles, vintages, manifest hash and every retained original body/companion identity. A receiving collection ID may legitimately differ with its import record; retain the actual returned collection rather than substituting the donor ID.
6. In the receiving Workspace, reopen the retained edition and use **Add source studies to report**. This uses its actual receiving collection/source choices in the original ordered composer. Existing saved report and selected/full Workspace continuation remain the original course.

The download contains the complete source edition. It does not claim to contain unrelated model runs or editable study histories; use the existing selected Study or complete Workspace transfer when those objects are required.

A download request that finishes after leaving or switching the Sources view does not change the current screen or start an unrelated download. Returning to the same collection can repeat the same deterministic archive request and reuse its original archive identity. The current view shows source identity errors beside the selected edition. Existing pending scientific report writes and draft fields are unaffected.

### Archive API compatibility

The existing `POST /api/source-reports/archive` now supports collection-based export with:

```json
{"collection_id":"<actual retained collection ID>"}
```

Its original `collection_id` plus `entry_key` request still uses the original HTML-entry admission, even when a supplied entry key is empty or malformed. HTML preview, member and detail routes continue to require a real retained HTML report. Collection-only export uses the same existing writer, path checks, original manifest, whole companion inventory, streaming byte/hash verification, ZIP64 handling, deterministic cache selection and download ticket.

The response adds `collection_id`, `original_manifest_sha256` and the complete original `source_ids` roster. `source_id` remains the chosen report ID for original report callers and is null for a whole-collection request. `manifest_member` and `download` retain their established meaning. There is no synthesized replacement manifest and no new archive format.

The existing catalogue additionally returns `retained_editions` for actual source collections containing documents. Rows include exact collection and original-manifest identity, original document metadata and native scientific source choices. This requires an ordinary retained original manifest; it does not infer a source edition from an arbitrary file directory.

### Producing-owner receiving and inspection

Continue the same accepted source intake with its actual donor/receiving Workspaces and original files. Exercise document-only NC2022/GA2024 export and reimport after their actual original source import, plus an existing HTML report export to confirm the original path still operates. When a retained edition is restored without the installed publisher folder, use **Retained source editions** directly. Return actual archive bytes/SHA, manifest member, original and receiving collection/source IDs, completed import task and any first exception.

The producing owner must OPEN and LOOK at the exact outgoing Sources and import views at desktop/screenshare and narrow/mobile widths. Operate ready/empty/search/loading/error states, download, import and reopen; inspect long identifiers and document titles for clipping or overflow. Download and extract the actual ZIP, compare its complete declared inventory through the original import, and literally open the contained scientific documents, data and final report. Code/V8 checks, HTTP success and screenshots that nobody viewed do not satisfy this inspection. Repair visible or functional defects in the original source and retain the actual result in the existing operation.


## Included source ZIPs: preview and import without downloading first

An installed edition can contain a complete original source ZIP and an
`artifacts.json` inventory without a separate source manifest file. **Sources →
Available source editions** now lists these editions alongside registered
manifests. Choose **Preview included ZIP**, inspect the original source records
in the normal import form, and choose **Import this source edition**.

The first included edition is **Physical assessment coverage, measured E. coli
and annual references**, under
`results/native-assessment-annual-yields-20261013/`. Its unchanged inventory
selects `native-assessment-microbial-delivery.zip` and its root
`sources.json`. This is the complete annual-yield successor: 17 original typed
source entries, native station geography, the measured 730-record source,
assessment records, five original annual basins and the annual reference
tables. The preview shows the actual entry count from that selected manifest;
discovery does not infer a source count from the number of archive members.

### Operator course

1. Open **Sources** in the intended Workspace and choose **Refresh available
   editions**. Search for “annual references”. The included ZIP row displays its
   title, installed size, declared member count and original archive SHA256.
2. Choose **Preview included ZIP**. The operator retains the unchanged ZIP,
   checks its declared byte count and SHA256, and uses the existing archive
   preview to select the exact original manifest. In a team operator,
   server-owned included files follow the same administrator requirement as
   registered source manifests.
3. In **Import original source data**, review **Included source archive**, its
   original filename and manifest path, and every original source title, kind,
   role, publisher URI, vintage and units. Nothing has been imported yet.
   Choose **Import this source edition** to use the original queued
   `source.import` action. Changing to another source mode uses the normal
   file/registered preview flow; returning to this included archive restores
   this exact retained preview in the same Workspace.
4. After the import task completes, return to Sources. **Retained in this
   Workspace** is determined by the original manifest SHA256. **Open report**
   opens the unchanged HTML, **Inspect retained edition** opens the source
   record, and **Add source studies to report** appends the original scientific
   recipe to the maintained ordered report composer.
5. Continue the original scientific preview and saved-report flow. Inspect the
   annual-yield section, original units and five basin denominators. The
   report's existing native-station and measured-activity controls retain
   their original source bindings; the 730 source rows are not relabelled as
   the eight assessment records or four overlapping sites.
6. Use **Download report and source edition** for the existing complete
   retained-source export. Import that ZIP into the receiving Workspace through
   **Import report ZIP**, then reopen the original report and inspect the
   scientific source. Preserve the existing native operation and project when
   continuing an already accepted receiving course.

A missing ZIP, changed installed size or capacity problem is shown in **Source
files need attention**. A changed inventory or mismatched ZIP/manifest hash
stops preview and leaves the Workspace unmodified. Restore the complete source
edition or use **Refresh available editions** after a deliberate installation
update. Invalid ZIP structure or missing declared source members uses the
original archive-preview error. The application never substitutes a similarly
named report or guesses a manifest when several exist.

### Installation and discovery

Ship `operator/source_archive_ingress.py` with the maintained Source Reports
provider, browser, descriptor and the source import form in `operator/web/app.mjs`.
The original `operator/server.py`, ZIP validation and import task remain in use.

The built-in inventory is
`results/native-assessment-annual-yields-20261013/artifacts.json`; its exact ZIP
must also be included. Existing `--source-root` directories may contain
`artifacts.json` or `*-artifacts.json` directly, or the known application-relative
inventory path. An explicitly configured inventory file also works. Discovery
does not recursively walk a Workspace, scan archive contents, extract source
files or hash the entire archive during refresh.

A supported inventory uses the existing `commons.artifacts/v1` schema:

```json
{
  "schema": "commons.artifacts/v1",
  "title": "Original source edition title",
  "archive": {
    "path": "original-source-edition.zip",
    "bytes": 12345,
    "sha256": "<original ZIP SHA256>",
    "manifest_member": "sources.json"
  },
  "files": [
    {"path": "sources.json", "bytes": 1234, "sha256": "<original manifest SHA256>"}
  ]
}
```

The illustrative counts above are placeholders for the publisher's actual
inventory. Keep every original member descriptor in a real inventory. Paths
are canonical relative paths; the archive remains inside the selected edition.
The import manifest requires its own original byte/hash descriptor. Inventory
reads are limited to 4 MiB and 20,000 declared members. Archive upload and
extraction limits remain the operator's existing configured limits.

The catalogue returns `source_kind: "included_archive"`, an opaque
`archive_id`, the original archive size/SHA, manifest name/SHA and readiness.
It returns no selectable server filesystem path. A byte-identical, ready loose
manifest already listed takes precedence over an included ZIP. A missing loose
companion does not hide a complete included ZIP of that same edition. Explicit
registered-source ordering and source kinds remain unchanged.

`POST /api/source-reports/included-archive-preview` accepts only an
`archive_id` from current discovery. It calls the original
`Operator.receive_upload` and `Operator.preview_source`, then returns the
same retained preview with its Workspace and archive identity. The browser
rejects a changed Workspace, a superseded preview request or mismatched
archive/manifest metadata before opening the import form. Navigating away
discards a pending UI handoff; the original retained upload can still be reused
by a later valid preview.

### Native receiving and visual use

Continue the original annual-yield receiving operation with this exact outgoing
application. Operate the included ZIP row through preview, original queued
import, report open, scientific preparation, complete source export and fresh
Workspace reimport. Check the retained collection's root manifest identity
against the inventory and retain the actual import task/collection IDs.
Do not recalculate geography or the measured source just to verify this intake.

Open the actual Sources and import screens at desktop/screenshare and narrow
widths. Read the long edition title, original identities, source table and
actionable missing/changed-file messages; operate the real controls. Open the
resulting HTML, scientific report and exported/reimported source edition. A
source review or simulated DOM does not establish that the delivered screens
render correctly.
