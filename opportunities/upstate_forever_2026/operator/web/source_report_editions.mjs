import {attachScientificSourceReader} from './scientific_source_reader.mjs';
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

export const SCIENTIFIC_REPORT_SOURCE_SELECTION = 'replace-v1';

export function attachScientificReportEditions(host) {
  let panel=null,workspace=null,generation=0,revision=0,detailGeneration=0,active=false;
  let sources=[],editions=[],selected=[],title='',contact={name:'',organization:'',email:''};
  let preview=null,opened=null,busy=false,error='',pending=null,storageIssue='';
  let briefingPreview=null,briefingOpened=null;
  let capturedReports=[],captureIssues=[],capturePreview=null,captureGeneration=0;
  const briefingFrames=new Map(),reportFrames=new Map();
  let sourceIntent=0,catalogGeneration=0,catalogRead=null;
  const sourceReader=attachScientificSourceReader({...host,compose:value=>openForSources(value),
    returnToSelection:()=>panel?.querySelector('[data-scientific-report-main]')?.scrollIntoView({block:'start'})});
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
            ['source-reports.render','source-reports.export','source-reports.briefing','source-reports.adopt'].includes(retained.action)&&
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
      panel.innerHTML='<div data-scientific-report-main></div><section data-scientific-report-detail hidden></section><section data-scientific-report-document-host class="source-report-frame-shell" hidden></section><section data-scientific-report-briefing-host hidden></section><section data-scientific-report-files hidden></section>';
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
    sourceReader.mount(panel);
  }
  function sourceActions(row,reportId=''){
    const native=row.native_study,available=typeof host.openGISStudy==='function'&&host.hasView?.('gis-projects');
    const attributes=' data-collection="'+esc(row.source_collection_id)+'" data-source="'+esc(row.source_id)+'"'+
      (reportId?' data-report="'+esc(reportId)+'"':'');
    return '<div class="inline-actions">'+
      '<button type="button" data-scientific-report-action="read-source"'+attributes+'>Read original study</button>'+
      (typeof host.openItem==='function'?'<button type="button" data-scientific-report-action="source"'+attributes+'>Open original source files</button>':'')+
      (native&&available?'<button type="button" data-scientific-report-action="gis"'+attributes+
        (!native.local_project||busy||pending?' disabled':'')+'>Prepare editable native GIS</button>':'')+'</div>'+
      (native&&!native.local_project?'<small>Open the restored original model project to include its native rasters. This received source keeps its original report data and files.</small>':'');
  }
  function reportSourcesHTML(){
    const native=new Map((opened.native_studies||[]).map(row=>[key(row),row]));
    return '<section class="scientific-report-preview"><h4>Continue with this report’s original studies</h4>'+
      '<p>Open the retained source files, or prepare editable native GIS with this exact saved report. Choose an execution-history snapshot in the GIS desk when needed.</p><ol>'+
      opened.edition.sources.map(row=>'<li><strong>'+esc(row.title||row.source_id)+'</strong><small>'+
        esc(row.vintage||'Original retained edition')+'</small>'+
        sourceActions({...row,native_study:native.get(key(row))},opened.edition.id)+'</li>').join('')+'</ol></section>';
  }
  function render(){
    if(!panel)return;
    let chosen=[],selectionIssue='';
    try{chosen=orderedReportSources(sources,selected);}catch(reason){selectionIssue=reason.message;}
    const selectedKeys=new Set(selected.map(key)),remaining=sources.filter(row=>!selectedKeys.has(key(row))),locked=busy||!!pending;
    panel.querySelector('[data-scientific-report-main]').innerHTML='<div class="source-reports-heading"><div><h3>Prepare a scientific report</h3>'+
      '<p>Select saved scientific studies in reading order. The report retains their methods, periods, figures and source data.</p></div>'+
      '<button type="button" data-scientific-report-action="refresh">Refresh saved reports</button></div>'+
      '<p data-scientific-report-status role="status">'+esc(error||storageIssue||selectionIssue||(busy?'Working through the original task queue…':''))+'</p>'+
      (pending?'<section class="scientific-report-preview"><p>Original report request '+esc(pending.id)+(pending.task_id?' · task '+esc(pending.task_id):' · response awaiting recovery')+'</p><button type="button" data-scientific-report-action="recover"'+(busy?' disabled':'')+'>'+(pending.task_id?'Open retained report task':'Recover original report request')+'</button></section>':'')+
      '<div class="scientific-report-fields"><label>Report title <span class="note">(optional)</span><input data-scientific-report-field="title" value="'+esc(title)+'"'+(locked?' disabled':'')+'></label>'+
      ['name','organization','email'].map(field=>'<label>'+esc({name:'Prepared by',organization:'Organization',email:'Contact email'}[field])+
        '<input data-scientific-report-field="'+field+'" value="'+esc(contact[field])+'"'+(locked?' disabled':'')+'></label>').join('')+'</div>'+
      '<label class="source-reports-document">Add a saved scientific study<select data-scientific-report-source>'+
        '<option value="">Choose an original report source</option>'+remaining.map(row=>'<option value="'+esc(key(row))+'">'+esc(row.title)+' · '+esc(row.vintage)+'</option>').join('')+
        '</select></label><button type="button" data-scientific-report-action="add"'+(!remaining.length||locked?' disabled':'')+'>Add study</button><button type="button" data-scientific-report-action="inspect-available"'+(!remaining.length?' disabled':'')+'>Read original study before adding</button>'+
      (selected.length?'<ol class="scientific-report-order">'+selected.map((row,index)=>{
        const original=sources.find(item=>key(item)===key(row));
        return '<li><div><strong>'+esc(original?.title||row.source_id)+'</strong><small>'+esc(original?.vintage||'Retained selection')+
          ' · '+esc(row.source_id)+'</small>'+sourceActions(original||row)+'</div><div class="inline-actions">'+
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
      capturedReportsHTML(locked);
    panel.querySelector('[data-scientific-report-detail]').hidden=!opened;
    panel.querySelector('[data-scientific-report-files]').hidden=!opened;
    if(opened)renderDetail();
    renderReportDocument();
    renderBriefingDocument();
  }
  function capturedReportsHTML(locked){
    if(!capturedReports.length&&!captureIssues.length)return '';
    return '<h3>Completed reports retained with this project</h3>'+
      '<p>Reports prepared by the original command-line workflow keep their PDF, HTML, data and sources here. Add a completed report to the saved editions to review, compare or transfer it.</p>'+
      (capturedReports.length?'<div class="table-scroll"><table><thead><tr><th>Completed report</th><th>Original contents</th><th></th></tr></thead><tbody>'+
        capturedReports.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small class="mono">'+esc(row.operation_id)+'</small></td><td>'+
          esc(row.source_count)+' studies · '+esc(row.section_count)+' sections · '+esc(row.figure_count)+' figures'+
          '<small>'+esc(row.file_count)+' files · '+esc(size(row.bytes))+'</small></td><td>'+
          '<button type="button" data-scientific-report-action="capture-preview" data-id="'+esc(row.capture_id)+'"'+(locked?' disabled':'')+'>Review completed report</button></td></tr>').join('')+
        '</tbody></table></div>':'')+
      (captureIssues.length?'<details><summary>Completed reports needing attention ('+captureIssues.length+')</summary><ul>'+
        captureIssues.map(row=>'<li><code>'+esc(row.capture_id)+'</code> — '+esc(row.message)+'</li>').join('')+'</ul></details>':'')+
      (capturePreview?'<section class="scientific-report-preview"><h4>'+esc(capturePreview.title)+'</h4>'+
        '<p>The original '+esc(capturePreview.file_count)+' files and ordered sources have been verified. Adding this report preserves its exact PDF, HTML, data and original rendering identity.</p><ol>'+
        capturePreview.sources.map(row=>'<li>'+esc(row.title)+'<small>'+esc(row.vintage)+' · '+esc(row.source_id)+'</small></li>').join('')+
        '</ol><div class="inline-actions"><button type="button" data-scientific-report-action="capture-adopt"'+(locked?' disabled':'')+'>Add original saved edition</button>'+
        '<button type="button" data-scientific-report-action="capture-close">Close completed report</button></div></section>':'');
  }
  async function previewCapture(id){
    const chosen=capturedReports.find(row=>row.capture_id===id);
    if(!chosen)throw Error('Refresh and choose an original completed report retained in this project.');
    const ws=workspace,turn=generation,ticket=++captureGeneration;
    const result=await request('/api/source-reports/scientific-capture',{capture_id:id});
    if(!active||!valid(ws,turn)||ticket!==captureGeneration)return;
    if(result.workspace_key!==ws||result.capture_id!==id||result.edition_id!==chosen.edition_id||
        result.capture_sha256!==chosen.capture_sha256||result.state!=='complete')
      throw Error('The completed report changed. Refresh and review its exact retained capture.');
    capturePreview=result;error='';render();
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
    if(catalogRead&&catalogRead.workspace===ws&&catalogRead.generation===turn)return catalogRead.promise;
    const ticket=++catalogGeneration,read={workspace:ws,generation:turn,promise:null};
    read.promise=(async()=>{
      const result=await request('/api/source-reports/scientific-catalog');
      if(!active||!valid(ws,turn)||ticket!==catalogGeneration)return null;
      if(result.workspace_key!==ws)throw Error('The scientific report catalogue belongs to another Workspace.');
      sources=result.sources||[];editions=result.editions||[];
      capturedReports=result.captured_reports||[];captureIssues=result.capture_issues||[];
      if(capturePreview&&!capturedReports.some(row=>row.capture_id===capturePreview.capture_id&&
          row.capture_sha256===capturePreview.capture_sha256&&row.edition_id===capturePreview.edition_id)){
        captureGeneration++;capturePreview=null;
      }
      error='';render();return result;
    })().finally(()=>{if(catalogRead===read)catalogRead=null;});
    catalogRead=read;
    return read.promise;
  }
  async function preparePreview(){
    const ws=workspace,turn=generation,version=revision,selection=payload();
    orderedReportSources(sources,selection.sources);
    const result=await host.api(host.endpoint('/api/source-reports/scientific-preview'),{method:'POST',body:selection});
    if(!active||!valid(ws,turn)||revision!==version)return;
    if(result.workspace_key!==ws||JSON.stringify(result.sources.map(choice))!==JSON.stringify(selection.sources))
      throw Error('The preview returned a different ordered study selection.');
    preview=result;error='';render();
  }
  async function open(id,{isCurrent}={}){
    const ws=workspace,turn=generation,ticket=++detailGeneration;
    const current=()=>active&&valid(ws,turn)&&ticket===detailGeneration&&
      (typeof isCurrent!=='function'||isCurrent());
    if(!current())return;
    let result;
    try{result=await request('/api/source-reports/scientific-edition',{id});}
    catch(reason){if(!current())return;throw reason;}
    if(!current())return;
    if(result.workspace_key!==ws||result.edition?.id!==id||result.edition.state!=='complete')
      throw Error('The saved report differs from the chosen complete edition.');
    if(opened?.edition.id!==id){briefingPreview=null;briefingOpened=null;}
    opened=result;error='';render();
    panel.querySelector('[data-scientific-report-detail]').scrollIntoView({block:'start'});
    return result;
  }
  function renderDetail(){
    const target=panel.querySelector('[data-scientific-report-detail]'),row=opened.edition;
    target.innerHTML='<div class="source-reports-heading"><div><h3>'+esc(row.title)+'</h3><p>'+
      row.source_count+' studies · '+row.section_count+' sections · '+row.figure_count+' figures</p></div>'+
      '<button type="button" data-scientific-report-action="close">Close report</button></div>'+
      '<div class="inline-actions"><button type="button" data-scientific-report-action="revise"'+(busy||pending?' disabled':'')+'>Use these studies in another report</button>'+
      '<button type="button" data-scientific-report-action="export"'+(busy||pending?' disabled':'')+'>Prepare complete report ZIP</button>'+
      (typeof host.openStudy==='function'?'<button type="button" data-scientific-report-action="transfer"'+(busy?' disabled':'')+'>Transfer this report and its studies</button>':'')+
      (typeof host.prepareCustomerReview==='function'?'<button type="button" data-scientific-report-action="review">Prepare customer review</button>':'')+
      '<button type="button" data-scientific-report-action="backup">Back up Workspace with this report</button>'+
      (opened.archive?link(opened.archive.url,'Download report ZIP'):'')+'</div>'+
      '<p class="note">The report ZIP contains the rendered report, its selection, figures and retained report data. Study transfer also includes its ordered source collections and available original editable study history. The Workspace backup keeps the entire project.</p>'+
      reportSourcesHTML()+briefingHTML();
    panel.querySelector('[data-scientific-report-files]').innerHTML='<div class="table-scroll"><table><thead><tr><th>File</th><th>Size / SHA256</th><th></th></tr></thead><tbody>'+
      opened.files.map(item=>'<tr><td>'+esc(item.path)+'</td><td>'+size(item.bytes)+'<small class="mono">'+esc(item.sha256)+
        '</small></td><td>'+link(item.url,'Download')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function renderReportDocument(){
    const target=panel?.querySelector('[data-scientific-report-document-host]');
    if(!target)return;
    target.hidden=!opened?.viewer_url;
    for(const frame of target.children)frame.hidden=true;
    if(!opened?.viewer_url)return;
    const id=opened.edition.id+':'+opened.viewer_url;
    let frame=reportFrames.get(id);
    if(!frame){
      frame=document.createElement('iframe');frame.title=opened.edition.title;
      frame.setAttribute('sandbox','allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox');
      frame.referrerPolicy='no-referrer';frame.src=opened.viewer_url;reportFrames.set(id,frame);
    }
    if(frame.parentNode!==target)target.append(frame);
    frame.hidden=false;
  }
  async function inspectSource(row){
    if(!row)throw Error('Choose an original scientific source to read.');
    const ws=workspace,turn=generation;
    return sourceReader.open(row,{isCurrent:()=>active&&valid(ws,turn)});
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
        '<p class="note">The opened meeting briefing remains below this report while you refresh its saved files. Export the meeting file before changing Workspace or closing this browser.</p>':'')+'</section>';
  }
  function renderBriefingDocument(){
    const holder=panel.querySelector('[data-scientific-report-briefing-host]');
    for(const row of briefingFrames.values())row.shell.hidden=true;
    if(!opened||!briefingOpened){holder.hidden=true;return;}
    const id=JSON.stringify([workspace,opened.edition.id,briefingOpened.briefing.id,briefingOpened.viewer_url]);
    let saved=briefingFrames.get(id);
    if(!saved){
      const shell=document.createElement('section'),heading=document.createElement('h3'),frame=document.createElement('iframe');
      heading.textContent=briefingOpened.briefing.title+' — meeting briefing';
      shell.append(heading);
      const frameShell=document.createElement('div');frameShell.className='source-report-frame-shell';
      frame.title=heading.textContent;
      frame.setAttribute('sandbox','allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox');
      frame.setAttribute('allow','fullscreen');frame.setAttribute('allowfullscreen','');
      frame.referrerPolicy='no-referrer';frame.src=briefingOpened.viewer_url;
      frameShell.append(frame);shell.append(frameShell);holder.append(shell);
      saved={shell,frame};briefingFrames.set(id,saved);
    }
    holder.hidden=false;saved.shell.hidden=false;
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
    panel.querySelector('[data-scientific-report-briefing-host]').scrollIntoView({block:'start'});
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
    if(action==='inspect-available'){
      detailGeneration++;
      const value=panel.querySelector('[data-scientific-report-source]').value;
      return inspectSource(sources.find(item=>key(item)===value));
    }
    if(['add','up','down','remove','preview','render','revise','export','briefing-preview','briefing-prepare','capture-preview','capture-adopt'].includes(action)&&(busy||pending))
      throw Error('Recover the original report request before changing its selection or starting another.');
    if(action==='refresh'){await refresh();if(opened)await open(opened.edition.id);return;}
    if(action==='capture-preview')return previewCapture(button.dataset.id);
    if(action==='capture-close'){captureGeneration++;capturePreview=null;render();return;}
    if(action==='capture-adopt'){
      if(!capturePreview)throw Error('Review the completed report and its original source identity first.');
      return submit('source-reports.adopt',{capture_id:capturePreview.capture_id,
        capture_sha256:capturePreview.capture_sha256,edition_id:capturePreview.edition_id});
    }
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
    if(action==='review'&&opened){
      if(typeof host.prepareCustomerReview!=='function')throw Error('Open the complete application to prepare a customer review.');
      const original=opened,ws=workspace,turn=generation,ticket=detailGeneration;
      return host.prepareCustomerReview({workspace_key:ws,edition_id:original.edition.id,
        isCurrent:()=>valid(ws,turn)&&active&&opened===original&&detailGeneration===ticket});
    }
    if(action==='source'||action==='gis'||action==='read-source'){
      const pair={source_collection_id:button.dataset.collection,source_id:button.dataset.source};
      const id=button.dataset.report||null,ws=workspace,turn=generation,ticket=++detailGeneration;
      if(action==='gis'&&(busy||pending))throw Error('Recover the original report request before opening another workflow.');
      let row;
      if(id){
        if(opened?.edition.id!==id)throw Error('Open the selected saved report first.');
        const result=await request('/api/source-reports/scientific-edition',{id});
        if(!active||!valid(ws,turn)||ticket!==detailGeneration||opened?.edition.id!==id)return;
        if(result.workspace_key!==ws||result.edition?.id!==id||result.edition.state!=='complete')
          throw Error('The saved report differs from the selected original edition.');
        row=result.edition.sources.find(item=>key(item)===key(pair));
        if(row)row={...row,native_study:(result.native_studies||[]).find(item=>key(item)===key(pair))};
      }else{
        const result=await request('/api/source-reports/scientific-catalog');
        if(!active||!valid(ws,turn)||ticket!==detailGeneration)return;
        if(result.workspace_key!==ws)throw Error('The source catalog belongs to another Workspace.');
        row=result.sources.find(item=>key(item)===key(pair));
      }
      if(!row)throw Error('Choose a source retained in the selected original report.');
      if(action==='read-source')return inspectSource(row);
      if(action==='source')return host.openItem('sources',pair.source_collection_id);
      if(!row.native_study?.local_project||typeof host.openGISStudy!=='function'||!host.hasView?.('gis-projects'))
        throw Error('Open this native study in its restored original project with the editable GIS desk.');
      return host.openGISStudy({workspace_key:ws,...pair,...(id?{scientific_report_id:id}:{})});
    }
    if(action==='backup')return host.openBackup();
  }
  async function mount(container,{loadCatalog=true}={}){
    const ws=host.getWorkspace();
    if(workspace!==ws){reset();workspace=ws;restoreDraft();}
    active=true;ensure(container);render();
    if(loadCatalog)await refresh();
  }
  async function openForStudy(value){
    if(!value||value.workspace_key!==host.getWorkspace()||value.workspace_key!==workspace)
      throw Error('Open the saved scientific report in its receiving Workspace.');
    if(typeof value.id!=='string'||!/^[0-9a-f]{64}$/.test(value.id))
      throw Error('Choose an exact saved scientific report edition.');
    if(!active||!panel)throw Error('Open Sources before reopening the saved report.');
    if(typeof value.isCurrent==='function'&&!value.isCurrent())return;
    return open(value.id,{isCurrent:value.isCurrent});
  }
  async function openForSources(value){
    if(!value||value.workspace_key!==host.getWorkspace()||value.workspace_key!==workspace)
      throw Error('Open the prepared report sources in their original Workspace.');
    if(!Array.isArray(value.sources)||!value.sources.length)
      throw Error('Choose one or more original prepared report sources.');
    const selectionMode=value.selection_mode??'append';
    if(!['append','replace'].includes(selectionMode))throw Error('Choose a supported scientific report source selection mode.');
    if(busy||pending)throw Error('Finish or recover the retained scientific report request before adding more sources.');
    const ws=workspace,turn=generation,version=revision,intent=++sourceIntent;
    const current=()=>active&&valid(ws,turn)&&intent===sourceIntent&&
      (typeof value.isCurrent!=='function'||value.isCurrent());
    if(!current())return null;
    const catalogue=await refresh();
    if(!current()||!catalogue)return null;
    if(busy||pending)throw Error('Finish or recover the retained scientific report request before adding more sources.');
    if(selectionMode==='replace'&&revision!==version)
      throw Error('The report draft changed before its prepared sources opened. Open the prepared selection again.');
    const incoming=orderedReportSources(catalogue.sources||[],value.sources).map(choice);
    if(selectionMode==='replace'){
      selected=incoming;
      title=typeof value.title==='string'?value.title:'';
    }else{
      const seen=new Set(selected.map(key));
      for(const row of incoming){if(!seen.has(key(row))){selected.push(row);seen.add(key(row));}}
      if(!title.trim()&&typeof value.title==='string')title=value.title;
    }
    changed();error='';render();
    panel.scrollIntoView({block:'start'});
    panel.querySelector('[data-scientific-report-action="preview"]').focus?.();
    return {workspace_key:ws,sources:selected.map(choice)};
  }
  function detach(){active=false;sourceIntent++;catalogGeneration++;catalogRead=null;detailGeneration++;captureGeneration++;sourceReader.detach();if(panel)panel.hidden=true;}
  function reset(){
    generation++;revision++;detailGeneration++;if(panel)panel.remove();
    briefingFrames.clear();reportFrames.clear();sourceReader.reset();sourceIntent++;catalogGeneration++;catalogRead=null;
    panel=null;workspace=null;sources=[];editions=[];selected=[];title='';
    capturedReports=[];captureIssues=[];capturePreview=null;captureGeneration++;
    contact={name:'',organization:'',email:''};
    preview=null;opened=null;briefingPreview=null;briefingOpened=null;busy=false;pending=null;error='';storageIssue='';active=false;
  }
  return {mount,detach,reset,refresh,openForSources,openForStudy};
}
