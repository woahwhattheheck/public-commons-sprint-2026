#!/usr/bin/env node
// MIT. Installed entrypoint over the original Flowable workspace and native request/receiving records.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeFlowableProduct, inspectFlowableProduct, openFlowableProduct } from './workspace.mjs';
import { inspectFlowableProductLaunch } from './managed.mjs';
import { FlowableProductClient, flowableProductActions } from './client.mjs';
import { privateBytes, decode, need, HASH, UUID } from './common.mjs';
import { FLOWABLE_MAX_JSON_BYTES } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/workspace/actions.mjs';

const HELP = [
  'Flowable process operations product',
  '',
  '  flowable-product init --dir PRIVATE_PRODUCT [--workspace ORIGINAL_WORKSPACE] [--name NAME] [--connections PRIVATE_JSON]',
  '  flowable-product inspect --dir PRIVATE_PRODUCT',
  '  flowable-product review|open --dir PRIVATE_PRODUCT [--port 0] [--expected-binding SHA256]',
  '  flowable-product actions [--name ORIGINAL_METHOD]',
  '  flowable-product status --dir PRIVATE_PRODUCT',
  '  flowable-product records --dir PRIVATE_PRODUCT [--kind connection|portfolio|release|process|task|migration|delivery|receiving]',
  '       [--offset 0 --limit 50 --snapshot SHA256]',
  '  flowable-product record --dir PRIVATE_PRODUCT --kind KIND --id RECORD_ID [--revision NUMBER --offset 0 --limit 50]',
  '  flowable-product portfolio --dir PRIVATE_PRODUCT --id PORTFOLIO_ID --collection NATIVE_COLLECTION [--revision NUMBER --offset 0 --limit 50]',
  '  flowable-product definition --dir PRIVATE_PRODUCT --portfolio PORTFOLIO_ID --definition NATIVE_DEFINITION_ID [--revision NUMBER]',
  '  flowable-product review-operation --dir PRIVATE_PRODUCT --kind release|process|task|migration --id RECORD_ID [--revision NUMBER]',
  '  flowable-product call --dir PRIVATE_PRODUCT --method ORIGINAL_METHOD [--input PRIVATE_ARGUMENTS_JSON] [--out PRIVATE_JSON]',
  '  flowable-product download-source --dir PRIVATE_PRODUCT --reference PRIVATE_REFERENCE_JSON --out PRIVATE_FILE',
  '  flowable-product capture --dir PRIVATE_PRODUCT --request UUID --connection RECORD_ID [--label LABEL]',
  '  flowable-product prepare --dir PRIVATE_PRODUCT --kind release|process|task|migration --request UUID',
  '       --connection RECORD_ID --selection PRIVATE_SELECTION_JSON [--label LABEL --note TEXT]',
  '  flowable-product dispatch --dir PRIVATE_PRODUCT --kind release|process|task|migration --request UUID',
  '       --id RECORD_ID --revision NUMBER --plan-sha256 SHA256',
  '  flowable-product reconcile --dir PRIVATE_PRODUCT --kind release|process|task|migration --request UUID --id RECORD_ID [--revision NUMBER]',
  '  flowable-product export --dir PRIVATE_PRODUCT --request UUID [--label LABEL]',
  '  flowable-product download --dir PRIVATE_PRODUCT --id ORIGINAL_DELIVERY_ID --out PRIVATE_FILE [--sha256 SHA256]',
  '  flowable-product receive --dir PRIVATE_PRODUCT --request UUID --file ORIGINAL_NDJSON [--label LABEL]',
  '  flowable-product adopt --dir PRIVATE_PRODUCT --request UUID --id RECEIVING_ID --revision NUMBER --manifest-sha256 SHA256',
  '',
  'Use actions for the complete original method schemas and exact input fields.',
  'Each preparation saves the full native request and preimage. Migration preparation runs original engine validation.',
  'Retain each request UUID and exact arguments. Reconcile an uncertain dispatch from original native state and history.',
  'download receives an existing complete handover; receive inspects it before the separate adopt action.',
  'See products/flowable-merchant/OPERATING.md and RECEIVING.md.',
  '',
].join('\n');
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
function parse(args, allowed) {
  const options = new Map();
  for (let index = 0; index < args.length; index++) {
    const name = args[index], value = args[++index];
    need(allowed.includes(name) && !options.has(name) && typeof value === 'string' &&
      value && !value.startsWith('--'), 'Supply each declared option once: ' + name, 'ARGUMENTS');
    options.set(name, value);
  }
  return options;
}
const required = (options, name) => {
  need(options.has(name), 'Supply ' + name + '.', 'ARGUMENTS'); return options.get(name);
};
function number(options, key, fallback) {
  const text = options.get(key);
  if (text === undefined) return fallback;
  need(/^(0|[1-9][0-9]*)$/.test(text) && Number.isSafeInteger(Number(text)),
    'Use an integer for ' + key + '.', 'ARGUMENTS');
  return Number(text);
}
const inputFile = path => privateBytes(resolve(path), false, FLOWABLE_MAX_JSON_BYTES).then(decode);
const optional = (options, key, name = key.slice(2)) => options.has(key) ? { [name]: options.get(key) } : {};
const paging = options => ({ offset: number(options, '--offset', 0), limit: number(options, '--limit', 50) });
function request(options) {
  const requestId = required(options, '--request');
  need(UUID.test(requestId), 'Supply the original request UUID.', 'ARGUMENTS');
  return { requestId };
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && ['help','--help'].includes(args[0])) { process.stdout.write(HELP); return; }
  const [command,...rest] = args;
  if (command === 'init') {
    const options = parse(rest, ['--dir','--workspace','--name','--connections']);
    const result = await initializeFlowableProduct({ directory: required(options, '--dir'),
      workspaceDirectory: options.get('--workspace'), name: options.get('--name'),
      connectionsFile: options.get('--connections') });
    print(result); return result;
  }
  if (command === 'inspect') {
    const options = parse(rest, ['--dir']), result = await inspectFlowableProduct(required(options, '--dir'));
    print(result); return result;
  }
  if (['review','open'].includes(command)) {
    const options = parse(rest, ['--dir','--port','--expected-binding']);
    if (options.has('--expected-binding')) need(HASH.test(options.get('--expected-binding')), 'Supply the reviewed launch SHA-256.', 'ARGUMENTS');
    const selected = { directory: resolve(required(options, '--dir')), port: number(options, '--port', 0),
      ...optional(options, '--expected-binding', 'expectedBindingSha256') };
    if (command === 'review') {
      const result = await inspectFlowableProductLaunch(selected); print(result); return result;
    }
    const active = await openFlowableProduct(selected);
    const { workspace, native, close, ...record } = active;
    process.stdout.write(JSON.stringify(record) + '\n');
    let stopping;
    const stop = () => stopping ??= close().then(() => {
      process.off('SIGINT', stop); process.off('SIGTERM', stop);
    }).catch(error => { stopping = null; process.stderr.write((error.code ?? 'FLOWABLE_PRODUCT_CLOSE_INCOMPLETE') + '\n'); process.exitCode = 1; });
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    return active;
  }
  if (command === 'actions') {
    const options = parse(rest, ['--name']);
    const selected = flowableProductActions().filter(item => !options.has('--name') || item.name === options.get('--name'));
    need(selected.length > 0, 'Select an original Flowable method.', 'ARGUMENTS'); print(selected); return selected;
  }
  const allowed = {
    status:['--dir'],records:['--dir','--kind','--offset','--limit','--snapshot'],
    record:['--dir','--kind','--id','--revision','--offset','--limit'],
    portfolio:['--dir','--id','--collection','--revision','--offset','--limit'],
    definition:['--dir','--portfolio','--definition','--revision'],
    'review-operation':['--dir','--kind','--id','--revision'],
    'download-source':['--dir','--reference','--out'],
    call:['--dir','--method','--input','--out'],
    capture:['--dir','--request','--connection','--label'],
    prepare:['--dir','--kind','--request','--connection','--selection','--label','--note'],
    dispatch:['--dir','--kind','--request','--id','--revision','--plan-sha256'],
    reconcile:['--dir','--kind','--request','--id','--revision'],
    export:['--dir','--request','--label'],download:['--dir','--id','--out','--sha256'],
    receive:['--dir','--request','--file','--label'],
    adopt:['--dir','--request','--id','--revision','--manifest-sha256'],
  }[command];
  need(allowed,HELP,'ARGUMENTS');const options=parse(rest,allowed),controller=new AbortController();
  const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const revision=()=>options.has('--revision')?{revision:number(options,'--revision')}:{};
  const selectedKind=()=>{const value=required(options,'--kind');need(['release','process','task','migration'].includes(value),'Select release, process, task or migration.','ARGUMENTS');return value;};
  let client;
  try{
    client=new FlowableProductClient({directory:required(options,'--dir'),signal:controller.signal});let result;
    if(command==='status')result=await client.status();
    if(command==='records')result=await client.listRecords({...paging(options),...optional(options,'--kind'),...optional(options,'--snapshot')});
    if(command==='record')result=await client.getRecord({kind:required(options,'--kind'),id:required(options,'--id'),...paging(options),...revision()});
    if(command==='portfolio')result=await client.readPortfolio({id:required(options,'--id'),collection:required(options,'--collection'),...paging(options),...revision()});
    if(command==='definition')result=await client.readDefinition({portfolioId:required(options,'--portfolio'),definitionId:required(options,'--definition'),...revision()});
    if(command==='review-operation')result=await client.readReview({kind:selectedKind(),id:required(options,'--id'),...revision()});
    if(command==='download-source')result=await client.downloadSource({reference:await inputFile(required(options,'--reference')),path:resolve(required(options,'--out'))});
    if(command==='call'){const method=required(options,'--method'),input=options.has('--input')?await inputFile(options.get('--input')):{};result=options.has('--out')?await client.callToFile(method,input,{path:resolve(options.get('--out'))}):await client.call(method,input);}
    if(command==='capture')result=await client.capturePortfolio({...request(options),connectionId:required(options,'--connection'),...optional(options,'--label')});
    if(command==='prepare'){const kind=selectedKind(),method='prepare'+kind[0].toUpperCase()+kind.slice(1);result=await client.call(method,{...request(options),connectionId:required(options,'--connection'),selection:await inputFile(required(options,'--selection')),...optional(options,'--label'),...optional(options,'--note')});}
    if(command==='dispatch'){const kind=selectedKind(),method='dispatch'+kind[0].toUpperCase()+kind.slice(1);result=await client.call(method,{...request(options),id:required(options,'--id'),expectedRevision:number(options,'--revision'),planSha256:required(options,'--plan-sha256')});}
    if(command==='reconcile')result=await client.reconcileOperation({...request(options),kind:selectedKind(),id:required(options,'--id'),...(options.has('--revision')?{expectedRevision:number(options,'--revision')}:{})});
    if(command==='export')result=await client.exportWorkspace({...request(options),...optional(options,'--label')});
    if(command==='download')result=await client.downloadDelivery({id:required(options,'--id'),path:resolve(required(options,'--out')),...optional(options,'--sha256','expectedSha256')});
    if(command==='receive')result=await client.inspectDeliveryFile({...request(options),path:resolve(required(options,'--file')),...optional(options,'--label')});
    if(command==='adopt')result=await client.adoptDelivery({...request(options),id:required(options,'--id'),expectedRevision:number(options,'--revision'),manifestSha256:required(options,'--manifest-sha256')});
    print(result);return result;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await client?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'FLOWABLE_PRODUCT_ERROR',message:error.message,...(error.requestId?{requestId:error.requestId}:{}),...(error.recordId?{recordId:error.recordId}:{}),...(error.outcomeUnknown?{outcomeUnknown:true}:{})})+'\n');process.exitCode=1;});
