# MCC issued-document strengthening edition

This edition advances the existing LGNDX opportunity workspace with the original three Word attachments acquired from SAM.gov. It preserves project `opp_c414e4b0-302f-0005-bda6-cb8906d7a644`, the completed revision-133 input and its two sealed response packages.

The original October 6 resource listing identifies the RFI, PWS and Industry Day notice for **95332427K0001**, notice UUID **ec4254f4fdf24f8998bd4e10d5b58050**. The original files were received with HTTP 200 on October 12. This is a source-strengthening and response-review edition. Acquisition time and original publication time remain separate.

## What the original documents establish

The complete body comparison found the same 15 numbered RFI question groups and the same 34 response items. All substantive RFI and PWS paragraphs occur in the previously retained government text after normalizing whitespace and line breaks. The original Word files now supply exact binary identity, original numbering, section context and retained headers and footers.

The complete Industry Day notice also supplies the meeting instructions and attendee fields. The source packet keeps those instructions in their original document. The project gains explicit registration and meeting milestones linked to that source.

### Seven response improvements

| Existing item | Response change | Original source location |
| --- | --- | --- |
| 2 — PWS and environment feedback | Request the actual Appendix B inventory and Section H designations; resolve the deliverable and infrastructure cross references; ask for operating authority, demand, access, support and modernization inputs. | RFI B015; PWS B044, B055, B153, B310, B320 and B322 |
| 5.c — Deliverables | Use the PWS's tailored new-development documentation set, changed-release documentation, electronic Word/Excel conventions, receiving responsibility and Government acceptance decision. | RFI B021; PWS 4.3.1, B287–B306 |
| 5.d — Key personnel | Start with the expressly named Program Manager and Enterprise/AI architecture functions, then map further functions to actual workload and reviewed company availability. | RFI B022; PWS 3.0/B069, 4.1.1/B073, 4.1.4/B130 and 5.1/B322 |
| 7.a — Staffing | Integrate location/core hours, workload sizing, approved coverage and the maximum 60-calendar-day phase-in into the operating approach. | RFI B027; PWS 3.0/B069, 4.1.1 and 4.1.2.1/B116 |
| 7.c — Surge capacity | Separate the 14-calendar-day written surge proposal from candidate selection, investigation/access, onboarding and actual productive deployment. | RFI B029; PWS 4.3.2/B309 and 5.2/5.3/B324–B327 |
| 11.a — O&M | Preserve the separate Service Desk and infrastructure providers, Tier 2/3 responsibilities, production change authority, platform exceptions and workload-based emergency coverage. | RFI B041; PWS 4.2.1/4.2.2, B151–B171 and B209 |
| 14.a — Cloud modernization | Use the actual inventory, approved managed-service choices, repeatable delivery, recovery, Government-agreed middleware and recurring-cost decisions. Keep the parent Q14 context with the subquestion. | RFI B055–B056; PWS B053, B265, B271 and B277 |

The full proposed wording is in [review-edits.json](review-edits.json). The preparer binds every one of the 34 rows to the primary RFI and its selected PWS context, preserves the current receiving-workbook lineage, and changes only these seven response and review-note fields.

Existing capability facts, deployed-experience classifications, company-evidence gaps, team decisions, staffing availability, answer dispositions and source-reviewed records remain the operator's current decisions. The issued RFI permits an explicit N/A against a declined question. Q6's delivered-AI condition continues to require actual deployed experience for a supported answer.

## Page, attachment and time rules

The issued RFI retains a maximum **20-page total response excluding the cover and table of contents** (B009), with a **one-page capability statement** (Q4/B017). The existing response-rule object is preserved and receives the original primary references.

Three cross references remain questions for the actual issuer:

1. RFI 5.c names “Section 5.0” deliverables, while the acquired PWS's Section 5.0 is **Labor Requirements**. The detailed new-development documentation provisions are in PWS 4.3.1.
2. The PWS refers to **Appendix B** for the application/technology inventory and **Section H** for key-personnel designations. Neither is included in this acquired three-file resource listing.
3. The PWS Scope paragraph refers to Section 4.4 “Infrastructure”; the acquired Section 4.4 heading is **Application Administration**.

The Industry Day notice specifies October 15, 2026, 10:00–12:00 **EST**, and registration by October 14 at 18:00 **EST**. It requests actual attendee names, job titles and email addresses through the published softwaredev@mcc.gov route. It also gives RFI responses as **COB October 29**. The separately retained SAM field specifies October 29 at **18:00 EDT / 22:00 UTC**.

The project records the event's literal EST conversions using `Etc/GMT+5` and keeps the timezone clarification open. The existing SAM response cutoff remains unchanged. These are planning records in the opportunity workspace; participation and issuer correspondence stay with the original responding-company relationship.

## Original input identities

[issued-inputs.json](issued-inputs.json) records the exact filenames, resource identifiers, sizes, SHA-256 values, capture times and baseline project identity.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| Request_for_Information_RFI_Final.docx | 74,797 | `ae7ac0ed596426c1d26e66b7d6e85261e4df07849e6a4e16b413c7a88129f8d5` |
| Performance_Work_Statement_PWS_Final.docx | 177,688 | `93fa078cd166baed8a3e8a8aa7ab9f82a63c3573f13b4fd02b4304413535fd0a` |
| RFI_Notice_of_Intent.docx | 41,236 | `5fc2a085f29d4ab820bba65107316414f26409bc8ba4481e417ca23f9d0932c3` |
| sam-notice-resources.json | 1,760 | `6eaa112f27c3908a6127d1a030be30334320f30bb7d21cc32eacf75a0ea8187d` |

Each input has its unchanged adjacent `.receipt.json`. Public download URLs and original status/size/digest observations are retained. The binary files preserve their original document labels. Derived text keeps original automatic numbering, run breaks, tables, content controls and header/footer stories. Locators such as `word/document.xml B287` mean the exact direct body element, independent of a renderer's pagination.

Original government location:
<https://sam.gov/workspace/contract/opp/ec4254f4fdf24f8998bd4e10d5b58050/view>

Original acquisition handoff:
<https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791780628706899?thread_ts=1791759228.107759>

## Prepare the exact update

Use the original input directory and closed project handoff. The existing component's references supply the comparison texts and numbered requirements. Python's standard library is sufficient.

~~~bash
python references/issued-source-review/prepare_issued_review.py \
  --originals /ABS/ORIGINAL_MCC_FILES \
  --native-handoff /ABS/native-handoff.zip \
  --output /ABS/PRIVATE_EDITION
~~~

The original handoff ZIP member is `handoff/current-receiving-portable.json`: 14,822,528 bytes, SHA-256 `9512b0bf69c34748df36bdc08f8b2aa0b06117eaacbafb6d38e035f5dd797140`. The preparer validates this exact revision-133 project, all original source bytes and the current receiving-workbook source before creating update inputs.

The output contains:

- Unchanged original Word files, resource index and acquisition receipts.
- Complete structured extraction and text derivatives with original-source hashes.
- A 34-row attachment/requirement comparison matrix.
- The current receiving workbook with seven response improvements and full primary-source references.
- `review/project-update.json`, containing nine source payloads, 74 original API action payloads, four source-change review plans and one new named-package request.
- `FILES.json`, recording every prepared file's size and SHA-256.

The prepared timestamp and input hashes are retained in `preparation.json`. Repeating preparation with the same inputs retains the same edition identity. A changed input requires a new output directory. Once dispatch starts, resume the retained packet and its journal.

## Apply through the original opportunity store

The existing receiving owner imports the exact revision-133 portable into an isolated directory with the maintained `openOpportunityStore().importPackage()` or original CLI `receive`. This operation is distinct from the previously queued current-dossier compatibility check.

Then run the edition's original-API driver:

~~~bash
node references/issued-source-review/apply_issued_review.mjs \
  --workspace /ABS/RECEIVING_WORKSPACE \
  --input /ABS/PRIVATE_EDITION/review/project-update.json \
  --output /ABS/PRIVATE_EDITION/handoff \
  --operator "MCC issued-source receiver"
~~~

The driver imports no replacement project or domain engine. It calls the maintained store in this component. It retains the exact packet identity and prepares each original `{id, expectedRevision, requestId, ...payload}` before dispatch. An uncertain return replays that same payload, including the original expected revision. The original store's request identity then reconciles the committed mutation.

The sequence is:

1. Validate project identity/revision, all record versions, preserved business fields and both original package identities.
2. Retain the three binary files, three source-bound text editions, resource index, acquisition manifest and new workbook.
3. Update the 34 existing requirement source bindings and 34 coverage records; seven rows receive the authored response improvements.
4. Rebind the existing page rules, update the two existing source questions, add the two meeting milestones and strengthen the existing response-window source.
5. Review the four replacement-source changes against the exact after-source identity.
6. Verify preserved business decisions and both original packages; create one new `ready_for_review` named package.
7. Export the original portable, HTML, Markdown and five CSV views, with a compact actual result and file hashes.

The review driver stores its preparation and completed steps under the receiving directory's `intake/`. It checks the original history for a conflicting intervening owner before advancing the next action. The exact sequence remains available after interruption.

## Receiving and continued use

The new named package is an additional reviewed edition of the existing project. The earlier two packages remain immutable and selectable by their original IDs. A receiving operator can import the completed current portable and open the same company, opportunity, sources, requirements, coverage, team decisions, milestones, questions and source-change history.

Review the seven updated responses in the source-aware UI. Inspect the original binary attachment or its numbered derivative directly from each row's evidence. Use the existing company and teaming records to resolve open capabilities when actual company evidence or partner commitments arrive. Retain actual issuer responses as `question_response` sources and advance the same questions and source-review workflow.

The LGNDX commercial case remains `lgndx-opportunity-teaming-operations-20261012`, with original sent message `1a12e6cb1542aa63`. This edition supplies a stronger operating and response package through that same case.
