from __future__ import annotations

from .core import SCHEMA


def synthetic_case() -> dict:
    return {
        "schema": SCHEMA,
        "caseId": "synthetic-reusable-transit-packaging-001",
        "evaluatedOn": "2026-09-18",
        "currency": "GBP",
        "horizonYears": 4,
        "discountRateBps": 600,
        "maxEvidenceAgeDays": 365,
        "oneOffCostMinor": 3_500_000,
        "annualRecurringCostMinor": 850_000,
        "evidence": [
            {
                "id": "ev-packaging-spend",
                "sourceType": "owner_export",
                "locator": "synthetic://procurement/packaging.csv",
                "sha256": "836ad958f7d716c9f8458a99fbd4df6b56c69210460764bf0ac6f527dd5e2919",
                "observedOn": "2026-09-10",
                "note": "Synthetic owner-export baseline for single-use packaging spend and replacement frequency.",
            },
            {
                "id": "ev-disruption-log",
                "sourceType": "owner_incident_log",
                "locator": "synthetic://operations/disruptions.json",
                "sha256": "9ec8bd89f578a23de26bc845a8dc550011798c9fdaf579c13b1110fe8d3c5552",
                "observedOn": "2026-09-11",
                "note": "Synthetic disruption history used only to bound avoided-expedite and downtime value.",
            },
            {
                "id": "ev-customer-study",
                "sourceType": "owner_research",
                "locator": "synthetic://research/customer-retention.md",
                "sha256": "40a362278a6b16479adebf40947bcc98fef9e591ccfec088cf665791b0dd2601",
                "observedOn": "2026-09-12",
                "note": "Synthetic customer study; modeled retention value remains explicitly uncertain.",
            },
        ],
        "levers": [
            {
                "id": "packaging-purchase-avoidance",
                "label": "Avoided annual single-use packaging purchases",
                "category": "direct_cash",
                "confidence": "observed",
                "lowMinor": 2_600_000,
                "centralMinor": 3_100_000,
                "highMinor": 3_400_000,
                "evidenceIds": ["ev-packaging-spend"],
            },
            {
                "id": "expedite-resilience",
                "label": "Reduced expedite and disruption cost exposure",
                "category": "supply_chain_resilience",
                "confidence": "modeled",
                "lowMinor": 300_000,
                "centralMinor": 900_000,
                "highMinor": 1_800_000,
                "evidenceIds": ["ev-disruption-log"],
            },
            {
                "id": "retention-signal",
                "label": "Customer retention value under circular-service proposition",
                "category": "customer_retention",
                "confidence": "hypothesis",
                "lowMinor": 0,
                "centralMinor": 700_000,
                "highMinor": 2_000_000,
                "evidenceIds": ["ev-customer-study"],
            },
        ],
    }
