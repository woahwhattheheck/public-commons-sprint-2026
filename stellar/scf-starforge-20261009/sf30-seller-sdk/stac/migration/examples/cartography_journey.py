#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Publish two original saved projects and keep their complete corrected delivery.

The original receiving journey calls publish_original_projects before its full
workspace export. The helper creates no source capture, project, listener or
replacement archive. Its inputs are the actual two reviewed saved projects.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import sys

_STAC = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_STAC))
from migration import cartography
from migration.native import files as native_files, model, qgis_project
from migration.receiving import _native_operation
from migration.workspace import Workspace


def _keep(root, name, value):
    target = model.member(root, name, existing=False)
    if target.exists():
        original, _ = model.read_json(target)
        model.require(original == value, "PUBLICATION_JOURNEY_INPUT_CHANGED",
                      "Continue the original publication input and retained result.", file=name)
        return original
    model.retain_bytes(root, name, model.json_bytes(value))
    return value


def _request(operation_id, stage):
    return "migration-publication-" + model.value_sha({"operationId": operation_id, "stage": stage})


def _source_rows(state):
    result = {}
    for name in ("sources", "projects"):
        result[name] = {row["id"]: model.value_sha(row) for row in state.get(name, [])}
    for name in ("captures", "plans", "editions", "projectDeliveries", "reviews", "inputs", "comparisons"):
        result["migration." + name] = {
            row["id"]: model.value_sha(row) for row in state.get("migration", {}).get(name, [])
        }
    return result


def _preserved(before, after):
    model.require(before["state"]["id"] == after["state"]["id"]
                  and after["events"][:len(before["events"])] == before["events"],
                  "PUBLICATION_JOURNEY_HISTORY_CHANGED",
                  "Keep the original workspace and its complete prior event history.")
    requests = {row["requestId"]: row for row in after["requests"]}
    model.require(all(requests.get(row["requestId"]) == row for row in before["requests"]),
                  "PUBLICATION_JOURNEY_REQUEST_CHANGED", "Keep every original saved request and result.")
    old, current = _source_rows(before["state"]), _source_rows(after["state"])
    model.require(all(all(current[name].get(key) == value for key, value in rows.items())
                      for name, rows in old.items()),
                  "PUBLICATION_JOURNEY_SOURCE_CHANGED",
                  "Keep the original data, mappings, editions and saved projects unchanged.")
    return {"eventsBefore": len(before["events"]), "eventsAfter": len(after["events"]),
            "requestsBefore": len(before["requests"]), "requestsAfter": len(after["requests"]),
            "originalSourceRowsSha256": model.value_sha(old), "originalRowsPreserved": True}


def _saved_plan(workspace, root, operation_id, stage, actor, spec):
    request_id = _request(operation_id, stage + ":save-plan")
    filename = "actions/" + stage + "-save-plan.json"
    canonical = native_files.canonical(spec)
    target = model.member(root, filename, existing=False)
    if target.exists():
        action, _ = model.read_json(target)
        model.require(action["requestId"] == request_id and action["actor"] == actor
                      and action["specCanonicalJson"] == canonical,
                      "PUBLICATION_JOURNEY_ACTION_CHANGED", "Keep the exact saved publication request.")
    else:
        action = {"requestId": request_id, "actor": actor, "revision": workspace.read()["revision"],
                  "specCanonicalJson": canonical}
        _keep(root, filename, action)
    result = cartography.save_plan(
        workspace, native_files.parse_json(action["specCanonicalJson"]),
        revision=action["revision"], request_id=request_id, actor=actor)
    original = cartography.operation(workspace, request_id)
    model.require(original["found"] and original["operation"]["kind"] == "plan"
                  and original["plan"]["id"] == result["plan"]["id"],
                  "PUBLICATION_JOURNEY_PLAN", "Read the accepted plan through its original request.")
    _keep(root, "results/" + stage + "-plan.json", result)
    return result["plan"]


def _render(workspace, root, operation_id, stage, actor, plan, progress):
    request_id = _request(operation_id, stage + ":publish")
    filename = "actions/" + stage + "-publish.json"
    target = model.member(root, filename, existing=False)
    if target.exists():
        action, _ = model.read_json(target)
        model.require(action["requestId"] == request_id and action["actor"] == actor
                      and action["planId"] == plan["id"],
                      "PUBLICATION_JOURNEY_ACTION_CHANGED", "Keep the exact original native render request.")
    else:
        prior = cartography.operation(workspace, request_id)
        if prior["found"]:
            operation = prior["operation"]
            model.require(operation.get("planId") == plan["id"] and operation.get("actor") == actor,
                          "PUBLICATION_JOURNEY_ACTION_CHANGED",
                          "Continue this request's original publication plan and actor.")
            revision = operation["startingRevision"]
        else:
            revision = workspace.read()["revision"]
        action = {"requestId": request_id, "actor": actor, "planId": plan["id"], "revision": revision}
        _keep(root, filename, action)
    result = cartography.publish(
        workspace, plan["id"], revision=action["revision"],
        request_id=request_id, actor=actor, progress=progress)
    observed = cartography.operation(workspace, request_id)
    model.require(observed["found"] and observed["operation"]["status"] == "complete"
                  and observed["publication"]["id"] == result["publication"]["id"],
                  "PUBLICATION_JOURNEY_RENDER", "Read the completed render through its original request.")
    before_replay = model.value_sha(workspace.snapshot())
    replay = cartography.publish(
        workspace, plan["id"], revision=action["revision"],
        request_id=request_id, actor=actor, progress=progress)
    model.require(replay["replayed"] and replay["publication"]["id"] == result["publication"]["id"]
                  and model.value_sha(workspace.snapshot()) == before_replay,
                  "PUBLICATION_JOURNEY_REPLAY", "Reopen the same completed render without another saved revision.")
    # The original completion includes a per-return replay flag; the retained
    # completion result itself is the original journal response.
    completion = workspace.operation(cartography._step(request_id, "complete"))
    _keep(root, "results/" + stage + "-publication.json", completion)
    return observed["publication"]


def _outputs(workspace, publication_id):
    selected = cartography.publication(workspace, publication_id)
    downloads = {}
    for kind in cartography.OUTPUTS:
        download = cartography.download(workspace, publication_id, kind)
        model.file_digest(Path(download["path"]), expected=download["descriptor"])
        downloads[kind] = {key: copy.deepcopy(download[key])
                           for key in ("descriptor", "mimeType", "filename")}
    return {"publication": selected["publication"], "document": selected["document"], "downloads": downloads}


@_native_operation
def publish_original_projects(workspace, output_root, *, operation_id, actor,
                              baseline, corrected, correction_note, progress=None):
    """Join complete publications to the original receiving operation.

    baseline/corrected are reviewed publication specs with actual projectId,
    title, attribution and print options. The caller supplies the substantive
    correction note and selects the two real saved project editions.
    """
    model.require(isinstance(operation_id, str) and 0 < len(operation_id) <= 240
                  and isinstance(actor, str) and actor.strip(),
                  "PUBLICATION_JOURNEY_CONFIGURATION", "Use the original operation and named operator.")
    model.require(isinstance(baseline, dict) and isinstance(corrected, dict)
                  and isinstance(baseline.get("projectId"), str)
                  and isinstance(corrected.get("projectId"), str)
                  and baseline["projectId"] != corrected["projectId"],
                  "PUBLICATION_JOURNEY_PROJECTS", "Select the actual baseline and corrected saved projects.")
    model.require(isinstance(correction_note, str) and bool(correction_note.strip()),
                  "PUBLICATION_JOURNEY_REVIEW", "Explain the actual selected source or mapping correction.")
    root_path = Path(output_root).expanduser().absolute()
    model.require(not root_path.is_relative_to(workspace.root), "PUBLICATION_JOURNEY_OUTPUT",
                  "Keep the original receiving operation's output directory outside the active workspace.")
    root_path.mkdir(mode=0o700, parents=True, exist_ok=True)
    root = model.directory(root_path)
    model.require(not root.is_relative_to(workspace.root), "PUBLICATION_JOURNEY_OUTPUT",
                  "Keep the resolved receiving output outside the active workspace.")
    input_value = {
        "schema": "starforge.migration-publication-journey.v1",
        "operationId": operation_id, "workspaceId": workspace.read()["id"], "actor": actor,
        "baselineCanonicalJson": native_files.canonical(copy.deepcopy(baseline)),
        "correctedCanonicalJson": native_files.canonical(copy.deepcopy(corrected)),
        "correctionNote": correction_note.strip(),
    }
    _keep(root, "input.json", input_value)
    final_path = root / "result.json"
    if final_path.exists():
        result, _ = model.read_json(final_path)
        model.require(result["inputSha256"] == model.value_sha(input_value),
                      "PUBLICATION_JOURNEY_INPUT_CHANGED", "Keep the original two-project publication operation.")
        for row in result["publications"]:
            current = _outputs(workspace, row["publication"]["id"])
            model.require(current == row, "PUBLICATION_JOURNEY_OUTPUT_CHANGED",
                          "Keep each completed original publication and all six exact delivered files.")
            cartography.reopen_publications(workspace, publication_id=row["publication"]["id"], progress=progress)
        return {**result, "replayed": True}

    before = workspace.snapshot()
    first = native_files.parse_json(input_value["baselineCanonicalJson"])
    model.require(first.get("predecessorPublicationId") is None,
                  "PUBLICATION_JOURNEY_BASELINE", "The selected baseline starts this publication sequence.")
    first_preview = cartography.preview(workspace, first)
    model.require(first_preview["ready"], "PUBLICATION_JOURNEY_PREVIEW",
                  "Resolve the selected baseline's source and print options.", issues=first_preview["issues"])
    first_plan = _saved_plan(workspace, root, operation_id, "baseline", actor, first)
    first_publication = _render(workspace, root, operation_id, "baseline", actor, first_plan, progress)

    second = native_files.parse_json(input_value["correctedCanonicalJson"])
    model.require(second.get("predecessorPublicationId") in (None, first_publication["id"]),
                  "PUBLICATION_JOURNEY_PREDECESSOR", "Bind this corrected edition to its original baseline.")
    second["predecessorPublicationId"] = first_publication["id"]
    second["review"] = {"comparisonSha256": None, "note": input_value["correctionNote"]}
    comparison_preview = cartography.preview(workspace, second)
    comparison = comparison_preview["comparison"]
    model.require(isinstance(comparison, dict), "PUBLICATION_JOURNEY_COMPARISON",
                  "Retain the actual prior/current source and print comparison.")
    _keep(root, "reviewed-comparison.json", {"comparison": comparison, "note": input_value["correctionNote"],
                                          "actor": actor, "requestId": _request(operation_id, "corrected:save-plan")})
    second["review"]["comparisonSha256"] = comparison["sha256"]
    ready = cartography.preview(workspace, second)
    model.require(ready["ready"], "PUBLICATION_JOURNEY_REVIEW",
                  "Complete the reviewed correction before native publication.", issues=ready["issues"])
    second_plan = _saved_plan(workspace, root, operation_id, "corrected", actor, second)
    second_publication = _render(workspace, root, operation_id, "corrected", actor, second_plan, progress)

    publications = [_outputs(workspace, row["id"]) for row in (first_publication, second_publication)]
    native_reopen = [cartography.reopen_publications(
        workspace, publication_id=row["publication"]["id"], progress=progress) for row in publications]
    after = workspace.snapshot()
    retained = {
        "schema": "starforge.migration-publication-journey-result.v1", "status": "complete",
        "operationId": operation_id, "inputSha256": model.value_sha(input_value),
        "workspaceId": after["state"]["id"], "revision": after["state"]["revision"],
        "snapshotSha256": model.value_sha(after), "native": qgis_project.native_version(),
        "selectedProjectIds": [first["projectId"], second["projectId"]],
        "sourcePreservation": _preserved(before, after),
        "comparison": comparison, "reviewNote": input_value["correctionNote"],
        "publications": publications, "nativeReopen": native_reopen,
        "receivingSoftwareId": second_publication["softwareId"],
        "completedAt": model.utc_now(),
    }
    _keep(root, "result.json", retained)
    return {**retained, "replayed": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--input", required=True, help="Original two-project publication configuration.")
    parser.add_argument("--out", required=True, help="Original publication output directory outside the workspace.")
    args = parser.parse_args(argv)
    request = native_files.parse_json(Path(args.input).read_bytes())
    model.require(isinstance(request, dict), "PUBLICATION_JOURNEY_CONFIGURATION",
                  "Use the complete original publication configuration.")
    workspace = Workspace(args.workspace)
    def progress(value):
        print(native_files.canonical(value), file=sys.stderr, flush=True)
    result = publish_original_projects(
        workspace, args.out, operation_id=request["operationId"], actor=request["actor"],
        baseline=request["baseline"], corrected=request["corrected"],
        correction_note=request["correctionNote"], progress=progress)
    print(json.dumps({"status": result["status"], "operationId": result["operationId"],
                      "workspaceId": result["workspaceId"], "revision": result["revision"],
                      "publicationIds": [row["publication"]["id"] for row in result["publications"]],
                      "result": str(Path(args.out).expanduser().absolute() / "result.json"),
                      "receivingSoftwareId": result["receivingSoftwareId"],
                      "replayed": result["replayed"]}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
