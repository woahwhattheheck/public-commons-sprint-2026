#!/usr/bin/env node
// MIT. Installed operator CLI over the original Fiscal client and complete-file receiver.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectFiscalWorkspace } from './fiscaldata-workspace-client.mjs';
import { selectFiscalDownload,readFiscalSelection,writeFiscalSelection,downloadFiscalSelection,
  verifyFiscalDownload,receiveFiscalDownload,inspectReceivedFiscalWorkspace } from './fiscaldata-workspace-download.mjs';

const HELP = 'Fiscal Data remote operator and complete source receiving\n\n' +
  'fiscaldata-remote status|open|list|catalog|history|action|query|checkpoint|restore|browser|close-workspace\n' +
  '  --url HTTPS_MCP --workspace DECLARED_ALIAS [--workspace-id ORIGINAL_UUID]\n' +
  '  [--token-env MCP_ACCESS_TOKEN] [--timeout-ms 120000]\n\n' +
  'action --action ORIGINAL_ACTION --input PRIVATE_JSON\n' +
  'query --id EDITION_UUID --query limit=2\n' +
  'list --section sources|captures|editions|comparisons|exports|refreshPlans|refreshRuns\n' +
  'catalog --action get|refresh [--offset 0 --limit 50]\n' +
  'history [--offset 0 --limit 50]\n' +
  'checkpoint --operation-id ORIGINAL_ID\n' +
  'restore --input PRIVATE_ORIGINAL_RECEIVING_JSON\n' +
  'browser --action open|close [--port 0]\n' +
  'close-workspace --instance-id EXACT_INSTANCE_UUID\n\n' +
  'select --kind capture|edition|comparison|export|package --id ORIGINAL_ID\n' +
  '  [--source-sha256 ORIGINAL_SHA256] [--out ABS_PRIVATE_SELECTION_JSON]\n' +
  'download --selection ABS_SELECTION_JSON --out ABS_PRIVATE_DOWNLOAD_DIRECTORY\n' +
  '  [--selection-sha256 ORIGINAL_SHA256] [--chunk-size 196608]\n\n' +
  'Local operations require no MCP connection:\n' +
  'verify --directory ABS_DOWNLOAD [--selection-sha256 SHA256]\n' +
  'receive --directory ABS_DOWNLOAD --destination ABS_EMPTY_WORKSPACE --operation-id ORIGINAL_ID\n' +
  '  --operator-id NAMED_ID --operator-label NAME --workspace-id ORIGINAL_UUID [--selection-sha256 SHA256]\n' +
  'reopen --directory ABS_RECEIVED_WORKSPACE --workspace-id ORIGINAL_UUID\n\n' +
  'All JSON results preserve original decimal strings. Repeat a creation with its saved requestId;\n' +
  'repeat a download in the same directory, and receiving with the same operation/operator.\n' +
  'SIGINT preserves verified download prefixes and releases file reads. It does not close the remote model.\n' +
  'Bearer values are read only from the named environment variable. See FISCALDATA_CLIENT.md.\n';
const problem = message => Object.assign(new Error(message),{code:'FISCALDATA_CLIENT_CLI'});
const common = ['url','workspace','workspace-id','token-env','timeout-ms'];
const allowed = {
  status:[...common,'section','offset','limit'],open:common,
  list:[...common,'section','limit','maximum-items'],catalog:[...common,'action','offset','limit'],
  history:[...common,'offset','limit'],action:[...common,'action','input'],query:[...common,'id','query'],
  checkpoint:[...common,'operation-id'],restore:[...common,'input'],
  browser:[...common,'action','port'],'close-workspace':[...common,'instance-id'],
  select:[...common,'kind','id','source-sha256','out'],
  download:[...common,'selection','out','selection-sha256','chunk-size'],
  verify:['directory','selection-sha256'],
  receive:['directory','destination','operation-id','operator-id','operator-label','workspace-id','selection-sha256'],
  reopen:['directory','workspace-id']
};
function parse(argv) {
  const [command,...rest] = argv;
  if (!Object.hasOwn(allowed,command) || rest.length % 2) throw problem('Choose one documented command and option/value pairs; see --help.');
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index],value = rest[index + 1],key = name.replace(/^--/,'');
    if (name !== '--' + key || !allowed[command].includes(key) || Object.hasOwn(values,key) || !value || value.startsWith('--'))
      throw problem('Use each documented option once, with its complete value.');
    values[key] = value;
  }
  return {command,values};
}
function required(values,key) {if (!values[key]) throw problem('Supply --' + key + '.'); return values[key];}
function number(values,key,fallback) {
  const value = values[key]; if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw problem('--' + key + ' requires an exact non-negative integer.');
  return Number(value);
}
async function input(path) {
  path = resolve(path);
  if (await realpath(path) !== path) throw problem('Read an original JSON input without symbolic links.');
  const handle = await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({bigint:true});
    if (!before.isFile() || before.size > 16n * 1024n * 1024n || process.platform !== 'win32' &&
        (before.mode & 0o077n || process.getuid && before.uid !== BigInt(process.getuid())))
      throw problem('Use a private 0600 original JSON input, at most 16 MiB.');
    const bytes = await handle.readFile(),after = await handle.stat({bigint:true});
    if (bytes.length !== Number(before.size) || ['dev','ino','size','mtimeNs','ctimeNs'].some(key => before[key] !== after[key]))
      throw problem('The original input changed during reading.');
    const value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem('Use one original JSON object.');
    return value;
  } finally {await handle.close();}
}
export async function main(argv = process.argv.slice(2), {environment = process.env,stdout = process.stdout,stderr = process.stderr,signal} = {}) {
  if (!argv.length || argv.length === 1 && ['--help','-h'].includes(argv[0])) {stdout.write(HELP); return null;}
  process.umask(0o077);
  const {command,values:v} = parse(argv); let client,result;
  const options = {signal};
  try {
    if (command === 'verify') result = await verifyFiscalDownload({directory:required(v,'directory'),expectedSelectionSha256:v['selection-sha256']});
    else if (command === 'receive') result = await receiveFiscalDownload({directory:required(v,'directory'),
      destination:required(v,'destination'),operationId:required(v,'operation-id'),
      actor:{id:required(v,'operator-id'),label:required(v,'operator-label')},
      expectedWorkspaceId:required(v,'workspace-id'),expectedSelectionSha256:v['selection-sha256']});
    else if (command === 'reopen') result = await inspectReceivedFiscalWorkspace({directory:required(v,'directory'),expectedWorkspaceId:required(v,'workspace-id')});
    else {
      client = await connectFiscalWorkspace({url:required(v,'url'),workspace:required(v,'workspace'),
        expectedWorkspaceId:v['workspace-id'],tokenEnv:v['token-env'],environment,signal,timeoutMs:number(v,'timeout-ms',120000)});
      switch (command) {
        case 'status':result = await client.status({section:v.section ?? 'overview',offset:number(v,'offset',0),limit:number(v,'limit',50)},options);break;
        case 'open':result = await client.open(options);break;
        case 'list':result = await client.list(required(v,'section'),{limit:number(v,'limit',100),maximumItems:number(v,'maximum-items',100000)},options);break;
        case 'catalog':result = await client.catalog(v.action ?? 'get',{offset:number(v,'offset',0),limit:number(v,'limit',50)},options);break;
        case 'history':result = await client.history({offset:number(v,'offset',0),limit:number(v,'limit',50)},options);break;
        case 'action':result = await client.action(required(v,'action'),await input(required(v,'input')),options);break;
        case 'query':result = await client.query(required(v,'id'),v.query ?? 'limit=50',options);break;
        case 'checkpoint':result = await client.checkpoint(required(v,'operation-id'),options);break;
        case 'restore':result = await client.restore(await input(required(v,'input')),options);break;
        case 'browser':result = await client.browser(required(v,'action'),{port:number(v,'port',undefined)},options);break;
        case 'close-workspace':result = await client.closeWorkspace(required(v,'instance-id'),options);break;
        case 'select':{
          result = await selectFiscalDownload({client,kind:required(v,'kind'),id:required(v,'id'),expectedSha256:v['source-sha256'],signal});
          if (v.out) result = {...result,file:await writeFiscalSelection(resolve(v.out),result.selection)};
          break;
        }
        case 'download':{
          const selected = await readFiscalSelection(resolve(required(v,'selection')));
          result = await downloadFiscalSelection({client,selection:selected.selection,directory:required(v,'out'),
            expectedSelectionSha256:v['selection-sha256'] ?? selected.selectionSha256,signal,
            chunkSize:number(v,'chunk-size',196608),onProgress:value => stderr.write(JSON.stringify({progress:value}) + '\n')});
          break;
        }
      }
    }
    stdout.write(JSON.stringify(result,null,2) + '\n'); return result;
  } finally {if (client) await client.dispose();}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort(Object.assign(new Error('Original Fiscal client interrupted.'),{code:'FISCALDATA_CLIENT_INTERRUPTED'}));
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  main(process.argv.slice(2),{signal:controller.signal}).catch(error => {
    process.stderr.write(JSON.stringify({error:error.code ?? 'FISCALDATA_CLIENT_FAILED',message:error.message}) + '\n');
    process.exitCode = 1;
  }).finally(() => {process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);});
}
