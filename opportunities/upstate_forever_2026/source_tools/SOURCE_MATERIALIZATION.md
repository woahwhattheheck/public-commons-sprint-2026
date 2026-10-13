# Original source intake and native view reuse

This component speeds up the existing source-file workflow. Import the original
source manifest through Sources as before. Select the retained sources in the
same profile, scenario, grid and run forms. Original files, source IDs, complete
companions, filenames, native relative paths and scientific values remain in the
existing Workspace content store.

## What changes

The existing operation-local verified-files helper now also remembers a streamed
original source identity. Repeated references to the same unchanged inode during
one synchronous source import or preparation can use that identity after opening
the file and checking its current regular descriptor and selected path.

The check binds device, inode, byte length, nanosecond modification and change
times, and hard-link count. A replacement, write, new alias, removed alias or
different native view invalidates the previous metadata match. The first read,
changed body and a fresh outer operation still stream the whole source. A copied
source always streams and hashes every byte being written.

This applies to the original import_sources, source_file, save_profile,
save_scenario, prepare_grid and prepare_run entrypoints. Nested calls share the
same existing scope; its bounded metadata inventory is discarded at return.
Nothing is persisted as a trusted verification cache, and file bytes are never
cached in memory. The original completed-output verification API is unchanged.

The content store still takes its original digest locks, installs an independent
copy, flushes durable publications and atomically repairs a damaged retained
regular object from a verified original input. Native views still use the same
hard-link/copy path. Creating a hard link changes inode metadata, so a later read
checks the new identity instead of extending old trust through that operation.

## Receive a real original source edition

Adopt the complete source component in the current application at its normal
source boundary. Preserve other writers and active native processes. The changes
are model/common.py, model/verified_files.py and model/workspace.py plus the
additive course, guide, focused checks and component declaration. Compose their
full current bodies; do not overlay an older complete application.

From the actual application's root, with its available Python:

    python3 -B source_tools/receive_source_materialization.py \
      --manifest /absolute/original/sources.json \
      --output /absolute/new/source-receiving

Use the actual upstate.sources/v1 manifest and its complete original files. The
command creates a NEW receiving Workspace outside the source directory, imports
every typed entry and companion, materializes native views, repeats unchanged
selections, and independently verifies every original body. It launches the same
interpreter in a fresh child process to reopen the saved collection and views.
The original manifest and input directory are not edited.

The output contains the editable Workspace and source-receiving.json,
cold-reopen.json, complete.json, child stdout/stderr and any concrete failure.
The saved records include original source collection/project identities, complete
source metadata, exact member identities, original native paths, measured source
bytes/read counts and wall time. They describe source intake/materialization;
they do not claim native model execution, scientific accuracy, browser operation
or a general end-to-end speedup.

A stabilized repeated pass should read zero original body bytes through this
verification helper. A cold child must stream original source bodies again.
Initial view construction can legitimately read more than once while additional
hard links change ctime. The command also performs explicit independent full
hashes for its source-preservation check; that checking time is included in the
whole receiving elapsed time and is not claimed as an application speed gain.

If a course fails, preserve that receiving directory and failure record, repair
the actual source issue, and use a new receiving directory. An existing output
is never overwritten. The usual original import/reopen operation remains usable
without this optional source-specific course.

## Focused repair checks

    python3 -B tests/test_source_materialization.py

The standard-library course uses explicitly authored binary/document inputs,
not field data. It checks repeated original companions, unchanged native views,
new-process/scope behavior, same-length edits with restored mtime, hard-link
metadata changes, atomic replacement, damaged-alias repair, wrong hashes,
symlinks, nested scopes and thread separation. It performs no scientific solve.

## Actual operating and delivery continuation

Continue the owner's existing original source import and profile/grid/run
operation after source adoption. Keep the user's original filenames, labels,
units, dates, site IDs and companions visible. Follow the current operator's
normal progress, original result inspection, saved Study export and cold
receiving path. The equipped producing owner must operate and personally inspect
the actual delivered application and attachments under that session's current
owner/browser controls. No new browser permission, native controller, public
binding or data-release authority is created by this component.

The post-call owner direction is to let Tim run his own real data through the
same system. Intake, mapping, workbook return and human-readable result writers
retain their existing ownership. This component changes source I/O reuse only.
