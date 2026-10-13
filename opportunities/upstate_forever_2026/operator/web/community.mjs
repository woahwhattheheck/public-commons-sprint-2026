import {attachCommunityRevisions} from './community_revisions.mjs';
import {attachCommunityReportHandover} from './community_report_handover.mjs';

/**
 * Utility/community planning inside the original Upper Savannah operator.
 * Every mutation uses the host's retained form operation and native task queue.
 */
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHTML;
const SCIENTIFIC_SCOPE_TEXT="Community totals describe the selected whole source block groups. Native exports retain each run's original reporting-area valid cells. A community or intervention selection does not clip or allocate those exports. Alternative-minus-baseline changes use the original common valid cells; their support can differ from either full-run total. Negative changes mean lower modeled export and positive changes mean higher modeled export on that common support. Parameter-profile changes remain sensitivity comparisons.";
const list=value=>Array.isArray(value)?value:[];
const text=value=>Array.isArray(value)?value.join('\n'):String(value??'');
const human=value=>String(value??'').replaceAll('_',' ');
const short=value=>String(value??'').slice(0,12);
const numeric=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
const n=(value,places=0)=>numeric(value)===null?'—':Number(value).toLocaleString(undefined,{maximumFractionDigits:places});
const usd=value=>numeric(value)===null?'—':Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2});
const pct=value=>numeric(value)===null?'—':n(value,2)+'%';
const safeLink=value=>{try{const u=new URL(String(value));return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const reference=value=>{const s=typeof value==='object'?JSON.stringify(value):text(value),url=safeLink(s);return url?'<a href="'+e(url)+'" target="_blank" rel="noopener noreferrer">'+e(s)+'</a>':e(s);};
const unique=values=>[...new Set(values)];
const clone=value=>JSON.parse(JSON.stringify(value));
const button=(action,label,attrs='',style='')=>'<button type="button" data-action="community-'+e(action)+'" class="'+e(style)+'" '+attrs+'>'+e(label)+'</button>';
const field=(label,control,note='',wide=false)=>'<label class="'+(wide?'full':'')+'"><span>'+e(label)+'</span>'+control+(note?'<small>'+e(note)+'</small>':'')+'</label>';
const input=(name,value='',attrs='')=>'<input name="'+e(name)+'" value="'+e(value)+'" '+attrs+'>';
const textarea=(name,value='',attrs='')=>'<textarea name="'+e(name)+'" '+attrs+'>'+e(text(value))+'</textarea>';
const select=(name,rows,value='',placeholder='All',attrs='')=>'<select name="'+e(name)+'" '+attrs+'><option value="">'+e(placeholder)+'</option>'+rows.map(r=>'<option value="'+e(r.id)+'" '+(String(r.id)===String(value)?'selected':'')+'>'+e(r.title??r.name??r.id)+'</option>').join('')+'</select>';
const checks=(name,rows,selected=[])=>'<div class="community-checks">'+rows.map(r=>'<label class="check"><input type="checkbox" name="'+e(name)+'" value="'+e(r.id)+'" '+(selected.includes(r.id)?'checked':'')+'><span>'+e(r.title??r.name??r.id)+(r.description?'<small>'+e(r.description)+'</small>':'')+'</span></label>').join('')+(rows.length?'':'<p class="note">No matching retained choices.</p>')+'</div>';
const section=(title,description,body,actions='')=>'<section class="section community-section"><header class="section-header"><div><h2>'+e(title)+'</h2>'+(description?'<p>'+e(description)+'</p>':'')+'</div>'+actions+'</header>'+body+'</section>';
const table=(heads,rows,caption='')=>'<div class="table-scroll"><table class="community-table">'+(caption?'<caption>'+e(caption)+'</caption>':'')+'<thead><tr>'+heads.map(h=>'<th scope="col">'+e(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const info=(label,value)=>'<div><dt>'+e(label)+'</dt><dd>'+e(value??'—')+'</dd></div>';
const metric=(label,value,description)=>'<div class="community-metric"><span>'+e(label)+'</span><strong>'+e(value)+'</strong><p>'+e(description)+'</p></div>';
const empty=(title,description,actions='')=>'<div class="empty"><h2>'+e(title)+'</h2><p>'+e(description)+'</p>'+actions+'</div>';
const priorityOptions=['high','medium','low','watch'].map(id=>({id,title:human(id)}));
const strategyOptions=['protect','restore','monitor','investigate','other'].map(id=>({id,title:human(id)}));
const statusOptions=['proposed','selected','in_progress','complete'].map(id=>({id,title:human(id)}));


/** Compare the two retained plan editions printed by the original report producer. */
export function communityPlanRevisionMarkup(revision){
  if(!revision)return '';
  if(revision.schema!=='upstate.community-plan-revision/v1')return '<p class="notice">Open the original report files to inspect this plan revision edition.</p>';
  const value=x=>x===null||x===undefined?'Not entered':x===''?'Empty':
    Array.isArray(x)?(x.length?x.map(value).join('; '):'None'):
    typeof x==='object'?Object.entries(x).map(([k,v])=>human(k)+': '+value(v)).join('; '):
    typeof x==='boolean'?(x?'Yes':'No'):String(x);
  const row=cells=>'<tr>'+cells.map(cell=>'<td>'+e(cell)+'</td>').join('')+'</tr>';
  const counts=revision.counts||{},selection=revision.selection||{},costs=revision.costs||{},
    before=costs.before||{},after=costs.after||{},context=revision.scientific_context||{},csv=revision.received_csv||{};
  const summary=table(['Interventions added','Removed','Changed','Unchanged','Changed fields'],[
    row([counts.added_interventions,counts.removed_interventions,counts.changed_interventions,
      counts.unchanged_interventions,counts.changed_fields].map(value))]);
  const changes=list(revision.changes),planChanges=list(revision.plan_changes);
  const changeTable=changes.length?table(['Change','Intervention','Field','Previous value','Saved value'],
    changes.map(item=>row([human(item.change),item.title||item.intervention_id,human(item.field),
      value(item.before),value(item.after)]))):'<p class="note">No intervention fields changed in this saved revision.</p>';
  const estimateTable=table(['Entered estimate basis','Previous plan','Saved plan'],[
    row(['Entered total (USD)',before.entered_total_usd==null?'Not entered':usd(before.entered_total_usd),
      after.entered_total_usd==null?'Not entered':usd(after.entered_total_usd)]),
    row(['Interventions with entered estimates',value(before.known_estimate_count),value(after.known_estimate_count)]),
    row(['Interventions without estimates',value(before.unknown_estimate_count),value(after.unknown_estimate_count)])]);
  const membership=table(['Whole source block-group selection','Saved change'],[
    row(['Previous selection',value(selection.before)]),row(['Saved selection',value(selection.after)]),
    row(['Added block groups',value(selection.added_geoids)]),row(['Removed block groups',value(selection.removed_geoids)]),
    row(['Previous whole-group summary',value(selection.before_summary)]),row(['Saved whole-group summary',value(selection.after_summary)])]);
  const contextRows=list(context.identifier_changes).map(item=>row([human(item.field),value(item.before),value(item.after)]));
  const snapshots=table(['Original lineage','Previous plan','Saved plan'],[
    row(['Scientific snapshot SHA256',value(context.before_snapshot_sha256),value(context.after_snapshot_sha256)]),
    row(['Received CSV SHA256',value(csv.before_sha256),value(csv.after_sha256)]),
    row(['CSV import plan',value(csv.before_import_plan_id),value(csv.after_import_plan_id)])]);
  const previous=typeof revision.previous_plan_id==='string'&&/^[a-f0-9]{64}$/.test(revision.previous_plan_id)?
    button('plan-open','Open previous saved plan','data-id="'+e(revision.previous_plan_id)+'"'):'';
  return section('Changes from previous saved plan',
    'Revision '+value(revision.previous_revision_number)+' → '+value(revision.revision_number)+
    '. This register compares retained planning decisions and original selections.',
    summary+'<h3>Intervention changes</h3>'+changeTable+
    (planChanges.length?'<h3>Plan details</h3>'+table(['Field','Previous value','Saved value'],
      planChanges.map(item=>row([human(item.field),value(item.before),value(item.after)]))):'')+
    '<h3>Entered cost estimates</h3>'+estimateTable+
    '<p class="note">Entered-estimate difference: '+e(costs.entered_estimate_difference_usd==null?'Not entered':usd(costs.entered_estimate_difference_usd))+
    '. '+e(costs.basis||'This difference compares entered estimates; unknown estimates remain separate.')+'</p>'+
    '<h3>Selected communities</h3><p class="note">Counts describe whole original source block groups. Overlapping utility and watershed selections retain their original membership.</p>'+membership+
    '<h3>Scientific context and original CSV</h3><p class="note">'+
    e(context.snapshot_changed?'The retained scientific snapshot changed.':'The retained scientific snapshot is unchanged.')+'</p>'+
    (contextRows.length?table(['Context selection','Previous value','Saved value'],contextRows):'')+
    '<details class="technical"><summary>Original plan and source identities</summary>'+
    table(['Edition','Plan ID'],[row(['Previous',revision.previous_plan_id]),row(['Saved',revision.plan_id])])+
    snapshots+'</details>'+
    '<p class="note">The complete report includes the previous plan, revision summary and field-change CSV.</p>',previous);
}

export function selectCommunityGroups(groups,selection={}){
  const utilities=list(selection.utility_ids),watersheds=list(selection.watershed_ids),geoids=list(selection.geoids);
  const seen=new Set(),result=[];
  for(const g of list(groups)){
    if(seen.has(g.geoid)||(geoids.length&&!geoids.includes(g.geoid)))continue;
    const members=list(g.memberships).filter(m=>
      (!utilities.length||utilities.includes(m.utility_id))&&(!watersheds.length||watersheds.includes(m.watershed_id)));
    if(!members.length)continue;
    seen.add(g.geoid);
    result.push({...g,all_memberships:list(g.all_memberships).length?g.all_memberships:list(g.memberships),memberships:members});
  }
  return result;
}
export function summarizeCommunityGroups(groups){
  const uniqueGroups=selectCommunityGroups(groups),sum=key=>{
    const values=uniqueGroups.map(g=>numeric(g[key]));
    return values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null;
  };
  const households=sum('households'),poverty=sum('households_below_poverty');
  return {groups:uniqueGroups.length,population:sum('population'),households,households_below_poverty:poverty,
    poverty_percent:households>0&&poverty!==null?100*poverty/households:null,
    below_state_median:uniqueGroups.filter(g=>g.below_state_median_income===true).length};
}


const interventionFields=['id','title','priority','strategy','status','utility_id','watershed_id','geoids','reason','owner','next_step','cost_estimate_usd','notes'];
const interventionDerivedColumns=['position','population_context','household_context'];
const interventionRequiredColumns=['id','title','utility_id','watershed_id','reason'];

export function parseCommunityCsv(source){
  if(typeof source!=='string'||source.includes('\0'))throw Error('Choose a UTF-8 intervention CSV without null characters.');
  const text=source.replace(/^\uFEFF/,''),rows=[];
  let row=[],value='',quoted=false,closed=false,line=1,start=1;
  const finish=()=>{row.push(value);rows.push({line:start,cells:row});row=[];value='';closed=false;};
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'){
        if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}
      }else{
        value+=ch;
        if(ch==='\r'){if(text[i+1]==='\n'){value+='\n';i++;}line++;}
        else if(ch==='\n')line++;
      }
      continue;
    }
    if(closed&&ch!==','&&ch!=='\r'&&ch!=='\n')throw Error('CSV row '+start+': unexpected character after a closing quote.');
    if(ch==='"'&&!value&&!closed){quoted=true;continue;}
    if(ch===','){row.push(value);value='';closed=false;continue;}
    if(ch==='\r'||ch==='\n'){
      finish();if(ch==='\r'&&text[i+1]==='\n')i++;line++;start=line;continue;
    }
    value+=ch;
  }
  if(quoted)throw Error('CSV row '+start+': a quoted field is not closed.');
  if(row.length||value.length||closed)finish();
  return rows;
}

function interventionText(value,previous){
  if(typeof previous==='string'){
    const trimmed=previous.trimStart();
    const escaped=/^[=+@]/.test(trimmed)||trimmed.startsWith('-')&&!/^-\d+(?:\.\d+)?$/.test(previous.trim())?"'"+previous:previous;
    if(value===escaped)return previous;
  }
  return value;
}

function interventionChanges(before,after){
  const left=new Map(list(before).map(row=>[row.id,row])),right=new Map(after.map(row=>[row.id,row]));
  const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
  const changed=[...right.keys()].filter(id=>left.has(id)&&['position',...interventionFields].some(field=>!same(left.get(id)[field],right.get(id)[field])));
  return {added_ids:[...right.keys()].filter(id=>!left.has(id)).sort(),
    removed_ids:[...left.keys()].filter(id=>!right.has(id)).sort(),changed_ids:changed.sort(),
    unchanged_ids:[...right.keys()].filter(id=>left.has(id)&&!changed.includes(id)).sort()};
}

function interventionCost(value){
  let text=String(value??'').trim();
  if(!text)return null;
  text=text.replace(/[,$]/g,'');
  if(text.length>100||!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))throw Error('Cost must be a nonnegative decimal USD amount.');
  const [whole,fraction='']=text.replace(/^\+/,'').split('.');
  if(/[1-9]/.test(fraction.slice(2)))throw Error('Cost estimates use at most two decimal places.');
  return BigInt(whole||'0').toString()+'.'+fraction.padEnd(2,'0').slice(0,2);
}

export function mapInterventionColumns(headers,mapping=null){
  const explicit=mapping!==null&&mapping!==undefined;
  if(explicit&&(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.keys(mapping).some(field=>!interventionFields.includes(field))))
    throw Error('Map only the original intervention plan fields.');
  if(!explicit){
    const missing=interventionRequiredColumns.filter(column=>!headers.includes(column));
    if(missing.length)throw Error('The intervention CSV lacks columns: '+missing.join(', ')+'.');
  }
  const columns={},fieldProvenance=[];
  for(const field of interventionFields){
    let column=explicit&&Object.hasOwn(mapping,field)?mapping[field]:(headers.includes(field)?field:null);
    if(column==='')column=null;
    if(column!==null&&(typeof column!=='string'||!headers.includes(column)))
      throw Error('Intervention field '+field+' needs an original CSV column.');
    if(column===null&&interventionRequiredColumns.includes(field)&&field!=='id')
      throw Error('Choose an original CSV column for '+field+'.');
    columns[field]=column;
    fieldProvenance.push({field,source_column:column,source_column_number:column===null?null:headers.indexOf(column)+1,
      basis:column!==null?'original-column':field==='id'?'generated-source-row-id':'native-default'});
  }
  return {columns,fieldProvenance,explicit};
}

export function readInterventionCsv(source,table,previous=[],sourceSha256='',selection={},columnMapping=null){
  if(!/^[0-9a-f]{64}$/.test(sourceSha256))throw Error('The received CSV needs its exact SHA-256.');
  const parsed=parseCommunityCsv(source);
  if(!parsed.length)throw Error('The intervention CSV has no column headings.');
  const headers=parsed.shift().cells;
  if(headers.some(column=>!column)||new Set(headers).size!==headers.length)throw Error('The intervention CSV needs distinct, nonempty column headings.');
  const mapped=mapInterventionColumns(headers,columnMapping);
  const groups=selectCommunityGroups(table?.groups,selection),geoids=new Set(list(table?.groups).map(group=>group.geoid));
  const watersheds=new Set(list(table?.groups).flatMap(group=>list(group.memberships).map(member=>member.watershed_id)));
  const prior=new Map(list(previous).map(row=>[row.id,row])),seen=new Set(),records=[],sourceRows=[],errors=[],normalizedGeographies=[];
  let ordinal=0;
  function geography(value,available,line,column){
    const original=String(value??'').trim();
    if(!available.has(original)&&/^\d{1,12}$/.test(original)){
      const resolved=original.padStart(12,'0');
      if(available.has(resolved)){normalizedGeographies.push({row:line,column,original,resolved});return resolved;}
    }
    return original;
  }
  for(const parsedRow of parsed){
    const {line,cells}=parsedRow;
    if(cells.every(value=>!value.trim()))continue;
    ordinal++;
    if(cells.length!==headers.length){errors.push('CSV row '+line+': expected '+headers.length+' columns; received '+cells.length+'.');continue;}
    const sourceValues=Object.fromEntries(headers.map((column,index)=>[column,cells[index]]));
    const original=Object.fromEntries(interventionFields.map(field=>[field,mapped.columns[field]===null?'':sourceValues[mapped.columns[field]]]));
    const id=original.id.trim()||'I-CSV-'+sourceSha256.slice(0,16)+'-'+ordinal;
    try{
      if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(id))throw Error('Use a portable intervention identifier with letters, digits, dots, underscores or hyphens.');
      if(seen.has(id))throw Error('Intervention identifier repeats: '+id+'.');
      seen.add(id);
      const old=prior.get(id)||{},record={id};
      for(const field of interventionFields){
        if(field==='id'||field==='geoids'||field==='cost_estimate_usd')continue;
        record[field]=String(interventionText(original[field]??'',old[field])).trim();
      }
      for(const [field,choices,fallback]of [['priority',['high','medium','low','watch'],'medium'],['strategy',['protect','restore','monitor','investigate','other'],'investigate'],['status',['proposed','selected','in_progress','complete'],'proposed']]){
        record[field]||=fallback;if(!choices.includes(record[field]))throw Error(field+' must be one of '+choices.join(', ')+'.');
      }
      for(const field of ['title','utility_id','watershed_id','reason'])if(!record[field])throw Error(field.replaceAll('_',' ')+' is required.');
      for(const field of ['title','utility_id','watershed_id','reason','owner','next_step','notes']){
        const maximum=field==='title'?300:['utility_id','watershed_id'].includes(field)?100:20000;
        if(record[field].length>maximum)throw Error(field.replaceAll('_',' ')+' exceeds '+maximum+' characters.');
      }
      record.watershed_id=geography(record.watershed_id,watersheds,line,'watershed_id');
      record.geoids=unique((original.geoids||'').split(';').filter(value=>value.trim()).map(value=>geography(value,geoids,line,'geoids')));
      const members=groups.filter(group=>list(group.memberships).some(member=>member.utility_id===record.utility_id&&member.watershed_id===record.watershed_id));
      if(!members.length)throw Error('The utility and HUC12 have no membership in this retained community table; keep full geographic identifiers as text.');
      if(!record.geoids.length)record.geoids=members.map(group=>group.geoid);
      const allowed=new Set(members.map(group=>group.geoid));
      const outside=record.geoids.filter(id=>!allowed.has(id));
      if(outside.length)throw Error('Block groups outside this utility/watershed membership: '+outside.join(', ')+'.');
      record.cost_estimate_usd=interventionCost(original.cost_estimate_usd);
      record.position=records.length+1;
      records.push(record);sourceRows.push({record:ordinal,source_line:line,id});
    }catch(error){errors.push('CSV row '+line+' ['+id+']: '+error.message);}
  }
  if(errors.length){const error=Error('Correct '+errors.length+' intervention CSV '+(errors.length===1?'row':'rows')+' before importing.');error.rowErrors=errors;throw error;}
  if(!records.length)throw Error('The intervention CSV contains no intervention rows.');
  const ignored=headers.filter(column=>!Object.values(mapped.columns).includes(column));
  const cents=records.filter(row=>row.cost_estimate_usd!==null).reduce((sum,row)=>sum+BigInt(row.cost_estimate_usd.replace('.','')),0n);
  const centsText=cents.toString().padStart(3,'0');
  return {records,rows:sourceRows,
    ...(mapped.explicit?{column_mapping:mapped.columns,source_headers:[...headers],field_provenance:mapped.fieldProvenance}:{}),
    summary:{row_count:records.length,...interventionChanges(previous,records),
    normalized_geographies:normalizedGeographies,derived_columns:ignored.filter(column=>interventionDerivedColumns.includes(column)),
    additional_columns:ignored.filter(column=>!interventionDerivedColumns.includes(column)),
    known_estimate_count:records.filter(row=>row.cost_estimate_usd!==null).length,
    known_estimate_total:centsText.slice(0,-2)+'.'+centsText.slice(-2),
    order_basis:'Received CSV row order; derived context is recalculated from the saved plan'}};
}



/** Match original whole-watershed rows to the retained block-group memberships. */
export function selectCommunityWatersheds(report,groups,selection={}){
  const chosen=selectCommunityGroups(groups,selection);
  const huc12s=unique(chosen.flatMap(group=>list(group.memberships).map(member=>String(member.watershed_id??'')))).sort();
  if(huc12s.some(id=>!/^\d{12}$/.test(id)))throw Error('A selected community membership has no original twelve-digit HUC12.');
  const indexed=new Map();
  for(const row of list(report?.hucs)){
    if(typeof row?.huc12!=='string'||indexed.has(row.huc12))throw Error('The retained regional report contains an invalid or repeated HUC12.');
    indexed.set(row.huc12,row);
  }
  return {selected_huc12s:huc12s,hucs:huc12s.filter(id=>indexed.has(id)).map(id=>indexed.get(id)),
    missing_huc12s:huc12s.filter(id=>!indexed.has(id))};
}

function watershedCoverage(row,coverage={}){
  if(row.classification_scope==='outside_south_carolina'||row.classification_coverage==='outside_south_carolina')
    return 'Outside South Carolina source jurisdiction';
  const complete=row.classification_query_coverage==='complete_domain_query'||coverage.complete_domain_query===true;
  if(numeric(row.selected_classification_count)===0&&complete)return 'Complete selected-class query; zero features';
  if(complete)return 'Complete selected-class query';
  return human(row.classification_coverage||row.classification_query_coverage||'Query coverage unrecorded');
}

/** Render the saved original regional selection without recalculating its analysis. */
export function communityWatershedContextHtml(context){
  if(!context)return '';
  const rows=list(context.hucs),coverage=context.classification_coverage??{};
  const area=rows.length&&rows.every(row=>numeric(row.area_km2)!==null)?rows.reduce((sum,row)=>sum+Number(row.area_km2),0):null;
  const classificationCount=rows.length&&rows.every(row=>numeric(row.selected_classification_count)!==null)?
    rows.reduce((sum,row)=>sum+Number(row.selected_classification_count),0):null;
  const originalRows=rows.flatMap(row=>list(row.nrcs_state_rows).map(state=>({...state,huc:row})));
  const title=context.title||'Regional watershed context';
  return '<div class="section-body"><h3>'+e(title)+'</h3>'+
    '<p class="note">The regional selection follows the plan’s original watershed memberships. Whole-watershed areas count each HUC12 once; the state rows retain their original NRCS programme designations and state-portion areas.</p>'+
    '<div class="community-metrics">'+metric('Whole watersheds',n(rows.length),'Selected original HUC12 records')+
    metric('Whole-watershed area',n(area,2)+' km²','Original regional source areas')+
    metric('Selected SCDES features',n(classificationCount),'Publisher HUC12 assignments within the source jurisdiction')+'</div></div>'+
    table(['Watershed','Whole area (km² / acres)','NRCS edition / priority','Selected SCDES features','Query coverage'],rows.map(row=>
      '<tr><th scope="row">'+e(row.name||row.huc12)+'<small>'+e(row.huc12)+' · '+e(list(row.states).join(' / '))+'</small></th>'+
      '<td class="number-cell">'+n(row.area_km2,2)+' / '+n(row.area_acres,2)+'</td>'+
      '<td>'+e(row.nrcs_edition||'Edition unrecorded')+' · '+e(row.priority?'Priority in '+list(row.priority_states).join(', '):'No priority designation in these source rows')+
      '<small>'+e(list(row.system_types).join(' / '))+'</small></td>'+
      '<td class="number-cell">'+n(row.selected_classification_count)+'</td><td>'+e(watershedCoverage(row,coverage))+'</td></tr>'),
      'Original whole-watershed regional context')+
    (originalRows.length?table(['Watershed / source record','State','State-portion acres','NRCS edition','NRCS status','System type','Resource concern'],originalRows.map(state=>
      '<tr><th scope="row">'+e(state.huc.huc12)+'<small>Original NRCS record '+e(state.OBJECTID??'—')+'</small></th>'+
      '<td>'+e(state.st_usps)+'</td><td class="number-cell">'+n(state.st_ac,2)+'</td><td>'+e(state.huc.nrcs_edition||'Edition unrecorded')+'</td><td>'+e(state.fy26_status)+'</td>'+
      '<td>'+e(state.system_type)+'</td><td>'+e(state.resource_concern)+'</td></tr>'),'Retained NRCS state programme records'):'')+
    '<div class="section-body"><p class="note">SCDES counts describe the selected classification query and its South Carolina jurisdiction. Zero selected features records that query result; water-quality conclusions require measured observations. Selected query classes: '+
    e(list(coverage.selected_classes).join(', ')||'See the retained source query')+'.</p>'+
    '<details><summary>Original regional source and methods</summary><pre>'+e(JSON.stringify({
      report_id:context.report_id||context.id,analysis_version:context.analysis_version,selected_huc12s:context.selected_huc12s||rows.map(row=>row.huc12),
      report_file:context.report_file,source_fingerprint:context.source_fingerprint,source_edition_fingerprint:context.source_edition_fingerprint,
      source_inputs:context.source_inputs,sources:context.sources,methods:context.methods,
      classification_coverage:coverage,network_status:context.network_status
    },null,2))+'</pre></details></div>';
}

/** Host-owned callbacks retain original workspace, task and dialog semantics. */

export function validateCommunityView(value,state){
  if(value===undefined||value===null)return null;
  if(!value||Array.isArray(value)||typeof value!=='object'||value.schema!=='upstate.community-view/v1'||
     value.project_id!==state?.data?.project?.id)throw Error('Open the original project or its restored copy before opening this Community view.');
  const string=(name,fallback='')=>{
    const item=value[name]===undefined?fallback:value[name];
    if(typeof item!=='string')throw Error('The saved Community '+name+' must be a string.');
    return item;
  };
  const tableId=string('table_id'),tables=list(state.data.community_tables);
  const table=tables.find(row=>row.id===tableId);
  if(!table)throw Error('This project does not contain the saved Community table.');
  const tab=string('tab','explore'),sort=string('sort','geoid');
  if(!['explore','plans','reports'].includes(tab)||!['geoid','population_desc','poverty_desc','income_asc'].includes(sort))
    throw Error('The saved Community tab or sort is unavailable.');
  const compare=value.compare_geoids===undefined?[]:value.compare_geoids;
  if(!Array.isArray(compare)||compare.some(id=>typeof id!=='string')||new Set(compare).size!==compare.length)
    throw Error('Choose distinct original census block groups for the saved Community comparison.');
  const utility=string('utility_id'),watershed=string('watershed_id'),planId=string('plan_id'),reportId=string('report_id');
  if(Array.isArray(table.groups)){
    const memberships=table.groups.flatMap(group=>list(group.memberships));
    const declared=list(table.metadata?.utilities);
    const utilities=new Set(declared.length?declared.map(row=>row.id):memberships.map(row=>row.utility_id));
    if(utility&&!utilities.has(utility))throw Error('The saved utility is absent from the original Community table.');
    if(watershed&&!memberships.some(row=>row.watershed_id===watershed&&(!utility||row.utility_id===utility)))
      throw Error('The saved watershed is absent from this original utility selection.');
    const ids=new Set(table.groups.map(group=>group.geoid));
    if(compare.some(id=>!ids.has(id)))throw Error('The saved comparison contains a block group outside the original Community table.');
  }
  const plan=planId?list(state.data.community_plans).find(row=>row.id===planId):null;
  const report=reportId?list(state.data.community_reports).find(row=>row.id===reportId):null;
  if(planId&&(!plan||plan.table_id!==tableId))throw Error('The selected Community plan belongs to another retained table.');
  if(reportId&&(!report||report.table_id!==tableId||(planId&&(report.plan_id||report.selection?.plan_id)!==planId)))
    throw Error('The selected Community report belongs to another retained plan or table.');
  return {schema:'upstate.community-view/v1',project_id:value.project_id,table_id:tableId,tab,
    utility_id:utility,watershed_id:watershed,query:string('query'),sort,compare_geoids:[...compare],plan_id:planId,report_id:reportId};
}

export function attachCommunity({getState,api,endpoint,openForm,submitAction,detail,fileList,sourceForm,toast,openItem,refreshState,openDelivery,openScientificReport,openStudyTransfer}){
  const cache=new Map(),pending=new Map();
  let activeWorkspace=null,container=null,mountController=null,loadError='',formTable=null,formWorkspace=null,validatedView=null;
  let formPlanPrevious=null,formCsvPreview=null,formCsvInput=null,formInterventionImport=null,formCsvEpoch=0;
  let formWatershedCatalog=[],formWatershedReport=null,formWatershedError='',formWatershedCatalogError='';
  let formWatershedGeneration=0,formWatershedRequest=0,reportSourceRequest=0;
  let studyTransferRequest=0;
  let local={table:'',tab:'explore',utility:'',watershed:'',query:'',sort:'geoid',compare:[],plan:'',report:''};
  let retainedState=null;
  const current=()=>{const live=getState();return retainedState?.previous===live?retainedState.state:live;};
  const data=()=>current()?.data??{};
  const workspace=()=>current()?.workspace_key??'';
  const tables=()=>list(data().community_tables);
  const plans=()=>list(data().community_plans);
  const reports=()=>list(data().community_reports);
  const revisions=attachCommunityRevisions({getState:current,api,endpoint,openForm,submitAction,detail,fileList,openPlan:id=>planDetail(id),studyTransferButton});
  const handover=attachCommunityReportHandover({getState:current,api,endpoint,openForm,submitAction,detail,fileList,
    getReport:id=>get('community_reports',id,{fresh:true})});
  const key=(kind,id)=>workspace()+'|'+kind+'|'+id;
  function sync(){
    if(activeWorkspace!==workspace()){
      studyTransferRequest++;
      handover.invalidate();
      activeWorkspace=workspace();loadError='';validatedView=null;
      local={table:'',tab:'explore',utility:'',watershed:'',query:'',sort:'geoid',compare:[],plan:'',report:''};
      let saved;try{saved=JSON.parse(sessionStorage.getItem('upstate-community-view:'+workspace())||'null');}catch{}
      if(saved&&typeof saved==='object'&&(!saved.project_id||saved.project_id===data().project?.id))local={...local,...saved};
      else if(data().operator_session?.journey?.community){
        try{local=localView(validateCommunityView(data().operator_session.journey.community,current()));}
        catch(error){loadError=error.message;}
      }
    }
    if(!tables().some(t=>t.id===local.table)){local.table=tables()[0]?.id??'';local.plan='';local.report='';}
    if(!['explore','plans','reports'].includes(local.tab))local.tab='explore';
    local.compare=list(local.compare);
  }
  function persist(){try{sessionStorage.setItem('upstate-community-view:'+workspace(),JSON.stringify({...local,project_id:data().project?.id}));}catch{}}
  function localView(value){
    return {table:value.table_id,tab:value.tab,utility:value.utility_id,watershed:value.watershed_id,query:value.query,
      sort:value.sort,compare:[...value.compare_geoids],plan:value.plan_id,report:value.report_id};
  }
  function viewState(state=current()){
    const rows={...state.data};
    for(const kind of ['community_tables','community_plans','community_reports'])
      rows[kind]=list(rows[kind]).map(item=>cache.get(state.workspace_key+'|'+kind+'|'+item.id)||item);
    return {...state,data:rows};
  }
  function capture(){
    if(activeWorkspace!==workspace())return null;
    sync();if(!local.table)return null;
    return validateCommunityView({schema:'upstate.community-view/v1',project_id:data().project.id,table_id:local.table,
      tab:local.tab,utility_id:local.utility,watershed_id:local.watershed,query:local.query,sort:local.sort,
      compare_geoids:local.compare,plan_id:local.plan||'',report_id:local.report||''},viewState());
  }
  async function validateView(value){
    if(value===undefined||value===null)return null;
    sync();validatedView=null;const selectedWorkspace=workspace(),before=JSON.stringify(local),project=data().project?.id;
    const fresh=await api('/api/state?workspace='+encodeURIComponent(selectedWorkspace));
    if(workspace()!==selectedWorkspace||fresh.workspace_key!==selectedWorkspace||fresh.data?.project?.id!==project)
      throw Error('The selected workspace changed. Open the Community view in its original project.');
    let selected=validateCommunityView(value,fresh);
    await get('community_tables',selected.table_id,{fresh:true});
    if(selected.plan_id)await get('community_plans',selected.plan_id,{fresh:true});
    if(selected.report_id)await get('community_reports',selected.report_id,{fresh:true});
    if(workspace()!==selectedWorkspace||JSON.stringify(local)!==before)
      throw Error('The Community selection changed while opening the saved view. Open it again.');
    selected=validateCommunityView(selected,viewState(fresh));
    validatedView={value:JSON.stringify(selected),state:fresh,before,workspace:selectedWorkspace,project};
    return selected;
  }
  function restoreView(value){
    if(value===undefined||value===null)return null;
    const original=validatedView;
    if(original&&(original.workspace!==workspace()||original.project!==data().project?.id||original.before!==JSON.stringify(local)))
      throw Error('The Community selection changed. Open the saved view again.');
    const selected=validateCommunityView(value,viewState(original?.value===JSON.stringify(value)?original.state:current()));
    if(original?.value===JSON.stringify(value))retainedState={previous:getState(),state:original.state};
    activeWorkspace=workspace();local=localView(selected);validatedView=null;loadError='';persist();redraw();return {...selected};
  }
  function selectRetainedTable(id){
    if(local.table!==id){local.utility='';local.watershed='';local.query='';local.compare=[];local.plan='';local.report='';}
    local.table=id;
  }
  function row(kind,id){return cache.get(key(kind,id))||list(data()[kind]).find(r=>r.id===id);}
  async function get(kind,id,{fresh=false}={}){
    const ws=workspace(),k=key(kind,id);
    if(!fresh&&cache.has(k))return cache.get(k);
    if(!fresh&&pending.has(k))return pending.get(k);
    const task=api(endpoint('/api/item',{kind,id})).then(value=>{cache.set(k,value);return value;}).finally(()=>pending.delete(k));
    pending.set(k,task);
    const result=await task;
    if(ws!==workspace())throw Error('The selected workspace changed. Reopen this item in the intended workspace.');
    return result;
  }
  function selectedTable(){return row('community_tables',local.table);}
  function utilities(t=selectedTable()){return list(t?.metadata?.utilities);}
  function utilityName(id,t=selectedTable()){return utilities(t).find(u=>u.id===id)?.name||id;}
  function watershedChoices(t=selectedTable(),utilityId=''){
    const names=new Map();
    for(const g of list(t?.groups))for(const m of list(g.memberships))
      if(!utilityId||m.utility_id===utilityId)names.set(m.watershed_id,m.watershed_name||m.watershed_id);
    return [...names].map(([id,title])=>({id,title})).sort((a,b)=>a.title.localeCompare(b.title));
  }
  function membership(g,t=selectedTable()){
    return list(g.memberships).map(m=>'<span>'+e(utilityName(m.utility_id,t))+'<small>'+e(m.watershed_name||m.watershed_id)+' · '+e(m.watershed_id)+'</small></span>').join('');
  }
  function filtered(t=selectedTable()){
    let groups=selectCommunityGroups(t?.groups,{utility_ids:local.utility?[local.utility]:[],watershed_ids:local.watershed?[local.watershed]:[]});
    const q=local.query.trim().toLowerCase();
    if(q)groups=groups.filter(g=>[g.geoid,...list(g.memberships).flatMap(m=>[m.utility_id,utilityName(m.utility_id,t),m.watershed_id,m.watershed_name])].some(v=>String(v??'').toLowerCase().includes(q)));
    return groups.sort((a,b)=>{
      const fields={population_desc:['population',-1],poverty_desc:['households_below_poverty',-1],income_asc:['median_household_income',1]};
      const sort=fields[local.sort];if(sort){const av=numeric(a[sort[0]]),bv=numeric(b[sort[0]]);if(av===null&&bv!==null)return 1;if(bv===null&&av!==null)return -1;if(av!==bv)return (av-bv)*sort[1];}
      return String(a.geoid).localeCompare(String(b.geoid));
    });
  }
  function metrics(groups){
    const summary=summarizeCommunityGroups(groups);
    return '<div class="community-metrics">'+
      metric('Block groups',n(summary.groups),'Unique original census geographies')+
      metric('Whole-block-group population',n(summary.population),'Residents in the selected census geographies')+
      metric('Households',n(summary.households),'Original table household count')+
      metric('Households below poverty',n(summary.households_below_poverty),pct(summary.poverty_percent)+' of selected households')+
      metric('Below state income reference',n(summary.below_state_median)+' / '+n(summary.groups),'Groups compared with the source’s state median')+'</div>';
  }
  function sourceNote(t){
    const income=t?.metadata?.income_reference??{};
    return '<p class="community-source-note">Source: '+reference(t?.source?.uri||'Retained community table')+
      ' · '+e(t?.source?.vintage||'')+' · '+e(income.label||'State median household income reference')+
      ': '+usd(income.threshold)+(income.year?' ('+e(income.year)+')':'')+'.</p>';
  }
  function utilityCards(t){
    return '<div class="community-utility-cards">'+utilities(t).map(u=>
      '<article><h3>'+e(u.name||u.id)+'</h3><strong>'+n(u.approximate_service_population)+'</strong>'+
      '<p>Approximate residents served by the utility system</p><small>'+reference(u.source_reference)+'</small></article>').join('')+'</div>'+
      '<p class="note">Utility system service populations describe the whole systems. The community table describes the selected whole census block groups. Geographic intersections and utility membership remain explicit in the retained source.</p>';
  }
  function groupTable(groups,t=selectedTable(),{selectable=false}={}){
    return table([...(selectable?['Compare']:[]),'Census block group','Utility / focus watershed','Population','Households','Median household income','Below state reference','Households below poverty','Reported poverty share'],
      groups.map(g=>'<tr>'+
        (selectable?'<td><input type="checkbox" data-community-compare="'+e(g.geoid)+'" aria-label="Compare block group '+e(g.geoid)+'" '+(local.compare.includes(g.geoid)?'checked':'')+'></td>':'')+
        '<th scope="row" class="community-geoid">'+button('group',g.geoid,'data-id="'+e(g.geoid)+'" data-table="'+e(t.id)+'"','community-text-button')+'</th>'+
        '<td class="community-memberships">'+membership(g,t)+'</td>'+
        '<td class="number-cell">'+n(g.population)+'</td><td class="number-cell">'+n(g.households)+'</td>'+
        '<td class="number-cell">'+usd(g.median_household_income)+'</td><td>'+e(g.below_state_median_income===true?'Yes':g.below_state_median_income===false?'No':'—')+'</td>'+
        '<td class="number-cell">'+n(g.households_below_poverty)+'</td><td class="number-cell">'+pct(g.reported_poverty_percent)+'</td></tr>'),
      'Whole-block-group context from the selected source edition');
  }
  function rollup(groups,t){
    const membershipRows=new Map();
    for(const g of groups)for(const m of list(g.memberships)){
      if(local.utility&&m.utility_id!==local.utility)continue;
      if(local.watershed&&m.watershed_id!==local.watershed)continue;
      const id=m.utility_id+'|'+m.watershed_id;
      if(!membershipRows.has(id))membershipRows.set(id,{...m,groups:[]});
      membershipRows.get(id).groups.push(g);
    }
    return table(['Utility / watershed','Unique block groups','Population','Households','Below-poverty households','Poverty share'],
      [...membershipRows.values()].map(r=>{const s=summarizeCommunityGroups(r.groups);return '<tr><th scope="row">'+e(utilityName(r.utility_id,t))+'<small>'+e(r.watershed_name||r.watershed_id)+'</small></th>'+
        '<td class="number-cell">'+n(s.groups)+'</td><td class="number-cell">'+n(s.population)+'</td><td class="number-cell">'+n(s.households)+'</td>'+
        '<td class="number-cell">'+n(s.households_below_poverty)+'</td><td class="number-cell">'+pct(s.poverty_percent)+'</td></tr>';}),
      'Each row counts its own unique geographies; shared groups may appear in more than one membership');
  }
  function explore(t){
    if(!t)return empty('Retain a community source table','Import the original table edition, then compare the source-water communities and prepare an intervention plan.',button('import','Import community table','','primary')+button('sources','Original sources'));
    if(!Array.isArray(t.groups))return '<div class="empty" role="status"><h2>Opening the retained community table</h2><p>Reading the complete original geographies and source metadata.</p></div>';
    const groups=filtered(t);
    return section('Source-water communities','Compare the original geographic context and keep the table edition with each plan.',
      '<div class="section-body community-controls"><div class="community-filter-grid">'+
      field('Utility',select('community_utility',utilities(t).map(u=>({id:u.id,title:u.name})),local.utility,'All utilities'))+
      field('Focus watershed',select('community_watershed',watershedChoices(t,local.utility),local.watershed,'All watersheds'))+
      field('Find a geography',input('community_query',local.query,'type="search" placeholder="GEOID, utility or watershed"'))+
      field('Order',select('community_sort',[{id:'geoid',title:'Census GEOID'},{id:'population_desc',title:'Population, highest first'},{id:'poverty_desc',title:'Below-poverty households, highest first'},{id:'income_asc',title:'Median income, lowest first'}],local.sort,'Choose order'))+'</div>'+
      '<div class="community-toolbar">'+button('reset-filters','Clear filters','','small')+button('select-visible','Select visible groups','','small')+
      button('clear-comparison','Clear comparison','','small')+'<span id="community-comparison-count" class="note">'+n(local.compare.length)+' groups selected</span>'+
      button('compare','Compare selected groups','','small')+button('plan-selection','Plan for this selection','','primary')+'</div></div>'+
      '<div id="community-explore-results">'+metrics(groups)+groupTable(groups,t,{selectable:true})+'</div>'+
      '<div class="section-body">'+sourceNote(t)+'</div>',
      button('table','Source details','data-id="'+e(t.id)+'"','small'))+
      section('Utility service context','Original system-wide service populations from the source metadata.','<div class="section-body">'+utilityCards(t)+'</div>')+
      section('Watershed comparison','Aggregate household figures from unique original block groups within each selected membership.','<div id="community-rollups">'+rollup(groups,t)+'</div>');
  }
  function planRows(){
    return plans().slice().sort((a,b)=>String(b.created_at??'').localeCompare(String(a.created_at??''))).map(p=>{
      const count=list(p.selected_groups).length||p.summaries?.overall?.groups;
      return '<tr><th scope="row">'+e(p.title)+'<small>'+e(p.purpose||'')+'</small></th><td>'+e(row('community_tables',p.table_id)?.title||short(p.table_id))+'</td>'+
        '<td class="number-cell">'+n(count)+'</td><td class="number-cell">'+n(list(p.interventions).length)+'</td><td>'+e(p.previous_plan_id?'Revised plan':'Initial plan')+'</td>'+
        '<td class="actions-cell">'+button('plan-open','Open','data-id="'+e(p.id)+'"','small')+button('plan-revise','Revise','data-id="'+e(p.id)+'"','small')+button('report-new','Build report','data-id="'+e(p.id)+'"','small')+revisions.planButton(p)+'</td></tr>';
    });
  }
  function planView(){
    const body=plans().length?section('Intervention plans','Each saved plan keeps its original source table, selected communities, model context and previous revision.',
      table(['Plan / purpose','Community table','Groups','Interventions','Revision',''],planRows()),
      button('plan-new','New intervention plan','','primary')):
      empty('Build a source-water intervention plan','Select communities, connect the original scientific results, and record a complete protection, restoration or monitoring work program.',button('plan-new','New intervention plan','','primary'));
    return body+revisions.renderList();
  }
  function reportView(){
    const body=reports().length?section('Community and utility reports','Open a retained report to preview its full narrative and download every original editable file.',
      table(['Report','Plan','Created','State',''],reports().map(r=>'<tr><th scope="row">'+e(r.title||r.selection?.title||'Community report')+'<small>'+e(short(r.id))+'</small></th>'+
        '<td>'+e(row('community_plans',r.plan_id||r.selection?.plan_id)?.title||short(r.plan_id||r.selection?.plan_id))+'</td>'+
        '<td>'+e(r.created_at?new Date(r.created_at).toLocaleString():'—')+'</td><td>'+e(human(r.state||'complete'))+'</td>'+
        '<td class="actions-cell">'+button('report-open','Open report','data-id="'+e(r.id)+'"','small')+'</td></tr>'))):
      empty('Retain a complete community report','Save an intervention plan, then build the narrative, original community rows, utility and watershed summaries, costs and model context.',button('tab-plans','Open plans'));
    return '<div class="page-actions">'+handover.receiveButton()+'</div>'+body;
  }
  function render(){
    sync();persist();
    const t=selectedTable();
    return '<div data-community-root class="community-workspace">'+
      '<header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH · UTILITY AND COMMUNITY PLANNING</p><h1>Communities</h1>'+
      '<p>Compare source-water communities, connect the original scientific results, and prepare a complete intervention plan and report.</p></div>'+
      '<div class="page-actions">'+button('import','Import community table')+button('plan-new','New plan','','primary')+'</div></header>'+
      '<div class="community-heading-controls">'+field('Retained community table',select('community_table',tables(),local.table,'Choose a retained table'))+
      '<nav class="community-tabs" aria-label="Community workflow">'+[['explore','Communities'],['plans','Intervention plans'],['reports','Reports']].map(([id,label])=>button('tab-'+id,label,'aria-pressed="'+(local.tab===id)+'"')).join('')+'</nav></div>'+
      ((local.plan||local.report)?'<div class="page-actions" data-community-saved-selection>'+(local.plan?button('plan-open','Selected plan','data-id="'+e(local.plan)+'"'):'')+(local.report?button('report-open','Selected report','data-id="'+e(local.report)+'"'):'')+'</div>':'')+
      (loadError?'<div class="notice error" role="alert">'+e(loadError)+button('retry','Retry original read','','small')+'</div>':'')+
      (local.tab==='explore'?explore(t):local.tab==='plans'?planView():reportView())+'</div>';
  }
  function visible(){return container?.isConnected&&container.querySelector('[data-community-root]');}
  function redraw(){
    if(!visible())return;
    const active=document.activeElement;
    const focus=container.contains(active)?{name:active.name,start:active.selectionStart,end:active.selectionEnd}:null;
    container.innerHTML=render();mount(container);
    if(focus?.name){
      const next=[...container.querySelectorAll('[name]')].find(x=>x.name===focus.name);
      next?.focus({preventScroll:true});
      if(next&&typeof focus.start==='number')try{next.setSelectionRange(focus.start,focus.end);}catch{}
    }
  }
  function updateExplore(){
    if(!visible())return;
    const t=selectedTable();if(!t?.groups)return;
    const focusedGeoid=container.contains(document.activeElement)?document.activeElement.dataset?.communityCompare:null;
    const groups=filtered(t),results=container.querySelector('#community-explore-results'),rollups=container.querySelector('#community-rollups');
    if(results)results.innerHTML=metrics(groups)+groupTable(groups,t,{selectable:true});
    if(rollups)rollups.innerHTML=rollup(groups,t);
    if(focusedGeoid)[...container.querySelectorAll('[data-community-compare]')].find(node=>node.dataset.communityCompare===focusedGeoid)?.focus({preventScroll:true});
    const count=container.querySelector('#community-comparison-count');if(count)count.textContent=n(local.compare.length)+' groups selected';
    persist();
  }
  function mount(node){
    mountController?.abort();mountController=new AbortController();container=node;
    if(!visible())return;
    const signal=mountController.signal;
    node.addEventListener('change',event=>{
      const target=event.target;
      if(target.name==='community_table'){local.table=target.value;local.utility='';local.watershed='';local.query='';local.compare=[];local.plan='';local.report='';loadError='';redraw();}
      else if(target.name==='community_utility'){local.utility=target.value;local.watershed='';redraw();}
      else if(target.name==='community_watershed'){local.watershed=target.value;updateExplore();}
      else if(target.name==='community_sort'){local.sort=target.value||'geoid';updateExplore();}
      else if(target.matches('[data-community-compare]')){
        const id=target.dataset.communityCompare;
        local.compare=target.checked?unique([...local.compare,id]):local.compare.filter(x=>x!==id);updateExplore();
      }
    },{signal});
    node.addEventListener('input',event=>{if(event.target.name==='community_query'){local.query=event.target.value;updateExplore();}},{signal});
    const t=selectedTable(),ws=workspace(),tableId=local.table;
    if(tableId&&!Array.isArray(t?.groups)&&!loadError)get('community_tables',tableId).then(()=>{
      if(visible()&&workspace()===ws&&local.table===tableId){loadError='';redraw();}
    }).catch(error=>{if(visible()&&workspace()===ws){loadError=error.message;redraw();}});
  }
  function form(){return document.getElementById('operation-form');}
  function value(name,root=form()){return root?.querySelector('[name="'+name+'"]')?.value??'';}
  function checked(name,root=form()){return [...(root?.querySelectorAll('[name="'+name+'"]:checked')??[])].map(x=>x.value);}
  function ensureFormWorkspace(){if(formWorkspace!==workspace())throw Error('The selected workspace changed. Open this form in the intended workspace.');}
  function sourceMetadata(t){
    return '<dl class="community-definition">'+info('Edition',t.title)+info('Source vintage',t.source?.vintage)+info('Original source SHA256',t.source?.sha256)+
      info('Unique census block groups',n(list(t.groups).length))+info('Original input rows',n(list(t.rows).length))+info('Income reference',usd(t.metadata?.income_reference?.threshold))+'</dl>'+
      '<p class="community-source-note">'+reference(t.source?.uri)+'</p>';
  }
  async function importForm(){
    const eligible=list(data().sources).flatMap(c=>list(c.entries).filter(s=>s.kind==='table'&&s.community_metadata).map(s=>({id:JSON.stringify([c.id,s.id]),title:c.title+' · '+s.title,source:s})));
    if(!eligible.length){
      detail('Import the original community source','<p>Import the registered community source edition through Original sources. Its table entry carries the original utility, income-reference and document metadata.</p><div class="page-actions">'+button('sources','Open original source intake','','primary')+'</div>',{kind:'community-source-intake'});return;
    }
    formWorkspace=workspace();
    openForm('Import a community table','Retain the original rows and their geographic memberships as a complete table edition.',
      '<div class="form-grid">'+field('Original source table',select('community_source',eligible,eligible.length===1?eligible[0].id:'','Choose original table','required'),'',true)+
      field('Edition title',input('community_title','','maxlength="240"'),'Optional; the original table title is retained when blank.',true)+
      '<div id="community-source-summary" class="full"></div></div>',
      'Import community table',async()=>{
        ensureFormWorkspace();const pair=JSON.parse(value('community_source'));
        return submitAction('community.table.import',{source_collection_id:pair[0],source_id:pair[1],...(value('community_title').trim()?{title:value('community_title').trim()}:{})});
      },()=>{
        const update=()=>{const item=eligible.find(x=>x.id===value('community_source'));const target=form().querySelector('#community-source-summary');
          target.innerHTML=item?'<p>'+reference(item.source.uri)+'</p><p class="note">'+e(item.source.vintage)+'</p><details class="technical"><summary>Original community metadata</summary><pre class="json-view">'+e(JSON.stringify(item.source.community_metadata,null,2))+'</pre></details>':'';};
        form().querySelector('[name="community_source"]').addEventListener('change',update);update();
      });
  }
  async function tableDetail(id){
    const t=await get('community_tables',id,{fresh:true});
    detail(t.title,'<div class="community-detail-actions">'+studyTransferButton('community-tables',t.id)+'</div>'+sourceMetadata(t)+metrics(t.groups)+utilityCards(t)+groupTable(t.groups,t)+
      fileList(t._downloads||[])+'<details class="technical"><summary>Complete retained source rows and metadata</summary><pre class="json-view">'+e(JSON.stringify(t,null,2))+'</pre></details>',
      {kind:'community_tables',id});
  }
  async function groupDetail(id,tableId){
    const t=await get('community_tables',tableId||local.table),g=list(t.groups).find(x=>x.geoid===id);
    if(!g)throw Error('This census geography is absent from the selected original table.');
    const originals=list(t.rows).filter(r=>(r.normalized?.geoid??r.geoid??r.group?.geoid)===id);
    detail('Census block group '+id,groupTable([g],t)+
      '<div class="section-body"><p>'+reference(t.source?.uri)+'</p><p class="note">Population and household values describe the full original census block group.</p></div>'+
      '<details class="technical" open><summary>Original retained row and membership</summary><pre class="json-view">'+e(JSON.stringify({group:g,original_rows:originals,source:t.source},null,2))+'</pre></details>',
      {kind:'community-group',id});
  }
  async function compare(){
    const t=await get('community_tables',local.table);
    const groups=selectCommunityGroups(t.groups,{geoids:local.compare});
    if(local.compare.length<2)throw Error('Select at least two original census block groups to compare.');
    detail('Community comparison',metrics(groups)+groupTable(groups,t)+sourceNote(t)+
      '<div class="page-actions">'+button('plan-selection','Create plan for selected groups','','primary')+'</div>',
      {kind:'community-comparison',id:t.id});
  }

  function groupChoices(t){
    return list(t?.groups).map(g=>({id:g.geoid,title:g.geoid,description:list(g.memberships).map(m=>m.watershed_name||m.watershed_id).join(' · ')}));
  }
  function planSelectionForm(t,selected={}){
    return '<div class="form-grid community-selection-grid">'+
      '<fieldset><legend>Utilities</legend><p class="note">Leave unchecked to include all utilities.</p>'+checks('community_plan_utilities',utilities(t).map(u=>({id:u.id,title:u.name})),list(selected.utility_ids))+'</fieldset>'+
      '<fieldset><legend>Focus watersheds</legend><p class="note">Leave unchecked to include all watersheds within the utility selection.</p>'+checks('community_plan_watersheds',watershedChoices(t),list(selected.watershed_ids))+'</fieldset>'+
      '<fieldset class="full"><legend>Specific census block groups</legend><p class="note">Leave unchecked to use every group matching the utility and watershed choices. Each selected combination follows its original membership.</p>'+
      checks('community_plan_geoids',groupChoices(t),list(selected.geoids))+'</fieldset>'+
      '<div id="community-plan-selection-summary" class="full" role="status"></div></div>';
  }
  function entityTitle(kind,id){
    const item=list(data()[kind]).find(x=>x.id===id);
    if(!item)return short(id);
    if(kind==='runs'){
      const s=item.selection??{};
      return entityTitle('scenarios',s.scenario_id)+' · '+entityTitle('profiles',s.profile_id);
    }
    return item.title||item.spec?.title||item.selection?.title||item.metadata?.title||short(id);
  }
  function completeRuns(grid=''){
    return list(data().runs).filter(r=>r.state==='complete'&&(!grid||r.selection?.grid_id===grid)).map(r=>({id:r.id,title:entityTitle('runs',r.id),grid_id:r.selection?.grid_id}));
  }

  function watershedReportOptions(selected=''){
    const choices=formWatershedCatalog.filter(row=>row.state==='complete').map(row=>({
      id:row.id,title:(row.title||row.id)+' · '+n(row.summary?.huc_count)+' watersheds'
    }));
    if(selected&&!choices.some(row=>row.id===selected))choices.unshift({
      id:selected,title:formWatershedReport?.title||formPlanPrevious?.context?.snapshots?.watershed_context?.title||'Previously selected regional report '+selected
    });
    return choices;
  }
  function watershedContextForm(context={}){
    const selected=context.watershed_context_id||'';
    return '<fieldset class="full"><legend>Regional watershed context</legend>'+
      field('Retained regional report',select('community_watershed_context',watershedReportOptions(selected),selected,'No regional report selected'),
        'Attach the existing NRCS areas, priority designations and SCDES query coverage for the plan’s selected watersheds.',true)+
      '<div class="actions-cell">'+button('watershed-refresh','Refresh regional reports','','small')+'</div>'+
      '<p id="community-watershed-catalog-note" class="note">'+e(formWatershedCatalogError||
        (formWatershedCatalog.length?'Choose a retained report to inspect the selected original watershed rows.':'Receive or build a regional report in Regional watersheds, then refresh this list.'))+'</p>'+
      '<div id="community-watershed-preview" aria-live="polite"></div></fieldset>';
  }
  async function readWatershedCatalog(){
    const owner=workspace(),generation=formWatershedGeneration;
    try{
      const result=await api(endpoint('/api/watershed-context/catalog'));
      if(owner!==workspace()||generation!==formWatershedGeneration)return;
      formWatershedCatalog=list(result.reports);
      formWatershedCatalogError='';
    }catch(error){
      if(owner!==workspace()||generation!==formWatershedGeneration)return;
      formWatershedCatalogError='Regional reports could not be refreshed: '+error.message;
    }
  }
  async function refreshWatershedCatalog(){
    ensureFormWorkspace();
    const host=form(),generation=formWatershedGeneration,selected=value('community_watershed_context');
    await readWatershedCatalog();
    if(host!==form()||generation!==formWatershedGeneration||formWorkspace!==workspace())return;
    setSelect(host.querySelector('[name="community_watershed_context"]'),watershedReportOptions(selected),selected,'No regional report selected');
    host.querySelector('#community-watershed-catalog-note').textContent=formWatershedCatalogError||
      (formWatershedCatalog.length?'Choose a retained report to inspect the selected original watershed rows.':'Receive or build a regional report in Regional watersheds, then refresh this list.');
    await loadWatershedContext();
  }
  function updateWatershedPreview(){
    const target=form()?.querySelector('#community-watershed-preview');if(!target)return;
    const selected=value('community_watershed_context');
    if(!selected){target.innerHTML='<p class="note">This plan will retain its selected community table and scientific context.</p>';return;}
    if(formWatershedError){target.innerHTML='<p role="alert">'+e(formWatershedError)+'</p>';return;}
    if(formWatershedReport?.id!==selected){target.innerHTML='<p class="note" role="status">Loading the original regional report…</p>';return;}
    try{
      const report=formWatershedReport.report;
      const chosen=selectCommunityWatersheds(report,formTable.groups,readSelection());
      if(!chosen.selected_huc12s.length){target.innerHTML='<p class="note">Choose the community memberships to inspect their regional context.</p>';return;}
      if(chosen.missing_huc12s.length){target.innerHTML='<p role="alert">The selected regional report is missing these plan watersheds: '+e(chosen.missing_huc12s.join(', '))+'. Choose a report containing the complete selection.</p>';return;}
      target.innerHTML=communityWatershedContextHtml({...report,...chosen,
        report_id:formWatershedReport.id,title:formWatershedReport.title||report.title,
        report_file:formWatershedReport.files?.['watershed-context.json'],
        source_fingerprint:formWatershedReport.source_fingerprint||report.source_fingerprint,
        source_edition_fingerprint:formWatershedReport.source_edition_fingerprint,
        source_inputs:formWatershedReport.source_inputs});
    }catch(error){target.innerHTML='<p role="alert">'+e(error.message)+'</p>';}
  }
  async function loadWatershedContext(){
    const host=form(),owner=workspace(),generation=formWatershedGeneration,request=++formWatershedRequest;
    const selected=value('community_watershed_context');
    formWatershedError='';
    if(!selected){formWatershedReport=null;updateWatershedPreview();return;}
    if(formWatershedReport?.id===selected){updateWatershedPreview();return;}
    formWatershedReport=null;updateWatershedPreview();
    try{
      const result=await get('watershed-context',selected);
      if(host!==form()||owner!==workspace()||generation!==formWatershedGeneration||request!==formWatershedRequest)return;
      if(result.id!==selected||!result.report||result.report.id!==selected)throw Error('The retained regional report identity differs from this selection.');
      formWatershedReport=result;
      updateWatershedPreview();
    }catch(error){
      if(host!==form()||owner!==workspace()||generation!==formWatershedGeneration||request!==formWatershedRequest)return;
      formWatershedError='The regional selection could not be loaded: '+error.message;
      updateWatershedPreview();
    }
  }
  async function ensureWatershedSelection(){
    const selected=value('community_watershed_context');if(!selected)return;
    await loadWatershedContext();
    ensureFormWorkspace();
    if(selected!==value('community_watershed_context'))throw Error('The regional report selection changed while loading. Save the plan again.');
    if(formWatershedReport?.id!==selected)throw Error(formWatershedError||'Load the selected original regional report before saving this plan.');
    const chosen=selectCommunityWatersheds(formWatershedReport.report,formTable.groups,readSelection());
    if(chosen.missing_huc12s.length)throw Error('The regional report is missing selected plan watersheds: '+chosen.missing_huc12s.join(', ')+'.');
  }

  function contextForm(context={}){
    const selectedGrid=context.grid_id||list(data().runs).find(r=>r.id===context.baseline_run_id)?.selection?.grid_id||'';
    return '<p class="note">'+e(SCIENTIFIC_SCOPE_TEXT)+'</p><div class="form-grid">'+
      field('Original model grid',select('community_grid',list(data().grids).filter(g=>g.state==='complete').map(g=>({id:g.id,title:entityTitle('grids',g.id)})),selectedGrid,'No grid selected'))+
      field('Completed baseline run',select('community_baseline',completeRuns(selectedGrid),context.baseline_run_id||'','No baseline selected'))+
      '<fieldset class="full"><legend>Completed alternative runs</legend><p class="note">Choose the actual alternative runs on the selected baseline grid.</p><div id="community-context-alternatives">'+checks('community_alternatives',completeRuns(selectedGrid).filter(r=>r.id!==context.baseline_run_id),list(context.scenario_run_ids))+'</div></fieldset>'+
      field('Original GIS delivery',select('community_delivery',list(data().deliveries).filter(d=>d.state==='complete').map(d=>({id:d.id,title:entityTitle('deliveries',d.id)})),context.delivery_id||'','No delivery selected'),'Attach a completed original map delivery to the community plan.',true)+
      '<fieldset class="full"><legend>Supporting source editions</legend>'+checks('community_sources',list(data().sources),list(context.source_collection_ids))+'</fieldset>'+watershedContextForm(context)+'</div>';
  }
  function interventionMembershipChoices(t,utilityId,watershedId,selected=[]){
    const rows=selectCommunityGroups(t.groups,{utility_ids:utilityId?[utilityId]:[],watershed_ids:watershedId?[watershedId]:[]});
    const choices=rows.map(g=>({id:g.geoid,title:g.geoid}));
    for(const id of selected)if(!choices.some(g=>g.id===id))choices.push({id,title:id+' — outside this membership'});
    return checks('intervention_geoids',choices,selected);
  }
  function interventionRow(t,value={}){
    const id=value.id||'I-'+crypto.randomUUID(),utility=value.utility_id||'',watershed=value.watershed_id||'';
    return '<fieldset class="community-intervention" data-community-intervention="'+e(id)+'"><legend>Intervention</legend>'+
      '<div class="community-intervention-heading"><p class="note">Describe the complete work and the selected source-water communities.</p>'+button('intervention-remove','Remove this intervention','','small')+'</div>'+
      '<div class="form-grid">'+field('Title',input('intervention_title',value.title||'','required maxlength="240"'),'',true)+
      field('Utility',select('intervention_utility',utilities(t).map(u=>({id:u.id,title:u.name})),utility,'Choose utility','required'))+
      field('Focus watershed',select('intervention_watershed',watershedChoices(t,utility),watershed,'Choose watershed','required'))+
      '<fieldset class="full"><legend>Specific block groups</legend><p class="note">Choose the communities addressed by this intervention. An empty selection uses the plan’s selected groups in this utility and watershed.</p><div data-community-intervention-groups>'+interventionMembershipChoices(t,utility,watershed,list(value.geoids))+'</div></fieldset>'+
      field('Priority',select('intervention_priority',priorityOptions,value.priority||'medium','Choose priority','required'))+
      field('Strategy',select('intervention_strategy',strategyOptions,value.strategy||'investigate','Choose strategy','required'))+
      field('Status',select('intervention_status',statusOptions,value.status||'proposed','Choose status','required'))+
      field('Estimated cost (USD)',input('intervention_cost',value.cost_estimate_usd??'','inputmode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" placeholder="To be scoped"'),'Retain the stated estimate; leave blank when the cost is unknown.')+
      field('Reason and intended benefit',textarea('intervention_reason',value.reason||'','required rows="3"'),'',true)+
      field('Work owner',input('intervention_owner',value.owner||'','maxlength="240"'))+
      field('Next work step',input('intervention_next_step',value.next_step||'','maxlength="1200"'))+
      field('Notes',textarea('intervention_notes',value.notes||'','rows="2"'),'',true)+'</div></fieldset>';
  }

  function interventionImportForm(){
    return '<fieldset class="full"><legend>Receive an intervention programme</legend>'+
      '<p class="note">Choose an intervention CSV, map its original columns to plan fields, and preview the changes before loading its rows. Saving retains the original file, field mapping and complete revision. Row order becomes programme order; population and household context come from the retained communities.</p>'+
      field('Intervention CSV','<input type="file" name="community_intervention_csv" accept=".csv,text/csv">','Quoted commas, multiline notes and spreadsheet HUC12 values are supported.',true)+
      '<div class="page-actions">'+button('intervention-import-columns','Read file columns','','small')+button('intervention-import-preview','Preview CSV changes','','small')+'</div>'+
      '<div id="community-import-mapping"></div><p id="community-import-mapping-status" class="note" role="status"></p>'+
      '<div id="community-import-error" class="notice error" role="alert" hidden></div>'+
      '<div id="community-import-preview"></div><p id="community-import-applied" class="note" role="status"></p></fieldset>';
  }
  const interventionFieldLabels={
    id:'Intervention ID',title:'Intervention title',priority:'Priority',strategy:'Strategy',status:'Status',
    utility_id:'Original utility ID',watershed_id:'Original HUC12',geoids:'Block-group GEOIDs',
    reason:'Reason and intended benefit',owner:'Work owner',next_step:'Next work step',
    cost_estimate_usd:'Estimated cost (USD)',notes:'Notes'};
  const interventionDefaultNotes={
    id:'An unmapped or blank ID is generated from the original file SHA256 and row.',
    priority:'Blank uses medium.',strategy:'Blank uses investigate.',status:'Blank uses proposed.',
    geoids:'Separate GEOIDs with semicolons; blank uses the selected utility/watershed membership.',
    cost_estimate_usd:'Use the original nonnegative USD estimate. Blank stays unspecified.',
    utility_id:'Values must identify an actual utility in this retained table.',
    watershed_id:'Values must identify an actual watershed for that utility.'};
  function readInterventionColumnChoices(host){
    const controls=[...host.querySelectorAll('[data-community-import-field]')];
    return controls.length?Object.fromEntries(controls.map(node=>[node.dataset.communityImportField,node.value||null])):null;
  }
  function showInterventionColumns(host,headers,mapping){
    const choices=headers.map((name,index)=>({id:name,title:(index+1)+': '+name}));
    host.querySelector('#community-import-mapping').innerHTML=
      '<h3>Original column mapping</h3><p class="note">Exact standard headings are selected automatically. Choose other headings explicitly. The saved import records the original column name and position for every plan field.</p>'+
      '<div class="form-grid">'+interventionFields.map(field=>fieldControl(field)).join('')+'</div>';
    function fieldControl(name){
      const required=interventionRequiredColumns.includes(name)&&name!=='id';
      const placeholder=required?'Choose original column':name==='id'?'Generate stable IDs':'Use native default / blank';
      return field(interventionFieldLabels[name]+(required?' *':''),
        select('community_import_map_'+name,choices,mapping[name]||'',placeholder,'data-community-import-field="'+e(name)+'"'),
        interventionDefaultNotes[name]||'Original received text.');
    }
  }
  function invalidateInterventionPreview(host,message){
    ++formCsvEpoch;formCsvPreview=null;
    host.querySelector('#community-import-preview').innerHTML='';
    host.querySelector('#community-import-error').hidden=true;
    host.querySelector('#community-import-mapping-status').textContent=message;
  }
  function interventionImportSummary(result,source){
    const s=result.summary;
    const rows=result.records.map((row,index)=>'<tr><td>'+e(result.rows[index].source_line)+'</td><th scope="row">'+e(row.title)+'<small>'+e(row.id)+'</small></th>'+
      '<td>'+e(row.utility_id)+'<small>'+e(row.watershed_id)+'</small></td><td>'+e(row.geoids.join(', '))+'</td><td>'+e(human(row.status))+'</td><td>'+e(row.owner||'Unassigned')+'</td><td class="number-cell">'+usd(row.cost_estimate_usd)+'</td></tr>');
    return '<h3>'+e(source.filename)+'</h3><p>'+n(s.row_count)+' intervention rows; '+n(s.added_ids.length)+' added, '+n(s.changed_ids.length)+' changed, '+
      n(s.removed_ids.length)+' removed and '+n(s.unchanged_ids.length)+' unchanged compared with the saved plan.</p>'+
      '<p>'+usd(s.known_estimate_total)+' across '+n(s.known_estimate_count)+' entered estimates.</p>'+
      (s.normalized_geographies.length?'<p class="note">Restored original geographic identifiers: '+s.normalized_geographies.map(row=>'row '+row.row+' '+e(row.original)+' → '+e(row.resolved)).join('; ')+'.</p>':'')+
      (s.additional_columns.length?'<p class="note">Unmapped columns retained in the received CSV: '+e(s.additional_columns.join(', '))+'.</p>':'')+
      (result.field_provenance?'<details><summary>Retained source-field mapping</summary>'+table(['Plan field','Original CSV column','Column','Basis'],
        result.field_provenance.map(row=>'<tr><th scope="row">'+e(interventionFieldLabels[row.field])+'</th><td>'+e(row.source_column??'Unmapped')+'</td><td>'+e(row.source_column_number??'')+'</td><td>'+e(human(row.basis.replaceAll('-','_')))+'</td></tr>'))+'</details>':'')+
      '<details class="technical"><summary>Review all '+n(s.row_count)+' intervention rows</summary>'+table(['CSV row','Intervention','Utility / HUC12','Block groups','Status','Owner','Estimate'],rows)+'</details>'+
      '<div class="page-actions">'+button('intervention-import-apply','Load these intervention rows','','primary')+'</div>';
  }
  async function previewInterventionImport(columnsOnly=false){
    ensureFormWorkspace();
    const host=form(),target=host?.querySelector('#community-import-preview'),errorNode=host?.querySelector('#community-import-error');
    if(!target||!formTable)throw Error('Open the intervention plan before receiving a CSV.');
    const file=host.querySelector('[name="community_intervention_csv"]')?.files?.[0],epoch=++formCsvEpoch;
    const requestedMapping=readInterventionColumnChoices(host),priorSource=formCsvInput?.source;
    formCsvPreview=null;target.innerHTML='';errorNode.hidden=true;errorNode.textContent='';
    try{
      if(!file)throw Error('Choose the edited interventions.csv file.');
      if(!file.name||file.name.length>255||/[\\/\0]/.test(file.name))throw Error('Choose the original CSV filename without a directory.');
      target.innerHTML='<p class="note" role="status">Reading '+e(file.name)+'…</p>';
      const bytes=await file.arrayBuffer();
      const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      const checksum=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
      if(epoch!==formCsvEpoch||form()!==host)return;
      ensureFormWorkspace();
      const parsed=parseCommunityCsv(raw),headers=parsed[0]?.cells;
      if(!headers?.length||headers.some(column=>!column)||new Set(headers).size!==headers.length)
        throw Error('The intervention CSV needs distinct, nonempty column headings.');
      const source={filename:file.name,media_type:'text/csv; charset=utf-8',bytes:bytes.byteLength,sha256:checksum,text:raw};
      const mapping=priorSource?.sha256===checksum&&requestedMapping?requestedMapping:
        Object.fromEntries(interventionFields.map(field=>[field,headers.includes(field)?field:null]));
      formCsvInput={source,headers};showInterventionColumns(host,headers,mapping);
      host.querySelector('#community-import-mapping-status').textContent='Original file: '+file.name+' · '+headers.length+' columns. Review the mapping, then preview the changes.';
      if(columnsOnly){target.innerHTML='';return;}
      const result=readInterventionCsv(raw,formTable,list(formPlanPrevious?.interventions),checksum,readSelection(),mapping);
      formCsvPreview={result,source,columnMapping:result.column_mapping};
      target.innerHTML=interventionImportSummary(result,source);
    }catch(error){
      if(epoch!==formCsvEpoch||form()!==host)return;
      target.innerHTML='';errorNode.hidden=false;
      errorNode.innerHTML='<strong>'+e(error.message)+'</strong>'+(error.rowErrors?.length?'<ul>'+error.rowErrors.map(message=>'<li>'+e(message)+'</li>').join(''):'');
    }
  }
  function applyInterventionImport(){
    ensureFormWorkspace();
    if(!formCsvPreview)throw Error('Preview the edited CSV before loading its rows.');
    const host=form(),{source,columnMapping}=formCsvPreview;
    let result;
    try{
      if(JSON.stringify(readInterventionColumnChoices(host))!==JSON.stringify(columnMapping))
        throw Error('Preview the current field mapping before loading its rows.');
      result=readInterventionCsv(source.text,formTable,list(formPlanPrevious?.interventions),source.sha256,readSelection(),columnMapping);
    }
    catch(error){const node=host.querySelector('#community-import-error');node.hidden=false;node.innerHTML='<strong>'+e(error.message)+'</strong>'+(error.rowErrors?.length?'<ul>'+error.rowErrors.map(message=>'<li>'+e(message)+'</li>').join(''):'');return;}
    const selected=selectCommunityGroups(formTable.groups,readSelection()),allowed=new Map(selected.map(group=>[group.geoid,group]));
    const outside=result.records.filter(row=>row.geoids.some(id=>!allowed.has(id)||!list(allowed.get(id).memberships).some(member=>member.utility_id===row.utility_id&&member.watershed_id===row.watershed_id)));
    if(outside.length){
      const node=host.querySelector('#community-import-error');node.hidden=false;
      node.innerHTML='<strong>Include the imported communities in this plan selection.</strong><ul>'+outside.map(row=>'<li>'+e(row.id)+': '+e(row.title)+' uses groups outside the selected utility, watershed or census geography.</li>').join('')+'</ul>';
      return;
    }
    host.querySelector('#community-import-error').hidden=true;
    host.querySelector('#community-interventions').innerHTML=result.records.map(row=>interventionRow(formTable,row)).join('');
    formInterventionImport={schema:'upstate.intervention-csv-import/v1',source,selection:readSelection(),column_mapping:result.column_mapping};
    host.querySelector('#community-import-preview').innerHTML='';
    host.querySelector('#community-import-applied').textContent=result.records.length+' interventions loaded from '+source.filename+'. Review or edit the rows below, then save the complete plan revision.';
    formCsvPreview=null;
    host.querySelector('#community-interventions [name="intervention_title"]')?.focus({preventScroll:true});
  }

  function readSelection(){
    return {utility_ids:checked('community_plan_utilities'),watershed_ids:checked('community_plan_watersheds'),geoids:checked('community_plan_geoids')};
  }
  function readContext(){
    const context={source_collection_ids:checked('community_sources'),scenario_run_ids:checked('community_alternatives')};
    for(const [name,key]of [['community_grid','grid_id'],['community_baseline','baseline_run_id'],['community_delivery','delivery_id'],['community_watershed_context','watershed_context_id']]){
      const chosen=value(name);if(chosen)context[key]=chosen;
    }
    return context;
  }
  function readInterventions(){
    const groups=selectCommunityGroups(formTable.groups,readSelection()),selectedIds=new Set(groups.map(g=>g.geoid));
    return [...form().querySelectorAll('[data-community-intervention]')].map(row=>{
      const cost=value('intervention_cost',row).trim();
      if(cost&&!/^\d+(?:\.\d{1,2})?$/.test(cost))throw Error('Enter an intervention cost as a nonnegative USD amount with at most two decimal places.');
      const result={id:row.dataset.communityIntervention,title:value('intervention_title',row).trim(),utility_id:value('intervention_utility',row),
        watershed_id:value('intervention_watershed',row),geoids:checked('intervention_geoids',row),priority:value('intervention_priority',row),
        strategy:value('intervention_strategy',row),status:value('intervention_status',row),cost_estimate_usd:cost||null,
        reason:value('intervention_reason',row).trim(),owner:value('intervention_owner',row).trim(),next_step:value('intervention_next_step',row).trim(),notes:value('intervention_notes',row).trim()};
      const inMembership=selectCommunityGroups(groups,{utility_ids:[result.utility_id],watershed_ids:[result.watershed_id]});
      if(!inMembership.length)throw Error('Intervention "'+result.title+'" has no communities in the plan’s selected utility and watershed.');
      const allowed=new Set(inMembership.map(g=>g.geoid));
      if(result.geoids.some(id=>!selectedIds.has(id)||!allowed.has(id)))throw Error('Intervention "'+result.title+'" selects a block group outside its plan, utility or watershed. Update that geography selection.');
      return result;
    });
  }
  function updatePlanSummary(){
    const node=form()?.querySelector('#community-plan-selection-summary');if(!node||!formTable)return;
    const groups=selectCommunityGroups(formTable.groups,readSelection());
    node.innerHTML=metrics(groups)+(groups.length?'':'<p class="notice">The current utility, watershed and geography choices have no matching groups.</p>');
  }
  function setSelect(node,rows,selected,placeholder){
    if(!node)return;
    node.innerHTML='<option value="">'+e(placeholder)+'</option>'+rows.map(r=>'<option value="'+e(r.id)+'" '+(r.id===selected?'selected':'')+'>'+e(r.title||r.name||r.id)+'</option>').join('');
  }
  function updateContext({changed}={}){
    const host=form();if(!host)return;
    let grid=value('community_grid'),baseline=value('community_baseline'),alternatives=checked('community_alternatives');
    if(changed==='community_baseline'&&baseline){
      const run=list(data().runs).find(r=>r.id===baseline);
      if(run?.selection?.grid_id&&!grid){grid=run.selection.grid_id;host.querySelector('[name="community_grid"]').value=grid;}
    }
    const runs=completeRuns(grid);
    if(!runs.some(r=>r.id===baseline))baseline='';
    setSelect(host.querySelector('[name="community_baseline"]'),runs,baseline,'No baseline selected');
    host.querySelector('#community-context-alternatives').innerHTML=checks('community_alternatives',runs.filter(r=>r.id!==baseline),alternatives);
  }
  function bindPlan(){
    const host=form();host.dataset.communityPlan='true';
    host.addEventListener('change',event=>{
      if(!host.dataset.communityPlan)return;
      const target=event.target;
      if(target.dataset.communityImportField){
        invalidateInterventionPreview(host,'Mapping changed. Preview the current columns before loading intervention rows.');
      }
      if(target.name==='community_intervention_csv'){
        formCsvInput=null;host.querySelector('#community-import-mapping').innerHTML='';
        invalidateInterventionPreview(host,'Read the selected file columns or preview its intervention rows.');
      }
      if(['community_plan_utilities','community_plan_watersheds','community_plan_geoids'].includes(target.name)){updatePlanSummary();updateWatershedPreview();}
      if(target.name==='community_watershed_context')void loadWatershedContext();
      if(['community_grid','community_baseline'].includes(target.name))updateContext({changed:target.name});
      const row=target.closest('[data-community-intervention]');
      if(row&&['intervention_utility','intervention_watershed'].includes(target.name)){
        const utility=value('intervention_utility',row);let watershed=value('intervention_watershed',row);
        const watersheds=watershedChoices(formTable,utility);
        if(!watersheds.some(w=>w.id===watershed))watershed='';
        setSelect(row.querySelector('[name="intervention_watershed"]'),watersheds,watershed,'Choose watershed');
        const selected=checked('intervention_geoids',row);
        row.querySelector('[data-community-intervention-groups]').innerHTML=interventionMembershipChoices(formTable,utility,watershed,selected);
      }
    },{signal:planFormController.signal});
    updatePlanSummary();
    void loadWatershedContext();
  }
  let planFormController=null;
  async function planForm(id,{fromSelection=false}={}){
    sync();
    const generation=++formWatershedGeneration,selectedWorkspace=workspace();
    if(!tables().length)return importForm();
    const old=id?await get('community_plans',id):null;
    const tableId=old?.table_id||local.table||tables()[0].id;
    const t=await get('community_tables',tableId);
    if(generation!==formWatershedGeneration||selectedWorkspace!==workspace())return;
    formTable=t;formWorkspace=workspace();
    formPlanPrevious=old;formCsvPreview=null;formCsvInput=null;formInterventionImport=null;formCsvEpoch++;
    formWatershedCatalog=list(data().watershed_context_reports);
    formWatershedReport=null;formWatershedError='';formWatershedCatalogError='';formWatershedRequest++;
    await readWatershedCatalog();
    if(generation!==formWatershedGeneration||selectedWorkspace!==workspace())return;
    const selection=old?.selection||(fromSelection?{
      utility_ids:local.utility?[local.utility]:[],watershed_ids:local.watershed?[local.watershed]:[],
      geoids:local.compare.length?list(local.compare):local.query.trim()?filtered(t).map(g=>g.geoid):[]
    }:{utility_ids:[],watershed_ids:[],geoids:[]});
    document.getElementById('detail-dialog')?.close();
    planFormController?.abort();planFormController=new AbortController();
    openForm(old?'Revise intervention plan':'New intervention plan','Save the complete community selection, scientific context and proposed work together.',
      '<div class="community-plan-form"><div class="form-grid">'+
      field('Plan title',input('community_plan_title',old?.title||'','required maxlength="240"'),'',true)+
      field('Purpose',textarea('community_plan_purpose',old?.purpose||'','required rows="3"'),'',true)+
      '<div class="full community-form-source"><strong>'+e(t.title)+'</strong><p>'+reference(t.source?.uri)+'</p><small>Original table '+e(short(t.id))+' · '+e(t.source?.vintage||'')+'</small></div></div>'+
      '<fieldset><legend>Community selection</legend>'+planSelectionForm(t,selection)+'</fieldset>'+
      '<fieldset><legend>Original scientific context</legend><p class="note">Choose existing source editions and completed model results to accompany the community plan. The original model coverage and physical units remain part of the report.</p>'+contextForm(old?.context)+'</fieldset>'+
      interventionImportForm()+
      '<div class="subheading"><h3>Interventions</h3>'+button('intervention-add','Add intervention','','small')+'</div>'+
      '<div id="community-interventions">'+list(old?.interventions).map(v=>interventionRow(t,v)).join('')+'</div>'+
      field('Plan notes',textarea('community_plan_notes',old?.notes||'','rows="3"'),'One note per line.',true)+
      (old?'<p class="note">This revision retains the previous plan and its original intervention identities.</p>':'')+'</div>',
      old?'Save revised plan':'Save complete plan',async()=>{
        ensureFormWorkspace();
        await ensureWatershedSelection();
        const selected=readSelection();
        if(!selectCommunityGroups(formTable.groups,selected).length)throw Error('Choose at least one original community through the utility, watershed and geography selections.');
        const payload={title:value('community_plan_title').trim(),purpose:value('community_plan_purpose').trim(),table_id:formTable.id,selection:selected,
          context:readContext(),interventions:readInterventions(),notes:value('community_plan_notes').split(/\r?\n/).map(s=>s.trim()).filter(Boolean),
          ...(old?{previous_plan_id:old.id}:{}),
          ...(formInterventionImport?{intervention_import:formInterventionImport}:{})};
        return submitAction('community.plan.save',payload);
      },bindPlan);
  }
  function interventionTable(rows,t){
    if(!list(rows).length)return '<div class="section-body"><p class="note">This plan retains its community and scientific selections. Add the intervention work program in a revised plan.</p></div>';
    return table(['Priority / status','Intervention','Utility / watershed','Communities','Owner / next step','Estimate'],
      rows.map(r=>'<tr><td><strong>'+e(human(r.priority))+'</strong><small>'+e(human(r.status))+'</small></td>'+
        '<th scope="row">'+e(r.title)+'<small>'+e(human(r.strategy))+'</small><p class="community-cell-note">'+e(r.reason)+'</p></th>'+
        '<td>'+e(utilityName(r.utility_id,t))+'<small>'+e(watershedChoices(t,r.utility_id).find(w=>w.id===r.watershed_id)?.title||r.watershed_id)+'</small></td>'+
        '<td>'+e(list(r.geoids).length?r.geoids.join(', '):'Selected plan groups in this membership')+'</td>'+
        '<td>'+e(r.owner||'Unassigned')+'<small>'+e(r.next_step||'')+'</small></td><td class="number-cell">'+usd(r.cost_estimate_usd)+'</td></tr>'));
  }
  function scientificCoverage(context={}){
    const rows=list(context.physical_totals);
    const note='<div class="section-body"><p class="note">'+e(SCIENTIFIC_SCOPE_TEXT)+'</p></div>';
    if(!rows.length)return note;
    return note+table(['Original run','Pollutant','Reporting-area total','Unit','Run valid cells','Cell area (ha)'],
      rows.map(row=>'<tr><th scope="row">'+e(entityTitle('runs',row.run_id))+'<small>'+e(short(row.run_id))+'</small></th>'+
        '<td>'+e(human(row.pollutant))+'</td><td>'+e(row.value??'Unspecified')+'</td><td>'+e(row.unit||'Unspecified')+'</td>'+
        '<td>'+e(row.artifact?.valid_cells??'Unspecified')+'</td><td>'+e(row.artifact?.pixel_area_ha??'Unspecified')+'</td></tr>'));
  }
  function contextDetails(plan){
    const c=plan.context??{},items=[];
    if(c.grid_id)items.push(['Model grid',entityTitle('grids',c.grid_id),button('native-item','Open grid','data-kind="grids" data-id="'+e(c.grid_id)+'"','small')]);
    if(c.baseline_run_id)items.push(['Baseline model run',entityTitle('runs',c.baseline_run_id),button('native-item','Open run','data-kind="runs" data-id="'+e(c.baseline_run_id)+'"','small')]);
    for(const id of list(c.scenario_run_ids))items.push(['Alternative model run',entityTitle('runs',id),button('native-item','Open run','data-kind="runs" data-id="'+e(id)+'"','small')]);
    if(c.delivery_id)items.push(['GIS delivery',entityTitle('deliveries',c.delivery_id),button('native-item','Open delivery','data-kind="deliveries" data-id="'+e(c.delivery_id)+'"','small')]);
    for(const id of list(c.source_collection_ids))items.push(['Supporting source edition',entityTitle('sources',id),button('native-item','Open source','data-kind="sources" data-id="'+e(id)+'"','small')]);
    const regional=communityWatershedContextHtml(c.snapshots?.watershed_context);
    return regional+(items.length?scientificCoverage(c)+table(['Context','Original selection',''],items.map(([kind,title,action])=>'<tr><th scope="row">'+e(kind)+'</th><td>'+e(title)+'</td><td class="actions-cell">'+action+'</td></tr>')):
      regional?'':'<div class="section-body"><p class="note">This plan retains the original community table. Add completed scientific selections in a revised plan when they are ready.</p></div>');
  }
  async function planDetail(id){
    const p=await get('community_plans',id,{fresh:true}),t=await get('community_tables',p.table_id),groups=list(p.selected_groups).length?p.selected_groups:selectCommunityGroups(t.groups,p.selection);
    selectRetainedTable(p.table_id);local.plan=p.id;local.tab='plans';if(row('community_reports',local.report)?.plan_id!==p.id)local.report='';persist();
    const related=reports().filter(r=>(r.plan_id||r.selection?.plan_id)===id);
    detail(p.title,
      '<p class="community-intro">'+e(p.purpose)+'</p><div class="community-detail-actions">'+button('plan-revise','Revise plan','data-id="'+e(p.id)+'"')+button('report-new','Build complete report','data-id="'+e(p.id)+'"','primary')+revisions.planButton(p)+
      studyTransferButton('community-plans',p.id)+'</div>'+
      metrics(groups)+section('Selected communities',t.title,groupTable(groups,t))+
      section('Intervention work program','Retained priorities, work owners, intended benefits and costs.',interventionTable(p.interventions,t))+
      (p.intervention_import?section('Received intervention programme',p.intervention_import.source.filename,'<div class="section-body"><p>'+n(p.intervention_import.summary.row_count)+' original CSV rows retained with this revision. '+n(p.intervention_import.summary.added_ids.length)+' added, '+n(p.intervention_import.summary.changed_ids.length)+' changed and '+n(p.intervention_import.summary.removed_ids.length)+' removed from the preceding saved plan.</p><p class="note">Build the complete report to download the original received CSV beside the current editable programme.</p></div>'):'')+
      section('Original scientific context','Selected original results retain their model coverage and physical units.',contextDetails(p))+
      (text(p.notes)?'<section class="section"><div class="section-body"><h2>Plan notes</h2><p class="community-prewrap">'+e(text(p.notes))+'</p></div></section>':'')+
      (p.previous_plan_id?'<div class="community-detail-actions">'+button('plan-open','Open previous revision','data-id="'+e(p.previous_plan_id)+'"','small')+'</div>':'')+
      (related.length?section('Reports from this exact plan','Each report retains the complete source rows and selected work program.',table(['Report',''],related.map(r=>'<tr><th scope="row">'+e(r.title||r.selection?.title||'Community report')+'</th><td class="actions-cell">'+button('report-open','Open','data-id="'+e(r.id)+'"','small')+'</td></tr>'))):'')+
      fileList(p._downloads||[])+
      '<details class="technical"><summary>Complete saved plan and source bindings</summary><pre class="json-view">'+e(JSON.stringify(p,null,2))+'</pre></details>',{kind:'community_plans',id});
  }
  async function reportForm(id){
    const p=await get('community_plans',id),t=await get('community_tables',p.table_id);
    formWorkspace=workspace();
    document.getElementById('detail-dialog')?.close();
    openForm('Build community and utility report','Create the complete narrative, original rows, community/utility/watershed summaries, intervention program and scientific context from this exact plan.',
      '<div class="community-form-source"><h3>'+e(p.title)+'</h3><p>'+e(p.purpose)+'</p><small>'+e(t.title)+'</small></div>'+
      field('Report title',input('community_report_title',p.title,'maxlength="240"'),'The plan title is used when blank.',true)+
      '<p class="note">The report includes editable Markdown, JSON, the original table, and CSVs for communities, utilities, watersheds and interventions. Every file is retained with the selected plan.</p>',
      'Build complete report',()=>{
        ensureFormWorkspace();
        return submitAction('community.report.build',{plan_id:p.id,...(value('community_report_title').trim()?{title:value('community_report_title').trim()}:{})});
      });
  }
  async function reportSourceForm(id){
    const requestedWorkspace=workspace(),request=++reportSourceRequest;
    const report=await get('community_reports',id,{fresh:true});
    if(workspace()!==requestedWorkspace||request!==reportSourceRequest)return;
    const original=report.files?.['community-report.json'];
    if(!original?.sha256||!report.files?.['REPORT.json']||!report.files?.['community-report.zip'])
      throw Error('Open a complete saved Community report with its original source files.');
    formWorkspace=requestedWorkspace;
    const deliveries=list(data().deliveries);
    document.getElementById('detail-dialog')?.close();
    openForm('Use Community report in scientific reporting',
      'Receive this saved report and every original member as a retained scientific source. The existing report viewer and ordered delivery selector use the same edition.',
      '<div class="community-form-source"><h3>'+e(report.title||'Community and utility report')+'</h3>'+
      '<p>The source includes the original community table, editable interventions, saved regional context and every file in this report edition.</p></div>'+
      field('Delivery selection',
        '<select name="community_report_delivery"><option value="">Prepare a new report selection</option>'+
        deliveries.map(row=>'<option value="'+e(row.id)+'">'+e(row.title||row.selection?.title||row.id)+'</option>').join('')+'</select>',
        'An existing delivery keeps its original model runs, maps and ordered report sources. This Community report is appended once.',true)+
      '<p class="note">Review the prepared source through Original sources → Review retained reports. The complete map-delivery form uses its existing completed-model requirements. The Community source is available as soon as this preparation finishes.</p>',
      'Prepare scientific report source',()=>{
        ensureFormWorkspace();
        if(workspace()!==requestedWorkspace||request!==reportSourceRequest)
          throw Error('Reopen the original report in the intended Workspace.');
        const deliveryId=value('community_report_delivery');
        if(deliveryId&&!deliveries.some(row=>row.id===deliveryId))
          throw Error('Choose an existing retained delivery selection.');
        return submitAction('community.report.source.prepare',{
          report_id:report.id,report_sha256:original.sha256,...(deliveryId?{delivery_id:deliveryId}:{})
        });
      });
  }
  async function openPreparedReport(taskId,{sourceOnly=false,scientific=false}={}){
    const requestedWorkspace=workspace(),task=await api(endpoint('/api/task',{id:taskId}));
    if(workspace()!==requestedWorkspace)return;
    if(task.workspace!==requestedWorkspace||!['community.report.source.prepare','community.report.handover.receive'].includes(task.action)||task.state!=='complete')
      throw Error('Open a completed Community report source operation in its original Workspace.');
    const result=task.result||{},source=result.source,selection=result.delivery_selection;
    if(!source?.source_collection_id||!source?.source_id||!list(selection?.observed_context_sources).some(
      row=>row.source_collection_id===source.source_collection_id&&row.source_id===source.source_id))
      throw Error('The completed operation has no matching retained report source selection.');
    if(scientific){
      if(typeof openScientificReport!=='function')throw Error('Open this report in the current scientific report workspace.');
      return openScientificReport({workspace_key:requestedWorkspace,
        sources:selection.observed_context_sources.map(row=>({source_collection_id:row.source_collection_id,source_id:row.source_id})),
        ...(typeof result.title==='string'?{title:result.title}:{})});
    }
    document.getElementById('detail-dialog')?.close();
    if(sourceOnly)return openItem('sources',source.source_collection_id);
    await refreshState({force:true});
    if(workspace()!==requestedWorkspace)return;
    return openDelivery(JSON.parse(JSON.stringify(selection)));
  }
  function taskActions(task){
    if(['community.plan.compare','community.revision.receive'].includes(task?.action))return revisions.taskActions(task);
    if(task?.action==='community.report.handover.export')return handover.taskActions(task);
    if(task?.workspace!==workspace()||!['community.report.source.prepare','community.report.handover.receive'].includes(task.action)||task.state!=='complete'||!task.result?.source)return '';
    return '<div class="page-actions">'+
      (typeof openScientificReport==='function'?button('report-source-scientific','Open scientific report','data-id="'+e(task.id)+'"','primary'):'')+
      button('report-source-edition','Open retained report source','data-id="'+e(task.id)+'"')+
      button('report-source-open','Open prepared delivery form','data-id="'+e(task.id)+'"')+'</div>';
  }
  async function reportDetail(id,{preview=false}={}){
    const r=await get('community_reports',id,{fresh:true});
    const files=list(r._downloads),html=files.find(f=>/\.html?$/i.test(f.filename||''));
    const planId=r.plan_id||r.selection?.plan_id;
    selectRetainedTable(r.table_id);local.plan=planId||'';local.report=r.id;local.tab='reports';persist();
    const title=r.title||r.selection?.title||'Community and utility report';
    const body='<div class="community-detail-actions">'+(planId?button('plan-open','Open original plan','data-id="'+e(planId)+'"'):'')+
      (html?button('report-preview',preview?'Hide report preview':'Preview full report','data-id="'+e(id)+'" data-preview="'+(!preview)+'"','primary'):'')+
      button('report-source','Use in scientific report','data-id="'+e(id)+'"')+
      handover.reportButton(r)+studyTransferButton('community-reports',r.id)+'</div>'+
      '<p class="note">'+e(SCIENTIFIC_SCOPE_TEXT)+'</p>'+communityPlanRevisionMarkup(r.plan_revision)+
      (preview&&html?'<iframe class="community-report-preview" title="'+e(title)+'" src="'+e(html.url)+'" sandbox="" referrerpolicy="no-referrer"></iframe>':'')+
      (files.length?fileList(files):'<p class="notice">The report has no completed file tickets yet. Inspect its original operation for progress.</p>')+
      '<details class="technical"><summary>Complete retained report record</summary><pre class="json-view">'+e(JSON.stringify(r,null,2))+'</pre></details>';
    detail(title,body,{kind:'community_reports',id});
  }
  function studyTransferButton(kind,id){
    return typeof openStudyTransfer==='function'?button('study-transfer','Transfer editable study',
      'data-kind="'+e(kind)+'" data-id="'+e(id)+'" data-workspace="'+e(workspace())+'"'):'';
  }
  async function transferStudy(node){
    sync();
    const requestedWorkspace=node.dataset.workspace,kind=node.dataset.kind,id=node.dataset.id;
    const nativeKind={'community-tables':'community_tables','community-plans':'community_plans','community-reports':'community_reports','community-plan-comparisons':'community_plan_comparisons'}[kind];
    if(typeof openStudyTransfer!=='function'||!nativeKind||!/^[0-9a-f]{64}$/.test(id||''))
      throw Error('Choose a saved Community study in the current workspace.');
    if(!requestedWorkspace||requestedWorkspace!==workspace())
      throw Error('Reopen this saved Community study in its original workspace.');
    const request=++studyTransferRequest,selection=JSON.stringify(local);
    const retained=kind==='community-plan-comparisons'?
      await api(endpoint('/api/community-revisions/inspect',{id})):await get(nativeKind,id,{fresh:true});
    if(request!==studyTransferRequest||workspace()!==requestedWorkspace||JSON.stringify(local)!==selection)return;
    if(retained.id!==id||(kind==='community-plan-comparisons'&&retained.workspace_key!==requestedWorkspace))
      throw Error('The saved Community study identity changed.');
    document.getElementById('detail-dialog')?.close();
    return openStudyTransfer({workspace_key:requestedWorkspace,roots:[{kind,id}]});
  }
  async function nativeItem(buttonNode){
    return openItem(buttonNode.dataset.kind,buttonNode.dataset.id);
  }
  async function dispatch(node){
    if(node.dataset.action?.startsWith('community-revision-'))return revisions.dispatch(node);
    if(node.dataset.action?.startsWith('community-handover-'))return handover.dispatch(node);
    const action=node.dataset.action?.replace(/^community-/,'');
    if(action?.startsWith('tab-')){local.tab=action.slice(4);redraw();return;}
    if(action==='sources'){document.getElementById('detail-dialog')?.close();return sourceForm();}
    if(action==='import')return importForm();
    if(action==='table')return tableDetail(node.dataset.id||local.table);
    if(action==='group')return groupDetail(node.dataset.id,node.dataset.table);
    if(action==='compare')return compare();
    if(action==='retry'){loadError='';redraw();return;}
    if(action==='reset-filters'){local.utility='';local.watershed='';local.query='';local.sort='geoid';redraw();return;}
    if(action==='select-visible'){local.compare=unique([...local.compare,...filtered().map(g=>g.geoid)]);updateExplore();return;}
    if(action==='clear-comparison'){local.compare=[];updateExplore();return;}
    if(action==='watershed-refresh')return refreshWatershedCatalog();
    if(action==='plan-new')return planForm();
    if(action==='plan-selection')return planForm(null,{fromSelection:true});
    if(action==='plan-revise')return planForm(node.dataset.id);
    if(action==='plan-open')return planDetail(node.dataset.id);
    if(action==='report-new')return reportForm(node.dataset.id);
    if(action==='report-open')return reportDetail(node.dataset.id);
    if(action==='report-source')return reportSourceForm(node.dataset.id);
    if(action==='report-source-scientific')return openPreparedReport(node.dataset.id,{scientific:true});
    if(action==='report-source-open')return openPreparedReport(node.dataset.id);
    if(action==='report-source-edition')return openPreparedReport(node.dataset.id,{sourceOnly:true});
    if(action==='report-preview')return reportDetail(node.dataset.id,{preview:node.dataset.preview==='true'});
    if(action==='native-item')return nativeItem(node);
    if(action==='study-transfer')return transferStudy(node);
    if(action==='intervention-import-columns')return previewInterventionImport(true);
    if(action==='intervention-import-preview')return previewInterventionImport();
    if(action==='intervention-import-apply')return applyInterventionImport();
    if(action==='intervention-add'){
      ensureFormWorkspace();const target=form().querySelector('#community-interventions');
      if(!target)throw Error('Open a community plan before adding an intervention.');
      target.insertAdjacentHTML('beforeend',interventionRow(formTable));
      const added=target.lastElementChild;added.querySelector('[name="intervention_title"]')?.focus();return;
    }
    if(action==='intervention-remove'){
      ensureFormWorkspace();const row=node.closest('[data-community-intervention]');row?.remove();return;
    }
    throw Error('This community action is not available.');
  }
  function detach(){studyTransferRequest++;handover.invalidate();mountController?.abort();container=null;}
  return {render,mount,dispatch,detach,capture,validateView,restoreView,taskActions};
}
