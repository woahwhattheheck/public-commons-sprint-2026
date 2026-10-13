# Returned worksheets against a current Directory edition

This operating course uses the completed `OPERATED_DIRECTORY_WORKSHEETS.json` result and the full editable workspace identified in that result. It operates the original returned worksheet against later accepted editions in a distinct workspace. The original worksheet course uses the retained published HSDS CSV and JSON sources, with clearly authored local customer proposals.

## Run the complete native course

Use the existing source tree with the merged Directory reconciliation feature. Select absolute paths and the SHA-256 of the complete worksheet result.

```sh
python3 -B operate_correction_worksheet_reconciliation.py \
  --worksheets /absolute/worksheet-output/OPERATED_DIRECTORY_WORKSHEETS.json \
  --worksheets-sha256 ACTUAL_COMPLETE_RESULT_SHA256 \
  --archive /absolute/worksheet-output/Directory_Worksheets_Complete_Editable_Workspace.zip \
  --workspace /absolute/reconciliation-workspace \
  --out /absolute/reconciliation-output
```

The selected workspace must differ from the original worksheet workspace. Its original workspace UUID stays the same. The archive must match the completed result's exact bytes and SHA-256. The receiving record allows the same selected operation to resume after interruption while preserving later local work.

If the original worksheet result has not been produced in the selected environment, first run the complete `operate_correction_worksheets.py` course from the original Directory result and its editable packet. The original course instructions are in `CORRECTION_WORKSHEETS_OPERATING.md`. The complete programme carries those inputs and the full maintained source together.

## What the course does

The initial customer return was authored against the original selected edition. The worksheet course then accepted a multiline CSV description and a JSON description of explicit null, followed by a second JSON correction that removed that field. This makes the later current edition useful for an actual three-way review:

| Original customer change | Original value | Proposed value | Current value | Expected comparison |
| --- | --- | --- | --- | --- |
| CSV description | Published description | Full authored multiline text | Same full authored text | Already applied |
| JSON description | Published string | Explicit null | Field absent | Conflict |
| Authored numeric field | Absent | Numeric token `1.20` | Absent | Proposable |

The course reads the actual accepted correction source maps to select the current source members and original row pointers. Every original worksheet row receives an explicit binding with its complete original and current references plus a recorded reason. These selections are particular to the retained source lineage of this course. The product requires the operator to select its own current bindings.

The native operation then:

1. Receives the full original worksheet workspace and retains all immutable baseline record hashes.
2. Prepares the complete original/current comparison with full row bindings and every original proposed change.
3. Reads every comparison through the native page route and its complete retained file.
4. Records a full keep-current review with no correction plan.
5. Explicitly accepts the conflicted JSON null and the clean numeric token. Every other proposal receives its own keep-current decision.
6. Previews and accepts the exact resulting ordinary correction plan against the selected current edition.
7. Exports the complete reconciliation and decision package.
8. Prepares another comparison against that newly accepted edition, retaining the same original customer return.
9. Authors one complete JSON row resolution. It preserves the current object and its numeric token, changes its description, and marks every original proposed change on that row as resolved by the complete row.
10. Separately previews and accepts that second correction, continuing the actual first correction.
11. Reopens the exact prepared requests and checks that their original record identities are reused.
12. Exports the complete editable workspace, receives it into a fresh customer workspace, closes and reopens it, and replays the original requests there.

Whole-row resolution is explicit. It retains the full authored object or CSV physical cells and the reason for replacing that selected current row. Current fields outside a granular accepted change remain current. The standalone review records remain available even when every change is kept.

## Complete outputs

The output directory retains:

- `OPERATED_DIRECTORY_WORKSHEET_RECONCILIATION.json`: the actual completion result, original input identity, initial current edition, final accepted edition, complete preparation and review records, two correction cases, replay requests, exports and restored customer.
- `WORKSHEET_RECONCILIATION_JOURNEY.json`: exact prepared requests, their returned records, source identities, complete file identities and any interrupted operation.
- `Original_Directory_Worksheet_Receiving.json`: the unchanged complete input result.
- `WORKSHEET_RECONCILIATION_SOURCE.json`: full source identities used for the native operation.
- `evidence/`: original/current selections through actual accepted source maps, typed three-way values, complete package members and source-preservation reports.
- `records/` and `reconciliation/`: full immutable records and complete original comparison, binding, input and decision files.
- `exports/`: complete reconciliation and ordinary correction packages.
- `Directory_Worksheet_Reconciliation_Complete_Editable_Workspace.zip`: the full source-defined editable application workspace.
- `received-workspace/`: the separately received and reopened complete customer workspace.

The result's `workspacePacket` identifies the producer's full exported packet. Its `restoration` identifies the separate fresh customer receiver. The following browser/Merchant/customer course returns the customer's own final packet as its `workspacePacket`, and keeps the producer packet separately.

Mutable acquisition journals and receiver-local receipts keep their source-defined semantics. All other baseline and exported record bodies are checked completely; their original source, row, comparison, decision and file bytes travel in the editable archive.

## Resume the original operation

Repeat the exact command with the same source, input identities and absolute paths. A private operation lock prevents two native writers from using the same output. Each request is retained before dispatch. Completed requests reuse their actual returned original record; an interrupted immutable request is replayed with the same body.

A completed original archive receive is reopened directly, preserving the later progressed workspace. Incomplete exported bytes are retained under their own hash before rebuilding the same derived export. Files already written must retain their complete original identity.

After a successful native result, use `operate_correction_worksheet_reconciliation_clients.mjs` and its full client guide to operate the independent offline customer editor, operator review, Merchant history, typed SDK and complete fresh customer receiving.
