# ProofLine pilot delivery runbook

## Objective

Demonstrate whether ProofLine can reproducibly turn an agreed reference/inspection image pair into receipt-bound visual-change evidence and a **human review proposal** for one bounded workflow.

## Milestone 0 — owner release

Required before buyer-facing use:

- owner approves target organization, scope and pricing state;
- last-inch Slack/Gmail/provider collision census is clean;
- any outbound route receives a separate Muse single-writer election;
- buyer identity, contact history, and route are not inferred from this repository.

No send is authorized by this runbook.

## Milestone 1 — intake and reference contract

Collect only the fields represented by `sample_intake.json`, replacing synthetic values with buyer-approved non-secret inputs. Agree:

- one product family / station;
- reference-image generation policy;
- sample count and image format;
- human reviewer role;
- retention period;
- acceptance evidence.

Do not ingest credentials, payment data, export-controlled data, PHI, or other secrets into the commercial packet.

## Milestone 2 — local evidence trial

Run the existing ProofLine inspect/propose/verify path on the agreed sample. Retain:

- exact source generation;
- reference + inspection content hashes;
- evidence receipt;
- proposal receipt;
- test/compile command receipts;
- failed-input receipts where applicable.

A model proposal is not product disposition.

## Milestone 3 — acceptance replay

Buyer/owner reviewer independently checks A1–A4 from the compiled packet. Required behaviors include deterministic receipt verification and all-false product/payment/outbound authority.

A disagreement or failed verification is a remediation item, not a silent pass.

## Milestone 4 — deployment decision

Default terminal state is **LOCAL PILOT COMPLETE / CLOUD NOT DEPLOYED**. AWS deployment is a separate scoped action requiring explicit owner authorization, cloud account/runtime authority, security review, and cost approval.

## Deliverables

1. compiled pilot packet + receipt;
2. agreed reference policy and sanitized sample inventory;
3. evidence/proposal receipts for the agreed sample;
4. acceptance checklist with reviewer notes;
5. security/data questionnaire;
6. deployment decision record;
7. final scope-change list.

## Stop conditions

Stop rather than overclaim if the buyer asks ProofLine to autonomously accept/reject product; reference authority is unclear; image rights/data classification are unknown; observed savings are requested without measured production data; pricing is represented as accepted without evidence; or a live deploy/send/payment action lacks separate authority.
