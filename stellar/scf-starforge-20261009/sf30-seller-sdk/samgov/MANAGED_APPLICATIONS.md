# SAM.gov managed Applications and typed customer receiving

This integration opens the original SAM.gov notice workspace through the maintained
Applications lifecycle and connects the merchant MCP to that same server.
The industrial browser, typed tools, source revisions, qualification decisions,
merchant preparation and opportunity handoff share the original store.

The source registration is **samgov**. Its application kind is
**samgov-opportunities**, command **samgov-workspace**, and merchant provider
**samgov-workspaces**. The existing samgov CLI and original nine SDK entrypoints
remain available; the managed, connection and mcp entrypoints add paired types.

## 1. Open the original source workspace

Inspect the selected installation:

~~~sh
starforge registrations --source samgov
starforge merchant-providers inspect samgov-workspaces
~~~

In the existing Runtime workspace, open **Applications** and choose
**SAM.gov opportunities**. Complete the original Review, Save, Connect, Review
Start and Start flow on that saved application. The normal Open button uses the
private native URL once its startup and authenticated source identity are read.

| Field | Selection |
| --- | --- |
| SAM opportunity workspace | The original private directory, or one new directory inside a private parent. Existing source/history is opened in place. |
| Recording operator | The name recorded by the original source, review and handoff actions. |
| SAM credential environment name | The existing environment variable, normally SAM_GOV_API_KEY. The private environment file is selected by the shared Applications flow. |
| GSA search endpoint | Omit for the original production endpoint, or choose the original GSA alpha endpoint. |
| Opportunity handoff workspace | An existing LGNDX opportunity workspace when a selected notice will be received into a project. |
| Port | Zero selects an available loopback port. |
| Environment file | The original private host environment file when new provider acquisition needs it. |

The same managed native command can be started explicitly:

~~~sh
starforge samgov-workspace \
  --workspace /private/procurement/sam \
  --operator "Procurement operator" \
  --port 0
~~~

Add --api-key-env NAME, --endpoint URL or --opportunity-workspace DIR when those
reviewed host selections apply. The server binds 127.0.0.1. Startup emits one
versioned JSON line and writes the private samgov.connection.json inside the
original workspace. Its workspace directory identity, native instance, operator,
source ID, port and connection hash are checked before Applications accepts Open.

The original SAM server retains the capture task owner, merchant hosts and native
directory writer. Stop first retires this instance's private connection, then
drains accepted requests, pauses its captures, drains its sellers and closes the
owned store. A saved application can then start that same source directory again.
An earlier standalone SAM server should complete and close under its existing
owner before this managed start acquires its original writer.

Retained source reading and receiving use the files already in the workspace.
The credential environment is needed when the original source action makes a new
provider request.

## 2. Declare the MCP's original workspace and inputs

Create a private host configuration file outside the published source. Every
workspace alias selects an existing owned directory; the tools cannot supply a
new directory, listener URL, executable module or arbitrary input file.

This example has one alias, one exact received packet and one source-action
file. Replace the two SHA placeholders with hashes of the actual selected files.
Relative file and directory paths resolve against this configuration file.

~~~json
{
  "schema": "stellar-forge.samgov-workspace-connection.v1",
  "workspaces": {
    "fema": {
      "label": "FEMA opportunity source",
      "directory": "./sam",
      "inputs": {
        "original_packet": {
          "label": "Complete original receiving packet",
          "kind": "packet",
          "file": "./inputs/original-packet.json",
          "sha256": "ACTUAL_64_CHARACTER_SHA256"
        },
        "issued_notice": {
          "label": "Original issued notice and companion documents",
          "kind": "action",
          "file": "./inputs/issued-notice-action.json",
          "sha256": "ACTUAL_64_CHARACTER_SHA256"
        }
      }
    }
  }
}
~~~

The optional workspaceId binds an existing original sam_... identity explicitly.
New empty source directories may omit it; the native store creates its ID on its
first retained mutation. The live source ID is returned with the connected native
state.

Each action file contains exactly action and payload. Allowed original actions
are import_notice, import_capture and retain_resource. Payload uses that action's
existing native contract from workspace.d.mts and SOURCE-CONTRACT.md. For an
issued notice, preserve the exact original document bytes in contentBase64,
their URL, filename, capturedAt and actual response metadata. The resources and
history companion inputs use that same native document contract. For captured
search pages, preserve the original request URL, status, headers and captured
bytes for each original page.

Keep requestId and expectedRevision out of the file: the reviewed MCP mutation
supplies them. The host config pins the complete action file SHA-256, and the
receiver verifies it again immediately before the native transaction.

A packet input is the complete original stellar-forge.samgov-packet.v1 JSON.
The native importer verifies its original objects, editions and full version
history. It receives matching history idempotently and rejects a different
history in an occupied workspace.

The host can also declare up to 32 named merchants. A merchant profile contains
label, origin, path, payment and optional defaultLimit/maxLimit, using the original
prepare_merchant contract. Those reviewed terms stay in the host configuration;
the MCP call selects the profile alias and retained source selection.

Use owned private directories and files (0700/0600 on Linux). The reader rejects
symlinked or changing source files. Configuration accepts at most 32 workspaces
and 256 named inputs per workspace. Actual source file limits remain the original
64 MiB per source and 512 MiB complete packet/request limits.

## 3. Initialize the existing merchant host

Create a private setup JSON:

~~~json
{
  "directory": "/private/procurement/sam-merchant",
  "connection": "/private/procurement/sam-workspaces.json",
  "name": "SAM procurement operator"
}
~~~

Then use the maintained provider initializer:

~~~sh
starforge merchant-providers init samgov-workspaces \
  --options /private/procurement/sam-merchant-setup.json
~~~

The initializer creates the standard original release store, customer-exports
directory and merchant-mcp.json. It validates the selected SAM configuration
without starting a listener or acquiring the SAM source writer. Repeating the
same completed setup reuses its configuration; different options at that
merchant directory are reported as a configuration conflict.

The standard MCP transports expose the same typed tools:

~~~sh
starforge merchant-mcp-stdio \
  --config /private/procurement/sam-merchant/merchant-mcp.json
~~~

The existing merchant-mcp serve command can instead use its normal host-selected
token environment or OAuth configuration. Consult the maintained merchant host
guide for that transport's deployment and account configuration.

Start the saved SAM Application before connecting its alias. The merchant
provider is loaded lazily by the original provider registry. Its connection is
an attachment to the already-running SAM server.

## 4. Work through the original source and review journey

First call merchant_samgov_status with an empty object. It lists the configured
aliases, reviewed input labels/SHA values and merchant profiles. Then connect:

~~~json
{"workspace":"fema"}
~~~

Pass that object to merchant_samgov_connect. Its result includes the instance ID,
native source state, original capture tasks and running merchant hosts. Subsequent
calls retain the same alias and native IDs. merchant_samgov_browser opens the
same original industrial workspace.

Every source-changing native action uses:

~~~json
{
  "workspace": "fema",
  "requestId": "saved-operation-identity",
  "expectedRevision": 0
}
~~~

Read the actual current native revision before preparing a new mutation. Persist
the complete request and stable requestId before sending it. The original store
checks its recorded request replay before its revision comparison: exact repeated
input returns the original mutation; a different input under the same request ID
is a conflict. A newly intended edit uses its own request ID and current revision.

### Receive existing original source

For a complete original packet, call merchant_samgov_receive with workspace,
sourceImport and expectedSourceSha256 from the declared input. It delegates to
the original importPacket transaction and preserves the source ID, editions,
objects and complete history.

For a new retained original issued document or previously captured pages, call
merchant_samgov_import with the same input fields plus the current revision and
saved requestId. That call dispatches the source-action file's exact allowed
native action. The existing parser, credential projection, issued-resource
binding and original source metadata remain authoritative.

The original FEMA native operation can therefore finish in its original owner,
then this application receives its completed packet or opens its closed source
workspace. Its already-issued request, source files and capture are retained.
Receiving the completed output does not start another FEMA acquisition.

### Qualify and compare retained notices

Use merchant_samgov_record to page the original edition's notices and
merchant_samgov_notice to open the exact row with source references, issued files,
reviews and change decisions. Source files download with merchant_samgov_file,
kind source, the source ID and the original SHA-256.

merchant_samgov_review_notice records the native status, owner, notes and optional
reviewed deadline against the exact edition/notice. A deadline includes at,
timeZone and reason; at needs an explicit UTC offset and timeZone uses the
original IANA zone validator. A source date lacking its timezone remains a
review item until an operator supplies the supported interpretation.

Use merchant_samgov_compare for the original before/after edition comparison,
then merchant_samgov_review_change for each authored disposition. Comparison
keeps the native latest-observation or received-document coverage. It does not
represent an older observation as newly fetched provider history.

merchant_samgov_save_selection saves the selected original notice IDs and notes.
The returned selection ID/revision is used by original merchants, handoffs and
the opportunity bridge.

### Continue an actual provider capture when needed

merchant_samgov_save_query uses the original query fields and ISO YYYY-MM-DD
dates. GSA's public opportunities API returns the latest active source version,
requires a posted window of at most one year and supports up to 1000 rows per
page. Its offset is a page index; the native transport owns that conversion and
the actual saved cursor. The production contract is maintained at
https://open.gsa.gov/api/get-opportunities-public-api/ .

merchant_samgov_create_capture retains the exact query ID/revision first.
merchant_samgov_capture_run starts or resumes that same capture through the
existing server task owner. Read merchant_samgov_capture_status for the actual
task, progress, retained source and native error. merchant_samgov_capture_pause
asks that owner to pause; observe the actual resulting state before subsequent
work. If the retained capture reaches its selected record capacity, use
merchant_samgov_resize_capture on the same capture and current revision.

merchant_samgov_capture_resources makes the original selected issued-resource
requests. Actual response bytes, unavailable resources and errors remain in the
native source record. Exact capture and source-action recovery uses their
original operation identity.

### Prepare a customer handoff or opportunity project

merchant_samgov_create_handoff freezes a named handoff for the retained selection.
The resulting source revision and original files drive the complete customer
packet and readable reports.

merchant_samgov_prepare_opportunity uses the configured original LGNDX workspace.
It binds the selected SAM notice and successful retained issued-source files to
the existing project. On continuation, preserve projectId,
expectedProjectRevision, selectionId, noticeId and the original request ID.
The native bridge returns the actual project revision and source bindings.

merchant_samgov_prepare_merchant uses a declared profile to prepare the selected
original notices. merchant_samgov_merchant_start/stop operate that exact retained
seller on its original loopback host. merchant_samgov_buyer_review and
merchant_samgov_buyer_prepare preserve the original reviewed offer and accepted
buyer option; the existing buyer account/execution workflow consumes that
preparation.

## 5. Retain, download and reopen the complete delivery

merchant_samgov_export requires a stable requestId, format and exactly one of:

* An original positive revision, optionally with its selectionId.
* An original handoffId.

Formats are portable, html, markdown, notices, reviews, changes and sources.
The native exporter creates the actual bytes. The MCP receiver streams those
bytes into its private customer export directory, hashes them, and atomically
retains the original filename, media type, byte count, source binding and hash.
The complete portable format contains the original retained source and version
history.

An exact repeated export request returns the saved exportId and original
descriptor. It does not regenerate a completed download. If receiving stops
partway through, repeating the original request continues its retained receiving
record against the same workspace and fixed source selection. Completed bytes
whose final receipt was interrupted are verified and adopted in place.

List exports with merchant_samgov_exports. Read one with:

~~~json
{
  "workspace": "fema",
  "kind": "export",
  "id": "RETURNED_EXPORT_ID",
  "expectedSha256": "RETURNED_ORIGINAL_SHA256",
  "offset": 0,
  "limit": 196608
}
~~~

Call merchant_samgov_file with that input. Decode each returned base64 chunk and
append it at the returned offset. Continue using readId, file.sha256 and
nextOffset until nextOffset is null, then verify the received complete byte count
and SHA-256. The maintained retained-file reader releases the descriptor at EOF.
Release an unfinished read explicitly with merchant_samgov_file_release.

After an MCP restart, omit the old process-local readId and open the same
exportId with expectedSha256 and the saved offset. Completed exports can be
listed and downloaded while the SAM Application is stopped.

For a receiving installation, preserve the exact portable file, declare it under
that receiver's own host input alias, start its intended original SAM workspace
and call merchant_samgov_receive at the exact packet hash. Read the reopened
native source and authored history before proceeding. An occupied workspace
retains its existing identity and the native importer applies its original
matching-history rules.

## 6. Recover the same application and request

| Observed result | Continuation |
| --- | --- |
| Native revision conflict | Inspect current source/history. Reuse a recorded exact operation, or prepare the next intended edit with the current revision. |
| Mutating response missing, truncated, too large or invalid JSON | Keep the original code and dispatch unknown metadata. Inspect retained source and replay the same request ID/input through the original native transaction. |
| SAM_APPLICATION_STOPPED | Open the saved Applications operation, observe its current outcome and start/recover that same source directory. |
| SAM_CONNECTION_CHANGED | Inspect the new original start, then connect the same alias to the returned current instance. |
| SAM_INPUT_CHANGED | Keep the selected file edition; review a following exact host input/hash before adopting it. |
| Export request conflict | Use the request's original selection/options. A different intended export receives a new request ID. |
| Interrupted file read | Reopen the same retained export/source SHA and saved offset through the original file reader. |
| Original capture paused or failed | Read that capture's progress and actual provider result, then use its native continuation control. |

MCP disconnect releases that attachment and file reads. It leaves the
Applications-owned server ready for the browser or another authorized client.
MCP shutdown drains its accepted calls. Use the saved Application's Stop when the
native server itself should close.

The host connection contains the native private browser credential. Keep that
file and private Open links in the selected operator session. Publish the intended
source packet/report through the approved customer delivery destination.

## Source integration

The samgov contribution owns its command, SDK exports, Applications provider and
merchant provider. The existing distribution builder includes the same original
SAM subtree and verifies its declared modules. No central tool-name switch,
parallel SAM database or independent capture scheduler is introduced.

The runtime contract remains in
../../distribution/runtime-workspace/APPLICATION_PROVIDERS.md.
The typed provider contract remains in
../../../../stellar-forge/mcp-merchant-operator/MERCHANT_PROVIDERS.md.
Original SAM domain semantics and source examples remain in README.md,
SOURCE-CONTRACT.md and workspace.d.mts.
