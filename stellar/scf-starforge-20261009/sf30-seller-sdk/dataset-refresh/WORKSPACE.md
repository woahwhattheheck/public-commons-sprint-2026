# Publish merchant datasets from a local workspace

Upload a CSV, inspect its typed rows, publish it through the running SF30 seller,
and return to a retained version from one operator interface. The workspace uses
the original dataset loader and private `datasetControl()` API. The existing
version store remains the only publisher; the seller keeps its current routes,
payment terms, verification, settlement and buyer cursor behavior.

## Open the workspace

Use Node 22+ and a complete current checkout containing the original versioned
seller's revision-aware `refresh` and `activate` controls. Start that seller with
the existing [versioned dataset commands](README.md). Keep it running, then open
a separate operator terminal:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workspace.mjs \
  --state /srv/dataset-state --port 8431 \
  --resource https://your-api.example/data
```

`--resource` is optional. It adds a link to the operator's existing public route;
the workspace never contacts it. `--port 0` selects a free local port. The default
upload limit is 64 MiB; `--max-upload-bytes` accepts 1 KiB through 256 MiB, subject
to the published dataset's own lower byte limit.

Open the printed private session URL on the same computer. The workspace binds
only `127.0.0.1`. Keep it outside the public HTTPS proxy. Its session capability
starts in the URL fragment, is removed from the address bar, and stays in that
origin's browser session storage. The original seller control capability stays
on disk and is never sent to the browser.

If the container cannot open Unix sockets, start the **original seller** with
its documented `--control-transport loopback` option. The workspace consumes
that same private control descriptor; no alternative publication path is added.

## Upload, inspect and publish

1. **Inspect current data.** The top summary shows the original seller's current
   revision, row count, retained CSV bytes and version capacity. The version
   table shows retirement expiry and the original active-reader counts.
2. **Choose a CSV and validate it.** The workspace copies the uploaded bytes into
   a private session draft and takes its schema from the actual current
   generation's `dataset.json`, verified against its original `configHash`.
   Columns, types, filters, ordering and page limits are retained. A bad upload
   leaves both the published data and the preceding valid draft available.
3. **Inspect the draft.** Choose columns, combine configured equality/range
   conditions, select ordering and page size, and move between pages. All
   results come from the original `loadDatasetConfig`, `admit` and `handle`
   implementation. The page can export the displayed typed JSON result and
   copy its exact query. Previews read local data without purchasing it.
4. **Publish the reviewed draft.** The workspace passes its unchanged private
   configuration and the displayed original snapshot/revision to the existing
   refresh control. That store validates the full contract, stages its own
   immutable generation and promotes it under its existing retention rules.
   New queries use the new version; existing cursors retain the original
   seller's continuity behavior.

The draft records the source revision observed when upload began. If another
operator publishes or activates a version, stale publication is refused by the
original compare-and-swap. The draft remains available and the workspace reloads
the displayed status. Choose **Review on latest revision** to explicitly review the same candidate
against the new current version. A normal status refresh never silently changes
the draft's publication expectation.

## Retained versions and rollback

Choose **Inspect** for a retained version to query its actual immutable data.
Choose **Select for rollback**, review the exact snapshot and current revision,
then **Make current**. Activation uses the original control's revision-aware
operation; it neither reconstructs a CSV nor writes the version-state file.

**Collect expired** calls the original collection operation. Only the store
decides which retired generations can be removed, including its active-reader
protections. Capacity errors leave the draft available for a later publication.
An expired or concurrently collected version may no longer be inspectable.

## Operation and storage

The workspace owns only its `.publisher-*` session directory, private draft
files, and a local preview cache. It accepts CSV bytes and constrained action
fields over HTTP, never a caller-supplied filesystem path. Published generation
configuration is read with private-file and digest checks. It does not modify
the original version manifest, seller configuration, payment data or pricing.

Only one workspace action is executed at a time. The source parser's existing
row, cell, page and CSV limits apply. Memory can include one draft dataset and
one inspected retained dataset in addition to the seller's own cache; CSV byte
limits are not a bound on parsed JavaScript memory. Use appropriate source limits
for the merchant's machine.

Ctrl+C closes this workspace and removes its unpublished session drafts after
its active action completes. The separately running seller and published
versions remain available. The original CSV chosen in the browser is unchanged.
An unclean process termination can leave private draft directories; remove only
an abandoned `.publisher-*` directory after its workspace process has stopped.

The interface is self-contained industrial software: no external assets,
analytics, account service or background polling. Status refresh, publication,
rollback and collection are explicit operator actions. API requests require
the private session capability and original local Host/Origin.

## Focused product exercise

`workspace-acceptance.mjs` performs one original-services HTTP workflow with
disposable example CSVs: upload/validation, original query pagination, an
intervening publication, explicit re-review, publication, retained activation,
collection and workspace shutdown. It uses the actual version store and seller
HTTP service in challenge-only mode. It makes no wallet or settlement request.
The exercise drives the workspace API used by the interface and requests its
served assets; it does not claim browser interaction or visual verification:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workspace-acceptance.mjs
```

The workspace itself needs only Node built-ins and the original repository.
