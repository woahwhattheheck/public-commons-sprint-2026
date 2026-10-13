# Full regional programme: execution order, reuse and interpretation

This continuation uses the ordinary `model.experiments.execute` operation, its existing experiment/native batch locks, the original Workspace runs, and the existing `NativeInputMatcher`. Every selected case remains in the programme. Source base: `7da939f73adb76ccce394f3060e3103a90aa2484`, `model/experiments.py` 56,729 bytes, SHA256 `03e0c194040ded574d1e739e99ef03e1408c22995c9659714e5fd114e402f72f`.

## Which calculation can be shared

The fast native stage signature deliberately records the original whole CSV bytes. Two tables can nevertheless supply the same model-specific columns. The experiment now passes earlier runs from the same retained land-cover scenario as explicit donor candidates. The native matcher checks the actual relevant table columns, native parameters, runtime and dependencies, original grid/rasters/masks, scenario land cover, and model-domain geometry before adopting a stage.

| Published profile choice | NDR scientific group | SDR scientific group |
| --- | --- | --- |
| Original Georgia/Duke baseline | Original | Original |
| Albright table, original native parameters | Albright / original parameters | Albright / original parameters |
| Albright table, Vickery native parameters | Albright / Vickery parameters | Albright / Vickery parameters |
| Upper Flint NDR coefficients | Upper Flint | Original |
| Upper Flint SDR coefficients | Original | Upper Flint |
| Upper Flint combined coefficients | Upper Flint | Upper Flint |

For six profiles and eight land-cover states, the full programme contains 48 cases and requests 96 model stages. There are at most four distinct NDR and four distinct SDR input combinations per land-cover state: 64 distinct scientific stages. When the receiving original native parameters already equal the Vickery settings, the two Albright choices share their stage inputs, reducing this to 48. Actual complete stages in the Workspace reduce the remaining calculations further. These are input-equivalence counts, not measured runtime claims. The original experiment's actual `counts.cases` remains authoritative when additional profiles, scenarios, axes or fixed-runoff variants are selected.

Within a scenario the current automatic candidate list retains its first profile plus fifteen recent profiles; this bounds the opportunistic lookup memory for very large streaming experiments. This does not limit selected cases or the existing whole-Workspace exact-input index. Caller-retained donor IDs are preserved first. A source whose later model failed can still supply its earlier completed stage after the native matcher and importer verify it.

Successful cases now retain `native_stage_reuse`, copied from the actual native stage's `reused_from` records. The recorded original source run, input signature and scientific comparison identify the calculation actually reused. Resume reconstructs candidate lists from retained earlier cases. Existing run, case, experiment and comparison identities, partial-summary behavior, binding recovery and report freshness checks remain unchanged.

## Work through the entire existing programme

The engine's existing order is profile-major: the original profile's baseline and seven spatial alternatives, then each additional profile's baseline and seven alternatives. Each profile's land-cover comparisons therefore have their paired baseline first. This also creates the original-profile donor for every scenario before the Upper Flint partial coefficient choices.

Use the existing study entry point to retain all seven spatial alternatives and the whole selected profile matrix, then execute the same experiment ID. Do not create a separate experiment for every profile or rerun spatial allocation per profile. The native scenario operation prepares the six proximity allocations and steep-agriculture restoration once, records the exact binary masks and source transitions, and resumes its retained operation.

The seven alternatives use the 116 reporting HUC management area for eligible classes and conversion quotas. The 217 contributing HUCs and hydrologic buffer remain in native routing. Original and alternative runs retain the same reporting mask. NDR runoff-reference variants, if explicitly selected, use the mean of the original completed masked runoff raster; uniform positive precipitation scaling otherwise cancels under the model's automatically recomputed mean.

The baseline and first full-profile land-cover results provide the earliest complete scientific comparisons. Continue the remaining profile groups through the same programme so the report gains its cross-source response ranges. On interruption, resume the existing experiment: completed case outputs stay in place, verified native stages resume through the maintained native loop, and export-only recovery avoids loading InVEST when every selected native stage is already complete.

## Actual 30 m regional capacity

The retained 217-HUC planning grid has 6,445 columns and 6,321 rows: 40,738,845 cells. Confirm those dimensions from the receiving `grid["grid"]`; a different retained grid requires recalculating these arithmetic quantities.

| Numeric payload on that rectangle | Uncompressed bytes | GiB |
| --- | ---: | ---: |
| One uint8 mask | 40,738,845 | 0.03794 |
| One float32 raster | 162,955,380 | 0.15176 |
| One float64 raster | 325,910,760 | 0.30353 |
| Three annual-mass export rasters for one case | 488,866,140 | 0.45529 |
| Three exports for 48 cases | 23,465,574,720 | 21.85402 |
| Three difference rasters for 47 non-reference cases | 22,976,708,580 | 21.39873 |

The last two rows together represent 43.25275 GiB of logical numeric payload before native intermediate files, original sources, scenario inputs, TIFF metadata, masks and overviews. The maintained exporter uses float32, tiled DEFLATE TIFFs; the actual stored byte count depends on the real values and reporting footprint. These arithmetic quantities are not a minimum free-space requirement or a promise about compressed disk use.

A native stage can retain many intermediate raster and vector outputs. Read the actual completed baseline `run.json`, deduplicate its `files`, `companions` and `additional_files` by relative path, and sum their recorded byte counts separately for NDR and SDR. Use the receiving filesystem's free-space change around real completed stages to assess actual allocation and account for temporary working files.

Stage reuse saves computation. The importer uses an independent reflink when the filesystem supports it and verified independent copying otherwise. Reflinks share unchanged physical extents; plain copies still consume new storage. Each adopted stage records `transfer.methods` and transferred logical bytes. Keep those observations separate from the number of scientific calculations avoided.

The maintained native arguments use `n_workers=-1`, keeping TaskGraph execution serial. The experiment owns the native batch lock; identical native stage signatures also share an execution lock. The new native lifecycle records the host, PID, phases, stage times, filesystem capacity, retained stages, and failure details, with reserved metadata capacity for failure publication. It does not impose a cgroup memory budget or a GDAL cache override.

Use the accepting worker's persistent normal-disk Workspace for the full regional operation. The previously saturated shared 8 GiB cgroup and its tmpfs are not a second storage allocation: tmpfs pages count against the same memory limit. The profile-only materialization command is independent of this GIS working set and can finish first.

For runtime planning, use the actual baseline stage `started_at`/`completed_at`, scenario preparation times, and recorded reuse transfer times. A useful initial computational estimate is the remaining distinct NDR input groups times the observed NDR duration, plus the corresponding SDR quantity, plus scenario preparation, transfer, export and comparison time. Update from subsequent real stages; data-dependent native routing, compression and disk contention make an unmeasured hours estimate unreliable.

## Interpret the returned profile and model results

The existing five-profile materialization receipt checks every table cell against independent retained source CSVs, all unchanged baseline cells and native parameters, and stable IDs on a second materialization. Its `baseline_profile_id`, five `profiles[].profile_id`, table hashes and full fifteen-class rows bind the study to actual materialized profiles.

If a fresh reference Workspace is used, its explicit baseline already uses the eight Vickery native settings plus MFD and dimensionless SDR `l_max=122`. The two Albright choices then have the same scientific stage inputs. An existing PROFILE_ID is preserved unchanged and can retain a distinct parameter contrast.

In the actual experiment summary:

- A land-cover effect is the alternative minus that profile's own baseline, over paired valid cells.
- A parameter/source effect compares the original land-cover state under a selected profile with the original reference profile.
- Nitrogen and phosphorus totals are annual kilograms; sediment totals are annual metric tonnes. Native 3.20 per-hectare rasters are converted with the actual pixel area, 0.09 ha for this 30 m grid.
- Negative delta means lower annual export; positive delta means higher export.
- Compare response ranges only within the same valid-cell support group. The current engine supplies `support_sha256`, paired cells, area and coverage.
- A change in sign across source profiles is a material sensitivity finding. A stable sign with a wide range identifies direction agreement and magnitude sensitivity.
- Undefined relative change for a zero baseline stays undefined. It must not become a numeric zero in the report.

## Focused receiving check and actual continuation

After installing the full postimage, run this from the maintained application before native dispatch:

```sh
python -B - <<'PY'
import hashlib, inspect
from pathlib import Path
from model import experiments
from model.workspace import Workspace
path = Path(inspect.getsourcefile(experiments))
body = path.read_bytes()
assert hashlib.sha256(body).hexdigest() == "126c188a6f51a1210d062d582a08761d635209709af28c8ac76416142f095462"
compile(body, str(path), "exec")
assert "reuse_source_run_ids" in inspect.signature(Workspace.run).parameters
print({"module":str(path), "bytes":len(body), "same_scenario_donor_route":"installed"})
PY
```

Continue through the existing `experiments.execute(workspace, experiment_id)` route or its original operator command. The all-five original-source materialization command remains in the existing Muse DM, message `1791857709.633709`.

After a real Upper Flint case completes, inspect that run's `stages[model].reused_from` and the experiment case's `native_stage_reuse`. These are the acceptance records for actual reuse. The receiving report continues to consume the ordinary engine summary and paired comparisons.
