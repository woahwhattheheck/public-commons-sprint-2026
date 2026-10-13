"""Retain an original receiving-water plan or completed analysis as a report source.

TokenJunkieLabs. Saved geography, source designations and original scientific
quantities remain authoritative. This producer never prepares or analyzes a study.
"""
from __future__ import annotations

import copy
import json
import math
import os
import shutil
import tempfile
from pathlib import Path, PurePosixPath

from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, now, read_json, relative_file, verify_file)

SCHEMA = "upstate.receiving-water-report-source/v1"
EDITION = "receiving-water-report-source/3"
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
    from . import receiving_water_report_maps, scientific_map_figures, scientific_figures
    modules = {"producer": Path(__file__), "plan_reader": Path(receiving_waters.__file__),
               "map_capture": Path(receiving_water_report_maps.__file__),
               "map_renderer": Path(scientific_map_figures.__file__),
               "scientific_figures": Path(scientific_figures.__file__)}
    if analysis is not None:
        from . import receiving_water_delivery, scientific_report, client_receiving_waters
        modules.update(exporter=Path(receiving_water_delivery.__file__),
                       scientific_formatter=Path(scientific_report.__file__),
                       accounting_formatter=Path(client_receiving_waters.__file__))
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


def _source_references(value, location):
    """Find explicit retained selectors, including original intake/provenance references."""
    if isinstance(value, dict):
        if "source_collection_id" in value and "source_id" in value:
            choice = {name: value[name] for name in ("source_collection_id", "source_id")}
            if any(not isinstance(item, str) or not item.strip() for item in choice.values()):
                raise ValueError("Original plan contains an incomplete retained source reference")
            yield choice, {"location": location, "selection": value}
        for key, item in value.items():
            yield from _source_references(item, location + "/" + str(key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _source_references(item, location + "/" + str(index))


def _source_views(workspace, plan):
    """Resolve all original views before capture; cold restores may materialize CAS links."""
    selected = {}
    def resolve(choice):
        key = digest(choice)
        if key not in selected:
            path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
            collection = workspace._get("sources", choice["source_collection_id"])
            selected[key] = {"choice": choice, "path": Path(path), "entry": entry,
                             "collection": collection, "identities": [], "references": []}
        return selected[key]
    for identity in plan["identity"]["source_identities"]:
        choice = {"source_collection_id": identity["source_collection_id"],
                  "source_id": identity["source_id"]}
        value = resolve(choice)
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
    # Context such as metadata.intake_reference can support a saved designation
    # without participating in geometry preparation. Retain those originals too.
    for label, content in (("identity/selection", plan["identity"]["selection"]),
                           ("receptors", plan["receptors"])):
        for choice, reference in _source_references(content, label):
            resolve(choice)["references"].append(reference)
    return selected


def _source_entry_identities(views):
    return [{**value["choice"], "entry_sha256": digest(value["entry"]),
             "original_manifest_sha256": value["collection"]["original_manifest"]["sha256"],
             "original_manifest_bytes": value["collection"]["original_manifest"]["bytes"]}
            for key, value in sorted(views.items())]


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
        atomic_json(root / "plan-source-references.json", value["references"], immutable=True)
        result.append({**value["choice"], "body_sha256": entry["body"]["sha256"],
                       "entry_path": (root / "entry.json").relative_to(directory).as_posix(),
                       "collection_path": (root / "collection.json").relative_to(directory).as_posix(),
                       "original_manifest_path": (root / "original-manifest.json").relative_to(directory).as_posix(),
                       "identities_path": (root / "plan-source-identities.json").relative_to(directory).as_posix(),
                       "references_path": (root / "plan-source-references.json").relative_to(directory).as_posix(),
                       "members": members})
    atomic_json(directory / "original-source-index.json", result, immutable=True)
    return result


def _text(value):
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def _table(columns, rows, caption=None):
    return {"kind": "table", "columns": columns,
            "rows": [[_text(value) for value in row] for row in rows],
            "widths": None, "caption": caption}


def _brief(value, limit=500):
    """Keep the main dossier readable; complete original values stay in linked records."""
    text = _text(value)
    return text if len(text) <= limit else text[:limit].rstrip() + " … (complete value in the saved plan)"


def _feature_ids(receptor):
    values = [str(row["native_feature_id"]) for row in receptor.get("original_features", [])]
    if len(values) <= 12:
        return ", ".join(values)
    return ", ".join(values[:12]) + " …; " + str(len(values)) + " original features (all in the saved plan)"


def _display_number(value, places=3):
    """Round display cells only; complete native records retain original precision."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return _text(value)
    if not math.isfinite(value):
        raise ValueError("Report display quantity must be finite")
    if value == 0:
        return "0"
    if abs(value) < 10 ** (-places):
        return format(value, ".3g")
    return format(value, ",." + str(places) + "f").rstrip("0").rstrip(".")


def _family_label(value):
    labels = {"critical_drinking_water": "Critical drinking water",
              "classified_water": "Classified water",
              "source_water": "Source water",
              "drinking_water": "Drinking water"}
    return labels.get(value, str(value).replace("_", " "))


def _display_value(value):
    if value is None:
        return "Not recorded"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list) and all(isinstance(item, (str, int, float)) for item in value):
        return "; ".join(str(item) for item in value) or "None recorded"
    return _brief(value, 650)


def _classification_rows(value):
    """Show recorded source attributes; retain complete dictionaries in the linked plan."""
    if not isinstance(value, dict):
        return [["Recorded classification", _display_value(value)]]
    if not value:
        return [["Recorded classification", "Not recorded"]]
    labels = {
        "FACILITY": "Facility", "NAME": "Waterbody", "SYSTEM": "Water system ID",
        "INTAKE": "Intake ID", "BUFFER_FT": "Published protection distance (ft)",
        "designation": "Designation", "previous_class": "Previous classification",
        "site_specific": "Site-specific designation",
        "previous_class_site_specific": "Previous site-specific designation",
        "display_code": "Source classification code", "raw": "Original classification value",
        "recognized": "Recognized source classification",
        "native_name": "Original feature name", "description": "Source description",
        "system_id": "Water system ID", "intake_id": "Intake ID",
    }
    rows = []
    classification = value.get("source_classification")
    if isinstance(classification, dict):
        for key in ("display_code", "designation", "previous_class", "site_specific",
                    "previous_class_site_specific", "recognized"):
            if classification.get(key) not in (None, ""):
                rows.append([labels[key], _display_value(classification[key])])
        if not rows and classification.get("raw") is not None:
            rows.append([labels["raw"], _display_value(classification["raw"])])
    for key in ("FACILITY", "NAME", "SYSTEM", "INTAKE", "BUFFER_FT",
                "native_name", "description", "system_id", "intake_id",
                "designation", "previous_class", "site_specific",
                "previous_class_site_specific", "display_code", "raw", "recognized"):
        if key in value and value[key] not in (None, ""):
            rows.append([labels[key], _display_value(value[key])])
    vintage = value.get("vintage")
    if isinstance(vintage, dict):
        for key, label in (("status", "Recorded designation status"),
                           ("selection_status", "Status for selected date"),
                           ("effective_from", "Effective from"), ("effective_to", "Effective through"),
                           ("as_of", "Selected date")):
            if vintage.get(key) not in (None, ""):
                rows.append([label, _display_value(vintage[key])])
    status = value.get("status")
    if isinstance(status, dict):
        recorded = status.get("label")
        if recorded in (None, ""):
            recorded = status.get("raw")
        if recorded is not None:
            rows.append(["Original source status", _display_value(recorded)])
    elif status not in (None, ""):
        rows.append(["Original source status", _display_value(status)])
    handled = set(labels) | {"source_classification", "vintage", "status",
        "OBJECTID", "Shape.STArea()", "Shape.STLength()", "source_layer",
        "profile", "kind", "rule_references", "legal_geometry_scope",
        "hydrologic_support_scope", "source_fields"}
    for key, item in value.items():
        if key not in handled and item not in (None, ""):
            rows.append([str(key).replace("_", " "), _display_value(item)])
    if value.get("rule_references"):
        rows.append(["Rule references", _display_value(value["rule_references"])])
    return rows or [["Recorded classification", _display_value(value)]]


def _geometry_note(receptor, analysis_crs):
    source = receptor["source"]
    reader = source.get("geometry_reader")
    details = []
    if reader:
        adapter = reader.get("adapter") if isinstance(reader, dict) else reader
        if adapter and "OriginalEsriFeatures" in str(adapter):
            adapter = "Original Esri feature collection"
        elif adapter:
            adapter = str(adapter)
        details.append("Geometry interpretation: " + (adapter or "Recorded source reader")
                       + "; analysis coordinates " + analysis_crs + ".")
    features = source.get("selected_features", []) + receptor.get("original_features", [])
    operations = {}
    for feature in features:
        for operation in feature.get("geometry_operations", []):
            if isinstance(operation, str):
                try:
                    parsed = json.loads(operation)
                except (TypeError, ValueError):
                    parsed = operation
            else:
                parsed = operation
            operations[_text(parsed)] = parsed
    for unused, operation in sorted(operations.items()):
        if not isinstance(operation, dict):
            details.append("Recorded geometry operation: " + _brief(operation, 650))
            continue
        identity = operation.get("identity")
        prefix = "Feature " + str(identity) if identity is not None else "Selected feature"
        stage = operation.get("stage")
        if stage:
            prefix += " (" + str(stage) + ")"
        action = operation.get("analysis_operation")
        reason = operation.get("reason")
        if action:
            text = prefix + ": " + str(action).rstrip(".") + "."
            if reason:
                text += " Recorded reason: " + str(reason).rstrip(".") + "."
            details.append(text)
        else:
            details.append(prefix + ": " + _brief(operation, 650))
    if details:
        details.append("Complete reader settings, original feature attributes and geometry-operation "
                       "records are retained in the linked saved plan.")
    return details


def _plan_sections(plan, analysis, views):
    blocks = [
        ("Saved source geography and designations accompany the completed analysis below."
         if analysis else
         "This dossier describes the saved receiving-water geography, protection context "
         "and original source designations. Its areas are source-plan geometry values."),
        "The declared relationship distinguishes a published source polygon, explicit "
        "geometric context and retained HUC12 upstream association. Each receiving area's "
        "original rationale and geographic precision remain visible.",
        "Contribution areas use the saved projected geometry in hectares (" + plan["analysis_crs_name"]
        + "). Individual areas can overlap; their areas are not an unduplicated total.",
        _table(["Saved study", "Value"], [
            ["Title", plan["title"]], ["Created", plan["created_at"]],
            ["Receiving areas", len(plan["receptors"])],
            ["Original source entries, including explicit context", len(views)],
            ["Geographic coordinate reference", plan["analysis_crs_name"]],
            ["Quantity basis", "Completed original analysis" if analysis else "Source-plan geography"],
        ]),
        _table(["Receiving area", "Family", "Geographic relationship", "Contribution area (ha)"],
               [[row["title"], _family_label(row["family"]), row["relationship_precision"],
                 _display_number(row["contribution_area_ha"])] for row in plan["receptors"]],
               "Original saved areas. Modeled quantities and their valid support, when selected, "
               "are reported in the original analysis section. Display areas are rounded to three "
               "decimal places; very small nonzero areas use significant digits. Complete values "
               "remain in the linked saved plan."),
        {"kind": "links", "items": [
            {"title": "Complete saved plan, original features, methods and network",
             "path": "native/plan/plan.json"},
            {"title": "Original source inventory and complete member identities",
             "path": "original-source-index.json"},
        ]},
    ]
    sections = [["Receiving-water source plan", blocks]]
    for receptor in plan["receptors"]:
        relation, source = receptor["relation"], receptor["source"]
        rows = [
            ["Original receiving-area ID", receptor["id"]],
            *_classification_rows(receptor.get("classification", {})),
            ["Original source", source["title"]],
            ["Source edition", source["vintage"]],
            ["Publisher reference", source["uri"]],
            ["Selected native feature IDs", _feature_ids(receptor)],
            ["Geographic relationship", receptor["relationship_precision"]],
            ["Source rationale", _brief(relation["rationale"], 900)],
        ]
        if "buffer_m" in relation:
            rows.append(["Explicit geometry buffer (m)", _display_number(relation["buffer_m"])])
        if "seed_huc_ids" in relation:
            rows.append(["Selected receiving HUCs", _brief(relation["seed_huc_ids"])])
            rows.append(["Retained upstream HUC count", len(relation.get("upstream_huc_ids", []))])
        sections.append(["Receiving area: " + receptor["title"], [
            receptor["interpretation"],
            _table(["Source and method", "Retained value"], rows),
            *_geometry_note(receptor, plan["analysis_crs_name"]),
        ]])
    sections.append(["Original source register", [
        _table(["Source", "Edition", "Publisher reference", "Use in saved plan"],
               [[value["entry"]["title"], value["entry"]["vintage"], value["entry"]["uri"],
                 "Original geometry selection" if value["identities"] else "Explicit contextual reference"]
                for key, value in sorted(views.items())],
               "The complete source bodies, companion metadata, original collection manifests "
               "and exact source selectors accompany this report."),
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
    if _source_entry_identities(views) != identity["source_entries"]:
        raise ValueError("Original plan geometry or contextual source identity changed")
    index = read_json(directory / "original-source-index.json")
    if {digest({"source_collection_id": row["source_collection_id"], "source_id": row["source_id"]})
            for row in index} != set(views) or len(index) != len(views):
        raise ValueError("Retained source inventory differs from the exact plan selection")
    for row in index:
        key = digest({"source_collection_id": row["source_collection_id"], "source_id": row["source_id"]})
        value = views[key]
        if (read_json(directory / _member(row["entry_path"])) != value["entry"]
                or read_json(directory / _member(row["collection_path"])) != value["collection"]
                or read_json(directory / _member(row["identities_path"])) != value["identities"]
                or read_json(directory / _member(row["references_path"])) != value["references"]):
            raise ValueError("Original receiving-water source metadata differs from its capture")
        original = value["collection"]["original_manifest"]
        source = relative_file(workspace.root, original["object"])
        if (source.stat().st_size != original["bytes"] or file_digest(source) != original["sha256"]
                or file_digest(directory / _member(row["original_manifest_path"])) != original["sha256"]):
            raise ValueError("Original receiving-water source manifest differs from its capture")


def _capture_members(directory, plan, analysis, sources, modules):
    """Use the exact declared closure, including original dotfiles, never temporary files."""
    names = {"native/plan/plan.json", "original-source-index.json"}
    names.update("native/plan/" + _member(item["path"]).as_posix()
                 for item in plan["files"].values())
    if analysis is not None:
        names.update({"native/analysis/analysis.json", "native/receiving-water-delivery.json"})
        names.update("native/analysis/" + _member(item["path"]).as_posix()
                     for item in analysis["files"].values())
    for source in sources:
        names.update(item["path"] for item in source["members"])
        names.update(source[name] for name in
                     ("entry_path", "collection_path", "original_manifest_path",
                      "identities_path", "references_path"))
    names.update("implementation/" + name + ".py" for name in modules)
    return [describe_file(directory, directory / _member(name)) for name in sorted(names)]


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
        # Includes explicit contextual source selectors such as intake_reference,
        # in addition to the sources used by original geometry preparation.
        views = _source_views(workspace, plan)
        identity = {"edition": EDITION, "workspace_id": workspace.project["id"],
                    "selection": selected, "study": _study_identity(plan, analysis),
                    "source_entries": _source_entry_identities(views),
                    "capture_implementation": {name: file_digest(path) for name, path in modules.items()}}
        key = digest(identity)
        directory = workspace.root / FOLDER / key
        def report(stage):
            if progress:
                progress({"stage": stage, "report_source_id": key})
        if (directory / "report.json").exists():
            return _result(workspace, inspect(workspace, key, verify=True), delivery_id)
        report("verify-original-source-plan")
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
            from . import receiving_water_report_maps
            maps = receiving_water_report_maps.prepare(directory, plan,
                progress=(lambda value: progress({**value, "report_source_id": key})) if progress else None)
            sections = _plan_sections(plan, analysis, views)
            if inventory is not None:
                from .scientific_report import receiving_sections
                # Keep the maintained formatter's units, signed changes, fixed
                # normalization, family deduplication and valid-support tables.
                sections.extend(receiving_sections({"inventory": inventory}))
            sections.append(["Retained scientific study", [
                "This report preserves the selected immutable study. The linked original records "
                "carry its complete feature attributes, source selectors, geographic methods and "
                "capture identities; the accompanying files retain the complete original sources.",
            ]])
            title = selected.get("title") or (analysis["title"] if analysis else plan["title"])
            companions = _capture_members(directory, plan, analysis, sources, modules) + maps["files"]
            companions.sort(key=lambda item: item["path"])
            source_links = ["native/plan/plan.json", "original-source-index.json"]
            if analysis is not None:
                source_links += ["native/analysis/analysis.json", "native/receiving-water-delivery.json"]
            source_links += [row["original_manifest_path"] for row in sources]
            # Keep the report link list concise. The source index and full retained
            # archive carry every geometry, raster, native input and capture member.
            from . import observed_context
            recipe = {"schema": observed_context.SCHEMA, "title": title, "edition": EDITION,
                      "report_context_kind": "receiving-water-scientific-study",
                      "project_id": workspace.project["id"], "inputs": companions,
                      "sections": sections, "figure_spec": maps["figure_spec"],
                      "figures": maps["figures"], "source_links": source_links + [maps["figure_spec"]]}
            atomic_json(directory / "report-source.json", recipe, immutable=True)
            entry = {"id": SOURCE_ID, "kind": "document", "title": title,
                     "uri": "urn:upstate:receiving-water-report:" + workspace.project["id"] + ":" + key,
                     "vintage": intent["created_at"], "path": "report-source.json",
                     "sha256": file_digest(directory / "report-source.json"),
                     "companions": companions, "role": "receiving-water-report-source",
                     "metadata": {"report_schema": observed_context.SCHEMA,
                                  "report_context_kind": "receiving-water-scientific-study",
                                  "report_source_id": key,
                                  "project_id": workspace.project["id"],
                                  "mode": "completed_analysis" if analysis else "source_plan",
                                  "plan_id": plan["id"], "analysis_id": analysis["id"] if analysis else None,
                                  "new_native_calculation": False}}
            atomic_json(directory / "sources.json", {"schema": "upstate.sources/v1", "title": title,
                        "captured_at": intent["created_at"], "entries": [entry]}, immutable=True)
            prepared_files = companions + [describe_file(directory, directory / name)
                                           for name in ("intent.json", "report-source.json", "sources.json")]
            atomic_json(prepared, {"title": title, "summary": _summary(plan, analysis, sources),
                                  "files": sorted(prepared_files, key=lambda item: item["path"])},
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
        retained_files = ready["files"] + [describe_file(directory, prepared)]
        files = [describe_file(workspace.root, directory / _member(item["path"]))
                 for item in sorted(retained_files, key=lambda item: item["path"])]
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
