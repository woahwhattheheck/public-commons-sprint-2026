"""MIT. Trusted local merchant functions, private parent protocol on descriptor 3."""
import asyncio
import base64
import contextvars
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


async def read(reader):
    # The same worker loop remains active while waiting for the next invocation,
    # so application-owned connection tasks are not frozen between requests.
    line = await reader.readline()
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


async def attach_input():
    reader = asyncio.StreamReader(limit=MAX_LINE)
    transport, _ = await asyncio.get_running_loop().connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), sys.stdin.buffer)
    return reader, transport


async def await_value(value):
    return await value


def invoke(runner, function, *args, context):
    # Call synchronous functions outside a running event loop, as before. Async
    # results use one persistent loop, including startup and shutdown hooks.
    asyncio.set_event_loop(runner.get_loop())
    result = context.run(function, *args)
    return runner.run(await_value(result), context=context) if inspect.isawaitable(result) else result


def hook(module, name):
    if name is None:
        return None
    function = getattr(module, name)
    if not callable(function):
        raise ValueError('hook_callable')
    inspect.signature(function).bind()
    return function


def main():
    # Merchant imports and prints never share the protocol or public server log.
    sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    sys.stderr = open(os.devnull, 'w', encoding='utf-8')
    runner = asyncio.Runner()
    application_context = contextvars.copy_context()
    transport, shutdown = None, None
    ready, cleanup = False, False
    stop_code = None
    try:
        reader, transport = runner.run(attach_input())
        initial = runner.run(read(reader))
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
        lifecycle = initial.get('lifecycle', {})
        startup = hook(module, lifecycle.get('startup'))
        shutdown = hook(module, lifecycle.get('shutdown'))
        # Cleanup can release partially initialized resources after startup fails.
        # A parent-enforced hard deadline can still terminate this worker.
        cleanup = True
        if startup is not None:
            invoke(runner, startup, context=application_context)
        send({'type': 'ready'})
        ready = True
        while True:
            request = runner.run(read(reader))
            if request is None:
                break
            request_id, name = request['id'], request['name']
            if type(request_id) is not int or name not in functions or type(request['input']) is not dict:
                raise ValueError('request')
            try:
                # Reuse initialized resources, not another buyer's ContextVars.
                result = invoke(runner, functions[name], request['input'], context=application_context.copy())
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
    except BaseException:
        stop_code = 'PYTHON_PROTOCOL_REJECTED' if ready else 'PYTHON_APPLICATION_UNAVAILABLE'
    finally:
        if cleanup and shutdown is not None:
            try:
                invoke(runner, shutdown, context=application_context)
            except BaseException:
                stop_code = stop_code or 'PYTHON_SHUTDOWN_FAILED'
        if transport is not None:
            transport.close()
        try:
            # Cancels remaining application tasks and closes async generators
            # before acknowledging exit. Parent timeout covers stubborn cleanup.
            runner.close()
        except BaseException:
            stop_code = stop_code or 'PYTHON_RUNTIME_CLOSE_FAILED'
    if not ready:
        send({'type': 'startup-error', 'code': 'PYTHON_APPLICATION_UNAVAILABLE'})
        return 1
    send({'type': 'stopped', 'status': 'failed' if stop_code else 'clean', 'code': stop_code})
    return 1 if stop_code else 0


if __name__ == '__main__':
    sys.exit(main())
