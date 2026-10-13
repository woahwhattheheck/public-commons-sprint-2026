"""Terrain chapter of the original saved scientific-report receiving operation.

TokenJunkieLabs. Reads completed native cases and responses, prepares their
ordinary report source, and verifies the original restored typed study.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath

from model.common import atomic_json, describe_file, read_json, verify_file
from model import terrain_conditioning_report_source as reports
from source_tools import terrain_conditioning as terrain
from source_tools import terrain_conditioning_response as responses

SCHEMA = "upstate.terrain-report-receiving/v1"


def require(value, message):
    if not value:
        raise ValueError(message)


def selection(path):
    path = Path(path).resolve(strict=True)
    payload = path.read_bytes()
    authored = json.loads(payload)
    return {"path": str(path), "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "selection": reports.normalize(authored)}


def _snapshot(workspace, response_id):
    response = responses.inspect(workspace, response_id)
    require(response.get("state") == "complete", "Open the completed original terrain response.")
    case_id = response["selection"]["case_id"]
    case = terrain.inspect(workspace, case_id, verify=True)
    require(case.get("state") == "complete", "Retain the original completed terrain case.")
    run_ids = [response["selection"]["baseline_run_id"],
               *[row["run_id"] for row in response["selection"]["alternatives"]]]
    require(len(run_ids) == len(set(run_ids)), "The original terrain response repeats a native run.")
    run_records = []
    for run_id in run_ids:
        run = workspace.inspect_run(run_id)
        require(run["id"] == run_id and run["state"] == "complete",
                "Retain every completed original terrain run.")
        run_records.append(describe_file(workspace.root,
                           workspace.root / "runs" / run_id / "run.json"))
    bindings = []
    for row in workspace._list("terrain-conditioning-bindings"):
        if row.get("case_id") == case_id:
            bindings.append({"id": row["id"], "record": workspace._get(
                "terrain-conditioning-bindings", row["id"])})
    return {"project_id": workspace.project["id"], "case": case, "response": response,
            "run_ids": run_ids, "run_records": run_records,
            "bindings": sorted(bindings, key=lambda row: row["id"])}


def _verify_inputs(workspace, snapshot):
    require(workspace.project["id"] == snapshot["project_id"],
            "The Terrain chapter belongs to another original project.")
    require(terrain.inspect(workspace, snapshot["case"]["id"], verify=True) == snapshot["case"],
            "The original terrain case changed.")
    require(responses.inspect(workspace, snapshot["response"]["id"]) == snapshot["response"],
            "The completed original terrain response changed.")
    for member in snapshot["run_records"]:
        verify_file(workspace.root, member)
    for row in snapshot["bindings"]:
        require(workspace._get("terrain-conditioning-bindings", row["id"]) == row["record"],
                "The original terrain native binding changed.")


def prepare(workspace, output, requested, read, action, download):
    """Use the original receiver's queue, checkpoint and download ownership."""
    path = output / "terrain-inputs.json"
    if path.exists():
        inputs = read_json(path)
        require(inputs.get("project_id") == workspace.project["id"]
                and inputs.get("response", {}).get("id") == requested["selection"]["response_id"],
                "Resume the original terrain response and project.")
        _verify_inputs(workspace, inputs)
    else:
        inputs = _snapshot(workspace, requested["selection"]["response_id"])
        atomic_json(path, inputs, immutable=True)
    preview_path = output / "terrain-source-preview.json"
    if preview_path.exists():
        preview = read_json(preview_path)
    else:
        preview = read("POST", "/api/terrain-conditioning/report-source-preview",
                       {"selection": requested["selection"]})
        atomic_json(preview_path, preview, immutable=True)
    require(preview.get("selection") == requested["selection"]
            and preview.get("binding", {}).get("project_id") == inputs["project_id"]
            and preview["binding"].get("case_id") == inputs["case"]["id"]
            and preview["binding"].get("response_id") == inputs["response"]["id"],
            "The source preview changed the original Terrain choices.")
    task = action("terrain_source", "terrain.conditioning.report-source.prepare",
                  {"selection": requested["selection"], "expected_id": preview["id"]})
    source = reports.inspect(workspace, preview["id"])
    require(task["result"] == source and source["state"] == "complete"
            and source["binding"] == preview["binding"],
            "The original source task changed its retained scientific identity.")
    _verify_inputs(workspace, inputs)
    detail = read("GET", "/api/terrain-conditioning",
                  {"action": "report-source", "id": source["id"]})
    tickets = detail.get("_downloads", [])
    require(len(tickets) == len(source["files"]), "Retain every original Terrain source attachment.")
    copies = []
    prefix = PurePosixPath(source["directory"])
    for member, ticket in zip(source["files"], tickets):
        relative = PurePosixPath(member["path"]).relative_to(prefix)
        require(relative.parts and ".." not in relative.parts
                and all(ticket.get(name) == member[name] for name in ("bytes", "sha256")),
                "A Terrain source ticket differs from its original file.")
        destination = output / "terrain-source" / Path(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        copied = download(ticket, destination.relative_to(output).as_posix())
        copies.append({"original": member, "path": str(copied),
                       "bytes": member["bytes"], "sha256": member["sha256"]})
    result = {"schema": SCHEMA, "project_id": workspace.project["id"],
              "request": requested, "inputs": inputs, "preview": preview,
              "report_source": source, "source": source["source"], "downloads": copies,
              "task_id": task["id"]}
    retained = output / "terrain-source-receiving.json"
    if retained.exists():
        require(read_json(retained) == result, "Resume the exact original Terrain source receiving chapter.")
    else:
        atomic_json(retained, result, immutable=True)
    return result


def verify(workspace, chapter, nodes=None):
    require(chapter.get("schema") == SCHEMA, "Open the original Terrain receiving chapter.")
    _verify_inputs(workspace, chapter["inputs"])
    actual = reports.inspect(workspace, chapter["report_source"]["id"])
    require(actual == chapter["report_source"],
            "Cold receiving changed the original Terrain scientific report source.")
    required = {("terrain-conditioning-cases", chapter["inputs"]["case"]["id"]),
                ("terrain-conditioning-responses", chapter["inputs"]["response"]["id"]),
                ("terrain-conditioning-report-sources", actual["id"])}
    required.update(("terrain-conditioning-bindings", row["id"])
                    for row in chapter["inputs"]["bindings"])
    required.update(("runs", run_id) for run_id in chapter["inputs"]["run_ids"])
    if nodes is not None:
        retained = {(row["kind"], row["id"]) for row in nodes}
        require(required <= retained,
                "The selected scientific Study omitted original editable Terrain or native run records.")
    return {"project_id": workspace.project["id"], "workspace": str(workspace.root),
            "case_id": chapter["inputs"]["case"]["id"],
            "response_id": chapter["inputs"]["response"]["id"],
            "report_source_id": actual["id"], "source": actual["source"],
            "native_run_ids": chapter["inputs"]["run_ids"],
            "verified_records": [{"kind": kind, "id": key} for kind, key in sorted(required)]}
