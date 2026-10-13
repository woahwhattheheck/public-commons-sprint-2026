# Client Pipeline Delivery Workspace

A staff application for delivering and operating a client's original Dagster/dbt project. It retains the SQL, YAML and source data as immutable editions; records the client's operating contract and installed runtime; starts an original persistent Dagster run executing the installed dbt CLI; and connects the actual native results to review, release and receiving.

The browser is an industrial, monochrome staff interface. It supports complete source import and editing, installed runtime references, native logs and artifacts, original manifest/source comparisons, saved acceptance review, client release downloads, complete backups and later reopening. The CLI uses the same writer and request contract.

## Install and open

Use Python3.12 or3.13 on Linux. The source import, editing, records, review and receiving code uses the standard library. Native execution adds the pinned Dagster/dbt/DuckDB packages in requirements.txt:

    python -m venv .venv
    .venv/bin/python -m pip install -r requirements.txt

Start the staff server with its documented workspace, receiving and backup directories; see STAFF_BROWSER.md and the server's --help. Configure a project's binding with the actual installed Python and dbt executable paths. The server and native executable may share the environment above, but native execution uses the saved binding, not an unrecorded global interpreter.

The CLI can open or create the same persistent data directory:

    python cli.py --workspace /absolute/client-workspace init

Run only one writer for a directory. A browser server owns that writer while open, so use its HTTP API for edits during the server session. The same CLI can operate after the server releases its writer.

## Source and operating workflow

1. Create a project for one client/delivery purpose.
2. Import the original dbt source directory. Preserve relative paths and original bytes. Do not import credentials, profiles, installed dependency folders or generated target/log folders.
3. Edit SQL, YAML or documentation and save a new edition. Previous files, hashes and editions remain available. The original dbt_project.yml and its profile name stay part of that source.
4. Save an operating contract: owner, command/selection, variables, thread count, dependency/catalogue choices, and exact native-node acceptance expectations. The actual schema contracts and data tests remain in the original dbt YAML/SQL.
5. Select the installed Python/dbt binding. Managed DuckDB creates a separate database for the run; an external binding points to the operator's existing profile directory and target. Credential values never enter the profile form or export.
6. Start the original operation. Saving the accepted request precedes native launch. The actual Dagster run ID is retained before execution; the browser shows the original result when it is available.
7. Review original logs, native node results, manifest lineage, freshness and artifacts. A missing or unexecuted required node does not pass an acceptance criterion.
8. Save a named review of the exact outcome. An approved review requires successful native execution and satisfied required criteria.
9. Create a client release, materialize its archive, and receive it into a new directory. Open the same receiving record later; reopening never restores over the edits already made there.

A successful local example is an operated example, not an assertion about a customer's unavailable database. No connection or passed native run is created to fill an empty state.

## Native execution and interruption

Dagster is the execution owner. Its normal persistent instance is under the workspace's dagster directory. The dbt command runs as an original child process with the exact selected project, target, selectors and variables. Native artifacts remain in the original run directory.

The workspace retains its own operation ID, source/contract/binding hashes, original Dagster UUID, attempts, actual process identities and native outcome. A background worker inherits the same kernel native lease before Popen returns; an orphaned dbt child also holds that lease until it exits. A browser server restart closes its writer without cancelling or redispatching the native operation.

Use Reconcile to read the same operation after an interrupted response. The command does not start another dbt pipeline. A known original Dagster failure can be retried as an explicit new run linked to its predecessor. An unknown or still-active outcome is retained for original-run reconciliation.

A prepared input is immutable. If its installed runtime or external profile reference changes, create a new operation with the new binding. A definite setup failure before native dispatch can continue the same original operation when its unchanged requirements are available. Native execution is serialized per workspace; each client's SQL still controls its own selected external warehouse operations.

See NATIVE_OPERATION.md for the full request/process/store lifecycle.

## Client releases and complete backups

A client release contains the selected client's complete source editions, contracts, bindings as references, original requests/audit, all of that client's retained run outputs, the approved release/review, the exact reviewed project files and an offline review page. It excludes other clients and the shared all-client Dagster store. New work on the receiving machine uses a fresh regular native instance; the received historical IDs and artifacts remain unchanged.

A complete workspace backup includes all projects and the original persistent Dagster SQLite stores. SQLite files are copied through SQLite's backup API while the original native lease is idle. External credentials/profiles and active lock files are not copied.

Both kinds contain the complete installation sources. The manifest identifies every file by relative path, bytes and SHA-256, and binds a stable receiving identity. The supported archive limit is512MiB expanded and512MiB compressed, with at most25,000 members. Native stores or client source beyond this limit require a separately scoped delivery; the application does not silently drop data.

Example CLI commands:

    python cli.py --workspace /absolute/client-workspace backup --output /absolute/exports --request-id delivery-backup-01
    python cli.py --workspace /absolute/client-workspace release --release-id RELEASE_ID --output /absolute/exports --request-id client-release-01
    python cli.py inspect-archive /absolute/exports/delivery-HASH.zip
    python cli.py receive /absolute/exports/delivery-HASH.zip --destination /absolute/received/client-release
    python cli.py received /absolute/received/client-release

The returned root is a data directory containing workspace.sqlite and its original native records. The delivered code is in application/; the selected release has handover/ with an offline page, selected records and exact reviewed project. Opening a received directory does not execute its imported source.

Choose an export directory outside the traversed native data, receiving history and example-source trees. Reusing an export request ID returns that request's original archive, even if later edits exist. Choose a new export request ID to capture a newer revision.

## Exact CLI mutations

Prepare one JSON envelope file and preserve it until the request resolves:

    {
      "action": "project.create",
      "payload": {"label": "Client reporting", "description": "The agreed original data workflow"},
      "workspace_id": "ORIGINAL_WORKSPACE_UUID",
      "expected_revision": 0,
      "request_id": "ONE_STABLE_REQUEST_ID"
    }

Invoke it with:

    python cli.py --workspace /absolute/client-workspace invoke request.json

The same request ID and bytes return the original acceptance. Different payload or revision under that ID conflicts. Refresh current state after any accepted replay. Do not silently change an old envelope to make it pass a newer revision.

The import-project command retains the full source envelope before its first invocation:

    python cli.py --workspace /absolute/client-workspace import-project --project-id PROJECT_ID --directory /absolute/original-dbt-project --label "Original project" --request-id import-01 --expected-revision REVISION --envelope-out /absolute/requests/import-01.json

An existing envelope is reused unchanged; importing a different source edition needs a new request ID and envelope. The command reports non-project paths omitted by the documented import scope.

## Included original example

examples/jaffle_shop contains the original dbt Labs Jaffle Shop DuckDB project files, with exact native Git and byte identities in examples/SOURCE.json and the original Apache-2.0 license. It describes a fictional example store. It is suitable for operating the installation without customer credentials; it is not Snowpack or Replo customer data.

No repository CI workflow is included. Native validation is one full operator journey against the original project and receiving paths.

## Interface and source

HTTP_API.md defines the complete engine and staff API. STAFF_BROWSER.md explains the browser request/draft/recovery controls. SOURCE_PROVENANCE.json records the original native interfaces, example identities and public business-fit sources. The software is a TJLabs implementation; Snowpack, dbt Labs, Dagster and their customers retain their own products and relationships.
