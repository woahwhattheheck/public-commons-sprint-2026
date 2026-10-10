# Original pre-demo n8n agent readiness preflight (October 10, 2026)

A **working, dependency-free, locally run Node 22 ESM static workflow-export audit**, designed as the free/read-only **first step** of a *paid* one-agent reliability review. The actual target customer/source is public: [n8n Community paid QA & stress testing request, Oct 6, 2026](https://community.n8n.io/t/looking-for-n8n-ai-automation-specialist-paid-qa-stress-testing/319256). The request names n8n, Vapi, Twilio, ElevenLabs, LLMs, API/webhook integrations, and wants existing agents reviewed, **not rebuilt**, initially as one paid trial. The job post has heavy visible competition and **no evidenced acceptance, current buyer budget, signed SOW, or customer data**. The previous internal qualification/acceptance packet was released through `woahwhattheheck/commons` PR32727; this PUBLIC module is a **distinct implementable diagnostic**, not another seller/buyer contact claim.

## What exists

- `audit.mjs`: read-only CLI, no third-party packages, no external calls, no access to credentials, no client workflow edits. Accepts an **authorized single n8n workflow JSON export**, max 2 MiB. Produces deterministic sanitized JSON with original file SHA-256, node counts, main-edge count, generic node-index references and public node types. It deliberately **does not include names, parameters, URLs, request bodies, phone numbers, credential references or payloads** in the report.
- Structural gates: connection sources/targets, duplicate node names, enabled trigger count and reachability, required reachable Respond-to-Webhook path when a Webhook is configured for the `responseNode` reply mode.
- Review alerts: inactive workflow, no recognized trigger, missing production error workflow, disabled nodes, external side-effect retry duplicate risk, `continueOnFail` after side effects, and HTTP node timeout-policy review. These are **review requests**, not proof of insecure or broken runtime behavior.
- `example-workflow.json`: completely synthetic wiring example in the same field shape as an n8n workflow export (not from a customer or an installed n8n runtime).
- `test/audit.test.mjs`: one focused Node 22 regression covering real audit implementation, response wiring, broken graph, side-effect settings, no credential leakage, and malformed exports.
- `TRIAL_PACKET.md`: delivery boundary, dynamic authorized stress-test matrix, acceptance rubric and owner-review-only commercial hypothesis.

## One-command use

```bash
node audit.mjs example-workflow.json
node audit.mjs '/local/path/authorized-workflow-export.json' > audit-report.json
node --test test/audit.test.mjs
```

Exit `0` = no static blockers identified, **not** safe-to-launch; `2` = static blockers; `3` = input rejected. `summary.staticGraphValid` likewise does not establish delivery, latency, safety, customer readiness, auth/permissions, API success or successful call handling.

Input may itself include credentials and personal data, so **run locally within the customer's approved environment and do not upload exports into public CI, log raw JSON, email raw exports, or publish sample data**. Only sanitized audit report leaves the approved environment after buyer signoff. The program does not execute workflows. Node positions in findings (`N001`, `N002`, etc.) are relative to the original workflow's nodes array; they are sufficient for a reviewer holding the original authorized file to locate the exact issue. If a node's `type` metadata is confidential, treat the entire report as customer-confidential.

## Source and runtime boundaries

The code recognizes the exported `nodes[]` + `connections{}` shape and basic workflow settings; it is not n8n's own schema validator or complete static compiler, and it cannot prove an external error workflow is reachable, secure webhook signatures, voice transcript retention policies, or live provider behavior. A workflow may have non-`main` AI tool bindings that this generic main-edge reachability pass flags for review. The review should use a real authorized n8n instance, its actual executable workflow, its version and actual provider traces; see the [n8n workflow execution docs](https://docs.n8n.io/workflows/executions/all-executions/) and [n8n built-in security audit](https://docs.n8n.io/hosting/securing/security-audit/). Do **not** equate this lightweight checker with n8n's built-in instance security audit.

**No GitHub Actions workflows added or executed. No prospect contacted and no customer funds, paid API calls, DMs, trial agreement or invoice created.** Do not send `TRIAL_PACKET.md` without the owner's review of actual rate, deliverable, recipient, existing relationships, and sender approval.