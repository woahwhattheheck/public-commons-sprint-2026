# Horizon settlement stream

An original Horizon account-payment stream feeds the same collective-investment workspace, source files, immutable resource versions and reconciliation. It uses the existing leased writer and native request journal.

## Configure and run

Create a stream from Settlement streams in the operator, or call the existing native CLI command with method `stream.configure` and args `{connectionAlias,accountId,cursor,name?,bookVersionId?}`. Select an existing Horizon connection with its exact environment, endpoint and network passphrase. The account is explicit. The starting cursor must be an original decimal paging token or `"0"` for earliest retained history. The start is part of the stream's immutable identity.

Use a complete paged account-payment capture to choose a known original paging token when beginning after a retained historical course. The live stream always resumes from its committed cursor. It deliberately uses a stable decimal start: reconnecting from a fresh `now` before the first committed event could skip the interruption interval.

Run the one configured stream:

```sh
node settlement-stream.mjs --directory /private/amero-workspace --configuration /private/amero-config.json --stream-id ORIGINAL_STREAM_ID
```

The command prints its actual lease/process identity and then receives until paused or stopped. A second process for the same workspace/stream cannot own its live lease. Use the same stream ID and workspace to resume. SIGINT and SIGTERM abort the owned connection, finish or retain the original commit, release the lease, and close only the workspace opened by this worker.

## Original source and checkpoint

At worker start, the original capture.start/capture.run machinery obtains and retains the selected endpoint's network response. Its network passphrase must match the configured original Horizon connection.

The worker then requests `/accounts/{accountId}/payments` with `cursor`, `order=asc`, `join=transactions`, `include_failed=true` and `limit=100`, through the maintained native Horizon request builder. Accept is text/event-stream. The saved Last-Event-ID is used when it matches the durable cursor; the explicit query cursor always names the selected replay position. Redirects are surfaced as an endpoint error so a configured source is not silently changed.

Each complete original frame retains its raw bytes, exact multi-line data, HTTP response headers, observed time and request URL. The original request cursor is separate from the checkpoint immediately before this event: several events can arrive over one connection. The native stream.commit independently parses the original frame, checks its data/id, original account/network/query and advancing paging token, and projects the payment operation plus joined transaction. Original files are retained before the same SQLite transaction records source, resource versions and checkpoint.

The stable native commit request ID contains the original stream, token and exact data identity. An existing incomplete commit resumes its stored original args; an already complete commit is adopted without creating a replacement. In either case the worker reopens the actual current stream row before proceeding.

## Continuation and operation

The frame decoder accepts UTF-8, initial BOM, CRLF, CR and LF line endings, multi-line data, id resets and retry fields. It preserves each complete raw frame. A trailing incomplete event is discarded without advancing the committed cursor and is therefore requested again on reconnect. Unsupported/malformed data returns a concrete error with the retained checkpoint.

Comments and heartbeats keep the connection active. A Horizon close event reconnects at the saved position. Temporary transport failure, HTTP 408/429 or 5xx uses the provider's Retry-After and the retained retry timestamp, with exponential backoff. A server retry field can lengthen the reconnect interval. HTTP 204 stops and pauses the selected stream as specified by the event-stream protocol. Other HTTP or schema errors remain visible for source correction.

Settlement streams shows the original account, starting/current cursor, event count, lifecycle state, connection state, retry observation and retained sources. Pause takes effect on the running worker's next checkpoint or pause check. Resume selects the same stream; start its same native worker if the earlier process has exited. Configuring a stream does not create a background process.

Continuous event capture and complete period acquisition serve different purposes. The report includes all selected stream positions and observations. A finished historical capture supplies the terminal page coverage for its original period/query. The native book retains both sources without adding the same movement twice.

## Delivery and independent reopening

The original full workspace export includes streams, their history, raw frames and ordinary source/resource versions. The receiver pauses every stream in the independent workspace, preserving the source binding and current cursor. Inspect that received project and its selected native inputs before resuming a stream there.

The final producing peer must open/run/render the actual operator at desktop and narrow widths, LOOK at the actual output, and operate stream configuration, pause/resume, report downloads and independent archive reopening. Open all source/report/archive attachments and their actual contents. Repair observed defects in this cumulative product and retain its original receiving operation.

## Maintained primary sources

- Stellar Horizon streaming: https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/streaming
- Account payments and cursor semantics: https://developers.stellar.org/docs/data/apis/horizon/api-reference/get-payments-by-account-id
- Event framing, IDs, retry and incomplete-event rules: https://html.spec.whatwg.org/multipage/server-sent-events.html
- Complete pinned Stellar SDK CallBuilder.stream, join, payment and transaction source is already retained in sources/horizon-original.json, SDK v17.0.1 commit74ac883871396138e1882a3ca4bcec7e4ace76b5. The full source shows transaction joins and cursor progression from the original paging token. Source acquisition and funded milestone originals remain in the selected source package.

This worker reads original provider data. Exact ledger-to-provider allocations, conversion evidence and economic outcomes remain in the same native reconciliation and decision flow.

On pause or process shutdown, the worker finishes the current original commit, closes its owned response/connection, and records `STOPPED` before releasing its lease. The durable pause choice, committed cursor and any provider retry time remain available for a later resume. A source or commit error retains `ERROR`.
