# Prime Workshare Offer Studio · conversion, not another lead board

Turn **one already-qualified buyer/prime case** from the original Commons Node 22 buyer-to-prime pipeline into a coherent, printable specialist scope: exact issuer/revision, qualified prime evidence matrix, contained implementation and acceptance milestones, explicit exclusions, owner-approved price when available, and a private handoff for a payable SOW. This is generic non-bounty revenue infrastructure, separate from the SCF SF77 merchant-specific diagnostic workorder and from current reply/sender work.

This **imports the original** `../lead-to-paid-work-pipeline-20261010/pipeline.mjs` `evaluate()` on every run. It does not duplicate its qualification, deadline, approval or margin decisions. It does not send mail, submit bids, open invoices, or initiate payment. It is intended to turn the successful *problem found → qualified partner → acceptance-based workshare* commercial motion into repeatable operator output. Never mistake a prepared packet for a contract.

## One command (no dependencies or CI)

From the repository root with Node 22+:

```sh
node business/prime-workshare-offer-studio-20261011/offer-studio.mjs \
  --opportunities business/lead-to-paid-work-pipeline-20261010/opportunities.json \
  --terms business/prime-workshare-offer-studio-20261011/terms.example.json \
  --id PE-29016-NONST-2027-000000073 \
  --out /tmp/arc-workshare-demo --at 2026-10-11T13:30:00Z
```

Use a **new directory** for every generation. Open `offer.html` locally, or review `offer.md`, `offer.json`, and `acceptance.csv`. `manifest.json` contains original source/terms SHA-256 identifiers. Output directory mode `0700`, files `0600`, and existing directories are refused. The HTML includes a usable print-to-PDF button and source-linked buyer requirements. Keep actual lead details, internal costs and confidential commercial data in private inputs/output, not in this public repo.

The bundled ARC sample is deliberately an **INTERNAL_SCOPE_DRAFT**, since no qualified prime, owner-approved amount or communication authorization is present. It does not create a price or customer claim. For a different existing case, supply a terms file with the *exact* original buyer name, solicitation ID, revision and relationship owner. Select only a prime present in `op.partners`; its mandatory evidence is taken directly from the original evaluator. Original milestones are used unchanged. Supply legal entities, delivery owner, exclusions, proposed delivery window, acceptance reviewer and actual payment terms. The optional milestone percentages must total 100, and an optional terms price must exactly match the already owner-approved source amount.

**States:** `INTERNAL_SCOPE_DRAFT` still shows source and legal/commercial gaps; `READY_FOR_HUMAN_FINAL_REVIEW` requires the original evaluator's `readyForOwnerApproach`, a documented qualified prime, named legal entities and delivery owner, at least one explicit exclusion and the approved original fee. Both are internal authoring states. Neither authorizes an outbound communication, bid, contract, signature, invoice or collection. The original relationship owner retains final control.

**Operator sequence:** find a real buyer problem, confirm original RFP/amendments/deadline, obtain a legitimately qualified prime and acceptance scope, record original owner-approved economics and contact decision, generate this packet, review exact external wording, then have the relationship owner agree a written SOW and delivery contract independently. After delivering, attach signed acceptance, invoice and provider-backed payment receipts through the original pipeline collections ledger. No additional hosted Actions runs needed.
