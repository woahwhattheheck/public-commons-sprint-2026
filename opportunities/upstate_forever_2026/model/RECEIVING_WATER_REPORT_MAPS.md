# Original Receiving waters maps in scientific reports

The Receiving waters report source now retains readable monochrome geography
inside the existing scientific report. A plan report and a completed-analysis
report both show the exact source/receptor and contribution geometries saved in
their immutable plan. Completed-analysis quantities, signed changes, fixed
normalization and valid-support tables continue through the original exporter
and scientific formatter.

Edition `receiving-water-report-source/2` makes maps part of every new capture.
The selection API is unchanged: `plan_id` **or** `analysis_id`, optional title
and optional existing delivery ID. Earlier edition 1 sources remain readable and
keep their original files and identity. Preparing the same plan under edition 2
creates its own complete retained source; it does not modify the earlier source.

## Read the maps

Every report has overview frames with at most six named waters per frame, followed
by a detailed frame for each water. Light grey polygons show the saved contribution
area. Dark polygon outlines, lines and point symbols show the original receptor.
Numbered labels refer to the accompanying water names. Coincident labels use
deterministic offsets and leader lines; a label anchor is a cartographic position,
never an inferred sampling station or intake.

The maps preserve original XY vertices, multipart geometry and polygon holes.
No reprojection, simplification, geometry correction or basemap is applied during
reporting. A saved native plan has already prepared the geographic relationships;
the maps read its retained GeoPackages and verify their byte identities and CRS.
Original point, multipoint, line, multiline, polygon, multipolygon and geometry
collection receptors are supported. Contribution geometry remains the original
area prepared by the plan.

Both axes use the same projected metres per drawing point. The north arrow is
explicitly **Grid N** (positive projected Y), and the scale is labelled **grid m**
or **grid km**. This distinction matters for projections such as Web Mercator:
the drawing does not claim that a projected metre is a locally corrected ground
distance. The original full CRS WKT and its name travel in the figure specification.

The per-water caption uses the original plan's contribution area in hectares and
its declared relation. Overlapping contribution areas are not added, and fill
darkness does not encode a concentration, an export quantity, a flow path, or
monitoring effectiveness. Analytical tables retain their existing physical
semantics. All source IDs, original properties, designation metadata, geometry
reader operations and contextual references remain in the linked original plan
and source package.

## Continue the existing native operation

Use the original equipped host and its active restored application and Workspace.
For the four-area SC source plan operated in receiving message1791875420.202379:

```sh
cd /mnt/data/eco-cohort-resume/received/application
/opt/pyvenv/bin/python -B model/receiving_water_report_cli.py \
  --workspace /mnt/data/eco-cohort-resume/received/workspace \
  --output /mnt/data/eco-cohort-resume/public-water-map-report-source.json \
  prepare \
  --plan-id c42b411feba8fb3df0d4f4e5c9a8a02c0c7885cbf91ddcda4a9d539ccc7f28a6
```

The existing CLI prepares, imports and fully verifies the source and returns its
exact `source_collection_id` / `source_id` selector. Use that selector in the
same Scientific Reports composer or original observed-report native renderer.
The source-plan operation needs no model run and no new Workspace.

The same API is available inside the existing operator:

```python
from model import receiving_water_report_source

result = receiving_water_report_source.prepare(
    workspace, {"plan_id": actual_saved_plan_id}
)
verified = receiving_water_report_source.inspect(workspace, result["id"])
source = verified["source"]
```

For a completed analysis, select its exact saved `analysis_id` instead. The producer
resolves that analysis's original plan, verifies both immutable records and keeps
the original numerical export. A map render failure returns an actual exception
within this same preparation; correct its maintained source and retry the same
selection. Completed editions retain their original identities.

## File and source closure

Each capture remains in `receiving-water-report-sources/<id>/` under the existing
`.receiving-water-report-source.lock`. The ordinary whole-Workspace transfer
already holds that lock. No additional archive, source-view or execution lock is
introduced.

New exact companions are:

- `figures/source-map-spec.json`: the original typed specification, geometry
  banks, plan/project identities, file hashes, CRS, render method and figure captions.
- `figures/source-overview-0001.svg` and subsequent overview pages.
- `figures/source-water-0001.svg` and subsequent per-water detail frames.
- `figures/source-map-members.json`: the exact rendered-map inventory and
  immutable original plan/renderer binding.

All companions enter the existing recipe's `inputs` with byte counts and SHA256.
`figure_spec` points to the specification and `figures` selects each saved
ID and SVG path. The original observed-context consumer validates the specification
and source bytes. HTML embeds the retained verified SVG. PDF calls the shared
scientific renderer on the very same saved specification. SVG and PDF therefore
use the same vector drawing and equal-aspect map contract.

The source retains the full original plan, every original geometry file, full
source bodies and companions, collection manifests, source reference locations,
and the actual implementation files. The immutable capture implementation includes
`producer`, `plan_reader`, `map_capture`, `map_renderer` and `scientific_figures`.
Completed analyses also retain the existing `exporter` and
`scientific_formatter` roles. Map rendering does not rewrite the immutable plan.

A complete map inventory is reused after interruption once every declared member
has verified. Temporary writes do not enter its inventory. Earlier existing SVGs
are never silently replaced if regeneration yields different bytes. The original
report intent and prepared-source recovery continue to govern source import.

The selected-study transfer adapter accepts exact edition 1 and edition 2
implementation roles and captures the ordinary figure companions. It preserves
the original native plan and same-project source records; a foreign retained
source remains self-contained with its original project identity. It does not
materialize source views while collecting the archive.

## Shared projected-map figure contract

The reusable entry point is `model.scientific_figures.panel_drawings(figure, width)`.
An ordinary `upstate.scientific-figure-spec/v1` document has `figures`;
each geographic figure supplies a `geometries` mapping and one or more panels with
`kind: "projected_geometry_map"`. A geometry bank key is the original
`model.common.digest(geometry)`. Identical source and contribution geometry
therefore share one complete vertex representation within that figure.

Each panel supplies:

- `title` and `bounds: [xmin, ymin, xmax, ymax]` containing every original vertex.
- `crs: {name, wkt, axes: "XY", units: "metre"}`, a real projected metre CRS.
- `layers` with `geometry` bank key, `role` (`receptor` or `contribution`),
  original `receptor_id`, and `source: {path, bytes, sha256}` bound to a retained member.
- Up to six `legend` rows with full original `label`, `receptor_id` and a
  display-only XY `anchor`.

- Optional `role_labels: {contribution: text, receptor: text}` supplies the
  authoritative producer's names for the two visual swatches. Each label is
  nonempty text of at most 160 characters; unknown keys are rejected. Labels
  wrap completely, with frame height adjusted to preserve every word. Omitted
  labels retain the exact Receiving defaults and their original positions:
  "Contribution area" and "Source / receptor".

A Conservation producer may explicitly label these swatches "Original reporting
footprint" and "Selected planning units"; those meanings must come from its
actual saved source selection. A map role describes the drawing order/style,
not an inferred hydrologic relationship. Optional labels do not change geometry
roles, source identities, quantities or coordinate semantics. The source producer
also owns its full caption, title and scope explanation.

All supported GeoJSON geometry coordinates remain intact, including additional
dimensions; this planar drawing explicitly uses XY. Coordinates must be finite,
rings closed, geometries nonempty and the declared extent positive. The renderer
rejects missing geometry bank members or altered geometry hashes. Each producer
remains responsible for binding the exact native member, real CRS and original
subject selection before retaining its recipe. The Receiving producer performs
those checks against the existing plan and every original GeoPackage.

`model.scientific_map_figures` provides validation and ReportLab Drawing only.
The two explicit dispatch seams in `scientific_figures` preserve existing
line/scatter/boxplot logic. `receiving_water_report_maps` owns only the Receiving
plan's original-GPKG capture, overview/detail grouping, retained spec/SVG files and
inventory. It never calls a native solver, plan preparer or geographic correction.

Other original scientific producers may use this same typed map contract after
binding their own retained original coordinate source; no alternative renderer is
necessary. The additive component `scientific-map-figures` supplies the shared
dispatcher and geometry renderer. The Receiving report component adds its own
capture module and this guide through an ordinary component fragment.

## Runtime and implementation

The native map path uses the application's existing Fiona, Shapely, PyProj and
ReportLab dependencies. They are imported only when a map is prepared or rendered.
Manifest/catalog reads remain lightweight. Rendering uses vector paths with
ReportLab's even-odd fill rule so original polygon holes remain transparent.

The native receiver should inspect the actual SVG/HTML/PDF for the original four
waters and verify the returned source before continuing the same whole-Workspace
or selected-study archive. The meaningful acceptance checks are the native
preparation itself, five report figures for four waters, original plan/source
hashes, visible multipart rings/holes, readable water labels, and reopened original
report source and mapped figures. Existing scientific/native run IDs remain the
ones selected in the original study.

### Shared consumer capability

`model.scientific_map_figures.ROLE_LABELS_VERSION` is `1` for the maintained
optional `panel.role_labels` contract described above. Producers may check this
version before preparing a capture that supplies authoritative area/source
labels. The constant declares that installed rendering capability; the complete
renderer body hash remains part of every retained map capture and report
rendering identity.
