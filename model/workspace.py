"""Persistent source editions, parameter profiles, scenarios and native runs."""
from __future__ import annotations
import csv
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import uuid
from .common import (SCHEMA, INVEST_VERSION, ROLES, atomic_json, canonical,
                     describe_file, digest, file_digest, held, identifier, now,
                     read_json, relative_file, retain_file, verify_file,
                     _retained_object_matches, _sync_directory)
from .profiles import checked_parameters, inspect_table, scenario_spec
from .model_selection import (normalize_selection, selected, grid_models, run_models,
                              required_roles, validate_completed_run)
from .grid_reuse import retain_grid_definition, reuse_grid_inputs
from .record_catalog import ProjectedFileCache, delivery_summary
from .operator_catalog import OperatorCatalogue

class Workspace:
    def __init__(self, root, *, create=False, title="Upper Savannah scientific workspace"):
        self.root = Path(root).resolve()
        if create:
            self.root.mkdir(parents=True, exist_ok=True)
            with held(self.root / ".workspace.lock"):
                manifest = self.root / "workspace.json"
                if not manifest.exists():
                    atomic_json(manifest, {"schema": SCHEMA, "id": str(uuid.uuid4()),
                                           "title": title, "created_at": now()}, immutable=True)
        self._delivery_catalog_cache = ProjectedFileCache()
        self._operator_catalog = OperatorCatalogue(self.root)
        self.project = read_json(self.root / "workspace.json")
        if self.project.get("schema") != SCHEMA:
            raise ValueError("Select an original Upper Savannah scientific workspace")

    def _save(self, kind, payload):
        value = {key: item for key, item in dict(payload).items() if key not in ("id", "schema")}
        value["schema"] = "upstate." + kind + "/v1"
        key = digest(value)
        atomic_json(self.root / kind / (key + ".json"), value, immutable=True)
        return {**value, "id": key}

    def _get(self, kind, key):
        key = identifier(key)
        value = read_json(self.root / kind / (key + ".json"))
        if digest(value) != key:
            raise ValueError("Retained " + kind + " item changed")
        return {**value, "id": key}

    def _list(self, kind):
        folder = self.root / kind
        return [self._get(kind, p.stem) for p in sorted(folder.glob("*.json"))] if folder.exists() else []

    def overview(self):
        """Return all original records, preserving the complete model API."""
        return self._overview()

    def operator_overview(self):
        """Catalogue projection for opt-in live operator polling."""
        paths = sorted((self.root / "deliveries").glob("*/delivery-state.json"))
        self._delivery_catalog_cache.retain_paths(paths)
        rows = [self._delivery_catalog_cache.read(path, delivery_summary) for path in paths]
        return self._overview(delivery_rows=rows, catalogue=self._operator_catalog)

    def _overview(self, *, delivery_rows=None, catalogue=None):
        visited = []

        def immutable(kind):
            return catalogue.immutable(kind, visited) if catalogue else self._list(kind)

        def mutable(kind, filename):
            if catalogue:
                return catalogue.mutable(kind, filename, visited)
            return [read_json(path) for path in sorted((self.root / kind).glob("*/" + filename))]

        result = {"project": self.project, "sources": immutable("sources"),
                "profiles": immutable("profiles"), "scenarios": immutable("scenarios"),
                "grids": mutable("grids", "grid.json"),
                "runs": mutable("runs", "run.json"),
                "observations": immutable("observations"),
                "scenario_analyses": mutable("analyses", "summary.json"),
                "community_tables": immutable("community-tables"),
                "community_plans": immutable("community-plans"),
                "community_reports": immutable("community-reports"),
                "planning_inventories": immutable("planning-inventories"),
                "portfolios": immutable("portfolios"),
                "portfolio_reports": immutable("portfolio-reports"),
                "spatial_reviews": immutable("spatial-reviews"),
                "customer_reviews": immutable("reviews"),
                "customer_review_responses": immutable("review-responses"),
                "spatial_exports": mutable("spatial-exports", "export.json"),
                "observation_comparisons": immutable("observation-comparisons"),
                "comparisons": mutable("comparisons", "comparison.json"),
                "deliveries": delivery_rows if delivery_rows is not None else
                    mutable("deliveries", "delivery-state.json")}
        if catalogue:
            catalogue.finish(visited)
        return result

    def retained_item(self, kind, key):
        """Open one original record without enumerating unrelated workspace data."""
        immutable = {
            "sources": "sources", "profiles": "profiles", "scenarios": "scenarios",
            "observations": "observations", "community_tables": "community-tables",
            "community_plans": "community-plans", "community_reports": "community-reports",
            "planning_inventories": "planning-inventories", "portfolios": "portfolios",
            "portfolio_reports": "portfolio-reports", "spatial_reviews": "spatial-reviews",
            "customer_reviews": "reviews", "customer_review_responses": "review-responses",
            "observation_comparisons": "observation-comparisons",
        }
        if kind in immutable:
            return self._get(immutable[kind], key)
        mutable = {
            "grids": ("grids", "grid.json"),
            "runs": ("runs", "run.json"),
            "scenario_analyses": ("analyses", "summary.json"),
            "spatial_exports": ("spatial-exports", "export.json"),
            "comparisons": ("comparisons", "comparison.json"),
            "deliveries": ("deliveries", "delivery-state.json"),
        }
        if kind not in mutable:
            raise ValueError("Unknown retained record kind: " + str(kind))
        key = identifier(key)
        folder, filename = mutable[kind]
        value = read_json(self.root / folder / key / filename)
        if value.get("id") != key:
            raise ValueError("Retained " + kind + " item identity changed")
        return value

    def sources(self):
        return self._list("sources")

    def import_sources(self, manifest):
        if isinstance(manifest, (str, Path)):
            manifest_path = Path(manifest).resolve(strict=True)
            value = read_json(manifest_path)
            source_root = manifest_path.parent
            original = retain_file(self.root, manifest_path)
        else:
            raise ValueError("Import the retained source manifest from a local file")
        if value.get("schema") != "upstate.sources/v1" or not isinstance(value.get("entries"), list):
            raise ValueError("Source manifest must use upstate.sources/v1 and list entries")
        entries, seen = [], set()
        for row in value["entries"]:
            row = dict(row)
            name = row.get("id")
            if not isinstance(name, str) or not name or name in seen:
                raise ValueError("Each source edition needs a unique nonempty source ID")
            seen.add(name)
            if not row.get("uri") or not row.get("vintage") or not row.get("title"):
                raise ValueError("Source " + name + " needs its original URI, vintage and title")
            if row.get("kind") not in ("raster", "vector", "table", "document"):
                raise ValueError("Source kind must be raster, vector, table or document")
            source_name = row.pop("path")
            selected_companions = row.pop("companions", [])
            source_names = [source_name] + [item["path"] for item in selected_companions]
            native_names = [Path(name).as_posix() for name in source_names]
            if any("\\" in name or "\0" in name for name in native_names):
                raise ValueError("Native source paths must use portable relative names")
            # Preserve native sidecar/reference relationships within this entry.
            # Old source editions without view_path continue to use filename.
            common_parent = Path(os.path.commonpath([str(Path(name).parent) for name in native_names]))
            view_names = [Path(name).relative_to(common_parent).as_posix() for name in native_names]
            if len(set(view_names)) != len(view_names):
                raise ValueError("Native source paths collide")
            path = relative_file(source_root, source_name)
            body = {**retain_file(self.root, path, row.pop("sha256", None)),
                    "source_path": source_name, "view_path": view_names[0]}
            companions = []
            for companion, view_name in zip(selected_companions, view_names[1:]):
                cp = relative_file(source_root, companion["path"])
                companions.append({**retain_file(self.root, cp, companion.get("sha256")),
                                   "source_path": companion["path"], "view_path": view_name})
            entries.append({**row, "body": body, "companions": companions})
        return self._save("sources", {"title": value.get("title", "Source edition"),
                                      "captured_at": value.get("captured_at"),
                                      "original_manifest": original, "entries": entries,
                                      "notes": value.get("notes", []),
                                      "scope": value.get("scope", {})})

    def source_file(self, collection_id, source_id):
        collection = self._get("sources", collection_id)
        found = [e for e in collection["entries"] if e["id"] == source_id]
        if len(found) != 1:
            raise ValueError("Select an existing source ID in the retained source edition")
        entry = found[0]
        view = self.root / "source-views" / collection_id / digest(source_id)
        view.mkdir(parents=True, exist_ok=True)
        with held(self.root / "objects" / (".source-view-" + collection_id + "-" + digest(source_id) + ".lock")):
            for body in [entry["body"]] + entry["companions"]:
                checksum = identifier(body["sha256"])
                with held(self.root / "objects" / (".intake-" + checksum + ".lock")):
                    original = relative_file(self.root, body["object"])
                    if not _retained_object_matches(original, checksum, body["bytes"]):
                        raise ValueError("Original scientific source changed: " + source_id)
                    name = body.get("view_path", body["filename"])
                    member = Path(name)
                    if (member.is_absolute() or not member.parts or ".." in member.parts
                            or member.as_posix() != name or "\\" in name or "\0" in name):
                        raise ValueError("Invalid native source member path")
                    target = view / member
                    if not target.parent.resolve().is_relative_to(view.resolve()) or target.is_symlink():
                        raise ValueError("Native source view escapes its retained directory")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not _retained_object_matches(target, checksum, body["bytes"]):
                        pending = None
                        candidate = target.parent / (".source-view-" + uuid.uuid4().hex)
                        try:
                            try:
                                os.link(original, candidate)
                                pending = candidate
                            except FileExistsError:
                                raise
                            except OSError:
                                with original.open("rb") as src, tempfile.NamedTemporaryFile(
                                        dir=target.parent, prefix=".source-view-", delete=False) as out:
                                    pending = Path(out.name)
                                    shutil.copyfileobj(src, out, 1024 * 1024)
                                    out.flush()
                                    os.fsync(out.fileno())
                            if not _retained_object_matches(pending, checksum, body["bytes"]):
                                raise ValueError("Original source changed during native view creation")
                            # Views are derived, not immutable source editions.
                            # Reconnect a damaged old hard link after CAS repair.
                            os.replace(pending, target)
                            # rename may be a no-op when a concurrent legacy
                            # writer linked this same inode to the final name.
                            pending.unlink(missing_ok=True)
                            pending = None
                            _sync_directory(target.parent)
                        finally:
                            if pending is not None:
                                pending.unlink(missing_ok=True)
                                _sync_directory(target.parent)
                    if not _retained_object_matches(target, checksum, body["bytes"]):
                        raise ValueError("Native source view differs: " + source_id)
        return view / entry["body"].get("view_path", entry["body"]["filename"]), entry

    def save_profile(self, value):
        value, active = normalize_selection(value)
        parameters = checked_parameters(value)
        collection = identifier(value["source_collection_id"])
        table_path, table_entry = self.source_file(collection, value["biophysical_source_id"])
        if table_entry["kind"] != "table":
            raise ValueError("Select the original biophysical CSV source")
        table = inspect_table(table_path, selected_models=active)
        value.update(parameters, table_summary={"columns": table["columns"], "lucodes": table["lucodes"],
                                                "rows": len(table["rows"]), "sha256": table_entry["body"]["sha256"]})
        return self._save("profiles", value)

    def save_scenario(self, value):
        value = scenario_spec(dict(value))
        collection = identifier(value["source_collection_id"])
        for patch in value.get("patches", []):
            _, entry = self.source_file(collection, patch["mask_source_id"])
            if entry["kind"] not in ("vector", "raster"):
                raise ValueError("Scenario masks must be retained polygons or aligned binary rasters")
        return self._save("scenarios", value)

    def prepare_grid(self, spec):
        from . import rasters
        from pyproj import CRS
        spec, active = normalize_selection(spec)
        roles = required_roles(active)
        collection_id = identifier(spec["source_collection_id"])
        inputs = spec["input_sources"]
        if not isinstance(inputs, dict):
            raise ValueError("Select the actual source IDs for the chosen native models")
        missing_roles = [role for role in roles if not inputs.get(role)]
        if missing_roles:
            raise ValueError("Selected models require source roles: " + ", ".join(missing_roles))
        reference, _ = self.source_file(collection_id, inputs["NLCD"])
        import rasterio
        with rasterio.open(reference) as ref:
            crs = CRS.from_user_input(ref.crs)
        def geometry(selection):
            p, entry = self.source_file(collection_id, selection["source_id"])
            rows, _ = rasters.vector_geometry(p, layer=selection.get("layer") or entry.get("layer"),
                                               where=selection.get("where"), target_crs=crs)
            return rasters.polygon_union(rows)
        reporting = geometry(spec["reporting_area"])
        model_core = geometry(spec["model_domain"])
        buffer_m = float(spec["upstream_buffer_m"])
        if not 0 <= buffer_m < 1000000:
            raise ValueError("Specify the actual nonnegative model-context buffer in metres")
        if not model_core.buffer(1e-5).covers(reporting):
            raise ValueError("Model-domain source must cover the full selected reporting basin")
        model_geometry = model_core if buffer_m == 0 else model_core.buffer(buffer_m)
        grid = rasters.grid_definition(
            reference, model_geometry, resolution=spec.get("resolution_m"))
        grid = retain_grid_definition(self, spec, grid)
        key = digest({"spec": spec, "grid": grid})
        directory = self.root / "grids" / key
        directory.mkdir(parents=True, exist_ok=True)
        state_path = directory / "grid.json"
        with held(directory / ".grid.lock", blocking=False):
            if state_path.exists():
                state = read_json(state_path)
                if state.get("state") == "complete":
                    for item in state["files"].values():
                        verify_file(directory, item)
                    return state
            else:
                state = {"schema": "upstate.grid/v1", "id": key, "state": "building",
                         "created_at": now(), "spec": spec, "grid": grid, "files": {}, "inputs": {}}
                atomic_json(state_path, state)
            state = reuse_grid_inputs(self, state, directory, active)
            if state.get("reused_inputs"):
                atomic_json(state_path, state)
            for name, geometry_value in (("model_domain", model_geometry), ("reporting_area", reporting)):
                if name not in state["files"]:
                    path = directory / (name + ".gpkg")
                    path.unlink(missing_ok=True)
                    rasters.write_geometry(path, geometry_value, crs, layer=name,
                                            title=spec.get("title", name))
                    state["files"][name] = describe_file(directory, path)
                    atomic_json(state_path, state)
            if "reporting_mask" not in state["files"]:
                path = directory / "reporting_mask.tif"
                rasters.write_mask(path, grid, reporting)
                state["files"]["reporting_mask"] = describe_file(directory, path,
                                                               units="mask", selection="pixel centre")
                atomic_json(state_path, state)
            expected_units = {"DEM": "m", "NLCD": "class",
                              "R_FACTOR": "MJ*mm/(ha*h*year)",
                              "K_FACTOR": "t*ha*h/(ha*MJ*mm)"}
            for role in roles:
                if role in state["files"]:
                    verify_file(directory, state["files"][role])
                    continue
                path, entry = self.source_file(collection_id, inputs[role])
                if entry["kind"] != "raster":
                    raise ValueError(role + " requires a prepared source raster")
                conversion = entry.get("conversion")
                actual_units = conversion.get("target_units") if conversion else entry.get("units")
                if role in expected_units and actual_units != expected_units[role]:
                    raise ValueError(role + " requires declared units " + expected_units[role] +
                                     "; retain any conversion and its source reference")
                output = directory / (role.lower() + ".tif")
                checkpoint_directory = directory / ".alignment" / role.lower()
                stats = rasters.align_source(
                    path, output, grid, categorical=role == "NLCD",
                    resampling=entry.get("resampling"), conversion=conversion,
                    checkpoint_directory=checkpoint_directory,
                    source_identity={"collection_id": collection_id, "source_id": entry["id"],
                                     "body": entry["body"], "companions": entry["companions"]})
                if role in ("R_FACTOR", "K_FACTOR") and stats["minimum"] is not None and stats["minimum"] < 0:
                    raise ValueError(role + " contains negative physical values")
                state["files"][role] = describe_file(directory, output, units=actual_units)
                state["inputs"][role] = {"source_id": entry["id"], "source_sha256": entry["body"]["sha256"],
                                         "source_uri": entry["uri"], "vintage": entry["vintage"], **stats}
                atomic_json(state_path, state)
                # The complete, hashed TIFF is now retained by grid.json.
                # Remove only its rebuildable tiles after that durable record.
                shutil.rmtree(checkpoint_directory, ignore_errors=True)
            state.update(state="complete", completed_at=now())
            atomic_json(state_path, state)
            return state

    def get_grid(self, key):
        key = identifier(key)
        grid = read_json(self.root / "grids" / key / "grid.json")
        if grid.get("state") != "complete":
            raise ValueError("Finish the selected grid preparation")
        if digest({"spec": grid["spec"], "grid": grid["grid"]}) != key:
            raise ValueError("Selected grid definition changed")
        roles = required_roles(grid_models(grid))
        missing = [role for role in roles
                   if role not in grid.get("files", {}) or role not in grid.get("inputs", {})]
        if missing:
            raise ValueError("Selected grid lacks completed input roles: " + ", ".join(missing))
        return grid

    def prepare_run(self, selection):
        profile = self._get("profiles", selection["profile_id"])
        scenario = self._get("scenarios", selection["scenario_id"])
        from .scenario_footprint import validate_destination_codes
        validate_destination_codes(profile, scenario)
        grid = self.get_grid(selection["grid_id"])
        selection, active = normalize_selection(selection, default=grid_models(grid))
        if not set(active).issubset(grid_models(grid)):
            raise ValueError("Prepare the selected native models on this grid or extend its original inputs")
        if not set(active).issubset(selected(profile)):
            raise ValueError("Select a profile containing the chosen native model parameters and table fields")
        missing_inputs = [role for role in required_roles(active) if role not in grid["files"]]
        if missing_inputs:
            raise ValueError("The grid lacks the selected prepared inputs: " + ", ".join(missing_inputs))
        available = {int(x) for x in grid["inputs"]["NLCD"]["class_counts"]}
        missing = available - set(profile["table_summary"]["lucodes"])
        if missing:
            raise ValueError("Biophysical table lacks land-cover codes " + ", ".join(map(str, sorted(missing))))
        value = {"schema": "upstate.run-selection/v1", "grid_id": grid["id"],
                 "profile_id": profile["id"], "scenario_id": scenario["id"],
                 "invest_version": INVEST_VERSION}
        value, _ = normalize_selection(value, default=active)
        key = digest(value)
        directory = self.root / "runs" / key
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / ".prepare.lock"):
            state = directory / "run.json"
            if not state.exists():
                atomic_json(state, {"schema": "upstate.run/v1", "id": key, "selection": value,
                                    "state": "prepared", "created_at": now(), "stages": {}, "artifacts": {}})
        return read_json(directory / "run.json")

    def inspect_run(self, key):
        identifier(key)
        value = read_json(self.root / "runs" / key / "run.json")
        if digest(value["selection"]) != key:
            raise ValueError("Original run selection changed")
        validate_completed_run(value)
        return value

    def run(self, key, *, reuse_source_run_ids=None):
        from .native import execute_run
        return execute_run(self, identifier(key), reuse_source_run_ids=reuse_source_run_ids)

    def combine_runs(self, selection, source_runs, *, execute=True):
        from .run_assembly import combine_runs
        return combine_runs(self, selection, source_runs, execute=execute)

    def compare_runs(self, ids):
        from .native import compare_runs
        return compare_runs(self, ids)

    def analyze_scenarios(self, selection):
        from .scenario_analysis import analyze
        return analyze(self, selection)

    def import_observations(self, path, metadata):
        from .observations import ingest
        return ingest(self, path, metadata)

    def compare_observations(self, run_id, observation_id, catchments):
        from .observations import compare
        return compare(self, run_id, observation_id, catchments)

    def build_delivery(self, selection):
        from .delivery import build
        return build(self, selection)

    def import_community_table(self, selection):
        from .communities import import_table
        return import_table(self, selection)

    def save_community_plan(self, selection):
        from .communities import save_plan
        return save_plan(self, selection)

    def build_community_report(self, selection):
        from .community_reports import build
        return build(self, selection)

    def build_planning_inventory(self, selection):
        from .planning_inventory import build
        return build(self, selection)

    def preview_portfolio(self, selection):
        from .portfolios import preview
        return preview(self, selection)

    def save_portfolio(self, selection):
        from .portfolios import save_portfolio
        return save_portfolio(self, selection)

    def prepare_portfolio_scenario(self, selection):
        from .portfolios import prepare_scenario
        return prepare_scenario(self, selection)

    def prepare_portfolio_run(self, selection):
        portfolio = self._get("portfolios", selection["portfolio_id"])
        context = portfolio["context"]
        grid_id = selection.get("grid_id") or context["grid_id"]
        if grid_id != context["grid_id"]:
            raise ValueError("Use the portfolio's original reporting grid for its selected parcel scenario")
        profile_id = selection.get("profile_id") or context["profile_id"]
        baseline = self.inspect_run(context["baseline_run_id"])
        active = selection.get("models", list(run_models(baseline)))
        scenario = self.prepare_portfolio_scenario(selection)
        return self.prepare_run({"grid_id": grid_id, "profile_id": profile_id,
                                 "scenario_id": scenario["id"], "models": active})

    def run_portfolio(self, selection):
        prepared = self.prepare_portfolio_run(selection)
        return self.run(prepared["id"])

    def build_portfolio_report(self, selection):
        from .portfolios import build_report
        return build_report(self, selection)

    def build_portfolio_decision(self, selection):
        from .portfolios import build_decision_report
        return build_decision_report(self, selection)

    def backup(self, destination, *, include_intermediates=True):
        """A complete self-contained project; native run caches can be selected."""
        from .portable import backup
        return backup(self, destination, include_intermediates=include_intermediates)
