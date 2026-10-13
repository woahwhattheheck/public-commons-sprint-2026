import {attachScientificReportEditions} from './source_report_editions.mjs';
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
  const scientific=attachScientificReportEditions(host);
  let panel=null,currentWorkspace=null,currentCatalogKey=null,reports=[],editions=[],discoveryIssues=[],selected=null,selectedMember=null;
  let generation=0,detailGeneration=0,active=false,loading=null,query='',catalogError=null;
  let retainedEditions=[],editionGeneration=0;
  const editionDownloads=new Map();
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
        '<p>Preview an available source edition, or open a retained report with its original files.</p></div>'+
        '<div class="inline-actions"><button type="button" data-source-report-action="refresh">Refresh available editions</button>'+
        '<button type="button" data-source-report-action="import">Import report ZIP</button>'+
        '<button type="button" data-source-report-action="regional" hidden>Open Regional watersheds</button>'+
        '<button type="button" data-source-report-action="stations" hidden>Open Station geography</button></div></div>'+
        '<p class="source-reports-regional" hidden></p>'+
        '<label class="source-reports-search">Find a source edition or report<input type="search" data-source-report-search placeholder="Title, source ID, edition or report type"></label>'+
        '<div data-source-report-status role="status"></div><div data-source-report-editions></div><div data-source-retained-editions></div><div data-source-report-catalog></div>'+
        '<section data-source-report-detail hidden aria-label="Selected retained report"></section><div data-scientific-reports></div>';
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
    panel.querySelector('[data-source-report-action="stations"]').hidden=!host.hasView('station-geography');
    const enabled=host.hasView('watershed-context'),button=panel.querySelector('[data-source-report-action="regional"]');
    button.hidden=!enabled;
    const reports=host.getState()?.data?.watershed_context_reports||[];
    const text=panel.querySelector('.source-reports-regional');
    text.hidden=!enabled;
    text.textContent=reports.length
      ?reports.length.toLocaleString()+' saved regional report'+(reports.length===1?'':'s')+' available in the original Regional watersheds desk. Open it to inspect programme context, native network selections and saved regional views.'
      :'Regional watersheds uses the retained regional source edition and its native network. Open the desk to select original sources or reopen an analysis.';
  }
  function renderEditions(){
    const words=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const visible=editions.filter(row=>{
      const text=[row.title,row.manifest_name,row.origin,...row.source_ids,...row.vintages,
        ...row.reports.flatMap(report=>[report.title,report.source_id,report.role]),
        ...(row.documents||[]).flatMap(document=>[document.title,document.source_id,document.role,document.path])].join(' ').toLocaleLowerCase();
      return words.every(word=>text.includes(word));
    });
    panel.querySelector('[data-source-report-editions]').innerHTML=
      '<section class="source-report-editions" aria-label="Available source editions"><h3>Available source editions</h3>'+
      '<p>Preview original source metadata, then import the chosen edition into this Workspace. Retained HTML previews appear below. Original scientific documents can be added to the ordered report after import.</p>'+
      (visible.length?'<div class="table-scroll"><table><thead><tr><th>Source edition</th><th>Original contents</th><th>Workspace status</th><th></th></tr></thead><tbody>'+
      visible.map(row=>{
        const retained=row.retained_collections||[],linked=row.retained_reports||[];
        const previewIDs=new Set(row.reports.map(report=>report.source_id));
        const documents=(row.documents||[]).filter(document=>!previewIDs.has(document.source_id));
        const scientific=row.retained_scientific_sources||[];
        const status=retained.length?'Retained in this Workspace':row.ready?'Ready to preview':'Source files need attention';
        const actions=linked.length?linked.map(report=>'<button type="button" data-source-report-action="open" data-report-key="'+
          esc(rowKey(report))+'">Open '+esc(report.title)+'</button>').join(''):
          retained.length?'<button type="button" data-source-report-action="retained-edition" data-collection-id="'+esc(retained[0].id)+'">Inspect retained edition</button>':'';
        const scientificActions=retained.filter(collection=>scientific.some(source=>source.source_collection_id===collection.id))
          .map(collection=>'<button type="button" data-source-report-action="edition-scientific" data-collection-id="'+
            esc(collection.id)+'" data-manifest-sha="'+esc(row.manifest_sha256)+'">Add source studies to report</button>').join('');
        return '<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(row.vintages.join(' · '))+'</small><small>'+
          esc(row.origin)+' · '+esc(row.manifest_name)+'</small></td><td>'+row.entry_count.toLocaleString()+
          ' original sources · '+row.member_count.toLocaleString()+' files'+
          (row.reports.length?'<ul>'+row.reports.map(report=>'<li>'+esc(report.title)+'<small>'+esc(report.vintage)+
            ' · '+esc(labels[report.role]||report.role||report.kind)+'</small></li>').join('')+'</ul>':'')+
          (documents.length?'<ul>'+documents.map(document=>'<li>'+esc(document.title)+'<small>'+esc(document.vintage)+
            ' · '+esc(document.scientific_report?'Scientific report source':document.role||document.kind)+
            '</small><small>'+esc(document.source_id)+'</small></li>').join('')+'</ul>':'')+
          (row.regional_context?'<small>Regional watershed source context</small>':'')+'</td><td>'+esc(status)+
          (row.problems.length?'<details><summary>'+row.problems.length+' source file issue'+(row.problems.length===1?'':'s')+
            '</summary><ul>'+row.problems.map(item=>'<li><span class="mono">'+esc(item.member)+'</span>: '+esc(item.reason)+'</li>').join('')+'</ul></details>':'')+
          '</td><td><div class="inline-actions">'+actions+scientificActions+
          (row.ready?'<button type="button" data-source-report-action="preview-edition" data-registered-id="'+esc(row.registered_id)+'">'+
            (retained.length?'Review import metadata':'Preview and import')+'</button>':'')+'</div></td></tr>';
      }).join('')+'</tbody></table></div>':'<p class="note">'+(editions.length?'No available edition matches this search.':
        'No bundled report edition is available here. Import a report ZIP, or register its original source manifest when starting this operator.')+'</p>')+
      (discoveryIssues.length?'<details><summary>Source discovery details</summary><ul>'+
        discoveryIssues.map(item=>'<li>'+esc(item.manifest)+': '+esc(item.reason)+'</li>').join('')+'</ul></details>':'')+'</section>';
  }
  function renderRetainedEditions(){
    if(!panel)return;
    const words=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const visible=retainedEditions.filter(row=>{
      const text=[row.title,row.collection_id,...row.documents.flatMap(doc=>[doc.title,doc.source_id,doc.role,doc.vintage])].join(' ').toLocaleLowerCase();
      return words.every(word=>text.includes(word));
    });
    panel.querySelector('[data-source-retained-editions]').innerHTML=
      '<section class="source-report-editions" aria-label="Retained source editions"><h3>Retained source editions</h3>'+
      '<p>Download the complete original edition, including every source and companion, then reopen it through the existing source import. These retained editions remain available without an installed publisher folder.</p>'+
      (visible.length?'<div class="table-scroll"><table><thead><tr><th>Original edition</th><th>Documents</th><th>Use or transfer</th></tr></thead><tbody>'+
        visible.map(row=>{
          const saved=editionDownloads.get(row.collection_id),busy=!!saved?.busy,result=saved?.result;
          return '<tr><td><strong>'+esc(row.title)+'</strong><small>'+row.entry_count.toLocaleString()+' original sources</small><small class="mono">'+
            esc(row.collection_id)+'</small></td><td><ul>'+row.documents.map(doc=>'<li>'+esc(doc.title)+'<small>'+esc(doc.vintage)+
              ' · '+esc(doc.scientific_report?'Scientific report source':doc.role||doc.kind)+'</small></li>').join('')+'</ul></td><td>'+
            '<div class="inline-actions"><button type="button" data-source-report-action="retained-edition" data-collection-id="'+esc(row.collection_id)+'">Inspect retained edition</button>'+
            ((row.scientific_sources||[]).length?'<button type="button" data-source-report-action="retained-scientific" data-collection-id="'+esc(row.collection_id)+'">Add source studies to report</button>':'')+
            '<button type="button" data-source-report-action="edition-archive" data-collection-id="'+esc(row.collection_id)+'"'+(busy?' disabled':'')+'>'+
            (busy?'Preparing source ZIP…':'Download complete source edition')+'</button></div>'+
            (saved?.error?'<p role="status">'+esc(saved.error)+'</p>':'')+
            (result?'<p><a data-source-edition-download="'+esc(row.collection_id)+'" href="'+esc(result.download.url)+'?download=1" download>Download complete source ZIP</a> · '+
              size(result.download.bytes)+'</p><details><summary>Original import identity</summary><p>Manifest member: <span class="mono">'+esc(result.manifest_member)+
              '</span></p><p>ZIP SHA256: <span class="mono">'+esc(result.download.sha256)+'</span></p><p>Original manifest SHA256: <span class="mono">'+
              esc(result.original_manifest_sha256)+'</span></p></details><button type="button" data-source-report-action="edition-reimport" data-collection-id="'+
              esc(row.collection_id)+'">Reimport downloaded edition</button>':'')+'</td></tr>';
        }).join('')+'</tbody></table></div>':'<p class="note">'+(retainedEditions.length?'No retained edition matches this search.':'Import an original source edition to retain its documents and complete source ZIP here.')+'</p>')+'</section>';
  }
  async function archiveEdition(button){
    const collectionId=button.dataset.collectionId,row=retainedEditions.find(value=>value.collection_id===collectionId);
    if(!row)throw Error('Choose an original retained source edition.');
    if(editionDownloads.get(collectionId)?.busy)return;
    const workspace=currentWorkspace,ticket=generation,turn=editionGeneration;
    const current=()=>active&&valid(workspace,ticket)&&turn===editionGeneration&&
      retainedEditions.some(value=>value.collection_id===collectionId&&value.original_manifest_sha256===row.original_manifest_sha256);
    const pendingDownload={busy:true};
    editionDownloads.set(collectionId,pendingDownload);renderRetainedEditions();
    try{
      const result=await host.api(host.endpoint('/api/source-reports/archive'),{method:'POST',body:{collection_id:collectionId}});
      if(!current())return;
      if(result.workspace_key!==workspace||result.collection_id!==collectionId||
          result.original_manifest_sha256!==row.original_manifest_sha256||
          !Array.isArray(result.source_ids)||result.source_ids.length!==row.entry_count||
          new Set(result.source_ids).size!==result.source_ids.length||
          !row.documents.every(doc=>result.source_ids.includes(doc.source_id))||
          typeof result.manifest_member!=='string'||!result.manifest_member||
          result.manifest_member==='.'||result.manifest_member==='..'||/[\/\\:\x00-\x1f\x7f]/.test(result.manifest_member)||
          !result.download||typeof result.download.url!=='string'||
          !Number.isInteger(result.download.bytes)||result.download.bytes<0||
          !/^[0-9a-f]{64}$/.test(result.download.sha256||''))
        throw Error('The returned source ZIP differs from the chosen original edition.');
      editionDownloads.set(collectionId,{busy:false,result});renderRetainedEditions();
      panel.querySelector('[data-source-edition-download="'+collectionId+'"]')?.click();
    }catch(reason){
      if(!current())return;
      editionDownloads.set(collectionId,{busy:false,error:reason.message||String(reason)});renderRetainedEditions();
    }finally{
      if(editionDownloads.get(collectionId)===pendingDownload){
        editionDownloads.delete(collectionId);
        if(active&&valid(workspace,ticket)&&turn===editionGeneration)renderRetainedEditions();
      }
    }
  }
  function renderCatalog(){
    if(!panel)return;
    renderEditions();renderRetainedEditions();
    const filtered=filterSourceReports(reports,query);
    panel.querySelector('[data-source-report-status]').textContent=catalogError||
      (loading?'Reading retained report metadata…':filtered.length+' of '+reports.length+' retained reports');
    panel.querySelector('[data-source-report-catalog]').innerHTML=filtered.length?
      '<div class="table-scroll"><table><thead><tr><th>Report / original source</th><th>Edition</th><th>Files</th><th></th></tr></thead><tbody>'+
      filtered.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(labels[row.role]||row.role||row.kind)+
        ' · '+esc(row.kind)+'</small><small>'+esc(row.source_id)+'</small>'+
        (descriptions[row.role]?'<p>'+esc(descriptions[row.role])+'</p>':'')+
        ((row.scientific_reports||[]).length?'<small>Source-bound interpretation available in scientific delivery</small>':'')+
        '</td><td>'+esc(row.vintage)+'<small>'+esc(row.collection_title)+'</small></td><td>'+
        row.member_count.toLocaleString()+'</td><td><button type="button" data-source-report-action="open" data-report-key="'+
        esc(rowKey(row))+'">'+(selected&&rowKey(selected)===rowKey(row)?'Return to report':'Open report')+'</button></td></tr>').join('')+
      '</tbody></table></div>':loading?'':'<p class="note">'+(reports.length?'No retained report matches this search.':
        'Preview an available edition above, or import a report ZIP. Reports can be primary documents or companions of an original scientific table.')+'</p>';
  }
  async function catalog(force=false){
    const workspace=host.getWorkspace();
    const key=JSON.stringify([workspace,(host.getState()?.data?.sources||[]).map(row=>row.id)]);
    if(!force&&key===currentCatalogKey)return;
    if(loading)return loading;
    const ticket=generation;
    loading=(async()=>{
      try{
        const value=await request('/api/source-reports/catalog',force?{refresh:'1'}:{});
        if(!valid(workspace,ticket))return;
        if(value.workspace_key!==workspace)throw Error('The report catalogue belongs to another Workspace.');
        reports=value.reports||[];editions=value.available_editions||[];retainedEditions=value.retained_editions||[];discoveryIssues=value.discovery_issues||[];currentCatalogKey=key;catalogError=null;
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
      ((selected.scientific_reports||[]).length?'<section class="source-report-editions"><h3>Include this interpretation in the client report</h3>'+
        '<p>Prepare these original studies as a saved scientific report, or include them in the selected model delivery.</p><ul>'+
        selected.scientific_reports.map(row=>'<li><strong>'+esc(row.title)+'</strong> · '+esc(row.vintage)+
          '<small>'+esc(row.source_id)+'</small></li>').join('')+'</ul>'+
        '<div class="inline-actions"><button type="button" data-source-report-action="scientific">Prepare scientific report</button>'+
        '<button type="button" data-source-report-action="deliveries">Open Maps and delivery</button></div></section>':'')+
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
    if(action==='refresh')return catalog(true);
    if(action==='preview-edition'){
      const row=editions.find(item=>item.registered_id===button.dataset.registeredId);
      if(!row?.ready)throw Error('Refresh and choose an available original source edition.');
      return host.openSourceImport({mode:'registered',registeredId:row.registered_id,
        registeredManifest:{id:row.registered_id,title:row.title,entries:row.entry_count}});
    }
    if(action==='edition-scientific'){
      const workspace=currentWorkspace,ticket=generation,collectionId=button.dataset.collectionId;
      const row=editions.find(item=>item.manifest_sha256===button.dataset.manifestSha&&
        (item.retained_collections||[]).some(collection=>collection.id===collectionId));
      const sources=(row?.retained_scientific_sources||[]).filter(source=>source.source_collection_id===collectionId);
      if(!row||!sources.length||!valid(workspace,ticket))
        throw Error('Refresh and choose an original retained scientific source edition.');
      return scientific.openForSources({workspace_key:workspace,sources,title:row.title,selection_mode:'append'});
    }
    if(action==='retained-edition')return host.openItem('sources',button.dataset.collectionId);
    if(action==='edition-archive')return archiveEdition(button);
    if(action==='edition-reimport'){
      const row=retainedEditions.find(value=>value.collection_id===button.dataset.collectionId);
      const result=editionDownloads.get(button.dataset.collectionId)?.result;
      if(!row||!result||result.original_manifest_sha256!==row.original_manifest_sha256)
        throw Error('Download and inspect the original source edition before reimporting it.');
      return host.openSourceImport({mode:'archive',manifestMember:result.manifest_member});
    }
    if(action==='retained-scientific'){
      const row=retainedEditions.find(value=>value.collection_id===button.dataset.collectionId);
      if(!row?.scientific_sources?.length)throw Error('Choose an original retained scientific source edition.');
      return scientific.openForSources({workspace_key:currentWorkspace,sources:row.scientific_sources,title:row.title,selection_mode:'append'});
    }
    if(action==='import')return host.openSourceImport({mode:'archive',manifestMember:'sources.json'});
    if(action==='regional')return host.navigate('watershed-context');
    if(action==='stations')return host.navigate('station-geography');
    if(action==='deliveries')return host.navigate('deliveries');
    if(action==='scientific'&&selected)return scientific.openForSources({workspace_key:currentWorkspace,sources:selected.scientific_reports,title:selected.title});
    if(action==='open')return open(button.dataset.reportKey);
    if(action==='close'){detailGeneration++;clearSelection();renderCatalog();return;}
    if(action==='edition'&&selected)return host.openItem('sources',selected.collection_id);
    if(action==='archive')return archive(button);
  }
  async function mount(content){
    const workspace=host.getWorkspace();
    if(currentWorkspace!==workspace){reset();currentWorkspace=workspace;}
    active=true;ensurePanel(content);renderRegional();
    await Promise.all([catalog(),scientific.mount(panel.querySelector('[data-scientific-reports]'))]);
  }
  function detach(){
    active=false;editionGeneration++;
    for(const [key,value] of editionDownloads)if(value.busy)editionDownloads.delete(key);
    scientific.detach();if(panel)panel.hidden=true;
  }
  function reset(){
    scientific.reset();
    generation++;detailGeneration++;editionGeneration++;editionDownloads.clear();retainedEditions=[];
    loading=null;currentCatalogKey=null;reports=[];editions=[];discoveryIssues=[];selected=null;selectedMember=null;query='';catalogError=null;
    if(panel){panel.remove();panel=null;}currentWorkspace=null;active=false;
  }
  function focus(){if(panel&&active){panel.scrollIntoView({block:'start'});panel.querySelector('[data-source-report-search]').focus();}}
  async function openForSources(value,content){
    if(value?.workspace_key!==host.getWorkspace())
      throw Error('Choose prepared sources from the current Workspace.');
    if(!active||!panel||currentWorkspace!==host.getWorkspace())await mount(content);
    return scientific.openForSources(value);
  }
  async function openForStudy(value,content){
    if(!value||value.workspace_key!==host.getWorkspace())
      throw Error('Open the saved scientific report in its receiving Workspace.');
    const navigationCurrent=()=>typeof value.isCurrent!=='function'||value.isCurrent();
    if(!navigationCurrent())return;
    const workspace=host.getWorkspace();
    if(currentWorkspace!==workspace){reset();currentWorkspace=workspace;}
    const ticket=generation;
    active=true;ensurePanel(content);renderRegional();renderCatalog();
    const current=()=>active&&valid(workspace,ticket)&&navigationCurrent();
    try{
      // A known edition opens independently of source discovery or a catalogue outage.
      await scientific.mount(panel.querySelector('[data-scientific-reports]'),{loadCatalog:false});
      if(!current())return;
      return await scientific.openForStudy({...value,isCurrent:current});
    }catch(error){if(!current())return;throw error;}
  }
  return {mount,detach,reset,focus,openForSources,openForStudy};
}
