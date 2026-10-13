"""Retain the published Southeast SPARROW sediment-method sensitivity.

This source context applies equation 3 of USGS SIR 2019-5135 to original
P9A682GW TSS targets. It leaves the admitted annual observations, native
comparisons and calibration objectives intact.
"""
from __future__ import annotations

import argparse
import csv
import html
import io
import json
import math
from pathlib import Path

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          held, read_json, verify_file)
from model.reuse import copy_verified
from . import sparrow_reference

VERSION = "upstate.sparrow-sediment-method-sensitivity/v1"
METHOD = {
    "id": "hoos-roland-2019-southeast-convert-equation-3",
    "title": "Southeast SPARROW annual sediment-method sensitivity",
    "publication": "Hoos and Roland (2019), USGS Scientific Investigations Report 2019-5135",
    "publication_uri": "https://doi.org/10.3133/sir20195135",
    "document_uri": "https://pubs.usgs.gov/sir/2019/5135/sir20195135.pdf",
    "locations": ["equation 3, page 10", "Suspended-Sediment Model, page 60"],
    "equation": "SS_annual_load = TSS_annual_load * exp(-b_CONVERT)",
    "coefficient_source": "Original sediment calibration row TSS_CONV",
    "coefficient_units": "dimensionless natural-log model coefficient",
    "input_units": "metric_tonnes/year",
    "output_units": "metric_tonnes/year",
    "interpretation_kind": "regional_sediment_method_sensitivity",
    "reference_kind": "regional-method-derived annual reference",
    "coefficient_application": "once, to original ACTUAL_MT only",
    "source_release": sparrow_reference.URI,
    "uncertainty": {
        "status": "not_quantified",
        "explanation": "The original mapper row supplies the model coefficient but no "
                       "station-specific conversion or target standard error. No "
                       "derived confidence interval is calculated."
    },
}
FIELDS = [
    "record_id", "station_id", "station_name", "catchment_id", "comid",
    "source_parameter_code", "source_constituent", "period_start", "period_end",
    "period_basis", "raw_target_tonnes_per_year", "convert_coefficient",
    "scaling_factor", "regional_method_reference_tonnes_per_year",
    "reference_change_tonnes_per_year", "reference_change_percent",
    "publisher_prediction_tonnes_per_year", "derivation",
]


def _number(value, label, *, nonnegative=False):
    if isinstance(value, bool):
        raise ValueError(label + " must be a finite number")
    number = float(value)
    if not math.isfinite(number) or (nonnegative and number < 0):
        raise ValueError(label + " must be finite" + (" and nonnegative" if nonnegative else ""))
    return number


def _source_record(row):
    record = row.get("source_records")
    if not isinstance(record, dict) or record.get("record_id") != row.get("record_id"):
        raise ValueError("Choose the original one-record P9 preparation")
    return record


def derive(rows, metadata, original_table, table_descriptor):
    """Derive only source-bound sediment context from actual prepared rows."""
    expected = sparrow_reference.FILES["sediment-calibration.json"]
    if (metadata.get("source_uri") != sparrow_reference.URI
            or table_descriptor.get("sha256") != expected["sha256"]
            or table_descriptor.get("bytes") != expected["bytes"]):
        raise ValueError("Select the original published P9 sediment table and preparation")
    features = original_table.get("features")
    if not isinstance(features, list) or len(features) != sparrow_reference.TABLES["sediment-calibration.json"]["records"]:
        raise ValueError("The original regional sediment table is incomplete")
    source_rows = {}
    for feature in features:
        value = feature["attributes"]
        key = value["OBJECTID"]
        if key in source_rows:
            raise ValueError("The original sediment table repeats an OBJECTID")
        source_rows[key] = value
    derived, excluded, seen = [], [], set()
    for annual in rows:
        key = annual["record_id"]
        if key in seen:
            raise ValueError("Prepared reference record IDs must be unique")
        seen.add(key)
        if annual.get("parameter") != "sediment":
            excluded.append({"record_id": key, "parameter": annual.get("parameter"),
                             "reason": "Other original constituent retained without conversion"})
            continue
        record = _source_record(annual)
        original = record.get("original_attributes")
        if not isinstance(original, dict) or source_rows.get(original.get("OBJECTID")) != original:
            raise ValueError("Prepared sediment attributes differ from the original table")
        if record.get("row") != original:
            raise ValueError("Prepared sediment row and original attributes differ")
        if (record.get("original_table") != table_descriptor
                or str(original["COMID"]) != str(record.get("comid"))
                or str(original["STATION_ID"]) != str(annual.get("station_id"))):
            raise ValueError("Prepared sediment source linkage differs")
        constituent = original["CONSTITUEN"]
        expected_code = {"TSS": "00530", "SUSPSED": "80154"}.get(constituent)
        if (expected_code is None or record.get("parameter_code") != expected_code
                or record.get("source_constituent") != constituent):
            raise ValueError("Retain the original declared TSS/SSC analytical basis")
        if (annual.get("unit") != "metric_tonnes/year"
                or record.get("selected_load_field") != "ACTUAL_MT"
                or annual.get("period_start") != sparrow_reference.PERIOD_START
                or annual.get("period_end") != sparrow_reference.PERIOD_END):
            raise ValueError("Select original annual target rates and their declared global horizon")
        target = _number(original["ACTUAL_MT"], "ACTUAL_MT", nonnegative=True)
        if _number(annual["value"], "Prepared annual target", nonnegative=True) != target:
            raise ValueError("The prepared target differs from original ACTUAL_MT")
        coefficient = _number(original["TSS_CONV"], "TSS_CONV")
        factor = math.exp(-coefficient) if constituent == "TSS" else 1.0
        if not math.isfinite(factor) or factor <= 0:
            raise ValueError("The published coefficient did not produce a finite positive factor")
        adjusted = target * factor
        if not math.isfinite(adjusted):
            raise ValueError("The derived annual reference is not finite")
        prediction = original.get("PLOAD_MT")
        if prediction is not None:
            prediction = _number(prediction, "PLOAD_MT", nonnegative=True)
        derived.append({
            "record_id": key, "station_id": annual["station_id"],
            "station_name": original.get("STATION_NM"), "catchment_id": annual["catchment_id"],
            "comid": str(original["COMID"]), "source_parameter_code": expected_code,
            "source_constituent": constituent, "period_start": annual["period_start"],
            "period_end": annual["period_end"], "period_basis": "source-global target horizon",
            "raw_target_tonnes_per_year": target, "convert_coefficient": coefficient,
            "scaling_factor": factor,
            "regional_method_reference_tonnes_per_year": adjusted,
            "reference_change_tonnes_per_year": adjusted - target,
            "reference_change_percent": (factor - 1) * 100 if target else None,
            "publisher_prediction_tonnes_per_year": prediction,
            "derivation": "regional TSS method sensitivity" if constituent == "TSS" else "original SSC target, unchanged",
            "method_id": METHOD["id"], "uncertainty": METHOD["uncertainty"],
            "original_record": annual,
        })
    if not derived:
        raise ValueError("The selected preparation contains no original sediment target")
    return {
        "schema": VERSION, "method": METHOD, "records": derived, "excluded_records": excluded,
        "source_preparation_metadata": metadata,
        "summary": {"sediment_records": len(derived),
                    "tss_records": sum(row["source_parameter_code"] == "00530" for row in derived),
                    "ssc_records": sum(row["source_parameter_code"] == "80154" for row in derived),
                    "other_constituents_retained": len(excluded)},
    }


def _csv(rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=FIELDS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")


def _fmt(value):
    if value is None:
        return "Not supplied"
    if isinstance(value, float):
        return format(value, ".8g")
    return str(value)


def _sections(value):
    rows = value["records"]
    table = {
        "kind": "table",
        "columns": ["Station / constituent", "Original annual target (t/yr)", "Factor",
                    "Regional-method reference (t/yr)"],
        "widths": [0.34, 0.22, 0.16, 0.28],
        "rows": [[row["station_id"] + " / " + row["source_constituent"],
                  _fmt(row["raw_target_tonnes_per_year"]), _fmt(row["scaling_factor"]),
                  _fmt(row["regional_method_reference_tonnes_per_year"])] for row in rows],
    }
    return [
        ["Original and regional-method sediment references", [
            "The original Southeast SPARROW annual targets remain unchanged. This separate "
            "source context shows how the published regional analytical-method adjustment "
            "changes a TSS-based annual reference. Each row retains the original station, "
            "catchment, record, constituent and annual-rate units.",
            table,
            "TSS means total suspended solids (00530). SSC means suspended-sediment "
            "concentration (80154); original SSC targets are carried through unchanged.",
        ]],
        ["Published method and interpretation", [
            "Hoos and Roland (2019), equation 3, define SS annual load as TSS annual load "
            "multiplied by exp(-b_CONVERT). This calculation uses the original mapper row's "
            "TSS_CONV coefficient once. It is a regional model-derived sensitivity "
            "reference, not a station-specific measured SSC load.",
            "The source-global target horizon is water years 2000–2014 and the regional "
            "reference year is 2012. The annual rates are not multiplied by fifteen; "
            "individual station sampling windows are not supplied by the mapper.",
            "The original target standard error and a station-specific conversion "
            "uncertainty are not supplied in the retained row. No derived interval is "
            "assigned. The paper distinguishes annual-load scaling from concentration scaling.",
            "PLOAD_MT is retained separately in the complete CSV/JSON as the publisher's "
            "model prediction. This context does not use it as a measured target or "
            "calculate a validation score. Existing observations, native comparisons and "
            "calibration rankings retain their original values and identities.",
        ]],
        ["Retained method and source detail", [{
            "kind": "links",
            "items": [
                {"title": "Complete sediment sensitivity CSV", "path": "sediment-method-sensitivity.csv"},
                {"title": "Complete source-bound sensitivity JSON", "path": "sediment-method-sensitivity.json"},
                {"title": "Method equation and primary publication", "path": "method.json"},
                {"title": "Original prepared annual records", "path": "reference/annual-records.json"},
                {"title": "Original source metadata", "path": "reference/observation-metadata.json"},
            ],
        }]],
    ]


def _html(value):
    esc = lambda x: html.escape(str(x), quote=True)
    body = []
    for heading, blocks in _sections(value):
        body.append("<section><h2>" + esc(heading) + "</h2>")
        for block in blocks:
            if isinstance(block, str):
                body.append("<p>" + esc(block) + "</p>")
            elif block["kind"] == "table":
                body.append("<div class='scroll'><table><thead><tr>" +
                            "".join("<th>" + esc(x) + "</th>" for x in block["columns"]) +
                            "</tr></thead><tbody>" +
                            "".join("<tr>" + "".join("<td>" + esc(x) + "</td>" for x in row) +
                                    "</tr>" for row in block["rows"]) + "</tbody></table></div>")
            else:
                body.append("<ul>" + "".join("<li><a href='" + esc(x["path"]) + "'>" +
                            esc(x["title"]) + "</a></li>" for x in block["items"]) + "</ul>")
        body.append("</section>")
    body.append("<p>Primary publication: <a href='" + esc(METHOD["document_uri"]) +
                "'>USGS SIR 2019-5135, equation 3 and page 60</a>.</p>")
    return ("<!doctype html><html lang='en'><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>Sediment method sensitivity</title><style>"
            "body{font:15px/1.55 Arial,sans-serif;color:#222;background:#fff;margin:0 auto;"
            "max-width:1100px;padding:32px}h1{font-size:28px}h2{font-size:19px;margin-top:32px}"
            "a{color:#222}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;"
            "padding:9px;text-align:left;vertical-align:top}th{background:#eee}"
            ".scroll{overflow:auto}@media print{body{padding:0}section{break-inside:avoid}"
            "a{overflow-wrap:anywhere}}</style><h1>Sediment method sensitivity</h1>" +
            "".join(body) + "</html>").encode("utf-8")


def prepare(prepared_directory, output_directory):
    root = Path(prepared_directory).resolve(strict=True)
    target = Path(output_directory).resolve()
    if target == root or root in target.parents or target in root.parents:
        raise ValueError("Use a separate output directory beside the original preparation")
    result = read_json(root / "result.json")
    original = dict(result)
    if (original.pop("id", None) != digest(original)
            or result.get("schema") != "upstate.sparrow-regional-reference-preparation/v1"):
        raise ValueError("Select a complete original P9 reference preparation")
    descriptors = {}
    for item in result["files"]:
        name = item["path"]
        if name in descriptors:
            raise ValueError("Prepared source repeats a file path")
        verify_file(root, item)
        descriptors[name] = item
    for name in ("annual-records.json", "observation-metadata.json", "annual-loads.csv"):
        if name not in descriptors:
            raise ValueError("Prepared source is missing " + name)
    metadata = read_json(root / "observation-metadata.json")
    if metadata.get("sha256") != descriptors["annual-loads.csv"]["sha256"]:
        raise ValueError("Original annual metadata and CSV differ")
    rows = read_json(root / "annual-records.json")
    sediment = [row for row in rows if row.get("parameter") == "sediment"]
    if not sediment:
        raise ValueError("Select an original preparation with sediment targets")
    table = _source_record(sediment[0]).get("original_table")
    if not isinstance(table, dict) or table["path"] not in descriptors:
        raise ValueError("Original sediment table is not a retained preparation member")
    if any(table.get(k) != descriptors[table["path"]].get(k) for k in ("path", "bytes", "sha256")):
        raise ValueError("Original sediment table descriptor differs from prepared inventory")
    source_table = read_json(verify_file(root, table))
    value = derive(rows, metadata, source_table, table)
    code_path = Path(__file__).resolve()
    selection = {
        "edition": VERSION, "preparation_id": result["id"],
        "method": METHOD, "producer_sha256": describe_file(code_path.parent, code_path)["sha256"],
        "original_table": table,
    }
    selection_id = digest(selection)
    with held(target / ".prepare.lock"):
        atomic_json(target / "selection.json", selection, immutable=True)
        saved = target / "result.json"
        if saved.exists():
            existing = read_json(saved)
            identity = dict(existing)
            if (identity.pop("id", None) != digest(identity)
                    or existing.get("selection_id") != selection_id):
                raise ValueError("Existing sensitivity source belongs to another exact selection")
            for item in existing["files"]:
                verify_file(target, item)
            return existing
        members = []
        for item in result["files"] + [describe_file(root, root / "result.json")]:
            member = copy_verified(root, item, target, path="reference/" + item["path"])
            members.append(member)
        atomic_bytes(target / "producer.py", code_path.read_bytes(), immutable=True)
        atomic_json(target / "method.json", METHOD, immutable=True)
        value["selection"] = selection
        value["selection_id"] = selection_id
        atomic_json(target / "sediment-method-sensitivity.json", value, immutable=True)
        atomic_bytes(target / "sediment-method-sensitivity.csv", _csv(value["records"]), immutable=True)
        atomic_bytes(target / "sediment-method-sensitivity.html", _html(value), immutable=True)
        for name in ("selection.json", "producer.py", "method.json", "sediment-method-sensitivity.json",
                     "sediment-method-sensitivity.csv", "sediment-method-sensitivity.html"):
            members.append(describe_file(target, target / name))
        recipe = {
            "schema": "upstate.observed-report/v1", "edition": VERSION,
            "title": "Published regional sediment-method sensitivity",
            "vintage": "2012 reference conditions; original P9A682GW regional-method edition",
            "interpretation_kind": METHOD["interpretation_kind"],
            "original_preparation_id": result["id"], "inputs": members,
            "sections": _sections(value), "source_links": [item["path"] for item in members],
        }
        atomic_json(target / "observed-report.json", recipe, immutable=True)
        source_id = "sparrow-sediment-method-" + selection_id[:20]
        entry = {
            "id": source_id, "kind": "document", "role": "OBSERVED_CONTEXT",
            "title": recipe["title"], "uri": METHOD["publication_uri"], "vintage": recipe["vintage"],
            **describe_file(target, target / "observed-report.json"), "companions": members,
            "description": "Original annual target and separate source-bound regional sediment-method reference",
            "metadata": {"report_schema": recipe["schema"], "interpretation_kind": METHOD["interpretation_kind"],
                         "original_preparation_id": result["id"], "method_id": METHOD["id"]},
        }
        atomic_json(target / "source-manifest.json",
                    {"schema": "upstate.sources/v1", "title": recipe["title"], "entries": [entry]},
                    immutable=True)
        output = {"schema": VERSION, "selection_id": selection_id,
                  "original_preparation_id": result["id"], "source_id": source_id,
                  "source_manifest": "source-manifest.json", "summary": value["summary"],
                  "files": members + [describe_file(target, target / name)
                                      for name in ("observed-report.json", "source-manifest.json")]}
        output["id"] = digest(output)
        atomic_json(saved, output, immutable=True)
        return output


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workspace", help="Import the completed context into the existing source picker")
    args = parser.parse_args(argv)
    result = prepare(args.prepared, args.output)
    if args.workspace:
        from model.workspace import Workspace
        workspace = Workspace(args.workspace)
        collection = workspace.import_sources(Path(args.output) / result["source_manifest"])
        result = {**result, "receiving_workspace_id": workspace.project["id"],
                  "source_collection_id": collection["id"],
                  "observed_context_sources": [{"source_collection_id": collection["id"],
                                                "source_id": result["source_id"]}]}
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
