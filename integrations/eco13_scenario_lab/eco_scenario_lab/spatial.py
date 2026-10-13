"""Grid-exact land-cover intervention preparation, without changing model science."""
from __future__ import annotations
import csv
from collections import Counter
from pathlib import Path
from typing import Any
import fiona
import numpy as np
from pyproj import CRS, Transformer
import rasterio
from rasterio.features import rasterize
from shapely.geometry import box, shape
from shapely.ops import transform
from shapely.strtree import STRtree
from .store import ScenarioError, atomic_json, file_hash, inside


def _integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ScenarioError(f"{label} must be an integer")
    return value


def validate_tables(plan: dict, root: Path, codes: set[int]) -> None:
    for model, entry in plan["models"].items():
        path = inside(root, entry["args"]["biophysical_table_path"])
        with path.open(newline="", encoding="utf-8-sig") as source:
            rows = list(csv.DictReader(source))
        try:
            table_codes = [int(row["lucode"]) for row in rows]
        except (ValueError, KeyError) as exc:
            raise ScenarioError(f"{model} table needs integer lucode values") from exc
        if len(set(table_codes)) != len(table_codes):
            raise ScenarioError(f"{model} biophysical table has duplicate lucode values")
        absent = codes - set(table_codes)
        if absent:
            raise ScenarioError(f"{model} biophysical table misses LULC codes {sorted(absent)}")


def prepare_lulc(plan: dict, root: Path, scenario: dict, output: Path) -> dict:
    source = inside(root, plan["lulc_path"])
    rules = scenario.get("interventions", [])
    pixel_rule = plan.get("pixel_rule", "center")
    if pixel_rule not in {"center", "all_touched"}:
        raise ScenarioError("pixel_rule must be center or all_touched")
    with rasterio.open(source) as src:
        if src.count != 1 or np.dtype(src.dtypes[0]).kind not in "iu":
            raise ScenarioError("LULC must be a one-band categorical integer raster")
        if not src.crs:
            raise ScenarioError("LULC needs an explicit CRS")
        crs = CRS.from_user_input(src.crs)
        if not crs.is_projected or any(abs(a.unit_conversion_factor - 1.0) > 1e-12 for a in crs.axis_info[:2]):
            raise ScenarioError("Native scenario LULC must use a projected metre CRS")
        if src.scales != (1.0,) or src.offsets != (0.0,):
            raise ScenarioError("Categorical LULC cannot use scale/offset conversion")
        if src.transform.b or src.transform.d or src.transform.a <= 0 or src.transform.e >= 0:
            raise ScenarioError("Scenario grid must be north-up with positive width and negative height")
        dtype = np.dtype(src.dtypes[0])
        info = np.iinfo(dtype)
        geometries = []
        geometry_rules = []
        seen_ids: set[str] = set()
        selected: dict[str, int] = {}
        for rule_index, rule in enumerate(rules):
            code = _integer(rule["to_code"], "to_code")
            if not info.min <= code <= info.max or code == src.nodata:
                raise ScenarioError("Target code is not representable or equals nodata")
            for from_code in rule.get("from_codes", []):
                _integer(from_code, "from_code")
            if not rule.get("parcel_ids"):
                raise ScenarioError("Every intervention needs explicit parcel_ids")
            for identifier in rule["parcel_ids"]:
                identifier = str(identifier)
                if identifier in seen_ids:
                    raise ScenarioError(f"Parcel appears in more than one intervention: {identifier}")
                seen_ids.add(identifier)
                selected[identifier] = rule_index
        if rules:
            parcels = inside(root, plan["parcels_path"])
            with fiona.open(parcels, layer=plan.get("parcels_layer")) as collection:
                if not collection.crs:
                    raise ScenarioError("Parcels need an explicit CRS")
                transformer = Transformer.from_crs(collection.crs, crs, always_xy=True)
                all_ids: set[str] = set()
                found: set[str] = set()
                for feature in collection:
                    raw = feature["properties"].get(plan["parcel_id_field"])
                    if raw is None:
                        raise ScenarioError("Parcel identifier cannot be null")
                    identifier = str(raw)
                    if identifier in all_ids:
                        raise ScenarioError(f"Duplicate parcel identifier: {identifier}")
                    all_ids.add(identifier)
                    if identifier not in selected:
                        continue
                    geom = shape(feature["geometry"])
                    if geom.is_empty or not geom.is_valid or geom.geom_type not in {"Polygon", "MultiPolygon"}:
                        raise ScenarioError(f"Parcel needs valid polygon geometry: {identifier}")
                    geom = transform(transformer.transform, geom)
                    geometries.append(geom)
                    geometry_rules.append((selected[identifier], identifier))
                    found.add(identifier)
                if found != seen_ids:
                    raise ScenarioError(f"Unknown parcel IDs: {sorted(seen_ids-found)}")
        tree = STRtree(geometries) if geometries else None
        profile = src.profile.copy()
        # A new GeoTIFF preserves grid, category dtype and original nodata mask.
        profile.update(driver="GTiff", tiled=True, blockxsize=512, blockysize=512,
                       compress="deflate", BIGTIFF="IF_SAFER")
        profile.pop("photometric", None)
        output.parent.mkdir(parents=True, exist_ok=True)
        if output.exists():
            raise ScenarioError("Prepared scenario output already exists")
        summary = {"scenario_id": scenario["id"], "pixel_rule": pixel_rule,
                   "original_sha256": file_hash(source), "crs": crs.to_string(),
                   "pixel_area_m2": abs(src.transform.a * src.transform.e),
                   "valid_pixels": 0, "changed_pixels": 0, "parcels": {}, "transition_pixels": {}}
        transitions: Counter = Counter()
        codes: set[int] = set()
        coverage: Counter = Counter()
        for identifier in seen_ids:
            summary["parcels"][identifier] = {"selected_pixels": 0, "eligible_pixels": 0, "changed_pixels": 0}
        try:
            with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True), rasterio.open(output, "w", **profile) as dst:
                for _, window in dst.block_windows(1):
                    data = src.read(1, window=window)
                    valid = src.read_masks(1, window=window) > 0
                    changed = data.copy()
                    occupied = np.zeros(data.shape, dtype=np.bool_)
                    summary["valid_pixels"] += int(valid.sum())
                    if tree is not None:
                        bounds = rasterio.windows.bounds(window, src.transform)
                        for index in sorted(tree.query(box(*bounds)).tolist()):
                            rule_index, identifier = geometry_rules[index]
                            rule = rules[rule_index]
                            mask = rasterize([(geometries[index], 1)], out_shape=data.shape,
                                             transform=src.window_transform(window), fill=0,
                                             dtype="uint8", all_touched=pixel_rule == "all_touched").astype(bool)
                            mask &= valid
                            if np.any(mask & occupied):
                                raise ScenarioError("Selected parcels overlap on the intervention grid; split or dissolve them explicitly")
                            occupied |= mask
                            coverage[identifier] += int(mask.sum())
                            stats = summary["parcels"][identifier]
                            stats["selected_pixels"] += int(mask.sum())
                            eligible = mask.copy()
                            if "from_codes" in rule:
                                eligible &= np.isin(data, rule["from_codes"])
                            stats["eligible_pixels"] += int(eligible.sum())
                            applied = eligible & (data != rule["to_code"])
                            stats["changed_pixels"] += int(applied.sum())
                            unique, counts = np.unique(data[applied], return_counts=True)
                            for original, count in zip(unique.tolist(), counts.tolist()):
                                transitions[f"{original}->{rule['to_code']}"] += count
                            changed[applied] = rule["to_code"]
                    summary["changed_pixels"] += int(np.count_nonzero((changed != data) & valid))
                    codes.update(int(v) for v in np.unique(changed[valid]))
                    dst.write(changed, 1, window=window)
                    dst.write_mask(valid.astype("uint8") * 255, window=window)
                dst.update_tags(source_sha256=summary["original_sha256"],
                                scenario_id=scenario["id"], pixel_rule=pixel_rule)
            if any(coverage[p] == 0 for p in seen_ids):
                raise ScenarioError("Selected parcel has no valid grid cells under the chosen pixel rule")
            validate_tables(plan, root, codes)
        except BaseException:
            output.unlink(missing_ok=True)
            Path(str(output) + ".msk").unlink(missing_ok=True)
            raise
        summary["transition_pixels"] = dict(sorted(transitions.items()))
        summary["changed_area_ha"] = summary["changed_pixels"] * summary["pixel_area_m2"] / 10000
        summary["lulc_sha256"] = file_hash(output)
        atomic_json(output.with_suffix(".json"), summary)
        return summary
