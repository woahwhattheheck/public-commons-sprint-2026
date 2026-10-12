# Receiving and recovering a complete handover

The application exports a portable workspace, complete source code and original native content. The archive is a working deliverable: the receiver can open the same application and continue source editing, review and commissioning.

## Open the delivered application

Extract the complete archive into a new directory. From that directory:

    node app/server.mjs --workspace workspace --port 8846

Use Node 24 or later. Python 3 is needed for another complete handover export. A selected original Lightdash CLI, dbt installation and warehouse are needed when continuing native commissioning.

Open START_HERE.html for the original source/native work summary. Open the local address printed by the server for source, draft, review, operation and handover controls.

The receiving SQLite copy starts with connectionDetached = true and an empty active connection. The original complete operation inputs remain in their historical records. Configure the receiving host and target before a new native operation.

## What is preserved

| Archive entry | Complete contents |
| --- | --- |
| app/ | Every authored application file listed in source-manifest.json |
| workspace/commissioning.sqlite | A consistent original SQLite backup, all editions, every draft overlay, reviews and operations; active connection detached for receiving |
| workspace/editions/ | Every retained source edition, complete file manifest and original file bytes |
| workspace/operations/ | Original selected native artifacts and their complete native inventories |
| workspace.json | Original workspace selection and full source/draft/review/operation records |
| manifest.json | Complete archive member identity, omitted private diagnostic records and original selected application identity |
| START_HERE.html | Offline receiving guide and actual retained operation states |

The exported source keeps its original license files. The application’s own MIT license does not replace a dbt example, Lightdash or third-party license.

Customer content can be present in the original native exports. Deliver the archive to the intended recipient and receiving location.

## Private profiles and diagnostics

Host-bound profiles.yml contents and API credentials are outside the workspace export. The normal Lightdash user configuration is also outside the archive. The connection records environment-variable names and original host file identities.

Original native content is included by default. Private logs, command journals, API replies and compile diagnostics remain on the operator’s host unless includeOperatorPrivate was selected. The manifest lists each omitted artifact with its original identity and scope, so the receiver can tell exactly which file contents were omitted.

An explicitly included public or environment-only profile is an ordinary retained source file. For the complete original Jaffle example, its profile and Apache license stay unchanged in their original paths.

## Resume an interrupted handover result save

An archive can finish before the process returns or its final result record is saved. Keep the original handover ID.

In the application, select **Inspect original archive** beside that retained handover. From the CLI:

    node app/cli.mjs inspect-handover --workspace workspace --id ORIGINAL_HANDOVER_UUID

The inspector opens the existing complete original archive, verifies every listed member and adopts the original archive identity. It does not rebuild source, start another native operation or overwrite a different completed archive.

If the original complete ZIP has not yet been created, inspect the original handover logs in its retained handover directory. Another native product execution is not needed to inspect an archive. A fresh export uses a new explicit handover ID after the operator chooses the current complete workspace.

## Reuse original content after moving the workspace

The app’s operation screen resolves each original native export against the received operation directory. It verifies the retained content manifest and displays **Use for content upload**.

The same references are available from:

    node app/cli.mjs content-exports --workspace workspace --id ORIGINAL_DOWNLOAD_OPERATION_ID

The returned directory and manifest paths point to the receiving location. Original project and source operation identities remain unchanged. A new upload plan selects its actual intended target explicitly.

If a private diagnostic file was omitted, the archive preserves its original descriptor but cannot recreate its contents. A missing or changed selected content manifest is shown as an explicit source error.

## Source and workspace integrity

The exporter obtains the SQLite backup through SQLite’s actual backup API. It does not copy a live database file while ignoring its journal.

Source file contents are checked against the complete retained edition manifest while writing the archive. Original native artifacts are checked against their native inventory. The archive is then reopened and every listed member is checked again before it is made available as a complete handover.

Drafts are stored as complete transactional text-file overlays against immutable base editions. They are included in both the SQLite backup and workspace.json. Moving the workspace does not collapse multiple retained drafts into one working directory.

A source review records the operator’s decision and selected source/connection identities. It is not a customer purchase order, deployment permission or statement of customer acceptance.
