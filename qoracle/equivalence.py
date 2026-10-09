"""Compare entire circuit operators using one shared, unobservable global phase.

This streams basis columns instead of allocating full 4**n matrices. A match
is numerical evidence at the documented column tolerance, not a formal proof.
"""
from __future__ import annotations

import argparse
import math
import sys
from typing import Any

from .engine import OracleError, canonical, sha256_text
from .experiment_support import normalize_manifest, positive_integer, read_manifest, statevector

DEFAULT_MAX_WORK = 50_000_000


def compare_circuits(
    left: dict[str, Any] | str,
    right: dict[str, Any] | str,
    *,
    tolerance: float = 1e-8,
    max_work: int = DEFAULT_MAX_WORK,
) -> dict[str, Any]:
    """Check V|j> == phase * U|j> for EVERY basis j, with one common phase.

    `tolerance` is the L2 residual allowed per column. If all columns pass,
    the operator-norm difference is at most sqrt(dimension) * tolerance.
    Work is an admission estimate in amplitude visits, not a wall-time limit.
    """
    a_manifest = normalize_manifest(left)
    b_manifest = normalize_manifest(right)
    if a_manifest["qubits"] != b_manifest["qubits"]:
        raise OracleError("circuits must have the same number of qubits")
    if isinstance(tolerance, bool) or not isinstance(tolerance, (float, int)):
        raise OracleError("tolerance must be a finite real from 0 to 1e-2")
    try:
        tolerance = float(tolerance)
    except OverflowError as exc:
        raise OracleError("tolerance is outside the supported range") from exc
    if not math.isfinite(tolerance) or not 0 <= tolerance <= 1e-2:
        raise OracleError("tolerance must be a finite real from 0 to 1e-2")
    positive_integer(max_work, "max_work")
    n = a_manifest["qubits"]
    dimension = 1 << n
    work = dimension * dimension * (len(a_manifest["gates"]) + len(b_manifest["gates"]) + 6)
    if work > max_work:
        raise OracleError(f"estimated work {work} exceeds max_work={max_work}; no comparison executed")

    phase = 1 + 0j
    largest = 0.0
    sum_squared = 0.0
    first_mismatch = None
    for basis in range(dimension):
        a = statevector(a_manifest, basis)
        b = statevector(b_manifest, basis)
        if basis == 0:
            overlaps = [x.conjugate() * y for x, y in zip(a, b)]
            overlap = complex(math.fsum(v.real for v in overlaps), math.fsum(v.imag for v in overlaps))
            if abs(overlap) > 0:
                phase = overlap / abs(overlap)
        residual = math.sqrt(math.fsum(abs(y - phase * x) ** 2 for x, y in zip(a, b)))
        largest = max(largest, residual)
        sum_squared += residual * residual
        if residual > tolerance and first_mismatch is None:
            first_mismatch = {"basis_index": basis, "basis_bits_msb_first": format(basis, f"0{n}b"),
                              "column_l2_residual": residual}

    return {
        "schema": 1,
        "state": "MATCH" if first_mismatch is None else "MISMATCH",
        "qubits": n,
        "columns_checked": dimension,
        "phase_right_equals_phase_times_left": {"real": phase.real, "imag": phase.imag},
        "phase_policy": "ONE_SHARED_PHASE_ANCHORED_TO_FIRST_COLUMN",
        "max_column_l2_residual": largest,
        "frobenius_residual": math.sqrt(sum_squared),
        "operator_norm_upper_bound": math.sqrt(sum_squared),
        "column_tolerance": tolerance,
        "first_mismatch": first_mismatch,
        "estimated_amplitude_visits": work,
        "left_manifest_sha256": sha256_text(canonical(a_manifest)),
        "right_manifest_sha256": sha256_text(canonical(b_manifest)),
        "scope": "UNITARY_OPERATOR; observables and probability_wires do not affect gates",
        "authority": "NUMERICAL_CIRCUIT_COMPARISON",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("left")
    parser.add_argument("right")
    parser.add_argument("--tolerance", type=float, default=1e-8)
    parser.add_argument("--max-work", type=int, default=DEFAULT_MAX_WORK)
    args = parser.parse_args(argv)
    try:
        report = compare_circuits(read_manifest(args.left), read_manifest(args.right),
                                  tolerance=args.tolerance, max_work=args.max_work)
        print(canonical(report))
        return 0 if report["state"] == "MATCH" else 1
    except (OracleError, OSError, UnicodeError) as exc:
        print(f"qoracle equivalence: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
