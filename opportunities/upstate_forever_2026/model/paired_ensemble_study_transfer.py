"""Original paired-raster analyses and source-complete selected-study transfer.

Consumes the maintained paired-raster records without importing a GIS runtime.
Native bindings, explicit raster bytes, result-only imports, and immutable
scientific report captures keep their original identities and distinct scope.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from .common import digest as native_digest, identifier, read_json
from .paired_ensemble.ensemble_store import digest, fingerprint
from .paired_ensemble import ensemble_report_source as producer

KIND = "ensemble-products"
ROOT_KINDS = (KIND,)
DOCUMENTS = {KIND: "analysis.json"}
LOCKS = {}
LABELS = {KIND: "Paired raster analyses"}
SCHEMA = "upstate.paired-raster-ensemble/v1"
RECEIPT_SCHEMA = "upstate.study-paired-raster-analysis/v1"
NATIVE = "original Workspace native run artifacts"
UNITS = {"nitrogen_export": "kg/pixel/year", "phosphorus_export": "kg/pixel/year",
         "sediment_export": "metric_tonnes/pixel/year"}


def _stamp(value):
    if not isinstance(value, dict):
        raise ValueError("Retain the original paired raster's byte descriptor.")
    identifier(value.get("sha256"))
    if type(value.get("bytes")) is not int or value["bytes"] < 0:
        raise ValueError("Retain the original paired raster's byte length.")
    return {"bytes": value["bytes"], "sha256": value["sha256"]}


def _record(key, value):
    identifier(key)
    selected = value.get("selection")
    if (value.get("schema") != SCHEMA or value.get("id") != key
            or not isinstance(selected, dict) or selected.get("schema") != SCHEMA
            or digest(selected) != key):
        raise ValueError("The paired raster analysis changed its original selection.")
    if value.get("state") not in {"running", "paused", "interrupted", "failed", "complete"}:
        raise ValueError("Retain an original paired-raster execution state.")
    rows = selected.get("members")
    pollutants = selected.get("pollutants")
    if (not isinstance(rows, list) or not rows or
            type(selected.get("selected_member_count")) is not int or
            len(rows) != selected["selected_member_count"] or
            type(selected.get("planned_member_count")) is not int or
            selected["planned_member_count"] < len(rows) or
            not isinstance(pollutants, list) or not pollutants or
            len(set(pollutants)) != len(pollutants) or not set(pollutants) <= set(UNITS)):
        raise ValueError("The paired analysis must retain its exact selected and planned population.")
    if any(not isinstance(row, dict) or not isinstance(row.get("id"), str)
           or not row["id"] for row in rows) or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("The paired analysis repeats or loses an original member.")
    if selected.get("support") not in {"all_pairs", "available_pairs", "all_pairs_all_pollutants"}:
        raise ValueError("Retain the original paired support rule.")
    _stamp(selected["reporting_mask"])
    for row in rows:
        if set(row.get("rasters", {})) != set(pollutants):
            raise ValueError("Every selected member must retain every selected pollutant.")
        for pollutant in pollutants:
            pair = row["rasters"][pollutant]
            if pair.get("units") != UNITS[pollutant]:
                raise ValueError("Retain original per-pixel physical mass units.")
            _stamp(pair["baseline"])
            _stamp(pair["alternative"])
    return selected


def _inputs(selected):
    rows = [{"role": "reporting_mask", **_stamp(selected["reporting_mask"])}]
    for member in selected["members"]:
        for pollutant in selected["pollutants"]:
            for side in ("baseline", "alternative"):
                rows.append({"role": "member_raster", "member_id": member["id"],
                             "pollutant": pollutant, "side": side,
                             **_stamp(member["rasters"][pollutant][side])})
    return rows


def _input_key(row):
    return (row["role"], row.get("member_id"), row.get("pollutant"), row.get("side"))


def _verified(closure, relative, expected):
    path = closure.add_file(relative, expected)
    if fingerprint(path) != _stamp(expected):
        raise ValueError("A retained paired input or output changed: " + relative)
    return path


def _result_import(closure, prefix, key):
    relative = prefix + "ensemble-project.json"
    if not (closure.root / relative).exists():
        return False
    imported = closure.read(relative)
    if (imported.get("schema") != "upstate.ensemble-result-project/v1"
            or imported.get("ensemble_id") != key or not isinstance(imported.get("members"), dict)
            or not {"analysis.json", "reports.json"} <= set(imported["members"])):
        raise ValueError("The received paired result project lost its original manifest.")
    # The original result project remains a received edition even after later
    # native continuation. Its immutable scientific selection must still agree.
    for name, descriptor in imported["members"].items():
        if name in {"analysis.json", "reports.json", "execution-settings.json"}:
            continue
        _verified(closure, prefix + name, descriptor)
    return True


def _native_inputs(closure, selected, *, imported):
    refs = selected.get("source_references")
    if selected.get("input_kind") != NATIVE:
        return [], "explicit_rasters"
    if not isinstance(refs, dict) or not isinstance(refs.get("project_id"), str):
        raise ValueError("Original native paired inputs need their declared Workspace provenance.")
    if refs["project_id"] != closure.workspace.project["id"]:
        return [], "external_native_workspace"
    grid_id = identifier(refs.get("grid_id"))
    before_scenario = refs.get("baseline_scenario", {})
    after_scenario = refs.get("alternative_scenario", {})
    for scenario in (before_scenario, after_scenario):
        key = identifier(scenario.get("id"))
        if native_digest({name: value for name, value in scenario.items() if name != "id"}) != key:
            raise ValueError("The paired analysis changed its original scenario definition.")
    baseline_id, alternative_id = before_scenario["id"], after_scenario["id"]
    run_ids = {identifier(row[field]) for row in selected["members"]
               for field in ("baseline_run_id", "alternative_run_id")}
    missing = [key for key in run_ids if not closure.exists("runs", key)]
    if missing and not imported:
        raise ValueError("The original paired analysis needs its retained native runs: " + ", ".join(sorted(missing)))
    bindings = []
    for member in selected["members"]:
        profile_id = identifier(member["profile_id"])
        if (member.get("scenario_id") != alternative_id or member["id"] != digest({
                "baseline_run_id": member["baseline_run_id"],
                "alternative_run_id": member["alternative_run_id"]})):
            raise ValueError("A native paired member changed its profile or scenario contrast.")
        for side, scenario_id in (("baseline", baseline_id), ("alternative", alternative_id)):
            run_id = member[side + "_run_id"]
            if run_id in missing:
                continue
            run = closure.read("runs/" + run_id + "/run.json")
            selection = run.get("selection", {})
            if (run.get("id") != run_id or native_digest(selection) != run_id
                    or run.get("state") != "complete"
                    or any(selection.get(field) != expected for field, expected in
                           (("profile_id", profile_id), ("grid_id", grid_id),
                            ("scenario_id", scenario_id)))):
                raise ValueError("A paired member differs from its original completed native run.")
            for pollutant in selected["pollutants"]:
                descriptor = run.get("artifacts", {}).get(pollutant)
                original = member["rasters"][pollutant][side]
                if (not isinstance(descriptor, dict) or descriptor.get("units") != UNITS[pollutant]
                        or _stamp(descriptor) != _stamp(original)):
                    raise ValueError("A paired input differs from its original native mass raster.")
                relative = "runs/" + run_id + "/" + descriptor["path"]
                _verified(closure, relative, descriptor)
                bindings.append({"role": "member_raster", "member_id": member["id"],
                                 "pollutant": pollutant, "side": side, **_stamp(original),
                                 "path": relative, "binding": "original_native_run", "run_id": run_id})
            closure.need("runs", run_id, "Original paired raster member")
    if closure.exists("grids", grid_id):
        grid = closure.read("grids/" + grid_id + "/grid.json")
        if (grid.get("id") != grid_id or grid.get("state") != "complete"
                or native_digest({"spec": grid.get("spec"), "grid": grid.get("grid")}) != grid_id
                or grid.get("spec") != refs.get("grid_spec") or grid.get("inputs") != refs.get("grid_sources")):
            raise ValueError("The paired reporting grid differs from its original source edition.")
        mask = grid.get("files", {}).get("reporting_mask")
        if not isinstance(mask, dict) or _stamp(mask) != _stamp(selected["reporting_mask"]):
            raise ValueError("The original paired reporting mask changed.")
        relative = "grids/" + grid_id + "/" + mask["path"]
        _verified(closure, relative, mask)
        closure.need("grids", grid_id, "Original paired reporting mask")
        bindings.append({"role": "reporting_mask", **_stamp(mask), "path": relative,
                         "binding": "original_prepared_grid", "grid_id": grid_id})
    elif not imported:
        raise ValueError("Retain the original paired reporting grid.")
    return bindings, "original_native_inputs" if not missing and any(
        row["role"] == "reporting_mask" for row in bindings) else "received_native_result"


def _cas_inputs(closure, selected, bindings):
    """Recover exact physical inputs from retained source editions by bytes.

    A byte match supplies a physical file and preserves its own source edition.
    It never interprets optional imported member IDs as native record identities.
    """
    resolved = {_input_key(row) for row in bindings}
    wanted = {(row["sha256"], row["bytes"]) for row in _inputs(selected)
              if _input_key(row) not in resolved}
    if not wanted:
        return bindings
    matches = {}
    for path in sorted((closure.root / "sources").glob("*.json")):
        # Inspect metadata first; unrelated collections are not added to closure.
        if path.is_symlink():
            continue
        try:
            record = read_json(path)
        except (OSError, ValueError, TypeError):
            continue
        if not isinstance(record, dict):
            continue
        candidates = []
        for entry in record.get("entries", []):
            for descriptor in [entry.get("body", {}), *entry.get("companions", [])]:
                signature = (descriptor.get("sha256"), descriptor.get("bytes"))
                if signature in wanted:
                    candidates.append((signature, entry, descriptor))
        if not candidates:
            continue
        key = identifier(path.stem)
        if record.get("schema") != "upstate.sources/v1" or native_digest(record) != key:
            raise ValueError("A paired input source collection changed its original identity.")
        for signature, entry, descriptor in candidates:
            if signature in matches:
                continue
            relative = descriptor["object"]
            _verified(closure, relative, descriptor)
            matches[signature] = {"path": relative, "binding": "identical_source_bytes",
                                 "source_collection_id": key, "source_id": entry["id"],
                                 "source_member": descriptor.get("view_path", descriptor.get("filename"))}
            closure.need("sources", key, "Original source bytes for a paired raster input")
    for row in _inputs(selected):
        if _input_key(row) in resolved:
            continue
        match = matches.get((row["sha256"], row["bytes"]))
        if match:
            bindings.append({**row, **match})
    return bindings


def _tile_outputs(closure, prefix, selected):
    outputs = []
    grid = selected["grid"]
    for path in sorted((closure.root / prefix / "tiles").glob("*.json")):
        relative = path.relative_to(closure.root).as_posix()
        row = closure.read(relative)
        window = row.get("window")
        if (not isinstance(window, list) or len(window) != 4
                or any(type(value) is not int for value in window)
                or min(window[:2]) < 0 or min(window[2:]) <= 0
                or window[0] + window[2] > grid["width"]
                or window[1] + window[3] > grid["height"]
                or path.stem != str(window[1]) + "-" + str(window[0])
                or row.get("path") != "tiles/" + path.stem + ".tif"):
            raise ValueError("A retained paired tile lost its original grid window.")
        _verified(closure, prefix + row["path"], row)
        outputs.append({"path": prefix + row["path"], **_stamp(row)})
        outputs.append({"path": relative, "bytes": closure.files[relative]["bytes"],
                        "sha256": closure.files[relative]["sha256"]})
    return outputs


def include(closure, key, value):
    selected = _record(key, value)
    prefix = KIND + "/" + key + "/"
    imported = _result_import(closure, prefix, key)
    bindings, mode = _native_inputs(closure, selected, imported=imported)
    bindings = _cas_inputs(closure, selected, bindings)
    resolved = {_input_key(row) for row in bindings}
    missing = [row for row in _inputs(selected) if _input_key(row) not in resolved]
    outputs = _tile_outputs(closure, prefix, selected)
    for descriptor in value.get("artifacts", {}).values():
        _verified(closure, prefix + descriptor["path"], descriptor)
        outputs.append({"path": prefix + descriptor["path"], **_stamp(descriptor)})
    report_path = closure.root / prefix / "reports.json"
    if report_path.exists():
        reports = closure.read(prefix + "reports.json")
        if reports.get("ensemble_id") != key:
            raise ValueError("A paired raster report belongs to another analysis.")
        for descriptor in reports.get("files", []):
            _verified(closure, prefix + descriptor["path"], descriptor)
            outputs.append({"path": prefix + descriptor["path"], **_stamp(descriptor)})
        if value["state"] == "complete" and reports.get("files"):
            producer._completed(closure.root / prefix)
    execution = closure.root / prefix / "execution.json"
    if execution.exists():
        row = closure.read(prefix + "execution.json")
        if (type(row.get("tile_edge")) is not int or row["tile_edge"] < 1
                or row.get("member_count") != len(selected["members"])):
            raise ValueError("The paired execution grid differs from its selected cohort.")
        outputs.append({"path": prefix + "execution.json",
                        "bytes": closure.files[prefix + "execution.json"]["bytes"],
                        "sha256": closure.files[prefix + "execution.json"]["sha256"]})
    closure.tree(prefix.rstrip("/"))
    # Controls are owned by the original invocation selection rather than the
    # analysis ID. Follow only records whose retained progress names this ID.
    for control in sorted((closure.root / KIND / "controls").glob("*.json")):
        if control.name.endswith(".cancel.json"):
            continue
        row = read_json(control)
        if row.get("id") != key:
            continue
        identifier(control.stem)
        closure.read(control.relative_to(closure.root).as_posix())
        cancellation = control.with_suffix(".cancel.json")
        if cancellation.exists():
            closure.read(cancellation.relative_to(closure.root).as_posix())
    metadata = {
        "schema": RECEIPT_SCHEMA, "id": key, "selection_sha256": digest(selected),
        "input_kind": selected.get("input_kind"), "input_mode": mode,
        "declared_source_project_id": (selected.get("source_references") or {}).get("project_id")
            if isinstance(selected.get("source_references"), dict) else None,
        "state": value["state"], "selected_member_count": len(selected["members"]),
        "planned_member_count": selected["planned_member_count"],
        "input_bindings": sorted(bindings, key=lambda row: repr(_input_key(row))),
        "unresolved_input_fingerprints": missing,
        "physical_inputs_available": not missing,
        "outputs": sorted({row["path"]: row for row in outputs}.values(), key=lambda row: row["path"]),
    }
    previous = closure.paired_ensemble_records.get(key)
    if previous is not None and previous != metadata:
        raise ValueError("The paired analysis changed while resolving its selected study.")
    closure.paired_ensemble_records[key] = metadata
    closure.nodes[(KIND, key)].update(
        input_kind=metadata["input_kind"], input_mode=mode,
        selected_member_count=len(selected["members"]),
        planned_member_count=selected["planned_member_count"],
        physical_inputs_available=not missing, unresolved_inputs=len(missing))


def visit(closure, kind, key, value):
    if kind != KIND:
        return False
    include(closure, key, value)
    return True


def _capture(closure, key, *, source_choice=None):
    identifier(key)
    prefix = KIND + "/report-sources/" + key + "/"
    record = closure.read(prefix + "report-source-record.json")
    if (record.get("schema") != producer.SCHEMA or record.get("id") != key
            or record.get("state") != "complete"
            or digest(record.get("identity")) != key
            or digest({name: value for name, value in record.items()
                       if name != "record_sha256"}) != record.get("record_sha256")):
        raise ValueError("The original paired report capture changed.")
    identity = record["identity"]
    analysis_id = identifier(record["ensemble_id"])
    if identity.get("ensemble_id") != analysis_id:
        raise ValueError("The paired report capture names a different original analysis.")
    for row in record["files"]:
        _verified(closure, prefix + row["path"], row)
    producer.inspect(closure.root / prefix)
    original = closure.read(prefix + "original/analysis.json")
    _record(analysis_id, original)
    inventory = closure.read(prefix + "original-inventory.json")
    if inventory != {"ensemble_id": analysis_id, "members": identity.get("original_members")}:
        raise ValueError("The paired report lost its exact original member inventory.")
    for name, expected in identity["original_members"].items():
        _verified(closure, prefix + "original/" + name, expected)
    if identity.get("workspace_id") == closure.workspace.project["id"]:
        closure.need(KIND, analysis_id, "Original paired analysis behind its scientific report")
        current = closure.read(KIND + "/" + analysis_id + "/analysis.json")
        if current.get("selection") != original.get("selection"):
            raise ValueError("The paired report and original analysis have different scientific selections.")
    closure.tree(prefix.rstrip("/"))
    import_path = closure.root / prefix / "import.json"
    if import_path.exists():
        imported = closure.read(prefix + "import.json")
        choice = imported.get("source_choice")
        if (imported.get("schema") != producer.SCHEMA or imported.get("state") != "complete"
                or imported.get("report_source_id") != key or imported.get("ensemble_id") != analysis_id
                or imported.get("project_id") != identity.get("workspace_id")
                or not isinstance(choice, dict) or choice.get("source_id") != producer.SOURCE_ID):
            raise ValueError("The paired report's original source-import receipt changed.")
        closure.need("sources", choice["source_collection_id"], "Original paired report source collection")
    captures = getattr(closure, "paired_ensemble_captures", None)
    if captures is None:
        captures = closure.paired_ensemble_captures = {}
    row = {"report_source_id": key, "ensemble_id": analysis_id,
           "original_project_id": identity.get("workspace_id"),
           "record_sha256": record["record_sha256"],
           "original_members": deepcopy(identity["original_members"])}
    previous = captures.get(key)
    if previous is not None and previous != row:
        raise ValueError("The original paired report capture changed during selection.")
    captures[key] = row
    return record


def include_source(closure, collection_id, entry):
    if not getattr(closure, "paired_lineage_enabled", True):
        return False
    metadata = entry.get("metadata") or {}
    if metadata.get("report_context_kind") != "paired-raster-ensemble":
        return False
    if (entry.get("id") != producer.SOURCE_ID or entry.get("kind") != "document"
            or entry.get("role") != "paired-ensemble-report-source"
            or metadata.get("report_schema") != producer.REPORT_SCHEMA):
        raise ValueError("Retain the exact original paired scientific report source.")
    key = identifier(metadata.get("report_source_id"))
    analysis_id = identifier(metadata.get("ensemble_id"))
    if entry.get("uri") != "urn:upstate:paired-ensemble-report:" + key:
        raise ValueError("The paired scientific report changed its source URI.")
    closure.add_file(entry["body"]["object"], entry["body"])
    recipe = closure.read(entry["body"]["object"])
    if (recipe.get("schema") != producer.REPORT_SCHEMA or recipe.get("edition") != producer.EDITION
            or recipe.get("report_context_kind") != "paired-raster-ensemble"
            or recipe.get("project_id") != metadata.get("project_id")
            or recipe.get("ensemble_id") != analysis_id):
        raise ValueError("The paired scientific report changed its original recipe binding.")
    companions = {row.get("view_path", row["filename"]): row for row in entry.get("companions", [])}
    if len(companions) != len(entry.get("companions", [])):
        raise ValueError("The paired report repeats an original companion path.")
    for row in recipe.get("inputs", []):
        original = companions.get(row["path"])
        if original is None or _stamp(original) != _stamp(row):
            raise ValueError("The paired report lost an original companion.")
        _verified(closure, original["object"], original)
    binding = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "report_context_kind": "paired-raster-ensemble", "report_source_id": key,
        "ensemble_id": analysis_id, "source_project_id": metadata.get("project_id"),
        "relationship": "same_project" if metadata.get("project_id") == closure.workspace.project["id"]
            else "external_project",
        "required_records": [{"kind": KIND, "id": analysis_id}]
            if metadata.get("project_id") == closure.workspace.project["id"] else [],
    }
    binding_key = (collection_id, entry["id"])
    previous = closure.report_source_records.get(binding_key)
    if previous is not None and previous != binding:
        raise ValueError("A paired report changed its retained source lineage.")
    if metadata.get("project_id") != closure.workspace.project["id"]:
        closure.report_source_records[binding_key] = binding
        return True
    capture = _capture(closure, key, source_choice={
        "source_collection_id": collection_id, "source_id": entry["id"]})
    prefix = KIND + "/report-sources/" + key + "/"
    original_recipe = closure.read(prefix + "report-source.json")
    if recipe != original_recipe or _stamp(entry["body"]) != fingerprint(closure.root / prefix / "report-source.json"):
        raise ValueError("The registered paired report differs from its original capture.")
    expected_companions = read_json(closure.root / prefix / "sources.json")["entries"][0]["companions"]
    if {row["path"]: _stamp(row) for row in expected_companions} != {
            name: _stamp(row) for name, row in companions.items()}:
        raise ValueError("The paired report's complete source companions changed.")
    if (capture["identity"].get("workspace_id") != metadata["project_id"]
            or capture["ensemble_id"] != analysis_id):
        raise ValueError("The paired report source changed its Workspace identity.")
    closure.report_source_records[binding_key] = binding
    return True


def related(closure):
    selected = {key for kind, key in closure.nodes if kind == KIND}
    if not selected:
        return
    root = closure.root / KIND / "report-sources"
    for path in sorted(root.glob("*/report-source-record.json")):
        try:
            value = read_json(path)
            if (value.get("ensemble_id") in selected
                    and value.get("identity", {}).get("workspace_id") == closure.workspace.project["id"]):
                _capture(closure, path.parent.name)
        except (OSError, ValueError, KeyError, TypeError) as error:
            closure.related_issues.append({"path": path.relative_to(closure.root).as_posix(),
                                           "message": str(error)})


def lock_paths(closure):
    paths = []
    for kind, key in sorted(closure.nodes):
        if kind == KIND:
            paths.extend((KIND + "/" + key + "/.analysis.lock",
                          KIND + "/" + key + "/.report.lock"))
    if getattr(closure, "paired_ensemble_captures", {}):
        paths.append(KIND + "/report-sources/.paired-report-source.lock")
    return sorted(set(paths))


def receipt(closure):
    captures = getattr(closure, "paired_ensemble_captures", {})
    return [{**deepcopy(row), "report_captures": [
        deepcopy(value) for unused, value in sorted(captures.items())
        if value["ensemble_id"] == key
    ]} for key, row in sorted(closure.paired_ensemble_records.items())]


def verify_receipt(closure, captured):
    current = {row["id"]: row for row in receipt(closure)}
    for old in captured:
        row = current.get(old["id"])
        if row is None or any(row.get(field) != old.get(field) for field in
                              ("schema", "selection_sha256", "input_kind",
                               "declared_source_project_id", "selected_member_count", "planned_member_count")):
            raise ValueError("The received study changed an original paired raster selection.")
        if old.get("state") == "complete" and row.get("state") != "complete":
            raise ValueError("The received paired result lost its completed calculation.")
        captures = {item["report_source_id"]: item for item in row.get("report_captures", [])}
        if any(captures.get(item["report_source_id"]) != item for item in old.get("report_captures", [])):
            raise ValueError("The received paired analysis lost an immutable report capture.")
        outputs = {item["path"]: item for item in row["outputs"]}
        for item in old.get("outputs", []):
            if outputs.get(item["path"]) != item:
                raise ValueError("The received paired analysis lost an original quantitative output.")
        # Continued analysis may add outputs, finish pending tiles, or recover
        # original inputs. Preserve every physical source captured earlier.
        for item in old.get("input_bindings", []):
            _verified(closure, item["path"], item)
        if old.get("physical_inputs_available") and not row.get("physical_inputs_available"):
            raise ValueError("The received paired analysis lost its original raster inputs.")


def catalogue(workspace, kind=KIND):
    if kind != KIND:
        return []
    rows = []
    root = Path(workspace.root)
    for path in sorted((root / KIND).glob("*/analysis.json")):
        key = path.parent.name
        try:
            value = read_json(path)
            selected = _record(key, value)
            row = {"kind": KIND, "id": key, "title": selected["title"],
                   "state": value["state"], "updated_at": value.get("completed_at", value.get("updated_at", "")),
                   "selection": deepcopy(selected), "counts": {
                       "selected_members": selected["selected_member_count"],
                       "planned_members": selected["planned_member_count"]}}
        except (OSError, ValueError, KeyError, TypeError) as error:
            row = {"kind": KIND, "id": key, "title": key[:12], "state": "unreadable",
                   "updated_at": "", "error": {"type": type(error).__name__, "message": str(error)}}
        rows.append(row)
    return rows
