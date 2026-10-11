# EvidenceForge

EvidenceForge is a local workspace for running a coding task with an NVIDIA
model on Nebius Token Factory, inspecting the actual source change and checks,
and reopening the complete result later. The model receives the selected source,
the observed baseline failures and an explicit change contract. The original
execution engine applies its plan to a disposable task copy and runs the named
Python checks. The interface keeps the source, patch, case results, provider
response and downloadable working record together.

This release joins the original provider, task runner and retained journal into
one application. [SUBMISSION.md](SUBMISSION.md) records the current competition
entry and observed provider runs. [FOCUSED_EXECUTION.md](FOCUSED_EXECUTION.md)
explains the execution contract.

## Start the application

Use Python **3.11 or newer** on Linux, macOS or Windows. The runtime uses Python's
standard library; no package installation or hosted build is required.

From this directory:

```sh
python -B launch.py --runs ./runs --port 8081
```

Open the printed `http://127.0.0.1:8081` address. Stop with Ctrl-C and start the
same command with the same runs directory to reopen the retained work. The full
module entrypoint is also available:

```sh
python -B -m evidenceforge.web_runtime --runs ./runs --port 8081
```

For a model run, start the process in the existing Nebius account environment
with `NEBIUS_API_KEY` set. The **Provider** panel reads the account's current
NVIDIA/Nemotron inventory. Select an enabled model there; `NEBIUS_MODEL` may
optionally provide the default. The key stays in the server process and is not
sent to the browser or written into the run package. The adapter uses the
[official Token Factory API](https://docs.tokenfactory.nebius.com/api-reference/introduction).

## Complete coding workflow

1. **Choose the task.** Inspect its starting source, requested behavior, allowed
   file and original named checks. The checker is separate from model-writable source.
2. **Choose the execution.** Select a current Nebius model, or an explicitly
   labeled authored baseline/corrected control. Controls execute real local
   Python checks and let you explore the application without a key.
3. **Run.** The operation ID is retained before dispatch. The interface shows
   its original journal while the provider and checker execute.
4. **Inspect the result.** Read the before/after source and patch, individual
   baseline and final cases, actual durations, returned model identity, usage
   and provider response. A failed check remains a failed check.
5. **Compare and retain.** Reopen prior operations and compare results on the
   same task contract. Refreshing or reopening reads the saved result and does
   not dispatch another inference.
6. **Download the complete run.** The native ZIP includes exact source, task
   contract and checker source, case outputs, plan, patch and retained provider
   records when that run used Nebius.

If a browser connection ends during execution, reopen the visible operation ID.
The server retains a received provider response even if its plan cannot be
admitted or a later check fails. An incomplete operation remains inspectable;
starting another attempt is a separate explicit action.

## Released tasks

These are the project's original coding workloads, with actual Python execution.
They exercise application behavior rather than a competition leaderboard score.

| Task | Work to complete | Original check |
| --- | --- | --- |
| Invoice import | BOM/header handling, normalized duplicate IDs and exact finite Decimal cents | `invoice-regressions` |
| Dependency ordering | Stable topological order, unknown references and cycles | `dependency-regressions` |
| Operation ledger | Canonical replay, changed-payload conflicts, boolean/integer distinction and empty IDs | `ledger-regressions` |

The declared source and cases live in `evidenceforge/workloads.py`. The runner
retains their content identities with every new operation so a changed workload
cannot silently stand in for the one that produced a result.

## Run from the command line

The CLI and browser use the same `run_task()` implementation and runs directory.
For an authored corrected control:

```sh
python -B -m evidenceforge.focused_execution \
  --task invoice-import --operation-id invoice-control-001 \
  --out ./runs --control corrected --seconds 120
```

For a current account model, after selecting its actual ID from inventory:

```sh
python -B -m evidenceforge.focused_execution \
  --task dependency-order --operation-id nebius-dependency-001 \
  --out ./runs --live --model "$NEBIUS_MODEL" --seconds 120 --max-tokens 4096
```

Use a different operation ID for a new attempt. Reusing a completed matching
operation reopens its result. The provider does not automatically repeat an
inference after an interrupted response.

## Portable test build

Create a complete distribution from the actual working source:

```sh
python -B tools/build_test_build.py --output /absolute/path/EvidenceForge.zip
```

To include a selected completed operation, add its original runs directory and
ID. Repeat `--include-operation` for each operation intended for the recipient:

```sh
python -B tools/build_test_build.py --output /absolute/path/EvidenceForge.zip \
  --runs ./runs --include-operation nebius-dependency-001
```

The builder copies the application, runtime assets, documentation, original
tests, MIT license and only explicitly selected native run bundles. It does not
collect environment variables, arbitrary workspace files or an entire private
runs directory. It checks each selected run with the original reader before
packaging it. Existing output files are preserved.

Unzip the build, enter `EvidenceForge`, and run:

```sh
python -B launch.py --runs ./example-runs --port 8081
```

Included operations open in the original interface. New authored controls work
without an account; new Nebius calls use the account configuration above.
`BUILD_INFO.json` identifies the distribution's source and retained operations.

## Execution and operation

The original compiler admits the declared read/write/test operations and checks
the selected path and write count. Every write precedes the named checks. The
current adapter executes the released pure-Python task modules with the original
restricted runner. General repository execution requires an appropriate isolated
adapter for that repository.

The application binds to loopback and validates its browser origin and
per-process action token. It is a local operator. Downloads retain actual run
artifacts; hash verification establishes their consistency, not the authenticity
of arbitrary provider claims supplied by someone else. The original receipt's
human-approval field remains unchanged.
[ARCHITECTURE.md](ARCHITECTURE.md) describes that original contract.

The older `evidenceforge.cli demo`, `replay` and `evidenceforge.webapp` entrypoints
remain available for their MemorySandbox examples. Use `web_runtime` and
`focused_execution` for actual task computation and provider operations.

## Competition and license

The [current official rules](https://nebiusglobalaihackathon.devpost.com/rules)
provide a Coding and Agentic Engineering track and accept a working demo,
hosted application or test build. The project uses the original entry;
[SUBMISSION.md](SUBMISSION.md) holds its current account, run and public-video
details, and [DEMO_STORYBOARD.md](DEMO_STORYBOARD.md) describes the actual demo.

MIT. The standalone build includes the original repository license in `LICENSE`.
