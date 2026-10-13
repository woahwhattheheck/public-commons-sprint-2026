// SPDX-License-Identifier: MIT
// Append the complete exchange to the same installed Grant receiving operation.
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createLearningExchangeReceivingBrowser} from './learning-exchange-browser.mjs';
import * as X from './learning-exchange.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const need=(yes,message)=>{if(!yes)throw Object.assign(new Error(message),{code:'LEARNING_EXCHANGE_RECEIVING'});};
const same=(a,b)=>X.canonical(a)===X.canonical(b);
const read=async row=>{const raw=await readFile(row.path);need(raw.length===row.bytes&&createHash('sha256').update(raw).digest('hex')===row.sha256,'The selected full receiving artifact changed.');return JSON.parse(raw.toString('utf8'));};

async function browser(p,alias,key,baseline,exchange){
  return p.phase(key,async()=>{
    const host=p.state.hosts[alias],source=p.prepared[host.source];
    const extensionSource=await p.copy(join(HERE,'learning-exchange-browser.mjs'),'learning-exchange-source/learning-exchange-browser.mjs');
    p.browserOwner=createLearningExchangeReceivingBrowser({
      directory:join(p.root,'browser',key),connectionFile:host.connectionFile,
      workspaceDirectory:host.directory,workspaceId:host.workspaceId,
      applicationDirectory:source.applicationDirectory,sourceManifestSha256:source.sourceManifestSha256,
      baseline,actor:p.o.actor,playwright:p.o.playwright,chromium:p.o.chromium,
      source:p.selection.source,exchange:{...exchange,source:extensionSource}
    });
    let result;
    try{result=await p.browserOwner.run();}
    finally{await p.browserOwner.close();p.browserOwner=null;}
    need(result.schema==='stellar-forge.grant-analyst-browser-result.v1'&&result.state==='COMPLETE'&&result.exchange,'Complete the original browser extension before handover.');
    for(const row of [...result.files,result.resultFile]){const retained=await p.retain(row.path);need(retained.bytes===row.bytes&&retained.sha256===row.sha256,'The completed browser artifact changed.');}
    return result;
  });
}
function exactAdditions(before,after,bundle){
  X.inspectBundle(bundle);
  const operations=bundle.operations.filter(op=>!before.state.requests[op.request.body.requestId]);
  need(operations.length===4&&bundle.applications.length>=operations.length,'The receiving exchange must retain its four explicit original applications.');
  const ids=new Set(operations.map(op=>op.request.body.requestId));
  const actual=Object.keys(after.state.requests).filter(id=>!before.state.requests[id]);
  need(actual.length===ids.size&&actual.every(id=>ids.has(id)),'An unexpected native request changed this receiving edition.');
  need(same(after.state.audit.slice(0,before.state.audit.length),before.state.audit)&&after.state.audit.length===before.state.audit.length+ids.size,'The original audit must append each explicit request once.');
  for(const[key,value]of Object.entries(before.state.requests))need(same(value,after.state.requests[key]),'An original request receipt changed.');
  for(const key of ['editions','codebooks','reviews','studies','selectedCodebook'])need(same(before.state[key],after.state[key]),'The exchange changed unrelated original state: '+key);
  need(same(before.objects,after.objects)&&same(before.reports,after.reports),'The exchange changed original source/evidence/report bytes.');
  for(const op of operations){
    const application=bundle.applications.find(x=>x.operationId===op.id);
    need(application&&same(application.receipt,after.state.requests[op.request.body.requestId]),'The complete exchange receipt differs from native saved history.');
  }
  const changed=new Map();
  for(const op of operations){
    const body=op.request.body,cycle=before.state.learningCycles.find(c=>c.id===body.cycle);
    need(cycle,'The exchange must use an existing complete native cycle.');
    const value=changed.get(cycle.id)??{reviews:[],actions:new Map()};
    if(op.request.action==='cycle-action'){
      const rows=value.actions.get(body.action)??[];rows.push({...body,reviewer:body.reviewer});value.actions.set(body.action,rows);
    }else{
      need(op.request.action==='cycle-review','The exchange performed an unrelated native mutation.');
      value.reviews.push(body);for(const row of body.actions){const rows=value.actions.get(row.id)??[];rows.push({...row,reviewer:body.reviewer});value.actions.set(row.id,rows);}
    }
    changed.set(cycle.id,value);
  }
  need(after.state.learningCycles.length===before.state.learningCycles.length,'An exchange cannot invent a new programme cycle.');
  for(const old of before.state.learningCycles){
    const current=after.state.learningCycles.find(c=>c.id===old.id),change=changed.get(old.id);
    if(!change){need(same(old,current),'An unrelated learning cycle changed.');continue;}
    const omit=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['actions','reviews'].includes(key)));
    need(same(omit(old),omit(current)),'The original finding or baseline changed.');
    need(current.actions.length===old.actions.length&&current.reviews.length===old.reviews.length+change.reviews.length&&
      same(current.reviews.slice(0,old.reviews.length),old.reviews),'Original action/review history was lost.');
    for(const action of old.actions){
      const selected=current.actions.find(x=>x.id===action.id),added=change.actions.get(action.id)??[];
      need(selected&&same(selected.revisions.slice(0,action.revisions.length),action.revisions)&&selected.revisions.length===action.revisions.length+added.length,'The complete original action history must append exactly once per selected request.');
      for(let i=0;i<added.length;i++){
        const actual=selected.revisions[action.revisions.length+i],expected=added[i];
        need(actual.revision===expected.expectedRevision+1,'The retained original action revision differs.');
        for(const key of ['title','owner','dueOn','successCriteria','status','reviewer','note','evidence'])need(actual[key]===expected[key],'The applied original action differs: '+key);
      }
    }
    for(let i=0;i<change.reviews.length;i++){
      const expected=change.reviews[i],actual=current.reviews[old.reviews.length+i];
      need(actual.id===expected.id&&actual.reviewer===expected.reviewer&&actual.interpretation===expected.interpretation&&actual.limitations===expected.limitations&&actual.snapshot.report.edition.id===expected.edition&&same(actual.snapshot.references,expected.grantIds),'The whole-cycle native review differs from the explicitly returned review.');
    }
  }
  return{requests:[...ids],actions:operations.filter(x=>x.request.action==='cycle-action').length,reviews:operations.filter(x=>x.request.action==='cycle-review').length,completeOriginalSourcesPreserved:true};
}
async function replay(p,alias,bundle,key){
  const receipts=[];
  for(const op of bundle.operations){
    const {requestId,...payload}=op.request.body;
    const response=await p.response('action',{workspace:alias,action:op.request.action,requestId,payload},key+'-'+requestId);
    need(response.value.reused===true,'The same original exchange request must replay its retained result.');
    receipts.push({requestId,response});
  }
  return receipts;
}
export async function receiveLearningExchange(p,{receiving}){
  const primary='learning-receiving',independent='learning-exchange';
  need(p.state.hosts[primary]&&p.state.hosts[independent],'Declare both original source hosts in the same immutable installed configuration.');
  const operated=await p.phase('learning-08-complete-offline-exchange',async()=>{
    const opening=await p.start(primary,'learning-exchange-original');
    const browserResult=await browser(p,primary,'learning-08a-hosted-offline-browser',receiving.audit.value.snapshot,{mode:'operate'});
    const bundle=await read(browserResult.exchange.bundle);X.inspectBundle(bundle);
    const originalReplay=await p.phase('learning-08b-same-request-native-replays',()=>replay(p,primary,bundle,'learning-exchange-primary-replay'));
    const archive=await p.handover(primary,'learning-08c-complete-latest-native-handover');
    const files=await p.phase('learning-08d-latest-complete-agent-files',()=>p.catalogue(primary,'learning-exchange-primary-files'));
    await p.stop(primary);
    const audit=await p.phase('learning-08e-latest-native-audit',()=>p.helper('learning-exchange-primary-audit','audit',{
      workspace:p.state.hosts[primary].directory,expectedSnapshot:receiving.audit.value.snapshot,exact:false},'receiving'));
    const changes=await p.phase('learning-08f-exact-native-additions',async()=>{
      const result=exactAdditions(await read(receiving.audit.value.snapshot),await read(audit.value.snapshot),bundle);
      await p.record('learning-exchange-exact-additions',result);return result;
    });
    const archives=await p.phase('learning-08g-full-browser-agent-archives-reopened',async()=>({
      browser:await p.helper('learning-exchange-browser-archive','inspect-archive',{archive:browserResult.handover,expectedSnapshot:audit.value.snapshot,currentSource:true},'receiving'),
      agent:await p.helper('learning-exchange-agent-archive','inspect-archive',{archive:archive.archive,expectedSnapshot:audit.value.snapshot,currentSource:true},'receiving')
    }));
    return{opening,browser:browserResult,bundle:browserResult.exchange.bundle,originalReplay,archive,files,audit,changes,archives};
  });
  const received=await p.phase('learning-09-independent-exchange-receiving',async()=>{
    const received=await p.phase('learning-09a-original-native-archive-receive',()=>p.helper('learning-exchange-independent-receive','receive',{
      archive:operated.archive.archive,directory:p.state.hosts[independent].container,expectedSnapshot:operated.audit.value.snapshot,currentSource:true},'receiving'));
    need(received.value.workspace===p.state.hosts[independent].directory&&received.value.workspaceId===p.state.hosts[independent].workspaceId,'The full independent receive selected another workspace.');
    const opening=await p.start(independent,'learning-exchange-independent');
    const reads=await p.phase('learning-09b-independent-full-source-native-reads',()=>p.reads(independent,'learning-exchange-independent',received.value.snapshot));
    const reopened=await browser(p,independent,'learning-09c-independent-hosted-exchange',received.value.snapshot,{mode:'reopen',bundle:operated.bundle});
    const bundle=await read(reopened.exchange.bundle);X.inspectBundle(bundle);
    const originalReplay=await p.phase('learning-09d-independent-exact-request-replays',()=>replay(p,independent,bundle,'learning-exchange-independent-replay'));
    const archive=await p.handover(independent,'learning-09e-complete-independent-native-handover');
    const files=await p.phase('learning-09f-independent-complete-agent-files',()=>p.catalogue(independent,'learning-exchange-independent-files'));
    await p.stop(independent);
    const audit=await p.phase('learning-09g-independent-exact-native-audit',()=>p.helper('learning-exchange-independent-audit','audit',{
      workspace:p.state.hosts[independent].directory,expectedSnapshot:operated.audit.value.snapshot},'receiving'));
    const archives=await p.phase('learning-09h-independent-exports-reopened',async()=>({
      browser:await p.helper('learning-exchange-independent-browser-archive','inspect-archive',{archive:reopened.handover,expectedSnapshot:audit.value.snapshot,currentSource:true},'receiving'),
      agent:await p.helper('learning-exchange-independent-agent-archive','inspect-archive',{archive:archive.archive,expectedSnapshot:audit.value.snapshot,currentSource:true},'receiving')
    }));
    return{received,opening,reads,browser:reopened,bundle:reopened.exchange.bundle,originalReplay,archive,files,audit,archives};
  });
  const cold={};
  for(const[alias,expected]of [[primary,operated],[independent,received]]){
    cold[alias]=await p.phase(alias+'-10-cold-exchange-reopen',async()=>{
      await p.setup();const opening=await p.start(alias,alias+'-exchange-cold');
      need(opening.launchId!==expected.opening.launchId,'Cold receiving requires a new actual listener over the same saved workspace.');
      const reads=await p.phase(alias+'-10a-complete-native-cold-reads',()=>p.reads(alias,alias+'-exchange-cold',expected.audit.value.snapshot));
      for(const row of expected.files.files)await p.full(alias,row,alias+'-exchange-cold-file-'+row.fileId);
      const reopened=await browser(p,alias,alias+'-10b-cold-hosted-exchange',expected.audit.value.snapshot,{mode:'reopen',bundle:expected.bundle});
      await p.stop(alias);
      const audit=await p.phase(alias+'-10c-cold-exact-native-audit',()=>p.helper(alias+'-exchange-cold-audit','audit',{
        workspace:p.state.hosts[alias].directory,expectedSnapshot:expected.audit.value.snapshot},'receiving'));
      return{opening,reads,browser:reopened,audit};
    });
  }
  const handover=await p.phase('learning-11-complete-exchange-handover',async()=>{
    const files=[];
    for(const[name,row]of Object.entries({
      'native-primary.zip':operated.archive.archive,'native-received.zip':received.archive.archive,
      'exchange-primary.json':operated.bundle,'exchange-received.json':received.bundle,
      'native-primary-snapshot.json':operated.audit.value.snapshot,'native-received-snapshot.json':received.audit.value.snapshot
    }))files.push(await p.copy(row.path,'learning-exchange-handover/'+name,row));
    const closure={
      schema:'stellar-forge.learning-exchange-handover.v1',workspaceId:p.state.hosts[primary].workspaceId,
      originalDonor:p.selection.donor.learning.operationId,source:p.selection.source,
      nativeReceipts:operated.changes.requests,files,
      receiving:{primary:operated.browser.resultFile,independent:received.browser.resultFile,
        cold:Object.fromEntries(Object.entries(cold).map(([key,value])=>[key,value.browser.resultFile]))},
      completeInstalledDistribution:'../distribution/archive.tar.gz',
      privateSourceTransfer:'../private-source/complete-private-source.zip',
      presentation:'Producing owner must inspect actual rendered screenshots and reopen every selected outgoing file before customer presentation.'
    };
    await p.record('learning-exchange-handover',closure);return closure;
  });
  return{schema:'stellar-forge.learning-exchange-installed-result.v1',state:'COMPLETE',operated,received,cold,handover,
    originalProgrammesRerun:0,explicitOriginalApplications:4};
}
