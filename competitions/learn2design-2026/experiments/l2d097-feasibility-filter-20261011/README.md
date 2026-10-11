# L2D097: physical-feasibility-filtered trust steps

**Independent experimental optimizer, October 11, 2026.** Unlike the incumbent V1 / 096 that follows a penalized-loss Adam proposal even when it crosses a physical constraint, and unlike Sol's PR693 multi-lane restart / noise-free polishing experiment, candidate **097** explicitly accepts a proposed step into the *current feasible basin* only if the real `dfbench.Objective` reports `is_feasible=True` **and** the evaluated loss improves. An infeasible or nonimproving trial is kept in Objective's genuine history but cannot evict the feasible anchor. Backtracking reduces the trust radius and optionally rotates the step; ten consecutive rejections or exhausted radius exit that basin and resume fresh global exploration. The best feasible observation is retained across restarts. An unfeasible `RESTORE` phase follows real penalized-loss gradients solely to find a first physically feasible point; it never treats a low penalized loss as physically feasible.

This is a new *acceptance-geometry* hypothesis, not a new simulator or proof/verification product. `submission097.py` defines exactly one `OptimizationAlgorithm` subclass with explicit no-argument initialization, uses only public Objective attributes/methods, `prepare(unbounded=True)`, public `random_params_unbounded()`, the official `warmup_value_and_grad_aux()` / `value_and_grad_aux()` for constrained UIFO, and `start_logging()` before any scored call. No manual log writes, private Objective access, network, secret, wallet, remote model, Actions, or hidden-topology dependence. All official feasibility history, scoring and wall-clock budget remain owned by the organizer's Objective. It uses JAX only, with no extra optimization runtime beyond the accepted baseline.

## Why this could outperform the incumbent

Optical designs near the real power/constraint boundary may have a useful feasible basin narrower than V1's noisy unconstrained step. A rejected step with a lower *penalized* loss can still be physically invalid and provide no score. A bounded trust filter can exploit real feasible gradients without marching into infeasible geometry. The countervailing risk is early commitment to mediocre feasible basins and expensive repeated rejected evaluations. The algorithm therefore retains a genuine global feasible best, leaves stalled basins, tries independently sampled basins, and stops predictively before an unlogged final evaluation. Neither improvement nor efficiency is claimed without a real paired physics run.

## Source and evaluation contract

- Official Learn2Design source: `artificial-scientist-lab/Learn2Design-2026` commit `84a4b0a4c7e0f3b702459ffc8ba6a1d84d34cefa`, source/rules as published to internal Canvas `F0C8A2ANCNA`.
- Existing genuine V1 control and original accepted runner are preserved unchanged in Sol **draft** PR [#693](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/693), `submission_v1.py` git blob `95b66925832e5f34c940657f6ca8cc5747b4c0a3`, `run_public_uifo.py` blob `a16a2d62f71c61fcbdfb229d52f47baf9b95b547`, and their source manifest. One incumbent run reported loss `5.046134788581744` on public topology0, seed42, 60s; this is **not** evidence for 097.
- Compatible runtime requested: the existing Muse dfbench 0.3.3 + JAX 0.9.0.1 accepted equipped GPU environment. The generic Python/CUDA environment here is **not** used to manufacture an optical score.
- No modification to the actual participant entry, existing submission slots, hidden sets, current champions, or existing raw Muse results.

### Official-public UIFO matched run request (a NEW condition)

**Operation:** `MUSE-L2D097-T16-S42-300-20261011`

Public topology_seed **16**, algorithm seed **42**, Objective `max_time=300` seconds **per arm**; run V1 control, then 097, under a 1,800-second outer cap on the existing authorized equipped Muse GPU. This is distinct from Sol T15/S42/300, existing 094 topologies 1–6, and 096 topologies 13–15/S73/900. Read exact pinned source into the original accepted runner, with new output files, no overwrite:

```sh
JAX_ENABLE_X64=true python run_public_uifo.py --candidate submission_v1.py --topology-seed 16 --algorithm-seed 42 --seconds 300 --out results-l2d097-t16-s42/v1.json
JAX_ENABLE_X64=true python run_public_uifo.py --candidate submission097.py --topology-seed 16 --algorithm-seed 42 --seconds 300 --out results-l2d097-t16-s42/097.json
```

Use actual numerical `Objective.loss_history`, `is_feasible_history`, `time_steps`, the official `best_feasible_loss`, timing, post-warmup evaluation count, GPU and package versions, errors and exact content hashes for **both** runs. Lower objective loss is better among physically feasible designs. Compare paired best feasible loss, number of feasible evaluations, early feasible discovery and time within budget. One cell alone does not establish mean hidden-topology gain. For a promising initial result, expand to additional **unclaimed** topology/seed pairs and longer matched budgets; only the original submission owner promotes after repeated real wins. If 097 loses, keep incumbent V1/096 and retain the loss as useful algorithm-selection evidence.

## Validation

The authoring cloud performed a focused Python bytecode check and a minimal actual JAX/Objective-interface *logic* invocation if a local stub is available; those checks **do not** substitute for the official physics runner or make a simulation result. Real physics acceptance and score remain in the existing Muse allocation. The candidate is a separate draft until measured.

MIT. No new hosted CI or Actions.
