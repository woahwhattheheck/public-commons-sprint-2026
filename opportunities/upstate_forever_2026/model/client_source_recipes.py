"""Durable reusable source interpretations; original intake remains the writer.

TokenJunkieLabs. Recipes never infer scientific units, accept approximate header
matches, or replace a source inspection. All references are complete native JSON.
"""
from __future__ import annotations

from copy import deepcopy
import re

from model.common import digest
from model.client_source_files import checked_selection, need, text

RECIPE_SCHEMA = "upstate.client-source-recipe/v1"
DEFINITION_SCHEMA = "upstate.client-source-recipe-definition/v1"
USE_SCHEMA = "upstate.client-source-recipe-use/v1"
HEX = re.compile(r"^[0-9a-f]{64}$")
FRESH_FIELDS = ("title", "vintage", "uri", "units", "period", "timezone",
                "notes", "reviewer", "reference")
REVIEW_AREAS = ("source", "mapping", "scientific_role", "units")
# Native semantics retained as defaults; source-specific declarations are reset.
DEFAULT_FIELDS = ("role", "resampling", "models")


def sha(value, name="digest"):
    need(isinstance(value, str) and HEX.fullmatch(value), "Keep the complete " + name + ".")
    return value


def object_id(value, name="identity"):
    need(isinstance(value, str) and 0 < len(value) <= 180 and
         re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", value), "Keep an ordinary " + name + ".")
    return value


def _inspection(value):
    need(isinstance(value, dict) and value.get("schema") == "upstate.client-source-operation/v1" and
         value.get("action") == "client-source.inspect" and value.get("state") == "complete" and
         isinstance(value.get("files"), list) and value["files"], "Select a complete original source inspection.")
    object_id(value.get("id"), "inspection identity")
    text(value.get("project_id"), "original project", True)
    return value


def part_at(inspection, file_index, part_index):
    _inspection(inspection)
    need(type(file_index) is int and 0 <= file_index < len(inspection["files"]),
         "Choose a file from this exact new inspection.")
    file = inspection["files"][file_index]
    need(not file.get("error") and isinstance(file.get("inspection"), dict),
         "Resolve the selected original inspection error.")
    parts = file["inspection"].get("parts", [])
    need(type(part_index) is int and 0 <= part_index < len(parts),
         "Choose a worksheet, layer or band from this exact new inspection.")
    part = parts[part_index]
    need(not part.get("error"), "Resolve the selected worksheet or layer error.")
    return file, part


def _field(part, selected):
    rows = [row for row in part.get("fields", []) if row.get("id") == selected]
    need(len(rows) == 1, "The original selected column must have one exact identity.")
    return deepcopy(rows[0])


def _slot(inspection, choice, index):
    checked, file, part = checked_selection(choice, inspection)
    columns = {}
    for key, value in checked["mapping"].items():
        columns["mapping:" + key] = _field(part, value)
    for key in ("identifier_field", "label_field"):
        if checked[key]:
            columns[key] = _field(part, checked[key])
    return {"id": "selection-" + str(index + 1), "selection": checked,
            "file_index": checked["file_index"], "part_index": checked["part_index"],
            "filename": file["filename"], "original": deepcopy(file["original"]),
            "inspection_options": deepcopy(file.get("options", file.get("inspection", {}).get("options", {}))),
            "part": deepcopy(part), "columns": columns}


def build_definition(*, name, description, inspection, selection, commit, collection):
    """Capture only an actual complete original commit and its exact inspection."""
    _inspection(inspection)
    need(isinstance(selection, dict) and selection.get("schema") == "upstate.client-source-selection/v1",
         "Retain the complete original reviewed selection.")
    need(isinstance(commit, dict) and commit.get("schema") == "upstate.client-source-operation/v1" and
         commit.get("action") == "client-source.commit" and commit.get("state") == "complete",
         "Save a recipe from an actual completed original source commit.")
    need(selection.get("inspection_id") == inspection["id"] == commit.get("inspection_id") and
         selection.get("inspection_sha256") == digest(inspection) and
         selection.get("project_id") == inspection["project_id"] == commit.get("project_id"),
         "The original inspection, reviewed selection and committed project differ.")
    need(isinstance(selection.get("selections"), list) and selection["selections"],
         "Retain every reviewed source choice.")
    originals = [{"filename": row["filename"], "sha256": row["original"]["sha256"],
                  "bytes": row["original"]["bytes"]} for row in inspection["files"]]
    need(selection.get("originals") == originals, "Retain the exact original source population.")
    slots = [_slot(inspection, row, i) for i, row in enumerate(selection["selections"])]
    need([row["selection"] for row in slots] == selection["selections"],
         "Keep the original native checked selection without reinterpretation.")
    selected = [(row["file_index"], row["part_index"], row["selection"]["role"]) for row in slots]
    need(len(selected) == len(set(selected)), "Keep each original file/part/role selection once.")
    need(commit.get("selection_file") and commit.get("manifest_file") and
         commit.get("source_collection_id") and commit.get("source_ids"),
         "Retain the complete native commit outputs.")
    need(isinstance(collection, dict) and collection.get("id") == commit["source_collection_id"] and
         set(commit["source_ids"]).issubset({row["id"] for row in collection.get("entries", [])}),
         "Retain the actual complete committed source collection.")
    return {"schema": DEFINITION_SCHEMA, "name": text(name, "recipe name", True, 240),
            "description": text(description, "recipe description", False, 16000),
            "origin_project_id": inspection["project_id"], "inspection": deepcopy(inspection),
            "inspection_sha256": digest(inspection), "reviewed_selection": deepcopy(selection),
            "selection_sha256": digest(selection), "commit": deepcopy(commit),
            "commit_sha256": digest(commit), "collection": deepcopy(collection),
            "collection_sha256": digest(collection), "slots": slots}


def validate_definition(value):
    need(isinstance(value, dict) and value.get("schema") == DEFINITION_SCHEMA,
         "Open a complete source recipe definition.")
    rebuilt = build_definition(name=value.get("name"), description=value.get("description"),
                               inspection=value.get("inspection"),
                               selection=value.get("reviewed_selection"), commit=value.get("commit"),
                               collection=value.get("collection"))
    need(value == rebuilt, "The complete saved recipe definition or its original bindings differ.")
    return value


def _event_without_sha(event):
    return {key: deepcopy(value) for key, value in event.items() if key != "sha256"}


def validate_record(record):
    need(isinstance(record, dict) and set(record) == {"schema", "id", "origin_project_id", "created_at", "events"} and
         record.get("schema") == RECIPE_SCHEMA, "Open a complete source recipe with its full history.")
    object_id(record["id"], "recipe identity")
    text(record["origin_project_id"], "original recipe project", True)
    text(record["created_at"], "original recipe creation time", True)
    need(isinstance(record["events"], list) and record["events"], "Retain every recipe edition.")
    previous = None
    requests = set()
    for index, event in enumerate(record["events"], 1):
        need(isinstance(event, dict) and set(event) == {"revision", "previous_sha256", "request_id", "request_sha256",
              "created_at", "action", "payload", "definition", "sha256"}, "Keep the complete original recipe event.")
        need(event["revision"] == index and event["previous_sha256"] == previous,
             "The original recipe history is missing or reordered.")
        object_id(event["request_id"], "original request identity")
        need(event["request_id"] not in requests, "Keep each original request exactly once.")
        requests.add(event["request_id"])
        sha(event["request_sha256"], "original request digest")
        text(event["created_at"], "original event time", True)
        need(event["action"] == ("client-source-recipe.create" if index == 1 else "client-source-recipe.revise"),
             "Keep the original recipe action history.")
        need(isinstance(event["payload"], dict), "Retain the exact original recipe request body.")
        validate_definition(event["definition"])
        need(event["definition"]["origin_project_id"] == record["origin_project_id"],
             "Revise a recipe within its original project; received recipes retain origin.")
        payload = event["payload"]
        need(payload.get("name") == event["definition"]["name"] and
             payload.get("description", "") == event["definition"]["description"] and
             payload.get("commit_id") == event["definition"]["commit"]["id"],
             "The retained recipe request selects another definition.")
        if index == 1:
            need(event["request_id"] == record["id"] and record["created_at"] == event["created_at"],
                 "Keep the original creation request and time.")
        else:
            need(payload.get("recipe_id") == record["id"] and payload.get("expected_revision") == index - 1 and
                 payload.get("expected_sha256") == previous, "Keep the exact preceding recipe edition.")
        need(event["sha256"] == digest(_event_without_sha(event)), "The full recipe event digest differs.")
        previous = event["sha256"]
    return record


def edition(record, revision=None):
    validate_record(record)
    if revision is None:
        revision = len(record["events"])
    need(type(revision) is int and 1 <= revision <= len(record["events"]), "Select an actual saved recipe edition.")
    return record["events"][revision - 1]


def append_event(record, *, recipe_id, project_id, request_id, request_sha256,
                 action, payload, definition, created_at):
    validate_definition(definition)
    object_id(request_id, "original request identity")
    sha(request_sha256, "original request digest")
    if record is None:
        need(action == "client-source-recipe.create" and recipe_id == request_id and
             project_id == definition["origin_project_id"], "Use the original creation request.")
        value = {"schema": RECIPE_SCHEMA, "id": recipe_id, "origin_project_id": project_id,
                 "created_at": created_at, "events": []}
        previous = None
    else:
        validate_record(record)
        value = deepcopy(record)
        for old in value["events"]:
            if old["request_id"] == request_id:
                need(old["request_sha256"] == request_sha256 and old["action"] == action and old["payload"] == payload,
                     "The original recipe request was reused with another body.")
                return value, old
        need(action == "client-source-recipe.revise" and project_id == value["origin_project_id"] and
             payload.get("expected_revision") == len(value["events"]) and
             payload.get("expected_sha256") == value["events"][-1]["sha256"],
             "The saved recipe changed. Review its current edition before revising.")
        previous = value["events"][-1]["sha256"]
    event = {"revision": len(value["events"]) + 1, "previous_sha256": previous,
             "request_id": request_id, "request_sha256": request_sha256, "created_at": created_at,
             "action": action, "payload": deepcopy(payload), "definition": deepcopy(definition)}
    event["sha256"] = digest(event)
    value["events"].append(event)
    validate_record(value)
    return value, event


def _binding_rows(bindings, slots):
    need(isinstance(bindings, list), "Provide explicit new-inspection bindings.")
    output = {}
    valid = {row["id"] for row in slots}
    for row in bindings:
        need(isinstance(row, dict) and set(row).issubset({"slot_id", "file_index", "part_index", "columns"}) and
             row.get("slot_id") in valid and row["slot_id"] not in output,
             "Bind each actual saved recipe selection at most once.")
        need(isinstance(row.get("columns", {}), dict), "Choose explicit original column identities.")
        output[row["slot_id"]] = row
    return output


def plan_use(record, revision, inspection, bindings=None):
    """Offer literal-name matches; never apply or confirm any source choice."""
    selected = edition(record, revision)
    _inspection(inspection)
    definition = selected["definition"]
    supplied = _binding_rows(bindings or [], definition["slots"])
    rows = []
    for slot in definition["slots"]:
        compatible = []
        for file_index, file in enumerate(inspection["files"]):
            if file.get("error"):
                continue
            for part_index, part in enumerate(file.get("inspection", {}).get("parts", [])):
                if not part.get("error") and part.get("kind") == slot["part"].get("kind"):
                    compatible.append({"file_index": file_index, "part_index": part_index,
                                       "filename": file["filename"], "part": deepcopy(part)})
        binding = supplied.get(slot["id"])
        exact = [row for row in compatible if row["filename"] == slot["filename"] and
                 row["part"].get("name") == slot["part"].get("name")]
        target = binding
        if target is None and len(exact) == 1:
            target = {key: exact[0][key] for key in ("file_index", "part_index")}
        result = {"slot_id": slot["id"], "original": deepcopy(slot), "candidates": compatible,
                  "binding": deepcopy(binding), "suggested_target": deepcopy(target),
                  "columns": [], "unresolved": [], "selection": None, "confirmed": False}
        if target is None:
            result["unresolved"].append("Choose an exact file and worksheet/layer/band.")
            rows.append(result)
            continue
        file, part = part_at(inspection, target.get("file_index"), target.get("part_index"))
        need(part["kind"] == slot["part"]["kind"], "A recipe selection needs the same original data kind.")
        explicit = binding.get("columns", {}) if binding else {}
        need(all(key in slot["columns"] for key in explicit), "Choose only original recipe column references.")
        chosen = {}
        for key, original in slot["columns"].items():
            matches = [field for field in part.get("fields", []) if field.get("label") == original.get("label")]
            field_id = explicit.get(key)
            if field_id is not None:
                field = _field(part, field_id)
                status = "explicit"
            elif len(matches) == 1:
                field, field_id, status = matches[0], matches[0]["id"], "exact-label"
            else:
                field, field_id, status = None, None, "missing" if not matches else "ambiguous"
                result["unresolved"].append(key + ": " + status + " original header")
            result["columns"].append({"key": key, "original": deepcopy(original), "status": status,
                                      "matches": deepcopy(matches), "selected": deepcopy(field)})
            if field_id is not None:
                chosen[key] = field_id
        choice = {key: deepcopy(slot["selection"][key]) for key in DEFAULT_FIELDS}
        choice.update({key: "" for key in FRESH_FIELDS})
        choice.update({"file_index": target["file_index"], "part_index": target["part_index"],
                       "mapping": {key.split(":", 1)[1]: value for key, value in chosen.items() if key.startswith("mapping:")},
                       "identifier_field": chosen.get("identifier_field", ""),
                       "label_field": chosen.get("label_field", ""), "confirmed": False})
        # A prior physical conversion is context only, never silently reused.
        result["previous_conversion"] = deepcopy(slot["selection"].get("conversion"))
        result["selection"] = choice
        result["part_changes"] = {key: {"original": slot["part"].get(key), "new": part.get(key)}
                                  for key in ("crs", "geometry", "units", "scale", "offset", "dtype", "nodata", "width", "height")
                                  if slot["part"].get(key) != part.get(key)}
        if binding is None:
            result["unresolved"].append("Explicitly accept the suggested file and part.")
        rows.append(result)
    return {"schema": "upstate.client-source-recipe-plan/v1", "recipe_id": record["id"],
            "recipe_revision": selected["revision"], "recipe_sha256": selected["sha256"],
            "inspection_id": inspection["id"], "inspection_sha256": digest(inspection),
            "project_id": inspection["project_id"], "rows": rows,
            "ready_for_review": all(not row["unresolved"] for row in rows)}


def review_use(record, revision, inspection, bindings, selections, *, title, reviewer):
    plan = plan_use(record, revision, inspection, bindings)
    need(plan["ready_for_review"], "Resolve every missing, ambiguous or unconfirmed source/column binding.")
    need(isinstance(selections, list) and len(selections) == len(plan["rows"]),
         "Review every saved recipe selection on the new original inspection.")
    reviewed = {}
    for row in selections:
        need(isinstance(row, dict) and set(row) == {"slot_id", "selection", "reviewed"} and
             row.get("slot_id") not in reviewed, "Retain each complete explicit source review once.")
        need(isinstance(row["reviewed"], list) and len(row["reviewed"]) == len(REVIEW_AREAS) and
             set(row["reviewed"]) == set(REVIEW_AREAS), "Confirm source, mapping, role and units for this new file.")
        reviewed[row["slot_id"]] = row
    checked = []
    for row in plan["rows"]:
        need(row["slot_id"] in reviewed, "Review every selected source.")
        supplied = reviewed[row["slot_id"]]["selection"]
        need(isinstance(supplied, dict) and set(supplied).issubset(set(FRESH_FIELDS) |
             {"file_index", "part_index", "role", "resampling", "models", "mapping", "identifier_field",
              "label_field", "conversion", "confirmed", "intake_status"}),
             "Review only the original declared source interpretation fields.")
        choice, _, _ = checked_selection(supplied, inspection)
        if choice.get("conversion") is not None:
            factor = choice["conversion"]["factor"]
            if type(factor) is float and factor.is_integer():
                factor = int(factor)
            need(type(factor) is not int or abs(factor) <= 9007199254740991,
                 "Use an exactly representable current physical conversion factor.")
            choice["conversion"]["factor"] = factor
        suggestion = row["selection"]
        for key in ("file_index", "part_index", "role", "models", "mapping", "identifier_field", "label_field"):
            need(choice[key] == suggestion[key], "Keep the explicit reviewed recipe binding for " + key + ".")
        need(choice["reviewer"] == reviewer, "Use the explicit current reviewer on every source.")
        checked.append(choice)
    triples = [(row["file_index"], row["part_index"], row["role"]) for row in checked]
    need(len(set(triples)) == len(triples), "Do not map two recipe slots to the same file, part and role.")
    return {"schema": "upstate.client-source-recipe-reviewed-use/v1",
            "recipe_id": record["id"], "recipe_revision": plan["recipe_revision"],
            "recipe_sha256": plan["recipe_sha256"], "inspection": deepcopy(inspection),
            "inspection_sha256": plan["inspection_sha256"], "bindings": deepcopy(bindings),
            "reviews": deepcopy(selections), "reviewer": text(reviewer, "current reviewer", True, 16000),
            "commit_payload": {"title": text(title, "new source title", True, 8000),
                               "inspection_id": inspection["id"], "selections": checked}}


def validate_use(value):
    need(isinstance(value, dict) and value.get("schema") == USE_SCHEMA and
         set(value) == {"schema", "id", "project_id", "workspace_key", "created_at", "request_sha256",
                       "request_payload", "recipe_record", "review", "commit_request", "sha256"},
         "Open the complete retained recipe use.")
    object_id(value["id"], "recipe-use identity")
    sha(value["request_sha256"], "original preparation request digest")
    text(value["created_at"], "original preparation time", True)
    record = validate_record(value["recipe_record"])
    request = value["request_payload"]
    need(isinstance(request, dict) and set(request) == {"recipe_id", "revision", "recipe_sha256", "inspection_id",
             "bindings", "selections", "title", "reviewer"},
         "Keep the complete recipe-use request.")
    selected = edition(record, request["revision"])
    need(request["recipe_id"] == record["id"] and request["recipe_sha256"] == selected["sha256"],
         "The original request selects another saved recipe edition.")
    review = review_use(record, request["revision"], value["review"]["inspection"], request["bindings"],
                        request["selections"], title=request["title"], reviewer=request["reviewer"])
    need(review == value["review"] and request["inspection_id"] == review["inspection"]["id"] and
         value["project_id"] == review["inspection"]["project_id"], "The retained complete new-source review differs.")
    operation_id = "recipe-commit-" + digest({"use_id": value["id"], "request_sha256": value["request_sha256"]})
    expected = {"workspace": value["workspace_key"], "action": "client-source.commit",
                "payload": review["commit_payload"], "operation_id": operation_id}
    need(value["commit_request"] == expected, "Keep the exact original scientific commit request.")
    need(value["request_sha256"] == digest({"workspace": value["workspace_key"],
         "action": "client-source-recipe.prepare-use", "payload": request}),
         "The retained recipe preparation fingerprint differs.")
    need(value["sha256"] == digest({key: item for key, item in value.items() if key != "sha256"}),
         "The complete recipe-use digest differs.")
    return value


def build_use(record, *, request_id, request_sha256, workspace_key, project_id,
              payload, inspection, created_at):
    selected = edition(record, payload["revision"])
    need(payload["recipe_id"] == record["id"] and payload["recipe_sha256"] == selected["sha256"],
         "Use the exact selected saved recipe edition.")
    review = review_use(record, payload["revision"], inspection, payload["bindings"],
                        payload["selections"], title=payload["title"], reviewer=payload["reviewer"])
    value = {"schema": USE_SCHEMA, "id": request_id, "project_id": project_id,
             "workspace_key": workspace_key, "created_at": created_at, "request_sha256": request_sha256,
             "request_payload": deepcopy(payload), "recipe_record": deepcopy(record), "review": review,
             "commit_request": {"workspace": workspace_key, "action": "client-source.commit",
                                "payload": review["commit_payload"],
                                "operation_id": "recipe-commit-" + digest({"use_id": request_id, "request_sha256": request_sha256})}}
    value["sha256"] = digest(value)
    return validate_use(value)


def definition_descriptors(definition):
    validate_definition(definition)
    rows = [deepcopy(row["original"]) for row in definition["inspection"]["files"]]
    rows.extend(deepcopy(definition["commit"][key]) for key in ("selection_file", "manifest_file"))
    for entry in definition["collection"]["entries"]:
        rows.append(deepcopy(entry["body"]))
        rows.extend(deepcopy(entry.get("companions", [])))
    return rows


def use_descriptors(use):
    validate_use(use)
    rows = [deepcopy(row["original"]) for row in use["review"]["inspection"]["files"]]
    for event in use["recipe_record"]["events"]:
        rows.extend(definition_descriptors(event["definition"]))
    return rows


def applied_descriptors(applied):
    rows = [deepcopy(row["original"]) for row in applied["commit"]["files"]]
    rows.extend(deepcopy(applied["commit"][key]) for key in ("selection_file", "manifest_file"))
    for entry in applied["collection"]["entries"]:
        rows.append(deepcopy(entry["body"]))
        rows.extend(deepcopy(entry.get("companions", [])))
    return rows


def _objects(expected, actual):
    wanted = {}
    for row in expected:
        sha(row.get("sha256"), "original source digest")
        need(type(row.get("bytes")) is int and row["bytes"] >= 0, "Keep complete source byte counts.")
        need(row["sha256"] not in wanted or wanted[row["sha256"]] == row["bytes"],
             "An original digest has conflicting source sizes.")
        wanted[row["sha256"]] = row["bytes"]
    observed = {}
    need(isinstance(actual, list), "Retain the complete source custody population.")
    for row in actual:
        need(isinstance(row, dict) and row.get("object") == "objects/" + sha(row.get("sha256")) and
             type(row.get("bytes")) is int and row["bytes"] >= 0 and row["sha256"] not in observed,
             "Keep each complete original CAS object exactly once.")
        observed[row["sha256"]] = row["bytes"]
    need(observed == wanted, "Recipe custody must retain every exact source and projection.")
    return actual


def validate_custody(record, event, custody):
    validate_record(record)
    need(event in record["events"], "Select an original recipe event.")
    need(isinstance(custody, dict) and set(custody) == {"schema", "recipe_id", "revision", "event_sha256",
              "definition_sha256", "objects"} and custody["schema"] == "upstate.client-source-recipe-custody/v1" and
         custody["recipe_id"] == record["id"] and custody["revision"] == event["revision"] and
         custody["event_sha256"] == event["sha256"] and custody["definition_sha256"] == digest(event["definition"]),
         "The complete original recipe custody binding differs.")
    _objects(definition_descriptors(event["definition"]), custody["objects"])
    return custody


def validate_use_custody(use, custody):
    validate_use(use)
    need(isinstance(custody, dict) and set(custody) == {"schema", "use_id", "use_sha256", "objects"} and
         custody["schema"] == "upstate.client-source-recipe-use-custody/v1" and
         custody["use_id"] == use["id"] and custody["use_sha256"] == use["sha256"],
         "The complete recipe-use custody binding differs.")
    _objects(use_descriptors(use), custody["objects"])
    return custody


def validate_applied(applied, use):
    validate_use(use)
    need(isinstance(applied, dict) and set(applied) == {"schema", "use_id", "use_sha256", "project_id",
        "commit_request", "task", "operation_alias", "commit", "reviewed_selection", "collection", "sha256"} and
        applied["schema"] == "upstate.client-source-recipe-applied/v1" and
        applied["use_id"] == use["id"] and applied["use_sha256"] == use["sha256"] and
        applied["project_id"] == use["project_id"] and applied["commit_request"] == use["commit_request"],
        "The complete native attachment selects another prepared use.")
    request, task, commit = use["commit_request"], applied["task"], applied["commit"]
    expected_sha = digest({key: request[key] for key in ("workspace", "action", "payload")})
    need(task.get("schema") == "upstate.operator-task/v1" and task.get("state") == "complete" and
         all(task.get(key) == request[key] for key in ("workspace", "action", "payload")) and
         task.get("request_sha256") == expected_sha, "Retain the actual complete original native task.")
    expected_id = digest({"workspace": request["workspace"], "operation_id": request["operation_id"]})
    alias = applied["operation_alias"]
    if task["id"] == expected_id:
        need(alias is None and task.get("operation_id") == request["operation_id"], "Keep the exact native operation identity.")
    else:
        need(isinstance(alias, dict) and alias.get("schema") == "upstate.operator-operation-alias/v1" and
             alias.get("workspace") == request["workspace"] and alias.get("operation_id") == request["operation_id"] and
             alias.get("task_id") == task["id"] and alias.get("request_sha256") == expected_sha,
             "Retain the actual original operation alias.")
    inspected = use["review"]["inspection"]
    need(commit.get("id") == task["id"] and commit.get("project_id") == use["project_id"] and
         commit.get("request_sha256") == expected_sha and commit.get("action") == request["action"] and
         commit.get("state") == "complete" and commit.get("files") == inspected["files"],
         "Keep the exact actual native commit and complete inspected original population.")
    selection = {"schema": "upstate.client-source-selection/v1", "inspection_id": inspected["id"],
        "inspection_sha256": digest(inspected), "project_id": use["project_id"],
        "title": request["payload"]["title"], "selections": request["payload"]["selections"],
        "originals": [{"filename": row["filename"], "sha256": row["original"]["sha256"],
                       "bytes": row["original"]["bytes"]} for row in inspected["files"]]}
    need(applied["reviewed_selection"] == selection, "Retain the actual complete native reviewed selection.")
    build_definition(name="Attached source use", description="", inspection=inspected,
                     selection=selection, commit=commit, collection=applied["collection"])
    need(applied["sha256"] == digest({key: value for key, value in applied.items() if key != "sha256"}),
         "The complete attached native proof digest differs.")
    return applied


def validate_applied_custody(applied, use, custody):
    validate_applied(applied, use)
    need(isinstance(custody, dict) and set(custody) == {"schema", "use_id", "applied_sha256", "objects"} and
         custody["schema"] == "upstate.client-source-recipe-applied-custody/v1" and
         custody["use_id"] == use["id"] and custody["applied_sha256"] == applied["sha256"],
         "The complete applied source custody binding differs.")
    _objects(applied_descriptors(applied), custody["objects"])
    return custody


def validate_operation(value, use=None):
    need(isinstance(value, dict), "Retain the complete original recipe operation.")
    if value.get("schema") == "upstate.client-source-recipe-publication/v1":
        result = validate_operation(value["result"], use)
        need(value["request"] == result["request"], "Keep the same retained recipe publication request.")
        if "recipe_record" in value:
            need(value["recipe_record"] == result["record"], "Keep the complete original recipe candidate.")
            _objects(definition_descriptors(result["record"]["events"][-1]["definition"]), value["objects"])
        elif "use" in value:
            need(value["use"] == result["use"], "Keep the complete original use candidate.")
            validate_use_custody(value["use"], value["custody"])
        elif "applied" in value:
            need(value["applied"] == result["applied"], "Keep the complete original attached candidate.")
            validate_applied_custody(value["applied"], use, value["custody"])
        else:
            raise ValueError("The original pending recipe operation has no complete body.")
        return value
    need(value.get("schema") == "upstate.client-source-recipe-operation/v1" and value.get("state") == "complete",
         "Retain the original complete recipe operation result.")
    request = value["request"]
    need(request["request_sha256"] == digest({key: request[key] for key in ("workspace", "action", "payload")}),
         "The original queued recipe request digest differs.")
    action, payload = request["action"], request["payload"]
    if action in {"client-source-recipe.create", "client-source-recipe.revise"}:
        record = validate_record(value["record"])
        event = edition(record, value["revision"])
        need(value["recipe_id"] == record["id"] and value["sha256"] == event["sha256"] and
             event["request_id"] == request["id"] and event["request_sha256"] == request["request_sha256"] and
             event["action"] == action and event["payload"] == payload,
             "The original result selects another recipe request.")
    elif action == "client-source-recipe.prepare-use":
        selected = validate_use(value["use"])
        need(value["use_id"] == selected["id"] == request["id"] and value["use_sha256"] == selected["sha256"] and
             value["commit_request"] == selected["commit_request"] and
             payload == selected["request_payload"] and request["request_sha256"] == selected["request_sha256"],
             "The original preparation result selects another source use.")
    elif action == "client-source-recipe.attach-result":
        need(use is not None, "Verify the original prepared use with its attached native result.")
        applied = validate_applied(value["applied"], use)
        need(value["use_id"] == use["id"] and value["use_sha256"] == use["sha256"] and
             payload == {"use_id": use["id"], "use_sha256": use["sha256"], "commit_id": applied["task"]["id"]},
             "The original attachment receipt selects another native request.")
    else:
        raise ValueError("Select a complete original recipe operation.")
    return value
