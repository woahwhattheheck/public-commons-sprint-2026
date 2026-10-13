"""Read-only Source Updates impact on original Receiving studies.

TokenJunkieLabs / Ecosystem Sciences. Uses saved refresh mappings and validated
native records. No source materialization, revised selection, cache files or
model work is performed. Runtime caches retain compact record projections only.
"""
from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from threading import RLock

from .common import digest, identifier
from . import source_refresh

SCHEMA = "upstate.receiving-source-impact/v1"
_CACHE = OrderedDict()
_CACHE_LOCK = RLock()
_PAGE_LIMIT = 25
_RUN_LIMIT = 64


def _number(value, default, maximum):
    if value is None:
        return default
    if isinstance(value, bool):
        raise ValueError("Use a nonnegative whole page offset or limit")
    parsed = int(value)
    if str(parsed) != str(value) or parsed < 0 or parsed > maximum:
        raise ValueError("Use a nonnegative whole page offset or limit")
    return parsed


def _stamp(path):
    stat = path.stat()
    return (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)


def _cached(workspace, path, project):
    """Validate on change, retaining only a compact projection, never geometry."""
    key = (str(workspace.root.resolve()), workspace.project["id"], str(path))
    before = _stamp(path)
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached and cached[0] == before:
            _CACHE.move_to_end(key)
            return deepcopy(cached[1])
    value = project()
    if _stamp(path) != before:
        raise ValueError("The selected record changed during this read; reload this page")
    with _CACHE_LOCK:
        _CACHE[key] = (before, deepcopy(value))
        _CACHE.move_to_end(key)
        while len(_CACHE) > 64:
            _CACHE.popitem(last=False)
    return value


def _pair(value):
    if not isinstance(value, dict):
        return None
    collection, source = value.get("source_collection_id"), value.get("source_id")
    if isinstance(collection, str) and collection and isinstance(source, str) and source:
        return collection, source
    return None


def _walk(value, path="selection"):
    if isinstance(value, dict):
        if _pair(value):
            yield path, value
        for name, item in value.items():
            yield from _walk(item, path + "." + name)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk(item, path + "[" + str(index) + "]")


def _plan_projection(record):
    selection = record["identity"]["selection"]
    consumed, rows = {}, []
    for index, receptor in enumerate(selection.get("receptors", [])):
        path = "selection.receptors[" + str(index) + "].source"
        consumed[path] = ("receptor_geometry", receptor.get("id"))
    upstream = any((row.get("relation") or {}).get("method") == "upstream_huc"
                   for row in selection.get("receptors", []))
    if upstream:
        consumed["selection.catchments"] = ("upstream_catchments", None)
    for path, source in _walk(selection):
        role, receptor_id = consumed.get(path, ("retained_context", None))
        collection_id, source_id = _pair(source)
        rows.append({"path": path, "role": role, "receptor_id": receptor_id,
                     "source_collection_id": collection_id, "source_id": source_id,
                     "requested_layer": source.get("layer"),
                     "explicit_feature_count": len(source["feature_ids"])
                     if isinstance(source.get("feature_ids"), list) else None})
    # The engine's actual consumed list is distinct from recursive context.
    actual = []
    for index, source in enumerate(record["identity"].get("source_identities", [])):
        if _pair(source):
            collection_id, source_id = _pair(source)
            item = {"source_collection_id": collection_id, "source_id": source_id,
                    "body_sha256": source.get("body_sha256"),
                    "body_bytes": source.get("body_bytes"),
                    "feature_count": len(source.get("feature_ids", [])),
                    "identity_index": index}
            actual.append(item)
            if not any(_pair(row) == (collection_id, source_id)
                       and row["role"] != "retained_context" for row in rows):
                rows.append({**item, "path": "identity.source_identities[" + str(index) + "]",
                             "role": "compiled_consumed_source", "receptor_id": None})
    return {"id": record["id"], "title": record.get("title") or record["id"],
            "state": record.get("state"), "record_sha256": record["record_sha256"],
            "created_at": record.get("created_at"), "bindings": rows,
            "consumed_identities": actual,
            "receptor_count": len(record.get("receptors", []))}


def _plan(workspace, key):
    from . import receiving_waters
    key = identifier(key)
    path = workspace.root / "receiving-water-plans" / key / "plan.json"
    return _cached(workspace, path, lambda: _plan_projection(
        receiving_waters.inspect_plan(workspace, key, verify=False)))


def _analysis(workspace, key):
    from . import receiving_waters
    key = identifier(key)
    path = workspace.root / "receiving-water-analyses" / key / "analysis.json"

    def project():
        record = receiving_waters.inspect(workspace, key, verify=False)
        selection = record["identity"]["selection"]
        return {"id": key, "title": record.get("title") or selection.get("title") or key,
                "state": record.get("state"), "record_sha256": record["record_sha256"],
                "created_at": record.get("created_at"),
                "plan_id": selection["plan_id"],
                "plan_record_sha256": record["identity"]["plan_record_sha256"],
                "baseline_run_id": selection["baseline_run_id"],
                "alternative_run_ids": list(selection.get("alternative_run_ids", [])),
                "selection_sha256": digest(selection)}
    return _cached(workspace, path, project)


def _refresh(workspace, key, expected=None):
    value = source_refresh.get_plan(workspace, identifier(key))
    preview = value.get("preview") or {}
    if preview.get("schema") != "upstate.source-refresh-preview/v1":
        raise ValueError("Choose a supported saved Source Updates plan")
    selection, state = value["selection"], value.get("state") or {}
    result = {
        "id": value["id"], "title": value.get("title") or value["id"],
        "engine": value.get("engine"), "format": value.get("format"),
        "from_collection_id": selection["from_collection_id"],
        "to_collection_id": selection["to_collection_id"],
        "from_collection": preview.get("from_collection", {}),
        "to_collection": preview.get("to_collection", {}),
        "changes": deepcopy(preview.get("changes", [])),
        "source_id_map": deepcopy(preview.get("resolved_source_id_map", {})),
        "affected": deepcopy(preview.get("affected", {})),
        "mappings": deepcopy(state.get("mappings") or {}),
        "state": state.get("state", "planned"), "phase": state.get("phase"),
        "updated_at": state.get("updated_at"),
        "problems": deepcopy(preview.get("problems", [])),
        "warnings": deepcopy(preview.get("warnings", [])),
    }
    result["snapshot"] = digest(result)
    if expected and expected != result["snapshot"]:
        raise ValueError("The saved refresh progress changed; reload the impact view")
    return result


def _change_index(refresh):
    return {row["from_source_id"]: row for row in refresh["changes"]
            if row.get("from_source_id") is not None}


def _binding_impact(binding, refresh, changes):
    if binding["source_collection_id"] != refresh["from_collection_id"]:
        return None
    original = binding["source_id"]
    change = changes.get(original)
    target = refresh["source_id_map"].get(original)
    if change is None:
        # Preserve an unsupported/missing original entry explicitly.
        change = {"from_source_id": original, "to_source_id": target,
                  "status": "unmapped", "reasons": ["Original binding is absent from the saved source change inventory"]}
    return {**deepcopy(binding), "replacement_collection_id": refresh["to_collection_id"],
            "replacement_source_id": target, "change": deepcopy(change),
            "interpretation": ("Context/provenance reference; this is not an asserted geometry or numerical dependency"
                               if binding["role"] == "retained_context" else
                               "Original native grid/profile/scenario input; the retained full-domain run remains the numerical authority"
                               if binding["role"].startswith("native_") else
                               "Original source consumed by receiving-water preparation; revised feature membership must be selected explicitly")}


def _plan_impact(plan, refresh):
    changes = _change_index(refresh)
    bindings = [result for row in plan["bindings"]
                if (result := _binding_impact(row, refresh, changes)) is not None]
    consumed = [row for row in bindings if row["role"] != "retained_context"]
    context = [row for row in bindings if row["role"] == "retained_context"]
    return {"id": plan["id"], "title": plan["title"], "state": plan["state"],
            "created_at": plan["created_at"], "record_sha256": plan["record_sha256"],
            "receptor_count": plan["receptor_count"], "bindings": bindings,
            "consumed_identities": [row for row in plan["consumed_identities"]
                                    if row["source_collection_id"] == refresh["from_collection_id"]],
            "counts": {"consumed_bindings": len(consumed), "context_bindings": len(context),
                       "changed_consumed_bindings": sum(row["change"].get("status") != "unchanged" for row in consumed),
                       "changed_context_bindings": sum(row["change"].get("status") != "unchanged" for row in context),
                       "unmapped_bindings": sum(row["replacement_source_id"] is None for row in bindings)}}


def _native_sources(workspace, run_id):
    """Follow actual run/grid/profile/scenario definitions, not preview coverage."""
    run_id = identifier(run_id)
    run = workspace.inspect_run(run_id)
    selection = run["selection"]
    rows = []
    for kind, id_field in (("grids", "grid_id"), ("profiles", "profile_id"), ("scenarios", "scenario_id")):
        key = identifier(selection[id_field])
        if kind == "grids":
            path = workspace.root / kind / key / "grid.json"
            getter = lambda key=key: workspace.get_grid(key)
        else:
            path = workspace.root / kind / (key + ".json")
            getter = lambda kind=kind, key=key: workspace._get(kind, key)

        def project(kind=kind, key=key, getter=getter):
            record = getter()
            spec = record["spec"] if kind == "grids" else record
            collection_id = spec.get("source_collection_id")
            if kind == "profiles":
                refs = [("biophysical_source_id", spec.get("biophysical_source_id"))]
            elif kind == "scenarios":
                refs = [("patches[" + str(index) + "].mask_source_id", patch.get("mask_source_id"))
                        for index, patch in enumerate(spec.get("patches", []))]
            else:
                refs = [("input_sources." + name, source_id)
                        for name, source_id in (spec.get("input_sources") or {}).items()]
                refs += [(name + ".source_id", (spec.get(name) or {}).get("source_id"))
                         for name in ("reporting_area", "model_domain")]
            return [{"source_collection_id": collection_id, "source_id": source_id,
                     "role": "native_" + kind[:-1], "path": kind + "." + key + "." + field}
                    for field, source_id in refs if collection_id and source_id]
        rows.extend(_cached(workspace, path, project))
    return {"id": run_id, "state": run.get("state"), "selection": deepcopy(selection),
            "bindings": rows}


def _analysis_impact(workspace, analysis, refresh):
    plan = _plan(workspace, analysis["plan_id"])
    if plan["record_sha256"] != analysis["plan_record_sha256"]:
        raise ValueError("The original analysis plan record changed")
    plan_impact = _plan_impact(plan, refresh)
    ids = [analysis["baseline_run_id"], *analysis["alternative_run_ids"]]
    if len(ids) > _RUN_LIMIT:
        raise ValueError("This analysis exceeds the bounded impact read of 64 retained runs; inspect its original study directly")
    changes, runs = _change_index(refresh), []
    affected = {row.get("id"): row for row in refresh["affected"].get("runs", [])}
    mappings = refresh["mappings"].get("runs") or {}
    for run_id in ids:
        native = _native_sources(workspace, run_id)
        bindings = [result for row in native["bindings"]
                    if (result := _binding_impact(row, refresh, changes)) is not None]
        runs.append({"id": run_id, "role": "baseline" if run_id == analysis["baseline_run_id"] else "alternative",
                     "state": native["state"], "bindings": bindings,
                     "captured_by_refresh": run_id in affected,
                     "saved_refresh_assessment": deepcopy(affected.get(run_id)),
                     "recorded_successor_id": mappings.get(run_id),
                     "successor_checked": False})
    return {**analysis, "plan": plan_impact, "runs": runs,
            "related": bool(plan_impact["bindings"] or any(row["bindings"] or row["recorded_successor_id"] for row in runs))}


def _check_successors(workspace, analysis, refresh):
    """Check current records; no inferred successful run and no automatic reuse."""
    from . import receiving_waters
    mappings = refresh["mappings"].get("runs") or {}
    candidates, rows = [], []
    blocked = False
    for original in analysis["runs"]:
        target = mappings.get(original["id"])
        relevant = bool(original["bindings"] or original["captured_by_refresh"])
        if target is None and relevant:
            blocked = True
            rows.append({"original_id": original["id"], "successor_id": None,
                         "state": "unmapped", "message": "No retained successor mapping for this source-dependent original run"})
            continue
        target = target or original["id"]
        try:
            native = workspace.inspect_run(identifier(target))
            if native.get("state") != "complete":
                raise ValueError("The current retained run is " + str(native.get("state")))
            # Native selection identity and completed-model record validation are
            # Workspace authority; retain its exact current selection in output.
            candidates.append(target)
            rows.append({"original_id": original["id"], "successor_id": target,
                         "state": "complete", "reused_original": target == original["id"],
                         "selection": deepcopy(native["selection"])})
        except (OSError, ValueError, KeyError, TypeError) as error:
            blocked = True
            rows.append({"original_id": original["id"], "successor_id": target,
                         "state": "unavailable", "message": str(error)})
    result = {"runs": rows, "compatible": False,
              "scope": "Current retained completion and original Receiving grid/profile/land-cover cohort checks; physical artifacts and masks remain analysis-engine authority"}
    if blocked:
        result["message"] = "Resolve the listed incomplete or unmapped original run dependencies"
        return result
    try:
        receiving_waters._validate_runs(workspace, {
            "baseline_run_id": candidates[0], "alternative_run_ids": candidates[1:]})
    except (OSError, ValueError, KeyError, TypeError) as error:
        result["message"] = str(error)
        return result
    result.update(compatible=True, message="Current complete run selections pass the original Receiving cohort checks")
    return result


def _index(workspace, kind):
    if kind not in ("plans", "analyses"):
        raise ValueError("Choose Receiving plans or analyses")
    filename = "plan.json" if kind == "plans" else "analysis.json"
    folder = workspace.root / ("receiving-water-" + kind)
    return sorted(path.parent.name for path in folder.glob("*/" + filename)
                  if path.is_file())


def _compact(row, kind):
    if kind == "plans":
        return {key: deepcopy(row[key]) for key in
                ("id", "title", "state", "created_at", "record_sha256", "receptor_count", "counts")}
    return {"id": row["id"], "title": row["title"], "state": row["state"],
            "created_at": row["created_at"], "record_sha256": row["record_sha256"],
            "plan_id": row["plan_id"], "counts": row["plan"]["counts"],
            "native_source_bindings": sum(len(run["bindings"]) for run in row["runs"]),
            "recorded_successors": sum(bool(run["recorded_successor_id"]) for run in row["runs"]),
            "run_count": len(row["runs"])}


def catalog(workspace, *, offset=0, limit=25):
    offset, limit = _number(offset, 0, 10**9), _number(limit, 25, _PAGE_LIMIT)
    if not limit:
        raise ValueError("Choose at least one row")
    ids = sorted(path.stem for path in (workspace.root / source_refresh.PLAN_KIND).glob("*.json"))
    rows = []
    for key in ids[offset:offset + limit]:
        try:
            refresh = _refresh(workspace, key)
            rows.append({name: refresh[name] for name in
                         ("id", "title", "engine", "from_collection_id", "to_collection_id", "state", "updated_at")})
        except (OSError, ValueError, KeyError, TypeError) as error:
            rows.append({"id": key, "title": key, "state": "unavailable", "error": str(error)})
    end = min(offset + limit, len(ids))
    return {"schema": SCHEMA, "project_id": workspace.project["id"], "refresh_plans": rows,
            "offset": offset, "next_offset": end if end < len(ids) else None,
            "total_saved": len(ids)}


def page(workspace, refresh_plan_id, *, kind="plans", offset=0, limit=10,
         snapshot=None, index_snapshot=None):
    refresh = _refresh(workspace, refresh_plan_id, snapshot)
    offset, limit = _number(offset, 0, 10**9), _number(limit, 10, _PAGE_LIMIT)
    if not limit:
        raise ValueError("Choose at least one row")
    ids = _index(workspace, kind)
    current_index = digest(ids)
    if index_snapshot and current_index != index_snapshot:
        raise ValueError("The saved study inventory changed; reload this page")
    rows, errors = [], []
    for key in ids[offset:offset + limit]:
        try:
            if kind == "plans":
                row = _plan_impact(_plan(workspace, key), refresh)
                related = bool(row["bindings"])
            else:
                row = _analysis_impact(workspace, _analysis(workspace, key), refresh)
                related = row["related"]
            if related:
                rows.append(_compact(row, kind))
        except (OSError, ValueError, KeyError, TypeError) as error:
            errors.append({"id": key, "error": str(error)})
    end = min(offset + limit, len(ids))
    return {"schema": SCHEMA, "project_id": workspace.project["id"],
            "refresh": {name: deepcopy(refresh[name]) for name in
                        ("id", "title", "engine", "format", "from_collection_id", "to_collection_id",
                         "from_collection", "to_collection", "state", "phase", "updated_at",
                         "snapshot", "problems", "warnings")},
            "kind": kind, "offset": offset, "next_offset": end if end < len(ids) else None,
            "scanned": len(ids[offset:offset + limit]), "total_saved": len(ids),
            "index_snapshot": current_index, "rows": rows, "errors": errors,
            "scope": "This bounded page only; source binding means review relevance, not measured geographic or numerical change"}


def detail(workspace, refresh_plan_id, kind, key, *, snapshot=None):
    refresh = _refresh(workspace, refresh_plan_id, snapshot)
    if kind == "plans":
        record = _plan_impact(_plan(workspace, key), refresh)
    elif kind == "analyses":
        record = _analysis_impact(workspace, _analysis(workspace, key), refresh)
        record["successor_check"] = _check_successors(workspace, record, refresh)
    else:
        raise ValueError("Choose Receiving plans or analyses")
    return {"schema": SCHEMA, "project_id": workspace.project["id"],
            "refresh_plan_id": refresh["id"], "refresh_snapshot": refresh["snapshot"],
            "kind": kind, "record": record,
            "scope": "Exact retained original source and study identities. Source Updates records change reasons; this read does not transfer feature IDs or change a study."}
