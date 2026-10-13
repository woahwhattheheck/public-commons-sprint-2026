# Gura original-resolution reference

This command receives the official InVEST 3.20.0 Gura example, runs its supplied native arguments, imports the same scientific inputs into the maintained Workspace, and measures agreement between the two output sets. It preserves the source raster's 15 m lattice in EPSG:32737.

The reference driver is authored by TokenJunkieLabs' C8FF receiving operation and integrated here as `source_tools/receive_gura_reference.py`. Its full body is the current original source from [the receiving Page](https://chatgpt.com/space/page_970b4d1253208191b732c9a82221d705), source block `915bfe7b-f271-4326-83d1-826ba265f049`: 39,637 UTF-8 bytes, SHA256 `c9946ddf74a9a6614f24f6ba15d985615082deafd98c27051dddfcb99343c66f`. This edition includes the author's native flow-direction normalization while retaining the original argument strings in provenance.

## Select the intended operation

| Operation | Existing entry point | Retained scientific inputs and grid |
| --- | --- | --- |
| Original-resolution reference and direct model comparison | `python -m source_tools.receive_gura_reference` | Official 3.20.0 sample archives and their embedded tables/arguments; original 15 m lattice; zero added context buffer |
| Existing broader diagnostic and delivery continuation | `source_tools/gura_workflow.py` with `source_tools/receive_gura.py` | Its retained 3.16.1 example archives, separately selected current tables, 300 m land-cover reference and 300 m context buffer |

Keep each operation's Workspace and existing process. The reference command uses the original release archive, including its README, embedded source-version label, model-specific tables and selected native arguments. The original README describes a 30 m SRTM source resampled to the supplied 15 m land-use grid; the received raster's actual affine controls the reference run.

## Receive the two original archives

Reuse already retained copies with these exact identities. `--inputs` names their directory.

| Model | Original source | Bytes | SHA256 |
| --- | --- | ---: | --- |
| NDR | [InVEST 3.20.0 NDR.zip](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/NDR.zip) | 701,988 | `df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4d4c8af8bea53c6c7d` |
| SDR | [InVEST 3.20.0 SDR.zip](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/SDR.zip) | 726,334 | `34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779` |

The driver verifies the archive bytes, every extracted member and the embedded original arguments. Both-model intake checks equivalence of the original DEM, land cover and watershed geometries. It joins original biophysical fields by integer land-cover code and records any excluded noncommon codes; the native Workspace checks the actual land-cover classes.

Use the actual equipped interpreter and complete application directory. The application needs its maintained GIS environment and pinned InVEST 3.20.0 runtime. The current Workspace accepts `resolution_m: 15` and an explicitly selected zero `upstream_buffer_m`; PR2762 supplied the zero-buffer join while preserving other grid identities.

## Execute and continue the same reference

Set these paths from the accepting operation:

- `UPSTATE_APPLICATION`: the installed directory containing `model/` and `source_tools/`.
- `UPSTATE_PYTHON`: its equipped interpreter.
- `GURA_320_INPUTS`: the directory containing the original archives above.
- `GURA_REFERENCE_WORKSPACE`: the persistent Workspace for this original-resolution operation.
- `GURA_REFERENCE_ARCHIVE`: an output ZIP outside that Workspace.

First run the original nutrient example if an immediate native-stage result is useful:

```bash
cd "$UPSTATE_APPLICATION"
"$UPSTATE_PYTHON" -B -m source_tools.receive_gura_reference \
  --application "$UPSTATE_APPLICATION" \
  --workspace "$GURA_REFERENCE_WORKSPACE" \
  --inputs "$GURA_320_INPUTS" --models ndr --mode native
```

Then execute the full original reference and Workspace comparison using the same directory:

```bash
"$UPSTATE_PYTHON" -B -m source_tools.receive_gura_reference \
  --application "$UPSTATE_APPLICATION" \
  --workspace "$GURA_REFERENCE_WORKSPACE" \
  --inputs "$GURA_320_INPUTS" --models ndr sdr --mode both \
  --archive "$GURA_REFERENCE_ARCHIVE"
```

A retained complete direct-native stage is reused when its source/runtime selection and output hashes still match. Ordinary Workspace preparation and native run continuation use their existing saved identities. `--mode workspace` can continue the application side after the native reference has already completed. `--models sdr` selects the sediment path independently. The original native calls set `n_workers=-1` and common numerical-thread defaults to one.

The driver owns `gura-receiving/.driver.lock` inside this selected Workspace. An existing process holds the same operation; read its retained progress and logs when that lock is occupied.

## Read actual results

| Retained result | Meaning |
| --- | --- |
| `gura-receiving/gura-receiving-state.json` | Actual source/runtime identities, selected models, direct-native stages, Workspace grid/profile/scenario/run and completed/error state |
| `gura-receiving/native-operation.log` | Native engine and driver messages |
| `gura-receiving/native-original/<model>/<selection_id>/` | Original direct-native model outputs and original/executed argument record |
| `gura-receiving/selections/<models>/` | The exact saved profile, scenario, grid and run selections |
| `gura-receiving/native-workspace-comparison.json` | Actual common-cell differences between the original engine call and Workspace outputs |
| `runs/<run_id>/run.json` | Maintained native stages, physical export descriptors, model/runtime/source lineage and progress |
| The selected archive path | Complete saved Workspace backup produced after the application run finishes |

The official 3.20.0 nitrogen and phosphorus export rasters are in kg/ha/year; sediment export is in metric tonnes/ha/year. Each direct source raster is converted once using its actual projected affine area. A 15 m square cell is 0.0225 hectares. The Workspace supplies its already converted per-cell annual mass.

For each available pollutant, the comparison retains:

- actual common-cell count and separate native-only/workspace-only cells within the Workspace extent;
- both annual totals on those same common cells;
- Workspace minus direct-native total;
- maximum, mean absolute and root-mean-square cell difference;
- actual native-runtime cohort identities and their match flag.

Read the numerical differences with those support and runtime fields. The match flag compares execution provenance; the measured differences describe output agreement.

## Open the retained reference in the existing operator

Start the maintained operator with `--workspace "$GURA_REFERENCE_WORKSPACE"` and its existing operator-state directory, then open the private local URL printed by that process. Select the run returned in `workspace_baseline.run_id`, inspect the original inputs/profile/grid, and use the existing native-result, report, map and project-transfer controls. The application retains the case label **Gura, Kenya — original InVEST 3.20.0 study**.

A useful explanation alongside the actual comparison is: “This reference uses the publisher's original example inputs. We run the original engine directly and through our saved-project pipeline, then show their results on the same cells. The same pipeline carries our separately selected Upper Savannah inputs.”

For the original native calculation's definitions, consult the pinned [NDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py) and [SDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py). The original source archives retain their publisher notices and README lineage.
