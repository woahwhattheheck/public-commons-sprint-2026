# Tranche completion in the original grant case

Open **Operations → Tranche completion** in the SF47 workspace. This view connects the original award schedule, recorded grant payments, assigned work packages, frozen completion preparations, actual form receipts and later issuer decisions. It shares the same private case, contributors, work observations, deployment records, attachments, case versions and request journal as the other Operations views.

## Payment clocks and the original schedule

The [SCF Budget & Deliverable Guidelines](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines), checked on 2026-10-12, specify four payments and a completion-form deadline within 90 calendar days after the preceding actual tranche payment.

| Recorded payment | Completion form | Default deadline |
| --- | --- | --- |
| Tranche 0, acceptance payment | Tranche 1 | Actual T0 payment date + 90 calendar days |
| Tranche 1 payment | Tranche 2 | Actual T1 payment date + 90 calendar days |
| Tranche 2 payment | Tranche 3 | Actual T2 payment date + 90 calendar days |
| Tranche 3, final payment | Final payment retained | No following completion clock |

The original award-relative submission day and work-package dates remain visible beside this calendar. Forecast payment lags, planned cash dates, completed deliverables and prepared forms do not create a received payment. Enter a payment through the original **Cash / issuer** workflow, with category `GRANT`, direction `IN`, its tranche, actual date and original reference. Observed non-testnet payments create active clocks. Voided and future observations retain their own clearly identified rows. Received payments lacking a tranche are listed for source correction.

Cash observations use the original immutable lifecycle: void an incorrect receipt with a reason, then retain its corrected source as a new observation. The former clock remains attached to the former receipt. An actual form receipt continues to identify the exact payment used in its preparation.

Calendar calculations add 90 days with date arithmetic. For example, in an explicitly authored WALKTHROUGH, 2027-12-01 + 90 days is 2028-02-29. The original case purpose is shown in the UI, frozen HTML and full case archive. OPERATIONS records use actual received observations; future illustrative completion and issuer dates belong in WALKTHROUGH cases.

**Calendar date** selects payment, confirmation and submission-date eligibility. Issuer outcome rows display their current recorded decision and its date. This control is not a reconstruction of every historical issuer decision.

## Operate a complete tranche

1. Open the existing case and select its completion tranche. The workspace opens one assignment row for every original work package in that tranche, preserving its cost ID, remaining work, success criteria, planned hours, amount and award-relative dates.
2. Select accountable original Operations contributors and assigned start/finish dates. Original planner allocations are displayed as context. Link retained work observations, deployments and source attachments when relevant. Linked work must identify the same cost and one of the assigned contributors; linked deployments must match the selected cost/tranche.
3. Use **Save assignments** to retain the whole tranche in the original case transaction. Planning is available before a payment arrives. Completed rows require their actual completion date and completed result.
4. Select the actual previous payment and enter the completed tranche result. **Preview completion** returns the current source version, payment-derived deadline and any remaining deliverable fields. Save edited assignments before previewing. A preparation needs complete work-package rows, assigned owners, a nonempty form summary, and completion/work observations that exist by the selected preparation date.
5. Use **Prepare completion** on the reviewed preview. This creates an original immutable case review containing the complete source snapshot and the exact preview. **Download prepared files** returns its HTML, CSV, complete JSON and selected original attachment bytes.
6. After the actual completion form has been submitted through its issuer channel, use **Record form submission**. Retain its actual submission date, original form reference and source attachments or source note. This creates a normal Operations outcome in state `SUBMITTED`, linked to the frozen preparation and its original payment.
7. Record the issuer response with **Record issuer outcome**. The available states are `ACCEPTED`, `CHANGES_REQUESTED` and `WITHDRAWN`; retain the actual decision date and original reference. Further prepared forms and actual submissions remain separate records.

An issuer-confirmed extension uses **Record issuer extension** on the selected payment. Retain the confirmation date, later deadline, original reference and relevant attachments. The original 90-day deadline remains visible. The applicable deadline is the latest recorded confirmation effective on the selected calendar or actual submission date. An extension request alone does not change the clock.

The saved submission preserves the frozen form even if the operating case has subsequently changed. Its command receipt reports `preparedSourceCurrent` to identify that relationship, and `submittedWithinDeadline` for the actual submitted date. Repeated original form references are rejected; retrying the same exact request returns its original result.

## Interrupted saves and concurrent work

Every mutation uses the existing case version and a retained request ID. **Retry same save** resends that same payload after an interrupted or unknown response. The per-case browser session retains the submitted payload and draft when moving among Operations tabs; a late original response is still recorded. **Reopen accepted result** resumes reading the case after a returned write receipt.

A definite native validation or version rejection preserves the entered draft and form fields, refreshes the current case, and makes it available for review. **Keep draft against current case** explicitly selects the fresh case version; **Open saved assignments** returns to its saved source. Accepted assignments reopen the original normalized result. A later recorded assignment change is shown as the current case, with a notice that it followed the accepted save.

Retained unsaved drafts survive Operations navigation in the current browser session. Durable saved assignments, preparations, submissions, confirmations, source bytes and request results belong to the original private workspace. Use the original case export to transfer the complete saved workflow.

## Native HTTP contract

These routes inherit the existing workspace listener, access key and request/body controls. Browser callers use the original authenticated API transport.

| Method and path | Input or returned source |
| --- | --- |
| `GET /api/operations/{case}` | Original case plus `completionPlans`, payment calendar and completion review summaries |
| `GET /api/operations/{case}/completion?asOfDate=YYYY-MM-DD` | Payment clocks and the three original tranche/package views |
| `POST /api/operations/{case}/completion-seed` | `{expectedVersion, tranche}`; returns original `inputs`, `packages`, saved identity and rule |
| `POST /api/operations/{case}/completion-preview` | `{expectedVersion, receiptId, asOfDate, summary}`; returns source, original receipt, clock, saved plan, readiness issues and `previewSha256` |
| `POST /api/operations/{case}/command` | The original versioned command envelope with one completion action |
| `GET /api/operations/{case}/reviews/{review}` | Complete immutable prepared review |
| `GET /api/operations/{case}/completion-reviews/{review}/export.zip` | Frozen prepared form and selected original sources |
| `GET /api/operations/{case}/export.zip` | The complete original operating case, planning source and attachments |
| `POST /api/operations/import` | The existing complete-case receiver |

Mutation envelope:

```json
{
  "expectedVersion": 12,
  "requestId": "existing-operation-completion-save-001",
  "actor": "Recording operator",
  "note": "Retained source decision",
  "action": "completion.save",
  "data": {"inputs": {}}
}
```

Use the actual expected version and input returned from the selected case. A successful receipt includes case `id`, `version`, `action`, record `kind`, `recordId` and action-specific fields. The original journal resolves an exact request replay before applying another mutation.

### Assignment inputs

`completion.save` takes `{inputs}`. Start with the actual seed `inputs` object:

```json
{
  "tranche": 1,
  "items": [
    {
      "costId": "ORIGINAL_COST_ID",
      "ownerIds": ["ORIGINAL_CONTRIBUTOR_ID"],
      "startDate": null,
      "endDate": null,
      "state": "PLANNED",
      "completedOn": null,
      "workIds": [],
      "deploymentIds": [],
      "sourceIds": [],
      "note": "",
      "completionNote": ""
    }
  ],
  "note": ""
}
```

Retain exactly one item for every original cost in the tranche. Date values are ISO calendar dates or `null`; `state` is `PLANNED`, `IN_PROGRESS` or `COMPLETE`. Contributor, work, deployment and source selections use the original case IDs. Identical normalized assignments reopen the original saved plan without an extra case event.

### Other completion actions

| Action | Data fields |
| --- | --- |
| `completion.extension` | `receiptId`, `confirmedOn`, `deadlineOn`, `reference`, `sourceIds`, `note` |
| `completion.prepare` | `receiptId`, `asOfDate`, `summary`, `expectedPreviewSha256` |
| `completion.submit` | `reviewId`, `expectedReviewSha256`, `submittedOn`, `formReference`, `sourceIds`, `sourceNote` |
| `completion.decision` | `outcomeId`, `state`, `date`, `sourceIds`, `sourceNote` |

`expectedReviewSha256` is the prepared review's `businessSha256`. Preparation returns its original review `recordId`, `businessSha256` and `previewSha256`. Extension returns `extensionId`; form submission returns the original outcome ID. Completion commands retain the existing record and archive limits.

The actual outcome's optional `completion` object retains `receiptId`, `reviewId`, `reviewSha256`, `previewSha256`, `submittedOn`, `formReference`, `originalDeadlineOn`, `deadlineOn` and `extensionId`. Generic outcome edits preserve this association; new form associations use the completion command.

## Original CLI

Run from the original `sf47_budget_model` directory, or use its installed launcher alias. The launcher selects `SF47_PYTHON` or `python3`; a leading `--python /absolute/executable` explicitly selects the original Python runtime. Use the established workspace ownership when switching between server and direct CLI.

```sh
python3 workspace/cli.py operations --workspace /private/scf-workspace completion-calendar \
  --case CASE_ID --as-of YYYY-MM-DD --output /private/payment-calendar.json

python3 workspace/cli.py operations --workspace /private/scf-workspace completion-seed \
  --case CASE_ID --tranche 1 --expected-version VERSION \
  --output /private/completion-seed.json

python3 workspace/cli.py operations --workspace /private/scf-workspace completion-save \
  --case CASE_ID --expected-version VERSION --inputs /private/completion-inputs.json \
  --actor "Recording operator" --request-id completion-save-001

python3 workspace/cli.py operations --workspace /private/scf-workspace completion-preview \
  --case CASE_ID --expected-version VERSION --data /private/completion-preview-input.json \
  --output /private/completion-preview.json

python3 workspace/cli.py operations --workspace /private/scf-workspace completion-prepare \
  --case CASE_ID --expected-version VERSION --data /private/completion-prepare-input.json \
  --actor "Recording operator" --request-id completion-prepare-001

python3 workspace/cli.py operations --workspace /private/scf-workspace completion-export \
  --case CASE_ID --review REVIEW_ID --output /private/prepared-completion.zip
```

`completion-inputs.json` contains the edited seed's **inputs** object. The preview data file contains only `receiptId`, `asOfDate` and `summary`. Preparation adds `expectedPreviewSha256` from that exact preview. `completion-extension`, `completion-submit` and `completion-decision` take a `--data` JSON file with the fields above and the same `--case`, `--expected-version`, `--actor` and `--request-id` arguments. CLI output paths are new private filenames.

## Complete preparation and receiving

The prepared ZIP includes:

- `completion.json`: the original frozen review, complete source snapshot and exact readiness preview.
- `completion.html`: the submitted work, original success criteria, owners, completed results and payment-derived dates.
- `deliverables.csv`: the same work-package/date/result selection.
- `sources/{sourceId}`: the exact retained payment, extension, deliverable, work and deployment attachment bytes selected by that preparation.
- `MANIFEST.json`: the prepared file names, sizes and SHA-256 identities.

The full case export preserves these original review records, all three saved completion plans and confirmations, the normal cash/outcome/event records, every original attachment, and the original planning archive. The native receiver validates completion selections against pinned costs and contributors, the plan's original save event, each frozen preparation against its source snapshot, and each actual form link against its prepared payment and deadline. Existing cases without completion plans remain valid.

Implementation follows the original Operations architecture: `operations_completion.py` supplies the payment/date and preparation logic; the existing Operations transaction owns saved plans, original reviews and normal outcome records. The HTTP, CLI and browser views use that same implementation. The cumulative `operations/merchant-support-native/grant-completion-native.mjs` receiving extension operates the existing Support-derived WALKTHROUGH case and carries its complete output through the original export/import workflow.
