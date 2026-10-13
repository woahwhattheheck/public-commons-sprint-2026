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
  function rebuildExportControl(taskId,row){
    if(row.export_status!=='rebuild_from_retained_review'||!row.rebuild)return '';
    return '<p class="note">'+esc(row.export_message)+'</p>'+button('rebuild-export','Rebuild selected export',taskId);
  }
  function exportControls(row,label='Open desk'){
    if(row.export_status==='error')return '<p class="note">'+esc(row.export_message)+'</p>'+
      '<button data-action="task-open" data-id="'+esc(row.task_id)+'" type="button">Inspect export issue</button>';
    return rebuildExportControl(row.task_id,row)||
      ((row.desk_url?'<a class="button" href="'+esc(row.desk_url)+'" target="_blank" rel="noopener">'+esc(label)+'</a>':'')+
       '<button data-action="task-open" data-id="'+esc(row.task_id)+'" type="button">Download package</button>');
  }
  async function rebuildExport(taskId){
    const workspace=current(),serial=++generation;
    const task=await api(endpoint('/api/task',{id:taskId}));
    if(workspace!==current()||task.workspace!==workspace)throw Error('The workspace changed. Reopen the original exported review in its received project.');
    if(serial!==generation)return;
    const recovery=task._review?.rebuild;
    if(task._review?.export_status!=='rebuild_from_retained_review'||!recovery||
      !['customer.review.export','customer.review.handback.export'].includes(recovery.action))
      throw Error('Reopen this export task to inspect its current local package.');
    const action=recovery.action,payload=JSON.parse(JSON.stringify(recovery.payload)),engineering=action==='customer.review.handback.export';
    if(payload.source_export_task_id!==task.id||task.id!==taskId)throw Error('The selected export task changed. Reopen its retained detail.');
    const selected=engineering?'Engineering edition '+short(payload.handback_id):
      payload.expected_response_id?'Customer response '+short(payload.expected_response_id):'Initial review before customer responses';
    openForm('Rebuild the selected export',
      'Create this original review generation on the current computer from the restored project and its retained source files.',
      '<div class="review-intro"><h3>'+esc(selected)+'</h3><p>'+esc(task._review.export_message)+'</p>'+
      '<p>Later replies and engineering editions remain in their original history. This operation creates a new local package for the selection shown here.</p>'+
      '<details><summary>Original selection</summary><pre class="json-view">'+esc(pretty(payload))+'</pre></details></div>',
      'Rebuild selected export',()=>{
        if(workspace!==current())throw Error('The workspace changed. Reopen the export in its received project.');
        return submitAction(action,payload);
      });
  }

  function exportsTab(packet){
    return '<p class="note">Each export captures one exact response generation. Open its desk to inspect or continue that version, or download its complete folder.</p>'+
      (packet._exports.length?table(['Exported','Response generation','Files',''],packet._exports.map(row=>
        '<tr><td>'+esc(date(row.completed_at||row.created_at))+'<small class="mono">'+esc(short(row.package_sha256))+'</small></td><td>'+esc(row.latest_response_id?short(row.latest_response_id):'Initial review')+'</td><td>'+row.members+' files</td><td class="actions-cell">'+exportControls(row)+'</td></tr>')):'<div class="empty"><h3>Export this review</h3><p>The complete desk includes all selected original files and the current response history.</p>'+button('export','Export current review',packet.review.id,'',true)+'</div>');
  }

  // Engineering responses keep their own editions and never modify customer decisions.
  const handbackDrafts=new Map();
  function ensureHandbackWorkspace(workspace){
    if(workspace!==current())throw Error('The workspace changed. Reopen the engineering response in its original workspace.');
  }
  function handbacksTab(packet){
    const records=packet._handbacks??[];
    return '<p class="note">Assign the customer’s requested changes, identify the replacement work, and return a complete revised review with an engineering response. Customer decisions remain in their original response history.</p>'+
      '<div class="page-actions">'+(packet.responses.length?button('handback-new','Prepare engineering response',packet.review.id,'',true):'')+button('handback-import','Receive handback package',packet.review.id)+'</div>'+
      (records.length?table(['Engineering response','Customer response','Revised selection',''],records.map(row=>
        '<tr><td class="name-cell"><strong>'+esc(row.summary||'Engineering response')+'</strong>'+badge(row.state)+'<small>'+esc(row.prepared_by?.name||row.prepared_by||'')+' · '+esc(date(row.created_at))+'</small></td><td class="mono">'+esc(short(row.response_id))+'</td><td>'+esc(row.revised_title||row.revised?.title||short(row.revised_review_id))+'</td><td>'+button('handback-open','Open response',row.id)+'</td></tr>')):
        '<div class="empty"><h3>Respond to the requested changes</h3><p>'+(packet.responses.length?'Prepare a saved engineering response from one retained customer response. Assign work while planning, then select the actual revised files for handback.':'Receive a customer response before preparing its engineering response.')+'</p></div>');
  }
  function handbackOptions(rows,selectedId,emptyLabel){
    return '<option value="">'+esc(emptyLabel)+'</option>'+rows.map(row=>'<option value="'+esc(row.id||row.review_id)+'"'+((row.id||row.review_id)===selectedId?' selected':'')+'>'+esc(row.title||row.summary||short(row.id||row.review_id))+'</option>').join('');
  }
  function replacementChoices(kind,list,chosen){
    const known=new Set(list.map(row=>row.id)),all=[...list,...chosen.filter(id=>!known.has(id)).map(id=>({id,label:'Previous selection reference '+short(id),missing:true}))];
    if(!all.length)return '<p class="note">Choose a revised review to identify its '+(kind==='artifact'?'replacement files.':'requirements.')+'</p>';
    return '<div class="handback-replacements">'+all.map(row=>'<label class="check"><input type="checkbox" data-replacement="'+kind+'" value="'+esc(row.id)+'"'+(chosen.includes(row.id)?' checked':'')+'><span>'+esc(row.label||row.title||short(row.id))+(row.original_path?'<small>'+esc(row.original_path)+'</small>':'')+(row.missing?'<small>Outside the selected revised review. Clear this reference or restore its review before saving.</small>':'')+'</span></label>').join('')+'</div>';
  }
  function handbackItemEditor(request,item,revision){
    return '<article class="handback-item" data-handback-request="'+esc(request.id)+'"><header><h3>'+esc(request.title)+'</h3>'+badge(request.kind)+(request.priority?'<span class="note">'+esc(request.priority)+' priority</span>':'')+'</header>'+
      '<p class="review-source-detail">'+esc(request.description)+'</p><details><summary>Original request reference</summary><p>'+esc(request.source_id)+'</p></details>'+
      '<div class="form-grid"><label><span>Engineering disposition</span><select data-handback-disposition>'+[['planned','Planned'],['addressed','Addressed in revised work'],['deferred','Deferred with explanation']].map(([v,t])=>'<option value="'+v+'"'+(item.disposition===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label>'+
      '<label><span>Assigned engineer</span><input data-handback-owner maxlength="500" value="'+esc(item.owner)+'" placeholder="Person or team responsible"></label>'+
      '<label class="full"><span>Resolution or next work</span><textarea data-handback-note rows="3" maxlength="20000">'+esc(item.note)+'</textarea></label></div>'+
      '<details'+(item.disposition==='addressed'?' open':'')+'><summary>Replacement work in the revised review</summary><div class="review-choice-grid"><section><h4>Files</h4>'+replacementChoices('artifact',revision?.artifacts??[],item.replacement_artifact_ids??[])+'</section><section><h4>Requirements</h4>'+replacementChoices('requirement',revision?.requirements??[],item.replacement_requirement_ids??[])+'</section></div></details></article>';
  }
  function handbackValues(original){
    const form=$('#operation-form');
    if(!form)throw Error('Reopen the engineering response form.');
    return {...original,revised_review_id:val('handback_revision')||null,state:val('handback_state'),
      prepared_by:{name:val('handback_name').trim(),role:val('handback_role').trim(),organization:val('handback_organization').trim()},
      summary:val('handback_summary'),
      items:$$('[data-handback-request]',form).map(row=>({
        request_id:row.dataset.handbackRequest,disposition:$('[data-handback-disposition]',row).value,
        owner:$('[data-handback-owner]',row).value,note:$('[data-handback-note]',row).value,
        replacement_artifact_ids:$$('[data-replacement="artifact"]:checked',row).map(x=>x.value),
        replacement_requirement_ids:$$('[data-replacement="requirement"]:checked',row).map(x=>x.value),
      }))};
  }
  async function newHandback(reviewId,handbackId=null,responseId=null){
    const workspace=current(),formSerial=++generation,params={review_id:reviewId,...(handbackId?{handback_id:handbackId}:{}),...(responseId?{response_id:responseId}:{})};
    const [source,packet]=await Promise.all([read('handback-template',params),read('review',{review_id:reviewId})]);
    ensureHandbackWorkspace(workspace);if(formSerial!==generation)return;
    if(!source.draft||source.draft.review_id!==reviewId)throw Error('Reopen the engineering response for this retained review.');
    const key=[workspace,reviewId,source.draft.response_id,source.draft.previous_handback_id??'initial'].join(':');
    let draft=handbackDrafts.get(key)??source.draft,revision=source.revision,revisionSerial=0,loadingRevision=false,revisionFailed=false;
    if(draft.revised_review_id!==source.draft.revised_review_id&&draft.revised_review_id){
      const selected=await read('handback-template',{...params,response_id:draft.response_id,revised_review_id:draft.revised_review_id});
      ensureHandbackWorkspace(workspace);if(formSerial!==generation)return;revision=selected.revision;
    }else if(!draft.revised_review_id)revision=null;
    const sourceResponse=packet.responses.find(row=>row.id===draft.response_id);
    if(!sourceResponse)throw Error('The selected original customer response is not in this review.');
    const requests=source.requests;
    const byId=new Map(draft.items.map(row=>[row.request_id,row]));
    if(requests.some(row=>!byId.has(row.id))||requests.length!==draft.items.length)throw Error('The saved draft differs from its original requested changes. Reopen the saved engineering response.');
    const itemsMarkup=()=>requests.map(request=>handbackItemEditor(request,byId.get(request.id),revision)).join('');
    openForm(handbackId?'Revise engineering response':'Prepare engineering response',
      'Keep the customer’s original decisions and record the engineering work that answers them. Save a planning edition while work is underway; mark it ready when each request has an explanation and revised work is selected.',
      '<div class="review-intro"><h3>'+esc(packet.review.title)+'</h3><p>'+esc(packet.review.purpose)+'</p><p><strong>Original customer response:</strong> '+esc(sourceResponse.response.reviewer.name)+' · '+esc(date(sourceResponse.response.created_at))+'</p><p>'+esc(sourceResponse.response.summary)+'</p>'+
      '<details><summary>Choose another customer response</summary><p>Each engineering response stays attached to its chosen original. Save current work before starting from another customer response.</p>'+
      packet.responses.filter(row=>row.id!==draft.response_id).map(row=>button('handback-new',row.response.reviewer.name+' · '+date(row.response.created_at),reviewId,'data-response-id="'+esc(row.id)+'"')).join('')+'</details></div>'+
      '<div class="form-grid">'+field('handback_name','Prepared by',draft.prepared_by.name,{required:true,maximum:300})+field('handback_role','Role',draft.prepared_by.role,{maximum:300})+
      field('handback_organization','Organization',draft.prepared_by.organization,{maximum:500})+
      '<label><span>Engineering response state</span><select name="handback_state"><option value="planning"'+(draft.state==='planning'?' selected':'')+'>Planning</option><option value="ready"'+(draft.state==='ready'?' selected':'')+'>Ready for customer review</option></select></label>'+
      '<label class="full"><span>Revised review selection</span><select name="handback_revision">'+handbackOptions(source.revised_choices,draft.revised_review_id,'Planning — select revised work later')+'</select><small>Select the actual retained review containing the replacement work.</small></label>'+button('handback-reload','Reload revised review')+
      field('handback_summary','Engineering response summary',draft.summary,{type:'textarea',wide:true,required:true,rows:3,maximum:20000})+'</div>'+
      '<p id="handback-edit-state" role="status">Draft stays available in this workspace until saved.</p><div id="handback-request-editors">'+itemsMarkup()+'</div>',
      'Save engineering response',async()=>{
        ensureHandbackWorkspace(workspace);
        if(loadingRevision)throw Error('Wait for the selected revised review to load.');
        if(revisionFailed)throw Error('Reload the selected revised review before saving this response.');
        draft=handbackValues(draft);handbackDrafts.set(key,draft);
        if(!draft.prepared_by.name)throw Error('Enter the person preparing this engineering response.');
        if(draft.state==='ready'&&!draft.revised_review_id)throw Error('Choose the actual revised review before marking this response ready.');
        const artifactIds=new Set((revision?.artifacts??[]).map(row=>row.id)),requirementIds=new Set((revision?.requirements??[]).map(row=>row.id));
        for(const item of draft.items){
          if(item.replacement_artifact_ids.some(id=>!artifactIds.has(id))||item.replacement_requirement_ids.some(id=>!requirementIds.has(id)))throw Error('Choose replacement references from the current revised review; clear references from earlier selections.');
          if(item.disposition==='addressed'&&(!draft.revised_review_id||!item.replacement_artifact_ids.length&&!item.replacement_requirement_ids.length))throw Error('Identify the actual revised file or requirement for each addressed request.');
          if(['addressed','deferred'].includes(item.disposition)&&!item.note.trim())throw Error('Explain each addressed or deferred request.');
          if(draft.state==='ready'&&!item.owner.trim())throw Error('Assign an engineer or team to every request before marking the response ready.');
          if(draft.state==='ready'&&item.disposition==='planned')throw Error('Finish or explicitly defer every planned request before marking the response ready.');
        }
        await submitAction('customer.review.handback.save',{handback:draft});
      },()=>{
        const form=$('#operation-form'),revisionSelect=$('[name="handback_revision"]',form),state=$('#handback-edit-state',form);
        const remember=()=>{draft=handbackValues(draft);handbackDrafts.set(key,draft);state.textContent='Draft retained in this workspace. Save an edition to include it in the project.';};
        form.addEventListener('input',remember);form.addEventListener('change',remember);
        const reloadRevision=async()=>{
          draft=handbackValues(draft);handbackDrafts.set(key,draft);const serial=++revisionSerial,selectedId=draft.revised_review_id;
          loadingRevision=true;revisionFailed=false;state.textContent='Loading the selected revised review…';
          try{
            let value=null;
            if(selectedId){const result=await read('handback-template',{...params,response_id:draft.response_id,revised_review_id:selectedId});value=result.revision;}
            if(serial!==revisionSerial||!form.isConnected||workspace!==current())return;
            // Capture edits made while the file inventory was loading.
            draft=handbackValues(draft);handbackDrafts.set(key,draft);revision=value;
            byId.clear();for(const row of draft.items)byId.set(row.request_id,row);
            $('#handback-request-editors',form).innerHTML=itemsMarkup();
            state.textContent='Revised review loaded. Review the replacement references for each requested change.';
          }catch(error){if(serial===revisionSerial&&form.isConnected){revisionFailed=true;state.textContent=error.message||String(error);}}
          finally{if(serial===revisionSerial)loadingRevision=false;}
        };
        form._reloadHandbackRevision=reloadRevision;
        revisionSelect.addEventListener('change',reloadRevision);
      });
  }
  function handbackRequestRows(result){
    const record=result.handback,requests=new Map(result.requests.map(row=>[row.id,row]));
    const artifacts=new Map((result.revised?.artifacts??[]).map(row=>[row.id,row.label||row.original_path]));
    const requirements=new Map((result.revised?.requirements??[]).map(row=>[row.id,row.title]));
    return record.items.map(item=>{
      const request=requests.get(item.request_id);
      return '<tr><td class="name-cell"><strong>'+esc(request?.title||item.request_id)+'</strong><p>'+esc(request?.description)+'</p>'+badge(request?.kind||'request')+'</td>'+
        '<td>'+badge(item.disposition)+'<small>'+esc(item.owner||'Unassigned')+'</small></td><td class="review-source-detail">'+esc(item.note||'—')+'</td><td>'+
        [...item.replacement_artifact_ids.map(id=>artifacts.get(id)||short(id)),...item.replacement_requirement_ids.map(id=>requirements.get(id)||short(id))].map(esc).join('<br>')+'</td></tr>';
    });
  }
  async function openHandback(id){
    const serial=++generation,result=await read('handback',{handback_id:id});if(serial!==generation)return;
    const row=result.handback,history=result.history??[],exports=result._exports??[],latest=history.at(-1);
    detail('Engineering response — '+(result.original?.title||short(row.review_id)),
      '<div class="customer-review-detail"><div class="page-actions">'+button('open','Back to review',row.review_id,'data-tab="handbacks"')+
      (latest?.id===row.id?button('handback-edit','Revise response',row.id,'data-review-id="'+esc(row.review_id)+'"'):latest?button('handback-open','Open latest edition',latest.id):'')+
      (row.state==='ready'?button('handback-export','Export complete handback',row.id,'',true):'')+'</div>'+
      '<div class="review-intro"><p>'+badge(row.state)+' · '+esc(row.prepared_by.name)+' · '+esc(date(row.created_at))+'</p><p class="review-source-detail">'+esc(row.summary)+'</p>'+
      '<p>Original customer response <span class="mono">'+esc(short(row.response_id))+'</span></p>'+
      (row.revised_review_id?'<p>Revised selection: '+esc(result.revised?.title||short(row.revised_review_id))+'</p>'+button('open','Open revised review',row.revised_review_id):'<p>Planning edition: choose the actual revised review when the replacement work is ready.</p>')+'</div>'+
      '<h3>Requested changes and engineering response</h3>'+table(['Original request','Disposition and owner','Explanation','Replacement work'],handbackRequestRows(result))+
      '<h3>Engineering response editions</h3>'+table(['Saved','Prepared by','State',''],history.map(item=>'<tr><td>'+esc(date(item.created_at))+'</td><td>'+esc(item.prepared_by?.name||'')+'</td><td>'+badge(item.state)+'</td><td>'+(item.id===row.id?'Current view':button('handback-open','Open edition',item.id))+'</td></tr>'))+
      '<h3>Exported handbacks</h3>'+(exports.length?table(['Exported','Complete package',''],exports.map(item=>'<tr><td>'+esc(date(item.completed_at||item.created_at))+'</td><td>'+esc(item.members??'')+' files</td><td>'+exportControls(item,'Open handback desk')+'</td></tr>')):'<p>No exported package for this edition.</p>')+
      (result._downloads?.length?fileList(result._downloads):'')+
      '<details><summary>Complete engineering response</summary><pre class="json-view">'+esc(pretty(row))+'</pre></details></div>',
      {kind:'customer-review-handback',id:row.id});
  }
  async function exportHandback(id){
    const workspace=current(),result=await read('handback',{handback_id:id}),row=result.handback;
    if(row.state!=='ready')throw Error('Save a ready engineering response before exporting its customer handback.');
    openForm('Export complete customer handback','Export the original customer review, the selected revised review and the complete engineering response history together.',
      '<div class="review-intro"><h3>'+esc(result.original?.title||short(row.review_id))+'</h3><p class="review-source-detail">'+esc(row.summary)+'</p><p>Revised selection: '+esc(result.revised?.title||short(row.revised_review_id))+'</p><p>'+row.items.length+' requested changes with retained engineering dispositions.</p></div>',
      'Export handback',()=>{ensureHandbackWorkspace(workspace);return submitAction('customer.review.handback.export',{handback_id:id});});
  }
  function receiveHandback(reviewId){
    const workspace=current();
    openForm('Receive complete handback package','Choose the complete handback ZIP in its restored source project. The task retains its full files and joins the original review and response records to that project.',
      '<label class="review-file-picker"><span>Complete handback ZIP</span><input name="handback_package" type="file" accept=".zip,application/zip" required></label><p id="handback-receive-selection" role="status"></p>',
      'Receive handback',async()=>{
        ensureHandbackWorkspace(workspace);const file=$('#operation-form [name="handback_package"]').files[0];
        if(!file)throw Error('Choose the complete exported handback ZIP.');
        const uploaded=await uploadFile(file);ensureHandbackWorkspace(workspace);
        await submitAction('customer.review.handback.import',{upload_id:uploaded.id});
      },()=>{$('#operation-form [name="handback_package"]').addEventListener('change',event=>{const file=event.target.files[0];$('#handback-receive-selection').textContent=file?file.name+' · '+file.size.toLocaleString()+' bytes':'';});});
  }

  function drawPacket(packet,tab='files'){
    activePacket=packet;activeTab=tab;
    const tabs=[['files','Files'],['requirements','Requirements'],['corrections','Corrections'],['history','Response history'],['handbacks','Engineering handbacks'],['exports','Exported desks']];
    const body=tab==='handbacks'?handbacksTab(packet):tab==='requirements'?requirementsTab(packet):tab==='corrections'?correctionsTab(packet):tab==='history'?historyTab(packet):tab==='exports'?exportsTab(packet):fileTab(packet);
    detail(packet.review.title,'<div class="customer-review-detail">'+summary(packet)+reviewToolbar(packet)+
      '<nav class="review-tabs" aria-label="Review sections">'+tabs.map(([key,title])=>button('tab',title,packet.review.id,'data-tab="'+key+'" aria-pressed="'+(tab===key)+'"')).join('')+'</nav><section>'+body+'</section>'+
      '<details class="technical"><summary>Complete review document</summary>'+fileList([packet._packet_download])+'<dl class="definition"><dt>Review</dt><dd class="mono">'+esc(packet.review.id)+'</dd><dt>Project</dt><dd class="mono">'+esc(packet.review.project.id)+'</dd></dl></details></div>',{kind:'customer-review',id:packet.review.id});
  }
  async function openReview(id,tab='files'){
    const serial=++generation,packet=await read('review',{review_id:id});
    if(tab==='handbacks'&&!Array.isArray(packet._handbacks)){const result=await read('handbacks',{review_id:id});packet._handbacks=result.handbacks;}
    if(serial!==generation)return;
    drawPacket(packet,tab);
  }
  async function exportReview(id){
    const workspace=current(),packet=await read('review',{review_id:id});
    openForm('Export complete review desk',
      'Create a portable copy of this selection, its original files and this exact response history.',
      '<div class="review-intro"><h3>'+esc(packet.review.title)+'</h3><p>'+esc(packet.review.purpose)+'</p><p>'+packet.review.artifacts.length+' complete files · '+packet.review.requirements.length+' requirements · '+packet.responses.length+' retained responses</p><p>After export, open the desk here or download and extract its ZIP. Record decisions in the desk and export its response JSON for receiving.</p></div>',
      'Export review',()=>{
        if(current()!==workspace)throw Error('The workspace changed. Reopen the original review before exporting.');
        return submitAction('customer.review.export',{review_id:id,expected_response_id:packet.latest_response_id});
      });
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
    const row=task._review,rebuild=rebuildExportControl(task.id,row);
    if(row.kind==='engineering-handback'&&row.handback_id)return '<div class="page-actions">'+button('handback-open','Open engineering response',row.handback_id)+(row.desk_url?'<a class="button primary" href="'+esc(row.desk_url)+'" target="_blank" rel="noopener">Open handback desk</a>':'')+'</div>'+rebuild;
    return '<div class="page-actions">'+button('open','Open retained review',row.review_id)+(row.desk_url?'<a class="button primary" href="'+esc(row.desk_url)+'" target="_blank" rel="noopener">Open review desk</a>':'')+'</div>'+rebuild;
  }
  async function dispatch(node){
    const action=node.dataset.action.slice(7),id=node.dataset.id;
    if(action==='rebuild-export')return rebuildExport(id);
    if(action==='handback-reload'){const form=$('#operation-form');if(!form?._reloadHandbackRevision)throw Error('Reopen the engineering response form.');return form._reloadHandbackRevision();}
    if(action==='handback-new')return newHandback(id,null,node.dataset.responseId||null);
    if(action==='handback-edit')return newHandback(node.dataset.reviewId,id);
    if(action==='handback-open')return openHandback(id);
    if(action==='handback-export')return exportHandback(id);
    if(action==='handback-import')return receiveHandback(id);
    if(action==='new')return newReview(id,node.dataset.exportId||null);
    if(action==='map-preview')return previewMap(node);
    if(action==='open')return openReview(id,node.dataset.tab||'files');
    if(action==='tab'){
      if(node.dataset.tab==='handbacks')return openReview(id,'handbacks');
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
