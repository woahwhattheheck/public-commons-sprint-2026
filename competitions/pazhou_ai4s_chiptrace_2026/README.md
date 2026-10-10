# ChipTrace — evidence-first organ-on-chip experiment intelligence

ChipTrace is a dependency-free research quality-control system for organ-on-chip (OoC) experiment streams. It compares a candidate run with an explicitly supplied baseline, detects multiple classes of quality drift, produces an uncertainty-aware `SUPPORTED | REVIEW | INSUFFICIENT_EVIDENCE` state for each channel, and binds the result to exact input bytes with a SHA-256 replay receipt.

**Important scope:** ChipTrace is experiment QC and research decision support. It does **not** diagnose disease, recommend treatment, establish drug efficacy or safety, or make patient-specific decisions. `SUPPORTED` means only that the configured QC review thresholds were not exceeded.

This carrier targets the 2026 Fifth Pazhou Algorithm Competition **AI + Organ-on-a-Chip: Open-ended Innovation Challenge for AI + Life Science**. The live organizer page describes an open innovation task accepting models, tools, agents, simulations, data-analysis pipelines, and experiment-assistance systems, with a Kaggle Writeup collecting public code, a demo video, and a technical report. Competition source: https://www.aicompetition-pz.com/topic_detail/26

## What is implemented

ChipTrace is deliberately small enough to audit and complete enough to demo:

- exact CSV contract for run / replicate / time / channel / value / unit / provenance / modality;
- fail-closed rejection of unknown columns, which blocks extra identity or clinical columns;
- robust baseline center and dispersion using median + MAD, with deterministic fallbacks;
- level-shift, within-run change-point, robust trend, outlier-fraction, cadence/missingness, replicate-divergence, and cross-sensor-correlation-shift evidence;
- explicit evidence-state semantics and uncertainty;
- unit and modality consistency gates;
- SHA-256 hashes for baseline and candidate bytes;
- canonical JSON replay receipt and standalone receipt verification;
- deterministic synthetic OoC-style fixture with three sensor-feature channels and three replicates;
- self-contained judge-facing HTML report;
- technical report and sub-five-minute demo script;
- hostile tests for tamper, identity-column ingestion, duplicate rows, unit mismatch, non-finite values, small samples, replay determinism, and report scope.

No network, model API, database, scientific Python package, or paid service is required.

## Quick start

From the repository root:

```bash
python competitions/pazhou_ai4s_chiptrace_2026/chiptrace.py demo \
  --directory /tmp/chiptrace-demo

python competitions/pazhou_ai4s_chiptrace_2026/chiptrace.py verify \
  /tmp/chiptrace-demo/report.json
```

Expected demo state: `REVIEW`. The synthetic candidate deliberately contains a barrier-feature shift, oxygen drift, one cadence gap, replicate divergence, and changed cross-sensor structure.

Analyze your own **non-sensitive research** data:

```bash
python competitions/pazhou_ai4s_chiptrace_2026/chiptrace.py analyze \
  --baseline baseline.csv \
  --run candidate.csv \
  --out report.json \
  --html report.html
```

## Exact input contract

The header is intentionally exact:

```text
run_id,replicate_id,time_s,channel,value,unit,source,modality
```

Unknown header columns are rejected. This limits the input schema; it does not inspect or de-identify values in allowed fields such as `run_id` or `source`. Prepare non-sensitive research data before ingestion, including those free-text fields.

Each observation key `(run_id, replicate_id, time_s, channel)` must be unique. Replicate groups use `(run_id, replicate_id)`; pooled runs may reuse replicate labels without merging their timelines or overwriting cross-sensor samples. Time and value must be finite numbers. A candidate channel must already exist in the baseline, and its unit and modality must match exactly.

## Evidence model

For each channel, ChipTrace builds a baseline envelope and computes:

1. **Level shift** — candidate median relative to robust baseline scale.
2. **Within-run change** — maximum first-half vs second-half median shift across replicates.
3. **Trend** — Theil–Sen slope normalized to one baseline sampling step.
4. **Outliers** — fraction of observations at least three robust scales from baseline center.
5. **Missingness** — missing expected cadence steps inferred from baseline timing.
6. **Replicate divergence** — spread of replicate medians relative to baseline scale.
7. **Cross-sensor shift** — change in aligned Pearson correlation structure versus baseline.

Cross-sensor pair keys preserve ordinary channel names. For channel names containing `|` or `%`, each member is escaped before the two names are joined: `%` to `%25`, then `|` to `%7C`. This prevents different physical sensor pairs from sharing one evidence key or losing correlation-drift attribution. The existing plain-name report keys remain unchanged.

The composite `quality_risk_score` is deterministic and transparent. Hard review thresholds can trigger `REVIEW` even when the weighted score is below 25. Sparse data returns `INSUFFICIENT_EVIDENCE`, never a falsely reassuring pass. An **entire baseline sensor channel missing** from the candidate run also produces an explicit `INSUFFICIENT_EVIDENCE` channel assessment and abstention overall, even if every remaining sensor appears clean. Its quality-risk score is `null` (rendered `n/a`), not a fabricated low-risk reading; the baseline metadata and exact-byte input receipts are retained. Extra channels absent from the baseline remain invalid input.

**Independent-replicate coverage:** if a baseline has at least two independent
`(run_id, replicate_id)` groups, a candidate channel must also contain at least two
groups before the system can emit `SUPPORTED`. Many repeated timepoints in one
replicate do not substitute for independent replicates. A single candidate
replicate now yields `INSUFFICIENT_EVIDENCE`, an explicit 1-of-2 evidence count
and higher uncertainty; the valid one-replicate-baseline behavior remains unchanged.
This sufficiency gate is not a substitute for assay-specific power analysis.

**Elapsed-time-window overlap:** A gapless, full-length candidate can be
recorded at a different experimental phase (reference `0..19 s`, candidate
`100..119 s`); duration-only missingness cannot see it. Each candidate
replicate must overlap at least 75% of the reference median-start/median-end
elapsed-time interval. Insufficient overlap produces `INSUFFICIENT_EVIDENCE`,
null risk, full uncertainty and a `reference_window_overlap_coverage` metric.
Aligned candidates retain their previous receipts. Baseline and candidate
must share a protocol-relative elapsed-time origin; do not automatically shift
timestamps to manufacture alignment. This is a QC evidence-sufficiency gate,
not a biological conclusion or anomaly severity score.

The current thresholds are an auditable prototype policy, not universal biological constants. A real lab should calibrate them against its assay, device, sensor, sampling plan, and validated QC process.

## Demo receipt

The deterministic fixture currently yields:

- overall state: `REVIEW`;
- max quality-risk score: `69.869`;
- replay receipt: `88233f2735ea76f7e90f68c05b0ee65ead47c97a221c268af02e8222ef06bb32`.

The receipt hashes the complete canonical report, which includes hashes of the exact baseline and candidate input bytes. `verify` checks the report against its embedded digest; it does not reopen the input files. A report edit without recomputing the digest fails that check. The digest is unkeyed and can be recomputed, so it establishes consistency, not the author's identity or authenticity. Compare with a separately retained trusted receipt or input digest when checking provenance.

## Tests

```bash
python -m py_compile \
  competitions/pazhou_ai4s_chiptrace_2026/chiptrace.py \
  competitions/pazhou_ai4s_chiptrace_2026/tests/test_chiptrace.py

python -m unittest \
  competitions.pazhou_ai4s_chiptrace_2026.tests.test_chiptrace -v
```

The historical multi-Python path-scoped workflow is not present on current main. Current execution evidence is the focused merged-byte CPython 3.13.5 benchmark and test receipt below; no broader hosted matrix is claimed.


## Frozen benchmark and evidence-bound triage

`benchmark.py` evaluates the existing deterministic ChipTrace QC core on five frozen synthetic cases: clean, level shift, cadence gap, replicate divergence, and sparse evidence. The triage wrapper emits `SUPPORTED_QC`, `REVIEW`, or `ABSTAIN` and attaches JSON-pointer citations back to the exact report fields supporting the decision.

The benchmark reports precision, REVIEW recall and F1, false-flag rate on classified decisions, **labeled-case decision coverage**, **labeled exact-state accuracy**, SUPPORTED recall, abstentions on labeled REVIEW/SUPPORTED cases, sparse-case abstention accuracy, citation validity, repeat decision churn, and median/P95 execution latency. Abstaining on a known-clean sample is not a true negative; abstaining on a known-REVIEW sample reduces recall. The sparse ground-truth class remains separately scored for correct abstention. Its deterministic receipt excludes wall-clock timing so runner load does not change the evidence hash.

Accepted execution evidence on the merged exact bytes used CPython 3.13.5 and five frozen scenarios repeated three times (15 internal scenario executions, not 15 independent experiments): 14/14 focused tests passed; QC and triage precision/recall/F1 were 1.0/1.0/1.0; false-flag rate was 0; sparse abstention accuracy and citation validity were 1.0; decision churn was 0. The retained run measured 3.196900 ms median and 4.178909 ms P95/max, with deterministic receipt `bfbfbe949b15fa02e45dd5a6694d84709a3924d1e1cd5f9c6cc46e2c39cdb862`. These timings are runner-specific software measurements, not wet-lab, biological, or organizer scoring evidence.

This is a synthetic research-software QC benchmark floor, not biological or competition validation.


## Synthetic operating-curve characterization

`operating_curve_experiment.py` imports the current `chiptrace.py` core unchanged and runs deterministic, predeclared synthetic intervention conditions across separate design and held-out seeds. It records correct detections, misses, false flags, abstentions, and contract errors instead of forcing successful outcomes. Generator labels come only from the declared intervention parameters; they are not biological ground truth or organizer scoring.

Run a reproducible starter sweep from the repository root:

```bash
python competitions/pazhou_ai4s_chiptrace_2026/operating_curve_experiment.py \
  --out /tmp/chiptrace-oc \
  --design-trials 200 \
  --heldout-trials 200 \
  --min-points 6
```

The output directory contains the pre-run `conditions.json`, raw per-trial `decisions.jsonl`, generated exact-input artifacts, and `summary.json` with per-condition outcome counts plus an explicitly exploratory design-selected threshold evaluated on held-out trials. Custom conditions may be supplied with `--conditions-json`; use `--extend-defaults` only when the added conditions are genuinely distinct. Preserve source hashes and publish raw counts, sensitivity, false-positive rate, and abstentions—not a pass-only summary.

This harness is synthetic research-software QC characterization. It is not wet-lab, biological, clinical, or competition validation, and it does not change ChipTrace's production evidence policy.

## Competition status and authority boundary

This repository carrier is source/test/demo/report readiness only. It does not assert Kaggle registration, terms acceptance, official submission, organizer validation, finalist status, score, ranking, prize, payment, or revenue. Any eventual competition action must preserve the event's current rules, data licenses, attribution requirements, and identity/entry requirements.

See `docs/technical_report.md`, `docs/kaggle_writeup.md`, and `docs/demo_script.md` for the judge-facing materials.

## Source provenance and license

This ChipTrace subtree is distributed under its own Apache License, Version 2.0 (`LICENSE`), separately from this public repository's root MIT assets. The source was exported from the original author's privately maintained competition workspace at immutable source commit `4e520baa6bb5e369dc8e706a839c6082c2128372`; source/entrant rights preserved. This code publication alone does not submit the competition or establish an award.
