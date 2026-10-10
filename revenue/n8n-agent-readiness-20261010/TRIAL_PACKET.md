# Owner-review-only paid one-agent QA trial — UNSENT

## Exact buyer signal and chronology

- First-party [buyer request](https://community.n8n.io/t/looking-for-n8n-ai-automation-specialist-paid-qa-stress-testing/319256): original author cobasuyi, October 6, 2026, requests a review and stress-test of an **already built** n8n/AI agent **before paying-client demos**, using Vapi, Twilio, ElevenLabs, OpenAI/Claude, webhooks and API integrations. Requests an initial paid trial for **one existing agent** with possibility of follow-on work; prospective applicants were asked for rate, time zone, relevant experience and examples. The public thread had over 100 replies by Oct 10; opportunity remains **unqualified** until buyer confirms that hiring is open and scope, price and test access are agreed. No client identity, industry, acceptance or historical claims inferred.
- Already released internal source-only original lead packet: `woahwhattheheck/commons#32727` (Oct 9), source author retains exact buyer relationship, sender, messaging and commercial authorization. This public runnable diagnostic is an additive technical artifact only.

## One-agent paid trial: conditional proposal (not agreed or offered)

Suggested commercial *hypothesis* for founder review: **$325 fixed for one limited pre-demo audit and controlled regression session**, delivered within **two business days after** an authorized representative supplies one redacted workflow export, a version-pinned sandbox and access to **buyer-funded** test integrations with test phone numbers/cost caps. No extra agent, rebuild or production data access. Cash, scope, schedule and language are subject to negotiation; time zone and real operator availability must be checked before offering. Static checker alone does **not** justify claiming the entire trial completed.

Acceptance deliverables proposed:

1. SHA-256-attested, redacted read-only static export preflight from `audit.mjs`, precise blockers/reviews, and a remediation priority ordered by buyer demo failure risk.
2. **Live, real-source acceptance** on their *existing* n8n workflow and actual authorized Vapi/Twilio/ElevenLabs/LLM integrations: agreed trace IDs, test number/account, provider latency/cost ceilings, version, timezone, credentials and data-retention rules. Owner approves execution before any calls.
3. One reproducible before/after evidence table, with timestamped request IDs where the provider exposes them, redacted inputs, observed outputs, no invented pass/fail. Classify `PASSED`, `FAILED`, `UNTESTED`, `BLOCKED`, and `NOT_APPLICABLE` separately.
4. A written go/no-go recommendation for the client's demo, bug reproduction for failures, and a concise prioritized fix list. Fixes beyond the agreed scope require a separately priced change.

## Dynamic test plan — MUST run on real authorized client stack to claim proof

| ID | Real scenario | Minimum acceptance evidence |
| --- | --- | --- |
| D01 | Baseline clean voice session | Official provider call/trace IDs, customer-intended response, measured latency |
| D02 | Empty/silent utterance | No unsafe tool action; documented fallback/re-prompt |
| D03 | Barge-in / overlapping speech | Consistent turn handling, no duplicate tool action |
| D04 | Speech-to-text low-confidence/corrupted turn | Escalation/clarification rather than invented facts |
| D05 | LLM or tool API timeout | Bounded timeout and caller-facing non-success outcome |
| D06 | ElevenLabs TTS unavailable/slow | Error or approved fallback; no bogus completed-call status |
| D07 | Twilio webhook duplicate/replay | Deduplicated side effects with verified idempotency key/store |
| D08 | Twilio/Vapi webhook tampered signature | Rejected before processing and evidence of security configuration |
| D09 | Provider 429/backoff | Controlled retry only if operation idempotent, bounded attempts |
| D10 | Unexpected JSON/body schema | Validate and handle without sensitive log echo |
| D11 | Simultaneous two call sessions | No cross-session state or customer data leakage |
| D12 | Agent tool invocation with changed argument | Confirm policy gate and actual downstream response |
| D13 | Human handoff / escalation | Correct trigger, fallback path and owner alert receipt |
| D14 | Partial Twilio send succeeded but acknowledgment lost | No unapproved duplicate charge/action on re-delivery |
| D15 | Unknown intent/out-of-domain prompt | No fabricated commitments, maintains customer brand rules |
| D16 | Shutdown/forced worker restart (sandbox only) | Recovery behavior and durable queue/state semantics documented |

These are **acceptance scenarios, not test results**. Actual official provider API capabilities, legal call consent, client-authorized phone numbers, costs, and local data/privacy requirements must be confirmed first. With missing credentials or restricted provider functionality, mark untested rather than pretending a surrogate simulator is 1:1.

## Owner review response concept — NOT SENT

> You asked for one **paid pre-demo QA trial**, not a rewrite of your n8n agents. We have a dependency-free audit tool for exported workflow control paths, plus a 16-scenario live acceptance matrix covering webhook duplicates, voice interruptions, provider errors, timeouts and human handoff. The audit report is redacted and source-hashed; any pass/fail claims would come only from agreed tests on your actual sandbox Vapi/Twilio/ElevenLabs stack. Would a fixed one-agent review be useful if we first agree the exact workflow, required access, budget and demo deadline? I can share a one-page example audit and the acceptance plan for review.

**Do not send this** absent founder approval of exact prospect, channel/recipient, sender identity, operator credentials/experience assertions, quoted amount, scope and relationship collision check. Do not volunteer false previous client results, stress-test throughput or live provider experience. This is a source-backed prospect opportunity, **not earned revenue**.

## Repeatability across similar jobs

Use the artifact as a *presales technical proof* rather than generate another generic lead memo. For each actual source-backed customer: verify current intent and a paid budget; check Slack/Gmail relationship custody and current owner; offer one narrow reproducible pilot; show an original executable diagnostic and real-source acceptance matrix; founder approves exact communication; after a genuine reply and contract, run authorized integration verification and bill on documented acceptance. Keep the paid-trial stage distinct from the number of code packages created.
