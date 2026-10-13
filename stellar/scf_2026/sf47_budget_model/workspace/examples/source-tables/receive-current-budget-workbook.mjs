#!/usr/bin/env node
// MIT. Complete native workbook authoring, saved editions and receiving walkthrough.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {
  ROLES, createPlanningBook, planningRoleCsv, retainPlanningTableReview, sourceEditionComparison,
  serializePlanningBook, importPlanningBook, rebasePlanningBook, preparePlanningImport,
} from '../../source-tables-core.mjs';
import {parseTable} from '../../../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs';
import {runPlanningSourceTables} from '../../source-tables-cli.mjs';
import {workbookSelectionBody, workbookUpload} from '../../source-workbooks.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)), nativeCli=resolve(HERE,'../../cli.py');
const execute=promisify(execFile), json=value=>JSON.stringify(value,null,2)+'\n';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const names={packages:'Work packages',milestones:'Milestones',contributors:'Contributors',assignments:'Assignments'};
const WORKBOOK_WRITER=String.raw`
import json,sys,zipfile
from xml.etree.ElementTree import Element,SubElement,tostring
NS="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG="http://schemas.openxmlformats.org/package/2006/relationships"
CT="http://schemas.openxmlformats.org/package/2006/content-types"
def tag(name):return "{"+NS+"}"+name
def xml(node):return b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'+tostring(node,encoding="utf-8")
def column(value):
    text=""
    while value:
        value,mod=divmod(value-1,26);text=chr(65+mod)+text
    return text
source=json.load(open(sys.argv[1],encoding="utf-8"))
strings=[];indices={};string_uses=0
def string_id(value):
    global string_uses
    string_uses+=1
    value=str(value)
    if value not in indices:indices[value]=len(strings);strings.append(value)
    return indices[value]
sheets=[]
for index,sheet in enumerate(source["sheets"],1):
    root=Element(tag("worksheet"))
    all_rows=[sheet["headers"]]+sheet["rows"]
    SubElement(root,tag("dimension"),ref="A1:"+column(len(sheet["headers"]))+str(len(all_rows)))
    data=SubElement(root,tag("sheetData"))
    for row_number,values in enumerate(all_rows,1):
        attrs={"r":str(row_number)}
        if row_number in sheet.get("hiddenRows",[]):attrs["hidden"]="1"
        row=SubElement(data,tag("row"),attrs)
        for number,value in enumerate(values,1):
            address=column(number)+str(row_number)
            if isinstance(value,dict):
                cell=SubElement(row,tag("c"),r=address)
                SubElement(cell,tag("f")).text=value["formula"]
                SubElement(cell,tag("v")).text=value["cached"]
            elif row_number>1 and sheet["kinds"][number-1]=="number" and value!="":
                cell=SubElement(row,tag("c"),r=address)
                SubElement(cell,tag("v")).text=str(value)
            else:
                cell=SubElement(row,tag("c"),r=address,t="s")
                SubElement(cell,tag("v")).text=str(string_id(value))
    sheets.append((sheet,xml(root)))
workbook=Element(tag("workbook"))
SubElement(workbook,tag("workbookPr"),date1904="0")
sheet_list=SubElement(workbook,tag("sheets"))
for index,(sheet,raw) in enumerate(sheets,1):
    SubElement(sheet_list,tag("sheet"),{"name":sheet["name"],"sheetId":str(index),"{"+REL+"}id":"rId"+str(index),"state":sheet.get("state","visible")})
defined=SubElement(workbook,tag("definedNames"))
SubElement(defined,tag("definedName"),name="BudgetSelection").text="'Work packages'!$A$1:$K$"+str(len(source["sheets"][0]["rows"])+1)
SubElement(workbook,tag("calcPr"),calcId="0",calcMode="auto",fullCalcOnLoad="1")
rels=Element("{"+PKG+"}Relationships")
for index in range(1,len(sheets)+1):
    SubElement(rels,"{"+PKG+"}Relationship",Id="rId"+str(index),Type=REL+"/worksheet",Target="worksheets/sheet"+str(index)+".xml")
SubElement(rels,"{"+PKG+"}Relationship",Id="strings",Type=REL+"/sharedStrings",Target="sharedStrings.xml")
shared=Element(tag("sst"),count=str(string_uses),uniqueCount=str(len(strings)))
for value in strings:
    item=SubElement(shared,tag("si"));t=SubElement(item,tag("t"));t.set("{http://www.w3.org/XML/1998/namespace}space","preserve");t.text=value
types=Element("{"+CT+"}Types")
SubElement(types,"{"+CT+"}Default",Extension="rels",ContentType="application/vnd.openxmlformats-package.relationships+xml")
SubElement(types,"{"+CT+"}Default",Extension="xml",ContentType="application/xml")
SubElement(types,"{"+CT+"}Override",PartName="/xl/workbook.xml",ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")
SubElement(types,"{"+CT+"}Override",PartName="/xl/sharedStrings.xml",ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml")
for index in range(1,len(sheets)+1):
    SubElement(types,"{"+CT+"}Override",PartName="/xl/worksheets/sheet"+str(index)+".xml",ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")
root_rels=Element("{"+PKG+"}Relationships")
SubElement(root_rels,"{"+PKG+"}Relationship",Id="workbook",Type=REL+"/officeDocument",Target="xl/workbook.xml")
with zipfile.ZipFile(sys.argv[2],"x",compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml",xml(types));archive.writestr("_rels/.rels",xml(root_rels))
    archive.writestr("xl/workbook.xml",xml(workbook));archive.writestr("xl/_rels/workbook.xml.rels",xml(rels))
    archive.writestr("xl/sharedStrings.xml",xml(shared))
    for index,(_,raw) in enumerate(sheets,1):archive.writestr("xl/worksheets/sheet"+str(index)+".xml",raw)
print(json.dumps({"sheets":len(sheets),"sharedStrings":len(strings),"output":sys.argv[2]}))
`;
async function save(path,value) {
  await writeFile(path,typeof value==='string'?value:json(value),{flag:'wx',mode:0o600});return path;
}
async function native(args) {
  try {return JSON.parse((await execute('python3',[nativeCli,...args],{encoding:'utf8',maxBuffer:128*1024*1024})).stdout);}
  catch(error){throw new Error(String(error.stderr||error.message));}
}
function exactAdd(left,right) {
  const [a,b='']=String(left).split('.'),[c,d='']=String(right).split('.');
  const scale=Math.max(b.length,d.length),sum=BigInt(a+b.padEnd(scale,'0'))+BigInt(c+d.padEnd(scale,'0'));
  const value=sum.toString().padStart(scale+1,'0');
  return scale?value.slice(0,-scale)+'.'+value.slice(-scale):value;
}
function workbookRows(plan) {
  const sheets=[];
  for(const role of Object.keys(ROLES)) {
    const parsed=parseTable(planningRoleCsv(plan,role),{delimiter:',',header:true});
    const rows=parsed.rows.map(row=>row.cells),kinds=ROLES[role].fields.map(field=>['integer','decimal'].includes(field[2])?'number':'text');
    if(role==='packages') {
      const hours=parsed.headings.indexOf('estimated_hours'),amount=parsed.headings.indexOf('amount_usd');
      const rates=parsed.headings.indexOf('assumed_hourly_rate_usd');
      for(let index=0;index<rows.length;index++) {
        const row=rows[index],nativeRow=plan.scenario.future_costs[index];
        if(plan.planning.pricing?.[nativeRow.id]==='hours') row[amount]={formula:'E'+(index+2)+'*F'+(index+2),cached:String(nativeRow.amount_usd)};
        if(index===0)row[hours]+='E+0';
        need(rates===5&&hours===4&&amount===6,'Use the original native package column order for this workbook.');
      }
      const empty=Array(parsed.width).fill(''),control=Array(parsed.width).fill('');
      control[0]='Budget control total · retained hidden worksheet row';
      control[amount]={formula:'SUM(G2:G'+(rows.length+1)+')',cached:String(plan.scenario.award_request_usd)};
      rows.push(empty,control);
    }
    sheets.push({name:names[role],role,headers:parsed.headings,rows,kinds,
      ...(role==='packages'?{hiddenRows:[rows.length+1]}:{})});
  }
  sheets.push({name:'Workbook notes',role:'notes',state:'hidden',
    headers:['Item','Detail'],kinds:['text','text'],rows:[
      ['Source','Workbook representation of the complete saved native grant plan '+plan.id+', revision '+plan.revision+'.'],
      ['Formula result','The example stores the source amount with its package formula. The receiving operator explicitly selects the stored result; no spreadsheet calculation is performed by the importer.'],
      ['Capacity','The named example delivery owner and 40-hour weekly capacity are selected walkthrough inputs. Replace them with accountable contributors before operational use.'],
      ['Control row','The Work packages sheet retains a hidden source total and a blank row. Its saved projection explicitly excludes hidden rows and skips completely blank rows.'],
    ]});
  return {schema:'stellar-forge.planning-workbook-example.v1',sheets};
}
function mapping(sheet) {
  const columns=sheet.headers.map((name,index)=>{
    let value=index+1,letter='';while(value){value--;letter=String.fromCharCode(65+value%26)+letter;value=Math.floor(value/26);}
    return {name,source:letter,blank:'empty',formula:name==='amount_usd'?'cached':'reject',error:'reject',date:'raw',trim:false,valueMap:[]};
  });
  const last=columns.at(-1).source;
  return {schema:'stellar-forge.planning-workbook-mapping.v1',
    plan:{name:sheet.name+' from retained native budget',notes:'Reviewed complete source range with original cell values and explicit hidden/control-row choices.',
      sheet:sheet.name,range:'A1:'+last+(sheet.rows.length+1),headerRow:1,
      hiddenRows:'exclude',blankRows:'skip',mergedCells:'reject',columns},
    numericText:Object.fromEntries(columns.map((column,index)=>[column.name,sheet.kinds[index]==='number'?'decimal':'source']))};
}
async function makeWorkbook(root,name,plan) {
  const definition=workbookRows(plan),input=await save(join(root,name+'.source.json'),definition),path=join(root,name+'.xlsx');
  await execute('python3',['-c',WORKBOOK_WRITER,input,path],{encoding:'utf8',maxBuffer:1024*1024});
  return {path,definition};
}
function reviewedTypes(book,role) {
  const binding=book.bindings.find(row=>row.role===role),doc=book.project.documents.find(row=>row.id===binding.documentId);
  doc.mapping.keyColumns=ROLES[role].keys.map(key=>doc.mapping.columns.find(column=>column.sourceName===key).index);
  for(const column of doc.mapping.columns) {
    const kind=ROLES[role].fields.find(field=>field[0]===column.sourceName)?.[2];
    if(kind==='decimal')column.type='decimal-text';
    else if(kind==='integer')column.type='integer';
  }
  return book;
}
async function listenerCase(workspace,source,mapping,expectedHash) {
  const child=spawn('python3',[resolve(HERE,'../../server.py'),'--workspace',workspace,'--port','0'],{stdio:['ignore','pipe','pipe']});
  let stderr='',text='',timer;
  child.stderr.on('data',part=>{stderr+=part.toString();});
  const announcement=await new Promise((resolveReady,reject)=>{
    const fail=error=>{clearTimeout(timer);reject(error);};
    child.once('error',fail);child.once('exit',code=>fail(new Error('Original listener exited '+code+': '+stderr)));
    timer=setTimeout(()=>{child.kill('SIGTERM');fail(new Error('Original listener did not announce its access file.'));},30000);
    child.stdout.on('data',part=>{
      text+=part.toString();
      if(text.includes('\n')) {
        try {const ready=JSON.parse(text.split('\n')[0]);clearTimeout(timer);resolveReady(ready);}
        catch(error){fail(error);}
      }
    });
  });
  try {
    const token=(await readFile(join(workspace,'access.key'),'utf8')).trim();
    const request=async(path,body)=>{
      const response=await fetch(announcement.url+path,{method:body?'POST':'GET',
        headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:json(body)}:{})});
      const raw=await response.text();need(response.ok,'Original workbook route: '+raw);
      return body?JSON.parse(raw):raw;
    };
    const original=await workbookUpload(source.split(/[\\/]/).at(-1),new Uint8Array(await readFile(source)));
    const inspection=await request('/api/source-tables/workbook/inspect',{source:original,
      preview:{sheet:mapping.plan.sheet,range:mapping.plan.range,offset:0,limit:25},headerRow:mapping.plan.headerRow});
    const projection=await request('/api/source-tables/workbook/project',{source:inspection.source,mapping});
    need(workbookSelectionBody(projection.projection).csv.sha256===expectedHash,'Browser and CLI must use the same complete native workbook projection.');
    const module=await request('/source-workbooks.mjs');
    need(module.includes('createPlanningWorkbookIntake'),'The existing listener must serve the full workbook controls.');
    return {sameProjection:true,sheets:inspection.source.description.sheets.length,
      sourceBytes:inspection.source.bytes,worksheet:inspection.preview.metadata.name,browserModuleBytes:Buffer.byteLength(module)};
  } finally {
    if(child.exitCode===null&&child.signalCode===null) {
      const closed=new Promise(resolveClosed=>child.once('exit',resolveClosed));child.kill('SIGTERM');
      const timeout=setTimeout(()=>child.kill('SIGKILL'),10000);await closed;clearTimeout(timeout);
    }
  }
}
export async function receiveCurrentBudgetWorkbook(directory) {
  const root=resolve(directory);await mkdir(root,{mode:0o700});
  const workspace=join(root,'authoring'),receiver=join(root,'receiving');
  const seed=await native(['init','--workspace',workspace]),id=seed.plans[0]?.id;
  need(id,'The original planner must provide its retained candidate.');
  const original=await native(['show','--workspace',workspace,'--plan',id,'--part','all']);
  need(original.scenario.future_costs.length===6&&String(original.scenario.award_request_usd)==='38000',
    'Use the complete retained six-package budget for this operating walkthrough.');
  const example=JSON.parse(JSON.stringify(original));
  example.planning.contributors=[{id:'delivery-owner',name:'Example delivery owner',weeklyHours:'40',
    note:'Operator-selected walkthrough capacity; replace with the accountable contributor and confirmed capacity.'}];
  example.planning.assignments=original.scenario.future_costs.map(row=>({costId:row.id,contributorId:'delivery-owner',hours:String(row.estimated_hours)}));
  const firstWorkbook=await makeWorkbook(root,'current-budget',example);
  let book=createPlanningBook(original,{name:'Complete workbook budget and editable receiving'}),project=await save(join(root,'source-project-0.json'),serializePlanningBook(book));
  const inspections=await runPlanningSourceTables(['inspect-workbook','--file',firstWorkbook.path,'--sheet','Work packages',
    '--range','A1:K9','--header-row','1','--output',join(root,'workbook-inspection.json')]);
  const mappings={};
  for(const [index,role] of Object.keys(ROLES).entries()) {
    const selected=mapping(firstWorkbook.definition.sheets.find(sheet=>sheet.role===role));
    const path=await save(join(root,role+'.mapping.json'),selected);mappings[role]={path,value:selected};
    const next=join(root,'source-project-'+(index+1)+'.json');
    await runPlanningSourceTables(['receive-workbook','--project',project,'--role',role,'--file',firstWorkbook.path,
      '--mapping',path,'--output',next]);
    book=await importPlanningBook(await readFile(next,'utf8'));
    book=await retainPlanningTableReview(reviewedTypes(book,role),role);
    project=await save(join(root,'source-project-'+(index+1)+'-reviewed.json'),serializePlanningBook(book));
  }
  const firstPreview=join(root,'native-preview-1.json');
  const calculated1=await runPlanningSourceTables(['preview','--project',project,'--workspace',workspace,'--plan',id,'--output',firstPreview]);
  const first=await runPlanningSourceTables(['save','--preview',firstPreview,'--workspace',workspace,
    '--note','Reviewed every selected workbook row, stored formula result and complete native budget.',
    '--request-id','current-budget-workbook-first','--output-directory',join(root,'edition-1')]);
  const saved1=await readJson(join(root,'edition-1','plan.json'));
  const alternative=JSON.parse(JSON.stringify(saved1)),changedPackage=alternative.scenario.future_costs[0];
  need(alternative.planning.pricing[changedPackage.id]==='hours','Choose the original hours-priced package for the reviewed one-hour edition.');
  changedPackage.estimated_hours=exactAdd(changedPackage.estimated_hours,'1');
  changedPackage.amount_usd=exactAdd(changedPackage.amount_usd,changedPackage.assumed_hourly_rate_usd);
  alternative.scenario.award_request_usd=exactAdd(alternative.scenario.award_request_usd,changedPackage.assumed_hourly_rate_usd);
  const secondWorkbook=await makeWorkbook(root,'reviewed-budget-edition',alternative);
  book=rebasePlanningBook(await importPlanningBook(saved1.planning.sourceTables),saved1);
  project=await save(join(root,'rebased-project.json'),serializePlanningBook(book));
  const receivedSecond=join(root,'workbook-edition-2-project.json');
  await runPlanningSourceTables(['receive-workbook','--project',project,'--role','packages','--file',secondWorkbook.path,
    '--mapping',mappings.packages.path,'--output',receivedSecond]);
  book=await retainPlanningTableReview(await importPlanningBook(await readFile(receivedSecond,'utf8')),'packages');
  book.settings.awardRequestUsd=String(alternative.scenario.award_request_usd);
  book.settings.scenarioName=original.scenario.scenario_name+' — reviewed workbook one-hour edition';
  const comparison=sourceEditionComparison(book,'packages');
  project=await save(join(root,'reviewed-project-2.json'),serializePlanningBook(book));
  await save(join(root,'workbook-edition-comparison.json'),comparison);
  const secondPreview=join(root,'native-preview-2.json');
  const calculated2=await runPlanningSourceTables(['preview','--project',project,'--workspace',workspace,'--plan',id,'--output',secondPreview]);
  const saveArgs=['save','--preview',secondPreview,'--workspace',workspace,
    '--note','Reviewed the second original workbook, one changed package and complete recalculated native plan.',
    '--request-id','current-budget-workbook-second','--output-directory',join(root,'edition-2')];
  const second=await runPlanningSourceTables(saveArgs),replay=await runPlanningSourceTables(saveArgs);
  need(json(second)===json(replay),'The original save request must return its identical complete delivery.');
  const saved2=await readJson(join(root,'edition-2','plan.json'));
  const imported=await native(['import-bundle','--workspace',receiver,'--file',join(root,'edition-2','planning.zip'),
    '--name','Received complete workbook planning case','--request-id','current-budget-workbook-receiving']);
  const received=await native(['show','--workspace',receiver,'--plan',imported.plan.id,'--part','all']);
  const reopened=await importPlanningBook(received.planning.sourceTables);
  const continuation=rebasePlanningBook(reopened,received),prepared=await preparePlanningImport(continuation);
  need(received.contentSha256===saved2.contentSha256&&reopened.workbookSources.length===2&&reopened.workbookSelections.length===5&&
    prepared.review.sourceRows.length===16&&prepared.review.sourceRows.every(row=>row.workbook),
    'Receive both original workbooks, all five saved selections and every source row in the editable native case.');
  need(String(calculated1.hours)==='400'&&String(calculated1.awardRequestUsd)==='38000'&&
    String(calculated2.hours)==='401'&&String(calculated2.awardRequestUsd)==='38095'&&
    comparison.summary.changed===1&&comparison.summary.unchanged===5,
    'Read the original complete budget and separately reviewed one-hour workbook result.');
  const selected=book.workbookSelections.find(row=>row.id===book.selectedWorkbooks[book.bindings.find(row=>row.role==='packages').documentId]);
  const selectedBody=workbookSelectionBody(selected);
  const listener=await listenerCase(receiver,secondWorkbook.path,mappings.packages.value,selectedBody.csv.sha256);
  const output=await runPlanningSourceTables(['export-workbooks','--project',project,'--output-directory',join(root,'portable-workbook-materials')]);
  await save(join(root,'received-source-project.json'),serializePlanningBook(continuation));
  const result={schema:'stellar-forge.planning-workbook.receiving-walkthrough.v1',
    originalPlan:{id:original.id,revision:original.revision,contentSha256:original.contentSha256},
    workbooks:reopened.workbookSources.map(source=>({filename:source.filename,bytes:source.bytes,sha256:source.sha256,
      sheets:source.description.sheets.length})),sourceRoles:reopened.bindings.map(row=>row.role),
    selectedWorksheets:reopened.workbookSelections.length,sourceRows:prepared.review.sourceRows.length,
    allRowsRetainWorkbookCells:true,
    originalBudget:{hours:calculated1.hours,awardRequestUsd:calculated1.awardRequestUsd},
    reviewedEdition:{hours:calculated2.hours,awardRequestUsd:calculated2.awardRequestUsd},
    sourceComparison:comparison.summary,storedFormulaCells:selectedBody.rows.reduce((n,row)=>n+row.cells.filter(cell=>cell.original.formula).length,0),
    exactDecimalExpansions:selectedBody.transformations.length,excludedWorksheetRanges:selectedBody.excludedRanges,
    first,second,identicalRequestReplay:true,received:{id:received.id,revision:received.revision,contentSha256:received.contentSha256},
    browserListener:listener,portableWorkbookFiles:output.artifacts.length,
    originalWorkbookInspection:inspections};
  await save(join(root,'WORKBOOK_RECEIVING.json'),result);return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2]||process.argv[2]==='--help')process.stdout.write(
    'node receive-current-budget-workbook.mjs NEW_PRIVATE_DIRECTORY\nRuns complete original-workbook selection, four planning roles, native preview/save/replay, portable ZIP and editable receiving.\n');
  else receiveCurrentBudgetWorkbook(process.argv[2]).then(result=>process.stdout.write(json(result))).catch(error=>{
    process.stderr.write(json({error:error.message}));process.exitCode=1;
  });
}
