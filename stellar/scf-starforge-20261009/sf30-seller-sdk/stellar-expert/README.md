# Stellar asset investigation workspace

This is a private operator mode of the maintained SF30 dataset workspace. It captures the public StellarExpert API, retains exact response bytes and immutable observation editions, supports source-linked review and comparison, and carries selected records through the original dataset publisher, SF82 merchant release and SF88/SF100 customer receiving engines.

The complete operating workflow and transfer procedure are in [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md).

## Open the workspace

Use the selected original Starforge source distribution and its declared runtime dependencies. The module uses Node built-ins for capture, storage and the browser server. Original merchant and buyer operations load the existing SF30/SF82/SF88 dependencies from that same source tree; preserve its sibling dependency directory when transferring an installed release. The [runtime installation guide](../../distribution/RUNTIME_INSTALL.md) covers the original distribution installation.

From the original source root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-workspace.mjs \
  --stellar-expert /absolute/private/stellar-workspace \
  --port 8436
```

Open the printed local session URL in a browser on the same trusted computer. Its fragment is the temporary bearer capability; the frontend keeps it in that tab's session storage and sends it in the Authorization header. The server binds only to 127.0.0.1, checks Host and Origin, and serves external JavaScript and CSS under a restrictive content security policy.

Startup options also accept:

| Option | Purpose |
| --- | --- |
| `--inbox /absolute/original/sf88-inbox` | Select the existing customer inbox whose ordered purchase intents can be inspected and received. |
| `--release-runtime /absolute/private/runtime.json` | Configure original merchant startup through SF82's runtime normalizer. |
| `--port 0` | Let the operating system select a free browser workspace port. |

The runtime JSON accepts only `port`, `facilitator` and `allowLocalFacilitator`. The facilitator is an explicit credential-free HTTPS URL without query or fragment. Original local development additionally permits HTTP on 127.0.0.1 when `allowLocalFacilitator` is true. An omitted runtime file selects port zero and the original challenge-only seller. A configured facilitator selects the original native x402 runtime. Each release preparation retains its selected startup configuration before acting.

## Operator workflow

1. Capture asset search, holders, activity ratings, supply, directory entries/tags, domain listings or ledger/time lookups. Save watch entries for assets being reviewed. A stopped capture resumes its saved query, provider cursor and original response chain.
2. Inspect projected records and download original pages. Numeric tokens are retained as exact strings; documented stroop values have separate derived decimal fields. Every projected row identifies its source page hash, source record, observed time and URL.
3. Compare immutable editions and retain notes with their edition and subject. Full comparison JSON and edition JSON, spreadsheet CSV and offline reports are immutable exports.
4. Prepare an original SF30 dataset from a selected edition, then query it through its declared column, equality, range, sort and pagination descriptors. The source manifest travels with all declared raw response files.
5. Choose explicit merchant origin, path and payment terms. The original publisher prepares and stages the dataset package; the workspace exposes original inspect, activate, start, stop and rollback operations with the current release generation.
6. Select completed original SF88 inbox intents in page order. Original SF88/SF100 receiving checks request and cursor continuity, retains original operation/source records and assembles the customer dataset. Download its CSV, JSONL, review HTML and two manifests from the authenticated customer panel.

## Retained observations and exact values

The public source contract is pinned to [StellarExpert Open API 1.4.0](https://github.com/stellar-expert/stellar-expert-explorer/blob/308ef220358192911525272d9ad251225dd1e00b/open-api/openapi.yml). Each capture records the actual effective request URLs, raw provider next links, response headers, timestamps, exact bytes and SHA-256 identities. If a provider next link omits an original filter, the adapter carries that filter forward and records the inherited query. It rejects a different origin, endpoint or explicitly changed filter.

A paged edition records the observed time interval of those responses. The API does not advertise one ledger snapshot across all pages. Ratings are provider-described ledger activity popularity indicators. Amount fields retain their documented formats: holder balances and documented transfer amounts are stroops; the supply endpoint returns decimal asset units; the AssetInfo supply field remains in its original representation.

Source numbers, paging tokens and identifiers never pass through JavaScript Number. Projected amount columns remain strings, and their original dataset descriptors do not advertise numeric sorting or numeric range filtering. The native dataset CSV preserves the selected projection. The separate spreadsheet export neutralizes formula-leading values and labels that transformation.

## Shared API and recovery

`workspace.mjs` exports `startStellarExpertWorkspace({directory, inboxDirectory, port, releaseRuntime, fetchImpl})`; `core.mjs` exports `openStellarExpertWorkspace`. The browser and CLI share this same application and private writer lease.

Read endpoints are `GET /api/schema`, `/api/view`, `/api/editions?offset=&limit=`, `/api/rows?editionId=&offset=&limit=` and `/api/raw?editionId=&page=`. The schema advertises query descriptors, payment fields and action payloads. Full edition archives are paginated independently of the latest-edition view.

Mutations use:

```json
{
  "operationId": "one-stable-operation-identity",
  "expectedRevision": 17,
  "action": "dataset.prepare",
  "payload": {
    "editionId": "the-selected-immutable-edition-id",
    "name": "Reviewed Stellar assets"
  }
}
```

Reuse the exact operation identity and payload after an unknown response. Identity reconciliation occurs before revision comparison and returns the original completed result with a current view. A new request requires the current workspace revision. The browser preserves form drafts on conflicts and retains unknown requests per tab, bound to the original workspace identity.

Successful raw responses are journaled before advancing a capture cursor. A restart can adopt those saved bytes. Release preparations retain their runtime selection; customer operations retain their inbox selection. Completed exports retain exact output identities. An interrupted customer projection is preserved separately while the original exporter reassembles the same already-completed inbox attempts.

Portable edition downloads use `/api/exports/{id}`. Original customer downloads use `/api/receipts/{receiptId}/{name}`, with the fixed filenames `dataset.csv`, `dataset.jsonl`, `review.html`, `delivery.json` and `manifest.json`. The server checks completion identity, the original native manifest and the selected output's bytes and hash before returning a file.

The terminal interface is `node stellar/scf-starforge-20261009/sf30-seller-sdk/stellar-expert/cli.mjs --help`. It supports the same actions, paged editions/rows, immutable exports and browser startup.

## Source structure

| Module | Responsibility |
| --- | --- |
| `exact-json.mjs`, `provider.mjs`, `schema.mjs` | Exact numeric decoding, public provider query/pagination contract and browser descriptors. |
| `store.mjs`, `core.mjs` | Private writer lease, immutable objects, capture journal, editions, stable operations and revisioned state. |
| `domain.mjs` | Source-linked projections, comparisons, annotations and portable research exports. |
| `dataset.mjs` | Original SF30 dataset and publisher, SF82 merchant lifecycle, SF88/SF100 receiving and verified customer downloads. |
| `workspace.mjs`, `cli.mjs`, `web/` | Shared local HTTP/terminal interfaces and industrial operator UI. |

The original source and installed runtime paths are part of existing release bindings. Preserve those paths for a direct restored installation; prepare a new release through the original installer/publisher when selecting another layout. Keep private workspaces, buyer configuration and payment credentials outside the source repository.
