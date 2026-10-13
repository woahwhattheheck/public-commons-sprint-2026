"""Receive a saved margin review through the original Economic operator queue.

Default operation previews every selected profile. --publish saves the same
source-bound Economic editions through economic.edition.build. Reusing an output
journal resumes the original task/operation rather than submitting new model work.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import fcntl
import sys
import importlib.util
import json
from pathlib import Path
import re
import time
from types import SimpleNamespace
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.pending')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def require(condition, message):
    if not condition:
        raise ValueError(message)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('The original authenticated operator must not redirect this request.')


class OriginalOperator:
    def __init__(self, application, url_file):
        # Use the original operator receiver's URL semantics, rather than a new
        # sign-in, token source, local server, browser driver or credential store.
        source = application / 'operator/economic_receive.py'
        spec = importlib.util.spec_from_file_location('_margin_original_economic_receiver', source)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        _, self.origin, self.token = module.read_url(SimpleNamespace(
            operator_url_file=str(url_file), operator_url_env='UNUSED_MARGIN_OPERATOR_URL'))
        self.opener = build_opener(NoRedirect())

    def clean(self, value):
        if isinstance(value, dict):
            return {key: self.clean(item) for key, item in value.items()
                    if not key.startswith('_') and key.lower() not in {
                        'open_url', 'operator_url', 'download_url', 'token', 'authorization'}}
        if isinstance(value, list):
            return [self.clean(item) for item in value]
        if isinstance(value, str):
            value = value.replace(self.token, '[redacted]')
            return re.sub(re.escape(self.origin) + r'([^\s?#]*)[?#][^\s]*',
                          self.origin + r'\1[private-parameters-removed]', value)
        return value

    def request(self, path, body=None, **query):
        require(path.startswith('/api/') and '://' not in path, 'Use an original relative operator API route.')
        url = self.origin + path + ('?' + urlencode(query) if query else '')
        req = Request(url, data=None if body is None else canonical(body), headers={
            'Authorization': 'Bearer ' + self.token, 'Origin': self.origin, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(req, timeout=45) as response:
                return json.load(response)
        except HTTPError as error:
            try:
                detail = json.loads(error.read()).get('error', {})
                text = detail.get('message', 'Original operator request failed.')
            except (ValueError, AttributeError):
                text = 'Original operator request failed.'
            raise RuntimeError('Original operator HTTP ' + str(error.code) + ': ' + self.clean(text)) from None
        except URLError:
            raise RuntimeError('The supplied original operator could not be reached. Its saved operation journal is retained.') from None


def receive(args):
    study, inputs = read(args.study), read(args.inputs)
    require(study.get('schema') == 'upstate.scenario-margin/v1', 'Supply the complete saved margin study.')
    require(inputs.get('schema') == 'upstate.scenario-margin-native-inputs/v1', 'Use Download original Economic inputs in the margin desk.')
    require(inputs.get('source_id') == study['source_id'] and inputs.get('project_id') == study['project_id'],
            'The review belongs to a different retained study or project.')
    profiles = {item['id']: item for item in study['profiles']}
    actions = inputs.get('actions')
    require(isinstance(actions, list) and actions, 'Choose at least one original profile.')
    require(len({item['profile_id'] for item in actions}) == len(actions), 'Do not repeat a profile in the same review.')
    for item in actions:
        require(item.get('action') == 'economic.edition.build' and item.get('profile_id') in profiles,
                'Only original Economic edition actions for this retained study are accepted.')
        p, payload = profiles[item['profile_id']], item['payload']
        require((payload.get('report_id'), payload.get('report_sha256'), payload.get('zone_id')) ==
                (p['producer_report_id'], p['report_sha256'], study['zone_id']),
                'Preserve the full original native report, exact source hash and reporting zone.')
        require(payload.get('selection', {}).get('comparison_id') == p['selection']['comparison_id'],
                'The review must retain its original comparison.')
    args.output.mkdir(parents=True, exist_ok=True)
    target = args.output / 'receiving.json'
    identity = {'source_id': study['source_id'], 'project_id': study['project_id'],
                'workspace_key': args.workspace_key, 'inputs_sha256': sha(canonical(inputs))}
    journal = read(target) if target.exists() else {'schema': 'upstate.scenario-margin-receiving/v1',
              **identity, 'started_at': datetime.now(timezone.utc).isoformat(), 'profiles': {}}
    require(all(journal.get(k) == v for k, v in identity.items()),
            'Use a new receiving directory for different source, inputs or original workspace.')
    client = OriginalOperator(args.application.resolve(), args.operator_url_file)
    save(target, journal)
    # Preview the complete selection before admitting any edition action.
    for item in actions:
        profile_id, payload = item['profile_id'], item['payload']
        preview = client.request('/api/economic-desk/preview', {'workspace': args.workspace_key, **payload})
        report = preview['report']; p = profiles[profile_id]
        require(report['project']['id'] == study['project_id'] and
                report['scope']['reference_profile_id'] == profile_id and
                report['scope']['grid_id'] == study['grid_id'], 'The native preview belongs to another scientific scope.')
        require(report['baseline']['run_id'] == p['run_ids'][0] and
                {row['run_id'] for row in report['alternatives']} == set(p['run_ids'][1:]),
                'The original preview changed the selected native cohort.')
        original = {row['run_id']: row for row in p['report']['alternatives']}
        for row in report['alternatives']:
            require(row['outputs'] == original[row['run_id']]['outputs'],
                    'Cost/target receiving must not change any original physical output or support.')
        name = 'preview-' + profile_id + '.json'; save(args.output / name, client.clean(preview))
        status = journal['profiles'].setdefault(profile_id, {})
        status['preview'] = name; status['preview_report_id'] = report['id']; save(target, journal)
    if args.publish:
        for item in actions:
            profile_id, payload = item['profile_id'], item['payload']
            status = journal['profiles'][profile_id]
            operation = 'margin-' + sha(canonical({'identity': identity, 'payload': payload}))[:56]
            request = {'workspace': args.workspace_key, 'action': 'economic.edition.build',
                       'operation_id': operation, 'payload': payload}
            require(not status.get('request') or status['request'] == request, 'The retained original operation differs.')
            status['request'] = request; save(target, journal)
            task = client.request('/api/task', id=status['task_id']) if status.get('task_id') else client.request('/api/actions', request)
            status['task_id'] = task['id']; save(target, journal)
            deadline = time.monotonic() + args.task_timeout
            while task['state'] not in ('complete', 'failed', 'cancelled', 'interrupted'):
                if time.monotonic() >= deadline:
                    raise TimeoutError('Original task ' + task['id'] + ' remains active. Resume with the same receiving directory.')
                time.sleep(.25); task = client.request('/api/task', id=task['id'])
            status['state'] = task['state']; status['result'] = client.clean(task.get('result'))
            status['error'] = client.clean(task.get('error')); save(target, journal)
            require(task['state'] == 'complete', 'Original Economic task ended ' + task['state'] + ': ' + str(status['error']))
            print(json.dumps({'profile_id': profile_id, 'task_id': task['id'],
                              'edition_id': task['result']['id'], 'state': task['state']}), flush=True)
    journal['status'] = 'published' if args.publish else 'previewed'
    journal['completed_at'] = datetime.now(timezone.utc).isoformat(); save(target, journal)
    return {'status': journal['status'], 'profiles': len(actions), 'receiving': str(target)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--application', required=True, type=Path)
    p.add_argument('--study', required=True, type=Path)
    p.add_argument('--inputs', required=True, type=Path)
    p.add_argument('--operator-url-file', required=True, type=Path)
    p.add_argument('--workspace-key', required=True)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--task-timeout', type=float, default=180)
    p.add_argument('--publish', action='store_true')
    args = p.parse_args()
    require(args.task_timeout > 0, 'Use a positive wait interval; timed-out native tasks stay in their existing queue.')
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / 'receiving.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('This exact receiving journal has an active operator. Preserve that process.') from None
        print(json.dumps(receive(args), indent=2))


if __name__ == '__main__':
    main()
