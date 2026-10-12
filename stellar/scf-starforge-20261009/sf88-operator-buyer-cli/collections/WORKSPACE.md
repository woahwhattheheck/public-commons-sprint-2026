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

## Review and retain a collection

1. Select **New collection**, enter its name and stable ID, then paste absolute paths to existing SF88 operator configuration files, one per line.
2. Select **Review requests**. Inspect the resource, method, spending limit and response destination. Exact totals keep each network, asset, recipient, scheme and payment flow separate.
3. Select **Save reviewed collection**. The controller verifies that the files still match the review and retains configuration, request-body and operation-ticket bytes.
4. Select **Queue retained requests**. The original inbox receives the retained requests. Repeating the operation adopts identical existing records and completes remaining enqueue work.

Signer modules and policy files remain at their original paths and are checked against retained fingerprints. This preserves module-relative imports and the operator environment. A source review expires after 15 minutes; changing the paths clears the visible review.

## Operate selected requests

Select individual rows or **Select queued requests**, then choose **Prepare terminal command**. Copy the exact selected-intent command into a separate terminal on this host. The original buyer opens its usual approval for each paid request. The collection runs sequentially and stops on the first unresolved outcome or interruption.

The visible workspace refreshes every five seconds while this tab is active. Its table uses original queue states:

| State | Meaning |
| --- | --- |
| `QUEUED` | Available for its first execution. |
| `RUNNING_OR_INTERRUPTED` | Execution began and needs its original terminal or recovery record. |
| `ATTEMPT_RECORDED` | The original execution has a terminal record; inspect its outcome for the result. |
| `RECOVERED` | Original recovery has recorded its observation. |
| `CANCELLED` | Cancelled before an execution attempt. |

**Cancel selected** operates on queued requests. **Recover selected** operates on original execution attempts and reads their existing evidence. Request details retain buyer outcomes, HTTP responses, errors and recovery records.

A `FINISHED` collection has a terminal, recovery or cancellation record for every member. Individual outcomes determine which deliveries succeeded. The recorded-attempt counter counts records.

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

`startCollectionsWorkspace({directory, queueRoot, port})` opens and owns its controller. `serveCollections(controller, {port})` serves an already-open controller whose lifecycle remains with the caller. Both return `origin`, `url`, `server` and asynchronous `close()`.

The same-origin local JSON API requires the private bearer key. Mutations require the reviewed manifest fingerprint.

| Method and route | Operation |
| --- | --- |
| `GET /api/status` | Store and original inbox binding. |
| `GET /api/collections` | Retained summaries. |
| `POST /api/preview` | Review `{configFiles:[absolutePath,...]}` and return a short-lived `reviewId`. |
| `POST /api/collections` | Save `{id,name,reviewId,expectedPreviewSha256}`. |
| `GET /api/collections/:id` | Original states and run history. |
| `POST /api/collections/:id/enqueue` | Queue retained inputs with `expectedManifestSha256`. |
| `POST /api/collections/:id/cancel` | Cancel selected `intentIds` with the same fingerprint. |
| `POST /api/collections/:id/recover` | Recover selected original attempts. |
| `POST /api/collections/:id/command` | Produce selected run arguments and a POSIX shell command. |
| `POST /api/collections/:id/export` | Save results and return file download routes. |

Host, origin and fetch-site checks protect the loopback interface. JSON bodies, paths and export filenames are validated. Export output uses the existing private-directory and exact-byte retention helpers. Browser request data is rendered with text nodes.

See [README.md](README.md) for the single executable original-inbox lifecycle example.
