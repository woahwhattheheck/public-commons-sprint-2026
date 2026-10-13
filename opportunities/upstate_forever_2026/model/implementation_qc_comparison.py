"""Source-bound comparison of two original retained sample-QC reviews."""
from __future__ import annotations
import copy
import hashlib
import html
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
import zipfile

from . import implementation_qc as qc
from . import observed_context
from .implementation import ImplementationStore, _atomic_bytes
from .implementation_schema import ImplementationError, canonical_bytes, document_digest, summarize_plan, _safe_id
from .portable_implementation import report_edition
from .common import describe_file, read_json, file_digest

SCHEMA = "upstate.implementation-qc-comparison/v1"
SELECTION = "upstate.implementation-qc-comparison-selection/v1"
EDITION = "implementation-qc-comparison-20261013-v1"
NOTICE = (
    "Pairs are explicitly authored by the reviewer. Each original QC group, observation, criterion and "
    "QA disposition remains unchanged. Deltas are after minus before; relative precision deltas are "
    "percentage points, not percent improvement. A numerical delta is descriptive and does not establish "
    "causation, sample acceptance or corrective-action closure. Different or unspecified method definitions, "
    "criteria, qualifier admission or applicability withhold the delta."
)

def _copy(value):
    return copy.deepcopy(value)

def _metric(group):
    return (group["criterion"]["metric"] if group["criterion"] else
            {"duplicate": "rpd_percent", "replicate": "rsd_percent", "blank": "blank_value"}[group["kind"]])

def _finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)

def normalize(before, after, supplied):
    if not isinstance(supplied, dict):
        raise ImplementationError("Supply a complete saved-QC comparison selection.")
    value = _copy(supplied)
    if value.get("schema", SELECTION) != SELECTION:
        raise ImplementationError("Choose an original QC comparison selection.")
    value["schema"] = SELECTION
    if value.get("plan_id") != before["plan_id"] or value["plan_id"] != after["plan_id"]:
        raise ImplementationError("Compare reviews of the same original saved field plan.")
    for field, source in (("before_report_id", before), ("after_report_id", after)):
        if value.get(field) != source["report_id"]:
            raise ImplementationError("The comparison selection differs from its original report IDs.")
    if before["report_id"] == after["report_id"]:
        raise ImplementationError("Choose two distinct retained reviews.")
    for field in ("title", "purpose", "reviewer", "as_of"):
        qc._text(value.get(field), field, required=True)
    qc._text(value.setdefault("notes", ""), "comparison notes")
    pairs = value.get("pairs")
    if not isinstance(pairs, list) or not 1 <= len(pairs) <= 10000:
        raise ImplementationError("Author at least one and at most 10000 explicit group pairs.")
    available = {
        "before_group_id": {g["id"] for g in before["review"]["groups"]},
        "after_group_id": {g["id"] for g in after["review"]["groups"]},
    }
    seen = {"id": set(), "before_group_id": set(), "after_group_id": set()}
    for pair in pairs:
        if not isinstance(pair, dict):
            raise ImplementationError("Each comparison pair must be an object.")
        _safe_id(pair.get("id"), "comparison pair id")
        qc._text(pair.get("basis"), "pair relationship / source basis", required=True)
        qc._text(pair.setdefault("notes", ""), "pair notes")
        for field in seen:
            key = pair.get(field)
            if not isinstance(key, str) or key in seen[field]:
                raise ImplementationError("Each group may appear only once on its selected side.")
            if field in available and key not in available[field]:
                raise ImplementationError("A selected group is absent from its exact original QC review.")
            seen[field].add(key)
    canonical_bytes(value)
    return value

def evaluate(before, after, supplied):
    chosen = normalize(before, after, supplied)
    left = {g["id"]: g for g in before["review"]["groups"]}
    right = {g["id"]: g for g in after["review"]["groups"]}
    rows = []
    for pair in chosen["pairs"]:
        a, b = left[pair["before_group_id"]], right[pair["after_group_id"]]
        reasons = []
        for field in ("kind", "relationship", "definitions", "criterion"):
            if a[field] != b[field]:
                reasons.append("different_" + field)
        for field in ("accepted_qualifiers", "accepted_qa_statuses"):
            if set(a[field]) != set(b[field]):
                reasons.append("different_" + field)
        for side, group in (("before", a), ("after", b)):
            if any(len(group["definitions"].get(key, [])) != 1 or not str(group["definitions"][key][0]).strip()
                   for key in qc.DEFINITIONS):
                reasons.append(side + ":unspecified_or_incompatible_original_definitions")
            if group["reasons"] or group["outcome"] == "not_evaluated":
                reasons.append(side + ":original_review_not_evaluable")
            if group.get("associated_definition_conflicts"):
                reasons.append(side + ":associated_sample_definitions_differ")
        am, bm = _metric(a), _metric(b)
        av, bv = a["metrics"].get(am), b["metrics"].get(bm)
        if am != bm:
            reasons.append("different_selected_metric")
        if not _finite(av) or not _finite(bv):
            reasons.append("original_metric_unavailable")
        delta = None
        if not reasons:
            delta = bv - av
            if not _finite(delta):
                delta = None
                reasons.append("delta_exceeds_finite_representation")
        unit = ("percentage points" if am in ("rpd_percent", "rsd_percent")
                else (a["definitions"]["unit"][0] if len(a["definitions"]["unit"]) == 1 else ""))
        rows.append({
            "id": pair["id"], "basis": pair["basis"], "notes": pair["notes"],
            "before_group_id": a["id"], "after_group_id": b["id"],
            "before_metric": am, "after_metric": bm, "before_value": av, "after_value": bv,
            "after_minus_before": delta, "delta_unit": unit,
            "comparison": "comparable" if not reasons else "withheld",
            "reasons": list(dict.fromkeys(reasons)),
            "before": _copy(a), "after": _copy(b),
        })
    original = {
        "before": {key: before[key] for key in ("plan_id", "revision", "report_id", "review_id")},
        "after": {key: after[key] for key in ("plan_id", "revision", "report_id", "review_id")},
    }
    identity = {"edition": EDITION, "selection": chosen, "original": original,
                "before_sha256": document_digest(before["review"]),
                "after_sha256": document_digest(after["review"])}
    return {
        "schema": SCHEMA, "edition": EDITION, "id": hashlib.sha256(canonical_bytes(identity)).hexdigest(),
        "plan_id": chosen["plan_id"], "revision": after["revision"], "original": original,
        "title": chosen["title"], "purpose": chosen["purpose"], "reviewer": chosen["reviewer"],
        "as_of": chosen["as_of"], "selection": chosen, "pairs": rows,
        "unpaired_before": [g["id"] for g in before["review"]["groups"] if g["id"] not in {p["before_group_id"] for p in rows}],
        "unpaired_after": [g["id"] for g in after["review"]["groups"] if g["id"] not in {p["after_group_id"] for p in rows}],
        "summary": {"pairs": len(rows), "comparable": sum(r["comparison"] == "comparable" for r in rows),
                    "withheld": sum(r["comparison"] == "withheld" for r in rows)},
        "notice": NOTICE, "method_sources": _copy(qc.METHOD_SOURCES),
    }

def preview(workspace, supplied):
    if not isinstance(supplied, dict):
        raise ImplementationError("Supply a complete comparison selection.")
    plan_id = supplied.get("plan_id")
    before = qc.inspect(workspace, plan_id, supplied.get("before_report_id"))
    after = qc.inspect(workspace, plan_id, supplied.get("after_report_id"))
    summarize_plan(ImplementationStore(workspace).get(plan_id, after["revision"]), supplied.get("as_of"))
    return evaluate(before, after, supplied)

def comparison_csv(value):
    fields = ["id", "before_group_id", "after_group_id", "before_metric", "after_metric",
              "before_value", "after_value", "after_minus_before", "delta_unit", "comparison",
              "reasons", "basis", "notes"]
    return qc._csv([{**r, "reasons": "; ".join(r["reasons"])} for r in value["pairs"]], fields)

def sections(value):
    rows = [[r["id"], r["before_group_id"], r["after_group_id"], r["before_metric"],
             r["after_metric"], r["before_value"], r["after_value"], r["after_minus_before"],
             r["delta_unit"], r["comparison"], "; ".join(r["reasons"])] for r in value["pairs"]]
    return [
        [value["title"], [value["purpose"], NOTICE,
            "Reviewer: " + value["reviewer"] + ". Before revision " + str(value["original"]["before"]["revision"]) +
            "; after revision " + str(value["original"]["after"]["revision"]) + ".",
            {"kind": "table", "columns": ["Pair", "Before group", "After group", "Before metric",
             "After metric", "Before", "After", "After minus before", "Delta unit", "Comparison", "Why withheld"],
             "rows": rows}]],
        ["Original criteria and explicit source relationships", [
            {"kind": "table", "columns": ["Pair", "Authored relationship basis", "Before outcome", "After outcome",
             "Before criterion", "After criterion", "Before definitions", "After definitions", "Pair notes"],
             "rows": [[r["id"], r["basis"], r["before"]["outcome"], r["after"]["outcome"],
                json.dumps(r["before"]["criterion"], ensure_ascii=False), json.dumps(r["after"]["criterion"], ensure_ascii=False),
                json.dumps(r["before"]["definitions"], ensure_ascii=False), json.dumps(r["after"]["definitions"], ensure_ascii=False),
                r["notes"]] for r in value["pairs"]]},
            "Unpaired before groups: " + ", ".join(value["unpaired_before"]),
            "Unpaired after groups: " + ", ".join(value["unpaired_after"]),
            {"kind": "links", "items": [
             {"title": "Complete comparison", "path": "qc-comparison.json"},
             {"title": "Complete comparison table", "path": "qc-comparison.csv"},
             {"title": "Original before review and every observation", "path": "before-qc-review.json"},
             {"title": "Original after review and every observation", "path": "after-qc-review.json"},
             {"title": "Complete original before review: extract and open report.html", "path": "before-review.zip"},
             {"title": "Complete original after review: extract and open report.html", "path": "after-review.zip"},
             {"title": "Full original source inventories", "path": "comparison-inputs.json"}]}]],
    ]

def render_html(value):
    esc = lambda item: html.escape("" if item is None else str(item))
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        "<title>" + esc(value["title"]) + "</title><style>body{max-width:1400px;margin:24px auto;padding:0 18px;color:#171717;background:#fff;font:15px/1.5 system-ui,sans-serif}h1{font-size:26px}h2{font-size:20px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #999;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}.scroll{overflow:auto}th{background:#eee}button,a{color:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{button{display:none}.scroll{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}body{margin:0;padding:0}}</style><body>",
        "<h1>" + esc(value["title"]) + "</h1><button onclick=\"window.print()\">Print complete comparison</button>"]
    for heading, blocks in sections(value):
        parts.append("<h2>" + esc(heading) + "</h2>")
        for block in blocks:
            if isinstance(block, str):
                parts.append("<p>" + esc(block) + "</p>")
            elif block["kind"] == "table":
                parts.append('<div class="scroll"><table><thead><tr>' + "".join("<th>" + esc(c) + "</th>" for c in block["columns"]) + "</tr></thead><tbody>")
                for row in block["rows"]:
                    parts.append("<tr>" + "".join("<td>" + esc(c) + "</td>" for c in row) + "</tr>")
                parts.append("</tbody></table></div>")
            elif block["kind"] == "links":
                parts.append("<ul>" + "".join('<li><a href="' + esc(r["path"]) + '">' + esc(r["title"]) + "</a></li>" for r in block["items"]) + "</ul>")
    parts.append("<details><summary>Complete retained comparison selection and source identities</summary><pre>" +
                 esc(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)) + "</pre></details></body></html>")
    return "".join(parts)

def _saved_inputs(store, directory):
    meta = read_json(directory / "comparison-inputs.json")
    result = []
    for side in ("before", "after"):
        source = meta[side]
        for item in source["files"]:
            retained = directory / (side + "-" + Path(item["path"]).name)
            actual = describe_file(store.root, retained)
            if actual["bytes"] != item["bytes"] or actual["sha256"] != item["sha256"]:
                raise ImplementationError("A complete original QC source differs from its retained comparison.")
        qc._verify_archive(directory / (side + "-review.zip"), source["files"])
        review = read_json(directory / (side + "-qc-review.json"))
        plan = read_json(directory / (side + "-plan.json"))
        if qc.evaluate(plan, review["selection"]) != review:
            raise ImplementationError("An original comparison review differs from its exact saved plan and criteria.")
        if source["review_id"] != review["id"] or source["plan_id"] != review["plan_id"] or source["revision"] != review["revision"]:
            raise ImplementationError("The original comparison source identity changed.")
        result.append({**source, "review": review})
    return result

def inspect(workspace, plan_id, comparison_report_id):
    store = ImplementationStore(workspace)
    path = qc._report_path(store, plan_id, comparison_report_id)
    edition = report_edition(store, path)
    value = read_json(path / "qc-comparison.json")
    if value.get("schema") != SCHEMA:
        raise ImplementationError("Choose an original saved QC comparison.")
    before, after = _saved_inputs(store, path)
    if evaluate(before, after, value["selection"]) != value:
        raise ImplementationError("The comparison differs from its exact retained reviews and explicit pairs.")
    if value["plan_id"] != plan_id or edition["revision"] != after["revision"]:
        raise ImplementationError("The comparison belongs to another original plan revision.")
    return {"plan_id": plan_id, "revision": after["revision"], "comparison_report_id": edition["id"],
            "comparison_id": value["id"], "comparison": value, "directory": path.relative_to(store.root).as_posix(),
            "files": [describe_file(store.root, path / name) for name in edition["members"]]}

def catalog(workspace, plan_id):
    store = ImplementationStore(workspace)
    rows = []
    for edition in store.list_reports(plan_id):
        if "qc-comparison.json" not in edition["members"]:
            continue
        value = read_json(Path(edition["directory"]) / "qc-comparison.json")
        if value.get("schema") == SCHEMA:
            rows.append({"comparison_report_id": edition["id"], "comparison_id": value["id"],
                         "revision": edition["revision"], "title": value["title"], "reviewer": value["reviewer"],
                         "as_of": value["as_of"], "original": value["original"], "summary": value["summary"]})
    return rows

def save(workspace, supplied):
    value = preview(workspace, supplied)
    store = ImplementationStore(workspace)
    for row in catalog(workspace, value["plan_id"]):
        if row["comparison_id"] == value["id"]:
            return {**inspect(workspace, value["plan_id"], row["comparison_report_id"]), "reused": True}
    sources = {side: qc.inspect(workspace, value["plan_id"], value["original"][side]["report_id"])
               for side in ("before", "after")}
    plan = store.get(value["plan_id"], value["revision"])
    temp = Path(tempfile.mkdtemp(prefix=".implementation-qc-comparison-", dir=store.root.parent))
    try:
        metadata = {}
        for side, source in sources.items():
            metadata[side] = {key: source[key] for key in ("plan_id", "revision", "report_id", "review_id", "files")}
            for item in source["files"]:
                original = store.root / item["path"]
                target = temp / (side + "-" + original.name)
                qc._retain(original, target, item)
            with zipfile.ZipFile(temp / (side + "-review.zip"), "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for item in source["files"]:
                    name = Path(item["path"]).name
                    archive.write(temp / (side + "-" + name), name)
            qc._verify_archive(temp / (side + "-review.zip"), source["files"])
        for name, data in (("plan.json", plan), ("summary.json", summarize_plan(plan, value["as_of"])),
                           ("qc-comparison.json", value), ("comparison-inputs.json", metadata),
                           ("qc-comparison-selection.json", value["selection"])):
            qc._write(temp / name, data)
        _atomic_bytes(temp / "qc-comparison.csv", comparison_csv(value).encode("utf-8-sig"))
        _atomic_bytes(temp / "report.html", render_html(value).encode("utf-8"))
        # Verify the full copied native inputs before entering the original immutable report bank.
        before, after = _saved_inputs(type("SnapshotRoot", (), {"root": temp})(), temp)
        if evaluate(before, after, value["selection"]) != value:
            raise ImplementationError("The original QC sources changed during comparison receiving.")
        companions = [describe_file(temp, p) for p in sorted(temp.iterdir())]
        recipe = {"schema": observed_context.SCHEMA, "title": value["title"], "sections": sections(value),
                  "inputs": companions, "source_links": [p["path"] for p in companions],
                  "implementation_qc_comparison": {"id": value["id"], "original": value["original"]}}
        qc._write(temp / "observed-report.json", recipe)
        entry = {"id": "field-qc-comparison-" + value["id"][:24], "kind": "document",
                 "role": observed_context.ROLE, "title": value["title"],
                 "uri": "urn:upstate:implementation-qc-comparison:" + value["id"], "vintage": value["as_of"],
                 "units": "original units; percentage-point precision differences",
                 "metadata": {"report_schema": observed_context.SCHEMA, "implementation_qc_comparison": recipe["implementation_qc_comparison"]},
                 **describe_file(temp, temp / "observed-report.json"), "companions": companions}
        qc._write(temp / "qc-comparison-sources.json", {"schema": "upstate.sources/v1", "title": value["title"], "entries": [entry]})
        names = sorted(p.name for p in temp.iterdir())
        qc._write(temp / "manifest.json", {
            "schema": "upstate.implementation-report/v1", "plan_id": plan["id"], "revision": plan["revision"],
            "as_of": value["as_of"], "document_digest": document_digest(plan), "implementation_qc_comparison_id": value["id"],
            "files": [{"name": n, "size_bytes": (temp / n).stat().st_size, "sha256": file_digest(temp / n)} for n in names]})
        edition = store.retain_report(temp)
        return {**inspect(workspace, plan["id"], edition["id"]), "reused": False}
    finally:
        shutil.rmtree(temp, ignore_errors=True)

def scientific_source(workspace, plan_id, comparison_report_id):
    current = inspect(workspace, plan_id, comparison_report_id)
    directory = Path(workspace.root) / current["directory"]
    collection = workspace.import_sources(directory / "qc-comparison-sources.json")
    manifest = read_json(directory / "qc-comparison-sources.json")
    choice = {"source_collection_id": collection["id"], "source_id": manifest["entries"][0]["id"]}
    selection = {"source_roles": {observed_context.ROLE: choice}, "observed_context_sources": [choice]}
    selection["observed_context_binding"] = observed_context.bind(workspace, selection)
    return {**current, "report_source": choice, "delivery_selection": selection}

def export(workspace, plan_id, comparison_report_id, destination):
    current = inspect(workspace, plan_id, comparison_report_id)
    root = Path(workspace.root)
    path = Path(destination).expanduser().absolute()
    if path.resolve().is_relative_to(root.resolve()):
        raise ImplementationError("Save comparison exports outside the original Workspace.")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file():
            raise ImplementationError("The comparison archive must be an ordinary file.")
        qc._verify_archive(path, current["files"])
        return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path),
                "comparison_report_id": comparison_report_id, "reused": True}
    fd, pending = tempfile.mkstemp(prefix=".qc-comparison-export-", dir=path.parent)
    os.close(fd)
    pending = Path(pending)
    try:
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for item in current["files"]:
                source = root / item["path"]
                if describe_file(root, source) != item:
                    raise ImplementationError("The retained comparison source changed.")
                archive.write(source, source.name)
        qc._verify_archive(pending, current["files"])
        try:
            os.link(pending, path)
        except FileExistsError:
            qc._verify_archive(path, current["files"])
        return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path),
                "comparison_report_id": comparison_report_id}
    finally:
        pending.unlink(missing_ok=True)
