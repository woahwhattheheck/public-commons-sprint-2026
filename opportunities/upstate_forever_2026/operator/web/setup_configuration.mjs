/** Readable original scientific configuration. Copyright TokenJunkieLabs. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arr=value=>Array.isArray(value)?value:[];
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const canonical=value=>value===undefined?'undefined':value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
export const configurationValue=value=>value===null||value===undefined?'Not recorded':value===''?'(blank)':typeof value==='object'?JSON.stringify(value):String(value);
const v=value=>esc(configurationValue(value));
const human=value=>String(value??'').replace(/_/g,' ');
const table=(headings,rows)=>'<div class="setup-config-table" tabindex="0"><table><thead><tr>'+headings.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const control=(action,label,attrs='')=>'<button type="button" data-setup-config-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';
function reference(url){try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))return v(url);return '<a href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">'+esc(u.href)+'</a>';}catch(_){return v(url);}}
export function retainedFields(value){
 const rows=[];
 const visit=(item,path)=>{
  if(item&&typeof item==='object'){
   const entries=Array.isArray(item)?item.map((child,index)=>[String(index+1),child]):Object.entries(item);
   if(!entries.length)rows.push([esc(path),'No entries']);
   for(const [key,child] of entries)visit(child,(path?path+' / ':'')+human(key));
  }else rows.push([esc(path),v(item)]);
 };visit(value,'');
 return table(['Original field','Retained value'],rows);
}
function pageRows(rows,page=0,size=40){
 const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.max(0,Math.min(pages-1,Number.isInteger(page)?page:0));
 return {rows:rows.slice(current*size,(current+1)*size),page:current,pages,total:rows.length,start:rows.length?current*size+1:0,end:Math.min(rows.length,(current+1)*size)};
}
function paging(page,scope,id=''){
 const attrs='data-config-scope="'+esc(scope)+'" data-config-id="'+esc(id)+'" ';
 return '<div class="setup-config-pages"><span>Rows '+page.start+'–'+page.end+' of '+page.total+'</span>'+
 control('page','Previous',attrs+'data-config-page="'+(page.page-1)+'"'+(page.page===0?' disabled':''))+
 control('page','Next',attrs+'data-config-page="'+(page.page+1)+'"'+(page.page+1>=page.pages?' disabled':''))+'</div>';
}
export function configurationRows(configuration,{query='',page=0}={}){
 const source=configuration?.table;
 if(!source)return {columns:[],rows:[],page:0,pages:1,total:0,start:0,end:0};
 const needle=String(query).trim().toLocaleLowerCase();
 const rows=arr(source.rows).filter(row=>!needle||source.columns.some(name=>String(row[name]??'').toLocaleLowerCase().includes(needle)));
 return {columns:source.columns,...pageRows(rows,page)};
}
export function renderConfigurationTable(configuration,options={}){
 const source=configuration?.table;if(!source)return '';
 const page=configurationRows(configuration,options),labels=new Map(arr(source.column_descriptions).map(row=>[row.name,row]));
 return '<p class="note">All '+source.rows.length+' original rows and '+source.columns.length+' columns remain in this setup. Search filters only this view.</p>'+
 paging(page,'coefficients')+
 table(source.columns.map(name=>{const r=labels.get(name);return (r?.label||name)+(r?.units?' ('+r.units+')':'');}),page.rows.map(row=>source.columns.map(name=>v(row[name]))))+
 (page.total?'':'<p>No coefficient rows match. Clear the search to view the original table.</p>');
}
export function renderConfiguration(configuration,{editable=false,query='',page=0}={}){
 if(!configuration)return '<p>This saved setup predates the readable configuration sheet. Its original profile/table remain retained. Open its selections and preview a new setup to capture the current sheet.</p>';
 const source=configuration.table;
 return '<div class="setup-configuration" data-config-profile="'+esc(configuration.profile_id)+'">'+
 '<h3>'+esc(configuration.title)+'</h3><p>'+esc(configuration.interpretation)+'</p>'+
 (editable?control('edit-profile','Open this profile for revision','data-config-profile="'+esc(configuration.profile_id)+'"')+'<p class="note">The original Profile Workbench saves a separate revision. Return to Scientific setup, refresh saved inputs, choose that revision and preview before retaining a new setup.</p>':'')+
 table(['Native parameter','Saved choice','Units','Used by selected grid','Meaning / method'],
 arr(configuration.parameters).map(row=>[esc(row.label),v(row.value),v(row.units),esc(row.model.toUpperCase())+(row.selected_for_grid?' · selected':' · profile only'),esc(row.description||'Original saved parameter')+'<details><summary>Native name and reference</summary><p>'+esc(row.target)+'</p>'+reference(row.reference)+'</details>']))+
 '<h3>Original coefficient table</h3><p>'+esc(source.source?.title||source.source_id)+' · '+v(source.source?.vintage)+'</p>'+
 '<p class="note">Read each nutrient coefficient with its application-rate or measured-runoff column. These input choices are not computed stream loads or concentrations.</p>'+
 '<label><span>Find original coefficient rows</span><input type="search" data-setup-config-search value="'+esc(query)+'" placeholder="Land-cover code, original name or cell value"></label>'+
 '<div data-config-coefficients>'+renderConfigurationTable(configuration,{query,page})+'</div>'+
 '<details><summary>Column names, units and original methods</summary>'+table(['Original column','Meaning','Units','Original method'],arr(source.column_descriptions).map(row=>[esc(row.name),esc(row.description||row.kind),v(row.units),reference(row.reference)]))+'</details>'+
 '<details><summary>Complete original source, model period and citations</summary>'+retainedFields({source:source.source,model_period:configuration.model_period,references:configuration.references})+'</details></div>';
}
function indexedRows(configuration){
 const rows=new Map();for(const row of arr(configuration?.table?.rows)){const key=String(row.lucode);if(rows.has(key))throw Error('The original coefficient table repeats a land-cover code.');rows.set(key,row);}return rows;
}
export function compareConfigurations(before,after){
 if(!before||!after)return {available:false,changes:[],reason:'The earlier retained setup has no captured configuration sheet. Its original profile/table remain available; no unchanged-value conclusion has been made.'};
 const changes=[],add=(kind,key,label,a,b,units=null)=>{if(canonical(a)!==canonical(b))changes.push({kind,key,label,before:a,after:b,units});};
 const left=new Map(arr(before.parameters).map(row=>[row.target,row])),right=new Map(arr(after.parameters).map(row=>[row.target,row]));
 for(const key of new Set([...left.keys(),...right.keys()])){const a=left.get(key),b=right.get(key);add('parameter',key,b?.label||a?.label,a?.value,b?.value,b?.units||a?.units);add('model-selection',key,'Grid uses '+key,a?.selected_for_grid,b?.selected_for_grid);add('method',key+':units','Units for '+key,a?.units,b?.units);add('method',key+':reference','Method reference for '+key,a?.reference,b?.reference);}
 add('model-selection','grid-models','Selected grid models',before.selected_models,after.selected_models);
 add('model-selection','profile-models','Saved profile models',before.profile_models,after.profile_models);
 const arows=indexedRows(before),brows=indexedRows(after),labels=new Map(arr(after.table.column_descriptions).map(row=>[row.name,row]));
 for(const code of new Set([...arows.keys(),...brows.keys()])){const a=arows.get(code),b=brows.get(code);
  for(const name of new Set([...before.table.columns,...after.table.columns])){const meta=labels.get(name);add('coefficient',code+':'+name,'Land cover '+code+' · '+(meta?.label||name),own(a,name)?a[name]:undefined,own(b,name)?b[name]:undefined,meta?.units);}
 }
 add('source','source-collection','Original coefficient collection',before.table.source_collection_id,after.table.source_collection_id);
 add('source','source-id','Original coefficient source',before.table.source_id,after.table.source_id);
 add('source','source-sha','Original coefficient bytes',before.table.sha256,after.table.sha256);
 add('period','period','Model period',before.model_period,after.model_period);
 add('references','references','Original profile citations',before.references,after.references);
 return {available:true,before_profile_id:before.profile_id,after_profile_id:after.profile_id,changes,
  numerical_changes:changes.filter(row=>row.kind==='parameter'||row.kind==='coefficient').length};
}
export function renderConfigurationComparison(before,after){
 const result=compareConfigurations(before,after);
 if(!result.available)return '<p>'+esc(result.reason)+'</p>';
 return '<h3>Compared with the opened saved setup</h3><p>'+esc(before.title)+' → '+esc(after.title)+'. '+result.numerical_changes+' parameter/coefficient cell differences; '+result.changes.length+' total recorded differences.</p>'+
 '<p class="note">Values are shown exactly. A changed load basis changes interpretation; this view does not turn unlike bases into a percentage effect or accept a scientific choice.</p>'+
 (result.changes.length?'<details><summary>Every changed choice and source</summary>'+table(['Choice','Earlier setup','Current selection','Units'],result.changes.map(row=>[esc(row.label),v(row.before),v(row.after),v(row.units)]))+'</details>':'<p>The captured settings, original coefficient cells, source identities, model period and citations match.</p>');
}
export function renderObservationRows(record,{query='',page=0}={}){
 if(!Array.isArray(record.support_rows))return '<p>Open the original observation record for all measurement rows and support.</p>';
 const needle=String(query).trim().toLocaleLowerCase();
 const rows=record.support_rows.filter(row=>!needle||Object.values(row).some(value=>configurationValue(value).toLocaleLowerCase().includes(needle)));
 const result=pageRows(rows,page);
 return paging(result,'observations',record.id)+table(['Record / station','Original parameter / species','Original quantity','Period','Physical support','Comparison role'],
 result.rows.map(row=>[
 v(row.id)+'<br>'+v(row.station_id)+'<details><summary>Complete retained measurement fields</summary>'+retainedFields(row)+'</details>',
 v(row.original_parameter||row.parameter)+'<br>'+v(row.species),
 v(row.value_text)+' '+v(row.unit)+(row.qualifier?' · '+v(row.qualifier):''),
 v(row.period_start)+' — '+v(row.period_end),v(row.measurement_support),
 (row.admitted===true?'Eligible annual-load input':'Context')+
 (arr(row.issues).length?'<p>'+arr(row.issues).map(esc).join('; ')+'</p>':'')]));
}
export function renderObservations(observations){
 return '<p>Measurements, source assumptions and completed model outputs remain separate. Original species, fractions, units, qualifiers and support remain visible. Eligibility for an annual-load comparison does not establish scientific acceptance.</p>'+
 (arr(observations).length?observations.map(row=>'<article data-config-observation="'+esc(row.id)+'"><h3>'+esc(row.metadata?.title||row.id)+'</h3><p>'+row.row_count+' original rows · '+row.admitted_count+' eligible annual-load rows · '+row.context_count+' context rows.</p>'+
 '<details><summary>Original metadata, column mapping and support</summary>'+retainedFields(row.metadata)+'</details>'+
 '<label><span>Find original measurement rows</span><input type="search" data-setup-observation-search="'+esc(row.id)+'" placeholder="Station, species, period, qualifier or quantity"></label>'+
 '<div data-config-observation-rows>'+renderObservationRows(row)+'</div></article>').join(''):'<p>No observation editions selected.</p>');
}
