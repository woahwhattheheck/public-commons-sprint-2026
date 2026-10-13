# Saved watershed planning brief

The existing watershed selection export can include a readable HTML and Markdown briefing alongside its retained JSON and CSV. Both views use the original selected-watersheds/v1 object and preserve each selected HUC12, its original state portions and NRCS status, legal source-class codes and query coverage, known original drainage connections, and source links.

## Existing operator integration

Import BRIEF_FORMAT and write_selection_brief from model.watershed_brief in the current watershed provider. Add brief_format: BRIEF_FORMAT to the existing export identity alongside its current csv_format and csv_columns. After the provider creates its source-bound selection object, call write_selection_brief(target, selection), then merge the returned filename-to-descriptor mapping into the existing result.files. The existing export reader and download tickets expose both files automatically.

Retain the current selection's report_id, report_sha256, export_id, source_fingerprint and source_inputs. The brief shows those identities when available. Keep the current saved-selection/history behavior and the shared model-column CSV writer.

Add model/watershed_brief.py to operator/install_watershed_context.py FILES so the same installed provider can import it. The standalone HTML uses semantic headings, column and row table headers, captions, source links and neutral print styling.

## Actual four-RFP-watershed selection

From the current application root, use the original retained watershed-context.json and the existing receiving output directory:

    python -B -m model.watershed_brief \
      --report /actual/workspace/watershed-context/REPORT_ID/watershed-context.json \
      --huc12 030601010703 \
      --huc12 030601010704 \
      --huc12 030601020502 \
      --huc12 030601020507 \
      --output-dir /actual/receiving/watershed-rfp-focus

These are Upper Six And Twenty Creek, Lower Six And Twenty Creek, Choestoea Creek and Lower Tugaloo River. The original model's selected_watershed_export supplies the selected rows and quantities. The briefing renderer formats that retained result.

A previously saved selection uses:

    python -B -m model.watershed_brief \
      --selection /actual/workspace/watershed-context-exports/EXPORT_ID/selected-watersheds.json \
      --output-dir /actual/receiving/watershed-selection

The JSON written to stdout contains the original input-file SHA256, context identity, selected HUC12s, retained summary and both output file descriptors. The HTML's print stylesheet supports the current installed browser/PDF export path.

## Quantity interpretation

Whole-watershed area counts each HUC12 once. Original NRCS state portions and their statuses remain separate records, including cross-state watersheds. The briefing retains the model's interpretation of rounding and vintage differences.

Selected-class records use the source publisher's HUC12 attributes and the original complete-query coverage. Original ToHUC upstream quantities apply separately to each focal watershed; shared ancestors are visible in each watershed's own context. The native model's geometry, role and source-method explanations remain in the brief.

## Module API

- render_selection_brief(selection) returns Markdown.
- render_selection_html(selection) returns a complete accessible HTML document.
- write_selection_brief(directory, selection) writes watershed-selection-brief.md and watershed-selection-brief.html and returns the existing operator's relative filename/file-descriptor mapping.


## Distinct contributing membership (brief v3)

Selections with retained native upstream membership now include a contributing-area union. The implementation joins every member to the full original regional report and calls the native model's summary function on distinct rows. Each focal watershed keeps its individual contributing set. The union counts a shared HUC once and retains the repeated memberships separately.

The original completed connectivity output can enrich its exact original report without rerunning the network analysis:

    python -B -m model.watershed_brief \
      --report /actual/receiving/watershed-context.json \
      --connectivity-csv outputs/watershed-connectivity-20261013/watershed-connectivity-217.csv \
      --connectivity-summary outputs/watershed-connectivity-20261013/watershed-connectivity-summary.json \
      --huc12 030601010703 --huc12 030601010704 \
      --huc12 030601020502 --huc12 030601020507 \
      --output-dir /actual/receiving/watershed-rfp-focus

Both connectivity arguments are required together. The summary must identify the original report ID and exact report-file SHA256. The loader checks all domain IDs, focal attributes, ancestor membership and contributing totals against the retained report. It preserves the source-file hashes and original USGS source references.

The original completed four-focus case has 36 distinct contributing HUC12s, 739,086.63 acres, three NRCS priority HUCs and 1,002 selected-class records (879 ORW, 71 TN and 52 TPGT). Its individual contributing areas sum to 782,778.80 acres; Upper Six And Twenty Creek and Choestoea Creek account for 43,692.17 acres of repeated membership. These are drainage membership quantities. Source classifications retain their publisher-assigned HUC12 and named-reach scope. Expert interpretation uses the cited classification regulations and the exact source reaches.

The current installer already retains the completed connectivity CSV and summary. The provider first uses native report membership; otherwise, it uses those installed outputs only when their report ID and SHA256 match the selected report. Other reports keep their original focal brief. Each union export includes:

- The original selected-watersheds.json and selected-watersheds.csv with focal membership unchanged.
- The contributing_context object retained in the selected JSON, with distinct member rows, each focal set, the native summaries, repeated memberships and original source identities.
- watershed-selection-brief.html and watershed-selection-brief.md, with the union, per-focal areas, priority names and expanded source-class labels.
- watershed-contributing-hucs.csv, with one row per distinct contributing HUC, original area and priority fields, class counts, focal membership and the selected-HUC flag.

The provider includes both brief_format v3 and a digest of the retained contributing context in the export identity. Reopening an existing export continues to return its original files. A saved enriched selection renders independently of the live report and connectivity files.

### Additional module API

- load_completed_connectivity(report, report_sha256, csv_path, summary_path) returns original upstream membership and bound source metadata.
- add_contributing_context(selection, report, upstream_by_huc=None, source=None) returns the selection with its union when membership is available.
- selection_with_contributing_context(report, selected_huc12s, report_sha256, completed_directory=None) provides the operator's native-or-bound-completed result path.
- write_selection_brief also returns the contributing CSV descriptor when the saved selection retains a union.

Brief v3 preserves the final application revision2's supporting_source_references and brief_source_sha256. The contributing-context digest is an additional identity component; it retains the original supporting-source downloads, chosen native-network provenance, source feature labels and completed report receiver.


## Utility contributing-watershed selections

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


## Observed utility source context, brief v5

Brief edition v5 retains the original planning, programme, classification and
native-network sections and adds an optional source-bound observation section.
model.utility_observed_context.load_for_utility validates the original source
manifest, all declared member bytes, original utility-profile hash and exact
selected HUC12s before supplying this section. Its binding enters the saved export
identity independently of the parent regional context ID.

The microbial section retains original concentration units, detection states,
field replicate and source comments. Calendar-year tables report active station
sets, actual sample dates and observed months. Per-station coverage and complete
method-specific numeric/censored tables are exported with the original records.
Original numeric medians represent their exact retained sample groups.

The regional stream section retains the actual station relation to each utility
selection, the original gauge network relation and existing high-flow coverage.
It carries constituent, fraction, analytical method, original units and temporal
support in the complete JSON and CSVs. Source nutrient concentrations and native
annual land-origin N/P/sediment mass retain their own quantities.

The HTML renderer now recognizes the saved observed-sources relative links as
well as original publisher URLs. All source members have ordinary path/bytes/SHA256
descriptors in export.json; an exported report can open them offline. The native
report writer remains a standard-library implementation.

A single `utility-watershed-packet.zip` download carries the verified saved file
inventory at its original relative paths, including the brief, selected data,
original profile and observation sources. Extract the ZIP and open
`watershed-selection-brief.html`; its local source links resolve within the packet.
The archive includes `packet.json` with each carried file identity. The native
utility receiver writes the same complete packet for each utility selection.
