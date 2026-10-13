"""Resume original parameter-study aggregation without repeating completed windows.

The caller verifies both retained raster bodies before opening a cache. Every
entry binds their exact bytes, the original reporting geometries, and the current
aggregation implementation and GIS runtime. Native calculations remain unchanged.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import math
from pathlib import Path
import sys
import time

from .common import atomic_json, digest, file_digest, now, read_json

CONTEXT_SCHEMA = "upstate.parameter-pair-context/v1"
PAIR_SCHEMA = "upstate.parameter-pair-result/v1"
CHECKPOINT_SCHEMA = "upstate.parameter-pair-checkpoint/v1"
PROGRESS_SCHEMA = "upstate.parameter-aggregation-progress/v1"
TOTAL_FIELDS = ("baseline_mass", "case_mass", "baseline_full_mass", "case_full_mass",
                "baseline_valid_cells", "case_valid_cells", "paired_valid_cells")


def _body(descriptor):
    value = {name: descriptor[name] for name in ("bytes", "sha256")}
    if type(value["bytes"]) is not int or value["bytes"] < 0:
        raise ValueError("A retained raster needs its original byte length")
    if (not isinstance(value["sha256"], str) or len(value["sha256"]) != 64
            or any(c not in "0123456789abcdef" for c in value["sha256"])):
        raise ValueError("A retained raster needs its original SHA256")
    return value


def _quarantine(path):
    """Preserve an invalid derived checkpoint before recomputing its own pair."""
    if not path.is_file():
        return
    directory = path.parent / "invalid"
    directory.mkdir(exist_ok=True)
    destination = directory / (file_digest(path) + "-" + path.name)
    if destination.exists():
        if destination.read_bytes() != path.read_bytes():
            raise ValueError("A retained derived-cache recovery copy differs")
        path.unlink()
    else:
        path.replace(destination)


def _totals(value, area_ids):
    if not isinstance(value, dict) or set(value) != set(area_ids):
        raise ValueError("The paired checkpoint has different reporting areas")
    for row in value.values():
        if not isinstance(row, dict) or set(row) != set(TOTAL_FIELDS):
            raise ValueError("The paired checkpoint has different accumulator fields")
        for name, number in row.items():
            if name.endswith("_cells"):
                if type(number) is not int or number < 0:
                    raise ValueError("A retained cell count is invalid")
            elif isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number):
                raise ValueError("A retained mass accumulator is invalid")
        if row["paired_valid_cells"] > min(row["baseline_valid_cells"], row["case_valid_cells"]):
            raise ValueError("Paired cells exceed independent valid support")
    return deepcopy(value)


class PairCheckpoint:
    def __init__(self, owner, key, selection, case_id, run_id, pollutant):
        self.owner, self.key, self.selection = owner, key, selection
        self.case_id, self.run_id, self.pollutant = case_id, run_id, pollutant
        self.path = owner.directory / (key + ".partial.json")
        self.started = time.monotonic()
        self.last_saved = self.started
        self.resumed_windows = 0
        self.total_windows = 0
        self.next_window = 0

    def begin(self, empty, total_windows):
        if type(total_windows) is not int or total_windows < 1:
            raise ValueError("The original raster has no aggregation windows")
        self.total_windows = total_windows
        values = deepcopy(empty)
        if self.path.exists():
            try:
                saved = read_json(self.path)
                if (saved.get("schema") != CHECKPOINT_SCHEMA or saved.get("id") != self.key
                        or saved.get("selection") != self.selection
                        or saved.get("total_windows") != total_windows
                        or type(saved.get("next_window")) is not int
                        or not 0 <= saved["next_window"] <= total_windows
                        or saved.get("totals_sha256") != digest(saved.get("totals"))):
                    raise ValueError("The paired checkpoint differs from its original inputs")
                values = _totals(saved["totals"], self.owner.area_ids)
                self.next_window = self.resumed_windows = saved["next_window"]
            except (OSError, ValueError, KeyError, TypeError):
                _quarantine(self.path)
        self.owner.observe(self, "aggregating")
        return values, self.next_window

    def advance(self, totals, next_window, *, force=False):
        self.next_window = next_window
        instant = time.monotonic()
        if force or instant - self.last_saved >= 5.0:
            values = _totals(totals, self.owner.area_ids)
            atomic_json(self.path, {
                "schema": CHECKPOINT_SCHEMA, "id": self.key, "selection": self.selection,
                "next_window": next_window, "total_windows": self.total_windows,
                "totals": values, "totals_sha256": digest(values), "updated_at": now(),
            })
            self.last_saved = instant
        self.owner.observe(self, "aggregating")

    def observation(self, *, reused=False):
        return {
            "case_id": self.case_id, "run_id": self.run_id, "pollutant": self.pollutant,
            "pair_id": self.key, "reused": reused, "resumed_windows": self.resumed_windows,
            "windows": self.total_windows,
            "elapsed_seconds": max(0.0, time.monotonic() - self.started),
        }


class PairResults:
    """Manage the current study's source-bound completed and partial pair records."""

    def __init__(self, directory, *, workspace_id, experiment_id, engine_path,
                 areas, total_pairs, progress=None):
        import numpy
        import rasterio
        import shapely

        self.root = Path(directory)
        self.progress = progress
        self.started = time.monotonic()
        self.last_notified = 0.0
        self.area_ids = [area["id"] for area in areas]
        if len(set(self.area_ids)) != len(self.area_ids):
            raise ValueError("Select distinct paired reporting area identities")
        context = {
            "schema": CONTEXT_SCHEMA, "workspace_id": workspace_id,
            "experiment_id": experiment_id,
            "implementation": {
                "engine_sha256": file_digest(Path(engine_path)),
                "cache_sha256": file_digest(Path(__file__)),
            },
            "runtime": {
                "python": list(sys.version_info[:3]), "numpy": numpy.__version__,
                "rasterio": rasterio.__version__,
                "gdal": getattr(rasterio, "__gdal_version__", None),
                "shapely": shapely.__version__,
            },
            "areas": [{
                **{name: value for name, value in area.items() if name != "geometry"},
                "geometry_sha256": (hashlib.sha256(area["geometry"].wkb).hexdigest()
                                   if area["geometry"] is not None else None),
            } for area in areas],
        }
        self.context_id = digest(context)
        self.directory = self.root / "paired-results" / self.context_id
        self.directory.mkdir(parents=True, exist_ok=True)
        atomic_json(self.directory / "context.json", context, immutable=True)
        self.total_pairs = total_pairs
        self.observations = []
        self.current = None
        self.observe(None, "preparing")

    def observe(self, checkpoint, phase, *, error=None):
        instant = time.monotonic()
        mandatory = phase in ("preparing", "complete", "interrupted")
        if not mandatory and instant - self.last_notified < 1.0:
            return self.current
        value = {
            "schema": PROGRESS_SCHEMA, "context_id": self.context_id,
            "phase": phase, "updated_at": now(),
            "completed_pairs": len(self.observations), "total_pairs": self.total_pairs,
            "reused_pairs": sum(row["reused"] for row in self.observations),
            "computed_pairs": sum(not row["reused"] for row in self.observations),
            "resumed_pairs": sum(bool(row["resumed_windows"]) for row in self.observations),
            "elapsed_seconds": max(0.0, time.monotonic() - self.started),
            "active_case_id": checkpoint.case_id if checkpoint else None,
            "active_run_id": checkpoint.run_id if checkpoint else None,
            "active_pollutant": checkpoint.pollutant if checkpoint else None,
            "windows_completed": checkpoint.next_window if checkpoint else None,
            "total_windows": checkpoint.total_windows if checkpoint else None,
            "resumed_windows": checkpoint.resumed_windows if checkpoint else None,
        }
        if error:
            value["error"] = error
        self.current = value
        atomic_json(self.root / "aggregation-progress.json", value)
        if self.progress:
            self.progress(deepcopy(value))
        self.last_notified = instant
        return value

    def evaluate(self, *, case_id, run_id, pollutant, baseline, alternative, calculate):
        selection = {"context_id": self.context_id, "pollutant": pollutant,
                     "baseline": _body(baseline), "alternative": _body(alternative)}
        key = digest(selection)
        checkpoint = PairCheckpoint(self, key, selection, case_id, run_id, pollutant)
        path = self.directory / (key + ".json")
        if path.exists():
            try:
                saved = read_json(path)
                values = saved["values"]
                if (saved.get("schema") != PAIR_SCHEMA or saved.get("id") != key
                        or saved.get("selection") != selection
                        or saved.get("values_sha256") != digest(values)
                        or not isinstance(values, dict) or set(values) != set(self.area_ids)
                        or type(saved.get("windows")) is not int or saved["windows"] < 1):
                    raise ValueError("The retained paired result differs from its source binding")
            except (OSError, ValueError, KeyError, TypeError):
                _quarantine(path)
            else:
                checkpoint.total_windows = checkpoint.next_window = saved["windows"]
                self.observations.append(checkpoint.observation(reused=True))
                self.observe(checkpoint, "reused")
                return deepcopy(values)
        try:
            values = calculate(checkpoint)
            atomic_json(path, {
                "schema": PAIR_SCHEMA, "id": key, "selection": selection,
                "values": values, "values_sha256": digest(values),
                "windows": checkpoint.total_windows, "completed_at": now(),
            }, immutable=True)
            checkpoint.path.unlink(missing_ok=True)
            self.observations.append(checkpoint.observation())
            self.observe(checkpoint, "paired")
            return values
        except BaseException as exc:
            self.observe(checkpoint, "interrupted", error={
                "type": type(exc).__name__, "message": str(exc)})
            raise

    def finish(self):
        progress = self.observe(None, "complete")
        result = {**progress, "pairs": self.observations,
                  "context": (self.directory / "context.json").relative_to(self.root).as_posix(),
                  "method": "Original block order and paired valid pixel centres; float64 "
                            "window sums are accumulated once. Completed windows resume "
                            "only after exact input, geometry and method binding."}
        atomic_json(self.root / "aggregation.json", result)
        return result
