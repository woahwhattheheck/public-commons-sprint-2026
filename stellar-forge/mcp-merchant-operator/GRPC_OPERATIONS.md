# gRPC operations in the original merchant agent

The installed grpc-workspaces provider exposes eight operations tools over the original native workspace:

| Tool suffix after merchant_grpc_ | Purpose |
| --- | --- |
| operations_capture | Freeze selected original attempts, source revisions and health prefixes under a saved capture UUID |
| operations_captures | Page the complete saved capture inventory |
| operations_read | Inspect summary, calls, health, combined timeline, method/source cohorts or one complete original record |
| operations_cases | Page saved incident cases and corrective-action counts |
| operations_case | Open an exact incident version and its full revision history |
| operations_save | Save a reviewed incident/edit using its original operation ID and observed current version |
| operations_export | Publish the complete selected incident and original records as five exact retained files |
| operations_receive | Receive an existing operations export or host-declared operations file into the original workspace |

The complete tool schemas describe selection, record links, review and action fields. Public numeric values keep their native representation. Original source configuration contains credential references; the operator environment supplies their values.

## Operate and recover

Select the host-declared workspace alias. Persist the complete capture or edit arguments and UUID before dispatch. A capture UUID identifies its first completed selection. A case-save operation UUID identifies its first complete edit; the observed case version provides compare-and-swap protection.

Read every page using its original snapshot. Captured table pages share the immutable capture SHA-256; capture/case inventory pages use their returned inventory snapshot. Large returns are complete immutable result files in the existing merchant export store.

Existing native attempts are read through the original recovery path, preserving COMPLETED, OUTCOME_UNCONFIRMED, ATTEMPTED and NOT_STARTED. The capture does not issue another application or health RPC. Its recorded timing spans saved start/finish records, and health rows retain actual reported events.

## Deliver the complete case

operations_export returns MANIFEST_RETAINED, kind operations. Preserve exportId and manifestFile.sha256. The original export’s operationId is the incident case ID; reviewSha256 identifies its selected revision, snapshotSha256 identifies the immutable capture, and topic carries operations: followed by the portable JSON export SHA-256.

The five paths are grpc-operations.json, calls.csv, health.csv, actions.csv and report.html. Original merchant_grpc_export_manifest/file_read/file_release tools own complete range reads. downloadGrpcOperationsExport resumes those same files and checks the native case/capture/revision binding.

For another declared native workspace, call operations_receive with a new saved receiving operation UUID and either exportId or a configured file alias. Native receiving reuses matching history and preserves all predecessor revisions. Its receipt and later edits stay in the original receiving workspace.

## Persistent Console

Open the installed gRPC product’s existing Merchant Console and select its retained profile and workspace. Operations & incidents shares the native editor. Every tool effect appears in the original Requests journal. Large operations results are hydrated from the exact original saved result file with per-range/full-file identities; the original read owner closes each file.

The complete incident delivery recipe retains the selected case/version/capture, original tool definitions, inspected pages and full five-file export. Its manifest pause leads to Customer files for the original resumable receiving and complete archive.

The native guide is sf30-seller-sdk/grpc/OPERATIONS.md. The typed client, CLI and offline receiver are exported from the source-owned grpc-operations contribution.
