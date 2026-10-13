#!/usr/bin/env python3
"""Receive saved source-review decisions through the original queue and uploads."""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys
import time


def receive(application, workspace, state_directory, *, review_id=None, decisions_path=None, timeout=240):
    application, workspace = Path(application).resolve(), Path(workspace).resolve()
    state_directory = Path(state_directory).resolve()
    state_directory.mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import Operator, Fault
    from gis_review_decisions import GISReviewDecisions
    from model import gis_project as gis, gis_vector_review, gis_review_decisions
    from model.common import atomic_json, digest

    operator = Operator(workspace, state_directory)
    journal_path = state_directory / "source-review-decisions-receiving.json"
    try:
        key, feature = operator.primary, GISReviewDecisions(operator, Fault)
        ws = operator.ws(key)
        retained = json.loads(journal_path.read_text(encoding="utf-8")) if journal_path.is_file() else None
        if retained:
            selected = retained["identity"]["review_id"]
            if review_id is not None and review_id != selected:
                raise ValueError("Use the retained original review or a separate receiving state.")
            review_id = selected
        if not review_id:
            choices = gis_vector_review.catalog(ws)
            if not choices:
                raise ValueError("Complete the original-source GIS vector review before receiving decisions.")
            review_id = choices[0]["id"]
        ref = gis_review_decisions.reference(ws, review_id)
        identity = {"project_id": ws.project["id"], "review_id": review_id,
                    "comparison_sha256": ref["comparison_sha256"],
                    "receiving_version": "source-review-decisions-v1"}
        if retained:
            if retained.get("identity") != identity:
                raise ValueError("The receiving journal belongs to another original comparison.")
            receipt = retained
        else:
            receipt = {"schema": "upstate.gis-review-decisions-receiving/v1",
                       "identity": identity, "phases": {}}
            atomic_json(journal_path, receipt)

        if decisions_path:
            requested = json.loads(Path(decisions_path).read_text(encoding="utf-8"))
            if requested.get("review_id") != review_id:
                raise ValueError("The requested decisions belong to another original review.")
            original_payload = requested
        elif receipt.get("original_payload"):
            original_payload = receipt["original_payload"]
        else:
            selected = next((row for row in ref["rows"]
                             if row["comparison"]["status"] != "layer_definition"), ref["rows"][0])
            original_payload = {"review_id": review_id, "previous_id": None,
                "title": "Source review receiving", "reviewer": "",
                "decisions": [{"key": selected["key"], "disposition": "unreviewed",
                    "note": "Original comparison opened for source transfer and review.\n"
                            "This note records receiving continuity; the review disposition remains open."}]}
        if receipt.get("original_payload", original_payload) != original_payload:
            raise ValueError("The retained receiving request changed. Preserve it and use another state for new decisions.")
        receipt["original_payload"] = deepcopy(original_payload)
        atomic_json(journal_path, receipt)

        def complete(phase, action, payload):
            request = {"workspace": key, "action": action, "payload": payload}
            operation = "eco264b-decisions-" + digest(identity)[:16] + "-" + phase
            previous = receipt["phases"].get(phase)
            if previous:
                if previous["request"] != request:
                    raise ValueError("The original decision operation changed selection.")
                task = operator.task(previous["task_id"])
            else:
                task = operator.submit(key, action, payload, operation)
                if any(task.get(name) != value for name, value in request.items()):
                    raise ValueError("The native queue returned another original decision request.")
                receipt["phases"][phase] = {"request": request, "task_id": task["id"],
                                            "operation_id": task["operation_id"]}
                atomic_json(journal_path, receipt)
            if (any(task.get(name) != value for name, value in request.items())
                    or task["operation_id"] != receipt["phases"][phase]["operation_id"]):
                raise ValueError("The retained native task changed its accepted original identity.")
            if task["state"] in {"failed", "cancelled", "interrupted"}:
                task = operator.resume(task["id"])
            deadline = time.monotonic() + timeout
            while task["state"] in {"queued", "running"}:
                if time.monotonic() >= deadline:
                    raise TimeoutError("The original review operation remains active: " + task["id"])
                time.sleep(.1)
                task = operator.task(task["id"])
            if task["state"] != "complete":
                raise RuntimeError(json.dumps(task, ensure_ascii=False))
            receipt["phases"][phase]["result_id"] = task["result"]["id"]
            atomic_json(journal_path, receipt)
            return task

        def opened(task):
            value = feature.read(key, "inspect", {"id": task["result"]["id"]})
            if value["comparison_sha256"] != identity["comparison_sha256"]:
                raise AssertionError("The retained decision result changed its scientific comparison.")
            return value

        def upload_ticket(value, filename):
            candidates = [row for row in value["_downloads"] if row["filename"] == filename]
            if len(candidates) != 1:
                raise AssertionError("The complete native review download is missing: " + filename)
            ticket = candidates[0]
            stream, _ = operator.open_download(ticket["id"])
            try:
                upload = operator.receive_upload(stream, ticket["bytes"], ticket["filename"],
                                                  "application/zip" if filename.endswith(".zip") else "application/json")
            finally:
                stream.close()
            if (upload["bytes"], upload["sha256"]) != (ticket["bytes"], ticket["sha256"]):
                raise AssertionError("The original review upload differs from its native download.")
            return upload, ticket

        saved = opened(complete("save", "gis.review.decisions.save", original_payload))
        normal = gis_review_decisions.normalize_decisions(original_payload["decisions"], ref)
        if saved["decisions"] != normal:
            raise AssertionError("Saving changed the original review notes or dispositions.")
        selected_rows = [row for row in ref["rows"] if row["key"] in {item["key"] for item in normal}]
        feature_rows = []
        for row in selected_rows:
            value = feature.read(key, "feature", {"review_id": review_id, "key": row["key"]})
            if value["comparison"] != row["comparison"]:
                raise AssertionError("The selected native feature changed its retained finding.")
            feature_rows.append({"key": row["key"],
                "original_feature_ids": [item["feature_id"] for item in value["original"]],
                "working_feature_ids": [item["feature_id"] for item in value["working"]]})

        zipped, ticket = upload_ticket(saved, "review-decisions.zip")
        preview = feature.read(key, "receive-preview", {"review_id": review_id, "upload_id": zipped["id"]})
        if preview["comparison_sha256"] != ref["comparison_sha256"] or preview["counts"] != saved["counts"]:
            raise AssertionError("The complete ZIP preview changed the saved review.")
        imported = opened(complete("receive-zip", "gis.review.decisions.receive",
                                   {"review_id": review_id, "previous_id": saved["id"], "upload_id": zipped["id"]}))
        if (imported["decisions"] != saved["decisions"]
                or imported["previous_id"] != saved["id"]
                or imported["imported_from"]["declared_origin"] != saved["document"]["origin"]):
            raise AssertionError("The received review did not preserve its decisions, predecessor and declared origin.")

        # Receive the exact separately editable JSON too. This uses the original
        # native upload identity, not an invented file inside the scientific registry.
        json_upload, _ = upload_ticket(saved, "decisions.json")
        imported_json = opened(complete("receive-json", "gis.review.decisions.receive",
            {"review_id": review_id, "previous_id": imported["id"], "upload_id": json_upload["id"]}))
        if (imported_json["decisions"] != saved["decisions"]
                or imported_json["previous_id"] != imported["id"]
                or imported_json["imported_from"]["format"] != "json"):
            raise AssertionError("The received editable JSON changed its original decision content.")

        final_view = feature.read(key, "view", {"review_id": review_id, "snapshot_id": imported_json["id"]})
        if not {saved["id"], imported["id"], imported_json["id"]}.issubset(
                {row["id"] for row in final_view["revisions"]}):
            raise AssertionError("The native review desk omitted a retained decision revision.")
        source_identity = gis_review_decisions.reference(ws, review_id)["comparison_sha256"]
        if source_identity != identity["comparison_sha256"]:
            raise AssertionError("Decision receiving changed the original scientific source comparison.")
        result = {"schema": "upstate.gis-review-decisions-receiving-result/v1",
                  "identity": identity, "workspace_key": key, "status": "native_course_complete",
                  "saved_id": saved["id"], "zip_received_id": imported["id"],
                  "json_received_id": imported_json["id"], "selected_features": feature_rows,
                  "counts": saved["counts"], "archive": ticket, "phases": deepcopy(receipt["phases"]),
                  "visual_review": "producer_inspection_required"}
    finally:
        operator.close()

    operator = Operator(workspace, state_directory)
    try:
        key, feature = operator.primary, GISReviewDecisions(operator, Fault)
        if operator.ws(key).project["id"] != identity["project_id"]:
            raise AssertionError("Restart opened another original project.")
        reopened = feature.read(key, "view", {"review_id": review_id, "snapshot_id": result["json_received_id"]})
        if reopened["snapshot"]["decisions"] != normal:
            raise AssertionError("Restart changed the literal review decisions.")
        for phase in receipt["phases"].values():
            task = operator.task(phase["task_id"])
            if (task["operation_id"] != phase["operation_id"] or task["result"]["id"] != phase["result_id"]
                    or task["state"] != "complete"):
                raise AssertionError("Restart changed an original native review operation.")
            decorated = operator.task_view(task["id"])
            if not decorated.get("_downloads"):
                raise AssertionError("Restart omitted the completed review downloads.")
        original = feature.read(key, "inspect", {"id": result["saved_id"]})
        current_ticket = next(row for row in original["_downloads"] if row["filename"] == "review-decisions.zip")
        if (current_ticket["bytes"], current_ticket["sha256"]) != (result["archive"]["bytes"], result["archive"]["sha256"]):
            raise AssertionError("Restart changed the exact original review archive.")
        stream, _ = operator.open_download(current_ticket["id"])
        stream.close()
        result["restart_same_decisions"] = True
        result["restart_original_download"] = True
        result["workspace_key"] = key
        atomic_json(state_directory / "source-review-decisions-receiving-result.json", result)
        return result
    finally:
        operator.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--review-id")
    parser.add_argument("--decisions", type=Path)
    parser.add_argument("--timeout", type=float, default=240)
    args = parser.parse_args()
    print(json.dumps(receive(args.application, args.workspace, args.state_directory,
        review_id=args.review_id, decisions_path=args.decisions, timeout=args.timeout),
        ensure_ascii=False, indent=2))
