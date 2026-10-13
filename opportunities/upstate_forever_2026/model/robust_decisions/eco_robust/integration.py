"""Original operator task dispatch and implementation-workflow selection export.

The original operator remains responsible for action admission, idempotency,
execution queues and task status. This module neither spawns nor schedules work.
"""
from __future__ import annotations
import time
import numpy as np
from .engine import Problem, canonical_hash
from .operations import DecisionWorkspace
from .schema import Study

ACTION_NAMES = frozenset({
    'robust.study.list', 'robust.study.read', 'robust.study.create', 'robust.study.revise',
    'robust.experiment.prepare', 'robust.summary.prepare', 'robust.diagnostic.prepare', 'robust.solve', 'robust.frontier',
    'robust.project.export', 'robust.project.receive', 'robust.selection.export', 'robust.report.export',
})


def selection_packet(study, answer):
    s = study if isinstance(study, Study) else Study.model_validate(study)
    digest = canonical_hash(s.model_dump())
    if answer.get('schema_version') != 'ecosci.robust-result/1' or answer.get('study_sha256') != digest:
        raise ValueError('Selection export needs a single decision bound to these exact inputs')
    r = answer['result']; selected = r.get('selected_ids')
    if selected is None:
        raise ValueError('This calculation has no feasible selected portfolio')
    ids = {c.id for c in s.candidates}
    if len(selected) != len(set(selected)) or not set(selected) <= ids:
        raise ValueError('Selected candidate identities do not match the study')
    p = Problem(s, time.monotonic()+1, 0)
    x = np.array([int(c.id in selected) for c in s.candidates])
    if not p.evaluate(x):
        raise ValueError('The selected portfolio does not satisfy this study revision')
    measured = p.detail({'x': x, 'status': r['status']})
    return {'schema_version': 'ecosci.robust-selection/1', 'title': s.title, 'mode': s.mode,
            'study_sha256': digest, 'result_sha256': canonical_hash(answer),
            'execution': answer.get('execution', {}), 'objective': answer['objective'],
            'solver_status': r['status'], 'selected_ids': selected,
            'cost': measured['cost'], 'cost_units': s.cost_units, 'capacity_used': measured['capacity_used'],
            'candidates': [c.model_dump() for c in s.candidates if c.id in selected],
            'profiles': [p.model_dump() for p in s.profiles],
            'metrics': [m.model_dump() for m in s.metrics],
            'profile_outcomes': measured['profiles'],
            'selected_original_cells': [c.model_dump() for c in s.cells if c.candidate_id in selected],
            'source': s.source, 'additive_basis': s.additive_basis}


def dispatch(original_workspace, action: str, payload: dict, *, operation_id=None):
    """Call from original Operator._invoke after its existing action admission."""
    if action not in ACTION_NAMES:
        raise ValueError(f'Unknown robust action: {action}')
    ws = DecisionWorkspace(original_workspace); ws.recover()
    if action == 'robust.study.list': return {'studies': ws.store.list()}
    if action == 'robust.study.read': return ws.store.read(payload['study_id'], payload.get('revision'))
    if action == 'robust.study.create': return ws.store.create(payload['study'], operation_id=operation_id)
    if action == 'robust.study.revise': return ws.store.revise(payload['study_id'], payload['study'], payload['expected_revision'], operation_id=operation_id)
    if action == 'robust.experiment.prepare': return ws.import_experiment(payload['experiment_id'], payload['configuration'], operation_id=operation_id)
    if action == 'robust.summary.prepare': return ws.import_summary(payload['summary'], payload['configuration'], operation_id=operation_id)
    if action == 'robust.diagnostic.prepare': return ws.import_diagnostic(payload['diagnostic_id'], payload['report_sha256'], payload['configuration'], operation_id=operation_id)
    if action == 'robust.solve': return ws.solve(payload['study_id'], payload['revision'], payload.get('objective','worst_case'), time_limit=payload.get('time_limit',60), mip_rel_gap=payload.get('mip_rel_gap',0), operation_id=operation_id)
    if action == 'robust.frontier': return ws.frontier(payload['study_id'], payload['revision'], payload['budgets'], payload.get('objective','worst_case'), time_limit=payload.get('time_limit',60), operation_id=operation_id)
    if action == 'robust.project.export': return ws.store.export(payload['study_id'])
    if action == 'robust.project.receive': return ws.store.receive(payload['project'], operation_id=operation_id)
    run = ws.store.read_run(payload['study_id'], payload['run_id'])
    study = ws.store.read(payload['study_id'], run['revision'])['study']
    if run['result'] is None:
        raise ValueError('The selected calculation has no result')
    if action == 'robust.selection.export': return selection_packet(study, run['result'])
    from .reports import html_report, csv_report
    format = payload.get('format', 'html')
    if format not in ('html','csv'):
        raise ValueError('Choose html or csv')
    return {'media_type': 'text/html' if format == 'html' else 'text/csv',
            'filename': 'decision-report.'+format,
            'content': (html_report if format == 'html' else csv_report)(study,run['result'])}
