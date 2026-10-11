# EvidenceForge competition and source contract

Reviewed **2026-10-11 UTC** against the first-party sources linked below.

## Current official requirements

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) specify:

| Topic | Requirement |
| --- | --- |
| Submission window | August 26, 2026, 09:00–October 30, 2026, 10:00 Pacific. |
| Runtime | NVIDIA open-source model plus Token Factory inference or Nebius AI Cloud execution. |
| Track | Coding and Agentic Engineering. |
| Deliverables | Description, track, working demo/application/test-build URL, public licensed source and setup, public YouTube demonstration under three minutes, and tooling feedback. |
| Existing projects | Describe significant competition-period changes. |
| Judging access | Free through December 15, 2026, noon Pacific, with testing instructions and required credentials. |
| Entrant | Eligible individual/team/organization, authorized representative, original ownership, and permitted integrations; full eligibility terms apply. |
| Language | English or English translations. |
| Assessment | Four equal criteria: implementation, coherent product design, credible impact, and quality of idea. |

The rules are authoritative; this short implementation reference does not
replace their full terms. Use the existing entry at
[Devpost's project manager](https://devpost.com/submit-to/30790-nebius-x-nvidia-global-ai-hackathon/manage/submissions).

## Runtime and credential separation

The [Token Factory API introduction](https://docs.tokenfactory.nebius.com/api-reference/introduction)
documents the OpenAI-compatible base `https://api.tokenfactory.nebius.com/v1/`.
EvidenceForge's existing provider adapter reads its API key from the execution
environment and verifies the selected model against the current inventory.
The execution record preserves the requested model, actual response model,
response ID, creation time, finish reason, and returned usage.

The [official resources](https://nebiusglobalaihackathon.devpost.com/resources)
link credit offers and the [Builder Program](https://dev.nebius.com/builders).
An advertised offer is distinct from the existing account's actual credit
balance or expiry. Keep account allocation, API keys, and entrant details in
the existing private account workflow. They do not belong in a public source
archive, video frame, or result download.

## Original source to compose

| Source | Role |
| --- | --- |
| [provider.py](evidenceforge/provider.py) | Current inventory, strict provider plan, and response provenance |
| [workloads.py](evidenceforge/workloads.py) | Frozen task source, goals, checks, and authored controls |
| [focused_execution.py](evidenceforge/focused_execution.py) | Original native execution, operation artifacts, and result verification |
| [web_runtime.py](evidenceforge/web_runtime.py) | Maintained local application entrypoint |
| [README.md](README.md) | Current install/run and reviewer instructions |
| [FOCUSED_EXECUTION.md](FOCUSED_EXECUTION.md) | Supported tasks, execution limits, and actual artifact semantics |
| [SUBMISSION.md](SUBMISSION.md) | Description, selected result, feedback, and final external destinations |
| [DEMO_STORYBOARD.md](DEMO_STORYBOARD.md) | Native capture and publication plan |

The original native runtime was released in
[PR178](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/178)
at `b210a5d2cf676e3c45ea034c68f766a9e778cdef`.
The retained browser workflow was released in
[PR813](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/813)
at `6c7d13f2cbf922f7ecea829feff6d7312446fc98`.
The public repository's
[MIT license](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/LICENSE)
was read at blob `2d2a35a69e3896b7c6b885c1faebae2f2f8bc9c1`.

The current team work extends that application. Keep one submitted revision,
one selected provider operation, and the matching result in the test build and
video. A replay reads saved provider metadata; the original runtime record
identifies the observed inference. The executable checks use the actual
curated source, and authored controls remain labeled as controls.

## Delivery composition

The portable build should include the application, required source and assets,
the existing MIT license, setup/run instructions, and the selected public-safe
operation artifacts. A reviewer should be able to inspect the retained result
and run the task's local checks without a provider key. Fresh inference uses
the configured operator environment. Never include that credential in the
build or imply that a loopback-only service is a public hosted application.

The executor is a restricted runner for the included small Python workloads.
Its check/source boundaries do not make it an operating-system security
sandbox or an arbitrary-repository agent. The demonstration and description
should use the functionality the delivered build actually supplies.
