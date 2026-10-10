#!/usr/bin/env python3
"""ChipTrace synthetic operating-curve experiment harness.

Research-software QC characterisation only, on synthetic data. No biological,
clinical, wet-lab or organizer validation is implied. The ChipTrace core
(chiptrace.py) is imported unchanged and its algorithm is not modified.

Ground-truth labels derive from predeclared generator intervention parameters,
never from QC decisions. Abstentions are recorded separately from wrong
decisions. Weak interventions are expected to be undetectable for some
strengths; misses and no-effect outcomes are data, not failures.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
_NAME = 'chiptrace_core_operating_curve'
_SPEC = importlib.util.spec_from_file_location(_NAME, HERE / 'chiptrace.py')
assert _SPEC and _SPEC.loader
ct = importlib.util.module_from_spec(_SPEC)
sys.modules[_NAME] = ct  # required for dataclasses under postponed annotations
_SPEC.loader.exec_module(ct)

SCHEMA = 'chiptrace.operating_curve.v1'
SOURCE = 'synthetic_operating_curve_generator'
UNIT = 'relative_index'
MODALITY = 'sensor_feature'
CADENCE_S = 300.0
BASE_REPLICATES = 3
BASE_STEPS = 24
LOAD = 0.8  # shared latent loading -> baseline pairwise r about 0.64
CHANNELS = {'barrier_index': 1.0, 'oxygen_index': 0.82, 'flow_index': 1.0}
KINDS = ('none', 'shift', 'drift', 'cadence_gap', 'replicate_divergence', 'correlation_shift')
STRENGTH_UNITS = {
    'none': 'unused (must be 0)',
    'shift': 'barrier_index offset in multiples of generator noise_sd',
    'drift': 'oxygen_index linear ramp reaching strength*noise_sd at baseline final step',
    'cadence_gap': 'fraction of interior oxygen_index timepoints dropped per replicate (min 1 if >0)',
    'replicate_divergence': 'flow_index offset of last candidate replicate in multiples of noise_sd',
    'correlation_shift': 'fraction of oxygen_index shared-latent loading replaced by variance-matched independent noise (0..1)',
}
Z95 = 1.959963984540054


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def condition_id(c: Dict[str, Any]) -> str:
    return (f"{c['kind']}-s{c['strength']:g}-r{c['replicates']}-n{c['steps']}"
            f"-sd{c['noise_sd']:g}-h{c['heterogeneity_sd']:g}-cov{c['coverage']:g}")


def default_conditions() -> List[Dict[str, Any]]:
    # Runnable starter dimension list; the fleet may pass any NEW conditions.
    base = {'replicates': 3, 'steps': 24, 'noise_sd': 0.02, 'heterogeneity_sd': 0.0, 'coverage': 1.0}
    conds: List[Dict[str, Any]] = []
    for noise in (0.01, 0.03):
        for het in (0.0, 0.01):
            conds.append({**base, 'kind': 'none', 'strength': 0.0, 'noise_sd': noise, 'heterogeneity_sd': het})
    graded = (('shift', (0.5, 1.0, 2.0, 4.0, 8.0)), ('drift', (0.5, 1.0, 2.0, 4.0, 8.0)),
              ('cadence_gap', (0.05, 0.1, 0.2, 0.3)), ('replicate_divergence', (0.5, 1.0, 2.0, 4.0, 8.0)),
              ('correlation_shift', (0.05, 0.2, 0.5, 0.8, 1.0)))
    for kind, strengths in graded:
        for s in strengths:
            conds.append({**base, 'kind': kind, 'strength': s})
    conds.append({**base, 'kind': 'shift', 'strength': 4.0, 'heterogeneity_sd': 0.01})
    # Depth / temporal-coverage conditions with predeclared insufficiency expectations.
    conds += [{**base, 'kind': 'none', 'strength': 0.0, 'replicates': 1},
              {**base, 'kind': 'none', 'strength': 0.0, 'steps': 2},
              {**base, 'kind': 'none', 'strength': 0.0, 'coverage': 0.5},
              {**base, 'kind': 'shift', 'strength': 8.0, 'replicates': 1},
              {**base, 'kind': 'none', 'strength': 0.0, 'replicates': 2, 'steps': 20}]
    for c in conds:
        c['id'] = condition_id(c)
    return conds


def validate_condition(c: Dict[str, Any]) -> Dict[str, Any]:
    out = {'kind': c['kind'], 'strength': float(c['strength']), 'replicates': int(c.get('replicates', 3)),
           'steps': int(c.get('steps', BASE_STEPS)), 'noise_sd': float(c.get('noise_sd', 0.02)),
           'heterogeneity_sd': float(c.get('heterogeneity_sd', 0.0)), 'coverage': float(c.get('coverage', 1.0))}
    if out['kind'] not in KINDS:
        raise ValueError(f'unknown kind {out["kind"]}')
    for k in ('strength', 'noise_sd', 'heterogeneity_sd', 'coverage'):
        if not math.isfinite(out[k]):
            raise ValueError(f'{k} must be finite')
    if out['kind'] == 'none' and out['strength'] != 0.0:
        raise ValueError('healthy control must have strength 0')
    if out['strength'] < 0 or out['noise_sd'] <= 0 or out['heterogeneity_sd'] < 0:
        raise ValueError('strength/heterogeneity >=0 and noise_sd >0 required')
    if not 0.0 < out['coverage'] <= 1.0 or out['replicates'] < 1 or out['steps'] < 1:
        raise ValueError('0<coverage<=1, replicates>=1, steps>=1 required')
    if out['kind'] in ('correlation_shift', 'cadence_gap') and out['strength'] > 1.0:
        raise ValueError('fractional strength must be <=1')
    out['id'] = str(c.get('id') or condition_id(out))
    return out


def candidate_steps(c: Dict[str, Any]) -> int:
    return max(1, int(round(c['steps'] * c['coverage'])))


def gap_drops(c: Dict[str, Any], steps: int) -> int:
    if c['kind'] != 'cadence_gap' or c['strength'] <= 0 or steps <= 2:
        return 0
    return min(steps - 2, max(1, int(round(c['strength'] * (steps - 2)))))


def expected_label(c: Dict[str, Any], min_points: int = 6) -> str:
    # Predeclared from generator design and the documented public sufficiency
    # policy (replicates, per-replicate depth, 75% window). Never reads QC output.
    steps = candidate_steps(c)
    per_channel_steps = steps - gap_drops(c, steps)
    per_rep_needed = max(2, min_points // min(2, BASE_REPLICATES))
    span_ratio = (steps - 1) / (BASE_STEPS - 1)
    if (c['replicates'] < 2 or per_channel_steps < per_rep_needed
            or c['replicates'] * per_channel_steps < min_points or span_ratio < 0.75):
        return 'INSUFFICIENT_EXPECTED'
    if c['kind'] == 'none' or c['strength'] == 0.0:
        return 'NEGATIVE'
    return 'POSITIVE'


def seed_for(cid: str, split: str, index: int) -> int:
    return int(hashlib.sha256(f'{SCHEMA}|{cid}|{split}|{index}'.encode('utf-8')).hexdigest()[:16], 16)


def generate(c: Dict[str, Any], rng: random.Random, candidate: bool) -> Tuple[List[Any], List[Dict[str, Any]]]:
    reps = c['replicates'] if candidate else BASE_REPLICATES
    steps = candidate_steps(c) if candidate else BASE_STEPS
    kind = c['kind'] if candidate else 'none'
    s = c['strength'] if candidate else 0.0
    sd, het = c['noise_sd'], c['heterogeneity_sd']
    run_id = 'candidate' if candidate else 'baseline'
    rows: List[Any] = []
    interventions: List[Dict[str, Any]] = []
    for r in range(reps):
        rep = f'{run_id[0]}{r + 1}'
        offs = {ch: (rng.gauss(0.0, het) if het > 0 else 0.0) for ch in CHANNELS}
        k = gap_drops({**c, 'kind': kind, 'strength': s}, steps)
        dropped = set(rng.sample(range(1, steps - 1), k)) if k else set()
        if dropped:
            interventions.append({'replicate_id': rep, 'dropped_oxygen_steps': sorted(dropped)})
        for t in range(steps):
            f = rng.gauss(0.0, 1.0)
            for ch, center in CHANNELS.items():
                load = LOAD * (1.0 - s) if (kind == 'correlation_shift' and ch == 'oxygen_index') else LOAD
                e = rng.gauss(0.0, 1.0)
                v = center + offs[ch] + sd * (load * f + math.sqrt(max(0.0, 1.0 - load * load)) * e)
                if kind == 'shift' and ch == 'barrier_index':
                    v += s * sd
                if kind == 'drift' and ch == 'oxygen_index':
                    v += s * sd * t / (BASE_STEPS - 1)
                if kind == 'replicate_divergence' and ch == 'flow_index' and r == reps - 1:
                    v += s * sd
                if ch == 'oxygen_index' and t in dropped:
                    continue
                rows.append(ct.Observation(run_id, rep, t * CADENCE_S, ch, v, UNIT, SOURCE, MODALITY))
    if candidate and kind not in ('none', 'cadence_gap') and s > 0:
        interventions.append({'kind': kind, 'strength': s, 'units': STRENGTH_UNITS[kind]})
    return rows, interventions


def classify(label: str, state: Optional[str]) -> str:
    if state is None:
        return 'CONTRACT_ERROR'
    if label == 'INSUFFICIENT_EXPECTED':
        return 'CORRECT_ABSTAIN' if state == 'INSUFFICIENT_EVIDENCE' else 'UNEXPECTED_DECISION'
    if state == 'INSUFFICIENT_EVIDENCE':
        return 'ABSTAIN'
    if label == 'POSITIVE':
        return 'TRUE_POSITIVE' if state == 'REVIEW' else 'FALSE_NEGATIVE'
    return 'FALSE_POSITIVE' if state == 'REVIEW' else 'TRUE_NEGATIVE'


def run_trial(c: Dict[str, Any], split: str, index: int, out: Path, min_points: int) -> Dict[str, Any]:
    seed = seed_for(c['id'], split, index)
    rng = random.Random(seed)
    base_rows, _ = generate(c, rng, candidate=False)
    cand_rows, interventions = generate(c, rng, candidate=True)
    d = out / 'trials' / split / c['id'] / f'{index:04d}'
    bp, cp, rp = d / 'baseline.csv', d / 'candidate.csv', d / 'report.json'
    ct.write_csv(bp, base_rows)
    ct.write_csv(cp, cand_rows)
    label = expected_label(c, min_points)
    rec: Dict[str, Any] = {
        'schema': SCHEMA, 'split': split, 'index': index, 'seed': seed, 'condition_id': c['id'], 'condition': c,
        'expected_label': label, 'label_source': 'predeclared generator intervention parameters (not QC output)',
        'interventions': interventions, 'csv_columns': list(ct.REQUIRED_COLUMNS),
        'csv_source': SOURCE, 'csv_unit': UNIT, 'csv_modality': MODALITY,
        'baseline_file': bp.relative_to(out).as_posix(), 'baseline_sha256': ct.file_sha256(bp),
        'candidate_file': cp.relative_to(out).as_posix(), 'candidate_sha256': ct.file_sha256(cp),
    }
    try:
        report = ct.analyze(bp, cp, min_points=min_points)
    except ct.ContractError as exc:
        rec.update(overall_state=None, outcome='CONTRACT_ERROR', error=str(exc), max_quality_risk_score=None)
        return rec
    rp.write_text(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')
    state = report['overall_state']
    rec.update(
        report_file=rp.relative_to(out).as_posix(), report_file_sha256=ct.file_sha256(rp),
        report_receipt_sha256=report['receipt_sha256'], report_receipt_verifies=ct.verify_report(report),
        report_input_digests_match=(report['inputs']['baseline_sha256'] == rec['baseline_sha256']
                                    and report['inputs']['run_sha256'] == rec['candidate_sha256']),
        overall_state=state, max_quality_risk_score=report['max_quality_risk_score'],
        channel_states={a['channel']: a['state'] for a in report['channel_assessments']},
        channel_reasons={a['channel']: a['reasons'] for a in report['channel_assessments']},
        outcome=classify(label, state))
    return rec


def rate(k: int, n: int) -> Optional[float]:
    return None if n == 0 else round(k / n, 6)


def wilson(k: int, n: int, z: float = Z95) -> Optional[List[float]]:
    if n == 0:
        return None
    p = k / n
    den = 1.0 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(max(0.0, centre - half), 6), round(min(1.0, centre + half), 6)]


def summarize(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for r in records:
        groups.setdefault((r['split'], r['condition_id']), []).append(r)
    out = []
    for (split, cid), rows in sorted(groups.items()):
        cnt: Dict[str, int] = {}
        for r in rows:
            cnt[r['outcome']] = cnt.get(r['outcome'], 0) + 1
        n, label = len(rows), rows[0]['expected_label']
        tp, fn, fp, tn = (cnt.get(k, 0) for k in ('TRUE_POSITIVE', 'FALSE_NEGATIVE', 'FALSE_POSITIVE', 'TRUE_NEGATIVE'))
        ab = cnt.get('ABSTAIN', 0)
        classified = tp + fn + fp + tn
        row: Dict[str, Any] = {'split': split, 'condition_id': cid, 'expected_label': label, 'condition': rows[0]['condition'],
                               'n': n, 'outcome_counts': dict(sorted(cnt.items())), 'contract_errors': cnt.get('CONTRACT_ERROR', 0),
                               'decision_coverage': rate(classified, n), 'decision_coverage_wilson95': wilson(classified, n)}
        if label == 'NEGATIVE':
            row.update(false_positive_rate=rate(fp, fp + tn), false_positive_rate_wilson95=wilson(fp, fp + tn),
                       abstention_rate=rate(ab, n), abstention_wilson95=wilson(ab, n))
        elif label == 'POSITIVE':
            row.update(sensitivity_all_trials=rate(tp, n), sensitivity_all_trials_wilson95=wilson(tp, n),
                       sensitivity_when_classified=rate(tp, tp + fn), sensitivity_when_classified_wilson95=wilson(tp, tp + fn),
                       abstention_rate=rate(ab, n), abstention_wilson95=wilson(ab, n),
                       observed_effect='NO_DETECTION_OBSERVED' if tp == 0 else 'DETECTED_IN_SOME_TRIALS')
        else:
            ok = cnt.get('CORRECT_ABSTAIN', 0)
            row.update(expected_abstention_rate=rate(ok, n), expected_abstention_wilson95=wilson(ok, n),
                       unexpected_decisions=cnt.get('UNEXPECTED_DECISION', 0))
        out.append(row)
    return out


def explore_threshold(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    # Exploratory post-hoc score threshold: selected on design seeds only and
    # evaluated on held-out seeds. The core algorithm/thresholds are unchanged.
    def usable(split: str) -> List[Dict[str, Any]]:
        return [r for r in records if r['split'] == split and r['expected_label'] in ('POSITIVE', 'NEGATIVE')
                and r['outcome'] not in ('ABSTAIN', 'CONTRACT_ERROR') and isinstance(r.get('max_quality_risk_score'), (int, float))]
    design, held = usable('design'), usable('heldout')
    pos = [r for r in design if r['expected_label'] == 'POSITIVE']
    neg = [r for r in design if r['expected_label'] == 'NEGATIVE']
    if not pos or not neg:
        return {'status': 'NOT_ESTIMABLE', 'reason': 'design split lacks classified positive and negative trials'}
    best: Optional[Tuple[Tuple[float, float, float], float]] = None
    for t in sorted({float(r['max_quality_risk_score']) for r in design}):
        tpr = sum(float(r['max_quality_risk_score']) >= t for r in pos) / len(pos)
        fpr = sum(float(r['max_quality_risk_score']) >= t for r in neg) / len(neg)
        key = (tpr - fpr, -fpr, -t)
        if best is None or key > best[0]:
            best = (key, t)
    assert best is not None
    threshold = best[1]

    def evaluate(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        p = [r for r in rows if r['expected_label'] == 'POSITIVE']
        q = [r for r in rows if r['expected_label'] == 'NEGATIVE']
        tp = sum(float(r['max_quality_risk_score']) >= threshold for r in p)
        fp = sum(float(r['max_quality_risk_score']) >= threshold for r in q)
        return {'positives': len(p), 'negatives': len(q), 'sensitivity': rate(tp, len(p)), 'sensitivity_wilson95': wilson(tp, len(p)),
                'false_positive_rate': rate(fp, len(q)), 'false_positive_rate_wilson95': wilson(fp, len(q))}
    return {'status': 'EXPLORATORY', 'score': 'max_quality_risk_score', 'selection_rule': 'max Youden J on design split; ties -> lower FPR, lower threshold',
            'threshold': threshold, 'design': evaluate(design), 'heldout': evaluate(held),
            'abstained_trials_excluded': True, 'note': 'Not a change to ChipTrace policy; held-out estimate is the relevant one.'}


def load_conditions(path: Optional[str], extend: bool) -> List[Dict[str, Any]]:
    conds: List[Dict[str, Any]] = default_conditions() if (path is None or extend) else []
    if path is not None:
        conds += json.loads(Path(path).read_text(encoding='utf-8'))
    conds = [validate_condition(c) for c in conds]
    ids = [c['id'] for c in conds]
    if len(ids) != len(set(ids)):
        raise ValueError('duplicate condition ids')
    return conds


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', required=True)
    p.add_argument('--design-trials', type=int, default=3)
    p.add_argument('--heldout-trials', type=int, default=3)
    p.add_argument('--min-points', type=int, default=6)
    p.add_argument('--conditions-json', help='JSON list of NEW conditions (replaces defaults unless --extend-defaults)')
    p.add_argument('--extend-defaults', action='store_true')
    a = p.parse_args(argv)
    if a.design_trials < 0 or a.heldout_trials < 0:
        p.error('trial counts must be >= 0')
    conds = load_conditions(a.conditions_json, a.extend_defaults)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    predeclared = {'schema': SCHEMA, 'conditions': conds, 'strength_units': STRENGTH_UNITS, 'min_points': a.min_points,
                   'expected_labels': {c['id']: expected_label(c, a.min_points) for c in conds},
                   'splits': {'design': a.design_trials, 'heldout': a.heldout_trials}}
    pre_bytes = canonical(predeclared)
    (out / 'conditions.json').write_bytes(pre_bytes + b'\n')  # written before any trial runs
    records: List[Dict[str, Any]] = []
    with (out / 'decisions.jsonl').open('w', encoding='utf-8', newline='\n') as fh:
        for split, n in (('design', a.design_trials), ('heldout', a.heldout_trials)):
            for c in conds:
                for i in range(n):
                    rec = run_trial(c, split, i, out, a.min_points)
                    records.append(rec)
                    fh.write(json.dumps(rec, sort_keys=True, ensure_ascii=False, allow_nan=False) + '\n')
    summary = {'schema': SCHEMA, 'conditions_sha256': hashlib.sha256(pre_bytes).hexdigest(),
               'core_version': ct.VERSION, 'trials': len(records), 'by_condition': summarize(records),
               'exploratory_threshold': explore_threshold(records),
               'authority_boundary': 'Synthetic research-software QC operating curve; not biological, clinical, wet-lab or competition validation.'}
    (out / 'summary.json').write_text(json.dumps(summary, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({'trials': len(records), 'conditions_sha256': summary['conditions_sha256'], 'summary': str(out / 'summary.json')}, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
