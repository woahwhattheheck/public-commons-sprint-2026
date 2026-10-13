# Original annual-load references in the operator

The annual-reference desk brings the original USGS F7DN436B annual-load estimates
and Southeast SPARROW 2012 regional calibration targets into the existing
scientific workspace. The operator can receive or adopt the
original archives, inspect actual station and flow-station records, select their
catchments, import the annual observations, and open the existing calibration
form with that imported selection.

## Receive this source edition

The application files are:

- operator/annual_reference.py
- operator/extensions/annual-reference.json
- operator/web/annual_reference.mjs
- operator/web/annual_reference.css
- operator/ANNUAL_REFERENCES.md
- source_tools/usgs_annual.py, the maintained annual-source implementation
- source_tools/sparrow_reference.py, the regional source adapter
- source/usgs-southeast-sparrow-2012/, the complete published regional source cohort

Receive the complete current application with these files at their original
relative paths. The existing extension registry discovers annual-reference.json.
Its existing server and browser extension host supply the authenticated API,
serial task queue, source roots, workspace registry and downloads. Restart the
current operator after adopting changed application files.

The already merged source files remain dependencies:

- source/usgs-annual2012-20261013/F7DN436B-original-metadata.xml
- source/usgs-nldi-upper-savannah-20261013/source-manifest.json
- source/usgs-nldi-upper-savannah-20261013/geometry-review.json
- The original station/reach/basin JSON files declared by that source manifest.

The current calibration desk supplies openForObservations. Its source handoff
uses the actual observation ID, imported catchment source and recommended
temporal weighting. The existing candidate-run and parameter-profile selection
then continues in that form.

## Read the actual source

Open **Annual load observations** in the existing operator, then choose the
**Published source edition**. Existing inventories reopen with their retained
edition. Changing the edition clears the previous selection; a delayed response
from an earlier inventory cannot replace the selected edition.

### Original annual estimates — F7DN436B

**Use received originals** selects a registered source root and a relative
directory containing the complete load_est.zip and sitegage.zip. Browse
directories through the existing source-root boundary. The directory browser
pages all entries, including nested directories. The annual desk uses the exact
original dictionary already installed with the application.

**Use original ZIP uploads** chooses those two files from the operator's existing
upload catalogue. The upload identities and original file bytes remain governed
by the current upload transport.

**Receive the published originals** runs the original annual helper against its
fixed publisher URLs on the native queue. Its completed original files remain
the task's continuation point. The provider's HTTP capture behavior is unchanged.

The default source selection is HUC8 03060101 through 03060107. The operator can
supply another explicit list of original eight-digit HUC codes. Inventory joins
the release's exact station_id and flow_station_id pair to the original sitegage
table and selects its HUC8 values. The inventory shows the resulting original
rows, original fields, per-series counts and any source parsing issues.

Both ZIPs, the original XML dictionary and the inventory are retained beneath
the original workspace's annual-references directory. Their identity is
verified when opening the inventory again or preparing a selection. The original
ZIP CRC and estimator parsing stay in source_tools.usgs_annual.

### Southeast SPARROW 2012 regional calibration targets

Choose **USGS Southeast SPARROW calibration targets — 2012 reference**, then
**Use retained published targets**. The adapter receives the complete original
nitrogen, phosphorus and sediment calibration tables, original regional metadata,
service definitions and original reach crosswalk. Received copies are reused;
the publisher URLs provide any missing originals. **Use received originals**
can instead adopt an existing complete source folder.

The original tables contain 598 nitrogen, 589 phosphorus and 395 sediment rows.
Their 665 distinct published COMIDs join to the original reach network. The
seven Upper Savannah HUC8s contain 11 targets across five published reaches:

| Published reach | COMID | Original HUC8 | Available target series |
| --- | --- | --- | --- |
| Chattooga | 6269342 | 03060102 | TN, TP, TSS |
| Bell | 6280111 | 03060104 | TP, TSS |
| Stevens Creek | 11730084 | 03060107 | TN, TP |
| Jackson | 22724211 | 03060106 | TN, TP |
| Cohens | 22726623 | 03060106 | TN, TP |

The original regional metadata identifies 1 October 1999 through 30 September
2014 as the calibration-target horizon, with 2012 as the reference year.
Each record labels that interval as a **Published regional target horizon**.
It describes the published source edition; it is not a newly inferred
station-specific estimation period.

Nitrogen and phosphorus targets retain kg/year. Sediment targets retain their
original metric tonnes/year. The original `ACTUAL` / `ACTUAL_MT` target field
remains separate from the published model prediction and the sediment model's
`TSS_CONV` term. Importing an original sediment target does not apply that
model term again. The original `CONSTITUEN` field distinguishes TSS and
suspended sediment.

These published calibration-table records have no record-level standard error
or original final-estimator selector. The desk displays **Published standard
error unavailable** and **published regional target**, retaining all original
attributes. F7DN436B remains available independently with its published
estimator and error fields.

## Choose records and upstream catchments

The table keeps the original station name/ID, flow-station ID, HUC8, COMID,
constituent, final estimator, included flow period, annual value and published
standard error. Use **Original fields** to inspect the complete source row,
paired station records and available component review.

Selection persists while filtering or changing pages. Select usable records on
the current page, then choose their catchment source:

| Choice | Source relationship |
| --- | --- |
| Retained source reach | Use the original feature and full upstream basin retained with the selected regional source edition. |
| Retained published reach | Match the original annual row's COMID to the retained original full-reach NLDI feature and basin. Use the explicit reviewed source component. |
| Receive published reach | Receive the original NLDI feature and full upstream basin for that exact published COMID. |
| Water-quality station | Receive the original NLDI feature and full basin for the row's actual USGS water-quality station ID. |
| Published flow station | Receive the original NLDI feature and full basin for its distinct published USGS flow station ID. |

Only choices supported by the row's original identifiers appear. The retained
Upper Savannah cohort includes reaches 6280111 and 11737823. The source review
identifies the actual station-containing component. Calhoun Falls' original
response also contains a small remote triangle; preparation retains the original
response and the omitted component's coordinates and ellipsoidal area alongside
the selected component. The underlying native coverage/extent checks continue
to use the selected actual geometry.

Choose one source series for each catchment and native parameter. SSC80154 and
TSS00530 retain distinct measurement identities; the operator prevents an
ordinary duplicate selection and the annual helper validates the resulting
actual catchment IDs again. If the selected catchment/parameter pair duplicates
another row, the native task reports that exact issue.

Add an observation-edition title and a study comparability note where relevant.
The note accompanies each original annual record. It can describe how the
historical flow and water-quality period relates to the model input editions.

## Import and open calibration

**Import selected loads and catchments** runs two existing scientific operations:

1. The selected source adapter's prepare operation creates the original annual CSV, source
   metadata, upstream catchments and source-manifest edition.
2. source_tools.usgs_annual.bind imports that source edition and its annual
   observations through the actual Workspace methods.

The completed operation retains the actual observation ID, source collection
ID, catchment source ID, recommended temporal weighting and preparation ID. Its
existing task view provides downloads for the selection, annual CSV, exact
selected source rows, catchments, catchment-source context, source manifest,
observation metadata and binding. These records also travel with the existing
workspace transfer.

Choose **Open calibration** on the completed operation. The handoff selects
those imported observations and their catchments, and initializes the
recommended temporal weighting through the current calibration controller.
The operator then chooses the native candidate runs and calibration/validation
groups using the same existing form.

All selected estimates are already annual mass rates. Their source interval
is retained without multiplying a load by the number of years. F7DN436B
retains its original kg/year, final-method selector, published uncertainty and
source-specific temporal basis; Workspace performs its existing sediment
conversion to metric tonnes/year. The regional edition imports sediment in
metric tonnes/year directly and retains its source-global temporal basis.

Use the actual upstream catchments when assigning calibration and validation
groups. The Jackson and Cohens mainstem catchments include upstream tributary
catchments; their observations share geographic information. The existing
calibration leakage checks and group assignment apply to these original
polygons. Distinct record IDs alone do not establish spatial independence.

The calculation and validation remain in the source, observation and
calibration implementations. Source-error sensitivity can use published error
fields where available; missing regional standard errors remain explicitly
missing in that workflow.

## Existing queue and receiving behavior

Two actions join the original queue:

- annual-reference.inventory
- annual-reference.import

Reads are GET /api/annual-references/catalog, /files, /inventory and /operation.
The state contribution is data.annual_references.operations. Parameters use the
existing authenticated workspace selection and the original registered source
root or upload IDs; arbitrary browser-supplied host paths are not admitted.

Each action retains its original task ID, project ID and request hash. On
continuation it resumes the same operation directory. Completed source and
prepared records are immutable, and a completed operation returns its retained
result. Native source errors appear in the existing task record and the source
desk.

The annual helper retains source-manifest.captured_at after an interruption
between writing that manifest and completing result.json. Retrying the same
verified plan therefore preserves its existing immutable source edition.
Retained and freshly received catchment contexts both expose catchment_id for
the source-context join.

## Physical assessment coverage of the annual references

The completed original-geometry join is in
[Annual load references and physical assessment coverage](../source/annual-reference-assessment-20261013/README.md).
It links the eleven regional targets to the selected 159 assessment stations
and 192 original records, and preserves assessment-publisher, station-publisher
and physical watershed membership separately.

Both downstream Savannah basins contain all 159 selected stations. Chattooga
contains one, Broad contains zero of this South Carolina cohort, and Stevens
Creek contains eighteen. The tributary basins are mutually disjoint and nested
inside both downstream basins. Keep those relationships in the existing
calibration/validation groups.

The same native comparison resolves physical utility coverage: ARJWS contains
six selected stations and ten records; PRWD contains eighteen and twenty-two.
PRWD's assessment-publisher HUC selection remains seventeen stations and
twenty-one records. The additional physical site is SV-809, whose original
July 2026 HUC differs from its original point location. RS-21014 has only an
eight-digit station HUC; its point and three assessment records identify
Little Beaverdam Creek in the PRWD upstream selection.

Import the result folder's `sources.json` through the existing source operation
to open its derived point layer in Spatial Review and download the complete
station/record crosswalks. Annual target import continues through the existing
annual-reference actions above.

## Scientific sources

- Southeast regional source: https://doi.org/10.5066/P9A682GW
- Regional source adapter and original-source details: ../source_tools/SPARROW_REFERENCE.md
- Original release: https://doi.org/10.5066/F7DN436B
- Original item: https://www.sciencebase.gov/catalog/item/583f2f21e4b04fc80e3bd227
- Native station/reach service: https://api.water.usgs.gov/nldi/linked-data
- Original field mapping and command-line receiving:
  ../source_tools/USGS_ANNUAL.md
