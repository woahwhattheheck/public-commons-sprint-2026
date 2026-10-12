# Bilingual consultation receiving

Version 0.2 adds a complete local review exchange to the existing standards workbench. An operator freezes a recipient packet from one edition and consultation. A reviewer opens the packet in a browser, writes comments against its exact English and French text, and returns a JSON file. The operator retains those original bytes, reviews the proposals, changes the working clauses where appropriate, and records dispositions against a frozen resolution edition.

The packet, returned comment, applied amendment and disposition have separate identities. A proposed sentence is not adopted wording. Receiving a file does not create committee membership, a vote, a closed consultation, a dispatch record or an approval.

## Open the complete review example

~~~sh
standards-workbench --workspace ./review-workspace --review-demo
~~~

This prepares a separate, stable public-source example with the original bilingual clauses and cases, one frozen edition, a consultation exercise and a ready reviewer packet. It creates no returned comments or decisions. Open that project, choose **Consultation receiving**, and download its reviewer ZIP.

The example's return instructions lead back to the local operator. Its review dates are unset because it is a practice exchange. Repeating the command opens the same project and preserves its entered returns, amendments and dispositions. The actual original public source bytes remain in the project; no separate copy of a private applicant packet is required.

A commercial or technical demonstration can use the resulting recipient ZIP, an explicitly authored returned file, selected respondent reply and successor edition as its concrete product sample. The receiving instructions are part of the source package. Actual customer responses and existing relationship messages stay with their established sender.

## Prepare the document and packet

Open **Consultation receiving** in a saved project. Start with the original public drafting example or your own working project. Keep an exercise in its own example project.

1. Edit the scope, clauses and source-linked cases. English and French text remain independently editable. A missing translation stays visible.
2. Freeze the review edition through the existing edition workflow. Retain the exact selected procedure and create a consultation against that edition. Use the procedure actually selected for the project; this feature adds no universal review duration.
3. Choose **Prepare packet**. Select the consultation, give the packet a useful title, and enter instructions and a return route in both languages. A return route may name your established mailbox, document portal or other agreed channel; it is plain text and performs no external action.
4. Download the packet ZIP. It contains `reviewer.html`, `packet.json`, `READ-ME.txt` and the handover manifest. Open `reviewer.html` locally to see the same recipient view before distributing it.

Each packet retains its creation time, consultation dates, procedure summary, original edition SHA-256, selected public projection SHA-256 and its own content identity. Later edits to the consultation or working draft do not alter the packet. The operator view reports a changed consultation and retains the original schedule.

The recipient page contains the selected edition's public citations and explicitly public, source-bound case rows. Original source attachments, people, committee correspondence, reviewer returns and private delivery accounts are omitted. Source citation visibility and original-byte redistribution remain separate settings in the original workbench. A packet does not automatically attach even an otherwise redistributable original.

## Work in the offline reviewer page

The reviewer needs a current browser and the downloaded files. The page has no account, remote service, API request or send button.

Use the language selector to read English, French or both. Search the clauses, inspect the worked cases and their original cells, and choose a clause or **General comment**. Each comment records a technical, editorial or public comment type, its language, the original observation and optional proposed English or French wording. Saving a comment preserves its entry identity while you continue editing.

Names, organization and return contact are optional reviewer declarations. They help the operator recognize the received file; they are not authenticated identity or voting credentials. The authored-exercise checkbox makes a demonstration return explicit.

Use **Save draft** before closing. The page also tries local browser storage, but browsers may restrict that storage for files opened from disk. A saved draft file is portable. **Open draft / response** checks its packet identity before adopting it; a response for another edition cannot silently replace this packet's work.

Use **Export response** when the comments are ready, then send the resulting JSON through the packet's recorded return route. Export does not transmit it. Keep the packet and a draft copy if you expect to revise the response.

## Receive original returned comments

In **Consultation receiving**, select the retained packet and choose the original returned JSON file. **Preview return** reads the file without saving project changes. It shows:

- The original filename, byte count and SHA-256.
- The packet and reviewed-edition identities.
- The reviewer's declared identity, language and timestamps.
- Each original comment and proposed wording.
- Whether the current working clause matches the reviewed edition, has changed, or has been removed.
- Any previous return with the same response identity, and the exact added, removed or changed entries.

The API accepts UTF-8 JSON of at most 8 MiB with 1–500 entries. It rejects duplicate JSON keys, non-finite numbers, unsupported fields, unknown clauses and mismatched packet bindings. An empty clause ID denotes a general comment. Returned records cannot use the negative-vote comment type.

Receiving is one original SQLite transaction. It retains the unchanged JSON bytes, adds the original source record, creates the bound comment records and records the request/result in the existing history. If validation fails, none of those changes is partially saved.

The receipt time is the operator system's actual time. Preparation and export times remain declared by the reviewer. A late or closed-consultation return remains receivable with a visible timing notice; saving it does not reopen the consultation or decide whether it is procedurally admissible.

### Duplicates and corrected returns

Receiving the same normalized response again preserves existing comment IDs and dispositions. It still retains the supplied original file bytes. Changing only the browser's export timestamp does not create a second set of comments.

A changed file with the same reviewer response identity requires the operator to select its actual latest predecessor and record a correction receipt note. Both responses remain available. Earlier open or deferred comments are listed explicitly; they are not silently removed when the corrected file omits them.

For entries whose full returned content is unchanged, **Adopt unchanged decisions** shows the predecessor, its exact comment revision, disposition and rationale. Select the entries and give an adoption reason. One transaction creates new immutable resolution records for the corrected return, each linked to the actual predecessor decision. Changed entries and entries with new operator work are excluded. Public inclusion is not copied; an operator can select that separately for an exact publication.

A genuinely separate submission has its own reviewer response ID. Content identities identify the received document, not a person. Do not merge different people merely because their names match.

## Apply wording and retain the reason

Open a received comment to compare the frozen reviewed clause, current working clause and proposed wording.

**Apply clause amendment** changes selected English/French title, body or table fields in the current working clause. You can use the submitted wording as a starting point and edit it. The operation requires the current whole-project revision and the exact current clause SHA-256. If either changed, the form retains your input and asks you to review the current text before applying the intended changes.

An applied amendment retains the original comment snapshot, exact before/after clause objects, their identities and the operator's rationale. It does not set the comment's disposition. Multiple comments can inform successive changes; the records preserve that sequence.

A clause may later be removed from the working draft without erasing an earlier applied amendment. Its historical before/after objects remain available. Moving a comment to a later edition through the existing carry workflow preserves its original-response lineage.

## Record the disposition and successor edition

Choose an explicit disposition: open, accepted, rejected or deferred. A completed or deferred disposition requires its rationale. Where wording has changed, freeze the successor edition and select its actual resolution clause.

An amendment link is accepted only if the selected frozen clause contains that amendment's paired English/French text. If a later edit changed those words, link the actual later amendment or record the disposition without claiming that the earlier text is the final wording. The original amendment still remains in history.

Each disposition is immutable. Reopening or changing the current comment creates a successor disposition record; it does not rewrite the old record. The view reports whether each retained disposition still matches the current comment. Later changes to notification metadata do not rewrite the resolution's source or wording basis.

A disposition can be recorded without a successor edition when there is no applicable wording change. That absence stays explicit in the reply. No resolution clause is inferred from matching numbers or titles.

## Return a response and include selected publication material

**Download respondent reply** selects one retained response. Its JSON and readable bilingual HTML contain that respondent's original entries, current dispositions, rationales and any selected frozen resolution wording. Other respondents' entries are excluded. Names, organization, email, receipt notes and original return files are excluded from this reply projection.

The default disposition visibility is **Recipient only**. To include an entry in a publication appendix, choose **Public** and record the actual inclusion basis. A public appendix contains only explicitly selected dispositions that still match the current comment and identify the exact exported resolution edition. Later editions do not inherit that selection automatically.

The ordinary edition handover includes `publication/consultation.json` and `publication/consultation.html`. Each included entry identifies the reviewed packet, original edition and exact resolution snapshot. It carries no reviewer contact fields. The operator must still review the free-text comment and rationale selected for publication, since the reviewer may have written identifying information into the text.

Downloading a respondent reply or publication does not record a send. Use the original notification or communication records when an actual dispatch occurs.

## Save, reopen and transfer the operating project

Use the existing **Private restore** export for complete local continuation. It carries the immutable review packets, received response records, unchanged original files, native comments, applied amendments, dispositions, event chain and durable request identities.

Restore validates every returned response against the archived original JSON bytes and the exact frozen packet. It also verifies comment/source joins, amendment before/after identities, disposition edition links, all original file digests and the existing workspace history. A matching restore is idempotent; a different project state with the same ID remains an explicit conflict.

Recipient packets, respondent replies and edition handovers are selected document exchanges. They omit the full operating history and cannot be used as private restore archives.

Existing 0.1.x workspaces open without a bulk rewrite. The four new collections are added when a project is next changed. Previously frozen editions and original files keep their recorded identities. Keep the original archive when upgrading or handing over a working project.

## CLI handovers

Use the IDs shown by the saved project and consultation panel:

~~~sh
standards-workbench --workspace ./standards-workspace \
  --export PROJECT_ID --audience consultation --packet-id PACKET_ID \
  --output ./consultation-packet.zip

standards-workbench --workspace ./standards-workspace \
  --export PROJECT_ID --audience review_response --response-id RESPONSE_ID \
  --output ./respondent-reply.zip

standards-workbench --workspace ./standards-workspace \
  --export PROJECT_ID --audience private_restore \
  --output ./complete-project.zip

standards-workbench --workspace ./reopened-workspace \
  --restore ./complete-project.zip --no-serve
~~~

The selected consultation and respondent handovers need only the Python standard library. The installed package still declares the original Word/PDF dependencies for edition and management publishing.

## Integration surface

The existing operation envelope, project compare-and-swap revision and durable request ID apply to all five operations: `review.packet`, `review.receive`, `review.amend`, `review.resolve` and `review.carry`. The full shapes and read routes are documented in [API.md](API.md).

For local receiving integrations, `consultation.response_preview(state, raw_bytes, packet_id, filename)` is a read operation. Adopt through `Workspace.apply` so original-file retention, comments, history and request results are committed together. Do not write the new immutable collections directly.

Keep an unchanged envelope and request ID after an uncertain transport result, including a server or proxy 5xx response. The operator editor keeps the pending request and offers **Retry original pending save**. Inspecting another return cannot discard that pending identity. Retry that exact request to recover its durable result. A new or edited request uses the refreshed project revision and a new request identity.

## Current product boundary

This feature is a local standards document and consultation workbench. The operator supplies the actual chosen procedure, reviewers, return route, dispatch evidence and disposition decisions. It neither obtains those records from a hosted system nor performs the standards body's decision process.

The included municipal example contains actual published Statistics Canada source rows and authored bilingual clauses. Comments entered as a demonstration remain marked as authored examples. An installation, returned file, calculated review condition or generated publication is not evidence of a real committee response or an approved standard.
