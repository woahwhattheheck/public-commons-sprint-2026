# EvidenceForge — <=3-minute public demo storyboard

This is a capture plan, not evidence that a provider call, public deployment, video upload, or competition submission has occurred.

## Capture prerequisites

- Authorized Nebius Token Factory credential available only in the runtime environment.
- `NEBIUS_MODEL` set to a live NVIDIA/Nemotron model returned by `/v1/models`.
- A provider-backed demo endpoint tested immediately before recording.
- No API key, secret, private repository data, or internal orchestration URL visible on screen.
- Real provider response ID, model ID, timestamp/run log, and EvidenceForge receipt retained separately for submission evidence.

## 0:00–0:20 — Problem and authority boundary

Show the EvidenceForge browser page and say, in substance:

> Coding agents are fast, but model text should not become production authority. EvidenceForge lets a human declare the allowed files, exact tests, and write budget before the model proposes anything.

On screen: one allowed path, required tests, and `max_writes=1`.

## 0:20–0:55 — Real Nebius/NVIDIA plan

Trigger the authorized Token Factory-backed plan generation. Show the selected NVIDIA/Nemotron model identity and the returned structured plan without exposing credentials.

Call out that EvidenceForge checks the live model inventory rather than relying on a stale hard-coded model identifier.

## 0:55–1:25 — Fail-closed hostile plan

Switch to a malicious sample containing at least one of:

- `../secret` path traversal;
- an undeclared shell-style test;
- an extra approval/authority field.

Show EvidenceForge rejecting it before sandbox execution. Keep the rejection concise enough to remain legible in the recording.

## 1:25–2:05 — Admitted sandbox execution

Run the valid plan through the isolated sandbox contract. Show the declared read/write/test operations and that the write count stays within the human budget.

Do not imply that this changes a production repository; the demo should visibly remain within the bounded sandbox path.

## 2:05–2:35 — Receipt and verification

Open the emitted `evidenceforge-receipt/v1`. Highlight content hashes for the executed evidence and run the verifier.

Show a successful verification, then point to:

- `real_repository_mutation=false`
- `human_approval_required=true`

The result is evidence of what ran, not self-granted deployment approval.

## 2:35–2:55 — Why it matters

Close with the product value:

> EvidenceForge turns an NVIDIA/Nemotron coding plan into bounded, replayable execution evidence. A bad plan fails closed; a good plan still needs human approval before real-world mutation.

## 2:55–3:00 — End card

Show only project-specific public destinations needed by judges: project name, public source repository, and public demo URL. Do not show internal coordination surfaces.

## Recording acceptance check

Before publishing the video, verify all of the following:

- total duration <=3:00;
- the project visibly functions, not just slides;
- the real Token Factory/NVIDIA step is actually shown;
- the provider-backed demo URL still works;
- no secret or private data appears in frames, captions, terminal scrollback, or browser history;
- the source repository and license are public;
- claims match retained provider/run evidence;
- tooling feedback in the final submission is based on the real run shown here.
