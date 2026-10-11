# Update a catalog while discovery stays online

The live operator joins the existing SF60 discovery server, SF73 signed seller
admission, and SF95 signed withdrawal in one process. It holds one original
durable journal and exposes its current committed view to discovery readers.
An operator can add or revise an offer, prepare a withdrawal, and apply the
seller's signed withdrawal without stopping discovery or opening a second
writer.

The control endpoint uses a private Unix socket by default, or authenticated
loopback HTTP when explicitly selected. Its socket or runtime credential is
private to the same operating-system user. The discovery listener remains
the existing loopback GET service. Seller policies and
independent Ed25519 public keys are loaded once at startup; commands cannot
change them or substitute a key supplied with an offer.

## Start the service

Requires Node.js 22 or later on Linux or another POSIX system.
It uses the original repository modules and Node's standard library. Run from
this directory:

~~~sh
node operator.mjs --directory /srv/starforge/catalog --policy /srv/starforge/sellers.json --port 8787
~~~

For a Linux container that supports loopback TCP but does not permit Unix
socket listeners, select the supported transport explicitly:

~~~sh
node operator.mjs --directory /srv/starforge/catalog --policy /srv/starforge/sellers.json --port 8787 --control loopback
~~~

Both commands use the same journal and operator CLI. The loopback control
listener binds an ephemeral port on 127.0.0.1. A fresh 256-bit bearer token is
stored in the mode-0600 .catalog-control.json file under the private catalog
directory. The CLI reads it automatically; no token needs to be copied or
passed on a command line. The endpoint checks the exact Host, both loopback
addresses and the bearer token, and rejects browser Origin and Sec-Fetch
headers. POSIX ownership and private directory permissions remain required.

For a new catalog, add --create-empty. The service creates a new private
directory when necessary. An existing directory must be owned by the process
user, have mode 0700, and use its real path. When using Unix transport, keep
the directory path short enough that its .catalog-operator.sock path is at
most 100 UTF-8 bytes.

The startup result prints the discovery origin, control transport and location,
and loaded policy hash. It never prints the loopback token. Exclude the live
.catalog-control.json credential from backups, support bundles and repository
artifacts; copy only the actual journal data for a journal backup.
GET /discovery/resources, GET /discovery/search and GET /healthz
use the original discovery implementation and its Host/origin checks. Reader
requests observe a fully committed catalog before or after each update.

If service.mjs already owns this journal, stop that process cleanly and launch
operator.mjs instead. The same journal is reused. SIGINT or SIGTERM stops new
commands, finishes admitted writes, closes discovery, and releases the original
writer lock. After writes finish, control sockets have a two-second drain
deadline so an incomplete local request cannot retain the writer lock.
Startup never replaces an existing control socket or descriptor, or steals a
writer lock. Graceful shutdown removes this run's private control endpoint.
After an unclean process termination, inspect the original SF60 lock's process
ID and descriptor ownership before removing an orphan lock, socket or
descriptor. Both control markers must be absent before starting a new process.

## Configure approved sellers

The policy file has this shape. Replace the illustrative values with the same
independently established seller identity, key and allowed terms used by SF73:

~~~json
{
  "schema": "stellar-forge.catalog-operator-policy/v1",
  "sellers": [
    {
      "sellerId": "merchant-1",
      "pinnedPublicKey": "<complete independent Ed25519 PUBLIC KEY PEM>",
      "allowedOrigins": ["https://merchant.example"],
      "allowedRecipients": ["<approved payment recipient>"],
      "allowedNetworks": ["stellar:testnet"],
      "allowedSchemes": ["exact"]
    }
  ]
}
~~~

The signer identity is derived from that public key in the original SF73
format. All allowed lists must be nonempty and contain unique strings. The
file may contain multiple independently configured sellers. Policies are
retained for the process lifetime; a deliberate policy edit takes effect on
the next normal restart. The service never reads seller private keys.

## Inspect the running catalog

Use a second terminal under the same OS user:

~~~sh
node operator-cli.mjs status --directory /srv/starforge/catalog
node operator-cli.mjs list --directory /srv/starforge/catalog --query "limit=20&offset=0"
node operator-cli.mjs search --directory /srv/starforge/catalog --query "query=weather&limit=20"
node operator-cli.mjs lookup --directory /srv/starforge/catalog --catalog-key ORIGINAL_CATALOG_KEY
node operator-cli.mjs history --directory /srv/starforge/catalog --lifecycle-id ORIGINAL_LIFECYCLE_ID
~~~

Status returns the current journal head, committed operation count, active
resource count and loaded public-key fingerprints. Lookup returns the
original current seller identity, sequence and lifecycle ID for a catalog
key. History uses that lifecycle ID. List/search preserve the original
Bazaar filtering, pagination and ranking results.

## Admit or revise a seller offer

Retain the exact received original v2 declaration and one original SF50
{nonce, proof} pair for every payment alternative, in its original array
order. Obtain fresh signatures within SF50's existing validity period.
The live command reads these files and sends their exact source bytes:

~~~sh
node operator-cli.mjs admit \
  --directory /srv/starforge/catalog \
  --seller merchant-1 \
  --sequence 1 \
  --entry /private/received/offer.json \
  --proofs /private/received/proofs.json \
  --source-url https://merchant.example/offers/export \
  --observed-at 2026-10-11T15:00:00.000Z \
  --out /private/receipts/admission-1.json
~~~

Use the actual observation timestamp and an appropriate increasing seller
sequence. The service calls the original admitPinnedSeller with the
startup policy, verifies every signed option, and commits through the
original journal. Existing exact-replay behavior remains available. A
changed declaration needs its own matching fresh proofs.

Successful commands return the original SF73 result. Discovery immediately
serves the committed listing. An invalid signature, mismatched quote,
unapproved seller or invalid sequence leaves the committed view unchanged.

## Withdraw a listing without taking discovery down

First prepare the original head-bound SF95 request using the running writer:

~~~sh
node operator-cli.mjs prepare-withdrawal \
  --directory /srv/starforge/catalog \
  --seller merchant-1 \
  --catalog-key ORIGINAL_CATALOG_KEY \
  --source-url https://merchant.example/offers/export \
  --reason "Seller retired this operation" \
  --out /private/received/withdrawal-request.json
~~~

The seller signs that request using the existing SF95 signing command on its
trusted machine:

~~~sh
node ../sf95-signed-seller-withdrawal/cli.mjs sign \
  --request /private/received/withdrawal-request.json \
  --private-key /secure/existing-seller-ed25519.pem \
  --out /private/received/withdrawal-envelope.json
~~~

Return the signed envelope to the operator and apply it:

~~~sh
node operator-cli.mjs apply-withdrawal \
  --directory /srv/starforge/catalog \
  --envelope /private/received/withdrawal-envelope.json \
  --out /private/receipts/withdrawal.json
~~~

The original SF95 key, seller, sequence, expiration and journal-head checks
apply. Once committed, the listing disappears from the live discovery view;
its lifecycle history remains. If the original SF95 head-bound request has
become stale, prepare and sign a current request through the same workflow.

## Transport, persistence and integration

Each command is one request with a request ID, up to 512 KiB of JSON, sent once.
The daemon serializes commands around the same original journal owner.
Requests beyond its 16-command local capacity receive a clear response.
Responses are limited to 4 MiB; use original pagination for large listings.
There is no background polling or retry loop.

The --out option reserves a new mode-0600 file before sending the command.
Existing files are never overwritten. On success the result is written and
synced. If the output save fails after a commit, the actual successful result
is emitted on stderr so it can be recovered.

A transport interruption after a command was sent can leave its outcome
unknown. Inspect status, lookup and history before retrying a mutation.
The request ID correlates a response; it is not an additional persistent
idempotency ledger. SF73's original exact replay and SF95's original
head-bound withdrawal semantics remain authoritative.

Embedding applications can call:

~~~js
import { openCatalogOperator, requestCatalogOperator } from './operator.mjs';

const service = await openCatalogOperator({
  directory: '/srv/starforge/catalog',
  policyFile: '/srv/starforge/sellers.json',
  port: 8787,
  controlTransport: 'loopback', // Omit to use the default private Unix socket.
});
const current = await requestCatalogOperator({
  directory: '/srv/starforge/catalog',
  operation: 'status',
});
// Later, during normal shutdown:
await service.close();
~~~

This control service manages signed catalog declarations. Payment verification,
settlement, asset delivery and seller wallet custody continue through their
existing components. A catalog signature authenticates the stated offer
against the configured public pin; it does not establish a payment or a
customer transaction.

The implementation is additive to [the original journal](./journal.mjs) and
[discovery service](./SERVING.md), and composes
[SF73 admission](../sf73-pinned-seller-admission/README.md) and
[SF95 withdrawal](../sf95-signed-seller-withdrawal/README.md).
