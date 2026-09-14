# TraceForge AI — 2:30 demo script

## 0:00–0:20 — Problem

“Incident teams already have dashboards and logs. The dangerous gap is what happens next: an AI can give a beautiful explanation that nobody can audit under pressure. TraceForge makes evidence provenance part of the analysis, not an afterthought.”

Show the landing page and the four-step workflow: **Bind evidence → Investigate → Skeptic review → Verify**.

## 0:20–0:45 — Load messy evidence

Click **Load demo**. Point out:

- deploy event;
- p95 latency spike;
- database timeout lines;
- 503 response;
- a malicious-looking line saying “ignore prior instructions…”;
- rollback and recovery evidence.

Say: “Every line is treated as untrusted evidence. That injection-like sentence is data, never authority.”

## 0:45–1:25 — Analyze

Run **Deterministic demo** first so the demo needs no API account. Explain that the zero-key surrogate exists only for reproducibility; live mode uses an operator-configured OpenAI-compatible model.

Show each finding:

- stable evidence citations;
- support percentage;
- skeptic ACCEPT/REJECT;
- final PASS or HOLD;
- suggested next human action.

Emphasize: “The model cannot self-declare PASS. Deterministic code recomputes whether citations exist and whether the cited text actually supports the words in the claim.”

## 1:25–1:50 — Prove HOLD semantics

Explain that stale evidence, fabricated citations, weak grounding, or a skeptic rejection produce `HOLD`. “TraceForge would rather say *we do not have enough evidence* than manufacture certainty.”

## 1:50–2:10 — Integrity receipt

Open **Integrity receipt**. Show evidence SHA, analysis SHA, redacted model identity, and run ID. The browser automatically posts the complete result to `/api/verify` and displays **Receipt verified** only when the digest recomputes.

CLI alternative:

```bash
python -m traceforge analyze examples/incident.txt --mode demo --json-out /tmp/traceforge.json
python -m traceforge verify /tmp/traceforge.json
```

## 2:10–2:30 — SaaS wedge

“Today this is a focused incident copilot. A team product adds authenticated workspaces, incident history, connectors for read-only log snapshots, evaluation dashboards, and policy-tuned verifier profiles. The moat is not another chat box; it is a durable evidence contract around AI-assisted operations.”

End on the authority ceiling: TraceForge recommends; humans execute.
