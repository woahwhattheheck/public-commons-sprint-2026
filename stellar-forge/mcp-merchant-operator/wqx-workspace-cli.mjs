#!/usr/bin/env node
// MIT. Full original WQX MCP operations, private resumable uploads and downloads.
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateSupportDirectory, plain, failure } from './host-files.mjs';
import { openWqxWorkspaceClient, reopenWqxDownload, validateWqxFile } from './wqx-workspace-client.mjs';

export const WQX_WORKSPACE_HELP = "Starforge WQX merchant MCP client\n\nConnection for every network command:\n  --url HTTPS_MCP_OR_ORIGINAL_LOOPBACK_MCP [--token-env MCP_ACCESS_TOKEN]\n  [--workspace water] [--timeout-ms 120000]\n  URL may also come from WQX_MCP_URL. The bearer token stays in its existing\n  environment variable. This client reuses the original MCP file transport.\n\nRead the saved original workspace:\n  status\n  inventory --kind KIND [--offset 0 --limit 50 --snapshot SHA256]\n  record --family capture|review|plan|decision|edition --id ID\n         [--pointer JSON_POINTER --offset 0 --limit 50 --document-sha SHA256]\n  targets --plan-id ID [--kind settings|location|activity|result|translation|limit|reference]\n          [--field FIELD]\n          [--search TEXT --status STATUS --attention-only true|false]\n          [--offset 0 --limit 50 --plan-sha SHA256]\n\nCreate a complete original file descriptor, then download or resume:\n  file --family capture|review|plan|decision|customer --id ID\n       [--format FORMAT --index N --intent-id ID] --save-json DESCRIPTOR.json\n  download --descriptor DESCRIPTOR.json --directory PRIVATE_DOWNLOAD_DIRECTORY\n           [--name LOCAL_BASENAME --chunk-size 65536 --progress true]\n  reopen --directory PRIVATE_DOWNLOAD_DIRECTORY [--sha256 SHA256]\n  file and table-export return the complete original descriptor. Other native\n  operations may return {result,file}; download accepts either shape. Repeating\n  download with the SAME descriptor and directory resumes its verified prefix.\n  reopen works locally without a connection. The directory retains its original\n  file, wqx-file.json and download-state/checkpoint.json.\n\nUpload a named input from this machine, preserving the same inputId on resume:\n  upload --input-id lowercase_stable_id --file LOCAL_FILE\n         [--name BASENAME --content-type MIME --sha256 SHA256]\n         [--chunk-size 65536 --max-bytes N --progress true]\n  input-status --input-id lowercase_stable_id\n  The server's receivedBytes is authoritative. Repeating the same inputId, exact\n  source, name, content type and hash resumes the original transfer. A completed\n  input returns inputRef \"input:ID\"; no local path is sent in the MCP request.\n\nConcentrations and complete reported limits:\n  concentration-units --plan-id ID [--plan-sha SHA256]\n  concentration-prepare --document-ref input:ID --from-unit mg/L\n                        --target-unit ug/L --reason \"The receiving unit.\"\n  concentration-prepare --document-ref file:FILE_ID --reported-limits-only true\n                        --target-unit ug/L --reason \"The receiving limit unit.\"\n  concentration-report --review-id ID --format json|csv\n  --args-file can select explicit resultIds instead of one source group.\n  Exactly one fromUnit/resultIds/reportedLimitsOnly selection is required.\n  A PREPARED response includes documentRef, the complete proposal file and\n  reportCsvFile. Reuse documentRef for full table export, preview and save.\n  REVIEW_REQUIRED keeps the complete report and exposes no partial document.\n\nComplete decisions and receiving:\n  table-export --document-file DOCUMENT.json --format csv|tsv\n               [--save-json DESCRIPTOR.json]\n  table-export --document-ref input:ID --format csv|tsv\n  table-import --input-ref input:ID --format csv|tsv [--save-json RESULT.json]\n  decisions-preview --new-plan-id ID --document-ref input:ID\n                    [--save-json PREVIEW.json]\n  decisions-save --review-id ID --new-plan-id ID --preview-sha SHA256\n                 --document-ref input:ID [--save-json SAVED.json]\n  receive --kind review|plan|decision --input-ref input:ID\n  files [--offset 0 --limit 50 --snapshot SHA256]\n  inputs\n  result --capture-id ID --id wqx-record-SHA256 --source-sha SHA256\n         --source-index N --capture-sha SHA256\n  capture-import --source HOST_CAPTURE_ALIAS --expected-revision N [--title TITLE]\n  capture-cancel --capture-id ID\n  --document-file may replace --document-ref for a complete inline document.\n  file:FILE_ID consumes an original retained export in the same operator;\n  host:ALIAS selects an input configured by that operator's owner.\n\nComplete native project, source and commerce operations:\n  project-save | capture-start | analyze | review-save | plan-preview | plan-save\n  edition-prepare | merchant-stage | merchant-start | merchant-stop\n  customer-prepare | customer-execute | customer-reopen\n    --request-file ORIGINAL_REQUEST.json OR --input-ref input:ID\n  Use each original operation's exact request keys from WQX_WORKSPACE.md and the\n  published catalog. Capture jobs preserve their RUNNING/completion state;\n  customer execution uses the original configured buyer and saved intent.\n\nOriginal operations and complete argument objects:\n  call --tool merchant_wqx_TOOL --args-file ORIGINAL_ARGS.json\n  Every native command accepts --args-file; explicit flags must agree with it.\n  The selected workspace alias is bound for the whole client. Native source,\n  preview and immutable identifiers remain in the original request.\n\nOutput is JSON on stdout; --save-json reserves the exact new mode-0600 file\nbefore dispatch and keeps its original handle through result publication. An\nexisting or concurrently reserved path is rejected before any native call. An\ninterrupted command retains its result, error or empty reservation for review;\nchoose a new record after reconciling that operation. Progress/errors go to stderr.\nKeep the same inputId/download directory after a lost response. Preview/save\noperations use the original expected hashes; inspect their saved state before\nchoosing a continuation. Linux downloads use the existing util-linux flock lease.\n\nThe existing client-config.mjs registers the original operator in a subprocess\nMCP host. The typed WqxWorkspaceClient also accepts that host's existing native\ncall()/endpoint adapter; this CLI uses the already running HTTP MCP endpoint.\n";
const fail = message => { throw failure('WQX_CLI_USAGE',message); };
const allowed = new Set(['url','token-env','workspace','timeout-ms','args-file','tool','save-json','file','descriptor','directory',
  'name','content-type','input-id','input-ref','document-file','document-ref','sha256','max-bytes','chunk-size','progress',
  'kind','family','id','format','index','intent-id','offset','limit','snapshot','pointer','document-sha','plan-id','field','search',
  'status','attention-only','plan-sha','new-plan-id','review-id','preview-sha','help','request-file','source','capture-id','capture-sha','source-sha','source-index','expected-revision','title','from-unit','target-unit','reason','reported-limits-only']);
const methods = Object.freeze({status:'status',inventory:'inventory',record:'record',targets:'targets',file:'file',
  'concentration-units':'concentrationUnits','concentration-prepare':'concentrationPrepare','concentration-report':'concentrationReport',
  'input-status':'inputStatus','table-export':'tableExport','table-import':'tableImport',
  'decisions-preview':'decisionsPreview','decisions-save':'decisionsSave',receive:'receive',
  result:'result',files:'files',inputs:'inputFiles','capture-import':'captureImport','capture-cancel':'captureCancel',
  'project-save':'projectSave','capture-start':'captureStart','analyze':'analyze','review-save':'reviewSave','plan-preview':'planPreview','plan-save':'planSave','edition-prepare':'editionPrepare','merchant-stage':'merchantStage','merchant-start':'merchantStart','merchant-stop':'merchantStop','customer-prepare':'customerPrepare','customer-execute':'customerExecute','customer-reopen':'customerReopen'});
function parse(argv) {
  const command = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'help', flags = {};
  while(argv.length) {
    const key = argv.shift();
    if(!key.startsWith('--') || !allowed.has(key.slice(2)) || Object.hasOwn(flags,key.slice(2)))
      fail('Unknown or repeated option. Read --help.');
    const name = key.slice(2);
    if(name === 'help') flags.help = true;
    else {
      if(!argv.length || argv[0].startsWith('--')) fail('Supply a value for --' + name + '.');
      flags[name] = argv.shift();
    }
  }
  return {command,flags};
}
const required = (flags,name) => flags[name] ?? fail('Supply --' + name + '.');
function number(value,name) {
  if(typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    fail('Supply a nonnegative integer for --' + name + '.');
  return Number(value);
}
function boolean(value,name) {
  if(!['true','false'].includes(value)) fail('Choose true or false for --' + name + '.');
  return value === 'true';
}
async function readJSON(path, maximum = 2 * 1024 * 1024) {
  const handle = await open(resolve(path),constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({bigint:true});
    if(!before.isFile() || before.size > BigInt(maximum)) fail('Select a regular complete JSON file within the command limit.');
    const bytes = await handle.readFile(), after = await handle.stat({bigint:true});
    if(bytes.length !== Number(before.size) || ['dev','ino','size','mtimeNs','ctimeNs'].some(key => before[key] !== after[key]))
      fail('The selected JSON file changed during its original read.');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { fail('The selected file must contain complete UTF-8 JSON.'); }
    if(!plain(value)) fail('Use a complete JSON object in the selected file.');
    return value;
  } finally { await handle.close(); }
}
function equalJSON(left,right) {
  if(left === right) return true;
  if(Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value,i)=>equalJSON(value,right[i]));
  if(plain(left) && plain(right)) return Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(key=>Object.hasOwn(right,key) && equalJSON(left[key],right[key]));
  return false;
}
function assign(args,key,value) {
  if(value === undefined) return;
  if(Object.hasOwn(args,key) && !equalJSON(args[key],value)) fail('The explicit ' + key + ' differs from --args-file.');
  args[key] = value;
}
async function nativeArgs(flags) {
  const args = flags['args-file'] ? await readJSON(flags['args-file']) : {};
  const strings = {kind:'kind',family:'family',id:'id',format:'format','intent-id':'intentId',
    'input-id':'inputId','input-ref':'inputRef','document-ref':'documentRef',snapshot:'expectedSnapshot',pointer:'pointer',
    'document-sha':'expectedDocumentSha256','plan-id':'planId',field:'field',search:'search',status:'status',
    'plan-sha':'expectedPlanSha256','new-plan-id':'newPlanId','review-id':'reviewId','preview-sha':'expectedPreviewSha256',
    source:'source','capture-id':'captureId','capture-sha':'captureSha256','source-sha':'sourceSha256',title:'title','from-unit':'fromUnit','target-unit':'targetUnit',reason:'reason'};
  for(const [flag,key] of Object.entries(strings)) if(flags[flag] !== undefined) assign(args,key,flags[flag]);
  for(const flag of ['index','offset','limit']) if(flags[flag] !== undefined) assign(args,flag,number(flags[flag],flag));
  for(const [flag,key] of [['source-index','sourceIndex'],['expected-revision','expectedRevision']]) if(flags[flag] !== undefined) assign(args,key,number(flags[flag],flag));
  if(flags['request-file']) assign(args,'request',await readJSON(flags['request-file']));
  if(args.request !== undefined && args.inputRef !== undefined) fail('Choose one original request or its complete inputRef.');
  if(flags['attention-only'] !== undefined) assign(args,'attentionOnly',boolean(flags['attention-only'],'attention-only'));
  if(flags['reported-limits-only'] !== undefined) assign(args,'reportedLimitsOnly',boolean(flags['reported-limits-only'],'reported-limits-only'));
  if(flags['document-file']) assign(args,'document',await readJSON(flags['document-file']));
  if(args.document !== undefined && args.documentRef !== undefined) fail('Choose one complete document or its original documentRef.');
  return args;
}
async function reserveOutput(path) {
  path = resolve(path); await privateSupportDirectory(dirname(path));
  let handle;
  try {
    handle = await open(path,constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),0o600);
  } catch(error) {
    if(error.code === 'EEXIST') fail('Choose a new --save-json file before the original native dispatch.');
    throw error;
  }
  const assertOriginal = async () => {
    const held = await handle.stat({bigint:true}), named = await lstat(path,{bigint:true});
    if(!held.isFile() || !named.isFile() || named.isSymbolicLink() || held.dev !== named.dev ||
      held.ino !== named.ino || held.nlink !== 1n || named.nlink !== 1n || (held.mode & 0o077n) ||
      (typeof process.getuid === 'function' && held.uid !== BigInt(process.getuid())))
      throw failure('WQX_OUTPUT_CHANGED','The original private output reservation changed.');
  };
  try { await assertOriginal(); await handle.sync(); }
  catch(error) { await handle.close(); throw error; }
  return {
    path,
    async save(value) {
      await assertOriginal();
      if((await handle.stat({bigint:true})).size !== 0n)
        throw failure('WQX_OUTPUT_CHANGED','The original output reservation already contains bytes.');
      await handle.writeFile(JSON.stringify(value,null,2)+'\n'); await handle.sync();
      await assertOriginal();
    },
    async close() { await handle.close(); },
  };
}
const safeDetails = error => Object.fromEntries(['status','ambiguous','inputId','fileId','sha256','bytes','receivedBytes','directory','nativeResponseReceived','outputFile']
  .filter(key=>error[key] !== undefined).map(key=>[key,error[key]]));

export async function runWqxWorkspaceCLI(argv = process.argv.slice(2), {stdout = value=>process.stdout.write(value),
  stderr = value=>process.stderr.write(value),environment = process.env,client:providedClient} = {}) {
  const lifetime = new AbortController();
  const stop = () => lifetime.abort(failure('WQX_CLIENT_INTERRUPTED','The same original transfer can be resumed.'));
  process.once('SIGINT',stop); process.once('SIGTERM',stop);
  let client, output, responseReceived = false, responseWriteAttempted = false;
  try {
    const {command,flags} = parse([...argv]);
    if(command === 'help' || flags.help) { stdout(WQX_WORKSPACE_HELP); return 0; }
    if(flags['save-json']) {
      if(command === 'download' && flags.directory && (resolve(flags['save-json']) === resolve(flags.directory) || resolve(flags['save-json']).startsWith(resolve(flags.directory) + '/')))
        fail('Save the command JSON outside its dedicated download directory.');
      output = await reserveOutput(flags['save-json']);
    }
    const options = {signal:lifetime.signal,...(flags['timeout-ms']?{timeoutMs:number(flags['timeout-ms'],'timeout-ms')}:{})};
    if(flags['chunk-size']) options.chunkSize = number(flags['chunk-size'],'chunk-size');
    if(flags.progress && boolean(flags.progress,'progress')) options.onProgress = value => stderr(JSON.stringify({progress:value})+'\n');
    let result;
    if(command === 'reopen') {
      if(flags.url || flags['args-file'] || flags.workspace) fail('Offline reopen selects only its original directory and optional expected hash.');
      result = await reopenWqxDownload({directory:required(flags,'directory'),expectedSha256:flags.sha256});
    } else {
      if(!Object.hasOwn(methods,command) && !['upload','download','call'].includes(command)) fail('Unknown WQX command. Read --help.');
      const url = flags.url ?? environment.WQX_MCP_URL;
      if(providedClient && flags.url) fail('Choose the injected original client or --url.');
      client = await openWqxWorkspaceClient({...(providedClient?{client:providedClient}:{url:url ?? fail('Supply --url or WQX_MCP_URL.')}),
        workspace:flags.workspace,tokenEnv:flags['token-env'],environment,signal:lifetime.signal});
      if(command === 'upload') {
        if(flags['args-file']) fail('Upload uses the selected local file and explicit stable inputId; local paths remain outside MCP arguments.');
        result = await client.uploadFile({path:required(flags,'file'),inputId:required(flags,'input-id'),name:flags.name,
          contentType:flags['content-type'] ?? 'application/octet-stream',expectedSha256:flags.sha256,
          ...(flags['max-bytes']?{maximumBytes:number(flags['max-bytes'],'max-bytes')}:{})},options);
      } else if(command === 'download') {
        if(flags['args-file']) fail('Download selects its original descriptor and private directory.');
        const original = await readJSON(required(flags,'descriptor'));
        const file = validateWqxFile(original.file ?? original);
        if(flags.sha256 !== undefined && flags.sha256 !== file.sha256) fail('The expected hash differs from the retained original descriptor.');
        result = await client.downloadFile({file,directory:required(flags,'directory'),name:flags.name},options);
      } else {
        const args = await nativeArgs(flags);
        result = command === 'call' ? await client.call(required(flags,'tool'),args,options) : await client[methods[command]](args,options);
      }
    }
    responseReceived = command !== 'reopen';
    let publicationError;
    if(output) {
      responseWriteAttempted = true;
      try { await output.save(result); }
      catch(error) { error.nativeResponseReceived = responseReceived; error.outputFile = output.path; publicationError = error; }
    }
    stdout(JSON.stringify(result)+'\n');
    if(publicationError) throw publicationError;
    return result?.error || result?.status === 'FAILED' ? 2 : 0;
  } catch(error) {
    const record = {error:{code:error.code ?? 'WQX_CLIENT_ERROR',message:error.message,...safeDetails(error)}};
    if(output && !responseWriteAttempted) {
      // Retain the error in this same exclusive reservation. A lost process leaves
      // its reserved filename in place, preventing an accidental second dispatch.
      responseWriteAttempted = true;
      try { await output.save(record); }
      catch(saveError) { record.error.outputFile = output.path; record.error.outputError = saveError.code ?? 'WQX_OUTPUT_WRITE_FAILED'; }
    }
    stderr(JSON.stringify(record)+'\n');
    return 2;
  } finally {
    process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);
    client?.close();
    if(output) await output.close().catch(()=>{});
  }
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await runWqxWorkspaceCLI();
