# First project: Sumter RFQ source library and configuration preparation

Create a source-backed project from the actual RFQ and Addendum One. Its purpose is to select and prepare useful template/configuration work for the prime. It begins with published issuer facts, actual PDF attachments and unresolved choices. It contains no pre-recorded district approval, award, executed contract or native deployment.

Use this playbook with [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md), `initial-project-context.json` and `issuer-sources.json`. The JSON context uses the original compiler's `tjl.procurement-template-context.v1` schema and `operator` mode. The attachment inventory is a manual source reference, not a browser import format. Upload its listed bytes through Library, then select their intended project use in Sources.

## 1. Establish the source project

Create a working project named **Sumter RFQ-2027-018 — source library and template preparation**. Keep the underlying document title **Digital Procurement Solutions for Solicitations** and the issuer identity **Sumter School District**. Create the real named accounts in Operators and assign their project roles in Access; the issuer contact printed on the RFQ is not a workspace approval actor.

In Projects, choose Solicitation, starting template Request for quotation, and Use → Operator source content. This source-based draft follows the issuer's RFQ label. Keep the remaining template families available for the partner's selection. This initial selection does not decide which five to seven or more native templates the district will ultimately use. [RFQ cover; Addendum Q11, PDF p6.]

In Library → Original library source files, upload these two exact originals using Retain original file. Include the issuer URL and issue date in Source or version reference:

| File | Size | Source reference and initial use |
|---|---:|---|
| `RFQ-2027-018.pdf` | 545,631 bytes | RFQ issued October 2; cover for project identity and submission instructions, PDF p12 for document/platform scope, p13 for training and operational requirements. |
| `Addendum-One-2026-10-09.pdf` | 320,924 bytes | October 9 amendment to the same RFQ; link it to that source, preserving the separate document identity. Q11 and Q15 guide template/library preparation. |

Their full identities and issuer URLs are in `issuer-sources.json`. In the project's Sources tab, check both retained file IDs, choose Internal handover, leave Template destinations empty to apply them to the whole project, and Save file selection with a source-adoption note. Their public availability does not automatically select them for the Public copy ZIP. Each original file ID remains available for the library records' source references.

## 2. Adopt the known facts and scope the remaining fields

Open `initial-project-context.json` as the field reference and enter its values in Authoring → Project content, then Save content with a revision note. It supplies the issuer, document title, RFQ number, published procurement contact, source-based submission instructions, question and offer deadlines, and the configuration purchase scope. These keys belong to the selected request-for-quotation blueprint; the project title used for organizing work is separate from the document's Project title field. It deliberately omits unknown line items, selected award basis and approved reusable clause text.

The RFQ says questions were due October 9 at 11:00 a.m. and offers are due October 23 at 11:00 a.m.; retain those literal times without adding an unpublished time zone. The sealed-offer address is Sumter School District, Procurement Department, 1345 Wilson Hall Road, Sumter, SC 29150. Preserve the requirement for one hard copy and one USB copy, the solicitation number and opening date on the package. These are source facts for preparation, not a new outgoing instruction from the workspace. [RFQ cover; Addendum Q19, PDF p7.]

Choose Preview rendered copy after saving to make missing content visible. For a standalone copy, from the source directory containing the compiler, use:

```sh
node template-library.mjs render --context /absolute/path/initial-project-context.json --templates request-for-quotation --out /absolute/new/sumter-source-draft
```

The output directory must be new. This command reads the same original context and renders only the selected RFQ template. Its remaining line items, delivery requirements, award basis and three clause entries are unresolved source inputs. Resolve each missing input from the actual project or the partner's authorized source. The context's empty `clauses` object is intentional: a reviewer should choose actual source text and record its present-use decision. Do not copy the fictional `approved_by` values from `example-context.json`.

## 3. Build the reusable library from the issuer material

In Library, open the selected template and add the actual RFQ/Addendum page references and retained file IDs to its Original source reference. Save new revision, then select that revision in Authoring → Selected templates and publication scope. Create actual reusable clause text through New clause, with the original source reference and file IDs. If using text as a reusable clause, select the precise passage, store it as a draft revision and have the named reviewer decide its use. A paraphrase used for planning should remain a planning note rather than silently becoming approved legal or procurement language.

In the template's source reference, include Addendum Q11's initial five-to-seven configuration statement, Q15's district-owned library acceptance, and Q10's attachment requirement and unconfirmed API availability. Keep that planning commentary in the source reference; use a clause record only when supplying actual reusable clause text. These references guide template selection, source adoption and file mapping into the chosen platform. [Addendum, PDF pp5–6.]

Use the project revision note when selecting Addendum One to record its adoption alongside the original RFQ. The inventory retains the RFQ hash that this addendum amends; include that relationship in the Source or version reference as useful. The district's published addendum is historical source material; recording it does not create a new local amendment to the district's live solicitation.

## 4. Conduct the first real review and prepare native handover

Have the actual library reviewer Record source review on each selected template and clause revision. In the project's Reviews tab, assign the real project reviewer to the configured stage, inspect the field values and attachments, and Record decision on the current revision. Keep the first render as a working copy until missing content and release choices have been resolved for its intended use.

Once the intended configuration is complete and locally reviewed, choose Freeze implementation handover and use its Releases entry. Record platform handover retains the selected platform and environment, Native project ID (`native_project`), Module (`module`), Native template ID (`native_id`), actual operator, exact field/clause/file/role mappings, and a project-uploaded native review/export. A reviewer records acceptance only after that result exists. Accepted handover ZIP collects the original implementation and accepted records for every selected template. The addendum leaves API availability unconfirmed, so use the platform's supported operator interface when that is the available path.

The first useful handover is a functioning, selected template with attributable source and a retained native result. It does not require inventing a completed award or renewal merely to exercise the other template families. Add those projects when their actual source documents and operating purpose exist.

## Carry the unresolved procurement facts forward

Keep the unanswered vendor-application request, ambiguous hosting answer, unknown migration/workflow quantities, and exact platform-fit requirements associated with the source project. Addendum Q5 removes the AI upsell; Q7 does not remove the RFQ's Adobe Acrobat Sign wording; Q16 does not universally accept uploaded bond PDFs. The broader platform and sealed bid remain the prime's separate procurement work. [RFQ, PDF pp12–13; Addendum Q2, Q5, Q7–12 and Q16–19.]

Before finalizing a native template set, open the issuer's [solicitation](https://finance.sumterschools.net/procurement/solicitations) and [addendum](https://finance.sumterschools.net/procurement/addendums) indexes and add any subsequently published source as a new version. Preserve the prior project history while reviewing the affected content.
