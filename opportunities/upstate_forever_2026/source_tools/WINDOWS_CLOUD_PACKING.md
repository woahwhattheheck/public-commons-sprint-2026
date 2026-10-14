# Windows native archives from a POSIX cloud builder

The maintained `prefix_pack.py` now selects a Windows-targeted conda-pack writer
on Linux/macOS. The selected environment remains Windows x64: its interpreter,
DLLs, package builds, activation, entry points and receiving-time relocation are
not replaced by Linux equivalents. Compression no longer requires a Windows host.
The existing native Windows packer and POSIX Linux/macOS path are retained.

## Existing acquisition and packing workflow

Keep the actual selected Windows conda prefix, its raw conda package cache and
matching donor prefixes. Acquire/link that target's packages before packing; this
adapter neither solves an environment nor converts Linux packages into Windows
packages. In particular, noarch Python files must be installed in the Windows
`Lib/site-packages` and `Scripts` layout. Complete the existing PE dependency and
license course with `payload_closure.py`, producing a separate completed prefix.

Run the maintained build interpreter with `conda_pack` and setuptools installed:

```sh
PYTHONPATH=APPLICATION BUILD_PYTHON APPLICATION/source_tools/native_runtime/prefix_pack.py \
  ORIGINAL_WINDOWS_PREFIX COMPLETED_WINDOWS_PREFIX Windows_Native_Runtime.tar.gz \
  --target windows-x86_64 --donor MATCHING_WINDOWS_DONOR \
  --format tar.gz --archive-root runtime --json Windows_Native_Runtime.json
```

Omit `--donor` when none is needed. Both tar.gz and ZIP are supported. The ordinary
`--resume` option recovers that same source-bound packing operation; final output,
original prefix, donor prefix and staging prefix stay separate. No workflow job,
target process or installed global GIS environment is launched during packing.

Compose the returned archive bytes/hash, format, root and
`relocation.script=Scripts/conda-unpack-script.py` into the existing platform
manifest, retaining its own `python.exe`, software versions, bootstrap and cache
fields. Receive with the existing native receiver. Its normal Windows launch and
scientific probe still run against the real Windows interpreter after relocation.
This source addition changes no model calculation, retained workspace or UI.

## Writer implementation

`windows_packing.select_writer()` loads the installed maintained conda-pack source
into its own content-addressed module namespace. The ordinary `conda_pack`, host
`sys.platform`, `os.name`, filesystem implementation and unrelated threads remain
unchanged. The isolated compat module selects Windows and 64 bits before loading
core. The isolated prefixes module specializes its one compile-time `on_win`
selector before executing the unchanged function bodies: switching the flag after
import would leave the POSIX binary replacer selected.

File enumeration, archive writing and the upstream `Packer` stay upstream code.
Metadata names compare case-insensitively while paths still open on the actual
POSIX filesystem. The comparison keys use forward slashes consistently, including
conda-meta bookkeeping, so a managed metadata record is not overwritten by a later
unmanaged duplicate. Existing physical casing is preserved, and raw package-cache
sources keep their original relocation placeholders rather than the staging path.
The selected Python and setuptools `cli-64.exe` are inspected as actual x64 PE
executables; wrong-platform conda records and Windows namespace collisions fail.

The archive contains upstream Windows activate/deactivate scripts and the original
setuptools launcher. Generated conda-unpack embeds the **unchanged original**
`prefixes.py`, so the recipient detects its own Windows platform normally.
Internal ZIP links are materialized using upstream's Windows behavior. The writer
retains source hashes and checks for upstream-source or launcher changes during
packing before the existing transaction can publish the payload.

## Operated course

The original retained Windows bootstrap supplied 3,339 entries. With an explicit
unmanaged-course conda-meta history, the complete source/staging pair held 3,340
files and 63,966,962 bytes each. The current C72E transaction packed this into a
22,636,546-byte Windows tar.gz, resumed without recompression, and retained every
source file byte. The original receiver accepted and independently extracted all
3,345 archive members (64,247,560 unpacked bytes), identifying Windows python.exe
and its Scripts relocation entry point. Exactly five upstream opening/relocation
files were generated. The 8,374-byte upstream relocation source was embedded
unchanged. These are packaging/receiving results using the real Windows bootstrap;
the scientific environment continues to use its existing acquisition and probe.

The one manual `checks/windows_cloud_packing_course.py` course additionally operates
controlled Windows/noarch metadata against a real retained Windows python.exe,
retains raw-cache text placeholders, checks official metadata rewriting, physically
moves the receiving folder through a Unicode path, applies the upstream Windows
text and binary entry-point relocation algorithms, and reuses the completed archive.
It also checks case-colliding and Win32-reserved names and confirms native Linux
writer state remains unchanged. Its metadata fixtures are explicitly test records.

```sh
PYTHONPATH=APPLICATION BUILD_PYTHON APPLICATION/checks/windows_cloud_packing_course.py \
  ORIGINAL_WINDOWS_PREFIX/python.exe NEW_EMPTY_COURSE_DIRECTORY
```

The source contribution composes on prefix_pack Git blob
`e745eb375b16453879f18868d3b4e9cb6efdb566`; its source snapshots, native locks,
create-only publication, interrupted recovery and CLI remain the maintained C72E
implementation. Include `windows_packing.py` and this guide in the existing
native-payload-completion component, not a replacement installer/controller.
