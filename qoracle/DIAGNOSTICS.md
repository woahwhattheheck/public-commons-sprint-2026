# Variational and subsystem diagnostics

These offline, Python-standard-library tools reuse QOracle's existing gate and
Pauli implementation. They do not add a model dependency or call a provider.
They are solver capabilities, not evidence of contest registration or a score.
The repository's existing license applies to this extension.

## Rotation derivatives

Save this as `rotation.json`:

```json
{"schema":1,"qubits":2,"gates":[{"op":"RY","wire":0,"theta":0.4},{"op":"CNOT","control":0,"target":1}],"observables":["XX","ZZ"]}
```

```bash
python3 -m qoracle.cli gradient rotation.json --gates 0
```

The `expectation_derivatives` are `XX = cos(0.4)` and `ZZ = 0`, within
floating-point error. The report identifies the original normalized manifest,
zero-based gate index, operation, wire, angle, rule and shifted-evaluation count.
Omitting `--gates` selects every RX/RY/RZ occurrence, up to 32. At least one
observable and one rotation are required; duplicate, nonrotation and invalid
indices fail with a diagnostic and CLI exit code 2. Requested order is retained.

For each selected occurrence, all other gates stay fixed and the rule is

```
d f / d theta = (f(theta + pi/2) - f(theta - pi/2)) / 2
```

This is the two-term Pauli-rotation parameter-shift rule, not finite differences.
See the [PennyLane rotation recipe](https://docs.pennylane.ai/en/stable/code/api/pennylane.RZ.html)
and [parameter-shift documentation](https://docs.pennylane.ai/en/stable/code/api/pennylane.gradients.param_shift.html).
It does not differentiate arbitrary controlled rotations, input states, noise
parameters, purity, or classical postprocessing.

A repeated angle value is **not** automatically a shared symbolic parameter.
If a model parameter controls several occurrences, sum their derivatives with
the appropriate chain-rule coefficients. For `RY(theta); RY(theta)` and `Z`,
each column is `-sin(2*theta)`; their sum is `-2*sin(2*theta)`.

The unshifted prefix is evolved once across requested gates. Each selected gate
needs two suffix evaluations; no unnecessary full-prefix simulation is repeated.
An extra commuting rotation is applied after the original gate, rather than
adding pi/2 numerically to its stored angle. This preserves the shift even when
a large finite angle would round `theta + pi/2` back to `theta`. Trigonometric
accuracy still depends on Python floating-point math. No input is mutated.

## Reduced density matrix and purity

```bash
python3 -m qoracle.cli reduced-state qoracle/examples/bell.json --wires 0
```

The Bell-state marginal is approximately `[[0.5, 0], [0, 0.5]]`, trace 1,
purity 0.5. Retaining both Bell wires gives a pure state with purity 1.
The complex matrix uses `[real, imaginary]` pairs, so the marginal is encoded as
`[[[0.5,0],[0,0]],[[0,0],[0.5,0]]]` up to numerical rounding.

For retained basis states `a,b` and traced-out basis `e`, the implementation uses
`rho[a,b] = sum_e psi[a,e] * conjugate(psi[b,e])`. Purity is
`Tr(rho*rho) = sum_ab abs(rho[a,b])**2`. The report includes ordered retained
wires, traced-out wires, diagonal probabilities and the original manifest hash.
See [density matrices](https://docs.pennylane.ai/en/stable/code/api/pennylane.density_matrix.html)
and [purity](https://docs.pennylane.ai/en/stable/code/api/pennylane.purity.html)
for the mathematical quantities; adapt framework basis ordering explicitly.

**Output bit j is `--wires[j]`.** For a register with only wire 0 flipped,
selection `--wires 1 0` has population at index 2, while `--wires 0 1` has
population at index 1. This agrees with QOracle's existing `probability_wires`
convention. A manifest's `probability_wires` does not restrict the state being
traced; `--wires` independently selects the requested subsystem.

The total register remains limited to 10 qubits. Retain 1 to 6 distinct wires:
at most 4096 complex matrix entries. No full-register density matrix is allocated
first. Trace and purity are returned without artificial renormalization; expect
last-bit error (including purity slightly above 1). This computes a subsystem of
the pure, unitary circuit, not noisy evolution, measurement collapse, or entropy.

## Library API and focused checks

```python
from qoracle.diagnostics import expectation_gradients, reduced_state
from qoracle.engine import load_manifest

circuit = load_manifest(open("rotation.json", encoding="utf-8").read())
gradient = expectation_gradients(circuit, [0])
subsystem = reduced_state(circuit, [0])
```

Both functions validate and normalize a copy of the manifest. `simulate` and
`verify` keep their existing outputs, hashes and error behavior. Direct CLI
execution (`python3 qoracle/cli.py ...`) is also supported.

```bash
python3 -m unittest qoracle.test_diagnostics -v
```

Six focused checks cover RX/RY/RZ analytic derivatives; entanglement, repeated
parameters and large-angle shifting; Bell and complex pure-state matrices;
selected-wire ordering; invalid requests and limits; module/direct CLI plus
legacy verification. No hardware, PennyLane or contest backend was exercised.
