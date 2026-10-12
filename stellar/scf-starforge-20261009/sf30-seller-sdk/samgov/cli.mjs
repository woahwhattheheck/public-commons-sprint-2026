#!/usr/bin/env node
import {readFile, stat, mkdir, open, rename, link, unlink} from 'node:fs/promises';
import {resolve, dirname, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openSamWorkspace} from './workspace.mjs';
import {startSamWorkspace} from './server.mjs';
import {exportSamWorkspace} from './reports.mjs';
import {serveSamMerchant} from './merchant.mjs';

const MAX_JSON = 512 * 1024 * 1024;
const HELP = `SAM.gov opportunity intake

Run: starforge samgov <command> --workspace DIRECTORY --operator NAME [options]
Or:  node cli.mjs <command> --workspace DIRECTORY --operator NAME [options]

Operator
  serve                  Open the private browser workspace
  status                 Print current counts, captures and source capabilities
  list                   Print the complete retained workspace view
  show --id ID           Read a retained query, capture, edition, selection or preparation
  source --source-id ID  Read metadata/bytes; use --out FILE for the original bytes
  compare --before ID --after ID
                         Compare two retained source editions

Source acquisition
  query --input FILE     Save a query definition (name, filters, pageSize, maxRecords)
  capture --query-id ID --query-revision N
                         Start the saved query and run its original capture
  run --capture-id ID    Resume the same retained capture
  resources --input FILE Capture the selected notices' issued description/attachment URLs
  retain --input FILE    Receive original bytes at an issued selected resource URL
  notice --notice-file FILE
                         Receive an original SAM notice JSON with optional index/history files

Work and receiving
  action --name ACTION --input FILE
                         Dispatch a complete supported source/review/selection action
  merchant --input FILE  Prepare the original selected-notice merchant integration
  merchant-serve --publication-id ID
                         Run that prepared original seller on private loopback
  buyer-review --input FILE
                         Read the actual running seller offer
  buyer-prepare --input FILE
                         Prepare the original buyer intent against its saved offer
  opportunity --input FILE
                         Join sources to the launch-selected opportunity workspace
  export --out FILE      Export complete portable JSON or a readable review/CSV
  receive --input FILE  Receive the complete original portable workspace packet

Shared options
  --request-id ID        Stable 1–200 character identity for a mutation
  --expected-revision N Original workspace revision reviewed for that mutation
  --input FILE          JSON input; use - for standard input
  --api-key-env NAME    Existing SAM key variable (default SAM_GOV_API_KEY)
  --endpoint URL        Existing approved GSA search endpoint
  --opportunity-workspace DIRECTORY
                         Existing opportunity workspace for the source bridge
  --port N              Browser or seller loopback port; default 0 selects a free port
  --publication-id ID    Exact retained merchant preparation to serve
  --notice-file FILE --resource-index-file FILE --history-file FILE
                         Original SAM notice, attachment metadata and published history
  --base-edition-id ID   Extend that retained notice collection
  --captured-at ISO      Original file capture time; omitted means received here
  --offset N --limit N --search TEXT
                         Retained-record paging; defaults 0 / 50
  --selection-id ID      Export the selected retained notices
  --handoff-id ID        Export the exact named handoff
  --revision N          Export an exact historical workspace revision
  --format FORMAT       portable | html | markdown | notices | reviews | changes | sources
  --out FILE --force     Save exact bytes; --force permits replacing that output
  --help                Show this guide

Mutations require requestId and expectedRevision in the input object or the two
named options. Reuse the same complete prepared input after an uncertain return.
A capture resumes its own saved page index; rerunning capture with its original
request ID recovers that same capture. Ctrl+C pauses the owned acquisition and
closes its original writer before exit. Source credentials stay in the runtime.
`;

function fail(code, message, status = 400) {
  throw Object.assign(new Error(message), {code, status});
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function parse(argv) {
  const options = {}, words = [];
  const booleans = new Set(['help','force']);
  for (let i=0;i<argv.length;i++) {
    const argument=argv[i];
    if (!argument.startsWith('--')) {words.push(argument);continue;}
    const equals=argument.indexOf('='),key=argument.slice(2,equals<0?undefined:equals);
    if(!key||Object.hasOwn(options,key))fail('CLI_ARGUMENT_INVALID','Use each named option once.');
    if(booleans.has(key)) {
      if(equals>=0)fail('CLI_ARGUMENT_INVALID','--'+key+' does not take a value.');
      options[key]=true;continue;
    }
    const value=equals<0?argv[++i]:argument.slice(equals+1);
    if(value===undefined||value.startsWith('--'))fail('CLI_ARGUMENT_MISSING','Provide a value for --'+key+'.');
    options[key]=value;
  }
  const allowed=new Set(['help','force','workspace','operator','input','request-id','expected-revision','api-key-env',
    'endpoint','opportunity-workspace','port','offset','limit','search','selection-id','handoff-id','revision',
    'format','out','id','source-id','before','after','name','query-id','query-revision','capture-id','publication-id',
    'notice-file','resource-index-file','history-file','base-edition-id','captured-at']);
  for(const key of Object.keys(options))if(!allowed.has(key))fail('CLI_OPTION_UNKNOWN','Unknown option --'+key+'.');
  if(words.length>1)fail('CLI_ARGUMENT_INVALID','Use named options after the command.');
  return{command:words[0]||'help',options};
}
function integer(value,name,{optional=false,minimum=0,maximum=100000000}={}) {
  if((value===undefined||value==='')&&optional)return undefined;
  if(!/^\d+$/.test(String(value)))fail('CLI_INTEGER_REQUIRED',name+' must be a whole number.');
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<minimum||number>maximum)fail('CLI_INTEGER_INVALID',name+' is outside the supported range.');
  return number;
}
function required(value,name) {
  if(typeof value!=='string'||!value.trim())fail('CLI_VALUE_REQUIRED','Provide '+name+'.');
  return value;
}
async function stdinJson(stream) {
  const chunks=[];let length=0;
  for await(const chunk of stream){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=bytes.length;if(length>MAX_JSON)fail('INPUT_TOO_LARGE','JSON input exceeds 512 MiB.');chunks.push(bytes);}
  return Buffer.concat(chunks);
}
async function inputJson(path,stream) {
  required(path,'--input FILE or --input -');
  const bytes=path==='-'?await stdinJson(stream):await(async()=>{
    const file=resolve(path),information=await stat(file);
    if(!information.isFile())fail('INPUT_FILE_REQUIRED','The JSON input must be a regular file.');
    if(information.size>MAX_JSON)fail('INPUT_TOO_LARGE','JSON input exceeds512 MiB.');
    return readFile(file);
  })();
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{fail('INPUT_JSON_INVALID','The input contains invalid JSON.');}
  if(!object(value))fail('INPUT_OBJECT_REQUIRED','The input must be a JSON object.');
  return value;
}
async function writeOutput(path,bytes,{force=false}={}) {
  const target=resolve(required(path,'--out FILE')),parent=dirname(target);
  await mkdir(parent,{recursive:true,mode:0o700});
  const temporary=join(parent,'.sam-export-'+randomUUID()+'.tmp');
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{if(force)await rename(temporary,target);else{await link(temporary,target);await unlink(temporary);}}
  catch(error){await unlink(temporary).catch(()=>{});if(error.code==='EEXIST')fail('OUTPUT_EXISTS','The output exists. Choose another filename or use --force.',409);throw error;}
  const folder=await open(parent,'r');try{await folder.sync();}finally{await folder.close();}
  return{path:target,bytes:Buffer.byteLength(bytes)};
}
function preparedPayload(payload,options) {
  if(!object(payload))fail('ACTION_PAYLOAD_INVALID','The action payload must be an object.');
  const result={...payload};
  if(options['request-id']!==undefined){
    if(payload.requestId!==undefined&&payload.requestId!==options['request-id'])fail('REQUEST_ID_CONFLICT','The input and option request IDs differ.');
    result.requestId=options['request-id'];
  }
  if(options['expected-revision']!==undefined) {
    const expected=integer(options['expected-revision'],'--expected-revision');
    if(payload.expectedRevision!==undefined&&payload.expectedRevision!==expected)fail('REVISION_ARGUMENT_CONFLICT','The input and option expected revisions differ.');
    result.expectedRevision=expected;
  }
  if(typeof result.requestId!=='string'||!result.requestId.length||result.requestId.length>200)
    fail('REQUEST_ID_REQUIRED','A mutation needs its stable requestId or --request-id.');
  if(!Number.isSafeInteger(result.expectedRevision)||result.expectedRevision<0)
    fail('EXPECTED_REVISION_REQUIRED','A mutation needs its original expectedRevision or --expected-revision.');
  return result;
}
function statusView(workspace) {
  return{id:workspace.id,revision:workspace.revision,capabilities:workspace.capabilities,
    counts:Object.fromEntries(['queries','captures','editions','selections','reviews','changes','handoffs','publications'].map(key=>[key,(workspace[key]||[]).length])),
    captures:(workspace.captures||[]).map(c=>({id:c.id,name:c.name,status:c.status,count:c.count,totalRecords:c.totalRecords,pageCount:c.pageCount,nextOffset:c.nextOffset,editionId:c.editionId,error:c.error})),
  };
}

/** Run the standalone CLI or the installed `starforge samgov` subcommand. */
export async function runSamCli(argv=process.argv.slice(2),{
  stdout=process.stdout,stderr=process.stderr,stdin=process.stdin,waitForClose=true,
}={}) {
  const {command,options}=parse(argv);
  const print=value=>stdout.write(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
  if(command==='help'||options.help){print(HELP);return{help:true};}
  const directory=resolve(required(options.workspace,'--workspace DIRECTORY'));
  const operator=options.operator||'SAM opportunity operator';
  const shared={directory,operator,apiKeyEnv:options['api-key-env']||'SAM_GOV_API_KEY',
    ...(options.endpoint?{endpoint:options.endpoint}:{}),
    ...(options['opportunity-workspace']?{opportunityDirectory:resolve(options['opportunity-workspace'])}:{})};
  if(command==='serve') {
    const server=await startSamWorkspace({...shared,port:integer(options.port??'0','--port',{maximum:65535})});
    print({directory:server.directory,operator,origin:server.origin,url:server.url,
      source:'SAM.gov',opportunityWorkspace:shared.opportunityDirectory||null});
    if(!waitForClose)return server;
    await new Promise((accept,reject)=>{
      let ending=false;
      const stop=async()=>{if(ending)return;ending=true;try{await server.close();accept();}catch(error){reject(error);}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
    });
    return{status:'closed'};
  }
  if(command==='merchant-serve') {
    const publicationId=required(options['publication-id'],'--publication-id ID');
    if(publicationId.length>240||/[/\\\u0000-\u001f]/.test(publicationId))
      fail('PUBLICATION_ID_INVALID','Provide the retained merchant publication ID.');
    const merchantStore=await openSamWorkspace({...shared,readOnly:true});
    let seller,closePromise;
    const close=()=>closePromise||(closePromise=(async()=>{try{if(seller)await seller.close();}finally{await merchantStore.close();}})());
    try {
      const found=await merchantStore.get(publicationId,{offset:0,limit:1});
      if(found.kind!=='publication'||found.record?.kind!=='merchant'||found.record.directory!=='merchant/'+publicationId)
        fail('MERCHANT_PUBLICATION_REQUIRED','Choose a retained merchant preparation.');
      seller=await serveSamMerchant(join(directory,'merchant',publicationId),{port:integer(options.port??'0','--port',{maximum:65535})});
      const address=seller.server.address();
      if(!address||typeof address==='string'||!['127.0.0.1','::1'].includes(address.address))
        fail('MERCHANT_ADDRESS_INVALID','The prepared seller did not bind a loopback address.');
      const origin='http://'+(address.address==='::1'?'[::1]':'127.0.0.1')+':'+address.port;
      print({publicationId,directory:join(directory,'merchant',publicationId),origin,snapshot:seller.snapshot,sourceEditionId:seller.sourceEditionId});
      const service={...seller,publicationId,origin,close};
      if(!waitForClose)return service;
      await new Promise((accept,reject)=>{
        let ending=false;
        const stop=async()=>{if(ending)return;ending=true;try{await close();accept();}catch(error){reject(error);}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}};
        process.once('SIGINT',stop);process.once('SIGTERM',stop);
      });
      return{publicationId,status:'closed'};
    }catch(error){await close().catch(()=>{});throw error;}
  }
  const readOnly=['status','list','show','source','compare','export'].includes(command);
  const store=await openSamWorkspace({...shared,readOnly});
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  let result;
  try {
    if(command==='status')result=statusView(await store.list());
    else if(command==='list')result=await store.list();
    else if(command==='show')result=await store.get(required(options.id,'--id ID'),{
      offset:integer(options.offset??'0','--offset'),limit:integer(options.limit??'50','--limit',{minimum:1,maximum:1000}),search:options.search||'',
    });
    else if(command==='source') {
      const source=await store.readSource(required(options['source-id'],'--source-id ID'));
      if(options.out){result={...source,contentBase64:undefined,contentText:undefined,...await writeOutput(options.out,Buffer.from(source.contentBase64,'base64'),{force:options.force})};}
      else result=source;
    }
    else if(command==='compare')result=await store.dispatch('compare',{beforeEditionId:required(options.before,'--before ID'),afterEditionId:required(options.after,'--after ID')});
    else if(command==='export') {
      const exported=await exportSamWorkspace(store,{
        format:options.format||'portable',
        ...(options.revision===undefined?{}:{revision:integer(options.revision,'--revision',{minimum:1})}),
        ...(options['selection-id']?{selectionId:options['selection-id']}:{}),
        ...(options['handoff-id']?{handoffId:options['handoff-id']}:{}),
      });
      if(options.out)result={...await writeOutput(options.out,exported.bytes,{force:options.force}),mediaType:exported.mediaType,revision:exported.revision,sha256:exported.sha256,packetSha256:exported.packetSha256};
      else{stdout.write(exported.bytes);return{format:options.format||'portable',revision:exported.revision,bytes:exported.bytes.length};}
    }
    else if(command==='receive')result=await store.importPacket(await inputJson(options.input,stdin));
    else if(command==='run')result=await store.runCapture(required(options['capture-id'],'--capture-id ID'),{
      signal:controller.signal,onProgress:progress=>stderr.write(JSON.stringify({captureId:options['capture-id'],progress})+'\n'),
    });
    else if(command==='notice' && options['notice-file']){
      if(options.input)fail('NOTICE_INPUT_CONFLICT','Choose original notice files or one complete JSON input.');
      const input={...(options.name?{name:options.name}:{}),
        ...(options['base-edition-id']?{editionId:options['base-edition-id']}:{})};
      for(const [field,key] of [['notice','notice-file'],['resources','resource-index-file'],['history','history-file']]){
        if(!options[key])continue;
        const file=resolve(options[key]),information=await stat(file);
        if(!information.isFile() || information.size>64*1024*1024)
          fail('NOTICE_FILE_INVALID','Each original notice document must be a regular file up to64 MiB.');
        const bytes=await readFile(file);
        input[field]={filename:basename(file),contentBase64:bytes.toString('base64'),
          ...(options['captured-at']?{capturedAt:options['captured-at']}:{})};
      }
      const payload=preparedPayload(input,options);
      stderr.write(JSON.stringify({action:'import_notice',requestId:payload.requestId,
        expectedRevision:payload.expectedRevision,stage:'prepared'})+'\n');
      result=await store.dispatch('import_notice',payload,{signal:controller.signal});
    }
    else if(command==='capture') {
      const payload=preparedPayload({
        queryId:required(options['query-id'],'--query-id ID'),
        queryRevision:integer(options['query-revision'],'--query-revision',{minimum:1}),
        ...(options.name?{name:options.name}:{}),
      },options);
      const started=await store.dispatch('start_capture',payload,{signal:controller.signal});
      const captureId=started.result?.captureId;
      if(!captureId)fail('CAPTURE_ID_MISSING','The original capture action did not return its retained ID.');
      stderr.write(JSON.stringify({captureId,requestId:payload.requestId,stage:'retained'})+'\n');
      result=await store.runCapture(captureId,{signal:controller.signal,onProgress:progress=>stderr.write(JSON.stringify({captureId,progress})+'\n')});
    }
    else {
      const aliases={query:'save_query',notice:'import_notice',resources:'capture_resources',retain:'retain_resource',merchant:'prepare_merchant',
        'buyer-review':'buyer_review','buyer-prepare':'prepare_buyer',opportunity:'prepare_opportunity'};
      const action=command==='action'?required(options.name,'--name ACTION'):aliases[command];
      if(!action)fail('COMMAND_UNKNOWN','Unknown SAM.gov command '+command+'. Use --help.');
      const input=await inputJson(options.input,stdin);
      const payload=preparedPayload(input,options);
      stderr.write(JSON.stringify({action,requestId:payload.requestId,expectedRevision:payload.expectedRevision,stage:'prepared'})+'\n');
      result=await store.dispatch(action,payload,{signal:controller.signal});
    }
    print(result);return result;
  } finally {
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    await store.close();
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runSamCli().catch(error=>{
    process.stderr.write(JSON.stringify({error:{code:error.code||'SAM_CLI_FAILED',
      message:String(error.message).replace(/([?&](?:api_key|apikey|access_token|token)=)[^&\s"'<>]+/gi,'$1[redacted]')}})+'\n');
    process.exitCode=1;
  });
}
