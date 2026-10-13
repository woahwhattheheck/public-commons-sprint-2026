"""Retain existing geographic Programme operations in selected-study closures.

No operation or session is created here. A selected CLI-only study remains
valid without an operator history. Shared transfer writers own archive capture.
"""
from __future__ import annotations

from pathlib import PurePosixPath
from .common import digest, identifier, read_json, verify_file

SCHEMA = "upstate.geographic-operator-transfer/v1"


def _selected_operation(ws, path, geographic_id, programme_id):
    if path.is_symlink() or path.parent.is_symlink():
        return None
    try:
        value = read_json(path)
    except (OSError, ValueError):
        return None
    if not isinstance(value, dict):
        return None
    result = value.get("result")
    if (value.get("schema") != "upstate.geography-operation/v1"
            or value.get("project_id") != ws.project["id"]
            or value.get("state") != "complete"
            or value.get("action") not in {
                "geography.adopt-programme", "geography.open-programme"}
            or not isinstance(result, dict)
            or result.get("geographic_id") != geographic_id
            or result.get("programme_id") != programme_id):
        return None
    if identifier(value.get("task_id")) != path.parent.name:
        raise ValueError("Selected geographic operation changed its original task identity")
    return value


def _receipt_binding(adoption, receipt, opening):
    if (not isinstance(receipt, dict)
            or receipt.get("schema") != "upstate.geographic-operator-opening-receipt/v1"
            or any(receipt.get(key) != adoption.get(key)
                   for key in ("project_id", "geographic_id", "programme_id"))
            or receipt.get("opening_id") != opening["id"]
            or receipt.get("requested_selection") != opening["journey"]["selection"]
            or receipt.get("state") not in {"saved", "already_selected", "preserved_current"}):
        raise ValueError("Selected opening receipt belongs to another geographic adoption")
    saved = receipt.get("operator_session")
    descriptor = receipt.get("operator_session_file")
    if saved is None:
        if (descriptor is not None or receipt.get("revision") is not None
                or receipt.get("selection") is not None
                or receipt.get("selection_applied") is not False
                or receipt.get("state") != "preserved_current"):
            raise ValueError("Selected historical empty session differs from its opening receipt")
    else:
        if (not isinstance(saved, dict) or not isinstance(descriptor, dict)
                or descriptor.get("path") != "operator-session.json"
                or saved.get("project_id") != adoption["project_id"]
                or saved.get("revision") != digest(saved.get("journey"))
                or saved.get("revision") != receipt.get("revision")
                or saved.get("journey", {}).get("selection") != receipt.get("selection")):
            raise ValueError("Selected historical operator view differs from its opening receipt")
        identifier(descriptor.get("sha256"))
        if type(descriptor.get("bytes")) is not int or descriptor["bytes"] < 0:
            raise ValueError("Selected operator session has no exact original file descriptor")
        applied = (receipt["state"] != "preserved_current"
                   and receipt["selection"] == opening["journey"]["selection"])
        if receipt.get("selection_applied") is not applied:
            raise ValueError("Selected opening status differs from its retained selection")
    return saved


def _collect(workspace, geographic_id, programme_id, read, add):
    from .geographic_programme import verify, operator_opening, verify_operator_opening
    ws = workspace
    geographic_id, programme_id = identifier(geographic_id), identifier(programme_id)
    directory = ws.root / "geography-operations"
    records = []
    if directory.exists() and directory.is_symlink():
        raise ValueError("Geographic operation history cannot be a symbolic link")
    for path in sorted(directory.glob("*/operation.json")):
        value = _selected_operation(ws, path, geographic_id, programme_id)
        if value is not None:
            records.append((path, value))
    adoptions = {}
    operations = []
    for path, value in records:
        if value["action"] != "geography.adopt-programme":
            continue
        adoption = value["result"]
        verify(ws, adoption)
        relative = path.relative_to(ws.root).as_posix()
        if read(relative) != value:
            raise ValueError("Original geographic adoption changed during capture")
        adoptions[value["task_id"]] = adoption
        operations.append({"task_id": value["task_id"], "action": value["action"],
                           "operation": relative})
    session_path = ws.root / "operator-session.json"
    if session_path.is_symlink():
        raise ValueError("Current operator session cannot be a symbolic link")
    current = read_json(session_path) if session_path.exists() else None
    matched = []
    historical = []
    outside = []
    for path, value in records:
        if value["action"] != "geography.open-programme":
            continue
        result = value["result"]
        adoption_id = identifier(result.get("adoption_task_id"))
        adoption = adoptions.get(adoption_id)
        if adoption is None:
            # Another delivery adoption may share a Programme. Do not capture a
            # dangling UI operation or silently substitute its original parent.
            continue
        relative = path.relative_to(ws.root).as_posix()
        if read(relative) != value:
            raise ValueError("Original geographic opening changed during capture")
        receipt_name = path.parent.relative_to(ws.root).as_posix() + "/opening.json"
        receipt = read(receipt_name)
        if receipt != result.get("operator_opening"):
            raise ValueError("Opening operation differs from its retained original receipt")
        opening = operator_opening(ws, adoption)
        saved = _receipt_binding(adoption, receipt, opening)
        record = {"task_id": value["task_id"], "action": value["action"],
                  "adoption_task_id": adoption_id, "operation": relative,
                  "opening": receipt_name, "receipt_state": receipt["state"]}
        selected_view = (saved is None or (
            saved.get("journey", {}).get("selection") == opening["journey"]["selection"]
            and not saved.get("journey", {}).get("regional")
            and not saved.get("journey", {}).get("community")))
        if saved == current and selected_view:
            verification = verify_operator_opening(ws, adoption, receipt)
            descriptor = receipt.get("operator_session_file")
            if descriptor is not None:
                # Bind the exact original bytes, not a new serialization of the
                # saved inline value. The transfer's capture pass checks again.
                add(descriptor["path"], descriptor)
                if read(descriptor["path"]) != saved:
                    raise ValueError("Original operator session changed during capture")
            record["current_session"] = True
            record["verification"] = verification
            matched.append(value["task_id"])
        else:
            # A later edit must never be replaced by an earlier opening. Keep
            # its original operation/receipt as history, not as the current view.
            record["current_session"] = False
            record["history_reason"] = ("current_view_outside_selected_study"
                if saved == current else "later_project_view")
            historical.append(value["task_id"])
            if saved == current:
                outside.append(value["task_id"])
        operations.append(record)
    return {"schema": SCHEMA, "project_id": ws.project["id"],
            "geographic_id": geographic_id, "programme_id": programme_id,
            "operations": operations, "current_opening_task_ids": matched,
            "historical_opening_task_ids": historical,
            "outside_selected_study_task_ids": outside,
            "session_retained": any(item.get("current_session") for item in operations)
                                and current is not None,
            "state": ("current_opening" if matched else
                      "current_view_outside_selected_study" if outside else
                      "historical_operations" if operations else "no_operator_operations")}


def include_programme(closure, prepared, programme_id):
    """Add original operation/receipt/session members to a typed study closure."""
    result = _collect(closure.workspace, prepared["id"], programme_id,
                      closure.read, closure.add_file)
    cache = getattr(closure, "geographic_operator_continuity", None)
    if cache is None:
        cache = {}
        closure.geographic_operator_continuity = cache
    token = (prepared["id"], programme_id)
    if token in cache and cache[token] != result:
        raise ValueError("Selected geographic operator continuity changed during resolution")
    cache[token] = result
    return result


def verify_programme(workspace, geographic_id, programme_id):
    """Read-only verification after the original geographic adoption is restored."""
    def read(relative):
        path = workspace.root.joinpath(*PurePosixPath(relative).parts)
        if path.is_symlink() or any(p.is_symlink() for p in path.parents
                                   if p != workspace.root.parent):
            raise ValueError("Selected operator history contains a symbolic link")
        return read_json(path)
    def add(relative, descriptor):
        if descriptor.get("path") != relative:
            raise ValueError("Operator session descriptor changed its original member path")
        return verify_file(workspace.root, descriptor)
    return _collect(workspace, geographic_id, programme_id, read, add)


def lock_paths(closure):
    """Use existing owner locks during the transfer's second capture resolution."""
    paths = set()
    for relative in closure.files:
        parts = PurePosixPath(relative).parts
        if relative == "operator-session.json":
            paths.add(".operator-session.lock")
    return sorted(paths)
