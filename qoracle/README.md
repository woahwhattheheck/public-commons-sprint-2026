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

From the repository root:

```bash
python3 -m qoracle.cli simulate qoracle/examples/bell.json
python3 -m qoracle.cli verify qoracle/examples/bell.json qoracle/examples/bell.candidate.json
```

Direct execution with `python3 qoracle/cli.py` also works. Missing/unreadable
files and invalid UTF-8 return a readable diagnostic with exit code 2.

`verify` returns `MATCH` or `MISMATCH` inside the printed receipt and a
nonzero status on mismatch. Tolerances must be between 0 and `1e-2`.
Duplicate keys and nonfinite numbers are rejected.

## Complex phases and Pauli Y

Expectations use the Hermitian inner product `<psi|P|psi>`. If applying `P`
to basis state `i` gives `phase * |j>`, its contribution is
`conjugate(psi[j]) * phase * psi[i]`. The bra belongs to the destination
basis state. This matters for the imaginary phases of Pauli Y, whose matrix
is `[[0, -i], [i, 0]]` ([operator definition](https://docs.pennylane.ai/en/stable/code/api/pennylane.PauliY.html)).

For example, `H` followed by `S` prepares `(|0> + i|1>)/sqrt(2)`. Simulating
this manifest gives `X = 0`, `Y = +1`, `Z = 0`, and probabilities `[0.5, 0.5]`
up to floating-point precision:

```json
{"schema":1,"qubits":1,"gates":[{"op":"H","wire":0},{"op":"S","wire":0}],"observables":["X","Y","Z"]}
```

Earlier QOracle outputs reversed the sign for observables with an odd number
of Y operators. Recompute any retained expectation or verification result
that depends on those observables; computational-basis probabilities were
not affected by that contraction error.

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
