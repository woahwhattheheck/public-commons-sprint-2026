"""MIT. Trusted local merchant functions, private parent protocol on descriptor 3."""
import asyncio
import base64
import importlib.util
import inspect
import hashlib
import json
import math
import os
from pathlib import Path
import sys

PROTOCOL = os.fdopen(3, 'wb', buffering=0)
MAX_LINE = 1100000


def send(value):
    PROTOCOL.write(json.dumps(value, separators=(',', ':'), allow_nan=False).encode('utf-8') + b'\n')


def read():
    line = sys.stdin.buffer.readline(MAX_LINE + 1)
    if not line:
        return None
    if len(line) > MAX_LINE or not line.endswith(b'\n'):
        raise ValueError('protocol')
    return json.loads(line, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite')))


def json_body(value, max_bytes):
    # Preserve interoperable JSON numbers. Explicitly return decimal strings for
    # larger Python integers rather than silently rounding them in JavaScript.
    stack = [(value, 0)]
    count = 0
    while stack:
        item, depth = stack.pop()
        count += 1
        if count > 100000 or depth > 32:
            raise ValueError('complexity')
        if item is None or type(item) in (str, bool):
            continue
        if type(item) is int:
            if abs(item) > 9007199254740991:
                raise ValueError('integer')
        elif type(item) is float:
            if not math.isfinite(item):
                raise ValueError('nonfinite')
        elif type(item) is list:
            stack.extend((child, depth + 1) for child in item)
        elif type(item) is dict:
            if any(type(key) is not str for key in item):
                raise ValueError('keys')
            stack.extend((child, depth + 1) for child in item.values())
        else:
            raise ValueError('json_type')
    chunks = []
    size = 0
    for chunk in json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(',', ':')).iterencode(value):
        encoded = chunk.encode('utf-8')
        size += len(encoded)
        if size > max_bytes:
            raise ValueError('size')
        chunks.append(encoded)
    return b''.join(chunks)


def main():
    # Merchant imports and prints never share the protocol or public server log.
    sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    sys.stderr = open(os.devnull, 'w', encoding='utf-8')
    try:
        initial = read()
        path = Path(sys.argv[1]).resolve(strict=True)
        source = path.read_bytes()
        if len(source) > 2097152 or hashlib.sha256(source).hexdigest() != initial['applicationSha256']:
            raise ValueError('application_changed')
        sys.path.insert(0, str(path.parent))
        spec = importlib.util.spec_from_file_location('_sf30_merchant', path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        exec(compile(source, str(path), 'exec'), module.__dict__)
        definitions = initial['functions']
        functions = {}
        for name in definitions:
            function = getattr(module, name)
            if not callable(function):
                raise ValueError('callable')
            # Exactly one positional input object; reject mismatched bindings at boot.
            inspect.signature(function).bind({})
            functions[name] = function
        send({'type': 'ready'})
    except BaseException:
        send({'type': 'startup-error', 'code': 'PYTHON_APPLICATION_UNAVAILABLE'})
        return
    while True:
        try:
            request = read()
            if request is None:
                return
            request_id, name = request['id'], request['name']
            if type(request_id) is not int or name not in functions or type(request['input']) is not dict:
                raise ValueError('request')
        except BaseException:
            return
        try:
            result = functions[name](request['input'])
            if inspect.isawaitable(result):
                result = asyncio.run(result)
        except BaseException:
            send({'type': 'error', 'id': request_id, 'code': 'PYTHON_FUNCTION_FAILED'})
            continue
        try:
            definition = definitions[name]
            if definition['output']['format'] == 'bytes':
                if not isinstance(result, (bytes, bytearray)):
                    raise ValueError('bytes_required')
                if len(result) > definition['maxOutputBytes']:
                    raise ValueError('size')
                body = bytes(result)
            else:
                body = json_body(result, definition['maxOutputBytes'])
            send({'type': 'result', 'id': request_id, 'body': base64.b64encode(body).decode('ascii')})
        except BaseException:
            send({'type': 'error', 'id': request_id, 'code': 'PYTHON_OUTPUT_REJECTED'})


if __name__ == '__main__':
    main()
