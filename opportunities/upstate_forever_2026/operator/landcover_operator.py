"""Read/action/download hooks for the original shared operator extension host."""
import base64
import hashlib
import re

from model import landcover_workspace

ACTIONS = {'landcover.ledger.build'}


def _downloads(operator, workspace_key, edition):
    workspace = operator.ws(workspace_key)
    directory = workspace.root / landcover_workspace.KIND / edition['id']
    return [operator._ticket(workspace_key, directory / row['path'], row,
                             'Land-cover: ' + name)
            for name, row in edition['files'].items()]


def invoke(operator, workspace_key, action, payload):
    if action not in ACTIONS:
        raise ValueError('Choose the original land-cover ledger action')
    return landcover_workspace.build(operator.ws(workspace_key), payload)


def read(operator, workspace_key, operation, payload):
    workspace = operator.ws(workspace_key)
    if operation == 'catalog':
        return landcover_workspace.catalog(workspace)
    if operation == 'inputs':
        return landcover_workspace.preview_inputs(workspace, payload['selection'])
    if operation == 'edition':
        result = landcover_workspace.inspect(workspace, payload['id'])
        result['_downloads'] = _downloads(operator, workspace_key, result['edition'])
        result['preview_url'] = _preview_url(workspace_key, result['edition']['id'])
        return result
    raise ValueError('Choose an existing land-cover ledger reader')


def overview(operator, workspace_key):
    return landcover_workspace.overview(operator.ws(workspace_key))


def decorate_task(operator, task):
    if task['action'] in ACTIONS and task['state'] == 'complete':
        task['_downloads'] = _downloads(operator, task['workspace'], task['result'])
    return task


def _preview_url(workspace_key, edition_id):
    # Identifiers, never provider URLs or caller-selected filesystem paths.
    if not re.fullmatch(r'[A-Za-z0-9_-]+', workspace_key):
        raise ValueError('Invalid original workspace key')
    if not re.fullmatch(r'[0-9a-f]{64}', edition_id):
        raise ValueError('Invalid original land-cover edition')
    return f'/api/file/landcover-ledger/{workspace_key}/{edition_id}?embedded=1'


def preview(operator, workspace_key, edition_id):
    """Return the original verified HTML ticket and an exact-content CSP.

    ECSA's file_routes host owns file-cookie authorization and send_file. The
    report is read from its retained edition, not supplied by the request.
    """
    _preview_url(workspace_key, edition_id)
    workspace = operator.ws(workspace_key)
    edition = landcover_workspace.inspect(workspace, edition_id)['edition']
    descriptor = edition['files']['report.html']
    path = workspace.root / landcover_workspace.KIND / edition_id / descriptor['path']
    data = path.read_bytes()
    if len(data) != descriptor['bytes'] or hashlib.sha256(data).hexdigest() != descriptor['sha256']:
        raise ValueError('Retained report changed during preview creation')
    html = data.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')
    def hashes(tag):
        bodies = re.findall(r'<' + tag + r'\b[^>]*>(.*?)</' + tag + r'\s*>', html, re.S | re.I)
        return ' '.join(dict.fromkeys("'sha256-" + base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode('ascii') + "'" for body in bodies)) or "'none'"
    policy = "; ".join(("default-src 'none'", 'script-src ' + hashes('script'),
                        'style-src ' + hashes('style'), "connect-src 'none'",
                        "object-src 'none'", "base-uri 'none'", "form-action 'none'",
                        "frame-ancestors 'self'", 'sandbox allow-scripts allow-downloads allow-modals'))
    ticket = operator._ticket(workspace_key, path, descriptor, 'Land-cover report')
    return ticket, policy
