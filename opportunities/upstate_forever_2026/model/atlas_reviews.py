"""Typed atlas review origins, immutable review history and release collections.

Uses the original SpatialReview and SpatialExports records. No model execution,
raster resampling, replacement export engine or separate review database.
"""
from __future__ import annotations

from copy import deepcopy

from .common import identifier, read_json, relative_file, verify_file
from .atlas_spatial import _file_layer, _same_units

ORIGIN_SCHEMA = "upstate.atlas-review-origin/v1"
CONTEXT_SCHEMA = "upstate.atlas-review-context/v1"
STATUSES = ("open", "addressed", "closed")


def _text(value, label, limit):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(label + " must be text within " + str(limit) + " characters")
    return value


def _atlas(workspace, delivery_id):
    delivery_id = identifier(delivery_id)
    directory = workspace.root / "deliveries" / delivery_id
    state = read_json(directory / "delivery-state.json")
    if state.get("id") != delivery_id or state.get("state") not in {"complete", "received_snapshot"}:
        raise ValueError("Open the complete original atlas release for this review")
    descriptor = state.get("files", {}).get("map_atlas_index")
    if not descriptor:
        raise ValueError("This release has no retained atlas index")
    atlas = read_json(verify_file(directory, descriptor))
    if atlas.get("schema") != "upstate.map-atlas/v1" or atlas.get("delivery_id") != delivery_id:
        raise ValueError("The original atlas index belongs to another release")
    return state, atlas, descriptor


def _panels(atlas, selections):
    if not isinstance(selections, list) or len(selections) not in (1, 2):
        raise ValueError("An atlas review selects one original panel or one original pair")
    result = []
    for item in selections:
        if not isinstance(item, dict) or set(item) != {"map_key", "panel_index"}:
            raise ValueError("Retain each original atlas map key and panel number")
        key, index = item["map_key"], item["panel_index"]
        if (not isinstance(key, str) or not key or len(key) > 250
                or isinstance(index, bool) or not isinstance(index, int) or index < 0):
            raise ValueError("Choose an original atlas panel")
        rows = [row for row in atlas["pages"] if row["map_key"] == key]
        if len(rows) != 1 or index >= len(rows[0]["panels"]):
            raise ValueError("The review's original panel is absent from its atlas")
        result.append((rows[0], rows[0]["panels"][index]))
    if len(result) == 2:
        (left, a), (right, b) = result
        if (left["family"] != right["family"] or a["title"] != b["title"]
                or bool(a["signed"]) != bool(b["signed"])
                or not left.get("scenario_run_id") or not right.get("scenario_run_id")
                or left["scenario_run_id"] == right["scenario_run_id"]
                or not _same_units(a["units"], b["units"])
                or any(a["display_scale"][key] != b["display_scale"][key]
                       for key in ("minimum", "maximum"))):
            raise ValueError("The review pair must retain the same quantity and range from two original alternatives")
    return result


def origin_for_target(target):
    lineage = target["lineage"]
    sides = target.get("sides") or [lineage]
    sources = [target["selection"]["primary"]]
    if target.get("comparison"):
        sources.append(target["selection"]["comparison"])
    return {"schema": ORIGIN_SCHEMA, "project_id": target["project_id"],
            "delivery_id": lineage["delivery_id"],
            "atlas_index_sha256": lineage["atlas_index_sha256"],
            "panels": [{"map_key": row["map_key"], "panel_index": row["panel_index"]}
                       for row in sides],
            "sources": deepcopy(sources)}


def attach(target):
    """Attach a typed draft before it enters the existing spatial editor."""
    target["selection"]["atlas_review"] = {
        "schema": CONTEXT_SCHEMA, "origin": origin_for_target(target),
        "reviewer": "", "status": "open", "comment": ""}
    return target


def validate_context(workspace, reviewer, review, context, *, previous=None, layers=None):
    """Validate a context using original records; no GIS runtime is opened here."""
    if context is None:
        if previous and previous.get("atlas_review"):
            raise ValueError("Retain this review's atlas origin or start a new independent review")
        return None
    if (not isinstance(context, dict)
            or set(context) != {"schema", "origin", "reviewer", "status", "comment"}
            or context.get("schema") != CONTEXT_SCHEMA):
        raise ValueError("Keep the complete typed atlas review context")
    if context.get("status") not in STATUSES:
        raise ValueError("Choose an open, addressed or closed review disposition")
    clean = {"schema": CONTEXT_SCHEMA,
             "origin": deepcopy(context["origin"]),
             "reviewer": _text(context["reviewer"], "Reviewer", 240),
             "status": context["status"],
             "comment": _text(context["comment"], "Review finding or resolution", 4000)}
    origin = clean["origin"]
    if (not isinstance(origin, dict)
            or set(origin) != {"schema", "project_id", "delivery_id", "atlas_index_sha256", "panels", "sources"}
            or origin.get("schema") != ORIGIN_SCHEMA
            or origin.get("project_id") != workspace.project["id"]):
        raise ValueError("The typed review origin belongs to another scientific project")
    state, atlas, descriptor = _atlas(workspace, origin["delivery_id"])
    if origin.get("atlas_index_sha256") != descriptor["sha256"]:
        raise ValueError("The review's original atlas edition changed")
    panels = _panels(atlas, origin["panels"])
    layers = reviewer._layers() if layers is None else layers
    originals, records = [], []
    for _, panel in panels:
        record = _file_layer(layers, relative_file(workspace.root, panel["source_raster"]), kind="raster")
        originals.append({"layer_id": record["public"]["id"], "band": 1})
        records.append(record)
    if origin["sources"] != originals:
        raise ValueError("The typed review changed its original atlas raster identities")
    actual = [review.get("primary")]
    if len(originals) == 2:
        actual.append(review.get("comparison"))
    elif review.get("comparison") is not None:
        raise ValueError("Start an original paired atlas review before adding another raster")
    if actual != originals:
        raise ValueError("The selected raster bands differ from this atlas review; start a new independent review")
    for original, record in zip(originals, records):
        matches = [row for row in review.get("bindings", []) if row.get("selection") == original]
        if len(matches) != 1 or any(matches[0].get(key) != record["public"][key] for key in ("sha256", "bytes")):
            raise ValueError("The saved atlas review lacks its exact original raster binding")
    if previous and previous.get("atlas_review", {}).get("origin") != origin:
        raise ValueError("A review revision must retain its original atlas panel or pair; start a new review for another selection")
    return clean


def save_context(workspace, reviewer, payload, value, *, layers=None):
    previous = None
    if value.get("previous_review_id"):
        previous = workspace._get("spatial-reviews", value["previous_review_id"])
    context = validate_context(workspace, reviewer, value, payload.get("atlas_review"),
                               previous=previous, layers=layers)
    if context is not None:
        value["atlas_review"] = context


def validate_saved_context(workspace, reviewer, review, *, layers=None):
    previous = (workspace._get("spatial-reviews", review["previous_review_id"])
                if review.get("previous_review_id") else None)
    context = validate_context(workspace, reviewer, review, review.get("atlas_review"),
                               previous=previous, layers=layers)
    if context != review.get("atlas_review"):
        raise ValueError("The retained atlas review context changed")


def collection(workspace, reviewer, delivery_id):
    """Return this release's complete review branches and existing map exports."""
    state, atlas, descriptor = _atlas(workspace, delivery_id)
    reviews = [row for row in workspace._list("spatial-reviews")
               if row.get("atlas_review", {}).get("origin", {}).get("delivery_id") == state["id"]]
    layers = reviewer._layers()
    by_id = {row["id"]: row for row in reviews}
    children = {key: [] for key in by_id}
    for row in reviews:
        previous = row.get("previous_review_id")
        if previous in children:
            children[previous].append(row["id"])
    from .spatial_exports import SpatialExports
    exporter = SpatialExports(workspace, spatial=reviewer)
    exports, export_issues = {}, []
    for path in sorted((workspace.root / "spatial-exports").glob("*/export.json")):
        try:
            value = read_json(path)
            if not isinstance(value, dict):
                raise ValueError("The map export record is not an object")
        except (OSError, ValueError, TypeError) as error:
            export_issues.append({"id": path.parent.name, "message": str(error)})
            continue
        if value.get("review_id") not in by_id:
            continue
        try:
            value = exporter.inspect(value["id"])
            item = {"id": value["id"], "state": value["state"],
                    "paper": value["selection"]["paper"], "dpi": value["selection"]["dpi"],
                    "completed_at": value.get("completed_at"),
                    "files": deepcopy(value.get("files", {}))}
        except (OSError, ValueError, KeyError, TypeError) as error:
            item = {"id": path.parent.name, "state": "unavailable", "paper": "",
                    "dpi": "", "files": {}, "issue": str(error)}
        exports.setdefault(value["review_id"], []).append(item)
    rows = []
    for review in reviews:
        issue = None
        try:
            validate_saved_context(workspace, reviewer, review, layers=layers)
        except (ValueError, OSError, KeyError, TypeError) as error:
            issue = str(error)
        origin = review["atlas_review"]["origin"]
        chain, seen, current = [], set(), review
        while current:
            if current["id"] in seen:
                raise ValueError("Atlas review history contains a cycle")
            seen.add(current["id"])
            chain.append(current["id"])
            current = by_id.get(current.get("previous_review_id"))
        rows.append({
            "id": review["id"], "title": review["title"],
            "previous_review_id": review.get("previous_review_id"),
            "root_review_id": chain[-1], "revision_depth": len(chain),
            "history": list(reversed(chain)), "children": sorted(children[review["id"]]),
            "is_head": not children[review["id"]], "mode": review["mode"],
            "context": deepcopy(review["atlas_review"]),
            "marker_count": len(review.get("markers", [])),
            "view": deepcopy(review["view"]), "scale": deepcopy(review["scale"]),
            "exports": exports.get(review["id"], []), "issue": issue})
    return {"schema": "upstate.atlas-review-collection/v1", "project_id": workspace.project["id"],
            "delivery_id": state["id"], "atlas_index_sha256": descriptor["sha256"],
            "title": atlas["title"], "export_issues": export_issues,
            "reviews": sorted(rows, key=lambda row: (
                row["root_review_id"], row["revision_depth"], row["id"]))}


def open_review(workspace, reviewer, delivery_id, review_id):
    review = workspace._get("spatial-reviews", identifier(review_id))
    context = review.get("atlas_review")
    if not context or context["origin"].get("delivery_id") != identifier(delivery_id):
        raise ValueError("Choose a saved review from this original atlas release")
    reviewer.validate_saved(review)
    origin = context["origin"]
    panels = origin["panels"]
    if len(panels) == 1:
        from .atlas_spatial import panel_target
        target = panel_target(workspace, reviewer, delivery_id,
                              panels[0]["map_key"], panels[0]["panel_index"])
    else:
        from .atlas_comparison import comparison_target
        target = comparison_target(workspace, reviewer, delivery_id, panels[0], panels[1],
                                   review["mode"] if review["mode"] in ("compare", "swipe") else "compare")
    if origin_for_target(target) != origin:
        raise ValueError("The saved review's original atlas sources changed")
    target["review_id"] = review["id"]
    target["review_context"] = deepcopy(context)
    return target

def context_text(context):
    """Readable finding and original origin for the existing print appendix."""
    if not context:
        return ""
    origin = context["origin"]
    panels = ", ".join(item["map_key"] + " / panel " + str(item["panel_index"] + 1)
                       for item in origin["panels"])
    return "\n".join([
        "Atlas review: " + context["status"],
        "Reviewer: " + (context["reviewer"] or "Unspecified"),
        "Original release: " + origin["delivery_id"],
        "Original atlas index SHA256: " + origin["atlas_index_sha256"],
        "Original panel selection: " + panels,
        "Finding or resolution: " + (context["comment"] or "No finding entered.")])
