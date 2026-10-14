# Offline native runtime receiving

Updated October 14, 2026. This is the maintained receiver for the approved
Windows/macOS portability work (items 9–10, contributing to 14 and 17). It advances
the complete Current195 receiver `01c0ab5d2fd173244afbb25f11ed9bba3498774097ec6910a1e501859c712764`
and preserves its relocated certificate-store validation, scientific identity
probe and normal collection-opening handoff.

## Opening integration

Install `source_tools/receive_native_runtime.py` and `source_tools/runtime_platform.py`
together in the original application. Windows also uses its existing
`model/windows_fs.py`. The normal portable exporter already retains `source_tools/`,
`docs/` and `checks/`; no separate application or scientific controller is added.

The root launchers choose the included platform-native bootstrap Python first.
The receiver does not download Python or any scientific dependency. The root
bootstrap and dependency preparer own the separately described `bootstrap` and
`dependencies` payloads. A recipient does not need a system Python installation.

The existing Python API remains:

```python
state = receive(application, spec_path, archive=None, storage=None, python=None)
env = environment(Path(state['prefix']), state.get('runtime_spec'))
```

`state` keeps `schema`, `state`, `prefix`, `python` and `reused`. A described bundled
Node also returns `node` and `node_version`. `runtime_spec` contains the normalized
portable descriptor, not the inherited process environment. Caller-provided paths
remain argument-array entries rather than shell-interpolated strings.

For root integration, `--prepare-only` writes this state as JSON to stdout and
human progress to stderr. `--open-script` supports the original Python collection
opener directly and `.sh`/`.command` on POSIX. It does not add `--plain`, select a
different workspace, register projects or change any original workspace identity.
Windows waits for its child collection opener so the root console remains attached.
The session module still owns the server's actual PID, readiness and normal closing.

## Runtime manifest

Continue to name the complete collection's descriptor `NATIVE_RUNTIME.json`.
Legacy `upstate.offline-native-runtime/v1` Linux descriptors remain accepted.
A multi-platform descriptor has schema `upstate.offline-native-runtime/v2` and a
`platforms` object. Keys are `windows-x86_64`, `macos-x86_64`, `macos-arm64` and,
when retained, `linux-x86_64`. The input aliases `targets` and `darwin-*` are accepted;
contradictory duplicate definitions fail rather than silently choosing one.
Rosetta bootstrap execution selects the host's native Apple Silicon payload.

Each platform entry describes actual supplied bytes:

| Field | Meaning |
| --- | --- |
| `platform` | `system` (`Windows`, `Darwin`, `Linux`) and `machine` (`x86_64`, `arm64`). |
| `archive` | Contained relative `filename`, exact positive `bytes`, full `sha256`. |
| `format` | `zip`, `tar.gz`, `tar.xz`, or `tar`. A `.zip` filename selects ZIP when omitted. |
| `archive_root` | Prefix directory inside the archive, or empty for a rootless pack. |
| `python` | Prefix-relative executable: normally `python.exe` or `bin/python`. |
| `node` | Optional executable **inside this archive**; separate dependency Node is prepared by the root dependency tool. |
| `relocation` | `script` run by the selected Python; typically `Scripts/conda-unpack-script.py` or `bin/conda-unpack`. Explicit `kind: none` is for a runtime that needs no relocation. |
| `environment` | Optional prefix-relative `path` directory array, `gdal_data`, `proj_data`, `ssl_cert_file`. |
| `python_version`, `invest_version`, `node_version` | Optional version requirements; actual runtime values are checked. Python may specify a major/minor version. |
| `minimum_os_version` | Actual Windows/macOS build requirement. Linux may instead specify `minimum_glibc_version`. |
| `bootstrap`, `dependencies`, `packages` | Preserved builder/preparer descriptions; the receiver does not reinterpret or install them. |

`conda_unpack` is an accepted input alias for `relocation.script`. Filenames and
prefix-relative paths may contain spaces and Unicode; they must remain contained.
Supply the real archive size/hash, not template values. Python and Node executable
headers are checked as PE, ELF or Mach-O for the selected OS and CPU before execution.
ZIP runtime payloads contain regular files/directories; Unix symlinks belong in a
tar payload with their executable permissions and contained targets preserved.

## Installation and reuse

Default storage is `%LOCALAPPDATA%/Ecosystem Workbench/runtimes` on Windows,
`~/Library/Application Support/Ecosystem Workbench/runtimes` on macOS, and
`${XDG_DATA_HOME:-~/.local/share}/ecosystem-workbench/runtimes` on Linux.
`ECOSYSTEMS_RUNTIME_STORAGE` or `--storage` selects another stable location outside
the portable collection. Windows uses inherited per-user AppData ACLs and native
non-reparse file operations; POSIX storage remains owned by the current user and
mode 0700. An installed prefix is never relocated by moving the collection.

V2 cache keys include OS/CPU, archive hash and exact receiving recipe. The raw
archive is length/hash checked once per installation; extraction rejects path
escapes, special files, Windows device names and target case/Unicode collisions.
A per-installation lease serializes ordinary concurrent opening. On Windows a
no-sharing file description is explicitly duplicated into relocation, retaining
custody until the last handle closes; inheriting a LockFileEx region is not assumed.

Every attempt receives into its own permanent prefix. The archive's original
`conda-unpack` runs there once. A failed/interrupted prefix and relocation log remain
available, and the next attempt uses a new prefix instead of replaying relocation
against partially patched files. The ready journal is published only after the
original native model/PROJ probe succeeds and any described Node starts correctly.
Original installed members are bound after relocation and checked on reuse;
unchanged members use metadata rather than repeated whole-runtime hashing.
Additive Node/Excel files are validated by the existing exact dependency preparer,
so its normal later installation remains possible.

On Windows the selected prefix's DLL directories are activated before the original
model/GDAL imports, and their handles remain alive for the entire probe.

Current195's validated relocated CA store remains active unless the receiving
machine explicitly supplies `SSL_CERT_FILE`. No TLS verification is disabled.
The original application owns all scientific version/source checks and model work.

## Focused development exercise

`python checks/received_runtime_portability.py` exercises real Linux Python
relocation, ZIP/tar receiving, moved-folder cache reuse, additive dependencies and
changed-original rejection and real killed-parent/child-lease recovery. It also checks target selection and foreign executable
headers without running those foreign binaries. This transport exercise substitutes
only its scientific-probe body; the distributed receiver retains the original
scientific probe. Native Windows/macOS runtime opening belongs to the same full
collection release course, using its actual target payloads.
