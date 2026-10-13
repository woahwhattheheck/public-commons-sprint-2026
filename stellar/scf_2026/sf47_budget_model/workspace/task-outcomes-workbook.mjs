// MIT. Editable customer measurements through the original workbook reader and outcomes writer.
import {zipWorkspace} from '../../../../stellar-forge/developer-site/dist/onboarding.mjs';
import {sha256} from '../../../../stellar-forge/developer-site/dist/source-table-workspace.mjs';
import {workbookUpload, decodeWorkbookBytes, validateWorkbookSource, validateWorkbookProjection,
  MAX_WORKBOOK_PROJECT_BYTES} from './source-workbooks.mjs';

export const OUTCOMES_WORKBOOK_SCHEMA = 'stellar-forge.customer-outcomes-workbook.v1';
export const OUTCOMES_WORKBOOK_RETURN_SCHEMA = OUTCOMES_WORKBOOK_SCHEMA + '.return';
export const MAX_OUTCOMES_WORKBOOK_BYTES = 8 * 1024 * 1024;
const copy = value => JSON.parse(JSON.stringify(value));
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a,b) => canonical(a) === canonical(b);
const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(item=>JSON.parse(canonical(item)))
  : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])) : value);
const utf8 = value => new TextEncoder().encode(value);
const json = value => JSON.stringify(value,null,2)+'\n';
const nullable = value => value === '' ? null : value;
const text = value => value === null || value === undefined ? '' : String(value);
const need = (value, message) => { if (!value) throw new Error(message); };
const stable = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value);
const DATE = /^\d{4}-\d{2}-\d{2}T/;
const SCALARS = ['title','customer','task','unit','currency','status','conclusion',
  'comparison.decision','comparison.reason','installation.id','installation.revision'];
const METHOD = ['method_id','name','basis','observedAt','sourceReference','population','period',
  'output','quality','attemptedTasks','completedTasks','elapsedMinutes','notes'];
const OBSERVATION = ['id','action','label','status','conclusion','comparisonDecision',
  'comparisonReason','acceptanceStatus','acceptedBy','acceptedAt','acceptanceNote'];
export const OUTCOMES_WORKBOOK_SHEETS = Object.freeze([
  {name:'Comparison',headers:['field','value']},
  {name:'Methods',headers:METHOD},
  {name:'Recurring',headers:OBSERVATION},
  {name:'Effort',headers:['method_id','id','action','label','category','personMinutes','hourlyRate','notes']},
  {name:'Costs',headers:['method_id','id','action','label','amount','notes']},
  {name:'Selections',headers:['owner','kind','record_id','action']},
  {name:'Original',headers:['part','value']},
]);
const sheetByName = new Map(OUTCOMES_WORKBOOK_SHEETS.map(value=>[value.name,value]));
const blankMethod = () => ({name:'',basis:'UNRECORDED',observedAt:null,sourceReference:'',population:'',
  period:'',output:'',quality:'',attemptedTasks:null,completedTasks:null,elapsedMinutes:null,
  sourceIds:[],notes:'',effort:[],costs:[]});
const blankObservation = id => ({id,label:'',method:blankMethod(),comparison:{decision:'UNREVIEWED',reason:''},
  status:'DRAFT',conclusion:'',acceptance:{status:'PENDING',by:'',at:null,note:''},deploymentIds:[],purchaseIds:[]});
function get(object,path) { let value=object;for(const key of path.split('.'))value=value?.[key];return value; }
function set(object,path,value) {
  const keys=path.split('.');let target=object;
  for(const key of keys.slice(0,-1)){if(!plain(target[key]))target[key]={};target=target[key];}
  target[keys.at(-1)]=value;
}
function methods(document) {
  return [['baseline',document.baseline],['installed',document.installed],
    ...(document.followups||[]).map(row=>['observation:'+row.id,row.method])];
}
function methodMap(document) { return new Map(methods(document)); }
function verifyInputs(inputs) {
  need(plain(inputs)&&/^task-outcomes-[a-f0-9]{32}$/.test(inputs.id)&&
    Number.isSafeInteger(inputs.expectedRevision)&&inputs.expectedRevision>=0&&plain(inputs.document),
    'Use the complete original comparison input and revision.');
  const d=inputs.document;
  need(plain(d.baseline)&&plain(d.installed)&&plain(d.comparison)&&
    Array.isArray(d.deploymentIds)&&Array.isArray(d.purchaseIds)&&
    (d.followups===undefined||Array.isArray(d.followups)&&d.followups.length<=100),
    'Retain the complete original methods, observations and source selections.');
  const ids=new Set();
  for(const row of d.followups||[]){
    need(plain(row)&&stable(row.id)&&!ids.has(row.id)&&plain(row.method)&&plain(row.comparison)&&
      plain(row.acceptance)&&Array.isArray(row.deploymentIds)&&Array.isArray(row.purchaseIds),
      'Retain unique complete recurring observations.');
    ids.add(row.id);
  }
  for(const [id,m] of methods(d)){
    need(plain(m)&&Array.isArray(m.effort)&&Array.isArray(m.costs)&&Array.isArray(m.sourceIds)&&
      m.effort.length<=100&&m.costs.length<=100,'Retain all original work and cost rows for '+id+'.');
    for(const key of ['effort','costs']){
      const unique=new Set();
      for(const row of m[key]){
        need(plain(row)&&stable(row.id)&&!unique.has(row.id),'Retain unique original '+key+' identities for '+id+'.');
        unique.add(row.id);
      }
    }
  }
  return copy(inputs);
}
function requiredSheets(tables) {
  need(Array.isArray(tables)&&tables.length===OUTCOMES_WORKBOOK_SHEETS.length,
    'Receive every original measurement worksheet.');
  const result=new Map();
  for(const table of tables){
    const spec=sheetByName.get(table.name);
    need(spec&&!result.has(table.name)&&equal(table.headers,spec.headers)&&Array.isArray(table.rows),
      'Keep each original worksheet name and its exact headings.');
    need(table.rows.length<=30000,'The complete measurement worksheet exceeds 30,000 rows.');
    for(const row of table.rows)need(Array.isArray(row)&&row.length===spec.headers.length&&
      row.every(value=>typeof value==='string'),'Keep the complete original cell values.');
    result.set(table.name,table.rows.filter(row=>row.some(value=>value!=='')));
  }
  return result;
}
function action(value,where) {
  const result=value||'UPSERT';
  need(['UPSERT','REMOVE'].includes(result),where+': use UPSERT or REMOVE in the action column.');
  return result;
}
function uniqueRows(rows,key,where) {
  const seen=new Set();
  for(const row of rows){const id=key(row);need(!seen.has(id),where+': the same original identity occurs twice.');seen.add(id);}
}
export async function outcomeWorkbookTables(inputs, options={}) {
  inputs=verifyInputs(inputs);
  need(/^operation-[a-f0-9]{32}$/.test(options.caseId||'')&&/^[a-f0-9]{64}$/.test(options.planContentSha256||''),
    'Bind the workbook to its original case and selected plan.');
  const d=inputs.document, origin={schema:OUTCOMES_WORKBOOK_SCHEMA,caseId:options.caseId,
    planContentSha256:options.planContentSha256,inputs,
    unsavedFollowupIds:[...(options.unsavedFollowupIds||[])],createdAt:options.createdAt||new Date().toISOString()};
  const known=new Set((d.followups||[]).map(row=>row.id));
  need(origin.unsavedFollowupIds.every(id=>known.has(id))&&new Set(origin.unsavedFollowupIds).size===origin.unsavedFollowupIds.length,
    'Retain the original unique unsaved observation identities.');
  origin.inputsSha256=await sha256(canonical(inputs));
  const encoded=json(origin), originalRows=[];
  for(let offset=0,part=1;offset<encoded.length;part++){
    let end=Math.min(encoded.length,offset+16000);
    if(end<encoded.length&&/[\uD800-\uDBFF]/.test(encoded[end-1]))end--;
    originalRows.push([String(part),encoded.slice(offset,end)]);offset=end;
  }
  const rows={
    Comparison:SCALARS.map(field=>[field,text(get(d,field))]),
    Methods:methods(d).map(([id,m])=>[id,...METHOD.slice(1).map(field=>text(m[field]))]),
    Recurring:(d.followups||[]).map(row=>[row.id,'UPSERT',row.label,row.status,row.conclusion,
      row.comparison.decision,row.comparison.reason,row.acceptance.status,row.acceptance.by,text(row.acceptance.at),row.acceptance.note]),
    Effort:methods(d).flatMap(([id,m])=>m.effort.map(row=>[id,row.id,'UPSERT',row.label,row.category,
      text(row.personMinutes),text(row.hourlyRate),row.notes])),
    Costs:methods(d).flatMap(([id,m])=>m.costs.map(row=>[id,row.id,'UPSERT',row.label,text(row.amount),row.notes])),
    Selections:[],
    Original:originalRows,
  };
  for(const kind of ['deploymentIds','purchaseIds']){
    rows.Selections.push(...d[kind].map(id=>['comparison',kind,id,'UPSERT']));
    for(const row of d.followups||[])rows.Selections.push(...row[kind].map(id=>['observation:'+row.id,kind,id,'UPSERT']));
  }
  for(const [id,m] of methods(d))rows.Selections.push(...m.sourceIds.map(sourceId=>[id,'sourceIds',sourceId,'UPSERT']));
  return {origin,tables:OUTCOMES_WORKBOOK_SHEETS.map(spec=>({...copy(spec),rows:rows[spec.name]}))};
}
export async function receiveOutcomeWorkbookTables(tables, options={}) {
  const sheets=requiredSheets(tables),parts=sheets.get('Original');
  need(parts.length>0,'Retain the complete Original worksheet from the exported workbook.');
  uniqueRows(parts,row=>row[0],'Original');
  need(parts.every((row,index)=>row[0]===String(index+1)),'Retain all original source parts in their numeric order.');
  let origin;try{origin=JSON.parse(parts.map(row=>row[1]).join(''));}catch{throw Error('The Original worksheet does not contain its complete source.');}
  need(origin.schema===OUTCOMES_WORKBOOK_SCHEMA,'Choose the original customer outcomes workbook.');
  const base=verifyInputs(origin.inputs);
  need(await sha256(canonical(base))===origin.inputsSha256,'The retained original comparison differs from its source identity.');
  need([options.caseId,options.originCaseId].filter(Boolean).includes(origin.caseId)&&
    origin.planContentSha256===options.planContentSha256,'This workbook belongs to another original case or selected plan.');
  const d=copy(base.document),beforeMethods=methodMap(d),unsaved=new Set(origin.unsavedFollowupIds||[]);
  need([...unsaved].every(id=>(d.followups||[]).some(row=>row.id===id)),'Retain the original unsaved observation selection.');
  const scalarRows=sheets.get('Comparison');
  uniqueRows(scalarRows,row=>row[0],'Comparison');
  need(scalarRows.length===SCALARS.length&&scalarRows.every(row=>SCALARS.includes(row[0])),
    'Keep every original comparison field once.');
  const scalarValues=Object.fromEntries(scalarRows);
  for(const field of SCALARS.filter(field=>!field.startsWith('installation.')))set(d,field,scalarValues[field]);
  if(scalarValues['installation.id']===''&&scalarValues['installation.revision']==='')d.installation=null;
  else{
    need(/^installation-[a-f0-9]{32}$/.test(scalarValues['installation.id'])&&/^[1-9]\d*$/.test(scalarValues['installation.revision']),
      'Retain a complete original Installation ID and positive revision, or leave both empty.');
    d.installation={id:scalarValues['installation.id'],revision:Number(scalarValues['installation.revision'])};
  }
  const observations=sheets.get('Recurring');uniqueRows(observations,row=>row[0],'Recurring');
  const removed=new Set();
  for(const row of observations){
    const [id,operation,label,status,conclusion,decision,reason,accepted,by,at,note]=row;
    need(stable(id),'Recurring: enter a stable observation identity.');
    const existing=(d.followups||[]).find(item=>item.id===id),a=action(operation,'Recurring '+id);
    if(a==='REMOVE'){
      need(existing&&unsaved.has(id),'Retain saved observations. Only an original unsaved observation can be removed.');
      d.followups=d.followups.filter(item=>item.id!==id);removed.add(id);continue;
    }
    const next={...(existing||blankObservation(id)),label,status,conclusion,
      comparison:{decision,reason},acceptance:{status:accepted,by,at:nullable(at),note}};
    if(existing)d.followups[d.followups.indexOf(existing)]=next;
    else{d.followups||=[];d.followups.push(next);unsaved.add(id);}
  }
  need((d.followups||[]).length<=100,'Keep at most 100 complete recurring observations.');
  const lookup=methodMap(d),methodRows=sheets.get('Methods');uniqueRows(methodRows,row=>row[0],'Methods');
  const supplied=new Set();
  for(const row of methodRows){
    const id=row[0];
    if(id.startsWith('observation:')&&removed.has(id.slice(12)))continue;
    const m=lookup.get(id);need(m,'Methods: select baseline, installed or an observation listed in Recurring.');
    supplied.add(id);
    for(let column=1;column<METHOD.length;column++){
      const field=METHOD[column],value=row[column];
      m[field]=['observedAt','attemptedTasks','completedTasks','elapsedMinutes'].includes(field)?nullable(value):value;
    }
  }
  for(const [id] of lookup)need(supplied.has(id)||beforeMethods.has(id),'Supply the complete method for new observation '+id+'.');
  for(const [name,key] of [['Effort','effort'],['Costs','costs']]){
    const rows=sheets.get(name);uniqueRows(rows,row=>JSON.stringify(row.slice(0,2)),name);
    for(const row of rows){
      const [methodId,id,operation]=row;
      if(methodId.startsWith('observation:')&&removed.has(methodId.slice(12)))continue;
      const m=lookup.get(methodId);need(m&&stable(id),name+': retain an original method and stable row identity.');
      const i=m[key].findIndex(value=>value.id===id),a=action(operation,name+' '+id);
      if(a==='REMOVE'){need(i>=0,name+': cannot remove an unknown row.');m[key].splice(i,1);continue;}
      const next=key==='effort'?{id,label:row[3],category:row[4],personMinutes:nullable(row[5]),
        hourlyRate:nullable(row[6]),notes:row[7]}:{id,label:row[3],amount:nullable(row[4]),notes:row[5]};
      if(i<0)m[key].push(next);else m[key][i]=next;
      need(m[key].length<=100,'Keep at most 100 '+key+' rows in each complete method.');
    }
  }
  const selections=sheets.get('Selections');uniqueRows(selections,row=>JSON.stringify(row.slice(0,3)),'Selections');
  for(const [owner,kind,id,operation] of selections){
    if(owner.startsWith('observation:')&&removed.has(owner.slice(12)))continue;
    let target;
    if(kind==='sourceIds')target=lookup.get(owner);
    else if(['deploymentIds','purchaseIds'].includes(kind))target=owner==='comparison'?d:
      owner.startsWith('observation:')?(d.followups||[]).find(row=>row.id===owner.slice(12)):null;
    need(target&&Array.isArray(target[kind])&&stable(id),'Selections: use an original owner, reference kind and record identity.');
    const a=action(operation,'Selection '+id);
    if(a==='REMOVE')target[kind]=target[kind].filter(value=>value!==id);
    else if(!target[kind].includes(id))target[kind].push(id);
  }
  const returned=verifyInputs({...base,document:d});
  return {schema:OUTCOMES_WORKBOOK_RETURN_SCHEMA,origin,baseInputs:base,returnedInputs:returned,
    unsavedFollowupIds:[...unsaved].filter(id=>(d.followups||[]).some(row=>row.id===id)),
    tables:copy(tables)};
}
const MISSING = Object.freeze({missing:true});
function display(value) { return value===MISSING?{present:false}:{present:true,value:copy(value)}; }
function pointer(parts) { return '/'+parts.map(value=>String(value).replaceAll('~','~0').replaceAll('/','~1')).join('/'); }
function compareValue(a,b) { return a===MISSING||b===MISSING?a===b:equal(a,b); }
function keyed(values) { return Array.isArray(values)&&values.every(row=>plain(row)&&stable(row.id))&&new Set(values.map(row=>row.id)).size===values.length; }
export function reconcileOutcomeWorkbook(received,currentInputs,choices={}) {
  need(received?.schema===OUTCOMES_WORKBOOK_RETURN_SCHEMA&&plain(choices),'Receive a complete workbook before reviewing its changes.');
  const base=verifyInputs(received.baseInputs),current=verifyInputs(currentInputs),returned=verifyInputs(received.returnedInputs);
  need(current.id===base.id&&returned.id===base.id,'Continue the original comparison identity.');
  need(current.expectedRevision>=base.expectedRevision,'Reconcile the current saved comparison before receiving a workbook from a later revision.');
  if(current.expectedRevision>base.expectedRevision){
    const returnedIds=new Set((returned.document.followups||[]).map(row=>row.id));
    const currentIds=new Set((current.document.followups||[]).map(row=>row.id));
    need(!(base.document.followups||[]).some(row=>currentIds.has(row.id)&&!returnedIds.has(row.id)),
      'A newer comparison edition was saved after this workbook. Retain its observations and export a current workbook before removing an unsaved observation.');
  }
  const changes=[],conflicts=[],usedChoices=new Set();
  function merge(a,b,c,parts){
    const path=pointer(parts),changed=!compareValue(a,b);
    if(!changed)return c===MISSING?MISSING:copy(c);
    if(a!==MISSING&&b!==MISSING&&c!==MISSING&&plain(a)&&plain(b)&&plain(c)){
      const next={};
      for(const key of new Set([...Object.keys(a),...Object.keys(c),...Object.keys(b)])){
        const value=merge(own(a,key)?a[key]:MISSING,own(b,key)?b[key]:MISSING,own(c,key)?c[key]:MISSING,[...parts,key]);
        if(value!==MISSING)next[key]=value;
      }
      return next;
    }
    if(['sourceIds','deploymentIds','purchaseIds'].includes(parts.at(-1))&&
       [a,b,c].every(list=>Array.isArray(list)&&list.every(item=>typeof item==='string')&&new Set(list).size===list.length)){
      const original=new Set(a),returnedSet=new Set(b),currentSet=new Set(c),next=[];
      for(const id of new Set([...c,...b,...a])){
        const before=original.has(id),returnedHas=returnedSet.has(id),currentHas=currentSet.has(id);
        const include=returnedHas===before?currentHas:returnedHas;
        if(include)next.push(id);
        if(include!==currentHas)changes.push({path:pointer([...parts,'@'+id]),
          before:{present:currentHas,...(currentHas?{value:id}:{})},after:{present:include,...(include?{value:id}:{})}});
      }
      return next;
    }
    if(a!==MISSING&&b!==MISSING&&c!==MISSING&&keyed(a)&&keyed(b)&&keyed(c)){
      const maps=[a,b,c].map(list=>new Map(list.map(row=>[row.id,row]))),next=[];
      for(const id of new Set([...c.map(row=>row.id),...b.map(row=>row.id),...a.map(row=>row.id)])){
        const value=merge(...maps.map(map=>map.has(id)?map.get(id):MISSING),[...parts,'@'+id]);
        if(value!==MISSING)next.push(value);
      }
      return next;
    }
    if(compareValue(c,a)||compareValue(b,c)){
      if(!compareValue(b,c))changes.push({path,before:display(c),after:display(b)});
      return b===MISSING?MISSING:copy(b);
    }
    const selected=choices[path];
    need(selected===undefined||selected==='current'||selected==='returned','Choose current or returned for each actual conflict.');
    conflicts.push({path,original:display(a),current:display(c),returned:display(b),choice:selected||null});
    if(selected)usedChoices.add(path);
    if(selected==='returned'){
      changes.push({path,before:display(c),after:display(b),resolved:true});
      return b===MISSING?MISSING:copy(b);
    }
    return c===MISSING?MISSING:copy(c);
  }
  const document=merge(base.document,returned.document,current.document,['document']);
  for(const path of Object.keys(choices))need(usedChoices.has(path),'A saved conflict choice no longer matches the current complete draft. Review it again.');
  return {schema:OUTCOMES_WORKBOOK_RETURN_SCHEMA,inputs:verifyInputs({...current,document}),
    changes,conflicts,unresolved:conflicts.filter(row=>!row.choice).length,
    currentSignature:canonical(current),returnedSignature:canonical(returned),
    originalRevision:base.expectedRevision,currentRevision:current.expectedRevision,
    unsavedFollowupIds:[...new Set(received.unsavedFollowupIds||[])]};
}

const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL='http://schemas.openxmlformats.org/package/2006/relationships';
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function column(value){let out='';for(;value>0;value=Math.floor((value-1)/26))out=String.fromCharCode(65+(value-1)%26)+out;return out;}
function excelText(value){
  return text(value).replace(/_x([0-9a-fA-F]{4})_/g,'_x005F_x$1_')
    .replace(/[\u0000-\u0008\u000B-\u001F\uFFFE\uFFFF]/g,c=>'_x'+c.charCodeAt(0).toString(16).padStart(4,'0')+'_');
}
function cell(ref,value,style=0){
  need(text(value).length<=32767,'An original value exceeds one Excel text cell. Keep the complete JSON recovery for that value.');
  return '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(excelText(value))+'</t></is></c>';
}
function worksheet(headers,rows,{filter=true}={}){
  const all=[headers,...(rows.length?rows:[headers.map(()=>'')])],end=column(headers.length)+all.length;
  const data=all.map((row,index)=>'<row r="'+(index+1)+'">'+headers.map((_,col)=>cell(column(col+1)+(index+1),row[col]??'',index===0?1:0)).join('')+'</row>').join('');
  return XML+'<worksheet xmlns="'+MAIN+'"><dimension ref="A1:'+end+'"/><sheetViews><sheetView workbookViewId="0">'+
    '<pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'+
    '<sheetFormatPr defaultRowHeight="15"/><cols>'+headers.map((name,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+
      (/notes|Note|Reference|population|output|quality|value|conclusion|Reason/.test(name)?60:27)+'" customWidth="1"/>').join('')+
    '</cols><sheetData>'+data+'</sheetData>'+(filter?'<autoFilter ref="A1:'+column(headers.length)+Math.max(1,rows.length+1)+'"/>':'')+
    '<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>'+
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}
const STYLE=XML+'<styleSheet xmlns="'+MAIN+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'+
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill>'+
  '<fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAEAEA"/><bgColor indexed="64"/></patternFill></fill></fills>'+
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
  '<cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'+
  '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'+
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
export function outcomeWorkbookGuide(origin){
  return '# Customer outcome measurement workbook\n\n'+
    'Original comparison: '+origin.inputs.id+'; saved revision basis: '+origin.inputs.expectedRevision+'.\n'+
    'Original case: '+origin.caseId+'.\n\n'+
    '## Complete customer measurement\n\n'+
    'Edit a copy of measurements.xlsx. Keep the original complete JSON and the supplied workbook together. The Original worksheet retains the complete exported comparison and source identity. Leave that worksheet unchanged.\n\n'+
    '| Worksheet | Work |\n| --- | --- |\n'+
    '| Comparison | Customer, complete task, unit, currency, overall review and original Installation selection. |\n'+
    '| Methods | Prior, installed and each recurring method: source edition, population, period, output, quality, counts, elapsed time and notes. |\n'+
    '| Recurring | Stable observation ID, label, comparability review, conclusion and actual customer response. |\n'+
    '| Effort | Active person-minutes, applicable hourly rate, work category and original source note for each method. |\n'+
    '| Costs | Incremental non-labor amount and original source note for each method. |\n'+
    '| Selections | Existing case sources, deployments and purchase observations. |\n\n'+
    'All exported cells use exact text. Keep measured decimals as text with at most six decimal places. A blank measure means unknown; 0 is an entered zero. Preserve complete ISO observation/response timestamps, including their time zone and fractional seconds. Formulas are rejected on receiving; paste their reviewed literal values if they are useful inputs.\n\n'+
    'Keep stable IDs when correcting existing rows. Add a new row with its own stable ID. Add a recurring observation to both Recurring and Methods, with method_id observation: followed by that observation ID. Omitted existing rows are retained. To remove a work, cost or source-selection row, enter REMOVE in action; blank action means UPSERT. A previously saved observation remains in the history and can be corrected in the next edition. Only an originally unsaved observation can be removed.\n\n'+
    'Method IDs baseline and installed retain those original roles. Source selections use owner comparison for overall deployments/purchases; owner baseline, installed or observation:ID for sourceIds; owner observation:ID for its deploymentIds/purchaseIds. Every selected reference must already exist in the original case before its native preview can save.\n\n'+
    '## Receive and review the return\n\n'+
    'Open the original comparison in Customer task outcomes, choose its retained working draft, and receive the complete returned workbook. The maintained reader keeps the original XLSX, every selected cell and complete worksheet projections. Review the full changes and each conflict with edits made in the desk since export. Choose current or returned for conflicting fields; unchanged fields and independent edits remain intact.\n\n'+
    'Apply reviewed measurements retains the complete returned source through the original case attachment command and places the selected changes in this same draft. Then use the original Calculate preview and Save comparison controls. Those controls record the exact case version, actor, request and immutable comparison edition. If an attachment request was interrupted, recover that same request before applying the source again.\n\n'+
    'Download complete editor before handing unfinished work to another operator. It carries the full workbook, reviewed source projections, conflicts, choices and original request alongside the other drafts. After saving, Download full case carries the workbook attachment and all original comparison/source history. The selected report and two original CSV reports continue to describe the native saved comparison.\n\n'+
    'Active effort, elapsed turnaround and customer acceptance remain different fields. Enter the actual receiving person, response date and original response when recording acceptance. An accepted useful task can remain unvalued; the native calculator keeps missing cost or effort unknown. Each recurring observation is compared separately against its original baseline.\n';
}
export async function createOutcomeWorkbook(inputs,options={}){
  const result=await outcomeWorkbookTables(inputs,options),guide=outcomeWorkbookGuide(result.origin);
  const tables=[...result.tables,{name:'Read me',headers:['Item','Detail'],rows:[
    ['Original comparison',inputs.id],['Revision basis',String(inputs.expectedRevision)],
    ['Source inputs SHA-256',result.origin.inputsSha256],
    ['Editing','Edit Comparison, Methods, Recurring, Effort, Costs and Selections. Keep Original unchanged.'],
    ['Numbers','Exact text; blank is unknown and 0 is entered zero. Keep at most six decimal places.'],
    ['Times','Original ISO text with its offset and complete fractional seconds.'],
    ['Removing rows','Omitting an existing row keeps it. Use REMOVE explicitly; saved observations remain in history.'],
    ['New recurring work','Add the stable ID in Recurring and matching observation:ID in Methods.'],
    ['Review','Receive the complete returned workbook; compare all changes and choose current or returned for each conflict.'],
    ['Save','Apply reviewed measurements, then calculate the native preview and save through the original case controls.'],
    ['Full receiving','Complete editor retains unfinished source/recovery. The original saved case carries the workbook attachment and all editions.'],
  ]}];
  const parts=tables.map((table,index)=>({path:'xl/worksheets/sheet'+(index+1)+'.xml',
    content:worksheet(table.headers,table.rows,{filter:!['Original','Read me'].includes(table.name)})}));
  parts.unshift({path:'[Content_Types].xml',content:XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
    tables.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'},
    {path:'_rels/.rels',content:XML+'<Relationships xmlns="'+PACKAGE_REL+'"><Relationship Id="workbook" Type="'+REL+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {path:'xl/workbook.xml',content:XML+'<workbook xmlns="'+MAIN+'" xmlns:r="'+REL+'"><workbookPr date1904="0"/><bookViews><workbookView activeTab="0"/></bookViews><sheets>'+
      tables.map((table,i)=>'<sheet name="'+xml(table.name)+'" sheetId="'+(i+1)+'"'+(table.name==='Original'?' state="hidden"':'')+' r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>'},
    {path:'xl/_rels/workbook.xml.rels',content:XML+'<Relationships xmlns="'+PACKAGE_REL+'">'+tables.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+REL+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+
      '<Relationship Id="styles" Type="'+REL+'/styles" Target="styles.xml"/></Relationships>'},
    {path:'xl/styles.xml',content:STYLE});
  const data=zipWorkspace(parts);
  need(data.length<=MAX_OUTCOMES_WORKBOOK_BYTES,'The complete measurement workbook exceeds the original 8 MiB case-attachment allowance.');
  const filename=inputs.id+'-measurements.xlsx',workbook={filename,data,bytes:data.length,sha256:await sha256(data)};
  const kitFiles=[{path:'measurements.xlsx',content:data},{path:'original-comparison.json',content:json(result.origin)},
    {path:'README.md',content:guide}];
  return {schema:OUTCOMES_WORKBOOK_SCHEMA,...result,parts,workbook,guide,
    kit:{filename:inputs.id+'-measurement-workbook.zip',data:zipWorkspace(kitFiles)},files:kitFiles};
}
function sourceRange(metadata,width){
  const match=/^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/.exec(metadata?.observedRange||'');
  need(match&&match[1]==='A'&&match[2]==='1'&&(match[3]||match[1])===column(width),
    'Keep the original worksheet columns beginning at A1; its complete returned range will be read.');
  return 'A1:'+column(width)+Math.max(2,Number(match[4]||match[2]));
}
function mapping(spec,range){
  const decimal=new Set(['personMinutes','hourlyRate','amount','attemptedTasks','completedTasks','elapsedMinutes']);
  return {schema:'stellar-forge.planning-workbook-mapping.v1',plan:{
    name:'Customer measurement '+spec.name,notes:'Complete literal customer measurements; original workbook and cells retained.',
    sheet:spec.name,range,headerRow:1,hiddenRows:'include',blankRows:'skip',mergedCells:'reject',
    columns:spec.headers.map((name,index)=>({name,source:column(index+1),blank:'empty',formula:'reject',
      error:'reject',date:'raw',trim:false,valueMap:[]}))},
    numericText:Object.fromEntries(spec.headers.map(name=>[name,decimal.has(name)?'decimal':'source']))};
}
export async function receiveOutcomeWorkbook(upload,options={}){
  need(typeof options.inspectWorkbook==='function'&&typeof options.projectWorkbook==='function',
    'Use the maintained native workbook inspection and projection functions.');
  need(upload?.bytes>0&&upload.bytes<=MAX_OUTCOMES_WORKBOOK_BYTES,'Choose a complete workbook within the original 8 MiB case-attachment allowance.');
  let source=upload;const tables=[],projections=[];
  for(const spec of OUTCOMES_WORKBOOK_SHEETS){
    const inspected=await options.inspectWorkbook({source,preview:{sheet:spec.name,offset:0,limit:1}});
    await validateWorkbookSource(inspected.source);source=inspected.source;
    const header=inspected.preview.rows[0]?.cells;
    need(Array.isArray(header)&&header.length===spec.headers.length&&header.every((value,index)=>
      text(value.value)===spec.headers[index]&&!value.formula),'Keep the exact original '+spec.name+' headings.');
    const selected=mapping(spec,sourceRange(inspected.preview.metadata,spec.headers.length));
    const projected=await options.projectWorkbook({source,mapping:selected});
    await validateWorkbookSource(projected.source);source=projected.source;
    const body=await validateWorkbookProjection(projected.projection,source);
    tables.push({name:spec.name,headers:[...spec.headers],rows:body.rows.map(row=>row.cells.map(cell=>cell.output))});
    projections.push({sheet:spec.name,projection:copy(projected.projection)});
  }
  const received=await receiveOutcomeWorkbookTables(tables,options);
  const result={...received,source:copy(source),projections,receivedAt:options.receivedAt||new Date().toISOString()};
  need(utf8(json(result)).length<=MAX_WORKBOOK_PROJECT_BYTES,'The complete workbook and its original selected cells exceed the 32 MiB editor allowance.');
  return result;
}
export async function validateOutcomeWorkbookReturn(value,options={}){
  need(value?.schema===OUTCOMES_WORKBOOK_RETURN_SCHEMA&&Array.isArray(value.projections),
    'Receive the complete original workbook review.');
  await validateWorkbookSource(value.source);
  const tables=[];
  for(const spec of OUTCOMES_WORKBOOK_SHEETS){
    const selected=value.projections.filter(row=>row.sheet===spec.name);
    need(selected.length===1,'Retain every exact original selected worksheet once.');
    const body=await validateWorkbookProjection(selected[0].projection,value.source);
    need(body.mapping.plan.sheet===spec.name&&equal(body.mapping.plan.columns.map(row=>row.name),spec.headers),
      'Retain the original measurement sheet and complete column selections.');
    tables.push({name:spec.name,headers:[...spec.headers],rows:body.rows.map(row=>row.cells.map(cell=>cell.output))});
  }
  need(value.projections.length===OUTCOMES_WORKBOOK_SHEETS.length,'Retain the complete supported worksheet selection.');
  const replay=await receiveOutcomeWorkbookTables(tables,options);
  need(equal(replay.baseInputs,value.baseInputs)&&equal(replay.returnedInputs,value.returnedInputs)&&
    equal(replay.unsavedFollowupIds,value.unsavedFollowupIds),
    'The complete retained workbook review differs from its selected original cells.');
  return {...copy(value),...replay};
}
export {workbookUpload,decodeWorkbookBytes};
