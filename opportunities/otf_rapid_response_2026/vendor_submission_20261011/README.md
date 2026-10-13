# OTF Rapid Response vendor package

This is the original nine-section vendor assembler, now connected to the actual issuer budget workbook. It creates an editable Excel copy, the proposal review, exact input and a restartable output directory from one vendor input. The separate `../case_workbench` owns case applications, approval, performed work and invoices.

## Run

Use Node 22 or later. No package installation or network access is needed.

```sh
node opportunities/otf_rapid_response_2026/vendor_submission_20261011/assemble.mjs \
  /private/vendor.json --out-dir /private/otf-vendor
```

Start from `starter.example.json`. The same command resumes the same output after interruption and reuses identical completed files. A different input or generator result requires a different directory. The saved `operation.json` binds every complete expected file; `complete.json` appears after all files have been materialized. Each file is published by an exclusive link from a separate temporary inode, so a concurrent caller cannot truncate another caller's output.

## Working output and outward submission

The complete working directory contains `proposal-review.md`, `Budget_Template-RFP-2026.completed.xlsx`, `budget-mapping.json`, `vendor-input.json` and `readiness.json`, together with any selected included evidence. It preserves the full editable input and its original evidence references. Once all nine sections, budget fields and outward evidence are complete, the compiler also writes `proposal-submission.md` and `submission-files.json`. That manifest identifies the exact outgoing proposal, completed issuer workbook and selected attachment files by name, byte length and SHA256. Use that selected set for submission; the complete working directory contains internal applicant material.

Section V of the issuer RFP allows staff biographical sketches/CVs and examples of prior work. An outward evidence reference may therefore be an HTTPS URL or `attachment:<safe leaf filename>`. Keep original `team[].cvEvidence` and `workExamples[].evidence` in the working input. Use `team[].cvPublicEvidence` and `workExamples[].publicEvidence` to select the outward URL or included filename when the original refers to internal custody.

Included files are retained in `outwardAttachments` as full entries with `name`, `mediaType`, `bytes`, `sha256`, `contentBase64` and `approvedForSubmission`. The compiler validates their exact bytes, canonical Base64, digest and unique safe outgoing names. A file enters the submission only when its approval is explicitly true and a proposal row selects its exact `attachment:` name. Unselected files remain in the editable working input. The case-workbench chooser initially leaves each new file unapproved; its separate working-package and submission-package downloads use the same maintained selection.

The inventory supports up to 64 entries and 16 MiB of selected evidence; the complete editable input must fit the existing 24 MiB document limit. Missing or invalid outward evidence is recorded in `readiness.json`, while the complete internal review and workbook remain available. The submission edition is omitted until all required sections and outgoing sources are ready.

Known Slack, ChatGPT, Notion and Gmail workspace URLs, native file references and `internal:` markers are rejected anywhere in outgoing proposal text. The internal input retains those original references. This check identifies known custody surfaces; it does not verify third-party publication rights or remote URL access. Preserve the full original working input and review alongside the selected outward edition, and inspect the actual generated workbook, proposal and included attachments in their normal readers before presenting them.

## Original budget

The issuer's original Excel file is retained unchanged in `sources/Budget_Template-RFP-2026.original.xlsx`: 5,983 bytes, SHA256 `1994a0b3ad589193c6ff8dd29bf8a9d08dfa4c6e85eebdb4a6aa5c9d994ce55d`. The compiler checks those bytes before editing the selected copy. The full original one-page workbook was rendered and visually inspected to identify the real cells.

| Input | Original cell |
|---|---|
| applicant.name | A4, in the merged A4:B6 name area |
| laborRates[0..4].title | A8:A12 |
| laborRates[0..4].loadedHourlyCents | B8:B12, numeric USD |
| budget.otherDirectCostsCategory | A16 |
| budget.otherDirectCostsCents | B16, numeric USD |
| budget.requestedContractCeilingCents | B17, numeric USD |

The gray name and travel headings remain unchanged. Nine unrelated workbook members are preserved exactly. The worksheet is populated and three styles are appended for wrapped category/name text and USD values; all thirteen original styles are retained. Completed ZIP member bytes are deterministic across supported runtimes.

Hourly rates are positive safe integer USD cents, at most five distinct categories. A blank amount stays blank. A real zero direct-cost estimate is represented by 0. The requested evaluation contract ceiling must be positive and at most 15,000,000 cents. An ODC estimate cannot exceed that ceiling. The ceiling is not a utilization forecast, order or case approval. The original notice says OTF determines labor/direct-cost ceiling allocations after selection.

## Vendor input and evidence

Keep actual personal CVs, unpublished rates, community references and applicant data in the original internal case or local input. The public software includes a blank input and an expressly authored workbook exercise, not a submitted proposal. The original `applicant`, `contact`, `team`, `services`, `laborRates`, `supportServices`, `qualifications`, `workExamples` and `attestations` structures remain compatible. Optional stable role `id` values survive the saved original input.

Use the actual assigned team and demonstrated work for capacity and experience. Service categories are organizational-security, digital-attacks, web-hosting, censorship-response and localization. All four support functions remain required. The exact RFP and Appendix A are source inputs, not certifications generated by the program.

## Issuer source

- [Current notice](https://www.opentech.fund/news/open-technology-fund-requests-proposals-for-the-rapid-response-fund/)
- [Original RFP and Appendix A](https://www.opentech.fund/wp-content/uploads/2026/10/Rapid-Response-Fund_RFP-2026-.pdf)
- [Original budget workbook](https://docs.google.com/spreadsheets/d/16aSRmyc9-s6T8ob3fkEiOFl9_MYGoihs/edit?gid=1909710743#gid=1909710743)

The issuer states proposal deadline **November 23, 2026, 11:59 PM EST**, questions **October 28, 2026, 11:59 PM EST**, expected start March 2027. Preserve the literal EST wording. At most five loaded labor categories cover labor/fringe/indirect costs; approved travel/materials/third-party costs are separate at-cost amounts. Proposal and case-request preparation are not reimbursable. Actual casework starts after the OTF Program Manager's written approval.

## Development and receiving

The compiler has no GitHub Actions, sender, credential access, external service calls or account coordination. Public code/source belongs in the existing public product repository; private business inputs remain internal. `AGENTS.md` carries the full owner publication and rendered-product instructions. Render and inspect the exact completed workbook and proposal before presenting a real applicant's package.
