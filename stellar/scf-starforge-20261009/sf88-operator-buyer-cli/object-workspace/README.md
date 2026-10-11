# Object buyer workspace

Select a merchant's large file, review its request plan, operate the original
buyer, retain completed parts through interruption, and download the assembled
file from one private browser workspace. Complete the original purchase records,
retain their native receipts and reopen them independently of the delivered file.

This workspace uses the original `object-session.mjs`, `object-description.mjs`
and `object-report.mjs` APIs. Each range remains an original SF88 inbox job with
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
The browser does not accept a signer module, credential, executable or private path.

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
   route, method and payment terms. Whole-file-only entries remain unavailable
   in this chunk acquisition application. Set the bytes per request, session
   name, whole-download cap and daily cap. The total must cover every planned
   chunk at its per-request maximum; both budgets must fit the local preset and
   each request must fit the daily limit.
3. **Review received download** shows the file, exact ranges, snapshot, optional
   whole-file hash, payer, network, asset, recipient and atomic limits. It retains
   the hashes of both original merchant files and the local preset. A changed
   preset or source invalidates an uncommitted review.
4. **Create buyer and download** calls the original native workspace initializer
   and object-session constructor. It prepares every original inbox job and
   selects the saved session in the same browser. **Start download** remains the
   explicit next action, with the original terminal approval and spending checks
   for each chunk. The existing File delivery, Purchase records, finalization
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
the original `offset` and `length` query and its own private destination.

The configured original operator workspace must be compatible with that request's
signer, payment terms, spending ledger and evidence directory. The original
object initializer checks this binding. Its total and daily spending limits also
apply during execution. See [OBJECTS.md](../OBJECTS.md) for the existing byte-range
and budget contract.

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

## Embedding and deployment

```js
import { startObjectWorkspace } from './object-workspace/server.mjs';

const workspace = await startObjectWorkspace({
  stateDirectory: '/absolute/private/download-workspace',
  profilePath: '/absolute/private/object-products.json',
  operatorSettings: '/absolute/private/object-operator.json', // optional receiving preset
  port: 0,
});
console.log(workspace.url);
// On application shutdown:
await workspace.close();
```

The workspace has no additional third-party runtime dependency. Its package closure is the
original SF88 object modules and their existing imports, `intake.mjs`, the
original `buyer-runbook/handoff-intake.mjs` preset reader and `runbook.mjs`
metadata lease, plus the three static files in `public/`. Native signing and transport use the existing original buyer
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
