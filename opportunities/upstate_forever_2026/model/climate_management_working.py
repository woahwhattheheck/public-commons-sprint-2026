"""Named, immutable unfinished Climate management designs in the native Workspace.

Uses the same native immutable revision/CAS pattern as parameter_working.
Raw controls are recoverable working material. Only climate_management.preview /
build may accept a scientific selection; this module never creates a run.
"""
from __future__ import annotations

from copy import deepcopy
import re

from .common import atomic_json, canonical, describe_file, digest, held, identifier, now

KIND = "climate-management-working"
SCHEMA = "upstate.climate-management-working-draft/v1"
PACKAGE = "upstate.climate-management-working-history/v1"
RECOVERY = "upstate.climate-management-working-recovery/v1"
SELECTION_FIELDS = ("title", "purpose", "reference_period_id", "periods", "reporting_areas", "difference_maps")
ROLES = ("reference", "treatment", "control")


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
    _object(value, ("schema", "selection"), "Working design")
    if value["schema"] != SCHEMA:
        raise ValueError("Open a complete Climate management working design")
    selected = _object(value["selection"], SELECTION_FIELDS, "Raw management selection")
    for name in ("title", "purpose", "reference_period_id"):
        _text(selected[name], name)
    if type(selected["difference_maps"]) is not bool:
        raise ValueError("Retain the original difference-map checkbox")
    if not isinstance(selected["periods"], list) or not isinstance(selected["reporting_areas"], list):
        raise ValueError("Retain the ordered original periods and reporting areas")
    for period in selected["periods"]:
        if (not isinstance(period, dict) or set(period) - {"id", "label", *ROLES}
                or not {"id", "label", "reference", "treatment"}.issubset(period)):
            raise ValueError("Retain every original period and scenario-role control")
        _text(period["id"], "Period ID")
        _text(period["label"], "Period label")
        for role in ROLES:
            if role in period:
                pair = _object(period[role], ("study_id", "case_id"), "Raw " + role + " choice")
                _text(pair["study_id"], "Study ID")
                _text(pair["case_id"], "Case ID")
    for area in selected["reporting_areas"]:
        if (not isinstance(area, dict) or set(area) - {"source_collection_id", "source_id", "name", "layer", "where"}
                or not {"source_collection_id", "source_id", "name"}.issubset(area)):
            raise ValueError("Retain the original reporting-area fields")
        for name in ("source_collection_id", "source_id", "name"):
            _text(area[name], "Raw reporting " + name)
        if "layer" in area:
            _text(area["layer"], "Raw reporting layer")
    canonical(value)
    return deepcopy(value)


def _choices(value):
    return [period[role] for period in value["selection"]["periods"] for role in ROLES if role in period]


def _source_choices(value):
    return value["selection"]["reporting_areas"]


def _validate_bindings(value, fixed):
    _object(fixed, ("studies", "sources"), "Original working bindings")
    study_ids = list(dict.fromkeys(choice["study_id"] for choice in _choices(value) if choice["study_id"]))
    if not isinstance(fixed["studies"], list) or [row.get("id") for row in fixed["studies"]] != study_ids:
        raise ValueError("The working study bindings differ from the original role choices")
    by_id = {}
    for row in fixed["studies"]:
        _object(row, ("id", "identity"), "Original forcing study")
        identity = row["identity"]
        if (not isinstance(identity, dict) or digest(identity) != identifier(row["id"])
                or identity.get("schema") != "upstate.climate-forcing-study/v1"):
            raise ValueError("The original forcing-study identity changed")
        by_id[row["id"]] = identity
    for choice in _choices(value):
        if choice["study_id"] and choice["case_id"]:
            identity = by_id[choice["study_id"]]
            original = ["baseline", *[row["id"] for row in identity["selection"]["cases"]]]
            if choice["case_id"] not in original:
                raise ValueError("A selected role case is absent from its original forcing study")
    source_ids = list(dict.fromkeys(choice["source_collection_id"] for choice in _source_choices(value)
                                   if choice["source_collection_id"]))
    if not isinstance(fixed["sources"], list) or [row.get("id") for row in fixed["sources"]] != source_ids:
        raise ValueError("The working reporting-source bindings changed")
    for source in fixed["sources"]:
        _object(source, ("id", "record"), "Original reporting-source collection")
        record = source["record"]
        if (record.get("id") != source["id"] or record.get("schema") != "upstate.sources/v1"
                or digest({key: item for key, item in record.items() if key != "id"}) != source["id"]):
            raise ValueError("The working reporting-source collection changed")
    sources = {row["id"]: row["record"] for row in fixed["sources"]}
    for choice in _source_choices(value):
        if choice["source_collection_id"] and choice["source_id"]:
            if len([row for row in sources[choice["source_collection_id"]]["entries"]
                    if row["id"] == choice["source_id"]]) != 1:
                raise ValueError("A reporting source is missing or ambiguous in its original collection")
    return fixed


def bindings(workspace, value):
    """Bind immutable study designs, not mutable completion/latest-report state."""
    from . import climate_forcing
    from .common import read_json
    value = draft(value)
    studies, sources, seen = [], [], set()
    for choice in _choices(value):
        key = choice["study_id"]
        if not key or key in seen:
            continue
        key = identifier(key)
        climate_forcing._read(workspace, key)
        identity = read_json(workspace.root / "climate-forcing-studies" / key / "selection.json")
        studies.append({"id": key, "identity": identity})
        seen.add(key)
    seen = set()
    for choice in _source_choices(value):
        key = choice["source_collection_id"]
        if key and key not in seen:
            sources.append({"id": key, "record": workspace._get("sources", identifier(key))})
            seen.add(key)
    return _validate_bindings(value, {"studies": studies, "sources": sources})


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
    _validate_bindings(original, value["bindings"])

    return value


def inspect_package(workspace, package):
    _object(package, ("schema", "revision_id", "records"), "Working history")
    if package["schema"] != PACKAGE or not isinstance(package["records"], list) or not package["records"]:
        raise ValueError("Open a complete original Climate management working history")
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
            "catalog": _catalog(workspace, record["draft"])}


def _catalog(workspace, value):
    from .climate_management import catalogue
    return catalogue(workspace)


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
    with held(workspace.root / ".workspace.lock"), held(workspace.root / ".climate-management-working.lock"):
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
        context_path = workspace.root / "climate-management-working-operations" / selection["request_id"] / "request.json"
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
    return deepcopy(draft(value)["selection"])


def origin(workspace, value, selection):
    _object(value, ("revision_id",), "Original working revision")
    package = export_package(workspace, identifier(value["revision_id"]))
    from .climate_management import _selection
    original = _selection(workspace, selection_from_draft(package["records"][-1]["draft"]))
    actual = {key: item for key, item in selection.items() if key != "working_origin"}
    if original["selection"] != actual:
        raise ValueError("The scientific selection differs from its original saved working design")
    return deepcopy(value)


def export_files(workspace, revision_id):
    package = export_package(workspace, revision_id)
    directory = workspace.root / "climate-management-working-exports" / identifier(revision_id)
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
