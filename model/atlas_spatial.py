"""Open one retained atlas panel in the existing native spatial workbench."""
from __future__ import annotations

from copy import deepcopy
import json
import math

from .common import identifier, read_json, relative_file, verify_file

DIMENSIONLESS = {"dimensionless", "dimensionless (0-1)", "dimensionless (0–1)"}
SOURCE_ROLES = {
    "future_sediment_loss": ("drinking_water",),
    "future_nutrient_runoff": ("drinking_water",),
    "critical_drinking_water": ("drinking_water", "protected_lands"),
    "high_quality_waters": ("high_quality_waters",),
}


def _finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(label + " must contain finite numbers")
    return value


def _same_units(left, right):
    return left == right or left in DIMENSIONLESS and right in DIMENSIONLESS


def _file_layer(layers, path, *, kind):
    """Resolve an original file through its existing authenticated catalogue."""
    matches = []
    for record in layers.values():
        if record["public"]["kind"] != kind or record["source"] is not None:
            continue
        original = relative_file(record["scope"], record["file"]["path"])
        if original.resolve() == path.resolve():
            matches.append(record)
    if not matches:
        raise ValueError("This atlas file is absent from the current native spatial catalogue")
    identities = {(row["public"]["sha256"], row["public"]["bytes"]) for row in matches}
    if len(identities) != 1:
        raise ValueError("The atlas file has conflicting retained source identities")
    return sorted(matches, key=lambda row: row["public"]["id"])[0]


def _source_layer(layers, choice, source):
    matches = [row for row in layers.values()
               if row["public"]["kind"] == "vector"
               and row["public"].get("source_collection_id") == choice["source_collection_id"]
               and row["public"].get("source_id") == choice["source_id"]
               and row["public"]["sha256"] == source["sha256"]]
    if len(matches) != 1:
        raise ValueError("Restore the atlas's exact retained vector edition before inspecting this sheet")
    return matches[0]


def _vector(record, *, label, layer=None, where=None, style="solid", width=1):
    selection = {"layer_id": record["public"]["id"]}
    if layer:
        selection["layer"] = layer
    if where:
        selection["where"] = deepcopy(where)
    return {"selection": selection, "label": label, "visible": True,
            "style": style, "width": width, "opacity": 1}


def panel_target(workspace, reviewer, delivery_id, map_key, panel_index):
    """Return a read-only native review draft from a verified original atlas index.

    Raster values, masks, physical units and scales are retained. The existing
    SpatialReview service owns rendering, point queries, annotations and saving.
    """
    delivery_id = identifier(delivery_id)
    if not isinstance(map_key, str) or not map_key or len(map_key) > 250:
        raise ValueError("Choose a retained atlas map key")
    if isinstance(panel_index, bool) or not isinstance(panel_index, int) or panel_index < 0:
        raise ValueError("Choose a retained atlas panel number")
    directory = workspace.root / "deliveries" / delivery_id
    state = read_json(directory / "delivery-state.json")
    if state.get("id") != delivery_id or state.get("state") not in {"complete", "received_snapshot"}:
        raise ValueError("Finish the complete atlas delivery before opening its native spatial layers")
    descriptor = state.get("files", {}).get("map_atlas_index")
    if not descriptor:
        raise ValueError("This delivery predates the retained atlas index; revise its selection to create an atlas")
    atlas = read_json(verify_file(directory, descriptor))
    if atlas.get("schema") != "upstate.map-atlas/v1" or atlas.get("delivery_id") != delivery_id:
        raise ValueError("The retained atlas index belongs to another delivery")
    matches = [row for row in atlas["pages"] if row["map_key"] == map_key]
    if len(matches) != 1 or panel_index >= len(matches[0]["panels"]):
        raise ValueError("The selected map or pollutant panel is absent from this atlas")
    page = matches[0]
    panel = page["panels"][panel_index]
    layers = reviewer._layers()
    record = _file_layer(layers, relative_file(workspace.root, panel["source_raster"]), kind="raster")
    primary = {"layer_id": record["public"]["id"], "band": 1}
    description = reviewer.describe({"selection": primary})
    native = description["native"]
    if not _same_units(panel["units"], native["units"]):
        raise ValueError("The atlas display units differ from the original raster units; restore its exact original artifact")
    if native["scales"][0] != 1 or native["offsets"][0] != 0:
        raise ValueError("This atlas raster has a nonidentity band scale or offset; its original print and inspection values must agree")
    scale = panel.get("display_scale")
    if not isinstance(scale, dict) or not _same_units(scale.get("units"), panel["units"]):
        raise ValueError("This panel needs its original physical display scale")
    low, high = (_finite(scale.get(name), "Atlas display scale") for name in ("minimum", "maximum"))
    if low >= high or bool(scale.get("signed")) != bool(panel.get("signed")):
        raise ValueError("The retained atlas scale does not match its panel semantics")
    if panel.get("signed") and not low < 0 < high or not panel.get("signed") and low != 0:
        raise ValueError("Signed atlas panels center on zero; export and priority panels start at zero")

    source_context = atlas.get("source_context") or {}
    choices = source_context.get("overlays", state["selection"].get("overlays", {}))
    overlays = []
    grid = workspace.get_grid(atlas["grid_id"])
    grid_directory = workspace.root / "grids" / grid["id"]
    boundary_record = _file_layer(layers, relative_file(grid_directory, grid["files"]["reporting_area"]["path"]), kind="vector")
    overlays.append(_vector(boundary_record, label="Reporting-area boundary", width=1.25))
    used_rendered = set()
    rendered = page.get("overlays", [])

    for role in SOURCE_ROLES.get(page["family"], ()):
        choice = choices.get(role)
        if not choice:
            if role == "protected_lands":
                continue
            raise ValueError("The retained atlas lost its " + role.replace("_", " ") + " source choice")
        candidates = [i for i, row in enumerate(rendered)
                      if i not in used_rendered
                      and any(layer["public"]["sha256"] == row.get("source", {}).get("sha256")
                              and layer["public"].get("source_collection_id") == choice["source_collection_id"]
                              and layer["public"].get("source_id") == choice["source_id"]
                              for layer in layers.values())]
        if not candidates:
            raise ValueError("The atlas source overlay no longer matches its recorded edition")
        index = candidates[0]
        used_rendered.add(index)
        original = rendered[index]
        source_record = _source_layer(layers, choice, original["source"])
        overlays.append(_vector(source_record, label=original["label"],
            layer=choice.get("layer"), where=choice.get("where"),
            style="dash" if role == "high_quality_waters" else "dot" if role == "protected_lands" else "solid",
            width=.75 if role == "protected_lands" else 1))

    context_notes = []
    receiving_context = None
    remaining = [row for i, row in enumerate(rendered) if i not in used_rendered]
    for original in remaining:
        source = original.get("source") or {}
        if source.get("analysis_id") or source.get("plan_id"):
            receiving = state.get("receiving_waters", {})
            identity = receiving.get("identity", {})
            item = state["files"].get("receiving_water_analysis_receiving_waters_gpkg")
            if (not item or source.get("analysis_id") != identity.get("analysis_id")
                    or source.get("plan_id") != identity.get("plan_id")
                    or page["family"] not in receiving.get("families", {})):
                raise ValueError("The receiving-water overlay differs from the retained native analysis and plan")
            receiving_record = _file_layer(layers, relative_file(directory, item["path"]), kind="vector")
            overlays.append(_vector(receiving_record, label=original["label"], layer="receiving_waters",
                where={"kind": "family_union", "family": page["family"]}, style="dash", width=1.25))
            receiving_context = {"identity": deepcopy(identity),
                                 "quantity_scope": receiving.get("quantity_scope"),
                                 "family": page["family"], "method": source.get("method")}
            continue
        receptor = state.get("receptor_inventory", {})
        network = source_context.get("resolved_receptor_network") or receptor.get("network_source")
        role = {"critical_drinking_water": "drinking_water",
                "high_quality_waters": "high_quality_waters"}.get(page["family"])
        item = state["files"].get("receptor_geopackage")
        if not role or not item or not network or source != network:
            raise ValueError("A rendered atlas overlay has no exact native spatial source binding")
        receptor_record = _file_layer(layers, relative_file(directory, item["path"]), kind="vector")
        overlays.append(_vector(receptor_record, label=original["label"] + " · full retained areas",
                                layer="contributing_areas", where={"role": role}, style="dash", width=1.25))
        context_notes.append("Contributing-area outlines use the complete retained native polygons; the printed atlas clips these outlines to the reporting area. The reporting boundary and the original masked raster remain visible.")

    bindings = []
    descriptions = {primary["layer_id"]: description}
    for selected in [primary] + [overlay["selection"] for overlay in overlays]:
        selected_record = layers[selected["layer_id"]]
        described = descriptions.get(selected["layer_id"])
        if described is None:
            described = reviewer.describe({"selection": selected})
        bindings.append({"selection": deepcopy(selected),
                         "sha256": selected_record["public"]["sha256"],
                         "bytes": selected_record["public"]["bytes"],
                         "kind": selected_record["public"]["kind"]})
        if described["native"]["kind"] == "vector" and "layer" not in selected:
            selected["layer"] = described["native"]["selected_layer"]
            bindings[-1]["selection"] = deepcopy(selected)

    lineage = {"delivery_id": delivery_id, "map_key": map_key, "atlas_page": page["page"],
               "panel_index": panel_index, "panel_title": panel["title"],
               "source_raster": panel["source_raster"], "source_sha256": record["public"]["sha256"],
               "baseline_run_id": atlas["baseline_run_id"], "scenario_run_id": page.get("scenario_run_id"),
               "source_report_id": atlas.get("source_report_id"),
               "atlas_index_sha256": descriptor["sha256"], "receiving_water": receiving_context}
    notes = "\n".join([
        "Original atlas panel: " + page["title"] + " / " + panel["title"],
        "Native raster units: " + str(native["units"]) + "; atlas units: " + panel["units"] + ". Values use the retained raster directly.",
        "Original fixed display range: " + str(low) + " to " + str(high) + ". " + str(scale.get("label", "")),
        "The spatial workbench uses its monochrome renderer and the same numeric range. Point inspection reads original pixels.",
        *context_notes, "Atlas source: " + json.dumps(lineage, ensure_ascii=False, sort_keys=True),
    ])
    selection = {"title": (atlas["title"] + " / " + page["title"] + " / " + panel["title"])[:240],
                 "reference": deepcopy(primary), "primary": primary, "comparison": None,
                 "mode": "single", "view": {"crs": native["crs"], "bounds": native["bounds"]},
                 "scale": {"mode": "fixed", "minimum": low, "maximum": high}, "swipe": 50,
                 "overlays": overlays, "markers": [], "notes": notes}
    return {"kind": "atlas-panel", "project_id": workspace.project["id"], "selection": selection,
            "bindings": bindings, "lineage": lineage, "title": page["title"], "panel": panel["title"],
            "units": panel["units"], "native_units": native["units"], "scale": deepcopy(scale),
            "context_notes": context_notes}
