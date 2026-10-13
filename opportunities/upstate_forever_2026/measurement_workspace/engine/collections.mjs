import {zipMembers} from './collection_zip.mjs';
/** Complete source-set receiving and revision-pinned editable study editions.
 * Original MeasurementWorkspace remains the only scientific data writer.
 * Incoming file bodies are supplied by the caller, never arbitrary server paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {MeasurementWorkspace} from './workspace.mjs';
import {calibrationExport, calibrationCSV} from './calibration.mjs';
import {hash, stable} from './normalise.mjs';
import {InputError} from './parse.mjs';

export const COLLECTION_FORMAT='upper-savannah-measurement-collection/v1';
const EDITION_FORMAT='upper-savannah-measurement-edition/v1';
const identifier=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value,null,2)+'\n';
function relative(value){
  if(typeof value!=='string'||!value||value.startsWith('/')||value.includes('\\')||value.split('/').some(p=>!p||p==='.'||p==='..'||p.includes(':')||/[\x00-\x1f\x7f]/.test(p)))throw new InputError('Choose a relative collection member name');
  return value;
}
function readJSON(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function retain(file,data){
  // Atomic exclusive publication. Concurrent equal writes and killed-process replay converge.
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(Buffer.from(data)))throw new InputError('A retained collection member differs: '+path.basename(file),409);return;}
  const temporary=file+'.'+randomUUID()+'.pending';
  try{
    const fd=fs.openSync(temporary,'wx');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    try{fs.linkSync(temporary,file);}catch(error){if(error.code!=='EEXIST'||!fs.readFileSync(file).equals(Buffer.from(data)))throw error;}
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function rootFor(workspace,id){if(!identifier(id))throw new InputError('Invalid collection identifier');return path.join(workspace.directory,'collections',id);}
function decode(file){
  if(typeof file.text==='string' && file.base64===undefined)return Buffer.from(file.text,'utf8');
  if(typeof file.base64==='string' && file.text===undefined && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))return Buffer.from(file.base64,'base64');
  throw new InputError('Each source must contain exactly one UTF-8 text or canonical base64 body');
}
function inputFor(file,data){return {kind:file.kind,label:file.label,text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data),mapping:file.mapping,contentSha:file.sha256,origin:file.origin};}
function prepare(workspace,input){
  if(input?.format!==COLLECTION_FORMAT||typeof input.title!=='string'||!input.title.trim()||!Array.isArray(input.files)||!input.files.length)throw new InputError('A collection requires its format, title and complete file list');
  const seen=new Set(),files=[];
  for(const item of input.files){
    if(!item||typeof item!=='object')throw new InputError('Invalid collection member');
    const name=relative(item.path),kind=item.kind;
    if(seen.has(name))throw new InputError('Duplicate collection member: '+name);seen.add(name);
    if(!['wqp','stations','usgs-daily','companion'].includes(kind))throw new InputError('Choose the interpretation for '+name);
    const data=decode(item),sha256=hash(data);
    if(!identifier(item.sha256)||item.sha256!==sha256)throw new InputError('Original source hash differs: '+name,409);
    const file={path:name,kind,sha256,bytes:data.length,label:typeof item.label==='string'&&item.label.trim()?item.label:name,mapping:item.mapping??{},origin:item.origin??{type:'collection-file'}};
    let preview=null;
    if(kind!=='companion'){
      preview=workspace.preview(inputFor(file,data));
      if(!preview.rows)throw new InputError('No importable rows in '+name+'; preserve it as a companion or correct its interpretation');
      file.mapping=preview.mapping;
      file.importId=hash(stable([kind,sha256,preview.mapping]));
    }
    files.push({file,data,preview});
  }
  const document={format:COLLECTION_FORMAT,title:input.title.trim(),files:files.map(x=>x.file)};
  return {id:hash(stable(document)),document,files};
}
export function previewCollection(workspace,input){
  const prepared=prepare(workspace,input);
  return {id:prepared.id,...prepared.document,inspection:prepared.files.map(({file,preview})=>({path:file.path,kind:file.kind,bytes:file.bytes,preview})),workspaceRevision:workspace.revision()};
}
export function receiveCollection(workspace,input){
  const prepared=prepare(workspace,input);
  if(input.expectedId!==undefined&&input.expectedId!==prepared.id)throw new InputError('Collection differs from its reviewed inspection',409);
  const root=rootFor(workspace,prepared.id);
  // Preview every source first; a bad final file cannot cause a half-imported first pass.
  retain(path.join(root,'collection.json'),json(prepared.document));
  for(const {file,data} of prepared.files)retain(path.join(root,'sources',file.path),data);
  const results=[];
  for(const {file,data} of prepared.files){
    if(file.kind==='companion'){results.push({path:file.path,kind:file.kind,sha256:file.sha256});continue;}
    const result=workspace.import(inputFor(file,data));
    if(result.id!==file.importId)throw new InputError('Native source identity changed during receiving',409);
    results.push({path:file.path,kind:file.kind,sha256:file.sha256,...result});
  }
  // Equal IDs replay their exact native imports after interruption or a lost response.
  retain(path.join(root,'complete.json'),json({id:prepared.id,files:prepared.document.files}));
  return {id:prepared.id,title:prepared.document.title,workspaceRevision:workspace.revision(),files:results};
}
export function listCollections(workspace){
  const root=path.join(workspace.directory,'collections');
  if(!fs.existsSync(root))return [];
  return fs.readdirSync(root).filter(identifier).sort().map(id=>{
    const dir=rootFor(workspace,id),document=readJSON(path.join(dir,'collection.json'));
    return {id,title:document.title,fileCount:document.files.length,complete:fs.existsSync(path.join(dir,'complete.json')),editions:fs.existsSync(path.join(dir,'editions'))?fs.readdirSync(path.join(dir,'editions')).filter(identifier).sort():[]};
  });
}
function verifyCollection(workspace,id){
  const root=rootFor(workspace,id),document=readJSON(path.join(root,'collection.json'));
  if(hash(stable(document))!==id||!fs.existsSync(path.join(root,'complete.json')))throw new InputError('Resume complete source collection receiving before publishing an edition',409);
  for(const file of document.files){
    const data=fs.readFileSync(path.join(root,'sources',relative(file.path)));
    if(hash(data)!==file.sha256)throw new InputError('Retained original changed: '+file.path,409);
    if(file.importId){const original=workspace.source(file.importId);if(original.sha!==file.sha256||hash(original.content)!==file.sha256)throw new InputError('Native original source changed: '+file.path,409);}
  }
  return {root,document};
}
function report(document,calibration,summary,sourceRevision){
  const records=[...calibration.accepted.map(r=>({...r,reasons:[]})),...calibration.excluded];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(document.title)}</title><style>body{font:14px system-ui;margin:32px;color:#222;background:#fafafa;line-height:1.5}h1{font-size:28px}table{border-collapse:collapse;min-width:720px;width:100%}th,td{padding:8px;border:1px solid #ccc;text-align:left;vertical-align:top}th{background:#eee}.scroll{overflow:auto}code{overflow-wrap:anywhere}a{color:inherit}li{margin:6px 0}</style><h1>${escape(document.title)}</h1><p>Saved source workspace revision ${sourceRevision}. ${summary.recordCount} complete records; ${calibration.counts.accepted} eligible measured inputs and ${calibration.counts.excluded} excluded inputs.</p><p>Eligibility identifies inputs available for explicit model binding. Source dates, fractions, censoring bounds, qualifiers and review history remain separate. No sampling times, drainage assignments, censored point values or annual loads are inferred.</p><p><a href="project.json">Complete editable project</a> · <a href="records.csv">All records CSV</a> · <a href="calibration.json">Complete reviewed input population</a> · <a href="calibration.csv">Eligible inputs CSV</a></p><h2>Original collection</h2><ul>${document.files.map(f=>`<li><a href="sources/${f.path.split('/').map(encodeURIComponent).join('/')}">${escape(f.path)}</a> — ${escape(f.kind)}, ${f.bytes} bytes<br><code>${f.sha256}</code></li>`).join('')}</ul><h2>All measured inputs and exclusions</h2><div class="scroll"><table><thead><tr><th>Record</th><th>Station / reach</th><th>Source date</th><th>Constituent</th><th>Value / bounds</th><th>Exclusion reasons</th></tr></thead><tbody>${records.map(r=>`<tr><td><code>${escape(r.id)}</code></td><td>${escape(r.stationId)}<br>${escape(r.reachId)}</td><td>${escape(r.sampledDate)}<br>${escape(r.sampledAt)}</td><td>${escape(r.parameter)}<br>${escape(r.fraction)} / ${escape(r.basis)}</td><td>${escape(r.value??'—')} ${escape(r.unit)}<br>bounds ${escape(r.lower??'—')} to ${escape(r.upper??'—')} (${escape(r.censor)})</td><td>${escape(r.reasons.join(', ')||'Eligible measured input')}</td></tr>`).join('')}</tbody></table></div></html>`;
}
export function publishCollection(workspace,id){
  const {root,document}=verifyCollection(workspace,id);
  // Snapshot once. All reports run against an independent original-engine receive,
  // not a moving sequence of live reads or another scientific implementation.
  const project=workspace.portable();
  const reachFile=path.join(workspace.directory,'reaches.json');
  const reaches=fs.existsSync(reachFile)?fs.readFileSync(reachFile):Buffer.from('[]');
  const editionId=hash(stable({collection:id,revision:project.revision,tables:project.tables,reaches:hash(reaches)}));
  const editions=path.join(root,'editions');fs.mkdirSync(editions,{recursive:true});
  const target=path.join(editions,editionId);
  if(fs.existsSync(path.join(target,'edition.json')))return readEdition(workspace,id,editionId);
  const temporary=fs.mkdtempSync(path.join(editions,'.build-'));
  const receiving=fs.mkdtempSync(path.join(os.tmpdir(),'measured-edition-'));
  let snapshot;
  try{
    fs.writeFileSync(path.join(receiving,'reaches.json'),reaches);
    snapshot=new MeasurementWorkspace(receiving);snapshot.receive(project);
    const calibration=calibrationExport(snapshot),summary=snapshot.summary();
    const outputs={'project.json':json(project),'collection.json':json(document),'native-reaches.json':reaches,'calibration.json':json(calibration),'analysis-context.json':json({format:'upper-savannah-measurement-analysis-context/v1',sourceWorkspaceRevision:project.revision,analysisWorkspaceRevision:calibration.workspaceRevision,sourceCollectionId:id}),'calibration.csv':calibrationCSV(calibration),'records.csv':snapshot.exportRecords(),'report.html':report(document,calibration,summary,project.revision),'RECEIVING.md':`# Complete editable measured study\n\nThe report opens offline as report.html. Retain the entire directory so its original-source links work.\n\nUsing the installed Measurements 1.1.0 engine:\n\n    node measurement_workspace/engine/cli.mjs receive --workspace /new/measurements --file project.json\n    node measurement_workspace/engine/cli.mjs collection-receive --workspace /new/measurements --manifest collection.json --source-root sources\n\nThe first command receives original records, imports, reviews, mappings, source choices and histories. The second restores the collection and companion originals, reusing the already received native import IDs. Both destinations are operator-selected; receive requires an empty measured workspace. Native-reaches.json retains the sender identifier edition; the receiving application's native domain binder reads its original retained Workspace source before new assignments or modeled use. Independent edits and new editions use the original commands and browser.\n`};
    const files=[];
    for(const file of document.files)outputs['sources/'+file.path]=fs.readFileSync(path.join(root,'sources',file.path));
    for(const [name,data] of Object.entries(outputs)){
      const p=path.join(temporary,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);
      files.push({path:name,bytes:Buffer.byteLength(data),sha256:hash(data)});
    }
    const result={format:EDITION_FORMAT,id:editionId,collectionId:id,workspaceRevision:project.revision,analysisWorkspaceRevision:calibration.workspaceRevision,counts:calibration.counts,recordCount:summary.recordCount,files};
    fs.writeFileSync(path.join(temporary,'edition.json'),json(result));
    try{fs.renameSync(temporary,target);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;}
    return readEdition(workspace,id,editionId);
  }finally{snapshot?.close();fs.rmSync(receiving,{recursive:true,force:true});fs.rmSync(temporary,{recursive:true,force:true});}
}
export function readEdition(workspace,collectionId,editionId){
  if(!identifier(editionId))throw new InputError('Invalid edition identifier');
  const root=path.join(rootFor(workspace,collectionId),'editions',editionId),result=readJSON(path.join(root,'edition.json'));
  if(result.id!==editionId||result.collectionId!==collectionId)throw new InputError('Edition identity differs',409);
  for(const file of result.files){const data=fs.readFileSync(path.join(root,relative(file.path)));if(data.length!==file.bytes||hash(data)!==file.sha256)throw new InputError('Edition member changed: '+file.path,409);}
  return result;
}
export function editionMember(workspace,collectionId,editionId,name){
  const edition=readEdition(workspace,collectionId,editionId);
  relative(name);
  if(name!=='edition.json'&&!edition.files.some(f=>f.path===name))throw new InputError('Unknown edition member',404);
  const file=path.join(rootFor(workspace,collectionId),'editions',editionId,name);
  return {name,data:fs.readFileSync(file),type:name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.csv')?'text/csv; charset=utf-8':name.endsWith('.json')?'application/json; charset=utf-8':'application/octet-stream'};
}
/** CLI-only filesystem intake: one caller-selected directory with containment checks. */
export function collectionFromFiles(manifest,sourceRoot){
  const root=fs.realpathSync(sourceRoot);
  return {...manifest,files:manifest.files.map(file=>{
    const name=relative(file.path),actual=fs.realpathSync(path.join(root,name));
    if(actual!==root&&!actual.startsWith(root+path.sep))throw new InputError('Source file escapes its selected directory');
    if(!fs.statSync(actual).isFile())throw new InputError('Source member is not a regular file');
    const data=fs.readFileSync(actual);
    return {...file,base64:data.toString('base64')};
  })};
}

export function editionBundle(workspace,collectionId,editionId){
  const edition=readEdition(workspace,collectionId,editionId);
  const root=path.join(rootFor(workspace,collectionId),'editions',editionId);
  const bytes=zipMembers([...edition.files.map(f=>({name:f.path,data:fs.readFileSync(path.join(root,f.path))})),{name:'edition.json',data:fs.readFileSync(path.join(root,'edition.json'))}]);
  return {name:'measured-study-'+editionId.slice(0,12)+'.zip',type:'application/zip',sha256:hash(bytes),bytes:bytes.length,base64:bytes.toString('base64')};
}
