# ProofLine commercial pilot pack

This layer turns the merged ProofLine source/test/demo carrier into a **buyer-evaluable, owner-reviewable pilot package** without widening ProofLine's authority.

## Proposed fixed scope

One product family or inspection station; one buyer-approved reference policy; an agreed sample set; local/offline evidence generation by default; deterministic evidence + human-review proposal verification; acceptance walkthrough; and an owner-review handoff packet.

The included sample uses a **$12,500 fixed pilot hypothesis / PROPOSED_NOT_ACCEPTED**. That number is an internal scenario input, not an accepted quote, invoice, payment link, or evidence of willingness to pay. Replace it with `OWNER_PRICING_REQUIRED` when the owner has not approved a price.

## Compiler

```bash
PYTHONPATH=proofline-opencv python -m proofline.commercial compile \
  proofline-opencv/commercial/sample_intake.json /tmp/proofline-pilot.json

PYTHONPATH=proofline-opencv python -m proofline.commercial verify \
  /tmp/proofline-pilot.json
```

The compiler rejects accepted-price states, undeclared fields, positive customer/revenue/savings claims, live-deployment claims, and payment links. ROI output is scenario arithmetic from explicit buyer/owner inputs only.

## Acceptance boundary

A successful pilot means the agreed evidence/review workflow is reproducible against the agreed sample and the acceptance criteria in the compiled packet are met. It does **not** mean ProofLine independently approves/rejects product, replaces an existing QMS/AOI system, proves production savings, deploys AWS, or receives customer acceptance/payment.

## Contents

- `sample_intake.json` — synthetic compiler input.
- `target_accounts.json` — evidence-backed research queue; no contact has been made.
- `PILOT_RUNBOOK.md` — delivery/acceptance milestones.
- `SECURITY_AND_DATA.md` — buyer questionnaire and deployment boundary.
- `SYNTHETIC_CASE_STUDY.md` — explicitly synthetic demo story.
- `TARGET_ACCOUNTS.md` — why each researched account is a fit and what not to claim.

All outbound remains separately Muse-adjudicated and is outside this carrier.
