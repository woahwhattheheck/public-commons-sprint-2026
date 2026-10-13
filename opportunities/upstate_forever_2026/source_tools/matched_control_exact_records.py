"""Direct exact_monge join for the maintained regional sorted-record preparer.

Uses the unchanged published precipitation_matching module and the independent
record IO layer. The existing producer still selects support, owns its lock,
admits numerical memory, writes the final raster, and retains the native run.
"""
from __future__ import annotations
from pathlib import Path
import math
from typing import Callable
import numpy as np

if __package__:
    from . import precipitation_matching as exact
    from .matched_control_records import open_record_class, DEFAULT_IO_WORKING_BYTES
else:
    import precipitation_matching as exact
    from matched_control_records import open_record_class, DEFAULT_IO_WORKING_BYTES

VERSION = "regional-exact-monge-record-join/v2"


def estimated_numerical_bytes(targets: int, candidates: int) -> int:
    """Same declared per-class int64 admission used by the maintained producer.

    This is a conservative operational estimate, not a bound on the kernel's
    arbitrary-width Python-integer branch or a promise of process peak RSS.
    """
    if type(targets) is not int or type(candidates) is not int or targets < 0 or candidates < targets:
        raise ValueError("Use original nonnegative counts with enough candidates")
    return 0 if targets == 0 else 256*targets + 96*candidates + 256*1024*1024


def _require_numeric_array_capacity(targets, candidates, check_running=None) -> None:
    """Keep the current producer's int64-only numerical admission boundary."""
    unit = exact._binary_unit((targets, candidates), check_running)
    maximum = max(float(targets.max(initial=0)), float(candidates.max(initial=0)))
    try:
        scaled = math.ldexp(maximum, -unit)
    except OverflowError:
        scaled = math.inf
    if scaled > 1 << 61:
        raise MemoryError("Original precipitation exponents need the exact kernel's arbitrary-width "
                          "integer path; the current numeric-array admission does not cover that "
                          "allocation. Use an explicitly sized native backend for those inputs.")


def match_class_exact(targets: Path, candidates: Path, directory: Path, code: int,
                      width: int, emit: Callable[..., None], *,
                      max_working_bytes: int,
                      io_working_bytes: int = DEFAULT_IO_WORKING_BYTES,
                      check_running: Callable[[], None] | None = None) -> dict:
    """Retain one exact selection using original sorted 16-byte record files.

    ``directory`` is a new owned output directory, or this function's completed
    directory for receiving. An ``exact-selection`` child works when the old
    class folder already contains sort spools. All returned ``files`` entries
    are relative to this committed directory. The producer prefixes them when
    constructing its outer retained-file manifest and also includes complete.json.

    Completed receiving returns without numerical allocation or another solve.
    The supplied positive numerical budget applies to a new selection only.
    The caller keeps its authoritative support, original grid and operation lock.
    """
    if type(max_working_bytes) is not int or max_working_bytes < 1:
        raise ValueError("Supply the numerical bytes admitted by the actual receiving host")
    if not callable(emit):
        raise TypeError("Use the maintained producer's progress callback")
    def progress(stage: str, **details) -> None:
        if check_running is not None:
            check_running()
        emit(stage, **details)
    if check_running is not None:
        check_running()
    implementations = {
        "source_tools/precipitation_matching.py": Path(exact.__file__),
        "source_tools/matched_control_exact_records.py": Path(__file__),
    }
    with open_record_class(
        targets, candidates, directory, code, width,
        method=exact.METHOD, implementation_files=implementations,
        method_parameters={"tie_rule": exact.TIE_RULE, "record_join": VERSION},
        io_working_bytes=io_working_bytes, emit=progress,
    ) as record:
        if record.completed is not None:
            return record.completed
        n, m = record.target_count, record.candidate_count
        required = estimated_numerical_bytes(n, m)
        if required > max_working_bytes:
            raise MemoryError(f"Class {code}: exact_monge estimate {required} bytes exceeds "
                              f"the receiving host's {max_working_bytes}-byte admission")
        progress("exact-monge-record-selection", from_code=code, targets=n, candidates=m,
                 estimated_numerical_bytes=required, admitted_numerical_bytes=max_working_bytes)
        if n:
            _require_numeric_array_capacity(record.targets["rain"], record.candidates["rain"], check_running)
            matched = exact.match_precipitation(
                record.targets["rain"], record.candidates["rain"],
                target_ids=record.targets["index"], candidate_ids=record.candidates["index"],
                check_running=check_running,
            )
        else:
            # The selected empty class has an exact zero objective. Avoid even
            # allocating candidate-ID arrays for a class requiring no controls.
            empty = np.empty(0, dtype=np.int64)
            matched = exact.Matching(empty, empty, 0, m, 0, 0, "int64-dyadic", 0, 0)
        metadata = matched.metadata()
        metadata["record_join"] = VERSION
        metadata["memory_admission"] = {
            "numeric_array_precision": "int64-dyadic",
            "estimated_numerical_bytes": required,
            "admitted_numerical_bytes": max_working_bytes,
            "io_working_bytes": io_working_bytes,
            "int64_estimate_formula": "256*n + 96*m + 256 MiB; zero for an empty target class",
        }
        return record.finish(matched.candidate_positions, metadata)
