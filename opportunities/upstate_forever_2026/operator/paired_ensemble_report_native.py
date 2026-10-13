"""Retain a completed paired ensemble in the original scientific report workflow.

This additive registration uses the existing queue, Workspace source importer
and file tickets. Existing paired-analysis execution and readers stay unchanged.
"""
from pathlib import Path
from model.paired_ensemble.ensemble_report_source import prepare, export_source, inspect
from model.paired_ensemble.ensemble_store import identifier

ACTION = 'paired_ensemble.report_source'


def invoke(operator, workspace_key, action, payload):
    if action != ACTION:
        raise ValueError('Choose the registered paired-ensemble scientific report action')
    result = prepare(operator.ws(workspace_key), payload)
    destination = operator.root / 'outputs' / ('paired-ensemble-source-' + result['report_source_id'] + '.zip')
    # The original queue owns this potentially large operation. State reads
    # and task polling never recreate the retained raster archive.
    result['archive'] = export_source(result['directory'], destination)
    return result


def decorate_task(operator, task):
    if task.get('action') != ACTION or task.get('state') != 'complete':
        return task
    result = task['result']
    destination = operator.root / 'outputs' / ('paired-ensemble-source-' + identifier(result['report_source_id']) + '.zip')
    archive = result['archive']
    if Path(archive['path']).resolve() != destination.resolve():
        raise ValueError('Completed scientific source archive belongs to another result')
    task['_downloads'] = [operator._ticket(task['workspace'], destination, archive,
                                          'Complete ensemble scientific source')]
    task['_paired_ensemble_report_source'] = result['source_choice']
    return task


def verify_workspace(workspace):
    folder = workspace.root / 'ensemble-products' / 'report-sources'
    count = 0
    for path in sorted(folder.glob('*/report-source-record.json')):
        record = inspect(path.parent)
        if record['identity'].get('workspace_id') != workspace.project['id']:
            raise ValueError('Retained ensemble scientific source belongs to another workspace')
        count += 1
    return {'paired_ensemble_report_sources': count}
