"""Continue explicitly selected original report receiving operations in order.

This module is called only by the maintained receive_operator.py entrypoint.
Each item invokes that same receiver and retains its original output/task IDs.
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import re

from model.common import atomic_json, digest, held, read_json
from model.workspace import Workspace

SCHEMA = "upstate.scientific-report-receiving-course/v1"


def _require(value, message):
    if not value:
        raise ValueError(message)


def _path(value, base):
    _require(isinstance(value, str) and value and "\0" not in value,
             "Course paths must be nonempty ordinary paths.")
    path = Path(value)
    return (path if path.is_absolute() else base / path).resolve()


def _at(value, path):
    _require(isinstance(path, list) and path and
             all(isinstance(key, str) and key for key in path),
             "A receipt selector is a nonempty list of original object keys.")
    for key in path:
        _require(isinstance(value, dict) and key in value,
                 "The original source receipt is missing " + ".".join(path))
        value = value[key]
    return value


def _validate(course):
    _require(isinstance(course, dict) and
             set(course) <= {"schema", "operation_id", "project_id", "steps"} and
             course.get("schema") == SCHEMA,
             "Use an original scientific-report-receiving-course/v1 manifest.")
    for name in ("operation_id", "project_id"):
        _require(isinstance(course.get(name), str) and course[name],
                 "Retain the course's original " + name + ".")
    steps = course.get("steps")
    _require(isinstance(steps, list) and steps, "Select at least one original report course.")
    prior = set()
    allowed = {"id", "origin", "depends_on", "output", "output_from_receipt",
               "manifest", "selection", "selection_file", "source_receipt",
               "title", "contact_json", "selected_study"}
    for item in steps:
        _require(isinstance(item, dict) and not set(item) - allowed,
                 "A course item contains an unsupported field.")
        key = item.get("id")
        _require(isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", key)
                 and key not in prior, "Use distinct ordinary course item IDs.")
        _require(isinstance(item.get("origin"), str) and item["origin"],
                 "Retain each item's original accepted operation reference.")
        dependencies = item.get("depends_on", [])
        _require(isinstance(dependencies, list) and
                 all(isinstance(name, str) and name in prior for name in dependencies),
                 "Dependencies must name earlier original report items.")
        prior.add(key)
        _require(sum(name in item for name in
                     ("manifest", "selection", "selection_file", "source_receipt")) == 1,
                 "Each report item needs exactly one original source selection.")
        _require(("output" in item) != ("output_from_receipt" in item),
                 "Choose the original output path or its original receipt-bound suffix.")
        _require(isinstance(item.get("selected_study"), bool),
                 "Retain each original selected-study choice explicitly.")
        if "manifest" in item:
            _require(isinstance(item["manifest"], list) and item["manifest"] and
                     all(isinstance(path, str) and path for path in item["manifest"]),
                     "Keep original source manifests in reading order.")
        if "source_receipt" in item:
            source = item["source_receipt"]
            _require(isinstance(source, dict) and
                     set(source) <= {"path", "sources_path", "title_path", "checks"} and
                     "path" in source and "sources_path" in source,
                     "A source receipt needs its original file and source selector.")
            _require(isinstance(source.get("checks", []), list),
                     "Receipt checks must retain an ordered list.")
            for check in source.get("checks", []):
                _require(isinstance(check, dict) and set(check) == {"path", "equals"},
                         "Receipt checks retain an original field path and exact value.")
        if "output_from_receipt" in item:
            suffix = item["output_from_receipt"]
            _require("source_receipt" in item and isinstance(suffix, dict) and
                     set(suffix) == {"directory", "prefix", "path"} and
                     isinstance(suffix["prefix"], str) and
                     re.fullmatch(r"[A-Za-z0-9_-]*", suffix["prefix"]),
                     "Receipt-bound outputs use the original directory, prefix and ID field.")
    return steps


def _resolve_item(item, base, root, args, identity):
    options = argparse.Namespace(**vars(args))
    options.course = None
    options.create_workspace = False
    options.manifest = None
    options.selection = None
    options.title = item.get("title")
    options.contact_json = None
    options.selected_study = item["selected_study"]
    # Browser receiving remains its already accepted separate continuation.
    options.browser_node = None
    options.video = False
    inputs, receipt, contact = [], None, None

    def captured(path):
        path = _path(path, base)
        _require(path.is_file(), "The original source dependency has not arrived: " + str(path))
        before = identity(path)
        value = read_json(path)
        _require(identity(path) == before, "The original source changed while receiving: " + str(path))
        inputs.append({"path": str(path), **before})
        return value

    if "source_receipt" in item:
        source = item["source_receipt"]
        receipt = captured(source["path"])
        for check in source.get("checks", []):
            _require(digest(_at(receipt, check["path"])) == digest(check["equals"]),
                     "The source receipt differs at " + ".".join(check["path"]))
        selected = _at(receipt, source["sources_path"])
        selected = [selected] if isinstance(selected, dict) else selected
        _require(isinstance(selected, list) and selected and all(
            isinstance(row, dict) and set(row) == {"source_collection_id", "source_id"}
            and all(isinstance(value, str) and value for value in row.values())
            for row in selected), "The receipt must return complete original source choices.")
        selection = {"sources": selected}
        if "title_path" in source:
            selection["title"] = _at(receipt, source["title_path"])
    elif "selection_file" in item:
        selection = captured(item["selection_file"])
    elif "selection" in item:
        selection = copy.deepcopy(item["selection"])
    else:
        selection = None
        options.manifest = [_path(path, base) for path in item["manifest"]]
        for path in options.manifest:
            captured(str(path))

    if selection is not None:
        _require(isinstance(selection, dict) and set(selection) <= {"sources", "title", "contact"}
                 and isinstance(selection.get("sources"), list) and selection["sources"],
                 "Keep the original ordered sources, optional title and contact.")
        selected_file = root / "selections" / (item["id"] + ".json")
        selected_file.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(selected_file, selection, immutable=True)
        options.selection = selected_file
    if "contact_json" in item:
        contact = captured(item["contact_json"])
        contact_file = root / "selections" / (item["id"] + "-contact.json")
        contact_file.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(contact_file, contact, immutable=True)
        options.contact_json = contact_file
    if "output" in item:
        options.output = _path(item["output"], base)
    else:
        suffix = item["output_from_receipt"]
        value = _at(receipt, suffix["path"])
        _require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,180}", value),
                 "The original report source ID must be an ordinary output-name component.")
        options.output = _path(suffix["directory"], base) / (suffix["prefix"] + value)
    _require(not options.output.is_relative_to(root) and not root.is_relative_to(options.output),
             "Keep each original report output separate from the course checkpoint directory.")
    binding = {"id": item["id"], "origin": item["origin"], "inputs": inputs,
               "output": str(options.output), "manifest": [str(path) for path in options.manifest or []],
               "selection": selection, "title": options.title,
               "contact": contact,
               "selected_study": options.selected_study}
    bound_file = root / "bindings" / (item["id"] + ".json")
    bound_file.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(bound_file, binding, immutable=True)
    options.resume = options.output.exists()
    return options, binding


def run(args, receive, application, identity):
    _require(not args.create_workspace, "A receiving course continues its existing original Workspace.")
    _require(args.title is None and args.contact_json is None and not args.selected_study
             and args.browser_node is None and not args.video,
             "Keep report title/contact/selected-study choices on their original course items; "
             "use each retained receipt for its separate browser continuation.")
    _require(args.timeout > 0 and 1 <= args.upload_limit_gib <= 64,
             "Use the maintained receiver's positive timeout and upload capacity.")
    source = args.course.resolve(strict=True)
    original_identity = identity(source)
    course = read_json(source)
    _require(identity(source) == original_identity, "The course source changed during reading.")
    steps = _validate(course)
    workspace, root = args.workspace.resolve(), args.output.resolve()
    project = Workspace(workspace).project
    _require(project["id"] == course["project_id"], "Continue the original project named by this course.")
    _require(not root.is_relative_to(workspace) and not workspace.is_relative_to(root)
             and not root.is_relative_to(application) and not application.is_relative_to(root),
             "Keep the course, original Workspace and application in separate trees.")
    if root.exists():
        _require(args.resume and root.is_dir(), "Use --resume for this retained receiving course.")
    else:
        _require(not args.resume, "The original receiving course directory is absent.")
        root.mkdir(parents=True)
    with held(root / ".scientific-report-course.lock", blocking=False):
        selected = {"schema": SCHEMA, "course": course, "workspace": str(workspace),
                    "source": {"path": str(source), **original_identity}}
        selection_file = root / "course-selection.json"
        if not selection_file.exists():
            _require(not any(path.name != ".scientific-report-course.lock" for path in root.iterdir()),
                     "The retained course lacks its original selection.")
        atomic_json(selection_file, selected, immutable=True)
        state_file = root / "scientific-report-course.json"
        state = read_json(state_file) if state_file.exists() else {
            "schema": SCHEMA, "operation_id": course["operation_id"],
            "project_id": project["id"], "workspace": str(workspace),
            "selection_sha256": digest(selected), "steps": {}}
        _require(state.get("selection_sha256") == digest(selected),
                 "Reopen the same original course selection.")
        state["state"] = "running"
        atomic_json(state_file, state)

        def save(key, status, **values):
            previous = state["steps"].get(key, {})
            state["steps"][key] = {**previous, "state": status, **values}
            atomic_json(state_file, state)
            print(json.dumps({"course": course["operation_id"], "step": key, "state": status,
                              **values}, sort_keys=True, allow_nan=False), flush=True)

        outputs = {}
        for item in steps:
            key = item["id"]
            unmet = [name for name in item.get("depends_on", [])
                     if state["steps"].get(name, {}).get("state") != "complete"]
            if unmet:
                save(key, "waiting_dependency", dependencies=unmet)
                continue
            try:
                options, binding = _resolve_item(item, source.parent, root, args, identity)
                for other, output in outputs.items():
                    _require(not options.output.is_relative_to(output)
                             and not output.is_relative_to(options.output),
                             "Original course outputs overlap: " + other + " and " + key)
                outputs[key] = options.output
                save(key, "receiving", origin=item["origin"], output=str(options.output),
                     binding_sha256=digest(binding))
                code = receive(options)
                _require(code == 0, "The original report receiver returned " + str(code))
                receipt_file = options.output / "scientific-report-receiving.json"
                receipt = read_json(receipt_file)
                _require(receipt.get("state") == "complete"
                         and receipt.get("schema") == "upstate.scientific-report-receiving-workflow/v1"
                         and receipt.get("project_id") == project["id"]
                         and receipt.get("original_workspace") == str(workspace),
                         "The completed report belongs to another original receiving course.")
                save(key, "complete", receipt={"path": str(receipt_file), **identity(receipt_file)},
                     original_operation_id=receipt["operation_id"], edition_id=receipt["edition_id"],
                     tasks=receipt["tasks"], error=None)
            except BaseException as error:
                interrupted = not isinstance(error, Exception)
                if interrupted:
                    state["state"] = "interrupted"
                save(key, "interrupted" if interrupted else "needs_input_or_repair",
                     error={"type": type(error).__name__, "message": str(error)})
                if interrupted:
                    raise
                # Each independent ready original proceeds in this same invocation.
                continue
        state["state"] = ("complete" if all(state["steps"].get(item["id"], {}).get("state") == "complete"
                                             for item in steps) else "incomplete")
        atomic_json(state_file, state)
        print(json.dumps({"course": course["operation_id"], "state": state["state"],
                          "receipt": str(state_file)}, sort_keys=True), flush=True)
        return 0 if state["state"] == "complete" else 2
