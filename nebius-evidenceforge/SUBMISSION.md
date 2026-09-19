# Nebius × NVIDIA submission gate

Capture date for this file: 2026-09-17 EDT. Re-open the official rules immediately before any registration or submission.

## First-party rules pinned during build

- Submission deadline: **2026-10-30 10:00 PDT**.
- Project must make a runtime call to Nebius Token Factory **or** be deployed/run with Nebius AI Cloud compute, and use at least one NVIDIA open-source model.
- Coding and Agentic Engineering is an eligible track.
- Submission requires a project description, public source repository, open-source license, and README with setup/run instructions.
- A working demo URL is required.
- A public YouTube demo must be **3 minutes or less** and show the project functioning.
- The submission should explain how Nebius/NVIDIA tooling is used and include feedback on that tooling.
- If the project existed before the submission period, the submission must explain the significant updates made during the eligible period.
- Judging criteria are equally weighted: technological implementation, design, potential impact, and quality of idea.
- Overall cash prizes include $20,000 grand, $10,000 second, and $6,000 third; track/bonus prizes have separate eligibility.

Sources:
- https://nebiusglobalaihackathon.devpost.com/
- https://nebiusglobalaihackathon.devpost.com/rules
- https://docs.tokenfactory.nebius.com/api-reference/introduction

## Current readiness ledger

| Gate | State | Evidence / next event |
| --- | --- | --- |
| Coding & Agentic Engineering track fit | READY | coding-agent control plane + sandbox contract |
| Public OSS source | READY | public repository, MIT license at repository root |
| Setup/run README | READY | `README.md` |
| Deterministic offline product | READY | CLI + browser demo |
| Hostile tests | READY | normal and `python -O` suites |
| Submission description source material | READY | README + architecture + this ledger |
| <=3m video capture plan | READY | `DEMO_STORYBOARD.md` |
| Live NVIDIA/Nemotron model present in Token Factory | RUNTIME_CHECK_REQUIRED | adapter verifies `/v1/models` |
| Real Token Factory inference | **PROVIDER_EXECUTION_REQUIRED** | no provider call claimed by offline fixture |
| Provider-backed working demo URL | REQUIRED | not created by this source lane |
| Tooling feedback from real provider use | REQUIRED | must be written from actual Token Factory/NVIDIA experience |
| Public <=3m YouTube demo | OWNER_ACTION_REQUIRED | storyboard exists; video not uploaded |
| Devpost registration / rules acceptance | OWNER_ACTION_REQUIRED | not performed |
| Final Devpost submission | OWNER_ACTION_REQUIRED | not performed |
| Prize / payment | NOT_AWARDED | advertised prizes are not revenue |

## Final submission field checklist

Before pressing submit, bind every external field to an actual artifact rather than a placeholder:

- **Project name:** EvidenceForge.
- **Track:** Coding and Agentic Engineering.
- **One-line description:** evidence-gated coding agents that turn model plans into bounded sandbox actions and content-addressed receipts without granting the model production authority.
- **Public source URL:** use the public repository URL containing this project and its MIT license.
- **Working demo URL:** insert only after a real public demo endpoint is live and re-tested.
- **YouTube URL:** insert only after the <=3-minute public video is uploaded and playable without private access.
- **Nebius/NVIDIA explanation:** name the exact live NVIDIA/Nemotron model and the Token Factory runtime path actually exercised.
- **Provider evidence:** retain response ID, model ID, timestamp/run log, and receipt generated from the real call.
- **Tooling feedback:** write concrete observations from the live Token Factory/NVIDIA run; do not fabricate feedback from the offline adapter.
- **Significant-update statement:** describe the competition-period EvidenceForge product work actually present in the submitted repository: provider adapter, strict plan admission, sandbox execution contract, content-addressed receipts, hostile suite, browser demo, and submission materials. Do not claim dates or pre-existing work beyond retained repository history.

## Demo narrative

The <=3-minute public demo should follow `DEMO_STORYBOARD.md` and prove, in order:

1. A human declares one allowed code path, exact required tests, and a write limit.
2. A real Token Factory/NVIDIA response proposes a strict JSON plan.
3. EvidenceForge rejects a malicious plan that attempts path traversal, an undeclared shell-style test, or an injected approval field.
4. The admitted plan executes inside the isolated sandbox contract.
5. A content-addressed receipt is emitted and verifies cleanly.
6. The receipt still says `real_repository_mutation=false` and `human_approval_required=true`, demonstrating that successful model/test output does not self-authorize deployment.

## Submission truth fence

Do not change `PROVIDER_EXECUTION_REQUIRED`, `OWNER_ACTION_REQUIRED`, or `NOT_AWARDED` merely to make the checklist look complete. A gate changes only after the corresponding provider/account/publication event has actually occurred and its evidence is retained.
