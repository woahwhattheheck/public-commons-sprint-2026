# Research RIS source operations

Use the Research workspace to retain original RIS files, review their complete records and duplicate groups, receive an edition into a dossier, and compare a later review with the earlier edition. The browser, command line and Merchant integration use the same dossier store and the same request receipts.

The delivery contains the complete application and its dependencies, the original provider response carrier, all selected reports and portable exports, and the complete native result. Start with `README.md` and `DELIVERY_MANIFEST.json` in the package to locate the exact source entrypoints and files.

## Open the application

The full receiving programme uses the runtime paths in its selection file: Node 24 or later, Python 3, the installed Playwright JavaScript module, and its installed Chromium executable. For interactive work, start the supplied Research server with Node and the supplied Python runtime. Keep the workspace and connection file in an owned private directory.

~~~sh
umask 077
RIS_ROOT="/ABSOLUTE/EXTRACTED/engine-source/PATH/TO/research-dossiers"
RIS_NODE="/ABSOLUTE/NODE_24_OR_LATER"
RIS_PYTHON="/ABSOLUTE/PYTHON3"
RIS_PRIVATE="/ABSOLUTE/PRIVATE/RESEARCH"
RIS_STORE="$RIS_PRIVATE/workspace"
RIS_CONNECTION="$RIS_PRIVATE/research-connection.json"
mkdir -p "$RIS_PRIVATE"
chmod 700 "$RIS_PRIVATE"

"$RIS_NODE" "$RIS_ROOT/server.mjs" \
  --dir "$RIS_STORE" --port 0 \
  --clinical-trials-python "$RIS_PYTHON" \
  --extraction-python "$RIS_PYTHON" \
  --connection-file "$RIS_CONNECTION"
~~~

Replace the source path with the Research directory shown by the delivery's entrypoints. Open the URL printed by this listener in a browser on that host. The connection file and printed URL carry the local session connection; keep them with the private workspace. The listener remains the owner of this store while the browser, CLI and Merchant client use it.

To receive a supplied portable dossier, use the command in the receiving guide against this listener. Then open the returned dossier in the browser and select **RIS sources**.

## Prepare a source edition

Choose the dossier question that this edition will support. In **Prepare and review**, enter the edition label, reviewer and source declarations. Retain the original filename, declared encoding, database or source, query, retrieval/export times, source URL, source reference and notes with each original input. Use the complete original files.

Prepare the inputs and inspect the returned records before receiving them. The review keeps unknown tags, repeated fields, field order and the decoded original record alongside the parsed bibliographic values. Use **Inspect complete original record** to inspect the original representation. Parser diagnostics remain available for review.

For an existing edition, **Saved editions → Open source and review → Continue from retained files** starts a later review from those same retained source files. The later edition keeps its relationship to the earlier edition. Choose the earlier-selection treatment explicitly when the later review changes which evidence should remain selected.

The current source limits are declared in `ris-source/constants.mjs`: up to 32 documents, 8 MiB of combined original document bytes, 5,000 records, a 16 MiB source declaration and a 64 MiB reviewed edition. A commercial receiving scope can be smaller; use the agreed scope for the customer engagement. The native case supplied with this delivery uses three small input entries.

## Review records and duplicates

Review every source occurrence. Set the evidence classification, selection and full review note. Where records are duplicates, record the duplicate decision and its reason; keep the original occurrences available for inspection. An explicit deferred duplicate group remains visible without selecting its occurrences.

The included case uses two original Crossref RIS responses and one explicitly labelled byte-identical local copy. Its baseline selects the two distinct papers. Its subsequent browser review defers the duplicate group, classifies the other paper as background, and deselects the earlier edition's selections. These are recorded intake and provenance decisions.

Use **Refresh review** after editing. The reviewed plan binds the exact source, all record decisions, duplicate decisions, question, previous-edition treatment and base dossier revision. Receiving saves that plan as one dossier revision.

## Save and recover complete review work

The browser saves complete draft edits locally. Wait for **Complete edits are saved in this browser.** before closing a working tab. **Download complete draft** exports the complete draft, including the original source bytes and review. Keep this file with the operation if work needs to move between browser profiles or machines.

To resume from a file, choose **Open a complete saved draft for this dossier**, inspect the recovered source and review, then choose **Use this reviewed recovery draft**. Refresh the review before receiving.

The supplied browser programme exercises both actual page reload and the complete recovery-file route. Its export helper retains each complete downloaded artifact and its descriptor before publishing the artifact into the customer output directory. If that publication is interrupted, the next run completes the retained original bytes.

## Receive an edition

Choose **Receive in one dossier revision** after the complete review is ready. Retain the original request ID and its full payload. A successful receipt identifies the original source, reviewed plan, request, question, received edition and dossier revision.

If another user changes the dossier, the original request may receive a revision conflict. Use **Review current dossier revision**, inspect the current dossier, and choose **Use reviewed revision N** to bind that same reviewed request to the chosen revision. Then retry the same request.

If the connection closes after the server saves the request, choose **Check saved receipt**. The request's original ID retrieves its saved receipt. A later dossier revision does not erase the earlier request receipt. The complete native browser programme performs this recovery after an actual saved response is withheld from the browser.

## Read and export saved editions

Use **Saved editions** to open an original edition and review its complete source and record decisions. Available exports include the reviewed edition, original source declaration, every original RIS document, an individual original record, review HTML/CSV/Markdown, derived selected RIS and the dossier portable representation.

Original document exports retain the exact source bytes. The selected-RIS export is the declared derived UTF-8 representation. CSV exports protect spreadsheet cells while preserving their review content. A dossier JSON or gzip export contains the RIS editions and their review history.

Use **Compare editions** to select the earlier and later edition, then **Compare retained editions**. Save the complete JSON, HTML or Markdown comparison. The comparison records the two original receipt identities and the changed review and selection content.

Export a named revision when a report must refer to a specific point in the dossier history. Save new destinations for distinct exports so an older customer file remains addressable by its original hash.

## Operate the same workspace from the command line

Use the actual connection file, directory and dossier ID from the running workspace. The following commands call the same source API:

~~~sh
"$RIS_NODE" "$RIS_ROOT/workspace-cli.mjs" ris-list \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER"

"$RIS_NODE" "$RIS_ROOT/workspace-cli.mjs" ris-request \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER" \
  --request "$RIS_ORIGINAL_REQUEST"

"$RIS_NODE" "$RIS_ROOT/workspace-cli.mjs" ris-review \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER" \
  --edition "$RIS_EDITION" --offset 0 --limit 50

"$RIS_NODE" "$RIS_ROOT/workspace-cli.mjs" ris-export \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER" \
  --edition "$RIS_EDITION" --format source --out "$RIS_PRIVATE/original-source.json"

"$RIS_NODE" "$RIS_ROOT/workspace-cli.mjs" ris-export-comparison \
  --connection-file "$RIS_CONNECTION" --directory "$RIS_STORE" --id "$RIS_DOSSIER" \
  --before "$RIS_EARLIER_EDITION" --after "$RIS_LATER_EDITION" \
  --format html --out "$RIS_PRIVATE/edition-comparison.html"
~~~

Set the dossier, request and edition variables to the actual returned identities. Continue pagination until the requested records or editions are complete. `ris-prepare` reads original host files with their declared SHA256 and source provenance. `ris-prepare-source` reuses a complete retained source declaration. `ris-preview` returns the reviewed plan, and `ris-receive` submits the full reviewed request. The complete command usage is in `ris-source/cli.mjs` and the workspace CLI help.

The Merchant registration uses these same operations through the existing Research workspace adapter. Its native receiving phase retains the original receipts, complete streamed exports and replay/history observations in the delivery's `run/merchant/` files.

## Maintain the installed product

Keep the full source selection together. The RIS module imports the existing Research client, dossier normalizer, store, report and transport code; the delivery includes those files, Python components, static browser assets and original licenses in their repository layout. Publish improvements against that whole source selection and retain the actual operation's completed exports before moving to a later version.

The controlling source references are `ris-source/constants.mjs`, `schema.mjs`, `parser.mjs`, `review.mjs`, `store.mjs`, `client.mjs`, `cli.mjs`, `public/ris-sources.js`, `public/ris-drafts.js`, and the complete engine manifest supplied with this delivery.
