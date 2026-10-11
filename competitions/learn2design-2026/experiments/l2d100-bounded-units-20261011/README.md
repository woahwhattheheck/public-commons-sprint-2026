# L2D100: bounded physical-space unit-coordinate Adam (original experiment)

Distinct original contribution for FLEET-EOD-20261011-L2D04: optimize in unit coordinates even though the official UIFO design variables have heterogeneous optical physical ranges. **Do not promote to the competition entry until the original Objective reports better actual feasible loss in paired native trials.**

## What changed and why it matters

The real dfbench.Objective exposes public physical bounds (2,n_params) and an evaluation gradient of the total penalized UIFO objective through value_and_grad_aux. The algorithm explicitly calls prepare(obj, unbounded=False) so Objective does NOT apply its normal sigmoid mapping. It constructs a new search coordinate u=(x-lower)/(upper-lower), keeps all proposed u in [1e-6,1-1e-6], and always evaluates x=lower+(upper-lower)*u. Since gradient_x is provided by the real Objective, it applies the **chain rule** gradient_u = (upper-lower)*gradient_x (not the inverse). It then runs unit-coordinate Adam with physical-width invariant per-coordinate update caps, restarts on stale local progress, and retains the original Objective's global feasible history across restarts.

This is a different parameterization, not a fork or patch of the incumbent V1/096/097/099 or Sol's separate five-lane restart work. Physically invalid designs may improve penalized loss and still have no official feasible score. The algorithm reads actual aux["is_feasible"] only for reporting and never changes the organizer's native feasibility/scoring, logging or candidate acceptance. The Objective starts the clock after official warmup and owns all evaluation calls; no raw simulator/private fields/manual logging. Its own last_run_diagnostics is informational only.

The opposite tradeoff is possible: very small dx/du width variation might favor a different preconditioner, and direct normalized steps may hit bounds repeatedly. Only genuine public UIFO testing can choose.

## Official source and conditions

- Official original source: https://github.com/artificial-scientist-lab/Learn2Design-2026/commit/1dc4d6e7d0ff656555f48bcf3c22a4d284779386
- Public Objective contract: https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/docs/dfbench/Objective-API-Reference.md
- Official submission/evaluation: https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/1dc4d6e7d0ff656555f48bcf3c22a4d284779386/docs/submission.md
- Official evaluation: UIFOProblem 10 held-out new topologies, 4 hours each after objective.start_logging(), H100. Score = mean of the best logged physically feasible loss per hidden topology. This *research* PR is not an official submission.
- Original reusable source-native paired runner: run_public_uifo.py Git blob a16a2d62f71c61fcbdfb229d52f47baf9b95b547, stored unchanged in draft https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/693 . Control baseline submission_v1.py blob 95b66925832e5f34c940657f6ca8cc5747b4c0a3. Do not create another local physics oracle.

## Actual focused cloud check

Python syntax compilation completed, followed by **one** 14-call local documented-interface check with installed JAX0.9.0.1. It exercised heterogeneous physical ranges, bounded proposal values, chain-rule execution and Objective logging lifecycle through an interface double. This only checks the integration and NOT actual dfbench optics or performance, since dfbench is unavailable in this Linux image. Code Git blob e261c9cb0ab7b11a2a4b2e753eedee017701f0b1. No Actions or large test sweep.

## Native Muse comparison, EXACT runner and physics

Request MUSE-L2D100-T22-S41-600-20261011 in original #sim-data. On **one** original equipped dfbench==0.3.3, JAX==0.9.0.1 GPU runtime with the real upstream UIFO Objective:

- Public development topology topology_seed=22, optimizer random_seed=41, default size=3, n_frequencies=50, **600 Objective seconds per arm**, 2400 seconds overall max for the pair; run order V1 then L2D100.
- Use **the exact unchanged accepted runner** and same environment, batch/Objective settings, seeds and hardware for both arms. From an original PR693 checkout directory containing run_public_uifo.py and submission_v1.py, copy the exact current submission100.py into the run directory or refer to its absolute path, then:

    JAX_ENABLE_X64=true python run_public_uifo.py --candidate submission_v1.py --topology-seed 22 --algorithm-seed 41 --seconds 600 --out results-l2d100-t22-s41/v1.json

    JAX_ENABLE_X64=true python run_public_uifo.py --candidate submission100.py --topology-seed 22 --algorithm-seed 41 --seconds 600 --out results-l2d100-t22-s41/100.json

- Preserve BOTH original raw loss/time histories and Objective feasibility flags, source hashes, exact runtime/hardware, actual eval counts, best feasible loss, wall-time including warmup and any errors/partials. This is a **new** public-seed development comparison, NOT hidden/private benchmark score; do not claim success before native results.

If unit scaling helps on real optics, expand the matched conditions and compare vs 096 / best official eligible incumbent before replacing a last-submission competition artifact. Do not run a second duplicate request for the same original Muse job.
