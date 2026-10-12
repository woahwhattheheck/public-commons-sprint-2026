# Microsoft Agent Framework match insight

Counterpress adds an optional **Explain with tools** action to the existing match player. It reads the currently observed match prefix, asks the model to use the two local football tools, and saves the completed explanation with that same match. Coaches can reopen the original frame, compare saved matches, and pass the full match package to another installation.

The maintained player, deterministic counterpress engine, event stream, saved-match archive and coach comparison remain the application. The Microsoft worker uses Agent Framework's real `Agent`, `BaseChatClient` and `FunctionInvocationLayer`; its custom client calls the operator's existing guarded text runner for each model turn.

## Install and run

The player uses Node 22 or later. The optional worker uses Python 3.11 or later and the pinned Agent Framework core package:

```sh
python -m venv .venv-agent
.venv-agent/bin/python -m pip install -r requirements-agent.txt
```

Use an existing equipped environment when available. Agent Framework core brings its declared runtime dependencies; installing every provider extra is unnecessary for this custom client. The original retained environment used core 1.21.0 and the official custom-client composition at [Microsoft source fd52de71579162a888fb2dd7510c57c6014dcdfc](https://github.com/microsoft/agent-framework/tree/fd52de71579162a888fb2dd7510c57c6014dcdfc).

Configure the same original guarded runner already used by the operator. These are local paths, supplied through the server environment:

| Variable | Meaning |
| --- | --- |
| `CP_OPUS_AGENT_WORKER` | Absolute path to this project's `counterpress/microsoft_agent_worker.py`. |
| `CP_OPUS_PYTHON` | Absolute path to the equipped Python interpreter. |
| `CP_OPUS_BUDGET_RUNNER` | Absolute path to the existing `run_paid_api.py`. Use the path form for the Node application. |
| `CP_OPUS_WORK_DIR` | Private persistent directory for the original worker journal and temporary prompt files. |
| `COUNTERPRESS_ARCHIVE_DIR` | Private persistent directory for the existing match archive and insight continuity records. |
| `HOST` | `127.0.0.1` for the operator's server. |
| `PORT` | Existing application port; default 3167. |

The runner keeps its existing `ROOT/work/api-jobs/<job_id>/` layout, with `ROOT` derived from the original runner location. Retain that job directory and the configured worker directory when moving an existing operation. The worker reads original `receipt.json` and `response.txt` records before invoking the runner. Configure runner-owned credentials and credit inputs in that original runtime.

Start the application with `node src/server.mjs`. The tool action is enabled for the local operator when its real worker and runner paths exist. A shared viewer can use the ordinary player and reopen a completed explanation from a saved match.

## One match, one retained operation

1. Prepare the equipped server and the original match before refreshing any time-sensitive runner input.
2. Open a match, select club, audience and language, and pause at the counterpress moment to explain.
3. Select **Explain with tools**. The server commits the original operation identity before it starts the worker. Polls for that selected view use the same operation.
4. The SDK invokes `get_match_state` or `get_latest_moment`, each a read-only function over the original observed facts. The model's later turn receives the actual tool result.
5. The completed caption and explanation pass the original display contract and bind to the exact session, count, frame, moment and view. The result carries the actual SDK version, worker workflow, tool calls and per-turn provider job/request IDs.
6. Save the match or use its existing autosave. The full result enters the existing `review.insights` list and travels with the normal match export.
7. Reopen that saved frame after restart, or import its complete package in a fresh application. The saved explanation and coach comparison work from the retained match.

The legacy optional insight and the Microsoft tool workflow have separate prompt editions and continuity directories: `insights/` and `agent-insights/`. A completed result from one edition does not stand in for the other. Changing the observed count or selected view produces a different source key; reopening the same source reuses its original provider session.

The private source key includes the scenario, seed, full observed-prefix hash, event count, last event ID, frame time, moment, club, audience, language and prompt edition. It is written before launch. After completion, the exact response stays in that key and in any saved match containing it. See [Retained match insights](RETAINED_INSIGHTS.md) for archive and receiving behavior.

## Original model transport

The guarded runner returns text. The worker validates the strict JSON decision and represents a tool choice with the official SDK's `Content.from_function_call`. The SDK executes the registered Python function and appends the corresponding result. It then asks the same custom chat client for the next model turn.

The current product has two allowed tools and at most three paid turns per workflow. The final turn follows up to two tool invocations. The application retains the original one-based turn IDs when resuming a completed response. A turn's job ID derives from the original worker workflow, turn number and exact prompt hash; a tool call ID derives from the same workflow, turn and tool.

A completed original `RESPONDED/end_turn/artifact_saved` record is read from its existing job path. A pending, partial or failed original outcome remains identifiable in the existing runner journal. Resolve that original state through its owning runner before continuing the operation.

The bridge keeps the Node operation ID and Python workflow ID separately. It checks the worker's exact context, pinned SDK, prompt edition, model, completed turn identities and actual tool invocation record before admitting the finished text. The original display guard permits quantities from the selected counterpress moment, its evidence-event times, observed count and displayed match statistics. The caption keeps its 135-character limit; the full insight keeps its original 700-character, one-to-four-sentence limit. Both pass the same event, quantity, category and outcome checks.

## Runtime interfaces

`createOpusAgentInsight()` returns `configured()` and `request({sessionId,count,snapshot,events})`. Its application route is:

```text
POST /api/opus-agent-insight
Content-Type: application/json

{"sessionId":"<original live session>","count":15,"team":"Harbor FC","audience":"analyst","locale":"en"}
```

The server derives the snapshot and facts from the original session's observed prefix. A request cannot supply replacement event facts.

The ordinary response states are `pending`, `ready`, `busy` and `unavailable`. Ready responses include `caption`, `text`, the original source view, and the normalized retained `insight`. A resumed match can display its saved ready response with its current visible player session while preserving `originalSessionId`, original operation and provider records.

Worker input is one JSON object on stdin. Worker output is one JSON envelope on stdout. The application environment and local filesystem paths stay in the operator runtime.

## Source and original receiving case

The original SDK owner supplied the complete v3 application archive [F0C7ZTGUR4P](https://tokenjunkielabs.slack.com/archives/C0BVDDS04G2/p1791767633829729?thread_ts=1791589634.193009), SHA-256 `8e9e22ddf90418fcf607eec4ab876e224fbe1ec30a108ba84c4194ad8cb102df`, plus the [current three-file delta](https://tokenjunkielabs.slack.com/archives/C0BVDDS04G2/p1791771313024439?thread_ts=1791589634.193009), SHA-256 `754e26c7834ab4ce955d74b0706fffa3f5e5acc272ef469314d3a1ee5ae67481`.

This joined source incorporates that original worker, decision protocol, canonical-quantity guard and bridge. It corrects the worker's final-turn boundary while retaining one-based job derivation, then integrates original result provenance, local operator launch, source-bound storage, saved-match receiving and coach review.

The original native case is the 941-event `high-press` match, seed 2026, count 15, moment `e011`, frame 57.7 seconds. Its event sequence contains loss at 53.7, three pressures, then the regain at 57.7. The original operation and provider history are retained in the [competition thread](https://tokenjunkielabs.slack.com/archives/C0BVDDS04G2/p1791589634193009). The completed receiving record names the accepted output's actual original session, worker workflow, provider jobs, source pin and exported match.
