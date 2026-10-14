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


## Retained own-data selection and first receiving

The qualified collection has seven original rows in STUDIES.json: Tim — Own data
at workspaces/tim-own-data (bf5c486e-5a45-40e2-8d87-552fec5231f2), followed by six
reference rows. The opener resolves the family: own-data row as the primary
Workspace and preserves every original row, title and directory. Conservation
and monitoring-original-edition deliberately share a project ID while retaining
different directories; both remain selectable references.

The shared session supplies the platform state directory and earlier Mac state
reuse. The ordinary second opening validates the same primary and every retained
reference against the running operator. It does not replace a live operator.

For Windows-friendly outer ZIPs, the existing assembler may retain deep
Workspace trees in complete native archives and provide STUDY_PAYLOADS.json.
The exact contract is:

```json
{
  "schema": "upstate.collection-study-payloads/v1",
  "studies": [
    {
      "workspace": "workspaces/native82",
      "project_id": "1b6a344c-df5a-4986-a5e4-47a2d158324b",
      "archive": {
        "path": "study-payloads/native82.zip",
        "bytes": "ACTUAL_NATIVE_ARCHIVE_BYTES",
        "sha256": "ACTUAL_NATIVE_ARCHIVE_SHA256"
      }
    }
  ]
}
```

The byte count is an integer in the actual manifest. Obtain each descriptor from
the complete native archive selected by the assembler. Do not copy an upstream
original_archive_sha256 into this descriptor: several original collection rows
came from the same upstream archive but now represent distinct retained
Workspaces. The selected native archive's own project ID must match its exact
STUDIES row.

The included helper can write this manifest from those existing native archives:

```sh
"$PY" receive_collection_studies.py --collection "$COLLECTION" \
  --payload workspaces/native82 study-payloads/native82.zip \
  --payload workspaces/conservation study-payloads/conservation.zip
```

Repeat --payload for every Workspace tree omitted from the outer ZIP. Use the
assembler's actual original paths. Keep Tim's small own-data Workspace expanded,
or include its own identity-matched native archive as another payload row.
The command checks each archive's own project and complete bytes, then publishes
a new manifest without replacing a different existing one. It neither creates
new archive content nor deletes the assembler's original expanded Workspace.

During ordinary opening, receive_collection_studies.py verifies existing
Workspace identities and restores only missing trees with model.portable.restore.
The native receiver verifies the complete source inventory and scientific
records. A completed interrupted receiving wrapper is resumed through the same
resume_restore API. The helper publishes the verified Workspace to its exact
original directory with the maintained no-replace operation, retaining all
workspace-relative delivery artifacts. The shared current application remains
selected. The original inner archive stays in the collection; only the completed
temporary duplicate application/delivery wrapper is removed.

Later openings read the existing Workspace identity and preserve all current
edits, histories and new runs. They do not rehash large archives or restore over
mutable work. A conflicting project or malformed payload descriptor produces a
concrete error with the original files preserved. No browser or scientific
computation is started by first-study receiving itself.
