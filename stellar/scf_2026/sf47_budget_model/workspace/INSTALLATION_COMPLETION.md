# Installation acceptance in Completion

This guide follows the existing SF47 Operations case from a saved Installation check to its tranche assignment, original completion preparation and complete receiving. It uses the current Installation and Completion stores. Customer acceptance, a native paid result, delivery of a funded package and an issuer decision retain their own records.

The operating source is `operations_completion_installations.py`, with the original `operations_completion.py`, Operations HTTP/controller and staff routes. The browser extension opens inside the existing Completion screen. An Installation remains editable through its original owner; this feature selects its exact saved edition and check.

## Begin in the original case

Open the current complete Operations case and its selected funding-plan revision. Retain the actual customer workorder, source attachments, selected Installation, native work and purchase observations. For a received case, use that case's actual current ID and version. An immutable Installation's historical source may still name an earlier case; do not rewrite that historical source or use it as the current HTTP route.

A proposed customer document does not establish customer acceptance. Record the actual Installation check state, operator, observation time, note and selected source/work/purchase/outcome records through the original Installation application before selecting it for Completion. Save the edition there. Keep unobserved criteria open.

Open the original tranche assignment draft. Each existing funded package has one row; retain every package, accountable owner, work/deployment/source link, date, note and completion result already entered. The additive `installationSelections` array chooses the Installation evidence used by those rows.

## The exact selection

Each selected record has six fields:

|Field|Meaning|
|---|---|
|`costId`|Actual existing funded package ID in the selected tranche.|
|`installationId`|Original saved Installation ID, scoped to this case.|
|`revision`|Exact positive saved edition number.|
|`sha256`|SHA-256 of that complete original edition.|
|`checkId`|Existing acceptance check ID in that edition.|
|`requirePaidPurchase`|Explicit boolean selecting whether this check must carry an original useful paid result.|

Use the catalogue's actual values. Do not manufacture hashes or substitute names for IDs. Up to 200 package/check selections and 20 distinct Installation editions are supported. One Installation uses one exact edition across the selection. A package/Installation/check combination appears once. A check must be assigned to the chosen package through the Installation's original `assignments.costIds`, and its tranche must be the selected tranche or unscoped.

The same observed purchase can support more than one selected check while retaining one purchase identity in the report's distinct count. A retry, reopen or delivery page of that purchase does not create another purchase. Separately approved and paid original pages retain their own native purchase identities. Completion of a whole customer task still requires every agreed page, file and order action.

## Review and transfer into the existing assignment draft

The catalogue lists current saved heads assigned to packages in the selected tranche. Selection is explicit; listing a check does not select or accept it.

Preview the full current assignment draft together with the selected checks and the actual review date. The response retains:

- `originalInputs`: the complete normalized assignment input inspected;
- `proposedInputs`: that input with compatible existing work, contributors, deployments and sources added to the corresponding package rows;
- `suggestions`: per-package observed completion date, a combined check/result note, whether selected acceptance is recorded, and excluded links;
- `report`: exact source editions, check and paid-result observations, current-source comparisons and issues;
- `previewSha256`: the identity of this read-only transfer preview.

The transfer uses union semantics for existing links. It preserves the operator's current assignment state, dates and notes. Work from another package and deployments from another tranche or package are excluded and explained. The suggested acceptance result concerns selected checks. It does not establish completion of other work within the funded package.

Review the complete package before deciding whether to apply a suggested date or note and mark its original row complete. A `COMPLETE` package requires its actual completion date and a meaningful completion result; the existing engine also checks accountable owners, work/deployment bindings, observation dates and source availability. Unselected package work remains the operator's responsibility.

Save the full chosen assignment through the existing `completion.save` command. There is no new acceptance-save command and no separate Installation mirror. Saving freezes the complete selected editions with the same Completion plan and preserves original event history.

## Browser procedure and complete working copies

Open the existing Completion screen and the selected tranche's assignment editor. Its **Use original Installation acceptance** section is part of that same editor.

1. Select **Open current Installation checks**. A changed case makes the catalogue visibly stale; refresh it before selecting another check.
2. Choose **Original funded package** and **Saved Installation**. Read the exact edition/hash, criterion, observed result and linked records.
3. Select the actual checks. Decide explicitly whether **Each selected check requires an original useful paid purchase** applies, then select **Add selected checks to package draft**.
4. Inspect **Checks retained in this assignment draft**. **Remove this selection** removes only that draft selection; it does not edit the Installation or its historical acceptance.
5. Select **Review selected Installation results**. Inspect every issue and the complete original/proposed assignment inputs. **Add matching links to assignment draft** applies the compatible links while retaining your previous complete inputs.
6. If the actual package work is complete, use **Use observed result as package completion draft** for that package. This is an explicit draft change. The control is unavailable for unresolved selected evidence, absent acceptance/date, a stale preview or an overlong suggested result. Review all unselected package obligations before using it.
7. Use the original **Save assignments**, then the existing Completion form preview and prepare controls. Applying links changes the draft and invalidates its preceding review, so review again before applying another result.

The editor retains a complete copy of assignment inputs before add/remove/apply operations. **Download Installation working copy** exports the current assignment, selections and retained working history with schema `stellar-forge.sf47-completion-installation-draft.v1`.

**Restore Installation working copy** accepts a complete JSON file for the same actual case and tranche, up to 128 MiB. It validates structure before replacing the draft, keeps the prior complete draft and imported working copy, restores the original versioned catalogue and selectors, clears active preview authority and marks the result edited. A catalogue from an earlier case version remains visibly stale until the operator opens the current checks. It does not rewrite its original base version to pretend a stale draft is current. Reconcile changed current assignments through the existing editor before saving.

A working-copy file is an editing aid. To move between independent cases or operators, receive the complete original case first and use the original importer/current case context. Do not change a working-copy case ID manually to bypass its binding. Very large retained histories stay available in their original downloaded file; the bounded browser reader reports an oversized file rather than truncating it.

## Keep and reopen the complete Completion editor

**Complete working copies** keeps the whole original Completion editor in this browser: every tranche's assignment and form fields, unfinished issuer dialogs, correction drafts and source, Installation selectors and earlier inputs, selected native reviews, and original request/receipt history. Native previews remain retained for reference but must be read again after reopening. An invalid or incomplete business field stays editable; local retention does not assert that its native save is valid.

The selected copy is remembered for the original installation, named operator and case. Use **Save working copy** for an immediate durable local checkpoint. **Saved working copies**, **Refresh saved copies** and **Open selected working copy** reopen other retained copies. Opening a copy creates a separate editable copy and preserves the preceding complete download and saved record. **Keep as separate copy** also resolves a concurrent-window save conflict without overwriting the other window's version. If a duplicated tab starts from the same copy, the atomic revision check detects its first conflicting save; neither version is silently replaced.

**Download complete working copy** is available while a request is pending, after an accepted reply and during a storage failure. It captures the full current editor and exact original request bodies synchronously, without a storage or network read. **Open complete working-copy file** accepts that full JSON envelope for the same actual case, up to 256 MiB. It validates all editable structures, original request identities and any existing request collisions before adopting fields. It retains accepted receipts when an older copy contains only the corresponding pending request. An independently selected operator or installation's copy remains readable/downloadable; its requests must continue under their original scope.

The earlier **Download Installation working copy** / **Restore Installation working copy** controls remain available for the selected tranche's specific assignment and Installation working state. Restoration reopens the original package, Installation, check and paid-result choices and their full earlier-input history. A retained catalogue is displayed with its original version, and a changed current case makes it stale. Unavailable selected options remain visible. Earlier preview/proposal data is retained in the received copy but cannot be applied without a new original preview.

Before a native mutation, the editor commits the exact original requestId, expectedVersion, recording actor and complete payload to its scoped request journal together with the full editor. It records an actual accepted receipt before clearing its pending state. **Retry same save** uses that same original body and ID; it does not create another save from the currently displayed fields. A matching retained receipt is reopened first. **Reopen accepted result** verifies the original result against the native case. Definitively rejected requests remain in the complete history, while authentication and uncertain responses keep their original pending body.

A browser storage failure preserves the current fields and download in memory and prevents a new POST until the complete original request can be retained. **Save working copy** retries storage. A received file can remain open in memory when storage is unavailable, with that limitation displayed separately from native errors. Keep its full download before leaving. The page warns when local writes, an original request or accepted-result recovery remain unfinished. None of these local copies replaces the complete native case export, immutable Installation evidence or original request-journal replay in the owning workspace.

## Current head and historical evidence

Selection preview and assignment save require each selected Installation to remain its current saved head. If the owner saves a later edition between selection and save, the existing operation returns `COMPLETION_INSTALLATION_CHANGED`. Reopen the current edition, compare the changed check and update the explicit selection. Preserve the earlier edition.

A previously saved Completion plan retains its exact earlier evidence. During later form preparation the engine reports a changed head, linked record or source rather than silently replacing that evidence. A historical preparation and its exports remain readable with the source originally frozen into them.

A received case preserves the whole Installation edition, its snapshot, exact source files and original event identities. Case import checks that each Completion selection matches an earlier retained Installation edition. It also inspects historical Completion save/extension events and prepared forms, so onward receiving cannot omit an edition merely because the current head has advanced.

The original request journal governs replay while the original workspace is retained. A complete case export preserves original request identities in its events; it is not a claim that an imported case recreates the old runtime request-journal table. Continue mutations through the actual received case and its current version.

## Useful paid-result requirement and limits of the report

When `requirePaidPurchase` is true, at least one purchase selected by that check must retain the original successful settlement, positive amount, transaction identity, complete hashed output and a fulfilled or inapplicable order. A void record does not qualify. Original observation, settlement and output-completion times are checked against the chosen preparation date.

The report exposes the exact selected observations and counts distinct original useful purchases. It does not infer independent organizations, an independent buyer, current licensing rights, issuer acceptance or a mainnet deployment merely from a successful payment. Use the existing Customer-use Calendar, Cohort, deployment and issuer records for their own criteria.

A false `requirePaidPurchase` value means this particular selected check does not require a paid purchase in this report. It does not relax another funded acceptance criterion. Select the requirement that matches the actual package and check.

## Prepare the original completion form

After the assignment save, select the actual preceding payment receipt in the existing Completion screen. Its existing clock determines the tranche and applicable deadline. Retain confirmed extensions through the original issuer-confirmation workflow.

The ordinary completion preview checks all package rows, current selected Installation evidence, any selected Cohort and ImplementationEvidence reviews, and any original correction round. Provide the actual as-of date and complete tranche summary. An open or stale Installation finding remains a visible issue and makes the form unready.

Freeze a preparation only from the returned current preview SHA through `completion.prepare`. A changed case or preview must be reopened and reviewed; do not create a replacement hash. The saved result is the existing immutable review with purpose `TRANCHE_COMPLETION`.

Downloading or preparing a form is not an issuer submission. The original `completion.submit` records an actual submission and its source/reference. The original `completion.decision` records the issuer's actual acceptance, requested changes or other supported outcome. When changes are requested, use the existing Completion corrections lifecycle and retain the original preparation, finding and resubmission link.

## HTTP and Python integration

Both new routes use the existing authenticated Operations service and case version. They are read-only previews; the original command route remains the mutation authority.

|Operation|Route/body|Returned selection|
|---|---|---|
|List original checks|`POST /api/operations/{case}/completion-installations`, `{expectedVersion, tranche}`|Current case/version, tranche and saved Installation heads/checks assigned to its packages.|
|Preview transfer|`POST /api/operations/{case}/completion-installations-preview`, `{expectedVersion, inputs, asOfDate?}`|Original and proposed complete inputs, suggestions, report and preview SHA.|
|Save assignments|Existing Operations command with action `completion.save`, data `{inputs}`|Same original Completion plan and frozen selected Installation evidence.|
|Preview form|Existing `completion-preview` with actual receipt/date/summary and optional retained review IDs|Ordinary Completion preview including Installation readiness.|
|Prepare form|Existing `completion.prepare` with its exact `expectedPreviewSha256`|Original immutable Completion review.|

Python methods are `Operations.completion_installations(program_id, body)` and `Operations.preview_completion_installations(program_id, body)`. They keep the original workspace snapshot through current-context selection and all source reads, giving each catalogue or transfer one consistent view. They do not start another workspace owner.

For the generic command endpoint, retain the complete existing envelope: actual `expectedVersion`, `requestId`, `actor`, optional `note`, `action:"completion.save"` and `data:{inputs:...}`. The transfer preview hash is not a replacement for the ordinary form preparation hash. Assignment save uses its existing command contract; form preparation uses the ordinary Completion preview.

Illustrative selection fragment, to be populated only from actual source values:

```json
{
  "installationSelections": [
    {
      "costId": "ACTUAL_EXISTING_COST_ID",
      "installationId": "ACTUAL_INSTALLATION_ID",
      "revision": 1,
      "sha256": "ACTUAL_COMPLETE_EDITION_SHA256",
      "checkId": "ACTUAL_CHECK_ID",
      "requirePaidPurchase": true
    }
  ]
}
```

This fragment is not a valid complete request. Preserve `tranche`, every original `items` row and `note`; use the complete native input object, not a seed/preview response envelope.

## Existing headless save and form commands

Use the existing installed launcher and private workspace. Close that workspace's browser service before opening its headless CLI owner. Shared options occur after `operations` and before its subcommand:

```bash
python3 -B /absolute/workspace/cli.py operations \
  --workspace /original/private/workspace \
  completion-seed --case ACTUAL_CASE --tranche 1 \
  --expected-version ACTUAL_VERSION --output /private/new-seed.json
```

The maintained Node launcher accepts the same Operations arguments after `--python /absolute/python3`. Keep any existing explicit scenario selection required by that installed workspace.

The seed response contains `inputs`; save its complete edited input object as a separate UTF-8 file. Do not send the full seed response as the assignment input. After reviewing the selected checks/transfer through the current native API or browser, use the original commands:

|Command|Required selection|
|---|---|
|`completion-save`|`--case`, `--inputs` complete input file, `--expected-version`, `--actor`, stable `--request-id`; optional `--note`, `--output`.|
|`completion-preview`|`--case`, `--data` native preview fields, `--expected-version`; optional `--output`.|
|`completion-prepare`|`--case`, `--data` native preparation fields including the actual `expectedPreviewSha256`, `--expected-version`, `--actor`, stable `--request-id`.|
|`completion-export`|`--case`, exact prepared `--review`, new `--output` path.|

The form data file contains the actual `receiptId`, `asOfDate`, `summary` and any explicitly selected `cohortReviewIds`, `implementationReviewIds` or `correctionReviewId`. The preview data file excludes `expectedVersion`, which the command adds from its explicit flag. The save command wraps the complete input object as `data.inputs`; the generic command API retains its original full envelope.

The released read-only wrappers use these exact arguments:

|Command|Required and optional flags|
|---|---|
|`completion-installations`|`--case CASE --expected-version N --tranche {1,2,3}`; optional `--output FILE`.|
|`completion-installations-preview`|`--case CASE --expected-version N --inputs FILE`; optional `--as-of-date YYYY-MM-DD`, `--output FILE`.|

`--inputs` is the complete original assignment JSON, including any `installationSelections`, rather than the catalogue, seed or preview envelope. The braces in the tranche table denote its three supported choices; pass one integer.

For example, keep the original workspace selection and current version through both reads:

```bash
python3 -B /absolute/workspace/cli.py operations \
  --workspace /original/private/workspace \
  completion-installations --case ACTUAL_CASE \
  --expected-version ACTUAL_VERSION --tranche 1 \
  --output /private/current-installation-checks.json

python3 -B /absolute/workspace/cli.py operations \
  --workspace /original/private/workspace \
  completion-installations-preview --case ACTUAL_CASE \
  --expected-version ACTUAL_VERSION --inputs /private/complete-assignments.json \
  --as-of-date ACTUAL_REVIEW_DATE --output /private/installation-transfer.json
```

The maintained JavaScript client exposes `completionInstallations(caseId, {expectedVersion, tranche})` and `completionInstallationsPreview(caseId, {expectedVersion, inputs, asOfDate?})`. Pass the actual full input object to the latter; `asOfDate?` denotes an optional property. Both wrappers call the original read-only catalogue/transfer APIs. The existing save/prepare/export commands remain the persistence path; there is no separate Installation acceptance mutation.

## Complete export and independent receiving

A prepared form with selected Installation evidence adds these original files to the existing complete Completion export:

|Path|Contents|
|---|---|
|`installation-evidence.json`|Full frozen Installation report and original selected evidence.|
|`installation-checks.csv`|Selected package/check criteria, actual state/operator/time/result and original useful purchase IDs.|
|`installation-evidence.html`|Readable selected-check report linking to original edition handovers.|
|`installation-editions/{installationId}-r{revision}/installation.json`|Complete original saved edition.|
|`installation-editions/{installationId}-r{revision}/sources/*`|Every exact source selected by that edition.|
|Other files under each edition directory|The original Installation engine's complete selected handover files.|

The existing form, rule, package report, selected Cohort/ImplementationEvidence/correction material and manifest remain in that same export. Source bytes are checked against the original size and SHA before export. Complete archive bounds remain enforced; a missing or oversized source is a visible failure, not a reason to omit evidence.

For editable receiving, export the complete original Operations case through its existing case export. In an independent private workspace, inspect and receive that full package through the original importer. Reopen the saved assignments, original Installation editions and prepared form. Compare the real current case/version before any later edit.

Then use the received Installation's existing editor to save a deliberate authorized later edition. Its earlier Completion preparation should remain readable, while a fresh form preview surfaces that the selected head has changed. Review and save the new selection through the same Completion flow. Export and receive again to confirm the next maintainer has both generations, the original sources and the full event/assignment history.

This is the meaningful receiving course. Keep synthetic examples explicitly identified; do not label their transactions, customers or issuer decisions as actual external acceptance.

## Recover a conflict or interruption

|Observed condition|Continue through the original workflow|
|---|---|
|Current case version changed|Reopen the complete current case and preserve later edits before preparing another preview.|
|Installation head changed before save|Compare the current head; explicitly select its exact revision/hash and re-preview.|
|Selected check remains OPEN or another unfinished state|Record actual work and observation through Installation, then select that saved edition.|
|Selected linked record changed or was voided|Reconcile its original history; retain the earlier record in the frozen evidence.|
|Check, save or paid-result observation is after the cutoff|Use the actual preparation date and preserve all recorded times.|
|Paid-result requirement is unsatisfied|Continue the original purchase/delivery recovery or retain the incomplete result. Do not invent a second payment or receipt.|
|Source unavailable during export|Restore the exact original source or preserve the failed export; do not substitute a later body under its old identity.|
|Save response uncertain|Inspect/replay the same original request with the same body in its owning workspace; retain the outcome before another mutation.|
|Independent import rejects evidence|Restore the complete original edition/source/event closure identified by the importer, then continue the same receiving operation.|

## Inspect the exact installed editor and outgoing files

Continue the original Installation-to-Completion receiving operation with the exact selected source edition. Open the complete installed editor with its original populated case. Retain an unfinished assignment, issuer form and Installation selection; save and download the full working copy, reload the actual page, reopen the retained copy and inspect the restored fields. Operate the original save and same-request recovery, review a recorded receipt, open another retained copy, and independently reopen the full downloaded file. Keep the original native request IDs and case throughout this continuation.

The producing worker and reviewer must look at the actual wide and narrow rendered results, including the full source/history panels, controls, downloaded files and reopened state. Repair visible clipping, overflow, missing styling or broken navigation in this same product before its customer-facing handoff.

The active owner instruction applies in full:

> Before calling any customer/prospect-facing application, website, dashboard, demo, report, presentation or export ready, open/run/render the exact outgoing version, look at the rendered screen or its actual screenshots, and operate the important user controls. Inspect the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Code review, DOM counts, HTTP 200, unit checks and another worker's approval do not replace seeing the actual product.
>
> Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk; do not run broad suites or build a verification product.
>
> Include this complete instruction in delegated assignments and the active owner-controlled policy, boot, build and receiving guidance those workers actually read. Preserve all other owner controls and original operation identities. Leave historical records and third-party/vendor policies intact. Do not force restarts, create watchers or revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Current original-operation source handoff: https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791878750110849?thread_ts=1791730668.369819 .

## Source delivery and validation record

The extension is additive to the current SF47 Installation, Completion, HTTP, staff permissions, browser and typed-client/CLI paths. The current `managed-source.json` selects the complete managed runtime for both launchers and installed distribution. Keep the Python module, browser modules and this guide in that original inventory exactly once, preserving every current prior member. This working-copy continuation changes existing selected files and requires no additional source member.

Read the released source/status record for actual validation. Source review, local pure checks and a failed process admission are separate from a completed native case/browser/receiving run. A runtime-unavailable attempt establishes no customer state.

The existing Installation and Completion guides remain authoritative for their original editing, save, issuer and export actions. This guide documents the explicit saved-check selection and its complete source-preserving continuation.
