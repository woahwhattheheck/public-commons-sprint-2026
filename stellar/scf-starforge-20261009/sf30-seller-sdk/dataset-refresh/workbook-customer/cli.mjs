#!/usr/bin/env node
// MIT. Installed/source entrypoint for original workbook customer operations.
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buyer } from '../../../sf88-operator-buyer-cli/node/index.mjs';
import { readBytes, readJson, jsonBytes, need, safeCode } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { WorkbookCustomer } from './client.mjs';
import { WorkbookDelivery } from './delivery.mjs';

const RUNTIME = fileURLToPath(new URL('../../../sf88-operator-buyer-cli/', import.meta.url));
const FLAGS = new Set(['help','no-wait','wait']);
const SHARED = ['packet','app','runtime','profile'];
const COMMANDS = {
  import:['packet','review','config','id'],
  review:['packet'],
  initialize:[...SHARED,'workspace','max-pages','max-total-atomic','max-rows','max-page-bytes'],
  attach:[...SHARED,'session'],
  status:[...SHARED], run:[...SHARED], recover:[...SHARED],
  accounting:[...SHARED,'options'], finalize:[...SHARED,'options'],
  'finalize-all':[...SHARED,'options'], 'export-accounting':[...SHARED,'out','options'],
  deliver:[...SHARED,'out'],
  'delivery-list':['packet'],
  copy:['packet','room','out','max-output-bytes'],
  open:['delivery'],
  rows:['delivery'],
  'copy-delivery':['delivery','out','max-output-bytes'],
  'analysis-register':['packet','room','alias','database'],
  'analysis-receive':['packet','room','alias','database','source','source-revision',
    'columns-file','import-id','view','view-revision','no-wait'],
  'analysis-resume':['packet','room','alias','import-id','no-wait'],
  'analysis-history':['packet','room','alias'],
  'analysis-call':['packet','room','alias','operation','request','wait'],
};
const HELP = `Workbook customer — source/installed original-engine workflow

  import --packet DIR --review ORIGINAL_REVIEW_JSON --config ORIGINAL_BUYER_JSON --id DATASET_ID
  review --packet DIR
  initialize --packet DIR --app PRIVATE_APP --max-pages N --max-total-atomic TEXT
             [--profile PRIVATE_PROFILE_JSON | --workspace ORIGINAL_PRIVATE_WORKSPACE]
             [--max-rows N] [--max-page-bytes N] [--runtime ORIGINAL_SF88_DIR]
  attach --packet DIR --app PRIVATE_APP --session ORIGINAL_SESSION [--runtime DIR]
  status|run|recover --packet DIR --app PRIVATE_APP [--runtime DIR]
  accounting|finalize|finalize-all --packet DIR --app PRIVATE_APP [--options ORIGINAL_JSON]
  export-accounting --packet DIR --app PRIVATE_APP --out NEW_DIR [--options ORIGINAL_JSON]
  deliver --packet DIR --app PRIVATE_APP --out ORIGINAL_SF100_ROOM
  delivery-list --packet DIR
  copy --packet DIR --room ORIGINAL_SF100_ROOM --out PORTABLE_DIR [--max-output-bytes N]
  open|rows --delivery PORTABLE_DIR
  copy-delivery --delivery PORTABLE_DIR --out ANOTHER_DIR [--max-output-bytes N]

  analysis-register --packet DIR --room ORIGINAL_SF100_ROOM --alias NAME --database LIVE_ANALYSIS_DIR
  analysis-receive --packet DIR --room ORIGINAL_SF100_ROOM --alias NAME --source SOURCE_NAME
                   [--database LIVE_ANALYSIS_DIR] [--import-id 32_HEX] [--source-revision N]
                   [--columns-file ORIGINAL_JSON_OBJECT_TEXT] [--view VIEW_NAME] [--view-revision N]
                   [--no-wait]
  analysis-resume --packet DIR --room ORIGINAL_SF100_ROOM --alias NAME --import-id 32_HEX [--no-wait]
  analysis-history --packet DIR --room ORIGINAL_SF100_ROOM --alias NAME
  analysis-call --packet DIR --room ORIGINAL_SF100_ROOM --alias NAME
                --operation ORIGINAL_OPERATION [--request JSON_FILE] [--wait]

Use the existing merchant workspace's draft review and prepared buyer downloads.
The imported buyer file remains exact original bytes. Acquisition limits and signing
belong to the original Buyer. Run acquires pages; deliver/copy/open consume saved data.
Analysis commands connect to an already running original AnalysisWorkspace.
Keep SQL parameters_text and columns_text as original JSON text.
`;

function args(argv) {
  if (!argv.length || argv.includes('--help')) return {command:'help', options:{}};
  const [command,...tokens] = argv;
  need(Object.hasOwn(COMMANDS, command), 'WORKBOOK_CLI_COMMAND_INVALID');
  const options = {};
  for (let i=0; i<tokens.length; i++) {
    const token=tokens[i];
    need(token.startsWith('--'), 'WORKBOOK_CLI_ARGUMENT_INVALID');
    const key=token.slice(2);
    need(COMMANDS[command].includes(key) && !Object.hasOwn(options,key), 'WORKBOOK_CLI_OPTION_INVALID');
    if (FLAGS.has(key)) options[key]=true;
    else {
      need(i+1<tokens.length && !tokens[i+1].startsWith('--'), 'WORKBOOK_CLI_VALUE_REQUIRED');
      options[key]=tokens[++i];
    }
  }
  return {command,options};
}
function required(options,key) {
  need(typeof options[key] === 'string' && options[key].length>0, 'WORKBOOK_CLI_' + key.toUpperCase().replaceAll('-','_') + '_REQUIRED');
  return options[key];
}
function path(options,key) { return resolve(required(options,key)); }
function number(options,key, fallback) {
  if (options[key]===undefined) return fallback;
  need(/^(?:0|[1-9][0-9]*)$/.test(options[key]), 'WORKBOOK_CLI_INTEGER_REQUIRED');
  const value=Number(options[key]);
  need(Number.isSafeInteger(value), 'WORKBOOK_CLI_SAFE_INTEGER_REQUIRED');
  return value;
}
function output(value) {
  process.stdout.write(jsonBytes(value));
  const nativeProcess=value?.process;
  if (nativeProcess && nativeProcess.exitCode!==0)
    process.exitCode=Number.isInteger(nativeProcess.exitCode) && nativeProcess.exitCode>0 ? nativeProcess.exitCode : 1;
  const status=value?.job?.result?.status ?? (value?.operation && value?.result?.status);
  if (['FAILED','INTERRUPTED','CANCELLED'].includes(status)) process.exitCode=1;
}
async function nativeCustomer(options) {
  const buyer=new Buyer({stateDirectory:path(options,'app'),
    runtimeDirectory:options.runtime===undefined ? RUNTIME : path(options,'runtime'),
    ...(options.profile===undefined ? {} : {operatorProfile:path(options,'profile')})});
  return WorkbookCustomer.open({directory:path(options,'packet'),buyer});
}
async function offlineCustomer(options) {
  return WorkbookCustomer.open({directory:path(options,'packet')});
}
function deliverySummary(delivery) {
  return {request:delivery.request, publisherReview:delivery.publisherReview, native:delivery.native,
    datasetManifest:delivery.datasetManifest, pathMapping:delivery.pathMapping,
    bundleDirectory:delivery.bundleDirectory, manifest:delivery.manifest};
}

export async function main(argv=process.argv.slice(2)) {
  const {command,options}=args(argv);
  if(command==='help') { process.stdout.write(HELP); return; }
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  const context={signal:controller.signal};
  let analysis;
  need(options.workspace === undefined || options.profile === undefined, 'WORKBOOK_WORKSPACE_PROFILE_CONFLICT');
  try {
    if(command==='import') {
      const customer=await WorkbookCustomer.create({directory:path(options,'packet'),
        reviewFile:path(options,'review'),configFile:path(options,'config'),datasetId:required(options,'id')});
      output(await customer.review());
    } else if(command==='review') output(await (await offlineCustomer(options)).review());
    else if(['initialize','attach','status','run','recover','accounting','finalize','finalize-all','export-accounting','deliver'].includes(command)) {
      const customer=await nativeCustomer(options);
      if(command==='initialize') output(await customer.initialize({
        ...(options.workspace===undefined ? {} : {workspaceDirectory:path(options,'workspace')}),
        ...(options['max-pages']===undefined ? {} : {maxPages:number(options,'max-pages')}),
        ...(options['max-total-atomic']===undefined ? {} : {maxTotalAtomic:required(options,'max-total-atomic')}),
        ...(options['max-rows']===undefined ? {} : {maxRows:number(options,'max-rows')}),
        ...(options['max-page-bytes']===undefined ? {} : {maxPageBytes:number(options,'max-page-bytes')}),
        ...context,
      }));
      else if(command==='attach') output(await customer.attach({session:path(options,'session'),...context}));
      else if(command==='deliver') output(deliverySummary(await customer.deliver(path(options,'out'),context)));
      else if(['accounting','finalize','finalize-all','export-accounting'].includes(command)) {
        const original=options.options===undefined ? {} : await readJson(path(options,'options'),65536);
        const settings={...original,...context};
        if(command==='finalize-all') for await(const page of customer.finalizeAll(settings)) output(page);
        else if(command==='export-accounting') output(await customer.exportAccounting(path(options,'out'),settings));
        else output(await customer[command](settings));
      } else output(await customer[command==='status'?'inspect':command](context));
    } else if(command==='delivery-list') {
      for await(const delivery of (await offlineCustomer(options)).deliveries()) output(delivery);
    } else if(['copy','copy-delivery','open','rows'].includes(command)) {
      const delivery=command==='copy'
        ? await (await offlineCustomer(options)).openDelivery(path(options,'room'))
        : await WorkbookDelivery.open(path(options,'delivery'));
      if(command==='rows') for await(const row of delivery.rows(context))
        process.stdout.write(JSON.stringify(row)+'\n');
      else if(command==='open') output(deliverySummary(delivery));
      else output(deliverySummary(await delivery.copyTo(path(options,'out'),{
        maxOutputBytes:number(options,'max-output-bytes'),...context})));
    } else {
      const {WorkbookAnalysis}=await import('./analysis.mjs');
      analysis=new WorkbookAnalysis({customer:await offlineCustomer(options),room:path(options,'room'),alias:required(options,'alias')});
      if(command==='analysis-register') output(await analysis.register(path(options,'database')));
      else if(command==='analysis-receive') {
        if(options.database!==undefined) await analysis.register(path(options,'database'));
        const columnsText=options['columns-file']===undefined ? '{}'
          : new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(path(options,'columns-file'),65536));
        output(await analysis.receive({
          ...(options['import-id']===undefined ? {} : {id:required(options,'import-id')}),
          source:required(options,'source'),expectedSourceRevision:number(options,'source-revision',0),
          columnsText,...(options.view===undefined ? {} : {view:required(options,'view')}),
          expectedViewRevision:number(options,'view-revision',0),wait:!options['no-wait'],...context,
        }));
      } else if(command==='analysis-resume')
        output(await analysis.resume(required(options,'import-id'),{wait:!options['no-wait'],...context}));
      else if(command==='analysis-history') for await(const item of analysis.history()) output(item);
      else {
        const request=options.request===undefined ? {} : await readJson(path(options,'request'),65536);
        let result=await analysis.call(required(options,'operation'),request,context);
        if(options.wait && result.result?.status==='RUNNING') result=await analysis.waitJob(result.result.id,context);
        output(result);
      }
    }
  } finally {
    if(analysis) await analysis.close();
    process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{
    process.stderr.write(JSON.stringify({error:safeCode(error.code??error.message,'WORKBOOK_CUSTOMER_FAILED')})+'\n');
    process.exitCode=1;
  });
