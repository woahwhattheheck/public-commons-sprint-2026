"""Printable map packs from immutable native spatial reviews.

The existing scientific Workspace owns source data, saved selections and export
artifacts. Operator task identities remain in the original operator queue.
"""
from __future__ import annotations
import csv
import hashlib
import html
import importlib.metadata
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import tempfile
import zipfile

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, now, read_json, verify_file)
from .spatial import SpatialReview, _integer

FORMAT = "upstate.spatial-export/v1"
PACK_FORMAT = "upstate.spatial-map-pack/v1"
OUTPUTS = {
    "map_pdf": ("map.pdf", "application/pdf", "Printable map and complete review appendix"),
    "map_svg": ("map.svg", "image/svg+xml", "Vector map figure"),
    "map_png": ("map.png", "image/png", "Map figure at selected paper size and DPI"),
    "review": ("review.json", "application/json", "Original saved spatial review"),
    "provenance": ("provenance.json", "application/json", "Native source and rendering provenance"),
    "annotations": ("annotations.json", "application/json", "Exact native point annotations"),
    "annotation_table": ("annotations.csv", "text/csv", "Point values and original feature attributes"),
    "annotation_geometries": ("annotation-geometries.jsonl", "application/x-ndjson",
                              "Original annotation geometries with retained source identities"),
    "overlay_features": ("overlay-features.jsonl", "application/x-ndjson",
                         "Printed viewport features and original attributes"),
    "application_source": ("application-source.zip", "application/zip",
                           "Exact application source used for this map pack"),
    "receiving": ("README.md", "text/markdown", "Map pack receiving and reuse"),
    "index": ("index.html", "text/html", "Local map pack index"),
    "pack_manifest": ("PACK.json", "application/json", "Map pack file inventory"),
    "bundle": ("map-pack.zip", "application/zip", "Complete printable map pack"),
}
CSV_FIELDS = (
    "marker_index", "marker_label", "point_x", "point_y", "point_crs", "kind",
    "layer", "selection_json", "source_sha256", "row", "column", "inside", "valid",
    "reason", "raw_value_text", "value_text", "units", "scale", "offset", "nodata_text",
    "pixel_area_ha", "cell_bounds_json", "feature_id", "properties_json",
    "properties_text_json", "geometry_id", "match", "distance", "distance_crs",
    "truncated", "direction",
)


def _member(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Map pack members use canonical relative paths")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in (".", "..") for part in path.parts) or str(path) != value:
        raise ValueError("Map pack members stay within their original export")
    return path


def _selection(payload):
    if not isinstance(payload, dict) or set(payload) - {"review_id", "paper", "dpi"}:
        raise ValueError("Choose the saved review, paper and print DPI")
    paper = payload.get("paper", "letter")
    dpi = _integer(payload.get("dpi", 220), "Print DPI", minimum=150, maximum=300)
    if paper not in ("letter", "a4") or dpi not in (150, 220, 300):
        raise ValueError("Choose Letter or A4 and 150, 220 or 300 DPI")
    return {"review_id": identifier(payload.get("review_id")), "paper": paper, "dpi": dpi}


def _identity(value):
    return {key: value[key] for key in (
        "schema", "project_id", "review_id", "review_sha256", "selection", "renderer")}


def _version(package):
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


def _application_identity():
    from .portable import _application
    from matplotlib import font_manager, ft2font
    import matplotlib
    root = Path(__file__).resolve().parent.parent
    members = {}
    for path in _application(root):
        relative = path.relative_to(root).as_posix()
        _member(relative)
        members[relative] = {"bytes": path.stat().st_size, "sha256": file_digest(path)}
    for required in ("model/spatial.py", "model/spatial_exports.py", "model/cartography.py",
                     "model/workspace.py", "model/common.py", "operator/server.py"):
        if required not in members:
            raise ValueError("The native map renderer requires its complete application source: " + required)
    font = Path(font_manager.findfont("DejaVu Sans", fallback_to_default=False))
    return {"name": "original Workspace spatial review / Matplotlib PDF, SVG and Agg",
            "python": platform.python_version(), "implementation": platform.python_implementation(),
            "libraries": {name: _version(name) for name in (
                "matplotlib", "numpy", "Pillow", "pyproj", "Shapely", "rasterio", "Fiona")},
            "matplotlib": matplotlib.__version__, "freetype": ft2font.__freetype_version__,
            "font": {"name": "DejaVu Sans", "filename": font.name,
                     "bytes": font.stat().st_size, "sha256": file_digest(font)},
            "application_sources": members,
            "sampling": "same native nearest-neighbour path as SpatialReview.frame",
            "print_resource_limit": {"maximum_dimension": 4096,
                                     "maximum_samples_per_panel": 10 * 1024 * 1024}}


def _fsync(path):
    with Path(path).open("rb") as source:
        os.fsync(source.fileno())


def _zip(path, root, records, *, manifest=None):
    """Copy exact declared bytes and verify the received ZIP before publication."""
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=3, allowZip64=True) as archive:
        for name, expected in sorted(records.items()):
            _member(name)
            source_path = Path(root).joinpath(*PurePosixPath(name).parts)
            if source_path.is_symlink():
                raise ValueError("Map pack members are original regular files")
            before = source_path.stat()
            h = hashlib.sha256()
            size = 0
            with source_path.open("rb") as source, archive.open(name, "w", force_zip64=True) as output:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    output.write(block)
                    h.update(block)
                    size += len(block)
            after = source_path.stat()
            signature = lambda st: (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
            if signature(before) != signature(after) or size != expected["bytes"] or h.hexdigest() != expected["sha256"]:
                raise ValueError("Original map pack member changed: " + name)
        if manifest is not None:
            archive.writestr("SOURCE.json", canonical(manifest) + b"\n")
    _fsync(path)
    with zipfile.ZipFile(path) as archive:
        expected_names = set(records) | ({"SOURCE.json"} if manifest is not None else set())
        if set(archive.namelist()) != expected_names or len(archive.namelist()) != len(expected_names):
            raise ValueError("Received map pack member inventory differs")
        for name, expected in records.items():
            h, size = hashlib.sha256(), 0
            with archive.open(name) as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    h.update(block)
                    size += len(block)
            if size != expected["bytes"] or h.hexdigest() != expected["sha256"]:
                raise ValueError("Received map pack member differs: " + name)


def _json_text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


class SpatialExports:
    def __init__(self, workspace, *, spatial=None):
        self.workspace = workspace
        self.spatial = spatial or SpatialReview(workspace)

    def _directory(self, key):
        return self.workspace.root / "spatial-exports" / identifier(key)

    def _review(self, key):
        review = self.workspace._get("spatial-reviews", identifier(key))
        self.spatial.validate_saved(review)
        return review

    def _validate_record(self, value, *, directory=None, verify=False, verified_members=None):
        key = identifier(value.get("id"))
        if value.get("schema") != FORMAT or value.get("project_id") != self.workspace.project["id"]:
            raise ValueError("Map export belongs to another original scientific project")
        if digest(_identity(value)) != key or _selection(value.get("selection")) != value["selection"]:
            raise ValueError("Map export changed its original content identity")
        if value["review_id"] != value["selection"]["review_id"]:
            raise ValueError("Map export changed its selected saved review")
        review = self.workspace._get("spatial-reviews", value["review_id"])
        if verify or verified_members is not None:
            self.spatial.validate_saved(review, verified_members=verified_members)
        if value.get("state") != "complete":
            if value.get("state") not in {"rendering", "failed"}:
                raise ValueError("Map export has an unknown original state")
            return value
        if set(value.get("files", {})) != set(OUTPUTS):
            raise ValueError("Completed map export lacks its complete native file set")
        contents = Path(directory) if directory is not None else self._directory(key) / "files"
        if contents.is_symlink():
            raise ValueError("Map export content cannot be a directory alias")
        for name, (filename, content_type, _) in OUTPUTS.items():
            item = value["files"][name]
            relative = _member(item.get("path"))
            if relative.as_posix() != "files/" + filename or item.get("filename") != filename or item.get("content_type") != content_type:
                raise ValueError("Map export member selection changed: " + name)
            if isinstance(item.get("bytes"), bool) or not isinstance(item.get("bytes"), int) or item["bytes"] < 0:
                raise ValueError("Map export member length differs")
            if not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
                raise ValueError("Map export member hash differs")
            if verified_members is not None:
                original_name = "workspace/spatial-exports/" + key + "/" + item["path"]
                archived = verified_members.get(original_name)
                if archived is None or any(archived.get(k) != item[k] for k in ("bytes", "sha256")):
                    raise ValueError("Receiving lacks the original map export member: " + original_name)
            elif verify:
                verify_file(contents, {**item, "path": filename})
        if value["files"]["review"]["sha256"] != value["review_sha256"]:
            raise ValueError("Map export has a different saved-review body")
        if verify or verified_members is not None:
            original_path = self.workspace.root / "spatial-reviews" / (value["review_id"] + ".json")
            if file_digest(original_path) != value["review_sha256"]:
                raise ValueError("Map export saved-review source differs")
            original_review = read_json(contents / "review.json")
            if digest(original_review) != value["review_id"]:
                raise ValueError("Exported saved review changed its original content ID")
            manifest = read_json(contents / "PACK.json")
            if manifest.get("schema") != PACK_FORMAT or manifest.get("export_id") != key:
                raise ValueError("Map pack manifest belongs to another export")
            required = {filename for name, (filename, _, _) in OUTPUTS.items()
                        if name not in {"pack_manifest", "bundle"}}
            if set(manifest.get("files", {})) != required:
                raise ValueError("Map pack manifest lacks its original complete file inventory")
            for name, (filename, _, _) in OUTPUTS.items():
                if name in {"pack_manifest", "bundle"}:
                    continue
                member = manifest["files"][filename]
                if any(member.get(k) != value["files"][name][k] for k in ("bytes", "sha256")):
                    raise ValueError("Map pack manifest changed its declared member: " + filename)
            provenance = read_json(contents / "provenance.json")
            if provenance.get("export_id") != key or provenance.get("review") != review or provenance.get("summary") != value["summary"]:
                raise ValueError("Map export source and rendered summary differ")
            if provenance.get("renderer") != value["renderer"]:
                raise ValueError("Map export renderer identity differs")
        return value

    def inspect(self, key, *, verify=False, verified_members=None):
        key = identifier(key)
        value = read_json(self._directory(key) / "export.json")
        if value.get("id") != key:
            raise ValueError("Map export record differs from its original directory")
        return self._validate_record(value, verify=verify, verified_members=verified_members)


    def _capture_overlays(self, review, stage, frame):
        bounds = frame["view"]["bounds"]
        # A quarter of one actual output pixel in view units. Original analytical
        # geometry and attributes remain in the source and point geometry files.
        tolerance = min((bounds[2] - bounds[0]) / frame["size"]["width"],
                        (bounds[3] - bounds[1]) / frame["size"]["height"]) / 4
        summaries = []
        with (stage / "overlay-features.jsonl").open("x", encoding="utf-8", newline="\n") as output:
            for index, overlay in enumerate(review.get("overlays", []), 1):
                description = self.spatial.describe({"selection": overlay["selection"]})
                summary = {"index": index, "label": overlay["label"],
                           "selection": overlay["selection"], "visible": overlay["visible"],
                           "source_sha256": description["layer"]["sha256"], "returned": 0,
                           "display_tolerance": tolerance, "view_crs": frame["view"]["crs"],
                           "style": {"style": overlay["style"], "width_css_pixels": overlay["width"],
                                     "width_points": overlay["width"] * 72 / 96,
                                     "opacity": overlay["opacity"]},
                           "meaning": "original bbox sequence, exact typed filter, display clip/simplification"}
                summaries.append(summary)
                if not overlay["visible"]:
                    continue
                offset = 0
                while offset is not None:
                    page = self.spatial.overlay({"selection": overlay["selection"],
                        "view": frame["view"], "offset": offset, "limit": 1000, "tolerance": tolerance})
                    if page["source_sha256"] != summary["source_sha256"] or page["offset"] != offset:
                        raise ValueError("Original vector page changed during map capture")
                    for feature in page["features"]:
                        output.write(_json_text({"overlay_index": index,
                            "selection": page["selection"], "source_sha256": page["source_sha256"],
                            "feature": feature}) + "\n")
                    summary["returned"] += page["returned"]
                    following = page["next_offset"]
                    if following is not None and (isinstance(following, bool) or not isinstance(following, int) or following <= offset):
                        raise ValueError("Original vector continuation did not advance")
                    # Empty feature pages may have a valid native continuation.
                    offset = following
            output.flush()
            os.fsync(output.fileno())
        return summaries

    def _capture_annotations(self, review, stage):
        visible = [overlay["selection"] for overlay in review.get("overlays", []) if overlay["visible"]]
        geometries, markers, counts = set(), [], {"markers": 0, "unique_geometries": 0,
                                                  "point_groups_truncated": 0}
        with (stage / "annotation-geometries.jsonl").open("x", encoding="utf-8", newline="\n") as geometry_out, \
                (stage / "annotations.csv").open("x", encoding="utf-8", newline="") as csv_out:
            writer = csv.DictWriter(csv_out, fieldnames=CSV_FIELDS, lineterminator="\n")
            writer.writeheader()
            for index, marker in enumerate(review.get("markers", []), 1):
                result = self.spatial.point({"primary": review.get("primary"),
                    "comparison": review.get("comparison"),
                    "point": {"x": marker["x"], "y": marker["y"], "crs": review["view"]["crs"]},
                    "overlays": visible, "tolerance": 0})
                base = {"marker_index": index, "marker_label": marker["label"],
                        "point_x": repr(marker["x"]), "point_y": repr(marker["y"]),
                        "point_crs": review["view"]["crs"]}
                rows = 0
                for key in ("primary", "comparison"):
                    pixel = result.get(key)
                    if pixel is None:
                        continue
                    row = {**base, "kind": "pixel", "layer": key,
                           "selection_json": _json_text(pixel["selection"]),
                           "source_sha256": pixel["source_sha256"],
                           "cell_bounds_json": _json_text(pixel.get("cell_bounds"))}
                    for field in ("row", "column", "inside", "valid", "reason", "raw_value_text",
                                  "value_text", "units", "scale", "offset", "nodata_text", "pixel_area_ha"):
                        row[field] = pixel.get(field)
                    writer.writerow(row)
                    rows += 1
                if result.get("difference"):
                    delta = result["difference"]
                    writer.writerow({**base, "kind": "difference", "layer": "right source minus left source",
                                     "value_text": delta["value_text"], "units": delta["units"],
                                     "direction": delta["direction"],
                                     "source_sha256": _json_text({
                                         key: result[key]["source_sha256"] for key in ("primary", "comparison")})})
                    rows += 1
                for group in result["features"]:
                    if group["truncated"]:
                        counts["point_groups_truncated"] += 1
                    for feature in group["features"]:
                        geometry = {"selection": group["selection"],
                                    "source_sha256": group["layer"]["sha256"],
                                    "feature_id": feature["id"], "geometry_crs": feature["geometry_crs"],
                                    "geometry": feature.pop("geometry")}
                        for key in ("source_geometry_json", "source_geometry_format", "source_feature_index",
                                    "source_id_basis", "geometry_reader", "geometry_operations"):
                            if key in feature:
                                geometry[key] = feature[key]
                        feature.pop("source_geometry_json", None)
                        geometry_id = digest(geometry)
                        if geometry_id not in geometries:
                            geometries.add(geometry_id)
                            geometry_out.write(_json_text({"id": geometry_id, **geometry}) + "\n")
                        feature["geometry_id"] = geometry_id
                        feature["geometry_file"] = "annotation-geometries.jsonl"
                        writer.writerow({**base, "kind": "feature", "layer": group["layer"]["title"],
                            "selection_json": _json_text(group["selection"]),
                            "source_sha256": group["layer"]["sha256"], "feature_id": feature["id"],
                            "properties_json": feature["properties_json"],
                            "properties_text_json": _json_text(feature["properties_text"]),
                            "geometry_id": geometry_id, "match": feature.get("match"),
                            "distance": feature.get("distance"), "distance_crs": feature.get("distance_crs"),
                            "truncated": group["truncated"]})
                        rows += 1
                    if not group["features"]:
                        writer.writerow({**base, "kind": "feature_query", "layer": group["layer"]["title"],
                            "selection_json": _json_text(group["selection"]),
                            "source_sha256": group["layer"]["sha256"], "truncated": group["truncated"],
                            "reason": "no original covering feature"})
                        rows += 1
                if rows == 0:
                    writer.writerow({**base, "kind": "annotation", "reason": "saved geographic annotation"})
                markers.append({"index": index, "label": marker["label"], "inspection": result})
                counts["markers"] += 1
            for output in (geometry_out, csv_out):
                output.flush()
                os.fsync(output.fileno())
        counts["unique_geometries"] = len(geometries)
        atomic_json(stage / "annotations.json", {
            "schema": "upstate.spatial-map-annotations/v1", "review_id": review["id"],
            "point_tolerance": 0, "point_crs": review["view"]["crs"],
            "meaning": "original native pixels and covering features at each saved annotation",
            "geometry_file": "annotation-geometries.jsonl", "counts": counts, "markers": markers})
        return counts

    def _readme(self, review, record):
        return (
            "# " + review["title"] + "\n\n"
            "Open index.html for the map and downloads. map.pdf contains the printable map, "
            "complete legends, original source identities, notes and point annotations. "
            "map.svg retains vector overlays; map.png has the selected paper dimensions and DPI.\n\n"
            "## Original selection\n\n"
            "- Project: " + record["project_id"] + "\n"
            "- Saved review: " + review["id"] + "\n"
            "- Export: " + record["id"] + "\n"
            "- Paper: " + record["selection"]["paper"] + " landscape; "
            + str(record["selection"]["dpi"]) + " DPI.\n\n"
            "review.json is the exact original immutable saved-review file. "
            "provenance.json retains the original selection, complete native source descriptions, "
            "render size, physical units, source hashes and renderer runtime. "
            "PACK.json declares each included artifact's exact length and SHA256.\n\n"
            "## Reading values and geometry\n\n"
            "Raster legends use the native print frame's selected physical range: low values are "
            "gray 28, high values gray 232 and a constant valid field gray 127. NoData is transparent. "
            "A value of zero remains a valid value unless the original source mask excludes it. "
            "Difference means right source minus left source. Swipe places the right/comparison source on the left "
            "of the retained divider, above the full primary underlay.\n\n"
            "annotations.json and annotations.csv contain original pixel coordinates, rows/columns, "
            "masks, numeric text, scale/offset, physical units and covering feature attributes. "
            "CSV empty cells represent absent fields; JSON retains explicit null, empty string and "
            "original property text. Each geometry reference resolves to one full original native "
            "geometry in annotation-geometries.jsonl, including original Esri rings and explicit "
            "reader corrections when that source supplies them. A point query's existing feature "
            "limit and any further matches remain declared per group.\n\n"
            "overlay-features.jsonl contains the exact printed viewport features. Their display "
            "geometry is clipped and simplified by one quarter of an actual print pixel; original "
            "attributes and source IDs remain beside it. The original unmodified source geometry "
            "stays with the retained scientific Workspace. Point inspections use the original "
            "geometry rather than that display simplification.\n\n"
            "## Receiving the working project\n\n"
            "Use the original operator's Workspace backup action to carry all source objects, "
            "profiles, grids, native runs, saved reviews, map packs and the complete application. "
            "Restore that archive into a new directory through the original receiving operation. "
            "Select this saved review under Spatial review to resume navigation or create a successor. "
            "The map export record and its file hashes are validated during receiving.\n\n"
            "application-source.zip retains the exact original application files used for this "
            "export, with SOURCE.json inventory and runtime identities. Those are source files; "
            "the original qualified GIS environment supplies the declared native dependencies. "
            "The complete Workspace backup supplies the original scientific input bytes. "
            "The static map pack opens locally without running the application.\n"
        )

    def _index(self, review, record, summary, descriptions):
        esc = lambda value: html.escape(str(value), quote=True)
        links = "".join("<li><a href=\"" + esc(filename) + "\">" + esc(title) + "</a></li>"
                        for name, (filename, _, title) in OUTPUTS.items() if name not in {"index", "bundle"})
        sources = "".join("<tr><td>" + esc(value["layer"]["title"]) + "</td><td><code>" +
                          esc(value["layer"]["sha256"]) + "</code></td><td>" +
                          esc(value["native"].get("crs", "")) + "</td></tr>" for value in descriptions)
        return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">"
                "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; "
                "img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">"
                "<title>" + esc(review["title"]) + "</title><style>"
                "body{font:15px/1.55 system-ui,sans-serif;color:#202020;background:#fff;margin:0}"
                "main{max-width:1100px;margin:28px auto;padding:0 24px}h1{font-size:25px;line-height:1.2}"
                "h2{font-size:18px;margin-top:30px}a{color:#202020}img{width:100%;border:1px solid #ddd}"
                "pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f5f5f5}"
                "code{font-size:12px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}"
                "td,th{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:9px}"
                "p.meta{color:#555}li{margin:.4em 0}</style><main><h1>" + esc(review["title"]) +
                "</h1><p class=\"meta\">" + esc(self.workspace.project["title"]) + " / " +
                esc(record["selection"]["paper"].upper()) + " landscape / " +
                esc(record["selection"]["dpi"]) + " DPI / " + esc(review["mode"]) + " view</p>"
                "<a href=\"map.pdf\"><img src=\"map.png\" alt=\"Printable saved spatial review\"></a>"
                "<p><a href=\"map.pdf\">Open the complete printable map and review appendix</a>.</p>"
                "<h2>Map pack files</h2><ul>" + links + "</ul>"
                "<h2>Original sources</h2><table><tr><th>Source</th><th>SHA256</th><th>Native CRS</th></tr>" +
                sources + "</table><h2>Saved notes</h2><pre>" + esc(review.get("notes", "")) +
                "</pre>" + ("<h2>Atlas review finding</h2><pre>" +
                esc(json.dumps(review["atlas_review"], ensure_ascii=False, sort_keys=True, indent=2)) + "</pre>"
                if review.get("atlas_review") else "") +
                "<h2>Rendered selection</h2><details><summary>View, scales, overlays and print dimensions</summary><pre>" +
                esc(json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2)) +
                "</pre></details><p class=\"meta\">Project <code>" + esc(record["project_id"]) +
                "</code><br>Review <code>" + esc(review["id"]) + "</code><br>Export <code>" +
                esc(record["id"]) + "</code></p></main></html>\n")


    def _render(self, review, stage, state):
        from . import cartography
        layout = cartography.spatial_review_layout(review, state["selection"]["paper"], state["selection"]["dpi"])
        sizes = {tuple(sorted(panel["pixels"].items())) for panel in layout["panels"]}
        if len(sizes) != 1:
            raise ValueError("Linked print panels retain one native sampling grid")
        frame = self.spatial.print_frame(review, size=dict(next(iter(sizes))))
        if frame["view"] != review["view"]:
            raise ValueError("Native print changed the saved review extent")
        original = self.workspace.root / "spatial-reviews" / (review["id"] + ".json")
        body = original.read_bytes()
        if hashlib.sha256(body).hexdigest() != state["review_sha256"]:
            raise ValueError("Original saved review changed during print capture")
        atomic_bytes(stage / "review.json", body, immutable=True)
        descriptions, seen = [], set()
        for selection in [review["reference"], review.get("primary"), review.get("comparison")] + [
                item["selection"] for item in review.get("overlays", [])]:
            if selection is None or digest(selection) in seen:
                continue
            seen.add(digest(selection))
            descriptions.append(self.spatial.describe({"selection": selection}))
        overlays = self._capture_overlays(review, stage, frame)
        annotations = self._capture_annotations(review, stage)
        source_root = Path(__file__).resolve().parent.parent
        _zip(stage / "application-source.zip", source_root, state["renderer"]["application_sources"],
             manifest={"schema": "upstate.spatial-renderer-source/v1", "renderer": state["renderer"],
                       "project_id": state["project_id"], "review_id": review["id"], "export_id": state["id"]})
        summary = cartography.render_spatial_review(
            stage, review=review, project=self.workspace.project, frame=frame, layout=layout,
            overlay_file=stage / "overlay-features.jsonl", overlays=overlays,
            annotation_file=stage / "annotations.json", descriptions=descriptions,
            created_at=state["created_at"], export_id=state["id"])
        summary["annotation_counts"] = annotations
        atomic_json(stage / "provenance.json", {
            "schema": "upstate.spatial-map-provenance/v1", "export_id": state["id"],
            "project": self.workspace.project, "review": review, "selection": state["selection"],
            "review_sha256": state["review_sha256"], "renderer": state["renderer"],
            "summary": summary, "sources": descriptions,
            "source_bindings": review["bindings"], "frame_warnings": frame["warnings"],
            "annotations": annotations,
            "original_source_meaning": "source objects and native run artifacts retained in the scientific Workspace",
            "rendered_geometry_meaning": "viewport clip/simplification at actual print resolution; original geometry retained",
            "reference_documentation": [
                "https://matplotlib.org/stable/api/_as_gen/matplotlib.figure.Figure.savefig.html",
                "https://matplotlib.org/stable/api/backend_pdf_api.html",
                "https://pyproj4.github.io/pyproj/stable/api/geod.html"]})
        atomic_bytes(stage / "README.md", self._readme(review, state).encode("utf-8"))
        atomic_bytes(stage / "index.html", self._index(review, state, summary, descriptions).encode("utf-8"))
        members = {}
        for name, (filename, content_type, title) in OUTPUTS.items():
            if name in {"pack_manifest", "bundle"}:
                continue
            path = stage / filename
            _fsync(path)
            item = describe_file(stage, path, filename=filename, content_type=content_type, title=title)
            members[filename] = {k: v for k, v in item.items() if k != "path"}
        manifest = {"schema": PACK_FORMAT, "export_id": state["id"],
                    "project_id": state["project_id"], "review_id": review["id"],
                    "selection": state["selection"], "created_at": state["created_at"],
                    "renderer": state["renderer"], "summary": summary, "files": members,
                    "receiving": "Open index.html; retain original Workspace backup for geographic reuse"}
        atomic_json(stage / "PACK.json", manifest)
        zip_members = {name: item for name, item in members.items()}
        zip_members["PACK.json"] = describe_file(stage, stage / "PACK.json")
        _zip(stage / "map-pack.zip", stage, zip_members)
        files = {}
        for name, (filename, content_type, title) in OUTPUTS.items():
            item = describe_file(stage, stage / filename, filename=filename,
                                 content_type=content_type, title=title)
            files[name] = {**item, "path": "files/" + filename}
        return {**state, "state": "complete", "completed_at": now(), "summary": summary, "files": files}

    def export(self, payload):
        selection = _selection(payload)
        # Both the original backup and this export take the scientific workspace
        # lock first. The original operator retains the job identity and lifetime.
        with held(self.workspace.root / ".workspace.lock", blocking=False):
            review = self._review(selection["review_id"])
            original = self.workspace.root / "spatial-reviews" / (review["id"] + ".json")
            identity = {"schema": FORMAT, "project_id": self.workspace.project["id"],
                        "review_id": review["id"], "review_sha256": file_digest(original),
                        "selection": selection, "renderer": _application_identity()}
            key = digest(identity)
            directory = self._directory(key)
            directory.mkdir(parents=True, exist_ok=True)
            record_path = directory / "export.json"
            with held(directory / ".export.lock", blocking=False):
                if record_path.exists():
                    state = read_json(record_path)
                    if _identity(state) != identity or state.get("id") != key:
                        raise ValueError("The original map export identity differs")
                    if state.get("state") == "complete":
                        return {**self._validate_record(state, verify=True), "reused": True}
                else:
                    state = {**identity, "id": key, "title": review["title"],
                             "state": "rendering", "created_at": now(), "files": {}, "attempts": []}
                    atomic_json(record_path, state)
                complete_directory = directory / "files"
                # A process can stop after the directory commit and before its
                # original state update. Recover those exact completed bytes.
                candidates = [complete_directory] + [
                    directory / attempt["path"] for attempt in state.get("attempts", [])
                    if isinstance(attempt.get("path"), str)
                    and re.fullmatch(r"\.write-render-[A-Za-z0-9_-]+", attempt["path"])]
                for candidate in candidates:
                    receipt = candidate / "EXPORT.json"
                    if not receipt.is_file():
                        continue
                    completed = read_json(receipt)
                    if _identity(completed) != identity or completed.get("state") != "complete":
                        raise ValueError("Retained print staging belongs to another original export")
                    self._validate_record(completed, directory=candidate, verify=True)
                    if candidate != complete_directory:
                        if complete_directory.exists():
                            raise ValueError("Original completed print directory already exists")
                        os.rename(candidate, complete_directory)
                    atomic_json(record_path, completed)
                    return {**completed, "recovered_completed_output": True}
                if complete_directory.exists():
                    raise ValueError("The original print directory lacks its completed export record")
                stage = Path(tempfile.mkdtemp(prefix=".write-render-", dir=directory))
                attempt = {"path": stage.name, "started_at": now(), "state": "rendering"}
                state.setdefault("attempts", []).append(attempt)
                state.update(state="rendering", updated_at=now())
                state.pop("error", None)
                atomic_json(record_path, state)
                try:
                    complete = self._render(review, stage, state)
                    complete["attempts"][-1].update(state="complete", completed_at=complete["completed_at"])
                    self._validate_record(complete, directory=stage, verify=True)
                    atomic_json(stage / "EXPORT.json", complete, immutable=True)
                    os.rename(stage, complete_directory)
                    atomic_json(record_path, complete)
                    return complete
                except BaseException as error:
                    attempt.update(state="failed", ended_at=now())
                    state.update(state="failed", updated_at=now(),
                                 error={"type": type(error).__name__, "message": str(error)})
                    atomic_json(record_path, state)
                    raise
