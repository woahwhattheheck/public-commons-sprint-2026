# EvidenceForge — submission package

Prepared for the existing **Nebius × NVIDIA Global AI Hackathon** entry in
**Coding and Agentic Engineering**. Source and rules reviewed on 2026-10-11.
The concise competition contract is in [COMPETITION_CONTRACT.md](COMPETITION_CONTRACT.md).

## Project fields

**Project name:** EvidenceForge

**Tagline:** Review a model's code change, run the original checks, and keep the exact result.

**Public source:** https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/nebius-evidenceforge

**Working test build:** [EvidenceForge 0.2.0](https://github.com/woahwhattheheck/public-commons-sprint-2026/raw/main/nebius-evidenceforge/dist/EvidenceForge-0.2.0.zip).
Extract the archive and run `python3 launch.py` with Python 3.11 or newer.
The build contains the complete application and three retained local task
operations; [README.md](README.md) explains setup and review.

**License:** [MIT](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/LICENSE).
The distributed test build must carry the same license notice.

## Project description

EvidenceForge is a local coding workspace for repairing small Python modules
with a clearly defined scope. A task starts with its original source, observed
failures, an allowed file, a write budget, and named checks. An NVIDIA model
reached through Nebius Token Factory proposes the change. EvidenceForge
validates that plan, applies it to a fresh task copy, runs the original checker,
and presents the patch beside the actual before-and-after results.

The concrete example is an invoice importer. Its task includes a byte-order
mark in a CSV header, invoice identifiers that become duplicates after
normalization, and monetary values that require exact finite decimal handling.
Those are authored development cases with executable checks. They give a
reviewer a compact business-logic problem whose outcome can be inspected
directly in the source and results. The workload definitions and original
checks are in [workloads.py](evidenceforge/workloads.py).

The result stays attached to the source and policy that produced it. A stable
operation ID lets a reviewer reopen the original journal, patch, and check
results after navigating away or restarting the local interface. A corrected
control uses the same task and checks, making the model's result comparable to
a known implementation. A successful check result helps the reviewer decide
whether to use a change; the application does not deploy it or grant itself
permission to change a production repository.

Our intended audience is developers reviewing narrowly scoped automation and
data-processing fixes. The shipped executor supports the included small Python
workloads. Supporting arbitrary repositories would require a stronger isolated
execution adapter and repository-specific checks; that broader capability is
outside the delivered application.

## How it works

1. **Inspect the task.** Read the frozen source, goal, allowed path, and named
   checks before dispatching a run.
2. **Generate a scoped change.** The existing provider adapter discovers the
   current model inventory and submits the task to the selected available
   NVIDIA model through Nebius Token Factory.
3. **Run the original computation.** The admitted plan writes only its task
   copy. The checker is outside the model's writable scope, and writes must
   finish before the declared checks run.
4. **Review the outcome.** Inspect the actual failure or success, source patch,
   check output, and comparison with the same-source corrected control.
5. **Keep the work.** Reopen the retained operation and download the original
   result artifacts without creating another inference request.

The main implementation is Python, using the standard library for the local
service and execution protocol. The provider uses the documented
[OpenAI-compatible Token Factory API](https://docs.tokenfactory.nebius.com/api-reference/introduction)
at `https://api.tokenfactory.nebius.com/v1/`. Runtime discovery avoids depending
on a model identifier copied from an old catalog. The adapter records the
requested model separately from the model reported by the actual response.

Implementation details and supported execution limits are maintained in
[FOCUSED_EXECUTION.md](FOCUSED_EXECUTION.md). Setup and the current browser
entrypoint are maintained in [README.md](README.md).

## Competition-period development

The public source history records the provider-plan CLI, provider provenance,
native task execution, and retained browser operations developed for this
entry. The native execution release is
[PR178](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/178);
the retained-operation interface is
[PR813](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/813).
The current product work brings task inspection, live provider execution,
review, comparison, and retained output into one interface. The submitted
source revision will identify the integrated release, so the description and
video refer to the same implementation.

## Demonstration and measured result

The public demonstration follows [DEMO_STORYBOARD.md](DEMO_STORYBOARD.md).
Capture one real invoice-import workflow and retain its original operation.
Use the actual result, including any unsuccessful attempt, when describing
model behavior. Local corrected controls are labeled separately from provider
runs. The earlier native control observations remain in
[focused-validation-20261008.json](evidence/focused-validation-20261008.json).

The 0.2.0 test build includes the invoice importer, dependency ordering, and
operation ledger corrected controls run on this Linux worker on 2026-10-11.
Each original baseline failed three named checks; each corrected implementation
passed all four original checks, for 12 of 12 final checks across the three
tasks. These are authored local controls. They are not NVIDIA model results.
The invoice workflow was also exercised through the native browser: its
downloaded patch applied to the original source, and its operation reopened
after restarting the service. A fresh process launched the extracted test
build and reopened all three retained operations without a provider request.

The entry's selected live run will supply these exact values:

| Field | Source to copy into the final entry |
| --- | --- |
| Submitted source revision | The integrated public commit used by the test build and recording |
| Selected operation | Its original retained operation ID and task |
| NVIDIA model | Actual response model, with requested model retained separately |
| Provider execution | Actual response ID and creation time, plus the original runtime record |
| Result | Observed baseline and final named-check outcomes; admitted patch or concrete failure |
| Measurement | Recorded wall time and returned token usage, with their scope stated |
| Working build | The 0.2.0 test build above; add the selected provider operation to the final package |
| Video | Public YouTube URL and measured duration |
| Entry | Existing Devpost project URL and provider-confirmed submission state |

The source package is available at the public URL above. A selected qualifying
Nebius run, video publication, and final Devpost state are being integrated;
this document does not substitute a draft URL for one of those artifacts.

## Tooling feedback

The final feedback is written from the selected native provider operation.
Record what happened when discovering the model, generating the plan, handling
the response, and running the change. Include the returned finish reason,
usage, and observed timing where those observations support the feedback.

Useful feedback connects an observed behavior to a concrete improvement. For
example, if the selected model produces a response that fails the plan schema,
report the actual failure and the schema support that would make this workflow
more reliable. If it produces a useful change, explain which task details and
response features made the result usable. Do not infer API reliability,
comparative model quality, or customer productivity from one operation.

## Judge access and final publication

The published test build opens the real product with three retained local
control operations and the complete source, checks, and MIT license. Its setup
instructions explain how to inspect the patch, rerun the original local checks,
and download retained output. It contains no API key. Reviewing its delivered
operations and running the local controls require no provider account. Fresh
provider execution uses the operator's configured provider environment. The
selected qualifying provider operation will be added to the final competition
package so judges can review that result without supplying credentials.

The existing entrant account supplies the final project fields, testing URL,
video, and feedback. Preserve that project and its team rather than creating
another entry. After publishing, read the actual submission state and public
destinations back, and record the source revision and selected operation in
the entry so the software, video, and description remain aligned.
