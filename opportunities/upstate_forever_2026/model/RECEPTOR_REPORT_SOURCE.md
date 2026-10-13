# Original watershed geography in scientific reports

The Source-water areas desk can publish a saved watershed network, or that
network with its prepared original polygon areas, as one retained scientific
report source. It uses the existing queued action, Workspace source store,
typed observed-report format, result package and scientific report composer.

## Operator journey

1. Open a saved **Original watershed network** or **Prepared scenario areas**
   result in Source-water areas.
2. Choose **Prepare scientific report source**. The original queue retains the
   operation and its complete source selection.
3. Open the completed **Scientific source report**. It shows the original
   network size, selected distinct HUC12 units, area membership rows, anchors,
   longest original downstream path to an anchor and original published area.
4. Choose **Open scientific report composer**. The original typed source is
   appended through the maintained ordered SourceReports composer; retain or
   add observation and completed native process sources in the desired reading
   order, preview, then publish through its normal queue.
5. Download the printable source geography or export its complete source
   package. The existing Workspace archive carries the saved source, original
   products and original source collection into a receiver.

Hosts with the shared scientific composer expose that button directly. An
earlier host opens the same retained source in Sources. The result and its
typed recipe remain usable by the existing scientific-source picker.

The source card and completed-task button reopen the same saved result. The
handoff checks the actual selected Workspace, mounted view, result generation,
source collection and source entry after any awaited catalogue refresh.

## Native course

From the actual complete application, use the existing operated Workspace and
saved product IDs:

~~~sh
python -B -m model.receptor_report_source --workspace ACTUAL_WORKSPACE build \
  --prepared ACTUAL_PREPARED_AREA_ID
~~~

A network by itself is also a complete source geography report:

~~~sh
python -B -m model.receptor_report_source --workspace ACTUAL_WORKSPACE build \
  --network ACTUAL_NETWORK_ID --title "Original utility watershed geography"
~~~

If both identifiers are supplied, the prepared product must belong to that
network and retain the same original source binding. Reopen the produced source:

~~~sh
python -B -m model.receptor_report_source --workspace ACTUAL_WORKSPACE inspect \
  ACTUAL_REPORT_ID
~~~

The command returns the saved report ID, original selection, summary, exact
source_choice, observed_context_binding and full file inventory. Repeating the
same selection reuses the same immutable report after verifying its retained
original files and native source binding.

This module uses the standard-library source workflow. It reads the already
saved original network and prepared polygons; the existing native model tasks
retain their own execution and results.

## Source scope and interpretation

| Report content | Original basis |
| --- | --- |
| Upstream HUC12 membership | Existing network's original HUC12 / ToHUC edges and selected anchors |
| Path length | Existing shortest downstream link count to the nearest selected anchor |
| Per-area HUC12 count | Distinct original network units assigned to that receiving area |
| Combined HUC12 count | Distinct union of the selected receiving areas |
| Published area in km² | Decimal sum of original AreaSqKm attributes over those distinct units |
| Prepared geometry | Existing original Esri feature subsets, including native IDs, attributes, rings and CRS |
| External links and terminal labels | Original saved network diagnostics |

A missing or invalid original AreaSqKm value makes the corresponding area
summary unavailable and records its missing-unit count. The producer preserves
the complete original attributes so an operator can inspect that source.
The union counts shared HUC12 units once; individual receiving-area totals
retain their own source membership.

The report describes source geography and topology. Native pollutant
comparisons retain their own reporting grid, producing models, physical-output
units, paired baselines and common-support quantities in their existing saved
products.

The standalone HTML displays the original saved geographic SVG and the source
tables. Its complete source package preserves every relative link. The typed
scientific recipe supplies the original tables, interpretations and linked
source files to the shared publisher; the original geographic SVG remains a
retained companion available with the complete scientific source.

## Retained source contract

The report lives under receptor-report-sources/ID in the original Workspace.
Its deterministic identity includes the Workspace project, selected original
network/preparation, complete product result hashes, every original member
hash and the report title. Source files are copied unchanged under network/
and prepared/, preserving their original relative names and report links.

The generated files are:

- observed-report.json: upstate.observed-report/v1 with exact input descriptors,
  original-source sections and complete relative source links.
- index.html: printable source geography and original geographic view.
- summary.json: distinct-unit and original published-area summaries.
- provenance.json: original product, source and selection identities.
- sources.json: ordinary upstate.sources/v1 document with every original
  product/report companion.
- result.json: complete saved identity, native source choice and immutable file
  descriptors.

The producer verifies both original products before copying and verifies each
body again at the copy boundary. It uses the existing observed_context.bind
contract after Workspace import and again when reopening. The operator uses
normal file tickets, source registration, queued task results and package
export.

## Complete application receiving

The existing receptors component retains the full source family. The additive
integration/component_fragments/receptor-scientific-source.json appends this
module and guide to that family through the maintained complete-application
composer, preserving other component declarations. The original shared
renderer, source catalogue, extension host and archive implementation remain
the receiving dependencies.

## Projected original watershed figures

The optional projected-map edition uses the maintained original Esri reader and
the shared scientific-map renderer. It reads the exact captured source body
listed in the saved network, validates its decoded identity and all original
HUC12 attributes, and selects only the receiving areas in that network or
prepared-area result. It never re-runs a watershed acquisition, a grid build, or
a pollutant model.

The default build remains the source-only standard-library workflow. To include
the native vector figures, run the same command with an explicit flag:

```sh
python -B -m model.receptor_report_source --workspace ACTUAL_WORKSPACE build \
  --prepared ACTUAL_SAVED_PREPARATION_ID --include-maps
```

The existing Source-water areas desk exposes this choice in **Prepare scientific
report source**. The checkbox starts unchecked. It becomes available only when
the installed application can import its current original Esri reader, shared
map renderer, pyproj/PROJ, Shapely/GEOS and ReportLab. The form identifies those
installed versions. A source-only edition remains useful on a standard-library
host; opening and checking an already retained source does not re-render it.

### Geographic meaning

Each light polygon is a native interpretation of an original upstream HUC12
unit. Dark outlines mark the original anchor HUC12 polygons. A numbered label
identifies a receiving area and is placed inside one of its original anchor
polygons; it does not identify an intake or sampling station. Overview pages
contain at most six receiving-area labels and are followed by one frame per
area. Original unit boundaries remain separate. Shared memberships do not imply
that areas or quantities can be added.

All figures retain the original projected coordinate system. Their grid north
and scale use projected metres; EPSG:3857 grid distances are not corrected local
ground distances. Figure preparation applies no reprojection, simplification,
union, or new area calculation. The report's quantitative areas still sum the
original publisher's AreaSqKm fields over the stated distinct HUC12 support.

The maintained Esri parser assembles original rings by symmetric difference and
records any validity repairs. The source body remains byte-identical. Native
parsed polygons are therefore described as an interpretation of that body,
with the complete reader metadata and each feature's operation list retained
in `figures/original-geometry-reader.json`. That inventory also records the
network ID basis and the GIS reader's ID basis separately, along with the
original feature-array position. The HUC12 and complete attribute join ties
each mapped feature back to the saved network independently of ID fallbacks.

### Retained edition and normal report composition

The mapped edition has its own immutable report-source identity. It binds the
original saved network/preparation, selected areas, native library versions,
and complete source hashes for the consumer, original reader/parser and shared
renderer. Their exact source files are retained under `render-source/`.
An earlier source-only edition keeps its original identity and source choice.

The source carries the complete geometry-bearing scientific figure
specification, all generated SVGs, original source files and a verified figure
member inventory. The same ReportLab drawing model generates each SVG and the
scientific report's PDF figure. The standalone HTML displays all the vector
figures and links their original downloads. The typed observed-report recipe
declares the same figures explicitly, so the existing scientific report
composer, native renderer, full Workspace archive and selected-study transfer
all retain the complete closure.

Opening **Open scientific report composer** uses this mapped edition's actual
source collection and entry. Combine it with observation or native process
sources in the intended reading order. The ordinary queued report receiving
course can render/export/restore it using the same source choice. Retain the
source-only run already underway; prepare maps as a new explicit edition at its
next source boundary.

### Complete application dependencies

The receptors component fragment includes this producer and
`model/receptor_report_maps.py` together with the maintained
`model/scientific_map_figures.py`, `model/scientific_figures.py`,
`model/spatial_esri.py` and `source/capture_upstream_network.py`.
Install them as part of the complete application, preserving the current shared
renderer rather than replacing it with an older component copy. Native packages
are capabilities of the actual receiving host; they are not synthesized by the
source installer.

## Complete report and editable Study receiving

The maintained `source_tools.receive_receptor_report` command carries this saved
source through the original scientific render, complete report downloads, full
Workspace backup and independent selected Study restore. It preserves the frozen
source identity, original task IDs and editable network/prepared-area products
across resume. See [the complete receiving guide](../source_tools/RECEIVE_RECEPTOR_REPORT.md)
for the one-command native course, explicit map edition, retained-source reopen,
actual browser continuation and original product verification.
