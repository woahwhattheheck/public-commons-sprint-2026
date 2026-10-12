# ODK Central through Applications, SDK and typed tools

This module connects the original Central field workspace to the maintained Starforge application and merchant registries. The native workspace retains the source, rows, reviews, datasets, reports and archives. Applications owns its process and original lifetime lease. CLI and MCP clients borrow its authenticated local listener.

## Install and open the original workspace

Use the full maintained Starforge distribution containing the ODK contribution, on Linux with Node 24 or newer and the original util-linux flock dependency. In Applications, choose **ODK Central field reporting**, select a private workspace directory, and name the recording operator. The optional private environment file supplies existing host environment variables. A Central connection records an environment variable name such as CENTRAL_AUTHORIZATION; that variable contains the complete existing Authorization header on the host.

The managed command is also available directly:

~~~sh
starforge odk-central-workspace --workspace /private/field-workspace --operator "Field reporting operator"
~~~

An optional --port selects the original loopback port. The first complete startup JSON identifies the workspace UUID, original instance, connection file and authenticated operator URL. Applications verifies that record against the selected directory and the actual listener before exposing its Open action.

The same executable delegates data subcommands to the original Central CLI. Its command help describes the native source, capture, report, dataset, archive and release arguments. Calling the managed host with --help prints its startup and receiving options.

The private workspace's odk.connection.json belongs to the current Application instance. Stopping Applications removes that instance's connection, closes HTTP, settles captures and closes the original database and lifetime lease. A replacement instance writes a new private connection; clients inspect and reconnect explicitly. Closing an SDK or MCP attachment leaves the Application running.

## Reopen a complete received archive

Applications accepts the original archive plus its reviewed SHA-256 before opening the workspace. Select a new or truly empty directory:

~~~sh
starforge odk-central-workspace --workspace /private/received-field-workspace \
  --operator "Receiving field operator" \
  --restore-archive /private/receiving/central-workspace.tar.gz \
  --restore-sha256 ORIGINAL_FULL_SHA256
~~~

The original importer validates and restores the archive, then publishes the received directory. Its receivedArchive receipt resides in the same SQLite metadata. Applications verifies that receipt against the original archive hash and live workspace UUID. Repeating the same receiving selection preserves later captures, reviews and reports in that received workspace.

Normal startup retains the reviewed directory's device/inode identity. An explicitly reviewed restore can replace its original empty directory; the saved native receiving receipt binds that expected replacement. Archive review uses streamed hashing for files larger than the common Applications four-MiB input hash threshold.

An occupied workspace belonging to another archive cannot be replaced by this flow. Provider credentials remain environment aliases; supply the receiving host's existing corresponding environment before another provider call.

## Attach the SDK to the existing listener

~~~js
import {connectCentralWorkspace} from './index.mjs';

const client = await connectCentralWorkspace({
  directory: '/private/field-workspace',
  connectionFile: '/private/field-workspace/odk.connection.json',
});
const state = await client.state();
// Inspect retained state and select its actual source/plan/table IDs.
const edition = await client.edition({id: selectedCaptureId});
client.close();
~~~

These source examples run beside odk/index.mjs. The installed distribution exposes the same module at its ./seller/odk export; connection, managed and mcp subpaths have paired declarations.

The client exposes the original connect, projects, forms, createPlan, capture, resume, pause, wait, edition, rows, row, resources, quality, review, compare, exportDataset, report, backup, sourceFile and exportFile methods. It also exposes prepareRelease, releaseStatus, activateRelease and rollbackRelease through the original SF82 publication store.

Retain a stable caller-selected ID before creating a plan, capture, dataset, report or archive. The SDK generates a UUID when its corresponding optional ID is omitted and preserves that ID on an uncertain-response error. An explicit original ID gives the caller a durable selection before dispatch. Exact repeats recover the original matching input; a reused ID with changed input is a conflict. Review and release transitions use their original expected revision or generation.

Response errors preserve native code, status, details, operation ID and provider Retry-After. A local disconnect, timeout, incomplete body or malformed action response after dispatch carries dispatch: unknown. Inspect the same original capture/state and continue its existing ID. A read failure remains a read outcome.

## Configure the existing merchant host

A host-owned private configuration selects aliases for original workspaces, Central source connections, publication terms and dataset runtimes. Configuration loading starts no listener or acquisition.

Example structure, with values selected by the actual operator:

~~~json
{
  "schema": "stellar-forge.odk-workspace-connection.v1",
  "workspaces": {
    "field_reporting": {
      "label": "Field reporting",
      "directory": "/private/field-workspace",
      "connections": {
        "central": {
          "id": "original-central-source",
          "name": "Existing Central service",
          "url": "https://central.example.org",
          "authEnv": "CENTRAL_AUTHORIZATION"
        }
      },
      "merchants": {},
      "runtimes": {}
    }
  }
}
~~~

The example URL is a placeholder. Select an existing authorized Central Web User and its actual project/form access. A published App User does not provide the required data-reading access.

Each merchant profile supplies the original reviewed origin, path and payment object, with optional defaultLimit and maxLimit. Copy those terms from the selected native dataset publication contract. Each dataset runtime profile uses the original SF82 options: port, facilitator and allowLocalFacilitator. Generic handler/upstream settings do not belong to a dataset release.

Initialize the existing merchant host beside the original source workspace:

~~~js
import {initializeCentralWorkspaceMerchant} from './index.mjs';
await initializeCentralWorkspaceMerchant({
  directory: '/private/field-merchant',
  connection: '/private/field-host.json',
  name: 'Field reporting operator',
});
~~~

The initializer creates or verifies the original merchant-mcp.json, release store and private customer-exports directory. It uses the existing merchant configuration reader and one original private writer. Repeating identical configuration reuses it; different input in that same initialized host conflicts.

## Typed operation sequence

The source-owned provider is odk-workspaces, family odkWorkspaces, configured by odkWorkspaceConnection. The current typed catalog includes:

| Purpose | Original tools |
| --- | --- |
| Attach and inspect | merchant_odk_status, merchant_odk_connect, merchant_odk_disconnect, merchant_odk_browser |
| Select original source | merchant_odk_source_connect, merchant_odk_projects, merchant_odk_forms, merchant_odk_plan_create |
| Retain the cohort | merchant_odk_capture_start, merchant_odk_capture_status, merchant_odk_capture_pause, merchant_odk_capture_resume |
| Inspect retained source | merchant_odk_edition, merchant_odk_rows, merchant_odk_row, merchant_odk_resources, merchant_odk_quality |
| Interpret and compare | merchant_odk_review, merchant_odk_compare |
| Produce complete outputs | merchant_odk_dataset, merchant_odk_report, merchant_odk_backup |
| Operate the original release | merchant_odk_release_prepare, merchant_odk_release_status, merchant_odk_release_activate, merchant_odk_release_rollback |
| Receive original files | merchant_odk_source_file, merchant_odk_export_file, merchant_odk_file_retain, merchant_odk_files, merchant_odk_file, merchant_odk_file_release |

Choose a configured alias from status, start its saved Application, and connect. Source connection uses a declared profile and its stable native ID. Plan creation names the exact project/form selections and submittedFrom, submittedBefore or updatedSince scope. Native pageSize controls Central continuation pages. Every advertised root/repeat table, original form generation, submission version and available media object remains in the native capture.

Status state arrays have explicit offset/limit/total/nextOffset projections. Retained rows and resources use the original native cursors; preserve their returned next value. The original schema and API remain authoritative for allowed field paths and source interpretation.

Review records accept or revise, expectedRevision, note and optional reviewer/findings/indicators. Findings are JSON objects; the report uses their title and text. Indicators bind tableId and an optional scalar field to rows, nonempty, sum, mean, minimum, maximum, distinct or frequency. Optional equals compares a native scalar. Numeric calculations require an original scalar numeric CSDL type. Missing, null and empty source states remain explicit.

Accepted dataset publication preserves selected native row and parent keys, field semantics and source packages. A host merchant profile supplies reviewed terms. Prepare, activate and roll back through the original SF82 release store at its reported state.generation.

## Stream and retain original files

First read a source or export descriptor. Preserve its exact SHA-256 and byte count together with the original relative download path:

- /api/files/source/ORIGINAL_SHA256
- /api/files/export/ORIGINAL_ID?path=ENCODED_ORIGINAL_MEMBER

Pass that exact selection and a stable requestId to merchant_odk_file_retain. The original source/export files stay in the native workspace. The selected customer download is streamed into its own private retained-file directory under the merchant's customer-exports/odk/<alias>.

The operation saves its request and native workspace UUID before downloading, retains original response metadata, streams and hashes the bytes, atomically publishes content, then saves its final immutable file receipt. A lost reply reopens that same receipt. An interrupted final receipt can recover the already-published matching bytes. Changed input under the same request ID is rejected.

A single download supports up to 8 GiB and a five-minute transport timeout. The transport enforces the selected byte count and full SHA-256, supports responses with or without Content-Length, and uses bounded memory. Keep the same operation and source identity when continuing an interrupted transfer.

Read a completed file with merchant_odk_file using fileId, expectedSha256, offset and limit. Continue its readId and nextOffset; the existing retained reader hashes and holds the original read-only descriptor with bounded memory, then closes it at EOF. Its chunk limit is 196,608 bytes. Unfinished reads can be released explicitly. After MCP restart, reopen the same file/hash/offset. Completed downloads remain readable when the original Application is stopped.

These controls do not expose arbitrary host paths or a second source store. Input aliases and workspace ownership come from the private host configuration, and the original native source/export API selects the bytes.

## Complete receiving and operator handover

A full field operation carries its source connection and project/form identities, original root/repeat rows, form/submission versions, source/media receipts, authored review, exact indicator definitions, period comparison, complete report/dataset files and archive receipt. The original native receiver exercises those identities through reopen and export verification.

Applications, CLI, SDK and MCP share that same workspace. Customer-specific commissioning can select several forms and two reporting periods while retaining each original source boundary and customer-owned indicator definition. Record the agreed selection and acceptance in the existing customer Workshare; use the native dataset/review/source results for its actual receiving.

## Source and implementation references

- ODK Central API and OData documentation: https://docs.getodk.org/central-api/ and https://docs.getodk.org/central-api-odata/
- Released Central backend source used by the native transport: getodk/central-backend at de0d2a07fd7c9ff698cbc312e550dd40ff058340.
- Original Applications framework: distribution/runtime-workspace/application-provider.mjs.
- Original merchant provider registry: stellar-forge/mcp-merchant-operator/provider-contract.mjs.
- Original retained reader: stellar-forge/mcp-merchant-operator/retained-file-reads.mjs.
- Source-owned contribution: distribution/contributions/odk.json.

Provider continuation is a paging position. Original capture timestamps, schema changes and source/version receipts describe the collection's actual observation window. Native repeat IDs identify structural rows; they can change when a repeat is reordered. Available attachment versions describe the bytes Central returned when read.
