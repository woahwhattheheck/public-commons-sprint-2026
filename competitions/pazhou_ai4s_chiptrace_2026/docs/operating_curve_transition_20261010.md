# ChipTrace heterogeneity and weak-effect transition sweep — 2026-10-10

This is a distinct follow-up to the source-pinned 200 × 200 operating-curve panel. It uses new predeclared condition IDs and disjoint deterministic seeds to isolate one clean-condition false-positive hotspot and several weak-effect transitions. It is **synthetic research-software QC characterization only**, not biological, clinical, wet-lab, or organizer validation.

## Source and command

- repository source: `woahwhattheheck/public-commons-sprint-2026`
- merged harness commit: `7d0dcf25beee297e52d4b0b34ed6c64381eb731f`
- core Git blob: `4cdd8beaa7009e05fb93913f13b02ec42edfe6ba`
- harness Git blob: `9da3730b89c3dd6677a0dc19ed0b67e83e2135b2`
- harness SHA-256: `ba39cf9ee83a69f12b31954863d5b1471b7a13f90b7b6f15c26f9b3c5d2494ad`
- custom input conditions: 17
- custom input file SHA-256: `2d0bc75399cababb2a4340c378ae060ddd9a3416bf841f84f0dc2905af8bd04b`
- design trials per condition: 200
- held-out trials per condition: 200
- total trials: 6,800
- runtime: Python 3.12.14
- exit status: 0

```bash
python competitions/pazhou_ai4s_chiptrace_2026/operating_curve_experiment.py \
  --out /tmp/chiptrace-transition \
  --design-trials 200 \
  --heldout-trials 200 \
  --min-points 6 \
  --conditions-json transition_conditions.json
```

The default condition matrix was replaced, not extended, so no condition from the first 34-condition panel was repeated.

## Exact output receipts

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| generated `conditions.json` | 4,224 | `e4baf8eebd76c683bb1591da409d979f138c6803e8f0bbce21cb2f102863e025` |
| raw `decisions.jsonl` | 12,861,037 | `476107577e89287f5a846286809ebe916a64f2f0144f921c19539adf9291756a` |
| `summary.json` | 34,186 | `e2801d37cac3be9104b0bcb49d33bd79bb052c33c4772ea601b3f40e6ccfcc08` |

The canonical in-report conditions digest is `51728eee533b2b12b083f2ef1d60d27b574712275412b0d969b84179f7d96270`.

## Held-out clean heterogeneity results

All rows below are declared no-intervention inputs. False-positive rate is the existing native ChipTrace decision outcome.

| Noise SD | Heterogeneity SD | True negative | False positive | False-positive rate |
|---:|---:|---:|---:|---:|
| 0.01 | 0.0025 | 200 | 0 | 0.0% |
| 0.01 | 0.0050 | 180 | 20 | 10.0% |
| 0.01 | 0.0075 | 131 | 69 | 34.5% |
| 0.01 | 0.0125 | 47 | 153 | 76.5% |
| 0.01 | 0.0150 | 15 | 185 | 92.5% |
| 0.02 | 0.0050 | 199 | 1 | 0.5% |
| 0.02 | 0.0100 | 178 | 22 | 11.0% |
| 0.02 | 0.0150 | 130 | 70 | 35.0% |

The false-positive cliff depends strongly on heterogeneity relative to measurement noise. Under this generator, a fixed amount of clean between-replicate heterogeneity is much more likely to trigger review when within-replicate noise is low. This is a concrete calibration finding; it does not imply that heterogeneous real experiments are invalid.

## Held-out weak-effect transitions

| Intervention | Strength | True positive | False negative | Sensitivity |
|---|---:|---:|---:|---:|
| cadence gap | 0.075 | 200 | 0 | 100.0% |
| correlation shift | 0.30 | 8 | 192 | 4.0% |
| correlation shift | 0.65 | 110 | 90 | 55.0% |
| drift | 2.5 | 67 | 133 | 33.5% |
| drift | 3.0 | 137 | 63 | 68.5% |
| replicate divergence | 2.5 | 98 | 102 | 49.0% |
| replicate divergence | 3.0 | 175 | 25 | 87.5% |
| level shift | 1.25 | 29 | 171 | 14.5% |
| level shift | 1.50 | 59 | 141 | 29.5% |

There were zero abstentions and zero contract errors in this 17-condition matrix.

## Exploratory score threshold

The design split selected a max-quality-risk threshold of `14.74` by maximum Youden J. This is **not** a change to ChipTrace policy.

| Split | Positives | Negatives | Sensitivity | 95% Wilson interval | False-positive rate | 95% Wilson interval |
|---|---:|---:|---:|---|---:|---|
| design | 1,800 | 1,600 | 0.5950 | 0.572143–0.617452 | 0.33875 | 0.315970–0.362302 |
| held-out | 1,800 | 1,600 | 0.588333 | 0.565434–0.610857 | 0.3550 | 0.331926–0.378768 |

The held-out result confirms that a single risk-score threshold is not ready to replace the evidence policy, especially across clean heterogeneity regimes.

## Engineering implication

The next source change should not merely lower a global threshold. First isolate which native evidence component dominates clean heterogeneity false flags, then test a source-pinned adjustment that preserves strong replicate-divergence sensitivity and the existing insufficient-evidence gates. Any candidate must be compared on disjoint conditions and seeds, with the current core retained as control. Preserve misses, false flags, abstentions, exact input receipts, and the non-biological authority boundary.
