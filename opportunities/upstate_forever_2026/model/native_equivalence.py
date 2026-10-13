"""Compare actual inputs when joining independently completed native model stages.

Container metadata, project identifiers and unused CSV columns are not native
model inputs. Values, masks, grid geometry, parameters and model-specific
biophysical columns are compared explicitly.
"""
from __future__ import annotations
from pathlib import Path
from .common import (INVEST_SOURCE, INVEST_VERSION, describe_file, file_digest, finite,
                     output_models, required_roles, selected_models, verify_file)
from .profiles import inspect_table
from .reuse import dataset_companions
from . import rasters

_COLUMNS = {
    "ndr": ("lucode", "load_n", "load_p", "load_type_n", "load_type_p",
            "eff_n", "eff_p", "crit_len_n", "crit_len_p",
            "proportion_subsurface_n"),
    "sdr": ("lucode", "usle_c", "usle_p"),
}

class NativeInputMatcher:
    """Compare a prepared target with retained source runs in one workspace.

    Prepare a land-cover scenario's actual raster before matching it, or supply
    that existing raster as target_lulc. Baselines use their retained NLCD.
    The cache importer remains responsible for retaining native stage outputs.
    """
    def __init__(self, workspace, target_run_id, *, target_lulc=None, target_runtime=None):
        self.workspace = workspace
        self.target_run_id = target_run_id
        self.target_runtime = target_runtime
        self.target_lulc = Path(target_lulc).resolve(strict=True) if target_lulc else None
        if self.target_lulc and not self.target_lulc.is_relative_to(workspace.root):
            raise ValueError("Target land cover must belong to the retained workspace")
        self._runs = {}
        self._verified = {}
        self._tables = {}
        self._raster_pairs = {}
        self._vector_pairs = {}
        self.target = self._run(target_run_id)

    def _run(self, run_id):
        if run_id not in self._runs:
            state = self.workspace.inspect_run(run_id)
            selection = state["selection"]
            self._runs[run_id] = {
                "state": state,
                "root": self.workspace.root / "runs" / run_id,
                "grid": self.workspace.get_grid(selection["grid_id"]),
                "profile": self.workspace._get("profiles", selection["profile_id"]),
                "scenario": self.workspace._get("scenarios", selection["scenario_id"]),
            }
        return self._runs[run_id]

    def _file(self, root, item):
        path = root / item["path"]
        observed = path.stat()
        key = (str(path), item["sha256"], item["bytes"],
               observed.st_dev, observed.st_ino, observed.st_size,
               observed.st_mtime_ns, observed.st_ctime_ns)
        if key not in self._verified:
            self._verified[key] = verify_file(root, item)
        return self._verified[key]

    def _grid_file(self, info, role):
        grid = info["grid"]
        item = grid["files"][role]
        root = self.workspace.root / "grids" / grid["id"]
        return self._file(root, item), item

    def _landcover(self, info, supplied=None):
        if info["scenario"]["kind"] == "baseline":
            path, item = self._grid_file(info, "NLCD")
        else:
            stage = info["state"].get("stages", {}).get("landcover")
            if not stage or not stage.get("artifact"):
                raise ValueError("Prepare the actual land-cover scenario raster before native-stage matching")
            item = stage["artifact"]
            path = self._file(info["root"], item)
        if supplied is not None and supplied != path.resolve(strict=True):
            raise ValueError("Use the actual land cover retained by the target run")
        return path, item

    def _table(self, info, model):
        profile = info["profile"]
        path, _ = self.workspace.source_file(profile["source_collection_id"],
                                              profile["biophysical_source_id"])
        observed = path.stat()
        key = (str(path), observed.st_size, observed.st_mtime_ns,
               observed.st_ctime_ns, model)
        if key not in self._tables:
            if file_digest(path) != profile["table_summary"]["sha256"]:
                raise ValueError("The retained native biophysical source has changed")
            table = inspect_table(path, models=[model])
            rows = []
            for row in table["rows"]:
                values = []
                for name in _COLUMNS[model]:
                    if name == "lucode":
                        value = int(row[name].strip())
                    elif name.startswith("load_type_"):
                        value = row[name].strip()
                    else:
                        value = finite(row[name], name)
                    values.append(value)
                rows.append(tuple(values))
            self._tables[key] = tuple(sorted(rows))
        return self._tables[key]

    def _dataset_identity(self, path, item):
        """Use the same companion bodies as the native stage signature."""
        companions = []
        for candidate in dataset_companions(path):
            descriptor = describe_file(self.workspace.root, candidate)
            companions.append((candidate.name[len(path.stem):],
                               descriptor["bytes"], descriptor["sha256"]))
        return item["sha256"], tuple(companions)

    def _same_raster(self, left, right):
        a_path, a_item = left
        b_path, b_item = right
        a_identity = self._dataset_identity(a_path, a_item)
        b_identity = self._dataset_identity(b_path, b_item)
        if a_identity == b_identity:
            return True
        key = tuple(sorted((a_identity, b_identity)))
        if key in self._raster_pairs:
            return self._raster_pairs[key]
        import numpy as np
        import rasterio
        equal = True
        with rasterio.open(a_path) as a, rasterio.open(b_path) as b:
            if (a.crs != b.crs or a.transform != b.transform or
                    a.width != b.width or a.height != b.height or
                    a.count < 1 or b.count < 1):
                equal = False
            else:
                for _, window in a.block_windows(1):
                    av = a.read(1, window=window, masked=True)
                    bv = b.read(1, window=window, masked=True)
                    am = np.ma.getmaskarray(av)
                    bm = np.ma.getmaskarray(bv)
                    if not np.array_equal(am, bm):
                        equal = False
                        break
                    valid = ~am
                    a_values = np.ma.getdata(av)[valid]
                    b_values = np.ma.getdata(bv)[valid]
                    if (not np.isfinite(a_values).all() or
                            not np.isfinite(b_values).all() or
                            not np.array_equal(a_values, b_values)):
                        equal = False
                        break
        self._raster_pairs[key] = equal
        return equal

    def _same_domain(self, left, right):
        a_path, a_item = self._grid_file(left, "model_domain")
        b_path, b_item = self._grid_file(right, "model_domain")
        a_identity = self._dataset_identity(a_path, a_item)
        b_identity = self._dataset_identity(b_path, b_item)
        if a_identity == b_identity:
            return True
        key = tuple(sorted((a_identity, b_identity)))
        if key not in self._vector_pairs:
            from pyproj import CRS
            crs = CRS.from_user_input(left["grid"]["grid"]["crs"])
            a_rows, _ = rasters.vector_geometry(a_path, layer="model_domain", target_crs=crs)
            b_rows, _ = rasters.vector_geometry(b_path, layer="model_domain", target_crs=crs)
            # The maintained grid writer emits one unioned feature with ID 1.
            # Preserve that feature identity as well as its actual footprint.
            if len(a_rows) != 1 or len(b_rows) != 1:
                self._vector_pairs[key] = False
            else:
                a, b = a_rows[0], b_rows[0]
                self._vector_pairs[key] = (
                    a["id"] == b["id"] and
                    a["properties"].get("id") == b["properties"].get("id") and
                    a["geometry"].equals(b["geometry"]))
        return self._vector_pairs[key]

    def compare(self, source_run_id, model):
        """Return native-stage and converted-mass reuse eligibility separately."""
        model = selected_models([model])[0]
        source = self._run(source_run_id)
        target = self.target
        source_state = source["state"]
        target_state = target["state"]
        result = {"model": model, "source_run_id": source_run_id,
                  "target_run_id": self.target_run_id,
                  "matches": False, "mass_exports_match": False, "differences": []}
        def different(name):
            result["differences"].append(name)
        if model not in selected_models(target_state["selection"]):
            different("target model selection")
        if model not in selected_models(source_state["selection"]):
            different("source model selection")
        for label, info in (("target", target), ("source", source)):
            if info["state"]["selection"].get("invest_version") != INVEST_VERSION:
                different(label + " native version")
        stage = source_state.get("stages", {}).get(model)
        # A later model can resume under another runtime. The native stage owns
        # the execution environment that produced its retained results.
        runtime = (stage or {}).get("runtime") or source_state.get("runtime", {})
        dependencies = ("ndr", "sdr") if model == "ndr" else ("sdr",)
        if runtime.get("version") != INVEST_VERSION:
            different("source stage native version")
        for dependency in dependencies:
            module = runtime.get("modules", {}).get(dependency, {})
            if module.get("git_blob") != INVEST_SOURCE[dependency + "_blob"]:
                different("source native dependency " + dependency)
        target_runtime = self.target_runtime or target_state.get("runtime")
        if target_runtime:
            if target_runtime.get("version") != INVEST_VERSION:
                different("target runtime native version")
            for dependency in dependencies:
                module = target_runtime.get("modules", {}).get(dependency, {})
                if module.get("git_blob") != INVEST_SOURCE[dependency + "_blob"]:
                    different("target native dependency " + dependency)
            if (target_runtime.get("environment") is not None and
                    runtime.get("environment") != target_runtime["environment"]):
                different("native runtime environment")
        if not stage or not stage.get("completed_at") or not stage.get("files"):
            different("source native stage is incomplete")
        else:
            required_outputs = {native_id for _, native_id in output_models([model]).values()}
            if model == "sdr":
                required_outputs.add("ls")
            if required_outputs - set(stage["files"]):
                different("source native stage lacks required registry outputs")
        if result["differences"]:
            return result
        from pyproj import CRS
        a_grid, b_grid = target["grid"]["grid"], source["grid"]["grid"]
        if (CRS.from_user_input(a_grid["crs"]) != CRS.from_user_input(b_grid["crs"]) or
                any(a_grid[name] != b_grid[name] for name in ("transform", "width", "height"))):
            different("model grid")
        if target["profile"].get(model) != source["profile"].get(model):
            different("native parameters")
        if self._table(target, model) != self._table(source, model):
            different("model biophysical columns")
        if result["differences"]:
            return result
        if not self._same_domain(target, source):
            different("model-domain geometry")
        for role in required_roles([model]):
            if role == "NLCD":
                continue
            if not self._same_raster(self._grid_file(target, role), self._grid_file(source, role)):
                different(role + " values or grid")
        if not self._same_raster(self._landcover(target, self.target_lulc), self._landcover(source)):
            different("actual land-cover values or grid")
        result["matches"] = not result["differences"]
        if result["matches"]:
            complete_exports = all(name in source_state.get("artifacts", {})
                                   for name in output_models([model]))
            result["mass_exports_match"] = complete_exports and self._same_raster(
                self._grid_file(target, "reporting_mask"),
                self._grid_file(source, "reporting_mask"))
        return result
