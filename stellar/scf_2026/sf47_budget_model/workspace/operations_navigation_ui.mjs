import {
  NAVIGATION_SCHEMA, groupedSections, normalizeNavigationState, visitSection,
  toggleFavorite, buildCaseIndex, searchCaseIndex, resolveEntry,
} from './operations_navigation.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fieldLabel=key=>String(key).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/_/g,' ')
  .replace(/\bUsd\b/g,'USD').replace(/\bId\b/g,'ID').replace(/\bIds\b/g,'IDs')
  .replace(/\bSha256\b/g,'SHA-256').replace(/^./,c=>c.toUpperCase());
const short=(value,size=180)=>{const text=String(value??'').replace(/\s+/g,' ').trim();return text.length>size?text.slice(0,size-1)+'…':text;};
const button=(label,attrs='',disabled=false)=>'<button type="button" '+attrs+(disabled?' disabled data-nav-fixed="true"':'')+'>'+esc(label)+'</button>';
const skipKeys=new Set(['contentBase64','bodyBase64','rawBase64','bytesBase64']);
const editableKinds=new Set(['contributors','work','invoices','awards','deployments','purchases','outcomes']);

export function mountOperationsNavigation({
  container,hostRoot,current,sections,activeSection,session={},onSection,onEntry,onState,onError=()=>{},
  canEditRecord=()=>false,onRetryWorkflows=null,
}) {
  const root=document.createElement('aside');
  root.className='operating-navigation';root.setAttribute('aria-label','Operations navigation');
  container.replaceChildren(root);
  let index=buildCaseIndex(current,sections);
  let workflowLoading=typeof onRetryWorkflows==='function',workflowError=null,workflowLoaded=false;
  const sectionMap=new Map(sections.map(section=>[section.id,section]));
  const currentId=current.program.id,version=current.program.version;
  const id='ops-find-'+currentId;
  let active=true,hostBusy=false,actionBusy=false,selectedKey=null,opener=null,scrollBeforeDetail=0;
  let search=plain(session.search)?{...session.search}:{query:'',kind:'all',section:'',page:0};
  if(typeof search.query!=='string')search.query='';
  search.query=search.query.slice(0,200);
  if(!['all','section','record','source','saved'].includes(search.kind))search.kind='all';
  if(!sectionMap.has(search.section))search.section='';
  let lastResultKey=null,arraySerial=0;
  const detailArrays=new Map(),arrayIds=new Map();
  Object.assign(session,visitSection(session,activeSection,sections));

  const available=()=>active&&root.isConnected;
  const busy=()=>hostBusy||actionBusy;
  const $=selector=>root.querySelector(selector);
  const dialog=()=>$('dialog');
  function retain() {
    session.search={...search};
    const preferences=normalizeNavigationState(session,sections);
    Object.assign(session,preferences);
    onState?.(preferences);
  }
  function showError(error) {
    if(!available())return;
    const message=error?.message||String(error);
    const target=$('[data-nav-error]');
    if(target){target.textContent=message;target.hidden=false;}
    onError(error);
  }
  function applyBusy() {
    if(!available())return;
    root.setAttribute('aria-busy',String(busy()));
    root.querySelectorAll('button,input,select').forEach(control=>{
      control.disabled=(busy()&&control.dataset.navClose===undefined)||control.dataset.navFixed==='true';
    });
  }
  function setHostBusy(value) {hostBusy=Boolean(value);applyBusy();}
  function sectionButton(section,{recent=false}={}) {
    const favorite=session.favorites.includes(section.id);
    return '<div class="ops-nav-item">'+
      '<button type="button" data-nav-section="'+esc(section.id)+'"'+(section.id===activeSection?' aria-current="page"':'')+
      ' title="'+esc(section.description)+'">'+esc(section.label)+'</button>'+
      (recent?'':button(favorite?'Unpin':'Pin','class="ops-nav-pin" data-nav-favorite="'+esc(section.id)+
        '" aria-pressed="'+favorite+'" aria-label="'+esc((favorite?'Unpin ':'Pin ')+section.label)+'"'))+'</div>';
  }
  function renderNavigation() {
    if(!available())return;
    const favorites=session.favorites.map(sectionId=>sectionMap.get(sectionId)).filter(Boolean);
    const recent=session.recent.filter(sectionId=>sectionId!==activeSection&&!session.favorites.includes(sectionId))
      .slice(0,6).map(sectionId=>sectionMap.get(sectionId)).filter(Boolean);
    $('[data-nav-groups]').innerHTML=
      (favorites.length?'<section class="ops-nav-shortcuts" aria-label="Pinned sections"><h3>Pinned</h3>'+
        favorites.map(section=>sectionButton(section)).join('')+'</section>':'')+
      (recent.length?'<section class="ops-nav-shortcuts" aria-label="Recent sections"><h3>Recent</h3>'+
        recent.map(section=>sectionButton(section,{recent:true})).join('')+'</section>':'')+
      groupedSections(sections).map(group=>'<details class="ops-nav-group" data-nav-group="'+esc(group.id)+'"'+
        (session.collapsedGroups.includes(group.id)?'':' open')+'><summary>'+esc(group.label)+
        '<span>'+group.sections.length+'</span></summary><div>'+group.sections.map(section=>sectionButton(section)).join('')+'</div></details>').join('');
    root.dataset.compactCollapsed=String(session.compactCollapsed);
    const toggle=$('[data-nav-toggle]');
    toggle.setAttribute('aria-expanded',String(!session.compactCollapsed));
    toggle.textContent=session.compactCollapsed?'Browse sections':'Hide sections';
    applyBusy();
  }
  function renderShell() {
    root.innerHTML='<div class="ops-nav-tools">'+
      button('Find in case','data-nav-find aria-haspopup="dialog" aria-controls="'+esc(id)+'"')+
      '<small>Ctrl / ⌘ K</small>'+
      button('Browse sections','data-nav-toggle class="ops-nav-compact-toggle" aria-controls="'+esc(id+'-groups')+'" aria-expanded="false"')+
      '</div><nav id="'+esc(id+'-groups')+'" data-nav-groups aria-label="Operations sections"></nav>'+
      '<dialog id="'+esc(id)+'" class="ops-find-dialog" aria-labelledby="'+esc(id+'-title')+'">'+
      '<div class="ops-find-heading"><div><h2 id="'+esc(id+'-title')+'">Find in case</h2><p>'+esc(current.program.name)+
      ' · version '+esc(version)+'</p></div>'+button('Close','data-nav-close aria-label="Close case search"')+'</div>'+
      '<p class="ops-find-error" data-nav-error role="alert" hidden></p>'+
      '<div class="ops-find-workflows" data-nav-workflows role="status" aria-live="polite"></div>'+
      '<div data-nav-search-controls class="ops-find-controls" role="search">'+
      '<label class="ops-find-query">Name, reference or saved text<input type="search" data-nav-query maxlength="200" autocomplete="off" value="'+esc(search.query)+'" aria-controls="'+esc(id+'-results')+'"></label>'+
      '<label>Search in<select data-nav-kind>'+[['all','All result types'],['section','Sections'],['record','Native case records'],['source','Source metadata'],['saved','Saved workflow summaries']]
        .map(([value,label])=>'<option value="'+value+'"'+(search.kind===value?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>'+
      '<label>Section<select data-nav-filter-section><option value="">All sections</option>'+
        sections.map(section=>'<option value="'+esc(section.id)+'"'+(search.section===section.id?' selected':'')+'>'+esc(section.label)+'</option>').join('')+'</select></label>'+
      '</div><div data-nav-search-results><p data-nav-count role="status" aria-live="polite"></p>'+
      '<ol id="'+esc(id+'-results')+'" data-nav-results class="ops-find-results"></ol>'+
      '<div data-nav-pages class="ops-find-pages"></div><details class="ops-find-coverage"><summary>Search coverage</summary><p data-nav-coverage>'+
      esc(index.coverage)+'</p><p data-nav-coverage-counts>'+esc(index.counts.record)+' native records · '+esc(index.counts.source)+' sources · '+
      esc(index.counts.saved)+' saved workflow summaries · '+esc(index.counts.section)+' sections.</p></details></div>'+
      '<div data-nav-detail hidden></div></dialog>';
    renderNavigation();renderResults();renderWorkflowStatus();retain();
  }
  function renderResults() {
    if(!available())return;
    const result=searchCaseIndex(index,search);search.page=result.page;
    $('[data-nav-count]').textContent=result.total
      ?result.from+'–'+result.to+' of '+result.total+' results'
      :'No matching records or sections in this case index.';
    $('[data-nav-results]').innerHTML=result.entries.map(entry=>
      '<li><button type="button" class="ops-find-result" data-nav-result="'+esc(entry.key)+'">'+
      '<span class="ops-find-result-title">'+esc(short(entry.label))+'</span>'+
      '<span>'+esc(entry.kindLabel)+' · '+esc(entry.sectionLabel)+'</span>'+
      (entry.subtitle?'<small>'+esc(short(entry.subtitle,240))+'</small>':'')+
      (entry.type!=='section'?'<small class="ops-find-reference">'+esc(entry.id)+'</small>':'')+
      '</button></li>').join('');
    $('[data-nav-pages]').innerHTML=button('Previous','data-nav-page="previous"',result.page===0)+
      '<span>Page '+(result.page+1)+' of '+result.pages+'</span>'+
      button('Next','data-nav-page="next"',result.page>=result.pages-1);
    applyBusy();retain();
  }
  function renderWorkflowStatus() {
    if(!available())return;
    const target=$('[data-nav-workflows]');
    if(typeof onRetryWorkflows!=='function'){target.hidden=true;return;}
    target.hidden=false;
    const message=workflowLoading?'Loading saved workflow editions. Other case records are ready to search.':
      workflowError?'Saved workflow editions could not be loaded. '+(workflowError.message||String(workflowError)):
      workflowLoaded?'Saved workflow editions are ready. Select an original edition to resume its desk.':'Load the original saved workflow editions.';
    target.innerHTML='<p>'+esc(message)+'</p>'+(!workflowLoading&&(workflowError||!workflowLoaded)
      ?button('Load saved workflows','data-nav-retry-workflows'):'');
    const coverage=$('[data-nav-coverage]');
    if(coverage)coverage.textContent=index.coverage;
    const counts=$('[data-nav-coverage-counts]');
    if(counts)counts.textContent=index.counts.record+' native records · '+index.counts.source+' sources · '+
      index.counts.saved+' saved workflow summaries · '+index.counts.section+' sections.';
    applyBusy();
  }
  function setWorkflows(value,{loading=false,error=null}={}) {
    if(!available())return false;
    if(value!==null&&value!==undefined) {
      const next=buildCaseIndex(current,sections,value);
      index=next;workflowLoaded=true;
      renderResults();
    }
    workflowLoading=Boolean(loading);workflowError=error;
    renderWorkflowStatus();
    return true;
  }
  function arrayMarkup(key) {
    const state=detailArrays.get(key),size=20;
    const pages=Math.ceil(state.value.length/size);
    state.page=Math.min(Math.max(0,state.page),pages-1);
    const start=state.page*size,end=Math.min(start+size,state.value.length);
    return '<p class="ops-find-array-count">'+(start+1)+'–'+end+' of '+state.value.length+' original values</p>'+
      '<ol class="ops-find-values" start="'+(start+1)+'">'+state.value.slice(start,end)
        .map(item=>'<li>'+renderValue(item,state.ancestors)+'</li>').join('')+'</ol>'+
      '<div class="ops-find-array-pages">'+button('Previous values','data-nav-array-action="previous" data-nav-array-key="'+key+'"',state.page===0)+
      button('Next values','data-nav-array-action="next" data-nav-array-key="'+key+'"',state.page>=pages-1)+'</div>';
  }
  function renderValue(value,ancestors=new Set()) {
    if(value===null||value===undefined)return '<span class="ops-find-empty">Not recorded</span>';
    if(typeof value==='boolean')return value?'Yes':'No';
    if(typeof value!=='object') {
      const related=typeof value==='string'?index.byId.get(value):null;
      if(related&&related.key!==selectedKey)return button(short(related.label,100),
        'class="ops-find-related" data-nav-related="'+esc(related.key)+'" title="'+esc(value)+'"')+
        '<small class="ops-find-reference">'+esc(value)+'</small>';
      return '<span class="ops-find-value">'+esc(value)+'</span>';
    }
    if(ancestors.has(value))return '<span class="ops-find-empty">Repeated reference</span>';
    const next=new Set(ancestors);next.add(value);
    if(Array.isArray(value)){
      if(!value.length)return '<span class="ops-find-empty">None</span>';
      if(value.length<=20)return '<ol class="ops-find-values">'+value.map(item=>'<li>'+renderValue(item,next)+'</li>').join('')+'</ol>';
      let key=arrayIds.get(value);
      if(!key){key='array-'+(++arraySerial);arrayIds.set(value,key);detailArrays.set(key,{value,ancestors:next,page:0});}
      return '<div class="ops-find-array" data-nav-array="'+key+'" tabindex="-1" aria-label="Original value list">'+arrayMarkup(key)+'</div>';
    }
    const fields=Object.entries(value).filter(([key])=>!skipKeys.has(key));
    return fields.length?'<dl class="ops-find-fields">'+fields.map(([key,item])=>'<div><dt>'+esc(fieldLabel(key))+'</dt><dd>'+renderValue(item,next)+'</dd></div>').join('')+'</dl>':'<span class="ops-find-empty">No additional fields</span>';
  }
  function sourceHref(value) {
    try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}
  }
  function showEntry(key,{related=false}={}) {
    const entry=resolveEntry(index,key);
    if(!entry||busy())return;
    if(entry.type==='section'){selectSection(entry.section);return;}
    if(!related){scrollBeforeDetail=dialog().scrollTop;lastResultKey=key;}
    selectedKey=key;detailArrays.clear();arrayIds.clear();arraySerial=0;
    $('[data-nav-search-controls]').hidden=true;$('[data-nav-search-results]').hidden=true;
    const detail=$('[data-nav-detail]');detail.hidden=false;
    const href=entry.type==='source'?sourceHref(entry.data.sourceUrl):null;
    let actions=button('Open '+entry.sectionLabel,'data-nav-open-entry="'+esc(key)+'"');
    if(entry.type==='source')actions+=button('Download original source','data-nav-entry-action="source" data-nav-key="'+esc(key)+'"');
    if(entry.collection==='reviews')actions+=button('Download original review','data-nav-entry-action="review" data-nav-key="'+esc(key)+'"');
    if(entry.type==='record'&&editableKinds.has(entry.collection)&&current.program.state==='OPEN'&&canEditRecord(entry.collection))
      actions+=button('Open original editor','data-nav-entry-action="edit" data-nav-key="'+esc(key)+'"');
    detail.innerHTML=button('Back to results','data-nav-back')+
      '<h3 id="'+esc(id+'-detail-title')+'" tabindex="-1">'+esc(entry.label)+'</h3>'+
      '<p>'+esc(entry.kindLabel)+' · '+esc(entry.sectionLabel)+'</p>'+
      '<p class="ops-find-reference">'+esc(entry.id)+'</p>'+
      '<div class="ops-find-detail-actions">'+actions+'</div>'+
      (entry.type==='saved'?'<p class="ops-find-note">'+(entry.workflowSelection?'This summary identifies the original saved edition. Opening its desk preserves current drafts and pending requests.':'This is the saved summary returned with the current case. Open the original section to inspect its complete retained edition.')+'</p>':'')+
      (href?'<p><a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">Open the original source URL</a></p>':'')+
      renderValue(entry.data);
    dialog().setAttribute('aria-labelledby',id+'-detail-title');
    dialog().scrollTop=0;detail.querySelector('h3')?.focus();applyBusy();
  }
  function backToResults() {
    selectedKey=null;$('[data-nav-detail]').hidden=true;$('[data-nav-detail]').replaceChildren();
    $('[data-nav-search-controls]').hidden=false;$('[data-nav-search-results]').hidden=false;
    dialog().setAttribute('aria-labelledby',id+'-title');
    dialog().scrollTop=scrollBeforeDetail;
    const result=[...root.querySelectorAll('[data-nav-result]')].find(item=>item.dataset.navResult===lastResultKey);
    (result||$('[data-nav-query]'))?.focus();
  }
  function openSearch() {
    if(!available()||busy())return;
    const existing=hostRoot.querySelector('dialog[open]');
    if(existing&&existing!==dialog())return;
    if(!dialog().open) {
      opener=document.activeElement;selectedKey=null;
      $('[data-nav-detail]').hidden=true;$('[data-nav-search-controls]').hidden=false;$('[data-nav-search-results]').hidden=false;
      dialog().setAttribute('aria-labelledby',id+'-title');dialog().showModal();
    }
    $('[data-nav-query]')?.focus();
  }
  function closeSearch() {
    if(dialog()?.open)dialog().close();
  }
  function selectSection(sectionId) {
    if(!available()||busy()||!sectionMap.has(sectionId))return;
    Object.assign(session,visitSection(session,sectionId,sections));
    session.compactCollapsed=true;retain();closeSearch();
    onSection(sectionId);
  }
  async function performEntry(key,action) {
    const entry=resolveEntry(index,key);if(!entry||!available()||busy())return;
    if(action==='open'||action==='edit')closeSearch();
    actionBusy=true;applyBusy();
    try {await onEntry?.(entry,action,{caseId:currentId,version});}
    catch(error){showError(error);}
    finally{actionBusy=false;if(available())applyBusy();}
  }
  function onClick(event) {
    const target=event.target.closest('button');if(!target||!root.contains(target))return;
    if(target.dataset.navClose!==undefined){closeSearch();return;}
    if(busy())return;
    if(target.dataset.navFind!==undefined){openSearch();return;}
    if(target.dataset.navToggle!==undefined){session.compactCollapsed=!session.compactCollapsed;retain();renderNavigation();return;}
    if(target.dataset.navSection){selectSection(target.dataset.navSection);return;}
    if(target.dataset.navFavorite){
      const sectionId=target.dataset.navFavorite;Object.assign(session,toggleFavorite(session,sectionId,sections));retain();renderNavigation();
      [...root.querySelectorAll('[data-nav-favorite]')].find(item=>item.dataset.navFavorite===sectionId)?.focus();return;
    }
    if(target.dataset.navResult){showEntry(target.dataset.navResult);return;}
    if(target.dataset.navRelated){showEntry(target.dataset.navRelated,{related:true});return;}
    if(target.dataset.navBack!==undefined){backToResults();return;}
    if(target.dataset.navRetryWorkflows!==undefined){void Promise.resolve(onRetryWorkflows?.()).catch(error=>setWorkflows(null,{error}));return;}
    if(target.dataset.navArrayAction){
      const key=target.dataset.navArrayKey,state=detailArrays.get(key);
      if(!state)return;
      state.page+=target.dataset.navArrayAction==='next'?1:-1;
      const targetList=[...root.querySelectorAll('[data-nav-array]')].find(item=>item.dataset.navArray===key);
      if(targetList){targetList.innerHTML=arrayMarkup(key);applyBusy();targetList.focus();}
      return;
    }
    if(target.dataset.navOpenEntry){void performEntry(target.dataset.navOpenEntry,'open');return;}
    if(target.dataset.navEntryAction){void performEntry(target.dataset.navKey,target.dataset.navEntryAction);return;}
    if(target.dataset.navPage){
      search.page+=(target.dataset.navPage==='next'?1:-1);renderResults();
      $('[data-nav-results] button')?.focus();
    }
  }
  function onInput(event) {
    if(!event.target.matches('[data-nav-query]')||busy())return;
    search.query=event.target.value.slice(0,200);search.page=0;renderResults();
  }
  function onChange(event) {
    if(busy())return;
    if(event.target.matches('[data-nav-kind]'))search.kind=event.target.value;
    else if(event.target.matches('[data-nav-filter-section]'))search.section=event.target.value;
    else return;
    search.page=0;renderResults();
  }
  function onToggle(event) {
    const group=event.target?.dataset?.navGroup;
    if(!group||!available())return;
    session.collapsedGroups=event.target.open?session.collapsedGroups.filter(id=>id!==group):
      [...new Set([...session.collapsedGroups,group])];
    retain();
  }
  function onKeydown(event) {
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='k') {
      const existing=hostRoot.querySelector('dialog[open]');
      if(existing&&existing!==dialog())return;
      if(!busy()){event.preventDefault();openSearch();}
      return;
    }
    if(event.target.matches?.('[data-nav-query]')&&['ArrowDown','Enter'].includes(event.key)){
      event.preventDefault();$('[data-nav-results] button')?.focus();
    }
  }
  root.addEventListener('click',onClick);
  root.addEventListener('input',onInput);
  root.addEventListener('change',onChange);
  root.addEventListener('toggle',onToggle,true);
  hostRoot.addEventListener('keydown',onKeydown);
  renderShell();
  dialog().addEventListener('close',()=>{
    if(available()&&opener?.isConnected&&typeof opener.focus==='function')opener.focus();
    opener=null;
  });
  function dispose() {
    if(!active)return;active=false;
    hostRoot.removeEventListener('keydown',onKeydown);
    root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);
    root.removeEventListener('change',onChange);root.removeEventListener('toggle',onToggle,true);
    if(dialog()?.open)dialog().close();
  }
  return {root,ready:Promise.resolve(),dispose,setHostBusy,openSearch,setWorkflows,get index(){return index;}};
}
