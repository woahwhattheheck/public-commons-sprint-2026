# Receive the original Central programme as two actual reporting periods

This continuation uses the same released Central service, original full capture, source store and commissioning engine. It runs after the original fixture creator and five-root receiver. No second Central instance or capture controller is started.

## One existing host command

Use the complete published source and the existing DCE4 host configuration:

~~~sh
python3 odk/native/run-released-fixtures.py \
  --host-config /private/central-host.json \
  --work-directory /srv/central-cb57/receiving
~~~

The Python launcher supplies only the original environment reference and selected CA to the installed Node process. It runs fixture creation, complete native receiving, then the two-period continuation in sequence. The same command and directories recover the original request.

The separate continuation entry is useful when the first two phases already completed:

~~~sh
node odk/native/receive-released-periods.mjs \
  --request /srv/central-cb57/receiving/provider/period-receiving-request.json \
  --directory /srv/central-cb57/receiving/workspace \
  --output /srv/central-cb57/receiving/receiving/commissioning \
  --restore /srv/central-cb57/receiving/restored-workspace-commissioned
~~~

Use the actual request generated from the original result. Its connection ID, workspace ID, project ID and full capture ID are exact saved identities.

## Actual source boundaries

The completed full capture already contains the three simple rows and their complete original OData response pages. The continuation reads the original row `__system.submissionDate` value, checks it against its original page and saves both the raw provider text and the normalized supported UTC millisecond value.

| Period | Native rows | Exact predicate |
| --- | --- | --- |
| Initial native submissions | one, two | Earliest observed time of these roots ≤ submissionDate < root three’s observed time |
| Following native submission | three | Root three’s observed time ≤ submissionDate < its next supported millisecond |

The first two observed times must precede the third. The actual native query must return exactly those original rows. A source clock or intervening edit that changes that selection remains visible in the retained source and original interrupted operation. The continuation does not backdate XML, invent business dates or replace a provider response.

The agreement records these as released-source receiving periods. It states that source capture reads the current available values and retained versions for the selected submission-time cohort. It does not reconstruct a historical server state.

## Whole commissioned delivery

The caller opens `openCentralCommissioning` on the same workspace and invokes the existing operations:

1. Inspect the actual authorized project and forms.
2. Save the complete source/report agreement with a fixed draft request.
3. Prepare and install two immutable native plans.
4. Capture or resume the original request for each period.
5. Inspect the entire native source, row identities, original values and source quality.
6. Save the authored acceptance against the exact original revision/content hash.
7. Call the original complete commissioning handover.
8. Verify every original dataset/report file.
9. Restore and reopen the full archive in the independent receiver.

The selected simple output includes `__id`, `name`, `age` and `__system/submissionDate`. The original exporter retains each value/state pair, native keys, complete dictionaries and original source receipts. The first original report has 2 rows, mean age 32 and sum 64. The second has 1 row, mean age 38 and sum 38. The native comparison keeps both disjoint cohorts and their complete change rows.

The earlier full capture remains part of the same portable workspace: all five roots, root/repeat tables, four published form versions, six submission versions and two original fixture attachments.

## PostgreSQL receiving

The retained `warehouse-selections.json` includes:

- Current original `sourceWorkspace` and workspace ID.
- The original commissioning and complete delivery IDs.
- Both selected capture IDs and their accepted review IDs.
- Native `datasets[{period,id,captureId,tableId,files,receipts}]`.
- Period labels and fixed approval, mapping-review, import and report request IDs.

The same-Store warehouse bridge uses these exact selections to issue its original accepted-source approval. The existing Python receiver reads the approved `dataset.csv` physical value/state columns and their original dictionary. It verifies all native export receipts and retains the source alongside the reviewed SQL mapping.

Its global PostgreSQL connection/schema options precede the native commands `central-inspect`, `central-review`, `central-import` and `period-report`. The original accepted host/profile supplies the database connection. `--source-workspace` must select the current actual Central workspace. Mapping review, import and period report use the saved request IDs; a repeated command resumes those same original operations.

The consumer’s complete contract is [the existing PostgreSQL guide](../../../sf88-operator-buyer-cli/python/POSTGRESQL.md). Host/source selection must use the maintained whole dependency closure containing that consumer.

## Retained recovery

The native journal pins the whole original request, fixture source, observed boundary, agreement IDs, period plans, capture requests and every authored review boundary. A lost source-review response is reconciled at its saved decision index and exact body. A later review is never replaced. Comparison includes the complete decision prefix ending at each originally selected accepted review, so a later live review does not change the archived receiving selection. The whole capture’s sourceReviewId comes from its original completed receiving receipt.

The commissioner retains each complete output before archive generation. The same delivery ID resumes its original output selection, including an interrupted archive. The restorer recognizes the actual original archive SHA and workspace identity and preserves later receiving work.

The received commissioner reports `RECEIVED_PORTABLE` from its original archive metadata. The caller compares the full selected source histories and every approved output byte identity. It writes its complete result only after the source and receiving workspace owners close.

Keep `period-receiving.json`, `native-period-boundary.json`, `source-report-agreement.json`, `commissioning-delivery.json`, `warehouse-selections.json` and `result.json` with the original host operation. The complete workspace archive already carries the agreement, source observations, original captures, reviews and output files.

## Direct source API

~~~js
import { receiveReleasedCentralPeriods } from './native/receive-released-periods.mjs';

const result = await receiveReleasedCentralPeriods({
  connection: originalConnection,
  operationId: originalOperationId,
  sourceCaptureId: completedWholeReceiving.ids.capture,
  sourceReviewId: completedWholeReceiving.reviewId,
  expectedWorkspaceId: completedWholeReceiving.workspaceId,
  projectId: actualProjectId,
  directory: originalWorkspaceDirectory,
  outputDirectory: retainedPeriodReceivingDirectory,
  restoreDirectory: independentReceivedDirectory
});
~~~

The connection includes the original whole capture’s exact `id`. The continuation borrows the same underlying Store through the original commissioning opener, closes it before the original archive restore, and closes the reopened receiver before returning. It does not launch a browser or another provider server.
