# Budgeted restart candidate — October 11, 2026

This separate development candidate explores whether more reliable access to
multiple basins and a quiet finishing phase improve Learn2Design feasible loss.
It retains the V1/096 Adam update, unbounded Objective parameter mapping and
trust grow/shrink constants. Independent optimizer states rotate in 16-call
slices during the first 60% of the tightest active Objective budget. The final
40% starts at the exact saved coordinates of the best Objective-reported feasible
point with finite coordinates and derivative, with fresh Adam state, learning rate 0.02, initial trust radius 0.08 and no
Gaussian noise. The two changes are tested together in this candidate; any result
cannot attribute their effects individually. All comparisons use lower loss as
better, the organizer's Objective and its original feasibility/scoring contract.

The feasible and raw incumbents are separate. A lower infeasible penalized loss
cannot replace the feasible coordinates. With no feasible incumbent, polishing
starts from the best derivative-eligible finite raw observation and remains explicitly unproven
feasible. With no eligible anchor it samples a fresh point. Nonfinite gradients
trigger lane recovery and evict matching saved anchors. Their scored finite-loss
observations remain in Objective history. Nonfinite proposals trigger recovery.
Stalled exploration lanes
get a fresh Objective random sample; stalled polishing returns to the current
incumbent. The candidate continues until Objective budget or the retained 096
predictive stop, rather than stopping after the initial five restarts.

This is single-point execution; no batch-width or device-memory change. The
candidate uses documented `value_and_grad_aux` and its matching warmup so it can
read physical feasibility, rather than treating penalized loss as a score. The
096 control uses its unchanged original evaluation method. The aux path can
alter runtime; the first matched experiment measures that cost as part of the
same Objective budget. Short budgets may expire before all starts are visited;
inspect `lane_calls` rather than assuming coverage. Noise decay is per lane,
and state/moments/iteration resume independently when a lane is revisited.

## Evidence retained

Source packet F0C8CDSQQ10 contains exact 096, V1, core and accepted runner bytes.
`SOURCE-MANIFEST.json` records their hashes; they are unchanged here. The official
API/scoring source packet F0C8A2ANCNA is pinned to organizer commit
84a4b0a4c7e0f3b702459ffc8ba6a1d84d34cefa. Official target is a mean best feasible
loss over ten hidden topologies, 14,400 Objective seconds each, H100 hardware.
The final deadline is October 16, 2026 at 11:59:59 UTC (October 15 AoE).

Existing 096 topologies7–9 / seed42 / 180s T4 pairs favor096 two wins to one,
mean paired loss delta −0.13077615544274726; the source packet documents GPU
nondeterminism and the three-pair sample limit. None is an official score or
evidence for this new source. Those accepted experiments are not rerun here.
V1,094,096, original history and original submission/claim linkage are retained.

One focused `python -B check_scheduler.py` invocation passed before the following
static-review repair on this source's
control flow with explicit NumPy API doubles: lane-state counts resume 1..12,
all five starts are visited in that mocked budget, exact feasible coordinates
anchor polishing despite a lower infeasible raw loss, phase change is 60%, and
predictive stop occurs after 99/100 allowed calls. This is neither real optax/JAX
validation nor optical physics. Static review then identified an invalid-gradient
anchor retry loop; the source now requires derivative eligibility for anchors,
evicts subsequently invalid anchors, samples fresh when no eligible anchor
exists, and repeats the budget safeguard immediately before each evaluation
after lane selection. The focused execution was not repeated after this repair.
JAX and dfbench are unavailable in the authoring
runtime. Candidate feasible loss and promotion decision remain pending.

## One new experiment for the existing Muse runner

Operation: SOL-L2D-RESTART-T15-S42-300-20261011.
Public UIFO topology_seed15, algorithm seed42, 300 Objective seconds per arm.
Run order: unchanged096, then candidate. Total outer cap: 1800 seconds. Existing
Muse VM/free allocation only, equipped accepted dfbench0.3.3/JAX0.9.0.1 runtime.
Check the existing thread/source/hardware/tuple for running or completed work
before starting. The incumbent-control V1 source is retained, but this operation
compares096 and the new candidate; it does not repeat V1's assigned wave.

Use the exact accepted `run_public_uifo.py`, not a new harness. From this folder,
on that already equipped runtime, each command uses a fresh output destination:

```sh
JAX_ENABLE_X64=true python run_public_uifo.py --candidate submission096.py --topology-seed 15 --algorithm-seed 42 --seconds 300 --out results-sol-t15-s42-300/096.json
JAX_ENABLE_X64=true python run_public_uifo.py --candidate submission_sol_restart.py --topology-seed 15 --algorithm-seed 42 --seconds 300 --out results-sol-t15-s42-300/sol.json
```

Retain both raw histories, exact SHA-256s, actual hardware/runtime versions,
feasible loss/count/fraction, logged points/eval count, maximum logged time,
Objective and warmup-inclusive wall time, early return/overrun/predictive stop,
diagnostics and errors. Report partial/error evidence if the outer cap expires.
Do not promote from one pair, reuse a completed cell as a fresh run, or replace
official feasibility with the candidate's bookkeeping. Existing numerical owner
retains final submission and any broader simulation decision. Future improvement
depends on the measured result: if coverage costs too much, adjust slice/budget
share; if polish helps, isolate that change in a later distinct experiment.
