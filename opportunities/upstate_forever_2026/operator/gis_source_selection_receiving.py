"""Prepare and inspect the existing multi-edition GIS receiving continuation.

Uses the caller's original Operator and Workspace. It never starts a service,
browser, model run or replacement task queue.
"""
from __future__ import annotations
import json
import os
import tempfile
from pathlib import Path


def _retain(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("The retained GIS source-selection file belongs to another complete input: " + path.name)
        return path
    fd, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != body:
                raise ValueError("Concurrent GIS source-selection receiving has another complete file")
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return path


def _json(path, value):
    return _retain(path, (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8"))


def prepare(operator, workspace_key, original_collection_id, adopted_collection_id, output):
    """Continue the original completed county source/GIS case with its actual two editions."""
    from model import gis_workspace, gis_project as gis
    native = operator.ws(workspace_key)
    original = native._get("sources", original_collection_id)
    adopted = native._get("sources", adopted_collection_id)
    if original["id"] == adopted["id"]:
        raise ValueError("Retain both distinct original and independently adopted source editions")
    spatial = [entry for entry in adopted["entries"] if entry["kind"] in {"vector", "raster"}]
    if not spatial:
        raise ValueError("The received source edition has no original spatial member")
    for entry in spatial:
        binding = entry.get("received_gis", {}).get("source", {})
        if binding.get("collection_id") != original["id"]:
            raise ValueError("The adopted layer belongs to another original source collection")
    selection = {
        "title": (original["title"] + " — original and received GIS editions")[:240],
        "project_crs": "EPSG:4326",
        "sources": [{"source_collection_id": original["id"], "source_id": row["id"]}
                    for row in original["entries"]] +
                   [{"source_collection_id": adopted["id"], "source_id": row["id"]}
                    for row in spatial],
        "scenario_run_ids": [], "comparison_ids": [], "include_grid": True,
        "notes": [
            "Original county layers and the independently received working edition are retained together.",
            "County context retains its original dates and whole-county geography; receiving an edition does not create new observations."
        ]
    }
    # Resolve through the actual native request, including required companion context.
    request = gis_workspace.request(native, selection)
    catalogue = gis_workspace.catalogue(native)
    collections = [row for row in catalogue["sources"] if row["id"] in {original["id"], adopted["id"]}]
    value = {
        "schema": "upstate.gis-source-selection-receiving-input/v1",
        "project_id": native.project["id"],
        "original_collection_id": original["id"],
        "adopted_collection_id": adopted["id"],
        "selection": selection,
        "catalogue": {"project_id": native.project["id"], "sources": collections},
        "source_records": [original, adopted],
        "native_request": request,
        "builder_version": gis.VERSION
    }
    path = _json(Path(output) / "source-selection-input.json", value)
    return {"input": str(path), "identity": gis.record(path.parent, path),
            "project_id": native.project["id"], "original_collection_id": original["id"],
            "adopted_collection_id": adopted["id"]}


def verify(native, workspace_key, input_path, browser_result_path, output, *, task_reader):
    """Reopen actual browser export/receiving and the exact downloaded complete ZIP."""
    from model import gis_workspace, gis_project as gis
    source = json.loads(Path(input_path).read_text(encoding="utf-8"))
    course = json.loads(Path(browser_result_path).read_text(encoding="utf-8"))
    if (source.get("schema") != "upstate.gis-source-selection-receiving-input/v1"
            or course.get("schema") != "upstate.gis-source-selection-browser/v1"
            or source["project_id"] != native.project["id"]
            or course.get("project_id") != native.project["id"]
            or course.get("workspace_key") != workspace_key
            or course.get("state") not in {"native_ready", "complete"}):
        raise ValueError("Choose the completed original GIS source-selection browser result")
    input_record = gis.record(Path(input_path).parent, Path(input_path))
    if any(course["input"][name] != input_record[name] for name in ("bytes", "sha256")):
        raise ValueError("Browser receiving used another complete source-selection input")
    current_request = gis_workspace.request(native, source["selection"])
    if current_request != source["native_request"] or gis.VERSION != source["builder_version"]:
        raise ValueError("The retained native GIS request/source version changed")
    # Every original and companion is revalidated by source_layer/request above.
    results = {}
    for phase, action in (("export", "gis.project.export"), ("receive", "gis.project.receive")):
        retained = course["phases"][phase]
        request = retained["request"]
        if request["workspace"] != workspace_key or request["action"] != action:
            raise ValueError("The retained request belongs to another original GIS action")
        if phase == "export" and request["payload"] != source["selection"]:
            raise ValueError("The installed chooser changed complete original project selections")
        task = task_reader(retained["task_id"])
        if (task["state"] != "complete"
                or task["operation_id"] != retained["accepted_operation_id"]
                or any(task[name] != request[name] for name in ("workspace", "action", "payload"))):
            raise ValueError("The original native GIS task/request identity changed")
        results[phase] = task["result"]
    exported = native.root / "gis-exports" / results["export"]["id"]
    selection = gis.load(exported / "selection.json")
    if selection != source["selection"]:
        raise ValueError("Native export retained different source choices")
    expected = gis.verify(exported / "project")
    _, received, received_check = gis_workspace.received(native, results["receive"]["id"])
    if received_check["fingerprint"] != expected["fingerprint"]:
        raise ValueError("The received GIS edition differs from the selected export")
    archive = Path(course["archive"]["path"]).resolve(strict=True)
    archive_record = gis.record(archive.parent, archive)
    if any(course["archive"][name] != archive_record[name] for name in ("bytes", "sha256")):
        raise ValueError("The literal browser ZIP changed after download")
    if any(results["export"]["archive"][name] != archive_record[name] for name in ("bytes", "sha256")):
        raise ValueError("The browser ZIP is not the original native export")
    if any(received["archive"][name] != archive_record[name] for name in ("bytes", "sha256")):
        raise ValueError("The original receiver used another complete GIS ZIP")
    root = Path(output).resolve()
    target = root / "independent-complete-gis"
    root.mkdir(parents=True, exist_ok=True)
    binding = {"project_id": native.project["id"], "archive": {
        name: archive_record[name] for name in ("bytes", "sha256")},
        "export_id": results["export"]["id"], "receive_id": results["receive"]["id"]}
    _json(root / "independent-receiving-selection.json", binding)
    if target.exists():
        reopened = gis.verify(target)
    else:
        reopened = gis.receive(archive, target)
    if reopened["fingerprint"] != expected["fingerprint"]:
        raise ValueError("Independent literal GIS ZIP receiving changed the complete edition")
    manifest = gis.load(target / "project.json")
    actual = {}
    for row in manifest["layers"]:
        actual[row["id"]] = (row, row["originals"])
    for row in manifest.get("attachments", []):
        if row["id"] in actual:
            raise ValueError("The received GIS edition repeats a source/layer identity")
        actual[row["id"]] = (row, row["files"])
    originals = [*current_request["layers"], *current_request.get("attachments", [])]
    if set(actual) != {row["id"] for row in originals}:
        raise ValueError("The complete GIS package changed its native selected source population")
    for spec in originals:
        row, files = actual[spec["id"]]
        if row["source"] != spec["source"]:
            raise ValueError("The complete GIS package changed original source metadata")
        expected_files = [(item["path"], item["bytes"], item["sha256"])
                          for item in [spec["file"], *spec.get("companions", [])]]
        actual_files = [(item["source_path"], item["bytes"], item["sha256"]) for item in files]
        if actual_files != expected_files:
            raise ValueError("An original primary or ordered companion changed")
    record = {"schema": "upstate.gis-source-selection-native-reopen/v1",
              "project_id": native.project["id"], "state": "complete",
              "source_selection": source["selection"], "input": input_record,
              "browser_result": gis.record(Path(browser_result_path).parent, Path(browser_result_path)),
              "export_id": results["export"]["id"], "receive_id": results["receive"]["id"],
              "complete_archive": archive_record, "independent_project": str(target),
              "fingerprint": expected["fingerprint"], "source_rows": len(originals)}
    _json(root / "native-reopened.json", record)
    return record


def main():
    """Read-only native reopening under the original browser controller's identity."""
    import argparse
    import sys
    import urllib.parse
    from urllib.request import Request, urlopen
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--controller", type=Path, required=True)
    parser.add_argument("--browser-result", type=Path, required=True)
    args = parser.parse_args()
    controller = json.loads(args.controller.read_text(encoding="utf-8"))
    continuation = controller["source_selection"]
    application = Path(continuation["application"]).resolve(strict=True)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from model.workspace import Workspace
    native = Workspace(Path(continuation["workspace_directory"]).resolve(strict=True))
    login = urllib.parse.urlsplit(controller["locations"]["operator_url"])
    if login.scheme not in {"http", "https"} or login.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Use the original loopback Operator capability")
    token = urllib.parse.parse_qs(login.fragment)["token"][0]
    origin = urllib.parse.urlunsplit((login.scheme, login.netloc, "", "", ""))
    key = controller["workspace_key"]
    def original_task(task_id):
        request = Request(origin + "/api/task?" + urllib.parse.urlencode({"id": task_id}),
                          headers={"Authorization": "Bearer " + token, "X-Workspace": key})
        with urlopen(request, timeout=60) as response:
            body = json.load(response)
        return body.get("task", body)
    value = verify(native, key, continuation["input_path"], args.browser_result,
                   Path(continuation["output_directory"]) / "native-reopen",
                   task_reader=original_task)
    print(json.dumps(value, ensure_ascii=False))


if __name__ == "__main__":
    main()
