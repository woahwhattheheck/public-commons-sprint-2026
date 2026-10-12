# Snowflake in Applications

Open a retained Snowflake workspace through the existing runtime Applications
page. The managed application runs the same source, edition, review, merchant
publication and release console used by the command line and standalone browser.

## Select and prepare the workspace

Use an installed READY runtime containing the Snowflake provider. The source
contribution is `distribution/contributions/snowflake.json`; its provider is
`sf30-seller-sdk/snowflake/application-provider.mjs`. The Applications catalog
shows **Snowflake data workspace**.

Initialize the private data directory with that runtime's original command:

```sh
starforge snowflake init --directory /absolute/private/snowflake
starforge snowflake inspect --directory /absolute/private/snowflake
```

An already received Snowflake workspace can be selected directly. Keep its
`workspace.sqlite`, original objects, receiving journals, editions and merchant
directories together. Use a canonical private directory: directory permissions
0700 and the original journal permissions 0600.

In the existing runtime operator:

1. Attach the installed READY runtime.
2. Select **Applications**, then **Snowflake data workspace**.
3. Select the existing private Snowflake workspace. Leave the port at 0 to choose
   an available local port.
4. Select the optional private environment JSON if this host will capture new
   SQL API results. Its keys are the environment names already named by the saved
   source declaration; values remain on the host.
5. **Review**, **Save**, and let the existing managed connection finish.
6. **Review Start**, **Start**, then **Open**.

Review binds the workspace's stable identity and the original product source.
Editing data, receiving a later edition or saving a publication keeps that same
workspace identity. If the selected source changes, review the intended runtime
again before starting it.

## Complete the work in the original workspace

The Source page selects a declared named query and captures all original SQL API
partitions under a retained request ID. The Receiving page accepts the complete
original export folder. Reopening that folder continues its existing partition
transfer. The Editions page shows the native column metadata and preserves
large integers, fixed-scale decimals and SQL NULL values.

Review the selected edition. The Merchant release page prepares the original
SQLite merchant and SF82 release using the reviewed merchant draft and saved
publication ID. Open a saved publication to recover its exact edition, terms and
runtime. Resume that publication to continue the same native workbench and release.

**Release console** opens the existing SF82 operator for activation, seller
startup, rollback and customer receiving. The Snowflake process owns the console
it opened and closes it with the workspace.

Use **Stop** in Applications to close the saved run. **Review Start** and **Start**
open a new foreground process over the same saved workspace. Editions, review
history and publications remain available. The previous run and its output remain
in Applications history.

## What the managed adapter checks

The source-owned adapter selects the original `snowflake-workspace` command. The
existing runtime owns the application record, connection, launch, private
environment and process recovery.

The adapter reads the existing SQLite journal in read-only mode and binds its
workspace UUID. It verifies the selected Snowflake source and the source actually
executed from the adopted managed release. The native command announces its
workspace identity, source hashes, process instance and private listener. The
startup reader opens that listener with its original capability and checks the
live workspace and process instance before Applications offers **Open**.

The original Snowflake lease continues to serialize writers. The managed
application also uses the existing Applications resource identity for that
workspace. Capture and publication retries retain their original request IDs.

## Receive one complete saved edition through Applications

`receiving/managed.mjs` is the complete operator receiving program. It uses an
actual installed READY runtime and the original runtime workspace model. Select
a complete `receiving.json` export with all of its original partition files,
plus the merchant draft containing the intended public origin, receiving terms,
queries and prices.

Create a private JSON input. Every path below is an explicit local selection:

```json
{
  "runtimeDirectory": "/absolute/installed/ready-runtime",
  "managerDirectory": "/absolute/private/runtime-operator",
  "workspaceDirectory": "/absolute/private/snowflake-received",
  "manifestPath": "/absolute/private/original-export/receiving.json",
  "recordPath": "/absolute/private/snowflake-receiving/operation.json",
  "merchantDraftPath": "/absolute/private/merchant-draft.json",
  "actor": "Receiving operator"
}
```

Optional `runtimeOptionsPath` selects the original SF82 runtime JSON; otherwise
the receiving program uses `{"port":0}`. Optional `environmentFile` selects the
existing private Applications environment file. Receiving retained originals
does not need a fresh SQL API credential.

Run the program from the source included with the selected installed release:

```sh
node /absolute/installed/ready-runtime/source/stellar/scf-starforge-20261009/sf30-seller-sdk/snowflake/receiving/managed.mjs \
  --input /absolute/private/snowflake-receiving/input.json
```

The maintained package also exports
`./seller/snowflake/receiving`, including `receiveManagedSnowflake(input)`.

The program completes this one lifecycle:

1. Create or reopen the selected native Snowflake workspace and runtime operator,
   attach the actual READY runtime, and save the reviewed application.
2. Start that application and authenticate its original listener.
3. Receive every original partition, verify its exact length and SHA-256 through
   the running workspace, and compare its row count with the original SQL API
   result metadata.
4. Accept that exact receiving edition and prepare the selected merchant draft
   through the original SQLite workbench and SF82 release.
5. Read the native release snapshot and check its edition identity, row count,
   original partition BLOBs and complete snapshot hash.
6. Stop the first run, reopen the runtime operator, and start the same application.
7. Reopen the exact edition and saved publication, resume that publication, verify
   the unchanged native snapshot, and open its original release console.
8. Stop the second run and retain the complete receiving record.

The private operation record is saved before each application start and merchant
publication. It contains the selected input hash, application/review/run IDs,
workspace/edition/publication/release identities, snapshot identity and completed
stages. It leaves the received workspace and application available for subsequent
operator work.

### Continue after interruption

Run the same command with the same input file and operation record. It reopens
the saved application and publication. Pending original managed operations use
the existing Applications recovery command. An already running listener is
reused. After a confirmed closed foreground process, the next invocation records
a new reviewed run linked to the earlier lifetime and continues the same edition
and publication. An unexpected process closure is recorded with its original
operation ID.

Use the original Applications history and output to inspect that run, or stop it
there. Keep the same selected source and input files until the receiving case is
complete. A changed receiving input requires its own explicit operation record.

## Source layout

| Module | Responsibility |
| --- | --- |
| `managed.mjs` | Original journal identity, source selection and native foreground launch. |
| `application.mjs` | Applications catalog, reviewed preparation and authenticated startup. |
| `application-provider.mjs` | Registration in the shared source-owned provider registry. |
| `receiving/managed.mjs` | Complete installed application and native merchant receiving lifecycle. |

The [Snowflake guide](README.md) documents source declarations, capture,
comparison, export, merchant authoring and saved publication continuation.
The [Applications provider contract](../../distribution/runtime-workspace/APPLICATION_PROVIDERS.md)
documents the original shared lifecycle and registry.
