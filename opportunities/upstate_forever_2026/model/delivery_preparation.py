"""Named delivery preparations and exact original delivery-build receiving.

Draft saves retain complete selections without running GIS. Builds delegate to the
maintained delivery engine after freezing its original source/application binding.
All journal publications share Workspace's lock; no delivery/backup is called
while that lock is held. Original operator task context travels with the workspace.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import stat
import uuid

from .common import atomic_json, canonical, digest, held, now, verify_file

SCHEMA = "upstate.delivery-preparation/v1"
OP_SCHEMA = "upstate.delivery-preparation-operation/v1"
SNAPSHOT_SCHEMA = "upstate.delivery-preparation-sources/v1"
MAX_SELECTION_BYTES = 4 * 1024 * 1024
MAX_RECORD_BYTES = 32 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024
SAVE = "delivery.preparation.save"
BUILD = "delivery.preparation.build"


class PreparationError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def _need(condition, code, message):
    if not condition:
        raise PreparationError(code, message)


def _copy(value):
    # JSON round-trip rejects non-finite values and detaches all caller objects.
    return json.loads(canonical(value))


def _text(value, name, maximum=10000, empty=False):
    _need(isinstance(value, str) and len(value) <= maximum and (empty or value.strip()),
          "PREPARATION_INVALID", "Supply " + name)
    return value


def _uuid(value):
    _text(value, "an original preparation UUID", 36)
    try:
        normalized = str(uuid.UUID(value))
    except (ValueError, AttributeError):
        raise PreparationError("PREPARATION_INVALID", "Supply a canonical preparation UUID") from None
    _need(normalized == value, "PREPARATION_INVALID", "Use the original canonical preparation UUID")
    return value


def _integer(value, name, minimum=0, maximum=1000000000):
    _need(type(value) is int and minimum <= value <= maximum,
          "PREPARATION_INVALID", "Supply a valid " + name)
    return value


def _timestamp(value):
    from datetime import datetime
    _text(value, "original operation time", 64)
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise PreparationError("PREPARATION_INVALID", "Supply an ISO operation time") from None
    _need(parsed.tzinfo is not None, "PREPARATION_INVALID", "Operation time needs its UTC offset")
    return value


def _request(value, action):
    _need(isinstance(value, dict), "PREPARATION_INVALID", "Supply the complete preparation request")
    value = _copy(value)
    wanted = {"preparation_id", "revision"} if action == BUILD else {
        "preparation_id", "expected_revision", "title", "purpose", "selection"}
    _need(set(value) == wanted, "PREPARATION_INVALID", "Retain exactly the documented preparation request fields")
    _uuid(value["preparation_id"])
    if action == BUILD:
        _integer(value["revision"], "saved revision", 1)
    else:
        _integer(value["expected_revision"], "expected revision")
        _text(value["title"], "a preparation title", 500)
        _text(value["purpose"], "preparation purpose", 20000, empty=True)
        _need(isinstance(value["selection"], dict), "PREPARATION_INVALID", "Retain the complete delivery selection object")
        _need(len(canonical(value["selection"])) <= MAX_SELECTION_BYTES,
              "PREPARATION_TOO_LARGE", "Delivery selection exceeds 4 MiB")
    return value


def _read(path):
    info = path.lstat()
    _need(stat.S_ISREG(info.st_mode) and info.st_size <= MAX_RECORD_BYTES,
          "PREPARATION_INTEGRITY", "Retain a bounded ordinary preparation record")
    raw = path.read_bytes()
    _need(len(raw) == info.st_size, "PREPARATION_INTEGRITY", "Preparation record changed while reading")
    def invalid(value):
        raise PreparationError("PREPARATION_INTEGRITY", "Nonfinite retained JSON: " + value)
    return json.loads(raw, parse_constant=invalid)


def _origin(context, operation_id, action, request, project_id):
    if context is None:
        return None
    _need(isinstance(context, dict), "PREPARATION_INVALID", "Supply the original task context")
    value = _copy(context)
    required = {"task_id", "operation_id", "workspace", "action", "payload", "request_sha256"}
    _need(required <= set(value), "PREPARATION_INVALID", "Retain the complete original task context")
    _need(value["task_id"] == operation_id and value["action"] == action
          and digest(value["payload"]) == digest(request),
          "PREPARATION_IDENTITY", "Original task differs from this preparation operation")
    _text(value["operation_id"], "original operator UUID", 100)
    _text(value["workspace"], "original logical workspace", 10000)
    _need(digest({key: value[key] for key in ("workspace", "action", "payload")}) == value["request_sha256"],
          "PREPARATION_IDENTITY", "Original task request hash differs")
    _need(value.get("project_id", project_id) == project_id,
          "PREPARATION_IDENTITY", "Original task belongs to another project")
    value["project_id"] = project_id
    return value


# Only metadata is read here. Binary sources and GIS output hashes remain with the
# original strict delivery preparation at build time. Unknown extension fields
# stay in the complete selection; the engine remains their semantic authority.
_RECORDS = {
    "source_collection_id": ("sources", None), "collection_id": ("sources", None),
    "baseline_run_id": ("runs", "run.json"), "run_id": ("runs", "run.json"),
    "scenario_run_ids": ("runs", "run.json"), "source_run_ids": ("runs", "run.json"),
    "profile_id": ("profiles", None), "scenario_id": ("scenarios", None),
    "grid_id": ("grids", "grid.json"), "spatial_review_ids": ("spatial-reviews", None),
    "spatial_export_ids": ("spatial-exports", "export.json"),
    "observation_comparison_ids": ("observation-comparisons", None),
    "observation_id": ("observations", None),
    "source_report_id": ("scenario-decisions", "decision.json"),
    "source_scenario_analysis_id": ("analyses", "summary.json"),
    "economic_edition_id": ("economic-editions", "edition.json"),
    "evidence_id": ("biophysical-evidence", None),
    "evidence_ids": ("biophysical-evidence", None),
}


def source_snapshot(workspace, selection):
    records, missing, issues, visited = {}, {}, [], set()
    total = 0

    def issue(code, message):
        entry = {"code": code, "message": message}
        if entry not in issues:
            issues.append(entry)

    def take(folder, key, filename):
        nonlocal total
        if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{64}", key):
            issue("SOURCE_ID_INCOMPLETE", "Choose a saved " + folder + " item")
            return None
        relative = folder + "/" + key + ("/" + filename if filename else ".json")
        if relative in visited:
            return records.get(relative, {}).get("record")
        visited.add(relative)
        path = workspace.root / relative
        try:
            info = path.lstat()
        except FileNotFoundError:
            missing[relative] = {"path": relative, "id": key}
            issue("SOURCE_MISSING", "Selected metadata is not yet retained: " + relative)
            return None
        _need(stat.S_ISREG(info.st_mode) and info.st_size <= MAX_SNAPSHOT_BYTES,
              "PREPARATION_INTEGRITY", "Selected source metadata must be an ordinary bounded file")
        raw = path.read_bytes()
        _need(len(raw) == info.st_size, "PREPARATION_INTEGRITY", "Selected metadata changed during read")
        total += len(raw)
        _need(total <= MAX_SNAPSHOT_BYTES, "PREPARATION_TOO_LARGE", "Selected metadata exceeds 24 MiB")
        text = raw.decode("utf-8")
        body = json.loads(text)
        canonical(body)
        records[relative] = {"path": relative, "id": key, "bytes": len(raw),
                             "sha256": hashlib.sha256(raw).hexdigest(), "text": text,
                             "record": body}
        if folder in ("runs", "grids", "spatial-exports") and body.get("state") != "complete":
            issue("SOURCE_NOT_COMPLETE", "Complete the selected " + folder + " item: " + key)
        # Follow original native selection/spec metadata, not unrelated history.
        if folder in ("runs", "grids", "analyses", "economic-editions", "scenario-decisions"):
            for field in ("selection", "spec", "input"):
                if isinstance(body.get(field), dict):
                    walk(body[field])
        if folder == "spatial-exports" and body.get("review_id"):
            take("spatial-reviews", body["review_id"], None)
        return body

    def walk(value):
        if isinstance(value, list):
            for child in value:
                walk(child)
        elif isinstance(value, dict):
            for field, child in value.items():
                if field in _RECORDS and child not in (None, "", []):
                    folder, filename = _RECORDS[field]
                    for key in child if isinstance(child, list) else [child]:
                        # Native Decision run IDs use run_... and are retained
                        # separately below, never mistaken for a native GIS run.
                        if field == "run_id" and isinstance(key, str) and key.startswith("run_"):
                            continue
                        take(folder, key, filename)
                if isinstance(child, (dict, list)):
                    walk(child)
            collection_id = value.get("source_collection_id")
            source_id = value.get("source_id")
            if collection_id and source_id:
                collection = take("sources", collection_id, None)
                if collection and not any(row.get("id") == source_id for row in collection.get("entries", [])):
                    issue("SOURCE_MEMBER_MISSING", "Select an original source member in collection " + collection_id)

    walk(selection)
    decision = selection.get("source_decision")
    selected_decision = None
    if isinstance(decision, dict) and decision:
        # Reuse the original read-only, revision-bound Decision reader. It does
        # not start a model or verify raster files.
        try:
            from .robust_decisions.eco_robust.decision_delivery import _load
            selected_decision = _load(workspace, decision.get("study_id"), decision.get("run_id"))
        except (ValueError, FileNotFoundError, KeyError, sqlite3.Error) as error:
            issue("DECISION_NOT_READY", str(error))
    if not selection.get("baseline_run_id"):
        issue("BASELINE_REQUIRED", "Choose the original completed baseline run")
    if not selection.get("scenario_run_ids"):
        issue("SCENARIOS_REQUIRED", "Choose the original completed future land-cover runs")
    contact = selection.get("contact")
    if not isinstance(contact, dict):
        issue("CONTACT_REQUIRED", "Retain the responsible contact or native-study contact selection")
    if isinstance(contact, dict) and not selection.get("native_study"):
        for name in ("name", "organization", "email"):
            if not isinstance(contact.get(name), str) or not contact[name].strip():
                issue("CONTACT_REQUIRED", "Complete the responsible contact " + name)
    baseline = next((row["record"] for path, row in records.items()
                     if path == "runs/" + str(selection.get("baseline_run_id")) + "/run.json"), None)
    if baseline:
        original = baseline.get("selection", {})
        scenario = records.get("scenarios/" + str(original.get("scenario_id")) + ".json", {}).get("record", {})
        if scenario and scenario.get("kind") != "baseline":
            issue("BASELINE_KIND", "The current-export run must use an original baseline scenario")
        for key in selection.get("scenario_run_ids", []) if isinstance(selection.get("scenario_run_ids"), list) else []:
            run = records.get("runs/" + str(key) + "/run.json", {}).get("record")
            if run:
                choice = run.get("selection", {})
                if any(choice.get(name) != original.get(name) for name in ("grid_id", "profile_id")):
                    issue("RUN_CONTEXT_DIFFERENT", "Future runs must share the baseline grid and profile")
                future = records.get("scenarios/" + str(choice.get("scenario_id")) + ".json", {}).get("record", {})
                if future and future.get("kind") != "landcover":
                    issue("SCENARIO_KIND", "Future maps require explicit land-cover alternatives")
    payload = {"schema": SNAPSHOT_SCHEMA, "project_id": workspace.project["id"],
               "selection_sha256": digest(selection), "records": [records[k] for k in sorted(records)],
               "missing": [missing[k] for k in sorted(missing)], "decision": selected_decision,
               "issues": issues, "verification": "selected-metadata-only"}
    _need(len(canonical(payload)) <= MAX_RECORD_BYTES - MAX_SELECTION_BYTES,
          "PREPARATION_TOO_LARGE", "Complete selected source snapshot exceeds its retained bound")
    return {**payload, "sha256": digest(payload)}


def _check_snapshot(value, project_id, selection):
    _need(isinstance(value, dict), "PREPARATION_INTEGRITY", "Missing preparation source snapshot")
    payload = {key: item for key, item in value.items() if key != "sha256"}
    _need(value.get("sha256") == digest(payload) and value.get("schema") == SNAPSHOT_SCHEMA
          and value.get("project_id") == project_id and value.get("selection_sha256") == digest(selection),
          "PREPARATION_INTEGRITY", "Preparation source snapshot changed")
    paths = set()
    for row in value["records"]:
        path = row["path"]
        _need(isinstance(path, str) and path not in paths and not path.startswith("/")
              and all(part not in ("", ".", "..") for part in path.split("/")),
              "PREPARATION_INTEGRITY", "Preparation source snapshot repeats or escapes a path")
        paths.add(path)
        raw = row["text"].encode("utf-8")
        _need(row["bytes"] == len(raw) and row["sha256"] == hashlib.sha256(raw).hexdigest()
              and row["record"] == json.loads(raw), "PREPARATION_INTEGRITY",
              "Retained original source metadata differs")


class DeliveryPreparations:
    def __init__(self, workspace):
        self.workspace = workspace
        self.root = workspace.root
        self.project_id = workspace.project["id"]
        self.records = self.root / "delivery-preparations"
        self.operations = self.root / "delivery-preparation-operations"

    def _base(self, **values):
        return {"schema": SCHEMA, "project_id": self.project_id, **values}

    def _opdir(self, operation_id):
        _text(operation_id, "an original operation ID", 200)
        return self.operations / digest(operation_id)

    def _revisions(self, preparation_id):
        key = _uuid(preparation_id)
        rows, previous = [], None
        for index, path in enumerate(sorted((self.records / key / "revisions").glob("*.json")), 1):
            _need(path.name == "%012d.json" % index, "PREPARATION_INTEGRITY",
                  "Preparation revision history is not contiguous")
            value = _read(path)
            payload = {name: item for name, item in value.items() if name != "revision_id"}
            _need(value.get("schema") == SCHEMA and value.get("project_id") == self.project_id
                  and value.get("id") == key and value.get("revision") == index
                  and value.get("previous_revision_id") == previous
                  and value.get("revision_id") == digest(payload), "PREPARATION_INTEGRITY",
                  "Preparation revision or original lineage changed")
            _request({"preparation_id": key, "expected_revision": index - 1,
                      **{name: value[name] for name in ("title", "purpose", "selection")}}, SAVE)
            _check_snapshot(value["source_snapshot"], self.project_id, value["selection"])
            _timestamp(value["created_at"])
            rows.append(value)
            previous = value["revision_id"]
        return rows

    def _selected(self, preparation_id, revision=None):
        rows = self._revisions(preparation_id)
        _need(bool(rows), "PREPARATION_NOT_FOUND", "Open a retained named preparation")
        if revision is None:
            return rows[-1], rows
        _integer(revision, "saved revision", 1)
        _need(revision <= len(rows), "PREPARATION_NOT_FOUND", "Open an actual saved preparation revision")
        return rows[revision - 1], rows

    def _intent(self, directory):
        path = directory / "intent.json"
        if not path.exists():
            return None
        value = _read(path)
        _need(value.get("schema") == OP_SCHEMA and value.get("project_id") == self.project_id
              and directory.name == digest(value["operation_id"]), "PREPARATION_INTEGRITY",
              "Preparation operation belongs to a different project or original ID")
        request = _request(value["request"], value["action"])
        _need(value["action"] in (SAVE, BUILD) and value["request_sha256"] == digest(request),
              "PREPARATION_INTEGRITY", "Preparation operation request changed")
        _timestamp(value["created_at"])
        _origin(value.get("origin"), value["operation_id"], value["action"], request, self.project_id)
        return value

    def _ensure_intent(self, directory, action, request, operation_id, created_at, context, **extra):
        previous = self._intent(directory)
        origin = _origin(context, operation_id, action, request, self.project_id)
        if previous is not None:
            # Local CLI may resume an exact existing operation without supplying
            # its operator context. Never replace or infer that retained origin.
            _need(previous["action"] == action and previous["request_sha256"] == digest(request)
                  and (context is None or canonical(previous.get("origin")) == canonical(origin)),
                  "PREPARATION_OPERATION_CONFLICT",
                  "Reuse the complete original preparation request and task context")
            return previous
        value = {"schema": OP_SCHEMA, "project_id": self.project_id,
                 "operation_id": operation_id, "action": action, "request": request,
                 "request_sha256": digest(request), "origin": origin,
                 "created_at": _timestamp(created_at or now()), **extra}
        atomic_json(directory / "intent.json", value, immutable=True)
        return value

    def _events(self, directory):
        values, previous = [], None
        for index, path in enumerate(sorted((directory / "events").glob("*.json")), 1):
            value = _read(path)
            _need(path.name == "%012d.json" % index and value.get("index") == index
                  and value.get("previous_sha256") == previous,
                  "PREPARATION_INTEGRITY", "Preparation operation event history changed")
            previous = digest(value)
            values.append(value)
        return values

    def _event(self, directory, status, **details):
        previous = self._events(directory)
        value = {"index": len(previous) + 1, "previous_sha256": digest(previous[-1]) if previous else None,
                 "status": status, "created_at": now(), **details}
        atomic_json(directory / "events" / ("%012d.json" % value["index"]), value, immutable=True)
        return value

    def _binding(self, directory, intent):
        path = directory / "binding.json"
        if not path.exists():
            return None
        binding = _read(path)
        _need(binding.get("schema") == "upstate.delivery-binding/v1"
              and binding.get("project_id") == self.project_id
              and re.fullmatch(r"[0-9a-f]{64}", binding.get("delivery_id", "")) is not None
              and isinstance(binding.get("selection"), dict)
              and binding["selection"].get("application_sha256") == intent.get("application_sha256"),
              "PREPARATION_INTEGRITY", "Original delivery build binding changed")
        return binding

    def _completion(self, binding, *, verify=True):
        if binding is None:
            return None
        directory = self.root / "deliveries" / binding["delivery_id"]
        path = directory / "delivery-state.json"
        if not path.exists():
            return None
        state = _read(path)
        _need(state.get("id") == binding["delivery_id"] and canonical(state.get("selection")) == canonical(binding["selection"]),
              "PREPARATION_INTEGRITY", "Retained delivery differs from the original preparation build")
        if state.get("state") not in ("complete", "received_snapshot"):
            return None
        _need(isinstance(state.get("files"), dict) and state["files"],
              "PREPARATION_INTEGRITY", "Retain the complete original delivery file inventory")
        if verify:
            for item in state["files"].values():
                verify_file(directory, item)
        state = {name: value for name, value in state.items() if name != "reused"}
        return {"delivery": state, "delivery_id": state["id"], "delivery_state": state["state"],
                "completion_scope": ("producer_complete" if state["state"] == "complete"
                                     else "received_delivery_snapshot")}

    def _saved_result(self, intent, revision):
        return self._base(operation_id=intent["operation_id"], action=SAVE, status="SAVED",
                          preparation=revision, origin=intent.get("origin"))

    def _build_result(self, intent, binding, completion):
        return self._base(operation_id=intent["operation_id"], action=BUILD, status="COMPLETE",
                          preparation_id=intent["request"]["preparation_id"],
                          revision=intent["request"]["revision"],
                          revision_id=intent["revision_id"], binding=binding,
                          origin=intent.get("origin"), **completion)

    def _result(self, directory, intent, binding=None):
        path = directory / "result.json"
        if not path.exists():
            return None
        result = _read(path)
        if intent["action"] == SAVE:
            records = self._revisions(intent["request"]["preparation_id"])
            revision = next((row for row in records if row["operation_id"] == intent["operation_id"]), None)
            _need(revision is not None and canonical(result) == canonical(self._saved_result(intent, revision)),
                  "PREPARATION_INTEGRITY", "Saved operation receipt differs from its original revision")
        else:
            _need(binding is not None and canonical(result.get("binding")) == canonical(binding)
                  and result.get("operation_id") == intent["operation_id"]
                  and result.get("revision_id") == intent["revision_id"],
                  "PREPARATION_INTEGRITY", "Build receipt differs from the original bound operation")
            completion = {name: result[name] for name in (
                "delivery", "delivery_id", "delivery_state", "completion_scope")}
            _need(canonical(result) == canonical(self._build_result(intent, binding, completion))
                  and result["delivery_id"] == binding["delivery_id"]
                  and canonical(result["delivery"]["selection"]) == canonical(binding["selection"])
                  and result["delivery_state"] == result["delivery"]["state"]
                  and result["completion_scope"] == ("producer_complete"
                      if result["delivery_state"] == "complete" else "received_delivery_snapshot")
                  and result["delivery_state"] in ("complete", "received_snapshot"),
                  "PREPARATION_INTEGRITY", "Build receipt changed its selected delivery")
        return result

    def _operation(self, operation_id, *, verify=False):
        directory = self._opdir(operation_id)
        intent = self._intent(directory)
        if intent is None:
            return self._base(operation_id=operation_id, status="NOT_FOUND", action=None,
                              request=None, result=None, error=None, binding=None, origin=None)
        binding = self._binding(directory, intent) if intent["action"] == BUILD else None
        result = self._result(directory, intent, binding)
        events = self._events(directory)
        outputs_available = None
        if result is not None and intent["action"] == BUILD and verify:
            outputs_available = self._verify_retained_result(result)
        recovered = False
        if result is None and intent["action"] == SAVE:
            revision = next((row for row in self._revisions(intent["request"]["preparation_id"])
                             if row["operation_id"] == operation_id), None)
            if revision is not None:
                result = self._saved_result(intent, revision)
                recovered = True
        if result is None and binding:
            complete = self._completion(binding, verify=verify)
            if complete:
                result = self._build_result(intent, binding, complete)
                recovered = True
        last = events[-1] if events else None
        status = result["status"] if result else (last["status"] if last else "PREPARED")
        return self._base(operation_id=operation_id, status=status, action=intent["action"],
                          request=intent["request"], origin=intent.get("origin"), result=result,
                          error=last.get("error") if last and not result else None,
                          binding=binding, receipt_recovered=recovered,
                          created_at=intent["created_at"], events=events,
                          outputs_available=outputs_available)

    def operation(self, operation_id):
        # This read is non-mutating. Original completed output files are verified
        # on explicit operation receipt, never by periodic catalogue polling.
        with held(self.root / ".workspace.lock"):
            return self._operation(operation_id, verify=True)

    def _builds(self, preparation_id):
        builds = []
        for path in sorted(self.operations.glob("*/intent.json")):
            intent = self._intent(path.parent)
            if intent["action"] == BUILD and intent["request"]["preparation_id"] == preparation_id:
                row = self._operation(intent["operation_id"], verify=False)
                builds.append({name: row[name] for name in (
                    "operation_id", "status", "request", "origin", "created_at", "binding", "error")})
                if row["result"]:
                    builds[-1].update({name: row["result"][name] for name in (
                        "delivery_id", "delivery_state", "completion_scope")})
        return builds

    def catalog(self, *, offset=0, limit=50):
        _integer(offset, "catalogue offset")
        _integer(limit, "catalogue page size", 1, 200)
        with held(self.root / ".workspace.lock"):
            rows = []
            for folder in sorted(self.records.glob("*")):
                if not folder.is_dir():
                    continue
                retained = self._revisions(folder.name)
                if not retained:
                    continue
                item = retained[-1]
                rows.append({**{name: item[name] for name in (
                    "id", "title", "purpose", "revision", "revision_id", "created_at")},
                    "build_count": len(self._builds(item["id"]))})
            total = len(rows)
            return self._base(items=rows[offset:offset + limit], total=total, offset=offset,
                              limit=limit, next_offset=offset + limit if offset + limit < total else None)

    def inspect(self, preparation_id, revision=None):
        with held(self.root / ".workspace.lock"):
            item, rows = self._selected(preparation_id, revision)
            history = [{name: row[name] for name in (
                "id", "revision", "revision_id", "previous_revision_id", "title", "purpose",
                "created_at", "operation_id")} for row in rows]
            return self._base(preparation=item, history=history, builds=self._builds(preparation_id))

    def preview(self, request):
        with held(self.root / ".workspace.lock"):
            if isinstance(request, dict) and set(request) == {"preparation_id", "revision"}:
                request = _request(request, BUILD)
                item, _ = self._selected(request["preparation_id"], request["revision"])
                selection = item["selection"]
                saved = item["source_snapshot"]
            else:
                request = _request(request, SAVE)
                selection, saved = request["selection"], None
            snapshot = source_snapshot(self.workspace, selection)
            issues = list(snapshot["issues"])
            if saved and saved != snapshot:
                issues.append({"code": "SOURCE_CHANGED",
                               "message": "Selected source metadata changed since this revision; inspect and save an explicit new preparation revision"})
            return self._base(eligible=not issues, issues=issues, selection=selection,
                              source_snapshot=snapshot, binding=None,
                              verification="metadata-readiness; strict source and application verification occurs at build")

    def save(self, request, *, operation_id, created_at=None, context=None):
        request = _request(request, SAVE)
        directory = self._opdir(operation_id)
        with held(self.root / ".workspace.lock"):
            intent = self._ensure_intent(directory, SAVE, request, operation_id, created_at, context)
            result = self._result(directory, intent)
            if result:
                return result
            rows = self._revisions(request["preparation_id"])
            existing = next((row for row in rows if row["operation_id"] == operation_id), None)
            if existing is not None:
                result = self._saved_result(intent, existing)
                atomic_json(directory / "result.json", result, immutable=True)
                return result
            _need(len(rows) == request["expected_revision"], "REVISION_CONFLICT",
                  "Preparation changed; preserve this working copy and explicitly review the newer saved revision")
            snapshot = source_snapshot(self.workspace, request["selection"])
            value = {"schema": SCHEMA, "project_id": self.project_id,
                     "id": request["preparation_id"], "revision": len(rows) + 1,
                     "previous_revision_id": rows[-1]["revision_id"] if rows else None,
                     "operation_id": operation_id, "created_at": intent["created_at"],
                     "title": request["title"], "purpose": request["purpose"],
                     "selection": request["selection"], "source_snapshot": snapshot}
            value["revision_id"] = digest(value)
            _need(len(canonical(value)) <= MAX_RECORD_BYTES, "PREPARATION_TOO_LARGE",
                  "Complete preparation revision exceeds 32 MiB")
            atomic_json(self.records / value["id"] / "revisions" / ("%012d.json" % value["revision"]),
                        value, immutable=True)
            result = self._saved_result(intent, value)
            atomic_json(directory / "result.json", result, immutable=True)
            return result

    def build(self, request, *, operation_id, created_at=None, context=None):
        request = _request(request, BUILD)
        directory = self._opdir(operation_id)
        # This per-operation lock is never acquired by backup; engine/backup run
        # without the Workspace lock. Concurrent same-task calls cannot build twice.
        with held(directory / ".build.lock", blocking=False):
            with held(self.root / ".workspace.lock"):
                original = self._intent(directory)
                if original:
                    intent = self._ensure_intent(directory, BUILD, request, operation_id, created_at, context)
                    binding = self._binding(directory, intent)
                    result = self._result(directory, intent, binding)
                    if result:
                        self._verify_retained_result(result)
                        return result
                    completed = self._completion(binding)
                    if completed:
                        result = self._build_result(intent, binding, completed)
                        atomic_json(directory / "result.json", result, immutable=True)
                        return result
                item, _ = self._selected(request["preparation_id"], request["revision"])
                snapshot = source_snapshot(self.workspace, item["selection"])
                _need(snapshot == item["source_snapshot"], "SOURCE_CHANGED",
                      "Selected source metadata changed; save an explicit new preparation revision")
                _need(not snapshot["issues"], "PREPARATION_NOT_READY",
                      "Complete the selected sources and responsible metadata before building")
            from . import delivery, portable
            # Source digest is measured once for the accepted intent; the original
            # strict engine then proves that exact edition again before effects.
            application_sha256 = portable.application_digest()
            with held(self.root / ".workspace.lock"):
                intent = self._ensure_intent(
                    directory, BUILD, request, operation_id, created_at, context,
                    revision_id=item["revision_id"], application_sha256=application_sha256)
                _need(intent["revision_id"] == item["revision_id"]
                      and intent["application_sha256"] == application_sha256,
                      "SOURCE_CHANGED", "Resume with the original application edition or explicitly request a new build")
            try:
                binding = self._binding(directory, intent)
                prepared = delivery.prepare_binding(self.workspace, _copy(item["selection"]))
                _need(prepared["selection"]["application_sha256"] == intent["application_sha256"],
                      "SOURCE_CHANGED", "Installed application changed during original build preparation")
                if binding is not None:
                    _need(binding == prepared, "SOURCE_CHANGED",
                          "Original build source binding changed; retain the original source edition or explicitly prepare a new build")
                with held(self.root / ".workspace.lock"):
                    _need(source_snapshot(self.workspace, item["selection"]) == item["source_snapshot"],
                          "SOURCE_CHANGED", "Selected source metadata changed during build preparation")
                    atomic_json(directory / "binding.json", prepared, immutable=True)
                    binding = prepared
                    self._event(directory, "BUILDING", delivery_id=binding["delivery_id"])
                # All original scientific/rendering/export behavior remains here.
                delivery.build(self.workspace, _copy(item["selection"]), expected_binding=binding)
                with held(self.root / ".workspace.lock"):
                    completed = self._completion(binding)
                    _need(completed is not None, "PREPARATION_INTEGRITY",
                          "Original delivery did not retain a complete result")
                    result = self._build_result(intent, binding, completed)
                    atomic_json(directory / "result.json", result, immutable=True)
                    return result
            except Exception as error:
                try:
                    with held(self.root / ".workspace.lock"):
                        self._event(directory, "SOURCE_CHANGED" if getattr(error, "code", None) == "SOURCE_CHANGED" else "FAILED",
                                    error={"type": type(error).__name__, "code": getattr(error, "code", None),
                                           "message": str(error)})
                except Exception as journal_error:
                    if hasattr(error, "add_note"):
                        error.add_note("Preserving original failure; operation journal also failed: " + str(journal_error))
                raise

    def _verify_retained_result(self, result):
        # Backups may intentionally omit old deliveries. Keep the original
        # receipt exact; verify all retained original bytes when they are present.
        directory = self.root / "deliveries" / result["delivery_id"]
        if not (directory / "delivery-state.json").exists():
            return False
        state = _read(directory / "delivery-state.json")
        _need(state.get("id") == result["delivery_id"] and canonical(state.get("selection")) == canonical(result["binding"]["selection"]),
              "PREPARATION_INTEGRITY", "Saved build no longer has its original selected delivery")
        retained_paths = {item["path"] for item in state.get("files", {}).values()}
        available = True
        for item in result["delivery"]["files"].values():
            # A received working snapshot can contain only the original subset
            # available before its own archive/final audit were written.
            if (directory / item["path"]).exists():
                verify_file(directory, item)
            elif state.get("state") != "received_snapshot" or item["path"] in retained_paths:
                raise PreparationError("PREPARATION_INTEGRITY", "Saved delivery is missing an original retained file")
            else:
                available = False
        return available


def verify_all(workspace):
    """Validate complete preparation history without running delivery or rewriting it.

    A working archive may legitimately contain a BUILDING intent and its frozen
    binding, then register the selected received_snapshot during original restore.
    It does not need a receipt that could only be produced after that archive.
    """
    model = DeliveryPreparations(workspace)
    count = revisions = operations = 0
    with held(workspace.root / ".workspace.lock"):
        referenced = {}
        for folder in sorted(model.records.glob("*")):
            if not folder.is_dir():
                continue
            rows = model._revisions(folder.name)
            count += bool(rows)
            revisions += len(rows)
            for row in rows:
                _need(row["operation_id"] not in referenced, "PREPARATION_INTEGRITY",
                      "One original save operation published multiple revisions")
                referenced[row["operation_id"]] = row
        for path in sorted(model.operations.glob("*/intent.json")):
            intent = model._intent(path.parent)
            operation_id = intent["operation_id"]
            binding = model._binding(path.parent, intent) if intent["action"] == BUILD else None
            model._events(path.parent)
            result = model._result(path.parent, intent, binding)
            if intent["action"] == SAVE:
                row = referenced.pop(operation_id, None)
                if row is not None:
                    _need(row["revision"] == intent["request"]["expected_revision"] + 1
                          and row["created_at"] == intent["created_at"]
                          and all(row[key] == intent["request"][key] for key in ("title", "purpose", "selection")),
                          "PREPARATION_INTEGRITY", "Saved preparation differs from its complete original request")
            else:
                selected, _ = model._selected(intent["request"]["preparation_id"], intent["request"]["revision"])
                _need(intent["revision_id"] == selected["revision_id"],
                      "PREPARATION_INTEGRITY", "Build changed its original preparation revision")
                if result:
                    model._verify_retained_result(result)
                elif binding:
                    model._completion(binding)
            operations += 1
        _need(not referenced, "PREPARATION_INTEGRITY", "Saved preparation lost its original operation intent")
    return {"schema": SCHEMA, "project_id": workspace.project["id"],
            "preparations": count, "revisions": revisions, "operations": operations}


# Original extension registry spelling; one verifier and one history contract.
verify_workspace = verify_all
