"""MIT. Three original Python merchant functions and one owned native-source bridge."""
import asyncio
import base64
import json
import os
from pathlib import Path
import uuid

from contract import make_page, page_key, plan_selection, provider_request, summarize

ROOT = Path(__file__).resolve().parent
PLAN = json.loads((ROOT / 'product.json').read_text(encoding='utf-8'))
BRIDGE = None
LOCK = None


async def startup():
    global LOCK
    plan_selection(PLAN)
    LOCK = asyncio.Lock()


async def close_bridge():
    global BRIDGE
    process, BRIDGE = BRIDGE, None
    if process is None:
        return
    if process.returncode is None:
        try:
            process.stdin.write(b'{"action":"close"}\n')
            await process.stdin.drain()
            await asyncio.wait_for(process.wait(), 5)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            if process.returncode is None:
                process.kill()
                await process.wait()


async def shutdown():
    await close_bridge()


async def source_read(operation, request):
    global BRIDGE
    async with LOCK:
        if BRIDGE is None:
            if not os.environ.get('AMBERDATA_API_KEY') or not os.environ.get('AMBERDATA_SOURCE_ROOT'):
                raise ValueError('Provider credentials and original source root are required for a provider read.')
            executable = os.environ.get('AMBERDATA_NODE_EXECUTABLE', 'node')
            BRIDGE = await asyncio.create_subprocess_exec(executable, str(ROOT / 'provider-bridge.mjs'),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
                limit=1500000)
            try:
                ready = json.loads(await asyncio.wait_for(BRIDGE.stdout.readline(), 10))
                if ready != {'ready': True}:
                    raise ValueError('Original provider bridge did not initialize.')
            except BaseException:
                await close_bridge()
                raise
        call_id = uuid.uuid4().hex
        message = {'action': 'read', 'id': call_id, 'operation': operation, 'query': request['query']}
        try:
            BRIDGE.stdin.write(json.dumps(message, separators=(',', ':')).encode('utf-8') + b'\n')
            await BRIDGE.stdin.drain()
            line = await asyncio.wait_for(BRIDGE.stdout.readline(), PLAN['limits']['timeoutMs'] / 1000 + 5)
            result = json.loads(line)
            if result.get('id') != call_id or result.get('ok') is not True:
                raise ValueError('Original upstream read failed; inspect the retained original operation before another request.')
            body = base64.b64decode(result['bodyBase64'], validate=True).decode('utf-8', errors='strict')
            return body, result['nativeUpstream']
        except BaseException:
            await close_bridge()
            raise


async def provider_page(operation, input):
    if not isinstance(input, dict) or set(input) - {'continuation'}:
        raise ValueError('Only a previous merchant continuation token is accepted.')
    key = page_key(os.environ.get('AMBERDATA_PAGE_KEY'))
    request = provider_request(PLAN, operation, input.get('continuation'), key)
    body, native = await source_read(operation, request)
    return make_page(PLAN, operation, request, body, key, native)


async def spot_instruments(input):
    return await provider_page('spot_instruments', input)


async def spot_ohlcv(input):
    return await provider_page('spot_ohlcv', input)


def ohlcv_summary(input):
    return summarize(PLAN, input)
