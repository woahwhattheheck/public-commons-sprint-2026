"""Bounded variational-circuit and subsystem diagnostics using the QOracle core."""

from __future__ import annotations

import math
from typing import Any

if __package__:
    from .engine import (
        ROTATIONS, OracleError, _apply, _assert_finite, _expectation,
        canonical, load_manifest, sha256_text,
    )
else:
    from engine import (
        ROTATIONS, OracleError, _apply, _assert_finite, _expectation,
        canonical, load_manifest, sha256_text,
    )

MAX_GRADIENT_GATES = 32
MAX_DENSITY_WIRES = 6


def _normalise(manifest: dict[str, Any]) -> dict[str, Any]:
    try:
        return load_manifest(canonical(manifest))
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise OracleError(f"invalid diagnostic manifest: {exc}") from exc


def _indices(values: list[int], size: int, limit: int, label: str) -> list[int]:
    if not isinstance(values, list) or not 1 <= len(values) <= limit:
        raise OracleError(f"{label} must contain 1 to {limit} indices")
    if any(isinstance(v, bool) or not isinstance(v, int) or not 0 <= v < size for v in values):
        raise OracleError(f"{label} contains an out-of-range or non-integer index")
    if len(set(values)) != len(values):
        raise OracleError(f"{label} must not repeat an index")
    return list(values)


def _zero_state(qubits: int) -> list[complex]:
    state = [0j] * (1 << qubits)
    state[0] = 1 + 0j
    return state


def _check_state(state: list[complex]) -> None:
    _assert_finite(state)
    if abs(math.fsum(abs(amp) ** 2 for amp in state) - 1.0) > 1e-8:
        raise OracleError("diagnostic statevector left the unit sphere")


def _header(manifest: dict[str, Any], analysis: str) -> dict[str, Any]:
    return {
        "schema": 1,
        "analysis": analysis,
        "qubits": manifest["qubits"],
        "endian": "little",
        "manifest_sha256": sha256_text(canonical(manifest)),
        "authority": "INDEPENDENT_SIMULATION_ONLY",
    }


def expectation_gradients(
    manifest: dict[str, Any], gate_indices: list[int] | None = None,
) -> dict[str, Any]:
    """Differentiate each selected RX/RY/RZ occurrence, holding all others fixed.

    The circuit prefix is evolved once. Two shifted suffixes per requested
    occurrence implement (f(theta + pi/2) - f(theta - pi/2)) / 2. Applying an
    extra commuting rotation avoids losing the shift when theta is very large.
    """
    manifest = _normalise(manifest)
    qubits, gates = manifest["qubits"], manifest["gates"]
    if not manifest["observables"]:
        raise OracleError("gradients require at least one Pauli observable")
    if gate_indices is None:
        gate_indices = [i for i, gate in enumerate(gates) if gate["op"] in ROTATIONS]
    indices = _indices(gate_indices, len(gates), MAX_GRADIENT_GATES, "gate_indices")
    if any(gates[i]["op"] not in ROTATIONS for i in indices):
        raise OracleError("only RX, RY and RZ theta parameters support this shift rule")
    labels = list(dict.fromkeys(manifest["observables"]))
    selected = set(indices)
    results: dict[int, dict[str, Any]] = {}
    state = _zero_state(qubits)
    for index, gate in enumerate(gates):
        _apply(state, qubits, gate)
        if index not in selected:
            continue
        shifted_values = []
        for shift in (math.pi / 2, -math.pi / 2):
            shifted = state.copy()
            _apply(shifted, qubits, {"op": gate["op"], "wire": gate["wire"], "theta": shift})
            for later in gates[index + 1:]:
                _apply(shifted, qubits, later)
            _check_state(shifted)
            shifted_values.append({label: _expectation(shifted, qubits, label) for label in labels})
        plus, minus = shifted_values
        results[index] = {
            "gate_index": index,
            "op": gate["op"],
            "wire": gate["wire"],
            "theta": gate["theta"],
            "expectation_derivatives": {label: (plus[label] - minus[label]) / 2 for label in labels},
        }
        if len(results) == len(indices):
            break
    report = _header(manifest, "expectation_gradients")
    report.update({
        "method": "two_term_parameter_shift",
        "parameter_semantics": "independent_gate_occurrence",
        "shift_radians": math.pi / 2,
        "shifted_evaluations": 2 * len(indices),
        "gradients": [results[index] for index in indices],
    })
    return report


def reduced_state(manifest: dict[str, Any], wires: list[int]) -> dict[str, Any]:
    """Trace out unselected wires; output bit j refers to wires[j].

    Matrix entries are [real, imaginary] pairs. At most six retained wires
    bound the output to 4096 complex entries; the register may have ten wires.
    """
    manifest = _normalise(manifest)
    qubits = manifest["qubits"]
    wires = _indices(wires, qubits, min(qubits, MAX_DENSITY_WIRES), "wires")
    state = _zero_state(qubits)
    for gate in manifest["gates"]:
        _apply(state, qubits, gate)
    _check_state(state)
    environment = [wire for wire in range(qubits) if wire not in wires]
    dimension = 1 << len(wires)
    blocks = [[0j] * dimension for _ in range(1 << len(environment))]
    for basis, amp in enumerate(state):
        sub = sum(((basis >> wire) & 1) << bit for bit, wire in enumerate(wires))
        env = sum(((basis >> wire) & 1) << bit for bit, wire in enumerate(environment))
        blocks[env][sub] = amp
    matrix = [[0j] * dimension for _ in range(dimension)]
    for row in range(dimension):
        for col in range(row, dimension):
            terms = [block[row] * block[col].conjugate() for block in blocks]
            value = complex(math.fsum(v.real for v in terms), math.fsum(v.imag for v in terms))
            matrix[row][col] = value
            matrix[col][row] = value.conjugate()
    diagonal = [matrix[i][i].real for i in range(dimension)]
    report = _header(manifest, "reduced_state")
    report.update({
        "wires": wires,
        "traced_out_wires": environment,
        "complex_encoding": "[real,imaginary]",
        "density_matrix": [[[v.real, v.imag] for v in row] for row in matrix],
        "probabilities": diagonal,
        "trace": math.fsum(diagonal),
        "purity": math.fsum(abs(v) ** 2 for row in matrix for v in row),
    })
    return report
