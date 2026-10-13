"""Exact, scalable one-dimensional precipitation subset matching.

The smaller target population is injected into distinct candidate cells, minimizing
sum(abs(target - candidate)). Sorting is O((n+m) log(n+m)); diagonal separation is
O(n log(m-n+1)) time and O(n+m) storage, without a pairwise matrix. See the adjacent
MATCHED_CONTROL_MATCHING.md for the scientific contract and tie convention.

Algorithm: Aggarwal, Bar-Noy, Khuller, Kravets and Schieber, CS-TR-3199,
section 4 (bitonic Monge arrays). This is an original NumPy implementation.
https://hdl.handle.net/1903/610
"""
from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Callable, Any

import numpy as np

METHOD = "class-stratified-exact-monge-L1-dyadic/v1"
TIE_RULE = "sorted-value-id; symbolic target=3*i+1, candidate=3*j; first prefix minimum"
_CHUNK = 262_144  # Temporary-array size only; every input cell is processed.
_INT_LIMIT = 1 << 61


@dataclass(frozen=True)
class Matching:
    """Positions refer to the caller's original arrays, not sorted ordinals."""
    candidate_positions: np.ndarray
    target_order: np.ndarray
    target_count: int
    candidate_count: int
    objective_integer: int
    objective_binary_exponent: int
    arithmetic: str
    separator_rows: int
    separators: int

    def metadata(self) -> dict[str, Any]:
        try:
            objective = math.ldexp(float(self.objective_integer), self.objective_binary_exponent)
            if not math.isfinite(objective):
                objective = None
        except OverflowError:
            objective = None
        return {
            "method": METHOD, "tie_rule": TIE_RULE,
            "target_cells": self.target_count, "eligible_candidate_cells": self.candidate_count,
            "objective_sum_absolute_precipitation_residual_mm_year": objective,
            "exact_objective": {"integer": str(self.objective_integer),
                                "binary_exponent": self.objective_binary_exponent},
            "arithmetic": self.arithmetic, "separator_rows": self.separator_rows,
            "separators": self.separators,
            "optimization": "global minimum total absolute precipitation residual",
            "matching_scope": "one already-selected original land-cover class",
        }


def _check(callback: Callable[[], None] | None) -> None:
    if callback is not None:
        callback()  # Exceptions propagate; the caller owns its checkpoint/queue.


def _values(value: Any, label: str) -> np.ndarray:
    arr = np.asarray(value)
    if arr.ndim != 1 or arr.dtype.kind not in "fiu":
        raise ValueError(f"{label} must be a one-dimensional real numeric array")
    if arr.dtype.kind == "f" and arr.dtype.itemsize > 8:
        raise ValueError(f"{label}: explicitly choose float64 before matching higher-precision inputs")
    if arr.dtype.kind in "iu" and arr.size and (
            int(arr.min()) < -(1 << 53) or int(arr.max()) > (1 << 53)):
        raise ValueError(f"{label}: integer coordinates must be exactly representable in float64")
    arr = np.asarray(arr, dtype=np.float64)
    if not np.isfinite(arr).all():
        raise ValueError(f"{label} contains nonfinite precipitation; resolve source support first")
    if np.any(arr < 0):
        raise ValueError(f"{label} contains negative precipitation")
    return arr


def _ids(value: Any, count: int, label: str) -> np.ndarray:
    if value is None:
        return np.arange(count, dtype=np.int64)
    arr = np.asarray(value)
    if arr.ndim != 1 or arr.size != count or arr.dtype.kind not in "iu":
        raise ValueError(f"{label} must contain one integer original cell ID per value")
    if arr.size and (int(arr.min()) < 0 or int(arr.max()) > np.iinfo(np.int64).max):
        raise ValueError(f"{label} must be nonnegative signed-64-bit cell IDs")
    arr = np.asarray(arr, dtype=np.int64)
    if count > 1 and not np.all(arr[1:] > arr[:-1]) and np.unique(arr).size != count:
        raise ValueError(f"{label} contains duplicate original cell IDs")
    return arr


def _binary_unit(arrays: tuple[np.ndarray, ...], callback: Callable[[], None] | None) -> int:
    """Smallest binary unit represented by the actual IEEE-754 input values."""
    unit = None
    for array in arrays:
        for start in range(0, array.size, _CHUNK):
            _check(callback)
            bits = array[start:start + _CHUNK].view(np.uint64)
            exponent = ((bits >> np.uint64(52)) & np.uint64(2047)).astype(np.int64)
            significand = bits & np.uint64((1 << 52) - 1)
            significand = significand | ((exponent != 0).astype(np.uint64) << np.uint64(52))
            nonzero = significand != 0
            if not np.any(nonzero):
                continue
            sig = significand[nonzero]
            # The isolated low bit is a power of two and converts to float exactly.
            low = sig & (~sig + np.uint64(1))
            trailing = np.frexp(low.astype(np.float64))[1].astype(np.int64) - 1
            e = exponent[nonzero]
            powers = np.where(e == 0, -1074, e - 1075) + trailing
            local = int(powers.min())
            unit = local if unit is None else min(unit, local)
    return 0 if unit is None else unit


def _coordinates(a: np.ndarray, b: np.ndarray, callback: Callable[[], None] | None
                 ) -> tuple[np.ndarray, np.ndarray, int, str]:
    unit = _binary_unit((a, b), callback)
    maximum = max(float(a.max(initial=0)), float(b.max(initial=0)))
    try:
        scaled_maximum = math.ldexp(maximum, -unit)
    except OverflowError:
        scaled_maximum = math.inf
    # Nonnegative coordinates <=2**61 guarantee safe signed differences. Prefix
    # absolute differences are bounded by the telescoping candidate value range.
    fast = scaled_maximum <= _INT_LIMIT
    converted = []
    for arr in (a, b):
        out = np.empty(arr.size, dtype=np.int64 if fast else object)
        for start in range(0, arr.size, _CHUNK):
            _check(callback)
            stop = min(arr.size, start + _CHUNK)
            if fast:
                scaled = np.ldexp(arr[start:stop], -unit)
                out[start:stop] = scaled.astype(np.int64)
            else:
                for j in range(start, stop):
                    numerator, denominator = float(arr[j]).as_integer_ratio()
                    shift = -(denominator.bit_length() - 1) - unit
                    out[j] = numerator << shift if shift >= 0 else numerator >> (-shift)
        converted.append(out)
    return converted[0], converted[1], unit, "int64-dyadic" if fast else "python-integer-dyadic"


def _exact_sum(arr: np.ndarray) -> int:
    total = 0
    for start in range(0, arr.size, _CHUNK):
        part = arr[start:start + _CHUNK]
        if part.dtype == object or (part.size and int(part.max()) * part.size > np.iinfo(np.int64).max):
            total += sum(map(int, part))
        else:
            total += int(part.sum(dtype=np.int64))
    return total


def match_precipitation(target_values: Any, candidate_values: Any, *,
                        target_ids: Any = None, candidate_ids: Any = None,
                        check_running: Callable[[], None] | None = None) -> Matching:
    """Match all targets to distinct candidates with the exact minimum L1 cost.

    Input values are finite, nonnegative float64 precipitation in mm/year. IDs
    are unique nonnegative original cell indices within each population. This
    primitive does not choose geographic/corridor/class support: its caller must
    supply that support and must enforce disjoint target/candidate populations.
    Empty target classes are valid. Insufficient candidates raise ValueError.

    No user input is rounded, binned or perturbed. Symbolic secondary coordinates
    only choose among exactly equal primary objectives. Legacy DP tie-selected
    cell identities may differ: retain existing completed editions unchanged.
    """
    _check(check_running)
    targets = _values(target_values, "targets")
    candidates = _values(candidate_values, "candidates")
    n, m = targets.size, candidates.size
    if n > m:
        raise ValueError(f"Insufficient disjoint candidates: {m} available for {n} targets")
    ti = _ids(target_ids, n, "target_ids")
    ci = _ids(candidate_ids, m, "candidate_ids")
    if not n:
        empty = np.empty(0, dtype=np.int64)
        return Matching(empty, empty, 0, m, 0, 0, "int64-dyadic", 0, 0)
    # Secondary prefix arithmetic is also exact. This bound is far beyond grids
    # that fit in addressable arrays, but reject rather than allow int64 overflow.
    if 12 * n * (m + n + 1) >= np.iinfo(np.int64).max:
        raise OverflowError("Symbolic tie-coordinate population exceeds signed-64-bit accumulation")
    _check(check_running)
    to = np.lexsort((ti, targets))
    co = np.lexsort((ci, candidates))
    a, b, exponent, arithmetic = _coordinates(targets[to], candidates[co], check_running)
    selected = np.empty(n, dtype=np.int64)
    # Process the disjoint recursion nodes a level at a time. Every level is
    # vectorized; there is no Python loop per target cell or candidate pair.
    starts = np.array([0], dtype=np.int64)
    stops = np.array([n], dtype=np.int64)
    lefts = np.array([0], dtype=np.int64)
    rights = np.array([m - n], dtype=np.int64)
    rows_visited = separators = 0
    while starts.size:
        _check(check_running)
        lengths = stops - starts
        group_starts = np.concatenate((np.array([0], dtype=np.int64), np.cumsum(lengths[:-1])))
        rows = np.arange(int(lengths.sum()), dtype=np.int64) + np.repeat(starts - group_starts, lengths)
        fixed = lefts == rights
        if np.any(fixed):
            fixed_rows = np.repeat(fixed, lengths)
            selected[rows[fixed_rows]] = rows[fixed_rows] + np.repeat(lefts, lengths)[fixed_rows]
            if np.all(fixed):
                break
            starts, stops, lefts, rights = (v[~fixed] for v in (starts, stops, lefts, rights))
            lengths = stops - starts
            group_starts = np.concatenate((np.array([0], dtype=np.int64), np.cumsum(lengths[:-1])))
            rows = np.arange(int(lengths.sum()), dtype=np.int64) + np.repeat(starts - group_starts, lengths)
        middle = (lefts + rights) // 2
        offsets = np.repeat(middle, lengths)
        j = rows + offsets
        rows_visited += int(rows.size)
        separators += int(starts.size)
        x, lo, hi = a[rows], b[j], b[j + 1]
        # A full diagonal is cost(i, i+offset). The prefix minimizer of adjacent
        # diagonal differences is the separating row (CS-TR-3199, section 4.2).
        prefix = np.cumsum(np.abs(x - lo) - np.abs(x - hi))
        before = np.concatenate((np.array([0], dtype=prefix.dtype), prefix[group_starts[1:] - 1]))
        primary = prefix - np.repeat(before, lengths)
        # The scanned candidate gaps are disjoint and ascending even across
        # groups. Their total bounds every primary prefix by b[-1]-b[0], so
        # int64 accumulation cannot overflow under _coordinates' range bound.
        # Distinct symbolic coordinates resolve repeated-value plateaus without
        # rounding/perturbing any actual precipitation: target (value,3*i+1),
        # candidate (value,3*j). Secondary diagonal costs depend only on offset.
        d_lo = 1 - 3 * offsets
        d_hi = d_lo - 3
        secondary_lo = np.where(x == lo, np.abs(d_lo), np.where(x > lo, d_lo, -d_lo))
        secondary_hi = np.where(x == hi, np.abs(d_hi), np.where(x > hi, d_hi, -d_hi))
        prefix_secondary = np.cumsum(secondary_lo - secondary_hi, dtype=np.int64)
        before_secondary = np.concatenate((np.array([0], dtype=np.int64), prefix_secondary[group_starts[1:] - 1]))
        secondary = prefix_secondary - np.repeat(before_secondary, lengths)
        minimum = np.minimum(np.minimum.reduceat(primary, group_starts), 0)
        eligible = primary == np.repeat(minimum, lengths)
        sentinel = np.iinfo(np.int64).max
        secondary_minimum = np.minimum.reduceat(np.where(eligible, secondary, sentinel), group_starts)
        empty = (minimum == 0) & (secondary_minimum >= 0)
        minima = eligible & (secondary == np.repeat(secondary_minimum, lengths))
        first_rows = np.minimum.reduceat(np.where(minima, rows, sentinel), group_starts)
        splits = np.where(empty, starts, first_rows + 1)
        # Interleave left/right children in row order; completed rows disappear
        # naturally. This preserves the disjoint-gap bound on the next level.
        next_starts = np.column_stack((starts, splits)).ravel()
        next_stops = np.column_stack((splits, stops)).ravel()
        next_lefts = np.column_stack((lefts, middle + 1)).ravel()
        next_rights = np.column_stack((middle, rights)).ravel()
        keep = next_starts < next_stops
        starts, stops, lefts, rights = (v[keep] for v in (next_starts, next_stops, next_lefts, next_rights))
    if n > 1 and not np.all(selected[1:] > selected[:-1]):
        raise RuntimeError("Internal matching invariant: candidate positions are not strictly increasing")
    objective = _exact_sum(np.abs(a - b[selected]))
    positions = np.empty(n, dtype=np.int64)
    positions[to] = co[selected]
    return Matching(positions, to, n, m, objective, exponent, arithmetic, rows_visited, separators)
