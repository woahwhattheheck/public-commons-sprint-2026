"""Prepared native grid datasets and scientific lineage for the original Operator.

Add WorkspaceScienceCatalog(operator) to UpstateInvestigations.dataset_providers.
Inventory reads native JSON records and file metadata; selected resolution verifies
the original hashed artifact. Original source and run providers keep their IDs.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path, PurePosixPath
import re

from model.common import digest, identifier, read_json, relative_file, verify_file

SCHEMA = "upstate.science-catalog/v1"
PROVIDER = "upstate.prepared-grid/v1"

# Original ECD1 collections. None denotes the Workspace's immutable _get store.
# Indexing these records does not deserialize their potentially large row arrays.
NATIVE_COLLECTIONS = {
    "observations": None, "observation-comparisons": None,
    "community-tables": None, "community-plans": None, "community-reports": None,
    "spatial-reviews": None, "reviews": None, "review-responses": None,
    "comparisons": "comparison.json", "deliveries": "delivery-state.json",
    "analyses": "summary.json", "spatial-exports": "export.json",
}



def _copy(value):
    return deepcopy(value)


def _member(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("A native artifact needs a portable relative member name")
    member = PurePosixPath(value)
    if (member.is_absolute() or not member.parts or str(member) != value
            or any(part in (".", "..") for part in member.parts)):
        raise ValueError("A native artifact must remain within its registered scope")
    return value


def _descriptor(value):
    if not isinstance(value, dict):
        raise ValueError("A prepared artifact needs its original file descriptor")
    result = _copy(value)
    _member(result.get("path"))
    if not isinstance(result.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", result["sha256"]):
        raise ValueError("A prepared artifact needs its original SHA-256")
    if (not isinstance(result.get("bytes"), int) or isinstance(result["bytes"], bool)
            or result["bytes"] < 0):
        raise ValueError("A prepared artifact needs its original byte count")
    return result


def _retained(value):
    """The original native member identity without an object-store location."""
    return {key: _copy(value[key]) for key in
            ("sha256", "bytes", "filename", "source_path", "view_path") if key in value}


def _source(collection, entry):
    row = {key: _copy(value) for key, value in entry.items()
           if key not in ("body", "companions")}
    row.update(collection_id=collection["id"],
               collection_title=collection.get("title"),
               captured_at=collection.get("captured_at"),
               collection_scope=_copy(collection.get("scope", {})),
               retained=_retained(entry.get("body", {})),
               companions=[_retained(body) for body in entry.get("companions", [])])
    return row


def _issue(issues, kind, key, error):
    # Paths stay in the server; an inventory remains usable if one record is bad.
    if isinstance(error, OSError):
        message = error.strerror or "The retained native file is unavailable."
    elif isinstance(error, KeyError):
        message = "The native record is missing field " + repr(error.args[0]) + "."
    else:
        message = str(error) or "The native record could not be read."
    issues.append({"kind": kind, "id": str(key), "code": type(error).__name__,
                   "message": message[:480]})


def _immutable(workspace, kind, issues):
    values = {}
    for path in sorted((workspace.root / kind).glob("*.json")):
        try:
            key = identifier(path.stem)
            relative_file(workspace.root, kind + "/" + key + ".json")
            values[key] = workspace._get(kind, key)
        except (OSError, ValueError, TypeError, KeyError) as exc:
            _issue(issues, kind, path.stem, exc)
    return values


def _grids(workspace, issues):
    values = {}
    for path in sorted((workspace.root / "grids").glob("*/grid.json")):
        try:
            key = identifier(path.parent.name)
            selected = relative_file(workspace.root, "grids/" + key + "/grid.json")
            row = read_json(selected)
            if (row.get("id") != key or row.get("schema") != "upstate.grid/v1"
                    or digest({"spec": row["spec"], "grid": row["grid"]}) != key):
                raise ValueError("The original prepared grid identity changed")
            values[key] = row
        except (OSError, ValueError, TypeError, KeyError) as exc:
            _issue(issues, "grids", path.parent.name, exc)
    return values


def _runs(workspace, issues):
    values = {}
    for path in sorted((workspace.root / "runs").glob("*/run.json")):
        try:
            key = identifier(path.parent.name)
            relative_file(workspace.root, "runs/" + key + "/run.json")
            values[key] = workspace.inspect_run(key)
        except (OSError, ValueError, TypeError, KeyError) as exc:
            _issue(issues, "runs", path.parent.name, exc)
    return values


def _entry(collections, collection_id, source_id):
    collection = collections.get(collection_id)
    if collection is None:
        return None
    matches = [entry for entry in collection.get("entries", []) if entry.get("id") == source_id]
    return _source(collection, matches[0]) if len(matches) == 1 else None


def dataset_id(grid_id, role):
    """Stable identity independent of titles, enumeration order and host paths."""
    return "prepared-grid-" + digest({"grid_id": identifier(grid_id), "role": str(role)})


class WorkspaceScienceCatalog:
    """Additional prepared-grid provider and joined original scientific lineage.

    The callable accepts (workspace_key, workspace=None), returning dataset records.
    A supplied Workspace must match the Operator-selected workspace. It never
    substitutes a tenant or registers a guessed filename for a retained object.
    """

    def __init__(self, operator, *, collection_specs=None):
        self.operator = operator
        self.collection_specs = dict(NATIVE_COLLECTIONS)
        for kind, manifest in (collection_specs or {}).items():
            if not isinstance(kind, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", kind):
                raise ValueError("A native collection needs its registered directory name")
            if manifest is not None:
                _member(manifest)
            self.collection_specs[kind] = manifest

    def _workspace(self, workspace_key, supplied=None):
        selected = self.operator.ws(workspace_key)
        if supplied is not None:
            if (Path(supplied.root).resolve() != Path(selected.root).resolve()
                    or supplied.project.get("id") != selected.project.get("id")):
                raise ValueError("Select the Workspace registered to this workspace key")
            return supplied
        return selected

    def __call__(self, workspace_key, workspace=None):
        return self.datasets(workspace_key, workspace)

    def _rows(self, workspace_key, workspace, collections, grids, issues):
        rows = []
        for key, grid in grids.items():
            if grid.get("state") != "complete":
                continue
            spec = grid["spec"]
            collection_id = spec.get("source_collection_id")
            for role, raw in sorted(grid.get("files", {}).items()):
                try:
                    descriptor = _descriptor(raw)
                    member = "grids/" + key + "/" + descriptor["path"]
                    path = relative_file(workspace.root, member)
                    if path.stat().st_size != descriptor["bytes"]:
                        raise ValueError("The prepared artifact byte count changed")
                    extension = path.suffix.lower()
                    kind = "raster" if extension in (".tif", ".tiff") else (
                        "vector" if extension in (".gpkg", ".geojson", ".shp") else (
                            "table" if extension in (".csv", ".tsv", ".jsonl") else "document"))
                    source_id = spec.get("input_sources", {}).get(role)
                    selected_area = spec.get(role)
                    if role in ("reporting_area", "model_domain") and isinstance(selected_area, dict):
                        source_id = selected_area.get("source_id")
                    if role == "reporting_mask":
                        selected_area = spec.get("reporting_area", {})
                        source_id = selected_area.get("source_id")
                    original = _entry(collections, collection_id, source_id) if source_id else None
                    metadata = {
                        "provider": PROVIDER, "native_kind": "prepared_grid", "data_kind": kind,
                        "grid_id": key, "role": role, "state": grid["state"],
                        "workspace_relative_path": member,
                        "native_descriptor": descriptor,
                        "grid": _copy(grid["grid"]),
                        "input": _copy(grid.get("inputs", {}).get(role, {})),
                        "lineage": {"project_id": workspace.project["id"],
                                    "grid_id": key,
                                    "source_collection_id": collection_id,
                                    "source_id": source_id},
                    }
                    if "units" in descriptor:
                        metadata["units"] = _copy(descriptor["units"])
                    for field in ("nodata", "crs", "transform", "width", "height", "bounds",
                                  "resolution_m", "pixel_area_ha"):
                        if field in grid["grid"]:
                            metadata[field] = _copy(grid["grid"][field])
                    if original is not None:
                        metadata["source"] = original
                    if selected_area:
                        metadata["source_selection"] = _copy(selected_area)
                    reused = grid.get("reused_inputs", {})
                    if isinstance(reused, dict) and role in reused:
                        metadata["reused_input"] = _copy(reused[role])
                    title = spec.get("title") or "Prepared native grid"
                    rows.append({"id": dataset_id(key, role), "tenant_id": str(workspace_key),
                                 "name": title + " / " + str(role), "title": title + " / " + str(role),
                                 "kind": "dataset", "path": str(path), "sha256": descriptor["sha256"],
                                 "bytes": descriptor["bytes"], "metadata": metadata})
                except (OSError, ValueError, TypeError, KeyError) as exc:
                    _issue(issues, "prepared_grid_file", key + "/" + str(role), exc)
        return rows

    def datasets(self, workspace_key, workspace=None):
        workspace = self._workspace(workspace_key, workspace)
        issues = []
        collections = _immutable(workspace, "sources", issues)
        grids = _grids(workspace, issues)
        return self._rows(workspace_key, workspace, collections, grids, issues)

    @staticmethod
    def _public_dataset(row):
        return {key: _copy(value) for key, value in row.items() if key != "path"}

    def _native_index(self, workspace, issues):
        result = []
        for kind, manifest in self.collection_specs.items():
            pattern = "*.json" if manifest is None else "*/" + manifest
            records = []
            for path in sorted((workspace.root / kind).glob(pattern)):
                key = path.stem if manifest is None else path.relative_to(workspace.root / kind).parts[0]
                try:
                    key = identifier(key)
                    member = kind + "/" + (key + ".json" if manifest is None else key + "/" + manifest)
                    retained = relative_file(workspace.root, member)
                    records.append({"id": key, "kind": kind,
                                    "record_bytes": retained.stat().st_size})
                except (OSError, ValueError, TypeError, KeyError) as exc:
                    _issue(issues, kind, key, exc)
            result.append({"kind": kind, "count": len(records), "records": records})
        return result

    def native_record(self, workspace_key, kind, key):
        """Read a selected native assessment, comparison, review or delivery."""
        if kind not in self.collection_specs:
            raise ValueError("Select a registered native collection")
        workspace = self._workspace(workspace_key)
        key = identifier(key)
        manifest = self.collection_specs[kind]
        member = kind + "/" + (key + ".json" if manifest is None else key + "/" + manifest)
        path = relative_file(workspace.root, member)
        if manifest is None:
            record = workspace._get(kind, key)
        elif kind == "spatial-exports":
            from model.spatial_exports import SpatialExports
            record = SpatialExports(workspace).inspect(key, verify=False)
        elif kind == "analyses":
            summary = read_json(path)
            member = kind + "/" + key + "/analysis.json"
            record = read_json(relative_file(workspace.root, member))
            if (not isinstance(summary, dict) or not isinstance(record, dict)
                    or summary.get("id") != key or record.get("id") != key
                    or record.get("selection") != summary.get("selection")):
                raise ValueError("The native analysis differs from its retained index")
        else:
            record = read_json(path)
            if not isinstance(record, dict) or ("id" in record and record["id"] != key):
                raise ValueError("The selected native record belongs to a different item")
        result = {"kind": kind, "id": key, "record": record,
                  "manifest": {"path": member},
                  "snapshot_digest": digest(record)}
        if kind == "community-reports":
            # Metadata ID and output-directory selection ID are different.
            # Every original community-report descriptor is workspace-relative.
            result["descriptor_scope"] = "."
        elif kind in ("analyses", "spatial-exports", "comparisons", "deliveries"):
            result["descriptor_scope"] = kind + "/" + key
        return result

    def inventory(self, workspace_key):
        """Browsable native source/provenance view; no absolute host paths."""
        workspace = self._workspace(workspace_key)
        issues = []
        collections = _immutable(workspace, "sources", issues)
        profiles = _immutable(workspace, "profiles", issues)
        scenarios = _immutable(workspace, "scenarios", issues)
        grids = _grids(workspace, issues)
        runs = _runs(workspace, issues)
        rows = self._rows(workspace_key, workspace, collections, grids, issues)
        source_rows = []
        for collection in collections.values():
            source_rows.append({
                "id": collection["id"], "title": collection.get("title"),
                "captured_at": collection.get("captured_at"),
                "scope": _copy(collection.get("scope", {})),
                "notes": _copy(collection.get("notes", [])),
                "original_manifest": _retained(collection.get("original_manifest", {})),
                "entries": [_source(collection, entry) for entry in collection.get("entries", [])],
            })
        run_rows = [{"id": key, "state": row.get("state"), "selection": _copy(row["selection"]),
                     "created_at": row.get("created_at"), "completed_at": row.get("completed_at")}
                    for key, row in runs.items()]
        return {
            "schema": SCHEMA, "workspace_key": str(workspace_key),
            "project": _copy(workspace.project),
            "datasets": [self._public_dataset(row) for row in rows],
            "source_collections": source_rows,
            "grids": [{"id": key, "state": grid.get("state"), "spec": _copy(grid["spec"]),
                       "grid": _copy(grid["grid"]), "inputs": _copy(grid.get("inputs", {})),
                       "dataset_ids": [row["id"] for row in rows if row["metadata"]["grid_id"] == key]}
                      for key, grid in grids.items()],
            "profiles": list(profiles.values()), "scenarios": list(scenarios.values()),
            "runs": run_rows, "native_collections": self._native_index(workspace, issues),
            "issues": issues,
        }

    def lineage(self, workspace_key, *, grid_id=None, run_id=None):
        """Reopen the exact grid, source edition, parameters and scenario recipe."""
        if grid_id is None and run_id is None:
            raise ValueError("Select a retained grid or native run")
        workspace = self._workspace(workspace_key)
        runs = []
        if run_id is not None:
            run = workspace.inspect_run(identifier(run_id))
            selected_grid = run["selection"]["grid_id"]
            if grid_id is not None and identifier(grid_id) != selected_grid:
                raise ValueError("The selected run belongs to a different native grid")
            grid_id = selected_grid
            runs = [run]
        grid_id = identifier(grid_id)
        grid = workspace.get_grid(grid_id)
        if not runs:
            issues = []
            runs = [run for run in _runs(workspace, issues).values()
                    if run["selection"]["grid_id"] == grid_id]
        else:
            issues = []
        profiles, scenarios, sources = {}, {}, {}
        requested = []

        def need(collection_id, source_id, use):
            if collection_id is not None and source_id is not None:
                requested.append((collection_id, source_id, use))

        spec = grid["spec"]
        collection_id = spec.get("source_collection_id")
        for role, source_id in spec.get("input_sources", {}).items():
            need(collection_id, source_id, "grid input " + role)
        for role in ("reporting_area", "model_domain"):
            need(collection_id, spec.get(role, {}).get("source_id"), role)
        for run in runs:
            selection = run["selection"]
            profile = workspace._get("profiles", selection["profile_id"])
            scenario = workspace._get("scenarios", selection["scenario_id"])
            profiles[profile["id"]] = profile
            scenarios[scenario["id"]] = scenario
            need(profile.get("source_collection_id"), profile.get("biophysical_source_id"),
                 "biophysical table for profile " + profile["id"])
            for patch_index, patch in enumerate(scenario.get("patches", [])):
                need(scenario.get("source_collection_id"), patch.get("mask_source_id"),
                     "scenario " + scenario["id"] + " patch " + str(patch_index + 1))
        collections = {}
        for collection_id, source_id, use in requested:
            try:
                if collection_id not in collections:
                    collections[collection_id] = workspace._get("sources", collection_id)
                original = _entry(collections, collection_id, source_id)
                if original is None:
                    raise ValueError("The selected source edition is missing its source ID")
                key = (collection_id, source_id)
                if key not in sources:
                    sources[key] = {**original, "uses": []}
                if use not in sources[key]["uses"]:
                    sources[key]["uses"].append(use)
            except (OSError, ValueError, TypeError, KeyError) as exc:
                _issue(issues, "source", str(collection_id) + "/" + str(source_id), exc)
        return {
            "schema": SCHEMA, "workspace_key": str(workspace_key),
            "project": _copy(workspace.project), "grid": _copy(grid),
            "runs": [{"id": run["id"], "state": run.get("state"),
                      "selection": _copy(run["selection"])} for run in runs],
            "profiles": list(profiles.values()), "scenarios": list(scenarios.values()),
            "sources": list(sources.values()), "issues": issues,
        }

    def resolve(self, workspace_key, selected_dataset_id):
        """Verify a selected original prepared artifact before native analysis."""
        workspace = self._workspace(workspace_key)
        # Prepared grids are immutable; retain concurrent access during model runs.
        rows = self.datasets(workspace_key, workspace)
        matches = [row for row in rows if row["id"] == selected_dataset_id]
        if len(matches) != 1:
            raise ValueError("Select a prepared dataset retained in this Workspace")
        row = matches[0]
        key = row["metadata"]["grid_id"]
        descriptor = row["metadata"]["native_descriptor"]
        scope = workspace.root / "grids" / key
        path = relative_file(scope, descriptor["path"])
        verify_file(scope, descriptor)
        if path.resolve() != Path(row["path"]).resolve():
            raise ValueError("The selected prepared artifact identity changed")
        return row

    def download(self, workspace_key, selected_dataset_id):
        """Use the Operator's existing registered download ticket service."""
        row = self.resolve(workspace_key, selected_dataset_id)
        ticket = self.operator._ticket(
            workspace_key, Path(row["path"]), row["metadata"]["native_descriptor"],
            label=row["title"])
        return {"dataset": self._public_dataset(row), "download": ticket}
