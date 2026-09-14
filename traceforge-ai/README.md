# TraceForge AI

**Evidence-grounded incident copilot for engineers and operators.** TraceForge lets an AI propose incident hypotheses, but it does not let model confidence become truth by itself. Every finding claim must cite stable evidence line IDs, survive a second skeptic pass, and pass deterministic citation/support checks before TraceForge marks the claim `PASS`. Anything weaker remains `HOLD`. Model-generated summaries and suggested actions never inherit that status: both are explicit `REVIEW_ONLY` text for an operator to assess independently.

Built for the **AI Builders Hackathon 2026** / Best SaaS Product track. This repository subtree was created during the hackathon window.

## Why this exists

Incident response is full of plausible stories. An LLM can summarize logs quickly, but a fluent guess at 3:00 a.m. is still a guess. TraceForge makes provenance part of the product surface:

1. incident text is normalized and bound to a SHA-256 digest;
2. each physical line receives a stable evidence locator (`E0001`, `E0002`, …);
3. an **Investigator** proposes a review-only summary plus findings with citations and suggested human next actions;
4. a second-pass **Skeptic** accepts or rejects each evidence claim;
5. deterministic code checks citation existence, instruction-shaped evidence, and lexical claim support;
6. only claims that pass *all* gates become `CLAIM PASS`; the rest are `CLAIM HOLD`;
7. the model summary and every suggested action remain `REVIEW_ONLY` because neither has passed the claim gates;
8. every analysis ships with an offline-verifiable integrity receipt bound to the exact evidence, result, review boundaries, and model identity.

The local demo uses a deterministic rules surrogate so judges can run the full workflow with **zero API key and zero paid service**. Actual AI mode connects to an operator-configured OpenAI-compatible inference endpoint. The deterministic verification layer does not trust either model implementation.

## Run it

Requires Python **3.11+**. Runtime has no third-party Python dependencies.

```bash
python -m traceforge serve --host 127.0.0.1 --port 8080
```

Open `http://127.0.0.1:8080`, load the built-in synthetic incident, and click **Analyze incident**.

CLI demo:

```bash
python -m traceforge analyze examples/incident.txt --mode demo --json-out analysis.json
python -m traceforge verify analysis.json
```

### Live AI mode

Configure an authorized OpenAI-compatible endpoint, then select **Live AI endpoint** in the UI or pass `--mode live`:

```bash
export TRACEFORGE_BASE_URL='https://your-inference-host.example'
export TRACEFORGE_MODEL='your-model-id'
export TRACEFORGE_API_KEY='...optional bearer token...'
python -m traceforge analyze examples/incident.txt --mode live
```

Security boundaries for live mode:

- non-loopback endpoints must be HTTPS;
- URL-embedded credentials, query strings, fragments, and redirects are refused;
- bearer secrets are accepted only from the environment and are never included in durable receipts/model identity;
- requests/responses have hard byte and timeout ceilings;
- model JSON is duplicate-key/NaN/Infinity rejected and exact-schema validated;
- incident evidence is explicitly delimited as **untrusted data**, not instructions;
- model-generated summaries and actions remain review-only and are never represented as deterministically verified or authorized.

## Product architecture

```text
incident logs / notes
        │
        ▼
EvidenceDocument ── SHA-256 + E0001..En stable locators
        │
        ├────► Investigator model ── review-only summary + findings + citations
        │                                  │
        │                                  ▼
        └────────────────────────────► Skeptic model
                                           │
                                           ▼
                              deterministic claim verifier
                              ├─ citation exists?
                              ├─ evidence support ≥ threshold?
                              └─ skeptic ACCEPT?
                                           │
                                  ┌────────┴────────┐
                                  ▼                 ▼
                            CLAIM PASS          CLAIM HOLD
                                  │
                 summary + action stay REVIEW_ONLY
                                  │
                                  ▼
                             SHA-bound integrity receipt
```

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Adversarial behavior

The test suite exercises more than happy paths. It includes:

- fabricated but syntactically valid evidence IDs;
- stale model output bound to a different evidence digest;
- prompt injection text embedded inside incident logs;
- grounded claims carrying unrelated model actions that must remain review-only;
- grounded claims paired with unrelated false summaries that must remain review-only;
- weakly supported claims that a skeptic accepts anyway;
- skeptic rejection of otherwise grounded claims;
- duplicate JSON keys and invalid non-finite JSON;
- receipt tampering and checksum-correct malformed receipt envelopes;
- CRLF normalization and evidence/request bounds;
- unsafe live-model URLs and credential handling;
- a fake local OpenAI-compatible provider for actual HTTP adapter execution;
- API request/schema errors and browser-facing demo endpoint behavior.

Run:

```bash
python -m unittest discover -s tests -v
python -m compileall -q traceforge tests
node --check web/app.js
```

## Receipt scope

The receipt is an **integrity checksum**, not a signature or third-party attestation. `verify` proves that the supplied analysis body still matches the supplied receipt and current v1 schema. It does not prove that model-generated summary or action text is true, safe, or authorized. Those surfaces carry fixed receipt-bound `REVIEW_ONLY` records. Only individual `CLAIM PASS` findings have passed citation, support, and skeptic gates. Malformed, duplicate-key, non-finite, unknown-field, or type-invalid receipt packets fail closed and never become exceptions at the API boundary.

## Authority ceiling

TraceForge is a **human-operated analysis tool**. It has no code path that autonomously:

- runs shell commands or remote remediation;
- edits production infrastructure;
- sends email/chat/customer messages;
- purchases, pays, trades, books, signs, or contracts;
- mutates cloud/provider accounts.

Model summaries and suggested actions are unverified text only. An operator decides what to trust or do next after independent review.

## Judge flow

See [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) for a sub-three-minute demo and [`docs/SUBMISSION_DECK.md`](docs/SUBMISSION_DECK.md) for a ten-slide deck outline.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
