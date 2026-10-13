# Original dlt runtime installation and complete receiving

This is the runtime arm of the complete dltHub pipeline migration and recovery application. It installs original dlt1.31.0 at commit2360d229c77f7f64692acc31a4555f4cfcd50ed3 with the original lockfile and only its DuckDB extra. The application owns extraction, normalization, loading, migration decisions and retained pipeline state. The installer supplies one selected executable and complete dependency identity to that same programme.

## Installation

Use an existing Node runtime, Git, Linux flock, the selected existing CPython3.12 executable and an existing uv executable. The receiving selection is Linux. Preserve the Python executable's absolute symlink path when passing it.

```sh
node runtime/runtime.mjs install --directory /absolute/private/dlt-runtime --python /absolute/original/python3.12 --uv /absolute/original/uv
node runtime/runtime.mjs verify --directory /absolute/private/dlt-runtime
```

The directory must be new or already selected by this installer. Source acquisition uses the original public Git repository and exact commit. The complete tracked tree is measured against every Git blob and the four previously retained original file hashes. The original source, including Git metadata, remains at source/. The private uv-cache, selected copied uv binary and virtual environment are separate.

The native command is original `uv sync --locked --no-default-groups --extra duckdb --python SELECTED_PYTHON --no-python-downloads`. The original pyproject and lockfile stay unchanged. It uses a private cache and environment and disables default groups. This avoids the full development, source, pipeline, dashboard and agent dependency groups. The subsequent native dependency check and import inspect the actual installed original dlt and DuckDB.

An interrupted installation continues in the same directory with the same invocation. The installer retains complete command stdout/stderr and the current child identity. A kernel flock lease stays open through the original installer and every actual child, including nested receiving. The inherited file descriptor keeps the directory selected even if its parent exits before saving the child record. Immutable source/selection publications use fsynced temporary files and atomic links. Installation retries reuse the same source and uv state.

## Continue a corrected failed installation

The helper uses Python `-P` for its standalone inspection and transfer scripts, preserving the selected virtual environment while excluding the scripts' directory from Python's implicit import path. This prevents the runtime's `inspect.py` from shadowing the standard library module used by installed packages.

When the original install has closed with a failure and the installer needs a source correction, invoke the successor from the application's runtime directory:

```sh
node runtime/runtime.mjs adopt-installer --directory /absolute/private/dlt-runtime --previous-sha256 EXACT_OLD_INSTALLER_SHA256 --command-id EXACT_CLOSED_FAILED_COMMAND_ID
node runtime/runtime.mjs install --directory /absolute/private/dlt-runtime --python /absolute/original/python3.12 --uv /absolute/original/uv
```

The adoption holds the same original kernel lease, requires the exact closed failed command and unchanged original source selection and companions, and rejects an already ready runtime. It preserves both complete helper versions and a resumable adoption record under `installer-revisions/` before replacing the selected installed helper. An interrupted adoption resumes from that same record; unrelated or unknown helper versions remain an error. Installation then continues against the same original checkout, environment, dependency cache and command history. A live child retains the inherited lease and prevents adoption.

## Application contract

Read runtime-ready.json after installation or receiving. Its schema is `dlt-workshare.runtime-ready.v1`; state must be `ready`. The record includes:

- version1.31.0 and the exact sourceCommit.
- python.executable, version, implementation, binary SHA256, ABI, machine and libc.
- source.path and the complete source manifest SHA256.
- all installed distribution names, versions and member counts.
- original DuckDB package and engine versions.
- selected uv binary SHA256 and actual version.
- runtimeId / identitySha256, plus the complete local installedManifestSha256.

The source manifest covers every tracked original file. installed-manifest.json measures every declared installed member, including generated entry scripts and distribution metadata. Python bytecode is omitted. A second path-independent identity retains package bytes while replacing only the runtime-root text in editable path metadata and generated scripts. RECORD itself is checked locally; its listed payload is independently included in the stable identity. The original dlt import must resolve inside the selected complete checkout.

Before an original application operation, `verify` remeasures the same source and installed selection. Its JSON output returns the unchanged ready contract plus the verification time. For an actual data operation, use `run` below to keep that same selected installation locked through its entire worker lifetime. Do not resolve away the environment's executable symlink or substitute the host base Python.

Invoke the existing worker through `node runtime/runtime.mjs run --directory RUNTIME --cwd PRODUCT --operation-lock ABS_JOB/lifetime.lock --argv-json JSON_ARRAY`. Supply arguments as a native process array. JSON_ARRAY is the serialization of `[ready.python.executable, absoluteWorkerPath, 'run', '--directory', originalJobDirectory, '--runtime-ready', readyFile]`, adding the original `--resume` argument only for its existing job. The run seam first acquires the original job lifetime.lock, then the installed runtime lease. It checks the complete source/installed runtime, then invokes that exact worker and receives its real exit under both inherited leases. The original job directory must already exist and match the worker's --directory. The worker validates DLT_WORKSHARE_OPERATION_LOCK_FD against its lifetime.lock and uses that inherited open file description, without opening a second exclusive lease or launching nested runtime verification. DLT_WORKSHARE_OPERATION_LOCK_PATH gives the original absolute lock path. The worker inherits that lease descriptor, so a parent loss does not allow the installation to change beneath it. The returned `dlt-workshare.runtime-run.v1` contains runtimeId, full original worker stdout and its actual closed command record; the worker retains its normal job/result files. The wrapper writes runtime-run.json and runtime-runs/ATTEMPT_ID.json inside the same job before verification and after completion or an observed failure. They include the actual wrapper process identity, verification/worker stage, complete argv and the actual command record. A lost wrapper leaves a running receipt; the inherited kernel lock remains authoritative until its surviving child closes. After that lock releases, the application reconciles the original interrupted job from these records.

## Whole runtime transfer

After the actual installation closes, produce the complete original runtime package outside its directory:

```sh
node runtime/runtime.mjs pack --directory /absolute/private/dlt-runtime --output /absolute/delivery/dlt-runtime.tar.gz
```

The output includes full source/Git state, the complete reusable private dependency/build cache, the exact uv executable, the selected identity and all three runtime helpers. The original uv0.12.23 source defines `uv-cache/builds-v0` exclusively as temporary PEP517 build environments and directories. Its children stay untouched on the producing host and have their full file/link inventory recorded as `retainedHostBuildStaging`; they are excluded from the portable member set. Downloaded and built package artifacts remain in their original reusable cache buckets. All other links must still resolve inside the selected runtime root. The portable result gives actual archive byte count and SHA256, and runtime-ready.json receives the same verified portable descriptor. A persistent exact archive candidate lets a retry recover the same accepted output after a lost acknowledgement. The source is measured again before publication; files, links and modes have a complete archive manifest.

A virtual environment contains local executable paths, so the receiver rebuilds it from that complete selection:

```sh
node runtime/runtime.mjs receive --bundle /absolute/received/dlt-runtime.tar.gz --sha256 ACTUAL_ARCHIVE_SHA256 --directory /absolute/receiver/dlt-runtime --python /absolute/matching/python3.12
node /absolute/receiver/dlt-runtime/runtime.mjs verify --directory /absolute/receiver/dlt-runtime
```

Receiving requires the same actual CPython build/ABI/platform identity. It checks the selected archive hash, every member byte/link, safely extracts into a new directory, then runs the original uv sync with `--offline`. The installed source and normalized dependency payload must reproduce the original runtimeId before a ready receipt is published. The new actual executable and source paths remain in that receipt. The ready record also retains the exact selected portable archive path, SHA256, byte count, complete manifest digest and member count, so this received installation can prepare later transfers from the same original archive. A repeated receiving call revalidates all immutable archived source, executable, helper and identity bytes before running uv; only its dependency cache, installed environment and runtime receipts may evolve.

The original application package should carry this runtime tar and its portable-result.json beside its complete pipeline/DuckDB/workspace transfer. Its existing receiving programme invokes this receiver before reopening the customer pipeline. Supply the current ready JSON as the application's runtime selection. The same existing application operation remains the owner of all data effects.

## Operating details

The transfer includes the dedicated completed cache so no uv global-cache cleanup or pruning is needed. The script never installs into the user's Python environment. It does not start a dlt pipeline. All command arguments are explicit; the original project/runtime source and selected package content remain in the delivered tar.

The native interpreter, uv installation, complete source fetch, dependency installation, portable export and offline receiving are execution phases. Their actual results are written by these commands at the receiving host. The application host joins that result to its original pipeline programme.

Original references:
- https://github.com/dlt-hub/dlt/tree/2360d229c77f7f64692acc31a4555f4cfcd50ed3
- https://docs.astral.sh/uv/concepts/projects/sync/
- https://docs.astral.sh/uv/concepts/cache/
- https://docs.astral.sh/uv/reference/cli/

## Correct a failed first portable export

If the first export fails before publishing its member selection, its corrected helpers can be adopted in the same ready runtime. Write a JSON object mapping each of `inspect.py`, `portable.py` and `runtime.mjs` to its exact previously installed SHA256, then invoke the complete reviewed application source:

```sh
node runtime/runtime.mjs adopt-helpers --directory ORIGINAL_RUNTIME --previous-manifest PREVIOUS_HELPERS_JSON --command-id ORIGINAL_FAILED_PACK_ID --runtime-id ORIGINAL_READY_RUNTIME_ID
node runtime/runtime.mjs pack --directory ORIGINAL_RUNTIME --output ORIGINAL_ARCHIVE_PATH
```

The same runtime lease excludes all other runtime use. Adoption requires the exact failed original pack command, the unchanged ready runtime ID and all three complete old helpers; it preserves every previous and successor source file before a resumable prepared/adopted publication. An existing completed export or frozen export selection cannot use this correction path. The installed environment, original checkout, cache and command history remain in place. The following original pack remeasures the complete installed runtime before export.
