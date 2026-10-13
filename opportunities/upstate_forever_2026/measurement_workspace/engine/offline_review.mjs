/** Complete offline review exchange using the original MeasurementWorkspace engine.
 * Review changes create a separate editable recipient; the sender is never edited.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MeasurementWorkspace} from './workspace.mjs';
import {publishCollection,readEdition,collectionFromFiles,receiveCollection} from './collections.mjs';
import {hash,stable} from './normalise.mjs';
import {InputError,safeJSON} from './parse.mjs';

const FORMAT='upper-savannah-offline-review/v1';
const CHANGES='upper-savannah-offline-review-changes/v1';
const RECEIVED='upper-savannah-offline-review-received/v1';
const JSON_BYTES=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const STATES=new Set(['pending','include','exclude']);
const text=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new InputError(label+' is required');return value.trim();};
const readJSON=file=>safeJSON(fs.readFileSync(file,'utf8'));
const descriptor=(name,bytes)=>({path:name,bytes:bytes.length,sha256:hash(bytes)});
function relative(name){
  if(typeof name!=='string'||!name||name.includes('\\')||name.includes('\0')||/^[a-z]:/i.test(name)||path.isAbsolute(name)||path.posix.isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw new InputError('Unsafe archive member');
  return name;
}
function localFile(root,name){
  const parts=relative(name).split('/');let value=root;
  if(fs.lstatSync(root).isSymbolicLink())throw new InputError('A package root must not be a symbolic link');
  for(const part of parts){value=path.join(value,part);if(fs.existsSync(value)&&fs.lstatSync(value).isSymbolicLink())throw new InputError('Symbolic links are not package members');}
  if(!fs.statSync(value).isFile())throw new InputError('A package member must be a regular file');
  return value;
}
function createFile(root,name,bytes){
  const destination=path.join(root,relative(name));fs.mkdirSync(path.dirname(destination),{recursive:true});
  const fd=fs.openSync(destination,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function persist(file,value){
  const tmp=file+'.new';fs.writeFileSync(tmp,JSON_BYTES(value),{mode:0o600});fs.renameSync(tmp,file);
}
function sourceFingerprint(row){return hash(stable({id:row.id,sourceKind:row.sourceKind,logicalKey:row.logicalKey,raw:row.raw,review:row.review,selectedVersion:row.selectedVersion}));}
function restoredView(workspace,id){return workspace.record(id);}
function mime(name){return name.endsWith('.json')?'application/json':name.endsWith('.csv')?'text/csv':name.endsWith('.html')?'text/html':name.endsWith('.mjs')?'text/javascript':name.endsWith('.md')?'text/markdown':'application/octet-stream';}
function rendererBody(){return fs.readFileSync(fileURLToPath(new URL('../web/offline_review.html',import.meta.url)),'utf8');}
function readPackage(directory){
  const root=path.resolve(directory), manifest=readJSON(localFile(root,'review-package.json'));
  if(manifest.format!==FORMAT||!Array.isArray(manifest.files))throw new InputError('Unknown offline review package');
  const names=new Set();
  for(const member of manifest.files){
    relative(member.path);if(names.has(member.path))throw new InputError('Duplicate package member');names.add(member.path);
    const body=fs.readFileSync(localFile(root,member.path));
    if(body.length!==member.bytes||hash(body)!==member.sha256)throw new InputError('Package member changed: '+member.path,409);
  }
  for(const required of ['project.json','review-data.json','collection.json','native-reaches.json','edition.json','review.html'])if(!names.has(required))throw new InputError('Offline review package is missing '+required);
  const projectBytes=fs.readFileSync(localFile(root,'project.json')), data=readJSON(localFile(root,'review-data.json'));
  const edition=readJSON(localFile(root,'edition.json')), collection=readJSON(localFile(root,'collection.json'));
  if(data.format!==FORMAT||data.projectSha256!==hash(projectBytes)||data.collectionId!==hash(stable(collection))||data.editionId!==edition.id)throw new InputError('Offline review lineage differs',409);
  if(hash(stable(data.identity))!==data.id||data.identity.projectSha256!==data.projectSha256||data.identity.collectionId!==data.collectionId||data.identity.editionId!==data.editionId||data.id!==manifest.id)throw new InputError('Offline review identity differs',409);
  if(hash(stable(data.records))!==data.identity.recordsSha256)throw new InputError('Offline review records differ',409);
  const project=readJSON(localFile(root,'project.json'));
  if(!Array.isArray(data.records)||data.recordCount!==data.records.length||data.recordCount!==project.tables.records.length)throw new InputError('Offline review population differs',409);
  const byId=new Map(data.records.map(row=>[row.id,row]));
  if(byId.size!==data.recordCount)throw new InputError('Offline review repeats a record',409);
  for(const stored of project.tables.records){
    const row=byId.get(stored.id),original=safeJSON(stored.data);
    if(!row||row.fingerprint!==sourceFingerprint(row)||Object.keys(original).some(key=>stable(original[key])!==stable(row[key])))throw new InputError('Displayed measurement differs from its original record',409);
  }
  if(!Array.isArray(data.files)||data.files.length!==edition.files.length)throw new InputError('Embedded source population differs',409);
  const embedded=new Map(data.files.map(file=>[file.path,file]));
  if(embedded.size!==data.files.length)throw new InputError('Embedded source repeated',409);
  for(const original of edition.files){
    const file=embedded.get(original.path);
    if(!file||typeof file.base64!=='string'||file.bytes!==original.bytes||file.sha256!==original.sha256)throw new InputError('Embedded source identity differs',409);
    const body=Buffer.from(file.base64,'base64');
    if(body.length!==file.bytes||hash(body)!==file.sha256||!body.equals(fs.readFileSync(localFile(root,file.path))))throw new InputError('Embedded source bytes differ',409);
  }
  return {root,manifest,data,project};
}

/** Publish one consistent native collection edition and its complete offline editor. */
export function exportOfflineReview(workspace,collectionId,destination){
  const output=path.resolve(destination);if(fs.existsSync(output))throw new InputError('Choose a new review package directory',409);
  const edition=publishCollection(workspace,collectionId);
  const original=path.join(workspace.directory,'collections',collectionId,'editions',edition.id);
  readEdition(workspace,collectionId,edition.id);
  const projectBytes=fs.readFileSync(path.join(original,'project.json')), project=readJSON(path.join(original,'project.json'));
  fs.mkdirSync(path.dirname(output),{recursive:true});const stage=fs.mkdtempSync(path.join(path.dirname(output),'.offline-review-'));
  const scratch=fs.mkdtempSync(path.join(path.dirname(output),'.offline-review-source-'));
  let captured;
  try{
    fs.copyFileSync(path.join(original,'native-reaches.json'),path.join(scratch,'reaches.json'));
    captured=new MeasurementWorkspace(scratch);captured.receive(project);
    const records=[];
    for(const item of captured.iterate()){
      const row=restoredView(captured,item.id);
      row.fingerprint=sourceFingerprint(row);
      records.push(row);
    }
    const collection=readJSON(path.join(original,'collection.json'));
    const sourceFiles=edition.files.map(f=>({...f,mediaType:mime(f.path),base64:fs.readFileSync(path.join(original,f.path)).toString('base64')}));
    const identity={format:FORMAT,projectSha256:hash(projectBytes),collectionId,editionId:edition.id,recordsSha256:hash(stable(records))};
    const data={format:FORMAT,id:hash(stable(identity)),identity,projectSha256:identity.projectSha256,collectionId,editionId:edition.id,title:collection.title,revision:project.revision,createdAt:new Date().toISOString(),recordCount:records.length,records,files:sourceFiles};
    for(const file of edition.files)createFile(stage,file.path,fs.readFileSync(path.join(original,file.path)));
    createFile(stage,'edition.json',fs.readFileSync(path.join(original,'edition.json')));
    createFile(stage,'review-data.json',JSON_BYTES(data));
    const template=rendererBody();if(template.split('/*__REVIEW_DATA__*/').length!==2)throw new Error('Offline renderer data slot differs');
    const embedded=JSON.stringify(data).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
    createFile(stage,'review.html',Buffer.from(template.replace('/*__REVIEW_DATA__*/',embedded)));
    createFile(stage,'REVIEW_RECEIVING.md',Buffer.from(`# ${collection.title}\n\nOpen review.html directly in a browser. It contains every original record, source file, native eligibility reason, source link, review history and original collection download. No server or network is required.\n\nThe recipient saves explicit review changes with their name and rationale; the editor never changes reported values or source interpretations. Download review-changes.json and retain it beside this complete package.\n\nReceive with the same original Measurements engine (Node >=22.16):\n\n    node measurement_workspace/engine/offline_review_cli.mjs receive --package /path/to/this/package --changes /path/to/review-changes.json --workspace /new/recipient-workspace\n\nThe command verifies the exact package, reconstructs all original records with MeasurementWorkspace.receive, restores the original collection and applies every review through MeasurementWorkspace.review. It writes a fresh editable workspace and a new offline review package. Sender data stays unchanged. Repeating the same completed receive returns its existing recipient rather than replaying edits. An interrupted receive resumes the same owned temporary workspace.\n\nDraft review states are requests. Native eligibility, source-version decisions, censor bounds and native reach support are recomputed by the original engine on receiving. Review names are user-entered, not authenticated signatures. An included review cannot remove a native censoring or mapping restriction.\n\nThe complete source edition can be opened from report.html, project.json or the original-source files. A subsequent native collection export carries all reviews, history and unchanged originals.\n`));
    const files=[];
    function walk(dir,prefix=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())walk(path.join(dir,entry.name),name+'/');else files.push(descriptor(name,fs.readFileSync(path.join(dir,entry.name))));}}
    walk(stage);files.sort((a,b)=>a.path.localeCompare(b.path));
    const manifest={format:FORMAT,id:data.id,collectionId,editionId:edition.id,recordCount:records.length,sourceProjectSha256:identity.projectSha256,rendererSha256:hash(template),files};
    createFile(stage,'review-package.json',JSON_BYTES(manifest));
    fs.renameSync(stage,output);return {...manifest,directory:output};
  }finally{captured?.close();fs.rmSync(scratch,{recursive:true,force:true});if(fs.existsSync(stage))fs.rmSync(stage,{recursive:true,force:true});}
}

/** Validate the complete draft without changing a workspace. */
export function inspectOfflineChanges(packageDirectory,changes){
  const source=readPackage(packageDirectory), {data}=source;
  if(changes?.format!==CHANGES||changes.packageId!==data.id||changes.projectSha256!==data.projectSha256)throw new InputError('Review changes belong to a different original package',409);
  text(changes.operationId,'Review operation identity');
  const reviewer=text(changes.reviewer,'Reviewer name');
  if(!Array.isArray(changes.changes))throw new InputError('Review changes must be a complete array');
  const records=new Map(data.records.map(r=>[r.id,r])),seen=new Set(),selected=new Map();
  const prepared=changes.changes.map(change=>{
    if(!change||typeof change!=='object'||Array.isArray(change))throw new InputError('Invalid review change');
    const record=records.get(change.id);if(!record)throw new InputError('Unknown original measurement: '+change.id,409);
    if(seen.has(change.id))throw new InputError('A record can have only one final review decision');seen.add(change.id);
    if(change.expectedFingerprint!==record.fingerprint)throw new InputError('Original review changed: '+change.id,409);
    if(!STATES.has(change.state))throw new InputError('Unknown review state');
    if(typeof change.selectVersion!=='boolean')throw new InputError('Source-version selection must be explicit');
    if(change.selectVersion&&change.state!=='include')throw new InputError('A selected source revision must be included');
    if(change.selectVersion){if(selected.has(record.logicalKey))throw new InputError('Choose only one included source version per logical measurement');selected.set(record.logicalKey,change.id);}
    return {id:change.id,expectedFingerprint:change.expectedFingerprint,state:change.state,reviewer,reason:text(change.reason,'Decision rationale'),selectVersion:change.selectVersion};
  });
  return {source,changes:prepared,operationId:changes.operationId,changesSha256:hash(stable(changes)),summary:{packageId:data.id,operationId:changes.operationId,changeCount:prepared.length,recordCount:data.recordCount,reviewer}};
}
function sameDecision(row,change){return row.review.state===change.state&&row.review.reviewer===change.reviewer&&row.review.reason===change.reason&&row.review.selectVersion===change.selectVersion&&(change.selectVersion?row.selectedVersion===row.id:change.state==='include'||row.selectedVersion!==row.id);}

/** Independently receive exact originals, reasoned reviews, and a new complete edition.
 * The operation uses a private staging directory, not a second model/HTTP scheduler.
 */
export function receiveOfflineChanges(packageDirectory,changes,destination){
  const plan=inspectOfflineChanges(packageDirectory,changes), output=path.resolve(destination);
  const operation={format:RECEIVED,packageId:plan.source.data.id,operationId:plan.operationId,changesSha256:plan.changesSha256};
  if(fs.existsSync(output)){
    const receiptPath=path.join(output,'offline-review-received.json');
    if(!fs.existsSync(receiptPath))throw new InputError('Recipient directory already exists',409);
    const receipt=readJSON(receiptPath);
    for(const key of Object.keys(operation))if(receipt[key]!==operation[key])throw new InputError('Recipient contains another receiving operation',409);
    return {...receipt,directory:output,alreadyReceived:true};
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const stage=output+'.receiving-'+plan.changesSha256.slice(0,24), journal=path.join(stage,'offline-review-progress.json');
  if(!fs.existsSync(stage)){
    fs.mkdirSync(stage,{mode:0o700});persist(journal,{...operation,phase:'created',applied:[]});
  }
  if(fs.lstatSync(stage).isSymbolicLink())throw new InputError('Receiving stage must be a directory');
  let progress=readJSON(journal);for(const key of Object.keys(operation))if(progress[key]!==operation[key])throw new InputError('Receiving stage belongs to another operation',409);
  const nativeDir=path.join(stage,'measurements');fs.mkdirSync(nativeDir,{recursive:true});
  const reaches=fs.readFileSync(localFile(plan.source.root,'native-reaches.json'));
  const reachPath=path.join(nativeDir,'reaches.json');
  if(fs.existsSync(reachPath)&&!fs.readFileSync(reachPath).equals(reaches))throw new InputError('Receiving native identifier edition changed',409);
  fs.writeFileSync(reachPath,reaches);
  const workspace=new MeasurementWorkspace(nativeDir);
  try{
    if(progress.phase==='created'){
      if(workspace.summary().imports.length===0&&workspace.summary().recordCount===0)workspace.receive(plan.source.project);
      // A killed process may have committed native receiving before the journal.
      // Check every source and immutable record against the exact original before reuse.
      for(const row of plan.source.project.tables.imports){const retained=workspace.source(row.id);if(retained.sha!==row.sha||retained.content!==row.content)throw new InputError('Partial recipient source differs',409);}
      for(const record of plan.source.data.records)if(sourceFingerprint(workspace.record(record.id))!==record.fingerprint)throw new InputError('Partial recipient review differs',409);
      if(workspace.summary().recordCount!==plan.source.data.recordCount)throw new InputError('Partial recipient population differs',409);
      progress.phase='originals';persist(journal,progress);
    }
    receiveCollection(workspace,collectionFromFiles(readJSON(localFile(plan.source.root,'collection.json')),path.join(plan.source.root,'sources')));
    const byId=new Map(plan.source.data.records.map(r=>[r.id,r]));
    for(const change of plan.changes){
      const current=workspace.record(change.id);
      if(progress.applied.includes(change.id)){
        if(!sameDecision(current,change))throw new InputError('An already applied recipient review changed',409);continue;
      }
      // Exact requested state is also the recovery path for a lost response after
      // the original native review committed but before its progress marker.
      if(!sameDecision(current,change)){
        // Selecting another reviewed version can legitimately change selectedVersion
        // in this record while processing the same validated logical-key group.
        const expected=byId.get(change.id), adjusted={...current,selectedVersion:expected.selectedVersion};
        if(sourceFingerprint(adjusted)!==change.expectedFingerprint)throw new InputError('Recipient review has changed independently',409);
        workspace.review(change.id,{state:change.state,reviewer:change.reviewer,reason:change.reason,selectVersion:change.selectVersion,expectedRevision:workspace.revision()});
      }
      progress.applied.push(change.id);progress.phase='reviews';persist(journal,progress);
    }
    const packet=path.join(stage,'review-package');
    if(!fs.existsSync(packet))exportOfflineReview(workspace,plan.source.data.collectionId,packet);
    else readPackage(packet);
    const summary=workspace.summary();
    const receipt={...operation,reviewer:plan.summary.reviewer,changeCount:plan.changes.length,recordCount:summary.recordCount,sourceCount:summary.imports.length,revision:summary.revision,completedAt:new Date().toISOString(),workspace:'measurements',reviewPackage:'review-package',applied:progress.applied};
    persist(path.join(stage,'review-changes.json'),changes);persist(path.join(stage,'offline-review-received.json'),receipt);
    workspace.close();fs.renameSync(stage,output);return {...receipt,directory:output,alreadyReceived:false};
  }catch(error){try{workspace.close();}catch{}throw error;}
}
