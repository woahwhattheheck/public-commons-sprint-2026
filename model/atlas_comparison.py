"""Compare matching retained atlas panels through the original spatial renderer."""
from __future__ import annotations

from copy import deepcopy
import json

from .atlas_spatial import _same_units, panel_target
from .common import identifier, read_json, verify_file


def _choice(value):
    if not isinstance(value, dict) or set(value) != {"map_key", "panel_index"}:
        raise ValueError("Choose one retained map and panel for each side")
    return value


def _panel(atlas, choice):
    rows = [row for row in atlas["pages"] if row["map_key"] == choice["map_key"]]
    if len(rows) != 1:
        raise ValueError("Choose a panel present in this retained atlas")
    return rows[0], rows[0]["panels"][choice["panel_index"]]


def _key(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def comparison_target(workspace, reviewer, delivery_id, left, right, mode="compare"):
    """Open two original scenario panels without recalculating either raster."""
    if mode not in {"compare", "swipe"}:
        raise ValueError("Choose linked side-by-side or swipe comparison")
    left, right = _choice(left), _choice(right)
    if left == right:
        raise ValueError("Choose two different alternative panels")
    delivery_id = identifier(delivery_id)
    first = panel_target(workspace, reviewer, delivery_id, left["map_key"], left["panel_index"])
    second = panel_target(workspace, reviewer, delivery_id, right["map_key"], right["panel_index"])
    directory = workspace.root / "deliveries" / delivery_id
    state = read_json(directory / "delivery-state.json")
    atlas = read_json(verify_file(directory, state["files"]["map_atlas_index"]))
    if any(target["lineage"]["atlas_index_sha256"] != state["files"]["map_atlas_index"]["sha256"]
           for target in (first, second)):
        raise ValueError("The retained atlas edition changed while opening this comparison; choose its panels again")
    left_page, left_panel = _panel(atlas, left)
    right_page, right_panel = _panel(atlas, right)
    if (left_page["family"] != right_page["family"]
            or left_panel["title"] != right_panel["title"]
            or bool(left_panel["signed"]) != bool(right_panel["signed"])):
        raise ValueError("Compare the same map family, pollutant and original physical quantity")
    left_run, right_run = left_page.get("scenario_run_id"), right_page.get("scenario_run_id")
    if not left_run or not right_run or left_run == right_run:
        raise ValueError("Choose this same panel from two different retained alternatives")
    if not _same_units(first["units"], second["units"]):
        raise ValueError("Both panels must retain compatible original physical units")
    if any(first["scale"][name] != second["scale"][name] for name in ("minimum", "maximum")):
        raise ValueError("Both panels must retain the exact common atlas display range")
    if first["selection"]["primary"] == second["selection"]["primary"]:
        raise ValueError("Choose two separately retained original scenario rasters")

    descriptions = [reviewer.describe({"selection": target["selection"]["primary"]})
                    for target in (first, second)]
    a, b = [row["native"] for row in descriptions]
    from pyproj import CRS
    from rasterio.transform import Affine
    aligned = (CRS.from_user_input(a["crs"]) == CRS.from_user_input(b["crs"])
               and a["width"] == b["width"] and a["height"] == b["height"]
               and Affine(*a["transform"]).almost_equals(Affine(*b["transform"]), precision=1e-9))
    if not aligned or a.get("categorical") or b.get("categorical"):
        raise ValueError("Both panels must retain the same original continuous-data grid, affine placement and dimensions")
    if not _same_units(a["units"], b["units"]):
        raise ValueError("The original raster bands use incompatible physical units")

    overlays, seen = [], set()
    for target in (first, second):
        for overlay in target["selection"]["overlays"]:
            identity = _key(overlay["selection"])
            if identity not in seen:
                seen.add(identity)
                overlays.append(deepcopy(overlay))
    bindings, seen = [], {}
    for target in (first, second):
        for binding in target["bindings"]:
            identity = _key(binding["selection"])
            if identity in seen and seen[identity] != binding:
                raise ValueError("The pair has conflicting retained native source bindings")
            if identity not in seen:
                seen[identity] = binding
                bindings.append(deepcopy(binding))
    labels = [left_page.get("subtitle") or left_run, right_page.get("subtitle") or right_run]
    baseline = atlas["baseline_run_id"]
    signed = bool(left_panel["signed"])
    interpretation = (
        "Both rasters show each selected alternative minus the same original baseline " + baseline
        + ". Negative values mean lower modeled export than that baseline; positive values mean higher modeled export."
        if signed else
        "Both rasters show the same original absolute quantity. Their retained values are displayed directly.")
    lineage = {
        "delivery_id": delivery_id, "grid_id": atlas["grid_id"], "family": left_page["family"],
        "quantity": left_panel["title"], "signed": signed, "baseline_run_id": baseline,
        "source_report_id": atlas.get("source_report_id"),
        "left": deepcopy(first["lineage"]), "right": deepcopy(second["lineage"]),
        "atlas_index_sha256": state["files"]["map_atlas_index"]["sha256"],
    }
    notes = "\n".join([
        "Atlas comparison: " + left_panel["title"],
        "Left source: " + labels[0] + " [" + left_run + "]",
        "Right source: " + labels[1] + " [" + right_run + "]",
        interpretation,
        "The two original rasters retain their individual nodata masks. Linked and swipe views use the exact common physical display range without subtraction or rescaling.",
        "Original shared range: " + str(first["scale"]["minimum"]) + " to "
        + str(first["scale"]["maximum"]) + " " + first["units"] + ".",
        "Atlas comparison source: " + _key(lineage),
    ])
    context_notes = list(dict.fromkeys(first["context_notes"] + second["context_notes"]))
    selection = deepcopy(first["selection"])
    selection.update(
        title=(atlas["title"] + " / " + left_panel["title"] + " / alternatives comparison")[:240],
        comparison=deepcopy(second["selection"]["primary"]), mode=mode,
        overlays=overlays, notes=notes + ("\n" + "\n".join(context_notes) if context_notes else ""),
    )
    return {
        "kind": "atlas-panel", "project_id": workspace.project["id"], "selection": selection,
        "bindings": bindings, "lineage": deepcopy(first["lineage"]), "comparison": lineage,
        "title": left_page["title"], "panel": left_panel["title"],
        "units": first["units"], "native_units": first["native_units"], "scale": deepcopy(first["scale"]),
        "context_notes": [interpretation, *context_notes],
        "sides": [
            {"slot": "left", "label": labels[0], "scenario_run_id": left_run,
             "map_key": left["map_key"], "panel_index": left["panel_index"], "atlas_page": left_page["page"]},
            {"slot": "right", "label": labels[1], "scenario_run_id": right_run,
             "map_key": right["map_key"], "panel_index": right["panel_index"], "atlas_page": right_page["page"]},
        ],
    }
