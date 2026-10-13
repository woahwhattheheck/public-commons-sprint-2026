"""Native spatial review of retained scientific sources, grids and run artifacts.

The scientific Workspace remains the owner of sources and saved review identities.
Raster pictures are windowed nearest-neighbour views. Point inspection reads the
original pixel and mask; it never queries a rendered picture.
"""
from __future__ import annotations

import base64
import contextlib
import copy
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import struct
import threading
import zlib

from .common import canonical, digest, held, identifier, read_json, relative_file
from . import receiving_water_spatial

MAX_SIZE = 1024
MAX_PIXELS = 1024 * 1024
MAX_OVERLAY_PAGE = 1000
MAX_OVERLAY_SCAN = 5000
MAX_POINT_FEATURES = 50
MAX_OVERLAYS = 24
MAX_MARKERS = 200
MODES = {"single", "compare", "swipe", "difference"}
KINDS = ("sources", "grids", "runs", "comparisons", "deliveries")
DIRECTION = "alternative minus baseline"
VIEW_DIFFERENCE_DIRECTION = "right source minus left source"


def _number(value, label, *, minimum=None, maximum=None):
    if isinstance(value, bool):
        raise ValueError(label + " must be a finite number")
    try:
        value = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(label + " must be a finite number") from error
    if not math.isfinite(value) or minimum is not None and value < minimum or maximum is not None and value > maximum:
        raise ValueError(label + " is outside its supported range")
    return value


def _integer(value, label, *, minimum=0, maximum=None):
    number = _number(value, label, minimum=minimum, maximum=maximum)
    if number != int(number):
        raise ValueError(label + " must be an integer")
    return int(number)


def _text(value, label, *, limit=240, empty=False):
    if not isinstance(value, str) or len(value) > limit or not empty and not value.strip():
        raise ValueError(label + " must be text within " + str(limit) + " characters")
    return value.strip() if not empty else value


def _json(value):
    """Keep JSON finite while retaining original scalar text beside feature values."""
    if isinstance(value, dict):
        return {str(k): _json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json(v) for v in value]
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if hasattr(value, "item"):
        return _json(value.item())
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, bytes):
        return {"encoding": "base64", "data": base64.b64encode(value).decode("ascii")}
    return str(value)


def _scalar_matches(actual, expected):
    """Compare source scalar values without treating booleans as numeric codes."""
    if isinstance(actual, bool) or isinstance(expected, bool):
        return isinstance(actual, bool) and isinstance(expected, bool) and actual == expected
    return actual == expected


def _feature_shape(feature):
    """Use the original reader's geometry directly when it already exists."""
    if hasattr(feature, "native_geometry"):
        return feature.native_geometry
    from shapely.geometry import shape
    raw = feature["geometry"]
    return shape(raw) if raw else None


def _scalar_text(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if hasattr(value, "item"):
        value = value.item()
    return str(value)


def _bounds(value, label="View bounds"):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError(label + " need left, bottom, right and top")
    result = [_number(x, label) for x in value]
    if result[0] >= result[2] or result[1] >= result[3]:
        raise ValueError(label + " must have positive width and height")
    return result


def _signature(path):
    value = Path(path).stat()
    if not stat.S_ISREG(value.st_mode):
        raise ValueError("Spatial source must be an original retained regular file")
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _file_kind(value):
    name = str(value).lower()
    if name.endswith((".tif", ".tiff", ".vrt", ".img", ".bil", ".asc")):
        return "raster"
    if name.endswith((".gpkg", ".shp", ".geojson", ".geojson.gz", ".esri.json", ".esri.json.gz")):
        return "vector"
    return None


def _categorical(layer):
    units = str(layer.get("units") or "").strip().lower()
    role = str(layer.get("role") or "").lower()
    return units in {"class", "classes", "mask", "binary", "category", "categorical", "code", "codes"} or role in {
        "nlcd", "reporting_mask", "scenario_lulc", "landcover"}


class SpatialReview:
    """Read-only native GIS operations and original Workspace saved reviews."""

    def __init__(self, workspace):
        self.workspace = workspace
        self.lock = threading.RLock()
        self._catalog_signature = None
        self._catalog_layers = {}
        self._verified = {}
        self._source_views = {}
        self._descriptions = {}
        self._esri_sources = {}
        self._category_tables = {}

    def _manifest_signature(self):
        root = self.workspace.root
        paths = list((root / "sources").glob("*.json"))
        for folder, name in (("grids", "grid.json"), ("runs", "run.json"),
                             ("comparisons", "comparison.json"), ("deliveries", "delivery-state.json")):
            paths.extend((root / folder).glob("*/" + name))
        paths.extend(receiving_water_spatial.manifest_paths(self.workspace))
        return tuple((str(p.relative_to(root)), _signature(p)) for p in sorted(paths))

    def _layers(self):
        signature = self._manifest_signature()
        with self.lock:
            if signature == self._catalog_signature:
                return self._catalog_layers
            ws, layers = self.workspace, {}
            landcover_sources = set()

            def add(group, owner, role, item, *, kind=None, title=None, scope=None, source=None, **metadata):
                if not isinstance(item, dict) or not {"bytes", "sha256"} <= item.keys():
                    return
                filename = item.get("filename") or Path(item.get("path", "")).name
                kind = kind or _file_kind(filename)
                if kind not in {"raster", "vector"}:
                    return
                sha = identifier(item["sha256"])
                count = _integer(item["bytes"], "Retained file length")
                layer_id = digest({"project_id": ws.project["id"], "group": group, "owner_id": owner,
                                   "role": role, "sha256": sha, "bytes": count})
                public = {"id": layer_id, "kind": kind, "title": title or role.replace("_", " "),
                          "group": group, "role": role, "owner_id": owner,
                          "sha256": sha, "bytes": count, "filename": filename,
                          "units": metadata.pop("units", item.get("units")), **metadata}
                public["categorical"] = _categorical(public)
                layers[layer_id] = {"public": public, "scope": scope, "file": item, "source": source}

            for collection in ws.sources():
                for entry in collection["entries"]:
                    if entry["kind"] not in {"raster", "vector"}:
                        continue
                    add("source", collection["id"], entry["id"], entry["body"], kind=entry["kind"],
                        title=entry["title"], source=(collection["id"], entry["id"], entry),
                        source_collection_id=collection["id"], source_id=entry["id"],
                        source_collection_title=collection["title"], source_uri=entry.get("uri"),
                        vintage=entry.get("vintage"), units=entry.get("units"),
                        native_layer=entry.get("layer"), format=entry.get("format") or entry.get("source_format"),
                        source_crs=entry.get("source_crs"),
                        source_scope=collection.get("scope", {}))
            for path in sorted((ws.root / "grids").glob("*/grid.json")):
                state = read_json(path)
                if state.get("state") != "complete":
                    continue
                grid = ws.get_grid(state["id"])
                source_id = grid["spec"].get("input_sources", {}).get("NLCD")
                if source_id:
                    landcover_sources.add((grid["spec"]["source_collection_id"], source_id))
                for role, item in grid["files"].items():
                    add("grid", grid["id"], role, item, scope=path.parent,
                        kind="vector" if role in {"model_domain", "reporting_area"} else None,
                        title=role.replace("_", " ") + " / grid " + grid["id"][:12], grid_id=grid["id"],
                        grid=grid["grid"], source_collection_id=grid["spec"].get("source_collection_id"),
                        source_selection=grid["spec"].get(role), input_source=grid.get("inputs", {}).get(role))
            for path in sorted((ws.root / "runs").glob("*/run.json")):
                raw = read_json(path)
                if raw.get("state") != "complete":
                    continue
                run = ws.inspect_run(raw["id"])
                metadata = {"run_id": run["id"], **{k: run["selection"][k] for k in (
                    "grid_id", "profile_id", "scenario_id", "invest_version") if k in run["selection"]}}
                for role, item in run.get("artifacts", {}).items():
                    add("run", run["id"], role, item, scope=path.parent,
                        title=role.replace("_", " ") + " / run " + run["id"][:12], **metadata)
                    original = item.get("native_output")
                    if original:
                        add("run", run["id"], "native/" + role, original, scope=path.parent,
                            title="Original rate: " + role.replace("_", " ") + " / run " + run["id"][:12],
                            units=item.get("native_units"), derived_artifact_sha256=item["sha256"], **metadata)
                landcover = run.get("stages", {}).get("landcover", {}).get("artifact")
                if landcover:
                    add("run", run["id"], "scenario_lulc", landcover, scope=path.parent, units="class",
                        title="Scenario land cover / run " + run["id"][:12], **metadata)
            for path in sorted((ws.root / "comparisons").glob("*/comparison.json")):
                comparison = read_json(path)
                ids = [comparison["baseline_run_id"]] + [a["run_id"] for a in comparison["alternatives"]]
                from .native_versions import validate_run_comparison
                validate_run_comparison(ws, comparison, expected_id=path.parent.name)
                for alternative in comparison["alternatives"]:
                    for role, item in alternative["artifacts"].items():
                        add("comparison", comparison["id"], alternative["run_id"] + "/" + role, item,
                            scope=path.parent, title=role.replace("_", " ") + " change / " + alternative["run_id"][:12],
                            baseline_run_id=comparison["baseline_run_id"], alternative_run_id=alternative["run_id"],
                            direction=DIRECTION, profile_changed=alternative.get("profile_changed"),
                            **{k: alternative["selection"][k] for k in ("grid_id", "profile_id", "scenario_id")})
            for path in sorted((ws.root / "deliveries").glob("*/delivery-state.json")):
                delivery = read_json(path)
                if delivery.get("state") not in {"complete", "received_snapshot"}:
                    continue
                for role, item in delivery.get("files", {}).items():
                    add("delivery", delivery["id"], role, item, scope=path.parent,
                        title=role.replace("_", " ") + " / delivery " + delivery["id"][:12],
                        baseline_run_id=delivery.get("selection", {}).get("baseline_run_id"))
            receiving_water_spatial.add_layers(ws, add)
            # Source IDs are arbitrary. A completed native grid supplies the
            # original source-to-land-cover binding without guessing from names.
            for record in layers.values():
                public = record["public"]
                source_key = (public.get("source_collection_id"), public.get("source_id"))
                if public["group"] == "source" and source_key in landcover_sources:
                    public["input_role"] = "NLCD"
                    public["categorical"] = True
            # Atomic source manifests can be added during a native run. Never cache
            # a mixed catalogue signature; the next request rebuilds it if needed.
            observed = self._manifest_signature()
            self._catalog_signature = signature if observed == signature else None
            self._catalog_layers = layers
            return layers

    def catalog(self):
        layers = self._layers()
        reviews = self.workspace._list("spatial-reviews")
        return {"project": self.workspace.project,
                "layers": [copy.deepcopy(v["public"]) for v in layers.values()],
                "reviews": [{k: v[k] for k in ("id", "title", "project_id", "mode", "previous_review_id") if k in v}
                            for v in reviews],
                "limits": {"image_width": MAX_SIZE, "image_height": MAX_SIZE,
                           "image_pixels": MAX_PIXELS, "overlay_page": MAX_OVERLAY_PAGE,
                           "overlay_scan": MAX_OVERLAY_SCAN, "point_features": MAX_POINT_FEATURES,
                           "overlays": MAX_OVERLAYS, "markers": MAX_MARKERS}}

    def _selected(self, value, layers, *, kind=None):
        if not isinstance(value, dict):
            raise ValueError("Choose an original spatial layer")
        if set(value) - {"layer_id", "band", "layer", "where"}:
            raise ValueError("Spatial selection contains unsupported fields")
        key = identifier(value.get("layer_id"))
        record = layers.get(key)
        if record is None:
            raise ValueError("The selected spatial layer is absent from this scientific workspace")
        public = record["public"]
        if kind and public["kind"] != kind:
            raise ValueError("Choose an original " + kind + " layer")
        selection = {"layer_id": key}
        if public["kind"] == "raster":
            if value.get("layer") is not None or value.get("where") not in (None, {}):
                raise ValueError("Raster selections use a band; vector filters belong to vector layers")
            selection["band"] = _integer(value.get("band", 1), "Raster band", minimum=1)
        else:
            if value.get("band") is not None:
                raise ValueError("Vector selections use their native layer and property filter")
            layer = value.get("layer") or public.get("native_layer")
            if layer is not None:
                selection["layer"] = _text(layer, "Native vector layer", limit=500)
            where = value.get("where") or {}
            if not isinstance(where, dict) or len(where) > 64:
                raise ValueError("Use an object of original field names and exact scalar filter values")
            for name, scalar in where.items():
                _text(name, "Filter field", limit=240)
                if not (scalar is None or isinstance(scalar, (str, bool, int, float))):
                    raise ValueError("Vector property filters use exact scalar values")
                if isinstance(scalar, float) and not math.isfinite(scalar):
                    raise ValueError("Vector property filter numbers must be finite")
            selection["where"] = dict(where)
        return selection, record

    def _verify_file(self, scope, item):
        path = relative_file(scope, item["path"])
        expected = (item["sha256"], item["bytes"])
        key = (str(path), expected)
        signature = _signature(path)
        if signature[2] != item["bytes"]:
            raise ValueError("Original spatial artifact length changed")
        with self.lock:
            if self._verified.get(key) == signature:
                return path
            with path.open("rb") as source:
                before = os.fstat(source.fileno())
                h = hashlib.sha256()
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    h.update(block)
                after = os.fstat(source.fileno())
            observed = lambda st: (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
            if h.hexdigest() != item["sha256"] or observed(before) != observed(after) or observed(after) != signature:
                raise ValueError("Original retained spatial artifact changed")
            self._verified[key] = signature
        return path

    def _path(self, record):
        if record["source"] is None:
            path = self._verify_file(record["scope"], record["file"])
            return path, ((str(path), _signature(path)),)
        collection, source_id, entry = record["source"]
        bodies = [entry["body"]] + entry.get("companions", [])
        originals = [relative_file(self.workspace.root, body["object"]) for body in bodies]
        original_signatures = tuple((str(path), _signature(path)) for path in originals)
        key = (collection, source_id)
        with self.lock:
            previous = self._source_views.get(key)
            if previous and previous["originals"] == original_signatures:
                try:
                    views = tuple((name, _signature(name)) for name, _ in previous["views"])
                    if views == previous["views"]:
                        return previous["path"], original_signatures + views
                except OSError:
                    pass
            # This is the original source/companion materializer. Cache only its
            # successful original verification, invalidating on any file change.
            path, actual_entry = self.workspace.source_file(collection, source_id)
            if actual_entry["body"] != entry["body"] or actual_entry.get("companions", []) != entry.get("companions", []):
                raise ValueError("The original selected source edition changed")
            current = tuple((str(p), _signature(p)) for p in originals)
            if current != original_signatures:
                # Creating a source-view hardlink updates the original inode's
                # ctime without changing its bytes. Verify that narrow case
                # against the retained digest, then cache the post-link state.
                for body, (name, before), (_, after) in zip(bodies, original_signatures, current):
                    if before == after:
                        continue
                    if before[:4] != after[:4]:
                        raise ValueError("Original source changed during native receiving")
                    self._verify_file(self.workspace.root, {
                        "path": body["object"], "sha256": body["sha256"], "bytes": body["bytes"]})
                current = tuple((str(p), _signature(p)) for p in originals)
            view_root = self.workspace.root / "source-views" / collection / digest(source_id)
            views = tuple((str(view_root / body.get("view_path", body["filename"])),
                           _signature(view_root / body.get("view_path", body["filename"]))) for body in bodies)
            self._source_views[key] = {"path": path, "originals": current, "views": views}
            return path, current + views

    @contextlib.contextmanager
    def _reading(self, record):
        path, signatures = self._path(record)
        try:
            yield path, signatures
        finally:
            observed = tuple((name, _signature(name)) for name, _ in signatures)
            if observed != signatures:
                if any(actual[:4] != expected[:4]
                       for (_, expected), (_, actual) in zip(signatures, observed)):
                    raise ValueError("Original spatial source changed during this read")
                # A new hardlink changes ctime without changing source bytes.
                # Verify the files actually read, without rematerializing a
                # copied view that may have changed during this read.
                if record["source"] is None:
                    self._verify_file(record["scope"], record["file"])
                else:
                    collection, source_id, entry = record["source"]
                    view_root = self.workspace.root / "source-views" / collection / digest(source_id)
                    for body in [entry["body"]] + entry.get("companions", []):
                        self._verify_file(self.workspace.root, {
                            "path": body["object"], "sha256": body["sha256"], "bytes": body["bytes"]})
                        self._verify_file(view_root, {
                            "path": body.get("view_path", body["filename"]),
                            "sha256": body["sha256"], "bytes": body["bytes"]})

    @staticmethod
    def _units(source, record, band):
        declared = record["public"].get("units")
        native = source.units[band - 1] if source.units else None
        tags = source.tags(band)
        tags_all = source.tags()
        observed = native or tags.get("units") or tags.get("UNITTYPE") or tags_all.get("units")
        return declared or observed or None

    @staticmethod
    def _vector_layer(source_path, selection):
        import fiona
        layers = list(fiona.listlayers(source_path))
        selected = selection.get("layer") or (layers[0] if layers else None)
        if selected not in layers:
            raise ValueError("Choose an existing original native vector layer")
        return layers, selected

    @staticmethod
    def _where(source, selection):
        where = selection.get("where", {})
        missing = set(where) - set(source.schema["properties"])
        if missing:
            raise ValueError("Original vector layer has no fields: " + ", ".join(sorted(missing)))
        return where

    def _describe(self, selection, record):
        from pyproj import CRS
        with self._reading(record) as (path, signatures):
            key = digest({"selection": selection, "signatures": signatures})
            with self.lock:
                cached = self._descriptions.get(key)
            if cached is not None:
                return copy.deepcopy(cached)
            if record["public"]["kind"] == "raster":
                import rasterio
                with rasterio.open(path) as source:
                    band = selection["band"]
                    if band > source.count:
                        raise ValueError("The selected original raster band does not exist")
                    if source.crs is None:
                        raise ValueError("Retain the original raster coordinate reference system before geographic review")
                    crs = CRS.from_user_input(source.crs)
                    native = {"kind": "raster", "crs": crs.to_string(), "crs_wkt": crs.to_wkt(),
                              "bounds": list(source.bounds), "transform": list(source.transform)[:6],
                              "width": source.width, "height": source.height, "count": source.count,
                              "resolution": list(source.res), "dtypes": list(source.dtypes),
                              "nodata": _json(source.nodata), "nodatavals": _json(source.nodatavals),
                              "nodata_text": [_scalar_text(v) for v in source.nodatavals],
                              "scales": list(source.scales), "offsets": list(source.offsets),
                              "units": self._units(source, record, band), "band_units": list(source.units),
                              "descriptions": list(source.descriptions), "tags": source.tags(),
                              "band_tags": source.tags(band), "band": band,
                              "categorical": record["public"]["categorical"],
                              "color_interpretations": [x.name for x in source.colorinterp],
                              "mask_flags": [[flag.name for flag in flags] for flags in source.mask_flag_enums]}
            else:
                with self._open_vector(path, selection, record, signatures) as (vector_layers, chosen, original):
                    crs = CRS.from_user_input(original.crs_wkt or original.crs)
                    where = self._where(original, selection)
                    native = {"kind": "vector", "crs": crs.to_string(), "crs_wkt": crs.to_wkt(),
                              "layers": vector_layers, "selected_layer": chosen, "driver": original.driver,
                              "fields": dict(original.schema["properties"]),
                              "geometry_type": original.schema["geometry"],
                              "feature_count": len(original),
                              "bounds": list(original.bounds) if original.bounds is not None else None,
                              "filtered_count": None}
                    if hasattr(original, "reader_metadata"):
                        native.update(copy.deepcopy(original.reader_metadata))
                    if where:
                        bounds, count = None, 0
                        for feature in original:
                            if any(not _scalar_matches(feature["properties"].get(k), v) for k, v in where.items()):
                                continue
                            geometry = _feature_shape(feature)
                            if geometry is None or geometry.is_empty:
                                continue
                            if not geometry.is_valid:
                                raise ValueError("Source feature " + str(feature.id) + " requires an explicit geometry correction")
                            b = geometry.bounds
                            bounds = list(b) if bounds is None else [
                                min(bounds[0], b[0]), min(bounds[1], b[1]), max(bounds[2], b[2]), max(bounds[3], b[3])]
                            count += 1
                        native["filtered_count"] = count
                        native["bounds"] = bounds
            result = {"selection": selection, "layer": copy.deepcopy(record["public"]), "native": _json(native)}
            with self.lock:
                self._descriptions[key] = copy.deepcopy(result)
            return result

    def describe(self, payload):
        selection, record = self._selected(payload.get("selection"), self._layers())
        return self._describe(selection, record)

    def _view(self, payload, reference_description, size):
        from pyproj import CRS
        requested = payload.get("view")
        if requested is not None:
            if not isinstance(requested, dict) or set(requested) - {"crs", "bounds"}:
                raise ValueError("A spatial view contains its coordinate reference system and bounds")
            crs = CRS.from_user_input(requested.get("crs"))
            bounds = _bounds(requested.get("bounds"))
        else:
            native = reference_description["native"]
            crs = CRS.from_user_input(native["crs"])
            raw = native.get("bounds")
            if raw is None or len(raw) != 4:
                raise ValueError("The selected original vector filter contains no geographic extent")
            bounds = [_number(x, "Original source bounds") for x in raw]
            if bounds[0] > bounds[2] or bounds[1] > bounds[3]:
                raise ValueError("Original geographic source bounds are invalid")
            pad = max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * .02
            pad = pad or (.01 if crs.is_geographic else 30.0)
            if bounds[0] == bounds[2]:
                bounds[0] -= pad
                bounds[2] += pad
            if bounds[1] == bounds[3]:
                bounds[1] -= pad
                bounds[3] += pad
        # Fit rather than stretch the selected geographic extent. Every image,
        # vector overlay and point conversion uses the returned actual bounds.
        cx, cy = (bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2
        width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
        aspect = size["width"] / size["height"]
        if width / height < aspect:
            width = height * aspect
        else:
            height = width / aspect
        return {"crs": crs.to_string(), "bounds": [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2]}

    @staticmethod
    def _size(value):
        value = value or {}
        if not isinstance(value, dict):
            raise ValueError("Image size must contain width and height")
        result = {"width": _integer(value.get("width", 900), "Image width", minimum=1, maximum=MAX_SIZE),
                  "height": _integer(value.get("height", 650), "Image height", minimum=1, maximum=MAX_SIZE)}
        if result["width"] * result["height"] > MAX_PIXELS:
            raise ValueError("The requested spatial image exceeds its pixel capacity")
        return result

    @staticmethod
    def _scale_request(value):
        value = value or {"mode": "auto"}
        if not isinstance(value, dict) or value.get("mode", "auto") not in {"auto", "fixed"}:
            raise ValueError("Choose an automatic or fixed numeric display scale")
        result = {"mode": value.get("mode", "auto")}
        if result["mode"] == "fixed":
            result["minimum"] = _number(value.get("minimum"), "Scale minimum")
            result["maximum"] = _number(value.get("maximum"), "Scale maximum")
            if result["minimum"] >= result["maximum"]:
                raise ValueError("Fixed scale maximum must exceed its minimum")
        return result

    def _source_categories(self, record):
        """Read class descriptions from retained tables in this source edition."""
        public = record["public"]
        role = str(public.get("input_role") or public.get("role") or "").strip().lower()
        # A binary contribution mask can carry the same run/profile identity as
        # land cover. Biophysical class names belong only to land-cover roles.
        if (not public.get("categorical")
                or role not in {"nlcd", "landcover", "lulc", "scenario_lulc"}):
            return {"labels": {}, "sources": [], "conflicts": []}
        ws = self.workspace
        collection_id = public.get("source_collection_id")
        preferred = None
        if public.get("profile_id"):
            profile = ws._get("profiles", public["profile_id"])
            collection_id = profile["source_collection_id"]
            preferred = profile.get("biophysical_source_id")
        if not collection_id:
            return {"labels": {}, "sources": [], "conflicts": []}
        cache_key = (collection_id, preferred)
        with self.lock:
            cached = self._category_tables.get(cache_key)
            if cached is not None:
                return copy.deepcopy(cached)
        collection = ws._get("sources", collection_id)
        entries = [entry for entry in collection["entries"] if entry["kind"] == "table"]
        entries.sort(key=lambda entry: (entry["id"] != preferred, entry["id"]))
        labels, sources, conflicts = {}, [], set()
        for entry in entries:
            path, original = ws.source_file(collection_id, entry["id"])
            if path.suffix.lower() != ".csv":
                continue
            with path.open(encoding="utf-8-sig", newline="") as incoming:
                reader = csv.DictReader(incoming)
                fields = {str(field).strip().lower(): field for field in reader.fieldnames or []}
                if not {"lucode", "description"} <= fields.keys():
                    continue
                table_labels = {}
                for index, row in enumerate(reader):
                    if index >= 4096:
                        table_labels = {}
                        break
                    try:
                        value = _integer(row.get(fields["lucode"]), "Original land-cover code",
                                         minimum=-2147483648, maximum=2147483647)
                    except (TypeError, ValueError):
                        table_labels = {}
                        break
                    description = str(row.get(fields["description"]) or "").strip()
                    if not description or value in table_labels:
                        table_labels = {}
                        break
                    table_labels[value] = description
            if not table_labels:
                continue
            sources.append({"source_collection_id": collection_id, "source_id": entry["id"],
                            "sha256": original["body"]["sha256"], "uri": original.get("uri"),
                            "columns": {"value": "lucode", "label": "description"}})
            for value, description in table_labels.items():
                if value in labels and labels[value] != description:
                    conflicts.add(value)
                else:
                    labels[value] = description
            # A description in the run's selected biophysical table takes priority.
            if entry["id"] == preferred:
                break
        for value in conflicts:
            labels.pop(value, None)
        result = {"labels": labels, "sources": sources, "conflicts": sorted(conflicts)}
        with self.lock:
            self._category_tables[cache_key] = copy.deepcopy(result)
        return result

    @staticmethod
    def _style_categories(samples):
        """Use one discrete code palette across linked categorical map panels."""
        import numpy as np
        selected = [sample for sample in samples
                    if sample is not None and sample["layer"].get("categorical")]
        if not selected:
            return
        codes = set()
        for sample in selected:
            values = np.unique(sample["data"][~sample["mask"]])
            if np.any(values != np.floor(values)):
                raise ValueError("The selected categorical raster contains noninteger class codes")
            if values.size > 4096:
                raise ValueError("The selected categorical raster contains more than 4096 classes")
            codes.update(int(value) for value in values)
            codes.update(sample["category_source"]["labels"])
        ordered = sorted(codes)
        # Colour indicates class membership, never a physical magnitude.
        greys = [round(48 + 176 * index / max(1, len(ordered) - 1))
                 for index in range(len(ordered))]
        for sample in selected:
            original = sample["category_source"]
            sample["categories"] = [
                {"value": value,
                 "label": original["labels"].get(value, "Code " + str(value)),
                 "colour": "#" + format(grey, "02x") * 3}
                for value, grey in zip(ordered, greys)]

    def _sample(self, selection, record, view, size):
        import numpy as np
        import rasterio
        from rasterio.enums import ColorInterp, Resampling
        from rasterio.transform import from_bounds
        from rasterio.vrt import WarpedVRT
        with self._reading(record) as (path, _):
            with rasterio.open(path) as original:
                band = selection["band"]
                if band > original.count:
                    raise ValueError("The selected original raster band does not exist")
                if original.crs is None:
                    raise ValueError("The original raster has no retained coordinate reference system")
                if np.dtype(original.dtypes[band - 1]).kind not in "biuf":
                    raise ValueError("Spatial scalar views require an original real numeric raster band")
                options = {"crs": view["crs"], "transform": from_bounds(*view["bounds"], size["width"], size["height"]),
                           "width": size["width"], "height": size["height"],
                           "resampling": Resampling.nearest, "warp_mem_limit": 64, "dtype": "float64"}
                # An alpha mask distinguishes the out-of-source area from a
                # perfectly valid zero when the source has no nodata sentinel.
                if ColorInterp.alpha not in original.colorinterp:
                    options["add_alpha"] = True
                with WarpedVRT(original, **options) as warped:
                    values = warped.read(band, masked=True, out_dtype="float64")
                    mask = np.ma.getmaskarray(values).copy()
                    for index, interpretation in enumerate(warped.colorinterp, 1):
                        if interpretation == ColorInterp.alpha:
                            alpha_mask = warped.read(index) == 0
                            if ColorInterp.alpha in original.colorinterp and original.nodatavals[band - 1] is None:
                                # A destination's default numeric zero is not
                                # source nodata when the original alpha supplies validity.
                                mask = alpha_mask
                            else:
                                mask |= alpha_mask
                            break
                    data = np.asarray(values.data, dtype="float64")
                    mask |= ~np.isfinite(data)
                    scale = original.scales[band - 1]
                    offset = original.offsets[band - 1]
                    if not math.isfinite(scale) or not math.isfinite(offset):
                        raise ValueError("The original raster scale and offset must be finite")
                    if scale != 1 or offset != 0:
                        data = data * scale + offset
                    mask |= ~np.isfinite(data)
                return {"data": data, "mask": mask, "selection": selection,
                        "layer": record["public"], "units": self._units(original, record, band),
                        "category_source": self._source_categories(record)}

    @staticmethod
    def _statistics(sample):
        import numpy as np
        valid = sample["data"][~sample["mask"]]
        return {"valid_display_cells": int(valid.size),
                "minimum": float(np.min(valid)) if valid.size else None,
                "maximum": float(np.max(valid)) if valid.size else None}

    @staticmethod
    def _scale(samples, requested, *, signed=False):
        stats = [SpatialReview._statistics(s) for s in samples if s is not None]
        mins = [s["minimum"] for s in stats if s["minimum"] is not None]
        maxs = [s["maximum"] for s in stats if s["maximum"] is not None]
        if requested["mode"] == "fixed":
            low, high, basis = requested["minimum"], requested["maximum"], "selected fixed physical values"
        elif mins:
            low, high = min(mins), max(maxs)
            if signed:
                extent = max(abs(low), abs(high))
                low, high = -extent, extent
            basis = "visible nearest-sample values; not whole-raster statistics"
        else:
            low, high, basis = None, None, "no valid raster samples in this viewport"
        return {"mode": requested["mode"], "minimum": low, "maximum": high, "basis": basis}

    @staticmethod
    def _png(sample, scale):
        import numpy as np
        data, mask = sample["data"], sample["mask"]
        low, high = scale["minimum"], scale["maximum"]
        grey = np.full(data.shape, 127, dtype="uint8")
        if sample.get("categories"):
            categories = sample["categories"]
            levels = np.asarray([item["value"] for item in categories], dtype="float64")
            colours = np.asarray([int(item["colour"][1:3], 16) for item in categories], dtype="uint8")
            valid = ~mask
            grey[valid] = colours[np.searchsorted(levels, data[valid])]
        elif low is not None and high is not None and high > low:
            # Work only on valid cells so NaN, infinity and masked data never
            # participate in conversion or receive an opaque colour.
            valid = ~mask
            grey[valid] = np.rint(28 + 204 * np.clip((data[valid] - low) / (high - low), 0, 1)).astype("uint8")
        rgba = np.empty((*data.shape, 4), dtype="uint8")
        rgba[:, :, :3] = grey[:, :, None]
        rgba[:, :, 3] = np.where(mask, 0, 255).astype("uint8")
        height, width = data.shape
        def chunk(kind, body):
            return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xffffffff)
        raw = b"".join(b"\0" + row.tobytes() for row in rgba)
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
        return base64.b64encode(png).decode("ascii")

    def _image(self, sample, scale):
        if sample is None:
            return None
        height, width = sample["data"].shape
        categorical = bool(sample["layer"].get("categorical"))
        category_source = sample.get("category_source", {})
        if categorical:
            scale = {"mode": "categorical", "minimum": None, "maximum": None,
                     "basis": "Discrete original class codes; grey shade has no magnitude"}
        return {"selection": sample["selection"], "title": sample["layer"]["title"],
                "categorical": categorical, "categories": sample.get("categories", []),
                "category_source": {key: value for key, value in category_source.items() if key != "labels"},
                "units": sample["units"], "mime": "image/png",
                "png_base64": self._png(sample, scale), "width": width, "height": height,
                "source_sha256": sample["layer"]["sha256"], "scale": scale,
                "statistics": self._statistics(sample), "nodata_transparent": True,
                "sampling": "nearest; original pixel inspection uses /api/spatial/point"}

    def _pair(self, primary, comparison):
        result = {"aligned": False, "comparable": False, "difference_available": False,
                  "reason": "Select left and right source rasters", "direction": VIEW_DIFFERENCE_DIRECTION}
        if primary is None or comparison is None:
            return result
        a, b = primary["native"], comparison["native"]
        from pyproj import CRS
        from rasterio.transform import Affine
        aligned = (CRS.from_user_input(a["crs"]) == CRS.from_user_input(b["crs"])
                   and a["width"] == b["width"] and a["height"] == b["height"]
                   and Affine(*a["transform"]).almost_equals(Affine(*b["transform"]), precision=1e-9))
        units_match = a["units"] is not None and a["units"] == b["units"]
        categorical = a["categorical"] or b["categorical"]
        comparable = aligned and units_match and not categorical
        if not aligned:
            reason = "The selected rasters have different original grids; linked pictures use the same viewport"
        elif not units_match:
            reason = "Numeric subtraction requires matching declared physical units"
        elif categorical:
            reason = "Land-cover classes and masks are reviewed as categories"
        else:
            reason = "Matching original grid and physical units"
        result.update(aligned=aligned, comparable=comparable, difference_available=comparable, reason=reason,
                      baseline_layer_id=primary["layer"]["id"], alternative_layer_id=comparison["layer"]["id"],
                      baseline_run_id=primary["layer"].get("run_id"),
                      alternative_run_id=comparison["layer"].get("run_id"),
                      baseline_units=a["units"], alternative_units=b["units"])
        if primary["layer"].get("profile_id") and comparison["layer"].get("profile_id"):
            result["profile_changed"] = primary["layer"]["profile_id"] != comparison["layer"]["profile_id"]
        return result

    def frame(self, payload):
        return self._render_frame(payload)

    def print_frame(self, payload, *, size):
        """Host-owned print sampling at the retained extent and actual output DPI.

        The interactive route keeps its original image limit. This call is only
        composed by the native saved-review exporter; it has no HTTP size override.
        """
        if not isinstance(size, dict) or set(size) != {"width", "height"}:
            raise ValueError("Print sampling retains its exact output dimensions")
        size = {name: _integer(size[name], "Print " + name, minimum=1, maximum=4096)
                for name in ("width", "height")}
        if size["width"] * size["height"] > 10 * 1024 * 1024:
            raise ValueError("One print panel supports up to ten million native samples")
        return self._render_frame(payload, print_size=size)

    def _render_frame(self, payload, *, print_size=None):
        layers = self._layers()
        reference, reference_record = self._selected(payload.get("reference"), layers)
        reference_description = self._describe(reference, reference_record)
        size = self._size(payload.get("size")) if print_size is None else print_size
        if print_size is None:
            view = self._view(payload, reference_description, size)
        else:
            from pyproj import CRS
            requested_view = payload.get("view")
            if not isinstance(requested_view, dict) or set(requested_view) != {"crs", "bounds"}:
                raise ValueError("Print the exact retained review extent")
            view = {"crs": CRS.from_user_input(requested_view["crs"]).to_string(),
                    "bounds": _bounds(requested_view["bounds"])}
        mode = payload.get("mode", "single")
        if mode not in MODES:
            raise ValueError("Choose a supported spatial comparison view")
        requested = self._scale_request(payload.get("scale"))
        samples, descriptions = {}, {}
        for name in ("primary", "comparison"):
            selected = payload.get(name)
            if selected is None:
                samples[name], descriptions[name] = None, None
            else:
                selection, record = self._selected(selected, layers, kind="raster")
                descriptions[name] = self._describe(selection, record)
                samples[name] = self._sample(selection, record, view, size)
        self._style_categories(list(samples.values()))
        pair = self._pair(descriptions["primary"], descriptions["comparison"])
        warnings = []
        if samples["primary"] and samples["comparison"] and samples["primary"]["units"] != samples["comparison"]["units"]:
            warnings.append("The linked raster units differ; each image retains its own physical unit label.")
        scale = self._scale(list(samples.values()), requested)
        same_units = not (samples["primary"] and samples["comparison"]) or samples["primary"]["units"] == samples["comparison"]["units"]
        images = {name: self._image(sample, scale if same_units or requested["mode"] == "fixed"
                                   else self._scale([sample], requested))
                  for name, sample in samples.items()}
        if not same_units and requested["mode"] == "auto":
            scale = {"mode": "auto", "minimum": None, "maximum": None,
                     "basis": "separate visible scales for different physical unit domains"}
        images["difference"] = None
        if mode == "difference":
            if not pair["difference_available"]:
                raise ValueError(pair["reason"])
            import numpy as np
            baseline, alternative = samples["primary"], samples["comparison"]
            data = alternative["data"] - baseline["data"]
            delta = {"data": data, "mask": baseline["mask"] | alternative["mask"] | ~np.isfinite(data),
                     "selection": {"primary": baseline["selection"], "comparison": alternative["selection"]},
                     "layer": {**alternative["layer"], "title": "Right source minus left source",
                               "sha256": None},
                     "units": baseline["units"]}
            delta_scale = self._scale([delta], requested, signed=True)
            images["difference"] = self._image(delta, delta_scale)
            images["difference"]["direction"] = VIEW_DIFFERENCE_DIRECTION
            images["difference"]["source_sha256s"] = {
                "baseline": baseline["layer"]["sha256"], "alternative": alternative["layer"]["sha256"]}
        return {"view": view, "size": size, "images": images, "scale": scale,
                "pair": pair, "warnings": warnings, "reference": reference, "mode": mode}

    @contextlib.contextmanager
    def _open_vector(self, path, selection, record, signatures):
        from .spatial_esri import OriginalEsriFeatures, UnsupportedEsriGeometry, is_esri_source
        entry = record["source"][2] if record["source"] is not None else record["public"]
        if is_esri_source(path, entry):
            key = (str(path), signatures)
            try:
                with self.lock:
                    original = self._esri_sources.get(key)
                    if original is None:
                        original = OriginalEsriFeatures(path, entry)
                        self._esri_sources[key] = original
                        # Cache two selected native collections, not the entire
                        # catalogue. Active readers retain their own references.
                        while len(self._esri_sources) > 2:
                            self._esri_sources.pop(next(iter(self._esri_sources)))
                    else:
                        self._esri_sources.pop(key)
                        self._esri_sources[key] = original
            except UnsupportedEsriGeometry:
                original = None
            if original is not None:
                layer = selection.get("layer") or original.name
                if layer not in original.layers:
                    raise ValueError("Choose the retained Esri document's original features collection")
                self._where(original, selection)
                yield original.layers, layer, original
                return
        import fiona
        from .rasters import native_vector_path, vector_environment
        with vector_environment():
            native_path = native_vector_path(path)
            layers, layer = self._vector_layer(native_path, selection)
            with fiona.open(native_path, layer=layer) as original:
                self._where(original, selection)
                yield layers, layer, original

    @contextlib.contextmanager
    def _vector(self, selection, record):
        from pyproj import CRS
        with self._reading(record) as (path, signatures):
            with self._open_vector(path, selection, record, signatures) as (_, layer, original):
                yield original, CRS.from_user_input(original.crs_wkt or original.crs), layer

    @staticmethod
    def _feature(feature, geometry, *, geometry_crs, include_original=False, **extra):
        from shapely.geometry import mapping
        properties = dict(feature["properties"])
        if hasattr(feature, "source_feature_index"):
            extra.update(source_feature_index=feature.source_feature_index,
                         source_id_basis=feature.id_basis,
                         source_geometry_format="Esri JSON rings",
                         geometry_reader="source/capture_upstream_network.py:esri_polygon",
                         geometry_operations=copy.deepcopy(feature.geometry_operations),
                         geometry_meaning="Original Esri ring reader result; original rings are retained in the source")
            if include_original:
                extra["source_geometry_json"] = json.dumps(feature.source_geometry, ensure_ascii=False,
                                                          separators=(",", ":"), default=str)
        return {"type": "Feature", "id": str(feature.id), "properties": _json(properties),
                "properties_text": {str(k): _scalar_text(v) for k, v in properties.items()},
                "properties_json": json.dumps(properties, ensure_ascii=False, separators=(",", ":"), default=str),
                "geometry": _json(mapping(geometry)), "geometry_crs": geometry_crs, **extra}

    def overlay(self, payload):
        from pyproj import CRS, Transformer
        from shapely.geometry import shape, box
        from shapely.ops import transform
        selection, record = self._selected(payload.get("selection"), self._layers(), kind="vector")
        raw_view = payload.get("view")
        if not isinstance(raw_view, dict):
            raise ValueError("Retain the selected viewport for the original vector overlay")
        target = CRS.from_user_input(raw_view.get("crs"))
        bounds = _bounds(raw_view.get("bounds"))
        view = {"crs": target.to_string(), "bounds": bounds}
        tolerance = _number(payload.get("tolerance", 0), "Display simplification tolerance", minimum=0)
        offset = _integer(payload.get("offset", 0), "Vector page offset")
        limit = _integer(payload.get("limit", 500), "Vector page limit", minimum=1, maximum=MAX_OVERLAY_PAGE)
        selected_features, next_offset = [], None
        viewport = box(*bounds)
        with self._vector(selection, record) as (original, native, layer):
            projection = Transformer.from_crs(native, target, always_xy=True)
            reverse = Transformer.from_crs(target, native, always_xy=True)
            native_bounds = _bounds(reverse.transform_bounds(*bounds, densify_pts=41, errcheck=True), "Native query bounds")
            where = selection.get("where", {})
            # Offset is the position in the original bbox-filtered driver
            # sequence. Property-filter misses do not force repeated Python
            # materialization of preceding geometries on continuation.
            scanned = 0
            iterator = original.filter(offset, offset + MAX_OVERLAY_SCAN + 1, bbox=tuple(native_bounds))
            for feature in iterator:
                position = offset + scanned
                if scanned >= MAX_OVERLAY_SCAN:
                    next_offset = position
                    break
                scanned += 1
                if any(not _scalar_matches(feature["properties"].get(k), v) for k, v in where.items()):
                    continue
                geometry = _feature_shape(feature)
                if geometry is None or geometry.is_empty:
                    continue
                if not geometry.is_valid:
                    raise ValueError("Source feature " + str(feature.id) + " requires an explicit geometry correction")
                if native != target:
                    geometry = transform(projection.transform, geometry)
                if not geometry.intersects(viewport):
                    continue
                if len(selected_features) == limit:
                    next_offset = position
                    break
                visible = geometry.intersection(viewport)
                if tolerance:
                    visible = visible.simplify(tolerance, preserve_topology=True)
                if visible.is_empty:
                    continue
                selected_features.append(self._feature(feature, visible, geometry_crs=target.to_string(),
                                                      native_crs=native.to_string()))
        return {"selection": {**selection, "layer": layer}, "source_sha256": record["public"]["sha256"],
                "crs": target.to_string(), "view": view, "features": selected_features,
                "offset": offset, "returned": len(selected_features), "next_offset": next_offset,
                "display_tolerance": tolerance, "geometry_clipped_to_view": True,
                "offset_basis": "native bbox-filtered feature sequence before exact property filters",
                "geometry_meaning": "display clip/simplification; original geometry and attributes remain in the source"}

    def _pixel(self, selection, record, point):
        import numpy as np
        import rasterio
        from pyproj import CRS, Transformer
        from rasterio.windows import Window
        with self._reading(record) as (path, _), rasterio.open(path) as original:
            band = selection["band"]
            if band > original.count:
                raise ValueError("The selected original raster band does not exist")
            if np.dtype(original.dtypes[band - 1]).kind not in "biuf":
                raise ValueError("Physical point inspection requires an original real numeric raster band")
            native = CRS.from_user_input(original.crs)
            transform = Transformer.from_crs(point["crs"], native, always_xy=True)
            x, y = transform.transform(point["x"], point["y"], errcheck=True)
            row, column = original.index(x, y)
            inside = 0 <= row < original.height and 0 <= column < original.width
            result = {"selection": selection, "layer": record["public"], "inside": inside, "valid": False,
                      "reason": "outside original raster" if not inside else None,
                      "row": int(row), "column": int(column),
                      "coordinate": {"x": x, "y": y, "crs": native.to_string()},
                      "cell_bounds": None, "cell_corners": None,
                      "raw_value": None, "raw_value_text": None, "value": None, "value_text": None,
                      "units": self._units(original, record, band), "source_sha256": record["public"]["sha256"],
                      "dtype": original.dtypes[band - 1], "scale": original.scales[band - 1],
                      "offset": original.offsets[band - 1], "nodata_text": _scalar_text(original.nodatavals[band - 1])}
            if not inside:
                return result
            corners = [original.transform * (c, r) for c, r in (
                (column, row), (column + 1, row), (column + 1, row + 1), (column, row + 1))]
            result["cell_corners"] = [list(p) for p in corners]
            native_area = abs(original.transform.a * original.transform.e - original.transform.b * original.transform.d)
            result["cell_area_native_units2"] = native_area
            result["pixel_area_ha"] = None
            if native.is_projected and len(native.axis_info) >= 2:
                factors = [axis.unit_conversion_factor for axis in native.axis_info[:2]]
                if all(f is not None and math.isfinite(f) for f in factors):
                    result["pixel_area_ha"] = native_area * factors[0] * factors[1] / 10000
            result["cell_bounds"] = [min(p[0] for p in corners), min(p[1] for p in corners),
                                     max(p[0] for p in corners), max(p[1] for p in corners)]
            cell = original.read(band, window=Window(column, row, 1, 1), masked=True)
            raw = cell.data[0, 0].item()
            result.update(raw_value=_json(raw), raw_value_text=_scalar_text(raw))
            masked = bool(np.ma.getmaskarray(cell)[0, 0])
            if masked:
                result["reason"] = "original raster mask or nodata"
                return result
            if not math.isfinite(raw):
                result["reason"] = "nonfinite original numeric value"
                return result
            scale, offset = result["scale"], result["offset"]
            if not math.isfinite(scale) or not math.isfinite(offset):
                raise ValueError("The original raster scale and offset must be finite")
            value = raw if scale == 1 and offset == 0 else raw * scale + offset
            if not math.isfinite(value):
                result["reason"] = "nonfinite physical value after original scale and offset"
                return result
            result.update(valid=True, reason=None, value=_json(value), value_text=_scalar_text(value))
            if record["public"].get("categorical"):
                original_categories = self._source_categories(record)
                code = int(value) if value == int(value) else value
                result["category"] = {"value": _json(value),
                                      "label": original_categories["labels"].get(code, "Code " + _scalar_text(value))}
                result["category_source"] = {key: item for key, item in original_categories.items()
                                             if key != "labels"}
            return result

    def point(self, payload):
        from pyproj import CRS, Transformer
        from shapely.geometry import shape, Point, mapping
        from shapely.ops import transform
        layers = self._layers()
        raw = payload.get("point")
        if not isinstance(raw, dict):
            raise ValueError("Inspect a point with its original coordinate reference system")
        point_crs = CRS.from_user_input(raw.get("crs"))
        point = {"x": _number(raw.get("x"), "Point x"), "y": _number(raw.get("y"), "Point y"),
                 "crs": point_crs.to_string()}
        clicked = Point(point["x"], point["y"])
        tolerance = _number(payload.get("tolerance", 0), "Feature query tolerance", minimum=0)
        pixels, descriptions = {}, {}
        for name in ("primary", "comparison"):
            selected = payload.get(name)
            if selected is None:
                pixels[name], descriptions[name] = None, None
            else:
                selection, record = self._selected(selected, layers, kind="raster")
                descriptions[name] = self._describe(selection, record)
                pixels[name] = self._pixel(selection, record, point)
        pair = self._pair(descriptions["primary"], descriptions["comparison"])
        delta = None
        if pair["comparable"] and all(pixels[n]["valid"] for n in ("primary", "comparison")):
            value = pixels["comparison"]["value"] - pixels["primary"]["value"]
            if math.isfinite(value):
                delta = {"value": value, "value_text": _scalar_text(value),
                         "units": pixels["primary"]["units"], "direction": VIEW_DIFFERENCE_DIRECTION}
        selections = payload.get("overlays", [])
        if not isinstance(selections, list) or len(selections) > MAX_OVERLAYS:
            raise ValueError("Select up to " + str(MAX_OVERLAYS) + " original vector overlays")
        groups = []
        for selected in selections:
            selection, record = self._selected(selected, layers, kind="vector")
            found, truncated = [], False
            with self._vector(selection, record) as (original, native, layer):
                reverse = Transformer.from_crs(point_crs, native, always_xy=True)
                projection = Transformer.from_crs(native, point_crs, always_xy=True)
                if tolerance:
                    query = reverse.transform_bounds(point["x"] - tolerance, point["y"] - tolerance,
                                                     point["x"] + tolerance, point["y"] + tolerance,
                                                     densify_pts=21, errcheck=True)
                else:
                    x, y = reverse.transform(point["x"], point["y"], errcheck=True)
                    epsilon = max(abs(x), abs(y), 1.0) * 1e-12
                    query = (x - epsilon, y - epsilon, x + epsilon, y + epsilon)
                where = selection.get("where", {})
                for feature in original.filter(bbox=tuple(query)):
                    if any(not _scalar_matches(feature["properties"].get(k), v) for k, v in where.items()):
                        continue
                    geometry = _feature_shape(feature)
                    if geometry is None or geometry.is_empty:
                        continue
                    if not geometry.is_valid:
                        raise ValueError("Source feature " + str(feature.id) + " requires an explicit geometry correction")
                    projected = transform(projection.transform, geometry) if native != point_crs else geometry
                    covers = projected.covers(clicked)
                    distance = float(projected.distance(clicked))
                    near = tolerance > 0 and distance <= tolerance
                    if not covers and not near:
                        continue
                    if len(found) == MAX_POINT_FEATURES:
                        truncated = True
                        break
                    found.append(self._feature(feature, geometry, geometry_crs=native.to_string(), include_original=True,
                                               display_geometry=_json(mapping(projected)),
                                               display_geometry_crs=point_crs.to_string(),
                                               match="covers" if covers else "within selected tolerance",
                                               distance=distance, distance_crs=point_crs.to_string()))
            groups.append({"selection": {**selection, "layer": layer}, "layer": record["public"],
                           "features": found, "truncated": truncated, "tolerance": tolerance,
                           "tolerance_crs": point_crs.to_string()})
        return {"point": point, **pixels, "difference": delta, "features": groups, "pair": pair}

    @staticmethod
    def _binding(selection, record, native=None):
        public = record["public"]
        value = {"selection": selection, "sha256": public["sha256"], "bytes": public["bytes"],
                 "group": public["group"], "owner_id": public["owner_id"], "role": public["role"]}
        for name in ("source_collection_id", "source_id", "source_uri", "vintage", "run_id", "grid_id",
                     "profile_id", "scenario_id", "baseline_run_id", "alternative_run_id", "direction",
                     "receiving_water_plan_id", "receiving_water_analysis_id", "subject_id",
                     "subject_kind", "family", "relationship_precision", "quantity_scope",
                     "quantity", "statistic", "normalization_id", "relationship_method",
                     "source_body_sha256", "source_selection_id", "invest_version"):
            if name in public:
                value[name] = public[name]
        if native is not None:
            value["native"] = {k: native[k] for k in (
                "kind", "crs", "crs_wkt", "units", "band", "selected_layer",
                "width", "height", "transform", "dtypes", "nodata_text", "scales", "offsets",
                "reader", "reader_source_sha256", "native_collection", "source_spatial_reference",
                "source_geometry_type", "source_object_id_field", "decoded_sha256",
                "geometry_operation_count") if k in native}
        return value

    def save(self, payload):
        from pyproj import CRS
        if not isinstance(payload, dict):
            raise ValueError("Save the complete selected spatial review")
        layers = self._layers()
        reference, reference_record = self._selected(payload.get("reference"), layers)
        mode = payload.get("mode", "single")
        if mode not in MODES:
            raise ValueError("Choose a supported spatial comparison mode")
        view = payload.get("view")
        if not isinstance(view, dict):
            raise ValueError("Open the actual geographic viewport before saving the review")
        view = {"crs": CRS.from_user_input(view.get("crs")).to_string(),
                "bounds": _bounds(view.get("bounds"))}
        value = {"title": _text(payload.get("title"), "Review title"),
                 "project_id": self.workspace.project["id"], "reference": reference,
                 "mode": mode, "view": view, "scale": self._scale_request(payload.get("scale")),
                 "swipe": _number(payload.get("swipe", 50), "Comparison swipe percentage", minimum=0, maximum=100),
                 "overlays": [], "markers": [], "notes": _text(payload.get("notes", ""), "Review notes", limit=16000, empty=True)}
        selected = [(reference, reference_record)]
        descriptions = {}
        for name in ("primary", "comparison"):
            raw = payload.get(name)
            if raw is None:
                value[name], descriptions[name] = None, None
            else:
                choice, record = self._selected(raw, layers, kind="raster")
                value[name] = choice
                selected.append((choice, record))
                descriptions[name] = self._describe(choice, record)
        if mode == "difference":
            pair = self._pair(descriptions["primary"], descriptions["comparison"])
            if not pair["difference_available"]:
                raise ValueError(pair["reason"])
        overlays = payload.get("overlays", [])
        if not isinstance(overlays, list) or len(overlays) > MAX_OVERLAYS:
            raise ValueError("Select up to " + str(MAX_OVERLAYS) + " original review overlays")
        for overlay in overlays:
            if not isinstance(overlay, dict):
                raise ValueError("Each saved overlay retains its original selection and drawing style")
            choice, record = self._selected(overlay.get("selection"), layers, kind="vector")
            style = overlay.get("style", "solid")
            if style not in {"solid", "dash", "dot"}:
                raise ValueError("Overlay style must be solid, dash or dot")
            visible = overlay.get("visible", True)
            if not isinstance(visible, bool):
                raise ValueError("Overlay visibility must be true or false")
            value["overlays"].append({"selection": choice,
                                      "label": _text(overlay.get("label", record["public"]["title"]),
                                                     "Overlay label", limit=500, empty=True),
                                      "visible": visible, "style": style,
                                      "width": _number(overlay.get("width", 1), "Overlay line width", minimum=.25, maximum=8),
                                      "opacity": _number(overlay.get("opacity", 1), "Overlay opacity", minimum=0, maximum=1)})
            selected.append((choice, record))
        markers = payload.get("markers", [])
        if not isinstance(markers, list) or len(markers) > MAX_MARKERS:
            raise ValueError("Retain up to 200 point annotations in one spatial review")
        for marker in markers:
            if not isinstance(marker, dict):
                raise ValueError("A review annotation retains x, y and its label in the saved view CRS")
            value["markers"].append({"x": _number(marker.get("x"), "Annotation x"),
                                     "y": _number(marker.get("y"), "Annotation y"),
                                     "label": _text(marker.get("label", ""), "Annotation label", limit=1000, empty=True)})
        if payload.get("previous_review_id"):
            previous = self.workspace._get("spatial-reviews", identifier(payload["previous_review_id"]))
            if previous.get("project_id") != self.workspace.project["id"]:
                raise ValueError("The previous spatial review belongs to another scientific project")
            value["previous_review_id"] = previous["id"]
        bindings, seen = [], set()
        for choice, record in selected:
            identity = digest(choice)
            if identity in seen:
                continue
            seen.add(identity)
            description = self._describe(choice, record)
            bindings.append(self._binding(choice, record, description["native"]))
        value["bindings"] = bindings
        from .atlas_reviews import save_context
        save_context(self.workspace, self, payload, value, layers=layers)
        # Preserve original content identities and native backup lock order.
        # The operator's existing task identity makes a received save retry safe.
        with held(self.workspace.root / ".workspace.lock"):
            return self.workspace._save("spatial-reviews", value)

    def validate_saved(self, review, *, verified_members=None):
        """Validate receiving against original members without opening GIS runtimes."""
        if review.get("project_id") != self.workspace.project["id"]:
            raise ValueError("Saved spatial review belongs to another original scientific project")
        if review.get("schema") != "upstate.spatial-reviews/v1":
            raise ValueError("Saved spatial review schema differs")
        _bounds(review.get("view", {}).get("bounds"))
        _text(review.get("view", {}).get("crs"), "Saved view CRS", limit=20000)
        if review.get("mode") not in MODES:
            raise ValueError("Saved spatial review mode differs")
        self._scale_request(review.get("scale"))
        _number(review.get("swipe", 50), "Saved comparison swipe percentage", minimum=0, maximum=100)
        layers, expected_choices = self._layers(), []
        for name in ("reference", "primary", "comparison"):
            raw = review.get(name)
            if raw is None and name != "reference":
                continue
            choice, record = self._selected(raw, layers, kind="raster" if name != "reference" else None)
            expected_choices.append((choice, record))
        for overlay in review.get("overlays", []):
            expected_choices.append(self._selected(overlay["selection"], layers, kind="vector"))
        expected = {digest(choice): (choice, record) for choice, record in expected_choices}
        bindings = review.get("bindings")
        if not isinstance(bindings, list) or len(bindings) != len(expected):
            raise ValueError("Saved spatial review source bindings differ")
        seen = set()
        for binding in bindings:
            key = digest(binding.get("selection"))
            if key in seen or key not in expected:
                raise ValueError("Saved spatial review repeats or changes an original selection")
            seen.add(key)
            choice, record = expected[key]
            original = self._binding(choice, record)
            if {k: binding.get(k) for k in original} != original:
                raise ValueError("Saved spatial review original source identity changed")
            if verified_members is not None:
                if record["source"] is not None:
                    entry = record["source"][2]
                    required = [("workspace/" + b["object"], b) for b in [entry["body"]] + entry.get("companions", [])]
                else:
                    relative = Path(record["scope"]).relative_to(self.workspace.root) / record["file"]["path"]
                    required = [("workspace/" + relative.as_posix(), record["file"])]
                for name, body in required:
                    member = verified_members.get(name)
                    if member is None or member.get("sha256") != body["sha256"] or member.get("bytes") != body["bytes"]:
                        raise ValueError("Saved spatial review lacks its original archived source member: " + name)
        if review.get("previous_review_id"):
            previous = self.workspace._get("spatial-reviews", identifier(review["previous_review_id"]))
            if previous.get("project_id") != self.workspace.project["id"]:
                raise ValueError("Saved spatial review history belongs to another project")
        from .atlas_reviews import validate_saved_context
        validate_saved_context(self.workspace, self, review, layers=layers)
        return {"id": review["id"], "project_id": review["project_id"], "bindings": len(bindings), "identity": "MATCH"}
