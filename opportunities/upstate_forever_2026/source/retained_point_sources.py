"""Bind retained original discharge quantities and network relationships to observation context."""
from __future__ import annotations
import csv
import hashlib
import json
from pathlib import Path
from model.common import digest, held, relative_file
from model import observation_support
from .observation_source_calendar import summarize, decimal

VERSION = "1.0.0"
KINDS = ("periods", "annual", "relations", "cohorts")
PATHS = {
    "periods": "derived/period_loads.csv",
    "annual": "routing/derived/annual_quantities_with_routing.csv",
    "relations": "routing/derived/outfall_gauge_relations.csv",
    "cohorts": "routing/derived/reported_quantities_by_gauge_relation.csv",
}
REQUIRED = {
    "periods": {"series_id", "permit_id", "parameter_code", "reporting_feature",
                "monitoring_location", "amount_unit", "period_start", "period_end_exclusive",
                "amount_in_2023", "standard_rate", "selected_dmr_value_ids"},
    "annual": {"series_id", "calendar_year", "permit_id", "parameter_code", "parameter_name",
               "reporting_feature", "monitoring_location", "amount_unit", "gauge_id",
               "gauge_relation", "annual_total", "quantified_period_total", "quantified_days",
               "complete_calendar_year", "selected_dmr_value_ids"},
    "relations": {"permit_id", "state_outfall_id", "facility_name", "gauge_id", "gauge_relation",
                  "in_original_whole_basin"},
    "cohorts": {"gauge_id", "cohort", "parameter_code", "calendar_year", "amount_unit",
                "selected_permits", "series_ids", "quantified_period_sum",
                "annual_sum_of_reported_series"},
}


def _table(path, kind):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if (not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames))
                or REQUIRED[kind] - set(reader.fieldnames)):
            raise ValueError("The retained " + kind + " table lacks its original distinct fields")
        rows = list(reader)
    if not rows or any(None in row or any(v is None for v in row.values()) for row in rows):
        raise ValueError("The retained " + kind + " table is empty or malformed")
    return rows


def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Select the four original retained source tables")
    result = {}
    for kind in KINDS:
        item = value.get(kind)
        if (not isinstance(item, dict) or any(not isinstance(item.get(key), str)
                or not item[key].strip() for key in ("source_collection_id", "source_id"))):
            raise ValueError("Select an original source collection and " + kind + " table")
        result[kind] = {key: item[key] for key in ("source_collection_id", "source_id")}
    if len({(r["source_collection_id"], r["source_id"]) for r in result.values()}) != 4:
        raise ValueError("Select distinct original period, annual, relationship and cohort tables")
    return result



def summaries(workspace):
    return [{key: row[key] for key in (
        "id", "version", "source_signature", "calendar_year", "observations",
        "original_facilities", "original_series", "original_periods", "cohort_rows")}
        for row in workspace._list("point-source-bindings")]


def _check_cohorts(tables, registry, year):
    expected = {}
    for gauge in sorted({row["gauge_id"] for row in registry.values()}):
        for cohort in ("upstream", "downstream", "whole_basin_footprint"):
            permits = sorted(permit for permit, row in registry.items()
                             if row["gauge_id"] == gauge and (
                                 row.get("in_original_whole_basin") == "true"
                                 if cohort == "whole_basin_footprint" else row["gauge_relation"] == cohort))
            for code in sorted({row["parameter_code"] for row in tables["annual"]}):
                selected = [row for row in tables["annual"]
                            if row["permit_id"] in permits and row["parameter_code"] == code]
                if selected:
                    expected[(gauge, cohort, code)] = (permits, selected)
    seen = set()
    for row in tables["cohorts"]:
        key = (row["gauge_id"], row["cohort"], row["parameter_code"])
        if key in seen or key not in expected or int(row["calendar_year"]) != year:
            raise ValueError("The original cohort identity differs from its annual/network sources")
        seen.add(key)
        permits, selected = expected[key]
        if (sorted(row["selected_permits"].split(";")) != permits
                or sorted(row["series_ids"].split(";")) != sorted(r["series_id"] for r in selected)
                or {r["amount_unit"] for r in selected} != {row["amount_unit"]}):
            raise ValueError("The original cohort source membership or species units differ")
        if decimal(row["quantified_period_sum"]) != sum(decimal(r["quantified_period_total"]) for r in selected):
            raise ValueError("The cohort's quantified amount differs from its original annual series")
        complete = all(r["complete_calendar_year"] == "true" for r in selected)
        if complete:
            if decimal(row["annual_sum_of_reported_series"]) != sum(decimal(r["annual_total"]) for r in selected):
                raise ValueError("The cohort's complete annual amount differs from its original series")
        elif row["annual_sum_of_reported_series"] != "":
            raise ValueError("An incomplete source cohort carries a complete annual amount")
    if seen != set(expected):
        raise ValueError("The original cohort table omits a retained source cohort/species")


def catalog(workspace):
    """List exact retained tables; recognition helps selection without guessing source membership."""
    choices = {kind: [] for kind in KINDS}
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if entry.get("kind") != "table":
                continue
            body = entry["body"]
            path = str(body.get("source_path") or body.get("view_path") or body.get("filename") or "").replace("\\", "/")
            for kind, expected in PATHS.items():
                if path == expected or path.endswith("/" + expected):
                    choices[kind].append({
                        "source_collection_id": collection["id"], "source_id": entry["id"],
                        "title": entry["title"], "collection_title": collection["title"],
                        "vintage": entry["vintage"], "uri": entry["uri"],
                        "sha256": body["sha256"], "bytes": body["bytes"],
                        "original_manifest": collection.get("original_manifest"),
                    })
    return {"schema": "upstate.point-source-catalog/v1", "choices": choices,
            "bindings": summaries(workspace),
            "required_source_paths": PATHS}


def _load(workspace, selection):
    selection = _selection(selection)
    tables, paths, entries, lineage = {}, {}, {}, {}
    for kind, chosen in selection.items():
        path, entry = workspace.source_file(chosen["source_collection_id"], chosen["source_id"])
        if entry.get("kind") != "table":
            raise ValueError("The selected original " + kind + " source must be a table")
        body = entry["body"]
        raw = path.read_bytes()
        if len(raw) != body["bytes"] or hashlib.sha256(raw).hexdigest() != body["sha256"]:
            raise ValueError("The original retained " + kind + " bytes differ")
        paths[kind], entries[kind] = path, entry
        tables[kind] = _table(path, kind)
        collection = workspace._get("sources", chosen["source_collection_id"])
        lineage[kind] = {
            **chosen, "sha256": body["sha256"], "bytes": body["bytes"],
            "title": entry["title"], "uri": entry["uri"], "vintage": entry["vintage"],
            "original_source_path": body.get("source_path"),
            "original_manifest": collection.get("original_manifest"),
        }
    years = {row["calendar_year"] for row in tables["annual"]}
    if len(years) != 1:
        raise ValueError("Select one original annual source year")
    year = int(next(iter(years)))
    # This source processor's amount column is explicitly tied to its retained 2023 edition.
    if year != 2023:
        raise ValueError("The selected original period processor defines amount_in_2023; use its 2023 annual edition")
    registry = {}
    for row in tables["relations"]:
        permit = row["permit_id"]
        if not permit or permit in registry:
            raise ValueError("The retained permit-to-gauge relationship must be unique")
        registry[permit] = {
            **row, "outfall_id": row["state_outfall_id"],
            "outfall_identity": "State mapped outfall; EPA reporting feature retained separately",
        }
    for row in tables["annual"]:
        relation = registry.get(row["permit_id"])
        if not relation or any(row[key] != relation[key] for key in ("gauge_id", "gauge_relation")):
            raise ValueError("An annual source series differs from its retained network relation")
    _check_cohorts(tables, registry, year)
    calendar = summarize(tables["periods"], tables["annual"], tables["relations"])
    signature = digest({"version": VERSION, "selection": selection, "lineage": lineage,
                        "source_calendar": calendar})
    preview = {
        "schema": "upstate.point-source-preview/v1", "version": VERSION,
        "selection": selection, "source_signature": signature, "sources": lineage,
        "calendar_year": year, "facilities": list(registry.values()),
        "original_series": len(tables["annual"]), "original_periods": len(tables["periods"]),
        "cohort_rows": len(tables["cohorts"]), "source_calendar": calendar,
        "cohort_quantities": tables["cohorts"],
        "interpretation": "Original reported facility discharge quantities and actual network relationships. "
                          "Complete annual and quantified-period observations remain separate. These source "
                          "amounts retain their species and original coverage; river delivery is a different quantity.",
    }
    return preview, paths, entries, tables, registry


def preview(workspace, selection):
    return _load(workspace, selection)[0]


def _observation_editions(basis, entries, tables, registry):
    """One exact metadata contract for creation and source-backed receiving checks."""
    selection, year = basis["selection"], basis["calendar_year"]
    expected_signature = basis["source_signature"]
    for field, title, quantity_basis in (
        ("annual_total", "Complete reported annual outfall quantities", "annual_quantity"),
        ("quantified_period_total", "Reported outfall quantities over actual quantified periods",
         "quantified_period_quantity"),
    ):
        annual = entries["annual"]
        metadata = {
            "schema": "upstate.observation-support/v1", "title": title + " — " + str(year),
            "value_basis": "context", "measurement_support": "point_source_discharge",
            "observation_kind": "reported_effluent_source_amount", "quantity_basis": quantity_basis,
            "time_support": "calendar_year", "period_start": str(year) + "-01-01",
            "period_end": str(year + 1) + "-01-01", "period_end_inclusive": False,
            "expected_days": 365,
            "method": "Original reported standard average rate integrated over its actual represented "
                      "days by the retained source processor. Annual quantities require complete "
                      "nonoverlapping quantified-year coverage.",
            "source_uri": annual["uri"], "sha256": annual["body"]["sha256"],
            **selection["annual"], "source_vintage": annual["vintage"],
            "source_bindings": basis["sources"], "source_binding_signature": expected_signature,
            "columns": {
                "record_id": "series_id", "station_id": "permit_id", "facility_id": "permit_id",
                "parameter": "parameter_name", "species": "parameter_code",
                "parameter_code": "parameter_code", "value": field, "unit": "amount_unit",
                "reporting_feature": "reporting_feature", "monitoring_location": "monitoring_location",
                "gauge_id": "gauge_id", "gauge_relation": "gauge_relation",
                "coverage_days": "quantified_days", "coverage_complete": "complete_calendar_year",
                "source_records": "selected_dmr_value_ids",
            },
            "series_dimensions": ["reporting_feature", "monitoring_location", "gauge_relation"],
            "facility_registry": registry, "cohort_quantities": tables["cohorts"],
            "source_calendar": basis["source_calendar"],
            "original_source_collection_id": selection["periods"]["source_collection_id"],
            "source_periods": basis["sources"]["periods"], "cohort_source": basis["sources"]["cohorts"],
            "interpretation": basis["interpretation"],
        }
        yield field, title, quantity_basis, metadata


def _verify_binding(workspace, record, loaded=None):
    basis, paths, entries, tables, registry = loaded or _load(workspace, record["selection"])
    for key in ("version", "source_signature", "selection", "sources", "calendar_year",
                "original_series", "original_periods", "cohort_rows", "source_calendar",
                "interpretation"):
        if record[key] != basis[key]:
            raise ValueError("The retained point-source binding differs from its original source: " + key)
    if record["original_facilities"] != len(registry):
        raise ValueError("The retained source facility count differs")
    expected = list(_observation_editions(basis, entries, tables, registry))
    if len(record["observations"]) != len(expected):
        raise ValueError("Receive both complete-year and quantified-period observation editions")
    for item, (field, title, quantity_basis, metadata) in zip(record["observations"], expected):
        edition = workspace._get("observations", item["id"])
        expected_item = {"id": edition["id"], "title": metadata["title"],
                         "quantity_basis": quantity_basis, "rows": len(tables["annual"]),
                         **basis["selection"]["annual"]}
        if item != expected_item or edition["metadata"] != metadata:
            raise ValueError("The retained source observation edition has different lineage or support")
        original = edition["original"]
        raw = relative_file(workspace.root, original["object"]).read_bytes()
        annual = entries["annual"]["body"]
        if (len(raw) != original["bytes"] or hashlib.sha256(raw).hexdigest() != original["sha256"]
                or original["bytes"] != annual["bytes"] or original["sha256"] != annual["sha256"]):
            raise ValueError("The original observation and annual discharge table differ")
        rows = edition["rows"]
        if len(rows) != len(tables["annual"]) or edition["admitted_count"] != 0 or edition["context_count"] != len(rows):
            raise ValueError("Retain every original outfall quantity as point-source context")
        for row, source in zip(rows, tables["annual"]):
            values = {
                "id": source["series_id"], "original": source,
                "station_id": source["permit_id"], "facility_id": source["permit_id"],
                "parameter": source["parameter_name"], "species": source["parameter_code"],
                "parameter_code": source["parameter_code"], "value_text": source[field].strip(),
                "unit": source["amount_unit"], "measurement_support": "point_source_discharge",
                "quantity_basis": quantity_basis, "gauge_id": source["gauge_id"],
                "gauge_relation": source["gauge_relation"],
                "reporting_feature": source["reporting_feature"],
                "monitoring_location": source["monitoring_location"], "admitted": False,
                "coverage_days": int(source["quantified_days"]), "expected_days": 365,
                "coverage_complete": source["complete_calendar_year"] == "true",
                "period_start": "2023-01-01", "period_end": "2024-01-01",
            }
            if any(row.get(key) != value for key, value in values.items()):
                raise ValueError("The observed source row differs from its original quantity or support")
            if values["value_text"]:
                if row.get("value") != float(decimal(values["value_text"])):
                    raise ValueError("The displayed source quantity differs from its original decimal value")
            elif "value" in row:
                raise ValueError("An unquantified source amount has acquired a numeric value")
        if edition["support_summary"] != observation_support.summarize(rows):
            raise ValueError("The retained observation support summary differs")
    return {"id": record["id"], "source_signature": record["source_signature"],
            "calendar_year": record["calendar_year"], "observation_editions": len(expected),
            "original_series": record["original_series"], "original_periods": record["original_periods"]}


def verify_workspace(workspace):
    """Verify source/calendar/observation closure during portable or operator receiving."""
    reports = [_verify_binding(workspace, record)
               for record in workspace._list("point-source-bindings")]
    return {"schema": "upstate.point-source-verification/v1", "bindings": reports}


def bind(workspace, selection, *, expected_signature):
    """Publish both source observation editions and their binding under one capture lock."""
    loaded = _load(workspace, selection)
    basis, paths, entries, tables, registry = loaded
    if expected_signature != basis["source_signature"]:
        raise ValueError("Preview the exact selected retained sources before importing their context")
    with held(workspace.root / ".workspace.lock", blocking=False):
        existing = [row for row in workspace._list("point-source-bindings")
                    if row.get("source_signature") == expected_signature and row.get("version") == VERSION]
        if existing:
            if len(existing) != 1:
                raise ValueError("The same source binding has multiple retained identities")
            _verify_binding(workspace, existing[0], loaded)
            return existing[0]
        editions = []
        for field, title, quantity_basis, metadata in _observation_editions(basis, entries, tables, registry):
            edition = workspace.import_observations(paths["annual"], metadata)
            if edition["admitted_count"]:
                raise RuntimeError("Original outfall context unexpectedly entered native catchment metrics")
            editions.append({"id": edition["id"], "title": metadata["title"],
                             "quantity_basis": quantity_basis, "rows": len(edition["rows"]),
                             **basis["selection"]["annual"]})
        record = workspace._save("point-source-bindings", {
            "version": VERSION, "source_signature": expected_signature, "selection": basis["selection"],
            "sources": basis["sources"], "calendar_year": basis["calendar_year"], "observations": editions,
            "original_facilities": len(registry), "original_series": basis["original_series"],
            "original_periods": basis["original_periods"], "cohort_rows": basis["cohort_rows"],
            "source_calendar": basis["source_calendar"], "interpretation": basis["interpretation"],
        })
        _verify_binding(workspace, record, loaded)
        return record
