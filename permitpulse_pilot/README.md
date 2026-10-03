# PermitPulse paid regulatory-change monitoring pilot

Commercialization-only fixed-scope pilot carrier for evidence-before-action public permit/inspection guidance monitoring.

This does **not** replace `permitpulse-all-gas`. Predecessor #105 truth remains authoritative: provider receipts OPEN, `readyForSubmission=false`, no live provider/social/submission/prize/payment/revenue claim.

Issue: https://github.com/woahwhattheheck/public-commons-sprint-2026/issues/106

## What this carrier is

- strict synthetic pilot intake (jurisdictions, `example.invalid` HTTPS sources, review owners, retention, refresh cadence)
- commercial terms locked to `PROPOSED_NOT_ACCEPTED` with `paymentLink=false` and `acceptedPriceMinor=0`
- scenario-only change-review labor worksheet (minutes only; no compliance-loss or savings inference)
- acceptance contract bound to exact snapshot digests and owner review, never legal/compliance conclusions
- source/provider/deployment/customer truth ledger
- target-account research rows marked `RESEARCH_ONLY_NO_OUTBOUND`
- machine verifier rejecting accepted-price, customer-result, live-provider, submission/prize, compliance, legal-advice, outbound, payment, and revenue promotion

## Synthetic URL boundary

Source `httpsUrl` and research `firstPartyUrl` must have the hostname
`example.invalid` or a subdomain such as `permits.example.invalid`. Hostname
comparison is case-insensitive. The words `example.invalid` in a path, query,
fragment or unrelated hostname do not qualify. Existing HTTPS and field-format
rules still apply, and accepted URL text is retained unchanged.

## What this carrier is not

No buyer contact, Muse request, live Firecrawl/OpenAI/AgentMail/Convex invocation, hackathon submission, prize claim, payment-link creation, accepted contract, customer result, observed savings, or revenue mutation.

## CLI

From repository root:

```bash
python permitpulse_pilot/engine.py compile permitpulse_pilot/fixtures/synthetic_pilot.json /tmp/permitpulse_pilot
python permitpulse_pilot/engine.py verify permitpulse_pilot/fixtures/synthetic_pilot.json /tmp/permitpulse_pilot
```

```bash
python -m unittest -v permitpulse_pilot.test_engine
python -O -m unittest -v permitpulse_pilot.test_engine
```

Hypothesis `$4,500 fixed / PROPOSED_NOT_ACCEPTED` is a labeled synthetic commercial hypothesis only.
