# SCC publication and receiving documents

The publisher turns one retained edition into editable English and French standards, matching reading copies, and an exact comparison with another retained edition. The management export brings the four delivery phases, phase reports, report responses, cost records, invoice allocations and recorded cash into one usable receiving package.

## Integration

The existing workspace captures state, selects the edition and owns the ZIP and original attachments. The publisher returns a dictionary of fixed safe relative paths to byte strings.

    edition_files(edition, *, publication=None, comparison_edition=None)
    delivery_files(state, analysis)

An edition is the existing immutable record containing its ID, label, capture time, snapshot and SHA256. The publisher verifies that snapshot before rendering. A supplied publication record must identify that same edition. The comparison argument is the earlier edition; the selected edition is the later side.

For management output, pass the complete captured state and the original engine.analyze(state) result from that same state. The publisher checks their agreement. It does not update records, fetch resources, send messages, approve a standard, record a payment, or activate an external publication.

## Publication files

Open publication/index.html to choose the language and format.

- standard-en.docx and standard-fr.docx contain native editable headings, clause numbers, paragraphs, tables, internal contents links and source hyperlinks.
- standard-en.pdf and standard-fr.pdf use embedded Unicode fonts, repeated table headings and page numbers.
- standard-en.html and standard-fr.html provide self-contained reading and print layouts.
- edition.json retains the selected source-edition identity and the public content projection.
- case-records-en.html and case-records-fr.html make every selected original case cell readable with its original field name, record number, language and row digest.
- source-register.json, case-records.json and language-review.json retain source metadata, complete selected case cells and the edition-bound language state.
- When another edition is selected, edition-comparison.docx, .pdf, .html and .json retain both edition identities and the exact visible changes.
- manifest.json records the size and SHA256 of every other publication member.

Declared clause numbers and parent relationships are preserved. English and French text, tables and front matter are selected independently. A missing language field stays missing. The common scope fields support purpose_fr, audience_fr and exclusions_fr; preface_en and preface_fr retain paired authored introductions. Cases support title_fr, review_questions_fr and expected_observations_fr. Original source titles, identifiers and recorded cells remain in their original languages.

The contents list links to native Word headings and the corresponding web/PDF sections. Word comparisons use normal editable text with strikethrough for deletions and underline for additions. Source and case changes remain visible even when clause wording is unchanged.

### Two different hashes

edition_sha256 identifies the original retained workspace edition. That original snapshot may include private editorial fields. export_snapshot_sha256 identifies the public projection actually included in edition.json. The archive manifest identifies the emitted document bytes. Each hash describes its own object; the projected public snapshot must not be checked against the original private-edition hash.

Public files use selected scope, clause, reference, case and source fields. They exclude contributor rosters, contact records, private communications, source-file custody IDs and editorial notes. The caller continues to select permitted original attachments for its existing archive.

## Four-phase receiving workpapers

management/delivery-workpapers.docx, .pdf and .html contain the four-phase record together. management/phase-1.html through phase-4.html provide the corresponding phase views. retained-records.json preserves the exact selected management records; delivery-analysis.json preserves the original engine result. management/manifest.json identifies the emitted bytes and captured state hash.

Each phase shows current tasks, deliverables, cost basis, base costs and OLA costs. Every retained phase report is shown with its own original input snapshot, submission, recorded responses and hash. A current-phase change is shown relative to that retained report. The report's historic costs are not replaced with today's values.

Invoices retain their source report, response, allocation identities, original cost hashes, net amount, HST, total, status and payment records. The documents use decimal CAD arithmetic and retain cents. HST comes from recorded values. Receipts and refunds remain distinct records. Proposed funding, agreed funding, estimates, actual costs, invoiced amounts and collected cash keep their recorded meanings.

Comment dispositions and the recorded technical and procedural decisions accompany the private handover. The original ballot calculation and decision remain identifiable. The export does not turn a calculated threshold, a draft budget or a local example into an external approval or payment.

## Runtime and fonts

The verified authoring runtime provides Python 3.12, python-docx 1.2.0 and ReportLab 4.4.9. The product installer must include python-docx and reportlab. Missing dependencies or a damaged font installation return a specific publication error.

The PDF renderer first uses the original Vera.ttf, VeraBd.ttf, VeraIt.ttf and VeraBI.ttf files in templates/fonts when supplied. It otherwise uses those same faces from the installed ReportLab package's fonts directory. ReportLab distributes their original bitstream-vera-license.txt in that directory. Preserve that license with any redistributed font files. No remote font request occurs during rendering.

The Word layout uses Arial with ordinary editable text. The PDF embeds Bitstream Vera for the supplied English and French characters. The formats share one document model, including clause content, original references and financial records.

## Document maintenance

Edit the original workspace, capture a new edition, and regenerate its documents. Preserve the earlier edition and its manifest for comparison. A receiving editor can make ordinary Word edits, while the original snapshot and the explicit edition comparison retain the source of the generated files.

For validation, exercise the existing application with the actual retained source package, inspect the generated English and French document pages, inspect the financial and comparison pages, and reopen the resulting archive. The publisher adds no separate service, scheduler, network operation or repository test suite.


## Public projection and retained identities

Pass `exports.public_edition(original_edition)` when preparing the public language package. The publisher requires every source reference to retain `citation_visibility: public`, every citation to resolve to that selected set, and every original case row to carry a `source_id` from the same set. Unbound rows need an explicit public source record before they can be published. The private archive retains the full original edition and its original source records.

`edition_sha256` identifies the exact snapshot supplied for rendering. For a public projection, `projection_sha256` is the same digest, while `source_edition_sha256` identifies the original frozen edition. `export_snapshot_sha256` additionally identifies the publisher’s explicit field projection in `edition.json`. Both original and selected identities are carried into comparison metadata. A supplied projection digest that differs from the selected snapshot is rejected.

## Original SCC reporting context

Appendix C of the original CFP requires phase-report information on deliverables, development process, Official Languages Act work and communication tasks. Current workpapers render the captured scope, selected procedure, consultations, technical and ballot decision identities, language offers and requests, phase communications and scope/delivery register. They also show the original engine's communication-calendar calculations, public-review link handoffs, reporting interval, phase cash conditions and scope/final-invoice closeout.

New phase reports retain these facts in `input_snapshot.report_context`. The publisher renders the actual retained context and its hash. When it equals the current captured context, the workpaper identifies the exact shared context instead of duplicating it. An older report without structured context keeps its original input and narrative; the publisher explicitly distinguishes today's context and does not backfill historical evidence.

The source calendar determines which dates are excluded and whether a communication has a supported mandatory-notice exception. A provisional 15-business-day date is presented alongside the recorded SCC submission and response; it is not a publication authorization. The selected public-review period remains the project's recorded procedure. Public-review link dispatch, three-month progress-report cadence, received phase deliverables, SCC report acceptance and submission of all final invoices are separate facts.

`management/retained-records.json` contains the exact current phase snapshots alongside retained historical reports, communications and immutable delivery registers. The private archive owns original source attachments. All current derived workpapers continue to use the exact `engine.analyze(state)` supplied with the same captured state.
