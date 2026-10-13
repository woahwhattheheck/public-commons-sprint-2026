/** Editable coefficient evidence, bound to the original native profile and table.
 * Copyright TokenJunkieLabs. Scientific acceptance remains model.biophysical_evidence.
 */
export const SCHEMA='upstate.biophysical-evidence-authoring/v1';
export const FIELDS=Object.freeze(['lucode','parameter','value','units','load_type','source_title','source_uri','source_locator','source_period','lower','upper','range_basis','notes']);
export const EDITABLE=Object.freeze(FIELDS.slice(5));
export const FILTERS=Object.freeze(['all','unfinished','documented','unknown','ranged']);
const FIXED=FIELDS.slice(0,5);
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
export const cellKey=row=>row.lucode+':'+row.parameter;
function object(x,keys,label){
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))throw Error(label+' has unsupported fields.');
  return x;
}
function string(x,label){if(typeof x!=='string')throw Error(label+' must be text.');return x;}
function basis(catalog){
  if(!catalog?.workspace_id||!catalog?.profile?.id||!catalog?.table?.sha256||!Array.isArray(catalog.cells)||!catalog.cells.length)throw Error('Open the original profile coefficient catalog.');
  return {workspace_id:catalog.workspace_id,profile_id:catalog.profile.id,table_sha256:catalog.table.sha256,source_collection_id:catalog.table.source_collection_id,source_id:catalog.table.source_id,models:clone(catalog.profile.models)};
}
function fixed(cell){return {lucode:cell.lucode,parameter:cell.parameter,value:cell.table_value_text,units:cell.units,load_type:cell.load_type||''};}
function emptyRow(cell){return {...fixed(cell),...Object.fromEntries(EDITABLE.map(k=>[k,'']))};}
export function createDraft(catalog,{title,note='',evidence=null}={}){
  const binding=basis(catalog),draft={schema:SCHEMA,binding,title:title??((catalog.profile.title||'Profile')+' coefficient evidence'),note,origin_evidence_id:evidence?.id||null,rows:catalog.cells.map(emptyRow),view:{search:'',filter:'all',page:0,selected:[],batch:{source_title:'',source_uri:'',source_locator:'',source_period:'',notes:''}}};
  if(evidence){
    if(evidence.workspace_id!==binding.workspace_id||evidence.profile_id!==binding.profile_id||evidence.table?.sha256!==binding.table_sha256)throw Error('Choose evidence for the exact original table and profile.');
    const byKey=new Map(evidence.cells.map(cell=>[cellKey(cell),cell]));
    if(byKey.size!==draft.rows.length)throw Error('The evidence must retain all original coefficient cells.');
    for(const row of draft.rows){
      const cell=byKey.get(cellKey(row));
      if(!cell||canonical(fixed(cell))!==canonical(Object.fromEntries(FIXED.map(k=>[k,row[k]]))))throw Error('An evidence cell differs from its original coefficient.');
      if(cell.source)Object.assign(row,{source_title:cell.source.title||'',source_uri:cell.source.uri||'',source_locator:cell.source.locator||'',source_period:cell.source.period||'',notes:cell.source.notes||''});
      if(cell.range)Object.assign(row,{lower:cell.range.lower_text,upper:cell.range.upper_text,range_basis:cell.range.basis});
    }
  }
  inspectDraft(draft,catalog);return draft;
}
export function inspectDraft(draft,catalog){
  object(draft,['schema','binding','title','note','origin_evidence_id','rows','view'],'Working evidence');
  if(draft.schema!==SCHEMA)throw Error('Choose a complete coefficient evidence working JSON.');
  const binding=basis(catalog);
  if(canonical(draft.binding)!==canonical(binding))throw Error('This working evidence belongs to a different original workspace, profile, table or model scope.');
  string(draft.title,'Working title');string(draft.note,'Working note');
  if(draft.origin_evidence_id!==null&&typeof draft.origin_evidence_id!=='string')throw Error('The original evidence reference must be text or null.');
  if(!Array.isArray(draft.rows)||draft.rows.length!==catalog.cells.length)throw Error('Retain every original coefficient cell in order.');
  draft.rows.forEach((row,i)=>{
    object(row,FIELDS,'Coefficient row');
    if(FIELDS.some(k=>!own(row,k)))throw Error('Retain every original coefficient and working field.');
    if(!Number.isSafeInteger(row.lucode))throw Error('Land-cover codes must be exact integers.');
    const expected=fixed(catalog.cells[i]);
    for(const k of FIXED)if(row[k]!==expected[k])throw Error('Original '+k+' differs at '+cellKey(catalog.cells[i])+'.');
    for(const k of EDITABLE)string(row[k],k);
  });
  object(draft.view,['search','filter','page','selected','batch'],'Working view');
  object(draft.view.batch,['source_title','source_uri','source_locator','source_period','notes'],'Unapplied citation form');
  for(const key of ['source_title','source_uri','source_locator','source_period','notes'])string(draft.view.batch[key],'Unapplied '+key);
  string(draft.view.search,'Search');
  if(!FILTERS.includes(draft.view.filter)||!Number.isSafeInteger(draft.view.page)||draft.view.page<0||!Array.isArray(draft.view.selected))throw Error('The working view is invalid.');
  const keys=new Set(draft.rows.map(cellKey));
  if(draft.view.selected.some(k=>typeof k!=='string'||!keys.has(k))||new Set(draft.view.selected).size!==draft.view.selected.length)throw Error('Selected working cells must be distinct original coefficient keys.');
  return draft;
}
export function updateDraft(draft,patch,catalog){
  inspectDraft(draft,catalog);object(patch,['title','note','view'],'Working change');
  const next={...draft,...clone(patch)};
  inspectDraft(next,catalog);return next;
}
export function updateRows(draft,keys,patch,catalog){
  inspectDraft(draft,catalog);object(patch,EDITABLE,'Evidence cell change');
  if(Object.values(patch).some(v=>typeof v!=='string'))throw Error('Keep working cell edits as original text.');
  const chosen=new Set(keys),available=new Set(draft.rows.map(cellKey));
  if(!chosen.size||chosen.size!==keys.length||[...chosen].some(k=>!available.has(k)))throw Error('Choose distinct original coefficient cells.');
  const next={...draft,rows:draft.rows.map(row=>chosen.has(cellKey(row))?{...row,...patch}:row)};
  inspectDraft(next,catalog);return next;
}
const number=value=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())?Number(value):NaN;
function numeric(value,parameter){
  const n=number(value);
  if(!Number.isFinite(n))return 'Enter a finite numeric endpoint.';
  if(n<0||(['crit_len_n','crit_len_p'].includes(parameter)&&n===0))return 'The endpoint must be '+(parameter.startsWith('crit_len_')?'positive.':'nonnegative.');
  if(['eff_n','eff_p','proportion_subsurface_n','usle_c','usle_p'].includes(parameter)&&n>1)return 'This original coefficient has an upper bound of 1.';
  return null;
}
export function inspectRow(row){
  const v=Object.fromEntries(EDITABLE.map(k=>[k,row[k].trim()])),errors=[];
  const hasSource=Boolean(v.source_title||v.source_uri),hasRange=Boolean(v.lower||v.upper||v.range_basis);
  if(hasSource&&!(v.source_title&&v.source_uri))errors.push({field:v.source_title?'source_uri':'source_title',message:'A citation needs both its source title and URI.'});
  if(!hasSource&&EDITABLE.some(k=>v[k]))errors.push({field:'source_title',message:'Attach the actual source title and URI before source details or ranges.'});
  if(hasRange){
    if(!v.lower||!v.upper||!v.range_basis)errors.push({field:!v.lower?'lower':!v.upper?'upper':'range_basis',message:'A sourced range needs both endpoints and its basis.'});
    for(const k of ['lower','upper'])if(v[k]){const error=numeric(v[k],row.parameter);if(error)errors.push({field:k,message:error});}
    if(v.lower&&v.upper&&!errors.some(e=>['lower','upper'].includes(e.field))){
      const lo=number(v.lower),hi=number(v.upper),central=number(row.value);
      if(!(lo<=central&&central<=hi))errors.push({field:'lower',message:'Keep lower ≤ original central value ≤ upper.'});
    }
  }
  const documented=Boolean(v.source_title&&v.source_uri),status=errors.length?'unfinished':documented?'documented':'unknown';
  return {key:cellKey(row),status,documented,hasRange,rangeEligible:!errors.length&&hasRange&&number(v.lower)<number(v.upper),errors};
}
export function inspectRows(draft){
  const rows=draft.rows.map(inspectRow);
  return {rows,total:rows.length,unfinished:rows.filter(x=>x.errors.length).length,documented:rows.filter(x=>x.status==='documented').length,unknown:rows.filter(x=>x.status==='unknown').length,ranged:rows.filter(x=>!x.errors.length&&x.hasRange).length,rangeEligible:rows.filter(x=>x.rangeEligible).length};
}
export function visibleRows(draft,{pageSize=25}={}){
  const checks=inspectRows(draft),query=draft.view.search.toLocaleLowerCase();
  const rows=draft.rows.map((row,i)=>({row,...checks.rows[i]})).filter(item=>(draft.view.filter==='all'||draft.view.filter==='ranged'&&!item.errors.length&&item.hasRange||item.status===draft.view.filter)&&(!query||[item.row.lucode,item.row.parameter,...EDITABLE.map(k=>item.row[k])].join(' ').toLocaleLowerCase().includes(query)));
  const pages=Math.max(1,Math.ceil(rows.length/pageSize)),page=Math.min(draft.view.page,pages-1);
  return {rows:rows.slice(page*pageSize,(page+1)*pageSize),total:rows.length,pages,page,pageSize};
}
function quote(value){const s=String(value);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
export function toCSV(draft,catalog){
  inspectDraft(draft,catalog);
  if(Object.values(draft.view.batch).some(value=>value.trim()))throw Error('The citation form contains unapplied entries. Apply it to selected cells or explicitly clear it before creating completed evidence CSV.');
  const result=inspectRows(draft);
  if(result.unfinished)throw Error(result.unfinished+' coefficient cells contain unfinished evidence. Save working JSON to retain those edits, or complete them before registering CSV.');
  return [FIELDS,...draft.rows.map(row=>FIELDS.map(k=>row[k]))].map(row=>row.map(quote).join(',')).join('\n')+'\n';
}
/** Strict quoted CSV reader. Raw citation/newline text is preserved. */
export function parseCSV(input){
  string(input,'CSV');let source=input.replace(/^\uFEFF/,''),row=[],rows=[],field='',quoted=false,closed=false;
  const endField=()=>{row.push(field);field='';closed=false;};
  const endRow=()=>{endField();rows.push(row);row=[];};
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){if(c==='"'){if(source[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
    if(closed&&c!==','&&c!=='\r'&&c!=='\n')throw Error('Characters follow a closing CSV quote.');
    if(c==='"'){if(field)throw Error('A CSV quote appears inside an unquoted field.');quoted=true;}
    else if(c===',')endField();
    else if(c==='\r'||c==='\n'){if(c==='\r'&&source[i+1]==='\n')i++;endRow();}
    else field+=c;
  }
  if(quoted)throw Error('A CSV field has an unfinished quote.');
  if(field||closed||row.length)endRow();
  if(!rows.length)throw Error('The evidence CSV is empty.');
  const columns=rows.shift();
  if(columns.some(k=>!FIELDS.includes(k))||new Set(columns).size!==columns.length)throw Error('Evidence CSV headers must be distinct original field names.');
  if(['lucode','parameter','value','units','load_type','source_title','source_uri'].some(k=>!columns.includes(k)))throw Error('The evidence CSV is missing original coefficient or citation columns.');
  const records=[];
  for(let i=0;i<rows.length;i++){
    const values=rows[i];if(values.length===1&&values[0]==='')continue;
    if(values.length!==columns.length)throw Error('CSV row '+(i+2)+' has the wrong number of cells.');
    if(!values.some(v=>v.trim()))continue;
    const record=Object.fromEntries(FIELDS.map(k=>[k,'']));
    columns.forEach((k,j)=>record[k]=values[j]);
    if(!/^[+-]?\d+$/.test(record.lucode.trim())||!Number.isSafeInteger(Number(record.lucode)))throw Error('CSV row '+(i+2)+' needs an exact integer land-cover code.');
    record.lucode=Number(record.lucode);record.parameter=record.parameter.trim();
    records.push(record);
  }
  if(!records.length)throw Error('The evidence CSV contains no coefficient rows.');
  return records;
}
export function previewCSV(draft,input,catalog){
  inspectDraft(draft,catalog);
  const rows=parseCSV(input),original=new Map(draft.rows.map(row=>[cellKey(row),row])),seen=new Set(),changes=[];
  for(const row of rows){
    const key=cellKey(row),before=original.get(key);
    if(seen.has(key))throw Error('Duplicate evidence for '+key+'.');seen.add(key);
    if(!before)throw Error('The CSV selects a coefficient outside the original profile: '+key+'.');
    if(number(row.value)!==number(before.value)||row.units.trim()!==before.units||row.load_type.trim()!==before.load_type)throw Error('CSV value, units or load type differs from the original '+key+'.');
    const patch=Object.fromEntries(EDITABLE.map(k=>[k,row[k]]));
    changes.push({key,original:Object.fromEntries(FIXED.map(k=>[k,before[k]])),before:Object.fromEntries(EDITABLE.map(k=>[k,before[k]])),after:patch,changed:EDITABLE.some(k=>before[k]!==patch[k])});
  }
  return {schema:'upstate.biophysical-evidence-csv-preview/v1',binding:clone(draft.binding),changes,selectedRows:rows.length,changedRows:changes.filter(x=>x.changed).length,untouchedRows:draft.rows.length-rows.length};
}
export function mergeCSV(draft,preview,catalog){
  inspectDraft(draft,catalog);
  const next=clone(draft),byKey=new Map(next.rows.map(row=>[cellKey(row),row])),seen=new Set();
  if(preview?.schema!=='upstate.biophysical-evidence-csv-preview/v1'||canonical(preview.binding)!==canonical(draft.binding)||!Array.isArray(preview.changes)||!preview.changes.length)throw Error('Inspect the CSV for this exact original profile and table before applying it.');
  for(const change of preview.changes){
    const row=byKey.get(change.key);
    if(!row||seen.has(change.key)||canonical(Object.fromEntries(FIXED.map(k=>[k,row[k]])))!==canonical(change.original)||canonical(Object.fromEntries(EDITABLE.map(k=>[k,row[k]])))!==canonical(change.before))throw Error('A working cell changed after CSV inspection. Inspect the file again.');
    seen.add(change.key);object(change.after,EDITABLE,'Imported evidence');
    if(EDITABLE.some(k=>typeof change.after[k]!=='string'))throw Error('Imported evidence must retain all working fields.');
    Object.assign(row,change.after);
  }
  inspectDraft(next,catalog);return next;
}
