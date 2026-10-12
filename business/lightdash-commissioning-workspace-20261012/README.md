# Lightdash commissioning workspace

A local application for commissioning an existing dbt and Lightdash project. It retains complete source editions, supports source editing and comparison, runs the original dbt and Lightdash tools, and exports a portable receiving workspace.

The browser, command line and receiving program use the same SQLite workspace and native integration. Original source files are copied into immutable editions. Working drafts contain transactional file changes against those editions. The original project directory stays a source input.

## What the application delivers

| Work | Result |
| --- | --- |
| Source intake | A complete file inventory and an immutable copy of the selected project, with explicit omitted host and generated paths |
| Draft authoring | Retained drafts, complete text-file edits, file identity checks and protection against overwriting another selected draft |
| Source review | Baseline/candidate comparisons, complete side-by-side files and a reviewer note bound to both editions and the connection |
| Native commissioning | Original dbt dependency/build and Lightdash compile, preview, validation, deploy, content download/upload and preview deletion operations |
| Recovery | Original operation identities, child exit observations, provider references and explicit inspection of the original operation |
| Handover | A consistent SQLite backup, all source editions and drafts, native content, application source, original licenses and an offline receiving page |

The application code is MIT licensed. The selected dbt example and original Lightdash runtime retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Runtime

The application uses Node 24 or later and Python 3. It has no front-end build step, CDN or third-party browser dependency. Node supplies SQLite, the HTTP server and filesystem operations; Python supplies SQLite backup and ZIP export.

Native commissioning also requires the actual selected Lightdash CLI, dbt executable and warehouse adapter. The adapter uses an installed or source-built CLI layout containing both the original CLI entry and its original API client module. It verifies the selected runtime and prepares a private operation directory before dispatch.

The source contract was selected from Lightdash commit:

    91e610898395e6659841a321a0cee31cfcac8ae8

The corresponding original release is 2.568.0. Its CLI requires Node 24 or later. The original full example is:

    examples/full-jaffle-shop-demo

Its selected tree contains 189 original files and 28,190,932 bytes, including its unchanged Apache 2.0 dbt license. See [UPSTREAM.json](UPSTREAM.json) for exact source and license identities.

The pinned root Dockerfile declares dbt-postgres~=1.4.0 for its default /usr/local/dbt1.4 environment, alongside psycopg2-binary==2.9.6, and also prepares separate dbt 1.5–1.12 environments. The example Dockerfile itself uses lightdash/lightdash:latest. Select the original PostgreSQL adapter and retain the actual installed dbt/adapter versions and runtime image digest; the source declaration is not an observation of a running image.

Use an explicitly prepared example estate or an authorized existing customer environment. The upstream example entrypoint resets and seeds its Lightdash backend; it belongs to a disposable example installation. Commissioning uses the original commands against the selected prepared environment.

## Open the workspace

From this complete application directory:

    node server.mjs --workspace /srv/lightdash-commissioning/customer-a --create --port 8846

Open the local address printed by the process. The server binds to 127.0.0.1. An existing workspace opens with the same command without --create.

The application creates its own private SQLite database and source, operation and handover directories. Its HTTP interface accepts changes only from its local session. Source files, native content and artifacts are served completely; filtering the source inventory changes the displayed selection without truncating the retained data.

### Configure the actual connection

The Workspace screen accepts a connection binding and project selection. [examples/jaffle-workspace.json](examples/jaffle-workspace.json) contains the complete original example layout with host environment-variable references.

Replace the blank project UUID and installed runtime paths with the actual prepared estate. The native integration reads credential values from the selected host; the workspace retains their variable names.

    {
      "id": "customer-project",
      "origin": "https://app.lightdash.cloud",
      "projectUuid": "ACTUAL_PROJECT_UUID",
      "tokenEnv": "LIGHTDASH_API_KEY",
      "source": null,
      "runtime": {
        "node": "/usr/bin/node",
        "cliEntry": "/opt/lightdash-cli/node_modules/@lightdash/cli/dist/index.js",
        "python": "/usr/bin/python3",
        "dbt": "/opt/dbt/bin/dbt"
      },
      "environment": {
        "PGHOST": "PGHOST",
        "PGPORT": "PGPORT",
        "PGUSER": "PGUSER",
        "PGPASSWORD": "PGPASSWORD",
        "PGDATABASE": "PGDATABASE"
      }
    }

For a source-aware Lightdash project, select its actual source as connection.source = {name, uuid}. A saved CLI source selection is not silently adopted when no source was selected in this workspace.

The original CLI uses its normal user configuration. There is no replacement configuration-root flag, and the adapter does not change HOME. The native integration serializes the relevant configuration lifetime and uses the original supported environment overrides.

### Select profiles

For the complete original Jaffle source, choose:

    {
      "projectDir": "dbt",
      "profilesDir": "profiles",
      "profile": "jaffle_shop",
      "target": "jaffle",
      "includeProfileFiles": true
    }

The original example profile uses PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE, with SEED_SCHEMA defaulting to jaffle. Its source remains unchanged.

For customer credentials in an existing private profiles.yml, keep includeProfileFiles false and use the native host binding:

    {
      "profiles": {
        "directory": "/private/customer-profiles",
        "manifestFile": "/private/customer-profiles-manifest.json",
        "manifestSha256": "ACTUAL_COMPLETE_PROFILE_MANIFEST_SHA256"
      }
    }

This is part of the connection object. The native integration verifies the original private profile in place. It does not copy its contents into an edition or exported native content. The actual receiving program documents the original complete profile-manifest selection.

## Work through the application

1. **Source editions.** Import the complete source directory and retain the operation ID. The selected projectDir must contain the actual dbt_project.yml. Reusing that source operation returns its original edition only when the original selection matches.
2. **Working draft.** Create a draft from a retained edition. Open and edit complete source files. Existing files keep their original paths; create a new file and remove the old one when a rename is intended. Save complete files, then seal the candidate.
3. **Source review.** Compare the baseline and candidate. Open each changed file to see both complete versions. Record the reviewer, decision and intended target. The review is an engineering record.
4. **Native operations.** Select the edition, original action and complete input. Prepare a command plan, inspect its actual source, target and commands, then run the same operation.
5. **Handover.** Export the complete receiving package after the desired native work is recorded. The package preserves all retained source editions and drafts. It includes native content by default and includes private diagnostic artifacts when explicitly selected.

The editor keeps unsaved buffers while moving between its sections and files. Source reads remain bound to their requested edition, draft and path. A save or seal briefly disables changes to the selected draft while that complete write finishes; sealing saves its outstanding buffers before producing the candidate. Source writes check both the selected draft identity and original file identity. A conflict preserves the browser buffer so the operator can compare it with the current saved file.

See [WORKFLOW.md](WORKFLOW.md) for the complete native sequence, recovery behavior and practical receiving commands.

## Native actions

| Action | Original work |
| --- | --- |
| dbt-deps | Resolve the exact source project’s declared dependencies |
| dbt-build | Execute the selected original dbt build against the chosen warehouse |
| compile | Compile the retained source with the original Lightdash CLI |
| start-preview | Create a retained native preview and identify its actual project UUID |
| validate | Run the original validation job against the selected project or owned preview |
| deploy | Deploy the selected source through the original Lightdash command |
| download | Export original native chart/dashboard content from the selected project |
| upload | Upload an original retained content export or an explicitly selected immutable source-edition content tree |
| run-chart | Execute the reviewed chart through the original query command and retain its query UUID, actual rows and CSV |
| stop-preview | Remove only the exact preview bound to its original creation operation |

Native operations keep one stable ID. Source edition, connection, inputs and original command plan are bound together. Reusing an ID with a different selection is a conflict.

A preview uses the original start-preview command. The interactive preview command has a different cleanup lifetime. An actual preview UUID is required even if the upstream CLI exits successfully.

The original deployment session exposes no session GET endpoint, and a successful finalization deletes its session. A missing session cannot establish failure. The adapter retains actual successful finalization responses and the original session/request identities. An uncertain response remains attached to that operation for explicit recovery.

## Portable handover

The Handover screen creates:

    Lightdash_Commissioning_Handover.zip
      START_HERE.html
      workspace.json
      manifest.json
      app/
      workspace/
        commissioning.sqlite
        editions/
        operations/

The archive contains the complete application identified by source-manifest.json. Every retained edition includes its original complete file manifest and source bytes. SQLite preserves every draft overlay and reviewer record. Native content is selected from the original artifact inventory; omitted private diagnostic file contents remain clearly listed.

The exporter verifies the complete archive after reopening it. Its receiving SQLite copy has the host connection detached. This allows the receiver to read the original work immediately and explicitly configure the receiving runtime and target before another native operation.

Before acknowledging a new handover, the application retains its selection intent, creates a transactionally consistent SQLite snapshot with SQLite VACUUM INTO, and durably publishes the complete original database and its revision-bearing request. Archive construction then runs in the background. If selection is interrupted before acknowledgment, its original ID remains visible as pending and can be resumed; no workspace revision has been promised before its actual snapshot is retained.

Existing handovers remain listed in the application. **Inspect original handover** checks its actual writer and adopts a completed original ZIP, including a complete partial ZIP whose final publication was interrupted. **Resume original handover** continues from the same retained SQLite revision and complete file basis. A new handover ID selects the current workspace; retrying an existing ID preserves its original selection.

See [HANDOVER.md](HANDOVER.md) for receiving, original archive recovery and content reuse.

## Command line

The CLI accepts complete JSON input files:

    node cli.mjs help
    node cli.mjs init --workspace /srv/lightdash-commissioning/customer-a
    node cli.mjs configure --workspace /srv/lightdash-commissioning/customer-a --input examples/jaffle-workspace.json
    node cli.mjs intake --workspace /srv/lightdash-commissioning/customer-a --input source-selection.json
    node cli.mjs state --workspace /srv/lightdash-commissioning/customer-a

Original operation commands:

    node cli.mjs plan --workspace /srv/lightdash-commissioning/customer-a --input native-operation.json
    node cli.mjs run --workspace /srv/lightdash-commissioning/customer-a --id ORIGINAL_OPERATION_ID
    node cli.mjs inspect --workspace /srv/lightdash-commissioning/customer-a --id ORIGINAL_OPERATION_ID
    node cli.mjs operation --workspace /srv/lightdash-commissioning/customer-a --id ORIGINAL_OPERATION_ID

Complete source and export commands:

    node cli.mjs draft --workspace /srv/lightdash-commissioning/customer-a --edition BASELINE_EDITION_ID
    node cli.mjs edit --workspace /srv/lightdash-commissioning/customer-a --input complete-file-change.json
    node cli.mjs seal --workspace /srv/lightdash-commissioning/customer-a --input candidate-selection.json
    node cli.mjs compare --workspace /srv/lightdash-commissioning/customer-a --baseline BASELINE_ID --candidate CANDIDATE_ID
    node cli.mjs review --workspace /srv/lightdash-commissioning/customer-a --input source-review.json
    node cli.mjs content-exports --workspace /srv/lightdash-commissioning/customer-a --id ORIGINAL_DOWNLOAD_ID
    node cli.mjs package --workspace /srv/lightdash-commissioning/customer-a --id HANDOVER_UUID
    node cli.mjs inspect-handover --workspace /srv/lightdash-commissioning/customer-a --id HANDOVER_UUID
    node cli.mjs resume-handover --workspace /srv/lightdash-commissioning/customer-a --id HANDOVER_UUID

--revision binds a workspace change to an observed SQLite revision. Complete file edits additionally accept expectedFileSha256 and expectedDraftId. No command accepts arbitrary native shell arguments.

## Source files

| Entry | Responsibility |
| --- | --- |
| workspace.mjs | SQLite state, immutable editions, drafts, reviews and original operation records |
| server.mjs / web/ | Local browser application and complete artifact downloads |
| cli.mjs | Complete JSON command interface to the same workspace |
| native/ | Original runtime bindings, execution, native artifacts and recovery |
| receiving/ | Complete source-native commissioning program |
| packaging.mjs / package.py | Original revision capture, complete retained export basis, portable archive and same-ID recovery |
| source-manifest.json | Exact complete authored source cohort |

This application runs only the selected original native tools. The included source is independent commissioning software; it does not calculate a substitute metrics engine or represent an upstream endorsement or accepted commercial engagement.
