"""Independent statevector oracle for at most 10 qubits.

Wire 0 is the least-significant bit of the basis index (little-endian).
A Pauli string is indexed the same way: character 0 is qubit 0.

This module does not call a network, does not import PennyLane, and does not
claim a contest registration, score, prize, or payment.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

SCHEMA = 1
MAX_QUBITS = 10
MAX_GATES = 4000
OPS = {"H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ", "CNOT", "CZ", "SWAP"}
ROTATIONS = {"RX", "RY", "RZ"}
SQRT2 = math.sqrt(2.0)


class OracleError(ValueError):
    """Fail-closed manifest or candidate error."""


def strict_loads(text: str) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, value in items:
            if key in out:
                raise OracleError(f"duplicate key {key}")
            out[key] = value
        return out

    def reject_constant(name: str) -> Any:
        raise OracleError(f"nonfinite number {name}")

    if not isinstance(text, str):
        raise OracleError("input must be text")
    try:
        return json.loads(text, object_pairs_hook=pairs, parse_constant=reject_constant)
    except OracleError:
        raise
    except json.JSONDecodeError as exc:
        raise OracleError(f"malformed json: {exc.msg}") from exc


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OracleError(f"{label} must be a finite real")
    number = float(value)
    if not math.isfinite(number):
        raise OracleError(f"{label} must be a finite real")
    return number


def _int_wire(value: Any, qubits: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise OracleError(f"{label} must be an integer wire")
    if value < 0 or value >= qubits:
        raise OracleError(f"{label} is outside 0..{qubits - 1}")
    return value


def load_manifest(text: str) -> dict[str, Any]:
    raw = strict_loads(text)
    if not isinstance(raw, dict):
        raise OracleError("manifest must be an object")
    allowed = {"schema", "qubits", "gates", "observables"}
    extra = sorted(set(raw) - allowed)
    missing = sorted(allowed - {"observables"} - set(raw))
    if extra or missing:
        raise OracleError(f"manifest keys missing={missing} extra={extra}")
    if raw["schema"] != SCHEMA:
        raise OracleError("unsupported schema")
    qubits = raw["qubits"]
    if isinstance(qubits, bool) or not isinstance(qubits, int) or not 1 <= qubits <= MAX_QUBITS:
        raise OracleError(f"qubits must be an integer from 1 to {MAX_QUBITS}")
    gates = raw["gates"]
    if not isinstance(gates, list) or len(gates) > MAX_GATES:
        raise OracleError("gates must be a bounded list")
    parsed = [_gate(item, qubits, index) for index, item in enumerate(gates)]
    observables = raw.get("observables", [])
    if not isinstance(observables, list) or len(observables) > 64:
        raise OracleError("observables must be a bounded list")
    parsed_obs = []
    for index, item in enumerate(observables):
        if not isinstance(item, str) or len(item) != qubits or any(ch not in "IXYZ" for ch in item):
            raise OracleError(f"observable {index} must be an IXYZ string of length {qubits}")
        parsed_obs.append(item)
    return {"schema": SCHEMA, "qubits": qubits, "gates": parsed, "observables": parsed_obs}


def _gate(item: Any, qubits: int, index: int) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise OracleError(f"gate {index} must be an object")
    op = item.get("op")
    if op not in OPS:
        raise OracleError(f"gate {index} has an unsupported op")
    if op in {"CNOT", "CZ", "SWAP"}:
        keys = {"op", "control", "target"} if op != "SWAP" else {"op", "wire_a", "wire_b"}
        if set(item) != keys and op != "SWAP":
            if set(item) != {"op", "control", "target"}:
                raise OracleError(f"gate {index} keys do not match {op}")
        if op == "SWAP":
            if set(item) != {"op", "wire_a", "wire_b"}:
                raise OracleError(f"gate {index} keys do not match SWAP")
            a = _int_wire(item["wire_a"], qubits, "wire_a")
            b = _int_wire(item["wire_b"], qubits, "wire_b")
            if a == b:
                raise OracleError("SWAP wires must differ")
            return {"op": "SWAP", "wire_a": a, "wire_b": b}
        control = _int_wire(item["control"], qubits, "control")
        target = _int_wire(item["target"], qubits, "target")
        if control == target:
            raise OracleError(f"{op} control and target must differ")
        return {"op": op, "control": control, "target": target}
    keys = {"op", "wire", "theta"} if op in ROTATIONS else {"op", "wire"}
    if set(item) != keys:
        raise OracleError(f"gate {index} keys do not match {op}")
    wire = _int_wire(item["wire"], qubits, "wire")
    if op in ROTATIONS:
        return {"op": op, "wire": wire, "theta": _finite(item["theta"], "theta")}
    return {"op": op, "wire": wire}


def simulate(manifest: dict[str, Any]) -> dict[str, Any]:
    qubits = manifest["qubits"]
    state = [0j] * (1 << qubits)
    state[0] = 1 + 0j
    for gate in manifest["gates"]:
        _apply(state, qubits, gate)
        _assert_finite(state)
    norm = sum(abs(amp) ** 2 for amp in state)
    if abs(norm - 1.0) > 1e-8:
        raise OracleError("statevector left the unit sphere")
    probabilities = [abs(amp) ** 2 for amp in state]
    expectations = {label: _expectation(state, qubits, label) for label in manifest["observables"]}
    return {
        "schema": SCHEMA,
        "qubits": qubits,
        "endian": "little",
        "probabilities": probabilities,
        "expectations": expectations,
        "manifest_sha256": sha256_text(canonical(manifest)),
        "authority": "INDEPENDENT_SIMULATION_ONLY",
        "not": [
            "qhack_registration",
            "qhack_submission",
            "leaderboard_score",
            "prize",
            "pennylane_equivalence_guarantee",
            "revenue",
        ],
    }


def verify(manifest: dict[str, Any], candidate_text: str) -> dict[str, Any]:
    oracle = simulate(manifest)
    candidate = strict_loads(candidate_text)
    if not isinstance(candidate, dict):
        raise OracleError("candidate must be an object")
    allowed = {"schema", "probabilities", "expectations", "tolerance"}
    if set(candidate) - allowed or "probabilities" not in candidate:
        raise OracleError("candidate keys are not the verifier contract")
    if candidate.get("schema", SCHEMA) != SCHEMA:
        raise OracleError("unsupported candidate schema")
    tolerance = _finite(candidate.get("tolerance", 1e-8), "tolerance")
    if tolerance < 0 or tolerance > 1e-2:
        raise OracleError("tolerance must be between 0 and 1e-2")
    probs = candidate["probabilities"]
    if not isinstance(probs, list) or len(probs) != len(oracle["probabilities"]):
        raise OracleError("candidate probabilities have the wrong length")
    findings = []
    for index, value in enumerate(probs):
        got = _finite(value, f"probability {index}")
        if got < -tolerance or got > 1 + tolerance:
            findings.append(f"probability {index} is outside 0..1")
        elif abs(got - oracle["probabilities"][index]) > tolerance:
            findings.append(f"probability {index} disagrees with the oracle")
    total = sum(_finite(value, "probability") for value in probs)
    if abs(total - 1.0) > max(tolerance * len(probs), 1e-8):
        findings.append("candidate probabilities are not normalized")
    expectations = candidate.get("expectations", {})
    if not isinstance(expectations, dict):
        raise OracleError("expectations must be an object")
    if set(expectations) != set(oracle["expectations"]):
        findings.append("candidate observables do not match the manifest")
    else:
        for label, expected in oracle["expectations"].items():
            got = _finite(expectations[label], f"expectation {label}")
            if abs(got - expected) > tolerance:
                findings.append(f"expectation {label} disagrees with the oracle")
    return {
        "schema": SCHEMA,
        "state": "MATCH" if not findings else "MISMATCH",
        "findings": findings,
        "manifest_sha256": oracle["manifest_sha256"],
        "tolerance": tolerance,
        "authority": oracle["authority"],
        "not": oracle["not"],
    }


def _apply(state: list[complex], qubits: int, gate: dict[str, Any]) -> None:
    op = gate["op"]
    if op == "CNOT":
        _controlled_flip(state, gate["control"], gate["target"])
        return
    if op == "CZ":
        _cz(state, gate["control"], gate["target"])
        return
    if op == "SWAP":
        _swap(state, gate["wire_a"], gate["wire_b"])
        return
    matrix = _matrix(op, gate.get("theta"))
    _one_qubit(state, gate["wire"], matrix)


def _matrix(op: str, theta: float | None) -> tuple[complex, complex, complex, complex]:
    if op == "X":
        return (0j, 1 + 0j, 1 + 0j, 0j)
    if op == "Y":
        return (0j, -1j, 1j, 0j)
    if op == "Z":
        return (1 + 0j, 0j, 0j, -1 + 0j)
    if op == "H":
        s = 1 / SQRT2
        return (s + 0j, s + 0j, s + 0j, -s + 0j)
    if op == "S":
        return (1 + 0j, 0j, 0j, 1j)
    if op == "T":
        phase = complex(math.cos(math.pi / 4), math.sin(math.pi / 4))
        return (1 + 0j, 0j, 0j, phase)
    if theta is None:
        raise OracleError("rotation is missing theta")
    half = theta / 2
    c = math.cos(half)
    s = math.sin(half)
    if op == "RX":
        return (c + 0j, -1j * s, -1j * s, c + 0j)
    if op == "RY":
        return (c + 0j, -s + 0j, s + 0j, c + 0j)
    if op == "RZ":
        return (complex(math.cos(-half), math.sin(-half)), 0j, 0j, complex(math.cos(half), math.sin(half)))
    raise OracleError(f"unsupported op {op}")


def _one_qubit(state: list[complex], wire: int, matrix: tuple[complex, complex, complex, complex]) -> None:
    a00, a01, a10, a11 = matrix
    mask = 1 << wire
    for base in range(len(state)):
        if base & mask:
            continue
        other = base | mask
        v0 = state[base]
        v1 = state[other]
        state[base] = a00 * v0 + a01 * v1
        state[other] = a10 * v0 + a11 * v1


def _controlled_flip(state: list[complex], control: int, target: int) -> None:
    cmask = 1 << control
    tmask = 1 << target
    for base in range(len(state)):
        if (base & cmask) and not (base & tmask):
            other = base | tmask
            state[base], state[other] = state[other], state[base]


def _cz(state: list[complex], control: int, target: int) -> None:
    mask = (1 << control) | (1 << target)
    for index, amp in enumerate(state):
        if index & mask == mask:
            state[index] = -amp


def _swap(state: list[complex], wire_a: int, wire_b: int) -> None:
    amask = 1 << wire_a
    bmask = 1 << wire_b
    for base in range(len(state)):
        if (base & amask) or not (base & bmask):
            continue
        other = (base ^ amask) ^ bmask
        state[base], state[other] = state[other], state[base]


def _expectation(state: list[complex], qubits: int, label: str) -> float:
    acc = 0j
    for index, amp in enumerate(state):
        if amp == 0:
            continue
        image, phase = _pauli_image(index, qubits, label)
        # P|index> = phase|image>, so contract with the bra at image.
        # Conjugating the source amplitude instead flips odd-Y observables.
        acc += state[image].conjugate() * phase * amp
    if abs(acc.imag) > 1e-8:
        raise OracleError(f"observable {label} produced a non-real expectation")
    return float(acc.real)


def _pauli_image(index: int, qubits: int, label: str) -> tuple[int, complex]:
    image = index
    phase = 1 + 0j
    for wire, letter in enumerate(label):
        bit = (index >> wire) & 1
        if letter == "I":
            continue
        if letter == "Z":
            if bit:
                phase *= -1
            continue
        image ^= 1 << wire
        if letter == "X":
            continue
        # Y|0> = i|1>, Y|1> = -i|0>
        phase *= 1j if bit == 0 else -1j
    if image >> qubits:
        raise OracleError("pauli image escaped the register")
    return image, phase


def _assert_finite(state: list[complex]) -> None:
    for amp in state:
        if not math.isfinite(amp.real) or not math.isfinite(amp.imag):
            raise OracleError("nonfinite amplitude")
