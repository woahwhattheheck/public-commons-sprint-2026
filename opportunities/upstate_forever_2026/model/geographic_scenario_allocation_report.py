"""Present retained geographic allocation without recomputing native science.

The original allocation kernel owns raster support, counts and native quantities.
This module emits the maintained observed-report blocks and source-bound vector
figures. It never opens a raster, imports the kernel, or runs a native model.
"""
from __future__ import annotations

from collections import defaultdict
import math
import os
from pathlib import Path
import tempfile

from .common import atomic_json, describe_file, digest, file_digest, read_json, verify_file

SCHEMA = "upstate.geographic-scenario-allocation/v1"
EDITION = "geographic-scenario-allocation-report/1"
SPEC = "figures/allocation-figures.json"
INVENTORY = "figures/allocation-figure-members.json"
INPUTS = (
    ("allocation.json", "Complete allocation record"),
    ("regions.geojson", "Original projected region geometry"),
    ("allocations.csv", "Every region and alternative: allocation"),
    ("transitions.csv", "Every original land-cover transition"),
    ("native-support.csv", "Three-run common native support"),
    ("pairwise-native-quantities.csv", "Original pairwise annual native quantities"),
)
ROLES = ("baseline", "restoration", "control")
PAGE_ROWS = 28


def _finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Allocation report needs a finite " + name)
    return value


def _count(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("Allocation counts must retain exact nonnegative integers")
    return format(value, ",")


def _amount(value, *, signed=False):
    if value is None:
        return "Unavailable"
    value = _finite(value, "quantity")
    # A rounded nonzero allocation must not appear as a false exact zero.
    if value != 0 and abs(value) < .0005:
        return format(value, "+.6g" if signed else ".6g")
    return format(value, "+,.3f" if signed and value != 0 else ",.3f")


def _text(value):
    return str(value) if value is not None else "Not supplied"


def _table(columns, rows, caption):
    return {"kind": "table", "columns": columns, "rows": rows,
            "widths": None, "caption": caption}


def _tables(columns, rows, caption):
    if not rows:
        return ["No retained rows are available for this support."]
    result = []
    for start in range(0, len(rows), PAGE_ROWS):
        suffix = (" Rows " + str(start + 1) + "–" + str(min(start + PAGE_ROWS, len(rows)))
                  + " of " + str(len(rows)) + ".") if len(rows) > PAGE_ROWS else ""
        result.append(_table(columns, rows[start:start + PAGE_ROWS], caption + suffix))
    return result


def _group_label(key):
    kind, relationship, scope = key
    return " / ".join((_text(kind).replace("_", " "),
                       _text(relationship).replace("_", " "),
                       _text(scope).replace("_", " ")))


def _groups(report):
    groups = {}
    for row in report["regions"]:
        key = (row["kind"], row["relationship"], row["quantity_scope"])
        groups.setdefault(key, []).append(row)
    return groups


def _local_state(row):
    if row["selected_cells"] == 0:
        return "No selected cells"
    if row["common_valid_cells"] == 0:
        return "No three-run categorical support"
    balance = row["balance"]
    equal_area = balance["changed_cells_difference"] == 0
    equal_origins = all(item["difference_cells"] == 0 for item in balance["by_origin"])
    if equal_area and equal_origins:
        return "Equal changed counts and origin mix"
    if equal_area:
        return "Equal changed counts; origin mix differs"
    return "Changed counts differ"


def _origin_values(row, code):
    chosen = [item for item in row["balance"]["by_origin"]
              if item["from_code"] == code] if code is not None else [
                  item for item in row["balance"]["by_origin"] if item["from_code"] not in (81, 82)]
    return (_amount(sum(item["restoration_hectares"] for item in chosen)) + " / "
            + _amount(sum(item["control_hectares"] for item in chosen)))


def _sections(report):
    groups = _groups(report)
    sections = [[report["title"], [
        "SIMULATED SCENARIO ACCOUNTING. This report describes where the retained restoration and "
        "control scenarios actually changed the baseline land cover. It does not create scenarios, "
        "rerun a native model or turn land-cover hectares into pollutant reductions.",
        "Control matching was specified over the whole reporting selection. Local HUC or utility "
        "changed area and original class mix may differ even when the complete selection was matched. "
        "Each table keeps its own geographic relationship and quantity scope. Overlapping polygons, "
        "nested protection areas and family unions must not be summed.",
        "R denotes the retained restoration; C denotes the retained control. Delta is R minus C "
        "for changed land-cover hectares only. Primary allocation counts use finite land-cover "
        "cells common to baseline, R and C within the original region mask.",
        _table(["Retained selection", "Value"], [
            ["Project", report["project_id"]], ["Geographic preparation", report["prepared_id"]],
            ["Allocation", report["id"]], ["Baseline native run", report["run_ids"]["baseline"]],
            ["Restoration native run", report["run_ids"]["restoration"]],
            ["Control native run", report["run_ids"]["control"]],
            ["Projected grid", _text(report["grid"]["crs"])],
            ["Cell area (ha)", _amount(report["grid"]["pixel_area_ha"])],
            ["Matching scope", report["matching_scope"]],
        ], "Exact retained source and native identities. Full values are preserved in allocation.json."),
    ]]]
    summary = []
    for key, rows in groups.items():
        supported = [row for row in rows if row["common_valid_cells"] > 0]
        count_difference = sum(row["balance"]["changed_cells_difference"] != 0 for row in supported)
        class_difference = sum(any(item["difference_cells"] != 0 for item in row["balance"]["by_origin"])
                               for row in supported)
        summary.append([_group_label(key), _count(len(rows)), _count(len(supported)),
                        _count(count_difference), _count(class_difference)])
    sections.append(["Where local allocations differ", [
        "The counts below describe region records, not disjoint areas or affected utilities. A zero "
        "in the difference columns means exact changed-cell equality on the available categorical "
        "support; it does not establish equivalent hydrology, rainfall, delivered load or local matching.",
        *_tables(["Geography / relationship / scope", "Regions", "With common cells",
                  "Area counts differ", "Origin counts differ"], summary,
                 "Region diagnostics remain separate for each original geographic and reporting scope."),
    ]])
    for key, rows in groups.items():
        title = _group_label(key)
        allocation = [[row["title"], _count(row["common_valid_cells"]),
                       _amount(row["alternatives"]["restoration"]["changed_hectares"]),
                       _amount(row["alternatives"]["control"]["changed_hectares"]),
                       _amount(row["balance"]["changed_hectares_difference"], signed=True),
                       _local_state(row)] for row in rows]
        coverage = [[row["title"], _count(row["selected_cells"]),
                     *[_count(row["valid_cells"][role]) for role in ROLES],
                     _count(row["common_valid_cells"])] for row in rows]
        empty_with_cells = [row["title"] for row in rows
                            if row.get("vector_geometry_empty_with_selected_cells")]
        origins = [[row["title"], _origin_values(row, 81), _origin_values(row, 82),
                    _origin_values(row, None)] for row in rows]
        other_codes = sorted({item["from_code"] for row in rows for item in row["balance"]["by_origin"]
                              if item["from_code"] not in (81, 82)})
        blocks = [
            "This group retains the original " + _text(key[1]) + " relationship and "
            + _text(key[2]) + " quantity scope. Vector boundary area and raster-selected area "
            "are distinct. Common cells are an intersection of the three valid categorical rasters; "
            "missing cells are not treated as unchanged land.",
            *_tables(["Region", "Common cells", "R changed ha", "C changed ha", "R − C ha",
                      "Local accounting"], allocation,
                     "Exact cell-count equality determines the diagnostic; displayed hectares are rounded."),
            *_tables(["Region", "Selected cells", "Baseline valid", "R valid", "C valid",
                      "Common valid"], coverage,
                     "Original region mask and each categorical raster validity. These counts "
                     "retain the native raster mask, including any boundary cells that have no "
                     "nonempty vector display geometry."),
            *_tables(["Region", "Code 81 R / C ha", "Code 82 R / C ha", "Other origins R / C ha"],
                     origins, "Changed cells grouped by their original baseline class. All destination "
                     "codes, unchanged transitions and individual other origin codes are retained in "
                     "transitions.csv and allocation.json. Other changed origin codes in this group: "
                     + (", ".join(str(code) for code in other_codes) or "none") + "."),
        ]
        if empty_with_cells:
            blocks.append("Raster-mask support with empty display geometry: "
                          + "; ".join(empty_with_cells)
                          + ". Original selected cells and all quantities remain in the tables; "
                          "no substitute polygon or inferred geometry is drawn.")
        sections.append(["Local allocation — " + title, blocks])
    support_groups = defaultdict(list)
    quantity_groups = defaultdict(list)
    for key, rows in groups.items():
        for row in rows:
            for pollutant, value in row["native_support"].items():
                support_groups[(key, pollutant)].append([
                    row["title"], _count(value["native_common_cells"]),
                    _count(value["landcover_and_native_common_cells"]),
                    _amount(value["restoration_changed_hectares"]),
                    _amount(value["control_changed_hectares"])])
            for value in row["pairwise_native_quantities"]:
                quantity_groups[(key, value["pollutant"], value["units"])].append([
                    row["title"] + " / " + value["scenario"],
                    _count(value["common_cells"]), _amount(value["baseline_mass"]),
                    _amount(value["alternative_mass"]), _amount(value["signed_change"], signed=True)])
    sections.append(["Scientific support and interpretation", [
        "Three-run native support below counts finite annual-output cells common to baseline, R "
        "and C for one pollutant and one scope. The joint support also requires common categorical "
        "land cover. Changed hectares on this joint support describe the input allocation only.",
        "Original Receiving quantities use baseline-versus-each-alternative pairwise support. "
        "Their common-cell counts and baseline totals can differ between R and C. The original "
        "signed change is alternative minus baseline from the original stored Float32 difference pixels. "
        "Baseline and alternative totals retain their original numeric accumulation; subtracting those "
        "displayed totals need not exactly reproduce the stored signed change. These values are copied unchanged; no "
        "difference of R and C pairwise totals or benefit per changed hectare is calculated.",
        "Nitrogen and phosphorus retain annual kg/year; sediment retains metric tonnes/year. "
        "The modeled quantities represent land export delivered to streams within the named "
        "support. They are not intake concentrations, reservoir delivery, treatment removal or "
        "measured loads. HUC-local areas, upstream HUC associations and published protection "
        "areas are distinct spatial relationships.",
    ]])
    for (key, pollutant), rows in support_groups.items():
        sections.append(["Three-run support — " + pollutant + " / " + _group_label(key),
            _tables(["Region", "Native common cells", "Native + land-cover cells",
                     "R changed ha", "C changed ha"], rows,
                    "All-three native support and its land-cover intersection. Zero support remains "
                    "visible and cannot establish a balanced native response.")])
    for (key, pollutant, units), rows in quantity_groups.items():
        sections.append(["Original pairwise quantities — " + pollutant + " / " + _group_label(key), [
            "Units: " + units + ". Each row retains its own original baseline/alternative common "
            "support. A positive signed change is an increase in the original annual quantity.",
            *_tables(["Region / alternative", "Pair common cells", "Baseline", "Alternative",
                      "Original signed change"], rows,
                     "Original Receiving result; units " + units + ". Complete run IDs and values "
                     "are retained in pairwise-native-quantities.csv."),
        ]])
    notes = report.get("notes", [])
    if notes:
        sections.append(["Original allocation notes", [str(note) for note in notes]])
    sections.append(["Complete source data and editable geography", [
        "The attachments retain every region, exact integer count, full transition code, unit, "
        "native run identity and projected geometry. No region totals are added across overlaps. "
        "CSV files preserve the original numeric values; report tables only format their display.",
        {"kind": "links", "items": [{"path": path, "title": label} for path, label in INPUTS]},
    ]])
    return sections


def _nonempty(geometry):
    if geometry is None:
        return False
    if not isinstance(geometry, dict):
        raise ValueError("Allocation map needs retained GeoJSON geometry")
    if geometry.get("type") == "GeometryCollection":
        return any(_nonempty(part) for part in geometry.get("geometries", []))
    return bool(geometry.get("coordinates"))


def _extent(bank):
    from .scientific_map_figures import positions
    xmin = ymin = float("inf")
    xmax = ymax = float("-inf")
    for geometry in bank.values():
        for point in positions(geometry):
            xmin, xmax = min(xmin, point[0]), max(xmax, point[0])
            ymin, ymax = min(ymin, point[1]), max(ymax, point[1])
    margin = max(xmax - xmin, ymax - ymin, 1.0) * .06
    return [xmin - margin, ymin - margin, xmax + margin, ymax + margin]


def _map(report, key, rows, features, descriptor, crs, index):
    from shapely.geometry import shape
    from .scientific_map_figures import positions
    bank, layers, legend = {}, [], []
    nonempty = [(row, features[row["id"]]["geometry"]) for row in rows
                if _nonempty(features[row["id"]]["geometry"])]
    if not nonempty:
        return None
    for row, geometry in nonempty:
        # The native validator checks every original vertex and coordinate dimension.
        for unused in positions(geometry):
            pass
        geometry_id = digest(geometry)
        bank[geometry_id] = geometry
        for role in ("contribution", "receptor"):
            layers.append({"geometry": geometry_id, "role": role,
                           "receptor_id": row["id"], "source": descriptor})
        if len(nonempty) <= 6:
            anchor = shape(geometry).representative_point()
            legend.append({"label": row["title"], "receptor_id": row["id"],
                           "anchor": [anchor.x, anchor.y]})
    label = _group_label(key)
    return {
        "id": "allocation-map-" + format(index, "04d"),
        "title": "Original region geography — " + label,
        "caption": "All " + str(len(nonempty)) + " nonempty original region geometries in this group. "
                   "Grey fill and dark edges describe the same retained geographic boundaries, not "
                   "changed pixels, pollutant intensity or additive area. "
                   + str(len(rows) - len(nonempty)) + " empty geometries remain in the tables and "
                   "GeoJSON. No reprojection, simplification or basemap is applied. Grid north and "
                   "scale use the original projected metre CRS. Region values are in the corresponding "
                   "allocation tables; overlapping boundaries are not added.",
        "alt": "Original projected regions for " + label + "; allocation values are provided as tables.",
        "geometries": bank,
        "panels": [{"kind": "projected_geometry_map", "title": "Original allocation regions",
                    "bounds": _extent(bank), "crs": crs, "layers": layers, "legend": legend,
                    "role_labels": {"contribution": "Retained region area",
                                    "receptor": "Boundary of the same region"}}],
        "source_binding": {"project_id": report["project_id"], "allocation_id": report["id"],
                           "region_ids": [row["id"] for row in rows], "regions": descriptor},
        "method": {"coordinates": "Original projected XY", "reprojection": False,
                   "simplification": False, "basemap": None,
                   "labels": "Cartographic anchors only; not intake or sampling points",
                   "empty_geometries": [row["id"] for row in rows
                                        if not _nonempty(features[row["id"]]["geometry"])]},
    }


def _balance_plot(report, key, rows, descriptor, index):
    supported = [row for row in rows if row["common_valid_cells"] > 0]
    if not supported:
        return None
    points = [{"x": row["alternatives"]["control"]["changed_hectares"],
               "y": row["alternatives"]["restoration"]["changed_hectares"],
               "region_id": row["id"], "region_title": row["title"]}
              for row in supported]
    maximum = max([point[axis] for point in points for axis in ("x", "y")] + [0.0])
    upper = maximum * 1.08 if maximum > 0 else max(report["grid"]["pixel_area_ha"], 1.0)
    ticks = [{"value": upper * index / 4, "label": format(upper * index / 4, ".4g")}
             for index in range(5)]
    return {
        "id": "allocation-balance-" + format(index, "04d"),
        "title": "Local changed-area balance — " + _group_label(key),
        "caption": "One point per region with common categorical cells. The diagonal marks equal "
                   "restoration and control changed hectares. It is a descriptive reference, not a "
                   "test of local matching or model response. Coincident points can overlap. Regions "
                   "without common categorical support are excluded from this plot and remain in "
                   "the tables. Original values and region IDs are in the figure specification.",
        "alt": "Restoration changed hectares versus control changed hectares for every supported region.",
        "panels": [{"title": "Changed area by region",
                    "x": {"domain": [0, upper], "label": "Control changed area", "unit": "ha", "ticks": ticks},
                    "y": {"domain": [0, upper], "label": "Restoration", "unit": "ha", "ticks": ticks},
                    "series": [
                        {"geometry": "line", "markers": False, "label": "Equal changed hectares",
                         "points": [{"x": 0, "y": 0}, {"x": upper, "y": upper}]},
                        {"geometry": "scatter", "marker": "circle-open", "label": "Region",
                         "points": points},
                    ]}],
        "source_binding": {"project_id": report["project_id"], "allocation_id": report["id"],
                           "allocation": descriptor,
                           "region_ids": [row["id"] for row in supported]},
    }


def _bytes(path, body):
    path = Path(path)
    body = body.encode("utf-8") if isinstance(body, str) else body
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Retained allocation figure differs from its original rendering")
        return
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".allocation-", delete=False) as stream:
            pending = Path(stream.name)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(pending, path)
        except FileExistsError:
            if path.read_bytes() != body:
                raise ValueError("Concurrent allocation figure differs")
        if os.name != "nt":
            fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def write(directory: Path, report: dict, features: dict) -> dict:
    """Return native observed-report sections and complete retained figure members."""
    from pyproj import CRS
    from reportlab import Version as reportlab_version
    from reportlab.graphics import renderSVG
    from . import scientific_figures, scientific_map_figures
    directory = Path(directory)
    if report.get("schema") != SCHEMA or report.get("matching_scope") != "whole_reporting_area":
        raise ValueError("Use the original geographic three-scenario allocation record")
    if set(report.get("run_ids", {})) != set(ROLES) or len(set(report["run_ids"].values())) != 3:
        raise ValueError("Keep three distinct original baseline, restoration and control identities")
    if read_json(directory / "allocation.json") != report or read_json(directory / "regions.geojson") != features:
        raise ValueError("Report and map must use the exact retained allocation inputs")
    if features.get("type") != "FeatureCollection" or not isinstance(features.get("features"), list):
        raise ValueError("Allocation geography must retain its original FeatureCollection")
    regions = report.get("regions")
    if not isinstance(regions, list) or any(not isinstance(row, dict) for row in regions):
        raise ValueError("Allocation regions must be original records")
    region_ids = [row["id"] for row in regions]
    if len(set(region_ids)) != len(region_ids):
        raise ValueError("Allocation region identities must be unique")
    by_id = {}
    for feature in features["features"]:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError("Allocation map entries must be retained features")
        properties = feature.get("properties", {})
        key = properties.get("id")
        if key in by_id:
            raise ValueError("Allocation map region identities must be unique")
        by_id[key] = feature
    if set(by_id) != set(region_ids):
        raise ValueError("Allocation maps must retain exactly the report's region roster")
    for row in regions:
        properties = by_id[row["id"]]["properties"]
        for key in ("id", "title", "kind", "relationship", "quantity_scope"):
            if properties.get(key) != row[key]:
                raise ValueError("Map region differs from its original allocation record")
        expected = {"restoration_ha": row["alternatives"]["restoration"]["changed_hectares"],
                    "control_ha": row["alternatives"]["control"]["changed_hectares"],
                    "difference_ha": row["balance"]["changed_hectares_difference"]}
        if any(properties.get(key) != value for key, value in expected.items()):
            raise ValueError("Map allocation values differ from the retained report")
        for key in ("selected_cells", "common_valid_cells"):
            _count(row[key])
    area = _finite(report["grid"]["pixel_area_ha"], "positive pixel area")
    if area <= 0:
        raise ValueError("Allocation cell area must be positive")
    original_crs = CRS.from_user_input(report["grid"]["crs"])
    if (not original_crs.is_projected or len(original_crs.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1.0) > 1e-12 for axis in original_crs.axis_info[:2])):
        raise ValueError("Allocation figures require the original projected metre grid")
    crs = {"name": original_crs.name, "wkt": original_crs.to_wkt(), "axes": "XY", "units": "metre"}
    inputs = [describe_file(directory, directory / path) for path, unused in INPUTS]
    identity = {"schema": SCHEMA, "allocation_id": report["id"], "project_id": report["project_id"],
                "inputs": inputs, "edition": EDITION}
    sections = _sections(report)
    inventory_path = directory / INVENTORY
    if inventory_path.exists():
        inventory = read_json(inventory_path)
        if inventory.get("identity") != identity:
            raise ValueError("Retained allocation figures belong to another original input")
        for descriptor in inventory["files"]:
            verify_file(directory, descriptor)
        return {"sections": sections, "figure_spec": inventory["figure_spec"],
                "figures": inventory["figures"],
                "files": inventory["files"] + [describe_file(directory, inventory_path)]}
    descriptors = {item["path"]: item for item in inputs}
    figures = []
    for index, (key, rows) in enumerate(_groups(report).items(), 1):
        figure = _map(report, key, rows, by_id, descriptors["regions.geojson"], crs, index)
        if figure is not None:
            figures.append(figure)
        figure = _balance_plot(report, key, rows, descriptors["allocation.json"], index)
        if figure is not None:
            figures.append(figure)
    specification = {"schema": "upstate.scientific-figure-spec/v1", "edition": EDITION,
                     "title": report["title"], "rendering": {"reportlab_version": reportlab_version,
                     "width_points": 511.2, "producer_sha256": file_digest(__file__),
                     "map_renderer_sha256": file_digest(scientific_map_figures.__file__),
                     "scientific_figures_sha256": file_digest(scientific_figures.__file__)},
                     "figures": figures}
    atomic_json(directory / SPEC, specification, immutable=True)
    files, choices = [describe_file(directory, directory / SPEC)], []
    for figure in figures:
        drawings = scientific_figures.panel_drawings(figure, 511.2)
        if len(drawings) != 1:
            raise ValueError("Each allocation figure must retain one original vector panel")
        path = "figures/" + figure["id"] + ".svg"
        _bytes(directory / path, renderSVG.drawToString(drawings[0]))
        files.append(describe_file(directory, directory / path))
        choices.append({"id": figure["id"], "path": path})
    inventory = {"schema": "upstate.geographic-allocation-figures/v1", "identity": identity,
                 "figure_spec": SPEC, "figures": choices, "files": files}
    atomic_json(inventory_path, inventory, immutable=True)
    return {"sections": sections, "figure_spec": SPEC, "figures": choices,
            "files": files + [describe_file(directory, inventory_path)]}
