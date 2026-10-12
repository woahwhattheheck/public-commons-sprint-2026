# Publish retained Analysis work to OpenLineage

The existing Analysis workspace can review a completed import, query, complete query export or workbook and publish its retained lineage through the original OpenLineage producer. The operator freezes the exact event bytes and destination workspace before sending. The original Analysis job owns the publication, including local cancellation, an interrupted response, same-request continuation and the accepted collector receipt.

Open the **Lineage** link in Analysis. The page is part of the same numeric-loopback server and uses its existing capability. It preserves the original Research, response-mapping, dataset, query, workbook, synthesis and backup operations.

## What the publication means

A publication describes work that already completed in the selected Analysis workspace. It reads the original records and verified files. Reviewing or publishing lineage does not rerun a query, import, purchase, model or workbook.

| Original completed operation | Projected input and output |
| --- | --- |
| Dataset import or response import | Exact retained source-manifest digest to the original immutable SQLite version. The original import/preview identity and incomplete-response acknowledgement remain visible. |
| Query | Actual native read tables and their immutable versions to the saved query preview. Its result digest, saved row count and truncated flag distinguish that preview from a complete export. |
| Query export | The original reviewed query and source bindings to the complete native export. The original export reader verifies the retained files, SQL, parameters, view selection and manifest. Its own completed read transaction supplies the actual read tables and immutable source-version records. Its data inputs are the immutable versions, not the preview rows. |
| Workbook | Actual retained query-export or report-publication sources to the workbook revision, definition, sheet mappings and files. Original report-publication identity is retained; this producer does not invent its internal ancestors. |

Each included completed job supplies a START and COMPLETE event using its original recorded timestamps. The events explicitly mark this retrospective projection. Run IDs are the original 32-character job IDs in UUID notation. Dataset names use original immutable version, query, export and workbook IDs inside the original Analysis workspace namespace.

The reviewer sees source and output hashes, actual row scope, source mappings, known dependencies and any missing or ambiguous earlier writer. A version imported outside the retained Analysis jobs can still be an exact source dataset. It does not acquire an invented Analysis import run.

The default outbound source contains operational metadata, column names and digests. It excludes parameter values and result rows. **Include original SQL text** adds the original SQL only when explicitly selected. The full local handover retains native job requests/results and source manifests, so the review and its recorded provenance can be reconstructed.

## Configure an original collector

Use the existing OpenLineage workspace and its producer endpoint. The original application lives at:

~~~text
stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/
~~~

Its maintained CLI supports a separate operator token and producer token:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/openlineage-workspace/cli.mjs \
  serve --workspace /absolute/private/collector --port 8767 \
  --token-file /absolute/private/operator.token \
  --producer-token-file /absolute/private/producer.token
~~~

Select the original collector's saved `connection.json` file. It contains the actual `commons.openlineage.startup.v1` identity, including its workspace ID, current instance ID and URL. The Analysis connection pins the workspace ID. It reads the current saved startup file for every attempt. A restarted instance can change its port on the same numeric-loopback host and protocol while preserving the same publication. A changed scheme, hostname or non-loopback origin is rejected before dispatch and requires a newly reviewed destination. An unresolved publication should first be reconciled at its original destination. The bridge checks the actual startup-file URL again, so a file change between local preparation and dispatch cannot change this destination policy.

Create a private launcher configuration:

~~~json
{
  "schema": "stellar-forge.analysis-lineage-connections.v1",
  "connections": [
    {
      "name": "operations",
      "label": "Operations lineage",
      "connection_file": "/absolute/private/collector/connection.json",
      "expected_workspace_id": "COPY-THE-ORIGINAL-COLLECTOR-UUID",
      "token_file": "/absolute/private/producer.token",
      "request_timeout_ms": 30000
    }
  ]
}
~~~

The example UUID is a placeholder. Copy the exact canonical UUID from the selected original startup file. Connection and token file paths must be absolute. A producer token follows the original CLI's trimmed-file convention, with at least 24 characters and no embedded CR, LF or NUL. The bridge requires a caller-owned token file without group/other permission bits on Unix. Request files are created by the original private Analysis storage helpers.

A named profile exposes only its label, collector workspace, safe current endpoint, timeout and token-configured state in the browser. The profile's token and file paths remain server-side. A producer-only token does not require operator metadata access: the bridge submits directly through the original `LineageClient.emitSource`.

Launch the existing Analysis workspace with the selected full runtime:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis \
  --checkout /absolute/selected/runtime \
  --lineage-connections /absolute/private/lineage-connections.json \
  serve --port 0 --open
~~~

The runtime includes the original SF88 CLI, Python modules, `python/analysis-lineage-bridge.mjs`, and the original `sf30-seller-sdk/openlineage-workspace/client.mjs`. Existing Research connections may be supplied through the unchanged `--research-connections` option.

The collector profile is optional. Saved plans, receipts and handovers remain readable with no configured collector or Node runtime.

## Review, freeze and publish

1. Choose an original completed operation. The list is paginated; an exact retained job ID can also be entered.
2. Review the verified dependency closure. Inspect the jobs, input/output datasets, original timestamps, query-preview scope, complete output manifests and source warnings.
3. Select the named collector and record the review title/note. Decide explicitly whether to include SQL text.
4. Freeze the review. Analysis captures the original native records again and requires the exact reviewed snapshot digest. The resulting plan contains immutable event bytes, source SHA-256, target workspace ID and original producer key.
5. Publish the saved source. Analysis retains one original job ID for this plan before dispatch.
6. Read the native receipt. The page keeps collector revision, added/retained event counts, source identity, replay status and actual endpoint separate from local attempt status.

The source name is `analysis-lineage-<plan-id>.json`. Its original key is `analysis-<analysis-workspace-id>-<plan-id>`. A retry uses the same source name, source URL, bytes and key. Another publication job cannot be substituted for an already-admitted plan.

The browser saves its exact plan and publication requests before POST. A lost browser reply is reconciled by reading the original saved plan/job. If the request was not admitted, the explicit continuation uses the same retained body. A new browser can reopen a plan from server history and follow its original publication job without the old browser journal.

## Interrupted and cancelled attempts

The original Runtime and Node bridge own one attempt from file verification through final reply publication. They use the original client's HTTP status, error details and `Retry-After` header.

| Retained observation | Operator action |
| --- | --- |
| NOT_STARTED | Correct the original runtime/configuration admission issue, then continue the same job. |
| NOT_DISPATCHED | The bridge proved the HTTP send had not begun. Correct its exact source/configuration issue and continue the same request. |
| HTTP_REJECTED | A complete native response with a documented preflight 4xx status proves rejection. Read the actual status and continue the original key after correcting that condition. |
| OUTCOME_UNKNOWN | The send may have committed before the reply was lost, incomplete, invalid or followed by a 5xx response. An invalid 2xx acknowledgement is also unknown. Continue the same source/key so the original producer returns its retained replay result. |
| ACCEPTED | Preserve the complete receipt. A later local timeout/cancellation does not undo the collector acknowledgement. |

**Stop this local attempt** signals the current native operation and retains that cancellation request. It does not remove events from the collector. The same publication remains explicitly resumable. The application does not automatically retry a stopped or failed request.

On workspace reopen, an existing complete validated acceptance restores the corresponding original job's completed state. Otherwise an interrupted job remains visible for explicit continuation. The collector's original idempotency behavior resolves a committed send whose acknowledgement was lost.

Closing Analysis drains its owned lineage operations through receipt publication and local cleanup. Disposable credential-reference files are removed only after an outcome is retained. If local receipt publication fails, the original request/log files remain in the private attempt directory for recovery.

## Native Python and CLI

The Python surface is the original `AnalysisWorkspace.lineage` object:

~~~python
from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace

workspace = AnalysisWorkspace(
    "/absolute/private/analysis",
    checkout="/absolute/selected/runtime",
    lineage_connections="/absolute/private/lineage-connections.json",
)
try:
    reviewed = workspace.lineage.review({
        "job_id": original_completed_job_id,
        "include_sql": False,
    })
    plan = workspace.lineage.save_plan({
        "id": retained_plan_id,
        "job_id": original_completed_job_id,
        "expected_snapshot_sha256": reviewed["snapshot_sha256"],
        "connection": "operations",
        "expected_workspace_id": original_collector_workspace_id,
        "title": "Reviewed workbook lineage",
        "note": "Exact completed source and workbook revision reviewed.",
        "include_sql": False,
    })
    job = workspace.start("lineage-publish", {
        "id": retained_publication_job_id,
        "plan_id": plan["id"],
        "plan_sha256": plan["plan_sha256"],
    })
    # Follow workspace.job(job["id"]) until the original outcome is terminal.
finally:
    workspace.close()
~~~

The shown identifier variables are caller-retained IDs, not freshly generated values on every retry. Closing immediately cancels/drains an in-flight attempt; a real program keeps the workspace open while following that original job.

The maintained CLI uses the same implementation:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis \
  lineage-read --action jobs

python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis \
  lineage-read --action review --request /absolute/private/review.json

python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis \
  --lineage-connections /absolute/private/lineage-connections.json \
  lineage-plan --request /absolute/private/plan.json

python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis \
  --checkout /absolute/selected/runtime \
  --lineage-connections /absolute/private/lineage-connections.json \
  lineage-publish --request /absolute/private/publication.json

python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/analysis \
  lineage-download --plan-id ORIGINAL_PLAN_ID \
  --name handover.zip --out /absolute/private/lineage-handover.zip
~~~

`review.json` is `{job_id,include_sql}`. `plan.json` is the complete `save_plan` request above. `publication.json` is `{id,plan_id,plan_sha256}`. A repeated exact plan request reopens the saved plan before reading newer source state; a repeated publication request uses the original job.

The original workspace lock allows one owning Analysis process. Use the running browser/HTTP application while its server owns the workspace. Standalone CLI commands take that same original ownership when the server is closed.

## Portable evidence and whole-workspace restore

Downloads are generated from the frozen source and current retained publication record:

| File | Contents |
| --- | --- |
| `events.json` | Exact outbound event-array bytes and source digest. |
| `plan.json` | Reviewed plan metadata, target, source identity and original plan digest. |
| `native-bindings.json` | Full native snapshot: original job requests/results, immutable versions and exact source/export/workbook metadata bytes with hashes. |
| `receipts.json` | Original publication identity, accepted native response if any and complete append-only attempt observations. |
| `report.html` | Escaped printable report of the native dependency closure, review and actual publication outcome. |
| `manifest.json` | Exact member lengths/digests and original plan/source identity. |
| `handover.zip` | The complete six-member handover with deterministic ZIP metadata. |

Before a publication is accepted, a handover honestly records that pending/unknown outcome. A later handover can contain a new receipt while preserving the same frozen plan and event bytes. Retain the downloaded ZIP's actual SHA-256 when transferring an edition.

The offline reader requires no collector, Node process or original Analysis database:

~~~python
from stellar_forge_buyer.analysis_lineage_reports import LineagePublication

publication = LineagePublication(
    "/absolute/private/lineage-handover.zip",
    expected_sha256=actual_download_sha256,
)
print(publication.inspect())
original_record_bytes = publication.native_document(original_record_sha256)
~~~

This handover retains the complete lineage evidence. The original **Analysis Backups** workflow additionally carries original source documents, SQLite tables, query-export files, workbook files, plans and receipts. Use its existing `workspace-export` job and `restore_archive` receiver. The lineage records live in the same original SQLite database, so their IDs and receipt history survive that full restore. Reconfigure launcher-side collector/token references on the receiving host; credentials are not embedded in the lineage plan.

## Bounds and contract

The reviewed closure supports at most 128 completed jobs, 2,048 datasets, 32 MiB of native snapshot JSON and 16 MiB of outbound event JSON. Limits stop the review before publication; records are not silently dropped. The original producer may impose its own lower limits. Collector status and retry-after remain its native responsibility.

The event envelope uses the OpenLineage RunEvent 2-0-2 schema and the version-1 `stellarForge_analysis` custom facet. Each run, job and dataset facet points to its own schema definition at immutable source commit `e4e5196261cfb0f410538d0e3277b112806236c1`; the schema URL never follows a moving branch. This facet records source hashes, original native IDs, query-preview scope, reviewed sheet mappings and retrospective timing without asserting unobserved column dependencies.

Primary contracts and maintained source:

- [OpenLineage RunEvent schema](https://openlineage.io/spec/2-0-2/OpenLineage.json)
- [OpenLineage facets](https://openlineage.io/docs/spec/facets/)
- [Original collector and producer](../../sf30-seller-sdk/openlineage-workspace/PRODUCERS.md)
- [Native receiving continuation](./examples/ANALYSIS_LINEAGE_NATIVE.md)

The receiving programme consumes an already-completed Analysis backup and original root job. It exercises the original collector, real HTTP response loss/replay, browser review and same-plan reopening, complete handover, original whole backup and cold restore. Its report distinguishes actually executed receiving stages from source-only preparation.
