# Prime application desk

The Prime application desk takes the applicant's original authored answers, the issuer's original form and call, and an existing frozen standard edition through one complete application preparation workflow. It belongs to the same local standards workspace as drafting, consultation, member ballots, delivery and management.

## Open the original project

Install this complete source edition with Python 3.10 or later and the dependencies in pyproject.toml. Start the existing CLI with the existing workspace directory, then open **Project → Prime application**. Retain the same project and earlier standard editions. A complete private workspace archive can also be restored with the ordinary restore command.

Receive the actual application JSON, original form PDF, original call PDF and supporting documents through **Original sources**. The source register preserves complete bytes and assigns the file identity. A changed original needs a successor source ID. Application input profiles identify the exact issuer assets; the desk reports a wrong selected form or call immediately.

Select the actual answer source, issuer form, issuer call, frozen standard edition and engineering budget row. The row number starts at zero. Select the qualifications, role confirmations and supporting documents which this application uses. Press **Inspect selected inputs**. The full original answer object is retained while the working draft receives editable current inputs.

## Prepare one coherent application

The eight sections cover original sources; applicant and project; team and requirements; budget; calendar; engineering workshare; complete authored answers and outline; and review/save.

The applicant is an explicit proposed or confirmed legal entity, with its actual country, establishment and contacts. Named roles refer to existing people and source IDs from the selected original evidence. M1–M7 findings keep the actual evidence and explanations with the edition. Preparing or recording review does not apply a signature or send a submission.

The original twenty answer inputs are preserved. The current budget must reconcile all cost rows and four phase totals, the base and additional eligible language amounts, and the engineering workshare. The engineering payment installments are separate from the four issuer funding phases. Enter actual dates, calendar assumptions, weekly hours and active engineering weeks. CAD amounts and fractional hours retain exact decimal strings; quote fractional monetary values in structured JSON rows. Unfinished nullable values remain explicit drafts.

The complete answer Markdown, outline, schedule and offer remain editable. Numeric fields are not globally replaced inside prose: read the current full narrative against the structured figures. The outline editor updates the original outlineTable input at the same time. The original form's applicant, title, date and budget cells derive from the structured inputs; other form wording remains explicit.

Press **Review complete current inputs** to inspect the mapped form values, financials, source selection and findings. **Record review of current inputs** binds the complete selected input identity. Any later edit resets that selection. Draft saving remains available while applicant or narrative review is incomplete.

## Save and freeze

**Save application draft** appends an immutable original draft using the ordinary project revision and durable request ledger. Open a saved draft to continue it as a new working branch. Saving the changed work creates a successor; earlier inputs and sources remain available.

**Freeze saved draft** selects the exact saved input as an application edition. If the browser has different input values, save their new draft first. A frozen application remains associated with its original standard edition, applicant information, input review, sources and financial values.

Use **Download complete application ZIP** on the selected frozen edition. The renderer builds fresh documents in a new private temporary directory. It never reuses old financial or offer PDFs merely because the answer text is unchanged. The archive includes the original-form application, continuation, response DOCX, outline and schedule PDF/DOCX, original Appendix D financial form, technical offer, complete editable Markdown and JSON, and exact selected source files. See APPLICATION-RENDERING.md for the thirteen generated artifacts and layout inspection.

The separate **Complete private workspace** export includes every original, every earlier draft and frozen edition, project history and durable requests. Restore it with the existing importer to continue editable work. A selected application ZIP is the prepared document handover for that edition.

## Close, reopen and recover working text

Each tab has its own browser working branch in IndexedDB. Complete structured edits and unfinished JSON text are retained. **Download working file** preserves the same branch inputs, raw unfinished fields, selected source IDs, draft ancestry and pending operation. Open that file in the same project to create a distinct branch. Browser working files carry references to original sources; accompany them with the complete private workspace when moving to a different machine.

A save or freeze is written into the local working file before dispatch. After a lost connection, **Resolve original request** reads the original server request ledger. **Continue original request** repeats the exact same request ID, payload, revision and actor; the existing writer returns its original result if it already committed.

An explicit rejected stale revision remains recorded. The desk allows a new reviewed operation after confirming that the rejected original request has no durable result. It preserves the old request and all entered values. Two tabs can edit independently; the existing project revision decides which save can be accepted first.

## Native receiving and document inspection

Continue the existing equipped receiving operation and project. The helper at delivery/application-receiving.py provides a resumable installed-Python path using the same Workspace writer, retained originals and application export. Its private config contains the actual workspace directory, project ID, source selection and reviewed input path. Every mutation command is saved before execution, and its exact result is recovered on continuation. A complete private workspace is exported and cold-restored alongside the selected documents.

The original browser course should include: selected input inspection; applicant and role edits; a consistent budget/calendar revision; full narrative review; draft saving; distinct tab branches; a deliberately lost save response resolved with its original request; freeze; selected document download; complete private restore; and opening the retained working file against that restored project. Enter an unfinished structured JSON edit and reopen it to verify the exact text survives.

Render and inspect every generated PDF page and both DOCX files. Check the original thirteen-page form, every continuation reference, financial numbers and labels, issuer notes around the additional-language allowance, headers/footers, complete tables, and absence of clipped or stale text. Confirm the original source bytes and selected input identity after cold restore. Record the actual native and visual results in the same receiving operation.

Source review and JavaScript parsing are recorded separately from that execution. The prior completed 0.2.3 consultation journey and the selected 0.3.0 member-ballot continuation keep their own actual results.

## Private receiving configuration

Create this config only beside the actual operator's private workspace. Replace each descriptive placeholder with an existing original identity; these are not seeded records.

```json
{
  "schema": "standards-application-receiving/v1",
  "operation_id": "original-application-receiving-operation",
  "workspace": "/absolute/path/to/existing-workspace",
  "project_id": "ACTUAL_PROJECT_ID",
  "selection": {
    "answer_source_id": "ACTUAL_ANSWER_SOURCE",
    "form_source_id": "ACTUAL_ORIGINAL_FORM_SOURCE",
    "rfp_source_id": "ACTUAL_ORIGINAL_CALL_SOURCE",
    "edition_id": "ACTUAL_FROZEN_STANDARD_EDITION",
    "engineering_budget_row": 0,
    "evidence_source_ids": []
  },
  "reviewed_input": "/absolute/private/current-reviewed-input.json",
  "output": "/absolute/private/application-receiving",
  "title": "Current proposed application",
  "actor": "Original application operator",
  "include_source_ids": [],
  "predecessor_id": "",
  "review_note": "Actual operator review note"
}
```

The reviewed-input file contains the complete reviewed object from application inspection or a saved browser working file. A file containing `{}` deliberately uses the original draft defaults. Actual reviewed narrative identities depend on the current selected intake. If the original project changed after review, inspect and record review again before starting a new operation.

Optional `sources` entries contain `source_id,path,sha256,metadata`; metadata is the existing source.add object documented in API.md. The helper verifies each configured original's SHA-256 before using the ordinary original-byte receiver. Existing source IDs and retained bytes are preferable when already received.

The helper's local operation ledger preserves full commands before dispatch. Resume with the same config and source files. If a recorded command differs, retain its operation directory and create a successor receiving operation for the changed work.
