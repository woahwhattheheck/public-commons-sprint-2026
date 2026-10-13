// MIT. Private loopback browser over the original mastering workspace.
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, createReadStream, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensure, SCHEMA } from './core.mjs';
import { workspaceFile, deliveryPacket } from './portable.mjs';
// This trusted source declaration also belongs to the independently packed Node module.
// The maintained distribution builder validates and retains these exact browser assets.
const browserAssets = JSON.parse(readFileSync(new URL('./browser-assets.json', import.meta.url), 'utf8'));
const assets = new Map(browserAssets.routes.map(([path, [file, type]]) =>
    [path, { url: new URL(browserAssets.root + file, import.meta.url), type }]));
export async function serveWorkspace(workspace, { port = 0, token = randomBytes(32).toString('base64url'), expectedBindingSha256 } = {}) {
    ensure(Number.isSafeInteger(port) && port >= 0 && port <= 65535, 'INVALID_PORT', 'Use a port from 0 to 65535.');
    const binding = workspace.binding();
    if (expectedBindingSha256)
        ensure(binding.sha256 === expectedBindingSha256, 'BINDING_CHANGED', 'The selected workspace identity changed.', 409);
    const auth = Buffer.from('Bearer ' + token), instanceId = randomUUID();
    let ready, origin;
    const server = createServer(async (req, res) => {
        const send = (status, value, type = 'application/json', name) => { const body = Buffer.isBuffer(value) ? value : Buffer.from(type === 'application/json' ? JSON.stringify(value) : String(value)); res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", ...(name ? { 'Content-Disposition': 'attachment; filename="' + name + '"' } : {}) }); res.end(body); };
        try {
            ensure(req.headers.host === new URL(origin).host, 'INVALID_HOST', 'Use the original loopback address.', 403);
            ensure(!req.headers.origin || req.headers.origin === origin, 'INVALID_ORIGIN', 'Use the original workspace browser.', 403);
            const url = new URL(req.url, origin);
            ensure(!url.search, 'INVALID_QUERY', 'Request parameters belong in the operation body.');
            if (req.method === 'GET' && assets.has(url.pathname)) {
                const asset = assets.get(url.pathname);
                return send(200, readFileSync(asset.url), asset.type);
            }
            if (req.method === 'GET' && url.pathname === '/api/launch')
                return send(200, { ...ready, url: origin, sessionUrl: undefined });
            const supplied = Buffer.from(req.headers.authorization ?? '');
            ensure(supplied.length === auth.length && timingSafeEqual(supplied, auth), 'SESSION_REQUIRED', 'Open the private session URL from the original launch command.', 401);
            if (req.method === 'GET' && url.pathname === '/api/backup') {
                const file=join(workspace.directory,'.http-transfer-'+randomUUID()+'.gz');
                let stream;
                const clean=()=>{stream?.destroy();rmSync(file,{force:true});};
                res.once('close',clean);
                try {
                    const saved=workspaceFile(workspace,file);
                    if(res.destroyed){clean();return;}
                    res.writeHead(200,{'Content-Type':'application/gzip','Content-Length':saved.bytes,
                        'Content-Disposition':'attachment; filename="workspace.mastering.gz"',
                        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
                    stream=createReadStream(file);stream.once('error',()=>res.destroy());stream.pipe(res);return;
                } catch(error){clean();throw error;}
            }
            if (req.method === 'POST' && url.pathname === '/api/invoke') {
                ensure(req.headers['content-type']?.split(';')[0] === 'application/json', 'JSON_REQUIRED', 'Send a JSON operation.');
                let length = 0, parts = [];
                for await (const chunk of req) {
                    length += chunk.length;
                    ensure(length <= 200 * 1024 * 1024, 'REQUEST_TOO_LARGE', 'The operation exceeds 200 MiB.', 413);
                    parts.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
                if (body.action === 'source.inspect') {
                    const bytes = Buffer.from(body.input.base64, 'base64');
                    return send(200, workspace.inspectCSV(bytes));
                }
                return send(200, workspace.invoke(body.action, body.input ?? {}));
            }
            const delivery = /^\/api\/delivery\/([a-f0-9-]{36})$/.exec(url.pathname);
            if (req.method === 'GET' && delivery)
                return send(200, deliveryPacket(workspace, delivery[1]), 'application/gzip', 'master-delivery.gz');
            const source = /^\/api\/source\/([a-f0-9-]{36})$/.exec(url.pathname);
            if (req.method === 'GET' && source)
                return send(200, workspace.sourceBytes(source[1]).bytes, 'text/csv', 'original-source.csv');
            const file = /^\/api\/file\/([a-f0-9-]{36})\/([A-Za-z0-9_.-]+)$/.exec(url.pathname);
            if (req.method === 'GET' && file) {
                const files = workspace.delivery(file[1]).files;
                ensure(Object.hasOwn(files, file[2]), 'FILE_NOT_FOUND', 'Delivered file not found.', 404);
                return send(200, Buffer.from(files[file[2]], 'base64'), 'application/octet-stream', file[2]);
            }
            send(404, { error: 'NOT_FOUND', message: 'Workspace endpoint not found.' });
        }
        catch (error) {
            if (!res.headersSent)
                send(error.status ?? 400, { error: error.code ?? 'INVALID_REQUEST', message: error.message });
            else
                res.destroy();
        }
    });
    server.requestTimeout = 120000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = 'http://127.0.0.1:' + server.address().port;
    ready = { schema: SCHEMA + '.startup', state: 'LISTENING', url: origin, sessionUrl: origin + '/#' + token, instanceId, binding, startedAt: new Date().toISOString() };
    return { server, ready, token, url: ready.sessionUrl, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
