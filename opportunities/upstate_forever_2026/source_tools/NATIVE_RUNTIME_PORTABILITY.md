# Native runtime receiving and invocation

This implementation extends the maintained capsule and invocation paths. It
retains the original InVEST source selection, scientific adapter, stage recovery,
full file-backed command logs and existing operator. It introduces no model queue.

## Target layouts

| Environment | Interpreter | Relocation script |
| --- | --- | --- |
| Windows conda-pack | `python.exe` | `Scripts/conda-unpack-script.py` |
| Windows wheelhouse venv | `Scripts/python.exe` | Python venv creation |
| Linux / macOS conda-pack | `bin/python` | `bin/conda-unpack` |
| Linux / macOS wheelhouse venv | `bin/python` | Python venv creation |

Both flat and one-directory-wrapped conda archives are accepted. The archive's
entry points must agree with its recorded platform. Extraction retains original
member/link inspection, permissions, hard-link ordering and fixed final prefixes.
Windows archives additionally reject case-colliding and Win32-special filenames.
Existing POSIX archive metadata remains unchanged, allowing interrupted original
captures to reopen without repacking or changing their capsule identity.

Windows interpreter identity retains the real, possibly null SOABI and compares
the actual extension suffix instead. POSIX still requires SOABI. OS, architecture,
implementation and cache-tag checks remain; AMD64/x86_64 and aarch64/arm64 aliases
are normalized without treating different platforms or CPU architectures as equal.

## Selected environment and loader

`capsule.environment(prefix, offline=False)` keeps its existing interface and now
uses `platform_runtime.prefix_environment`. Windows PATH includes the selected
prefix, Library binary directories and Scripts. GDAL/PROJ data come from that
same prefix (`Library/share` on Windows, `share` on POSIX). Explicit trust settings
remain intact; relocated supplied CA bundles are validated before adoption.
The original Linux Node C++ library selection is retained.

`platform_runtime.activate_libraries()` runs before native imports. Windows DLL
search handles for the selected interpreter are retained for process lifetime,
including through the invocation bootstrap and original native probe. SSL is
imported only after activating the running interpreter's library directories;
a target-package inspection never loads a different target's DLLs.

## Process ownership

The Windows adapter is the shared `model/windows_process.py` implementation:
`spawn`, `open_batch_lease`, `signal_owned`, and OwnedProcess's
`pid`, `identity`, `poll`, `wait`, and `close`. The native process owner supplies
that complete file with the same release. Capsule code does not replace it.

`capsule.lock(path)` uses its exclusive-share lease on Windows and the original
flock lease on POSIX. `command(..., lease_fd=fd)` passes only the explicit custody
descriptor through the shared Windows suspended-spawn/Job Object backend. A
LockFileEx region lock is not substituted for inherited open-handle custody.
Cancellation requests the existing graceful signal, waits, and then stops the
owned process tree. POSIX retains its original session and descriptor custody;
an already-exited child does not replace an interruption with a lookup error.

Capsule sealing and received payload publication use the unchanged shared
`model.portable_fs.publish_file` and `sync_directory` operations. Unsupported
hardlinks take its verified-copy and atomic create-only rename path; existing
capsules and payloads are preserved. Include the shared PFS1 module with this
source cohort. Directory sync and replacement behavior remain platform-native.

## Original workbench opening

The `invocation.prepare(python, application, entry, arguments, inspect_only=False)`
return keys remain `command`, `environment`, `application`, `entry`, `python`,
and `selection`. Arguments remain an array and are not interpolated into code.

A Windows session manager must directly spawn the returned command/environment
with its existing readiness nonce, actual PID, process-group and SIGBREAK handling.
The selected Python loads the original native model sources, then executes the
original server in that same child. Do not insert the invocation CLI's exec route
between the owned Popen child and the server; Windows exec does not preserve that
PID contract. Linux/macOS CLI callers retain the existing exec route.

Use the maintained collection launcher to start/reuse the server and open its
fresh ready address. Saved development ports are not recipient opening links.
This implements the native part of approved portability items 27–28 and composes
with the current collection/session work and owner addition 59.

## Focused execution

The retained Linux runtime was received into a different, space-containing prefix
and used with these files to load actual InVEST 3.20.0 NDR/SDR sources, execute the
native GIS round trip and run the original invocation bootstrap. Original model
source identities and scientific records are unchanged.

The four focused platform checks are in `tests/test_native_runtime_platforms.py`.
The existing archive-layout, offline-wheel receiving/recovery and live-child
lease-after-parent-exit workflows remain applicable. The Windows receiving course uses the composed package, shared process backend
and target-native runtime for its actual native launch and shutdown checks.

The retained original 82-run workspace was also opened through the selected
native Python and original operator in the cloud Linux environment. Its API
returned all 82 runs, 119 registered extensions and zero extension issues. Normal
SIGINT shutdown, cold reopen at a fresh ready address and another normal shutdown
succeeded; the complete original run-record hash inventory stayed unchanged.
Chromium returned ERR_BLOCKED_BY_ADMINISTRATOR for operator navigation in this
container. Rendered Windows receiving remains part of the existing recipient
course; the Linux server/API result is recorded separately.
