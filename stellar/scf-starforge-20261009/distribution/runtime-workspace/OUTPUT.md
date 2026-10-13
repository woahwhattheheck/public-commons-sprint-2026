# Read and deliver complete Application output

Applications retain each operation's original worker output. Open **Original
operations → Open output** to read that complete file through the same private
Runtime workspace. An edition that also includes Launch Groups can use its
member's **Original output** control with this same reader.

The output reader starts at the live tail. **Beginning**, **Previous output**,
**Next output**, **Selected end** and **Go to byte** browse a fixed selected
range. **Keep this output selection** freezes the currently displayed range.
The selected end remains fixed while the worker appends newer output. Choose
**Follow live output** to read the current tail again.

The operator can follow a long commissioning run, inspect its earlier source
or native error, receive the complete original log, and continue the same saved
Application request. The existing Review, Start, Recover and Stop controls,
worker process and original terminal input remain in their existing workflows.

## Browse a saved operation

1. Select the original saved Application and its operation in the existing
   paginated history. Where Launch Groups are installed, a group selects the
   same member Application and original operation.
2. Read the live tail, then choose **Beginning** to inspect its earlier output.
   The description shows the selected byte range, fixed end, current retained
   size and original operation ID.
3. Use **Find in this output page** for exact text matches in the displayed page.
   **Next match** moves through the first 500 shown matches. Paging selects the
   next part of the same original file.
4. **Go to byte** accepts an offset inside the selected range. UTF-8 page edges
   expand around a complete character, so the displayed starting byte may be
   up to three bytes before the requested offset. **Next output** uses the
   returned end offset and does not split those characters.
5. Choose **Download complete selected output** to receive every original byte
   from zero through the displayed selected end, including portions outside the
   visible page. A later append remains outside that earlier selection.
6. **Refresh output** checks the selected original file again. **Follow live
   output** deliberately opens the current source and its current end.

A frozen selection and offset are retained in this browser session by Runtime
workspace, Application and operation identity. Reopening that same operation
restores its selected range. Automatic process refresh preserves a frozen page
and its scroll position.

The displayed text normally removes terminal escape sequences and presents
line endings readably. **Show decoded text without terminal cleanup** shows the
original UTF-8 decoding. Original downloads retain escape bytes, line endings
and every other byte exactly. An incomplete UTF-8 sequence at the selected
end or invalid UTF-8 bytes can appear as replacement characters in the text
view; the original download preserves those bytes.

## Source selection and interruption

A selection records the actual Application and operation, original file
generation, fixed end and hashes of the selected beginning and end. The file
generation uses its device, inode and creation time. Each read checks the
named file against the opened handle and validates the selected range.
A rotated, replaced or shortened output requires an explicit new selection.
The reader does not silently combine that replacement with the earlier page.

This is a view of the existing append-only worker log. It does not create
another saved log or alter the worker. The original Runtime receiving and
backup workflow retains the actual operating files. Keep a completed download
when handing a selected range to another engineer.

A missing output may mean that the original queued worker has not created it
yet. Its original operation remains available through Applications. Reopen or
recover that saved request through the existing lifecycle controls. A failed
download can be requested again against the same selected range. The browser
uses the existing authenticated, short-lived download capability and streams
the original bytes.

## Native API

Open the original Runtime workspace through its existing exported model:

~~~js
import { openRuntimeWorkspace }
  from '@tokenjunkielabs/starforge-merchant/runtime-workspace';

const workspace = await openRuntimeWorkspace({ directory: originalDirectory });
const first = await workspace.applicationsOutputPage({
  applicationId, operationId, offset: 0,
});
const following = await workspace.applicationsOutputPage({
  applicationId, operationId, selection: first.selection,
  offset: first.nextOffset,
});
~~~

The method **applicationsOutputPage** accepts:

| Field | Meaning |
| --- | --- |
| applicationId, operationId | Existing saved Application and its original run |
| selection | Optional original returned selection token; omission selects the current file/end |
| offset | Optional nonnegative byte offset; omission reads the last page of the selection |
| limit | Optional page size, 4–262,144 bytes; default 65,536 |

The response includes selection, sourceId, requestedOffset, actual offset,
nextOffset, endOffset, current totalBytes, appendedBytes, hasPrevious, hasNext,
decoded text, returned byte count and original download filename. Offsets are
zero-based and their end is exclusive. A UTF-8 edge can make a page up to six
bytes longer than its requested size.

The method **applicationsOutputDownload({ applicationId, operationId, selection })**
returns stream, close, exact selected bytes, original identities and filename.
Consume it with Node's stream pipeline and call close in a finally block.
A prepared but unused stream should be destroyed and closed. Reading uses
bounded chunks and rechecks the selected original source before successful
completion.

The authenticated HTTP interfaces are:

- **GET /api/applications/output-page** with those original query fields.
- **POST /api/applications/output-download** with the original IDs and optional
  selection; its response supplies a single-use download URL.
- The existing **/api/applications/output** and **/api/applications/terminal**
  retain their original contracts for current clients.

Unknown or duplicate query fields, invalid ranges and mismatched operation
selection are rejected. The new readers use the existing saved run mapping;
they do not accept a caller-supplied path.

## CLI and complete private file receiving

Use the retained IDs from **application-history**:

~~~sh
starforge runtime-workspace application-output-page \
  --workspace /srv/starforge/runtime-workspace \
  --application-id ORIGINAL_APPLICATION_ID \
  --operation-id ORIGINAL_OPERATION_ID \
  --offset 0

starforge runtime-workspace application-output-page \
  --workspace /srv/starforge/runtime-workspace \
  --application-id ORIGINAL_APPLICATION_ID \
  --operation-id ORIGINAL_OPERATION_ID \
  --selection ORIGINAL_RETURNED_SELECTION \
  --offset ORIGINAL_RETURNED_NEXT_OFFSET

starforge runtime-workspace application-output-export \
  --workspace /srv/starforge/runtime-workspace \
  --application-id ORIGINAL_APPLICATION_ID \
  --operation-id ORIGINAL_OPERATION_ID \
  --selection ORIGINAL_RETURNED_SELECTION \
  --output /srv/starforge/receiving/original-operation.log
~~~

The export streams to a new private file, retains every original byte, and
returns its byte count and SHA-256 with the Application, operation and source
selection. It creates the destination exclusively and does not replace an
existing operator file. Its temporary file is cleaned up after completion or
failure. Omit **--selection** to deliberately select the current complete range.

The maintained distribution includes this reader, browser component and
guide through its original Runtime workspace source component. Applications
use this reader and their original operation state. Where Launch Groups are
installed, they use the same reader.

## Runtime operations and installation attempt handover

The **Operations** screen uses this same complete output reader for source builds,
managed commands and releases, Python operations, image operations, transfers,
installation and recovery. Open the original operation's output from its existing
workflow. The heading carries its saved operation ID and operation name. Its
saved result, process observation and recovery controls continue to come from the
original operation; reading a log does not change them.

For an existing registered runtime, choose **Read installation attempts**. The
list reads the original retained filenames from that runtime's directory, newest
attempt number first. It supports both original `install-N.log` files and the
current installer's `install-N-UUID.log` files. The latest saved filename and phase
come from `install-state.json`. Older attempts display their actual filename,
observed byte count and file modification time. A historical filename does not
supply an outcome. The list opens fifty attempts at a time; **Load earlier
retained attempts** continues from the last actual filename. **Refresh source
list** starts a fresh inventory while preserving the exact selected filename.
If that cursor file was removed, refresh the list instead of combining pages
against an invented continuation.

An operation with an existing registered result/runtime exposes **Open
installation attempts**, so an operator can move from the worker's output to the
installer's retained attempt bytes. This navigation does not start installation
or recovery. A runtime with no current state log can still expose its earlier
retained attempts.

### Read, preserve and return to the original output

1. Select the original operation or exact npm attempt.
2. Use **Beginning**, **Previous output**, **Next output**, **Go to byte** and
   page search to read the complete retained output.
3. Choose **Keep this output selection** before reviewing an older span while
   the existing worker continues. The selected end and page remain fixed.
4. Download the complete selected output. This streams the original file from
   byte zero through the selected exclusive end; it does not load the whole
   log into a server string or download only the displayed page.
5. Return to **Follow live output** explicitly when ready to read new bytes.

The selected source and per-source frozen page restore in the same browser
session. A different operation, runtime, npm attempt or workspace has a different
selection. Runtime tokens include the actual workspace identity and source kind;
the original Application selection format remains compatible. The original
append-only file checks and UTF-8 page boundary behavior described above apply
to all sources. A replaced/shortened file or changed head/end guard requires a
new explicit selection. These guards do not hash the entire middle of the file.

### Native Runtime interfaces

| Interface | Operation |
| --- | --- |
| `model.runtimeOutputSources(input)` | Original worker source or paginated retained npm attempt inventory |
| `model.runtimeOutputPage(input)` | Fixed-end original byte page |
| `model.runtimeOutputDownload(input)` | Complete selected stream, byte count, source identity and explicit close |
| `GET /api/runtime-output/sources` | Capability-authenticated source selection |
| `GET /api/runtime-output/page` | Capability-authenticated page |
| `POST /api/runtime-output/download` | Same-origin authenticated preparation of one-use, 60-second download URL |

Each input chooses exactly one of:

- `{operationId}` for an existing saved operation and its fixed worker.log.
- `{runtimeId, logFile}` for an existing registered runtime and the exact
  native npm filename. The inventory accepts `{runtimeId, cursor?, limit?}`;
  the page/export requires the explicit filename.

Page options are the same `selection`, `offset` and `limit` described above.
No caller supplies a path or directory. Model reads use the registered private
runtime directory or original private operation directory. The inventory reports
a not-yet-created worker file distinctly from a file that cannot be read.

```bash
# Select the original worker output, then read from its beginning.
runtime-workspace output-sources --workspace /absolute/customer-workspace --operation-id ORIGINAL_UUID
runtime-workspace output-page --workspace /absolute/customer-workspace --operation-id ORIGINAL_UUID --offset 0

# Enumerate the actual retained attempt names; use the returned filename.
runtime-workspace output-sources --workspace /absolute/customer-workspace --runtime-id ORIGINAL_RUNTIME_ID
runtime-workspace output-page --workspace /absolute/customer-workspace --runtime-id ORIGINAL_RUNTIME_ID --log-file ORIGINAL_INSTALL_FILENAME --offset 0

# Export the exact fixed end returned by a previous page.
runtime-workspace output-export --workspace /absolute/customer-workspace --operation-id ORIGINAL_UUID --selection ORIGINAL_SELECTION_TOKEN --output /absolute/new-output.log
runtime-workspace output-export --workspace /absolute/customer-workspace --runtime-id ORIGINAL_RUNTIME_ID --log-file ORIGINAL_INSTALL_FILENAME --selection ORIGINAL_SELECTION_TOKEN --output /absolute/new-attempt.log
```

CLI exports use the same exclusive new-file writer and streamed SHA-256 as
Application exports. They preserve original bytes, print source/selection/size/
hash metadata, and refuse to overwrite an existing operator file. Omitting a
selection explicitly opens a fresh selection of the current original file.

### Existing native receiving course

Continue the original Runtime/backup operation and its retained customer
workspace. Use one existing worker log and one earlier npm attempt, each beyond
a single page where available. Read beginning/next/a byte jump; freeze the
selected end while its existing writer appends; restore that selection after
reopening; export and compare against the same original prefix. Open a second
source and return to confirm its saved page remains source-specific. Use the
original Application reader (and Launch Group reader where installed) with its
earlier selection to confirm
the shared core retained that interface. Preserve the existing managed result
classification, terminal input, backup contents and cold-restore continuation.

Use a disposable copy of the original output for replacement/truncation behavior.
Return the native result to the existing distribution/backup receiving operation,
with the original source/workspace/run/attempt identity. This is a continuation of
the cumulative Runtime customer workflow.


## Public distribution and receiving on another host

The public distribution carries the complete Application and Runtime output
readers, original APIs/CLI, both browser components and this guide. Property
Operations and GridFabric selections include the maintained Runtime workspace
backup component. Their complete original source selection includes these
output files; the public package keeps its existing Application, workbook,
managed-result and paginated operation-history workflows.

After new-host workspace receiving, an archived runtime entry must have its
explicit current-host binding before its installation attempt files can be
read. The reader uses that reviewed runtime directory and preserves the
archived entry. Original operation logs remain inside the received workspace.
A changed source file or host requires a fresh output selection; an earlier
file-generation selection is never silently rebound.

Use the same original receiving/customer operation for the following source
edition. Before describing the outgoing product as ready, run that exact
installed application and personally inspect its actual desktop and narrow
screens. Operate populated, empty and unavailable-output states, range controls,
source changes, frozen-selection reopen and complete downloads. Open each
outgoing attachment and compare its complete original bytes with the retained
selection. Preserve the source commit, workspace/run/attempt, actual rendered
screens and resulting downloads in that original operation. Source review and
V8 checks remain separate from this actual native and visual receiving.
