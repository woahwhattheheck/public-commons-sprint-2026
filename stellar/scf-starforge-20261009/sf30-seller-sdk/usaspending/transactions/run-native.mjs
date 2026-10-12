#!/usr/bin/env node
// MIT. Receive an actual retained federal award and its transaction source end to end.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AwardWorkspace } from '../workspace.mjs';
import { serveWorkspace } from '../server.mjs';
import { detailReceipt } from '../source-import.mjs';
import { main as cli } from '../cli.mjs';
import { sha, canonical, requireThat } from '../core.mjs';

const help='node transactions/run-native.mjs --source ORIGINAL_SOURCE_PACKET.json --out NEW_PRIVATE_DIRECTORY';
function options(args){const o={};for(let i=0;i<args.length;i+=2){requireThat(['--source','--out'].includes(args[i])&&args[i+1]&&!o[args[i]],'ARGUMENT_INVALID',help);o[args[i]]=args[i+1];}requireThat(o['--source']&&o['--out'],'ARGUMENT_REQUIRED',help);return {source:resolve(o['--source']),out:resolve(o['--out'])};}
async function put(path,value){const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');await writeFile(path,bytes,{flag:'wx',mode:0o600});return {path,bytes:bytes.length,sha256:sha(bytes)};}
function originalFiles(packet){
  requireThat(packet.schema==='usaspending.native-transaction-source.v1'&&Array.isArray(packet.files),'ORIGINAL_SOURCE_PACKET_REQUIRED');
  const files=new Map();for(const f of packet.files){requireThat(f.encoding==='base64'&&typeof f.content==='string'&&!files.has(f.path),'ORIGINAL_FILE_INVALID');const bytes=Buffer.from(f.content,'base64');requireThat(bytes.length===f.bytes&&sha(bytes)===f.sha256,'ORIGINAL_SOURCE_DIGEST_MISMATCH');files.set(f.path,bytes);}
  const need=name=>{const bytes=files.get(name);requireThat(bytes,'ORIGINAL_FILE_MISSING',name);return bytes;};return {files,need};
}
export async function run({source,out}) {
  const packet=JSON.parse(await readFile(source,'utf8')),{need}=originalFiles(packet);
  await mkdir(out,{mode:0o700});const sourceDir=join(out,'original');await mkdir(sourceDir,{mode:0o700});
  const artifacts=[],save=async(name,value)=>{const item=await put(join(out,name),value);artifacts.push(item);return item;};
  await save('retained-source.json',packet);
  const awardBytes=need('award.json'),awardSource=JSON.parse(need('award.source.json').toString('utf8'));
  const rawRequest=need('transactions-page-0001.request.json'),response=need('transactions-page-0001.response.json'),request=JSON.parse(rawRequest.toString('utf8')),observed=packet.transaction_receipt;
  requireThat(observed?.method==='POST'&&request.award_id===packet.award_id&&observed.request_body_sha256===sha(rawRequest)&&observed.response_sha256===sha(response)&&observed.response_bytes===response.length&&observed.request_body_bytes===rawRequest.length,'ORIGINAL_TRANSACTION_RECEIPT_MISMATCH');
  const receipt={request:{method:observed.method,url:observed.url,body:request,bodyBase64:rawRequest.toString('base64'),bodySha256:sha(rawRequest)},startedAt:observed.observed_at,finishedAt:observed.completed_at,url:observed.url,status:observed.http_status,headers:Object.fromEntries(observed.response_headers??[]),bytes:response.length,sha256:sha(response),originalReceipt:observed};
  await put(join(sourceDir,'award.json'),awardBytes);await put(join(sourceDir,'award.source.json'),awardSource);
  await put(join(sourceDir,'transactions.request.json'),rawRequest);await put(join(sourceDir,'transactions.response.json'),response);await put(join(sourceDir,'transactions.receipt.json'),receipt);
  const workspaceDir=join(out,'workspace'),workspace=new AwardWorkspace(workspaceDir,{operator:'Federal award research'});
  let server;
  try {
    const detail=workspace.importDetail({bytes:awardBytes,receipt:detailReceipt(awardSource,awardBytes),name:'Original award transaction research'});
    const awardOnly=workspace.exportPacket();await save('award-only-workspace.json',awardOnly);
    server=await serveWorkspace(workspace,{port:0});const secret=new URL(server.url).hash.slice(1);
    async function http(path,body){const r=await fetch(server.origin+path,{method:body===undefined?'GET':'POST',headers:{'x-research-token':secret,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});requireThat(r.ok,'NATIVE_HTTP_FAILED',path+' '+r.status+' '+(!r.ok?await r.text():''));return r;}
    const imported=await (await http('/api/transactions/import',{editionId:detail.editionId,awardKey:packet.award_id,pages:[{request,receipt,responseBase64:response.toString('base64')}]})).json();
    const capture=imported.captureId,q='?capture='+encodeURIComponent(capture);
    const summary=await (await http('/api/transactions/summary'+q)).json();
    requireThat(summary.capture.status==='complete'&&summary.analysis.unique_transactions===packet.completion.rows&&summary.analysis.net_obligation_usd===packet.completion.exact_obligation_total,'ORIGINAL_SOURCE_ANALYSIS_MISMATCH');
    const rows=await (await http('/api/transactions/rows'+q)).json();
    await http('/api/transactions/review',{captureId:capture,expectedRevision:0,review:{status:'researching',fit:'Retained award '+packet.award_id+' held by '+summary.capture.award_row.recipient_name+'.',fundingChange:'Original captured obligations total USD '+summary.analysis.net_obligation_usd+' across '+summary.analysis.unique_transactions+' transactions.',proposedWorkshare:'Prepare a source-backed implementation and data receiving workshare for the existing relationship owner.',deliverables:'Original source capture, chronological actions, fiscal-year funding view, private assessment, portable workspace and receiving guide.',acceptance:'Receiving retains every original request and response, the award identity, exact monetary values, and the assessment source binding.',owner:'Existing relationship owner',caseUrl:'',nextAction:'Review the retained scope and funding history within the existing opportunity.',notes:'Agency action descriptions and financial direction remain separate.'}});
    const portable=await (await http('/api/transactions/export'+q+'&reviews=true')).json();
    await save('transaction-capture.json',portable);
    await save('transactions.csv',Buffer.from(await (await http('/api/transactions/export'+q+'&format=csv')).arrayBuffer()));
    await save('workshare.md',Buffer.from(await (await http('/api/transactions/brief'+q)).arrayBuffer()));
    await save('summary.json',await (await http('/api/transactions/summary'+q)).json());
    const sourcePage=Buffer.from(await (await http('/api/transactions/source'+q+'&page=1')).arrayBuffer());
    requireThat(sha(sourcePage)===sha(response),'ORIGINAL_SOURCE_HTTP_BYTES_CHANGED');
    for(const path of ['/transactions.html','/transactions.js','/transactions.css']){const r=await fetch(server.origin+path);requireThat(r.ok&&(await r.arrayBuffer()).byteLength>0,'BROWSER_ASSET_MISSING',path);}
    const full=await (await http('/api/backup')).json();await save('complete-workspace.json',full);
    await server.close();server=null;
    const restored=new AwardWorkspace(join(out,'restored'),{operator:'Receiving operator'});
    try{restored.restorePacket(full);requireThat(canonical(restored.transactions.rows(capture))===canonical(portable.rows)&&restored.transactions.summary(capture).review?.revision===1,'WORKSPACE_RECEIVING_MISMATCH');}finally{restored.close();}
    const received=new AwardWorkspace(join(out,'received'),{operator:'Receiving operator'});
    let receivedResult;
    try{
      received.restorePacket(awardOnly);
      receivedResult=received.transactions.receive(portable,{includeReview:true});
      const receivedRows=received.transactions.rows(receivedResult.captureId),receivedReview=received.transactions.summary(receivedResult.captureId).review;
      requireThat(canonical(receivedRows)===canonical(portable.rows)&&receivedReview?.data.receivedFrom?.packetSha256===portable.sha256,'CAPTURE_RECEIVING_MISMATCH');
      received.transactions.receive(portable,{includeReview:true});
      const empty=received.transactions.create({editionId:detail.editionId,awardKey:packet.award_id,pageSize:request.limit,maxRows:100});
      const prepared=received.transactions.receive(received.transactions.export(empty.id));
      requireThat(received.transactions.capture(prepared.captureId).next_page===1&&!prepared.complete,'PREPARED_CAPTURE_RECEIVING_MISMATCH');
      await save('received-workspace.json',received.exportPacket());
    }finally{received.close();}
    const cliSummary=await cli(['tx-summary','--workspace',workspaceDir,'--capture',capture],{print:false});
    requireThat(cliSummary.analysis.net_obligation_usd===summary.analysis.net_obligation_usd,'CLI_RECEIVING_MISMATCH');
    const result={schema:'usaspending-transactions.native-receiving.v1',completedAt:new Date().toISOString(),awardKey:packet.award_id,editionId:detail.editionId,captureId:capture,receivedCaptureId:receivedResult.captureId,pages:imported.pages,transactions:rows.total,netObligationUsd:summary.analysis.net_obligation_usd,awardDifferenceUsd:summary.analysis.award_obligation_difference_usd,originalResponseSha256:sha(response),portableCaptureSha256:portable.sha256,workflow:['original_award','private_http','original_transactions','assessment','source_export','brief','workspace_restore','capture_receiving','receiving_replay','prepared_capture_receiving','cli'],artifacts};
    await put(join(out,'receiving-result.json'),result);process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{if(server)await server.close();else{try{workspace.close();}catch{}}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)run(options(process.argv.slice(2))).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'NATIVE_RECEIVING_FAILED',message:error.message})+'\n');process.exitCode=1;});
