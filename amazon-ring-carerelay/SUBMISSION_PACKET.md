# CareRelay submission / demo packet

Status: **SOURCE_READY / PROVIDER_EXECUTION_REQUIRED / OWNER_ACTION_REQUIRED**

## 3-minute demo skeleton

1. **Problem (20s)** — caretaking/accessibility automations should not require identifying people or silently triggering physical side effects.
2. **Ring event (30s)** — use the official Ring simulator/test account to emit a doorbell or motion event; show only minimal normalized event facts in CareRelay.
3. **Bounded decision (45s)** — show deterministic proposal generation and explicit human approval/rejection.
4. **Privacy/evidence (35s)** — show rejection of identity/video fields and verify the content-addressed receipt.
5. **Real Ring runtime (30s)** — demonstrate the documented Ring integration through the official simulator/API; optionally show WHEP video-session negotiation without retaining footage.
6. **Impact + limitations (20s)** — accessibility/caretaking use case, human control, provider execution evidence, and current limitations.

## Product feedback — MUST be filled from real use, not invented

- Tools/APIs/SDKs used and why: **PENDING PROVIDER RUN**
- What worked well: **PENDING PROVIDER RUN**
- What needs work: **PENDING PROVIDER RUN**
- Zero-to-hello-world onboarding experience: **PENDING PROVIDER RUN**
- Would build with Ring again? **PENDING PROVIDER RUN**

## Friction log — evidence only

Do not pre-fill speculative complaints. For each real provider interaction capture:

- task attempted;
- steps taken;
- expected result;
- actual result;
- severity;
- workaround;
- actionable suggestion;
- non-secret evidence reference.

## Judge-facing technical proof already available

- strict privacy-minimized event contract;
- duplicate-key / nonfinite / unknown-field / PII rejection;
- idempotent event replay and event-ID collision rejection;
- proposal-only authority model;
- human approval records that still do not claim external action execution;
- content-addressed state receipt + tamper verifier;
- exact WHEP endpoint runtime client with bounded SDP and strict HTTP semantics;
- deterministic offline demo; normal + optimized hostile tests.

## Remaining owner/provider gates

- Devpost join/terms.
- Ring developer/test account or official simulator access.
- Actual runtime provider evidence.
- Public demo video.
- Final Devpost submission.

Those gates are not implied by source readiness.
