# Noisy-circuit oracle

This optional, standard-library-only extension solves three additional circuit
checking tasks: density-matrix evolution with explicit local noise, reproducible
computational-basis shot sampling, and manifest-bound comparison of another
implementation's probabilities and Pauli expectations. Existing pure-state
commands and manifest hashes are unchanged.

## Run

From the repository root:

```sh
python -m qoracle.noise simulate qoracle/examples/bell.amplitude-noise.json
python -m qoracle.noise verify qoracle/examples/bell.amplitude-noise.json qoracle/examples/bell.amplitude-noise.candidate.json
```

The first command prints a result; the second prints `MATCH` or `MISMATCH`.
Exit status is 0 for simulation/match, 1 for mismatch, and 2 for invalid input
or an unreadable file. Output goes only to stdout; neither command overwrites
source files, fetches a service, submits a competition entry, or uses hardware.

## Manifest

The outer object has `schema: 1`, a `circuit` containing the existing QOracle
manifest, an optional `noise` list, and optional `sampling` with **both** a
positive `shots` count and a nonnegative integer `seed`.

Each noise event has exactly four fields:

```json
{"after_gate": 2, "channel": "AMPLITUDE_DAMPING", "wire": 0, "p": 0.4}
```

`after_gate` is a **count of completed gates**, not a zero-based gate index:
0 means before the first gate, 1 means after the first, and the gate count
means after the last. Events at different boundaries are sorted into execution
order. Events at the same boundary retain their input order, because channels
need not commute. There is no implicit noise after unspecified gates.

The register begins in the all-zero state. Supported gates and little-endian
wire conventions are exactly those of `engine.py`. `probability_wires` still
selects an ordered marginal: output index bit j corresponds to selected wire j.
The returned Pauli expectations are exact density-matrix expectations, not
estimates from the optional computational-basis samples. In particular, those
samples do not measure X or Y observables.

## Channel definitions

All probabilities must be finite and between 0 and 1. These definitions match
the mathematical channel conventions documented by PennyLane; PennyLane is
neither installed nor invoked by this implementation.

| Channel | Action on one-wire block `[[a,b],[c,d]]` |
| --- | --- |
| `AMPLITUDE_DAMPING` | `[[a+p*d, sqrt(1-p)*b], [sqrt(1-p)*c, (1-p)*d]]` |
| `PHASE_DAMPING` | `[[a, sqrt(1-p)*b], [sqrt(1-p)*c, d]]` |
| `DEPOLARIZING` | `(1-p)*rho + (p/3)*(X*rho*X + Y*rho*Y + Z*rho*Z)` |

The blocks include all spectator row/column indices, so channels also work on
entangled registers. For depolarization, **p = 3/4** completely mixes the selected
qubit; **p = 1** is a uniform Pauli-error channel, not complete mixing.

Primary definition references, checked October 9, 2026:
- https://docs.pennylane.ai/en/stable/code/api/pennylane.AmplitudeDamping.html
- https://docs.pennylane.ai/en/stable/code/api/pennylane.PhaseDamping.html
- https://docs.pennylane.ai/en/stable/code/api/pennylane.DepolarizingChannel.html

## Analytical example

The example prepares a Bell pair and damps wire 0 with p = 0.4. For selected
wires `[1,0]`, probabilities are `[0.5, 0.2, 0, 0.3]`; `XX = sqrt(0.6)`,
`YY = -sqrt(0.6)`, `ZZ = 0.6`, `ZI = 0.4`, and `IZ = 0`. Purity is 0.68.
The candidate JSON records these analytical values rather than copying sampled
frequencies. Ordinary floating-point roundoff is handled by its tolerance.

## Sampling and verification

Sampling uses a local `random.Random(seed)` instance and inverse-CDF sampling.
It leaves global random state untouched, preserves impossible outcomes at zero
count, and reports the seed, requested shots, counts and frequencies. Repeated
runs on the same Python runtime and inputs reproduce the counts. Cross-runtime
bitwise sample equivalence and cryptographic randomness are not promised.

The verifier requires a compact candidate object with `schema`, the normalized
outer `manifest_sha256`, `probabilities`, `expectations`, and optionally
`tolerance` in `[0, 0.01]`. Noise placement, same-boundary order, channel
parameters, wire selection, sampling settings and circuit parameters are bound
by that hash. Use the hash printed by the simulator for the intended manifest;
a different hash is a mismatch even when some numerical outputs happen to match.

Tolerance bounds the maximum absolute probability/expectation error.
Normalization is checked separately against `max(tolerance, 1e-8)`. The receipt
also reports L1 probability error. This is a deterministic-output comparison,
not a hypothesis test of finite-shot frequencies. Sampling fluctuations should
not be submitted as exact probabilities.

## Limits and validation

The noisy path supports 1–6 qubits, up to 512 gates, 512 local noise events,
100,000 shots, and 1 MiB of UTF-8 input. Its time is proportional to
`(gates + noise events) * 4**qubits`; state storage is `4**qubits` complex
entries. The existing pure-state path retains its own larger limits.

Finite entries, unit trace, Hermiticity, populations and the physical purity
range are checked. Those diagnostics are not an independent eigenvalue-based
positive-semidefinite proof. No arbitrary initial density matrices or arbitrary
Kraus operators are accepted. Noise is independent, local and Markovian;
correlated noise, readout error, conditional feed-forward and hardware
calibration are outside this model.

One focused command exercises four contracts: analytical channel values;
entangled evolution, event order and all existing gate kinds versus the
statevector kernel; seeded samples plus manifest-bound verifier/CLI status;
and malformed-input handling.

```sh
python -m qoracle.noise_regress -v
```

Initial validation used the byte-verified existing engine Git blob
`1db094e5e068aa36a0e0cec2c91b206b12663a09`. This extension does not modify
`engine.py`, `cli.py`, or the concurrent gradient/reduced-state extension.
