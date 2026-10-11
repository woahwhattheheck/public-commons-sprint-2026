# Object buyer workspace

Select a merchant's whole or chunked file, review its request plan, operate the original
buyer, retain completed parts through interruption, and download the assembled
file from one private browser workspace. Complete the original purchase records,
retain their native receipts and reopen them independently of the delivered file.

This workspace uses the original `object-session.mjs`, `object-description.mjs`
and `object-report.mjs` APIs. Each request remains an original SF88 inbox job with
its original SF31 transport, SF81 terminal approval, SF36 spending ledger and
SF82 outcome record. The workspace keeps presentation state in memory; the
original object session and inbox retain the durable work.

## Receive a merchant's object offer

A customer can prepare a complete download in this browser using the merchant's
public product description and offers. The original private operator initializer
creates the buyer's signer reference, policy, SQLite spending ledger and evidence
directory from a locally declared preset.

Use the same private operator preset as the original
[receiving runbook](../../buyer-runbook/WORKSPACE.md). Its schema is unchanged:

```json
{
  "schema": "stellar-forge.buyer-runbook-operator.v1",
  "actor": "your-operator",
  "service": "object-downloads",
  "payer": "YOUR_STELLAR_G_ACCOUNT",
  "python": "/absolute/path/to/python3",
  "maxTotalAtomic": "1000000",
  "maxDailyAtomic": "250000",
  "secretEnv": "STELLAR_SECRET"
}
```

Replace the payer and Python path with the operator's actual account and Python
3.11+ executable. Set the two ceilings to the intended limits, in atomic units
of the selected asset. The example amounts are limits to replace, not a product
price. Keep this preset mode `0600` outside the installation. It supports the
same optional `signerProvider`, `rpc` and `httpsProxyEnv` as the original runbook;
choose either `secretEnv` or `signerProvider`. Values are read on the host.
The receiving form does not accept a signer module, credential, executable or private path.

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-workspace/server.mjs \
  --state /absolute/private/object-buyer \
  --operator-settings /absolute/private/object-operator.json \
  --port 8438
```

Open the complete printed URL and choose **New → Receive a merchant object**.

1. Receive the original `objects.json` and the merchant's saved public offers.
   Supported inputs are the original seller's `/_seller/offers` array,
   the S3 release's `stellar-forge.s3-seller-offers.v1` file, and the existing
   native saved-discovery envelopes. For an original S3 release, obtain
   `s3/objects.json` and `offers.json` from the same selected release. The private
   S3 source configuration remains with the merchant.
2. Choose the object and explicitly select its resource/payment alternative.
   The existing descriptor selector and `prepareReview` bind the exact HTTPS
   route, method and payment terms. A whole-file product uses one exact GET with
   no range query; a chunked product exposes its bytes-per-request control.
   Set the session name, whole-download cap and daily cap. The total must cover
   every planned request at its per-request maximum; both budgets must fit the local preset and
   each request must fit the daily limit.
3. **Review received download** shows the file, selected whole-response or exact-range plan, snapshot, optional
   whole-file hash, payer, network, asset, recipient and atomic limits. It retains
   the hashes of both original merchant files and the local preset. A changed
   preset or source invalidates an uncommitted review.
4. **Create buyer and download** calls the original native workspace initializer
   and object-session constructor. It prepares every original inbox job and
   selects the saved session in the same browser. **Start download** remains the
   explicit next action, with the original terminal approval and spending checks
   for each request. The existing File delivery, Purchase records, finalization
   and restart controls operate on that same session.

The received source bytes remain unchanged in private state. The seller array
and S3 release envelope are projected to the native `{resources: [...]}` review
format without altering their offer rows; both the uploaded-file hash and native
preparation hash are retained. These are saved metadata for review. The original
buyer obtains and binds each actual quote during execution.

Reopen the same `--state` to find received sources, prepared products and saved
downloads. The preset's original path is retained, so it need only be declared
on the first launch; editing it requires a fresh review for new preparation.
Previously prepared products retain their original native limits and signer
reference. Their policy, signer and workspace files are checked against the
saved preparation before they are offered as new-download inputs.

Repeating a successful create after a lost response resolves to the same
private operator and original session. If the host stops after the native
operator manifest is complete, preparation reopens that same workspace. An
unfinished operator generation remains unexecutable; the next preparation uses
the original initializer in a new owned generation. Original metadata leases
serialize receiving mutations across processes. Existing object-session rules
handle a session interrupted during its own initial construction; an incomplete
session name is not overwritten.

The trusted product profile below remains useful for installations that already
have reviewed native operator workspaces.

## Back up and restore the complete buyer workspace

**Backup and recovery** in the sidebar captures this same receiving and download
application through original SF88 collection recovery and SF101 authenticated
encryption. It retains merchant inputs, prepared products and native operator
generations, committed SQLite journals, original object plans, inbox history,
response parts and completed files. Empty whole files keep their zero-byte
contents and one original request. Queued chunked downloads keep their untouched
jobs; restoring state does not start them.

Place the workspace, private preset, optional profile and all referenced native
operators, tickets, evidence and completed files beneath one existing private
state root. For example, use `/private/buyer-state/workspace` and
`/private/buyer-state/operator.json`. Review lists the exact selected paths;
unrelated siblings are not automatically included. Directories must be owned
mode `0700`, files `0600`, without symbolic or hard links. The original engine
permits 64 native operators, 9,500 filesystem entries, 2 GiB per file and less
than 4 GiB total. This application reviews up to 512 original sessions. External
Python, source CLI and signer-provider executables remain listed installation
requirements.

Set the separate backup passphrase in the launching terminal before opening the
browser. Only its environment name enters the browser, never its value:

```sh
read -rsp 'Backup passphrase: ' SF88_BACKUP_PASSPHRASE
export SF88_BACKUP_PASSPHRASE
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-workspace/server.mjs --state /private/buyer-state/workspace --port 8438
```

1. Open **Backup and recovery**, enter the common state root, and choose
   **Review backup contents**. Review the original sessions, whole/chunk plans,
   native operators, merchant sources, selected paths, missing optional outputs
   and runtime requirements. A changed startup profile or preset-path reference
   requires reopening the workspace before review.
2. Choose a new encrypted bundle directory outside that root, for example
   `/private/backups/buyer-20261011`, with an existing private parent. Stop other
   programs that write the selected state, acknowledge that condition, then
   choose **Create encrypted backup**. The application holds original workspace
   and intake metadata leases, each selected object-session lease and native
   SQLite checkpoint holders. Original source comparisons remain active.
3. Follow capture and encryption progress. **Stop recovery operation** cancels
   this owned operation and drains its workers. The encrypted copy carries a
   release for only its captured lease generations; live source ownership stays
   held until the capture finishes.
4. Keep the bundle path and record SHA-256 outside the captured root.
   **Select this backup → Verify backup** authenticates the archive, original
   session/configuration bindings and committed journals, including when source
   state is absent. It uses the host's `/usr/bin/python3`; the CLI can also select
   an explicit existing Python.

The original journal-authentication keys are encrypted inside the bundle.
Wallet environment values are excluded. Keep the bundle and its separate
passphrase available to the intended restoring operator.

### Restore and reopen

Close the browser launcher and other writers. The existing `buyer-object
backup-restore` command is printed for the selected backup. Its destination is
the **original absolute state root**, which must be absent or an empty private
directory. Preserve a populated root before deliberately making that location
available. Restore does not merge into it or rewrite original paths.

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs backup-restore --bundle /private/backups/buyer-20261011 --expect ORIGINAL_RECORD_SHA256 --pass-env SF88_BACKUP_PASSPHRASE
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-workspace/server.mjs --state /private/buyer-state/workspace --port 8438
```

Restore authenticates before publishing, then reopens the original operators,
session plans, accounting pages and received-product identities. Its
`reopened.urlCommand` includes the original profile when applicable. The browser
prints a fresh private URL. Open **File delivery** to obtain saved bytes or
continue only untouched jobs; open **Purchase records** for the original
outcomes and receipts. Capture, verify and restore run no purchase, signature,
payment or finalization.

A published bundle remains complete if writing its local history later fails;
`selectionRecordError` reports that separate condition. Restore likewise returns
`reopenError`, `nativeReopenErrors`, `publicationSyncError` and `cleanupErrors`
separately after publication. Preserve that result and resolve the named local
issue instead of blindly repeating a completed operation. The CLI exits `2` for
these post-publication conditions.

## Prepare the existing operator inputs

Use Node 22 or newer on the operator's Linux/POSIX host. Set up the existing
[native buyer workspace](../README.md) and obtain the original merchant's
`objects.json` from its [S3 release](../../sf30-seller-sdk/s3/README.md).

Each configured product needs these existing files:

| Input | Purpose |
| --- | --- |
| Original `objects.json` | Merchant alias, chunk limit, complete size, filename, content type and selected snapshot |
| Original buyer configuration | Base GET route, selected native payment terms, signer reference, operator policy, ledger and evidence directory |
| Existing private buyer workspace | Original native signer and operator environment, when configured through the workspace initializer |

The base buyer request must be a GET for the descriptor's exact path, with no
query, body, response destination or order ticket. Its normal `buyerTransport`
setting is retained for explicit proxy environments. Every generated chunk gets
the original `offset` and `length` query and its own private destination. A whole
product keeps the exact base URL and one original response destination.

The configured original operator workspace must be compatible with that request's
signer, payment terms, spending ledger and evidence directory. The original
object initializer checks this binding. Its total and daily spending limits also
apply during execution. See [OBJECTS.md](../OBJECTS.md) for the original whole-file,
byte-range and budget contracts.

## Buy a whole-file product

The original S3 `whole` entries, including report and versioned-file products,
use the same receiving screen and trusted profile. Review shows **Whole file ·
one GET**, the complete expected bytes, exact URL, HTTP 200 contract, selected
snapshot and optional complete digest. The chunk-size field is hidden because
the merchant fixes the complete response length.

Start the original buyer once. Its saved native response must have HTTP 200,
no Content-Range, the selected object snapshot and total length, and matching
returned/local hashes. The original writer checks the complete expected length
and any selected SHA-256 before publishing the response. Purchase records use
that same one original intent and spending-ledger record.

After verification, **Save whole file** creates the original private assembled
output and its receipt. **Download completed file** uses the existing bounded,
cancellable file stream. Reopen the same workspace for that file, original
request history, receipt export and accounting even if the output has moved.
Neither save nor download sends another merchant request.

Zero-byte whole products follow this same one-request flow. Their progress reaches
complete only after the original empty response and digest are verified; the
history shows **Whole file**, not an invented negative byte range. A zero-byte
file retains the selected quoted price and normal native approval. Existing
chunked sessions retain their original range contracts and resume behavior.

Create a private JSON profile referencing the reviewed inputs. The profile
contains paths and public product labels. Keep it outside the installed package.

```json
{
  "schema": "stellar-forge.sf88.object-workspace.v1",
  "products": [
    {
      "id": "archive",
      "label": "Merchant research archive",
      "descriptionFile": "/absolute/private/merchant-release/objects.json",
      "objectId": "archive",
      "configFile": "/absolute/private/archive-buyer/operator.json",
      "workspace": "/absolute/private/archive-buyer"
    }
  ]
}
```

Replace the paths and alias with the actual selected files. Multiple products
can refer to the same description, with a distinct original configuration for
each route. The profile supports up to 64 configured product aliases.

For an existing application that configures the original operator through its
process environment, omit `workspace` or set it to `null`. The original buyer
still requires its configured policy, ledger, signer module and operator keys.
The browser receives no credential values or editable filesystem paths.

Use mode `0600` for the profile and buyer configuration. Choose an existing
private parent directory for the workspace; the command creates a new child
state directory when needed, using mode `0700`.

## Open the workspace

From the repository root:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-workspace/server.mjs \
  --state /absolute/private/download-workspace \
  --profile /absolute/private/object-products.json \
  --port 8438
```

Open the complete printed URL. The server binds `127.0.0.1`; use the same host
and port in the printed link. Keep the launching terminal open for the original
approval prompt. A fresh server creates a new browser capability; reopen its
new printed URL after restart.

The browser workflow has six stages:

1. **Select and review.** Choose a configured product, a new session name, bytes
   per request and a whole-download cap. Review the exact number of requests,
   first and last byte ranges, asset, recipient, per-request maximum and total
   maximum. The calculation uses integer atomic units. The cap must cover every
   planned request at its configured maximum.
2. **Create the session.** The original initializer saves the exact reviewed
   configuration and descriptor selection, native inbox jobs and destinations.
   A changed source file invalidates an uncommitted review. A lost successful
   create response resolves to the same original session when repeated with the
   same review. An occupied name with different inputs is rejected.
3. **Start or continue.** The explicit start dialog names the selected file,
   remaining parts and native terms. Original terminal approval remains in the
   buyer. Only the original next unattempted request advances. Completed parts,
   their hashes and original outcomes appear in request history.
4. **Stop or recover.** Stop signals this server's exact active run. Wait for its
   result, then refresh or recover the original saved session. A stale tab's
   state cannot start, recover or assemble a changed session. The existing
   original lock prevents another process from owning the same object run.
5. **Assemble and download.** When every original part is verified, assemble
   through the existing streaming writer. Download opens the recorded file,
   checks its length and SHA-256 again, and streams it to the browser's normal
   download destination. The file panel shows verification and streaming byte
   progress; **Stop file transfer** cancels that exact read. Large files are not
   buffered into a browser Blob.
6. **Complete purchase records.** Open **Purchase records** for the selected
   download. Review each original part's financial status, then explicitly
   **Finalize original purchases** to process every earlier attempt using the
   saved native workspace. Watch progress, stop the owned operation when needed,
   and retain the same original receipts. The original native finalizer can
   observe network finality; this action creates no buyer request or payment.

The whole-download cap and attempt allocations describe maximum permitted
amounts. The request table shows each original financial outcome separately.
For interrupted or uncertain attempts, use **Recover saved results** and the
original [inbox recovery workflow](../QUEUE.md) with the same intent. The
existing original engine decides which saved files are complete.

## Purchase records and finalization

**File delivery** and **Purchase records** are two views of the same session.
The first checks the delivered parts and assembled file. The second calls the
original `accountObjectSession` reader over the original inbox; it does not read
or hash product bytes and needs no operator keys or RPC connection for saved
history. The browser remembers the chosen view within its current session.

Purchase history is paged in groups of 50 original parts. Its amount and status
counters describe the displayed page, not the whole download. The amount is the
sum of current finalized actual amounts; unattempted parts, original unsigned
responses and unresolved attempts remain distinct. Expand **Record details** for
the original intent, observation time, approved-request digest and saved source
path. If a later check fails, an earlier retained finalized receipt stays visible
with its original amount and time.
The most recent browser operation also labels any source-read or view-save issue
beside the affected visible part, including when an earlier ledger receipt still
exists. These operation messages remain in memory for the latest eight sessions;
the durable receipts and ledger stay in their original native locations.

**Finalize original purchases** reviews the bound session identity, selected
native workspace, terms and complete part count. It traverses every original
part through the existing native finalizer in groups of ten. The progress line
counts the entire operation, while the table continues to show its selected
page. Unresolved entries do not prevent later original parts from being examined.
This uses the original SF36 ledger and SF86 financial authority, original saved
attempts and existing transport. A lower current spending cap does not erase an
earlier approved reservation. No new quote, signer, acquisition or payment is
created by this action.

**Stop operation** cancels this exact owned finalization or export. Completed
native results stay in the original inbox; running finalization again resolves
the same attempts. Repeating the most recent action ID returns its retained result. Closing
the host process drains this owned operation before releasing the listener.
After an abrupt process exit, use the original session recovery workflow for a
stale process lease before another finalization. Reading receipts remains
available while that recovery is pending.

The original session must retain its native `workspace` reference for the browser
to finalize it. For a historical session created with process-environment setup,
saved views still open in the browser. Finalize it through the original CLI with
its matching existing workspace:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs finalize \
  --session /absolute/private/download-workspace/sessions/archive-2026-10-11 \
  --workspace /absolute/private/archive-buyer --offset 0 --limit 100
```

Continue from the returned `range.nextOffset` until it is `null`; the command
processes its selected range. The browser's finalize action traverses all ranges
itself for sessions already bound to their workspace.

**Download all purchase records** streams the complete original accounting
history as `SESSION.accounting.jsonl`, using the existing one-use download
capability. Each line is one unchanged native accounting result with up to 50
entries, its own `observedAt`, range, terms and record authority. The last complete
line has `range.nextOffset: null`. The export reads original saved views, so it
works after restart without a product profile, keys or delivered bytes. It keeps
one range in memory and streams directly to the browser download destination.
An interrupted download retains only its completed ranges; request a new export
to obtain the full current record. These are timestamped views of the original
ledger, not a separate balance or new source of financial authority.

## Retained files and restart

A completed-file download owns one operation from its first saved-file read
through the HTTP stream. A second link cannot start another verification while
that operation is active. The same open file descriptor supplies both the
recorded length/SHA-256 check and the bounded stream. The final block is retained
until the streamed bytes and file identity still match the original assembly,
so a changed file ends with an incomplete download rather than a successful
replacement result.

The file panel reports verification, streaming, completion or the latest failure
for that session. **Stop file transfer**, a disconnected download request, and
host shutdown cancel the owned read and close its file handle. The current read
is bounded to 64 KiB; cancellation prevents the next read. HTTP backpressure
bounds queued file data. A stopped or failed transfer leaves the original
assembly, chunks, buyer attempts and purchase records in place. Request a new
one-use link to download that same file again. The latest transfer status is
kept in memory for eight sessions; reopening the private state recovers the
original file and receipts without a new merchant request.

The workspace creates this layout beneath its selected private state directory:

```text
sessions/SESSION_NAME/       original object session, inbox, chunks and receipts
downloads/SESSION_NAME/      completed file produced by original assembly
preparations/               temporary reviewed configuration snapshots
received/                   original public inputs and privately prepared operators
```

The native session manifest is the session index. The browser workspace creates
no separate attempt ledger, payment engine or journal. Temporary configuration
snapshots are removed after creation; the original session retains the actual
selected configuration.

Restart with the same `--state` to reopen saved sessions and received products.
Supply `--profile` to add existing trusted product aliases. Reopening a session uses its original
saved configuration even if the profile is absent or the original input file
has moved.

Startup enumerates retained manifests. Selecting a session in **File delivery**
performs one original inspection, including saved-byte verification. Selecting
**Purchase records** reads only its current original accounting range. While a run is active, browser
updates consume the original progress callback. **Refresh and verify** performs
another deliberate original inspection; idle browser refreshes do not repeatedly
hash every saved chunk. The server retains at most eight full reports in memory,
and request history is filtered and paginated before it is sent to the page.

The original command line remains directly usable for these sessions:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs status \
  --session /absolute/private/download-workspace/sessions/archive-2026-10-11

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs recover \
  --session /absolute/private/download-workspace/sessions/archive-2026-10-11
```

Use the actual session name shown in the sidebar. **Download HTML report** and
**Download JSON** export the original complete report, including the original
intent and local recovery references. These exports are operator files; retain
them with the corresponding session.

`Ctrl+C` or `SIGTERM` stops this server's owned run or file transfer, waits for the
original result, lease release and file-handle cleanup, and closes the listener.
Incomplete HTTP requests are closed after the owned work drains.
Closing only the browser leaves the
host process running; reopen the printed URL to inspect it. An abrupt host or
process interruption is handled by the original session recovery command.

## Use a completed file in data analysis

**Use in data analysis** connects a completed JSON or CSV download to the original
Python analytical application. The source is the recorded assembly selected by
this workspace. The browser supplies its session ID, chosen format and source
name; it cannot substitute an arbitrary local file path.

1. Open the completed download in **File delivery** and save its complete file.
   Choose **Use in data analysis**, then enter a source name and the actual JSON
   or CSV format.
2. Choose **Review source handoff**. The review shows the original session,
   configuration and snapshot binding, complete file length and SHA-256, target
   analytical workspace and current source revision. An existing name therefore
   has an explicit reviewed revision before it can change.
3. Choose **Register source and open analysis**. The existing Python ObjectBuyer
   reopens the original session and its recorded assembly. The original
   AnalysisResponses registry retains that source and its revision in the same
   DatasetDatabase used by the analytical application. Registration is sent
   through its authenticated local `/api/object-source` route when it is open.
4. Follow **Continue in analysis workspace**. In **Retained responses and files**,
   inspect the registered source, select the JSON record collection when needed,
   choose explicit field types, preview all mapped records and import the
   reviewed projection. The existing Data, Query, Activity, Reports and full
   query export surfaces continue from that imported version. The original
   source and analytical projection keep their separate identities.
5. **Stop analysis workspace** drains the owned Python application. **Open saved
   analysis** reopens its existing database, queries, projections and exports;
   this does not require the original downloaded file to remain available.
   Registering or previewing that file again still requires its verified original
   session and recorded assembly.

The database is private and retained at `STATE/analysis`. `python3` is the default
host executable; use `--analysis-python /absolute/python3` to select another
installed Python. The complete matching native checkout supplies the Python
modules directly, including the original ObjectBuyer and response-table reader.
No package installation or additional Python service is performed by the UI.
The original runtime and optional analytical features retain their documented
dependencies and limits in [`../python/WORKSPACE.md`](../python/WORKSPACE.md).

The latest handoff record remains at `STATE/analysis-handoff.json`. If the parent
or HTTP reply is interrupted, reopen saved analysis or review and register the
same file again. The original registry reuses an identical source identity;
the buyer does not acquire or assemble the object as a registration fallback.
**Stop current operation** stops the exact owned handoff. Original committed
source revisions remain available even if a final browser reply was lost.

The analysis process uses the shared original dataset-workspace launcher. Its
private URL is supplied only through the authenticated Object Buyer UI or the
owning terminal. `workspace.close()`, `Ctrl+C` and `SIGTERM` close owned analysis
work along with other owned buyer work. On Linux the Python process group is
also interrupted when its launcher exits abruptly. Reopening never signals an
unrelated PID or takes over another live analysis writer.

Stop analysis before reviewing or creating a workspace backup. The existing
encrypted recovery captures the database inside the workspace and holds the
original Python `analysis.lock` throughout the capture. A live native analysis
writer prevents that capture until it is stopped. This composes with the existing
session and original operator journal leases.

The same customer flow is available from the original object command:

```sh
buyer-object analysis-review --state /absolute/private/download-workspace \
  --session completed-events --name purchased_events --format csv

# Use reviewSha256 from that exact review.
buyer-object analysis-open --state /absolute/private/download-workspace \
  --session completed-events --name purchased_events --format csv \
  --review REVIEW_SHA256

# Reopen analytical work without selecting a source or acquiring a file.
buyer-object analysis-open --state /absolute/private/download-workspace

buyer-object analysis-status --state /absolute/private/download-workspace
```

For these analysis commands, `--session` is the saved name inside `STATE/sessions`.
The native download commands retain their original absolute `--session` paths.
`analysis-open` stays in the foreground and prints the private analytical URL;
keep that terminal open and use `Ctrl+C` to close its owned application. Without
the installed alias, use `node .../sf88-operator-buyer-cli/object-cli.mjs` with the
same arguments. No new acquisition or purchase is part of this handoff.

## Embedding and deployment

```js
import { startObjectWorkspace } from './object-workspace/server.mjs';

const workspace = await startObjectWorkspace({
  stateDirectory: '/absolute/private/download-workspace',
  profilePath: '/absolute/private/object-products.json',
  operatorSettings: '/absolute/private/object-operator.json', // optional receiving preset
  analysisPython: '/usr/bin/python3', // optional; defaults to python3 on the host
  port: 0,
});
console.log(workspace.url);
// On application shutdown:
await workspace.close();
```

The workspace has no additional third-party runtime dependency. Its package closure is the
original SF88 object modules and their existing imports, `intake.mjs`, the
original `buyer-runbook/handoff-intake.mjs` preset reader and `runbook.mjs`
metadata lease, shared `dataset-workspace/analysis.mjs`, the original Python
analytical application and object reader, plus the three static files in `public/`.
Native signing and transport use the existing original buyer
dependencies. Distribution owners can expose `server.mjs` as a command and its
`startObjectWorkspace` export without an additional wrapper or bundle.

The listener is intended for the operator's own browser. A per-instance
capability protects API access; mutations require the exact local Origin. A
short-lived, single-use local download link permits native browser streaming
after an authenticated request. The server accepts product and session IDs,
review revisions, operation IDs and the two explicitly received public files.
Private paths, modules, operator credentials and signer settings come from the
local launcher and original operator preset. Browser creation requests name the
exact saved review; they cannot replace its resource or payment terms.

## Source integration

The original PR928 object engine and its accepted source-native S3/chunk journey
remain the component baseline. This workspace adds the browser selection,
review, dispatch, retained-session and download workflow over that engine.
The narrow `buyerTransport` allowed-field addition in `object-session.mjs` lets
the original normalizer and inbox carry a configured native proxy through the
same saved object plan.
