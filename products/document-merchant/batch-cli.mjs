#!/usr/bin/env node
// MIT. Installed batch customer commands use the original workspace and payment broker.
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  absolute,ownedDirectory,ownedBytes,writeExact,encoded,parse,digest,plain,need
} from '../../stellar/scf-starforge-20261009/sf101-merchant-receiver/api-application/workspace/configuration.mjs';
import {acquireStateLease} from '../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {startJobCustomerWorkspace} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/server.mjs';
import {inspectDocumentMerchant} from './setup.mjs';
import {
  documentBatchTemplate,prepareDocumentBatch,readDocumentBatch,openDocumentBatchCustomer,
  inspectDocumentBatch,runDocumentBatch,receiveDocumentBatch,saveDocumentBatchReport,
  exportDocumentBatch,receiveDocumentBatchCollection
} from './batch.mjs';

const HELP = [
  'Document batch customer workflow','',
  'document-merchant batch COMMAND [OPTIONS]','',
  'template --merchant-directory DIR [--out NEW_FILE]',
  'template --provider mintpdf|snaplab|pdfmint [--out NEW_FILE]',
  'prepare --request FILE --source-root DIR --directory NEW_PLAN_DIR --workspace-options FILE',
  'show --directory PLAN_DIR --workspace-options FILE',
  'review --directory PLAN_DIR --workspace-options FILE --out NEW_REPORT_DIR',
  'run --directory PLAN_DIR --workspace-options FILE --approve-plan SHA256',
  'receive --directory PLAN_DIR --workspace-options FILE',
  'export --directory PLAN_DIR --workspace-options FILE --out NEW_EXPORT_DIR',
  'open --directory PLAN_DIR --workspace-options FILE [--port PORT]',
  'receive-collection --archive FILE --destination DIR --library-state DIR --sha256 SHA256','',
  'prepare/run: --intake-key-env NAME reads the original intake access key from the environment.',
  'run/receive: --deadline-ms N and --poll-ms N select the original per-document receiving wait.',
  'export/receive-collection: --max-bytes N selects the original complete Collection allowance.',
  'run requires the exact saved batch-plan.json SHA shown by prepare or show.',
  'It continues the original checkout and receives the result for every named document.',
  'A returned supplier account allowance failure leaves the remaining original Requests ready to continue.',
  'open serves the original Request, Checkout, Jobs, Resource library and Collections application.',
  'Ctrl-C retains the same Requests, checkout attempts and completed files.'
].join('\n')+'\n';
function options(args,allowed) {
  need(args.length % 2 === 0,'DOCUMENT_BATCH_OPTION_VALUE_REQUIRED');
  const found = new Map();
  for(let i=0;i<args.length;i+=2) {
    const [key,value] = args.slice(i,i+2);
    need(allowed.includes(key) && !found.has(key) && typeof value === 'string' && value.length > 0 &&
      !value.startsWith('--'),'DOCUMENT_BATCH_OPTION_INVALID');
    found.set(key,value);
  }
  return found;
}
function required(values,key) {
  need(values.has(key),'DOCUMENT_BATCH_OPTION_REQUIRED');
  return values.get(key);
}
function number(values,key,otherwise) {
  if(!values.has(key))return otherwise;
  need(/^(?:0|[1-9][0-9]*)$/.test(values.get(key)),'DOCUMENT_BATCH_NUMBER_REQUIRED');
  const parsed = Number(values.get(key));
  need(Number.isSafeInteger(parsed),'DOCUMENT_BATCH_NUMBER_REQUIRED');
  return parsed;
}
async function saveJson(path,value) {
  path = absolute(path);
  const directory = await ownedDirectory(dirname(path),{create:true});
  const lease = await acquireStateLease(directory);
  try {
    const bytes = encoded(value);
    lease.assertHeld(); await writeExact(path,bytes);
    return {path,bytes:bytes.length,sha256:digest(bytes)};
  } finally {await lease.close();}
}
function accessKey(values) {
  if(!values.has('--intake-key-env'))return undefined;
  const name = values.get('--intake-key-env');
  need(/^[A-Z][A-Z0-9_]{2,63}$/.test(name),'DOCUMENT_BATCH_KEY_ENVIRONMENT_INVALID');
  const value = process.env[name];
  need(typeof value === 'string' && value.length > 0,'DOCUMENT_BATCH_INTAKE_KEY_REQUIRED');
  return value;
}
async function workspaceOptions(path) {
  const value = parse(await ownedBytes(absolute(path),65536));
  need(plain(value) && typeof value.directory === 'string','DOCUMENT_BATCH_WORKSPACE_OPTIONS_REQUIRED');
  absolute(value.directory);
  return value;
}

export async function runDocumentBatchCommand(argv=process.argv.slice(2),{
  print=value=>process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value,null,2)+'\n'),
  progress=value=>process.stderr.write(JSON.stringify(value)+'\n')
}={}) {
  if(!argv.length || ['--help','-h','help'].includes(argv[0]))return print(HELP);
  const [command,...args] = argv;
  const common = ['--directory','--workspace-options'];
  const accepted = {
    template:['--provider','--merchant-directory','--out'],
    prepare:[...common,'--request','--source-root','--intake-key-env'],
    show:common,
    review:[...common,'--out'],
    run:[...common,'--approve-plan','--intake-key-env','--deadline-ms','--poll-ms'],
    receive:[...common,'--deadline-ms','--poll-ms'],
    export:[...common,'--out','--max-bytes'],
    open:[...common,'--port'],
    'receive-collection':['--archive','--destination','--library-state','--sha256','--max-bytes']
  };
  need(Object.hasOwn(accepted,command),'DOCUMENT_BATCH_COMMAND_INVALID');
  const flags = options(args,accepted[command]);
  const emit = value=>print(JSON.stringify(value,null,2)+'\n');
  const controller = new AbortController();
  const stop = ()=>controller.abort(Object.assign(new Error('DOCUMENT_BATCH_CANCELLED'),{code:'DOCUMENT_BATCH_CANCELLED'}));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let workspace,host;
  try {
    if(command === 'template') {
      need(flags.has('--provider') !== flags.has('--merchant-directory'),'DOCUMENT_BATCH_TEMPLATE_SOURCE_REQUIRED');
      let value;
      if(flags.has('--merchant-directory')) {
        const installed = await inspectDocumentMerchant(absolute(flags.get('--merchant-directory')));
        const customer = parse(await ownedBytes(installed.customerSetup,1048576));
        value = documentBatchTemplate(installed.provider.provider);
        value.merchantOrigin = customer.publicOrigin;
        value.documents = value.documents.filter(item=>customer.functions.some(fn=>fn.format === item.format));
      } else value = documentBatchTemplate(required(flags,'--provider'));
      return emit(flags.has('--out') ? await saveJson(absolute(flags.get('--out')),value) : value);
    }
    if(command === 'receive-collection')return emit(await receiveDocumentBatchCollection({
      archive:absolute(required(flags,'--archive')),destination:absolute(required(flags,'--destination')),
      libraryState:absolute(required(flags,'--library-state')),expectedSha256:required(flags,'--sha256'),
      signal:controller.signal,maxBytes:number(flags,'--max-bytes',undefined)
    }));
    const originalOptions = await workspaceOptions(required(flags,'--workspace-options'));
    workspace = await openDocumentBatchCustomer(originalOptions);
    if(command === 'prepare') {
      const request = parse(await ownedBytes(absolute(required(flags,'--request')),4194304,{privateMode:false}));
      const saved = await prepareDocumentBatch({workspace,
        directory:absolute(required(flags,'--directory')),request,sourceRoot:absolute(required(flags,'--source-root')),
        intakeAccessToken:accessKey(flags) ?? null,signal:controller.signal,onProgress:progress});
      return emit({directory:saved.plan.directory,planSha256:saved.sha256,planBytes:saved.bytes,
        id:saved.plan.id,name:saved.plan.name,documents:saved.plan.items.length,
        totals:saved.plan.totals,unitMeaning:saved.plan.unitMeaning});
    }
    const saved = await readDocumentBatch(absolute(required(flags,'--directory')));
    need(workspace.directory === saved.plan.workspaceDirectory,'DOCUMENT_BATCH_CUSTOMER_CHANGED');
    if(command === 'show')return emit({planSha256:saved.sha256,
      ...await inspectDocumentBatch({workspace,plan:saved.plan,signal:controller.signal})});
    if(command === 'review') {
      const snapshot = await inspectDocumentBatch({workspace,plan:saved.plan,signal:controller.signal});
      return emit({planSha256:saved.sha256,
        ...await saveDocumentBatchReport({snapshot,plan:saved.plan,directory:absolute(required(flags,'--out'))})});
    }
    if(command === 'run')return emit(await runDocumentBatch({workspace,plan:saved.plan,
      planSha256:saved.sha256,approvedPlanSha256:required(flags,'--approve-plan'),signal:controller.signal,
      deadlineMs:number(flags,'--deadline-ms',300000),pollMs:number(flags,'--poll-ms',1500),
      intakeAccessToken:accessKey(flags),onProgress:progress}));
    if(command === 'receive')return emit(await receiveDocumentBatch({workspace,plan:saved.plan,
      signal:controller.signal,deadlineMs:number(flags,'--deadline-ms',300000),
      pollMs:number(flags,'--poll-ms',1500),onProgress:progress}));
    if(command === 'export')return emit(await exportDocumentBatch({workspace,plan:saved.plan,
      directory:absolute(required(flags,'--out')),signal:controller.signal,maxBytes:number(flags,'--max-bytes',undefined)}));
    if(command === 'open') {
      host = await startJobCustomerWorkspace({model:workspace,port:number(flags,'--port',0),
        browserApproval:true,landing:'checkout'});
      emit({batch:saved.plan.id,planSha256:saved.sha256,url:host.entryUrl,collectionsUrl:host.collectionsUrl,
        privateLaunch:host.privateLaunch,workspaceDirectory:workspace.directory});
      await new Promise(resolve=>{
        if(controller.signal.aborted)return resolve();
        controller.signal.addEventListener('abort',resolve,{once:true});
        host.server.once('close',resolve);
      });
    }
  } finally {
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    try {await host?.close();} finally {await workspace?.close();}
  }
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runDocumentBatchCommand().catch(error=>{process.stderr.write((error?.code ?? error.message)+'\n');process.exitCode=1;});
