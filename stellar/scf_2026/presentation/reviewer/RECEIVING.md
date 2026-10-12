# Operate the original SCF purchase

Receive the completed MySQL purchase shown in the SCF #46 film, open it in the
maintained Buyer console, inspect its exact query and payment record, download
the complete result, and hand the received work to another installation.

This is the original completed case
**scf-hpd-native-mcp-mysql-b028-20261011**. Its two recorded quote IDs and original
statuses remain intact. The receiving command uses the same SqliteQuoteStore,
McpResultStore and result-import API as the original recorder. The console opens
with signing and network observation disconnected.

## Install and receive

Use the maintained merchant distribution whose manifest includes the
**grant-demo** command and the **presentation/reviewer** component. Follow its
installation guide for Node 22.16.0 or later and the declared optional MCP
feature dependency, @modelcontextprotocol/sdk 1.32.1. The package's original
feature check verifies that dependency before opening the Buyer console. No MySQL server, wallet, funded
account, Chromium or video renderer is needed to receive and read these saved
records.

After installing that archive in your selected application directory:

~~~sh
umask 077
reviewer_parent="$HOME/starforge-review"
mkdir -p "$reviewer_parent"

npx --no-install starforge doctor --feature mcp
npx --no-install starforge grant-demo inspect

npx --no-install starforge grant-demo receive \
  --dir "$reviewer_parent/original-purchase"

npx --no-install starforge grant-demo open \
  --dir "$reviewer_parent/original-purchase"
~~~

The command prints the original console URL, the private source-review HTML path
and the private connection.json path. In an interactive terminal it also prints
a fresh access code. Open the console and enter that code. When stdout is
redirected, read the code from connection.json using your local editor; it is not
included in the normal JSON log.

An operator may supply an existing private access code through
**--token-env NAME**. The name is selected locally, and its value remains in the
operator environment and private connection file. The receiver never loads an
inherited buyer operator or wallet module.

The source-path command is also supported:

~~~sh
node stellar/scf_2026/presentation/reviewer/cli.mjs receive \
  --dir /private/reviewer/original-purchase
~~~

For development against an already installed native runtime, add
**--source-root /absolute/path/to/that/package/source**. This selects trusted host
code, not anything inside the received packet. Ordinary installed use resolves
its own original source tree automatically.

## Walk through the actual application

1. Choose **Quote history** in the original Buyer console.
2. Open **c2a5d4c5-e2c3-4d50-abe2-3edb4c8fa36e**. Its seller status is
   CONFIRMED_BY_SERVER and its original attempt count is one.
3. Expand **Complete invocation and arguments**. The original hpd_projects
   call selected constructionType Preservation and minimumUnits "20".
4. Read **Stellar transaction observation**. The retained original SF86 result
   is TRANSFER_MATCHED for transaction
   50d61d1102bfcf960af44171e5248e0899ed6d99cec1951a62075f9a65a6cbed,
   testnet ledger 5145195 and 50,000 stroops, or 0.005 testnet XLM. This is the
   previously recorded observation, not another RPC observation.
5. Select **Read complete saved result**. The Structured data tab exposes
   **rows · 100 records**, with all 14 columns. Complete JSON and
   **Download complete JSON** return all **53,468 bytes**, SHA-256
   **4c22f8a26d48156c3e07543328b62ca6f993ce60856166d6805dc0660d9acb8d**.
6. Open the earlier quote
   **34069905-cb2f-49b7-8e44-46f0179de3f8** separately. Its original seller
   status is INDETERMINATE, its attempt count remains one, and the retained
   transaction observation is FAILED. Its complete 4,733-byte MCP error result
   remains available. Receiving the record does not change its settlement or
   spending classification.

The local review.html provides the original SQL and query bounds, source
documents, links to both exact response files, the original source checkpoint
capture and the same complete portable packet. The normal Buyer console owns
the interactive quote, result and payment views.

## Interpret the data correctly

The source is NYC Housing Preservation and Development's
[Affordable Housing Production by Building](https://data.cityofnewyork.us/resource/hg8x-zxpr.json),
retained with a September 30, 2026 source vintage. The original acquisition
selected Queens project starts after January 1, 2014.

Each returned row represents a building in a recorded development or
preservation project. Unit totals describe project events. They are not a
current vacancy count, and repeated building or tax-lot activity must not be
silently deduplicated into that interpretation.

The selected named query used a 100-row cap. The complete saved response
explicitly retains truncated: true and valueEncoding: mysql-exact-scalars.
Complete delivery means the whole returned MCP result, including this bound;
it does not mean every source row was purchased. Exact scalar strings, source
row IDs, coordinates and original-row hashes remain in that result.

The retained merchant source also describes hpd_totals. That is part of the
original merchant's query inventory; this selected purchase exercised
hpd_projects. Historical loopback endpoints and environment-variable names are
source context. The reviewer launcher does not restart the merchant, connect
to its private database or refresh its data.

## Export and reopen the same received work

Stop the open command with Ctrl-C. Export uses the original quote store's
writer lease to obtain a coherent closed view.

~~~sh
npx --no-install starforge grant-demo inspect-workspace \
  --dir "$reviewer_parent/original-purchase"

npx --no-install starforge grant-demo export \
  --dir "$reviewer_parent/original-purchase" \
  --out "$reviewer_parent/received-purchase.json"
~~~

Export creates the chosen file once and prints its exact bytes and SHA-256.
It includes every original packet document plus the native receiving
checkpoints from this installation. The original quote IDs, terms, attempt
counts, seller statuses, retained observations and full response bytes are
verified before publication. Runtime access codes and connection files are
excluded.

Transfer that exported JSON file to the selected receiving installation.
Inspect it and use the exact SHA-256 printed by the completed export:

~~~sh
npx --no-install starforge grant-demo inspect \
  --packet "$reviewer_parent/received-purchase.json"

npx --no-install starforge grant-demo receive \
  --dir "$reviewer_parent/reopened" \
  --packet "$reviewer_parent/received-purchase.json" \
  --sha256 EXPORTED_SHA256

npx --no-install starforge grant-demo open \
  --dir "$reviewer_parent/reopened"
~~~

Reopen the same successful quote and download its complete JSON again. The
recorded transaction and 53,468-byte response remain the same. Each receiving
installation assigns its own private result-file paths through the original
result-import API.

Repeated receive with the same directory and exact packet verifies and returns
the completed receiving state. It does not import another copy of a saved
result or reset the native quote. A different packet needs a different chosen
directory. Existing unrelated contents are preserved.

## Source and receiving history

The original checkpoint capture in source/quote-history.json comes from the
completed original payment-inspection workspace. It retains the exact native
checkpoint sequence, status, phase, dispatch marker, attempt count and timestamp
for both quotes.

The receiving store records its own local import checkpoints. Exports append a
separately named receiving/history-UUID.json with that installation's actual
native checkpoints. Repeated exports preserve the earlier source and receiving
files. The source guide distinguishes these stages; it does not manufacture
earlier SQLite transitions in a newly received store.

This packet is the completed public demonstration. Other quotes or later
customer operations belong to the original customer backup and recovery
workflow. The receiving exporter detects additional quotes and does not
mislabel a partial public packet as a backup of that customer's whole system.

## Retained input and local interruption

Files are checked before receiving: packet identity, per-file bytes and digests,
complete native MCP result shape, original preview and receipt binding,
unchanged quote identity and the retained original observation. The result
store remains responsible for native completion manifests and saved-file
verification.

A partial receive keeps the immutable input and any completed original result
files. Repeating the same receive follows the original retained-result
recovery/import API. Native storage errors are returned with their original
codes; incomplete files and reservations remain available for the original
[RESULTS](../../../../stellar-forge/mcp-paid-agent/RESULTS.md) recovery workflow.
No error is converted into another purchase. A lost response after completion
returns the same saved receiving receipt on replay.

## Programmatic opening

The maintained package exports the same interface at
**@tokenjunkielabs/starforge-merchant/grant/demo**:

~~~js
import {
  inspectGrantDemo,
  receiveGrantDemo,
  inspectGrantDemoWorkspace,
  startGrantDemo,
  exportGrantDemo
} from '@tokenjunkielabs/starforge-merchant/grant/demo';

const prepared = await inspectGrantDemo();
const received = await receiveGrantDemo({directory: privateReceivingDirectory});
const application = await startGrantDemo({directory: received.directory});
try {
  showOriginalConsole(application.consoleUrl, application.accessToken);
} finally {
  await application.close();
}
const reopened = await inspectGrantDemoWorkspace({directory: received.directory});
const exported = await exportGrantDemo({
  directory: received.directory,
  output: privateCreateOnlyExportPath
});
~~~

The returned access token is a host-side capability. Do not put it in the public
packet, a URL query, screenshots or application logs. The ordinary CLI prints
only the connection-file path in noninteractive JSON output.

## Maintainer source capture

capture.mjs is the source owner's explicit packaging command. It reads the
original completed operation and inspector, selects their existing closed
quotes with the original read-only store, reads the exact saved result files,
and checks the original merchant review and file hashes. The output includes
only those selected public demonstration records and descriptors; it does not
scan or copy a wallet or operator directory.

~~~sh
node stellar/scf_2026/presentation/reviewer/capture.mjs \
  --quote-dir /private/original-inspector/buyer-workspace \
  --operation /private/original-purchase/operation.json \
  --inspection /private/original-inspector/native-result.json \
  --merchant-package /private/original-purchase/mysql-mcp-product \
  --out /private/source-capture/hpd-purchase.json
~~~

The original source-owner files remain unchanged. The packaged native
inspection and complete result files are exact retained bytes. The source
context and operation summary identify their JSON projections and the original
file digest. Local result-file paths are assigned only during receiving.

The original [film](https://github.com/woahwhattheheck/public-commons-sprint-2026/releases/download/scf-presentation-20261011/stellar-forge-scf46-presentation.mp4)
and [editable production source](../PRODUCTION.md) remain the separate finished
presentation. Receiving adds no purchase to the canonical grant transaction
register and changes none of the requested future-work hours or budget.


### Interrupted first receive and console startup

If first packet publication stops before packet.json is installed, repeat the
same receive command. The receiver accepts only its private, named staging files
whose retained bytes match a prefix of that exact selected packet. It preserves
those partial bytes and refuses unrelated contents or a different packet.

On console shutdown or failed startup, the connection record is deactivated
while the original native writer lease remains held. If a full disk prevents
rewriting that small record, the receiver removes its own stale connection file;
the original quote database, response files, packet and checkpoints stay intact.
An exported packet is bounded by its actual encoded size, so a successful export
remains readable under the same receiving limit.

## Completed receiving operation

The completed receiving operation used the maintained installed source
`0.1.0-source.ge28755f20dd4`, Node 24.19.0 and the original MCP SDK 1.32.1.
The same original quote and result stores received this packet, repeated receive
without changing the receipt or local checkpoints, and opened the maintained
Buyer console. Authenticated SDK requests read both full saved results; an
unauthenticated MCP request returned 401.

The original McpSavedResult.saveAs exported the complete 53,468-byte success.
The full received packet then exported with its actual receiving history and
reopened in a second selected private directory through the same console and
native SDK. Both original quote statuses, terms, retained observations and
one-attempt counts remained exact. Both console listeners closed, with their
private connection records inactive and access tokens removed.

This operation performed no merchant call, new transaction, signing request or
new chain observation. It exercised the installed native HTTP application and
file interfaces; the earlier film supplies the actual browser interaction.
The included source packet remains the complete original public demonstration.
