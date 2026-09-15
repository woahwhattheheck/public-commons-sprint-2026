# TraceForge AI — AI Builders submission packet

> Status: **READY FOR HUMAN ACCOUNT/VIDEO CLOSEOUT; NOT SUBMITTED.** This packet does not attest eligibility, accept Devpost terms, identify teammates, upload media, claim a prize, or claim payment.

Operation: `AI-BUILDERS-TRACEFORGE-SUBMISSION-PACKET-ZNKR7W4-20260914`

## Deadline and external requirements

Checked against the official Devpost overview/rules on 2026-09-14:

- Competition: **AI Builders Hackathon**
- Deadline: **2026-09-15 23:00 EDT**
- Target award: **Best SaaS Product — $4,000 cash, 1 winner**
- Required submission materials: project title/description; publicly accessible source repository; demo video (**3–5 minutes recommended**); documentation explaining problem, solution, and technology; team-member details.
- Judging criteria: innovation/originality; technical implementation; real-world impact; user experience/design; scalability/feasibility.

Official sources:

- https://ai-builders-hackathon-2026.devpost.com/
- https://ai-builders-hackathon-2026.devpost.com/rules

**Eligibility is a human gate.** The public Devpost surfaces have shown inconsistent wording: the rules list developers, engineers, founders, open-source contributors, and other builders, while another registration-facing surface has displayed “Students only”; an organizer discussion described that display as an issue. Do not convert that inconsistency into an eligibility claim. The participant must confirm the authenticated registration state and any attestations before submitting.

## Copy/paste project fields

### Title

TraceForge AI

### One-line description

Evidence-grounded incident copilot with deterministic claim verification.

### Project description

TraceForge AI is a human-operated incident copilot for engineers and operators. Incident response is full of plausible stories: a language model can summarize logs quickly, but fluent output is not proof. TraceForge makes evidence provenance part of the product surface.

The product normalizes incident notes and logs, binds them to a SHA-256 digest, and assigns every physical line a stable evidence locator. An Investigator model proposes a review-only summary plus cited findings and suggested human next actions. A separate Skeptic pass challenges each evidence claim. Deterministic code then checks that citations exist, rejects instruction-shaped evidence, measures lexical claim support, and requires the skeptic verdict before an individual finding may become `CLAIM PASS`. Anything weaker remains `CLAIM HOLD`.

The trust boundary is explicit: model-generated summaries and suggested actions never inherit a verified claim state. They remain receipt-bound `REVIEW_ONLY` text for an operator to assess independently. Every analysis includes an offline-verifiable integrity receipt bound to the exact evidence, analysis result, review boundaries, and model identity.

Judges can use the full deterministic demo without an API key or paid service. For live AI, an operator may configure an authorized OpenAI-compatible HTTPS endpoint. TraceForge keeps credentials environment-only, rejects unsafe endpoint shapes and malformed model JSON, and never autonomously executes remediation or mutates infrastructure.

### Live demo

https://traceforge-ai-production.up.railway.app

### Public source

https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/traceforge-ai

### Documentation

- Product/readme: `traceforge-ai/README.md`
- Architecture: `traceforge-ai/docs/ARCHITECTURE.md`
- Demo script: `traceforge-ai/docs/DEMO_SCRIPT.md`
- Submission deck: `traceforge-ai/docs/SUBMISSION_DECK.md`

### Technology

- Python 3.11+ standard-library runtime
- browser dashboard served by TraceForge
- optional OpenAI-compatible inference adapter
- deterministic citation/support/skeptic verifier
- SHA-256-bound integrity receipts
- adversarial `unittest` regression suite

## Judge-criteria map

| Criterion | Demonstration | Proof surface |
| --- | --- | --- |
| Innovation / originality | Model claims are separated from deterministic evidence verification; summaries/actions are explicitly review-only. | README trust-boundary description; live verdict UI; receipt. |
| Technical implementation | Stable evidence IDs, two-pass Investigator/Skeptic flow, strict model/receipt parsing, deterministic claim gates. | `traceforge-ai/traceforge/**`, tests, architecture doc. |
| Real-world impact | Reduces the chance that fluent but unsupported incident hypotheses are presented as trusted operational conclusions. | Built-in incident demo; PASS/HOLD behavior. |
| UX / design | Browser flow makes evidence, verdicts, review-only surfaces, and receipt verification visible to operators. | Hosted demo. |
| Scalability / feasibility | Dependency-light runtime; deterministic local mode; optional authorized OpenAI-compatible endpoint; CLI + browser surfaces. | README runbook and live configuration boundary. |

## Source-to-demo binding

The hosted deployment was created from repository commit:

`9c51622893e93af5e7247bea42790f7ed1c2abf2`

At packet creation, both that deployment commit and then-current repository main resolve the `traceforge-ai` subtree to the exact Git tree:

`8b23ad6a894c7afd29e65407ae3ae8440744fd33`

This packet intentionally lives **outside** `traceforge-ai/**`, so adding submission metadata does not mutate the code/docs subtree served by the deployment.

Run the fail-closed proof before final submission:

```bash
python submission-packets/ai-builders-traceforge/verify.py --repo-root .
```

A successful result requires all of the following:

1. the deployment commit still resolves `traceforge-ai` to the pinned tree;
2. current `HEAD` resolves `traceforge-ai` to the same pinned tree;
3. current and deployed trees are identical;
4. packet completion claims remain false in source;
5. account/eligibility/video/submit gates remain marked `PENDING_HUMAN`.

If the verifier fails, do **not** describe the live demo as source-identical to current submitted source until the mismatch is reconciled.

## 3–5 minute recording cut sheet

The existing `traceforge-ai/docs/DEMO_SCRIPT.md` is the canonical product script. For the Devpost recommendation, target roughly **3:15–3:45** by preserving the product flow and adding brief architecture/verification context rather than inventing features.

1. **0:00–0:25 — Problem.** Incident response produces persuasive stories faster than proof. State TraceForge's claim/action trust boundary.
2. **0:25–0:55 — Evidence.** Open the hosted demo, load the synthetic incident, show stable evidence IDs and digest-bound input.
3. **0:55–1:45 — Analyze.** Run deterministic demo analysis. Show Investigator findings, Skeptic result, and why individual claims become PASS or HOLD.
4. **1:45–2:20 — Safety boundary.** Show that summaries and suggested actions remain `REVIEW_ONLY`; TraceForge does not execute remediation.
5. **2:20–2:55 — Receipt.** Export or display the analysis receipt and verify it. Explain that receipt integrity is not a signature or truth oracle.
6. **2:55–3:25 — Architecture / feasibility.** Briefly show the README architecture and optional OpenAI-compatible live mode with environment-only credentials.
7. **3:25–3:40 — Close.** “TraceForge makes AI useful during incidents without asking operators to confuse model confidence with evidence.”

Recording rule: show only behavior actually present in the hosted build/source. Do not describe an unconfigured live model as active when `liveConfigured` is false.

## Final human closeout checklist

- [ ] Sign in to the intended Devpost participant account and confirm the account is registered for the hackathon.
- [ ] Personally review eligibility, current rules, and any participant/team attestations; resolve the inconsistent public eligibility display rather than guessing.
- [ ] Fill team-member details from real account/user data. Do not invent teammates or emails.
- [ ] Record/upload an accessible demo video. 3–5 minutes is the organizer's current recommendation.
- [ ] Run `python submission-packets/ai-builders-traceforge/verify.py --repo-root .` against the exact source generation you will link.
- [ ] Confirm the live URL loads and the demo endpoints behave as expected immediately before submission.
- [ ] Paste the project fields above, attach/link the public repository, video, and documentation/deck.
- [ ] Review the final preview for unsupported claims, secrets, private incident data, or stale URLs.
- [ ] Personally accept any Devpost terms/attestations and press **Submit** before 2026-09-15 23:00 EDT.
- [ ] After submission, record the immutable Devpost project URL/receipt in the coordination channel; only then change status from “not submitted.”

## What is deliberately not claimed

This repository packet does not claim that a Devpost project has been submitted, that the owner is eligible, that all team members are registered, that a video has been uploaded, that TraceForge won an award, or that any money has been earned. Those are external facts and stay false until independently evidenced.
