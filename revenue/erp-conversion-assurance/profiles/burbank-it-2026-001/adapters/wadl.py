#!/usr/bin/env python3
"""MIT. Inspect a selected EBS WADL with Python's standard XML parser.

Input is the original XML on stdin. Includes and external references are reported,
never fetched. No XML entity declarations, DTDs or executable content are accepted.
"""
import json, re, sys
from urllib.parse import urljoin
from xml.etree import ElementTree as E

LIMIT = 2 * 1024 * 1024
WADL = {'http://wadl.dev.java.net/2009/02', 'http://research.sun.com/wadl/2006/10'}

def inspect(raw):
    if len(raw) > LIMIT:
        raise ValueError('WADL exceeds the 2 MiB inspection limit')
    if re.search(br'<!\s*(DOCTYPE|ENTITY)\b', raw, re.I):
        raise ValueError('WADL DTDs and entity declarations are not accepted')
    root = E.fromstring(raw)
    if not root.tag.startswith('{') or root.tag.split('}', 1)[0][1:] not in WADL:
        raise ValueError('The document is not a supported WADL application')
    namespace = root.tag.split('}', 1)[0] + '}'
    q = lambda name: namespace + name
    if root.tag != q('application'):
        raise ValueError('The WADL root must be application')
    by_id = {}
    for item in root.iter():
        if item.get('id'):
            if item.get('id') in by_id:
                raise ValueError('Repeated WADL id: ' + item.get('id'))
            by_id[item.get('id')] = item
    unresolved = set()
    def resolved(item):
        seen = set()
        while item.get('href'):
            href = item.get('href')
            if not href.startswith('#'):
                unresolved.add(href)
                return item
            if href in seen or href[1:] not in by_id:
                raise ValueError('Unresolvable or circular local WADL reference')
            seen.add(href)
            item = by_id[href[1:]]
        return item
    def parameters(container):
        output = []
        for value in container.findall(q('param')):
            value = resolved(value)
            output.append({key: value.get(key) for key in ['name', 'style', 'type', 'required', 'default', 'fixed'] if value.get(key) is not None})
        return output
    resources = []
    def visit(resource, base, parent_path, inherited):
        fragment = resource.get('path', '')
        relative = '/'.join(part for part in [parent_path.rstrip('/'), fragment.lstrip('/')] if part)
        if fragment.endswith('/') and not relative.endswith('/'):
            relative += '/'
        containers = [resource]
        for kind in resource.get('type', '').split():
            if kind.startswith('#') and kind[1:] in by_id:
                containers.append(by_id[kind[1:]])
            else:
                unresolved.add(kind)
        current = inherited + [p for item in containers for p in parameters(item)]
        methods = []
        for container in containers:
            for candidate in container.findall(q('method')):
                method = resolved(candidate)
                request = method.find(q('request'))
                params = current + (parameters(request) if request is not None else [])
                # A nearer parameter definition supersedes an inherited one.
                merged = {(p.get('style'), p.get('name')): p for p in params}
                methods.append({'name': method.get('name', '').upper(), 'id': method.get('id'),
                    'parameters': list(merged.values()),
                    'responseTypes': sorted({r.get('mediaType') for response in method.findall(q('response')) for r in response.findall(q('representation')) if r.get('mediaType')})})
        if methods:
            resources.append({'id': resource.get('id'), 'path': relative,
                'base': base, 'endpoint': urljoin(base.rstrip('/') + '/', relative), 'methods': methods})
        for child in resource.findall(q('resource')):
            visit(child, base, relative, current)
    for group in root.findall(q('resources')):
        base = group.get('base', '')
        if not base:
            raise ValueError('WADL resources base is required')
        for resource in group.findall(q('resource')):
            visit(resource, base, '', [])
    # Oracle's native examples place include in the XML Schema namespace.
    includes = [item.get('href') for item in root.iter() if item.tag.rsplit('}', 1)[-1] == 'include' and item.get('href')]
    if not resources:
        raise ValueError('WADL has no resolved resource methods')
    return {'schema': 'tjl.oracle-ebs-wadl.v1', 'resources': resources,
        'schemaIncludes': includes, 'unresolvedReferences': sorted(unresolved)}

if __name__ == '__main__':
    try:
        result = inspect(sys.stdin.buffer.read(LIMIT + 1))
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
