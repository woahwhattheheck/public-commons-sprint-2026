// One command for the existing local Creator Pool app. Never targets a public chain.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function occupied(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: host.replace(/^\[|\]$/g, ''), port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true));
    socket.once('error', error => done(error.code !== 'ECONNREFUSED'));
    socket.setTimeout(1000, () => done(true));
  });
}

async function json(url, body) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${url}`);
  return await response.json();
}

export async function startLocal({ backendDir = path.resolve(HERE, '..'), env = process.env, log = console.log } = {}) {
  if (env.CP_MODE && env.CP_MODE !== 'local') throw new Error('npm run demo is local-only. Use the existing public-mode operator path for a deployed network.');
  const data = path.resolve(backendDir, env.CP_DATA_DIR || 'data');
  const rpc = new URL(env.RPC_URL || 'http://127.0.0.1:8545');
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || 8787);
  if (rpc.protocol !== 'http:' || !LOOPBACK.has(rpc.hostname) || rpc.username || rpc.password || rpc.search || rpc.hash) throw new Error('The demo requires an HTTP loopback RPC without credentials or query parameters.');
  if (!LOOPBACK.has(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The demo requires a loopback HOST and a valid PORT.');
  const rpcPort = Number(rpc.port || 80);
  if (rpcPort === port) throw new Error('The API and local chain need different ports.');
  const address = `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
  const depFile = path.join(data, 'deployment.json');
  const abiFile = path.join(data, 'abi.json');
  const dbPath = path.join(data, 'ganache-db');
  const lockFile = path.join(data, '.demo-launcher.lock');
  const children = new Set();
  let lockOwned = false;
  let stopping = false;
  let failure = null;
  let releaseRun;
  const lifetime = new Promise(resolve => { releaseRun = resolve; });
  const rpcCall = async (method, params = []) => {
    const value = await json(rpc, { jsonrpc: '2.0', id: 1, method, params });
    if (value.error || value.result === undefined) throw new Error(`Local RPC failed ${method}.`);
    return value.result;
  };
  const readDeployment = () => {
    if (!fs.existsSync(depFile)) return null;
    const dep = JSON.parse(fs.readFileSync(depFile, 'utf8'));
    if (dep.mode !== 'local' || !['1337', '31337'].includes(String(dep.chainId)) ||
        !/^0x[0-9a-f]{40}$/i.test(dep.poolAddress || '') || !/^0x[0-9a-f]{40}$/i.test(dep.tokenAddress || '')) {
      throw new Error('Saved deployment is not a recognized local Creator Pool deployment. Existing data was left intact.');
    }
    if (!fs.existsSync(abiFile)) throw new Error('Saved deployment has no abi.json. Restore the matching files; the launcher will not redeploy over it.');
    const abi = JSON.parse(fs.readFileSync(abiFile, 'utf8'));
    if (!Array.isArray(abi.CreatorPool) || !Array.isArray(abi.DemoToken)) throw new Error('Saved abi.json is incomplete. Restore the matching deployment files.');
    return dep;
  };
  const checkChain = async dep => {
    const chainId = BigInt(await rpcCall('eth_chainId')).toString();
    if (!['1337', '31337'].includes(chainId)) throw new Error(`Refusing chain ${chainId}: only local development chains 1337/31337 are allowed.`);
    if (dep) {
      if (chainId !== String(dep.chainId)) throw new Error('Saved deployment and RPC chain IDs differ. Point RPC_URL at the original chain; no data was reset.');
      for (const contract of [dep.poolAddress, dep.tokenAddress]) {
        const code = await rpcCall('eth_getCode', [contract, 'latest']);
        if (typeof code !== 'string' || !/^0x[0-9a-f]+$/i.test(code) || /^0x0*$/i.test(code)) throw new Error('The saved contracts are missing from this chain. Restore the original ganache-db/RPC and deployment together; automatic redeployment is disabled.');
      }
    }
  };
  const matchingApi = async dep => {
    const state = await json(address + '/api/state');
    if (!dep || state.mode !== 'local' || String(state.network?.chainId) !== String(dep.chainId) ||
        state.contracts?.pool?.toLowerCase() !== dep.poolAddress.toLowerCase() ||
        state.contracts?.token?.toLowerCase() !== dep.tokenAddress.toLowerCase() || state.asset?.nonMonetaryDemo !== true) {
      throw new Error('The occupied API port does not serve this saved local Creator Pool deployment.');
    }
  };
  const live = () => {
    if (failure) throw failure;
    if (stopping) throw new Error('Local app stopped.');
  };
  const waitFor = async (label, probe, timeout = 30000) => {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      live();
      try { return await probe(); } catch (error) { last = error; }
      await pause(200);
    }
    throw new Error(`${label} did not become ready: ${last?.message || 'timed out'}`);
  };
  const childEnv = { ...env, CP_MODE: 'local', CP_DATA_DIR: data, RPC_URL: rpc.href, HOST: host, PORT: String(port) };
  const launch = (label, script, args = [], transient = false) => {
    live();
    const child = spawn(process.execPath, [script, ...args], { cwd: backendDir, env: childEnv, stdio: 'inherit' });
    children.add(child);
    let settled = false;
    const completed = new Promise((resolve, reject) => {
      const finish = (code, error) => {
        if (settled) return;
        settled = true;
        children.delete(child);
        const problem = error || (code === 0 && transient ? null : new Error(`${label} exited${code === null ? '' : ` (${code})`}.`));
        if (problem && !stopping) { failure = problem; releaseRun(); }
        if (problem) reject(problem); else resolve();
      };
      child.once('error', error => finish(null, error));
      child.once('exit', code => finish(code));
    });
    // Background processes report errors through live()/lifetime; no unhandled rejection.
    completed.catch(() => {});
    return completed;
  };
  const stop = () => { stopping = true; releaseRun(); };
  const shutdown = async () => {
    stopping = true;
    const owned = [...children];
    const exits = owned.map(child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
      child.once('error', resolve);
      child.kill('SIGTERM');
    }));
    let timer;
    await Promise.race([Promise.all(exits), new Promise(resolve => { timer = setTimeout(resolve, 4000); })]);
    clearTimeout(timer);
    for (const child of owned) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all(exits);
    if (lockOwned) fs.rmSync(lockFile, { force: true });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    let dep = readDeployment();
    if (!dep && [abiFile, path.join(data, 'state.json')].some(file => fs.existsSync(file))) throw new Error('Partial local deployment found. Restore the matching deployment.json; existing state will not be replaced.');
    if (await occupied(host, port)) {
      try { await matchingApi(dep); await checkChain(dep); }
      catch (error) { throw new Error(`Port ${port} is already occupied. ${error.message}`); }
      log(`Creator Pool is already running at ${address}. Existing processes and campaigns were left in place.`);
      return;
    }
    fs.mkdirSync(data, { recursive: true });
    if (fs.existsSync(lockFile)) {
      const pid = Number(fs.readFileSync(lockFile, 'utf8').trim());
      if (!Number.isInteger(pid) || pid < 1) throw new Error(`Invalid launcher lock at ${lockFile}; inspect it before removing it.`);
      try { process.kill(pid, 0); throw new Error(`Another launcher (${pid}) is starting this data directory. Wait for its URL or stop that launcher.`); }
      catch (error) {
        if (error.code !== 'ESRCH') throw error;
        throw new Error(`The previous launcher (${pid}) is gone, but its lock remains at ${lockFile}. After confirming no launcher uses this data directory, remove only that lock file and run npm run demo again. Saved campaigns were left intact.`);
      }
    }
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    lockOwned = true;
    if (!dep && fs.existsSync(dbPath) && fs.readdirSync(dbPath).length) throw new Error('Existing ganache-db has no matching deployment.json. Restore the complete data directory; the launcher will not replace its contracts.');
    const rpcRunning = await occupied(rpc.hostname, rpcPort);
    if (!rpcRunning) {
      if (rpc.pathname !== '/') throw new Error('No RPC is listening. An automatically started Ganache requires a root-path RPC_URL.');
      fs.mkdirSync(dbPath, { recursive: true });
      let ganache;
      try { ganache = createRequire(path.join(backendDir, 'package.json')).resolve('ganache/dist/node/cli.js'); }
      catch { throw new Error('Ganache is not installed. From creator-pool/backend run npm install (including dev dependencies), then npm run demo.'); }
      launch('Local chain', ganache, ['--wallet.deterministic', '--chain.chainId', dep ? String(dep.chainId) : '1337', '--server.host', rpc.hostname.replace(/^\[|\]$/g, ''), '--server.port', String(rpcPort), '--database.dbPath', dbPath, '--logging.quiet']);
      await waitFor('Local chain', () => rpcCall('eth_chainId'));
    }
    await checkChain(dep);
    if (!dep) {
      log('Preparing the first local CPDEMO deployment (non-monetary development tokens).');
      let deployTimer;
      try {
        await Promise.race([launch('Initial local deployment', path.join(backendDir, 'scripts/deploy-local.mjs'), [], true), new Promise((_, reject) => { deployTimer = setTimeout(() => reject(new Error('Initial local deployment timed out. Existing data was retained.')), 60000); }), lifetime]);
        live();
      } finally { clearTimeout(deployTimer); }
      dep = readDeployment();
      if (!dep) throw new Error('Local deployment did not write deployment.json.');
      await checkChain(dep);
    } else log('Resuming the saved local deployment and campaign data.');
    launch('Campaign API', path.join(backendDir, 'server.mjs'));
    await waitFor('Campaign workspace', () => matchingApi(dep));
    log(`Creator Pool is ready at ${address}\nCPDEMO has no monetary value. Keep this terminal open; Ctrl+C stops only processes started here.\nSaved campaigns: ${data}`);
    await lifetime;
    if (failure) throw failure;
  } catch (error) {
    if (!stopping || failure) throw error;
  } finally {
    await shutdown();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startLocal().catch(error => { console.error(`Creator Pool: ${error.message}`); process.exitCode = 1; });
}
