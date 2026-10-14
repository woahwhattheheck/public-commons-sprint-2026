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

## Move completed acquisition to another cloud

Transfer `parts.json` and every listed `w64pNNN.zip` from that same work directory. Also retain `environment.yml`, `solver.json`, `selection.json` and `upstream-explicit.txt` alongside the original operation. Volumes default to 384 MiB and contain unchanged compressed packages, not another installed environment. The completed manifest is written after every required package and volume has completed.

```sh
python source_tools/native_runtime/conda_cache.py receive \
  --manifest /ABS/RECEIVED/parts.json \
  --destination '/ABS/OWNED/Windows package cache'
```

Receiving compares the complete volume membership, package bytes and publisher digests, then writes `selection.json`, original packages under `pkgs/win-64` and `pkgs/noarch`, and a native `local-explicit.txt`. It streams members to selected paths rather than trusting ZIP extraction paths. Interrupted receiving reuses matching files; a changed existing file is retained and reported. After physically moving the package cache, rerun the same receive command at the new destination to refresh its file-URI explicit lock.

## Compose with the existing original cache extractor

The retained N29 native build-tools package already supplies `extract_package_cache.py`, original zstd and the conda-pack writer. Its extractor accepts `selection.json` package records; its `--archives` is one flat directory, so pass each selected subdirectory explicitly. With `SDK` set to the directory actually containing N29's extractor and `RECEIVED` set to the completed receiving directory:

```python
import json
from pathlib import Path
import subprocess
import sys

sdk = Path('/ABS/EXISTING/Ecosystem_Native_Build_Tools_N29')
received = Path('/ABS/OWNED/Windows package cache')
expanded = Path('/ABS/OWNED/windows-expanded-cache')
selection = json.loads((received / 'selection.json').read_text(encoding='utf-8'))
for subdir in sorted({p['subdir'] for p in selection['packages']}):
    plan = received / ('extract-' + subdir + '.json')
    plan.write_text(json.dumps({'packages': [p for p in selection['packages']
                                           if p['subdir'] == subdir]}), encoding='utf-8')
    subprocess.run([sys.executable, str(sdk / 'extract_package_cache.py'),
                    '--plan', str(plan), '--archives', str(received / 'pkgs' / subdir),
                    '--cache', str(expanded), '--target', selection['target']], check=True)
```

This runs on Linux Python 3.12 or newer and preserves each package's original `info/index.json`, `info/paths.json`, placeholders and license bodies. The resulting expanded cache is the explicit cache input for the existing origin-preserving prefix packer. Keep it with the original packages; do not fabricate a `link.source` path or replace the selected package's metadata.

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
