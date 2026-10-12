#!/usr/bin/env node
// MIT. Native supplier-order operation, complete source files and portable customer receiving.
import { constants, createReadStream } from 'node:fs';
import { readFile, lstat, open, unlink } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openSupplierOrderWorkspace } from './workspace.mjs';
import { serveSupplierOrderWorkspace } from './server.mjs';
import { parseOpenTransDocument, renderOpenTransDocument } from './opentrans.mjs';
import { reviewDocument, data, fail } from './core.mjs';

export const help=String.raw`Starforge supplier orders

  starforge supplier-orders serve --workspace DIR [--port 0]
  starforge supplier-orders state --workspace DIR
  starforge supplier-orders orders --workspace DIR [--query TEXT] [--status STATUS] [--offset 0] [--limit 50]
  starforge supplier-orders order --workspace DIR --order ORIGINAL_ORDER_ID
  starforge supplier-orders documents --workspace DIR [--order ORIGINAL_ORDER_ID] [--kind KIND]
  starforge supplier-orders document --workspace DIR --id DOCUMENT_RECORD_ID
  starforge supplier-orders drafts --workspace DIR [--order ORIGINAL_ORDER_ID]
  starforge supplier-orders draft --workspace DIR --id DRAFT_ID
  starforge supplier-orders operation --workspace DIR --request-id ORIGINAL_REQUEST_ID

  starforge supplier-orders import --workspace DIR --input ORIGINAL.xml --request-id ID [--request ORIGINAL_METADATA.json]
  starforge supplier-orders new-draft --workspace DIR --kind ORDERRESPONSE|DISPATCHNOTIFICATION|INVOICE --order ID [--order ID]
  starforge supplier-orders save-draft --workspace DIR --request COMPLETE_DRAFT_REQUEST.json
  starforge supplier-orders prepare --workspace DIR --request PREPARE_REQUEST.json
  starforge supplier-orders select --workspace DIR --request SELECTION_REQUEST.json
  starforge supplier-orders export-document --workspace DIR --id DOCUMENT_RECORD_ID --out ORIGINAL.xml
  starforge supplier-orders export --workspace DIR --request-id ID [--out COMPLETE.zip]
  starforge supplier-orders receive --workspace DIR --input COMPLETE.zip --request-id ID [--mode merge|inspect]

  starforge supplier-orders validate --input ORIGINAL.xml
  starforge supplier-orders render --input NORMALIZED_DOCUMENT.json --out COMPLETE.xml

Every source keeps its original complete XML and all saved revisions. Request JSON
retains requestId, the exact source order revisions and state hashes, and the operator
reason. Use new-draft to obtain that complete original draft before editing it.
Source import defaults to history; a first original ORDER initializes its current
order. Explicit current selection requires the original revision pins.
Package merge preserves current operator orders/drafts and retains incoming branch
history. Reusing an original request ID reopens its saved outcome.
XML intake: 64 MiB; complete workspace package: 8 GiB; JSON request: 256 MiB.
Node 24+ and Python 3 are required. The private browser binds to 127.0.0.1.
`;

function parse(argv){
  const [command='help',...rest]=argv,options={order:[]};
  const valid=new Set(['workspace','port','query','status','offset','limit','order','kind','id','request-id','request','input','out','mode','help']);
  for(let i=0;i<rest.length;i++){
    if(!rest[i].startsWith('--'))fail('ORDER_CLI_ARGUMENT_INVALID','Unexpected argument '+rest[i]);
    const key=rest[i].slice(2);if(!valid.has(key))fail('ORDER_CLI_OPTION_INVALID','Unknown option --'+key);
    if(key==='help'){options.help=true;continue;}
    const value=rest[++i];if(value===undefined||value.startsWith('--'))fail('ORDER_CLI_VALUE_REQUIRED','Give the complete value for --'+key);
    if(key==='order')options.order.push(value);else if(options[key]!==undefined)fail('ORDER_CLI_OPTION_REPEATED','Use --'+key+' once.');else options[key]=value;
  }
  return{command,options};
}
function required(options,key){const value=options[key];if(!value)fail('ORDER_CLI_VALUE_REQUIRED','Use --'+key+'.');return value;}
async function inputJson(path){
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024*1024)fail('ORDER_CLI_JSON_FILE_INVALID','Select a complete original JSON file of up to 256 MiB.');
  const value=JSON.parse(await readFile(path,'utf8'));data(value);return value;
}
async function inputXml(path){
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>64*1024*1024)fail('ORDER_CLI_XML_FILE_INVALID','Select a complete original XML file of up to 64 MiB.');return readFile(path);
}
async function writeOriginal(iterable,path,expected={}){
  const target=resolve(path),handle=await open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600),hash=createHash('sha256');let bytes=0,complete=false;
  try{
    for await(const chunk of iterable){bytes+=chunk.length;hash.update(chunk);await handle.writeFile(chunk);}
    const sha256=hash.digest('hex');
    if(expected.bytes!==undefined&&bytes!==expected.bytes||expected.sha256!==undefined&&sha256!==expected.sha256)fail('ORDER_CLI_OUTPUT_DIFFERS','The original complete output differs from its selected length or SHA-256.',409);
    await handle.sync();complete=true;return{path:target,bytes,sha256};
  }finally{await handle.close();if(!complete)await unlink(target).catch(()=>{});}
}
export async function runSupplierOrdersCli(argv=process.argv.slice(2),{stdout=process.stdout,stderr=process.stderr}={}){
  const {command,options}=parse(argv);
  const print=value=>stdout.write(JSON.stringify(value,null,2)+'\n');
  if(command==='help'||options.help){stdout.write(help);return{help:true};}
  if(command==='validate'){
    const input=required(options,'input'),document=await parseOpenTransDocument(await inputXml(input),{name:basename(input),provenance:{path:resolve(input)}});
    const review=reviewDocument(document);const result={document,review:{...review,findings:[...(document.findings??[]),...review.findings]}};
    print(result);return result;
  }
  if(command==='render'){
    const result=await renderOpenTransDocument(await inputJson(required(options,'input'))),errors=(result.findings??[]).filter(f=>f.severity==='error');
    if(errors.length)fail('ORDER_OUTPUT_REVIEW_REQUIRED','Correct the complete original document fields before emitting its XML.',422,{findings:errors});
    const file=await writeOriginal([result.bytes],required(options,'out')),summary={file,document:result.document,findings:result.findings??[]};print(summary);return summary;
  }
  const workspace=await openSupplierOrderWorkspace({directory:resolve(required(options,'workspace'))});
  let serving=false;
  try{
    if(command==='serve'){
      const server=await serveSupplierOrderWorkspace({workspace,port:Number(options.port??0)});serving=true;
      print({workspaceId:workspace.store.id,url:server.url,origin:server.origin,pid:process.pid});
      let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;try{await server.close();await workspace.close();}catch(error){stderr.write(JSON.stringify({error:{code:error.code,message:error.message}})+'\n');process.exitCode=1;}};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);return server;
    }
    const page={...(options.offset?{offset:Number(options.offset)}:{}),...(options.limit?{limit:Number(options.limit)}:{})};
    const order=options.order[0],request=options.request?await inputJson(options.request):null;
    let result;
    if(command==='state')result=workspace.state();
    else if(command==='orders')result=workspace.orders({...page,...(options.query?{query:options.query}:{}),...(options.status?{status:options.status}:{})});
    else if(command==='order')result=workspace.order({orderId:order??required(options,'order')});
    else if(command==='documents')result=workspace.documents({...page,...(order?{orderId:order}:{}),...(options.kind?{kind:options.kind}:{})});
    else if(command==='document')result=workspace.document({id:required(options,'id')});
    else if(command==='drafts')result=workspace.drafts({...page,...(order?{orderId:order}:{})});
    else if(command==='draft')result=workspace.draft({draftId:required(options,'id')});
    else if(command==='operation')result=workspace.operation({requestId:required(options,'request-id')});
    else if(command==='import')result=await workspace.importDocument({...request,requestId:options['request-id']??request?.requestId??required(options,'request-id'),sourcePath:resolve(required(options,'input')),name:request?.name??basename(options.input)});
    else if(command==='new-draft')result=workspace.newDraft({...request,kind:options.kind??request?.kind??required(options,'kind'),orderIds:options.order.length?options.order:request?.orderIds,...(options.id?{documentId:options.id}:{})});
    else if(command==='save-draft'){if(!request)required(options,'request');result=workspace.saveDraft(request);}
    else if(command==='prepare'){if(!request)required(options,'request');result=await workspace.prepareDocument(request);}
    else if(command==='select'){if(!request)required(options,'request');result=workspace.selectDocument(request);}
    else if(command==='export-document'){const selected=await workspace.exportFile({id:required(options,'id')});result={file:await writeOriginal(createReadStream(selected.path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}),required(options,'out'),selected),documentId:options.id};}
    else if(command==='export')result=await workspace.exportWorkspace({requestId:required(options,'request-id'),...(options.out?{path:resolve(options.out)}:{})});
    else if(command==='receive')result=await workspace.importWorkspace({requestId:required(options,'request-id'),path:resolve(required(options,'input')),mode:options.mode??'merge',...(request?.expectedBytes!==undefined?{expectedBytes:request.expectedBytes}:{}),...(request?.expectedSha256?{expectedSha256:request.expectedSha256}:{})});
    else fail('ORDER_CLI_COMMAND_INVALID','Unknown supplier-order command '+command+'. Use --help.');
    print(result);if(result?.state==='FAILED'||result?.state==='INTERRUPTED')process.exitCode=1;return result;
  }finally{if(!serving)await workspace.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runSupplierOrdersCli().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'ORDER_CLI_FAILED',message:error.message,...(error.details?{details:error.details}:{})}})+'\n');process.exitCode=1;});
}
