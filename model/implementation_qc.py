"""Explicit sample quality-control reviews of original saved FIELD12 revisions."""
from __future__ import annotations

import copy
import csv
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

from .implementation import ImplementationStore, _atomic_bytes
from .implementation_schema import (
    ImplementationError, canonical_bytes, document_digest, validate_plan,
    summarize_plan, _safe_id,
)
from .portable_implementation import report_edition
from .implementation_observations import _attachment_inventory, _retain
from .common import describe_file, read_json, file_digest
from . import observed_context

SCHEMA = "upstate.implementation-qc-review/v1"
SELECTION_SCHEMA = "upstate.implementation-qc-selection/v1"
EDITION = "implementation-qc-20261013-v1"
DEFINITIONS = ("parameter", "unit", "basis", "fraction", "method", "activity_method")
RELATIONSHIPS = {
    "duplicate": ("field_duplicate", "laboratory_duplicate", "split_sample"),
    "replicate": ("field_replicate", "laboratory_replicate"),
    "blank": ("field_blank", "equipment_blank", "trip_blank", "method_blank"),
}
METRICS = {
    "duplicate": ("rpd_percent", "absolute_difference"),
    "replicate": ("rsd_percent",),
    "blank": ("blank_value",),
}
METHOD_SOURCES = [
    {
        "title": "EPA National Functional Guidelines for Inorganic Superfund Methods Data Review (2017)",
        "url": "https://www.epa.gov/sites/default/files/2017-01/documents/national_functional_guidelines_for_inorganic_superfund_methods_data_review_01302017.pdf",
        "use": "Duplicate RPD definition; quantitation and method-specific criteria require their own stated applicability.",
    },
    {
        "title": "EPA New England Environmental Data Review Supplement (2013), section 2.8",
        "url": "https://www.epa.gov/sites/production/files/2016-04/documents/epa-ne-edr-supplement.pdf",
        "use": "Field duplicate and replicate precision; project-specific criteria and sampling context.",
    },
]
NOTICE = (
    "Calculated outcomes apply only to the explicitly selected control relationships and entered criteria. "
    "Original observation QA dispositions remain unchanged. Censored, text and missing values are retained "
    "without numeric substitution. No blank subtraction, sample rejection, annualization or method conversion is applied."
)


def _copy(value):
    return copy.deepcopy(value)


def _text(value, label, *, required=False, limit=10000):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ImplementationError(label + " must be " + ("nonempty " if required else "") + "text.")
    return value


def _number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ImplementationError(label + " must be a finite nonnegative number.")
    return value


def _strings(value, label):
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ImplementationError(label + " must be an array of exact source strings.")
    if len(value) != len(set(value)):
        raise ImplementationError(label + " contains a duplicate.")
    return list(value)


def _ids(value, label, available):
    result = _strings(value, label)
    for key in result:
        if key not in available:
            raise ImplementationError(label + ": original observation is unavailable: " + key)
    return result


def records(plan):
    """Every original observation, with its exact source context and full original object."""
    plan = validate_plan(plan)
    activities = {row["id"]: row for row in plan["activities"]}
    sites = {row["id"]: row for row in plan["sites"]}
    visits = {row["id"]: row for row in plan["visits"]}
    result = []
    for row in plan["observations"]:
        activity = activities[row["activity_id"]]
        site, visit = sites[activity["site_id"]], visits[activity["visit_id"]]
        result.append({
            "observation_id": row["id"], "activity_id": activity["id"],
            "site_id": site["id"], "site_label": site.get("label", site.get("name", site["id"])),
            "visit_id": visit["id"], "sample_id": activity.get("sample_id", ""),
            "collected_at": activity.get("collected_at"), "activity_kind": activity["kind"],
            "custody_ref": activity.get("custody_ref", ""), "activity_method": activity.get("method", ""),
            **{key: row.get(key, "") for key in ("parameter", "unit", "basis", "fraction", "qualifier", "method", "qa_status")},
            "result_type": row["result_type"], "value": row["value"],
            "original_text": row["original_text"], "detection_limit": row.get("detection_limit"),
            "quantitation_limit": row.get("quantitation_limit"),
            "original": _copy(row), "original_activity": _copy(activity),
            "original_site": _copy(site), "original_visit": _copy(visit),
        })
    return result


def selection(plan, supplied):
    if not isinstance(supplied, dict):
        raise ImplementationError("Supply a complete QC selection object.")
    value = _copy(supplied)
    if value.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ImplementationError("Choose an original QC selection.")
    value["schema"] = SELECTION_SCHEMA
    if value.get("plan_id") != plan["id"] or value.get("revision") != plan["revision"]:
        raise ImplementationError("QC selection must identify the exact saved plan and revision.")
    if type(value["revision"]) is not int or value["revision"] < 1:
        raise ImplementationError("Save the plan before preparing its QC review.")
    for field in ("title", "purpose", "reviewer", "as_of"):
        _text(value.get(field), field, required=True)
    # Use the original calendar parser through the current report summary.
    summarize_plan(plan, value["as_of"])
    _text(value.setdefault("notes", ""), "notes")
    groups = value.get("groups")
    if not isinstance(groups, list) or not groups or len(groups) > 10000:
        raise ImplementationError("Select 1 through 10000 explicit control groups.")
    available = {row["id"] for row in plan["observations"]}
    ids = set()
    for group in groups:
        if not isinstance(group, dict):
            raise ImplementationError("Each QC group must be an object.")
        _safe_id(group.get("id"), "QC group id")
        if group["id"] in ids:
            raise ImplementationError("QC group IDs must be unique.")
        ids.add(group["id"])
        kind = group.get("kind")
        if kind not in RELATIONSHIPS or group.get("relationship") not in RELATIONSHIPS[kind]:
            raise ImplementationError("Declare an original duplicate, replicate or blank relationship.")
        _text(group.get("relationship_basis"), "relationship_basis", required=True)
        _text(group.setdefault("notes", ""), "group notes")
        chosen = _ids(group.get("observation_ids"), "observation_ids", available)
        if ((kind == "duplicate" and len(chosen) != 2)
                or (kind == "replicate" and len(chosen) < 3)
                or (kind == "blank" and len(chosen) != 1)):
            raise ImplementationError("Duplicate groups require two results, replicate groups at least three, and blanks one.")
        associated = _ids(group.setdefault("associated_observation_ids", []), "associated_observation_ids", available)
        if kind != "blank" and associated:
            raise ImplementationError("Associated sample results are declared only for blank reviews.")
        if set(chosen) & set(associated):
            raise ImplementationError("A blank cannot be its own associated sample.")
        group["accepted_qualifiers"] = _strings(group.get("accepted_qualifiers", [""]), "accepted_qualifiers")
        group["accepted_qa_statuses"] = _strings(group.get("accepted_qa_statuses", [""]), "accepted_qa_statuses")
        criterion = group.get("criterion")
        if criterion is not None:
            if not isinstance(criterion, dict) or criterion.get("metric") not in METRICS[kind]:
                raise ImplementationError("Choose a criterion supported by this explicit control relationship.")
            _number(criterion.get("maximum"), "criterion maximum")
            _text(criterion.get("source"), "criterion source", required=True)
            _text(criterion.setdefault("applicability", ""), "criterion applicability", required=True)
            multiple = criterion.get("minimum_quantitation_multiple")
            if multiple is not None:
                _number(multiple, "minimum_quantitation_multiple")
    # Reject non-JSON / nonfinite extras while preserving all declared metadata.
    canonical_bytes(value)
    return value


def _definitions(rows):
    return {key: list(dict.fromkeys(row.get(key, "") for row in rows)) for key in DEFINITIONS}


def _finite(value):
    return value if math.isfinite(value) else None


def _evaluate(group, by_id):
    selected = [by_id[key] for key in group["observation_ids"]]
    associated = [by_id[key] for key in group["associated_observation_ids"]]
    definitions = _definitions(selected)
    differences = [key for key, values in definitions.items() if len(values) != 1]
    reasons, warnings = [], []
    if differences:
        reasons.append("incompatible_original_definitions:" + ",".join(differences))
    unspecified = [key for key, values in definitions.items() if values == [""]]
    if unspecified:
        warnings.append("unspecified_original_definitions:" + ",".join(unspecified))
    for row in selected:
        key = row["observation_id"]
        if row["result_type"] != "numeric":
            reasons.append(key + ":original_" + row["result_type"] + "_result")
        if row["qualifier"] not in group["accepted_qualifiers"]:
            reasons.append(key + ":qualifier_not_selected")
        if row["qa_status"] not in group["accepted_qa_statuses"]:
            reasons.append(key + ":qa_status_not_selected")
    associated_conflicts = []
    for row in associated:
        fields = [key for key in DEFINITIONS if definitions.get(key) != [row.get(key, "")]]
        if fields:
            associated_conflicts.append({"observation_id": row["observation_id"], "fields": fields})
    if associated_conflicts:
        warnings.append("associated_sample_definitions_differ")
    metrics = {"absolute_difference": None, "mean": None, "sample_standard_deviation": None,
               "rpd_percent": None, "rsd_percent": None, "blank_value": None}
    # Qualifier admission controls evaluation, while exact numeric diagnostics remain visible.
    numeric = not differences and all(row["result_type"] == "numeric" for row in selected)
    if numeric:
        values = [row["value"] for row in selected]
        scale = max(abs(value) for value in values)
        normalized = [value / scale for value in values] if scale else [0.0] * len(values)
        mean_scaled = math.fsum(normalized) / len(values)
        metrics["mean"] = _finite(mean_scaled * scale)
        if group["kind"] == "blank":
            metrics["blank_value"] = values[0]
        if group["kind"] == "duplicate":
            metrics["absolute_difference"] = _finite(abs(normalized[0] - normalized[1]) * scale)
            if all(value >= 0 for value in values) and mean_scaled > 0:
                metrics["rpd_percent"] = abs(normalized[0] - normalized[1]) / mean_scaled * 100
            else:
                warnings.append("rpd_requires_nonnegative_values_and_positive_mean")
        if group["kind"] == "replicate":
            variance_scaled = math.fsum((value - mean_scaled) ** 2 for value in normalized) / (len(values) - 1)
            sd_scaled = math.sqrt(variance_scaled)
            metrics["sample_standard_deviation"] = _finite(sd_scaled * scale)
            if all(value >= 0 for value in values) and mean_scaled > 0:
                metrics["rsd_percent"] = _finite(sd_scaled / mean_scaled * 100)
            else:
                warnings.append("rsd_requires_nonnegative_values_and_positive_mean")
        if metrics["mean"] is None:
            warnings.append("numeric_range_exceeds_finite_representation")
    criterion = group.get("criterion")
    outcome = "descriptive"
    if criterion:
        multiple = criterion.get("minimum_quantitation_multiple")
        if multiple is not None:
            for row in selected:
                limit = row["quantitation_limit"]
                if not isinstance(limit, (float, int)) or isinstance(limit, bool) or not math.isfinite(limit) or limit <= 0:
                    reasons.append(row["observation_id"] + ":positive_original_quantitation_limit_required")
                elif row["result_type"] == "numeric" and row["value"] / limit < multiple:
                    reasons.append(row["observation_id"] + ":below_selected_quantitation_multiple")
        value = metrics[criterion["metric"]]
        if value is None:
            reasons.append("selected_metric_unavailable")
        if group["kind"] == "blank" and value is not None and value < 0:
            reasons.append("negative_blank_requires_method_review")
        if associated_conflicts:
            reasons.append("associated_sample_definitions_differ")
        outcome = ("not_evaluated" if reasons else
                   "within_entered_criterion" if value <= criterion["maximum"] else "exceeds_entered_criterion")
    elif reasons:
        outcome = "not_evaluated"
    return {
        "id": group["id"], "kind": group["kind"], "relationship": group["relationship"],
        "relationship_basis": group["relationship_basis"], "notes": group["notes"],
        "observation_ids": list(group["observation_ids"]),
        "associated_observation_ids": list(group["associated_observation_ids"]),
        "definitions": definitions, "original_result_count": len(selected),
        "metrics": metrics, "criterion": _copy(criterion),
        "accepted_qualifiers": list(group["accepted_qualifiers"]),
        "accepted_qa_statuses": list(group["accepted_qa_statuses"]),
        "outcome": outcome, "reasons": list(dict.fromkeys(reasons)),
        "warnings": warnings, "associated_definition_conflicts": associated_conflicts,
        "original_qualifiers": {row["observation_id"]: row["qualifier"] for row in selected},
        "original_qa_statuses": {row["observation_id"]: row["qa_status"] for row in selected},
    }


def evaluate(saved_plan, supplied):
    """Pure scientific review; original plan and source QA fields are never changed."""
    plan = validate_plan(saved_plan)
    chosen = selection(plan, supplied)
    original = records(plan)
    by_id = {row["observation_id"]: row for row in original}
    results = [_evaluate(group, by_id) for group in chosen["groups"]]
    selected = {key for group in results for key in group["observation_ids"]}
    associated = {key for group in results for key in group["associated_observation_ids"]}
    counts = {key: sum(row["outcome"] == key for row in results) for key in
              ("descriptive", "within_entered_criterion", "exceeds_entered_criterion", "not_evaluated")}
    identity = {"edition": EDITION, "plan_sha256": document_digest(plan), "selection": chosen}
    return {
        "schema": SCHEMA, "edition": EDITION, "id": hashlib.sha256(canonical_bytes(identity)).hexdigest(),
        "plan_id": plan["id"], "revision": plan["revision"], "plan_sha256": document_digest(plan),
        "title": chosen["title"], "purpose": chosen["purpose"], "reviewer": chosen["reviewer"],
        "as_of": chosen["as_of"], "selection": chosen, "groups": results,
        "records": original, "summary": {
            "groups": len(results), "outcomes": counts, "original_observations": len(original),
            "selected_control_observations": len(selected), "associated_sample_observations": len(associated),
            "other_observations": len(set(by_id) - selected - associated),
        },
        "notice": NOTICE, "method_sources": METHOD_SOURCES,
    }


def _csv(rows, fields):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(fields)
    for row in rows:
        values = []
        for key in fields:
            value = row.get(key)
            if isinstance(value, (dict, list)):
                value = json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            values.append("" if value is None else value)
        writer.writerow(values)
    return out.getvalue()


def result_csv(result):
    rows = [{**group, **group["metrics"]} for group in result["groups"]]
    return _csv(rows, ("id", "kind", "relationship", "observation_ids", "associated_observation_ids",
                      "definitions", "outcome", "absolute_difference", "mean", "sample_standard_deviation",
                      "rpd_percent", "rsd_percent", "blank_value", "criterion", "reasons", "warnings",
                      "relationship_basis", "notes", "accepted_qualifiers", "accepted_qa_statuses"))


def record_csv(result):
    return _csv(result["records"], ("observation_id", "activity_id", "site_id", "site_label", "visit_id",
                "sample_id", "collected_at", "activity_kind", "custody_ref", *DEFINITIONS,
                "result_type", "value", "original_text", "qualifier", "qa_status",
                "detection_limit", "quantitation_limit", "original", "original_activity",
                "original_site", "original_visit"))


def sections(result):
    rows = []
    for group in result["groups"]:
        metric = group["criterion"]["metric"] if group["criterion"] else (
            "rpd_percent" if group["kind"] == "duplicate" else
            "rsd_percent" if group["kind"] == "replicate" else "blank_value")
        criterion = group["criterion"]
        rows.append([
            group["id"], group["relationship"], ", ".join(group["observation_ids"]),
            "; ".join(group["definitions"]["parameter"]), "; ".join(group["definitions"]["unit"]),
            metric, group["metrics"][metric],
            criterion["maximum"] if criterion else "Not entered", group["outcome"],
            "; ".join(group["reasons"] + group["warnings"]),
        ])
    return [
        [result["title"], [
            result["purpose"], "Reviewer: " + result["reviewer"] + ". Exact saved plan " +
            result["plan_id"] + ", revision " + str(result["revision"]) + ".", NOTICE,
            {"kind": "table", "columns": ["Group", "Declared relationship", "Original result IDs",
                "Parameter", "Original unit", "Metric", "Value", "Entered maximum", "Review outcome", "Context"],
             "rows": rows},
        ]],
        ["Original QC criteria and source relationships", [
            {"kind": "table", "columns": ["Group", "Declared relationship basis", "Criterion source",
                "Applicability", "Accepted qualifiers", "Accepted original QA statuses", "Associated sample results"],
             "rows": [[g["id"], g["relationship_basis"],
                 g["criterion"]["source"] if g["criterion"] else "Not entered",
                 g["criterion"]["applicability"] if g["criterion"] else "Not entered",
                 json.dumps(g["accepted_qualifiers"]), json.dumps(g["accepted_qa_statuses"]),
                 ", ".join(g["associated_observation_ids"])] for g in result["groups"]]},
            {"kind": "links", "items": [
                {"title": "Complete QC review and every original result", "path": "qc-review.json"},
                {"title": "Complete review table", "path": "qc-results.csv"},
                {"title": "Every original observation and source relationship", "path": "qc-original-records.csv"},
                {"title": "Exact saved Implementation plan", "path": "plan.json"},
                {"title": "Original revision event", "path": "original-revision.json"},
                {"title": "Retained local source availability", "path": "attachment-inventory.json"},
            ]},
        ]],
    ]


def render_html(result):
    esc = lambda value: html.escape("" if value is None else str(value), quote=True)
    content = []
    for heading, blocks in sections(result):
        content.append("<section><h2>" + esc(heading) + "</h2>")
        for block in blocks:
            if isinstance(block, str):
                content.append("<p>" + esc(block) + "</p>")
            elif block["kind"] == "table":
                content.append("<div class='table'><table><thead><tr>" +
                    "".join("<th>" + esc(c) + "</th>" for c in block["columns"]) + "</tr></thead><tbody>" +
                    "".join("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in row) + "</tr>" for row in block["rows"]) +
                    "</tbody></table></div>")
            else:
                content.append("<ul>" + "".join("<li><a href='" + esc(item["path"]) + "'>" +
                    esc(item["title"]) + "</a></li>" for item in block["items"]) + "</ul>")
        content.append("</section>")
    content.append("<section><h2>Methods and interpretation</h2><p>Duplicate RPD = 100 × |x − y| / ((x + y) / 2). "
        "Replicate RSD = 100 × sample standard deviation / arithmetic mean, using n − 1 for sample variance. "
        "Relative metrics require nonnegative numeric results and positive means. Absolute differences retain the "
        "original unit. Blank criteria apply to the original blank result; associated samples retain their own dispositions. "
        "Entered quantitation requirements are checked against each original quantitation limit.</p><ul>" +
        "".join("<li><a href='" + esc(s["url"]) + "'>" + esc(s["title"]) + "</a>: " + esc(s["use"]) + "</li>" for s in METHOD_SOURCES) +
        "</ul><p>Review identity " + esc(result["id"]) + " · Plan digest " + esc(result["plan_sha256"]) + "</p></section>")
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>" + esc(result["title"]) + "</title><style>"
        "body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#171717;background:#fff}"
        "main{max-width:1300px;margin:auto;padding:28px}h1{font-size:27px}h2{font-size:19px}"
        "section{margin:26px 0;border-top:1px solid #999;padding-top:10px}a{color:inherit;text-decoration:underline}"
        "table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #999;padding:7px;text-align:left;vertical-align:top}"
        "th{background:#eee}.table{overflow:auto}td{overflow-wrap:anywhere}header p{color:#555}"
        "@media print{main{padding:0;max-width:none}.table{overflow:visible}thead{display:table-header-group}"
        "tr{break-inside:avoid}h2{break-after:avoid}a{text-decoration:none}table{font-size:9px}@page{size:landscape;margin:12mm}"
        "</style><main><header><p>IMPLEMENTATION &amp; FIELDWORK · SAMPLE QUALITY CONTROL</p><h1>" +
        esc(result["title"]) + "</h1><p>Review date " + esc(result["as_of"]) + " · " +
        esc(result["summary"]["groups"]) + " declared groups · " + esc(result["summary"]["original_observations"]) +
        " original observations retained</p></header>" + "".join(content) + "</main></html>")


def _write(path, value):
    _atomic_bytes(path, canonical_bytes(value) + b"\n")


def _plan(workspace, plan_id, revision):
    store = ImplementationStore(workspace)
    plan = store.get(plan_id, revision)
    if revision != plan["revision"]:
        raise ImplementationError("Choose an exact saved plan revision.")
    return store, plan


def preview(workspace, supplied):
    store, plan = _plan(workspace, supplied.get("plan_id"), supplied.get("revision"))
    return evaluate(plan, supplied)


def _report_path(store, plan_id, report_id):
    _safe_id(plan_id, "plan_id")
    if not isinstance(report_id, str) or not re.fullmatch(r"[a-f0-9]{64}", report_id):
        raise ImplementationError("Choose an original saved QC report.")
    return store._directory(plan_id) / "reports" / report_id


def inspect(workspace, plan_id, report_id):
    store = ImplementationStore(workspace)
    path = _report_path(store, plan_id, report_id)
    original = report_edition(store, path)
    review = read_json(path / "qc-review.json")
    plan = store.get(plan_id, original["revision"])
    actual = evaluate(plan, read_json(path / "qc-selection.json"))
    if review != actual:
        raise ImplementationError("The QC review differs from its exact original plan and criteria.")
    return {"plan_id": plan_id, "revision": original["revision"], "report_id": original["id"],
            "review_id": review["id"], "directory": path.relative_to(store.root).as_posix(),
            "review": review, "files": [
                describe_file(store.root, path / name) for name in original["members"]]}


def catalog(workspace, plan_id):
    store = ImplementationStore(workspace)
    result = []
    for edition in store.list_reports(plan_id):
        path = Path(edition["directory"])
        if "qc-review.json" not in edition["members"]:
            continue
        review = read_json(path / "qc-review.json")
        if review.get("schema") != SCHEMA:
            continue
        result.append({"report_id": edition["id"], "review_id": review["id"],
                       "revision": edition["revision"], "title": review["title"],
                       "reviewer": review["reviewer"], "as_of": review["as_of"], "summary": review["summary"]})
    return result


def save(workspace, supplied):
    """Append a complete review using the original retained report bank and archive contract."""
    store, plan = _plan(workspace, supplied.get("plan_id"), supplied.get("revision"))
    review = evaluate(plan, supplied)
    for existing in catalog(workspace, plan["id"]):
        if existing["review_id"] == review["id"]:
            return {**inspect(workspace, plan["id"], existing["report_id"]), "reused": True}
    revision_path = store._directory(plan["id"]) / "revisions" / ("%016d.json" % plan["revision"])
    revision = store._read_record(revision_path)
    if document_digest(revision["plan"]) != review["plan_sha256"]:
        raise ImplementationError("The original plan revision changed during QC selection.")
    inventory, available = _attachment_inventory(workspace, plan)
    # Stage outside the original bank; retain_report takes its native plan lock and validates all members.
    temp = Path(tempfile.mkdtemp(prefix=".implementation-qc-", dir=store.root.parent))
    try:
        summary = summarize_plan(plan, review["as_of"])
        for name, value in (
            ("plan.json", plan), ("summary.json", summary), ("qc-review.json", review),
            ("qc-selection.json", review["selection"]), ("original-revision.json", revision)):
            _write(temp / name, value)
        for source, item in available:
            name = "source-" + item["sha256"] + "-" + hashlib.sha256(source.name.encode("utf-8")).hexdigest()[:12]
            suffix = source.suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,16}", source.suffix) else ""
            name += suffix
            retained = temp / name
            if not retained.exists():
                _retain(source, retained, item)
            item["qc_package_path"] = name
        _write(temp / "attachment-inventory.json", inventory)
        _atomic_bytes(temp / "qc-results.csv", result_csv(review).encode("utf-8-sig"))
        _atomic_bytes(temp / "qc-original-records.csv", record_csv(review).encode("utf-8-sig"))
        _atomic_bytes(temp / "report.html", render_html(review).encode("utf-8"))
        companions = [describe_file(temp, path) for path in sorted(temp.iterdir())]
        recipe = {
            "schema": observed_context.SCHEMA, "title": review["title"], "sections": sections(review),
            "inputs": companions, "source_links": [item["path"] for item in companions],
            "implementation_qc": {"review_id": review["id"], "plan_id": plan["id"],
                "revision": plan["revision"], "plan_sha256": review["plan_sha256"]},
        }
        _write(temp / "observed-report.json", recipe)
        entry = {
            "id": "field-qc-" + review["id"][:24], "kind": "document", "role": observed_context.ROLE,
            "title": review["title"], "uri": "urn:upstate:implementation-qc:" + review["id"],
            "vintage": review["as_of"], "units": "original measurement units and explicitly identified relative percentages",
            "metadata": {"report_schema": observed_context.SCHEMA, "implementation_qc": recipe["implementation_qc"]},
            **describe_file(temp, temp / "observed-report.json"), "companions": companions,
        }
        _write(temp / "qc-sources.json", {"schema": "upstate.sources/v1", "title": review["title"], "entries": [entry]})
        filenames = sorted(path.name for path in temp.iterdir())
        manifest = {
            "schema": "upstate.implementation-report/v1", "plan_id": plan["id"], "revision": plan["revision"],
            "as_of": review["as_of"], "document_digest": review["plan_sha256"],
            "implementation_qc_review_id": review["id"],
            "files": [{"name": name, "size_bytes": (temp / name).stat().st_size,
                       "sha256": file_digest(temp / name)} for name in filenames],
        }
        _write(temp / "manifest.json", manifest)
        edition = store.retain_report(temp)
        return {**inspect(workspace, plan["id"], edition["id"]), "reused": False}
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def scientific_source(workspace, plan_id, report_id):
    """Register this exact review in the existing ordered scientific-report chooser."""
    inspected = inspect(workspace, plan_id, report_id)
    directory = Path(workspace.root) / inspected["directory"]
    collection = workspace.import_sources(directory / "qc-sources.json")
    manifest = read_json(directory / "qc-sources.json")
    choice = {"source_collection_id": collection["id"], "source_id": manifest["entries"][0]["id"]}
    selected = {"source_roles": {observed_context.ROLE: choice}, "observed_context_sources": [choice]}
    selected["observed_context_binding"] = observed_context.bind(workspace, selected)
    return {**inspected, "report_source": choice, "delivery_selection": selected}


def _verify_archive(path, files):
    expected = {Path(item["path"]).name: item for item in files}
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) != len(expected) or {item.filename for item in members} != set(expected):
                raise ImplementationError("The retained QC archive has another member inventory.")
            for item in members:
                if item.file_size != expected[item.filename]["bytes"]:
                    raise ImplementationError("A retained QC archive member has another declared length.")
                checksum = hashlib.sha256()
                total = 0
                with archive.open(item) as incoming:
                    for block in iter(lambda: incoming.read(1024 * 1024), b""):
                        checksum.update(block)
                        total += len(block)
                        if total > expected[item.filename]["bytes"]:
                            raise ImplementationError("A retained QC archive member exceeds its declared length.")
                if total != expected[item.filename]["bytes"] or checksum.hexdigest() != expected[item.filename]["sha256"]:
                    raise ImplementationError("A retained QC archive member differs from its saved report.")
    except (zipfile.BadZipFile, OSError) as error:
        raise ImplementationError("The retained QC archive is incomplete or unreadable.") from error


def export(workspace, plan_id, report_id, destination):
    """Complete flat report ZIP; original Workspace backup remains the editable project transfer."""
    inspected = inspect(workspace, plan_id, report_id)
    root = Path(workspace.root)
    path = Path(destination).expanduser().absolute()
    if path.resolve().is_relative_to(root.resolve()):
        raise ImplementationError("Save QC exports outside the original Workspace.")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file():
            raise ImplementationError("The retained QC archive must be an ordinary file.")
        _verify_archive(path, inspected["files"])
        return {"path": str(path), "bytes": path.stat().st_size,
                "sha256": file_digest(path), "report_id": report_id,
                "reused": True}
    descriptor, staged = tempfile.mkstemp(prefix=".qc-export-", dir=path.parent)
    os.close(descriptor)
    staged = Path(staged)
    try:
        with zipfile.ZipFile(staged, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for item in inspected["files"]:
                source = root / item["path"]
                current = describe_file(root, source)
                if current != item:
                    raise ImplementationError("The retained QC export source changed.")
                archive.write(source, source.name)
        _verify_archive(staged, inspected["files"])
        os.link(staged, path)
        return {"path": str(path), "bytes": path.stat().st_size,
                "sha256": file_digest(path), "report_id": report_id}
    finally:
        staged.unlink(missing_ok=True)


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Review declared sample QC in an existing native Implementation plan.")
    parser.add_argument("--workspace", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("records", "list", "inspect", "source", "export"):
        command = sub.add_parser(name)
        command.add_argument("--plan-id", required=True)
        if name == "records":
            command.add_argument("--revision", type=int, required=True)
        if name in ("inspect", "source", "export"):
            command.add_argument("--report-id", required=True)
        if name == "export":
            command.add_argument("--output", required=True)
    for name in ("preview", "save"):
        command = sub.add_parser(name)
        command.add_argument("--selection", required=True)
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.command == "records":
        store, plan = _plan(workspace, args.plan_id, args.revision)
        result = {"plan_id": plan["id"], "revision": plan["revision"],
                  "plan_sha256": document_digest(plan), "records": records(plan)}
    elif args.command == "list":
        result = {"reviews": catalog(workspace, args.plan_id)}
    elif args.command == "preview":
        result = preview(workspace, read_json(Path(args.selection)))
    elif args.command == "save":
        result = save(workspace, read_json(Path(args.selection)))
    elif args.command == "inspect":
        result = inspect(workspace, args.plan_id, args.report_id)
    elif args.command == "source":
        result = scientific_source(workspace, args.plan_id, args.report_id)
    else:
        result = export(workspace, args.plan_id, args.report_id, args.output)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
