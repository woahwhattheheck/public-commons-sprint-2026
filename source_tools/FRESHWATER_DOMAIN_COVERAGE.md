# Freshwater coverage against the original model domain

Needs expert review: use the retained native source attributes and physical-domain comparison when interpreting environmental classifications and coverage.

This continues ECO13-AE11's complete freshwater capture. Its publisher-HUC edition
has 26,931 original IDs and 54 complete geometry pages. The companion makes a
physical-domain edition from the exact retained 217 original HUC polygons,
preserving the publisher edition and every original label.

## Source and native receiving

Install source_tools/freshwater_domain_coverage.py and the accompanying complete
water_context_intake.py geometry-mode successor at the maintained application
root. Keep source_tools/water_context_geometry.py from AE11 PR2772. The ordinary
assemble, export_edition, receive_edition and bind_workspace interfaces remain
the receiving path.

Use the retained original freshwater capture directory containing capture.json,
retained-file-index.json, native metadata, count/ID responses, the original
217-HUC file, and all 54 unchanged geometry pages. Its original provider is
https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2.
The original source adapter is merged at
ab4d8833b6ded2d21e172a2264e5626e73809ea2.

The original domain archive is dbc61-upstate-model-domain-20261012.zip:
8,800,689 bytes; SHA256
1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04.
Use this existing retained archive and its actual local path. The original
watershed provider is
https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6.

From the maintained application root and its original Python interpreter:

    python -B -m source_tools.freshwater_domain_coverage \
      --capture /actual/fw-original/capture.json \
      --domain-archive /actual/dbc61-upstate-model-domain-20261012.zip \
      --output /actual/fw-physical-domain \
      --expected-huc-count 217 \
      --edition /actual/fw-physical-domain-edition \
      --archive-output /actual/fw-physical-domain-edition.zip \
      --workspace /actual/original-workspace

Supply the receiver's actual retained paths. The returned JSON carries the real
capture/source-edition paths, cohort counts and imported bindings. An explicit
domain HUC field can be supplied with --huc-field; default detection accepts one
original HUC12/HUC_12 attribute and preserves its twelve-digit string.

Use the same output directory to resume. Every native POST request has a retained
fingerprint, raw source response and receipt. A native file lock prevents a second
worker from repeating the active capture; interruption automatically releases it.
Changed requests or retained response bytes produce an explicit exception.
A provider rate limit reports its cooldown; resume the same command afterward.
--offline replays retained responses without issuing network requests.

## Physical selection

For every original domain polygon the companion sends its unchanged native rings
and spatial reference to SCHydroClass layer 2, with H2OCLASS='FW' and
esriSpatialRelIntersects. The original CRS is supplied as inSR. Long polygon
requests use POST. Native domain coordinates are not rounded, generalized,
buffered or reprojected by the companion.

Each polygon has independent original native count and ID responses. Their
cardinalities must agree. An original objectIds:null is accepted only with a
native integer count of zero. Native OBJECTID is resolved from original metadata;
OBJECTID_1 remains a separate unmodified attribute.

The union deduplicates native feature IDs while retaining all HUC relationships.
Only physical-domain IDs absent from the existing publisher selection cause
new geometry acquisition. The final intake validates the full captured union
before selecting the physical subset.

The physical source declares huc_selection_mode='geometry', with explicit
selected IDs, original selection geometry, and method. Original publisher
HUC_12 values—including null/blank/outside-domain values—remain intact.
Default publisher-HUC intake retains its existing membership rule.

## Geometry representation and times

Both the original AE11 page requests and new page requests use
returnTrueCurves=false. These are publisher-returned linear Esri paths. Under the
official ArcGIS query contract, curved source features are densified by the
provider when this parameter is false; the current native intake supports paths
rather than curvePaths. The companion does no local flattening and retains every
original source response. Both representations are recorded explicitly in
comparison/coverage.json and the source scope.

The original polygon count/ID intersections operate on the publisher's stored
geometry, so returned path representation does not define physical membership.
Boundary-only contact is included by esriSpatialRelIntersects. Whole original
selected flowlines remain available; intersection counts do not imply clipped
stream lengths or native export/load estimates.

Official API:
https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/

The source captured_at comes from the latest actual request receipt timestamp.
If every response survived without its original timestamp, captured_at is null
with capture_time_status='unavailable_after_response_recovery'. The importer
preserves that state and uses an explicit unavailable label for the required
vintage display. It does not infer an acquisition time.

## Complete retained outputs

- capture-criteria.json: ordinary upstate.water-context-capture/v1 descriptor for the
  distinct sc-hydroclass-fw-physical-domain source.
- comparison/cohorts.json: full publisher, physical, shared, physical-only and
  publisher-only native ID arrays.
- comparison/native-object-huc-relationships.csv: all native feature/HUC
  intersections, original publisher HUC, matching-label flag and original-set flag.
- comparison/per-huc-coverage.csv: every model HUC with native counts and label
  differences.
- comparison/coverage.json: source/domain identities, original query records,
  original-page hashes, representation and time handling, and resulting counts.
- domain/: original polygon requests, unchanged model-domain gzip and bindings.
- retained/: unchanged original publisher capture and its complete source files.
- queries/ and additional/: original POST request metadata, raw native responses
  and receipts; additional geometry contains only newly discovered native IDs.

The source edition retains WATER_CLASSIFICATION role and the distinct physical
source ID. Bindings from the existing Workspace importer feed Water and Habitat
Context and parcel criteria selections. The original sc-hydroclass-fw edition
remains available beside it. Ordinary source ZIP export/receive carries the exact
native geometry, domain, query and comparison companions into another Workspace.

## Parcel-context edition and an already completed capture

The current companion returns `capture-criteria.json`. This additive descriptor
selects the same native freshwater features and declares the complete original
polygon coverage for parcel criteria. An earlier `capture.json` remains intact.
All original count/ID requests, geometry pages, domain and cohort comparisons
resume from the same capture directory.

For a capture that already produced a source edition, use a new edition and
archive name for this added context, such as
`fw-physical-domain-criteria-edition` and
`fw-physical-domain-criteria-edition.zip`. The source acquisition directory stays
the same. With all native requests retained, `--offline` creates this edition
without new provider requests. Ordinary import returns the complete
`parcel_criteria_sources.classifications` selector with its actual source
collection and original coverage source.

The imported source manifest contains the native FW body and an additional
`SOURCE_COVERAGE` entry backed by the unchanged original model-domain gzip.
The default source profile selects it as freshwater and retains ORW/TN/TPGT in
the separate high-quality role. A native criterion evaluated wholly inside this
captured domain can distinguish no matching retained SCDES FW feature from
missing query coverage. This is coverage of the selected classification
inventory. A cross-state inventory gap does not establish ecological
freshwater absence; a broader freshwater criterion retains that gap as unknown.

## Reuse the already retained native legacy-code supplement

The maintained application also includes the complete original 52-feature
publisher-code supplement at:

`source_data/scdes_fw_publisher030601030101_20261013/source/sources.json`

Append that exact manifest to the physical capture command:

~~~sh
--reuse-source source_data/scdes_fw_publisher030601030101_20261013/source/sources.json
~~~

The receiver verifies and retains the entire original manifest and all body and
companion hashes. It matches the original native count and ID responses to the
same published query as the geometry, validates native OBJECTID and CRS, then
uses the unchanged feature response. Physical polygon queries still decide
which original features belong. Only physical IDs absent from both the completed
publisher capture and the retained supplement cause geometry downloads.

The original 26,931-feature publisher cohort remains the comparison baseline.
The additional source keeps its exact publisher HUC `030601030101`; the physical
model domain keeps its original `030601030100`. A reused source is never relabeled
or assumed inside the domain. Cohort output separately records source identity,
the number of physically selected reused records and genuinely new downloads.

The reuse manifest set produces its own descriptor/comparison and additional
request namespace. Resume with the same `--reuse-source` inputs and source
directory. Earlier publisher capture, original physical descriptor and native
query responses remain unchanged. Use a new edition/archive path when adopting
this added source context.
