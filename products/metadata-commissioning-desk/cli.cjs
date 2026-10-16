#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createMetadataDesk}=require('./model.js'),{sha256Utf8}=require('./sha256.js'),{reportHTML,portableHTML}=require('./render.cjs');
const M=createMetadataDesk({hash:sha256Utf8,uuid:()=>crypto.randomUUID(),now:()=>new Date().toISOString()});
function read(p){return fs.readFileSync(p,'utf8');}
function write(p,text){const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(read(p)!==text)throw Error('Output readback differs: '+p);}
function workspace(p){const x=JSON.parse(read(p));const w=M.validate(x.working||x);return {schema:'tjl.datahub.working-file.v1',working:w,rawDraft:typeof x.rawDraft==='string'?x.rawDraft:''};}
function json(x){return JSON.stringify(x,null,2)+'\n';}
function sources(){return{index:read(path.join(__dirname,'index.html')),style:read(path.join(__dirname,'style.css')),sha:read(path.join(__dirname,'sha256.js')),model:read(path.join(__dirname,'model.js')),app:read(path.join(__dirname,'app.js'))};}
function main(argv){
 const [command,...args]=argv;
 if(command==='new'&&args.length===2){write(args[1],json({schema:'tjl.datahub.working-file.v1',working:M.newWorkspace(args[0]),rawDraft:''}));return;}
 if(command==='import'&&args.length===3){const p=workspace(args[0]),s=M.importObservation(p.working,read(args[1]),path.basename(args[1]));if(s.observation.target_url)p.working.selection.target_url=s.observation.target_url;write(args[2],json(p));return;}
 if(command==='run'&&args.length===3){const p=workspace(args[0]);M.receiveRun(p.working,read(args[1]));write(args[2],json(p));return;}
 if(command==='inspect'&&args.length===1){const p=workspace(args[0]);process.stdout.write(json({id:p.working.id,title:p.working.title,revision:p.working.revision,snapshots:p.working.snapshots.map(s=>({id:s.id,label:s.label,role:s.observation.role,entities:s.observation.entries.length})),proposals:p.working.proposals.length,runs:p.working.runs.length}));return;}
 if(command==='html'&&args.length===2){write(args[1],portableHTML(workspace(args[0]),sources()));return;}
 if(command==='export'&&args.length===2){
  const p=workspace(args[0]),r=M.report(p.working),directory=path.resolve(args[1]);fs.mkdirSync(directory,{mode:0o700});
  const output={'DataHub_Workspace.json':json(p),'DataHub_Editable.html':portableHTML(p,sources()),'DataHub_Comparison_Report.json':json(r),'DataHub_Comparison_Report.html':reportHTML(r),'DataHub_Aspect_Register.csv':M.csv(r.comparison.rows),'DataHub_Decisions.csv':M.csv(p.working.decisions),'DataHub_Relationships.csv':M.csv(r.relationships.edges)};
  for(const[name,text]of Object.entries(output))write(path.join(directory,name),text);
  write(path.join(directory,'DELIVERY_MANIFEST.json'),json({schema:'tjl.datahub.delivery.v1',workspace_id:p.working.id,revision:p.working.revision,files:Object.entries(output).map(([name,text])=>({name,...sha256Utf8(text)}))}));return;
 }
 throw Error('Usage: node cli.cjs new "Project" NEW.json | import WORKSPACE.json OBSERVATION.json NEW.json | run WORKSPACE.json NATIVE_RUN.json NEW.json | inspect WORKSPACE.json | html WORKSPACE.json NEW.html | export WORKSPACE.json NEW_DIRECTORY');
}
module.exports={main,workspace,sources};
if(require.main===module){try{main(process.argv.slice(2));}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}}
