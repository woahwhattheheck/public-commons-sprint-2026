# Build complete products in the runtime workspace

The runtime workspace takes a product from a committed Git recipe to its original
package, source catalog, adapter profile and installed runtime. It uses the
existing distribution builder, Git reader, package recovery and runtime installer
throughout. The package stays usable through the original command line and can
be downloaded from the same workspace.

## Open and build

Open the [runtime workspace](README.md) on the Linux operator machine. Its
existing Node, Python, npm and flock requirements apply. Choose **Build a
product**, then:

1. Enter the actual absolute directory of an existing Git repository and choose
   a branch, tag or commit already known to it. The workspace reads committed
   objects; working-tree edits are outside the selected release.
2. Choose **Load committed products**. The resolved immutable commit appears,
   along with that commit's actual recipes and **Complete toolkit**. A recipe
   that fails the original validator displays its error. Choose a product.
3. Choose **Review product**. The saved review contains the package identity,
   source commit, repository, commands, launchers, applications, exports,
   components, optional features and committed input hashes. It uses the
   original recipe validator and distribution composer. Python defaults to
   `python3`; an absolute interpreter path may be used.
4. Choose **Build reviewed product**. The original workspace records the saved
   review's request UUID and starts its original local worker. The original
   builder acquires and packages the source into the saved output directory.
5. Follow **Operations** or reopen **Build a product**. The operation shows
   `BUILDING`, `RECEIVING_SOURCE` and `SOURCE_READY` as those stages complete.
   **Open worker log** reads the existing worker's retained progress.
6. Choose **Choose adapters and install** after the source catalog is ready.
   This selects the actual retained archive in **Source & profile**. Review the
   adapter versions, prepare the new runtime, then use the original **Install /
   resume** and **Inspect runtime** controls.
7. Use **Download package** to receive the original `.tgz`. The workspace shows
   its actual filename, size and SHA-256. The archive is verified before a
   private download capability is issued and again when it is downloaded.

`SOURCE_READY` describes the packaged product and prepared source catalog.
Dependency installation has its own runtime states. Applications use the
installed source and its selected dependency profile through the existing
Applications workspace; deployment continues through the existing managed
release and host controls.

**Use local Git objects only** is selected initially. If a partial repository
lacks required objects, clear it to let the original Git reader retrieve the
exact missing objects from that repository's configured remote. This uses its
existing acquisition path and does not change the working tree, refs or
`FETCH_HEAD`. A remote branch advances only when the repository's normal Git
workflow updates its ref. Reload the catalog to resolve the current local ref.

Available products come from the selected commit rather than a browser-maintained
list. See [Product source selections](../SOURCE_SELECTIONS.md) for the recipes
and intended profiles. Adapter choices come from the completed archive.

## Reopen and continue the same build

A saved review binds the repository path, immutable commit, recipe, complete
composer inputs, product metadata, acquisition mode and Python interpreter. Its
SHA-256 identifies the review; its saved request UUID identifies the one original
workspace operation. Reviewing the same source and options returns the existing
review and UUID.

Closing the browser, losing a reply or restarting the HTTP server does not
create a new package request. Reopen **Build a product** and choose **Open
product** or **Reopen saved review**. Browser preferences are scoped to the
workspace identity. The complete saved review and operation live in the
workspace independently of browser storage. The normal **Recover last request**
control also preserves an uncertain original build request.

If request publication stopped after creating its private directory, **Continue
saving build** finishes the same saved request under its existing worker lease.
If the request exists but its initial state is absent, continuation writes only
that original unstarted state. Existing malformed or different records remain an
error; they are never replaced with a new request.

For a failed or interrupted operation, choose **Continue original build**.
Continuation acquires the original workspace worker lease and checks the
builder's original lock. If the package worker still owns that lock, the existing
operation remains selected. Otherwise, continuation keeps the same review,
request UUID, output directory, commit and recipe, and invokes the original
builder's resume path. A completed archive is adopted through original
completed-build recovery.

Source catalog preparation uses the original runtime installer. A complete
catalog is reopened and checked against the same archive and source. An
incomplete catalog remains in its original directory; recovery uses the next
fresh catalog directory through the installer's original recovery operation.
The current directory and previous attempt remain in the same build operation.
A completed catalog is registered in the original archive catalog before the
build operation succeeds.

A changed commit, recipe, repository or build option receives a different saved
review and original request UUID. Reusing a build UUID with different request
content is rejected. Choosing another product never rewrites an existing
product's output. To continue a build whose local Git object cache was incomplete,
restore the required objects in that same repository, then continue the original
request; its immutable selection is retained.

A complete build can be downloaded even if subsequent catalog preparation
failed. Its package must still pass original completed-build recovery and the
saved review's source/manifest checks. Continue the same operation to finish
catalog receiving and enable adapter selection.

## Headless workflow

Use the maintained `starforge runtime-workspace` command, or replace it with
`node stellar/scf-starforge-20261009/distribution/runtime-workspace/cli.mjs`
from the current source. Request files are private JSON files on that machine.

Create a catalog request with the real repository path:

~~~json
{
  "repository": "/srv/starforge/source",
  "ref": "HEAD",
  "offline": true
}
~~~

~~~sh
starforge runtime-workspace source-build-catalog \
  --workspace /srv/starforge/runtime-workspace \
  --request /srv/starforge/requests/product-catalog.json
~~~

Copy the returned `sourceCommit` and an available product `id` into a review
request. `ref` must be the complete returned commit SHA, not a moving branch:

~~~json
{
  "repository": "/srv/starforge/source",
  "ref": "COPY_THE_RETURNED_SOURCE_COMMIT",
  "selection": "water-operations",
  "offline": true,
  "python": "python3"
}
~~~

~~~sh
starforge runtime-workspace source-build-review \
  --workspace /srv/starforge/runtime-workspace \
  --request /srv/starforge/requests/product-review.json
~~~

Read the returned review, then copy its exact `requestId`, `reviewId` and
`selectionSha256` into the operation request:

~~~json
{
  "requestId": "COPY_THE_SAVED_REVIEW_REQUEST_UUID",
  "operation": "source-build",
  "reviewId": "COPY_THE_SAVED_REVIEW_ID",
  "selectionSha256": "COPY_THE_SAVED_REVIEW_SHA256"
}
~~~

~~~sh
starforge runtime-workspace source-build-operation \
  --workspace /srv/starforge/runtime-workspace \
  --request /srv/starforge/requests/product-build.json

starforge runtime-workspace source-builds \
  --workspace /srv/starforge/runtime-workspace

starforge runtime-workspace source-build-review-show \
  --workspace /srv/starforge/runtime-workspace \
  --review-id COPIED_REVIEW_ID

starforge runtime-workspace source-build-continue \
  --workspace /srv/starforge/runtime-workspace \
  --operation-id COPIED_ORIGINAL_REQUEST_UUID
~~~

The operation command returns after the original worker starts. `source-builds`
reports saved products, actual package details and archive IDs; ordinary `status`
reports the complete original operations and results. The output directory
contains the original `build.json` and archive, so existing `build.mjs --status`
and original runtime installation commands remain usable.

## Existing workspace API

All JSON routes use the workspace's existing private capability, Host and Origin
checks. Source paths are actual server-machine paths.

| Method and route | Input or result |
| --- | --- |
| `POST /api/source-builds/catalog` | `repository`, optional `ref` and `offline`; resolved commit and recipes |
| `POST /api/source-builds/review` | `repository`, immutable `ref`, optional `selection`, `offline`, `python`; saved review and original UUID |
| `GET /api/source-builds/review?reviewId=ID` | Complete saved review |
| `GET /api/source-builds/state` | Saved reviews, operation state, output and completed package/archive identities |
| `POST /api/operation` | Original operation with `requestId`, `operation: "source-build"`, `reviewId`, `selectionSha256` |
| `POST /api/source-builds/recover` | Original `operationId`; same request and build output |
| `POST /api/source-builds/download` | `reviewId`; single-use, 60-second URL for the verified original archive |

Catalog acquisition defaults to local Git objects. Review defaults to the
complete toolkit only when an API caller omits `selection`; the browser requires
a product choice. The original operation field validation and canonical request
identity also apply to the new operation.

A download capability is scoped to the original review. It expires when the
server closes, after one download, or after 60 seconds. A fresh capability leaves
the saved package and operation unchanged.

## Retained files

The original workspace and its files remain private to the operator account.

| Location relative to the workspace | Purpose |
| --- | --- |
| `source-builds/reviews/REVIEW_ID.json` | Immutable review and original request UUID |
| `source-builds/builds/REVIEW_ID/output/` | Original builder output, journal and `.tgz` |
| `source-builds/builds/REVIEW_ID/catalog-N/` | Original source preparation or fresh recovery attempt |
| `operations/REQUEST_UUID/request.json` | Original request and canonical request hash |
| `operations/REQUEST_UUID/state.json` | Worker progress, build receipt, catalog continuation and result |
| `operations/REQUEST_UUID/worker.log` | Original builder and installer output |
| `archives/ARCHIVE_ID.json` | Original workspace archive registration |

Runtime dependency installation uses the original runtime home and installer
records. Source product builds add no separate packaging engine, installation
ledger, hosted runner or npm dependency.
