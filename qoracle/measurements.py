"""Seeded finite-shot Pauli measurements with shared, compatible settings.

All outcomes are classical simulations of ideal statevector probabilities.
The shot count is PER SETTING, not a disguised total across many settings.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
import math
import random
import sys
from typing import Any

from .engine import OracleError, _apply, _expectation, canonical, sha256_text
from .experiment_support import normalize_manifest, positive_integer, read_manifest, statevector

MAX_SHOTS_PER_SETTING = 1_000_000
DEFAULT_MAX_TOTAL_SHOTS = 2_000_000
Z95 = 1.959963984540054


def measurement_plan(observables: list[str], qubits: int) -> list[dict[str, Any]]:
    """Greedy qubit-wise commuting groups; first group is computational Z.

    This is not optimal coloring and does not combine merely globally
    commuting operators when their local bases differ.
    """
    if type(qubits) is not int or not 1 <= qubits <= 10:
        raise OracleError("qubits must be an integer from 1 to 10")
    if not isinstance(observables, list) or len(observables) > 64:
        raise OracleError("observables must be a list of at most 64 Pauli strings")
    groups: list[dict[str, Any]] = [{"basis": "Z" * qubits, "observables": []}]
    seen: set[str] = set()
    for label in observables:
        if not isinstance(label, str) or len(label) != qubits or any(x not in "IXYZ" for x in label):
            raise OracleError("observable is not an IXYZ string matching the register")
        if label in seen:
            continue
        seen.add(label)
        for group in groups:
            if all(x == "I" or y == "I" or x == y for x, y in zip(label, group["basis"])):
                group["basis"] = "".join(x if y == "I" else y for x, y in zip(label, group["basis"]))
                group["observables"].append(label)
                break
        else:
            groups.append({"basis": label, "observables": [label]})
    for group in groups:
        group["basis"] = group["basis"].replace("I", "Z")
    return groups


def _draw_counts(state: list[complex], shots: int, rng: random.Random) -> list[int]:
    probabilities = [abs(amp) ** 2 for amp in state]
    total = math.fsum(probabilities)
    if not math.isfinite(total) or abs(total - 1.0) > 1e-8:
        raise OracleError("measurement state is not normalized")
    # Discard EXACT zero mass only; this also makes repeated CDF values safe.
    support = [(i, p) for i, p in enumerate(probabilities) if p > 0]
    indices = [i for i, _ in support]
    cumulative = []
    mass = 0.0
    for _, p in support:
        mass += p / total
        cumulative.append(mass)
    cumulative[-1] = 1.0
    counts = [0] * len(state)
    for _ in range(shots):
        slot = min(bisect_right(cumulative, rng.random()), len(indices) - 1)
        counts[indices[slot]] += 1
    return counts


def _interval(plus: int, shots: int) -> list[float]:
    """Wilson 95% score interval, mapped from P(+1) to E[P] = 2p - 1."""
    p = plus / shots
    z2 = Z95 * Z95
    denominator = 1 + z2 / shots
    center = (p + z2 / (2 * shots)) / denominator
    radius = Z95 * math.sqrt(p * (1 - p) / shots + z2 / (4 * shots * shots)) / denominator
    lo = 0.0 if plus == 0 else max(0.0, center - radius)
    hi = 1.0 if plus == shots else min(1.0, center + radius)
    return [2 * lo - 1, 2 * hi - 1]


def sample_measurements(
    manifest: dict[str, Any] | str,
    *,
    shots: int = 1024,
    seed: int = 0,
    max_total_shots: int = DEFAULT_MAX_TOTAL_SHOTS,
) -> dict[str, Any]:
    parsed = normalize_manifest(manifest)
    positive_integer(shots, "shots", MAX_SHOTS_PER_SETTING)
    positive_integer(max_total_shots, "max_total_shots")
    if type(seed) is not int:
        raise OracleError("seed must be an integer")
    n = parsed["qubits"]
    plan = measurement_plan(parsed["observables"], n)
    total_shots = len(plan) * shots
    if total_shots > max_total_shots:
        raise OracleError(f"{total_shots} total shots exceeds max_total_shots={max_total_shots}; no sampling executed")
    initial = statevector(parsed)
    rng = random.Random(seed)
    estimates: dict[str, Any] = {}
    settings = []
    for group_id, group in enumerate(plan):
        rotated = initial.copy()
        for wire, axis in enumerate(group["basis"]):
            if axis == "Y":
                # RZ(-pi/2) is S-dagger up to one global phase.
                _apply(rotated, n, {"op": "RZ", "wire": wire, "theta": -math.pi / 2})
            if axis in "XY":
                _apply(rotated, n, {"op": "H", "wire": wire})
        counts = _draw_counts(rotated, shots, rng)
        for label in group["observables"]:
            mask = sum(1 << wire for wire, axis in enumerate(label) if axis != "I")
            plus = sum(count for basis, count in enumerate(counts) if (basis & mask).bit_count() % 2 == 0)
            mean = 2 * plus / shots - 1
            estimates[label] = {
                "setting": group_id, "mean": mean, "plus_count": plus,
                "minus_count": shots - plus,
                "wilson95_interval": _interval(plus, shots) if mask else [1.0, 1.0],
                "exact_expectation": _expectation(initial, n, label),
            }
        settings.append({"id": group_id, "basis_wire0_first": group["basis"],
                         "observables": group["observables"], "shots": shots, "counts": counts})
    wires = parsed.get("probability_wires", list(range(n)))
    selected_counts = [0] * (1 << len(wires))
    for basis, count in enumerate(settings[0]["counts"]):
        bucket = sum(((basis >> wire) & 1) << bit for bit, wire in enumerate(wires))
        selected_counts[bucket] += count
    return {
        "schema": 1, "qubits": n, "seed": seed, "shots_per_setting": shots,
        "settings_count": len(settings), "total_shots": total_shots,
        "settings": settings, "estimates": estimates,
        "probability_wires": wires, "counts": selected_counts,
        "probabilities": [count / shots for count in selected_counts],
        "manifest_sha256": sha256_text(canonical(parsed)),
        "uncertainty": "Approximate 95% Wilson intervals per observable, not simultaneous; shared-setting estimates are correlated. Identity is exactly 1.",
        "authority": "SIMULATED_FINITE_SHOTS",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("--shots", type=int, default=1024)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--max-total-shots", type=int, default=DEFAULT_MAX_TOTAL_SHOTS)
    args = parser.parse_args(argv)
    try:
        print(canonical(sample_measurements(read_manifest(args.manifest), shots=args.shots,
                                            seed=args.seed, max_total_shots=args.max_total_shots)))
        return 0
    except (OracleError, OSError, UnicodeError) as exc:
        print(f"qoracle measurements: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
