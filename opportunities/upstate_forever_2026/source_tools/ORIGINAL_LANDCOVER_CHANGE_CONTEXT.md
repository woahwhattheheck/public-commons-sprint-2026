# Paired original annual land-cover change in scientific reports

This continuation consumes the completed original annual calculation. It produces a source-bound comparison for **Original sources → Review retained reports**, the ordered **Scientific reports** composer, exported HTML/PDF and full Workspace archives. It retains both annual inventories, the entire transition JSON and every original CSV. The separate annual report and fractional-pixel ledger remain independently selectable.

## Complete existing source

The original completed source is `observations/landcover_2023_2025/model-sources.json`, published in PR3547 at `ea6a7579a98d7192861eb74a380952671c9154b5`. Its original SHA256 is:

```text
15596485b8044a60edfbdaefe39dd8987f550fc5e1c6289edc26a2bec063b9f5
```

The manifest binds nine result files and the producing `analysis-run.json`. Those eleven original bodies, including the manifest itself, travel unchanged with the report. A README outside that original inventory is documentation, not an input to the scientific source.

| Original source | Retained identity |
| --- | --- |
| Earlier native raster, 2023 | 8,931,261 bytes; SHA256 `d7db3a30d6595aa8da28b5e81dc5b84e7e0bf198b860543ac32c702328871fc5` |
| Later native raster, 2025 | 9,443,751 bytes; SHA256 `3fa517b4cc3251b9e1bd31e51b54b036a875c09e5f1075511da7c8e951656670` |
| Original decoded 217 polygons | SHA256 `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`; declared EPSG:3857 |
| Original transition calculation | 5,892,411 bytes; SHA256 `c1813390a4884b54cf878817c58ac91abc0dc8a5c1571765a034926252dc672a` |
| Earlier annual inventory | 477,495 bytes; SHA256 `1e4bea16ffb1ccaf8361972a042bb2b71a2320b36aea069d9a2282954e005836` |
| Later annual inventory | 477,860 bytes; SHA256 `21a9d49dc2811778ef86d5bd05114530e52bdd2cabb60e8eb4857dd8fd40adc8` |

## Produce and receive the complete report

Run from the maintained application root with the existing completed analysis directory intact:

```sh
node source_tools/original_landcover_change_context_cli.mjs \
  --source-manifest observations/landcover_2023_2025/model-sources.json \
  --manifest-sha256 15596485b8044a60edfbdaefe39dd8987f550fc5e1c6289edc26a2bec063b9f5 \
  --output /actual/existing-parent/new-paired-landcover-report
```

The output directory must be new; its parent must exist. Every validation and in-memory report construction completes before directory creation. Existing outputs are never replaced. Original paths must be plain filenames within the real source directory; a symlink cannot redirect intake outside it.

Import the returned `source-manifest.json` through the existing source importer in the **same regional Workspace**. The resulting entry is `kind: document`, `role: OBSERVED_CONTEXT`, backed by the ordinary `upstate.observed-report/v1` recipe. Open it through retained reports, add it to the existing ordered scientific composer, save the report and export through that report’s original member transport. Retain the full Workspace archive and reopen it through the existing portable receiver. The comparison is derived entirely from retained result bytes; no raster download or new model run is needed for this report.

## What the reader receives

- A neutral, searchable HTML report covering all 217 original HUC12s, domain class balances and directional change.
- Complete 16 × 16 transition inspection for the domain and every watershed, with hectares/native-cell toggles. Matrix rows are the earlier class and columns the later class. Original zero-count cells remain visible.
- All 55,552 original per-HUC transition CSV rows, including zeros, both complete annual inventories and the original full JSON matrices.
- A complete interpreted summary CSV retaining the original watershed IDs/names, paired support, changed area and share, developed/forest/agriculture net areas and unmatched/NoData counts.
- The original source manifest, producing operation and all nine numeric result files, byte-for-byte.
- The scientific recipe, import manifest and explicit reconciliation record used by the ordinary saved-report/export/archive workflows.

The printable scientific recipe includes the complete 217-row watershed summary, all 16 domain class margins, all nine domain groups and the twenty largest directional exchanges. Full matrices remain linked original companions rather than tens of thousands of printed rows. The HTML matrix is usable offline; its embedded compact display data is derived from the retained original counts, and its downloads link to the unchanged original files.

## Scientific binding and support

The producer validates the independently supplied source-manifest hash, every declared byte count/hash, the producing operation’s nine result descriptors and exact original product years/raster identities. All annual/pair grids, affine coefficients, polygon identities, coordinate operations and original watershed attributes must agree.

Each complete 256-cell matrix must reconcile to its paired-valid total, stable diagonal, changed off-diagonal count, full class margins and grouped margins. Its paired margins reconcile with each independently retained annual inventory, allowing only the explicitly recorded earlier-only/later-only valid support. The original current source has zero unmatched or NoData cells. Every value in all six source CSVs is compared with the original JSON, including 55,552 unique HUC/class pairs and both annual class tables. For the original nonoverlapping polygons, the complete per-HUC matrices must also sum exactly to the union matrix.

The actual retained result has 20,949,527 domain cells, 1,885,457.431353 hectares, 1,089,063 changed-class cells and 98,015.670070 changed hectares: 5.1985087778% of paired-valid cells. NoData and overlap are both zero. These are changes between annual product classifications, with no attribution of physical cause or exact timing.

Area uses the determinant of the original native EPSG:5070 affine, 900.0000006459331 square metres per cell. Original EPSG:3857 polygon vertices are transformed by the retained operation, whose stated accuracy is 4 metres. Numerical transform agreement and that stated source-operation accuracy are separate records. Cell-centre inclusion uses half-open scanline edges and even-odd ring parity. The existing fractional-pixel ledger weights boundary intersections and is a different area calculation; this report identifies that distinction directly.

The full rectangular raster includes source cells outside the union. Those totals remain separate. Named HUC12 totals are not substituted for gauge catchments or drinking-water protection footprints. Net group change is later minus earlier area, while directional exchange is retained separately. HUC12 fields should be imported as text by spreadsheet software to preserve their leading zero.

## Reusable API and installed closure

`composeOriginalLandcoverChangeContext({files, expectedManifestSha256})` accepts a map of complete original UTF-8 strings or Uint8Array bodies. It returns `{sourceId, recipe, manifest, files, summary, reconciliation}`. All output values in `files` are complete byte arrays. The source ID derives from the full final recipe and its exact original companion identities.

The additive `original-landcover-change-context` component includes this producer, CLI, guide, exact existing archive codec and the complete published analysis source directory. It depends on the existing original-landcover analysis, observed-context and saved scientific-report components. Its source manifest is activated by the ordinary component loader; shared catalogues and original numerical algorithms are unchanged.
