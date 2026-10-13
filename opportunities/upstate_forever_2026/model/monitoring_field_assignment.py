"""Carry original field-desk selections into editable native implementation plans."""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import tempfile

from .common import atomic_bytes, atomic_json, describe_file, digest, held, identifier, read_json, verify_file
from .implementation import ImplementationStore
from .implementation_schema import canonical_bytes, document_digest, load_json, make_plan, validate_plan
from .portable_implementation import report_edition

VERSION = 1
KIND = "monitoring-field-assignments"
SELECTION_SCHEMA = "upstate.monitoring-field-selection/v1"
MAX_SELECTION_BYTES = 1024 * 1024
BUDGET_NOTE = ("The budget retains the complete original programme, including all original rounds "
               "and stated overhead. Selecting fewer rounds does not prorate this budget. "
               "No commitment or actual expenditure is inferred.")
PLANNING_NOTE = ("These are proposed station assignments and planned visits. Original local calendar "
                 "slots and travel allowances are retained; they are not routed travel estimates. "
                 "Areas without an assigned station remain explicit planning tasks.")


def _plain_hash(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _source(workspace, choice):
    if not isinstance(choice, dict):
        raise ValueError("Choose an original field-support source.")
    collection_id = identifier(choice.get("source_collection_id"))
    source_id = choice.get("source_id")
    _, entry = workspace.source_file(collection_id, source_id)
    if entry.get("kind") != "document" or entry.get("role") != "monitoring_field_support":
        raise ValueError("Choose the original monitoring field-planning document.")
    if choice.get("body_sha256") not in (None, entry["body"]["sha256"]):
        raise ValueError("The selected field-support source edition changed.")
    candidates = [row for row in entry["companions"]
                  if row.get("view_path", row["filename"]).split("/")[-1] == "field-support.json"]
    if len(candidates) != 1:
        raise ValueError("Retain exactly one original field-support.json companion.")
    body = candidates[0]
    path = verify_file(workspace.root, dict(body, path=body["object"]))
    raw = path.read_bytes()
    data = load_json(raw, max_bytes=64 * 1024 * 1024)
    if data.get("schema") != "upstate.monitoring-field-support/v1":
        raise ValueError("Retain the original monitoring field-support schema.")
    expected = data.get("id")
    if expected != _plain_hash({key: value for key, value in data.items() if key != "id"}):
        raise ValueError("The field-support content differs from its original source identity.")
    binding = dict(source_collection_id=collection_id, source_id=source_id,
                   body_sha256=entry["body"]["sha256"], field_support_sha256=body["sha256"],
                   field_support_bytes=body["bytes"], field_support_id=expected,
                   original_project_id=data["project_id"], frontier_id=data["frontier_id"],
                   network_id=data["network_id"])
    return data, raw, binding


def catalog(workspace):
    sources = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if entry.get("kind") == "document" and entry.get("role") == "monitoring_field_support":
                sources.append(dict(source_collection_id=collection["id"], source_id=entry["id"],
                                    body_sha256=entry["body"]["sha256"],
                                    title=entry.get("title") or entry["id"],
                                    collection_title=collection.get("title", "")))
    return dict(sources=sources, assignments=overview(workspace))


def _selection(text, data):
    if not isinstance(text, str):
        raise ValueError("Load the original saved field-selection JSON.")
    value = load_json(text, max_bytes=MAX_SELECTION_BYTES)
    if (value.get("schema") != SELECTION_SCHEMA or value.get("support_id") != data["id"]
            or value.get("project_id") != data["project_id"]
            or value.get("frontier_id") != data["frontier_id"]):
        raise ValueError("This selection belongs to a different original field-support edition.")
    plans = [row for row in data["plans"] if row["plan_id"] == value.get("plan_id")]
    if len(plans) != 1:
        raise ValueError("Choose an original retained budget plan.")
    selected = plans[0]
    if value.get("budget_usd") != selected["budget_usd"]:
        raise ValueError("The saved selection's original programme budget differs.")
    allowed = set(selected["selected_ids"])
    choices, notes, rounds = value.get("choices"), value.get("notes"), value.get("rounds")
    if (not isinstance(choices, dict) or not isinstance(notes, dict)
            or set(choices) - allowed or set(notes) - allowed):
        raise ValueError("Keep station choices and notes within the selected original search areas.")
    if (not isinstance(rounds, list) or any(type(row) is not int or row not in (1, 2, 3) for row in rounds)
            or len(rounds) != len(set(rounds))):
        raise ValueError("Choose distinct original rounds 1, 2 and 3.")
    if any(not isinstance(note, str) or len(note) > 2000 for note in notes.values()):
        raise ValueError("Each original search-area note must contain at most 2,000 characters.")
    candidates = {}
    for family, field in (("observation", "microbial_stations"), ("assessment", "assessment_stations")):
        for station in data[field]:
            key = family + ":" + station["id"]
            if key in candidates:
                raise ValueError("An original source contains duplicate station identifiers.")
            candidates[key] = dict(family=family, station=station)
    areas = []
    area_index = {row["huc12"]: row for row in selected["search_areas"]}
    if set(area_index) != allowed or len(area_index) != len(selected["search_areas"]):
        raise ValueError("The retained search-area ledger differs from its original selection.")
    for huc in selected["selected_ids"]:
        key = choices.get(huc, "")
        if not isinstance(key, str):
            raise ValueError("Each chosen station must retain its original source key.")
        chosen = candidates.get(key) if key else None
        if key and (chosen is None or chosen["station"].get("huc12") != huc):
            raise ValueError("Choose an original station assigned to this exact search area.")
        station = chosen["station"] if chosen else None
        if station:
            for axis, limit in (("longitude", 180), ("latitude", 90)):
                number = station.get(axis)
                if type(number) not in (int, float) or not math.isfinite(number) or abs(number) > limit:
                    raise ValueError("Retain the source station's finite WGS84 planning coordinates.")
        slots = [deepcopy(slot) for slot in area_index[huc]["original_planned_visits"]
                 if slot["round"] in rounds]
        areas.append(dict(huc12=huc, name=area_index[huc]["name"], station_key=key or None,
                          station=deepcopy(station), family=chosen["family"] if chosen else None,
                          note=notes.get(huc, ""), original_area=deepcopy(area_index[huc]),
                          planned_slots=slots, assigned=chosen is not None))
    return value, selected, areas


def preview(workspace, request):
    if not isinstance(request, dict):
        raise ValueError("Choose a field source and saved field-selection JSON.")
    data, raw, binding = _source(workspace, request.get("source"))
    text = request.get("selection_text")
    selection, selected, areas = _selection(text, data)
    title = request.get("title", "")
    if not isinstance(title, str) or not title.strip() or len(title) > 240:
        raise ValueError("Give the editable field assignment a title of at most 240 characters.")
    title = title.strip()
    identity = dict(schema="upstate.monitoring-field-assignment/v1", version=VERSION,
                    project_id=workspace.project["id"], source=binding,
                    selection_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(), title=title)
    key = digest(identity)
    result = dict(id=key, identity=identity, title=title, selection=selection, source=binding,
                  plan_id="field_" + key[:40], original_plan_id=selected["plan_id"],
                  original_budget_usd=selected["budget_usd"], original_cost=deepcopy(selected["original_cost"]),
                  selected_rounds=selection["rounds"], areas=areas,
                  assigned_areas=sum(row["assigned"] for row in areas),
                  unassigned_areas=sum(not row["assigned"] for row in areas),
                  planned_visits=sum(len(row["planned_slots"]) for row in areas if row["assigned"]),
                  unassigned_slots=sum(len(row["planned_slots"]) for row in areas if not row["assigned"]),
                  budget_note=BUDGET_NOTE, planning_note=PLANNING_NOTE)
    return result


def _document(workspace, prepared, data, selected):
    slots = selected["original_calendar"]["visits"]
    if not slots:
        raise ValueError("The original plan contains no calendar dates.")
    start = min(row["date"] for row in slots)
    finish = max(row.get("round_deadline", row["date"]) for row in slots)
    plan = make_plan(prepared["plan_id"], prepared["title"], start,
                     target_date=finish, description=PLANNING_NOTE + " " + BUDGET_NOTE)
    source_id = "field_support"
    plan["source_links"].append(dict(id=source_id, kind="monitoring_field_support",
                                    label="Original field-support edition and saved station selection",
                                    reference="urn:upstate:monitoring-field-support:" + data["id"],
                                    snapshot=dict(source=deepcopy(prepared["source"]),
                                                       original_calendar=deepcopy(selected["original_calendar"]),
                                                       original_cost=deepcopy(selected["original_cost"]))))
    for area in prepared["areas"]:
        huc, station = area["huc12"], area["station"]
        task_id = "area_" + huc
        plan["tasks"].append(dict(id=task_id,
            title=("Prepare visits: " if station else "Assign a field station: ") + area["name"],
            phase="Field planning", assignee="", notes=area["note"], status="planned",
            duration_days=None, progress_pct=0, depends_on=[], evidence_refs=[source_id],
            original_search_area=deepcopy(area["original_area"]),
            assignment_state="station_assigned" if station else "station_unassigned",
            original_selected_rounds=deepcopy(prepared["selected_rounds"])))
        if not station:
            continue
        site_id = "station_" + digest(area["station_key"])[:24]
        plan["sites"].append(dict(id=site_id, label=station.get("name") or station["id"],
                                 source_ref=source_id, coordinate_reference_system="EPSG:4326", latitude=station["latitude"],
                                 longitude=station["longitude"], original_station_key=area["station_key"],
                                 original_station=deepcopy(station), source_family=area["family"],
                                 original_huc12=huc))
        for slot in area["planned_slots"]:
            plan["visits"].append(dict(id="visit_" + digest([huc, slot["visit_key"]])[:24],
                site_id=site_id, monitoring_plan_id="field_rounds", planned_date=slot["date"],
                observer="", notes=(area["note"] + "\nOriginal round " + str(slot["round"]) + ": "
                    + slot["date"] + " " + slot["start_local"] + "–" + slot["finish_local"]
                    + " local; crew " + str(slot["crew"]) + "; deadline " + slot["round_deadline"]).strip(),
                evidence_refs=[source_id], status="planned",
                original_calendar_slot=deepcopy(slot), original_search_area=huc,
                original_station_key=area["station_key"]))
    plan["monitoring_plans"].append(dict(id="field_rounds", title="Selected original field rounds",
        objective="Prepare field visits at the explicitly selected original station locations.",
        notes=PLANNING_NOTE, site_ids=[row["id"] for row in plan["sites"]], parameters=[],
        frequency="Original selected rounds: " + ", ".join(map(str, prepared["selected_rounds"])),
        original_calendar=deepcopy(selected["original_calendar"]),
        original_selected_rounds=deepcopy(prepared["selected_rounds"])))
    cost = selected["original_cost"]
    if (cost.get("currency") != "USD" or type(cost.get("budget_cents")) is not int
            or cost["budget_cents"] < 0
            or Decimal(selected["budget_usd"]) * 100 != cost["budget_cents"]):
        raise ValueError("Retain the original programme's exact USD budget and cents.")
    plan["budget_lines"].append(dict(id="original_programme_budget", label="Full original programme budget",
        kind="budget", amount_minor=cost["budget_cents"], reference=BUDGET_NOTE,
        original_cost=deepcopy(cost)))
    plan["monitoring_field_assignment"] = deepcopy(prepared)
    return validate_plan(plan)


def _directory(workspace, key):
    return workspace.root / KIND / identifier(key)


def _same_attachment(store, plan_id, checksum):
    """Use committed history; later removal of a visible link stays removed."""
    for revision in store.history(plan_id):
        document = store.get(plan_id, revision["revision"])
        for link in document["source_links"]:
            if link.get("kind") == "local_file" and link.get("sha256") == checksum:
                path = verify_file(store.root, dict(path=link["reference"], bytes=link["size_bytes"],
                                                    sha256=checksum))
                return link, str(path)
    return None


def _report_sources():
    root = Path(__file__).resolve().parent
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
            for name in ("implementation.py", "implementation_schema.py",
                         "implementation_reporting.py", "portable_implementation.py")}


def _retain_original_report(store, directory, selection):
    target = directory / "original-report"
    if (target / "manifest.json").exists():
        original = report_edition(store, target)
        if any(original[name] != selection[name] for name in
               ("plan_id", "revision", "document_digest", "as_of")):
            raise ValueError("The completed report differs from its frozen assignment revision.")
        return store.retain_report(target)
    # The final report path and revision were frozen before the first render.
    # Complete interrupted attempts are reconciled before generating any bytes.
    attempts = sorted(directory.glob("assignment-report-*"))
    for attempt in attempts:
        if (attempt / "manifest.json").exists():
            edition = report_edition(store, attempt)
            if (edition["document_digest"] == selection["document_digest"]
                    and edition["as_of"] == selection["as_of"]):
                break
    else:
        if selection["rendering_sources"] != _report_sources():
            raise ValueError("Resume this partial report with its retained original rendering source; "
                             "completed original reports can be reopened under the current application.")
        attempt = Path(tempfile.mkdtemp(prefix="assignment-report-", dir=directory))
        attempt.rmdir()
        store.report(selection["plan_id"], attempt, selection["as_of"],
                     revision=selection["revision"])
        edition = report_edition(store, attempt)
    target.mkdir(exist_ok=True)
    members = list(edition["members"])
    if set(path.name for path in target.iterdir()) - set(members):
        raise ValueError("The original assignment report directory contains an unrecognized member.")
    for name in members:
        if name == "manifest.json":
            continue
        atomic_bytes(target / name, (attempt / name).read_bytes(), immutable=True)
    atomic_bytes(target / "manifest.json", (attempt / "manifest.json").read_bytes(), immutable=True)
    report_edition(store, target)
    return store.retain_report(target)


def build(workspace, request):
    expected = request.get("expected_id") if isinstance(request, dict) else None
    if expected:
        prior = _directory(workspace, expected)
        if (prior / "complete.json").exists():
            captured = read_json(prior / "request.json")
            incoming_source = request.get("source", {})
            original_source = captured["identity"]["source"]
            same_source = (isinstance(incoming_source, dict)
                           and incoming_source.get("source_collection_id") == original_source["source_collection_id"]
                           and incoming_source.get("source_id") == original_source["source_id"]
                           and incoming_source.get("body_sha256") in (None, original_source["body_sha256"]))
            if (not same_source
                    or captured["selection_text"] != request.get("selection_text")
                    or captured["title"] != str(request.get("title", "")).strip()):
                raise ValueError("Reopen the original saved field assignment with its exact request.")
            return inspect(workspace, expected)
    prepared = preview(workspace, request)
    if request.get("expected_id") not in (None, prepared["id"]):
        raise ValueError("The source or saved field selection changed after preview.")
    directory = _directory(workspace, prepared["id"])
    with held(directory.parent / (prepared["id"] + ".lock")):
        if (directory / "complete.json").exists():
            return inspect(workspace, prepared["id"])
        data, raw, binding = _source(workspace, request["source"])
        if binding != prepared["source"]:
            raise ValueError("The original field-support source changed during preparation.")
        _, selected, _ = _selection(request["selection_text"], data)
        directory.mkdir(parents=True, exist_ok=True)
        frozen_request = dict(identity=prepared["identity"], source={key: binding[key] for key in
                              ("source_collection_id", "source_id", "body_sha256")},
                              selection_text=request["selection_text"], title=prepared["title"])
        atomic_json(directory / "request.json", frozen_request, immutable=True)
        atomic_bytes(directory / "field-support.json", raw, immutable=True)
        atomic_bytes(directory / "field-selection.json", request["selection_text"].encode("utf-8"), immutable=True)
        if not (directory / "initial-plan.json").exists():
            atomic_json(directory / "initial-plan.json", _document(workspace, prepared, data, selected), immutable=True)
        document = read_json(directory / "initial-plan.json")
        store = ImplementationStore(workspace)
        original_path = store.base / prepared["plan_id"]
        if not original_path.exists() or not store.history(prepared["plan_id"]):
            store.create(document, actor="monitoring-field-assignment")
        original = store.get(prepared["plan_id"], 1)
        # Native create assigns the committed revision and timestamps.
        if original.get("monitoring_field_assignment") != prepared:
            raise ValueError("This plan ID already belongs to a different original field assignment.")
        attachments = []
        for name, label in (("field-support.json", "Complete original field-support data"),
                            ("field-selection.json", "Original saved station, round and note selection")):
            source = directory / name
            checksum = hashlib.sha256(source.read_bytes()).hexdigest()
            existing = _same_attachment(store, prepared["plan_id"], checksum)
            if existing is None:
                current = store.get(prepared["plan_id"])
                attached = store.attach_file(prepared["plan_id"], source, current["revision"],
                                             actor="monitoring-field-assignment", label=label)
                existing = (attached["source_link"], attached["file_ref"])
            attachments.append(deepcopy(existing[0]))
        frozen_path = directory / "report-selection.json"
        if not frozen_path.exists():
            current = store.get(prepared["plan_id"])
            atomic_json(frozen_path, dict(plan_id=current["id"], revision=current["revision"],
                        document_digest=document_digest(current), as_of=current["start_date"],
                        rendering_sources=_report_sources(), report_path="original-report"), immutable=True)
        report_selection = read_json(frozen_path)
        document = store.get(prepared["plan_id"], report_selection["revision"])
        if document_digest(document) != report_selection["document_digest"]:
            raise ValueError("The original assignment report revision changed.")
        report = _retain_original_report(store, directory, report_selection)
        files = {name: describe_file(workspace.root, directory / name)
                 for name in ("request.json", "field-support.json", "field-selection.json",
                              "initial-plan.json", "report-selection.json")}
        report_root = Path(report["directory"])
        for name in report["members"]:
            files["report/" + name] = describe_file(workspace.root, report_root / name)
        result = dict(schema="upstate.monitoring-field-assignment-result/v1", id=prepared["id"],
                      state="complete", project_id=workspace.project["id"], source=prepared["source"],
                      summary={name: prepared[name] for name in ("title", "plan_id", "original_plan_id",
                          "original_budget_usd", "selected_rounds", "assigned_areas", "unassigned_areas",
                          "planned_visits", "unassigned_slots", "budget_note", "planning_note")},
                      plan=dict(id=document["id"], revision=document["revision"],
                                document_digest=document_digest(document)),
                      attachments=attachments, report=report, files=files)
        atomic_json(directory / "complete.json", result, immutable=True)
        return inspect(workspace, prepared["id"])


def inspect(workspace, key):
    directory = _directory(workspace, key)
    result = read_json(directory / "complete.json")
    request = read_json(directory / "request.json")
    if result["id"] != key or digest(request["identity"]) != key or result["project_id"] != workspace.project["id"]:
        raise ValueError("This field assignment belongs to a different original project or selection.")
    for row in result["files"].values():
        verify_file(workspace.root, row)
    store = ImplementationStore(workspace)
    plan = store.get(result["plan"]["id"], result["plan"]["revision"])
    if document_digest(plan) != result["plan"]["document_digest"]:
        raise ValueError("The original editable assignment revision changed.")
    for link in result["attachments"]:
        verify_file(workspace.root, dict(path=link["reference"], bytes=link["size_bytes"], sha256=link["sha256"]))
    # Absolute runtime paths are rebound after ordinary full-project receiving.
    report_root = verify_file(workspace.root, result["files"]["report/manifest.json"]).parent
    actual = report_edition(store, report_root)
    if actual["id"] != result["report"]["id"]:
        raise ValueError("The retained original assignment report differs.")
    return dict(result, report=actual, assignment=deepcopy(plan["monitoring_field_assignment"]),
                current_revision=store.get(plan["id"])["revision"])


def overview(workspace):
    output = []
    for path in sorted((workspace.root / KIND).glob("*/complete.json")):
        value = read_json(path)
        output.append(dict(id=value["id"], **value["summary"], plan=value["plan"]))
    return output


def verify_all(workspace):
    return [inspect(workspace, row["id"]) for row in overview(workspace)]
