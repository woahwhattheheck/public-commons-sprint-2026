#!/usr/bin/env node
// MIT. Source-owned CanadaBuys operation from the same model as browser and MCP.
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CanadaBuysWorkspace, failure, sha256 } from './workspace.mjs';
import { captureCanadaBuys, OFFICIAL_FEEDS } from './capture.mjs';
import { startCanadaBuysServer } from './server.mjs';
import { responseStatus, getResponseReview, prepareResponseReview, exportResponseReview, compareResponseReturn, applyResponseReturn, responseMarkdown } from './response-review/workspace.mjs';
import { responseEditorHTML } from './response-review/routes.mjs';
import { decodeCsv } from './csv.mjs';

const HELP = [
  'CanadaBuys procurement workspace',
  '',
  'canadabuys <command> --workspace DIRECTORY [options]',
  '',
  'init | status                       Open the saved native workspace',
  'serve                               Open the operator browser',
  'feeds                               List official complete source endpoints',
  'import --file CSV --stream STREAM   Retain the entire original UTF-8 source',
  'capture --stream STREAM             Fetch and save an official source',
  'resume --capture-id ID              Continue the same saved capture',
  'capture-record --capture-id ID      Read the saved source result',
  'notice --notice-id ID               Read original history, review and links',
  'entry --entry-id ID                 Read one complete original source row',
  'source --source-id ID               Read original source and its observations',
  'review --notice-id ID --file JSON   Save a source-linked review/qualification',
  'workshare-create --file JSON        Save scope, delivery, partner and economics',
  'workshare-update --workshare-id ID --file JSON   Save the next original edition',
  'workshare --workshare-id ID          Read current scope and complete history',
  'qualify --file JSON                 Match actual fields to an explicit profile',
  'compare --before ID --after ID      Compare every original field',
  'export --format json|csv|html        Export selected original records and work',
  'package                             Export a complete receiving package',
  'receive --file JSON                 Receive source, reviews and workshares',
  'receiving --package-id ID           Read the exact saved receiving result',
  'bidder-status                      Read saved bidder desk record counts',
  'bidder-list --kind KIND             List profiles, evidence, requirements or decisions',
  'bidder-record --kind KIND --record-id ID [--revision N] [--history]',
  'bidder-create --kind KIND --file JSON   Save a complete record against workspace revision',
  'bidder-update --kind KIND --record-id ID --file JSON   Save the next record edition',
  'bidder-fit --profile-id ID --profile-revision N   Explain current notice fit',
  'bidder-assess --file JSON           Review exact notice/profile/evidence context',
  'bidder-compare --record-id ID       Compare a saved decision to current context',
  'bidder-report --record-id ID --format html|json|csv [--revision N]',
  'bidder-evidence --record-id ID --out FILE [--revision N]   Recover original document bytes',
  'response-review-status             List original response records and workshares',
  'response-review-prepare --file JSON   Save complete source-bound master and workshare',
  'response-review-record --record-id ID [--revision N]   Read the complete saved edition',
  'response-review-export --record-id ID [--revision N]   Export complete working JSON',
  'response-review-editor --record-id ID --out HTML [--revision N]   Export standalone editor',
  'response-review-markdown --record-id ID --out MD [--revision N]   Export readable response',
  'response-review-compare --file JSON   Compare complete original/current/returned fields',
  'response-review-apply --file JSON   Atomically retain original return and selected changes',
  'merchant-prepare                    Prepare a complete SF30 dataset/merchant',
  'merchant-preview --merchant DIR     Query the original immutable dataset',
  'merchant-serve --merchant DIR       Start its configured native merchant',
  'delivery-receive --delivery DIR     Receive an original finalized SF100 delivery',
  '',
  'Mutations: --expected-revision N (workspace; review/workshare/bidder update use own revision)',
  'Bidder kind: profile|evidence|requirement|decision; --command-id ID makes a save repeatable',
  'Response mutations retain commandId/workspaceId/expectedRevision from complete --file JSON.',
  'Evidence intake: --attachment FILE retains the actual bytes with your JSON description',
  'Bidder list: --notice-id ID --offset N --limit N; all record editions remain retrievable',
  'Common: --operator NAME --title TITLE --out FILE',
  'Selection: --scope all|shortlist|selected --notice-id ID (repeat)',
  'Source: --label LABEL --url ORIGINAL_URL --retrieved-at ISO --expected-sha256 SHA',
  'Streams: open-tenders, new-tenders, complete-tenders, awards, supply-arrangements',
  'Serve: --host 127.0.0.1 --port 0',
  'Merchant: --payment PUBLIC_TERMS_JSON --origin HTTPS_ORIGIN --path /procurement',
  '          --query JSON --facilitator HTTPS_URL --expected-bundle-sha256 SHA',
  '',
  'Money in authored workshares is integer cents. Original source amounts remain unchanged.',
  'Outputs use a new file; an existing destination is never overwritten.',
  ''
].join('\n');
const options = Object.fromEntries([
  'workspace','operator','title','file','out','label','url','retrieved-at','expected-sha256',
  'stream','capture-id','entry-id','source-id','workshare-id','package-id','scope','format',
  'expected-revision','before','after','host','port','merchant','delivery','payment','origin','path','name',
  'default-limit','max-limit','query','facilitator','expected-bundle-sha256','availability-directory',
  'kind','record-id','profile-id','profile-revision','revision','command-id','attachment','offset','limit'
].map(name => [name,{type:'string'}]));
options['allow-local-facilitator']={type:'boolean'};
options.history={type:'boolean'};
options['notice-id']={type:'string',multiple:true}; options.help={type:'boolean',short:'h'};
function required(value,name) { if(value===undefined||value==='') throw failure('ARGUMENT_REQUIRED',name+' is required'); return value; }
function integer(value,name,fallback) {
  if(value===undefined)return fallback;
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw failure('INVALID_NUMBER',name+' must be a nonnegative safe integer');
  return Number(value);
}
function one(values,name) { if(!values||values.length!==1)throw failure('NOTICE_REQUIRED',name+' requires one --notice-id'); return values[0]; }
async function input(file) {
  const bytes=await readFile(resolve(required(file,'--file')));
  const rawText=decodeCsv(bytes).rawText;
  return {bytes,rawText};
}
async function jsonInput(file) {
  const original=await input(file);
  try {return {...original,document:JSON.parse(original.rawText.replace(/^\uFEFF/,''))};}
  catch {throw failure('INVALID_JSON','Select a complete UTF-8 JSON document');}
}
async function output(value,file,raw=false) {
  const body=raw?value:JSON.stringify(value,null,2)+'\n';
  if(!file){process.stdout.write(body);return;}
  const path=resolve(file); await mkdir(dirname(path),{recursive:true,mode:0o700});
  await writeFile(path,body,{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({file:path,bytes:Buffer.byteLength(body),sha256:sha256(body)})+'\n');
}
export async function main(args=process.argv.slice(2)) {
  const command=args[0];
  if(!command||['help','--help','-h'].includes(command)){process.stdout.write(HELP);return;}
  const {values:value}=parseArgs({args:args.slice(1),options,allowPositionals:false,strict:true});
  if(value.help){process.stdout.write(HELP);return;}
  if(command==='feeds')return output(OFFICIAL_FEEDS,value.out);
  const directory=required(value.workspace,'--workspace'),operator=value.operator||'operator';
  const expectedRevision=integer(value['expected-revision'],'--expected-revision');
  const selection={scope:value.scope||'all',noticeIds:value['notice-id']||[]};
  if(command==='serve') {
    const service=await startCanadaBuysServer({directory,operator,title:value.title,host:value.host||'127.0.0.1',port:integer(value.port,'--port',0)});
    const metadata=service.workspace.metadata();
    process.stdout.write(JSON.stringify({schema:'stellar-forge.canadabuys-startup.v1',origin:service.origin,
      directory:resolve(directory),operator,workspaceId:metadata.id,revision:metadata.revision,pid:process.pid})+'\n');
    let stopping=false;
    const stop=()=>{if(stopping)return;stopping=true;service.close().catch(error=>{
      process.stderr.write(JSON.stringify({error:{code:error.code,message:error.message}})+'\n');process.exitCode=1;
    });};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return service;
  }
  if(command==='merchant-preview'||command==='merchant-serve') {
    const merchant=await import('./merchant.mjs'),merchantDirectory=required(value.merchant,'--merchant');
    const settings={expectedBundleSha256:value['expected-bundle-sha256']};
    if(command==='merchant-preview')return output(await merchant.previewMerchant(merchantDirectory,
      value.query?(await jsonInput(value.query)).document:{},settings),value.out);
    const service=await merchant.serveMerchant(merchantDirectory,{...settings,port:integer(value.port,'--port',0),
      facilitator:value.facilitator,allowLocalFacilitator:value['allow-local-facilitator']||false,
      availabilityDirectory:value['availability-directory']});
    process.stdout.write(JSON.stringify({schema:'stellar-forge.canadabuys-merchant-startup.v1',
      directory:resolve(merchantDirectory),origin:service.origin||service.url,merchantId:service.merchantId,
      snapshot:service.snapshot,pid:process.pid})+'\n');
    let stopping=false;
    const stop=()=>{if(stopping)return;stopping=true;Promise.resolve(service.close()).catch(error=>{
      process.stderr.write(JSON.stringify({error:{code:error.code,message:error.message}})+'\n');process.exitCode=1;
    });};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return service;
  }
  const workspace=new CanadaBuysWorkspace(directory,{operator,title:value.title});
  try {
    let result;
    switch(command) {
      case 'init':case 'status':result=workspace.view();break;
      case 'import': {
        const original=await input(value.file);
        result=workspace.importCsv(original.bytes,{stream:required(value.stream,'--stream'),label:value.label||value.file,url:value.url,
          retrievedAt:value['retrieved-at'],expectedSha256:value['expected-sha256']},expectedRevision);break;
      }
      case 'capture':case 'resume':
        result=await captureCanadaBuys(workspace,command==='resume'?{captureId:required(value['capture-id'],'--capture-id'),expectedRevision}:
          {stream:required(value.stream,'--stream'),url:value.url,label:value.label,expectedRevision});break;
      case 'capture-record':result=workspace.getCapture(required(value['capture-id'],'--capture-id'));break;
      case 'notice':result=workspace.getNotice(one(value['notice-id'],'notice'));break;
      case 'entry':result=workspace.getEntry(required(value['entry-id'],'--entry-id'));break;
      case 'source':result=workspace.getSource(required(value['source-id'],'--source-id'));break;
      case 'review': {
        const {document}=await jsonInput(value.file);
        result=workspace.updateReview(one(value['notice-id'],'review'),{...document,expectedRevision});break;
      }
      case 'workshare-create':
        result=workspace.createWorkshare((await jsonInput(value.file)).document,expectedRevision);break;
      case 'workshare-update':
        result=workspace.updateWorkshare(required(value['workshare-id'],'--workshare-id'),{...(await jsonInput(value.file)).document,expectedRevision});break;
      case 'workshare':result=workspace.getWorkshare(required(value['workshare-id'],'--workshare-id'));break;
      case 'qualify':result=workspace.qualify((await jsonInput(value.file)).document);break;
      case 'compare':result=workspace.compare(required(value.before,'--before'),required(value.after,'--after'));break;
      case 'export':return output(workspace.report({...selection,format:value.format||'json'}).body,value.out,true);
      case 'package':result=workspace.exportPackage({...selection,expectedRevision});break;
      case 'receive': {
        const original=await jsonInput(value.file);
        if(value['expected-sha256']&&sha256(original.bytes)!==value['expected-sha256'])throw failure('PACKAGE_FILE_HASH_MISMATCH','Selected package file differs from its SHA256',409);
        result=workspace.receivePackage(original.document,{expectedRevision});break;
      }
      case 'receiving':result=workspace.getReceiving(required(value['package-id'],'--package-id'));break;
      case 'bidder-status':result=workspace.bidderDesk.status();break;
      case 'bidder-list':result=workspace.bidderDesk.list(required(value.kind,'--kind'),{
        noticeId:value['notice-id']?one(value['notice-id'],'bidder-list'):undefined,
        offset:integer(value.offset,'--offset',0),limit:integer(value.limit,'--limit',100)});break;
      case 'bidder-record':result=workspace.bidderDesk.get(required(value.kind,'--kind'),required(value['record-id'],'--record-id'),{
        revision:integer(value.revision,'--revision'),history:value.history||false});break;
      case 'bidder-create':case 'bidder-update':{
        const record={...(await jsonInput(value.file)).document,expectedRevision,
          ...(value['command-id']?{commandId:value['command-id']}:{})};
        if(value['notice-id'])record.noticeId=one(value['notice-id'],command);
        if(value.attachment){
          if(value.kind!=='evidence')throw failure('EVIDENCE_KIND_REQUIRED','Use --attachment with --kind evidence');
          const body=await readFile(resolve(value.attachment));
          record.bodyBase64=body.toString('base64');
          record.localOrigin=record.localOrigin||basename(value.attachment);
          record.title=record.title||basename(value.attachment);
        }
        result=command==='bidder-create'?workspace.bidderDesk.create(required(value.kind,'--kind'),record)
          :workspace.bidderDesk.update(required(value.kind,'--kind'),required(value['record-id'],'--record-id'),record);break;
      }
      case 'bidder-fit':result=workspace.bidderDesk.fit(required(value['profile-id'],'--profile-id'),{
        profileRevision:integer(value['profile-revision'],'--profile-revision'),noticeIds:value['notice-id']||[]});break;
      case 'bidder-assess':result=workspace.bidderDesk.assess((await jsonInput(value.file)).document);break;
      case 'bidder-compare':result=workspace.bidderDesk.compareCurrent(required(value['record-id'],'--record-id'));break;
      case 'bidder-report':return output(workspace.bidderDesk.report(required(value['record-id'],'--record-id'),{
        format:value.format||'html',revision:integer(value.revision,'--revision')}).body,value.out,true);
      case 'bidder-evidence':{
        required(value.out,'--out');
        return output(workspace.bidderDesk.evidenceFile(required(value['record-id'],'--record-id'),{
          revision:integer(value.revision,'--revision')}).body,value.out,true);
      }
      case 'response-review-status':result=responseStatus(workspace);break;
      case 'response-review-prepare':result=prepareResponseReview(workspace,(await jsonInput(value.file)).document);break;
      case 'response-review-record':result=getResponseReview(workspace,required(value['record-id'],'--record-id'),{revision:integer(value.revision,'--revision')});break;
      case 'response-review-export':result=await exportResponseReview(workspace,required(value['record-id'],'--record-id'),{revision:integer(value.revision,'--revision')});break;
      case 'response-review-editor':{
        required(value.out,'--out');
        const transfer=await exportResponseReview(workspace,required(value['record-id'],'--record-id'),{revision:integer(value.revision,'--revision')});
        return output(await responseEditorHTML(transfer),value.out,true);
      }
      case 'response-review-markdown':return output(responseMarkdown(workspace,required(value['record-id'],'--record-id'),{revision:integer(value.revision,'--revision')}).body,value.out,true);
      case 'response-review-compare':result=await compareResponseReturn(workspace,(await jsonInput(value.file)).document);break;
      case 'response-review-apply':result=await applyResponseReturn(workspace,(await jsonInput(value.file)).document);break;
      case 'merchant-prepare': {
        const merchant=await import('./merchant.mjs');
        result=await merchant.prepareMerchant(workspace,{...selection,scope:value.scope||'shortlist',expectedRevision,
          payment:value.payment?(await jsonInput(value.payment)).document:undefined,
          origin:value.origin,path:value.path||'/procurement',name:value.name,
          defaultLimit:integer(value['default-limit'],'--default-limit',10),
          maxLimit:integer(value['max-limit'],'--max-limit',20)});break;
      }
      case 'delivery-receive': {
        const merchant=await import('./merchant.mjs');
        result=await merchant.adoptDelivery(workspace,required(value.delivery,'--delivery'),{expectedRevision});break;
      }
      default:throw failure('UNKNOWN_COMMAND','Unknown command '+command+'; run canadabuys --help');
    }
    return output(result,value.out);
  } finally {workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  process.stderr.write(JSON.stringify({error:{code:error.code||'CANADABUYS_ERROR',message:error.message,
    ...(error.details===undefined?{}:{details:error.details})}})+'\n');process.exitCode=1;
});
