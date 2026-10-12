#!/usr/bin/env node
// MIT. Full operations capture, review, publication and receiving on the original workspace.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGrpcOperationsClient } from './client.mjs';
import { readGrpcOperations, readGrpcOperationsBundle, receiveGrpcOperationsDownload } from './receiving.mjs';

const HELP = 'grpc-operations --connection-file /private/grpc.url COMMAND [OPTIONS]\n' +
  '  capture --id UUID [--selection /private/selection.json]\n' +
  '  captures | cases [--offset N --limit N --snapshot SHA --search TEXT --state STATE]\n' +
  '  read --capture UUID [--section summary|calls|health|timeline|methods|revisions|call|health-observation|source]\n' +
  '       [--record ID --offset N --limit N --snapshot SHA --search TEXT --phase PHASE --method PATH --revision SHA]\n' +
  '  case --case UUID [--version N]\n' +
  '  save --case UUID --capture UUID --operation UUID --expected-version N --edit /private/incident.json\n' +
  '  export --case UUID --version N --directory /private/customer-review\n' +
  '  receive --operation UUID --bundle /private/customer-review/grpc-operations.json\n' +
  '  inspect --directory /private/customer-review  (offline; no connection needed)\n' +
  'Use the original console URL file. Save operation/capture IDs and exact input files before dispatch.\n';
export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || !args.length) { console.log(HELP); return; }
  const options = {}, positional = [];
  const known = new Set(['connection-file','id','selection','offset','limit','snapshot','search','state','severity','capture',
    'section','record','phase','method','revision','case','version','operation','expected-version','edit','directory','bundle']);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!key.startsWith('--')) { positional.push(key); continue; }
    const name = key.slice(2);
    if (!known.has(name) || Object.hasOwn(options, name) || args[index + 1] === undefined || args[index + 1].startsWith('--'))
      throw new Error('Use each declared option once with its complete value.\n' + HELP);
    options[name] = args[++index];
  }
  if (positional.length !== 1) throw new Error(HELP);
  const command = positional[0], need = key => { if (!options[key]) throw new Error('Supply --' + key); return options[key]; };
  const number = key => {
    const value = need(key); if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Supply a whole --' + key);
    return Number(value);
  };
  const json = async key => JSON.parse(await readFile(resolve(need(key)), 'utf8'));
  if (command === 'inspect') { const result = await readGrpcOperations(resolve(need('directory'))); console.log(JSON.stringify(result, null, 2)); return result; }
  const raw = (await readFile(resolve(need('connection-file')), 'utf8')).trim();
  let url = raw;
  if (raw.startsWith('{')) { const value = JSON.parse(raw); url = value.url ?? value.browserUrl ?? value.console; }
  const client = createGrpcOperationsClient({ url });
  try {
    const page = {};
    for (const name of ['offset','limit']) if (options[name] !== undefined) page[name] = number(name);
    if (options.snapshot !== undefined) page.expectedSnapshot = options.snapshot;
    let result;
    if (command === 'capture') result = await client.request('capture', { id:need('id'), ...(options.selection ? { selection:await json('selection') } : {}) });
    else if (command === 'captures') result = await client.request('captures', page);
    else if (command === 'cases') result = await client.request('cases', { ...page,
      ...Object.fromEntries(['state','severity','search'].filter(key=>options[key] !== undefined).map(key=>[key,options[key]])) });
    else if (command === 'read') result = await client.request('read', { id:need('capture'), ...page,
      ...Object.fromEntries(['section','search','phase','method','revision'].filter(key=>options[key] !== undefined).map(key=>[key,options[key]])),
      ...(options.record ? { recordId:options.record } : {}) });
    else if (command === 'case') result = await client.request('case', { id:need('case'), ...(options.version ? { version:number('version') } : {}) });
    else if (command === 'save') result = await client.request('save', { id:need('case'), captureId:need('capture'),
      operationId:need('operation'), expectedVersion:number('expected-version'), edit:await json('edit') });
    else if (command === 'export') {
      const descriptor = await client.request('export', { id:need('case'), version:number('version') });
      result = await receiveGrpcOperationsDownload(client, descriptor, resolve(need('directory')));
    } else if (command === 'receive') result = await client.request('receive', { operationId:need('operation'),
      bundle:await readGrpcOperationsBundle(resolve(need('bundle'))) });
    else throw new Error(HELP);
    console.log(JSON.stringify(result, null, 2)); return result;
  } finally { await client.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(JSON.stringify({ error:error.code ?? 'GRPC_OPERATIONS_COMMAND_FAILED', message:error.message })); process.exitCode = 1; });
