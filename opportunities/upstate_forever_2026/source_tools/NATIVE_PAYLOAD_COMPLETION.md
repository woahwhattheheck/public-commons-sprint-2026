# Native runtime payload completion

ECO-PORT-PAYLOAD-LINK-A9E1 / 1.0.1. This is the assembly-side completion arm of
approved portability items 8, 48, 50 and 56. Read `CURRENT_OWNER_DIRECTION.md`
2026-10-14.1 and the current `AGENTS.md`. The shared Windows/Mac release retains
all seven Workspaces and the original 82 runs. These additive tools do not change
scientific sources, package selections, application entry points or saved work.

## Complete the selected environment

Use the exact native environment selected by the runtime builder. Supply donor
prefixes only for the same already-selected conda package builds. A missing DLL
is repaired by copying its entire selected package, including data, aliases and
installed licenses, rather than collecting unrelated libraries by filename.

```sh
python source_tools/native_runtime/payload_closure.py complete BUILD_PREFIX \
  --target macos-arm64 --destination NEW_STAGING_PREFIX \
  --donor MATCHING_PACKAGE_PREFIX --package-cache ORIGINAL_CONDA_PACKAGE_CACHE \
  --minimum-os-version 11.0 --json completion.json
```

Targets are `windows-x86_64`, `macos-x86_64`, `macos-arm64`. Linux x86_64/arm64
are supported for the existing cloud/reference runtime. Nothing is downloaded or
installed globally. The original prefix and donor trees are read-only inputs.
The new staging directory is published only after dependency completion; failed
work removes only its own temporary directory.

The report carries actual package builds, file hashes, local/OS imports, remaining
weak imports, minimum versions declared by native binaries and references needing
the normal relocation step. An explicit minimum lower than a shipped binary's
minimum is rejected. Windows PE subsystem versions are binary fields, not Windows
marketing names; the release's supported Windows version remains its existing
manifest selection.

## Preserve relocation origins when packing

Do **not** run `conda-pack -p NEW_STAGING_PREFIX` on a copied environment without
preserving original origins. Its binaries can still contain the old environment
or long conda build prefix. The included adapter passes the original per-file
records to the existing conda-pack writer and preserves the retained
`conda-unpack` relocation data. It regenerates the normal activation/unpack files
once, avoiding duplicate archive members. It does not implement another native
relocator.

```sh
BUILD_PYTHON source_tools/native_runtime/prefix_pack.py \
  BUILD_PREFIX NEW_STAGING_PREFIX Native_Runtime.tar.gz \
  --target macos-arm64 --donor MATCHING_PACKAGE_PREFIX \
  --format tar.gz --archive-root runtime --json archive.json
```

`BUILD_PYTHON` is the build interpreter with the maintained `conda_pack` installed.
Use the native Windows conda-pack writer for Windows payloads; use its POSIX
writer for macOS/Linux. No target binary is executed during inspection or
packaging. The programmatic integration is:

```python
from source_tools.native_runtime.payload_closure import complete
from source_tools.native_runtime.prefix_pack import packing_environment
complete(original, staging, target=target, donors=donors, package_caches=caches)
environment = packing_environment(original, staging, target=target, donors=donors)
environment.pack(output=archive, format="tar.gz", arcroot="runtime")
```

The completed staging bodies must still match their original or exact donor
origins. For a previously relocated POSIX binary whose original package cache is
absent, receive the original unrelocated archive as the source; a short installed
prefix cannot safely stand in for its original binary allocation. This route was
operated with the complete retained 249,771,729-byte scientific runtime.

`pack_completed()` returns `archive:{filename,bytes,sha256}`, `format`,
`archive_root` and `relocation.script`. Compose these values into the existing v2
platform descriptor. Preserve its Python/Node paths, scientific version pins,
bootstrap, dependency-wheel descriptors and receiver cache identity. The packer
adapter does not rewrite `NATIVE_RUNTIME.json`.

## Loader and licensing behavior

PE inspection includes ordinary, delayed and forwarded imports. Runtime DLLs,
OpenMP/Fortran/VC++ and GIS libraries must be inside the selected prefix. OS API
sets and the explicit Windows system-library set remain OS references. Loader
search uses the existing activated Windows DLL directories; callers adding
another directory must supply it with `--library-dir`.

Mach-O inspection reads thin and universal images, exact CPU/subtype, dylib loads,
weak/re-export/upward imports, runpaths and native minimum-OS commands. It follows
`@loader_path`, `@executable_path`, `@rpath` and inherited loader context. Relative
working-directory runpaths do not qualify as relocatable. Absolute references
inside the known original build prefix are mapped for completion and retained in
the report for the normal conda relocation. System frameworks and `/usr/lib`
remain OS references; `/usr/local` is not treated as an OS library directory.

ELF inspection follows the dynamic loader tables, RPATH/RUNPATH and `$ORIGIN`,
including the non-inheritance of RUNPATH. All binary parsing is bounded and uses
memory mapping; it does not run `ldd` or execute foreign programs. Dynamic plugins
not represented by imports must be provided as additional `--root` entries. The
default roots include Python, installed native extensions and shared libraries.
Static closure complements the release's existing real native opening course.

Installed license bodies are retained with their original files. Supply the
actual conda package cache to add package `info/licenses` bodies into
`licenses/NAME-VERSION-BUILD/`; cache package identity must match. The report
lists actual retained bodies, not a claim that a package license label is itself
the full required license text. Keep upstream Node, bootstrap and helper licenses
with their existing owners' payloads.

## Focused use

The complete source carrier contains the manual
`checks/native_payload_course.py NEW_OUTPUT` course. It builds an actual ELF dependency
chain and Windows PE dependency chain, completes one selected missing package,
checks delay/forwarded PE imports, preserves the seed, rejects a different build,
and executes the Linux chain after a Unicode/spaced-folder move. This is a manual
course, not another CI suite.

Optional `--mac-runtime arm64=PREFIX --mac-runtime x86_64=PREFIX` uses actual
selected publisher-built Mac prefixes, including both slice types in a universal
container. The actual September 2 CPython 3.12.14 build artifacts selected by
bootstrap C84D were inspected here: 17 native binaries and 65 imports each,
no missing local libraries, minimums 11.0.0 ARM and 10.15.0 Intel. These are the
bootstrap binaries' minima; the scientific runtimes may require a higher OS.
The same selected Windows artifact was received and inspected: 47 native images
and 336 loader references with no missing bundled libraries. Its `_msi.pyd`
uses the operating system's Windows Installer `msi.dll`; it is classified as an
OS library rather than copied into the recipient payload. Microsoft documents
that DLL in the [Windows Installer API requirements](https://learn.microsoft.com/en-us/windows/win32/api/msiquery/nf-msiquery-msigetactivedatabase).
The header subsystem version does not lower the supported Windows release.

The full original Linux scientific runtime was independently copied, packaged
through the source-origin adapter, extracted to a new Unicode path and relocated
with its generated native `conda-unpack`. Its original InVEST NDR/SDR modules and
all supplied native scientific libraries imported, and EPSG:26917 resolved. This
course exercises packaging with retained sources; new Windows/Mac scientific
runtime selection remains with the existing runtime builder.

## Source composition

The complete carrier includes `APPLICATION_PACKET.json` with just these five
maintained application files, exact full contents and their accepted 1.0.0
preimages. Feed that packet into the existing installer together with the other
selected source layers after its owner admits the five named paths. The full
`COMPLETE_SOURCE.json` also contains the development course and results and is
not an application-only installer input.

Include `native_runtime/binary_dependencies.py`, `payload_closure.py`,
`prefix_pack.py`, this guide and the component fragment together under
`source_tools/` / `integration/`. No launcher, receiver, capsule, scientific
controller or client UI file is replaced. Current builder7027, bootstrapC84D,
receiver7085, capsule7300, Mac archive/mode owner and assembler7069 retain their
existing writers. Final shared release is privately delivered to Bryce at
brycembusiness2@gmail.com after its native opening course; Tim contact stays with
Bryce. Source publication creates no workflow run, watcher or meeting.

## Resume completed packing across handoffs

C72E 1.0.0 adds retained publication inside the existing `prefix_pack.py`; it
introduces no additional application path. The current `transport.py` and
`model/portable_fs.py` / `windows_fs.py` supply their existing native operations.

Append `--resume` to the same packing command, or use
`pack_completed(..., resume=True)`. Keep the original prefix, completed staging,
ordered donors, target, format, archive root and output path unchanged. The
request binds source file bodies, modes and link targets. A changed runtime uses
a new output rather than replacing the previous archive.

A sibling `.<archive filename>.native-pack/` retains the request, state and exact
finished bytes. Its sibling `.native-pack.lock` prevents duplicate live packing.
A lost process after the completed-byte checkpoint resumes publication without
another compression pass; a lost final receipt reuses the original output.
Removed output can be republished from the retained payload. Interrupted
compression retains its partial and restarts into a different private attempt.

Publication is create-only, using the existing verified-copy fallback where
necessary. A competing output stays intact. The source is checked again before
recording a completed payload. Windows uses write-capable flush handles, matched
native ChangeTime observations and the shared extended-path conversion.

The returned archive descriptor keeps its existing fields and adds `reused` plus
a stable `packing_operation.request_sha256`. Private build paths remain in the
journal, not the descriptor. The optional `--json` report is atomic and cannot
name the archive, lock, journal or a selected prefix file. Keep journals, locks
and abandoned partials outside the final recipient ZIP.

The C72E source overlay contains these three updated existing files: this guide,
`prefix_pack.py` and the component fragment. Compose it after A9E1 1.0.1 using the
retained before-source identities. The handoff retains one focused Linux archive
lifecycle course, including actual process termination, same-byte recovery and
a two-process lock. The native Windows adapter join follows the current shared
filesystem API and belongs in the release host's existing receiving course.
