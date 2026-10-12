# Wherobots Operations

An industrial browser workspace, Python operator and Node tool surface for an existing Wherobots workflow. The same durable records connect the original customer intake and script to review, native submission, recovery, logs, output receiving, complete edition comparison and independent reopening.

## Open the operator

Use Python 3.10 or later. From this source directory:

~~~sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python operate.py --workspace /absolute/private-workspace init
.venv/bin/python operate.py --workspace /absolute/private-workspace serve
~~~

On Windows, use the virtual environment's Scripts/python.exe. The launch command prints the private local URL. Open that URL to connect the browser tab. Workspace directories have owner-only permissions; the source directory remains an ordinary editable application.

The browser provides source upload and intake adoption, saved workflow settings, review, native operations, captured logs, complete output editions, typed data paging, full comparison and handover downloads. Background transfers retain their original operation and file progress when the page closes.

## Existing runtime connection

The official SDK reads WHEROBOTS_API_KEY from the original process environment. Set WHEROBOTS_ORGANIZATION_ID to the existing organization associated with that connection, or select an existing private profile using WHEROBOTS_OPERATOR_PROFILE.

The optional profile is a local JSON file with organization_id, region, runtimes, api_base_url, aws_profile and s3_region. The workflow stores the selected organization, runtime, region and API target. Credential values remain in the original SDK environment and AWS credential chain.

A profile may constrain a runtime list and region. A direct S3 output uses the original boto3/AWS SSO profile, including an optional WHEROBOTS_AWS_PROFILE. A My Files output uses the official SDK's storage drive and presigned download route. Requester Pays is used only when the reviewed output declares it.

Native run responses retain their observed organization and region fields. Those fields are checked against the reviewed selection when the provider returns them.

## Adopt the original customer document

Choose **Adopt customer intake** in the browser, select the unchanged wherobots.customer-workflow.v1 JSON document and every source file it names, and enter the existing organization ID. File hashes and byte lengths must match the original sourceFiles records.

The operator retains that input file unchanged and maps its source references, native job fields, output stores, receiving context and authority into the editable workflow. Source SDK 0.4.0 or 0.5.0 is recorded separately from the executing SDK 0.5.0. Review the adopted definition before starting a run.

The CLI accepts the same material:

~~~sh
python operate.py --workspace /absolute/private-workspace adopt original-workflow.json \
  --files source-paths.json --account selected-account.json --actor "Receiving operator"
~~~

source-paths.json maps original source file IDs to local paths, relative to that map file. selected-account.json contains organization_id and optionally region, runtime, api_base_url and version. Output metadata can then be completed in the browser, including the original CSV header choice and comparison key.

## Operate the native job

1. Save the original script, ordered arguments, source collections and output definition.
2. Review the saved workflow using its exact revision and a stable operation ID.
3. Submit the reviewed operation. The script is uploaded through the original SDK to a content-specific path. The prepared native payload is saved before the submission starts.
4. Refresh the original run for status, metrics, cost and complete cursor-based logs.
5. Receive the completed output edition, or resume its saved file inventory after interruption.

The operation preserves the native run ID immediately after the SDK returns it. A lost submission reply is reconciled through the complete native run listing and its original name, script, arguments, environment and runtime. Server timeout clamping and resolving a requested latest version remain visible in the full native response. An existing run can be attached through an independently reviewed original script URI and native ID.

A pending cancellation records the provider request; the following native status determines the actual result. COMPLETED, FAILED, CANCELLED and TIMED_OUT remain native terminal states.

Corrected submissions use their own output prefix. The previous source, run and received edition remain available for complete comparison.

~~~sh
python operate.py --workspace /absolute/private-workspace review workflow-id \
  --operation-id reviewed-operation-id --expected-revision saved-workflow-revision --actor "Receiving operator"
python operate.py --workspace /absolute/private-workspace submit reviewed-operation-id
python operate.py --workspace /absolute/private-workspace recover reviewed-operation-id
python operate.py --workspace /absolute/private-workspace refresh reviewed-operation-id --include-logs
python operate.py --workspace /absolute/private-workspace capture reviewed-operation-id
~~~

## Complete output receiving

S3 receiving retains every listing page, selected object version or ETag, response metadata and complete file. My Files receiving uses the original SDK's authenticated path and storage URL, retaining listing and response metadata without sending the API authorization header to storage.

The reviewed limits cover both complete object count and total output bytes. Individual dataset limits are also enforced. Every completed part is retained before the next transfer. Reopening the same capture verifies and reuses the original completed objects.

Formats include CSV, JSON, NDJSON, GeoJSON sequences, Parquet and GeoParquet. Every original part, auxiliary marker and declared source remains in the handover. Complete row indexes support paging without loading an entire dataset into the browser. Number, decimal, large-integer, binary and timestamp tags retain values that ordinary browser JSON would round or change.

Geometry inspection uses original coordinates and metadata. GeoParquet's absent CRS and explicitly null CRS remain distinct. Axis order, metadata, row counts, coordinate envelopes and complete schema changes remain available beside the original data.

See OUTPUTS.md for exact format and comparison behavior.

## Independent handover

~~~sh
python operate.py --workspace /absolute/private-workspace export workflow-id /absolute/workflow-handover.zip
python operate.py --workspace /absolute/customer-workspace init
python operate.py --workspace /absolute/customer-workspace import /absolute/workflow-handover.zip
python operate.py --workspace /absolute/customer-workspace serve
~~~

The complete archive includes original workflow and operation records, native source/run/log/listing/output objects, inspected editions, comparisons, source hashes and editable application code. It opens with a local overview and can be imported into a fresh selected workspace. Original IDs remain intact. A corrected handover can advance previously received original records while identifying local edits before changing them.

## Starforge dataset and tool joins

The original SF30 dataset merchant receives a complete dataset handover:

~~~sh
python operate.py --workspace /absolute/private-workspace export-dataset \
  edition-id dataset-id /absolute/received-dataset
~~~

The output contains dataset.csv, its original dataset configuration, source manifest and full original object closure. Use that configuration with the existing SF30 dataset workflow and payment/receiving path.

The Node surface runs the same Python operations over JSON standard input:

~~~js
import { createWherobotsWorkspace } from "./index.mjs";
const workspace = createWherobotsWorkspace({
  directory: "/absolute/private-workspace",
  python: "/absolute/source/.venv/bin/python"
});
const runtime = await workspace.runtime();
const original = await workspace.get({kind: "operation", id: "reviewed-operation-id"});
const logs = await workspace.logs({operation_id: original.id, offset: 0, limit: 100});
const rows = await workspace.rows({edition_id: "edition-id", dataset_id: "dataset-id", offset: 0, limit: 100});
~~~

workspace.tools() exposes all 20 wherobots_ tool definitions. Runtime inspection and captured-log paging use the same operations in the CLI, browser and Node host. The browser can select any retained log capture and page through every entry; receiving progress continues by its original event cursor. workspace.callTool(name, arguments) calls those operations and returns standard text plus structured content. Registration can use the existing host's selected workspace and Python runtime. The native Wherobots source and run remain the canonical execution objects.

## Source and dependencies

- Official Wherobots Python SDK 0.5.0: https://pypi.org/project/wherobots-python-sdk/0.5.0/
- Wherobots run API: https://docs.wherobots.com/api-reference/runs/create-a-job-run
- Wherobots vector writers: https://docs.wherobots.com/tutorials/wherobotsdb/vector-data/vector-save
- Original Labs orchestration example: https://github.com/wherobots/labs-reference-implementations/tree/c3b0a89daf5c0d6a6dea4a29a8a5201d33be48c6/aws-step-functions-python-sdk
- Boto3 S3 API: https://docs.aws.amazon.com/boto3/latest/reference/services/s3.html
- Apache Arrow Python: https://arrow.apache.org/docs/python/
- GeoParquet specification: https://geoparquet.org/releases/v1.1.0/

The official SDK wheel is recorded in providerSDK/source.json with its complete published digest. The original customer intake contract is under contracts/. The application has no hosted database or separate job scheduler.
