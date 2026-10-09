"""Offline variational minimization of a real weighted-Pauli objective."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
from typing import Any

if __package__:
    from .cli import _read
    from .diagnostics import MAX_GRADIENT_GATES, _indices, _normalise, expectation_gradients
    from .engine import ROTATIONS, OracleError, canonical, sha256_text, simulate, strict_loads
else:
    from cli import _read
    from diagnostics import MAX_GRADIENT_GATES, _indices, _normalise, expectation_gradients
    from engine import ROTATIONS, OracleError, canonical, sha256_text, simulate, strict_loads


def _real(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OracleError(f"{name} must be a finite real")
    try:
        number = float(value)
    except OverflowError as exc:
        raise OracleError(f"{name} must be a finite real") from exc
    if not math.isfinite(number):
        raise OracleError(f"{name} must be a finite real")
    return number


def _energy(circuit: dict[str, Any], terms: dict[str, float]) -> float:
    values = simulate(circuit)["expectations"]
    try:
        energy = math.fsum(weight * values[label] for label, weight in terms.items())
    except (OverflowError, ValueError) as exc:
        raise OracleError("objective overflow; rescale coefficients") from exc
    if not math.isfinite(energy):
        raise OracleError("objective overflow; rescale coefficients")
    return energy


def minimize_energy(
    circuit: dict[str, Any], terms: dict[str, float],
    gate_indices: list[int] | None = None, *, max_steps: int = 80,
    initial_step: float = 1.0, gradient_tolerance: float = 1e-7,
) -> dict[str, Any]:
    """Backtracking descent in independent RX/RY/RZ gate angles.

    This is a local optimizer. Even a zero gradient can be a maximum or saddle;
    no stop reason certifies a global minimum. Only strict decreases are retained.
    """
    current = _normalise(circuit)
    input_hash = sha256_text(canonical(current))
    qubits, gates = current["qubits"], current["gates"]
    if not isinstance(terms, dict) or not 1 <= len(terms) <= 64:
        raise OracleError("terms must be a non-empty object of at most 64 Pauli coefficients")
    weights = {}
    for label, coefficient in terms.items():
        if not isinstance(label, str) or len(label) != qubits or any(c not in "IXYZ" for c in label):
            raise OracleError(f"each Pauli term must be an IXYZ string of length {qubits}")
        weights[label] = _real(coefficient, "coefficient")
    current["observables"] = list(weights)
    if gate_indices is None:
        gate_indices = [i for i, gate in enumerate(gates) if gate["op"] in ROTATIONS]
    indices = _indices(gate_indices, len(gates), MAX_GRADIENT_GATES, "gate_indices")
    if any(gates[index]["op"] not in ROTATIONS for index in indices):
        raise OracleError("optimized gates must be RX, RY or RZ rotations")
    if isinstance(max_steps, bool) or not isinstance(max_steps, int) or not 0 <= max_steps <= 200:
        raise OracleError("max_steps must be an integer from 0 to 200")
    initial_step = _real(initial_step, "initial_step")
    tolerance = _real(gradient_tolerance, "gradient_tolerance")
    if not 0 < initial_step <= math.pi:
        raise OracleError("initial_step must be positive and at most pi radians")
    if tolerance < 0:
        raise OracleError("gradient_tolerance must be non-negative")

    energy = _energy(current, weights)
    history = [{"iteration": 0, "energy": energy}]
    objective_evaluations = 1
    shifted_evaluations = 0
    stop_reason = "max_steps"
    last_gradient = None
    for iteration in range(max_steps):
        derivative = expectation_gradients(current, indices)
        shifted_evaluations += derivative["shifted_evaluations"]
        try:
            gradients = [math.fsum(weights[label] * row["expectation_derivatives"][label] for label in weights) for row in derivative["gradients"]]
        except (OverflowError, ValueError) as exc:
            raise OracleError("gradient overflow; rescale coefficients") from exc
        norm = math.hypot(*gradients)
        if not math.isfinite(norm):
            raise OracleError("gradient overflow; rescale coefficients")
        last_gradient = {"at_iteration": iteration, "energy": energy, "l2_norm": norm}
        if norm <= tolerance:
            stop_reason = "gradient_tolerance"
            break
        scale = max(1.0, norm)
        direction = [value / scale for value in gradients]
        step = initial_step
        accepted = False
        for _ in range(12):
            proposal = dict(current, gates=[dict(gate) for gate in current["gates"]])
            for index, delta in zip(indices, direction):
                proposal["gates"][index]["theta"] -= step * delta
            proposed_energy = _energy(proposal, weights)
            objective_evaluations += 1
            required_drop = (1e-4 * step) * norm * (norm / scale)
            if proposed_energy < energy and proposed_energy <= energy - required_drop:
                current, energy = proposal, proposed_energy
                history.append({"iteration": iteration + 1, "energy": energy, "step": step})
                accepted = True
                break
            step /= 2
        if not accepted:
            stop_reason = "line_search_exhausted"
            break

    return {
        "schema": 1,
        "analysis": "variational_energy_minimization",
        "method": "parameter_shift_backtracking_descent",
        "parameter_semantics": "independent_gate_occurrence",
        "initial_manifest_sha256": input_hash,
        "terms": weights,
        "gate_indices": indices,
        "initial_energy": history[0]["energy"],
        "final_energy": energy,
        "stop_reason": stop_reason,
        "iterations": len(history) - 1,
        "last_gradient": last_gradient,
        "objective_evaluations": objective_evaluations,
        "shifted_circuit_evaluations": shifted_evaluations,
        "history": history,
        "optimized_manifest": current,
        "authority": "INDEPENDENT_SIMULATION_ONLY",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("problem", type=Path)
    args = parser.parse_args(argv)
    try:
        problem = strict_loads(_read(args.problem))
        allowed = {"schema", "circuit", "terms", "gate_indices", "max_steps", "initial_step", "gradient_tolerance"}
        required = {"schema", "circuit", "terms"}
        if not isinstance(problem, dict) or set(problem) - allowed or required - set(problem):
            raise OracleError("problem keys do not match the optimization contract")
        if type(problem["schema"]) is not int or problem["schema"] != 1:
            raise OracleError("unsupported problem schema")
        report = minimize_energy(**{key: value for key, value in problem.items() if key != "schema"})
    except (OracleError, OSError, UnicodeError) as exc:
        print(f"HOLD {exc}", file=sys.stderr)
        return 2
    json.dump(report, sys.stdout, sort_keys=True, separators=(",", ":"), allow_nan=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
