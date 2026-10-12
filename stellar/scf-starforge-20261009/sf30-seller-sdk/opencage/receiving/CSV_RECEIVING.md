# Receive the OpenCage CSV product

This command runs one complete retained-source customer journey through the maintained CSV workbench. It consumes a completed native OpenCage delivery, keeps its actual request, response and observation, and creates a separate review workspace.

The example contains 52 original CSV rows: 50 equal retained queries with independent customer IDs and decisions, an empty query and a column-count exception. The first two rows share a customer ID; they keep separate request IDs and selections. The original OpenCage test-key response represents its documented fixed location. The CSV records demonstrate source retention, review and delivery rather than fifty newly geocoded locations.

## Runtime and selected input

Use the existing maintained native worker. Select an immutable source installation that includes this command, `csv-browser.mjs`, the original OpenCage CLI/operator and the OpenCage MCP family. Node 24 supplies `node:sqlite`; the native request must declare the chosen Node, Playwright, Chromium, dependency tree and output placement through the original worker's runtime/capacity fields.

A source manifest has this shape:

```json
{
  "sourceCommit": "ACTUAL_COMMIT",
  "sourceRoot": "/absolute/selected/source",
  "files": [
    {
      "path": "repository/relative/file.mjs",
      "gitBlob": "ACTUAL_GIT_BLOB",
      "bytes": 123,
      "sha256": "ACTUAL_SHA256"
    }
  ]
}
```

Every selected file is checked against its exact size, SHA256 and Git blob. The command itself must appear in that same source selection.

Prepare this private input:

```json
{
  "schema": "commons.scf-opencage-csv-receiving/v1",
  "operationId": "YOUR_STABLE_NATIVE_OPERATION",
  "sourceRoot": "/absolute/selected/source",
  "sourceManifestPath": "/absolute/source-manifest.json",
  "sourceManifestSha256": "ACTUAL_MANIFEST_SHA256",
  "originalWorkspaceDirectory": "/absolute/original/opencage-workspace",
  "completedNative": {
    "record": "/absolute/original/completed-native-record",
    "requestSha256": "ORIGINAL_REQUEST_SHA256",
    "resultSha256": "ORIGINAL_RESULT_SHA256",
    "artifactsSha256": "ORIGINAL_ARTIFACTS_SHA256"
  },
  "outputDirectory": "/absolute/native-project/run",
  "browser": {
    "playwright": "/absolute/installed/playwright/index.mjs",
    "chromium": "/absolute/installed/chrome-headless-shell"
  }
}
```

The selected original completion is the `commons.scf-opencage-release-completion/v1` result. Its declared `run/journey.json` retains the completed provider/customer native operation and the original customer directory, manifest, response and request identity. The command verifies both native outcomes and every selected original customer file before consuming those bytes.

The immutable native argv is exactly:

```text
/absolute/node /absolute/selected/source/stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/receiving/run-csv-workshare.mjs --input /absolute/input.json --input-sha256 ACTUAL_INPUT_SHA256 --record /absolute/current/native-record
```

Use the actual canonical Node executable. The command verifies that argv against the original native request before preparing output. Keep the same admitted operation and original worker when reconnecting.

## Complete receiving flow

The browser uploads the actual CSV bytes, selects its existing columns and product, reviews the precise source/terms/reuse binding, and prepares the retained batch. It exercises dirty-review invalidation, run/available Stop/reconciliation, both pages, the two invalid rows and the separate choices for repeated customer IDs.

The successful rows reuse the original captured native response. A separate original source invocation with no configured credentials produces a real retained configuration refusal. The browser reviews its next attempt; the callback reuses the same original query/response capture under that new request identity. Its exported retry history preserves the failed predecessor and reviewed reason.

The customer view reopens the selected immutable export, serves its original source/capture/response and joined files, and hides operator mutations. Wide and mobile screenshots are retained. The parent receives every customer root file and content-addressed original object, then the original delivery verifier replays all row, retry, decision and projection identities.

After browser shutdown, the command reopens the customer through the original CLI. It then uses all eight new batch tools in the maintained MCP family: source, review, prepare, inspect, run/reconcile, retry, select and export. An exact results.csv transfer stops after its first 64 bytes, closes the original MCP owner, reopens that same workspace and resumes the remaining bytes with the original SHA256.

Finally, the original managed CLI starts and stops twice against the saved workspace and the complete fifteen-file OpenCage source selection. Both authenticated instances must expose the same batch and customer identity.

## Retained output

`journey.json` records the actual source/native input joins and completed stages. `browser/CSV_Browser_Receiving.json` records the browser's source, row, download and screenshot identities. It retains no bearer tokens.

The three complete portable customer directories are `customer-delivery/`, `retry-delivery/` and `agent-delivery/`. Their original `manifest.json`, `objects.jsonl`, source, rows, licenses, CSV and GeoJSON remain intact. Open them with `opencage-workbench batch-read --delivery DIR --verify true` or `batch-serve --delivery DIR`.

Select these complete customer directories, `journey.json`, `browser/`, `inputs/`, `agent-results.csv`, the exact input/source manifests and the receiving source as native artifacts. The mutable operator workspace stays in its own retained run directory for reopening.

If a stage fails, its actual earlier records remain the continuation source. Inspect the current original request/result before using its worker's supported recovery. A completed provider response or completed original native operation is never replaced by a fresh lookup simply to fill a missing local file.
