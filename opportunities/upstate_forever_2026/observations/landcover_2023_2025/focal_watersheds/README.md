# Priority watershed land-cover context, 2023–2025

The actual annual NLCD source classifications show different patterns among the four RFP focus watersheds and the Eighteenmile study context. The four focus watersheds jointly contain 53,008.20 hectares selected by the original 30 m cell-centre rule. Of these, 1,580.85 ha change class (2.9823%); the developed group gains 251.28 ha and forest loses a net 233.73 ha.

| Original watershed | Changed class (%) | Changed class (ha) | Developed net (ha) | Forest net (ha) | Forest gross loss / gain (ha) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Upper Six And Twenty Creek (030601010703) | 3.36 | 259.74 | +44.64 | -35.82 | 70.65 / 34.83 |
| Lower Six And Twenty Creek (030601010704) | 3.06 | 341.73 | +125.73 | -136.71 | 149.13 / 12.42 |
| Choestoea Creek (030601020502) | 2.74 | 272.16 | +23.04 | -60.39 | 97.38 / 36.99 |
| Lower Tugaloo River (030601020507) | 2.93 | 707.22 | +57.87 | -0.81 | 180.09 / 179.28 |
| Upper Eighteenmile Creek (030601010601) | 3.71 | 332.46 | +52.02 | -21.87 | 89.28 / 67.41 |
| Lower Eighteenmile Creek (030601010602) | 3.49 | 224.91 | +93.33 | -26.73 | 58.23 / 31.50 |
| Upper Seneca River (030601010803) | 2.54 | 307.71 | +70.38 | +4.14 | 55.62 / 59.76 |

## What the full transitions add

Lower Six And Twenty Creek contributes 125.73 ha of the four-focus total developed-group increase. Its original matrix contains 48.96 ha classified forest in 2023 and developed in 2025, plus 53.55 ha classified pasture/hay or cultivated crops in 2023 and developed in 2025. Those are explicit directional group crossings; the net increase also includes other incoming and outgoing transitions.

Lower Tugaloo illustrates why both directions matter: 180.09 ha cross from forest to nonforest classes, while 179.28 ha cross in the other direction. The net forest change is therefore only −0.81 ha. Transitions among deciduous, evergreen and mixed forest remain inside the forest group and do not count toward those gross group crossings.

Upper and Lower Eighteenmile together represent the original HUC10 0306010106. Their selected source area is 15,419.61 ha; 557.37 ha change class (3.6147%). The developed-group net increase is 145.35 ha, with a net forest decrease of 48.60 ha. These are the complete two component watersheds. The actual gauge-contributing catchment and each monitoring station retain their own geography.

Upper Seneca River is included separately because the current official WBD point query places study station SV-840 in HUC12 030601010803. Its original lake-study membership stays intact. It is not added to the two-HUC Eighteenmile subtotal.

## Definitions and scientific use

Developed combines codes 21–24; forest combines 41–43; agriculture combines 81–82; wetland combines 90 and 95. These are explicit mutually exclusive groups of the publisher's sixteen classes. Developed includes vegetated open-space settings in class 21, so its group area has a different meaning from measured impervious surface area. Woody wetlands remain in the wetland group.

Source class definitions: https://www.mrlc.gov/data/legends/annual-nlcd-land-cover-legend (retrieved 2026-10-13).

All changed-class percentages use the same paired valid cell count in both years. Net values are after minus before. Gross loss/gain are crossings out of/into a group; internal class swaps are excluded. The companion retains integer counts, complete original matrices and the native affine pixel-area determinant. Two-decimal display is a reading convention; exact derived doubles remain in CSV.

This is descriptive context for source review, selection of model inputs and comparison of candidate management areas. The annual classifications do not identify a physical cause or exact change date. Nutrient, sediment, microbial and other outcomes require their corresponding observed or modelled quantities. The existing native fractional-boundary land-cover ledger uses a separate spatial method.

## Original sources and reproducibility

The seven original annual watershed records were selected without editing their contents from merged3547 annual-2023.json and annual-2025.json. The retained selected-source file binds both whole-file SHA256 values and the actual domain/raster metadata. The complete seven original transition matrices come from merged3592 study-seven-huc-transitions.json, unchanged. Its top-level domain still describes all217 units, while selection and watersheds explicitly identify the seven retained rows.

Domain: 217 original HUC12 features, decoded SHA2562300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af. Pixel rule: centre inclusion, half-open scanline edges, even-odd ring parity. The original3857→5070 vertex transform, native control and 4 m stated operation accuracy remain in the input method. Source grid6443×6319, nominal30m; the determinant retains its actual floating-point coefficients.

Run from this folder:

```sh
node rebuild.mjs --check
```

Without --check, the same command writes focal-summary.csv and group-change.csv. It verifies the two retained source-file SHA values before computing, all seven paired denominators, both sixteen-class annual margins and each group's gross/net identity. Ordinary `model-sources.json` imports the two tables and all source/method companions into the existing Workspace.

Original parent source: observations/landcover_2023_2025 at ea6a7579a98d7192861eb74a380952671c9154b5. Exact selected matrix successor:4832ca7e3ade7ec61a151800abf290d970b3c905. Both actual rasters and all217 annual/paired results stay with that maintained source family.
