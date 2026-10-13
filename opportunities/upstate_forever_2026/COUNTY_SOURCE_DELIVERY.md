# County sources and editable GIS delivery

This is the complete receiving product for original project
`c6095eb6-b080-42e5-b89e-0d36accb98f4`, containing the retained Upstate county
Web Map and its dated whole-county population context.

## Open the delivered work

Extract the review package and open `START_HERE.html`. Its first button opens
`gis/OPEN_GIS.html`, the original offline GIS viewer. The source collection is
under `sources/START.html`; original county tables and definitions are under
`county-context/`. The review pages use relative local links. A workstation browser that allows local files can open them directly.

`County_Editable_GIS.zip` contains the complete QGS/QGZ project, editable
GeoPackage, original source files, metadata, county context and receiving tools.
Extract the whole ZIP before opening `project.qgz` in QGIS. Keep its directories
together. Editing the working layer leaves the retained original sources intact.
Return the complete working edition through the application's **Editable GIS**
desk, inspect changes, and adopt the chosen received layers to continue them.

`County_Original_Sources.zip` carries the two original primary datasets and their
eight declared companions. The retained publisher map, original Esri geometry,
source provenance, county identifiers, complete tables and human context travel
with the selection. The county CSV retains string identifiers and the recorded
population estimate vintage. Whole-county population is interpreted on that
whole-county footprint; utility service areas and watershed extents remain
separate selections.

## Reopen the complete application and project

The separate `County_Complete_Workspace.zip` contains the full application,
source history, editable scientific project, GIS exports and receipts. Keep this
ZIP beside the extracted review package. On a machine with the application's
Python dependencies available, first extract its `application/` directory and run:

```sh
python application/model/cli.py restore County_Complete_Workspace.zip received-county
python received-county/application/operator/server.py --workspace received-county/workspace
```

Choose a new receiving directory. The original project identity is preserved.
The operator prints its own local opening address; use it on that workstation.
The application's `environment.yml` records the complete scientific environment.
For this source/GIS course, the native dependencies used are Fiona, Rasterio,
PyProj and Shapely. The full InVEST environment belongs to native model work.

In the received operator, inspect the retained sources in **Investigations** and
the original exports/received editions in **Editable GIS**. Use the existing
source, review and adoption actions for a new working edition rather than
replacing historical source objects. When the native course includes a working-vector review, its complete JSON, CSV, HTML and ZIP accompany the delivery and remain tied to that received edition. The GIS receiver retains its phase selections and original operation IDs,
and uses the native queue resume action for an interrupted phase.

## Assemble a delivery from the completed course

Run the maintained `source_tools/receive_webmap_sources.py` with the original
county workspace, separate admission/collection/GIS state directories and the
complete companion-aware collection receiver. Its final result is
`original-county-admission-result.json`. The source receiver preserves all ten
original counties and accepts only the specifically identified Fiona feature-ID
projection in addition to the original attribute dictionary.

Then assemble the actual existing products, without rerunning the source or GIS
operations:

```sh
python source_tools/deliver_county_sources.py \
  --workspace /absolute/county/workspace \
  --result /absolute/county-operation/admission-state/original-county-admission-result.json \
  --output /absolute/deliveries/county-source-delivery
```

The output is a single readable handover, the original source/GIS ZIPs and a
complete native workspace archive. Native source files are checked against their
retained byte identities before copying. The workspace archive uses the original
backup transaction. Output stays outside the application and workspace, and an
existing delivery reopens only when its original selection, complete application source and file register
still match. Changed deliveries require a new destination. An interrupted new
assembly retains its temporary directory instead of deleting completed work.

`delivery.json` records the complete source bindings and file inventory.
`native-receiving-result.json` retains the completed operation details. These are
technical references; the normal human entry point is `START_HERE.html`.
