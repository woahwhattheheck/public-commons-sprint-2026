"""Manual profile editions and review history on the original native Workspace.

Scientific coefficient changes are single-level selections for the maintained
experiment_profiles source materializer. Native profiles remain ordinary inputs
to the existing model; recorded reviews do not change execution admission.
"""
from __future__ import annotations
from copy import deepcopy
import csv
import io
from pathlib import Path
import tempfile

from . import experiment_profiles as sourced
from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, now, read_json, verify_file)
from .model_selection import normalize_selection, required_table_fields, selected
from .profiles import checked_parameters, inspect_table

REVIEW_STATES = {"working", "reviewed", "changes_requested"}
REVIEW_FIELDS = ("approved", "approved_at", "approved_by", "approval", "approvals",
                 "scientific_approval", "scientific_signoff", "review_status",
                 "calibration_results", "calibration_status")


def methods():
    table_fields = [{"name": "lucode", "label": "Land-cover code",
                     "type": "integer", "models": ["ndr", "sdr"], "editable": False}]
    parameters = {"ndr": [], "sdr": []}
    for rule in sourced.catalog()["parameters"]:
        domain, name = rule["target"].split(".", 1)
        field = {**rule, "name": name, "type": "choice" if rule.get("choices") else "number",
                 "editable": True, "required": not rule.get("nullable", False)}
        if "minimum" in rule:
            field["min"] = rule["minimum"]
        if "maximum" in rule:
            field["max"] = rule["maximum"]
        field["positive"] = rule.get("exclusive_minimum", False)
        if domain == "table":
            field["models"] = [m for m in ("ndr", "sdr") if name in required_table_fields((m,))]
            table_fields.append(field)
        else:
            parameters[domain].append(field)
    return {"models": [{"id": "ndr", "label": "Nutrient Delivery Ratio"},
                       {"id": "sdr", "label": "Sediment Delivery Ratio"}],
            "table_fields": table_fields, "parameters": parameters,
            "review_states": sorted(REVIEW_STATES),
            "validation": "Original checked_parameters, inspect_table and experiment_profiles",
            "materialization": "model.experiment_profiles.materialize"}


def _object(value, name):
    if not isinstance(value, dict):
        raise ValueError(name + " must be a JSON object")
    return value


def _text(value, name, required=False):
    if value is None and not required:
        return ""
    if not isinstance(value, str) or (required and not value.strip()):
        raise ValueError(name + " requires text")
    return value.strip()


def _table(value):
    value = _object(value, "Coefficient table")
    columns, rows = value.get("columns"), value.get("rows")
    if (not isinstance(columns, list) or not columns or len(set(columns)) != len(columns)
            or any(not isinstance(x, str) or not x.strip() for x in columns)):
        raise ValueError("Coefficient columns require distinct nonempty names")
    if not isinstance(rows, list):
        raise ValueError("Coefficient rows must be a list")
    result = []
    for number, row in enumerate(rows, 1):
        if not isinstance(row, dict) or set(row) != set(columns):
            raise ValueError("Coefficient row " + str(number) + " must retain every named column")
        if any(not isinstance(row[column], str) for column in columns):
            raise ValueError("Coefficient cells must retain text; a blank cell is an empty string")
        result.append({column: row[column] for column in columns})
    return {"columns": list(columns), "rows": result}


def read_table(workspace, collection_id, source_id, *, selected_models=None):
    path, entry = workspace.source_file(identifier(collection_id), source_id)
    if entry["kind"] != "table":
        raise ValueError("Choose a retained biophysical CSV")
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        table = _table({"columns": reader.fieldnames or [], "rows": list(reader)})
    validation = {}
    for model in selected_models or ("ndr", "sdr"):
        try:
            checked = inspect_table(path, selected_models=(model,))
            validation[model] = {"valid": True, "lucodes": checked["lucodes"]}
        except (ValueError, TypeError, KeyError) as error:
            validation[model] = {"valid": False, "message": str(error)}
    return {**table, "sha256": entry["body"]["sha256"], "bytes": entry["body"]["bytes"],
            "source_collection_id": collection_id, "biophysical_source_id": source_id,
            "source": deepcopy(entry), "validation": validation}


def _validate_table(table, active):
    with tempfile.TemporaryDirectory(prefix="upstate-profile-preview-") as directory:
        path = Path(directory) / "biophysical.csv"
        with path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, table["columns"], lineterminator="\n")
            writer.writeheader()
            writer.writerows(table["rows"])
        return inspect_table(path, selected_models=active)


def _state(workspace, profile_id):
    path = workspace.root / "profile-review-heads" / (identifier(profile_id) + ".json")
    if not path.exists():
        return {"status": "working", "review_id": None}
    pointer = read_json(path)
    if pointer.get("profile_id") != profile_id:
        raise ValueError("Profile review head changed its selected profile")
    event = workspace._get("profile-reviews", pointer["review_id"])
    profile = workspace._get("profiles", profile_id)
    if event["profile_id"] != profile_id or event["table_sha256"] != profile["table_summary"]["sha256"]:
        raise ValueError("Profile review changed its native profile or table binding")
    return {**event, "review_id": event["id"]}


def _history(workspace, profile_id):
    key = _state(workspace, profile_id)["review_id"]
    rows, seen = [], set()
    while key:
        if key in seen:
            raise ValueError("Profile review history contains a cycle")
        seen.add(key)
        event = workspace._get("profile-reviews", key)
        if event["profile_id"] != profile_id:
            raise ValueError("Profile review history crosses native profiles")
        rows.append(event)
        key = event.get("previous_review_id")
    return list(reversed(rows))


def _editions(workspace, profile_id):
    return [row for row in workspace._list("profile-editions") if row["profile_id"] == profile_id]


def inspect(workspace, profile_id):
    profile = workspace._get("profiles", identifier(profile_id))
    table = read_table(workspace, profile["source_collection_id"], profile["biophysical_source_id"],
                       selected_models=selected(profile))
    editions = _editions(workspace, profile_id)
    edition = max(editions, key=lambda x: (x["created_at"], x["id"])) if editions else None
    lineage, seen, current = [], set(), edition
    while current:
        if current["id"] in seen:
            raise ValueError("Profile edition history contains a cycle")
        seen.add(current["id"])
        lineage.append(current)
        parents = _editions(workspace, current["base_profile_id"]) if current.get("base_profile_id") else []
        current = max(parents, key=lambda x: (x["created_at"], x["id"])) if parents else None
    return {"profile_id": profile_id, "profile": profile, "table": table, "edition": edition,
            "lineage": lineage, "reviews": _history(workspace, profile_id),
            "review_state": _state(workspace, profile_id)}


def catalog(workspace):
    tables = []
    for collection in workspace.sources():
        for entry in collection["entries"]:
            if entry["kind"] == "table":
                tables.append({"source_collection_id": collection["id"],
                               "biophysical_source_id": entry["id"], "source_id": entry["id"],
                               "collection_title": collection["title"], "title": entry["title"],
                               "uri": entry["uri"], "vintage": entry["vintage"],
                               "sha256": entry["body"]["sha256"], "bytes": entry["body"]["bytes"]})
    return {"profiles": [{**p, "review_state": _state(workspace, p["id"])}
                         for p in workspace._list("profiles")],
            "tables": tables, "methods": methods()}


def _profile_values(value):
    return {key: item for key, item in value.items() if key not in (
        "id", "schema", "table_summary", "source_collection_id", "biophysical_source_id",
        "profile_edition", "experiment_derivation")}


def _field_diff(left, right, prefix=""):
    rows = []
    for name in sorted(set(left) | set(right)):
        before, after = left.get(name), right.get(name)
        if name in left and name in right and isinstance(before, dict) and isinstance(after, dict):
            rows.extend(_field_diff(before, after, prefix + name + "."))
        elif name not in left or name not in right or before != after:
            rows.append({"path": prefix + name, "before": before, "after": after,
                         "before_present": name in left, "after_present": name in right})
    return rows


def _row_key(row, number):
    try:
        return str(int(row.get("lucode", "").strip()))
    except (ValueError, AttributeError):
        return "row:" + str(number)


def difference(left_profile, left_table, right_profile, right_table):
    before = {_row_key(row, i): row for i, row in enumerate(left_table["rows"])}
    after = {_row_key(row, i): row for i, row in enumerate(right_table["rows"])}
    columns = list(dict.fromkeys(left_table["columns"] + right_table["columns"]))
    changed = [{"lucode": code, "column": column,
                "before": before[code].get(column), "after": after[code].get(column)}
               for code in sorted(before.keys() & after.keys()) for column in columns
               if before[code].get(column) != after[code].get(column)
               or (column in before[code]) != (column in after[code])]
    table = {"added": [row for key, row in after.items() if key not in before],
             "removed": [row for key, row in before.items() if key not in after],
             "changed": changed,
             "columns_added": [c for c in right_table["columns"] if c not in left_table["columns"]],
             "columns_removed": [c for c in left_table["columns"] if c not in right_table["columns"]],
             "order_changed": list(before) != list(after),
             "column_order_changed": left_table["columns"] != right_table["columns"]}
    parameters = _field_diff(_profile_values(left_profile), _profile_values(right_profile))
    return {"parameters": parameters, "table": table,
            "summary": {"parameters_changed": len(parameters), "cells_changed": len(changed),
                        "rows_added": len(table["added"]), "rows_removed": len(table["removed"])}}


def compare(workspace, left_profile_id, right_profile_id):
    left, right = inspect(workspace, left_profile_id), inspect(workspace, right_profile_id)
    return {"left_profile_id": left_profile_id, "right_profile_id": right_profile_id,
            "left": {"profile": left["profile"], "table_sha256": left["table"]["sha256"],
                     "review_state": left["review_state"]},
            "right": {"profile": right["profile"], "table_sha256": right["table"]["sha256"],
                      "review_state": right["review_state"]},
            "diff": difference(left["profile"], left["table"], right["profile"], right["table"])}


def _coverage(workspace, active, codes):
    available, grids = set(codes), []
    for path in sorted((workspace.root / "grids").glob("*/grid.json")):
        grid = read_json(path)
        counts = grid.get("inputs", {}).get("NLCD", {}).get("class_counts", {})
        missing = sorted({int(code) for code in counts} - available)
        supported = set(active).issubset(selected(grid["spec"]))
        grids.append({"grid_id": grid["id"], "title": grid["spec"].get("title", grid["id"]),
                      "state": grid["state"], "missing_lucodes": missing,
                      "selected_models_available": supported,
                      "compatible": grid["state"] == "complete" and bool(counts) and not missing and supported})
    scenarios = [{"scenario_id": s["id"], "title": s["title"],
                  "missing_lucodes": sorted({p["to_code"] for p in s.get("patches", [])} - available)}
                 for s in workspace._list("scenarios")]
    return {"lucodes": sorted(available), "grids": grids, "scenarios": scenarios}


def _source_spec(parent, profile, original, table, revision):
    """Translate direct cell/scalar edits to the original source owner's API."""
    if original["columns"] != table["columns"] or len(original["rows"]) != len(table["rows"]):
        raise ValueError("Retain the original table columns and land-cover rows; import a different table in Original sources")
    factors = []
    references = profile.get("references")
    for before, after in zip(original["rows"], table["rows"]):
        if before["lucode"] != after["lucode"]:
            raise ValueError("Retain the original land-cover codes and row order")
        for name in table["columns"]:
            if before[name] == after[name]:
                continue
            target = "table." + name
            if target not in sourced.PARAMETERS:
                raise ValueError("Preserve the original descriptive cell " + name + " for land-cover " + before["lucode"])
            factors.append({"name": name + " for land-cover " + before["lucode"],
                            "target": target, "lucodes": [int(before["lucode"])],
                            "levels": [{"label": after[name], "value": after[name],
                                        "references": references, "reason": revision["reason"]}]})
    same_source = parent and parent["source_collection_id"] == profile["source_collection_id"] and parent["biophysical_source_id"] == profile["biophysical_source_id"]
    if not same_source:
        if factors:
            raise ValueError("Save the profile with this retained table first, then open its coefficient editor")
        return None
    if selected(parent) != selected(profile):
        if factors:
            raise ValueError("Save the native model selection with unchanged coefficient cells, then open that edition's coefficient editor")
        return None
    for target, rule in sourced.PARAMETERS.items():
        domain, name = target.split(".", 1)
        if domain == "table" or domain not in selected(profile):
            continue
        before, after = parent.get(domain, {}).get(name), profile.get(domain, {}).get(name)
        if before != after:
            if domain not in parent:
                raise ValueError("Save the added native model parameters first, then edit its coefficients")
            factors.append({"name": rule["label"], "target": target,
                            "levels": [{"label": str(after) if after is not None else "Use native normalization",
                                        "value": after, "references": references,
                                        "reason": revision["reason"]}]})
    if not factors:
        return None
    return {"title": profile["title"], "reason": revision["reason"],
            "baseline_profile_id": parent["id"], "design": "factorial", "factors": factors}


def preview(workspace, selection):
    errors = []
    result = {"valid": False, "errors": errors, "profile": None, "table": None,
              "diff": None, "coverage": None, "selection": deepcopy(selection),
              "source_profile_spec": None, "source_profile_preview": None}
    try:
        selection = deepcopy(_object(selection, "Profile edition"))
        parent = workspace._get("profiles", identifier(selection["base_profile_id"])) if selection.get("base_profile_id") else None
        profile = deepcopy(_object(selection.get("profile"), "Parameter profile"))
        for name in ("id", "schema", "table_summary", "profile_edition"):
            profile.pop(name, None)
        collection_id = selection.get("source_collection_id") or profile.get("source_collection_id") or (parent or {}).get("source_collection_id")
        source_id = selection.get("biophysical_source_id") or profile.get("biophysical_source_id") or (parent or {}).get("biophysical_source_id")
        original = read_table(workspace, collection_id, source_id)
        expected = selection.get("expected_table_sha256")
        if not isinstance(expected, str) or expected != original["sha256"]:
            raise ValueError("The original table differs from the opened edition; reopen its retained cells")
        table = _table(selection.get("table") or original)
        revision = _object(selection.get("revision"), "Revision details")
        revision = {"reason": _text(revision.get("reason"), "Revision reason", True),
                    "author": _text(revision.get("author"), "Revision author", True),
                    "title": _text(revision.get("title"), "Source edition title"),
                    "vintage": _text(revision.get("vintage"), "Source edition vintage")}
        profile.update(source_collection_id=collection_id, biophysical_source_id=source_id)
        profile, active = normalize_selection(profile)
        result.update(profile=profile, table=table)
        try:
            profile.update(checked_parameters(profile))
        except (ValueError, TypeError, KeyError) as error:
            errors.append(str(error))
        checked = None
        try:
            checked = _validate_table(table, active)
        except (ValueError, TypeError, KeyError, csv.Error) as error:
            errors.append(str(error))
        if not errors:
            spec = _source_spec(parent, profile, original, table, revision)
            if spec:
                proposed = sourced.preview(workspace, spec)
                result.update(source_profile_spec=spec, source_profile_preview=proposed)
                # Expose the exact cell text that the retained materializer will
                # produce, including its numeric normalization and coalescing.
                table = {key: deepcopy(original[key]) for key in ("columns", "rows")}
                rows = {int(row["lucode"]): row for row in table["rows"]}
                for config in proposed["configurations"]:
                    if config["is_baseline"]:
                        continue
                    for change in config["changes"]:
                        if change["target"].startswith("table."):
                            column = change["target"].split(".", 1)[1]
                            for code in change["lucodes"]:
                                rows[code][column] = str(change["value"])
        changed = {key: original[key] for key in ("columns", "rows")} != table
        result["table"] = {**table, "sha256": original["sha256"] if not changed else None,
                           "original_sha256": original["sha256"], "changed": changed,
                           "source": original["source"]}
        baseline_table = read_table(workspace, parent["source_collection_id"], parent["biophysical_source_id"]) if parent else original
        result["diff"] = difference(parent or {}, baseline_table, profile, table)
        if checked:
            result["coverage"] = _coverage(workspace, active, checked["lucodes"])
        result["selection"] = {"base_profile_id": parent["id"] if parent else None,
                               "source_collection_id": collection_id, "biophysical_source_id": source_id,
                               "expected_table_sha256": original["sha256"], "profile": profile,
                               "table": table, "revision": revision}
        result["valid"] = not errors
    except (ValueError, TypeError, KeyError, csv.Error, FileNotFoundError) as error:
        errors.append(str(error))
    return result


def save(workspace, selection, *, operation_id=None):
    request_sha = digest(selection)
    operation = digest({"operation_id": operation_id}) if operation_id is not None else request_sha
    directory = workspace.root / "profile-edition-operations" / operation
    with held(workspace.root / ".workspace.lock"), held(workspace.root / ".profile-editions.lock"):
        receipt_path = directory / "result.json"
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            if receipt["request_sha256"] != request_sha:
                raise ValueError("This operation identity already belongs to different profile edits")
            current = inspect(workspace, receipt["profile_id"])
            for item in receipt["files"].values():
                verify_file(workspace.root, item)
            return {**receipt, "profile": current["profile"], "review_state": current["review_state"]}
        proposed = preview(workspace, selection)
        if not proposed["valid"]:
            raise ValueError("; ".join(proposed["errors"]))
        chosen = proposed["selection"]
        context_path = directory / "operation.json"
        if context_path.exists():
            context = read_json(context_path)
            if context["request_sha256"] != request_sha:
                raise ValueError("This operation identity already belongs to different profile edits")
        else:
            context = {"request_sha256": request_sha, "created_at": now(), "selection": chosen}
            atomic_json(context_path, context, immutable=True)
        requested = deepcopy(chosen["profile"])
        profile = deepcopy(requested)
        materialized = None
        materialized_id = None
        if proposed["source_profile_spec"]:
            materialized = sourced.materialize(workspace, proposed["source_profile_spec"])
            choices = [row for row in materialized["profiles"] if not row["is_baseline"]]
            picked = choices[0] if choices else materialized["profiles"][0]
            materialized_id = picked["profile_id"]
            profile = workspace._get("profiles", materialized_id)
            for key, value in requested.items():
                if key not in ("source_collection_id", "biophysical_source_id",
                               "experiment_derivation", "table_summary", "id", "schema"):
                    profile[key] = deepcopy(value)
        for name in ("id", "schema", "table_summary", "models", *REVIEW_FIELDS):
            profile.pop(name, None)
        if "models" in requested:
            profile["models"] = deepcopy(requested["models"])
        profile.update(status="working", scientific_status="working")
        profile["profile_edition"] = {"base_profile_id": chosen["base_profile_id"],
                                      "original_table": {"source_collection_id": chosen["source_collection_id"],
                                                         "biophysical_source_id": chosen["biophysical_source_id"],
                                                         "sha256": chosen["expected_table_sha256"]},
                                      "revision": chosen["revision"],
                                      "source_profile_set_id": materialized["id"] if materialized else None,
                                      "materialized_profile_id": materialized_id}
        saved = workspace.save_profile(profile)
        table_path, entry = workspace.source_file(saved["source_collection_id"], saved["biophysical_source_id"])
        exported_csv = directory / "coefficient-table.csv"
        atomic_bytes(exported_csv, table_path.read_bytes(), immutable=True)
        files = {
            "profile": describe_file(workspace.root, workspace.root / "profiles" / (saved["id"] + ".json"),
                                     media_type="application/json"),
            "table": describe_file(workspace.root, exported_csv, media_type="text/csv")}
        if materialized:
            set_root = workspace.root / "sourced-profiles" / materialized["id"]
            files["source_choices"] = describe_file(workspace.root, set_root / "selection.json", media_type="application/json")
            for candidate in materialized["profiles"]:
                if candidate["profile_id"] == materialized_id and candidate.get("files", {}).get("lineage"):
                    path = set_root / candidate["files"]["lineage"]["path"]
                    files["cell_lineage"] = describe_file(workspace.root, path, media_type="application/json")
        edition = workspace._save("profile-editions", {
            "profile_id": saved["id"], "base_profile_id": chosen["base_profile_id"],
            "created_at": context["created_at"], "revision": chosen["revision"],
            "original_table": profile["profile_edition"]["original_table"],
            "table": {"source_collection_id": saved["source_collection_id"],
                      "biophysical_source_id": saved["biophysical_source_id"], "sha256": entry["body"]["sha256"]},
            "source_profile_set_id": materialized["id"] if materialized else None,
            "materialized_profile_id": materialized_id,
            "table_changed": proposed["table"]["changed"], "diff": proposed["diff"], "files": files})
        files = {**files, "edition": describe_file(workspace.root,
                 workspace.root / "profile-editions" / (edition["id"] + ".json"), media_type="application/json")}
        receipt = {"schema": "upstate.profile-edition-result/v1", "request_sha256": request_sha,
                   "profile_id": saved["id"], "source_collection_id": saved["source_collection_id"],
                   "biophysical_source_id": saved["biophysical_source_id"], "edition_id": edition["id"],
                   "source_profile_set_id": materialized["id"] if materialized else None, "files": files}
        atomic_json(receipt_path, receipt, immutable=True)
        return {**receipt, "profile": saved, "review_state": _state(workspace, saved["id"])}


def review(workspace, selection, *, operation_id=None, before_commit=None):
    selection = deepcopy(_object(selection, "Profile review"))
    profile_id = identifier(selection.get("profile_id"))
    profile = workspace._get("profiles", profile_id)
    status = selection.get("status")
    if status not in REVIEW_STATES:
        raise ValueError("Choose working, reviewed or changes_requested")
    reviewer = _text(selection.get("reviewer"), "Reviewer", True)
    role = _text(selection.get("reviewer_role"), "Reviewer role", True)
    reference = _text(selection.get("reference"), "Review reference", status == "reviewed")
    notes = _text(selection.get("notes"), "Review notes")
    if "expected_review_id" not in selection:
        raise ValueError("Retain the currently opened review identity")
    request_sha = digest(selection)
    operation = digest({"operation_id": operation_id}) if operation_id is not None else request_sha
    receipt_path = workspace.root / "profile-review-operations" / (operation + ".json")
    with held(workspace.root / ".workspace.lock"), held(workspace.root / ".profile-editions.lock"):
        current = _state(workspace, profile_id)
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            if receipt["request_sha256"] != request_sha:
                raise ValueError("This operation identity belongs to another review")
            event = workspace._get("profile-reviews", receipt["review_id"])
            return {**event, "review_id": event["id"], "review_state": current}
        prior = [row for row in workspace._list("profile-reviews") if row.get("operation_id") == operation]
        if any(row.get("request_sha256") != request_sha for row in prior):
            raise ValueError("This operation identity belongs to another review")
        event = prior[0] if prior else None
        committed = {row["id"] for row in _history(workspace, profile_id)}
        if event and event["id"] in committed:
            atomic_json(receipt_path, {"request_sha256": request_sha, "review_id": event["id"]}, immutable=True)
            return {**event, "review_id": event["id"], "review_state": current}
        if selection["expected_review_id"] != current["review_id"]:
            raise ValueError("Another review was saved while this profile was open; reopen its current review")
        # An integrating review source may validate its selected head while the
        # ordinary Workspace/profile locks still protect this history write.
        # Already committed operations return above without reapplying a decision.
        if before_commit is not None:
            before_commit()
        if event is None:
            event = workspace._save("profile-reviews", {
                "profile_id": profile_id, "table_sha256": profile["table_summary"]["sha256"],
                "status": status, "reviewer": reviewer, "reviewer_role": role,
                "reference": reference, "notes": notes, "previous_review_id": current["review_id"],
                "created_at": now(), "request_sha256": request_sha, "operation_id": operation})
        atomic_json(workspace.root / "profile-review-heads" / (profile_id + ".json"),
                    {"profile_id": profile_id, "review_id": event["id"]})
        atomic_json(receipt_path, {"request_sha256": request_sha, "review_id": event["id"]}, immutable=True)
        return {**event, "review_id": event["id"], "review_state": {**event, "review_id": event["id"]}}


def verify_all(workspace):
    editions = workspace._list("profile-editions")
    for edition in editions:
        profile = workspace._get("profiles", edition["profile_id"])
        if edition.get("base_profile_id"):
            workspace._get("profiles", edition["base_profile_id"])
        table = edition["table"]
        if (profile["source_collection_id"] != table["source_collection_id"]
                or profile["biophysical_source_id"] != table["biophysical_source_id"]):
            raise ValueError("Received edition changed its native source binding")
        path, entry = workspace.source_file(table["source_collection_id"], table["biophysical_source_id"])
        if file_digest(path) != table["sha256"] or profile["table_summary"]["sha256"] != table["sha256"]:
            raise ValueError("Received coefficient table differs from its native profile")
        if edition.get("materialized_profile_id"):
            original = workspace._get("profiles", edition["materialized_profile_id"])
            if original["table_summary"]["sha256"] != table["sha256"]:
                raise ValueError("Received manual edition differs from its sourced materialization")
        checked_parameters(profile)
        inspect_table(path, selected_models=selected(profile))
        for item in edition["files"].values():
            verify_file(workspace.root, item)
    events = workspace._list("profile-reviews")
    by_id = {row["id"]: row for row in events}
    for event in events:
        profile = workspace._get("profiles", event["profile_id"])
        if event["status"] not in REVIEW_STATES or event["table_sha256"] != profile["table_summary"]["sha256"]:
            raise ValueError("Received review changed its native profile binding")
        previous = event.get("previous_review_id")
        if previous and (previous not in by_id or by_id[previous]["profile_id"] != event["profile_id"]):
            raise ValueError("Received review lost its original predecessor")
    for path in sorted((workspace.root / "profile-review-heads").glob("*.json")):
        _history(workspace, path.stem)
    return {"editions": len(editions), "reviews": len(events)}
