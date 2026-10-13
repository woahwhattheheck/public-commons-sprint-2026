"""Scientific support of retained measurements and native catchment comparisons."""
from __future__ import annotations
from collections import Counter
from decimal import Decimal
import json
import re

FIELDS = (
    "measurement_support", "species", "facility_id", "facility_name", "outfall_id",
    "reporting_feature", "monitoring_location", "parameter_code", "gauge_id",
    "gauge_relation", "relation_method", "quantity_basis", "coverage_days",
    "expected_days", "coverage_complete", "coverage_detail", "source_quantity",
)
SUPPORTS = {
    "catchment_export": "Receiving-water catchment export",
    "point_source_discharge": "Observed point-source discharge",
    "concentration": "Observed concentration",
    "other_context": "Other original measurement context",
}
SPECIES = {
    "nitrogen": {"nitrogen", "total nitrogen", "nitrogen total", "total nitrogen as n",
                 "nitrogen total as n", "tn", "00600", "epa 00600"},
    "phosphorus": {"phosphorus", "total phosphorus", "phosphorus total",
                   "total phosphorus as p", "phosphorus total as p", "tp", "00665", "epa 00665"},
    "sediment": {"sediment", "total sediment"},
}


KIND_SUPPORTS = {
    "reported_effluent_source_amount": "point_source_discharge",
    "complete_reported_effluent_source_amount": "point_source_discharge",
    "receiving_water_measurement": "concentration",
    "receiving_water_derived_concentration": "concentration",
}


def species_key(value):
    return re.sub(r"[\s_,()\[\]\-]+", " ", str(value).strip().lower()).strip()


def source_species(row, metadata):
    declared = row.get("species") or metadata.get("species")
    if declared:
        return str(declared)
    original = row.get("original_parameter")
    if not original and isinstance(row.get("original"), dict):
        field = metadata.get("columns", {}).get("parameter", "parameter")
        original = row["original"].get(field)
    return str(original or row.get("parameter") or "")


def detail(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value, parse_constant=lambda token: (_ for _ in ()).throw(ValueError(token)))
    except (ValueError, TypeError):
        return value


def attributes(cell, metadata, parameter):
    result = {}
    for key in FIELDS:
        value = cell(key)
        if value in (None, ""):
            value = metadata.get(key)
        if value not in (None, ""):
            result[key] = detail(value) if key in ("coverage_detail", "source_quantity") else value
    explicit = result.get("measurement_support")
    annual = metadata.get("value_basis") == "annual_mass_rate"
    kind = metadata.get("observation_kind")
    kind_support = KIND_SUPPORTS.get(kind)
    result["measurement_support"] = explicit or kind_support or (
        "catchment_export" if annual else "other_context")
    result["support_origin"] = ("explicit_source" if explicit else
                               "declared_context_kind" if kind_support or not annual else
                               "legacy_catchment_import_contract")
    declared_species = result.get("species")
    result["original_parameter"] = cell("parameter") or parameter
    result["species"] = str(declared_species or result["original_parameter"])
    result["species_origin"] = "explicit_source" if declared_species else "original_parameter"
    result["quantity_basis"] = result.get("quantity_basis") or metadata.get("value_basis", "context")
    facility = metadata.get("facility_registry", {}).get(result.get("facility_id"), {})
    for key in ("facility_name", "outfall_id", "relation_method"):
        if key not in result and facility.get(key) is not None:
            result[key] = facility[key]
    if result.get("gauge_relation") and facility.get("gauge_relation") not in (None, result["gauge_relation"]):
        raise ValueError("The retained facility and quantity gauge relationships differ")
    if result["measurement_support"] not in SUPPORTS:
        raise ValueError("Unknown measurement_support: " + str(result["measurement_support"]))
    for key in ("coverage_days", "expected_days"):
        if key in result:
            value = Decimal(str(result[key]))
            if not value.is_finite() or value < 0 or value != value.to_integral_value():
                raise ValueError(key + " must be an original nonnegative integer day count")
            result[key] = int(value)
    if "coverage_complete" in result:
        value = result["coverage_complete"]
        if value in (True, "true", "True", "1", 1):
            result["coverage_complete"] = True
        elif value in (False, "false", "False", "0", 0):
            result["coverage_complete"] = False
        else:
            raise ValueError("coverage_complete must be true or false")
    return result


def measurement_support(row, metadata=None):
    metadata = metadata or {}
    return (row.get("measurement_support") or metadata.get("measurement_support")
            or KIND_SUPPORTS.get(metadata.get("observation_kind"))
            or ("catchment_export" if metadata.get("value_basis", "annual_mass_rate") == "annual_mass_rate"
                else "other_context"))


def comparison_issues(row, metadata=None):
    metadata = metadata or {}
    support = measurement_support(row, metadata)
    issues = []
    if support != "catchment_export":
        issues.append("Retained " + SUPPORTS.get(support, str(support)).lower()
                      + "; native landscape catchment export is a different quantity")
    kind_support = KIND_SUPPORTS.get(metadata.get("observation_kind"))
    if kind_support and kind_support != support:
        issues.append("Original source kind declares " + SUPPORTS[kind_support].lower()
                      + "; the selected measurement support conflicts with that source")
    parameter = row.get("parameter")
    species = source_species(row, metadata)
    if parameter in SPECIES and species_key(species) not in SPECIES[parameter]:
        issues.append("Original species " + species + " differs from native total " + parameter)
    basis = row.get("quantity_basis") or metadata.get("value_basis", "context")
    if basis != "annual_mass_rate":
        issues.append("The original quantity is not an explicitly derived annual mass rate")
    if row.get("coverage_complete") is False and basis == "annual_mass_rate":
        issues.append("Source declares incomplete coverage; retain its quantified-period quantity")
    return issues


def summarize(rows):
    kinds = Counter(row.get("measurement_support", "catchment_export") for row in rows)
    return {
        "counts": dict(kinds),
        "titles": {key: SUPPORTS.get(key, key) for key in kinds},
        "native_comparison_count": sum(row.get("admitted", False) for row in rows),
        "point_source_count": kinds.get("point_source_discharge", 0),
        "legacy_catchment_contract_count": sum(
            row.get("support_origin") == "legacy_catchment_import_contract" for row in rows),
        "interpretation": "Facility discharge, receiving-water catchment load and concentration "
                          "retain their original support. Native residuals compare like annual catchment "
                          "quantities. Point-source quantities remain dated context with original species, "
                          "reporting feature, gauge relation and quantified coverage.",
    }


def context_record(row, metadata=None):
    """Keep original quantities available when a native fit statistic is inappropriate."""
    metadata = metadata or {}
    return {
        "observation_id": row["id"],
        **{key: row.get(key) for key in FIELDS if key in row},
        "measurement_support": measurement_support(row, metadata),
        "species": source_species(row, metadata),
        "original_parameter": row.get("original_parameter"),
        "species_origin": row.get("species_origin"),
        "station_id": row.get("station_id"), "catchment_id": row.get("catchment_id"),
        "parameter": row.get("parameter"), "value_text": row.get("value_text"),
        "unit": row.get("unit"), "period_start": row.get("period_start"),
        "period_end": row.get("period_end"), "method": row.get("method"),
        "qualifier": row.get("qualifier"), "uncertainty": row.get("uncertainty"),
        "source_records": row.get("source_records"), "original": row.get("original"),
        "comparison_issues": list(dict.fromkeys([*row.get("issues", []),
                                                  *comparison_issues(row, metadata)])),
    }
