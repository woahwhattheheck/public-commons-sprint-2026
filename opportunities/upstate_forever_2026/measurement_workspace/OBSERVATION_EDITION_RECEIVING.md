# Observation editions: complete original receiving

## Product and source scope

This chapter operates the existing Measurements application from original source intake through two saved Observation editions, reports, every original source download and complete editable reopening. It reuses the Source Versions receiving driver, its owned output directory, its original Node server helpers and its isolated Playwright/Chromium lifecycle.

The callable operateObservationEditionReceiving function uses an already-owned page and server. The CLI runner starts only the server/browser instances recorded by that existing receiver. It does not take over an admitted process or use Bryce's reserved local browser.

Use the retained Hartwell collection and current SV-233 collection supplied with the complete application:

- observations/hartwell_2026/wqp_20261013/characteristics-v1/collection.json — original Hartwell result population, 132 records.
- observations/eighteenmile_sv233_2026/wqp_20261013/characteristics-v2/collection.json — original SV-233 result population, 58 records, with its explicitly selected current characteristic interpretation.

These are original retained populations. They are separate from the missing historical 533-record/five-source archive; this chapter does not reconstruct or claim receipt of that archive. Preserve both collection manifests, every declared member and their original source identities. Do not substitute a station-only intake: the chapter requires actual observation records.

A default run retains all selected original WQP observations and makes no relationship claim. A receiving operator may supply reviewed relationships and exclusions supported by the actual rows. Same station or timestamp alone does not establish a revised result, same observation or replicate. Different method, method context, sample fraction, medium, depth, timezone or activity type remain visible. Every original result remains in the report and complete portable workspace even when a reviewed representative is selected.

## Prepare the original input using the maintained CLI

Run from the installed application directory with its current complete Measurements dependencies. Use actual absolute paths. The paths below are examples to replace, not ready-to-run credentials or a second workspace controller.

Create a separately owned input-preparation directory. The existing CLI creates its Measurements workspace. For each selected original collection, use the manifest's own directory as source-root:

~~~sh
node measurement_workspace/engine/cli.mjs collection-preview \
  --workspace /ABS/OWNED_INPUT/workspace \
  --manifest /ABS/APPLICATION/observations/hartwell_2026/wqp_20261013/characteristics-v1/collection.json \
  --source-root /ABS/APPLICATION/observations/hartwell_2026/wqp_20261013/characteristics-v1

node measurement_workspace/engine/cli.mjs collection-receive \
  --workspace /ABS/OWNED_INPUT/workspace \
  --manifest /ABS/APPLICATION/observations/hartwell_2026/wqp_20261013/characteristics-v1/collection.json \
  --source-root /ABS/APPLICATION/observations/hartwell_2026/wqp_20261013/characteristics-v1

node measurement_workspace/engine/cli.mjs collection-preview \
  --workspace /ABS/OWNED_INPUT/workspace \
  --manifest /ABS/APPLICATION/observations/eighteenmile_sv233_2026/wqp_20261013/characteristics-v2/collection.json \
  --source-root /ABS/APPLICATION/observations/eighteenmile_sv233_2026/wqp_20261013/characteristics-v2

node measurement_workspace/engine/cli.mjs collection-receive \
  --workspace /ABS/OWNED_INPUT/workspace \
  --manifest /ABS/APPLICATION/observations/eighteenmile_sv233_2026/wqp_20261013/characteristics-v2/collection.json \
  --source-root /ABS/APPLICATION/observations/eighteenmile_sv233_2026/wqp_20261013/characteristics-v2

node measurement_workspace/engine/cli.mjs portable \
  --workspace /ABS/OWNED_INPUT/workspace \
  --output /ABS/OWNED_INPUT/original-measurements.json
~~~

Retain the preview/receive results through the existing operator's logging practice. Do not overwrite a user's live workspace to produce this input.

Save collections.json beside the input portable. Its complete contents are an array of the actual absolute original manifest paths:

~~~json
[
  "/ABS/APPLICATION/observations/hartwell_2026/wqp_20261013/characteristics-v1/collection.json",
  "/ABS/APPLICATION/observations/eighteenmile_sv233_2026/wqp_20261013/characteristics-v2/collection.json"
]
~~~

The chapter verifies that every import from those collections already belongs to the selected portable. It restores the original collection companions through the existing collection receiver, then checks that the complete source state has not changed. Supplying an unrelated collection is an error, not an instruction to add new scientific inputs.

## Run the complete chapter in the existing receiving course

Use the actual isolated browser module and executable already available to the accepting receiver:

~~~sh
node measurement_workspace/engine/reconciliation-receiving.mjs \
  --chapter observation-editions \
  --portable /ABS/OWNED_INPUT/original-measurements.json \
  --output /ABS/OWNED_RECEIVING \
  --reviewer "Actual receiving operator" \
  --reason "Review the retained original observation population and complete source handover" \
  --observation-collections /ABS/OWNED_INPUT/collections.json \
  --playwright /ABS/EXISTING_PLAYWRIGHT/index.mjs \
  --chromium /ABS/EXISTING_CHROMIUM
~~~

Use an output owned by this receiving operation. Keep the original portable outside it. When continuing a previously prepared Source Versions receiving directory, preserve the exact portable, reviewer, reason, group/record selection and reaches options already recorded there. Its Source Versions selection and plan stay intact; this chapter has its own observation-editions subdirectory and does not alter original reviews or selected source versions.

Without the browser paths the driver retains and validates the original input and returns AWAITING_EXISTING_EQUIPPED_BROWSER. That result is preparation, not completed native or visual acceptance. Continue the same command with the original equipped receiver's paths once it has accepted this course.

The original driver remains available without --chapter or with --chapter source-versions. There is one maintained lifecycle and no new long-running server command.

## Explicit scientific choices

To exercise reviewed groups or exclusions, add --observation-choices /ABS/OWNED_INPUT/observation-choices.json. The file must contain groups and exclusions arrays. Optional fields are source_ids, filters, title, revision_title and purpose.

A complete no-relationship choice file is:

~~~json
{
  "title": "Original Hartwell and SV-233 observations",
  "revision_title": "Original observations — continued review",
  "purpose": "Review complete original rows and retain their current eligibility without asserting cross-source identity.",
  "groups": [],
  "exclusions": []
}
~~~

Omitting source_ids selects the actual retained WQP imports. A supplied source_ids array uses the original 64-character import identities, not station names. Filters use the existing observation scope fields: stationId, parameter, characteristic, fraction, unit, censor, method, organization, activityId, from and to.

Obtain exact record IDs and discrepancies from the same owned receiving workspace using the existing Observation editions catalogue/inspect controls or CLI. A supplied group uses the original fields member_ids, relationship, representative_id where required, rationale, evidence_reference and acknowledged_differences. Supported relationships are same_observation, independent_replicates, related_context, distinct_observations and unresolved. An exclusion uses record_id and reason.

Apply only a conclusion supported by the original rows and entered by the named receiving operator. For same_observation, inspect every discrepancy and acknowledge the actual required differences; retain a supported representative. Do not create an invented duplicate, replicate, source edition or synthetic publisher row just to obtain a particular screenshot. If the selected real population has no defensible same-observation group, the full save/recovery/revision/export course still operates with an empty groups array.

The original edition compiler validates the complete choice file before the browser writes. An invalid or unsupported choice leaves the original source unchanged.

## What the chapter operates

The course verifies that the page serves the entire selected owned workspace, then uses the actual product controls to:

1. Inspect the selected original population and open an original record with its source provenance.
2. Apply only the supplied explicit relationships/exclusions; save an unfinished editable draft.
3. Save the first named edition through the original HTTP endpoint. The receiver retains the exact outbound operation before dispatch, allows the service to accept it, then deliberately drops that response to exercise the existing lost-acknowledgment workflow.
4. Download the exact pending request, choose Keep request for recovery and continue editing, navigate away/back, and reopen the downloaded draft in a fresh browser page.
5. Recover the original accepted operation with its original operation ID. No second scientific save replaces it.
6. Open a revised edition through the original revision control, retain the supplied scientific choices, enter its distinct title/purpose and save it as an immutable child.
7. Open both historical editions and download each complete JSON, occurrence CSV, standalone HTML, calibration JSON and every retained original source.
8. Open each standalone report, use its own JSON/source controls and capture its expanded readable review at 390 px.
9. Download the complete editable workspace, return to the historical first edition and verify it remains unchanged.
10. Receive the complete portable into a separate fresh Workspace using the original native receiver, restore original collection companions, reopen both editions through native validation and the original browser, and download the received child again.

The deliberate dropped response is an authored receiving exercise. It is neither a publisher error nor a claim that the live source system failed. There is no fitted model, inferred coefficient, average, load estimate or automatic sensitivity analysis in this chapter. The calibration export retains discrete result eligibility; it does not establish annual NDR/SDR calibration suitability.

## Outputs, resumption and complete viewing

The observation-editions directory retains the exact selection, original portable, original collection manifests/members, both actual outbound requests and accepted editions, editable pending/retained drafts, both complete reports and source downloads, the complete editable workspace, native received summary and desktop/390 captures.

ATTACHMENTS.html is the readable index with links to every retained output and inline images. ATTACHMENTS.json lists complete bytes and SHA-256 identities. COMPLETE.json records completed native/browser assertions and explicitly leaves personal visual acceptance pending.

The producing equipped receiver must open the actual desktop and 390 images and personally inspect them. Open both standalone reports and their original source/JSON downloads; inspect both CSVs, calibration exports, complete portable and original collection manifests/attachments. Confirm the actual cold-received editions. Return the output directory, manifest, original source identities and any concrete exception to the same receiving operation. A source-only adapter replay or screenshot creation does not establish that the images or files have been viewed.

Rerun the exact command after interruption. The receiver retains original requests before dispatch and reuses their IDs. Once a browser phase is complete, continuation reuses its retained outputs. A retained editable-workspace.json is compared to the current complete workspace while ignoring only portable.createdAt, then reused byte-for-byte; a changed original or mutable state stops continuation for explicit review. Immutable JSON/CSV/HTML/source outputs must still match exactly.

The driver uses its existing private session record and stops only its spawned child. An unconfirmed shutdown remains visible and blocks a duplicate server. Preserve an admitted worker/PID and do not start another receiver over its directory. The final manifest is verified on completed reruns.

This chapter follows CURRENT_OWNER_DIRECTION.md edition 2026-10-13.4 and the current owner requirement to operate the complete rendered workflow and open all delivered attachments. It does not imply a release of Bryce's local browser reservation; an isolated cloud receiver remains the intended execution surface.
