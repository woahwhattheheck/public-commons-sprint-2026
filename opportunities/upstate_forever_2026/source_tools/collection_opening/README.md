# Complete-collection native opening

This is the root-opening source component for the existing collection. Apply it to the retained complete collection, not to the application alone:

```sh
python source_tools/collection_opening/apply_to_collection.py /path/to/complete-collection
```

The join accepts the recorded original root files or its own unchanged output, and preserves a differing concurrent file. It does not rewrite STUDIES.json, Workspace identities, scientific runs, data, or private operator configuration. Preserve executable ZIP modes for `.command` and `.sh` files.

Windows uses `Open_Workbench.cmd`, which validates the supplied bootstrap in PowerShell and waits for the actual selected-runtime process. macOS uses `Open_Workbench.command`, selects native Intel/Apple Silicon, verifies its interpreter with native tools, then receives the scientific runtime. Both enter the same `open_native_collection.py` and original `open_collection.py`, defaulting to the retained own-data Workspace. The Windows collection directly invokes the maintained session controller to preserve the waited process lifetime.

## Runtime manifest interface

Use the receiver's v2 `platforms` map and target IDs `windows-x86_64`, `macos-x86_64`, `macos-arm64`. The runtime receiver keeps ownership of archive identity, extraction, relocation, private cache and scientific qualification. Its `receive` and `environment` APIs are reused unchanged.

Each target also supplies `bootstrap: {directory, python, files:[{path,bytes,sha256}]}`. Directory is collection-relative; Python and file paths are bootstrap-relative POSIX names. Select the real interpreter file, not an interpreter symlink. Put its inventory entry first for efficient native macOS selection. Supply `dependencies.node` and `dependencies.node_license`, each `{path,bytes,sha256}`, with collection-relative paths. Node must match the approved 22.16 runtime. The two original universal Excel wheels retain their original files/hashes.

Windows dependency installation uses the maintained Windows filesystem layer. The lock-owning isolated interpreter runs the two pure-wheel pip installs itself, eliminating the mutating child's parent-death lock gap. Native Node/Excel probes remain read-only subprocesses. POSIX retains the original inherited-fd behavior.

## Integration

Read the parent project's CURRENT_OWNER_DIRECTION.md version 2026-10-14.1 and its AGENTS.md. Compose this root component with the active receiver, native runtimes, platform filesystem, session/readiness, helper binaries and opening guides in the same release. Native runtime payloads and these source files are distinct assembly inputs. Use the assembled root launcher and inspect its actual application before the final private delivery to Bryce.

The retained focused Linux check covers root handoff ordering, spaced/Unicode arguments, immutable dependency reuse and changed-bootstrap rejection. Windows/macOS native opening is part of the assembled release's actual opening course.

The receiving result's selected runtime descriptor is passed into the child environment unchanged. Windows root waiting also preserves the controller's own Ctrl+C shutdown instead of terminating it during parent interrupt cleanup.
