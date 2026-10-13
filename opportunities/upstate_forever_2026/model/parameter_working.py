"""Named, immutable unfinished Parameter designs in the native Workspace.

Raw controls are recoverable working material. Only parameter_studies.preview /
prepare may accept a scientific selection; this module never creates a run.
"""
from __future__ import annotations

from copy import deepcopy
import json
import math
import re

from .common import atomic_json, canonical, describe_file, digest, held, identifier, now

KIND = "parameter-working"
SCHEMA = "upstate.parameter-working-draft/v1"
PACKAGE = "upstate.parameter-working-history/v1"
RECOVERY = "upstate.parameter-working-recovery/v1"
FIELDS = ("experiment_title", "experiment_purpose", "experiment_design", "baseline_run_id")
AXIS_FIELDS = ("axis_name", "axis_values", "axis_reason", "axis_references")
AREA_FIELDS = ("area_name", "area_collection", "area_source", "area_layer", "area_where")


def _object(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(label + " must preserve every supported original field")
    return value


def _text(value, label, nonempty=False):
    if not isinstance(value, str) or (nonempty and not value.strip()):
        raise ValueError(label + " must be " + ("nonempty " if nonempty else "") + "text")
    return value


def _identity(value, label):
    _text(value, label, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value):
        raise ValueError(label + " must use its original portable request identity")
    return value


def draft(value):
    _object(value, ("schema", "fields", "axes", "areas", "difference_maps", "calibration_origin"), "Working design")
    if value["schema"] != SCHEMA:
        raise ValueError("Open a complete Parameter working design")
    _object(value["fields"], FIELDS, "Working form")
    for name in FIELDS:
        _text(value["fields"][name], name)
    if type(value["difference_maps"]) is not bool:
        raise ValueError("Retain the original difference-map checkbox")
    if not isinstance(value["axes"], list) or not isinstance(value["areas"], list):
        raise ValueError("Retain the ordered original axes and reporting areas")
    for axis in value["axes"]:
        _object(axis, (*AXIS_FIELDS, "axis_parameters"), "Working axis")
        for name in AXIS_FIELDS:
            _text(axis[name], name)
        if not isinstance(axis["axis_parameters"], list) or any(not isinstance(item, str) for item in axis["axis_parameters"]):
            raise ValueError("Retain the selected native parameter names")
    for area in value["areas"]:
        _object(area, AREA_FIELDS, "Working reporting area")
        for name in AREA_FIELDS:
            _text(area[name], name)
    if value["calibration_origin"] is not None and not isinstance(value["calibration_origin"], dict):
        raise ValueError("Retain the complete original calibration binding")
    canonical(value)  # Reject non-JSON/nonfinite metadata before retaining it.
    return deepcopy(value)


def bindings(workspace, value):
    """Bind actual chosen records without interpreting unfinished numeric fields."""
    value = draft(value)
    run_id = value["fields"]["baseline_run_id"]
    run = None
    if run_id:
        retained = workspace.inspect_run(identifier(run_id))
        selection = retained["selection"]
        if retained["id"] != run_id or digest(selection) != run_id:
            raise ValueError("The working baseline changed its original native selection")
        run = {"id": run_id, "selection": deepcopy(selection)}
    sources = []
    for area in value["areas"]:
        collection_id = area["area_collection"]
        if collection_id and collection_id not in [item["id"] for item in sources]:
            original = workspace._get("sources", identifier(collection_id))
            sources.append({"id": collection_id, "record": original})
    origin = value["calibration_origin"]
    if origin is not None:
        from .parameter_calibration import continuation
        packet = continuation(workspace, identifier(origin.get("calibration_id")))
        if packet["calibration_origin"] != origin or packet["baseline_run_id"] != run_id:
            raise ValueError("The working design changed its original selected calibration profile")
    return {"baseline": run, "reporting_sources": sources, "calibration_origin": deepcopy(origin)}


def _record(value):
    keys = ("id", "schema", "project_id", "series_id", "revision", "parent_id", "forked_from",
            "name", "author", "note", "created_at", "request_id", "request_sha256", "draft", "bindings")
    _object(value, keys, "Working revision")
    raw = {key: item for key, item in value.items() if key != "id"}
    if value["schema"] != "upstate." + KIND + "/v1" or digest(raw) != identifier(value["id"]):
        raise ValueError("The working revision changed its immutable original bytes")
    _identity(value["series_id"], "Working series")
    _identity(value["request_id"], "Save request")
    identifier(value["request_sha256"])
    if type(value["revision"]) is not int or value["revision"] < 1:
        raise ValueError("The working revision number is invalid")
    for name in ("project_id", "name", "author", "created_at"):
        _text(value[name], name, True)
    _text(value["note"], "Revision note")
    for name in ("parent_id", "forked_from"):
        if value[name] is not None:
            identifier(value[name])
    original = draft(value["draft"])
    fixed = _object(value["bindings"], ("baseline", "reporting_sources", "calibration_origin"), "Original working bindings")
    if fixed["calibration_origin"] != original["calibration_origin"]:
        raise ValueError("The working calibration binding differs from the raw form")
    baseline = fixed["baseline"]
    if original["fields"]["baseline_run_id"]:
        if (not isinstance(baseline, dict) or set(baseline) != {"id", "selection"}
                or baseline["id"] != original["fields"]["baseline_run_id"]
                or digest(baseline["selection"]) != baseline["id"]):
            raise ValueError("The working baseline binding changed")
    elif baseline is not None:
        raise ValueError("An unselected working baseline cannot declare native inputs")
    source_ids = list(dict.fromkeys(area["area_collection"] for area in original["areas"] if area["area_collection"]))
    if not isinstance(fixed["reporting_sources"], list) or [item.get("id") for item in fixed["reporting_sources"]] != source_ids:
        raise ValueError("The working source bindings differ from the original raw choices")
    for source in fixed["reporting_sources"]:
        record = source.get("record", {})
        if (record.get("id") != source["id"] or record.get("schema") != "upstate.sources/v1"
                or digest({key: item for key, item in record.items() if key != "id"}) != source["id"]):
            raise ValueError("The working source collection changed its original bytes")
    return value


def inspect_package(workspace, package):
    _object(package, ("schema", "revision_id", "records"), "Working history")
    if package["schema"] != PACKAGE or not isinstance(package["records"], list) or not package["records"]:
        raise ValueError("Open a complete original Parameter working history")
    seen = {}
    requests = set()
    revisions = set()
    for item in package["records"]:
        _record(item)
        if (item["id"] in seen or (item["project_id"], item["request_id"]) in requests
                or (item["series_id"], item["revision"]) in revisions):
            raise ValueError("The working history repeats an original revision or save request")
        parent = seen.get(item["parent_id"])
        if item["parent_id"] is not None:
            if parent is None or parent["series_id"] != item["series_id"] or item["revision"] != parent["revision"] + 1 or item["forked_from"] is not None:
                raise ValueError("The working history lost its ordered original parent")
        elif item["revision"] != 1 or (item["forked_from"] is not None and item["forked_from"] not in seen):
            raise ValueError("The working history lost the original forked revision")
        if workspace is not None and item["bindings"] != bindings(workspace, item["draft"]):
            raise ValueError("The working history's original native sources are missing or changed")
        seen[item["id"]] = item
        requests.add((item["project_id"], item["request_id"]))
        revisions.add((item["series_id"], item["revision"]))
    current = identifier(package["revision_id"])
    reachable = set()
    while current is not None:
        if current in reachable or current not in seen:
            raise ValueError("The selected working history has a missing or cyclic ancestor")
        reachable.add(current)
        item = seen[current]
        current = item["parent_id"] or item["forked_from"]
    if reachable != set(seen):
        raise ValueError("The package contains unrelated working revisions")
    return deepcopy(package)


def export_package(workspace, revision_id):
    key, seen, records = identifier(revision_id), set(), []
    while key is not None:
        if key in seen:
            raise ValueError("The working history repeats an ancestor")
        seen.add(key)
        item = workspace._get(KIND, key)
        _record(item)
        records.append(item)
        key = item["parent_id"] or item["forked_from"]
    package = {"schema": PACKAGE, "revision_id": revision_id, "records": list(reversed(records))}
    return inspect_package(workspace, package)


def inspect(workspace, revision_id):
    package = export_package(workspace, revision_id)
    record = package["records"][-1]
    return {"record": record, "package": package,
            "history": [{"id": item["id"], "series_id": item["series_id"], "revision": item["revision"],
                         "name": item["name"], "author": item["author"], "note": item["note"],
                         "created_at": item["created_at"], "forked_from": item["forked_from"]}
                        for item in package["records"]],
            "baseline_catalog": _catalog(workspace, record["draft"])}


def _catalog(workspace, value):
    if not value["fields"]["baseline_run_id"]:
        return None
    from .parameter_studies import catalog
    return catalog(workspace, value["fields"]["baseline_run_id"])


def list_series(workspace):
    groups = {}
    for item in workspace._list(KIND):
        _record(item)
        groups.setdefault(item["series_id"], []).append(item)
    result = []
    for series, records in groups.items():
        records.sort(key=lambda item: item["revision"])
        if len({item["revision"] for item in records}) != len(records):
            raise ValueError("The named working design has conflicting native heads")
        head = records[-1]
        # Full source/history verification is performed on explicit open, save,
        # export and receiving; the catalogue reads immutable native headers only.
        result.append({key: deepcopy(head[key]) for key in
                       ("id", "series_id", "revision", "name", "author", "note", "created_at", "project_id")})
    return sorted(result, key=lambda item: (item["created_at"], item["id"]), reverse=True)


def save(workspace, selection):
    keys = ("request_id", "series_id", "parent_id", "forked_from", "name", "author", "note", "draft", "imported_package")
    _object(selection, keys, "Working save")
    _identity(selection["request_id"], "Save request")
    _identity(selection["series_id"], "Working series")
    for name in ("name", "author"):
        _text(selection[name], name, True)
    _text(selection["note"], "Revision note")
    for name in ("parent_id", "forked_from"):
        if selection[name] is not None:
            identifier(selection[name])
    request_sha = digest(selection)
    with held(workspace.root / ".workspace.lock"), held(workspace.root / ".parameter-working.lock"):
        matches = [item for item in workspace._list(KIND)
                   if item.get("request_id") == selection["request_id"] and item.get("project_id") == workspace.project["id"]]
        if matches:
            if len(matches) != 1 or matches[0]["request_sha256"] != request_sha:
                raise ValueError("This save request was already used for different original work")
            return inspect(workspace, matches[0]["id"])
        imported = selection["imported_package"]
        if imported is not None:
            inspect_package(workspace, imported)
            if selection["series_id"] in {item["series_id"] for item in imported["records"]}:
                raise ValueError("Import into a new branch, distinct from every original history series")
            if selection["parent_id"] is not None or selection["forked_from"] != imported["revision_id"]:
                raise ValueError("Import complete history into an explicit new working branch")
        records = workspace._list(KIND)
        if imported is not None:
            known = {(item["series_id"], item["revision"]): item["id"] for item in records}
            for item in imported["records"]:
                existing = known.get((item["series_id"], item["revision"]))
                if existing is not None and existing != item["id"]:
                    raise ValueError("The imported history conflicts with an already retained original revision")
        old = sorted((item for item in records if item["series_id"] == selection["series_id"]), key=lambda item: item["revision"])
        parent = old[-1] if old else None
        if selection["parent_id"] != (parent["id"] if parent else None):
            raise ValueError("WORKING_PARENT_CHANGED: another revision was saved; reopen it or explicitly save a new branch")
        if parent and selection["forked_from"] is not None:
            raise ValueError("Only the first revision may fork another working history")
        if selection["forked_from"] is not None and imported is None:
            export_package(workspace, selection["forked_from"])
        original = draft(selection["draft"])
        fixed = bindings(workspace, original)
        context_path = workspace.root / "parameter-working-operations" / selection["request_id"] / "request.json"
        if context_path.exists():
            from .common import read_json
            context = read_json(context_path)
            if context["request_sha256"] != request_sha:
                raise ValueError("This original save request belongs to different work")
        else:
            context = {"request_sha256": request_sha, "created_at": now()}
            atomic_json(context_path, context, immutable=True)
        if imported is not None:
            # Native immutable records are retained intact, never rebased by editing IDs.
            for item in imported["records"]:
                if workspace._save(KIND, item)["id"] != item["id"]:
                    raise ValueError("Import changed an original working revision")
        payload = {"project_id": workspace.project["id"], "series_id": selection["series_id"],
                   "revision": parent["revision"] + 1 if parent else 1, "parent_id": selection["parent_id"],
                   "forked_from": selection["forked_from"], "name": selection["name"], "author": selection["author"],
                   "note": selection["note"], "created_at": context["created_at"], "request_id": selection["request_id"],
                   "request_sha256": request_sha, "draft": original, "bindings": fixed}
        record = workspace._save(KIND, payload)
        return inspect(workspace, record["id"])


def selection_from_draft(value):
    value = draft(value)
    fields = value["fields"]
    axes = []
    for item in value["axes"]:
        values = []
        for token in re.split(r"[\r\n,]+", item["axis_values"]):
            token = token.strip()
            if not token:
                continue
            parsed = token if token in ("mfd", "d8") else json.loads(token)
            if not ((type(parsed) in (int, float) and math.isfinite(parsed)) or parsed in ("mfd", "d8")):
                raise ValueError("Use finite numbers, mfd or d8 in a scientific selection")
            values.append(parsed)
        axes.append({"name": item["axis_name"].strip(), "parameters": item["axis_parameters"],
                     "values": values, "reason": item["axis_reason"].strip(),
                     "references": [line.strip() for line in item["axis_references"].splitlines() if line.strip()]})
    areas = []
    for item in value["areas"]:
        area = {"name": item["area_name"].strip(), "source_collection_id": item["area_collection"].strip(),
                "source_id": item["area_source"].strip()}
        if item["area_layer"].strip():
            area["layer"] = item["area_layer"].strip()
        if item["area_where"].strip():
            area["where"] = json.loads(item["area_where"])
        areas.append(area)
    result = {"title": fields["experiment_title"].strip(), "purpose": fields["experiment_purpose"].strip(),
              "baseline_run_id": fields["baseline_run_id"].strip(), "design": fields["experiment_design"].strip(),
              "axes": axes, "reporting_areas": areas, "difference_maps": value["difference_maps"]}
    if value["calibration_origin"] is not None:
        result["calibration_origin"] = deepcopy(value["calibration_origin"])
    return result


def origin(workspace, value, selection):
    _object(value, ("revision_id",), "Original working revision")
    package = export_package(workspace, identifier(value["revision_id"]))
    from .parameter_studies import _selection
    original, _, _ = _selection(workspace, selection_from_draft(package["records"][-1]["draft"]))
    actual = {key: item for key, item in selection.items() if key != "working_origin"}
    if original != actual:
        raise ValueError("The scientific selection differs from its original saved working design")
    return deepcopy(value)


def export_files(workspace, revision_id):
    package = export_package(workspace, revision_id)
    directory = workspace.root / "parameter-working-exports" / identifier(revision_id)
    atomic_json(directory / "working-history.json", package, immutable=True)
    atomic_json(directory / "working-draft.json", package["records"][-1]["draft"], immutable=True)
    return {"revision_id": revision_id, "files": {
        "Complete editable working history": describe_file(workspace.root, directory / "working-history.json", media_type="application/json"),
        "Raw unfinished fields": describe_file(workspace.root, directory / "working-draft.json", media_type="application/json")}}


def verify_all(workspace):
    heads = list_series(workspace)
    for head in heads:
        export_package(workspace, head["id"])
    return {"series": len(heads), "revisions": len(workspace._list(KIND)),
            "heads": [item["id"] for item in heads]}
