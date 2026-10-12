# Corrective work and recipient returns

Use **Work items** to turn a native record or diagnostic into assigned work, retain the completed correction, review it, and accept a receiving operator's return into the original project.

The work register shares the same workspace, source records, native tag proposals, saved editions and original-request recovery as the rest of Haystack. Every work item keeps its captured source and material context throughout later corrections.

## Capture and assign

Open a complete record in **Asset register**, or choose a finding in **Diagnostics**, then capture it as a work item. Give it a clear title, a complete description, an assignee, a due date and a priority. A manual record review uses the exact native row. A diagnostic capture also retains the complete finding, including its details and content identity.

The queue can filter by disposition, assignee, priority, original source and text. Open an item to see its current assignment, original record, complete finding and current diagnostic state. A diagnostic can now be absent, changed, still present, or outside the currently selected sources. Its saved capture remains available in each case.

Edit an open assignment using the complete current item. Updates preserve the earlier event and record the operator and note. Submitted or completed work is reopened explicitly before its assignment or evidence changes.

The displayed operator and assignee are recorded names. Access continues through the workspace's configured local connection and token.

## Retain the correction and submit

Attach the actual file, a saved native tag proposal, or a complete operator observation. File evidence retains its full bytes, name, media type and SHA-256. The application accepts each file up to 8 MiB; its complete workspace capacity is 128 MiB.

A proposal attachment includes the full before/after native changes and the review state at the time it was attached. The native **Tag reviews** workflow remains responsible for preparing and accepting changes to the source grids. A saved proposal attachment can be opened and its intended edits copied to a fresh native draft for review against the current material.

Submit the work with its completion note and at least one retained evidence item. Choose a saved edition or the current working material. The submission records an immutable material context, evidence selection, submission round and work-history identity.

The reviewed material is stored once for each distinct material SHA-256. Original source bodies and evidence files stay separately retained, so later work events reference them without nesting entire workspaces.

## Review, verify and reopen

A reviewer reads the exact submitted work and chooses its disposition.

| Decision | Result |
| --- | --- |
| Verify | Records verification of the exact submission and material. A captured automated diagnostic must be absent in that material. |
| Reopen | Returns submitted, verified or excepted work to progress. Its earlier submission and decision remain in history. |
| Accept exception | Records the operator's complete reason for retaining the condition as an explicit exception. |

If the selected material changed after submission, reopen the item and submit the current completed work. Selecting another source does not make a finding disappear: submission and review require the original source and row to be present.

A verification retains its reviewer, note, submitted material, evidence and decision. Later source edits remain visible through the current-finding comparison.

## Send and receive a complete project

Prepare **Complete workspace** from the existing delivery section. The package includes all original native sources, typed proposals, editions, mutation outcomes, corrective-work histories, material contexts, full evidence and the complete application.

Receive the downloaded package into a new directory:

~~~sh
node cli.mjs receive --file /absolute/haystack-project.json \
  --destination /absolute/received-project

node /absolute/received-project/application/cli.mjs serve \
  --directory /absolute/received-project --port 0
~~~

The receiving operator continues that same workspace identity. They can update assignments, retain files and proposals, submit their work and create a new complete workspace delivery to return.

New deliveries use `commons.haystack.package.v2`. The receiver also accepts the original v1 package with its exact 36-file application inventory. The v2 application includes 41 complete files: the original application plus the corrective-work module, reports, guide, native operating programme and browser operator programme. Package verification checks the inventory belonging to its declared format.

## Review the returned work in the original project

Open the original workspace and choose the complete returned workspace file in **Work items**. Preview it before applying a return. The application compares each item with its original finding and common history.

For each returned item, choose **Keep local** or **Accept return**. If both operators changed the same field, choose its local or incoming value explicitly. Independent field changes combine automatically after acceptance. Later returns compare through previously accepted recipient branches, including a recipient's deliberate reversal of an earlier edit. If two copies have several incomparable common histories, the comparison displays their complete earlier values and requires an explicit choice wherever the current values differ. Assignment fields are separate; disposition, submission and review form one complete progress value.

Accepting a return retains the original local events and the receiving operator's event branch. It adds the original operator's decision to the same history. Original source bytes, reviewed material contexts and evidence are joined by their complete identities. A material checksum identifies the native grids; a separate context identity retains the exact proposal reviews that produced them. Independent reviews of identical material are both preserved. The original project's source selection stays under its existing source-selection controls.

Native proposals remain reviewable through **Tag reviews**. A returned proposal attachment carries its full intended change, so the original operator can prepare it against the current source material and review it normally.

The return preview is bound to the current workspace revision and each original work-item head. If a peer changes the project, refresh the preview and review the new comparison. An interrupted apply uses the existing **Operations** page to read the original result before an unchanged resend.

A complete returned file can be up to 192 MiB. Native HTTP and CLI accept its base64 request envelope. The native server admits one request larger than 48 MiB at a time while preserving its ordinary request concurrency. Managed Merchant calls retain their existing provider request limit; use the native local UI or CLI for a larger full project file.

## Reports and offline review

Prepare a **Corrective work register** in JSON, CSV or HTML.

The JSON retains complete work events, contexts, return decisions and evidence bodies. HTML provides the readable register, complete work details and downloadable retained files. CSV provides the assignment and disposition table with exact evidence and source identities.

The complete workspace package is the editable receiving artifact. Each completed delivery remains available under its original operation ID and exact file checksum.

## Native action access

The browser, native MCP, HTTP and typed JavaScript client use the same declared actions.

| Purpose | Actions |
| --- | --- |
| Queue and full history | `works.list`, `work.read` |
| Capture and assignment | `work.capture`, `work.update` |
| Complete evidence | `work.evidence`, `evidence.read` |
| Submission and review | `work.submit`, `work.review` |
| Recipient comparison and acceptance | `return.preview`, `return.apply` |
| Original return decisions | `returns.list`, `return.read` |
| Reports and editable package | `delivery.prepare`, `delivery.read` |

Read `catalog` for the complete required arguments. The generic CLI supports every action and retains each mutation request before sending:

~~~sh
node cli.mjs catalog --out /absolute/haystack-actions.json

node cli.mjs request work.capture --directory /absolute/original-project \
  --args /absolute/reviewed-finding.json \
  --request-file /absolute/requests/capture-finding.json

node cli.mjs replay --directory /absolute/original-project \
  --request-file /absolute/requests/capture-finding.json
~~~

A mutation carries the original UUID operation ID and reviewed workspace revision. Work-item changes also name the exact reviewed work head. Keep the complete original request after a lost response. The saved original outcome is recovered before any resend.

## Native operating programme

Run the complete corrective-work journey against the bundled, byte-identical Charlie source in an owned operation directory:

~~~sh
mkdir -p /absolute/haystack-corrective-operation
flock -n /absolute/haystack-corrective-operation/programme.lock \
  node CORRECTIVE_RECEIVING.mjs /absolute/haystack-corrective-operation
~~~

Continue using that same directory. The programme retains original requests, actual completed steps, full reports, workspace deliveries and receiving results. It exercises native HTTP, CLI and MCP, lost-response recovery, a concurrent peer edit, two consecutive recipient returns, distinct reviews of identical native material, reviewer dispositions, the actual browser workflow and independent package receiving. Browser execution uses Playwright and a local Chromium installation through the existing runtime; its persistent profile and original tab drafts live under the same operation directory. Its state and reports use the original 624-row Charlie grid.

The browser companion exports `runCorrectiveBrowser` for the original receiving programme. It uses that programme's running workspace and retained files. The complete result is written after the operator stages, full reports and independent receiving have finished; restarting the command continues the same original requests and saved steps.
