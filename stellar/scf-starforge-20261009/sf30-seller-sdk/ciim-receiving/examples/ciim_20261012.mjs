// MIT. Reopen the retained original DataCite and CIIM Dublin Core receiving case.
// Inputs are the original three captured editions shipped with the worked case.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';

const options={};
const allowed=new Set(['case','runtime','oai-source-module','oai-python-directory','sources-only']);
for(let i=2;i<process.argv.length;i++){
 const key=process.argv[i];
 if(!key.startsWith('--')||!allowed.has(key.slice(2)))throw new Error('Unknown option '+key);
 const name=key.slice(2);
 if(Object.hasOwn(options,name))throw new Error('Duplicate option '+key);
 if(name==='sources-only'){options[name]=true;continue;}
 const value=process.argv[++i];
 if(!value||value.startsWith('--'))throw new Error('Supply a value for '+key);
 options[name]=value;
}
if(!options.case)throw new Error('Use --case /absolute/unpacked-case/case; optionally --runtime /runtime/runtime.json');
const root=resolve(options.case),mode=options['sources-only']?'sources':'run';
const runtimeFile=resolve(options.runtime??join(root,'runtime','runtime.json'));
const sourceModule=resolve(options['oai-source-module']??fileURLToPath(new URL('../../oai-pmh/source.mjs',import.meta.url)));
const pythonDirectory=resolve(options['oai-python-directory']??fileURLToPath(new URL('../../oai-pmh/',import.meta.url)));
const hash=body=>createHash('sha256').update(body).digest('hex');

const {readOaiSourceFile}=await import(pathToFileURL(sourceModule));
const {transformCapture,createPageReader}=await import('../capture.mjs');
const {openJavaTransform}=await import('../runtime.mjs');
const input=[
 {name:'datacite',path:join(root,'inputs','datacite','source.json'),active:231,deleted:0,
  sha256:'31c3c8067d8441cea9ea6e71f7cf702b40d97eeb35274259b04f5490c7dd4e51',
  operationId:'CIIM-PROTEUS-DATACITE-ADC6-20261012'},
 {name:'openalex-withdrawal',path:join(root,'inputs','withdrawal-source','source.json'),active:168,deleted:1,
  sha256:'8ce9988a0cefa50ba807ce6dedbbaeabf3b86be4b66c7d84482fb5839b021511',
  operationId:'CIIM-PROTEUS-OPENALEX-WITHDRAWAL-ADC6-20261012'},
 {name:'openalex-restored',path:join(root,'inputs','publisher-source','source.json'),active:169,deleted:0,
  sha256:'fd87c23e344618ddca45e78f18e8fb0393ca8d42714193b061a3db34d4ccfa19',
  operationId:'CIIM-PROTEUS-OPENALEX-RESTORED-ADC6-20261012'}
];
for(const item of input){
 const source=await readOaiSourceFile(item.path,{loadDataset:false});
 assert.equal(hash(source.captureBytes),item.sha256);
 assert.equal(source.capture.edition.activeRecords,item.active);
 assert.equal(source.capture.edition.deletedRecords,item.deleted);
 process.stdout.write(JSON.stringify({stage:'original-custody',name:item.name,captureSha256:item.sha256,
  active:item.active,deleted:item.deleted,inventory:source.files.length})+'\n');
}
if(mode==='sources')process.exit(0);
if(mode!=='run'||!runtimeFile)throw new Error('Use sources or run with original runtime manifest');
const suppliedRuntime=resolve(runtimeFile),runtimeBytes=await readFile(suppliedRuntime);
const runtimeManifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(runtimeBytes));
const declared=[...runtimeManifest.classpath,...(runtimeManifest.files??[])],verified=new Map();
for(const member of declared){
 const name=member.file;
 assert.equal(typeof name,'string');assert.equal(isAbsolute(name),false);
 assert.ok(name.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!name.includes('\\'));
 if(verified.has(name)){assert.equal(verified.get(name),member.sha256);continue;}
 const body=await readFile(join(dirname(suppliedRuntime),name));
 assert.equal(body.length,member.bytes);assert.equal(hash(body),member.sha256);
 verified.set(name,member.sha256);
}
await writeFile(join(root,'runtime.json'),runtimeBytes,{mode:0o600});
await writeFile(join(root,'runtime-reference.json'),JSON.stringify({file:suppliedRuntime,sha256:hash(runtimeBytes)})+'\n',{mode:0o600});
process.stdout.write(JSON.stringify({stage:'runtime-verified',files:verified.size,manifestSha256:hash(runtimeBytes)})+'\n');
await mkdir(join(root,'results'),{recursive:true,mode:0o700});
const transform=await openJavaTransform({runtimeFile,workDirectory:join(root,'java-work'),heapMiB:128,timeoutMs:120000});
const pageReader=createPageReader({oaiDirectory:pythonDirectory});
const completed=new Map(),summary=[];
try{
 for(const item of input){
  const args={sourceFile:item.path,oaiSourceModule:sourceModule,pageReader,transform,
    directory:join(root,'results','native-mapper-correction',item.name),operationId:item.operationId,
    receiving:{documented_input:'OAI harvester plus reviewed Proteus transform',
      processing_profile:null,institutional_authorities:null,receiving_environment:null},
    onProgress:progress=>{
      if(progress.stage!=='record-mapped'||progress.records%25===0)
        process.stdout.write(JSON.stringify({name:item.name,...progress})+'\n');
    }};
  const result=await transformCapture(args);
  assert.equal(result.manifest.counts.active,item.active);
  assert.equal(result.manifest.counts.deleted,item.deleted);
  const bytes=await readFile(join(result.directory,result.manifest.records.file));
  assert.equal(hash(bytes),result.manifest.records.storedSha256);
  const raw=gunzipSync(bytes);assert.equal(hash(raw),result.manifest.records.sha256);
  assert.equal(raw.length,result.manifest.records.bytes);
  completed.set(item.name,{...result,args});
  summary.push({name:item.name,operationId:item.operationId,counts:result.manifest.counts,
    manifestSha256:hash(await readFile(join(result.directory,'manifest.json'))),
    records:result.manifest.records,report:result.manifest.report});
 }
 const prior=new Map(completed.get('openalex-withdrawal').records.map(r=>[r.identifier,r]));
 const restored=new Map(completed.get('openalex-restored').records.map(r=>[r.identifier,r]));
 assert.deepEqual([...prior.keys()].sort(),[...restored.keys()].sort());
 const changes=[];
 for(const [id,before]of prior){
  const after=restored.get(id);
  if(before.status!==after.status)changes.push({identifier:id,before:before.status,after:after.status,
    priorObservation:before.observation.id,currentObservation:after.observation.id,
    priorDatestamp:before.datestamp,currentDatestamp:after.datestamp,
    priorSource:before.provenance.page,currentSource:after.provenance.page,
    priorResources:before.resources.length,currentResources:after.resources.length});
 }
 assert.equal(changes.length,1);assert.equal(changes[0].before,'deleted');
 assert.equal(changes[0].after,'active');assert.equal(changes[0].priorResources,0);
 assert.equal(changes[0].currentResources,1);
 const initial=completed.get('datacite'),replayProgress=[];
 const replay=await transformCapture({...initial.args,onProgress:p=>replayProgress.push(p)});
 assert.equal(replay.manifest.records.sha256,initial.manifest.records.sha256);
 assert.equal(replayProgress.filter(p=>p.stage==='record-mapped').length,0);
 assert.equal(replayProgress.filter(p=>p.stage==='page-reopened').length,initial.manifest.pages.length);
 const native={schema:'tjl.ciim.original-native-operation.v1',status:'complete',
  runtime:transform.runtime,sources:summary,restoration:changes,
  reopened:{name:'datacite',records:replay.manifest.counts.records,
    pages:replayProgress.filter(p=>p.stage==='page-reopened').length,sha256:replay.manifest.records.sha256}};
 await writeFile(join(root,'NATIVE-RESULT.json'),JSON.stringify(native,null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify(native)+'\n');
}finally{await transform.close();}
