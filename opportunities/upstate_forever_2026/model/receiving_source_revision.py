"""Explicit Source Updates drafts for the original Receiving editors.

TokenJunkieLabs. This module saves no source, plan, analysis or native run.
Changed vector selectors are checked against the actual retained edition.
"""
from __future__ import annotations

from copy import deepcopy
import math

from .common import digest, identifier
from . import receiving_source_impact as impact
from . import receiving_waters as waters

SCHEMA = "upstate.receiving-source-revision/v1"


def _walk(value, tokens=()):
    if isinstance(value, dict):
        if impact._pair(value):
            yield tokens, value
        for name, item in value.items():
            yield from _walk(item, tokens + (name,))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk(item, tokens + (index,))


def _path(tokens):
    return "selection" + "".join("[" + str(token) + "]" if isinstance(token, int)
                                else "." + token for token in tokens)


def _entry(workspace, collection_id, source_id):
    collection = workspace._get("sources", identifier(collection_id))
    entries = [entry for entry in collection["entries"] if entry["id"] == source_id]
    if len(entries) != 1:
        raise ValueError("The exact retained source entry is unavailable")
    entry = entries[0]
    return {"source_collection_id": collection_id, "source_id": source_id,
            "title": entry.get("title") or source_id, "kind": entry["kind"],
            "body": deepcopy(entry["body"]), "layer": entry.get("layer")}


def _record(workspace, kind, key):
    key = identifier(key)
    if kind == "plans":
        record = waters.inspect_plan(workspace, key, verify=False)
    elif kind == "analyses":
        record = waters.inspect(workspace, key, verify=False)
    else:
        raise ValueError("Choose an original Receiving plan or analysis")
    if record["state"] != "complete":
        raise ValueError("Complete the original study before opening a revision")
    return record


def _bindings(workspace, selection, refresh):
    rows = []
    changes = impact._change_index(refresh)
    upstream = any((row.get("relation") or {}).get("method") == "upstream_huc"
                   for row in selection.get("receptors", []))
    for tokens, value in _walk(selection):
        if value["source_collection_id"] != refresh["from_collection_id"]:
            continue
        receptor = (len(tokens) == 3 and tokens[0] == "receptors"
                    and isinstance(tokens[1], int) and tokens[2] == "source")
        network = tokens == ("catchments",)
        role = "receptor_geometry" if receptor else "upstream_catchments" if network and upstream else "retained_context"
        target = refresh["source_id_map"].get(value["source_id"])
        replacement, problem = None, None
        if target:
            try:
                replacement = _entry(workspace, refresh["to_collection_id"], target)
            except (OSError, ValueError, KeyError, TypeError) as error:
                problem = str(error)
        else:
            problem = "This original source has no saved replacement mapping"
        if replacement and replacement["kind"] != "vector":
            problem = "Use the complete original editor to revise this non-vector context deliberately"
        item = {"id": digest({"tokens": list(tokens), "source": value}),
                "tokens": list(tokens), "path": _path(tokens), "role": role,
                "mode": "receptor" if receptor else "catchments" if network else "catalog",
                "original": deepcopy(value), "replacement": replacement,
                "change": deepcopy(changes.get(value["source_id"])), "problem": problem,
                "receptor_id": selection["receptors"][tokens[1]].get("id") if receptor else None}
        if receptor:
            item["relation"] = deepcopy(selection["receptors"][tokens[1]].get("relation") or {})
        rows.append(item)
    return rows


def options(workspace, refresh_plan_id, kind, key, *, snapshot=None):
    refresh = impact._refresh(workspace, refresh_plan_id, snapshot)
    record = _record(workspace, kind, key)
    selection = deepcopy(record["identity"]["selection"])
    plan = record if kind == "plans" else waters.inspect_plan(workspace, selection["plan_id"], verify=False)
    if kind == "analyses" and record["identity"]["plan_record_sha256"] != plan["record_sha256"]:
        raise ValueError("The original analysis source-plan record differs")
    result = {"schema": SCHEMA, "project_id": workspace.project["id"],
              "refresh_plan_id": refresh["id"], "refresh_snapshot": refresh["snapshot"],
              "kind": kind, "record_id": record["id"], "record_sha256": record["record_sha256"],
              "title": record.get("title") or selection.get("title") or record["id"],
              "original_selection": selection,
              "plan": {"id": plan["id"], "title": plan.get("title") or plan["id"],
                       "record_sha256": plan["record_sha256"]},
              "bindings": _bindings(workspace, plan["identity"]["selection"], refresh)}
    if kind == "analyses":
        inspected = impact._analysis_impact(workspace, impact._analysis(workspace, key), refresh)
        result["successor_check"] = impact._check_successors(workspace, inspected, refresh)
    return result


def _source_update(workspace, binding, choice, analysis_crs, cache):
    if binding["problem"] or not binding["replacement"]:
        raise ValueError("Resolve the unavailable mapped source before selecting it")
    supplied = choice.get("source")
    if not isinstance(supplied, dict):
        raise ValueError("Choose the replacement through its original vector selector")
    allowed = {"source_collection_id", "source_id", "layer", "where", "feature_ids",
               "id_field", "downstream_field"}
    if set(supplied) - allowed:
        raise ValueError("Unexpected replacement selector fields")
    target = binding["replacement"]
    if impact._pair(supplied) != impact._pair(target):
        raise ValueError("Choose the exact replacement from the saved Source Updates mapping")
    if not isinstance(supplied.get("layer"), str) or not supplied["layer"].strip():
        raise ValueError("Read and choose the replacement's actual native layer")
    where = supplied.get("where", {})
    if (not isinstance(where, dict) or any(
            value is not None and type(value) not in (str, bool, int, float)
            or type(value) is float and not math.isfinite(value) for value in where.values())):
        raise ValueError("Retain exact finite scalar attribute filters")
    if binding["mode"] != "catchments" and (
            not isinstance(supplied.get("feature_ids"), list) or not supplied["feature_ids"]):
        raise ValueError("Confirm actual replacement feature IDs; original IDs are not carried automatically")
    updated = deepcopy(binding["original"])
    # Only explicitly reviewed selector fields are replaced. Other original
    # source metadata and evidence remain attached and require human review.
    for field in ("layer", "where", "feature_ids"):
        updated.pop(field, None)
    updated.update(deepcopy(supplied))
    rows, identity = waters._source(workspace, updated, analysis_crs, cache=cache)
    requested = updated.get("feature_ids")
    if requested is not None:
        wanted = [str(value) for value in requested]
        actual = [str(row["id"]) for row in rows]
        if len(set(wanted)) != len(wanted) or set(wanted) != set(actual):
            raise ValueError("Confirm every selected original feature; a requested ID is duplicated, absent, filtered or empty")
    for row in rows:
        for name, value in where.items():
            if name not in row["properties"] or type(row["properties"][name]) is not type(value) or row["properties"][name] != value:
                raise ValueError("A selected native feature differs from the exact typed attribute filter")
    if binding["mode"] == "catchments":
        field, downstream = updated.get("id_field"), updated.get("downstream_field")
        if not isinstance(field, str) or not field or not isinstance(downstream, str) or not downstream:
            raise ValueError("Choose the actual catchment and downstream fields")
        identities = set()
        for row in rows:
            if field not in row["properties"] or downstream not in row["properties"]:
                raise ValueError("A selected network feature lacks the chosen routing fields")
            raw_id = row["properties"][field]
            if raw_id is None or isinstance(raw_id, bool):
                raise ValueError("Catchment identifiers must retain actual nonempty values")
            native_id = str(raw_id).strip()
            if not native_id or native_id in identities:
                raise ValueError("Catchment identifiers must be nonempty and distinct")
            identities.add(native_id)
    relation = choice.get("relation")
    if binding["mode"] == "receptor":
        if not isinstance(relation, dict) or set(relation) - {"method", "rationale", "buffer_m"}:
            raise ValueError("Confirm the original contribution relationship in the source chooser")
        if relation.get("method") not in ("source_area", "geometric_context", "upstream_huc"):
            raise ValueError("Choose an original supported contribution relationship")
        if not isinstance(relation.get("rationale"), str) or not relation["rationale"].strip():
            raise ValueError("Describe the selected original source relationship")
        distance = relation.get("buffer_m")
        if distance is not None and (type(distance) not in (int, float) or not math.isfinite(distance) or distance < 0):
            raise ValueError("Use a finite nonnegative contribution distance")
        if relation["method"] == "source_area":
            if distance not in (None, 0) or any(row["geometry"].geom_type not in ("Polygon", "MultiPolygon") for row in rows):
                raise ValueError("Original source-area geometry must be polygonal with zero added buffer")
    elif relation is not None:
        raise ValueError("Only receiving-area geometry has a contribution relationship")
    return updated, relation, {"path": binding["path"], "role": binding["role"],
                              "source": {key: identity[key] for key in ("source_collection_id", "source_id", "body_sha256", "body_bytes", "feature_ids")},
                              "selected_features": len(rows)}


def _missing_accounting(selection, plan):
    known = {row["id"] for row in plan["receptors"]}
    missing = []
    accounting = selection.get("accounting") or {}
    for group in accounting.get("groups", []):
        for field in ("parent_receptor_id", "upstream_receptor_ids", "reservoir_receptor_ids"):
            values = group.get(field, [])
            if not isinstance(values, list):
                values = [values]
            for value in values:
                if value is not None and value not in known:
                    missing.append({"group_id": group.get("id"), "field": field, "id": value})
    return missing


def draft(workspace, values):
    if not isinstance(values, dict):
        raise ValueError("Choose the retained source revision")
    allowed = {"refresh_plan_id", "kind", "id", "snapshot", "record_sha256",
               "choices", "use_successors", "plan_id"}
    if set(values) - allowed:
        raise ValueError("Unexpected source-revision request fields")
    identifier(values.get("snapshot"))
    original = options(workspace, values.get("refresh_plan_id"), values.get("kind"),
                       values.get("id"), snapshot=values.get("snapshot"))
    if values.get("record_sha256") != original["record_sha256"]:
        raise ValueError("The original study record changed; reopen its source revision")
    selection = deepcopy(original["original_selection"])
    changed, validations, cache = [], [], {}
    choices = values.get("choices", [])
    if not isinstance(choices, list):
        raise ValueError("Replacement choices must be an explicit list")
    if original["kind"] == "plans":
        if values.get("use_successors") or values.get("plan_id"):
            raise ValueError("Source-plan revisions do not substitute numerical records")
        bindings = {row["id"]: row for row in original["bindings"]}
        selected, tokens_seen = set(), []
        for choice in choices:
            if not isinstance(choice, dict) or set(choice) - {"binding_id", "source", "relation"}:
                raise ValueError("Choose an original mapped source binding")
            key = choice.get("binding_id")
            if key not in bindings or key in selected:
                raise ValueError("Each original source binding can be revised only once")
            binding = bindings[key]
            tokens = binding["tokens"]
            if any(tokens[:len(old)] == old or old[:len(tokens)] == tokens for old in tokens_seen):
                raise ValueError("Revise nested source references separately in the original complete editor")
            tokens_seen.append(tokens)
            selected.add(key)
            updated, relation, validation = _source_update(
                workspace, binding, choice, selection.get("analysis_crs", "EPSG:5070"), cache)
            parent = selection
            for token in tokens[:-1]:
                parent = parent[token]
            source_changed = digest(parent[tokens[-1]]) != digest(updated)
            parent[tokens[-1]] = updated
            if relation is not None:
                previous_relation = deepcopy(parent.get("relation"))
                original_relation = parent.setdefault("relation", {})
                original_relation.update({key: deepcopy(value) for key, value in relation.items() if key != "buffer_m"})
                if "buffer_m" in relation:
                    original_relation["buffer_m"] = relation["buffer_m"]
                else:
                    original_relation.pop("buffer_m", None)
                if digest(previous_relation) != digest(original_relation):
                    changed.append(_path(tuple(tokens[:-1]) + ("relation",)))
            if source_changed:
                changed.append(binding["path"])
            validations.append(validation)
        missing = []
    else:
        if choices:
            raise ValueError("Prepare and save a revised source plan before selecting it for an analysis")
        use_successors = values.get("use_successors", False)
        if type(use_successors) is not bool:
            raise ValueError("Choose explicitly whether to use saved successor runs")
        if use_successors:
            checked = original["successor_check"]
            if not checked["compatible"]:
                raise ValueError(checked.get("message") or "The saved successor cohort is unavailable")
            ids = [row["successor_id"] for row in checked["runs"]]
            if selection["baseline_run_id"] != ids[0]:
                changed.append("selection.baseline_run_id")
            if selection["alternative_run_ids"] != ids[1:]:
                changed.append("selection.alternative_run_ids")
            selection["baseline_run_id"], selection["alternative_run_ids"] = ids[0], ids[1:]
        plan_id = identifier(values.get("plan_id") or selection["plan_id"])
        plan = waters.inspect_plan(workspace, plan_id, verify=False)
        if plan["state"] != "complete":
            raise ValueError("Select a complete original source plan")
        if plan_id != selection["plan_id"]:
            selection["plan_id"] = plan_id
            changed.append("selection.plan_id")
        missing = _missing_accounting(selection, plan)
    return {**original, "selection": selection, "changed_paths": changed,
            "validated_sources": validations, "missing_accounting": missing,
            "draft_id": digest({"record": original["record_sha256"],
                                "refresh": original["refresh_snapshot"], "selection": selection}),
            "interpretation": (
                "This is an editable draft. Original declarations, intake references, classification and other evidence remain retained unless explicitly selected for revision. "
                "New geometry IDs do not establish that old metadata describes the new source edition. Review these associations in the complete original editor. "
                "The original preparation/analysis engine validates complete topology, accounting and physical support when saved.")}
