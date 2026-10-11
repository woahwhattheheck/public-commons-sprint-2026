# Sell a packaged file with the existing SF30 service

`responseAsset` makes a ZIP, CSV export, PDF, image or other file a declarative
seller product. It uses **the existing SF30 listener, offers, native x402 payment
adapter, admissions and developer portal**. No custom application handler,
second server or new payment scheme is needed.

A file is read before the listener starts, checked against the operator's
SHA-256, and retained as an immutable snapshot. The paid response contains the
original bytes, an attachment filename, the configured MIME type and its digest.
Editing the source file cannot change an already-running product.

## Prepare the product

Run from a full repository checkout with Node 22 or later. These commands require
no npm install and do not contact a network or make a payment.

```sh
SDK=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$SDK/asset-cli.mjs" inspect \
  --file /srv/private/export.zip \
  --type application/zip --name export-2026-10.zip
```

The result contains `responseAsset`, the actual byte count and a
`recommendedMaxResponseBytes` value. Copy the descriptor into a seller config.
Select the payment terms yourself; the values below are **local placeholders**,
not usable payment identities. Replace the SHA with the inspect result.

```json
{
  "schema": "stellar-forge.seller-service.v1",
  "publicOrigin": "https://files.example",
  "maxResponseBytes": 4194304,
  "assetBudgetBytes": 16777216,
  "routes": [{
    "id": "export_october",
    "path": "/exports/october-v1.zip",
    "definition": {
      "method": "GET",
      "description": "October data export, version 1",
      "payment": {
        "network": "stellar:testnet",
        "scheme": "exact",
        "amount": "10000",
        "asset": "REPLACE_WITH_REAL_SEP41_CONTRACT",
        "payTo": "REPLACE_WITH_REAL_RECEIVING_ACCOUNT",
        "maxTimeoutSeconds": 60
      }
    },
    "responseAsset": {
      "file": "./export.zip",
      "sha256": "COPY_THE_64_LOWERCASE_HEX_CHARACTERS_FROM_INSPECT",
      "contentType": "application/zip",
      "downloadName": "export-2026-10.zip"
    }
  }]
}
```

The file path resolves beside the config, not the shell's working directory.
An embedding application that constructs a config directly supplies paths
relative to its own working directory. Use only files you are authorized to
sell. Keep customer files and generated product bundles out of public source.

The route chooses exactly one of `response`, `responseFile`, `handler` or
`responseAsset`. Existing JSON responses and application handlers keep their
behavior. File routes require a fixed GET or an explicitly priced HEAD; a GET
does not create a free HEAD alias. Do not attach a JSON `outputExample` to binary
content. An imported offer must retain its exact MIME type and omit a JSON output
declaration. Original payment terms are neither converted nor replaced.

## Package, move and check

```sh
node "$SDK/asset-cli.mjs" bundle \
  --config /srv/private/seller.json --out /srv/private/export-release
node "$SDK/asset-cli.mjs" verify --directory /srv/private/export-release
```

`bundle` validates the real source bytes and the original seller route/price
rules, then creates a **new** private directory. An existing output is never
overwritten. A bundle contains:

```text
export-release/
  seller.json
  manifest.json
  assets/<sha256>.blob
```

The config uses relative, content-addressed paths. Identical content is copied
once on disk even when two routes sell it. The entire directory can be moved;
its original source file is no longer required. On Linux, directories are 0700
and created files are 0600. The manifest is written last; `verify` rejects an
incomplete bundle, changed config, changed bytes or mismatched route metadata.
These hashes establish bundle consistency, not a signature or seller identity.

The portable bundle command accepts declarative asset-only definitions. It does
not silently omit executable `handler`/`admit` modules or imported-offer
integration dependencies. Mixed services and application admissions remain
supported directly by `serve.mjs`; use their existing deployment process.

## Run the same seller

```sh
node "$SDK/serve.mjs" \
  --config /srv/private/export-release/seller.json \
  --port 8423 --max-in-flight 4 --drain-grace-ms 60000
```

Without `--facilitator`, this is the original **challenge-only** runtime. A GET
returns a real 402 and payment requirements, never the file. `/_seller/docs` and
`/_seller/openapi.json` inherit the correct file MIME type from the same compiled
offer. `/_seller/health` adds digest, byte count, MIME and download name per file
route, plus aggregate retained asset bytes; it does not reveal local paths.
The existing readiness, graceful draining and admission limits remain active.

For native payment delivery, use the operator-configured facilitator and
original x402 packages described in [README.md](README.md#enable-the-native-x402-runtime):

```sh
node "$SDK/serve.mjs" \
  --config /srv/private/export-release/seller.json \
  --facilitator https://YOUR_FACILITATOR/facilitator \
  --max-in-flight 4 --drain-grace-ms 60000
```

The application returns a snapshot only after verification; the unchanged
resource adapter validates/encodes that response and releases it only after
native settlement succeeds. A refused/uncertain settlement does not release the
file. There is no automatic payment retry, new wallet or additional approval UI.
Successful file responses include `Content-Disposition`, `Content-Type`,
`X-Content-Sha256`, a digest ETag and `Accept-Ranges: none`.

In native mode, a Range request returns 416 and a conditional request (`If-*`
validators) returns 400 **before native verification or settlement**. An existing
application admission runs after these checks under the same cancellation and
timeout. Partial transfers, 304 cache responses and resumable purchases are not
implemented. The challenge-only mode continues to issue its ordinary 402.

## Limits and releases

`maxResponseBytes` retains the old 1 MiB default and can be set through the JSON
config up to the original adapter's 16 MiB ceiling. Choose at least the inspect
recommendation: response challenges/errors also need room. `assetBudgetBytes`
defaults to 32 MiB and can be set from 1 byte through 64 MiB. Every route's retained
snapshot counts, including repeated references to the same content. Empty files
are valid. Missing files, nonregular files, changed-during-read files, bad hashes
and exhausted budgets fail startup before listening. Linux final-component
symlinks are rejected; this does not prohibit trusted parent-directory symlinks.

The budget is **retained asset bytes**, not a process-wide memory limit. Existing
JSON snapshots, per-request copies and native SDK buffers consume additional
memory. Use the existing `--max-in-flight` control for the host's concurrency
budget; do not mistake the 64 MiB snapshot ceiling for peak resident memory.

To release changed content, inspect the new file, deliberately update its hash
and preferably its versioned route, build a new bundle and use the existing
service restart/deployment process. A running snapshot remains unchanged until
that restart. Never assume an interrupted paid transfer can safely be repurchased
automatically.

Focused local exercise:

```sh
node --test "$SDK/test/assets.test.mjs"
```

The three flows cover portable packaging/immutable delivery, startup/admission
rules and the original HTTP resource adapter with controlled native-server
outcomes. They do not stand in for SDK cryptography or an on-chain transaction.
