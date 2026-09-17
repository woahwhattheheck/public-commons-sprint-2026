# Nebius × NVIDIA submission gate

Capture date for this file: 2026-09-17 EDT. Re-open the official rules immediately before any registration or submission.

## First-party rules pinned during build

- Submission deadline: **2026-10-30 10:00 PDT**.
- Project must make a runtime call to Nebius Token Factory **or** be deployed/run with Nebius AI Cloud compute, and use at least one NVIDIA open-source model.
- Coding and Agentic Engineering is an eligible track.
- Public source repository + open-source license + setup README are required.
- Working demo URL is required for this track.
- Public YouTube demo must be <=3 minutes.
- Judging criteria are equally weighted: technological implementation, design, potential impact, quality of idea.
- Overall cash: $20,000 grand, $10,000 second, $6,000 third; additional bonus/city/feedback prizes have separate eligibility.

Sources:
- https://nebiusglobalaihackathon.devpost.com/
- https://nebiusglobalaihackathon.devpost.com/rules
- https://docs.tokenfactory.nebius.com/api-reference/introduction

## Current readiness

| Gate | State | Evidence |
| --- | --- | --- |
| Public OSS source | READY | this MIT-licensed public repository |
| Deterministic offline product | READY | stdlib core + browser demo |
| Hostile tests | READY | normal and `python -O` suites |
| Live NVIDIA model present in Token Factory | RUNTIME_CHECK_REQUIRED | adapter verifies `/v1/models` |
| Real Token Factory inference | **REQUIRED** | no provider call claimed by offline fixture |
| Nebius-hosted/Token-Factory working demo URL | REQUIRED | not created by this source lane |
| Devpost registration / rules acceptance | OWNER_ACTION_REQUIRED | not performed |
| <=3m YouTube demo | OWNER_ACTION_REQUIRED | not uploaded |
| Final Devpost submission | OWNER_ACTION_REQUIRED | not performed |
| Prize / payment | NOT_AWARDED | advertised prizes are not revenue |

## Demo script outline

1. Show the human policy: one allowed parser file, two exact tests, one write.
2. Show a live Token Factory/NVIDIA response proposing the plan.
3. Show EvidenceForge reject a malicious variant that tries `../secret`, an undeclared shell test, or an extra `approved` field.
4. Execute the admitted plan in the isolated sandbox.
5. Open the receipt and verify its hash.
6. Highlight the authority ceiling: tests can be green while real repository mutation is still false pending human approval.

The final submission description should identify any pre-existing generic patterns reused from Commons and explain that this competition-specific EvidenceForge product, provider adapter, receipt contract, hostile suite, and demo experience were created/significantly updated during the hackathon submission period.
