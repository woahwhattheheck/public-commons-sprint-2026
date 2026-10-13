# Search complete original output

Open the existing Application, Launch Group member, Runtime operation or retained
npm attempt. **Search complete selected output** finds exact, case-sensitive
UTF-8 text throughout the original selected file, including overlapping matches.
It searches the original bytes before terminal cleanup.

Enter a useful error, identifier or multi-line literal and choose **Search
selected output**. The search retains the end position currently shown by the
reader. New worker output stays outside that selection. Each search page shows
up to 100 matches and the original byte position reached. Empty spans continue
automatically. **Pause search** keeps the last retained cursor; **Continue
search** resumes it. **Previous search page** reopens an earlier search position.
A new query explicitly starts a new search of the currently displayed selection.

Choose **Open bytes** beside a result to open that exact selected file and byte
position in the existing reader. Original UTF-8 context is displayed beside
each result. The local **Find in this output page** control remains available.
Follow live output explicitly to inspect newer worker bytes.

The exact query, fixed end, current result page, previous page cursors and
continuation reopen in the same browser session by original workspace and
source identity. A different operation or npm attempt has its own retained
search. If browser storage is unavailable, the desk explains it and keeps the
current search available for download.

## Complete result handover

**Download complete search** scans from byte zero through the same selected end
and streams every result as JSONL. It does not download only the visible search
page. The file begins with the exact selection and query, contains complete
original contexts as UTF-8 display text plus byte-exact base64 and SHA-256, and
ends with a `type: complete` record and total match count. All offsets are
zero-based original bytes with exclusive ends. An interrupted file without that
completion record can be received again from the same retained selection.

**Download complete selected output** remains the original full byte stream.
Keep that file with the complete search when another operator needs the entire
original log, including parts between matches.

The source is the existing append-only worker or retained installer output.
Native reads validate the original file generation, fixed-end head/tail guard
and range before and after each scan. Append is allowed. Replacement, truncation
or a changed selected guard requires a new explicit selection. This is the same
source contract as the maintained output reader; it is not a historical
snapshot of an independently rewritten middle of a file.

## Native API

The existing model now exposes:

| Original source | Search page | Complete search stream |
| --- | --- | --- |
| Application operation | `applicationsOutputSearch(input)` | `applicationsOutputSearchDownload(input)` |
| Runtime operation or npm attempt | `runtimeOutputSearch(input)` | `runtimeOutputSearchDownload(input)` |

Use the same original source fields as the output page methods. Add exact
`query`, optional fixed `selection`, and optional `contextBytes` (default 96,
maximum 4096). A page may also include `cursor`, `limit` (1–200, default 100) and
`maxBytes` (up to 8 MiB, at least the UTF-8 query length). A resumed cursor requires
the original returned selection, exact query and context size. It contains the
next candidate start, so an overlapping match or one across a read boundary is
retained. The response includes `fromOffset`, `nextOffset`, `done`,
`nextCursor`, matches and original source identities.

The complete stream always starts at zero. Consume its stream and close it in
a finally block, as with the original output download. CLI publication uses a
private new temporary file, completes the stream, syncs it and publishes to a new
destination without overwriting an existing file.

Authenticated, same-origin POST routes are:

- `/api/applications/output-search` and `/api/runtime-output/search`.
- `/api/applications/output-search-download` and
  `/api/runtime-output/search-download`, returning a one-use 60-second URL.

The server never accepts a source filesystem path from these calls. Original
Application/operation and registered-runtime/attempt validation remains in the
maintained reader.

## CLI

```sh
runtime-workspace output-search --workspace /absolute/workspace --operation-id ORIGINAL_UUID --query 'connection failed'
runtime-workspace output-search --workspace /absolute/workspace --operation-id ORIGINAL_UUID --query 'connection failed' --selection ORIGINAL_SELECTION --cursor ORIGINAL_CURSOR
runtime-workspace output-search-export --workspace /absolute/workspace --runtime-id ORIGINAL_RUNTIME_ID --log-file ORIGINAL_INSTALL_FILENAME --query 'error' --selection ORIGINAL_SELECTION --output /absolute/new-search.jsonl
runtime-workspace application-output-search --workspace /absolute/workspace --application-id ORIGINAL_APPLICATION_ID --operation-id ORIGINAL_UUID --query-file /absolute/exact-query.txt
runtime-workspace application-output-search-export --workspace /absolute/workspace --application-id ORIGINAL_APPLICATION_ID --operation-id ORIGINAL_UUID --query-file /absolute/exact-query.txt --selection ORIGINAL_SELECTION --output /absolute/new-application-search.jsonl
```

A query file is complete UTF-8, 1–4096 bytes, including its original newline if one
is present. It also permits literals beginning with two hyphens without changing
the existing CLI option parser. There is no regular-expression execution.

## Original installed receiving

Continue the current native Runtime receiving operation with
`receiving/OUTPUT_SEARCH_RECEIVE.mjs` and its exported
`receiveCompleteOutputSearch({page,model,outputDirectory,source,query,openOutput,kind})`.
Pass the existing Playwright page, original model, an actual retained source and
a useful literal from that source. `openOutput(page,source)` is the existing
operator's UI selection function; `kind` is `runtime` or `application`.

The course downloads the complete actual source and search, independently
counts literal occurrences in the original byte stream, verifies every context,
operates the browser search/jump/download/reload and reopens the native workspace.
It retains its exact current application source identities, complete input,
downloads, results and desktop/narrow screenshots under a new receiving attempt.
Open and inspect those actual screenshots and downloads before completing the
rendered-product handover. Use an isolated copy of the original output for
append/replacement/truncation observations; preserve the original worker's file
and all current native execution.

Search is read-only. The existing writer, terminal input, operation recovery,
source files and workspace backup remain authoritative.
