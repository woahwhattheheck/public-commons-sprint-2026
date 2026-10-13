#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const core=require('./expansion-core.cjs');
const adapter=require('./source-adapter.cjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
function read(file){return fs.readFileSync(path.resolve(file),'utf8');}
function workspace(file){const w=JSON.parse(read(file));core.validate(w);return w;}
function writeExclusive(file,body){
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,body,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function outputEdition(w,out,extras={}){
 core.validate(w);const report=core.analyze(w),dir=path.resolve(out);
 fs.mkdirSync(path.dirname(dir),{recursive:true});
 fs.mkdirSync(dir,{mode:0o700}); // An existing edition is never overwritten.
 const bodies={
  'workspace.json':json(w),'analysis.json':json(report),
  'company-queue.csv':core.toCSV(report.companies.map(c=>({
   company_key:c.key,label:c.label,segment:c.segment,active_members:c.active_members,
   eligible_members:c.eligible_members,champion_email:c.champion?.email||'',
   current_mrr:c.current_mrr,reasons:c.reasons
  }))),
  'pilot-outcomes.json':json(report.pilot_results),...extras
 };
 for(const table of core.TABLES)bodies[table+'.csv']=core.toCSV(w.data[table]);
 const app=path.join(__dirname,'web','expansion.html');
 if(fs.existsSync(app))bodies['expansion.html']=fs.readFileSync(app,'utf8');
 const manifest={schema:'tjlabs.arrangr-edition/v1',workspace_id:w.workspace_id,revision:w.revision,as_of:w.as_of,demonstration:w.demonstration,files:[]};
 for(const [name,body] of Object.entries(bodies)){
  if(path.basename(name)!==name)throw Error('Edition filename must have no directory components');
  writeExclusive(path.join(dir,name),body);
  manifest.files.push({path:name,bytes:Buffer.byteLength(body),sha256:hash(body)});
 }
 writeExclusive(path.join(dir,'manifest.json'),json(manifest));
 return{directory:dir,manifest,summary:report.summary};
}
function verify(dir){
 const root=path.resolve(dir),manifest=JSON.parse(read(path.join(root,'manifest.json')));
 for(const file of manifest.files){
  if(path.basename(file.path)!==file.path)throw Error('Invalid manifest path');
  const b=fs.readFileSync(path.join(root,file.path));
  if(b.length!==file.bytes||hash(b)!==file.sha256)throw Error('Changed file: '+file.path);
 }
 const w=workspace(path.join(root,'workspace.json')),report=JSON.parse(read(path.join(root,'analysis.json')));
 if(core.stable(core.analyze(w))!==core.stable(report))throw Error('Reopened workspace has different results');
 if(w.workspace_id!==manifest.workspace_id||w.revision!==manifest.revision)throw Error('Edition identity changed');
 return{ok:true,workspace_id:w.workspace_id,revision:w.revision,files_verified:manifest.files.length,pilots:report.pilot_results};
}
function main(args){
 const [command,...p]=args;
 if(command==='demo'){
  if(p.length!==1)throw Error('demo requires one NEW output directory');
  const j=core.demoJourney();
  const result=outputEdition(j.workspace,p[0],{'initial-workspace.json':json(j.initial),'initial-analysis.json':json(j.initial_analysis)});
  const child=spawnSync(process.execPath,[__filename,'verify',result.directory],{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});
  if(child.error||child.status!==0)throw Error('Independent reopen failed: '+(child.error?.message||child.stderr));
  const reopened=JSON.parse(child.stdout);
  const execution={schema:'tjlabs.arrangr-native-demonstration/v1',at:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,workspace_id:j.workspace.workspace_id,source_sha256:hash(read(path.join(__dirname,'expansion-core.cjs'))),full_source_edition:result.directory,independent_reopen:reopened};
  writeExclusive(path.join(result.directory,'NATIVE_RESULT.json'),json(execution));
  return execution;
 }
 if(command==='init'){
  if(p.length!==2)throw Error('init requires INPUT.json NEW_OUTPUT_DIRECTORY');
  const text=read(p[0]),input=JSON.parse(text);
  if(!input.as_of)throw Error('Initial data must include an explicit as_of observation time');
  const w=core.create(input,{as_of:input.as_of,workspace_id:input.workspace_id,demonstration:input.demonstration===true});
  w.bootstrap={original_filename:path.basename(p[0]),original_text:text,sha256:hash(text)};
  return outputEdition(w,p[1]);
 }
 if(command==='import'){
  if(p.length!==5)throw Error('import requires WORKSPACE.json TABLE INPUT.csv MAPPING.json NEW_OUTPUT_DIRECTORY');
  const w=workspace(p[0]),text=read(p[2]),mapping=JSON.parse(read(p[3]));
  const sourceHash=hash(text),id=mapping.source_id||'source-'+hash(core.stable({table:p[1],sha256:sourceHash,mapping}));
  return outputEdition(adapter.receive(w,p[1],text,mapping,{id,filename:path.basename(p[2]),sha256:sourceHash}),p[4]);
 }
 if(command==='action'){
  if(p.length!==3)throw Error('action requires WORKSPACE.json ACTION.json NEW_OUTPUT_DIRECTORY');
  return outputEdition(core.apply(workspace(p[0]),JSON.parse(read(p[1]))),p[2]);
 }
 if(command==='analyze'){
  if(p.length!==1)throw Error('analyze requires WORKSPACE.json');
  return core.analyze(workspace(p[0]));
 }
 if(command==='export'){
  if(p.length!==2)throw Error('export requires WORKSPACE.json NEW_OUTPUT_DIRECTORY');
  return outputEdition(workspace(p[0]),p[1]);
 }
 if(command==='verify'){
  if(p.length!==1)throw Error('verify requires EDITION_DIRECTORY');
  return verify(p[0]);
 }
 throw Error('Commands: demo | init | import | action | analyze | export | verify. See README.md for complete commands.');
}
if(require.main===module){try{process.stdout.write(json(main(process.argv.slice(2))));}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}}
module.exports={main,outputEdition,verify};
