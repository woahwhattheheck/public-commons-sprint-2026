// MIT. Mounted exact-source intake and receiving in the original commissioning desk.
const BASE='/api/commissioning/source-bundles';
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,SHA=/^[a-f0-9]{64}$/;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>value?String(value).slice(0,12):'—';
const bytes=value=>{
  const n=Number(value);if(!Number.isFinite(n))return '—';
  if(n<1024)return n+' B';
  const index=Math.min(3,Math.floor(Math.log(n)/Math.log(1024)));
  return (n/1024**index).toFixed(n>=1024**index*10?1:2)+' '+['B','KiB','MiB','GiB'][index];
};
const uid=prefix=>prefix+'-'+crypto.randomUUID();
function fail(message,code){return Object.assign(new Error(message),{code});}
async function defaultApi(path,input) {
  const response=await fetch(path,{method:input===undefined?'GET':'POST',credentials:'same-origin',
    headers:input===undefined?{}:{'content-type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});
  const value=await response.json();
  if(!response.ok)throw fail(value.detail||value.message||value.error||'Source request failed.',value.error);
  return value;
}
function isCase(value) {
  return value&&ID.test(value.id)&&SHA.test(value.revision)&&typeof value.actor==='string'&&value.actor.trim();
}
function href(id,kind,name) {
  return BASE+'/download?'+new URLSearchParams({id,kind,...(name?{name}:{})});
}
function fileRows(files,{links=false,id}={}) {
  return '<div class="sfb-scroll"><table><thead><tr><th>Original file</th><th>Role</th><th>Bytes</th><th>SHA-256</th>'+
    (links?'<th>File</th>':'<th>State</th>')+'</tr></thead><tbody>'+
    files.map(file=>'<tr><td class="sfb-file">'+escape(file.path||file.name)+'</td><td>'+escape(file.role||'source')+
      '</td><td class="sfb-number">'+escape(file.bytes)+'</td><td><code>'+escape(file.sha256||file.retained?.sha256||'Assigned after full upload')+
      '</code></td><td>'+(links?'<a href="'+escape(href(id,'file',file.path))+'" download>Download</a>':
      file.present?'Retained':'Needs upload')+'</td></tr>').join('')+'</tbody></table></div>';
}

/** getCase -> {id,revision,actor,dirty}. The host owns all case/terms editing.
 * onAttached receives the original case CAS result and must load only that case.
 * api is the host's existing JSON/auth wrapper; binary uploads use same-origin XHR.
 */
export function mountSourceBundlePanel({root,api=defaultApi,getCase,onAttached=async()=>{}}) {
  if(!root||typeof getCase!=='function')throw new TypeError('A host element and original saved-case callback are required.');
  root.classList.add('sfb-panel');
  const storageKey='sf49.source-bundle.command:'+location.pathname;
  const state={case:null,rows:[],total:0,offset:0,selected:null,chosen:[],archive:null,label:'',
    busy:false,pending:null,pendingResult:null,message:'',error:'',progress:null,mode:'source'};
  let closed=false,xhr=null,pollTimer=null,pollReject=null,viewEpoch=0;
  try {const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');
    if(saved&&ID.test(saved.id)&&ID.test(saved.requestId)&&saved.input?.id===saved.id)state.pending=saved;
  }catch{}
  function retainCommand(value) {
    // Retain before dispatch. If local storage is unavailable, do not start a
    // mutation whose exact request the browser cannot recover.
    sessionStorage.setItem(storageKey,JSON.stringify(value));state.pending=value;state.pendingResult=null;
  }
  function finishCommand() {sessionStorage.removeItem(storageKey);state.pending=null;state.pendingResult=null;}
  function selected() {return state.rows.find(value=>value.id===state.selected)||null;}
  function sleep() {
    return new Promise((done,reject)=>{pollReject=reject;pollTimer=setTimeout(()=>{pollTimer=null;pollReject=null;done();},1000);});
  }
  async function savedCase() {
    const value=await getCase();
    if(!isCase(value))throw fail('Open a saved merchant case with its operator identity.');
    if(value.dirty)throw fail('Save the current case and workorder terms before retaining or attaching a source bundle.');
    return {id:value.id,revision:value.revision,actor:value.actor};
  }
  async function refresh({keepSelection=true}={}) {
    const epoch=++viewEpoch,value=await getCase();
    if(!isCase(value)) {if(epoch===viewEpoch){state.case=null;state.rows=[];state.total=0;state.selected=null;render();}return;}
    const changed=state.case?.id!==value.id;
    const page=await api(BASE+'/state?'+new URLSearchParams({caseId:value.id,offset:changed?'0':String(state.offset),limit:'30'}));
    if(closed||epoch!==viewEpoch)return;
    state.case=value;state.rows=page.transfers;state.total=page.total;state.offset=page.offset;
    if(changed||!keepSelection||!state.rows.some(row=>row.id===state.selected))state.selected=state.rows[0]?.id??null;
    render();
  }
  async function getTransfer(id) {
    const value=await api(BASE+'/transfer?id='+encodeURIComponent(id));
    if(state.case?.id===value.caseId) {
      const at=state.rows.findIndex(row=>row.id===id);
      if(at<0)state.rows.unshift(value);else state.rows[at]=value;
      state.selected=id;
    }
    render();return value;
  }
  async function watch(command) {
    for(;;) {
      if(closed)throw fail('The panel closed. The original command remains retained.');
      const result=await api(BASE+'/command?'+new URLSearchParams({id:command.id,requestId:command.requestId}));
      state.pendingResult=result;
      if(result.state==='COMPLETE') {
        finishCommand();
        let value=await getTransfer(command.id);
        while(value.active&&!closed) {await sleep();value=await getTransfer(command.id);}
        state.message='Original '+command.action+' completed. Request '+command.requestId+'.';
        if(command.action==='attach'&&result.result?.attachment)
          await onAttached(result.result.attachment);
        render();return {result:result.result,transfer:value};
      }
      if(result.state!=='RUNNING')throw fail(result.error?.message||
        'The retained command has no completed result. Continue the same request after resolving the displayed issue.',
        result.error?.code||'SF49_DELIVERY_NEEDS_CONTINUATION');
      state.message='Original '+command.action+' is running. Request '+command.requestId+'.';
      render();await sleep();
    }
  }
  async function command(action,input) {
    if(state.pending)throw fail('Check or continue the retained command before starting another one.');
    const requestId=input.requestId||uid('command'),value={id:input.id,requestId,action,
      input:{...input,...(['reopen','attach'].includes(action)?{requestId}:{})}};
    retainCommand(value);
    await api(BASE+'/command',value);
    return watch(value);
  }
  async function uploadFile(transfer,file,source) {
    if(source.name!==file.name||String(source.size)!==file.bytes)
      throw fail('Reselect the original '+file.name+' with exactly '+file.bytes+' bytes.');
    const target=new URL(file.url,location.origin);
    if(target.origin!==location.origin||target.pathname!==BASE+'/upload')throw fail('Unexpected source upload address.');
    return new Promise((done,reject)=>{
      xhr=new XMLHttpRequest();const request=xhr;
      request.open('PUT',target.href);request.withCredentials=true;request.setRequestHeader('content-type','application/octet-stream');
      request.upload.onprogress=event=>{
        state.progress={name:file.name,loaded:event.loaded,total:Number(file.bytes)};renderProgress();
      };
      const clear=()=>{if(xhr===request)xhr=null;state.progress=null;};
      request.onload=()=>{
        clear();let value;
        try {value=JSON.parse(request.responseText);}catch {reject(fail('The upload response could not be read. Reopen this retained transfer.'));return;}
        if(request.status<200||request.status>=300)reject(fail(value.detail||value.error||'Upload failed.',value.error));
        else done(value);
      };
      request.onerror=()=>{clear();reject(fail('Upload interrupted. Completed original files remain retained; reselect this file to continue.'));};
      request.onabort=()=>{clear();reject(fail('Upload stopped. The incomplete file can be sent again under the same transfer.'));};
      // File streams through the browser; no whole-file ArrayBuffer, Base64 or
      // WebCrypto allocation. The native writer pins the complete original SHA.
      request.send(source);
    });
  }
  async function uploadMissing(transfer,sources) {
    for(const file of transfer.files) {
      if(file.present)continue;
      const source=sources.find(value=>value.id===file.id)?.file;
      if(!source)throw fail('Reselect every missing original file shown in this transfer.');
      await uploadFile(transfer,file,source);
      transfer=await getTransfer(transfer.id);
    }
    state.message='All declared originals are retained. Review their SHA-256 values before building or receiving.';
    return transfer;
  }
  async function createTransfer() {
    const current=await savedCase(),archive=state.mode==='archive';
    if(archive&&!state.archive)throw fail('Select the original source-edition ZIP.');
    const sources=archive?[{id:'archive',file:state.archive,role:'source-edition-archive'}]:state.chosen;
    const id=uid(archive?'receive':'source'),input={id,kind:archive?'archive':'source',caseId:current.id,
      caseRevision:current.revision,actor:current.actor,label:state.label.trim()||sources[0]?.file.name||'Saved case sources',
      files:sources.map(value=>({id:value.id,name:value.file.name,role:value.role,bytes:String(value.file.size)}))};
    const {transfer}=await command('begin',input);
    await uploadMissing(transfer,sources);
    state.chosen=[];state.archive=null;state.label='';render();
  }
  async function run(work) {
    if(state.busy)return;
    state.busy=true;state.error='';render();
    try {await work();}
    catch(error){state.error=(error.code?error.code+': ':'')+error.message;}
    finally {state.busy=false;state.progress=null;if(!closed)render();}
  }
  function renderProgress() {
    const holder=root.querySelector('[data-upload-progress]');
    if(!holder)return;
    const value=state.progress;
    holder.hidden=!value;
    if(value) {
      holder.querySelector('span').textContent=value.name+' — '+bytes(value.loaded)+' / '+bytes(value.total);
      const meter=holder.querySelector('progress');meter.max=Math.max(value.total,1);meter.value=value.loaded;
    }
  }
  function render() {
    if(closed)return;
    const current=selected(),allPresent=current?.files.every(value=>value.present),ready=Boolean(current?.descriptor);
    root.innerHTML='<header class="sfb-heading"><div><p class="sfb-kicker">SOURCE DELIVERY</p><h3>Exact source bundles</h3>'+
      '<p>Retain the saved case, approved workorder terms and separate source files. Receive the same bundle with its original manifest and native replay.</p></div>'+
      '<button type="button" data-action="refresh">Refresh</button></header>'+
      '<div class="sfb-message" role="status">'+escape(state.message)+'</div>'+
      (state.error?'<div class="sfb-error" role="alert">'+escape(state.error)+'</div>':'')+
      '<div data-upload-progress class="sfb-progress" hidden><span></span><progress></progress></div>'+
      (state.pending?'<section class="sfb-pending"><h4>Retained command</h4><p><strong>'+escape(state.pending.action)+'</strong> · <code>'+
        escape(state.pending.requestId)+'</code></p><p>The request is saved before dispatch. Check its result before continuing the same identity.</p>'+
        '<div class="sfb-actions"><button type="button" data-action="check">Check retained result</button>'+
        '<button type="button" data-action="continue">Continue same command</button>'+
        (state.pendingResult?.state==='FAILED'&&state.pending.action!=='attach'?'<button type="button" data-action="leave-failed">Keep failed command in history</button>':'')+'</div></section>':'')+
      (!state.case?'<p class="sfb-empty">Open a saved merchant case to retain or receive its exact-source bundle.</p>':
      '<section class="sfb-intake"><div class="sfb-case"><span>Saved case <code>'+escape(state.case.id)+'</code></span><span>Revision <code>'+
      escape(short(state.case.revision))+'</code></span></div>'+
      (state.case.dirty?'<p class="sfb-note">The case has unsaved edits. Save them before starting or attaching a bundle.</p>':'')+
      '<div class="sfb-form-row"><label>Source intake<select data-field="mode"><option value="source"'+(state.mode==='source'?' selected':'')+
      '>Saved case and source files</option><option value="archive"'+(state.mode==='archive'?' selected':'')+'>Receive an existing ZIP</option></select></label>'+
      '<label>Bundle label<input data-field="label" maxlength="240" value="'+escape(state.label)+'" placeholder="Name this source edition"></label></div>'+
      (state.mode==='source'?'<label class="sfb-file-input">Original source or receiving files<input type="file" multiple data-field="source-files"></label>'+
      '<p class="sfb-note">Up to 8 GiB per file and the original 16 GiB source allowance. Handoff and terms come from this saved case. Roles describe the source; they do not assert customer acceptance.</p>'+
      (state.chosen.length?'<div class="sfb-chosen">'+state.chosen.map(value=>'<label><span>'+escape(value.file.name)+' <small>'+bytes(value.file.size)+
      '</small></span><select data-role-id="'+escape(value.id)+'">'+['source','receiving-observation','source-contract','coverage','comparison','notes'].map(role=>
      '<option value="'+role+'"'+(role===value.role?' selected':'')+'>'+role+'</option>').join('')+'</select></label>').join('')+'</div>':''):
      '<label class="sfb-file-input">Original source-edition ZIP<input type="file" accept=".zip,application/zip" data-field="archive-file"></label>'+
      '<p class="sfb-note">'+(state.archive?escape(state.archive.name)+' · '+bytes(state.archive.size):
        'The server hashes the complete archive, then verifies every native member before receiving.')+'</p>')+
      '<button type="button" class="sfb-primary" data-action="begin"'+(state.pending||state.case.dirty?' disabled':'')+'>'+
      (state.mode==='source'?'Retain selected sources':'Retain archive')+'</button></section>'+
      '<div class="sfb-workspace"><aside><h4>Retained transfers <span>'+state.total+'</span></h4>'+
      (state.rows.length?'<div class="sfb-transfer-list">'+state.rows.map(row=>'<button type="button" data-select="'+escape(row.id)+'"'+
      (row.id===state.selected?' aria-current="true"':'')+'><strong>'+escape(row.label)+'</strong><span>'+escape(row.kind==='archive'?'Receiving':'Source')+
      ' · '+escape(row.state)+'</span><small>'+escape(row.createdAt)+'</small></button>').join('')+'</div>':'<p class="sfb-empty">No source bundle retained in this case yet.</p>')+
      '<div class="sfb-pages"><button type="button" data-action="previous"'+(state.offset===0?' disabled':'')+'>Previous</button>'+
      '<button type="button" data-action="next"'+(state.offset+state.rows.length>=state.total?' disabled':'')+'>Next</button></div></aside>'+
      '<section class="sfb-detail">'+(current?
      '<header><h4>'+escape(current.label)+'</h4><p><code>'+escape(current.id)+'</code></p></header>'+
      '<div class="sfb-status"><span>'+escape(current.state)+'</span><span>'+escape(current.lastOperation||'intake')+
      (current.active?' · running':'')+'</span></div>'+
      (current.error?'<p class="sfb-error">'+escape(current.error.code)+': '+escape(current.error.message)+'</p>':'')+
      '<details open><summary>Declared original uploads</summary>'+fileRows(current.files)+'</details>'+
      (!allPresent?'<label class="sfb-file-input">Reselect missing originals<input type="file" multiple data-field="resume-files"></label>'+
      '<p class="sfb-note">Completed files stay retained. An interrupted file restarts as one original upload under this same transfer.</p>':'')+
      '<div class="sfb-actions">'+
      (current.kind==='source'?'<button type="button" data-action="prepare"'+(!allPresent||ready||state.pending?' disabled':'')+'>Build original workorder bundle</button>':
      '<button type="button" data-action="inspect"'+(!allPresent||state.pending?' disabled':'')+'>Inspect complete archive</button>'+
      '<button type="button" data-action="receive"'+(!current.inspection||ready||state.pending?' disabled':'')+'>Receive verified archive</button>')+
      '</div>'+
      (current.inspection?'<details open><summary>Verified archive inventory</summary><p>Bundle <code>'+escape(current.inspection.manifest.bundleId)+
        '</code></p><p>'+current.inspection.members+' members · '+bytes(current.inspection.archive.bytes)+' · <code>'+
        escape(current.inspection.archive.sha256)+'</code></p>'+fileRows(current.inspection.manifest.files.map(file=>({...file,present:true})))+'</details>':'')+
      (ready?'<section class="sfb-complete"><h4>Original workorder bundle</h4><dl><dt>Workorder</dt><dd>'+escape(current.descriptor.workOrderRef)+
        '</dd><dt>Bundle ID</dt><dd><code>'+escape(current.descriptor.bundleId)+'</code></dd><dt>Manifest SHA-256</dt><dd><code>'+
        escape(current.descriptor.manifestSha256)+'</code></dd><dt>Native replay</dt><dd>'+escape(current.descriptor.nativeReplay)+
        '</dd><dt>Implementation pins</dt><dd>'+escape(current.descriptor.nativeSourceMatches?'Match retained native source':'Current native source differs; original output replay is retained')+
        '</dd></dl>'+fileRows(current.descriptor.files,{links:true,id:current.id})+
        '<div class="sfb-actions"><button type="button" data-action="reopen"'+(state.pending?' disabled':'')+'>Reopen and replay</button>'+
        '<button type="button" data-action="export"'+(state.pending?' disabled':'')+'>Build portable ZIP</button>'+
        '<button type="button" data-action="attach"'+(state.pending||state.case.dirty?' disabled':'')+'>Attach to saved commissioning case</button></div>'+
        (current.exported?'<p class="sfb-download"><a href="'+escape(current.exported.url)+'" download>'+escape(current.exported.filename)+
        '</a><span>'+bytes(current.exported.archive.bytes)+'</span><code>'+escape(current.exported.archive.sha256)+'</code></p>':'')+
        (current.latest?'<p class="sfb-note">Attached to case <code>'+escape(current.latest.caseId)+'</code> at '+escape(current.latest.recordedAt)+
          '. Original request <code>'+escape(current.latest.requestId)+'</code>.</p>':'')+'</section>':''):
      '<p class="sfb-empty">Select one retained source transfer to inspect its files and continue.</p>')+'</section></div>');
    root.querySelector('[data-action="refresh"]')?.addEventListener('click',()=>run(()=>refresh()));
    root.querySelector('[data-field="mode"]')?.addEventListener('change',event=>{state.mode=event.target.value;render();});
    root.querySelector('[data-field="label"]')?.addEventListener('input',event=>{state.label=event.target.value;});
    root.querySelector('[data-field="source-files"]')?.addEventListener('change',event=>{
      state.chosen=[...event.target.files].map(file=>({id:uid('file'),file,role:'source'}));render();
    });
    root.querySelector('[data-field="archive-file"]')?.addEventListener('change',event=>{state.archive=event.target.files[0]||null;render();});
    root.querySelectorAll('[data-role-id]').forEach(node=>node.addEventListener('change',event=>{
      state.chosen.find(value=>value.id===node.dataset.roleId).role=event.target.value;
    }));
    root.querySelectorAll('[data-select]').forEach(node=>node.addEventListener('click',()=>{state.selected=node.dataset.select;render();}));
    root.querySelector('[data-action="begin"]')?.addEventListener('click',()=>run(createTransfer));
    root.querySelector('[data-field="resume-files"]')?.addEventListener('change',event=>{
      const files=[...event.target.files],transfer=selected();
      void run(async()=>{
        const missing=transfer.files.filter(file=>!file.present),sources=missing.map(file=>{
          const matches=files.filter(value=>value.name===file.name&&String(value.size)===file.bytes);
          if(matches.length!==1)throw fail('Choose one exact missing '+file.name+' ('+file.bytes+' bytes).');
          return {id:file.id,file:matches[0]};
        });
        await uploadMissing(transfer,sources);
      });
    });
    for(const action of ['prepare','inspect','receive','export','reopen'])root.querySelector('[data-action="'+action+'"]')?.addEventListener('click',
      ()=>run(()=>command(action,{id:selected().id})));
    root.querySelector('[data-action="attach"]')?.addEventListener('click',()=>run(async()=>{
      const current=await savedCase();
      await command('attach',{id:selected().id,caseId:current.id,expectedRevision:current.revision,actor:current.actor});
      await refresh();
    }));
    root.querySelector('[data-action="check"]')?.addEventListener('click',()=>run(()=>watch(state.pending)));
    root.querySelector('[data-action="leave-failed"]')?.addEventListener('click',()=>{
      state.message='Failed command '+state.pending.requestId+' remains retained. Its original source files are unchanged.';
      finishCommand();render();
    });
    root.querySelector('[data-action="continue"]')?.addEventListener('click',()=>run(async()=>{
      const original=state.pending;
      await api(BASE+'/command',{...original,continue:true});await watch(original);
    }));
    for(const [action,delta]of [['previous',-30],['next',30]])root.querySelector('[data-action="'+action+'"]')?.addEventListener('click',()=>run(async()=>{
      state.offset=Math.max(0,state.offset+delta);await refresh({keepSelection:false});
    }));
    if(state.busy)root.querySelectorAll('button,input,select').forEach(node=>{node.disabled=true;});
    renderProgress();
  }
  render();
  void refresh().catch(error=>{state.error=error.message;render();});
  return {
    refresh,
    caseChanged:()=>{state.selected=null;state.offset=0;return refresh({keepSelection:false});},
    close() {
      closed=true;viewEpoch++;xhr?.abort();
      if(pollTimer)clearTimeout(pollTimer);pollReject?.(fail('Panel closed; the original command remains retained.'));
      root.replaceChildren();
    }
  };
}
