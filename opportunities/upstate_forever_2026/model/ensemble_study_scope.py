"""Original source classifications, geography and assumptions for a saved ensemble.

This is a presentation/package join. It neither changes native selections nor
computes pollutant quantities. Every displayed declaration comes from retained
grid/source/profile records; original referenced documents travel as companions.
"""
from __future__ import annotations

from copy import deepcopy
import json
import math
from pathlib import Path

from .common import atomic_json, describe_file, digest, identifier
from . import ensemble_scientific_source as shared

VERSION = 1
SCOPE_FILE = "study-source-scope.json"
KNOWN_ASSUMPTIONS = ("upstate.simulated-assumptions/v1", "upstate.simulated-input-recipe/v1")
CONTROL_SCHEMA = "upstate.simulated-matched-control/v1"
ASSUMPTION_FIELDS = ("classification", "assumptions", "nutrient_loading", "runoff_scaling",
                     "retention", "sediment", "stream_threshold", "parameter_profile")


def _plain(value):
    if value is None:
        return "Not declared"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)
    if isinstance(value, float):
        return format(value, ".10g")
    return str(value)


def _table(columns, rows, caption):
    return {"kind": "table", "columns": columns,
            "rows": [[_plain(value) for value in row] for row in rows], "caption": caption}


def _references(profiles, bindings):
    uris, hashes, controls = set(), set(), set()
    for profile in profiles.values():
        for reference in profile.get("references", []):
            if not isinstance(reference, str):
                continue
            uris.add(reference)
            if reference.startswith("recipe-sha256:"):
                value = reference.split(":", 1)[1]
                if len(value) == 64 and all(c in "0123456789abcdef" for c in value):
                    hashes.add(value)
    for binding in bindings:
        entry = binding["entry"]
        for name, selected in (("recipe_sha256", hashes), ("control_sha256", controls)):
            value = entry.get(name)
            if isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value):
                selected.add(value)
    return uris, hashes, controls


def capture(workspace, directory, grid, profiles, bindings, collections):
    """Retain explicitly referenced document bodies and the original scope."""
    directory = Path(directory)
    uris, hashes, controls = _references(profiles, bindings)
    references, extra_bindings, source_records = [], [], []
    already = {(row["source_collection_id"], row["source_id"]) for row in bindings}
    for collection_id, collection in sorted(collections.items()):
        for entry in collection["entries"]:
            if entry.get("kind") != "document":
                continue
            reasons = []
            if entry.get("uri") in uris:
                reasons.append("Exact original profile reference URI")
            if entry.get("body", {}).get("sha256") in hashes:
                reasons.append("Exact declared original recipe SHA256")
            if entry.get("body", {}).get("sha256") in controls:
                reasons.append("Exact declared original matched-control SHA256")
            if not reasons:
                continue
            source_id = entry["id"]
            original, verified_entry = workspace.source_file(collection_id, source_id)
            if verified_entry["body"] != entry["body"]:
                raise ValueError("Referenced original document differs from its retained source edition")
            folder = directory / "reference-sources" / identifier(collection_id) / digest(source_id)
            atomic_json(folder / "entry.json", entry, immutable=True)
            shared._copy(workspace, collection["original_manifest"],
                         folder.parent / "original-manifest.json")
            copied = []
            original_member = None
            for body in [entry["body"], *entry.get("companions", [])]:
                name = shared._member(body.get("view_path", body["filename"]))
                target = folder / "members" / name
                shared._copy(workspace, body, target)
                item = describe_file(directory, target)
                copied.append(item)
                if body is entry["body"]:
                    original_member = target
            assertions, original_control = {}, None
            if entry["body"]["bytes"] <= 2 * 1024 * 1024:
                try:
                    value = json.loads(original_member.read_bytes())
                except (UnicodeError, json.JSONDecodeError):
                    value = None
                if isinstance(value, dict) and value.get("schema") in KNOWN_ASSUMPTIONS:
                    assertions = {key: deepcopy(value[key]) for key in ASSUMPTION_FIELDS if key in value}
                if isinstance(value, dict) and value.get("schema") == CONTROL_SCHEMA:
                    original_control = {key: deepcopy(value[key]) for key in (
                        "schema", "classification", "source_recipe_sha256", "source_mask_role",
                        "mask_role", "changed_cells", "changed_area_ha", "scenario", "interpretation")
                        if key in value}
                    matching = value.get("matching")
                    if isinstance(matching, dict):
                        original_control["matching"] = {
                            key: deepcopy(item) for key, item in matching.items() if key != "pairs"}
                        pairs = matching.get("pairs")
                        original_control["matching_pair_count"] = len(pairs) if isinstance(pairs, list) else None
            references.append({
                "source_collection_id": collection_id, "source_id": source_id,
                "title": entry.get("title", source_id), "uri": entry.get("uri"),
                "classification": deepcopy(entry.get("classification")), "reasons": reasons,
                "body": describe_file(directory, original_member),
                "members": copied, "original_assumptions": assertions,
                "original_control": original_control,
            })
            if (collection_id, source_id) not in already:
                extra_bindings.append({
                    "source_collection_id": collection_id, "source_id": source_id,
                    "roles": ["Referenced source assumption or recipe"], "entry": deepcopy(entry),
                    "original_bytes_in_report_package": True,
                })
                source_records.append({
                    "id": "native-reference-" + digest([collection_id, source_id])[:16],
                    "source_collection_id": collection_id, "source_id": source_id,
                    "title": entry.get("title", source_id), "uri": entry.get("uri", ""),
                    "vintage": entry.get("vintage", ""), "body_sha256": entry["body"]["sha256"],
                })
    spec, native = grid["spec"], grid["grid"]
    choices = {}
    for role in ("model_domain", "reporting_area"):
        selected = spec.get(role)
        choices[role] = deepcopy(selected)
    rows = []
    for binding in [*bindings, *extra_bindings]:
        entry = binding["entry"]
        rows.append({
            "roles": deepcopy(binding["roles"]),
            "source_collection_id": binding["source_collection_id"], "source_id": binding["source_id"],
            "title": entry.get("title", binding["source_id"]),
            "classification": deepcopy(entry.get("classification")), "uri": entry.get("uri"),
            "vintage": entry.get("vintage"), "units": deepcopy(entry.get("units")),
            "original_sha256": entry["body"]["sha256"],
        })
    rectangle_area = None
    values = (native.get("width"), native.get("height"), native.get("pixel_area_ha"))
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0 for v in values):
        rectangle_area = values[0] * values[1] * values[2]
    result = {
        "schema": "upstate.ensemble-study-source-scope/v1", "version": VERSION,
        "grid_id": grid["id"], "grid_title": grid.get("title", spec.get("title")),
        "native_grid": deepcopy(native), "grid_rectangle_area_ha": rectangle_area,
        "geographic_source_collection_id": spec["source_collection_id"],
        "geographic_selections": choices,
        "upstream_buffer_m": spec.get("upstream_buffer_m"),
        "domain_reason": spec.get("domain_reason"),
        "input_source_classifications": rows, "referenced_documents": references,
        "quantity_endpoint": "Native annual land-origin export delivered to the modeled stream network",
        "geographic_meaning": (
            "Grid dimensions and rectangle area describe the raster envelope. Model-domain and "
            "reporting-area choices below select their original source geometry. Physical totals "
            "and differences retain the original reporting mask and paired valid support."),
    }
    atomic_json(directory / SCOPE_FILE, result, immutable=True)
    return result, extra_bindings, source_records


def _control_blocks(document, control):
    matching = control.get("matching", {})
    classes = matching.get("by_original_class", [])
    classes = classes if isinstance(classes, list) else []
    interpretation = control.get("interpretation", [])
    interpretation = interpretation if isinstance(interpretation, list) else [interpretation]
    blocks = [
        "The following values and interpretation are retained from the original selected "
        "control-input document. The existing native result sections use the completed runs "
        "and their actual reporting support.",
        _table(["Original input property", "Original value"], [
            ["Source document", document["title"]],
            ["Declared classification", control.get("classification")],
            ["Source recipe SHA256", control.get("source_recipe_sha256")],
            ["Changed input cells", control.get("changed_cells")],
            ["Changed input area (ha)", control.get("changed_area_ha")],
            ["Original matching pairs in the attached document", control.get("matching_pair_count")],
            ["Matching method", matching.get("method")],
            ["Excluded candidates", matching.get("exclusion")],
            ["Common input-grid precipitation mean (mm/year)",
             matching.get("common_grid_precipitation_mean_mm_year")],
        ], "Retained input design; native final ownership supplies the reported intervention footprint"),
        _table(["Original code", "Replacement code", "Restoration cells", "Control cells",
                "Changed input area (ha)"],
               [[row.get("from_code"), row.get("to_code"), row.get("target_cells"),
                 row.get("control_cells"), row.get("area_ha")] for row in classes],
               "Exact original class and changed-area matching"),
        _table(["Original code", "Restoration precipitation sum", "Control precipitation sum",
                "Control minus restoration sum"],
               [[row.get("from_code"), row.get("target_precipitation_sum_mm_year"),
                 row.get("control_precipitation_sum_mm_year"),
                 row.get("precipitation_sum_residual_mm_year")] for row in classes],
               "Sums of original cell precipitation values (mm/year), retained as input-matching quantities"),
        _table(["Original code", "Mean absolute paired precipitation residual (mm/year)",
                "Maximum absolute paired precipitation residual (mm/year)"],
               [[row.get("from_code"), row.get("mean_absolute_paired_precipitation_residual_mm_year"),
                 row.get("max_absolute_paired_precipitation_residual_mm_year")] for row in classes],
               "Original pairwise rainfall residuals; complete pairs remain in the attached source"),
        *[_plain(item) for item in interpretation],
        {"kind": "links", "items": [
            {"title": "Complete original matched-control selection and every pair",
             "path": document["body"]["path"]}]},
    ]
    return blocks


def sections(scope):
    """Readable source facts in the existing ordered Scientific Reports format."""
    native = scope["native_grid"]
    role_names = {"model_domain": "Computational domain",
                  "reporting_area": "Reporting geography"}
    geography = []
    for role, choice in scope["geographic_selections"].items():
        matching = [row for row in scope["input_source_classifications"]
                    if role in row["roles"]]
        for row in matching or [{}]:
            geography.append([role_names[role], row.get("title"), row.get("classification"),
                              row.get("source_id"), choice])
    originals = scope["input_source_classifications"]
    blocks = [
        "This saved design retains the original source classifications, geographic choices and "
        "assumption documents below. These declarations belong to the selected source editions.",
        _table(["Native grid property", "Original value"], [
            ["Title", scope["grid_title"]],
            ["Coordinate reference system", native.get("crs_name") or native.get("crs")],
            ["Columns × rows", _plain(native.get("width")) + " × " + _plain(native.get("height"))],
            ["Native cell size (m)", native.get("resolution_m")],
            ["Native cell area (ha)", native.get("pixel_area_ha")],
            ["Grid rectangle area (ha)", scope["grid_rectangle_area_ha"]],
            ["Grid bounds in original CRS", native.get("bounds")],
            ["Declared upstream buffer (m)", scope["upstream_buffer_m"]],
            ["Original domain reason", scope["domain_reason"]],
        ], "Original native grid and computational envelope"),
        scope["geographic_meaning"],
        _table(["Geographic role", "Original source title", "Declared classification",
                "Source ID", "Original source selection"], geography,
               "Computational and reporting geometry retain separate source selections"),
        _table(["Selected role", "Original source", "Declared classification", "Original units"],
               [[", ".join(row["roles"]), row["title"], row["classification"], row["units"]]
                for row in originals],
               "Original input declarations; absent classifications are displayed as not declared"),
        "Selected native NDR outputs quantify annual land-origin nitrogen and phosphorus export in "
        "kg/year; selected SDR outputs quantify sediment export in metric tonnes/year reaching "
        "modeled streams. Interpreting an intake "
        "requires its own downstream transport, reservoir and concentration relationship. The "
        "existing paired sections retain each original constituent, unit and valid-cell support.",
        {"kind": "links", "items": [
            {"title": "Original source scope and complete document identities", "path": SCOPE_FILE},
            {"title": "Original prepared grid record", "path": "original/grid.json"},
            {"title": "Native input and output inventory", "path": "native-input-inventory.json"},
            *[{"title": row["title"], "path": row["body"]["path"]}
              for row in scope["referenced_documents"]],
        ]},
    ]
    result = [["Original geography, source classifications and model endpoint", blocks]]
    if scope["referenced_documents"]:
        statements, links = [], []
        for document in scope["referenced_documents"]:
            links.append({"title": document["title"], "path": document["body"]["path"]})
            for name, value in document["original_assumptions"].items():
                statements.append([document["title"], name, value])
        detail = [
            "These are the retained original source statements and their exact document bodies. "
            "The selected per-case profile tables identify the parameter variants used in this design.",
            _table(["Original document", "Reference relationship", "Original SHA256"],
                   [[row["title"], row["reasons"], row["body"]["sha256"]]
                    for row in scope["referenced_documents"]],
                   "Source documents selected by original profile URI or declared recipe/control hash"),
        ]
        if statements:
            detail.append(_table(["Original document", "Source field", "Original statement"],
                                 statements, "Original assumptions, without reinterpretation"))
        detail.append({"kind": "links", "items": links})
        result.append(["Original referenced input assumptions and recipes", detail])
    for document in scope["referenced_documents"]:
        control = document.get("original_control")
        if control is not None:
            result.append(["Original matched-control input selection", _control_blocks(document, control)])
    return result
