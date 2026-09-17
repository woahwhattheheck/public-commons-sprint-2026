# PermitRoute Assurance — C038208 seller/source carrier

PermitRoute Assurance is a **synthetic-data migration, replay, and UAT evidence harness** for teams pursuing large permit-system modernization work such as New York State Department of Transportation contract **C038208** (replacement Highway Work Permit System).

This repository does **not** claim to be NYSDOT software, does not contain NYSDOT/customer data, does not claim that Flairsoft or any other company is bidding, and does not claim any procurement relationship, award, invoice, or payment.

## Why this exists

Permit replacements fail in expensive, boring ways: records silently mutate during migration, workflow transitions become illegal, agency routing loses referential integrity, timestamps drift, attachments disappear, and UAT evidence becomes a spreadsheet argument instead of a reproducible receipt.

PermitRoute turns those failure modes into deterministic tests that a prime or implementation team can adapt under authorized project access:

- strict migration-record contract;
- district / permit-type / workflow validation;
- routed-agency review integrity;
- legal transition replay with event-id collision and time-regression detection;
- legacy → target field-level reconciliation;
- batch missing/extra/different/equivalent accounting;
- content-addressed acceptance evidence with an explicit authority ceiling;
- no secrets, raw attachments, customer PII, or production credentials.

## Public target context

Current public procurement research, rechecked 2026-09-17:

- NYSDOT lists **C038208** on its Current Opportunities page for development, implementation, and support of a replacement Highway Work Permit System.
- Public procurement records give an October 2026 response horizon; re-open the official opportunity before any commercial action.
- Public New York State records show Flairsoft has prior NYSDOT IT-services experience and a current statewide PBITS contract. This is fit evidence only — **not evidence that Flairsoft is bidding C038208**.

Public sources:
- https://www.dot.ny.gov/portal/page/portal/doing-business/opportunities/consult-opportunities
- https://ogs.ny.gov/procurement
- https://www.flairsoft.net/

## Run

Standard-library Python only.

```bash
PYTHONPATH=. python -m unittest discover -s tests -v
PYTHONPATH=. python -O -m unittest discover -s tests -v
PYTHONPATH=. python -m permitroute.cli demo
```

The demo deliberately contains a migration discrepancy: one synthetic permit changes district and both rows change `source_system`. The receipt proves what the harness observed; it does **not** promote that observation into customer acceptance.

## CLI

```bash
# deterministic synthetic demo
PYTHONPATH=. python -m permitroute.cli demo

# compare two JSON arrays of permitroute-record/v1 records
PYTHONPATH=. python -m permitroute.cli compare legacy.json target.json

# verify a demo/evidence bundle
PYTHONPATH=. python -m permitroute.cli verify bundle.json
```

`compare` exits nonzero when migration differences or missing/extra records exist, which makes it usable as an independent acceptance gate in CI.

## Evidence authority

Every compiled receipt pins:

- batch-diff SHA-256;
- replay SHA-256;
- counts of equivalent / different / missing / extra records;
- replay-event count;
- false authority flags for customer-data use, NYSDOT acceptance, prime bid, contract award, invoicing, and payment.

The verifier rejects tampering and any authority promotion.

## Commercial use

`WORKSHARE.md` contains a proposed **$18,000 fixed-price / 3-week independent migration-and-acceptance workshare** designed for a qualified prime or implementation partner. It is a proposal, not an existing contract.

## License

MIT.
