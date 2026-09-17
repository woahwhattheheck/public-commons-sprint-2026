# Proposed workshare — PermitRoute Assurance

**Commercial status:** proposed / unsold  
**Target context:** NYSDOT C038208 or comparable permit-system modernization  
**Proposed fixed price:** **$18,000**  
**Duration:** **3 weeks from authorized kickoff**  
**Positioning:** independent migration / replay / acceptance engineering workshare; not prime system development

## Outcome

Give the implementation team an independent, reproducible answer to three questions before cutover:

1. Did the migrated permit population preserve the fields and relationships that matter?
2. Can representative workflow histories replay without illegal transitions, missing routes, time regressions, or duplicate/colliding events?
3. Can the team hand reviewers a content-addressed acceptance packet instead of an unverifiable spreadsheet narrative?

## Week 1 — contract-to-test map + migration schema — $6,000

Deliver:

- authorized source/target field crosswalk;
- privacy-minimized canonical permit record;
- critical-vs-informational difference taxonomy;
- workflow transition map;
- district/agency routing invariants;
- synthetic fixtures for edge cases;
- CI-ready migration comparator.

Acceptance:

- agreed field/invariant matrix is executable;
- synthetic corpus contains normal + adversarial records;
- no production secrets/customer records are committed to this public carrier.

## Week 2 — replay + discrepancy engine — $7,000

Deliver:

- event replay ledger;
- idempotency and collision detection;
- illegal transition / time-regression gates;
- batch missing / extra / changed / equivalent accounting;
- routed-agency review integrity;
- deterministic evidence bundle and verifier;
- adapter seam for project-authorized extracts.

Acceptance:

- authorized sample can be reduced to the canonical schema;
- known injected discrepancies are detected deterministically;
- repeated runs produce stable evidence digests.

## Week 3 — UAT evidence pack + cutover readout — $5,000

Deliver:

- representative cutover rehearsal;
- exception register grouped by severity / ownership;
- signed-off test inventory and reproducible commands;
- evidence receipts for agreed migration/replay suites;
- executive readout: blockers, accepted deviations, rollback triggers, remaining risk;
- handoff/runbook for prime QA and customer reviewers.

Acceptance:

- every reported count traces to machine-verifiable evidence;
- unresolved differences are explicit rather than silently normalized;
- receipt authority remains bounded to what was actually executed and approved.

## Assumptions / exclusions

Included:
- independent acceptance engineering;
- synthetic/public scaffolding;
- adapter work for authorized structured exports;
- deterministic QA evidence.

Not included unless separately authorized:
- prime bid preparation;
- full replacement application development;
- production hosting/operations;
- access to data or systems without customer authorization;
- legal/compliance certification;
- claim that NYSDOT accepted any result;
- procurement representation on behalf of NYSDOT or any prime.

## Seller note

The public source carrier is intentionally useful before an NDA. If a qualified implementation partner wants the workshare, the adapter and acceptance matrix can move under their authorized project boundary without exposing customer records publicly.
