# Accountant recipient review

Use **Accounts → Statements → Accountant recipient review** in the existing grant case. Prepare the statement using its original CSV, OFX / QFX or MT940 source, select the account and interpretation, and run the existing native preview. Enter the intended recipient’s name and role, then choose **Save edition and download offline reviewer**.

The download is a complete HTML working review with the unchanged original bank bytes, source interpretation, native row preview, initial row decisions and retained invoice positions. It works offline. Keep it with the intended recipient: it contains private financial records. The original edition remains in the existing named Statement working copies.

## Recipient workflow

Open the downloaded HTML directly. Review the source account, currency, opening/closing balances and interpretation. Download and open the original bank file when needed. Browse all native rows or search by reference, description, date or amount; search and pagination preserve edits on other rows.

For each row, retain or recommend its action, cash classification, original grant tranche (0, 1, 2 or 3, or none), reason and invoice allocations. Choose retained invoices by supplier and invoice number; enter the explicit USD amounts. Existing native cash rules still determine which classifications, tranche choices, exclusions and allocations can be imported.

Enter the reviewer name, role and whole-statement note. **Download attributed recommendations** produces a complete JSON return for every original source row. It records who prepared the review, the intended recipient, the self-attributed reviewer and return timestamp. It does not authenticate the reviewer’s identity. The owner receives it as advice and chooses its application.

Download the return before closing. Use **Reopen a returned review** in the same HTML to continue its full work. The file must belong to the same original issued review. **Download complete review source** provides the complete original review packet; **Download original bank file** retains the original file exactly.

## Owner receiving and three-way comparison

In the same case and original statement working copy, choose **Open returned recommendations**. The desk looks up the issued review in its local working copy and reads the exact original immutable edition from the existing saved-copy store. A returned file cannot substitute another source edition.

Choose **Compare original, current and returned**. Every changed field shows the issued value, the current draft value and the returned recommendation. Concurrent changes are identified explicitly. Invoice allocations use supplier/invoice labels with amounts. Review every page, then choose **Keep current** or **Use returned** for every changed field. There is no implicit “accept all” conflict policy.

**Apply selected recommendations to original draft** preserves a complete pre-apply edition, applies only the selected fields, records the full return/attribution/choices and saves the following complete edition. Unrelated current decisions and unfinished allocation work are retained. Any changed selected-row allocation proposal is invalidated; the original unfinished draft amounts remain available for review.

Run the existing **Preview original statement** after applying. Review its current invoice positions, balances, exclusions and row findings. Only the existing confirmed native cash import can save cash movements. This workflow adds no financial command, second ledger or service.

## Source, concurrency and original request continuity

An offline review can be issued only from a current native preview in an open case. Dirty or incomplete copied drafts must be previewed first, so their retained preview rows cannot be mistaken for a newly edited interpretation.

Receiving uses the exact original bank bytes, account, selected bank section, column mapping, number/date format, source metadata and other interpretation inputs. Changing this context requires reopening and previewing the original context before comparison. Classification and allocation recommendations do not silently change the source or its interpretation.

A comparison retains the complete current draft. Changing the draft or returned file invalidates application; compare again and make deliberate choices. Pending imports, accepted responses awaiting readback and setup requests keep their existing lock and exact request payloads. The original Staff-scoped database, original recording actor and current case remain selected.

Issued packets omit only earlier recipient bookkeeping from the embedded source edition. Complete source and native work remain intact. The saved working-copy archive retains the issued packets, returned files and application history once; repeated review issuance does not recursively nest every older packet.

## Complete recovery

Download **all complete copies** from Statement working copies. That archive includes all original immutable source editions plus issued reviews, current return and application history. Import it into the same original case/operator and open the selected copy before receiving its return.

A selected recovery draft by itself may contain the current review but not every earlier immutable edition required to authenticate its source. If the desk requests the complete original working-copy archive, import the whole archive rather than supplying a replacement edition in the returned file.

The existing statement limits remain: original bank files up to 8 MiB, saved complete editions up to 64 MiB, complete copy archives up to 256 MiB. Retain complete downloads periodically and keep them private.

## Maintained source and same original receiving course

- `operations_statement_review.mjs` contains the source-bound pure review model, three-way comparison, selected apply, desk panel and complete offline HTML.
- `operations_statements.mjs` joins the original local draft/copy store, current Staff context, offline download, return receiving, pre-apply preservation and original native preview.
- `operations_http.py` serves the module through the existing authenticated app. `managed-source.json` includes its full source and this guide.
- The original `operations/scf-statements-original-32c2-20261013/operate-original-statements.mjs` course uses the retained CSV, source interpretation, actual 250 USD invoice and same independent BrowserContext/server/case before the original cash import. It opens the actual offline reviewer, downloads a complete return, creates a concurrent decision, compares and selects recommendations, then re-previews the unchanged original source.

Pure entrypoints are `prepareStatementRecipientPacket`, `prepareStatementRecipientReturn`, `receiveStatementRecipientReturn`, `compareStatementRecipientReturn`, `applyStatementRecipientReturn`, `statementRecipientPanel` and `statementRecipientReviewHTML`. The issuing packet includes its immutable native edition; receiving and apply also require the trusted edition from the existing local store.

The model preserves original row numbers, supports current native tranche 0–3, rejects unknown/duplicate/missing rows and unknown recommendation fields, validates retained invoice identities and explicit positive USD amounts, and requires choices for every changed field. Native preview remains authoritative for current accounting validity.

Continue the same A0D5 / 32C2 / 4593 / 390E / 0C75 operation, original case, four original bank files and receiver. Preserve completed phases and original requests. Receiving source is prepared until the actual maintained app and downloaded review are opened and observed; attach actual wide/narrow captures to this original operation for the producing peer to inspect and repair.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

## Several returns and unfinished operator choices

Use the [Returned review worklist](STATEMENT_REVIEW_WORKLIST.md) to keep each colleague's complete return, independent operator notes and saved field choices in the original working copy. Reopening resolves the trusted original edition and checks the current comparison. Stale choices remain visible and require a fresh comparison; identical return files reopen their existing work item. Complete copy archives preserve the whole review handover.
