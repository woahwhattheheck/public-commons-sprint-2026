// MIT. Retained source reviews on the original API merchant and refresh engines.
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, mkdir, open } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewSourceRefresh, requireSourceRefresh, sourceChanges } from '../source-refresh.mjs';
import { readPackage, savePackage, privateParent, packageName } from './model.mjs';

export const REVISION_SCHEMA = 'stellar-forge.api-merchant-revision.v1';
const DRAFT_SCHEMA = 'stellar-forge.api-merchant-revision-draft.v1';
const LIMIT = 6 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value,null,2)+'\n';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value,key) => Object.hasOwn(value,key);
const canonical = value => JSON.stringify(value,(_,item)=>plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
const fail = message => {throw new TypeError(message);};
const keyOf = row => row.method.toUpperCase()+' '+row.path;
const routeOf = key => {const space=key.indexOf(' ');return {method:key.slice(0,space),path:key.slice(space+1)};};
const shell = value => "'"+String(value).replaceAll("'","'\\''")+"'";
const sourceRoot = fileURLToPath(new URL('../../',import.meta.url));
function exact(value,keys,label) {
  if(!plain(value)||Object.keys(value).some(key=>!keys.includes(key)))fail('Unexpected '+label+' fields');
}
function settingsOf(row) {
  const settings=structuredClone(row);
  for(const key of ['id','method','path'])delete settings[key];
  return settings;
}
async function basePackage(parent,name) {
  const project=await readPackage(parent,name);
  const bytes=await readFile(join(project.folder,'merchant-package.json'));
  if(canonical(JSON.parse(bytes))!==canonical(project.manifest))fail('Base package changed while reading. Reopen it.');
  return {...project,pins:{name:project.name,id:project.manifest.id,manifestSha256:sha(bytes),
    sourceSha256:sha(project.specText),planSha256:sha(json(project.plan))}};
}
/** Translate UI decisions without another operation matcher or setting allowlist. */
async function context({parent,baseName,specText,decisions=[],additions=[]}) {
  const base=await basePackage(parent,baseName);
  if(!Array.isArray(decisions)||decisions.length>64)fail('Choose at most 64 existing route decisions');
  const ids=base.manifest.preview.routes.map(row=>row.id), known=new Set(ids), selected=new Map();
  if(ids.length!==base.plan.operations.length||known.size!==ids.length)fail('Saved route identities do not match the original package');
  for(const row of decisions) {
    exact(row,['routeId','action','method','path','settings'],'revision decision');
    if(!known.has(row.routeId)||selected.has(row.routeId)||!['keep','remap','drop'].includes(row.action))
      fail('Choose one keep, remap or drop decision for an existing route ID');
    if(row.action!=='remap'&&(row.method!==undefined||row.path!==undefined))fail('Only remap accepts a replacement method and path');
    if(row.action==='drop'&&row.settings!==undefined)fail('A dropped route has no replacement settings');
    if(row.settings!==undefined&&(!plain(row.settings)||['method','path','id'].some(key=>own(row.settings,key))))
      fail('Settings exclude the retained route ID, method and path');
    if(row.action==='remap'&&(typeof row.method!=='string'||typeof row.path!=='string'))fail('Choose the exact replacement operation');
    selected.set(row.routeId,structuredClone(row));
  }
  const mappings=[];
  base.plan.operations.forEach((original,index)=>{
    const row=selected.get(ids[index]);if(!row)return;
    const from=keyOf(original);
    if(row.action==='drop'){mappings.push({from,to:null});return;}
    const originalSettings=settingsOf(original), settings=row.settings??originalSettings;
    if(settings.amountAtomic!==original.amountAtomic)
      fail('Source refresh retains the existing atomic price. Change commercial terms in the original merchant configuration.');
    const patch=Object.fromEntries(Object.entries(settings).filter(([key,value])=>
      key!=='amountAtomic'&&canonical(value)!==canonical(originalSettings[key])));
    const unset=Object.keys(originalSettings).filter(key=>key!=='amountAtomic'&&!own(settings,key));
    mappings.push({from,to:row.action==='remap'?keyOf(row):from,
      ...(Object.keys(patch).length?{settings:patch}:{}),...(unset.length?{unset}:{})});
  });
  return {base,ids,selected,input:{baseline:{specText:base.specText,plan:base.plan},
    candidateSpecText:specText,decisions:{mappings,additions}}};
}
function displayedChanges(changes) {
  return {count:changes.length,truncated:changes.length>120,items:changes.slice(0,120).map(row=>({
    path:row.pointer||'/',before:own(row,'before')?{value:row.before}:{absent:true},
    after:own(row,'after')?{value:row.after}:{absent:true}}))};
}
function view(ctx,shared) {
  const routes=shared.operations.filter(row=>row.from!==null).map((entry,index)=>{
    if(entry.id!==ctx.ids[index])fail('Saved route identities differ from the original compiler. Reopen the package.');
    const decision=ctx.selected.get(entry.id), original=ctx.base.plan.operations[index];
    const settings=decision?.settings??settingsOf(original);
    return {routeId:entry.id,from:routeOf(entry.from),to:entry.to===null?null:routeOf(entry.to),
      action:decision?.action??'pending',changed:entry.state!=='UNCHANGED',
      changes:displayedChanges(entry.changes),
      settingChanges:displayedChanges(sourceChanges(settingsOf(original),settings)),
      declarationPins:{before:sha(canonical(entry.before)),after:sha(canonical(entry.after))},
      settings,errors:shared.issues.filter(issue=>issue.from===entry.from).map(issue=>issue.message),
      suggestedTargets:(entry.suggestions??[]).map(routeOf)};
  });
  const catalog=new Map(shared.unselected.map(row=>[row.key,row]));
  for(const entry of shared.operations)if(entry.to&&entry.after)
    catalog.set(entry.to,{key:entry.to,supported:true,summary:entry.after.declaration.operation.summary??''});
  const pending=routes.filter(row=>row.action==='pending').map(row=>row.routeId);
  const result={schema:REVISION_SCHEMA,base:ctx.base.pins,refreshReviewId:shared.reviewId,
    sourceSha256:shared.candidate.sourceSha256,sourceChanged:shared.baseline.sourceSha256!==shared.candidate.sourceSha256,
    routes,operations:[...catalog.values()].map(row=>({...routeOf(row.key),supported:row.supported,summary:row.summary})),
    additions:structuredClone(shared.decisions.additions),plan:shared.plan,preview:shared.preview,
    compilationError:shared.issues.length?shared.issues.map(row=>row.message).join('; '):null,
    pending,ready:shared.ready&&pending.length===0,unchangedSelected:routes.filter(row=>!row.changed).length,
    unselectedOperations:shared.unselected.length,sourceChanges:displayedChanges(shared.sourceChanges),
    compiledSha256:shared.ready?sha(canonical({plan:shared.plan,outputs:shared.operations.map(row=>row.after)})):null};
  result.reviewSha256=sha(canonical({schema:result.schema,base:result.base,refreshReviewId:result.refreshReviewId,pending}));
  return result;
}
async function withCurrentAuthorization(review,specText,validatePlan) {
  if(typeof validatePlan!=='function')return review;
  if(!review.plan)return {...review,authorization:{ready:false,code:'CANDIDATE_INCOMPLETE',
    message:'Complete the candidate settings before checking its current provider grants.'}};
  try {
    await validatePlan(specText,review.plan);
    return {...review,authorization:{ready:true}};
  } catch(error) {
    return {...review,ready:false,authorization:{ready:false,
      code:typeof error.code==='string'?error.code:'AUTHORIZATION_REVIEW_REQUIRED',
      message:String(error.message??'Review the current provider authorization before saving this candidate.')}};
  }
}
export async function reviewMerchantRevision(options) {
  const ctx=await context(options);
  return withCurrentAuthorization(view(ctx,reviewSourceRefresh(ctx.input)),options.specText,options.validatePlan);
}
/** Shared refresh guard + current saved manifest before original create-only export. */
export async function saveMerchantRevision(options) {
  const ctx=await context(options);
  const shared=requireSourceRefresh(ctx.input,options.expectedRefreshReviewId),review=view(ctx,shared);
  if(review.reviewSha256!==options.expectedReviewSha256) {
    const error=new Error('The original package or decisions changed. Review this candidate again.');error.status=409;throw error;
  }
  if(!review.ready)fail('Choose an explicit decision for every original route');
  if(options.name===options.baseName)fail('Save a revision under a new package name');
  if(typeof options.validatePlan==='function')await options.validatePlan(options.specText,review.plan);
  const sourceRevision={schema:REVISION_SCHEMA,reviewSha256:review.reviewSha256,refreshReviewId:review.refreshReviewId,base:review.base,
    candidate:{sourceSha256:sha(options.specText),planSha256:sha(json(review.plan)),compiledSha256:review.compiledSha256},
    decisions:review.routes.map(row=>({routeId:row.routeId,action:row.action,from:row.from,to:row.to,
      sourceChanges:{count:row.changes.count,...row.declarationPins},settingChanges:{count:row.settingChanges.count}})),
    additions:shared.operations.filter(row=>row.from===null&&row.to!==null).map(row=>({
      id:row.id,...routeOf(row.to),amountAtomic:review.plan.operations.find(operation=>keyOf(operation)===row.to).amountAtomic}))};
  const saved=await savePackage({parent:options.parent,name:options.name,specText:options.specText,plan:review.plan,sourceRevision});
  return {...saved,sourceRevision,release:releaseCommands(saved.folder,saved.name)};
}
export function releaseCommands(folder,name,store=resolve(folder,'..','merchant-releases')) {
  const cli=join(sourceRoot,'sf82-seller-pilot/release-cli.mjs');
  const command=args=>['node',cli,...args].map(shell).join(' ');
  return {store,init:command(['init','--store',store]),
    stage:command(['stage','--store',store,'--id',name,'--workspace',folder,'--port','0']),
    console:command(['console','--store',store,'--port','0'])};
}
export async function stageMerchantRevision({parent,name,store,id,createStore=false,validatePlan}) {
  if(typeof store!=='string'||!isAbsolute(store))fail('Select an absolute release store directory');
  if(typeof createStore!=='boolean')fail('Create-store selection must be boolean');
  id=packageName(id);
  const project=await readPackage(parent,name);
  if(!project.sourceRevision)fail('Select a saved revision candidate');
  if(typeof validatePlan==='function')await validatePlan(project.specText,project.plan);
  const original=await import('../../sf82-seller-pilot/releases.mjs');
  if(createStore)await original.initReleaseStore(store);
  const record=await original.stageRelease(store,{id,workspace:project.folder,runtime:{port:0}});
  return {record,release:releaseCommands(project.folder,id,resolve(store))};
}
async function draftDirectory(parent,create=false) {
  const directory=join(await privateParent(parent),'.contract-revisions');
  if(create)try{await mkdir(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  return privateParent(directory);
}
async function draftBytes(path) {
  const info=await lstat(path);
  if(!info.isFile()||info.size>LIMIT)fail('Expected a retained revision draft within 6 MiB');
  const bytes=await readFile(path);if(bytes.length>LIMIT)fail('Revision draft exceeds 6 MiB');return bytes;
}
export async function listMerchantRevisionDrafts(parent) {
  let directory;
  try{directory=await draftDirectory(parent);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  return (await readdir(directory,{withFileTypes:true})).filter(entry=>entry.isFile()&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/.test(entry.name))
    .map(entry=>entry.name.slice(0,-5)).sort().slice(0,200);
}
export async function saveMerchantRevisionDraft(options) {
  const review=await reviewMerchantRevision(options),name=packageName(options.name);
  const value={schema:DRAFT_SCHEMA,name,base:review.base,createdAt:new Date().toISOString(),
    specText:options.specText,decisions:options.decisions??[],additions:options.additions??[]};
  const bytes=Buffer.from(json(value));if(bytes.length>LIMIT)fail('Revision draft exceeds 6 MiB');
  const path=join(await draftDirectory(options.parent,true),name+'.json'),file=await open(path,'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  return {name,path,sha256:sha(bytes),review};
}
export async function readMerchantRevisionDraft(parent,name,{validatePlan}={}) {
  const bytes=await draftBytes(join(await draftDirectory(parent),packageName(name)+'.json')),value=JSON.parse(bytes);
  exact(value,['schema','name','base','createdAt','specText','decisions','additions'],'revision draft');
  if(value.schema!==DRAFT_SCHEMA||value.name!==name||!plain(value.base))fail('Invalid retained revision draft');
  const review=await reviewMerchantRevision({parent,baseName:value.base.name,specText:value.specText,decisions:value.decisions,additions:value.additions,validatePlan});
  if(canonical(review.base)!==canonical(value.base))fail('The draft base package changed. Reopen its original saved source before continuing.');
  return {...value,sha256:sha(bytes),review};
}
