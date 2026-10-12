# Install and operate the records workspace

The records workspace is one application over the maintained Python workspace. It retains source editions, invoice calculations, source corrections, named review decisions, inventory and transition checks, customer field mappings, monthly reporting settings and complete portable history. Applications adds saved launch settings and process ownership for that same workspace.

The generic package contains no issuer documents, customer captures, proposal prices or example-operation program. Supply your own prepared input or reopen the original operator handoff. The input schema and exact field interpretation are in [CORE_CONTRACT.md](CORE_CONTRACT.md); [INPUT_HANDOFF.md](INPUT_HANDOFF.md) describes source preparation, and [UI.md](UI.md) describes the operator interface.

## Select the existing runtime

Use the complete maintained source checkout or the source directory of an installed `@tokenjunkielabs/starforge-merchant` package. The native records application requires Node 22.13 or later with its original SQLite API and Python 3.11 or later. The maintained Applications/installer host has its own Node 22.16+, Linux, Python, npm and flock requirements. Keep the existing working runtime and its dependency closure; the records package adds no third-party dependency.

The source paths are:

| Purpose | Original path within the runtime source root |
| --- | --- |
| Installed command | `stellar/scf-starforge-20261009/sf30-seller-sdk/records-operator/workbench.mjs` |
| Distribution dispatcher | `stellar/scf-starforge-20261009/distribution/cli.mjs` |
| Applications provider | `stellar/scf-starforge-20261009/sf30-seller-sdk/records-operator/application-provider.mjs` |
| Original Applications model | `stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs` |
| Native saved workspace | `stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/model.mjs` |
| Canonical registration | `stellar/scf-starforge-20261009/distribution/contributions/records-operator.json` |

For the commands below, set `RECORDS_SOURCE` to the absolute maintained runtime source root and `RECORDS_CLI` to its original distribution dispatcher:

~~~sh
RECORDS_SOURCE=/absolute/path/to/merchant/source
RECORDS_CLI="$RECORDS_SOURCE/stellar/scf-starforge-20261009/distribution/cli.mjs"
node "$RECORDS_CLI" registrations --source records-operator
node "$RECORDS_CLI" records-workspace help
~~~

The registration exposes one original command, `records-workspace`, the records workspace/managed/provider package exports, its browser asset manifest and one provider named `records-operator`. The Applications catalog title is **Records operations**. Its kind is `records-operator`.

An installed archive must already include these leaves in its original source manifest. Adding files to an already identified READY installation changes that installation; use the existing distribution's following complete archive for adoption. A source checkout can compose the same contribution directly. The maintained loader reports conflicting registrations, unknown selectors and missing provider files with the exact original source path.

## Create or receive one workspace

The workbench root is an absolute, private directory containing `operation.json` and the original `workspace/` directory. The SQLite database remains `workspace/workspace.sqlite3`. Select this workbench root in Applications, rather than selecting the database or a saved-source revision directory.

Create from the explicit prepared source:

~~~sh
node "$RECORDS_CLI" records-workspace create \
  --source-root "$RECORDS_SOURCE" \
  --dir /absolute/private/records-operation \
  --dataset /absolute/prepared/workspace.json
~~~

The wrapper reads the entire selected configuration and all referenced content-addressed CSV/JSON captures. It retains the application and original reconciliation engine in the native saved source. Captures are checked against their declared byte counts and SHA256 values. Input limits are the original 8 MiB per file and 32 MiB per saved revision.

Without `--plan`, the original operation marker records `LOCAL_PREVIEW_UNCONFIGURED`. Private calculation previews run through the native Python worker. A local workspace, a price reconciliation and a proposed implementation fee do not execute a customer payment or establish a merchant deployment.

To receive an existing complete operator handoff:

~~~sh
node "$RECORDS_CLI" records-workspace reopen \
  --source-root "$RECORDS_SOURCE" \
  --dir /absolute/private/received-records \
  --bundle /absolute/handoff/operator/workspace.python-workspace.json
~~~

The original importer creates a new receiving directory and preserves the exported workspace identity, revisions, completed previews, review source and native release/customer history. Its operation marker retains the original bundle digest. Repeating that identical receiving command reopens its own saved operation; it does not replace another workspace.

Both paths use the same native model. Neither creates a second records database format or transforms the original portable history.

## Review and save in Applications

Open the existing maintained runtime workspace and use its **Applications** page. If it is not already serving, the original command is:

~~~sh
node "$RECORDS_CLI" runtime-workspace serve \
  --workspace /absolute/private/existing-runtime-workspace \
  --port 8465
~~~

Choose the existing READY runtime containing the records provider. Select **Records operations**, give the application a useful operator label and select the initialized workbench root. Set a local port, or leave it at `0` to allocate one. The optional private environment file uses the original Applications environment contract; the records adapter adds no credential store.

Use **Review**, then **Save**. These are the existing application's source and launch controls. The review binds:

- The selected workbench directory, marker and native database identity.
- The immutable original Python workspace ID and creation time.
- Exact records wrapper, processor, reconciliation engine, browser, managed and provider source.
- The original Python model, server and browser draft store, and the canonical browser asset reader.
- The selected installed runtime, original source manifest and existing dependency identity.

Reading the binding does not open a producer model, run a preview, recover an unfinished Python job or save a source revision. The adapter reads the original SQLite metadata in a read transaction and closes it. Normal operator work remains mutable: changing the selected source edition, saving a review, retaining a new preview or restoring history does not change the application's immutable workspace identity.

For a direct read of the same source/workspace binding:

~~~sh
node "$RECORDS_CLI" records-workspace binding \
  --source-root "$RECORDS_SOURCE" \
  --dir /absolute/private/records-operation
~~~

Its `stellar-forge.records-workbench-review.v1` result contains `workspace.sha256` and `source.sha256`. These are full SHA256 values, and the source result lists every exact launch leaf.

The complete Applications flow is also available through the existing runtime CLI. Prepare a private JSON request using the actual runtime ID already present in that runtime workspace:

~~~json
{
  "runtimeId": "ACTUAL_RUNTIME_ID",
  "kind": "records-operator",
  "label": "Records review",
  "settings": {
    "workspaceDirectory": "/absolute/private/records-operation",
    "port": 0
  }
}
~~~

~~~sh
node "$RECORDS_CLI" runtime-workspace application-review \
  --workspace /absolute/private/existing-runtime-workspace \
  --request /absolute/private/application-review.json
~~~

Use the returned review ID in the original save request:

~~~json
{
  "requestId": "A_NEW_RETAINED_UUID",
  "reviewId": "ACTUAL_REVIEW_ID"
}
~~~

~~~sh
node "$RECORDS_CLI" runtime-workspace application-save \
  --workspace /absolute/private/existing-runtime-workspace \
  --request /absolute/private/application-save.json
~~~

Retain the request files and returned application ID. Reconcile an interrupted save using the same request ID and payload. For an existing application edit, include its actual `applicationId` and current `expectedRevision` in the review, and the same application ID in the save. The original compare-and-save protection preserves another operator's current settings.

## Start, Open and Stop

Start the saved application through Applications. If that runtime has not yet been connected to its existing managed home, use the original **Connect** operation and retain its progress before starting. It adopts the already selected original runtime; the records provider does not build another package.

The managed workbench validates the saved workspace and source identities before opening the native model or listener. It prints one schema-first JSON startup line. The maintained observer checks the original command arguments, selected and executed source identity, workspace identity and the authenticated listener's actual `/api/state` response. **Open** becomes available from that accepted listener.

The records operator is served at `/records-operator/`. The native Python workspace remains at `/` on the same local origin. Both URLs use the original private token fragment and the native `X-Python-Workspace-Token` request header. The application's operator assets reuse the original host's origin checks, lifecycle and IndexedDB draft helper.

Use **Open** to review the current saved period and edition. Source changes, invoice reviews, transition checks, customer mapping and original full exports happen in that same native workspace. Use **Stop** on the retained application operation to close its own process and server. Applications keeps the saved source and its launch history. Starting again reopens the same workspace and produces a fresh authenticated local listener.

The CLI equivalents are:

~~~sh
node "$RECORDS_CLI" runtime-workspace application-connect \
  --workspace /absolute/private/existing-runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID

node "$RECORDS_CLI" runtime-workspace application-start-review \
  --workspace /absolute/private/existing-runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID
~~~

Then provide the returned start review and an actual retained request UUID:

~~~json
{
  "applicationId": "ACTUAL_APPLICATION_ID",
  "requestId": "A_NEW_RETAINED_UUID",
  "reviewId": "ACTUAL_START_REVIEW_ID"
}
~~~

~~~sh
node "$RECORDS_CLI" runtime-workspace application-start \
  --workspace /absolute/private/existing-runtime-workspace \
  --request /absolute/private/application-start.json

node "$RECORDS_CLI" runtime-workspace application-output \
  --workspace /absolute/private/existing-runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID \
  --operation-id ACTUAL_OPERATION_UUID

node "$RECORDS_CLI" runtime-workspace application-stop \
  --workspace /absolute/private/existing-runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID \
  --operation-id ACTUAL_OPERATION_UUID
~~~

The original Applications `applications` and `application-history` commands show saved runs. A running application for the same native workspace is shared through the original resource identity; start is not an instruction to create another records store or terminate an unrelated process.

For direct managed operation by an existing receiver, use the exact identities from `binding`:

~~~sh
node "$RECORDS_CLI" records-workspace managed \
  --source-root "$RECORDS_SOURCE" \
  --dir /absolute/private/records-operation \
  --expected-workspace-identity ACTUAL_WORKSPACE_SHA256 \
  --expected-source-sha256 ACTUAL_SOURCE_SHA256 \
  --port 0
~~~

The installed source layout is required for this direct managed command: the adapter verifies the actual source copy executing its wrapper as well as the selected source root. An ordinary delivered application directory can be served directly using the next section.

## Full handoff and receiving

Use the original selected completed `build_records` preview ID. The complete exporter reconstructs that exact saved revision, including binary-safe native source bytes, then runs the same processor's streaming export once. Its customer and operator folders retain explicit audience separation.

~~~sh
node "$RECORDS_CLI" records-workspace handoff \
  --source-root "$RECORDS_SOURCE" \
  --dir /absolute/private/records-operation \
  --preview ACTUAL_COMPLETED_BUILD_ID \
  --out /absolute/private/records-handoff \
  --audience operator
~~~

The output contains:

| Location | Retained content |
| --- | --- |
| `customer/` | Complete selected customer rows, AP reconciliation, inventory, transitions/checkpoints, monthly amounts with coverage, requirements/catalog reports, change report and safe customer summary |
| `operator/native-preview.json` | Exact original completed compact operator result |
| `operator/workspace.python-workspace.json` | Complete original saved source, revisions, native preview outputs and history |
| `operator/application/` | Nineteen application, engine, browser and operating/installation source files |
| `operator/install/records-operator.json` | Exact source-owned distribution declaration for the canonical contribution directory |
| `operator/REOPEN.md` | Original receiving and operating sequence |
| `manifest.json` and `handoff.json` | Exact output, source and native preview identities |

The customer mapping operates on the actual safe customer projection. Even a selected parent-object pointer receives only its public children. Missing selected paths remain explicitly unavailable; a present null stays distinguishable. Private review ownership/notes, local input paths and raw correction context remain in operator material. The customer summary generated in the complete export has the same source and projection as `customer_records`.

Monthly reports carry their explicit reporting timezone, source period and calendar-month coverage. A calculated partial-month subtotal remains labelled partial. Arithmetic completion does not turn a selected partial-month input into a complete calendar-month report.

A receiving team can use the packaged application without a repository checkout of the private project:

~~~sh
node /absolute/handoff/operator/application/workbench.mjs reopen \
  --source-root "$RECORDS_SOURCE" \
  --dir /absolute/private/received-records \
  --bundle /absolute/handoff/operator/workspace.python-workspace.json

node /absolute/handoff/operator/application/workbench.mjs serve \
  --source-root "$RECORDS_SOURCE" \
  --dir /absolute/private/received-records \
  --port 8431
~~~

This ordinary serve path uses the packaged browser and original native server. Its managed controls are supplied by the canonical installed records module. To add a received workspace to Applications, select the receiving workbench root and perform the normal review/save sequence against the installed runtime. The original workspace ID is preserved; its receiving directory/marker identity is deliberately reviewed at the new location.

## Recovery and useful diagnostics

| Observed result | Meaning and continuation |
| --- | --- |
| `APPLICATION_NOT_IN_RUNTIME` or missing provider | The selected archive predates the complete records registration. Select the following maintained archive that includes it; retain the existing workspace. |
| `RECORDS_WORKBENCH_REQUIRED` | The selected directory does not contain an original create/import marker. Select its initialized workbench root, or use the original importer on the retained bundle. |
| `RECORDS_PRIVATE_DIRECTORY_REQUIRED` | The launch is not pointing to the original private workbench directory. Use its actual absolute path and existing private permissions. |
| `RECORDS_MANAGED_INPUT_CHANGED` or source identity mismatch | The selected source or workbench location changed since review. Reopen its actual state and review/save the current selection. Normal native source-head changes are not part of this identity. |
| `APPLICATION_WORKSPACE_BUSY` | An original retained application operation already owns this workspace. Open that operation, or stop/reconcile it before another start. |
| `APPLICATION_RECORDS_STARTUP_UNAVAILABLE` | The expected original listener did not return the authenticated saved state. Retain the application's original output and startup record; inspect that operation's actual result. |
| `INTERRUPTED` application operation | Use the existing application-recover command for the same application and operation IDs, then follow its returned state. |
| Interrupted preview or export | Reopen the native workspace, inspect the retained original preview/operation, and continue its existing request or exact handoff selection. Reuse completed outputs. |
| Receiving after a process/host loss | Import the retained original portable into a new private receiving directory, then review that actual path in Applications. Preserve the old workspace for its original history. |

To recover an existing application operation through the maintained worker:

~~~sh
node "$RECORDS_CLI" runtime-workspace application-recover \
  --workspace /absolute/private/existing-runtime-workspace \
  --application-id ACTUAL_APPLICATION_ID \
  --operation-id ACTUAL_OPERATION_UUID
~~~

The adapter does not delete native locks, identify another process solely from a reused PID, rewrite the original history or substitute a new result for a completed preview. Use the original state and operation record to reconcile an interrupted process. The original portable receiving route removes live-runtime ownership fields while retaining saved work, which is the appropriate transfer after a host or process-namespace change.

## Source composition and acceptance

The canonical contribution is discovered from the flat maintained `distribution/contributions/` directory. The identical `records-operator/contribution.json` is packaged for receiving; only the canonical declaration is loaded as a registry contribution. It registers one command and one Applications provider, so carrying the portable copy creates no second application entry.

The provider implements the original `stellar-forge.runtime-application-provider.v1` ABI: catalog, prepare, managed-request selection and startup observer. The common registry retains duplicate/unknown declaration handling, private environment preparation, resource ownership, saved review/start state and operation recovery. The provider contains the records-specific adaptation and calls the same original workspace and server.

A complete receiving operation records the actual source pin, workspace ID, launch source SHA, original application/start operation IDs where an installed Applications runtime is used, observed authenticated workspace, Stop result, fresh listener reopening and unchanged saved history. Source-native managed operation and installed Applications adoption are recorded separately. A source commit or parsed module alone is not an installed receiving result.

The private walkthrough or a customer's actual first operation can append these managed steps after its already completed source/review/export phases, reusing the same workbench and retained operation journal. It should not run another baseline calculation merely to prove that the application launcher reopened saved work.
