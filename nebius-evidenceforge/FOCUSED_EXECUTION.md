# Focused execution on the released coding workload

EvidenceForge now has an execution path for three curated repository bugs. The
controls are authored benchmark sources; their checks execute actual Python
computation in a fresh task copy. The original local workspace now runs the same
task through an account-configured NVIDIA/Nemotron model, compares its result
with an authored control, and exports the retained operation. Actual model-run
and competition-delivery records are linked from [SUBMISSION.md](SUBMISSION.md).

| Task | Changed behavior | Named check |
| --- | --- | --- |
| invoice-import | BOM/header handling, normalized duplicate IDs, exact finite Decimal cents | invoice-regressions |
| dependency-order | stable topological order, unknown references and cycles | dependency-regressions |
| operation-ledger | canonical replay, changed-payload conflicts, true versus 1 and empty IDs | ledger-regressions |

The frozen source and task descriptions are in evidenceforge/workloads.py.
Only the selected task file may be written; the checker is not a model-writable
file. Reads, writes and named test events retain exact source/output hashes.

## Run a control and inspect its actual evidence

From nebius-evidenceforge:

    python -B -m evidenceforge.focused_execution --task invoice-import --operation-id invoice-control-001 --out .focused-runs --control corrected --seconds 120

Use baseline instead of corrected to observe the defective source fail.
Change the operation ID for a new attempt. Reusing an identical completed
operation returns its retained verified envelope; conflicting or incomplete
operations require journal inspection and are not dispatched again.

Artifacts under .focused-runs/OPERATION include run.json, receipt.json,
change.patch, journal.json, both original/result source files, the exact trusted
checker files, policy, plan, baseline and final check outputs. A provider run also
retains its inventory, complete request/response record and admitted provider plan.
The result envelope binds all download members by exact-byte hash. Its source,
policy and checker contract supports comparison with a separately run control.

Every artifact is published atomically before run.json commits the complete
result. The original journal keeps task, mode, selected model, operation ID,
created/updated/finished times and phase across terminal states. A disconnected
HTTP response cannot erase a finished run or cause another inference request.
verify_run() checks hash/schema/source consistency; an arbitrary caller's JSON
claim does not authenticate the provider.

## Local interface

    python -B -m evidenceforge.web_runtime --port 8081

Open http://127.0.0.1:8081. Select a task and inspect its original source, exact
allowed path, write budget and trusted checker. Choose **Nebius model**,
**Baseline control**, or **Corrected control**. The provider selector reads the
current configured account inventory; it does not invent a model ID or open a
new account. Selecting a model or opening a result makes no inference request.
The explicit Run action uses the same run_task executor as the native CLI.

The API key stays in the server environment. Each browser API request retains
the original per-process action-token and local-origin boundary. The server
remains on loopback; a public test build is a downloadable application, not a
public endpoint carrying an account key. Start with --runs /absolute/path to
keep operations in an operator-selected directory across software updates.

The operation ID is now displayed and saved in browser storage **before** a run
request is sent. If the response is interrupted, reload the page or use
**Inspect operation** to read the original journal and result. Reopening only
performs reads: it does not retry execution, call a model, approve a change or
create another operation. When storage is unavailable, copy the visible ID.
**Choose a new run** clears the current selection while retaining recent IDs;
only the separate Run action starts a new operation.

The retained-operation list reads original journal metadata and shows observed
filesystem timestamps. Journal state and the presence of a result file do not
establish completion. Opening one operation checks its original envelope with
`verify_run()` before showing or downloading the result. This checks hash and
receipt consistency, not provider authenticity. An incomplete, missing or
unreadable result remains explicit; absence does not establish that dispatch
never happened. There is no automatic inference retry.

The index scans at most 500 directory entries and displays up to 100 operations
from that scan, with an explicit partial-list notice when bounded. A known ID
can be opened directly even when it is not listed. Reads are bounded to 16 KiB
per journal and 2 MiB per result. Each provider HTTP record is limited to 4 MiB
after encoding; the actual provider response is at most 1 MiB. A complete source
delivery is at most 12 MiB. Linked artifact paths are not followed.
The browser stores only the selected ID and up to 20 recent ID/task/mode
records, never the action token or run contents. Browser history is distinct
from retained server artifacts and does not prove execution.

## Compare, export and reopen

Run the selected authored corrected control as its own operation, or reopen an
existing matching control. Comparison requires the same task, baseline source,
canonical human policy, checker digest and declared check/case identities. A
different checker version is not silently treated as the same experiment. The
interface displays each run's native before/after case outcomes, source patch,
wall time and actual provider usage. It does not execute a second evaluator.

Download the operation ZIP to keep the original envelope, both source versions,
checker, policy, plan, patch, all native outputs and any actual API records. The
delivery manifest lists the exact bytes of each original member; the API key is
never a member. The disposable execution workspace is unnecessary for reopening.

To reopen a downloaded operation after moving computers or restarting:

1. Extract the ZIP into a new directory, keeping its operation-ID subdirectory.
2. Start the original application with --runs pointing at that directory:

       python -B -m evidenceforge.web_runtime --runs /absolute/path/to/extracted-directory

3. Select the retained operation or enter its original ID. Opening and downloading
   perform reads only. No credential is needed to inspect an existing result.

Legacy v1 envelopes remain readable. Their downloads include available original
files that match the envelope; they do not gain a fabricated current checker
identity or become eligible for current-source comparison.

## Native browser API

All endpoints below require X-Action-Token from the local page and the existing
local Host/Origin boundary. Tokens are not stored in browser persistence or URLs.

| Endpoint | Result |
| --- | --- |
| GET /api/provider | configured/default model, current NVIDIA inventory, observation time and inventory hash; no inference or credential |
| GET /api/task?id=TASK | original policy/source, trusted checker source and identities, native limits |
| GET /api/operations | original operation journal metadata and partial-index indication |
| GET /api/operation?id=ID | journal, verified run, original-bundle verification status and observed provider-response metadata |
| GET /api/result?id=ID | original verified run envelope |
| GET /api/artifacts?id=ID | bound source before/after, original plan and available original members with byte hashes |
| GET /api/download?id=ID | complete retained operation ZIP |
| GET /api/provider-record?id=ID | original API record, including a response whose plan failed admission |
| POST /api/run | one original task execution; completed identical operation IDs reopen, conflicting/incomplete IDs are never redispatched |

The new run body is exactly:

    {"task":"invoice-import","mode":"nebius","operation_id":"invoice-nebius-001",
     "model":"CURRENT_NVIDIA_MODEL_ID","maximum_output_tokens":4096,"seconds":120}

For authored controls, mode is baseline or corrected and model is null. The
original three-field task/control/operation_id request remains supported. A
successful POST returns the original envelope; a failed POST includes the stable
operation_id and an error/message so the same journal can be reopened.

The original MemorySandbox demo and replay commands remain available for their
existing deterministic-fixture purpose. The focused execution path supplies the
actual computation and observed checks.

## Nebius runtime

Use the existing authorized account environment and its actual available credit
or allocation. NEBIUS_API_KEY is server-side; NEBIUS_MODEL optionally selects the
default, and NEBIUS_PROJECT_ID optionally addresses the existing project through
the provider's documented ai_project_id parameter. These settings create no
account, endpoint, billing method or new allocation.

    python -B -m evidenceforge.focused_execution --task dependency-order --operation-id nebius-live-001 --out .focused-runs --live --model CURRENT_NVIDIA_MODEL_ID --seconds 120 --max-tokens 4096

CURRENT_NVIDIA_MODEL_ID must be an actually enabled NVIDIA/Nemotron model.
NEBIUS_API_KEY is read from the environment. The adapter checks current /models
inventory and the actual response model, supplies allowed source plus observed
baseline failures, bounds input/output/response sizes, and records returned
request/response IDs, full returned usage, finish reason, service tier and
timestamp. The adapter requests one JSON-object completion, default service tier,
no streaming and no provider-side output storage. There is one inference request
and no automatic retry. A worker deadline ends local waiting; an already received
request may still be billed by the provider.

provider-api.json records the exact UTF-8 request/response bodies and their byte
hashes, endpoint, HTTP status, start/finish times, measured duration and selected
nonsecret response headers. It is saved before model-plan validation, so a
truncated, refused or invalid plan retains its real response for correction.
Credential material and authentication headers are not written. The journal
separately records whether the original executor completed the declared checks.

The original response's cost fields, if present, are retained without inventing
units or a billing amount. If the API returns only token usage, cost.status is
not_returned; this is not a zero-dollar charge. Account credit/settled billing is
read from the actual account or retained allocation record, separately from the
model response. The official APIs used here are documented at:

- https://docs.tokenfactory.nebius.com/api-reference/models/list-models
- https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion
- https://docs.tokenfactory.nebius.com/ai-models-inference/json
- https://docs.tokenfactory.nebius.com/other-capabilities/billing-new

Saved plan mode retains supplied provider claims as saved-plan evidence and
never marks that input as a newly observed Nebius call:

    python -B -m evidenceforge.focused_execution --task invoice-import --operation-id saved-001 --out .focused-runs --saved-plan provider-plan.json --seconds 120

The saved bundle must match the selected fixed request exactly. Every admitted
plan must complete its writes before its declared checks, preventing an earlier
green result from being attached to a later untested source change.

## Execution boundary

This adapter supports only small pure Python modules for the released fixture
tasks. Static admission rejects unapproved imports/attributes, dunder access,
reflection, dynamic execution, file/network/process capabilities and unsupported
syntax. Approved csv/StringIO/Decimal/json/hash subsets operate on bounded
fixture data. Intermediate expansion, source size, line-step and worker-time
limits apply. The worker receives a scrubbed environment.

It is a capability-restricted fixture runner, not an OS security sandbox.
General repositories require a separately supplied stronger isolated adapter.
The existing v1 receipt authority contract remains unchanged; this path writes
only its disposable task copy and does not deploy or change a production repo.

## Observed focused validation

The three named extension tests passed on 2026-10-08. All three defective controls
failed and their corrected controls passed four cases each. Corrected-run wall
times, including Windows worker startup and baseline/final checks, were
16.079s, 17.031s and 14.562s. The exact retained case results/source hashes are in
evidence/focused-validation-20261008.json.

    python -B -m unittest tests.test_focused_execution.FocusedExtension -v

This command targets the three extension checks only. It does not run the original
repository suite. The provider-contract check uses an injected offline transport;
it establishes no live inference.

For the current actual model operation, account allocation, public test build,
video and original Devpost entry, use [SUBMISSION.md](SUBMISSION.md). The historical
October 8 checks above are retained as authored-control observations, separately
from later actual provider runs and the current application journey.

