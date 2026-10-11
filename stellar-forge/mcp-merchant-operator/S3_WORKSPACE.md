# Author and deliver an S3 merchant through MCP

Use the existing merchant MCP provider to edit the same saved S3 product that
opens in the [S3 browser workspace](../../stellar/scf-starforge-20261009/sf30-seller-sdk/s3/workspace/README.md).
One native SQLite model retains revisions, actual object-selection reviews and
preparation operations. The existing SF30 source reader and offer compiler
produce the seller, and the existing SF82 release store supplies comparison,
activation, runtime ownership and rollback.

## Connect a saved workspace

Use the complete source checkout and the original S3 adapter's installed AWS
SDK dependency. Create an owner-only workspace directory on the merchant host.
The host supplies its normal AWS credential-provider environment; credentials
remain with the original SDK. A new empty directory can receive its first
draft through `merchant_s3_save`.

Write a private connection file, such as `/private/merchant/s3-connection.json`:

```json
{
  "schema": "stellar-forge.s3-workspace-connection.v1",
  "workspaces": {
    "reports": {
      "label": "Reports and datasets",
      "directory": "/private/merchant/s3-authoring",
      "runtime": {
        "port": 0
      }
    }
  }
}
```

Directories must already exist with mode `0700`. The connection file must be
an owned regular file with mode `0600`. Each alias selects one original
workspace. Relative paths resolve beside the connection file. Aliases use
1–64 lowercase letters, digits, underscores or hyphens.

Create a merchant operator:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-s3-workspaces \
  --dir /private/merchant/operator \
  --connection /private/merchant/s3-connection.json \
  --name "Reports merchant"
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/merchant/operator/merchant-mcp.json \
  --port 3211
```

Set `MCP_ACCESS_TOKEN` through the host's environment before `serve`. The
existing MCP transport listens on loopback and requires that bearer token.
Its normal `--token-env` and `MCP_CLIENT_ORIGINS` settings apply.

For a workspace already used in the browser, include its existing
`"releaseStore": "/private/existing-workspace/releases"` in the connection
file. Initialization adopts that store. The model retains this choice and
rejects a later request to open it with a different release store.

To add authoring to an existing merchant operator, add
`"s3WorkspaceConnection": "/private/merchant/s3-connection.json"` to its
existing `merchant-mcp.json`. Both configurations must select the same release
store. All previously configured source aliases and merchant tools continue
through that original operator.

Optional per-alias runtime fields are `port`, `facilitator` and
`allowLocalFacilitator`. These are host settings used by `merchant_s3_stage`.
The native runtime validates the selected facilitator. Keep production public
origin, reverse proxy, configured facilitator and AWS access in the merchant's
existing deployment.

## Work from a saved revision

1. Call `merchant_s3_status` to list declared aliases, then
   `merchant_s3_open {"workspace":"reports"}`. Opening retains a handle to the
   original model. Listing configuration and opening the database do not read
   remote objects.
2. Read `merchant_s3_status {"workspace":"reports"}` and its draft revision.
   Use `merchant_s3_revision` with `includeSource:true` when the edit needs
   the private source definition. Ordinary status omits bucket/key locations.
3. Save the entire native source, payment document and public HTTPS origin
   through `merchant_s3_save`. Supply the current `expectedRevision`, or
   `0` for the first revision, and a chosen `operationId`.
4. Run `merchant_s3_review` for that exact saved revision and retain its
   `reviewId`. This is the operation that performs the original AWS SDK HEAD
   requests and captures actual sizes, content types and ETag/version pins.
5. Prepare with that revision, `reviewId` and a new `operationId`. Preparation
   uses the saved selection and original compiler to retain
   `source.json`, `service.json`, `handlers.mjs` and `objects.json`.
6. Stage the prepared `packageId` with a chosen release ID. The original
   release store retains its native package and offers.
7. Continue through `merchant_compare`, `merchant_activate` and
   `merchant_start`. Use the returned release digest and current selection
   generation. `merchant_catalog` exposes the actual running seller's
   health, offers and OpenAPI through its owned instance ID.

A save request has this structure; `source` and `payment` are the complete
original JSON documents:

```json
{
  "workspace": "reports",
  "expectedRevision": 0,
  "operationId": "reports-save-v1",
  "source": {
    "schema": "stellar-forge.s3-source.v1",
    "region": "us-east-1",
    "bucket": "merchant-private-reports",
    "credentialProvider": "environment",
    "objects": [
      {
        "id": "report",
        "path": "/downloads/report",
        "key": "exports/approved-report.pdf",
        "mode": "whole",
        "maxBytes": 921600,
        "contentType": "application/pdf",
        "filename": "report.pdf",
        "description": "Download the approved report"
      }
    ]
  },
  "payment": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "asset": "REPLACE_WITH_SELECTED_ASSET",
    "payTo": "REPLACE_WITH_MERCHANT_RECIPIENT",
    "amount": "10000",
    "maxTimeoutSeconds": 60
  },
  "origin": "https://reports.example"
}
```

Replace the deployment, object and payment values with the merchant's actual
selection. The [original S3 configuration](../../stellar/scf-starforge-20261009/sf30-seller-sdk/s3/README.md)
defines whole-file and per-request chunk products, size limits, version pins,
endpoint settings and supported credential providers. Payment can use the
original shared terms or the original `stellar-forge.s3-payments.v1`
document keyed by object ID. Each selected object's offer is validated by the
same native compiler.

Saved edits are immutable. If another browser or MCP editor saves first, a
stale expected revision returns `REVISION_CONFLICT`. Read the new head, merge
the intended fields, and save with that revision. Preparation can continue
from an older saved revision because it remains bound to its exact review.

## Authoring tools

| Tool | Use |
| --- | --- |
| `merchant_s3_status` | List aliases or inspect an open workspace's head, history, reviews, packages, operations and releases. |
| `merchant_s3_open` | Open or reopen the selected original workspace. |
| `merchant_s3_close` | Drain accepted authoring work and close this provider's handle. |
| `merchant_s3_history` | Page saved revisions with `limit` and the returned `nextBeforeRevision`. |
| `merchant_s3_revision` | Read exact saved payment/origin terms; request private source explicitly. |
| `merchant_s3_save` | Save a complete draft with its expected head and operation ID. |
| `merchant_s3_review` | Read the selected objects' native HEAD metadata and retain the review. |
| `merchant_s3_review_status` | Retrieve a saved review without repeating HEAD. |
| `merchant_s3_prepare` | Produce or finish the native package for a saved review. |
| `merchant_s3_package` | Inspect a complete package and its original file digests. |
| `merchant_s3_stage` | Stage that package into this merchant's original SF82 store. |
| `merchant_s3_customer` | List the release's exact original customer JSON files and hashes. |
| `merchant_s3_customer_file` | Read a SHA-pinned range of either customer file. |

The final two operations supply the original object buyer's `objects.json`
and `offers.json`. The existing merchant lifecycle tools supply activation,
seller ownership, general client SDK export and rollback.

## Download the original buyer inputs

Inspect the exact release before delivery:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs inspect-s3 \
  --url http://127.0.0.1:3211 --workspace reports --release-id reports-v1
node stellar-forge/mcp-merchant-operator/serve.mjs download-s3 \
  --url http://127.0.0.1:3211 --workspace reports --release-id reports-v1 \
  --out /private/customer/reports-v1
```

Both commands use the same bearer token environment as the MCP connection.
Add `--release-digest` with the reviewed digest to pin the selected release.
`--chunk-bytes` selects 1–65536 bytes per native metadata-file read.

The downloader writes the exact `objects.json` and `offers.json` to the
selected private output directory. It checks every returned file identity,
offset and byte count, then verifies the complete original SHA-256 before
publishing each file. These files feed the
[original object buyer](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/README.md).
Purchasing whole objects or chunks continues through that buyer's existing
quote, confirmation, payment and retained-download workflow.

Run the same download command after interruption. A completed matching file
is reused; an unfinished metadata file restarts. A local
`s3-download-state/selection.json` records the original endpoint, workspace,
release digest and native file descriptions so that a different selection
cannot replace this download. The original Linux file lease prevents two
clients from writing the same output directory. A different file already
published at either destination is reported as a conflict and preserved.

## Reopen and continue

Operation IDs use 8–80 lowercase letters, digits or hyphens and start with a
letter. Keep each ID with its original input. After a lost response:

- A repeated save returns the same revision. Different content under that ID
  returns `OPERATION_CONTENT_CONFLICT`.
- A repeated completed review returns its saved pins; `review_status` also
  reads them directly. A process loss before the original review commits may
  require the same review operation to perform its HEAD reads again.
- Repeating prepare reconciles its original package files. The native compiler
  completes matching missing output files and rejects differing retained bytes.
- Repeating stage reconciles its original release ID, package and runtime.
  Existing release contents must match before the original operation completes.
- Customer reads retain the release and file digest. They remain available
  after the seller stops or the MCP process reopens.

The browser command opens this same saved authoring directory:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/s3/cli.mjs workspace \
  --state /private/merchant/s3-authoring
```

It uses the retained release-store choice and original revision concurrency.
Its release console and the MCP provider each retain ownership of the sellers
they start. Use the original runtime status and instance controls to transfer
operation between them. Closing an MCP S3 authoring handle preserves the saved
model and does not stop the separate seller owned by that merchant provider.

