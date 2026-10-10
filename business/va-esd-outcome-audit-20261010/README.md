# VA Enterprise Service Desk independent billing/outcome evidence review

## Original buyer need

Public VA Sources Sought / RFI: [36C10B27Q0035](https://sam.gov/opp/0b4d9d4eaec34aca836c80662ae6ce73/view), issued 2026-10-07, response cutoff **2026-10-21 10:00 Eastern**. Original attached DOCX `36C10B27Q0035.docx` frames a possible integration of Tier 0/1 service desk and CCI operations. This is market research, **NOT a solicitation or contract**. Government answers are voluntary, unpaid, limited to 25 pages, and must not contain marketing material.

Its §4 asks how to identify contractor-favorable classification of AI-assisted resolution, agent escalation, repeat contact, resolving tier and outcome/gainshare billing, and whether a separately controlled audit is warranted. VA describes 125,000–150,000 contacts/month supporting roughly 600,000 users. Do not confuse these reported operational volumes with any benchmark of this program.

## What this working prototype provides

A **standalone read-only Node 22 offline** consistency audit for a *proposed normalized interchange* (not a VA- or OEM-issued API). No dependencies, connection, payment execution, personal identifiers in output or submission automation.

```sh
node audit.mjs <events.jsonl> <invoice.jsonl> <policy.json> > review.json
node --test test/audit.test.mjs
```

Each UTF-8 event JSONL row has required `eventId`, `contactId`, `at` (UTC ISO), `type`, `source`; repeat-contact rows additionally require `parentContactId` referring to an earlier contact. Allowed event types: `ai_attempt`, `ai_resolved`, `agent_handle`, `escalated`, `human_resolved`, `abandoned`, `repeat_contact`. All IDs must be **non-sensitive, opaque, pre-pseudonymized tokens** from buyer-authorized feeds. No transcripts, names or extra fields.

Each invoice JSONL row has `contactId`, `billedAs` (`ai_success`, `human_success`, `nonbillable`), `amountMinor` (exact nonnegative decimal string of USD cents), and `currency` = `USD`. A policy JSON supplies `vendorSources` (list), `independentSources` (disjoint list) and `repeatWindowHours` (integer 1–8760, **operator-defined**, not specified by VA).

A billable AI success must have a vendor AI attempt, **separately controlled** confirmed AI resolution, and no human escalation/intervention, abandonment or repeat contact within the agreed correlation window. Human billing requires agent handling plus separately controlled human resolution. Duplicate contact claims and nonbillable charges flag review. Output identifies review-row indexes/reason codes and exact aggregate invoiced/review USD cents; input SHA256 digests support audit provenance. **REVIEW flags are evidence requests, not findings of fraud or automatic payment disallowance.** A seller cannot establish feed independence by simply setting a source label; independent access/correlation must be verified operationally.

The pilot has per-file 256 MiB and per-row 16 KiB limits. **No validated 150k-contact performance or official VA/Genesys/NICE/ServiceNow mappings yet**; use actual authorized exports for a production-scale trial, with source permissions, privacy/security and Section 508 review.

## Non-bounty commercial conversion

Offer a narrowly scoped **paid acceptance/QA subcontract** to a *qualified service desk prime, integrator or independent oversight contractor*: agree and document actual authoritative system exports, event correlation/rate definitions, exception adjudication, source custody and repeat-window policy; deliver reproducible billing dispute evidence. Any SOW, price, scope, partner identity, contact or federal response requires sales-owner selection. Historical CCI providers are only possible research contacts; no external firm has expressed interest or approved a workshare.

**Current state:** original public buyer need + working source proposal, **no offer, direct government response, buyer interest, award, contract, invoice or cash**. This project does not start GitHub Actions.
