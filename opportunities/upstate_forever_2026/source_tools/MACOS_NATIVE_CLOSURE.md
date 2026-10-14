# Mac native dependency assembly

This is the Mac library-closure arm of the existing native runtime producer. It
operates a staged **original selected prefix**, before the ordinary runtime packer
freezes its archive. It does not replace the capsule, runtime receiver, launcher,
scientific controller, package solver or helper-binary producer.

`native_runtime/macos_bundle.py` runs with the Python standard library on the
Linux cloud builder or a Mac. It reads thin and universal Mach-O load commands,
selects the baseline Intel or Apple Silicon slice, follows native dependency
chains and fills missing exact-relative libraries from explicitly selected
original prefix donors. Existing files with different bytes are never replaced.

## Build integration

Inspect the original stage, then assemble from the same qualified package plan:

```sh
python source_tools/native_runtime/macos_bundle.py /build/mac-stage \
  --target macos-arm64 --output /build/mac-before.json

python source_tools/native_runtime/macos_bundle.py /build/mac-stage \
  --target macos-arm64 --assemble --donor /build/qualified-original-prefix \
  --executable bin/conda-unpack --output /build/mac-assembled.json
```

For Intel use `macos-x86_64`. The selected interpreter defaults to `bin/python`;
`--python` accepts a different prefix-relative original interpreter path. Several
`--donor` arguments are supported, but different bytes for the same required
library are an error rather than a choice based on directory order. A staged
conda file record requires the donor's name, version, build, platform and retained
original distribution hashes to match. The result retains each copied library's
package identity, license metadata and complete byte hash. The original runtime
packer's package and license inventory remains authoritative.

Absolute original build prefixes can be declared with repeated
`--map-prefix /original/build/prefix`. This maps their dependency lookups into the
stage for assembly and explicitly records the load commands still requiring the
existing conda relocator. It does not edit executable or signature bytes. The
ordinary receiver runs its original `conda-unpack` at the final stable cache
location; after that, inspect without prefix mappings. A successfully resolved
pre-relocation graph has `prepared_for_relocation` status, not `ready`.

The module repairs contained absolute symlinks, including explicitly mapped
original-prefix aliases, into relative links. It leaves symlinks covered by a
nested app/framework resource seal untouched and reports the remaining
relocation. It restores missing execute permission only for native executables
or explicitly named scripts, deriving execute access from their existing read
access. These operations preserve the original binary and embedded signature
bytes. Repeat assembly reuses completed equal-byte copies.

## Native graph and minimum OS

The graph follows `@loader_path`, `@executable_path`, ordered inherited `@rpath`
chains, required/reexport/upward/lazy loads and optional weak loads. System-library
paths are classified separately without pretending that a Linux filesystem is a
Mac system image. It checks dependency library type and compatibility versions,
selected CPU/subtype, CPython extension tags, malformed load-command bounds and
universal slice consistency. Orphan native extensions are inspected under the
selected interpreter's run-path context.

The maximum selected-slice macOS minimum and original package `__osx >=...`
requirements produce `minimum_os_version`. `--minimum-os VERSION` detects an
understated advertised floor. `native_runtime_fragment` contains only the
canonical Darwin platform descriptor and resulting minimum for the maintained
`NATIVE_RUNTIME.json` producer to compose; it does not overwrite a manifest.

Python entrypoints:

```python
from source_tools.native_runtime.macos_bundle import inspect_prefix, assemble_prefix

before = inspect_prefix(prefix, "macos-arm64")
after = assemble_prefix(prefix, "macos-arm64", donors=[qualified_prefix])
```

Results use `upstate.macos-native-closure/v1`. `ready` means the static staged
closure and its declared file requirements are satisfied; execution and scientific
imports use the existing native receiver. The CLI exits 1 for reported repair
items and 2 for invalid input or a failed operation. Full results include precise
original paths, dependency edges, source identities and actual assembly changes.

## Completed source course

The cloud course linked real Intel and ARM C executables and two-library chains
using Clang 17 and stock LLVM LLD 24. It removed the original libraries from the
stage, assembled both transitive closures, repaired original-prefix aliases and
execution modes, physically moved the prefixes to Unicode/spaced paths and
reopened them without further writes. All six linked images retained their exact
bytes; the ARM embedded signatures were preserved. Different package pins,
wrong CPU and an understated package OS floor were rejected. A universal file
retained both complete original linked slices. Additional native-header reads
used two Go-cross-compiled executables and nine original compiler fixtures.

The source carrier retains the small C course, complete results and the exact
capsule `DYLD_*` cleanup contribution. The active capsule writer composes that
function-only cleanup before starting a selected Mac interpreter; this module
never replaces its advancing `platform_runtime.py` body.

The linked C/Go course images are development inputs, not scientific runtimes.
Original workspaces, calculations, result records, UI routes and final receiving
acceptance are unchanged by this source addition.
