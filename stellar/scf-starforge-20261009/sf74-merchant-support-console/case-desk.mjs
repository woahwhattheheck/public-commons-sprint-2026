// MIT. Multi-merchant case desk composed with the original SF74 file codec.
import {parseWorkspace, serializeWorkspace} from './workspace-file.mjs';

const STATUS = Object.freeze({new:'New', in_progress:'In progress', waiting:'Awaiting input',
  ready:'Ready for review', closed:'Closed', archived:'Archived'});
const add = (parent, tag, text, className = '') => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  parent.append(node); return node;
};
const button = (parent, text, action, className = 'secondary') => {
  const node = add(parent,'button',text,className); node.type = 'button';
  node.addEventListener('click',action); return node;
};
const dateLabel = value => new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const today = () => { const now=new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; };
const defaults = () => ({merchant:'',owner:'',status:'new',followUpOn:'',nextAction:'',notes:''});
const emptyState = () => ({name:'Merchant case',inputs:{resource:'',catalog:'',origin:'',network:'stellar:testnet',payTo:'',method:'GET',credentialed:false},sources:{},termsText:'',baselineOnly:false});

export function mountCaseDesk({root,readState,applyState,onNameChange = ()=>{}}) {
  const abort = new AbortController();
  let enabled=false, busy=false, dirty=false, active=null, candidateId=crypto.randomUUID();
  let generation=0, identity=0, applying=false, listSequence=0, offset=0, nextOffset=null;
  let pendingTransition=null, lastAttempt=null, historyBefore=null, destroyed=false;
  root.replaceChildren(); root.id='cases';
  const panel = add(root,'section',undefined,'card case-desk');
  const top = add(panel,'div',undefined,'section-heading');
  const heading = add(top,'div'); add(heading,'p','Merchant operations','eyebrow');
  add(heading,'h2','Case desk');
  add(heading,'p','Keep each merchant route, its original captures and the next follow-up together.');
  const indicator = add(top,'span','Connecting to local case storage…','stage-hint');
  const status = add(panel,'p','Reading the local case list…','status');
  status.id='case-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const body=add(panel,'div'); body.hidden=true;
  const filter=add(body,'form',undefined,'case-filters'); filter.setAttribute('aria-label','Find merchant cases');
  function input(parent,label,type,key,maxLength) {
    const wrap=add(parent,'label',label), field=add(wrap,type==='textarea'?'textarea':'input');
    field.id='case-'+key; if(type!=='textarea') field.type=type;
    if(maxLength) field.maxLength=maxLength;
    field.autocomplete='off'; return field;
  }
  const search=input(filter,'Search cases','search','search',250);
  const filterLabel=add(filter,'label','Work status'), filterStatus=add(filterLabel,'select');
  filterStatus.id='case-filter-status';
  add(filterStatus,'option','All active').value='';
  for(const [value,label] of Object.entries(STATUS)) add(filterStatus,'option',label).value=value;
  const dueLabel=add(filter,'label',undefined,'case-due-toggle'), due=add(dueLabel,'input'); due.type='checkbox'; due.id='case-due';
  add(dueLabel,'span','Due today or earlier');
  const searchButton=add(filter,'button','Search','secondary'); searchButton.type='submit';
  const counter=add(body,'p','','hint');
  const tableWrap=add(body,'div',undefined,'case-table-wrap');
  const table=add(tableWrap,'table',undefined,'case-table');
  table.setAttribute('aria-label','Saved merchant cases');
  const header=add(add(table,'thead'),'tr');
  for(const title of ['Case / route','Owner','Work status','Follow-up','Updated']) add(header,'th',title).scope='col';
  const rows=add(table,'tbody');
  const pagination=add(body,'div',undefined,'actions case-pagination');
  const previous=button(pagination,'Previous',()=>{offset=Math.max(0,offset-30);reload();});
  const next=button(pagination,'Next',()=>{if(nextOffset!==null){offset=nextOffset;reload();}});
  const refresh=button(pagination,'Refresh list',()=>reload());
  const create=button(pagination,'New case',()=>transition(newCase,'start a new case'));

  const editor=add(body,'div',undefined,'case-editor');
  const editorTop=add(editor,'div',undefined,'section-heading');
  const title=add(editorTop,'h3','Current draft'); title.id='case-current-title';
  const saved=add(editorTop,'span','Not saved','case-save-state');
  const grid=add(editor,'div',undefined,'form-grid');
  const name=input(grid,'Case name','text','name',120); name.value='Merchant case';
  const merchant=input(grid,'Merchant / company','text','merchant',120);
  const owner=input(grid,'Follow-up owner','text','owner',120);
  const workLabel=add(grid,'label','Work status'), workStatus=add(workLabel,'select'); workStatus.id='case-work-status';
  for(const [value,label] of Object.entries(STATUS)) add(workStatus,'option',label).value=value;
  const followUpOn=input(grid,'Follow-up date','date','follow-up',10);
  const nextAction=input(grid,'Next action','text','next-action',600);
  const notes=input(grid,'Case notes','textarea','notes',8000); notes.rows=3; notes.parentElement.className='full';
  add(editor,'p','Work status tracks your team’s work. The original diagnosis, commercial terms and workorder results remain separate.','hint');
  const actions=add(editor,'div',undefined,'actions');
  const saveButton=button(actions,'Save case',()=>save(),''); saveButton.id='case-save';
  const copy=button(actions,'Save as separate case',()=>saveCopy()); copy.id='case-save-copy';
  const versions=button(actions,'Saved versions',()=>showHistory()); versions.id='case-versions';
  const conflict=button(actions,'Open latest saved version',()=>active||lastAttempt?transition(()=>openCase(active?.id||lastAttempt.payload.id),'open the latest saved version'):undefined);
  conflict.hidden=true;
  const guard=add(editor,'div',undefined,'case-replace'); guard.hidden=true;
  const guardText=add(guard,'p');
  const guardActions=add(guard,'div',undefined,'actions');
  button(guardActions,'Keep editing',()=>{pendingTransition?.resolve(false);pendingTransition=null;guard.hidden=true;});
  button(guardActions,'Save, then continue',async()=>{
    const pending=pendingTransition;
    if(await save() && !dirty && pending===pendingTransition){pendingTransition=null;guard.hidden=true;pending.resolve(await pending.action());}
  },'');
  button(guardActions,'Discard draft changes and continue',async()=>{
    const pending=pendingTransition;pendingTransition=null;guard.hidden=true;if(pending)pending.resolve(await pending.action());
  });
  const history=add(editor,'div',undefined,'case-history');history.hidden=true;
  add(history,'h3','Saved versions');
  add(history,'p','Open a saved version as a draft. Saving that draft creates a new current version and retains the later versions.','hint');
  const historyRows=add(history,'div');
  const older=button(history,'Earlier versions',()=>showHistory(true));older.hidden=true;

  function say(message,error=false) {status.textContent=message;status.className=error?'status error':'status';}
  function controls() {
    for(const node of [saveButton,copy,refresh,create,searchButton,conflict]) node.disabled=busy||!enabled;
    versions.disabled=busy||!active;
    previous.disabled=busy||!offset;next.disabled=busy||nextOffset===null;
    saved.textContent=dirty ? 'Unsaved changes' : active ? 'Saved '+dateLabel(active.updatedAt) : 'Not saved';
    title.textContent=active?'Current case · '+active.name:'Current draft';
    editor.dataset.dirty=String(dirty);
    for(const node of rows.querySelectorAll('button')) node.disabled=busy;
  }
  function changed({user=false} = {}) {
    if((applying&&!user)||destroyed)return;
    generation++;dirty=true;controls();
  }
  function metadata() {return {merchant:merchant.value,owner:owner.value,status:workStatus.value,
    followUpOn:followUpOn.value,nextAction:nextAction.value,notes:notes.value};}
  function setMetadata(value) {
    const meta={...defaults(),...value};
    merchant.value=meta.merchant;owner.value=meta.owner;workStatus.value=meta.status;
    followUpOn.value=meta.followUpOn;nextAction.value=meta.nextAction;notes.value=meta.notes;
  }
  async function api(path,payload) {
    const response=await fetch(path,{method:payload?'POST':'GET',credentials:'omit',cache:'no-store',signal:abort.signal,
      ...(payload?{headers:{'content-type':'application/json'},body:JSON.stringify(payload)}:{})});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.detail||data.error||'Case operation unavailable'),{code:data.error});
    return data;
  }
  async function reload() {
    const sequence=++listSequence;
    const query=new URLSearchParams({q:search.value,status:filterStatus.value,offset:String(offset),limit:'30'});
    if(due.checked)query.set('dueOn',today());
    try{
      const result=await api('/api/cases?'+query);
      if(destroyed||sequence!==listSequence)return;
      enabled=result.enabled;body.hidden=!enabled;
      indicator.textContent=enabled?'Private case storage':'Session mode';
      if(!enabled){say('To keep a case queue between sessions, start this workspace with --cases-dir /absolute/private/directory. Portable case files remain available below.');return;}
      nextOffset=result.nextOffset;
      rows.replaceChildren();
      for(const entry of result.cases){
        const row=add(rows,'tr');if(entry.id===active?.id)row.setAttribute('aria-selected','true');
        const main=add(row,'td');
        button(main,entry.name,()=>transition(()=>openCase(entry.id),'open '+entry.name),'case-link');
        add(main,'small',entry.inputs.resource||entry.metadata.merchant||'Route not yet entered');
        add(row,'td',entry.metadata.owner||'Unassigned');
        add(row,'td',STATUS[entry.metadata.status]||entry.metadata.status);
        const day=add(row,'td',entry.metadata.followUpOn||'—');
        if(entry.metadata.followUpOn&&entry.metadata.followUpOn<=today()&&!['closed','archived'].includes(entry.metadata.status))
          add(day,'small','Follow-up due','case-due-label');
        add(row,'td',dateLabel(entry.updatedAt));
      }
      if(!result.cases.length)add(add(rows,'tr'),'td','No cases match this view.').colSpan=5;
      counter.textContent=`${result.total} matching case${result.total===1?'':'s'}`+
        (result.total?` · showing ${offset+1}–${offset+result.cases.length}`:'')+
        (result.unavailable.length?` · ${result.unavailable.length} stored case(s) need local file recovery`:'');
      if(!active&&!dirty)say('Select a saved case, or enter a new merchant route below and save it here.');
      controls();
    }catch(error){if(!destroyed)say('Case list unavailable: '+error.message,true);}
  }
  async function transition(action,label) {
    if(busy)return false;
    // Session mode has no visible case-desk controls. Its portable import already
    // has an explicit preview/replacement action, so do not hide a second prompt.
    if(dirty&&enabled){
      pendingTransition?.resolve(false);
      return new Promise(resolve=>{
        pendingTransition={action,resolve};
        guardText.textContent='You have unsaved changes. Choose how to continue before you '+label+'.';guard.hidden=false;
      });
    }
    return await action();
  }
  async function openCase(id,rev=null) {
    if(busy)return;
    busy=true;controls();const epoch=generation;
    try{
      const item=await api('/api/cases/'+encodeURIComponent(id)+(rev?'?revision='+encodeURIComponent(rev):''));
      const workspace=await parseWorkspace(item.workspaceText);
      if(destroyed||epoch!==generation)throw new Error('The draft changed while this case was opening. Open it again when ready.');
      applying=true;
      await applyState(workspace,{canReplace:()=>epoch===generation});
      identity++;active={...item,revision:item.currentRevision};candidateId=id;lastAttempt=null;
      name.value=workspace.name;onNameChange(workspace.name);setMetadata(item.metadata);
      dirty=Boolean(rev&&rev!==item.currentRevision);generation++;
      conflict.hidden=true;history.hidden=true;pendingTransition=null;guard.hidden=true;
      say(dirty?'Earlier version opened as a draft. Save case to retain it as a new current version.':'Case opened. Its original captures and unfinished terms are ready to continue.');
      return true;
    }catch(error){if(!destroyed)say('Case could not be opened: '+error.message,true);return false;}
    finally{applying=false;busy=false;if(!destroyed){controls();await reload();}}
  }
  async function newCase() {
    if(busy)return;busy=true;controls();const epoch=generation;
    try{
      const workspace=await parseWorkspace(await serializeWorkspace(emptyState()));
      if(epoch!==generation)throw new Error('The current draft changed. Start the new case again when ready.');
      applying=true;await applyState(workspace,{canReplace:()=>epoch===generation});
      identity++;active=null;candidateId=crypto.randomUUID();lastAttempt=null;
      name.value=workspace.name;onNameChange(workspace.name);setMetadata(defaults());
      dirty=false;generation++;history.hidden=true;conflict.hidden=true;
      say('New merchant case. Enter the route and follow-up details, then save.');
      return true;
    }catch(error){say(error.message,true);return false;}
    finally{applying=false;busy=false;controls();}
  }
  async function save() {
    if(busy||!enabled)return false;
    busy=true;controls();const stamp=generation, token=identity;
    const caseName=name.value, meta=metadata(), id=active?.id||candidateId;
    say('Saving case and original source files…');
    try{
      const payload=lastAttempt&&lastAttempt.stamp===stamp&&lastAttempt.token===token ? lastAttempt.payload : {
        id,expectedRevision:active?.revision||null,metadata:meta,
        workspaceText:await serializeWorkspace({...await readState(),name:caseName}),
      };
      lastAttempt={payload,stamp,token};
      const result=await api('/api/cases',payload);
      if(destroyed||identity!==token)return false;
      active=result.case;candidateId=active.id;lastAttempt=null;conflict.hidden=true;
      dirty=generation!==stamp;
      say(dirty?'Saved the captured draft. Newer edits are still unsaved.':'Case saved. '+STATUS[active.metadata.status]+(active.metadata.followUpOn?' · follow-up '+active.metadata.followUpOn:''));
      await reload();return !dirty;
    }catch(error){
      if(!destroyed){
        conflict.hidden=error.code!=='CASE_CONFLICT';
        say(error.code==='CASE_CONFLICT'?'A newer saved version exists. Your draft is retained. Open the latest version or save your draft as a separate case.':
          'Save did not complete: '+error.message+'. Your draft is retained; retry Save case.',true);
      }
      return false;
    }finally{busy=false;if(!destroyed)controls();}
  }
  async function saveCopy() {
    if(busy)return;
    identity++;active=null;candidateId=crypto.randomUUID();lastAttempt=null;dirty=true;generation++;
    conflict.hidden=true;history.hidden=true;await save();
  }
  async function importWorkspace(state) {
    return transition(async()=>{
      if(busy)return false;
      busy=true;controls();const epoch=generation;
      try{
        applying=true;
        await applyState(state,{canReplace:()=>epoch===generation});
        identity++;active=null;candidateId=crypto.randomUUID();lastAttempt=null;
        name.value=state.name;onNameChange(state.name);setMetadata(defaults());
        dirty=true;generation++;history.hidden=true;conflict.hidden=true;
        say('Workspace file imported as a new case draft. Add follow-up details and save it to the case desk.');
        return true;
      }catch(error){say('Workspace could not be imported: '+error.message,true);return false;}
      finally{applying=false;busy=false;controls();}
    },'import this workspace file');
  }
  async function showHistory(more=false) {
    if(!active||busy)return;
    busy=true;controls();const id=active.id;
    try{
      const result=await api('/api/cases/'+id+'/history'+(more&&historyBefore?'?before='+historyBefore:''));
      if(!more)historyRows.replaceChildren();
      for(const item of result.revisions){
        const row=add(historyRows,'div',undefined,'case-version');
        add(row,'span',`${dateLabel(item.updatedAt)} · ${item.name} · ${STATUS[item.metadata.status]}`);
        button(row,item.revision===result.currentRevision?'Open current':'Open as draft',()=>transition(()=>openCase(id,item.revision),'open this saved version'));
      }
      historyBefore=result.nextBefore;older.hidden=!historyBefore;history.hidden=false;
    }catch(error){say('Saved versions unavailable: '+error.message,true);}
    finally{busy=false;controls();}
  }
  for(const field of [name,merchant,owner,workStatus,followUpOn,nextAction,notes])field.addEventListener('input',()=>{
    changed({user:true});if(field===name)onNameChange(name.value);
  },{signal:abort.signal});
  filter.addEventListener('submit',event=>{event.preventDefault();offset=0;reload();},{signal:abort.signal});
  window.addEventListener('beforeunload',event=>{if(enabled&&dirty){event.preventDefault();event.returnValue='';}},{signal:abort.signal});
  reload();
  return {
    changed,
    importWorkspace,
    rename(value){name.value=value;changed();},
    detach(value='Merchant case'){
      identity++;active=null;candidateId=crypto.randomUUID();lastAttempt=null;name.value=value;
      setMetadata(defaults());dirty=true;generation++;history.hidden=true;conflict.hidden=true;
      say('Imported case is a new draft. Save case to add it to this case desk.');controls();
    },
    destroy(){destroyed=true;pendingTransition?.resolve(false);abort.abort();root.replaceChildren();},
  };
}
