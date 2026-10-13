"""One request contract shared by the CLI and the original product adapter."""
from __future__ import annotations
from .model import Project, ModelError
from .solver import simulate, attribute_sources
from .inference import sensitivity, fit_observations, design_monitoring, uncertainty

MODES = ('simulate', 'attribute', 'sensitivity', 'calibrate', 'monitoring', 'uncertainty')

def execute(project: Project | dict, request: dict, *, cancelled=None, progress=None,
            checkpoint=None, resume=None) -> dict:
    p = Project(project) if isinstance(project, dict) else project
    if not isinstance(request, dict):
        raise ModelError('analysis request must be an object')
    mode = request.get('mode', 'simulate')
    if mode not in MODES:
        raise ModelError('mode must be one of ' + ', '.join(MODES))
    if mode == 'simulate':
        return simulate(p, request.get('sample_days'), targets=request.get('targets'),
                        cancelled=cancelled, progress=progress, checkpoint=checkpoint, resume=resume).result()
    if mode == 'attribute':
        return attribute_sources(p, request.get('sample_days'), targets=request.get('targets'),
                                 cancelled=cancelled, progress=progress)
    parameters = request.get('parameters', [])
    observations = request.get('observations', [])
    if mode == 'sensitivity':
        return sensitivity(p, parameters, observations, cancelled=cancelled)
    if mode == 'calibrate':
        return fit_observations(p, parameters, observations,
                                loss=request.get('loss', 'linear'),
                                max_evaluations=request.get('max_evaluations', 200),
                                cancelled=cancelled, progress=progress)
    if mode == 'monitoring':
        return design_monitoring(p, parameters, observations, count=request.get('count'),
                                 prior_precision=request.get('prior_precision'), cancelled=cancelled)
    return uncertainty(p, parameters, observations, draws=request.get('draws'), seed=request.get('seed'),
                       distributions=request.get('distributions', []), correlation=request.get('correlation'),
                       cancelled=cancelled, progress=progress)
