# Sell private S3 objects through the original SF30 seller

This adapter makes an existing private object store usable as a paid file or data
product. It uses the official AWS SDK to retrieve operator-selected objects and
returns their bytes through the existing SF30 handler interface. The original
SF30 payment verifier, cancellation and settlement sequence controls delivery.

The product includes a private source configuration, metadata inspection,
whole-file and large-object chunk delivery, pinned setup generation, and native
seller launch instructions. It adds no HTTP payment engine or hosted workflow.

## Install and connect an existing store

Use Node 22 or newer. From the repository root:

```sh
npm ci --ignore-scripts --no-audit --no-fund \
  --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/s3
```

The optional adapter pins `@aws-sdk/client-s3` **3.1149.0**. The rest of SF30 does
not need this package unless it loads an S3 handler.

Copy `example-source.json` to a private operator directory. Set your actual
`region`, `bucket` and approved object `key` values. The example names are
placeholders; the example does not provision a bucket or upload a file.

By default, the SDK client takes its identity from existing
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optional `AWS_SESSION_TOKEN`
environment variables. `credentialProvider: "default"` explicitly selects the
official SDK's default provider chain, for an existing deployment role or
profile. Credentials never belong in source JSON, public offer metadata or
generated setup files. An embedding application can supply its existing
official S3 client to `createS3ObjectSource(config, {client})`.

An optional `endpoint` selects an operator-controlled S3-compatible HTTPS origin.
Custom endpoints default to path-style requests; set `forcePathStyle` explicitly
if needed. Local development permits only `http://127.0.0.1:PORT` with
`allowLocalEndpoint: true`. Standard general-purpose bucket names are supported;
S3 access-point ARNs and directory buckets are outside this adapter's contract.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/s3/cli.mjs describe \
  --source /private/merchant/source.json
```

This performs one authenticated HEAD per configured object and returns public
aliases, routes, byte counts, delivery modes, MIME types and snapshot IDs. It
does not retrieve object bodies, list a bucket, or print bucket/key/credential
values. The source closes after the command. Each subsequent invocation or
seller startup performs its own HEAD selection; normal admission performs no
S3 request.

## Turn the selected objects into a runnable seller

Prepare a JSON file containing your existing public SF30 terms: `scheme`,
`network`, `asset`, `payTo`, positive atomic-string `amount`, and
`maxTimeoutSeconds`. These are the original compiler's payment fields. Use the
merchant's actual approved recipient and price; the setup tool does not discover
or verify a wallet identity.

One payment object applies the same price to every route. For individual prices,
use this wrapper with a payment object for every configured alias:

```json
{
  "schema": "stellar-forge.s3-payments.v1",
  "objects": {
    "report": {"scheme":"exact","network":"stellar:testnet","asset":"YOUR_ASSET","payTo":"YOUR_RECIPIENT","amount":"1000","maxTimeoutSeconds":60},
    "archive": {"scheme":"exact","network":"stellar:testnet","asset":"YOUR_ASSET","payTo":"YOUR_RECIPIENT","amount":"2000","maxTimeoutSeconds":60}
  }
}
```

Those strings are illustrative, unverified placeholders. Replace them before
enabling a real facilitator.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/s3/cli.mjs configure \
  --source /private/merchant/source.json \
  --payment /private/merchant/public-payment-terms.json \
  --origin https://downloads.your-merchant.example \
  --directory /private/merchant/release-001

node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /private/merchant/release-001/service.json \
  --handlers /private/merchant/release-001/handlers.mjs
```

`configure` requires a new directory and creates four private files:

| File | Purpose |
|---|---|
| `source.json` | Original source with exact HEAD-selected ETags, sizes and version IDs pinned. Contains private object locations, no credential values. |
| `service.json` | Original SF30 imported offers, fixed routes, exact MIME types and handler/admission bindings. Each offer description includes the selected snapshot ID. |
| `handlers.mjs` | Direct imports and exports for the original `--handlers` launcher. |
| `objects.json` | Readable description of the selected objects for operator review. |

Directories use mode 0700 and files 0600. A failed setup can leave partial files
in its new directory; it never overwrites another release. Inspect the result
and use a fresh directory for a new attempt.

The generated module records absolute paths to the current checkout and private
release. Generate it on the deployment host after installing the source there.
Moving the checkout or release requires regeneration; copying it unchanged is
not a portable installation procedure.

The original seller prints its loopback URL. `/_seller/health`,
`/_seller/offers`, and `/_seller/docs` remain the original operator/developer
surfaces. A request to `/downloads/report` returns the original 402 challenge.
Challenge-only mode executes neither the S3 admission nor a GET of object data.
The HEAD reads happen while loading the operator's trusted handler module.

For paid operation, use the original seller's `--facilitator` option, official
x402 dependencies and existing HTTPS deployment guide. The original operations
launcher can start this same seller with the generated `--config` and
`--handlers` arguments. The adapter does not select a facilitator or sign a
buyer payment.

## Whole files and large objects

In `whole` mode, a GET has no query parameters and returns the complete bytes
with HTTP 200. The startup HEAD fails if the file exceeds its configured
`maxBytes`. An optional expected `sha256` additionally checks the complete bytes
before the handler reports success. Empty whole objects are supported.

In `chunks` mode, the fixed paid route accepts these query parameters:

| Parameter | Meaning |
|---|---|
| `offset` | Zero-based byte offset; canonical nonnegative decimal integer; default 0. |
| `length` | Requested bytes, 1 through `maxBytes`; defaults to `maxBytes`. The final chunk is shorter when necessary. |

For example:

```text
/downloads/archive?offset=0&length=921600
/downloads/archive?offset=921600&length=921600
```

Every chunk is an independent paid request at that route's advertised price.
The original SF30 binds the actual query-bearing URL in its payment challenge.
The adapter rejects `Range` and HTTP conditional request headers; they cannot
silently alter content outside that URL. Unknown/duplicate parameters, offsets
outside the object and excessive lengths are rejected by the original admission
stage before payment verification in native mode.

Successful chunk delivery uses HTTP 206 and `Content-Range`. Both delivery modes
include:

- `Content-Type` and attachment filename from trusted operator configuration.
- `X-Content-SHA256`, the SHA-256 of the returned bytes, including a single chunk.
- `X-SF30-Object-Snapshot`, the selected object identity fingerprint.
- `X-SF30-Object-Bytes`, the complete object's byte count.

Use the original [SF88 object acquisition workflow](../../sf88-operator-buyer-cli/OBJECTS.md)
to deliver a complete large file. Its initializer selects one row from this
release's original `objects.json` and the buyer's existing approved-route config.
It verifies snapshot, total size, byte ranges and hashes; saves each response in
the original buyer inbox; continues unattempted chunks after restart; and streams
the complete private file to a new destination. The existing SF88 `--response-out`
also remains available for individual responses. Every chunk retains normal intent
approval, spend reservation and payment recovery. A missing response never
authorizes an automatic paid retry. This adapter does not grant a free re-download
entitlement after payment or combine several paid requests into one transaction.

Default `maxBytes` is 900 KiB and the hard ceiling is 1 MiB per response, matching
the original SF30 default. Large underlying objects work through chunks. Bytes
are fully bounded and buffered before SF30 settles and releases them; object
streaming to an unpaid client is never part of the adapter. The configured
`maxInFlight` defaults to four and can be 1–32. Account for the original seller's
additional response copies when sizing the process.

## Version changes and failures

Opening the source performs HEAD and retains its exact ETag, size and, when
present, VersionId. Every GET sends `IfMatch` and that VersionId. The adapter
also checks the returned ETag/version, length, Content-Range and actual streamed
byte count. S3 ETags are treated as opaque version validators, **not SHA-256**.

With object versioning, a replacement of the current object still permits the
pinned old version while that version remains accessible. With an unversioned
object, replacement causes an error instead of silently returning new data.
Pinned setup also checks those identities on restart. To publish a new version,
run `configure` from the merchant's source declaration into a new release,
review its updated offers, and restart through the existing deployment workflow.
There is no periodic reload or in-place configuration mutation.

The adapter serves the stored bytes unchanged. S3 objects declaring a nonidentity
`Content-Encoding` are rejected; store compressed downloads as ordinary binary
objects with a suitable MIME type, rather than applying transparent HTTP
compression to the object representation.

Source GETs have a total deadline, including streamed body reading. The default
is 10 seconds and the allowed range is 100 ms–60 s. The owned official client uses
one SDK attempt, no automatic region redirect and no source retry. A supplied
client must honor command AbortSignals and preserve those operator policies.
Closing the source aborts active reads; only an owned client is destroyed.

| Condition | Result |
|---|---|
| Invalid query or unsupported conditional header | Admission 400/413/416, before native verification. |
| Source at capacity | Admission 429; a later capacity race may return handler 503. |
| Selected object replaced, removed or version inaccessible | Handler 409. |
| Wrong length/range/encoding or configured digest mismatch | Handler 502. |
| Read deadline | Handler 504. |
| Credentials, permission, connection or other source failure | Safe source-unavailable error; raw SDK details are not returned to buyers. |

These failed application results use the original SF30 cancellation path.
Cancellation behavior depends on the existing payment rail and does not itself
promise a refund. No application bytes are returned as a successful paid
response when source checks fail.

## Embed or inspect as the operator

```js
import { openS3ObjectFile } from './s3/source.mjs';
const source = await openS3ObjectFile('/private/merchant/release-001/source.json');
const report = source.route('report');
export const deliverReport = report.handler;
export const admitReport = report.admit;
// After stopping an embedded seller: source.close().
```

The public module API is `createS3ObjectSource`, `openS3ObjectFile`, `route`,
`describe`, `snapshotConfig`, and `close`. `snapshotConfig` is a privileged
operator export with bucket/keys/version IDs; do not expose it through HTTP.
Admission is side-effect-free and repeats deterministic query checks against
the same immutable selection. It does not rely on shared request-object identity
between the original isolated admission copy and later handler context.

For an authorized local inspection, bypassing the HTTP seller as its operator:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/s3/cli.mjs inspect \
  --source /private/merchant/release-001/source.json \
  --object archive --offset 0 --length 921600 \
  --out /private/merchant/first-chunk.bin
```

This reserves a new 0600 destination before retrieving bytes, writes one object
or chunk, and prints its byte count/digest/snapshot. It does not call a wallet,
create payment evidence, or make a cloud object public. The SDK needs the normal
S3 read permission for the selected object/version; this package implements no
bucket writes, deletes, listings, presigned URLs or arbitrary buyer-selected keys.

## Focused integration record

`node acceptance.mjs` is the single source-native exercise for this adapter. The
recorded Linux run used Node **24.19.0** and official AWS SDK **3.1149.0**. It
validated actual SigV4-signed HEAD/GET HTTP against a controlled loopback S3
fixture, a whole-file digest, 1,843,229 bytes reassembled from three chunks,
query limits, version pinning, changed-object rejection, capacity/deadline
behavior, generated setup and the actual original SF30 HTTP402 response with
query-bound terms and no object GET. No paid cloud service or chain transaction
was executed. The fixture is not Amazon S3 or MinIO, and the record does not
claim compatibility with every third-party S3 implementation.

First-party API references: [AWS GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html),
[AWS HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html),
[JavaScript v3 S3 client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/),
and [AWS retry configuration](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html).
