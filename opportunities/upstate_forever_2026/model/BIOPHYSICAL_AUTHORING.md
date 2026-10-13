# Author coefficient evidence in the original profile workspace

This workbench retains a scientist's citations, locators, time periods, notes and sourced parameter ranges for every coefficient in one saved native profile. It preserves the original coefficient values, units, load types, source table and selected NDR/SDR model scope.

The original scientific authority is `model/biophysical_evidence.py`. The authoring editor saves unfinished work; ordinary evidence registration uses that engine's existing preview and save. The original profile, native source table and model execution remain under the established scientific workflow.

## Open, write and resume

Open the original profile in the existing Profile workbench, then its coefficient evidence view. The authoring section starts from that profile's complete native coefficient catalog. Every original cell remains present in the original order, including cells without citations.

Name the working study and record its purpose. Edit the source title and URI, source locator, period, lower and upper endpoint, range basis and notes. Use the search and status filters to work through large tables, or select several cells and apply the same explicitly entered source details. The editor retains raw text, including unfinished endpoints, citations and unapplied bulk-citation fields. Unapplied bulk fields remain separate from the rows until the operator explicitly applies them. Saving working JSON or a named revision does not assert that those fields are scientifically complete.

A named series has immutable numbered revisions. Save records the selected parent and the complete current draft. If another tab has saved a newer revision, the original request is retained and the native operation reports the changed parent. Reopen the latest revision or deliberately fork a new named series; neither tab silently overwrites the other.

The browser keeps the exact pending request identity and body before sending a mutation. Recover that original request after an interrupted response. The native store checks the original request and any already published revision before applying the current-parent check. A successful retry returns the original saved revision.

Use the history selector to inspect an earlier revision without replacing its descendants. Forking that selected revision creates a new named series. A full imported history is retained unchanged as the new series' ancestor. Edits made before the first fork save belong to the new descendant; they do not rewrite the imported history.

## Fixed source context

Every working draft records all of these original identities:

- Scientific workspace ID and saved profile ID.
- Source collection ID and source table ID.
- SHA-256 of the original biophysical table.
- Exact selected model list.
- Every coefficient's land-cover code, parameter, original numeric text, native units and load type.

The backend reopens the actual catalog and compares the complete ordered row set. It accepts no added, missing, reordered or altered fixed cell. A working package for another profile or table must be opened in its original workspace; changing a filename or profile selector does not rebind it.

When starting from saved evidence, the existing evidence record is inspected through the original scientific engine. Its reference is retained as `origin_evidence_id`. New citations remain the scientist's explicit edits.

## CSV import and ordinary source registration

CSV import first displays changes against this exact working source. Applying a preview requires the same profile/table binding, fixed cells and unchanged prior editable values. A preview from another source or from before intervening edits must be inspected again.

The ordinary CSV column order is:

```text
lucode,parameter,value,units,load_type,source_title,source_uri,source_locator,source_period,lower,upper,range_basis,notes
```

Unknown cells remain blank in their evidence fields. Registration does not run the existing population helper and does not substitute the table's provenance for missing scientific evidence.

Registering evidence first saves the exact current working revision. Any unapplied bulk-citation fields must first be applied to their selected rows or explicitly cleared; registration rejects them so they cannot silently disappear from the CSV. The queued registration then reads only that immutable revision, so later keystrokes cannot change its CSV. It retains:

1. The exact original registration request and timestamp.
2. Complete working history, including imported ancestry.
3. The complete current editable draft.
4. The original 13-column UTF-8 evidence CSV.
5. An ordinary `upstate.sources/v1` manifest.

The source entry's URI identifies the authored workspace revision. Scientific citations remain the actual source title/URI/locator/period in each cell. The working history and draft are original source companions. `Workspace.import_sources` retains all three files through its normal content-addressed source bank.

The unchanged native `preview_evidence` validates that ordinary retained CSV, followed by `save_evidence` and an exact result comparison. Missing citation pairs, incomplete ranges, a central value outside its proposed endpoints, incorrect units or load type are rejected by the original engine. The complete working revision remains available to correct and save again. Retrying the same registration request recovers its original source, time, evidence and result.

Accepted evidence appears in the existing evidence selector and source catalog. Continue with the original selected endpoint profiles, experiment preparation, native run and report workflow. Range labels mean sourced parameter endpoints; they do not assert confidence intervals or best/worst environmental outcomes.

## Scientific meaning stays with the original model

Nutrient coefficient loads retain the native kg/ha/year units and original load type. For application inputs, the original InVEST workflow applies load × (1 − efficiency) internally. This editor neither pre-reduces those coefficients nor relabels measured runoff as application inputs.

NDR annual nitrogen and phosphorus outputs are delivered-to-stream loads in kg/year. SDR annual sediment is delivered-to-stream tonnes/year. They are not intake concentrations, removal guarantees or water-treatment savings. Parameter efficiency/proportion values, critical lengths and USLE factors retain their exact original units and allowed domains.

The customer project keeps its upstream model domain, South Carolina reporting mask and utility/intake anchors separate. The agreed RFP 30 m GIS selection remains the original source choice. Tim and Ecosystem Sciences retain scientific direction, methods, interpretation and the client relationship.

## Complete download, import and receiving

Download the complete named history for a saved revision. The package contains its entire original chain, not just the latest form fields. Imported ancestors remain inside that package. The companion current-draft JSON is convenient for editing, and the working CSV is explicitly labelled because it can contain unfinished evidence.

A plain authoring draft JSON can be opened and saved in its original source context. Importing a complete native package creates a new series with the full original chain retained. Both routes validate the exact original workspace/profile/table and fixed rows before any saved descendant.

A complete native package is limited to 16 MiB of canonical UTF-8 JSON, including history and imported ancestors. This bound is checked before acknowledging a new revision so that every saved revision remains exportable and reopenable. The existing operator limits the complete JSON action envelope to 4 MiB; the browser measures its actual encoded payload. Retain a local download if a larger request cannot use that route. The native CLI can save the same complete request within the native package limit.

Scientific workspace archives already capture these retained working records, registration requests, source companions and operation contexts. All mutations use the original workspace lock so archive capture observes a coherent version. The portable receiver additionally verifies every original revision chain, imported package, fixed source binding and completed registration through the native evidence engine.

Temporary task transport under the operator's own directory is not a scientific archive dependency. The original request required for recovering an authored revision is retained inside the scientific workspace itself.

## Native CLI

Run from the received application directory using its original Python environment:

```sh
python -m model.biophysical_evidence_authoring --workspace /path/to/original-workspace list --profile PROFILE_ID
python -m model.biophysical_evidence_authoring --workspace /path/to/original-workspace inspect --revision REVISION_ID
python -m model.biophysical_evidence_authoring --workspace /path/to/original-workspace save --request save-request.json
python -m model.biophysical_evidence_authoring --workspace /path/to/original-workspace register --request register-request.json
python -m model.biophysical_evidence_authoring --workspace /path/to/original-workspace export --revision REVISION_ID --output new-working-history.json
```

The export creates a new file exclusively, flushes its bytes and synchronizes the destination parent before acknowledging it.

Save request:

```json
{
  "request_id": "original-client-request-uuid",
  "series_id": "original-working-series-uuid",
  "parent_id": null,
  "draft": {}
}
```

Replace `draft` with the complete original authoring JSON. For a later revision, use the actual current parent ID. To fork a full native history, include `imported_package` with the complete original package and choose a new `series_id`; the draft can contain the intended new edits while retaining that package's exact source binding.

Registration request:

```json
{
  "request_id": "original-registration-request-uuid",
  "revision_id": "SELECTED_SAVED_REVISION_ID",
  "title": "Regional coefficient source review",
  "note": "Actual scope and reason for this source edition."
}
```

Use one original request identity for recovery. A changed request body requires a new identity.

## Existing operator integration

Reads use authenticated selected-workspace POST routes:

| Route suffix under /api/profile-workbench/biophysical/ | Selection | Result |
| --- | --- | --- |
| authoring-list | profile_id | Named series and actual head identities |
| authoring-inspect | revision_id | Complete selected draft and original history summaries |
| authoring-export | revision_id | Complete package and original download tickets |

Mutations remain ordinary queued `/api/actions` operations:

| Action | Payload | Result |
| --- | --- | --- |
| profile.biophysical.authoring.save | request_id, series_id, parent_id, draft, optional imported_package | Saved immutable record and history |
| profile.biophysical.authoring.register | request_id, revision_id, title, note | Original source registration and native evidence |

Read routes receive the existing viewer classification. Mutation actions retain the existing analyst authorization. Downloads use original verified-file tickets; no arbitrary file path is supplied by the browser.

The original `install_profile_workbench.py` includes the authoring model, both browser modules, the existing browser integration, manifest and this guide. It composes the additional portable verifier and read-route access entries into the received application while retaining other installed extensions.

## Original receiving course and full owner brief

Continue the existing Eco scientific/native report operation; keep its actual saved profiles, source collections, workspaces and report outputs. C8FF/RQ13 explicitly identified this authoring gap in the original Sales programme at reply 1791910332.164719 under parent 1791724121.853269. Their coefficient evidence/report engine remains the scientific authority. The actual original receiving handoff is 1791904720.671269, with source completion 1791906918.898379. Its retained 262-file application source is `operations/eco-coefficient-reports/coefficient-ensemble-report-source-20261013.source.json` at commit `8c378791f95a2d14136fe1b42b0ab81aadddd46c`; the original course guide is `operations/eco-coefficient-reports/COEFFICIENT_ENSEMBLE_RECEIVING_20261013.md`. Pass this course's actual newly registered `evidence_id` to `source_tools/receive_ensemble_coefficient_report.py --evidence-id` on the same original profile/ensemble, retaining any selected range and base report edition. This avoids its default evidence-population branch. B43A/Flowable retain regional evidence acquisition, including WO10.

Tim must be able to run his own real data, retain recognizable names and organization, use ordinary scientist-facing forms and read useful answers. Original JSON remains an optional download. Tim retains parameter choices and scientific interpretation. The authoring view shows the original profile and table titles before expandable technical IDs.

Every native handoff must include the complete current repository files `AGENTS.md` and `CURRENT_OWNER_DIRECTION.md` (version 2026-10-13.4), plus the complete 52-work-order bank Slack Canvas F0C8R2SQ0NP. These are the full briefs to carry through receiving, not an abbreviated approval note. The current original source and any newer direct owner instruction take precedence.

Operate this whole authoring course in that same received case:

1. Open the exact saved profile and original table, then enter unfinished citation and endpoint text in more than one cell.
2. Save a named revision, navigate away and reopen it. Check every raw field, selection and source identity.
3. Open an earlier revision, fork with edits, and confirm the prior chain remains available. Exercise an interrupted request with its same identity and a competing-tab changed parent.
4. Import a CSV preview, make a separate edit before applying it, and confirm the old preview requires reinspection. Review the exact resulting cell changes.
5. Register completed evidence from the saved revision, inspect the ordinary original CSV and full working companions, and open the original evidence/range/report views.
6. Download and reopen complete history and scientific workspace; preserve all prior working revisions and original native outputs.
7. Look at the actual desktop and narrow 390 px interfaces, key controls and every outgoing downloaded attachment. Return actual rendered frames for the authors to inspect, including recovery, long citations and completed registration.

Keep the normal working product moving while the original equipped receiver operates its saved case. Repair concrete returned issues in the maintained source. Do not replace the scientific product with verification reports or duplicate model runners.
