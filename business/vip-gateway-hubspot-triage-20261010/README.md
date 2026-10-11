# VIP Gateway HubSpot Pipeline Intelligence | Nonbounty real buyer engineering

A complete local manager workspace for the buyer's published sales-pipeline problem, composed around the maintained original read-only triage engine. It now includes native HubSpot source capture, retained analysis and manager review, approved task/note creation, receipt reconciliation, browser/CLI operation and private project recovery. See the [operator guide](workspace/README.md) for the runnable product. The engineering workflow has been exercised on explicitly generated development records; customer deployment and conversion outcomes are separate commercial work.

Original first-party buyer: https://www.upwork.com/freelance-jobs/apply/HubSpot-Agent-Automation-Expert-Required_~022105420778671430088/
Buyer identified on its own public posting: VIP Gateway, UK car leasing. As observed Oct 10, 2026: expert, more than 30 hours/week, over six months, open role, 50+ proposals, no interviews, historically 56 hires and about $9K total spent. The buyer is asking for actual deployed CRM reference projects; source merges are not substituted for that evidence.

## Original analysis engine

The original triage.mjs is a self-contained Node.js 22+ tool that reads a previously obtained original HubSpot CRM v3 deals GET JSON response or the same-shaped, customer-authorized export. It implements:
- Original HubSpot deal ID and explicit real native stage-ID validation, with an operator-defined open/won/lost mapping. Unknown stage IDs and duplicate deals fail closed.
- Pin as-of time and native source properties. Data-quality alerts for declared overdue/missing next-action date and stale CRM record edits; an edit timestamp never proves actual customer-contact activity.
- Stable priority and per-owner/global alert budgets, approval-only output, and native record links if a numeric portal ID is supplied.
- Cohort-scoped descriptive closed-won/closed-lost rates by actual pipeline, lead source, optional lead quality and deal-age bucket. Suppress small cohorts. No simplistic individual salesperson ranking or claimed causal result.
- No outbound network requests, HubSpot API writes, login, client PII free text, external model calls, tool-scheduled checks, GitHub Actions or implicit buy/sell triggers.
- New-file-only (refuses overwrite) restricted-permission machine-readable JSON artifact.

The [retained workspace](workspace/README.md) uses this same engine unchanged. It supplies the source acquisition, durable manager operation, approved native tasks/notes and recoverable handover needed to exercise the complete workflow. Account-specific adoption maps the customer's permitted object model, true lead-source/contact/activity meanings, delivery schedule and agreed success measures.

## Native private operator input

The customer-approved original deals GET response should have the standard HubSpot CRM v3 top-level results array of objects containing numeric deal id and original properties. Never commit actual seller/buyer exports or secrets. Build an operator-owned local JSON config alongside private input. Example shown below uses PLACEHOLDER field names and IDs only; substitute actual account's property schema before running:

    {
      "asOf": "2026-10-10T23:00:00Z",
      "portalId": "YOUR_NUMERIC_ACCOUNT_ID",
      "stageStatus": {"YOUR_OPEN_ID":"open","YOUR_WON_ID":"won","YOUR_LOST_ID":"lost"},
      "nextActionProperty": "ACTUAL_NEXT_ACTION_DATE_PROPERTY",
      "sourceProperty": "hs_analytics_source",
      "leadQualityProperty": "OPTIONAL_ACTUAL_LEAD_QUALITY_PROPERTY",
      "lastRecordUpdateProperty": "hs_lastmodifieddate",
      "staleRecordDays": 7,
      "minAgeDays": 2,
      "lookbackDays": 90,
      "minCohort": 10,
      "maxAlerts": 40,
      "maxPerOwner": 5
    }

Usage, with existing customer-permitted private JSON:

    node business/vip-gateway-hubspot-triage-20261010/triage.mjs --deals /private/actual-deals.json --config /private/actual-config.json --out /private/new-report.json

The report contains only numeric IDs, field-derived segment names, explicit checks, and human-review actions, not contact names or message bodies. Store under private access controls. Do not assume the example is an actual customer observed run.

## Commercial acceptance roadmap

**Milestone A, paid discovery:** one customer-approved actual pipeline, real stage dictionary, seat permission scope, query sampling, next-step property mapping, last true customer-interaction timestamps, lead-quality availability, accepted alert and lost-deal definitions, HubSpot tier, cost and rate. Deliver data dictionary, original 20 most important validated alerts and precise false-alarm tally. No production writes.

**Milestone B, small real pilot:** one pipeline/team, controlled read-only sync, per-owner alert budgets, notification routing to authorized manager, native URL evidence and supervisor accepts/rejects decisions. Assess coverage and precision against actual manager-reviewed current/historical cases and one pre-agreed 30-day baseline. Avoid selection effects when comparing salespeople.

**Milestone C, production implementation and handover:** configure the delivered workspace for the agreed account and operating schedule, integrate the customer's activity/history sources and manager routing, define operational responsibilities, measure accepted interventions and train the operators. Native checkpointing, request identity, approval, task/note creation, reconciliation, private export and recovery are already implemented. The present connector captures the permitted account listing and creates approved tasks/notes; incremental activity synchronization, customer communications, material deal updates and native-object undo are separate scoped integrations. The buyer's actual human-approval requirement remains part of those workflows.

Internal cash-model starting point only: 8-12 paid hours discovery, 30-50 paid pilot hours, optional 12-20 weekly support hours at rate verified by existing account owner. Buyer has not disclosed an accepted rate; long job length and prior $9K client spend are not a contract.

## Application owner checklist

Existing sole authorized Upwork account writer, not another seat, owns the one potential application. Check current post still open, actual profile fit, authorized Connects, no duplicate proposal, truthful deployed HubSpot case studies and matching available hours/costs. Answer its six public questions individually with real owner evidence. Technical approach for question 3: stable pipeline/lead-source/lead-quality matched cohorts, never naive raw salesperson conversion; keep minimum sample and observational caveats. Question 4: human-review-only alert queue, exact source field evidence, no unsupported inference from CRM record updates, caps and feedback. Question 5: paid narrow live HubSpot audit first, then one team's focus pilot. The project asks for *actually deployed systems* under questions 1,2,6; until real prior project portfolio evidence is verified, do not assert client results.

No application, fee, Connects, personal account or customer API was used to ship these files. Publication is a free engineering source artifact only, not revenue.
