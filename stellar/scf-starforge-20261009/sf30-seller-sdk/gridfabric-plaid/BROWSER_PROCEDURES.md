# GridFabric customer procedures in the browser

Open **Customer procedures** from the existing GridFabric console. Use the original private operator connection. This screen prepares a complete customer Operating Plan, receives reviewed source and outcomes from the current Grid workspace, and downloads the complete captured handover.

The original Grid server, SDK and procedure capture remain the execution path. Preparing or capturing a procedure reads the original workspace. Device dispatch, management requests, callback projection and report generation remain the separate explicit controls in the main console.

## Prepare a customer procedure

1. Read the current workspace and choose its actual Plaid instance.
2. Enter the customer, title, period, owner and receiving instructions.
3. Browse the original collections and select each record with its intended procedure step. Pages remain pages: use their continuation to inspect more records. The capture later receives every dependent source row, report row, receipt and original file required by the selected records.
4. Select any additional complete native files or an already-created workspace export. A procedure capture contains the selected original evidence and dependent records. The separate full workspace export is included only when explicitly selected.
5. Prepare the plan using the current installed command catalog.

The nine original steps are workspace, configuration, sources, mappings, callbacks, events, dispatch, reports and delivery. Use the existing Operating Plan fields to edit their instructions, expected results, owners, due dates and progress. Preserve the complete saved history when importing a previously edited plan.

Native record statuses remain source observations. A successful read does not mean a device was dispatched or a customer task was completed. Record a step assessment explicitly when that status is intended.

## Save edits and capture

The screen keeps its draft and original capture request in the browser's workspace-specific IndexedDB record. Save the complete draft before leaving. A storage failure is shown before a new capture is dispatched; retain the entered values and retry saving that same draft.

A capture request includes one UUID, the normalized selected input, complete catalog, full plan history and capture time. The browser retains that whole request before sending it. The server binds the same complete request before any capture reads.

Capture checks the selected workspace directory, workspace ID, source hash and revision. It reads through an authenticated original SDK borrower, receives full dependent pages and files, and checks the same revision again before publishing the final capture marker. A workspace change requires a new reviewed input; it never silently changes the saved capture request.

The native capture preserves customer-edited steps, their order, carried files and all earlier revisions. Download **gridfabric-plan.json** for the whole Operating Plan history. The HTML and Markdown files are readable handovers of the recorded plan.

## Receive an interrupted response

Open the saved request and read its original outcome before starting another capture.

| State | Action |
| --- | --- |
| Running | Read the same request again. Its original SDK reads still belong to the server. |
| Complete | Reopen the full native capture and receive its original files and plan. Replaying the same UUID and complete request returns that capture. |
| Incomplete | Inspect the original attempt and error. Continue the same complete request explicitly if its reviewed source and revision are still current. |
| Request conflict | Keep the existing request. Compare its complete input, catalog, plan and time before choosing a separate UUID for different work. |

Each explicit capture or archive-import continuation uses a new numbered attempt under the same request. Earlier partial output and errors remain available to the operator. A completed native marker can be received even if the last HTTP response or the following summary-file save was interrupted.

An incomplete request whose selected source or revision has changed remains an earlier attempt. Prepare a separate current selection; do not edit the old request underneath its UUID.

## Download the complete handover

Download any member by its exact path from the verified capture. The original bytes, lengths and SHA-256 identities are retained. The complete package download is a **.gridprocedure.jsonl.gz** file.

That archive carries every declared native capture member and its final **capture.json** marker. File bytes are streamed in ordered chunks. The archive includes:

- The complete normalized procedure input and selected catalog.
- The plan before capture, every retained plan revision, and final JSON, HTML and Markdown.
- Complete original HTTP response bodies and response metadata.
- Every selected and dependent native file.
- The exact native source identity, full declared native source bodies and capture helper sources.

Keep the whole package private with its operating material. Original responses may contain customer data and account or device identifiers. The private connection token is not copied into the capture.

An archive publication interrupted before its metadata is saved is reconciled against a freshly generated archive from the same verified capture. Different original bytes are preserved and rejected; an existing archive is never replaced.

## Reopen the package elsewhere

In Customer procedures, choose the complete original archive. The browser retains its name, byte count, SHA-256 and import UUID before upload. If a page reload loses the in-memory file, reselect the same original file and continue with the retained UUID and complete file identity.

The original server allows up to 4 GiB of compressed archive bytes by default through its existing `maximumPortableBytes` setting; this importer allows 16 GiB expanded by default. Browser memory and storage allowances are displayed separately, and the installed CLI can receive a complete large archive directly.

The receiver verifies the entire uploaded file, checks every ordered member and archive footer, and invokes the same original offline capture validator. It does not import domain records into the current Grid workspace, dispatch actions or start an application. The received plan still names its original captured workspace and revision.

Reopen the full plan or download its original JSON. In **Command finder → Operating Plans**, import that JSON using the existing plan receiver. Compatible extending history is retained; divergent histories require the original explicit review/copy workflow. F2A6's complete carried-file behavior and original editor remain authoritative.

To capture a new edition against another active workspace, prepare and review that workspace explicitly. An imported historical capture never supplies a new execution binding by itself.

## Source and ownership

The browser lives in GridFabric's existing authenticated server at **/procedures**. Its controller uses **distribution/discovery/gridfabric-procedure-native.mjs** for both native capture and complete offline verification, and **sdk/http-client.mjs** for the borrowed original HTTP connection.

The server drains owned procedure reads before closing its listener. New writes are refused during shutdown; the read routes remain available long enough for an already-owned capture to close its borrower. The original Grid workspace/SQLite lease remains with the original application owner.

The browser edition declares its controller, archive, screen, route manifest and maintained route reader alongside the earlier native source roster. The Grid contribution itself includes these files and the complete discovery component, including the captured native type declaration. Its declared browser routes preserve the original console URLs and map the original Operating Plan and catalog modules for the selected-source builder. The offline reader continues to accept the complete original fifteen-member source edition and the exact expanded browser edition. It does not accept arbitrary undeclared source paths.

Original integration operation: **SCF-GRIDFABRIC-BROWSER-PROCEDURES-1FB3-20261013**, continuing the original Grid Operating Plans contribution.

## Direct archive API

The installed export `./seller/gridfabric-plaid/procedure-archive` provides typed `exportGridProcedureArchive` and `receiveGridProcedureArchive` functions. Export takes a complete verified capture directory and a new private output file. Receive takes the exact compressed byte count and SHA-256 plus a new private output directory. Both retain all original member bytes and use the same offline validator as the browser. A failed reception leaves its incomplete directory for inspection; choose an explicit new destination after receiving the failure.

## Compare a source correction with the earlier report

Use **Compare reports and outcomes** after the original reporting workflow has prepared a revised response. The useful question is: which reported intervals changed, which source gaps remain, and which mapping or operating decisions explain the difference?

1. In **Capture and saved requests**, open the earlier and later complete captures, or receive their complete archives in **Receive and return**. Select captures from the same original workspace and Plaid instance.
2. Open **Compare reports and outcomes**. Select the before and after requests. A request UUID may also be entered directly when it is on another history page.
3. Choose **Read both original captures**. The existing authenticated reader receives every original capture member. A restored browser response alone is insufficient.
4. Choose the report on each side. Captures with more than one report require an explicit report choice. Choose **Compare selected reports**.
5. Review source gaps and the before/after original quantities, then open the mapping parameters, calculation details, source rows and quality information. The interval table pages through all results; JSON and HTML downloads retain every row.
6. Review retained device/management outcomes and customer procedure changes. Use the original main console or Operating Plans editor for any subsequent operating decision.

Intervals match by original report specifier, rId and timestamp. A quantity difference is **after minus before**, using the exact decimal strings already calculated and rounded by the original GridFabric engine. It appears only when device, channel, kind, unit, aggregation, time basis and effective interval period match. Different units or semantics stay visible without a numeric subtraction. The comparison performs no new aggregation, unit conversion, energy-saving estimate or causal analysis.

A **source gap resolved** means the same measurement changes from NEEDS_SOURCE to READY. A change to a different unit, device or period is identified as changed semantics even when its new report is READY. Missing values are never zero-filled. A row selected on only one side does not establish creation, deletion or zero activity in the operating workspace.

READY means the original report response was prepared. VTN acceptance remains a separate original management outcome. An adapter's ACKNOWLEDGED status retains its original HTTP-success meaning and complete response. Changed source precedence, correction links and quality flags remain visible even when rounded quantities are equal.

### Keep and reopen the complete comparison

Download the **full comparison JSON**, **readable comparison report** and both **complete capture archives**. The JSON retains all selected original records, full plan histories, mappings, source metadata and comparison choices. Original binary files and raw responses remain in the two archives.

On another receiving host, import both archives through the existing native receiver. Open the full comparison JSON in the comparison tab, read the two received original requests, and explicitly reopen the comparison. The result is re-derived from both complete originals and must match the saved JSON in full. An HTML report is readable on its own; exact source verification and continued comparison require the JSON and both archives.

Comparison selections and an imported comparison are included in the existing complete browser-work backup. A cold page must read the original captures again. Prior imported comparisons can be retained in that backup while starting another selection. Editing a capture or report choice removes the displayed old result immediately.
