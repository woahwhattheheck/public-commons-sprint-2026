"""Exact dated source-quantity summaries from retained DMR periods and gauge relations."""
from __future__ import annotations
from collections import defaultdict
import datetime as dt
from decimal import Decimal, InvalidOperation


def decimal(value):
    try:
        result = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError("Original reported quantity is not decimal") from error
    if not result.is_finite() or result < 0:
        raise ValueError("Original reported quantity must be finite and nonnegative")
    return result


def text(value):
    return format(value, "f").rstrip("0").rstrip(".") if value % 1 else format(value, ".0f")


def summarize(period_rows, annual_rows, relations):
    """Use original constant reported mean rates over actual overlap days; keep missing support."""
    route = {row["permit_id"]: row for row in relations}
    if len(route) != len(relations):
        raise ValueError("The original route table repeats a permit")
    years = {int(row["calendar_year"]) for row in annual_rows}
    if len(years) != 1:
        raise ValueError("Select one original source year")
    year = next(iter(years))
    series = {row["series_id"]: row for row in annual_rows}
    if len(series) != len(annual_rows):
        raise ValueError("Annual source identities repeat")
    periods = defaultdict(list)
    for row in period_rows:
        key = row["series_id"]
        if key not in series or any(row[field] != series[key][field] for field in (
                "permit_id", "parameter_code", "reporting_feature", "monitoring_location", "amount_unit")):
            raise ValueError("Period and annual source identities or units differ")
        start, end = dt.date.fromisoformat(row["period_start"]), dt.date.fromisoformat(row["period_end_exclusive"])
        if start >= end:
            raise ValueError("Original monitoring period must have positive duration")
        periods[key].append((start, end, row))
    for key, values in periods.items():
        ordered = sorted(values, key=lambda item: (item[0], item[1]))
        if any(a[1] > b[0] for a, b in zip(ordered, ordered[1:])):
            raise ValueError("Original periods overlap within series " + key)
    groups = defaultdict(list)
    for row in annual_rows:
        permit = row["permit_id"]
        if permit not in route:
            raise ValueError("No actual retained relation for permit " + permit)
        groups[(route[permit]["gauge_id"], route[permit]["gauge_relation"],
                row["parameter_code"], row["amount_unit"])].append(row)
    results = []
    for (gauge, relation, code, unit), members in sorted(groups.items()):
        selected_permits = sorted(permit for permit, row in route.items()
                                  if row["gauge_id"] == gauge and row["gauge_relation"] == relation)
        reporting_permits = sorted({row["permit_id"] for row in members})
        missing_species = sorted(set(selected_permits) - set(reporting_permits))
        months = []
        for month in range(1, 13):
            start = dt.date(year, month, 1)
            end = dt.date(year + int(month == 12), month % 12 + 1, 1)
            days = (end - start).days
            by_series = []
            for annual in members:
                amount, valid_days, record_ids = Decimal(0), 0, []
                for first, last, period in periods[annual["series_id"]]:
                    overlap = max(0, (min(end, last) - max(start, first)).days)
                    if not overlap:
                        continue
                    if period["amount_in_2023"] not in ("", None):
                        # This is the same represented-period mean-rate assumption as the source processor.
                        if period["standard_rate"] in ("", None):
                            if decimal(period["amount_in_2023"]) != 0:
                                raise ValueError("A quantified source period lacks its original standard rate")
                            value = Decimal(0)
                        else:
                            value = decimal(period["standard_rate"]) * overlap
                        amount += value
                        valid_days += overlap
                    record_ids.append(period["selected_dmr_value_ids"])
                by_series.append({
                    "series_id": annual["series_id"], "permit_id": annual["permit_id"],
                    "reporting_feature": annual["reporting_feature"],
                    "monitoring_location": annual["monitoring_location"],
                    "quantified_days": valid_days, "expected_days": days,
                    "quantified_amount": text(amount) if valid_days else None,
                    "complete_month": valid_days == days,
                    "original_selected_record_ids": record_ids,
                })
            quantity = sum((decimal(row["quantified_amount"]) for row in by_series
                            if row["quantified_amount"] is not None), Decimal(0))
            any_amount = any(row["quantified_amount"] is not None for row in by_series)
            complete = not missing_species and all(row["complete_month"] for row in by_series)
            months.append({
                "month": f"{year:04d}-{month:02d}", "period_start": start.isoformat(),
                "period_end_exclusive": end.isoformat(), "expected_days": days,
                "quantified_amount": text(quantity) if any_amount else None,
                "complete_cohort_amount": text(quantity) if complete else None,
                "all_reported_series_complete": all(row["complete_month"] for row in by_series),
                "all_selected_permits_report_species": not missing_species,
                "series": by_series,
            })
        # Reconcile each exact monthly allocation to the already retained annual quantified total.
        for annual in members:
            monthly = sum((decimal(row["quantified_amount"])
                           for month in months for row in month["series"]
                           if row["series_id"] == annual["series_id"]
                           and row["quantified_amount"] is not None), Decimal(0))
            if monthly != decimal(annual["quantified_period_total"]):
                raise ValueError("Calendar and original quantified annual source differ: " + annual["series_id"])
        full_year = all(row["complete_cohort_amount"] is not None for row in months)
        year_total = sum((decimal(row["quantified_amount"]) for row in months
                          if row["quantified_amount"] is not None), Decimal(0))
        facility_mix = []
        if full_year:
            for permit in reporting_permits:
                quantity = sum((decimal(row["annual_total"]) for row in members
                                if row["permit_id"] == permit), Decimal(0))
                facility_mix.append({
                    "permit_id": permit, "facility_name": route[permit]["facility_name"],
                    "annual_amount": text(quantity),
                    "annual_share_percent": text(quantity * 100 / year_total) if year_total else None,
                })
            facility_mix.sort(key=lambda row: decimal(row["annual_amount"]), reverse=True)
        peak = max(months, key=lambda row: decimal(row["complete_cohort_amount"])
                   if row["complete_cohort_amount"] is not None else Decimal(-1)) if full_year else None
        results.append({
            "gauge_id": gauge, "gauge_relation": relation, "calendar_year": year,
            "parameter_code": code, "parameter_name": members[0]["parameter_name"],
            "amount_unit": unit, "selected_permits": selected_permits,
            "permits_without_species": missing_species, "complete_year": full_year,
            "annual_amount": text(year_total) if full_year else None,
            "quantified_period_amount": text(year_total),
            "peak_complete_month": peak["month"] if peak else None,
            "peak_complete_month_amount": peak["complete_cohort_amount"] if peak else None,
            "facility_mix": facility_mix, "months": months,
        })
    return {
        "schema": "upstate.observed-source-calendar/v1", "calendar_year": year,
        "method": "Original selected standard mean rate multiplied by each calendar month's overlap "
                  "days. Exact decimal monthly totals reconcile to every retained annual quantified "
                  "series. Unknown days/species remain separate; facility percentages require a complete cohort year.",
        "interpretation": "Dated facility source quantities and actual network relation. Timing "
                          "describes the retained reporting year; source pressure is distinct from "
                          "downstream delivered mass or measured receiving-water concentration.",
        "groups": results,
    }
