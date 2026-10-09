"""Shared, read-only helpers for the additive QOracle experiment commands."""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from .engine import OracleError, _apply, _assert_finite, canonical, load_manifest

MAX_INPUT_BYTES = 2 * 1024 * 1024


def normalize_manifest(value: dict[str, Any] | str) -> dict[str, Any]:
    """Use the existing manifest contract, including direct Python callers."""
    from .engine import strict_loads

    try:
        raw = strict_loads(value) if isinstance(value, str) else value
        if not isinstance(raw, dict) or type(raw.get("schema")) is not int:
            raise OracleError("manifest schema must be an integer")
        return load_manifest(canonical(raw))
    except OracleError:
        raise
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise OracleError(f"invalid manifest: {type(exc).__name__}") from exc


def read_manifest(path: str) -> dict[str, Any]:
    with Path(path).open("rb") as source:
        data = source.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise OracleError(f"manifest exceeds {MAX_INPUT_BYTES} bytes")
    return normalize_manifest(data.decode("utf-8"))


def positive_integer(value: Any, name: str, maximum: int | None = None) -> int:
    if type(value) is not int or value < 1 or (maximum is not None and value > maximum):
        bound = f"1..{maximum}" if maximum is not None else "a positive integer"
        raise OracleError(f"{name} must be {bound}")
    return value


def statevector(manifest: dict[str, Any], basis: int = 0) -> list[complex]:
    """Execute an already-normalized manifest without changing its contents."""
    qubits = manifest["qubits"]
    dimension = 1 << qubits
    if type(basis) is not int or not 0 <= basis < dimension:
        raise OracleError("basis input is outside the register")
    state = [0j] * dimension
    state[basis] = 1 + 0j
    for gate in manifest["gates"]:
        _apply(state, qubits, gate)
    _assert_finite(state)
    if abs(math.fsum(abs(amp) ** 2 for amp in state) - 1.0) > 1e-8:
        raise OracleError("statevector left the unit sphere")
    return state
