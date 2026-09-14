# TraceForge AI

**Evidence-grounded incident copilot for engineers and operators.** TraceForge lets an AI propose incident hypotheses, but it does not let model confidence become truth by itself. Every finding must cite stable evidence line IDs, survive a second skeptic pass, and pass deterministic citation/support checks before TraceForge marks it `PASS`. Anything weaker remains `HOLD`.

Built for the **AI Builders Hackathon 2026** / Best SaaS Product track. This repository subtree was created during the hackathon window.

## Why this exists

Incident response is full of plausible stories. An LLM can summarize logs quickly, but a fluent guess at 3:00 a.m. is still a guess. TraceForge makes provenance part of the product surface:

1. incident text is normalized and bound to a SHA-256 digest;
2. each physical line receives a stable evidence locator (`E0001`, `E0002`, …);
3. an **Investigator** proposes findings with citations and next actions;
4. an independent **Skeptic** accepts or rejects each finding;
5. deterministic code checks citation existence, instruction-shaped evidence, and lexical support;
6. only findings that pass *all* gates become `PASS`; the rest are `HOLD`;
7. every analysis ships with an offline-verifiable receipt bound to the exact evidence, result, and model identity.

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
- incident evidence is explicitly delimited as **untrusted data**, not instructions.

## Product architecture

```text
incident logs / notes
        │
        ▼
EvidenceDocument ── SHA-256 + E0001..En stable locators
        │
        ├────► Investigator model ── structured findings + citations
        │                                  │
        │                                  ▼
        └────────────────────────────► Skeptic model
                                           │
                                           ▼
                              deterministic verifier
                              ├─ citation exists?
                              ├─ evidence support ≥ threshold?
                              └─ skeptic ACCEPT?
                                           │
                                  ┌────────┴────────┐
                                  ▼                 ▼
                                PASS               HOLD
                                  └────────┬────────┘
                                           ▼
                             SHA-bound analysis receipt
```

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Adversarial behavior

The test suite exercises more than happy paths. It includes:

- fabricated but syntactically valid evidence IDs;
- stale model output bound to a different evidence digest;
- prompt injection text embedded inside incident logs;
- weakly supported claims that a skeptic accepts anyway;
- skeptic rejection of otherwise grounded claims;
- duplicate JSON keys and invalid non-finite JSON;
- receipt tampering;
- CRLF normalization and evidence bounds;
- unsafe live-model URLs and credential handling;
- a fake local OpenAI-compatible provider for actual HTTP adapter execution;
- API request/schema errors and browser-facing demo endpoint behavior.

Run:

```bash
python -m unittest discover -s tests -v
python -m compileall -q traceforge tests
node --check web/app.js
```

## Authority ceiling

TraceForge is a **human-operated analysis tool**. It has no code path that autonomously:

- runs shell commands or remote remediation;
- edits production infrastructure;
- sends email/chat/customer messages;
- purchases, pays, trades, books, signs, or contracts;
- mutates cloud/provider accounts.

Suggested actions are text only. An operator decides what to do next.

## Judge flow

See [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) for a sub-three-minute demo and [`docs/SUBMISSION_DECK.md`](docs/SUBMISSION_DECK.md) for a ten-slide deck outline.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
