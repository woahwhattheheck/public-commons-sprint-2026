# Anchor-state acceptance in the existing Learn2Design programme

Operation: **L2D-ANCHOR-STATE-REGIONAL-20261014**. This is an additive candidate in the original `exact-hessian-107-20261011` project and original serial native course. It is not a competition submission or a measured performance claim.

## The concrete source change

The retained `original/099/submission.py` has SHA256 `144216f254636979e1878df1f80afeae04240f8bf2e86d6f06d640d570e27b96`. When a trial is rejected, it returns to the accepted anchor's parameters and gradient but carries the Adam state accumulated on the rejected excursion. The same mismatch occurs when a nonfinite trial returns to an existing anchor. Continuing that momentum is a possible algorithm choice; restoring the accepted trajectory is another. We cannot infer which performs better from source inspection.

The new single implementation exposes exactly two policies:

| Source ID | Option | Rejected/nonfinite return to anchor |
| --- | --- | --- |
| `099-state-legacy-regional` | `backtracking_state="legacy"` | Retain the original rolling Optax state. |
| `099-state-anchor-regional` | `backtracking_state="anchor"` | Restore the immutable Optax pytree saved when that anchor was accepted. |

A saved anchor state is the trajectory entering the accepted point, before that point's gradient generates its next proposal. Optax/JAX produces new state pytrees; the saved tuple is retained by reference and not updated in place. An ordinary accepted trial replaces all anchor fields together. A permitted excursion continues from its own current state. A rejected or nonfinite trial restores state only in the anchor arm. A fresh restart still initializes a fresh optimizer.

Random-key advancement, trust-radius shrink/grow, noise decay, acceptance thresholds, source starts, restart patience, feasibility, native logging and predictive budget stop remain the original 099 behavior. Random keys and radius are deliberately not rewound. The two arms share source, requirement bytes and all other options. Diagnostics record the selected policy, total state restores and the nonfinite subset. The legacy policy preserves the original numerical update sequence, apart from source/diagnostic bookkeeping and associated elapsed time; it is not declared bit-identical measured timing.

Neither `original/099` nor any accepted source, mapped-batch candidate, incumbent or existing phase directory is overwritten. The maintained source selector binds both policies independently. Original `run_phase.py`, `runner/invocation.py`, native UIFO runner, comparator and `release_selected.py` require no code changes.

## Actual retained evidence and its limits

`retained-v7-pilot-summary.json` is the exact 9,532-byte file from completed Kaggle kernel **138115140**, **tokenjunkielabs/l2d084-pilot-b8**, explicit **v7**, path **results099pairs/pilot-summary.json**; SHA256 **613216c4f1bcf28fda9f4eb15726af8f3e9624ddf15e5ec782a652baa6333892**. Original pickup: [sim-data 1791951085.567869](https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791951085567869).

| Public topology, seed42,180s | 096 best feasible loss | 099 best feasible loss | 099 accepted / excursion / rejected |
| --- | --- | --- | --- |
| 10 | 4.8852516921942515 | No feasible point | 36 /35 /28 |
| 11 | 5.246330569811976 | 5.236289810660033 | 25 /9 /59 |
| 12 | 4.891589786110237 | No feasible point | 20 /14 /54 |

All six cells report no error and no budget overrun. 096 reached feasibility in three cells; 099 in one. The summary's -0.010040759151943135 mean delta has only one numeric pair. It is not the mean of all three and cannot rank their official performance without the original organizer fallback values. GPU trajectory nondeterminism and the small sample prevent causal attribution. These observations motivate the state-policy experiment but do not measure it.

The complete original 22-file v7 pickup remains with its existing authenticated owner in the same thread. Only the summary was available at this source boundary. In particular, the full notebook/source and histories still need their original version/hash binding; this document does not assert that our retained 099 file is proven byte-identical to that notebook's embedded source. No source-version label substitutes for output-version evidence.

## First native execution at the existing allocation boundary

Use the current original equipped Muse/DBA55/6966/D76C allocation and a separate retained output directory. First inspect its actual active process and existing source/phase record. Do not replace a checkout or manifest under an accepted native process. The same existing scientific producer retains admission and final source selection.

From the exact project source selected by this release:

```sh
python run_phase.py plan --phase anchor-state-development
python run_phase.py run --phase anchor-state-development --mode gpu --python /actual/equipped/bin/python --run-dir /actual/output/l2d-anchor-state-development
```

This is six real UIFO cells: both explicit policies, public topologies10/11/12, algorithm seed42,180 Objective seconds each. Each cell constructs the original fresh size-3,50-frequency Objective, logs original physics and captures actual effective runtime. It is a newly identified treatment pair, not a replay or relabel of Kaggle v7. The unchanged phase operator runs the declared legacy-then-anchor order within each topology and preserves whole paired topology groups for partitions. This fixed order is a limitation of this screening course, distinct from the alternating-order historical Kaggle pilot; do not attribute timing drift to the state policy. Its existing process lock, same-operation resume, per-cell cache, interrupted-attempt retention and 16,200-second container ceiling remain in force.

Inspect and retain the full existing product:

```sh
python run_phase.py status --run-dir /actual/output/l2d-anchor-state-development
python run_phase.py export --run-dir /actual/output/l2d-anchor-state-development --archive /actual/output/l2d-anchor-state-development-results.zip
```

Return the actual first command/host/process and full result archive to the original [sim-data parent](https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791736325457109). Preserve raw histories, sidecars, consoles, attempt/completion files, all errors, no-feasible outcomes and partial cells. Inspect whether restore counts are actually nonzero; if no rollback occurred, the run did not exercise the changed mechanism. Keep all outcomes rather than reporting only pairs with finite loss. CPU and GPU cohorts and different effective runtimes remain separate.

After actual development findings, the optional `anchor-state-broad-public` phase contains the same two policies across T7–16 at600s. The original `full-objective-budget` phase accepts deliberately selected source IDs at14,400s. No broad or final-budget job is asserted to have started. Partition options are the original `--partition-count` and `--partition-index`, with a distinct output per assigned existing worker.

## Exact selected artifact and current rules

If the existing source owner explicitly selects this arm after retained results, use the unchanged maintained packager:

```sh
python release_selected.py package --source-id 099-state-anchor-regional --archive /actual/owned/output/anchor-state-selected.zip --out /actual/owned/output/anchor-state-selected-release.json
```

This is file packaging, not a submission. It binds the exact implementation, frozen option, native requirements, root wrapper, original license and RELEASE.json, using the existing atomic publisher and official static validator. A source-only package does not establish a numerical improvement. Never replace the frozen incumbent or submit from an uncertain run state.

The current first-party [submission rules](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/main/docs/submission.md) and [competition README](https://github.com/artificial-scientist-lab/Learn2Design-2026/blob/main/README.md) were read on2026-10-14. Official scoring uses best logged feasible loss on ten hidden topologies, random-search fallback when none is feasible, and their arithmetic mean; four hours after start_logging with a4h30 container ceiling. Only the supplied Objective may evaluate physics. No simulator import, private topology encoding, pre-logging result call, altered score/budget or online dependency is added. The final deadline is October15 AoE, **October16,2026 at11:59:59UTC**. Current participation/prize requirements remain the existing entrant's responsibility; no new account/registration/submission is performed by this source arm.

## Completion boundary

At publication this is complete source/runner/packaging integration plus exact retained pilot evidence. This authoring seat has no CPython/JAX/Optax/native GPU executor. It has not produced physics measurements, run the official validator, or opened a new submission archive. The existing actual native course must return these outcomes.

Before a human-facing report or export is called ready, the producing peer must open/run/render its exact outgoing version, LOOK at actual screens or images, operate important controls at desktop/screenshare and narrow widths when applicable, open/extract every attachment and independently reopen the result. Fix broken or unreadable output in that same product. Source review, HTTP200, captured-only screenshots or broad tests are not a substitute. No paid Actions, bounty work, parallel simulator, controller or duplicate competition entry is requested.
