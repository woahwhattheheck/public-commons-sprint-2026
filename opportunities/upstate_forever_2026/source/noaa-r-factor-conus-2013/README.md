# NOAA CONUS rainfall erosivity — original receiving records

These are the original small records for the NOAA archive already delivered in the existing Upstate operation. They complete the file inputs used by [the maintained erosivity receiving guide](../../source_tools/EROSIVITY_SOURCE.md).

| Original item | Identity |
| --- | --- |
| Archive | [NOAA-R-Factor-CONUS-original.zip](https://tokenjunkielabs.slack.com/files/U0BR9670G2H/F0C9BC7MKME/noaa-r-factor-conus-original.zip) |
| Archive bytes | 47,143,128 |
| Archive SHA-256 | `157bbcaa54b445f96506fb1caffda4bbaea6b28f71bc7199235705e69cd00596` |
| Original transfer | `DBC61-UPSTATE-NOAA-R-ORIGINAL-20261012` |
| Metadata capture | 2026-10-12, 07:28 UTC |
| Source period | 1975–1997; published December 26, 2013 |
| Native grid | 800 metre Albers Equal Area, NAD83 / GRS80 |

`metadata.html` is the complete original NOAA response. Its exact 65,357 bytes match the SHA-256 in `metadata.html.capture.json`. `source-transfer.json` is the completed original archive-transfer record, including the source response identity, streamed body hash, upload acknowledgment, finalized file ID and original thread readback. `source-records.json` gives the small-file hashes and physical-unit contract.

## Continue the original input

Use the existing file above through the receiving worker's normal authorized Slack file route. From the installed application, set `NOAA_ARCHIVE` to its actual local path and `SOURCE_ROOT` to the existing project root containing the retained original inputs and selected grid. Run the maintained commands:

```sh
python -B -m source_tools.erosivity_sources receive \
  --archive "$NOAA_ARCHIVE" \
  --transfer source/noaa-r-factor-conus-2013/source-transfer.json \
  --metadata source/noaa-r-factor-conus-2013/metadata.html \
  --metadata-receipt source/noaa-r-factor-conus-2013/metadata.html.capture.json \
  --output "$SOURCE_ROOT/noaa-r-received"

python -B -m source_tools.erosivity_sources prepare \
  --capture-directory "$SOURCE_ROOT/noaa-r-received" \
  --output "$SOURCE_ROOT/noaa-r-prepared"
```

The resulting `$SOURCE_ROOT/noaa-r-prepared/source-entry.json` selects the original numeric TIFF and declares its band scale and conversion. It joins the existing source composer directly. For the selected regional grid, use the same maintained climate preparation with the actual retained `REGIONAL_GRID_JSON` path:

```sh
python -B -m source_tools.climate_region \
  --project-root "$SOURCE_ROOT" \
  --grid "$REGIONAL_GRID_JSON" \
  --erosivity-entry "$SOURCE_ROOT/noaa-r-prepared/source-entry.json"
```

This produces the regional SI raster, derivation and ordinary source manifest used by the native SDR programme. The common project root must contain the original entry, companions, selected grid and output. Continue the same output directories to reuse completed preparation.

## Physical units in the maintained intake

NOAA's [original metadata](https://www.fisheries.noaa.gov/inport/item/48224/full-list) declares `(hundreds ft-tonf-in)/(ac-h-yr)`. The official [InVEST 3.20 SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html#rainfall-erosivity-index-r) specifies multiplication by **17.02** to obtain `MJ*mm/(ha*h*year)`.

The native-source preparation retains the original TIFF bytes and composes `original band scale × 17.02` in its conversion entry. The maintained raster aligner multiplies valid stored values once, retains NoData, and includes the conversion in its interrupted-tile identity. The regional climate output then declares SI units and retains the applied conversion as provenance; its top-level entry has no further multiplier.

The original 800 metre resolution and historical source period remain attached when this field is placed on the 30 metre working grid. Keep the named R-source edition with the soil, cover and native-parameter choices when reviewing the resulting sediment outputs.
