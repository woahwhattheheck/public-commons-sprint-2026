# Issuer correspondence and award terms

Grant Operations carries an original issuer message through attachment receiving, an explicit application-stage observation, a comparison with the selected proposal, a reviewed native planning change, and a complete portable case.

Open **Applications → Grant planning and delivery → Delivery operations → Issuer terms**. The original planner, source attachments, native issuer records, amendment history, financial records and complete receiving remain in that workspace.

## Receive the original message

Choose **Correspondence**, select the original EML or plain-text file, enter its observation timestamp and original URL when available, and choose **Inspect original message**. The desk shows the actual message fields, text alternatives, complete header and MIME structure, and any decoding observations from the maintained correspondence reader.

The attachment table names the original MIME path, filename, byte count and available representation. The original whole message is selected. Choose any additional attachment representations and enter a receiving note, then choose **Retain message and selected attachments**.

The server performs the inspection from the original uploaded bytes. A browser choice names a parser path; the server supplies its original source bytes. Every selected file uses the existing source.add writer. One retained receiving index joins the inspection, MIME paths, source identities, representation choices and original native events.

A message may contain private routing or unsubscribe headers. Keep the complete populated case with its authorized operators and choose an appropriate receiving destination.

See [the original correspondence reader guide](ISSUER_CORRESPONDENCE.md) for MIME, charset, malformed-transfer and original-wire representation behavior.

## Record the actual application observation

Start **New terms workspace**, or open an existing workspace and choose **Revise selected terms**. An earlier saved edition remains available while the next edition is prepared.

**Use message details in terms draft** copies the actual reference, subject, date and source selection from a retained message. Select the observed stage yourself. The desk exposes:

- The proposed track and the issuer's actual selected track as separate fields.
- The issuer reference, Message-ID, original date, subject and original sources.
- The selected round, full-submission deadline, deadline source and submission form.
- Published guidance selected separately from issuer correspondence.
- Explicit field-to-source passages and the operator's interpretation.
- Actual issued award amount, acceptance date, duration and complete conditions, when an award decision is received.
- The three issued tranche selections, relative submission dates, deliverables, completion conditions and their sources.
- A separately stated outcome metric, target, unit, aggregation, comparison, network, ratification and inclusive measurement window.

Unstated values remain empty. The interest acknowledgement records **Interest acknowledged**. Its initial award terms remain empty and its proposed track remains **Open**.

The selected public schedule may give a submission deadline before an individual invitation arrives. Choose **Public schedule** as that deadline's source and retain the original guidance. The actual issuer-selected track is populated from the issuer decision when supplied.

Choose **Preview complete comparison** to compare the complete terms with the saved native proposal. The comparison retains the original amount, delivery duration, work packages, tranche dates and criteria, together with each issued value and its source state. Enter a save note and choose **Save reviewed edition**.

Saving an observed stage also uses the existing native issuer-event record. The immutable source edition, original selected source bytes, previous-edition link, complete proposal comparison and native event remain together.

## Commission the original delivery plan

Open a saved edition and choose **Prepare complete native plan**. Review the original source selection before editing. The desk retains the full planning inputs and exposes the requested amount, duration, work packages, pricing mode, hours, rates, fixed amounts, deliverables, tranche dates and criteria, contributors, assignments, working capital and notes.

| Planning basis | Meaning |
| --- | --- |
| Reviewed internal proposal | A proposed delivery programme reviewed against the selected message and guidance. |
| Original issued award terms | The original selected issuer award decision provides the basis for the planning change. |

**Copy explicitly issued fields into this draft** copies only the populated amount, duration and selected tranche fields. It is an explicit editing action; review the full result before commissioning.

The complete native-input editor supports the original scenario patch and planning schema, including contributor payment schedules and retained source tables. Package identity changes use the original amendment packageMappings selection. The original amendment engine shows any operating records that require a mapping.

Choose **Preview complete native plan**. The existing native calculator produces the complete budget, staffing, capacity and payment calculation. The original amendment engine compares the selected plan with the current case and reports the effects on retained records, recorded-work and invoice exposure, and payment clocks.

Enter the review statement and commissioning note. Select **Apply this reviewed planning selection to the existing case**, then choose **Save, review and commission the complete plan**.

One original workspace transaction performs:

1. The original native planning save.
2. The original amendment proposal, explicit approval and application when the selected plan changes.
3. The immutable association between the exact issuer edition, reviewed plan inputs, native saved revision and original amendment.
4. The complete-case size check.

The original transaction receipt reconciles the same request before rejecting stale versions. A failure rolls back the whole operation. The plan's own revision writer and the Operations case's original history remain the storage owners.

Actual payment observations and payment-derived clocks retain their original source. The selected planning date is an explicit planning input. Record an actual payment separately through its original cash workflow.

## Retain and receive the complete work

**Editions and handover** opens every saved terms edition, its selected proposal comparison and the full commissioned-plan records. **Download complete case and issuer selection** includes:

- The complete native planning archive and its earlier revisions.
- The original Operations case, records, events, reviews and amendment history.
- Every original issuer message and selected attachment.
- The full MIME inspection and native source-selection index.
- Every terms edition and its complete source/proposal comparison.
- Every native commissioning source and original amendment association.
- The selected offline HTML and CSV comparison, with its selection JSON.
- The original complete manifest.

Use **Import complete case** in Delivery operations. The imported result selects the retained issuer edition and opens it in **Issuer terms**. Receiving reparses the original message through the maintained reader, matches the exact selected source representations, and validates the terms against the original historical plan selection. The existing Task Outcomes, operating procedures, installations, completion and financial receiving continue through their original validators.

The browser retains local drafts and exact pending requests in its local database. After an interrupted response, **Resume the same operation** uses that request identity and original body. The saved native receipt supplies its committed result. A rejected current-source selection can return to the retained draft for a fresh complete review.

## Original CLI

All commands use the existing cli.py operations entry. Close the browser service before opening the same workspace with the standalone CLI. Replace uppercase values with the selected original case and review.

~~~bash
python3 cli.py operations --workspace CASE_DIRECTORY award-terms

python3 cli.py operations --workspace CASE_DIRECTORY \
  issuer-correspondence-inspect --case CASE_ID \
  --input ORIGINAL.eml --media-type message/rfc822 \
  --observed-at 2026-10-12T23:00:00+00:00 \
  --expected-version CASE_VERSION --output message-inspection.json

python3 cli.py operations --workspace CASE_DIRECTORY \
  issuer-correspondence-receive --case CASE_ID \
  --input ORIGINAL.eml --media-type message/rfc822 \
  --observed-at 2026-10-12T23:00:00+00:00 \
  --expected-version CASE_VERSION --select original --select 1.2 \
  --expected-inspection-sha256 REVIEWED_INSPECTION_SHA256 \
  --actor OPERATOR --request-id ORIGINAL_REQUEST_ID \
  --note "Receive the reviewed original message and selected attachment."

python3 cli.py operations --workspace CASE_DIRECTORY \
  award-terms-seed --case CASE_ID --expected-version CASE_VERSION \
  --output issuer-inputs.json

python3 cli.py operations --workspace CASE_DIRECTORY \
  award-terms-preview --case CASE_ID --expected-version CASE_VERSION \
  --inputs issuer-inputs.json --output issuer-preview.json

python3 cli.py operations --workspace CASE_DIRECTORY \
  award-terms-save --case CASE_ID --expected-version CASE_VERSION \
  --inputs issuer-inputs.json --expected-preview-sha256 REVIEWED_PREVIEW_SHA256 \
  --actor OPERATOR --request-id ORIGINAL_SAVE_ID --note "Record the reviewed issuer observation."

python3 cli.py operations --workspace CASE_DIRECTORY \
  award-terms-plan-seed --case CASE_ID --terms TERMS_ID --revision TERMS_REVISION \
  --expected-version CASE_VERSION --output native-plan-inputs.json

python3 cli.py operations --workspace CASE_DIRECTORY \
  award-terms-plan-preview --case CASE_ID --expected-version CASE_VERSION \
  --inputs native-plan-inputs.json --output native-plan-preview.json

python3 cli.py operations --workspace CASE_DIRECTORY \
  award-terms-commission --case CASE_ID --expected-version CASE_VERSION \
  --inputs native-plan-inputs.json --expected-preview-sha256 REVIEWED_PREVIEW_SHA256 \
  --actor OPERATOR --request-id ORIGINAL_COMMISSIONING_ID \
  --note "Commission the complete reviewed delivery programme." \
  --review-statement "Reviewed the selected source, full native calculation and original record effects." \
  --apply-reviewed-plan

python3 cli.py operations --workspace CASE_DIRECTORY \
  award-terms-export --case CASE_ID --terms TERMS_ID --revision TERMS_REVISION \
  --expected-version CASE_VERSION --output complete-issuer-case.zip
~~~

Select MIME path 1.2 only when that exact path appears in the original inspection. Use issuer-correspondence-show --source INDEX_SOURCE_ID to reopen the retained message and award-terms-show --terms TERMS_ID --revision N to reopen an exact saved edition.

## HTTP and original Python interface

The existing authenticated server exposes the same programme:

| Method | Suffix under /api/operations/{caseId} | Operation |
| --- | --- | --- |
| GET | /award-terms | Current terms heads, original correspondence and commissioning selections. |
| GET | /award-terms/{termsId}?revision=N | Full saved edition, history and original commissioning. |
| POST | /issuer-correspondence-inspect | Original-byte inspection and available parser paths. |
| POST | /issuer-correspondence-receive | Atomic original sources and retained correspondence index. |
| GET | /issuer-correspondence/{indexSourceId} | Complete original inspection and source associations. |
| POST | /award-terms-seed | New explicit draft from the current case. |
| POST | /award-terms-preview | Complete source/proposal comparison. |
| POST | /command with award-terms.save | Save a reviewed immutable edition through the original case writer. |
| POST | /award-terms-plan-seed | Original native planning inputs for a selected terms edition. |
| POST | /award-terms-plan-preview | Complete original model and amendment comparison. |
| POST | /award-terms-commission | One atomic native planning and original case operation. |
| GET | /award-terms/{termsId}/export.zip?revision=N&expectedVersion=V | Complete selected case handover. |

Correspondence inspection takes {expectedVersion, input}. The input contains the plain original filename, media type, complete contentBase64, explicit observedAt, and optional original HTTPS sourceUrl. Receiving adds selectedPaths, the returned expectedInspectionSha256, original request ID, actor and note. It always retains the original whole message.

Terms preview takes {expectedVersion, inputs:{id,expectedRevision,document}}. Save submits that same input with its reviewed expectedPreviewSha256.

Planning preview takes the full inputs returned by the original seed. Commissioning includes those inputs, its reviewed preview hash, request ID, actor, note, review statement and explicit acknowledgeBaselineChange:true.

The maintained Operations methods are inspect_issuer_correspondence, receive_issuer_correspondence, issuer_correspondence, seed_award_terms, list_award_terms, award_terms, preview_award_terms, seed_award_terms_plan, preview_award_terms_plan, commission_award_terms, and export_award_terms.

## Complete original operating programme

The programme at examples/issuer-terms/receive-issuer-award-terms.py accepts the actual original acknowledgement, retained current public guidance and explicit selected submission date. It operates the complete message receiving, two source-backed terms editions, original native proposal commissioning, CLI reopening and whole-case receiving twice.

~~~bash
python3 examples/issuer-terms/receive-issuer-award-terms.py NEW_OUTPUT_DIRECTORY \
  --message ORIGINAL_ACKNOWLEDGEMENT.eml \
  --guidance CURRENT_PUBLIC_GUIDANCE.txt \
  --guidance-url https://communityfund.stellar.org/awards \
  --submission-deadline YYYY-MM-DD
~~~

The sibling receive-issuer-award-terms.mjs continues that same saved case through the actual browser, current editor and a newly exported original case. It supports --resume-browser so the complete native case can be saved before browser review.

~~~bash
node examples/issuer-terms/receive-issuer-award-terms.mjs \
  COMPLETE_OUTPUT_DIRECTORY --resume-browser
~~~

The initial operation preserves the source acknowledgement as **Interest acknowledged**, the proposed **Open Track**, and empty unissued award terms. The public code receives private correspondence by its original path; the populated source remains in the complete private operating case.

## Current source references

Use the current issuer message and selected official pages for each receiving edition:

- [SCF Awards and current schedule](https://communityfund.stellar.org/awards)
- [Build Award handbook](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award)
- [Open Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/open-track)
- [Budget and deliverable guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines)

The product records a metric/window when its selected issuer source states one. Keep the actual track selection explicit when applying any track-specific completion condition.
