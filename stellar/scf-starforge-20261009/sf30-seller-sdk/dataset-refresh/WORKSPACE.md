# Publish merchant datasets from a local workspace

Save and compare CSV candidates, inspect their typed rows, publish through the
running SF30 seller, and reopen unfinished reviews from one operator interface.
Named candidates, notes, the selected query, publication history and prepared
buyer configurations remain available after restart. The workspace uses
the original dataset loader and private `datasetControl()` API. The existing
version store remains the only publisher; the seller keeps its current routes,
payment terms, verification, settlement and buyer cursor behavior.

## Open the workspace

Use Node 22+ on Linux with util-linux `flock` and a complete current checkout containing the original versioned
seller's revision-aware `refresh` and `activate` controls. Start that seller with
the existing [versioned dataset commands](README.md). Keep it running, then open
a separate operator terminal:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workspace.mjs \
  --state /srv/dataset-state --port 8431 \
  --resource https://your-api.example/data \
  --seller http://127.0.0.1:8430
```

`--resource` is optional. It adds a link to the operator's existing public route;
the workspace never contacts that public URL. Add `--seller` with the existing
seller's loopback origin to enable buyer preparation. It reads only that seller's
original `/_seller/health` and `/_seller/offers`, without redirects or credentials.
`--port 0` selects a free local port. The default
upload limit is 64 MiB; `--max-upload-bytes` accepts 1 KiB through 256 MiB, subject
to the published dataset's own lower byte limit.

Saved work defaults to `/srv/dataset-state/.publisher-workspace`. Use
`--workspace /private/merchant-work` to choose a different private directory and
pass the same path when reopening. The default retained capacity is 32 candidates
and 256 MiB of CSV source; `--max-drafts` accepts 1–256, and `--max-draft-bytes`
accepts 1 KiB–4 GiB. The upload limit still applies to each individual file.

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
   a private retained candidate and takes its schema from the actual current
   generation's `dataset.json`, verified against its original `configHash`.
   Columns, types, filters, ordering and page limits are retained. A bad upload
   leaves both the published data and all preceding valid candidates available.
   Give the candidate a name and save review notes. The saved-candidate table
   reopens any earlier upload without sending the CSV again.
3. **Inspect the draft.** Choose columns, combine configured equality/range
   conditions, select ordering and page size, and move between pages. All
   results come from the original `loadDatasetConfig`, `admit` and `handle`
   implementation. The page can export the displayed typed JSON result and
   copy its exact query. The last successful query and selection are saved;
   reopening starts that query at its first page. Previews read local data
   without purchasing it. **Download CSV** returns the original uploaded bytes;
   **Export review** saves the schema, source hashes, notes and publication history.
4. **Publish the reviewed draft.** The workspace passes its unchanged private
   configuration and the displayed original snapshot/revision to the existing
   refresh control. That store validates the full contract, stages its own
   immutable generation and promotes it under its existing retention rules.
   New queries use the new version; existing cursors retain the original
   seller's continuity behavior. Publication retains the reviewed candidate
   and its result in the saved-candidate table. Its CSV and notes remain available.

The draft records the source revision observed when upload began. If another
operator publishes or activates a version, stale publication is refused by the
original compare-and-swap. The draft remains available and the workspace reloads
the displayed status. Choose **Review on latest revision** to explicitly review the same candidate
against the new current version. A normal status refresh never silently changes
the draft's publication expectation.

If a publication response is interrupted, reopening reads the original seller's
current state before another attempt. **Check publication** compares the current
version's snapshot, CSV hash, configuration hash and source size with the saved
candidate. A matching current generation is recorded as **Current version
observed**. Otherwise, inspect the displayed original revision and use **Review
on latest revision** before deciding to publish again. The workspace retains the
attempt and performs no automatic second publication.

## Retained versions and rollback

Choose **Inspect** for a retained version to query its actual immutable data.
Choose **Select for rollback**, review the exact snapshot and current revision,
then **Make current**. Activation uses the original control's revision-aware
operation; it neither reconstructs a CSV nor writes the version-state file.

**Collect expired** calls the original collection operation. Only the store
decides which retired generations can be removed, including its active-reader
protections. Capacity errors leave the draft available for a later publication.
An expired or concurrently collected version may no longer be inspectable.

## Prepare acquisition of the selected publication

Enable the original versioned seller's `configure --snapshot-selection` option
when generating its service config. The workspace requires the actual running
offer to advertise that optional parameter; it does not infer support or change
the seller's configuration.

Inspect a current or retained version, choose the desired columns, filters,
ordering and page size, then **Load seller offer**. The workspace checks this
query with the original dataset parser and loads the exact matching advertised
GET offer. The review shows its actual payment alternatives, atomic price,
asset, recipient, seller mode and selected version's expiry. It always starts
acquisition at the first page of the inspected query, even after previewing
later pages.

Choose the payment alternative and a unique acquisition ID, then **Prepare buyer
config**. The workspace reloads the offer and refuses a changed offer digest. It
passes the saved original offer directly to SF88 `prepareReview()`, including
the selected snapshot in the request URL. **Download buyer JSON** saves that
original config, with its native discovery provenance and no operator settings
or keys. Preparation also saves those exact bytes in **Saved buyer configurations**,
where they can be downloaded after restart. The table shows whether the selected
version remains available. Query/version/offer changes clear the current review;
saved files keep their original terms and selected snapshot. Use **Remove** when
a saved buyer file is no longer needed.

Use the downloaded config with the original buyer's `--review` and
`--init-workspace` commands. Supply the real payer, Python runtime and explicit
total/daily atomic budgets through that existing setup. Then attach the created
workspace to the original dataset acquisition:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs init \
  --session /private/acquisitions/selected-dataset \
  --workspace /private/dataset-buyer --max-pages 20 --max-total-atomic 20000
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs run \
  --session /private/acquisitions/selected-dataset
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs deliver \
  --session /private/acquisitions/selected-dataset --out /private/deliveries/selected-dataset
```

The example budgets and paths must match the buyer's chosen limits. See the
original [acquisition guide](../../sf88-operator-buyer-cli/DATASETS.md) for setup,
pause/resume and delivery. Each new page still requires the original fresh quote
review, approval, reservation and signer path. A prepared config does not pay
for the dataset or keep a retired version alive. If it expires, the original
seller refuses the request before native payment processing. Completed pages
remain available for offline SF100 export.

## Operation and storage

The workspace owns its private retained directory and a local preview cache.
The directory contains `workspace.json`, `candidates/`, `buyers/`, `staging/`
and its kernel-owned `publisher.lock`. It is bound to the original dataset state
directory. A second process using that same workspace is rejected while its
current process holds the lock; process exit releases it automatically.

Source files are private and become read-only after validation. Metadata is
committed through private atomic file replacement. A completed upload or buyer
preparation interrupted before its index update is recovered at the next open.
Incomplete uploads are cleared within this workspace; damaged recovered entries
are preserved and listed for source repair while other saved work stays usable.
Explicit removals are recorded before file deletion so removed work cannot
reappear after an interrupted cleanup.

It accepts CSV bytes and constrained action
fields over HTTP, never a caller-supplied filesystem path. Published generation
configuration is read with private-file and digest checks. It does not modify
the original version manifest, seller configuration, payment data or pricing.

Only one workspace action is executed at a time. The source parser's existing
row, cell, page and CSV limits apply. Memory can include one draft dataset and
one inspected retained dataset in addition to the seller's own cache; CSV byte
limits are not a bound on parsed JavaScript memory. Use appropriate source limits
for the merchant's machine.

Ctrl+C completes the active action, closes the local session and releases the
workspace lock. Reopen the same command to resume saved work with a new private
session URL. **Remove candidate** explicitly removes the chosen saved source and
its review history after any interrupted publication has been reviewed. It does
not remove that candidate's published generation. Download CSVs and review files
before removing work you want to keep elsewhere. Back up the complete private
workspace directory together with its corresponding original dataset state.

The interface is self-contained industrial software: no external assets,
analytics, account service or background polling. Status refresh, publication,
rollback and collection are explicit operator actions. API requests require
the private session capability and original local Host/Origin.

## Focused product exercise

`workspace-acceptance.mjs` performs one original-services HTTP workflow with
disposable example CSVs: upload/validation, original query pagination, an
intervening publication, explicit re-review, publication, actual offer selection,
original buyer workspace initialization and pinned acquisition across a
publication change, pause/resume, original SF100 CSV/JSONL delivery, retained
activation, collection and workspace shutdown. It uses the actual version store,
seller HTTP service in challenge-only mode, and a separate free original native
HTTP acquisition path. It makes no wallet or settlement request.
The exercise drives the workspace API used by the interface and requests its
served assets; it does not claim browser interaction or visual verification:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workspace-acceptance.mjs
```

The workspace uses Node built-ins, the original repository and Linux util-linux
`flock`; it has no browser build or external asset dependency.
