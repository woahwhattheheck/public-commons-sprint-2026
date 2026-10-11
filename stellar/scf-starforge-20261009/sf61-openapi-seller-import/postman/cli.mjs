#!/usr/bin/env node
// MIT. File intake that delegates merchant creation to the original workspace.
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectPostman, preparePostmanSource, openPostmanSource } from './collection.mjs';
import { writeSourceFile } from '../source-bundle-files.mjs';

const HELP = `Postman merchant onboarding

  starforge openapi postman inspect --collection collection.json [--environment environment.json] [--decisions decisions.json]
  starforge openapi postman source --collection collection.json [--environment environment.json] --decisions decisions.json --out PRIVATE/source.json
  starforge openapi postman inspect --source PRIVATE/source.json
  starforge openapi postman plan --source PRIVATE/source.json --out PRIVATE/merchant-plan.json
  starforge openapi postman merchant --source PRIVATE/source.json --plan PRIVATE/merchant-plan.json --out-parent PRIVATE --name merchant-api

decisions.json selects original request pointers and reviewed public samples:
{"publicVariables":{},"requests":[{"pointer":"/item/0","responseMode":"json"}]}

Inspect the resolved requests before source creation. A pre-request script needs
the explicit per-request useResolvedValues:true decision. Scripts are retained
as source but do not run. Backend header values come from the original launch
environment; generated plans contain references only. Source/environment files
can already contain private values, so retain the entire packet privately.

plan creates the original editable merchant plan. Fill its public seller URL,
payment asset/recipient, per-route atomic prices and actual header environment
names before merchant. The original compiler checks those terms. Open source.json
in openapi-workspace to review, save, run and reopen the same configuration.
Outputs are private and create-only; an identical completed source/plan reopens.
`;

async function read(path) {
  const file = await open(resolve(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat({bigint:true});
    if (!before.isFile() || before.size > 4n * 1024n * 1024n) throw new TypeError('Use a regular source file up to 4 MiB');
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break; offset += bytesRead;
    }
    const after = await file.stat({bigint:true});
    if (offset !== bytes.length || ['dev','ino','size','mtimeNs','ctimeNs'].some(key => before[key] !== after[key]))
      throw new Error('Source changed during its read; inspect the current file again');
    return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes);
  } finally { await file.close(); }
}
async function output(path, text) {
  const parent = await lstat(dirname(resolve(path)));
  if (!parent.isDirectory() || process.platform !== 'win32' && (parent.mode & 0o077) !== 0)
    throw new TypeError('Create a private output parent directory with mode 0700');
  return writeSourceFile(path, text);
}
function optionsFor(args) {
  const result = {};
  const allowed = ['--collection','--environment','--decisions','--source','--out','--plan','--out-parent','--name'];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(result,args[i]))
      throw new TypeError('Invalid or repeated Postman option; use --help');
    result[args[i]] = args[i + 1];
  }
  return result;
}
export async function runPostmanCLI(args = process.argv.slice(2)) {
  if (!args.length || ['help','--help','-h'].includes(args[0])) {process.stdout.write(HELP); return null;}
  const [command, ...tail] = args, options = optionsFor(tail);
  const allowed = {inspect:['--collection','--environment','--decisions','--source'],
    source:['--collection','--environment','--decisions','--out'], plan:['--source','--out'],
    merchant:['--source','--plan','--out-parent','--name']}[command];
  if (!allowed || Object.keys(options).some(key => !allowed.includes(key))) throw new TypeError('Choose inspect, source, plan or merchant with its listed options');
  let result;
  if (options['--source']) {
    if (options['--collection'] || options['--environment'] || options['--decisions']) throw new TypeError('Inspect either a retained source or a collection selection');
    const specText = await read(options['--source']), opened = openPostmanSource(JSON.parse(specText));
    if (command === 'inspect') result = opened.summary;
    else if (command === 'plan') {
      if (!options['--out']) throw new TypeError('Supply --out');
      const plan = {schema:'stellar-forge.api-merchant-plan.v1', sellerServer:'', serviceName:'',
        payment:{network:'stellar:testnet', asset:'', payTo:'', maxTimeoutSeconds:60, paymentFlow:'authorization'},
        allowLoopbackUpstream:false, operations:opened.operations.map(row => ({...row, amountAtomic:''}))};
      result = {...await output(options['--out'], JSON.stringify(plan,null,2) + '\n'),
        state:'NEEDS_MERCHANT_TERMS', operations:plan.operations.length};
    } else if (command === 'merchant') {
      if (!['--plan','--out-parent','--name'].every(key => options[key])) throw new TypeError('Supply --plan, --out-parent and --name');
      const {savePackage} = await import('../workspace/model.mjs');
      result = await savePackage({specText, plan:JSON.parse(await read(options['--plan'])),
        parent:options['--out-parent'], name:options['--name']});
    } else throw new TypeError('Use --collection and --decisions for source creation');
  } else {
    if (!options['--collection'] || !['inspect','source'].includes(command)) throw new TypeError('Supply --source or the original --collection');
    const input = {collectionText:await read(options['--collection']),
      ...(options['--environment'] ? {environmentText:await read(options['--environment'])} : {}),
      ...(options['--decisions'] ? {decisions:JSON.parse(await read(options['--decisions']))} : {})};
    if (command === 'inspect') result = inspectPostman(input);
    else {
      if (!options['--decisions'] || !options['--out']) throw new TypeError('Supply reviewed --decisions and a private --out');
      const prepared = preparePostmanSource(input);
      result = {...await output(options['--out'], prepared.specText), review:prepared.review};
    }
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runPostmanCLI().catch(error => {process.stderr.write(error.message + '\n'); process.exitCode = 1;});
