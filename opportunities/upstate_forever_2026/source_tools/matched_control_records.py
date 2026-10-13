"""Bounded record IO for the maintained regional matched-control preparer.

The caller owns its existing preparation lock and the numerical method. This
module opens its original sorted records, retains complete implementation files,
commits original-grid pairs, and reuses a completed selection without invoking
another matcher. It contains no numerical matching algorithm or raster scanner.
"""
from __future__ import annotations

from contextlib import contextmanager
import csv
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile
from typing import Callable, Iterator, Mapping, Any

import numpy as np

VERSION = "regional-matched-control-record-io/v1"
RECORD_DTYPE = np.dtype([("rain", "<f8"), ("index", "<u8")])
PAIR_FIELDS = (
    "from_code", "target_index", "target_row", "target_col", "control_index",
    "control_row", "control_col", "target_precipitation_mm_year",
    "control_precipitation_mm_year", "precipitation_residual_mm_year",
)
DEFAULT_IO_WORKING_BYTES = 32 * 1024 * 1024


def _sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def _identity(path: Path) -> dict:
    return {"bytes": path.stat().st_size, "sha256": _sha256(path)}


def _stable_identity(path: Path) -> dict:
    before = path.stat()
    identity = _identity(path)
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
        after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
    ):
        raise ValueError(f"Input changed while being identified: {path.name}")
    return identity


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")


def _save_json(path: Path, value: Any) -> None:
    data = _json_bytes(value)
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def _relative(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or str(path) != name or "\\" in name:
        raise ValueError(f"Implementation/output name must be a relative POSIX path: {name!r}")
    return path


def _close(values: np.ndarray | None) -> None:
    if isinstance(values, np.memmap):
        values._mmap.close()


def _drop_clean_pages(values: np.ndarray | None) -> None:
    # Optional Linux optimization only; file-backed bytes remain authoritative.
    if isinstance(values, np.memmap):
        values.flush()
        try:
            import mmap
            values._mmap.madvise(mmap.MADV_DONTNEED)
        except (AttributeError, OSError, ValueError):
            pass


class RecordClass:
    """One original class under its calling producer's existing operation lock.

    Use ``open_record_class``. ``targets`` and ``candidates`` are read-only
    structured memory maps in their original rainfall/index order. A numeric
    adapter may consume their fields without materializing another full grid.
    ``finish`` takes candidate *positions*, one per original target, and retains
    the actual numerical metadata unchanged. No fallback or alternative solver
    is called here. The numerical owner's working-memory admission is separate
    from this IO phase's chunk budget.
    """

    def __init__(self, target_path: Path, candidate_path: Path, directory: Path,
                 code: int, width: int, *, method: str,
                 implementation_files: Mapping[str, Path],
                 method_parameters: Mapping[str, Any] | None = None,
                 io_working_bytes: int = DEFAULT_IO_WORKING_BYTES,
                 emit: Callable[..., None] | None = None):
        if type(code) is not int or type(width) is not int or width < 1:
            raise ValueError("Use an original integer class and positive original grid width")
        if not isinstance(method, str) or not method.strip():
            raise ValueError("Retain the selected numerical owner's explicit method")
        if type(io_working_bytes) is not int or io_working_bytes < 1024 * 1024:
            raise ValueError("Record IO needs a declared budget of at least one MiB")
        if not implementation_files:
            raise ValueError("Retain the complete original numerical implementation files")
        self.target_path, self.candidate_path = Path(target_path), Path(candidate_path)
        self.directory = Path(directory)
        self.code, self.width, self.method = code, width, method
        self.chunk_rows = min(65536, max(1, (io_working_bytes - 524288) // 256))
        self.io_working_bytes = io_working_bytes
        self.emit = emit or (lambda *args, **kwargs: None)
        self.sources = {str(_relative(name)): Path(path) for name, path in implementation_files.items()}
        self.sources["record_io/matched_control_records.py"] = Path(__file__)
        self.binding = {
            "targets": _stable_identity(self.target_path),
            "candidates": _stable_identity(self.candidate_path),
            "class": code, "width": width, "method": method,
            "method_parameters": dict(method_parameters or {}), "record_io": VERSION,
            "implementation": {name: _stable_identity(path) for name, path in sorted(self.sources.items())},
        }
        # JSON primitives only, so source identity is portable and deterministic.
        _json_bytes(self.binding)
        self.target_count = self.binding["targets"]["bytes"] // RECORD_DTYPE.itemsize
        self.candidate_count = self.binding["candidates"]["bytes"] // RECORD_DTYPE.itemsize
        if any(self.binding[k]["bytes"] % RECORD_DTYPE.itemsize for k in ("targets", "candidates")):
            raise ValueError("Original 16-byte sorted record file is incomplete")
        if self.candidate_count < self.target_count:
            raise ValueError(f"Class {code}: {self.target_count} targets but only {self.candidate_count} candidates")
        self.targets = self.candidates = None
        self.completed = None
        complete = self.directory / "complete.json"
        if complete.exists():
            saved = json.loads(complete.read_text(encoding="utf-8"))
            if saved["binding"] != self.binding:
                raise ValueError("Preserve the accepted class edition and use a new method/source-bound directory")
            for item in saved["files"]:
                path = self.directory.joinpath(*_relative(item["path"]).parts)
                if path.is_symlink() or _identity(path) != {k: item[k] for k in ("bytes", "sha256")}:
                    raise ValueError("Completed class artifact differs: " + item["path"])
            self.completed = saved
            return
        if self.directory.exists():
            # Never erase a prior interrupted/foreign class as an implicit retry.
            raise FileExistsError(f"Retain existing partial class {self.directory}; receive into a new owned directory")
        self.targets = self._map(self.target_path, self.target_count)
        try:
            self.candidates = self._map(self.candidate_path, self.candidate_count)
            self._check_records(self.targets)
            self._check_records(self.candidates)
        except BaseException:
            self.close()
            raise

    @staticmethod
    def _map(path: Path, count: int) -> np.ndarray:
        return np.memmap(path, mode="r", dtype=RECORD_DTYPE, shape=(count,)) if count else np.empty(0, dtype=RECORD_DTYPE)

    def _check_records(self, values: np.ndarray) -> None:
        last = None
        for first in range(0, len(values), self.chunk_rows):
            part = values[first:first + self.chunk_rows]
            rain, ids = part["rain"], part["index"]
            if not np.isfinite(rain).all() or np.any(rain <= 0):
                raise ValueError("Original valid precipitation must be finite and positive")
            if np.any(rain[1:] < rain[:-1]) or np.any((rain[1:] == rain[:-1]) & (ids[1:] <= ids[:-1])):
                raise ValueError("Records must retain strict original rainfall/index order")
            initial = (float(rain[0]), int(ids[0]))
            if last is not None and initial <= last:
                raise ValueError("Original sorted record order differs at a chunk boundary")
            last = (float(rain[-1]), int(ids[-1]))

    def close(self) -> None:
        for values in (self.targets, self.candidates):
            _close(values)
        self.targets = self.candidates = None

    def finish(self, candidate_positions: np.ndarray, numerical_metadata: Mapping[str, Any]) -> dict:
        """Commit the selected original-grid artifacts; reuse makes no solver call.

        Positions can be a numerical owner's array or memory map. Original
        target order is preserved, including equal-rainfall permutations. A
        disk bitmap plus bounded per-chunk uniqueness check prevents repeated
        candidates without sorting or copying the entire selection in RAM.
        """
        if self.completed is not None:
            raise RuntimeError("Use the completed result directly; do not solve an accepted class again")
        if self.targets is None or self.candidates is None:
            raise RuntimeError("The original record context is closed")
        positions = np.asarray(candidate_positions)
        if positions.ndim != 1 or len(positions) != self.target_count or positions.dtype.kind not in "iu":
            raise ValueError("Return one integer candidate position for every original target")
        metadata = dict(numerical_metadata)
        _json_bytes(metadata)
        n, m = self.target_count, self.candidate_count
        self.directory.parent.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".matched-records-", dir=self.directory.parent))
        bitmap = None
        try:
            # This file is disposable numerical IO scratch, not a result member.
            if m and n:
                bitmap = np.memmap(stage / ".selected-bitmap", mode="w+", dtype="u1", shape=(m,))
            target_sum = control_sum = signed_sum = absolute_sum = np.longdouble(0)
            maximum = 0.0
            with (stage / "pairs.csv").open("x", newline="", encoding="utf-8") as pairs, \
                 (stage / "selected.bin").open("xb") as selected, \
                 (stage / "selection-positions.bin").open("xb") as position_stream:
                writer = csv.writer(pairs)
                writer.writerow(PAIR_FIELDS)
                for first in range(0, n, self.chunk_rows):
                    last = min(n, first + self.chunk_rows)
                    pos = positions[first:last]
                    if np.any(pos < 0) or np.any(pos >= m):
                        raise ValueError("Numeric selection points outside the original candidate roster")
                    pos = pos.astype(np.intp, copy=False)
                    if len(np.unique(pos)) != len(pos) or np.any(bitmap[pos]):
                        raise ValueError("Numeric selection repeats an original candidate position")
                    bitmap[pos] = 1
                    a, b = self.targets[first:last], self.candidates[pos]
                    residual = b["rain"].astype(np.longdouble) - a["rain"].astype(np.longdouble)
                    target_sum += np.sum(a["rain"], dtype=np.longdouble)
                    control_sum += np.sum(b["rain"], dtype=np.longdouble)
                    signed_sum += np.sum(residual, dtype=np.longdouble)
                    absolute_sum += np.sum(np.abs(residual), dtype=np.longdouble)
                    maximum = max(maximum, float(np.max(np.abs(residual))))
                    b["index"].astype("<u8").tofile(selected)
                    pos.astype("<u8").tofile(position_stream)
                    for ta, cb, delta in zip(a, b, residual):
                        ti, ci = int(ta["index"]), int(cb["index"])
                        writer.writerow((self.code, ti, ti // self.width, ti % self.width,
                                         ci, ci // self.width, ci % self.width,
                                         repr(float(ta["rain"])), repr(float(cb["rain"])), repr(float(delta))))
                    self.emit("matching-record-export", from_code=self.code, written=last, targets=n,
                              method=self.method)
                    _drop_clean_pages(bitmap)
                for stream in (pairs, selected, position_stream):
                    stream.flush()
                    os.fsync(stream.fileno())
            _close(bitmap)
            bitmap = None
            (stage / ".selected-bitmap").unlink(missing_ok=True)
            _save_json(stage / "matching-numerical.json", metadata)
            for name, source in self.sources.items():
                destination = stage / "implementation" / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
                if _identity(destination) != self.binding["implementation"][name]:
                    raise ValueError("Original numerical implementation changed during receiving")
            for key, path in (("targets", self.target_path), ("candidates", self.candidate_path)):
                if _stable_identity(path) != self.binding[key]:
                    raise ValueError("Original sorted population changed during matching")
            files = [{"path": p.relative_to(stage).as_posix(), **_identity(p)}
                     for p in sorted(stage.rglob("*")) if p.is_file()]
            saved = {
                "binding": self.binding, "from_code": self.code, "target_cells": n, "control_cells": n,
                "eligible_off_corridor_cells": m,
                "target_precipitation_sum_mm_year": float(target_sum),
                "control_precipitation_sum_mm_year": float(control_sum),
                "precipitation_sum_residual_mm_year": float(signed_sum),
                "mean_absolute_paired_precipitation_residual_mm_year": float(absolute_sum / n) if n else None,
                "max_absolute_paired_precipitation_residual_mm_year": maximum if n else None,
                "sum_absolute_paired_precipitation_residual_mm_year": float(absolute_sum),
                "objective_sum_absolute_precipitation_residual_mm_year": float(absolute_sum),
                "numerical_metadata": metadata,
                "record_io": {"version": VERSION, "chunk_rows": self.chunk_rows,
                              "io_working_bytes": self.io_working_bytes,
                              "disk_bitmap_bytes": m if n else 0,
                              "residual_summary_arithmetic": "longdouble; original exact numerical objective is retained separately"},
                "files": files,
            }
            _save_json(stage / "complete.json", saved)
            if self.directory.exists():
                raise FileExistsError("An original class was completed concurrently; preserve both source editions")
            stage.rename(self.directory)
            self.completed = saved
            return saved
        finally:
            _close(bitmap)
            if stage.exists():
                shutil.rmtree(stage)


@contextmanager
def open_record_class(targets: Path, candidates: Path, directory: Path, code: int, width: int,
                      **options: Any) -> Iterator[RecordClass]:
    """Open one class under the original producer's already-held operation lock."""
    records = RecordClass(targets, candidates, directory, code, width, **options)
    try:
        yield records
    finally:
        records.close()
