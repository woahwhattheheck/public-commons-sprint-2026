# Request collections workspace

The collection workspace brings the original buyer inbox into one review screen. It reads the same retained collections as the command line and preserves their original request identities, spend terms and delivery records.

## Open the workspace

Use the existing private inbox and a separate private collection directory whose parent already exists.

~~~sh
starforge buyer-collections-workspace --directory /absolute/private/collections --queue-root /absolute/private/buyer-inbox
~~~

The source command is `node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/server.mjs` with the same arguments.

Open the complete URL printed in that terminal. The server binds to `127.0.0.1` on an available port. Its private session key arrives in the URL fragment, is removed from the address bar by the page and is retained only in that tab's session storage. **Lock workspace** clears that tab's key. Restarting the server creates a new session; reopening the complete replacement URL also refreshes an already-open tab.

The store remembers its original inbox. Later launches need only `--directory`. Supply `--port` when a fixed local port is useful.

The installed Applications launcher uses `--startup-format json`. After the listener is ready, that mode emits one native launch record containing the private URL and the exact saved collection/inbox binding. The default `text` format keeps the ordinary terminal instructions. Approval mode defaults to `browser`; `--approval-mode terminal` opens the original terminal workflow.

## Review and retain a collection

1. Select **New collection**, enter its name and stable ID, then paste absolute paths to existing SF88 operator configuration files, one per line.
2. Select **Review requests**. Inspect the resource, method, spending limit and response destination. Exact totals keep each network, asset, recipient, scheme and payment flow separate.
3. Select **Save reviewed collection**. The controller verifies that the files still match the review and retains configuration, request-body and operation-ticket bytes.
4. Select **Queue retained requests**. The original inbox receives the retained requests. Repeating the operation adopts identical existing records and completes remaining enqueue work.

Signer modules and policy files remain at their original paths and are checked against retained fingerprints. This preserves module-relative imports and the operator environment. A source review expires after 15 minutes; changing the paths clears the visible review.

## Operate selected requests

Select individual rows or **Select queued requests**, then choose **Run selected here**.
The workspace starts one child of the original collections CLI for the reviewed
manifest and those exact intents. The current run appears above the collection.

Each original payment review comes from the maintained SF81 browser broker and
its shared approval panel. Inspect the live request, full accepted terms and
budget estimate, then choose **Approve** or **Reject**. The server binds that
decision to the currently owned launch, original intent, approval ID and request
digest. The native reservation result determines approval; the original signer,
payment and response delivery then continue in the same buyer. Each selected
request has its own review. The collection proceeds sequentially and stops on
the first unresolved outcome or interruption.

Open **Operator workspaces** when the selected requests use existing private
workspace keys. Enter one shared absolute directory, or one
`original-intent=/absolute/workspace` line per selected request. Leaving both
empty uses the host's existing operator environment. The original queue binds
the chosen workspace to each saved operator configuration and preserves its
private keys with the host-selected browser transport.

**Prepare terminal command** remains available. Copy that exact command to a
separate terminal for the original terminal route. To run the workspace itself
in terminal-only mode, add `--approval-mode terminal` to its serve command.
The default is `--approval-mode browser`.

The visible workspace refreshes every five seconds while this tab is active.
A lost decision reply is followed by a fresh snapshot of the same original
review. A failed snapshot disconnects the approval controls until the original
host responds again. Its table uses original queue states:

| State | Meaning |
| --- | --- |
| `QUEUED` | Available for its first execution. |
| `RUNNING_OR_INTERRUPTED` | Execution began and needs its original terminal or recovery record. |
| `ATTEMPT_RECORDED` | The original execution has a terminal record; inspect its outcome for the result. |
| `RECOVERED` | Original recovery has recorded its observation. |
| `CANCELLED` | Cancelled before an execution attempt. |

**Cancel selected** operates on queued requests. **Recover selected** operates on original execution attempts and reads their existing evidence. Request details retain buyer outcomes, HTTP responses, errors and recovery records.

A `FINISHED` collection has a terminal, recovery or cancellation record for every member. Individual outcomes determine which deliveries succeeded. The recorded-attempt counter counts records.

## Pause, restart and retained launch requests

**Pause run** revokes pending review for the selected original intents, signals
the owned CLI and waits for its existing cancellation and cleanup. The browser
shows **Pausing** until the child closes. The original queue retains any already
started attempt and its outcome. When it finishes, explicitly select the
remaining queued requests to continue.

Before dispatch, the host stores the browser request ID, immutable manifest
fingerprint, ordered intents and workspace mapping in the private collection
store:

- `browser-runs/REQUEST_ID/request.json` retains the exact launch selection.
- `process.json` records the owned child PID when returned by the operating system.
- `result.json` retains the child's terminal state and any returned error code.

These files use the existing private initialization and exact-byte publication
helpers. Broker credentials and signer secrets remain in the host environment.

Repeating a request ID with the same selection reopens the same launch.
Changing that selection under the same ID is refused. A restarted host reads
the retained request and result; a request without its terminal file is shown
as **Reopened**. Inspect its original collection run and queue history before
selecting any remaining queued work. This reopening does not dispatch that old
request again.

The same collection's original manifest, inbox and run records remain the
authority for request outcomes. Browser launch records retain the host command
and its receiving state. Kernel locks and original single-attempt queue records
continue to arbitrate competing processes.

Closing the owning server pauses and drains its child, closes its broker and
then closes its owned collection controller. Locking one browser tab clears
that tab's private session; the current host operation remains visible after
reconnecting with the same private URL.

## Receive the original response files

A completed saved response has **Download response** in its request row. The row
shows the original byte count and SHA-256. The workspace reopens that original
native response descriptor under the reviewed collection manifest, reads the
saved file through one held file handle, checks its size and hash, and streams
it to the browser. The browser checks the received bytes again before offering
the file for saving. Server hashing uses a fixed-size buffer.

This control uses the original buyer's `SAVED` result. Its exact response file
and all original outcome details remain in the retained inbox. Reopening the
collection offers the same saved response. Downloads can run while another
selected request is progressing; stopping the workspace cancels its active file
transfers and releases their owned handles.

## Export results

**Export results** creates a private export under the collection store's `exports` directory. Download any of its five files:

| File | Contents |
| --- | --- |
| `collection.json` | Immutable collection manifest and original request bindings. |
| `results.json` | Original queue outcomes and run history. |
| `requests.csv` | Request terms, state and retained delivery information. |
| `review.html` | Standalone collection report. |
| `manifest.json` | Sizes and SHA-256 digests for the four export members. |

Downloads verify saved file size and digest. Their session routes last one hour; the files stay on disk. Keep the original inbox, ledger, evidence and delivery directories with the collection because the result index references those retained files.

## Embedding and local interface

Installed package exports `./buyer/collections` for the controller and `./buyer/collections/server` for this workspace. The actual package name is reported by `starforge source`.

`startCollectionsWorkspace({directory, queueRoot, port, approvalMode, environment})`
opens and owns its controller. `serveCollections(controller, {port, approvalMode,
environment})` serves an already-open controller whose lifecycle remains with
the caller. Both return `origin`, `url`, `server` and asynchronous `close()`.
`approvalMode` is `BROWSER` by default or explicitly `TERMINAL`. `environment`
is supplied by the trusted host and defaults to its original process environment.
The browser request body cannot choose a broker socket or token.

The owning server creates the original SF81 broker. It copies only that broker's
`SF81_APPROVAL_SOCKET` and `SF81_APPROVAL_TOKEN` into the existing environment
of its single child. The original SF88 queue preserves that selected transport
through workspace loading and `checkOperatorChannel`. Saved operator JSON and
process-global environment are unchanged.

The same-origin local JSON API requires the private bearer key. Mutations require the reviewed manifest fingerprint.

| Method and route | Operation |
| --- | --- |
| `GET /api/status` | Store and original inbox binding. |
| `GET /api/collections` | Retained summaries. |
| `GET /api/run` | Current owned launch or most recent retained browser request. |
| `POST /api/collections/:id/run` | Start or reopen `{requestId,expectedManifestSha256,intentIds,workspace?,workspaceByIntent?}`. |
| `GET /api/runs/:launchId/approvals/:intent` | Current original review for an intent belonging to the active launch. |
| `POST /api/runs/:launchId/decision` | Submit `{intent,approvalId,requestSha256,decision}` to the original broker; decision is `approve` or `reject`. |
| `POST /api/runs/:launchId/pause` | Revoke pending review and pause/drain that original child. |
| `POST /api/preview` | Review `{configFiles:[absolutePath,...]}` and return a short-lived `reviewId`. |
| `POST /api/collections` | Save `{id,name,reviewId,expectedPreviewSha256}`. |
| `GET /api/collections/:id` | Original states and run history. |
| `POST /api/collections/:id/enqueue` | Queue retained inputs with `expectedManifestSha256`. |
| `POST /api/collections/:id/cancel` | Cancel selected `intentIds` with the same fingerprint. |
| `POST /api/collections/:id/recover` | Recover selected original attempts. |
| `POST /api/collections/:id/command` | Produce selected run arguments and a POSIX shell command. |
| `POST /api/collections/:id/response` | Reopen one `intentId` with `expectedManifestSha256` and `expectedResponseSha256`; return its original saved-file descriptor and private download route. |
| `GET /api/deliveries/:key/:name` | Stream that original response after rechecking the collection, native delivery descriptor and actual file. |
| `POST /api/collections/:id/export` | Save results and return file download routes. |

Host, origin and fetch-site checks protect the loopback interface. JSON bodies, paths and export filenames are validated. Export output uses the existing private-directory and exact-byte retention helpers. Browser request data is rendered with text nodes.

See [README.md](README.md) for the single executable original-inbox lifecycle example.
