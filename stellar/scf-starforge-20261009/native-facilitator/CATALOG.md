# Native settlement catalog

Enable automatic Bazaar publication in the existing native Stellar facilitator.
After the official x402 SDK returns a successful settlement, the same process
validates its Bazaar metadata through SF25, commits the original catalog, trust
and lifecycle projections through SF60, and reports the SF54 outcome to the
resource server through `EXTENSION-RESPONSES`.

The original payment result is returned unchanged. The private native HTTP
server and SF58 gateway carry the extension header independently of that JSON.
Both the ordinary in-process `settle()` client and the HTTP backend use this
same catalog path.

Use the native README's pinned installation, including `re2js@2.8.6` for the
original schema-pattern validator. In an installed application that omitted
optional packages, run `npm install --ignore-scripts --save-exact re2js@2.8.6`
and `starforge doctor --feature schema`. The catalog-disabled native runtime retains
its original SDK dependency path.

## Configure an existing merchant

Add the following optional `catalog` section to the existing native facilitator
configuration. Keep separate directories and configurations for each network.

```json
{
  "catalog": {
    "directory": "/private/starforge/testnet-catalog",
    "merchants": [
      {
        "sellerId": "merchant-primary",
        "signer": "EXISTING_SELLER_AUTHORITY_IDENTITY",
        "origin": "https://api.merchant.example",
        "payTo": "EXISTING_MERCHANT_G_OR_C_ADDRESS"
      }
    ]
  }
}
```

This fragment accompanies the existing schema, network, RPC, signers, payments
and limits sections; it is not a standalone facilitator configuration.

The operator establishes each merchant's origin and recipient association.
`payTo` must already appear in `payments.recipients`. `origin` is one HTTPS
origin without credentials, query or a resource path. `sellerId` and `signer`
must match the seller ownership identity already used by an existing SF60
journal. Multiple bindings for a seller retain that same signer identity.
Each origin/recipient pair has exactly one binding.

The catalog authority is loaded from this configuration. Payment callers supply
metadata, while the original SDK supplies the successful settlement result.
SF25 checks the complete accepted network, scheme, asset, recipient and atomic
amount against those trusted settlement facts. The established catalog parser,
JSON Schema validator, route identity, trust rules and lifecycle parser then
validate the candidate before publication. A successful transfer establishes the
payment binding; the merchant's descriptive metadata remains seller declared.

Review and start the complete original service:

```sh
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs \
  --review --config /private/facilitator-testnet.json

node stellar/scf-starforge-20261009/native-facilitator/cli.mjs \
  --serve --config /private/facilitator-testnet.json --port 5101
```

With the maintained distribution, the same command is available as
`starforge native-facilitator`. Configuration review reads no journal or
signing key. SDK startup, including `--check`, opens the configured catalog and
holds its original exclusive writer lock.

## Read the committed catalog

The native listener serves the existing Bazaar list and search response shapes
from the same live journal. Every query is bound to this facilitator's network.
A missing network filter uses that configured network; a different or repeated
network filter is rejected.

```sh
curl --fail-with-body \
  'http://127.0.0.1:5101/discovery/resources?network=stellar:testnet&limit=20'

curl --fail-with-body \
  'http://127.0.0.1:5101/discovery/search?network=stellar:testnet&q=weather&limit=10'
```

The original filtering, lexical ranking and version-bound search cursors are
preserved. Continue a search using its returned cursor and the same query
parameters. Catalog updates can invalidate a cursor; start that query again
when the original API reports a stale cursor.

For dual-network operation, run an independently configured pubnet backend and
start the existing gateway. Select its upstream deadline for the actual native
RPC settlement and catalog commit time, and configure the ingress deadline to
allow that response to finish.

```sh
SF58_TESTNET_ORIGIN=http://127.0.0.1:5101 \
SF58_PUBNET_ORIGIN=http://127.0.0.1:5102 \
SF58_UPSTREAM_TIMEOUT_MS=120000 \
node stellar/scf-starforge-20261009/sf58-dual-network-frontdoor/server.mjs
```

The installed gateway command is `starforge stellar-facilitator-gateway`.
Its original access-token and bind configuration still apply. Supply the
configured bearer when using an authenticated gateway.

SF58 discovery requires exactly one explicit `network=stellar:testnet` or
`network=stellar:pubnet`. It sends the complete query to that backend and
returns the original response bytes. List offsets and search cursors remain
owned by that network's journal.

```sh
curl --fail-with-body \
  'http://127.0.0.1:8788/discovery/search?network=stellar:testnet&q=weather'
```

## Settlement and extension outcomes

| SDK outcome | Catalog processing | Resource-server transport |
| --- | --- | --- |
| Verification or unsuccessful settlement | No catalog write | Original SDK JSON |
| Successful settlement without Bazaar metadata | No catalog write | Original SDK JSON |
| Successful settlement with accepted metadata | Await the durable original journal commit | Original SDK JSON plus Bazaar `status: success` |
| Repeat of a retained identical transaction receipt | Reuse the original sequence and operation | Original SDK JSON plus Bazaar `status: success` |
| Invalid metadata, missing merchant binding or catalog failure | Reject metadata independently | Original SDK JSON plus Bazaar `status: rejected` and a stable reason |

The SF54 header is base64-encoded JSON for the facilitator-to-resource-server
connection. Resource servers consume it internally. SF58 preserves valid headers
from the selected trusted backend and drops a malformed optional header while
retaining the original payment response.

Native `/supported` advertises `bazaar` when this catalog is enabled. SF58 keeps
its existing extension intersection: both native backends must advertise Bazaar
for it to appear as a global gateway capability.

In-process callers that need the extension outcome can use
`settleWithExtensions(payload, requirements)`, which performs one original
settlement and returns `{result, headers, extensionResponses}`. The standard
`settle(payload, requirements)` interface still returns the SDK result.
Use `facilitator.catalog.list(params)`, `.search(params)` and `.status()` for
the same committed view without another HTTP listener.

## Original operation identity and restart

Each accepted catalog operation retains a
`stellar-forge.native-catalog-receipt.v1` record in its private SF60 provenance.
It includes the original network and transaction hash as `operationId`,
successful SDK settlement fields, resource, accepted terms and Bazaar metadata.
The receipt fingerprint is the SHA-256 of this canonical local record. Its
transaction URL references that same transaction on Stellar Expert.

The catalog journal supplies the next sequence for the actual seller across
earlier upserts and retirements. A repeated retained transaction must have the
same metadata fingerprint and seller authority. It returns the previous result
without publishing another revision. A late repeat of an older accepted
transaction also leaves subsequent revisions and retirements intact. A changed
payload or authority under that transaction returns
`SETTLEMENT_REPLAY_MISMATCH`.

The same process owns the journal while accepting payments. Its drain covers
admitted SDK work and the subsequent catalog commit before releasing the
journal and signer ownership. The original SF60 lock prevents a simultaneous
standalone catalog operator from writing the same directory. Close that owner
before opening the native service on the directory.

## Operate and recover

Native `/healthz` includes `catalog` with state, pending work, committed
operation count, resource count, catalog version, journal head, process counters
and the latest sanitized catalog error. Stored counts and the journal head
survive restart; process counters start at zero. Payment health and RPC readiness
keep their existing meanings.

The original SF60 journal limits remain 10,000 committed operations, a 32 MiB
journal and 128 KiB per operation. Each newly accepted transaction's metadata
creates an original catalog operation; the retained receipt counts toward that
size limit. This backend uses the existing whole-journal durable write and
projection rebuild. Observe operation count and commit latency when sizing a
merchant deployment.

If a rename or fsync leaves commit status uncertain, SF60 refuses further
catalog writes until it is closed and reopened. The original payment result
still identifies the settled operation. Reopen the same journal and inspect
its existing transaction provenance before recovering metadata. Preserve the
original journal and the merchant's original request/result record throughout
recovery.

For trusted local metadata recovery, the exported
`openNativeSettlementCatalog(config)` opens that same journal and exposes
`process(paymentPayload, paymentRequirements, settlementResult)`. Call it only
with the retained original successful SDK result and request. This method
performs metadata validation and catalog publication; it makes no payment call.
Always close its returned owner in a `finally` block. This owner API also
supports a host that already retains successful SDK results in its private
merchant operation records. The payment HTTP API has no metadata-import route.

## Installed source APIs

The `native-facilitator-catalog` distribution registration exposes:

- `@tokenjunkielabs/starforge-merchant/facilitator/native`: the original native
  runtime and self-facilitated merchant composition.
- `@tokenjunkielabs/starforge-merchant/facilitator/config`: original review and
  configuration parsing.
- `@tokenjunkielabs/starforge-merchant/facilitator/catalog`: the owned native
  settlement catalog composition.
- `@tokenjunkielabs/starforge-merchant/facilitator/frontdoor`: the original
  dual-network HTTP gateway.

The distribution's existing static import closure includes the original SF25,
SF54 and SF60 implementations used by these entries.
