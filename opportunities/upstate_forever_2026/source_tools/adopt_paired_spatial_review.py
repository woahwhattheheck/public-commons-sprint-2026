"""Adopt an original paired-result review into the maintained scientific Workspace.

The original paired consumer owns all raster/CSV receiving. This adapter retains
its exact originals as ordinary sources and saves a native SpatialReview; it never
turns selected result cells into a treatment or executes a model.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys

from model.common import digest, held, read_json
from model.spatial import SpatialReview
from model.workspace import Workspace
from source_tools.paired_spatial_review import (
    json_bytes, put, read_product, receive, safe,
)

SCHEMA = "upstate.paired-review-workspace-adoption/v1"
VERSION = "1.0.0"


def descriptor(path, root=None):
    path = Path(path)
    body = path.read_bytes()
    value = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    if root is not None:
        value["path"] = path.relative_to(root).as_posix()
    return value


def _verified_bytes(body, expected, label):
    if (len(body) != expected.get("bytes")
            or hashlib.sha256(body).hexdigest() != expected.get("sha256")):
        raise ValueError("Retained source bytes differ: " + label)
    return body


def _copy(source, destination, expected=None):
    body = Path(source).read_bytes()
    if expected is not None:
        _verified_bytes(body, expected, str(source))
    put(Path(destination), body)


def _atlas_input(atlas):
    root = Path(atlas).resolve(strict=True)
    if root.is_file():
        return root.parent, root
    path = root / "atlas.json"
    if not path.is_file():
        path = root / "spatial-review-atlas.json"
    if not path.is_file():
        raise ValueError("Select the complete retained original spatial atlas")
    return root, path


def _check_roots(output, workspace, atlas_root, review_path):
    output = Path(output).resolve()
    for original in (workspace.root.resolve(), atlas_root.resolve()):
        if output == original or output.is_relative_to(original) or original.is_relative_to(output):
            raise ValueError("Use a separate receiving output outside the Workspace and original atlas")
    if review_path == output or review_path.is_relative_to(output):
        raise ValueError("Keep the incoming original review outside its receiving output")
    if output.exists() and not output.is_dir():
        raise ValueError("Receiving output must be a directory")
    return output


def _retain_originals(root, atlas_bytes, review_bytes, product, analysis, analysis_bytes, original_root):
    """Retain actual selected-product artifacts and the frozen atlas source edition."""
    put(root / "original/atlas.json", atlas_bytes)
    put(root / "original/review.json", review_bytes)
    put(root / "original/analysis.json", analysis_bytes)
    band_paths = {}
    for key, artifact in sorted(analysis["artifacts"].items()):
        name = artifact["path"]
        source = safe(original_root, name)
        destination = safe(root / "original/products" / product["id"], name)
        _copy(source, destination, artifact)
        band_paths[key] = destination.relative_to(root).as_posix()

    # Source files embedded by the original producer are the exact pre-enhancement
    # report edition. Preserve those bytes; the live index may now have a new link.
    prefix = "products/" + product["id"] + "/"
    seen = set()
    for item in product.get("source_files", []):
        name = item.get("path")
        if not isinstance(name, str) or not name.startswith(prefix):
            raise ValueError("Original source member does not belong to the selected product")
        relative = name[len(prefix):]
        destination = safe(root / "original/products" / product["id"], relative)
        if relative in seen:
            raise ValueError("Original product repeats a source member")
        seen.add(relative)
        encoded = item.get("content_base64")
        if not isinstance(encoded, str):
            raise ValueError("Retain the original complete source body: " + name)
        try:
            body = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as error:
            raise ValueError("Original source body is not valid base64: " + name) from error
        put(destination, _verified_bytes(body, item, name))
    expected_names = {v["path"] for v in analysis["artifacts"].values()}
    if not expected_names <= seen or "analysis.json" not in seen:
        raise ValueError("Original atlas lacks its complete selected-product raster/source closure")
    # The separately retained analysis must also agree with the embedded edition.
    if (root / "original/products" / product["id"] / "analysis.json").read_bytes() != (root / "original/analysis.json").read_bytes():
        raise ValueError("Embedded and actual original analysis editions differ")
    return band_paths


def _entries(root, operation_id, product, analysis, band_paths):
    members = sorted(p for folder in ("native", "original")
                     for p in (root / folder).rglob("*") if p.is_file())
    descriptions = [descriptor(p, root) for p in members]
    uri = "urn:upstate:paired-review:" + operation_id
    vintage = "retained-analysis-sha256:" + product["analysis_sha256"]

    def entry(name, title, kind, path, **metadata):
        body = descriptor(root / path, root)
        return {
            "id": name, "title": title, "kind": kind, "path": path,
            "sha256": body["sha256"], "bytes": body["bytes"],
            "uri": uri + ":" + name, "vintage": vintage,
            "companions": [x for x in descriptions if x["path"] != path],
            "source_metadata": {
                "classification": "selected modeled result cells; not a treatment",
                "analysis_id": analysis["id"], "analysis_sha256": product["analysis_sha256"],
                "adoption_id": operation_id,
            },
            **metadata,
        }

    entries = [
        entry("selected-result-cells", "Returned review: selected modeled result cells",
              "raster", "native/selected-result-cells.tif", units="mask"),
        entry("selected-result-statistics", "Returned review: original cell statistics",
              "table", "native/selected-result-cells.csv"),
        entry("original-review", "Returned review: exact editable notes and selection",
              "document", "native/review.original.json"),
        entry("received-review-report", "Returned paired-result review",
              "document", "native/OPEN_REVIEW.html"),
    ]
    for pollutant in product["pollutants"]:
        key = pollutant + "--mean_reduction"
        artifact = analysis["artifacts"].get(key)
        if artifact is None:
            raise ValueError("Original paired product lacks its mean-reduction raster: " + pollutant)
        entries.append(entry(
            "original-" + pollutant + "-mean", "Original " + pollutant.replace("_", " ") + ": mean reduction",
            "raster", band_paths[key], units=artifact["units"],
        ))
    return entries


def _layer(catalogue, collection_id, source_id):
    matches = [row for row in catalogue["layers"]
               if row.get("source_collection_id") == collection_id
               and row.get("source_id") == source_id]
    if len(matches) != 1:
        raise ValueError("Retained review source is absent or ambiguous in Spatial Review: " + source_id)
    return {"layer_id": matches[0]["id"], "band": 1}


def _saved_review(workspace, spatial, source_collection, product, original_review,
                  title, pollutant, previous_review_id, existing_review_id=None):
    catalogue = spatial.catalog()
    mask = _layer(catalogue, source_collection["id"], "selected-result-cells")
    mean = _layer(catalogue, source_collection["id"], "original-" + pollutant + "-mean")
    native = spatial.describe({"selection": mask})["native"]
    note = original_review.get("note", "")
    introduction = (
        "Returned modeled-result-cell review. The right panel is 1 for selected result cells "
        "and 0 otherwise; it is not an intervention. The left panel is the original "
        + pollutant.replace("_", " ") + " mean reduction, baseline minus alternative. "
        "The panels have different units; no subtraction is performed.\n\n"
        "Original analysis: " + product["id"] + "\n\nReviewer note:\n"
    )
    available = 16000 - len(introduction)
    if len(note) > available:
        suffix = "\n[Display shortened; the complete literal note is retained in original-review and its original JSON.]"
        note = note[:max(0, available - len(suffix))] + suffix
    payload = {
        "title": title, "reference": mean, "primary": mean, "comparison": mask,
        "mode": "compare", "view": {"crs": native["crs"], "bounds": native["bounds"]},
        "scale": {"mode": "auto"}, "swipe": 50, "overlays": [], "markers": [],
        "notes": introduction + note,
    }
    if previous_review_id is not None:
        payload["previous_review_id"] = previous_review_id
    if existing_review_id is None:
        saved = spatial.save(payload)
    else:
        saved = workspace._get("spatial-reviews", existing_review_id)
        if any(saved.get(key) != value for key, value in payload.items()):
            raise ValueError("The retained adoption refers to a different saved spatial review")
    if spatial.validate_saved(saved).get("identity") != "MATCH":
        raise ValueError("The saved native review does not match its retained source edition")
    return saved


def adopt(workspace, atlas, review, output, *, title=None, pollutant=None, previous_review_id=None):
    """Receive once, retain exact original files, and save an existing native review.

    Repeating the same request uses identical source and review IDs. A changed
    original review/title/quantity/history requires a separate output directory.
    A legitimately empty review remains an explicit zero-cell selection.
    """
    atlas_root, atlas_path = _atlas_input(atlas)
    review_path = Path(review).resolve(strict=True)
    if not review_path.is_file():
        raise ValueError("Select the original saved review JSON file")
    root = _check_roots(output, workspace, atlas_root, review_path)
    atlas_bytes = atlas_path.read_bytes()
    review_bytes = review_path.read_bytes()
    atlas_body = json.loads(atlas_bytes)
    review_body = json.loads(review_bytes)
    if (atlas_body.get("schema") != "upstate.paired-spatial-atlas/v1"
            or review_body.get("schema") != "upstate.paired-spatial-review/v1"
            or review_body.get("atlas_id") != atlas_body.get("id")):
        raise ValueError("Select the original matching atlas and saved review")
    products = [p for p in atlas_body.get("products", []) if p.get("id") == review_body.get("product_id")]
    if len(products) != 1:
        raise ValueError("Saved review must select exactly one original atlas product")
    product = products[0]
    product_root = atlas_root / "products" / product["id"]
    if not product_root.is_dir() and (atlas_root / "analysis.json").is_file():
        product_root = atlas_root
    product_root, analysis = read_product(product_root)
    analysis_bytes = (product_root / "analysis.json").read_bytes()
    if (analysis["id"] != product["id"]
            or hashlib.sha256(analysis_bytes).hexdigest() != product.get("analysis_sha256")
            or json.loads(analysis_bytes) != analysis):
        raise ValueError("Retained paired analysis differs from the original atlas")
    title = title or ("Returned result-cell review — " + str(product.get("title") or product["id"][:12]))
    if not isinstance(title, str) or not title.strip() or len(title) > 240:
        raise ValueError("Use a nonempty native review title of at most 240 characters")
    title = title.strip()
    pollutant = pollutant or review_body.get("view", {}).get("pollutant") or product["pollutants"][0]
    if pollutant not in product["pollutants"]:
        raise ValueError("Choose a physical output retained in this original paired result")
    source = {
        "schema": SCHEMA, "version": VERSION,
        "project_id": workspace.project["id"], "atlas_id": atlas_body["id"],
        "analysis_id": analysis["id"],
        "atlas": {"bytes": len(atlas_bytes), "sha256": hashlib.sha256(atlas_bytes).hexdigest()},
        "review": {"bytes": len(review_bytes), "sha256": hashlib.sha256(review_bytes).hexdigest()},
        "analysis": {"bytes": len(analysis_bytes), "sha256": hashlib.sha256(analysis_bytes).hexdigest()},
        "title": title, "pollutant": pollutant, "previous_review_id": previous_review_id,
    }
    operation_id = digest(source)
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".adoption.lock", blocking=True):
        put(root / "adoption-input.json", json_bytes(source))
        # Calling the maintained receiver also validates the original grid, bands,
        # units, source checksums and unique row-major selected indices.
        band_paths = _retain_originals(
            root, atlas_bytes, review_bytes, product, analysis, analysis_bytes, product_root)
        native_summary = receive(root / "original/atlas.json", root / "original/review.json",
                                 root / "native")
        manifest = {
            "schema": "upstate.sources/v1", "title": title,
            "entries": _entries(root, operation_id, product, analysis, band_paths),
            "scope": {
                "kind": "returned-paired-result-review", "analysis_id": analysis["id"],
                "atlas_id": atlas_body["id"], "review_sha256": source["review"]["sha256"],
                "adoption_id": operation_id, "modeled_result_selection": True,
                "treatment_selection": False,
            },
            "notes": [
                "Positive original reductions are baseline minus alternative.",
                "Selected cells are modeled result cells, not changed land-cover or treatment cells.",
                "Original quantities, profile support, units and complete selected-product source edition are retained.",
                "The original atlas remains unchanged; only this chosen product and its actual files are bundled. Other products named by that original atlas are not part of this source edition.",
            ],
        }
        put(root / "model-sources.json", json_bytes(manifest))
        collection = workspace.import_sources(root / "model-sources.json")
        put(root / "source-import.json", json_bytes({
            "project_id": workspace.project["id"], "adoption_id": operation_id,
            "source_collection_id": collection["id"],
        }))
        spatial = SpatialReview(workspace)
        prior_path = root / "paired-review-adoption.json"
        prior = read_json(prior_path) if prior_path.is_file() else None
        if prior is not None and (
                prior.get("id") != operation_id or prior.get("original") != source
                or prior.get("project_id") != workspace.project["id"]
                or prior.get("source_collection_id") != collection["id"]):
            raise ValueError("Existing receiving record belongs to a different original selection")
        saved = _saved_review(workspace, spatial, collection, product, review_body,
                              title, pollutant, previous_review_id,
                              prior.get("spatial_review_id") if prior else None)
        result = {
            "schema": SCHEMA, "version": VERSION, "id": operation_id, "state": "complete",
            "project_id": workspace.project["id"],
            "source_collection_id": collection["id"],
            "source_ids": [row["id"] for row in manifest["entries"]],
            "spatial_review_id": saved["id"], "previous_review_id": previous_review_id,
            "pollutant": pollutant,
            "original": source,
            "selected_cells": native_summary["selected_cells"],
            "selected_projected_grid_area_ha": native_summary.get("selected_projected_grid_area_ha"),
            "semantics": "Selected modeled result cells; not an intervention or a new model run.",
            "native_files": [descriptor(p, root) for p in sorted((root / "native").iterdir()) if p.is_file()],
            "source_manifest": descriptor(root / "model-sources.json", root),
            "spatial_identity": spatial.validate_saved(saved),
        }
        put(root / "paired-review-adoption.json", json_bytes(result))
        # Retain the actual native receiving receipt in the existing Sources
        # collection, not a new directory that portable transfer may omit.
        receipt_manifest = {
            "schema": "upstate.sources/v1", "title": title + " · receiving record",
            "entries": [{
                "id": "paired-review-adoption-record", "kind": "document",
                "title": "Returned paired review: native source and saved-review linkage",
                "uri": "urn:upstate:paired-review:" + operation_id + ":receiving",
                "vintage": "adoption:" + operation_id, "path": "paired-review-adoption.json",
                "sha256": descriptor(root / "paired-review-adoption.json")["sha256"],
                "companions": [descriptor(root / "adoption-input.json", root),
                               descriptor(root / "model-sources.json", root),
                               descriptor(root / "source-import.json", root)] + [
                                   descriptor(p, root) for folder in ("native", "original")
                                   for p in sorted((root / folder).rglob("*")) if p.is_file()
                               ],
            }],
            "scope": {"adoption_id": operation_id, "source_collection_id": collection["id"],
                      "spatial_review_id": saved["id"]},
        }
        put(root / "receiving-record.sources.json", json_bytes(receipt_manifest))
        receipt_collection = workspace.import_sources(root / "receiving-record.sources.json")
        final = {**result, "receipt_source_collection_id": receipt_collection["id"]}
        put(root / "result.json", json_bytes(final))
        return final


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--atlas", required=True)
    parser.add_argument("--review", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--title")
    parser.add_argument("--pollutant", choices=("nitrogen_export", "phosphorus_export", "sediment_export"))
    parser.add_argument("--previous-review-id")
    args = parser.parse_args(argv)
    try:
        result = adopt(Workspace(args.workspace), args.atlas, args.review, args.output,
                       title=args.title, pollutant=args.pollutant,
                       previous_review_id=args.previous_review_id)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(type(error).__name__ + ": " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
