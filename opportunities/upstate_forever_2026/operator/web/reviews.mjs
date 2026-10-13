/* Customer review workflow over the original retained review and task APIs. */
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => value ? String(value).slice(0,12) : '—';
const human = value => String(value ?? '').replaceAll('_',' ').replaceAll('-',' ');
const date = value => value ? new Date(value).toLocaleString() : '—';
const pretty = value => JSON.stringify(value,null,2);
const safeURL = value => /^https?:\/\//i.test(value ?? '') ? value : null;
const link = value => safeURL(value) ? '<a target="_blank" rel="noopener noreferrer" href="'+esc(value)+'">'+esc(value)+'</a>' : esc(value);
const button = (action,label,id='',extra='',primary=false) => '<button type="button" data-action="review-'+action+'"'+(id?' data-id="'+esc(id)+'"':'')+' '+extra+' class="'+(primary?'primary':'small')+'">'+esc(label)+'</button>';
const badge = value => '<span class="review-status">'+esc(human(value))+'</span>';
const table = (headers,rows) => '<div class="table-scroll"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const field = (name,label,value='',{type='text',required=false,wide=false,rows=3,note='',maximum=null}={}) => '<label class="'+(wide?'full':'')+'"><span>'+esc(label)+'</span>'+(type==='textarea'?'<textarea name="'+name+'" rows="'+rows+'"'+(maximum!==null?' maxlength="'+maximum+'"':'')+(required?' required':'')+'>'+esc(value)+'</textarea>':'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'"'+(maximum!==null?' maxlength="'+maximum+'"':'')+(required?' required':'')+'>')+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const val = name => $('#operation-form [name="'+name+'"]')?.value ?? '';
const checkValues = name => $$('#operation-form [name="'+name+'"]:checked').map(x=>x.value);
const notes = value => String(value).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const outcome = records => {
  if(!records.length)return null;
  const predecessors=new Set(records.map(x=>x.previous_response_id).filter(Boolean));
  return records.find(x=>!predecessors.has(x.id)) ?? null;
};

export function attachCustomerReviews({getState,api,endpoint,openForm,submitAction,detail,fileList,uploadFile,showTask,toast,closeForm}){
  let mounted=null,query='',filter='all',activePacket=null,activeTab='files',generation=0;
  const current = () => getState()?.workspace_key;
  const rows = () => getState()?.data.customer_reviews ?? [];
  const responses = id => (getState()?.data.customer_review_responses ?? []).filter(x=>x.review_id===id);
  const selected = id => rows().find(x=>x.id===id);
  const sourceTitle = (kind,id) => {
    const row=(getState()?.data[kind]??[]).find(x=>x.id===id);
    return row?.title||row?.selection?.title||short(id);
  };
  async function read(operation,params={}){
    const workspace=current(),result=await api(endpoint('/api/reviews/'+operation,params));
    if(current()!==workspace)throw Error('The workspace changed. Reopen the review in the selected workspace.');
    return result;
  }
  function inventoryRows(){
    const list=rows().map(row=>({row,latest:outcome(responses(row.id))})).filter(({row,latest})=>
      (filter==='all'||(latest?.response.disposition??'in-review')===filter)&&
      (!query||[row.title,row.purpose,row.id,latest?.response.reviewer.name].join(' ').toLowerCase().includes(query.toLowerCase()))
    ).sort((a,b)=>String(b.row.created_at).localeCompare(String(a.row.created_at))||b.row.id.localeCompare(a.row.id));
    if(mounted)$('#review-result-count',mounted)?.replaceChildren(document.createTextNode(list.length+' retained review'+(list.length===1?'':'s')));
    return list.map(({row,latest})=>'<tr><td class="name-cell"><strong>'+esc(row.title)+'</strong><small>'+esc(row.purpose)+'</small><small>'+esc(date(row.created_at))+' · <span class="mono">'+esc(short(row.id))+'</span></small></td><td>'+badge(latest?.response.disposition??'in-review')+(latest?'<small>'+esc(latest.response.reviewer.name)+' · '+esc(date(latest.imported_at))+'</small>':'<small>Awaiting a retained response</small>')+'</td><td>'+row.artifacts.length+' files<br>'+row.requirements.length+' requirements</td><td>'+responses(row.id).length+'</td><td class="actions-cell">'+button('open','Open',row.id)+button('new','New selection',row.id)+'</td></tr>');
  }
  function render(){
    const all=rows(),latest=all.map(x=>outcome(responses(x.id)));
    return '<header class="page-header"><div><p class="eyebrow">SCIENTIFIC DELIVERY REVIEW</p><h1>Customer reviews</h1><p>Select original source editions, completed saved maps, model runs and deliveries. Retain decisions for the stated purpose and carry their complete files into a portable review desk.</p></div><div class="page-actions">'+button('new','Create review','','',true)+button('compare','Compare selections')+'</div></header>'+
      '<div class="cards">'+[
        ['Retained selections',all.length,'Each selection keeps its original files and purpose.'],
        ['Responses received',all.reduce((n,x)=>n+responses(x.id).length,0),'Complete decisions and correction history.'],
        ['Changes requested',latest.filter(x=>x?.response.disposition==='changes-requested').length,'Review the requested changes and assignments.'],
        ['Ready for purpose',latest.filter(x=>x?.response.disposition==='ready-for-purpose').length,'Acceptance applies to the stated selection and purpose.'],
      ].map(x=>'<div class="card"><h3>'+x[0]+'</h3><strong class="number">'+x[1]+'</strong><p>'+x[2]+'</p></div>').join('')+'</div>'+
      '<section class="section customer-reviews"><header class="section-header"><div><h2>Retained reviews</h2><p id="review-result-count">'+all.length+' retained reviews</p></div></header><div class="review-filters"><label><span>Find a review</span><input type="search" id="review-search" value="'+esc(query)+'" placeholder="Title, purpose, reviewer or ID"></label><label><span>Disposition</span><select id="review-filter">'+[['all','All reviews'],['in-review','In review'],['changes-requested','Changes requested'],['ready-for-purpose','Ready for purpose']].map(([v,t])=>'<option value="'+v+'"'+(filter===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label></div>'+
      (all.length?table(['Selection and purpose','Latest response','Coverage','Responses',''],inventoryRows()).replace('<tbody>','<tbody id="review-inventory-body">'):'<div class="empty"><h2>Review the retained work</h2><p>Start with a source edition, or select completed saved maps, model runs and deliveries. The issuer profile supplies all 33 page-linked requirements for the seven-map project.</p>'+button('new','Create review','','',true)+'</div>')+
      '</section>';
  }
  function mount(root){
    mounted=root;
    $('#review-search',root)?.addEventListener('input',event=>{query=event.target.value;const body=$('#review-inventory-body',root);if(body)body.innerHTML=inventoryRows().join('');});
    $('#review-filter',root)?.addEventListener('change',event=>{filter=event.target.value;const body=$('#review-inventory-body',root);if(body)body.innerHTML=inventoryRows().join('');});
  }
  function detach(){mounted=null;generation++;}
  function choices(name,title,list,chosen){
    return '<fieldset class="review-choices"><legend>'+esc(title)+'</legend>'+(list.length?list.map(row=>'<label class="check"><input type="checkbox" name="'+name+'" value="'+esc(row.id)+'"'+(chosen.includes(row.id)?' checked':'')+'><span><strong>'+esc(row.title)+'</strong><small>'+esc(date(row.created_at))+' · '+esc(short(row.id))+(name==='source_collection_ids'?' · '+row.entries+' original entries':'')+'</small></span></label>').join(''):'<p class="note">No '+esc(title.toLowerCase())+' are retained in this workspace.</p>')+'</fieldset>';
  }

  function mapChoices(list,chosen=[]){
    return '<fieldset class="review-choices review-saved-maps"><legend>Completed saved maps</legend><p class="note">Select a retained map pack to review its PDF, SVG, PNG, annotations and original source context.</p>'+
      (list.length?list.map(row=>'<article class="review-map-choice" data-map-export="'+esc(row.id)+'"><label class="check"><input type="checkbox" name="spatial_export_ids" value="'+esc(row.id)+'"'+(chosen.includes(row.id)?' checked':'')+'><span><strong>'+esc(row.title)+'</strong><small>'+esc(date(row.created_at))+' · '+esc(short(row.id))+'</small><small>'+esc([row.selection?.paper?.toUpperCase(),row.selection?.dpi?row.selection.dpi+' dpi':'',row.files+' retained output files'].filter(Boolean).join(' · '))+'</small></span></label>'+
        '<details><summary>Inspect map and original files</summary><div class="review-map-preview"><p class="note">Open the retained image and file inventory while keeping this selection.</p>'+button('map-preview','Load original map',row.id)+'</div></details></article>').join(''):'<p class="note">Complete a saved map export in Spatial review to select it here.</p>')+'</fieldset>';
  }
  function mapActions(record){
    if(record?.state!=='complete'||!record.id)return '';
    return '<div class="page-actions">'+button('new','Create customer review','','data-export-id="'+esc(record.id)+'"',true)+'</div>';
  }
  async function previewMap(node){
    const row=node.closest('[data-map-export]'),target=row?.querySelector('.review-map-preview');
    if(!target)return;
    const id=node.dataset.id,workspace=current();
    node.disabled=true;
    try{
      const record=await read('spatial-export',{export_id:id});
      if(workspace!==current()||!target.isConnected)return;
      const originalFile=role=>{
        const descriptor=record.files?.[role];
        return descriptor?(record._downloads??[]).find(file=>file.sha256===descriptor.sha256&&file.bytes===descriptor.bytes):null;
      };
      const image=originalFile('map_png'),pdf=originalFile('map_pdf'),svg=originalFile('map_svg'),pack=originalFile('bundle');
      const links=[[pdf,'Open original PDF',false],[svg,'Download original SVG',true],[pack,'Download complete map pack',true]].filter(([file])=>file)
        .map(([file,label,download])=>'<a class="button" target="_blank" rel="noopener" href="'+esc(file.url)+(download?'?download=1':'')+'">'+esc(label)+'</a>').join('');
      const summary=record.summary??{};
      target.innerHTML='<p><strong>'+esc(record.title)+'</strong></p>'+
        '<p class="note">'+esc([record.selection?.paper?.toUpperCase(),record.selection?.dpi?record.selection.dpi+' dpi':'',summary.mode,summary.view?.crs].filter(Boolean).join(' · '))+'</p>'+
        (image?'<img src="'+esc(image.url)+'" alt="'+esc(record.title)+' — original saved map" loading="lazy">':'')+
        '<div class="page-actions">'+links+'</div>'+
        '<details><summary>Complete retained output files</summary>'+table(['Original file','Bytes',''],(record._downloads??[]).map(file=>'<tr><td>'+esc(file.label||file.filename)+'<small>'+esc(file.filename)+'</small><details><summary>File identity</summary><p class="mono">'+esc(file.sha256)+'</p></details></td><td>'+Number(file.bytes).toLocaleString()+'</td><td><a href="'+esc(file.url)+'?download=1" download>Download</a></td></tr>'))+'</details>'+
        '<details><summary>Original extent, annotations and source summary</summary><pre class="json-view">'+esc(pretty(summary))+'</pre></details>';
    }catch(error){
      if(target.isConnected){node.disabled=false;toast(error.message||String(error),'error');}
    }
  }
  function savedMapCoverage(packet){
    const maps=packet.review.selections.filter(row=>row.kind==='spatial-exports');
    if(!maps.length)return '';
    return '<section class="review-map-coverage"><h3>Selected saved maps</h3>'+maps.map(row=>{
      const source=row.source??{},count=packet.review.artifacts.filter(item=>item.selection_kind==='spatial-exports'&&item.selection_id===row.id).length;
      return '<p><strong>'+esc(row.title)+'</strong> · '+count+' original files</p><p class="note">'+esc([source.selection?.paper?.toUpperCase(),source.selection?.dpi?source.selection.dpi+' dpi':'','Saved view '+short(source.review_id)].filter(Boolean).join(' · '))+'</p>';
    }).join('')+'<p class="note">Each map keeps its original extent, legend, annotations, source descriptions and renderer record. The files and their decisions travel with this review.</p></section>';
  }

  function requirementRow(item={}){
    return '<article class="review-requirement-editor" data-review-requirement><div class="review-requirement-heading"><label><span>ID</span><input data-requirement-id value="'+esc(item.id??'')+'" required pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{0,79}" maxlength="80"></label><label><span>Requirement</span><input data-requirement-title value="'+esc(item.title??'')+'" required maxlength="500"></label>'+button('requirement-remove','Remove')+'</div><label><span>Source and acceptance detail</span><textarea data-requirement-detail rows="3" maxlength="20000">'+esc(item.detail??'')+'</textarea></label></article>';
  }
  function requirementValues(){
    return $$('[data-review-requirement]',$('#operation-form')).map(row=>({
      id:$('[data-requirement-id]',row).value.trim(),title:$('[data-requirement-title]',row).value.trim(),
      detail:$('[data-requirement-detail]',row).value,
    }));
  }
  async function newReview(id,exportId=null){
    const requestedWorkspace=current(),catalogue=await read('catalog');
    const original=id?(await read('review',{review_id:id})).review:null;
    if(requestedWorkspace!==current())throw Error('Reopen the form in the selected workspace.');
    const selection=original?.selection??{source_collection_ids:[],run_ids:[],delivery_ids:[],spatial_export_ids:[],requirements:[],notes:[]};
    const maps=catalogue.spatial_exports??[],chosenMaps=exportId?[exportId]:(selection.spatial_export_ids??[]);
    if(chosenMaps.some(key=>!maps.some(row=>row.id===key)))throw Error('Reopen the completed map export in this workspace before selecting it for review.');
    const title=original?original.title+' — revised selection':'';
    const single=!exportId&&catalogue.sources.length===1?[catalogue.sources[0].id]:[];
    openForm(original?'Create a revised review selection':'Create customer review',
      'Choose retained originals and the purpose of this review. A saved selection keeps its own files and response history.',
      '<div class="form-grid">'+field('review_title','Review title',title,{required:true,wide:true,maximum:300})+
      field('review_purpose','Purpose',original?.purpose??'',{type:'textarea',required:true,wide:true,rows:3,maximum:20000,note:'Describe the decision this selected work should support.'})+'</div>'+
      '<div class="review-choice-grid">'+choices('source_collection_ids','Original source editions',catalogue.sources,original?selection.source_collection_ids:single)+
      choices('run_ids','Completed model runs',catalogue.runs,selection.run_ids)+
      choices('delivery_ids','Completed deliveries',catalogue.deliveries,selection.delivery_ids)+
      mapChoices(maps,chosenMaps)+'</div>'+
      '<section class="review-requirement-section"><header><div><h3>Requirements</h3><p>Retain the issuer’s source text and add the specific criteria for this selection.</p></div><div class="page-actions">'+
      (catalogue.issuer?button('issuer-load','Add issuer requirements'):'')+button('requirement-add','Add requirement')+'</div></header>'+
      '<p id="review-issuer-pin" class="note"></p><div id="review-requirement-editors">'+selection.requirements.map(requirementRow).join('')+'</div></section>'+
      '<div class="form-grid">'+field('review_notes','Notes',selection.notes.join('\n'),{type:'textarea',wide:true,rows:3,note:'One note per line. Notes are retained with the review selection.'})+'</div>',
      'Retain review',async()=>{
        const value={schema:'upstate.customer-review-selection/v1',title:val('review_title'),purpose:val('review_purpose'),
          source_collection_ids:checkValues('source_collection_ids'),run_ids:checkValues('run_ids'),delivery_ids:checkValues('delivery_ids'),
          spatial_export_ids:checkValues('spatial_export_ids'),
          requirements:requirementValues(),notes:notes(val('review_notes'))};
        if(!value.source_collection_ids.length&&!value.run_ids.length&&!value.delivery_ids.length&&!value.spatial_export_ids.length)throw Error('Select at least one original source edition, completed saved map, model run or delivery.');
        const ids=value.requirements.map(x=>x.id);
        if(new Set(ids).size!==ids.length)throw Error('Give every requirement its own ID.');
        await submitAction('customer.review.create',{selection:value});
      },()=>{
        $('#operation-form')._reviewIssuer=catalogue.issuer;
      });
  }
  function loadIssuer(){
    const issuer=$('#operation-form')._reviewIssuer;
    if(!issuer)return;
    const existing=new Set(requirementValues().map(x=>x.id));
    const missing=issuer.requirements.filter(x=>!existing.has(x.id));
    $('#review-requirement-editors').insertAdjacentHTML('beforeend',missing.map(requirementRow).join(''));
    const source='Issuer profile '+issuer.profile_id+'; '+issuer.filename+' SHA256 '+issuer.sha256;
    const area=$('#operation-form [name="review_notes"]');
    if(!notes(area.value).includes(source))area.value=[area.value.trim(),source].filter(Boolean).join('\n');
    $('#review-issuer-pin').textContent=issuer.requirements.length+' source-linked issuer requirements available; '+missing.length+' added to this selection.';
  }
  function responseCounts(response){
    const items=[...(response?.artifact_decisions??[]),...(response?.requirement_decisions??[])];
    return ['accepted','changes-requested','question','not-applicable','unreviewed'].map(key=>({key,count:items.filter(x=>x.decision===key).length}));
  }
  function currentResponse(packet){return packet.responses.at(-1)?.response??null;}
  function reviewToolbar(packet){
    const id=packet.review.id;
    return '<div class="page-actions">'+button('export','Export current review',id,'',true)+button('import','Receive response',id)+
      button('template','Response template',id)+button('new','New selection',id)+'</div>';
  }
  function summary(packet){
    const response=currentResponse(packet),review=packet.review;
    return '<div class="review-intro"><p class="review-purpose">'+esc(review.purpose)+'</p><div class="meta">'+badge(response?.disposition??'in-review')+
      '<span>'+review.artifacts.length+' files</span><span>'+review.requirements.length+' requirements</span><span>'+packet.responses.length+' responses</span></div>'+
      (response?'<p><strong>'+esc(response.reviewer.name)+'</strong>'+esc(response.reviewer.role?' · '+response.reviewer.role:'')+' · '+esc(date(response.created_at))+'</p><p>'+esc(response.summary)+'</p>':'<p class="note">Export this selected work to begin a review, then receive its complete response.</p>')+
      (review.notes.length?'<details><summary>Selection notes</summary><ul>'+review.notes.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details>':'')+savedMapCoverage(packet)+'</div>';
  }
  function decisionText(value){
    if(!value)return '<span class="note">Unreviewed</span>';
    return badge(value.decision)+(value.comment?'<p>'+esc(value.comment)+'</p>':'')+(value.requested_change?'<p><strong>Requested change:</strong> '+esc(value.requested_change)+'</p>':'')+(value.assignee?'<small>Assigned to '+esc(value.assignee)+'</small>':'');
  }
  function fileTab(packet){
    const response=currentResponse(packet),decisions=new Map((response?.artifact_decisions??[]).map(x=>[x.artifact_id,x]));
    const downloads=new Map(packet._downloads.map(x=>[x.artifact_id,x]));
    return '<p class="note">These are the complete original files selected for this review. Their source attribution and native companion relationships stay in every export.</p>'+
      table(['Original file','Source and selection','Latest decision',''],packet.review.artifacts.map(item=>{
        const file=downloads.get(item.id),source=item.origin??{};
        return '<tr><td class="name-cell"><strong>'+esc(item.label)+'</strong><small>'+esc(item.original_path)+'</small><small>'+esc(item.media_type)+' · '+item.bytes.toLocaleString()+' bytes</small></td><td><strong>'+esc(item.group)+'</strong>'+
          (source.uri?'<small>'+link(source.uri)+'</small>':'')+(source.vintage?'<small>Vintage '+esc(source.vintage)+'</small>':'')+
          '<details><summary>File identity</summary><p class="mono">'+esc(item.sha256)+'</p><p>'+esc(item.description)+'</p></details></td><td>'+decisionText(decisions.get(item.id))+'</td><td><a href="'+esc(file.url)+'?download=1" download>Download</a></td></tr>';
      }));
  }
  function requirementsTab(packet){
    const response=currentResponse(packet),decisions=new Map((response?.requirement_decisions??[]).map(x=>[x.requirement_id,x]));
    return packet.review.requirements.length?table(['Requirement and source','Latest decision'],packet.review.requirements.map(item=>
      '<tr><td class="name-cell"><strong>'+esc(item.title)+'</strong><small class="mono">'+esc(item.id)+'</small><p class="review-source-detail">'+esc(item.detail)+'</p></td><td>'+decisionText(decisions.get(item.id))+'</td></tr>')):'<p class="note">No requirements were selected for this review. Create a revised selection to include additional criteria.</p>';
  }
  function correctionRows(packet,response){
    const artifacts=new Map(packet.review.artifacts.map(x=>[x.id,x.label])),requirements=new Map(packet.review.requirements.map(x=>[x.id,x.title]));
    return (response?.corrections??[]).map(item=>'<tr><td class="name-cell"><strong>'+esc(item.title)+'</strong><small>'+esc(item.id)+'</small><p>'+esc(item.description)+'</p><small>'+[...item.artifact_ids.map(x=>artifacts.get(x)||x),...item.requirement_ids.map(x=>requirements.get(x)||x)].map(esc).join(' · ')+'</small></td><td>'+badge(item.state)+'<small>'+esc(item.priority)+' priority</small></td><td>'+esc(item.assignee||'Unassigned')+'</td><td class="review-source-detail">'+esc(item.resolution||'—')+'</td></tr>');
  }
  function correctionsTab(packet){
    const response=currentResponse(packet),corrections=response?.corrections??[];
    return '<p class="note">Assignments and resolutions come from the latest retained response. Export the current desk to continue their history.</p>'+
      (corrections.length?table(['Correction and affected work','State','Assignee','Resolution'],correctionRows(packet,response)):'<div class="empty"><h3>No correction records in this response</h3><p>The original decisions remain available under Files and Requirements.</p></div>');
  }
  function historyTab(packet){
    if(!packet.responses.length)return '<p class="note">Receive a complete response to begin this review’s retained history.</p>';
    return table(['Received response','Disposition','Decisions','Corrections',''],packet.responses.map((record,index)=>{
      const response=record.response,counts=responseCounts(response).filter(x=>x.count).map(x=>x.count+' '+human(x.key)).join(' · ');
      return '<tr><td class="name-cell"><strong>Response '+(index+1)+' · '+esc(response.reviewer.name)+'</strong><small>'+esc([response.reviewer.role,response.reviewer.organization].filter(Boolean).join(' · '))+'</small><small>Created '+esc(date(response.created_at))+'</small><small>Received '+esc(date(record.imported_at))+'</small></td><td>'+badge(response.disposition)+'</td><td>'+esc(counts)+'</td><td>'+response.corrections.filter(x=>x.state==='open').length+' open / '+response.corrections.filter(x=>x.state==='resolved').length+' resolved</td><td>'+button('response','Inspect changes',record.id)+'</td></tr>';
    }));
  }
  function exportsTab(packet){
    return '<p class="note">Each export captures one exact response generation. Open its desk to inspect or continue that version, or download its complete folder.</p>'+
      (packet._exports.length?table(['Exported','Response generation','Files',''],packet._exports.map(row=>
        '<tr><td>'+esc(date(row.completed_at||row.created_at))+'<small class="mono">'+esc(short(row.package_sha256))+'</small></td><td>'+esc(row.latest_response_id?short(row.latest_response_id):'Initial review')+'</td><td>'+row.members+' files</td><td class="actions-cell"><a class="button" href="'+esc(row.desk_url)+'" target="_blank" rel="noopener">Open desk</a><button data-action="task-open" data-id="'+esc(row.task_id)+'" type="button">Download package</button></td></tr>')):'<div class="empty"><h3>Export this review</h3><p>The complete desk includes all selected original files and the current response history.</p>'+button('export','Export current review',packet.review.id,'',true)+'</div>');
  }
  function drawPacket(packet,tab='files'){
    activePacket=packet;activeTab=tab;
    const tabs=[['files','Files'],['requirements','Requirements'],['corrections','Corrections'],['history','Response history'],['exports','Exported desks']];
    const body=tab==='requirements'?requirementsTab(packet):tab==='corrections'?correctionsTab(packet):tab==='history'?historyTab(packet):tab==='exports'?exportsTab(packet):fileTab(packet);
    detail(packet.review.title,'<div class="customer-review-detail">'+summary(packet)+reviewToolbar(packet)+
      '<nav class="review-tabs" aria-label="Review sections">'+tabs.map(([key,title])=>button('tab',title,packet.review.id,'data-tab="'+key+'" aria-pressed="'+(tab===key)+'"')).join('')+'</nav><section>'+body+'</section>'+
      '<details class="technical"><summary>Complete review document</summary>'+fileList([packet._packet_download])+'<dl class="definition"><dt>Review</dt><dd class="mono">'+esc(packet.review.id)+'</dd><dt>Project</dt><dd class="mono">'+esc(packet.review.project.id)+'</dd></dl></details></div>',{kind:'customer-review',id:packet.review.id});
  }
  async function openReview(id,tab='files'){
    const serial=++generation,packet=await read('review',{review_id:id});
    if(serial!==generation)return;
    drawPacket(packet,tab);
  }
  async function exportReview(id){
    const packet=await read('review',{review_id:id});
    openForm('Export complete review desk',
      'Create a portable copy of this selection, its original files and this exact response history.',
      '<div class="review-intro"><h3>'+esc(packet.review.title)+'</h3><p>'+esc(packet.review.purpose)+'</p><p>'+packet.review.artifacts.length+' complete files · '+packet.review.requirements.length+' requirements · '+packet.responses.length+' retained responses</p><p>After export, open the desk here or download and extract its ZIP. Record decisions in the desk and export its response JSON for receiving.</p></div>',
      'Export review',()=>submitAction('customer.review.export',{review_id:id,expected_response_id:packet.latest_response_id}));
  }
  async function receiveResponse(id){
    const packet=await read('review',{review_id:id});
    let originalFile=null,documentValue=null;
    openForm('Receive review response',
      'Choose the complete response JSON exported by this review desk. The original predecessor and each selected decision are preserved.',
      '<div class="review-intro"><h3>'+esc(packet.review.title)+'</h3><p>'+esc(packet.review.purpose)+'</p></div><label class="review-file-picker"><span>Returned response JSON</span><input name="review_response_file" type="file" accept=".json,application/json" required></label><div id="review-response-preview" aria-live="polite"></div>',
      'Retain response',async()=>{
        const file=$('#operation-form [name="review_response_file"]').files[0];
        if(!file||file!==originalFile||!documentValue)throw Error('Choose and inspect the complete returned response.');
        if(documentValue.review_id!==id||documentValue.project_id!==packet.review.project.id)throw Error('This file belongs to a different review or project. Open the review named by the returned response.');
        const uploaded=await uploadFile(file);
        await submitAction('customer.review.response.import',{review_id:id,upload_id:uploaded.id});
      },()=>{
        $('#operation-form [name="review_response_file"]').addEventListener('change',async event=>{
          originalFile=null;documentValue=null;
          const preview=$('#review-response-preview'),file=event.target.files[0];
          if(!file){preview.textContent='';return;}
          try{
            if(file.size>32*1024*1024)throw Error('The original review response format permits at most 32 MiB.');
            const value=JSON.parse(await file.text());
            if(value.schema!=='upstate.customer-review-response/v1')throw Error('Choose the response JSON exported by the review desk.');
            if(event.target.files[0]!==file)return;
            originalFile=file;documentValue=value;
            const match=value.review_id===id&&value.project_id===packet.review.project.id;
            const predecessor=value.previous_response_id===packet.latest_response_id;
            const duplicate=packet.responses.some(x=>x.request_sha256&&pretty(x.response)===pretty(value));
            preview.innerHTML='<section class="section"><header class="section-header"><h3>Returned response</h3></header><div class="section-body">'+
              (!match?'<p class="notice error">This response belongs to a different review or project.</p>':!predecessor&&!duplicate?'<p class="notice">A newer response is retained. Inspect its history and reconcile this draft; the receiver will preserve the original response chain.</p>':'')+
              '<p><strong>'+esc(value.reviewer?.name??'Reviewer name missing')+'</strong> · '+esc(value.reviewer?.organization??'')+'</p><p>'+badge(value.disposition)+' · '+esc(date(value.created_at))+'</p><p>'+esc(value.summary??'')+'</p><p>'+(value.artifact_decisions?.length??0)+' artifact decisions · '+(value.requirement_decisions?.length??0)+' requirement decisions · '+(value.corrections?.length??0)+' corrections</p>'+
              '<details><summary>Complete returned document</summary><pre class="json-view">'+esc(pretty(value))+'</pre></details></div></section>';
          }catch(error){preview.textContent=error.message;}
        });
      });
  }
  function responseDiff(before,after,field,idField,names){
    const old=new Map((before?.[field]??[]).map(x=>[x[idField],x])),next=new Map((after[field]??[]).map(x=>[x[idField],x]));
    return [...new Set([...old.keys(),...next.keys()])].sort().filter(id=>pretty(old.get(id))!==pretty(next.get(id))).map(id=>
      '<tr><td class="name-cell">'+esc(names.get(id)||id)+'</td><td>'+decisionText(old.get(id))+'</td><td>'+decisionText(next.get(id))+'</td></tr>');
  }
  function inspectResponse(id){
    const packet=activePacket,index=packet?.responses.findIndex(x=>x.id===id)??-1;
    if(index<0)throw Error('Reopen the selected review to inspect its response history.');
    const record=packet.responses[index],before=packet.responses[index-1]?.response,response=record.response;
    const changes=[...responseDiff(before,response,'artifact_decisions','artifact_id',new Map(packet.review.artifacts.map(x=>[x.id,x.label]))),
      ...responseDiff(before,response,'requirement_decisions','requirement_id',new Map(packet.review.requirements.map(x=>[x.id,x.title])))];
    const download=packet._response_downloads.find(x=>x.response_id===id);
    detail('Response '+(index+1)+' · '+response.reviewer.name,
      '<div class="customer-review-detail"><div class="page-actions">'+button('open','Back to review',packet.review.id,'data-tab="history"')+'</div><p>'+badge(response.disposition)+' · '+esc(date(response.created_at))+'</p><p>'+esc(response.summary)+'</p>'+
      '<h3>Decision changes from '+(index?'the preceding response':'the initial review')+'</h3>'+
      (changes.length?table(['Selected work','Previous decision','This response'],changes):'<p>No decision fields changed.</p>')+
      '<h3>Corrections in this response</h3>'+(response.corrections.length?table(['Correction','State','Assignee','Resolution'],correctionRows(packet,response)):'<p>No correction records.</p>')+
      fileList(download?[download]:[])+'<details><summary>Complete original response</summary><pre class="json-view">'+esc(pretty(response))+'</pre></details></div>',
      {kind:'customer-review-response',id});
  }
  async function compareForm(){
    const catalogue=await read('catalog');
    if(catalogue.reviews.length<2)throw Error('Retain two review selections to compare their original files and requirements.');
    const options=catalogue.reviews.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.title)+' · '+esc(short(x.id))+'</option>').join('');
    openForm('Compare retained review selections','Compare the exact file editions, purpose, and requirement changes.',
      '<div class="form-grid"><label><span>Earlier selection</span><select name="review_before" required>'+options+'</select></label><label><span>Later selection</span><select name="review_after" required>'+options+'</select></label></div>',
      'Compare selections',async()=>{
        if(val('review_before')===val('review_after'))throw Error('Choose two different retained review selections.');
        const result=await read('compare',{before_id:val('review_before'),after_id:val('review_after')});
        closeForm();
        showComparison(result);
      },()=>{$('#operation-form [name="review_after"]').value=catalogue.reviews.at(-1).id;});
  }
  function showComparison(result){
    const changed=result.changed.map(row=>'<tr><td>'+esc(row.label)+'</td><td>Changed '+esc(row.changed_fields.join(', '))+'</td></tr>');
    const additions=result.added.map(row=>'<tr><td>'+esc(row.label)+'</td><td>Added</td></tr>'),removed=result.removed.map(row=>'<tr><td>'+esc(row.label)+'</td><td>Removed from this selection</td></tr>');
    const requirements=result.requirements;
    detail('Compare review selections','<div class="customer-review-detail"><div class="review-comparison-head"><div><h3>'+esc(result.before.title)+'</h3><p>'+esc(result.before.purpose)+'</p>'+button('open','Open earlier selection',result.before_review_id)+'</div><div><h3>'+esc(result.after.title)+'</h3><p>'+esc(result.after.purpose)+'</p>'+button('open','Open later selection',result.after_review_id)+'</div></div>'+
      '<p>'+result.changed.length+' changed files · '+result.added.length+' added · '+result.removed.length+' removed · '+result.unchanged.length+' unchanged</p>'+
      (result.purpose_changed?'<p class="notice">The stated review purpose changed.</p>':'')+
      '<h3>Original file changes</h3>'+(changed.length+additions.length+removed.length?table(['Original file','Selection change'],[...changed,...additions,...removed]):'<p>The original selected file identities are unchanged.</p>')+
      '<h3>Requirement changes</h3>'+table(['Requirement','Earlier detail','Later detail'],[
        ...requirements.changed.map(x=>'<tr><td>'+esc(x.after.title)+'<small>'+esc(x.after.id)+'</small></td><td class="review-source-detail">'+esc(x.before.detail)+'</td><td class="review-source-detail">'+esc(x.after.detail)+'</td></tr>'),
        ...requirements.added.map(x=>'<tr><td>'+esc(x.title)+'</td><td>—</td><td class="review-source-detail">'+esc(x.detail)+'</td></tr>'),
        ...requirements.removed.map(x=>'<tr><td>'+esc(x.title)+'</td><td class="review-source-detail">'+esc(x.detail)+'</td><td>—</td></tr>'),
      ])+fileList([result._download])+'</div>',{kind:'customer-review-comparison'});
  }
  async function template(id){
    const result=await read('template',{review_id:id});
    detail('Current review response template','<p>The complete template inherits current decisions and corrections, identifies its original predecessor, and leaves the next reviewer’s identity empty.</p>'+fileList([result._download])+'<details><summary>Complete response template</summary><pre class="json-view">'+esc(pretty(result.response))+'</pre></details>',{kind:'customer-review-template',id});
  }
  function taskActions(task){
    if(task.action==='spatial.review.export'&&task.state==='complete')return mapActions(task.result);
    if(!task._review)return '';
    const row=task._review;
    return '<div class="page-actions">'+button('open','Open retained review',row.review_id)+(row.desk_url?'<a class="button primary" href="'+esc(row.desk_url)+'" target="_blank" rel="noopener">Open review desk</a>':'')+'</div>';
  }
  async function dispatch(node){
    const action=node.dataset.action.slice(7),id=node.dataset.id;
    if(action==='new')return newReview(id,node.dataset.exportId||null);
    if(action==='map-preview')return previewMap(node);
    if(action==='open')return openReview(id,node.dataset.tab||'files');
    if(action==='tab'){
      if(!activePacket||activePacket.review.id!==id)return openReview(id,node.dataset.tab);
      return drawPacket(activePacket,node.dataset.tab);
    }
    if(action==='issuer-load')return loadIssuer();
    if(action==='requirement-add'){$('#review-requirement-editors').insertAdjacentHTML('beforeend',requirementRow());return;}
    if(action==='requirement-remove'){node.closest('[data-review-requirement]').remove();return;}
    if(action==='export')return exportReview(id);
    if(action==='import')return receiveResponse(id);
    if(action==='response')return inspectResponse(id);
    if(action==='compare')return compareForm();
    if(action==='template')return template(id);
  }
  return {render,mount,detach,dispatch,taskActions,openReview,mapActions};
}
