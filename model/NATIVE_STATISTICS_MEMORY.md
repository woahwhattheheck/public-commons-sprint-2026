# Original raster statistics with bounded memory

The native model adapter retains the published InVEST numerical algorithms and dependency source. The pygeoprocessing 2.4.11 raster calculator processes windows of up to 65,536 cells by default, then sends each float64 result block to its original Cython statistics worker. Its published handoff uses an unbounded queue. A producer that gets ahead of statistics can retain many complete block arrays while the raster itself is processed in windows.

The source-selected adapter in `model/native_stats.py` bounds this handoff to two pending input blocks. A separate response channel carries the original final statistics. Pixel arithmetic, nodata selection, block order and the original Cython Welford/minimum/maximum loop remain unchanged. Each channel records actual submitted/consumed block counts, maximum queued blocks/bytes and producer wait time.

## Exact source and scope

The selected source is the official pygeoprocessing 2.4.11 `geoprocessing.py`, 219,828 bytes / SHA256 `a94d1c72de9fcfbeab990f9c8802308cb2f073237cfe3043a7ffdfcadda32cc7`:

https://github.com/natcap/pygeoprocessing/blob/2.4.11/src/pygeoprocessing/geoprocessing.py

Original statistics worker:

https://github.com/natcap/pygeoprocessing/blob/2.4.11/src/pygeoprocessing/geoprocessing_core.pyx

Original selected SDR 3.20 implementation:

https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py

The adapter parses this exact module's AST and rebuilds only its raster_calculator function with two guarded substitutions: the channel constructor and thread target. All remaining statements/decorators are original. The target calls the unchanged original Cython worker and reports worker exceptions to the producer. Installed dependency files are never rewritten. Unsupported source editions continue with the original implementation and explicitly record that mode.

The context applies to one synchronous native calculation; current native arguments use `n_workers=-1`. It restores both public and internal calculator bindings on success, worker failure or caller cancellation. A process lock serializes overlapping adapter contexts. Original native numerical source IDs and completed-stage reuse remain intact; the stage also retains operational handoff provenance and actual queue metrics.

## Failure and cancellation

A failed worker signals the blocked producer instead of allowing an indefinite queue wait. Producer waiting uses the original raster calculator's timeout. During interrupted cleanup, pending blocks are released and the worker receives the original stop sentinel after its current block. The worker's final result has a separate channel, avoiding competition with pending inputs. Optional shared-memory transfer waits for the consumer to finish each original buffer before the producer can overwrite it.

The queued-block metric covers pending float64 statistics arrays. It excludes the currently consumed block, raster arithmetic arrays, GDAL caches, Python overhead and unrelated shared-host files. It is not a measurement of total process or cgroup memory.

## Install the complete native adapter

The selected application retains `model/native.py` in
`retained-application-source`. Its import of `model.native_stats` requires
the helper to travel with every assembled or cumulative installation.
`integration/component_fragments/native-statistics.json` extends that same
component with the helper, this guide and the original-input comparison command.

Keep the fragment and its three declared files in the application source map or
directory when using the existing assembler and cumulative installer. Their
ordinary component inspection composes the fragment before selecting files and
retains its exact source identity. No new component selection or installer flag
is required. Portable application exports retain the fragment alongside those
selected sources.

For an explicit catalogue override, include the same three paths in its retained
application component; explicit overrides deliberately do not discover fragments.
See `integration/COMPONENT_FRAGMENTS.md` for the existing source-map and directory
installation contracts.

## Compare on the actual retained SDR inputs

The receiving command uses the four original aligned SDR rasters already present in the same native operation. It runs the published SDR mutual-mask and masked-DEM operations through the original handoff and then through the bounded handoff. The masked DEM exercises statistics on varying original elevations. It compares every output cell, geometry, type, nodata, exact stored statistics and valid percentage for both outputs. It records original input hashes before and after and preserves all four complete outputs. It does not launch another NDR/SDR model or replace the native run.

```bash
python -m source_tools.check_statistics_handoff \
  --rasters ACTUAL/aligned_dem.tif ACTUAL/aligned_lulc.tif \
    ACTUAL/aligned_erosivity.tif ACTUAL/aligned_erodibility.tif \
  --output ACTUAL/statistics-handoff-comparison
```

Use the existing source owner's actual interpreter and completed alignment paths. If original processing is active, operate its retained completed reference inputs in a separate receiving directory. On resume, the same original selection and completed comparison are reopened.

A successful report contains zero differing cells, equal statistics and the actual bounded-channel mode/queue measurements. A different dependency edition returns its precise source identity for the existing owner to compose. Report native results from this command as observed results; source inspection alone does not provide measured timing or whole-run peak memory.

## Shared-host capacity

This change reduces a concrete queue allocation source for large rasters. The observed Gura interruption occurred with shared 8 GiB usage almost full and owner-managed tmpfs staging dominating memory. Existing GDAL 64 MiB and single-threaded settings were already selected. The original capacity owners continue their verified disk relocation and same-stage recovery; this adapter does not move their files or start another model.
