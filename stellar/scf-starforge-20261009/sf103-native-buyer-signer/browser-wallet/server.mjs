// MIT. Loopback-only browser/provider bridge for one original native buyer.
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, open, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWallet, readJson, writeAtomic, writeNew, requireValue, WalletError,
  LAUNCH_SCHEMA, PASSPHRASES, tokenEqual, publicRequest, object } from './common.mjs';
import { loadVerifier, loadFreighterBundle } from './verify.mjs';
import { openWalletStore } from './store.mjs';

const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
]);
const ownPath = fileURLToPath(new URL('.', import.meta.url));
const code = e => e instanceof WalletError ? e.code : 'WALLET_OPERATION_FAILED';
async function body(req) {
  requireValue(req.headers['content-type']?.split(';')[0] === 'application/json', 'WALLET_JSON_REQUIRED', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireValue(size <= 262144, 'WALLET_REQUEST_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));
    requireValue(object(value), 'WALLET_REQUEST_OBJECT_REQUIRED'); return value;
  } catch (e) { if (e instanceof WalletError) throw e; throw new WalletError('WALLET_JSON_INVALID'); }
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}
async function releaseLease(directory, instanceId) {
  const path = join(directory, 'wallet.lock');
  try { if ((await readJson(path)).instanceId === instanceId) await unlink(path); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
/** Explicit crash recovery refuses a live PID or another generation's lock. */
export async function recoverWalletLock(directory, expectedInstanceId) {
  const config = await readWallet(directory);
  requireValue(typeof expectedInstanceId === 'string', 'WALLET_EXPECTED_INSTANCE_REQUIRED');
  const recovery = join(directory, 'wallet.recovery');
  const recoveryId=randomUUID();
  const guard={walletId:config.walletId,pid:process.pid,expectedInstanceId,recoveryId};
  try {await writeNew(recovery,guard);}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const previous=await readJson(recovery);
    const inode=await lstat(recovery);
    requireValue(previous.walletId===config.walletId &&
      previous.expectedInstanceId===expectedInstanceId && !alive(previous.pid),
    'WALLET_RECOVERY_STILL_ACTIVE_OR_CHANGED',409);
    const current=await lstat(recovery);
    requireValue(current.dev===inode.dev && current.ino===inode.ino,
      'WALLET_RECOVERY_STILL_ACTIVE_OR_CHANGED',409);
    await unlink(recovery);
    await writeNew(recovery,guard);
  }
  try {
    const path = join(directory, 'wallet.lock');
    const previous = await readJson(path);
    requireValue(previous.walletId === config.walletId && previous.instanceId === expectedInstanceId &&
      !alive(previous.pid), 'WALLET_INSTANCE_STILL_ACTIVE_OR_CHANGED', 409);
    await unlink(path);
    return {state:'RECOVERED', walletId:config.walletId, previousInstanceId:expectedInstanceId};
  } finally {
    const current=await readJson(recovery).catch(error=>{
      if(error.code!=='ENOENT')throw error;return null;
    });
    if(current?.recoveryId===recoveryId)await unlink(recovery);
  }
}
async function takeLease(config, instanceId) {
  try {
    await writeNew(join(config.directory, 'wallet.lock'), {
      walletId:config.walletId, instanceId, pid:process.pid, startedAt:new Date().toISOString(),
    });
  } catch (e) { if (e.code === 'EEXIST') throw new WalletError('WALLET_ALREADY_RUNNING_OR_UNCLEAN',409); throw e; }
  const recovery = await lstat(join(config.directory, 'wallet.recovery')).catch(e => {
    if (e.code !== 'ENOENT') throw e; return null;
  });
  if (recovery) {
    await releaseLease(config.directory, instanceId);
    throw new WalletError('WALLET_RECOVERY_IN_PROGRESS',409);
  }
}

/** verifier/vendor arguments are a trusted embedding seam, never HTTP parameters. */
export async function startWalletServer({directory, port = 0, verifier, vendor, inspectBound} = {}) {
  const config = await readWallet(directory);
  requireValue(Number.isInteger(port) && port >= 0 && port <= 65535, 'WALLET_PORT_INVALID');
  if (inspectBound) await inspectBound(config);
  else {
    const {inspectOperatorConfig} = await import('../operator.mjs');
    const bound = await inspectOperatorConfig(config.nativeSignerConfig);
    requireValue(bound.summary.buyerConfigSha256 === config.buyerSha256 &&
      bound.expected.payer === config.payer && bound.config.signerProvider === config.provider &&
      JSON.stringify(bound.expected.operation) === JSON.stringify(config.operation) &&
      JSON.stringify(bound.expected.body) === JSON.stringify(config.body),
    'WALLET_NATIVE_BUYER_BINDING_CHANGED');
  }
  verifier ??= await loadVerifier(config);
  vendor ??= await loadFreighterBundle();
  requireValue(Buffer.isBuffer(vendor.bytes) && vendor.bytes.length <= 2097152, 'WALLET_VENDOR_INVALID');
  const instanceId = randomUUID();
  await takeLease(config, instanceId);
  let store, server, closing, origin, launch;
  const browserToken = randomBytes(32).toString('hex');
  const providerToken = randomBytes(32).toString('hex');
  const reply = (res, status, value, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, {
      'content-type':type, 'cache-control':'no-store', 'x-content-type-options':'nosniff',
      'referrer-policy':'no-referrer', 'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    });
    res.end(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value));
  };
  async function route(req, res) {
    requireValue(!closing, 'WALLET_CLOSING',503);
    requireValue(req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::ffff:127.0.0.1',
      'WALLET_LOOPBACK_REQUIRED',403);
    requireValue(req.headers.host === new URL(origin).host, 'WALLET_HOST_REJECTED',403);
    const url = new URL(req.url, origin);
    requireValue(url.origin === origin && !url.search && !url.hash, 'WALLET_ROUTE_INVALID',404);
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const [path,type] = assets.get(url.pathname);
      return reply(res,200,await readFile(join(ownPath,path)),type);
    }
    if (req.method === 'GET' && url.pathname === '/vendor/freighter-api.js')
      return reply(res,200,vendor.bytes,'text/javascript; charset=utf-8');
    const browser = url.pathname.startsWith('/api/');
    const provider = url.pathname.startsWith('/provider/');
    requireValue(browser || provider,'WALLET_ROUTE_NOT_FOUND',404);
    requireValue(tokenEqual(req.headers.authorization, 'Bearer ' + (browser ? browserToken : providerToken)),
      'WALLET_SESSION_REQUIRED',401);
    if (browser) {
      requireValue(!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin',
        'WALLET_ORIGIN_REJECTED',403);
      requireValue(req.method === 'GET' || req.headers.origin === origin, 'WALLET_ORIGIN_REJECTED',403);
    } else requireValue(req.headers.origin === undefined, 'WALLET_PROVIDER_BROWSER_REJECTED',403);

    if (req.method === 'GET' && url.pathname === '/api/state')
      return reply(res,200,{...await store.view(), instanceId, freighterVersion:vendor.version, bundleSha256:vendor.sha256});
    if (req.method === 'GET' && url.pathname === '/provider/ready') {
      const view = await store.view();
      return reply(res,200,{walletId:config.walletId, buyerSha256:config.buyerSha256, instanceId,
        state:view.connection ? 'CONNECTED' : 'AWAITING_WALLET', network:config.network, payer:config.payer});
    }
    if (req.method === 'POST' && url.pathname === '/provider/requests')
      return reply(res,202,await store.enqueue(await body(req)));
    const result = /^\/provider\/requests\/([a-f0-9]{64})$/.exec(url.pathname);
    if (req.method === 'GET' && result) return reply(res,200,await store.result(result[1]));
    const cancellation=/^\/provider\/requests\/([a-f0-9]{64})\/cancel$/.exec(url.pathname);
    if(req.method==='POST' && cancellation) {
      const value=await body(req);
      requireValue(Object.keys(value).length===0,'WALLET_CANCEL_BODY_INVALID');
      return reply(res,200,await store.cancel(cancellation[1]));
    }
    if (req.method === 'POST' && url.pathname === '/api/connect')
      return reply(res,200,await store.connect(await body(req)));
    if (req.method === 'POST' && url.pathname === '/api/disconnect') {
      const value = await body(req); return reply(res,200,await store.disconnect(value.connectionId));
    }
    const action = /^\/api\/requests\/([a-f0-9]{64})\/(claim|complete|reject)$/.exec(url.pathname);
    if (req.method === 'POST' && action) {
      const value = await body(req);
      requireValue(value.id === undefined || value.id === action[1], 'WALLET_REQUEST_ID_MISMATCH',409);
      return reply(res,200,await store[action[2]]({...value,id:action[1]}));
    }
    throw new WalletError('WALLET_ROUTE_NOT_FOUND',404);
  }
  try {
    store = await openWalletStore(config, verifier);
    server = createServer((req,res) => { route(req,res).catch(e => {
      if (!res.headersSent) reply(res,e instanceof WalletError ? e.status : 500,{error:code(e)});
      else res.destroy();
    }); });
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    await new Promise((resolve,reject) => {
      server.once('error',reject); server.listen(port,'127.0.0.1',() => {server.off('error',reject);resolve();});
    });
    origin = 'http://127.0.0.1:' + server.address().port;
    launch = {schema:LAUNCH_SCHEMA, state:'LISTENING', walletId:config.walletId,
      buyerSha256:config.buyerSha256, instanceId, pid:process.pid, origin,
      browserToken, providerToken, url:origin + '/#session=' + browserToken,
      freighterVersion:vendor.version, bundleSha256:vendor.sha256, startedAt:new Date().toISOString()};
    await writeAtomic(join(directory,'launch.json'),launch);
    const close = async () => {
      if (closing) return closing;
      closing = (async () => {
        let failure;
        try {await store.close();} catch(error) {failure=error;}
        // Stop the listener even when a full disk prevents state persistence.
        await new Promise(resolve => {
          server.close(resolve);server.closeAllConnections?.();
        });
        try {
          await writeAtomic(join(directory,'launch.json'),{
            schema:LAUNCH_SCHEMA,state:'CLOSED',walletId:config.walletId,buyerSha256:config.buyerSha256,
            instanceId,pid:process.pid,closedAt:new Date().toISOString(),
          });
        } catch(error) {failure??=error;}
        try {await releaseLease(directory,instanceId);} catch(error) {failure??=error;}
        if(failure)throw failure;
      })();
      return closing;
    };
    return Object.freeze({url:launch.url,origin,instanceId,walletId:config.walletId,close});
  } catch (e) {
    await store?.close().catch(() => {});
    if (server?.listening) {server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));}
    await releaseLease(directory,instanceId);
    throw e;
  }
}
