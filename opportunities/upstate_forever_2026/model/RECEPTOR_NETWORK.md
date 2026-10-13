# Receive original watershed memberships before native model runs

The source-only command turns the retained HUC12/ToHUC domain into a complete
upstream membership product. It uses Python's standard library, the existing
model/common.py, and model/receptor_network.py. It reads the original domain
ZIP directly, or its original GZIP/Esri JSON member. A GIS installation and
prepared raster grid are unnecessary for this source step.

Operators receive an offline geographic explorer, original links and editable
membership CSVs, the saved receptor definitions, and the complete original
domain body with geometry. Its grayscale vector map links original watershed
polygons to the same area selection and HUC12/name search as the membership table. The same definitions feed the existing GIS,
receiving-water and native physical-output workflows.

## Run with the retained Upper Savannah domain

From the cumulative application directory:

~~~sh
python -B -m model.receptor_network_cli \
  --source /dev/shm/upstate-405f-20261012/inputs/dbc61-upstate-model-domain-20261012.zip \
  --profile source/receptor-profiles/utility-focus-20261012.json \
  --output /mnt/data/upstate-receptor-network-receiving \
  --expected-decoded-sha256 2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af
~~~

Use the receiving host's actual source location. The original complete
dbc61-upstate-model-domain-20261012.zip is accepted as --source without
extracting it first. Its retained size is 8,800,689 bytes and archive SHA-256
is 1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04.
The archive reader selects its unique model-domain.esri.json.gz or
model-domain.esri.json member; --member selects an explicit exact member when
a carrier contains several domain versions.

The decoded-source identity above is the retained 217-feature source already
named in the original sprint's native receiving work. The graph command also
accepts other explicit receptor profiles and original Esri HUC domains. Use
their actual source identities when supplying --expected-decoded-sha256.

CLI output supplies the actual inventory ID, directory, source-unit count,
distinct contributing-unit count, complete area HUC lists, shared memberships,
file descriptors, the retained source binding and whether an existing result
was reused. Open the returned directory's index.html. Filter by receiving
area and search a HUC12 or original watershed name. Select a polygon to inspect
its HUC12 membership rows; keyboard users can focus a polygon and press Enter
or Space. Drag the map to pan and use the buttons or mouse wheel to zoom.
Reset view returns to the full original domain. The report also prints with
a neutral, compact layout.

## Retained outputs

| File | Purpose |
| --- | --- |
| index.html | Offline geographic explorer, linked searchable upstream inventory and source relationships |
| watersheds.svg | Editable grayscale vector overview of the original source polygons, contributing units and selected anchors |
| memberships.csv | Each area's contributing HUC12s, original names, selected anchor, next original link, and number of links to the anchor |
| areas.csv | Area names, roles, anchors and complete contributing HUC12 lists |
| network.csv | Original source feature identity, HUC12, ToHUC, name and hydrologic-unit type |
| network.json | Complete original attributes, areas, paths, shared memberships, special units and terminal/outside-network links |
| source-profile.json | Exact selected receptor definitions and original evidence references |
| source-domain.esri.json.gz or source-domain.esri.json | Exact retained original body, including source geometry |
| result.json | Product identity, input/source hashes, source metadata, summary and every file descriptor |

The destination contains one directory per exact source-body/profile and
presentation-version identity.
The complete original body is retained inside that directory. Repeating an
unchanged selection verifies and reuses its saved files. A failed writing step
can resume from completed immutable source/profile/network files.

If the destination is WORKSPACE/receptor-networks, the original recursive
Workspace archive carries this directory with the rest of the project. A
standalone transfer should carry the complete returned directory so the report,
CSVs, definitions and original source body remain together.

The direct Python interface is:

~~~python
from model.receptor_network_cli import build

result = build(source_path, receptor_spec, output_directory,
               expected_decoded_sha256=original_decoded_sha256)
~~~

## Geographic view and original coordinates

The overview uses each original Esri polygon ring from the retained source.
It fits those source coordinates linearly to an 1100 by 620 view and records
the original extent and spatial-reference metadata in result.json's
geography field. Holes use the even-odd polygon fill rule. The drawing uses a
0.2-pixel simplification tolerance at the full-domain view to keep its browser
interaction responsive. The retained source body contains every original
coordinate; it supplies subsequent GIS geometry, spatial intersections and
physical-area calculations.

The view starts with the complete source domain. A medium-gray fill identifies
the union of selected contributing units; a dark-gray fill identifies original
anchors. Choosing an area updates those fills and dims the other units. HUC12
and watershed-name search links the map to the original membership rows.

The standalone watersheds.svg is suitable for an editable illustration or
a static viewer. The offline index.html adds interaction without remote map
tiles, browser dependencies or a network connection. A derived print preview
can remove script and filter controls while retaining the complete default map,
selected areas, memberships and original source links. A complete exported
product preserves the interactive index.html and its linked files together.

The result's files.geography descriptor identifies the SVG alongside the
existing report, source-body, profile, network and CSV descriptors. A source
with attribute records and no polygon rings still produces the original
membership product; its result omits the optional geography view.

## Meaning of the selections

The existing utility-focus profile retains the issuer's named ARJWS Six and
Twenty HUC12 anchors and PRWD Tugaloo/Choestoea HUC12 anchors. Reverse traversal
uses each original ToHUC link and includes complete anchor units. A visited set
keeps a HUC12 from being counted twice within an area, including when selected
anchors share upstream land. The shortest original-link path goes to the
nearest selected anchor.

Links to anchor is a count of network edges. Original HUC geometry, source
unit types and retained network extent define the planning scale. An intake's
position inside a HUC or a reservoir's retention process needs the project's
finer geographic/scientific method. Shared HUC memberships stay explicit;
the GIS physical inventory uses polygon unions for each selected area.

The source feature identity uses the original typed Esri OID field when
present, preserving the original value independently of field aliases. The
fallback feature index is recorded when an original OID is unavailable.
Complete source fields and spatial-reference metadata remain in source_binding.

## Continue the original scientific workflows

The same utility profile is accepted by:

- model.receptors.build_inventory / model.receptor_cli for contributing-area
  GeoPackages, role-focused priority maps, physical native exports and
  same-valid-pixel scenario changes.
- model.receptor_experiments for each experiment profile's own baseline and
  its retained alternatives.
- model.receiving_waters.prepare_receptor_spec for the existing native
  source-water planner after its original sources are imported.

The source-only command makes the actual original network product available
while DEM, land cover, climate inputs and native runs progress. Its saved
profile remains the exact input for those later stages.

## Operator integration

The source-only operator mode retains the product under WORKSPACE/receptor-networks.
Its source picker binds source_collection_id and network_source_id into the
saved receptor specification. Later model comparisons can reuse those same
definitions. To find the corresponding native grid, compare
source_binding.body_sha256 with the grid's retained model-domain source body.
That comparison also links a domain supplied in a ZIP to the same original
GZIP body already imported in the native workspace.

The initial source-product directory remains immutable. A presentation update
uses a new version in the product identity, while preserving the original
source-body SHA and exact receptor specification.

## Original source references

USGS Watershed Boundary Dataset:
https://www.usgs.gov/national-hydrography/watershed-boundary-dataset

Original HUC12 service and fields:
https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6

Issuer RFP and focus-area appendix:
https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf

Original sprint receiving thread and source identity:
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791849063917219
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791849845310389

Authored by TokenJunkieLabs for the Ecosystem Sciences sprint.
