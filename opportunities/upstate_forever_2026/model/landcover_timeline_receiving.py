"""Operate the complete timeline on an existing selection or a discriminating native example."""
from __future__ import annotations
import argparse
import csv
import json
from pathlib import Path
import shutil

from .common import atomic_json, describe_file, read_json, verify_file
from .workspace import Workspace
from . import landcover_workspace
from .landcover_ledger import LedgerError, Options, RasterInput, run_ledger
from .landcover_exports import receive_portable


def _original_example(root):
    """Create explicit teaching inputs; these are never represented as regional measurements."""
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    source = root / "authored-originals"
    source.mkdir()
    observations = [2019, 2020, 2022, 2023]
    patterns = [
        [41, 41, 41, 41], [41, 21, 21, 21], [41, 21, 41, 41], [41, 42, 43, 43], [21, 21, 41, 41],
        [41, 52, 71, 82], [41, 0, 21, 21], [90, 41, 90, 41], [41, 99, 41, 41], [11, 11, 11, 11],
    ]
    entries = []
    for index, year in enumerate(observations):
        path = source / (str(year) + ".tif")
        values = np.array([row[index] for row in patterns], dtype=np.uint8).reshape(2, 5)
        with rasterio.open(path, "w", driver="GTiff", height=2, width=5, count=1,
                           dtype="uint8", crs="EPSG:5070", transform=from_origin(0, 200, 100, 100), nodata=0) as target:
            target.write(values, 1)
            target.set_band_description(1, "Explicit authored " + str(year) + " teaching classes")
        entries.append({"id": "teaching-" + str(year), "kind": "raster", "role": "NLCD",
                        "title": "Authored native trajectory " + str(year), "vintage": str(year),
                        "uri": "authored://landcover-timeline/" + str(year),
                        **describe_file(source, path)})
    features = []
    for code, name, low, high in [("001", "Western fractional area", 25, 250),
                                 ("002", "Eastern fractional area", 250, 475)]:
        features.append({"type": "Feature", "properties": {"huc12": code, "name": name},
                         "geometry": {"type": "Polygon", "coordinates": [[[low, 0], [high, 0],
                                      [high, 200], [low, 200], [low, 0]]]}})
    atomic_json(source / "areas.geojson", {"type": "FeatureCollection",
                "crs": {"type": "name", "properties": {"name": "EPSG:5070"}}, "features": features})
    entries.append({"id": "teaching-areas", "kind": "vector", "role": "reporting",
                    "title": "Authored fractional reporting polygons", "vintage": "2026-10-13",
                    "uri": "authored://landcover-timeline/reporting", **describe_file(source, source / "areas.geojson")})
    atomic_json(source / "sources.json", {"schema": "upstate.sources/v1", "title": "Authored land-cover trajectory course",
                                         "scope": "Explicit native teaching inputs, not regional observations", "entries": entries})
    workspace = Workspace(root / "teaching-workspace", create=True, title="Observed land-cover native teaching course")
    collection = workspace.import_sources(source / "sources.json")
    selection = {
        "input_mode": "timeline", "title": "Authored observed trajectory receiving",
        "annual_sources": [{"year": year, "source_collection_id": collection["id"],
                            "source_id": "teaching-" + str(year), "band": 1} for year in observations],
        "zones": {"source_collection_id": collection["id"], "source_id": "teaching-areas",
                  "id_field": "huc12", "name_field": "name"},
        "options": {"tile_size": 2, "support_scope": "all", "unknown_policy": "exclude"},
    }
    atomic_json(root / "selected-inputs.json", selection)
    return workspace, selection


def operate(output, *, workspace_path=None, selection_path=None):
    output = Path(output).expanduser().resolve()
    if output.exists():
        raise ValueError("Choose a new receiving output directory")
    if workspace_path is not None:
        original = Path(workspace_path).expanduser().resolve(strict=True)
        if output.is_relative_to(original) or original.is_relative_to(output):
            raise ValueError("Retain original Workspace and receiving output in separate directories")
    output.mkdir(parents=True)
    if workspace_path is None:
        workspace, selection = _original_example(output)
        authored = True
    else:
        workspace, selection = Workspace(workspace_path), read_json(selection_path)
        authored = False
        atomic_json(output / "selected-inputs.json", selection)
    if selection.get("input_mode") != "timeline":
        raise LedgerError("Select the complete original timeline")
    preview = landcover_workspace.preview_inputs(workspace, selection)
    atomic_json(output / "input-preview.json", preview)
    progress_rows = []
    interrupted = False
    if authored:
        def interrupt_after_original_commit(status):
            progress_rows.append(dict(status))
            if status["completed_tiles"] == 1:
                raise InterruptedError("Authored operator cancellation after the first committed native tile")
        try:
            landcover_workspace.build(workspace, selection, progress=interrupt_after_original_commit)
        except InterruptedError:
            interrupted = True
        if not interrupted:
            raise RuntimeError("The original tile cancellation was not reached")
    edition = landcover_workspace.build(workspace, selection, progress=lambda row: progress_rows.append(dict(row)))
    retained = landcover_workspace.inspect(workspace, edition["id"])
    report = retained["report"]
    directory = workspace.root / landcover_workspace.KIND / edition["id"]
    archive = verify_file(directory, edition["files"]["archive"])
    received = receive_portable(archive, output / "received-report")
    if read_json(Path(received["path"]) / "ledger.json") != report:
        raise RuntimeError("The complete received report changed")
    # Cold Workspace and original reader reopen the same source-bound edition.
    cold = landcover_workspace.inspect(Workspace(workspace.root), edition["id"])
    if cold != retained or landcover_workspace.build(workspace, selection) != edition:
        raise RuntimeError("Original saved-edition reopen/reuse changed")
    csv_counts = {}
    for name in ("timeline-summary.csv", "timeline-trajectories.csv", "timeline-annual-classes.csv",
                 "timeline-adjacent-transitions.csv", "timeline-groups.csv", "timeline-source-years.csv"):
        with (Path(received["path"]) / name).open(encoding="utf-8", newline="") as stream:
            csv_counts[name] = sum(1 for row in csv.DictReader(stream))
    if authored:
        domain = next(row for row in report["timeline"]["rows"] if row["zone_id"] == "__domain__")
        expected = {"stable_ha": 1.5, "changed_ha": 5.5, "one_observed_transition_ha": 1.75,
                    "multiple_observed_transitions_ha": 3.75, "returned_to_initial_ha": 1.0,
                    "changed_without_return_ha": 4.5, "persistent_final_ha": 3.75,
                    "unconfirmed_final_ha": 1.75, "forest_internal_only_ha": 1.0,
                    "forest_exit_ha": 3.75, "forest_entry_ha": 2.75}
        import math
        if not math.isclose(domain["analysis_ha"], 7.0, abs_tol=1e-9) or not math.isclose(domain["covered_ha"], 9.0, abs_tol=1e-9):
            raise RuntimeError("Fractional native support changed")
        for key, value in expected.items():
            if not math.isclose(domain["summary"][key], value, abs_tol=1e-9):
                raise RuntimeError("Observed trajectory quantity differs: " + key)
        if [row["completed_tiles"] for row in progress_rows] != [1, 2, 3]:
            raise RuntimeError("A completed native tile was repeated during continuation")
        if report["timeline"]["intervals"][1]["gap_years"] != 2:
            raise RuntimeError("The original missing observation year was interpolated")
        inputs = landcover_workspace._inputs(workspace, selection)
        zones = directory / "zones-original.geojson"
        legacy = run_ledger(inputs["rasters"][0], dict(zip(inputs["keys"], inputs["rasters"][1:])),
                            zones, output / "original-pairwise", options=Options(**selection["options"], title=selection["title"]),
                            id_field="_landcover_zone_id", name_field="_landcover_zone_name")
        if legacy["rows"] != report["rows"] or legacy["zones"] != report["zones"]:
            raise RuntimeError("Original pairwise quantities changed")
        for invalid in ({**selection, "annual_sources": list(reversed(selection["annual_sources"]))},
                        {**selection, "options": {**selection["options"], "support_scope": "pair"}}):
            try:
                landcover_workspace.preview_inputs(workspace, invalid)
            except LedgerError:
                pass
            else:
                raise RuntimeError("An invalid chronology/support selection was accepted")
    import rasterio
    with rasterio.open(Path(received["path"]) / report["rasters"]["timeline"]["sequence"]) as sequence:
        if sequence.count != len(report["timeline"]["years"]):
            raise RuntimeError("The complete original sequence raster lost observations")
        sequence_bands = list(sequence.descriptions)
    from .landcover_report_source import _original_sources, _sections
    sections = _sections(edition, retained["binding"], report, _original_sources(workspace, retained["binding"]))
    atomic_json(output / "scientific-report-sections.json", sections)
    result = {"schema": "upstate.landcover-timeline-receiving/v1", "state": "complete",
              "input_kind": "explicit_authored_native_teaching_case" if authored else "existing_original_workspace_selection",
              "workspace": str(workspace.root), "edition_id": edition["id"], "signature": report["signature"],
              "observation_years": report["timeline"]["years"], "reporting_rows": len(report["timeline"]["rows"]),
              "interrupted_after_original_commit": interrupted, "actual_progress": progress_rows,
              "csv_rows": csv_counts, "sequence_band_descriptions": sequence_bands,
              "source_edition_reopened": True, "portable_report": received,
              "scientific_report_sections": len(sections)}
    atomic_json(output / "receiving.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--selection", type=Path)
    args = parser.parse_args()
    if bool(args.workspace) != bool(args.selection):
        parser.error("Supply the existing Workspace and its original selection together")
    print(json.dumps(operate(args.output, workspace_path=args.workspace, selection_path=args.selection), indent=2))


if __name__ == "__main__":
    main()
