// MIT. Complete Portfolio course on the existing receiver's page/context.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,lstat,open,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,dirname,isAbsolute,relative,sep} from 'node:path';
import {operatePortfolioWorkingCopies} from './portfolio-working-copies-browser.mjs';

const schema='stellar-forge.portfolio-supplied-page.v1';
const encoded=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const assets=['portfolio-working-copies.mjs','portfolio-working-copy-store.mjs','portfolio.mjs','portfolio.css'];
async function readJSON(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function regular(path){const st=await lstat(path);assert.ok(st.isFile()&&!st.isSymbolicLink(),'Retain the original regular receiving file.');return st;}
async function directory(path){const st=await lstat(path);assert.ok(st.isDirectory()&&!st.isSymbolicLink(),'Use the original receiver-owned directory.');}
async function identity(path){await regular(path);const data=await readFile(path);return{path,bytes:data.length,sha256:sha(data)};}
function within(root,path){const r=relative(root,resolve(path));return r===''||(r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r));}
async function run({page,context=page.context(),input},mode){
 assert.equal(page.context(),context,'Reuse the original page and browser context.');
 assert.ok(input&&typeof input==='object');
 assert.ok(typeof input.operationId==='string'&&input.operationId.length>0&&input.operationId.length<=180);
 assert.match(input.caseId||'',/^operation-[a-f0-9]{32}$/);
 assert.match(input.planId||'',/^plan-[a-f0-9]{32}$/);
 assert.match(input.portfolioId||'',/^portfolio-[a-f0-9]{32}$/);
 assert.match(input.asOfDate||'',/^\d{4}-\d{2}-\d{2}$/);
 assert.ok(typeof input.ownerKey==='string'&&input.ownerKey.length>0,'Supply the existing private owner key.');
 const base=new URL(input.baseUrl);
 assert.ok(['http:','https:'].includes(base.protocol)&&!base.username&&!base.password&&!base.search&&!base.hash&&base.pathname==='/','Use the original application origin.');
 const current=page.url();assert.ok(current==='about:blank'||new URL(current).origin===base.origin,'The supplied page belongs to another application.');
 assert.ok(isAbsolute(input.directory),'Supply the original absolute receiving directory.');
 const root=resolve(input.directory);await directory(root);
 const out=join(root,mode==='portfolio-cold'?'browser-portfolio-cold':'browser-portfolio');
 await mkdir(out,{recursive:true,mode:0o700});await directory(out);
 const binding={schema,operationId:input.operationId,caseId:input.caseId,planId:input.planId,portfolioId:input.portfolioId,asOfDate:input.asOfDate,origin:base.origin,sourceSha256:input.portfolioSourceSha256};
 for(const name of assets)assert.match(binding.sourceSha256?.[name]||'',/^[a-f0-9]{64}$/,'Pin actual installed source '+name);
 const name=mode==='portfolio-cold'?'portfolio-cold':'portfolio',progressPath=join(root,'browser-'+name+'-progress.json'),resultPath=join(root,'browser-'+name+'-result.json');
 async function atomic(path,value){
  assert.ok(isAbsolute(path)&&within(root,path),'Keep outputs inside the original receiving directory.');
  await directory(dirname(path));
  try{await regular(path);}catch(error){if(error.code!=='ENOENT')throw error;}
  const stage=path+'.pending-'+randomUUID();const body=typeof value==='string'||Buffer.isBuffer(value)?value:encoded(value);
  const fd=await open(stage,'wx',0o600);try{await fd.writeFile(body);await fd.sync();}finally{await fd.close();}
  await rename(stage,path);await syncDirectory(dirname(path));
 }
 async function native(path,{binary=false}={}){
  const url=new URL(path,base.origin);assert.equal(url.origin,base.origin);
  const response=await page.request.get(url.href,{headers:{Authorization:'Bearer '+input.ownerKey}});
  if(!response.ok())throw Error('Original native read returned '+response.status()+' for '+url.pathname);
  return binary?Buffer.from(await response.body()):response.json();
 }
 for(const asset of assets)assert.equal(sha(await native('/'+asset,{binary:true})),binding.sourceSha256[asset],'Actual installed source changed: '+asset);
 let progress=await readJSON(progressPath);
 if(progress)assert.deepEqual(progress.receivingBinding,binding,'Continue the exact original receiving operation and source.');
 else progress={schema,operationId:input.operationId,caseId:input.caseId,planId:input.planId,asOfDate:input.asOfDate,receivingBinding:binding,startedAt:new Date().toISOString(),phases:{},files:{},visualReview:{}};
 const saveProgress=()=>atomic(progressPath,progress);
 async function verifyCompleted(prior){
  assert.deepEqual(prior.receivingBinding,binding,'Retain the original completed result.');
  for(const item of Object.values(prior.files||{})){assert.ok(within(root,item.path),'Original output moved outside receiving directory.');assert.deepEqual(await identity(item.path),item,'Retain every completed original export.');}
  const savedId=prior.savedPortfolioId||prior.phases?.['portfolio-cold-original-case-and-copy']?.result?.portfolioId;
  const savedSha=prior.savedPortfolioSha256||prior.phases?.['portfolio-cold-original-case-and-copy']?.result?.sha256;
  const saved=await native('/api/operations/'+input.caseId+'/portfolios/'+savedId);assert.equal(saved.sha256,savedSha);
  return prior;
 }
 async function syncDirectory(path=root){const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}}
 async function publishCompleted(complete){
  const body=Buffer.from(encoded(complete)),prepared=resultPath+'.complete.json';
  let existing=await readJSON(prepared);
  if(existing){assert.deepEqual(existing,complete,'Retain the exact first completed result.');await verifyCompleted(existing);}
  else{
   const stage=prepared+'.pending-'+randomUUID(),fd=await open(stage,'wx',0o600);
   try{await fd.writeFile(body);await fd.sync();}finally{await fd.close();}
   try{await link(stage,prepared);}catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await readFile(prepared),body,'Another complete result is already retained.');}
   finally{await unlink(stage).catch(()=>{});}
   await syncDirectory();
  }
  try{await link(prepared,resultPath);}catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await readFile(resultPath),body,'Preserve the existing original result.');}
  await syncDirectory();return complete;
 }

 function finishedResult(){
  const cold=mode==='portfolio-cold',last=cold?'portfolio-cold-original-case-and-copy':'portfolio-saved-download-archive-restore-and-reopen';
  const required=cold?[last]:['portfolio-original-source-and-first-images','portfolio-unfinished-form-and-cold-desk-recovery','portfolio-checkpoint-fork-complete-source-receive','portfolio-two-window-current-memory-recovery','portfolio-native-preview','portfolio-original-native-save-after-lost-response',last];
  if(!required.every(id=>progress.phases[id]?.complete))return null;
  if(cold&&!progress.files['portfolio-cold-working-copy.json'])return null;
  const common={schema:'stellar-forge.portfolio-working-copy-browser.v1',operationId:input.operationId,caseId:input.caseId,mode:cold?'cold':'operate',completedAt:progress.phases[last].completedAt,phases:progress.phases,files:progress.files,visualReview:progress.visualReview,receivingBinding:binding};
  if(cold)return common;
  const saved=progress.phases['portfolio-original-native-save-after-lost-response'].result;
  assert.ok(progress.portfolioBinding,'Retain the original allocation source binding.');
  return {...common,selectedCopyId:saved.copyId,savedPortfolioId:saved.portfolioId,savedPortfolioSha256:saved.sha256,sourcePortfolioId:progress.portfolioBinding.portfolioId,sourcePortfolioSha256:progress.portfolioBinding.portfolioSha256};
 }

 const prior=await readJSON(resultPath);
 if(prior)return verifyCompleted(prior);
 const prepared=await readJSON(resultPath+'.complete.json');
 if(prepared){await verifyCompleted(prepared);return publishCompleted(prepared);}
 if(progress.completedResult){await verifyCompleted(progress.completedResult);return publishCompleted(progress.completedResult);}
 const finished=finishedResult();if(finished){await verifyCompleted(finished);progress.completedResult=finished;await saveProgress();return publishCompleted(finished);}
 await saveProgress();
 async function phase(id,work){
  if(progress.phases[id]?.complete)return progress.phases[id].result;
  progress.currentPhase=id;progress.phases[id]={...progress.phases[id],startedAt:progress.phases[id]?.startedAt||new Date().toISOString(),complete:false};await saveProgress();
  const result=await work();progress.phases[id]={...progress.phases[id],complete:true,completedAt:new Date().toISOString(),result};await saveProgress();return result;
 }
 async function screenshot(filename,viewport={width:1440,height:1000}){
  const path=join(out,filename);assert.equal(dirname(path),out);
  if(progress.visualReview[filename]){const actual=await identity(path),prior=progress.visualReview[filename];assert.equal(actual.sha256,prior.sha256);assert.equal(actual.bytes,prior.bytes);return actual;}
  await page.setViewportSize(viewport);await page.screenshot({path,fullPage:true});const file=await identity(path);
  progress.visualReview[filename]={filename,bytes:file.bytes,sha256:file.sha256,viewport,stage:'CAPTURED_FOR_INTERNAL_REVIEW'};await saveProgress();return file;
 }
 const handleDialog=dialog=>dialog.accept().catch(()=>{});
 page.on('dialog',handleDialog);
 try{
  const result=await operatePortfolioWorkingCopies({page,browser:context,input:{...input,baseUrl:base.origin},out,progress,phase,saveProgress,native,screenshot,atomic,fileIdentity:identity,mode});
  const complete=finishedResult();assert.ok(complete,'Retain all completed original course phases and exports before publication.');
  assert.equal(complete.operationId,result.operationId);assert.equal(complete.caseId,result.caseId);
  progress.completedResult=complete;await saveProgress();
  return publishCompleted(complete);
 }catch(error){
  progress.interruption={at:new Date().toISOString(),phase:progress.currentPhase||null,message:String(error.message||error).split(input.ownerKey).join('[private]')};
  try{await saveProgress();}catch{}
  throw error;
 }finally{page.off('dialog',handleDialog);}
}
export function receivePortfolioWorkingCopies(args){return run(args,'portfolio');}
export function inspectPortfolioWorkingCopies(args){return run(args,'portfolio-cold');}
