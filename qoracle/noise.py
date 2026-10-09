"""Exact small-register noise simulation; no service or hardware calls.

Uses the existing gate kernel on density-matrix rows/columns. Noise events are
ordered by completed gate count, then by their order in the input list.
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
import json
import math
from pathlib import Path
import random
import sys
from typing import Any

from .engine import (
    OracleError, _apply, _pauli_image, canonical, load_manifest,
    sha256_text, strict_loads,
)

MAX_INPUT_BYTES = 1_048_576
MAX_NOISY_QUBITS = 6
MAX_NOISY_GATES = 512
MAX_NOISE_EVENTS = 512
MAX_SHOTS = 100_000
EPS = 1e-8
CHANNELS = {"AMPLITUDE_DAMPING", "PHASE_DAMPING", "DEPOLARIZING"}
Density = list[list[complex]]


def _integer(value: Any, low: int, high: int, label: str) -> int:
    if type(value) is not int or not low <= value <= high:
        raise OracleError(f"{label} must be an integer in {low}..{high}")
    return value


def _real(value: Any, low: float, high: float, label: str) -> float:
    if type(value) not in (int, float):
        raise OracleError(f"{label} must be a finite real in {low}..{high}")
    try:
        value = float(value)
    except OverflowError as exc:
        raise OracleError(f"{label} is too large") from exc
    if not math.isfinite(value) or not low <= value <= high:
        raise OracleError(f"{label} must be a finite real in {low}..{high}")
    return value


def _json(text: str) -> Any:
    if not isinstance(text, str):
        raise OracleError("input must be UTF-8 JSON text")
    try:
        if len(text.encode("utf-8")) > MAX_INPUT_BYTES:
            raise OracleError("input exceeds 1 MiB")
        return strict_loads(text)
    except OracleError:
        raise
    except (UnicodeError, RecursionError, OverflowError, ValueError) as exc:
        raise OracleError("invalid Unicode or excessively nested/numeric input") from exc


def load_noise_manifest(text: str) -> dict[str, Any]:
    raw = _json(text)
    required = {"schema", "circuit"}
    if not isinstance(raw, dict) or not required <= set(raw) or set(raw) - (required | {"noise", "sampling"}):
        raise OracleError("noise manifest requires schema/circuit; optional noise/sampling")
    _integer(raw["schema"], 1, 1, "schema")
    if not isinstance(raw["circuit"], dict):
        raise OracleError("circuit must be a QOracle manifest object")
    _integer(raw["circuit"].get("schema"), 1, 1, "circuit schema")
    try:
        circuit = load_manifest(canonical(raw["circuit"]))
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise OracleError(f"invalid circuit: {str(exc)[:240]}") from exc
    n = _integer(circuit["qubits"], 1, MAX_NOISY_QUBITS, "noisy qubits")
    if len(circuit["gates"]) > MAX_NOISY_GATES:
        raise OracleError(f"noisy simulation permits at most {MAX_NOISY_GATES} gates")
    noise = raw.get("noise", [])
    if not isinstance(noise, list) or len(noise) > MAX_NOISE_EVENTS:
        raise OracleError(f"noise must be a list of at most {MAX_NOISE_EVENTS} events")
    events = []
    for event in noise:
        if not isinstance(event, dict) or set(event) != {"after_gate", "channel", "wire", "p"}:
            raise OracleError("noise events require exactly after_gate/channel/wire/p")
        channel = event["channel"]
        if not isinstance(channel, str) or channel not in CHANNELS:
            raise OracleError("unsupported noise channel")
        events.append({
            "after_gate": _integer(event["after_gate"], 0, len(circuit["gates"]), "after_gate"),
            "channel": channel,
            "wire": _integer(event["wire"], 0, n - 1, "noise wire"),
            "p": _real(event["p"], 0.0, 1.0, "noise probability"),
        })
    # Python's stable sort retains the meaning of noncommuting events at one boundary.
    events.sort(key=lambda event: event["after_gate"])
    manifest = {"schema": 1, "circuit": circuit, "noise": events}
    if "sampling" in raw:
        sample = raw["sampling"]
        if not isinstance(sample, dict) or set(sample) != {"shots", "seed"}:
            raise OracleError("sampling requires exactly shots and seed")
        manifest["sampling"] = {
            "shots": _integer(sample["shots"], 1, MAX_SHOTS, "shots"),
            "seed": _integer(sample["seed"], 0, (1 << 64) - 1, "seed"),
        }
    return manifest


def _unitary(rho: Density, n: int, gate: dict[str, Any]) -> None:
    """rho <- U rho U-dagger without constructing a register-sized U."""
    dimension = len(rho)
    for column in range(dimension):
        vector = [rho[row][column] for row in range(dimension)]
        _apply(vector, n, gate)
        for row in range(dimension):
            rho[row][column] = vector[row]
    for row in range(dimension):
        vector = [entry.conjugate() for entry in rho[row]]
        _apply(vector, n, gate)
        rho[row] = [entry.conjugate() for entry in vector]


def _channel(rho: Density, event: dict[str, Any]) -> None:
    """Apply the one-wire Kraus sum to every spectator-index block."""
    mask = 1 << event["wire"]
    p = event["p"]
    q = math.sqrt(1.0 - p)
    bases = [index for index in range(len(rho)) if not index & mask]
    for row in bases:
        other_row = row | mask
        for column in bases:
            other_column = column | mask
            a, b = rho[row][column], rho[row][other_column]
            c, d = rho[other_row][column], rho[other_row][other_column]
            if event["channel"] == "AMPLITUDE_DAMPING":
                a, b, c, d = a + p * d, q * b, q * c, (1.0 - p) * d
            elif event["channel"] == "PHASE_DAMPING":
                b, c = q * b, q * c
            else:
                # PennyLane convention: total Pauli-error probability p;
                # each of X/Y/Z occurs with p/3. Complete mixing is p=3/4.
                transfer, coherence = 2.0 * p / 3.0, 1.0 - 4.0 * p / 3.0
                a, b, c, d = ((1.0 - transfer) * a + transfer * d,
                              coherence * b, coherence * c,
                              transfer * a + (1.0 - transfer) * d)
            rho[row][column], rho[row][other_column] = a, b
            rho[other_row][column], rho[other_row][other_column] = c, d


def _evolve(manifest: dict[str, Any]) -> Density:
    circuit = manifest["circuit"]
    n = circuit["qubits"]
    dimension = 1 << n
    rho = [[0j] * dimension for _ in range(dimension)]
    rho[0][0] = 1 + 0j
    events = iter(manifest["noise"])
    event = next(events, None)
    for boundary in range(len(circuit["gates"]) + 1):
        if boundary:
            _unitary(rho, n, circuit["gates"][boundary - 1])
        while event is not None and event["after_gate"] == boundary:
            _channel(rho, event)
            event = next(events, None)
    return rho


def _diagnostics(rho: Density) -> dict[str, float]:
    if any(not math.isfinite(value.real) or not math.isfinite(value.imag)
           for row in rho for value in row):
        raise OracleError("density matrix contains nonfinite entries")
    trace = sum(rho[index][index] for index in range(len(rho)))
    hermitian_error = max(abs(rho[i][j] - rho[j][i].conjugate())
                          for i in range(len(rho)) for j in range(len(rho)))
    purity = math.fsum(abs(value) ** 2 for row in rho for value in row)
    if abs(trace - 1.0) > EPS or hermitian_error > EPS:
        raise OracleError("density trace or Hermiticity invariant failed")
    if not 1.0 / len(rho) - EPS <= purity <= 1.0 + EPS:
        raise OracleError("density purity invariant failed")
    if any(not -EPS <= rho[i][i].real <= 1.0 + EPS for i in range(len(rho))):
        raise OracleError("density population invariant failed")
    return {"trace": trace.real, "purity": purity, "hermiticity_error": hermitian_error}


def _sample(probabilities: list[float], sample: dict[str, int]) -> dict[str, Any]:
    total = math.fsum(probabilities)
    cdf = [math.fsum(probabilities[:index + 1]) / total for index in range(len(probabilities))]
    cdf[-1] = 1.0
    rng = random.Random(sample["seed"])
    counts = [0] * len(probabilities)
    for _ in range(sample["shots"]):
        counts[bisect_right(cdf, rng.random())] += 1
    return {**sample, "rng": "python.random.Random", "basis": "computational",
            "counts": counts, "frequencies": [count / sample["shots"] for count in counts]}


def simulate_noise(text: str) -> dict[str, Any]:
    """Validate and simulate a noisy manifest; exact expectations, optional shots."""
    manifest = load_noise_manifest(text)
    circuit = manifest["circuit"]
    n = circuit["qubits"]
    rho = _evolve(manifest)
    diagnostics = _diagnostics(rho)
    selected = circuit.get("probability_wires", list(range(n)))
    buckets: list[list[float]] = [[] for _ in range(1 << len(selected))]
    for basis in range(len(rho)):
        outcome = sum(((basis >> wire) & 1) << bit for bit, wire in enumerate(selected))
        buckets[outcome].append(max(0.0, min(1.0, rho[basis][basis].real)))
    probabilities = [math.fsum(bucket) for bucket in buckets]
    expectations = {}
    for label in circuit["observables"]:
        value = 0j
        for index in range(len(rho)):
            image, phase = _pauli_image(index, n, label)
            value += rho[index][image] * phase
        if abs(value.imag) > EPS or not -1.0 - EPS <= value.real <= 1.0 + EPS:
            raise OracleError("Pauli expectation invariant failed")
        expectations[label] = value.real
    report = {
        "schema": 1, "qubits": n, "endian": "little",
        "probability_wires": selected, "probabilities": probabilities,
        "expectations": expectations, "diagnostics": diagnostics,
        "manifest_sha256": sha256_text(canonical(manifest)),
        "circuit_sha256": sha256_text(canonical(circuit)),
        "noise_events": len(manifest["noise"]),
        "authority": "INDEPENDENT_NOISE_SIMULATION_ONLY",
    }
    if "sampling" in manifest:
        report["sampling"] = _sample(probabilities, manifest["sampling"])
    return report


def verify_noise(text: str, candidate_text: str) -> dict[str, Any]:
    """Compare deterministic outputs, not finite-shot frequencies, to a candidate."""
    oracle = simulate_noise(text)
    candidate = _json(candidate_text)
    required = {"schema", "manifest_sha256", "probabilities", "expectations"}
    if not isinstance(candidate, dict) or not required <= set(candidate) or set(candidate) - (required | {"tolerance"}):
        raise OracleError("candidate requires schema/manifest_sha256/probabilities/expectations and optional tolerance")
    _integer(candidate["schema"], 1, 1, "candidate schema")
    tolerance = _real(candidate.get("tolerance", 1e-8), 0.0, 1e-2, "tolerance")
    probs = candidate["probabilities"]
    if not isinstance(probs, list) or len(probs) != len(oracle["probabilities"]):
        raise OracleError("candidate probabilities have the wrong length")
    probs = [_real(value, 0.0, 1.0, "candidate probability") for value in probs]
    expected = candidate["expectations"]
    if not isinstance(expected, dict) or set(expected) != set(oracle["expectations"]):
        raise OracleError("candidate observables differ from the manifest")
    expected = {label: _real(value, -1.0 - EPS, 1.0 + EPS, "candidate expectation")
                for label, value in expected.items()}
    errors = [abs(a - b) for a, b in zip(probs, oracle["probabilities"])]
    expectation_error = max((abs(expected[key] - value)
                             for key, value in oracle["expectations"].items()), default=0.0)
    findings = []
    if candidate["manifest_sha256"] != oracle["manifest_sha256"]:
        findings.append("candidate is not bound to this normalized noise manifest")
    if abs(math.fsum(probs) - 1.0) > max(tolerance, EPS):
        findings.append("candidate probabilities are not normalized")
    if max(errors) > tolerance:
        findings.append("candidate probabilities disagree with the oracle")
    if expectation_error > tolerance:
        findings.append("candidate expectations disagree with the oracle")
    return {"schema": 1, "state": "MISMATCH" if findings else "MATCH", "findings": findings,
            "manifest_sha256": oracle["manifest_sha256"], "tolerance": tolerance,
            "max_probability_error": max(errors), "probability_l1_error": math.fsum(errors),
            "max_expectation_error": expectation_error,
            "authority": oracle["authority"]}


def _read(path: str) -> str:
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise OracleError("input exceeds 1 MiB")
    return data.decode("utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    simulate_parser = subparsers.add_parser("simulate")
    simulate_parser.add_argument("manifest")
    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("manifest")
    verify_parser.add_argument("candidate")
    args = parser.parse_args(argv)
    try:
        text = _read(args.manifest)
        report = (simulate_noise(text) if args.command == "simulate"
                  else verify_noise(text, _read(args.candidate)))
        print(json.dumps(report, indent=2, sort_keys=True, allow_nan=False))
        return 1 if report.get("state") == "MISMATCH" else 0
    except (OracleError, OSError, UnicodeError, RecursionError) as exc:
        print(f"qoracle noise: {str(exc)[:400]}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
