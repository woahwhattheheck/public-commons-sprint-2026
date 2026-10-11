# Deliver a dataset from the buyer inbox

The original SF88 inbox retains the outcome of each buyer request. This adapter
turns an explicit ordered selection of its saved dataset pages into a complete
private delivery package through the original SF100 exporter. It uses the native
SF30 dataset contract, including typed filters, ranges and stable sorting.

This completes the local buyer workflow: prepare each page request, review and
execute it through the original operator workspace, retain its outcome in the
inbox, and assemble the returned pages for use. Exporting calls no buyer, signer,
seller, facilitator or payment service. Original spending approvals stay attached
to their separate requests.

## Export the selected pages

Use the existing [inbox](QUEUE.md) and original [SF30 dataset
seller](../sf30-seller-sdk/DATASET_API.md). Each page request must configure a
different `responseFile.destination` and stable intent. For a following page,
use the previous original response's `page.nextCursor` in the request URL. Each
request retains its own original operator review and spending authorization.

Once the selected attempts have saved their responses, create a private JSON
selection file in page order, for example `/private/buyer/selected-pages.json`:

```json
["inventory-page-001", "inventory-page-002", "inventory-page-003"]
```

From the repository root:

```sh
chmod 600 /private/buyer/selected-pages.json
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-dataset-cli.mjs \
  --root /private/buyer/inbox \
  --intents /private/buyer/selected-pages.json \
  --out /private/buyer/inventory-delivery
```

The output parent must already be private (`0700`), owned by the current user,
and have no symlink alias. The output directory must not exist. Inputs and
outputs use absolute paths. The CLI emits one JSON result with the package,
review, CSV and JSONL paths. It never changes the inbox or original response
files, so another local export may select the same saved data without buying it
again.

## Package contents

| Path | Contents |
| --- | --- |
| `delivery.json` | Completion manifest, explicit intent order, original attempt/config IDs, source file hashes and the native dataset manifest hash. |
| `sources/00000.response.json` | Exact bytes written by the original SF31 response-file writer. Subsequent pages use successive numbers. |
| `sources/00000.operation.json` | Original inbox operation and retained buyer outcome, including its original payment, HTTP and download results. |
| `sources/00000.evidence.json` | Original SF82 file when the retained outcome references one. |
| `dataset/dataset.jsonl` | Original typed projected rows in the seller's returned order. |
| `dataset/dataset.csv` | The same rows and column order, with spreadsheet formula prefixes neutralized in string cells. |
| `dataset/review.html` | Offline monochrome dataset, query and output review. |
| `dataset/manifest.json`, `dataset/pages/` | Original SF100 query, snapshot, page custody and export records. |

The full package contains private response data and local operator context.
Keep it in the operator's private delivery area; send customer-facing data
through the existing commercial handoff appropriate for that dataset.

## How selection is checked

An included record must have an original execution attempt, matching SF88
terminal outcome and `responseFile.status: "SAVED"`. The adapter reads the
actual saved file, matches its canonical destination, SHA-256 and byte length
against the original writer's result, and snapshots those exact bytes before
assembly. Original outcome classifications are retained as returned.

An included SF82 file must match that intent, attempt time and retained original
outcome. When inbox recovery already recorded its digest, that digest must still
match. Otherwise the manifest labels its digest as captured during this export.

Requests must be original GET operations against the same seller endpoint and
query. Page size may vary. Repeated URL parameters are rejected; the first
request has no cursor and each subsequent cursor is validated by original
SF100 against the previous source page. SF100 validates the declared dataset,
typed columns, projection, equality filters, range bounds, stable ordering,
snapshot, total row count and final cursor. It rejects duplicates, changed
queries, skipped pages and early termination before final export.

Recovery-only records do not replace a saved-download result: original SF82
does not retain that file digest. Use records whose original download summary
is present. The adapter preserves both a saved response and an unresolved
payment result when that is what the original attempt returned; the original
outcome remains the basis for commercial review.

## Failure and scale

Normal export failure removes only the new package created by that invocation.
The source inbox and downloaded files remain usable. If the process itself is
terminated, a directory without `delivery.json` is incomplete. Export the
same explicit selection into a new directory; it is an offline operation.
An existing destination is never replaced.

Up to 4,096 unique page intents are accepted. Each original response and optional
evidence file is at most 2 MiB. All copied response, operation and evidence bytes
together are limited to 256 MiB.
The original SF100 limits of one million rows, 256 MiB of archived pages and
256 MiB of combined CSV/JSONL output also apply. Bulk assembly validates each new page against the evolving
native session instead of rescanning all prior pages for every append.

The module API is `exportQueueDataset({root, intents, destination})` from
`queue-dataset.mjs`. `readDatasetSelection(path)` reads the private CLI selection
format. No environment keys are required for this export.

## Installed source and private files

The SF88 dataset delivery adapter also serves installed buyer clients. It reads
the original SF100 CLI from the installed source tree and records the Git blob
fingerprint of those bytes. Package managers may hardlink that public source
file; an installed buyer can deliver, read, copy and reopen a retained dataset
without copying the whole runtime into separate regular files first. The source
must still be a regular file at its canonical path, within the source size limit.
Symlink aliases are refused.

Private acquisition pages, evidence, delivery markers and exported files keep
their existing single-link and private-permission requirements. Sharing public
package source does not change the custody of a customer's saved data. Reopening
and copying a completed delivery use its retained pages and manifest.
