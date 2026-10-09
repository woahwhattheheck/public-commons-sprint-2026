# Circuit interchange and finite-shot sampling

These tools extend the existing QOracle engine without changing its simulator,
verifier, CLI, or manifest schema. They run on Python's standard library only.

## Import, simulate, and sample a real circuit file

From the repository root:

```sh
python3 -m qoracle.qasm import qoracle/examples/interchange_bell.qasm > bell.json
python3 -m qoracle.cli simulate bell.json
python3 -m qoracle.shots bell.json --shots 4096 --seed 62
python3 -m qoracle.qasm export bell.json > bell.qasm
```

The included example declares two quantum registers and measures them in
reverse order. Both registers are flattened in declaration order, but output
bit 0 maps to `probability_wires[0]`, here wire 1. The Bell distribution is
`[0.5, 0, 0, 0.5]`. The actual Python 3.13.5 acceptance run with 4,096 shots and
seed 62 produced `[2025, 0, 0, 2071]`. These are simulated shots, not hardware
measurements. Exact simulation probabilities and sampled frequencies are
separate fields; ordinary finite-shot variation must not be presented as a
failed exact-statevector comparison.

## Supported OpenQASM 2 subset

`load_qasm(text)` returns a normalized QOracle manifest. It requires the
`OPENQASM 2.0;` header, bounded source of at most 262,144 UTF-8 bytes, and
semicolon-terminated statements. Line comments (`//`) are accepted. Qubit and
expanded-gate limits remain the engine's 10 qubits and 4,000 gates.

Supported declarations and operations:

- Multiple `qreg` and `creg` declarations before operations; indexed operands,
  register-wide single-qubit gates, and equal-width/two-operand broadcast.
- Built-in `U(theta,phi,lambda)` and `CX`, and the supported `qelib1.inc` gates
  `h x y z s t sdg tdg id rx ry rz cx cz u1 u2 u3`.
- Bounded real angles made from decimal/scientific literals, `pi`, parentheses,
  unary signs and `+ - * /`. Expressions are parsed with a whitelist; no
  `eval`, file access, imports, attribute lookup, functions, or power operator.
- Barriers after register validation, and terminal measurements into classical
  bits. Measurements must fill every declared classical bit exactly once and
  may not repeat a quantum wire. The resulting `probability_wires` array is
  ordered by flattened classical-bit index, not textual measurement order.

Only the literal `include "qelib1.inc";` is recognized, once and before gate
operations; it never opens a file. Unsupported includes, custom gate bodies,
reset, classical conditions, measurement followed by a gate, incomplete
classical outputs, or unsupported expressions are rejected with a statement
number. Classical declarations without measurements do not define an output
selector. The engine computes the terminal measurement distribution; it does
not execute a classical program or collapse a mid-circuit state.

`U/u3`, `u2`, `u1`, `sdg`, and `tdg` are decomposed into engine rotations.
Some decompositions differ by a circuit-wide global phase, which does not
change this engine's probabilities or Pauli expectations. Raw amplitudes and
controlled versions of these decompositions are not interchange contracts.

The supported subset is deliberately narrower than the complete language.
See the [OpenQASM standard-library history](https://openqasm.com/language/standard_library.html)
and [IBM's OpenQASM 2 interchange guide](https://quantum.cloud.ibm.com/docs/en/guides/interoperate-qiskit-qasm2).
No Qiskit or PennyLane interoperability run was performed for this delivery.

## Export without silently dropping analysis information

`dump_qasm(manifest)` validates the manifest and exports every engine gate.
SWAP is emitted as three controlled-NOT operations rather than relying on an
extra include-library extension. When `probability_wires` is present, the
export includes terminal measurements that preserve its ordering. Export is
reimported before returning, so source/expanded-gate limits remain enforced.

Pauli observables do not have a representation in this circuit-only subset.
A manifest containing any observables is therefore rejected. For a deliberate
circuit-only export, create a separate copy with `observables: []`; do not
silently overwrite the original analysis manifest. SWAP expansion can change
the gate list and manifest hash even when circuit behavior is equivalent.

## Sampling API and result contract

```python
from qoracle.qasm import load_qasm
from qoracle.shots import sample

manifest = load_qasm('OPENQASM 2.0; qreg q[1]; U(pi,0,0) q[0];')
report = sample(manifest, shots=1000, seed=62)
```

`sample` revalidates its manifest, uses an isolated seeded random generator,
and returns counts, bitstring counts, frequencies, normalized exact
probabilities, total variation from the exact distribution, selected-wire
order, and the normalized manifest hash. It never mutates the input or the
process-global random generator. Counts sum to `shots`; impossible outcomes
remain zero because sampling operates only on positive-probability support.

Shots must be an integer from 1 to 1,000,000; the seed must be an unsigned
64-bit integer. Booleans are not accepted as integers. The default is 1,024
shots with seed 0. For repeatable records, retain the input manifest, seed,
method identifier, Python runtime version and result. No hardware noise,
mid-circuit collapse, or shot-based Pauli expectation estimate is implied.
Bitstrings print the highest outcome bit on the left; the rightmost bit
corresponds to `probability_wires[0]`.

## Acceptance checks

```sh
python3 -m qoracle.interchange_checks
```

Four focused cases cover Bell round-trip/measurement ordering, rotations and
U/SWAP decompositions, unsupported/lossy input rejection, and sampling
repeatability/positive support/no mutation. The two CLIs were also run end to
end with the included example. Invalid or unreadable input reports a readable
error on stderr and exits with status 2.

This is reusable competition-preparation source, not an organizer submission
or score. Existing project ownership, contributor credit and eligible award
rights remain unchanged.
