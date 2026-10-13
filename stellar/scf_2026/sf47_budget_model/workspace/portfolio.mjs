/** Portfolio allocation over one original saved SF47 operating forecast. */
import {createPortfolioWorkingCopyStore} from './portfolio-working-copy-store.mjs';
import {PORTFOLIO_SESSION_SCHEMA,PORTFOLIO_WORKING_LIMITS,portfolioSignature,portfolioSourceMetadata,portfolioUnfinishedFields,validatePortfolioSession,completePortfolioAttachments} from './portfolio-working-copies.mjs';
const SCHEMA='stellar-forge.sf47-portfolio.v1';
const CACHE='stellar-forge.sf47-portfolio-ui.v1';
const SCALE=100000000n;
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const clone=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const money=value=>value===null||value===undefined?'Not entered':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
const num=value=>value===null||value===undefined?'—':String(value);
const json=value=>JSON.stringify(value,null,2)+'\n';
const uid=prefix=>prefix+'-'+crypto.randomUUID();
const optional=value=>value.trim()===''?null:value.trim();
const integer=value=>/^[+-]?\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
const textList=value=>value.split(/[\n,]/).map(x=>x.trim()).filter(Boolean);
const list=value=>Array.isArray(value)?value:[];
function quantity(value){const m=String(value??'').match(/^(\d+)(?:\.(\d{0,8}))?$/);return m?BigInt(m[1])*SCALE+BigInt((m[2]||'').padEnd(8,'0')):null;}
function decimal(value){return (value/SCALE).toString()+((value%SCALE)?'.'+(value%SCALE).toString().padStart(8,'0').replace(/0+$/,''):'');}
function table(head,rows){return '<div class="portfolio-table"><table><thead><tr>'+head.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
const empty=value=>'<p class="portfolio-muted">'+esc(value)+'</p>';
const button=(label,action,attrs='')=>'<button type="button" data-portfolio-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';
function input(label,value,attrs='',type='text',help=''){const numeric=type==='number',date=type==='date';return '<label>'+esc(label)+'<input type="'+(numeric||date?'text':type)+'"'+(numeric?' inputmode="decimal" data-portfolio-numeric':date?' inputmode="numeric" placeholder="YYYY-MM-DD" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"':'')+' value="'+esc(value??'')+'" '+attrs+'>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';}
function area(label,value,attrs='',help=''){return '<label class="portfolio-wide">'+esc(label)+'<textarea rows="3" '+attrs+'>'+esc(value??'')+'</textarea>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';}
function select(label,value,options,attrs='',multiple=false){return '<label>'+esc(label)+'<select '+attrs+(multiple?' multiple size="4"':'')+'>'+options.map(([id,name])=>'<option value="'+esc(id)+'"'+((multiple?list(value).includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>';}
function download(value,filename,type='application/json'){const url=URL.createObjectURL(value instanceof Blob?value:new Blob([value],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function inputShape(value){
  const v=plain(value)&&plain(value.inputs)&&value.inputs.schema===SCHEMA?value.inputs:value;
  if(!plain(v)||v.schema!==SCHEMA||typeof v.forecastId!=='string'||typeof v.forecastSha256!=='string'||!plain(v.calendar)||!Array.isArray(v.resources)||!Array.isArray(v.tasks)||!Array.isArray(v.alternatives))throw new Error('Choose a complete portfolio input or its saved portfolio JSON.');
  const allowed=new Set(['schema','name','forecastId','forecastSha256','calendar','resources','tasks','alternatives','note']);
  for(const key of Object.keys(v))if(!allowed.has(key))throw new Error('Unexpected portfolio input field: '+key);
  const out=clone(v);
  function resources(rows){if(!Array.isArray(rows))throw new Error('Resource capacity needs its complete array.');for(const r of rows){if(!plain(r)||typeof r.id!=='string')throw new Error('Each resource needs its original object and ID.');if(r.hoursByWeekday!==null&&r.hoursByWeekday!==undefined&&(!Array.isArray(r.hoursByWeekday)||r.hoursByWeekday.length!==7))throw new Error('Resource weekday capacity needs seven entries.');if(r.hoursByDate!==undefined&&!plain(r.hoursByDate))throw new Error('Dated resource capacity needs its date-to-hours object.');}}
  function tasks(rows){if(!Array.isArray(rows))throw new Error('Remaining tasks need their complete array.');for(const t of rows)if(!plain(t)||typeof t.id!=='string'||(t.effortHours!==undefined&&!plain(t.effortHours))||(t.dependsOn!==undefined&&!Array.isArray(t.dependsOn)))throw new Error('Each task needs its source ID, effort object and dependency array.');}
  resources(out.resources);tasks(out.tasks);
  for(const a of out.alternatives){if(!plain(a)||typeof a.id!=='string'||a.id==='base'||a.alternatives!==undefined)throw new Error('Use distinct flat alternatives beside the base plan.');if(a.resources!==undefined)resources(a.resources);if(a.tasks!==undefined)tasks(a.tasks);if(a.calendar!==undefined&&!plain(a.calendar))throw new Error('An alternative calendar replaces the complete calendar object.');}
  return out;
}
function sourceRows(forecast){return [...list(forecast?.report?.packages).map(r=>({...r,id:'package/'+r.id,sourceId:r.id,sourceKind:'package',title:r.id})),...list(forecast?.report?.commercial).filter(r=>r.selected).map(r=>({...r,id:'commercial/'+r.id,sourceId:r.id,sourceKind:'commercial',title:r.title||r.id}))];}
function rejected(error){const status=Number(error.status??error.response?.status),code=String(error.code??error.error??'');return status===422||['OPERATIONS_CONFLICT','INVALID_PORTFOLIO','PORTFOLIO_CHANGED','PORTFOLIO_PREVIEW_CONFLICT','PORTFOLIO_SOURCE_CONFLICT','PORTFOLIO_SOURCE_CHANGED','PORTFOLIO_FORECAST_SOURCE_CHANGED','FORECAST_CHANGED','FORECAST_SOURCE_CONFLICT','REQUEST_CONFLICT','OPERATION_CONFLICT','REQUEST_ID_CONFLICT'].includes(code);}

export function mountPortfolio({container,current,api:transport,mutationId,recordingActor,onSaved,
  onReload=()=>{},onForecastInputs=()=>{},initialPortfolioId=null,onSelection=()=>{}}){
  if(!document.querySelector('link[data-sf47-portfolio-style]')){const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./portfolio.css',import.meta.url).href;style.dataset.sf47PortfolioStyle='true';document.head.append(style);}
  const root=document.createElement('section');root.className='portfolio';root.setAttribute('aria-label','Portfolio delivery allocation');container.replaceChildren(root);
  const caseId=current.program.id,path='/api/operations/'+caseId,cacheKey='sf47.portfolio.'+caseId;
  const s={active:true,generation:0,busy:false,hostBusy:false,recoveryRaw:null,draft:null,sourceTasks:[],installationCandidates:[],installationSource:null,installationChoices:{},baseForecast:null,preview:null,saved:null,portfolios:[],profile:'base',resultProfile:'base',tab:'inputs',dirty:false,pending:null,lastRejected:null,requestNonce:'',sourceChoice:'',savedChoice:initialPortfolioId||'',error:'',message:'',storageWarning:'',dailyPage:0,allocationPage:0,cashPage:0,rawFields:{},resourceDialogs:{},openDialogKey:null,attachments:[],copyName:'',checkpointLabel:'',historyChoice:'',archivedChoice:''};
  const available=()=>s.active&&root.isConnected;
  const $=selector=>root.querySelector(selector);
  function ensure(g=s.generation){if(!available()||g!==s.generation){const error=new Error('This portfolio view has changed. Reopen the retained case.');error.code='PORTFOLIO_VIEW_CLOSED';throw error;}}
  async function api(url,body,options){const g=s.generation;ensure(g);const value=await transport(url,body,options);ensure(g);return value;}
  let copies=null,storeOpened=false,storeFailed=false,autosaveTimer=null,workingWrite=Promise.resolve(),adopting=false,recoveryCollection=null;
  const validateWorking=(value,options={})=>validatePortfolioSession(value,{caseId,originCaseId:current.program.origin?.programId??null,validateInputs:inputShape,...options});
  const copyStore=createPortfolioWorkingCopyStore('sf47.portfolio-working.'+caseId,{validateSession:validateWorking});
  const currentCopy=()=>copies?.copies.find(row=>row.id===copies.selectedCopyId)||null;
  function checkpointsFor(copy=currentCopy(),trail=[],depth=0){if(!copy||depth>32)return [];return [...copy.checkpoints.map(row=>({key:JSON.stringify([...trail,row.id]),row,label:copy.name+' · '+row.label,sourceCopy:copy})),...copy.lineage.flatMap(origin=>checkpointsFor(origin.sourceCopy,[...trail,origin.id],depth+1))];}
  function sessionSnapshot(){
    captureDialog();
    const state={draft:s.draft,profile:s.profile,resultProfile:s.resultProfile,tab:s.tab,dirty:s.dirty,pending:s.pending,lastRejected:s.lastRejected,requestNonce:s.requestNonce,sourceChoice:s.sourceChoice,savedChoice:s.savedChoice,baseForecast:s.baseForecast,sourceTasks:s.sourceTasks,installationCandidates:s.installationCandidates,installationSource:s.installationSource,installationChoices:s.installationChoices,preview:s.preview,saved:s.saved,rawFields:s.rawFields,resourceDialogs:s.resourceDialogs,openDialogKey:s.openDialogKey,attachments:s.attachments,recoveryRaw:s.recoveryRaw,copyName:s.copyName,checkpointLabel:s.checkpointLabel,historyChoice:s.historyChoice};
    const originals=new Map(s.attachments.map(row=>[row.metadata.id,row]));
    state.attachments=portfolioSourceMetadata(state).map(metadata=>({metadata,contentBase64:originals.get(metadata.id)?.contentBase64??null}));
    return clone({schema:PORTFOLIO_SESSION_SCHEMA,caseId,originCaseId:current.program.origin?.programId??null,caseVersion:current.program.version,capturedAt:new Date().toISOString(),state});
  }
  function contextFor(profile=s.profile){
    if(!s.draft)return null;
    const a=profile==='base'?null:s.draft.alternatives.find(row=>row.id===profile);
    return a?{...s.draft,resources:a.resources??s.draft.resources,tasks:a.tasks??s.draft.tasks,installationPlans:a.installationPlans??s.draft.installationPlans??[]}:s.draft;
  }
  function rawKey(el){
    if(!el.matches('input,textarea,select')||el.closest('dialog'))return null;
    const d=el.dataset,p=contextFor(),parts=[s.profile];
    for(const key of ['portfolioInput','portfolioAltKey','portfolioCalendar','portfolioDates','portfolioWeekday','portfolioPhasePlan','phaseId','phasePlanKey','phaseKey','phaseResource','phaseBoundary','phaseDependencies','portfolioInstallationChoice'])if(Object.hasOwn(d,key))parts.push(key+':'+d[key]);
    if(Object.hasOwn(d,'portfolioResource')){parts.push('resource:'+p?.resources[Number(d.portfolioResource)]?.id);for(const key of ['resourceKey','capacityDay'])if(Object.hasOwn(d,key))parts.push(key+':'+d[key]);}
    if(Object.hasOwn(d,'portfolioTask')){parts.push('task:'+p?.tasks[Number(d.portfolioTask)]?.id);for(const key of ['taskKey','taskDependencies','effortResource'])if(Object.hasOwn(d,key))parts.push(key+':'+d[key]);}
    return parts.length>1?JSON.stringify(parts):null;
  }
  function rawValue(el){return el.multiple?{values:[...el.selectedOptions].map(x=>x.value)}:el.type==='checkbox'?{checked:el.checked}:{value:el.value};}
  function captureControls(){if(adopting||!available())return;for(const el of root.querySelectorAll('input,textarea,select')){const key=rawKey(el);if(key)s.rawFields[key]=rawValue(el);}captureDialog();}
  function restoreControls(){for(const el of root.querySelectorAll('input,textarea,select')){const key=rawKey(el),row=key&&s.rawFields[key];if(!row||el.closest('fieldset')?.disabled)continue;if(Object.hasOwn(row,'checked'))el.checked=row.checked;else if(row.values)for(const o of el.options)o.selected=row.values.includes(o.value);else el.value=row.value;}}
  function captureDialog(){const dialog=$('dialog');if(!dialog?.open||!s.openDialogKey)return;const retained=s.resourceDialogs[s.openDialogKey];if(!retained)return;for(const el of dialog.querySelectorAll('input[name]'))retained.values[el.name]=el.value;}
  async function adoptWorking(value){
    const checked=await validateWorking(value);ensure();adopting=true;
    try{for(const [key,v]of Object.entries(checked.state))s[key]=clone(v);s.error='';s.message='';s.dailyPage=0;s.allocationPage=0;s.cashPage=0;onSelection(s.saved?.id||null);}
    finally{adopting=false;}
  }
  function acceptCopies(result){copies=result.collection||result;return result.copy||currentCopy();}
  function retain(){
    if(!available()||adopting||!storeOpened||storeFailed)return;
    captureDialog();clearTimeout(autosaveTimer);
    autosaveTimer=setTimeout(()=>{persistWorking().catch(error=>{s.storageWarning=error.message;status(error.message,true);});},250);
  }
  async function fetchOriginal(metadata){const response=await api(path+'/sources/'+metadata.id,undefined,{download:true});return new Uint8Array(await response.arrayBuffer());}
  async function persistWorking({complete=false}={}){
    clearTimeout(autosaveTimer);if(!storeOpened||storeFailed)throw new Error('Open the retained working-copy store before saving. Download the complete working file if this browser cannot retain it.');
    const selected=currentCopy();if(!selected||selected.archived)throw new Error('Select an active working copy before editing or saving.');
    let snapshot=sessionSnapshot();const identity=selected.id,originalSignature=portfolioSignature(snapshot.state);
    if(complete){snapshot=await completePortfolioAttachments(snapshot,{validate:validateWorking,fetchSource:fetchOriginal});ensure();
      if(currentCopy()?.id!==identity||portfolioSignature(sessionSnapshot().state)!==originalSignature)throw new Error('This working copy changed while its sources downloaded. Keep the current work and export again.');
      s.attachments=clone(snapshot.state.attachments);
    }
    const task=workingWrite.catch(()=>{}).then(async()=>{const result=await copyStore.updateHead(identity,snapshot);acceptCopies(result);s.storageWarning='';return snapshot;});workingWrite=task;return task;
  }
  function workingCopiesHtml(){
    const selected=currentCopy(),rows=copies?.copies||[],history=checkpointsFor(selected);
    return '<section class="portfolio-working" aria-label="Complete working copies"><h4>Working copies</h4><p>Keep named drafts and checkpoints beside the original saved allocations. Each copy retains its source, alternatives, unfinished forms and original pending request.</p>'+
      '<div class="portfolio-fields">'+select('Current working copy',selected?.id||'',[['','Choose a working copy'],...rows.filter(row=>!row.archived).map(row=>[row.id,row.name])],'data-working-copy data-pending-allowed')+
      input('Copy name',s.copyName||selected?.name||'','data-working-name data-pending-allowed')+'</div>'+
      '<div class="portfolio-actions">'+button('New copy from this draft','working-new','data-pending-allowed')+button('Rename copy','working-rename','data-pending-allowed')+button('Archive copy','working-archive','data-pending-allowed')+
      button('Download complete working copy','working-export','data-pending-allowed')+button('Receive complete working copy','working-import','data-pending-allowed')+button('Reload stored copies','working-reload','data-pending-allowed')+'</div>'+
      '<div class="portfolio-fields">'+input('Checkpoint note',s.checkpointLabel,'data-working-checkpoint-label data-pending-allowed')+select('Retained checkpoints',s.historyChoice,[['','Choose an original checkpoint'],...history.map(item=>[item.key,item.label+' · '+item.row.createdAt])],'data-working-history data-pending-allowed')+'</div>'+
      '<div class="portfolio-actions">'+button('Save complete checkpoint','working-checkpoint','data-pending-allowed')+button('Open checkpoint as another copy','working-fork','data-pending-allowed'+(!s.historyChoice?' disabled data-portfolio-disabled="true"':''))+'</div>'+
      (rows.some(row=>row.archived)?'<div class="portfolio-fields">'+select('Archived working copies',s.archivedChoice,[['','Choose an archived copy'],...rows.filter(row=>row.archived).map(row=>[row.id,row.name])],'data-working-archived data-pending-allowed')+button('Restore selected copy','working-restore','data-pending-allowed')+'</div>':'')+
      (selected?'<p class="portfolio-muted">'+history.length+' retained checkpoints. '+(selected.archived?'This copy is archived; restore it to continue.':'Changes are retained automatically in this browser. Complete downloads include every original source byte.')+'</p>':'')+
      (s.openDialogKey?button('Resume unfinished capacity form','working-dialog','data-pending-allowed'):'')+
      (s.recoveryRaw?button('Download previous browser text','download-recovery','data-pending-allowed')+button('Receive previous session draft','working-legacy','data-pending-allowed'):'')+
      (recoveryCollection?button('Download retained store recovery','working-recovery','data-pending-allowed'):'')+
      '<input type="file" accept=".json,application/json" data-working-file hidden></section>';
  }
  async function fullPortable(value){
    const out=clone(value);
    async function completeCopy(c){
      c.head=await completePortfolioAttachments(c.head,{validate:validateWorking,fetchSource:fetchOriginal});
      for(const h of c.checkpoints||[])h.session=await completePortfolioAttachments(h.session,{validate:validateWorking,fetchSource:fetchOriginal});
      for(const origin of c.lineage||[])await completeCopy(origin.sourceCopy);
    }
    await completeCopy(out.copy);return out;
  }
  async function validatePortableCopy(copy,depth=0){
    if(depth>32)throw new Error('Keep the complete source-copy lineage within the receiving limit.');
    await validateWorking(copy.head,{requireComplete:true});
    for(const h of copy.checkpoints||[])await validateWorking(h.session,{requireComplete:true});
    for(const origin of copy.lineage||[])await validatePortableCopy(origin.sourceCopy,depth+1);
  }
  async function workingAction(action){
    if(action==='working-recovery'){download(json(recoveryCollection),'portfolio-store-recovery.json');return;}
    if(action==='working-reload'){if(!window.confirm('Reload the stored collection? Download this complete current copy first if it contains changes from a conflicting window.'))return;clearTimeout(autosaveTimer);await workingWrite.catch(()=>{});copies=await copyStore.read();storeOpened=true;storeFailed=false;recoveryCollection=null;if(currentCopy())await adoptWorking(currentCopy().head);render();status('Reopened the stored copies without replacing the other window’s changes.');return;}
    if(action==='working-export'){
      const selected=currentCopy(),now=new Date().toISOString();
      const copy=selected?clone(selected):{id:'pwc-'+crypto.randomUUID().replaceAll('-',''),name:s.copyName||'Recovered current Portfolio session',createdAt:now,updatedAt:now,archived:false,head:null,checkpoints:[],lineage:[]};
      copy.head=sessionSnapshot();
      const complete=await fullPortable({schema:'stellar-forge.portfolio-working-copy.v1',exportedAt:now,copy}),text=json(complete);
      if(new TextEncoder().encode(text).length>PORTFOLIO_WORKING_LIMITS.fileBytes)throw new Error('This complete lineage exceeds the 128 MiB receiving limit. Retain the browser copy and export an earlier named copy separately.');
      download(text,'portfolio-working-copy-'+copy.id+'.json');status('Downloaded this exact current copy, checkpoints and original source bytes without changing stored copies.');return;
    }
    if(action==='working-import'){$('[data-working-file]').value='';$('[data-working-file]').click();return;}
    if(action==='working-dialog'){const d=s.resourceDialogs[s.openDialogKey],p=contextFor(d?.profile);if(!d||!p)throw new Error('Open the original unfinished form in its retained alternative.');s.profile=d.profile;render();showResourceDialog(p.resources.findIndex(r=>r.id===d.resourceId),d.kind,d.originalDate);return;}
    if(action==='working-legacy'){if(!s.recoveryRaw)return;const cached=JSON.parse(s.recoveryRaw);if(cached.schema!==CACHE||cached.caseId!==caseId)throw new Error('Use the complete original Portfolio browser record.');const next=sessionSnapshot();for(const k of ['draft','profile','resultProfile','dirty','pending','lastRejected','requestNonce','sourceChoice','savedChoice','installationCandidates','installationSource','installationChoices'])if(Object.hasOwn(cached,k))next.state[k]=cached[k];next.state.baseForecast=null;next.state.preview=null;next.state.saved=null;next.state.rawFields={};next.state.resourceDialogs={};next.state.openDialogKey=null;next.state.attachments=[];next.state.recoveryRaw=null;await validateWorking(next);ensure();acceptCopies(await copyStore.create({name:'Recovered previous session',session:next}));await adoptWorking(next);if(s.draft)await attachSource(s.draft.forecastId);await persistWorking();render();return;}
    if(action==='working-restore'){if(currentCopy())await persistWorking();acceptCopies(await copyStore.setArchived(s.archivedChoice,false));acceptCopies(await copyStore.select(s.archivedChoice));await adoptWorking(currentCopy().head);s.archivedChoice='';s.copyName='';s.historyChoice='';render();return;}
    const selected=currentCopy();if(!selected){if(action==='working-new'){acceptCopies(await copyStore.create({name:s.copyName||'New Portfolio draft',session:sessionSnapshot()}));await adoptWorking(currentCopy().head);render();return;}throw new Error('Choose or restore an original working copy first.');}
    if(action==='working-archive'){await persistWorking();acceptCopies(await copyStore.setArchived(selected.id,true));if(currentCopy())await adoptWorking(currentCopy().head);else{for(const k of ['draft','baseForecast','preview','saved','installationSource','pending','lastRejected','openDialogKey'])s[k]=null;for(const k of ['rawFields','resourceDialogs','installationChoices'])s[k]={};for(const k of ['attachments','sourceTasks','installationCandidates'])s[k]=[];s.profile='base';s.resultProfile='base';s.savedChoice='';s.requestNonce='';s.dirty=false;}s.copyName='';s.historyChoice='';render();return;}
    if(action==='working-rename'){acceptCopies(await copyStore.rename(selected.id,(s.copyName||selected.name).trim()));s.copyName='';render();return;}

    if(action==='working-new'){const snapshot=selected.archived?clone(selected.head):await persistWorking({complete:true});acceptCopies(await copyStore.create({name:(s.copyName||selected.name)+' — copy',session:snapshot,fromCopyId:selected.id}));await adoptWorking(currentCopy().head);s.copyName='';s.historyChoice='';render();return;}
    if(action==='working-checkpoint'){const snapshot=await persistWorking({complete:true});acceptCopies(await copyStore.checkpoint(selected.id,{label:s.checkpointLabel.trim()||'Reviewed working checkpoint',session:snapshot}));s.checkpointLabel='';render();status('Retained the complete checkpoint. Later edits continue in this working copy.');return;}
    if(action==='working-fork'){if(!selected.archived)await persistWorking();const chosen=checkpointsFor(selected).find(item=>item.key===s.historyChoice);if(!chosen)throw new Error('Choose an original retained checkpoint.');acceptCopies(chosen.sourceCopy.id===selected.id?await copyStore.forkCheckpoint(selected.id,chosen.row.id,{name:selected.name+' — checkpoint copy'}):await copyStore.create({name:selected.name+' — retained checkpoint',session:chosen.row.session,fromCopyId:selected.id}));await adoptWorking(currentCopy().head);s.historyChoice='';s.copyName='';render();status('Opened the original checkpoint as a new copy. Prior head and history remain retained.');return;}
  }
  function status(message,error=false){if(!available())return;s.message=error?'':message;s.error=error?message:'';const node=$('[data-portfolio-status]');if(node){node.textContent=message;node.setAttribute('role',error?'alert':'status');}const note=$('[data-portfolio-storage]');if(note)note.textContent=s.storageWarning;}
  function busy(value){s.busy=value;if(!available())return;root.setAttribute('aria-busy',String(value));root.querySelectorAll('button,input,select,textarea').forEach(node=>node.disabled=value||s.hostBusy||node.dataset.portfolioDisabled==='true'||Boolean((s.pending||currentCopy()?.archived)&&!node.hasAttribute('data-pending-allowed')));}
  async function run(task){
    if(s.busy||s.hostBusy||!available())return;
    const g=s.generation;busy(true);
    try{await task();}catch(error){if(available()&&g===s.generation){render();status(error.message||String(error),true);}}
    finally{if(available()&&g===s.generation)busy(false);}
  }
  function pruneRemovedReferences(){
    const profiles=new Set(['base',...(s.draft?.alternatives||[]).map(a=>a.id)]);
    for(const [key,row]of Object.entries(s.resourceDialogs)){const plan=profiles.has(row.profile)?contextFor(row.profile):null;if(!plan?.resources.some(r=>r.id===row.resourceId))delete s.resourceDialogs[key];}
    if(s.openDialogKey&&!s.resourceDialogs[s.openDialogKey])s.openDialogKey=null;
    for(const key of Object.keys(s.rawFields)){
      const parts=JSON.parse(key),profile=parts[0],plan=profiles.has(profile)?contextFor(profile):null;
      const get=name=>{const x=parts.find(v=>v.startsWith(name+':'));return x===undefined?undefined:x.slice(name.length+1);};
      if(!plan){delete s.rawFields[key];continue;}
      const resource=get('resource')??get('effortResource')??get('phaseResource'),task=get('task')??get('portfolioPhasePlan')??get('portfolioInstallationChoice');
      const phaseTask=get('portfolioPhasePlan'),phase=get('phaseId'),installation=phaseTask?(plan.installationPlans||[]).find(x=>x.taskId===phaseTask):null;
      if(resource&&!plan.resources.some(r=>r.id===resource)||task&&!plan.tasks.some(r=>r.id===task)||phaseTask&&!installation||phase&&!installation?.phases.some(r=>r.phaseId===phase))delete s.rawFields[key];
    }
    for(const key of Object.keys(s.installationChoices)){const at=key.indexOf('|'),profile=key.slice(0,at),task=key.slice(at+1);if(!profiles.has(profile)||!contextFor(profile)?.tasks.some(r=>r.id===task))delete s.installationChoices[key];}
  }
  function invalidate(renderAll=false){
    pruneRemovedReferences();
    s.dirty=true;s.preview=null;s.saved=null;s.savedChoice='';if(s.resultProfile!=='base'&&!s.draft?.alternatives.some(a=>a.id===s.resultProfile))s.resultProfile='base';s.dailyPage=0;s.allocationPage=0;s.cashPage=0;onSelection(null);retain();
    if(renderAll){render();return;}
    const report=$('[data-portfolio-analysis]');if(report)report.innerHTML=empty('Preview the current inputs to calculate delivery and cash alternatives.');
    const save=$('[data-portfolio-action=save]');if(save){save.disabled=true;save.dataset.portfolioDisabled='true';}
    const badge=$('[data-portfolio-draft-state]');if(badge)badge.textContent='Draft changed — preview before saving.';
  }
  function selectedAlternative(){return s.profile==='base'?null:s.draft?.alternatives.find(a=>a.id===s.profile)||null;}
  function effective(){const a=selectedAlternative();return a?{...s.draft,calendar:a.calendar??s.draft.calendar,resources:a.resources??s.draft.resources,tasks:a.tasks??s.draft.tasks}:s.draft;}
  function own(field){const a=selectedAlternative();return !a||Object.hasOwn(a,field);}
  function editable(field){return !s.pending&&own(field);}
  function fieldset(field,title,body){
    const a=selectedAlternative(),inherits=a&&!Object.hasOwn(a,field);
    return '<section class="portfolio-block"><div class="portfolio-section-heading"><h4>'+esc(title)+'</h4>'+(a?'<label class="portfolio-check"><input type="checkbox" data-portfolio-override="'+field+'"'+(!inherits?' checked':'')+'>Override this whole '+esc(field)+' field</label>':'')+'</div>'+(inherits?empty('Inherited from the base plan. Enable its override to edit an independent replacement.'): '')+'<fieldset '+(inherits?'disabled':'')+' data-portfolio-group="'+field+'">'+body+'</fieldset></section>';
  }
  function taskSource(id){return s.sourceTasks.find(r=>(r.id??r.taskId)===id)||sourceRows(s.baseForecast).find(r=>r.id===id)||{id,title:id};}
  function taskName(id){const r=taskSource(id);return r.title||r.name||r.sourceId||id;}
  function taskHours(id){const r=taskSource(id);return r.remainingHours??r.hours??r.effortHours??null;}
  function roleHint(id){return list(s.baseForecast?.snapshot?.plan?.planning?.contributors).find(r=>r.id===id)||list(s.baseForecast?.report?.capacity?.originalContributors).find(r=>r.id===id);}
  function renderCalendar(p){
    const c=p.calendar||{};
    const days=DAYS.map((name,i)=>'<label class="portfolio-check"><input type="checkbox" data-portfolio-weekday="'+i+'"'+(list(c.weekdays).includes(i)?' checked':'')+'>'+name+'</label>').join('');
    return fieldset('calendar','Calendar and horizon','<div class="portfolio-fields">'+input('First scheduling date',c.startDate,'data-portfolio-calendar="startDate"','date')+input('Horizon in calendar days',c.horizonDays,'data-portfolio-calendar="horizonDays" min="1" step="1"','number')+'</div><div class="portfolio-weekdays" role="group" aria-label="Working weekdays">'+days+'</div><div class="portfolio-fields">'+area('Closed dates',list(c.holidays).join('\n'),'data-portfolio-dates="holidays"','One YYYY-MM-DD per line; commas also work.')+area('Additional working dates',list(c.extraWorkingDates).join('\n'),'data-portfolio-dates="extraWorkingDates"','Explicit openings outside the weekly calendar.')+'</div>');
  }
  function renderResources(p){
    const rows=p.resources.map((r,i)=>{
      const capacities=Array.isArray(r.hoursByWeekday)?r.hoursByWeekday:Array(7).fill(null),hint=roleHint(r.id);
      const dates=Object.entries(r.hoursByDate||{}).sort(([a],[b])=>a.localeCompare(b));
      return '<article class="portfolio-resource"><div class="portfolio-section-heading"><h5>'+esc(r.name||'Unnamed resource')+'</h5><div class="portfolio-actions">'+button('Distribute a weekly total','spread-resource','data-index="'+i+'"')+button('Remove resource','remove-resource','data-index="'+i+'"')+'</div></div><div class="portfolio-fields">'+input('Role or person',r.name,'data-portfolio-resource="'+i+'" data-resource-key="name"')+area('Availability source or assumption',r.note,'data-portfolio-resource="'+i+'" data-resource-key="note"')+'</div>'+(hint?'<p class="portfolio-muted">Original planning entry: '+esc(hint.weeklyHours)+' hours per week. Choose its daily distribution explicitly.</p>':'')+'<div class="portfolio-capacity-grid">'+DAYS.map((name,d)=>input(name,capacities[d],'data-portfolio-resource="'+i+'" data-capacity-day="'+d+'" min="0" max="1000000000" step="0.00000001"','number')).join('')+'</div><p class="portfolio-muted">Blank means unentered capacity; enter 0 for an unavailable day. A pooled role records its total available staff-hours across the team.</p><div class="portfolio-section-heading"><strong>Dated capacity</strong>'+button('Add dated capacity','add-date','data-index="'+i+'"')+'</div>'+(dates.length?table(['Date','Available hours',''],dates.map(([d,h])=>[esc(d),esc(h),button('Edit','edit-date','data-index="'+i+'" data-date="'+esc(d)+'"')+' '+button('Remove','remove-date','data-index="'+i+'" data-date="'+esc(d)+'"')])):empty('No dated capacity overrides.'))+'</article>';
    }).join('');
    return fieldset('resources','Resource availability',rows+button('Add role or person','add-resource'));
  }
  function renderTasks(p){
    const options=p.tasks.map(t=>[t.id,taskName(t.id)]);
    return fieldset('tasks','Remaining work and dependencies',p.tasks.map((t,i)=>{
      const source=taskSource(t.id),expected=quantity(taskHours(t.id)),entered=Object.values(t.effortHours||{}),valid=entered.map(quantity),sum=valid.every(v=>v!==null)?valid.reduce((a,b)=>a+b,0n):null;
      const total=sum===null?'Assignments incomplete':decimal(sum)+' / '+num(taskHours(t.id))+' source hours'+(expected!==null&&sum!==expected?' — reconcile total':'');
      return '<details class="portfolio-task"><summary><span>'+esc(taskName(t.id))+'</span><small>'+esc(total)+'</small></summary><p class="portfolio-muted">'+esc(source.sourceKind||t.id.split('/')[0])+' · original forecast window '+esc(source.startDate||source.oldStartDate||'not supplied')+' to '+esc(source.endDate||source.oldEndDate||'not supplied')+'</p>'+(source.scope?'<p>'+esc(source.scope)+'</p>':'')+(source.timing?'<div class="portfolio-note"><strong>Original start condition</strong><p>'+esc(source.timing.startCondition)+'</p><p>Delivery within '+esc(source.timing.deliveryBusinessDays)+' working days. '+source.timing.receiptConditions.map(r=>esc(r.receiptId)+': '+esc(r.condition)).join(' · ')+'</p><p>'+(source.timing.reviewedReleaseDate?'Original reviewed trigger: '+esc(source.timing.reviewedReleaseDate)+'. The deadline stays anchored to this date; a later release below defers work without moving the original promise.':'Keep the release date empty while the triggering event is unresolved; the complete work remains saved in this allocation.')+'</p></div>':'')+'<div class="portfolio-fields">'+input('Release date',t.releaseDate,'data-portfolio-task="'+i+'" data-task-key="releaseDate"','date')+input('Due date',t.dueDate,'data-portfolio-task="'+i+'" data-task-key="dueDate"','date')+input('Minimum working duration',t.minBusinessDays,'data-portfolio-task="'+i+'" data-task-key="minBusinessDays" min="0" step="1"','number','Begins with actual work; entered 0 adds no minimum duration.')+input('Priority',t.priority,'data-portfolio-task="'+i+'" data-task-key="priority" step="1"','number')+select('Predecessors',t.dependsOn,options.filter(([id])=>id!==t.id),'data-portfolio-task="'+i+'" data-task-dependencies',true)+area('Work, dependency or date assumption',t.note,'data-portfolio-task="'+i+'" data-task-key="note"')+'</div><h5>Remaining effort by resource</h5>'+(p.resources.length?'<div class="portfolio-effort-grid">'+p.resources.map(r=>input(r.name||r.id,t.effortHours?.[r.id],'data-portfolio-task="'+i+'" data-effort-resource="'+esc(r.id)+'" min="0" step="0.00000001"','number')).join('')+'</div>':empty('Add resources before assigning the original remaining effort.'))+'<p class="portfolio-muted">The complete role assignment must equal '+esc(taskHours(t.id))+' original remaining hours. Accepted work and original commercial costs stay in the source forecast.</p></details>';
    }).join(''));
  }
  function editor(){
    if(!s.draft)return empty('Select an original saved forecast and create a delivery plan.');
    const p=effective(),a=selectedAlternative();
    return '<div class="portfolio-profile-toolbar">'+select('Plan or alternative',s.profile,[['base','Base plan'],...s.draft.alternatives.map(x=>[x.id,x.name||'Unnamed alternative'])],'data-portfolio-profile')+'<div class="portfolio-actions">'+button('Add alternative','add-alternative')+(a?button('Remove alternative','remove-alternative'):'')+'</div></div>'
      +(a?'<div class="portfolio-fields">'+input('Alternative name',a.name,'data-portfolio-alt-key="name"')+area('Alternative assumptions',a.note,'data-portfolio-alt-key="note"')+'</div><p class="portfolio-note">An override replaces its whole calendar, resource list or task list. Other fields continue to use the base plan.</p>':'<div class="portfolio-fields">'+input('Saved plan name',s.draft.name,'data-portfolio-input="name"')+area('Planning assumptions and decision',s.draft.note,'data-portfolio-input="note"')+'</div>')
      +renderCalendar(p)+renderResources(p)+renderTasks(p);
  }
  function findingsHtml(values){
    const rows=list(values);if(!rows.length)return empty('No outstanding allocation input findings.');
    return '<ul class="portfolio-findings">'+rows.map(r=>'<li><strong>'+esc(r.field||r.taskId||r.code||'Input')+'</strong> '+esc(r.message||r.note||JSON.stringify(r))+'</li>').join('')+'</ul>';
  }
  function resultRows(){
    const result=s.preview||s.saved;
    return list(result?.report?.alternatives);
  }
  function selectedResult(){return resultRows().find(x=>x.id===s.resultProfile)||resultRows()[0]||null;}
  function page(rows,index,size){return rows.slice(index*size,index*size+size);}
  function pager(name,index,count,size){
    if(count<=size)return '';
    return '<div class="portfolio-actions">'+button('Previous','page-'+name,'data-direction="-1"'+(index===0?' disabled data-portfolio-disabled="true"':''))+'<span>Rows '+(index*size+1)+'–'+Math.min(count,(index+1)*size)+' of '+count+'</span>'+button('Next','page-'+name,'data-direction="1"'+((index+1)*size>=count?' disabled data-portfolio-disabled="true"':''))+'</div>';
  }
  function analysisHtml(){
    const result=s.preview||s.saved,rows=resultRows(),chosen=selectedResult();
    if(!result||!chosen)return empty('Preview the current inputs to calculate delivery and cash alternatives.');
    const report=result.report,summary=chosen.summary||{},schedule=chosen.schedule||{},baseline=report.baseline||{};
    const tasks=list(schedule.tasks),resources=list(schedule.resources),daily=list(schedule.daily_workload),allocations=tasks.flatMap(t=>list(t.allocations).map(r=>({...r,task_id:r.task_id||t.id||t.task_id,title:t.title||taskName(t.id||t.task_id)})));
    const original=table(['Original saved forecast','Entered finish','Remaining hours','Cash needed before opening balance','Gap after entered balance','Peak need'],[[esc(baseline.name||s.baseForecast?.inputs?.name||s.draft?.forecastId),esc(baseline.finishDate||'—'),esc(num(baseline.totalHours)),money(baseline.additionalCashNeededUsd),money(baseline.gapAfterOpeningCashUsd),esc(baseline.peakNeedDate||'—')]]);
    const comparison=table(['Allocation alternative','State','Delivery finish','Late tasks','Hours','Cash needed before opening balance','Gap after entered balance','Peak need'],rows.map(r=>{const z=r.summary||{};return [button(r.name||r.id,'result-alternative','data-id="'+esc(r.id)+'"'+(r.id===chosen.id?' aria-pressed="true"':'')),esc(r.status),esc(z.finishDate||'Unscheduled'),esc(num(z.lateTasks)),esc(num(z.totalHours)),money(z.additionalCashNeededUsd),money(z.gapAfterOpeningCashUsd),esc(z.peakNeedDate||'—')];}));
    const source=result.source||{};
    return '<section class="portfolio-results"><div class="portfolio-section-heading"><h4>'+(s.saved?'Saved allocation result':'Current allocation preview')+'</h4>'+button('Download this analysis','download-analysis','data-pending-allowed')+'</div>'+original+'<p class="portfolio-muted">The original forecast reports '+esc(num(baseline.overloadedDays))+' calendar dates above its weekly-equivalent capacity. Allocation below uses the entered role-by-day calendar.</p>'+comparison+(baseline.eventTiming?'<p class="portfolio-note">'+esc(baseline.eventTiming.undatedHours)+' original hours and '+money(baseline.eventTiming.undatedDeliveryCostUsd)+' of work costs await work dates; '+money(baseline.eventTiming.undatedCustomerReceiptsUsd)+' of quoted collections await dates. The original dated cash curve excludes these undated amounts while complete scope totals retain them.</p>':'')+'<p class="portfolio-note">'+esc(report.paymentTimingBasis||'Cash uses the original operating forecast with the selected work dates. Quote receipt dates and original costs remain their entered values.')+'</p>'
      +'<h4>'+esc(chosen.name||chosen.id)+'</h4>'+findingsHtml(chosen.findings)
      +'<div class="portfolio-metrics"><div><span>Projected finish</span><strong>'+esc(summary.finishDate||'Unscheduled')+'</strong></div><div><span>Tasks scheduled</span><strong>'+esc(num(summary.scheduledTasks))+' / '+esc(num(summary.tasks))+'</strong></div><div><span>Late tasks</span><strong>'+esc(num(summary.lateTasks))+'</strong></div><div><span>Maximum lateness</span><strong>'+esc(num(summary.maxLatenessDays))+' days</strong></div><div><span>Cash needed before opening balance</span><strong>'+money(summary.additionalCashNeededUsd)+'</strong></div><div><span>Collection timing to review</span><strong>'+esc(num(summary.collectionTimingReviews))+'</strong></div></div>'
      +'<details open><summary>Delivery dates and dependencies</summary>'+(tasks.length?table(['Work','Ready','First work','Finish','Due','Lateness','Hours','Capacity delay'],tasks.map(t=>[esc(t.title||taskName(t.id||t.task_id)),esc(t.ready_date||'—'),esc(t.first_work_date||'—'),esc(t.finish_date||'Unscheduled'),esc(t.due_date||'—'),esc(num(t.late_calendar_days)),esc(num(t.effort_hours)),esc(num(t.capacity_delay_business_days))+' working days'])):empty('Complete the reported inputs to allocate the original work.'))+'</details>'
      +'<details open><summary>Resource workload</summary>'+(resources.length?table(['Resource','Requested hours','Allocated hours','Available hours','Utilization'],resources.map(r=>[esc(r.name||r.resource_id||r.id),esc(num(r.requested_hours)),esc(num(r.allocated_hours)),esc(num(r.available_hours)),r.utilization_percent===null||r.utilization_percent===undefined?'—':esc(r.utilization_percent)+'%'])):empty('Resource allocation is unavailable for this incomplete plan.'))+'</details>'
      +'<details><summary>Selected changes to original work dates</summary>'+table(['Work','Original start','Chosen start','Start change','Original finish','Chosen finish','Finish change'],list(chosen.chosenDates).map(r=>[esc(taskName(r.taskId)),esc(r.oldStartDate||'Undated'),esc(r.startDate||'Unscheduled'),r.startShiftDays===null?'New date':esc(num(r.startShiftDays))+' days',esc(r.oldEndDate||'Undated'),esc(r.endDate||'Unscheduled'),r.endShiftDays===null?'New date':esc(num(r.endShiftDays))+' days']))+'</details>'
      +'<details><summary>Daily workload ('+daily.length+')</summary>'+table(['Date','Resource','Available','Allocated','Remaining'],page(daily,s.dailyPage,40).map(r=>[esc(r.date),esc(r.resource_name||r.name||r.resource_id||r.resourceId||'Team'),esc(num(r.capacity_hours??r.available_hours??r.availableHours)),esc(num(r.allocated_hours??r.allocatedHours??r.hours)),esc(num(r.unused_hours??r.remaining_hours??r.remainingHours))]))+pager('daily',s.dailyPage,daily.length,40)+'</details>'
      +'<details><summary>Task allocations ('+allocations.length+')</summary>'+table(['Date','Work','Resource','Hours'],page(allocations,s.allocationPage,40).map(r=>[esc(r.date),esc(r.title),esc(r.resource_name||r.resource_id||r.resourceId||r.resource||'—'),esc(num(r.hours??r.allocated_hours))]))+pager('allocations',s.allocationPage,allocations.length,40)+'</details>'
      +'<details><summary>Original source and cash comparison</summary><p>Original case '+esc(source.programId||caseId)+' · source version '+esc(num(source.version))+'</p><p>Saved forecast '+esc(result.baseForecast?.id||s.draft?.forecastId)+' · '+esc(result.baseForecast?.sha256||s.draft?.forecastSha256)+'</p><p>Preview '+esc(result.previewSha256)+'</p>'+(s.saved?'<p>Saved portfolio '+esc(s.saved.id)+' · '+esc(s.saved.sha256)+'</p>':'')+'<p>'+esc(chosen.note||'')+'</p>'+table(['Cash curve','Cash needed','Ending change','Gap after entered balance'],Object.entries(chosen.forecast?.report?.scenarios||{}).map(([key,v])=>[esc(key),money(v.additionalCashNeededUsd),money(v.endDeltaUsd),money(v.gapAfterOpeningCashUsd)]))+'</details>'
      +(s.saved?'<div class="portfolio-selection"><h4>Use this delivery alternative</h4><p>Open a new original operating forecast draft with these package and customer start/finish dates. Review and save its cash assumptions in Operating forecast.</p>'+button('Open dated cash forecast draft','select-dates',chosen.status==='READY'?'':'disabled data-portfolio-disabled="true"')+' '+button('Download complete saved portfolio','download-portfolio')+'</div>':empty('Save the reviewed allocation to use one alternative in a new operating forecast.'))+'</section>';
  }
  function pendingHtml(){
    if(!s.pending)return s.recoveryRaw?'<section class="portfolio-pending"><h4>Retained browser recovery</h4><p>An earlier browser record could not be opened. Its exact text remains available. Review the original saved allocations and case history before replacing a save that may have completed.</p>'+button('Download retained browser record','download-recovery','data-pending-allowed')+'</section>':'';
    return '<section class="portfolio-pending"><h4>'+ (s.pending.rejected?'Original save was rejected':'Resolve the retained save request')+'</h4><p>'+esc(s.pending.rejected?s.pending.rejection?.message||'The service rejected this request.':'This exact save request remains retained. Repeating it reopens its original receipt if the save completed.')+'</p><div class="portfolio-actions">'+(s.pending.rejected?button('Keep draft and prepare a new request','new-request','data-pending-allowed')+' '+button('Reload current case','reload','data-pending-allowed'):button('Retry the same save request','retry-save','data-pending-allowed'))+' '+button('Download retained request','download-request','data-pending-allowed')+'</div></section>';
  }
  function render(){
    if(!available())return;
    captureDialog();
    const forecasts=list(current.forecasts),selectedName=s.baseForecast?.inputs?.name||s.baseForecast?.name||s.draft?.forecastId||'';
    root.innerHTML='<div class="portfolio-heading"><div><h3>Portfolio delivery allocation</h3><p>Allocate the same remaining grant and customer work, then compare its dated cash needs.</p></div><div class="portfolio-actions">'+button('Download draft','download-draft','data-pending-allowed'+(!s.draft?' disabled data-portfolio-disabled="true"':''))+button('Import plan JSON','import')+'</div></div><p data-portfolio-status role="'+(s.error?'alert':'status')+'" aria-live="polite">'+esc(s.error||s.message)+'</p><p class="portfolio-note" data-portfolio-storage>'+esc(s.storageWarning)+'</p>'+workingCopiesHtml()+pendingHtml()
      +'<div class="portfolio-source-bar">'+select('Original saved operating forecast',s.sourceChoice,forecasts.map(r=>[r.id,(r.name||r.id)+' · '+(r.asOfDate||'')]),'data-portfolio-source')+button('Create plan from this forecast','seed',forecasts.length?'':'disabled data-portfolio-disabled="true"')+select('Saved allocations',s.savedChoice,[['','Choose a saved allocation'],...s.portfolios.map(r=>[r.id,r.name||r.inputs?.name||r.id])],'data-portfolio-saved')+'</div>'
      +(selectedName?'<p class="portfolio-source-note">Source: <strong>'+esc(selectedName)+'</strong>'+ (s.baseForecast?.inputs?.asOfDate?' · as of '+esc(s.baseForecast.inputs.asOfDate):'')+'. '+s.sourceTasks.length+' original remaining-work entries.</p>':'')
      +(current.program.state==='CLOSED'?'<p class="portfolio-note">This case is closed. Read and preview the allocation, or reopen the case in its original controls before saving.</p>':'')
      +(s.saved?.current?.sourceChanged?'<p class="portfolio-note">The current case facts differ from this retained allocation source. The saved result remains its original calculation.</p>':'')
      +'<div class="portfolio-tabs" role="group" aria-label="Portfolio view">'+[['inputs','Inputs and alternatives'],['results','Delivery and cash comparison']].map(([id,title])=>button(title,'tab','data-id="'+id+'" aria-pressed="'+(s.tab===id)+'" data-pending-allowed')).join('')+'</div>'
      +(s.tab==='inputs'?'<div class="portfolio-editor">'+(s.saved?'<div class="portfolio-actions">'+button('Edit a new allocation from this saved input','edit-saved')+'</div><p class="portfolio-muted">The saved inputs remain immutable. Create a new allocation to change them.</p>':editor())+'</div>':'')
      +(s.draft&&!s.saved?'<div class="portfolio-review-bar"><p data-portfolio-draft-state>'+esc(s.preview?'Reviewed input and source ready to save.':'Draft — preview before saving.')+'</p>'+button('Preview allocation and cash','preview')+button(s.pending?'Resolve retained request':'Save reviewed allocation','save',s.preview&&current.program.state!=='CLOSED'?'':'disabled data-portfolio-disabled="true"')+'</div>':'')
      +'<div data-portfolio-analysis>'+(s.tab==='results'||s.preview||s.saved?analysisHtml():'')+'</div><input type="file" accept=".json,application/json" data-portfolio-file hidden><dialog class="portfolio-dialog" aria-label="Resource availability editor"><form method="dialog" data-portfolio-dialog><h4 data-dialog-title></h4><div data-dialog-fields class="portfolio-fields"></div><p data-dialog-error role="alert"></p><div class="portfolio-actions"><button type="button" data-portfolio-action="cancel-dialog">Cancel</button><button type="submit">Apply to this draft</button></div></form></dialog>';
    restoreControls();busy(s.busy);
  }
  async function attachSource(forecastId){
    const original=await api(path+'/forecasts/'+forecastId);s.baseForecast=original;
    if(s.draft&&original.sha256!==s.draft.forecastSha256)throw new Error('The selected original forecast differs from this draft’s saved source identity.');
    if(!s.sourceTasks.length)s.sourceTasks=sourceRows(original);
  }
  async function seed(){
    if(s.pending)throw new Error('Resolve the original pending save request first.');
    if(!s.sourceChoice)throw new Error('Select an original saved operating forecast.');
    if(s.dirty&&!window.confirm('Replace the current editable draft with a plan from the selected saved forecast?'))return;
    const value=await api(path+'/portfolio-seed',{expectedVersion:current.program.version,forecastId:s.sourceChoice});
    s.rawFields={};s.resourceDialogs={};s.openDialogKey=null;s.attachments=[];
    s.draft=inputShape(value.inputs);s.sourceTasks=list(value.sourceTasks);s.baseForecast=value.baseForecast;s.saved=null;s.preview=null;s.pending=null;s.profile='base';s.resultProfile='base';s.savedChoice='';s.dirty=false;s.requestNonce='';onSelection(null);
    if(!s.baseForecast?.report)await attachSource(s.draft.forecastId);
    retain();render();status('Created a draft from the original remaining work. Enter daily availability and any unassigned effort.');
  }
  async function loadSaved(id){
    if(s.pending)throw new Error('Resolve the original pending save request first.');
    if(s.dirty&&!window.confirm('Open the saved allocation and replace the current editable draft?')){render();return;}
    const value=await api(path+'/portfolios/'+id);s.rawFields={};s.resourceDialogs={};s.openDialogKey=null;s.attachments=[];s.saved=value;s.preview=null;s.draft=inputShape(value.inputs);s.sourceTasks=list(value.report?.sourceTasks);s.sourceChoice=s.draft.forecastId;s.savedChoice=value.id;s.profile='base';s.resultProfile='base';s.dirty=false;s.pending=null;s.tab='results';s.dailyPage=0;s.allocationPage=0;await attachSource(s.draft.forecastId);onSelection(value.id);retain();render();status('Reopened the original saved allocation and its source-bound cash comparison.');
  }
  async function preview(){
    if(s.pending)throw new Error('Resolve the original pending save request first.');
    if(!s.draft)throw new Error('Create or import a portfolio draft first.');
    if(portfolioUnfinishedFields(sessionSnapshot()).length)throw new Error('Finish the partly typed numeric values before previewing. Their exact text remains in this working copy, including other alternatives.');
    const value=await api(path+'/portfolio-preview',{expectedVersion:current.program.version,inputs:clone(s.draft)});
    s.draft=inputShape(value.inputs);s.rawFields={};s.preview=value;s.saved=null;s.savedChoice='';s.sourceTasks=list(value.report?.sourceTasks);s.tab='results';s.resultProfile=resultRows().some(r=>r.id===s.resultProfile)?s.resultProfile:'base';s.dailyPage=0;s.allocationPage=0;onSelection(null);retain();render();status('Calculated the original work, explicit capacity and dated cash alternatives. Incomplete plans can be retained for further work.');
  }
  async function save(){
    if(!s.pending){
      if(!s.preview)throw new Error('Preview the current allocation before saving.');
      if(current.program.state==='CLOSED')throw new Error('Reopen the original case before saving an allocation.');
      const payload={expectedVersion:current.program.version,actor:recordingActor(),note:s.draft.note||'',action:'portfolio.save',data:{inputs:clone(s.preview.inputs),expectedPreviewSha256:s.preview.previewSha256}};
      payload.requestId=await mutationId('operations:'+caseId+(s.requestNonce?':portfolio:'+s.requestNonce:''),payload);ensure();
      s.pending={payload,createdAt:new Date().toISOString(),rejected:false};retain();render();
    }
    if(s.pending.rejected)throw new Error('The original request was rejected. Keep the draft and explicitly prepare a new request.');
    await persistWorking();
    let result;
    try{result=await api(path+'/command',clone(s.pending.payload));}
    catch(error){if(available()&&rejected(error)){s.pending.rejected=true;s.pending.rejection={code:error.code||null,status:error.status||null,message:error.message};retain();render();}throw error;}
    if(result.id!==caseId||result.action!=='portfolio.save'||result.kind!=='portfolio'||typeof result.recordId!=='string'||!result.recordId.startsWith('portfolio-'))throw new Error('Reopen the original save request: its returned operation identity needs reconciliation.');
    s.pending=null;s.dirty=false;s.savedChoice=result.recordId;onSelection(result.recordId);await persistWorking();
    await onSaved(result);
  }
  function showResourceDialog(index,kind,dateValue=''){
    if(!editable('resources'))return;
    const p=effective(),r=p.resources[index],dialog=$('dialog');if(!r)throw new Error('The selected resource is unavailable.');
    const hint=roleHint(r.id),days=list(p.calendar.weekdays);
    dialog.dataset.resourceIndex=String(index);dialog.dataset.kind=kind;dialog.dataset.originalDate=dateValue;
    $('[data-dialog-title]').textContent=kind==='spread'?'Distribute an entered weekly total':'Dated resource capacity';
    $('[data-dialog-fields]').innerHTML=kind==='spread'?input('Weekly hours',hint?.weeklyHours??'','name="weekly" required min="0" max="7000000000" step="0.00000001"','number','Applied across the selected weekly working days: '+days.map(i=>DAYS[i]).join(', ')+'. Other weekdays become explicitly unavailable (0).'):input('Date',dateValue,'name="date" required','date')+input('Available hours',dateValue?r.hoursByDate?.[dateValue]:'','name="hours" required min="0" max="1000000000" step="0.00000001"','number');
    const key=JSON.stringify([s.profile,r.id,kind,dateValue]);s.resourceDialogs[key]||={profile:s.profile,resourceId:r.id,kind,originalDate:dateValue,values:{}};s.openDialogKey=key;for(const el of dialog.querySelectorAll('input[name]'))if(Object.hasOwn(s.resourceDialogs[key].values,el.name))el.value=s.resourceDialogs[key].values[el.name];
    $('[data-dialog-error]').textContent='';dialog.showModal();captureDialog();retain();
  }
  function editEvent(event){
    if(s.busy||s.hostBusy||s.pending||currentCopy()?.archived||!s.draft)return;
    const el=event.target;if(el.closest('dialog')){captureDialog();retain();return;}const fieldKey=rawKey(el);if(fieldKey)s.rawFields[fieldKey]=rawValue(el);const p=effective();let touched=false;
    if(el.dataset.portfolioInput){s.draft[el.dataset.portfolioInput]=el.value;touched=true;}
    else if(el.dataset.portfolioAltKey){const a=selectedAlternative();if(a){a[el.dataset.portfolioAltKey]=el.value;touched=true;}}
    else if(el.dataset.portfolioCalendar&&editable('calendar')){p.calendar[el.dataset.portfolioCalendar]=el.dataset.portfolioCalendar==='horizonDays'?integer(el.value):el.value;touched=true;}
    else if(el.dataset.portfolioDates&&editable('calendar')){p.calendar[el.dataset.portfolioDates]=textList(el.value);touched=true;}
    else if(el.hasAttribute('data-portfolio-weekday')&&editable('calendar')){const set=new Set(p.calendar.weekdays||[]),d=Number(el.dataset.portfolioWeekday);if(el.checked)set.add(d);else set.delete(d);p.calendar.weekdays=[...set].sort((a,b)=>a-b);touched=true;}
    else if(el.hasAttribute('data-portfolio-resource')&&editable('resources')){
      const r=p.resources[Number(el.dataset.portfolioResource)];if(!r)return;
      if(el.hasAttribute('data-capacity-day')){if(!Array.isArray(r.hoursByWeekday))r.hoursByWeekday=Array(7).fill(null);r.hoursByWeekday[Number(el.dataset.capacityDay)]=optional(el.value);}
      else r[el.dataset.resourceKey]=el.value;touched=true;
    }else if(el.hasAttribute('data-portfolio-task')&&editable('tasks')){
      const t=p.tasks[Number(el.dataset.portfolioTask)];if(!t)return;
      if(el.hasAttribute('data-effort-resource')){t.effortHours||={};t.effortHours[el.dataset.effortResource]=optional(el.value);}
      else if(el.hasAttribute('data-task-dependencies'))t.dependsOn=[...el.selectedOptions].map(x=>x.value);
      else{const key=el.dataset.taskKey;t[key]=['minBusinessDays','priority'].includes(key)?integer(el.value):['releaseDate','dueDate'].includes(key)?optional(el.value):el.value;}
      touched=true;
    }
    if(touched){invalidate();if(el.hasAttribute('data-effort-resource')){const task=p.tasks[Number(el.dataset.portfolioTask)],amounts=Object.values(task.effortHours||{}).map(quantity),total=amounts.every(v=>v!==null)?amounts.reduce((a,b)=>a+b,0n):null;const summary=el.closest('.portfolio-task')?.querySelector('summary small');if(summary)summary.textContent=total===null?'Assignments incomplete':decimal(total)+' / '+num(taskHours(task.id))+' source hours'+(quantity(taskHours(task.id))!==total?' — reconcile total':'');}}
  }
  root.addEventListener('input',event=>{const el=event.target;if(el.hasAttribute('data-working-name')){s.copyName=el.value;retain();return;}if(el.hasAttribute('data-working-checkpoint-label')){s.checkpointLabel=el.value;retain();return;}editEvent(event);});
  root.addEventListener('change',event=>{
    const el=event.target;
    if(el.hasAttribute('data-working-copy')){const id=el.value;run(async()=>{if(currentCopy()&&!currentCopy().archived)await persistWorking();acceptCopies(await copyStore.select(id));await adoptWorking(currentCopy().head);s.copyName='';s.historyChoice='';render();status('Opened the complete retained working copy. Preview against the current case before preparing a new save.');});return;}
    if(el.hasAttribute('data-working-archived')){s.archivedChoice=el.value;return;}
    if(el.hasAttribute('data-working-history')){s.historyChoice=el.value;retain();render();return;}
    if(el.hasAttribute('data-working-file')){const file=el.files[0];if(!file)return;run(async()=>{if(file.size>PORTFOLIO_WORKING_LIMITS.fileBytes)throw new Error('Choose a complete working file within 128 MiB.');const value=JSON.parse(await file.text());ensure();if(value.schema!=='stellar-forge.portfolio-working-copy.v1'||!value.copy)throw new Error('Choose the complete Portfolio working-copy file.');await validatePortableCopy(value.copy);ensure();if(currentCopy()&&!currentCopy().archived)await persistWorking();acceptCopies(await copyStore.importCopy(value));await adoptWorking(currentCopy().head);s.copyName='';s.historyChoice='';render();status('Received the complete original copy as a new local identity. Prior working copies remain intact.');});return;}
    if(el.hasAttribute('data-portfolio-source')){s.sourceChoice=el.value;retain();return;}
    if(el.hasAttribute('data-portfolio-saved')){const id=el.value;if(id)run(()=>loadSaved(id));return;}
    if(el.hasAttribute('data-portfolio-profile')){s.profile=el.value;retain();render();return;}
    if(el.hasAttribute('data-portfolio-override')&&!s.busy&&!s.pending){const a=selectedAlternative(),field=el.dataset.portfolioOverride;if(a){for(const key of Object.keys(s.rawFields))if(JSON.parse(key)[0]===s.profile)delete s.rawFields[key];if(el.checked)a[field]=clone(s.draft[field]);else delete a[field];invalidate(true);}return;}
    if(el.hasAttribute('data-portfolio-file')){
      const file=el.files[0];if(!file)return;
      run(async()=>{if(s.pending)throw new Error('Resolve the original retained save first.');if(file.size>2*1024*1024)throw new Error('Choose a complete portfolio input smaller than 2 MiB.');const value=inputShape(JSON.parse(await file.text()));ensure();if(s.dirty&&!window.confirm('Replace the current editable draft with this imported portfolio input?'))return;s.draft=value;s.rawFields={};s.resourceDialogs={};s.openDialogKey=null;s.attachments=[];s.sourceChoice=value.forecastId;s.sourceTasks=[];s.baseForecast=null;s.saved=null;s.preview=null;s.profile='base';s.resultProfile='base';s.savedChoice='';s.dirty=true;await attachSource(value.forecastId);onSelection(null);retain();render();status('Loaded the complete source-bound draft. Preview it against this current case before saving.');});return;
    }
    editEvent(event);
  });
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-portfolio-dialog]'))return;event.preventDefault();
    const dialog=$('dialog'),p=effective(),r=p.resources[Number(dialog.dataset.resourceIndex)];
    try{
      if(s.busy||s.pending||!editable('resources'))throw new Error('Return to the current editable resource plan.');
      if(!event.target.reportValidity())return;
      if(dialog.dataset.kind==='spread'){
        const value=quantity(event.target.elements.weekly.value),days=list(p.calendar.weekdays);if(value===null||!days.length)throw new Error('Enter a nonnegative weekly total and at least one working weekday.');
        const count=BigInt(days.length),base=value/count,remainder=value%count,capacities=Array(7).fill('0');
        days.forEach((d,i)=>{const q=base+(BigInt(i)<remainder?1n:0n);if(q>1000000000n*SCALE)throw new Error('The chosen distribution exceeds 1,000,000,000 available staff-hours on a day.');capacities[d]=decimal(q);});
        r.hoursByWeekday=capacities;r.note=(r.note?r.note+'\n':'')+'Operator distributed '+decimal(value)+' weekly hours over '+days.map(d=>DAYS[d]).join(', ')+'.';
      }else{
        const d=event.target.elements.date.value,h=quantity(event.target.elements.hours.value);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||h===null||h>1000000000n*SCALE)throw new Error('Enter a valid date and available staff-hours from 0 to 1,000,000,000.');
        r.hoursByDate||={};if(d!==dialog.dataset.originalDate&&Object.hasOwn(r.hoursByDate,d))throw new Error('That date already has an override. Edit its original row.');
        if(dialog.dataset.originalDate)delete r.hoursByDate[dialog.dataset.originalDate];r.hoursByDate[d]=decimal(h);
      }
      delete s.resourceDialogs[s.openDialogKey];s.openDialogKey=null;dialog.close();for(const key of Object.keys(s.rawFields)){const parts=JSON.parse(key);if(parts[0]===s.profile&&parts.includes('resource:'+r.id))delete s.rawFields[key];}invalidate(true);
    }catch(error){$('[data-dialog-error]').textContent=error.message;}
  });
  root.addEventListener('click',event=>{
    const el=event.target.closest('[data-portfolio-action]');if(!el||el.disabled)return;
    const action=el.dataset.portfolioAction;
    if(action==='cancel-dialog'){captureDialog();$('dialog').close();retain();return;}
    if(action.startsWith('working-')){if(s.busy||s.hostBusy)return;run(()=>workingAction(action));return;}
    if(action==='download-draft'){if(s.draft)download(json(s.draft),'portfolio-inputs.json');return;}
    if(action==='download-recovery'){if(s.recoveryRaw)download(s.recoveryRaw,'portfolio-browser-recovery.json');return;}
    if(action==='download-request'){if(s.pending||s.lastRejected)download(json(s.pending||s.lastRejected),'portfolio-save-request.json');return;}
    if(action==='tab'){s.tab=el.dataset.id;render();return;}
    if(s.busy||s.hostBusy||currentCopy()?.archived)return;
    if(s.pending&&!['retry-save','new-request','reload','download-analysis','result-alternative','page-daily','page-allocations'].includes(action))return;
    if(action==='import'){$('[data-portfolio-file]').value='';$('[data-portfolio-file]').click();return;}
    if(action==='result-alternative'){s.resultProfile=el.dataset.id;s.dailyPage=0;s.allocationPage=0;retain();render();return;}
    if(action.startsWith('page-')){const chosen=selectedResult(),tasks=list(chosen?.schedule?.tasks),count=action==='page-daily'?list(chosen?.schedule?.daily_workload).length:tasks.reduce((n,t)=>n+list(t.allocations).length,0),key=action==='page-daily'?'dailyPage':'allocationPage';s[key]=Math.max(0,Math.min(Math.ceil(count/40)-1,s[key]+Number(el.dataset.direction)));render();return;}
    run(async()=>{
      if(action==='seed')return seed();
      if(action==='preview')return preview();
      if(action==='save'||action==='retry-save')return save();
      if(action==='reload')return onReload();
      if(action==='new-request'){
        if(!s.pending?.rejected)throw new Error('Retain the unresolved original request.');
        s.lastRejected=clone(s.pending);s.draft=inputShape(s.pending.payload.data.inputs);s.pending=null;s.preview=null;s.saved=null;s.savedChoice='';s.requestNonce=crypto.randomUUID();s.dirty=true;s.tab='inputs';retain();render();status('Retained the rejected request and editable draft. Reload the current case if its version changed, then preview before the new save.');return;
      }
      if(action==='edit-saved'){s.draft=inputShape(s.saved.inputs);s.draft.name+=' — revised';s.rawFields={};s.resourceDialogs={};s.openDialogKey=null;s.saved=null;s.savedChoice='';s.preview=null;s.dirty=true;s.profile='base';s.tab='inputs';onSelection(null);retain();render();return;}
      if(action==='add-alternative'){if(!s.draft)return;const a={id:uid('alternative'),name:'New alternative',note:''};s.draft.alternatives.push(a);s.profile=a.id;invalidate(true);return;}
      if(action==='remove-alternative'){const a=selectedAlternative();if(a&&window.confirm('Remove this editable alternative?')){s.draft.alternatives=s.draft.alternatives.filter(x=>x.id!==a.id);s.profile='base';invalidate(true);}return;}
      const p=effective(),index=Number(el.dataset.index);
      if(action==='add-resource'){if(!editable('resources'))return;p.resources.push({id:uid('resource'),name:'',hoursByWeekday:Array(7).fill(null),hoursByDate:{},note:''});invalidate(true);return;}
      if(action==='remove-resource'){
        if(!editable('resources'))return;const r=p.resources[index];if(!r)return;
        if(!own('tasks'))throw new Error('Enable the whole task override before removing an alternative resource used by inherited tasks.');
        if(window.confirm('Remove this resource and its effort assignments from this editable plan?')){p.resources.splice(index,1);for(const t of p.tasks)delete t.effortHours?.[r.id];invalidate(true);}return;
      }
      if(action==='spread-resource'){showResourceDialog(index,'spread');return;}
      if(action==='add-date'||action==='edit-date'){showResourceDialog(index,'date',el.dataset.date||'');return;}
      if(action==='remove-date'){if(editable('resources')){delete p.resources[index].hoursByDate[el.dataset.date];invalidate(true);}return;}
      if(action==='download-analysis'){download(json(s.preview||s.saved),'portfolio-analysis.json');return;}
      if(action==='download-portfolio'){const response=await api(path+'/portfolios/'+s.saved.id+'/export.zip',undefined,{download:true}),blob=await response.blob();ensure();download(blob,s.saved.id+'.zip','application/zip');return;}
      if(action==='select-dates'){
        const selected=selectedResult();if(!s.saved||selected?.status!=='READY')throw new Error('Choose a saved complete allocation alternative.');
        const value=await api(path+'/portfolio-selection',{expectedVersion:current.program.version,portfolioId:s.saved.id,alternativeId:selected.id});
        if(!plain(value.inputs)||!plain(value.selection))throw new Error('Reopen the original portfolio date selection.');
        await onForecastInputs(value.inputs,value.selection);return;
      }
    });
  });
  function retainLegacyText(){
    try{const raw=sessionStorage.getItem(cacheKey);if(raw)s.recoveryRaw=raw;}catch{}
  }
  render();
  const ready=run(async()=>{
    try{
      copies=await copyStore.open();ensure();storeOpened=true;
      if(currentCopy())await adoptWorking(currentCopy().head);
      else{retainLegacyText();acceptCopies(await copyStore.create({name:'Current Portfolio draft',session:sessionSnapshot()}));}
    }catch(error){storeFailed=true;recoveryCollection=error.recovery||null;s.error=error.message;s.storageWarning='The prior working store remains unchanged. Download its retained recovery before replacing browser data.';}
    s.portfolios=list((await api(path+'/portfolios')).portfolios);
    s.sourceChoice||=list(current.forecasts)[0]?.id||'';
    if(initialPortfolioId&&!s.pending&&!s.dirty&&!s.recoveryRaw&&!s.draft&&!storeFailed){await loadSaved(initialPortfolioId);return;}
    if(s.draft){
      if(!s.baseForecast)await attachSource(s.draft.forecastId);
      render();status(s.pending?'Recovered the original pending save. Retry preserves its exact request identity.':'Recovered the complete editable working copy. Current case version '+current.program.version+'; the retained source and saved calculations remain original.');
    }else{render();if(!s.error)status('Choose a saved operating forecast to begin.');}
  });
  return {root,ready,setHostBusy(value){s.hostBusy=Boolean(value);busy(s.busy);},dispose(){if(!s.active)return;clearTimeout(autosaveTimer);if(storeOpened&&!storeFailed)persistWorking().catch(()=>{}).finally(()=>copyStore.close());else copyStore.close();s.active=false;s.generation++;const dialog=root.querySelector('dialog');if(dialog?.open)dialog.close();}};
}
