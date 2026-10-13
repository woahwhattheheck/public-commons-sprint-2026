/** Read delivered scientific editions and their exact saved change register. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=v=>v==null?'—':typeof v==='string'?v:JSON.stringify(v);
const option=(value,label,selected)=>`<option value="${esc(value)}"${value===selected?' selected':''}>${esc(label)}</option>`;
const label=v=>typeof v==='object'&&v?.label?v.label:show(v);
const download=(url,text)=>`<a href="${esc(url)}${url.includes('?')?'&':'?'}download=1" download>${esc(text)}</a>`;
const terminal=new Set(['failed','cancelled','interrupted']);
const operationId=()=>{
  if(typeof crypto.randomUUID==='function')return 'report-changes-'+crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  return 'report-changes-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
};

class ReportChangesDesk {
  constructor(root,host){
    this.root=root;this.host=host;this.workspace=host.getState()?.workspace_key;
    this.storage='upstate.report-changes/'+this.workspace;
    this.controller=new AbortController();this.generation=0;this.readGeneration=0;this.gone=false;
    this.catalog={editions:[],comparisons:[],issues:[]};this.left='';this.right='';
    this.plan={row_keys:{},include_positions:false};this.preview=null;this.opened=null;this.page=null;
    this.filter={category:'',table_id:'',status:''};this.history=[];this.after=0;
    this.pending=null;this.busy=false;this.error='';this.notice='';this.archive=null;
    this.transferGeneration=0;
    try{
      const saved=JSON.parse(sessionStorage.getItem(this.storage)||'null');
      if(saved?.workspace===this.workspace){
        this.left=typeof saved.left==='string'?saved.left:'';this.right=typeof saved.right==='string'?saved.right:'';
        if(saved.plan&&typeof saved.plan.row_keys==='object')this.plan=saved.plan;
        const p=saved.pending;
        if(p&&['report-changes.prepare','report-changes.export'].includes(p.action)&&typeof p.operation_id==='string'&&p.payload&&typeof p.payload==='object')this.pending=p;
      }
    }catch{}
    root.classList.add('report-changes-desk');
    root.addEventListener('click',e=>{
      const button=e.target.closest('[data-report-change-action]');
      if(!button||!root.contains(button))return;
      e.preventDefault();void this.act(button).catch(error=>this.fail(error));
    },{signal:this.controller.signal});
    root.addEventListener('change',e=>this.change(e),{signal:this.controller.signal});
  }
  valid(){return !this.gone&&this.host.getState()?.workspace_key===this.workspace;}
  fail(error){if(this.valid()){this.error=error?.message||String(error);this.busy=false;this.render();}}
  save(){sessionStorage.setItem(this.storage,JSON.stringify({workspace:this.workspace,left:this.left,right:this.right,plan:this.plan,pending:this.pending}));}
  read(path,args={}){return this.host.api(this.host.endpoint(path,args));}
  async start(){this.render();await this.refresh();if(this.pending?.id)await this.finish();}
  async refresh(){
    const turn=++this.generation;const data=await this.read('/api/report-changes/catalog');
    if(!this.valid()||turn!==this.generation)return;
    if(data.workspace_key!==this.workspace)throw Error('The report catalogue belongs to another Workspace.');
    this.catalog=data;
    const exists=id=>data.editions.some(r=>r.id===id);
    if(!exists(this.left))this.left=data.editions[0]?.id||'';
    if(!exists(this.right))this.right=data.editions[1]?.id||this.left;
    this.render();
  }
  change(event){
    if(!this.valid())return;
    const field=event.target.dataset.reportChangeField;
    if(['left','right','include_positions','key'].includes(field)){
      if(this.pending||this.busy){this.error='Recover the original task before changing its selected reports.';this.render();return;}
      if(field==='left'||field==='right'){
        this[field]=event.target.value;this.plan={row_keys:{},include_positions:false};this.preview=null;
      }else if(field==='include_positions'){
        this.plan.include_positions=event.target.checked;if(this.preview)this.preview.id=null;
      }else{
        const table=event.target.dataset.table,index=Number(event.target.value),keys=new Set(this.plan.row_keys[table]||[]);
        if(event.target.checked)keys.add(index);else keys.delete(index);
        if(keys.size)this.plan.row_keys[table]=[...keys].sort((a,b)=>a-b);else delete this.plan.row_keys[table];
        if(this.preview)this.preview.id=null;
      }
      ++this.generation;this.error='';try{this.save();}catch{this.error='Browser storage is unavailable; keep this desk open.';}
      this.render();return;
    }
    if(field&&field.startsWith('filter_')){
      this.filter[field.slice(7)]=event.target.value;this.history=[];this.after=0;
      void this.readRows(0).catch(error=>this.fail(error));
    }
  }
  async review(){
    if(!this.left||!this.right)throw Error('Choose two complete saved scientific editions.');
    const turn=++this.generation,payload={left:this.left,right:this.right,plan:structuredClone(this.plan)};
    this.busy=true;this.error='';this.render();
    try{
      const result=await this.host.api(this.host.endpoint('/api/report-changes/preview'),{method:'POST',body:payload});
      if(!this.valid()||turn!==this.generation)return;
      if(result.workspace_key!==this.workspace||result.left.id!==payload.left||result.right.id!==payload.right)throw Error('The preview returned different original reports.');
      this.preview=result;this.notice='Review table identities and explicit row keys below. Every original file stays with the comparison.';
    }finally{if(this.valid()&&turn===this.generation){this.busy=false;this.render();}}
  }
  async queue(action,payload){
    if(this.pending||this.busy)throw Error('Recover the current original task first.');
    this.pending={operation_id:operationId(),action,payload,id:null,state:'submitting'};
    try{this.save();}catch{this.pending=null;throw Error('Free browser storage for the original operation identity before submitting.');}
    await this.submit();
  }
  async submit(){
    const pending=this.pending;if(!pending||!this.valid())return;
    this.busy=true;this.error='';this.render();
    try{
      const response=await this.host.api('/api/actions',{method:'POST',body:{workspace:this.workspace,action:pending.action,payload:pending.payload,operation_id:pending.operation_id}});
      if(!this.valid()||this.pending!==pending)return;
      const task=response.task||response;
      if(!task?.id)throw Error('The original task response lacks its retained task identifier. Recover the same request.');
      this.pending={...pending,id:task.id,state:task.state};this.save();this.notice='Original task '+task.id+' is '+task.state+'.';
      if(task.state==='complete'||terminal.has(task.state))await this.finish();
      await this.host.refresh({force:true});
    }catch(error){
      if(this.valid()&&this.pending?.operation_id===pending.operation_id){
        if([400,401,403,404,405,413,415,422].includes(Number(error?.status))&&!this.pending.id){this.pending=null;this.save();}
        else this.notice='The operation identity is retained. Recover the same request rather than submit a duplicate.';
      }
      throw error;
    }finally{if(this.valid()){this.busy=false;this.render();}}
  }
  async finish(){
    const pending=this.pending;if(!pending?.id||!this.valid()||this.resolving===pending.id)return;
    this.resolving=pending.id;
    try{
      const task=await this.read('/api/task',{id:pending.id});
      if(!this.valid()||this.pending?.id!==pending.id)return;
      if(task.id!==pending.id)throw Error('The task response belongs to another operation.');
      this.pending.state=task.state;this.save();
      if(task.state==='complete'){
        const id=task.result?.comparison_id;
        if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('The completed task has no saved comparison identifier.');
        await this.open(id);
        if(!this.valid())return;
        if(pending.action==='report-changes.export')this.archive=task._downloads?.[0]||task.result?.download||null;
        this.pending=null;this.save();this.notice='The complete comparison is retained and ready to reopen.';
        await this.refresh();
      }else if(terminal.has(task.state)){
        this.error=task.error?.message||('The task is '+task.state+'. Retry resumes this same comparison after the cause is repaired.');
      }
    }finally{if(this.resolving===pending.id)this.resolving=null;if(this.valid())this.render();}
  }
  async open(id){
    ++this.transferGeneration;
    const turn=++this.readGeneration;const result=await this.read('/api/report-changes/detail',{id});
    if(!this.valid()||turn!==this.readGeneration)return;
    if(result.workspace_key!==this.workspace||result.comparison?.id!==id)throw Error('The selected comparison changed.');
    this.opened=result;this.archive=null;this.filter={category:'',table_id:'',status:''};this.history=[];this.after=0;
    this.page=null;this.error='';this.render();await this.readRows(0);
  }
  async transfer(id){
    if(!this.valid())return;
    if(!/^[0-9a-f]{64}$/.test(id||''))throw Error('Choose a saved report comparison.');
    const turn=++this.transferGeneration,workspace=this.workspace;
    try{
      const result=await this.read('/api/report-changes/detail',{id});
      if(!this.valid()||turn!==this.transferGeneration)return;
      const value=result.comparison;
      if(result.workspace_key!==workspace||value?.id!==id||value.schema!=='upstate.scientific-report-comparison/v1'||value.state!=='complete')
        throw Error('The transfer returned a different completed comparison.');
      if(typeof this.host.openDesk!=='function')throw Error('Open this comparison in the current original operator to transfer its editable history.');
      return await this.host.openDesk('study-transfer','openForStudies',{
        workspace_key:workspace,roots:[{kind:'scientific-report-comparisons',id,title:value.title,state:'complete'}]
      });
    }catch(error){
      if(!this.valid()||turn!==this.transferGeneration)return;
      throw error;
    }
  }
  async openForStudy(selection={}){
    if(!this.valid()||selection.workspace_key!==this.workspace)
      throw Error('Choose the comparison in its registered Workspace.');
    if(!/^[0-9a-f]{64}$/.test(selection.id||''))throw Error('Choose the original saved comparison identifier.');
    await this.open(selection.id);
    if(!this.valid()||this.opened?.comparison.id!==selection.id)return;
    return {view:'report-changes',workspace_key:this.workspace,id:selection.id};
  }
  async readRows(after){
    if(!this.opened||!this.valid())return;
    const turn=++this.readGeneration,id=this.opened.comparison.id;
    const result=await this.read('/api/report-changes/rows',{id,after,limit:100,...this.filter});
    if(!this.valid()||turn!==this.readGeneration||this.opened?.comparison.id!==id)return;
    if(result.workspace_key!==this.workspace||result.comparison_id!==id)throw Error('The change page belongs to another comparison.');
    this.page=result;this.after=after;this.render();
  }
  async update(state){
    if(!this.valid()){this.detach();return;}
    if(this.pending){
      const task=(state.tasks||[]).find(t=>this.pending.id?t.id===this.pending.id:t.operation_id===this.pending.operation_id);
      if(task){
        const changed=!this.pending.id||task.state!==this.pending.state;
        this.pending.id=task.id;this.save();if(changed)await this.finish();
      }
    }
  }
  async act(button){
    const action=button.dataset.reportChangeAction;
    if(action==='refresh'){await this.refresh();return;}
    if(action==='review'){await this.review();return;}
    if(action==='prepare'){
      if(!this.preview?.id)throw Error('Review this exact selection and matching plan first.');
      await this.queue('report-changes.prepare',{left:this.left,right:this.right,plan:structuredClone(this.plan),preview_id:this.preview.id});return;
    }
    if(action==='recover'){if(this.pending?.id)await this.finish();else await this.submit();return;}
    if(action==='retry'){
      if(!terminal.has(this.pending?.state))throw Error('The original task is not finished.');
      const {action:taskAction,payload}=this.pending;this.pending=null;this.save();await this.queue(taskAction,payload);return;
    }
    if(action==='open'){await this.open(button.dataset.id);return;}
    if(action==='transfer'){await this.transfer(button.dataset.id||this.opened?.comparison.id);return;}
    if(action==='export'){await this.queue('report-changes.export',{id:this.opened.comparison.id});return;}
    if(action==='next'&&this.page?.next_after!=null){this.history.push(this.after);await this.readRows(this.page.next_after);return;}
    if(action==='previous'&&this.history.length){await this.readRows(this.history.pop());return;}
  }
  render(){
    if(!this.valid())return;
    const locked=this.busy||!!this.pending,disabled=locked?' disabled':'';
    const opts=id=>this.catalog.editions.map(row=>option(row.id,row.title+' · '+row.id.slice(0,12),id)).join('');
    this.root.innerHTML=`<header><h2>Report changes</h2><p>Compare complete saved scientific editions and hand over both originals with every recorded change.</p><button type="button" data-report-change-action="refresh">Refresh reports</button></header>
      <p role="status" class="rc-status">${esc(this.error||this.notice||(this.busy?'Working…':''))}</p>
      ${this.pending?`<section class="rc-panel"><strong>Retained operation</strong><p class="rc-mono">${esc(this.pending.id||this.pending.operation_id)} · ${esc(this.pending.state)}</p><button data-report-change-action="recover"${this.busy?' disabled':''}>${this.pending.id?'Refresh original task':'Recover original request'}</button>${terminal.has(this.pending.state)?'<button data-report-change-action="retry">Retry this comparison</button>':''}</section>`:''}
      <div class="rc-pair"><label>Earlier edition<select data-report-change-field="left"${disabled}><option value="">Choose a saved report</option>${opts(this.left)}</select></label><label>Later edition<select data-report-change-field="right"${disabled}><option value="">Choose a saved report</option>${opts(this.right)}</select></label></div>
      <p class="rc-note">Choose the intended order explicitly. Report titles and identifiers are preserved; this desk does not infer a delivery date.</p>
      <div class="rc-actions"><button data-report-change-action="review"${locked||!this.left||!this.right?' disabled':''}>Review reports and matching</button><button data-report-change-action="prepare"${locked||!this.preview?.id?' disabled':''}>${this.preview?.existing?'Reopen exact comparison':'Prepare complete comparison'}</button></div>
      ${this.previewHTML(disabled)}
      ${this.catalog.issues.length?`<section class="rc-panel"><h3>Saved comparisons needing attention</h3>${this.catalog.issues.map(row=>`<p>${esc(row.id)}: ${esc(row.message)}</p>`).join('')}</section>`:''}
      <h3>Saved comparisons</h3>${this.catalog.comparisons.length?`<div class="rc-scroll"><table><thead><tr><th>Earlier → later</th><th>Contents</th><th>Open</th></tr></thead><tbody>${this.catalog.comparisons.map(row=>`<tr><td>${esc(row.left.title)} → ${esc(row.right.title)}<small class="rc-mono">${esc(row.id)}</small></td><td>${row.change_count.toLocaleString()} recorded changes</td><td><button data-report-change-action="open" data-id="${esc(row.id)}">Open comparison</button><button data-report-change-action="transfer" data-id="${esc(row.id)}">Transfer editable comparison</button></td></tr>`).join('')}</tbody></table></div>`:'<p>Saved comparisons appear here after preparation.</p>'}
      ${this.detailHTML()}`;
  }
  previewHTML(disabled){
    if(!this.preview)return '<p class="rc-note">'+(this.catalog.editions.length<2?'Prepare at least two scientific editions in Sources, then select them here.':'Review the selected editions to choose record keys, or reopen a saved comparison below.')+'</p>';
    return `<section class="rc-panel"><h3>Record matching</h3><p>Sections match by heading and occurrence; tables match by their occurrence within that section. Without selected keys, exact-row additions and removals retain duplicate counts. A key must uniquely identify every row in both editions.</p><label class="rc-check"><input type="checkbox" data-report-change-field="include_positions"${this.plan.include_positions?' checked':''}${disabled}> Include individual position-only changes</label>
      ${this.preview.tables.map(table=>`<fieldset><legend>${esc(table.heading)} · table ${table.identity.table_occurrence}</legend><p>${table.left_rows.toLocaleString()} earlier rows → ${table.right_rows.toLocaleString()} later rows</p><p class="rc-note">${esc(table.right_caption||table.left_caption||'Original table')}</p><div class="rc-keys">${table.key_options.map(key=>`<label class="rc-check"><input type="checkbox" data-report-change-field="key" data-table="${esc(table.id)}" value="${key.left}"${(this.plan.row_keys[table.id]||[]).includes(key.left)?' checked':''}${disabled}> ${esc(label(key.label))}</label>`).join('')||'<span>No unique shared column label is available; exact-row matching applies.</span>'}</div></fieldset>`).join('')}
      <p>${this.preview.id?'This exact plan has been reviewed.':'Matching changed. Review the reports again before preparing.'}</p></section>`;
  }
  detailHTML(){
    if(!this.opened)return '';
    const {comparison:record,originals,files}=this.opened;
    const categories=[...new Set(record.statistics.map(row=>row.category))];
    return `<section class="rc-detail"><h3>${esc(record.title)}</h3><p>${record.change_count.toLocaleString()} recorded changes across ${record.tables.length} original tables. Both complete editions are retained in this comparison.</p>
      <div class="rc-pair">${originals.map(row=>`<section class="rc-panel"><strong>${row.side==='left'?'Earlier':'Later'}: ${esc(row.title)}</strong><small class="rc-mono">${esc(row.id)}</small>${row.viewer_url?`<p><a href="${esc(row.viewer_url)}" target="_blank" rel="noopener noreferrer">Open complete original report</a></p>`:''}</section>`).join('')}</div>
      <div class="rc-actions"><button data-report-change-action="transfer" data-id="${esc(record.id)}">Transfer editable comparison</button><button data-report-change-action="export"${this.pending||this.busy?' disabled':''}>Prepare full comparison ZIP</button>${this.archive?download(this.archive.url,'Download both originals and comparison'):''}${files.map(row=>download(row.url,row.label)).join('')}</div>
      <p class="rc-note">The ZIP can be reopened and re-compared offline without the GIS runtime. Original units, support, methods, headings and source bytes remain unchanged.</p>
      <div class="rc-filters"><label>Change type<select data-report-change-field="filter_category">${option('','All types',this.filter.category)}${categories.map(c=>option(c,c,this.filter.category)).join('')}</select></label>
      <label>Original table<select data-report-change-field="filter_table_id">${option('','All tables and metadata',this.filter.table_id)}${record.tables.map(t=>option(t.id,t.heading+' · table '+t.identity.table_occurrence,this.filter.table_id)).join('')}</select></label>
      <label>Status<select data-report-change-field="filter_status">${option('','All statuses',this.filter.status)}${['changed','added','removed','position_changed'].map(s=>option(s,s.replaceAll('_',' '),this.filter.status)).join('')}</select></label></div>
      ${this.rowsHTML(record)}<div class="rc-actions"><button data-report-change-action="previous"${this.history.length?'':' disabled'}>Previous changes</button><button data-report-change-action="next"${this.page?.next_after!=null?'':' disabled'}>Next changes</button><span>${this.page?(this.page.complete?'End of selected change register':'More changes follow'):'Reading changes…'}</span></div></section>`;
  }
  rowsHTML(record){
    if(!this.page)return '<p>Reading the complete change register…</p>';
    if(!this.page.rows.length)return '<p>No changes match this selection.</p>';
    const tables=new Map(record.tables.map(t=>[t.id,t]));
    const cells=(row,side)=>{
      const table=tables.get(row.table_id),value=row[side];
      if(row.category!=='row'||!table||!Array.isArray(value))return `<pre>${esc(row[side+'_json']??'—')}</pre>`;
      const columns=table[side+'_columns'];
      return '<dl>'+value.map((v,i)=>`<dt>${esc(label(columns[i]))}</dt><dd>${esc(row[side+'_cells']?.[i]??show(v))}</dd>`).join('')+'</dl>';
    };
    return `<div class="rc-scroll"><table><thead><tr><th>Change / original position</th><th>Earlier</th><th>Later</th></tr></thead><tbody>${this.page.rows.map(row=>`<tr><td><strong>${esc(row.status.replaceAll('_',' '))}</strong><small>#${row.seq} · ${esc(row.category)}</small>${row.table_id?`<small>${esc(tables.get(row.table_id)?.heading)}</small>`:''}<pre>${esc(show(row.locator))}</pre><small>Position ${row.left_position==null?'—':row.left_position+1} → ${row.right_position==null?'—':row.right_position+1}</small></td><td>${cells(row,'left')}</td><td>${cells(row,'right')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  detach(){this.transferGeneration++;this.gone=true;this.generation++;this.readGeneration++;this.controller.abort();}
}

export function attachReportChanges(host){
  let active=null;
  return {mount(root){active?.detach();active=new ReportChangesDesk(root,host);const instance=active;void instance.start().catch(error=>instance.fail(error));},
    update(state){const instance=active;if(instance)void instance.update(state).catch(error=>instance.fail(error));},
    async openForStudy(selection){if(!active)throw Error('Open the original Report changes desk first.');return active.openForStudy(selection);},
    detach(){active?.detach();active=null;}};
}
