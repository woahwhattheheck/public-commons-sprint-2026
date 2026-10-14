# Bundled numerical helpers

The existing terrain conditioner and exact precipitation matcher use the executable
for the running Python interpreter's OS and CPU before considering a compiler.
The two original algorithms, native protocols, grid support, masks, tie rules and
scientific output interpretation are unchanged. No network operation occurs when
selecting a helper.

## Recipient behavior

Terrain `engine='auto'` and `engine='cpp'` select the bundled `terrain_flood`.
The explicit Python engine remains available. A legacy source checkout without a
matching bundle retains the existing automatic Python/compiler choice.

The matching command now omits `--binary` for normal recipient operation.
`match_arrays(..., binary=None)` and `match_points(..., None, directory)` select
the bundled exact matcher. An explicit `--binary` retains the developer override;
`--compile` remains an explicit developer action and is never automatic. The
legacy `source_tools/matched-control-exact[.exe]` is still accepted when no bundle
for the current target exists.

A manifest advertising the current target must include both helpers. An advertised
missing, changed or wrong-architecture file produces a direct repair error instead
of compiling around a damaged release. Source hashes bind each binary to the
actual retained C++ file. These checks establish package consistency, not a digital
signature or proof of algorithm correctness.

Both callers execute the absolute helper path with ASCII data filenames relative
to a private working directory. Original data, project paths and output directories
may contain spaces and Unicode. The C++ Windows entrypoint/Unicode stream port is
maintained by the native-build arm; this Python integration composes with it.

## Package interface

Keep `NATIVE_HELPERS.json` at the application root. Its schema is
`upstate.native-helpers/v1`; `platforms` has these keys:
`windows-x86_64`, `macos-x86_64`, `macos-arm64`. The `darwin-` spelling is accepted
as an alias only when aliases do not conflict. Linux reference bundles use
`linux-x86_64` or `linux-arm64`.

Each platform entry supplies `platform: {system, machine}`, an actual
`minimum_os_version`, and `tools` containing `terrain_flood` and
`matched_control_exact`. Use `Windows`/`Darwin`/`Linux` for system and
`x86_64`/`arm64` for machine. Each tool record supplies:

```text
path: source_tools/native_helper_binaries/<target>/<executable>
source: source_tools/<tool>.cpp
source_sha256: SHA256 of the exact retained C++ file
sha256: SHA256 of the actual executable
bytes: actual executable byte count
format: pe | mach-o | elf
```

Record real compiler versions, commands, minimum OS, runtime dependencies and
licenses alongside these records. Windows files must be PE32+ AMD64 programs with
`.exe` filenames. macOS files must be thin little-endian 64-bit Mach-O executables
for the selected CPU. Set and preserve executable mode on POSIX. Ship all required
runtime libraries and licenses; recipients must not install compiler runtimes.

Payloads belong under **source_tools/native_helper_binaries/**, not a new root
folder: the existing `model.portable._application` retains this source family and
the root manifest automatically. Its original ZIP exporter/receiver retains file
modes. This avoids changing the shared portable archive implementation and carries
helpers through project backup, restore and relocation. Keep staged builds outside
the outgoing application and publish the manifest only after all payloads exist.

Package builders can inspect both executables for all three required targets using
the application's Python:

```sh
python source_tools/native_helpers.py --application /path/to/application \
  --require-target windows-x86_64 --require-target macos-x86_64 \
  --require-target macos-arm64
```

This command reads hashes and executable headers; it does not claim native target
execution. Run the finished Windows/Mac application through the existing receiving
course, including ordinary scientific actions and project reopening.

## Maintained source integration

`native-helpers.json` selects the complete resolver, both complete Python callers,
this guide and the component fragment in the existing application composer. Add
actual binaries and `NATIVE_HELPERS.json` to the final application before freezing
its release. The C++ sources are independently retained and built by the native
build arm; the resolver checks their deployed hashes instead of pinning a stale
predecessor in Python.

No browser views or scientific report templates are changed by this component.

## Native Windows source join

The original C++ helpers now use the native UTF-16 `wmain` entry point on Windows. Both explicit GNU/Clang developer compiler routes therefore add `-municode` on Windows. Release execution uses the bundled programs directly. This caller change is composed with the complete C++ source from commit `2c9eb08a2324eafa9fbd8088f98ce4a63ef5615c`; Linux and macOS compiler arguments retain their existing entry point.

## Complete retained source inventories

The native build producer records `source_files` for each executable, including the
original C++ translation unit and every recursive local header. When supplied, the
resolver verifies every contained path, byte count and SHA256, rejects duplicate
records, and requires the original translation unit with a consistent identity.
The manifest SHA256 in helper provenance binds this complete inventory. Existing
manifest editions without `source_files` retain the original single-source check.
