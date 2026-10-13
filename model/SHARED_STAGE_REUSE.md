# Shared native stage reuse: completed-source correction

Operation: ES-EXP-2319/SHARED-STAGE-REUSE-20261013.

This delivery composes into the selected-model implementation from 70CB Canvas
F0C8JJQ2JBX. It retains that implementation's native stage schema and cache index.
The experiment application is separately delivered in the complete operator v5
Canvas F0C8N2YCHHC.

## Receive into the current application

The JSON packet uses the existing upstate.selected-model-source/v1 format.
Decode the single JSON code fence from the source Canvas into a UTF-8 packet
file. Use the receiver already included in the selected-model source:

    /opt/pyvenv/bin/python /mnt/data/eco12-source/model/receive_selected_model_source.py --application /mnt/data/eco12-source --packet /mnt/data/shared-stage-reuse.json

The packet contains complete replacements for model/reuse.py and
model/stage_cache.py against the exact shared source hashes. It also contains
the complete reference postimage of model/native.py, with three guarded context
edits that compose into unrelated current changes. The current source receiver
checks all file bytes and Python syntax before changing any file. A full
postimage is used only for its declared base; otherwise the native loop joins
are applied to the actual current file. Selected model selection, model
resolution, output mass conversion and completed-run assembly remain in their
own current code.

After receiving, restart the operator process so it imports these modules.
Use the existing run and experiment actions.

## Scientific identity and native throughput

A native stage key includes that model's actual arguments, exact input file
bodies, recorded native module identities and the runtime environment. Current
input descriptors already verified by execute_run are passed through; inputs
are not all hashed again just to compute a signature. Present GDAL dataset
companions are included in input identity. Full biophysical table content is
retained in the identity.

workspace_dir is excluded because each run has its own output location.
n_workers is excluded because it controls scheduling. results_suffix remains
included because it controls native registry filenames. NDR retains its actual
SDR module dependency. The native adapter continues to pin InVEST 3.20.0.

The public run selection and run ID computation are unchanged. Full default
runs continue to omit a models field. Explicit NDR or SDR selections retain
their current selected-model identity.

The loop holds a per-signature .compute.lock while it recovers or produces a
stage. Concurrent run workers requesting the same model calculation therefore
wait for one producer and then read its completed stage. The destination's
existing run lock remains held. Recovery does not acquire a second run lock,
which avoids a cycle between two runs waiting to consume completed stages.

Legacy indexed signatures containing n_workers remain usable: the new index
lookup checks the canonical key and its exact predecessor key, and compares the
recorded scientific selection with only n_workers removed. Stages lacking an
original recorded input signature are left in their original run.

The cache is an index of existing run outputs. It does not create a second
cache copy of every model raster. Missing, changed or unreadable source entries
become recorded recovery observations; the next candidate is considered and
the native model runs when no complete matching source is available. Index
write failures leave the completed original stage usable.

## Independently owned output files

Files are copied with a filesystem reflink when supported, or a streamed copy.
Each resulting body is checked against its retained byte count and SHA256
before atomic publication. Mutable hardlinks are no longer created. A matching
destination inherited from an older hardlink transfer is detached to its own
inode when it passes through this helper.

A resumed transfer retains matching independent files. For an unfinished native
stage, a conflicting partial file can be replaced only after a complete source
body has been verified. This lets recovery switch to another matching source
when the previous source disappears. Completed native stages are handled by the
existing same-run completion branch and keep their retained outputs.

The helper records every native registry ID and the original path kind:
file, directory, unmaterialized path or JSON value. A returned directory's
materialized children are retained as additional_files when they have no
individual registry ID. Dataset companions are captured when execution finishes
and copied using those original descriptors. Recovery does not replace an old
companion descriptor with a new hash of today's source file.

The cache copies original source arguments to a content-specific filename and
also retains the destination's requested arguments. Different matching sources
can therefore have different source argument paths without colliding.

## Retained stage fields and operator timing

The shared stage retains started_at and completed_at from its original native
execution. reused_from.run_id identifies the immediate source. The original
input signature, original argument descriptor and previous reuse lineage remain
in reused_from.

A reused stage additionally records:

- reuse_started_at: when this destination's transfer begins.
- reused_at: when this destination's complete transfer finishes.
- transfer.files and transfer.bytes: unique output bodies plus source arguments
  considered during this transfer, including already retained matching files.
- transfer.methods: counts of reflink, copy and retained files.
- registry_outputs: each native registry ID and materialized path kind.
- additional_files: descriptors for unregistered children of registry directories.

Original execution duration is completed_at minus started_at. Current transfer
duration is reused_at minus reuse_started_at. These are distinct measurements;
the operator v5 observer already reads both. The elapsed transfer includes
destination/source checking performed within the recorded transfer interval.
It excludes earlier candidate index lookup and small source-argument checks.

Native artifacts and their mass units are unchanged. A selected 300 m grid
continues to use its actual affine area through the current rasters adapter;
this correction does not add a second area conversion.

The existing portable archive inventories stage-cache and retained run files.
Native operation writes occur under the existing run lock, which archive
creation already acquires. Temporary .write- files and .lock files follow the
existing archive exclusion rules.

## Receiving exercise on the retained native workspace

Use /mnt/data/eco12-run/receiving and the existing selected-model flow. Record
the actual baseline run ID and its NDR/SDR stage timing, then run a retained
profile that changes only an NDR parameter on the same grid and scenario.
NDR should execute for that profile while SDR carries reused_from.run_id and
the current transfer timing. Record actual wall time and transferred bytes from
the retained stage. Compare one copied output's source and destination inode;
the destination must independently own its inode. Resume the same completed run
through the operator and reopen its case page to inspect retained provenance.

Use the same exercise when there is already a suitable completed baseline; an
extra baseline calculation is unnecessary. This package was composed from
verified shared source and exact guarded source transformations. Native timing
and imports are performed by the actual receiving host as part of installation.

## File bases

- reuse.py: 48aa029e3d55c7198dad8b6701f614dc5f9e854e3772f7e07c4b258c36890e0f
- stage_cache.py: 04cd6739c1d4853d30fc50206a9e3602697809a36c81fa4cb25dbc79f548ffbf
- native.py: b9ebcf558d417bbc4dfb9cc3b49342393a30829a2b251fbc3bd7cc1aeb2843f6
