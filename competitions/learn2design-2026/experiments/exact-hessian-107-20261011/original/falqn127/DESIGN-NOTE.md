### FALQN127: design note

This is source only and unmeasured. Credit: TokenJunkieLabs/Bryce.

#### Distinct mechanism (one sentence)

After the first logged feasible point, take one L-BFGS trust trial per logged call from a base that is always a logged feasible point, and let curvature memory learn only from pairs whose two endpoints are both finite logged feasible points. Under the default penalty, those are secants of the sensitivity loss alone.

#### Behaviour choices and their justification

| Situation | Choice | Evidence or source |
|---|---|---|
| No feasible point yet | FARA122's SEEK path unchanged: same starts, RNG order, Adam, trust, noise and duplicate guard | FARA reached first feasibility at calls 4/20/28 vs 096's 5/74/44 (measured). Keeping this path makes the prefix comparable to FARA v12. |
| Feasible and improving trial | Move the base, store the pair if s·y > ε‖s‖‖y‖, grow the radius only on an Armijo-satisfying full step | FARA T7 calls 57–78 show productive smooth feasible descent (measured) |
| Feasible but non-improving | Keep the pair, keep the base, shrink the radius | The pair is valid curvature information. Not moving the base avoids FARA-T8's case of many feasible but non-improving calls. |
| Infeasible, non-finite or unknown aux | Never store the pair. Reuse the cached base with no extra call. Shrink the radius. Memory survives because its pairs remain valid. | SPG120 T8/T9 (penalized steps drifting), FARA T9 calls 61–62 (lower-loss infeasible points) |
| Poor model (non-descent or non-finite direction) | Clear memory and take a steepest step scaled to the radius | Standard safeguard |
| Exact repeat of a recent vector | Skip without a call and count it as a rejection | SPG120 T7 repeated evaluations at calls 47/49 and 48/50; T8 alternation over calls 74–97 |
| Radius below its floor | Clear memory and reset the radius, at most 2 times without improvement; then the episode is stationary | Bounded: at most (2+1)×⌈log₂(0.8/0.01)⌉+3 ≈ 24 non-improving calls per episode |
| After stationarity | Next 096/FARA start (start k); later, incumbent plus noise, as in FARA | Leaving happens only on local stationarity, never because of infeasibility. FARA T9 left on infeasibility exhaustion and never regained feasibility. |

#### Differences from earlier candidates

- **101 (`BudgetLBFGS100`).** 101 uses up to 6 calls per iteration with Armijo backtracking and cubic/quadratic interpolation. It stores pairs from any finite endpoints regardless of feasibility, screens starts with a batched `vmap`, and runs a kick/fresh/recover portfolio with an infeasible-streak trigger of 40. FALQN127 has none of these. It uses one trial per call, a feasibility-gated memory, a base that is never infeasible, no batching and no kicks.
- **126 (FFR130).** FFR130 admits infeasible trials through a filter over (penalty_sum, sensitivity_loss), bisects toward the last admitted point (which may be infeasible), and alternates explore/polish episodes on a fixed parity. FALQN127 never admits an infeasible point as its base and keeps no filter. It leaves the incumbent only on certified stationarity.
  - Honest overlap: one rejected trial followed by a radius contraction under an unchanged model gives a shorter step along the same ray, which is geometrically similar to a single bisection. The difference is that the radius persists across iterations as a trust region, and the direction is recomputed from the feasible-only model.
- **125 / FARA122.** FALQN127 has no donor bank and no fixed R=6/P=4 anchor-gradient probes. Recovery from infeasibility is implicit and free, because every trial starts from the feasible base.
- **SPG120.** SPG120 accepted penalized GLL steps whose endpoints could be infeasible, with BB curvature taken from any pair. FALQN127 does neither.

#### Parameters

| Parameter | Default | Status |
|---|---|---|
| learning_rate, restarts, restart_patience, trust radii (0.30/0.01/0.80), noise (0.10, 0.997), stop_margin, return_reserve | 096/FARA values | Inherited. Not calibrated for H100 or 4 hours. |
| memory m | 8 | Uncalibrated (same value as 101's default) |
| curvature_eps | 1e-8 | Uncalibrated |
| qn_radius / min / max | 0.30 / 0.01 / 0.80 | Reuses 096 trust values. Uncalibrated for QN. |
| qn_grow / qn_shrink | 2.0 / 0.5 | Uncalibrated |
| armijo_c1 | 1e-4 | Uncalibrated (conventional value) |
| qn_max_resets | 2 | Uncalibrated |
| qn_patience / improve_rtol | 220 / 1e-9 | Patience mirrors 096; rtol is uncalibrated |

None of these values was derived from the traces. The traces contain no parameter vectors, so step-size scales cannot be fitted from them.

#### Cost and memory

- **Calls.** Exactly one logged `value_and_grad_aux` per evaluating iteration, falling back to `value_and_grad` without the penalty contract. Repeat skips and the base restoration make no call.
- **CPU per QN iteration.** O(mn): the two-loop costs about 4mn flops plus O(n) updates. With m=8 and n≈200 this is negligible next to a measured T4 call of about 1.75–1.95 s.
- **State.**
  - 2m vectors for pairs.
  - About 8 vectors for base, trial, incumbent x/g, and Adam m/v.
  - Starts: at most 16 vectors.
  - FARA's 64-entry byte ring: 64×8n bytes.
  - Total at n=200 is about (16 + 8 + 16)·8n + 64·8n ≈ 166 KB, all O(mn). No matrices.

#### Official API integration

1. `prepare(unbounded=True)` and `random_params_unbounded` × restarts.
2. `warmup_value_and_grad_aux` (or `warmup_value_and_grad`) before `start_logging()`.
3. After logging starts: only public `value_and_grad_aux` / `value_and_grad`, plus the public budget fields `budget_exceeded`, `time_left` and `evals_left`.
4. Only `aux['is_feasible']` is read.
5. The penalty, space mapping, bounds and frequencies are never changed. There are no private members, raw callables or manual logging.

#### Owner-run panel plan (not run; this arm only)

**Run plan.**
- Public T7/T8/T9, algorithm seed 42, 180 s Objectives, existing T4 runner `c0306334…08`, NumPy 2.1.3 runtime.
- Reuse the v10 096 rows (`18d39e9f…87`: 5.058707 / 4.977320 / 4.972152) and the v12 FARA rows (`6fed11db…49`: 4.677039 / 5.266267 / 5.142631), but only after confirming the source, runner and runtime match.
- Do not rerun controls. Do not count FFR130 v13 until a completed, source-matched receipt exists, including resolution of its `source_matches_request: false` flag.

**Pre-declared checks.**
1. **Prefix comparability.** Up to and including the first feasible call, each cell should track FARA v12 (first feasible at calls 4/20/28). Small numeric drift is expected (see §0.3). A large early divergence before the first feasible call is a mechanism bug.
2. **Gate working.** In diagnostics, `pair_status.infeasible_endpoint > 0` should hold wherever infeasible trials occurred, and every stored pair should come from feasible endpoints by construction.
3. **The hypothesis is falsified for this panel if any of the following holds:**
   - the best-feasible loss is not below FARA on T8 or T9 and not below 096 on at least 2 of 3 topologies;
   - post-first-feasible feasibility retention (the share of QN trials that are feasible) collapses;
   - the restarts after stationarity in a 180 s budget (untested territory, since 096 never restarts at 180 s) produce a FARA-T9-style infeasible tail that costs the final result.
4. **Harm check.** Regressions against FARA on T7 count against the candidate.

Three cells cannot establish four-hour or H100 behaviour. A positive panel would justify only a larger matched panel, not promotion.

---
