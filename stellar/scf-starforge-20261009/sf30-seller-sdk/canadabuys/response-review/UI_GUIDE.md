# Complete response review and return

This interface joins the existing CanadaBuys bidder workspace to a complete standalone supplier working copy. The native response record, original response master, original source binding and full saved workshare stay attached throughout review. The existing bidder writer owns every native transaction. The interface neither makes a bid decision nor changes supplier qualification.

## Open the original workspace

Open `/response-review/` on the existing CanadaBuys server, or use **Response review** in the bidder desk header. The screen displays the current native workspace UUID and revision.

Choose the complete original response-master JSON and a saved workshare for its notice, enter a useful title and select **Prepare native response**. The native writer validates the original source, saves the response evidence and returns the complete original document. The interface retains the command ID and complete input before making the request.

Choose an existing response to reopen its explicit saved revision. The saved-revision control can select the original historical edition even when the native head has advanced. Both the record read and working-file export must match that selected immutable revision. The source tab exposes the entire original response master, binding, workshare, response and receiving history, including the source requirement, response deliverables and proposed platform or pilot criteria. The complete original document can also be downloaded without projection.

The working respondent identity is editable response content. The edition author is the person recording the review. Those are separate fields.

## Give the supplier a complete working copy

Select **Download standalone editor**. The native endpoint includes this exact HTML, stylesheet, app, model and full transfer object in one self-contained HTML file. The receiving file opens without a server and its policy prohibits network connections. Its visible working-file download retains the complete original data and attachments.

The supplier opens that HTML locally, reads the original source and enters their name, organization and review role. They edit the existing answer text, annex section text and review comments; each retains its original identifier and source context. The answers and annexes have filters, original text views, attributed review status and explicit evidence attachment selection.

The four review states are **Unreviewed**, **Proposed**, **Confirmed** and **Needs work**. Proposed, confirmed and needs-work entries require the named reviewer and full review timestamp. These are self-attributed supplier statements. Editing reviewed text or the selected supporting evidence resets that entry to Unreviewed, requiring a new explicit review selection. No screen describes these entries as external buyer approval, a signed commitment or a saved native bid decision.

Add complete original attachments through the file control, with a description. The model validates every original byte and digest. Each file is limited to 8 MiB and the total to 16 MiB. The interface checks the complete selection before adding it; failed additions leave the earlier transfer intact. Exact existing bytes reuse their original digest identity. Every retained file has its own complete download; text files also have a full literal-text viewer. Original filenames, media types, sizes, SHA-256 and author remain visible.

**Download unfinished draft** preserves all current values without adding an attributed edition. **Save attributed edition** requires an author and saves a complete immutable edition with content and attachment selection. The full JSON is downloaded in both cases. The supplier can reopen it with **Open a complete working file**, continue its unfinished work and return the complete attributed file. Earlier editions remain inspectable in full; they are never rewritten by the editor.

Browser saving is a convenience for recovering the last local working file and original native request. If browser storage is unavailable or full, the interface states that and the complete explicit downloads remain usable. Switching browser storage or closing a tab is never a substitute for handing over the actual downloaded file. A second-tab save warns the current operator rather than replacing the open form.

## Receive, compare and select the supplier's changes

In the original native workspace, open the saved response and select the complete returned JSON. The interface checks both original workspace UUID and response ID before requesting the native comparison.

The native comparison covers every respondent, answer and annex field. Each row retains the original baseline, current native value and returned supplier value. Changed source and workshare context are shown in full and require written acknowledgement when present.

For **Return only** and **Conflict**, choose Current or Returned explicitly. The two bulk controls apply that explicit choice only to unresolved proposed/conflicting fields. Current-only, equal and unchanged fields retain their actual current/equal values. All comparison rows remain in the downloadable complete comparison; unchanged rows need not occupy the interactive working list.

Name the host reviewer, write a receiving note, then select **Save selected changes in native workspace**. The complete request includes the original transfer, selected response ID, native review hash, every selected field, source/workshare acknowledgements, reviewer, note, workspace UUID, expected revision and one command ID. The same SQLite transaction retains the whole original returned edition and writes the selected new revision of the original native response record.

A source or workspace change during review is returned by the existing native writer. The UI retains its complete original request and actual refusal. **Return to review after native refusal** downloads that request and refusal, then reloads current context for a new reviewed operation. This control is available only after an actual HTTP refusal. A timeout, malformed or lost response keeps the original request eligible only for **Resume exact saved request**. It never silently changes the command ID or expected revision to make an uncertain write appear new.

Successful receiving displays the original complete native result. Reopen the saved response to see its exact new revision and download the complete receiving result. Review the separately selected qualification and bid decision in the bidder desk when that commercial decision is needed.

## Existing source and API joins

This source owns `response-review/index.html`, `app.js`, `style.css`, `OPERATING_JOURNEY.mjs` and this guide. The original native owner supplies `model.cjs`, served as `model.js`, plus the server routes, CLI and full transaction. The bidder header receives a two-link navigation group; its original controls and writer stay unchanged.

| Native action | Interface use |
| --- | --- |
| GET /api/response-review/status | Bind workspace UUID/revision and list saved response/workshare summaries |
| POST /prepare | Save the complete selected response master and original workshare |
| GET /records/:id?revision=N | Open the exact native response edition |
| GET /records/:id/export?revision=N | Receive the complete bound transfer |
| GET /records/:id/editor?revision=N | Download the complete self-contained supplier editor |
| POST /compare | Review current context and every original/current/returned value |
| POST /apply | Atomically retain original return and save explicitly selected changes |

All native writes use the original same-origin JSON boundary and the existing host checks. The standalone copy has no native server control and makes no network request. The UI uses literal DOM text for original and authored content; it does not execute imported response text or attachments.

## Continue the same original customer

`OPERATING_JOURNEY.mjs` exports `runResponseReviewJourney(input)`. Supply the existing live page/server and original workspace, saved workshare, complete source-master path, actual selected review change and original attachment paths. The course creates no server, native workspace, replacement source or alternate buyer. Its original customer output directory is reused on continuation.

Required input is:

```js
{
  page,
  baseURL,
  outputDirectory,
  workspaceId,
  workshareId,
  masterPath,
  title,
  reviewer: { name, organization, role },
  review: { answerId, text, comment },
  attachmentPaths,
  sourceAcknowledgement,   // required only if the actual original source changed
  workshareAcknowledgement // required only if the actual saved workshare changed
}
```

Use the actual supplier-provided identity and text for a real supplier review. A production operating example must label its internal reviewer and authored edits as internal. The existing APM2 master, its twelve complete responses, three annexes and original CAD 7,200 workshare provide the source for the first joined course.

The course operates host preparation, downloads the complete standalone editor, opens it on the local file route with network access denied, edits the selected real answer, adds the selected original files, downloads/reopens the unfinished draft, records an attributed edition, opens the attachment downloads, receives and explicitly selects native changes, then reopens the original response revision. Desktop and 390-pixel views are retained. Source/file identities and result checkpoints are written atomically under the same output directory.

The checkpoint binds the complete reviewer identity, selected answer text/comment, ordered original attachment names/byte counts/hashes and any source/workshare acknowledgements. Changed inputs cannot be treated as a continuation of an earlier return. Saved response reopening checks the exact original revision, evidence SHA and edition digest before continuing.

The request interception records the exact original mutation before dispatch. A saved pending command is restored to the existing UI and continued unchanged. A completed original response is reopened instead of preparing another response. Retained editor and full downloads are hash-bound. The caller owns its existing page and server; the course closes only its own independent standalone recipient page and removes its own route/error listeners.

Actual returned images, every original attachment and the exact working downloads must be opened and inspected by the producing worker. Any source or presentation defect is repaired here and integrated into the same original customer. Source parsing or a retained course does not substitute for that actual operating result.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.

Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999

