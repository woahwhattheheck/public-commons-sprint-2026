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

The coefficient addition from edition v5 reads the saved profile's original CSV through Workspace.source_file,
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
workspace and profile; edition v6 retains the complete original table and composes
the economic link and Markdown additions onto those coefficient tables.
The existing delivery REPORT_VERSION binding gives this combined v6 report a distinct
edition while earlier complete reports remain reproducible.

## Integrate in the maintained delivery

Receive the current complete application through its existing cumulative receiving
operation. The scientific report now depends on the maintained delivery builder,
observed-source collector and figure renderer, annual-comparison diagnostics,
economic collector, client companion, archive capture and ordinary operator
preview controls. The application catalogue and its dependency closure retain
these modules together. Use `integration/application_components.json` with the
current source assembler and installer; carry the whole selected application
edition into the existing Workspace operation.

Updating only an old formatter and its guide is insufficient for the current
report. Earlier integration examples belonged to their original editions. The
current delivery already contains the calls below; preserve those maintained
calls when composing another component, and apply source changes to their current
implementations.

The maintained flow is:

1. Validate the original baseline, ordered alternatives, selected grid/profile,
   delivery mode, source selections and optional economic/native report bindings.
   Bind the selected observed-context source before computing delivery identity.
   Scientific renderer, client companion and application editions remain explicit.
2. Collect receiving-water quantities and their original map/source assets once.
   Collect the selected observed report, all source companions, concentration
   support and original figure specifications. Verify their saved binding before
   adding them to the report and retained file inventory.
3. Refine the existing ordered scientific sections with
   `scientific_report.refine_sections`. This reads the original biophysical CSV,
   completed native quantities and original annual comparison rows. The current
   `model/observation_diagnostics.py` reader adds exact-period and catchment-weight
   tables from those comparison rows. Append the maintained receiving-water and
   selected source/economic sections through their existing collectors.
4. Write `report.pdf`, `report.html`, `report.md` and `report-data.json` from the
   same ordered scientific blocks. Write the separate `client-report.*`
   companion through its maintained compiler. Register every returned descriptor
   and selected source/analysis asset in the existing delivery state.
5. Build the final offline atlas and `delivery.json` from that complete inventory.
   Their working-project links use the fixed package-relative
   `working/scientific-workspace.zip` path. Capture the final report, atlas,
   manifest and source descriptors in that scientific Workspace archive.
6. Verify the actual retained working archive, then build the complete delivery
   package. The receiver restores the original project, native records and
   captured delivery files through the existing portable Workspace operation.

This order keeps the original reports and navigation in the editable project.
The archive is retained beside its received files without requiring the ZIP to
contain its own checksum. A prior archive with different selected assets remains
retained as an earlier capture.

The report block contract remains ordered heading/block pairs. Table blocks have
`kind=table`, `columns`, `rows`, optional relative `widths` and a `caption`.
Link blocks retain package-relative files or supported original publisher links.
Figure blocks retain the complete original numeric specification and verified
SVG descriptor. The PDF, HTML, Markdown and data writers consume those same
blocks; the normal delivery stores their descriptor keys as `report`,
`report_html`, `report_markdown` and `report_data`.

For the operator's complete selection and archive controls, use
[Client report and selected-zone economics](CLIENT_REPORT.md).
For annual-reference weighting, original cohort membership and JSON export, use
[Annual-load comparison review](OBSERVATION_DIAGNOSTICS.md).
For received projects and retained original versus derived navigation, use
[Reopen a scientific delivery](RECEIVED_DELIVERY_NAVIGATION.md).

## Revising an original native-study delivery

Use **Revise delivery choices** from the existing delivery. The form displays the
retained study title, purpose and reference and carries the same
`delivery_mode: native_study` and `native_study` metadata into the new selection.
Its original native baseline, alternatives, attached analysis, saved report and
economic edition remain connected through their existing selectors and bindings.

Regional supporting sources and source-water overlays are optional for this mode.
An existing selected source stays selected; disabling one removes only that
optional selection. Native-study contact metadata can be left empty. The regional
delivery form continues to require its regional source editions, water-designation
overlays and contact fields. Both modes use the existing completed NDR and SDR
cohort contract.

The ordered retained-study selector carries each selected original report,
figures, measurements and source files in the chosen order. Rebuilding then uses
the maintained delivery pipeline described above to produce the current scientific
and client companions, final atlas and editable Workspace snapshot together.

## Open, print and reopen

report.pdf uses the existing ReportLab dependency, repeating table headers and
page-aware rows. report.html is self-contained, has a linked section index,
supports narrow screens and prints with repeating table headers. It requires no
network or browser script. report-data.json retains the displayed section
structure and full selection/source binding. report.md preserves the same complete
ordered sections, coefficient tables and relative links as readable Markdown. All four belong in the original
delivery archive and normal authenticated file inventory.

Receive this module in the complete application, compose the hooks above, and
open the current completed native delivery through the existing operator.
Inspect its PDF and offline HTML scenario-change tables, receive the full archive,
then reopen the same Workspace and report IDs. The actual native rendering and
reopening operation uses the existing completed model outputs.


## Combined economic links and coefficient source

Edition v6 is the complete three-way composition of the common 31,003-byte v4
formatter, ASTRA13's 35,965-byte coefficient successor and the economic team's
33,787-byte link/Markdown successor. The coefficient and rendering additions are
disjoint; both source implementations are retained, with a new shared report
version. The original quantity, paired-support and family-union calculations
remain unchanged.

The existing client_economics collector supplies selected economic edition blocks
and original retained member paths. PDF and offline HTML render those package-relative
links directly; Markdown includes the same paths and source labels. The formatter
validates that link targets stay relative to the delivered package. The maintained
delivery integration retains each economic source member, edition record and ZIP,
and includes report_markdown in its original asset manifest.

Receiving uses the existing native report operation: compile the composed module,
open the current source-bound delivery, follow an economic link from its PDF or
HTML, compare its coefficient tables with the exact saved profile CSV, and reopen
the complete archive. The same ordered report blocks drive each output format.


## Linked sources and economic coverage (v7)

The report now preserves typed links for original publisher references, estimate sources, native-model guides and retained working materials. PDF, HTML, Markdown and structured report data use the same link labels and targets. Relative file links remain inside the extracted delivery; preserve its directory structure. Unknown or unsupported URI schemes remain readable text.

The selected economic edition supplies its original reporting-zone identity, modeled and unmodeled responses, available and unavailable alternatives, estimate dates and original common-support coverage. Each coverage percentage uses its own recorded valid-cell denominator, not the whole watershed area. Operating and annualized costs are reported per year in the recorded currency. The formatter reads the completed edition and does not recalculate costs or physical quantities.

The report uses the fixed package-relative working-project link during composition. The current builder captures the scientific workspace after both complete report sets, the final offline atlas and delivery manifest are retained. The current-export reference must be an original baseline scenario; future alternatives must be distinct and exclude that baseline. Scenario-analysis release readiness applies the same baseline requirement before opening the delivery form.

## Observed source context and original figures

Edition v8 composes the project's observed source context with the current maintained report, including its economic coverage and native-grid delivery sections.
The original parameter tables, native model quantities, receiving-water sections,
completed analysis, economic links and atlas assets remain in this formatter.

Select `source_roles.OBSERVED_CONTEXT` as an ordinary imported source choice:

```json
{"source_collection_id":"ACTUAL_COLLECTION_ID","source_id":"ACTUAL_CONTEXT_SOURCE_ID"}
```

The maintained `model.observed_context.bind(workspace, selection)` resolves the
original source and returns its stable binding before delivery identity is computed.
The delivery retains it as `selection.observed_context_binding`.
`observed_context.collect(workspace, selection, directory, state)` returns either
None when unselected or a dictionary with `sections`, `binding`, and `files`.
Its binding must equal the prior bound identity. Its files map contains ordinary
relative-path/bytes/SHA256 descriptors. The delivery verifies and retains all of
them under its observed_context file keys, includes their paths in project_assets,
and places the exact binding in report-data.json. This carries original source
tables and figure assets through the existing package and archive operation.

Observed concentrations, hydrology and discharge-source tables enter descriptive
context sections. The separate annual-load comparison hook continues to consume
only completed Workspace observation-comparison records bound to selected model
runs. The context producer uses the original units, periods, qualifiers and
contributing-area relationships for each data product.

### Figure block

A figure is an ordered report block with this shape:

```json
{
  "kind": "figure",
  "path": "observed-context/figures/original-figure.svg",
  "title": "Original source figure",
  "caption": "The source interpretation, units and period.",
  "alt": "A concise description of the plotted observations.",
  "bytes": 123,
  "sha256": "ACTUAL_64_CHARACTER_LOWERCASE_SHA256",
  "spec": {"original": "complete numeric figure specification"}
}
```

The values above illustrate field names; the observed-context producer supplies
actual retained bytes, hash and complete original numeric specification. Caption,
alt text, positive byte length and SHA256 are required. Paths stay relative to the
delivery and select the retained SVG. Both PDF and companion rendering verify the
SVG against its descriptor before producing outputs.

PDF calls the maintained `scientific_figures.panel_drawings(spec, width)` and
places its ReportLab vector drawings with the original title and caption. The
numeric specification retains original axes, tick labels, series and panel data.
It supports the maintained line, scatter and boxplot figures, including open
markers and the source's minimum/q1/median/q3/maximum/mean fields.
HTML embeds the verified original SVG bytes in each image's data URL, so opening
the HTML by itself does not require authenticated image requests or a neighboring
asset folder. Markdown links to the original package-relative SVG. Structured
report data retains the entire figure block and numeric specification. No extra SVG-conversion dependency
is introduced.

The producer and numeric drawing module are part of this same source contribution:
`model/observed_context.py` and `model/scientific_figures.py`. Install them with
the current formatter/delivery successor before invoking the original delivery.
The existing native receiving operation should render every figure declared by the selected original
recipe, open PDF and offline HTML, and retain their complete source context and
package with the selected original Workspace.


The combined v8 formatter preserves the current v7 source, coefficient, economic and delivery coverage tables. It verifies each retained SVG against its byte length and SHA256 before PDF or companion generation. PDF panels retain the supplied numeric coordinates and units; the offline HTML carries the exact SVG bytes and Markdown resolves the original SVG through its package-relative path. The observed context is bound before delivery identity is computed and every retained companion is included in the original package asset inventory.

## Self-contained scientific HTML figures (v10)

The HTML writer verifies the resolved SVG remains inside the delivery directory,
then reads its original bytes once and checks their byte length and SHA256 against
the figure descriptor before encoding them. Its image data URLs are derived only
for HTML rendering. The ordered report blocks retain their original paths, hashes,
source specifications, captions and alt text, and every original SVG remains an
ordinary retained package asset. PDF drawings, Markdown links and report-data JSON
continue to use the original figure contract. The report version changes the
normal delivery identity so a completed older report can be regenerated with this
self-contained image representation through the existing selection workflow.
