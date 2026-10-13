# Application document rendering

This component renders the complete selected application edition from its original form, original RFP and current reviewed answers. It belongs to the existing Standards Workbench application lifecycle. The Workspace retains source files, original requests and selected input editions. The application export renders that exact selected input and returns the complete document set; the receiving operation retains the resulting archive and its output hashes.

The public source contains the retained geometry and reusable formatting. Applicant identity, CVs, team evidence, authored answers, private commercial terms and generated documents are supplied through the operator's original private workspace.

## Integration

Call:

    from scc_workbench.application_renderer import render_application
    outputs = render_application(renderer_inputs, read_source)

The existing source reader implements:

    read_source(source_id) -> (original_bytes, file_metadata)

It returns bytes and a metadata dictionary from original source custody. The renderer independently checks the exact selected byte count and SHA-256. It reads no caller-supplied filesystem path and makes no network call.

The caller prepares the complete reviewed renderer input before rendering, using application_intake.prepare_renderer_inputs. The input is frozen at entry. Source form geometry is pinned to the original English 13-page SCC CFP-2026-01 application SHA-256 145a7cc034da6928f405a9bd07e01e25eaeae1a6c6a5dffcc27b9055c53bff09. The financial template is page index 28, printed page 29, of the original RFP SHA-256 35ed019f958246615201a8b661e66a4f47ae3f36faab2eb0c224388d8ea88980. A changed issuer form needs its own measured adapter and layout identity.

The renderer uses a fresh temporary directory for one invocation, collects only its explicit output inventory and returns each complete file. There is no layout-only reuse, previous-output scan or update of an older edition. The existing request/edition writer owns replay, immutable input adoption, source selection and whole private workspace export. Generated document bytes belong to the selected export and its receiving record; the current workspace does not persist them as a separate artifact collection. If rendering fails, that writer preserves the original request and selected inputs; the renderer's temporary directory is closed.

## Complete selected input

Schema: scc.application-renderer-inputs.v1.

Layout identity: scc-cfp-2026-01-en-original-13-page.v1.

Required metadata: title, date, author, subject, footer, formFooter, financialFooter. Author metadata retains Token Junkie Labs or TJLabs attribution. The prepared presentation may provide short chosen labels and titles; the renderer supplies no private applicant fact.

documentTitles has exactly five keys: application, responses, attachments, financial, offer.

Required complete authored sources:

- responseMarkdown: every current continuation answer, including the current budget and timing prose.
- outlineMarkdown: the selected full outline and accompanying narrative.
- scheduleMarkdown: the full current work calendar, resources and phase alignment.
- offerMarkdown: the complete selected commercial offer.
- sourceForm and sourceRfp: sourceId, bytes and lowercase sha256 from original custody.
- financial: currency CAD, four phaseAmounts, baseBudget, olaMaximum and maximumBudget. Amounts are nonnegative decimal strings with at most two fractional places. Phase totals must equal baseBudget; baseBudget plus olaMaximum must equal maximumBudget.
- formFields: all forty explicit selections below. A deliberate blank is an empty string. A nonblank field may be a string or an object with text and references.

An optional inputProvenance value is retained verbatim. The selected input identity covers every supplied field, including provenance. All four current Markdown bodies must be prepared coherently with the current structured budget, schedule, roles and applicant answers. The renderer cannot infer that unstructured prose is still factually current and never repairs it through global number replacement. The intake/workspace review establishes that authority.

A field reference is {"token":"{{budget-reference}}","section":"Exact continuation heading"}. That token must occur in the field text, the heading must identify one exact retained continuation section, and every reference is replaced with its real C-page number after the continuation PDF is built. Unknown/unresolved tokens stop this edition. Long answers belong in the complete continuation, with a short form summary and a real page reference.

The forty field keys, in original page order:

1. applicant_organization; signer_primary; signer_alternate; signer_primary_title; signer_alternate_title; contact_primary; contact_alternate; contact_primary_title; contact_alternate_title; email_primary; email_alternate; address_primary; address_alternate.
2. start_month; duration.
3. standards_evidence; team_evidence.
4. roadmap.
5. language; application_completeness.
6. canadian_eligibility.
7. budget.
8. attachments.
9. proposal_title; scope; sector.
10. standard_type; process; outline; related_standards; gap.
11. roadmap_mechanisms; audience.
12. source_evidence; stakeholder_support; benefits.
13. schedule; promotion_experience; promotion_plan; measurement.

These are summaries over the original printed fields. Signature marks and declaration selections are not generated. Existing signed source files stay in their original custody; any actual final agreement or signature is handled by the authorized person.

## Output inventory

The returned mapping contains thirteen complete files:

| File | Purpose |
| --- | --- |
| application-form.pdf | All thirteen original application pages plus the full continuation, with actual bookmarks |
| application-continuation.pdf | Complete standalone answer continuation |
| application-responses.docx | Editable complete current responses |
| outline-and-schedule.pdf | Full requested outline and work schedule |
| outline-and-schedule.docx | Editable outline and schedule |
| financial-proposal.pdf | Original Appendix D page with selected reconciled amounts and original printed notes |
| technical-delivery-offer.pdf | Complete current selected commercial offer |
| application-responses.md | Exact selected answer Markdown |
| outline.md | Exact selected outline Markdown |
| schedule.md | Exact selected schedule Markdown |
| technical-delivery-offer.md | Exact selected offer Markdown |
| selected-renderer-inputs.json | Complete frozen rendering input |
| render-result.json | Input/code/font/source identities, page counts, continuation references and every preceding output hash/length |

The manifest state is RENDERED_AWAITING_PRODUCING_OPERATOR_INSPECTION. File creation is not form submission, signature, client acceptance, eligibility confirmation or an award. The original Workspace's private export also retains the complete application edition and selected original source assets, including applicant evidence, with its existing access and audience rules.

## Layout and custody

The original forty rectangles retain their page, position, width and height. Every page's crop, rotation and physical dimensions must match the adapter. Any field overflow is reported by field key, without logging the private answer. No silent reduction to unreadable type, clipped answer or page deletion occurs. The original static overlay adapter refuses an interactive form edition rather than leaving conflicting logical field values.

Appendix D retains its original notes. Row labels and amount anchors must be unique. The allowance's original XX token is replaced within its own area. Financial amounts are exact Decimal values; whole-dollar amounts retain the original integral presentation and fractional amounts print two places. The allowance's next original word bounds its writable area. If a selected value exceeds its original amount area the rendering fails for correction.

The maintained document styles retain black text, neutral table headings, Unicode DejaVu fonts and original letter-page geometry. All table cells and Markdown sources are preserved. Calendars with more than ten columns use successive column panels with the row label repeated. Table rows may continue when necessary; the renderer does not drop long content. Current continuation heading identities are distinct from their typography.

The input budget is 64 MiB. Original source bytes are selected and hash-checked independently. This is a rendering allowance, not a promise about the parent application's source storage or receiving size; the original Workspace remains authoritative.

## Dependencies and environment

Retain the project's existing python-docx==1.2.0 and reportlab==4.4.9. Add compatible pypdf and pdfplumber packages to the maintained project dependency declaration; root owns that composition. This renderer uses PdfReader/PdfWriter, page merging/bookmarks, pdfplumber original words/lines and the same original ReportLab/python-docx layout APIs.

DejaVuSans.ttf and DejaVuSans-Bold.ttf must be available in /usr/share/fonts/truetype/dejavu, /usr/local/share/fonts/dejavu or package-local fonts. An existing font directory can be supplied explicitly with font_dir. Fonts are read into the invocation and their full identities are recorded. No network download or fallback font is selected silently.

## Original native receiving and producing review

Continue the existing DGC/Standards Workbench receiving operation and its actual source/asset selections. Use the complete current installed source, the exact issuer originals and the operator's selected current application inputs. Do not run a separate customer case merely to call the renderer.

1. Prepare an edition from the current full application input; inspect the selected applicant, team, requirement evidence, budget, schedule and all four Markdown sources. Retain its original preparation/request identity.
2. Generate through the original Workspace operation. Confirm every output is present, each returned byte count/hash matches the actual saved file and the full private project archive retains the original source assets and complete edition history.
3. Open every PDF page, including all thirteen issuer pages, every continuation page, outline/schedule, Appendix D and offer. LOOK at the actual rendered pixels. Check fixed-field alignment, page-reference destinations, paragraph/table continuations, glyphs, amount columns, original financial notes and readable labels.
4. Open both actual DOCX files in the normal office application. Check every page and table. Edit a separate receiving copy, save, close and reopen it; retain the authored operator copy separately from the original generated edition.
5. Open the actual Markdown/selected JSON/manifest and every archive member. Verify the complete budget/date/role changes in both the original-form summaries and all appended/editable documents. Use the actual application at desktop and narrow widths, including rendering failure, original request recovery, downloads and prior-version selection.
6. Export the whole private workspace and cold-receive it through the original application. Reopen both the previous and current input editions and their source bindings, together with the document archives saved for those editions. A changed input must produce a new selected edition; an exact committed save/freeze request resolves to its retained original input edition.
7. Return the actual operated files, screenshots and observed exceptions to the original case. Source checks, successful hashing and peer review do not replace this producing operator inspection. Correct concrete rendering or operation defects in the same maintained source and repeat the affected original flow.

No rendered application artifact has been produced by publication of these source modules. The complete rendering and review steps above are assigned to the original equipped receiving course.

## Dependency API sources

The added dependency pins are pypdf==6.20.1 and pdfplumber==0.11.10; preserve the existing python-docx==1.2.0 and reportlab==4.4.9 pins. Official release metadata confirms Python >=3.9 for pypdf and >=3.8 for pdfplumber, compatible with this project's Python >=3.10 contract: https://pypi.org/project/pypdf/6.20.1/ and https://pypi.org/project/pdfplumber/0.11.10/ . These are source-compatible API pins; the original receiving course records the actual installed versions and complete rendering outcome.

The module supports both the installed package and the original direct server.py launch through the same explicit package/standalone import branch.

The renderer preserves the original builder APIs. Current primary documentation for page merging and bookmarks: https://pypdf.readthedocs.io/en/stable/modules/PdfWriter.html . Original word/line extraction and file-like PDF inputs: https://github.com/jsvine/pdfplumber/blob/stable/README.md . These sources describe software interfaces; they do not establish successful rendering of this selected private application.
