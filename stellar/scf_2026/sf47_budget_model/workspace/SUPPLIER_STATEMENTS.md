# Supplier statement reconciliation

Open **Delivery operations → Supplier statements** in the existing grant workspace. Select the original supplier, complete statement attachment and exact reporting period. The desk compares the statement against the existing supplier account: issued invoices, original payment/refund allocations and opening/closing balances.

## Retain the original statement

Attach the complete CSV/TSV export supplied for this account, or choose its existing original attachment. Enter its stated opening and closing USD balances and confirm the complete period. Preserve the issuer document alongside a manually transcribed table when the original is a PDF. Use the original Source attachments control to retain that document.

Inspect the original rows. Select encoding, delimiter, header and date/number format. Map document reference, row type, event date and signed USD effect to exact original columns or explicit constants. The original parser retains logical row and source-line locations. Invoices are positive; credits and payments are negative; adjustments retain their explicit sign.

The maintained reconciliation engine supports 1,000 rows per complete generation, safe integer USD cents and a 31-day generation age. It compares exact canonical references and row types. Repeated document references must be explicitly disambiguated with retained source corrections; a possible match remains a separate review suggestion.

**Row corrections** retain original cells, selected fields and an operator reason. **Native reference mappings** retain the original record and entered comparison reference. Neither changes invoices, payments or other original records. Open those original desks when a record needs its normal correction workflow.

## Review and save

Choose **Review complete comparison**. Read all original rows, current native account activity, exact matches, missing items, amount differences and closing-balance variance. Each exception can remain open, carry an explanation, or link a selected original invoice/cash record with its exact version. Possible-match suggestions keep the underlying exceptions.

Save a **Draft** with outstanding items or mark the edition **Reviewed** after every exception has an explicit choice and note. Enter the saved review note and choose **Save reviewed edition**. The native transaction retains the original source, complete account snapshot, mapping, corrections, decisions, engine receipt, actor, request and predecessor edition.

Open any saved edition to read its original comparison alongside the current account. **Prepare following edition** preserves the earlier review and opens its full document against current records. If the exception set changed, retain the earlier decisions in working history, clear them explicitly and review the current set. Earlier editions remain immutable.

## Continue an interrupted operation

Unfinished field text and the complete pending request are retained in this browser under the original named staff/installation context. **Download working desk** carries that entire working state and earlier drafts. Open the same file through **Open working desk** on the original case to continue. Before replacing it, the desk downloads the current complete copy.

A second browser tab cannot replace a newer saved draft: the original IndexedDB revision comparison stops that write. Download this tab's work, then **Open saved browser copy** and combine the intended changes.

If save loses its reply, choose **Continue original request**. The exact saved command is looked up and replayed through the original request journal before any current-version checks. An accepted result is adopted once. An unaccepted stale request stays retained; a definitively rejected request can be downloaded and retained before returning to the editable draft. Renew the original staff session rather than changing the request's operator.

## Complete handover

**Download complete statement handover** contains the complete native operating case, every original attachment and statement edition, the selected saved review, readable HTML, statement/ledger/exception CSVs and exact selected source bytes. Open the HTML and all usable CSV/JSON/source members. Import the whole ZIP with the existing case importer; it validates original case history, complete historical account generations, source bytes, engine results and predecessor reviews. It opens the selected original edition in the received case.

Re-export from that received case to carry its current local identity alongside unchanged original historical reviews. Original supplier/work/invoice/payment records remain available through their existing controls.

## Native commands

Use the normal `operations` CLI with the original workspace selection:

~~~sh
python3 cli.py --workspace /absolute/original/workspace operations supplier-statements --case operation-...
python3 cli.py --workspace /absolute/original/workspace operations supplier-statements-seed --case operation-... --expected-version 12 --document-only --output statement-document.json
python3 cli.py --workspace /absolute/original/workspace operations supplier-statements-preview --case operation-... --expected-version 12 --document statement-document.json --output statement-preview.json
python3 cli.py --workspace /absolute/original/workspace operations supplier-statements-save --case operation-... --expected-version 12 --document statement-document.json --expected-preview-sha256 ORIGINAL_SHA --actor "Original operator" --note "Reviewed complete supplier period" --request-id ORIGINAL_UUID --output statement-save.json
python3 cli.py --workspace /absolute/original/workspace operations supplier-statements-export --case operation-... --review review-... --output supplier-statement.zip
~~~

Use `supplier-statements-show` for a saved edition, `supplier-statements-request` to inspect the exact retained command, and `supplier-statements-resume` to continue that same command file. Keep whole inputs and request files private with the original operating workspace. CLI outputs use the existing create-only publisher.

## Native and rendered receiving

Run the maintained complete supplier-statement receiving entrypoint with the selected original case, source attachment, complete document and original actor. Its retained operation directory carries the original request before dispatch, accepted result, complete handover and independent receiving selection. Continue that same operation directory after an interrupted response.

The browser course opens the selected populated and empty states, actual source rows and exceptions, retained working draft, saved review and complete downloads. It produces desktop and narrow screenshots and reopens the actual HTML/JSON/CSV/source/ZIP members for inspection.


# Repository delivery instructions

Use the current README and the existing product's build/receiving guide. Coordinate through the original implementation and receiving owners, preserve concurrent source, and carry work through its authorized delivery.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

## GitHub Actions zero spend — existing owner instruction

Keep GitHub Actions disabled in this repository's provider settings and preserve the disabled source policy in [.github/hosted-ci-policy.json](.github/hosted-ci-policy.json). Every workflow job must retain the established literal-false condition, including manual dispatch and reusable jobs. Preserve its original condition inside the wrapper, and preserve the complete steps, commands, source and delivery artifacts.

Run focused product work in the existing cloud Linux or original local receiving operation. A public repository, available free minutes, cloud admission failure or a missing green check does not authorize enabling or dispatching hosted Actions. Do not set `HOSTED_CI=on`, add scheduled hosted runs or choose a paid runner. Keep source-native receiving moving with its original owner and saved operation.

Before publishing workflow changes, use the maintained Commons `tools/hosted_ci_gate.py --zero-spend REPO_ROOT` and `--check REPO_ROOT` source operation where that existing runtime is available. Its canonical wrapper is `${{ (false) && (ORIGINAL_CONDITION) }}`; the original condition is retained for native continuation. Provider disablement, the whole-account spending budget and dated billing remain separate controls; preserve current artifacts and their original custody.

This carries Bryce's existing zero-spend instruction from [Commons RULES, CI and spend](https://github.com/woahwhattheheck/commons/blob/main/RULES.md#4-ci-and-spend) into this repository's consumed entry guidance. Original cost coordination: https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791755765336589 .

### Continue the original complete receiving operation

```sh
python3 supplier_statements_receiving.py --plan /absolute/supplier-plan.json --output /absolute/original-supplier-operation --url http://127.0.0.1:ORIGINAL_PORT --token-file /absolute/original/access.key --receiving-url http://127.0.0.1:RECEIVING_PORT --receiving-token-file /absolute/receiving/access.key --node /absolute/node --playwright /absolute/installed/playwright/index.js --chromium /absolute/original/chrome-headless-shell --browser-url-file /absolute/original/private-browser-url.txt
```

The plan schema is `stellar-forge.sf47-supplier-statements-receiving.v1`, with `operationId`, `caseId`, `expectedVersion`, `actor`, `note` and the complete normalized `document` returned by native preview. The optional `followingDocument` and `followingNote` select an explicit later edition on that same original case. To review both full documents before the first save, set `followingPreviousReview` to `first-accepted-review`, keep the following document’s `statementId` equal to the first document’s and leave its `previousReviewId` null. The receiver resolves only that generated predecessor from the exact accepted first result, retains `FOLLOWING_SELECTION.json` with its original review hash, then previews and freezes the complete following request at that accepted case version. All business fields remain exactly as entered; a concurrent case change stops the following save. If the following business decisions will be made after viewing the first result, keep the original plan unchanged and prepare a separately named operation using its actual `reviewId` and current reviewed version.

Both service URLs select already-open original owners. The receiver creates its imported cases through the existing complete-case importer. It does not close either service. Its one operation lease is inherited by the browser helper and retained until that owned child drains. `RESULT.json`, `RECEIVED.json`, original request/results, complete ZIPs and the browser PNGs remain together for the producing operator to open and use.
