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


REFERENCE_BASIS_VERSION = "upstate.annual-reference-basis/v1"
REFERENCE_METHOD_SOURCE = "https://pubs.usgs.gov/publication/wri004191"
_REFERENCE_CODES = {
    "00600": ("nitrogen", "Total nitrogen", "total_nitrogen"),
    "00665": ("phosphorus", "Total phosphorus", "total_phosphorus"),
    "00530": ("sediment", "Total suspended solids (TSS)", "tss"),
    "80154": ("sediment", "Suspended-sediment concentration (SSC) based load", "ssc"),
}
_REFERENCE_ALIASES = {
    "tn": "00600", "total nitrogen": "00600",
    "tp": "00665", "total phosphorus": "00665",
    "tss": "00530", "total suspended solids": "00530",
    "ssc": "80154", "suspended sediment": "80154",
    "suspended sediment concentration": "80154",
}


def reference_basis(row, metadata=None):
    """Describe retained constituent evidence without changing admission or mass."""
    metadata = metadata or {}
    evidence = []
    def read(value, path):
        value = detail(value)
        if not isinstance(value, dict):
            return
        for field in ("parameter_code", "series", "source_constituent", "species"):
            token = value.get(field)
            if token in (None, ""):
                continue
            key = species_key(token)
            code = (str(token).strip().zfill(5) if re.fullmatch(r"[0-9]{1,5}", str(token).strip())
                    else _REFERENCE_ALIASES.get(key))
            if code in _REFERENCE_CODES:
                evidence.append({"field": path + field, "original_value": token, "parameter_code": code})
        for field in ("row", "original_attributes"):
            original = value.get(field)
            if isinstance(original, dict) and original.get("CONSTITUEN") not in (None, ""):
                token = original["CONSTITUEN"]
                code = _REFERENCE_ALIASES.get(species_key(token))
                if code:
                    evidence.append({"field": path + field + ".CONSTITUEN",
                                     "original_value": token, "parameter_code": code})
    read(row, "")
    read(metadata, "metadata.")
    sources = detail(row.get("source_records"))
    sources = sources if isinstance(sources, list) else [sources]
    for index, source in enumerate(sources):
        read(source, "source_records[" + str(index) + "].")
    codes = sorted({item["parameter_code"] for item in evidence})
    parameter = row.get("parameter")
    constituents = [{"parameter_code": code, "parameter": _REFERENCE_CODES[code][0],
                     "label": _REFERENCE_CODES[code][1], "basis": _REFERENCE_CODES[code][2]}
                    for code in codes]
    inconsistent = any(item["parameter"] != parameter for item in constituents)
    status = ("conflicting_parameter" if inconsistent else
              "mixed_source_constituents" if len(codes) > 1 else
              "declared_original_constituent" if codes else "not_declared")
    label = "; ".join(item["label"] + " [" + item["parameter_code"] + "]" for item in constituents)
    if not label:
        label = source_species(row, metadata) or str(parameter or "Unspecified constituent")
    notes = []
    if "00530" in codes:
        notes.append("The annual reference is derived from TSS measurements. TSS and whole-sample SSC "
                     "are different analytical bases and are not interchangeable; a residual against "
                     "native sediment export also reflects that source-method difference.")
    if "80154" in codes:
        notes.append("The annual reference is derived from suspended-sediment measurements. Retain its "
                     "sampling and estimator support when interpreting native hillslope delivery to streams.")
    if "00530" in codes or "80154" in codes:
        notes.append("Original annual values and any published TSS_CONV field remain unchanged. "
                     "This report does not apply an inferred TSS-to-SSC or outlet-transport conversion.")
    if status == "mixed_source_constituents":
        notes.append("This retained reference combines more than one declared constituent basis. "
                     "Its original aggregate remains visible; it is not relabeled as one analytical method.")
    elif inconsistent:
        notes.append("The retained constituent evidence differs from the selected native parameter; "
                     "inspect the original source fields alongside the unchanged comparison.")
    elif not codes and parameter == "sediment":
        notes.append("The retained fields do not identify a specific TSS or SSC analytical basis.")
    return {"schema": REFERENCE_BASIS_VERSION, "parameter": parameter, "status": status,
            "label": label, "parameter_codes": codes, "constituents": constituents,
            "source_fields": evidence, "interpretation": " ".join(notes),
            "method_references": [REFERENCE_METHOD_SOURCE] if any(c in codes for c in ("00530", "80154")) else [],
            "quantity_transformation": "none; retained annual quantities and comparison eligibility are unchanged"}


def reference_basis_rows(rows, metadata=None):
    """One source-aware description per original comparison/reference unit."""
    result = []
    for row in rows:
        basis = reference_basis(row, metadata)
        result.append({
            "reference_id": row.get("unit_id") or row.get("id") or row.get("observation_id"),
            "parameter": row.get("parameter"), "catchment_id": row.get("catchment_id"),
            "station_id": row.get("station_id"), "observation_record_ids": row.get("observation_record_ids"),
            "period_start": row.get("period_start"), "period_end": row.get("period_end"),
            "reference_label": basis["label"], "parameter_codes": basis["parameter_codes"],
            "reference_status": basis["status"], "interpretation": basis["interpretation"],
            "source_fields": basis["source_fields"], "method_references": basis["method_references"],
        })
    return result


def reference_basis_blocks(rows, metadata=None):
    """Readable report blocks from the same retained reference descriptions."""
    summaries = {}
    for row in reference_basis_rows(rows, metadata):
        key = (row["parameter"], row["reference_label"], row["reference_status"])
        item = summaries.setdefault(key, {**row, "records": 0})
        item["records"] += 1
    if not summaries:
        return []
    blocks = [
        "Original reference constituents. Annual mass units do not make different analytical "
        "methods equivalent. The source labels below accompany the retained comparisons and their "
        "existing objective; source values, admitted rows and native results keep their identities.",
        {"kind": "table", "columns": ["Native parameter", "Original reference basis", "Retained rows", "Interpretation"],
         "rows": [[str(item["parameter"]), item["reference_label"], str(item["records"]),
                   item["interpretation"] or "Original constituent identity retained."]
                  for item in summaries.values()]},
    ]
    if any(item["method_references"] for item in summaries.values()):
        blocks.append("Source-method reference: USGS, Comparability of suspended-sediment concentration "
                      "and total suspended solids data (2000), " + REFERENCE_METHOD_SOURCE + ".")
    return blocks
