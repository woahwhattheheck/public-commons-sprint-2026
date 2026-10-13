"""Ordered native-study or regional map atlas from retained native panels."""
from __future__ import annotations

import csv
import io
import math
from pathlib import Path
import textwrap

from .common import MAP_IDS, atomic_bytes, atomic_json, describe_file, finite, verify_file
from . import cartography, native_study

ATLAS_VERSION = "native-and-regional-atlas/v6"
PAPER = {"letter": (11.0, 8.5), "a4": (297 / 25.4, 210 / 25.4),
         "a3": (420 / 25.4, 297 / 25.4)}
INDEX_ROWS = 14
FILE_KEYS = ("map_atlas", "map_atlas_index", "map_atlas_csv", "map_atlas_sources")


def _text(value, label, limit, *, default=""):
    value = default if value is None else value
    if not isinstance(value, str):
        raise ValueError(label + " must be text")
    value = " ".join(value.split())
    if len(value) > limit:
        raise ValueError(label + " must contain at most " + str(limit) + " characters")
    return value


def settings(value=None):
    """Validate print settings without changing the analytical priority settings."""
    value = {} if value is None else value
    if not isinstance(value, dict):
        raise ValueError("Map settings must be an object")
    paper = value.get("paper", "a4")
    if paper not in PAPER:
        raise ValueError("Choose Letter, A4 or A3 landscape paper")
    raw_dpi = value.get("dpi", 220)
    dpi = finite(raw_dpi, "Map DPI", minimum=120)
    if isinstance(raw_dpi, bool) or dpi != int(dpi) or dpi > 600:
        raise ValueError("Choose a whole-number map DPI from 120 to 600")
    percentile = finite(value.get("display_percentile", 98),
                        "Map display percentile", minimum=0)
    if percentile > 100:
        raise ValueError("Map display percentile must be at most 100")
    titles = value.get("family_titles", {})
    if not isinstance(titles, dict) or set(titles) - set(MAP_IDS):
        raise ValueError("Family titles must use the original map-family identifiers")
    return {
        "paper": paper, "dpi": int(dpi), "display_percentile": percentile,
        "title": _text(value.get("title"), "Atlas title", 140),
        "subtitle": _text(value.get("subtitle"), "Atlas subtitle", 220),
        "family_titles": {key: _text(title, "Map-family title", 110)
                          for key, title in titles.items() if title},
    }



def bind_water_selections(workspace, selection):
    """Retain complete saved-designation identity before constructing a release."""
    bindings = {}
    overlays = selection.get("overlays", {})
    for role, choice in overlays.items():
        if not isinstance(choice, dict):
            raise ValueError("Each atlas overlay must name its original source")
        selection_id = choice.get("selection_id")
        inferred = False
        if not selection_id:
            if choice.get("where"):
                continue
            _, entry = workspace.source_file(choice.get("source_collection_id"),
                                             choice.get("source_id"))
            scope = entry.get("scope") or {}
            selection_id = scope.get("selection_id")
            if not selection_id:
                continue
            inferred = True
        from .water_designations import get
        saved = get(workspace, selection_id)
        expected = saved["delivery_overlay"]
        if inferred:
            original = saved["source"]
            source_matches = (
                entry.get("kind") == "vector" and
                choice.get("source_collection_id") == expected["source_collection_id"] and
                choice.get("source_id") == expected["source_id"] and
                (choice.get("layer") or entry.get("layer")) == expected["layer"] and
                entry.get("layer") == expected["layer"] and
                entry.get("body", {}).get("sha256") == saved["files"]["geopackage"]["sha256"] and
                scope.get("source_collection_id") == original["source_collection_id"] and
                scope.get("source_id") == original["source_id"] and
                scope.get("original_source_sha256") == original["sha256"] and
                scope.get("selected_features") == saved["summary"]["selected_features"]
            )
            contradictory = any(
                key in choice and choice[key] != value
                for key, value in expected.items() if key != "layer"
            )
            if not source_matches or contradictory or role != saved["purpose"]:
                raise ValueError("Retained designation source " + str(selection_id) +
                                 " differs from its saved source, edition or purpose; apply that saved designation again")
            choice = {**choice, **expected}
            overlays[role] = choice
        if (role != saved["purpose"] or
                any(choice.get(key) != value for key, value in expected.items()) or
                choice.get("where")):
            raise ValueError("Saved water designation " + str(selection_id) +
                             " differs from the selected source or field filter; apply that saved designation again")
        bindings[role] = {key: saved[key] for key in (
            "id", "title", "purpose", "selection", "source", "summary",
            "rule_reference", "delivery_overlay", "files")}
        bindings[role]["workspace_path"] = "water-designations/" + str(selection_id)
    source_roles = selection.setdefault("source_roles", {})
    if not isinstance(source_roles, dict):
        raise ValueError("Delivery source roles must be an object")
    for name, role in (("high_quality_waters", "HIGH_QUALITY_WATERS"),
                       ("drinking_water", "SOURCE_WATER_PROTECTION_AREAS"),
                       ("protected_lands", "PROTECTED_LANDS_OVERLAY")):
        if name in overlays:
            source_roles[role] = dict(overlays[name])
        else:
            source_roles.pop(role, None)
    return bindings

def _sheet(plt, options, title, page_number, page_count):
    fig = plt.figure(figsize=PAPER[options["paper"]])
    fig.text(.07, .945, title, fontsize=16, weight="semibold", va="top")
    fig.text(.07, .045, "Scientific Workbench", fontsize=7, color="#444444")
    fig.text(.93, .045, str(page_number) + " / " + str(page_count),
             fontsize=7, ha="right", color="#444444")
    return fig


def _wrap(value, width):
    return "\n".join(textwrap.wrap(str(value), width, break_long_words=False,
                                   break_on_hyphens=False))


def _intro(pdf, plt, options, rows, *, title, selection, grid, footer, page_count):
    fig = _sheet(plt, options, "Watershed map atlas", 1, page_count)
    try:
        fig.text(.07, .80, _wrap(title, 64), fontsize=21, va="top")
        if options["subtitle"]:
            fig.text(.07, .65, _wrap(options["subtitle"], 110), fontsize=10, va="top")
        families = len({row["family"] for row in rows})
        fig.text(.07, .54, str(families) + " map families  ·  " + str(len(rows)) + " map sheets",
                 fontsize=11, va="top")
        contact = selection["contact"]
        contact_label = " · ".join(contact[key] for key in ("name", "organization") if contact.get(key))
        fig.text(.07, .48, _wrap(contact_label or "Original study sources and methods retained in the report", 110),
                 fontsize=9, va="top")
        fig.text(.07, .44, contact["email"], fontsize=9, va="top")
        methodology = (
            "Current nitrogen, phosphorus and sediment sheets use the retained native export values. "
            "Future sheets show each named alternative minus its baseline. Shared pollutant scales "
            "retain the same numerical meaning across every alternative. The combined priority is "
            "the recorded dimensionless decision index."
        )
        fig.text(.07, .34, _wrap(methodology, 130), fontsize=9, va="top", linespacing=1.5)
        fig.text(.07, .19, _wrap(footer, 145), fontsize=8, va="top")
        fig.text(.07, .11, "Grid " + grid["id"][:16] + " · baseline " +
                 selection["baseline_run_id"][:16] + " · " +
                 options["paper"].upper() + " landscape · " + str(options["dpi"]) + " DPI",
                 fontsize=7, va="top")
        pdf.savefig(fig, dpi=options["dpi"])
    finally:
        plt.close(fig)

    chunks = [rows[start:start + INDEX_ROWS] for start in range(0, len(rows), INDEX_ROWS)]
    for number, chunk in enumerate(chunks, 2):
        fig = _sheet(plt, options, "Map contents", number, page_count)
        try:
            fig.text(.07, .86, "FAMILY / MAP", fontsize=8, color="#555555")
            fig.text(.93, .86, "PAGE", fontsize=8, color="#555555", ha="right")
            for i, row in enumerate(chunk):
                y = .81 - i * .050
                heading = str(list(dict.fromkeys(item["family"] for item in rows)).index(row["family"]) + 1) + ". " + row["title"]
                # The complete subtitle and identifiers are retained in the index files.
                if row["scenario_run_id"]:
                    heading += " · " + row["scenario_run_id"][:12]
                fig.text(.07, y, _wrap(heading, 111), fontsize=8, va="top", linespacing=1.15)
                fig.text(.93, y, str(row["page"]), fontsize=9, va="top", ha="right")
            pdf.savefig(fig, dpi=options["dpi"])
        finally:
            plt.close(fig)


def _index_row(page, number, root, options):
    family = page["family"]
    prefix = family + "-"
    run_id = page["key"][len(prefix):] if page["key"].startswith(prefix) else None
    panels = []
    for panel in page["panels"]:
        panels.append({
            "title": panel["label"], "units": panel["units"],
            "signed": bool(panel.get("signed")), "display_scale": panel.get("scale"),
            "source_raster": Path(panel["path"]).resolve().relative_to(root.resolve()).as_posix(),
            **({"dataset": panel["dataset"]} if panel.get("dataset") else {}),
        })
    return {
        "page": number, "family": family, "map_key": page["key"],
        "scenario_run_id": run_id,
        "title": options["family_titles"].get(family) or page["title"],
        "subtitle": page["subtitle"], "panels": panels,
        "overlays": [{"label": overlay["label"], "source": overlay.get("source")}
                     for overlay in page["overlays"]],
    }


def _csv_value(value):
    if isinstance(value, str) and (value.startswith(("\t", "\r")) or
            value.lstrip().startswith(("=", "+", "-", "@"))):
        return "\'" + value
    return value


def _csv(rows):
    output = io.StringIO(newline="")
    columns = ("atlas_page", "family", "map_key", "scenario_run_id", "title",
               "map_pdf", "panel", "units", "signed", "scale_minimum",
               "scale_maximum", "scale_method", "source_raster",
               "dataset_id", "delivered_raster", "fgdc_xml", "raster_sha256", "companion_paths")
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()
    for row in rows:
        for panel in row["panels"]:
            scale = panel["display_scale"] or {}
            values = {
                "atlas_page": row["page"], "family": row["family"], "map_key": row["map_key"],
                "scenario_run_id": row["scenario_run_id"], "title": row["title"],
                "map_pdf": row["file"]["path"], "panel": panel["title"],
                "units": panel["units"], "signed": panel["signed"],
                "scale_minimum": scale.get("minimum"), "scale_maximum": scale.get("maximum"),
                "scale_method": scale.get("label"), "source_raster": panel["source_raster"],
                "dataset_id": panel.get("dataset", {}).get("id"),
                "delivered_raster": panel.get("dataset", {}).get("file", {}).get("path"),
                "fgdc_xml": panel.get("dataset", {}).get("metadata", {}).get("path"),
                "raster_sha256": panel.get("dataset", {}).get("file", {}).get("sha256"),
                "companion_paths": "; ".join(item["path"] for item in
                    panel.get("dataset", {}).get("companions", [])),
            }
            writer.writerow({key: _csv_value(value) for key, value in values.items()})
    return output.getvalue().encode("utf-8-sig")


def _refresh_dataset_index(directory, pages, workspace, options, state, state_path):
    """Add dataset links to retained figures without rendering their maps again."""
    atlas = state["atlas"]
    old_rows = atlas["pages"]
    if [row["map_key"] for row in old_rows] != [page["key"] for page in pages]:
        raise ValueError("Retained atlas page order differs from the selected map panels")
    rows = []
    for page, old in zip(pages, old_rows):
        row = _index_row(page, old["page"], workspace.root, options)
        row["file"] = old["file"]
        def scientific(value):
            return {**value, "panels": [
                {key: item for key, item in panel.items() if key != "dataset"}
                for panel in value["panels"]]}
        if scientific(row) != scientific(old):
            raise ValueError("Retained map semantics differ from the selected atlas edition")
        rows.append(row)
    datasets = state.get("gis_datasets")
    if (rows == old_rows and atlas.get("datasets") == datasets
            and atlas.get("version") == ATLAS_VERSION):
        try:
            verify_file(directory, state["files"]["map_atlas_index"])
            verify_file(directory, state["files"]["map_atlas_csv"])
            return atlas
        except (OSError, ValueError):
            # A crash may leave either newly written derived index ahead of
            # its state descriptor. Recreate it from the verified map inputs.
            pass
    atlas = {**atlas, "version": ATLAS_VERSION, "pages": rows}
    if datasets is not None:
        atlas["datasets"] = datasets
    index_path = directory / "maps" / "atlas-index.json"
    csv_path = directory / "maps" / "atlas-index.csv"
    atomic_json(index_path, atlas)
    atomic_bytes(csv_path, _csv(rows))
    state["files"]["map_atlas_index"] = describe_file(directory, index_path)
    state["files"]["map_atlas_csv"] = describe_file(directory, csv_path)
    state["atlas"] = atlas
    atomic_json(state_path, state)
    return atlas


def write(directory, pages, *, workspace, selection, grid, boundary, crs,
          footer, state, state_path, water_links=None):
    """Write standalone maps and an ordered atlas from the same rendered figures.

    The caller retains scientific panel selection, overlays and shared scales.
    Retained single maps are verified and reused on resume; their figures are
    rendered again only to reconstruct an interrupted multi-page document.
    """
    options = settings(selection.get("map_settings"))
    if water_links is None:
        water_links = bind_water_selections(workspace, selection)
    pages = list(pages)
    if not pages or len({page["key"] for page in pages}) != len(pages):
        raise ValueError("Atlas map keys must be nonempty and distinct")
    present = {page["family"] for page in pages}
    study_mode = native_study.mode(selection) == "native_study"
    required = set(native_study.MAP_FAMILIES) if study_mode else set(MAP_IDS)
    if not required <= present or present - set(MAP_IDS):
        raise ValueError("The atlas must include every map family for the explicit delivery mode")
    order = {family: i for i, family in enumerate(MAP_IDS)}
    pages.sort(key=lambda page: order[page["family"]])  # preserve selected scenario order

    directory = Path(directory)
    if state.get("atlas", {}).get("version") in (ATLAS_VERSION, "native-and-regional-atlas/v5") and all(
            key in state.get("files", {}) for key in FILE_KEYS):
        for key in ("map_atlas", "map_atlas_sources"):
            verify_file(directory, state["files"][key])
        # Derived index/CSV descriptors are reconciled by the refresh below.
        # Original rendered maps and source context remain strictly verified.
        for page in pages:
            verify_file(directory, state["maps"][page["key"]])
        return _refresh_dataset_index(directory, pages, workspace, options, state, state_path)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages

    index_count = math.ceil(len(pages) / INDEX_ROWS)
    first_map = 2 + index_count
    total = 1 + index_count + len(pages)
    title = options["title"] or selection.get("title") or workspace.project["title"]
    rows = [_index_row(page, first_map + i, workspace.root, options)
            for i, page in enumerate(pages)]
    atlas_path = directory / "maps" / "watershed-map-atlas.pdf"
    pending = directory / "maps" / ".watershed-map-atlas.pending.pdf"
    atlas_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with PdfPages(pending, metadata={
            "Title": title, "Author": selection["contact"]["organization"],
            "Subject": options["subtitle"] or ("Original native-study map atlas" if study_mode
                                             else "Seven-family watershed map atlas"),
            "Creator": "Scientific Workbench",
        }) as pdf:
            _intro(pdf, plt, options, rows, title=title, selection=selection,
                   grid=grid, footer=footer, page_count=total)
            for page, row in zip(pages, rows):
                key = page["key"]
                target = directory / "maps" / (key + ".pdf")
                if key in state["maps"]:
                    verify_file(directory, state["maps"][key])
                    single_path = None
                else:
                    single_path = target.with_name("." + target.name)
                subtitle = page["subtitle"]
                if options["subtitle"]:
                    subtitle = options["subtitle"] + " · " + subtitle
                cartography.map_pdf(single_path, row["title"], page["panels"],
                    overlays=page["overlays"], boundary=boundary, crs=crs,
                    subtitle=subtitle, footer=footer, dpi=options["dpi"],
                    paper=options["paper"], project_title=title, pdf_pages=pdf,
                    page_number=row["page"], page_count=total)
                if single_path is not None:
                    single_path.replace(target)
                    state["maps"][key] = describe_file(directory, target)
                    atomic_json(state_path, state)
                row["file"] = state["maps"][key]
            if pdf.get_pagecount() != total:
                raise ValueError("Atlas page count differs from its retained map index")
        pending.replace(atlas_path)
        source_context = {
            "schema": "upstate.map-atlas-source-context/v1", "delivery_id": state["id"],
            "baseline_run_id": selection["baseline_run_id"],
            "scenario_run_ids": list(selection["scenario_run_ids"]),
            "source_report_id": selection.get("source_report_id"),
            "source_report_sha256": selection.get("source_report_sha256"),
            "source_report": state.get("source_report"),
            "delivery_mode": native_study.mode(selection),
            "native_study": state.get("native_study"),
            "source_roles": selection.get("source_roles", {}),
            "overlays": selection.get("overlays", {}), "water_designations": water_links,
            "receptor_spec": selection.get("receptor_spec"),
            "receptor_profile_source": selection.get("receptor_profile_source"),
            "resolved_receptor_network": state.get("receptor_inventory", {}).get("network_source"),
            "receiving_waters": state.get("receiving_waters"),
            "rendered_overlay_sources": [
                {"map_key": row["map_key"], "overlays": row["overlays"]} for row in rows
            ],
        }
        atlas = {
            "schema": "upstate.map-atlas/v1", "version": ATLAS_VERSION,
            "delivery_id": state["id"], "title": title, "settings": options,
            "delivery_mode": native_study.mode(selection),
            "map_families": [family for family in MAP_IDS if family in present],
            "pages": rows, "map_count": len(rows), "page_count": total,
            "baseline_run_id": selection["baseline_run_id"],
            "scenario_run_ids": list(selection["scenario_run_ids"]),
            "source_report_id": selection.get("source_report_id"),
            "grid_id": grid["id"], "grid": grid["grid"],
            "file": describe_file(directory, atlas_path), "source_context": source_context,
            **({"datasets": state["gis_datasets"]} if state.get("gis_datasets") else {}),
        }
        index_path = directory / "maps" / "atlas-index.json"
        csv_path = directory / "maps" / "atlas-index.csv"
        sources_path = directory / "maps" / "source-context.json"
        atomic_json(index_path, atlas)
        atomic_bytes(csv_path, _csv(rows))
        atomic_json(sources_path, source_context)
        state["files"]["map_atlas_sources"] = describe_file(directory, sources_path)
        state["files"]["map_atlas"] = atlas["file"]
        state["files"]["map_atlas_index"] = describe_file(directory, index_path)
        state["files"]["map_atlas_csv"] = describe_file(directory, csv_path)
        state["atlas"] = atlas
        atomic_json(state_path, state)
        return atlas
    finally:
        if pending.exists():
            pending.unlink()
