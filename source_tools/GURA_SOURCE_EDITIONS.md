# Gura source editions and original native receiving

The current application retains two original receiving routes. Select the route that matches the retained input records. Each Workspace keeps its own project, grid, programme and run identities.

## Official InVEST 3.20 sample release: 15 m

Use `source_tools/receive_gura_native.py` for the original 3.20 release archives. The receiving source checks these complete archive identities before extracting the original argument files, rasters, tables and watershed.

| Original archive | Bytes | SHA256 |
| --- | ---: | --- |
| NDR.zip | 701988 | df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4d4c8af8bea53c6c7d |
| SDR.zip | 726334 | 34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779 |

Original URLs:

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/NDR.zip
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/SDR.zip

The retained receiving source and its original raster inspection identify EPSG:32737, 1939 columns by 603 rows, and affine transform `(15, 0, 248950.6562500205, 0, -15, 9941896.999999935)`. Each source cell covers 0.0225 hectares. The receiver verifies the original lattice and prepared cell mapping before creating the native run. It selects the original watershed as reporting area and model domain with zero added context.

From the equipped interpreter, use the actual retained application, receiving Workspace and archive directory:

```sh
python -B source_tools/receive_gura_native.py \
  --application /actual/application \
  --workspace /actual/gura-15m-workspace \
  --inputs /actual/original-gura-archives \
  --models ndr sdr --mode both
```

`both` executes the original archive models and the corresponding ordinary Workspace baseline, then compares their actual common valid cells. `workspace` executes the ordinary retained Workspace selection. `native` executes the original reference models. `--models ndr` or `--models sdr` keeps that explicit scope.

The original NDR argument file enables nitrogen and phosphorus with MFD routing, threshold 1000, k 2, subsurface critical length 200 m and efficiency 0.8. SDR selects MFD, threshold 1000, k 2, IC0 0.5, SDR maximum 0.8, maximum L 122 and its original empty drainage path. The source argument files retain their embedded historical version labels; the actual executor checks the selected official InVEST 3.20.0 module source hashes.

Receiving progress is `WORKSPACE/gura-receiving/gura-receiving-state.json`. It retains the runtime, original sources, source collection, grid, profile, scenario and actual run ID. Native references and logs remain under the same `gura-receiving` directory. Resume the same command and Workspace to reuse completed original stages. The existing operator opens this ordinary Workspace directly. An optional `--archive /actual/destination/gura-workspace.zip` writes the ordinary Workspace backup outside its source tree.

## Existing 300 m GURA-NATIVE-01 study

Use the retained `source_tools/gura_workflow.py` command and original receiving/source-directory records for an already selected 300 m GURA-NATIVE-01 study. Its explicit 300 m cell size and 300 m context remain part of that study's identity. Resume its saved class conversions, original programme, source reference and actual Workspace.

The current workflow retains its source selection inside the Workspace so a restored copy can rebind local paths. Completed native outputs can continue through reports, archive and operator on the GIS stack. The maintained programme executor checks the native runtime when selected native calculations remain unfinished.

The official 15 m archives above belong to the separate original-cell receiver. Preserve an existing 300 m study and its source edition when receiving the official 15 m case in another Workspace.

## Source of this receiving contract

The full original receiver and original-cell composition were supplied by the existing native-source owner at:

https://chatgpt.com/space/page_970b4d1253208191b732c9a82221d705

The current application installs that receiver as `source_tools/receive_gura_native.py` and preserves `source_tools/receive_gura.py` for the existing 300 m intake contract. Original native exports are rates per hectare; the maintained adapter converts once using the actual projected cell area and retains the native units and source masks in its output metadata.
