"""Reproducible terminal computational-basis sampling from QOracle probabilities."""
from __future__ import annotations

import argparse
from bisect import bisect_right
import math
import random
import sys
from typing import Any

from .engine import OracleError, canonical, load_manifest, simulate
from .qasm import read_source

MAX_SHOTS = 1_000_000


def sample(manifest: dict[str, Any], shots: int = 1024, seed: int = 0) -> dict[str, Any]:
    """Draw independent shots; each outcome bit j corresponds to wires[j].

Does not mutate the manifest or process-global PRNG and does not model hardware
noise, mid-circuit measurement, or finite-shot Pauli expectation estimation.
    """
    if type(shots) is not int or not 1 <= shots <= MAX_SHOTS:
        raise OracleError(f"shots must be an integer between 1 and {MAX_SHOTS}")
    if type(seed) is not int or not 0 <= seed < 2**64:
        raise OracleError("seed must be an unsigned 64-bit integer")
    clean = load_manifest(canonical(manifest))
    oracle = simulate(clean)
    probabilities = oracle["probabilities"]
    norm = math.fsum(probabilities)
    if not math.isfinite(norm) or norm <= 0 or abs(norm - 1) > 1e-8:
        raise OracleError("oracle probabilities are not normalized")
    probabilities = [value / norm for value in probabilities]
    support = [index for index, probability in enumerate(probabilities) if probability > 0]
    cumulative: list[float] = []
    total = 0.0
    for index in support:
        total += probabilities[index]
        cumulative.append(total)
    cumulative[-1] = 1.0
    counts = [0] * len(probabilities)
    rng = random.Random(seed)
    for _ in range(shots):
        # Sample only positive support: normalization drift can never allocate
        # a shot to an impossible trailing outcome, even at a CDF boundary.
        counts[support[bisect_right(cumulative, rng.random())]] += 1
    wires = clean.get("probability_wires", list(range(clean["qubits"])))
    frequencies = [count / shots for count in counts]
    return {
        "schema": 1,
        "authority": "INDEPENDENT_SIMULATION_ONLY",
        "method": "computational-basis-inverse-cdf-python-mt19937-v1",
        "manifest_sha256": oracle["manifest_sha256"],
        "qubits": clean["qubits"],
        "probability_wires": wires,
        "endian": "little",
        "bitstring_order": "highest outcome bit on the left; rightmost bit is probability_wires[0]",
        "shots": shots,
        "seed": seed,
        "counts": counts,
        "bitstring_counts": {format(index, f"0{len(wires)}b"): count for index, count in enumerate(counts)},
        "frequencies": frequencies,
        "exact_probabilities": probabilities,
        "total_variation_from_exact": 0.5 * math.fsum(abs(got - exact) for got, exact in zip(frequencies, probabilities)),
        "not": ["hardware_measurements", "noise_model", "finite_shot_pauli_estimates", "contest_submission", "leaderboard_score"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="QOracle JSON manifest")
    parser.add_argument("--shots", type=int, default=1024)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)
    try:
        print(canonical(sample(load_manifest(read_source(args.input)), args.shots, args.seed)))
        return 0
    except (OracleError, OSError, UnicodeError, ValueError, TypeError, OverflowError) as exc:
        print(f"qoracle shots: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
