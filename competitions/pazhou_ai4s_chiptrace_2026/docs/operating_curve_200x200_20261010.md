# ChipTrace synthetic operating-curve sweep — 2026-10-10

This is a reproducible research-software QC characterization on generated inputs. It is **not** biological, clinical, wet-lab, or organizer validation; it does not establish competition score, ranking, prize, payment, or revenue.

## Source and command

- repository main at run start: `7d0dcf25beee297e52d4b0b34ed6c64381eb731f`
- core Git blob: `4cdd8beaa7009e05fb93913f13b02ec42edfe6ba`
- core file SHA-256: `2e7a0edb130ff70ddd8b58b1d1dc989b5165f443840d101c8e266bd8b249b68a`
- harness Git blob: `9da3730b89c3dd6677a0dc19ed0b67e83e2135b2`
- harness SHA-256: `ba39cf9ee83a69f12b31954863d5b1471b7a13f90b7b6f15c26f9b3c5d2494ad`
- runtime: Python 3.12.14
- exit status: 0
- conditions: 34
- design trials per condition: 200
- held-out trials per condition: 200
- total trials: 13,600
- minimum points: 6

```bash
python competitions/pazhou_ai4s_chiptrace_2026/operating_curve_experiment.py \
  --out /tmp/chiptrace-oc \
  --design-trials 200 \
  --heldout-trials 200 \
  --min-points 6
```

The generator wrote `conditions.json` before any trials. Expected labels came from declared generator intervention parameters, never from ChipTrace decisions.

## Exact output receipts

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `conditions.json` | 7,817 | `7127b5e8d966bbb121c8649d6246711fbcf506e1328be68567a4f930a88e13f1` |
| `decisions.jsonl` | 26,926,801 | `ad881a03d3d467da6fb03fc094c794c6cf5d20c2d6629ec5c782f4ee18809a22` |
| `summary.json` | 68,195 | `8483a9857483a8146df9145afea18b665af0c7bc546ddc35cfc3ce4dee204750` |

The canonical in-report conditions digest is `ab9767be131bcb226d1fdf047ee3c7d0fc9cfd55a1fa73e0ba70e97c44334c2a`. Raw generated artifacts are retained with the run receipt; this repository records their hashes and measured summary rather than adding a 26.9 MB generated corpus.

## Held-out native decision outcomes

These counts use the existing ChipTrace evidence policy, not the exploratory risk-score threshold.

| Generator kind | Trials | True positive | False negative | True negative | False positive | Correct abstain | Contract errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| cadence gap | 800 | 600 | 200 | 0 | 0 | 0 | 0 |
| correlation shift | 1,000 | 407 | 593 | 0 | 0 | 0 | 0 |
| drift | 1,000 | 427 | 573 | 0 | 0 | 0 | 0 |
| no intervention | 1,600 | 0 | 0 | 876 | 124 | 600 | 0 |
| replicate divergence | 1,000 | 442 | 558 | 0 | 0 | 0 | 0 |
| level shift | 1,400 | 742 | 458 | 0 | 0 | 200 | 0 |

All 800 declared insufficient-evidence held-out trials abstained correctly, and there were zero contract errors. The largest clean-condition false-positive hotspot was `noise_sd=0.01`, `heterogeneity_sd=0.01`, three replicates and 24 steps: 119/200 false positives (59.5%). It accounts for 119 of the 124 native held-out false positives. This is a concrete calibration target, not evidence that heterogeneous wet-lab data are invalid.

Detection rose with intervention strength, but weak effects were often missed. Examples from held-out trials:

- cadence-gap sensitivity was 0% at strength 0.05 and 100% at strengths 0.1, 0.2, and 0.3;
- correlation-shift sensitivity rose from 0% at 0.05 to 98.5% at 1.0;
- drift sensitivity rose from 0% at 0.5 to 100% at 8.0;
- replicate-divergence sensitivity rose from 0.5% at 0.5 and 1.0 to 100% at 4.0 and 8.0;
- level-shift sensitivity rose from 0% at 0.5 to 100% at 4.0 and 8.0.

## Exploratory score threshold

A max-quality-risk threshold of `11.739` was selected on the design split by maximum Youden J, breaking ties toward lower false-positive rate and then lower threshold. This exploratory threshold is **not** a change to ChipTrace policy.

| Split | Positives | Negatives | Sensitivity | 95% Wilson interval | False-positive rate | 95% Wilson interval |
|---|---:|---:|---:|---|---:|---|
| design | 5,000 | 1,000 | 0.6150 | 0.601429–0.628394 | 0.2140 | 0.189700–0.240489 |
| held-out | 5,000 | 1,000 | 0.6136 | 0.600021–0.627004 | 0.2250 | 0.200199–0.251906 |

Abstentions were excluded from this threshold fit and estimate. The held-out values are the relevant estimate; they show that this simple exploratory threshold is not ready to replace the existing evidence policy.

## Next experiments

Use new predeclared conditions and disjoint seeds to isolate the no-intervention heterogeneity hotspot, then map sensitivity around the weak-effect transition regions. Preserve raw false flags, misses, abstentions, and exact source/input hashes. Do not rerun the settled frozen benchmark or present synthetic outcomes as official competition results.
