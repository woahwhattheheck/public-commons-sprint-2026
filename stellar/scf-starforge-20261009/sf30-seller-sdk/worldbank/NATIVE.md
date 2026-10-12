# World Bank native workspace and merchant integration

The World Bank workspace keeps source selection, downloaded pages, observation review and exports in one local directory. Its Node entry point runs the original Python data engine and connects reviewed exports to the existing SF30 dataset publisher, SF82 releases and SF88 buyer acquisition.

## Open the workspace

Use Python 3.10 or later on Linux or macOS and the installed Starforge package. The source engine uses the Python standard library and POSIX file locks:

~~~sh
starforge worldbank workspace --directory /absolute/worldbank-work
~~~

The command prints a private loopback session URL. Open it to manage selections, retrieve source catalogs, start or cancel captures, compare results, review duplicate observation choices and prepare exports. The source engine retains original downloaded pages and source metadata as capture proceeds.

From a source checkout, the equivalent is:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/cli.mjs workspace \
  --directory /absolute/worldbank-work --python python3
~~~

The server listens only on 127.0.0.1. Closing it signals its owned capture children and drains its original seller. It does not control other workspace processes.

## Source actions

All action payloads are JSON objects. Use an input file, literal JSON, or standard input:

~~~sh
starforge worldbank action save-selection --directory /absolute/worldbank-work \
  --input selection.json

starforge worldbank action capture --directory /absolute/worldbank-work \
  --json '{"id":"population-2020-2024","selectionId":"population"}'

starforge worldbank action observations --directory /absolute/worldbank-work \
  --json '{"captureId":"population-2020-2024","offset":0,"limit":100}'
~~~

The direct CLI waits for its capture and prints the final job plus retained workspace state. A browser capture is asynchronous, so its interface remains available while pages arrive.

| Action | Payload |
| --- | --- |
| state | Empty object |
| save-selection | id, title, expectedRevision and spec containing sourceId, countries, indicators, date, perPage |
| catalog | kind: countries, sources or indicators; optional sourceId and search |
| capture | id and selectionId |
| import-pages | id, selectionId and pages containing original response bytes plus their receipts |
| capture-cancel | id of a capture owned by this running workspace |
| capture-detail | id of the retained capture |
| observations | captureId; optional search, offset, limit |
| compare | captureId and baselineId |
| review | id, captureId, optional baselineId, title, note, excludedKeys, expectedRevision; optional choices mapping a source key to rowId |
| review-read | id |
| export | id and reviewId |
| export-read | id |
| import-package | id, optional reviewId and complete archiveBase64 from an existing handover.zip |

Use the revision displayed by the source engine when updating a selection or review. Observation values remain exact source strings or null; review chooses among original rows and excludes selected identities.

An imported page carries kind, page, bodyBase64 and receipt. Individual indicator metadata also carries indicatorId and the original requestGroup. The importer validates the receipt URL against the selected request and the retained bytes against their length and SHA256. This supports an acquisition from another authorized worker while preserving its original response bodies and source request identities.

The source import actions accept complete original source responses or the retained handover ZIP. Their JSON input capacity is 256 MiB; other action payloads allow 1 MiB. The core verifies archive members, retained hashes and source selection while reconstructing the same capture and review workflow.

Cancel and resume through the same running workspace:

~~~sh
starforge worldbank action capture-cancel --url 'PRINTED_SESSION_URL' \
  --json '{"id":"population-2020-2024"}'
~~~

After cancellation or a source failure, start capture again with the same capture id and selectionId to use the engine's retained continuation. The returned error and capture metadata retain a provider retryAt where available.

## Prepare an original dataset merchant

First build a review and export through the source engine. export-read verifies the immutable export manifest before merchant preparation.

~~~sh
starforge worldbank action merchant-prepare --directory /absolute/worldbank-work \
  --input merchant.json
~~~

merchant.json contains:

~~~json
{
  "exportId": "population-reviewed-v1",
  "origin": "https://YOUR_MERCHANT_ORIGIN",
  "path": "/worldbank",
  "payment": {
    "scheme": "exact",
    "network": "YOUR_STELLAR_NETWORK",
    "asset": "YOUR_ASSET",
    "amount": "YOUR_ATOMIC_AMOUNT",
    "payTo": "YOUR_SELLER_ADDRESS",
    "maxTimeoutSeconds": 60
  }
}
~~~

Supply the actual public payment terms used by the existing seller. The original buildDatasetSellerConfig compiler validates the origin, route and terms.

The bridge performs the following operation:

1. Verify export-read and load its original dataset.json through loadDatasetConfig.
2. Create seller.json beside the export using the existing dataset seller compiler.
3. Verify the immutable source manifest again.
4. Call openSocrataPublisher and its original publisher.prepare with that export directory.
5. Retain a World Bank merchant binding containing the original export manifest, seller digest and prepared package directory.

A repeated preparation with the same terms reuses the saved seller. Changed terms require a new export id. Core dataset.csv, dataset.json, source.json and original page files remain bound by the source engine's manifest.

The publisher name reflects its original implementation; this integration uses its generic exportDirectory input and existing version, release and buyer stores. Its cursor contract, snapshot retention, release generations and buyer spending limits remain those of the native engines.

## Release, publish and acquire

Use the draft id returned by merchant-prepare and the current generation from publisher state:

~~~sh
starforge worldbank action publisher.release.stage --directory /absolute/worldbank-work \
  --input release-stage.json

starforge worldbank action publisher.release.activate --directory /absolute/worldbank-work \
  --input release-activate.json

starforge worldbank action publisher.release.start --directory /absolute/worldbank-work \
  --input release-start.json
~~~

The payloads are the original publisher payloads:

| Action | Payload |
| --- | --- |
| publisher.status | Empty object |
| publisher.preview | target, query |
| publisher.reviewDraft | draftId, expectedSnapshot, expectedRevision |
| publisher.publish | draftId, expectedSnapshot, expectedRevision |
| publisher.activateSnapshot | snapshot, expectedSnapshot, expectedRevision |
| publisher.collect | Empty object |
| publisher.release.stage | draftId, id; optional label and runtime |
| publisher.release.inspect | id |
| publisher.release.activate | id, expectedGeneration |
| publisher.release.rollback | expectedGeneration |
| publisher.release.start | expectedGeneration |
| publisher.release.stop | Empty object |
| publisher.buyer.review | snapshot, query |
| publisher.buyer.prepare | review, intentId, acceptIndex, offerSha256 |
| publisher.buyer.session | buyerId, workspaceDirectory, maxPages, maxTotalAtomic; optional maxRows and maxPageBytes |
| publisher.buyer.run | id; optional retryUnpaid and expectedAttemptSha256 |
| publisher.buyer.recover | id |
| publisher.buyer.account | id |
| publisher.buyer.export | id |

Starting a release keeps that operator alive and prints its local session URL. Use that URL in the browser or --url to operate the same owner of the running seller. A different process cannot stop a release it does not own.

For an updated source export, merchant-prepare creates the next original draft in the same publisher. Review and publish it against the displayed expectedSnapshot and expectedRevision. The original version engine preserves valid retained snapshots for existing cursors. Changes to query capabilities use a separate publisher directory.

Buyer review reads the actual current seller offer and preview. Buyer preparation binds that offer; session creation carries the existing buyer workspace and explicit limits. The original SF88 acquisition commands perform and recover the paid pages, then account and export their delivery.

## HTTP and programmatic entry points

Import openWorldBankOperator and startWorldBankWorkspace from @tokenjunkielabs/starforge-merchant/seller/worldbank, or from native.mjs in this source directory.

- GET /api/state returns the original core state with publisher and jobs.
- POST /api/action takes {action,payload} and returns {result,state}.
- A capture result starts with RUNNING; jobs records its eventual COMPLETE, FAILED or CANCELLED result.
- capture-cancel changes an owned running job to CANCELLING and sends SIGTERM to that child.
- Successful operations retain result even if a separate state refresh fails; state is null with stateError in that case.
- Errors use {error:{code,message}} and include retryAt when the original source engine returns it.
- GET /api/exports/EXPORT_ID/RELATIVE_FILE serves only an exact file listed in the verified source manifest.
- GET /api/publisher/exports/KIND/ID serves the original publisher's draft, buyer and completed acquisition files.

API requests carry Authorization: Bearer TOKEN from the local session fragment. The server verifies its local Host and Origin and rejects cross-site requests.

Programmatic operators expose state(), act(action,payload), waitCapture(id), readExport(id,filename), readPublisherExport(kind,id) and close(). A server supplied with an existing operator borrows it; the caller closes that operator after closing the server.

The distribution registers worldbank and worldbank-workspace commands, plus seller/worldbank and seller/worldbank/cli exports. The source package carries core.py and its local UI through the existing seller-sdk component.

