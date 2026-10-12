#!/usr/bin/env python3
"""Use the original Workspace for the Apex operator journey's source and restore legs."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import zipfile
from decimal import Decimal


def sha(data):
    return hashlib.sha256(data).hexdigest()


def atomic_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def retained(path, data):
    path = Path(path)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("Retained original bytes differ: " + str(path))
    else:
        atomic_bytes(path, data)
    return {"path": str(path), "bytes": len(data), "sha256": sha(data)}


def export(workspace, kind, identity):
    value = workspace.extension_read("classification", "download", kind, identity)
    data = value["data"]
    if not isinstance(data, bytes):
        raise TypeError("The original download did not return bytes")
    return data


def source_document(workspace, kind, reference):
    doc = workspace.extension_read("classification", "document", kind, reference["id"])
    if doc["id"] != reference["id"] or doc["kind"] != kind or doc["sha256"] != reference["sha256"]:
        raise ValueError("Original source edition identity differs: " + kind)
    rows = doc["content"]["grades" if kind == "method" else "rows"]
    if len(rows) != reference["rows"]:
        raise ValueError("Original complete row count differs: " + kind)
    return doc


def captured_inputs(workspace, design, root, output):
    identity = workspace.state()["workspace"]
    if identity["id"] != design["workspace_id"]:
        raise ValueError("The selected original workspace differs")
    sources = {kind: source_document(workspace, kind, ref) for kind, ref in design["sources"].items()}
    if sources["roles"]["parents"]["method"]["sha256"] != sources["method"]["sha256"]:
        raise ValueError("The original role edition lost its exact pay structure")
    if sources["roster"]["parents"]["roles"]["sha256"] != sources["roles"]["sha256"]:
        raise ValueError("The original workforce edition lost its exact roles")

    package_path = root / "native-scenarios" / "apex-accepted-placement-exports.zip"
    package = package_path.read_bytes()
    if sha(package) != design["zip_sha256"]:
        raise ValueError("The accepted six-output package differs")
    exports, scenarios = {}, {}
    with zipfile.ZipFile(package_path) as archive:
        for label, reference in design["scenarios"].items():
            doc = workspace.extension_read("classification", "document", "scenario", reference["id"])
            reviews = doc.get("reviews", [])
            if doc["id"] != reference["id"] or doc["kind"] != "scenario" or not reviews or reviews[-1]["outcome"] != "accepted":
                raise ValueError("The original scenario has no current accepted review: " + label)
            scenarios[label] = doc
            for extension, kind in [("csv", "scenario-csv"), ("json", "scenario-package")]:
                name = label + "-accepted." + extension
                infos = [member for member in archive.infolist() if member.filename == name]
                if len(infos) != 1 or infos[0].is_dir():
                    raise ValueError("The accepted archive member is not unique: " + name)
                expected = archive.read(infos[0])
                if sha(expected) != reference[extension]:
                    raise ValueError("The accepted member hash differs: " + name)
                actual = export(workspace, kind, reference["id"])
                if actual != expected:
                    raise ValueError("The live accepted export differs from the retained original: " + name)
                exports[name] = {**retained(output / "originals" / name, actual), "kind": kind, "id": reference["id"]}

    row_ref = design["planning_row"]
    row = next(value for value in sources["roster"]["content"]["rows"] if value["id"] == row_ref["id"])
    role = next(value for value in sources["roles"]["content"]["rows"] if value["id"] == row_ref["role_id"])
    grade = next(value for value in sources["method"]["content"]["grades"] if value["id"] == row_ref["grade_id"])
    if row["role_id"] != role["id"] or role["grade_id"] != grade["id"]:
        raise ValueError("The planning row lost its original role/grade join")
    for actual, expected in [
        (row["fte"], row_ref["fte"]),
        (row["annual_base_rate"], row_ref["annual_base_rate"]),
        (row["proposed_annual_base_rate"], row_ref["reference"]),
        (grade["reference"], row_ref["reference"]),
        (grade["max"], row_ref["proposed"]),
    ]:
        if not isinstance(actual, str) or Decimal(actual) != Decimal(expected):
            raise ValueError("A published source rate or FTE differs")
    editable = export(workspace, "roster", sources["roster"]["id"])
    editable_ref = retained(output / "originals" / "target-roster-editable-original.json", editable)
    original = {
        "schema": "apex.operator.original-inputs.v1",
        "workspace_id": identity["id"],
        "sources": sources,
        "scenarios": scenarios,
        "exports": exports,
        "editable_roster": editable_ref,
        "planning_source": {"row": row, "role": role, "grade": grade},
        "accepted_zip": {"path": str(package_path), "bytes": len(package), "sha256": sha(package)},
    }
    # The first source capture is immutable. Subsequent native reads verify it again.
    retained(output / "ORIGINAL-INPUTS.json", json_bytes(original))
    return {"original": original, "observed_revision": identity["revision"]}


def backup_and_reopen(workspace, design, output, restore):
    progress = json.loads((output / "BROWSER-PROGRESS.json").read_text())
    if progress["operation_id"] != design["operation_id"] or progress["workspace_id"] != design["workspace_id"]:
        raise ValueError("The progress belongs to another original operator case")
    originals = json.loads((output / "ORIGINAL-INPUTS.json").read_text())
    request_path = output / "requests" / "final-backup.request.json"
    if request_path.exists():
        request = json.loads(request_path.read_text())
    else:
        request = {
            "operation_id": design["operation_id"] + "-final-backup",
            "expected_revision": workspace.state()["workspace"]["revision"],
        }
        atomic_bytes(request_path, json_bytes(request))
    if request["operation_id"] != design["operation_id"] + "-final-backup":
        raise ValueError("The original backup operation differs")
    response = workspace.mutate("prepare_backup", request)
    saved = response["result"]
    atomic_bytes(output / "responses" / "final-backup.response.json", json_bytes(response))
    archive = workspace.backup(saved["id"])
    target = output / ("restored-" + saved["id"])
    restoration = restore(archive, target)
    from core import Workspace
    reopened = Workspace(target)
    if reopened.state()["workspace"]["id"] != design["workspace_id"]:
        raise ValueError("The restored original workspace identity differs")
    matches = []
    for name, ref in originals["exports"].items():
        expected = Path(ref["path"]).read_bytes()
        if sha(expected) != ref["sha256"]:
            raise ValueError("The retained accepted export differs: " + name)
        actual = export(reopened, ref["kind"], ref["id"])
        if actual != expected:
            raise ValueError("The restored accepted export differs: " + name)
        matches.append({"name": name, "bytes": len(actual), "sha256": sha(actual), "exact_match": True})
    for kind, ref in design["sources"].items():
        source_document(reopened, kind, ref)
    derived = {}
    for key, kind in [("derived_roster", "roster"), ("derived_scenario", "scenario")]:
        ref = progress.get(key)
        if not ref:
            raise ValueError("The complete original operator case lacks " + key)
        before = workspace.extension_read("classification", "document", kind, ref["id"])
        after = reopened.extension_read("classification", "document", kind, ref["id"])
        if before != after or after["sha256"] != ref["sha256"]:
            raise ValueError("The restored planning edition differs: " + key)
        derived[key] = {"id": after["id"], "sha256": after["sha256"], "reviews": after.get("reviews", [])}
    data = Path(archive).read_bytes()
    result = {
        "schema": "apex.operator.original-backup.v1",
        "backup": {"id": saved["id"], "path": str(archive), "bytes": len(data), "sha256": sha(data)},
        "restored_path": str(target),
        "restoration": restoration,
        "workspace_id": design["workspace_id"],
        "original_exports": matches,
        "derived": derived,
        "revision": reopened.state()["workspace"]["revision"],
    }
    atomic_bytes(output / "BACKUP-RESTORE-RESULT.json", json_bytes(result))
    return result


def main():
    mode, app, workspace_path, root_path, output_path, design_path = sys.argv[1:]
    app, root, output = Path(app), Path(root_path), Path(output_path)
    output.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(app))
    from core import Workspace, restore
    design = json.loads(Path(design_path).read_text())
    workspace = Workspace(workspace_path)
    if mode == "capture":
        result = captured_inputs(workspace, design, root, output)
    elif mode == "backup":
        result = backup_and_reopen(workspace, design, output, restore)
    else:
        raise ValueError("Unknown original operator leg")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
