/** Reports stay in their original source edition and existing Sources screen. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const encoded = value => encodeURIComponent(String(value));
const size = value => {
  let n=Number(value),i=0;const units=['B','KiB','MiB','GiB'];
  while(n>=1024&&i<3){n/=1024;i++;}
  return n.toLocaleString(undefined,{maximumFractionDigits:i?1:0})+' '+units[i];
};
const rowKey = row => row.collection_id+':'+row.entry_key;
const labels = {
  WATER_QUALITY_ASSOCIATION_REPORT:'Assessment and programme associations',
  WATER_QUALITY_SOURCE_SCOPE_REPORT:'Complete station and assessment source coverage',
  STATION_ASSESSMENT_CONTEXT:'Station assessment context',
  observed_water_quality_report:'Observed water quality report'
};
const descriptions = {
  WATER_QUALITY_ASSOCIATION_REPORT:'Compare assessment-publisher and station-publisher HUCs, programme associations and original record detail.',
  WATER_QUALITY_SOURCE_SCOPE_REPORT:'Explore the full native station selection and statewide assessment editions, including source-selection boundaries.',
  STATION_ASSESSMENT_CONTEXT:'Review the original assessment table, its readable report and associated station source editions.'
};

export function filterSourceReports(reports, query='') {
  const words=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return reports.filter(row=>{
    const text=[row.title,row.source_id,row.collection_title,row.kind,row.role,row.vintage,row.description,
      labels[row.role],...(row.html||[]).map(item=>item.path)].join(' ').toLocaleLowerCase();
    return words.every(word=>text.includes(word));
  });
}

export function sourceReportMemberURL(workspace, report, member) {
  if(typeof member!=='string'||!member||member.startsWith('/')||member.includes('\\')||
    /[\x00-\x1f\x7f]/.test(member)||member.split('/').some(part=>!part||part==='.'||part==='..'||part.includes(':')))
    throw Error('Choose an original relative report member.');
  return '/api/file/source-reports/'+[workspace,report.collection_id,report.entry_key].map(encoded).join('/')+
    '/'+member.split('/').map(encoded).join('/');
}

function publisherLink(uri) {
  return /^https?:\/\//i.test(uri||'')?'<a href="'+esc(uri)+'" target="_blank" rel="noopener noreferrer">Original publisher / source</a>':esc(uri);
}
function download(url,label){
  return '<a href="'+esc(url)+'?download=1" download>'+esc(label)+'</a>';
}

export function attachSourceReports(host) {
  let panel=null,currentWorkspace=null,currentCatalogKey=null,reports=[],selected=null,selectedMember=null;
  let generation=0,detailGeneration=0,active=false,loading=null,query='',catalogError=null;
  const request = (path,values={}) => host.api(host.endpoint(path,values));
  const valid = (workspace,ticket) => generation===ticket&&host.getWorkspace()===workspace;
  function ensurePanel(content) {
    if(!document.querySelector('link[data-source-reports-style]')){
      const link=document.createElement('link');link.rel='stylesheet';link.href='/web/source_reports.css';
      link.dataset.sourceReportsStyle='';document.head.append(link);
    }
    if(!panel){
      panel=document.createElement('section');panel.id='source-reports-panel';panel.className='source-reports-panel';
      panel.setAttribute('aria-label','Retained source reports');
      panel.innerHTML='<div class="source-reports-heading"><div><h2>Source reports and regional context</h2>'+
        '<p>Open a retained report with its original files, or import a complete report archive into this Workspace.</p></div>'+
        '<div class="inline-actions"><button type="button" data-source-report-action="import">Import report ZIP</button>'+
        '<button type="button" data-source-report-action="regional" hidden>Open Regional watersheds</button></div></div>'+
        '<p class="source-reports-regional" hidden></p>'+
        '<label class="source-reports-search">Find a retained report<input type="search" data-source-report-search placeholder="Title, source ID, edition or report type"></label>'+
        '<div data-source-report-status role="status"></div><div data-source-report-catalog></div>'+
        '<section data-source-report-detail hidden aria-label="Selected retained report"></section>';
      panel.addEventListener('click',event=>{
        const button=event.target.closest('[data-source-report-action]');
        if(!button||!panel.contains(button))return;
        event.preventDefault();event.stopPropagation();
        const workspace=currentWorkspace,ticket=generation;
        dispatch(button).catch(error=>{if(valid(workspace,ticket))showError(error);});
      });
      panel.querySelector('[data-source-report-search]').addEventListener('input',event=>{
        query=event.target.value;renderCatalog();
      });
      panel.addEventListener('change',event=>{
        if(event.target.matches('[data-source-report-document]'))openDocument(event.target.value);
      });
    }
    // A stable sibling survives ordinary state rerenders without resetting report selections.
    if(panel.parentNode!==content.parentNode)content.after(panel);
    panel.hidden=false;
  }
  function showError(error){
    if(!panel)return;
    panel.querySelector('[data-source-report-status]').textContent=error.message||String(error);
  }
  function renderRegional(){
    const enabled=host.hasView('watershed-context'),button=panel.querySelector('[data-source-report-action="regional"]');
    button.hidden=!enabled;
    const reports=host.getState()?.data?.watershed_context_reports||[];
    const text=panel.querySelector('.source-reports-regional');
    text.hidden=!enabled;
    text.textContent=reports.length
      ?reports.length.toLocaleString()+' saved regional report'+(reports.length===1?'':'s')+' available in the original Regional watersheds desk. Open it to inspect programme context, native network selections and saved regional views.'
      :'Regional watersheds uses the retained regional source edition and its native network. Open the desk to select original sources or reopen an analysis.';
  }
  function renderCatalog(){
    if(!panel)return;
    const filtered=filterSourceReports(reports,query);
    panel.querySelector('[data-source-report-status]').textContent=catalogError||
      (loading?'Reading retained report metadata…':filtered.length+' of '+reports.length+' retained reports');
    panel.querySelector('[data-source-report-catalog]').innerHTML=filtered.length?
      '<div class="table-scroll"><table><thead><tr><th>Report / original source</th><th>Edition</th><th>Files</th><th></th></tr></thead><tbody>'+
      filtered.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(labels[row.role]||row.role||row.kind)+
        ' · '+esc(row.kind)+'</small><small>'+esc(row.source_id)+'</small>'+
        (descriptions[row.role]?'<p>'+esc(descriptions[row.role])+'</p>':'')+
        '</td><td>'+esc(row.vintage)+'<small>'+esc(row.collection_title)+'</small></td><td>'+
        row.member_count.toLocaleString()+'</td><td><button type="button" data-source-report-action="open" data-report-key="'+
        esc(rowKey(row))+'">'+(selected&&rowKey(selected)===rowKey(row)?'Return to report':'Open report')+'</button></td></tr>').join('')+
      '</tbody></table></div>':loading?'':'<p class="note">'+(reports.length?'No retained report matches this search.':
        'Import a report ZIP or a source edition with an HTML report. Reports can be primary documents or companions of an original scientific table.')+'</p>';
  }
  async function catalog(force=false){
    const workspace=host.getWorkspace();
    const key=JSON.stringify([workspace,(host.getState()?.data?.sources||[]).map(row=>row.id)]);
    if(!force&&key===currentCatalogKey)return;
    if(loading)return loading;
    const ticket=generation;
    loading=(async()=>{
      try{
        const value=await request('/api/source-reports/catalog');
        if(!valid(workspace,ticket))return;
        if(value.workspace_key!==workspace)throw Error('The report catalogue belongs to another Workspace.');
        reports=value.reports||[];currentCatalogKey=key;catalogError=null;
        if(selected&&!reports.some(row=>rowKey(row)===rowKey(selected)))clearSelection();
      }catch(error){
        if(valid(workspace,ticket)){catalogError=error.message||String(error);currentCatalogKey=null;}
      }finally{
        if(valid(workspace,ticket)){loading=null;renderCatalog();}
      }
    })();
    renderCatalog();
    return loading;
  }
  function clearSelection(){
    selected=null;selectedMember=null;
    if(panel){const target=panel.querySelector('[data-source-report-detail]');target.replaceChildren();target.hidden=true;}
  }
  function renderDetail(){
    const target=panel.querySelector('[data-source-report-detail]');
    target.hidden=false;
    const body=selected.members.find(row=>row.primary);
    const relationships=selected.source_relationships||[];
    target.innerHTML='<div class="source-reports-heading"><div><h2>'+esc(selected.title)+'</h2><p>'+
      esc(selected.vintage)+' · '+esc(selected.kind)+' · '+esc(selected.role||'Original source')+'</p></div>'+
      '<button type="button" data-source-report-action="close">Close report</button></div>'+
      '<div class="inline-actions">'+publisherLink(selected.uri)+
      '<button type="button" data-source-report-action="edition">Inspect source edition</button>'+
      '<button type="button" data-source-report-action="archive">Download report and source edition</button>'+
      download(selected.original_manifest.url,'Original import manifest')+'</div>'+
      '<p class="note">This view uses the retained report bytes. Saved review files and selected CSV / JSON downloads remain available in its original controls.</p>'+
      '<p data-source-report-archive-status role="status"></p>'+
      '<details><summary>Source identity and related entries</summary><dl><dt>Source ID</dt><dd>'+esc(selected.source_id)+
      '</dd><dt>Source body SHA256</dt><dd class="mono">'+esc(selected.body_sha256)+'</dd>'+
      '<dt>Retained edition</dt><dd class="mono">'+esc(selected.collection_id)+'</dd></dl>'+
      ((selected.related_sources||[]).length?'<ul>'+selected.related_sources.map(row=>'<li>'+esc(row.title)+' · '+
        esc(row.role||row.kind)+' <small>'+esc(row.id)+'</small></li>').join('')+'</ul>':'')+
      (relationships.length?'<pre>'+esc(JSON.stringify(relationships,null,2))+'</pre>':'')+'</details>'+
      '<label class="source-reports-document">Report document<select data-source-report-document>'+
      selected.html.map(row=>'<option value="'+esc(row.path)+'">'+esc(row.path)+'</option>').join('')+'</select></label>'+
      '<div class="source-report-frame-shell"><iframe title="'+esc(selected.title)+
      '" sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe></div>'+
      '<details class="source-report-files"><summary>All '+selected.members.length+' retained report and source files</summary>'+
      '<p>File names retain the source entry’s original directory structure. The complete source-edition download preserves all related scientific source entries and can be imported in another Workspace.</p>'+
      '<div class="table-scroll"><table><thead><tr><th>Original relative member</th><th>Size / SHA256</th><th></th></tr></thead><tbody>'+
      selected.members.map(row=>'<tr><td>'+esc(row.path)+(row.primary?'<small>Original source body</small>':'')+'</td><td>'+
        size(row.bytes)+'<small class="mono">'+esc(row.sha256)+'</small></td><td>'+
        download(sourceReportMemberURL(currentWorkspace,selected,row.path),'Download')+'</td></tr>').join('')+
      '</tbody></table></div></details>';
    const chosen=selected.html.some(row=>row.path===selectedMember)?selectedMember:
      selected.html.find(row=>row.path===body?.path)?.path||selected.html[0].path;
    openDocument(chosen);
  }
  function openDocument(path){
    if(!selected?.html.some(row=>row.path===path))throw Error('Choose a retained HTML report from this source entry.');
    selectedMember=path;
    const target=panel.querySelector('[data-source-report-detail]');
    target.querySelector('[data-source-report-document]').value=path;
    target.querySelector('iframe').src=sourceReportMemberURL(currentWorkspace,selected,path);
  }
  async function open(key){
    const row=reports.find(item=>rowKey(item)===key);
    if(!row)throw Error('Choose a retained report from this Workspace.');
    if(selected&&rowKey(selected)===key){panel.querySelector('[data-source-report-detail]').scrollIntoView({block:'start'});return;}
    const workspace=host.getWorkspace(),ticket=generation,detailTicket=++detailGeneration;
    showError({message:'Opening retained report…'});
    const value=await request('/api/source-reports/detail',{collection_id:row.collection_id,entry_key:row.entry_key});
    if(!valid(workspace,ticket)||detailTicket!==detailGeneration)return;
    if(value.workspace_key!==workspace||rowKey(value.report)!==key)throw Error('The returned report differs from the selected source.');
    selected=value.report;selectedMember=null;renderDetail();renderCatalog();
    panel.querySelector('[data-source-report-detail]').scrollIntoView({block:'start'});
  }
  async function archive(button){
    if(!selected)return;
    const workspace=host.getWorkspace(),key=rowKey(selected),ticket=generation,detailTicket=detailGeneration;
    button.disabled=true;
    const status=panel.querySelector('[data-source-report-archive-status]');
    status.textContent='Preparing the report and its complete original source edition…';
    try{
      const result=await host.api(host.endpoint('/api/source-reports/archive'),{method:'POST',
        body:{collection_id:selected.collection_id,entry_key:selected.entry_key}});
      if(!valid(workspace,ticket)||detailTicket!==detailGeneration||!selected||rowKey(selected)!==key)return;
      if(result.workspace_key!==workspace||result.source_id!==selected.source_id)throw Error('The portable report belongs to another selection.');
      status.innerHTML=download(result.download.url,'Download complete report ZIP')+' · '+size(result.download.bytes)+
        ' · import manifest: <span class="mono">'+esc(result.manifest_member)+'</span>'+
        '<small class="mono">SHA256 '+esc(result.download.sha256)+'</small>';
      const link=status.querySelector('a');link.click();
    }catch(error){if(valid(workspace,ticket))status.textContent=error.message||String(error);}
    finally{if(button.isConnected)button.disabled=false;}
  }
  async function dispatch(button){
    const action=button.dataset.sourceReportAction;
    if(action==='import')return host.openSourceImport({mode:'archive',manifestMember:'sources.json'});
    if(action==='regional')return host.navigate('watershed-context');
    if(action==='open')return open(button.dataset.reportKey);
    if(action==='close'){detailGeneration++;clearSelection();renderCatalog();return;}
    if(action==='edition'&&selected)return host.openItem('sources',selected.collection_id);
    if(action==='archive')return archive(button);
  }
  async function mount(content){
    const workspace=host.getWorkspace();
    if(currentWorkspace!==workspace){reset();currentWorkspace=workspace;}
    active=true;ensurePanel(content);renderRegional();await catalog();
  }
  function detach(){active=false;if(panel)panel.hidden=true;}
  function reset(){
    generation++;detailGeneration++;loading=null;currentCatalogKey=null;reports=[];selected=null;selectedMember=null;query='';catalogError=null;
    if(panel){panel.remove();panel=null;}currentWorkspace=null;active=false;
  }
  function focus(){if(panel&&active){panel.scrollIntoView({block:'start'});panel.querySelector('[data-source-report-search]').focus();}}
  return {mount,detach,reset,focus};
}
