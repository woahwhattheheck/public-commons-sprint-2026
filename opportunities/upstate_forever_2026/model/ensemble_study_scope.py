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

VERSION = 2
SCOPE_FILE = "study-source-scope.json"
KNOWN_ASSUMPTIONS = ("upstate.simulated-assumptions/v1", "upstate.simulated-input-recipe/v1")
CONTROL_SCHEMA = "upstate.simulated-matched-control/v1"
GEOGRAPHIC_SCHEMA = "upstate.geographic-headwaters-assumptions/v1"
GEOGRAPHIC_FIELDS = ("classification", "question", "geography", "physical_fields",
                     "terrain", "terrain_parameters", "land_cover_pattern", "loads",
                     "parameters", "outputs", "scope", "control", "references")
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



def _geographic_references(profiles):
    """Bind a geographic edition to the profile's own retained source collection."""
    result = {}
    for profile in profiles.values():
        collection = profile.get("source_collection_id")
        if not isinstance(collection, str):
            continue
        for reference in profile.get("references", []):
            if not isinstance(reference, str) or not reference.startswith("geographic-edition:"):
                continue
            edition = reference.split(":", 1)[1]
            if len(edition) == 64 and all(c in "0123456789abcdef" for c in edition):
                result.setdefault(collection, set()).add(edition)
    return result


def _geographic_member(entry, editions):
    """Recognize only the exact declared edition and one original member name."""
    uri = entry.get("uri")
    if not isinstance(uri, str):
        return None
    for edition in sorted(editions):
        prefix = "upstate.geographic-headwaters:" + edition + "/"
        if uri.startswith(prefix):
            name = uri[len(prefix):]
            if (name and name not in (".", "..") and "/" not in name
                    and "\\" not in name and "\0" not in name):
                return {"edition_id": edition, "member": name}
    return None


def capture(workspace, directory, grid, profiles, bindings, collections):
    """Retain explicitly referenced document bodies and the original scope."""
    directory = Path(directory)
    uris, hashes, controls = _references(profiles, bindings)
    geographic_editions = _geographic_references(profiles)
    references, extra_bindings, source_records = [], [], []
    already = {(row["source_collection_id"], row["source_id"]) for row in bindings}
    for collection_id, collection in sorted(collections.items()):
        for entry in collection["entries"]:
            if entry.get("kind") != "document":
                continue
            reasons = []
            geographic = _geographic_member(entry, geographic_editions.get(collection_id, set()))
            if geographic is not None:
                reasons.append("Exact geographic-edition profile reference in its original source collection")
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
            assertions, original_control, original_geographic = {}, None, None
            if entry["body"]["bytes"] <= 2 * 1024 * 1024:
                try:
                    value = json.loads(original_member.read_bytes())
                except (UnicodeError, json.JSONDecodeError):
                    value = None
                if isinstance(value, dict) and value.get("schema") in KNOWN_ASSUMPTIONS:
                    assertions = {key: deepcopy(value[key]) for key in ASSUMPTION_FIELDS if key in value}
                if geographic is not None and isinstance(value, dict):
                    if value.get("schema") == GEOGRAPHIC_SCHEMA:
                        assertions = {key: deepcopy(value[key]) for key in GEOGRAPHIC_FIELDS if key in value}
                        original_geographic = {
                            "kind": "assumptions", "edition_id": geographic["edition_id"],
                            "schema": value["schema"], "input_summary": deepcopy(value.get("input_summary", {})),
                        }
                    elif geographic["member"] == "geographic-binding.json":
                        original_geographic = {
                            "kind": "binding", "edition_id": geographic["edition_id"],
                            "binding": {key: deepcopy(value[key]) for key in (
                                "reporting_huc12s", "model_domain_huc12s", "upstream_huc12s",
                                "method", "hydrology_scope", "areas_ha", "topology", "grid",
                                "intake_footprint_relations") if key in value},
                        }
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
                "geographic_reference": geographic, "original_geographic": original_geographic,
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



def _geographic_blocks(document, geographic, references):
    """Display retained preparation quantities; never infer local model benefits."""
    blocks = [
        "This geographic edition combines original public-source geography with explicitly "
        "simulated physical fields and planting assumptions. Quantities in this section "
        "describe the retained input preparation. Native finite-cell support and annual "
        "stream exports remain in the completed-result sections.",
        _table(["Original geographic source", "Retained identity"], [
            ["Source document", document["title"]],
            ["Profile-declared geographic edition", geographic["edition_id"]],
        ], "Exact geographic edition selected by the original parameter profile"),
    ]
    if geographic["kind"] == "binding":
        binding = geographic["binding"]
        areas = binding.get("areas_ha", {})
        blocks.extend([
            _table(["Original spatial selection", "Retained value"], [
                ["Reporting HUC12 IDs", binding.get("reporting_huc12s")],
                ["Complete upstream model-domain HUC12 IDs", binding.get("model_domain_huc12s")],
                ["Additional upstream HUC12 IDs", binding.get("upstream_huc12s")],
                ["Original topology", binding.get("topology")],
                ["Original selection method", binding.get("method")],
                ["Hydrologic interpretation", binding.get("hydrology_scope")],
            ], "Original topology and distinct geographic selections"),
            _table(["Original vector area", "Hectares"], [
                ["Complete upstream model domain", areas.get("model_domain")],
                ["Selected reporting HUC polygons before boundary intersection", areas.get("reporting_whole_hucs")],
                ["Selected reporting HUCs within the declared reporting boundary", areas.get("reporting_area")],
                ["Full selected utility footprint union", areas.get("utility_full_union")],
                ["Utility union within the reporting area", areas.get("utility_reporting_intersection")],
            ], "Vector-union areas; these are not pixel counts or native finite-output areas"),
        ])
        relations = binding.get("intake_footprint_relations", [])
        if isinstance(relations, list) and relations:
            blocks.append(_table(
                ["Original intake ID", "Original footprint ID", "Inside or on boundary", "Original distance (m)"],
                [[row.get("intake_id"), row.get("footprint_id"), row.get("inside_or_on_boundary"),
                  row.get("distance_m")] for row in relations],
                "Original point-to-footprint relations; no intake was moved or snapped"))
    else:
        summary = geographic.get("input_summary", {})
        summary = summary if isinstance(summary, dict) else {}
        control = summary.get("control", {})
        control = control if isinstance(control, dict) else {}
        blocks.extend([
            _table(["Prepared input support", "Cells", "Hectares"], [
                ["Whole computational domain", summary.get("domain_cells"), summary.get("domain_raster_ha")],
                ["Reporting intersection", summary.get("reporting_cells"), summary.get("reporting_raster_ha")],
                ["Corridor restoration", summary.get("changed_cells"), summary.get("changed_hectares")],
                ["Off-corridor control", summary.get("control_changed_cells"), control.get("changed_area_ha")],
            ], "Original pixel-centre preparation counts; no native output-validity claim"),
            _table(["Original matching property", "Retained value"], [
                ["Method actually used", control.get("method")],
                ["Target definition", control.get("target_definition")],
                ["Candidate definition", control.get("candidate_definition")],
                ["Input-domain precipitation mean (mm/year)", control.get("selected_domain_precipitation_mean_mm_year")],
                ["Original normalization scope", control.get("normalization_scope")],
                ["Changed-area and siting interpretation", summary.get("control_meaning")],
            ], "Original matching method and support; no method is inferred from a title"),
        ])
        classes = control.get("by_original_class", [])
        if isinstance(classes, list) and classes:
            blocks.extend([
                _table(["Original code", "Replacement", "Restoration cells", "Control cells", "Changed area (ha)"],
                       [[row.get("from_code"), row.get("to_code"), row.get("target_cells"),
                         row.get("control_cells"), row.get("changed_area_ha")] for row in classes],
                       "Original class and area balance across the reporting union"),
                _table(["Original code", "Restoration precipitation sum", "Control precipitation sum",
                        "Control minus restoration", "Mean absolute paired residual", "Maximum absolute paired residual"],
                       [[row.get("from_code"), row.get("target_precipitation_sum_mm_year"),
                         row.get("control_precipitation_sum_mm_year"), row.get("precipitation_sum_residual_mm_year"),
                         row.get("mean_absolute_paired_precipitation_residual_mm_year"),
                         row.get("max_absolute_paired_precipitation_residual_mm_year")] for row in classes],
                       "Original cell precipitation values and matching residuals (mm/year); not pollutant export"),
            ])
        per_huc = summary.get("per_huc", {})
        if isinstance(per_huc, dict) and per_huc:
            blocks.append(_table(
                ["Original HUC12", "Reporting cells", "Corridor cells", "Restored cells",
                 "Restored area (ha)", "Original 81 cells", "Original 82 cells"],
                [[key, row.get("reporting_cells"), row.get("corridor_cells"), row.get("changed_cells"),
                  row.get("changed_hectares"), row.get("original_class_counts", {}).get("81"),
                  row.get("original_class_counts", {}).get("82")] for key, row in sorted(per_huc.items())],
                "Original prepared restoration by HUC; this table contains no local control allocation"))
        blocks.append(
            "Equal overall class counts and treatment area do not establish equal planting within each "
            "HUC or utility footprint. Local restoration/control allocation requires its separately "
            "saved spatial accounting. Utility footprints may overlap, so their separate areas cannot "
            "be added as an unduplicated union. The declared corridor is a simulated planting choice; "
            "its per-side buffer and terrain assumptions remain in the original source statements.")
        for statement in control.get("interpretation", []):
            blocks.append(_plain(statement))
    links = [{"title": "Complete original geographic source document", "path": document["body"]["path"]}]
    for reference in references:
        relation = reference.get("geographic_reference") or {}
        if relation.get("edition_id") != geographic["edition_id"]:
            continue
        for member in reference.get("members", []):
            path = member["path"]
            if path.endswith("/matched-control/matching-summary.json"):
                links.append({"title": "Complete original matching summary", "path": path})
            elif path.endswith("/matched-control/matched-pairs.csv"):
                links.append({"title": "Every original restoration/control matching pair", "path": path})
            elif path.endswith("/matched-control/control-prepared.json"):
                links.append({"title": "Original matching implementation and source receipt", "path": path})
    blocks.append({"kind": "links", "items": links})
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
                   "Source documents selected by exact profile URI, geographic-edition reference or declared recipe/control hash"),
        ]
        if statements:
            detail.append(_table(["Original document", "Source field", "Original statement"],
                                 statements, "Original assumptions, without reinterpretation"))
        detail.append({"kind": "links", "items": links})
        result.append(["Original referenced input assumptions and recipes", detail])
    for document in scope["referenced_documents"]:
        geographic = document.get("original_geographic")
        if geographic is not None:
            result.append(["Original geographic preparation and control support",
                           _geographic_blocks(document, geographic, scope["referenced_documents"])])
        control = document.get("original_control")
        if control is not None:
            result.append(["Original matched-control input selection", _control_blocks(document, control)])
    return result
