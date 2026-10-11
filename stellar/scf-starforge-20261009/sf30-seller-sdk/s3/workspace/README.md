# S3 merchant workspace

Prepare private S3 whole files and chunked products in one saved local
application. The workspace retains source and price revisions, actual object
metadata inspections and prepared packages. The original SF82 release system
owns comparison, activation, seller startup, graceful drain and rollback. The
customer receives the unchanged object and offer files consumed by the original
SF88 object buyer.

## Open

Install the original [S3 adapter dependencies](../README.md) and use Node 22.16
or newer. This workspace uses built-in SQLite and adds no runtime dependencies.
Use the merchant's existing AWS environment or configured default provider chain
on the machine running the application.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/s3/cli.mjs workspace \
  --state /private/object-merchant \
  --source /private/products/source.json \
  --payment /private/products/payment.json \
  --origin https://downloads.your-merchant.example
```

Open the exact private local URL printed by the command. Source/payment/origin
import the first revision together; they do not replace an existing revision.
The browser also imports the original JSON files into its editor. For a new
merchant, start with just `--state` and enter the merchant's real source and
approved terms. To reopen after moving the original import files, use just the
same `--state` directory.

Pass `--release-store /private/product-releases` to share an existing merchant's
original SF82 store. Its canonical path is retained and reused on reopening.
Without that argument the store is `releases/` inside the workspace. The first
store selection remains associated with this workspace.

## Source to customer

1. **Storage connection.** Review region, bucket, optional endpoint, credential
   provider, expected bucket owner and source limits. Credentials remain in the
   original host provider; the original source schema accepts no credential
   values.
2. **Selected products.** Edit each approved key, public ID and route, delivery
   mode, per-response size, filename and MIME type. Existing version IDs, ETags,
   byte counts and whole-file SHA-256 pins remain exact. Clear a pin deliberately
   when selecting a newer object.
3. **Payment terms.** Edit the complete original payment object or existing
   `stellar-forge.s3-payments.v1` per-product map. The original compiler validates
   every route. Atomic amounts stay strings and native extra options are
   retained. Save the source and all terms together as one revision.
4. **Inspect saved objects.** The original AWS SDK performs the configured HEAD
   reads. The workspace retains the exact selected source, public description
   and compiled offers. Review total bytes, whole/chunk contracts, snapshots,
   recipients, assets and prices together.
5. **Prepare selected inspection.** Original `configureS3Seller` consumes those
   recorded pins and writes its existing four-file package. Original
   `prepareS3Release` verifies it. Preparation performs no second HEAD and cannot
   silently substitute newer object bytes.
6. **Stage original release.** Choose a new release ID and original runtime
   settings. Existing `stageRelease` retains the exact S3 package in SF82.
7. **Operate.** Open the original release console, compare the retained version,
   activate it with the current generation and start the original merchant.
   That console owns its seller, operations view, restart, drain and rollback.
8. **Customer handoff.** Download that release's original `objects.json` and
   `offers.json`. The browser verifies their complete digests. These files remain
   available after the preparation directory moves and feed directly into the
   existing [object buyer](../../../sf88-operator-buyer-cli/OBJECTS.md).

Port `0` and challenge-only mode are the defaults. Staging accepts the merchant's
existing facilitator URL and original native runtime settings. SF30 and the
existing buyer remain responsible for native payment execution.

## Revisions and interrupted work

SQLite commits the complete source, complete payment JSON and origin with an
expected-revision check. Another browser or MCP process can advance the same
workspace. An older tab gets a conflict when saving; refresh history without
losing tab edits, then reopen the current source or restore and reconcile the
retained tab draft. Opening an old version and saving creates a new revision.
Historical revisions remain unchanged. History supports explicit pagination.

Each inspection, preparation and staging request has a stable operation ID.
Repeating a completed inspection returns its saved selection without another
HEAD. Preparation and staging reconcile original completed files after an
interrupted response. The same ID with different inputs returns a content
conflict. If a process ended before an inspection result was committed, the
same read-only inspection may run again; preparation still requires the exact
resulting retained review ID.

A native SQLite operation lock serializes long actions across processes and
releases automatically on process exit. Another live operation is reported by
its saved ID. Partial original package files stay available for inspection.
Resume the same preparation ID to reconcile those files, or prepare the retained
review under a new ID when the original package is incomplete. Closing waits
for accepted authoring operations and then drains the original release console
and seller owned by this application. Other operators retain their own sellers.

| Private path | Retained material |
| --- | --- |
| `workspace.sqlite` | Source/price revisions, selected reviews and authoring operations |
| `operations.sqlite` | Native crash-released operation ownership |
| `packages/<operation-id>/` | Original source, service, handler and public objects files |
| `releases/` | Default original SF82 store, unless another store was selected |

The directory and files use private permissions. Retain them with the
merchant's existing host backup/recovery. The saved source deliberately includes
private bucket and object locations so the original merchant can reopen it.
Customer downloads contain only the original public object and offer files.

## Native API

```js
import { openS3MerchantWorkspace } from './workspace/controller.mjs';
const workspace = await openS3MerchantWorkspace({
  directory: '/private/object-authoring',
  releaseStore: '/private/product-releases',
});
const { draft } = await workspace.status();
const review = await workspace.review({
  revision: draft.revision, operationId: 'inspect-products-20261011',
});
const prepared = await workspace.prepare({
  revision: review.revision, reviewId: review.reviewId,
  operationId: 'prepare-products-20261011',
});
const staged = await workspace.stage({
  packageId: prepared.packageId, releaseId: 'products-v1',
  operationId: 'stage-products-20261011', runtime: { port: 0 },
});
const customer = await workspace.exportCustomer({ releaseId: staged.release.id });
await workspace.close();
```

The API also provides `history`, `revision`, `save`, `getReview`, `getPackage`,
`readCustomerFile` and `openReleaseConsole`. The file reader returns verified
ranges up to 65,536 bytes with full digest, offset, next offset and EOF. It
accepts only the two original customer filenames. Runtime staging accepts only
the original S3 port, facilitator and loopback-facilitator fields.

The server binds to `127.0.0.1`, checks exact Host and Origin, and requires a
random session token for every private API call. Browser assets are local.
Credential values are resolved by the native process and never appear in the
browser responses.
