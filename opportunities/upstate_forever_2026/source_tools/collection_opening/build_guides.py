#!/usr/bin/env python3
"""Produce portable opening and API guides from the actual retained collection.

The output is a new directory for the existing collection assembler. Input
application, Workspace identities, source data and runtime payloads are read-only.
No live address, session capability, developer machine path or test workspace is
embedded in a delivered guide.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import stat
from pathlib import Path
import sys

if __package__:
    from .session_api import collection_member, receiving_binding
else:
    from session_api import collection_member, receiving_binding

STYLE = '''
:root{font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#202020;background:#f4f4f4}
*{box-sizing:border-box}body{margin:0}main{max-width:1040px;margin:auto;padding:32px 24px 64px}
header{padding:0 0 24px;border-bottom:2px solid #303030}h1{font-size:2rem;line-height:1.2;margin:8px 0 12px}
h2{font-size:1.3rem;margin:0 0 16px}h3{font-size:1rem;margin:0 0 8px}.eyebrow{font-size:.82rem;letter-spacing:.08em;text-transform:uppercase}
.lead{max-width:72ch;margin:0}nav{display:flex;flex-wrap:wrap;gap:12px 24px;padding:16px 0}
a{color:inherit;text-underline-offset:3px}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #333;outline-offset:4px}
section{background:white;border:1px solid #bdbdbd;padding:24px;margin:20px 0;scroll-margin-top:20px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.pane{border:1px solid #c4c4c4;padding:20px}
code,pre{font: .9rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}code{overflow-wrap:anywhere;background:#eee;padding:2px 4px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid #ccc;background:#f6f6f6;padding:16px}
p{margin:8px 0 16px}ol{padding-left:24px;margin:0}li{padding-left:4px;margin-bottom:10px}
.note{border-left:3px solid #666;padding:8px 16px;background:#f6f6f6}.small{font-size:.9rem;color:#4a4a4a}
button{font:inherit;border:1px solid #777;background:#eee;color:#222;padding:8px 14px;border-radius:2px;cursor:pointer}
button[aria-pressed=true]{background:#333;color:white}.switches{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 18px}
[hidden]{display:none!important}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}
th,td{border-bottom:1px solid #ccc;padding:12px 10px;vertical-align:top;overflow-wrap:anywhere}th{font-weight:600}th:last-child{min-width:7rem}td code{white-space:nowrap}
details{border-top:1px solid #ccc;padding:12px 0}summary{cursor:pointer;font-weight:600}details p{margin:12px 0 0}
footer{font-size:.85rem;color:#555;padding-top:12px}.path{word-break:break-word}
@media(max-width:640px){main{padding:20px 14px 40px}h1{font-size:1.7rem}section{padding:18px}.grid{grid-template-columns:1fr;gap:16px}th,td{padding:10px 6px}}
@media(max-width:640px){.api-routes,.api-routes tbody,.api-routes tr,.api-routes td{display:block}.api-routes thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.api-routes tr{border-bottom:1px solid #ccc;padding:12px 0}.api-routes td{border:0;padding:3px 0}.api-routes td:first-child{font-weight:600}.api-routes td:last-child:before{content:"Query: ";font-weight:600}}
@media print{body{background:white}main{padding:0}section{break-inside:avoid}nav,.switches{display:none}[data-platform]{display:block!important}}
'''
SCRIPT = '''
const buttons=[...document.querySelectorAll('[data-show]')];
function selectPlatform(name){
 buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.show===name)));
 document.querySelectorAll('[data-platform]').forEach(pane=>{pane.hidden=name!=='all'&&pane.dataset.platform!==name});
}
buttons.forEach(button=>button.addEventListener('click',()=>selectPlatform(button.dataset.show)));
const os=navigator.userAgent;selectPlatform(/Windows/i.test(os)?'windows':/Macintosh|Mac OS X/i.test(os)?'macos':'all');
'''


def text(value):
    return html.escape(str(value), quote=True)


def document(title, body, *, api=False):
    home = 'START_HERE.html' if api else '#opening'
    return ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="referrer" content="no-referrer">'
            '<title>' + text(title) + '</title><style>' + STYLE + '</style></head><body><main>'
            '<header><div class="eyebrow">Ecosystem Sciences Workbench</div><h1>' + text(title) + '</h1>'
            '<p class="lead">Your files, original studies and scientific tools in one local workbench.</p></header>'
            '<nav aria-label="Guide navigation"><a href="' + home + '">Opening guide</a>'
            '<a href="API_QUICKSTART.html">Local API</a><a href="OPENING.txt">Plain-text instructions</a></nav>'
            + body + '<footer>Keep this guide in the extracted collection beside its root launchers. '
            'The launcher, not a saved browser address, is the way back into the application.</footer>'
            '</main><script>' + SCRIPT + '</script></body></html>\n')


def _payload_rows(root, studies):
    path = collection_member(root, 'STUDY_PAYLOADS.json', required=False)
    if not path.exists():
        return {}
    manifest = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(manifest, dict)
            or manifest.get('schema') != 'upstate.collection-study-payloads/v1'
            or not isinstance(manifest.get('studies'), list)):
        raise ValueError('Select the original collection Study payload manifest')
    result = {}
    for row in manifest['studies']:
        if (not isinstance(row, dict) or row.get('workspace') not in studies
                or row['workspace'] in result
                or row.get('project_id') != studies[row['workspace']]['project_id']):
            raise ValueError('A Study payload differs from its retained collection row')
        result[row['workspace']] = row
    return result


def _project(root, application, row, payloads):
    workspace = collection_member(root, row['workspace'], required=False)
    if workspace.exists():
        path = collection_member(root, row['workspace'] + '/workspace.json')
        project = json.loads(path.read_text(encoding='utf-8'))
    else:
        payload = payloads.get(row['workspace'])
        archive = payload.get('archive') if isinstance(payload, dict) else None
        if (not isinstance(archive, dict) or type(archive.get('bytes')) is not int
                or archive['bytes'] <= 0 or not isinstance(archive.get('sha256'), str)
                or len(archive['sha256']) != 64
                or any(c not in '0123456789abcdef' for c in archive['sha256'])):
            raise ValueError('Receive the original native archive descriptor for ' + row['workspace'])
        path = collection_member(root, archive['path'])
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size != archive['bytes']:
            raise ValueError('The original Study archive is incomplete: ' + archive['path'])
        sys.path.insert(0, str(application))
        from model import portable
        # Reuse the receiver's original native metadata reader without restoring
        # or rehashing completed scientific payloads merely to render their names.
        original = portable.inspect_archive(path, verify=False)
        project = original.get('project')
    if (not isinstance(project, dict)
            or project.get('schema') != 'upstate.scientific-workbench/v1'
            or project.get('id') != row['project_id']):
        raise ValueError('A Workspace differs from its retained original identity')
    return project


def inventory(collection):
    root = Path(collection).expanduser().resolve(strict=True)
    manifest = json.loads((root / 'STUDIES.json').read_text(encoding='utf-8'))
    if not isinstance(manifest, dict) or manifest.get('schema') != 'upstate.portable-study-collection/v1':
        raise ValueError('Select the complete collection containing STUDIES.json')
    application = collection_member(root, manifest['application'])
    if not application.is_dir():
        raise ValueError('The selected application must be a directory')
    receiving = receiving_binding(manifest)
    studies = manifest['studies']
    by_path = {}
    for row in studies:
        if (not isinstance(row.get('workspace'), str) or not row['workspace'].startswith('workspaces/')
                or not isinstance(row.get('project_id'), str) or not row['project_id']
                or row['workspace'] in by_path):
            raise ValueError('Each retained Study needs its own original Workspace directory')
        collection_member(root, row['workspace'], required=False)
        by_path[row['workspace']] = row
    if any(a != b and b.startswith(a + '/') for a in by_path for b in by_path):
        raise ValueError('Original Workspace directories must not contain one another')
    payloads = _payload_rows(root, by_path)
    rows, projects = [], {}
    for row in studies:
        project = _project(root, application, row, payloads)
        projects[row['workspace']] = project
        if receiving is not None and row['workspace'] == receiving['workspace']:
            continue
        # Separately retained editions may share a project ID. Their distinct
        # original directories and displayed collection titles remain intact.
        rows.append({'title': str(row.get('title') or project.get('title') or row['project_id']),
                     'family': str(row.get('family', 'Reference study')),
                     'workspace': row['workspace'], 'project_id': row['project_id']})
    if not rows:
        raise ValueError('The collection contains no original reference studies')
    for name in ('Open_Workbench.cmd', 'Open_Workbench.command'):
        if not collection_member(root, name).is_file():
            raise ValueError('Join both maintained Windows/Mac root launchers before generating their guide')
    title = 'Tim — Own data'
    if receiving is not None:
        project = projects.get(receiving['workspace']) or _project(root, application, receiving, payloads)
        if project['id'] in {row['project_id'] for row in rows}:
            raise ValueError('Keep own-data identity separate from original reference projects')
        title = str(receiving.get('title') or project.get('title') or title)
    return root, manifest, rows, title


def render(collection):
    root, manifest, rows, title = inventory(collection)
    table = ''.join('<tr><td>' + text(row['title']) + '</td><td>' + text(row['family']) + '</td></tr>' for row in rows)
    body = '''<section id="opening"><h2>Open the workbench</h2>
<p>Extract the entire ZIP into a normal folder first. Keep <code>application/</code>, <code>workspaces/</code>,
the runtime files and the launchers together. Do not run it inside a ZIP preview.</p>
<div class="switches" role="group" aria-label="Choose your operating system">
<button type="button" data-show="windows" aria-pressed="false">Windows</button>
<button type="button" data-show="macos" aria-pressed="false">macOS</button>
<button type="button" data-show="all" aria-pressed="true">Both systems</button></div>
<div class="grid"><div class="pane" data-platform="windows"><h3>Windows x64</h3>
<ol><li>Open the extracted folder in File Explorer.</li><li>Double-click <code>Open_Workbench.cmd</code>.</li>
<li>Keep its terminal open while preparation runs. The workbench opens in your default browser when ready.</li></ol></div>
<div class="pane" data-platform="macos"><h3>Mac Intel or Apple Silicon</h3>
<ol><li>Open the extracted folder in Finder.</li><li>Double-click <code>Open_Workbench.command</code>.</li>
<li>The launcher selects the matching Mac runtime and opens the ready workbench in your default browser.
Keep its terminal open while working.</li></ol></div></div>
<p class="note">Open the launcher from File Explorer or Finder, not from this browser page.
This guide does not start the local server. Use the complete Windows/Mac release; no separate Python,
Node, compiler or GIS installation is part of normal opening.</p></section>
<section id="first-use"><h2>First opening and your own files</h2><p>The full collection opens into
<strong>''' + text(title) + '''</strong>. Use the Workspace selector to switch to an original reference study.
Keep your new data in the own-data Workspace so the supplied examples stay separate.</p>
<p>First opening prepares the selected runtime in your private user cache. Later opening reuses it.
Preparation can finish before a browser appears; read the launcher window rather than starting another copy.</p>
<p>For a table, inspect the original CSV or Excel file, choose the worksheet and header row, review the detected
columns and values, then save. Reopen the saved source to continue. For spatial files, retain the accompanying
files and review the coordinate system, source coverage and no-data interpretation before saving.</p></section>
<section id="studies"><h2>Included original reference studies</h2><p>''' + str(len(rows)) + ''' Workspace entries read from this collection's
<code>STUDIES.json</code>. Select them inside the running workbench.</p>
<div class="table-wrap"><table><thead><tr><th scope="col">Workspace</th><th scope="col">Study family</th></tr></thead><tbody>''' + table + '''</tbody></table></div>
<p class="small">Saved results, source objects and project identities remain in their original Workspaces.
Opening a guide or selecting a Workspace does not start a new model calculation.</p></section>
<section id="reopening"><h2>Reopen, close or move the collection</h2>
<details open><summary>Reopen an existing session</summary><p>Double-click the same root launcher again.
It checks the existing local session and opens its current address. A bookmarked temporary address can expire
when the workbench closes or restarts; use the launcher instead.</p></details>
<details><summary>Close the workbench</summary><p>Save the current form. Let active work finish, or use the
relevant task's stop/pause controls and wait for its status. Close the launcher-owned session with
<kbd>Ctrl+C</kbd> in its terminal. Closing only the browser tab does not close the server.</p></details>
<details><summary>Move the extracted folder</summary><p>Close its running session before moving it.
Move the whole collection, including its Workspaces. Open the launcher from the new location.
The relocated collection uses its new private session location and reuses the matching runtime cache.
Do not copy a private session record or an old browser address between locations or computers.</p></details>
<details><summary>Back up or restore a Workspace</summary><p>Use the workbench's backup/export controls to
save the complete working Workspace. Keep original data and sidecar files together. Restore into a separate
folder and reopen that retained project. A report alone is not a backup of its editable Workspace.</p></details></section>
<section id="help"><h2>When opening needs attention</h2>
<details><summary>Browser says the site cannot be reached</summary><p>Close the stale tab and use the root
launcher in the current extracted folder. Wait for the ready application. Do not guess a port number or use
an address copied from another machine.</p></details>
<details><summary>A runtime file is missing or its check fails</summary><p>Keep your saved Workspaces.
Extract the complete supplied release into a new folder and use its root launcher. Read the named file and
error in the terminal. Do not substitute a globally installed Python or mix runtime files from another release.</p></details>
<details><summary>Windows or macOS reports a security or permission message</summary><p>Read the exact
system message and verify that this is the release you intended to open. Follow your organization's normal
software-opening process. On Mac, also check that the ZIP was fully extracted and its
<code>.command</code> file kept its executable permissions. Leave system-wide protections in place.</p></details>
<details><summary>Where the files live</summary><p>Your data lives in the collection's
<code>workspaces/</code> folders. Private operator sessions are separate: Windows uses the local application-data
location; macOS uses <code>~/Library/Application Support/ecosystem-workbench/</code> unless explicitly
configured otherwise. Keep that private state out of archives and shared downloads.</p></details></section>'''
    api = '''<section><h2>Use the current local session</h2><p>Open the collection normally first. The API runs
inside that same workbench; its port is selected on opening. Authentication uses the current session capability.
The supplied reader finds the original session, checks its Workspace identity and uses its current address.
It does not start a second server or export the capability.</p>
<p>Run the example with the <strong>received native Python</strong> used by the workbench. For development,
you may also use an existing compatible Python. A separate Python installation is not required for ordinary desktop use.</p>
<pre>RECEIVED_PYTHON -B application/source_tools/collection_opening/session_api.py /api/whoami
RECEIVED_PYTHON -B application/source_tools/collection_opening/session_api.py /api/state --query compact=1
RECEIVED_PYTHON -B application/source_tools/collection_opening/session_api.py /api/extensions</pre>
<p><code>RECEIVED_PYTHON</code> means that interpreter's executable path, not a literal command.
Keep paths quoted when they contain spaces. Run from the extracted collection folder or pass
<code>--collection</code> with its location. If opening used a custom private state folder, also pass
<code>--operator-state</code> with that same folder.</p></section>
<section><h2>Select the Workspace explicitly</h2><p><code>/api/whoami</code> returns the current
<code>workspaces</code> list, each current Workspace <code>id</code> and retained <code>project_id</code>,
and <code>default_workspace</code>. Use a returned <code>id</code> for the Workspace query.</p>
<pre>RECEIVED_PYTHON -B application/source_tools/collection_opening/session_api.py /api/state --query workspace=RETURNED_WORKSPACE_ID --query compact=1</pre>
<p>Use the returned current identifier after a move or restore. Default requests use the current default
Workspace; they do not select an arbitrary original study. Read-only requests do not start model runs.</p></section>
<section><h2>Read routes</h2><div class="table-wrap"><table class="api-routes"><thead><tr><th>Route</th><th>Purpose</th><th>Query</th></tr></thead>
<tbody><tr><td><code>/api/whoami</code></td><td>Current identity and available Workspaces</td><td>None</td></tr>
<tr><td><code>/api/state</code></td><td>Selected Workspace state</td><td><code>workspace</code>, <code>compact=1</code></td></tr>
<tr><td><code>/api/extensions</code></td><td>Installed desks and dependencies</td><td><code>workspace</code></td></tr>
<tr><td><code>/api/runtime</code></td><td>Selected native runtime</td><td><code>workspace</code></td></tr>
<tr><td><code>/api/task</code></td><td>Existing task state</td><td><code>id</code></td></tr>
<tr><td><code>/api/native-job</code></td><td>Existing native-job state</td><td><code>workspace</code>, <code>id</code></td></tr>
<tr><td><code>/api/run-log</code></td><td>Retained native run log</td><td><code>workspace</code>, <code>id</code>, optional byte <code>offset</code></td></tr></tbody></table></div>
<p>Task, job and run identifiers come from the existing Workspace state. Use the browser's maintained controls
for mutations, cancellation or starting a calculation; this reader only supports the listed GET routes.</p></section>
<section><h2>Direct integration and recovery</h2><p>The local HTTP API authenticates with an
<code>Authorization: Bearer</code> header. Keep the current capability in private process memory;
do not put it in shared scripts, query strings, reports or logs. The reader implements the same request
through the maintained session module, including current-session and original-Workspace checks.</p>
<p>If it reports a closed session, reopen the current collection with its root launcher and repeat the request.
Do not reuse a port or private session file from a previous folder or another machine. Readiness comes from
the actual running application, not from a saved URL.</p>
<p>The optional Assistant uses the existing supported configuration and selected Workspace. Opening the
local API does not create provider credentials or configure an external service.</p></section>'''
    plain = ('ECOSYSTEM SCIENCES WORKBENCH\n\n'
             'Extract the complete ZIP first. Keep every included folder together.\n'
             'Windows x64: double-click Open_Workbench.cmd in File Explorer.\n'
             'Mac Intel / Apple Silicon: double-click Open_Workbench.command in Finder.\n'
             'Keep the launcher terminal open. It prepares the matching runtime and opens the ready browser.\n'
             'No separate Python, Node, compiler or GIS installation is part of normal desktop opening.\n\n'
             'OWN DATA\nOpen into ' + title + '. Select original studies from the Workspace selector.\n'
             'Inspect your original file, select its worksheet/header or spatial interpretation, review and save.\n\n'
             'ORIGINAL REFERENCE WORKSPACES\n' + ''.join(row['title'] + ' [' + row['family'] + ']\n' for row in rows) +
             '\nREOPEN / CLOSE / MOVE\nUse the same root launcher to reopen its current live session.\n'
             'Save first; let active work finish or use its stop/pause controls. Ctrl+C in the terminal closes the session.\n'
             'Close before moving the whole collection. Reopen from the new folder. Keep private session files separate.\n'
             'An expired browser address is repaired by reopening the launcher, not by guessing another port.\n\n'
             'MORE HELP\nOpen START_HERE.html for opening, backup, restore and troubleshooting.\n'
             'Open API_QUICKSTART.html for current-session read-only API use.\n')
    return {'START_HERE.html': document('Open your workbench', body),
            'API_QUICKSTART.html': document('Local API quickstart', api, api=True),
            'OPENING.txt': plain}, rows


def build(collection, output):
    root = Path(collection).expanduser().resolve(strict=True)
    output = Path(output).expanduser().absolute()
    manifest_before = (root / 'STUDIES.json').read_bytes()
    payload_path = root / 'STUDY_PAYLOADS.json'
    payload_before = payload_path.read_bytes() if payload_path.exists() else None
    content, rows = render(root)
    if (root / 'STUDIES.json').read_bytes() != manifest_before:
        raise ValueError('The collection selection changed while generating the guide; use its completed selection')
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation preserves even an empty concurrent destination. A
    # completed GUIDES.json is the final file, so interrupted output is explicit.
    output.mkdir()
    files = []
    for name, value in content.items():
        body = value.encode('utf-8')
        with (output / name).open('xb') as stream:
            stream.write(body); stream.flush(); os.fsync(stream.fileno())
        files.append({'path': name, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    if ((root / 'STUDIES.json').read_bytes() != manifest_before
            or (payload_path.read_bytes() if payload_path.exists() else None) != payload_before):
        raise ValueError('The collection selection changed before guide publication')
    result = {'schema': 'upstate.collection-opening-guides/v1',
              'collection_manifest_sha256': hashlib.sha256(manifest_before).hexdigest(),
              'reference_workspaces': len(rows), 'files': files}
    if payload_before is not None:
        result['study_payloads_manifest_sha256'] = hashlib.sha256(payload_before).hexdigest()
    with (output / 'GUIDES.json').open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2); stream.write('\n')
        stream.flush(); os.fsync(stream.fileno())
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('collection', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(build(args.collection, args.output), indent=2))
        return 0
    except (OSError, ValueError, KeyError) as error:
        print('Collection guide: ' + str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
