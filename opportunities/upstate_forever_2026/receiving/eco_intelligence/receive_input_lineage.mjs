/** Operate the exact retained input lineage in the original authenticated Page.
 * The equipped owner supplies its current page/API and retains the browser lock.
 */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
async function fileIdentity(file){const h=createHash('sha256');let bytes=0;for await(const b of createReadStream(file)){h.update(b);bytes+=b.length;}return {bytes,sha256:h.digest('hex')};}
async function atomic(file,body,{immutable=false}={}){
 await fs.mkdir(path.dirname(file),{recursive:true});
 if(immutable){try{requireValue((await fs.readFile(file)).equals(body),'Retained receiving bytes changed: '+file);return;}catch(error){if(error.code!=='ENOENT')throw error;}}
 const temporary=file+'.pending-'+randomUUID();let stream;
 try{stream=await fs.open(temporary,'wx',0o600);await stream.writeFile(body);await stream.sync();await stream.close();stream=null;
  if(immutable)await fs.link(temporary,file);else await fs.rename(temporary,file);
  const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
 }finally{if(stream)await stream.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}

export async function receiveInputLineage(page,{api,workspaceKey,receiving,outputDirectory,ownerCheck}){
 requireValue(typeof api==='function'&&typeof ownerCheck==='function','Use the original authenticated API and equipped owner check.');
 requireValue(receiving?.schema==='upstate.input-lineage-receiving/v1'&&receiving.state==='COMPLETE'&&receiving.workspace_key===workspaceKey,
  'Receive the completed native lineage in its original workspace.');
 const output=path.resolve(outputDirectory);await fs.mkdir(output,{recursive:true});
 const identity={schema:'upstate.input-lineage-browser-receiving/v1',
  operation:receiving.operation,project_id:receiving.project_id,workspace_key:workspaceKey,
  selection:receiving.selection,lineage_sha256:receiving.lineage_sha256,
  original_collection:receiving.original_collection,receiving_sha256:hash(json(receiving))};
 const statePath=path.join(output,'browser-state.json');let state=await read(statePath);
 if(state)requireValue(stable(state.identity)===stable(identity),'Continue the original selected input/browser edition.');
 else{requireValue((await fs.readdir(output)).length===0,'Select an empty receiving directory.');
  state={identity,files:{},phases:{},state:'RUNNING',started_at:new Date().toISOString()};await atomic(statePath,json(state));}
 const save=()=>atomic(statePath,json(state));
 const keep=async(name,body)=>{await atomic(path.join(output,name),body,{immutable:true});state.files[name]=await fileIdentity(path.join(output,name));await save();};
 for(const [name,expected]of Object.entries(state.files))requireValue(stable(await fileIdentity(path.join(output,name)))===stable(expected),'A retained receiving output changed: '+name);
 if(state.state==='COMPLETE')return state;
 await ownerCheck();
 const endpoint=(name,values={})=>'/api/intelligence/'+name+'?'+new URLSearchParams(Object.entries({workspace:workspaceKey,...values}).filter(([,v])=>v!=null));
 const graph=await api(endpoint('lineage',{...receiving.selection,lineage_sha256:receiving.lineage_sha256}));
 requireValue(graph.lineage_sha256===receiving.lineage_sha256&&graph.export_complete,'The current native source differs from completed receiving.');
 await keep('lineage.json',json(graph));
 const viewport=page.viewportSize();
 const capture=async name=>{
  if(state.files[name])return;
  await ownerCheck();await keep(name,await page.screenshot({fullPage:true}));
 };
 const download=async(locator,name,expected)=>{
  if(state.files[name]){requireValue(stable(state.files[name])===stable({bytes:expected.bytes,sha256:expected.sha256}),'The download selection changed.');return;}
  await ownerCheck();const pending=page.waitForEvent('download');await locator.click();const received=await pending;
  const temporary=path.join(output,'.download-'+randomUUID());await received.saveAs(temporary);
  try{const actual=await fileIdentity(temporary);requireValue(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'Actual downloaded bytes differ from original identity: '+name);
   try{await fs.link(temporary,path.join(output,name));}catch(error){if(error.code!=='EEXIST')throw error;requireValue(stable(await fileIdentity(path.join(output,name)))===stable(actual),'Existing download differs.');}
   state.files[name]=actual;await save();
  }finally{await fs.unlink(temporary);}
 };
 const owner=async()=>{await ownerCheck();requireValue((await page.locator('[data-intelligence-lineage]').count())===1,'Keep the original Investigations page open.');};
 const opened=async()=>page.waitForFunction(sha=>document.querySelector('[data-intelligence-lineage]')?.dataset.lineageSha===sha,graph.lineage_sha256);
 try{
  await page.locator('[data-view="investigations"]').first().click();
  await page.locator('[data-intelligence-lineage]').waitFor();
  await page.getByRole('tab',{name:'Data analysis',exact:true}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-intelligence-field="sessions"]').selectOption(receiving.original_collection.session_id);
  const selected=receiving.selection.run_id?{kind:'job',id:receiving.selection.run_id}:{kind:'dataset',id:graph.prepared_files.find(row=>row.ref)?.ref.id};
  requireValue(selected.id,'The selected grid has no original prepared member.');
  await page.locator('[data-resource-kind="'+selected.kind+'"][data-resource-id="'+selected.id+'"]').click();
  await page.locator('.intelligence-lineage-open').click();await opened();await owner();
  await page.locator('[data-lineage-field="filter"]').fill('');
  const edges=await page.locator('[data-lineage-dependency]').evaluateAll(nodes=>nodes.map(n=>n.dataset.lineageDependency));
  requireValue(stable(edges)===stable(graph.dependencies.map(row=>row.id)),'The UI changed native dependency order or membership.');
  await capture('lineage-desktop.png');
  for(const [index,source]of graph.sources.entries()){
   await owner();
   await page.locator('[data-lineage-source="'+source.key+'"] [data-lineage-action="open-source"]').click();
   await page.waitForFunction(key=>{
    const section=document.querySelector('[data-lineage-detail]');
    return section?.dataset.lineageDetailSource===key;
   },source.key);
   const detail=await api(endpoint('lineage-source',{...graph.selected,lineage_sha256:graph.lineage_sha256,collection_id:source.collection_id,source_id:source.id}));
   for(const [memberIndex,file]of detail.source.files.entries()){
    const container=page.locator('[data-lineage-detail] .intelligence-retained-source').nth(memberIndex);
    requireValue((await container.innerText()).includes(file.member),'The original companion order/member changed.');
    await download(container.locator('a'),'source-'+index+'-'+memberIndex+'-'+path.basename(file.member),file);
   }
   if(detail.original_manifest)await download(page.locator('[data-lineage-detail]').getByRole('link',{name:'Download complete original collection manifest'}),
     'source-'+index+'-manifest.json',detail.original_manifest);
   if(index===0)await capture('lineage-source-desktop.png');
  }
  state.phases.originals={source_count:graph.sources.length,verified_members:receiving.source_members.length};await save();
  await owner();await page.setViewportSize({width:390,height:844});await capture('lineage-narrow.png');
  const first=graph.sources[0];
  if(first){await page.locator('[data-lineage-field="filter"]').fill(first.collection_id);
   requireValue((await page.locator('[data-lineage-source]').count())===graph.sources.filter(s=>s.collection_id===first.collection_id).length,
    'Collection-edition filtering lost a full source pair.');
   await capture('lineage-filter-narrow.png');await page.locator('[data-lineage-field="filter"]').fill('');}
  await page.locator('[data-lineage-action="select-all"]').click();
  const selectedRefs=await page.evaluate(w=>JSON.parse(sessionStorage.getItem('upstate-intelligence:'+w)||'{}').sourceSelection||[],workspaceKey);
  for(const ref of graph.original_refs)requireValue(selectedRefs.some(item=>stable(item)===stable(ref)),'An original source/companion was omitted from the existing collection selection.');
  await page.getByRole('tab',{name:'Source collections',exact:true}).click();
  const collection=page.locator('[data-collection-id="'+receiving.original_collection.collection_id+'"]');
  const reopen=collection.getByRole('button',{name:'Reopen source collection'});if(await reopen.count())await reopen.click();
  await collection.getByRole('link',{name:'Download original files and collection'}).waitFor();
  await download(collection.getByRole('link',{name:'Download original files and collection'}),'original-source-collection.zip',receiving.original_collection.zip);
  await capture('portable-collection-narrow.png');
  // A real page reload reads the persisted exact original lineage selection.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-view="investigations"]').first().click();
  await page.getByRole('tab',{name:'Data analysis',exact:true}).click();await opened();
  await page.locator('[data-lineage-action="reopen"]').click();await opened();
  await capture('lineage-cold-reopen.png');
  state.phases.cold_reopen={lineage_sha256:graph.lineage_sha256,collection_id:receiving.original_collection.collection_id};
  state.state='COMPLETE';state.completed_at=new Date().toISOString();
  state.visual_review='The producing operator must open and LOOK at every saved PNG and the downloaded complete collection before declaring ready.';
  await save();return state;
 }catch(error){state.last_error={message:error.message,at:new Date().toISOString()};await save();throw error;}
 finally{if(viewport){await ownerCheck();await page.setViewportSize(viewport);}}
}
