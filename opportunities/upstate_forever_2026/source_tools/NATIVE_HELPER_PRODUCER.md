# Native helper payload producer

The existing Workbench remains the application. This build-machine tool produces
its two unchanged numerical kernels, target executables, retained C++/local-header
source, loader observations, build identities and licenses. It does not install
anything on a recipient machine or modify scientific workspaces.

## Build the six required executables

Run with the completed C++/header sources selected by the active helper-source
owner. The Windows source uses a wide `wmain` entrypoint; this producer supplies
`-municode`. The producer never patches or translates those sources.

```sh
python source_tools/build_native_helper_bundle.py build \
  --application /path/to/selected/application \
  --output /path/to/fresh/helper-payload \
  --zig /path/to/zig-distribution/zig \
  --target windows-x86_64 --target macos-x86_64 --target macos-arm64
```

The complete supplied Zig distribution must retain its compiler and runtime
licenses. The producer does no download or package-manager work. A native build
machine can omit `--zig` for its own target. Linux targets are available for cloud
operation; they do not stand in for Windows or Mac execution.

Each build first snapshots the actual two sources and every recursively included
local header. The six executables use that one source snapshot. The resulting
`NATIVE_HELPERS.json` is the agreed application-root `upstate.native-helpers/v1`
contract: `platforms` with canonical `windows-x86_64`, `macos-x86_64`, and
`macos-arm64` keys; `platform`, `minimum_os_version`, and the two `tools` entries.
Each entry binds its executable, source and complete `source_files` closure by
bytes/SHA256, with actual format/loader metadata and compiler arguments. Source
and binary identities detect a different edition; they are not a digital signature.

Mac minimum-version and system-library references are read from the generated
Mach-O load commands. Windows records actual PE OS/subsystem declarations and
DLL imports. These are loader metadata, not a claim that the full scientific
application supports an older OS: the release must also retain the selected
Python, Node, InVEST and native dependency requirements. A Mac code-signature
load command is reported as present/absent, not represented as notarization.

## Resume and complete one native-helper ZIP in the cloud

Use a persistent cloud work directory to finish the three targets with one
command. Completed targets are retained after a stopped session; invoking the
same command continues with the remaining targets instead of compiling all six
executables again.

```sh
python source_tools/complete_native_helpers.py \
  --application /path/to/selected/application \
  --zig /path/to/zig-distribution/zig \
  --work /path/to/persistent/helper-work \
  --output /path/to/private-handoff/Native_Helpers.zip
```

The command freezes the two sources and their local headers once. Its cache
identity includes their exact bytes, the producer source, compiler version/hash,
compiler/runtime licenses and Mac minimum-version selection. Source changes select
a new cache edition without removing earlier completed builds. A process lock
prevents two completion commands from compiling into the same work directory.

To consume work already completed by another cloud seat, append one or more
`--reuse-bundle /path/to/existing/producer-output` arguments. These are unpacked
actual native-helper bundles, not source-only installer packets. Matching target
bundles are copied with their sources, licenses and executable modes; only missing
targets are compiled. Supply the same complete Zig distribution that built those
bundles. A changed compiler or source edition is not silently combined.

The output contains the existing root `NATIVE_HELPERS.json` contract and all six
native executables. Packaging uses the maintained producer and preserves modes.
The persistent work directory contains the completed per-target directories,
`combined/`, `Native_Helpers.zip` and a machine-readable completion record beneath
the printed fingerprint. Reuse these bytes when handing work between cloud seats;
they contain the helper payload only, not the application datasets.

Publication first creates a complete same-directory ZIP copy and then exposes it
create-only. A byte-identical existing output is reused; a different existing ZIP
is preserved. POSIX publication requires same-directory hard-link support; Windows
uses its create-only rename behavior. On publication failure, the completed cache
archive and staging copy are retained, so another destination can be selected
without recompiling. Invalid cached bundles are moved aside before replacement.

This command builds/packages helpers; it does not run numerical exercises. Keep
actual Windows use of these binaries with the existing release receiving course.

## Combine, use, and package the same payload

```sh
python source_tools/build_native_helper_bundle.py merge merged win-payload intel-payload arm-payload
python source_tools/build_native_helper_bundle.py inspect merged
python source_tools/build_native_helper_bundle.py exercise merged
python source_tools/build_native_helper_bundle.py zip merged Native_Helpers.zip
```

Independent platform bundles combine only when common retained source/header
bytes agree. Existing output directories/ZIPs are preserved; use a fresh output
name. Interrupted/failed build and merge staging directories remain available
for the current or a replacement cloud worker. ZIP contents keep relative paths
and executable mode bits. Integrate the payload into the same application root;
do not move `NATIVE_HELPERS.json` into `source_tools` or rename its platform keys.
Executables and licenses live together in
`source_tools/native_helper_binaries/`, which the existing native portable
application export retains. Keep that directory in the original application.

`exercise` runs both actual host-target executables using the original binary
protocols, Unicode input/output paths, exact traversal and minimum-L1 results.
It needs only standard-library Python, no compiler or scientific dependency
installation. It handles an extractor-stripped execute bit using a temporary
byte-identical executable copy. Its output records the actual host and selected
binary hashes; a Linux result never represents a Windows/Mac execution.

The resolver/caller owner retains the application selection implementation;
this producer does not introduce a second resolver, model, queue, or runtime.
Consume the `source_files` entries as well as the primary `source_sha256` when
checking a bundle that includes local headers.

Current owner direction and approved October 14 portability work remain in force.
Use the exact outgoing application/attachments and exercise affected controls
before recipient delivery; keep native Windows receiving and the single frozen
release with their active owners. No Actions, purchase, client contact, or new
scheduled process is introduced by this producer.
