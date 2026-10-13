/* Deterministic offline NC ambient measurement explorer. No external dependencies. */
export const GROUP_FIELDS = ["organization","station_id","characteristic","fraction","method_specification","method_id","method_context","analysis_unit","activity_type","media","media_subdivision","value_type","weight_basis","time_basis","temperature_basis","particle_size_basis"];
const STYLE = "*{box-sizing:border-box}body{margin:0;background:#f2f2f2;color:#202020;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}header,main,footer{max-width:1600px;margin:auto;padding:24px}header{border-bottom:1px solid #aaa;background:#fff}h1{font-size:26px;margin:0 0 8px}h2{font-size:19px;margin:0 0 12px}h3{font-size:16px}p{margin:8px 0}a{color:#222;text-decoration:underline;overflow-wrap:anywhere}button,input,select{font:inherit;color:inherit}button,select,input[type=search],input[type=date]{background:#fff;border:1px solid #888;border-radius:2px;padding:8px;min-height:40px}button{cursor:pointer}button:hover{background:#e9e9e9}button:disabled{cursor:default;color:#777;border-color:#bbb;background:#eee}:focus-visible{outline:3px solid #444;outline-offset:3px}section{background:#fff;border:1px solid #bbb;margin:0 0 18px;padding:18px}.filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.filters label{display:flex;flex-direction:column;gap:4px;font-size:13px}.filters input,.filters select{width:100%}.wide{grid-column:span 2}.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px}.toolbar p{margin-right:auto}.note{font-size:13px;color:#444}.notice{border-left:4px solid #555;background:#eee;padding:12px}.error{font-weight:600}.table-wrap{overflow:auto;max-height:65vh;border:1px solid #aaa}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:9px;border-bottom:1px solid #ddd;vertical-align:top;max-width:340px;overflow-wrap:anywhere}th{background:#e8e8e8;position:sticky;top:0;z-index:1;white-space:nowrap}tbody tr:nth-child(even){background:#f7f7f7}.numeric{text-align:right;font-variant-numeric:tabular-nums}td button{padding:4px 8px;min-height:32px}details{margin-top:12px}summary{cursor:pointer;font-weight:600;padding:6px 0}#columns{display:flex;flex-wrap:wrap;gap:8px 18px;padding:12px 0}#columns label{white-space:nowrap}dl{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,3fr);gap:6px 16px;margin:12px 0}dt{color:#555}dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}#source-list li{margin:10px 0;overflow-wrap:anywhere}code{font-size:12px;overflow-wrap:anywhere}dialog{width:min(1000px,94vw);max-height:90vh;overflow:auto;border:1px solid #777;padding:22px}dialog::backdrop{background:rgba(0,0,0,.45)}.dialog-bar{position:sticky;top:-22px;background:white;display:flex;gap:12px;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid #bbb;z-index:2}.dialog-bar h2{margin:0}.skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:8px;background:white;padding:8px;z-index:9}footer{font-size:13px;color:#444;padding-top:0}@media(max-width:760px){header,main,footer{padding:16px}.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.wide{grid-column:span 2}section{padding:12px}.toolbar>button{flex:1 1 180px}h1{font-size:23px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:10px}dialog{padding:14px}.dialog-bar{top:-14px;flex-wrap:wrap}}@media(max-width:420px){.filters{grid-template-columns:1fr}.wide{grid-column:auto}}@media print{header,main,footer{max-width:none;padding:8px}.filters,.toolbar,#columns,dialog,button,.skip{display:none!important}.table-wrap{max-height:none;overflow:visible}section{break-inside:avoid}th{position:static}body{background:white}}";
const MARKUP = "<section aria-labelledby=\"filter-heading\"><h2 id=\"filter-heading\">Select measurements</h2><form id=\"filters\"><div class=\"filters\">\n<label class=\"\">Station<select name=\"station\"><option value=\"\">All stations</option></select></label><label class=\"\">Parameter<select name=\"parameter\"><option value=\"\">All parameters</option></select></label><label class=\"wide\">Exact comparison group<select name=\"group\"><option value=\"\">All exact groups</option></select></label><label class=\"\">Source analysis window<select name=\"window\"><option value=\"\">All windows</option></select></label>\n<label>From date<input type=\"date\" name=\"from\"></label><label>Through date<input type=\"date\" name=\"to\"></label><label>Month<select name=\"month\"><option value=\"\">All months</option><option value=\"1\">01</option><option value=\"2\">02</option><option value=\"3\">03</option><option value=\"4\">04</option><option value=\"5\">05</option><option value=\"6\">06</option><option value=\"7\">07</option><option value=\"8\">08</option><option value=\"9\">09</option><option value=\"10\">10</option><option value=\"11\">11</option><option value=\"12\">12</option></select></label>\n<label class=\"\">Season<select name=\"season\"><option value=\"\">All seasons</option></select></label><label class=\"\">Analysis unit<select name=\"unit\"><option value=\"\">All units</option></select></label>\n<label>Censoring<select name=\"censor\"><option value=\"\">All detection conditions</option><option value=\"censored\">Censored results</option><option value=\"uncensored\">Results not marked censored</option></select></label>\n<label>Original comments<select name=\"comment\"><option value=\"\">All comment states</option><option value=\"commented\">Has a source comment</option><option value=\"uncommented\">No source comment</option></select></label>\n<label class=\"\">Detected comment code<select name=\"code\"><option value=\"\">All codes</option></select></label><label class=\"\">Result qualifier<select name=\"qualifier\"><option value=\"\">All qualifiers</option></select></label><label class=\"\">Result status<select name=\"status\"><option value=\"\">All statuses</option></select></label>\n<label class=\"wide\">Find result, activity, method or comment<input type=\"search\" name=\"query\" placeholder=\"Search the original text\"></label>\n<label>Sort by<select name=\"sort\"><option value=\"date\">Sample date and time</option><option value=\"station_id\">Station</option><option value=\"characteristic\">Parameter</option><option value=\"result_id\">Result ID</option><option value=\"numeric_value\">Original numeric value · one exact group</option></select></label>\n<label>Order<select name=\"direction\"><option value=\"asc\">Ascending</option><option value=\"desc\">Descending</option></select></label>\n</div><div class=\"toolbar\"><button type=\"submit\">Apply filters</button><button type=\"button\" id=\"reset\">Reset filters</button></div><p id=\"filter-error\" class=\"error\" role=\"alert\"></p></form>\n<details id=\"group-contract\" hidden><summary>Inspect all fields defining this exact comparison group</summary><dl id=\"group-details\"></dl></details>\n<p class=\"note\">Groups preserve station, method, media, fraction, unit and reporting basis. Censored results keep their original detection condition and limit; detected comment codes remain source labels. Dates are sampled dates, not continuous monitoring or an assessment determination.</p></section>\n<section id=\"measurement-table\" aria-labelledby=\"table-heading\" tabindex=\"-1\"><h2 id=\"table-heading\">Original observations</h2><p id=\"status\" aria-live=\"polite\"></p>\n<div class=\"toolbar\"><button id=\"export-csv\">Download all selected rows · CSV</button><button id=\"export-selection\">Download selection, filters and full rows · JSON</button><button id=\"export-all\">Download the complete observation document</button></div>\n<details><summary>Choose displayed columns</summary><div id=\"columns\"></div></details>\n<p class=\"note\">The table is paged for readability. Both selection downloads contain every matching row and all original fields, including activity, source references, comments and limits. The CSV preserves original text; nested source and limit records are JSON cells. Printing shows the current page; use the downloads for the complete selection.</p>\n<div class=\"table-wrap\" role=\"region\" aria-label=\"Scrollable measurement table\" tabindex=\"0\"><table><thead><tr id=\"column-head\"></tr></thead><tbody id=\"rows\"></tbody></table></div>\n<div class=\"toolbar\"><p id=\"page-status\" aria-live=\"polite\"></p><label>Rows per page <select id=\"page-size\"><option>50</option><option>100</option><option>250</option></select></label><button id=\"previous\">Previous</button><button id=\"next\">Next</button></div></section>";
export function createExplorerModel(document, groupFields) {
 const rows=Array.isArray(document)?document:document?.rows;
 if(!Array.isArray(rows)||rows.some(row=>!row||Array.isArray(row)||typeof row!=='object'))throw Error('The observation document must contain an array of original measurement objects.');
 const groups=new Map(),items=rows.map((row,index)=>{
  const groupKey=JSON.stringify(groupFields.map(field=>row[field]??''));
  if(!groups.has(groupKey))groups.set(groupKey,{key:groupKey,id:'G'+String(groups.size+1).padStart(3,'0'),fields:Object.fromEntries(groupFields.map(field=>[field,row[field]??''])),count:0});
  groups.get(groupKey).count++;
  const comments=[row.result_comment,row.laboratory_comment,row.activity_comment].filter(Boolean).join(' ');
  return {row,index,groupKey,commented:!!comments,search:[row.station_id,row.characteristic,row.result_id,row.activity_id,row.method_id,row.method_name,row.fraction,row.media,row.qualifier,row.status,comments,...(Array.isArray(row.quality_codes)?row.quality_codes:[])].filter(v=>v!=null).join(' ').toLowerCase()};
 });
 const distinct=field=>[...new Set(rows.flatMap(row=>Array.isArray(row[field])?row[field]:[row[field]]).filter(v=>v!=null&&v!==''))].sort((a,b)=>String(a).localeCompare(String(b),'en',{numeric:true}));
 function filter(f={}) {
  const q=String(f.query||'').trim().toLowerCase();
  const selected=items.filter(x=>{
   const r=x.row;
   return (!f.station||r.station_id===f.station)&&(!f.parameter||r.characteristic===f.parameter)&&(!f.group||x.groupKey===f.group)&&(!f.window||r.window===f.window)&&(!f.from||(r.date&&r.date>=f.from))&&(!f.to||(r.date&&r.date<=f.to))&&(!f.month||String(r.month)===f.month)&&(!f.season||r.season===f.season)&&(!f.unit||r.analysis_unit===f.unit)&&(!f.censor||(f.censor==='censored'?r.censored===true:r.censored!==true))&&(!f.comment||(f.comment==='commented'?x.commented:!x.commented))&&(!f.code||(Array.isArray(r.quality_codes)&&r.quality_codes.includes(f.code)))&&(!f.qualifier||r.qualifier===f.qualifier)&&(!f.status||r.status===f.status)&&(!q||x.search.includes(q));
  });
  selected.sort((a,b)=>{
   let n=0;const sort=f.sort||'date';
   if(sort==='numeric_value'){
    const av=a.row.numeric_value,bv=b.row.numeric_value,ao=typeof av==='number'&&Number.isFinite(av),bo=typeof bv==='number'&&Number.isFinite(bv);
    if(ao!==bo)return ao?-1:1;n=ao?av-bv:0;
   }else{
    const av=sort==='date'?[a.row.date,a.row.time].filter(Boolean).join(' '):String(a.row[sort]??'');
    const bv=sort==='date'?[b.row.date,b.row.time].filter(Boolean).join(' '):String(b.row[sort]??'');
    n=av.localeCompare(bv,'en',{numeric:true});
   }
   return (f.direction==='desc'?-n:n)||a.index-b.index;
  });return selected;
 }
 const csvFields=[...new Set(rows.flatMap(row=>Object.keys(row)))];
 function csv(selected){
  const quote=v=>'"'+String(v==null?'':typeof v==='object'?JSON.stringify(v):v).replace(/"/g,'""')+'"';
  return csvFields.map(quote).join(',')+'\r\n'+selected.map(x=>csvFields.map(field=>quote(x.row[field])).join(',')).join('\r\n')+(selected.length?'\r\n':'');
 }
 return {rows,items,groups,distinct,filter,csv,groupFields,csvFields};
}
function explorerClient(){
 'use strict';
 const payload=JSON.parse(document.getElementById('explorer-data').textContent),model=createExplorerModel(payload.document,payload.groupFields);
 const $=selector=>document.querySelector(selector),form=$('#filters'),body=$('#rows'),dialog=$('#row-dialog');
 const reviewKey=row=>JSON.stringify([row.station_id,row.result_id]);
 const reviews=new Map();for(const review of payload.sourceReview||[]){const key=reviewKey(review);if(!reviews.has(key))reviews.set(key,[]);reviews.get(key).push(review);}
 let selected=[],page=0,pageSize=50,lastOpener=null,queryTimer;
 const columns=[['date','Date',true],['time','Time',false],['time_zone','Time zone',false],['station_id','Station',true],['characteristic','Parameter',true],['original_value','Original value',true],['original_unit','Original unit',true],['analysis_unit','Analysis unit',false],['detection_condition','Detection condition',true],['qualifier','Qualifier',true],['quality_codes','Comment codes',true],['fraction','Fraction',false],['method_id','Method',true],['method_context','Method context',false],['media','Media',false],['status','Status',false],['value_type','Value type',false],['activity_id','Activity ID',false],['result_id','Result ID',true]];
 const display=v=>v==null||v===''?'—':Array.isArray(v)?v.join(', '):typeof v==='object'?JSON.stringify(v):String(v);
 const option=(v,label)=>{const node=document.createElement('option');node.value=v;node.textContent=label??String(v);return node;};
 for(const [name,field] of Object.entries({station:'station_id',parameter:'characteristic',window:'window',season:'season',unit:'analysis_unit',code:'quality_codes',qualifier:'qualifier',status:'status'}))for(const value of model.distinct(field))form.elements[name].append(option(value));
 function readFilters(){return Object.fromEntries(['station','parameter','group','window','from','to','month','season','unit','censor','comment','code','qualifier','status','query','sort','direction'].map(name=>[name,form.elements[name].value]));}
 function updateGroups(){
  const previous=form.elements.group.value,station=form.elements.station.value,param=form.elements.parameter.value;
  const groups=[...model.groups.values()].filter(g=>(!station||g.fields.station_id===station)&&(!param||g.fields.characteristic===param));
  form.elements.group.replaceChildren(option('','All exact groups'));
  for(const g of groups){const f=g.fields,label=g.id+' · '+[f.station_id,f.characteristic,f.analysis_unit||'unit absent',f.fraction||'fraction absent',f.method_id||'method absent',f.method_context||'method context absent',f.media,f.media_subdivision||'media subdivision absent',f.value_type].filter(Boolean).join(' · ')+' ('+g.count+')';form.elements.group.append(option(g.key,label));}
  form.elements.group.value=groups.some(g=>g.key===previous)?previous:'';
 }
 function save(name,text,mime){
  const url=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 function link(parent,label,href,download=false){const a=document.createElement('a');a.textContent=label;a.href=href;if(download)a.download='';if(/^https?:\/\//i.test(href)){a.target='_blank';a.rel='noopener noreferrer';}parent.append(a);return a;}
 function sourceHref(path){return payload.sources.find(source=>source.path===path)?.href||null;}
 function definition(parent,name,value){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=display(value);parent.append(dt,dd);}
 function heading(parent,label){const h=document.createElement('h3');h.textContent=label;parent.append(h);}
 function paragraph(parent,text,cls){const p=document.createElement('p');p.textContent=text;if(cls)p.className=cls;parent.append(p);return p;}
 function openRow(index,opener){
  const item=model.items[index];if(!item)return;lastOpener=opener;
  $('#row-title').textContent=item.row.result_id||'Original measurement';const root=$('#row-detail');root.replaceChildren();
  paragraph(root,[item.row.station_id,item.row.characteristic,item.row.date,item.row.time,item.row.time_zone].filter(Boolean).join(' · '));
  for(const review of reviews.get(reviewKey(item.row))||[]){heading(root,'Reported value or unit requires review');paragraph(root,review.review_reason,'notice');paragraph(root,review.interpretation);if(payload.reviewHref)link(root,'Open the complete derived source-value review table',payload.reviewHref,true);}
  if(item.row.censored)paragraph(root,'Censored result. The original value, detection condition and reporting limits remain separate. No replacement concentration is assigned.','notice');
  const fields=document.createElement('dl');
  for(const [field,value] of Object.entries(item.row)){if((field.startsWith('original_')&&field.endsWith('_source'))||field==='detection_limits')continue;definition(fields,field.replaceAll('_',' '),value);}root.append(fields);
  heading(root,'Original CSV records');const list=document.createElement('ul');
  for(const field of ['original_result_source','original_activity_source','original_station_source']){
   const source=item.row[field];if(!source)continue;const li=document.createElement('li'),href=sourceHref(source.path);li.append(document.createTextNode(field.replaceAll('_',' ')+': '));if(href)link(li,source.path,href,true);else li.append(document.createTextNode(source.path||'Source path unavailable'));li.append(document.createTextNode(' · original CSV row '+display(source.row)));list.append(li);
  }root.append(list);
  heading(root,'Original detection and quantitation limits');
  for(const limit of item.row.detection_limits||[]){const p=paragraph(root,[limit.type,limit.value,limit.unit].filter(v=>v!==''&&v!=null).join(' · '));if(limit.source){p.append(document.createTextNode(' · row '+display(limit.source.row)+' · '));const href=sourceHref(limit.source.path);if(href)link(p,limit.source.path,href,true);else p.append(document.createTextNode(limit.source.path||''));}}
  if(!(item.row.detection_limits||[]).length)paragraph(root,'No limit record was joined to this original result.');
  heading(root,'Exact comparison group');const group=document.createElement('dl');for(const field of payload.groupFields)definition(group,field.replaceAll('_',' '),item.row[field]);root.append(group);
  $('#row-json').onclick=()=>save('measurement-'+String(item.row.result_id||index).replace(/[^a-z0-9._-]/gi,'_')+'.json',JSON.stringify(item.row,null,2)+'\n','application/json');
  if(!dialog.open)dialog.showModal();$('#row-close').focus();
 }
 $('#row-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>lastOpener?.focus());
 function renderPage(){
  const count=Math.max(1,Math.ceil(selected.length/pageSize));page=Math.min(page,count-1);const visible=columns.filter(c=>c[2]),head=$('#column-head');head.replaceChildren();
  for(const [,label] of [...visible,['','Inspect']]){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}body.replaceChildren();
  for(const item of selected.slice(page*pageSize,(page+1)*pageSize)){
   const tr=document.createElement('tr');for(const [field] of visible){const td=document.createElement('td');td.textContent=display(item.row[field]);if(field==='original_value')td.className='numeric';tr.append(td);}
   const td=document.createElement('td'),button=document.createElement('button');button.type='button';button.textContent=reviews.has(reviewKey(item.row))?'Review / open':'Open';button.setAttribute('aria-label','Inspect original result '+(item.row.result_id||item.index));button.onclick=()=>openRow(item.index,button);td.append(button);tr.append(td);body.append(tr);
  }
  if(!selected.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=visible.length+1;td.textContent='No observations match these filters. Clear a filter or reset the selection.';tr.append(td);body.append(tr);}
  $('#page-status').textContent=selected.length?'Rows '+(page*pageSize+1)+'–'+Math.min((page+1)*pageSize,selected.length)+' of '+selected.length.toLocaleString()+' · page '+(page+1)+' of '+count:'0 matching rows';$('#previous').disabled=page===0;$('#next').disabled=page>=count-1;
 }
 function refresh(reset=true){
  const f=readFilters();if(f.from&&f.to&&f.from>f.to){$('#filter-error').textContent='The start date must be on or before the end date.';selected=[];$('#status').textContent='Correct the date range to see observations.';$('#export-csv').disabled=true;$('#export-selection').disabled=true;renderPage();return;}
  $('#filter-error').textContent='';form.elements.sort.querySelector('option[value="numeric_value"]').disabled=!f.group;
  if(f.sort==='numeric_value'&&!f.group){form.elements.sort.value='date';f.sort='date';}
  selected=model.filter(f);if(reset)page=0;const groups=new Set(selected.map(x=>x.groupKey)),dates=new Set(selected.map(x=>x.row.date).filter(Boolean));
  $('#status').textContent=selected.length.toLocaleString()+' of '+model.rows.length.toLocaleString()+' observations · '+groups.size+' exact groups · '+dates.size+' sample dates · '+selected.filter(x=>x.row.censored===true).length+' censored · '+selected.filter(x=>x.commented).length+' with comments · '+selected.filter(x=>reviews.has(reviewKey(x.row))).length+' with analysis review';
  const details=$('#group-details');details.replaceChildren();if(f.group)for(const field of payload.groupFields)definition(details,field.replaceAll('_',' '),model.groups.get(f.group)?.fields[field]);$('#group-contract').hidden=!f.group;
  $('#export-csv').disabled=!selected.length;$('#export-selection').disabled=!selected.length;renderPage();
 }
 for(const column of columns){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=column[2];input.onchange=()=>{column[2]=input.checked;renderPage();};label.append(input,document.createTextNode(' '+column[1]));$('#columns').append(label);}
 form.addEventListener('submit',event=>{event.preventDefault();refresh();});form.addEventListener('change',event=>{if(['station','parameter'].includes(event.target.name))updateGroups();refresh();});
 form.elements.query.addEventListener('input',()=>{clearTimeout(queryTimer);queryTimer=setTimeout(()=>refresh(),150);});
 $('#reset').onclick=()=>{clearTimeout(queryTimer);form.reset();updateGroups();refresh();};
 $('#previous').onclick=()=>{page--;renderPage();};$('#next').onclick=()=>{page++;renderPage();};$('#page-size').onchange=event=>{pageSize=Number(event.target.value);page=0;renderPage();};
 $('#export-csv').onclick=()=>{clearTimeout(queryTimer);refresh(false);if(selected.length&&!$('#export-csv').disabled)save('nc-ambient-selected-observations.csv',model.csv(selected),'text/csv;charset=utf-8');};
 $('#export-selection').onclick=()=>{clearTimeout(queryTimer);refresh(false);if(selected.length&&!$('#export-selection').disabled)save('nc-ambient-observation-selection.json',JSON.stringify({schema:'upstate.ambient-observation-selection/v1',dataset:payload.dataset,filters:readFilters(),group_fields:payload.groupFields,row_count:selected.length,analysis_reviews:selected.flatMap(x=>reviews.get(reviewKey(x.row))||[]),rows:selected.map(x=>x.row)},null,2)+'\n','application/json');};
 $('#export-all').onclick=()=>save('observations.json',JSON.stringify(payload.document,null,2)+'\n','application/json');
 const list=$('#source-list');
 for(const source of payload.sources){const li=document.createElement('li');if(source.href)link(li,source.path,source.href,true);else li.append(document.createTextNode(source.path));if(source.bytes!=null)li.append(document.createTextNode(' · '+Number(source.bytes).toLocaleString()+' bytes'));if(source.sha256){const code=document.createElement('code');code.textContent=source.sha256;li.append(document.createTextNode(' · SHA256 '),code);}if(source.url){li.append(document.createTextNode(' · '));link(li,'Original publisher request',source.url);}list.append(li);}
 if(!payload.sources.length)list.textContent='Original paths and CSV row numbers remain in each measurement. Open the complete saved source family to inspect those files.';
 updateGroups();refresh();
}
function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeHref(value){
 if(typeof value!=='string'||!value||/[\u0000-\u001f\\]/.test(value))return null;
 if(/^https?:\/\//i.test(value))return value;
 if(/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('//')||value.startsWith('/'))return null;
 if(value.split(/[?#]/)[0].split('/').some(part=>part==='..'))return null;
 return value;
}
export function buildExplorer(document,options={}){
 const model=createExplorerModel(document,GROUP_FIELDS),prefix=options.sourcePrefix??'source/nc_ambient_measurements/20261013/';
 const paths=new Map((Array.isArray(options.sources)?options.sources:[]).map(source=>[source.path,source]));
 for(const row of model.rows)for(const source of [row.original_result_source,row.original_activity_source,row.original_station_source,...(row.detection_limits||[]).map(limit=>limit.source)])if(source?.path&&!paths.has(source.path))paths.set(source.path,{path:source.path});
 const sources=[...paths.values()].map(source=>{
  const relative=typeof source.path==='string'&&source.path.startsWith(prefix)?source.path.slice(prefix.length):null;
  return {path:source.path,bytes:source.bytes??null,sha256:source.sha256||null,href:safeHref(source.href||relative),url:safeHref(source.url||source.source_url)};
 }).sort((a,b)=>String(a.path).localeCompare(String(b.path)));
 const title=options.title||'NC ambient measurement explorer',dataset={title,source_schema:document?.schema??null,sha256:options.datasetSha256||null,row_count:model.rows.length,exact_group_count:model.groups.size,source_edition:options.sourceEdition||null};
 const payload={document:Array.isArray(document)?{rows:document}:document,groupFields:GROUP_FIELDS,sources,dataset,sourceReview:Array.isArray(options.sourceReview)?options.sourceReview:[],reviewHref:safeHref(options.reviewHref)};
 const json=JSON.stringify(payload).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const script=createExplorerModel.toString()+'\n('+explorerClient.toString()+')();';
 const report=safeHref(options.reportHref||'report.html');
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHTML(title)+'</title><style>'+STYLE+'</style></head><body><a class="skip" href="#measurement-table">Skip to measurements</a><header><h1>'+escapeHTML(title)+'</h1><p>Inspect original measurements, exact comparison groups, reporting limits and source records.</p><p class="note">This saved page embeds the complete observation table. Filtering works offline. Original CSV downloads use the accompanying source files.</p></header><main>'+MARKUP+
 '<section><h2>Original sources and saved edition</h2><p class="note">CSV row references count the original header as row 1. Original publisher requests may return a newer edition; the accompanying files retain this report’s captured edition.</p><p>'+escapeHTML(options.sourceEdition||'Captured original source edition')+(options.datasetSha256?' · observation document SHA256 <code>'+escapeHTML(options.datasetSha256)+'</code>':'')+'</p><details><summary>Open the complete source file inventory</summary><ul id="source-list"></ul></details><div class="toolbar">'+(report?'<a href="'+escapeHTML(report)+'">Open the complete report</a>':'')+(payload.reviewHref?'<a href="'+escapeHTML(payload.reviewHref)+'">Derived source-value review table</a>':'')+'<a href="NATIVE_OPENING.md">Native report, export and independent reopening guide</a></div></section></main><footer>All values and qualifications belong to the captured source records. No censored-value substitution, temperature conversion, duplicate removal or new regulatory classification is performed by this explorer.</footer><dialog id="row-dialog" aria-labelledby="row-title"><div class="dialog-bar"><h2 id="row-title"></h2><button id="row-close" type="button">Close</button></div><div id="row-detail"></div><button id="row-json" type="button">Download this complete original joined record</button></dialog><script type="application/json" id="explorer-data">'+json+'</script><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script></body></html>\n';
}

export function renderExplorer(built,options={}){
 const prefix=options.sourcePrefix??'source/nc_ambient_measurements/20261013/';
 const original=built?.files?.[prefix+'observations.json'];
 const document=typeof original==='string'?JSON.parse(original):(built?.observations||built);
 return buildExplorer(document,{sources:built?.sourceInventory||[],sourceReview:built?.sourceReview||[],reviewHref:built?.files?.[prefix+'source-value-review.csv']?'source-value-review.csv':null,...options});
}
