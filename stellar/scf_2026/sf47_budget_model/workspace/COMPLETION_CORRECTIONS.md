# Completion corrections: operate, review, resubmit and receive

This guide covers issuer-requested corrections inside the existing SF47 Grant Operations case. The feature connects the original changes-requested decision to accountable findings, retained evidence, immutable correction editions and the existing completion preparation/submission flow. Open the case's **Completion** screen; no separate case or correction database is created.

The correction assessment records the operator's work and supporting sources. The original issuer decision, actual payment receipt, grant clock, submitted preparation and subsequent issuer decisions retain their own identities. An internal target date or a saved correction assessment does not record a deadline extension, grant acceptance, payment or an external submission.

## Start from the retained original case

Use the complete current Grant application and the original private workspace. In Completion, choose the tranche and the actual completion outcome whose state is **CHANGES_REQUESTED**. This must be a recorded issuer decision linked to the original submitted completion review. A note about possible future feedback is insufficient.

Before starting, make the original finding letter, correspondence or other source available through the case's existing source intake. Keep its actual author, date and attribution. Use current case contributors, work packages, work records and deployments when assigning findings; the correction editor links these existing records rather than creating replacements.

The new source is installed with the rest of the Grant application:

- `operations_completion_corrections.py` is the native correction model/exporter.
- `operations_completion_corrections.mjs` is the editor within Completion.
- Existing Completion, Operations, HTTP, CLI and agent-client files supply the original save, prepare, submit, history and receiving paths.
- Both `launch.mjs` and `managed_launch.py` select the new modules and this guide in their complete `BOOT_FILES` inventories. Use the new selected source edition through normal managed launch. Retain old source/selection identities as history.
- The maintained distribution's `grant-workspace` contribution selects this whole workspace component. Ordinary Python, MJS and Markdown members are included by the existing source selector.

Close the original private browser service before using headless CLI commands against that same workspace. The existing Workspace owner and mutex continue to control writes.

## The normal browser journey

### 1. Enter the actual issuer findings

Choose **New round from issuer decision**. A new round has an empty findings list and a generated stable round identity. The original outcome, its content hash and full original preparation are retained in the seed. Creating the editor does not save a case event.

Add the actual findings with **Add issuer finding**. Each row records:

| Field | Meaning |
| --- | --- |
| Original issuer finding | The request being answered, in sufficient detail to understand it later |
| Original finding source/attribution | Where the request came from and how it maps to the retained source |
| Work packages | Current original package IDs to which the finding applies |
| Accountable contributors | Existing contributor IDs responsible for the response |
| State | OPEN, IN_PROGRESS, ADDRESSED or NOT_APPLICABLE |
| Internal correction target | Optional civil date for coordination |
| Actual completion date | Required for ADDRESSED; absent for the other states |
| Response or non-applicability basis | What changed or why the operator considers the finding inapplicable |
| Work, deployments and sources | Existing records and exact source evidence supporting that response |

A preview requires one to 100 findings. A round may retain up to 100 saved editions. Saved finding IDs remain in every later edition of that round. **Remove unsaved finding** only removes a finding that has not yet entered the saved round; explain an earlier saved finding in a later edition instead of removing its history.

**ADDRESSED** requires a real completion date and a nonblank response. **NOT_APPLICABLE** requires a reason and remains an operator assessment, subject to the issuer's later decision. An unresolved finding can be saved as work in progress, but it prevents a ready re-preparation.

### 2. Compare the current source before saving

The editor displays its original case version. Case changes made elsewhere can make that basis stale.

Use **Compare current source**. The displayed comparison retains your edited document and shows the fresh current case, the actual current issuer outcome, the latest saved correction edition and the original/current package and assignment differences. Read the comparison before applying its current tokens.

Use **Keep edited findings and retain new findings from this displayed current basis** only after that review. This explicit rebase:

- Preserves your edited existing findings.
- Retains new finding IDs introduced in the latest saved edition.
- Keeps the prior input, seed and version in the working copy's history.
- Moves the edit onto the displayed current case/latest round basis.
- Clears the previous preview so the combined input must be previewed again.

If the case or your document changes again while that comparison is open, repeat the comparison. If the issuer outcome itself has changed, retain the older round and start a new round from the actual appropriate issuer decision. Do not relabel the old decision or silently replace its source hash.

An old saved correction edition remains readable and exportable. New edits and re-preparation must use the latest saved edition of the selected round; the server rejects a stale predecessor.

### 3. Preview and save an immutable correction edition

Choose a review date and **Preview correction edition**. Read the report and the original/current comparison. The native report includes:

- `readyForPreparation`, `sourceCurrent` and complete issues.
- Finding, addressed and non-applicable counts.
- Original/current plan content hashes.
- Each original/current package and its assignment.

Readiness checks the actual issuer decision, selected current references, accountable owner and package, finding state, dates, work status/package/contributor and selected deployment/source context. The completion date must follow the original issuer decision and not exceed the preparation date. Actual Operations mode also preserves its existing restriction on future dates; Walkthrough mode retains its existing demonstration behavior.

**Save correction edition** uses the exact preview date, preview SHA-256, full inputs and expected case version. It creates a native immutable review with purpose `TRANCHE_CORRECTIONS` through `completion.corrections.save`. Saving an honest incomplete edition is allowed; it does not turn an incomplete report into a ready completion.

The response identifies the saved review, case version, round, revision and preview hash. Reopen that exact saved review to inspect its complete source snapshot and findings. The existing command/event journal records the original request and the correction identity. A later save uses the saved review as `previousReviewId` and advances the same round.

If you edit while a prior request completes, the returned saved edition is retained without replacing a different newer working document. Keep both and compare explicitly.

### 4. Prepare and resubmit through Completion

Open the desired saved correction edition and choose **Use selected edition in preparation**. The existing completion input now carries its `correctionReviewId`.

Review the original payment receipt, tranche, completion summary, package assignments and any existing Cohort or Implementation evidence. The new preparation:

- Retains the same original receipt and payment-derived clock.
- Binds the exact saved correction review.
- Reassesses that edition against the current case.
- Includes the full immutable correction evidence and current assessment.
- Refuses preparation while the selected correction round is stale or has unresolved readiness issues.

Use the existing **completion preview → prepare → export → actual submission record → issuer decision** flow. An external submission is still a human or existing authorized delivery action; preparing or downloading a package does not perform one.

The later submission outcome records the correction review ID, round ID, correction revision and source outcome ID. If the issuer requests further changes, record that actual decision through the original decision command and start the next round from it. The new round's original preparation is the resubmitted preparation, so the complete earlier correction history remains linked.

Record a real extension only through the existing extension workflow and its actual supporting evidence. Internal `dueOn` values do not alter the grant clock.

## Working copies and interruption recovery

Working copies are separate from saved native reviews. The screen retains multiple round drafts during the current session. Use **Download complete correction draft** before leaving or transferring unfinished work; do not assume an unsaved browser session is a durable native edition.

The downloaded `stellar-forge.sf47-completion-correction-draft.v1` document preserves the complete inputs, original base version, date, seed, preview, draft history and any retained original pending correction-save payload. It is an editor-recovery file, not a case archive.

**Restore complete correction draft** supports a complete file up to 128 MiB. It validates the same case and complete structure before adoption, keeps the original basis, clears the old preview and requires current-source comparison. A different existing working copy is not silently overwritten. Download it first and reconcile the two complete documents.

| Situation | Correct continuation |
| --- | --- |
| Case version changed before save | Retain the draft; compare current source, review the displayed differences, explicitly rebase, then preview |
| Another saved edition advanced the round | Open the current head and use the explicit comparison/rebase path; retain newly saved findings |
| Save response was lost | Keep the exact original request ID and payload; use the existing original request read/retry path before making another mutation |
| The saved result returned after further editing | Retain the saved review and the newer draft separately; compare rather than replacing the draft |
| Browser closed with unfinished work | Restore the previously downloaded complete draft into the same case, compare its original basis and preview again |
| Original issuer outcome changed | Keep the old round readable; select the actual new decision for a new round |
| A linked source or record is missing | Recover its original retained input or correct the current selection with attribution; do not manufacture evidence |
| Archive exceeds the supported case/package limit | Retain the complete input and report the actual capacity issue; do not remove original findings or source files to force export |

Idempotency belongs to the original command request. Reuse the exact original request ID, actor, expected version, note and data when reconciling an uncertain request. Do not generate a new request ID merely because a transport response was lost.

## CLI: exact original entry points

From a complete selected application, the command prefix is:

```sh
python3 -B /absolute/application/workspace/cli.py operations \
  --workspace /absolute/original/private/workspace
```

An existing scenario path may be supplied as `--scenario` after `operations` and before its subcommand. The maintained Node launcher accepts the same original command:

```sh
node /absolute/application/workspace/launcher.mjs \
  --python /absolute/python3 operations \
  --workspace /absolute/original/private/workspace
```

The following are command suffixes for that prefix. Replace every uppercase token with an actual selected value; the examples do not create a demonstration case or invent an outcome.

```sh
completion-corrections-seed \
  --case CASE_ID --outcome ACTUAL_CHANGES_REQUESTED_OUTCOME_ID \
  --expected-version CURRENT_VERSION --output new-seed.json

completion-corrections-seed \
  --case CASE_ID --outcome ORIGINAL_OUTCOME_ID --review SAVED_CORRECTION_REVIEW_ID \
  --expected-version CURRENT_VERSION --output new-edition-seed.json

completion-corrections-preview \
  --case CASE_ID --inputs complete-inputs.json --expected-version CURRENT_VERSION \
  --as-of-date YYYY-MM-DD --output new-preview.json

completion-corrections-save \
  --case CASE_ID --inputs complete-inputs.json --expected-version REVIEWED_CASE_VERSION \
  --as-of-date REVIEWED_AS_OF_DATE --expected-preview-sha256 REVIEWED_PREVIEW_SHA256 \
  --actor ORIGINAL_ACTOR --request-id ORIGINAL_STABLE_REQUEST_ID \
  --note "Actual operator note" --output new-save-receipt.json

completion-corrections-export \
  --case CASE_ID --review SAVED_CORRECTION_REVIEW_ID --output new-corrections.zip
```

`complete-inputs.json` is the entire **inputs object** from the seed, edited with actual findings. It is not the whole seed envelope and not a partial patch. Input files use the original source-file bound of 8 MiB. The CLI's output publishing retains its existing create/adopt behavior; choose a new output path for a different edition.

For re-preparation, the existing `completion-preview --data` and `completion-prepare --data` documents may include `correctionReviewId` with the original receipt, summary, date and other selected evidence. Preserve the exact native preview/save contract for those existing commands.

## Programmatic API

The same Operations object supplies these mutex-protected methods:

| Method | Body or arguments |
| --- | --- |
| `seed_completion_corrections(caseId, body)` | `{expectedVersion, outcomeId, reviewId?}` |
| `preview_completion_corrections(caseId, body)` | `{expectedVersion, inputs, asOfDate?}` |
| `command(caseId, body)` | Original mutation envelope with action `completion.corrections.save` |
| `export_completion_corrections(caseId, reviewId)` | Complete correction ZIP bytes |
| `preview_completion(caseId, body)` | Existing input, optionally including `correctionReviewId` |

The save command envelope is:

```json
{
  "expectedVersion": 42,
  "requestId": "original-stable-request-id",
  "actor": "original-operator",
  "note": "Actual operator note",
  "action": "completion.corrections.save",
  "data": {
    "inputs": {
      "roundId": "corrections-<32 lowercase hexadecimal characters>",
      "previousReviewId": null,
      "outcomeId": "outcome-<32 lowercase hexadecimal characters>",
      "expectedOutcomeSha256": "<exact original issuer outcome SHA256>",
      "document": {
        "title": "Actual correction round",
        "findings": [],
        "note": ""
      }
    },
    "asOfDate": "YYYY-MM-DD",
    "expectedPreviewSha256": "<exact reviewed preview SHA256>"
  }
}
```

This is a shape illustration: the empty findings array and placeholders are intentionally not a savable real request. Keep generated native identities from the actual seed. Every finding retains all declared fields; use null for an absent date and an empty list for an unselected reference set.

Authenticated original HTTP routes are:

```text
POST /api/operations/CASE_ID/completion-corrections-seed
POST /api/operations/CASE_ID/completion-corrections-preview
POST /api/operations/CASE_ID/command
GET  /api/operations/CASE_ID/completion-corrections/REVIEW_ID/export.zip
```

The existing saved-review read route supplies the immutable review. Existing authentication and private workspace serving apply; no new public endpoint is created.

The typed agent client provides:

```js
client.completionCorrectionsSeed(caseId, expectedVersion, outcomeId, reviewId);
client.completionCorrectionsPreview(caseId, expectedVersion, inputs, asOfDate);
client.completionCorrectionsSave(caseId, {
  expectedVersion, requestId, actor, note,
  inputs, asOfDate, expectedPreviewSha256
});
client.download('completion-corrections', {caseId, reviewId});
```

The save convenience method constructs the original action/data command envelope itself. Pass its declared body, not a second nested action/data envelope. The generic `command` method continues to accept the native envelope. Preserve the existing client's complete download response and publication workflow.

## Export and independent receiving

**Download complete correction package** exports the selected immutable review for inspection. It includes:

- `corrections.json`: the full saved native review, snapshot, original issuer source and complete correction inputs.
- `original-preparation.zip`: the complete original completion package. A later round can retain a previously corrected preparation through this link.
- `sources/<id>`: original issuer, finding, work and deployment source files selected by that native review.
- `findings.csv`: a readable field projection; use the complete JSON for every reference list and source binding.
- `comparison.json`: the full original/current comparison recorded in the review.
- `corrections.html`: the readable correction report.
- `MANIFEST.json`: exact paths, byte lengths and SHA-256 values for the exported members.

The exporter uses the original 32 MiB bundle bound. It reads the selected original source bytes and does not substitute newer files for a saved review.

For an **editable transfer**, export and receive the **complete original Operations case** through the existing case workflow. The correction ZIP is an inspection package; it is not a substitute for that full case archive. The full case keeps the plan, source files, reviews, records, original request identities in events and completion/correction history required for independent reopening.

The native case importer validates the correction review's original case/version and source snapshot, the sequential round/predecessor chain, original submitted preparation, actual issuer-decision event, and corresponding save event. A later completion preparation must retain the exact earlier correction edition. Historical editions remain inspectable; current continuation still checks the latest round head.

After independently receiving the case:

1. Open its Completion screen and the retained actual changes-requested outcome.
2. Read each saved correction edition and export one complete correction package.
3. Confirm the full original preparation and selected source files are available.
4. Open a complete draft or edit the appropriate current saved edition through the same original source-comparison path.
5. Save a new edition with a new intentional command request and its actual current expected version.
6. Re-prepare only when the current native report is ready, then export and reopen the complete updated case again.

Do not rewrite historical case IDs, source hashes, dates or saved review records merely to match a new receiving workspace. Let the original importer preserve its own established lineage semantics.

## Delivery and validation scope

This guide is tied to the complete native core/UI/HTTP/action-contract edition `b89471ce79461c2e1941ce47c8d4f0fa36eb7fc5` and the complete three-file CLI/typed-client edition `e91cbd9af1cd87761b16ec9e48d34eb5931f504c` in `woahwhattheheck/tjlabs-stellar-merchant-workspace`. The integration owner composes these with current shared preimages and the two managed-launch inventories.

The source workflow and original API joins were read in full for this guide. This document does not claim a new native case, issuer reply, submission, grant award or payment. The integration owner's actual original-engine receiving report supplies the executed source identity, case/round/review IDs, export and independent-receiving results. Keep any pending native/browser stage explicit until that report exists.

### A useful complete receiving exercise

Use an existing retained case containing the actual original records, or an explicitly labelled Walkthrough case under the original product rules. Exercise two consecutive correction rounds, not an invented issuer event in a real case. The course should preserve the first immutable preparation and issuer decision, save an incomplete edition, resolve findings with original evidence, advance the same round, reject stale-head preparation, re-prepare and record the actual appropriate submission/decision state. Then receive the complete case independently, reopen the exact editions and save a deliberate later editable edition. Retain the complete original package and actual result, including any honest open item.

This is the ordinary feature receiving path through the original engine. It does not require a separate correction controller, alternative journal or duplicate grant model.
