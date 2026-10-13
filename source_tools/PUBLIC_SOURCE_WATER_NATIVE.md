# Native preparation of the published source-water areas

This input package supplies the original SCDES surface-water intake response, the four published ARJWS/Pioneer protection polygons, and the original layer 0 and layer 2 metadata. It also supplies a source manifest, a four-receptor specification, and a local entrypoint for the installed native application.

## Prepare the existing Workspace

The maintained application includes the seven native preparation files and the complete original polygon response at source/water_context/20261012/public-water/raw/scdes-arjws-prwd-source-water-protection-original.json. Run the existing preparer directly against the actual South Carolina Workspace. It verifies the original body and prepares its source areas; the current application archive supplies all required source inputs.

The original polygon body was committed as acfc70fbc6e27380f27e396ebe344d814730b638 and independently read back byte for byte. For an older application whose original geometry has not yet been received, the same preparer accepts --geometry-carrier with the existing retained carrier below.

Existing original geometry carrier:
https://drive.google.com/file/d/1387FGNr-Rjpm9-pf1fzaUgPiNLThugRN/view?usp=drivesdk

It is the 841,516-byte scdes-original-public-source-water-polygons-20261013.md file. The receiver reads its 26 ordered source parts, validates both compressed and decoded identities, and retains the original 2,389,556-byte polygon JSON at the source manifest's relative path. Its original SHA256 is ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285. The same option also accepts the exact original polygon JSON, its one-file source bank, or a gzip copy.

For a receiver using the preceding application source, materialize the current preparation files into that application first. The preceding seven-file input bank remains at https://drive.google.com/file/d/1ilxo-C0HJx2aPA6muYV1sHHpJbz_6T1P/view?usp=drivesdk; the maintained Git preparer adds this direct geometry-carrier option.

Run this from the project root with the interpreter already used by the application's GIS engine:

~~~sh
/opt/pyvenv/bin/python source_tools/prepare_public_source_water.py \
  --model-root /ABSOLUTE/EXISTING/APPLICATION \
  --workspace /ABSOLUTE/EXISTING/WORKSPACE \
  --out /ABSOLUTE/NATIVE/PREPARATION/OUTPUT
~~~

The default source directory is source/water_context/20261012/public-water beside the entrypoint. Supply --source-dir when the original inputs are mounted elsewhere. For a preceding application that lacks the original JSON, add --geometry-carrier /ABSOLUTE/DOWNLOADED/scdes-original-public-source-water-polygons-20261013.md to the command above. Repeating intake reuses identical original bytes; an existing different source is preserved and reported. Each typed OBJECTID/INTAKE/BUFFER_FT selector must match one of the four distinct original records before import. The preparation result records the actual received carrier, original source path, bytes/hash and reuse state alongside the native collection and plan identities.

The entrypoint imports sources.public-native.json through Workspace.import_sources, uses the returned immutable collection ID in the four source selectors, and calls model.receiving_waters.prepare. The installed Workspace verifies the source and metadata hashes. The output public-water-preparation.json records the actual collection ID, plan ID/state, source hashes, original feature counts, and native selection path. The four receptors use relation.method source_area.

| Public utility | Intake OBJECTID | Intake ID | Protection OBJECTIDs |
| --- | --- | --- | --- |
| Anderson Regional Joint Water System | 6 | S04101 | 11 (1500 feet), 12 (200 feet) |
| Pioneer Rural Water District | 50 | S37109 | 131 (1500 feet), 132 (200 feet) |

Use each original polygon in its published geometry. BUFFER_FT records the publisher's existing buffer attribute. Family summaries use the installed engine's overlap union. Full upstream catchment connectivity remains a separate analysis scope.

## Continue into utility maps and scenario analysis

The preparation outcome also retains original_protection_sha256, taken from the actual imported polygon body. The current designation desk's utility companion consumes that field directly:

~~~sh
/opt/pyvenv/bin/python source_tools/prepare_utility_designations.py \
  --model-root /ABSOLUTE/EXISTING/APPLICATION \
  --workspace /ABSOLUTE/EXISTING/WORKSPACE \
  --preparation /ABSOLUTE/NATIVE/PREPARATION/OUTPUT/public-water-preparation.json \
  --out /ABSOLUTE/NATIVE/UTILITY/OUTPUT
~~~

The existing companion saves and reopens ARJWS, Pioneer, and combined-utility selections. Its optional --delivery argument takes an existing complete delivery selection and writes the combined utility overlay into that selection. The combined choice supplies all four original polygons through the single drinking_water overlay slot.

The preparation also writes scenario-source-areas.json, with schema upstate.scenario-source-areas/v1. This complete native form request contains selection.zones and the original preparation identity in origin. Each of the four zones retains its exact typed source selector, utility/intake metadata, source plan ID, receptor ID, and published-polygon scope. The native scenario form's **Add prepared source areas** input imports this file. A host can call createForSourceAreas with the same request and its current workspace_key.

Choose the baseline and scenarios in that form. Its model reports the selected published polygon intersected with the baseline reporting area, retaining the source-area origin with the saved analysis. Keep family totals from the receiving-water union when protection polygons overlap. Each zone remains available individually.

## Original Esri ring interpretation

The original Pioneer features 131 and 132 contain self-intersecting or touching
rings. Receiving waters reads declared Esri polygon sources through the maintained
`model.spatial_esri.OriginalEsriFeatures` reader, which delegates to
`source.capture_upstream_network.esri_polygon`, also used by Conservation.
That reader constructs the original rings, records each required Shapely
`make_valid` operation, and combines ring interiors by symmetric difference.
The original response, its ring coordinates, native OBJECTID values and source
hash remain unchanged. No additional buffer is applied.

Each new plan records the exact parser and adapter source hashes, original
decoded body identity, original coordinate reference, selected feature-array
positions and every geometry operation. These fields are in
`identity.source_identities[].geometry_reader`,
`identity.source_identities[].selected_features` and each receptor's
`original_features`. Analysis uses planar XY geometry in the plan's declared
projected metre CRS. A reconstructed valid analysis polygon and a publisher's
stored area attribute remain distinct retained values.

Receive `model/spatial_esri.py` and
`source/capture_upstream_network.py` with the corrected
`model/receiving_waters.py`. The receiving-water component fragment includes
both original dependencies. Then rerun the same preparation command against the
existing Workspace and outside-Workspace output directory. It reuses the exact
original source collection and saves a new content-bound plan. Its implementation
and source-reader identities distinguish it from any earlier saved plan; earlier
records remain available unchanged. Continue with that newly written
`public-water-preparation.json` for maps, monitoring priorities and reports.

Other vector formats retain their existing reader and validation. Unsupported
Esri non-polygon geometry follows the original GDAL path; malformed Esri polygon
responses, CRS inconsistencies and unresolved invalid output fail explicitly.

## Original public sources

Public layer directory:
https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer

Full original intake response:
https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&orderByFields=OBJECTID&resultRecordCount=2000&f=json

Full original selected protection response:
https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2/query?objectIds=11,12,131,132&outFields=*&returnGeometry=true&orderByFields=OBJECTID&f=pjson

The four original bodies keep their captured bytes and SHA256 identities. The manifest and receptor specification use official source URLs and public record identifiers. The new local entrypoint uses the installed application's APIs and performs no network upload. Source acquisition occurred on 2026-10-12; an unstated underlying publisher dataset edition remains unstated.
