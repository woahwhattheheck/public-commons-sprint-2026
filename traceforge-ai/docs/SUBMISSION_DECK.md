# TraceForge AI — 10-slide submission deck

## 1. TraceForge AI
**Make the model show its work.** Evidence-grounded incident copilot for engineering teams.

Visual: product hero + PASS/HOLD finding card.

## 2. The failure mode
Modern incident response has too much telemetry and too little trusted synthesis. LLMs accelerate triage but can invent causal stories, cite the wrong context, or obey prompt-injection-shaped text embedded in logs.

Visual: “fast answer” vs “auditable answer.”

## 3. Product
Paste incident evidence → Investigator proposes findings → Skeptic challenges → deterministic verifier promotes only grounded findings → integrity receipt binds the output.

Visual: four-stage architecture.

## 4. Evidence contract
- stable `E0001…` source locators;
- exact evidence SHA-256;
- strict structured model output;
- stale-response rejection;
- citation existence and support scoring;
- `HOLD` as first-class state.

## 5. Two-pass AI, deterministic final gate
The AI can reason broadly. It cannot mint its own proof. Investigator + Skeptic are necessary inputs; deterministic code owns the final status.

Visual: two AI arrows entering one deterministic gate.

## 6. Security / trust
- incident text explicitly untrusted;
- prompt injection remains data;
- no autonomous remediation;
- bounded network/model I/O;
- env-only credentials, redacted identity;
- restrictive browser/API surface;
- offline receipt verification.

## 7. Demo result
Use the synthetic checkout incident. Show timeout, 503, latency spike, injection line, rollback, recovery. Capture one grounded PASS and one adversarial HOLD test result.

## 8. SaaS path
Team workspaces → incident timeline/history → read-only connectors → verifier policy profiles → team evaluation and quality metrics → enterprise evidence retention.

Business model: per-seat + incident-volume tiers, with a self-hosted/enterprise option for sensitive telemetry.

## 9. Why now / differentiation
AI incident copilots are becoming normal; auditable trust contracts are not. TraceForge is model-provider-agnostic and treats verification as product infrastructure rather than a prompt trick.

## 10. Ask / next milestone
Pilot with SRE/platform teams. Add authenticated multi-tenant workspaces and read-only telemetry snapshots while preserving the invariant: **no claim is stronger than its evidence**.

Footer: Apache-2.0 core · AI Builders Hackathon 2026 · Best SaaS Product target.
