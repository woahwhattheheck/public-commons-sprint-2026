"""Project original provider rows into a review envelope; native rows stay retained."""
from __future__ import annotations

from decimal import Decimal, localcontext
from model import clone, decimal, fail, identity

def canonical(family, row, descriptor, projection, line):
    capture = descriptor["capture_id"]
    locator = {
        "projection": projection, "projection_line": line,
        "projection_row_sha256": identity(row),
        "file": row.get("source_file"),
        "line": row.get("source_line"), "line_end": row.get("source_line_end"),
        "row_sha256": row.get("source_row_sha256"),
        "url": row.get("source_url"), "retrieved_at": row.get("retrieved_at"),
    }
    if family == "acs":
        period = {"kind": "rolling_multi_year", "start": str(row["period_start"]),
                  "end": str(row["period_end"]), "label": str(row["release_year"]) + " ACS 5-year"}
        geo = row["geo_id"]
        vintage = "ACS " + str(row["release_year"]) + " published geography"
        basis = "census_published_geography"
        dimensions = {"table_id": row["table_id"], "summary_level": row["summary_level"]}
        definition = {"universe": row["universe"], "label_path": row["label_path"],
                      "source_type": row["source_type"], "confidence_level": row["confidence_level"],
                      "period_years": row["period_end"] - row["period_start"] + 1}
        status = {
            "estimate": row["estimate_status"], "moe": row["moe_status"],
            "bound_kind": row["bound_kind"], "bound_value": decimal(row["bound_value"]),
            "bound_label": row["bound_label"], "bound_status": row["bound_status"],
            "bound_source_year": row["bound_source_year"],
            "bound_source_path": row["bound_source_path"],
            "bound_source_sha256": row["bound_source_sha256"],
            "bound_source_cell": row["bound_source_cell"],
        }
        locator.update({"estimate_column": row["estimate_column"], "moe_column": row["moe_column"],
                        "selection_receipt": row["selection_receipt"], "indicator_id": row["indicator_id"]})
        value, raw, unit = row["estimate"], row["estimate_raw"], ""
        moe, raw_moe = row["moe"], row["moe_raw"]
        measure, name, slot = row["estimate_variable"], row["geography_name"], "ACS_5_YEAR"
        source_hash = row["source_sha256"]
    elif family == "laus":
        period = {"kind": row["period_kind"], "start": row["period_start"],
                  "end": row["period_end"], "label": str(row["year"]) + " " + row["period"]}
        geo, vintage, basis = row["county_fips"], row["release_vintage"], row["basis"]
        dimensions = {"measure_code": row["measure_code"], "seasonal": row["seasonal"],
                      "area_type_code": row["area_type_code"]}
        definition = {"measure_name": row["measure_name"], "period_kind": row["period_kind"],
                      "coverage_months": row["coverage_months"], "excluded_months": row["excluded_months"],
                      "coverage_note": row["coverage_note"]}
        status = {"value": row["value_status"], "footnote_codes": row["footnote_codes"],
                  "footnotes": row["footnotes"], "coverage_months": row["coverage_months"],
                  "excluded_months": row["excluded_months"], "coverage_note": row["coverage_note"]}
        locator.update({"series_id": row["series_id"], "area_code": row["area_code"],
                        "definition_sources": row["definition_sources"]})
        value, raw, unit = row["value"], row["value_raw"], row["unit"]
        moe, raw_moe = None, None
        measure, name, slot = row["measure_code"], row["area_name"], row["period"]
        source_hash = row["source_sha256"]
    elif family == "qcew":
        period = {"kind": "month" if row["metric"].startswith(("month1_", "month2_", "month3_")) else "quarter",
                  "start": row["period_start"], "end": row["period_end"],
                  "label": str(row["year"]) + " Q" + str(row["quarter"])}
        geo, vintage, basis = row["area_fips"], row["release_vintage"], row["basis"]
        dimensions = {key: row[key] for key in ("ownership_code", "industry_code", "aggregation_code", "size_code")}
        definition = {key: row[key] for key in ("ownership_title", "industry_title", "aggregation_title", "size_title")}
        status = {"value": row["value_status"], "disclosure_code": row["disclosure_code"],
                  "disclosure_group": row["disclosure_group"]}
        value, raw, unit = row["value"], row["value_raw"], row["unit"]
        moe, raw_moe = None, None
        measure, name, slot = row["metric"], row["area_name"], "Q" + str(row["quarter"])
        source_hash = row["source_sha256"]
    elif family == "hud_income_limits":
        period = {"kind": "fiscal_year", "start": str(row["fiscal_year"]),
                  "end": str(row["fiscal_year"]), "label": "FY" + str(row["fiscal_year"])}
        geo, vintage, basis = row["locality_id"], "HUD FY" + str(row["fiscal_year"]), "hud_published_locality"
        dimensions = {"metric": row["metric"], "family_size": row["family_size"], "program": row["program"]}
        definition = {"hud_area_code": row["hud_area_code"], "hud_area_name": row["hud_area_name"],
                      "county_fips": row["county_fips"], "metro": row["metro"],
                      "effective_date": row["effective_date"], "additive": False}
        status = {"value": "reported", "published_income_threshold": True}
        locator.update({"file": descriptor["hud_workbook"],
                        "sheet": row["source_sheet"], "row": row["source_row"],
                        "cell": row["source_cell"], "field": row["source_field"],
                        "url": descriptor["workbook_url"], "retrieved_at": descriptor["workbook_retrieved_at"]})
        value, raw, unit = row["published_income_usd"], row["source_value"], "USD/year"
        moe, raw_moe = None, None
        measure, name, slot = row["metric"], row["locality_name"], "HUD_FISCAL_YEAR"
        source_hash = row["workbook_sha256"]
    else:
        fail("SOURCE_FAMILY_INVALID")
    envelope = {
        "schema": "stellar-forge.study-observation.v1",
        "source_family": family, "source_release_id": capture,
        "reference_period": period, "period_slot": slot,
        "source_geography_id": geo, "geography_name": name,
        "geography_vintage": vintage, "geography_vintage_kind": "source_definition_edition",
        "geography_basis": basis, "source_measure_id": measure,
        "native_dimensions": dimensions, "definition": definition,
        "raw_value": raw, "normalized_value": decimal(value), "unit": unit, "status": status,
        "raw_moe": raw_moe, "normalized_moe": decimal(moe),
        "source_hash": source_hash, "source_locator": locator,
    }
    envelope["row_id"] = identity([family, capture, geo, measure, period, dimensions])
    return envelope


def comparison_key(row, mode):
    return identity([
        row["source_family"], row["client_geography_id"], row["source_measure_id"],
        row["native_dimensions"], row["reference_period"] if mode == "same_period" else row["period_slot"],
    ])


def difference(before, after, mode):
    """A period comparison never implies a significance test or a geography crosswalk."""
    if before is None:
        return {"kind": "added", "reasons": [], "changed_fields": [], "delta": None}
    if after is None:
        return {"kind": "removed", "reasons": [], "changed_fields": [], "delta": None}
    reasons = []
    for field in ("geography_basis", "comparison_geography", "native_dimensions", "unit",
                  "output_unit", "unit_rule"):
        if before.get(field) != after.get(field):
            reasons.append(field + "_changed")
    old_definition, new_definition = clone(before["definition"]), clone(after["definition"])
    if mode == "successive_release" and before["source_family"] == "hud_income_limits":
        old_definition.pop("effective_date", None)
        new_definition.pop("effective_date", None)
    if old_definition != new_definition:
        reasons.append("source_definition_changed")
    if before["reference_period"]["kind"] != after["reference_period"]["kind"]:
        reasons.append("period_kind_changed")
    if mode == "same_period" and before["reference_period"] != after["reference_period"]:
        reasons.append("reference_period_changed")
    fields = ("raw_value", "normalized_value", "raw_moe", "normalized_moe", "status",
              "output_value", "output_unit", "geography_name", "definition", "reference_period", "mapped")
    changed = [field for field in fields if before.get(field) != after.get(field)]
    # Provenance columns inside a mapped row do not alone make a measurement change.
    if changed == ["mapped"]:
        changed = []
    delta = None
    if not reasons and before["output_value"] is not None and after["output_value"] is not None:
        with localcontext() as ctx:
            ctx.prec = 120
            delta = format(Decimal(after["output_value"]) - Decimal(before["output_value"]), "f")
    if reasons:
        kind = "incomparable"
    else:
        kind = "changed" if changed else "unchanged"
    return {"kind": kind, "reasons": reasons, "changed_fields": changed, "delta": delta}
