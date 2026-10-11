# Live catalog operations workspace

A local browser interface for the **existing SF60 catalog operator**, not another
catalog or seller service. Browse and search original discovery, inspect exact
keys and lifecycle history, admit or revise a received signed offer, prepare a
seller withdrawal request, and apply its returned signed envelope. Reviewed
operations and native outcomes survive normal restarts.

Requires Node.js 22+, a POSIX system, and an already-running original operator
under the same OS user. There are no npm dependencies, bundled keys, external
browser libraries, wallet actions, or hosted services.

## Start with the existing writer

Configure and launch the original daemon using [OPERATOR.md](./OPERATOR.md).
For example, from this directory, with your established seller public-key policy:

```sh
node operator.mjs --directory /srv/starforge/catalog \
  --policy /srv/starforge/sellers.json --control loopback --port 8787
```

For a new catalog, use the original daemon's `--create-empty` option. The workspace
never creates or takes ownership of the catalog writer.

In a second terminal, start the browser interface:

```sh
node workspace.mjs --directory /srv/starforge/catalog \
  --state /srv/starforge/catalog-workspace \
  --launch-file /srv/starforge/catalog-workspace-launch.txt
```

The state directory is created privately when absent. Catalog and workspace
state must be separate real directories, owned by your OS user with no group or
other permissions; neither may contain the other. The launch file is create-only
and mode 0600, so choose a new filename on a later launch. Optional `--port 8798`
selects a fixed port; the default selects an available loopback port.

Open the URL from the private launch file in the browser on this same machine.
The CLI prints only the ordinary origin and launch-file path, **not the access
capability**. Do not share, commit, or include the launch file in support bundles.
The fragment is removed from the address bar by the application; a browser-tab
session can reload without carrying the capability in navigation requests.
A restarted workspace issues a new capability: reopen its new private launch
URL. Signing into another account or a cloud service is not required.

Do not expose this listener through a public reverse proxy. The server accepts
only the exact loopback host, same-origin browser requests and its own session
capability. It does not send the original daemon's control token to the browser.

## Operate the catalog

### Browse and inspect

Catalog uses the original list/search implementation, including network/protocol
filters, offset pages and generation-bound search cursors. Refresh starts a new
view after changes. Each row opens the canonical catalog key, current seller,
sequence, retirement state and original lifecycle history. The exact-key input
also inspects a retired resource that no longer appears in discovery. Export
creates a JSON copy of the displayed page or inspection, not an executable file.

### Add or revise an offer

Choose the configured seller, an appropriate positive increasing sequence, the
original HTTPS source URL and actual observation time in canonical UTC ISO format.
Select the original UTF-8 declaration and matching original `{nonce, proof}` pairs.
The declaration bytes are preserved, not reformatted before native admission.
Every payment alternative needs its matching proof in original array order.

**Review exact offer** stores an immutable local intent and shows its source hash,
full declaration, seller and sequence. This structural review is not signature
verification or publication. **Submit reviewed operation** sends that saved intent
once to the original operator, where the original SF50/SF73 signatures, startup
public-key policy and SF60 journal semantics remain authoritative. The native
response is retained. Fresh signatures are needed when their original validity
window expires; changing the offer requires matching new proofs.

Declaration input is limited to 64 KiB, proofs to 384 KiB, and the complete native
command to the original 512 KiB limit. These are input limits, not new trading or
payment rules. No seller private key belongs in any upload field.

### Withdraw a resource

Select an active record and choose **Prepare withdrawal**, or enter its exact key
in Withdraw. Confirm the seller, original source URL and reason. Preparing returns
the original head-bound SF95 request and downloads it; discovery remains unchanged.

Sign that downloaded request on the seller's own trusted machine using the
existing `sf95-signed-seller-withdrawal/cli.mjs sign` command described in
[OPERATOR.md](./OPERATOR.md). Upload the returned signed envelope (up to 128 KiB),
review it and submit. The original seller, signature, expiry, sequence and
journal-head checks run before retirement. A stale head requires a fresh request
and signature, not an automatic resend. Retired records remain inspectable by key.

## Retained operations and interrupted delivery

Operations is an index of the private workspace's own reviewed commands. Opening
a record or exporting it does not execute it. The index keeps compact metadata
in memory; ordinary paging does not reread all declarations and result files.
Full original inputs and responses are read when a specific operation is opened.

| State | Meaning |
| --- | --- |
| `prepared` | Saved exact intent; not yet sent. It can be reopened and submitted. |
| `sending` | Durable send intent was saved before contacting the original daemon. |
| `succeeded` | A successful native response was received; inspect its original decision and reason, including exact replay. |
| `rejected` | A rejection was received or the command failed before a complete send. |
| `unknown` | Delivery may have reached the writer, but its outcome is not established. |

The same record is never automatically sent a second time. A repeat execution
request returns its retained result once it has left `prepared`. A persisted
`sending` record becomes `unknown` at workspace startup, rather than being replayed.
**Inspect current catalog** loads original status, lookup and lifecycle history;
this read does not fabricate a receipt or silently change the saved outcome.

An output-save failure after a known native response preserves that response in
memory and shows `OUTCOME_NOT_SAVED_EXPORT_NOW`. Export the operation before closing
the process. On a later restart, the prior durable send intent may necessarily
be unknown. A filesystem recovery issue never causes an automatic catalog write.

Workspace records are scoped to the original catalog directory, and each workspace
has one private writer lock. After a crash, verify the lock's process ID is no
longer the workspace owner before removing only `.workspace.lock`; never remove a
live original catalog lock. Preserve operation JSON when backing up the stopped
workspace. Do not include the launch capability or original daemon control files.

SIGINT/SIGTERM stops new requests, ends incomplete browser request bodies, waits
for admitted native commands and closes this workspace. It does **not** stop the
original daemon. The daemon retains its original discovery and writer ownership.

## Embed in the existing installation

```js
import { openCatalogWorkspace } from './workspace.mjs';

const ui = await openCatalogWorkspace({
  directory: '/srv/starforge/catalog',
  stateDirectory: '/srv/starforge/catalog-workspace',
  port: 0,
});
// Deliver ui.launchURL privately to the same local operator. Do not log it.
// ui.origin is ordinary connection metadata, without the access capability.
// During your normal application shutdown:
await ui.close();
```

Distribution must preserve `workspace.mjs` and the three `workspace-ui/` files
at their original relative paths. Reuse the original operator and its complete
local import closure, including root `scf46-stellar-bazaar/` and `stellar-forge/`.
There is no second payment, signing, withdrawal or journal implementation here.
