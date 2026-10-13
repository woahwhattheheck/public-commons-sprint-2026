# Compose prepared inputs for the maintained native assembly

Operation: `ES-20261012-STAGE-GRID`

This adapter fills the input-composition step before the maintained `Workspace.combine_runs` path. It creates a full target grid from the already prepared physical inputs of selected NDR and SDR stages, including inputs held in separate retained source editions. The current V5 assembler then owns native stage validation, original registries and sidecars, runtime identity, reuse history, output conversion and ordinary run completion.

## Install with the current maintained source

Apply the current 36-file regional/model component from Slack Canvas `F0C8Q0E9JHY`, then compose the current 11-file native-completion component from `F0C893JUJ23` through the existing cumulative application installer. The latter contains the current V5 postimages. Preserve later owner edits when applying those authored source joins.

Six overlapping paths differ and must retain the V5 edition:

| Path | V5 bytes | V5 SHA-256 |
| --- | ---: | --- |
| `model/reuse.py` | 8,930 | `ac0396f4884e45579f972dcbba05d1f0047d54324b12164ae15140547f025f00` |
| `model/stage_cache.py` | 14,487 | `f16c1248e423f18a7b8f9b5ace7f1679dd53f087ca8fa91e3fce8b598f65d90d` |
| `model/native.py` | 14,586 | `68b2c4444b53dc2f4050c3c3ba601c6e653ff93b8b08086e4c7380c1485fdac9` |
| `model/run_assembly.py` | 25,874 | `5d79417d91ea6da8d2b8d99457d30358ed684b8ff5391887eb68f0538d90acd5` |
| `model/SELECTED_MODEL_OPERATIONS.md` | 28,851 | `d2e03fd2ac2fdc97f78251ef9447b913f0c0c8bc7794fa512a1981cf14eb5ee4` |
| `operator/web/app.mjs` | 111,647 | `e6f96f33ffe3f6a8a8e701b9b575c99e194687946471ee0288280f8b938768f8` |

The shared `model/native_arguments.py` body is identical in both carriers. The adapter adds only `model/completed_run_join.py`, `model/completed_run_join_cli.py` and this guide.

The 36-file carrier decodes to 659,447 JSON bytes, SHA-256 `6a43725377b2e0dd8dff3f3756b31a7955b2a6fd765fad49f95b4b7f804893bb`. The 11-file carrier decodes to 296,048 JSON bytes, SHA-256 `d0b9dd27ccb62c6f6f3df1532afad8ffe3b75e7fffe90f712842934519b95271`. Both complete payloads were recovered and verified before this convergence.

## Select the actual retained work

Use the active receiving application's existing workspace. Its `Workspace.overview()` returns retained runs and their selections/stages. Choose a run containing the completed NDR stage and a run containing the completed SDR stage. A source can be a selected-model run, a full run, or a run whose other stage failed after the selected native stage completed.

The two argument positions are explicit: NDR first, SDR second. An original completed full run remains directly usable through the ordinary application.

Choose the full target parameter profile. If both donors already use the same full profile, it is selected automatically. Otherwise supply the retained full profile using `profile_id` or `--profile`. V5 compares the actual per-model arguments, original table and physical inputs with that target. The target scenario defaults to the NDR donor's scenario; an explicit target must describe the same actual retained land-cover changes as both donors.

## Command interface

Run from the current application source root in the native environment:

```bash
/opt/pyvenv/bin/python -B -m model.completed_run_join_cli preview \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --ndr-run "$UPSTATE_NDR_RUN_ID" \
  --sdr-run "$UPSTATE_SDR_RUN_ID"

/opt/pyvenv/bin/python -B -m model.completed_run_join_cli join \
  --workspace "$UPSTATE_MODEL_WORKSPACE" \
  --ndr-run "$UPSTATE_NDR_RUN_ID" \
  --sdr-run "$UPSTATE_SDR_RUN_ID" \
  --output "$UPSTATE_JOIN_RECORD"
```

Use `--profile ACTUAL_PROFILE_ID` when donors use different profiles, and `--scenario ACTUAL_SCENARIO_ID` to select an equivalent retained target scenario. The task-specific environment variables above name existing workspace records and the desired receipt path.

`preview` returns the deterministic full-grid/run selection, physical-input compatibility records and original source-role lineage. It reads the actual shared prepared inputs. The maintained source-view helper may recreate its normal native input views. Final per-model stage/runtime/parameter validation remains in V5 when joining.

`join` retains the composed sources/grid and calls `Workspace.combine_runs`. Its default completes the normal derived outputs through the maintained native runner. Both selected original stages are adopted by that path. Use `--prepare-only` to retain the adopted stages and return the ordinary prepared run to the existing queue for completion.

The JSON result is the ordinary maintained run record. Its `id` goes into programme, comparison, observation and delivery selections. `--output` atomically saves that returned record.

## Python and programme use

```python
from model.completed_run_join import preview, join_runs

pair = [completed_ndr_source_run_id, completed_sdr_source_run_id]
plan = preview(workspace, pair)
result = join_runs(workspace, pair)
joined_run_id = result["id"]

# When donors use different profiles, select the actual full target:
result = join_runs(workspace, pair, profile_id=full_target_profile_id)

# A serialized existing task queue may own the final run completion:
prepared = join_runs(workspace, pair, execute=False)
```

Join baseline and scenario donor pairs using the same contributing prepared grids. Their composed grid identity is stable across scenario/profile choices, satisfying the common-grid requirement of the existing comparison and delivery paths. All ordinary run identities are created by the maintained Workspace preparation contract.

## Physical inputs and resolution

The adapter retains the actual selected source grid definition. This includes the official InVEST 3.20 Gura reference at 15 metres in EPSG:32737 with zero added context, the separate maintained Gura diagnostic programme at 300 metres, and the ordinary regional 30-metre selection. Choose compatible donors from the same selected grid. The adapter copies their prepared input bytes and uses the maintained assembler's native cell/mask and feature/attribute comparators.

The common inputs must agree on the actual CRS, transform, dimensions, bounds, resolution, pixel area, units, dataset companions and native data. Model domain and reporting area are checked separately. This preserves the model context and reporting selection.

| Prepared role | Retained contributor |
| --- | --- |
| DEM, NLCD, PRECIPITATION | NDR source grid |
| R_FACTOR, K_FACTOR | SDR source grid |
| Model domain, reporting area, reporting mask | NDR source grid, after comparison with SDR |

Transfers use current `reuse.copy_verified`: independent reflinks when supported, otherwise a streamed verified copy, with atomic publication and transfer counts. Original input sidecars are retained alongside their bodies.

## Source editions, recovery and portable delivery

When the role sources span editions, the adapter saves one composed immutable source collection. It preserves each original body and companion object, title, URI, vintage, conversion, units and original source identity. Aliases connect the combined grid's five input roles to that collection, matching the existing delivery source-reporting contract.

The composed grid retains `spec.stage_source_grids`, `source_origins`, `reused_inputs`, per-role original source collection/ID, input statistics and `input_companions`. The run's original source selections, runtime, arguments, complete registry directories, sidecars and reuse history remain in the V5 assembly records.

The grid lock and its retained progress allow the same command to resume an interrupted composition. The maintained copy routine verifies/reuses completed transfers. Earlier copies of this adapter's composed grids are enriched with companion/provenance metadata through the same path. The ordinary complete grid and run identities remain stable.

The existing full workspace archive includes composed collections, source objects, prepared files and companions, native run outputs and these additive application files. Restore uses the maintained relative descriptors and original portable argument handling.
