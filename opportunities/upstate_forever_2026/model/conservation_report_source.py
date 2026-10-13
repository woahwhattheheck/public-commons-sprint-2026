"""Publish an original saved Conservation portfolio into the existing report composer.

This producer reads retained results and prepares an observed-context source
document. It creates neither a new portfolio nor a native model execution.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

from . import conservation, conservation_reporting, observed_context
from .common import (
    atomic_json, canonical, describe_file, digest, file_digest, held, identifier,
    now, read_json, verify_file,
)
from .reuse import copy_verified, destination_file

SCHEMA = "upstate.conservation-report-source/v1"
EDITION = "conservation-saved-plan-report/1"
DIRECTORY = "conservation-report-sources"


def _copy(value):
    return deepcopy(value)


def _title(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Supply a scientific report source title")
    return value.strip()


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Retained report members need canonical relative names")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or any(p in (".", "..") for p in path.parts)
            or path.as_posix() != value):
        raise ValueError("Report source members must remain inside their source")
    return path.as_posix()


def _identity_file(item):
    return {key: item[key] for key in ("path", "bytes", "sha256")}


def _same_file(actual, expected):
    return all(actual.get(key) == expected.get(key) for key in ("bytes", "sha256"))


def _text(value):
    if value is None:
        return "Not available"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    if isinstance(value, float):
        return format(value, ".10g")
    return str(value)


def _table(columns, rows):
    return {"kind": "table", "columns": list(columns),
            "rows": [[_text(cell) for cell in row] for row in rows]}


def _links(items):
    return {"kind": "links", "items": [
        {"title": title, "path": _relative(path)} for title, path in items
    ]}


def _source_entries(workspace, state):
    """Resolve every selected planning/criterion source to its actual original."""
    references = conservation_reporting.source_register(state)
    sources = {}
    for reference in references:
        collection = identifier(reference.get("source_collection_id"))
        source_id = reference.get("source_id")
        if not isinstance(source_id, str) or not source_id:
            raise ValueError("A retained planning source lacks its actual source ID")
        key = (collection, source_id)
        if key not in sources:
            unused, entry = workspace.source_file(collection, source_id)
            sources[key] = {"source_collection_id": collection, "source_id": source_id,
                            "entry": _copy(entry), "references": []}
        resolved = sources[key]
        if not _same_file(resolved["entry"]["body"], reference["body"]):
            raise ValueError("A selected original source body differs from the saved study")
        # source_file verifies the immutable collection ID and all original
        # companions. Older study snapshots bind that collection and body but do
        # not duplicate companion descriptors; retain the actual source edition.
        expected = reference.get("companions")
        if expected:
            actual = resolved["entry"].get("companions", [])
            def member_keys(values):
                return sorted((item.get("view_path", item.get("filename")),
                               item["bytes"], item["sha256"]) for item in values)
            if member_keys(actual) != member_keys(expected):
                raise ValueError("Original source companions differ from the saved study")
        resolved["references"].append(_copy(reference))
    return [sources[key] for key in sorted(sources)]


def _retained_rows(workspace, state, plan):
    portfolio = read_json(verify_file(workspace.root, plan["files"]["portfolio"]))
    if (portfolio.get("schema") != "upstate.conservation-portfolio/v1"
            or portfolio.get("id") != plan["id"]
            or portfolio.get("study_id") != state["id"]
            or portfolio.get("selected_ids") != plan["selected_ids"]
            or portfolio.get("summary") != plan["summary"]):
        raise ValueError("The original portfolio artifact and saved plan differ")
    rows = portfolio.get("selected_candidates")
    if (not isinstance(rows, list) or [row.get("id") for row in rows] != plan["selected_ids"]
            or len(set(plan["selected_ids"])) != len(rows)):
        raise ValueError("The original selected candidate rows differ from the saved plan")
    return rows


def _sections(state, plan, rows, packet, sources):
    spec, summary = state["selection"]["spec"], plan["summary"]
    context = state["mode"] == "source_context"
    from pyproj import CRS
    analysis_crs = CRS.from_user_input(plan["analysis_crs"]).to_string()
    normalization = state.get("normalization", {})
    decision_rows = [
        ["Selection algorithm", plan.get("algorithm")],
        ["Ordering objective", plan["selection"].get("objective")],
        ["Include ineligible units", plan["selection"].get("include_ineligible")],
    ]
    for group, values in (("Limit", plan["selection"].get("limits", {})),
                          ("Eligibility", spec.get("rules", {})),
                          ("Score", spec.get("score", {}))):
        for name, value in values.items():
            if isinstance(value, dict):
                decision_rows.extend([group + ": " + name + "." + key, item]
                                     for key, item in value.items()
                                     if not isinstance(item, (dict, list)))
            elif not isinstance(value, list):
                decision_rows.append([group + ": " + name, value])
    for name in ("basis", "scale", "title", "unit", "maximum", "formula",
                 "normalization_population", "source_uri"):
        if name in normalization:
            decision_rows.append(["Normalization: " + name, normalization[name]])
    sections = [["Saved conservation portfolio", [
        "This report presents the original completed Conservation study and selected portfolio. "
        "All tables use retained results; the attached decision packet contains the full candidate "
        "inventory, editable geodata, original scoring details and source register.",
        _table(["Selection", "Retained value"], [
            ["Portfolio", plan["title"]], ["Original portfolio ID", plan["id"]],
            ["Original study", state["title"]], ["Original study ID", state["id"]],
            ["Purpose", state["purpose"]], ["Planning units", state["planning_unit_label"]],
            ["Unit type", state["unit_type"]], ["Study mode", state["mode"]],
            ["Analysis CRS", analysis_crs],
            ["Selected original units", len(plan["selected_ids"])],
            ["Decision packet ID", packet["id"]],
        ]),
        ("The saved source-context study measures geographic relationships to the selected original "
         "boundaries. Nitrogen, phosphorus and sediment values are unavailable in this study because "
         "it has no bound native modeled case."
         if context else
         "Native quantities describe the selected footprint within each complete original modeled case. "
         "A whole-scenario difference over that footprint is not automatically the effect of treating "
         "only those units. The selected baseline, alternatives and their execution provenance remain explicit."),
    ]]]
    areas = [
        ["Selected reporting footprint", summary.get("union_area_ha"), "ha"],
        ["Full original selected-unit union", summary.get("whole_unit_union_area_ha"), "ha"],
        ["Reporting overlap counted once", summary.get("overlap_area_ha"), "ha"],
        ["Full-unit overlap counted once", summary.get("whole_unit_overlap_area_ha"), "ha"],
        ["Selected protected-source intersection", summary.get("protected_area_ha"), "ha"],
        ["Selected source-water intersection", summary.get("source_water_area_ha"), "ha"],
        ["Selected high-quality-water area intersection", summary.get("high_quality_overlap_area_ha"), "ha"],
        ["Selected high-quality-water line contact", summary.get("high_quality_contact_length_m"), "m"],
        ["Budget footprint", summary.get("budget_area_ha"), "ha"],
        ["Budget footprint basis", summary.get("area_budget_basis"), "declared choice"],
        ["Supplied whole-unit cost", summary.get("cost_total"), summary.get("currency")],
        ["Known supplied-cost subtotal", summary.get("known_cost_subtotal"), summary.get("currency")],
        ["Units without supplied costs", summary.get("units_without_cost"), "units"],
    ]
    sections.append(["Selected land and geographic context", [
        "Area totals use the original selected union in its saved analysis CRS. Overlapping planning "
        "units and overlapping context polygons are counted once in the union. Whole original units "
        "and their intersection with the reporting boundary remain separate quantities.",
        _table(["Retained quantity", "Value", "Unit or basis"], areas),
        "The source-water and designated-water relations below retain their actual declared selection. "
        "Geographic overlap, published protection footprints and an upstream connectivity analysis have "
        "different meanings. A blank source quantity remains unavailable.",
    ]])
    relations = []
    for name, choice in spec.get("contexts", {}).items():
        relations.append([name, choice.get("source_id"), choice.get("relation"),
                          choice.get("meaning"), choice.get("reference")])
    if relations:
        sections.append(["Declared geographic relations", [
            _table(["Context", "Original source", "Relation", "Meaning", "Reference"], relations),
        ]])
    sections.append(["Saved decision rules", [
        _table(["Rule", "Saved value"], decision_rows),
        _text(plan.get("algorithm_detail")),
        "The complete original eligibility lists, scoring selection, normalization and "
        "criterion table remain in records/study-inspection.json and the decision packet.",
        "Costs are the supplied amounts for complete original units. An unknown cost remains unknown; "
        "the known subtotal is shown separately from an unavailable total. Original score inputs, "
        "normalization, weights, method prerequisites and missing evidence remain in the attached records.",
    ]])
    sections.append(["Complete selected planning-unit inventory", [
        _table(["Original unit ID", "Label", "Whole area (ha)", "Reporting area (ha)",
                "Source-water area (ha)"], [
            [row["id"], row.get("label"), row.get("area_ha"), row.get("reporting_area_ha"),
             row.get("source_water_area_ha")] for row in rows]),
        _table(["Original unit ID", "Eligible", "Retained score", "Score units",
                "Supplied cost", "Currency"], [
            [row["id"], row.get("eligible"), row.get("score"), row.get("score_unit") or (
                 "Dimensionless context score" if spec.get("score", {}).get("basis") == "context" else None),
             row.get("cost"), row.get("currency")] for row in rows]),
        "The selected inventory is complete. The attached candidate table also preserves every "
        "unselected candidate, exclusion reason and original attribute for reviewing other choices.",
    ]])
    pollutants = summary.get("pollutants", {})
    if pollutants:
        baseline = []
        for name, metric in pollutants.items():
            baseline.append([name, metric.get("baseline"), metric.get("unit"),
                             metric.get("coverage_fraction"), metric.get("valid_area_ha"),
                             metric.get("availability_reason") or metric.get("availability")])
        sections.append(["Original baseline quantities and support", [
            _table(["Quantity", "Value", "Physical unit", "Coverage fraction",
                    "Valid area (ha)", "Availability"], baseline),
            "Coverage fractions are between zero and one. Valid areas, structural stream areas "
            "and missing areas are retained separately in the original portfolio JSON. Nitrogen, "
            "phosphorus and sediment keep distinct physical units; absent outputs are not zero.",
        ]])
        for run_id in spec.get("alternative_run_ids", []):
            blocks = ["Original alternative run: " + run_id]
            for name, metric in pollutants.items():
                alternative = metric.get("alternatives", {}).get(run_id)
                if alternative is None:
                    continue
                blocks.append(_table(["Quantity or support", name + " / " + str(metric.get("unit", ""))], [
                    ["Alternative value on its own support", alternative.get("value")],
                    ["Alternative coverage fraction", alternative.get("coverage_fraction")],
                    ["Alternative valid area (ha)", alternative.get("valid_area_ha")],
                    ["Alternative availability", alternative.get("availability_reason") or alternative.get("availability")],
                    ["Baseline on common support", alternative.get("common_baseline")],
                    ["Alternative on common support", alternative.get("common_alternative")],
                    ["Alternative minus baseline on common support", alternative.get("delta")],
                    ["Common coverage fraction", alternative.get("common_coverage_fraction")],
                    ["Common valid area (ha)", alternative.get("common_valid_area_ha")],
                    ["Common structural stream area (ha)", alternative.get("common_structural_stream_area_ha")],
                    ["Comparison availability", alternative.get("comparison_availability_reason") or alternative.get("comparison_availability")],
                    ["Parameter profile changed", alternative.get("profile_changed")],
                ]))
            blocks.append("Differences use only common retained support. The alternative's own total "
                          "and coverage remain separate from paired values. Model routing beyond the "
                          "selected footprint remains part of the original complete scenario.")
            sections.append(["Original alternative comparison", blocks])
    executions = state.get("native_execution", {})
    if executions:
        versions = []
        for run_id, execution in executions.items():
            for model, value in execution.get("model_versions", {}).items():
                versions.append([run_id, model.upper(), value.get("comparison_version"),
                                 value.get("basis"), value.get("requested_version"),
                                 value.get("stage_completed_at")])
        sections.append(["Native execution provenance", [
            _table(["Original run ID", "Model", "Execution version", "Recorded basis",
                    "Requested version", "Stage completed"], versions),
            "Each completed model stage retains its own execution provenance. An observed run fallback "
            "or requested-only legacy record is labelled explicitly. Full observed runtime, stage reuse, "
            "unit contract and compatibility records are attached in the original study snapshot.",
        ]])
    source_rows = []
    for original in sources:
        entry = original["entry"]
        source_rows.append([", ".join(sorted({ref["role"] for ref in original["references"]})),
                            entry["title"], entry["vintage"], entry["uri"],
                            entry["body"]["sha256"]])
    sections.append(["Original planning and criterion sources", [
        _table(["Selected role", "Original title", "Edition", "Original URI", "Body SHA-256"], source_rows),
        "Every selected planning or criterion source body and its declared companions are retained "
        "with this report source. Original native raster references and producing-model provenance "
        "remain in the complete study and decision packet; recomputation uses the original Workspace.",
    ]])
    sections.append(["Complete original decision records", [
        _links([
            ("Complete existing Conservation decision packet", "decision-packet.zip"),
            ("Original saved plan", "records/plan.json"),
            ("Original saved study", "records/study.json"),
            ("Report's verified study metadata and execution provenance", "records/study-inspection.json"),
            ("Complete original selected portfolio and quantities", "records/portfolio.json"),
            ("Original source entries and selected bindings", "records/source-bindings.json"),
            ("Complete retained candidate inventory", "records/candidates.json"),
        ]),
    ]])
    return sections


def _write_bundle(directory, files, target):
    """Write the source manifest and every companion without extracting a packet."""
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".source-", suffix=".zip",
                                         delete=False) as temporary:
            pending = Path(temporary.name)
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=5, allowZip64=True) as archive:
            for name, descriptor in sorted(files.items()):
                source = verify_file(directory, descriptor)
                info = zipfile.ZipInfo(_relative(name), date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with source.open("rb") as stream, archive.open(info, "w", force_zip64=True) as out:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        out.write(block)
                verify_file(directory, descriptor)
        if target.exists():
            if target.stat().st_size != pending.stat().st_size or file_digest(target) != file_digest(pending):
                raise ValueError("Retained report-source bundle differs")
            pending.unlink()
        else:
            pending.replace(target)
        pending = None
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _verify_source(workspace, value):
    choice = value["source"]
    unused, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    if (entry.get("kind") != "document" or entry.get("role") != observed_context.ROLE
            or not _same_file(entry["body"], value["files"]["recipe"])):
        raise ValueError("The original report recipe source differs from its receipt")
    actual = {item.get("view_path", item["filename"]): item
              for item in entry.get("companions", [])}
    expected = value["members"]
    if len(actual) != len(entry.get("companions", [])) or set(actual) != set(expected):
        raise ValueError("Original report source companion membership differs")
    for name, item in expected.items():
        if not _same_file(actual[name], item):
            raise ValueError("Original report source companion differs: " + name)
    current = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    if current != value["observed_binding"]:
        raise ValueError("Original scientific-report source binding differs")
    return value


def get(workspace, key):
    """Reopen the same completed imported source and verify all retained members."""
    key = identifier(key)
    value = read_json(workspace.root / DIRECTORY / key / "receipt.json")
    if (value.get("schema") != SCHEMA or value.get("state") != "complete"
            or value.get("id") != key or digest(value.get("selection")) != key):
        raise ValueError("The retained Conservation report-source identity differs")
    for item in value["files"].values():
        verify_file(workspace.root, item)
    for item in value["members"].values():
        verify_file(workspace.root, item)
    return _verify_source(workspace, value)


def list_sources(workspace, plan_id=None):
    """Return completed receipt metadata without re-reading source bodies."""
    if plan_id is not None:
        plan_id = identifier(plan_id)
    root = workspace.root / DIRECTORY
    if not root.exists():
        return []
    rows = []
    for path in sorted(root.glob("*/receipt.json")):
        value = read_json(path)
        if (value.get("schema") != SCHEMA or value.get("state") != "complete"
                or path.parent.name != value.get("id")
                or digest(value.get("selection")) != value["id"]):
            raise ValueError("A Conservation report-source receipt differs")
        if plan_id is not None and value["plan_id"] != plan_id:
            continue
        rows.append({key: _copy(value[key]) for key in (
            "id", "study_id", "plan_id", "title", "state", "source", "created_at", "files",
        )})
    return rows


def prepare(workspace, spec):
    """Retain a source document for the current Scientific Reports composer."""
    if not isinstance(spec, dict) or set(spec) - {"plan_id", "title"}:
        raise ValueError("Supply the original plan_id and optional report-source title")
    plan = conservation.get_plan(workspace, identifier(spec.get("plan_id")))
    if plan.get("state") != "complete":
        raise ValueError("Choose a completed original Conservation portfolio")
    state = conservation.inspect(workspace, plan["study_id"], include_candidates=False)
    if state.get("state") != "complete" or state["id"] != plan["study_id"]:
        raise ValueError("The original Conservation study must be complete")
    title = _title(spec.get("title", plan["title"]))
    rows = _retained_rows(workspace, state, plan)
    for item in plan["files"].values():
        verify_file(workspace.root, item)
    packet = conservation.export_packet(workspace, state["id"], plan["id"])
    originals = _source_entries(workspace, state)
    plan_file = describe_file(workspace.root, workspace.root / "conservation-plans" / plan["id"] / "plan.json")
    study_file = describe_file(workspace.root, workspace.root / "conservation" / state["id"] / "study.json")
    identity = {
        "edition": EDITION, "producer_sha256": file_digest(__file__),
        "project_id": workspace.project["id"], "plan_id": plan["id"], "study_id": state["id"],
        "title": title, "plan": plan_file, "study": study_file,
        "packet": {**_identity_file(packet), "id": packet["id"], "presentation": packet["presentation"]},
        "source_entries": originals,
        "native_execution": state.get("native_execution", {}),
    }
    key = digest(identity)
    directory = workspace.root / DIRECTORY / key
    with held(directory / ".source.lock", blocking=False):
        receipt = directory / "receipt.json"
        if receipt.exists():
            return {**get(workspace, key), "reused": True}
        members = {}
        def retain(name, descriptor):
            name = _relative(name)
            if name in members:
                if not _same_file(members[name], descriptor):
                    raise ValueError("Report source members collide: " + name)
                return
            copied = copy_verified(workspace.root, descriptor, directory, path=name)
            members[name] = describe_file(directory, directory / copied["path"])
        def write(name, value):
            name = _relative(name)
            if name in members:
                raise ValueError("Report source member names collide")
            path = destination_file(directory, name)
            atomic_json(path, value, immutable=True)
            members[name] = describe_file(directory, path)
        retain("decision-packet.zip", packet)
        retain("records/plan.json", plan_file)
        retain("records/study.json", study_file)
        retain("records/portfolio.json", plan["files"]["portfolio"])
        retain("records/candidates.json", state["files"]["candidates"])
        write("records/study-inspection.json", state)
        write("records/source-bindings.json", {"schema": "upstate.conservation-report-originals/v1",
                                              "study_id": state["id"], "sources": originals})
        for role, item in sorted(plan["files"].items()):
            if role == "footprint":
                continue
            retain("portfolio/" + _relative(role) + "/" + Path(item["path"]).name, item)
        for original in originals:
            prefix = "originals/" + original["source_collection_id"] + "/" + digest(original["source_id"]) + "/"
            for item in [original["entry"]["body"]] + original["entry"].get("companions", []):
                native_name = _relative(item.get("view_path", item["filename"]))
                retain(prefix + native_name, {"path": item["object"], "bytes": item["bytes"],
                                              "sha256": item["sha256"]})
        recipe = {
            "schema": observed_context.SCHEMA, "edition": EDITION, "title": title,
            "origin": {"schema": SCHEMA, "id": key, "project_id": workspace.project["id"],
                       "study_id": state["id"], "plan_id": plan["id"], "packet_id": packet["id"],
                       "mode": state["mode"], "purpose": state["purpose"],
                       "unit_type": state["unit_type"], "planning_unit_label": state["planning_unit_label"]},
            "inputs": [members[name] for name in sorted(members)],
            "sections": _sections(state, plan, rows, packet, originals),
            "source_links": ["records/source-bindings.json", "records/study-inspection.json",
                             "records/plan.json", "records/candidates.json", "decision-packet.zip"],
        }
        recipe_path = directory / "conservation-report.json"
        atomic_json(recipe_path, recipe, immutable=True)
        recipe_file = describe_file(directory, recipe_path)
        source_id = "conservation-portfolio-" + key
        manifest = {
            "schema": "upstate.sources/v1", "title": title,
            "scope": "Original saved Conservation portfolio as a retained scientific-report source",
            "entries": [{
                "id": source_id, "kind": "document", "role": observed_context.ROLE,
                "title": title, "uri": "workspace://" + str(workspace.project["id"]) + "/conservation-plans/" + plan["id"],
                "vintage": "Saved portfolio " + str(plan.get("completed_at") or plan.get("created_at")),
                **recipe_file,
                "companions": [members[name] for name in sorted(members)],
                "metadata": {"origin": recipe["origin"], "source_kind": "saved_conservation_portfolio",
                             "original_output_scope": "Original selected footprint, with every planning source retained"},
            }],
        }
        manifest_path = directory / "sources.json"
        atomic_json(manifest_path, manifest, immutable=True)
        manifest_file = describe_file(directory, manifest_path)
        bundle = directory / "conservation-report-source.zip"
        _write_bundle(directory, {**members, recipe_file["path"]: recipe_file,
                                  manifest_file["path"]: manifest_file}, bundle)
        collection = workspace.import_sources(manifest_path)
        choice = {"source_collection_id": collection["id"], "source_id": source_id}
        binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
        result = {
            "schema": SCHEMA, "edition": EDITION, "id": key, "state": "complete",
            "plan_id": plan["id"], "study_id": state["id"], "title": title,
            "selection": identity, "source": choice, "observed_binding": binding,
            "packet": _copy(packet), "created_at": now(),
            "files": {
                "recipe": describe_file(workspace.root, recipe_path),
                "manifest": describe_file(workspace.root, manifest_path),
                "source_bundle": describe_file(workspace.root, bundle),
            },
            "members": {name: describe_file(workspace.root, directory / name)
                        for name in sorted(members)},
        }
        _verify_source(workspace, result)
        atomic_json(receipt, result, immutable=True)
        return result
