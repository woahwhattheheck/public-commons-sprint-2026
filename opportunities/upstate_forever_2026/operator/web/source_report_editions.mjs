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
  let sources=[],editions=[],selected=[],title='',contact={name:'Upper Savannah project team',organization:'Internal scientific review',email:''};
  let preview=null,opened=null,busy=false,error='',pending=null;
  const valid=(ws,turn)=>workspace===ws&&host.getWorkspace()===ws&&generation===turn;
  const request=(path,values={})=>host.api(host.endpoint(path,values));
  const payload=()=>({sources:selected.map(choice),...(title.trim()?{title:title.trim()}:{}),contact:{...contact}});
  function changed(){revision++;preview=null;pending=null;saveDraft();}
  function saveDraft(){
    try{sessionStorage.setItem('scientific-report-draft:'+workspace,JSON.stringify({selected,title,contact}));}catch{}
  }
  function restoreDraft(){
    try{
      const saved=JSON.parse(sessionStorage.getItem('scientific-report-draft:'+workspace)||'null');
      if(saved&&Array.isArray(saved.selected)){selected=saved.selected.map(choice);title=typeof saved.title==='string'?saved.title:'';
        contact={name:String(saved.contact?.name??''),organization:String(saved.contact?.organization??''),email:String(saved.contact?.email??'')};}
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
    const selectedKeys=new Set(selected.map(key)),remaining=sources.filter(row=>!selectedKeys.has(key(row)));
    panel.innerHTML='<div class="source-reports-heading"><div><h3>Prepare a scientific report</h3>'+
      '<p>Select saved scientific studies in reading order. The report retains their methods, periods, figures and source data.</p></div>'+
      '<button type="button" data-scientific-report-action="refresh">Refresh saved reports</button></div>'+
      '<p data-scientific-report-status role="status">'+esc(error||selectionIssue||(busy?'Working through the original task queue…':''))+'</p>'+
      '<div class="scientific-report-fields"><label>Report title <span class="note">(optional)</span><input data-scientific-report-field="title" value="'+esc(title)+'"></label>'+
      ['name','organization','email'].map(field=>'<label>'+esc({name:'Prepared by',organization:'Organization',email:'Contact email'}[field])+
        '<input data-scientific-report-field="'+field+'" value="'+esc(contact[field])+'"></label>').join('')+'</div>'+
      '<label class="source-reports-document">Add a saved scientific study<select data-scientific-report-source>'+
        '<option value="">Choose an original report source</option>'+remaining.map(row=>'<option value="'+esc(key(row))+'">'+esc(row.title)+' · '+esc(row.vintage)+'</option>').join('')+
        '</select></label><button type="button" data-scientific-report-action="add"'+(!remaining.length||busy?' disabled':'')+'>Add study</button>'+
      (selected.length?'<ol class="scientific-report-order">'+selected.map((row,index)=>{
        const original=sources.find(item=>key(item)===key(row));
        return '<li><div><strong>'+esc(original?.title||row.source_id)+'</strong><small>'+esc(original?.vintage||'Retained selection')+
          ' · '+esc(row.source_id)+'</small></div><div class="inline-actions">'+
          '<button type="button" data-scientific-report-action="up" data-index="'+index+'"'+(!index||busy?' disabled':'')+' aria-label="Move study '+(index+1)+' earlier">Earlier</button>'+
          '<button type="button" data-scientific-report-action="down" data-index="'+index+'"'+(index===selected.length-1||busy?' disabled':'')+' aria-label="Move study '+(index+1)+' later">Later</button>'+
          '<button type="button" data-scientific-report-action="remove" data-index="'+index+'"'+(busy?' disabled':'')+'>Remove</button></div></li>';
      }).join('')+'</ol>':'<p class="note">Saved calibration reviews, Scientific interpretation, native process studies and observed-water reports appear here after their report source is prepared.</p>')+
      '<div class="inline-actions"><button type="button" data-scientific-report-action="preview"'+(!chosen.length||selectionIssue||busy?' disabled':'')+'>Preview selected sources</button>'+
      '<button type="button" data-scientific-report-action="render"'+(!preview||busy?' disabled':'')+'>'+(preview?.existing?'Reopen existing report':'Prepare PDF, HTML and data')+'</button></div>'+
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
    opened=result;error='';render();
    panel.querySelector('[data-scientific-report-detail]').scrollIntoView({block:'start'});
  }
  function renderDetail(){
    const target=panel.querySelector('[data-scientific-report-detail]'),row=opened.edition;
    target.innerHTML='<div class="source-reports-heading"><div><h3>'+esc(row.title)+'</h3><p>'+
      row.source_count+' studies · '+row.section_count+' sections · '+row.figure_count+' figures</p></div>'+
      '<button type="button" data-scientific-report-action="close">Close report</button></div>'+
      '<div class="inline-actions"><button type="button" data-scientific-report-action="revise">Use these studies in another report</button>'+
      '<button type="button" data-scientific-report-action="export"'+(busy?' disabled':'')+'>Prepare complete report ZIP</button>'+
      '<button type="button" data-scientific-report-action="backup">Back up Workspace with this report</button>'+
      (opened.archive?link(opened.archive.url,'Download report ZIP'):'')+'</div>'+
      '<p class="note">The report ZIP contains the rendered report, its selection, figures and retained report data. The Workspace backup also keeps the original editable studies and source editions.</p>'+
      (opened.viewer_url?'<div class="source-report-frame-shell"><iframe title="'+esc(row.title)+
        '" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer" src="'+esc(opened.viewer_url)+'"></iframe></div>':'')+
      '<div class="table-scroll"><table><thead><tr><th>File</th><th>Size / SHA256</th><th></th></tr></thead><tbody>'+
      opened.files.map(item=>'<tr><td>'+esc(item.path)+'</td><td>'+size(item.bytes)+'<small class="mono">'+esc(item.sha256)+
        '</small></td><td>'+link(item.url,'Download')+'</td></tr>').join('')+'</tbody></table></div>';
  }
  async function submit(action,body){
    if(busy)return;
    const ws=workspace,turn=generation;
    const requestKey=JSON.stringify([ws,action,body]);
    if(!pending||pending.key!==requestKey)pending={key:requestKey,id:crypto.randomUUID()};
    const requestBody={workspace:ws,action,payload:body,operation_id:pending.id};
    busy=true;error='';render();
    try{
      const result=await host.api('/api/actions',{method:'POST',body:requestBody});
      if(!valid(ws,turn))return;
      if(result.workspace&&result.workspace!==ws)throw Error('The retained report task belongs to another Workspace.');
      pending=null;await host.refresh({force:true});
      if(!valid(ws,turn))return;
      await host.showTask(result.id);
      await refresh();
    }finally{if(valid(ws,turn)){busy=false;render();}}
  }
  async function dispatch(button){
    const action=button.dataset.scientificReportAction;
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
    if(action==='preview')return preparePreview();
    if(action==='render'){
      if(!preview)throw Error('Preview the current ordered selection first.');
      if(preview.existing)return open(preview.id);
      return submit('source-reports.render',{...payload(),preview_id:preview.id});
    }
    if(action==='open')return open(button.dataset.id);
    if(action==='close'){detailGeneration++;opened=null;render();return;}
    if(action==='revise'&&opened){
      const identity=opened.edition.render_identity,selection=identity.selection;
      selected=(selection.observed_context_sources||[selection.source_roles.OBSERVED_CONTEXT]).map(choice);
      title=opened.edition.title;contact={...identity.contact};changed();render();
      panel.scrollIntoView({block:'start'});return;
    }
    if(action==='export'&&opened)return submit('source-reports.export',{id:opened.edition.id});
    if(action==='backup')return host.openBackup();
  }
  async function mount(container){
    const ws=host.getWorkspace();
    if(workspace!==ws){reset();workspace=ws;restoreDraft();}
    active=true;ensure(container);render();await refresh();
  }
  function detach(){active=false;if(panel)panel.hidden=true;}
  function reset(){
    generation++;revision++;detailGeneration++;if(panel)panel.remove();
    panel=null;workspace=null;sources=[];editions=[];selected=[];title='';
    contact={name:'Upper Savannah project team',organization:'Internal scientific review',email:''};
    preview=null;opened=null;busy=false;pending=null;error='';active=false;
  }
  return {mount,detach,reset,refresh};
}
