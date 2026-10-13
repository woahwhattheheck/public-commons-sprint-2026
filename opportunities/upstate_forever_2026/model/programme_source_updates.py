"""Create explicit Programme successors from saved native source-refresh results.

Both retained refresh engines are read through their maintained facade. This
module never applies a refresh or dispatches a native model. The original
Programme, its reports, and its native runs remain independently available.
"""
from __future__ import annotations

from copy import deepcopy

from .common import digest, held, identifier
from .compute_programme import ComputeProgrammes, _engine_sources
from . import source_refresh

VERSION = 1
KIND = "programme-source-updates"
PREVIEW_SCHEMA = "upstate.programme-source-update-preview/v1"
CATALOG_SCHEMA = "upstate.programme-source-update-catalog/v1"
KINDS = ("profiles", "scenarios", "grids", "runs")
FIELDS = {"profiles": "profile_id", "scenarios": "scenario_id", "grids": "grid_id"}


def _issue(code, message, run_key=None):
    value = {"code": code, "message": str(message)}
    if run_key is not None:
        value["run_key"] = run_key
    return value


def _models(selection):
    from .model_selection import models
    return list(models(selection.get("models")))


def _native(ws, kind, key):
    key = identifier(key)
    if kind == "grids":
        return ws.get_grid(key)
    if kind == "runs":
        value = ws.inspect_run(key)
        if value.get("id") != key or digest(value.get("selection")) != key:
            raise ValueError("Native run identity changed: " + key)
        from .model_selection import validate_completed_run
        validate_completed_run(value)
        return value
    return ws._get(kind, key)


def _native_payload(kind, value):
    if kind == "grids":
        return value["spec"]
    if kind == "runs":
        return value["selection"]
    return {key: item for key, item in value.items()
            if key not in ("id", "schema", "table_summary")}


def _nodes(plan):
    """All original selected nodes, including root-engine reuse nodes."""
    result = {kind: {} for kind in KINDS}
    if plan.get("engine") == "roots":
        raw = plan.get("immutable_plan", plan)
        for node in raw["nodes"]:
            kind = node["kind"]
            if kind not in result:
                raise ValueError("Unknown native refresh node kind: " + str(kind))
            key = identifier(node["old_id"])
            if key in result[kind]:
                raise ValueError("Duplicate original refresh node: " + kind + "/" + key)
            result[kind][key] = node
    elif plan.get("engine") == "edition":
        report = plan["preview"]
        affected = report["affected"]
        for kind in KINDS:
            impacts = {row["id"]: row for row in affected.get(kind, [])}
            for original in report["snapshots"][kind]:
                key = identifier(original["id"])
                result[kind][key] = {
                    "kind": kind, "old_id": key, "original": original,
                    **deepcopy(impacts.get(key, {}))}
    else:
        raise ValueError("This saved source-refresh format is unsupported")
    return result


def _mappings(plan):
    state = plan.get("state") or {}
    mappings = state.get("mappings") or {}
    result = {}
    for kind in KINDS:
        rows = mappings.get(kind, {})
        if not isinstance(rows, dict):
            raise ValueError("Refresh mappings must be keyed by original native identity")
        result[kind] = {identifier(old): identifier(new) for old, new in rows.items()}
    return result


def _plan_info(ws, plan):
    selection = plan["selection"]
    collections = []
    for field in ("from_collection_id", "to_collection_id"):
        value = ws._get("sources", selection[field])
        collections.append({"id": value["id"], "title": value.get("title", value["id"])})
    return {
        "id": plan["id"], "title": plan.get("title", "Source refresh"),
        "engine": plan["engine"], "state": (plan.get("state") or {}).get("state", "planned"),
        "from_collection": collections[0], "to_collection": collections[1]}


def _programme_info(manager, record):
    state = manager._state(record["id"])
    return {
        "id": record["id"], "title": record["title"], "state": state["state"],
        "grid_id": record["selection"]["grid_id"],
        "baseline_run": record["selection"]["baseline_run"],
        "run_count": len(record["runs"])}


def _references(ws, run):
    rows = []
    for kind, field in FIELDS.items():
        value = _native(ws, kind, run["selection"][field])
        payload = value["spec"] if kind == "grids" else value
        collection_id = payload.get("source_collection_id")
        if not collection_id:
            continue
        if kind == "profiles":
            source_ids = [payload.get("biophysical_source_id")]
        elif kind == "scenarios":
            source_ids = [patch.get("mask_source_id") for patch in payload.get("patches", [])]
        else:
            source_ids = list((payload.get("input_sources") or {}).values())
            source_ids.extend((payload.get(name) or {}).get("source_id")
                              for name in ("reporting_area", "model_domain"))
        for source_id in sorted(set(value for value in source_ids if value)):
            rows.append({"kind": kind, "native_id": value["id"],
                         "collection_id": collection_id, "source_id": source_id})
    return rows


def _expected_dependency(plan, kind, node):
    if plan["engine"] == "edition":
        # Use the same edition remapper as native refresh, without saving.
        return source_refresh._remapped(kind, node["original"], plan["preview"])
    payload = deepcopy(node["selection"])
    if node.get("action") == "reuse":
        return payload
    if node.get("action") == "missing":
        raise ValueError("A selected refresh source has no replacement")
    payload["source_collection_id"] = plan["selection"]["to_collection_id"]
    from .source_refresh_legacy import SourceRefresh
    for reference in node.get("source_references", []):
        replacement = reference.get("replacement_id")
        if replacement is None:
            raise ValueError("A selected source reference has no replacement")
        SourceRefresh._assign(payload, reference["field"], replacement)
    return payload


def _verify_mapping(ws, plan, nodes, mappings, kind, old_id, used, checked):
    """Validate mutable output IDs against the immutable plan, without writers."""
    pair = (kind, old_id)
    if pair in checked:
        return mappings[kind][old_id]
    node = nodes[kind].get(old_id)
    new_id = mappings[kind].get(old_id)
    if node is None or new_id is None:
        raise ValueError("Prepare the retained refresh mapping for " + kind + "/" + old_id)
    if plan["engine"] == "roots" and node.get("action") == "reuse":
        if new_id != old_id:
            raise ValueError("A reused refresh node changed native identity")
        _native(ws, kind, new_id)
    elif kind == "runs":
        original = _native(ws, "runs", old_id)
        expected = {field: original["selection"][field] for field in FIELDS.values()}
        for dependency_kind, field in FIELDS.items():
            old_dependency = original["selection"][field]
            if old_dependency in nodes[dependency_kind]:
                expected[field] = _verify_mapping(
                    ws, plan, nodes, mappings, dependency_kind, old_dependency, used, checked)
        target = _native(ws, "runs", new_id)
        if any(target["selection"].get(key) != value for key, value in expected.items()):
            raise ValueError("A refreshed run selects different retained dependencies")
        if _models(original["selection"]) != _models(target["selection"]):
            raise ValueError("A refreshed run changed the selected native models")
    else:
        expected = _expected_dependency(plan, kind, node)
        actual = _native_payload(kind, _native(ws, kind, new_id))
        expected = {key: value for key, value in expected.items()
                    if key not in ("id", "schema", "table_summary")}
        if any(key not in actual or actual[key] != value for key, value in expected.items()):
            raise ValueError("A refreshed " + kind + " selection differs from its saved plan")
    used[kind][old_id] = new_id
    checked.add(pair)
    return new_id


def _relevant(record, nodes):
    for row in record["runs"]:
        if row["run_id"] in nodes["runs"]:
            return True
        if any(row["native_selection"][field] in nodes[kind]
               for kind, field in FIELDS.items()):
            return True
    return False


def _lineage_rows(rows):
    fields = ("key", "source_run_id", "target_run_id", "source_profile_id",
              "target_profile_id", "source_scenario_id", "target_scenario_id",
              "source_grid_id", "target_grid_id", "models", "action", "mapping_origin")
    return [{field: deepcopy(row[field]) for field in fields} for row in rows]


def preview(ws, programme_id, refresh_plan_id, *, title=None):
    """Read a successor selection. Missing refresh outputs remain visible issues."""
    manager = ComputeProgrammes(ws)
    record = manager._load(identifier(programme_id))
    plan = source_refresh.get_plan(ws, identifier(refresh_plan_id))
    nodes, mappings = _nodes(plan), _mappings(plan)
    info = _plan_info(ws, plan)
    issues, warnings, rows, proposed = [], [], [], []
    used = {kind: {} for kind in KINDS}
    checked = set()
    try:
        source_refresh.validate_plan(ws, plan["id"])
    except (OSError, ValueError, KeyError) as exc:
        issues.append(_issue("refresh_plan_invalid", exc))
    relevant = _relevant(record, nodes)
    if not relevant:
        issues.append(_issue("unrelated_refresh", "This refresh plan selects no native dependencies of this Programme."))
    new_title = title if title is not None else record["title"] + " — " + info["to_collection"]["title"]
    if not isinstance(new_title, str) or not new_title.strip():
        issues.append(_issue("missing_title", "Enter a title for the successor Programme."))
        new_title = ""
    else:
        new_title = new_title.strip()
    selection_rows = {row["key"]: row for row in record["selection"]["runs"]}
    for binding in record["runs"]:
        key, old_id = binding["key"], binding["run_id"]
        selected = deepcopy(selection_rows[key])
        old = _native(ws, "runs", old_id)
        if old["selection"] != binding["native_selection"]:
            raise ValueError("An original Programme run differs from its immutable binding")
        source_selection = old["selection"]
        dependencies = [(kind, source_selection[field])
                        for kind, field in FIELDS.items()
                        if source_selection[field] in nodes[kind]]
        selected_node = nodes["runs"].get(old_id)
        affected = bool(selected_node or dependencies)
        new_id = old_id
        target = old
        action = "retain"
        reasons = []
        requires_rerun = False
        mapping_origin = "original"
        if affected:
            affected_nodes = ([selected_node] if selected_node else []) + [
                nodes[kind][old] for kind, old in dependencies]
            for node in affected_nodes:
                reasons.extend(str(reason) for reason in node.get("reasons", []))
                requires_rerun |= bool(node.get("requires_native_rerun") or node.get("action") == "derive")
            try:
                if old_id in mappings["runs"]:
                    new_id = _verify_mapping(ws, plan, nodes, mappings, "runs", old_id, used, checked)
                    target = _native(ws, "runs", new_id)
                    action = "replace" if new_id != old_id else "retain"
                    mapping_origin = "refresh-run"
                elif selected_node:
                    raise ValueError("Prepare the selected run mapping in the source-refresh plan first.")
                elif dependencies:
                    # A roots plan may select only a shared dependency. The
                    # maintained Programme preview derives every dependent run.
                    target_selection = deepcopy(source_selection)
                    for dependency_kind, old_dependency in dependencies:
                        target_selection[FIELDS[dependency_kind]] = _verify_mapping(
                            ws, plan, nodes, mappings, dependency_kind,
                            old_dependency, used, checked)
                    if target_selection != source_selection:
                        new_id = None
                        target = {"selection": target_selection, "state": "unprepared"}
                        action = "replace"
                        mapping_origin = "programme-preparation"
                    else:
                        mapping_origin = "dependency-reuse"
            except (OSError, ValueError, KeyError) as exc:
                issues.append(_issue("refresh_output_pending_or_invalid", exc, key))
                new_id, target, action = None, None, "pending"
        target_selection = target["selection"] if target else {}
        row = {
            "key": key, "title": binding["title"], "action": action,
            "source_run_id": old_id, "target_run_id": new_id,
            "source_profile_id": source_selection["profile_id"],
            "target_profile_id": target_selection.get("profile_id"),
            "source_scenario_id": source_selection["scenario_id"],
            "target_scenario_id": target_selection.get("scenario_id"),
            "source_grid_id": source_selection["grid_id"],
            "target_grid_id": target_selection.get("grid_id"),
            "models": _models(source_selection), "source_state": old["state"],
            "target_state": target.get("state") if target else None,
            "prepared_on_create": mapping_origin == "programme-preparation",
            "target_existing": target is not None and mapping_origin != "programme-preparation",
            "requires_native_rerun": requires_rerun, "mapping_origin": mapping_origin,
            "source_ids": {"from": _references(ws, old),
                           "to": _references(ws, target) if target else []},
            "reasons": list(dict.fromkeys(reasons))}
        rows.append(row)
        if target:
            selected["profile_id"] = target_selection["profile_id"]
            selected["scenario_id"] = target_selection["scenario_id"]
            if mapping_origin == "programme-preparation":
                selected.pop("source_runs", None)
                selected.pop("native_run_id", None)
                if "models" in target_selection:
                    selected["models"] = deepcopy(target_selection["models"])
            elif action == "replace" or "source_runs" not in selected:
                selected.pop("source_runs", None)
                selected["native_run_id"] = new_id
            # An unchanged assembly keeps its exact completed-source-stage bindings.
            proposed.append(selected)
    grids = sorted({row["target_grid_id"] for row in rows if row["target_grid_id"]})
    if len(grids) > 1:
        issues.append(_issue("mixed_target_grids",
            "The mapped runs select different grids. Refresh all Programme rows onto one grid before creating a successor."))
    target_grid = grids[0] if len(grids) == 1 else None
    selection = None
    programme_preview = None
    engine = _engine_sources(assembly=any("source_runs" in row for row in proposed))
    if target_grid and len(proposed) == len(rows) and new_title:
        selection = {
            **deepcopy(record["selection"]), "title": new_title,
            "grid_id": target_grid, "runs": proposed}
        selection["source_reference"] = "programme-source-update:" + digest({
            "source_programme_id": record["id"], "refresh_plan_id": plan["id"],
            "mappings": used, "engine_sources": engine})
        try:
            programme_preview = manager.preview(selection)
            selection = programme_preview["selection"]
            targets = {row["key"]: row for row in programme_preview["runs"]}
            for row in rows:
                native = targets[row["key"]]
                if row["mapping_origin"] == "programme-preparation":
                    row["target_run_id"] = native["run_id"]
                    row["target_state"] = native["state"]
                    row["target_existing"] = native["existing"]
                    row["prepared_on_create"] = not native["existing"]
                    if _models(native["native_selection"]) != row["models"]:
                        raise ValueError("Programme preparation changed the selected native models")
                elif native["run_id"] != row["target_run_id"]:
                    raise ValueError("Programme preparation does not preserve the mapped native identities")
            warnings.extend(programme_preview.get("warnings", []))
        except (OSError, ValueError, KeyError) as exc:
            issues.append(_issue("programme_selection_invalid", exc))
    if rows and all(row["action"] == "retain" for row in rows):
        warnings.append("This plan retains every selected native run. The successor records the reviewed source-refresh lineage.")
    pending = sum(row["target_state"] != "complete" for row in rows if row["target_run_id"])
    if pending:
        warnings.append(str(pending) + " mapped Programme rows still need native completion through the existing Programme execution controls.")
    lineage = {
        "version": VERSION, "workspace_id": ws.project["id"],
        "source_programme_id": record["id"], "refresh_plan_id": plan["id"],
        "refresh_engine": plan["engine"],
        "from_collection_id": info["from_collection"]["id"],
        "to_collection_id": info["to_collection"]["id"],
        "mappings": used, "runs": _lineage_rows(rows), "engine_sources": engine}
    identity = {
        "schema": PREVIEW_SCHEMA, "lineage": lineage, "selection": selection,
        "programme_grid_identity": programme_preview["grid_identity"] if programme_preview else None,
        "programme_bindings": [{key: value for key, value in row.items()
                                if key not in ("state", "existing")}
                               for row in programme_preview["runs"]] if programme_preview else None,
        "issues": issues}
    return {
        "schema": PREVIEW_SCHEMA, "id": digest(identity), "ready": not issues and programme_preview is not None,
        "issues": issues, "warnings": list(dict.fromkeys(warnings)),
        "programme": _programme_info(manager, record), "refresh_plan": info,
        "runs": rows, "source_grid_id": record["selection"]["grid_id"],
        "target_grid_id": target_grid, "selection": selection,
        "programme_preview": programme_preview, "lineage": lineage}


def create(ws, programme_id, refresh_plan_id, *, expected_preview_id, title=None):
    """Create or reopen the reviewed successor; never execute native models."""
    expected_preview_id = identifier(expected_preview_id)
    # Portable capture takes this dedicated lock before inventory. It covers
    # successor creation and the immutable link without nesting Workspace locks.
    with held(ws.root / ".programme-source-updates.lock", blocking=False):
        with source_refresh.export_lock(ws, refresh_plan_id):
            reviewed = preview(ws, programme_id, refresh_plan_id, title=title)
            if reviewed["id"] != expected_preview_id:
                raise ValueError("The source mappings or Programme selection changed. Review the successor preview again.")
            if not reviewed["ready"]:
                raise ValueError("; ".join(row["message"] for row in reviewed["issues"]))
            manager = ComputeProgrammes(ws)
            status = manager.create(reviewed["selection"])
            created = manager._load(status["id"])
            if created["selection"] != reviewed["selection"]:
                raise ValueError("The saved successor selection differs from the reviewed selection")
            if created["identity"]["engine_sources"] != reviewed["lineage"]["engine_sources"]:
                raise ValueError("The installed native engine changed during successor creation")
            expected = {row["key"]: row["target_run_id"] for row in reviewed["runs"]}
            if {row["key"]: row["run_id"] for row in created["runs"]} != expected:
                raise ValueError("The saved successor does not retain every mapped native run")
            link = ws._save(KIND, {
                "version": VERSION, "workspace_id": ws.project["id"],
                "source_programme_id": programme_id, "successor_programme_id": created["id"],
                "refresh_plan_id": refresh_plan_id, "preview_id": reviewed["id"],
                "selection": deepcopy(created["selection"]),
                "lineage": deepcopy(reviewed["lineage"]), "created_at": created["created_at"]})
            return {
                "id": created["id"], "programme_id": created["id"],
                "title": created["title"], "state": status["state"],
                "source_update_id": link["id"], "lineage": link["lineage"],
                "report_available": bool(status.get("report"))}


def _verify_link(ws, link):
    if link.get("version") != VERSION or link.get("workspace_id") != ws.project["id"]:
        raise ValueError("Programme source-update linkage belongs to a different Workspace or version")
    manager = ComputeProgrammes(ws)
    before = manager._load(link["source_programme_id"])
    after = manager._load(link["successor_programme_id"])
    lineage = link["lineage"]
    if (lineage.get("workspace_id") != ws.project["id"]
            or lineage.get("source_programme_id") != before["id"]
            or lineage.get("refresh_plan_id") != link["refresh_plan_id"]
            or link["selection"] != after["selection"]
            or lineage.get("engine_sources") != after["identity"]["engine_sources"]):
        raise ValueError("Programme source-update lineage differs from the retained Programme")
    reviewed_identity = {
        "schema": PREVIEW_SCHEMA, "lineage": lineage, "selection": after["selection"],
        "programme_grid_identity": after["identity"]["grid_identity"],
        "programme_bindings": after["runs"], "issues": []}
    if digest(reviewed_identity) != link.get("preview_id"):
        raise ValueError("Programme source-update preview identity changed")
    source_refresh.validate_plan(ws, link["refresh_plan_id"])
    plan = source_refresh.get_plan(ws, link["refresh_plan_id"])
    nodes = _nodes(plan)
    info = _plan_info(ws, plan)
    if (lineage.get("refresh_engine") != plan["engine"]
            or lineage.get("from_collection_id") != info["from_collection"]["id"]
            or lineage.get("to_collection_id") != info["to_collection"]["id"]):
        raise ValueError("Programme source-update source edition lineage changed")
    mappings = deepcopy(lineage["mappings"])
    if set(mappings) != set(KINDS):
        raise ValueError("Programme source-update linkage lacks a native mapping family")
    # Saved mappings remain meaningful if the refresh operation later advances.
    checked, used = set(), {kind: {} for kind in KINDS}
    for kind in KINDS:
        for old_id in mappings[kind]:
            _verify_mapping(ws, plan, nodes, mappings, kind, old_id, used, checked)
    if used != mappings:
        raise ValueError("Programme source-update linkage contains unused native mappings")
    previous = {row["key"]: row for row in before["runs"]}
    current = {row["key"]: row for row in after["runs"]}
    rows = lineage["runs"]
    if ([row["key"] for row in rows] != [row["key"] for row in before["runs"]]
            or list(current) != list(previous)
            or before["selection"]["baseline_run"] != after["selection"]["baseline_run"]):
        raise ValueError("Programme source-update lineage changed run order or the named baseline")
    for row in rows:
        old, new = previous[row["key"]], current[row["key"]]
        for binding in (old, new):
            native = _native(ws, "runs", binding["run_id"])
            if native["selection"] != binding["native_selection"]:
                raise ValueError("Programme source-update native selection differs from its retained binding")
        if row["source_run_id"] != old["run_id"] or row["target_run_id"] != new["run_id"]:
            raise ValueError("Programme source-update lineage changed an original native run")
        origin = row.get("mapping_origin")
        if origin == "programme-preparation":
            if old["run_id"] in nodes["runs"]:
                raise ValueError("A selected refresh run was bypassed during Programme preparation")
            expected_selection = {field: mappings[kind].get(
                old["native_selection"][field], old["native_selection"][field])
                for kind, field in FIELDS.items()}
            if any(new["native_selection"][field] != value
                   for field, value in expected_selection.items()):
                raise ValueError("Prepared Programme run differs from the mapped dependencies")
            if new["run_id"] != digest(new["native_selection"]):
                raise ValueError("Prepared Programme run identity changed")
        elif origin in ("original", "refresh-run", "dependency-reuse"):
            expected = mappings["runs"].get(old["run_id"], old["run_id"])
            if new["run_id"] != expected:
                raise ValueError("Successor run differs from the exact saved refresh mapping")
        else:
            raise ValueError("Unknown Programme source-update mapping origin")
        for kind, field in FIELDS.items():
            if (row["source_" + field] != old["native_selection"][field]
                    or row["target_" + field] != new["native_selection"][field]):
                raise ValueError("Programme source-update dependency lineage changed")
        if row["models"] != _models(old["native_selection"]) or row["models"] != _models(new["native_selection"]):
            raise ValueError("Programme source-update selected model lineage changed")
    return before, after


def catalog(ws, programme_id):
    manager = ComputeProgrammes(ws)
    record = manager._load(identifier(programme_id))
    plans = []
    for saved in source_refresh.list_plans(ws):
        plan = source_refresh.get_plan(ws, saved["id"])
        try:
            nodes = _nodes(plan)
            if not _relevant(record, nodes):
                continue
            info = _plan_info(ws, plan)
            mappings = _mappings(plan)
            relevant_runs = [row for row in record["runs"]
                             if row["run_id"] in nodes["runs"]
                             or any(row["native_selection"][field] in nodes[kind]
                                    for kind, field in FIELDS.items())]
            plans.append({
                **info, "affected_run_count": len(relevant_runs),
                "mapped_run_count": sum(row["run_id"] in mappings["runs"] for row in relevant_runs),
                "issues": deepcopy(plan.get("preview", {}).get("problems", []))})
        except (OSError, ValueError, KeyError) as exc:
            plans.append({"id": saved["id"], "title": saved.get("title", "Source refresh"),
                          "engine": saved.get("engine"), "state": saved.get("state"),
                          "from_collection": None, "to_collection": None,
                          "affected_run_count": None, "mapped_run_count": None,
                          "issues": [_issue("refresh_plan_invalid", exc)]})
    successors = []
    for link in ws._list(KIND):
        if link.get("source_programme_id") != record["id"]:
            continue
        _, after = _verify_link(ws, link)
        progress = manager._state(after["id"])
        successors.append({
            "id": link["id"], "programme_id": after["id"], "title": after["title"],
            "state": progress["state"], "refresh_plan_id": link["refresh_plan_id"],
            "created_at": link["created_at"]})
    return {"schema": CATALOG_SCHEMA, "programme": _programme_info(manager, record),
            "plans": plans, "successors": sorted(successors, key=lambda row: (row["created_at"], row["id"]), reverse=True)}


def verify_workspace(ws, *, verified_members=None):
    """Read-only semantic verification after the original portable byte checks."""
    links = ws._list(KIND)
    for link in links:
        _verify_link(ws, link)
    return {"schema": "upstate.programme-source-update-verification/v1",
            "workspace_id": ws.project["id"], "source_update_count": len(links)}
