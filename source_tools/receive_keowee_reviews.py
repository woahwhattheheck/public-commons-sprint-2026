"""One original-source receiving exercise for the reconciliation integration."""
from __future__ import annotations
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--application", type=Path, required=True, help="Installed original Upper Savannah application")
parser.add_argument("--addon", type=Path, required=True, help="Decoded addon root, or the same installed application")
parser.add_argument("--manifest", type=Path, required=True, help="Retained Keowee 1.0.2 source manifest")
parser.add_argument("--output-root", type=Path, required=True, help="Writable parent directory for this receiving exercise")
args = parser.parse_args()
APP, ADDON, MANIFEST = args.application.resolve(), args.addon.resolve(), args.manifest.resolve()
if not (APP / "model/workspace.py").is_file():
    parser.error("--application must select the installed original Upper Savannah application")
if not (ADDON / "model/review_reconciliation.py").is_file():
    parser.error("--addon must select the decoded five-file reconciliation source")
if not MANIFEST.is_file():
    parser.error("--manifest must select the retained Keowee 1.0.2 source manifest")
SESSION = args.output_root.resolve() / ("reconciliation-journey-" + str(time.time_ns()))
SESSION.mkdir(parents=True)
sys.path.insert(0, str(APP))
from model.workspace import Workspace
from model import reviews, portable
from model.common import digest, now

source = ADDON / "model/review_reconciliation.py"
target = APP / "model/review_reconciliation.py"
assert hashlib.sha256(source.read_bytes()).hexdigest() == "a23ece98705be91e0d5ee5a0520901e97976df45361da03d0f5eb3e274e6e55e"
if source.resolve() != target.resolve():
    shutil.copyfile(source, target)
from model import review_reconciliation as reconciliation

started = now()
evidence = {"started_at": started, "session": str(SESSION), "source_manifest": str(MANIFEST), "keowee_source_carrier": "F0C8SABPBK3", "reconciliation_source_carrier": "F0C88TDJ8H5", "application": str(APP), "addon": str(ADDON)}
def checkpoint(name, **data):
    evidence[name] = data
    (SESSION / "receiving-result.json").write_text(json.dumps(evidence, indent=2, ensure_ascii=False, default=str) + "\n")
    print(json.dumps({"phase": name, **{key: value for key, value in data.items() if value is None or isinstance(value, (str, int, float, bool))}}, ensure_ascii=False, default=str), flush=True)
def ident(name):
    return digest({"exercise": str(SESSION), "operation": name})
def author(name):
    return {"name": name, "role": "Internal receiving exercise", "organization": "Commons"}
def write_response(name, value):
    path = SESSION / name
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path

ws = Workspace(SESSION / "workspace", create=True, title="Keowee source review receiving")
collection = ws.import_sources(MANIFEST)
review = reviews.create_review(ws, {
    "schema": reviews.SELECTION_SCHEMA,
    "title": "Keowee source and method review",
    "purpose": "Exercise retained source decisions and reconciliation against the original Keowee source and method artifacts.",
    "source_collection_ids": [collection["id"]],
    "requirements": [
        {"id": "source.original", "title": "Original source files", "detail": "The returned review keeps the exact selected source artifacts and identifiers."},
        {"id": "method.definition", "title": "Method definitions", "detail": "The receiving history retains questions and corrections to the selected method documents."},
    ],
}, created_at=started)
assert len(review["artifacts"]) >= 2
checkpoint("original_source_review", project_id=ws.project["id"], source_collection_id=collection["id"], review_id=review["id"], artifacts=len(review["artifacts"]), requirements=len(review["requirements"]))

base = reviews.response_template(ws, review["id"])
base["reviewer"] = author("Initial internal source reviewer")
base["created_at"] = now()
for row in base["artifact_decisions"] + base["requirement_decisions"]:
    row["decision"] = "accepted"
base = reviews._checked_response(base, review)
artifact_id = base["artifact_decisions"][0]["artifact_id"]
second_artifact = base["artifact_decisions"][1]["artifact_id"]
base["corrections"] = [{
    "id": "method.note", "title": "Clarify method labels", "description": "Retain the source-specific explanation beside the method.",
    "artifact_ids": [artifact_id], "requirement_ids": ["method.definition"],
    "assignee": "", "priority": "normal", "state": "open", "resolution": "",
}]
base_record = reviews.import_response(ws, base)
base = base_record["response"]
current = copy.deepcopy(base)
returned = copy.deepcopy(base)
for value, person in ((current, "Current internal reviewer"), (returned, "Returned internal reviewer")):
    value["previous_response_id"] = base_record["id"]
    value["reviewer"] = author(person)
    value["created_at"] = now()
current["summary"] = "Current source observations."
returned["summary"] = "Returned method observations."
current["artifact_decisions"][0]["comment"] = "Current source explanation."
current["artifact_decisions"][0]["assignee"] = "Source method owner"
returned["artifact_decisions"][0]["comment"] = "Returned source explanation."
returned["artifact_decisions"][0]["decision"] = "changes-requested"
returned["artifact_decisions"][0]["requested_change"] = "Clarify the selected method definition."
returned["artifact_decisions"][1]["comment"] = "Second original file reviewed."
next(row for row in current["requirement_decisions"] if row["requirement_id"] == "source.original")["comment"] = "Exact original file identity retained."
next(row for row in returned["requirement_decisions"] if row["requirement_id"] == "method.definition")["comment"] = "Method wording reviewed."
current["corrections"][0]["assignee"] = "Scientific reviewer"
returned["corrections"][0]["priority"] = "high"
returned["disposition"] = "changes-requested"
current_record = reviews.import_response(ws, current)
original = write_response("returned-response.json", returned)
draft = reconciliation.stage_response(ws, returned, operation_id=ident("stage"), created_at=now(), source_path=original)
assert Path(draft["original_file"]["path"]).read_bytes() == original.read_bytes()
old_plan = reconciliation.preview_response(ws, returned, expected_response_id=current_record["id"])
assert old_plan["mode"] == "reconcile"
conflict = next(row for row in old_plan["conflicts"] if row["section"] == "artifact_decisions")
assert conflict["conflicting_fields"] == ["comment"]
assert conflict["proposed"]["assignee"] == "Source method owner"
assert conflict["proposed"]["decision"] == "changes-requested"
checkpoint("comparison", draft_id=draft["draft_id"], plan_id=old_plan["id"], conflicting_keys=[row["key"] for row in old_plan["conflicts"]], automatic_changes=len(old_plan["automatic_changes"]), original_sha256=hashlib.sha256(original.read_bytes()).hexdigest())

moving = reviews.response_template(ws, review["id"])
moving["reviewer"] = author("Concurrent internal reviewer")
moving["requirement_decisions"][0]["assignee"] = "Document owner"
moving_record = reviews.import_response(ws, moving)
def choices_for(plan):
    return {row["key"]: {"choice": "edit", "value": "Combined source and method observations."} if row["section"] == "summary" else {"choice": "returned"} for row in plan["conflicts"]}
try:
    reconciliation.commit_response(ws, returned, plan_id=old_plan["id"], expected_response_id=current_record["id"],
        choices=choices_for(old_plan), reviewer=author("Reconciliation operator"), operation_id=ident("head-race"),
        created_at=now(), source_path=original)
except reconciliation.ReconciliationError as error:
    assert error.code == "REVIEW_HEAD_CHANGED"
else:
    raise AssertionError("Changed current head was not reported")
assert Path(draft["original_file"]["path"]).read_bytes() == original.read_bytes()
plan = reconciliation.preview_response(ws, returned, expected_response_id=moving_record["id"])
arguments = dict(plan_id=plan["id"], expected_response_id=moving_record["id"], choices=choices_for(plan),
    reviewer=author("Reconciliation operator"), operation_id=ident("commit"), created_at=now(),
    source_path=original, note="Original internal receiving exercise; preserve both independent source and method edits.")
result = reconciliation.commit_response(ws, returned, **arguments)
candidate = result["record"]["response"]
assert candidate["reviewer"]["name"] == "Reconciliation operator"
assert candidate["previous_response_id"] == moving_record["id"]
assert {row["artifact_id"] for row in candidate["artifact_decisions"]} == {row["id"] for row in review["artifacts"]}
assert {row["requirement_id"] for row in candidate["requirement_decisions"]} == {row["id"] for row in review["requirements"]}
selected = next(row for row in candidate["artifact_decisions"] if row["artifact_id"] == artifact_id)
assert selected["comment"] == "Returned source explanation."
assert selected["assignee"] == "Source method owner"
assert selected["decision"] == "changes-requested"
assert candidate["corrections"][0]["assignee"] == "Scientific reviewer"
assert candidate["corrections"][0]["priority"] == "high"
assert candidate["corrections"][0]["artifact_ids"] == [artifact_id]
assert Path(result["original_file"]["path"]).read_bytes() == original.read_bytes()
chain = reviews.history(ws, review["id"])
assert len(chain) == 4
again = reconciliation.commit_response(ws, returned, **arguments)
assert again["response_id"] == result["response_id"] and len(reviews.history(ws, review["id"])) == 4
completed = Path(result["completed_file"]["path"])
completed_before = completed.read_bytes()
completed.unlink()
recovered = reconciliation.commit_response(ws, returned, **arguments)
assert recovered["response_id"] == result["response_id"] and completed.read_bytes() == completed_before
assert len(reviews.history(ws, review["id"])) == 4
checkpoint("native_commit_and_recovery", response_id=result["response_id"], predecessor=moving_record["id"], original_history_entries=4, reconciler=candidate["reviewer"], duplicate_task_reused=True, import_without_receipt_recovered=True)

older_original = write_response("older-retained-response.json", current)
older = reconciliation.stage_response(ws, current, operation_id=ident("older-stage"), created_at=now(), source_path=older_original)
older_plan = reconciliation.preview_response(ws, current)
assert older_plan["mode"] == "already-retained" and older_plan["conflicts"] == []
older_result = reconciliation.commit_response(ws, current, plan_id=older_plan["id"],
    expected_response_id=result["response_id"], choices={}, reviewer=None,
    operation_id=ident("older-commit"), created_at=now(), source_path=older_original)
assert older_result["response_id"] == current_record["id"]
assert len(reviews.history(ws, review["id"])) == 4
checkpoint("older_duplicate", response_id=older_result["response_id"], conflicts=0, original_reviewer=older_result["record"]["response"]["reviewer"])

export = reviews.export_review(ws, review["id"], SESSION / "review-export")
packet = reviews.inspect_packet(SESSION / "review-export")
backup = portable.backup(ws, SESSION / "working-project.zip")
received = portable.restore(SESSION / "working-project.zip", SESSION / "reopened-project")
reopened = Workspace(SESSION / "reopened-project/workspace")
verified = reconciliation.verify_all(reopened)
restored_history = reviews.history(reopened, review["id"])
assert restored_history == reviews.history(ws, review["id"])
reopened_draft = reconciliation.read_draft(reopened, draft["draft_id"])
assert Path(reopened_draft["original_file"]["path"]).read_bytes() == original.read_bytes()
restored_packet = reviews.show_review(reopened, review["id"], previews=False)
assert restored_packet["files"] == reviews.show_review(ws, review["id"], previews=False)["files"]
assert (SESSION / "reopened-project/application/model/review_reconciliation.py").read_bytes() == source.read_bytes()
checkpoint("backup_reopen", backup=backup, receiving=received, reconciliation=verified, restored_history_entries=len(restored_history), retained_artifacts=len(restored_packet["files"]), original_bytes_preserved=True, application_source_preserved=True)
checkpoint("complete", completed_at=now(), export=export, source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(), free_bytes=os.statvfs(SESSION).f_bavail*os.statvfs(SESSION).f_frsize)
