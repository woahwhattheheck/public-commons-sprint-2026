# TraceForge architecture and trust model

## Product boundary

TraceForge is intentionally smaller than an autonomous incident agent. It analyzes evidence and produces evidence-linked claims plus model-suggested human review steps. It does **not** execute remediation. That keeps the difficult trust boundary visible: the AI may reason, but deterministic code decides whether a claim is sufficiently grounded to display as verified. Suggested actions never inherit a claim verdict and always remain `REVIEW_ONLY`.

## 1. Evidence binding

`EvidenceDocument` normalizes CRLF/CR to LF, rejects NUL, caps the evidence at 256,000 UTF-8 bytes / 5,000 lines, assigns line locators in source order, and hashes the resulting canonical text. A model result must echo that exact digest. A response for an older packet therefore cannot be silently replayed against new evidence.

The incident packet is untrusted. Prompts label it `<UNTRUSTED_EVIDENCE>` and tell the model not to execute instructions contained inside. The product does not rely on prompt wording as its only defense: model output still passes strict schema and evidence gates afterwards.

## 2. Two model roles

### Investigator

Returns strict JSON with a summary and up to 12 findings. Every finding requires:

- short stable finding ID;
- claim;
- severity;
- one to eight evidence line IDs;
- suggested human next action.

The action is retained for operator review but is never represented as evidence-verified or authorized.

### Skeptic

Receives the investigator result plus the same immutable evidence packet. It must return exactly one `ACCEPT` or `REJECT` verdict per finding claim. Missing, duplicate, extra, or stale verdicts fail the whole analysis rather than degrading silently. A skeptic verdict covers the evidence claim, not the safety or authority of the suggested action.

The local demo implementation is explicitly a deterministic rules surrogate, not a learned model. Live mode uses the OpenAI-compatible adapter.

## 3. Deterministic claim verification

A finding claim is `PASS` only when all of these are true:

1. every cited line ID exists in the current evidence document;
2. instruction-shaped log text cannot support ordinary operational conclusions (but can support a finding about prompt/instruction injection);
3. lexical overlap between the claim and eligible cited text reaches the minimum support score;
4. the skeptic returns `ACCEPT`.

The lexical check is deliberately conservative and explainable; it is not claimed to prove causality. Its purpose is to stop obviously untethered claims even when two model passes agree. `HOLD` is a first-class claim state, not an error to hide.

No deterministic evidence-overlap test can prove a proposed operational action safe. Every finding therefore carries a separate receipt-bound action object with `status: REVIEW_ONLY` and a fixed reason requiring independent human assessment. The browser labels the verdict `CLAIM PASS` / `CLAIM HOLD` and renders the model action in a distinct review-only block.

## 4. Receipt model

The complete analysis core—including the action review boundary—is canonical-JSON serialized and SHA-256 hashed. The receipt records:

- exact evidence digest;
- exact analysis digest;
- redacted model identity (host/model, never bearer secret);
- run ID derived from analysis digest.

`verify_receipt()` exact/type validates the v1 envelope before nested access, then recomputes the digest offline. Ordinary mutation to summary, evidence, findings, action boundaries, verdicts, or model identity invalidates the receipt. Malformed envelopes return `False`; they do not raise through the API boundary.

The receipt is an integrity checksum, not a digital signature or external attestation. Anyone who can replace both an analysis and its checksum can create a different internally consistent packet. The verifier proves packet integrity and v1 shape, not authorship.

## 5. Live inference adapter

The stdlib HTTP adapter is bounded on purpose:

- absolute HTTP(S) URL only;
- plaintext HTTP only for loopback development;
- no URL credentials, query, or fragment;
- redirects rejected;
- 60-second maximum timeout;
- response body hard cap;
- API key via environment only;
- strict extraction of an OpenAI-compatible `choices[0].message.content` string.

TraceForge never stores the API key in receipts or browser APIs. `/api/config` only reveals whether live inference is configured and the model name.

## 6. Browser/API surface

The server exposes a fixed static allowlist rather than a filesystem path router. JSON requests are content-type and byte bounded. Request and receipt parsers use the API request ceiling rather than the smaller model-output ceiling, while model responses retain their independent 128,000-byte bound. The UI uses `textContent`, not HTML interpolation, for incident/model-derived strings. Responses carry a restrictive same-origin CSP, `nosniff`, `no-referrer`, and `no-store`.

Offline CLI verification uses the same duplicate-key and non-finite rejecting parser as the API before receipt shape validation.

## Failure philosophy

TraceForge prefers an explicit rejected analysis over a plausible one with missing provenance. Provider outage, malformed JSON, stale hashes, invalid citations, oversized bodies, unsupported fields, receipt shape confusion, and skeptic inconsistency all fail closed. A verified claim still does not authorize its model-suggested action.
