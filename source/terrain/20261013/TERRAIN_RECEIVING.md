# Upper Savannah original terrain intake

This source packet resolves the original 217-HUC model domain and its 1000 m buffer
to nine original USGS 3DEP one arc-second products. It retains all nine publisher
directory bodies and all nine original FGDC XML files, with exact bytes and SHA256.
The complete inventory is inventory.json in this directory.

## Selected source editions

| Tile | XML publication | TIFF bytes | Horizontal / vertical units |
|---|---|---:|---|
| n34w084 | 20230215 | 57712914 | NAD83 / NAVD88 metres |
| n34w083 | 20230215 | 57942365 | NAD83 / NAVD88 metres |
| n34w082 | 20220725 | 57976835 | NAD83 / NAVD88 metres |
| n35w084 | 20230215 | 57517424 | NAD83 / NAVD88 metres |
| n35w083 | 20230215 | 56413962 | NAD83 / NAVD88 metres |
| n35w082 | 20260417 | 58566573 | NAD83 / NAVD88 metres |
| n36w084 | 20220725 | 58007875 | NAD83 / NAVD88 metres |
| n36w083 | 20220512 | 57595140 | NAD83 / NAVD88 metres |
| n36w082 | 20260417 | 57522162 | NAD83 / NAVD88 metres |

The nine TIFFs total 519255250 bytes; their XMLs total 113818 bytes and
GeoPackage companions 3084288 bytes. Each original grid is 3612 by 3612
cells with the publisher's border overlap. Source acquisition periods are retained
per tile: publication dates and source collection periods have different meanings.
The n35w083 original metadata includes a 1955 start date; the inventory preserves it.

## Original geographic selection

The original 5062-byte EPSG:5070 source plan has SHA256
41296472d82dfb53e65b9fa86045cf5facba33d567977269f69437d53f9eefa9.
Its buffered_domain_bounds are the input to the retained derivation. The Albers
inverse uses the NAD83 GRS80 ellipsoid, latitude origin 23°, central meridian −96°,
and standard parallels 29.5° and 45.5°. Across this positive-easting rectangle below
rho0, longitude increases with x and y; latitude decreases with x and increases
with y. Its corner values therefore give exact extrema of the transformed rectangle.
The inverse uses the EPSG Albers q equation with a converged latitude solve.

The resulting NAD83 geographic envelope is
[-83.8743318014598,33.335571299652926,-81.48972373077227,35.25542325044666].
The coarse acquisition envelope is rounded outward with at least 0.01 degree padding:
[-83.89,33.32,-81.47,35.27]. This padding leaves the same nine one-degree tile IDs
and accommodates the coarse geographic source-index selection. The original
model grid and domain mask stay with the native Workspace.

## Continue in the existing application

Use the accepting application's existing GIS Python, actual retained terrain
store and original Workspace. Run the existing maintained commands from the
application directory. The terrain store belongs on the receiving operation's
actual retained filesystem. Acquisition keeps original source entities and their
own recovery records; reusing that store resumes the same transfers.

```sh
"$GIS_PYTHON" -B -m source_tools.terrain_cli --store "$TERRAIN_STORE" discover \
  --bounds -83.89 33.32 -81.47 35.27 \
  --title "Upper Savannah retained 3DEP source edition"
```

Use the actual relative catalog_path returned by discover, joined to the terrain
store. The existing acquire API resolves that full path under the same store:

```sh
"$GIS_PYTHON" -B -m source_tools.terrain_cli --store "$TERRAIN_STORE" acquire \
  "$TERRAIN_STORE/$CATALOG_RELATIVE_PATH" --workers 2
```

The maintained discovery operation captures current original HTTP bodies and
provider headers into its own upstate.terrain-catalog/v1 record. This packet's
original bodies and listed editions let the receiver compare the same selected
publisher products. Keep the acquired XML hashes beside this inventory; if a
mutable USGS current product changes, retain its actual new edition through the
same native catalog/source machinery.

Once the original numeric NLCD source and original domain are imported, bind
these nine terrain sources to that exact grid through the existing Workspace:

```sh
"$GIS_PYTHON" -B -m source_tools.terrain_cli --store "$TERRAIN_STORE" plan-workspace \
  --workspace "$NATIVE_WORKSPACE" \
  --reference-collection-id "$NLCD_COLLECTION_ID" --reference-source-id "$NLCD_SOURCE_ID" \
  --domain-collection-id "$DOMAIN_COLLECTION_ID" --domain-source-id "$DOMAIN_SOURCE_ID" \
  --buffer-m 1000 --resampling bilinear --chunk-size 1024
```

Select the exact nine source IDs returned by acquire using repeated --source-id
arguments if the existing store already contains another terrain edition. Read
the returned plan_id, then finish and import it into the same Workspace:

```sh
"$GIS_PYTHON" -B -m source_tools.terrain_cli --store "$TERRAIN_STORE" prepare \
  "$TERRAIN_PLAN_ID" --workspace "$NATIVE_WORKSPACE" --progress
```

The maintained preparation builds a source-lattice mosaic and performs the
selected reprojection onto the original NLCD grid. Its original inspector,
completed manifest, source entry and workspace source ID are the receiving result
for regional_job.run_core. Keep those actual returned paths/IDs in the original
regional source operation alongside the NLCD/PRISM/soil inputs.

## Source references

- Publisher: https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/1/TIFF/current/
- Projection equations: https://gdal.org/en/stable/proj_list/guid7.html (Albers method 9822).
- Albers operation: https://proj.org/en/stable/operations/projections/aea.html
- USGS CONUS Albers parameters: https://eesc.usgs.gov/MBR/bbs/geographic_information/BBS_grid_metadata.html
- Original USGS WBD feature source: https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6
