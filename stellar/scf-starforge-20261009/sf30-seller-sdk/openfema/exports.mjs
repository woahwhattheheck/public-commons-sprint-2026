// MIT. Complete original workspace transfer and standalone portfolio reports.
import {readdir,lstat,mkdir,rename,rm,readFile} from 'node:fs/promises';
import {join,resolve,dirname,relative,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {stable,jsonBytes,readOwned,writeNew,privateDirectory,syncDir,openWorkspaceStore} from '../stellar-expert/store.mjs';
import {WORKSPACE_SCHEMA} from './schema.mjs';
import {TABLE_COLUMNS,displayRow,formatMinor,fault} from './domain.mjs';
import {zipEntries,readZip,archivePath} from './zip.mjs';
import {restoreNativePublishers} from './relocation.mjs';
const TRANSFER='stellar-forge.openfema-workspace-transfer.v1';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=value=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase());
const money=value=>'USD '+formatMinor(value);
export function portfolioReport(portfolio,version){
  const summary=portfolio.summary;
  const metrics=[['Disasters',summary.disasters],['Applicants',summary.applicants],['Selected projects',summary.selectedProjects],['Included projects',summary.includedProjects],['Project cost',money(summary.projectCostMinor)],['Federal obligations',money(summary.federalObligatedMinor)],['Total obligations',money(summary.totalObligatedMinor)],['Mitigation',money(summary.mitigationMinor)]];
  const table=(name,columns)=>'<section><h2>'+escape(label(name))+'</h2><p>'+portfolio[name].length+' retained records</p><div class="table"><table><thead><tr>'+columns.map(c=>'<th>'+escape(label(c))+'</th>').join('')+'</tr></thead><tbody>'+portfolio[name].map(input=>{const row=displayRow(input);return '<tr>'+columns.map(c=>'<td>'+escape(typeof row[c]==='object'?JSON.stringify(row[c]):row[c])+'</td>').join('')+'</tr>';}).join('')+'</tbody></table></div></section>';
  const reviews=portfolio.annotations.map(r=>'<tr><td>'+escape(r.subject)+'</td><td>'+escape(r.status)+'</td><td>'+escape(r.disposition)+'</td><td>'+escape(r.owner)+'</td><td>'+escape(r.dueDate)+'</td><td>'+escape(r.note)+'</td></tr>').join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(portfolio.criteria.name)+' — OpenFEMA portfolio</title><style>body{margin:0;color:#181818;background:#fff;font:14px/1.55 system-ui,sans-serif}main{max-width:1480px;margin:0 auto;padding:36px}h1{font-size:28px;line-height:1.2}h2{font-size:20px;margin-top:32px}p{max-width:1100px}.eyebrow,small{color:#555}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.metric{border:1px solid #bbb;padding:16px}.metric strong{display:block;font:600 21px/1.3 ui-monospace,monospace;overflow-wrap:anywhere}.metric span{font-size:12px;color:#444}.table{overflow:auto;border:1px solid #bbb}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:8px 10px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top;max-width:520px;overflow-wrap:anywhere}th{background:#eee;white-space:nowrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f4f4f4;border:1px solid #ccc;font-size:12px}a{color:inherit}@media(max-width:700px){main{padding:20px}.metrics{grid-template-columns:repeat(2,1fr)}}@media print{main{padding:0;max-width:none}.table{overflow:visible}table{font-size:8px}th,td{padding:4px}section{break-inside:auto}.metric{break-inside:avoid}}</style><main><p class="eyebrow">PUBLIC ASSISTANCE · RETAINED PORTFOLIO</p><h1>'+escape(portfolio.criteria.name)+'</h1><p>'+escape(portfolio.criteria.note)+'</p><p>Version '+escape(version.number)+' · source completed '+escape(portfolio.sourceCompletedAt)+' · USD</p><div class="metrics">'+metrics.map(([k,v])=>'<div class="metric"><span>'+escape(k)+'</span><strong>'+escape(v)+'</strong></div>').join('')+'</div><section><h2>Scope and interpretation</h2>'+Object.values(portfolio.methodology).map(x=>'<p>'+escape(x)+'</p>').join('')+'<p>'+summary.excludedProjects+' projects excluded by recorded review; '+summary.conflictingProjects+' conflicting project identities. Missing amount counts: project cost '+summary.missingProjectCosts+', federal '+summary.missingFederalAmounts+', total '+summary.missingTotalAmounts+', mitigation '+summary.missingMitigationAmounts+'.</p><pre>'+escape(JSON.stringify({criteria:portfolio.criteria,sourceScope:portfolio.sourceScope},null,2))+'</pre><p>Source: <a href="https://www.fema.gov/about/openfema/data-sets">FEMA OpenFEMA datasets</a>. Projects use PublicAssistanceFundedProjectsDetails v2; applicants v1; declarations v2. Original page bytes, field definitions and refresh observations accompany the complete source package.</p></section>'+table('disasters',TABLE_COLUMNS.disasters)+table('applicants',TABLE_COLUMNS.applicants)+table('categories',TABLE_COLUMNS.categories)+table('projects',TABLE_COLUMNS.projects)+table('declarations',TABLE_COLUMNS.declarations)+table('issues',TABLE_COLUMNS.issues)+'<section><h2>Analyst decisions</h2><div class="table"><table><thead><tr><th>Subject</th><th>Status</th><th>Treatment</th><th>Owner</th><th>Due</th><th>Decision</th></tr></thead><tbody>'+reviews+'</tbody></table></div></section><section><h2>Retained identities</h2><pre>'+escape(JSON.stringify({portfolioVersion:version,sourceEditionId:portfolio.editionId,sourceSha256:portfolio.sourceSha256},null,2))+'</pre></section></main></html>';
}
const transient=(name)=>name==='workspace.lock'||name.endsWith('.lock')||name.endsWith('.sock')||name.endsWith('.pid')||name.endsWith('.tmp');
async function inventory(root){
  const records=[];
  async function visit(directory){
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(transient(entry.name))continue;
      const path=join(directory,entry.name),name=relative(root,path).split(sep).join('/'),stat=await lstat(path);
      if(stat.isSocket())continue;
      if(entry.isDirectory()){await privateDirectory(path);await visit(path);continue;}
      if(!entry.isFile()||stat.isSymbolicLink())throw fault('OPENFEMA_TRANSFER_FILE','Retain regular original workspace files for handover.');
      const bytes=await readOwned(path,256*1024*1024);
      records.push({path:archivePath(name),bytes,sha256:digest(bytes)});
    }
  }
  await visit(root);return records;
}
export async function workspaceArchive(store){
  const before=store.read(),records=await inventory(store.root),after=store.read();
  if(before.revision!==after.revision)throw fault('OPENFEMA_TRANSFER_CHANGED','The workspace advanced while its archive was being assembled. Export its current state.',409);
  const current=JSON.parse(records.find(x=>x.path==='workspace.json')?.bytes.toString('utf8')??'null');
  if(current?.workspaceId!==before.workspaceId||current.revision!==before.revision)throw fault('OPENFEMA_TRANSFER_CHANGED','The original workspace state changed.',409);
  const manifest={schema:TRANSFER,workspaceSchema:WORKSPACE_SCHEMA,workspaceId:before.workspaceId,revision:before.revision,originalDirectory:store.root,createdAt:new Date().toISOString(),files:records.map(({path,bytes,sha256})=>({path,bytes:bytes.length,sha256})),
    receiving:{command:'openfema restore --archive FILE --workspace NEW_ABSOLUTE_PRIVATE_DIRECTORY',nativePublication:'Original native publisher, release, customer and source files are included. Restore adopts the original dataset publisher at its new location and stages corresponding releases with that location. Select a restored release to activate it; prior releases and their selection history remain intact.',inbox:'Customer bytes remain readable offline. Select the original customer inbox when continuing an acquisition.'}};
  const readme='# OpenFEMA complete workspace\n\nThis archive contains every retained source page, metadata and field dictionary, source edition, portfolio version, analyst decision, dataset, original publisher, release package, and received customer file.\n\nRestore into a NEW private directory with the original installed command:\n\n    openfema restore --archive OpenFEMA_Complete_Workspace.zip --workspace /absolute/private/new-workspace\n\nOpen the returned workspace with openfema-workspace. The operator preserves the original workspace identity and its source history. Native draft stores are adopted through their maintained recovery API when the directory changes. Each retained release is staged again with its original dataset, source, payment terms and runtime at the restored location. Select the restored release in Publication to activate it. Historical releases and selection history remain intact. If receiving was interrupted, repeat the same restore command with this exact archive and directory to continue.\n\nOpenFEMA_Workspace_Manifest.json lists the exact SHA-256 and length of every original file. Runtime locks and process sockets are re-created by the original engines.\n';
  return {name:'OpenFEMA_Complete_Workspace.zip',type:'application/zip',manifest,bytes:zipEntries([{path:'OpenFEMA_Workspace_Manifest.json',bytes:jsonBytes(manifest)},{path:'START_HERE.md',text:readme},...records.map(r=>({path:'workspace/'+r.path,bytes:r.bytes}))])};
}
export function inspectWorkspaceArchive(bytes){
  const entries=readZip(bytes),manifestBytes=entries.get('OpenFEMA_Workspace_Manifest.json');
  if(!manifestBytes)throw fault('OPENFEMA_TRANSFER_MANIFEST','Choose a complete OpenFEMA workspace archive.');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  if(manifest.schema!==TRANSFER||manifest.workspaceSchema!==WORKSPACE_SCHEMA||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>65000||typeof manifest.originalDirectory!=='string'||!manifest.originalDirectory.startsWith('/'))throw fault('OPENFEMA_TRANSFER_MANIFEST','This archive has another workspace contract.');
  const paths=new Set();
  for(const entry of manifest.files){
    const path=archivePath(entry.path),body=entries.get('workspace/'+path);
    if(paths.has(path)||!body||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes!==body.length||!/^[a-f0-9]{64}$/.test(entry.sha256??'')||digest(body)!==entry.sha256)throw fault('OPENFEMA_TRANSFER_CONTENT','The original workspace file inventory differs.',409);
    paths.add(path);
  }
  if([...entries.keys()].some(x=>x.startsWith('workspace/')&&!paths.has(x.slice(10))))throw fault('OPENFEMA_TRANSFER_CONTENT','The archive contains a workspace file outside its retained inventory.');
  const state=JSON.parse(entries.get('workspace/workspace.json')?.toString('utf8')??'null');
  if(state?.schema!==WORKSPACE_SCHEMA||state.workspaceId!==manifest.workspaceId||state.revision!==manifest.revision)throw fault('OPENFEMA_TRANSFER_IDENTITY','The original workspace identity differs from its manifest.',409);
  return {manifest,manifestSha256:digest(manifestBytes),archiveSha256:digest(bytes),state,entries};
}
async function absent(path){try{await lstat(path);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
export async function restoreWorkspaceArchive({bytes,directory}={}){
  const transfer=inspectWorkspaceArchive(bytes),target=resolve(directory??'');
  if(typeof directory!=='string'||!directory.startsWith('/')||target!==directory||target==='/'||target.includes('\0')||target===transfer.manifest.originalDirectory)throw fault('OPENFEMA_RESTORE_TARGET','Choose a distinct absolute private directory for this complete workspace.');
  await privateDirectory(dirname(target));
  const plan={schema:'stellar-forge.openfema-workspace-relocation.v1',sourceManifestSha256:transfer.manifestSha256,archiveSha256:transfer.archiveSha256,workspaceId:transfer.manifest.workspaceId,from:transfer.manifest.originalDirectory,to:target};
  const journalName='receiving-'+transfer.archiveSha256+'.json';
  let staging=null,moved=false,store;
  try{
    if(await absent(target)){
      staging=join(dirname(target),'.openfema-receiving-'+randomUUID());
      await mkdir(staging,{mode:0o700});
      for(const entry of transfer.manifest.files){
        const destination=join(staging,entry.path);
        await mkdir(dirname(destination),{recursive:true,mode:0o700});
        await writeNew(destination,transfer.entries.get('workspace/'+entry.path));
      }
      await writeNew(join(staging,journalName),jsonBytes({...plan,receivedAt:new Date().toISOString()}));
      await syncDir(staging);
      await rename(staging,target);moved=true;await syncDir(dirname(target));
    }else{
      await privateDirectory(target);
      let journal;
      try{journal=JSON.parse((await readOwned(join(target,journalName),262144)).toString('utf8'));}
      catch(error){if(error.code==='ENOENT')throw fault('OPENFEMA_RESTORE_TARGET','This directory belongs to another operation. Use a new directory or the exact archive originally received here.',409);throw error;}
      if(Object.entries(plan).some(([key,value])=>journal[key]!==value))throw fault('OPENFEMA_RESTORE_IDENTITY','Continue with this directory’s original archive and receiving identity.',409);
      moved=true;
    }
    // The kernel workspace lease covers every native adoption and the single
    // additive index commit, including resumption after an interrupted receive.
    store=await openWorkspaceStore(target,{schema:WORKSPACE_SCHEMA});
    const current=store.read(),completed=current.restoredFrom;
    if(current.workspaceId!==plan.workspaceId)throw fault('OPENFEMA_RESTORE_IDENTITY','The receiving directory belongs to another workspace.',409);
    if(completed?.archiveSha256===plan.archiveSha256&&completed.to===target&&completed.sourceManifestSha256===plan.sourceManifestSha256&&completed.complete===true)
      return {...completed.receiving,reused:true,currentRevision:current.revision};
    if(stable(current)!==stable(transfer.state))throw fault('OPENFEMA_RESTORE_CHANGED','The receiving workspace changed before its original restore completed. Reopen its original receiving operation.',409);
    const sourceFiles=new Map(transfer.manifest.files.map(entry=>[entry.path,transfer.entries.get('workspace/'+entry.path)]));
    const native=await restoreNativePublishers({directory:target,originalDirectory:transfer.manifest.originalDirectory,workspaceId:plan.workspaceId,archiveSha256:plan.archiveSha256,manifestSha256:plan.sourceManifestSha256,sourceFiles});
    const receivedAt=new Date().toISOString(),result={...plan,directory:target,files:transfer.manifest.files.length,receivedAt,
      nativePublisherRelocations:native.publisherRelocations.length,restagedReleases:native.releases.length,
      nativeRestorationPlanSha256:native.planSha256,releaseMappings:native.releaseMappings,workspaceId:plan.workspaceId};
    await store.mutate(s=>{
      for(const release of native.releases){
        const existing=s.releases.find(r=>r.id===release.id);
        if(existing&&stable(existing)!==stable(release))throw fault('OPENFEMA_RESTORE_RELEASE_CHANGED','The restored release identity belongs to different inputs.',409);
        if(!existing)s.releases.push(release);
      }
      if(s.restoredFrom){
        s.restorationHistory??=[];
        if(!s.restorationHistory.some(r=>r.archiveSha256===s.restoredFrom.archiveSha256&&r.to===s.restoredFrom.to))s.restorationHistory.push(s.restoredFrom);
      }
      s.restoredFrom={...plan,complete:true,receivedAt,nativePublisherRelocations:native.publisherRelocations.length,
        nativeRestorationPlanSha256:native.planSha256,releaseMappings:native.releaseMappings,
        publisherRelocations:native.publisherRelocations,selections:native.selections??[],receiving:result};
    });
    return {...result,reused:false,currentRevision:store.read().revision};
  }catch(error){
    if(!moved&&staging)await rm(staging,{recursive:true,force:true});
    else if(moved)error.receivingDirectory=target;
    throw error;
  }finally{await store?.close();}
}
