# Standards drafting and delivery workbench

A local application for drafting a bilingual standards solution, retaining the evidence behind an edition, recording review and approval under an explicitly selected procedure, and handing over editable publications with the four-phase delivery accounts.

The application runs on your computer. Its SQLite workspace contains the current document, original files, revision history and durable request identities. There are no hosted model calls, committee emails, remote payment actions or certification functions.

## Install and open

Python 3.10 or newer is required. The package uses `python-docx 1.2.0` and `reportlab 4.4.9` to generate editable Word documents and PDFs. Download the [complete source package](https://github.com/woahwhattheheck/public-commons-sprint-2026/raw/main/scc-standards-workbench-2026/releases/scc_standards_workbench-0.1.0-source.zip) and install it into your usual Python environment. The archive contains the application, browser assets, original public sources and declared build metadata:

```sh
python -m pip install ./scc_standards_workbench-0.1.0-source.zip
standards-workbench --workspace ./standards-workspace --demo
```

Open the localhost address printed by the command, normally `http://127.0.0.1:8773`. The server binds only to localhost and checks browser Host and Origin values. Stop it with Ctrl+C, then run the same command and workspace path to resume.

The command installs the package and its declared document dependencies; it does not require an account, API key or database server. The source package is an application, not a self-contained Python runtime. A controlled offline installation can supply the same dependency wheels through the ordinary pip `--no-index --find-links` options.

For an empty working project, omit `--demo` and choose **New project**. The public and authored examples have stable, distinct IDs; selecting an example again opens the retained project without overwriting its edits. A later example source edition requires a fresh workspace or an explicit archive of the existing one.

## Two examples with different meanings

**Public drafting example.** The proposed topic is a source-preserving municipal reconciliation handover profile. It starts with ten authored paired English/French clauses, eight worked cases bound to actual Statistics Canada source rows, and the fifteen-column EN/FR source correspondence in the retained annex. Its default route is a proposed technical specification. The original public data does not establish a committee, approval, awarded project, current population estimate or adoption outcome.

The package retains eleven original open-licensed Statistics Canada response files and two explicitly lossless UTF-8 derivatives. The original CSVs are cp1252, not UTF-8; use the explicit encoding control to inspect them. Their original bytes, row numbers, identifiers, literal missing markers, zeros, dates and geographic vintages remain intact. The annex concerns municipal changes and affected Census population counts. Those quantities must not be relabelled as new annual population estimates.

The same example includes eighteen published DGC programme records from September 2 through October 1, 2026. They are adjacent-work references. Existing TS140 open-finance and PAS142 health work are not claimed as new work here. The six procedure profiles are authored summaries with exact source URLs; the selection does not establish which accreditation edition an actual standards body elected.

**Authored operator exercise.** Run:

```sh
standards-workbench --workspace ./standards-workspace --authored-demo
```

This separate project contains plainly named example members, proposed phase amounts, an original two-row authored comment CSV, and hypothetical agreement/cost/response/remittance input files. All are marked as authored examples. It initially contains no vote, accepted report, invoice or collected payment. Use it to learn the complete review, decision and accounting workflow without mixing exercise records with a live project.

## Work from original evidence to a reviewed edition

1. Set the scope, type, Roadmap issues and applicable procedure. Add relevant adjacent standards and explain whether they are complementary, overlapping or outside the scope. The scope supports independent English and French purpose, audience, exclusions and preface.
2. Retain source files with their source URL, publisher, version, language and representation. Use **Inspect and map** for CSV, JSON, XLSX, DOCX or plain text. Choose the actual decoding and row/header options. Map original column keys to record fields, select rows and inspect the complete adoption result before importing. No fuzzy source matching or silent identifier replacement occurs.
3. Edit the actual numbered clauses, parent structure, bilingual text and language-specific tables. Source-linked cases preserve complete original row cells separately from authored questions, interpretations and proposed outcomes.
4. Record translation review against the exact English and French clause hashes. A later change in either language makes the earlier review historical. The application does not infer French approval from the presence of translated text.
5. Freeze an edition. The snapshot retains scope, ordered clauses, cases, references, source metadata and language-review status. Its identity is a digest of that exact content. Changing the working draft creates a visible comparison without changing the frozen edition.
6. Record the consultation against that edition. Import or enter comments, retaining their original identity and source locator. Record a substantive disposition, target resolution edition/clause and actual notification evidence. Carrying a comment to a successor edition is explicit and retains the previous comment.

DOCX intake is a structural preview of main-document paragraphs and tables. It does not recreate tracked changes, equation objects, numbering definitions, embedded content or page layout. The original document remains downloadable. PDF and other unsupported formats are retained as original bytes; a separately sourced text companion can be imported.

## Apply the actual procedure

The selected procedure is frozen when a ballot or technical decision is created. Subsequent edits to a profile do not change that recorded procedure.

| Route | What the supplied source summary supports |
|---|---|
| Technical specification | Limited peer review and recorded technical agreement. The acquired public source does not prescribe a universal numerical ballot or fixed public-comment period. |
| PAS guidance, 2021 | Simple-majority steering approval, separate sponsor endorsement and developer publication authority. Four weeks of consultation is normal flexible guidance, not a universal hard admission threshold. |
| Workshop agreement | Open workshop, circulated draft and general agreement; publication within two calendar months and review within three years. |
| Community-sourced guidance | Explicit moderated community process; no invented universal numerical ballot. |
| Ordinary DGSI with selected earlier SCC basis | Its own eligible-majority, affirmative-fraction, negative-fraction, balance, consultation and independent-review requirements. Unresolved denominator interpretations remain visible. |
| Ordinary DGSI with selected 2025 SCC basis | The two-thirds affirmative denominator explicitly excludes abstentions; the separate DGSI negative ceiling retains its own unresolved denominator. This does not establish an actual DGC transition election. |

For a ballot, choose the edition, profile, dates, consultations and explicit eligible memberships. The frozen roster retains interest category and voting entitlement. Yes, no, justified abstention, excluded unjustified response, blank and nonresponse counts remain separate. Exact integer fraction comparisons avoid rounded-percentage decisions.

A calculation reports the recorded criteria. It is not the standards body's decision. Closing a ballot retains the calculation and all its inputs together with the actual authority's separate recorded decision and evidence. Closed votes cannot be edited or removed; new voting uses a successor ballot.

For routes without numerical ballot requirements, **Record technical decision** retains the peer review, workshop or moderated community evidence and the exact edition/profile. It does not invent participants or votes to satisfy an unrelated procedure.

An independent procedural review records the appointment, declaration, exact reviewed closure and known involvement. Earlier recorded membership, comments or development roles remain visible even if a working record is later removed. A declaration is recorded separately from the absence of known involvement.

## Publish and maintain

Record the selected edition, corresponding ballot closure or technical decision, actual publication authority, English/French URLs, access terms and maintenance date. Actual release status is retained even when local evidence is incomplete; the app identifies the specific gaps.

A **selected edition handover** contains paired editable DOCX, PDF and HTML publications, original case-cell annexes, an exact source/case projection and, when requested, an edition comparison. It contains only the selected frozen public-facing content. Contributor IDs and internal notes are removed; source citations and case rows require an explicit public source identity. Unbound or private-source original rows are excluded.

Citation visibility and original-byte redistribution are distinct controls. A reference URL can appear in a standard without a right to attach the source document. Explicitly selected source attachments come from the frozen edition's file identity and digest, never a later replacement under the same working source ID. The export manifest distinguishes the full source-edition digest from the projected publication digest.

Keep maintenance actions and successor editions connected to the original publication. Record actual corrections, revisions, reaffirmations or withdrawals and their notifications; do not overwrite the earlier edition.

## Deliver the four-phase work package

The four phases are initiation; content development/workshop awareness; review and approval/workshop draft; and publication/maintenance. Each has work tasks, dependencies, deliverables, costs and immutable phase reports.

Funding remains **proposed**, **signed** or **amended**. Four base phase amounts must reconcile exactly to the base amount. OLA is separate and is not automatically spent because a contingency exists. The call's type-specific limits and duration/start windows are comparisons against the entered records, not an award or eligibility determination.

Costs distinguish estimate from actual. Quantity and rate, when supplied, must reconcile to net cents with one half-up rounding. Actual substantiation is retained. HST is entered separately; the application does not decide a supplier's tax treatment.

Freeze a phase report from the exact funding, tasks, deliverables and costs being reported. Record the actual report response with its date and source evidence. An invoice uses a specifically accepted report and its signed funding snapshot, and allocates only substantiated actual costs retained in that report. The app rejects double allocation or amounts above the recorded remaining cost/phase limits. A changed source cost does not rewrite an already accepted report or invoice.

Invoice submission, acceptance/query/void and actual receipts/refunds are distinct records. Cash is counted only from retained payment records; projected budgets and sent invoices do not become collected revenue. The example project's hypothetical receipts remain explicitly authored exercise records.

The **management handover** generates editable four-phase workpapers and retains the exact financial/report/decision records. It does not silently attach every original source or include the private contact/history register.

## Preserve and restore the complete project

Use **Export → Complete private continuation** for a full backup. It includes the current state, hash-linked development history, durable request records and every retained original file. It is intentionally separate from a recipient's edition or management handover.

```sh
standards-workbench --workspace ./standards-workspace --list
standards-workbench --workspace ./standards-workspace --export PROJECT_ID --output project-private.zip
standards-workbench --workspace ./restored-workspace --restore project-private.zip --list
```

Restore checks the exact archive manifest, original digests, project state, event chain and request ledger before one atomic adoption. An identical already-restored project is reopened. A different project under the same ID is not silently overwritten.

These digests detect inconsistent or changed bytes. They are not an external signature or proof of who originally supplied a file.

## Concurrent work and limits

Every mutation requires the current project revision and a stable request ID. An outdated browser receives HTTP409 and retains its entered values. The conflict editor compares the original, current and entered fields so the operator can compose the intended change. A repeated identical request returns its retained result; changing the payload under the same request ID is rejected.

Original sources are limited to 32 MiB each and 192 MiB per project. State is limited to 64 MiB, individual collections to 20,000 records, and recipient/private archives to 384 MiB expanded. Previews are paginated; originals remain independently downloadable. Limits are explicit and do not truncate saved source bytes.

See [API.md](API.md) for the exact operation envelope and import/export contract, [PUBLICATION.md](PUBLICATION.md) for the editable publication and phase-workpaper format, and [SOURCE-NOTICES.md](SOURCE-NOTICES.md) for source and document dependency notices. Commercial proposals, partner correspondence and restricted research PDFs are outside this installable demo package.

## SCC communication and delivery records

The delivery section records the Appendix C–D operating requirements alongside the working standard. An SCC communication record identifies its exact content sources, intended or actual publication date, SCC submission and response evidence, and the selected business-day calendar. The fifteen-business-day calculation initially labels a weekday-only estimate. Selecting a calendar requires its stated basis and retained source; explicit excluded dates are preserved. A mandatory accredited-process notice can retain the call's exception with its rationale and procedural source. Public-review link dispatches bind the exact consultation and actual launch date.

Scope and invoice registers are immutable operator records. A confirmed register captures the selected scope definitions and current invoice identities; changes to those definitions, unassigned deliverables, or later invoices remain visible in the closeout calculation. Delivery records retain submission and receipt/acceptance evidence separately. A newly frozen phase report includes the selected procedure, actual review records, OLA records, phase communications and delivery-register basis. Existing reports retain their original snapshots.

Invoice preparation uses the accepted report's own confirmed scope and received-deliverable records, together with its signed funding and substantiated cost allocations. The displayed phase cash conditions depend on received deliverables and the corresponding accepted phase report. Dates in a proposed schedule do not release cash. Whole-project closeout also requires the confirmed scope deliverables, the final invoice register, and all invoice submissions. The RFP's separate sub-deliverable acceptance requirement remains visible.

The reporting view uses actual phase/progress submission dates for its maximum three-month interval. Before a first phase submission, a contract-start-based planning date is labeled as a planning date. It does not present the report's work-through date as proof of submission.

The two added communication/register collections are empty-compatible with earlier workspace snapshots. The next accepted mutation records their explicit addition in history; original sources, prior events and frozen records are preserved. No external announcement, notice, report, invoice or payment is sent by these local records.

## Release contents and execution notes

This 0.1.0 source release contains the complete local application and both separately identified examples. The source files were matched to their integrated Git objects, Python and browser-script syntax were checked, and the original public and authored projects were created through the application’s own workspace APIs. The full retained browser, document-rendering and fresh-install/restore continuations are still running through their existing worker records; no completed browser or fresh-install result is claimed for this source release. Those concrete results will accompany the installer release when returned.

The included source archive is independently installable through its `pyproject.toml`; it does not require access to a private repository. Its per-file digest manifest preserves the exact release bytes. The code is licensed under MIT, with Statistics Canada and document-library source notices retained separately. No applicant qualifications, named consortium commitments or grant eligibility are asserted by the package.
