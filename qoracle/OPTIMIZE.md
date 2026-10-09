# Local variational energy solver

`qoracle.optimize` uses the existing rotation-gradient API to minimize a real
weighted sum of Pauli expectations. It runs offline with the Python standard
library and produces an optimized circuit that the existing simulator can read.
It is a local solver, not an entry, hardware result or leaderboard score.

## Run the working two-qubit example

```bash
python3 -m qoracle.optimize qoracle/examples/vqe_two_qubit.json > result.json
python3 - <<'PY'
import json
from qoracle.engine import simulate
result = json.load(open('result.json'))
print(result['initial_energy'], '->', result['final_energy'])
print(result['stop_reason'], result['iterations'])
print(simulate(result['optimized_manifest'])['expectations'])
PY
```

The checked-in problem uses `RY(theta)` on wire 0 followed by `CNOT(0,1)` and
minimizes `H = 0.7 ZI + 0.6 XX`. Its energy is
`0.7*cos(theta) + 0.6*sin(theta)`, whose analytical minimum is
`-sqrt(0.7**2 + 0.6**2) = -0.9219544457292888`.

An actual cloud-container run on Python 3.13.5 started at theta 1.7 and produced:

```text
initial_energy:                 0.504807740264614
final_energy:                  -0.9219544457292888
accepted iterations:            9
stop_reason:                    gradient_tolerance
objective evaluations:         10
shifted circuit evaluations:   20
```

This example's floating-point result matches its analytically known energy.
It is not a guarantee that arbitrary ansatzes reach an unknown ground state.

## Problem format

Required keys are `schema: 1`, `circuit` (an ordinary QOracle manifest) and
`terms` (a dictionary from IXYZ strings to finite real coefficients).
Pauli character k acts on wire k, preserving QOracle's little-endian convention.
Optional controls are:

- `gate_indices`: distinct zero-based RX/RY/RZ occurrences to vary; defaults to
  all rotations, at most 32. Unselected angles remain fixed.
- `max_steps`: accepted-step budget from 0 to 200; default 80. Zero evaluates
  only the initial objective and makes no gradient calls.
- `initial_step`: maximum trial step in `(0, pi]`, default 1.0. The descent
  direction is normalized when its norm exceeds 1, bounding angle updates.
- `gradient_tolerance`: nonnegative absolute gradient-norm tolerance; default
  `1e-7` in the objective's coefficient units.

The input is not mutated. The returned `optimized_manifest` has its observables
set to the objective terms, not the original display-only observable list.
`initial_manifest_sha256` identifies the normalized *original* input circuit.
The original `probability_wires`, when present, affects simulation probabilities
but not the objective, which uses full-register Pauli expectations.

Each selected gate occurrence is independent. Repeating the same numeric angle
does not tie parameters together. A symbolic/shared-parameter ansatz needs its
own parameter mapping and chain rule rather than this independent-angle API.

## Method and interpretation

Each iteration obtains analytic two-term parameter-shift derivatives from
`expectation_gradients`. It descends along the objective gradient and tries at
most 12 successive half-steps, requiring both a strict energy decrease and an
Armijo sufficient-decrease condition. Only accepted improvements replace the
current circuit. Coefficients or gradients that overflow raise a diagnostic;
rescale such objectives rather than interpreting a nonfinite answer.

The result contains the initial and final energies, energy/step history, accepted
iteration count, both evaluation counters, and the optimized manifest.
`last_gradient` binds its norm to a specific iteration and energy: after a step
budget is reached it need not describe the final, subsequently accepted point.

Stop reasons:

- `gradient_tolerance`: the current gradient meets the requested tolerance.
- `max_steps`: the requested budget was exhausted, including a zero-step run.
- `line_search_exhausted`: no acceptable improvement was found in 12 proposals.

**Stationarity does not certify a minimum.** For `RY(0)` with objective `Z`,
the zero gradient occurs at energy +1, a maximum, while the ground energy is -1.
Use different initial angles/ansatzes and independent bounds or exact small-system
references for a real optimization task. Rounding can also exhaust a line search
near a minimum; energy, history and stop reason remain visible.

CLI exit 0 means a valid optimization result was produced, not that an unknown
optimum was proven. Invalid files, JSON, manifests or options return exit 2 with
a diagnostic. `python3 qoracle/optimize.py ...` also works.

## Library API and focused validation

```python
from qoracle.optimize import minimize_energy
result = minimize_energy(circuit, {'ZI': 0.7, 'XX': 0.6}, [0], max_steps=80)
```

```bash
python3 -m unittest qoracle.test_optimize -v
```

Four focused checks passed: the analytical two-qubit energy and monotone history;
frozen gates, zero/one-step budgets and nonmutation; the stationary-maximum caveat
and invalid inputs; runnable CLI example and duplicate-key rejection. No broad
suite, hardware execution, noisy evolution, live provider or contest submission.
The repository's existing license applies to this extension.
