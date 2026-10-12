#!/usr/bin/env node
// MIT. One original HTTP receiving operation using retained capture-refresh output.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openRefresh } from '../refresh.mjs';
import { readRevision, readRegular, digest } from '../store.mjs';
import { canonical } from '../model.mjs';
import { startWorkspace } from '../../workspace/server.mjs';
import { readPackage } from '../../workspace/model.mjs';

const json = value => JSON.stringify(value,null,2)+'\n';
const check = (condition,message) => {if(!condition)throw new Error(message);};
const parse = bytes => JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const selectorQuery = value => new URLSearchParams({kind:value.kind,id:value.id,...(value.revision?{revision:value.revision}:{})});

export async function receiveConsole({refreshResult,output}) {
  const input = parse(await readRegular(resolve(refreshResult),4*1024*1024));
  check(input.operation==='AF825-HAR-REFRESH-20261012' && input.editions?.length===3 &&
    /^[a-f0-9]{64}$/.test(input.candidateRevision??''),'Select the retained completed four-edition refresh result');
  const original = await openRefresh(join(input.directory,'final-receiver'));
  const saved = await readRevision(original.candidate,input.candidateRevision);
  const planBytes = await readRegular(join(input.directory,'merchant-plan.json'),4*1024*1024), plan = parse(planBytes);
  const expectedSource = await readRegular(join(input.directory,'final-export','openapi.json'),4*1024*1024);
  output=resolve(output);
  await mkdir(output,{mode:0o700});
  const senderParent=join(output,'sender'),receiverParent=join(output,'receiver');
  await mkdir(senderParent,{mode:0o700});await mkdir(receiverParent,{mode:0o700});
  await writeFile(join(output,'original-selection.json'),json({refreshResult:resolve(refreshResult),
    originalOperation:original.manifest.operationId,revision:saved.revision,
    originalResultSha256:digest(await readRegular(resolve(refreshResult),4*1024*1024)),
    originalPlanSha256:digest(planBytes),originalSourceSha256:digest(expectedSource)}),{flag:'wx',mode:0o600});
  let sender,receiver;
  const requests=[];
  async function request(session,path,{body,raw,download=false}={}) {
    const response=await fetch(session.origin+'/api/'+path,{method:body===undefined&&raw===undefined?'GET':'POST',
      headers:{'x-workspace-token':session.token,origin:session.origin,
        ...(raw!==undefined?{'content-type':'application/octet-stream'}:body!==undefined?{'content-type':'application/json'}:{})},
      ...(raw!==undefined?{body:raw}:body!==undefined?{body:json(body)}:{})});
    requests.push({method:body===undefined&&raw===undefined?'GET':'POST',path,status:response.status});
    if(!response.ok)throw new Error(path+': '+response.status+' '+await response.text());
    return download?Buffer.from(await response.arrayBuffer()):response.json();
  }
  try {
    sender=await startWorkspace({parent:senderParent,noSignals:true});
    const before=await request(sender,'har/adopt',{body:{kind:'capture',directory:original.previous.root,label:'Original previous capture'}});
    const previous={...before.selection,revision:original.manifest.lineage.previousReviewSha256};
    const candidateBytes=await readRegular(join(original.candidate.root,'source.har'));
    const upload=new URLSearchParams({label:'Original next capture',previousKind:previous.kind,
      previousId:previous.id,previousRevision:previous.revision});
    const prepared=await request(sender,'har/upload?'+upload,{raw:candidateBytes});
    check(prepared.selection.id===original.manifest.operationId,'HTTP refresh selected a different original lineage');
    const chosen=await request(sender,'har/decisions?'+selectorQuery(prepared.selection),{raw:saved.bytes});
    check(chosen.revision===saved.revision,'HTTP decision save changed the original immutable review');
    const repeated=await request(sender,'har/upload?'+upload,{raw:candidateBytes});
    check(repeated.reused===true&&repeated.selection.id===prepared.selection.id,'Completed upload retry did not reopen its original packet');
    const source=await request(sender,'har/source?'+selectorQuery(chosen.selection));
    check(source.specText===expectedSource.toString('utf8'),'HTTP source differs from the original approved OpenAPI');
    const preview=await request(sender,'preview',{body:{specText:source.specText,plan,capturedSource:source.capturedSource}});
    const native=await request(sender,'save',{body:{specText:source.specText,plan,capturedSource:source.capturedSource,name:'capture-merchant'}});
    check(preview.routes.length===plan.operations.length&&native.preview.routes.length===plan.operations.length,'Original merchant route set changed');
    const loaded=await request(sender,'load?name=capture-merchant');
    check(loaded.specText===source.specText&&canonical(loaded.plan)===canonical(plan),'Saved sender package changed original source or plan');
    const copied=await request(sender,'har/copy',{body:{selection:chosen.selection,destination:join(output,'source-receiver')}});
    await sender.close();sender=null;
    await rename(senderParent,join(output,'retained-sender'));

    receiver=await startWorkspace({parent:receiverParent,noSignals:true});
    const adopted=await request(receiver,'har/adopt',{body:{kind:'refresh',directory:copied.destination,label:'Received original capture edition'}});
    const selected={...adopted.selection,revision:chosen.revision};
    const received=await request(receiver,'har/source?'+selectorQuery(selected));
    check(received.specText===source.specText,'Independent receiving source is not byte-identical');
    const located=await request(receiver,'har/locate',{body:{specText:received.specText}});
    check(located.capturedSource?.revision===selected.revision&&located.capturedSource?.id===selected.id,'Saved-package source did not reconnect to its retained review');
    const page=await request(receiver,'har/reviewer',{body:{selection:selected},download:true});
    await writeFile(join(output,'received-review.html'),page,{flag:'wx',mode:0o600});
    const exported=await request(receiver,'har/export',{body:{selection:selected},download:true});
    check(exported.equals(expectedSource),'Received source attachment changed the approved OpenAPI');
    await writeFile(join(output,'received-openapi.json'),exported,{flag:'wx',mode:0o600});
    const final=await request(receiver,'save',{body:{specText:received.specText,plan,capturedSource:received.capturedSource,name:'received-merchant'}});
    const reopened=await readPackage(receiverParent,'received-merchant');
    check(reopened.manifest.files['original-openapi.json']===digest(expectedSource),'Receiving merchant did not retain the original source bytes');
    check(canonical(reopened.plan)===canonical(plan),'Receiving merchant did not retain exact native plan values');
    const index=await(await fetch(receiver.origin)).text(),browser=await(await fetch(receiver.origin+'/har-browser.mjs')).text();
    check(index.includes('id="har-intake"')&&browser.includes('createHarPanel'),'Original merchant console did not mount capture intake');
    const sourceFiles={};
    for(const name of ['../workspace.mjs','../workspace-http.mjs','../browser.mjs','../../workspace/server.mjs','../../workspace/browser.mjs'])
      sourceFiles[name]=digest(await readFile(new URL(name,import.meta.url)));
    const result={operation:'AF825-HAR-CONSOLE-20261012',node:process.version,platform:process.platform,
      directory:output,originalRefreshResult:resolve(refreshResult),sourceFiles,requests,
      selected:received.capturedSource,receivingDirectory:copied.destination,
      sourceSha256:digest(exported),reviewPageSha256:digest(page),
      merchant:{directory:final.folder,routes:final.preview.routes.map(route=>({id:route.id,method:route.method,
        path:route.path,amountAtomic:route.amountAtomic})),sourceSha256:reopened.manifest.files['original-openapi.json']},
      senderRetainedAt:join(output,'retained-sender')};
    await receiver.close();receiver=null;
    await writeFile(join(output,'result.json'),json(result),{flag:'wx',mode:0o600});
    return result;
  } catch(error) {
    await writeFile(join(output,'failure.json'),json({operation:'AF825-HAR-CONSOLE-20261012',node:process.version,
      error:String(error.stack??error),requests}),{flag:'wx',mode:0o600});
    throw error;
  } finally {
    const closed=await Promise.allSettled([receiver?.close(),sender?.close()]);
    const failures=closed.filter(result=>result.status==='rejected').map(result=>result.reason);
    if(failures.length)throw new AggregateError(failures,'Receiving workspaces did not finish stopping');
  }
}
export async function main(args=process.argv.slice(2)) {
  const values=new Map();
  for(let i=0;i<args.length;i+=2) {
    if(!['--refresh-result','--out'].includes(args[i])||values.has(args[i])||!args[i+1])
      throw new TypeError('Use --refresh-result RETAINED_RESULT.json --out NEW_PRIVATE_DIRECTORY');
    values.set(args[i],args[i+1]);
  }
  if(values.size!==2)throw new TypeError('Use --refresh-result RETAINED_RESULT.json --out NEW_PRIVATE_DIRECTORY');
  const result=await receiveConsole({refreshResult:values.get('--refresh-result'),output:values.get('--out')});
  console.log(json(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
