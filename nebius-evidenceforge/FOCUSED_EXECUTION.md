# Focused execution on the released coding workload

EvidenceForge now has an execution path for three curated repository bugs. The
controls are authored benchmark sources; their checks execute actual Python
computation in a fresh task copy. Model performance remains to be measured with
the live Nebius adapter.

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
change.patch, journal.json and the disposable source workspace. run.json binds
the v1 receipt, actual check outputs, source diff, measured wall time and
provider evidence. verify_run() checks hash/schema consistency; it does not
authenticate an arbitrary caller's provider claim.

## Local interface

    python -B -m evidenceforge.web_runtime --port 8081

Open http://127.0.0.1:8081. Select a task/control, run its named checks and inspect
the before/after case results, patch and envelope. The UI executes no paid model
calls. A per-process action token and stable operation IDs protect dispatch.
A retained CLI-created provider run can be opened by its operation ID.

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
never happened. No automatic polling or retry is performed.

The index scans at most 500 directory entries and displays up to 100 operations
from that scan, with an explicit partial-list notice when bounded. A known ID
can be opened directly even when it is not listed. Reads are bounded to 16 KiB
per journal and 2 MiB per result, and linked artifact paths are not followed.
The browser stores only the selected ID and up to 20 recent ID/task/control
records, never the action token or run contents. Browser history is distinct
from retained server artifacts and does not prove execution.

`GET /api/operations` lists recorded metadata; `GET /api/operation?id=...` opens
one journal and any verified result. Both retain the original action-token and
local-origin checks. The original `/api/result` verified-result endpoint is
preserved. The runtime, workload, provider and execution authority are unchanged.

The original MemorySandbox demo and replay commands remain available for their
existing deterministic-fixture purpose. The focused execution path supplies the
actual computation and observed checks.

## Nebius runtime

Use the existing secure account environment after its free-credit/charge
authority is established. A real runtime is still pending in this source delivery.

    python -B -m evidenceforge.focused_execution --task dependency-order --operation-id nebius-live-001 --out .focused-runs --live --model CURRENT_NVIDIA_MODEL_ID --seconds 120 --max-tokens 4096

CURRENT_NVIDIA_MODEL_ID must be an actually enabled NVIDIA/Nemotron model.
NEBIUS_API_KEY is read from the environment. The adapter checks current /models
inventory and the actual response model, supplies allowed source plus observed
baseline failures, bounds input/output/response sizes, and records returned
request/response IDs, usage, finish reason and timestamp. There is one inference
request and no automatic retry. A worker deadline ends local waiting; an already
received request may still be billed by the provider.

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

Submission state: real Nebius inference/free-credit state, signed-in participant/
team receipt, working public demonstration and public YouTube video are pending.
No award, payment or complete competition entry is claimed.

