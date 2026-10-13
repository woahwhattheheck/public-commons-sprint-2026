// MIT. Native application preparation and identity checks, shared by original host adapter.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { get } from 'node:http';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { SCHEMA, ensure } from './core.mjs';
const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/record-mastering/';
const nativeFiles = ['cli.mjs', 'client.mjs', 'core.mjs', 'projection.mjs', 'csv.mjs', 'schema.sql', 'portable.mjs', 'packet-reader.mjs', 'server.mjs', 'browser-assets.json', 'ui/index.html', 'ui/app.js', 'ui/style.css'];
export function masteringApplication(common = []) {
    return { id: 'record-mastering', command: 'record-mastering', title: 'Record mastering', terminal: false, requiredSource: ROOT + 'cli.mjs',
        description: 'Consolidate original source lists, review matching groups, resolve field values and deliver a reusable master dataset.',
        fields: [{ name: 'workspaceDirectory', label: 'Saved record workspace', type: 'path', required: true, description: 'Select an existing or independently received private workspace.' }, ...common] };
}
export async function prepareMasteringApplication(settings, { inputPath, runtimeDirectory }) {
    const runtime = await inspectMerchantRuntime(resolve(runtimeDirectory), { load: false, source: false }), selected = await inputPath(settings.workspaceDirectory, 'directory', false, true), inputs = [selected];
    for (const file of nativeFiles)
        inputs.push(await inputPath(join(runtime.sourceRoot, ROOT + file), 'file'));
    const original = await import(pathToFileURL(join(runtime.sourceRoot, ROOT + 'client.mjs')).href), client = new original.RecordMasteringClient({ directory: selected.path });
    let binding;
    try {
        binding = client.invoke('binding');
    }
    finally {
        client.close();
    }
    ensure(binding.schema === SCHEMA + '.binding' && binding.directory === selected.path && /^[a-f0-9]{64}$/.test(binding.sha256), 'APPLICATION_BINDING_CHANGED', 'The selected original workspace identity changed.');
    return { args: ['serve', '--workspace', selected.path, '--expected-binding-sha256', binding.sha256], inputs, createDirectories: [] };
}
function argument(request, name, required = true) { const indexes = request.args.flatMap((v, i) => v === name ? [i] : []); if (!indexes.length && !required)
    return undefined; ensure(indexes.length === 1 && typeof request.args[indexes[0] + 1] === 'string', 'APPLICATION_ARGUMENT_CHANGED', 'The original application arguments changed.'); return request.args[indexes[0] + 1]; }
function liveReady(url) { return new Promise((resolveResult, reject) => { const request = get(new URL('/api/launch', url), { timeout: 5000 }, response => { let bytes = 0; const parts = []; if (response.statusCode !== 200) {
    response.resume();
    reject(Error('The original application is not ready.'));
    return;
} response.on('data', chunk => { bytes += chunk.length; if (bytes > 16384)
    response.destroy(Error('The startup response exceeds its declared size.'));
else
    parts.push(chunk); }); response.on('error', reject); response.on('end', () => { try {
    resolveResult(JSON.parse(Buffer.concat(parts).toString('utf8')));
}
catch (error) {
    reject(error);
} }); }); request.on('error', reject); request.on('timeout', () => request.destroy(Error('The original application startup check timed out.'))); }); }
export async function masteringStartup(request, text) {
    if (request.command !== 'record-mastering' || request.args?.[0] !== 'serve' || typeof text !== 'string' || !text.startsWith('{') || text.length > 16384)
        return null;
    let ready;
    try {
        ready = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (ready?.schema !== SCHEMA + '.startup' || ready.state !== 'LISTENING')
        return null;
    const directory = resolve(argument(request, '--workspace')), expected = argument(request, '--expected-binding-sha256'), port = argument(request, '--port', false) ?? '0', url = new URL(ready.url), session = new URL(ready.sessionUrl);
    ensure(/^[a-f0-9]{64}$/.test(expected) && ready.binding?.sha256 === expected && ready.binding?.directory === directory && /^[a-f0-9-]{36}$/.test(ready.binding.workspaceId ?? '') && /^[a-f0-9-]{36}$/.test(ready.instanceId ?? ''), 'APPLICATION_OWNER_CHANGED', 'The startup identity differs from the original selected workspace.');
    ensure(url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) >= 1 && Number(url.port) <= 65535 && !url.search && !url.hash && !url.username && !url.password && /^(0|[1-9]\d*)$/.test(port) && (port === '0' || Number(port) === Number(url.port)), 'APPLICATION_URL_CHANGED', 'Use the original private application listener.');
    ensure(session.origin === url.origin && session.pathname === '/' && !session.search && !session.username && !session.password && /^#[A-Za-z0-9_-]{43}$/.test(session.hash), 'APPLICATION_SESSION_CHANGED', 'The private startup session is invalid.');
    const live = await liveReady(url);
    ensure(live.schema === ready.schema && live.state === 'LISTENING' && live.url === ready.url && live.instanceId === ready.instanceId && live.binding?.workspaceId === ready.binding.workspaceId && live.binding?.sha256 === expected && live.binding?.directory === directory, 'APPLICATION_OWNER_CHANGED', 'The listening process differs from the original startup.');
    return { url: session.href, workspaceId: ready.binding.workspaceId, original: { schema: SCHEMA + '.startup', directory, workspaceId: ready.binding.workspaceId, bindingSha256: expected, instanceId: ready.instanceId, startedAt: ready.startedAt } };
}
