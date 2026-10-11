#!/usr/bin/env node
// MIT. Foreground launcher for the original SF101 merchant operator workflow.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMerchantDesk } from './server.mjs';
import { initializeDeskWorkspace, openDeskWorkspace, inspectDeskWorkspace } from './workspace.mjs';

const USAGE = `Original paid-file merchant desk

  merchant-desk init --dir NEW_PRIVATE_DIRECTORY --config CHECKOUT.json --files APPROVED_FILE_DIRECTORY
      [--claim-env ENV_NAME ...] [--actor OPERATOR_NAME]
  merchant-desk inspect --workspace PRIVATE_DIRECTORY
  merchant-desk start --workspace PRIVATE_DIRECTORY [--port 0]
  merchant-desk serve --config CHECKOUT.json --files APPROVED_FILE_DIRECTORY --out PRIVATE_EXPORT_DIRECTORY
      [--claim-env ENV_NAME ...] [--actor OPERATOR_NAME] [--port 0]

The desk uses the original enrolled orders and access controls. It does not start
checkout, delivery, a signer or a payment. Use the printed private loopback URL.
Provision claim token values in the existing shell environment; pass names only.
Stop the foreground desk with Ctrl-C. Restart keeps original orders and exports.`;

function parse(args) {
  const [action, ...rest] = args;
  const allowed = {
    init:['--dir','--config','--files','--claim-env','--actor'],
    inspect:['--workspace'], start:['--workspace','--port'],
    serve:['--config','--files','--out','--claim-env','--actor','--port'],
  }[action];
  if (!allowed) throw new TypeError('Choose init, inspect, start or serve. Use --help for usage.');
  const values = new Map(), claimEnvs = [];
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1];
    if (!allowed.includes(flag) || typeof value !== 'string' || value.length === 0 || value.startsWith('--') ||
      flag !== '--claim-env' && values.has(flag)) throw new TypeError('Invalid or repeated option: ' + flag);
    if (flag === '--claim-env') {
      if (claimEnvs.includes(value)) throw new TypeError('Each --claim-env name must be distinct.');
      claimEnvs.push(value);
    } else values.set(flag, value);
  }
  const required = {init:['--dir','--config','--files'],inspect:['--workspace'],
    start:['--workspace'],serve:['--config','--files','--out']}[action];
  for (const flag of required) if (!values.has(flag)) throw new TypeError('Missing required option: ' + flag);
  const portText = values.get('--port') ?? '0';
  if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) throw new TypeError('Port must be 0–65535.');
  return {action, values, claimEnvs:claimEnvs.length ? claimEnvs : ['SF101_CLAIM_TOKEN'], port:Number(portText)};
}

export async function main(args = process.argv.slice(2), {env = process.env} = {}) {
  if (!args.length || args.length === 1 && ['--help','-h','help'].includes(args[0])) {
    console.log(USAGE); return;
  }
  const {action, values:v, claimEnvs, port} = parse(args);
  const print = value => console.log(JSON.stringify(value, null, 2));
  if (action === 'init') return print(await initializeDeskWorkspace({directory:v.get('--dir'),
    config:v.get('--config'), filesRoot:v.get('--files'), claimEnvs, actor:v.get('--actor') ?? 'merchant-operator'}));
  if (action === 'inspect') return print(await inspectDeskWorkspace(v.get('--workspace'), {env}));
  const configuration = action === 'start' ? (await openDeskWorkspace(v.get('--workspace'))).settings : {
    config:resolve(v.get('--config')), filesRoot:resolve(v.get('--files')), outputRoot:resolve(v.get('--out')),
    claimEnvs, actor:v.get('--actor') ?? 'merchant-operator',
  };
  const session = await startMerchantDesk({...configuration, port, env});
  let stopping;
  const stop = () => stopping ??= session.close().catch(error => {
    console.error(error.code ?? 'MERCHANT_DESK_CLOSE_FAILED'); process.exitCode = 1;
  }).finally(() => { process.off('SIGINT', stop); process.off('SIGTERM', stop); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  print({status:'MERCHANT_DESK_RUNNING', privateUrl:session.url, actor:configuration.actor,
    ...(action === 'start' ? {workspace:resolve(v.get('--workspace'))} : {}),
    shutdown:'Ctrl-C closes this desk; original merchant services continue in their own processes.'});
  return session;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.code ?? error.message ?? 'MERCHANT_DESK_COMMAND_FAILED'); process.exitCode = 1; });
