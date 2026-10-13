"""Full-resolution statistics for retained native raster regions.

SpatialReview owns original layer identities, source materialisation, units and
pair compatibility. This module reads native windows and stores ordinary
scientific workspace records; display pixels never enter the calculation.
"""
from __future__ import annotations

from collections import Counter
from contextlib import ExitStack
import copy
import csv
import io
import math

from .common import digest, held, identifier
from .spatial import SpatialReview, _bounds, _integer, _number, _text

ALGORITHM = "native-region-statistics/v1"
KIND = "spatial-regions"
TILE_SIZE = 512


def _geometry(value):
    from pyproj import CRS
    from shapely.geometry import shape, mapping
    if not isinstance(value, dict):
        raise ValueError("Choose a region with its original coordinate reference system")
    crs = CRS.from_user_input(value.get("crs"))
    if value.get("geometry") is not None:
        raw = value["geometry"]
    else:
        left, bottom, right, top = _bounds(value.get("bounds"), "Region bounds")
        raw = {"type": "Polygon", "coordinates": [[[left, bottom], [right, bottom],
               [right, top], [left, top], [left, bottom]]]}
    if not isinstance(raw, dict) or raw.get("type") not in {"Polygon", "MultiPolygon"}:
        raise ValueError("Region analysis requires a polygon or multipolygon")
    def coordinates(node):
        if not isinstance(node, (list, tuple)) or not node:
            raise ValueError("Region coordinates must be nonempty")
        if isinstance(node[0], (list, tuple)):
            for child in node:
                coordinates(child)
        else:
            if len(node) != 2:
                raise ValueError("Use two-dimensional region coordinates")
            for number in node:
                _number(number, "Region coordinate")
    coordinates(raw.get("coordinates"))
    geom = shape(raw)
    if geom.is_empty or not geom.is_valid or geom.area <= 0:
        raise ValueError("Use a nonempty valid polygon; retain any source geometry correction explicitly")
    if not all(math.isfinite(v) for v in geom.bounds):
        raise ValueError("Region coordinates must be finite")
    return {"crs": crs.to_string(), "geometry": mapping(geom)}, crs


def _project_geometry(region, target_crs, transform):
    """Densify transformed edges to at most 0.05 original grid cells."""
    from pyproj import CRS, Transformer
    from shapely.geometry import shape, mapping
    origin, target = CRS.from_user_input(region["crs"]), CRS.from_user_input(target_crs)
    if origin == target:
        return copy.deepcopy(region["geometry"]), {"method": "original-coordinates", "tolerance_cells": 0}
    projection = Transformer.from_crs(origin, target, always_xy=True)
    inverse = ~transform
    def projected(point):
        x, y = projection.transform(point[0], point[1], errcheck=True)
        if not math.isfinite(x) or not math.isfinite(y):
            raise ValueError("The region extends outside the selected raster projection")
        return (x, y)
    def pixel(point):
        return inverse * point
    def segment(a, b, pa, pb, depth=0):
        qa, qb = pixel(pa), pixel(pb)
        samples = []
        error = 0.0
        for fraction in (.25, .5, .75):
            p = (a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction)
            actual = projected(p)
            q = pixel(actual)
            expected = (qa[0] + (qb[0] - qa[0]) * fraction,
                        qa[1] + (qb[1] - qa[1]) * fraction)
            error = max(error, math.hypot(q[0] - expected[0], q[1] - expected[1]))
            samples.append((p, actual))
        if error <= .05:
            return [pb]
        if depth >= 20:
            raise ValueError("This region crosses a projection discontinuity; select a continuous map region")
        mid, pm = samples[1]
        return segment(a, mid, pa, pm, depth + 1) + segment(mid, b, pm, pb, depth + 1)
    def ring(points):
        out = [projected(points[0])]
        for a, b in zip(points, points[1:]):
            out.extend(segment(a, b, out[-1], projected(b)))
        return out
    raw = region["geometry"]
    polygons = [raw["coordinates"]] if raw["type"] == "Polygon" else raw["coordinates"]
    result = {"type": "MultiPolygon", "coordinates": [[ring(r) for r in p] for p in polygons]}
    geom = shape(result)
    if not geom.is_valid or geom.is_empty or not all(math.isfinite(v) for v in geom.bounds):
        raise ValueError("The region cannot be represented continuously in the selected native grid")
    return mapping(geom), {"method": "adaptive-edge-projection", "tolerance_cells": .05,
                           "source_crs": origin.to_string(), "target_crs": target.to_string()}


def _cell_area(source):
    from pyproj import CRS
    crs = CRS.from_user_input(source.crs)
    determinant = abs(source.transform.a * source.transform.e -
                      source.transform.b * source.transform.d)
    if crs.is_projected and len(crs.axis_info) >= 2:
        factors = [axis.unit_conversion_factor for axis in crs.axis_info[:2]]
        if all(isinstance(x, (int, float)) and math.isfinite(x) and x > 0 for x in factors):
            return {"value": determinant * factors[0] * factors[1], "units": "m2",
                    "meaning": "native projected grid cell area"}
    return {"value": None, "units": None,
            "meaning": "cell counts retained; geographic-grid cell areas are not treated as equal metric areas"}


class _Accumulator:
    def __init__(self, categorical=False):
        self.categorical = categorical
        self.count = 0
        self.minimum = self.maximum = None
        self.mean = self.m2 = 0.0
        self.sums = []
        self.categories = Counter()
        self.edges = self.histogram = None

    def add(self, values):
        import numpy as np
        n = int(values.size)
        if not n:
            return
        if self.categorical:
            unique, counts = np.unique(values, return_counts=True)
            for value, count in zip(unique.tolist(), counts.tolist()):
                self.categories[value] += int(count)
            self.count += n
            return
        low, high = float(np.min(values)), float(np.max(values))
        with np.errstate(over="raise", invalid="raise"):
            mean = float(np.mean(values, dtype=np.float64))
            centred = values - mean
            m2 = float(np.sum(centred * centred, dtype=np.float64))
            total = float(np.sum(values, dtype=np.float64))
        combined = self.count + n
        delta = mean - self.mean
        self.m2 += m2 + delta * delta * self.count * n / combined
        self.mean += delta * n / combined
        self.count = combined
        self.minimum = low if self.minimum is None else min(self.minimum, low)
        self.maximum = high if self.maximum is None else max(self.maximum, high)
        self.sums.append(total)
        if not all(math.isfinite(x) for x in (self.m2, self.mean, total)):
            raise ValueError("Native values exceed finite statistic precision")

    def prepare_histogram(self, bins):
        import numpy as np
        if self.categorical or not self.count or self.minimum == self.maximum:
            return
        self.edges = np.linspace(self.minimum, self.maximum, bins + 1, dtype=np.float64)
        self.edges = np.unique(self.edges)
        self.histogram = np.zeros(len(self.edges) - 1, dtype=np.int64)

    def add_histogram(self, values):
        import numpy as np
        if self.edges is not None and values.size:
            self.histogram += np.histogram(values, bins=self.edges)[0]

    def finish(self):
        value = {"count": self.count, "kind": "categorical" if self.categorical else "continuous"}
        if self.categorical:
            value["categories"] = [{"value": number, "count": count,
                                    "fraction_of_valid": count / self.count}
                                   for number, count in sorted(self.categories.items())]
            return value
        value.update(minimum=self.minimum, maximum=self.maximum,
                     mean=self.mean if self.count else None,
                     standard_deviation=math.sqrt(max(0.0, self.m2 / self.count)) if self.count else None,
                     sum_native_pixel_values=math.fsum(self.sums) if self.count else None,
                     standard_deviation_definition="population over selected valid native cells",
                     sum_meaning="sum of native physical pixel values; no density-to-total conversion")
        if not self.count:
            value["histogram"] = {"edges": [], "counts": [], "count": 0}
        elif self.minimum == self.maximum:
            value["histogram"] = {"edges": [self.minimum, self.maximum], "counts": [self.count],
                                  "count": self.count, "constant_value": self.minimum}
        else:
            counts = self.histogram.tolist()
            if sum(counts) != self.count:
                raise ValueError("Original native cells changed between statistic and histogram passes")
            value["histogram"] = {"edges": self.edges.tolist(), "counts": counts, "count": self.count}
        return value


def _windows(source, geometry):
    from rasterio.errors import WindowError
    from rasterio.features import geometry_window
    from rasterio.windows import Window
    try:
        window = geometry_window(source, [geometry])
    except WindowError:
        return
    left, top = int(window.col_off), int(window.row_off)
    right, bottom = left + int(window.width), top + int(window.height)
    for row in range(top, bottom, TILE_SIZE):
        for col in range(left, right, TILE_SIZE):
            yield Window(col, row, min(TILE_SIZE, right - col), min(TILE_SIZE, bottom - row))


def _inside(source, window, geometry, all_touched):
    from rasterio.features import geometry_mask
    return geometry_mask([geometry], (int(window.height), int(window.width)),
                         source.window_transform(window), invert=True, all_touched=all_touched)


def _values(source, band, window):
    import numpy as np
    raw = source.read(band, window=window, masked=True)
    if raw.dtype.kind not in {"i", "u", "f"}:
        raise ValueError("Region statistics require a real numeric native raster band")
    valid = ~np.ma.getmaskarray(raw)
    stored = np.asarray(raw.data)
    if raw.dtype.kind in {"i", "u"} and raw.dtype.itemsize >= 8:
        selected = stored[valid]
        if selected.size and (np.max(selected) > 2 ** 53 or np.min(selected) < -(2 ** 53)):
            raise ValueError("Native integer values exceed exact float64 statistic precision")
    valid &= np.isfinite(stored)
    scale, offset = float(source.scales[band - 1]), float(source.offsets[band - 1])
    if not math.isfinite(scale) or not math.isfinite(offset):
        raise ValueError("Native raster scale and offset must be finite")
    # Masked storage sentinels need not survive scaling. Convert valid cells only.
    values = np.zeros(raw.shape, dtype=np.float64)
    with np.errstate(over="raise", invalid="raise"):
        values[valid] = stored[valid].astype(np.float64) * scale + offset
    valid &= np.isfinite(values)
    return values, valid


class SpatialRegions:
    def __init__(self, workspace, *, spatial=None):
        self.workspace = workspace
        self.spatial = spatial or SpatialReview(workspace)

    def _request(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("Retain a complete region analysis selection")
        region, _ = _geometry(payload.get("region"))
        all_touched = payload.get("all_touched", False)
        if not isinstance(all_touched, bool):
            raise ValueError("Native cell inclusion must be true or false")
        request = {"algorithm": ALGORITHM, "project_id": self.workspace.project["id"],
                   "title": _text(payload.get("title"), "Region analysis title"),
                   "notes": _text(payload.get("notes", ""), "Region analysis notes", limit=16000, empty=True),
                   "region": region, "all_touched": all_touched,
                   "histogram_bins": _integer(payload.get("histogram_bins", 32), "Histogram bins", minimum=2, maximum=256)}
        layers, selected, descriptions, bindings = self.spatial._layers(), {}, {}, {}
        for name in ("primary", "comparison"):
            raw = payload.get(name)
            if raw is None and name == "comparison":
                request[name], descriptions[name] = None, None
                continue
            choice, record = self.spatial._selected(raw, layers, kind="raster")
            native = self.spatial._describe(choice, record)
            selected[name] = (choice, record)
            descriptions[name] = native
            bindings[name] = self.spatial._binding(choice, record, native["native"])
            request[name] = choice
        request["bindings"] = bindings
        if payload.get("source_feature"):
            feature = payload["source_feature"]
            if not isinstance(feature, dict):
                raise ValueError("The selected source feature must retain its original layer and identifier")
            choice, record = self.spatial._selected(feature.get("selection"), layers, kind="vector")
            feature_id = str(feature.get("id", ""))
            if not feature_id:
                raise ValueError("The selected source feature requires its original identifier")
            # Resolve the retained feature again; browser coordinates cannot replace its geometry.
            from shapely.geometry import mapping
            from .spatial import _feature_shape, _scalar_matches
            with self.spatial._vector(choice, record) as (source, crs, layer):
                found = None
                for original in source:
                    if str(original.id) != feature_id:
                        continue
                    if any(not _scalar_matches(original["properties"].get(k), v)
                           for k, v in choice.get("where", {}).items()):
                        continue
                    geom = _feature_shape(original)
                    if geom is None or not geom.is_valid or geom.is_empty or geom.geom_type not in {"Polygon", "MultiPolygon"}:
                        raise ValueError("This original source feature is not a valid polygon")
                    found = {"crs": crs.to_string(), "geometry": mapping(geom)}
                    break
                if found is None:
                    raise ValueError("The selected original polygon is absent from this source edition")
                request["region"], _ = _geometry(found)
                request["source_feature"] = {"selection": {**choice, "layer": layer}, "id": feature_id,
                                             "binding": self.spatial._binding(choice, record)}
        return request, selected, descriptions

    def analyze(self, payload, *, progress=None):
        import numpy as np
        import rasterio
        request, selected, descriptions = self._request(payload)
        request_sha = digest(request)
        for retained in self.workspace._list(KIND):
            if retained.get("request_sha256") == request_sha:
                return self.inspect(retained["id"])
        pair = self.spatial._pair(descriptions["primary"], descriptions["comparison"])
        results, accumulators = {}, {}
        def report(stage, **details):
            if progress:
                progress({"stage": stage, **details})
        with ExitStack() as stack:
            sources, regions, projections = {}, {}, {}
            for name, (choice, record) in selected.items():
                path, _ = stack.enter_context(self.spatial._reading(record))
                source = stack.enter_context(rasterio.open(path))
                sources[name] = source
                regions[name], projections[name] = _project_geometry(request["region"], source.crs, source.transform)
                accumulators[name] = _Accumulator(bool(descriptions[name]["native"]["categorical"]))
            paired = {}
            if pair["comparable"]:
                paired = {name: _Accumulator() for name in ("primary", "comparison", "difference")}
            for name, source in sources.items():
                choice = selected[name][0]
                accumulator = accumulators[name]
                count = 0
                for index, window in enumerate(_windows(source, regions[name]), 1):
                    inside = _inside(source, window, regions[name], request["all_touched"])
                    count += int(np.count_nonzero(inside))
                    values, valid = _values(source, choice["band"], window)
                    accumulator.add(values[inside & valid])
                    if name == "primary" and paired:
                        alternate, alternate_valid = _values(sources["comparison"], selected["comparison"][0]["band"], window)
                        common = inside & _inside(sources["comparison"], window, regions["comparison"], request["all_touched"]) & valid & alternate_valid
                        a, b = values[common], alternate[common]
                        paired["primary"].add(a)
                        paired["comparison"].add(b)
                        paired["difference"].add(b - a)
                    if index % 16 == 0:
                        report("statistics", layer=name, windows=index, selected_cells=count)
                results[name] = {"layer": copy.deepcopy(descriptions[name]["layer"]),
                                 "selection": choice, "units": descriptions[name]["native"]["units"],
                                 "selected_native_cell_count": count,
                                 "valid_cell_count": accumulator.count,
                                 "nodata_or_nonfinite_cell_count": count - accumulator.count,
                                 "valid_fraction_within_source": accumulator.count / count if count else None,
                                 "cell_area": _cell_area(source),
                                 "native_region": regions[name], "projection": projections[name]}
                area = results[name]["cell_area"]["value"]
                results[name]["selected_grid_area_m2"] = count * area if area is not None else None
                results[name]["valid_grid_area_m2"] = accumulator.count * area if area is not None else None
                accumulator.prepare_histogram(request["histogram_bins"])
            for accumulator in paired.values():
                accumulator.prepare_histogram(request["histogram_bins"])
            for name, source in sources.items():
                needs_pair = name == "primary" and any(a.edges is not None for a in paired.values())
                if accumulators[name].edges is None and not needs_pair:
                    continue
                for index, window in enumerate(_windows(source, regions[name]), 1):
                    inside = _inside(source, window, regions[name], request["all_touched"])
                    values, valid = _values(source, selected[name][0]["band"], window)
                    accumulators[name].add_histogram(values[inside & valid])
                    if needs_pair:
                        alternate, alternate_valid = _values(sources["comparison"], selected["comparison"][0]["band"], window)
                        common = inside & _inside(sources["comparison"], window, regions["comparison"], request["all_touched"]) & valid & alternate_valid
                        a, b = values[common], alternate[common]
                        paired["primary"].add_histogram(a)
                        paired["comparison"].add_histogram(b)
                        paired["difference"].add_histogram(b - a)
                    if index % 16 == 0:
                        report("histogram", layer=name, windows=index)
            for name, accumulator in accumulators.items():
                results[name]["statistics"] = accumulator.finish()
            comparison = None
            if paired:
                common_count = paired["difference"].count
                area = _cell_area(sources["primary"])["value"]
                comparison = {"direction": pair["direction"], "units": results["primary"]["units"],
                              "common_valid_cell_count": common_count,
                              "common_valid_grid_area_m2": common_count * area if area is not None else None,
                              "baseline_only_valid_cell_count": accumulators["primary"].count - common_count,
                              "alternative_only_valid_cell_count": accumulators["comparison"].count - common_count,
                              **{name: accumulator.finish() for name, accumulator in paired.items()}}
                denominator = comparison["primary"]["sum_native_pixel_values"]
                numerator = comparison["difference"]["sum_native_pixel_values"]
                comparison["relative_change_percent_of_common_baseline"] = (
                    numerator / denominator * 100 if numerator is not None and denominator not in (None, 0) else None)
        value = {"request": request, "request_sha256": request_sha,
                 "project_id": self.workspace.project["id"], "title": request["title"], "notes": request["notes"],
                 "algorithm": ALGORITHM, "results": results, "pair": pair, "comparison": comparison,
                 "sampling": {"resolution": "original native raster cells", "resampling": "none",
                              "cell_inclusion": "all touched" if request["all_touched"] else "native cell centre",
                              "tile_size": TILE_SIZE, "histogram": "exact bin counts over all selected valid cells",
                              "nodata": "original dataset mask, NaN and infinity excluded",
                              "comparison_mask": "selected cells valid in both aligned original rasters",
                              "scale_offset": "original band scale and offset applied before statistics"}}
        report("retaining", request_sha256=request_sha)
        with held(self.workspace.root / ".workspace.lock"):
            return self.workspace._save(KIND, value)

    def inspect(self, key):
        value = self.workspace._get(KIND, identifier(key))
        if value.get("project_id") != self.workspace.project["id"] or value.get("algorithm") != ALGORITHM:
            raise ValueError("This region analysis belongs to another scientific workspace or algorithm")
        request = value.get("request", {})
        if digest(request) != value.get("request_sha256"):
            raise ValueError("The retained region selection changed")
        layers = self.spatial._layers()
        bindings = list(request.get("bindings", {}).values())
        if request.get("source_feature"):
            bindings.append(request["source_feature"]["binding"])
        for binding in bindings:
            choice, record = self.spatial._selected(binding.get("selection"), layers)
            public = record["public"]
            if any(binding.get(name) != public.get(name) for name in ("sha256", "bytes", "group", "owner_id", "role")):
                raise ValueError("Restore the original source edition for this region analysis")
        return value

    def catalog(self):
        return [{name: value[name] for name in ("id", "title", "project_id", "request_sha256", "algorithm")}
                for value in self.workspace._list(KIND)]

    def verify(self):
        for value in self.workspace._list(KIND):
            self.inspect(value["id"])
        return {"region_analyses": len(self.workspace._list(KIND))}


def csv_exports(value):
    """Human-readable numeric tables derived from the retained calculation."""
    summary, histogram, categories = io.StringIO(newline=""), io.StringIO(newline=""), io.StringIO(newline="")
    sw, hw, cw = csv.writer(summary), csv.writer(histogram), csv.writer(categories)
    sw.writerow(["analysis_id", "series", "units", "selected_native_cells", "valid_cells", "minimum", "maximum",
                 "mean", "population_standard_deviation", "sum_native_pixel_values", "valid_native_grid_area_m2"])
    hw.writerow(["analysis_id", "series", "units", "bin_lower", "bin_upper", "count", "upper_edge_inclusive"])
    cw.writerow(["analysis_id", "series", "units", "native_category_value", "count", "fraction_of_valid"])
    series = [(name, row["statistics"], row.get("units"), row.get("selected_native_cell_count"),
               row.get("valid_grid_area_m2")) for name, row in value["results"].items()]
    comparison = value.get("comparison")
    if comparison:
        series.extend(("common_" + name, comparison[name], comparison["units"], comparison["common_valid_cell_count"],
                       comparison["common_valid_grid_area_m2"]) for name in ("primary", "comparison", "difference"))
    for name, stats, units, selected, area in series:
        sw.writerow([value["id"], name, units, selected, stats["count"], stats.get("minimum"), stats.get("maximum"),
                     stats.get("mean"), stats.get("standard_deviation"), stats.get("sum_native_pixel_values"), area])
        bins = stats.get("histogram", {})
        for index, count in enumerate(bins.get("counts", [])):
            hw.writerow([value["id"], name, units, bins["edges"][index], bins["edges"][index + 1],
                         count, index == len(bins["counts"]) - 1])
        for category in stats.get("categories", []):
            cw.writerow([value["id"], name, units, category["value"], category["count"], category["fraction_of_valid"]])
    return {"summary.csv": summary.getvalue(), "histograms.csv": histogram.getvalue(),
            "categories.csv": categories.getvalue()}
