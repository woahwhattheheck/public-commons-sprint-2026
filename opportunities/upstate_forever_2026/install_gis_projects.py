#!/usr/bin/env python3
"""Compose editable GIS with the maintained Operator; preserve unrelated source edits."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

MODEL_FILES = ('gis_study_context.py', 'gis_native_study.py', 'gis_project.py', 'gis_workspace.py', 'gis_edition_review.py', 'gis_review_raster.py', 'gis_review_raster_view.html',
               'gis_vector_review.py', 'gis_project_cli.py',
               'gis_project_native.py', 'gis_project_view.html', 'GIS_PROJECTS.md', 'requirements-gis.txt')
OWN_FILES = tuple('model/' + x for x in MODEL_FILES) + (
    'operator/gis_projects.py', 'operator/web/gis-projects.mjs', 'operator/web/gis-projects.css',
    'operator/extensions/gis-projects.json', 'operator/gis_vector_reviews.py',
    'operator/extensions/gis-vector-reviews.json',
    'source_tools/receive_native_study_gis.py', 'source/GIS_NATIVE_STUDY.md',
    'integration/component_fragments/gis-native-study.json')
SHARED_REPORT_FILES = {
    'operator/source_report_editions.py': {'f291275fad9ef4064d718a48012a0601b4bd7b4f60d5ccb1186646aa4a4c4756'},
    'operator/web/source_report_editions.mjs': {'9ab75d0a9b64d32087d74974d8d35af345dc3647a53146402e95a2832a50d302'},
}
MARKER = '# Editable GIS integration: ASTRA-GIS12/v1'


def sha(body):
    return hashlib.sha256(body).hexdigest()


def once(text, old, new, label):
    if text.count(old) != 1:
        raise ValueError('Original source seam differs: ' + label + '. Compose against its current owner revision.')
    return text.replace(old, new, 1)


def _base_server_source(text):
    if MARKER in text:
        return text
    text = once(text, 'class Operator:', MARKER + '\nfrom gis_projects import ACTIONS as GIS_ACTIONS, GISProjects\nACTIONS = set(ACTIONS) | GIS_ACTIONS\n\nclass Operator:', 'Operator declaration')
    # Select _invoke structurally; other extensions can use their own action local.
    tree = ast.parse(text)
    cls = next(x for x in tree.body if isinstance(x, ast.ClassDef) and x.name == 'Operator')
    fn = next(x for x in cls.body if isinstance(x, ast.FunctionDef) and x.name == '_invoke')
    lines = text.splitlines(keepends=True)
    body = ''.join(lines[fn.lineno - 1:fn.end_lineno])
    body = once(body, '        action = task["action"]\n', '        action = task["action"]\n        if action in GIS_ACTIONS:\n            return GISProjects(self).invoke(task)\n', '_invoke action')
    text = ''.join(lines[:fn.lineno - 1]) + body + ''.join(lines[fn.end_lineno:])
    # Existing review/task decorators remain the terminal writer.
    text = once(text, '        return self.customer_reviews.decorate_task(task)',
                '        task = GISProjects(self).decorate_task(task)\n        return self.customer_reviews.decorate_task(task)', 'task_view decorator')
    old = '            if url.path.startswith("/api/file/"):\n'
    new = '''            if url.path.startswith("/api/file/gis-project/"):
                self.authorized(file=True)
                parts = url.path.removeprefix("/api/file/gis-project/").split("/", 3)
                if len(parts) != 4:
                    raise ValueError("Choose an original GIS project member")
                ticket, policy = GISProjects(self.app).member(*[urllib.parse.unquote(x) for x in parts])
                return self.send_file(ticket["id"], download=one("download") == "1", content_security_policy=policy)
'''+old
    text = once(text, old, new, 'original file routing')
    old = '                workspace = one("workspace", self.app.primary)\n'
    text = once(text, old, old + '                if url.path == "/api/gis/projects":\n                    return self.send_json(200, GISProjects(self.app).catalogue(workspace))\n', 'original authorized GET workspace')
    tree = ast.parse(text)
    selected = [n for n in ast.walk(tree) if isinstance(n, ast.Compare) and
                isinstance(n.left, ast.Name) and n.left.id == 'selected' and
                len(n.ops) == 1 and isinstance(n.ops[0], ast.NotIn) and
                isinstance(n.comparators[0], ast.Set) and
                any(isinstance(e, ast.Constant) and e.value == 'app.mjs' for e in n.comparators[0].elts)]
    if len(selected) != 1:
        raise ValueError('Original browser asset admission changed')
    node = selected[0].comparators[0]
    rows = text.splitlines(keepends=True)
    before = sum(len(x.encode('utf-8')) for x in rows[:node.end_lineno - 1]) + node.end_col_offset - 1
    raw = text.encode('utf-8')
    text = (raw[:before] + b', "gis-projects.mjs", "gis-projects.css"' + raw[before:]).decode('utf-8')
    ast.parse(text)
    return text



VECTOR_MARKER = '# Working-vector review integration: ECO-264B/v1'
VECTOR_PROVIDER = (VECTOR_MARKER + '\n'
                   'from gis_vector_reviews import ACTION as GIS_VECTOR_ACTION, GISVectorReviews\n'
                   'ACTIONS = set(ACTIONS) | {GIS_VECTOR_ACTION}\n\n')
VECTOR_DISPATCH = ('        if action == GIS_VECTOR_ACTION:\n'
                   '            return GISVectorReviews(self, Fault).invoke(task)\n')
VECTOR_DECORATION = '        task = GISVectorReviews(self, Fault).decorate_task(task)\n'
VECTOR_ITEM = ('        if kind == "gis_vector_reviews":\n'
               '            return GISVectorReviews(self, Fault).read(workspace, "inspect", {"id": key})\n')
VECTOR_ROUTES = ('                if url.path == "/api/gis-vector-reviews/catalog":\n'
                 '                    return self.send_json(200, GISVectorReviews(self.app, Fault).read(workspace, "catalog"))\n'
                 '                if url.path == "/api/gis-vector-reviews/inspect":\n'
                 '                    return self.send_json(200, GISVectorReviews(self.app, Fault).read(workspace, "inspect", {"id": one("id")}))\n')


def _vector_server_source(text):
    """Upgrade an existing direct GIS installation without duplicating its hooks."""
    if VECTOR_MARKER in text:
        return text
    text = once(text, 'class Operator:', VECTOR_PROVIDER + 'class Operator:', 'vector provider')
    text = once(text, '        if action in GIS_ACTIONS:\n',
                VECTOR_DISPATCH + '        if action in GIS_ACTIONS:\n', 'vector dispatch')
    text = once(text, '        task = GISProjects(self).decorate_task(task)\n',
                '        task = GISProjects(self).decorate_task(task)\n' + VECTOR_DECORATION,
                'vector task decoration')
    tree = ast.parse(text)
    cls = next(x for x in tree.body if isinstance(x, ast.ClassDef) and x.name == 'Operator')
    fn = next(x for x in cls.body if isinstance(x, ast.FunctionDef) and x.name == 'item')
    lines = text.splitlines(keepends=True)
    body = ''.join(lines[fn.lineno - 1:fn.end_lineno])
    body = once(body, '        if kind not in KINDS:\n',
                '        self.ws(workspace)\n' + VECTOR_ITEM + '        if kind not in KINDS:\n',
                'vector retained item')
    text = ''.join(lines[:fn.lineno - 1]) + body + ''.join(lines[fn.end_lineno:])
    catalogue = ('                if url.path == "/api/gis/projects":\n'
                 '                    return self.send_json(200, GISProjects(self.app).catalogue(workspace))\n')
    text = once(text, catalogue, catalogue + VECTOR_ROUTES, 'vector authorized reads')
    ast.parse(text)
    return text


PREVIOUS_NATIVE_STUDY_CATALOGUE = ('                    return self.send_json(200, GISProjects(self.app).catalogue('
                                   'workspace, one("native_study_collection"), one("native_study_source")))\n')
NATIVE_STUDY_CATALOGUE = ('                    return self.send_json(200, GISProjects(self.app).catalogue('
                          'workspace, one("native_study_collection"), one("native_study_source"), '
                          'one("scientific_report_id"), one("execution_history_id")))\n')
ORIGINAL_CATALOGUE = '                    return self.send_json(200, GISProjects(self.app).catalogue(workspace))\n'


def server_source(text):
    # Normalize our exact earlier direct route before the existing vector joins.
    for route in (PREVIOUS_NATIVE_STUDY_CATALOGUE, NATIVE_STUDY_CATALOGUE):
        if route in text:
            text = once(text, route, ORIGINAL_CATALOGUE, 'native-study direct route')
    text = _vector_server_source(_base_server_source(text))
    return once(text, ORIGINAL_CATALOGUE, NATIVE_STUDY_CATALOGUE, 'native-study selected read')


def _remove_vector_server_source(text):
    if VECTOR_MARKER not in text:
        return text
    for old, label in (
        (VECTOR_PROVIDER, 'vector provider'),
        (VECTOR_DISPATCH, 'vector dispatch'),
        (VECTOR_DECORATION, 'vector task decoration'),
        ('        self.ws(workspace)\n' + VECTOR_ITEM, 'vector retained item'),
        (VECTOR_ROUTES, 'vector authorized reads'),
    ):
        text = once(text, old, '', 'legacy ' + label)
    ast.parse(text)
    return text


def browser_source(text):
    if "import {attachGISProjects}" in text:
        return text
    text = "import {attachGISProjects} from './gis-projects.mjs';\n" + text
    text = once(text, 'const viewLabels={', "const viewLabels={'gis-projects':'Editable GIS projects',", 'view names')
    text = once(text, 'const actionLabels={', "const actionLabels={'gis.project.export':'Build editable GIS project','gis.project.receive':'Receive editable GIS project','gis.project.adopt-sources':'Adopt received GIS sources',", 'action names')
    text = once(text, 'function toast(message){', "const gisProjects=attachGISProjects({getState:()=>state,api,refreshState:refresh,showTask,toast});\nfunction toast(message){", 'original UI factory')
    text = once(text, '    renderTasks();\n', '    renderTasks();\n    gisProjects.update(data);\n', 'retained state refresh')
    seam="  if(view==='spatial'){"
    text = once(text, seam, "  if(view==='gis-projects'){community.detach();customerReviews.detach();spatialWorkspace.suspend();gisProjects.mount($('#content'),state);return;}\n  gisProjects.detach();\n" + seam, 'original view lifecycle')
    return text


def index_source(text):
    if 'data-view="gis-projects"' in text:
        return text
    seam='<link rel="stylesheet" href="/web/reviews.css">'
    text=once(text,seam,seam+'\n  <link rel="stylesheet" href="/web/gis-projects.css">','original stylesheet list')
    seam='<button data-view="runs">Native model runs</button>'
    return once(text,seam,seam+'\n    <button data-view="gis-projects">Editable GIS projects</button>','original navigation')



def legacy_server_source(text):
    """Remove only the exact former GIS-owned joins before shared registration."""
    for route in (PREVIOUS_NATIVE_STUDY_CATALOGUE, NATIVE_STUDY_CATALOGUE):
        if route in text:
            text = once(text, route, ORIGINAL_CATALOGUE, 'native-study registered route')
    text = _remove_vector_server_source(text)
    if MARKER not in text:
        return text
    text = once(text, MARKER + '\nfrom gis_projects import ACTIONS as GIS_ACTIONS, GISProjects\nACTIONS = set(ACTIONS) | GIS_ACTIONS\n\n', '', 'legacy GIS provider')
    text = once(text, '        if action in GIS_ACTIONS:\n            return GISProjects(self).invoke(task)\n', '', 'legacy GIS dispatch')
    text = once(text, '        task = GISProjects(self).decorate_task(task)\n', '', 'legacy GIS task decoration')
    text = once(text, '''            if url.path.startswith("/api/file/gis-project/"):
                self.authorized(file=True)
                parts = url.path.removeprefix("/api/file/gis-project/").split("/", 3)
                if len(parts) != 4:
                    raise ValueError("Choose an original GIS project member")
                ticket, policy = GISProjects(self.app).member(*[urllib.parse.unquote(x) for x in parts])
                return self.send_file(ticket["id"], download=one("download") == "1", content_security_policy=policy)
''', '', 'legacy GIS file route')
    text = once(text, '                if url.path == "/api/gis/projects":\n                    return self.send_json(200, GISProjects(self.app).catalogue(workspace))\n', '', 'legacy GIS catalogue')
    return once(text, ', "gis-projects.mjs", "gis-projects.css"', '', 'legacy GIS static assets')


def legacy_browser_source(text):
    if "import {attachGISProjects}" not in text:
        return text
    labels = (
        "const actionLabels={'gis.project.export':'Build editable GIS project','gis.project.receive':'Receive editable GIS project','gis.project.adopt-sources':'Adopt received GIS sources',",
        "const actionLabels={'gis.project.export':'Build editable GIS project','gis.project.receive':'Receive editable GIS project',",
    )
    old_labels = next((value for value in labels if value in text), None)
    if old_labels is None:
        raise ValueError('Compose the current GIS action labels before shared registration')
    for old, new, label in (
        ("import {attachGISProjects} from './gis-projects.mjs';\n", '', 'legacy GIS import'),
        ("const viewLabels={'gis-projects':'Editable GIS projects',", 'const viewLabels={', 'legacy GIS view'),
        (old_labels, 'const actionLabels={', 'legacy GIS actions'),
        ("const gisProjects=attachGISProjects({getState:()=>state,api,refreshState:refresh,showTask,toast});\n", '', 'legacy GIS controller'),
        ('    gisProjects.update(data);\n', '', 'legacy GIS refresh'),
        ("  if(view==='gis-projects'){community.detach();customerReviews.detach();spatialWorkspace.suspend();gisProjects.mount($('#content'),state);return;}\n  gisProjects.detach();\n", '', 'legacy GIS lifecycle'),
    ):
        text = once(text, old, new, label)
    return text


def legacy_index_source(text):
    for old in ('\n  <link rel="stylesheet" href="/web/gis-projects.css">',
                '\n    <button data-view="gis-projects">Editable GIS projects</button>'):
        if old in text:
            text = once(text, old, '', 'legacy GIS navigation or stylesheet')
    return text


def report_browser_source(text):
    """Add one callback to the current Sources controller; preserve all other joins."""
    callback = " openGISStudy:value=>extensions.openDesk('gis-projects','createForNativeStudy',value),\n"
    if callback in text:
        return text
    if 'const sourceReports=attachSourceReports({' not in text:
        return text
    if 'createExtensionHost' not in text:
        return text
    seam = " prepareCustomerReview:value=>customerReviews.prepareScientificReportReview(value),\n"
    return once(text, seam, seam + callback, 'saved scientific report to GIS callback')


def registration_plan(application):
    """Use the receiving application's maintained host, with one active GIS owner."""
    host = application / 'install_extensions.py'
    if not host.is_file():
        return ({'operator/server.py': server_source,
                 'operator/web/app.mjs': browser_source,
                 'operator/web/index.html': index_source}, None, 'legacy')
    if host.is_symlink():
        raise ValueError('The maintained extension installer is a symbolic link')
    registry = application / 'operator/extension_registry.py'
    if not registry.is_file():
        raise ValueError('Receive the current complete extension host with install_extensions.py')
    registry_body = registry.read_bytes()
    if b'def file_reply(' not in registry_body or b'def _member_path(' not in registry_body:
        raise ValueError('Receive the maintained extension host with nested member file routes')
    body = host.read_bytes()
    # This is an installed application module, never source supplied by a GIS ZIP.
    namespace = {'__name__': '_upstate_gis_current_extension_installer', '__file__': str(host)}
    exec(compile(body, str(host), 'exec'), namespace)
    if not callable(namespace.get('patch_server')) or not callable(namespace.get('patch_app')):
        raise ValueError('The current extension installer lacks its source composition API')
    transform = {
        'operator/server.py': lambda value: namespace['patch_server'](legacy_server_source(value)),
        'operator/web/app.mjs': lambda value: namespace['patch_app'](legacy_browser_source(value)),
        'operator/web/index.html': legacy_index_source,
    }
    return transform, {host: body, registry: registry_body}, 'registry'



def instruction_source(existing, source):
    """Carry current owner instructions while retaining receiver-specific content."""
    body = source.decode('utf-8').strip()
    if not body:
        raise ValueError('The application owner instruction file is empty')
    text = existing.decode('utf-8') if existing is not None else ''
    if body in text:
        return existing
    start = '<!-- BEGIN GIS application owner instructions -->'
    end = '<!-- END GIS application owner instructions -->'
    block = start + '\n' + body + '\n' + end
    if start in text or end in text:
        if text.count(start) != 1 or text.count(end) != 1 or text.index(end) < text.index(start):
            raise ValueError('Retain and reconcile the existing GIS owner instruction boundaries')
        first = text.index(start)
        last = text.index(end) + len(end)
        text = text[:first] + block + text[last:]
    elif not text.strip():
        text = body + '\n'
    else:
        text = text.rstrip() + '\n\n' + block + '\n'
    return text.encode('utf-8')


def install(application, source, dry_run=False):
    application, source = Path(application).resolve(strict=True), Path(source).resolve(strict=True)
    if not (application / 'model/workspace.py').is_file():
        raise ValueError('Receive the original scientific application before this additive component')
    for dependency in ('model/ensemble_study_transfer.py', 'model/native_versions.py',
                       'model/scientific_report_editions.py'):
        target = application / dependency
        if not target.is_file() or target.is_symlink():
            raise ValueError('Receive the complete native-study component dependency before GIS installation: ' + dependency)
    transform, dependencies, integration = registration_plan(application)
    original_app = (application / 'operator/web/app.mjs').read_text(encoding='utf-8')
    if 'const sourceReports=attachSourceReports({' in original_app and 'createExtensionHost' in original_app:
        client_host = application / 'operator/web/extension_host.mjs'
        if client_host.is_symlink() or not client_host.is_file():
            raise ValueError('Receive the maintained original browser extension host')
        client_body = client_host.read_bytes()
        if b'async function openDesk(' not in client_body:
            raise ValueError('Receive the maintained asynchronous openDesk host before the source/report GIS bridge')
        dependencies = {**(dependencies or {}), client_host: client_body}
    before={};planned={}
    for name, fn in transform.items():
        path=application/name
        if path.is_symlink(): raise ValueError('Original registration file is a symbolic link')
        before[name]=path.read_bytes()
        value = fn(before[name].decode('utf-8'))
        if name == 'operator/web/app.mjs':
            value = report_browser_source(value)
        planned[name]=value.encode('utf-8')
    instruction = application / 'AGENTS.md'
    if instruction.is_symlink():
        raise ValueError('Application owner instruction destination is a symbolic link')
    before['AGENTS.md'] = instruction.read_bytes() if instruction.exists() else None
    planned['AGENTS.md'] = instruction_source(before['AGENTS.md'], (source / 'AGENTS.md').read_bytes())
    for name in OWN_FILES:
        data=(source/name).read_bytes();target=application/name
        if target.is_symlink(): raise ValueError('Component destination is a symbolic link')
        before[name]=target.read_bytes() if target.exists() else None
        # This installer is intentionally the owner of these named additive files.
        planned[name]=data
    for name, predecessors in SHARED_REPORT_FILES.items():
        target = application / name
        if not target.exists():
            continue
        if target.is_symlink():
            raise ValueError('Shared source-report destination is a symbolic link')
        existing, successor = target.read_bytes(), (source / name).read_bytes()
        if existing != successor and sha(existing) not in predecessors:
            raise ValueError('Compose the current source-report owner revision before installation: ' + name)
        before[name], planned[name] = existing, successor
    for name, data in planned.items():
        if name.endswith('.py'): compile(data,str(application/name),'exec')
    changes=[name for name in planned if planned[name]!=before[name]]
    result={'schema':'upstate.gis-installation/v1','application':str(application),'dry_run':dry_run,
            'integration':integration,
            'files':[{'path':name,'before_sha256':sha(before[name]) if before[name] is not None else None,
                      'sha256':sha(planned[name]),'bytes':len(planned[name])} for name in changes]}
    if dry_run or not changes:return result
    # A shared original owner can inspect/undo exact registration edits from this journal.
    journal=application/'source_tools'/'gis-installations'
    journal.mkdir(parents=True,exist_ok=True)
    operation=sha(json.dumps(result,sort_keys=True).encode())
    record=journal/(operation+'.json')
    staged={};applied=[]
    try:
        for name in changes:
            path=application/name;path.parent.mkdir(parents=True,exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=path.parent,prefix='.gis-install-',delete=False) as out:
                out.write(planned[name]);out.flush();os.fsync(out.fileno());staged[name]=Path(out.name)
        # Compare all predecessors immediately before committing any registration changes.
        for dependency, expected in (dependencies or {}).items():
            if dependency.read_bytes() != expected:
                raise ValueError('Concurrent extension host change: ' + str(dependency))
        for name in changes:
            p=application/name
            actual=p.read_bytes() if p.exists() else None
            if actual!=before[name]:raise ValueError('Concurrent original source change: '+name)
        for name in changes:
            p=application/name
            actual=p.read_bytes() if p.exists() else None
            if actual!=before[name]:raise ValueError('Concurrent original source change: '+name)
            if before[name] is not None:
                backup=journal/(operation+'-'+name.replace('/','__')+'.before')
                backup.write_bytes(before[name])
            os.replace(staged[name],p);applied.append(name)
        record.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    except BaseException:
        for name in reversed(applied):
            p=application/name
            if p.read_bytes()!=planned[name]:continue
            if before[name] is None:p.unlink()
            else:
                with tempfile.NamedTemporaryFile(dir=p.parent,prefix='.gis-rollback-',delete=False) as out:
                    out.write(before[name]);out.flush();os.fsync(out.fileno());temporary=Path(out.name)
                os.replace(temporary,p)
        raise
    finally:
        for p in staged.values():p.unlink(missing_ok=True)
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--application',required=True)
    p.add_argument('--source-root',default=str(Path(__file__).resolve().parent))
    p.add_argument('--dry-run',action='store_true')
    args=p.parse_args()
    print(json.dumps(install(args.application,args.source_root,args.dry_run),indent=2))

if __name__=='__main__':main()
