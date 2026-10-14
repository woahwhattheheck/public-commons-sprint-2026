# Complete native package acquisition and transfer

Build operation: ECO-WIN-DEPS-CLOUD-D84. This is build-host tooling, not a recipient application requirement. Read the application's AGENTS.md and CURRENT_OWNER_DIRECTION.md, version 2026-10-14.1, before composing the Windows/Mac release. Preserve the shared application, original seven workspaces and 82 runs. Runtime producers keep their current prefixes and source writers; final Windows normal use and private delivery remain part of the existing release operation.

`native_runtime/conda_cache.py` uses only the host Python standard library. It adopts a completed original micromamba dry-run result or runs one new-prefix dry-run on the already-equipped network host. It transfers the complete `actions.LINK` selection, including packages absent from `FETCH` because another operation already cached them. It never executes target package code. Original compressed packages retain publisher metadata, native libraries, GIS data and any supplied license bodies.

## Adopt the existing Windows selection

From the actual application root, using an existing host micromamba only when no complete original solver result exists:

```sh
python source_tools/native_runtime/conda_cache.py acquire \
  --environment environment.yml --target windows-x86_64 \
  --work /ABS/OWNED/windows-package-transfer \
  --solution /ABS/EXISTING/windows-solve.json \
  --package-cache /ABS/EXISTING/conda-package-cache
```

`--package-cache` is repeatable and read-only. It accepts ordinary flat caches, per-subdirectory caches and this tool's `pkgs/SUBDIR` layout. A package already matching its publisher checksum is copied locally; only missing packages are downloaded. Pass `--offline` when all bytes are already available. Do not substitute a FETCH-only list, an in-place update transaction, another platform, or an unrelated environment.

When no complete selection exists, replace `--solution ...` with `--manager /ABS/EXISTING/micromamba`. The recorded invocation uses `--platform`, `--dry-run --json`, strict channel priority, and the application's original `conda-forge`/`nodefaults` environment. Its retained `solver.json` is reused on continuation. Do not start another solve after a live same-target selection appears. The adapter supports the current scalar-only environment; a more complex future YAML file requires an explicit parser update rather than silently dropping dependencies.

The current environment has 15 requested packages. Original environment SHA-256: `c936fa143df287115eb88fae80ca5ced1556338338300befdfcd979ab1d9f963`.

The maintained file, not this sentence, supplies every package constraint. Python 3.12 and InVEST 3.20.0 stay selected; their transitive dependencies are the solver's complete actual selection. Package names, versions, builds, subdirectories, public origins and publisher digests travel together.

## Stream directly into volumes on a small network host

When the connected host cannot hold both the compressed cache and its transfer
copy, add `--stream-volumes` to the same acquisition command. Use a new owned
transfer directory for this mode, and adopt the existing `--solution` and caches;
the environment is not solved again. All targets use the same implementation:

```sh
python source_tools/native_runtime/conda_cache.py acquire \
  --environment environment.yml --target macos-arm64 \
  --work /ABS/OWNED/arm-streamed-transfer \
  --solution /ABS/EXISTING/arm-solver.json \
  --package-cache /ABS/EXISTING/pkgs --stream-volumes
```

This streams each original compressed package directly from a matching read-only
cache or its original HTTPS origin into the final stored ZIP volume. It checks
the original solver's package size and publisher checksum while copying, keeps
all metadata and license bodies untouched, and creates no `pkgs` copy in the
transfer directory. The selected package sizes are required to keep every
volume under its declared transfer limit. The standard cached mode remains
available unchanged.

`solver.json` and `selected-plan.json` expose the complete original selection
before package acquisition. Each completed volume is flushed and committed,
then announced on standard output with its filename, size, hashes and members.
`transfer-progress.json` retains those completed volume identities immediately,
so the existing private file carrier can move their bytes while the next volume
is being acquired. It is a progress record, not the final receiving manifest.
The completed operation writes the same `selection.json`, `upstream-explicit.txt`
and `parts.json` used by the existing receiving command below.

Continue with the same command, work directory and original selection. Completed
volumes are reused directly even when their original cache or network source is
unavailable. An unfinished volume retains each completed package through the
reserved `.a64pNNN.zip.streaming.checkpoint.json`; a process restart restores its
ZIP directory and resumes at the unfinished package. Other targets use their
existing volume prefix. The kernel work lock prevents two writers from taking
the same directory. A dropped transfer retries only the unfinished package and
respects the original publisher's Retry-After. Completed volumes, checkpointed
packages and external caches remain intact. A predecessor scratch file without
a checkpoint can be rebuilt under that same work lock. Keep completed volumes
in the producer directory until the operation has produced its final `parts.json`.

Storage for this mode is one compressed package set in its transfer ZIPs, plus
small indexes and any pre-existing solver cache. Packages are never extracted
on the network host. The healthy receiving host performs cache extraction,
native linking and the maintained source-preserving packing path.

## Move completed acquisition to another cloud

Transfer `parts.json` and every listed `w64pNNN.zip` from that same work directory. Also retain `environment.yml`, `solver.json`, `selection.json` and `upstream-explicit.txt` alongside the original operation. Volumes default to 384 MiB and contain unchanged compressed packages, not another installed environment. The completed manifest is written after every required package and volume has completed.

```sh
python source_tools/native_runtime/conda_cache.py receive \
  --manifest /ABS/RECEIVED/parts.json \
  --destination '/ABS/OWNED/Windows package cache'
```

Receiving compares the complete volume membership, package bytes and publisher digests, then writes `selection.json`, original packages under `pkgs/win-64` and `pkgs/noarch`, and a native `local-explicit.txt`. It streams members to selected paths rather than trusting ZIP extraction paths. Interrupted receiving reuses matching files; a changed existing file is retained and reported. After physically moving the package cache, rerun the same receive command at the new destination to refresh its file-URI explicit lock.

## Compose with the existing original cache extractor

Use the maintained `receive --prepare-cache` continuation below, or
`prepare-cache` for already-acquired original archives. Both paths call the
existing N29 extractor directly with the complete original target selection,
including noarch packages. There is no need to split the selection manually or
flatten the received archive directories. The returned `packing_cache` is the
extracted-cache input for the existing origin-preserving prefix packer.

## Native linking and current packing

On the actual Windows build host, regenerate the received directory's local explicit lock as above, then use that host's existing micromamba to create a new owned prefix offline:

```text
micromamba --no-rc --no-env create --offline --yes --prefix C:\eco-build\science --file C:\eco-build\packages\local-explicit.txt
```

Use short owned build paths. Preserve the native linker's conda metadata and original cache. Feed the completed prefix and original/expanded cache to the maintained `prefix_pack.py` with W64's Windows target writer and X64's explicit package-cache join. Their original source and selected APIs remain authoritative; this acquisition module does not replace either writer. Run the existing payload closure and compose the resulting scientific payload with the finished Python bootstrap, Node/Excel and native helpers.

For Mac acquisition, use `macos-x86_64` or `macos-arm64` and the corresponding existing producer/selection. Names begin `m64p` or `a64p`. All target selection stays explicit; receiving never labels Linux binaries as another OS.

The outgoing complete product still needs its original native opening, affected controls, scientific case, report/export/reopen and visible recipient-use course under the standing focused-validation rule. Reuse settled components and original outputs. This tool adds no hosted workflow, watcher, global installation or recipient-side prerequisite.

## Operating result

One focused cache-transfer course covered all 15 requested package names with only one FETCH entry, producer continuation, independent Unicode-path receiving, receiving continuation and rejection of a same-size altered volume. It used clearly marked conda-format fixtures to exercise transfer behavior; fixtures are excluded from the software carrier. Actual scientific software qualification belongs to the acquired native environment and outgoing application.

Publisher references:
- https://docs.conda.io/projects/conda/en/stable/user-guide/tasks/manage-environments.html
- https://mamba.readthedocs.io/en/latest/user_guide/micromamba.html


## Durable package-level streaming continuation

The `--stream-volumes` path now checkpoints each completed original package,
inside the same unfinished stored ZIP, before beginning the next download.
A dropped connection retries the unfinished package. Restarting the same command
and `--work` directory after process termination also retains all checkpointed
packages. The solver result, environment, package order, volume size, URLs,
checksums, filenames, original archives and final `parts.json` format stay fixed.

For every unfinished volume, the owned work directory contains the reserved
`.NAME.streaming.partial` and `.NAME.streaming.checkpoint.json`. The checkpoint
holds the ZIP central directory and its digest, not another copy of package
bodies. It is bound to the exact ordered selection and transfer byte limit.
A resume restores that directory, discards only an uncommitted member tail,
checks every retained package against its publisher hashes, and continues the
original acquisition. A successful final rename removes the checkpoint.
Borrowed caches remain read-only. Completed final volumes remain reusable by
both this producer and the unchanged receiving command.

Continue an ended streaming acquisition with its original command, original
`--solution`, `--package-cache` inputs and the same `--work`. Keep an already-live
producer running; the original kernel work lock still gives a single writer.
Do not change `--part-bytes` or `--stream-volumes` on an existing request-bound
work directory. A pre-checkpoint predecessor's unfinished scratch can be rebuilt
under its existing work lock; its previously completed final volumes survive.

The focused receiving course used the actual retained upstream conda-pack
`.conda` archive and the original micromamba binary artifact as transport inputs.
An abrupt process exit occurred while writing the second member, after committing
the first. The restarted process fetched only the second source. The complete
7,850,084-byte output independently reopened with both original byte identities;
the original conda archive was then received by the existing N29 extractor.
The 461-byte checkpoint retained the already-completed package. The operation
and original origins are recorded in `operating/RESULT.json`.

## Continue directly into the original extracted package cache

`receive` retains compressed archives under `pkgs/<subdir>/`. Those are native
installer inputs, not the extracted package directories expected by the
origin-preserving packer's `--package-cache`. The maintained continuation now
connects these two stages using the **existing N29 build toolkit**, without a
second implementation of its package decoder or running target programs.

On the healthy Linux receiving host, use the same complete transfer manifest:

```sh
python -B source_tools/native_runtime/conda_cache.py receive \
  --manifest /received/windows-transfer/parts.json \
  --destination /work/windows-original-packages \
  --prepare-cache --build-tools /tools/Ecosystem_Native_Build_Tools_N29
```

The result keeps the existing `package_cache` and `explicit` fields for raw
archives, and adds `packing_cache`, `packing_inventory`, and `packing_explicit`.
Pass **`packing_cache`** directly to the existing `prefix_pack.py
--package-cache` option. Its immediate children are the original package
folders, with `info/index.json`, original `info/paths.json` placeholders,
licenses, data and native libraries. The same unchanged N29 receiver writes the
ordinary cache-side `info/repodata_record.json` and retains each original archive.

For bytes already acquired by the existing producer, the transfer need not be
repeated. Both `selection.json` and the original `selected-plan.json` work:

```sh
python -B source_tools/native_runtime/conda_cache.py prepare-cache \
  --selection /work/windows-acquisition/selection.json \
  --archives /work/windows-acquisition \
  --archives /existing/read-only-solver-cache \
  --destination /work/windows-packing-cache \
  --build-tools /tools/Ecosystem_Native_Build_Tools_N29
```

Use the corresponding retained Mac target selection with the same command.
Each `--archives` directory may be a flat solver cache, the `pkgs` directory,
or the complete receiving directory. The command resolves the entire selected
set and checks every archive before creating an extracted cache. A missing
package produces the full missing-name list so an existing acquisition can
return just those original bytes. It does not rerun a solve or download files.

The returned `packing_cache` joins the original and completed prefixes already
owned by the platform producer:

```sh
python /tools/Ecosystem_Native_Build_Tools_N29/run.py \
  --application /work/application \
  --script source_tools/native_runtime/prefix_pack.py -- \
  /work/original-prefix /work/completed-prefix /work/native-runtime.tar.gz \
  --target windows-x86_64 --format tar.gz --archive-root runtime \
  --package-cache /work/windows-packing-cache
```

This uses the current W64/X64 writer selected by the application. Linking,
noarch entry-point generation and package post-link actions still belong to the
existing environment producer; extracted package folders are not themselves a
linked Python environment.

### Interrupted receiving, reuse and physical moves

The extraction cache has one nonblocking operation lock plus the existing
per-package locks. Each finished package is committed separately by N29;
`cache-progress.json` records progress and `packing-cache.json` is published
after the entire selected set is prepared. Repeating the same command reuses
unchanged packages. A crash after raw receiving therefore resumes extraction
without another download, solve or target execution.

Request identity binds the full original selection and the actual extractor
source, but not host-local archive or SDK paths. After physically moving the
raw input and the extracted cache, run the same `prepare-cache` command with
their new paths. The package inventory remains relative and byte-identical;
the local explicit lock is refreshed with file URIs for the current location.
A changed package, unrelated cache directory or different original selection
is preserved and reported rather than overwritten.

This build-side continuation requires Linux Python 3.12 or newer and the
already-received N29 toolkit. Its original checked Linux compression tool is
used directly. The default `acquire` and `receive` paths, existing transfer
format, platform solves and target runtime writers are unchanged. The optional
`--max-unpacked-bytes` retains the existing per-package expansion bound.
