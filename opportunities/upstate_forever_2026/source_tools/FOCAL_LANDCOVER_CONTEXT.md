# Priority watershed land-cover interpretation

This source turns the already-published seven-watershed interpretation into a complete, portable Scientific Report edition. It retains the four original RFP focus HUC12s, the two Eighteenmile HUC10 components and separate Upper Seneca/SV-840 context. It reads the original annual classifications and matrices; source calculations remain unchanged.

## Open the complete published edition

Import `observations/landcover_2023_2025/focal-report/source-manifest.json` through the existing Sources desk in the current regional Workspace. Open the returned document in Scientific Reports, append it to the existing ordered source selection, and save the report. The normal renderer reads its top-level `figure_spec` and `figures` and renders four native vector panels alongside the complete original tables.

The retained `focal-report.html` opens offline and prints the entire focal interpretation. It provides direct downloads of the original CSVs, the vector figure, exact geographic-group summary, original source-author README, seven selected full source bodies, and five complete parent source bodies. Full and selected-source Workspace handover use the existing report/source transfer paths; both original and interpreted quantities travel as complete companions.

Use this edition beside the complete 217-watershed paired report from `observations/landcover_2023_2025/scientific-report/source-manifest.json`. It gives the four priority watersheds a focused reading without changing the broader report's domain or denominator. The dated-observation profiles and gauge whole-catchment source remain separately identified documents.

## Reproduce from the actual retained sources

From the application directory, with an existing output parent:

```sh
node source_tools/focal_landcover_context_cli.mjs \
  --focal-source-manifest observations/landcover_2023_2025/focal_watersheds/model-sources.json \
  --parent-source-manifest observations/landcover_2023_2025/model-sources.json \
  --output /actual/owned/output/new-focal-report
```

The CLI publishes to a new directory, writes the manifest last and returns the original source ID and complete file counts. The output parent's real path must be supplied. Original source symlinks cannot redirect reads outside their source directory. A failed write leaves an explicit `.incomplete` marker and never replaces an existing output directory.

The pure function `composeFocalLandcoverContext({files, parentFiles})` takes filename-to-complete-UTF8/Uint8Array maps and returns `{sourceId,recipe,manifest,files,summary,reconciliation}`. It uses the maintained pure-JavaScript archive codec only for original byte encoding and SHA-256. The maintained numerical raster engine is not invoked.

## What is preserved and checked

All seven focal body hashes and five complete original parent body hashes are fixed to the actual published edition. Selected 2023 and 2025 watershed records and all seven complete matrices must match the corresponding full original bodies. The selected change-summary lines retain their exact original order and bytes.

The existing seven-row focal summary and 28-row group table are retained unchanged. Their original denominator, area, changed class, directional crossing, gross gain/loss, net balance and percentage columns are checked against the 1,792 selected original matrix entries and both independent annual inventories. The four named class groups use the source author's exact class definitions:

| Group | Original class codes |
| --- | --- |
| Developed | 21, 22, 23, 24 |
| Forest | 41, 42, 43 |
| Agriculture | 81, 82 |
| Wetland | 90, 95 |

Developed includes vegetated open-space settings in class 21, and its group area is not measured impervious surface. Woody wetlands remain in the wetland group. Gross losses are crossings out of a group; gross gains are crossings into it. Internal class swaps are excluded. Net change is gain minus loss. The four panels plot the original loss/gain/net areas, with distinct monochrome markers and exact source row identities. Each panel keeps a labelled scale, and the full figure specification is retained for native vector/PDF rendering.

The four focus HUCs total 53,008.200038 hectares, including 1,580.850001 changed hectares (2.9822744406%). Developed net change is +251.280000 hectares; forest net is -233.730000 hectares. Lower Tugaloo's -0.810000 hectares of forest net change accompanies 180.090000 hectares of gross loss and 179.280000 hectares of gross gain. These values are descriptive annual-classification balances.

The two Eighteenmile HUC components retain their own 15,419.610011-hectare subtotal. Upper Seneca is separate and never enters that subtotal. Named HUCs, the `splitCatchment=false` USGS whole-catchment polygon, individual sampling locations and utility protection polygons keep distinct geography. No annual-load or causal water-quality interpretation is inferred from these class changes.

## Area, units and interpretation

All percentages use paired-valid original cells. Both selected annual sources have zero NoData and no unmatched valid support. Area uses the original EPSG:5070 native affine determinant, 900.0000006459331 square metres per cell. Original EPSG:3857 polygon vertices retain the producer's coordinate operation and its stated 4-metre accuracy. Native pixel-centre inclusion, half-open scanline edges and even-odd ring parity are retained; the fractional-boundary ledger has a different method and remains a different source edition.

Two-decimal display helps reading; integer cells and exact original floating-point areas remain in CSV/JSON. Annual product classifications do not establish cause, exact event date or modelled/observed nutrient, sediment or microbial response.

## Source lineage and installed component

Original focal author: PR3615, merge `568d8c67372002ffcf6d5c2b7b9ebea0ce566aa5`, complete seven-file source bank `0ec1cd7c98ed8671eaaf3d75c5bf8102b3566adb`. Original full paired source: PR3547 / `ea6a7579a98d7192861eb74a380952671c9154b5`; selected-matrix source successor: `4832ca7e3ade7ec61a151800abf290d970b3c905`.

The additive `focal-landcover-context` component retains this producer, CLI and guide, all seven original focal inputs and the complete prebuilt report/source family. Its existing complete-domain dependency carries the parent source and scientific report rendering. Shared report, source, field and numerical modules are unchanged.

The native receiving course uses the current original regional Workspace: source import → saved Scientific Report → native HTML/PDF and all companions → new full/selected-source archive → independent restored report/source reopening. Reuse its original task and project identity when resuming.
