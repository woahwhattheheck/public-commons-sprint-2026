# Recover the five retained field report editions

This chapter restores the five already-produced readable field reports when the producer's physical report directory is no longer available. The original saved field campaign, its two QC reviews, its three action reviews and its complete historical records remain in the same Workspace. The recovery uses the exact frozen renderer source and original successor recipe to reproduce the same five report identities, then admits those editions through the existing field presentation adoption operation.

The result is a usable continuation of the current project: inspect the recovered editions, capture the explicit presentation selection, include it in a fresh complete-project archive, restore that archive and operate the original field and QC controls against the chosen readable reports. Keep the original report bank, source records, plan revisions and decisions alongside their presentation successors.

**Needs expert review.** Programme criteria, scientific interpretation, monitoring decisions and use of demonstration data require the responsible scientific reviewer. Recovery preserves the already-recorded values and decisions. A reproduced presentation identity does not make a new scientific judgement or change the applicability of the original criteria.

## Begin with the original completed operation

Use the original completed field operation and a full, restored Workspace for that project. Read its native field-operation receipt to obtain the full operation identifier. Keep the same project and plan identifiers throughout recovery, archive creation and browser receiving. Short labels used in correspondence are references to that operation; pass the actual full identifier to the software.

The following inputs must be available together:

| Input | What the recovery needs |
|---|---|
| Full original Workspace | The completed field campaign, original five saved reports, their original source files and the complete plan revision history through those reports. |
| Exact original source bank | The decoded 156,190-byte XPF source bank identified below, including both frozen renderers, the original recipe and handoff receipt. |
| Original field operation ID | The full identifier returned by the completed campaign in this Workspace. |
| Separate recovery directory | A private ordinary directory outside the Workspace and outside any directory that contains the Workspace. Its first use is new; subsequent calls resume the same retained request. |
| Optional original adoption receipt | The exact already-admitted receipt bytes when continuity with that receipt-based adoption operation is required. |
| Presentation selection output | A new explicit JSON selection file for the existing native producer and browser continuation. |

A collection of final HTML files alone is insufficient for this operation. The action renderers read retained plan and decision history, and the native source inspections verify all companions. Restore the complete original project rather than copying selected files into an unrelated project.

Use the interpreter and installed application that already operate the restored Workspace. Run the commands from that application's root so `model.field_report_recovery` imports the maintained native modules. Replace the capitalised values in the examples with paths and identifiers from the current original operation.

## Identify the exact frozen source

The source bank is a complete JSON file. Preserve its bytes when decoding or receiving it; reformatting JSON changes its identity.

| Original source | UTF-8 bytes | SHA-256 |
|---|---:|---|
| Complete source bank | 156,190 | `8d039e6ccba9852ea4325baa178d62c14226b379b555cf0eb3adfa11bb25ec03` |
| Frozen QC renderer, `model/implementation_qc.py` | 36,026 | `d4fa4e0ba5216dc78dbdd5af32e10b699167944807c68f8950e2a8c3f00254f7` |
| Frozen action renderer, `model/implementation_qc_actions.py` | 34,075 | `957266556ff0ab17f7f29dc3e2654fe857bf07f7c96ba1f017cc84e7605f8b4a` |
| Original `render_actual_packets.py` recipe | Retained in the bank | `d1a460dda4a7cae62fd42e337db53c09c6a8a5d852b8f4092c5609cb8bf8729d` |

The helper verifies the complete bank and both executable renderer bodies before loading them. It also verifies the original recipe and receipt structure. Do not substitute the current renderer from the installed application's main branch: current software can contain later presentation changes, while this recovery is specifically reproducing the five previously issued editions.

The frozen renderer is loaded as a separate native module from the private recovery directory. The installed application's maintained adoption, report inspection, source handling and Workspace operations remain in use.

## Choose the receipt deliberately

The optional `--receipt` argument controls receipt-based continuity.

When an adoption receipt was already admitted for this exact operation, provide that same original file without reserializing it. The recovery retains its byte length and SHA-256 and uses those bytes in the recovery identity and native adoption. This preserves continuity with that receipt-based adoption operation.

When no such original receipt is being supplied, omit `--receipt`. The helper uses the exact `handoff-receipt.json` contained in the frozen source bank. It selects the same five previously produced report identities. Because the receipt bytes can differ from an earlier producer receipt, its receipt-based adoption operation can have a different identity.

Both forms must carry the same complete original native report descriptors, renderer provenance and owned field-context metadata. Extra transport annotations in the combined handoff do not permit a changed report selection or altered source provenance.

Choose the receipt before the first call. A recovery directory is bound to those exact bytes. Changing the receipt on a retry is an identity change, even if a JSON editor displays apparently equivalent fields.

## Recover and capture the presentation selection

The normal complete command is:

```sh
python -B -m model.field_report_recovery recover \
  --workspace ORIGINAL_WORKSPACE \
  --field-operation ORIGINAL_FIELD_OPERATION_ID \
  --source-bank EXACT_DECODED_SOURCE_BANK.json \
  --output NEW_PRIVATE_RECOVERY_DIRECTORY \
  --receipt EXACT_ORIGINAL_ADOPTION_RECEIPT.json \
  --selection-output NEW_FIELD_PRESENTATION_SELECTION.json
```

Omit the complete `--receipt` line when using the bank's original handoff receipt. Keep the other arguments tied to the same original project.

The output directory must be separate from the Workspace: neither may contain the other. This keeps reconstruction candidates and private source copies outside the original project's report bank until the complete five-report receiving operation is ready.

The command does the following as one retained operation:

1. Verifies the source bank, receipt, original campaign and exact five-report selection.
2. Inspects every original report and records its complete native file inventory.
3. Records all original plan revisions through the selected reports and requires that history to be continuous.
4. Copies those exact inputs into the private recovery context and retains the two frozen renderer files.
5. Reconstructs each expected successor from its original saved review.
6. Verifies all five expected report manifest identities and runs the original native pair inspections and adoption preflight.
7. Adopts the verified five editions through the existing native adoption API, records completion and, when requested, captures the explicit presentation selection.

For each report, reconstruction changes the readable `report.html`, its `observed-report.json` descriptor and its native scientific-source descriptor, then reproduces the original presentation manifest. Other report members are copied byte for byte from the retained original inventory. The presentation scope is the already-produced HTML wrapping and locally scrollable tables; QC/action and plan bodies remain their original bytes.

The first mutation of the original report bank occurs after every expected candidate identity has passed. A candidate with a different manifest is retained for inspection instead of being chosen as an alternative report edition.

## Read the result before continuing the archive

A successful result has schema `upstate.field-report-recovery/v1` and `status: "complete"`. It includes:

| Field | Meaning |
|---|---|
| `operation_id` | Identity of this retained recovery request. |
| `project_id`, `field_operation_id`, `plan_id` | Exact original native project, completed campaign and plan. |
| `source_bank_sha256`, `receipt_sha256` | The admitted source and receipt byte identities. |
| `expected_report_ids` | All five previously produced successor report identities. |
| `adoption_operation_id` | The native adoption operation used for the five recovered editions. |
| `presentation_id` | The explicit original presentation selection identity. |
| `adoption` | Full native adoption result, including its original receiving information. |
| `presentation` | Complete explicit native presentation selection. |

Use `presentation_id` when handling the selection. The selection's identity field is not a generic `id`.

Keep the full command result with the current operation's receiving record. The optional selection output is produced through the existing native capture function, using that complete `presentation` selection and the same original field operation. It is suitable for the existing archive and browser interfaces described below.

A command completing source recovery and adoption proves the retained receiving result. Record producer inspection of the actual rendered reports and controls separately, with the exact outgoing source and archive edition.

## Inspect, resume and preserve interruption history

Inspect an existing recovery with:

```sh
python -B -m model.field_report_recovery inspect \
  --workspace ORIGINAL_WORKSPACE \
  --output SAME_PRIVATE_RECOVERY_DIRECTORY
```

Inspection rechecks the request, exact bank and receipt, original source inventories and retained native report inspections. For a completed recovery it also reopens the native adoption and compares the full result with `completed.json`.

A valid unfinished recovery returns `status: "recovery_incomplete"`, the expected five report IDs and the candidate report IDs already verified. Its CLI exit code is 2. A complete recovery returns exit code 0. A damaged or changed member raises the native error rather than becoming a normal incomplete result.

Resume by repeating the original `recover` command with the same Workspace, field operation, exact source bank, exact receipt and output directory. The helper reuses unchanged retained copies and verified native records. An identical completed request returns the same completed native result. If `--selection-output` was omitted earlier, it can be supplied on the same completed recovery to capture the selection through the existing native function.

Recognized remnants of interrupted initial atomic writes are kept in private staging when the current implementation can identify them as belonging to this exact source/request. Preserve that history and resume the same request. Unrecognized content, changed complete bytes or a directory owned by another request is an error; do not clear the directory to force acceptance.

The source input inventory remains authoritative on retry. Later unrelated plan work may remain in the Workspace, but the original retained reports and the recorded historical source bytes must still be available unchanged. If receiving discovers missing original history, obtain the complete original archive from the existing operation and restore it through the maintained Workspace receiving path before resuming.

## What stays in the private recovery directory

Retain the complete directory until the final project and receiving material have been handed over. Its principal files are:

| File or directory | Retained purpose |
|---|---|
| `source-bank.json` | Exact admitted frozen source bank. |
| `receipt.json` | Exact chosen receipt bytes. |
| `original-inputs.json` | Full original report inspections, historical revisions and byte inventories. |
| `request.json` | Source-bound project/operation identity and original five-report selection. |
| `frozen-qc.py`, `frozen-actions.py` | Verified original renderer bodies used for reconstruction. |
| `context/` | Exact copied original report/history files and the five reconstructed successor directories. |
| `verified-candidates.json` | All-five selection and complete successful native pair inspections. |
| `completed.json` | Completed recovery and full native adoption/presentation result. |
| `private-staging/`, when present | Preserved recognized partial source/request writes from interruption recovery. |
| `context/mismatch-EXPECTED_REPORT_ID.json`, when present | Expected and actual manifest identity for an unsuccessful candidate. |

A mismatch leaves the candidate's complete files available beside its explicit mismatch record. Compare the exact original source inventory, recipe and receipt to diagnose it. The native original report bank remains unchanged by an unsuccessful preflight. Do not adopt the candidate under its newly computed identity or replace the frozen recipe simply to obtain a successful-looking result.

The external recovery context stays where it was created. Native adoption retains the exact report editions in the original Workspace; it does not move or expose the private reconstruction directory.

## Continue the existing native project archive

Pass the completed result's full 64-character `adoption_operation_id` to the original native producer's `--field-presentation-adoption` option. This flag takes the native adoption operation identifier, not the captured selection file. Pass the path of `NEW_FIELD_PRESENTATION_SELECTION.json` to the original browser's separate `--field-presentation` option. Retain the full recovery result and presentation selection alongside both commands, including their exact operation, presentation and report identities. Follow the current producer guide for the remaining original project and archive arguments; retain all already-selected scientific, field, customer and comparison sources.

The readable editions do not change the plan revision. Archive identity must therefore bind the explicit completed adoption and both original/readable report inventories, historical revisions and retained adoption journals. The maintained field adoption archive continuation supplies that binding. Use it to create a fresh complete-project edition rather than reusing an older archive solely because the plan revision is unchanged.

Preserve prior archives and their original receiving records. The new complete project carries both original report banks and their selected presentation successors. After normal whole-Workspace restore, inspect the native adoption and explicit presentation selection in the received project before the recorded browser journey. The separate recovery directory can also be retained for forensic source continuity; it is not a replacement for the normal complete-project archive.

The related maintained guide is [Field report adoption](FIELD_REPORT_ADOPTION.md). It explains the explicit adoption selection, archive identity and native receiving commands. Use its current original producer contract instead of reconstructing command flags from an earlier handover.

## Operate the outgoing product

Continue the existing field/QC recorded course with its explicit `--field-presentation` selection. The standalone and borrowed-page forms are described in [Simulated fieldwork browser](SIMULATED_FIELDWORK_BROWSER.md). Keep the original current recording owner, original Workspace and same completed campaign.

Open the original review and history first, then the chosen readable edition for each of the two QC and three action reports. The original saved-file link is labelled `report.html`; it opens the readable report in a separate tab and retains the editable plan and local draft. Exercise the report's original JSON/CSV companions, the original native exports and Print, then repeat the relevant report controls in a fresh browser and with the exported files. For a retained QC comparison, its existing original-review ZIPs and companion navigation remain part of that comparison's own unchanged source course.

The producing author must personally view and operate the actual outgoing version. Inspect all attachments and media supplied with that version, including every relevant report, source table, image and recording. At desktop and approximately 390-pixel width, check source headings, values, units, wrapped text, locally scrollable tables, buttons and companion links. Read the actual print output and reopen the final downloaded report/package independently. A generated screenshot list or a successful queued task is not a substitute for inspecting the pixels and using the controls.

Retain actual viewed screenshots and the exact final media with the operation. Use the final source and receipt identifiers in the handover so another person can distinguish an earlier successful run from the current outgoing edition. Use the complete current owner brief at [CURRENT_OWNER_DIRECTION.md](../CURRENT_OWNER_DIRECTION.md), version `2026-10-13.3`, and pass it with all relevant attachments to every downstream author or receiving seat; pass newly consumed directions onward in the same operation. For the current sprint, the original final delivery cutoff is 14:00 UTC on 13 October 2026. Coordinate the existing producing and receiving stages against that time and retain actual completion times.

If a concrete display or receiving error appears, preserve the original source, exact exception, selected report ID and failing outgoing edition. Repair the responsible maintained source with its current owner, then continue the same recorded journey and produce the corrected final handover. Keep the earlier retained evidence available for comparison.

## Native Python API

Applications already holding the original Workspace can use the same functions:

```python
from model.field_report_recovery import recover_presentations, inspect_recovery

result = recover_presentations(
    workspace,
    original_field_operation_id,
    exact_source_bank_path,
    separate_recovery_directory,
    receipt_path=exact_original_receipt_path,
)
checked = inspect_recovery(workspace, separate_recovery_directory)
```

Pass `receipt_path=None` to select the frozen bank's handoff receipt. Do not reconstruct the `presentation` object from report labels: carry the full returned native selection. Use the existing presentation capture and adoption archive interfaces for downstream receiving, preserving all unrelated original archive-selection fields.

The helper's operation identity is derived from the original project, completed field operation, exact source-bank identity and receipt bytes. Its retained inventory separately binds the complete original report/history content. Those two forms of continuity let the existing native operation resume while keeping the actual source and the issued report edition distinguishable.

## Handover record

The completed same-operation handover should give the receiver the normal complete-project archive, its current source edition, the actual recovery/adoption/presentation identifiers, all five exact recovered report IDs, the selected original receipt identity and the explicit presentation selection. Include the current operating guides and actual producing-author browser/print/media observations.

The receiver should be able to restore the project, open its original records and decisions, inspect the retained adoption, read every selected successor with its original companions, and continue the editable native project. The exact frozen recovery source and retained private reconstruction record explain how the already-issued presentations were recovered if that history is needed later.
