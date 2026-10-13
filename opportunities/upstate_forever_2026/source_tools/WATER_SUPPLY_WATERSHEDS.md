# Original Georgia EPD water-supply watershed source

This receiver prepares the complete original **Savannah–Upper Ogeechee water-supply watershed GIS archive** published by Georgia EPD. It imports the native vector layers and their original attributes, produces a printable source report, and can calculate their intersection with a selected original scientific Workspace domain.

EPD describes these maps as the areas upstream of governmentally owned public drinking-water intakes under **Georgia Rules 391-3-16-.01**. This is source-water protection geography. The classified-water register for designated stream uses and trout clauses under **391-3-6-.03** remains a separate source.

## Original agency source

- Agency page: https://epd.georgia.gov/water-supply-watersheds
- Original GIS ZIP: https://epd.georgia.gov/document/document/water-supply-watershed-maps-savannah-upper-ogeechee-gis/download
- Original agency map: https://epd.georgia.gov/document/document/savannah-upper-ogeechee-watershed-map/download
- Captured archive: 2,453,313 bytes on 2026-10-13.
- Complete retained original: georgia-epd-savannah-upper-ogeechee-original-water-supply-watersheds.zip, attached to the existing source case.

Use the already retained archive. The helper performs no network request. Supply its actual SHA256 with `--sha256` when the original receiving operation has returned it. The default byte count is the actual captured edition; an explicitly selected different agency edition must provide its own count and hash.

The source publication date is not inferred from the download date. The source manifest identifies the retained archive as a source-published edition captured on 2026-10-13.

## Inspect the complete original

From the original application root:

```sh
python -m source_tools.water_supply_watersheds \
  /actual/retained/georgia-epd-savannah-upper-ogeechee-original-water-supply-watersheds.zip \
  --inspect > /actual/receiving/water-supply-archive-inventory.json
```

This inspection stage requires only Python's standard library; the complete same source file can also run directly as `python /actual/received/water_supply_watersheds.py ORIGINAL_ZIP --inspect`. It does not import Fiona, Shapely or pyproj. It reports:

- The original ZIP byte count and SHA256.
- Every original member, its compressed/uncompressed bytes, CRC32 and SHA256.
- Every complete shapefile, its original sidecars and literal PRJ/CPG.
- Original DBF field names, types, lengths, decimal counts, record count and deletion count.

ZIP member names must be portable and unique, and the source cannot contain encrypted members, links or special files. The receiver checks the actual original CRC and rejects incomplete shapefile sidecars. It preserves original directory relationships.

## Prepare and import the original layers

Use the accepting host's existing GIS interpreter and existing scientific Workspace:

```sh
/actual/gis/python -m source_tools.water_supply_watersheds \
  /actual/retained/georgia-epd-savannah-upper-ogeechee-original-water-supply-watersheds.zip \
  --sha256 ACTUAL_ORIGINAL_ARCHIVE_SHA256 \
  --output /actual/receiving/ga-water-supply-original \
  --workspace /actual/existing/scientific-workspace
```

The command reads every original layer with Fiona, retains its native CRS, schema, FID and full attribute row, checks native feature count against nondeleted original DBF records, and imports one normal `upstate.sources/v1` vector source per original layer. The complete archive and all extracted native members are retained as companions. Original geometry is never repaired or rewritten.

It saves:

| Artifact | Purpose |
|---|---|
| `original-archive.zip` | Complete original compressed source |
| `original/` | Every exact source member with native paths |
| `archive-inventory.json` | Complete original ZIP, DBF and PRJ identities |
| `native-layer-inventory.json` | Actual Fiona layer, fields, CRS, extent and geometry conditions |
| `native-attributes.json` and `.csv` | Every native FID and original attribute row |
| `request.json` | Exact archive, layer interpretation and optional domain selection |
| `sources.json` | Native Workspace source manifest |
| `report.html` | Printable human source inventory with complete source downloads |
| `preparation.json` | Complete result and verifiable retained artifact membership |

The returned `collection_id` is the existing Workspace's real imported source edition. Source IDs derive from original member names and are qualified by that collection. Preserve both when selecting a layer.

### Explicit publisher layer roles

An unreviewed original member is assigned `WATER_SUPPLY_SOURCE`. Its native layer name and original attributes remain visible. Do not infer a protected watershed or legal setback from a name fragment.

After reading the actual original inventory and agency layer metadata, an explicit selection may use:

```json
{
  "archive_sha256": "ACTUAL_ORIGINAL_ARCHIVE_SHA256",
  "layers": {
    "exact/original/member.shp": {
      "title": "Exact publisher layer title",
      "role": "WATER_SUPPLY_WATERSHED",
      "interpretation": "Source-qualified meaning from the original agency layer.",
      "id_field": "ACTUAL_NATIVE_FIELD"
    }
  }
}
```

Pass this file with `--layers`. Allowed roles are `WATER_SUPPLY_WATERSHED`, `WATER_SUPPLY_STREAM`, `WATER_SUPPLY_BUFFER`, and `WATER_SUPPLY_SOURCE`. A supplied identity field is checked against the actual original schema. Native FIDs remain present even when the publisher identifier is null or repeated.

The selection must name real members in the selected archive. It is retained in the immutable request and source metadata. A changed meaning is a new prepared edition, not a mutation of a completed source.

## Calculate the original study intersection

The same command can select the actual retained domain in that Workspace:

```sh
/actual/gis/python -m source_tools.water_supply_watersheds \
  /actual/retained/georgia-epd-savannah-upper-ogeechee-original-water-supply-watersheds.zip \
  --sha256 ACTUAL_ORIGINAL_ARCHIVE_SHA256 \
  --layers /actual/receiving/verified-layer-roles.json \
  --output /actual/receiving/ga-water-supply-original-with-domain \
  --workspace /actual/existing/scientific-workspace \
  --domain-collection ACTUAL_DOMAIN_COLLECTION_ID \
  --domain-source upstate-wbd-upstream-domain-20261012 \
  --expected-domain-count 217
```

This reads the existing native domain through the maintained `monitoring_sources.read_source`, verifies the complete original source binding, and retains the whole original domain edition. It uses the union of the complete original polygons, so overlapping domain boundaries do not double count a source feature.

Source geometries are projected from each original declared CRS to **EPSG:5070**, a metre-based equal-area coordinate system appropriate to the conterminous United States. The derived view retains:

- Every original layer/FID and original attribute row for an intersecting source.
- Whole-source and domain-intersection areas in square metres for polygons.
- Whole-source and domain-intersection projected planar lengths in metres for lines.
- The fraction of each original feature inside the selected domain.
- Explicit zero-measure boundary contacts and original geometry conditions.
- Complete original domain and source bindings.

The original vectors remain unchanged. Derived files are `domain-intersection.geojson`, `domain-intersection.csv`, and `domain-intersection.json`. The GeoJSON explicitly declares EPSG:5070 and is registered with the same CRS in its native source entry.

An original null, empty or invalid geometry remains in the retained source and is listed as excluded from intersection. The helper does not silently repair it. Source findings can therefore be corrected in the same original case without losing the complete publisher record.

### Interpretation for utility and parcel work

Use the resulting intersection to identify which published water-supply protection features touch the selected watershed domain, then inspect the original layer and attributes before preparing a utility or parcel briefing.

Keep watershed polygons, stream lines and buffer polygons separate. Their geometries may overlap or nest; their measured areas and lengths are not additive across roles. A study intersection is a geographic result, not a new legal designation. A GIS buffer is not a substitute for the rule's intake, stream and site-specific conditions.

This source supplies geographic context. It does not add drinking-water treatment performance, flow records, monitoring observations or pollutant calibration values.

## Reopen, export and interruption recovery

Run the same command and output directory to resume. The output is protected by the existing native lock. The original archive, request, extracted members and completed artifacts are immutable; a conflicting source or domain selection is rejected. Completed artifacts are verified before a saved result is returned. Importing again calls the existing Workspace content-addressed source intake and returns its real source edition.

Prepare outside the scientific Workspace. The helper never creates a second Operator or queue and does not run InVEST. Once imported, use the existing source catalogue, native GIS export, portable Workspace export and recipient restore workflows. The source entry's complete original archive, extracted sidecars, attribute inventory and report remain companions.

The receiving host should return the actual application/interpreter, original archive SHA256, native layer/feature counts, prepared directory, imported collection ID, and optional exact domain binding plus intersection count. These are the fields needed to open and continue the existing source operation.
