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
| Receive a completed original run | watershed.context.receive task | Original archive, native input aliases, report and connectivity downloads |
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
published Georgia 38,264.29-acre and South Carolina
21,425.43-acre portions.

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


## Complete imported source entries

When the selected context is an imported Workspace source, the report retains
its primary document and every companion listed in that entry. Their native
`view_path` directories stay together. The current regional entry therefore
keeps the raw NRCS/classified-water material under `20261012/` alongside the
context, coverage and topology under `20261013/`.

Each complete entry is retained under
`source/entries/ENTRY_FINGERPRINT/` inside the saved report. That folder contains
the original native members, a portable `_source-entry-manifest.json`, the exact
original import manifest, and a source-entry record. The portable manifest uses
the ordinary `upstate.sources/v1` contract and can be imported with
`Workspace.import_sources` from that retained directory.

The calculation fingerprint continues to bind only the loader's original model
inputs. The provider checks that capturing the complete context entry leaves
that fingerprint unchanged. An independently selected imported network retains
its own complete entry, while the active model-input inventory identifies the
network actually used. A network already contained in the context entry remains
part of that original entry even when an explicit alternative is selected.

A separate complete-edition manifest binds the active context/network entries,
the calculation fingerprint and the retained supporting-original inventory.
It is saved under `source/editions/EDITION_FINGERPRINT.json`. Its normal file
descriptor, every source member and the portable entry manifests appear in the
existing report downloads and Workspace archive.

Rebuilding from the same model inputs can add another complete source edition
to the same calculated report. Earlier editions remain retained. Each new
selection export binds its complete-edition fingerprint in addition to the
existing report, CSV and planning-brief identities. Reopening an earlier saved
selection retains that selection's original source-edition binding.

Paths in a saved selection's source-edition reference are relative to its parent
report directory, identified by `source_edition_report_id` and the explicit
`source_edition_path_basis`. Selection JSON, CSV and briefs remain compact
report-derived exports. Transfer the full source edition with the parent report
through the ordinary Workspace archive; its entry manifests and native members
are registered in that report's downloads.

Directly registered source directories retain the model inputs and supplied
publisher companions checked by the maintained source loader. To retain a
larger entry with companions in several directories, import its original source
manifest into the Workspace and select that imported entry in the desk.

Acreage displayed in these instructions is rounded to two decimals; original JSON and CSV retain their published precision.


## Selected network originals and source-linked planning briefs

An explicit network choice carries the selected topology and its checked source
companions into the regional report. The maintained loader accepts nested
original paths and validates each declared member against the retained bytes.
When a different network is chosen, its source metadata replaces the active
network metadata; the context, classification and NRCS originals keep their
existing roles. The complete imported context entry remains retained, and a
separately imported network keeps its own portable entry.

A `native-network-source.json` companion can bind an original publisher URI to
the exact topology bytes. The loader checks the source member, byte count and
SHA256 before exposing that URI in selection JSON and the HTML/Markdown planning
briefs. These references carry the topology and provenance hashes so the saved
brief identifies the network edition used for that selection. The calculation
fingerprint continues to describe only the model inputs.

Planning briefs use the maintained version 3 format, including contributing watershed membership and source references. A changed
source reference creates a new export identity along with the existing report,
CSV, brief-format and complete-source-edition identities. Earlier exports retain
their original source binding. Reopening an export also checks its retained
parent report bytes.


### Receive the current network edition through the operator

The complete HTTP receiving workflow can use the current canonical source
manifest explicitly:

    python integration/run_watershed_context_operator.py \
      --application /absolute/current/application \
      --source-dir /absolute/current/application/source/water_context/20261013 \
      --source-manifest /absolute/current/application/source/water_context/sources-20261013.json \
      --output /absolute/new/receiving-directory

Use a new output directory. The workflow receives the original completed result,
reopens it through the maintained CLI, analyzes the registered source edition,
imports the selected context entry, exports its watershed selection and planning
brief, and restores the normal Workspace archive. It compares the original
output bytes and the actual retained source identities across these operations.
Its complete instructions are in `integration/WATERSHED_CONTEXT_RECEIVING.md`.

The historical `20261013/complete-sources.json` describes its original source
edition. The explicit parent manifest above selects the current context entry
with the native network and its cross-date companions. Before import, the source
loader checks that the selected entry supplies the same named calculation inputs,
byte counts and hashes as the registered directory; after import it checks the
reconstructed Workspace view again. The importer returns the exact source ID
alongside the collection ID, so the NRCS entry in the same manifest is never
mistaken for the regional context.

For direct Python use,
`import_source_edition(workspace, directory, source_manifest=manifest_path)`
selects this same manifest. The source preparer's CLI retains its existing
arguments.


The standalone installer also copies each available canonical or historical
source manifest and all of its declared primary documents and companions. It
checks their declared byte counts and hashes and preserves the original dated
directories. Both manifest editions remain separate; the explicit manifest
argument above chooses the network edition for the receiving workflow.


## Distinct contributing watershed selections

Saved selections now keep a distinct union of the focal watersheds and their
known upstream model-domain members when original connectivity is available.
The brief shows each focal contributing set, the distinct combined area, shared
memberships, priority watershed names and expanded publisher class labels.
The original focal JSON and CSV retain their selected membership. An additional
`watershed-contributing-hucs.csv` lists each distinct contributing HUC once.

The provider uses the report's own native network membership first. For the
original completed regional result, it can use the included completed
connectivity CSV and summary after checking the exact report ID and report-file
hash. Its contributing-context digest participates in the saved export identity
alongside the full source edition and byte-bound publisher references. The
complete standalone briefing command is in `model/WATERSHED_BRIEF.md`.

The installer also retains the additive `complete-native-sources.json` edition
when supplied. The historical `complete-sources.json`, the separate native
manifest and the canonical parent import manifest keep their original bytes
and paths.


## Save the complete contributing footprint of a utility

The Regional watersheds desk now reads the original retained
`source/receptor-topology/20261013/utility-focus-profile.json` alongside
the saved regional report. Each utility choice joins its original focus
anchors to the complete native HUC12/ToHUC network in that report. It saves
the distinct upstream model-domain HUC12s and anchors as one original
selection. The existing four-anchor export remains separately labelled.

For the retained source edition, ARJWS selects four HUC12s and Pioneer
(PRWD) selects 32. Their actual HUC12 sets are disjoint. The reusable
selection logic traverses the supplied native links; it does not assume
those counts or determine drainage from HUC prefixes. Known upstream
source HUCs outside the selected model domain remain explicitly listed.
A report built without its native network provides an explanation and the
existing source/network build controls.

The selection keeps three distinct areas: original whole-HUC planning
units, published intake-protection polygons, and the retained native
reporting mask. NRCS `huc12_ac` counts each selected watershed once;
`st_ac` counts each original state–HUC portion once. USGS published
`areasqkm` remains in the original topology source and is not substituted
for NRCS acreage-derived report area.

`Ground`, `Surface` and `Both` retain their original NRCS programme
labels. The designated state-portion table reports each label separately
and preserves unknown source acreage. The source labels describe programme
context, not measured intake quality or InVEST subsurface coefficients.
SCDES counts retain their publisher-HUC assignment and SC jurisdiction.

Saving uses the existing `watershed.context.export` action with the
actual `report_id` and the displayed `utility_key`. The server reloads
the original profile and derives the same membership from the saved
report before exporting. The utility key includes the complete report,
profile byte identity, source anchors, membership, original state rows and
programme summaries. A changed profile creates another selection.

The saved export includes:

- The original utility profile bytes and their declared SHA-256.
- Complete selected-watershed JSON and per-HUC CSV.
- `utility-watershed-memberships.csv`, with original HUC12/ToHUC text,
  utility/receptor identity, anchor flag, whole-HUC acres, state labels and
  source/report identity for a direct GIS attribute join.
- `selected-watershed-state-records.csv`, preserving every original
  source field on its state–HUC row.
- `selected-programme-designations.csv`, with original labels, designated
  acreage, known acreage and missing-area counts.
- HTML and Markdown briefs with the utility footprint, anchor IDs,
  designated programme areas, source jurisdiction, membership and references.
- The original contributing-context CSV, when present.

Reopen the saved utility selection from the desk's existing selection
list. The selection keeps the same parent report and verified original
file downloads. Brief format v4 produces a new export identity; earlier
saved v3 exports retain their original files.

The scientific unit interpretation remains unchanged: InVEST 3.20 native
N/P export rates are kg/ha/year and sediment export rates are metric
tonnes/ha/year. Native cell mass uses the actual cell hectares once;
reporting overlaps and paired finite support retain the original model
calculation. The utility source selection itself computes no pollutant load.

See the [complete original two-utility source study](../source/utility-source-context/20261013/README.md)
for the independently traversed source records and runnable Node source join.


## Original utility observations in the saved report

When the complete utility_observed_context.sources.json edition is installed,
each original utility card also displays the original E. coli records, stations,
sample dates and Information Only count. The same Save and export action binds
the source edition to the utility profile and exact selected HUC12 membership.

The saved brief includes station/year coverage, original microbial detection
states, station geography and the separately located regional nutrient/flow
context. Its complete source HTML and flat station/year/method CSV expose numeric
summaries beside original censored counts and explicit comment-filter alternatives.
Regional Eighteenmile stations retain their own source geometry and gauge relation.
They appear as regional context alongside the utility-specific microbial cohort.

All original input tables and metadata are copied into the existing saved export
under observed-sources. The ordinary file transport verifies these members, and
the offline brief links to them by relative path. The observed source binding
participates in the export identity; older saved selections retain their original
files and can still reopen.

The native receiver source_tools/receive_utility_source_context.py performs the
same optional original-source binding and export. Keep the application checkout
fixed during that run and return its actual receiving.json from the existing
receiving operation.

The reusable source compiler is source_tools/build_utility_observed_context.mjs.
Its complete method/source guide is source/utility-observed-context/20261013/README.md.

A single `utility-watershed-packet.zip` download carries the verified saved file
inventory at its original relative paths, including the brief, selected data,
original profile and observation sources. Extract the ZIP and open
`watershed-selection-brief.html`; its local source links resolve within the packet.
The archive includes `packet.json` with each carried file identity. The native
utility receiver writes the same complete packet for each utility selection.

## Present the original selection and continue the review

Each new saved selection export includes a source-context report/model and an offline briefing/page index, alongside its original watershed brief and complete observation files. Open source-context-report-briefing.html from the extracted utility-watershed-packet.zip to choose an agenda, inspect exact source tables and export actual meeting notes. The Implementation desk's saved-report chooser can receive that same source export and notes as editable, source-linked follow-up. The original scientific interpretation, units, methods, HUC membership and source jurisdiction remain in every report. [Utility source briefing](../docs/UTILITY_SOURCE_BRIEFING.md) gives the complete route through native report, Transfer and independent reopening.


## Observed land cover and original station context in saved selections

The existing Regional watersheds export can include the retained 2023 and 2025
annual land-cover classification comparison beside South Carolina's 2026 draft
assessment context and original dated station/gauge point membership. The choice
uses the installed, verified `landcover_observation_profiles.sources.json`
edition. Its complete source files and original companions travel with the saved
selection.

1. Open the current saved regional report. The **Observed land cover and station
   context** section identifies the source years, assessment edition, geographic
   support and exact selected source manifest.
2. Leave **Include the retained observed evidence in the next selection export**
   checked, or clear it for a planning-only export. The choice applies to matching
   watersheds, one watershed, the four RFP anchors, network selections and utility
   contributing watersheds through their existing export buttons.
3. Export the desired membership. The ordinary task history records the
   operation. When that task completes, the desk opens its new saved selection.
   A pending export remains associated with its original project during a browser
   session reload.
4. Review **Saved observed evidence**. Selected watersheds and their distinct
   contributing-watershed union have separate summaries and group balances.
   Areas are hectares under the original native-cell centre support. Gross
   gains/losses represent crossings between the original land-cover groups; net
   change is the difference between their two annual areas.
5. Open the existing HTML brief or download the complete saved source files and
   packet. Reopen the same saved selection after changing a filter, refreshing,
   or restoring the project. Its evidence comes from that saved export and
   retains its original source identity.

The live source choice is optional. An application without this source can still
export its original planning selection. A requested source that changes between
display and export requires a refresh before another evidence export. Reopening
a saved selection does not substitute the newly installed source for its saved
bytes.

### Original quantities and geographic scope

Assessment stations and observed-flow gauges are counts of original local point
identities in the selected HUC12 polygons. They are not counts of all upstream
monitoring and do not define a sampled drainage area. Retained NLDI basins,
native network membership and the source's original coordinates supply their
own geographic context. Original coordinate alternatives remain distinct source
rows while identity counts follow the source's stated deduplication rule.

South Carolina draft assessment cause codes retain that edition and jurisdiction.
An unrepresented cause or station does not establish attainment or absence of
monitoring. Developed land-cover classes include vegetated open space; their
change is not an impervious-surface calculation or a measured pollutant-load
change. Classification years, the draft assessment edition and the point-query
date are separate source periods.

### Existing API contract

`GET /api/watershed-context/report` supplies `_evidence_profiles`, either
`null` or a validated `upstate.watershed-observation-choice/v1` object.
The current browser sends the following additional fields on the existing
`watershed.context.export` action:

```json
{
  "include_evidence": true,
  "evidence_profile_sha256": "the exact displayed 64-character manifest SHA-256"
}
```

The original `report_id`, `huc12s` and optional `utility_key` remain
unchanged. A false or omitted flag keeps the original planning-only behavior.
The completed export record exposes `landcover_observation_context`; its
`source`, `selected` and optional `contributing_union` fields drive the
saved display. The complete selected profiles, location rows and source bindings
remain in `selected-watersheds.json` and the original file inventory. The
existing download tickets and project archive carry those same members.

## Inspect the rendered outgoing watershed product

Bryce's standing instruction applies to every local or cloud producer and
receiving peer: before describing a client-facing desk, demo, report or export as
ready, open the exact outgoing version, look at its actual rendered screen or
screenshots, and operate the important controls. Source review, HTTP responses,
DOM counts and automated checks do not establish its visual usability. Carry
this instruction into delegated receiving work and the current owner-controlled
guides and instruction files those peers actually read.

Use the populated original project for the final Regional watersheds inspection.
At the intended screenshare width and a narrow/mobile width, view the source
choice, watershed table, filters, detail, utility selection, task progress and
saved export. Inspect the optional-source-empty and actual loading/error displays
when those states occur in the receiving course. Exercise the evidence checkbox,
selection/export controls, download links and reopening of the saved selection.
The selected and contributing-union summaries must remain clearly distinguished;
group labels, hectares, source periods and saved source identity must be readable.

Open the outgoing HTML brief and the HTML briefing extracted from the downloaded
packet. View any supplied PDF at normal reading scale. Inspect the actual restored
project and its saved downloads as well as the producing project. Fix clipping,
overflow, unreadable tables, broken links, cramped controls or confusing labels
in the maintained implementation before presenting the product.

Keep the industrial software design: clear hierarchy, readable tables, consistent
type and spacing, restrained controls and responsive layouts. Record the actual
version, original project/export identity, viewed widths and material repairs in
the existing receiving handoff. Keep this inspection within the real product
course; create no separate validation application or broad test suite.

Instruction source: [Bryce's rendered-product direction, relayed to the Ecosystem
owners](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791881463183449).

## Install the observed-evidence continuation in an existing application

Run the prepared continuation's own installer against the retained application:

```sh
python -B PREPARED_SOURCE/operator/install_watershed_context.py --application ACTUAL_APP --source-root PREPARED_SOURCE
```

The prepared source supplies changed files; unchanged required files come from the actual installed application. Every selected Python/JSON file is parsed before replacement, and the original transaction retains its backup and rollback behavior. Preserve any newer maintained source when composing this continuation.

The observed-evidence fragment declares the root `landcover_observation_profiles.sources.json`. Include that exact manifest and every primary/companion it names: four profile outputs plus ten distinct original input/replay members. The source edition contains fourteen physical members in total, plus its root manifest. The installer resolves those members from the prepared source or installed application and verifies their original byte counts and hashes before writing. A scientific-report-only source package does not necessarily contain this root profile manifest.

The consumer fragment follows that direct source manifest. It does not require installation of the raster/WBD producer components to consume the already-completed profile edition. Full current application exports retain their original producer components through their own declarations.

After installation, reopen the original operator with the current application, confirm Regional Watersheds extension version 1.7.0, and follow the populated visual/interactive inspection above. At a narrow viewport, operate the ordinary-sized evidence checkbox and expand both source-identity details; the complete source identifiers must wrap within the desk. Then run the same existing-workspace receiving course with `--include-observed-evidence`.

## Original watershed map and portable geographic selections

The Regional Watersheds desk uses the maintained Water Context map renderer with
the original 217 profile polygons. All 273,049 original vertices remain in
EPSG:3857. The map offers the seven source themes and every other numeric profile
field, for 29 choices, with the source's own units and interpretation. Grayscale
ranges stay fixed to the full source edition as the selection changes.

Table filters initially select their matching watersheds. Clicking a polygon
starts a picked selection and opens its original attributes; subsequent clicks
add or remove polygons. **Use matching table watersheds** restores the table
scope. **Fit selected and upstream** frames the selected polygons and their
distinct contributing union. Selected boundaries are solid, additional upstream
contributors are dashed, and the other original model watersheds remain visible.
The union comes from the saved report's retained original network or its exactly
bound completed connectivity edition.

The map inclusion checkbox controls whether the current export retains its
geography. **Export map selection** uses the same export operation as the other
Regional Watersheds selections. The output includes complete selected polygons,
the unique contributing polygons, the full original map, its original Esri
geometry, profile CSV, field meanings and executable rebuild sources. The saved
map context binds the actual map manifest, polygon and profile identities.
Map-only exports retain the profile attributes embedded in the original map;
the observed-evidence checkbox separately adds its full annual/station context.

Reopening a saved export uses that export's retained map source even if the
currently installed map edition has changed. Editing and re-exporting its picked
scope uses the same retained edition. With both evidence and map included, the
operator requires the same original profile and domain identities.

### Source installation and transfer

The existing installer includes the map helper and shared browser renderer. It
reads the complete original
`observations/watershed_profile_overlay_20261013/model-sources.json` edition
through the same source-manifest resolver. Selected application assemblies
declare this source through
`integration/component_fragments/watershed-geographic-selection.json`.

Exports retain the original directory structure beneath
`watershed-map-sources/observations/`. The sibling
`landcover_observation_profiles_20261013/profiles_core.mjs` parser is bound to
the original overlay recipe so its existing rebuild command works after transfer:

```sh
node RETAINED_EXPORT/watershed-map-sources/observations/watershed_profile_overlay_20261013/rebuild.mjs \
  --source-dir RETAINED_EXPORT/watershed-map-sources/observations/watershed_profile_overlay_20261013 \
  --output NEW_OWNED_OUTPUT/watershed-profiles.geojson
```

The existing native receiving driver accepts `--include-original-map` alongside
`--workspace` and `--include-observed-evidence`. It downloads the original map
through the application's normal file ticket, exports the selected and unique
contributing polygons, compares every complete feature against the original,
transfers the same Workspace, and reopens the saved map from its retained source.

### Inspect the actual populated map

Open the original 217-watershed report in the running application. Inspect normal
and narrow widths, the actual numeric selector, its values and units, and the
visible selected/upstream legend. Change among a percentage, a signed net-change
field and a local station-count field. Confirm that real zero and negative values
remain distinguishable and that the scale remains stable when changing scope.
Operate pan, zoom, fit, polygon click and keyboard selection; refresh the report
and confirm that a picked selection survives an ordinary task refresh.

Use the two ARJWS anchor HUCs `030601010703` and `030601010704` for a concrete
scope inspection: two selected polygons and four distinct contributing polygons.
The PRWD anchors `030601020502` and `030601020507` give two selected and 32
distinct contributing polygons. Open the saved export and its original geometry
downloads, then reopen the transferred Workspace and operate that same map.
Inspect the exact outgoing brief HTML/PDF and source downloads before delivery.
