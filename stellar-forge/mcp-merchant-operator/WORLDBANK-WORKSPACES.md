# World Bank workspaces through the merchant MCP host

The existing merchant host operates the original World Bank source model, dataset publisher, SF82 release store and SF88 customer acquisitions. Browser and agent share one model instance. Original selection revisions, capture IDs, source receipts, reviewed observation choices, exports and buyer records remain in the selected workspace.

The module is `worldbank-workspace.mjs`; the underlying product lives in `../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/`. The receiving client extends the host's existing durable file downloader.

## Configure the host

Use the installed Starforge runtime, Python 3.10 or later, and the original POSIX source engine. Durable customer receiving also uses the existing Linux `flock` lease. Create the source, buyer and receiving directories with mode 0700. Save the connection JSON with mode 0600:

~~~json
{
  "schema": "stellar-forge.worldbank-workspace-connection.v1",
  "workspaces": {
    "research": {
      "label": "World Bank research",
      "directory": "/absolute/worldbank-work",
      "python": "/absolute/python3",
      "imports": {
        "retained-pages": {
          "label": "Original acquisition with HTTP receipts",
          "kind": "pages",
          "file": "/absolute/original-pages.json"
        }
      },
      "merchants": {
        "dataset": {
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
      },
      "buyerWorkspaces": {
        "analysis": { "directory": "/absolute/buyer-work" }
      },
      "runtime": { "port": 0 }
    },
    "receiving": {
      "directory": "/absolute/worldbank-received",
      "imports": {
        "edition": {
          "kind": "package",
          "file": "/absolute/download/handover.zip"
        }
      }
    }
  }
}
~~~

Use actual public payment terms and the existing source paths. Omit optional imports, merchant profiles and buyer workspaces until they are available. An import may pin `sha256` in its host configuration. All declared input files must already exist. The Python entry is optional; absent it, the native model uses its existing Python selection.

Initialize and serve through the original host:

~~~sh
starforge merchant-mcp init-worldbank-workspaces \
  --dir /absolute/worldbank-host --connection /absolute/worldbank-connection.json

starforge merchant-mcp serve \
  --config /absolute/worldbank-host/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

From the repository, replace `starforge merchant-mcp` with `node stellar-forge/mcp-merchant-operator/serve.mjs`. The bearer value belongs in the declared environment variable. The existing OAuth and HTTP transport remain available. The original stdio entry reads the same `merchant-mcp.json` and exposes the same registered tools.

For an existing merchant configuration, add `worldbankWorkspaceConnection` containing the private connection JSON path. Source paths, executables, seller runtime settings and buyer directories are host configuration; agent inputs select their declared aliases.

## Run the source and review workflow

1. Call `merchant_worldbank_status`, choose a declared alias, and call `merchant_worldbank_open`. Keep the returned `instanceId`.
2. Save the original selection with `merchant_worldbank_selection`, including the displayed `expectedRevision` (zero for a new selection). The native selection has `sourceId`, `countries`, `indicators`, `date` and `perPage`.
3. Retrieve the selected source with `merchant_worldbank_capture`, action `start`, a stable `id` and `selectionId`. The returned job is `RUNNING` until the actual source process finishes. Read status and inspect that same capture ID.
4. Read original observations and compare complete captures. Save a review with its current revision, the complete excluded identity set, explicit duplicate row choices and selected native columns.
5. Export the saved review using its exact revision and a stable export ID. Read the original export before merchant preparation or customer receiving.

Example selection input:

~~~json
{
  "workspace": "research",
  "id": "north-america",
  "title": "North America GDP and population",
  "expectedRevision": 0,
  "spec": {
    "sourceId": "2",
    "countries": ["CAN", "MEX", "USA"],
    "indicators": ["NY.GDP.MKTP.CD", "SP.POP.TOTL"],
    "date": "2018:2024",
    "perPage": 20
  }
}
~~~

For a retained capture from another worker, first inspect `merchant_worldbank_inputs`. Pass that exact SHA256, source import alias, target capture ID and saved selection ID to `merchant_worldbank_import`. A pages file is a JSON object containing the original `pages` array: each page carries its unchanged base64 response body, request/response receipt, original group and page number. The native importer checks the original request and exact response digest before retaining it.

For a package import, select a declared `kind: "package"` input and pass its inspected hash. Supply a stable target capture ID and optional review/selection IDs. The original importer restores the actual source pages, selection and reviewed native dataset.

### Continuation and paging

The source engine saves each received page before moving on. On failure or interruption, inspect the existing capture and resume that same ID and selection. Returned source errors retain their original code and provider retry information. `cancel` signals only this model's actual running child; the retained capture remains available.

Status pages selections, captures, reviews, exports, catalogs and jobs. Saved review detail pages choices, excluded identities and revision history; merge all returned pages before replacing a review's complete selection. Capture inspection pages its source descriptors, and export inspection pages its manifest files. Use each returned `total` and `nextOffset`. Native observation and comparison results retain their original offset/limit/total contract.

A number remains its original JSON token string. Source null remains null. Country, indicator, period, status, source page, source row and content identity are preserved.

## Publish and operate the original merchant

Call `merchant_worldbank_merchant` with the retained export ID and a declared profile. This invokes the original dataset compiler and publisher, and returns the native draft and merchant binding.

`merchant_worldbank_publisher` accepts the existing publisher action and payload:

| Workflow | Actions and native inputs |
| --- | --- |
| Query/review | `publisher.preview`: target and query; `publisher.reviewDraft`: draftId, expectedSnapshot, expectedRevision |
| Publish | `publisher.publish`: draftId, expectedSnapshot, expectedRevision; `publisher.activateSnapshot`: snapshot and current target state |
| Stage/inspect | `publisher.release.stage`: draftId, id, optional label; `publisher.release.inspect`: id |
| Activate/rollback | Original release ID and expectedGeneration, or expectedGeneration for rollback |
| Start/stop | `publisher.release.start`: expectedGeneration; `publisher.release.stop`: empty payload |
| Buyer review/prepare | Original snapshot/query, then saved review, intentId, acceptIndex and offerSha256 |
| Buyer session | buyerId, buyerWorkspace alias, maxPages, maxTotalAtomic, optional maxRows/maxPageBytes |
| Acquire/recover | Original session id; run may carry explicit retryUnpaid and expectedAttemptSha256 |
| Account/export | Original session id |

Stage uses the configured runtime; buyer session resolves its declared directory. Other inputs are validated by their original native action. A lost reply is recovered by reading the original workspace, release, intent or session, then continuing that identity.

Query examples use the native dataset grammar:

~~~text
where_country_iso3=CAN&where_indicator_id=NY.GDP.MKTP.CD&sort=-period&limit=10
~~~

## Receive complete original files

Inspect an edition's receiving manifest:

~~~sh
starforge merchant-mcp inspect-worldbank \
  --url http://127.0.0.1:3211 --workspace research \
  --export-id north-america-reviewed-v1
~~~

Download its complete original handover and direct dataset inputs:

~~~sh
starforge merchant-mcp download-worldbank \
  --url http://127.0.0.1:3211 --workspace research \
  --export-id north-america-reviewed-v1 \
  --out /absolute/download --chunk-bytes 65536
~~~

Repeat the same command and output directory after interruption. The existing downloader checkpoints each verified prefix, reacquires an expired server read using the same SHA256 and offset, and verifies every completed file. `--manifest-sha256` pins a previously inspected receiving manifest.

The six files are `dataset.csv`, `dataset.json`, `review.json`, `selection.json`, `source.json` and `handover.zip`. The ZIP already contains every original nested response page, capture, selection, review and package manifest. Receiving adds only `worldbank-download.json` and the existing private downloader checkpoint directory. Its metadata identifies the original export manifest, capture SHA256 and review revision.

The Node exports are `inspectWorldBankDownload` and `downloadWorldBankWorkspace` from `worldbank-workspace-download.mjs`. Both take `url`, `workspace`, `exportId` and the existing transport options. Download additionally takes `directory`, `chunkSize`, `signal`, `onProgress` and optional `expectedManifestSha256`.

Individual source and customer files use `merchant_worldbank_file`. Select the exact original kind, ID and source filename where relevant. Keep the returned `readId`, file SHA256 and `nextOffset`. Chunks are at most 196608 bytes. A final chunk releases its immutable snapshot; an unfinished read can be released explicitly.

## Browser and ownership

`merchant_worldbank_browser` opens the original industrial UI with the MCP model supplied directly. Its private URL is local to the running host. Agent and browser changes share revisions, source captures, publisher targets and customer sessions.

Closing that browser leaves the model open. Closing the selected model requires its current process-owned instance ID and drains accepted operations, the borrowed browser, retained reads and native publisher. Captures retain their acquired pages when their child stops. Reopening the same alias restores the same saved workspace.

## Source and operating references

- Original source, browser, CLI and publisher bridge: [World Bank native guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/worldbank/NATIVE.md)
- Original authenticated merchant host: [README](./README.md)
- Original stdio transport: [STDIO](./STDIO.md)
- Shared retained chunk implementation: `retained-file-reads.mjs`
- Shared durable customer receiver: `retained-download.mjs`
