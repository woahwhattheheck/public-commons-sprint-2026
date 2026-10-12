# Matomo saved Applications and native agent workspaces

This component brings the original Matomo report workspace into the maintained
Applications and merchant MCP host. The source capture, edition database,
review history, SQLite queries, SF82 releases and Python customer receiving all
remain in one original private workspace. The browser and agent call that same
model; they do not acquire independent copies or create another payment path.

For source setup and report semantics, read the
[Matomo operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/matomo/README.md).
The reporting and WordPress modes are explicit source choices. Processed reports
are Matomo's processed output, including its archive limits and summary behavior.
Traversing every returned subtable does not establish the raw event population.

## Prepare the existing source workspace

Choose the operator-owned private source declaration and original workspace.
The original CLI can initialize it without capturing a report:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/matomo/cli.mjs \
  state --create \
  --source /private/matomo/source.json \
  --workspace /private/matomo/workspace
~~~

On an existing workspace, omit --create and --source. A completed initialized
workspace whose database is missing fails reopen; it does not silently create
a new database under the saved identity. Retain the original source mode,
endpoint, site context and environment references. Actual credentials belong in
the host environment or its private environment file. They are not tool arguments,
source-controlled examples or retained catalog fields.

Python customer receiving uses the existing Python executable selected by the
operator. The Matomo handover composes the original SF100 DatasetDelivery and
SourceFiles implementation. Node uses the selected maintained runtime. This
component does not install a separate interpreter or copy another source engine.

## Saved Applications workflow

The source contribution is
stellar/scf-starforge-20261009/distribution/contributions/matomo.json.
It declares the original source CLI, the source-bound saved launcher, public
imports and the applicationProviders entry. The selected distribution must
contain both the Matomo component and the maintained source-owned Applications
loader.

In the original Applications interface:

1. Select **Matomo reports and delivery** (kind matomo-authoring).
2. Select the existing canonical private workspace directory. Set the optional
   Python executable and host environment file only when that workspace needs
   them. An HTTP loopback source requires the explicit allowLoopbackSource
   setting; the normal source mode uses HTTPS.
3. Review and save the original launch. The plan pins the workspace identity and
   the complete original Matomo source files. It does not pin mutable database
   contents as if they were an immutable edition.
4. Review Start and start through the existing Applications runtime. Its normal
   runtime/resource admission, operation record and process ownership apply.
5. Open the actual authenticated browser URL returned by that original process.
   Continue the same report, edition, publication or receiving identity there.
6. Stop through the owning Applications record. Reopen the same saved application
   when continuing; inspect an interrupted operation before using its native
   recovery command.

The launcher hashes the original settings, source declaration, initialization
record and database device/inode identity, as well as its selected source closure.
It checks them again at open. The original private directory and writer lease
remain authoritative. The startup observer verifies the real loopback listener
and authenticated /api/identity response against the original workspace,
process and listener instance. A printed URL by itself is not accepted.

The command matomo-workspace is the saved launcher; matomo-source retains the
original operator CLI. Direct use of the saved launcher requires the exact
reviewed --workspace-identity, --source-directory and --source-sha256 arguments.
Use the Applications preparer to produce them instead of copying a stale launch
command from another runtime.

## Configure the merchant agent host

Only host configuration chooses filesystem paths, environment files and source
access. A client chooses a declared alias. The private connection JSON uses:

~~~json
{
  "schema": "stellar-forge.matomo-workspace-connection.v1",
  "workspaces": {
    "analytics": {
      "label": "Retained analytics reports",
      "directory": "/private/matomo/workspace",
      "python": "/private/runtime/bin/python",
      "environmentFile": "/private/matomo/environment.json",
      "allowLoopbackSource": false
    }
  }
}
~~~

Only directory is required within each workspace declaration. Python and
environmentFile can be omitted when the existing host environment already
provides them. The file must be a private regular file. An environment file is
a private JSON object of environment-name/string pairs; the reader stores and
rechecks its hash, without returning the values in tool summaries. Each canonical
workspace has one alias in a connection. Opening rechecks the retained original
identity and acquires the original model's lease.

The source leaf exports the following maintained integration points:

| Export | Purpose |
| --- | --- |
| readMatomoWorkspaceConfiguration(path) | Read and bind the original private host declarations. |
| MATOMO_WORKSPACE_CONNECTION_SCHEMA | Versioned connection schema above. |
| MerchantMatomoWorkspaces(config) | Native owner with summary, call(name,args) and close(). |
| matomoWorkspaceTools(tool) | Complete typed tool metadata using the host's existing tool helper. |
| initializeMatomoWorkspaceMerchant(options) | Bind/reopen the original source workspace and release store in the maintained merchant host. |

The normalized host field is matomoWorkspaces. This leaf has no publishers
dependency: the original Matomo model already opens and serializes its original
SQLite publisher. Its source-owned descriptor is
providers/matomo-workspaces.mjs; the existing contribution declares it as
merchantProviders.matomo-workspaces. It uses the maintained provider loader,
configuration reader, lazy owner and shutdown lifecycle. An older installed cut
must include this declaration before it can advertise the Matomo tool family.

Save one private setup JSON after saving the connection above:

~~~json
{
  "directory": "/private/matomo-agent",
  "connection": "/private/matomo/connection.json",
  "workspace": "analytics",
  "name": "Retained Matomo operations"
}
~~~

Run the original source-contribution commands:

~~~sh
starforge merchant-providers inspect matomo-workspaces
starforge merchant-providers init matomo-workspaces --options /private/matomo/agent-setup.json
~~~

The initializer returns the original host configuration path
/private/matomo-agent/merchant-mcp.json. Select that path with the installed
merchant MCP host's normal configuration option. Only directory and connection
are required; workspace is required when the connection has multiple aliases.
The selected alias binds the host's common releaseStore to that original
workspace's merchant/releases. All other aliases keep their own native Matomo
release and report history.

Setup validates the original workspace identity and takes its existing native
lease only if it must initialize that same SF82 release store. It neither opens
a report nor dispatches a provider request. Keep the private host directory
outside the selected original workspaces. Its retained setup binding and final
configuration use the original create-only atomic writer. Repeating the same
setup reopens it; different paths, identities or settings under that host
directory fail with a retained-configuration conflict. An interrupted incomplete
setup can continue with the same options after the original owner is closed.
The original report workspace remains the sole data owner.

The leaf also exports initializeMatomoWorkspaceMerchant(options), used by that
same provider hook. The public owner can be called directly by an equipped
Node application:

~~~js
import {
  readMatomoWorkspaceConfiguration,
  MerchantMatomoWorkspaces,
} from './stellar-forge/mcp-merchant-operator/matomo-workspace.mjs';

const matomoWorkspaces =
  await readMatomoWorkspaceConfiguration('/private/matomo/connection.json');
const owner = new MerchantMatomoWorkspaces({matomoWorkspaces});
try {
  const selected = await owner.call('merchant_matomo_open', {workspace: 'analytics'});
  const status = await owner.call('merchant_matomo_status', {workspace: 'analytics'});
  // selected.instanceId is the current workspace instance; status.native.revision
  // is the current original journal revision. Read retained IDs from that state.
} finally {
  await owner.close();
}
~~~

The same host can expose these calls through its existing MCP transport. This
module adds no transport, alternative resource controller or external callback.

## Work with exact original identities

merchant_matomo_workspaces lists configured aliases without opening a workspace.
merchant_matomo_open opens the original model and browser and returns the current
instanceId, browserUrl and native state. Status preserves the original journal
revision and original operation state.

Every mutation requires:

~~~json
{
  "workspace": "analytics",
  "workspaceInstanceId": "the UUID returned by this open",
  "operationId": "one-stable-original-operation-id",
  "expectedRevision": 12
}
~~~

Add the operation-specific fields described by its tool schema. Native IDs use
1–96 ASCII letters, digits, dot, underscore or hyphen, beginning with an
alphanumeric character. The actual model validates the entire request before it
records or executes the original operation.

Retain the exact input object and operationId before dispatch. After a lost
response, call merchant_matomo_operation with that same ID. A COMPLETE record is
the existing result. A failed or interrupted record is not evidence that a
provider, publication or process effect never happened. Read its saved source
boundary and select the corresponding native resume/recover operation, using a
new explicit recovery operationId when the original journal requires it. Do not
change fields under an existing operationId.

The workspaceInstanceId is different from the seller instanceId returned by
release_start. release_stop requires the exact seller identity and the current
workspace identity. Closing a workspace requires its own current instanceId.

### Report capture and correction

Use catalog summary and paged reports/segments to inspect the observed native
metadata. A report selection binds its exact retained report ID and fixed
parameters, one literal period/date, language, segment and actual source limits.
Subtable mappings use the discovered native child action or explicit reviewed
rules. A catalog's segment metadata does not create permission to query a segment.

Capture returns the accepted source requests and retained subtable structure.
Rows preserve native value kinds, report identity, original response/source row
and parent context. Native number strings, null and absent fields are distinct.
The provider's processed-report transformations remain disclosed in the edition.

A stopped capture continues through capture_resume against that same ID.
Increased limits or corrected subtable rules require their explicit note.
Previously accepted native responses are retained and are not fetched again.
edition_build or edition_resume then creates the immutable typed database,
source-file inventory and source-linked report rows.

Review an edition against its exact editionSha256. Use approved or
changes_requested and a named reviewer/note. A correction is a new retained
decision or edition, not an overwrite of original response bytes.

### Edition comparison

comparison_start takes exact left/right edition IDs and explicit field/path/report
selectors for keys and compared fields. Native-kind comparison is the default;
decimal equivalence is selected deliberately. Duplicate and invalid keys remain
findings. They are not silently collapsed into a one-to-one match.

Read findings with merchant_matomo_comparison and its original offset/limit/total
cursor. Decisions bind the exact comparison manifest hash and finding ID; '*'
can select the full finding set deliberately. Native decision values are accepted,
follow_up and changes_requested. The complete comparison JSON is available
through artifact_read; full findings JSONL also remains available in the original
browser. Tool response paging does not truncate the retained comparison.

### Original merchant and SF82 release

merchant_configure creates the original SQLite report queries for an approved
edition. Its three public resources are reportRows, reportRow and sourceFiles.
The complete original compiler checks merchant terms, public input and result
schemas before allocating the merchant configuration.

A merchant name is 1–32 printable ASCII characters, including spaces. The
descriptor origin is canonical HTTPS and passes the original public resource URL
rules. An internal evaluation may use a reserved descriptor such as
https://matomo-evaluation.example; this is metadata, not evidence of a deployed
TLS service. Any unpaid local operation uses the actual runtime-bound loopback
URL returned by SF82. Retain that distinction.

Payment network, asset, payTo and amount come from the operator's original
configuration. Source review or a locally finalized dataset does not establish a
payment or authorization to redistribute analytics data. No payment credentials
are created by this integration.

Use merchant_save with the exact current draftRevision to correct the original
draft. Native preflight checks the corrected draft before its mutation.
merchant_preview invokes one selected original read-only SQLite query.
package_export retains the native package manifest. If an export response is
lost, package_recover inspects the same retained package identity.

release_stage uses that exact package, a selected release ID, label and native
runtime settings. release_diff and release_select inspect and choose the original
SF82 state at its current generation. release_start returns the original process,
mode and bound URL. A CHALLENGE_ONLY listener advertises an unpaid challenge;
starting it is not a buyer purchase. Stop only its exact original instance.
Selection/rollback and runtime state remain in the original release store.

### Full dataset publication and customer receiving

delivery_prepare accepts exactly two projections:

| Projection | Retained population |
| --- | --- |
| report-rows | The complete edition's report rows through the original named-query publisher. |
| source-files | The complete original source inventory and chunk rows, including native responses and typed report materialization. |

A preview limit does not limit the full publication extraction.
delivery_review uses the original publisher review. Initializing an absent
target requires initialize:true. A later target binds its exact expectedSnapshot
and integer expectedTargetRevision. delivery_publish uses the original reviewId;
that publisher reconciles an existing unknown publication before considering
another effect.

handover_prepare requires a source-files delivery in REVIEWED or PUBLISHED state,
a named reviewer and the note authorizing the local operator-owned dataset read.
Its optional page limit is 1–12, default 8. It composes original SF30 dataset pages,
SF100 append/finalize and the original Python DatasetDelivery. Every page retains
the exact operator request, response and receipt behind the original evidence
hash. A missing local receipt is explicitly reconciled from its retained response.

receiving_receive creates a receiving record for that completed handover.
receiving_resume and receiving_reopen keep the same original archive/source
identity. The original SourceFiles consumer verifies native typed rows, chunk
geometry, complete inventory and all hashes, then restores the source files.
The SF100 source format and native paymentStatus remain unchanged; local hashes
or source HTTP success never become a synthetic paid receipt.

Read customer rows with merchant_matomo_receiving_rows. Its page limit is at most
100; source/edition pages allow at most 250. Both retain the original complete
population and native next offset.

## Portable retained-file reads

merchant_matomo_artifact_read selects a native artifact by kind and original ID,
never by a client-supplied path. Kinds include capture, edition, database,
comparison, delivery, handover and source. Delivery variants are csv, config and
manifest. Handover variants are archive and scan.

The original RetainedFileReads implementation verifies the opened file hash and
descriptor, serves bounded base64 byte ranges, and owns the read handle. Large
native files are streamed from their immutable descriptor rather than copied
whole into memory or another temporary file. The reader's existing four-read
limit and maximum chunk size apply.

The first response contains readId, file.sha256, file.bytes, offset, bytesRead,
data and nextOffset. Preserve the exact file hash and append decoded data only
at the returned offset. Every continuation repeats expectedSha256. The final
response has nextOffset:null and releases its descriptor.

After a process restart or explicit artifact_release, open a new read with the
same expectedSha256 and saved byte offset, omitting the old process-local readId.
A changed file fails the expected-hash check. After the complete download,
independently verify its byte count and SHA-256 before giving it to the original
customer receiver.

Status, cancel, close and read-release remain controls over the original owner.
Close first asks that model to abort/drain accepted work, then closes its merchant
processes, source client, database and writer lease. If a cleanup step fails, the
same instance and unfinished ownership remain available for explicit close retry;
already completed cleanup is not repeated. New mutations stay disabled while
that close is pending.

## Source and operational boundary

The core native operation retained 89 actual report rows across 14 native tables,
15 responses, 57 source-file chunks and an eight-page original SF100 delivery.
Its Python customer receiving/reopen preserved the original population and source
hashes. The initial three-route merchant package is exported. At the source
checkpoint used for this following integration, release staging reported actual
filesystem exhaustion and cleaned its incomplete snapshot; no staged release,
seller start or unpaid HTTP operation was asserted.

Those retained native inputs support the one continuing Applications/agent and
customer adoption. Reusing this work does not require another Matomo source read,
buyer purchase or recreated report population. Consult the original operation
handoff for the current release result and exact installed source cut.
