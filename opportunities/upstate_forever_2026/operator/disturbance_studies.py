"""Disturbance/protection desk in the existing operator and task queue."""
from pathlib import Path
from model import disturbance_studies as model
from model.common import identifier, verify_file


class DisturbanceOperations:
    def __init__(self, operator, fault):
        self.operator, self.Fault = operator, fault

    def read(self, workspace_key, operation, payload=None):
        ws = self.operator.ws(workspace_key)
        data = model.catalogue(ws)
        for study in data['studies']:
            study['_downloads'] = self._downloads(workspace_key, study)
        return data

    def invoke(self, task):
        ws = self.operator.ws(task['workspace'])
        value = task.get('payload', {})
        if task['action'] == 'disturbance.prepare':
            return model.prepare(ws, value.get('spec', value))
        if task['action'] == 'disturbance.report':
            return model.report(ws, identifier(value['study_id']))
        raise self.Fault('DISTURBANCE_ACTION', 'Choose an existing disturbance action', status=404)

    def _downloads(self, workspace, study):
        ws = self.operator.ws(workspace)
        return [self.operator._ticket(workspace, verify_file(ws.root, item), item, name.replace('_',' ').title())
                for name,item in study.get('files', {}).items()]

    def decorate_task(self, task):
        if task.get('action') not in ('disturbance.prepare','disturbance.report'):
            return task
        return {**task, '_downloads':self._downloads(task['workspace'],task.get('result') or {})}
