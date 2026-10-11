#!/usr/bin/env node
// MIT. Prepare and inspect the original merchant host; never install services implicitly.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, prepare, checkBundle } from './host.mjs';
import { retainedRuntimeCheck } from './retained-release.mjs';

const HELP = `node cli.mjs generate --plan PRIVATE_HOST.json --out NEW_PRIVATE_DIRECTORY
node cli.mjs inspect --plan PRIVATE_HOST.json
node cli.mjs check --bundle PRIVATE_DIRECTORY
node cli.mjs smoke --bundle PRIVATE_DIRECTORY [--public]
node cli.mjs maintenance --help

Generate Caddy/systemd for original API sellers, retained SF82 releases with signed
discovery, or the original paid-file checkout/receiver and continuous SF98 delivery.
The bundle includes exact operating and
recovery commands. Generation reads the selected config and writes a new bundle;
it does not install/reload services, read environment values or execute payments.`;

export async function smoke(bundle, { publicOrigin = false } = {}) {
  const p = await checkBundle(bundle);
  const checks = [
    ['seller readiness', `http://127.0.0.1:${p.sellerPort}/_seller/ready`, 200],
    ['original offers', `http://127.0.0.1:${p.sellerPort}/_seller/offers`, 200],
    ...(p.operationsPort ? [['private operations', `http://127.0.0.1:${p.operationsPort}/api/snapshot`, 200]] : []),
    ...(p.discovery ? [
      ['original discovery readiness', `http://127.0.0.1:${p.discoveryPort}/healthz`, 200],
      ['original discovery resources', `http://127.0.0.1:${p.discoveryPort}/discovery/resources?limit=1`, 200],
    ] : []),
    ...(p.receiverState ? [['receiver health', `http://127.0.0.1:${p.receiverPort}/health`, 200]] : []),
    ...(publicOrigin ? [
      ['public seller documentation', p.publicOrigin + '/_seller/openapi.json', 200],
      ['private health not exposed', p.publicOrigin + '/_seller/health', 404],
      ['private operations not exposed', p.publicOrigin + '/api/snapshot', 404],
      ['private delivery export not exposed', p.publicOrigin + '/delivery.json', 404],
      ...(p.discovery ? [
        ['public discovery resources', p.publicOrigin + '/discovery/resources?limit=1', 200],
        ['public discovery search', p.publicOrigin + '/discovery/search?query=merchant&limit=1', 200],
        ['public original offer export', p.discovery.sourceURL, 200],
        ['private catalog health not exposed', p.publicOrigin + '/healthz', 404],
        ['private catalog control not exposed', p.publicOrigin + '/v1/command', 404],
      ] : []),
      ...(p.receiverState ? [['receiver health not exposed', p.publicOrigin + '/health', 404]] : []),
    ] : []),
  ];
  const results = await Promise.all(checks.map(async ([name, url, expected]) => {
    try {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      await response.body?.cancel();
      return { name, expected, actual: response.status, passed: response.status === expected };
    } catch { return { name, expected, passed: false, error: 'HTTP_REQUEST_FAILED' }; }
  }));
  if (p.release) {
    try { results.push(await retainedRuntimeCheck(p)); }
    catch { results.push({ name: 'original retained process and source', passed: false, error: 'RETAINED_PROCESS_UNAVAILABLE' }); }
  }
  return { merchant: p.merchant, mode: p.mode, passed: results.every(x => x.passed), checks: results,
    paidRequestsExecuted: 0 };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') { console.log(HELP); return 0; }
  if (args[0] === 'maintenance') return (await import('./maintenance-cli.mjs')).main(args.slice(1));
  const [command, ...rest] = args;
  const allowed = { generate: ['--plan','--out'], inspect: ['--plan'], check: ['--bundle'], smoke: ['--bundle','--public'] }[command];
  if (!allowed) throw new Error(HELP);
  const values = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!allowed.includes(key) || values[key] !== undefined) throw new Error(HELP);
    if (key === '--public') values[key] = true;
    else { if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(HELP); values[key] = rest[++i]; }
  }
  let result;
  if (command === 'generate' && values['--plan'] && values['--out']) result = await generate(values['--plan'], values['--out']);
  else if (command === 'inspect' && values['--plan']) {
    const p = await prepare(values['--plan']);
    result = { merchant: p.merchant, kind: p.kind, mode: p.mode, origin: p.publicOrigin,
      target: p.target, services: p.services, routes: p.routes, stateRoot: p.stateRoot,
      outbox: p.outbox, receiverState: p.receiverState,
      ...(p.release ? { release: p.release, discovery: p.discovery } : {}), environmentValuesRead: false };
  } else if (command === 'check' && values['--bundle']) {
    const p = await checkBundle(values['--bundle']);
    result = { merchant: p.merchant, status: 'CONFIGURATION_AND_ENTRYPOINTS_MATCH', services: p.services.map(s => s.unit) };
  } else if (command === 'smoke' && values['--bundle']) result = await smoke(values['--bundle'], { publicOrigin: !!values['--public'] });
  else throw new Error(HELP);
  console.log(JSON.stringify(result, null, 2));
  return result.passed === false ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
