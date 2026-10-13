# Scientific delivery report

The scientific report presents current physical exports, native scenario changes,
profile settings and original biophysical coefficients, receiving-water quantities and observation comparisons as
readable tables. PDF, offline HTML and Markdown share the same ordered report blocks.
The structured report companion retains those exact blocks, full source editions
and the selected original record IDs.

## Scientific data contract

The formatter consumes the existing completed Workspace records. It does not
calculate new model results or choose scenarios.

- Current quantities use each original artifact's sum, sum_units, valid_cells and
  pixel_area_ha. Nitrogen and phosphorus totals are kg/year; sediment totals are
  metric tonnes/year. The table reports the corresponding valid-cell support.
- Scenario changes use comparison.alternatives[].artifacts[pollutant].sum_change.
  This is the original alternative-minus-baseline sum over paired valid pixels.
  The displayed paired count comes from the same artifact. Full baseline and
  alternative totals with different footprints are never subtracted.
- A zero or absent valid-cell count produces an unavailable quantity. The native
  difference accumulator can equal zero when no cells are shared; that state is
  distinct from a supported zero net change.
- Original land-cover patches and native stages.landcover.edits appear together.
  Planned source masks and code changes retain their reasons; patch-cell and
  patch-hectare counts come from the completed native stage in declared order.
  When a destination code is also in from_codes, the original native counter can
  include cells already at that destination. Overlapping patches can recount a
  cell. These counters are therefore not labeled as the final net changed area.
- Observation metrics retain n, unique catchments, original annual periods,
  physical-unit RMSE and model-minus-observed bias. NSE remains dimensionless.
  All selected per-catchment comparisons retain observed, modeled and residual
  values plus their coverage status. Repeated source periods keep their original
  descriptive interpretation. A separate coverage table retains actual export cells,
  structural stream omissions, unexpected missing cells, outside-raster area and
  original coverage findings. Original annual-reference values, source units,
  row-specific methods, qualifiers, uncertainty and references remain visible.
- Receiving-water rows retain their exact contribution relationship, geographic
  area, quantity scope, source designation, paired support and positive increase
  and avoided-export components. Per-receptor overlap is explained alongside
  the quantities. Native family_union baseline and alternative totals appear as
  unduplicated tables using families[family].baseline_physical and
  families[family].alternatives[run_id].metrics; receptors are never summed to
  manufacture these totals. Different families can overlap. The original
  change-statistic sum_basis remains visible: net changes sum the stored Float32
  difference pixels, while increased and avoided components retain native
  Float64 paired-difference sums. Their small rounding differences are preserved.

The pinned [InVEST 3.20 NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)
defines the native export rasters in kg/hectare/year. The pinned
[SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)
defines sediment export density in metric tons/hectare/year. The existing native
adapter multiplies those rates by actual pixel area once. This formatter consumes
its retained mass artifacts and preserves their units.

## Original biophysical coefficients

Edition v6 reads the saved profile's original CSV through Workspace.source_file,
then checks its exact body SHA256 against profile.table_summary.sha256. It uses
profiles.inspect_table with the saved profile's selected native models, preserving
the native validation and the source row order. table_summary.rows is a count;
the report obtains actual coefficients from the original CSV.

The selected-profile section includes the profile ID, selected models, source
collection and source ID, original edition/reference/filename/hash, and complete
row/column counts. Separate nitrogen, phosphorus and sediment tables preserve
original source strings and every land-cover code. Nitrogen and phosphorus loads
retain their per-row load_type_n/load_type_p choices. Additional original fields,
including land-cover descriptions and source citations, appear in a separate
three-column table. No coefficient row is truncated or sampled.

The pinned NDR definitions label loads as kg/ha/year, critical lengths as metres,
and efficiencies/subsurface shares as fractions. The original application-rate
value stays visible; the report explains the native load * (1 - eff) adjustment
and the direct measured-runoff interpretation without recomputing results. SDR C
and P are dimensionless. The l_max algorithm setting is the maximum dimensionless
USLE L factor, corrected from the earlier metre label.

Normalization tables also display the original recorded cap units, reference,
scope and comparison description when the retained priority record supplies them.

The public refine_sections interface is unchanged. The formatter already receives
workspace and profile; v6 reads the profile's exact original table internally.
The existing delivery REPORT_VERSION binding gives the v6 report a distinct
edition while earlier complete reports remain reproducible.

## Original economic links and Markdown companion

The complete edition also preserves the original client-report formatter's
relative-file link blocks in PDF and HTML and its full Markdown report companion.
The combined source retains _relative_link, _markdown_report and the existing
report_markdown descriptor. A links block contains items with title and path;
paths remain inside the delivered package. The original economic adapter supplies
those blocks and its selected-zone values. Coefficient rendering leaves that
content and every independently installed report section intact.

## Integrate in the maintained delivery

The formatter is model/scientific_report.py. The maintained delivery integration
is tracked in [PR 2737](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2737).
Updating an application that already has that integration requires only this
module and guide; all public call signatures are unchanged. The hooks below
describe the existing integration for receiving an earlier application. Preserve
its receiving-water pipeline and other installed sections.

Add the module import:

    from . import scientific_report

Include the formatter edition in the delivery identity alongside the existing map
renderer version:

    "report_renderer": scientific_report.REPORT_VERSION,

After the existing sections have been assembled, refine them using the original
records already bound by the delivery:

    sections = scientific_report.refine_sections(
        sections,
        workspace=workspace,
        baseline=baseline,
        alternatives=alternatives,
        comparison=comparison,
        profile=profile,
        grid=grid,
        priority=state["priority"],
        observation_results=observation_results,
        receptor_inventory=state.get("receptor_inventory"),
    )

This preserves every unrecognized section, including independently installed
scientific sections. A section is an ordered pair of heading and blocks. Blocks
can be ordinary strings or dictionaries with kind=table, columns, rows, optional
relative widths, and optional caption.

For the selected receiving-water product returned by the existing
receiving_water_delivery.collect operation, append the maintained readable
receiving-water section exactly once:

    sections.extend(scientific_report.receiving_sections(water_product))

Use this section in place of the older receiving_water_delivery.report_section
JSON paragraphs. Keep the existing collect, attach_state, apply_map_specs and
extend_assets hooks so original physical layers and complete GIS records travel
with the same report.

Render the original report path with the table-aware renderer:

    scientific_report.report_pdf(
        target,
        selection.get("title", workspace.project["title"]),
        sections,
        contact=contact,
        source_records=records,
    )

Retain the offline companions before saving the report state:

    state["files"].update(scientific_report.write_companions(
        directory,
        selection.get("title", workspace.project["title"]),
        sections,
        contact=contact,
        source_records=records,
        binding={
            "baseline_run_id": baseline["id"],
            "scenario_run_ids": scenario_ids,
            "profile_id": profile["id"],
            "grid_id": grid["id"],
            "comparison_id": comparison["id"],
            "observation_comparison_ids": selection.get("observation_comparison_ids", []),
        },
    ))

The returned descriptor keys are report_html, report_markdown and report_data. Include their
original paths in manifest.project_assets before packaging:

    manifest["project_assets"].extend(
        state["files"][name]["path"]
        for name in ("report_html", "report_markdown", "report_data")
    )

The original PDF descriptor remains state.files.report. All four artifacts use
the same selected records and report blocks. Including REPORT_VERSION in the
delivery identity lets previous complete deliveries retain their original report
bytes while new deliveries use the updated format.

## Open, print and reopen

report.pdf uses the existing ReportLab dependency, repeating table headers and
page-aware rows. report.html is self-contained, has a linked section index,
supports narrow screens and prints with repeating table headers. It requires no
network or browser script. report-data.json retains the displayed section
structure and full selection/source binding. All four belong in the original
delivery archive and normal authenticated file inventory.

Receive this module in the complete application, compose the hooks above, and
open the current completed native delivery through the existing operator.
Inspect its PDF and offline HTML scenario-change tables, receive the full archive,
then reopen the same Workspace and report IDs. The actual native rendering and
reopening operation uses the existing completed model outputs.
