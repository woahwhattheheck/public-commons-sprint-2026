"""Direct saved Calibration studies in the existing editable Study archive.

This reader captures original records and already-produced files. It neither
evaluates candidates nor renders missing exports. Older dependency-only Study
receipts retain their original captured dependency set.
"""
from __future__ import annotations

import copy
from pathlib import PurePosixPath

from .common import digest, identifier, read_json
from . import calibration_study_transfer as dependencies
from .portable_fs import validate_members

ROOT_KINDS = dependencies.IMMUTABLE_KINDS
EXPORT_BASES = {
    "calibration": ("calibration-exports", ".export.lock"),
    "uncertainty": ("calibration-uncertainty-exports", ".export.lock"),
    "history": ("calibration-history-exports", ".history.lock"),
}


def _same(actual, expected, label):
    if actual != expected:
        raise ValueError(label + " differs from the retained Calibration study")


def _present(path):
    return path.exists() or path.is_symlink()


def _member(closure, name, label=None, expected=None):
    name = dependencies._name(name)
    closure.add_file(name, expected)
    item = closure.files[name]
    if expected is not None:
        _same(item["bytes"], expected["bytes"], "Original Calibration member size")
    if not item.get("sha256"):
        # Immutable records and reading files need their actual byte identity.
        closure.read(name) if name.endswith(".json") else _hash_member(closure, name)
        item = closure.files[name]
    return {"path": name, "bytes": item["bytes"], "sha256": item["sha256"],
            "filename": (expected or {}).get("filename") or PurePosixPath(name).name,
            "label": label or PurePosixPath(name).name}


def _hash_member(closure, name):
    from .common import file_digest
    value = file_digest(closure.root / name)
    closure.files[name]["sha256"] = value
    closure.assert_unchanged()


def _raw(closure, kind, key):
    return dependencies.record(closure, kind, identifier(key), "Direct original Calibration study")


def _context(closure, kind, key, captured_report_id=False):
    original = _raw(closure, kind, key)
    if kind == "calibration-plans":
        plan = original
        report_id = captured_report_id
        if captured_report_id is False:
            path = "calibration-analysis/" + key + "/progress.json"
            progress = closure.read(path) if _present(closure.root / path) else {}
            report_id = progress.get("result_id")
        report = _raw(closure, "calibrations", report_id) if report_id else None
    else:
        report_id = key if kind == "calibrations" else original["calibration_id"]
        report = _raw(closure, "calibrations", report_id)
        plan = _raw(closure, "calibration-plans", report["plan_id"])
    if report is not None:
        _same(report["plan_id"], plan["id"], "Direct Calibration plan")
    return original, plan, report


def _ancestry(closure, plan, report):
    """Read original prior-evaluation links without recomputing any evaluation."""
    plans, reports, seen = {}, {}, set()
    while True:
        key = plan["id"]
        if key in seen:
            raise ValueError("The retained Calibration evaluation history is cyclic")
        seen.add(key)
        plans[key] = plan
        if report is not None:
            reports[report["id"]] = report
        binding = plan["selection"].get("prior_evaluation")
        if binding is None:
            break
        from .calibration_followup import resolve
        report, plan, spec = resolve(closure.workspace, binding)
        report = _raw(closure, "calibrations", report["id"])
        plan = _raw(closure, "calibration-plans", plan["id"])
        closure.need("parameter-studies", spec["id"], "Original selected-profile follow-up study")
    return plans, reports


def _sources(closure, plans):
    members = {}

    def retain(item):
        # Equal CAS bytes can retain distinct original source filenames/sidecar paths.
        members[(item["path"], item["filename"], item["label"])] = item
    for key, plan in sorted(plans.items()):
        names = [("calibration-plans/" + key + ".json", "Original calibration design")]
        observed = _raw(closure, "observations", plan["selection"]["observation_id"])
        names.append(("observations/" + observed["id"] + ".json", "Original observation edition"))
        for name, label in names:
            retain(_member(closure, name, label))
        body = observed["original"]
        name = body.get("object", body.get("path"))
        retain(_member(closure, name, "Original observation table", body))
        choice = plan["selection"]["catchments"]
        collection = _raw(closure, "sources", choice["source_collection_id"])
        names = [entry for entry in collection["entries"] if entry["id"] == choice["source_id"]]
        if len(names) != 1:
            raise ValueError("The original catchment source is missing or ambiguous")
        entry = names[0]
        source_path = "sources/" + collection["id"] + ".json"
        retain(_member(closure, source_path, "Original catchment source collection"))
        for item in [collection["original_manifest"], entry["body"], *entry.get("companions", [])]:
            path = item.get("object", item.get("path"))
            retain(_member(closure, path, item.get("view_path", item.get("filename", "Original catchment source")), item))
    return list(members.values())


def _export(closure, export_type, key, report, plan, *, expected=None):
    base, unused_lock = EXPORT_BASES[export_type]
    prefix = base + "/" + identifier(key)
    manifest_path, archive_path = prefix + "/manifest.json", prefix + "/archive.json"
    if expected is None and not (_present(closure.root / manifest_path) and
                                 _present(closure.root / archive_path)):
        return None
    manifest = closure.read(manifest_path)
    _same(manifest.get("schema"), "upstate.calibration-" +
          ("" if export_type == "calibration" else export_type + "-") + "export/v1",
          "Calibration export schema")
    _same(manifest.get("workspace_id"), closure.workspace.project["id"], "Calibration export project")
    _same(manifest.get("report_id"), report["id"], "Calibration export result")
    if export_type != "history":
        _same(manifest.get("plan_id"), plan["id"], "Calibration export design")
    if export_type == "uncertainty":
        _same(manifest.get("uncertainty_id"), key, "Calibration sensitivity identity")
    if export_type == "history":
        _same(manifest.get("history_id"), key, "Calibration history identity")
    inventory = manifest.get("files")
    if not isinstance(inventory, dict) or not inventory:
        raise ValueError("The original Calibration export inventory is empty")
    members = []
    for name, item in sorted(inventory.items()):
        _same(dependencies._name(name), item.get("path"), "Calibration export member path")
        members.append(_member(closure, prefix + "/" + name, name, item))
    archive = closure.read(archive_path)
    # Reject file aliases before independent Windows/macOS Study receiving.
    # Preserve every original filename and the archived record bytes.
    validate_members([*inventory, "manifest.json", "archive.json",
                      dependencies._name(archive["path"])], portable=True)
    members.extend([_member(closure, manifest_path, "Original export inventory"),
                    _member(closure, archive_path, "Original archive descriptor"),
                    _member(closure, prefix + "/" + dependencies._name(archive["path"]),
                            "Complete original " + export_type + " ZIP", archive)])
    # Frozen original records in the reading package must be the selected records.
    checks = ([("report.json", "calibrations", report["id"]),
               ("selection.json", "calibration-plans", plan["id"])]
              if export_type == "calibration" else
              [("uncertainty.json", "calibration-uncertainties", key),
               ("calibration.json", "calibrations", report["id"]),
               ("selection.json", "calibration-plans", plan["id"])]
              if export_type == "uncertainty" else [])
    for name, kind, record_id in checks:
        if name not in inventory:
            raise ValueError("The Calibration export omitted its original " + name)
        _same(closure.read(prefix + "/" + name),
              closure.read(kind + "/" + record_id + ".json"), "Exported original Calibration record")
    if export_type == "history":
        if "history.json" not in inventory:
            raise ValueError("The Calibration history export omitted its original comparison")
        value = closure.read(prefix + "/history.json")
        _same(value.get("id"), key, "Saved history result identity")
        _same(digest({k: v for k, v in value.items() if k != "id"}), key, "Saved history result content")
        _same(value.get("workspace_id"), closure.workspace.project["id"], "Saved history project")
        _same(value.get("current_calibration_id"), report["id"], "Saved history result")
        _same(value.get("current_plan_id"), plan["id"], "Saved history design")
        for row in value["evaluations"]:
            for name, kind, record_id in (("report.json", "calibrations", row["calibration_id"]),
                                         ("plan.json", "calibration-plans", row["plan_id"])):
                relative = "original/" + identifier(row["calibration_id"]) + "/" + name
                if relative not in inventory:
                    raise ValueError("The saved history omitted an original evaluation")
                _raw(closure, kind, record_id)
                _same(closure.read(prefix + "/" + relative),
                      closure.read(kind + "/" + record_id + ".json"), "Saved history original evaluation")
    result = {"type": export_type, "id": key, "report_id": report["id"],
              "plan_id": plan["id"], "prefix": prefix, "members": members}
    if expected is not None:
        _same(result, expected, "Captured Calibration reading package")
    return result


def _exports(closure, plans, reports, supplements):
    result = []
    for key, report in sorted(reports.items()):
        plan = plans[report["plan_id"]]
        item = _export(closure, "calibration", key, report, plan)
        if item:
            result.append(item)
    for item in supplements:
        if item["kind"] != "calibration-uncertainties":
            continue
        value = _raw(closure, item["kind"], item["id"])
        report = reports.get(value["calibration_id"])
        if report:
            export = _export(closure, "uncertainty", item["id"], report, plans[report["plan_id"]])
            if export:
                result.append(export)
    # A history edition is already content-addressed by its saved native view.
    # Read only existing completed manifests; never render or generate it here.
    for path in sorted((closure.root / "calibration-history-exports").glob("*/manifest.json")):
        raw = read_json(path)
        report = reports.get(raw.get("report_id"))
        if report is None:
            continue
        key = identifier(path.parent.name)
        item = _export(closure, "history", key, report, plans[report["plan_id"]])
        if item:
            result.append(item)
    return result


def _supplements(closure, plans):
    rows = []
    for kind, key in sorted(closure.nodes):
        if kind not in ROOT_KINDS or kind in ("calibration-plans", "calibrations"):
            continue
        value = _raw(closure, kind, key)
        if value.get("plan_id") in plans:
            rows.append({"kind": kind, "id": key, "title": value.get("title") or dependencies.LABELS[kind],
                         "state": value.get("state", "retained")})
    return rows


def _binding(closure, kind, key, captured=None):
    report_id = captured.get("report_id") if captured is not None else False
    original, plan, report = _context(closure, kind, key, report_id)
    # A prepared plan captured before evaluation stays a prepared captured edition.
    if captured is not None and captured.get("report_id") is None and kind == "calibration-plans":
        report = None
    plans, reports = _ancestry(closure, plan, report)
    if captured is None:
        supplements = _supplements(closure, plans)
        exports = _exports(closure, plans, reports, supplements)
    else:
        supplements = copy.deepcopy(captured["supplements"])
        for item in supplements:
            value = _raw(closure, item["kind"], item["id"])
            if value.get("plan_id") not in plans:
                raise ValueError("A captured Calibration supplement belongs to another design")
        exports = []
        for item in captured["exports"]:
            result = reports.get(item["report_id"])
            if result is None:
                raise ValueError("A captured export belongs to another original Calibration result")
            exports.append(_export(closure, item["type"], item["id"], result,
                                   plans[result["plan_id"]], expected=item))
    records = []
    for record_kind, values in (("calibration-plans", plans), ("calibrations", reports)):
        for record_id in sorted(values):
            path = record_kind + "/" + record_id + ".json"
            records.append({"kind": record_kind, "id": record_id,
                            "sha256": _member(closure, path)["sha256"]})
    for item in supplements:
        path = item["kind"] + "/" + item["id"] + ".json"
        records.append({"kind": item["kind"], "id": item["id"], "sha256": _member(closure, path)["sha256"]})
    current_state = report.get("state") if report else "prepared"
    if report is None and kind == "calibration-plans" and captured is None:
        path = "calibration-analysis/" + key + "/progress.json"
        if _present(closure.root / path):
            current_state = closure.read(path).get("state", "prepared")
    result = {
        "schema": "upstate.native-calibration-study/v1", "version": 1,
        "kind": kind, "id": key, "source_project_id": closure.workspace.project["id"],
        "record_sha256": _member(closure, kind + "/" + key + ".json")["sha256"],
        "plan_id": plan["id"], "report_id": report["id"] if report else None,
        "captured_state": (captured["captured_state"] if captured is not None else
                           current_state),
        "records": records, "source_members": _sources(closure, plans),
        "exports": exports, "supplements": supplements,
    }
    if captured is not None:
        _same(result, captured, "Captured original Calibration study")
    return result


def prepare(closure):
    """Admit captured immutable roots before generic dependency resolution."""
    captured = closure.calibration_native_selection
    if captured is None:
        return
    selected = {(row["kind"], row["id"]) for row in closure.selection["roots"] if row["kind"] in ROOT_KINDS}
    seen = set()
    for row in captured:
        token = (row.get("kind"), row.get("id"))
        if token not in selected or token in seen or row.get("schema") != "upstate.native-calibration-study/v1":
            raise ValueError("The captured Calibration root roster differs from the selected Study")
        seen.add(token)
        for item in row["records"]:
            if item["kind"] not in ROOT_KINDS:
                raise ValueError("A captured Calibration record has an unsupported kind")
            closure.need(item["kind"], identifier(item["id"]), "Captured original Calibration record")
    # Empty selection is the compatibility boundary for older dependency-only receipts.
    if seen != selected:
        raise ValueError("A direct Calibration Study is missing its original root receipt")


def capture(closure):
    captured = closure.calibration_native_selection
    if captured == []:
        closure.calibration_native_records = []
        return
    roots = [(row["kind"], row["id"]) for row in closure.selection["roots"] if row["kind"] in ROOT_KINDS]
    expected = {(row["kind"], row["id"]): row for row in captured or []}
    closure.calibration_native_records = [
        _binding(closure, kind, key, expected.get((kind, key))) for kind, key in sorted(roots)]


def receipt(closure):
    return copy.deepcopy(closure.calibration_native_records)


def verify_receipt(closure, rows):
    _same(receipt(closure), rows, "Native Calibration Study receipt")
    return len(rows)


def lock_paths(closure):
    return sorted({item["prefix"] + "/" + EXPORT_BASES[item["type"]][1]
                   for row in closure.calibration_native_records for item in row["exports"]})


def catalogue(workspace, kind):
    if kind not in ROOT_KINDS:
        raise ValueError("Choose an original saved Calibration record")
    rows = []
    for path in sorted((workspace.root / kind).glob("*.json")):
        key = path.stem
        try:
            identifier(key)
            raw = read_json(path)
            if (raw.get("schema") != "upstate." + kind + "/v1" or raw.get("version") != 1
                    or raw.get("workspace_id") != workspace.project["id"] or digest(raw) != key):
                raise ValueError("The saved Calibration record differs from its original identity")
            selection = raw.get("selection", {})
            row = {"kind": kind, "id": key,
                   "title": raw.get("title") or selection.get("title") or dependencies.LABELS[kind],
                   "state": raw.get("state", "prepared" if kind == "calibration-plans" else "retained"),
                   "updated_at": "", "selection": {
                       "plan_id": key if kind == "calibration-plans" else raw.get("plan_id"),
                       "calibration_id": key if kind == "calibrations" else raw.get("calibration_id"),
                       "observation_id": selection.get("observation_id"),
                       "selected_run_id": raw.get("selected_run_id"),
                       "candidate_count": raw.get("candidate_count", len(raw.get("candidates", []))),
                   }}
            if kind == "calibration-plans":
                from .calibration import inspect
                current = inspect(workspace, key)
                row["state"] = current["state"]
                row["selection"]["result_id"] = current.get("result_id")
            rows.append(row)
        except Exception as error:
            rows.append({"kind": kind, "id": key, "title": key[:12], "state": "unreadable",
                         "updated_at": "", "selection": {}, "error": str(error)})
    return rows
