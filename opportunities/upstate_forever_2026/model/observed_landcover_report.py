"""Native group figures and complete data for original selected-HUC reports."""
from __future__ import annotations

from copy import deepcopy
import csv
import io
import math
from pathlib import Path

from .common import atomic_bytes, atomic_json, describe_file, file_digest, verify_file

EDITION = "original-huc-group-report/1"
SPEC = "figures/selected-group-figures.json"
DATA = "figures/selected-group-data.json"
CSV = "landcover-groups.csv"
GROUPS = (
    ("water", "Water", (11,)), ("snow_ice", "Snow / ice", (12,)),
    ("developed", "Developed", (21, 22, 23, 24)), ("barren", "Barren", (31,)),
    ("forest", "Forest", (41, 42, 43)), ("shrub", "Shrub", (52,)),
    ("grass", "Grass", (71,)), ("agriculture", "Agriculture", (81, 82)),
    ("wetland", "Wetland", (90, 95)),
)


def implementation():
    from reportlab import Version
    from . import scientific_figures
    return {"edition": EDITION, "reportlab_version": Version,
            "group_report_sha256": file_digest(__file__),
            "scientific_figures_sha256": file_digest(scientific_figures.__file__)}


def groups(view, area):
    """Aggregate original integer cells before deriving any area or percentage."""
    if isinstance(area, bool) or not isinstance(area, (int, float)) or not math.isfinite(area) or area <= 0:
        raise ValueError("Original group report needs its positive native cell area")
    rows = [{"id": key, "label": label, "codes": list(codes),
             "before_cells": 0, "after_cells": 0, "retained_within_group_cells": 0,
             "internal_class_change_cells": 0, "gross_loss_cells": 0, "gross_gain_cells": 0}
            for key, label, codes in GROUPS]
    by_class = {code: row for row in rows for code in row["codes"]}
    seen, paired, changed, changed_group = set(), 0, 0, 0
    for item in view["transitions"]:
        pair = item["before_class"], item["after_class"]
        cells = item["cells"]
        if (pair in seen or pair[0] not in by_class or pair[1] not in by_class
                or isinstance(cells, bool) or not isinstance(cells, int) or cells < 0):
            raise ValueError("Group report needs all original distinct nonnegative class counts")
        expected_area = cells * area / 10000
        if not math.isclose(item["area_ha"], expected_area, rel_tol=1e-10, abs_tol=1e-9):
            raise ValueError("Original transition area differs from native cell support")
        seen.add(pair)
        before, after = by_class[pair[0]], by_class[pair[1]]
        paired += cells
        changed += cells if pair[0] != pair[1] else 0
        before["before_cells"] += cells
        after["after_cells"] += cells
        if before is after:
            before["retained_within_group_cells"] += cells
            before["internal_class_change_cells"] += cells if pair[0] != pair[1] else 0
        else:
            before["gross_loss_cells"] += cells
            after["gross_gain_cells"] += cells
            changed_group += cells
    if (len(seen) != len(by_class) ** 2 or paired != view["paired_valid_cells"]
            or changed != view["changed_class_cells"]):
        raise ValueError("Group report matrix differs from complete original support")
    percent = lambda numerator, denominator: 100 * numerator / denominator if denominator else None
    for row in rows:
        row["net_cells"] = row["after_cells"] - row["before_cells"]
        row["gross_turnover_cells"] = row["gross_gain_cells"] + row["gross_loss_cells"]
        for field, cell_field in (
                ("before_area_ha", "before_cells"), ("after_area_ha", "after_cells"),
                ("retained_area_ha", "retained_within_group_cells"),
                ("internal_class_change_area_ha", "internal_class_change_cells"),
                ("gross_loss_area_ha", "gross_loss_cells"), ("gross_gain_area_ha", "gross_gain_cells"),
                ("net_area_ha", "net_cells"), ("gross_turnover_area_ha", "gross_turnover_cells")):
            row[field] = row[cell_field] * area / 10000
        row["loss_percent_of_before_group"] = percent(row["gross_loss_cells"], row["before_cells"])
        row["gain_percent_of_after_group"] = percent(row["gross_gain_cells"], row["after_cells"])
        row["net_percent_of_paired_valid"] = percent(row["net_cells"], paired)
    return {"paired_valid_cells": paired, "changed_class_cells": changed,
            "changed_group_cells": changed_group, "within_group_class_change_cells": changed - changed_group,
            "rows": rows}


def _table(columns, rows, caption):
    def value(item):
        if item is None:
            return "Not available"
        return format(item, ",.3f") if isinstance(item, float) else str(item)
    return {"kind": "table", "caption": caption, "columns": columns,
            "rows": [[value(item) for item in row] for row in rows]}


def _axis(label, unit, low, high, ticks=None):
    return {"label": label, "unit": unit, "domain": [low, high],
            "ticks": ticks if ticks is not None else [
                {"value": low + (high - low) * index / 4,
                 "label": format(low + (high - low) * index / 4, ".4g")} for index in range(5)]}


def _figures(report, selected, selection_file, data_file):
    rows = selected["rows"]
    group_ticks = [{"value": index, "label": "G" + str(index + 1)} for index in range(len(rows))]
    years = report["binding"]["rasters"]
    before, after = str(years["before"]["year"]), str(years["after"]["year"])
    common = {"selection": deepcopy(report["selection"]), "inputs": [selection_file, data_file]}
    key = "; ".join("G" + str(index + 1) + " " + row["label"] for index, row in enumerate(rows)) + "."
    def points(field, offset=0, sign=1):
        return [{"x": index + offset, "y": sign * row[field], "group": row["id"],
                 "quantity": field, "source_path": DATA, "source_scope": "selected"}
                for index, row in enumerate(rows)]
    extent = max([max(row["gross_loss_area_ha"], row["gross_gain_area_ha"],
                      abs(row["net_area_ha"])) for row in rows] + [0])
    extent = extent * 1.1 if extent else 1
    change = {"id": "selected-group-change", "title": "Gross gains, losses and net group change",
        "caption": before + " to " + after + ". Loss is plotted below zero, gain above zero, and net as a diamond. "
            "Gains and losses include only crossings between the nine groups. Changes between classes inside one "
            "group remain in that group. All quantities use original paired-valid native cells. " + key,
        **common,
        "panels": [{"title": "Selected watershed union",
            "x": _axis("Land-cover group", "", -.6, len(rows) - .4, group_ticks),
            "y": _axis("Area change", "ha", -extent, extent),
            "reference_lines": [{"axis": "y", "value": 0}],
            "series": [
                {"geometry": "scatter", "label": "Gross loss", "marker": "circle-open",
                 "points": points("gross_loss_area_ha", -.14, -1)},
                {"geometry": "scatter", "label": "Gross gain", "marker": "square",
                 "points": points("gross_gain_area_ha", .14)},
                {"geometry": "scatter", "label": "Net change", "marker": "diamond",
                 "points": points("net_area_ha")}]}],
        "detail_tables": [
            _table(["Key / group", "NLCD classes", "Gross loss (ha)", "Gross gain (ha)", "Net change (ha)"],
                   [["G" + str(index + 1) + " " + row["label"], ", ".join(map(str, row["codes"])),
                     row["gross_loss_area_ha"], row["gross_gain_area_ha"], row["net_area_ha"]]
                    for index, row in enumerate(rows)],
                   "Original selected union; three-decimal display. Exact cells and values are in landcover-groups.csv."),
            _table(["Group", "Loss / earlier group (%)", "Gain / later group (%)", "Within-group class change (ha)"],
                   [[row["label"], row["loss_percent_of_before_group"], row["gain_percent_of_after_group"],
                     row["internal_class_change_area_ha"]] for row in rows],
                   "Earlier and later group areas are separate denominators. Zero denominators remain unavailable.")
        ]}
    height = max([max(row["before_area_ha"], row["after_area_ha"]) for row in rows] + [0])
    areas = {"id": "selected-group-area", "title": "Group areas on the same paired support",
        "caption": before + " uses open circles and " + after + " uses filled squares. "
            "These are row and column margins of the original directional matrix, excluding cells valid in only "
            "one year. The independent annual inventories remain in huc-classes.csv. " + key,
        **common,
        "panels": [{"title": "Selected watershed union",
            "x": _axis("Land-cover group", "", -.6, len(rows) - .4, group_ticks),
            "y": _axis("Paired area", "ha", 0, height * 1.08 if height else 1),
            "series": [
                {"geometry": "scatter", "label": before, "marker": "circle-open",
                 "points": points("before_area_ha", -.12)},
                {"geometry": "scatter", "label": after, "marker": "square",
                 "points": points("after_area_ha", .12)}]}],
        "detail_tables": [_table(["Key / group", before + " paired (ha)", after + " paired (ha)", "Retained in group (ha)"],
            [["G" + str(index + 1) + " " + row["label"], row["before_area_ha"],
              row["after_area_ha"], row["retained_area_ha"]] for index, row in enumerate(rows)],
            "Retained includes all cells staying within the group, including changes between its constituent classes.")]}
    return [change, areas]


def prepare(directory, report, expected_implementation):
    from reportlab.graphics import renderSVG
    from . import scientific_figures
    directory = Path(directory)
    if implementation() != expected_implementation:
        raise ValueError("Selected watershed report implementation changed during production")
    area = report["binding"]["method"]["cell_area_m2"]
    selected = groups(report["summary"], area)
    watersheds = [{"huc12": row["huc12"], "properties": deepcopy(row["properties"]),
                   **groups(row, area)} for row in report["watersheds"]]
    data = {"schema": "upstate.original-huc-group-data/v1", "edition": EDITION,
            "selection": deepcopy(report["selection"]), "binding": deepcopy(report["binding"]),
            "cell_area_m2": area, "selected": selected, "watersheds": watersheds}
    atomic_json(directory / DATA, data, immutable=True)
    selection_file = describe_file(directory, directory / "selection.json")
    data_file = describe_file(directory, directory / DATA)
    figures = _figures(report, selected, selection_file, data_file)
    spec = {"schema": "upstate.scientific-figure-spec/v1", "edition": EDITION,
            "title": report["title"], "implementation": deepcopy(expected_implementation),
            "rendering": {"width_points": 511.2}, "figures": figures}
    atomic_json(directory / SPEC, spec, immutable=True)
    fields = list(selected["rows"][0])
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(["scope", "huc12", "paired_valid_cells", "changed_class_cells",
                     "changed_group_cells", "within_group_class_change_cells", *fields])
    for scope, huc12, value in [("selected", "", selected),
                               *[("watershed", row["huc12"], row) for row in watersheds]]:
        for row in value["rows"]:
            writer.writerow([scope, huc12, *[value[key] for key in
                ("paired_valid_cells", "changed_class_cells", "changed_group_cells", "within_group_class_change_cells")],
                *[",".join(map(str, row[field])) if field == "codes" else row[field] for field in fields]])
    atomic_bytes(directory / CSV, stream.getvalue().encode("utf-8"), immutable=True)
    files = {name: describe_file(directory, directory / name) for name in (SPEC, DATA, CSV)}
    choices, svg_bodies = [], {}
    for figure in figures:
        drawings = scientific_figures.panel_drawings(figure, 511.2)
        if len(drawings) != 1:
            raise ValueError("Each selected watershed figure needs one complete original panel")
        name = "figures/" + figure["id"] + ".svg"
        body = renderSVG.drawToString(drawings[0])
        svg_bodies[figure["id"]] = body if isinstance(body, str) else body.decode("utf-8")
        atomic_bytes(directory / name, body.encode("utf-8") if isinstance(body, str) else body, immutable=True)
        files[name] = describe_file(directory, directory / name)
        choices.append({"id": figure["id"], "path": name})
    for name, module_path, expected in (
            ("observed_landcover_report.py", __file__, expected_implementation["group_report_sha256"]),
            ("scientific_figures.py", scientific_figures.__file__, expected_implementation["scientific_figures_sha256"])):
        if file_digest(module_path) != expected:
            raise ValueError("Selected group report source changed during capture")
        member = "implementation/" + name
        atomic_bytes(directory / member, Path(module_path).read_bytes(), immutable=True)
        files[member] = describe_file(directory, directory / member)
        if files[member]["sha256"] != expected:
            raise ValueError("Captured selected group implementation differs")
    for descriptor in files.values():
        verify_file(directory, descriptor)
    return {"figure_spec": SPEC, "figures": choices, "files": files, "spec": spec, "svg": svg_bodies}
