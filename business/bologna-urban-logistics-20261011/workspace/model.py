from __future__ import annotations

import copy
import csv
import gzip
import hashlib
import html
import io
import json
import os
import tempfile
import uuid
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from delivery import apply_delivery_action, delivery_for, public_delivery
from delivery_export import delivery_files, file_manifest, full_report, zip_bytes

try:
    import fcntl
except ImportError:  # pragma: no cover - POSIX is the supported operator host
    fcntl = None


SCHEMA = "bologna-urban-logistics-workspace/v1"
PRIORITY = {
    "VIA SAN FELICE": {"en": "Via San Felice", "it": "Via San Felice"},
    "VIA UGO BASSI": {"en": "Via Ugo Bassi", "it": "Via Ugo Bassi"},
    "VIA INDIPENDENZA": {"en": "Via Indipendenza", "it": "Via Indipendenza"},
    "VIA LAME": {"en": "Via Lame", "it": "Via delle Lame"},
}
RELATIONSHIPS = {"UNREVIEWED", "SEPARATE", "SAME_LOCATION", "RELATED", "SUPERSEDED"}
RATINGS = {"UNASSESSED", "LOW", "MEDIUM", "HIGH", "MIXED", "NOT_APPLICABLE"}
STREET_FIELDS = ["accessWindows", "vehicleCriteria", "loadingSpaces", "hubLockerConcepts", "replicationGovernance"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_atomic(path: Path, data: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".new-", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
        dfd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


@contextmanager
def state_lock(root: Path):
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = root / ".workspace.lock"
    with lock.open("a+b") as handle:
        if fcntl:
            fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def load_state(root: Path) -> dict:
    value = read_json(root / "workspace.json")
    if value.get("schema") != SCHEMA or not isinstance(value.get("revision"), int):
        raise ValueError("Not a Bologna assessment workspace")
    value.setdefault("streetPlans", [{"streetKey": key, "street": labels, "status": "UNREVIEWED",
                                     "fields": {name: {"value": "", "source": ""} for name in STREET_FIELDS},
                                     "reviewer": None, "reviewedAt": None} for key, labels in PRIORITY.items()])
    value.setdefault("roadmap", {"targetYear": 2030, "sumpAlignmentYear": 2027, "milestones": [],
                                "interpretation": "Analyst-supplied progression and derogation criteria."})
    value["delivery"] = delivery_for(value)
    return value


def save_state(root: Path, state: dict) -> None:
    write_atomic(root / "workspace.json", canonical(state))


def checked_text(value, label: str, maximum: int = 4000, required: bool = True) -> str:
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    value = " ".join(value.strip().split())
    if required and not value:
        raise ValueError(f"{label} is required")
    if len(value) > maximum:
        raise ValueError(f"{label} exceeds {maximum} characters")
    return value


def mutate(root: Path, expected_revision: int, operation):
    with state_lock(root):
        state = load_state(root)
        if state["revision"] != expected_revision:
            raise RuntimeError(f"STALE_REVISION current={state['revision']}")
        draft = copy.deepcopy(state)
        result = operation(draft)
        draft["revision"] += 1
        draft["updatedAt"] = utc_now()
        draft.setdefault("events", []).append({
            "revision": draft["revision"], "at": draft["updatedAt"], "kind": result.get("event", "UPDATE")
        })
        save_state(root, draft)
        return draft, result


def initialize(source: Path, receipt_path: Path, root: Path) -> dict:
    if (root / "workspace.json").exists():
        raise FileExistsError("Workspace already exists")
    raw_gzip = source.read_bytes()
    with gzip.open(io.BytesIO(raw_gzip), "rt", encoding="utf-8") as handle:
        rows = json.load(handle)
    if not isinstance(rows, list) or len(rows) != 264:
        raise ValueError("Expected the retained 264-row municipal export")
    receipt = read_json(receipt_path)
    export = receipt.get("export", receipt)
    if export.get("rows") != 264 or export.get("declared_spaces_sum") != 570:
        raise ValueError("Source receipt does not describe the retained snapshot")
    if export.get("gzip_bytes") and export["gzip_bytes"] != len(raw_gzip):
        raise ValueError("Compressed source byte count differs from receipt")
    priority_rows = []
    for index, row in enumerate(rows):
        street = row.get("via")
        if street not in PRIORITY:
            continue
        point = row.get("geo_point_2d") or {}
        spaces = row.get("numero")
        if not isinstance(spaces, int) or spaces < 0:
            raise ValueError(f"Invalid space count at source row {index}")
        priority_rows.append({
            "id": f"city-2022-{index:03d}", "sourceRow": index, "sourceId": "bologna-loading-bays-2022",
            "observedAt": "2022-06-30T14:28:17.344000+00:00", "streetKey": street,
            "street": PRIORITY[street], "civic": str(row.get("civico", "")), "spaces": spaces,
            "category": str(row.get("subcat", "")), "layout": str(row.get("disposti", "")),
            "lon": point.get("lon"), "lat": point.get("lat"), "status": "DATED_SOURCE_OBSERVATION"
        })
    totals = {key: {"points": 0, "spaces": 0, **labels} for key, labels in PRIORITY.items()}
    for row in priority_rows:
        totals[row["streetKey"]]["points"] += 1
        totals[row["streetKey"]]["spaces"] += row["spaces"]
    expected = {"VIA SAN FELICE": (7, 16), "VIA UGO BASSI": (3, 19), "VIA INDIPENDENZA": (7, 48), "VIA LAME": (4, 7)}
    if any((totals[k]["points"], totals[k]["spaces"]) != value for k, value in expected.items()):
        raise ValueError("Priority-street totals differ from retained source receipt")
    lame = next(row for row in priority_rows if row["streetKey"] == "VIA LAME" and row["civic"].lower().replace(" ", "") == "37b")
    now = utc_now()
    scenarios = [
        ("baseline-management", "Baseline management", "Gestione dello scenario di riferimento",
         "Review current dated curb evidence and operating constraints without assuming infrastructure change."),
        ("microhub-consolidation", "Microhub consolidation pilot", "Pilota di consolidamento con microhub",
         "Qualitatively assess a pilot using retained URBANE method references; no demand or emissions outcome is prefilled."),
        ("curb-access-coordination", "Curb and access coordination", "Coordinamento degli stalli e degli accessi",
         "Review loading locations, access windows and construction constraints as a coordinated operating scenario."),
    ]
    state = {
        "schema": SCHEMA, "revision": 0, "createdAt": now, "updatedAt": now,
        "source": {"id": "bologna-loading-bays-2022", "path": str(source.resolve()),
                   "compressedBytes": len(raw_gzip), "compressedSha256": sha256(raw_gzip),
                   "declaredOriginalBytes": export.get("bytes"), "declaredOriginalSha256": export.get("sha256"),
                   "records": 264, "recordedSpaces": 570, "processedAt": "2022-06-30T14:28:17.344000+00:00",
                   "license": "CC BY 4.0", "receipt": str(receipt_path.resolve())},
        "baseline": {"streets": totals, "observations": priority_rows,
                     "interpretation": "Dated source counts; not current capacity, utilization or effectiveness."},
        "datedObservations": [
            {"id": lame["id"], "sourceId": lame["sourceId"], "observedAt": lame["observedAt"],
             "street": "Via Lame", "civic": "37b", "description": "Two recorded spaces at retained point.",
             "lon": lame["lon"], "lat": lame["lat"]},
            {"id": "tram-2026-lame-37c", "sourceId": "tram-bologna-notice-2026-09-24",
             "observedAt": "2026-09-24", "street": "Via delle Lame", "civic": "37/c",
             "description": "Notice identifies a loading/unloading location; no geometry imported.", "lon": None, "lat": None}
        ],
        "decisions": [{"id": "decision-lame-37b-37c", "subject": "Relationship between 2022 Via Lame 37b and 2026 Via delle Lame 37/c",
                       "observationIds": [lame["id"], "tram-2026-lame-37c"], "relationship": "UNREVIEWED",
                       "note": "Retain separately until reviewed against current authoritative municipal material.",
                       "reviewer": None, "reviewedAt": None}],
        "assumptions": [],
        "streetPlans": [{"streetKey": key, "street": labels, "status": "UNREVIEWED",
                         "fields": {name: {"value": "", "source": ""} for name in STREET_FIELDS},
                         "reviewer": None, "reviewedAt": None} for key, labels in PRIORITY.items()],
        "roadmap": {"targetYear": 2030, "sumpAlignmentYear": 2027,
                    "milestones": [],
                    "interpretation": "Analyst-supplied progression and derogation criteria; municipality selects scenarios and retains formal judgment."},
        "scenarios": [{"id": sid, "name": {"en": en, "it": it}, "purpose": purpose, "status": "DRAFT_HYPOTHESIS",
                       "criteria": {k: {"rating": "UNASSESSED", "note": ""} for k in
                                    ["serviceContinuity", "streetAccess", "emissionsPotential", "implementationComplexity", "evidenceCoverage"]},
                       "reviewer": None, "reviewedAt": None} for sid, en, it, purpose in scenarios],
        "survey": {"targetMin": 30, "targetMax": 50, "responses": [], "interpretation": "Responses are supplied observations, not a representative sample by default."},
        "publications": [], "events": [{"revision": 0, "at": now, "kind": "INITIALIZED"}]
    }
    with state_lock(root):
        if (root / "workspace.json").exists():
            raise FileExistsError("Workspace already exists")
        save_state(root, state)
    return state


def apply_action(root: Path, payload: dict):
    if not isinstance(payload, dict) or not isinstance(payload.get("expectedRevision"), int):
        raise ValueError("expectedRevision is required")
    action = payload.get("action")

    def operation(state):
        if isinstance(action, str) and action.startswith("interviews."):
            from interviews import apply_interview_action
            return apply_interview_action(state, payload)
        delivery_result = apply_delivery_action(state, payload)
        if delivery_result is not None:
            return delivery_result
        if action == "reviewDecision":
            decision = next((x for x in state["decisions"] if x["id"] == payload.get("id")), None)
            if not decision:
                raise ValueError("Unknown decision")
            relationship = payload.get("relationship")
            if relationship not in RELATIONSHIPS - {"UNREVIEWED"}:
                raise ValueError("Choose a reviewed relationship")
            decision.update(relationship=relationship, note=checked_text(payload.get("note"), "Decision note"),
                            reviewer=checked_text(payload.get("reviewer"), "Reviewer", 160), reviewedAt=utc_now())
            return {"event": "DECISION_REVIEWED", "id": decision["id"]}
        if action == "addAssumption":
            value = {"id": str(uuid.uuid4()), "title": checked_text(payload.get("title"), "Assumption title", 240),
                     "statement": checked_text(payload.get("statement"), "Assumption statement"),
                     "source": checked_text(payload.get("source"), "Source", 1000),
                     "owner": checked_text(payload.get("owner"), "Owner", 160), "status": "OPEN", "createdAt": utc_now()}
            state["assumptions"].append(value)
            return {"event": "ASSUMPTION_ADDED", "id": value["id"]}
        if action == "reviewScenario":
            scenario = next((x for x in state["scenarios"] if x["id"] == payload.get("id")), None)
            if not scenario:
                raise ValueError("Unknown scenario")
            supplied = payload.get("criteria")
            if not isinstance(supplied, dict):
                raise ValueError("Scenario criteria are required")
            for name in scenario["criteria"]:
                entry = supplied.get(name, {})
                rating = entry.get("rating")
                if rating not in RATINGS:
                    raise ValueError(f"Invalid rating for {name}")
                scenario["criteria"][name] = {"rating": rating, "note": checked_text(entry.get("note", ""), f"{name} note", 1000, False)}
            scenario.update(status="REVIEWED_QUALITATIVE", reviewer=checked_text(payload.get("reviewer"), "Reviewer", 160), reviewedAt=utc_now())
            return {"event": "SCENARIO_REVIEWED", "id": scenario["id"]}
        if action == "reviewStreetPlan":
            plan = next((x for x in state["streetPlans"] if x["streetKey"] == payload.get("streetKey")), None)
            if not plan:
                raise ValueError("Unknown street plan")
            supplied = payload.get("fields")
            if not isinstance(supplied, dict):
                raise ValueError("Street review fields are required")
            for name in STREET_FIELDS:
                entry = supplied.get(name, {})
                plan["fields"][name] = {
                    "value": checked_text(entry.get("value", ""), f"{name} value", 2000, False),
                    "source": checked_text(entry.get("source", ""), f"{name} source", 1000, False),
                }
            plan.update(status="REVIEWED", reviewer=checked_text(payload.get("reviewer"), "Reviewer", 160), reviewedAt=utc_now())
            return {"event": "STREET_PLAN_REVIEWED", "id": plan["streetKey"]}
        if action == "addRoadmapMilestone":
            year = payload.get("year")
            if not isinstance(year, int) or not 2026 <= year <= 2030:
                raise ValueError("Milestone year must be from 2026 through 2030")
            milestone = {"id": str(uuid.uuid4()), "year": year,
                         "milestone": checked_text(payload.get("milestone"), "Milestone", 2000),
                         "derogationCriteria": checked_text(payload.get("derogationCriteria"), "Derogation criteria", 2000),
                         "source": checked_text(payload.get("source"), "Source", 1000),
                         "owner": checked_text(payload.get("owner"), "Owner", 160), "createdAt": utc_now()}
            state["roadmap"]["milestones"].append(milestone)
            state["roadmap"]["milestones"].sort(key=lambda x: (x["year"], x["createdAt"]))
            return {"event": "ROADMAP_MILESTONE_ADDED", "id": milestone["id"]}
        if action == "addSurveyResponse":
            response_id = checked_text(payload.get("respondentId"), "Respondent ID", 100)
            if any(x["respondentId"] == response_id for x in state["survey"]["responses"]):
                raise ValueError("Respondent ID already exists")
            if payload.get("consent") is not True:
                raise ValueError("Recorded consent is required")
            language = payload.get("language")
            if language not in {"it", "en"}:
                raise ValueError("Language must be it or en")
            response = {"respondentId": response_id, "language": language, "consent": True,
                        "role": checked_text(payload.get("role"), "Role", 160),
                        "deliveriesPerWeek": payload.get("deliveriesPerWeek"),
                        "constraint": checked_text(payload.get("constraint", ""), "Constraint", 1000, False),
                        "note": checked_text(payload.get("note", ""), "Survey note", 2000, False), "recordedAt": utc_now()}
            if not isinstance(response["deliveriesPerWeek"], int) or not 0 <= response["deliveriesPerWeek"] <= 10000:
                raise ValueError("deliveriesPerWeek must be an integer from 0 to 10000")
            state["survey"]["responses"].append(response)
            return {"event": "SURVEY_RESPONSE_ADDED", "id": response_id}
        if action == "publish":
            name = checked_text(payload.get("name"), "Publication name", 200)
            frozen = report_payload(state)
            frozen["workspaceRevision"] = state["revision"] + 1
            frozen["interviews"]["workspaceRevision"] = frozen["workspaceRevision"]
            frozen["snapshotAt"] = utc_now()
            publication = {"id": str(uuid.uuid4()), "name": name, "createdAt": frozen["snapshotAt"],
                           "workspaceRevision": state["revision"] + 1, "reportSha256": sha256(canonical(frozen)), "report": frozen}
            state["publications"].append(publication)
            return {"event": "REPORT_PUBLISHED", "id": publication["id"], "sha256": publication["reportSha256"]}
        raise ValueError("Unknown action")

    return mutate(root, payload["expectedRevision"], operation)


def survey_summary(state: dict) -> dict:
    responses = state["survey"]["responses"]
    roles = {}
    for row in responses:
        roles[row["role"]] = roles.get(row["role"], 0) + 1
    count = len(responses)
    return {"responses": count, "targetMin": state["survey"]["targetMin"], "targetMax": state["survey"]["targetMax"],
            "targetReached": count >= state["survey"]["targetMin"], "roles": roles,
            "interpretation": state["survey"]["interpretation"]}


def report_payload(state: dict) -> dict:
    delivery = public_delivery(state)
    delivery.pop("history", None)
    return {"schema": "bologna-urban-logistics-report/v2", "source": copy.deepcopy(state["source"]),
            "baseline": copy.deepcopy(state["baseline"]), "datedObservations": copy.deepcopy(state["datedObservations"]),
            "decisions": copy.deepcopy(state["decisions"]), "assumptions": copy.deepcopy(state["assumptions"]),
            "scenarios": copy.deepcopy(state["scenarios"]), "survey": survey_summary(state),
            "interviews": __import__("interviews").analyze(state),
            "streetPlans": copy.deepcopy(state["streetPlans"]), "roadmap": copy.deepcopy(state["roadmap"]),
            "workspaceRevision": state["revision"], "snapshotAt": state["updatedAt"], "delivery": delivery,
            "boundary": "Source-linked analytical material with separate analyst review and municipal decision records."}


def baseline_csv(state: dict) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["source_id", "observed_at", "street", "civic", "recorded_spaces", "category", "layout", "longitude", "latitude", "status"])
    for row in state["baseline"]["observations"]:
        writer.writerow([row["sourceId"], row["observedAt"], row["street"]["it"], row["civic"], row["spaces"], row["category"], row["layout"], row["lon"], row["lat"], row["status"]])
    return output.getvalue().encode("utf-8")


def geojson(state: dict) -> bytes:
    features = []
    for row in state["baseline"]["observations"]:
        features.append({"type": "Feature", "id": row["id"], "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
                         "properties": {k: row[k] for k in ["sourceId", "observedAt", "civic", "spaces", "category", "layout", "status"]} |
                                       {"street_en": row["street"]["en"], "street_it": row["street"]["it"]}})
    return canonical({"type": "FeatureCollection", "features": features})


def roadmap_csv(state: dict) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["record_type", "street", "field", "value", "source", "year", "milestone", "derogation_criteria", "owner", "status"])
    for plan in state["streetPlans"]:
        for name, entry in plan["fields"].items():
            writer.writerow(["street_review", plan["street"]["it"], name, entry["value"], entry["source"], "", "", "", plan["reviewer"] or "", plan["status"]])
    for row in state["roadmap"]["milestones"]:
        writer.writerow(["roadmap_milestone", "", "", "", row["source"], row["year"], row["milestone"], row["derogationCriteria"], row["owner"], "SUPPLIED"])
    return output.getvalue().encode("utf-8")


def report_html(state: dict) -> bytes:
    return full_report(report_payload(state))


def selected_report(state: dict, publication_id: str | None = None) -> dict:
    if publication_id is None:
        return report_payload(state)
    publication = next((p for p in state["publications"] if p["id"] == publication_id), None)
    if publication is None:
        raise ValueError("Unknown retained publication")
    report = publication["report"]
    if sha256(canonical(report)) != publication["reportSha256"]:
        raise ValueError("Retained publication digest mismatch")
    return copy.deepcopy(report)


def export_parts(root: Path, publication_id: str | None = None):
    state = load_state(root)
    report = selected_report(state, publication_id)
    files = {"baseline.csv": baseline_csv(report), "observations.geojson": geojson(report),
             "report.json": canonical(report), **delivery_files(report)}
    if "streetPlans" in report and "roadmap" in report:
        files["roadmap.csv"] = roadmap_csv(report)
    if "interviews" in report:
        analysis = report["interviews"]
        frozen_state = {"revision": analysis["workspaceRevision"], "baseline": report["baseline"], "scenarios": report["scenarios"]}
        files.update(__import__("interviews").export_files(frozen_state, analysis))
    manifest = file_manifest(report, files, publication_id)
    files["manifest.json"] = canonical(manifest)
    return manifest, files


def export_workspace(root: Path, out: Path, publication_id: str | None = None) -> dict:
    manifest, files = export_parts(root, publication_id)
    out.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        write_atomic(out / name, data, 0o600)
    return manifest


def download_workspace(root: Path, format_name: str, publication_id: str | None = None):
    _, files = export_parts(root, publication_id)
    if format_name == "zip":
        return zip_bytes(files), "application/zip", "bologna-delivery.zip"
    names = {"report": "report.html", "framework": "framework.html", "learning": "learning.html",
             "factsheet": "factsheet.html", "cesf": "cesf.html", "survey": "survey-it.html"}
    if format_name not in names:
        raise ValueError("Unknown download format")
    name = names[format_name]
    return files[name], "text/html; charset=utf-8", name


def backup_workspace(root: Path, archive: Path) -> dict:
    state_bytes = (root / "workspace.json").read_bytes()
    receipt = {"schema": "bologna-urban-logistics-backup/v1", "createdAt": utc_now(), "stateBytes": len(state_bytes), "stateSha256": sha256(state_bytes)}
    archive.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".backup-", dir=archive.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("workspace.json", state_bytes)
            zf.writestr("backup.json", canonical(receipt))
        os.chmod(temp, 0o600)
        os.replace(temp, archive)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    receipt.update(bytes=archive.stat().st_size, sha256=sha256(archive.read_bytes()))
    return receipt


def restore_workspace(archive: Path, root: Path) -> dict:
    if root.exists() and any(root.iterdir()):
        raise FileExistsError("Restore target must be absent or empty")
    with zipfile.ZipFile(archive) as zf:
        if set(zf.namelist()) != {"workspace.json", "backup.json"}:
            raise ValueError("Unexpected backup members")
        state_bytes = zf.read("workspace.json")
        receipt = json.loads(zf.read("backup.json"))
    if receipt.get("schema") != "bologna-urban-logistics-backup/v1" or receipt.get("stateSha256") != sha256(state_bytes):
        raise ValueError("Backup state digest mismatch")
    state = json.loads(state_bytes)
    if state.get("schema") != SCHEMA:
        raise ValueError("Backup workspace schema mismatch")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    write_atomic(root / "workspace.json", state_bytes)
    return {"state": "RESTORED", "revision": state["revision"], "stateSha256": receipt["stateSha256"]}


