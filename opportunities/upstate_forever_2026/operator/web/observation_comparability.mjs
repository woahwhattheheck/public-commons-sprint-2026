/** Original-cohort comparisons through the maintained Workspace/task/source APIs. */
const list=value=>Array.isArray(value)?value:[];
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=value=>JSON.stringify(value,(_name,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item);
const validId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const originalFields=['station','project','characteristic','unit','fraction','speciation','method','method_context','value_type'];
const interval=value=>value?.text??'Not compared';
const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
const table=(heads,rows)=>'<div class="oc-scroll"><table><thead><tr>'+heads.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
const button=(id,label,extra='')=>'<button type="button" data-oc-action="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';
const seriesLabel=value=>originalFields.map(name=>name+': '+(value[name]||'(empty)')).join(' · ');
const csv=rows=>{
  if(!rows.length)return '';
  const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  const value=x=>'"'+String(x!==null&&typeof x==='object'?JSON.stringify(x):x??'').replace(/"/g,'""')+'"';
  return [columns,...rows.map(row=>columns.map(name=>row[name]))].map(row=>row.map(value).join(',')).join('\r\n')+'\r\n';
};

export function renderComparablePeriods(data,{yearA,yearB,station='',series='',tab='comparison',query='',page=0}={}){
  const matching=item=>(!station||item.station===station)&&(!series||item.series_id===series||item.id===series);
  const seriesRows=list(data.series).filter(matching),ids=new Set(seriesRows.map(x=>x.id));
  const labels=data.presentation?.series_labels||Object.fromEntries(list(data.series).map((x,i)=>[x.id,'S'+String(i+1).padStart(3,'0')]));
  const detail='<details><summary>Complete analytical identities</summary>'+table(originalFields.map(x=>x.replaceAll('_',' ')),
    seriesRows.map(row=>'<tr>'+originalFields.map(field=>'<td class="oc-raw">'+esc(row[field])+'</td>').join('')+'</tr>').join(''))+'</details>';
  let content='',exportRows=[];
  if(tab==='calendar'){
    exportRows=list(data.month_cells).filter(row=>ids.has(row.series_id)&&[yearA,yearB].includes(row.year));
    content=table(['Series','Year','Month','Activities','Original rows','Admitted activities','Complete retained-source support','Activity mean','Censored activities'],
      exportRows.map(row=>'<tr><td title="'+esc(seriesLabel(row))+'">'+esc(labels[row.series_id])+'</td><td>'+esc(row.year)+'</td><td>'+esc(row.month)+'</td><td>'+esc(row.activities)+'</td><td>'+esc(row.original_rows)+'</td><td>'+esc(row.admitted_activities)+'</td><td>'+esc(row.complete_source_support?'Complete':'Incomplete')+'</td><td>'+esc(interval(row.mean))+'</td><td>'+esc(row.censored_activities)+'</td></tr>').join(''));
  }else if(tab==='originals'){
    const needle=query.trim().toLowerCase(),allowed=new Set(seriesRows.map(row=>key(originalFields.map(field=>row[field]))));
    exportRows=list(data.original_rows).filter(row=>allowed.has(key(originalFields.map(field=>row[field])))&&(!needle||Object.values(row).some(value=>String(value).toLowerCase().includes(needle))));
    const totalPages=Math.max(1,Math.ceil(exportRows.length/50)),shownPage=Math.min(Math.max(0,page),totalPages-1);
    const columns=['result_id','activity','date',...originalFields,'reported_value','reported_unit','condition','limit_types','limit_values','lower','upper','lower_open','upper_open','censoring','analysis_eligible','quality_flag'];
    content='<p>'+esc(exportRows.length)+' complete original rows · page '+(shownPage+1)+' of '+totalPages+'. Download includes every matched row and every original field.</p>'+
      table(columns,exportRows.slice(shownPage*50,(shownPage+1)*50).map(row=>'<tr>'+columns.map(field=>'<td class="oc-raw">'+esc(row[field])+'</td>').join('')+'</tr>').join(''))+
      '<div class="oc-toolbar">'+button('previous','Previous page',shownPage===0?'disabled':'')+button('next','Next page',shownPage+1===totalPages?'disabled':'')+'</div>';
  }else{
    exportRows=list(data.comparisons).filter(row=>ids.has(row.series_id)&&row.year_a===yearA&&row.year_b===yearB);
    content=table(['Series / original characteristic','Station / project','Unit / method','Shared complete months',String(yearA)+' activity count',String(yearB)+' activity count',String(yearA)+' matched mean',String(yearB)+' matched mean','Later − earlier','Original support'],
      exportRows.map(row=>'<tr><th scope="row" title="'+esc(seriesLabel(row))+'">'+esc(labels[row.series_id]+' · '+row.characteristic)+'</th><td>'+esc(row.station+' / '+row.project)+'</td><td>'+esc(row.unit+' / '+row.method)+'</td><td>'+esc(row.common_months.join(', ')||'None')+'</td><td>'+esc(row.activities_a)+'</td><td>'+esc(row.activities_b)+'</td><td>'+esc(interval(row.matched_mean_a))+'</td><td>'+esc(interval(row.matched_mean_b))+'</td><td>'+esc(interval(row.change))+'<br>'+esc(row.direction)+'</td><td>'+button('series','Inspect exact series','data-series="'+esc(row.series_id)+'"')+'</td></tr>').join(''));
  }
  if(!exportRows.length)content='<p class="oc-empty">No original rows match this view. Choose another retained year pair or clear the station/series filter.</p>';
  return {html:detail+content,rows:exportRows};
}

export function attachObservationComparability(host){
  const {getState,api,endpoint,toast,openForm,submitAction,openScientificReport,openDesk}=host;
  let root=null,workspace='',epoch=0,contentRead=0,catalogRead=0,events=null,catalog=null,loaded=null,opened=null,renderedRows=[];
  const contexts=new Map();
  const current=()=>getState()?.workspace_key||'';
  const storageKey=w=>'upstate.observation-comparability:'+w;
  const context=w=>{
    if(!contexts.has(w)){
      let saved={};try{saved=JSON.parse(globalThis.localStorage?.getItem(storageKey(w))||'{}');}catch{}
      contexts.set(w,{source:'',yearA:null,yearB:null,title:'',station:'',series:'',tab:'comparison',query:'',page:0,lastOpened:'',lastTask:'',...saved,edit:0,titleEdit:0,yearEdit:0,observedTasks:new Set()});
    }
    return contexts.get(w);
  };
  const persist=w=>{const {observedTasks,edit,titleEdit,yearEdit,...saved}=context(w);try{globalThis.localStorage?.setItem(storageKey(w),JSON.stringify(saved));}catch{}};
  const find=selector=>root?.querySelector(selector);
  const field=name=>find('[name="'+name+'"]');
  const alive=(w,g)=>root&&workspace===w&&current()===w&&epoch===g;
  function note(message,error=false){const node=find('[data-oc-status]');if(node){node.textContent=message;node.classList.toggle('oc-error',!!error);}}
  function controls(){
    return '<section class="oc-desk"><h2>Comparable observation periods</h2><p>Choose an original retained cohort, compare the same fully supported calendar months and save the complete source for Scientific Reports.</p>'+
      '<div class="oc-panel"><div class="oc-toolbar"><label>Original cohort<select name="source"><option value="">Choose an original source</option></select></label>'+button('load','Open original source')+button('refresh','Refresh')+'</div>'+
      '<div class="oc-toolbar"><label>Earlier year<select name="yearA"></select></label><label>Later year<select name="yearB"></select></label><label class="oc-grow">Saved report title<input name="title" type="text" maxlength="300"></label>'+button('save','Save complete comparison','disabled')+'</div></div>'+
      '<div class="oc-panel oc-toolbar"><label>Saved comparison<select name="edition"><option value="">Choose a saved edition</option></select></label>'+button('open','Open saved comparison')+'</div>'+
      '<p data-oc-status role="status" aria-live="polite">Loading original source catalogue…</p><div data-oc-summary></div>'+
      '<div data-oc-view hidden><div class="oc-toolbar"><label>Station<select name="station"></select></label><label class="oc-grow">Exact analytical series<select name="series"></select></label><label>View<select name="tab"><option value="comparison">Matched periods</option><option value="calendar">Monthly source support</option><option value="originals">Original measurements</option></select></label></div>'+
      '<div class="oc-toolbar"><label class="oc-grow">Find original values or identifiers<input name="query" type="search" placeholder="Original result, activity, method, value…"></label>'+button('csv','Download this full view as CSV')+button('compose','Open this report only','disabled')+button('append','Add to current report','disabled')+'</div>'+
      '<p class="oc-method">Later year minus earlier year. Every agreeing analytical activity has one weight within its month; each shared complete month has one weight. Complete support means complete among retained source measurements, not continuous calendar coverage. Original reporting-limit bounds remain bounds.</p>'+
      '<div data-oc-downloads class="oc-downloads"></div><div data-oc-result></div></div></section>';
  }
  function savedFigures(data,c){
    if(!opened)return '';
    const allowed=new Set(list(data.series).filter(row=>(!c.station||row.station===c.station)&&(!c.series||row.id===c.series)).map(row=>row.id));
    const figures=list(opened._figures).filter(row=>allowed.has(row.series_id));
    if(!figures.length)return '';
    return '<details class="oc-native-figures"><summary>Saved paired-period interval figures ('+figures.length+')</summary>'+
      '<p>Each panel uses one original analytical series and its own scale. Filled and open endpoints preserve included and excluded bounds. An arrow has no finite endpoint. The original tables retain all exact values and support.</p>'+
      figures.map(row=>{
        if(typeof row.url!=='string'||!/^\/api\/file\//.test(row.url))throw Error('An original figure ticket is missing.');
        return '<figure><h3>'+esc(row.title)+'</h3><div class="oc-scroll" tabindex="0" role="region" aria-label="'+esc(row.title)+'"><img loading="lazy" src="'+esc(row.url)+'" alt="'+esc(row.caption)+'"></div>'+
          '<figcaption>'+esc(row.caption)+'</figcaption><p><a href="'+esc(row.url+(row.url.includes('?')?'&':'?')+'download=1')+'">Download original SVG</a></p></figure>';
      }).join('')+'</details>';
  }
  function sourceContext(){
    const value=opened?.source_origin||loaded?.source_origin;
    if(!value)return '';
    const native=value.native_origin,foreign=value.relationship==='external_project';
    return (foreign?'<p>'+(opened?'This local comparison uses an original cohort received from another project.':'Saving retains a comparison in this Workspace with your selected years. The received report and original cohort remain unchanged.')+'</p>':'')+
      '<details><summary>Original cohort source</summary><dl>'+
      '<dt>Source title</dt><dd class="oc-raw">'+esc(value.title)+'</dd>'+
      '<dt>Source collection</dt><dd class="oc-raw"><code>'+esc(value.source.source_collection_id)+'</code></dd>'+
      '<dt>Source</dt><dd class="oc-raw">'+esc(value.source.source_id)+'</dd>'+
      '<dt>Original recipe SHA256</dt><dd class="oc-raw"><code>'+esc(value.source.source_sha256)+'</code></dd>'+
      (native?'<dt>Original project</dt><dd class="oc-raw">'+esc(native.project_id)+'</dd><dt>Original saved comparison</dt><dd class="oc-raw"><code>'+esc(native.selection_id)+'</code></dd>':'')+
      '</dl></details>';
  }
  function display(){
    const data=opened?.data||loaded?.data;if(!data)return;
    const c=context(workspace),stations=[...new Set(list(data.series).map(row=>row.station))].sort();
    if(!stations.includes(c.station))c.station='';
    if(!list(data.series).some(row=>row.id===c.series&&(!c.station||row.station===c.station)))c.series='';
    field('station').innerHTML=option('','All retained stations',c.station)+stations.map(value=>option(value,value,c.station)).join('');
    field('series').innerHTML=option('','All exact analytical series',c.series)+list(data.series).filter(row=>!c.station||row.station===c.station).map(row=>option(row.id,seriesLabel(row),c.series)).join('');
    field('tab').value=['comparison','calendar','originals'].includes(c.tab)?c.tab:'comparison';c.tab=field('tab').value;
    field('query').value=c.query;field('query').disabled=c.tab!=='originals';
    const title=opened?.edition.title||c.title||loaded?.presentation?.title||'Original observation cohort';
    const counts=data.counts;
    find('[data-oc-summary]').innerHTML='<h3>'+esc(title)+'</h3><p>'+esc(data.period.start+' through '+data.period.end)+' · '+esc(counts.original_result_ids)+' original result IDs · '+esc(counts.activities)+' activities · '+esc(counts.analytical_series)+' exact analytical series.</p>'+
      (opened?'<p>Saved original edition '+esc(opened.edition.id.slice(0,16))+'. Full originals and the report source are retained in this Workspace.</p>':'<p>Original source opened. Save this selection to retain its report source, full offline desk and portable source package.</p>')+sourceContext();
    find('[data-oc-view]').hidden=false;
    const result=renderComparablePeriods(data,{yearA:c.yearA,yearB:c.yearB,station:c.station,series:c.series,tab:c.tab,query:c.query,page:c.page});
    renderedRows=result.rows;find('[data-oc-result]').innerHTML=result.html+savedFigures(data,c);
    find('[data-oc-action="compose"]').disabled=!opened;
    find('[data-oc-action="append"]').disabled=!opened;
    find('[data-oc-downloads]').innerHTML=list(opened?._downloads).map(row=>{
      if(typeof row.url!=='string'||!/^\/api\/file\//.test(row.url))throw Error('An original download ticket is missing.');
      return '<a href="'+esc(row.url+(row.url.includes('?')?'&':'?')+'download=1')+'">'+esc(row.label||row.filename)+'</a>';
    }).join('');
    find('[data-oc-action="save"]').disabled=!loaded||!(Number.isInteger(c.yearA)&&Number.isInteger(c.yearB)&&c.yearA<c.yearB);
  }
  function years(data,defaults,retain=false){
    const c=context(workspace),values=list(data.years);
    if(!retain||!values.includes(c.yearA)||!values.includes(c.yearB)||c.yearA>=c.yearB){c.yearA=defaults.year_a;c.yearB=defaults.year_b;}
    field('yearA').innerHTML=values.map(value=>option(String(value),String(value),String(c.yearA))).join('');
    field('yearB').innerHTML=values.map(value=>option(String(value),String(value),String(c.yearB))).join('');
    if(c.yearA===null)field('yearA').value='';
  }
  async function refresh(){
    const w=workspace,g=epoch,ticket=++catalogRead,c=context(w),sourceIntent=contentRead,edit=c.edit;
    const result=await api(endpoint('/api/observation-comparability/catalog',{workspace:w}));
    if(!alive(w,g)||ticket!==catalogRead)return;
    catalog=result;
    if(!list(catalog.sources).some(row=>key(row.choice)===c.source)){
      if(sourceIntent===contentRead&&edit===c.edit)c.source='';
      else if(c.source){
        // This catalogue predates a newer exact source/edition selection.
        // Retain that selection; native inputs still verifies its full bytes.
        catalog={...catalog,sources:[...list(catalog.sources),{
          choice:JSON.parse(c.source),title:loaded?.presentation?.title||'Current original cohort',
          vintage:'Selected source',
        }]};
      }
    }
    field('source').innerHTML=option('','Choose an original source',c.source)+list(catalog.sources).map(row=>option(key(row.choice),row.title+' · '+row.vintage,c.source)).join('');
    field('edition').innerHTML=option('','Choose a saved comparison',c.lastOpened)+list(catalog.selections).map(row=>option(row.id,row.title+' · '+row.selection.year_a+' → '+row.selection.year_b,c.lastOpened)).join('');
    persist(w);
    if(!catalog.sources.length)note('No comparable-period cohort is retained here. Import its complete model-sources.json through Sources, or receive the original application index and publisher responses.');
  }
  async function loadSource({retain=false,source=null}={}){
    const w=workspace,g=epoch,c=context(w),ticket=++contentRead,chosen=c.source,titleEdit=c.titleEdit,yearEdit=c.yearEdit;
    const row=source?{choice:source}:list(catalog?.sources).find(item=>key(item.choice)===chosen);
    if(!row||key(row.choice)!==chosen)throw Error('Choose one retained original cohort.');
    loaded=null;opened=null;renderedRows=[];find('[data-oc-view]').hidden=true;find('[data-oc-summary]').textContent='';
    find('[data-oc-action="save"]').disabled=true;note('Reading the original index, complete publisher responses and source selectors…');
    const result=await api(endpoint('/api/observation-comparability/inputs',{workspace:w}),{method:'POST',body:{source:clone(row.choice)}});
    if(!alive(w,g)||ticket!==contentRead||c.source!==chosen)return;
    if(key(result.source)!==chosen)throw Error('The returned cohort does not match the selected original source.');
    loaded=result;
    if(c.titleEdit===titleEdit&&!retain)c.title=result.presentation.title;
    years(result.data,result.defaults,retain||c.yearEdit!==yearEdit);
    field('title').value=c.title;persist(w);display();
    note('Original cohort and source identities verified. Choose the original year pair and save its complete comparison.');
  }
  function selection(){
    const c=context(workspace);
    if(!loaded||key(loaded.source)!==c.source)throw Error('Open the current original source before saving.');
    return {source:clone(loaded.source),year_a:c.yearA,year_b:c.yearB,title:c.title,
            binding_sha256:loaded.binding_sha256,producers:clone(loaded.producers)};
  }
  function save(){
    const w=workspace,g=epoch,c=context(w),frozen=selection(),edit=c.edit;
    if(!Number.isInteger(frozen.year_a)||!Number.isInteger(frozen.year_b)||frozen.year_a>=frozen.year_b)throw Error('Choose an earlier and later year from this original cohort.');
    if(!frozen.title.trim())throw Error('Enter a title for the saved comparison.');
    openForm('Save comparable observation periods','Retain complete original inputs, all comparisons, the offline desk and the native scientific-report source.',
      '<p>'+esc(frozen.year_a+' → '+frozen.year_b)+' · '+esc(loaded.data.counts.original_result_ids)+' original result IDs. Source fields and reporting-limit intervals remain unchanged.</p><pre>'+esc(JSON.stringify(frozen,null,2))+'</pre>',
      'Save complete comparison',async()=>{
        if(!alive(w,g)||c.edit!==edit||key(selection())!==key(frozen))throw Error('The comparison changed while this form was open. Review its current selection.');
        const result=await submitAction('observation.comparability.save',clone(frozen));
        if(result?.id){context(w).lastTask=result.id;persist(w);}
        return result;
      });
  }
  async function openSource(payload){
    const w=current(),source=payload?.source;
    if(!w||payload?.workspace_key!==w)throw Error('Reopen the received cohort in its selected Workspace.');
    if(source?.kind!=='retained'||!validId(source.source_collection_id)||!validId(source.source_sha256)||
       typeof source.source_id!=='string'||!source.source_id||
       key(Object.keys(source).sort())!==key(['kind','source_collection_id','source_id','source_sha256']))
      throw Error('Choose the received cohort’s complete original source identity.');
    if(!root||workspace!==w)return openDesk('observation-comparability','openSource',clone(payload));
    const c=context(w),choice=clone(source);c.edit++;c.source=key(choice);c.lastOpened='';c.page=0;
    // A just-received source can precede the mounted catalogue. Native inputs
    // verifies its complete original inventory before enabling Save.
    if(!list(catalog?.sources).some(row=>key(row.choice)===c.source))
      field('source').innerHTML+=option(c.source,'Received original cohort',c.source);
    field('source').value=c.source;field('edition').value='';persist(w);
    return loadSource({source:choice});
  }
  async function openSaved(id){
    if(!validId(id))throw Error('Choose a complete saved comparison.');
    const w=current();if(!root||workspace!==w)return openDesk('observation-comparability','openSaved',id);
    const g=epoch,ticket=++contentRead,edit=context(w).edit;note('Opening the exact retained comparison and complete original downloads…');
    const result=await api(endpoint('/api/observation-comparability/edition',{workspace:w,id}));
    if(!alive(w,g)||ticket!==contentRead)return;
    if(context(w).edit!==edit){note('Your current draft changed while the saved result was opening. Reopen that edition when ready.');return;}
    if(result.edition?.id!==id||result.edition.project_id!==getState()?.data?.project?.id)throw Error('The saved comparison belongs to another original Workspace.');
    opened=result;
    const c=context(w),s=result.edition.selection;c.edit++;c.source=key(s.source);c.yearA=s.year_a;c.yearB=s.year_b;c.title=s.title;c.lastOpened=id;
    loaded={source:clone(s.source),binding:clone(result.edition.identity.binding),
      binding_sha256:s.binding_sha256,producers:clone(s.producers),data:result.data,
      defaults:result.data.default_comparison,presentation:result.data.presentation,
      source_origin:result.source_origin};
    years(result.data,result.data.default_comparison,true);field('title').value=c.title;
    if(list(catalog?.sources).some(row=>key(row.choice)===c.source))field('source').value=c.source;
    field('edition').value=id;persist(w);display();
    note('Complete saved comparison reopened. Download the full source ZIP for its offline desk and original source links.');
  }
  function changed(event){
    const name=event.target.name,c=context(workspace);
    if(name==='source'){
      c.source=event.target.value;c.edit++;c.lastOpened='';c.page=0;persist(workspace);
      if(!c.source){++contentRead;loaded=null;opened=null;find('[data-oc-view]').hidden=true;find('[data-oc-action="save"]').disabled=true;return;}
      const w=workspace,g=epoch;loadSource().catch(error=>{if(alive(w,g))note(error.message,true);});return;
    }
    if(name==='edition')return;
    if(['yearA','yearB','title'].includes(name)){
      c[name]=name==='title'?event.target.value:Number(event.target.value);c.edit++;
      if(name==='title')c.titleEdit++;else c.yearEdit++;
      opened=null;c.lastOpened='';
    }else if(['station','series','tab','query'].includes(name)){c[name]=event.target.value;c.page=0;}
    else return;
    persist(workspace);display();
  }
  function download(){
    if(!renderedRows.length)throw Error('No original rows match this view.');
    const c=context(workspace),url=URL.createObjectURL(new Blob([csv(renderedRows)],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='original-comparison-'+c.tab+'-'+c.yearA+'-'+c.yearB+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function click(name,node){
    if(name==='refresh')return refresh();
    if(name==='load')return loadSource();
    if(name==='save')return save();
    if(name==='open')return openSaved(field('edition').value);
    if(name==='compose'||name==='append'){
      if(!opened)throw Error('Open a saved comparison before creating its scientific report.');
      return openScientificReport({workspace_key:workspace,sources:[clone(opened.edition.source)],title:opened.edition.title,
        selection_mode:name==='compose'?'replace':'append'});
    }
    if(name==='csv')return download();
    const c=context(workspace);
    if(name==='series'){c.series=node.dataset.series;c.tab='calendar';c.page=0;}
    else if(name==='previous')c.page=Math.max(0,c.page-1);
    else if(name==='next')c.page++;
    else throw Error('Choose an original comparison action.');
    persist(workspace);display();
  }
  function taskActions(task){
    if(task?.workspace===current()&&task.action==='observation.comparability.save'&&task.state==='complete'&&validId(task.result?.id))
      return '<button type="button" data-action="observation-comparability-open" data-id="'+esc(task.result.id)+'">Open comparable observation periods</button>';
    return '';
  }
  function dispatch(node){
    if(node?.dataset?.action==='observation-comparability-open')return openSaved(node.dataset.id);
    return false;
  }
  function detach(){++epoch;++contentRead;++catalogRead;events?.abort();events=null;root=null;workspace='';loaded=null;opened=null;catalog=null;renderedRows=[];}
  async function mount(container){
    if(root===container&&workspace===current())return update();
    detach();root=container;workspace=current();const w=workspace,g=epoch,c=context(w);root.innerHTML=controls();events=new AbortController();
    root.addEventListener('change',event=>{if(!['title','query'].includes(event.target.name))changed(event);},{signal:events.signal});
    root.addEventListener('input',event=>{if(['title','query'].includes(event.target.name))changed(event);},{signal:events.signal});
    root.addEventListener('click',event=>{const node=event.target.closest('[data-oc-action]');if(!node)return;event.preventDefault();Promise.resolve().then(()=>click(node.dataset.ocAction,node)).catch(error=>{if(alive(w,g))note(error.message||String(error),true);});},{signal:events.signal});
    try{
      const edit=c.edit;await refresh();if(!alive(w,g)||c.edit!==edit)return;
      if(c.lastOpened)await openSaved(c.lastOpened);else if(c.source)await loadSource({retain:true});else note('Choose an original cohort or open a saved comparison.');
    }catch(error){if(alive(w,g))note(error.message||String(error),true);}
  }
  function update(){
    if(!root)return;
    if(workspace!==current()){const target=root;return mount(target);}
    const c=context(workspace),task=list(getState()?.tasks).find(x=>x.id===c.lastTask&&x.workspace===workspace);
    if(task?.state==='complete'&&!c.observedTasks.has(task.id)){
      c.observedTasks.add(task.id);persist(workspace);note('Comparison saved. Open its original result from Tasks or the saved-comparison selector.');
      const w=workspace,g=epoch;refresh().catch(error=>{if(alive(w,g))note('Saved result retained. Catalogue refresh: '+error.message,true);});
    }
  }
  return {mount,update,detach,taskActions,dispatch,openSaved,openSource};
}
