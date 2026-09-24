# QOracle

Stdlib-only statevector oracle for circuits of 1 to 10 qubits. It exists so a
timed solution can be checked against a second implementation. It is not a
QHack registration, submission, score, prize, or payment.

## Convention

Basis index bit `k` is qubit `k` (little-endian). Pauli strings use the same
index: character 0 is qubit 0. The register starts in `|0...0>`.

Supported ops: `H X Y Z S T RX RY RZ CNOT CZ SWAP`. Rotations take radians in
`theta`. `CNOT` and `CZ` take `control` and `target`. `SWAP` takes `wire_a`
and `wire_b`.

## Run

```bash
python3 cli.py simulate examples/bell.json
python3 cli.py verify examples/bell.json examples/bell.candidate.json
python3 -m unittest regress
python3 -O -m unittest regress
```

`verify` returns `MATCH` or `MISMATCH` inside the printed receipt and a
nonzero status on mismatch. Tolerances must be between 0 and `1e-2`.
Duplicate keys and nonfinite numbers are rejected.

## PennyLane mapping

During a timed event, translate a circuit by hand into this manifest. Do not
assume a future hidden task uses these names.

| PennyLane | Manifest |
|---|---|
| `qml.H(wires=0)` | `{"op":"H","wire":0}` |
| `qml.X/Y/Z/S/T(wires=k)` | `{"op":"...","wire":k}` |
| `qml.RX(theta, wires=k)` | `{"op":"RX","wire":k,"theta":theta}` |
| `qml.CNOT(wires=[c,t])` | `{"op":"CNOT","control":c,"target":t}` |
| `qml.CZ(wires=[c,t])` | `{"op":"CZ","control":c,"target":t}` |
| `qml.SWAP(wires=[a,b])` | `{"op":"SWAP","wire_a":a,"wire_b":b}` |

Compare probabilities and Pauli expectations. Do not compare raw amplitudes:
a global phase is not an observable disagreement. This package does not submit
anything to QHack.
