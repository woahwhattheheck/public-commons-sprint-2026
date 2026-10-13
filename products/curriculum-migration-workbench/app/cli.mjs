#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import * as Model from './model.mjs';
import * as Curriculum from './curriculum-migration.mjs';
import {generateSdk} from './generate-sdk.mjs';
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const args=process.argv.slice(2),command=args.shift(),opts={};
for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||args[i+1]===undefined)throw Error('Options use --name value.');opts[args[i].slice(2)]=args[i+1];}
function required(k){if(!opts[k])throw Error('Missing --'+k);return opts[k];}
async function jsonFile(path){return JSON.parse(await readFile(resolve(path),'utf8'));}
async function readWorkspace(path){const p=await jsonFile(path);if(p.format==='curriculum-workspace-export.v1'){if(hash(Model.canonical(p.workspace))!==p.sha256)throw Error('Workspace checksum differs.');return Curriculum.receiveCurriculumWorkspace(p.workspace);}return Curriculum.receiveCurriculumWorkspace(p);}
async function output(path,value){const text=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(resolve(path),text,{flag:'wx',mode:0o600});return {path:resolve(path),bytes:Buffer.byteLength(text),sha256:hash(text)};}
const context=()=>({actor:required('actor'),at:new Date().toISOString()});
async function save(workspace){return output(required('out'),{format:'curriculum-workspace-export.v1',sha256:hash(Model.canonical(workspace)),workspace});}
try{
 let result;
 if(command==='help'||!command){
  process.stdout.write('Curriculum Migration Workbench\n\n'+[
   'summary --workspace FILE',
   'receive --workspace FILE --out NEW_FILE',
   'new-case --workspace FILE --case ID --name NAME --operation "GET /route" --edition ID --actor NAME --out NEW_FILE',
   'import-response --workspace FILE --case ID --lane original|candidate --status 200 --json BODY.json --source DESCRIPTION --actor NAME --out NEW_FILE',
   'map --workspace FILE --case ID --json MAPPINGS.json --actor NAME --out NEW_FILE',
   'compare --workspace FILE --case ID --actor NAME --out NEW_FILE',
   'edition --workspace FILE --json EDITION.json --actor NAME --out NEW_FILE',
   'asset --workspace FILE --file SOURCE --kind sql|hasura-metadata|drizzle|graphql-introspection|source-notes --name NAME --actor NAME --out NEW_FILE',
   'decision --workspace FILE --case ID --run ID --outcome accepted|changes-required --note TEXT --actor NAME --out NEW_FILE',
   'sdk --workspace FILE --edition ID --directory NEW_DIRECTORY',
   'curriculum-plan --workspace FILE --case ID --original-namespace NAME --candidate-namespace NAME [--mappings MAPPINGS.json] --actor NAME --out NEW_FILE',
   'curriculum-decision --workspace FILE --case ID --plan PLAN_ID --outcome accepted|changes-required --note TEXT --actor NAME --out NEW_FILE',
   'curriculum-report --workspace FILE --case ID --plan PLAN_ID [--out NEW_REPORT.json]'
  ].join('\n')+'\n\nEvery output is create-only. Original files remain available.\n');
 }else{
  let w=await readWorkspace(required('workspace'));
  if(command==='summary')result={workspace:w.id,revision:w.revision,cases:Model.portfolio(w),curriculum:Curriculum.curriculumPortfolio(w),editions:w.editions.map(e=>({id:e.id,...Model.sourceInventory(e)}))};
  else if(command==='receive')result=await save(w);
  else if(command==='new-case'){w=Model.addCase(w,{id:required('case'),name:required('name'),operationKey:required('operation'),sourceEditionId:required('edition'),targetEditionId:required('edition')},context());result=await save(w);}
  else if(command==='import-response'){w=Model.saveResponse(w,required('case'),required('lane'),{status:Number(required('status')),body:await jsonFile(required('json')),headers:opts.headers?await jsonFile(opts.headers):{},contentType:opts['content-type']||'application/json',provenance:{kind:'operator-file',label:required('source'),file:resolve(opts.json)}},context());result=await save(w);}
  else if(command==='map'){w=Model.updateCase(w,required('case'),{mappings:await jsonFile(required('json'))},context());result=await save(w);}
  else if(command==='compare'){w=Model.compareCase(w,required('case'),context());result={...await save(w),comparison:Model.portfolio(w).find(c=>c.id===opts.case)};}
  else if(command==='edition'){w=Model.addEdition(w,await jsonFile(required('json')),context());result=await save(w);}
  else if(command==='asset'){w=Model.addAsset(w,{id:'asset-'+createHash('sha256').update(await readFile(required('file'))).digest('hex'),name:required('name'),kind:required('kind'),content:await readFile(opts.file,'utf8')},context());result=await save(w);}
  else if(command==='decision'){w=Model.decide(w,required('case'),{runId:required('run'),outcome:required('outcome'),note:required('note')},context());result=await save(w);}
  else if(command==='curriculum-plan'){
    const caseId=required('case');
    w=Curriculum.planCurriculumCase(w,caseId,{
      namespaces:{original:required('original-namespace'),candidate:required('candidate-namespace')},
      mappings:opts.mappings?await jsonFile(opts.mappings):[]
    },context());
    result={...await save(w),curriculum:Curriculum.curriculumPortfolio(w).find(c=>c.caseId===caseId)};
  }
  else if(command==='curriculum-decision'){
    const caseId=required('case');
    w=Curriculum.decideCurriculumPlan(w,caseId,{planId:required('plan'),outcome:required('outcome'),note:required('note')},context());
    result={...await save(w),curriculum:Curriculum.curriculumPortfolio(w).find(c=>c.caseId===caseId)};
  }
  else if(command==='curriculum-report'){
    const caseId=required('case'),planId=required('plan'),c=w.cases.find(c=>c.id===caseId);
    if(!c)throw Error('Case not found.');
    const plan=c.curriculumPlans?.find(p=>p.id===planId);
    if(!plan)throw Error('Curriculum plan not found.');
    const report={format:'curriculum-migration-report.v1',workspace:w.id,revision:w.revision,caseId,
      plan:Model.copy(plan),reviewRows:Curriculum.curriculumReviewRows(plan),
      decisions:Model.copy((c.curriculumDecisions||[]).filter(d=>d.planId===planId))};
    result=opts.out?await output(opts.out,report):report;
  }
  else if(command==='sdk'){const ed=w.editions.find(e=>e.id===required('edition'));if(!ed)throw Error('Edition not found.');const generated=generateSdk(ed);const files=[];for(const f of generated.files){if(!/^[a-zA-Z0-9._-]+$/.test(f.path))throw Error('Unexpected SDK output path.');files.push(await output(resolve(required('directory'),f.path),f.content));}result={files,diagnostics:generated.diagnostics};}
  else throw Error('Unknown command. Use help.');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }
}catch(error){process.stderr.write(error.stack+'\n');process.exitCode=1;}
