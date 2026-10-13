# Original PRISM annual precipitation input

The retained `source-transfer.json` is the unchanged completed source record recovered from the [original Ecosystem Sciences source thread](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791842427025379). Its complete body also appears in source-preparation packet `F0C8MSHTJG6`.

| Identity | Retained value |
| --- | --- |
| Product | PRISM 1991–2020 precipitation annual normal, 30 arcseconds (nominal 800 m) |
| Source archive | https://data.prism.oregonstate.edu/normals/us/800m/ppt/monthly/prism_ppt_us_30s_2020_avg_30y.zip |
| Operation | `DBC61-UPSTATE-PRISM-ANNUAL-ORIGINAL-20261012` |
| Original Slack file | `F0C8H2FGAUV` |
| Archive bytes | 62,685,097 |
| Archive SHA256 | `763f97b677711112ff7b1082c794476e2d9b7abe1f6e55dd4f1166e32523ccd3` |
| Transfer bytes | 3,873 |
| Transfer SHA256 | `42ae6aa2a7d9fb987983c970ccc130b9045e330cd7e893f6dc92b67e01f68a53` |
| Body streamed at | 2026-10-12T19:45:10.420402Z |
| Destination recovery completed at | 2026-10-12T20:43:18.225866Z |

The source record preserves the actual HTTP header observation, complete body digest, successful upload acknowledgment, completed file ID and original channel/thread readback. Its `provider_completion` remains null: the destination recovery found the completed original file after the finalization journal was interrupted. The maintained receiver accepts this explicit recovered form and still verifies the actual local archive length and SHA256, source/body agreement, upload acknowledgment, original file ID and destination readback. It rejects failed provider responses and incomplete recoveries.

From the installed application, select the actual existing original archive and the existing precipitation output directory:

```sh
"$UPSTATE_PYTHON" -B -m source_tools.raster_sources prism \
  --archive "$PRISM_ARCHIVE" \
  --transfer source/prism-precipitation-1991-2020/source-transfer.json \
  --output "$PRECIPITATION_OUTPUT"
```

This continues the original preparation operation and retains the full unchanged archive, metadata and source receipt. The existing source helper retains the unique original GeoTIFF, its native grid and band metadata. The produced `source-entry.json` feeds the maintained climate alignment and source composer.

Precipitation is the explicitly selected annual runoff proxy for NDR. The prepared source records precipitation in millimetres, with any native band scale recorded as an explicit conversion. Alignment to the common 30 m model grid retains the original product's 800 m source resolution and 1991–2020 period in its provenance.

Original product references: [PRISM formats](https://prism.oregonstate.edu/formats/), [dataset definitions](https://prism.oregonstate.edu/documents/PRISM_datasets.pdf), and [attribution](https://prism.oregonstate.edu/terms/).
