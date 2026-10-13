"""Compose the existing standalone Operator and browser without replacing peers."""
from __future__ import annotations
import ast

MARKER = 'ASTRA-MONITOR12 queued native integration'


def replace_once(source, before, after, label):
    if source.count(before) != 1:
        raise ValueError(f'Original {label} anchor changed; expected exactly one occurrence')
    return source.replace(before, after, 1)


def server(source):
    ast.parse(source)
    if MARKER in source:
        for token in ('monitoring_native.perform(self, task)', 'monitoring_native.read(self.app, workspace',
                      'monitoring_native.decorate_task(self, task)', 'ACTIONS.update(monitoring_native.ACTIONS)'):
            if token not in source: raise ValueError('Partial monitoring native integration: ' + token)
        return source
    tree=ast.parse(source)
    operator=next((n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Operator'),None)
    if operator is None: raise ValueError('No original Operator class found')
    # Existing import-path initialization precedes the Operator class.
    lines=source.splitlines(keepends=True)
    position=operator.lineno-1
    lines[position:position]=[f'# {MARKER}\nimport monitoring_native\nACTIONS.update(monitoring_native.ACTIONS)\n\n']
    source=''.join(lines)
    source=replace_once(source, '    def _invoke(self, task):\n',
        '    def _invoke(self, task):\n        if task["action"] in monitoring_native.ACTIONS:\n            return monitoring_native.perform(self, task)\n', '_invoke')
    source=replace_once(source, '        return self.customer_reviews.decorate_task(task)',
        '        task = monitoring_native.decorate_task(self, task)\n        return self.customer_reviews.decorate_task(task)', 'task decorator')
    source=replace_once(source, '                if url.path == "/api/state":',
        '                if url.path == "/api/monitoring":\n                    return self.send_json(200, monitoring_native.read(self.app, workspace, one("action"), json_body(one("payload", "{}").encode("utf-8"))))\n                if url.path == "/api/state":', 'authorized native read')
    # Expand only the original literal static allowlist, preserving every peer.
    tree=ast.parse(source); candidates=[]
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare) and isinstance(node.left,ast.Name) and node.left.id=='selected' and len(node.comparators)==1 and isinstance(node.comparators[0],ast.Set):
            elements=node.comparators[0].elts
            if any(isinstance(e,ast.Constant) and e.value=='app.mjs' for e in elements):candidates.append(node.comparators[0])
    if len(candidates)!=1: raise ValueError('Original static allowlist changed')
    node=candidates[0];lines=source.splitlines(keepends=True)
    # Python AST offsets are UTF-8 byte columns; modify this one set in bytes.
    raw=source.encode('utf-8'); start=sum(len(x.encode('utf-8')) for x in lines[:node.lineno-1])+node.col_offset
    end=sum(len(x.encode('utf-8')) for x in lines[:node.end_lineno-1])+node.end_col_offset
    current=raw[start:end]
    replacement=current[:-1]+b', "monitoring.mjs", "monitoring-component.mjs", "monitoring.css"}'
    result=(raw[:start]+replacement+raw[end:]).decode('utf-8');ast.parse(result)
    return result


def app(source):
    marker='// '+MARKER
    if marker in source:
        for text in ("attachMonitoring", "monitoring.mount($('#content'))", "monitoring.detach()"):
            if text not in source:raise ValueError('Partial monitoring browser integration')
        return source
    source="import {attachMonitoring} from './monitoring.mjs';\n"+marker+'\n'+source
    source=replace_once(source,'const viewLabels={',"const viewLabels={monitoring:'Monitoring design',",'view labels')
    source=replace_once(source,'const community=attachCommunity(',
        'const monitoring=attachMonitoring({getState:()=>state,api,endpoint,showTask,toast});\nconst community=attachCommunity(', 'browser context')
    source=replace_once(source,'  spatialWorkspace.suspend();',
        "  spatialWorkspace.suspend();\n  if(view==='monitoring'){community.detach();customerReviews.detach();monitoring.mount($('#content')).catch(globalError);return;}\n  monitoring.detach();", 'browser render')
    return source


def index(source):
    marker='<button type="button" data-view="monitoring">Monitoring design</button>'
    if marker in source:return source
    pos=source.lower().find('</nav>')
    if pos<0:raise ValueError('Original navigation element is missing')
    return source[:pos]+marker+'\n'+source[pos:]


def remove_server(source):
    """Migrate only this overlay's exact direct joins into the shared host."""
    if MARKER not in source: return source
    blocks = [
        f'# {MARKER}\nimport monitoring_native\nACTIONS.update(monitoring_native.ACTIONS)\n\n',
        '        if task["action"] in monitoring_native.ACTIONS:\n            return monitoring_native.perform(self, task)\n',
        '        task = monitoring_native.decorate_task(self, task)\n',
        '                if url.path == "/api/monitoring":\n                    return self.send_json(200, monitoring_native.read(self.app, workspace, one("action"), json_body(one("payload", "{}").encode("utf-8"))))\n',
        ', "monitoring.mjs", "monitoring-component.mjs", "monitoring.css"',
    ]
    for block in blocks: source=replace_once(source,block,'','owned direct-hook migration')
    ast.parse(source)
    return source


def remove_app(source):
    if '// '+MARKER not in source:return source
    blocks=[
        "import {attachMonitoring} from './monitoring.mjs';\n// "+MARKER+'\n',
        "monitoring:'Monitoring design',",
        'const monitoring=attachMonitoring({getState:()=>state,api,endpoint,showTask,toast});\n',
        "  if(view==='monitoring'){community.detach();customerReviews.detach();monitoring.mount($('#content')).catch(globalError);return;}\n  monitoring.detach();\n",
    ]
    for block in blocks:source=replace_once(source,block,'','owned browser-hook migration')
    return source


def remove_index(source):
    marker='<button type="button" data-view="monitoring">Monitoring design</button>\n'
    return source.replace(marker,'')
