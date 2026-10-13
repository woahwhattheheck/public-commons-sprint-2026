"""Prepare and render saved watershed accounting through Scientific Reports.

Run from the application with --workspace, --accounting and --output. The
original completed accounting is retained; geometry and model outputs are reused.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import math
from pathlib import Path
import shutil
import sys
import zipfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, read_json, verify_file)
from model.workspace import Workspace

EDITION = "selected-watershed-scientific-source-v1"
SCHEMA = "upstate.receptor-accounting-scientific-source/v1"
SOURCE_ID = "selected-watershed-accounting-scientific-report"
TITLE = "Upper Savannah selected watershed accounting"


def number(value):
    return "Unavailable" if value is None else format(value, ",.2f")


def table(columns, rows, widths=None):
    value = {"kind": "table", "columns": columns, "rows": rows}
    if widths:
        value["widths"] = widths
    return value


def sections(account, projected):
    groups = sorted(account["groups"], key=lambda item: item["anchor_huc12s"])
    rows = [[group["title"] + "\n" + ", ".join(group["anchor_huc12s"]),
             group["total_huc12_count"], group["incremental_huc12_count"],
             number(group["total_source_area"]["known_area_ha"]),
             number(group["incremental_source_area"]["known_area_ha"])] for group in groups]
    repeat = account["repeated_source_area_ha"]
    opening = (f'The {account["anchor_count"]} selected watershed anchors contain '
        f'{account["naive_anchor_total_huc12_count"]} total-membership entries but '
        f'{account["union_huc12_count"]} distinct HUC12s. The selected utility unions '
        'and the incremental catchments count each source unit once in their respective accounting sets.')
    if repeat is not None:
        opening += f' Summing all anchor totals would repeat {number(repeat)} hectares of published source area.'
    result = [["Decision summary", [opening,
        "Use each anchor's total when describing that anchor's upstream planning footprint. "
        "Use incremental groups to apportion the selected union. Combine a utility's anchors by set union, not addition."]],
        ["Selected anchor totals and increments", [
            table(["Original anchor / HUC12", "Total units", "Incremental units", "Published total (ha)",
                   "Published increment (ha)"], rows, [2.7, .8, .9, 1.2, 1.2]),
            "Published areas sum the original areasqkm attributes multiplied by 100. "
            "Known and missing area counts remain in the complete accounting data."]],
        ["Independent utility unions", [
            table(["Receiving area", "Distinct units", "Published area (ha)"],
                  [[area["title"], area["huc12_count"], number(area["source_area"]["known_area_ha"])]
                   for area in account["areas"]], [3.8, 1, 1.3]),
            f'The distinct all-selected union contains {account["union_huc12_count"]} HUC12s and '
            f'{number(account["union_source_area"]["known_area_ha"])} hectares of published source area. '
            "A downstream utility retains its full selected total even when another utility also selects an upstream anchor."]]]
    if projected:
        result.append(["Measured original polygon footprints", [
            table(["Original anchor group", "Total polygon area (ha)", "Incremental polygon area (ha)"],
                  [[group["title"], number(projected["groups"][group["id"]]["total_area_ha"]),
                    number(projected["groups"][group["id"]]["incremental_area_ha"])] for group in groups],
                  [3.2, 1.5, 1.5]),
            f'Original polygon coordinates were projected to {projected["crs"]}. '
            f'The measured union is {number(projected["union_area_ha"])} hectares; '
            f'incremental polygon overlap is {number(projected["incremental_polygon_overlap_ha"])} hectares. '
            "Published source attributes and projected polygon measurements have different bases and are reported separately."]])
    result.append(["Method and interpretation", [
        f'Membership follows original ToHUC links within the {account["network_huc12_count"]}-unit source. '
        "Incremental groups subtract strictly upstream selected catchments; equivalent upstream sets "
        "preserve all original anchor identifiers.",
        "These whole-HUC reporting footprints describe the selected source edition. "
        "An intake-specific watershed requires the corresponding intake location and delineation. "
        "Original downstream links leaving the retained domain remain available in the source data.",
        "For subsequent native mass accounting, aggregate additive land-origin quantities on compatible grids and masks. "
        "Preserve missing-cell coverage separately from measured zero. Concentrations, rates and cumulative outlet loads "
        "are not additive whole-HUC inputs to this accounting step.",
        "InVEST NDR estimates land-origin nutrient delivery to the modeled stream network and excludes in-stream processing. "
        "Reservoir retention and delivery to an intake require their own process calculations. "
        "See the linked InVEST NDR methods in Source editions."]])
    return result


def figures(source, account):
    from model.scientific_figures import panel_drawings
    from reportlab.graphics import renderSVG
    groups = sorted(account["groups"], key=lambda item: item["anchor_huc12s"])
    specs, choices = [], []
    for offset in range(0, len(groups), 6):
        selected = groups[offset:offset + 6]
        values = [group[basis + "_source_area"]["known_area_ha"]
                  for group in selected for basis in ("total", "incremental")]
        maximum = max([value for value in values if value is not None] + [1.0])
        step = 10 ** math.floor(math.log10(maximum)) / 2
        upper = math.ceil(maximum / step) * step
        panel = {"title": "Published source area", "x": {
            "domain": [.5, len(selected) + .5], "label": "Original anchor HUC12",
            "ticks": [{"value": index, "label": group["anchor_huc12s"][0] +
                      (" +" if len(group["anchor_huc12s"]) > 1 else "")}
                      for index, group in enumerate(selected, 1)]},
            "y": {"domain": [0, upper], "label": "Area", "unit": "ha",
                  "ticks": [{"value": index * step, "label": format(index * step, ",.0f")}
                            for index in range(round(upper / step) + 1)]}, "series": []}
        for basis, marker, shift in (("total", "circle", -.065), ("incremental", "square-open", .065)):
            panel["series"].append({"geometry": "scatter", "label": basis.capitalize(), "marker": marker,
                "points": [{"x": index + shift, "y": group[basis + "_source_area"]["known_area_ha"],
                            "accounting_group_id": group["id"], "original_anchor_huc12s": group["anchor_huc12s"]}
                           for index, group in enumerate(selected, 1)]})
        figure = {"id": "selected-catchments-%02d" % (offset // 6 + 1),
            "title": "Total and incremental source area", "panels": [panel],
            "caption": "Paired symbols compare published total and incremental area at each original HUC12 anchor. "
                "Horizontal offsets separate symbols; vertical values remain unchanged. "
                "The tables retain projected areas and equivalent anchors."}
        filename = "figures/" + figure["id"] + ".svg"
        atomic_bytes(source / filename, renderSVG.drawToString(panel_drawings(figure, 511.2)[0]).encode("utf-8"))
        specs.append(figure)
        choices.append({"id": figure["id"], "path": filename})
    atomic_json(source / "figure-spec.json", {"schema": "upstate.scientific-figure-spec/v1", "figures": specs})
    return choices


def archive(directory, target):
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as writer:
        for path in sorted(directory.rglob("*")):
            if path.is_file() and not path.name.startswith("."):
                writer.write(path, path.relative_to(directory).as_posix())


def prepare(workspace, accounting_directory, output, *, previous=None, title=TITLE):
    from model import observed_context, scientific_report, scientific_figures
    original = Path(accounting_directory).resolve(strict=True)
    completed = read_json(original / "result.json")
    if completed.get("schema") != "upstate.receptor-accounting/v1":
        raise ValueError("Choose a completed saved watershed accounting result")
    members = {name: verify_file(original, item) for name, item in completed["files"].items()}
    account = read_json(members["accounting.json"])
    if account["original_network_id"] != completed["original_network_id"]:
        raise ValueError("Accounting and producing network identities differ")
    projected = read_json(members["projected-areas.json"]) if "projected-areas.json" in members else None
    identity = {"edition": EDITION, "accounting_id": completed["id"], "title": title,
                "accounting_result_sha256": file_digest(original / "result.json"),
                "project_id": workspace.project["id"], "previous_selection": previous,
                "producer_sha256": file_digest(Path(__file__)),
                "formatter_sha256": file_digest(Path(scientific_report.__file__)),
                "collector_sha256": file_digest(Path(observed_context.__file__)),
                "figure_renderer_sha256": file_digest(Path(scientific_figures.__file__))}
    directory = Path(output).resolve() / digest(identity)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".source.lock", blocking=False):
        result_path = directory / "result.json"
        if result_path.exists():
            result = read_json(result_path)
            if result["identity"] != identity:
                raise ValueError("Saved scientific source selection differs")
            for item in result["files"].values():
                verify_file(directory, item)
            workspace.source_file(result["source"]["source_collection_id"], SOURCE_ID)
            return {**result, "directory": str(directory), "reused": True}
        source = directory / "source"
        source.mkdir(exist_ok=True)
        for name, path in members.items():
            target = source / "accounting" / completed["files"][name]["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        shutil.copyfile(original / "result.json", source / "accounting" / "result.json")
        choices = figures(source, account)
        descriptors = [describe_file(source, path) for path in sorted(source.rglob("*"))
                       if path.is_file() and path.name not in ("scientific-report.json", "sources.json")]
        recipe = {"schema": "upstate.observed-report/v1", "title": title, "edition": EDITION,
                  "basis": {"accounting_id": completed["id"], "original_network_id": account["original_network_id"],
                            "source_binding": account["source_binding"], "result_sha256": identity["accounting_result_sha256"]},
                  "sections": sections(account, projected), "inputs": descriptors,
                  "figures": choices, "figure_spec": "figure-spec.json",
                  "source_links": ["accounting/index.html", "accounting/catchments.csv"]}
        atomic_json(source / "scientific-report.json", recipe)
        source_record = {"id": "SELECTED_WATERSHED_ACCOUNTING", "title": title,
                         "source_id": SOURCE_ID, "vintage": completed["created_at"],
                         "uri": "urn:upstate:receptor-accounting:" + completed["id"],
                         "body_sha256": file_digest(source / "scientific-report.json")}
        atomic_json(source / "sources.json", {"schema": "upstate.sources/v1", "title": title,
            "captured_at": completed["created_at"], "entries": [{
                "id": SOURCE_ID, "kind": "document", "role": "OBSERVED_CONTEXT", "title": title,
                "path": "scientific-report.json", "sha256": source_record["body_sha256"],
                "uri": source_record["uri"], "vintage": source_record["vintage"],
                "units": "Distinct HUC12 counts; published and projected hectares reported separately",
                "metadata": {"report_schema": recipe["schema"], "accounting_id": completed["id"],
                             "original_network_id": account["original_network_id"], "source_basis": "saved_original_watershed_accounting"},
                "companions": [{"path": item["path"], "sha256": item["sha256"]} for item in descriptors]}]})
        collection = workspace.import_sources(source / "sources.json")
        choice = {"source_collection_id": collection["id"], "source_id": SOURCE_ID}
        selection = deepcopy(previous or {})
        selected = observed_context.source_choices(selection)
        if choice not in selected:
            selected.append(choice)
        selection["observed_context_sources"] = selected
        selection.setdefault("source_roles", {})["OBSERVED_CONTEXT"] = selected[0]
        selection.pop("observed_context_binding", None)
        selection["observed_context_binding"] = observed_context.bind(workspace, selection)
        report = directory / "report"
        report.mkdir(exist_ok=True)
        collected = observed_context.collect(workspace, selection, report, {})
        records = []
        for item in selected:
            unused, entry = workspace.source_file(item["source_collection_id"], item["source_id"])
            records.append({"id": "OBSERVED_CONTEXT", **item, "title": entry["title"],
                "uri": entry["uri"], "vintage": entry["vintage"], "body_sha256": entry["body"]["sha256"]})
        records.append({"id": "METHOD_REFERENCE", "title": "InVEST nutrient delivery model methods",
            "uri": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html",
            "vintage": "Methods reference retrieved October 13, 2026"})
        report_title = title if len(selected) == 1 else "Selected scientific studies and watershed accounting"
        scientific_report.report_pdf(report / "report.pdf", report_title, collected["sections"], contact={}, source_records=records)
        scientific_report.write_companions(report, report_title, collected["sections"], contact={}, source_records=records,
                                         binding=selection["observed_context_binding"])
        atomic_json(report / "selection.json", selection)
        archive(source, directory / "scientific-source.zip")
        archive(report, directory / "scientific-report.zip")
        result = {"schema": SCHEMA, "identity": identity, "id": directory.name, "title": title,
                  "source": choice, "original_network_id": account["original_network_id"],
                  "accounting_id": completed["id"], "files": {}}
        for name in ("scientific-source.zip", "scientific-report.zip", "source/sources.json",
                     "source/scientific-report.json", "report/report.pdf", "report/report.html",
                     "report/report.md", "report/report-data.json", "report/selection.json"):
            result["files"][name] = describe_file(directory, directory / name)
        atomic_json(result_path, result, immutable=True)
        return {**result, "directory": str(directory), "reused": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--accounting", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--previous-selection", help="Optional saved ordered report selection to extend")
    parser.add_argument("--title", default=TITLE)
    args = parser.parse_args(argv)
    try:
        previous = read_json(Path(args.previous_selection)) if args.previous_selection else None
        result = prepare(Workspace(args.workspace, create=False), args.accounting, args.output,
                         previous=previous, title=args.title)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
