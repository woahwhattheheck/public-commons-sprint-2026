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


### Reanalyze a received source edition

The receiver keeps every original source and program file in `native_source_files` and the retained archive. Its ordinary `source_inputs` inventory contains only the executed context, optional classification coverage and optional native network under the same canonical filenames used by source import. Exact source aliases live at `source/<canonical-name>`. The core source fingerprint is therefore identical across native receiving and source import, allowing the operator to add later publisher query and geometry companions to a same-input regional report while keeping its original report bytes.


## Original native network and upstream detail — v1.2.0

The existing source loader accepts `prepare --native-network PATH`. For the original Upper Savannah source, pass `source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json`. The loader retains those exact bytes as `native-network.json` beside `full-domain-water-context.json` and `scdes-domain217-source-coverage.json`. The source edition and its normal Workspace import remain one cohort.

The Regional watershed context desk also offers original network sources from the server's registered source roots and imported native-network entries. Register the application source root with `--source-root` when launching the operator. The catalogue recognizes the original USGS filename and the loader's `native-network.json`; selected bytes are checked against the catalogue SHA256 before the model receives them. Choosing “Use the source edition’s retained network” preserves its existing companion.

The desk invokes the maintained `model.watershed_context.build_watershed_context` with the selected original network. A replacement network produces the model's new deterministic report identity. The report retains the exact original network, context and coverage bytes together; the source fingerprint and source-validation report identity reflect that same combined input cohort. Saved reports and exports remain inside the scientific Workspace for portable save and restore.

The report shows native source rows, covered model watersheds, domain exits and source cycles. Watershed detail separates the focal watershed's attributes from its upstream totals. Upstream totals exclude the focal watershed. Export upstream watersheds and Export downstream model watersheds use the existing saved-selection export operation. External downstream IDs remain visible as original IDs without an in-domain navigation action.

NRCS priority and selected SCDES classes retain separate filters. The regional watershed context is distinct from the four utility surface-water protection polygons used by the receiving-water workflow. Existing saved Lower Tugaloo selections, Show all watersheds, downloads and workspace switching are preserved.




## Receive a completed original regional run

Choose **Regional watersheds → Receive completed run** and select the original regional calculation ZIP. The shared upload transport retains the complete archive, and the `watershed.context.receive` task receives it into the selected project. When the operation completes, the desk opens the received regional report. The same saved reports, per-watershed detail, selection exports and downloads apply to received calculations.

The receiver reads the original run and source manifests, checks every declared output and original input, confirms the report's original source identities and whole-domain membership, and retains the original selected watershed separately. It copies the completed output bytes into the Workspace. The original model source, execution record, standard output and complete ZIP remain downloadable alongside the seven result files. Source selection, scientific calculation and original result identifiers are preserved.

The included completed run has identifier `watershed-4592eb077b7164d59ba4`. Its original result contains 217 watershed records, 240 state-specific NRCS rows, 15 priority watersheds represented by 18 state-specific priority rows, 1,886 classified-water records and the retained Lower Tugaloo selection `030601020507`. The original whole ZIP is 121,182 bytes with SHA256 `716ddaeb211536cc90590a003bffb0bd1b18386d92cf663649743d06970868b5`.

Receive that included result into an existing Workspace from the complete installed application:

    python -B source_tools/receive_watershed_context.py \\
      --workspace /path/to/existing/workspace \\
      --source-package source/water_context/20261013/completed-run.package.json

To receive an original ZIP directly, use `--archive /path/to/completed-run.zip` in place of `--source-package`; `--expected-sha256` can additionally pin the complete archive. The command prints the original result ID, complete summary, original selection and mounted operator record path. Repeating the receive verifies and reuses the same retained result.

The browser action uses the same receiver with the immutable upload's exact SHA256. A project change during upload prevents the operation from being queued to a different project. Interrupted receiving can resume matching retained files; the complete operator record is published after the output set is ready. The original Workspace capture lock serializes this publication with project backup, and all retained members travel with normal project backup and receiving.

### Original receiving files

- `watershed-context/REPORT_ID/receiving/original-native-result.zip`: complete original calculation ZIP.
- `watershed-context/REPORT_ID/receiving/run-receipt.json`: original command, source/output manifests, timestamps and result.
- `watershed-context/REPORT_ID/source/model/`: original calculation source.
- `watershed-context/REPORT_ID/source/source/water_context/20261013/`: original model input bytes.

The shared registry manifest declares the additional `watershed.context.receive` action and browser `uploadFile` capability. The standalone installer includes both source preparation and completed-result receiving modules. Original model outputs retain their own edition; the current installed model includes the author's clarified South Carolina selected-class labels for subsequent calculations.



## Completed connectivity alongside the retained original run

The completed regional archive remains result `watershed-4592eb077b7164d59ba4`.
When the application includes `outputs/watershed-connectivity-20261013/`, the receiver
also attaches that complete, source-bound connectivity edition to the same saved
report. Its original 217-row CSV, report, structured summary and manifest appear
in the ordinary downloads and travel with the original Workspace archive.

The receiver matches the connectivity edition to the original report ID and exact
report bytes, verifies each original connectivity file, and checks every focal
HUC12, area, priority flag and selected-class count against the retained regional
rows. The operator shows the three disjoint exit catchments and original source
scope under **Completed original connectivity analysis**. It preserves the
original native calculation record and its own source edition. The full graph
report explains focal, upstream and contributing measures; nested upstream sets
overlap, so combined selections use distinct watershed membership.

An additional retained graph edition can be selected explicitly with
`--connectivity-root /path/to/completed-connectivity` on the same receive command.
Repeating the receive attaches or reuses its identical companions under
`watershed-context/REPORT_ID/connectivity/`, after the same original result is
received. The default included edition carries the unchanged original CLOUD
files from F0C8NMPGQ78 and its source identities.



## Complete native network selections and export editions

The native network selector accepts the original plain JSON topology and the
retained `native-network.json.gz` or `model-domain.esri.json.gz` bodies.
Compression is detected from the actual bytes. Selection retains those same
bytes with the report, and the ordinary source importer preserves the matching
companion name. Choosing a different network replaces only the network companion
for that analysis; the original source edition stays retained.

Saved-selection CSVs use the maintained model's complete `HUC_COLUMNS` and
the same nested-network projection and spreadsheet-safe cell encoding as full
regional reports. The export identity includes the maintained csv_format, csv_columns and
brief_format, so older exports remain available and a current export receives its
own retained record. Original path links, upstream membership links, upstream
and downstream export controls, saved selection history, and the original
completed-run upload action share this one desk.

After a completed run is opened, its original selected watershed supplies the
initial detail when a saved browser detail is unavailable. For the included run,
this opens Lower Tugaloo while retaining all 217 regional rows.

The standalone installer also copies the complete original calculation package,
source inputs, available model/source guides and completed connectivity files
when they are present in the prepared source root. The source bank contains all
of those files; the receiving command therefore works from the installed
application root as shown above.


## Maintained native receiving and planning-brief integration

The upload action and source-package CLI call the existing
`operator/receive_watershed_context.py` adoption engine. Its direct CLI remains
available. The exact executed model inputs keep the canonical source fingerprint;
program snapshots and publisher companions retain their distinct inventories.
The adapter attaches completed connectivity after that same native adoption,
using the Workspace lock and the exact original report bytes. Reanalysis with the
same inputs preserves the existing supporting-source update behavior.

Current HTML and Markdown watershed planning briefs, the four-HUC RFP focus
export, complete native CSV serializer and `csv_format` / `csv_columns` /
`brief_format` cache identities remain intact. The complete source includes the
maintained `model/watershed_brief.py` and guide and the original operator receiver.
