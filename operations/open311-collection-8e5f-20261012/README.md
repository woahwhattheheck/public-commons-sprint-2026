# Open311 collection and reporting commissioning

This operation runs the complete municipal collection and reporting journey on an existing Linux machine. One foreground receiver keeps the original source feed, both product stages, and delivery retrieval in the same process lifetime. It writes a new private output directory containing the complete archive, the execution result, and the operation log.

Operation ID: `OPEN311-COLLECTION-REPORTING-8E5F-20261012-01`.

Coordinate execution in the original [Open311 source thread](https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791812298043459). The accepting operator records its machine, operation ID, and actual start there. Source preparation and review can proceed alongside the accepted execution.

## Complete inputs

| File | Purpose | Original Git blob |
| --- | --- | --- |
| `source-packet.json` | Complete collection product, browser assets, shared retained-file helpers, journey, connection profile, and real Helsinki source bodies | `b89dae77ad37c80bdb9fd1ce8e1e538694cf7ef8` |
| `run_native.py` | Source materializer, collection/reporting process, retained-operation protocol, and archive producer | `a00d7fb1b8cb680336bcd414c1586c45e00dc7bd` |
| `receive_native.py` | Ordinary file-to-stdin receiver and complete archive downloader | `0048886ebe9c7d5ecff55f2857cc196fe7a59b9a` |
| An explicit reporting operation JSON | Complete reporting source files and the retained reporting journey for this same collection | Supplied with the reporting edition |

The collection source packet binds the product edition `e77d54da79135a2fe6870ba657ca3a2a9cb429fb`, published in collection PR2330 and merged at `e2a6d9711b732c84565b3b2811d815435c342a7c`. Its executable core edition is `fdfd46eba5c4d20b08dee7d3540725aab3542b2321fcca23753b5ace92aa110a`. Every materialized source file carries its original Git blob identity. The eleven additional SHA256 fields were independently checked against the actual UTF-8 source bytes.

The current source packet includes the exact restored original bytes for the Helsinki commissioning profile, host file reader, retained file reader, and Open311 domain module. Those restorations match the declared original Git blobs. Use the current complete packet when creating a new intake file.

The portable bootstrap's complete UTF-8 SHA256 is `2502a8d4ad31caf449ff4323a536f3f011ce759a3824f3e8488ce3e9bae7c08a`.

The reporting operation has this structure:

```json
{
  "op": "reporting",
  "requestId": "the retained operation UUID",
  "files": [
    {
      "path": "repository-relative/source.mjs",
      "content": "complete UTF-8 source",
      "gitBlob": "the complete original blob identity"
    }
  ],
  "runner": "the complete reporting journey",
  "options": {}
}
```

Use the full reporting operation delivered with the selected source edition. Its request ID binds the exact files, runner, and options. A repeat of the same request in the existing live bootstrap returns the original result; a different payload under the same request ID is rejected.

## Existing runtime

Select existing Python 3, Node 24 or later, the installed Playwright module directory, and its working Chromium executable. The operation creates no package installation or cloud machine. The chosen filesystem must have room for the source tree, SQLite workspaces, original municipal responses, screenshots, exported customer files, and the complete archive.

Supply actual absolute paths. The module directory must contain `playwright/index.js`; the browser path points to the executable itself. On an equipped ChatGPT runtime, the runtime-owned Node and module locations may already be exposed by `CODEX_PRIMARY_RUNTIME_NODE` and `CODEX_PRIMARY_RUNTIME_NODE_MODULES`. An ordinary Linux host uses its existing installation.

Choose a new private output directory under a durable writable parent. The receiver creates this directory with mode 0700. An existing destination causes an error before it starts the bootstrap.

## Run the complete operation

The following path names are examples to replace with the actual existing machine paths and retained reporting packet:

```sh
python3 /absolute/checkout/operations/open311-collection-8e5f-20261012/receive_native.py \
  --bootstrap /absolute/checkout/operations/open311-collection-8e5f-20261012/run_native.py \
  --source-packet /absolute/checkout/operations/open311-collection-8e5f-20261012/source-packet.json \
  --reporting-packet /absolute/intake/reporting-operation.json \
  --output-directory /absolute/private/open311-collection-reporting-20261012-01 \
  --node /absolute/existing/node \
  --node-modules /absolute/existing/node_modules \
  --chromium /absolute/existing/chrome-headless-shell
```

The receiver verifies the complete source and bootstrap files against the pinned Git blobs before execution. Pass `--reporting-git-blob FULL_SHA` when the reporting packet is also supplied as an exact Git blob. Explicit `--source-git-blob` and `--bootstrap-git-blob` arguments select a later reviewed edition; preserve the selected packet alongside the output.

The bootstrap receives all original source in one stdin message. It verifies and materializes files in a fresh tree, checks the module syntax with the selected Node executable, and runs the complete collection journey. It then accepts the supplied reporting operation without ending the process. The receiver reads the complete resulting archive in ordered chunks, verifies its total bytes and SHA256, saves it, and closes the bootstrap.

The foreground receiver prints these progress records:

- `OPEN311_LOCAL_SOURCE_STARTED`: the original source packet was fed to the bootstrap.
- `OPEN311_NATIVE_RUNNING` and `OPEN311_REPORTING_RUNNING`: the corresponding native product stage has started.
- `OPEN311_LOCAL_COLLECTION_RESULT`: the retained collection result and exit code.
- `OPEN311_LOCAL_ARCHIVE_SAVED`: complete archive path, byte count, and SHA256.
- `OPEN311_LOCAL_RESULT`: final receiver state and the path of the detailed result.

A successful receiver exits 0 only after both product stages report successful completion, the entire archive matches its original manifest, and the bootstrap exits cleanly. Native failures retain the results and files available at that point for the source owner to inspect.

## Real source and the collection journey

The source packet contains the complete original catalogue and request bodies used by the earlier Helsinki commissioning, plus the complete 162-request response for this exact fixed window:

```text
https://palautteet.hel.fi/public-api/open311-public-service/v1/requests.json?start_date=2026-10-01T00%3A00%3A00Z&end_date=2026-10-12T00%3A00%3A00Z&extensions=true
```

That complete original is 173,305 bytes with SHA256 `7ba4503ddff621e031b24fa95157c74b2ef820f52b3bae4922316f034d81cc1e`. Its source-import observation interval is 2026-10-12 15:22:23.353–15:22:33.994 UTC. The retained provenance preserves that observation and its original transport fields.

The journey first attempts the full September 25–October 12 source collection through the unchanged provider client and the actual planner's URLs. Every successful provider response is retained in full. Declared response caps refine date windows using the saved precision and overlap policy; parent originals remain part of the collection. When the public network route cannot provide that complete tree, the journey uses the complete retained October response and records `retained-original-October-collection` as its source mode.

The source bytes and decoded municipal values are preserved together. Provider states such as READY and PROCESSING remain their original values. Missing service codes, source names, agencies, or dates remain missing. The original observation time and replay time are distinct receipt fields.

The collection journey exercises the real product through the browser, HTTP API, and merchant tools:

1. Save the connection and service catalogue, create the fixed-window plan, and retain source captures.
2. Pause after the in-flight response is retained, inspect durable progress, and resume the saved collection.
3. Open the consolidated worklist and request history, then save an explicitly labelled engineering review bound to the exact source version.
4. Repeat the collection, compare results, and preserve every original source member and conflicting observation.
5. Export the complete JSON collection, CSV worklist, HTML report, and editable workspace.
6. Read collection windows through the actual merchant tool limit and download retained exports through multiple file chunks.
7. Receive the full workspace in an independent empty destination, reopen it, and check recovered rows, reviews, plans, and original response bytes.

The supplied reporting journey then imports the real collection export into the reporting product, exercises its saved profile and report formats, receives its full editable state in an independent workspace, and completes the reporting review-return workflow. Its exact steps and results are retained with that reporting source edition.

## Delivery files

The receiver creates these top-level files inside the selected output directory:

| File | Contents |
| --- | --- |
| `helsinki-collection-reporting.zip` | Complete original collection deliveries, original municipal bodies and receipts, reporting deliveries, source manifests, exact source and runner files, saved commands, and execution results |
| `receiver-result.json` | Operation identity, selected source blobs, runtime paths, timestamps, both stage results, archive bytes/SHA256, and final state |
| `receiver-events.jsonl` | Ordered native progress, complete stage results, archive ranges, and completion record |

The working tree created below that output directory preserves the materialized product source and private workspaces. An interrupted archive transfer preserves `helsinki-collection-reporting.zip.partial`. The completed archive is created only after every chunk, total length, and SHA256 matches the bootstrap's manifest.

Deliver the complete ZIP and receiver result to the original source/SCF thread or its established private artifact surface, with the exact operation ID and source edition. Include the generated collection and reporting exports so the receiving operator can open the useful work directly. Keep the editable workspace bundles with their reports for continued use.

## A held tool runtime

The same `run_native.py` also supports the original held-process protocol. When a tool runtime keeps process handles scoped to an orchestration lifetime, execute the start, source feed, reporting feed, result reads, and complete archive retrieval inside one live orchestration. Yield progress while that orchestration remains alive.

The portable foreground receiver above performs those steps inside one ordinary Python process. A cloud runtime may instead retain its process handle inside one live tool isolate and drive the same protocol directly. In both cases the existing bootstrap remains alive until its complete archive has been preserved.

The direct protocol uses newline-delimited JSON on stdin. After `OPEN311_NATIVE_READY`, send the complete source packet. After `OPEN311_NATIVE_RESULT`, send the retained reporting operation. After `OPEN311_REPORTING_RESULT`, request archive chunks:

```json
{"op":"artifact","offset":0,"limit":49152,"archiveSha256":"the returned archive SHA256"}
```

Use each returned `nextOffset` exactly. The final value is null. Verify all chunk identities, complete byte count, and complete SHA256 before sending:

```json
{"op":"finish"}
```

A native operation that has already accepted its source remains the execution owner through artifact retrieval. If that process ends, preserve its recorded result and source/output identity before another operator accepts the next concrete run.
