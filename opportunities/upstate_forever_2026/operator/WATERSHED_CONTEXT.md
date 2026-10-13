# Regional watershed context

The Regional watersheds desk brings the full watershed source edition into the existing Upper Savannah operator. It uses the original workspace, task queue, navigation, retained records, and verified download tickets.

## Operator workflow

1. Import the completed regional source edition through the source preparation bridge, or register its directory with the existing server's repeated --source-root option.
2. Open Regional watersheds after Receiving waters in the operator navigation.
3. Choose the retained source edition and select Build regional context. The operation appears in the original task history.
4. Search by watershed name or HUC12. Combine HUC8, state, NRCS priority, selected source class, and classification coverage filters.
5. Open Details for the original NRCS state rows, priority reasons, source class counts, source references, and any supplied downstream attribute.
6. Export the matching watersheds, one watershed, or download the complete saved regional report. Selection exports retain the full report identity and source-byte hashes.
7. Choose a Saved watershed selection to reopen its exact HUC12 membership and download the retained JSON, CSV, and selection manifest. The desk restores the last report, saved selection, filters, and watershed detail for this workspace during the browser session. Show all watersheds returns to the full regional report.

All source-defined watersheds remain available. The table renders the complete filtered set without a hidden row cap.

## Source interpretation

The completed source edition covers the 217-HUC model domain. The precise counts shown in the desk are read from the built report. The model retains the original NRCS state rows while counting each watershed's total area once. A state filter selects watersheds touching that state; its displayed area remains the whole-watershed area. The detail panel preserves the original state area values.

The selected-class SCDES query includes ORW, ONRW, TN, TPGT, and TPT. Query completion is shown only when the model binds the original query companion to the exact watershed domain. A complete query can return zero selected records for a watershed. The view retains the separate source jurisdiction and query coverage fields for watersheds outside South Carolina.

Classified-water reach counts use the agency's HUC12 attributes. Receiving-water geometric intersections, upstream contributing land, protection-area geometry, and designated-water calculations remain in their existing source-native modules. The default watershed role is model_domain. When the optional native-network.json or native-network.json.gz companion is retained with the edition, the model uses its original ToHUC records and explicit reporting/upstream assignments; watershed details and selection exports carry those source-derived roles and downstream links. Regional and selected-watershed CSVs use the same maintained HUC columns, including original state-area mappings and supplied upstream/downstream network fields.

## Install into the current application

The application must already have the shared extension host installed. From the complete source package:

    python operator/install_watershed_context.py \
      --application /path/to/current/application \
      --source-root /path/to/upstate_forever_2026

The installer adds its declared model, source bridge, provider, browser assets, manifest, and documentation. It reads and parses the complete prepared source before replacement, compares the current bytes at replacement boundaries, and saves the prior bytes for changed files. Repeating the same installation leaves matching files in place.

The registered source edition lives separately from installed extension manifests. For a directly registered edition, start the original server with --source-root pointing at the edition directory or its containing source tree. The source bridge's complete-sources.json supports original Workspace imports and reconstructed companion files after workspace transfer.

## Integration contract

The provider is watershed_context.WatershedContextActions(operator, fault, source_roots). The installed extension id and browser view id are watershed-context.

| Operation | Original transport | Result |
| --- | --- | --- |
| Discover sources and reports | GET or POST /api/watershed-context/catalog | Original workspace source choices, configured source choices, saved report summaries, and saved selection summaries |
| Build full regional context | watershed.context.analyze task | Saved regional report using source_tools.prepare_watershed_context.load_source_edition |
| Read report | GET or POST /api/watershed-context/report?report_id=ID | Complete model report, exact input hashes, and verified downloads |
| Read one watershed | GET or POST /api/watershed-context/huc?report_id=ID&huc12=HUC | Original per-watershed record and source references |
| Export selected watersheds | watershed.context.export task | Source-bound JSON and CSV selection in the original download transport |
| Read export | GET or POST /api/watershed-context/export?export_id=ID | Retained selection manifest and verified downloads |
| Original item alias | /api/item?kind=watershed-context&id=ID | Same saved report |
| Workspace state | data.watershed_context_reports | Saved report summaries |
| Browser factory | createWatershedContextDesk(host) | mount, update, detach, refresh, openWatershed |

The browser uses the shared host's api, getState, submitAction, refresh, toast, navigate, showTask, and fileList capabilities. Source selection uses registered directory identifiers and relative members, or original workspace collection/source identifiers. The provider resolves original workspace sources with Workspace.source_file and loads their reconstructed edition companions.

The source bridge verifies the complete domain membership response, the additional-HUC8 zero result, the original classified-water ID set, and the retained source manifests. The provider snapshots the exact model inputs and every supplied original query/geometry companion beside the report. The Regional report and original sources downloads include these files directly. Model-input files alone determine the source fingerprint; supporting originals have a separate retained inventory. Repeating analysis with the same model inputs adds newly received originals to the existing report under the workspace lock. The provider verifies the existing report hash, preserves the report bytes and ID, reuses identical named originals, and rejects conflicting named bytes. Existing saved selections continue to reference the same report. Report reads verify the retained model report hash. Exports contain exact selected rows, the parent report SHA256, the source fingerprint, source references, the domain query interpretation, and model methods.

## Retained paths

- watershed-context/REPORT_ID/operator-report.json: operator record and exact source manifest.
- watershed-context/REPORT_ID/watershed-context.json: complete source-derived regional report.
- watershed-context/REPORT_ID/source/: original model-input, query-response, and geometry snapshots.
- operator-report.json source_supporting_inputs: retained supporting-original names, byte counts, and hashes, kept separate from source_inputs and the model-input fingerprint.
- watershed-context-exports/EXPORT_ID/export.json: selection identity and downloadable file descriptors.
- watershed-context-exports/EXPORT_ID/selected-watersheds.json and selected-watersheds.csv: selected source rows.

The standard portable application/workspace archive can carry these files with the rest of the original workspace.


## Receive a completed native result

Use the original finished calculation directly in the existing Workspace. The
receiver validates the published archive, the original invocation, all seven
outputs, and every original source-bank file before registering the report.
It preserves the report ID, original report bytes and saved HUC selection.

For the completed 217-HUC result in F0C9JNBA7EU, decode its complete artifact
packet to eco-watershed13-received.zip and run with the current application's
Python and actual existing Workspace:

    python operator/receive_watershed_context.py \
      --application CURRENT_APPLICATION \
      --workspace CURRENT_WORKSPACE \
      --archive /absolute/path/eco-watershed13-received.zip \
      --archive-sha256 716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5 \
      --carrier-file-id F0C9JNBA7EU \
      --expect-report-id watershed-4592eb077b7164d59ba4

The archive is 121,182 bytes. The default operation remains
ECO-WATERSHED13-20261013. The same receiver accepts subsequent completed native
archives using their published SHA-256 and actual report ID; their native
source receipt and source bank must describe their executed source edition.

The receiver uses the application's original Workspace and .workspace.lock.
It assembles the complete report in a private adjacent directory, then
registers the directory atomically. Repeating the same receive checks and
reopens its original saved files. Source snapshots, the complete original
archive, stdout, stderr and native receipts travel with the saved report.

Open Regional watersheds, select Refresh reports, and choose the received
report. The existing catalog, report, HUC detail, item alias and download
tickets read the ordinary operator-report.json record. All seven original
native reports remain individually downloadable, including the original
selected-watersheds.json and selected-watersheds.csv.

For Lower Tugaloo, find 030601020507 and open Details. The retained full report
still contains all 217 HUC12s; its original saved selection contains that one
HUC. Export this watershed, then reopen the resulting selection through the
current export-history controls. Refresh or reopen the Workspace and select
the same regional report ID to continue.

The original source edition has 15 NRCS priority HUC12s and 19 HUC12s with
selected classified-water records, with no overlap. Priority and source-class
controls have independent All defaults. Combining a priority filter with a
selected class returns the actual intersection. State membership selects
whole watersheds; Lower Tugaloo keeps 59,689.69 whole-HUC acres alongside the
published Georgia 38,264.28633246-acre and South Carolina
21,425.42741381-acre portions.

## Complete native fields in selection CSVs

Selection CSVs use the maintained model HUC_COLUMNS and its native CSV
serializer. This retains the source edition's state-area, NRCS, classification
coverage and source-reference fields, and carries additional native topology
columns when the network-enabled model supplies them. Nested cells remain
JSON, booleans keep native spelling and spreadsheet formula protection follows
the same writer as the native reports.

The selection export identity includes csv_format
upstate.watershed-context-csv/v2 and the complete csv_columns list. A changed
native field list receives its own retained export identity. Previous saved
exports keep their original files and IDs; a new export contains the current
native columns. The parent report ID and original report bytes stay attached
to every selection.


## Original drainage network in watershed details

When the source edition contains the original HUC12/ToHUC records, the detail panel shows the downstream path and distinct known upstream model watersheds, their published area, NRCS priority count, and selected-class record count. Open an in-domain HUC12 to inspect that watershed. Destinations outside the model domain retain the original identifier as text, so they do not lead to an unavailable detail view. Terminal outlets, unknown downstream attributes, and missing source rows remain distinct.

The upstream summary excludes the focal watershed and uses the original published HUC areas. Reopening a saved selection restores its membership. Following an upstream or downstream HUC outside that selection returns to the full parent report and opens that watershed. The JSON and CSV export paths continue to use the same source-bound model report.

## Planning briefs for saved watershed selections

New selection exports include watershed-selection-brief.html and watershed-selection-brief.md alongside their original JSON and complete native-field CSV. Open the HTML to review or print the selected watershed, original state-area and NRCS-status tables, source-class query context, original drainage network and source links. The same saved report and selected HUC12 membership appear in all four formats.

Export RFP focus brief selects Upper Six And Twenty Creek (030601010703), Lower Six And Twenty Creek (030601010704), Choestoea Creek (030601020502) and Lower Tugaloo River (030601020507) from the parent report. This control appears when all four original HUC12s are present. Other selections keep the existing Export matching watersheds and Export this watershed paths.

The current selection export identity includes brief_format alongside csv_format and csv_columns. This gives the readable brief its own retained format identity while keeping prior saved selections available. Install model/watershed_brief.py with the provider. The standalone module and actual-report command are documented in model/WATERSHED_BRIEF.md.
