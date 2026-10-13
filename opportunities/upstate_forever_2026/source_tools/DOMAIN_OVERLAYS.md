# Full upstream context and wetland mapping coverage

Operation: UPSTATE-UPSTREAM-CONTEXT-DATA-20261012.
Project: opportunities/upstate_forever_2026/.
Source files: source_tools/domain_overlays.py and two compatible edits in
source/capture_original_overlays.py.

## What this supplies

Capture completes the native NHD flowline, NHD waterbody, NWI wetland, PAD-US
manager inventory and official NWI mapping-status layers across the full retained
upstream domain. The maintained collector already handles original provider
responses, ID selection, count reconciliation, native coordinate systems, source
curves, disjoint pages and resumable retrieval; this adapter supplies the missing
upstream selection and independent completion behavior.

Acquisition uses projected 50 km tiles that cover the original 217-HUC domain
plus a 2 km context buffer. These are request partitions, not a scientific
resolution. Full native features intersecting those tiles are retained, including
edge overcoverage. The model-domain mask determines analytical output. Acquisition
does not wait for the numeric NLCD archive.

The additional NWI status source distinguishes Digital from No_Data. Wetland
occurrence and mapping availability remain separate rasters. An observed NWI
polygon remains visible even when the separately dated mapping-status source is
unknown. A cell with digital mapping and no NWI polygon has class zero; unknown
occurrence remains NoData. Class zero describes the published inventory rather
than a field determination that wetlands are absent.

## Install in the current maintained project

Add source_tools/domain_overlays.py. In the current collector, replace only the
coverage expression opening:

    "coverage": (

with:

    "coverage": spec.get("coverage") or (

Preserve the existing conditional coverage strings. The exact intended block is
included in the delivery JSON as a base-aware textual replacement against blob
9a86a34bd5dc13dcbdafde4f324ce641c2425914. Apply it before the first capture. Existing
reporting and focus commands keep their previous descriptions.

Apply the second exact capsule edit to equivalent_sr. It compares identical native WKT,
identical WKID and the existing known Web Mercator aliases before importing pyproj.
It preserves the original vertical-CRS check and full pyproj comparison for other
coordinate declarations. This removes the collector's one GIS dependency for the
published native declarations of these five services. Distinct or complex declarations
still receive the original full comparison; original CRS metadata remains unchanged.

Reuse the installed native Python, Shapely 2, pyproj, Fiona and rasterio runtime.
The original source modules must be present. Run from the maintained project root.

## Run on the existing split GIS and network hosts

The source operation supports two physical environments. The offline GIS host plans the
exact acquisition using Shapely/pyproj and the original 217-HUC domain. The connected host
then receives original provider features using standard-library Python. Receive does not
import the GIS planning or raster preparation modules. The existing original collector
and its network helpers also have only standard-library eager imports. Its per-page
CRS comparison uses the compatible exact-declaration edit described above.

On Terrain12/ECO12, run from the maintained application root with the existing GIS interpreter:

    /opt/pyvenv/bin/python -m source_tools.domain_overlays plan \
      --domain /mnt/data/eco12-source/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz \
      --expected-features 217 \
      --output /mnt/data/eco12-source/upstream-context-plan \
      --archive /mnt/data/eco12-source/upstream-context-plan.zip

Use the original extracted domain member in that source volume; ESI-178D's already retained
member is /dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz. The original
domain archive is dbc61-upstate-model-domain-20261012.zip, 8,800,689 bytes, SHA256
1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04.

Plan returns the exact original archive path, byte length and SHA256. The resulting ZIP carries
plan.json, masks.json, plan-transfer.json and every original domain member. Its request masks
use the full retained domain and original acquisition parameters. Transfer that actual ZIP
through the existing artifact receiver to the connected host. The currently proven binary
bridge is Google_Drive.upload_file(file_uri=<local mounted ZIP path>, file_name=<archive
name>, mime_type='application/zip'), then the receiver uses Google_Drive.fetch(url=<stable
Drive link>, download_raw_file=true, include_base64=false). Keep this transfer binary.

On 405F, run from its maintained application root,
 /dev/shm/upstate-405f-20261012/application, with its existing Python interpreter:

    python -m source_tools.domain_overlays receive \
      --plan-archive /dev/shm/upstream-context-plan.zip \
      --output /dev/shm/upstate-upstream-context-20261012

Supply --archive-sha256 with the exact SHA256 printed by the transmitting GIS host when
receiving its retained archive. Receive validates member hashes, request-mask identity,
original domain members, native coordinate declarations and installed provider contracts.
It preserves the same five-source capture output and requires no geospatial package
installation on the network host. Apply both capsule collector edits on
that receiver before capture.

Resume the same receive directory with the installed source module:

    python -m source_tools.domain_overlays receive \
      --output /dev/shm/upstate-upstream-context-20261012 \
      --retry-failed

Keep the complete original response folders when transferring the capture back to the GIS
host for prepare-nwi and Workspace intake. Each completed layer can be integrated while
another provider is recovering. The combined capture command below remains convenient for
a host that already has both GIS libraries and provider connectivity.

## Acquire now

    python -m source_tools.domain_overlays capture \
      --domain /dev/shm/dbc61-upstate-model-domain-20261012/model-domain.esri.json.gz \
      --expected-features 217 \
      --buffer-m 2000 \
      --tile-m 50000 \
      --output /absolute/retained-sources/upstream-context-20261012

Resolve the domain filename from the existing archive on the native host before
invocation. The directory above is the current known native domain location;
the command must use the original extracted member.

The five source IDs are nwi-mapping-status, nwi-wetlands, nhd-flowline,
nhd-waterbody and padus-manager. --sources accepts a comma-separated subset when
recovering a specific source; it does not discard already completed layers.
--metadata-root can reuse the existing verified overlay-metadata directory.
--retry-failed creates the next retained attempt for a failed original request,
honoring its provider Retry-After. Keep the same output directory and parameters
when recovering an interrupted operation.

capture-progress.json points at the current immutable source-manifest-*.json.
sources.json contains the same usable source inventory. Each successful layer is
published immediately. Exit 2 means the overall five-layer capture is partial;
the progress file identifies exact source failures and the successful native
layers remain available for import. Re-run the original operation to finish the
remaining sources. Do not launch a parallel duplicate against the same directory.

## Prepare after the original NLCD raster arrives

    python -m source_tools.domain_overlays prepare-nwi \
      --capture /absolute/retained-sources/upstream-context-20261012 \
      --reference /absolute/retained-sources/nlcd/landcover.tif \
      --buffer-m 1000 \
      --reporting source/geography/planning_basins2023/PlanningBasins2023.shp \
      --reporting-where-json '{"Basin":"Upper Savannah"}' \
      --focus source/geography/wbd_20261012/selected-four-huc12.json.gz \
      --output /absolute/retained-sources/nwi-context-grid-20261012

Use the actual prepared NLCD filename returned by its original source entry. The
reference must be the real numeric raster with its retained projected metre grid.
Preparation checks the actual acquired tile footprint before rasterization and
uses the existing exact 30 m grid definition and pixel-centre selection.

Outputs:

- nwi-occurrence.tif: native wetland type codes, documented zero, overlap conflicts
  and NoData.
- nwi-mapping-status.tif: Digital, No_Data, conflicting source status, unknown
  status and outside-domain codes.
- coverage.json: quantities for the exact unbuffered model domain, the prepared domain
  with its context buffer, SC reporting mask and each of the four focus watersheds, plus
  geometric coverage denominators.
- plan.json: original source hashes, exact grid, classification dictionaries,
  extra geography and native mapping-scale lineage.
- source-entry.json and sources.json: portable native workspace import.
- original/: complete retained source bodies, requests, masks and source domains.

The NWI rasters are contextual overlays; the existing InVEST NDR/SDR engine and
its model inputs remain in the maintained scientific workflow. NWI polygon
mapping scale does not become 30 m survey resolution because it is rasterized.

## Join the current source composer

Import the native context capture and the prepared context raster through the
existing source_tools.compose command. Put the composed manifest above both
source directories so every original path remains inside its declared root:

    python -m source_tools.compose \
      --manifest /absolute/retained-sources/upstream-context-20261012/sources.json \
      --manifest /absolute/retained-sources/nwi-context-grid-20261012/sources.json \
      --output /absolute/retained-sources/upstream-context-sources.json

Select the resulting original source IDs in the maintained operator. NHD
flowlines and waterbodies retain role NHD; native wetlands retain NWI; manager
inventory retains PROTECTED_LANDS. NWI_MAPPING_STATUS and NWI_CONTEXT are explicit
additional context roles. PAD-US contains overlapping records; use a geometric
union when calculating protected area.

## Source references and observed interface

- Existing collector and service contracts:
  source/capture_original_overlays.py, blob
  9a86a34bd5dc13dcbdafde4f324ce641c2425914.
- USFWS wetlands:
  https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0
  Metadata observed 2026-10-12: polygon layer, native EPSG:3857,
  OBJECTID, ATTRIBUTE, WETLAND_TYPE, maxRecordCount 500, original Z enabled.
- USFWS mapping status:
  https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands_Status/MapServer/0
  Metadata observed 2026-10-12: polygon layer, native EPSG:3857,
  OBJECTID, STATUS; renderer uses Digital and No_Data.
- Mapping interpretation:
  https://www.fws.gov/program/national-wetlands-inventory/wetlands-mapper
- USGS NHD:
  https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer
- USGS protected lands:
  https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS_Manager_Type/FeatureServer/0

Native capture receipts determine the actual source editions consumed by a run.
