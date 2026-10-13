"""Same simulated field case: original review, requests, engineering handback and receive.

All customer wording, engineer assignments and dispositions below are authored
teaching inputs. Scientific quantities and evidence come exclusively from the
existing completed simulated-fieldwork operation and retained native reports.
No scientific Workspace, model run or customer acceptance is created here.
"""
from __future__ import annotations
import argparse
import copy
import json
import os
import shutil
import tempfile
from pathlib import Path

from .common import atomic_bytes, atomic_json, digest, file_digest, held, identifier, now
from . import reviews, review_handback as handbacks, review_receiving, review_worklist
from . import simulated_fieldwork as field
from . import implementation_qc_actions as actions

SCHEMA = "upstate.simulated-customer-review/v1"
LABEL = "SIMULATED TEACHING INPUT"
PHASES = ("request", "planning", "ready")
STEPS = ("01-sources", "02-original-review", "03-customer-request",
         "04-engineering-plan", "05-revised-review", "06-ready-handback")
REQUIREMENTS = [
    {"id": "follow-up-evidence", "title": "Explain the initial precision issue and retained follow-up",
     "detail": "Show the original quality-control finding, assigned corrective task, repeat collection, "
               "completed task evidence and explicit intended-use decisions in their original report editions."},
    {"id": "original-records", "title": "Preserve original observations and source quality flags",
     "detail": "Keep original sample identities, laboratory result text, censored blank, declared control "
               "relationships and original source QA visible alongside the reviewed repeat evidence."},
]
AUTHOR = {"name": "Simulated engineering team", "role": LABEL,
          "organization": "Simulated headwaters teaching case"}


def _clone(value):
    return copy.deepcopy(value)


def _directory(path, *, create=False):
    path = Path(path).absolute()
    chain = (path, *path.parents)
    for item in reversed(chain):
        if item.is_symlink():
            raise ValueError("Use ordinary original directories without symbolic links: " + str(item))
        if item.exists() and not item.is_dir():
            raise ValueError("An original directory became a different file type: " + str(item))
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def _read(directory, name):
    return reviews._read_json_file(reviews._regular(directory, name))


def _put(directory, name, value):
    path = Path(directory) / name
    if path.exists() or path.is_symlink():
        if _read(directory, name) != value:
            raise ValueError("An immutable teaching request or result differs: " + name)
    else:
        atomic_json(path, value, immutable=True)
    return value


def _body(directory, name, body):
    path = Path(directory) / name
    if path.exists() or path.is_symlink():
        if reviews._regular(directory, name).read_bytes() != body:
            raise ValueError("A retained teaching export member differs: " + name)
    else:
        atomic_bytes(path, body, immutable=True)


def _identity(workspace, field_operation_id):
    identifier(field_operation_id)
    return {"schema": SCHEMA, "classification": LABEL, "project_id": workspace.project["id"],
            "field_operation_id": field_operation_id, "edition": 1}


def _root(workspace, operation_id, *, create=False):
    identifier(operation_id)
    return _directory(Path(workspace.root) / "implementation" / "simulated-customer-reviews" /
                      operation_id, create=create)


def _binding(result):
    return {"field_operation_id": result["operation_id"], "plan_id": result["plan_id"],
            "recipe_sha256": result["recipe_sha256"],
            "qc_reports": [{key: row[key] for key in ("plan_id", "revision", "report_id", "review_id")}
                           for row in result["qc_reports"]],
            "action_reports": [{key: row[key] for key in
                                ("plan_id", "revision", "report_id", "action_report_id")}
                               for row in result["action_reports"]]}


def _field(workspace, operation):
    result = field.inspect_campaign(workspace, operation["identity"]["field_operation_id"])
    if (result["phase"] != "closeout" or result["demo_id"] != field.DEMO_ID
            or result["classification"] != field.LABEL
            or result["original_project_id"] != workspace.project["id"]):
        raise ValueError("Select the completed original simulated field chapter in this same scientific project")
    if _binding(result) != operation["field_binding"]:
        raise ValueError("The original field report editions selected for this teaching operation changed")
    return result


def _operation(workspace, operation_id):
    directory = _root(workspace, operation_id)
    record = _read(directory, "operation.json")
    expected = _identity(workspace, record["identity"]["field_operation_id"])
    if record.get("identity") != expected or digest(expected) != operation_id:
        raise ValueError("Reopen this exact teaching operation in its original restored project")
    reviews._date(record["created_at"])
    return directory, record


def _choice(workspace, value):
    if not isinstance(value, dict):
        raise ValueError("A retained field report lacks its actual scientific source selection")
    result = {"source_collection_id": identifier(value["source_collection_id"]),
              "source_id": reviews._text(value["source_id"], "original source ID", required=True, maximum=500)}
    # Source IDs are native identifiers; source_file verifies original bodies
    # and all companions. The collection is selected without repackaging it.
    workspace.source_file(result["source_collection_id"], result["source_id"])
    return result


def _source_request(case):
    return {"field_binding": _binding(case),
            "initial_qc": case["scientific_reports"][0]["report_source"],
            "revised": [case["observation_context"]["report_source"]] +
                       [row["report_source"] for row in case["scientific_reports"]]}


def _verify_sources(workspace, selected, result):
    initial = [_choice(workspace, row) for row in result["initial"]]
    revised = [_choice(workspace, row) for row in result["revised"]]
    expected_initial = _choice(workspace, selected["initial_qc"])
    expected_revised = [_choice(workspace, row) for row in selected["revised"]]
    if len(initial) != 2 or initial[0] != expected_initial or revised != expected_revised:
        raise ValueError("The original or revised source list differs from the retained field chapter")
    source = selected["field_binding"]["action_reports"][0]
    native = actions.inspect(workspace, source["plan_id"], source["action_report_id"])
    manifest = _read(workspace.root, native["directory"] + "/qc-actions-sources.json")
    expected = manifest["entries"][0]
    _, retained = workspace.source_file(initial[1]["source_collection_id"], initial[1]["source_id"])
    if retained["id"] != expected["id"]:
        raise ValueError("The initial engineering source is not the original open corrective-action report")
    descriptors = [retained["body"], *retained["companions"]]
    originals = [expected, *expected["companions"]]
    if (len(descriptors) != len(originals) or
            [(row["bytes"], row["sha256"]) for row in descriptors] !=
            [(row["bytes"], row["sha256"]) for row in originals]):
        raise ValueError("The initial engineering source changed its original report or companions")


def _sources(workspace, case):
    original = _choice(workspace, case["scientific_reports"][0]["report_source"])
    open_action = case["action_reports"][0]
    saved = actions.scientific_source(workspace, open_action["plan_id"], open_action["action_report_id"])
    initial = [original, _choice(workspace, saved["report_source"])]
    revised = [_choice(workspace, case["observation_context"]["report_source"])]
    revised.extend(_choice(workspace, row["report_source"]) for row in case["scientific_reports"])
    return {"initial": initial, "revised": revised}


def _selection(choices, *, revised=False):
    collections = list(dict.fromkeys(row["source_collection_id"] for row in choices))
    return {"schema": reviews.SELECTION_SCHEMA,
            "title": LABEL + (" — revised field evidence and engineering closeout"
                             if revised else " — initial field quality review"),
            "purpose": ("Review the actual retained follow-up and original source records for the same "
                        "simulated headwaters case. The request, assignments and engineering disposition "
                        "are authored teaching inputs; scientific reports retain their original results."),
            "source_collection_ids": collections, "run_ids": [], "delivery_ids": [],
            "spatial_export_ids": [], "requirements": _clone(REQUIREMENTS),
            "notes": [LABEL + ": fictional customer and engineering participants.",
                      "Laboratory concentrations and model annual loads retain distinct units and time support.",
                      "The original customer request and engineering response remain separate immutable records."]}


def _response(workspace, review_id, created_at):
    if reviews.history(workspace, review_id):
        raise ValueError("An original response already exists; inspect it instead of authoring a new teaching request")
    draft = reviews.response_template(workspace, review_id, through_response_id=None)
    draft.update(created_at=created_at,
                 reviewer={"name": "Simulated project reviewer", "role": LABEL,
                           "organization": "Simulated headwaters teaching case"},
                 disposition="changes-requested",
                 summary=LABEL + ": show the follow-up evidence and preserve the original laboratory context.")
    texts = {
        "follow-up-evidence": (
            "changes-requested",
            "Explain how the initial duplicate precision finding was handled, including who owns the work "
            "and the original repeat collection and completed corrective-task evidence.",
            "Simulated field engineer"),
        "original-records": (
            "question",
            "Show the original sample IDs, laboratory result text and censored blank beside the repeat "
            "review, with the original source QA and intended-use decision kept visible.",
            "Simulated evidence reviewer"),
    }
    for item in draft["requirement_decisions"]:
        decision, requested, owner = texts[item["requirement_id"]]
        item.update(decision=decision, requested_change=LABEL + ": " + requested,
                    comment=LABEL + ": authored customer input for the teaching exercise.", assignee=owner)
    return draft


def _current_response(workspace, review_id, response_id):
    chain = reviews.history(workspace, review_id)
    if not chain or chain[-1]["id"] != response_id:
        raise ValueError("The customer has a newer response; continue that actual request in the review application")


def _planning(workspace, review_id, response_id):
    _current_response(workspace, review_id, response_id)
    if handbacks.history(workspace, review_id, response_id):
        raise ValueError("Engineering has an existing edition; open that original work instead of starting another plan")
    packet = handbacks.template(workspace, review_id, response_id=response_id)
    draft = packet["draft"]
    draft.update(prepared_by=_clone(AUTHOR), state="planning",
                 summary=LABEL + ": assigned review of the existing original field closeout evidence.")
    requests = {row["id"]: row for row in packet["requests"]}
    for item in draft["items"]:
        request = requests[item["request_id"]]
        item.update(owner=request["owner"] or "Simulated evidence reviewer",
                    note=LABEL + ": inspect the original retained reports and map their actual replacement artifacts.",
                    disposition="planned")
    return draft


def _ready(workspace, original_id, response_id, planning_id, revised_id, choices, binding):
    _current_response(workspace, original_id, response_id)
    packet = handbacks.template(workspace, original_id, response_id=response_id,
                                handback_id=planning_id, revised_review_id=revised_id)
    draft = packet["draft"]
    revision = workspace._get("reviews", revised_id)
    selected = {row["source_collection_id"] for row in choices}
    replacements = [row["id"] for row in revision["artifacts"]
                    if row.get("selection_kind") == "sources" and row.get("selection_id") in selected]
    if not replacements or len(selected) != 5:
        raise ValueError("Select all five original field source editions and their actual replacement artifacts")
    request_map = {row["id"]: row for row in packet["requests"]}
    closeout = binding["action_reports"][1:]
    report_ids = ", ".join(row["action_report_id"] for row in closeout)
    draft.update(prepared_by=_clone(AUTHOR), state="ready",
                 summary=LABEL + ": the actual retained closeout reports and source records are mapped to each request.")
    for item in draft["items"]:
        source = request_map[item["request_id"]]["source_id"]
        detail = ("The selected native closeout reports retain the original corrective task, repeat evidence "
                  "and reviewed intended use. Original action report IDs: " + report_ids + "."
                  if source == "follow-up-evidence" else
                  "The selected observation context and initial/repeat QC reports retain original sample "
                  "identities, laboratory text, declared control relationships, censored blank and source QA.")
        item.update(disposition="addressed", note=LABEL + ": " + detail,
                    replacement_artifact_ids=replacements[:],
                    replacement_requirement_ids=[source])
    return draft


def _verify_step(workspace, request, result):
    kind, value = request["kind"], request["value"]
    if kind == "sources":
        _verify_sources(workspace, value, result)
    elif kind == "review":
        original = workspace._get("reviews", identifier(result["id"]))
        reviews.show_review(workspace, original["id"], previews=False)
        if (original["selection"] != reviews._selection(value)
                or original["created_at"] != request["created_at"]):
            raise ValueError("The retained review differs from its original teaching request")
    elif kind == "response":
        rows = reviews.history(workspace, value["review_id"])
        original = next((row for row in rows if row["id"] == result["id"]), None)
        selected = workspace._get("reviews", value["review_id"])
        if original is None or original["response"] != reviews._checked_response(value, selected):
            raise ValueError("The retained customer input differs from its authored teaching request")
    elif kind == "handback":
        packet = handbacks.show(workspace, identifier(result["id"]))
        original = packet["handback"]
        source_review = workspace._get("reviews", value["review_id"])
        source_response = next(row for row in reviews.history(workspace, value["review_id"])
                               if row["id"] == value["response_id"])
        revision = (workspace._get("reviews", value["revised_review_id"])
                    if value.get("revised_review_id") else None)
        checked = handbacks._check(value, source_review, source_response, revision)
        if handbacks._draft(original) != checked or original["created_at"] != request["created_at"]:
            raise ValueError("The retained engineering edition differs from its original teaching draft")
    else:
        raise ValueError("Unknown original teaching step")


def _step(workspace, directory, name, factory, action):
    request_name, result_name = name + ".request.json", name + ".result.json"
    request_path, result_path = directory / request_name, directory / result_name
    if request_path.exists() or request_path.is_symlink():
        request = _read(directory, request_name)
    else:
        request = _put(directory, request_name, factory())
    if result_path.exists() or result_path.is_symlink():
        saved = _read(directory, result_name)
        if saved.get("step") != name or saved.get("request_sha256") != digest(request):
            raise ValueError("An original teaching step request or result changed")
        result = saved["result"]
    else:
        result = action(request)
        _verify_step(workspace, request, result)
        _put(directory, result_name, {"schema": SCHEMA, "step": name,
                                     "request_sha256": digest(request), "result": result})
    _verify_step(workspace, request, result)
    return result


def continue_review(workspace, field_operation_id, *, through="ready"):
    """Advance one existing simulated field case using the native review APIs."""
    if through not in PHASES:
        raise ValueError("Choose request, planning or ready")
    identity = _identity(workspace, field_operation_id)
    operation_id = digest(identity)
    directory = _root(workspace, operation_id, create=True)
    with held(directory / ".operation.lock", blocking=False):
        if (directory / "operation.json").exists():
            _, operation = _operation(workspace, operation_id)
            case = _field(workspace, operation)
        else:
            case = field.inspect_campaign(workspace, field_operation_id)
            if (case["phase"] != "closeout" or case["demo_id"] != field.DEMO_ID
                    or case["classification"] != field.LABEL):
                raise ValueError("Complete the existing original simulated field closeout first")
            operation = _put(directory, "operation.json", {
                "identity": identity, "created_at": now(), "field_binding": _binding(case)})
            _field(workspace, operation)
        created_at = operation["created_at"]
        sources = _step(workspace, directory, STEPS[0],
                        lambda: {"kind": "sources", "value": _source_request(case)},
                        lambda request: _sources(workspace, case))
        def review_step(name, choices, revised=False):
            return _step(workspace, directory, name,
                         lambda: {"kind": "review", "value": _selection(choices, revised=revised),
                                  "created_at": created_at},
                         lambda request: {"id": reviews.create_review(workspace, request["value"],
                                             created_at=request["created_at"])["id"]})
        original = review_step(STEPS[1], sources["initial"])
        response = _step(workspace, directory, STEPS[2],
                         lambda: {"kind": "response", "value": _response(workspace, original["id"], created_at)},
                         lambda request: {"id": reviews.import_response(workspace, request["value"])["id"]})
        if through in ("planning", "ready"):
            planned = _step(workspace, directory, STEPS[3],
                            lambda: {"kind": "handback",
                                     "value": _planning(workspace, original["id"], response["id"]),
                                     "created_at": created_at},
                            lambda request: {"id": handbacks.save(workspace, request["value"],
                                               created_at=request["created_at"])["id"]})
        if through == "ready":
            revised = review_step(STEPS[4], sources["revised"], revised=True)
            _step(workspace, directory, STEPS[5],
                  lambda: {"kind": "handback",
                           "value": _ready(workspace, original["id"], response["id"], planned["id"],
                                           revised["id"], sources["revised"], operation["field_binding"]),
                           "created_at": created_at},
                  lambda request: {"id": handbacks.save(workspace, request["value"],
                                      created_at=request["created_at"])["id"]})
        return _inspect(workspace, operation_id)


def _inspect(workspace, operation_id):
    directory, operation = _operation(workspace, operation_id)
    case = _field(workspace, operation)
    completed = {}
    missing = False
    for name in STEPS:
        path = directory / (name + ".result.json")
        if not path.exists() and not path.is_symlink():
            missing = True
            continue
        if missing:
            raise ValueError("The teaching operation has a missing original predecessor result")
        request = _read(directory, name + ".request.json")
        result = _read(directory, name + ".result.json")
        if result.get("step") != name or result.get("request_sha256") != digest(request):
            raise ValueError("An original teaching request or completion record changed")
        _verify_step(workspace, request, result["result"])
        completed[name] = result["result"]
    original_id = completed.get(STEPS[1], {}).get("id")
    response_id = completed.get(STEPS[2], {}).get("id")
    planning_id = completed.get(STEPS[3], {}).get("id")
    revised_id = completed.get(STEPS[4], {}).get("id")
    ready_id = completed.get(STEPS[5], {}).get("id")
    worklist = review_worklist.select(workspace, {"review_id": original_id}, complete=True) if original_id else None
    return {"schema": SCHEMA, "classification": LABEL, "operation_id": operation_id,
            "project_id": workspace.project["id"], "field_operation_id": operation["identity"]["field_operation_id"],
            "plan_id": case["plan_id"], "field_binding": operation["field_binding"],
            "phase": "ready" if ready_id else "planning" if planning_id else "request" if response_id else "preparing",
            "completed_steps": list(completed), "directory": directory.relative_to(workspace.root).as_posix(),
            "original_review_id": original_id, "response_id": response_id,
            "planning_handback_id": planning_id, "revised_review_id": revised_id, "handback_id": ready_id,
            "sources": completed.get(STEPS[0]), "current_worklist": worklist,
            "original_response": next((row for row in reviews.history(workspace, original_id)
                                       if row["id"] == response_id), None) if response_id else None,
            "engineering_handback": handbacks.show(workspace, ready_id or planning_id) if (ready_id or planning_id) else None,
            "open_review": {"kind": "customer-reviews", "id": original_id} if original_id else None}


def inspect_review(workspace, operation_id):
    """Read the original teaching records and the current real worklist separately."""
    directory = _root(workspace, operation_id)
    with held(directory / ".operation.lock", blocking=False):
        return _inspect(workspace, operation_id)


def _outside(workspace, path):
    path = _directory(Path(path).expanduser())
    if (path.resolve().is_relative_to(Path(workspace.root).resolve())
            or path.resolve().is_relative_to(Path(__file__).resolve().parents[1])):
        raise ValueError("Keep teaching exports and local viewers outside the original Workspace and application")
    return path


def _destination(workspace, path, identity):
    directory = _outside(workspace, path)
    marker = directory / "operation.json"
    if directory.exists() and any(directory.iterdir()) and not marker.exists():
        raise ValueError("Use a new destination or this exact operation's original receiving/export directory")
    _directory(directory, create=True)
    if marker.exists() or marker.is_symlink():
        if _read(directory, "operation.json") != identity:
            raise ValueError("This destination belongs to a different original teaching operation")
    else:
        _put(directory, "operation.json", identity)
    return directory


def _reference(result):
    return {key: result[key] for key in
            ("operation_id", "project_id", "field_operation_id", "plan_id", "field_binding",
             "original_review_id", "response_id", "planning_handback_id", "revised_review_id", "handback_id")}


def _descriptor(directory, name):
    path = reviews._regular(directory, name)
    return {"path": name, "bytes": path.stat().st_size, "sha256": file_digest(path)}


def _verify_member(directory, row):
    path = reviews._regular(directory, row["path"])
    if path.stat().st_size != row["bytes"] or file_digest(path) != row["sha256"]:
        raise ValueError("An original teaching packet member differs: " + row["path"])
    return path


def _archive_owned(module, directory, desk, archive, package_sha256, operation_id):
    """Recover only this native export's own interrupted archive attempts."""
    marker = {"schema": SCHEMA, "kind": "archive-attempt", "operation_id": operation_id,
              "package_sha256": package_sha256, "archive": archive.name}
    prefix = ".teaching-archive-" + archive.stem + "-"
    for pending in sorted(directory.glob(prefix + "*")):
        _directory(pending)
        owner = pending / "operation.json"
        if not owner.exists() and not owner.is_symlink():
            if not any(pending.iterdir()):
                pending.rmdir()
            continue
        if _read(pending, "operation.json") != marker:
            raise ValueError("An unfinished native archive belongs to a different original export")
        candidate = pending / archive.name
        if candidate.exists() or candidate.is_symlink():
            reviews._regular(pending, archive.name)
            checked = module.inspect_packet(candidate)
            if checked["manifest"]["package_sha256"] != package_sha256:
                raise ValueError("The retained archive candidate differs from its original native desk")
            os.link(candidate, archive)
            shutil.rmtree(pending)
            return
        # The exact owner marker was durable before native archive creation.
        # No live writer shares this directory while the operation lock is held.
        shutil.rmtree(pending)
    pending = Path(tempfile.mkdtemp(prefix=prefix, dir=directory))
    try:
        _put(pending, "operation.json", marker)
        candidate = pending / archive.name
        module.archive_packet(desk, candidate)
        if module.inspect_packet(candidate)["manifest"]["package_sha256"] != package_sha256:
            raise ValueError("The complete native archive differs from its selected export")
        os.link(candidate, archive)
    finally:
        shutil.rmtree(pending)


def _packet_export(workspace, directory, selected, *, handback=False):
    module = handbacks if handback else reviews
    stem = "engineering-handback" if handback else "original-review"
    desk, archive = directory / stem, directory / (stem + ".zip")
    if desk.exists() or desk.is_symlink():
        module.describe_export(desk)
    elif handback:
        module.export_handback(workspace, selected["handback_id"], desk)
    else:
        module.export_review(workspace, selected["original_review_id"], desk,
                             through_response_id=selected["response_id"])
    inspected = module.inspect_packet(desk)
    manifest = inspected["manifest"]
    if (manifest["project_id"] != selected["project_id"]
            or manifest["review_id"] != selected["original_review_id"]):
        raise ValueError("The original exported desk belongs to another selected review or project")
    if handback:
        row = inspected["handback"]
        if (row["id"] != selected["handback_id"] or row["response_id"] != selected["response_id"]
                or row["revised_review_id"] != selected["revised_review_id"]):
            raise ValueError("The exported engineering desk differs from the exact selected handback")
    elif manifest["response_ids"] != [selected["response_id"]]:
        raise ValueError("The original review desk differs from its exact authored response generation")
    if not archive.exists() and not archive.is_symlink():
        _archive_owned(module, directory, desk, archive, manifest["package_sha256"], selected["operation_id"])
    result = module.describe_export(desk, archive=archive)
    return {"directory": stem, "archive": _descriptor(directory, stem + ".zip"),
            "package_sha256": result["package_sha256"], "members": result["members"]}



PRESENTATION_SCHEMA = "upstate.simulated-customer-presentation/v1"


def _rendering_sources():
    root = Path(__file__).resolve().parents[1]
    return [_descriptor(root, name) for name in
            ("model/simulated_customer_review.py", "model/reviews.py",
             "model/review_handback.py", "operator/review_app.html")]


def _export_closure(directory, exported):
    """The complete declared case, both native desks and retained earlier editions."""
    names = {"case-manifest.json", *(row["path"] for row in exported["members"])}
    for key in ("original_review", "engineering_handback"):
        packet = exported[key]
        names.add(packet["archive"]["path"])
        folder = directory / packet["directory"]
        def failed(error):
            raise ValueError("Cannot enumerate the complete customer edition: " + str(error)) from error
        for current, folders, files in os.walk(folder, followlinks=False, onerror=failed):
            for name in folders:
                if (Path(current) / name).is_symlink():
                    raise ValueError("The original customer edition contains a directory alias")
            for name in files:
                names.add((Path(current) / name).relative_to(directory).as_posix())
    if exported.get("presentation") is not None:
        presentation = _read(directory, "presentation.json")
        names.update(row["path"] for row in presentation["previous_files"])
    return [_descriptor(directory, name) for name in sorted(names)]


def _retain_previous_edition(directory, source, previous, rendering_sources, selected):
    inventory = _export_closure(source, previous)
    for item in inventory:
        body = _verify_member(source, item).read_bytes()
        name = "previous-edition/" + item["path"]
        _directory((directory / name).parent, create=True)
        _body(directory, name, body)
        # A concurrent source change must not silently select another edition.
        _verify_member(source, item)
    copied = inspect_export(directory / "previous-edition")
    if copied != previous or _export_closure(source, previous) != inventory:
        raise ValueError("The complete previous customer edition changed during receiving")
    value = {"schema": PRESENTATION_SCHEMA, "same_case": selected,
             "previous_manifest": _descriptor(directory, "previous-edition/case-manifest.json"),
             "previous_files": [{**item, "path": "previous-edition/" + item["path"]} for item in inventory],
             "rendering_sources": rendering_sources,
             "meaning": "A new presentation of the same original customer decisions and scientific evidence. "
                        "The full earlier edition remains independently inspectable and reopenable."}
    _put(directory, "presentation.json", value)
    return _descriptor(directory, "presentation.json")


def _inspect_presentation(directory, exported):
    descriptor = exported.get("presentation")
    if descriptor is None:
        return
    if descriptor != _descriptor(directory, "presentation.json"):
        raise ValueError("The selected customer presentation descriptor differs")
    value = _read(directory, "presentation.json")
    if (value.get("schema") != PRESENTATION_SCHEMA or value.get("same_case") != _reference(exported)
            or value.get("previous_manifest", {}).get("path") != "previous-edition/case-manifest.json"):
        raise ValueError("The presentation must retain the same complete original customer case")
    _verify_member(directory, value["previous_manifest"])
    previous = inspect_export(directory / "previous-edition")
    if _reference(previous) != _reference(exported):
        raise ValueError("The earlier presentation contains different customer decisions")
    expected = [{**row, "path": "previous-edition/" + row["path"]}
                for row in _export_closure(directory / "previous-edition", previous)]
    if value.get("previous_files") != expected:
        raise ValueError("Retain the complete previous customer edition and its original native packages")
    for item in expected:
        _verify_member(directory, item)
    expected_names = {"model/simulated_customer_review.py", "model/reviews.py",
                      "model/review_handback.py", "operator/review_app.html"}
    sources = value.get("rendering_sources")
    if (not isinstance(sources, list) or len(sources) != len(expected_names)
            or {item.get("path") for item in sources} != expected_names):
        raise ValueError("Retain every original presentation source identity")
    for item in sources:
        identifier(item.get("sha256"))
        if isinstance(item.get("bytes"), bool) or not isinstance(item.get("bytes"), int) or item["bytes"] <= 0:
            raise ValueError("The original presentation source length differs")
    # Changed HTML remains presentation only: original record and source evidence
    # in both complete native packages must equal the selected previous edition.
    for stem in ("original-review", "engineering-handback"):
        module = reviews if stem == "original-review" else handbacks
        current_packet = module.inspect_packet(directory / stem)
        previous_packet = module.inspect_packet(directory / "previous-edition" / stem)
        if stem == "original-review":
            if current_packet["packet"] != previous_packet["packet"]:
                raise ValueError("A presentation update changed the original review or response history")
        else:
            document = _read(directory / stem, "handback.json")
            if document != _read(directory / "previous-edition" / stem, "handback.json"):
                raise ValueError("A presentation update changed the original engineering history")
            for review in document["reviews"]:
                current = reviews.inspect_packet(directory / stem / review["path"])["packet"]
                earlier = reviews.inspect_packet(directory / "previous-edition" / stem / review["path"])["packet"]
                if current != earlier:
                    raise ValueError("A presentation update changed a linked original review or source artifact")


def presentation_descends_from(directory, expected):
    """Match a complete earlier receipt through verified presentation lineage."""
    directory = _directory(Path(directory).expanduser())
    current = inspect_export(directory)
    selected = _reference(expected)
    while True:
        if _reference(current) != selected:
            return False
        if current == expected:
            return True
        if current.get("presentation") is None:
            return False
        directory = directory / "previous-edition"
        current = inspect_export(directory)


def export_review_case(workspace, operation_id, destination, *, previous=None):
    """Export both complete native desks and a full, labelled worklist snapshot."""
    selected_result = inspect_review(workspace, operation_id)
    if selected_result["phase"] != "ready":
        raise ValueError("Complete the engineering handback before exporting the full teaching case")
    selected = _reference(selected_result)
    source, earlier, rendering_sources = None, None, None
    identity = {"schema": SCHEMA, "kind": "export", "classification": LABEL, **selected}
    if previous is not None:
        source = _directory(Path(previous).expanduser())
        earlier = inspect_export(source)
        if _reference(earlier) != selected:
            raise ValueError("Re-export the same original ready operation and exact response generation")
        target = _outside(workspace, destination)
        if target.resolve().is_relative_to(source.resolve()) or source.resolve().is_relative_to(target.resolve()):
            raise ValueError("Preserve the previous presentation in a separate ordinary source directory")
        rendering_sources = _rendering_sources()
        identity["presentation"] = {
            "previous_manifest_sha256": file_digest(reviews._regular(source, "case-manifest.json")),
            "rendering_sources": rendering_sources}
    directory = _destination(workspace, destination, identity)
    with held(directory / ".operation.lock", blocking=False):
        _put(directory, "selection.json", selected)
        presentation = None
        if source is not None:
            presentation = _retain_previous_edition(directory, source, earlier, rendering_sources, selected)
            # The original worklist is a source-dated snapshot, not a new customer decision.
            for name in ("current-worklist.json", "current-worklist.csv"):
                _body(directory, name, reviews._regular(source, name).read_bytes())
        original = _packet_export(workspace, directory, selected)
        handback = _packet_export(workspace, directory, selected, handback=True)
        # Capture the complete current filtered worklist once. Later real replies
        # remain distinguishable from the historical response fixed in both desks.
        if not (directory / "current-worklist.json").exists():
            snapshot = review_worklist.select(workspace, {"review_id": selected["original_review_id"]}, complete=True)
            _put(directory, "current-worklist.json", snapshot)
        snapshot = _read(directory, "current-worklist.json")
        if snapshot["filters"]["review_id"] != selected["original_review_id"]:
            raise ValueError("The saved worklist belongs to another selected review")
        if presentation is None:
            _body(directory, "current-worklist.csv", review_worklist.csv_document(snapshot).encode("utf-8"))
        readme = (
            "# Simulated field review and engineering handback\n\n"
            + LABEL + ". Customer wording and engineering dispositions are authored teaching inputs.\n\n"
            "Open original-review/index.html for the original response generation, then "
            "engineering-handback/index.html for the ready engineering edition and its linked original/revised evidence.\n\n"
            "The two ZIPs are complete native application packages. Receive original-review.zip through "
            "Customer reviews -> Receive package; receive engineering-handback.zip through the existing Handbacks workflow. "
            "Restore the original scientific project first, then use this module's receive command to retain the original "
            "review package and open its maintained local viewer.\n\n"
            "current-worklist.json and .csv contain every matching request at their stated snapshot time. "
            "That current snapshot is separate from the historical response pinned in the two native packages. "
            "Engineering addressed items do not create customer acceptance.\n"
        )
        if presentation is not None:
            readme += ("\n## Presentation history\n\nThis edition preserves the same original review, customer response "
                       "and engineering decisions. Open previous-edition/README.md and its two complete desks "
                       "for the unchanged earlier presentation. presentation.json retains the full file and "
                       "renderer identities. The current and earlier packages remain independently inspectable.\n")
        _body(directory, "README.md", readme.encode("utf-8"))
        members = [_descriptor(directory, name) for name in
                   ("operation.json", "selection.json", "current-worklist.json", "current-worklist.csv", "README.md")]
        value = {"schema": SCHEMA, "kind": "portable-teaching-case", "classification": LABEL,
                 **selected, "original_review": original, "engineering_handback": handback,
                 "members": members, "current_worklist_snapshot_id": snapshot["snapshot_id"]}
        if presentation is not None:
            if _rendering_sources() != rendering_sources:
                raise ValueError("The presentation implementation changed during this export")
            value["members"].append(presentation)
            value["presentation"] = presentation
        _put(directory, "case-manifest.json", value)
        inspected = inspect_export(directory)
        return {**inspected, "directory": str(directory),
                "original_index": str(directory / original["directory"] / "index.html"),
                "handback_index": str(directory / handback["directory"] / "index.html")}


def inspect_export(path):
    """Validate every original native archive/desk plus the complete companion files."""
    directory = _directory(Path(path).expanduser())
    value = _read(directory, "case-manifest.json")
    if (value.get("schema") != SCHEMA or value.get("kind") != "portable-teaching-case"
            or value.get("classification") != LABEL):
        raise ValueError("Select the complete original simulated customer-review case")
    selected = _read(directory, "selection.json")
    if any(value.get(key) != item for key, item in selected.items()):
        raise ValueError("The teaching case manifest differs from its original selection")
    expected = {"operation.json", "selection.json", "current-worklist.json", "current-worklist.csv", "README.md"}
    if value.get("presentation") is not None:
        expected.add("presentation.json")
    if (len(value.get("members", [])) != len(expected)
            or {item.get("path") for item in value["members"]} != expected):
        raise ValueError("The teaching case has an incomplete or repeated companion inventory")
    for item in value["members"]:
        _verify_member(directory, item)
    for key, module, stem in (("original_review", reviews, "original-review"),
                              ("engineering_handback", handbacks, "engineering-handback")):
        item = value[key]
        if item["directory"] != stem or item["archive"]["path"] != stem + ".zip":
            raise ValueError("Select the original native review and handback package paths")
        archive = _verify_member(directory, item["archive"])
        described = module.describe_export(directory / stem, archive=archive)
        if (described["package_sha256"] != item["package_sha256"]
                or described["members"] != item["members"]
                or described["project_id"] != value["project_id"]
                or described["review_id"] != value["original_review_id"]):
            raise ValueError("The native package differs from the selected teaching case")
        packet = module.inspect_packet(archive)
        if key == "original_review":
            if packet["manifest"]["response_ids"] != [value["response_id"]]:
                raise ValueError("The original response generation differs")
        elif (packet["handback"]["id"] != value["handback_id"]
              or packet["handback"]["revised_review_id"] != value["revised_review_id"]
              or packet["handback"]["response_id"] != value["response_id"]):
            raise ValueError("The original ready engineering generation differs")
    snapshot = _read(directory, "current-worklist.json")
    if (snapshot["snapshot_id"] != value["current_worklist_snapshot_id"]
            or snapshot["filters"]["review_id"] != value["original_review_id"]
            or snapshot["offset"] != 0 or snapshot["next_offset"] is not None
            or snapshot["total"] != len(snapshot["rows"])):
        raise ValueError("The exported current worklist does not contain its complete selected snapshot")
    _inspect_presentation(directory, value)
    return value


def receive_review_case(workspace, source, destination):
    """Join the ordinary packages into the same restored project and open its viewer."""
    source = _directory(Path(source).expanduser())
    exported = inspect_export(source)
    if exported["project_id"] != workspace.project["id"]:
        raise ValueError("Restore the actual scientific project selected by this original teaching case")
    selected = {key: exported[key] for key in
                ("operation_id", "project_id", "field_operation_id", "plan_id", "field_binding",
                 "original_review_id", "response_id", "planning_handback_id", "revised_review_id", "handback_id")}
    original = inspect_review(workspace, selected["operation_id"])
    if _reference(original) != selected:
        raise ValueError("The restored project differs from the selected original teaching operation")
    destination = _outside(workspace, destination)
    if destination.resolve().is_relative_to(source.resolve()) or source.resolve().is_relative_to(destination.resolve()):
        raise ValueError("Keep the independent receiving directory separate from the source teaching packet")
    identity = {"schema": SCHEMA, "kind": "receive", "classification": LABEL,
                **selected, "source_manifest_sha256": file_digest(reviews._regular(source, "case-manifest.json"))}
    directory = _destination(workspace, destination, identity)
    with held(directory / ".operation.lock", blocking=False):
        archive_ref = exported["original_review"]["archive"]
        original_archive = _verify_member(source, archive_ref)
        filename, sha = original_archive.name, archive_ref["sha256"]
        request_name = "receive-request.json"
        if (directory / request_name).exists():
            request = _read(directory, request_name)
        else:
            request = _put(directory, request_name, {
                "sha256": sha, "filename": filename,
                "upload_id": digest({"sha256": sha, "filename": filename, "media_type": "application/zip"}),
                "operation_id": "simreview-" + digest(identity), "received_at": now(),
                "expected_review_id": selected["original_review_id"]})
        if (request["sha256"] != sha or request["filename"] != filename
                or request["operation_id"] != "simreview-" + digest(identity)
                or request["expected_review_id"] != selected["original_review_id"]):
            raise ValueError("The retained native receiving request names a different original package")
        receipt, joined = review_receiving.receive(workspace, original_archive, **request)
        local_view = review_receiving.open_view(workspace, receipt["id"], directory / "review-views")
        local_view = {key: str(value) if isinstance(value, Path) else value
                      for key, value in local_view.items()}
        handback_archive = _verify_member(source, exported["engineering_handback"]["archive"])
        handback_directory = directory / "engineering-handback"
        if handback_directory.exists() or handback_directory.is_symlink():
            reopened = handbacks.describe_export(handback_directory)
            if reopened["package_sha256"] != exported["engineering_handback"]["package_sha256"]:
                raise ValueError("The retained local engineering desk differs from its received original")
            # The native receiver joins before publication. A completed local desk
            # therefore already has its original records; reopening verifies them.
            packet = handbacks.show(workspace, selected["handback_id"])
            if packet["handback"]["response_id"] != selected["response_id"]:
                raise ValueError("The restored engineering edition belongs to a different response")
        else:
            reopened = handbacks.receive_packet(handback_archive, handback_directory, workspace=workspace)
        result = {"schema": SCHEMA, "classification": LABEL, **selected,
                  "receipt_id": receipt["id"], "incoming_response_id": receipt["incoming_response_id"],
                  "review_view": local_view, "engineering_desk": reopened,
                  "current_worklist": review_worklist.select(workspace, {"review_id": selected["original_review_id"]},
                                                            complete=True)}
        # This inspection is deliberately fresh; historical receipt identity
        # remains stable while current human replies and native viewer editions
        # may advance after the first successful receive.
        _put(directory, "received-identity.json", {
            "schema": SCHEMA, **selected, "receipt_id": receipt["id"],
            "incoming_response_id": receipt["incoming_response_id"]})
        return result


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    advance = sub.add_parser("continue", help="Advance the existing original field case")
    advance.add_argument("--field-operation", required=True)
    advance.add_argument("--through", choices=PHASES, default="ready")
    inspect = sub.add_parser("inspect", help="Open the retained case and current actual worklist")
    inspect.add_argument("--operation", required=True)
    export = sub.add_parser("export", help="Write complete native review and handback packages")
    export.add_argument("--operation", required=True)
    export.add_argument("--output", required=True)
    export.add_argument("--previous", help="Explicit new presentation of this complete earlier export; preserves it")
    receive = sub.add_parser("receive", help="Reopen both packages in the same restored original project")
    receive.add_argument("--source", required=True)
    receive.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.command == "continue":
        result = continue_review(workspace, args.field_operation, through=args.through)
    elif args.command == "inspect":
        result = inspect_review(workspace, args.operation)
    elif args.command == "export":
        result = export_review_case(workspace, args.operation, args.output, previous=args.previous)
    else:
        result = receive_review_case(workspace, args.source, args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
