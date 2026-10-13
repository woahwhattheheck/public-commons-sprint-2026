/** Prepare ordered scientific reports through the original retained task queue. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=row=>JSON.stringify([row.source_collection_id,row.source_id]);
const choice=row=>({source_collection_id:row.source_collection_id,source_id:row.source_id});
const size=n=>Number(n).toLocaleString()+' B';
const link=(url,label)=>'<a href="'+esc(url)+(url.includes('?')?'&':'?')+'download=1" download>'+esc(label)+'</a>';

export function orderedReportSources(catalog, selected) {
  if(!Array.isArray(selected))throw Error('Choose an ordered list of scientific sources.');
  const byKey=new Map(catalog.map(row=>[key(row),row])),seen=new Set();
  return selected.map(row=>{
    const id=key(row);
    if(seen.has(id))throw Error('Choose each original report source once.');
    seen.add(id);
    if(!byKey.has(id))throw Error('A selected report source is no longer in this Workspace. Refresh its source edition.');
    return byKey.get(id);
  });
}

export function attachScientificReportEditions(host) {
  let panel=null,workspace=null,generation=0,revision=0,detailGeneration=0,active=false;
  let sources=[],editions=[],selected=[],title='',contact={name:'',organization:'',email:''};
  let preview=null,opened=null,busy=false,error='',pending=null,storageIssue='';
  let briefingPreview=null,briefingOpened=null;
  const valid=(ws,turn)=>workspace===ws&&host.getWorkspace()===ws&&generation===turn;
  const request=(path,values={})=>host.api(host.endpoint(path,values));
  const payload=()=>({sources:selected.map(choice),...(title.trim()?{title:title.trim()}:{}),contact:{...contact}});
  function changed(){revision++;preview=null;saveDraft();}
  function saveDraft(){
    try{sessionStorage.setItem('scientific-report-draft:'+workspace,JSON.stringify({selected,title,contact,pending}));storageIssue='';}
    catch{storageIssue='Browser storage is unavailable. Keep this report desk open until its original request is recovered.';}
  }
  function restoreDraft(){
    try{
      const saved=JSON.parse(sessionStorage.getItem('scientific-report-draft:'+workspace)||'null');
      if(saved&&Array.isArray(saved.selected)){selected=saved.selected.map(choice);title=typeof saved.title==='string'?saved.title:'';
        contact={name:String(saved.contact?.name??''),organization:String(saved.contact?.organization??''),email:String(saved.contact?.email??'')};
        const retained=saved.pending;
        if(retained&&typeof retained.id==='string'&&retained.id&&
            ['source-reports.render','source-reports.export','source-reports.briefing'].includes(retained.action)&&
            retained.body&&typeof retained.body==='object'&&!Array.isArray(retained.body)&&
            retained.key===JSON.stringify([workspace,retained.action,retained.body])){
          pending=retained;
        }
      }
    }catch{}
  }
  function ensure(container){
    if(!panel){
      panel=document.createElement('section');panel.className='scientific-report-editions';
      panel.setAttribute('aria-label','Prepare and reopen scientific reports');
      panel.addEventListener('click',event=>{
        const button=event.target.closest('[data-scientific-report-action]');
        if(!button||!panel.contains(button))return;
        event.preventDefault();event.stopPropagation();
        const ws=workspace,turn=generation;
        dispatch(button).catch(reason=>{if(valid(ws,turn)){error=reason.message||String(reason);render();}});
      });
      panel.addEventListener('input',event=>{
        const field=event.target.dataset.scientificReportField;
        if(!field)return;
        if(busy||pending){error='Recover the original report request before editing its selection.';render();return;}
        if(field==='title')title=event.target.value;
        else contact[field]=event.target.value;
        changed();
        panel.querySelector('[data-scientific-report-preview]').textContent='Preview the current selection before preparing the report.';
        const button=panel.querySelector('[data-scientific-report-action="render"]');if(button)button.disabled=true;
      });
    }
    if(panel.parentNode!==container)container.append(panel);
    panel.hidden=false;
  }
  function render(){
    if(!panel)return;
    let chosen=[],selectionIssue='';
    try{chosen=orderedReportSources(sources,selected);}catch(reason){selectionIssue=reason.message;}
    const selectedKeys=new Set(selected.map(key)),remaining=sources.filter(row=>!selectedKeys.has(key(row))),locked=busy||!!pending;
    panel.innerHTML='<div class="source-reports-heading"><div><h3>Prepare a scientific report</h3>'+
      '<p>Select saved scientific studies in reading order. The report retains their methods, periods, figures and source data.</p></div>'+
      '<button type="button" data-scientific-report-action="refresh">Refresh saved reports</button></div>'+
      '<p data-scientific-report-status role="status">'+esc(error||storageIssue||selectionIssue||(busy?'Working through the original task queue…':''))+'</p>'+
      (pending?'<section class="scientific-report-preview"><p>Original report request '+esc(pending.id)+(pending.task_id?' · task '+esc(pending.task_id):' · response awaiting recovery')+'</p><button type="button" data-scientific-report-action="recover"'+(busy?' disabled':'')+'>'+(pending.task_id?'Open retained report task':'Recover original report request')+'</button></section>':'')+
      '<div class="scientific-report-fields"><label>Report title <span class="note">(optional)</span><input data-scientific-report-field="title" value="'+esc(title)+'"'+(locked?' disabled':'')+'></label>'+
      ['name','organization','email'].map(field=>'<label>'+esc({name:'Prepared by',organization:'Organization',email:'Contact email'}[field])+
        '<input data-scientific-report-field="'+field+'" value="'+esc(contact[field])+'"'+(locked?' disabled':'')+'></label>').join('')+'</div>'+
      '<label class="source-reports-document">Add a saved scientific study<select data-scientific-report-source>'+
        '<option value="">Choose an original report source</option>'+remaining.map(row=>'<option value="'+esc(key(row))+'">'+esc(row.title)+' · '+esc(row.vintage)+'</option>').join('')+
        '</select></label><button type="button" data-scientific-report-action="add"'+(!remaining.length||locked?' disabled':'')+'>Add study</button>'+
      (selected.length?'<ol class="scientific-report-order">'+selected.map((row,index)=>{
        const original=sources.find(item=>key(item)===key(row));
        return '<li><div><strong>'+esc(original?.title||row.source_id)+'</strong><small>'+esc(original?.vintage||'Retained selection')+
          ' · '+esc(row.source_id)+'</small></div><div class="inline-actions">'+
          '<button type="button" data-scientific-report-action="up" data-index="'+index+'"'+(!index||locked?' disabled':'')+' aria-label="Move study '+(index+1)+' earlier">Earlier</button>'+
          '<button type="button" data-scientific-report-action="down" data-index="'+index+'"'+(index===selected.length-1||locked?' disabled':'')+' aria-label="Move study '+(index+1)+' later">Later</button>'+
          '<button type="button" data-scientific-report-action="remove" data-index="'+index+'"'+(locked?' disabled':'')+'>Remove</button></div></li>';
      }).join('')+'</ol>':'<p class="note">Saved calibration reviews, Scientific interpretation, native process studies and observed-water reports appear here after their report source is prepared.</p>')+
      '<div class="inline-actions"><button type="button" data-scientific-report-action="preview"'+(!chosen.length||selectionIssue||locked?' disabled':'')+'>Preview selected sources</button>'+
      '<button type="button" data-scientific-report-action="render"'+(!preview||locked?' disabled':'')+'>'+(preview?.existing?'Reopen existing report':'Prepare PDF, HTML and data')+'</button></div>'+
      '<div data-scientific-report-preview>'+previewHTML()+'</div>'+
      '<h3>Saved scientific reports</h3>'+
      (editions.length?'<div class="table-scroll"><table><thead><tr><th>Report</th><th>Contents</th><th></th></tr></thead><tbody>'+
        editions.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small class="mono">'+esc(row.operation_id)+'</small></td><td>'+
          row.source_count+' studies · '+row.section_count+' sections · '+row.figure_count+' figures</td><td>'+
          '<button type="button" data-scientific-report-action="open" data-id="'+esc(row.id)+'">Open saved report</button></td></tr>').join('')+
        '</tbody></table></div>':'<p class="note">Prepared editions appear here and stay with the Workspace backup.</p>')+
      '<section data-scientific-report-detail'+(opened?'':' hidden')+'></section>';
    if(opened)renderDetail();
  }
  function previewHTML(){
    if(!preview)return '<p class="note">Preview the current selection before preparing the report.</p>';
    return '<div class="scientific-report-preview"><h4>'+esc(preview.title)+'</h4><p>'+preview.source_count+
      ' original studies, in the order below. '+(preview.existing?'This exact report is already saved.':'The task will prepare the complete report edition.')+'</p><ol>'+
      preview.sources.map(row=>'<li>'+esc(row.title)+'<small>'+esc(row.vintage)+' · '+esc(row.source_id)+
        '</small><small class="mono">Source SHA256 '+esc(row.body_sha256)+'</small></li>').join('')+'</ol></div>';
  }
  async function refresh(){
    const ws=workspace,turn=generation;
    const result=await request('/api/source-reports/scientific-catalog');
    if(!valid(ws,turn))return;
    if(result.workspace_key!==ws)throw Error('The scientific report catalogue belongs to another Workspace.');
    sources=result.sources||[];editions=result.editions||[];error='';render();
  }
  async function preparePreview(){
    const ws=workspace,turn=generation,version=revision,selection=payload();
    orderedReportSources(sources,selection.sources);
    const result=await host.api(host.endpoint('/api/source-reports/scientific-preview'),{method:'POST',body:selection});
    if(!valid(ws,turn)||revision!==version)return;
    if(result.workspace_key!==ws||JSON.stringify(result.sources.map(choice))!==JSON.stringify(selection.sources))
      throw Error('The preview returned a different ordered study selection.');
    preview=result;error='';render();
  }
  async function open(id){
    const ws=workspace,turn=generation,ticket=++detailGeneration;
    const result=await request('/api/source-reports/scientific-edition',{id});
    if(!valid(ws,turn)||ticket!==detailGeneration)return;
    if(result.workspace_key!==ws||result.edition?.id!==id)throw Error('The saved report differs from the chosen edition.');
    if(opened?.edition.id!==id){briefingPreview=null;briefingOpened=null;}
    opened=result;error='';render();
    panel.querySelector('[data-scientific-report-detail]').scrollIntoView({block:'start'});
  }
  function renderDetail(){
    const target=panel.querySelector('[data-scientific-report-detail]'),row=opened.edition;
    target.innerHTML='<div class="source-reports-heading"><div><h3>'+esc(row.title)+'</h3><p>'+
      row.source_count+' studies · '+row.section_count+' sections · '+row.figure_count+' figures</p></div>'+
      '<button type="button" data-scientific-report-action="close">Close report</button></div>'+
      '<div class="inline-actions"><button type="button" data-scientific-report-action="revise"'+(busy||pending?' disabled':'')+'>Use these studies in another report</button>'+
      '<button type="button" data-scientific-report-action="export"'+(busy||pending?' disabled':'')+'>Prepare complete report ZIP</button>'+
      (typeof host.openStudy==='function'?'<button type="button" data-scientific-report-action="transfer"'+(busy?' disabled':'')+'>Transfer this report and its studies</button>':'')+
      '<button type="button" data-scientific-report-action="backup">Back up Workspace with this report</button>'+
      (opened.archive?link(opened.archive.url,'Download report ZIP'):'')+'</div>'+
      '<p class="note">The report ZIP contains the rendered report, its selection, figures and retained report data. Study transfer also includes its ordered source collections and available original editable study history. The Workspace backup keeps the entire project.</p>'+
      briefingHTML()+
      (opened.viewer_url?'<div class="source-report-frame-shell"><iframe title="'+esc(row.title)+
        '" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer" src="'+esc(opened.viewer_url)+'"></iframe></div>':'')+
      '<div class="table-scroll"><table><thead><tr><th>File</th><th>Size / SHA256</th><th></th></tr></thead><tbody>'+
      opened.files.map(item=>'<tr><td>'+esc(item.path)+'</td><td>'+size(item.bytes)+'<small class="mono">'+esc(item.sha256)+
        '</small></td><td>'+link(item.url,'Download')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function briefingHTML(){
    const row=opened.edition;
    return '<section class="scientific-report-preview"><h4>Discuss this saved scientific report</h4>'+
      '<p>Present the complete original tables and figures, record questions and actions against their report pages, and receive selected follow-up in Implementation &amp; fieldwork.</p>'+
      '<div class="inline-actions"><button type="button" data-scientific-report-action="briefing-preview"'+(busy||pending?' disabled':'')+'>Preview discussion package</button>'+
      '<button type="button" data-scientific-report-action="briefing-prepare"'+(!briefingPreview||busy||pending?' disabled':'')+'>Prepare briefing and complete ZIP</button></div>'+
      (briefingPreview?'<p>'+briefingPreview.page_count+' briefing pages · '+briefingPreview.source_count+' original studies · '+briefingPreview.figure_count+' figures. Original report files and source data travel in the same package.</p>':'')+
      (opened.briefings?.length?'<ul>'+opened.briefings.map(item=>'<li>'+item.page_count+' pages · <button type="button" data-scientific-report-action="briefing-open" data-id="'+esc(item.id)+'">Open saved briefing</button></li>').join('')+'</ul>':'')+
      (briefingOpened?'<div class="inline-actions">'+(briefingOpened.archive?link(briefingOpened.archive.url,'Download complete discussion package'):'')+
        link(briefingOpened.viewer_url,'Download briefing HTML')+'</div><p class="note">Extract the complete ZIP for the meeting. Export actual meeting notes from the briefing, then choose this saved briefing in Implementation &amp; fieldwork → Receive briefing follow-up.</p>'+
        '<div class="source-report-frame-shell"><iframe title="'+esc(briefingOpened.briefing.title)+' — meeting briefing" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer" src="'+esc(briefingOpened.viewer_url)+'"></iframe></div>':'')+'</section>';
  }
  async function previewBriefing(){
    if(!opened)throw Error('Open the saved scientific report first.');
    const ws=workspace,turn=generation,ticket=detailGeneration,id=opened.edition.id;
    const result=await host.api(host.endpoint('/api/source-reports/scientific-briefing-preview'),{method:'POST',body:{id}});
    if(!valid(ws,turn)||ticket!==detailGeneration||opened?.edition.id!==id)return;
    if(result.workspace_key!==ws||result.source_edition_id!==id)throw Error('The briefing preview belongs to another saved report.');
    briefingPreview=result;error='';render();
  }
  async function openBriefing(id){
    if(!opened)throw Error('Open the original report for this briefing.');
    const ws=workspace,turn=generation,ticket=detailGeneration,edition=opened.edition.id;
    const result=await request('/api/source-reports/scientific-briefing',{id});
    if(!valid(ws,turn)||ticket!==detailGeneration||opened?.edition.id!==edition)return;
    if(result.workspace_key!==ws||result.briefing?.id!==id||result.briefing.source_edition_id!==edition)
      throw Error('The saved briefing belongs to another scientific report.');
    briefingOpened=result;error='';render();
  }

  async function showRetainedTask(){
    const original=pending,ws=workspace,turn=generation;
    if(!original?.task_id)throw Error('The original report task has not returned its ID yet.');
    await host.refresh({force:true});
    if(!valid(ws,turn)||pending!==original)return;
    await host.showTask(original.task_id);
    if(!valid(ws,turn)||pending!==original)return;
    pending=null;saveDraft();await refresh();
  }
  async function submit(action,body){
    if(busy)return;
    const ws=workspace,turn=generation;
    const requestKey=JSON.stringify([ws,action,body]);
    if(pending&&pending.key!==requestKey)
      throw Error('Recover the original report request before starting another.');
    if(!pending)pending={key:requestKey,id:crypto.randomUUID(),action,body:JSON.parse(JSON.stringify(body))};
    const original=pending;
    saveDraft();busy=true;error='';render();
    try{
      if(original.task_id){await showRetainedTask();return;}
      const requestBody={workspace:ws,action:original.action,payload:original.body,operation_id:original.id};
      const response=await host.api('/api/actions',{method:'POST',body:requestBody});
      if(!valid(ws,turn)||pending!==original)return;
      const task=response.task||response;
      if((task.workspace&&task.workspace!==ws)||(response.workspace&&response.workspace!==ws))throw Error('The retained report task belongs to another Workspace.');
      if(typeof task.id!=='string'||!task.id)throw Error('The original request is retained. Recover its native task response.');
      original.task_id=task.id;saveDraft();
      await showRetainedTask();
    }finally{if(valid(ws,turn)){busy=false;saveDraft();render();}}
  }
  async function recover(){
    if(busy||!pending)return;
    return submit(pending.action,pending.body);
  }
  async function dispatch(button){
    const action=button.dataset.scientificReportAction;
    if(action==='recover')return recover();
    if(['add','up','down','remove','preview','render','revise','export','briefing-preview','briefing-prepare'].includes(action)&&(busy||pending))
      throw Error('Recover the original report request before changing its selection or starting another.');
    if(action==='refresh'){await refresh();if(opened)await open(opened.edition.id);return;}
    if(action==='add'){
      const value=panel.querySelector('[data-scientific-report-source]').value;
      const row=sources.find(item=>key(item)===value);
      if(!row)throw Error('Choose a retained scientific report source.');
      selected.push(choice(row));orderedReportSources(sources,selected);changed();render();return;
    }
    if(['up','down','remove'].includes(action)){
      const index=Number(button.dataset.index);
      if(!Number.isInteger(index)||index<0||index>=selected.length)throw Error('Choose a selected study.');
      if(action==='remove')selected.splice(index,1);
      else {const next=index+(action==='up'?-1:1);if(next<0||next>=selected.length)return;[selected[index],selected[next]]=[selected[next],selected[index]];}
      changed();render();return;
    }
    if(action==='briefing-preview')return previewBriefing();
    if(action==='briefing-open')return openBriefing(button.dataset.id);
    if(action==='briefing-prepare'){
      if(!opened||!briefingPreview||briefingPreview.source_edition_id!==opened.edition.id)
        throw Error('Preview this exact saved report before preparing its discussion package.');
      return submit('source-reports.briefing',{id:opened.edition.id,preview_id:briefingPreview.id});
    }
    if(action==='preview')return preparePreview();
    if(action==='render'){
      if(!preview)throw Error('Preview the current ordered selection first.');
      if(preview.existing)return open(preview.id);
      return submit('source-reports.render',{...payload(),preview_id:preview.id});
    }
    if(action==='open')return open(button.dataset.id);
    if(action==='close'){detailGeneration++;opened=null;briefingPreview=null;briefingOpened=null;render();return;}
    if(action==='revise'&&opened){
      const identity=opened.edition.render_identity,selection=identity.selection;
      selected=(selection.observed_context_sources||[selection.source_roles.OBSERVED_CONTEXT]).map(choice);
      title=opened.edition.title;contact={...identity.contact};changed();render();
      panel.scrollIntoView({block:'start'});return;
    }
    if(action==='export'&&opened)return submit('source-reports.export',{id:opened.edition.id});
    if(action==='transfer'&&opened){
      if(typeof host.openStudy!=='function')throw Error('Open Study transfer in this application to transfer the saved report.');
      const ws=workspace,turn=generation,ticket=++detailGeneration,id=opened.edition.id;
      const result=await request('/api/source-reports/scientific-edition',{id});
      if(!active||!valid(ws,turn)||ticket!==detailGeneration||opened?.edition.id!==id)return;
      if(result.workspace_key!==ws||result.edition?.id!==id||result.edition.state!=='complete')
        throw Error('The completed report differs from the selected original edition.');
      return host.openStudy({workspace_key:ws,roots:[{kind:'scientific-report-editions',id,
        title:result.edition.title,state:'complete'}]});
    }
    if(action==='backup')return host.openBackup();
  }
  async function mount(container){
    const ws=host.getWorkspace();
    if(workspace!==ws){reset();workspace=ws;restoreDraft();}
    active=true;ensure(container);render();await refresh();
  }
  async function openForSources(value){
    if(!value||value.workspace_key!==host.getWorkspace()||value.workspace_key!==workspace)
      throw Error('Open the prepared report sources in their original Workspace.');
    if(!Array.isArray(value.sources)||!value.sources.length)
      throw Error('Choose one or more original prepared report sources.');
    if(busy||pending)throw Error('Finish or recover the retained scientific report request before adding more sources.');
    const ws=workspace,turn=generation;
    await refresh();
    if(!valid(ws,turn))throw Error('The Workspace changed before its report sources opened.');
    if(busy||pending)throw Error('Finish or recover the retained scientific report request before adding more sources.');
    const incoming=orderedReportSources(sources,value.sources).map(choice);
    const seen=new Set(selected.map(key));
    for(const row of incoming){if(!seen.has(key(row))){selected.push(row);seen.add(key(row));}}
    if(!title.trim()&&typeof value.title==='string')title=value.title;
    changed();error='';render();
    panel.scrollIntoView({block:'start'});
    panel.querySelector('[data-scientific-report-action="preview"]').focus?.();
    return {workspace_key:ws,sources:selected.map(choice)};
  }
  function detach(){active=false;detailGeneration++;if(panel)panel.hidden=true;}
  function reset(){
    generation++;revision++;detailGeneration++;if(panel)panel.remove();
    panel=null;workspace=null;sources=[];editions=[];selected=[];title='';
    contact={name:'',organization:'',email:''};
    preview=null;opened=null;briefingPreview=null;briefingOpened=null;busy=false;pending=null;error='';storageIssue='';active=false;
  }
  return {mount,detach,reset,refresh,openForSources};
}
