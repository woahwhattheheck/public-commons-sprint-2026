// MIT. Complete review rounds in the original Stellar Forge browser workspace.
import { SCHEMA as DRAFT_SCHEMA } from './grant-submission-core.mjs';
import { listDrafts, loadDraft, saveDraft } from './drafts.mjs';
import { REVIEW_SCHEMA, REVIEW_MAX_BYTES, createReviewRound, readSubmissionExport, captureSubmissionDraft,
  applyReviewAction, reviewRoundView, compareReviewDraft, exportReviewRound, importReviewRound, reviewReport } from './grant-review-round-core.mjs';

import { WORKING_SCHEMA, WORKING_MAX_BYTES, newWorkingCopy, saveWorkingCopy, loadWorkingCopy,
  listWorkingCopies, forkWorkingCopy, exportWorkingCopy, importWorkingCopy } from './grant-review-working-copy.mjs';
const $ = id => document.getElementById(id);
const node = (tag, value, cls) => { const item=document.createElement(tag); if(value!==undefined)item.textContent=String(value); if(cls)item.className=cls; return item; };
const uid = () => crypto.randomUUID();
const keyOf = target => target.kind+':'+target.id;
let round=null, view=null, savedId=null, savedRevision=0, dirty=false, busy=false;
let screen='targets', selectedTarget='application:application', viewedEdition=null, actorId=null, filePurpose='start';
let incoming=null, comparison=null, initialCapture=null;
const formDrafts=new Map(), carryChoices=new Map(), formContexts=new Map();
let workingBase=newWorkingCopy(), workingRevision=0, workingGeneration=0, storedGeneration=0;
let workingTimer=null, workingTail=Promise.resolve(), workingWrite=null, workingError=null, workingReady=false;
let newFields={newTitle:'',newPerson:'',newFormat:'plain',newParticipant:''};
function readStartFields(){
  for(const [name,id]of Object.entries({newTitle:'review-new-title',newPerson:'review-new-person',newFormat:'review-new-format',newParticipant:'review-new-participant'})){
    if($(id))newFields[name]=$(id).value;
  }
}
function workingMetadata(value){
  // The live fields below have their own owners. Preserve any other original
  // envelope members without pinning a superseded round or unfinished form graph.
  const {round,incoming,initialCapture,ui,forms,contexts,carryChoices,native,...metadata}=value;
  return metadata;
}
function workingSnapshot(){
  readStartFields();
  const label=(round?.title||newFields.newTitle||'Prepared submission review').slice(0,1000);
  return structuredClone({...workingBase,label,folder:'SCF review working — '+label,round,incoming,initialCapture,
    ui:{screen,selectedTarget,viewedEdition,actorId,...newFields},
    forms:[...formDrafts],contexts:[...formDrafts.keys()].map(key=>[key,formContexts.get(key)]),
    carryChoices:[...carryChoices],native:{id:savedId,revision:savedRevision,dirty}});
}
function workingStatus(){
  const pending=workingGeneration!==storedGeneration;
  $('review-working-state').textContent=workingError?'Working copy is not saved: '+workingError.message+' Download the complete working package or save a separate copy.':
    pending?'Saving the complete working copy…':workingRevision?'Complete working copy saved · browser revision '+workingRevision+'. Unfinished text remains unrecorded.':'This window has its own working copy.';
}
function scheduleWorking(){
  if(!workingReady)return;readStartFields();workingGeneration++;clearTimeout(workingTimer);workingStatus();
  workingTimer=setTimeout(()=>{flushWorking().catch(()=>{});},450);
}
async function flushWorking(){
  clearTimeout(workingTimer);
  // All callers join one writer. Capture only when that writer is ready, never
  // while it is waiting for IndexedDB to commit a preceding complete copy.
  if(workingWrite)return workingWrite;
  if(workingGeneration===storedGeneration&&workingRevision)return;
  const id=workingBase.id;
  const task=Promise.resolve().then(async()=>{
    try{
      do{
        if(workingBase.id!==id)throw new Error('The working selection changed before its complete save finished.');
        clearTimeout(workingTimer);
        const generation=workingGeneration;
        // Keep the full snapshot immutable across the original asynchronous CAS.
        // This block releases both it and the returned record before the next copy.
        {
          const value=workingSnapshot();
          const saved=await saveWorkingCopy(value,{recordId:id,revision:workingRevision});
          workingRevision=saved.revision;storedGeneration=generation;workingError=null;
        }
        const url=new URL(location.href);url.searchParams.set('working',id);history.replaceState(null,'',url);
        workingStatus();
      }while(workingGeneration!==storedGeneration);
    }catch(error){workingError=error;workingStatus();throw error;}
  });
  workingWrite=task;
  // The settled tail deliberately returns no full record or source graph.
  workingTail=task.finally(()=>{if(workingWrite===task)workingWrite=null;});
  return workingTail;
}
function beginSelection(){
  clearTimeout(workingTimer);workingBase=newWorkingCopy();workingRevision=0;workingGeneration=0;storedGeneration=0;workingError=null;
  formDrafts.clear();formContexts.clear();carryChoices.clear();newFields={newTitle:'',newPerson:'',newFormat:'plain',newParticipant:''};
  $('review-new-participant').value='';
}
async function installWorking(value,{persist=true}={}){
  clearTimeout(workingTimer);await workingTail.catch(()=>{});
  workingReady=true;workingBase=workingMetadata(value);workingRevision=0;workingGeneration=1;storedGeneration=0;workingError=null;
  round=value.round;incoming=value.incoming;initialCapture=value.initialCapture;comparison=null;
  ({screen,selectedTarget,viewedEdition,actorId}=value.ui);
  newFields={newTitle:value.ui.newTitle,newPerson:value.ui.newPerson,newFormat:value.ui.newFormat,newParticipant:value.ui.newParticipant};
  savedId=value.native.id;savedRevision=value.native.revision;dirty=value.native.dirty;
  formDrafts.clear();formContexts.clear();carryChoices.clear();
  value.forms.forEach(([k,v])=>formDrafts.set(k,v));value.contexts.forEach(([k,v])=>formContexts.set(k,v));value.carryChoices.forEach(([k,v])=>carryChoices.set(k,v));
  $('review-new-participant').value=newFields.newParticipant;
  await refreshView();
  if(initialCapture&&!round)await renderStart();else await render();
  if(persist)await flushWorking();workingStatus();
}
async function openWorking(id){
  const selected=await loadWorkingCopy(id);await flushWorking();
  await installWorking(await forkWorkingCopy(selected.input));
  status('Opened a separate working copy with all original drafts and unfinished text. Its recorded review remains unchanged until you explicitly record an action.');
}
async function separateWorking(){
  // A conflict or unavailable original record never authorizes overwriting it.
  const selected=await forkWorkingCopy(workingSnapshot());
  await installWorking(selected);status('Saved this window as a separate complete working copy; the previous saved copy remains available.');
}
async function renderWorkingCopies(root){
  root.append(node('h3','Complete working copies'),node('p','Each window saves independently. Open a copy to continue its unfinished text in a separate record; the selected original stays available.'));
  const records=await listWorkingCopies();
  if(!records.length)root.append(node('p','No complete working copy has been saved in this browser.'));
  for(const record of records){const card=node('article',undefined,'review-card');card.append(node('h4',record.name),node('p','Working revision '+record.revision+' · '+record.updatedAt,'review-muted'),
    button('Open complete working copy',()=>openWorking(record.id)));root.append(card);}
}
function renderUnfinished(root){
  if(!formDrafts.size)return;
  const box=node('details');box.append(node('summary',formDrafts.size+' retained unfinished form'+(formDrafts.size===1?'':'s')));
  for(const [key,raw]of formDrafts){
    const c=formContexts.get(key),card=node('article',undefined,'review-card');
    card.append(node('h4',c.kind+' · '+personName(c.actorId)),node('p','Original edition '+c.editionId,'review-code'),
      details('Exact unfinished values',node('pre',JSON.stringify(raw,null,2),'review-source')));
    card.append(button('Open this form’s original context',async()=>{
      actorId=c.actorId;viewedEdition=c.editionId;
      screen=['reply','resolve'].includes(c.kind)?'changes':c.kind==='receive'?'compare':['finish','reopen'].includes(c.kind)?'finish':'targets';
      if(['decision','change'].includes(c.kind))selectedTarget=c.extra;
      await refreshView();await render();
    }));
    box.append(card);
  }
  root.append(box);
}
const personName=id=>view?.participants.find(x=>x.id===id)?.label||id;
const isDirty=()=>workingGeneration!==storedGeneration||!!workingError;
const status=message=>{$('review-status').textContent=message;};
function fail(error){$('review-error').textContent=error?.message||String(error);$('review-error').hidden=false;}
function clearError(){$('review-error').hidden=true;$('review-error').textContent='';}
async function work(operation){
  if(busy)return;busy=true;clearError();$('review-workspace').inert=true;
  try{return await operation();}catch(error){fail(error);}
  finally{$('review-workspace').inert=false;busy=false;metadata();scheduleWorking();}
}
function button(label, action, cls=''){
  const item=node('button',label,cls);item.type='button';item.addEventListener('click',()=>work(action));return item;
}
function link(label,url){
  const item=node('a',label);item.href=url;item.target='_blank';item.rel='noopener noreferrer';return item;
}
function safeName(value,fallback='scf-review'){
  return String(value).normalize('NFKD').replace(/[^a-zA-Z0-9_.-]+/g,'-').replace(/^[.-]+|[.-]+$/g,'').slice(0,100)||fallback;
}
function download(body,name,type='application/json'){
  const url=URL.createObjectURL(new Blob([body],{type})),item=node('a');
  item.href=url;item.download=name;document.body.append(item);item.click();item.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
function metadata(){
  const workspace=$('review-workspace');workspace.dataset.reviewId=round?.id||'';workspace.dataset.reviewRecordId=savedId||'';workspace.dataset.reviewRevision=String(view?.revision??0);workspace.dataset.reviewSaveRevision=String(savedRevision);
  $('review-save-state').textContent=round?(savedId?'Browser revision '+savedRevision:'Unsaved browser copy')+(dirty?' · complete review not yet saved':'')+(formDrafts.size?' · unrecorded form text':''):'Open a prepared submission to begin.';
  $('review-export').disabled=!round;$('review-report').disabled=!round;$('review-draft-export').disabled=!round;$('review-save-copy').disabled=!round;
  $('review-add-person').disabled=!round||view?.status==='COMPLETE';$('review-finish').disabled=!round;
}
function textInput(label,value,{area=false,type='text',placeholder='',readonly=false,id=null}={}){
  const wrap=node('label',undefined,'review-field'),field=node(area?'textarea':'input');
  if(!area)field.type=type;field.value=value??'';field.placeholder=placeholder;field.readOnly=readonly;field.autocomplete='off';if(id)field.id=id;
  wrap.append(node('span',label),field);return {wrap,field};
}
function choice(label,value,options,id=null){
  const wrap=node('label',undefined,'review-field'),field=node('select');
  for(const [key,labelText]of options){const item=node('option',labelText);item.value=key;field.append(item);}
  if(!options.some(([key])=>key===value)){const item=node('option','Unrecorded value: '+String(value));item.value=value;field.append(item);}field.value=value;if(id)field.id=id;wrap.append(node('span',label),field);return {wrap,field};
}
function details(label,...children){const item=node('details');item.append(node('summary',label),...children);return item;}
function sourceText(label,text){const box=textInput(label,text,{area:true,readonly:true});box.field.className='review-original-text';return box.wrap;}
function formKey(kind,extra=''){
  const c={roundId:round?.id,editionId:view?.selectedEdition,actorId,kind,extra},key=[c.roundId,c.editionId,c.actorId,kind,extra].join('|');
  formContexts.set(key,c);return key;
}
function draftForm(key,form,read){
  form.addEventListener('input',()=>{formDrafts.set(key,read());metadata();});
  form.addEventListener('change',()=>{formDrafts.set(key,read());metadata();});
}
function referencesEditor(parent,initial=[]){
  const box=node('section',undefined,'review-references');box.append(node('h4','Supporting references'));
  const rows=node('div');box.append(rows);const entries=[];
  function add(value={label:'',url:'',note:''}){
    const row=node('div',undefined,'review-reference');
    const label=textInput('Reference label',value.label),url=textInput('HTTPS source URL',value.url,{placeholder:'Optional when the observation is retained'}),note=textInput('What this source shows',value.note,{area:true});
    const entry={row,label:label.field,url:url.field,note:note.field};entries.push(entry);
    const remove=node('button','Remove reference','review-quiet');remove.type='button';remove.addEventListener('click',()=>{entries.splice(entries.indexOf(entry),1);row.remove();parent.dispatchEvent(new Event('input',{bubbles:true}));});
    row.append(label.wrap,url.wrap,note.wrap,remove);rows.append(row);
  }
  initial.forEach(add);
  const addButton=node('button','Add supporting reference','review-quiet');addButton.type='button';addButton.addEventListener('click',()=>{add();parent.dispatchEvent(new Event('input',{bubbles:true}));});box.append(addButton);
  parent.append(box);
  return ()=>entries.map(x=>({label:x.label.value,url:x.url.value,note:x.note.value})).filter(x=>x.label||x.url||x.note);
}
function clearForm(key){formDrafts.delete(key);formContexts.delete(key);metadata();}
function guardUnrecorded(){
  if(formDrafts.size||carryChoices.size)throw new Error('Record the pending decision or response, or use Discard unrecorded forms before opening another review. Download the complete working package to preserve unfinished text, or finish/discard these forms before a recorded-review handover.');
}
async function preserveWorking(){
  await flushWorking();if(!round||!dirty)return;
  try{const saved=await saveDraft({id:savedId,revision:savedRevision,input:round});savedId=saved.id;savedRevision=saved.revision;dirty=false;}
  catch(error){if(error.name!=='DraftConflictError')throw error;const saved=await saveDraft({revision:0,input:round});savedId=saved.id;savedRevision=saved.revision;dirty=false;}
}
async function refreshView(){if(round)view=await reviewRoundView(round,{editionId:viewedEdition});else view=null;}
async function commit(next,message){
  round=next;dirty=true;viewedEdition=null;
  let saveError=null;
  try{const saved=await saveDraft({id:savedId,revision:savedRevision,input:round});savedId=saved.id;savedRevision=saved.revision;dirty=false;}
  catch(error){saveError=error;}
  await refreshView();await render();status(message+(saveError?' The complete review remains open; download it or save a separate browser copy.':' Saved as browser revision '+savedRevision+'.'));
  if(saveError)throw saveError;
}
async function act(kind,input,{capture=null,key=null,after=null}={}){
  if(!round||!view)throw new Error('Open a complete review round first.');
  if(!actorId)throw new Error('Select the named person recording this action.');
  const next=await applyReviewAction(round,{requestId:uid(),expectedRevision:view.revision,actorId,kind,input},capture);
  if(key)clearForm(key);if(after)after();
  await commit(next,'Recorded '+kind.replaceAll('-',' ')+' with its original draft and participant.');
}
function pickFile(purpose){filePurpose=purpose;$('review-file').value='';$('review-file').click();}
async function readFile(file){
  if(!file)throw new Error('Choose a complete exported JSON file.');
  if(file.size>(filePurpose==='working'?WORKING_MAX_BYTES:REVIEW_MAX_BYTES)+65536)throw new Error('This file exceeds the complete receiving allowance.');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());
}
async function openFile(file){
  const purpose=filePurpose,text=await readFile(file);
  if(purpose==='working'){
    const selected=await importWorkingCopy(text);await flushWorking();
    await installWorking(await forkWorkingCopy(selected));
    status('Received the complete working package into a separate copy. Original recorded actions and unfinished form text retain their distinct meanings.');return;
  }
  if(purpose==='round'){
    const selected=await importReviewRound(text);await preserveWorking();beginSelection();round=selected;viewedEdition=null;savedId=null;savedRevision=0;dirty=true;incoming=comparison=null;carryChoices.clear();screen='targets';
    await refreshView();actorId=view.participants[0].id;await render();status('Received the complete review history and every original draft. Save this browser copy to continue.');return;
  }
  const capture=await readSubmissionExport(text,{fileName:file.name});
  if(purpose==='revision'){
    if(!round)throw new Error('Open the original review round first.');
    const nextComparison=await compareReviewDraft(round,capture);
    await flushWorking();
    workingBase=newWorkingCopy();workingRevision=0;workingGeneration=0;storedGeneration=0;workingError=null;
    for(const [key,c]of formContexts)if(c.kind==='receive'){formDrafts.delete(key);formContexts.delete(key);}
    comparison=nextComparison;incoming=capture;carryChoices.clear();screen='compare';viewedEdition=null;await refreshView();await render();status('Read the complete revised draft. Compare its exact content and choose how to handle each current review decision.');return;
  }
  await preserveWorking();beginSelection();round=view=null;savedId=null;savedRevision=0;dirty=false;initialCapture=capture;newFields.newTitle=JSON.parse(capture.exportText).draft.title+' — review';await renderStart();status('Read the complete prepared submission. Name the review and its first participant.');
}
async function createFromCapture(){
  if(!initialCapture)throw new Error('Open an original prepared submission first.');
  readStartFields();await preserveWorking();
  const reviewer={id:uid(),label:$('review-new-person').value.trim()},title=$('review-new-title').value.trim(),format=$('review-new-format').value;
  const next=await createReviewRound(initialCapture,{id:uid(),title,reviewer,format});beginSelection();
  savedId=null;savedRevision=0;actorId=reviewer.id;screen='targets';selectedTarget='application:application';incoming=comparison=null;initialCapture=null;carryChoices.clear();
  await commit(next,'Started a complete review of the selected original submission.');
}
async function openSavedSubmission(record){
  const current=await loadDraft(record.id);if(!current||current.input?.schema!==DRAFT_SCHEMA)throw new Error('This original submission draft is no longer available. Open its complete exported file.');
  const capture=await captureSubmissionDraft(current.input,{fileName:safeName(current.input.title)+'-browser-r'+current.revision+'.json'});
  await preserveWorking();beginSelection();round=view=null;savedId=null;savedRevision=0;dirty=false;initialCapture=capture;newFields.newTitle=current.input.title+' — review';await renderStart();status('Selected the actual saved submission revision '+current.revision+'. Its original logical draft identity is retained.');
}
async function openSavedRound(record){
  await preserveWorking();const current=await loadDraft(record.id);if(!current||current.input?.schema!==REVIEW_SCHEMA)throw new Error('This review is no longer available in the original browser store.');
  const verified=await reviewRoundView(current.input);beginSelection();round=current.input;view=verified;savedId=current.id;savedRevision=current.revision;dirty=false;actorId=view.participants[0].id;
  viewedEdition=null;screen='targets';incoming=comparison=null;carryChoices.clear();await render();status('Opened the original review at browser revision '+savedRevision+'.');
}
async function renderStart(){
  const root=$('review-editor');root.replaceChildren(node('h2','Open the prepared submission'));
  if(initialCapture){
    const packet=JSON.parse(initialCapture.exportText),draft=packet.draft;
    const card=node('section',undefined,'review-card');card.append(node('h3',draft.title),node('p',draft.answers.length+' complete answers · '+draft.fields.length+' issuer fields · '+draft.sources.length+' original source editions'),
      node('p',initialCapture.fileName+' · '+initialCapture.bytes.toLocaleString()+' bytes','review-muted'));
    const title=textInput('Review round name',newFields.newTitle,{id:'review-new-title'}),person=textInput('First reviewer’s name',newFields.newPerson,{id:'review-new-person',placeholder:'Name the person or automation recording the review'});
    const format=choice('Review the text as copied',newFields.newFormat,[['plain','Plain text'],['markdown','Markdown']],'review-new-format');
    card.append(title.wrap,person.wrap,format.wrap,button('Start this review',createFromCapture,'review-primary'));root.append(card);
  }
  const row=node('div',undefined,'review-row');row.append(button('Open full submission draft',()=>pickFile('start')),button('Open complete review JSON',()=>pickFile('round')),
    link('Prepare the submission','./grant-submission.html'));root.append(row,node('p','Use Download full draft in the existing submission editor, or select its saved browser record below. The review retains the whole original export.','review-muted'));
  const records=await listDrafts().catch(error=>{root.append(node('p',error.message,'review-error'));return[];});
  const submissions=records.filter(x=>x.name?.startsWith('SCF submission — '));
  if(submissions.length)root.append(node('h3','Original saved submissions'));
  for(const record of submissions){const card=node('article',undefined,'review-card');card.append(node('h4',record.name),node('p','Browser revision '+record.revision+' · '+record.updatedAt,'review-muted'),button('Review this saved submission',()=>openSavedSubmission(record)));root.append(card);}
  if(round)root.append(button('Return to the current review',async()=>{initialCapture=null;await render();}));
  metadata();
}
async function renderSaved(root){
  await renderWorkingCopies(root);
  root.append(node('h2','Saved review rounds'),node('p','These records use the same revision-checked Stellar Forge draft store. Opening one preserves any complete unsaved review.'));
  const records=(await listDrafts()).filter(x=>x.name?.startsWith('SCF review — '));
  if(!records.length)root.append(node('p','No review rounds are saved in this browser. Open a complete review JSON or prepare a new round.','review-empty'));
  for(const record of records){const card=node('article',undefined,'review-card');card.append(node('h3',record.name),node('p','Browser revision '+record.revision+' · '+record.updatedAt,'review-muted'),button('Open this review',()=>openSavedRound(record)));root.append(card);}
}
function renderNavigation(){
  const actor=$('review-person');actor.replaceChildren();
  for(const p of view?.participants||[]){const item=node('option',p.label);item.value=p.id;actor.append(item);}
  if(view&&!view.participants.some(x=>x.id===actorId))actorId=view.participants[0].id;actor.value=actorId||'';actor.disabled=!view;
  const targetNav=$('review-targets');targetNav.replaceChildren();
  for(const row of view?.targets||[]){
    const count=(view.isCurrent?view.decisions:view.decisionsHistory.filter(x=>x.editionId===view.viewedEdition)).filter(x=>keyOf(x.target)===row.key).length;
    const item=button(row.title,async()=>{selectedTarget=row.key;screen='targets';await render();},'review-target');
    item.dataset.target=row.key;item.setAttribute('aria-current',String(screen==='targets'&&selectedTarget===row.key));
    item.append(node('span',row.target.kind+(count?' · '+count+' decision'+(count===1?'':'s'):' · to review')));targetNav.append(item);
  }
  for(const tab of document.querySelectorAll('[data-review-view]'))tab.setAttribute('aria-current',String(tab.dataset.reviewView===screen));
}
function referenceList(refs){
  const box=node('div',undefined,'review-reference-list');
  for(const ref of refs){const item=node('p');if(ref.url)item.append(link(ref.label,ref.url));else item.append(node('strong',ref.label));if(ref.note)item.append(node('span',' — '+ref.note));box.append(item);}
  return box;
}
function decisionsFor(selected){
  const rows=view.isCurrent?view.decisions:view.decisionsHistory.filter(x=>x.editionId===view.viewedEdition);
  return rows.filter(x=>keyOf(x.target)===selected.key);
}
function renderTarget(root){
  const selected=view.targets.find(x=>x.key===selectedTarget)||view.targets[0];selectedTarget=selected.key;
  root.append(node('h2',selected.title),node('p',selected.context,'review-muted'));
  if(!view.isCurrent)root.append(node('p','Earlier received draft. Its original content and recorded decisions remain available here. Return to the current draft to record another action.','review-notice'),
    button('Return to current draft',async()=>{viewedEdition=null;await refreshView();await render();}));
  root.append(node('p',selected.counts.words.toLocaleString()+' whitespace-counted words · '+selected.counts.characters.toLocaleString()+' Unicode characters · '+round.format+' output','review-counts'),
    sourceText('Exact selected text',selected.text));
  if(selected.target.kind==='field'){
    const field=view.draft.fields.find(x=>x.id===selected.target.id);
    root.append(details('Original issuer field and instructions',node('pre',JSON.stringify({form:view.draft.form,field},null,2),'review-source')));
  }
  root.append(details('Original content identity',node('p','Review content SHA-256: '+selected.bindingSha256,'review-code'),
    node('p','Draft SHA-256: '+view.capture.draftSha256,'review-code'),node('p','Original export: '+view.capture.id,'review-code')));
  const decisions=decisionsFor(selected);
  if(decisions.length)root.append(node('h3',view.isCurrent?'Current reviewer decisions':'Retained decisions for this edition'));
  for(const row of decisions){
    const card=node('article',undefined,'review-card');
    card.append(node('h4',personName(row.actorId)+' · '+row.decision.replaceAll('-',' ')),node('p',row.note||'No additional note.'),
      node('p',row.carriedBy?'Original review carried forward for unchanged content by '+personName(row.carriedBy)+'.':'Recorded '+row.at,'review-muted'),referenceList(row.references));root.append(card);
  }
  if(!view.isCurrent||view.status!=='OPEN')return;
  const key=formKey('decision',selected.key),prior=formDrafts.get(key)||{decision:'accepted',note:'',references:[]};
  const form=node('form',undefined,'review-card');form.id='review-decision-form';form.append(node('h3','Record a reviewer decision'));
  const decision=choice('Your decision',prior.decision,[['accepted','Accepted for this review'],['changes-requested','Changes requested'],['not-applicable','Not applicable — explain why']],'review-decision');
  const note=textInput('Reviewer note',prior.note,{area:true,id:'review-decision-note'});
  form.append(decision.wrap,note.wrap);const refs=referencesEditor(form,prior.references);
  const read=()=>({decision:decision.field.value,note:note.field.value,references:refs()});draftForm(key,form,read);
  const submit=node('button','Record decision','review-primary');submit.type='submit';form.append(node('p','This records the selected participant’s editorial judgment for the exact text above.','review-muted'),submit);
  form.addEventListener('submit',event=>{event.preventDefault();work(()=>act('review',{editionId:view.selectedEdition,target:selected.target,bindingSha256:selected.bindingSha256,...read()},{key}));});
  root.append(form);
  renderChangeForm(root,selected);
}

function renderChangeForm(root,selected){
  const key=formKey('change',selected.key),prior=formDrafts.get(key)||{title:'',priority:'major',quote:'',note:'',references:[]};
  const form=node('form',undefined,'review-card');form.id='review-change-form';form.append(node('h3','Request a specific change'));
  const title=textInput('Requested change',prior.title,{id:'review-change-title'}),priority=choice('Priority',prior.priority,[['blocking','Blocking final author check'],['major','Substantive change'],['minor','Editorial change']],'review-change-priority'),
    quote=textInput('Exact selected quote, if useful',prior.quote,{area:true,id:'review-change-quote'}),note=textInput('What should change and why',prior.note,{area:true,id:'review-change-note'});
  form.append(title.wrap,priority.wrap,quote.wrap,note.wrap);const refs=referencesEditor(form,prior.references);
  const read=()=>({title:title.field.value,priority:priority.field.value,quote:quote.field.value,note:note.field.value,references:refs()});draftForm(key,form,read);
  const submit=node('button','Record requested change');submit.type='submit';form.append(submit);
  form.addEventListener('submit',event=>{event.preventDefault();work(()=>act('change',{editionId:view.selectedEdition,target:selected.target,bindingSha256:selected.bindingSha256,...read()},{key,after:()=>{screen='changes';}}));});root.append(form);
}
function renderChanges(root){
  root.append(node('h2','Requested changes and author replies'),node('p','Each request retains its original target and quote. An author’s response is recorded separately from a reviewer’s resolution.'));
  if(!view.changes.length)root.append(node('p','No specific changes have been recorded. Open an answer or issuer field to add a request.','review-empty'));
  for(const row of view.changes){
    const card=node('article',undefined,'review-card');card.dataset.changeId=row.id;
    const targetRow=view.targets.find(x=>x.key===keyOf(row.target));
    card.append(node('h3',row.title),node('p',row.priority+' · '+row.status+' · '+personName(row.actorId),'review-counts'),node('p',row.note),
      node('p','Original target: '+(targetRow?.title||row.target.kind+' '+row.target.id),'review-muted'));
    if(row.quote)card.append(details('Exact original quote',sourceText('Retained quoted text',row.quote)));
    card.append(referenceList(row.references),button('Open the original reviewed content',async()=>{viewedEdition=row.editionId;selectedTarget=keyOf(row.target);screen='targets';await refreshView();await render();}));
    for(const reply of row.responses)card.append(details('Author reply · '+personName(reply.actorId)+' · '+reply.response,
      node('p',reply.note),node('p',reply.at,'review-muted'),referenceList(reply.references)));
    for(const decision of row.resolutions)card.append(details('Reviewer resolution · '+personName(decision.actorId)+' · '+decision.status,node('p',decision.note),node('p',decision.at,'review-muted')));
    if(view.status==='OPEN'){
      const replyKey=formKey('reply',row.id),replyDraft=formDrafts.get(replyKey)||{response:'addressed',note:'',references:[]};
      const form=node('form');form.dataset.replyFor=row.id;
      const response=choice('Author response',replyDraft.response,[['addressed','Addressed in the selected draft'],['declined','Change declined — explain why'],['question','Clarification requested']]),
        note=textInput('Author explanation',replyDraft.note,{area:true});
      form.append(response.wrap,note.wrap);const refs=referencesEditor(form,replyDraft.references);
      const read=()=>({response:response.field.value,note:note.field.value,references:refs()});draftForm(replyKey,form,read);
      const submit=node('button','Record author reply');submit.type='submit';form.append(submit);form.addEventListener('submit',event=>{event.preventDefault();work(()=>act('respond',{changeId:row.id,editionId:view.selectedEdition,...read()},{key:replyKey}));});
      card.append(details('Record an author reply',form));
      const resolveKey=formKey('resolve',row.id),resolveDraft=formDrafts.get(resolveKey)||{status:'resolved',note:''};
      const resolutionForm=node('form');resolutionForm.dataset.resolveFor=row.id;
      const statusField=choice('Reviewer resolution',resolveDraft.status,[['resolved','Resolved in the selected draft'],['deferred','Deferred — still outstanding'],['open','Reopen the request']]),
        resolutionNote=textInput('Reviewer’s reason',resolveDraft.note,{area:true});
      const readResolution=()=>({status:statusField.field.value,note:resolutionNote.field.value});
      resolutionForm.append(statusField.wrap,resolutionNote.wrap);draftForm(resolveKey,resolutionForm,readResolution);
      const resolve=node('button','Record review resolution');resolve.type='submit';resolutionForm.append(resolve);
      resolutionForm.addEventListener('submit',event=>{event.preventDefault();work(()=>act('resolve',{changeId:row.id,editionId:view.selectedEdition,...readResolution()},{key:resolveKey}));});
      card.append(details('Resolve or reopen the request',resolutionForm));
    }
    root.append(card);
  }
}
async function renderCompare(root){
  root.append(node('h2','Compare a revised submission'),node('p','Open a later complete export of this same submission draft. The original files and every prior reviewer decision remain in the round.'));
  root.append(button('Open revised full draft',()=>pickFile('revision')));
  if(!incoming){root.append(node('p','The current draft remains selected until you review and receive a revision.','review-empty'));return;}
  comparison=await compareReviewDraft(round,incoming);
  root.append(node('h3',incoming.fileName),node('p',incoming.bytes.toLocaleString()+' complete original bytes · '+comparison.rows.filter(x=>x.change!=='unchanged').length+' changed, added or removed review targets','review-counts'));
  const changes=node('div',undefined,'review-comparison-list');
  for(const row of comparison.rows){
    const item=node('details');item.dataset.comparisonTarget=keyOf(row.target);
    item.append(node('summary',(row.after?.title||row.before?.title||row.target.id)+' · '+row.change));
    const pair=node('div',undefined,'review-pair');
    pair.append(sourceText('Current reviewed text',row.before?.text??'(Target absent)'),sourceText('Received draft text',row.after?.text??'(Target absent)'));item.append(pair);
    if(row.before&&row.after&&row.before.text===row.after.text&&row.change==='changed')item.append(node('p','The copy text is identical, but its source context, issuer instructions, limits or complete draft metadata changed. A new review is required.','review-notice'));
    changes.append(item);
  }
  root.append(changes);
  if(view.status!=='OPEN'){root.append(node('p','Reopen this completed review before selecting the revised draft.','review-notice'));return;}
  const form=node('form',undefined,'review-card');form.id='review-receive-form';form.append(node('h3','Choose how to handle every current decision'));
  const all=node('button','Carry all unchanged decisions forward','review-quiet');all.type='button';
  all.addEventListener('click',()=>work(async()=>{for(const item of comparison.decisions)if(item.canCarry)carryChoices.set(item.decision.id,{choice:'carry',note:'Original decision explicitly retained for identical content and source context.'});await render();}));form.append(all);
  const controls=[];
  for(const item of comparison.decisions){
    const selected=carryChoices.get(item.decision.id)||{choice:'reopen',note:'Review this target again after receiving the revised draft.'};
    const group=node('div',undefined,'review-carry');group.append(node('h4',item.title),node('p',personName(item.decision.actorId)+' · '+item.decision.decision+' · '+item.change,'review-muted'));
    const decision=choice('Decision for this revised draft',selected.choice,item.canCarry?[['reopen','Reopen for a fresh review'],['carry','Carry the original decision forward']]:[['reopen','Reopen — content or context changed']]),
      note=textInput('Selection note',selected.note,{area:true});
    const keep=()=>{carryChoices.set(item.decision.id,{choice:decision.field.value,note:note.field.value});};decision.field.addEventListener('change',keep);note.field.addEventListener('input',keep);
    group.append(decision.wrap,note.wrap);form.append(group);controls.push({id:item.decision.id,decision:decision.field,note:note.field});
  }
  if(!comparison.decisions.length)form.append(node('p','No current reviewer decisions need a carry-forward choice.','review-muted'));
  const receiveKey=formKey('receive',incoming.id),prior=formDrafts.get(receiveKey)||{note:''},note=textInput('Why receive this draft edition?',prior.note,{area:true,id:'review-receive-note'});form.append(note.wrap);
  note.field.addEventListener('input',()=>{formDrafts.set(receiveKey,{note:note.field.value});metadata();});
  const submit=node('button','Receive this revised draft','review-primary');submit.type='submit';form.append(submit);
  form.addEventListener('submit',event=>{event.preventDefault();work(async()=>{
    const input={editionId:incoming.id,fromEdition:comparison.fromEdition,note:note.field.value,decisions:controls.map(x=>({decisionId:x.id,choice:x.decision.value,note:x.note.value}))};
    const capture=incoming;await act('receive',input,{capture,key:receiveKey,after:()=>{incoming=comparison=null;carryChoices.clear();screen='targets';}});
  });});root.append(form);
}
function renderSources(root){
  root.append(node('h2','Complete received drafts'),node('p','Each file is the exact full export received from the submission workspace. Open an earlier draft to inspect its retained original answer and field identities.'));
  for(const edition of view.editions){
    const card=node('article',undefined,'review-card'),capture=round.editions.find(x=>x.id===edition.id);
    card.append(node('h3',edition.fileName),node('p',(edition.id===view.selectedEdition?'Current selected draft · ':'')+edition.bytes.toLocaleString()+' bytes · '+edition.sourceCount+' source editions · '+edition.versionCount+' saved author versions','review-counts'),
      node('p','Received '+edition.receivedAt,'review-muted'),details('Full original identities',node('p','Draft SHA-256: '+edition.draftSha256,'review-code'),node('p','Export SHA-256: '+edition.id,'review-code'),node('p','Selected source SHA-256: '+edition.sourceSha256,'review-code')),
      button('Read this retained draft',async()=>{viewedEdition=edition.id;screen='targets';selectedTarget='application:application';await refreshView();await render();}),
      button('Download this original draft',()=>download(capture.exportText,safeName(capture.fileName,'complete-submission-draft.json'))));root.append(card);
  }
}
function renderHistory(root){
  root.append(node('h2','Complete review history'),node('p','Every action retains its original participant, selected draft, exact input and preceding review revision.'));
  if(!round.events.length)root.append(node('p','The original draft is retained. Record a decision or requested change to begin its review history.','review-empty'));
  for(const event of [...round.events].reverse()){
    const label={review:'Reviewer decision',change:'Requested change',respond:'Author response',resolve:'Reviewer resolution',receive:'Revised draft received',participant:'Named participant added',finish:'Review completed',reopen:'Review reopened'}[event.kind]||event.kind;
    const card=node('article',undefined,'review-card');card.append(node('h3',label+' · '+personName(event.actorId)),node('p','Review revision '+event.sequence+' · '+event.at,'review-muted'));
    if(event.input.note)card.append(node('p',event.input.note));
    if(event.kind==='receive'){
      const kept=event.input.decisions.filter(x=>x.choice==='carry').length;card.append(node('p',kept+' original decisions carried forward; '+(event.input.decisions.length-kept)+' reopened.'));
    }
    card.append(details('Complete recorded action',node('pre',JSON.stringify(event,null,2),'review-source')));root.append(card);
  }
}
function renderReadiness(root){
  root.append(node('h2','Return the review to the author'),node('p','The handover distinguishes an editorial review from the issuer’s decision. The complete review export is available while work is open or finished.'));
  const current=view.completion;
  if(current){
    const card=node('article',undefined,'review-card');card.append(node('h3',current.outcome.replaceAll('-',' ')),node('p',personName(current.actorId)+' · '+current.at),node('p',current.note));root.append(card);
    const form=node('form',undefined,'review-card');form.id='review-reopen-form';
    const key=formKey('reopen'),prior=formDrafts.get(key)||{note:''},note=textInput('Reason to reopen this review',prior.note,{area:true,id:'review-reopen-note'});
    form.append(note.wrap);draftForm(key,form,()=>({note:note.field.value}));const submit=node('button','Reopen this review');submit.type='submit';form.append(submit);
    form.addEventListener('submit',event=>{event.preventDefault();work(()=>act('reopen',{note:note.field.value},{key}));});root.append(form);
  }else{
    const form=node('form',undefined,'review-card');form.id='review-finish-form';
    const key=formKey('finish'),prior=formDrafts.get(key)||{outcome:'return-changes',note:''};
    const outcome=choice('Editorial handover',prior.outcome,[['return-changes','Return requested changes to the author'],['ready-for-author-check','Ready for the final author check']],'review-outcome'),
      note=textInput('Reviewer’s handover note',prior.note,{area:true,id:'review-finish-note'});
    form.append(outcome.wrap,note.wrap);draftForm(key,form,()=>({outcome:outcome.field.value,note:note.field.value}));
    const submit=node('button','Finish this review','review-primary');submit.type='submit';form.append(submit);
    form.addEventListener('submit',event=>{event.preventDefault();work(()=>act('finish',{editionId:view.selectedEdition,outcome:outcome.field.value,note:note.field.value},{key}));});root.append(form);
  }
  root.append(node('h3','Outstanding review work'));
  const counts=node('div',undefined,'review-metrics');
  for(const [label,value]of [['Current decisions',view.decisions.length],['Open or deferred requests',view.changes.filter(x=>x.status!=='resolved').length],['Review or field checks',view.readiness.length],['Complete received drafts',round.editions.length]]){
    const card=node('div');card.append(node('strong',value),node('span',label));counts.append(card);
  }
  root.append(counts);
  if(!view.readiness.length)root.append(node('p','Every current target has a recorded acceptable review decision, the recorded field checks are complete, and all requested changes are resolved.','review-notice'));
  else for(const issue of view.readiness){
    const line=node('div',undefined,'review-issue');line.append(node('p',issue.message));
    if(issue.target)line.append(button('Open target',async()=>{viewedEdition=null;selectedTarget=keyOf(issue.target);screen='targets';await refreshView();await render();}));
    if(issue.changeId)line.append(button('Open requested changes',async()=>{screen='changes';await render();}));root.append(line);
  }
  root.append(node('p','Ready for the final author check requires a current decision for each answer, issuer field, original requirement and the complete application. Receiving another draft reopens the affected decisions.','review-muted'));
}
async function render(){
  if(!round){$('review-current').hidden=true;$('review-start').hidden=false;$('review-start').textContent='Choose a complete submission draft or an existing review.';return renderStart();}
  $('review-current').hidden=false;$('review-start').hidden=true;renderNavigation();metadata();
  $('review-heading').textContent=round.title;
  $('review-context').textContent=view.draft.title+' · '+view.status.toLowerCase()+' · '+round.format+' copy format · review revision '+view.revision+(view.isCurrent?'':' · earlier draft');
  const root=$('review-editor');root.replaceChildren();renderUnfinished(root);
  if(screen==='saved')await renderSaved(root);
  else if(screen==='compare')await renderCompare(root);
  else if(screen==='changes')renderChanges(root);
  else if(screen==='sources')renderSources(root);
  else if(screen==='history')renderHistory(root);
  else if(screen==='finish')renderReadiness(root);
  else renderTarget(root);
}
async function addPerson(){
  if(!round)throw new Error('Open a review round first.');
  const label=$('review-new-participant').value.trim();if(!label)throw new Error('Enter the participant’s name.');
  await act('participant',{person:{id:uid(),label}});$('review-new-participant').value='';
}
$('review-person').addEventListener('change',()=>work(async()=>{actorId=$('review-person').value;await render();}));
for(const tab of document.querySelectorAll('[data-review-view]'))tab.addEventListener('click',()=>work(async()=>{
  screen=tab.dataset.reviewView;viewedEdition=null;if(round)await refreshView();
  if(!round&&screen==='saved'){$('review-editor').replaceChildren();await renderSaved($('review-editor'));return;}await render();
}));
$('review-open-draft').addEventListener('click',()=>pickFile('start'));
$('review-open-round').addEventListener('click',()=>pickFile('round'));
$('review-file').addEventListener('change',()=>work(()=>openFile($('review-file').files[0])));
$('review-add-person').addEventListener('click',()=>work(addPerson));
$('review-export').addEventListener('click',()=>work(async()=>{
  if(!round)throw new Error('Open a review first.');guardUnrecorded();
  download(await exportReviewRound(round),safeName(round.title)+'-complete-review.json');status('Downloaded every received original draft, participant, decision, author reply and review action.');
}));
$('review-report').addEventListener('click',()=>work(async()=>{
  if(!round)throw new Error('Open a review first.');guardUnrecorded();
  const report=await reviewReport(round);download(report,safeName(round.title)+'-review-report.md','text/markdown;charset=utf-8');status('Downloaded the complete selected application text and current review report. The full review JSON retains its whole history.');
}));
$('review-draft-export').addEventListener('click',()=>work(async()=>{
  if(!view)throw new Error('Open a review first.');download(view.capture.exportText,safeName(view.capture.fileName,'complete-submission-draft.json'));status('Downloaded the exact original prepared draft for reopening in Prepare submission.');
}));
$('review-save-copy').addEventListener('click',()=>work(async()=>{
  if(!round)throw new Error('Open a review first.');
  const saved=await saveDraft({revision:0,input:round});savedId=saved.id;savedRevision=saved.revision;dirty=false;metadata();
  status('Saved a separate browser record with the same original review, participant and draft identities.');
}));
$('review-discard-forms').addEventListener('click',()=>work(async()=>{formDrafts.clear();formContexts.clear();carryChoices.clear();await render();status('Discarded only the unrecorded form text. All recorded review actions remain.');}));
$('review-finish').addEventListener('click',()=>work(async()=>{screen='finish';viewedEdition=null;await refreshView();await render();}));
window.addEventListener('beforeunload',event=>{if(isDirty()){event.preventDefault();event.returnValue='';}});
$('review-working-download').addEventListener('click',()=>work(async()=>{
  const value=workingSnapshot();download(await exportWorkingCopy(value),safeName(value.label)+'-working-copy.json');
  status('Downloaded the complete working copy, including invalid unfinished text and every selected original draft. No review decision was invented.');
}));
$('review-working-open').addEventListener('click',()=>pickFile('working'));
$('review-working-save').addEventListener('click',()=>work(async()=>{await flushWorking();status('Saved all current working fields and original sources.');}));
$('review-working-fork').addEventListener('click',()=>work(separateWorking));
$('review-working-latest').addEventListener('click',()=>work(async()=>{
  const originalId=workingBase.id,latest=await loadWorkingCopy(originalId);
  // First retain the local values independently; only then show the selected stored version.
  await separateWorking();await installWorking(await forkWorkingCopy(latest.input));status('Opened the stored version in a separate copy. Your preceding local work is also saved separately.');
}));
document.addEventListener('input',event=>{if(event.target.closest('#review-workspace'))scheduleWorking();});
document.addEventListener('change',event=>{if(event.target.closest('#review-workspace')&&event.target.id!=='review-file')scheduleWorking();});
work(async()=>{
  const parameters=new URL(location.href).searchParams,workingId=parameters.get('working');
  if(workingId){
    const record=await loadWorkingCopy(workingId);await installWorking(await forkWorkingCopy(record.input));
    status('Recovered the complete saved work into this window’s independent copy. Unfinished text is still unrecorded.');return;
  }
  const selected=parameters.get('review');
  if(selected){const record=await loadDraft(selected);if(record?.input?.schema===REVIEW_SCHEMA){workingReady=true;await openSavedRound(record);return;}}
  workingReady=true;await renderStart();status('Open a complete prepared submission or continue a saved review. Nothing is submitted to the issuer from this workspace.');
});
