# Receive the original native land-cover TIFFs through ordinary text source

This carries the exact published 2023 and corrected 2025 GeoTIFF bytes. Use it on the existing native receiver when its public HTTPS/DNS route cannot download a TIFF. Every part is an ordinary UTF-8 repository file of at most 524,289 bytes, readable by the normal source connector. No new source acquisition is involved.

## Source files

Read `transfer.json` first. It lists every ordered part, its full UTF-8 SHA256 and decoded byte count, plus each complete TIFF identity. Retain each part under its exact relative path below this directory. There are 25 parts for 2025 and 23 parts for 2023. Do not base64-decode the connector's text twice: save the actual textual file body, including its final newline. If using the Contents API, first decode its outer transport encoding to recover that same text body.

The manifest also lists twelve existing source companion files under the two annual source trees. Receive those exact ordinary text files into the application root; they include the native source manifests, original acquisition plans, class areas and exhaustive serialized-raster verification. They are byte-identical to their previously merged originals.

## Exact reconstruction

From the receiving application root:

```sh
python -B source/annual-nlcd-binary-transfer-20261013/receive.py --application-root .
```

To receive only one year, add `--year 2025` or `--year 2023`. The stdlib receiver verifies all selected parts and source companions before writing, reconstructs one part at a time, checks the final original TIFF byte count/SHA256, syncs it and publishes it exclusively. Repeated invocation accepts exactly matching retained TIFFs. A different file at the selected destination is reported explicitly. It needs at most one TIFF-sized temporary file plus the retained text parts; remove received text parts after successful publication if the native operator needs their disk space.

The resulting ordinary import manifests are:

- `source/annual-nlcd-native-20261013/source/source-manifest.json` — corrected 2025.
- `source/annual-nlcd-2023-native-20261013/source/source-manifest.json` — original 2023.
- `observations/landcover_2023_2025/model-sources.json` — completed 217-HUC annual and paired analysis.

Use the same actual project Workspace and the existing `model.landcover_cli` fractional-area operation after receipt. The completed cell-centre analysis is already available independently as JSON/CSV. The byte transfer preserves the exact 30 m EPSG:5070 source grid and each selected source year.

## Raster identities

| Year | Bytes | SHA256 |
| --- | ---: | --- |
| 2023 | 8,931,261 | d7db3a30d6595aa8da28b5e81dc5b84e7e0bf198b860543ac32c702328871fc5 |
| 2025 | 9,443,751 | 3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670 |

Both final serialized TIFFs were compared against all 49 original decoded source PNG tiles: 40,713,317 matching cells per year, zero mismatches and zero NoData. The defective historical 2025 TIFF with SHA256 beginning a9f6 is superseded by the identity above.
