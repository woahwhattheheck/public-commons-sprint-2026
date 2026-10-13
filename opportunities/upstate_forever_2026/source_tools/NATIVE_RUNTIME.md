# Native runtime receiving

Version 1.0.0 — ASTRA-NATIVE13 — 13 October 2026

This component transfers an equipped Linux InVEST environment to another Linux
host and opens it through the **original application's native runtime**. It
supports complete conda-pack environments, including Python and shared libraries,
and complete built-wheel collections for a matching existing Python/GDAL host.
There is one command-line entry, retained install state, complete offline parts,
and a receiving-host probe. The original Workspace, run IDs, queue, model
arguments, scenario generator and scientific results remain the application’s
own objects and operations.

## Choose the transfer

| Existing capacity | Transfer to retain |
| --- | --- |
| A working Linux conda environment | Capture that complete environment with `capture-conda`. This carries its Python interpreter and native libraries. |
| A Linux host able to build the selected dependencies | Build once with `build-wheels`, then `seal-wheels`. The receiver supplies a compatible base Python and any unbundled native libraries. |
| A retained official conda-pack already exists | Keep the original pack and its donor probe; use `seal-conda`. |
| A package list or conda explicit lock exists | Keep it as build provenance. Obtain the actual package/environment bytes from the equipped source host before offline installation. |

Bootstrap commands use Linux Python 3.12 or later and only the standard library.
The receiving native Python may be a different version when it travels inside a
conda-pack. The maintained `environment.yml` currently selects Python 3.12,
InVEST 3.20.0, conda-forge and nodefaults, plus the application's GIS and rendering
libraries. Always read the actual selected application rather than replacing its
environment declaration with this guide.

## Keep four distinct locations

Use a complete original application directory, the saved scientific Workspace,
the retained capsule, and one new final runtime prefix. Do not put the runtime
inside the application, Workspace or donor prefix. Keep enough free disk for the
compressed capsule, its extracted payload, and the expanded environment. There
is no fixed workload-size limit in the transfer code; file I/O is streamed in
one-megabyte blocks.

Example owned layout:

```text
/owned/application/                 maintained complete source
/owned/study/                       original scientific Workspace
/owned/transfers/invest320.zip      retained complete runtime capsule
/owned/runtime-invest320/           new final receiving environment
/owned/.runtime-invest320.native-runtime/  install state and complete logs
```

Source-only delivery can be used before the component is composed into the
application:

```sh
BOOTSTRAP=/owned/native-runtime-source/source_tools/native_runtime/__main__.py
python3 -B "$BOOTSTRAP" --help
```

After composition, the same CLI is available from the original application root:

```sh
python3 -B -m source_tools.native_runtime --help
```

`identity`, `inspect`, and successful operation results produce JSON on standard
output. Child PID/log-location events go to standard error. Failures return exit
2 with the actual exception type and message; `--debug` adds its traceback.
`probe` also returns 2 when the selected native environment is unavailable.

## Capture an existing native conda environment

The original donor remains in place. `capture-conda` calls the maintained
`conda_pack.pack` implementation from the selected packaging interpreter; it
does not copy an environment and attempt its own relocation. That packaging
interpreter must already have conda-pack available. It may be a different Python
from the original native runtime.

```sh
python3 -B "$BOOTSTRAP" capture-conda \
  --application /owned/application \
  --prefix /owned/existing-invest320 \
  --pack-python /owned/pack-tools/bin/python \
  --output /owned/transfers/invest320.zip
```

The command probes the **actual donor interpreter** against the source pins read
from `model/common.py`, calls the original `model.native.runtime`, captures the
entire conda-pack, reads every archive member, and seals the complete bytes with
package and platform metadata. The capture directory beside the output retains
its request, probe, complete pack and process log, including on a failed attempt.
`--resume` selects that same capture request. An interrupted incomplete pack is
preserved before a new packing attempt; a verified complete pack is reusable.

If capture published its final ZIP before the controlling process lost its
response, repeat the exact command with `--resume`. Under the original capture
lease, the command verifies the complete capsule against the retained capture
request, original packed bytes, donor identity and probe. It completes that same
capture receipt and returns the original capsule with `reused: true`. An already
completed capture follows the same verified reopening path. Neither case
re-probes or repacks the donor. Unowned, changed or symlink outputs remain errors;
use `inspect` for a standalone retained capsule without its original capture
operation directory.

For an already retained pack, first retain its actual donor probe:

```sh
python3 -B "$BOOTSTRAP" probe \
  --python /owned/existing-invest320/bin/python \
  --application /owned/application \
  --output /owned/transfers/donor-probe
python3 -B "$BOOTSTRAP" seal-conda \
  --archive /owned/transfers/original-conda-pack.tar.gz \
  --donor-probe /owned/transfers/donor-probe/runtime-probe.json \
  --application /owned/application \
  --output /owned/transfers/invest320.zip
```

A donor probe describes its actual host; the receiver performs a new probe after
installation. A completed package capture is not treated as a receiving result.

Conda-pack depends on the original conda package cache and a consistent source
environment. Its own errors are retained verbatim in `conda-pack.log`; use the
actual equipped environment/package cache, rather than ignoring missing or
changed files. Captured environments belong in the private project transfer
surface. The published source component contains code, not an environment or a
package cache.

## Build and capture an offline wheelhouse

This path is for a connected Linux donor with the matching Python, compiler and
native GDAL headers/libraries. `build-wheels` invokes ordinary `pip wheel` against
the source owner's actual requirements. It retains all resolved wheels and the
build cache and never installs into the donor interpreter.

```sh
python3 -B "$BOOTSTRAP" build-wheels \
  --python /owned/build-python/bin/python \
  --requirements /owned/selected-native-requirements.txt \
  --destination /owned/invest320-wheel-build
python3 -B "$BOOTSTRAP" seal-wheels \
  --python /owned/build-python/bin/python \
  --application /owned/application \
  --wheels /owned/invest320-wheel-build/wheels \
  --output /owned/transfers/invest320-wheels.zip
```

The requirements must pin the application's selected InVEST version and a GDAL
binding appropriate to the native GDAL build. The complete minimum collection
includes InVEST, GDAL, pygeoprocessing, taskgraph, numpy, scipy, rasterio, Fiona,
Shapely, pyproj, pandas, ReportLab, matplotlib and Pillow, plus every dependency
resolved from the actual requirements. One selected version of each package is
retained. Wheel metadata includes its dependency requirements and wheel tags.
The source manifest records the **actual build interpreter**, not the bootstrap
interpreter or an assumed receiver version.

A locally built GDAL wheel generally does not replace the underlying system GDAL
shared library. A matching Python ABI alone therefore does not establish a usable
native stack. Prefer complete conda-pack transfer when the receiving host lacks
that native library closure.

On the receiver, wheel installation uses `--no-index --no-deps --require-hashes
--only-binary=:all:` and a complete local file-URI/hash list. `pip check` then
checks dependency closure. It does not fall back to downloading or compiling.

## Transfer the complete capsule

A capsule is an ordinary ZIP containing its manifest and the complete binary
payload. Use a private Drive file or a visible Library file. For Library transfer,
retain its actual Library path as well as the file ID so another seat can find
and materialize the same file. Keep the published byte count and SHA-256 beside
the upload. No email self-send is part of this workflow.

When the transfer surface requires smaller files:

```sh
python3 -B "$BOOTSTRAP" split \
  --capsule /owned/transfers/invest320.zip \
  --destination /owned/transfers/invest320-parts
```

Upload `transfer.json` and **every** ordered `.part-000000` member it lists. The
default part size is eight MiB; `--part-bytes` selects another transport size.
This is a partition of the full original file, not a sample or shortened runtime.
A repeated split verifies and reuses matching completed parts of the same file.
On the receiver:

```sh
python3 -B "$BOOTSTRAP" join \
  --manifest /owned/received-parts/transfer.json \
  --output /owned/transfers/invest320.zip
python3 -B "$BOOTSTRAP" inspect \
  --capsule /owned/transfers/invest320.zip \
  --output /owned/transfers/invest320-inspection.json
```

Join rechecks the complete part population, order, sizes and hashes. If a process
dies during a write, the next call compares the saved prefix byte-for-byte with
the original part and appends its remaining bytes. It does not restart a complete
matching transfer or replace a different completed destination. All payload bytes
are checked before installation; the original capsule remains available for
another recipient.

## Receive and use the original application

```sh
python3 -B "$BOOTSTRAP" install \
  --capsule /owned/transfers/invest320.zip \
  --application /owned/application \
  --prefix /owned/runtime-invest320
```

For a wheelhouse, explicitly select its compatible existing base interpreter with
`--python /owned/base-python/bin/python`. The compatibility check inspects that
actual executable. Conda-pack instead carries and uses its own Python.

Installation proceeds through complete payload receiving, environment creation
or extraction, dependency/relocation work, then the receiving native probe.
The probe loads the exact official NDR/SDR source selected by the application,
performs a real GDAL/pygeoprocessing/rasterio round trip, loads the application
support libraries, and calls the **original** native runtime adapter. Its report
contains actual Python ABI, operating system, C library, distribution versions,
model-source identities and any exception. Older/different C libraries are
reported as compatibility considerations; native import/operation results decide
whether the environment is usable. OS/architecture and wheelhouse Python ABI
mismatches require the appropriate actual payload/interpreter.

On successful receiving, JSON returns `state: ready` and the exact `python` path.
Use that interpreter with the unchanged original operator:

```sh
cd /owned/application
/owned/runtime-invest320/bin/python -B operator/server.py \
  --workspace /owned/study \
  --operator-state /owned/operator-state \
  --port 0
```

For the coordinated headwaters demonstration, keep its original recipe,
Workspace, baseline/alternative run IDs and source-owned receiving command. Use
the received Python at the front of that same command. The native driver and
operator remain the only producers of scientific runs and results.

**Keep the conda prefix at its final location after `conda-unpack`.** Moving it
again can invalidate relocated paths. To use another location or host, receive
again from the retained original capsule into a new final prefix.

## Continue an interrupted installation

```sh
python3 -B "$BOOTSTRAP" install \
  --capsule /owned/transfers/invest320.zip \
  --application /owned/application \
  --prefix /owned/runtime-invest320 \
  --resume
```

Resume is tied to the original complete capsule and owned destination. It keeps
completed payload files, venv creation and conda extraction/relocation, while
rechecking the actual native runtime. A failed probe leaves the environment and
full error report in place. Another capsule or an unowned existing environment
is not overwritten. A corrected/replaced capsule receives into a new prefix.

An operation uses a POSIX file lock. Its running install/pack/probe child inherits
the same lease, so killing the controlling session cannot let another receiver
modify the prefix while that child is still working. Ordinary interruption
terminates the operation's own process group; a later resume retains completed
stages. Process death releases the lease when its final surviving holder exits.
No additional daemon, scheduled task or model queue is introduced.

## Original application source integration

Compose the complete source-bank overlay through the maintained application
assembler, or merge its additive files at the original application root. The
new `integration/component_fragments/native-runtime-capsule.json` registers the
complete component using the existing additive fragment contract. It does not
replace the shared component catalogue. No server, model, queue or browser file
is replaced. The original source/Workspace archive continues to carry the
application; a runtime capsule remains a separate private artifact.

```sh
python3 -B source_tools/application_assembly.py /owned/current-application \
  --overlay /owned/ASTRA_NATIVE13_Source_Bank.json \
  --edition upper-savannah-complete \
  --output /owned/received-application \
  --source-map /owned/received-application.json.gz \
  --zip /owned/received-application.zip
```

## Executed development workflows

Run the four complete workflows without network, InVEST, a donor conda cache, or
hosted CI:

```sh
python3 -B -m unittest discover -s tests \
  -p 'test_native_runtime_workflows.py' -v
```

They exercise a 24-MiB-plus-tail transfer killed during a real write and resumed;
an actual offline wheel installation into a fresh venv, dependency check and
honest missing-native-runtime result/recovery; complete tar payload, link and
mode receiving with escape rejection; and a live child retaining the operation
lease after its parent is killed. The wheel and tar members are explicitly named
transport fixtures. Scientific model execution belongs to the original admitted
headwaters operation with its actual native environment and retained inputs.

## Maintained upstream references

- Project environment: `environment.yml` in the selected original application.
- Conda-pack usage, platform/relocation limitations and Python API:
  https://conda.github.io/conda-pack/
- pip wheel, complete dependency builds and local wheelhouse installation:
  https://pip.pypa.io/en/stable/cli/pip_wheel/
- pip secure installation and complete hash requirements:
  https://pip.pypa.io/en/stable/topics/secure-installs/
- Selected InVEST distribution:
  https://pypi.org/project/natcap.invest/3.20.0/
