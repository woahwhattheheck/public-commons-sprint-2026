// MIT. Frozen City delivery editions and create-only, source-complete case recovery.
import {DatabaseSync} from 'node:sqlite';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,rename,rm,readdir,stat,access,copyFile} from 'node:fs/promises';
import {join,dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {Workspace} from './store.mjs';
import {compileDictionary,digest,fault} from './contract.mjs';
import {hashFile,objectPath,atomicJson,retainFile,regularFile} from './files.mjs';

const here=dirname(fileURLToPath(import.meta.url)),appRoot=dirname(here);
const smallTables=['projects','dictionaries','uploads','sources','artifacts','runs','decisions','milestones','releases','events'];
const streamTables=['records','findings'];
const editionNames=['inventory.csv','inventory.pdf','findings.csv','review.json','dictionary.json','delivery.zip','SHA256SUMS.txt'];
const inFlight=new WeakMap();
export const csvCell=value=>{
  let content=value===null||value===undefined?'':String(value);
  if(typeof value==='string'&&/^[\t\r\n ]*[=+\-@]/.test(content))content="'"+content;
  return '"'+content.replaceAll('"','""')+'"';
};
const csvLine=values=>values.map(csvCell).join(',')+'\r\n';
const json=value=>JSON.stringify(value,null,2)+'\n';

export function runPython(args,{python=process.env.MIDLAND_PYTHON||'python3'}={}){
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(python,[join(here,'bundle.py'),...args],{stdio:['ignore','pipe','pipe']});
    let output='',error='';
    child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-16000);});
    child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-16000);});
    child.on('error',reject);
    child.on('close',code=>code===0?resolvePromise(output):reject(fault(500,error.trim()||'The package process did not complete.')));
  });
}
async function writeLines(path,iterable,format=value=>JSON.stringify(value)+'\n'){
  const stream=createWriteStream(path,{flags:'wx',mode:0o600});
  let error=null;stream.on('error',e=>{error=e;});
  try{
    for(const value of iterable){
      if(error)throw error;
      if(!stream.write(format(value)))await once(stream,'drain');
    }
    stream.end();await once(stream,'finish');if(error)throw error;
  }catch(e){stream.destroy();throw e;}
}
async function descriptor(path,inputPath,role,sourceRef=''){
  const value=await hashFile(inputPath);
  return {path,input_path:inputPath,...value,role,source_ref:sourceRef};
}
function releaseRecord(workspace,projectId,releaseId){
  workspace.project(projectId);
  const row=workspace.db.prepare('SELECT * FROM releases WHERE id=? AND project_id=?').get(releaseId,projectId);
  if(!row)throw fault(404,'Delivery edition not found.');
  return {...row,payload:JSON.parse(row.payload)};
}
async function existingEdition(workspace,projectId,releaseId){
  const record=releaseRecord(workspace,projectId,releaseId),directory=join(workspace.root,'exports',releaseId);
  try{
    const index=JSON.parse(await readFile(join(directory,'edition.json'),'utf8'));
    if(index.release_sha256!==digest(record))throw fault(409,'This edition cache does not match its retained release.');
    return {...index,directory};
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export async function buildEdition(workspace,projectId,releaseId,options={}){
  const cached=await existingEdition(workspace,projectId,releaseId);if(cached)return cached;
  if(!inFlight.has(workspace))inFlight.set(workspace,new Map());
  const jobs=inFlight.get(workspace),key='edition:'+releaseId;
  if(jobs.has(key))return jobs.get(key);
  const task=buildEditionOnce(workspace,projectId,releaseId,options).finally(()=>jobs.delete(key));
  jobs.set(key,task);return task;
}
async function buildEditionOnce(workspace,projectId,releaseId,options){
  const release=releaseRecord(workspace,projectId,releaseId),p=release.payload;
  const temp=join(workspace.root,'staging','edition-'+randomUUID()),destination=join(workspace.root,'exports',releaseId);
  await mkdir(temp,{mode:0o700});
  try{
    const files=[];
    for(const source of p.sources){
      for(const [kind,sha,size] of [['metadata.json',source.metadata_sha,source.metadata_size],['attributes.ndjson',source.rows_sha,source.rows_size]]){
        const path='sources/'+source.feature_class+'/'+kind,inputPath=objectPath(workspace.root,sha),actual=await hashFile(inputPath);
        if(actual.sha256!==sha||actual.size!==size)throw fault(409,'Retained delivery source differs from its identity.');
        files.push({path,input_path:inputPath,sha256:sha,size,role:source.sample?'representative_sample':'attribute_export',source_ref:source.source_ref});
      }
    }
    for(const artifact of p.artifacts){
      const item=await descriptor('delivery/'+artifact.id+'/'+artifact.filename,objectPath(workspace.root,artifact.sha256),artifact.role,artifact.source_ref);
      if(item.sha256!==artifact.sha256||item.size!==artifact.size)throw fault(409,'A selected delivery file changed.');
      files.push(item);
    }
    const sourceDictionary=p.run.dictionary_id?workspace.db.prepare('SELECT * FROM dictionaries WHERE id=? AND project_id=?').get(p.run.dictionary_id,projectId):null;
    if(sourceDictionary){
      const item=await descriptor('review/original-dictionary.json',objectPath(workspace.root,sourceDictionary.sha256),'original_dictionary',sourceDictionary.source_ref);
      if(item.sha256!==sourceDictionary.sha256)throw fault(409,'The original dictionary changed.');files.push(item);
    }
    const report={schema:'midland.delivery-review.v1',release_id:release.id,title:p.project.title,label:release.label,
      reviewer:release.reviewer,created_at:release.created_at,note:release.note,project:p.project,
      selection:p.run.selection,run:p.run,readiness:p.readiness,
      dictionary_record:sourceDictionary,review_cutoff_seq:p.review_cutoff_seq,
      meaning:'Frozen attribute review and operator delivery context. City acceptance is only the separately recorded correspondence.'};
    await writeFile(join(temp,'review.json'),json(report),{flag:'wx',mode:0o600});
    await writeFile(join(temp,'dictionary.json'),json(p.contract),{flag:'wx',mode:0o600});
    files.push(await descriptor('review/review.json',join(temp,'review.json'),'attribute_review'));
    files.push(await descriptor('review/dictionary.json',join(temp,'dictionary.json'),'compiled_dictionary'));
    const findings=workspace.db.prepare("SELECT f.feature_class,f.scope,f.line,f.record_key,f.code,f.location,f.detail,f.rule_origin,COALESCE(d.action,'OPEN') AS review_state,d.owner,d.note,d.source_ref,d.actor,d.created_at AS reviewed_at,f.row_sha,f.fingerprint"+
      workspace.effectiveSql(p.review_cutoff_seq)+' WHERE f.run_id=? ORDER BY f.source_id,f.line,f.id').iterate(p.run.id);
    const columns=['feature_class','scope','line','record_key','code','location','detail','rule_origin','review_state','owner','note','source_ref','actor','reviewed_at','row_sha','fingerprint'];
    function* findingLines(){yield columns;for(const row of findings)yield columns.map(k=>row[k]);}
    await writeLines(join(temp,'findings.csv'),findingLines(),csvLine);
    files.push(await descriptor('review/findings.csv',join(temp,'findings.csv'),'complete_findings'));
    const reviewHistory=workspace.db.prepare('SELECT d.* FROM decisions d WHERE d.project_id=? AND d.seq<=? ORDER BY d.seq')
      .iterate(projectId,p.review_cutoff_seq);
    await writeLines(join(temp,'review-history.ndjson'),reviewHistory);
    files.push(await descriptor('review/decision-history.ndjson',join(temp,'review-history.ndjson'),'review_history'));
    const inventory={release_id:release.id,title:p.project.title,label:release.label,reviewer:release.reviewer,
      created_at:release.created_at,note:release.note,files:files.map(({input_path,...rest})=>rest)};
    await writeFile(join(temp,'inventory-data.json'),json(inventory),{flag:'wx',mode:0o600});
    await writeLines(join(temp,'inventory.csv'),[['file_path','size_bytes','sha256','role','source_ref'],...files.map(f=>[f.path,f.size,f.sha256,f.role,f.source_ref])],csvLine);
    await runPython(['pdf',join(temp,'inventory-data.json'),join(temp,'inventory.pdf')],options);
    files.push(await descriptor('inventory.csv',join(temp,'inventory.csv'),'file_inventory_csv'));
    files.push(await descriptor('inventory.pdf',join(temp,'inventory.pdf'),'file_inventory_pdf'));
    await writeLines(join(temp,'SHA256SUMS.txt'),files,f=>f.sha256+'  '+f.path+'\n');
    files.push(await descriptor('SHA256SUMS.txt',join(temp,'SHA256SUMS.txt'),'package_checksums'));
    const packageInfo={kind:'DELIVERY',created_at:release.created_at,files};
    await writeFile(join(temp,'package-input.json'),json(packageInfo),{flag:'wx',mode:0o600});
    await runPython(['create',join(temp,'package-input.json'),join(temp,'delivery.zip')],options);
    const downloads={};
    for(const name of editionNames)
      downloads[name]=await hashFile(join(temp,name));
    const index={schema:'midland.delivery-cache.v1',release_id:releaseId,project_id:projectId,release_sha256:digest(release),
      downloads,inventory:inventory.files};
    await atomicJson(join(temp,'edition.json'),index);
    await rm(join(temp,'package-input.json'));
    try{await rename(temp,destination);}catch(e){
      if(!['ENOTEMPTY','EEXIST'].includes(e.code))throw e;
      await rm(temp,{recursive:true,force:true});
    }
    return await existingEdition(workspace,projectId,releaseId);
  }catch(e){await rm(temp,{recursive:true,force:true});throw e;}
}
export async function editionFile(workspace,projectId,releaseId,name,options={}){
  const edition=await buildEdition(workspace,projectId,releaseId,options),identity=edition.downloads[name];
  if(!identity)throw fault(404,'Edition file not found.');
  const path=join(edition.directory,name),actual=await hashFile(path);
  if(actual.sha256!==identity.sha256||actual.size!==identity.size)throw fault(409,'A generated edition file changed.');
  return {path,filename:name,...identity};
}
async function applicationFiles(){
  const names=['README.md','spec.mjs','preflight.mjs','arcpy_export.py'];
  async function visit(relativePath){
    for(const entry of await readdir(join(appRoot,relativePath),{withFileTypes:true})){
      const path=relativePath+'/'+entry.name;
      if(entry.isDirectory()&&entry.name!=='__pycache__')await visit(path);
      else if(entry.isFile()&&/\.(mjs|py|html|css|md|txt)$/.test(entry.name))names.push(path);
    }
  }
  await visit('workspace');return names;
}
export async function exportWorkspace(workspace,projectId,options={}){
  workspace.project(projectId);
  const exportId='case-'+randomUUID(),temp=join(workspace.root,'staging',exportId),destination=join(workspace.root,'exports',exportId+'.zip');
  await mkdir(temp,{mode:0o700});
  const reader=new DatabaseSync(join(workspace.root,'workspace.sqlite'),{readOnly:true});
  const tables={},files=[],objects=new Map();
  try{
    reader.exec('BEGIN');
    for(const table of smallTables){
      tables[table]=reader.prepare('SELECT * FROM '+table+' WHERE '+(table==='projects'?'id':'project_id')+'=?'+(['decisions','milestones','events'].includes(table)?' ORDER BY seq':'')).all(projectId);
    }
    const snapshot={schema:'midland.workspace-snapshot.v1',project_id:projectId,created_at:new Date().toISOString(),tables};
    await writeFile(join(temp,'case.json'),json(snapshot),{flag:'wx',mode:0o600});
    files.push(await descriptor('case/case.json',join(temp,'case.json'),'workspace_snapshot'));
    for(const table of streamTables){
      const rows=reader.prepare('SELECT t.* FROM '+table+' t JOIN runs r ON r.id=t.run_id WHERE r.project_id=? ORDER BY t.run_id,t.source_id,t.line').iterate(projectId);
      await writeLines(join(temp,table+'.ndjson'),rows);
      files.push(await descriptor('case/'+table+'.ndjson',join(temp,table+'.ndjson'),'workspace_'+table));
    }
    reader.exec('ROLLBACK');reader.close();
    for(const upload of tables.uploads)objects.set(upload.sha256,upload.size);
    for(const source of tables.sources){objects.set(source.metadata_sha,source.metadata_size);objects.set(source.rows_sha,source.rows_size);}
    for(const artifact of tables.artifacts)objects.set(artifact.sha256,artifact.size);
    for(const dictionary of tables.dictionaries)if(!objects.has(dictionary.sha256))objects.set(dictionary.sha256,null);
    for(const [sha,size] of objects){
      const item=await descriptor('case/objects/'+sha,objectPath(workspace.root,sha),'retained_original');
      if(item.sha256!==sha||(size!==null&&item.size!==size))throw fault(409,'A retained workspace object changed.');
      files.push(item);
    }
    for(const release of tables.releases){
      const edition=await existingEdition(workspace,projectId,release.id);if(!edition)continue;
      files.push(await descriptor('case/editions/'+release.id+'/edition.json',join(edition.directory,'edition.json'),'retained_edition_index'));
      for(const name of editionNames){
        const item=await descriptor('case/editions/'+release.id+'/'+name,join(edition.directory,name),'retained_edition_file');
        if(item.sha256!==edition.downloads[name]?.sha256||item.size!==edition.downloads[name]?.size)
          throw fault(409,'A retained edition file changed.');
        files.push(item);
      }
    }
    for(const name of await applicationFiles())
      files.push(await descriptor('application/'+name,join(appRoot,name),'application_source'));
    const readme='MIDLAND REOPENABLE CASE\n\nCase: '+tables.projects[0].title+'\nSnapshot: '+snapshot.created_at+
      '\n\nThe case contains the exact retained original files, source versions, dictionaries, runs, findings and append-only review history. '+
      'A RUNNING worker is imported as INTERRUPTED; no process or GIS acquisition is resumed automatically.\n\n'+
      'Use your maintained Node.js 24+ runtime and Python 3 with reportlab. From the included application directory:\n'+
      '  node workspace/cli.mjs restore --archive /path/to/this-case.zip --workspace /new/private/directory\n'+
      '  node workspace/cli.mjs serve --workspace /new/private/directory\n\n'+
      'Restore creates a new directory, verifies every SHA-256 and imports data only. It never executes code from an uploaded archive.\n';
    await writeFile(join(temp,'OPEN_CASE.txt'),readme,{flag:'wx',mode:0o600});
    files.push(await descriptor('OPEN_CASE.txt',join(temp,'OPEN_CASE.txt'),'opening_instructions'));
    await writeFile(join(temp,'package-input.json'),json({kind:'WORKSPACE',created_at:snapshot.created_at,files}),{flag:'wx',mode:0o600});
    await runPython(['create',join(temp,'package-input.json'),destination],options);
    const identity=await hashFile(destination);
    return {path:destination,filename:'midland-'+projectId+'-case.zip',project_id:projectId,snapshot_at:snapshot.created_at,...identity};
  }finally{
    try{reader.close();}catch{}
    await rm(temp,{recursive:true,force:true});
  }
}
function validateSnapshot(snapshot){
  if(snapshot?.schema!=='midland.workspace-snapshot.v1'||typeof snapshot.project_id!=='string'||
      !snapshot.tables||typeof snapshot.tables!=='object')throw fault(422,'Unsupported workspace snapshot.');
  if(Object.keys(snapshot.tables).sort().join('|')!==smallTables.slice().sort().join('|'))throw fault(422,'Workspace snapshot tables differ.');
  for(const table of smallTables)if(!Array.isArray(snapshot.tables[table])||snapshot.tables[table].length>100000)
    throw fault(422,'Workspace history exceeds the import limit.');
  const project=snapshot.tables.projects;
  if(project.length!==1||project[0].id!==snapshot.project_id)throw fault(422,'Choose a single-project case package.');
  for(const table of smallTables){
    for(const row of snapshot.tables[table]){
      if(!row||typeof row!=='object'||Array.isArray(row)||(table!=='projects'&&row.project_id!==snapshot.project_id))
        throw fault(422,'Workspace row belongs to a different project.');
      for(const value of Object.values(row))if(value!==null&&typeof value!=='string'&&!Number.isSafeInteger(value))
        throw fault(422,'Workspace values must be native scalar columns.');
    }
  }
  for(const d of snapshot.tables.dictionaries)compileDictionary(JSON.parse(d.body));
}
export async function restoreWorkspace(archive,target,{maxBytes=8*1024*1024*1024,...options}={}){
  target=resolve(target);await regularFile(archive,maxBytes);
  try{await access(target);throw fault(409,'Restore requires a new workspace directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  const extracted=join(dirname(target),'.midland-unpack-'+randomUUID()),building=join(dirname(target),'.midland-restore-'+randomUUID());
  let restored;
  try{
    await runPython(['extract',resolve(archive),extracted,'--max-bytes',String(maxBytes)],options);
    const casePath=join(extracted,'case','case.json');await regularFile(casePath,32*1024*1024);
    const snapshot=JSON.parse(await readFile(casePath,'utf8'));validateSnapshot(snapshot);
    restored=await Workspace.open(building,options);
    const importRows=async (table,values)=>{
      const columns=restored.db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);
      const sorted=columns.slice().sort().join('|');
      const insert=restored.db.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
      let count=0;
      restored.db.exec('BEGIN IMMEDIATE');
      try{
        for await(const row of values){
          if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join('|')!==sorted)
            throw fault(422,'Invalid columns in '+table+'.');
          if(table==='runs'&&row.status==='RUNNING'){
            row.status='INTERRUPTED';row.completed_at=snapshot.created_at;
            row.error='Imported retained snapshot; the original process is not resumed.';row.owner_pid=0;row.worker_identity=null;
          }
          insert.run(...columns.map(k=>row[k]));count++;
          if(count%1000===0){restored.db.exec('COMMIT');restored.db.exec('BEGIN IMMEDIATE');}
        }
        restored.db.exec('COMMIT');
      }catch(e){restored.db.exec('ROLLBACK');throw e;}
    };
    for(const table of smallTables.slice(0,6))await importRows(table,snapshot.tables[table]);
    async function* readRows(path){
      await regularFile(path,maxBytes);
      const source=createReadStream(path),lines=createInterface({input:source,crlfDelay:Infinity});
      try{for await(const line of lines){if(!line.trim())continue;if(line.length>256000)throw fault(422,'Workspace row exceeds its import limit.');yield JSON.parse(line);}}
      finally{lines.close();source.destroy();}
    }
    for(const table of streamTables)await importRows(table,readRows(join(extracted,'case',table+'.ndjson')));
    for(const table of smallTables.slice(6))await importRows(table,snapshot.tables[table]);
    const p=restored.project(snapshot.project_id),sourceIds=new Set(snapshot.tables.sources.map(s=>s.id));
    for(const [featureClass,sourceId] of Object.entries(p.selection)){
      const source=snapshot.tables.sources.find(s=>s.id===sourceId);
      if(!source||source.feature_class!==featureClass)throw fault(422,'Selected source does not match its feature class.');
    }
    for(const run of snapshot.tables.runs){
      const selection=JSON.parse(run.selection);
      for(const [featureClass,sourceId] of Object.entries(selection)){
        const source=snapshot.tables.sources.find(s=>s.id===sourceId);
        if(!source||source.feature_class!==featureClass)throw fault(422,'A run references a missing source.');
      }
      restored.runContract(p.id,restored.getRun(p.id,run.id));
    }
    if(restored.db.prepare('SELECT COUNT(*) AS n FROM records t LEFT JOIN sources s ON s.id=t.source_id WHERE s.id IS NULL').get().n||
       restored.db.prepare('SELECT COUNT(*) AS n FROM findings f LEFT JOIN sources s ON s.id=f.source_id WHERE s.id IS NULL OR f.project_id!=? OR s.feature_class!=f.feature_class').get(p.id).n)
      throw fault(422,'A retained observation has an invalid source.');
    const objects=new Map();
    for(const item of snapshot.tables.uploads)objects.set(item.sha256,item.size);
    for(const source of snapshot.tables.sources){objects.set(source.metadata_sha,source.metadata_size);objects.set(source.rows_sha,source.rows_size);}
    for(const item of snapshot.tables.artifacts)objects.set(item.sha256,item.size);
    for(const item of snapshot.tables.dictionaries)if(!objects.has(item.sha256))objects.set(item.sha256,null);
    for(const [sha,size] of objects){
      const path=objectPath(join(extracted,'case'),sha),actual=await retainFile(building,path,{limit:maxBytes});
      if(actual.sha256!==sha||(size!==null&&actual.size!==size))throw fault(422,'A retained source differs from its saved identity.');
    }
    for(const release of snapshot.tables.releases){
      if(!/^release-[a-f0-9-]{36}$/.test(release.id))throw fault(422,'Invalid retained release identity.');
      const source=join(extracted,'case','editions',release.id);
      try{await access(join(source,'edition.json'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
      const index=JSON.parse(await readFile(join(source,'edition.json'),'utf8'));
      if(index.release_sha256!==digest({...release,payload:JSON.parse(release.payload)})||
        Object.keys(index.downloads||{}).sort().join('|')!==editionNames.slice().sort().join('|'))
        throw fault(422,'Retained edition index differs from the original release.');
      const destination=join(building,'exports',release.id);await mkdir(destination,{mode:0o700});
      for(const name of ['edition.json',...editionNames]){
        const actual=await hashFile(join(source,name),maxBytes);
        if(name!=='edition.json'&&(actual.sha256!==index.downloads[name].sha256||actual.size!==index.downloads[name].size))
          throw fault(422,'A retained edition file differs from its original identity.');
        await copyFile(join(source,name),join(destination,name));
      }
    }
    restored.contract(p.id,p.dictionary_id);
    const violations=restored.db.prepare('PRAGMA foreign_key_check').all();
    if(violations.length)throw fault(422,'The case contains incomplete history links.');
    const result={project_id:p.id,title:p.title,revision:p.revision,workspace:target,source_versions:snapshot.tables.sources.length,
      runs:snapshot.tables.runs.length,retained_objects:objects.size};
    await restored.close();restored=null;
    try{await access(target);throw fault(409,'The restore destination appeared while importing.');}catch(e){if(e.code!=='ENOENT')throw e;}
    await rename(building,target);return result;
  }finally{
    await restored?.close().catch(()=>{});
    await rm(extracted,{recursive:true,force:true});await rm(building,{recursive:true,force:true});
  }
}
