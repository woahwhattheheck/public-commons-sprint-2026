# EvidenceForge × Panta market context

EvidenceForge can bind a current Panta prediction-market catalog page into a
content-addressed, read-only snapshot. This gives a coding-agent reviewer a
live market signal without letting the model trade, build a transaction, use a
wallet, claim winnings, or grant itself approval.

The integration calls the official `GET /markets/` catalog endpoint with a
Panta API key, normalizes the documented market ID, title, category, phase,
YES/NO prices and volume fields, and emits `snapshotSha256`. The source response
is capped at 1 MB and 50 markets. Malformed prices, duplicate IDs, oversized
pages, non-HTTPS bases and unexpected response shapes fail closed.

```bash
cd nebius-evidenceforge
export PANTA_API_KEY='...'
python -m evidenceforge.panta --category technology --phase primary --limit 20 \
  > /tmp/panta-market-context.json
python -m unittest tests.test_panta -v
```

The output is evidence, not advice or authority. A product flow may let a human
select a market snapshot and include its hash in an EvidenceForge request or
review packet; it must not silently turn prices into repository approval.

## Competition boundary

The Panta API Sidetrack advertises a 5,000 USDG prize pool and permits meaningful
integration into an existing Crypto World's Fair product. Eligibility still
requires a working demo, an official Colosseum submission, a separate Superteam
Earn submission, English materials, and the official hackathon requirements.
This source change performs none of those external actions and does not establish
registration, eligibility, submission, award, payment, or settlement.

Before submission, an authorized human must obtain/use the existing Panta account
and API key, capture one real snapshot from the live endpoint, show how that
snapshot materially informs the EvidenceForge user experience, retain the output
hash and demo evidence, and complete both required submission routes exactly once.

Official sources:

- https://superteam.fun/earn/listing/panta-api-side-track
- https://docs.panta.market/
- https://github.com/Kaito-HQ/panta-api-playground
