# Repository Workspace — operating guide

Repository Workspace provides a local browser interface for the original 4Science DSpace MCP tools. It keeps source captures, complete metadata arrays, selected records, reviewed operations, original native responses, files and receiving exports together.

The included upstream source is pinned to 4Science/dspace-mcp commit ee503ba97910f592867c897c1fa938f9e029d03c, tree 6386328dd49282b98840b4dd41340b9c8a110b78. The bridge registers its 15 original tools on the real MCP SDK server and connects through the SDK's in-memory transport. All original source and license notices are included under vendor/dspace-mcp.

## Start a workspace

Use Node.js 24 or later. Install the dependencies from the original lockfile, build the pinned TypeScript source, and start a saved workspace directory:

~~~bash
npm --prefix vendor/dspace-mcp ci --omit=dev
node scripts/build-upstream.mjs
node server.mjs --workspace ./workspaces/repository --port 8790
~~~

Open the local address printed by the server. Keep the same directory and port when reopening the workspace. The directory contains the actual SQLite records and retained original file bytes. Closing the browser does not cancel a dispatched native operation.

The server binds 127.0.0.1. Its browser session is local to that running server. Every API request uses the current session token. Downloads use a short-lived link issued to that session and consumed once by the browser. Reload the page after restarting the server so it receives the new session.

The application source directory and the saved workspace directory serve different purposes. Preserve your saved directory, or export a complete handover, before moving to another machine.

## Repository and account

In **Discover**, enter your operator attribution. This names the person or team responsible for a saved action. The original DSpace authenticated account is recorded separately from the operator label.

Choose **Add repository**, enter its name and REST base URL, and select its connection mode.

For a public repository, choose **Public, anonymous reads**. For a configured account, enter the names of the environment variables whose values the server should read. Variable names begin with DSPACE_, such as DSPACE_TOKEN, DSPACE_USER and DSPACE_PASSWORD. Set their actual values in the server process environment before starting it. Enter variable names in the interface.

Choose **Connect account** to read the original authentication status and discover the original tool schemas. The header shows the returned native account. A repository may allow anonymous discovery while requiring a staff account for changes.

Saved repository profiles retain their URL and environment variable references. **Revise configuration** creates a successor profile. Existing captures and executions keep their original repository and account binding. When an authenticated successor points to the same repository URL as an imported source, it can prepare a plan from that source while preserving the original capture.

## Discover and retain material

**Read communities and collections** follows every page reported by the original repository. Selecting a community reads its collection pages. Search accepts ordinary terms, a community or collection scope, result type and page size. Previous and next buttons follow the native search pagination.

Each read is retained immediately, including the original MCP result, native request URLs, returned response bodies and capture time. Search results show source records from the page. Select specific records with their checkboxes, then choose **Save selection**. If no boxes are selected, the complete displayed result page is selected. Name the selection before saving it.

You can also enter an item's original UUID and choose **Read item**. This captures the complete item metadata and original owning collection.

The **Records** section includes the complete retained objects. Filter by title or UUID, or choose a collection scope observed in the retained search pages. **Select filtered items** creates a selection from those exact original item identities. Records are keyed by repository, object type and original UUID or workspace item ID; matching titles remain distinct records.

To inspect the source behind a record, use **Read complete source**, or open the original capture under **Activity**.

## Edit complete metadata

Open a retained item under **Records**. Its metadata editor displays all fields and every value in each field. Existing value objects keep their language, authority, confidence, place and any additional native properties.

Values whose authority begins with virtual:: come from linked entities. They remain read-only in this editor, while ordinary stored values in the same array remain editable. The interface joins the original relation metadata by that authority and provides **Open linked item** when the source supplies its UUID. DSpace-controlled relation.* fields remain intact. Ordinary dc.relation.* fields remain ordinary metadata. Long value arrays can be expanded as needed.

Edit the text or language of a value, add another value, add a metadata field, remove a value, or explicitly remove the field. Removing a value and removing the entire field are separate operations. Enter an operation name, then choose **Prepare metadata change**.

Preparation saves the exact original capture and constructs the RFC 6902 patch against it. It opens a reviewable plan with complete before and after values. A newly added field, an absent field and an existing null value retain their different meanings.

The editor does not silently replace the complete item when you change one field. The plan contains the specific metadata paths you selected, and the execution checks those touched fields before dispatch.

### Apply the same field to a selection

Open a saved selection, then expand **Batch metadata operation**. Supply the metadata field and its complete replacement array of native value objects. For example:

~~~json
[
  {
    "value": "Open access",
    "language": "en",
    "authority": null,
    "confidence": -1,
    "place": 0
  }
]
~~~

This operation sets that complete field array on each selected item. The resulting plan shows each item's original and proposed values. A plan supports up to 100 steps; a saved selection supports up to 500 exact source records. Narrow a larger selection before preparing an operation.

## Review, apply and recover

Under **Changes**, inspect the saved repository, source capture, subject, arguments, preconditions and complete before and after values. Enter a review note, then approve the plan or request changes.

An approved plan has a separate **Apply reviewed operation** form that names its destination repository. The execution reads the original account again and checks the relevant source fields before calling the original tools. It records the execution before the first native write.

Each execution step retains its original arguments, native responses, observed subject ID and status. A later profile selection does not redirect an existing execution to another repository.

If staff changed one of the planned fields after the source was captured, the execution reports the conflict. Open **Prepare a corrected successor**, read the latest item, edit its current metadata and prepare a new plan. The earlier plan and execution remain available.

If an operation's result is uncertain, open its saved execution and choose **Recover original execution**. Recovery reads the original target and account. It checks the expected metadata or original returned subject before accepting the result. For an uncertain creation, provide the exact returned UUID or workspace ID when the original response supplies it.

An interrupted browser request is also shown under **Activity → Requests awaiting a returned result**. The browser saved its identifier and exact input before sending it. **Retry saved request** uses that same identifier and input. It does not create a fresh request simply because the first response was lost.

### Reverse an accepted edit

An accepted metadata edit or collection move can produce a new reversal plan. Choose **Prepare a reversal for review** from the execution. The engine reads the current native record and constructs the reversal against the accepted result. Unrelated subsequent staff edits remain intact.

Review and apply the reversal as its own operation. Uploaded files and created items are separate native objects and do not appear as reversible metadata edits.

## Files and document text

From an item, **Read original files** invokes the original file listing tool. **Read all available text** invokes the original full-text tool, which prefers extracted TEXT-bundle content and falls back to textual original files.

The original MCP tool may cap its inline text display. Native response bodies retained by the workspace remain available under **Activity**. **Download exact response bytes** returns the saved body rather than a reformatted text summary.

Choose **Receive original file** to call the original bitstream download tool and retain the returned exact bytes. Retained files appear under **Handover**, with their original content type, byte count and SHA-256 digest.

To attach a file, expand **Attach an original file**, choose the file and bundle, and enter a description. The workspace first receives the local bytes as a retained asset. It then prepares a separate upload plan tied to the original item. Review the file and target before applying it. The browser supplies the retained asset ID; the server assigns the native local file path.

Use **Handover → Retain a supporting file** to keep source manifests, instructions or other original delivery files alongside the workspace. A single received file may be up to 20 MiB.

## Collection moves

Open **Move this item to another collection** on a retained item. Choose the explicit destination collection and prepare the move.

The original move tool checks compatible source and destination entity types. The prepared plan retains the current owning collection, and execution checks that it has not changed since preparation. An accepted move can produce a separately reviewed reversal.

## Submission drafts and archived items

**Submissions → Start a submission** calls the original ordinary workspace-item creation tool after review. Choose the collection and working title. The original tool creates a workspace draft and applies the initial dc.title through its traditionalpageone helper.

Use **Read my submissions** to read all returned workspace-item pages for the configured account. Select a draft to inspect the complete original sections. Prepare a field update using an actual /sections/... JSON Pointer from that source. The interface provides the returned field paths and shows the complete native section values.

The separate **Create an archived item** form is an administrative action. It creates an item directly in the explicit destination collection. Supply metadata as original key/value pairs with strings or arrays of strings, and choose discoverability. Its prepared plan identifies the immediate archive behavior.

The included original tool set exposes draft creation and section updates. Continue any repository-specific final deposit or approval action through the institution's supported submission workflow.

## Original source captures

**Handover → Receive original source captures** imports a complete dspace-source-capture/v1 JSON bundle. Each source request carries its original repository URL and response body, with available capture time, status and byte digest. Included original files are retained as assets.

Imported captures retain their source mode. A public reader's extracted native JSON is labeled accordingly. Unknown HTTP status or headers remain unknown. Connecting an account reads its current native status separately.

The included public example identifies the Publications 2 collection, its complete 44-item search cohort across three returned pages, its hierarchy and selected document metadata. Its source manifest lists the exact captured URLs and source files. Use the companion native collector to retrieve response bytes and original files from an equipped host.

## Complete handover and backup

Choose **Download complete handover** or **Download backup** under **Handover**. The complete handover is a consistent native SQLite archive with a .sqlite extension. It includes:

- Full original objects and native response records.
- Exact retained response and file bytes.
- Repository configuration references.
- Saved selections and their original capture identities.
- Plans, review notes, execution steps and operation history.
- Complete stored summaries and SHA-256 digests for the original file bytes.

Account token and password values stay in the original server environment.

To receive a handover, start a new empty workspace directory, enter your operator attribution, and choose the archive. **Inspect archive** streams the original file to the receiving server. The server verifies the native SQLite structure, complete record identities and every retained file digest, then shows its contents, repository bindings, byte count and SHA-256 digest. **Restore into this empty workspace** adopts those verified records and original bytes in one transaction.

The browser retains the original receiving identifier before uploading. If the response is interrupted, use **Activity → Recover received archive** to read that same receiving result. If the original file did not finish arriving, reselect it to continue under the same identifier. The server rejects different bytes under an already received identifier. A completed restore can be recovered with its original request even after the temporary incoming file has been removed.

Downloads stream directly from the saved archive to the browser download. Uploads stream from the selected file to the receiving server. Complete SQLite handovers do not pass through a base64 JSON request or require the whole archive to fit in browser memory. Older gzip JSON handovers remain readable.

The receiving workspace can reopen source records, selections, plans and execution history without contacting the repository. Configure the original environment variables when you need to reconnect its account and continue native operations.

## Source and operational limits

The local interface accepts ordinary JSON requests up to 32 MiB. Original source bodies have a 32 MiB receiving limit and individual retained files have a 20 MiB limit. Native SQLite handovers use the binary streaming path and are not subject to the JSON or base64 archive limits. Available destination disk space determines their capacity. Compatibility receiving of older gzip JSON archives retains its 128 MiB expanded-size limit. For larger repositories, use the original paginated collections and saved selections to operate coherent cohorts.

The operating source is maintained at:

https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/business/dspace-mcp-repository-workspace-20261012/

Original upstream:

https://github.com/4Science/dspace-mcp/tree/ee503ba97910f592867c897c1fa938f9e029d03c

Read the original AGPL license and notices in vendor/dspace-mcp/LICENSE. Preserve those notices when distributing the included original server.
