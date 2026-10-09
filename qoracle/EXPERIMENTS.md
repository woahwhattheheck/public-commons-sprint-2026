# QOracle experiment commands

Three additive commands reuse the existing statevector engine without changing
`engine.py`, the existing CLI, or the gradient/reduced-state workstream.
Python 3.10+ and its standard library are sufficient. All outcomes are locally
simulated numerical results; these files do not register or submit an entry.

## Whole-circuit equivalence

```sh
python -m qoracle.equivalence \
  qoracle/examples/experiments/z.json \
  qoracle/examples/experiments/minus-z.json
```

This compares every computational-basis column of both circuit operators,
using **one common global phase** anchored to their first column. The example
matches with phase `-1`: `X Z X = -Z`. In contrast, identity versus `Z` fails,
even though both produce the same computational-basis probabilities for each
basis input. Allowing a separate phase for every column would miss that error.

Exit statuses are 0 for MATCH, 1 for MISMATCH, and 2 for an input, budget, or
file error. The receipt includes input hashes, shared phase, checked columns,
first residual above tolerance, maximum column residual, and Frobenius residual.
Observables and `probability_wires` do not affect the circuit operator, but remain
included in each input manifest's hash.

`--tolerance` defaults to `1e-8` and means L2 error per column. A successful
comparison implies an operator-norm difference no greater than the reported
Frobenius residual, subject to floating-point rounding. It is numerical evidence,
not a symbolic proof or a calibrated guarantee at a different norm threshold.
The phase is anchored rather than globally optimized for approximately matching
circuits. Use the returned phase explicitly when composing a controlled operator:
a phase that is global for a standalone operation can become relative when
that operation is controlled.

The default work-admission limit is 50,000,000 estimated amplitude visits;
`--max-work` may explicitly raise or lower it. This estimates work before
execution; it is not a wall-clock deadline. State memory is O(2^n), and work is
O(4^n times gate count). No full matrix or cloud service is allocated.

## Finite-shot measurements

```sh
python -m qoracle.measurements \
  qoracle/examples/experiments/bell-shots.json --shots 2048 --seed 42
```

The shot count is **per measurement setting**. This example uses Z, X and Y
settings, so 2,048 shots means 6,144 total samples, explicitly stated in the
receipt. Z/I observables share the computational sample. Other observables are
greedily placed into qubit-wise-compatible settings, so compatible terms reuse
one sampled bitstring histogram. The grouping is deterministic, not guaranteed
minimal. Merely globally commuting terms with incompatible local bases are not
combined.

For the Bell example, XX and ZZ give +1, YY gives -1, and the ZI/IZ estimates
are exactly correlated. The receipt contains each setting's counts, each Pauli
mean and plus/minus counts, and its exact statevector expectation for comparison.
`probability_wires` applies to the computational counts and probabilities;
Pauli estimates still refer to the whole register.

Basis-string character 0 is wire 0. Histogram index bit k is wire k. For
selected-wire histograms, index bit j is `probability_wires[j]`. This retains
the existing little-endian convention and ordered marginal selection.

Pauli Y is measured by applying RZ(-pi/2), followed by H, before computational
measurement. RZ(-pi/2) equals S-dagger up to global phase. A fixed seed and
identical input produce reproducible simulation counts using Python's
`random.Random`; this is not a source of hardware randomness.

Approximate 95% Wilson score intervals are computed for the +1 probability and
mapped into Pauli-mean coordinates using `2p - 1`. They are **per observable**,
not simultaneous coverage guarantees. Terms measured in the same setting are
correlated. Observing only +1 outcomes does not collapse the interval to zero
width. The identity operator is the exception because it is mathematically 1.

Limits: up to 1,000,000 shots per setting and 2,000,000 total by default.
`--max-total-shots` explicitly changes the latter. Oversized requests fail
before sampling. No network calls, provider credentials or installations are
needed.

## Weighted-energy objectives

```sh
python -m qoracle.energy \
  qoracle/examples/experiments/bell-shots.json \
  qoracle/examples/experiments/bell-energy.json --shots 2048 --seed 42
```

The coefficients file maps whole-register Pauli strings to real weights. This
example estimates `-XX + YY - ZZ`, giving -3 on the Bell state. Up to 64 terms
are supported, each with finite magnitude at most 1e12. Terms replace the input
manifest's observable list for sampling, while the original input and objective
are both separately hashed. Zero-weight terms are omitted from measurements.
The existing computational-Z histogram remains part of the sampling plan.

The returned mean is the sum of weighted setting means. Its empirical standard
error is computed from each setting's **whole weighted per-shot outcome**, so
covariances are retained. On the Bell state, `ZI - IZ` cancels shot by shot;
adding the separate variances as if the two measurements were independent
would produce the wrong standard error. Conversely, `ZI + IZ` has twice the
single-term standard error, not sqrt(2) times it.

The standard error is an estimate, **not a confidence interval**. Zero observed
variance does not establish zero sampling uncertainty. Nonconstant settings with
only one shot return null variance instead of inventing an estimate. Mathematically
constant settings, including a pure identity objective, have zero variance.

## Recovery execution

The actual equivalence, measurement and weighted-energy commands above were run against current unchanged engine source. Identity versus Z returned MISMATCH (exit 1); Z versus minus-Z returned MATCH (exit 0). Bell measurements used 2,048 shots in each of three settings and energy was -3. The original focused test supplement remains preserved with the donor and is not installed by this recovery.

## Technical references

- IBM Quantum, global versus relative phase:
  https://quantum.cloud.ibm.com/learning/en/courses/basics-of-quantum-information/quantum-circuits/limitations-on-quantum-information
- IBM Quantum, Pauli-basis measurement transformations:
  https://quantum.cloud.ibm.com/docs/en/guides/specify-observables-pauli
- NIST Dataplot, Wilson score confidence-limit equations and terminology:
  https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/agrecoul.htm

The source owner and original repository license are preserved. No existing
source attribution is replaced.
