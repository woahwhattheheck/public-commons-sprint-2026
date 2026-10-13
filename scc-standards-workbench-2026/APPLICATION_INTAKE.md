# Original-form application intake

This module joins the existing standards workbench to its retained original application answers, issuer forms, selected native standards edition and private evidence. It does not create a second project model, execute an uploaded builder, decide eligibility, insert signatures or submit a bid.

## Existing owner integration

Add application_intake.py beside the maintained engine.py. The original Workspace transaction, request journal, source store, immutable editions and private restore remain authoritative.

```python
from . import application_intake

# Inside the owner's one consistent state/read transaction:
read_source = lambda source_id: workspace._source_bytes(db, state, source_id)
intake = application_intake.inspect_application_input(state, selection, read_source)
reviewed = intake["default_reviewed"] if not reviewed else reviewed
renderer_inputs = application_intake.prepare_renderer_inputs(intake, reviewed)

# The owner retains this whole snapshot, not merely the rendering hash.
snapshot = {
    "selection": intake["selection"],
    "intake": intake,
    "reviewed": reviewed,
    "renderer_inputs": renderer_inputs,
}
source_ids = intake["source_ids"]
# The renderer returns only the newly produced files as bytes.
outputs = application_renderer.render_application(renderer_inputs, read_source)

```

Store the full snapshot in the original immutable application draft/edition, including its canonical digest and all selected source IDs. The Workspace owner performs revision checks, exact original request replay, predecessor validation, output custody, export and restoration. The mapper performs no I/O during preparation and no state mutations anywhere.

## Select complete originals

The selection requires answer_source_id, form_source_id, rfp_source_id, edition_id and a zero-based engineering_budget_row. Optional evidence_source_ids is a unique list of additional existing private sources.

The answers are the complete twenty-field UTF-8 authored JSON. The exact original issuer application form is 305,800 bytes, SHA-256 145a7cc034da6928f405a9bd07e01e25eaeae1a6c6a5dffcc27b9055c53bff09. The original CFP is 577,024 bytes, SHA-256 35ed019f958246615201a8b661e66a4f47ae3f36faab2eb0c224388d8ea88980. The selected layout belongs to that 13-page form and uses the financial schedule from page 29 of that 35-page CFP.

The source reader must return (raw_bytes, file_metadata), using the original project source/file relation. Intake compares actual SHA-256 and size with both source and file identities and checks the selected native edition's complete snapshot digest. It reads every explicitly selected evidence original. Source text or guessed filenames never substitute for original bytes. A referenced evidence ID absent from the selected intake is rejected; select and inspect it first.

Source metadata, exact authored inputs, heading/line-span mapping, the selected native edition and current people are retained in the complete intake. The original authorship bytes remain unchanged. The root-owned full private project export additionally retains the edition's own complete source and history graph; this mapper's source_ids list identifies its explicit application selection, not a replacement inventory of every source in the project.

## Work with one current authored edition

The reviewed object retains:

- authoring: every original authored input, with the current complete responseMarkdown, outlineTable, four-phase cost rows and commercial payment amounts.
- applicant: proposed/confirmed legal identity, country, establishment, primary/alternate signers and contacts, plus selected evidence IDs.
- roles: actual native person IDs, explicit role, proposed/confirmed appointment, evidence IDs and notes.
- requirements: all M1–M7 reviews, evidence and explanations; review status is not an eligibility determination.
- supporters: prospective/confirmed organizations and up to two real contacts per party.
- schedule: start month, calendar duration, ordered phase month ranges, explicitly selected hours per week and total, review basis and month-by-month activities.
- commercial: engineering provider, proposed/confirmed terms, separate payment labels/amounts/acceptance triggers, invoice/defect periods, included/excluded work, responsibilities and evidence.
- formFields: all forty original form geometry fields, including deliberate blanks and exact current continuation references.
- outlineMarkdown, scheduleMarkdown and offerMarkdown: the complete current attachment/commercial texts.
- narrativeReviewed, narrativeBasisSha256 and optional renderPresentation overrides.

The accompanying application_input.schema.json describes the complete editor structure. Cross-field and source semantics are enforced by the module.

The original authored JSON's twenty fields are date, title, proposalTitle, frenchTitle, responseMarkdown, outlineTable, sourceForm, sourceFormSha256, sourceRfp, baseBudget, olaMaximum, maximumBudget, engineeringFee, phaseAmounts, subcontractMilestones, engineeringWeeks, selectedReviewDays, selectedReviewStart, selectedReviewEnd and budgetRows.

A draft can retain incomplete applicant contacts, an unconfirmed calendar and proposed commercial terms. Its output is labelled Draft and retains explicit findings. Blank schedule/offer text is rendered as an explicit incomplete-draft paragraph. No omitted value is silently converted to a nine-month calendar, a weekly-hours assumption or confirmed terms.

Changing structured amounts does not automatically rewrite prose. Review the full response, static budget tables, titles, schedule and commercial prose together. There is no blind global string replacement. outlineMarkdown is the same current outline as authoring.outlineTable: keep the two editor bindings synchronized.

## Separate four financial phases, engineering work and cash

Amounts are exact decimal strings or integer JSON values. Binary floats and booleans are rejected. Every cost row has a label plus four phase amounts. Row sums must equal each of the four phase amounts; phase amounts must equal the base budget; base plus separately identified additional official-language maximum must equal the maximum. The explicitly selected engineering row must equal the engineering fee.

The separate commercial payment list must sum to that engineering fee, and every reviewed commercial payment must preserve its current authored amount. Commercial payment triggers do not become SCC phase approvals. Active engineering weeks are four explicit numbers; total hours require an explicit weekly-hours selection. Calendar phase ranges cover the selected term exactly, without gaps or overlaps, when completed.

Proposed additional supplier fees must be allocated explicitly in current budget rows or recorded as an unselected alternative. They cannot be automatically added to both the existing prime allocation and engineering fee. No actual invoice, payment or funding authority is created.

## Map the actual original form

The mapper supplies all forty fields. Applicant identity, primary/alternate names/titles/contact details, start month, duration, proposal title and budget are generated from the same structured reviewed input. Present those generated fields as read-only or clearly derived in the editor. Their exact keys are returned as intake.derived_form_keys.

Other fields are explicitly reviewed text or {text, references:[{token,section}]}. References name an exact heading in the current responseMarkdown, not an old page number. The renderer resolves these against actual newly rendered continuation pages. A changed or missing heading must be repaired before rendering.

The original source mapping is: M1/M2 team evidence; 3a Roadmap contribution; M4 language; M5 application completeness; M6 Canadian supplier; 1a scope/sector; 1b deliverable/process; 1c outline; section 2 relationship/gap; 3a mechanisms; 3b audience; 3c research; 3d support; 3e benefits; section 4 schedule; 5a–5c promotion/measurement. The full exact original body and section spans remain in intake.

Signatures and issuer declarations are outside these forty text fields. The adapter preserves their original marks. Applicant/contact names are authored text, never a signed declaration.

## Bind review to the complete input

Prepare with narrativeReviewed false to obtain renderer_inputs.inputProvenance.reviewBasisSha256. When the operator reviews this complete edition, set narrativeReviewed true and narrativeBasisSha256 to exactly that value.

The basis includes the entire verified intake plus all reviewed fields except the two review flags. It covers current source selections, original identities, people, role/evidence choices, every financial and schedule value, all four Markdown inputs, form fields and metadata. A changed date, amount, role, heading or disclosure with a retained old review hash is rejected. Reset review on editing and expose the actual changed basis; do not carry a checked box silently.

A reviewed draft is still not a signature, eligibility determination, prime appointment, standards approval, funding award or authorization to send. These authority flags remain false in the retained provenance.

## Produce and receive the selected complete files

The output follows the maintained renderer's flat scc.application-renderer-inputs.v1 contract with layoutId scc-cfp-2026-01-en-original-13-page.v1, exact sourceForm/sourceRfp descriptors, financial strings, all forty fields and complete inputProvenance. Generic titles and current metadata preserve TJLabs attribution. The renderer's complete input and source-code hashes belong in the original selected output manifest.

Render into a fresh private staging edition. Preserve earlier complete outputs and their manifests. Reuse is permitted only for exactly the same complete renderer input identity and matching code/assets; a responseMarkdown-only or layout-only check is insufficient. Never enumerate stale prior files into the new manifest.

The producing owner must operate the actual editor, render the exact selected edition, open every PDF and Word output, inspect all original-form and financial pages plus continuation references, and check both normal and narrow host UI states. Verify the full private export reopens with original source bytes, current reviewed inputs, role/evidence identities, frozen outputs and request history. Editing/restoring does not submit or sign.

The mapper is generic public code. Private answers, resumes, legal-entity evidence, appointment records and full project originals stay in their authorized existing private custody. The public source packet contains no customer fixture. Source validation, native execution and producing-agent visual acceptance must be reported separately.
