# Offline first-stage Python payloads

This build tool supplies the interpreter used by the existing Windows/Mac root launcher before the scientific archive has been received. It does not replace the scientific environment, runtime receiver, dependency preparation or collection/session opener.

## Build in a networked cloud container

Requires Python 3.12+ on the packaging host. The recipient needs no installed Python. From this source carrier:

```sh
python application/source_tools/build_bootstrap_payloads.py \
  --sources packaging/BOOTSTRAP_SOURCES.json \
  --collection staging --cache downloads --fetch \
  --zip Bootstrap_Python_Overlay.zip
```

In the working repository the script is `source_tools/build_bootstrap_payloads.py`, without the carrier's `application/` prefix. Downloading is explicit and build-time only. The three publisher-pinned archives are verified before extraction and can instead be supplied offline:

```sh
python application/source_tools/build_bootstrap_payloads.py \
  --sources packaging/BOOTSTRAP_SOURCES.json --collection staging \
  --archive 'windows-x86_64=/incoming/cpython-windows.tar.gz' \
  --archive 'macos-x86_64=/incoming/cpython-mac-intel.tar.gz' \
  --archive 'macos-arm64=/incoming/cpython-mac-arm.tar.gz' \
  --zip Bootstrap_Python_Overlay.zip
```

The supplied archive filenames can differ; their bytes must match the pinned source SHA-256. Do not rename an archive from another target to make it pass selection.

The source pins refer to the publisher's September 1, 2026 CPython 3.12.14 `install_only_stripped` artifacts. These contain the Python installation rather than a compiler/build tree. The publisher describes the distribution formats and stripping behavior in its [distribution documentation](https://docs.astral.sh/python-build-standalone/distributions/); exact SHA-256 values are from the [release asset index](https://github.com/astral-sh/python-build-standalone/releases/expanded_assets/20260901). The bootstrap's version is independent of the selected scientific CPython 3.12 environment. Preserve the complete supplied standard library, shared libraries and licenses.

## Output and existing launcher contract

The same overlay supplies all three targets:

```
bootstrap/windows-x86_64/python.exe
bootstrap/macos-x86_64/bin/python3
bootstrap/macos-arm64/bin/python3
bootstrap/<target>.json
BOOTSTRAPS.json
```

Each target contains the complete upstream installation, not just its executable. Unix file aliases are resolved into ordinary file copies so standard Windows ZIP extraction can carry the entire multi-platform bundle. File names, file bytes and executable permissions are retained in the descriptor. The actual binary header determines CPU/format and, when present, its recorded Mac deployment version. That version describes the interpreter only; the final release minimum must also include every native dependency.

`BOOTSTRAPS.json` uses `upstate.bootstrap-payloads/v1`, with `platforms` keyed `windows-x86_64`, `macos-x86_64`, `macos-arm64`. A platform value is the exact existing launcher's `bootstrap` object:

- `directory`: collection-relative `bootstrap/<target>`.
- `python`: relative to that bootstrap directory, not to the collection.
- `files`: every shipped upstream regular file with prefix-relative `path`, exact `bytes`, `sha256` and executable `mode`.
- `upstream`, `python_version`, `platform`, `executable`: actual source and binary metadata.

The builder's `.ecosystem-bootstrap.json` is internal recovery metadata and is included in the overlay but not in the upstream-file inventory. It allows recovery if packaging stops between complete directory publication and the companion index publication. Every original file is rechecked before reuse; an occupied destination with different bytes is left unchanged.

To compose the bootstrap into the actual runtime manifest without changing scientific selections:

```sh
# Add these arguments to the completed staging invocation.
--spec /incoming/NATIVE_RUNTIME.json \
--spec-output /out/NATIVE_RUNTIME.composed.json
```

Input must use the agreed `upstate.offline-native-runtime/v2` `platforms` object. The exact scientific target must already exist once. Only `bootstrap` is added. Existing archive identities, Node/wheel descriptors, relocation, native package selection and environment remain unchanged. Conflicting pre-existing bootstrap selections are preserved and reported rather than overwritten. Darwin aliases are accepted at the read boundary but contradictory duplicate target records are rejected.

Overlay its `bootstrap/` and `BOOTSTRAPS.json` into the complete collection. The final assembler must retain ZIP executable attributes when combining the overlay. It must continue using the existing root launchers, runtime receiver, dependency preparation, session and native process owners. This source carrier is additive and does not replace Current195, the original R5 application or the seven study workspaces.

## Focused execution and publication

`--probe-host` runs a small compression/SSL/ctypes/archive/file/subprocess course only for an actually matching host OS and CPU. It never executes a foreign target or runs scientific models. The emitted `native_probes` map contains only probes actually executed; an empty map means none ran.

The cloud packaging check in `PACKAGING_CHECK.json` exercised small archive fixtures for the three target formats, link materialization, stable ZIP modes, exact scientific-manifest preservation, reuse and interrupted-publication recovery. It is a packaging check, not a Windows/Mac application launch result. Actual runtime archives are separate output of the build command.

Keep the final Windows application receiving/use and owner-only ZIP delivery on their existing shared course. Current owner direction is `2026-10-14.1`, approved actions 1–59, with final recipient Bryce. Publish this additive source in the existing public working repository and deliver the complete assembled product privately.
