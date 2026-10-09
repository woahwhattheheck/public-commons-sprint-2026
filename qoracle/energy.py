"""Estimate a weighted Pauli objective, retaining shared-shot covariances."""
from __future__ import annotations

import argparse
import math
from pathlib import Path
import sys
from typing import Any

from .engine import OracleError, canonical, sha256_text, strict_loads
from .experiment_support import MAX_INPUT_BYTES, normalize_manifest, read_manifest
from .measurements import DEFAULT_MAX_TOTAL_SHOTS, sample_measurements


def estimate_energy(
    manifest: dict[str, Any] | str,
    coefficients: dict[str, float],
    *,
    shots: int = 1024,
    seed: int = 0,
    max_total_shots: int = DEFAULT_MAX_TOTAL_SHOTS,
) -> dict[str, Any]:
    """Estimate E[sum(c_P * P)] with compatible terms sampled together.

    Each setting's shot outcome is the WHOLE weighted sum for that setting.
    Computing its empirical variance retains cross terms / covariance. Settings
    use independent draws. Reported standard error is an empirical estimate,
    not a confidence interval; zero empirical variance is not proof of certainty.
    """
    source = normalize_manifest(manifest)
    if not isinstance(coefficients, dict) or not coefficients or len(coefficients) > 64:
        raise OracleError("coefficients must be a non-empty object of at most 64 Pauli terms")
    terms = {}
    n = source["qubits"]
    for label, weight in coefficients.items():
        if not isinstance(label, str) or len(label) != n or any(x not in "IXYZ" for x in label):
            raise OracleError("coefficient keys must be Pauli strings matching the register")
        if isinstance(weight, bool) or not isinstance(weight, (int, float)):
            raise OracleError("coefficients must be finite real numbers")
        try:
            value = float(weight)
        except OverflowError as exc:
            raise OracleError("coefficient magnitude exceeds 1e12") from exc
        if not math.isfinite(value) or abs(value) > 1e12:
            raise OracleError("coefficients must be finite with magnitude at most 1e12")
        terms[label] = value
    # Sorting makes grouping and sampling independent of dictionary key order.
    sampled_manifest = dict(source, observables=sorted(label for label in terms if terms[label] != 0))
    samples = sample_measurements(sampled_manifest, shots=shots, seed=seed, max_total_shots=max_total_shots)
    groups = []
    for setting in samples["settings"]:
        masks = [(sum(1 << i for i, ch in enumerate(label) if ch != "I"), terms[label])
                 for label in setting["observables"]]
        outcomes = [math.fsum(weight * (-1 if (basis & mask).bit_count() % 2 else 1)
                              for mask, weight in masks)
                    for basis in range(1 << n)]
        mean = math.fsum(count * outcome for count, outcome in zip(setting["counts"], outcomes)) / shots
        # A mathematically constant setting needs no empirical variance estimate.
        is_constant = max(outcomes) == min(outcomes)
        variance = (0.0 if is_constant else
                    math.fsum(count * (outcome - mean) ** 2 for count, outcome in zip(setting["counts"], outcomes))
                    / (shots - 1) if shots > 1 else None)
        groups.append({"setting": setting["id"], "basis_wire0_first": setting["basis_wire0_first"],
                       "observables": setting["observables"], "mean": mean,
                       "sample_variance": variance,
                       "variance_of_mean": None if variance is None else variance / shots})
    variances = [group["variance_of_mean"] for group in groups]
    standard_error = (math.sqrt(math.fsum(variances)) if all(v is not None for v in variances) else None)
    exact = math.fsum(terms[label] * detail["exact_expectation"] for label, detail in samples["estimates"].items())
    return {
        "schema": 1, "mean": math.fsum(group["mean"] for group in groups),
        "sample_standard_error": standard_error, "exact_expectation": exact,
        "coefficients": terms, "groups": groups, "seed": seed,
        "shots_per_setting": shots, "total_shots": samples["total_shots"],
        "manifest_sha256": sha256_text(canonical(source)),
        "sampled_manifest_sha256": samples["manifest_sha256"],
        "objective_sha256": sha256_text(canonical(terms)),
        "uncertainty": "Empirical standard error with shared-setting covariance. Not a confidence interval; zero observed variance is not proof of zero sampling uncertainty. Nonconstant one-shot settings have null variance.",
        "authority": "SIMULATED_WEIGHTED_PAULI_OBJECTIVE",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("coefficients", help="JSON object mapping Pauli strings to real coefficients")
    parser.add_argument("--shots", type=int, default=1024)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--max-total-shots", type=int, default=DEFAULT_MAX_TOTAL_SHOTS)
    args = parser.parse_args(argv)
    try:
        with Path(args.coefficients).open("rb") as handle:
            data = handle.read(MAX_INPUT_BYTES + 1)
        if len(data) > MAX_INPUT_BYTES:
            raise OracleError("coefficients file exceeds input size limit")
        coefficients = strict_loads(data.decode("utf-8"))
        print(canonical(estimate_energy(read_manifest(args.manifest), coefficients, shots=args.shots,
                                         seed=args.seed, max_total_shots=args.max_total_shots)))
        return 0
    except (OracleError, OSError, UnicodeError, RecursionError, ValueError) as exc:
        print(f"qoracle energy: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
