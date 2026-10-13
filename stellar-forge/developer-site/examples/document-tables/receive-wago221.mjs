#!/usr/bin/env node
// MIT. Operate the complete original WAGO document source through maintained Source Tables.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
  createProject,addDocumentTable,replaceMapping,resetMapping,freezeReview,
  importProject,createTableArchive,compareReviews
} from '../../dist/source-table-workspace.mjs';
import {projectDocumentTable,inspectDocumentTables} from '../../dist/source-document-tables.mjs';

const need=(v,m)=>{if(!v)throw new Error(m);};
const digest=v=>createHash('sha256').update(v).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const root=dirname(fileURLToPath(import.meta.url));
const destination=process.argv[2]&&resolve(process.argv[2]);
need(destination,'Usage: node receive-wago221.mjs NEW_OUTPUT_DIRECTORY [ORIGINAL_MERCHANT_DRAFT.json]');
await mkdir(destination,{recursive:false});
const write=async(name,content)=>{const target=resolve(destination,name);need(relative(destination,target)&&!relative(destination,target).startsWith('..')&&!isAbsolute(relative(destination,target)),'Keep all complete outputs in the selected directory.');await mkdir(dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'});return target;};
const source=JSON.parse(await readFile(resolve(root,'wago221-document-source.json'),'utf8'));
const selections=JSON.parse(await readFile(resolve(root,'wago221-table-selections.json'),'utf8'));
const starter=process.argv[3]?JSON.parse(await readFile(resolve(process.argv[3]),'utf8')):undefined;
const inspection=await inspectDocumentTables(source);
need(inspection.tables.length===6&&inspection.tables.reduce((n,t)=>n+t.cells.length,0)===356,'Retain all six original WAGO tables and 356 cells.');
let project=createProject({name:'WAGO supplier document tables',...(starter?{starter}: {})});
const received=[];
function mappingFor(project,documentId,tableIndex){
  const doc=project.documents.find(x=>x.id===documentId),mapping=structuredClone(doc.mapping);
  // Each source label is an explicit selection. Connector specs have repeated labels.
  mapping.keyColumns=tableIndex===2?[]:[0];
  if(tableIndex===1||tableIndex===4){
    const quantity=mapping.columns.find(c=>c.sourceName==='Qty');
    need(quantity,'The original sales quantity column is absent.');
    quantity.type='integer-text';quantity.empty='error';
  }
  return mapping;
}
for(const selection of selections){
  const projection=await projectDocumentTable(source,selection);
  const receivedTable=await addDocumentTable(project,{source,projection,
    filename:'wago-table-'+selection.tableIndex+'.csv',resourceId:'wago-table-'+selection.tableIndex});
  project=replaceMapping(receivedTable.project,receivedTable.documentId,mappingFor(receivedTable.project,receivedTable.documentId,selection.tableIndex));
  const reviewed=await freezeReview(project,receivedTable.documentId);project=reviewed.project;
  received.push({tableIndex:selection.tableIndex,documentId:receivedTable.documentId,editionId:receivedTable.editionId,
    reviewId:reviewed.review.id,projectionId:projection.id,rows:projection.rows.length});
}
need(received.map(x=>x.rows).join(',')==='11,14,6,6,6,9','Keep every selected original table row.');
const initialJson=json(project);await write('initial-project.json',initialJson);
project=await importProject(await readFile(resolve(destination,'initial-project.json'),'utf8'));
need(json(project)===initialJson,'The saved initial source project must reopen exactly.');
async function publish(name,project){
  const archived=await createTableArchive(project);
  const zipPath=await write(name+'.zip',archived.bytes);
  const expected=[];
  for(const file of archived.workspace.files){
    const content=typeof file.content==='string'?Buffer.from(file.content,'utf8'):Buffer.from(file.content);
    await write(name+'/'+file.path,content);
    expected.push({path:file.path,bytes:content.length,sha256:digest(content)});
  }
  const archiveRead=spawnSync(process.env.PYTHON||'python3',['-c',String.raw`
import base64,hashlib,json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    names=archive.namelist()
    if len(names)!=len(set(names)): raise ValueError("Duplicate archive member")
    bad=archive.testzip()
    if bad: raise ValueError("Bad archive CRC: "+bad)
    projects=[name for name in names if name.endswith("/source-tables/project.json")]
    if len(projects)!=1: raise ValueError("Choose the one complete Source Tables project")
    rows=[]
    for name in names:
        data=archive.read(name)
        rows.append({"path":name,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})
    print(json.dumps({"files":rows,"project_base64":base64.b64encode(archive.read(projects[0])).decode("ascii")}))
`,zipPath],{encoding:'utf8',maxBuffer:64*1024*1024});
  need(!archiveRead.error&&archiveRead.status===0,'Native archive receiving failed: '+(archiveRead.error?.message||archiveRead.stderr));
  const actual=JSON.parse(archiveRead.stdout),actualByPath=new Map(actual.files.map(f=>[f.path,f]));
  need(actual.files.length===expected.length&&expected.every(f=>JSON.stringify(actualByPath.get(f.path))===JSON.stringify(f)),'The complete native ZIP must preserve every exported member.');
  const portable=Buffer.from(actual.project_base64,'base64').toString('utf8');
  const reopened=await importProject(portable);
  need(json(reopened)===json(archived.workspace.project),'The exact embedded native project must independently reopen.');
  await write(name+'-archive-members.json',json(actual.files));
  return{zipPath,bytes:archived.bytes.length,sha256:digest(archived.bytes),members:actual.files.length,project:reopened};
}
const initial=await publish('wago-original-six-tables',project);
project=initial.project;
const first=received.find(r=>r.tableIndex===1);
const base=selections.find(s=>s.tableIndex===1);
const nextChoice={...structuredClone(base),columns:base.columns.filter(c=>c!==10)};
const nextProjection=await projectDocumentTable(source,nextChoice);
const next=await addDocumentTable(project,{source,projection:nextProjection,documentId:first.documentId,
  filename:'wago-connectors-without-drawing-link.csv'});
need(next.editionId!==first.editionId,'A changed source selection needs its distinct retained edition.');
project=resetMapping(next.project,first.documentId,{delimiter:',',header:true});
project=replaceMapping(project,first.documentId,mappingFor(project,first.documentId,1));
const nextReview=await freezeReview(project,first.documentId);project=nextReview.project;
const comparison=compareReviews(project.documents.find(d=>d.id===first.documentId),first.reviewId,nextReview.review.id);
need(comparison.summary.changed===11&&comparison.summary.added===0&&comparison.summary.removed===0,'The explicit column alternative must preserve the same eleven original sales identities.');
need(comparison.columns.removed.length===1&&comparison.columns.removed[0].name==='Drawing Link','Only the deliberately unselected Drawing Link column should leave the resource schema.');
const finalJson=json(project);await write('final-project.json',finalJson);
const finalReopen=await importProject(await readFile(resolve(destination,'final-project.json'),'utf8'));
need(json(finalReopen)===finalJson,'The final source-edition and review history must reopen exactly.');
const final=await publish('wago-following-selection',finalReopen);
await write('selection-comparison.json',json(comparison));
await write('source-document.json',json(source));
await write('initial-selections.json',json(selections));
await write('following-selection.json',json(nextChoice));
const result={schema:'stellar-forge.document-table-receiving.v1',completedAt:new Date().toISOString(),
  sourceId:source.id,sourceSha256:source.sha256,tables:6,originalCells:356,salesRows:17,
  received,initialArchive:{...initial,project:undefined},finalArchive:{...final,project:undefined},
  followingSelection:{documentId:first.documentId,editionId:next.editionId,reviewId:nextReview.review.id,
    description:'Operator projection alternative omits Drawing Link; original supplier source and every cell remain retained.',
    comparison:{summary:comparison.summary,columns:comparison.columns}},
  finalProject:{id:final.project.id,documents:final.project.documents.length,
    sourceEditions:final.project.documents.reduce((n,d)=>n+d.editions.length,0),
    reviews:final.project.documents.reduce((n,d)=>n+d.reviews.length,0)},
  runtime:{node:process.version,platform:process.platform,architecture:process.arch,python:process.env.PYTHON||'python3'}};
await write('DOCUMENT_TABLE_RECEIVING.json',json(result));process.stdout.write(json(result));
