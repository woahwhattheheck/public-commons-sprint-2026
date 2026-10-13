"""Compare retained exported and received GIS working editions in the original Workspace."""
from __future__ import annotations

import base64
from collections.abc import Mapping
from copy import deepcopy
from datetime import datetime, timezone
import csv
import html
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import zipfile

from . import gis_project as gis

SCHEMA = "upstate.gis-edition-review/v1"
VERSION = "received-gis-review/v2"
WINDOW = 512


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Choose an original retained GIS identity")
    return value


def _plain(value):
    if hasattr(value, "__geo_interface__"):
        return _plain(value.__geo_interface__)
    if isinstance(value, Mapping):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, bytes):
        return {"binary_base64": base64.b64encode(value).decode("ascii")}
    if isinstance(value, float) and not math.isfinite(value):
        return {"nonfinite": str(value)}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "item"):
        return _plain(value.item())
    if hasattr(value, "isoformat"):
        return {"type": type(value).__name__, "value": value.isoformat()}
    return {"type": type(value).__name__, "value": str(value)}


def _json(value):
    return json.dumps(_plain(value), ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def _project(workspace, kind, key):
    key = _id(key)
    prefix = "gis-exports" if kind == "export" else "gis-received"
    name = "export.json" if kind == "export" else "receipt.json"
    path = gis.local(workspace.root, prefix + "/" + key + "/" + name)
    record = gis.load(path)
    if (record.get("id") != key or record.get("project_id") != workspace.project["id"]
            or record.get("state") != "complete"):
        raise ValueError("Choose a complete GIS edition from this original Workspace")
    root = path.parent / "project"
    result = gis.verify(root, native=False)
    if result["fingerprint"] != record["result"]["fingerprint"]:
        raise ValueError("The retained GIS working edition differs from its original record")
    manifest = gis.load(root / "project.json")
    expected = gis.fingerprint({"request": manifest["source_request"],
                                "builder_version": manifest["builder_version"]})
    if expected != manifest["selection_id"] or result["selection_id"] != expected:
        raise ValueError("The GIS selection differs from its original request")
    if result["edition_id"] != record["result"]["edition_id"]:
        raise ValueError("The GIS edition differs from its retained result")
    return root, record, manifest, gis.record(workspace.root, path), result


def _pair(workspace, selection):
    original = _project(workspace, "export", selection["export_id"])
    received = _project(workspace, "received", selection["receipt_id"])
    before, after = original[2], received[2]
    if (before["selection_id"] != after["selection_id"]
            or before["source_request"] != after["source_request"]):
        raise ValueError("Choose the retained export of this exact received GIS selection")
    left = {row["id"]: row for row in before["layers"]}
    right = {row["id"]: row for row in after["layers"]}
    if len(left) != len(before["layers"]) or len(right) != len(after["layers"]) or left.keys() != right.keys():
        raise ValueError("GIS layer identities differ from the original exported selection")
    for key, row in left.items():
        other = right[key]
        if not re.fullmatch(r"gis_[0-9a-f]{32}", row.get("key", "")):
            raise ValueError("Choose an original generated GIS layer key")
        for name in ("key", "originals", "source", "working_path", "purpose", "metric",
                     "run_id", "scenario_id", "profile_id", "direction"):
            if row.get(name) != other.get(name):
                raise ValueError("The received layer changed its original scientific identity: " + key)
        if row["data"]["kind"] != other["data"]["kind"]:
            raise ValueError("A received layer changed its original data kind")
        for name in ("source_identity_field", "source_field_map"):
            if row["data"].get(name) != other["data"].get(name):
                raise ValueError("A received vector changed its retained source identity mapping")
    binding = {"schema": SCHEMA + "/selection", "version": VERSION,
               "project_id": workspace.project["id"], "export_id": original[1]["id"],
               "receipt_id": received[1]["id"], "selection_id": before["selection_id"],
               "exported_edition_id": before["edition_id"], "received_edition_id": after["edition_id"],
               "exported_fingerprint": original[4]["fingerprint"],
               "received_fingerprint": received[4]["fingerprint"],
               "export_record": original[3], "receiving_record": received[3]}
    return original, received, binding


def _vector(before_root, before, after_root, after, folder):
    import fiona
    from pyproj import CRS
    from shapely.geometry import shape
    field = before["data"]["source_identity_field"]
    database = folder / "features.sqlite"
    database.unlink(missing_ok=True)
    db = sqlite3.connect(database)
    db.execute("CREATE TABLE features (edition INTEGER, ordinal INTEGER, identity TEXT, fid TEXT, props TEXT, geom TEXT)")
    headers = []
    try:
        for edition, root, row in ((0, before_root, before), (1, after_root, after)):
            with fiona.open(gis.local(root, row["working_path"]), layer=row["data"]["layer"]) as src:
                headers.append({"crs": src.crs_wkt or dict(src.crs),
                                "fields": dict(src.schema["properties"]),
                                "geometry_schema": src.schema["geometry"],
                                "identity_field": field})
                for ordinal, feature in enumerate(src):
                    props = _plain(feature["properties"])
                    identity = props.get(field)
                    identity = identity if isinstance(identity, str) and identity != "" else None
                    db.execute("INSERT INTO features VALUES (?,?,?,?,?,?)",
                               (edition, ordinal, identity, str(feature.id), _json(props),
                                _json(feature["geometry"])))
                db.commit()
        db.execute("CREATE INDEX feature_identity ON features (edition,identity)")
        db.execute("""CREATE TABLE counts AS SELECT identity,
                   SUM(CASE WHEN edition=0 THEN 1 ELSE 0 END) AS n0,
                   SUM(CASE WHEN edition=1 THEN 1 ELSE 0 END) AS n1
                   FROM features WHERE identity IS NOT NULL GROUP BY identity""")
        db.execute("CREATE UNIQUE INDEX counts_identity ON counts(identity)")
        crs_equal = CRS.from_user_input(headers[0]["crs"]) == CRS.from_user_input(headers[1]["crs"])
        counts = {"before_features": db.execute("SELECT COUNT(*) FROM features WHERE edition=0").fetchone()[0],
                  "after_features": db.execute("SELECT COUNT(*) FROM features WHERE edition=1").fetchone()[0],
                  "paired": 0, "unchanged": 0, "changed": 0, "attributes_changed": 0,
                  "coordinates_changed": 0, "geometry_changed": 0, "geometry_unpaired": 0,
                  "geometry_errors": 0, "added": 0, "removed": 0,
                  "ambiguous_identity": 0, "missing_identity": 0}
        field_changes = {}
        sample = []
        with (folder / "changes.jsonl").open("w", encoding="utf-8") as output, \
                (folder / "changes.csv").open("w", encoding="utf-8", newline="") as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=["change", "identity", "before_fid", "after_fid",
                                                        "changed_fields", "coordinates_changed",
                                                        "geometry_equivalent", "geometry_status"])
            writer.writeheader()
            def emit(value):
                output.write(_json(value) + "\n")
                writer.writerow({"change": value["change"], "identity": value.get("identity"),
                    "before_fid": (value.get("before") or {}).get("fid"),
                    "after_fid": (value.get("after") or {}).get("fid"),
                    "changed_fields": _json(value.get("changed_fields", [])),
                    **value.get("geometry_change", {})})
                if len(sample) < 20:
                    sample.append({key: value.get(key) for key in
                                   ("change", "identity", "changed_fields", "geometry_change")})
            query = """SELECT a.identity,a.fid,a.props,a.geom,b.fid,b.props,b.geom
                       FROM counts c JOIN features a ON a.identity=c.identity AND a.edition=0
                       JOIN features b ON b.identity=c.identity AND b.edition=1
                       WHERE c.n0=1 AND c.n1=1 ORDER BY a.ordinal"""
            for identity, oldfid, oldprops, oldgeom, newfid, newprops, newgeom in db.execute(query):
                counts["paired"] += 1
                p0, p1, g0, g1 = json.loads(oldprops), json.loads(newprops), json.loads(oldgeom), json.loads(newgeom)
                fields = [key for key in sorted(p0.keys() | p1.keys())
                          if key not in p0 or key not in p1 or _json(p0[key]) != _json(p1[key])]
                coordinate_change = oldgeom != newgeom
                geometry_status, equivalent = "same coordinates", True
                if not crs_equal:
                    geometry_status, equivalent = "different CRS; geometry unpaired", None
                    counts["geometry_unpaired"] += 1
                elif coordinate_change:
                    try:
                        equivalent = g0 is None and g1 is None
                        if g0 is not None and g1 is not None:
                            equivalent = bool(shape(g0).equals(shape(g1)))
                        geometry_status = "topologically equivalent" if equivalent else "geometry changed"
                        counts["geometry_changed"] += not equivalent
                    except Exception as exc:
                        equivalent, geometry_status = None, "geometry comparison error: " + type(exc).__name__
                        counts["geometry_errors"] += 1
                if not fields and not coordinate_change and crs_equal:
                    counts["unchanged"] += 1
                    continue
                counts["changed"] += 1
                counts["attributes_changed"] += bool(fields)
                counts["coordinates_changed"] += coordinate_change
                for key in fields:
                    field_changes[key] = field_changes.get(key, 0) + 1
                emit({"change": "updated", "identity": identity, "changed_fields": fields,
                      "geometry_change": {"coordinates_changed": coordinate_change,
                          "geometry_equivalent": equivalent, "geometry_status": geometry_status},
                      "before": {"fid": oldfid, "properties": p0, "geometry": g0},
                      "after": {"fid": newfid, "properties": p1, "geometry": g1}})
            query = """SELECT f.edition,f.identity,f.fid,f.props,f.geom,c.n0,c.n1
                       FROM features f LEFT JOIN counts c ON f.identity=c.identity
                       WHERE f.identity IS NULL OR c.n0!=1 OR c.n1!=1
                       ORDER BY f.edition,f.ordinal"""
            for edition, identity, fid, props, geometry, n0, n1 in db.execute(query):
                if identity is None:
                    reason = "missing_identity"
                elif n0 > 1 or n1 > 1:
                    reason = "ambiguous_identity"
                else:
                    reason = "removed" if edition == 0 else "added"
                counts[reason] += 1
                emit({"change": reason, "identity": identity,
                      "identity_occurrences": {"exported": n0 or 0, "received": n1 or 0},
                      "before" if edition == 0 else "after":
                          {"fid": fid, "properties": json.loads(props), "geometry": json.loads(geometry)}})
        return {"method": "Exact source identity; full attributes; coordinate and topological geometry comparison.",
                "headers": {"exported": headers[0], "received": headers[1]}, "crs_equal": crs_equal,
                "counts": counts, "changed_fields": field_changes, "sample": sample,
                "records": "changes.jsonl", "table": "changes.csv"}
    finally:
        db.close()
        database.unlink(missing_ok=True)


def _raster_header(src):
    return {"crs": src.crs.to_wkt() if src.crs else None,
            "width": src.width, "height": src.height, "transform": list(src.transform)[:6],
            "bands": src.count, "dtypes": list(src.dtypes),
            "nodata": _plain(src.nodatavals), "scales": list(src.scales), "offsets": list(src.offsets),
            "units": list(src.units), "descriptions": list(src.descriptions),
            "mask_flags": [[value.name for value in flags] for flags in src.mask_flag_enums]}


def _raster(before_root, before, after_root, after, folder):
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    left = gis.local(before_root, before["working_path"])
    right = gis.local(after_root, after["working_path"])
    with rasterio.open(left) as a, rasterio.open(right) as b:
        headers = {"exported": _raster_header(a), "received": _raster_header(b)}
        band0, band1 = int(before["data"]["band"]), int(after["data"]["band"])
        same_grid = (a.crs is not None and a.crs == b.crs and a.width == b.width
                     and a.height == b.height and tuple(a.transform) == tuple(b.transform))
        same_band = band0 == band1 and band0 <= min(a.count, b.count)
        units_equal = before["data"]["units"] == after["data"]["units"]
        result = {"method": "Exact selected-band native-cell comparison; received minus exported.",
                  "scope": "The selected logical GIS band; all-band header metadata is retained separately.",
                  "headers": headers, "selected_bands": {"exported": band0, "received": band1},
                  "units": {"exported": before["data"]["units"], "received": after["data"]["units"]},
                  "same_grid": same_grid, "same_band": same_band, "units_equal": units_equal}
        if not same_grid or not same_band:
            return {**result, "comparison": "unpaired grid or selected band",
                    "reason": "Original native cells are retained; no resampling or substitute pairing is applied."}
        if any(np.issubdtype(np.dtype(src.dtypes[band-1]), np.complexfloating)
               for src, band in ((a, band0), (b, band1))):
            return {**result, "comparison": "unpaired complex-valued band"}
        scale0, offset0 = a.scales[band0-1], a.offsets[band0-1]
        scale1, offset1 = b.scales[band1-1], b.offsets[band1-1]
        if not all(math.isfinite(x) for x in (scale0, offset0, scale1, offset1)):
            raise ValueError("The original raster has a nonfinite scale or offset")
        numeric = units_equal and before.get("purpose") != "categorical" and after.get("purpose") != "categorical"
        counts = {"cells": a.width*a.height, "common_valid": 0, "added_valid": 0, "removed_valid": 0,
                  "neither_valid": 0, "exported_nonfinite_unmasked": 0, "received_nonfinite_unmasked": 0,
                  "raw_changed_common": 0, "physical_changed_common": 0}
        stats = {"count": 0, "minimum": None, "maximum": None, "mean": 0.0, "rms": 0.0}
        counts["unrepresentable_difference_cells"] = 0
        decimal_cells = 0
        profile = {"driver": "GTiff", "width": a.width, "height": a.height, "count": 1,
                   "crs": a.crs, "transform": a.transform, "compress": "deflate",
                   "tiled": True, "blockxsize": WINDOW, "blockysize": WINDOW}
        support_path = folder / "support-change.tif"
        delta_path = folder / "value-change.tif"
        delta = rasterio.open(delta_path, "w", **profile, dtype="float64", nodata=float("nan")) if numeric else None
        try:
            with rasterio.open(support_path, "w", **profile, dtype="uint8") as support:
                support.update_tags(meaning="0 neither finite-valid; 1 both finite-valid; 2 added finite-valid; 3 removed finite-valid",
                                    direction="received minus exported")
                if delta:
                    delta.update_tags(units=str(after["data"]["units"]), direction="received minus exported",
                                      support="common finite-valid cells with a representable float64 received-minus-exported difference")
                for row in range(0, a.height, WINDOW):
                    for col in range(0, a.width, WINDOW):
                        window = Window(col, row, min(WINDOW, a.width-col), min(WINDOW, a.height-row))
                        old, new = a.read(band0, window=window, masked=True), b.read(band1, window=window, masked=True)
                        om, nm = np.ma.getmaskarray(old), np.ma.getmaskarray(new)
                        of, nf = np.isfinite(old.data), np.isfinite(new.data)
                        ov, nv = (~om)&of, (~nm)&nf
                        common, added, removed = ov&nv, (~ov)&nv, ov&(~nv)
                        counts["common_valid"] += int(common.sum())
                        counts["added_valid"] += int(added.sum())
                        counts["removed_valid"] += int(removed.sum())
                        counts["neither_valid"] += int((~ov&~nv).sum())
                        counts["exported_nonfinite_unmasked"] += int((~om&~of).sum())
                        counts["received_nonfinite_unmasked"] += int((~nm&~nf).sum())
                        # Python numeric comparison avoids unsafe int64/uint64 promotion
                        # when a recipient changes the native encoding.
                        unequal = (old.data != new.data if old.dtype == new.dtype else
                                   old.data.astype(object) != new.data.astype(object))
                        counts["raw_changed_common"] += int((common&unequal).sum())
                        codes = np.zeros(old.shape, dtype="uint8")
                        codes[common], codes[added], codes[removed] = 1, 2, 3
                        support.write(codes, 1, window=window)
                        if numeric:
                            old_values, new_values = old.data[common], new.data[common]
                            unsafe_integer = any(np.issubdtype(v.dtype, np.integer) and
                                any(abs(int(x)) > 2**53 for x in (v.min(), v.max()))
                                for v in (old_values, new_values) if v.size)
                            accurate_scalar = (unsafe_integer or scale0 != scale1 or offset0 != offset1)
                            if accurate_scalar:
                                # Decimal represents every native integer and each binary64
                                # scale/offset exactly. 5000 digits exceed the exponent span of
                                # products and differences of finite binary64 inputs.
                                from decimal import Decimal, localcontext
                                numeric_values = np.empty(old_values.size, dtype="float64")
                                changed = 0
                                with localcontext() as context:
                                    context.prec = 5000
                                    def number(value):
                                        return Decimal(int(value)) if isinstance(value, np.integer) else Decimal.from_float(float(value))
                                    ds0, ds1 = Decimal.from_float(scale0), Decimal.from_float(scale1)
                                    do = Decimal.from_float(offset1)-Decimal.from_float(offset0)
                                    for i, (x, y) in enumerate(zip(old_values, new_values)):
                                        difference_value = number(y)*ds1-number(x)*ds0+do
                                        changed += difference_value != 0
                                        rounded = float(difference_value)
                                        if not math.isfinite(rounded) or (rounded == 0 and difference_value != 0):
                                            numeric_values[i] = np.nan
                                            counts["unrepresentable_difference_cells"] += 1
                                        else:
                                            numeric_values[i] = rounded
                                decimal_cells += int(old_values.size)
                            else:
                                # Cancel identical offsets first; multiplying the native
                                # difference avoids loss from a large shared offset.
                                with np.errstate(over="ignore", invalid="ignore", under="ignore"):
                                    raw_difference = new_values.astype("float64")-old_values.astype("float64")
                                    numeric_values = raw_difference*scale0
                                changed_mask = (old_values != new_values) & (scale0 != 0)
                                changed = int(changed_mask.sum())
                                unrepresentable = (~np.isfinite(numeric_values)) | ((numeric_values == 0)&changed_mask)
                                # A finite physical difference can exist even when the raw
                                # subtraction overflows. Recover those cases exactly.
                                if unrepresentable.any():
                                    from decimal import Decimal, localcontext
                                    with localcontext() as context:
                                        context.prec = 5000
                                        ds = Decimal.from_float(scale0)
                                        for i in np.flatnonzero(unrepresentable):
                                            x, y = old_values[i], new_values[i]
                                            dx = Decimal(int(x)) if isinstance(x,np.integer) else Decimal.from_float(float(x))
                                            dy = Decimal(int(y)) if isinstance(y,np.integer) else Decimal.from_float(float(y))
                                            exact = (dy-dx)*ds
                                            rounded = float(exact)
                                            numeric_values[i] = rounded if math.isfinite(rounded) and not (rounded == 0 and exact != 0) else np.nan
                                            decimal_cells += 1
                                    counts["unrepresentable_difference_cells"] += int((~np.isfinite(numeric_values)).sum())
                            counts["physical_changed_common"] += changed
                            difference = np.full(old.shape, np.nan, dtype="float64")
                            difference[common] = numeric_values
                            delta.write(difference, 1, window=window)
                            values = numeric_values[np.isfinite(numeric_values)]
                            if values.size:
                                prior, total = stats["count"], stats["count"]+int(values.size)
                                low, high = float(values.min()), float(values.max())
                                stats["minimum"] = low if stats["minimum"] is None else min(stats["minimum"], low)
                                stats["maximum"] = high if stats["maximum"] is None else max(stats["maximum"], high)
                                magnitude = float(np.max(np.abs(values)))
                                mean = float((values/magnitude).mean())*magnitude if magnitude else 0.0
                                rms = math.sqrt(float(np.square(values/magnitude).mean()))*magnitude if magnitude else 0.0
                                stats["mean"] = stats["mean"]*(prior/total) + mean*(values.size/total)
                                stats["rms"] = math.hypot(stats["rms"]*math.sqrt(prior/total),
                                                          rms*math.sqrt(values.size/total))
                                stats["count"] = total
                result["physical_precision"] = {
                    "method": "Equal offsets cancel before arithmetic; unequal encodings/scales use exact Decimal inputs; final delta storage is float64.",
                    "decimal_evaluated_cells": decimal_cells,
                    "unrepresentable": "Nonzero differences below float64 or overflowing its range are explicitly counted and stored as NoData; exact change counts and native sources remain retained."}
        finally:
            if delta:
                delta.close()
        count = stats["count"]
        result.update(comparison="paired native cells", counts=counts,
                      support="support-change.tif", support_codes={"0": "neither valid", "1": "common valid",
                          "2": "added valid", "3": "removed valid"})
        if numeric:
            result["value_change"] = "value-change.tif"
            result["difference"] = {"direction": "received minus exported", "units": after["data"]["units"],
                "valid_cells": count, "minimum": stats["minimum"], "maximum": stats["maximum"],
                "mean": stats["mean"] if count else None,
                "rmse": stats["rms"] if count else None}
        else:
            counts.pop("physical_changed_common", None)
            counts.pop("unrepresentable_difference_cells", None)
            result["physical_comparison"] = "Raw category/encoding changes and valid support; arithmetic differences are not assigned across categories or different units."
        return result


def _members(root, layer):
    """All actual working-directory companions, not just the primary TIFF hash."""
    path = layer["working_path"]
    prefix = str(Path(path).parent).replace("\\", "/") + "/"
    inv = gis.load(root / "inventory.json")
    if layer["data"]["kind"] == "raster":
        return [row for row in inv["files"] if row["path"] == path or row["path"].startswith(prefix)]
    return [row for row in inv["files"] if row["path"] == path
            or row["path"].startswith(path+"-") or row["path"].startswith(path+".")]


def _report_html(report, directory):
    from .gis_review_raster import render
    return render(report, directory)


def _folder(workspace, receipt_id, review_id):
    return workspace.root / "gis-received" / _id(receipt_id) / "reviews" / _id(review_id)


def read(workspace, receipt_id, review_id, *, verify_files=True):
    folder = _folder(workspace, receipt_id, review_id)
    state = gis.load(gis.local(workspace.root, (folder/"review-state.json").relative_to(workspace.root).as_posix()))
    if (state.get("schema") != SCHEMA or state.get("id") != review_id or state.get("state") != "complete"
            or state["selection"]["receipt_id"] != receipt_id
            or state["selection"]["project_id"] != workspace.project["id"]
            or gis.fingerprint(state["selection"]) != review_id):
        raise ValueError("Choose a complete original GIS edition review from this Workspace")
    if verify_files:
        for item in state["files"].values():
            gis.checked(folder, item)
    return folder, state


def review(workspace, selection, *, progress=None):
    if "review_version" in selection and selection["review_version"] != VERSION:
        raise ValueError("The selected GIS review producer version changed; reopen the current catalogue before submitting a new review")
    original, received, binding = _pair(workspace, selection)
    key = gis.fingerprint(binding)
    folder = _folder(workspace, binding["receipt_id"], key)
    folder.mkdir(parents=True, exist_ok=True)
    with gis.locked(folder / ".review.lock"):
        state_path = folder / "review-state.json"
        old = {}
        if state_path.exists():
            old = gis.load(state_path)
            if old["selection"] != binding:
                raise ValueError("The original GIS review selection changed")
            if old["state"] == "complete":
                return read(workspace, binding["receipt_id"], key)[1]
        state = {"schema": SCHEMA, "id": key, "state": "running", "selection": binding,
                 "title": received[2]["title"] + " · received edition review",
                 "created_at": old.get("created_at") or datetime.now(timezone.utc).isoformat(),
                 "layers": [], "files": {}}
        gis.save(state_path, state)
        try:
            left, right = {x["id"]: x for x in original[2]["layers"]}, {x["id"]: x for x in received[2]["layers"]}
            for index, (layer_id, before) in enumerate(left.items()):
                after = right[layer_id]
                directory = folder / "layers" / before["key"]
                checkpoint = directory / "layer.json"
                if checkpoint.exists():
                    value = gis.load(checkpoint)
                    if value.get("layer_id") != layer_id or value.get("selection") != key:
                        raise ValueError("A retained layer review belongs to a different selection")
                    for rec in value["files"]:
                        gis.checked(folder, rec)
                else:
                    if directory.exists():
                        shutil.rmtree(directory)
                    directory.mkdir(parents=True)
                    compare = _vector if before["data"]["kind"] == "vector" else _raster
                    comparison = compare(original[0], before, received[0], after, directory)
                    view_path = None
                    if before["data"]["kind"] == "raster":
                        from .gis_review_raster import build as build_raster_view
                        view_path = build_raster_view(directory, comparison)
                    # A layer checkpoint becomes reusable only after all actual native
                    # data and mask/sidecar members still match their input inventory.
                    for source_root, source_layer in ((original[0], before), (received[0], after)):
                        for member in _members(source_root, source_layer):
                            gis.checked(source_root, member)
                    value = {"selection": key, "layer_id": layer_id, "title": after["title"],
                        "kind": before["data"]["kind"], "units": after["data"]["units"],
                        "source": deepcopy(before.get("source")),
                        "exported_working_files": _members(original[0], before),
                        "received_working_files": _members(received[0], after),
                        "comparison": comparison,
                        "files": [gis.record(folder, p) for p in sorted(directory.iterdir()) if p.is_file()]}
                    if view_path is not None:
                        value["raster_view"] = gis.record(folder, view_path)
                    value["working_files_changed"] = value["exported_working_files"] != value["received_working_files"]
                    headers = comparison.get("headers", {})
                    old_header, new_header = headers.get("exported", {}), headers.get("received", {})
                    value["metadata_changed"] = sorted(name for name in old_header.keys() | new_header.keys()
                        if _json(old_header.get(name)) != _json(new_header.get(name)))
                    if before["data"]["units"] != after["data"]["units"]:
                        value["metadata_changed"].append("declared units")
                    gis.save(checkpoint, value)
                state["layers"].append(value)
                gis.save(state_path, state)
                if progress:
                    progress({"phase": "reviewing-gis-edition", "layer_id": layer_id,
                              "completed": index+1, "total": len(left), "review_id": key})
            # Recheck complete original input fingerprints before finishing a review.
            try:
                for root, rec, manifest, descriptor, result in (original, received):
                    gis.checked(workspace.root, descriptor)
                    if gis.verify(root, native=False)["fingerprint"] != result["fingerprint"]:
                        raise ValueError("A retained GIS input changed during review")
            except Exception:
                # A restored input must never cause mixed-input checkpoints from
                # this failed attempt to be reused under the original binding.
                for checkpoint in (folder / "layers").glob("*/layer.json"):
                    checkpoint.unlink(missing_ok=True)
                raise
            gis.save(folder / "exported-project.json", original[2])
            gis.save(folder / "received-project.json", received[2])
            report = {**state, "state": "complete"}
            gis.save(folder / "review.json", report)
            (folder / "REVIEW.html").write_text(_report_html(report, folder), encoding="utf-8")
            with (folder / "layers.csv").open("w", encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=["layer_id", "title", "kind", "units",
                    "working_files_changed", "comparison", "counts"])
                writer.writeheader()
                for row in report["layers"]:
                    writer.writerow({key: row.get(key) for key in
                        ("layer_id", "title", "kind", "units", "working_files_changed")} |
                        {"comparison": row["comparison"].get("comparison", row["comparison"].get("method")),
                         "counts": _json(row["comparison"].get("counts", {}))})
            paths = [p for p in sorted(folder.rglob("*")) if p.is_file()
                     and p.name not in {".review.lock", "review-state.json", "review.zip"}]
            with zipfile.ZipFile(folder / "review.zip", "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for path in paths:
                    archive.write(path, path.relative_to(folder).as_posix())
            state["state"] = "complete"
            state["files"] = {p.relative_to(folder).as_posix(): gis.record(folder, p)
                              for p in [*paths, folder / "review.zip"]}
            gis.save(state_path, state)
            return read(workspace, binding["receipt_id"], key)[1]
        except Exception as exc:
            state["state"] = "failed"
            state["error"] = {"type": type(exc).__name__, "message": str(exc)}
            gis.save(state_path, state)
            raise


def adoption_context(workspace, receipt_id, review_id, fingerprint):
    folder, state = read(workspace, receipt_id, review_id)
    if state["selection"]["received_fingerprint"] != fingerprint:
        raise ValueError("Choose a review of this exact received working edition")
    return folder, state, {"id": state["id"], "selection": state["selection"],
                          "review": state["files"]["review.json"],
                          "archive": state["files"]["review.zip"]}
