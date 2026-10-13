# Carbon customer-agent workspaces

This source-owned Merchant provider operates the existing Stellarcarbon customer
desk and GiveCredit donor desk. Browser and agent share their original saved
sources, customer or donor mappings, funding decisions and statement versions.
The provider adds no second carbon, payment or grant accounting engine.

## Select the original applications

Install the full source distribution containing this contribution and the existing
Stellarcarbon/GiveCredit contributions. Node 22 or later and the original native
flock support are required. Public ledger acquisition uses the existing
@stellar/stellar-sdk ^16.3.0 peer. Opening sources, reviewing already retained
records, creating statements and exporting files do not acquire chain data.

Create a private connection JSON (0600) using the supplied
connection.schema.json. Every application directory and export directory must be
canonical, operator-owned and private (0700). Select actual workspace IDs from
the original CLI state/startup; the values below are labels to replace:

~~~json
{
  "schema": "stellar-forge.carbon-customer-connection.v1",
  "workspaces": {
    "customer": {
      "kind": "stellarcarbon",
      "directory": "/absolute/private/customer",
      "workspaceId": "ORIGINAL_CUSTOMER_WORKSPACE_ID",
      "mode": "owned",
      "files": {
        "current-source": "/absolute/private/current-carbon-edition.json"
      }
    },
    "donors": {
      "kind": "givecredit",
      "directory": "/absolute/private/donors",
      "workspaceId": "ORIGINAL_DONOR_WORKSPACE_ID",
      "mode": "owned",
      "files": {
        "registry": "/absolute/private/original-registry-edition.json",
        "ledger-options": "/absolute/private/original-capture-options.json",
        "checkpoint": "/absolute/private/original-ledger-checkpoint.json"
      }
    }
  },
  "destinations": {
    "customer-received": "/absolute/private/customer-received",
    "donors-received": "/absolute/private/donors-received"
  }
}
~~~

The destination parents must already exist privately. The destinations themselves
are new create-only directories. Each alias becomes an independent owned
workspace after its original receiving operation finishes.

Managed mode selects the actual current Applications URL in an additional url
field. It verifies the loopback health schema, directory and original workspace
identity. It requires this complete source edition's customerAgent:v1 capability.
Owned mode starts the maintained Node server in this process, on an available
loopback port, under its original workspace lease. Do not attach a second owned
writer to a workspace already opened by Applications; select managed mode for
that existing listener. The integration uses the original local HTTP boundary.

The existing host's configuration input is carbonCustomerConnection. Preserve
other provider fields when adding it. A new private host can be initialized through:

~~~sh
stellar-merchant carbon-customer-agent init \
  --directory /absolute/private/carbon-agent-host \
  --connection /absolute/private/carbon-connection.json
~~~

The initializer returns the existing Merchant host configuration and reopens its
own exact setup after interruption. An explicit --release-store selects an
already maintained release store. It preserves completed configurations and
requires a new setup directory for different original intent.

Run the installed Merchant MCP host against the returned merchant-mcp.json using
its maintained startup. The provider registry discovers merchant_carbon_* from
this contribution without hard-coded central registration.

For a native, persistent JSON-line caller:
~~~sh
stellar-merchant carbon-customer-agent stdio \
  --connection /absolute/private/carbon-connection.json \
  --exports /absolute/private/agent-exports
~~~

Each input line is {id,tool,args}; each result preserves its id. Keep the process
open while operating its native workspaces. EOF or a signal drains owned
services. This JSON-line entry is useful for native receiving; the existing
Merchant host remains the MCP transport.

## Original customer workflow

1. Call merchant_carbon_workspaces and merchant_carbon_open for customer. Call merchant_carbon_contract for the full native input schemas. Record
   its instanceId, original workspaceId and native.value.revision.
2. Import current-source using format source, a descriptive source label, a new
   stable requestId, the observed revision and operator actor. A complete source
   edition preserves every original table, HTTP response and coverage declaration.
   backup-files accepts one JSON object of original NDJSON strings. retained
   selects the bundled seven-table April 2026 source. Select exactly one source
   format and file.
3. Read state and contributions. Use the returned original edition ID and native
   cursor. Continue until nextCursor is null. TOIDs remain strings, even when
   they look like integers. Source tables use offset/limit and nextOffset.
4. Save customer, project and assignment through merchant_carbon_save. A project
   names an operator-owned reporting group. A TRANSACTION, RECIPIENT or FUNDER
   assignment links exact original records to that group. Updates include the
   original id and expectedVersion. The original engine resolves transaction,
   recipient and funder precedence and reports conflicts.
5. Preview a statement, then save action statement. Its value includes title,
   editionId, customerId/projectId as selected, fromDate and beforeDate.
   The window includes fromDate and excludes beforeDate. Saving produces an
   immutable statement version; a correction creates another version and keeps
   earlier versions independently readable.
6. Export statement.json, statement.html, contributions.csv, allocations.csv and
   retirements.csv using the exact statement ID and explicit version. Export
   the complete source and original individual response/table files too.
7. Export handover, receive it into customer-received, open that returned alias,
   inspect all source IDs and statement versions, edit a customer there, then
   close and reopen it. The original customer workspace remains independent.

The actual retained source already demonstrates why dates matter: November 2025
contains a 1.177 CARBON contribution. The April 2026 edition reports 1.019
allocated and 0.158 remaining; the later source edition completes that 0.158
through a July-dated certificate. The contribution-period statement includes
all allocations known at its selected edition, while its retirement register
uses each certificate's own date. An earlier finalized:false allocation can
belong to a now fully retired contribution. All original fills remain included.

## Original donor and initiative workflow

Open donors. Receive the original registry edition with format source or a JSON
object of original exported table strings with registry-files. Receive the
original ledger edition or capture it from ledger-options. Existing registry API
credentials stay only in that configured private source file and are omitted
from collector source editions and tool output.

To carry the exact customer source into GiveCredit, export it from customer and
call import in donors with format carbon-source, sourceWorkspace customer and
sourceExport equal to that original export ID. The source workspace must be
open. This transfers the complete original file, with its bytes and SHA retained,
through the existing GiveCredit carbon importer.

Read choices, donations, donation, transfers, transfer and pools. The original
engine joins a receipt's payment hash to the source transaction, then selects the
successful network/envelope/operation or event, asset and amount. A separately
minted NFT identifier is not the donor payment identity. Older ambiguous records
remain explicit until an operator saves a payment-link.

Preview allocations before saving. PROPORTIONAL_GROSS weights use original
gross donor amounts, with separately verified provider-funding capacity.
FIFO_GROSS requires actual native order or an explicit operator ordering.
EXPLICIT keeps the selected atomic allocation. Original vendor fees cannot
be reused as provider capacity. Source-observed provider/vendor identities and
call ordering determine payout classification; unresolved classification needs
an explicit reviewed decision.

Preview and save each bridge using the exact payout, allocation and sinking
transaction. The saved bridge freezes its allocation version and complete
allocation snapshot. Later allocation edits do not silently change that bridge.
Review and save the bridge again to adopt a newer allocation version.

A donor statement selects REGISTRY_CREATED or LEDGER_CLOSED explicitly, its
original editions, organization/initiative or donor, and the half-open period.
The native statement keeps registry amounts, actual token payments, pool
funding, carbon attribution and dated certificate allocations distinct.
Export all nine original files:

- statement.html and statement.json
- donations.csv and payments.csv
- payout-funding.csv
- carbon-contributions.csv and carbon-allocations.csv
- retirement-register.csv and receipt-records.csv

The payout file includes allocation IDs and versions so a current allocation and
a frozen bridge revision are not mistaken for separate cash transfers.
Receive the complete handover into donors-received and operate it independently.

## Captures, checkpoints and uncertain returns

Every mutation has an explicit requestId, revision and actor. The agent retains
its exact logical input, complete original input file and native response before
returning. Reusing an ID with changed input is rejected. An uncertain return is
continued through merchant_carbon_operation and merchant_carbon_resume.

The original API mutation journal remains authoritative. Source import and saved
record mutations replay the same native request. A capture is asynchronous:
inspect merchant_carbon_capture command status. The status contains its original
request ID. Resume observes the same running capture rather than starting
another; after interruption it sends the same original options with the native
resume control. The collector revalidates its checkpoint selection. If its
native import already completed, resume returns that original operation.

GiveCredit checkpoints use the existing bounded-memory store. checkpoint import
accepts a complete original JSON checkpoint and validates registry versus ledger
before committing. checkpoint export returns a complete portable checkpoint;
the object-store layout stays internal. Full source/history selection is retained.
An older checkpoint's historical window is not replaced by a current retention
boundary merely to make acquisition succeed.

GiveCredit supports explicit capture stop. Stellarcarbon's original server ties
interruption to its owner; closing an owned service stops its capture and keeps
the checkpoint. A managed attachment detaches and leaves Applications in charge.
Do not close another owner's active application to interrupt its work.

Each exported response has an exportId, exact byte length, SHA256 and type.
Small JSON responses include value inline. Larger responses return value:null
and their complete retained file. Read using merchant_carbon_file_read with the
same export ID and expectedSha256, exact next offset and at most 196608 bytes.
Release its readId when done. After an agent restart, reuse the export ID,
SHA and offset without an old readId. No source record is truncated to fit a
tool response.

Receiver intents bind exact original handover bytes and the configured new
destination. Interruption after native create is reconciled against the full
original received state; a different or edited unacknowledged receiver is
preserved for explicit review. Once acknowledged, the receiver can be edited and
reopened under its own identity. Agent source/export journals stay in the
configured private exports directory; include that directory with the complete
native receiving archive when transferring operational continuation.

## Original service invoice join

A Stellarcarbon customer can reference its original merchantCustomerId. Save a
statement after that binding, then use invoice with statementId,
statementVersion, agreed decimal amount, currency {code,scale}, issueDate and
dueDate. The original receivables controller creates or recovers its draft and
links it to the saved statement. The receiver never invents an accepted payment.

Owned mode requires accountingDirectory, accountingWorkspaceId and
accountingSourcesSha256 from the original maintained accounting binding.
Managed mode uses the accounting selection already owned by Applications.
The original receivables and payment-plans URLs remain available in state.

## Source and lifecycle

The new component and contribution are additive. The original browser routes,
native CLIs, application providers and statement engines remain the original
product paths. Full-source API import/export, operation lookup, capture request
identity and explicit resume are the small API joins added here.

Each close requires the currently returned instanceId. The provider serializes
mutations per original workspace while source status/stop can run independently.
It drains its owned file descriptors and services. Managed attachments detach
without shutting down Applications. Current native receiving source selections
remain pinned until their owner explicitly receives this later complete edition.

## Operate one complete original-source receiving journey

Run the installed `carbon-customer-agent-receiving` command, or the complete source module:

```sh
node stellar/scf-starforge-20261009/partners/carbon-customer-workspaces/receiving.mjs \
  --source /private/original-stellarcarbon-edition.json \
  --output /private/new-carbon-agent-receiving \
  --from 2025-11-01 --before 2025-12-01
```

This focused programme accepts a complete original Carbon edition up to 8 MiB; the production agent's streaming intake and exports retain their separately declared native limits. Choose an unused output directory under an existing private operator-owned parent. The source file is read without modification. The receiving operation creates the two original workspaces, imports the whole original edition, derives a named operator group from a recorded recipient, saves two statement versions and compares the first with its preview. It deliberately loses one real completed statement response and then recovers that same native request. It downloads and byte-checks all five customer statement files and the complete edition, imports that edition into the donor desk, receives both complete handovers into independent workspaces, edits them and closes/reopens both stores. It retains the complete connection, request and export journals, files and receiving result under the chosen output. It uses the original source's contribution and retirement dates and does not create ledger or registry observations.

The complete programme is an operator receiving path. A successful `receiving.json` records its actual native results. The source publication's isolated JavaScript semantic check does not substitute for running this HTTP/filesystem journey on the selected native host.
