"""Retain an original receiving-water plan or completed analysis as a report source.

TokenJunkieLabs. Saved geography, source designations and original scientific
quantities remain authoritative. This producer never prepares or analyzes a study.
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
from pathlib import Path, PurePosixPath

from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, now, read_json, relative_file, verify_file)

SCHEMA = "upstate.receiving-water-report-source/v1"
EDITION = "receiving-water-report-source/1"
FOLDER = "receiving-water-report-sources"
SOURCE_ID = "receiving-water-scientific-report"
LOCK = ".receiving-water-report-source.lock"


def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Choose a saved receiving-water plan or completed analysis")
    value = copy.deepcopy(value)
    if set(value) - {"title", "plan_id", "analysis_id", "delivery_id"}:
        raise ValueError("Unknown receiving-water report selection")
    if bool(value.get("plan_id")) == bool(value.get("analysis_id")):
        raise ValueError("Choose exactly one plan_id or analysis_id")
    for key in ("plan_id", "analysis_id", "delivery_id"):
        if value.get(key) is not None:
            value[key] = identifier(value[key])
        else:
            value.pop(key, None)
    if "title" in value:
        if not isinstance(value["title"], str) or not value["title"].strip():
            raise ValueError("Report title must be nonempty text")
        value["title"] = value["title"].strip()
    return value


def _member(name):
    if not isinstance(name, str) or "\\" in name or "\0" in name:
        raise ValueError("Report members need canonical relative paths")
    path = PurePosixPath(name)
    if (not path.parts or path.is_absolute() or ".." in path.parts
            or path.as_posix() != name):
        raise ValueError("Report members must stay inside their retained source")
    return path


def _record_hash(record):
    return digest({key: value for key, value in record.items() if key != "record_sha256"})


def _copy_file(source, destination):
    """Publish an immutable full file without loading a source raster into memory."""
    source, destination = Path(source), Path(destination)
    size, checksum = source.stat().st_size, file_digest(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if destination.stat().st_size != size or file_digest(destination) != checksum:
            raise ValueError("Retained report member differs: " + str(destination))
        return
    pending = None
    try:
        with source.open("rb") as src, tempfile.NamedTemporaryFile(
                dir=destination.parent, prefix=".report-", delete=False) as out:
            pending = Path(out.name)
            shutil.copyfileobj(src, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        if pending.stat().st_size != size or file_digest(pending) != checksum:
            raise ValueError("Source changed during receiving-water report capture")
        try:
            os.link(pending, destination)
        except FileExistsError:
            if destination.stat().st_size != size or file_digest(destination) != checksum:
                raise ValueError("Concurrent report member differs")
        fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _resolve(workspace, selection, *, verify=True):
    from . import receiving_waters
    analysis = None
    if selection.get("analysis_id"):
        analysis = receiving_waters.inspect(workspace, selection["analysis_id"], verify=verify)
        if analysis.get("state") != "complete":
            raise ValueError("Finish the selected receiving-water analysis before reporting")
        plan_id = analysis["plan_id"]
    else:
        plan_id = selection["plan_id"]
    plan = receiving_waters.inspect_plan(workspace, plan_id, verify=verify)
    if plan.get("state") != "complete":
        raise ValueError("Choose a complete saved receiving-water plan")
    if analysis and analysis["identity"]["plan_record_sha256"] != plan["record_sha256"]:
        raise ValueError("Completed analysis identifies another immutable source plan")
    return plan, analysis


def _study_identity(plan, analysis):
    return {"plan_id": plan["id"], "plan_record_sha256": plan["record_sha256"],
            "analysis_id": analysis["id"] if analysis else None,
            "analysis_record_sha256": analysis["record_sha256"] if analysis else None}


def _implementation(analysis):
    from . import receiving_waters
    modules = {"producer": Path(__file__), "plan_reader": Path(receiving_waters.__file__)}
    if analysis is not None:
        from . import receiving_water_delivery, scientific_report
        modules.update(exporter=Path(receiving_water_delivery.__file__),
                       scientific_formatter=Path(scientific_report.__file__))
    return modules


def _retain_study(workspace, directory, plan, analysis):
    """Atomically seed original members before invoking the unchanged exporter."""
    native = directory / "native"
    pairs = [("plan", "receiving-water-plans", plan)]
    if analysis is not None:
        pairs.append(("analysis", "receiving-water-analyses", analysis))
    for name, folder, record in pairs:
        source_root = workspace.root / folder / record["id"]
        for item in record["files"].values():
            target = native / name / _member(item["path"])
            _copy_file(verify_file(source_root, item), target)
            verify_file(native / name, item)
        source = source_root / (name + ".json")
        if read_json(source) != record:
            raise ValueError("Original receiving-water record changed before capture")
        _copy_file(source, native / name / source.name)
    if analysis is None:
        return None
    from .receiving_water_delivery import export
    inventory = export(workspace, analysis["id"], native)
    expected = {key: value for key, value in _study_identity(plan, analysis).items()
                if value is not None}
    if inventory["identity"] != expected:
        raise ValueError("Original receiving-water export identifies another study")
    # The exporter retains its own unchanged record and full descriptor paths.
    for item in inventory["files"].values():
        verify_file(native, item)
    return inventory


def _source_views(workspace, plan):
    """Resolve all original views before capture; cold restores may materialize CAS links."""
    selected = {}
    for identity in plan["identity"]["source_identities"]:
        choice = {"source_collection_id": identity["source_collection_id"],
                  "source_id": identity["source_id"]}
        key = digest(choice)
        if key not in selected:
            path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
            collection = workspace._get("sources", choice["source_collection_id"])
            selected[key] = {"choice": choice, "path": Path(path), "entry": entry,
                             "collection": collection, "identities": []}
        value = selected[key]
        entry = value["entry"]
        if (entry["body"]["sha256"] != identity["body_sha256"]
                or entry["body"]["bytes"] != identity["body_bytes"]):
            raise ValueError("Saved receiving-water plan source body changed")
        for field in ("uri", "vintage", "title", "role", "metadata"):
            if field in identity and entry.get(field, {} if field == "metadata" else None) != identity[field]:
                raise ValueError("Saved receiving-water source metadata changed: " + field)
        companions = [{"sha256": item["sha256"], "bytes": item["bytes"],
                       "filename": item.get("filename"), "source_path": item.get("source_path")}
                      for item in entry.get("companions", [])]
        if companions != identity.get("companions", []):
            raise ValueError("Saved receiving-water source companions changed")
        value["identities"].append(identity)
    return selected


def _retain_sources(workspace, directory, views):
    result = []
    for key, value in sorted(views.items()):
        entry, collection = value["entry"], value["collection"]
        body_name = _member(entry["body"].get("view_path", entry["body"]["filename"]))
        view_root = value["path"]
        for unused in body_name.parts:
            view_root = view_root.parent
        root = directory / "original-sources" / key
        names = set()
        members = []
        for item in [entry["body"]] + entry.get("companions", []):
            name = _member(item.get("view_path", item["filename"])).as_posix()
            if name in names:
                raise ValueError("Original receiving-water source repeats a member path")
            names.add(name)
            source = view_root / name
            if (not source.is_file() or source.stat().st_size != item["bytes"]
                    or file_digest(source) != item["sha256"]):
                raise ValueError("Original receiving-water source member changed: " + name)
            target = root / "members" / name
            _copy_file(source, target)
            if target.stat().st_size != item["bytes"] or file_digest(target) != item["sha256"]:
                raise ValueError("Retained original receiving-water member differs")
            members.append(describe_file(directory, target))
        original = collection["original_manifest"]
        manifest = relative_file(workspace.root, original["object"])
        if manifest.stat().st_size != original["bytes"] or file_digest(manifest) != original["sha256"]:
            raise ValueError("Original source collection manifest changed")
        _copy_file(manifest, root / "original-manifest.json")
        atomic_json(root / "collection.json", collection, immutable=True)
        atomic_json(root / "entry.json", entry, immutable=True)
        atomic_json(root / "plan-source-identities.json", value["identities"], immutable=True)
        result.append({**value["choice"], "body_sha256": entry["body"]["sha256"],
                       "entry_path": (root / "entry.json").relative_to(directory).as_posix(),
                       "collection_path": (root / "collection.json").relative_to(directory).as_posix(),
                       "original_manifest_path": (root / "original-manifest.json").relative_to(directory).as_posix(),
                       "identities_path": (root / "plan-source-identities.json").relative_to(directory).as_posix(),
                       "members": members})
    atomic_json(directory / "original-source-index.json", result, immutable=True)
    return result


def _text(value):
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def _rows(value, prefix=""):
    """Preserve every original field, array index and numeric value without rounding."""
    if isinstance(value, dict):
        for key, item in value.items():
            yield from _rows(item, (prefix + " / " if prefix else "") + str(key))
        if not value:
            yield [prefix, "{}"]
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _rows(item, prefix + " [" + str(index) + "]")
        if not value:
            yield [prefix, "[]"]
    else:
        yield [prefix, _text(value)]


def _table(columns, rows, caption=None):
    return {"kind": "table", "columns": columns,
            "rows": [[_text(value) for value in row] for row in rows],
            "widths": None, "caption": caption}


def _plan_sections(plan, analysis):
    blocks = [
        ("This source reports a saved receiving-water plan and its completed original analysis."
         if analysis else
         "This source reports a saved geography and designation plan. It contains no calculated "
         "pollutant export, flow-path delivery, exposure, intake load or water-quality concentration."),
        "Relationships retain the original plan method and rationale. A published source polygon, "
        "an explicit geometric context and a retained HUC12 upstream association have different meanings.",
        "Contributing areas below are the original projected geometry areas in hectares. They are "
        "not measured loads, raster support areas or additional flow-path evidence. Individual "
        "receiving areas can overlap; do not add their areas as an unduplicated total.",
        _table(["Saved plan property", "Original value"], [
            ["Plan", plan["id"]], ["Title", plan["title"]],
            ["State", plan["state"]], ["Created", plan["created_at"]],
            ["Record SHA256", plan["record_sha256"]],
            ["Geometry CRS", plan["analysis_crs_name"]],
            ["Geometry CRS WKT", plan["analysis_crs"]],
            ["Original geometry method", plan["identity"]["method_version"]],
            ["Original geometry implementation SHA256", plan["identity"]["implementation_sha256"]],
        ]),
        _table(["Receiving area", "Family", "Relationship precision", "Contribution area (ha)"],
               [[row["title"], row["family"], row["relationship_precision"],
                 row["contribution_area_ha"]] for row in plan["receptors"]],
               "Exact retained source-plan values. This table does not deduplicate overlapping areas."),
    ]
    sections = [["Receiving-water source plan", blocks]]
    for receptor in plan["receptors"]:
        # Preserve complete new provenance fields as well as the original schema:
        # native attributes, geometry-reader operations and source-feature identities.
        context = {key: value for key, value in receptor.items()
                   if key not in {"original_features", "source"}}
        sections.append(["Receiving area: " + receptor["title"], [
            receptor["interpretation"],
            _table(["Original relationship and designation", "Retained value"], list(_rows(context))),
            _table(["Original source selection and provenance", "Retained value"],
                   list(_rows(receptor["source"]))),
            _table(["Original feature and native field", "Retained value"],
                   list(_rows(receptor.get("original_features", []))),
                   "Original feature identifiers, attributes and any explicitly recorded geometry "
                   "interpretation remain attached to this exact saved plan."),
        ]])
    sections.append(["Source-plan selection and original network", [
        _table(["Original selection", "Retained value"], list(_rows(plan["identity"]["selection"]))),
        "The complete original network, when selected, remains in native/plan/plan.json. "
        "No network route or geometry is inferred by this report producer.",
    ]])
    return sections


def _summary(plan, analysis, sources):
    return {"mode": "completed_analysis" if analysis else "source_plan",
            "plan_id": plan["id"], "analysis_id": analysis["id"] if analysis else None,
            "receptors": len(plan["receptors"]),
            "families": sorted({row["family"] for row in plan["receptors"]}),
            "source_entries": len(sources),
            "quantity_scope": analysis["quantity_scope"] if analysis else None,
            "pollutants": list(analysis.get("pollutants", [])) if analysis else [],
            "baseline_run_id": analysis["baseline_run_id"] if analysis else None,
            "alternative_run_ids": list(analysis["alternative_run_ids"]) if analysis else []}


def delivery_selection(workspace, source, delivery_id=None):
    """Append once while preserving the existing delivery's other source choices."""
    from . import observed_context
    if delivery_id:
        original = workspace.retained_item("deliveries", identifier(delivery_id))
        selection = copy.deepcopy(original.get("selection"))
        if not isinstance(selection, dict):
            raise ValueError("Selected delivery has no original saved selection")
    else:
        selection = {}
    choices = observed_context.source_choices(selection)
    if source not in choices:
        choices.append(dict(source))
    selection["observed_context_sources"] = choices
    selection.setdefault("source_roles", {})[observed_context.ROLE] = dict(choices[0])
    selection.pop("observed_context_binding", None)
    return selection


def _result(workspace, record, delivery_id=None):
    return {**record, "delivery_selection": delivery_selection(workspace, record["source"], delivery_id)}


def _verify_import(workspace, directory, source):
    from . import observed_context
    binding = observed_context.bind(workspace, {"observed_context_sources": [source]})
    recipe_path = directory / "report-source.json"
    recipe = read_json(recipe_path)
    expected = {item["path"]: item["sha256"] for item in recipe["inputs"]}
    expected["report-source.json"] = file_digest(recipe_path)
    if (binding["body_sha256"] != expected["report-source.json"]
            or binding["member_sha256"] != expected):
        raise ValueError("Imported receiving-water report differs from its retained complete recipe")


def _verify_originals(workspace, directory, plan, analysis, identity):
    if _study_identity(plan, analysis) != identity["study"]:
        raise ValueError("Retained receiving-water report identifies another immutable study")
    if read_json(directory / "native" / "plan" / "plan.json") != plan:
        raise ValueError("Retained source plan differs from the original Workspace")
    if analysis is not None and read_json(directory / "native" / "analysis" / "analysis.json") != analysis:
        raise ValueError("Retained completed analysis differs from the original Workspace")
    views = _source_views(workspace, plan)
    index = read_json(directory / "original-source-index.json")
    if {digest({"source_collection_id": row["source_collection_id"], "source_id": row["source_id"]})
            for row in index} != set(views) or len(index) != len(views):
        raise ValueError("Retained source inventory differs from the exact plan selection")
    for row in index:
        key = digest({"source_collection_id": row["source_collection_id"], "source_id": row["source_id"]})
        value = views[key]
        if (read_json(directory / _member(row["entry_path"])) != value["entry"]
                or read_json(directory / _member(row["collection_path"])) != value["collection"]
                or read_json(directory / _member(row["identities_path"])) != value["identities"]):
            raise ValueError("Original receiving-water source metadata differs from its capture")
        original = value["collection"]["original_manifest"]
        source = relative_file(workspace.root, original["object"])
        if (source.stat().st_size != original["bytes"] or file_digest(source) != original["sha256"]
                or file_digest(directory / _member(row["original_manifest_path"])) != original["sha256"]):
            raise ValueError("Original receiving-water source manifest differs from its capture")


def _files(directory, *, exclude=()):
    return [describe_file(directory, path) for path in sorted(directory.rglob("*"))
            if path.is_file() and not any(part.startswith(".") for part in path.relative_to(directory).parts)
            and path.relative_to(directory).as_posix() not in exclude]


def prepare(workspace, selection, *, progress=None):
    """Retain a saved plan or exact completed analysis; no preparation or calculation."""
    selected = _selection(selection)
    delivery_id = selected.pop("delivery_id", None)
    if delivery_id:
        original = workspace.retained_item("deliveries", delivery_id)
        if not isinstance(original.get("selection"), dict):
            raise ValueError("Selected delivery has no original saved selection")
    # Portable capture holds .workspace.lock before this root lock. This producer
    # never acquires .workspace.lock, nor a model execution/analysis lock.
    with held(workspace.root / LOCK, blocking=False):
        plan, analysis = _resolve(workspace, selected, verify=True)
        modules = _implementation(analysis)
        identity = {"edition": EDITION, "workspace_id": workspace.project["id"],
                    "selection": selected, "study": _study_identity(plan, analysis),
                    "capture_implementation": {name: file_digest(path) for name, path in modules.items()}}
        key = digest(identity)
        directory = workspace.root / FOLDER / key
        def report(stage):
            if progress:
                progress({"stage": stage, "report_source_id": key})
        if (directory / "report.json").exists():
            return _result(workspace, inspect(workspace, key, verify=True), delivery_id)
        # Resolve potentially cold source views before retaining original metadata.
        report("verify-original-source-plan")
        views = _source_views(workspace, plan)
        directory.mkdir(parents=True, exist_ok=True)
        intent_path = directory / "intent.json"
        if intent_path.exists():
            intent = read_json(intent_path)
            if intent.get("identity") != identity or intent.get("id") != key:
                raise ValueError("Receiving-water report intent differs")
        else:
            intent = {"schema": SCHEMA, "id": key, "identity": identity, "created_at": now()}
            atomic_json(intent_path, intent, immutable=True)
        prepared = directory / "prepared.json"
        if not prepared.exists():
            report("retain-original-study")
            inventory = _retain_study(workspace, directory, plan, analysis)
            sources = _retain_sources(workspace, directory, views)
            for name, source in modules.items():
                target = directory / "implementation" / (name + ".py")
                _copy_file(source, target)
                if file_digest(target) != identity["capture_implementation"][name]:
                    raise ValueError("Report implementation changed during capture")
            sections = _plan_sections(plan, analysis)
            if inventory is not None:
                from .scientific_report import receiving_sections
                # Keep the maintained formatter's units, signed changes, fixed
                # normalization, family deduplication and valid-support tables.
                sections.extend(receiving_sections({"inventory": inventory}))
            sections.append(["Retained source and scientific scope", [
                "This report packages the selected immutable receiving-water records. It does not "
                "execute a native model, recompute priorities, infer water quality or change the "
                "original geographic relationship. Original records and all exported members "
                "remain available alongside the report.",
                _table(["Capture property", "Retained value"], list(_rows(identity))),
            ]])
            title = selected.get("title") or (analysis["title"] if analysis else plan["title"])
            companions = _files(directory, exclude=("intent.json", "prepared.json", "report.json",
                                                    "sources.json", "report-source.json"))
            source_links = ["native/plan/plan.json", "original-source-index.json"]
            if analysis is not None:
                source_links += ["native/analysis/analysis.json", "native/receiving-water-delivery.json"]
            source_links += [row["original_manifest_path"] for row in sources]
            # The complete native geometry, rasters, source files and capture code
            # are companions; links expose every member, retaining meaningful paths.
            source_links += [item["path"] for item in companions if item["path"] not in source_links]
            from . import observed_context
            recipe = {"schema": observed_context.SCHEMA, "title": title, "edition": EDITION,
                      "report_context_kind": "receiving-water-scientific-study",
                      "project_id": workspace.project["id"], "inputs": companions,
                      "sections": sections, "figures": [], "source_links": source_links}
            atomic_json(directory / "report-source.json", recipe, immutable=True)
            entry = {"id": SOURCE_ID, "kind": "document", "title": title,
                     "uri": "urn:upstate:receiving-water-report:" + workspace.project["id"] + ":" + key,
                     "vintage": intent["created_at"], "path": "report-source.json",
                     "sha256": file_digest(directory / "report-source.json"),
                     "companions": companions, "role": "receiving-water-report-source",
                     "metadata": {"report_schema": observed_context.SCHEMA,
                                  "mode": "completed_analysis" if analysis else "source_plan",
                                  "plan_id": plan["id"], "analysis_id": analysis["id"] if analysis else None,
                                  "new_native_calculation": False}}
            atomic_json(directory / "sources.json", {"schema": "upstate.sources/v1", "title": title,
                        "captured_at": intent["created_at"], "entries": [entry]}, immutable=True)
            atomic_json(prepared, {"title": title, "summary": _summary(plan, analysis, sources),
                                  "files": _files(directory, exclude=("prepared.json", "report.json"))},
                        immutable=True)
        ready = read_json(prepared)
        # Every interruption resumes from exactly the retained prepared source;
        # never silently replace its recipe, source companions or native export.
        for item in ready["files"]:
            verify_file(directory, item)
        _verify_originals(workspace, directory, plan, analysis, identity)
        report("import-original-report-source")
        collection = workspace.import_sources(directory / "sources.json")
        source = {"source_collection_id": collection["id"], "source_id": SOURCE_ID}
        _verify_import(workspace, directory, source)
        files = [describe_file(workspace.root, directory / item["path"])
                 for item in _files(directory, exclude=("report.json",))]
        record = {"schema": SCHEMA, "id": key, "state": "complete", "identity": identity,
                  "title": ready["title"], "created_at": intent["created_at"], "selection": selected,
                  "source": source, "summary": ready["summary"], "files": files}
        record["record_sha256"] = _record_hash(record)
        atomic_json(directory / "report.json", record, immutable=True)
        report("complete")
        return _result(workspace, record, delivery_id)


def inspect(workspace, key, *, verify=True):
    key = identifier(key)
    directory = workspace.root / FOLDER / key
    record = read_json(directory / "report.json")
    if (record.get("schema") != SCHEMA or record.get("id") != key or record.get("state") != "complete"
            or digest(record["identity"]) != key or record["identity"]["workspace_id"] != workspace.project["id"]
            or record.get("selection") != record["identity"]["selection"]
            or record.get("record_sha256") != _record_hash(record)):
        raise ValueError("Receiving-water report source identity changed")
    if verify:
        for item in record["files"]:
            verify_file(workspace.root, item)
        plan, analysis = _resolve(workspace, record["selection"], verify=True)
        _verify_originals(workspace, directory, plan, analysis, record["identity"])
        _verify_import(workspace, directory, record["source"])
    return record


def catalog(workspace):
    """Manifest-only source inventory for existing operator and report selectors."""
    return [{key: record.get(key) for key in
             ("id", "state", "title", "created_at", "selection", "source", "summary")}
            for path in sorted((workspace.root / FOLDER).glob("*/report.json"))
            for record in [inspect(workspace, path.parent.name, verify=False)]]
