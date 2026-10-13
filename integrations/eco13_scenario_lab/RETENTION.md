# Receiving large completed experiments

The storage extension composes with the complete scenario workbench 0.1.2 and
Workspace bridge edition2. It keeps the existing plan, native arguments, result
bindings, job keys and comparison arithmetic while reducing repeated file work.

## Use the existing commands

Current original Workspace experiment receiving uses:

```sh
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab adopt-upstate ORIGINAL_WORKSPACE EXPERIMENT_ID NEW_COMPARISON --project-id PROJECT --setup-id EDITION --currency USD
```

The complete original case/run selection, paired metrics, partial model states,
saved costs/objectives and portable reports continue through the current 0.1.2
receiver. [UPSTATE_RECEIVING.md](UPSTATE_RECEIVING.md) documents that flow.

Legacy NativeJobsEngine experiment receiving still uses:

```sh
python -m eco_scenario_lab.experiment_intake selection.json /work/new-comparison
python -m eco_scenario_lab export /work/new-comparison /delivery/experiment.zip
python -m eco_scenario_lab receive /delivery/experiment.zip /work/independent-copy
```

Workspace plan/adopt/run continues through eco_scenario_lab.workspace_cli.
Workspace and legacy intake use the existing store.snapshot API, which now creates
independent copies through the retention implementation. Legacy intake shares one
RetentionSession across all selected inputs and complete native directories. The
current Upstate receiver shares a session across its original source-relative files
and trees, preserving its public layout and registered native descriptors.

## Complete retained objects

Inputs keep their original layout and dataset identities:

```text
inputs/<original dataset hash>/<original filename>
```

A dataset includes the same full Shapefile family and raster companions as before.
The dataset hash is the unchanged store.dataset_hash over original filenames and
file SHA256 values. Argument paths, source_input_digests and comparison keys
therefore keep their original scientific meaning.

## Current original Workspace layout

The current Upstate experiment receiver preserves its exact existing paths:

```text
original/<original workspace relative path>
upstate-received.json
plan.json
state.json
reports/
receiving-storage.json
```

Each original path is copied independently once. Repeated grid/run/source
registrations reuse its verified received file and the operation's original-file
hash. Complete native trees retain every file and are checked again before
publication. Completed stages from partial runs retain both executed arguments
and the current requested-arguments record when present. The original paired
results, partial status, grid support, scenario costs and report editions are
unchanged. Source paths remain directly mapped through original/path-map.json.

The complete-tree cache never merges different original paths in this route.
Filesystem reflinks can share data blocks while preserving independent paths.

## Legacy native object layout

Selected legacy NativeJobsEngine results use complete received native objects:

```text
native-objects/<complete file inventory hash>/<original relative filename>
runs/<original intake job id>/original-run.json
runs/<original intake job id>/native-files.json
runs/<original intake job id>/native-reference.json
runs/<original intake job id>/results.json
```

The inventory hash covers every retained regular file's relative path, byte count
and SHA256. Hidden files and nested files are included. When another selected
result points into the same original native directory, or a different directory
with exactly the same complete inventory, it refers to the existing received
object. Each result keeps its own original job, native pointer, arguments,
selection, extracted values and provenance.

The authoritative table path remains state.jobs[job_id].native_table_path.
The existing comparison, HTML, ranking and portable export/receive code already
uses that path. Its new native_storage entry and native-reference.json identify
the received object and its full logical size. A consumer should follow the
recorded table path when opening a result.

Completed native objects are shared within this immutable received edition.
An exported/received workspace has its own independent files. Scientific changes
continue through the original experiment or Workspace scenario workflow, whose
completed results can then be received as a new edition.

## Copying and operation-scoped reuse

On Linux, the copier uses the runtime's fcntl.FICLONE constant when available.
A supported filesystem creates a separate inode with shared copy-on-write data
blocks. Later writes to sender or receiver affect their respective files.
Unsupported filesystems and cross-device copies use shutil.copyfile; neither
route creates hard links or symbolic links to a sender.

Python exposes the FICLONE constant from version3.12 where the platform supports
it. Older runtimes continue with ordinary copies. Real capacity, permission and
I/O failures preserve their original error context. A copy-on-write operation
still needs filesystem metadata and future edits can allocate additional blocks.

A RetentionSession hashes each original regular file once. On every reuse it
checks the device, inode, byte count, mtime and ctime against the captured source.
It verifies each new retained body by SHA256, then checks source fingerprints,
dataset membership, complete native directory membership and retained file
fingerprints before the staged workspace becomes visible. The cache exists only
for this receiving operation; it is never loaded as a persistent trust shortcut.

New snapshots can share the cache explicitly:

```python
from eco_scenario_lab.retention import RetentionSession
from eco_scenario_lab.store import snapshot

retention = RetentionSession(staging)
relative, files = snapshot(original_input, staging, retention=retention)
native = retention.native_directory(original_native_directory)
storage = retention.verify()
```

## Receiving counters

The completed intake returns storage counters and writes receiving-storage.json.

| Field | Meaning |
| --- | --- |
| source_files_hashed / source_bytes_hashed | Original-file hash work performed by the operation cache. |
| input_dataset_requests / input_dataset_reuses | Snapshot requests and requests whose source dataset was already described. |
| native_directory_requests / native_unique_directories | Selected complete directories and distinct complete received objects. |
| native_directory_reuses | Directory selections served by an existing exact object. |
| native_logical_bytes_requested | Complete native bytes across all directory selections. |
| native_logical_bytes_retained | Complete native bytes in distinct received objects. |
| native_logical_bytes_avoided | Repeated complete-directory bytes that needed no additional object. |
| reflink_files / reflink_logical_bytes | Files and logical bytes successfully cloned by the filesystem. |
| copy_files / copy_logical_bytes | Files and logical bytes received by ordinary independent copy. |
| retained_files / retained_logical_bytes | Unique retained file paths and their logical sizes. |
| relative_file_requests / relative_file_reuses | Original-layout path requests and requests served by the same received path. |
| relative_tree_requests | Complete original-layout directories checked and retained. |

These counters describe the actual receiving operation. Logical bytes are file
lengths; physical block savings depend on the filesystem, existing shared blocks
and later writes.

## Source receiving check

```sh
python receiving/check_retention.py --source integrations/eco13_scenario_lab \
  --output receiving/retention-result.json
```

This single standard-library journey loads the delivered store and retention
modules and the current Upstate receiver class, receives complete input families,
repeated native directories and source-relative native paths,
checks source/receiver independence, exports and receives the actual portable
archive, and exercises changed-source and added-file rejection. Its output
records the copy method that actually ran on that filesystem and the observed
reuse counters.

## Platform references

- [Python fcntl constants and ioctl API](https://docs.python.org/3/library/fcntl.html)
- [Linux FICLONE copy-on-write semantics](https://man7.org/linux/man-pages/man2/FICLONE.2const.html)

## Portable archive publication and receiving

Export holds the original comparison lock, captures every regular file, and streams
each member into a private archive while computing its SHA-256. File identity and
the complete directory membership are checked before publication. This uses one
full source read per member, including large native rasters.

Every export uses its own temporary file. The final archive is published with an
atomic create-only link on the destination volume. If another operation creates
that filename first, its archive remains intact and this export reports the
conflict. A retry chooses a new output filename or reopens the completed operation.

Receiving checks schema 1, canonical relative paths, complete manifest membership,
regular-file types, lengths and hashes. Each received file is written privately
and synced in a staging directory. Publishers for the same destination share a
destination lock; after checking that the destination is still absent, receiving
promotes the complete edition and syncs its parent directory. Original workspaces,
completed archives and existing receiving directories retain their contents.

The native operator's export, upload and receive actions use these same functions.
Saved report choices, original physical quantities, native source identities and
independent report editions travel together through the existing archive format.
