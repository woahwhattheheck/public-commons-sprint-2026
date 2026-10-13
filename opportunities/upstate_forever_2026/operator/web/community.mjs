/**
 * Utility/community planning inside the original Upper Savannah operator.
 * Every mutation uses the host's retained form operation and native task queue.
 */
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHTML;
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

/** Host-owned callbacks retain original workspace, task and dialog semantics. */
export function attachCommunity({getState,api,endpoint,openForm,submitAction,detail,fileList,sourceForm,toast,openItem}){
  const cache=new Map(),pending=new Map();
  let activeWorkspace=null,container=null,mountController=null,loadError='',formTable=null,formWorkspace=null;
  let local={table:'',tab:'explore',utility:'',watershed:'',query:'',sort:'geoid',compare:[]};
  const current=()=>getState();
  const data=()=>current()?.data??{};
  const workspace=()=>current()?.workspace_key??'';
  const tables=()=>list(data().community_tables);
  const plans=()=>list(data().community_plans);
  const reports=()=>list(data().community_reports);
  const key=(kind,id)=>workspace()+'|'+kind+'|'+id;
  function sync(){
    if(activeWorkspace!==workspace()){
      activeWorkspace=workspace();loadError='';
      local={table:'',tab:'explore',utility:'',watershed:'',query:'',sort:'geoid',compare:[]};
      try{const saved=JSON.parse(sessionStorage.getItem('upstate-community-view:'+workspace())||'null');if(saved&&typeof saved==='object')local={...local,...saved};}catch{}
    }
    if(!tables().some(t=>t.id===local.table))local.table=tables()[0]?.id??'';
    if(!['explore','plans','reports'].includes(local.tab))local.tab='explore';
    local.compare=list(local.compare);
  }
  function persist(){try{sessionStorage.setItem('upstate-community-view:'+workspace(),JSON.stringify(local));}catch{}}
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
        '<td class="actions-cell">'+button('plan-open','Open','data-id="'+e(p.id)+'"','small')+button('plan-revise','Revise','data-id="'+e(p.id)+'"','small')+button('report-new','Build report','data-id="'+e(p.id)+'"','small')+'</td></tr>';
    });
  }
  function planView(){
    return plans().length?section('Intervention plans','Each saved plan keeps its original source table, selected communities, model context and previous revision.',
      table(['Plan / purpose','Community table','Groups','Interventions','Revision',''],planRows()),
      button('plan-new','New intervention plan','','primary')):
      empty('Build a source-water intervention plan','Select communities, connect the original scientific results, and record a complete protection, restoration or monitoring work program.',button('plan-new','New intervention plan','','primary'));
  }
  function reportView(){
    return reports().length?section('Community and utility reports','Open a retained report to preview its full narrative and download every original editable file.',
      table(['Report','Plan','Created','State',''],reports().map(r=>'<tr><th scope="row">'+e(r.title||r.selection?.title||'Community report')+'<small>'+e(short(r.id))+'</small></th>'+
        '<td>'+e(row('community_plans',r.plan_id||r.selection?.plan_id)?.title||short(r.plan_id||r.selection?.plan_id))+'</td>'+
        '<td>'+e(r.created_at?new Date(r.created_at).toLocaleString():'—')+'</td><td>'+e(human(r.state||'complete'))+'</td>'+
        '<td class="actions-cell">'+button('report-open','Open report','data-id="'+e(r.id)+'"','small')+'</td></tr>'))):
      empty('Retain a complete community report','Save an intervention plan, then build the narrative, original community rows, utility and watershed summaries, costs and model context.',button('tab-plans','Open plans'));
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
      if(target.name==='community_table'){local.table=target.value;local.utility='';local.watershed='';local.query='';local.compare=[];loadError='';redraw();}
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
    detail(t.title,sourceMetadata(t)+metrics(t.groups)+utilityCards(t)+groupTable(t.groups,t)+
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
  function contextForm(context={}){
    const selectedGrid=context.grid_id||list(data().runs).find(r=>r.id===context.baseline_run_id)?.selection?.grid_id||'';
    return '<div class="form-grid">'+
      field('Original model grid',select('community_grid',list(data().grids).filter(g=>g.state==='complete').map(g=>({id:g.id,title:entityTitle('grids',g.id)})),selectedGrid,'No grid selected'))+
      field('Completed baseline run',select('community_baseline',completeRuns(selectedGrid),context.baseline_run_id||'','No baseline selected'))+
      '<fieldset class="full"><legend>Completed alternative runs</legend><p class="note">Choose the actual alternative runs on the selected baseline grid.</p><div id="community-context-alternatives">'+checks('community_alternatives',completeRuns(selectedGrid).filter(r=>r.id!==context.baseline_run_id),list(context.scenario_run_ids))+'</div></fieldset>'+
      field('Original GIS delivery',select('community_delivery',list(data().deliveries).filter(d=>d.state==='complete').map(d=>({id:d.id,title:entityTitle('deliveries',d.id)})),context.delivery_id||'','No delivery selected'),'Attach a completed original map delivery to the community plan.',true)+
      '<fieldset class="full"><legend>Supporting source editions</legend>'+checks('community_sources',list(data().sources),list(context.source_collection_ids))+'</fieldset></div>';
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
  function readSelection(){
    return {utility_ids:checked('community_plan_utilities'),watershed_ids:checked('community_plan_watersheds'),geoids:checked('community_plan_geoids')};
  }
  function readContext(){
    const context={source_collection_ids:checked('community_sources'),scenario_run_ids:checked('community_alternatives')};
    for(const [name,key]of [['community_grid','grid_id'],['community_baseline','baseline_run_id'],['community_delivery','delivery_id']]){
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
      if(['community_plan_utilities','community_plan_watersheds','community_plan_geoids'].includes(target.name))updatePlanSummary();
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
  }
  let planFormController=null;
  async function planForm(id,{fromSelection=false}={}){
    sync();
    if(!tables().length)return importForm();
    const old=id?await get('community_plans',id):null;
    const tableId=old?.table_id||local.table||tables()[0].id;
    const t=await get('community_tables',tableId);
    formTable=t;formWorkspace=workspace();
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
      '<div class="subheading"><h3>Interventions</h3>'+button('intervention-add','Add intervention','','small')+'</div>'+
      '<div id="community-interventions">'+list(old?.interventions).map(v=>interventionRow(t,v)).join('')+'</div>'+
      field('Plan notes',textarea('community_plan_notes',old?.notes||'','rows="3"'),'One note per line.',true)+
      (old?'<p class="note">This revision retains the previous plan and its original intervention identities.</p>':'')+'</div>',
      old?'Save revised plan':'Save complete plan',async()=>{
        ensureFormWorkspace();
        const selected=readSelection();
        if(!selectCommunityGroups(formTable.groups,selected).length)throw Error('Choose at least one original community through the utility, watershed and geography selections.');
        const payload={title:value('community_plan_title').trim(),purpose:value('community_plan_purpose').trim(),table_id:formTable.id,selection:selected,
          context:readContext(),interventions:readInterventions(),notes:value('community_plan_notes').split(/\r?\n/).map(s=>s.trim()).filter(Boolean),
          ...(old?{previous_plan_id:old.id}:{})};
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
  function contextDetails(plan){
    const c=plan.context??{},items=[];
    if(c.grid_id)items.push(['Model grid',entityTitle('grids',c.grid_id),button('native-item','Open grid','data-kind="grids" data-id="'+e(c.grid_id)+'"','small')]);
    if(c.baseline_run_id)items.push(['Baseline model run',entityTitle('runs',c.baseline_run_id),button('native-item','Open run','data-kind="runs" data-id="'+e(c.baseline_run_id)+'"','small')]);
    for(const id of list(c.scenario_run_ids))items.push(['Alternative model run',entityTitle('runs',id),button('native-item','Open run','data-kind="runs" data-id="'+e(id)+'"','small')]);
    if(c.delivery_id)items.push(['GIS delivery',entityTitle('deliveries',c.delivery_id),button('native-item','Open delivery','data-kind="deliveries" data-id="'+e(c.delivery_id)+'"','small')]);
    for(const id of list(c.source_collection_ids))items.push(['Supporting source edition',entityTitle('sources',id),button('native-item','Open source','data-kind="sources" data-id="'+e(id)+'"','small')]);
    return items.length?table(['Context','Original selection',''],items.map(([kind,title,action])=>'<tr><th scope="row">'+e(kind)+'</th><td>'+e(title)+'</td><td class="actions-cell">'+action+'</td></tr>')):
      '<div class="section-body"><p class="note">This plan retains the original community table. Add completed scientific selections in a revised plan when they are ready.</p></div>';
  }
  async function planDetail(id){
    const p=await get('community_plans',id,{fresh:true}),t=await get('community_tables',p.table_id),groups=list(p.selected_groups).length?p.selected_groups:selectCommunityGroups(t.groups,p.selection);
    const related=reports().filter(r=>(r.plan_id||r.selection?.plan_id)===id);
    detail(p.title,
      '<p class="community-intro">'+e(p.purpose)+'</p><div class="community-detail-actions">'+button('plan-revise','Revise plan','data-id="'+e(p.id)+'"')+button('report-new','Build complete report','data-id="'+e(p.id)+'"','primary')+'</div>'+
      metrics(groups)+section('Selected communities',t.title,groupTable(groups,t))+
      section('Intervention work program','Retained priorities, work owners, intended benefits and costs.',interventionTable(p.interventions,t))+
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
  async function reportDetail(id,{preview=false}={}){
    const r=await get('community_reports',id,{fresh:true});
    const files=list(r._downloads),html=files.find(f=>/\.html?$/i.test(f.filename||''));
    const planId=r.plan_id||r.selection?.plan_id;
    const title=r.title||r.selection?.title||'Community and utility report';
    const body='<div class="community-detail-actions">'+(planId?button('plan-open','Open original plan','data-id="'+e(planId)+'"'):'')+
      (html?button('report-preview',preview?'Hide report preview':'Preview full report','data-id="'+e(id)+'" data-preview="'+(!preview)+'"','primary'):'')+'</div>'+
      (preview&&html?'<iframe class="community-report-preview" title="'+e(title)+'" src="'+e(html.url)+'" sandbox="" referrerpolicy="no-referrer"></iframe>':'')+
      (files.length?fileList(files):'<p class="notice">The report has no completed file tickets yet. Inspect its original operation for progress.</p>')+
      '<details class="technical"><summary>Complete retained report record</summary><pre class="json-view">'+e(JSON.stringify(r,null,2))+'</pre></details>';
    detail(title,body,{kind:'community_reports',id});
  }
  async function nativeItem(buttonNode){
    return openItem(buttonNode.dataset.kind,buttonNode.dataset.id);
  }
  async function dispatch(node){
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
    if(action==='plan-new')return planForm();
    if(action==='plan-selection')return planForm(null,{fromSelection:true});
    if(action==='plan-revise')return planForm(node.dataset.id);
    if(action==='plan-open')return planDetail(node.dataset.id);
    if(action==='report-new')return reportForm(node.dataset.id);
    if(action==='report-open')return reportDetail(node.dataset.id);
    if(action==='report-preview')return reportDetail(node.dataset.id,{preview:node.dataset.preview==='true'});
    if(action==='native-item')return nativeItem(node);
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
  function detach(){mountController?.abort();container=null;}
  return {render,mount,dispatch,detach};
}
