# Recipient catalogue corrections

This workflow lets a catalogue owner issue a complete saved correction revision, receive attributed edits in a portable file, and reconcile those edits with later author changes. The original correction history remains the place where the author saves the accepted result. The surrounding catalogue migration, semantic review, materialization, release selection and whole-workspace receiving controls remain available.

## Start with a saved catalogue revision

Open the DCAT migration workspace, select a correction draft and its saved revision, then open **Recipient catalogue corrections**. Enter an issue label, issuing editor, intended recipient and a useful description of the requested work. Choose **Save complete recipient issue**.

The issue contains the selected revision, every preceding correction document and attributed revision record, the original retained catalogue, and the original migration review when the draft started from a reviewed candidate. Files with identical contents share one stored byte payload while retaining every original file name and purpose. The issue is bound to the saved revision and exact document SHA256.

Download the complete recipient HTML. Keep the initial proposal JSON and issue package alongside it when exchanging work through a system that treats HTML as an attachment. The author workspace also exposes every enclosed original file separately. An issue is immutable: a later author revision can coexist with the recipient's copy.

Choose a revision that includes the context the recipient needs. Unfinished author edits are still in the author's change set and have not become part of the issued revision.

## Work in the standalone recipient document

Open the HTML in a current browser. Its catalogue data, correction history, source files, editor, stylesheet and proposal state are embedded in the document. The document makes no network requests. Its content policy permits only the exact embedded program and stylesheet.

The first screen identifies the issuer, recipient, purpose, issue ID, proposal ID and baseline hashes. Browse the complete catalogue by JSON pointer, use the search box, and page through the child values. Each pointer identifies an exact location: `/dataset/0/title` selects the first dataset's title; an empty pointer selects the document root. Escape a literal slash in a property name as `~1` and a literal tilde as `~0`.

The editor uses the original exact JSON parser. Numbers are retained as their original text, including integers beyond JavaScript's safe integer range, long decimals and exponent forms. Existing whitespace and untouched values remain in the original document. For an edited string, enter valid JSON including its quotation marks. For a Boolean enter `true` or `false`; for null enter `null`. A numeric value such as `9007199254740997` stays that exact value.

Compose an ordered change set with add, replace, remove and move operations. Add each completed operation to the queue. Use **Up**, **Down** and **Remove edit** to adjust the queue. Move requires a source pointer. Array insertion and movement use the positions that exist at that point in the ordered change set.

Choose **Preview complete change set**. Inspect the affected values and download the complete preview and resulting document if useful. Enter the editing author's name and a reason, then choose **Save attributed recipient edition**. This appends a saved edition containing the exact ordered edits, predecessor, document hash and attribution. The saved history exposes each document and complete edition record.

The edition selector can open the issued baseline or an earlier saved edition for inspection. Earlier editions are read-only. Continue editing from the current saved head. Only saved editions are selectable for author adoption.

## Keep and transfer the complete working state

Use **Download complete working HTML** to retain a portable copy that opens with the same saved editions and unfinished work. **Download complete return JSON** contains the same complete proposal in a format suitable for a file exchange service or an automated receiving operation.

Both formats include the issued source and history, every saved recipient edition, queued operations, author and reason fields, and even an incomplete literal still in the editor. An unfinished literal is retained as text and does not become a catalogue edit until it is completed, queued, previewed and saved.

A browser-local backup records edits for this exact issue and proposal. If the browser has a different saved copy, the document presents it explicitly: restore the local changes, download that local copy, or retain a download and continue from the opened file. Browser storage can be unavailable or cleared, so the portable HTML or JSON is the copy to transfer and keep.

The file selector opens another saved HTML or JSON for the same issue and proposal. It checks the complete package and history before replacing the current working state. Download the current state first when retaining two parallel versions is useful. Every enclosed original file also has a complete download.

Return the complete HTML or JSON through the agreed file channel. The returned file includes the recipient's unfinished state as well as the saved editions.

## Receive and reconcile as the author

In the original author correction draft, choose the complete returned file and receive it. The workspace retains the original returned bytes, the full parsed proposal and the issued source association. Receiving a proposal adds it to the draft's return history.

Select a saved recipient edition. The workspace compares three exact documents:

| Document | Purpose |
| --- | --- |
| Issued | The saved author revision originally sent to the recipient |
| Current | The current saved head of the author's correction draft |
| Returned | The selected saved edition from the complete recipient proposal |

Independent object-field edits can combine. When both sides changed the same value differently, the preview requires an explicit choice: keep the current author value, use the returned recipient value, or restore the issued value. Each row exposes the full values and the reason for the conflict. Page through all comparison rows; **Download complete reconciliation and choices** gathers every page into one download.

Array structure needs particular care. An insertion, deletion, move or replacement can change which record a numeric index addresses. If the recorded histories cannot prove that positions remain stable, the comparison treats that array or changed container as one atomic choice. Inspect the complete current and returned array values before choosing. A restoration can similarly require a document-level choice. This avoids silently applying a recipient's positional edit to a different author record.

Choose the values for all conflicts. The preview records the current author revision, selected issue/proposal/edition, choices, complete comparison and resulting document hash. Enter the accepting author and a useful reason, then choose **Save reconciled author revision**.

Adoption goes through the original correction save operation and appends an attributed author revision. The adoption decision retains the full comparison binding and choices. A decision that keeps every current value still receives an attributed adoption record. The author history exposes the resulting revision and complete decision download.

A changed author head or changed selection invalidates the preview. Refresh it against the current saved revision and inspect the new comparison before saving. Existing queued author edits remain available; opening an adopted revision waits until that existing change set or pending request has been handled.

## Continue through publication and receiving

Open the adopted author revision, inspect its exact document, then use the existing correction workbench to materialize it as a retained catalogue. Run the original migration review and applicable semantic profile on that retained catalogue, inspect the resulting reports, and use the existing release controls for the intended outcome.

Export the whole workspace archive. It includes the original catalogue and reviews, correction documents and history, issued recipient packages and HTML, original complete return files, parsed recipient histories, adoption decisions and materialized catalogues. Receiving validates the source associations, saved edition chains, file sizes and hashes, chosen author revision and complete decision bindings.

Receive that archive into an independent workspace and reopen it. Use the catalogue browser, issue/proposal history, saved revision downloads and adoption decision downloads there. This is the same receiving route used by the surrounding DCAT workspace; the proposal workflow does not require a separate archive format or secondary writer.

## Follow an interrupted operation

Issue, receive and adopt operations each use one stable request UUID. The author interface retains the original request and lets you refresh its status, retry it unchanged, or download its complete input. The workspace also retains complete pending request input and restores it when the browser reopens this correction draft. A recovered receiving request asks for the same returned file by SHA256. CLI and MCP callers retain that UUID and exact request input before invoking the operation.

A lost HTTP response is reconciled against the original workspace state. Retry the same request to retrieve or complete its saved result. Receiving is bound to the returned file SHA256, so the same bytes can be reselected from another temporary path.

If an adoption saved the author revision but stopped before finishing its adoption decision, continue that same request. The interface identifies this state and keeps the original UUID selected until the decision finishes. An existing saved revision is not a reason to create a second adoption request.

A confirmed failed request that saved no outcome can be retained as an input download and returned to editing. Preserve its input while resolving the reported issue. Pending requests and workspace operations use the original workspace lease.

For automation, the CLI guide contains complete command examples, file hashes, expected head/preview fields, operation tracking and exact retry instructions. Keep the request file with the returned proposal until receiving and independent reopen are complete.

## CLI, MCP and Applications

The installed `dcat` command adds these operations:

| Command | Complete operation |
| --- | --- |
| `correction-exchanges` | Page/search issued packages, received proposals or author decisions |
| `correction-issue` | Issue one exact saved author revision and its complete source history |
| `correction-exchange` | Read an issued package's metadata, enclosed files and received proposals |
| `correction-proposal` | Read a complete return's editions, unfinished state and decisions |
| `correction-receive` | Receive an exact complete returned file by its SHA256 |
| `correction-reconcile` | Compare an edition with the guarded author head and explicit choices |
| `correction-adopt` | Save the reviewed result through the original correction writer |
| `correction-exchange-export` | Export any complete issue, recipient HTML, original return, decision or enclosed source file |

The managed Merchant MCP installation exposes ten tools under `merchant_ckan_dcat_correction_exchange_`, including immutable paged reads for large metadata and comparison results. The existing **DCAT catalog workspace** Applications entry opens the same browser workspace. See [CORRECTION_EXCHANGES_AGENT.md](CORRECTION_EXCHANGES_AGENT.md) for the full agent operating course and exact tool arguments.

## Size and history limits

The complete issued package accepts at most 128 MiB of unique source bytes and 128 MiB per original file. A complete proposal/package is limited to 256 MiB, attributed recipient history to 32 MiB and saved recipient editions to 256. One saved revision accepts at most 1,000 ordered edits. Comparison pages display up to 200 rows through the API; the browser uses 30 rows.

If a complete reconciliation exceeds the original revision's edit limit, retain the comparison and choose a smaller saved recipient edition. The interface reports the actual size or history limit. Preserve the complete source and saved work while resolving it.

## Operating the complete customer course

The existing correction customer course starts from the completed semantic-comparison result and its complete following archive, receives an independent workspace, exercises the original 344-record GSA catalogue, and exports a following archive for independent reopen. Its source is under `operations/dcat-correction-customer-390e-20261013/`.

For recipient work, operate the same course's received workspace: issue its restored saved revision, download/open the full recipient HTML, make and save exact typed edits, retain an unfinished editor value in working HTML, reopen that file, and return it. Make a concurrent author edit, receive the full return, inspect the three documents, resolve the actual conflicts, and save the attributed author result. Export and independently receive the whole workspace again.

Inspect both desktop and narrow browser views, every generated download and each screenshot. Check that every original source and prior history is still present, saved editions reproduce their exact document hashes, unfinished text reopens, the adopted revision and decision remain linked, and the final archive opens independently. Record the actual source commit, original operation IDs, following archive and observed results with that existing customer operation.
