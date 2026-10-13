# Matching completed native stages for a combined regional result

## Run the existing native pipeline with completed donor stages

Prepare the ordinary target run with its actual combined grid, selected profile and retained scenario. Then use the maintained Workspace API:

```python
combined = workspace.prepare_run({
    "grid_id": full_grid_id,
    "profile_id": full_profile_id,
    "scenario_id": original_scenario_id,
})
result = workspace.run(
    combined["id"],
    reuse_source_run_ids=[completed_ndr_run_id, completed_sdr_run_id],
)
```

The combined grid may use the core's existing `base_grid_id` extension when additional actual R/K or precipitation sources arrive. The normal omitted `models` field selects both models. The donor runs may have selected one or both models; each completed matching stage is considered independently.

The optional keyword is passed directly from `Workspace.run` to `native.execute_run`. Under the existing run lock, it validates and retains the ordered source-run list in `run.json.reuse_source_run_ids`, outside scientific selection. The run ID remains the ordinary selected-input ID. A later `workspace.run(combined["id"])` resumes with the same saved candidates. Supplying an empty list clears candidate choices for unfinished work. Already completed stages remain in place, and a complete run returns its existing result.

After the actual scenario raster and native runtime are retained, the native loop constructs one `NativeInputMatcher` and passes the saved candidates to the existing `stage_cache.recover` primitive. Indexed matches, semantic matches from explicit older runs, validation and original native execution follow the same maintained path. Reused stages retain `stages[model].reused_from.run_id`, their original runtime and arguments, all native registry files and companions, and the matching decision. This also retains SDR's original computed LS raster. The ordinary reporting-mask and affine-area conversion then produces the target annual mass exports.

This revision composes the published shared-stage reuse source from public commit c59ff390640dbc896486f067752d5a7c960326c3. It preserves native_arguments.py, Workspace.combine_runs, per-signature calculation locks, scheduling-independent scientific signatures, legacy index lookup, actual input companions, original registry directories and additional files, reflink/copy transfer accounting, and deferred cache indexing after a successful native run. The complete reuse.py remains byte-for-byte identical to that commit. The native loop additionally composes the NativeExecution lifecycle published at dd79fd07d244318cb9e3ca77ee955c524331def9. Donor choices are normalized and persisted inside its recoverable reuse_selection phase; the matcher is created only when a native stage remains unfinished. Export-only continuation therefore keeps using completed original stages without loading InVEST. Apply each accompanying guarded join over its declared file base; retain the current Workspace.run keyword adapter and newer scenario-mask and delivery work.


The selected-model core prepares NDR and SDR independently. A completed NDR run can therefore have a different grid or profile identifier from the later combined NDR/SDR selection, even when the actual NDR calculation is unchanged. `model/native_equivalence.py` compares the scientific inputs needed for that join.

The maintained native cache owner supplies stage storage and import. This module supplies a comparison that their cache or the completed-model bridge can consume:

```python
from model.native_equivalence import NativeInputMatcher
from model.native import runtime
_, target_runtime = runtime(["ndr", "sdr"])
matcher = NativeInputMatcher(workspace, target_run_id,
                             target_runtime=target_runtime)
nutrients = matcher.compare(completed_ndr_run_id, "ndr")
sediment = matcher.compare(completed_sdr_run_id, "sdr")
```

A land-cover target must first retain its actual scenario raster in its existing `stages.landcover.artifact`. Baseline targets use their original NLCD. This keeps the comparison tied to the raster that the native calculation will actually consume.

## Reuse decisions

`matches` means the native stage has matching source/version, actual grid, model parameters, biophysical values, watershed geometry and physical raster values. A successful match requires the selected native registry exports; SDR also requires its computed `ls` output, because the seven-map delivery retains this original terrain result.

`mass_exports_match` additionally requires all selected converted exports and an equal reporting mask. A native stage may be reusable when the reporting mask differs: reuse its native output and regenerate the annual mass raster on the target reporting mask using the existing conversion.

The comparison checks each model's parameters and biophysical columns. NDR uses its nitrogen/phosphorus loading and retention fields; SDR uses lucode, USLE C and USLE P. CSV ordering, number formatting and unused columns do not change a model's calculation.

Raster hashes and the actual external GDAL mask, PAM metadata and overview identities provide a fast equality route after retained-file verification. Different file encodings are compared by CRS, transform, dimensions, valid-data masks and numeric values, in native raster blocks. The matcher retains verified-file state during one join, so comparing multiple components does not repeatedly hash the same unchanged target inputs.

GeoPackage byte differences can come from storage metadata. For the maintained single-feature model-domain grid, the fallback compares CRS, feature identity and spatially equal geometry. It preserves the actual watershed footprint while allowing equivalent container encodings.

The matcher uses a stage's retained `runtime` when present, falling back to the original run runtime for older stages. It verifies the pinned SDR source dependency for NDR as well as the NDR source itself. When the receiving runtime is supplied, the recorded Python, native libraries and GDAL environment must match the source stage's environment. The live native cache produces that runtime description; preparing the matcher does not execute either model.

A completed model stage can be used even if another model in its original run is unfinished. The importer must preserve that stage's original registry files and source run ID. Converted exports are imported only when available and matching; otherwise the normal native completion generates them from the reused stage.

## Integration

Prepare a normal combined grid/profile/run from the actual retained sources. Match and import completed components through the maintained native cache primitive. Keep the normal `run.json` selection and preserve the current cache's `stages[model].reused_from` object, including its original `run_id`, input signature and prior reuse chain. The existing `model/reuse.py` already retains native Shapefile and raster companion files; `model/stage_cache.py` verifies and imports those originals. A source's SDR `ls` registry descriptor remains part of the normal retained stage. Then call the existing `Workspace.run` to execute any model still missing and finalize normal exports.

That ordinary combined baseline and its combined scenarios feed the existing delivery, parcel priorities and baseline/alternative comparison APIs. The source matching class adds no second run or delivery format.

## Primary references

[Shapely spatial equality](https://shapely.readthedocs.io/en/stable/reference/shapely.equals.html) compares spatial footprints even when point ordering differs. [Rasterio windowed reading](https://rasterio.readthedocs.io/en/stable/topics/windowed-rw.html) supports processing full source rasters in their native blocks.

The native version remains InVEST3.20.0. Its [NDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py) and [SDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py) declare per-hectare raster exports. Existing annual mass conversion and units remain unchanged.

## Explicit source runs in the maintained cache

The accompanying exact context edits extend the existing `stage_cache.recover` entrypoint:

```python
stage, observations = recover(
    workspace, target_run_id, model, selected_signature,
    target_directory, requested_arguments,
    source_run_ids=completed_source_run_ids,
    matcher=NativeInputMatcher(workspace, target_run_id,
                               target_lulc=actual_lulc,
                               target_runtime=runtime_source))
```

The current native run loop already has these arguments after its land-cover stage and before dispatch. The normal Workspace.run keyword supplies the explicitly selected original run IDs. Indexed exact matches retain the existing fast path. Explicit historical or differently packaged inputs use the semantic matcher and the same current importer, including original native outputs, SDR LS, Shapefile companions, runtime and argument files. A mismatch becomes a candidate observation and lets the remaining index or original native execution continue.

The imported stage retains `reused_from.original_input_signature` and `reused_from.input_equivalence` beside the existing original run ID, arguments and reuse chain. The target input signature belongs to the actual receiving arguments and environment.

Receive with the existing fourteen-file selected-model source receiver, from the current application directory:

```sh
python -B model/receive_selected_model_source.py --application . --packet native-stage-inputs-source.json
```

The cache file includes full exact-base content plus function-local joins. Input companion identities from the current owner source remain in place. The independent-copy and candidate-fallback repairs are composed into these full postimages. Preserve other later owner changes with the guarded joins. Every selected Python source is parsed by the existing receiving installer before it publishes the installed application.


## Copy isolation and recovery

The maintained `reuse.copy_verified` first tries an independent copy-on-write reflink, falling back to a verified streamed copy when the filesystem cannot clone. It verifies length and SHA-256 before atomic publication. Existing matching destinations with multiple hardlinks are detached to independent inodes. Original source files remain untouched. The shared source records transfer counts, byte totals and whether each file was cloned, copied or already independently retained.

A candidate's files are published through that same primitive under the receiving run lock and the shared signature lock. The importer tracks adopted inode identities, including publication followed by a late filesystem-sync failure. If the candidate fails, it removes only its still-owned adopted destination inodes before trying another donor. This avoids retaining a failed donor's external mask or PAM metadata alongside another donor's TIFF, without making a second full raster copy in a private staging directory.

After a candidate transfers successfully, the importer removes destination dataset sidecars that are absent from the selected original registry and companion inventory. This also clears stale sidecars left by an earlier interrupted process. All such files are restricted to the receiving unfinished model's directory. It preserves the source's recorded companion hashes, registry file IDs, directory outputs, additional files and original argument file under a content-specific name. A cleanup failure interrupts adoption rather than carrying mixed dataset files into a completed stage.

The existing original execution path executes any missing native model and regenerates annual mass rasters against the receiving reporting mask. Calculation locks cover recovery and original production; the importer does not acquire a second donor run lock. Completed native stages remain available even if refreshing their cache index fails.

The original revision-3 completed-stage assembly is also retained:

```python
result = workspace.combine_runs(
    {"grid_id": full_grid_id, "profile_id": full_profile_id,
     "scenario_id": original_scenario_id},
    {"ndr": completed_ndr_run_id, "sdr": completed_sdr_run_id},
    execute=True)
```

Its explicit two-stage assembly and the normal native cache both use the same independent-copy primitive. The run keyword additionally lets the current native loop evaluate model-specific scientific equivalence for explicit historical candidates and finish any missing selected model. Both retain the ordinary complete run consumed by delivery.
