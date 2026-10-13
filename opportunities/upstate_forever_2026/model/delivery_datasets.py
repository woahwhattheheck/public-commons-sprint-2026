"""Retain the exact editable datasets behind the existing ordered map atlas."""
from __future__ import annotations

import math
from pathlib import Path

from .common import describe_file, digest, verify_file
from . import native_versions, rasters
from .reuse import dataset_companions

VERSION = "atlas-gis-datasets/v1"


def _number(value):
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else str(value)


def _header(path, grid):
    """Read the original header and dependency names, without scanning pixels."""
    import rasterio
    with rasterio.open(path) as raster:
        expected = grid["grid"]
        if (raster.count != 1 or raster.width != expected["width"]
                or raster.height != expected["height"]
                or raster.crs != rasterio.crs.CRS.from_user_input(expected["crs"])
                or tuple(raster.transform)[:6] != tuple(expected["transform"])[:6]):
            raise ValueError("Atlas dataset differs from the retained single-band reporting grid: " + str(path))
        header = {
            "driver": raster.driver, "width": raster.width, "height": raster.height,
            "count": raster.count, "crs": raster.crs.to_wkt(),
            "transform": list(raster.transform)[:6], "bounds": list(raster.bounds),
            "dtype": raster.dtypes[0], "nodata": _number(raster.nodata),
            "mask_flags": [[flag.name for flag in flags] for flags in raster.mask_flag_enums],
            "band_scales": list(raster.scales), "band_offsets": list(raster.offsets),
            "tags": raster.tags(), "band_tags": raster.tags(1),
        }
        dependencies = [Path(value).resolve(strict=True) for value in raster.files]
    return header, dependencies


def _companions(path, dependencies, workspace_root):
    """Keep actual GDAL companions under their original corresponding names."""
    path = path.resolve(strict=True)
    found = set(dataset_companions(path))
    # Retain second-order mask companions too, when they actually exist.
    for tail in (".msk.ovr", ".msk.aux.xml"):
        candidate = Path(str(path) + tail)
        if candidate.is_file():
            found.add(candidate)
    found.update(value for value in dependencies if value != path)
    result = []
    for value in sorted(found, key=lambda item: item.name):
        resolved = value.resolve(strict=True)
        if (resolved.parent != path.parent or not resolved.is_relative_to(workspace_root)
                or not resolved.name.startswith(path.stem + ".")):
            raise ValueError("Atlas dataset has a companion outside its retained dataset: " + str(value))
        result.append(resolved)
    return result


def _retain(directory, state, key, source, target, expected, copy_file, **metadata):
    previous = state["files"].get(key)
    if previous is not None:
        current = verify_file(directory, previous)
        if (current.resolve() != target.resolve()
                or any(previous[name] != expected[name] for name in ("bytes", "sha256"))):
            raise ValueError("Retained atlas dataset differs from the selected original: " + key)
        return previous
    if source.resolve() != target.resolve():
        copy_file(source, target, expected)
    else:
        verify_file(directory, expected)
    item = describe_file(directory, target, **metadata)
    if any(item[name] != expected[name] for name in ("bytes", "sha256")):
        raise ValueError("Atlas dataset changed while it was being retained")
    state["files"][key] = item
    return item


def retain(workspace, directory, pages, *, state, grid, selection, profile, sources,
           baseline, alternatives, comparison, metadata_writer, copy_file,
           receptor_product=None, water_product=None):
    """Attach delivered dataset references to the final selected atlas panels.

    Source paths, model outputs, signed differences and priority values stay
    unchanged. The original atlas index remains the map-to-dataset catalogue.
    """
    directory = Path(directory).resolve(strict=True)
    workspace_root = Path(workspace.root).resolve(strict=True)
    registry = {}
    for key, item in state["files"].items():
        if str(item.get("path", "")).lower().endswith((".tif", ".tiff")):
            path = verify_file(directory, item).resolve()
            registry[path] = {"root": directory, "file": item, "file_key": key}

    run_records = {}
    for run in [baseline, *alternatives]:
        scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
        run_records[run["id"]] = {
            "id": run["id"], "selection": run["selection"],
            "scenario": scenario, "completed_at": run.get("completed_at"),
            "native_models": native_versions.model_versions(run),
        }
    contexts = {}
    for name in rasters.MASS_UNITS:
        target = verify_file(directory, state["files"][name]).resolve()
        original = baseline["artifacts"][name]
        contexts[target] = {
            "kind": "baseline_export", "pollutant": name,
            "run_ids": [baseline["id"]], "original_artifact": original,
            "native_source_raster": (Path("runs") / baseline["id"] / original["path"]).as_posix(),
            "metadata_key": name + "_metadata",
            "support": "Original finite valid reporting-mask pixels for this physical export.",
            "derivation": {
                "direction": "baseline annual export",
                "method": "Retained native rate converted to mass per original pixel by the existing native exporter.",
                "units": rasters.MASS_UNITS[name],
            },
        }
    comparison_root = workspace_root / "comparisons" / comparison["id"]
    for alternative in comparison["alternatives"]:
        for name, item in alternative["artifacts"].items():
            if name not in rasters.MASS_UNITS:
                continue
            path = verify_file(comparison_root, item).resolve()
            registry[path] = {"root": comparison_root, "file": item}
            contexts[path] = {
                "kind": "scenario_difference", "pollutant": name,
                "run_ids": [baseline["id"], alternative["run_id"]],
                "original_artifact": item, "comparison_id": comparison["id"],
                "comparison_provenance": comparison.get("native_version_provenance"),
                "support": "Common finite valid pixels of the selected alternative and baseline; original NoData is retained.",
                "derivation": {
                    "direction": "alternative minus baseline",
                    "method": "Existing signed difference of annual mass per pixel on common valid support.",
                    "units": rasters.MASS_UNITS[name],
                    "retained_difference": {key: item[key] for key in
                        ("sum_change", "valid_cells", "direction") if key in item},
                },
            }
    priority_path = verify_file(directory, state["files"]["combined_priority"]).resolve()
    contexts[priority_path] = {
        "kind": "relative_priority", "run_ids": [baseline["id"]],
        "original_artifact": state["files"]["combined_priority"],
        "support": "Original reporting-mask pixels valid for every positively weighted pollutant; zero-weight pollutant masks do not restrict support.",
        "derivation": {"normalization": state["priority"], "units": "dimensionless"},
    }
    if receptor_product:
        receptor_root = directory / "receptors"
        inventory = receptor_product["inventory"]
        for role, item in inventory["priority_rasters"].items():
            path = verify_file(receptor_root, item).resolve()
            contexts[path] = {
                "kind": "receptor_priority", "run_ids": [baseline["id"]],
                "original_artifact": item,
                "support": "Original priority support intersected by pixel centre with the selected upstream-connected source HUC12 union inside the reporting area.",
                "derivation": {
                    "normalization": state["priority"], "units": "dimensionless",
                    "role": role, "method": inventory["method"],
                    "geographic_basis": inventory["geographic_basis"],
                    "source_coverage": inventory["source_coverage"],
                    "network_source": inventory["network_source"],
                    "inventory": state["files"]["receptor_inventory"],
                },
            }
    if water_product:
        water_root = Path(water_product["directory"]).resolve(strict=True)
        inventory = water_product["inventory"]
        for family, row in inventory["families"].items():
            item = row.get("current_priority")
            if item is None:
                continue
            path = verify_file(water_root, item).resolve()
            previous = contexts.get(path)
            if previous and previous["kind"] == "receiving_water_priority":
                previous["derivation"]["family_selections"][family] = row
                continue
            contexts[path] = {
                "kind": "receiving_water_priority", "run_ids": [baseline["id"]],
                "original_artifact": item,
                "support": "Original selected receiving-water contribution footprint and retained valid priority cells.",
                "derivation": {
                    "normalization": inventory["normalization"], "units": "dimensionless",
                    "quantity_scope": inventory["quantity_scope"],
                    "family_selections": {family: row}, "identity": inventory["identity"],
                    "measurement": inventory["measurement"],
                    "inventory": state["files"]["receiving_water_index"],
                },
            }

    retained = {}
    for page in pages:
        for panel_index, panel in enumerate(page["panels"]):
            path = Path(panel["path"]).resolve(strict=True)
            if path not in registry or path not in contexts:
                raise ValueError("Atlas panel has no declared retained scientific dataset: " + str(path))
            context = contexts[path]
            if path not in retained:
                original = registry[path]
                verify_file(original["root"], original["file"])
                relative = path.relative_to(workspace_root).as_posix()
                key = digest({"version": VERSION, "source_raster": relative,
                              "sha256": original["file"]["sha256"]})
                header, dependencies = _header(path, grid)
                target = (path if path.is_relative_to(directory)
                          else directory / "gis" / key / path.name)
                file_key = original.get("file_key") if path.is_relative_to(directory) else None
                file_key = file_key or "gis_dataset_" + key
                artifact = _retain(directory, state, file_key, path, target,
                    original["file"], copy_file, title=panel["label"], units=panel["units"])
                companion_rows = []
                for number, companion in enumerate(_companions(path, dependencies, workspace_root)):
                    expected = describe_file(workspace_root, companion)
                    companion_target = target.with_name(target.stem + companion.name[len(path.stem):])
                    # An in-delivery source descriptor has a delivery-relative path.
                    if companion.resolve() == companion_target.resolve():
                        expected = describe_file(directory, companion)
                    item = _retain(directory, state, "gis_companion_" + key + "_" + str(number),
                        companion, companion_target, expected, copy_file,
                        title=panel["label"] + " / " + companion.name)
                    companion_rows.append({
                        "file": item,
                        "source": describe_file(workspace_root, companion),
                    })
                source_descriptor = {
                    **original["file"], "path": relative,
                    "native_source_raster": context.get("native_source_raster"),
                }
                row = {
                    "schema": "upstate.atlas-dataset/v1", "id": key,
                    "title": panel["label"], "kind": context["kind"],
                    "units": panel["units"], "signed": bool(panel.get("signed")),
                    "file": artifact, "companions": companion_rows,
                    "source_raster": relative, "source_file": source_descriptor,
                    "original_artifact": context["original_artifact"],
                    "grid_id": grid["id"], "grid": header,
                    "model_domain": grid["files"].get("model_domain"),
                    "reporting_area": grid["files"].get("reporting_area"),
                    "reporting_mask": grid["files"].get("reporting_mask"),
                    "profile_id": profile["id"],
                    "baseline_run_id": baseline["id"],
                    "comparison_id": context.get("comparison_id"),
                    "comparison_provenance": context.get("comparison_provenance"),
                    "pollutant": context.get("pollutant"),
                    "runs": [run_records[run_id] for run_id in context["run_ids"]],
                    "native_execution": state["files"]["native_execution"],
                    "source_editions": sources, "support": context["support"],
                    "derivation": context["derivation"], "maps": [],
                }
                metadata_key = context.get("metadata_key") or "gis_metadata_" + key
                if metadata_key not in state["files"]:
                    metadata_path = directory / "gis" / "metadata" / (key + ".xml")
                    metadata_path.parent.mkdir(parents=True, exist_ok=True)
                    metadata_writer(metadata_path, panel["label"], artifact,
                        unit=panel["units"], grid=grid, sources=sources, selection=selection,
                        profile=profile, contact=selection["contact"],
                        native_execution=state["files"]["native_execution"], dataset=row)
                    state["files"][metadata_key] = describe_file(directory, metadata_path,
                        title=panel["label"] + " / FGDC metadata")
                row["metadata"] = state["files"][metadata_key]
                verify_file(directory, row["metadata"])
                retained[path] = row
            row = retained[path]
            if row["units"] != panel["units"] or row["signed"] != bool(panel.get("signed")):
                raise ValueError("A repeated atlas dataset has conflicting physical units or direction")
            relation = {
                "map_key": page["key"], "family": page["family"],
                "panel": panel_index + 1, "title": panel["label"],
                "display_scale": panel.get("scale"),
                "overlays": [{"label": value["label"], "source": value.get("source")}
                             for value in page["overlays"]],
            }
            if relation not in row["maps"]:
                row["maps"].append(relation)
            panel["dataset"] = {"id": row["id"], "file": row["file"],
                "metadata": row["metadata"],
                "companions": [value["file"] for value in row["companions"]]}
    state["gis_datasets"] = {
        "schema": "upstate.atlas-datasets/v1", "version": VERSION,
        "delivery_id": state["id"], "grid_id": grid["id"],
        "datasets": list(retained.values()),
    }
    return state["gis_datasets"]
