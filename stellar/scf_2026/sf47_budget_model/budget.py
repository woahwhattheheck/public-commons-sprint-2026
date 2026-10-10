#!/usr/bin/env python3
"""SCF Build speculative cash-gap model. Offline only; NEVER awards or moves funds.

Source rules: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines
This is a deterministic scenario calculator, NOT an eligibility or payout oracle.
"""
from __future__ import annotations

import argparse
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
import json
from pathlib import Path
import sys

AWARD_CAP = Decimal("150000")
SHARES = [Decimal("0.10"), Decimal("0.20"), Decimal("0.30"), Decimal("0.40")]
CATEGORIES = {"core-development", "frontend-ux", "verification", "release"}
EXCLUDED = {"past-work", "general-operations", "audit", "marketing", "acquisition",
            "legal", "entity-registration", "bounty", "prize-pool", "token-giveaway"}


def value(raw, field):
    try:
        number = Decimal(str(raw))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{field}: invalid decimal") from exc
    if not number.is_finite() or number < 0:
        raise ValueError(f"{field}: requires finite nonnegative decimal")
    return number


def cents(amount):
    return str(amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def whole_day(obj, field, lo=0, hi=500):
    v = obj[field]
    if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
        raise ValueError(f"{field}: requires integer between {lo} and {hi}")
    return v


def model(data):
    if data.get("status") != "ILLUSTRATIVE_UNSENT":
        raise ValueError("status must be ILLUSTRATIVE_UNSENT (not an award/application)")
    award = value(data["award_request_usd"], "award_request_usd")
    if not Decimal("0") < award <= AWARD_CAP:
        raise ValueError("award request must be greater than zero and <= USD 150,000")
    project_end = whole_day(data, "project_end_day", 1, 180)
    milestone_data = data["milestones"]
    if [m.get("tranche") for m in milestone_data] != [1, 2, 3]:
        raise ValueError("exactly three future, ordered milestone tranches #1, #2, #3 required")
    if not data.get("team_budget_inputs_are_hypothetical"):
        raise ValueError("example budget may not be presented as verified team costs")
    payment_days = [0]
    reviewed = []
    prior_submit = 0
    for m in milestone_data:
        submit = whole_day(m, "submit_day", 1, project_end)
        lag = whole_day(m, "review_and_payment_lag_days", 0, 90)
        if submit <= prior_submit:
            raise ValueError("milestone submission days must be strictly increasing")
        if submit - payment_days[-1] > 90:
            raise ValueError(f"tranche {m['tranche']} is >90 days after last modeled payment")
        if not str(m.get("measurable_proof", "")).strip() or not str(m.get("deliverable", "")).strip():
            raise ValueError("each tranche requires verifiable proof and deliverable")
        payment_days.append(submit + lag)
        reviewed.append({"tranche": m["tranche"], "submit_day": submit,
                         "hypothetical_paid_day": submit + lag,
                         "days_after_prior_payment": submit - payment_days[-2],
                         "proof": m["measurable_proof"], "deliverable": m["deliverable"]})
        prior_submit = submit
    if prior_submit != project_end:
        raise ValueError("tranche #3 must finish at the declared project end day")

    costs = data["future_costs"]
    if not costs:
        raise ValueError("at least one future deliverable cost required")
    seen = set()
    total = Decimal("0")
    normalized = []
    for item in costs:
        cid = str(item["id"])
        if cid in seen:
            raise ValueError(f"duplicate cost id: {cid}")
        seen.add(cid)
        cat = str(item["category"])
        if cat in EXCLUDED or cat not in CATEGORIES:
            raise ValueError(f"{cid}: category '{cat}' not eligible in this conservative model")
        start = whole_day(item, "start_day", 0, project_end)
        end = whole_day(item, "end_day", start, project_end)
        usd = value(item["amount_usd"], f"{cid}.amount_usd")
        if usd == 0:
            raise ValueError(f"{cid}: zero-cost rows obscure actual work")
        tranche = whole_day(item, "tranche", 1, 3)
        if not item.get("future_only", False):
            raise ValueError(f"{cid}: past/unverified work may not be reimbursed")
        if not str(item.get("measurable_proof", "")).strip():
            raise ValueError(f"{cid}: measurable proof required")
        if end > reviewed[tranche - 1]["submit_day"]:
            raise ValueError(f"{cid}: cost after its tranche deliverable deadline")
        total += usd
        normalized.append({"id":cid, "category":cat, "amount":usd,
                           "start":start, "end":end, "tranche":tranche})
    if total != award:
        raise ValueError(f"total modeled future costs USD {total} must equal requested {award} (no padding)")
    payments = [{"tranche":i, "usd":cents(award * SHARES[i]),
                 "hypothetical_paid_day":payment_days[i],
                 "release_condition":("award accepted" if i == 0 else
                                      f"tranche {i} deliverables reviewed and accepted")}
                for i in range(4)]
    # Even distribution of each speculative cost across its specified inclusive day span.
    # This is an assumed accrual profile, not actual time sheets, liabilities or provider invoices.
    def cost_accrued(day):
        acc = Decimal("0")
        for c in normalized:
            length = c["end"] - c["start"] + 1
            elapsed = max(0, min(day, c["end"]) - c["start"] + 1)
            acc += c["amount"] * Decimal(elapsed) / Decimal(length)
        return acc
    rows = []
    deficit_peak = Decimal("0")
    worst_day = 0
    events = set(payment_days + [m["submit_day"] for m in reviewed] + [0,project_end])
    cutoff = max(project_end, max(payment_days))
    for day in range(cutoff + 1):
        spent = cost_accrued(day)
        received = sum((award * SHARES[i] for i,p in enumerate(payment_days) if p <= day),
                       Decimal("0"))
        gap = max(Decimal("0"), spent - received)
        if gap > deficit_peak:
            deficit_peak, worst_day = gap, day
        if day in events:
            rows.append({"day":day, "cumulative_speculative_cost_usd":cents(spent),
                         "hypothetical_tranches_received_usd":cents(received),
                         "cash_gap_if_costs_incurred_usd":cents(gap)})
    sensitivities = []
    for raw in data.get("illustrative_xlm_usd_at_payment", []):
        price = value(raw, "illustrative_xlm_usd_at_payment")
        if price <= 0:
            raise ValueError("XLM price scenario must be positive")
        sensitivities.append({"illustrative_usd_per_xlm_NOT_QUOTE":str(price),
                              "xlm_by_tranche_if_that_price_applied": [
                                  str((award * share / price).quantize(Decimal("0.0000001"),
                                      rounding=ROUND_HALF_UP)) for share in SHARES]})
    return {
        "status":"ILLUSTRATIVE_UNSENT_NOT_GRANTED",
        "award_request_usd":cents(award),
        "planned_future_costs_usd":cents(total),
        "project_end_day":project_end,
        "model_assumptions":{"day_zero":"hypothetical award acceptance, not actual",
                             "accrual":"each future cost incurred evenly through inclusive start/end days",
                             "release":"tranche 0 day 0; later payments after assumed review lag",
                             "no_assumed_award_or_team":"all costs and dates require human sourcing"},
        "milestones":reviewed,
        "payouts":payments,
        "cashflow_events":rows,
        "peak_prefunding_gap_usd":cents(deficit_peak),
        "peak_gap_day":worst_day,
        "xlm_price_scenarios_not_live_quotes":sensitivities,
        "critical_unknowns":["no SCF grant eligibility/award/invitation",
            "current x402 RFP quarter status unresolved",
            "applicant human identity/team and legal capacity unverified",
            "staff rates, hours, vendor quotes and actual workplan not yet sourced",
            "award disbursement approval lags unknown, XLM settlement price variable",
            "a proposed 180-day day-offset schedule does not replace calendar review",
            "no funds transferred or committed; no work may be funded from assumption"],
        "source_urls":[
            "https://stellar.gitbook.io/scf-handbook/scf-awards/build-award",
            "https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines",
            "https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track"
        ]
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("scenario", type=Path, help="local example/edited scenario JSON")
    p.add_argument("--out", type=Path, help="optional local output JSON (never submits)")
    args = p.parse_args(argv)
    try:
        result = model(json.loads(args.scenario.read_text(encoding="utf-8")))
        rendered = json.dumps(result, indent=2) + "\n"
        if args.out:
            args.out.write_text(rendered, encoding="utf-8")
            print(f"wrote {args.out}", file=sys.stderr)
        else:
            sys.stdout.write(rendered)
        return 0
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
        print(f"INVALID illustrative scenario: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
