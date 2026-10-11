'''candidate084 public-Objective integration runner (development evidence only).

One cell is (candidate source, public UIFO topology_seed, algorithm random_seed,
Objective max_time). The runner uses the installed dfbench Objective as an organizer
harness would and records the raw logged loss, feasibility and time histories. It never
assigns an official score, never touches hidden topologies, and writes only to a fresh file.
--static-only performs an AST contract check without importing dfbench.
'''
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
import platform
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

PACKAGES = ('dfbench', 'differometor', 'jax', 'jaxlib', 'numpy', 'optax', 'scipy', 'learn2design')
SAVE_TOKENS = ['batched_loss', 'is_feasible', 'batched_is_feasible',
               'sensitivity_loss', 'batched_sensitivity_loss']
CHECKPOINT_FRACTIONS = (0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0)


def identity(path):
    data = Path(path).read_bytes()
    header = b'blob ' + str(len(data)).encode() + bytes([0])
    return {'path': str(path), 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
            'git_blob_sha1': hashlib.sha1(header + data).hexdigest()}


def static_contract(path):
    tree = ast.parse(Path(path).read_text(encoding='utf-8'))
    subclasses, forbidden, private = [], [], []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            for base in node.bases:
                name = base.id if isinstance(base, ast.Name) else getattr(base, 'attr', None)
                if name == 'OptimizationAlgorithm':
                    subclasses.append(node.name)
        if isinstance(node, ast.Import):
            forbidden += [a.name for a in node.names if a.name.split('.')[0] == 'differometor']
        if isinstance(node, ast.ImportFrom) and (node.module or '').split('.')[0] == 'differometor':
            forbidden.append(node.module)
        if isinstance(node, ast.Attribute) and node.attr.startswith('_') and not node.attr.startswith('__'):
            if isinstance(node.value, ast.Name) and node.value.id in ('obj', 'objective'):
                private.append(node.attr)
    calls = {n.func.attr for n in ast.walk(tree)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    report = {'one_subclass': len(subclasses) == 1, 'subclasses': subclasses,
              'forbidden_imports': forbidden, 'private_objective_access': sorted(set(private)),
              'calls_start_logging': 'start_logging' in calls,
              'raw_callable_or_manual_log': sorted(calls & {'value_function', 'value_function_aux', 'log_evaluation'})}
    report['pass'] = bool(report['one_subclass'] and not forbidden and not private
                          and report['calls_start_logging'])
    return report


def load_algorithm(path):
    import dfbench
    spec = importlib.util.spec_from_file_location('_cell_candidate', path)
    if spec is None or spec.loader is None:
        raise ValueError('cannot import candidate')
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    found = [c for c in vars(mod).values() if isinstance(c, type)
             and issubclass(c, dfbench.OptimizationAlgorithm) and c.__module__ == spec.name]
    if len(found) != 1:
        raise ValueError('candidate must define exactly one OptimizationAlgorithm subclass')
    cls, adapter = found[0], None
    abstract = set(getattr(cls, '__abstractmethods__', ()) or ())
    if abstract:
        if abstract != {'__init__'}:
            raise ValueError('unexpected abstract members: ' + repr(sorted(abstract)))
        cls = type(cls.__name__ + 'NoOpInit', (cls,), {'__init__': lambda self: None})
        adapter = 'no-op __init__ subclass; optimize and algorithm_str inherited unchanged'
    return cls, adapter


def json_safe(value):
    import numpy as np
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        f = float(value)
        return f if math.isfinite(f) else None
    if value is None or isinstance(value, str):
        return value
    return repr(value)


def flatten(objective):
    import numpy as np
    losses = objective.loss_history
    feas = objective.is_feasible_history
    times = objective.time_steps
    if len(feas) != len(losses):
        raise ValueError('is_feasible history missing or misaligned with loss history')
    L, F, K, T, widths = [], [], [], [], []
    for i, (l, f) in enumerate(zip(losses, feas)):
        a = np.atleast_1d(np.asarray(l, dtype=np.float64)).reshape(-1)
        if f is None:
            fa, known = np.zeros(a.shape, bool), np.zeros(a.shape, bool)
        else:
            fa = np.atleast_1d(np.asarray(f)).reshape(-1)
            if fa.dtype.kind != 'b':
                raise ValueError('non-boolean feasibility at call %d' % i)
            if fa.shape != a.shape:
                raise ValueError('reduced feasibility cannot align with batched losses at call %d' % i)
            known = np.ones(a.shape, bool)
        t = float(times[i]) if i < len(times) else float('nan')
        L.append(a); F.append(fa.astype(bool)); K.append(known); T.append(np.full(a.shape, t))
        widths.append(int(a.size))
    if not L:
        raise ValueError('no logged evaluations')
    return (np.concatenate(L), np.concatenate(F), np.concatenate(K), np.concatenate(T), widths)


def metrics(objective, seconds):
    import numpy as np
    L, F, K, T, widths = flatten(objective)
    finite = np.isfinite(L)
    fe = F & K & finite
    out = {'logged_points': int(L.size), 'logged_calls': len(widths),
           'eval_count': int(objective.eval_count),
           'eval_count_matches_points': int(L.size) == int(objective.eval_count),
           'feasible_points': int(fe.sum()),
           'feasibility_fraction': float(fe.sum()) / max(1, int(L.size)),
           'unknown_feasibility_points': int((~K).sum()),
           'best_raw_loss': float(L[finite].min()) if finite.any() else None,
           'best_feasible_loss': None, 'time_to_first_feasible_s': None,
           'time_to_best_feasible_s': None, 'best_feasible_by_budget_fraction': {},
           'official_score': None}
    if fe.any():
        idx = np.flatnonzero(fe)
        best = idx[np.argmin(L[idx])]
        out['best_feasible_loss'] = float(L[best])
        out['time_to_first_feasible_s'] = float(T[idx[0]])
        out['time_to_best_feasible_s'] = float(T[best])
        for frac in CHECKPOINT_FRACTIONS:
            mask = fe & (T <= frac * seconds)
            out['best_feasible_by_budget_fraction'][str(frac)] = float(L[mask].min()) if mask.any() else None
    raw = {'call_widths': widths, 'loss': json_safe(L.tolist()), 'is_feasible': F.tolist(),
           'feasibility_known': K.tolist(), 'time_s': json_safe(T.tolist())}
    return out, raw


def environment(organizer):
    import jax
    env = {'python': platform.python_version(), 'platform': platform.platform(),
           'cpu_count': os.cpu_count(), 'jax_backend': jax.default_backend(),
           'jax_x64': bool(jax.config.x64_enabled), 'devices': [str(d) for d in jax.devices()],
           'packages': {}}
    for name in PACKAGES:
        try:
            env['packages'][name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            env['packages'][name] = None
    if shutil.which('nvidia-smi'):
        try:
            r = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,driver_version',
                                '--format=csv,noheader'], capture_output=True, text=True, timeout=20)
            env['nvidia_smi'] = r.stdout.strip()
        except Exception as exc:
            env['nvidia_smi'] = 'error: ' + repr(exc)
    if organizer:
        try:
            env['organizer_revision'] = subprocess.check_output(
                ['git', '-C', str(organizer), 'rev-parse', 'HEAD'], text=True).strip()
        except Exception as exc:
            env['organizer_revision'] = 'error: ' + repr(exc)
    return env


def run_cell(candidate, topology_seed, algorithm_seed, seconds, population_size, organizer):
    from dfbench import Objective
    from dfbench.problems import UIFOProblem
    static = static_contract(candidate)
    before = identity(candidate)
    cls, adapter = load_algorithm(candidate)
    t0 = time.perf_counter()
    problem = UIFOProblem(topology_seed=topology_seed)
    objective = Objective(problem, max_time=seconds, save=list(SAVE_TOKENS),
                          save_params_history=False, verbose=0)
    build_s = time.perf_counter() - t0
    algorithm = cls()
    kwargs = {'random_seed': algorithm_seed}
    if population_size is not None:
        kwargs['population_size'] = population_size
    error = None
    t1 = time.perf_counter()
    try:
        algorithm.optimize(objective, **kwargs)
    except Exception as exc:
        error = repr(exc)[:4000]
    wall = time.perf_counter() - t1
    after = identity(candidate)
    try:
        result, raw = metrics(objective, seconds)
    except Exception as exc:
        result, raw = {'metrics_error': repr(exc)}, None
    req = Path(candidate).with_name('requirements.txt')
    # -- REPORTING REPAIR (SWE-2, 2026-10-10) ---------------------------------
    # The received lines labeled every error-free run
    # COMPLETE_NO_FEASIBLE_POINT_RANDOM_SEARCH_FALLBACK_WOULD_APPLY even when
    # metrics() failed, the logged-point/eval-count integrity check failed, or
    # the candidate bytes changed mid-run -- all cases with no valid logged
    # evidence. The decision is now delegated to classify_cell(), defined in the
    # completed tail below, which keeps a genuinely valid no-feasible run a
    # distinct development outcome and makes invalid evidence explicit.
    status = classify_cell(error, result, before == after)
    try:
        spec = objective.problem_spec
    except Exception as exc:
        spec = 'unavailable: ' + repr(exc)
    return {
        'schema': 'tjlabs.l2d.candidate084.public-uifo-cell/v1',
        'evidence_class': 'SELF_REPORTED_PUBLIC_UIFO_DEVELOPMENT',
        'authority': {'official_score': False, 'hidden_topology': False, 'submission': False,
                      'prize': False, 'payment': False, 'h100_parity_claimed': False},
        'observed_at': datetime.now(timezone.utc).isoformat(),
        'cell': {'problem': 'UIFOProblem', 'topology_seed': topology_seed,
                 'algorithm_seed': algorithm_seed, 'max_time_s': seconds,
                 'population_size_override': population_size, 'save_tokens': SAVE_TOKENS},
        'problem_spec': json_safe(spec),
        'candidate_before': before, 'candidate_after': after,
        'candidate_unchanged': before == after,
        'requirements': identity(req) if req.exists() else None,
        'runner': identity(Path(__file__)), 'static_contract': static,
        'algorithm_str': getattr(cls, 'algorithm_str', None), 'constructor_adapter': adapter,
        'algorithm_diagnostics': json_safe(getattr(algorithm, 'last_run_diagnostics', None)),
        'environment': environment(organizer),
        'budget': {'budget_exceeded': bool(objective.budget_exceeded),
                   'objective_time_elapsed_s': float(objective.time_elapsed),
                   'problem_build_s': build_s, 'optimize_wall_s_incl_warmup': wall,
                   'returned_before_budget': not bool(objective.budget_exceeded),
                   'container_cap_4h30_risk': (build_s + wall) > 16200.0},
        'error': error, 'metrics': result, 
        # -- COMPLETION MARKER ---------------------------------------------------
        # The provider stream was truncated by max_tokens immediately after the
        # 'metrics': result, line above. Everything from this line down is SWE-2
        # supervised engineering (2026-10-10), NOT provider text. It finishes the
        # record literal per the received schema and adds the CLI promised by the
        # received docstring (--static-only; one cell per invocation), following
        # the accepted curvature/public_run.py runner conventions.
        'status': status,
        'raw': raw,
    }


# Status vocabulary for one development cell. COMPLETE_* values are valid
# runs; anything else is an error or an evidence-integrity failure and must not
# be read as a valid no-feasible outcome. None of these is an official score.
STATUS_ERROR = 'ERROR'
STATUS_INVALID = 'INVALID_NO_VALID_LOGGED_EVIDENCE'
STATUS_FEASIBLE = 'COMPLETE_WITH_FEASIBLE_POINT'
STATUS_NO_FEASIBLE = 'COMPLETE_NO_FEASIBLE_POINT_RANDOM_SEARCH_FALLBACK_WOULD_APPLY'


def classify_cell(error, metrics_result, candidate_unchanged):
    '''Map a finished cell to its reporting status (stdlib-only, no dfbench).

    ERROR dominates everything: the algorithm raised during optimize().
    INVALID covers every case where the run produced no trustworthy logged
    evidence -- metrics() failed, the record is malformed, the logged point
    count does not match the Objective eval counter, no points were logged at
    all, or the candidate bytes changed during the run. A cell that produced
    valid logged evidence but no feasible point is a legitimate development
    outcome (the organizer fallback would apply); it is not an error and it is
    not a score.
    '''
    if error is not None:
        return STATUS_ERROR
    if candidate_unchanged is False:
        return STATUS_INVALID
    if not isinstance(metrics_result, dict) or 'metrics_error' in metrics_result:
        return STATUS_INVALID
    if metrics_result.get('eval_count_matches_points') is not True:
        return STATUS_INVALID
    if not metrics_result.get('logged_points'):
        return STATUS_INVALID
    # Feasibility must be KNOWN for every logged point. metrics() records an
    # explicit unknown_feasibility_points count whenever a history entry is
    # None; any nonzero (or missing/malformed) count means the evidence cannot
    # prove feasibility one way or the other, so the cell is INVALID rather
    # than a valid no-feasible outcome. Zero unknowns is required -- a valid
    # run may still end in either feasible or no-feasible.
    unknown = metrics_result.get('unknown_feasibility_points')
    if type(unknown) is not int or unknown != 0:
        return STATUS_INVALID
    if metrics_result.get('best_feasible_loss') is not None:
        return STATUS_FEASIBLE
    return STATUS_NO_FEASIBLE


def cli_exit(status):
    '''Exit code for a run cell: 0 only for a valid COMPLETE_* outcome.'''
    return 0 if isinstance(status, str) and status.startswith('COMPLETE_') else 1


def main():
    '''One development cell per invocation; --static-only needs no dfbench.'''
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate', type=Path, required=True,
                   help='path to the candidate submission.py')
    p.add_argument('--topology-seed', type=int, default=None,
                   help='public UIFO topology seed for this cell')
    p.add_argument('--algorithm-seed', type=int, default=None,
                   help='random_seed passed to algorithm.optimize')
    p.add_argument('--seconds', type=float, default=60.0,
                   help='Objective max_time for this cell; official per-topology cap is 14400')
    p.add_argument('--population-size', type=int, default=None,
                   help='optional batch-width override passed to optimize')
    p.add_argument('--organizer', type=Path, default=None,
                   help='optional local organizer checkout; records rev-parse in the report')
    p.add_argument('--out', type=Path, default=None,
                   help='fresh JSON report path (must not already exist)')
    p.add_argument('--static-only', action='store_true',
                   help='run the AST contract check only; imports no dfbench')
    args = p.parse_args()

    if args.static_only:
        report = {'candidate': identity(args.candidate),
                  'static_contract': static_contract(args.candidate)}
        print(json.dumps(report, sort_keys=True, indent=2))
        return 0 if report['static_contract']['pass'] else 2

    if args.topology_seed is None or args.algorithm_seed is None:
        p.error('--topology-seed and --algorithm-seed are required for a run cell')
    if args.out is None:
        p.error('--out is required for a run cell')
    if not math.isfinite(args.seconds) or not 0 < args.seconds <= 14400.0:
        p.error('seconds must be finite in (0, 14400]; the official per-topology budget')
    if args.population_size is not None and not 1 <= args.population_size <= 64:
        p.error('population-size must be in [1, 64]')
    if args.out.exists():
        p.error('output already exists; use a fresh run path')

    report = run_cell(str(args.candidate), args.topology_seed, args.algorithm_seed,
                      args.seconds, args.population_size, args.organizer)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # json_safe turns non-finite floats into null; allow_nan=False then acts as a
    # leak detector rather than silently writing NaN into the record.
    with args.out.open('x', encoding='utf-8') as f:
        json.dump(json_safe(report), f, sort_keys=True, indent=2, allow_nan=False)
        f.write('\n')
    metrics = report.get('metrics') or {}
    print(json.dumps({'status': report.get('status'),
                      'eval_count': metrics.get('eval_count'),
                      'logged_points': metrics.get('logged_points'),
                      'feasible_points': metrics.get('feasible_points'),
                      'best_feasible_loss': metrics.get('best_feasible_loss'),
                      'time_to_first_feasible_s': metrics.get('time_to_first_feasible_s'),
                      'budget_exceeded': report.get('budget', {}).get('budget_exceeded'),
                      'error': report.get('error')}, sort_keys=True))
    return cli_exit(report.get('status'))


if __name__ == '__main__':
    sys.exit(main())
