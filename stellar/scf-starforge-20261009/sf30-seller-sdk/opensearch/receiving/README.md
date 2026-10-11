# Native OpenSearch merchant receiving

This portable command runs the original merchant and retained customer workspace against the official OpenSearch Playground's existing flights index. It carries the same declared query, native PIT pagination, exact result encoding, merchant preparation, generated customer request and workspace reopen through one receiving directory.

Use a complete checkout containing `stellar/scf-starforge-20261009` and `stellar-forge`, with its existing Node24+ dependencies available. The receiver uses Python3's standard library. Keep the source and existing dependency installation together on the selected worker.

```bash
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/run-playground.py \
  --directory /absolute/private/opensearch-receiving
```

Use `--node /absolute/path/to/node` when the equipped worker selects a specific Node installation. The wrapper allows one receiver per directory and retains that directory after completion or interruption. Continue an existing operation in its original directory after reviewing the saved operation and actual failure.

## Native transport

The wrapper launches `playground-bridge.py` and `merchant-journey.mjs` as children of the same process, so the merchant can reach the bridge's private loopback listener even on executors with separate network namespaces.

The bridge follows the official anonymous homepage → `/auth/anonymous` → homepage flow. Its CookieJar stays in process memory. Native requests then use the ordinary OpenSearch Dashboards console proxy with the original native method, path and body. Response status and body bytes pass through unchanged. Two independently leased HTTPS connections reuse the same private session; concurrent field-capability and mapping reads do not wait behind a network-wide lock. The bridge honors the existing proxy configuration and TLS verification. Other configured proxy schemes use concurrent standard-library requests. An uncertain native request is retained as a failure instead of being automatically replayed.

The allowlist covers engine metadata, source field capabilities/mappings, indexed preparation search, PIT creation, PIT search and deletion by owned ID. Source indexes remain the existing public sample indexes. The merchant creates and releases its own temporary PIT; it uses a zero-row native search probe for preparation.

## Retained output

Each invocation records a private `native/<attempt>/` directory containing the actual engine/build metadata, selected index and mapping, source-file hashes, wrapper state, bridge error output and native method/path/status journal. The journal preserves native error bodies and per-request duration, queue time and connection reuse without request cookies or authorization headers. Each driver capture uses that actual attempt directory in its request identity, and its reopen step reuses the same successful identity.

The Node driver receives:

| Variable | Meaning |
| --- | --- |
| `OPENSEARCH_PLAYGROUND_ENDPOINT` | The same-process loopback endpoint. |
| `OPENSEARCH_NATIVE_METADATA` | This attempt's native metadata directory. |
| `OPENSEARCH_RECEIVING_DIRECTORY` | The retained original workspace and result directory. |
| `OPENSEARCH_CAPTURE_REQUEST_ID` | Optional exact completed capture ID from a retained report; resume its handover in the same workspace. |

If capture completed before a later handover failure, set `OPENSEARCH_CAPTURE_REQUEST_ID` to that report's exact `captureRequestId` and invoke the wrapper with the same directory. The driver requires the retained operation to be a completed capture and reuses its edition, then continues preparation, the seller/customer exchange and reopen. A fresh attempt still records its own current engine metadata.

The wrapper returns the driver's exit code. Read the driver's actual result together with `receiver-state.json` and `native-requests.jsonl`; a ready transport alone does not establish a completed merchant journey. A failed bootstrap retains its own error and leaves the original workspace available. The wrapper closes only its own bridge and driver children.

Public API references: [PIT lifecycle](https://docs.opensearch.org/latest/api-reference/search-apis/point-in-time-api/) and [Search API](https://docs.opensearch.org/latest/api-reference/search-apis/search/).
