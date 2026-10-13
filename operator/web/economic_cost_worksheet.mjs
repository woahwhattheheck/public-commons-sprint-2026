/** Portable reviewed cost worksheets for the original economic report and zone. */
export const WORKSHEET_SCHEMA = 'upstate.economic-cost-worksheet/v1';
const fields = ['worksheet_schema','project_id','report_id','report_sha256','zone_id',
  'run_id','scenario_label','include_cost','currency','capital','annual_operating',
  'horizon_years','discount_percent','cost_scope','source_title','source_uri',
  'source_as_of','note','retained_cost_json'];
const editable = ['enabled','currency','capital','annual_operating','horizon_years',
  'discount_percent','cost_scope','source_title','source_uri','source_as_of','note'];
const copy = value => JSON.parse(JSON.stringify(value));
const plain = value => value && typeof value==='object' && !Array.isArray(value);
const text = value => String(value ?? '');

function identity(source,draft) {
  if(!source || !draft || source.producer_report_id!==draft.reportId ||
    source.source?.sha256!==draft.reportSha)throw Error('Choose the original completed report before using a cost worksheet.');
  if(!source.zones?.some(zone=>zone.zone_id===draft.zoneId))throw Error('Choose this report’s original reporting zone.');
  return {project_id:text(source.project?.id),report_id:draft.reportId,
    report_sha256:draft.reportSha,zone_id:draft.zoneId};
}
function quote(value) { return '"'+text(value).replaceAll('"','""')+'"'; }
function literal(value) { return "'"+text(value); }
function unliteral(value) { return value.startsWith("'")?value.slice(1):value; }

function parseCSV(input) {
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  const source=input.replace(/^\uFEFF/,'');
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(quoted){
      if(c==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}
      else cell+=c;
      continue;
    }
    if(c==='"'){
      if(cell!==''||closed)throw Error('CSV contains a quote outside a quoted field near row '+(rows.length+1)+'.');
      quoted=true;continue;
    }
    if(c===','||c==='\n'||c==='\r'){
      row.push(cell);cell='';closed=false;
      if(c!==','){
        if(c==='\r'&&source[i+1]==='\n')i++;
        if(row.some(value=>value!==''))rows.push(row);
        row=[];
      }
    }else{
      if(closed)throw Error('CSV has text after a closing quote near row '+(rows.length+1)+'.');
      cell+=c;
    }
  }
  if(quoted)throw Error('CSV ends inside a quoted field.');
  if(cell!==''||row.length||closed){row.push(cell);if(row.some(value=>value!==''))rows.push(row);}
  if(rows.length<2)throw Error('The worksheet needs its original header and at least one scenario row.');
  const header=rows.shift();
  if(new Set(header).size!==header.length)throw Error('The worksheet contains duplicate column names.');
  const missing=fields.filter(key=>!header.includes(key)),unknown=header.filter(key=>!fields.includes(key));
  if(missing.length||unknown.length)throw Error('Use the exported cost worksheet columns. Missing: '+(missing.join(', ')||'none')+'. Unknown: '+(unknown.join(', ')||'none')+'.');
  return rows.map((values,index)=>{
    if(values.length!==header.length)throw Error('CSV row '+(index+2)+' has '+values.length+' fields; the header has '+header.length+'.');
    const record={};
    header.forEach((key,j)=>record[key]=unliteral(values[j]));
    let retained={};
    if(record.retained_cost_json.trim()){
      try{retained=JSON.parse(record.retained_cost_json);}catch(_){throw Error('CSV row '+(index+2)+' has invalid retained_cost_json. Keep the original exported cell.');}
      if(!plain(retained))throw Error('CSV row '+(index+2)+' has an invalid retained cost record.');
    }
    const value={...retained};
    for(const key of editable)if(key!=='enabled')value[key]=record[key];
    value.enabled=record.include_cost;
    return {identity:record,run_id:record.run_id,label:record.scenario_label,value,row:index+2};
  });
}
function boolean(value) {
  if(value===true||value===1||['yes','true','1'].includes(text(value).trim().toLowerCase()))return true;
  if(value===false||value===0||['','no','false','0'].includes(text(value).trim().toLowerCase()))return false;
  throw Error('include_cost must be yes or no.');
}
function numeric(value,label,positive=false) {
  const raw=text(value).trim();
  if(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))throw Error(label+' needs a plain nonnegative number.');
  const result=Number(raw);
  if(!Number.isFinite(result)||result<0||(positive&&result<=0))throw Error(label+' must be '+(positive?'positive':'nonnegative')+' and finite.');
  return result;
}
function calendar(value) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [year,month,day]=value.split('-').map(Number);
  const days=[31,(year%4===0&&(year%100!==0||year%400===0))?29:28,31,30,31,30,31,31,30,31,30,31];
  return year>=1&&month>=1&&month<=12&&day>=1&&day<=days[month-1];
}
function cleanCost(input,before,zone,source) {
  if(!plain(input))throw Error('A scenario needs its original cost record.');
  const value={...copy(input),...copy(before||{})};
  for(const key of editable)if(Object.prototype.hasOwnProperty.call(input,key))value[key]=copy(input[key]);
  value.enabled=boolean(value.enabled);
  for(const key of editable.filter(key=>!['enabled','capital','annual_operating','horizon_years','discount_percent'].includes(key)))
    value[key]=text(value[key]);
  if(!value.enabled)return value;
  value.currency=value.currency.trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(value.currency))throw Error('Cost currency needs three letters, such as USD.');
  for(const key of ['capital','annual_operating','horizon_years','discount_percent'])
    value[key]=numeric(value[key],key.replaceAll('_',' '),key==='horizon_years');
  for(const key of ['source_title','source_uri','source_as_of'])value[key]=value[key].trim();
  if(!value.source_title||!value.source_uri)throw Error('Include the actual estimate source title and document reference.');
  if(!calendar(value.source_as_of))throw Error('Source as of needs an actual ISO calendar date.');
  if(!['whole-scenario','reporting-zone','retained'].includes(value.cost_scope))
    throw Error('Cost footprint must be whole-scenario or reporting-zone.');
  if(value.cost_scope==='retained'&&!plain(value.originalCost?.scope))
    throw Error('A retained footprint needs its original scope record; otherwise choose the actual cost footprint.');
  const oldZone=value.needs_scope_review || (value.estimate_zone_id&&value.estimate_zone_id!==zone.zone_id
    ? {zone_id:value.estimate_zone_id,zone_title:value.estimate_zone_title,producer_report_id:value.estimate_report_id}:null);
  if(oldZone)value.reviewed_from=copy(oldZone);
  delete value.needs_scope_review;
  if(value.cost_scope!=='whole-scenario'){
    value.estimate_zone_id=zone.zone_id;value.estimate_zone_title=zone.title;
    value.estimate_report_id=source.producer_report_id;
  }
  return value;
}

export function exportCostWorksheet(source,draft,format='csv') {
  const bound=identity(source,draft);
  const rows=(source.alternatives||[]).map(scenario=>{
    const retained=copy(draft.costs?.[scenario.run_id]||{});
    const value={...retained,enabled:!!retained.enabled,currency:retained.currency||draft.currency||'USD'};
    return {run_id:scenario.run_id,label:scenario.label,value};
  });
  const name='cost-worksheet-'+bound.report_id.slice(0,12)+'-'+bound.zone_id.replace(/[^a-zA-Z0-9_-]/g,'_');
  if(format==='json')return {filename:name+'.json',mimeType:'application/json',
    content:JSON.stringify({schema:WORKSHEET_SCHEMA,identity:bound,
      title:draft.title,baseline_run_id:source.baseline_run_id,rows},null,2)+'\n'};
  if(format!=='csv')throw Error('Choose CSV or JSON for the cost worksheet.');
  const lines=[fields.map(quote).join(',')];
  for(const row of rows){
    const value=row.value,record={worksheet_schema:WORKSHEET_SCHEMA,...bound,
      run_id:row.run_id,scenario_label:row.label,include_cost:value.enabled?'yes':'no',
      retained_cost_json:JSON.stringify(value)};
    for(const key of editable)if(key!=='enabled')record[key]=value[key]??'';
    lines.push(fields.map(key=>quote(literal(record[key]))).join(','));
  }
  return {filename:name+'.csv',mimeType:'text/csv;charset=utf-8',content:'\uFEFF'+lines.join('\r\n')+'\r\n'};
}

export function previewCostWorksheet(input,{filename='',source,draft}={}) {
  if(typeof input!=='string')throw Error('Read the complete original worksheet file.');
  const bound=identity(source,draft),zone=source.zones.find(item=>item.zone_id===bound.zone_id);
  const trimmed=input.replace(/^\uFEFF/,'').trimStart();
  let rows,format;
  if(trimmed.startsWith('{')){
    format='json';let document;
    try{document=JSON.parse(trimmed);}catch(_){throw Error('The cost worksheet JSON is incomplete or invalid.');}
    if(document.schema!==WORKSHEET_SCHEMA||!plain(document.identity)||!Array.isArray(document.rows))
      throw Error('Choose a cost worksheet exported by this desk.');
    if(document.baseline_run_id!==source.baseline_run_id)throw Error('The cost worksheet belongs to another original baseline.');
    rows=document.rows.map((row,index)=>({identity:document.identity,run_id:row.run_id,
      label:row.label,value:row.value,row:index+1}));
  }else{format='csv';rows=parseCSV(input);}
  if(!rows.length)throw Error('The worksheet has no scenario rows.');
  const known=new Map(source.alternatives.map(row=>[row.run_id,row]));
  const seen=new Set(),changes=[],errors=[];
  for(const row of rows){
    const label='Row '+row.row;
    try{
      if(format==='csv'&&row.identity.worksheet_schema!==WORKSHEET_SCHEMA)throw Error('Keep the original worksheet_schema.');
      for(const [key,value]of Object.entries(bound))
        if(row.identity[key]!==value)throw Error('The worksheet '+key+' differs from the selected original report and zone.');
      if(!known.has(row.run_id))throw Error('The scenario run is absent from this report’s compatible alternatives.');
      if(seen.has(row.run_id))throw Error('This scenario run appears more than once.');
      seen.add(row.run_id);
      if(row.label!==known.get(row.run_id).label)throw Error('The scenario label differs from the original run; retain both the exported label and run ID.');
      const before=copy(draft.costs?.[row.run_id]||{}),after=cleanCost(row.value,before,zone,source);
      const metadata=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!editable.includes(key)&&key!=='worksheetBinding'));
      const metadataBefore=metadata(before),metadataAfter=metadata(after);
      const metadataChanged=JSON.stringify(metadataBefore)!==JSON.stringify(metadataAfter);
      after.worksheetBinding=copy(bound);
      const changed=editable.filter(key=>text(before[key]??'')!==text(after[key]??''));
      changes.push({run_id:row.run_id,label:row.label,before,after,changed,
        metadata_changed:metadataChanged,metadata_before:metadataBefore,metadata_after:metadataAfter});
    }catch(error){errors.push({row:row.row,run_id:row.run_id,message:label+': '+error.message});}
  }
  return {schema:WORKSHEET_SCHEMA,identity:bound,filename,format,rows:changes,errors,
    included_count:changes.filter(row=>row.after.enabled).length,
    untouched_count:source.alternatives.filter(row=>!seen.has(row.run_id)).length,
    original_text:input,draft_snapshot:JSON.stringify(draft)};
}

export function applyCostWorksheet(draft,preview,{sha256,imported_at}={}) {
  if(preview?.schema!==WORKSHEET_SCHEMA||preview.errors?.length||!preview.rows?.length)
    throw Error('Correct the worksheet rows before applying any estimates.');
  if(JSON.stringify(draft)!==preview.draft_snapshot)throw Error('The economic inputs changed after this preview. Preview the worksheet again.');
  if(draft.reportId!==preview.identity.report_id||draft.reportSha!==preview.identity.report_sha256||
    draft.zoneId!==preview.identity.zone_id)throw Error('Return to the original report and zone before applying this worksheet.');
  if(!/^[a-f0-9]{64}$/.test(sha256||'')||!Number.isFinite(Date.parse(imported_at)))
    throw Error('The original worksheet needs its file hash and import time.');
  const result=copy(draft);
  result.costs={...result.costs};
  for(const row of preview.rows)result.costs[row.run_id]=copy(row.after);
  result.costWorksheets=Array.isArray(result.costWorksheets)?result.costWorksheets:[];
  if(!result.costWorksheets.some(item=>item.sha256===sha256))
    result.costWorksheets.push({schema:WORKSHEET_SCHEMA,filename:preview.filename,
      format:preview.format,sha256,imported_at,identity:copy(preview.identity),
      original_text:preview.original_text,run_ids:preview.rows.map(row=>row.run_id)});
  return result;
}
