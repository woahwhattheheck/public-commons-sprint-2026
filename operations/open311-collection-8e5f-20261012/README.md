# Open311 collection and reporting commissioning

This operation runs the complete municipal collection and reporting journey on an existing Linux machine. One foreground receiver keeps the original source feed, both product stages, and delivery retrieval in the same process lifetime. It writes a new private output directory containing the complete archive, the execution result, and the operation log.

## Complete inputs

| File | Purpose | Original Git blob |
| --- | --- | --- |
| `source-packet.json` | Complete collection product, browser assets, shared retained-file helpers, journey, connection profile, and real Helsinki source bodies | `8e731340359628b63e870b7164f5be65109ef4c2` |
| `run_native.py` | Source materializer, collection/reporting process, retained-operation protocol, and archive producer | `23cd38c71b5c8e845c3b31fd1c4b1661661ef2c4` |
| `receive_native.py` | Ordinary file-to-stdin receiver and complete archive downloader | `73f61efef5dd85bab748d58977c64eef32714019` |
| `../open311-service-reporting-8e5f-20261012/reporting-operation.json` | Complete reporting source files and retained reporting journey for this same collection | `500e844a86063c5a0bacc5a1238a4f29aa113465` |
| `../open311-service-reporting-8e5f-20261012/run-reporting.mjs` | Standalone source of the same reporting journey embedded in the operation | `39c1aa7b850340057e22a8d0918cd79244261c4c` |

The collection source packet binds the product edition `e77d54da79135a2fe6870ba657ca3a2a9cb429fb`, published in collection PR2330 and merged at `e2a6d9711b732c84565b3b2811d815435c342a7c`. Its executable core edition is `fdfd46eba5c4d20b08dee7d3540725aab3542b2321fcca23753b5ace92aa110a`. Every materialized source file carries its original Git blob identity. The eleven additional SHA256 fields were independently checked against the actual UTF-8 source bytes.

The complete native inputs have these byte identities. Hashes cover the actual UTF-8 file bytes, including the selected file's final newline convention.

| Input | Bytes | SHA256 |
| --- | ---: | --- |
| Collection packet | 667,687 | `e44e50a25d521ba1cbaa9da9113b5da54962e6fd446b493204dfe0163517df73` |
| Reporting packet | 307,583 | `51735d92d21270d2b475f332a5c7eff16edc0c7711cb3e9e0a425869930d61a9` |
| Portable bootstrap | 18,216 | `58b994e15464cdad99cdbc1ffa35d79f3676e5592fc2d4f0f86a9357536c12e2` |

The commissioning adapters preserve optional provider coverage only when that field is present. Saved catalogue receipts retain their original fields without introducing an undefined JSON value. The collection and reporting product source files keep the same selected editions.

The reporting operation has this structure:

```json
{
  "op": "reporting",
  "requestId": "reporting-8e5f-20261012-02",
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

Supply actual absolute paths from the selected existing installation. The module directory must contain `playwright/index.js`; the browser path points to the executable itself.

Choose a new private output directory under a durable writable parent. The receiver creates this directory with mode 0700. An existing destination causes an error before it starts the bootstrap.

## Run the complete operation

The following path names are examples to replace with the actual existing machine paths and retained reporting packet:

```sh
python3 /absolute/checkout/operations/open311-collection-8e5f-20261012/receive_native.py \
  --bootstrap /absolute/checkout/operations/open311-collection-8e5f-20261012/run_native.py \
  --source-packet /absolute/checkout/operations/open311-collection-8e5f-20261012/source-packet.json \
  --reporting-packet /absolute/checkout/operations/open311-service-reporting-8e5f-20261012/reporting-operation.json \
  --output-directory /absolute/private/open311-collection-reporting-20261012-01 \
  --node /absolute/existing/node \
  --node-modules /absolute/existing/node_modules \
  --chromium /absolute/existing/chrome-headless-shell
```

The receiver verifies the complete source, bootstrap, and reporting files against the three pinned Git blobs before execution. Explicit `--source-git-blob`, `--bootstrap-git-blob`, and `--reporting-git-blob` arguments select a separately supplied edition; use the complete 40-character blob for each changed input and preserve those selected packets alongside the output. A reporting request ID identifies the exact runner and source payload, so a changed reporting payload uses its own request ID.

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

Share the complete ZIP and receiver result through the project's selected delivery destination, identifying the exact source edition. Include the generated collection and reporting exports so the receiving operator can open the useful work directly. Keep the editable workspace bundles with their reports for continued use.

## Direct stdin protocol

An existing foreground process can also drive `run_native.py` directly. Keep its stdin and stdout streams open through source intake, both product stages, and complete archive retrieval. The supplied `receive_native.py` implements this whole exchange and saves the final ZIP.

The direct protocol uses newline-delimited JSON on stdin. After `OPEN311_NATIVE_READY`, send the complete source packet. After `OPEN311_NATIVE_RESULT`, send the retained reporting operation. After `OPEN311_REPORTING_RESULT`, request archive chunks:

```json
{"op":"artifact","offset":0,"limit":49152,"archiveSha256":"the returned archive SHA256"}
```

Use each returned `nextOffset` exactly. The final value is null. Verify all chunk identities, complete byte count, and complete SHA256 before sending:

```json
{"op":"finish"}
```

Keep the current bootstrap alive until its complete archive has been preserved. If the process ends, retain the original output directory and saved results. A later execution uses a new output directory and the exact selected input files.

## Complete archive upload from the live process

An operator can preserve the entire generated archive directly through an already authorized Slack file upload while the bootstrap remains alive. The normal file receiver above downloads the archive to its private output directory. The direct upload command is available to an existing driver of the same stdin protocol when it has prepared a Slack upload for the selected delivery conversation.

After `OPEN311_REPORTING_RESULT`, prepare the upload using the returned archive filename and exact byte count. Retain the returned file ID and complete signed upload URL privately. Send both with the current archive selection:

```json
{
  "op": "upload",
  "uploadId": "the returned file ID",
  "uploadUrl": "the exact prepared HTTPS upload URL",
  "method": "POST",
  "bytes": 123456,
  "archiveSha256": "the exact current complete archive SHA256"
}
```

Replace the example byte count with the archive descriptor's actual integer. The bootstrap verifies both the length and SHA256, posts the whole ZIP as raw `application/zip` bytes with its exact content length, and returns `OPEN311_NATIVE_UPLOADED`. It uses the prepared HTTPS target directly and does not follow redirects. The upload intent and result are saved privately below `archive-uploads/`, outside the delivery ZIP.

An `UPLOADED` result records the provider's successful HTTP response. Finalize that same file ID into the selected delivery conversation using the existing Slack upload flow, then preserve the final file link and upload receipt. Send `finish` after the delivery is complete. `REJECTED` records an explicit HTTP rejection; `UNCERTAIN` records a transport result that requires reconciliation with that existing upload. Repeating an identical command in the live process returns its retained result. The same upload ID cannot be reused for a changed URL or archive, and an uncertain upload is not automatically posted again.

A source packet may also select `archiveFilename` for a different complete operation. It must be a plain `.zip` basename, beginning with a letter or digit and containing only letters, digits, dots, underscores, or hyphens, with at most 181 characters before `.zip`. Omitting the field preserves `helsinki-collection-reporting-workspace-8e5f-20261012.zip`. The ordinary local receiver continues to save its verified download under `helsinki-collection-reporting.zip` in the selected private output directory.
