# Receiving and recovering a complete handover

The application exports a portable workspace, complete source code and original native content. The archive is a working deliverable: the receiver can open the same application and continue source editing, review and commissioning.

## Open the delivered application

Extract the complete archive into a new directory. From that directory:

    node app/server.mjs --workspace workspace --port 8846

Use Node 24 or later. Python 3 is needed for another complete handover export. A selected original Lightdash CLI, dbt installation and warehouse are needed when continuing native commissioning.

Open START_HERE.html for the original source/native work summary. Open the local address printed by the server for source, draft, review, operation and handover controls.

The receiving SQLite copy starts with connectionDetached = true and an empty active connection. The original complete operation inputs remain in their historical records. Configure the receiving host and target before a new native operation.

Completed historical native outcomes remain available immediately after reopening. A portable archive can intentionally omit the original private execution journal. Inspecting such an operation preserves its complete retained terminal result and separately reports that provider reconciliation needs the original journal. It does not replace an original success with a newly planned operation.

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

## Resume the original handover

Keep the original handover ID after a lost response, process interruption or failed archive write. Its request fixes the workspace ID, workspace revision, full application source identity and diagnostic selection.

In the application, select **Inspect original handover** beside that retained handover. From the CLI:

    node app/cli.mjs inspect-handover --workspace workspace --id ORIGINAL_HANDOVER_UUID

The inspector checks the same handover's permanent writer lock. If the original writer is active, it reports that state. When a complete final or partial ZIP exists, the inspector opens it, verifies every listed member and adopts that original archive identity.

To finish an incomplete handover:

    node app/cli.mjs resume-handover --workspace workspace --id ORIGINAL_HANDOVER_UUID

The application provides **Resume original handover** for the same action. The exporter retains the original SQLite snapshot and every selected complete source/artifact under that handover's basis directory. Continuation verifies and uses that original basis, even if the working workspace has advanced. A dead writer's incomplete ZIP can be rebuilt from that basis; native dbt, Lightdash or warehouse work is not repeated.

The application retains a pending intent before selecting the database. It uses SQLite VACUUM INTO on its opened workspace connection, verifies the complete snapshot, and publishes the original database with an atomic no-overwrite link. Only then does it publish the revision-bearing request and acknowledge HTTP creation. Python archive construction starts after that durable selection. A later edit or native completion cannot change the accepted handover revision.

If selection itself is interrupted, the original ID remains pending. Inspection reports that pending state without creating a new snapshot. Resume adopts a complete retained prepublication snapshot, or finishes selecting the database if none completed. A supplied workspace revision remains a selection precondition; a conflict before selection is acknowledged requires **New handover ID** to choose the current workspace. An accepted request always uses its retained original database and never falls back to the current live workspace.

Keep the original application source available until its complete export basis has been retained. An incomplete basis needs the original selected files; replacing them with newer file contents would change the handover. Completed archives and sealed complete bases can be inspected and reused without rereading the live source.

The server drains its own native operations and handover writes during an ordinary shutdown. The original receiving lease remains inherited by the Python exporter for its complete writing lifetime. A hard interruption is handled by the same inspect/resume path.

## Reuse original content after moving the workspace

The app’s operation screen resolves each original native export against the received operation directory. It verifies the retained content manifest and displays **Use for content upload**.

The same references are available from:

    node app/cli.mjs content-exports --workspace workspace --id ORIGINAL_DOWNLOAD_OPERATION_ID

The returned directory and manifest paths point to the receiving location. Original project and source operation identities remain unchanged. A new upload plan selects its actual intended target explicitly.

If a private diagnostic file was omitted, the archive preserves its original descriptor but cannot recreate its contents. A missing or changed selected content manifest is shown as an explicit source error.

## Source and workspace integrity

The application selects the original database with SQLite’s transactionally consistent VACUUM INTO operation, including committed WAL contents. The Python exporter uses SQLite’s actual backup API to create the detached receiving copy from that retained original snapshot. It never copies the live database file while ignoring its journal.

Source file contents are checked against the complete retained edition manifest while writing the archive. Original native artifacts are checked against their native inventory. The archive is then reopened and every listed member is checked again before it is made available as a complete handover.

Drafts are stored as complete transactional text-file overlays against immutable base editions. They are included in both the SQLite backup and workspace.json. Moving the workspace does not collapse multiple retained drafts into one working directory.

A source review records the operator’s decision and selected source/connection identities. It is not a customer purchase order, deployment permission or statement of customer acceptance.
