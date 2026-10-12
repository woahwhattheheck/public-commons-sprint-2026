// MIT. Complete source-bound study extraction in the original Research operator.
import {openStudyExtractionDrafts} from './study-extraction-drafts.js';
const SECTIONS=['overview','forms','resultSets','extract','review','tables','sources','history'];
const LABELS={overview:'Overview',forms:'Forms',resultSets:'Result sets',extract:'Extraction',review:'Resolve results',
  tables:'Evidence tables',sources:'Source values',history:'History & recovery'};
const STATUSES=['reported','derived','not-estimable','not-reported','not-applicable','uncertain'];
const TYPES=['text','decimal','integer','boolean','choice','multi-choice','json'];
const A=value=>Array.isArray(value)?value:[];
const clone=value=>structuredClone(value);
const json=value=>JSON.stringify(value,null,2);
const show=value=>value===null||value===undefined?'—':typeof value==='string'?value:json(value);
const E=(tag,text,className)=>{
  const n=document.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(className)n.className=className;return n;
};
const option=(value,label)=>{const n=E('option',label);n.value=value;return n;};
const field=(label,control)=>{const n=E('label',null,'se-field');n.append(E('span',label),control);return n;};
const input=(value='',type='text',name)=>{
  const n=E('input');n.type=type;n.value=value??'';if(name)n.dataset.se=name;return n;
};
const area=(value='',name,rows=3)=>{const n=E('textarea');n.rows=rows;n.value=value??'';if(name)n.dataset.se=name;return n;};
const select=(items,value,name)=>{
  const n=E('select');if(name)n.dataset.se=name;
  n.append(...items.map(item=>option(typeof item==='string'?item:item.value,typeof item==='string'?item:item.label)));
  n.value=value??'';return n;
};
const button=(label,action,name)=>{
  const n=E('button',label);n.type='button';if(name)n.dataset.se=name;n.addEventListener('click',action);return n;
};
const details=(title,value)=>{
  const d=E('details'),s=E('summary',title);d.append(s,E('pre',typeof value==='string'?value:json(value)));return d;
};
const table=(headers,rows)=>{
  const outer=E('div',null,'se-table-wrap'),t=E('table'),thead=E('thead'),tr=E('tr');
  headers.forEach(text=>tr.append(E('th',text)));thead.append(tr);t.append(thead);
  const body=E('tbody');for(const row of rows){const tr=E('tr');for(const cell of row){const td=E('td');td.append(cell instanceof Node?cell:E('span',show(cell)));tr.append(td);}body.append(tr);}
  t.append(body);outer.append(t);return outer;
};
const typedText=value=>{
  if(!Array.isArray(value)||value.length!==2)return 'No entry';
  if(value[0]==='NoneType')return 'null';
  if(value[0]==='number'||value[0]==='str')return value[1];
  return json(value[1]);
};
const parsed=(text,label)=>{
  try{return JSON.parse(text);}catch{throw new Error(label+' must be valid JSON.');}
};
const parseTyped=(type,value)=>{
  if(type==='NoneType')return ['NoneType',null];
  if(type==='bool'){if(!['true','false'].includes(value))throw new Error('Choose true or false.');return ['bool',value==='true'];}
  if(type==='array'||type==='object')return [type,parsed(value,'Typed '+type+' value')];
  if(type==='number'&&!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?$/.test(value))
    throw new Error('Enter an exact decimal token, keeping its original precision.');
  return [type,value];
};
function saveFile(name,body,type='application/json'){
  const blob=body instanceof Blob?body:new Blob([typeof body==='string'?body:json(body)+'\n'],{type});
  const url=URL.createObjectURL(blob),link=E('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function createStudyExtractionPanel({root,tab,api,task,notify,getDossier,getWorkspace,isBusy,onReceived}){
  const drafts=openStudyExtractionDrafts();
  const state={scope:null,epoch:0,shown:false,loading:false,autoAttemptKey:null,revision:null,section:'overview',formId:'',formEditionId:'',
    resultSetId:'',rowId:'',tableId:'',publicationId:'',actor:{id:'',name:''},forms:[],formEditions:[],resultSets:[],
    studies:[],occurrences:[],overview:null,loaded:false,editor:null,editorName:null,dirty:false,pending:null,
    saveChain:Promise.resolve(),sourceValues:new Map(),sourceRequests:new Map(),page:0,pageSize:20};
  const header=E('header',null,'se-header'),heading=E('div'),status=E('p',null,'se-status');
  heading.append(E('h2','Study extraction'),E('p','Keep reported values, independent entries and resolved results connected to their original sources.','se-muted'));
  const refresh=button('Refresh current revision',()=>task(()=>loadCurrent()),'refresh');
  header.append(heading,refresh);const toolbar=E('div',null,'se-toolbar'),nav=E('nav',null,'se-nav');
  nav.setAttribute('aria-label','Study extraction views');
  const body=E('div',null,'se-body'),message=E('p',null,'se-message');message.setAttribute('role','status');
  root.classList.add('study-extraction');root.append(header,status,toolbar,nav,message,body);
  for(const name of SECTIONS)nav.append(button(LABELS[name],()=>switchSection(name),'nav-'+name));
  const path=(suffix='',scope=state.scope)=>'/api/dossiers/'+encodeURIComponent(scope.dossierId)+'/extraction'+suffix;
  const context=()=>{
    const workspace=getWorkspace?.(),dossier=getDossier();
    if(!workspace?.workspaceId||!dossier?.id)throw new Error('Open the original Research workspace and dossier first.');
    return {workspaceId:workspace.workspaceId,dossierId:dossier.id};
  };
  const sameContext=(ctx,epoch=state.epoch)=>{
    const now=getWorkspace?.();return epoch===state.epoch&&now?.workspaceId===ctx.workspaceId&&getDossier()?.id===ctx.dossierId;
  };
  const say=value=>{message.textContent=value??'';};
  const call=(suffix,options={},scope=state.scope)=>api(path(suffix,scope),{
    ...options,sourceProjection:'full',workspaceId:scope.workspaceId});
  const params=value=>{
    const p=new URLSearchParams();for(const [key,item]of Object.entries(value))if(item!==undefined&&item!==null&&item!=='')p.set(key,String(item));
    return p.size?'?'+p:'';
  };
  const actorForForm=()=>A(state.formEditions.find(f=>f.id===state.formEditionId)?.definition?.reviewers);
  function bind(control,object,key,convert=value=>value){
    control.dataset.seEdit='true';
    control.addEventListener('input',()=>{
      try{object[key]=convert(control.type==='checkbox'?control.checked:control.value);control.setCustomValidity('');changed();}
      catch(error){control.setCustomValidity(error.message);say(error.message);}
    });return control;
  }
  function changed(){
    state.dirty=true;if(!['prepared','response-unknown'].includes(state.pending?.state))state.pending=null;queueSave();updateStatus();
  }
  function queueSave(){
    if(!state.scope||!state.editorName)return;
    const scope=clone(state.scope),name=state.editorName,value={editor:clone(state.editor),actor:clone(state.actor),dirty:state.dirty,
      revision:state.revision,updatedAt:new Date().toISOString()};
    state.saveChain=state.saveChain.catch(()=>{}).then(()=>drafts.put(scope,'draft/'+name,value));
    state.saveChain.catch(error=>say('Draft storage: '+error.message));return state.saveChain;
  }
  async function useEditor(name,initial,{replace=false}={}){
    const scope=context(),epoch=state.epoch;
    await state.saveChain;
    const saved=replace?null:await drafts.get(scope,'draft/'+name);
    if(!sameContext(scope,epoch))return false;
    state.editorName=name;state.editor=saved?clone(saved.editor):clone(initial);state.dirty=saved?.dirty??false;
    if(!['prepared','response-unknown'].includes(state.pending?.state))state.pending=null;return true;
  }
  function updateStatus(){
    status.textContent=state.scope?'Revision '+(state.revision??'—')+' · '+(state.dirty?'Local draft has changes':'Saved source view'):'Select a dossier';
    root.dataset.dossierId=state.scope?.dossierId??'';root.dataset.revision=String(state.revision??'');
    root.dataset.seBusy=String(state.loading||isBusy());root.dataset.seSection=state.section;
    for(const n of nav.querySelectorAll('button'))n.setAttribute('aria-current',n.dataset.se==='nav-'+state.section?'page':'false');
  }
  function updateBusy(){
    const busy=state.loading||isBusy();
    root.querySelectorAll('button,input,textarea,select').forEach(n=>{
      if(busy){if(n.dataset.seDisabledBefore===undefined)n.dataset.seDisabledBefore=n.dataset.wasDisabled??(n.disabled?'1':'0');n.disabled=true;}
      else if(n.dataset.seDisabledBefore!==undefined){n.disabled=n.dataset.seDisabledBefore==='1';delete n.dataset.seDisabledBefore;}
    });updateStatus();
    if(!busy)ensureLoaded();
  }
  function ensureLoaded(){
    if(!state.shown||!state.scope||state.loaded||state.loading||isBusy())return;
    const key=state.scope.workspaceId+'/'+state.scope.dossierId,epoch=state.epoch;
    if(state.autoAttemptKey===key)return;
    state.autoAttemptKey=key;
    queueMicrotask(()=>{
      if(epoch!==state.epoch||!state.shown||state.loaded||state.loading)return;
      if(isBusy()){state.autoAttemptKey=null;return;}
      void task(()=>loadCurrent());
    });
  }
  async function all(section,{publication=false,revision=state.revision,...selection}={},scope=state.scope){
    const items=[];let offset=0,selected=revision;
    do{
      const result=await call((publication?'/publications':'')+params({section,...selection,revision:selected,offset,limit:100}),{},scope);
      if(result.dossierId!==scope.dossierId||!Number.isSafeInteger(result.revision)||selected!==undefined&&selected!==null&&result.revision!==selected)
        throw new Error('The selected dossier revision changed during paging.');
      selected=result.revision;
      if(!Array.isArray(result.items))throw new Error('The original section response has no complete item page.');
      items.push(...result.items);
      if(result.nextOffset===null)break;
      if(!Number.isSafeInteger(result.nextOffset)||result.nextOffset<=offset)throw new Error('The original section cursor did not advance.');
      offset=result.nextOffset;
    }while(true);
    return items;
  }
  async function page(section,options={}){
    const value=await call((options.publication?'/publications':'')+params({section,revision:state.revision,
      offset:state.page*state.pageSize,limit:state.pageSize,...Object.fromEntries(Object.entries(options).filter(([k])=>k!=='publication'))}));
    if(value.dossierId!==state.scope.dossierId||value.revision!==state.revision)throw new Error('The selected revision changed.');
    return value;
  }
  async function loadCurrent({revision}={}){
    if(!getDossier())return;const scope=context(),epoch=state.epoch;
    state.loading=true;updateBusy();
    try{
      const overview=await call(params({revision}),{},scope);
      const pinned=overview.revision;
      const values=await Promise.all(['forms','formEditions','resultSets','studies','occurrences'].map(section=>all(section,{revision:pinned},scope)));
      if(!sameContext(scope,epoch))return;
      state.scope=scope;state.overview=overview;state.revision=pinned;
      [state.forms,state.formEditions,state.resultSets,state.studies,state.occurrences]=values;
      state.loaded=true;state.sourceValues.clear();state.sourceRequests.clear();
      const requests=await drafts.list(scope,'request/');
      if(!sameContext(scope,epoch))return;
      state.pending=requests.map(r=>r.value).find(r=>['prepared','response-unknown'].includes(r.state))??null;
      const retainedSet=state.resultSets.find(r=>r.id===state.resultSetId);
      const retainedForm=state.formEditions.find(f=>f.id===state.formEditionId);
      if(retainedSet)selectResultSet(retainedSet.id);
      else if(retainedForm){
        selectFormEdition(retainedForm.id);
        selectResultSet(state.resultSets.filter(r=>r.formEditionId===retainedForm.id).at(-1)?.id??'');
      }else if(state.resultSets.length)selectResultSet(state.resultSets.at(-1).id);
      else selectFormEdition(state.formEditions.at(-1)?.id??'');
      await render();
    }finally{if(sameContext(scope,epoch)){state.loading=false;updateBusy();}}
  }
  async function perform(action,data,{publication=false,actor=state.actor,requestRecord}={}){
    const scope=context(),epoch=state.epoch;
    if(!requestRecord&&['prepared','response-unknown'].includes(state.pending?.state))throw new Error('Recover the original request in History & recovery before another write.');
    const editorName=state.editorName,editorSnapshot=JSON.stringify(state.editor);
    const invalid=root.querySelector('input:invalid,textarea:invalid,select:invalid');
    if(!requestRecord&&invalid){invalid.reportValidity();throw new Error(invalid.validationMessage);}
    if(!actor.id.trim()||!actor.name.trim())throw new Error('Choose the responsible reviewer ID and name.');
    await state.saveChain;
    const request=requestRecord?.request??{requestId:crypto.randomUUID(),expectedRevision:state.revision,actor:clone(actor),action,data:clone(data)};
    const record=requestRecord??{schema:'sf88-study-extraction-browser-request/v1',workspaceId:scope.workspaceId,dossierId:scope.dossierId,
      route:publication?'/publications/reviews?projection=metadata':'/reviews?projection=metadata',request,state:'prepared',preparedAt:new Date().toISOString()};
    if(record.workspaceId!==scope.workspaceId||record.dossierId!==scope.dossierId)throw new Error('This request belongs to another original workspace.');
    const retained=await drafts.prepare(scope,record);state.pending=retained;
    let committedRecord=null;
    try{
      const result=await call(retained.route,{method:'POST',body:retained.request},scope);
      if(result.dossier?.id!==scope.dossierId||result.operation?.requestId!==retained.request.requestId)
        throw new Error('The original saved request response has a different identity.');
      const completed={...retained,state:'committed',completedAt:new Date().toISOString(),result};
      committedRecord=completed;
      await drafts.put(scope,'request/'+request.requestId,completed);
      if(!sameContext(scope,epoch))return result;
      state.pending=null;state.dirty=false;
      if(editorName&&state.editorName===editorName&&JSON.stringify(state.editor)===editorSnapshot)
        await drafts.remove(scope,'draft/'+editorName);
      root.dataset.lastRequestId=request.requestId;root.dataset.lastOperation=JSON.stringify(Object.fromEntries(Object.entries(result.operation.result).map(([key,value])=>[key,
        Object.fromEntries(['id','formId','formEditionId','resultSetId','tableId','tableEditionId','version','revision'].filter(k=>value[k]!==undefined).map(k=>[k,value[k]]))])));
      root.dataset.lastCommittedRevision=String(result.dossier.revision);
      say((result.duplicate?'Recovered original operation. ':'Saved. ')+'Revision '+result.dossier.revision+'.');
      const refreshed=await api('/api/dossiers/'+encodeURIComponent(scope.dossierId),{workspaceId:scope.workspaceId});
      if(sameContext(scope,epoch)){await onReceived(refreshed);await loadCurrent();}
      return result;
    }catch(error){
      if(committedRecord){
        await drafts.put(scope,'request/'+request.requestId,committedRecord).catch(()=>{});
        if(sameContext(scope,epoch)){
          state.pending=null;
          say('The original operation was saved at revision '+committedRecord.result.dossier.revision+'. Refresh the view to continue. '+error.message);
        }
        throw error;
      }
      const unknown=!Number.isInteger(error.status)||error.status===408||error.status>=500;
      if(sameContext(scope,epoch))state.pending={...retained,state:unknown?'response-unknown':'rejected'};
      await drafts.put(scope,'request/'+request.requestId,{...retained,state:unknown?'response-unknown':'rejected',
        observedAt:new Date().toISOString(),error:{code:error.code??error.message,status:error.status??null}}).catch(()=>{});
      if(sameContext(scope,epoch))say('The original request is retained in History & recovery. '+error.message);
      throw error;
    }
  }
  function requestButton(label,action,data,{publication=false,after,name}={}){
    return button(label,()=>task(async()=>{
      const selected=typeof data==='function'?data():data;
      const result=await perform(action,selected,{publication});
      if(after&&result)await after(result);
    }),name);
  }
  function actorControls(){
    const group=E('div',null,'se-actor');
    const choices=actorForForm();
    if(choices.length){
      const chooser=select([{value:'',label:'Choose registered reviewer'},...choices.map(a=>({value:a.id,label:a.name+' · '+a.id}))],state.actor.id,'actor-select');
      chooser.onchange=()=>task(async()=>{
        const actor=choices.find(a=>a.id===chooser.value);if(!actor)return;
        await state.saveChain;state.actor=clone(actor);state.editor=null;state.editorName=null;state.dirty=false;await render();
      });group.append(field('Responsible reviewer',chooser));
    }
    const id=input(state.actor.id,'text','actor-id'),name=input(state.actor.name,'text','actor-name');
    id.oninput=()=>{state.actor.id=id.value;};name.oninput=()=>{state.actor.name=name.value;};
    group.append(field('Reviewer ID',id),field('Reviewer name',name));return group;
  }
  function selectors(){
    toolbar.replaceChildren(actorControls());
    if(state.formEditions.length){
      const forms=select([{value:'',label:'Select a form edition'},...state.formEditions.map(f=>({value:f.id,label:f.name+' · edition '+f.version}))],state.formEditionId,'form-select');
      forms.onchange=()=>task(async()=>{
        await state.saveChain;selectFormEdition(forms.value);
        state.editor=null;state.editorName=null;state.dirty=false;await render();
      });toolbar.append(field('Form edition',forms));
    }
    if(state.resultSets.length){
      const sets=select([{value:'',label:'Select a result set'},...state.resultSets.map(s=>({value:s.id,label:s.name+' · '+s.rows.length+' results'}))],state.resultSetId,'result-set-select');
      sets.onchange=()=>task(async()=>{
        await state.saveChain;selectResultSet(sets.value);
        state.rowId='';state.editor=null;state.editorName=null;state.dirty=false;await render();
      });toolbar.append(field('Result set',sets));
    }
  }
  async function switchSection(section){
    await state.saveChain;state.section=section;state.editor=null;state.editorName=null;state.page=0;state.dirty=false;
    task(()=>render());
  }
  function upload(label,handler,name){
    const file=input('','file',name);file.accept='.json,application/json';
    file.onchange=()=>task(async()=>{
      const selected=file.files?.[0];if(!selected)return;
      if(selected.size>16*1024*1024)throw new Error('The complete operator request exceeds 16 MiB.');
      const value=parsed(await selected.text(),'Selected operator file');await handler(value);file.value='';
    });return field(label,file);
  }
  async function render(){
    if(!state.shown||!state.loaded)return;
    selectors();updateStatus();body.replaceChildren();
    const epoch=state.epoch,section=state.section;
    const content=await ({overview:renderOverview,forms:renderForms,resultSets:renderResultSets,extract:renderExtraction,
      review:renderReview,tables:renderTables,sources:renderSources,history:renderHistory}[section])();
    if(epoch===state.epoch&&section===state.section&&content)body.replaceChildren(content);
    updateBusy();
  }
  function selectedSet(){return state.resultSets.find(s=>s.id===state.resultSetId);}
  function selectedForm(){return state.formEditions.find(f=>f.id===state.formEditionId);}
  function selectFormEdition(id){
    const form=id?state.formEditions.find(f=>f.id===id):null;
    if(id&&!form)throw new Error('The selected form edition is not in the retained source. Refresh the original revision.');
    const changedEdition=state.formEditionId!==(form?.id??'');
    state.formEditionId=form?.id??'';state.formId=form?.formId??'';
    if(state.resultSetId&&selectedSet()?.formEditionId!==state.formEditionId){
      state.resultSetId='';state.rowId='';state.page=0;
    }else if(changedEdition){state.rowId='';state.page=0;}
  }
  function selectResultSet(id){
    const result=id?state.resultSets.find(s=>s.id===id):null;
    if(id&&!result)throw new Error('The selected result set is not in the retained source. Refresh the original revision.');
    const previous=state.resultSetId;
    state.resultSetId=result?.id??'';
    if(result){
      const form=state.formEditions.find(f=>f.id===result.formEditionId);
      if(!form)throw new Error('The selected result set has no retained form edition. Refresh the original revision.');
      state.formEditionId=form.id;state.formId=form.formId;
    }
    if(previous!==state.resultSetId||!result?.rows.some(r=>r.id===state.rowId))state.rowId='';
    if(previous!==state.resultSetId)state.page=0;
  }
  function sectionBox(title,description){const n=E('section',null,'se-section');n.append(E('h3',title));if(description)n.append(E('p',description,'se-muted'));return n;}
  function empty(text){return E('p',text,'se-empty');}
  function pager(view,rerender){
    const bar=E('div',null,'se-pagination');
    const prev=button('Previous page',()=>task(async()=>{state.page--;await rerender();}),'page-prev');prev.disabled=state.page===0;
    const next=button('Next page',()=>task(async()=>{state.page++;await rerender();}),'page-next');next.disabled=view.nextOffset===null;
    bar.append(prev,E('span',view.total?String(view.offset+1)+'–'+String(view.offset+view.items.length)+' of '+view.total:'No saved records'),next);return bar;
  }
  async function download(suffix,options,name){
    const scope=context(),response=await call(suffix+params({...options,revision:state.revision}),{download:true},scope);
    const blob=await response.blob(),declared=response.headers.get('content-length');
    if(declared!==null&&Number(declared)!==blob.size)throw new Error('The complete export was interrupted.');
    const filename=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??name;
    saveFile(filename,blob);say('Downloaded '+filename+' · '+blob.size.toLocaleString()+' bytes.');
  }
  function exportControls(publication=false){
    const bar=E('div',null,'se-export');
    for(const format of publication?['json','csv','md','html']:['json','md','html'])
      bar.append(button('Download '+format.toUpperCase(),()=>task(()=>download(publication?'/publications/export':'/export',
        publication?{tableId:state.tableId||undefined,publicationId:state.publicationId||undefined,format}:
          {formId:state.formId||undefined,resultSetId:state.resultSetId||undefined,format},
        'extraction.'+format)),'export-'+(publication?'publication-':'')+format));
    return bar;
  }
  async function renderOverview(){
    const box=sectionBox('Extraction progress','Each result keeps the form edition, study version, original values and all independent submissions.');
    const metrics=E('div',null,'se-metrics');
    for(const [key,label]of [['formCount','Forms'],['resultSetCount','Result sets'],['resultCount','Results'],['draftCount','Drafts'],
      ['submissionCount','Submissions'],['resolutionCount','Resolutions']]){const n=E('div');n.append(E('strong',state.overview[key]??0),E('span',label));metrics.append(n);}
    box.append(metrics,table(['Result state','Count'],Object.entries(state.overview.statuses??{})),exportControls());
    const unreviewed=state.overview.unreviewedImpactCount??0;
    box.append(E('h4',unreviewed+' changes need an impact review'));
    if(unreviewed)box.append(button('Review source and form impacts',()=>switchSection('review'),'open-impacts'));
    box.append(details('Unresolved result requirements',state.overview.unresolved??[]));
    return box;
  }

  async function renderForms(){
    const selected=selectedForm(),name='form/'+(selected?.id??'new');
    const initial={mode:selected?'revise':'create',questionId:selected?.question.id??getDossier()?.questions?.[0]?.id??'',
      name:selected?.name??'',description:selected?.description??'',reason:'',
      definition:selected?clone(selected.definition):{fields:[],reviewers:[],extractorIds:[],resolverIds:[],
        minimumExtractions:2,disagreementProcedure:''}};
    if(state.editorName!==name)await useEditor(name,initial);
    const d=state.editor,box=sectionBox(selected?'Form edition '+selected.version:'Create an extraction form',
      'Define the values to extract and the independent review process. A revision keeps the previous form and all results that used it.');
    const newForm=button('New form',()=>task(async()=>{selectFormEdition('');state.editorName=null;await render();}),'new-form');
    box.append(newForm,upload('Load a complete authored form',async value=>{
      const data=value.data??value;
      if(!data.definition||!Array.isArray(data.definition.fields))throw new Error('Choose a complete form definition.');
      state.editor={mode:selected?'revise':'create',questionId:data.questionId??initial.questionId,name:data.name??initial.name,
        description:data.description??'',reason:data.reason??'',definition:clone(data.definition)};
      changed();await state.saveChain;await render();
    },'form-import'));
    const top=E('div',null,'se-grid');
    const questions=A(getDossier()?.questions).map(q=>({value:q.id,label:q.text}));
    const question=select([{value:'',label:'Choose a research question'},...questions],d.questionId,'form-question');
    bind(question,d,'questionId');question.disabled=!!selected;
    top.append(field('Research question',question),field('Form name',bind(input(d.name,'text','form-name'),d,'name')),
      field('Description',bind(area(d.description,'form-description'),d,'description')));
    box.append(top,E('h4','Extraction fields'));
    const rows=d.definition.fields.map((f,index)=>{
      const required=input('','checkbox');required.checked=!!f.required;bind(required,f,'required');
      const more=E('details'),summary=E('summary','Instructions & choices');more.append(summary);
      more.append(field('Instructions',bind(area(f.instructions??''),f,'instructions')));
      const choices=area(A(f.choices).map(c=>c.id+' = '+c.label).join('\n'));
      choices.onchange=()=>{f.choices=choices.value.split('\n').filter(s=>s.trim()).map(line=>{
        const at=line.indexOf('=');return {id:(at<0?line:line.slice(0,at)).trim(),label:(at<0?line:line.slice(at+1)).trim()};
      });changed();};
      more.append(field('Choice ID = label, one per line',choices));
      const kind=select(TYPES,f.valueType);kind.onchange=()=>{
        f.valueType=kind.value;if(['choice','multi-choice'].includes(f.valueType))f.choices??=[];
        else delete f.choices;changed();
      };
      return [bind(input(f.id),f,'id'),bind(input(f.label),f,'label'),kind,required,
        bind(input(f.unit??''),f,'unit'),more,
        button('Remove',()=>task(async()=>{d.definition.fields.splice(index,1);changed();await state.saveChain;await render();}))];
    });
    box.append(table(['Field ID','Label','Value type','Required','Unit','Details',''],rows));
    box.append(button('Add field',()=>task(async()=>{
      d.definition.fields.push({id:'field-'+(d.definition.fields.length+1),label:'',valueType:'text',required:true});
      changed();await state.saveChain;await render();
    }),'add-field'));
    box.append(E('h4','Reviewers and responsibilities'));
    const roles=(reviewer,key)=>{
      const c=input('','checkbox');c.checked=d.definition[key].includes(reviewer.id);
      c.onchange=()=>{d.definition[key]=c.checked?[...new Set([...d.definition[key],reviewer.id])]:d.definition[key].filter(id=>id!==reviewer.id);changed();};
      return c;
    };
    box.append(table(['Reviewer ID','Name','Independent extractor','Resolver',''],d.definition.reviewers.map((r,index)=>{
      const identifier=input(r.id);identifier.onchange=()=>{
        const old=r.id;r.id=identifier.value;
        for(const key of ['extractorIds','resolverIds'])d.definition[key]=d.definition[key].map(id=>id===old?r.id:id);
        changed();
      };
      return [identifier,bind(input(r.name),r,'name'),roles(r,'extractorIds'),roles(r,'resolverIds'),
        button('Remove',()=>task(async()=>{
          d.definition.reviewers.splice(index,1);
          for(const key of ['extractorIds','resolverIds'])d.definition[key]=d.definition[key].filter(id=>id!==r.id);
          changed();await state.saveChain;await render();
        }))];
    })));
    box.append(button('Add reviewer',()=>task(async()=>{
      d.definition.reviewers.push({id:'reviewer-'+(d.definition.reviewers.length+1),name:''});
      changed();await state.saveChain;await render();
    }),'add-reviewer'));
    box.append(field('Minimum independent extractions',bind(input(d.definition.minimumExtractions,'number','form-minimum'),d.definition,'minimumExtractions',Number)),
      field('Disagreement and resolution procedure',bind(area(d.definition.disagreementProcedure,'form-procedure'),d.definition,'disagreementProcedure')),
      field('Reason for this form edition',bind(area(d.reason,'form-reason'),d,'reason')));
    box.append(requestButton(selected?'Save next form edition':'Create form',selected?'revise-form':'create-form',()=>{
      const data={name:d.name,description:d.description,definition:d.definition,reason:d.reason};
      return selected?{...data,formId:selected.formId,previousEditionId:selected.id}:{...data,questionId:d.questionId};
    },{name:'form-save',after:async result=>{
      selectFormEdition(result.operation.result.formEdition.id);
      state.editorName=null;await render();
    }}));
    if(selected)box.append(details('Original saved form edition',selected),
      table(['Edition','Author','Revision','Reason'],state.formEditions.filter(f=>f.formId===selected.formId).map(f=>[f.version,f.actor.name,f.revision,f.reason])));
    return box;
  }
  async function renderResultSets(){
    const form=selectedForm(),existing=selectedSet(),box=sectionBox('Bind a study and its result rows',
      'The result set keeps this exact form edition and eligibility study version. Keep distinct outcomes, groups and denominator scopes in separate rows.');
    if(!form){box.append(empty('Create or select a form edition first.'));return box;}
    const key='result-set/'+form.id;
    if(state.editorName!==key)await useEditor(key,{name:'',description:'',studyId:'',studyVersion:1,rows:[],reason:'',supersedes:''});
    const d=state.editor;
    const studies=state.studies.filter(s=>s.questionId===form.question.id);
    const chooser=select([{value:'',label:'Choose an existing eligibility study'},...studies.map(s=>({
      value:s.id+'|'+s.version,label:s.name+' · version '+s.version+' · '+s.occurrenceIds.length+' source occurrences'}))],
      d.studyId?d.studyId+'|'+d.studyVersion:'','study-select');
    chooser.onchange=()=>{const [id,version]=chooser.value.split('|');d.studyId=id;d.studyVersion=Number(version);changed();};
    box.append(field('Study and version',chooser),field('Result set name',bind(input(d.name,'text','set-name'),d,'name')),
      field('Description',bind(area(d.description,'set-description'),d,'description')));
    box.append(upload('Load complete authored result rows',async value=>{
      const data=value.data??value;
      if(!Array.isArray(data.rows??data))throw new Error('Choose a complete result row array.');
      if(Array.isArray(data))d.rows=clone(data);
      else for(const key of ['name','description','studyId','studyVersion','rows','reason','supersedes'])
        if(data[key]!==undefined)d[key]=clone(data[key]);
      changed();await state.saveChain;await render();
    },'set-import'));
    box.append(table(['Result ID','Label','Original occurrence IDs','Context',''],d.rows.map((r,index)=>{
      const ids=area(A(r.occurrenceIds).join('\n'));ids.onchange=()=>{r.occurrenceIds=ids.value.split('\n').map(s=>s.trim()).filter(Boolean);changed();};
      const more=E('details'),summary=E('summary','Full row context');more.append(summary);
      const context=area(json(r.context??{}));context.onchange=()=>{
        try{r.context=parsed(context.value,'Row context');context.setCustomValidity('');changed();}
        catch(error){context.setCustomValidity(error.message);say(error.message);}
      };more.append(context);
      return [bind(input(r.id),r,'id'),bind(area(r.label),r,'label'),ids,more,
        button('Remove',()=>task(async()=>{d.rows.splice(index,1);changed();await state.saveChain;await render();}))];
    })));
    box.append(button('Add result row',()=>task(async()=>{
      const study=studies.find(s=>s.id===d.studyId&&s.version===d.studyVersion);
      d.rows.push({id:'result-'+(d.rows.length+1),label:'',occurrenceIds:clone(study?.occurrenceIds??[]),context:{}});
      changed();await state.saveChain;await render();
    }),'add-result-row'));
    box.append(field('Reason',bind(area(d.reason,'set-reason'),d,'reason')));
    const supersedes=select([{value:'',label:'New independent result set'},...state.resultSets.map(s=>({value:s.id,label:'Replace '+s.name}))],d.supersedes,'set-supersedes');
    bind(supersedes,d,'supersedes');box.append(field('Explicit predecessor, if this is a replacement',supersedes));
    box.append(requestButton('Create result set','create-result-set',()=>({
      formEditionId:form.id,studyId:d.studyId,studyVersion:d.studyVersion,name:d.name,description:d.description,
      rows:d.rows,reason:d.reason,...(d.supersedes?{supersedes:d.supersedes}:{})
    }),{name:'set-save',after:async result=>{
      selectResultSet(result.operation.result.resultSet.id);
      state.section='extract';state.editorName=null;state.page=0;await render();
    }}));
    if(existing)box.append(details('Selected saved result set',existing));
    box.append(details('Original eligible study versions',studies));return box;
  }

  const basisInput=b=>b.kind==='json-pointer'?{
    occurrenceId:b.occurrenceId,kind:b.kind,pointer:b.pointer,...((b.fileName??b.file?.name)?{fileName:b.fileName??b.file.name}:{})
  }:{occurrenceId:b.occurrenceId,kind:'passage',locator:b.locator,quote:b.quote??'',...((b.fileName??b.file?.name)?{fileName:b.fileName??b.file.name}:{})};
  const answerInput=a=>({rowId:a.rowId,fieldId:a.fieldId,status:a.status,value:clone(a.value),
    bases:A(a.bases).map(basisInput),context:clone(a.context??{}),note:a.note??'',...(a.derivation?{derivation:clone(a.derivation)}:{})});
  const sourceKey=b=>JSON.stringify([state.revision,b.occurrenceId,b.fileName??b.file?.name??'',b.pointer]);
  async function resolveSources(answers){
    const scope=context(),epoch=state.epoch,revision=state.revision,groups=new Map();
    for(const answer of answers)for(const b of A(answer.bases)){
      if(b.kind!=='json-pointer')continue;
      const key=JSON.stringify([b.occurrenceId,b.fileName??b.file?.name??'']);
      if(!groups.has(key))groups.set(key,{occurrenceId:b.occurrenceId,fileName:b.fileName??b.file?.name,pointers:[]});
      if(!groups.get(key).pointers.includes(b.pointer))groups.get(key).pointers.push(b.pointer);
    }
    for(const g of groups.values()){
      const missing=g.pointers.filter(pointer=>!state.sourceValues.has(sourceKey({...g,pointer})));
      if(!missing.length)continue;
      const cacheKey=JSON.stringify([revision,g.occurrenceId,g.fileName,missing]);
      let request=state.sourceRequests.get(cacheKey);
      if(!request){
        request=call('/source-values'+params({revision}),{method:'POST',
          body:{occurrenceId:g.occurrenceId,pointers:missing,...(g.fileName?{fileName:g.fileName}:{})}},scope);
        state.sourceRequests.set(cacheKey,request);
      }
      const result=await request;
      if(!sameContext(scope,epoch)||state.revision!==revision)return;
      if(result.revision!==revision||result.occurrence?.occurrenceId!==g.occurrenceId)throw new Error('The original source selection changed.');
      for(const value of result.values)state.sourceValues.set(sourceKey(value),value);
    }
  }
  function sourceDescription(answer){
    const box=E('div',null,'se-source-values');
    if(!A(answer.bases).length){box.append(E('span','No original source bound','se-muted'));return box;}
    for(const basis of answer.bases){
      if(basis.kind==='passage'){
        box.append(E('p',basis.quote||'Passage reference'),E('code',basis.locator));continue;
      }
      const bound=state.sourceValues.get(sourceKey(basis))??(Object.hasOwn(basis,'found')?basis:null);
      const line=E('div');
      line.append(E('strong',bound?bound.found?typedText(bound.typedValue):'Field absent':'Read original source'),
        E('small',bound?.found?bound.typedValue[0]:''),
        E('code',basis.pointer===''?'Whole original document':basis.pointer),
        E('small',basis.fileName??basis.file?.name??basis.occurrenceId));
      if(bound)line.append(details('Exact original binding',bound));box.append(line);
    }return box;
  }
  function valueEditor(answer,{touch=changed,namePrefix='value'}={}){
    const box=E('div',null,'se-value-editor');
    const kind=select(['str','number','bool','NoneType','array','object'],answer.value?.[0]??'str',namePrefix+'-kind');
    const text=area(answer.value?.[0]==='NoneType'?'null':
      ['array','object'].includes(answer.value?.[0])?json(answer.value[1]):String(answer.value?.[1]??''),namePrefix+'-value',2);
    text.disabled=kind.value==='NoneType';
    const update=()=>{
      try{answer.value=parseTyped(kind.value,text.value);text.setCustomValidity('');touch();}
      catch(error){text.setCustomValidity(error.message);say(error.message);}
    };
    kind.onchange=()=>{
      text.disabled=kind.value==='NoneType';
      if(kind.value==='NoneType')text.value='null';
      else if(kind.value==='bool'&&!['true','false'].includes(text.value))text.value='false';
      else if(['array','object'].includes(kind.value))text.value='[]';
      update();
    };
    text.oninput=update;box.append(kind,text);return box;
  }
  function basisEditor(answer,touch){
    const outer=E('details'),summary=E('summary','Source pointers, note and context');outer.append(summary);
    const redraw=()=>{
      const content=E('div');outer.replaceChildren(summary,content);
      for(const [index,b]of A(answer.bases).entries()){
        const line=E('div',null,'se-basis');
        const occurrence=select([{value:'',label:'Choose original occurrence'},...state.occurrences.map(o=>({value:o.occurrenceId,label:o.title+' · '+o.occurrenceId}))],b.occurrenceId);
        occurrence.onchange=()=>{b.occurrenceId=occurrence.value;touch();};
        const kind=select(['json-pointer','passage'],b.kind);kind.onchange=()=>{
          const next={occurrenceId:b.occurrenceId,kind:kind.value,...(b.fileName?{fileName:b.fileName}:{})};
          if(kind.value==='json-pointer')next.pointer='';else Object.assign(next,{locator:'',quote:''});
          answer.bases[index]=next;touch();redraw();
        };
        const filename=input(b.fileName??b.file?.name??'');filename.oninput=()=>{
          if(filename.value)b.fileName=filename.value;else delete b.fileName;delete b.file;touch();
        };
        line.append(field('Retained occurrence',occurrence),field('Source locator type',kind),field('Original file member, if selected',filename));
        for(const key of b.kind==='json-pointer'?['pointer']:['locator','quote']){
          const control=area(b[key]??'');control.oninput=()=>{b[key]=control.value;touch();};
          line.append(field(key==='pointer'?'JSON pointer (empty selects the entire original document)':key,control));
        }
        line.append(button('Remove this source',()=>{answer.bases.splice(index,1);touch();redraw();}));content.append(line);
      }
      content.append(button('Add original source',()=>{
        answer.bases??=[];answer.bases.push({occurrenceId:selectedSet()?.rows.find(r=>r.id===answer.rowId)?.sources?.[0]?.occurrenceId??'',
          kind:'json-pointer',pointer:''});touch();redraw();
      }));
      const note=area(answer.note??'');note.oninput=()=>{answer.note=note.value;touch();};content.append(field('Interpretation / missing-value note',note));
      const ctx=area(json(answer.context??{}));ctx.onchange=()=>{
        try{answer.context=parsed(ctx.value,'Answer context');ctx.setCustomValidity('');touch();}
        catch(error){ctx.setCustomValidity(error.message);say(error.message);}
      };content.append(field('Complete field context',ctx));
      if(answer.status==='derived'){
        const derivative=answer.derivation??{method:'',inputFieldIds:[]};
        for(const key of ['method','expression','reference']){
          const control=area(derivative[key]??'');control.oninput=()=>{answer.derivation??=clone(derivative);answer.derivation[key]=control.value;touch();};
          content.append(field('Derivation '+key,control));
        }
        const fields=input(A(derivative.inputFieldIds).join(', '));
        fields.oninput=()=>{answer.derivation??=clone(derivative);answer.derivation.inputFieldIds=fields.value.split(',').map(s=>s.trim()).filter(Boolean);touch();};
        content.append(field('Input field IDs',fields));
      }
    };redraw();return outer;
  }
  async function renderExtraction(){
    const set=selectedSet(),box=sectionBox('Independent extraction','Save the complete draft under the responsible extractor, then submit that saved edition. Original source values remain visible beside the entries.');
    if(!set){box.append(empty('Select a result set first.'));return box;}
    const form=state.formEditions.find(f=>f.id===set.formEditionId);
    if(!form){box.append(empty('The selected result set form is unavailable at this revision.'));return box;}
    const key='extraction/'+set.id+'/'+(state.actor.id||'unselected');
    if(state.editorName!==key)await useEditor(key,{answers:[],reason:'',supersedes:'',savedExtractionId:''});
    const d=state.editor;
    const permitted=form.definition.extractorIds.includes(state.actor.id);
    if(!permitted)box.append(E('p','Choose one of this form’s registered extractors to save or submit an independent draft.','se-callout'));
    box.append(upload('Load a complete authored extraction',async value=>{
      const data=value.data??value,answers=data.answers??data;
      if(!Array.isArray(answers))throw new Error('Choose a complete answer array.');
      d.answers=answers.map(answerInput);d.reason=data.reason??d.reason;d.savedExtractionId='';
      if(data.supersedes)d.supersedes=data.supersedes;
      changed();await state.saveChain;await render();
    },'answers-import'));
    if(!set.rows.some(r=>r.id===state.rowId))state.rowId=set.rows[0]?.id??'';
    const selector=select(set.rows.map(r=>({value:r.id,label:r.label})),state.rowId,'row-select');
    selector.onchange=()=>task(async()=>{await state.saveChain;state.rowId=selector.value;await render();});
    box.append(field('Result row',selector),E('p',d.answers.length+' authored entries across '+set.rows.length+' rows and '+form.definition.fields.length+' fields.','se-count'));
    const row=set.rows.find(r=>r.id===state.rowId);
    if(row){
      const rowAnswers=d.answers.filter(a=>a.rowId===row.id);
      await resolveSources(rowAnswers);
      const entries=form.definition.fields.map(f=>{
        const found=d.answers.find(a=>a.rowId===row.id&&a.fieldId===f.id);
        const answer=found??{rowId:row.id,fieldId:f.id,status:'reported',value:['str',''],bases:[],context:{},note:''};
        const touch=()=>{if(!d.answers.includes(answer))d.answers.push(answer);d.savedExtractionId='';changed();};
        const label=E('div');label.append(E('strong',f.label),E('small',f.id+(f.required?' · required':'')+(f.unit?' · '+f.unit:'')));
        if(f.instructions)label.append(details('Field instructions',f.instructions));
        const status=select(STATUSES,answer.status,'status-'+f.id);status.dataset.rowId=row.id;status.dataset.fieldId=f.id;
        status.onchange=()=>{answer.status=status.value;if(answer.status!=='derived')delete answer.derivation;touch();};
        const edit=valueEditor(answer,{touch,namePrefix:'answer-'+f.id});edit.dataset.rowId=row.id;edit.dataset.fieldId=f.id;
        const combined=E('div');combined.append(status,edit,basisEditor(answer,touch));
        return [label,sourceDescription(answer),combined];
      });
      box.append(table(['Field','Original source','Extractor’s entry'],entries),details('Complete original result context',row),
        button('Refresh selected original source values',()=>task(async()=>{state.sourceValues.clear();state.sourceRequests.clear();await render();}),'row-source-refresh'));
    }
    box.append(field('Reason / extraction note',bind(area(d.reason,'extraction-reason'),d,'reason')));
    const save=requestButton('Save complete extraction','save-extraction',()=>({
      resultSetId:set.id,answers:d.answers.map(answerInput),reason:d.reason,...(d.supersedes?{supersedes:d.supersedes}:{})
    }),{name:'extraction-save',after:async result=>{
      const extraction=result.operation.result.extraction;
      await useEditor(key,{answers:extraction.answers.map(answerInput),reason:extraction.reason,
        supersedes:extraction.id,savedExtractionId:extraction.id},{replace:true});
      state.dirty=false;await queueSave();await render();
    }});save.disabled=!permitted;box.append(save);
    const submitted=requestButton('Submit saved extraction','submit-extraction',()=>({extractionId:d.savedExtractionId,reason:d.reason}),
      {name:'extraction-submit',after:async()=>{await render();}});
    submitted.disabled=!permitted||!d.savedExtractionId||state.dirty;box.append(submitted);
    if(d.savedExtractionId)box.append(E('p','Selected saved draft: '+d.savedExtractionId,'se-muted'));
    const draftPage=await page('extractions',{resultSetId:set.id});
    box.append(E('h4','Saved draft editions'),table(['Extractor','Edition','Saved revision','Draft',''],draftPage.items.map(extraction=>[
      extraction.actor.name,extraction.version,extraction.revision,details(extraction.id,extraction),
      button('Continue from this draft',()=>task(async()=>{
        state.actor=clone(extraction.actor);
        await useEditor('extraction/'+set.id+'/'+extraction.actor.id,{answers:extraction.answers.map(answerInput),
          reason:extraction.reason,supersedes:extraction.id,savedExtractionId:extraction.id},{replace:true});
        state.dirty=false;await queueSave();await render();
      }),'continue-'+extraction.id)
    ])),pager(draftPage,render));
    return box;
  }

  async function renderReview(){
    const set=selectedSet(),box=sectionBox('Compare and resolve independent entries',
      'Review all current submissions and their original values. A resolution retains both entries, the selected values and the reason.');
    if(!set){box.append(empty('Select a result set first.'));return box;}
    const versions=await all('results',{resultSetId:set.id}),current=versions.filter(r=>r.current);
    if(!current.length){box.append(empty('This result set has no extracted results yet.'));return box;}
    if(!current.some(r=>r.record.row.id===state.rowId))state.rowId=current[0].record.row.id;
    const result=current.find(r=>r.record.row.id===state.rowId),record=result.record;
    const rowSelector=select(current.map(r=>({value:r.record.row.id,label:r.label+' · '+r.status})),state.rowId,'review-row');
    rowSelector.onchange=()=>task(async()=>{await state.saveChain;state.rowId=rowSelector.value;state.editorName=null;await render();});
    box.append(field('Result to review',rowSelector),E('p',result.status,'se-result-status'));
    const editorKey='resolution/'+result.editionId+'/'+state.actor.id;
    if(state.editorName!==editorKey)await useEditor(editorKey,{mode:'consensus',reason:'',choices:{},authored:{},
      supersedes:record.resolution?.id??''});
    const d=state.editor,form=state.formEditions.find(f=>f.id===set.formEditionId);
    const modes=select([{value:'consensus',label:'Consensus — retain matching submitted values'},
      {value:'adjudication',label:'Adjudication — choose or author each value'}],d.mode,'resolution-mode');
    modes.onchange=()=>task(async()=>{d.mode=modes.value;changed();await state.saveChain;await render();});
    box.append(field('Resolution method',modes));
    const submitted=record.submissions;
    box.append(table(['Current submission','Extractor','Draft','Reason'],submitted.map(s=>[s.id,s.actor.name,s.extractionId,s.reason])));
    await resolveSources(submitted.flatMap(s=>Object.values(s.values)));
    const comparisons=record.comparison.map(comparison=>{
      const values=E('div',null,'se-comparison-values');
      for(const entry of comparison.entries){
        const value=E('article',null,'se-submission-value');
        value.append(E('strong',entry.actor.name),E('p',entry.answer?typedText(entry.answer.value):'No submitted answer'),
          E('small',entry.answer?.status??'Missing'),E('code',entry.submissionId));
        if(entry.answer)value.append(sourceDescription(entry.answer),details('Complete submitted entry',entry.answer));
        values.append(value);
      }
      const decision=E('div');
      if(d.mode==='adjudication'){
        const choice=select([{value:'',label:'Choose the resolved value'},...comparison.entries.filter(e=>e.answer).map(e=>({
          value:e.submissionId,label:'Use '+e.actor.name+' · '+typedText(e.answer.value)})),{value:'authored',label:'Author a source-bound resolved value'}],
          d.choices[comparison.fieldId]??'','resolve-choice-'+comparison.fieldId);
        choice.onchange=()=>task(async()=>{
          d.choices[comparison.fieldId]=choice.value;
          if(choice.value==='authored'&&!d.authored[comparison.fieldId]){
            const original=comparison.entries.find(e=>e.answer)?.answer;
            d.authored[comparison.fieldId]=original?answerInput(original):{
              rowId:record.row.id,fieldId:comparison.fieldId,status:'uncertain',value:['NoneType',null],bases:[],note:'',context:{}};
          }
          changed();await state.saveChain;await render();
        });decision.append(choice);
        if(d.choices[comparison.fieldId]==='authored'){
          const answer=d.authored[comparison.fieldId],touch=changed;
          const status=select(STATUSES,answer.status,'resolved-status-'+comparison.fieldId);
          status.onchange=()=>{answer.status=status.value;touch();};
          decision.append(status,valueEditor(answer,{touch,namePrefix:'resolved-'+comparison.fieldId}),basisEditor(answer,touch));
        }
      }else decision.append(E('p',comparison.status==='AGREEMENT'&&comparison.sourceAgreement?'Matching submitted entries and sources':'Review the submitted difference before using consensus'));
      return [comparison.label,E('span',comparison.status+(comparison.sourceAgreement?'':' · source selections differ')),values,decision];
    });
    box.append(table(['Field','Comparison','Independent submitted values','Resolved value'],comparisons));
    box.append(field('Reason, source interpretation and resolution',bind(area(d.reason,'resolution-reason',4),d,'reason')));
    if(d.supersedes)box.append(E('p','This correction will retain previous resolution '+d.supersedes+'.','se-muted'));
    const save=requestButton(d.supersedes?'Save next resolution edition':'Resolve this result','resolve-result',()=>{
      const data={resultSetId:set.id,rowId:record.row.id,submissionIds:submitted.map(s=>s.id),mode:d.mode,reason:d.reason};
      if(d.supersedes)data.supersedes=d.supersedes;
      if(d.mode==='adjudication')data.answers=record.comparison.map(c=>{
        const selected=d.choices[c.fieldId];
        if(!selected)throw new Error('Choose the resolved value for '+c.label+'.');
        if(selected!=='authored')return {fieldId:c.fieldId,submissionId:selected};
        const answer=answerInput(d.authored[c.fieldId]);delete answer.rowId;delete answer.fieldId;
        return {fieldId:c.fieldId,answer};
      });
      return data;
    },{name:'resolution-save',after:async()=>{state.editorName=null;await render();}});
    save.disabled=!form?.definition.resolverIds.includes(state.actor.id);box.append(save);
    if(save.disabled)box.append(E('p','Choose a registered resolver for this form.','se-muted'));
    box.append(details('Original result and complete resolution history',result),
      details('All saved editions for this result',versions.filter(r=>r.resultId===result.resultId)));
    const impacts=await all('impact',{resultSetId:set.id});
    if(impacts.length){
      box.append(E('h4','Source, form and study changes'));
      for(const impact of impacts){
        const section=E('article',null,'se-impact');section.append(E('h5',impact.kind),details('Observed original change',impact));
        const disposition=select([{value:'retain',label:'Retain the existing result set'},
          {value:'revise',label:'Revision required'},{value:'replaced',label:'Replaced by a receiving result set'}],'retain');
        const reason=area(''),replacement=select([{value:'',label:'Select replacement when applicable'},
          ...state.resultSets.filter(s=>s.id!==set.id).map(s=>({value:s.id,label:s.name}))],'');
        section.append(field('Impact decision',disposition),field('Reason',reason),field('Replacement result set',replacement),
          requestButton('Save impact review','review-impact',()=>({impactId:impact.id,expectedFingerprint:impact.fingerprint,
            disposition:disposition.value,reason:reason.value,...(disposition.value==='replaced'?{resultSetId:replacement.value}:{})}),
          {name:'impact-save-'+impact.id}));box.append(section);
      }
    }return box;
  }
  async function renderSources(){
    const box=sectionBox('Inspect exact original source values',
      'Select the retained occurrence and original file member. JSON pointers resolve against the saved bytes; a missing field and an explicit null remain different.');
    const key='source-inspection';
    if(state.editorName!==key)await useEditor(key,{occurrenceId:state.occurrences[0]?.occurrenceId??'',fileName:'',pointers:''});
    const d=state.editor;
    const occurrence=select(state.occurrences.map(o=>({value:o.occurrenceId,label:o.title+' · '+o.occurrenceId})),d.occurrenceId,'source-occurrence');
    box.append(field('Original occurrence',bind(occurrence,d,'occurrenceId')),
      field('Original file member (leave empty for the original occurrence content)',bind(input(d.fileName,'text','source-file-name'),d,'fileName')),
      field('JSON pointers, one per line (one empty line selects the whole document)',bind(area(d.pointers,'source-pointers',7),d,'pointers')));
    const values=E('div');box.append(button('Read original values',()=>task(async()=>{
      const pointers=d.pointers.split('\n');
      const selected=await call('/source-values'+params({revision:state.revision}),{method:'POST',
        body:{occurrenceId:d.occurrenceId,pointers,...(d.fileName?{fileName:d.fileName}:{})}});
      values.replaceChildren(table(['Pointer','Presence','Original type','Original value'],selected.values.map(v=>[
        v.pointer===''?'Whole document':v.pointer,v.found?'Present':'Absent',v.found?v.typedValue[0]:'—',
        v.found?typedText(v.typedValue):'No field at this pointer'])),details('Complete original bindings',selected));
      state.dirty=false;await queueSave();
    }),'source-read'),values);
    return box;
  }
  async function renderHistory(){
    const box=sectionBox('History and original request recovery',
      'Every saved operation keeps its original request and result. After an interrupted response, recover that same request before writing another operation.');
    const view=await page('operations',{...(state.resultSetId?{resultSetId:state.resultSetId}:{})});
    box.append(table(['Revision','Action','Author','Request','Original record'],view.items.map(op=>[
      op.revision,op.action,op.actor.name,op.requestId,details('Read complete operation',op)
    ])),pager(view,render),exportControls());
    const local=(await drafts.list(context(),'request/')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    box.append(E('h4','Saved requests for this workspace and dossier'));
    if(!local.length)box.append(empty('No browser requests have been prepared in this workspace.'));
    for(const item of local){
      const record=item.value,card=E('article',null,'se-request');
      card.append(E('h5',record.request.action+' · '+record.state),
        E('p',record.request.requestId+' · reviewed revision '+record.request.expectedRevision),
        details('Complete saved request and returned result',record),
        button('Download original request',()=>saveFile(record.request.requestId+'.request.json',record.request),'request-download-'+record.request.requestId),
        button('Download operation record',()=>saveFile(record.request.requestId+'.operation.json',record),'operation-download-'+record.request.requestId));
      if(record.state!=='committed')card.append(button('Recover this exact request',()=>task(async()=>{
        await perform(record.request.action,record.request.data,{publication:record.route.startsWith('/publications/'),
          actor:record.request.actor,requestRecord:record});await render();
      }),'request-recover-'+record.request.requestId));
      box.append(card);
    }
    const draftRows=await drafts.list(context(),'draft/');
    box.append(E('h4','Retained local editors'));
    for(const row of draftRows){
      const card=E('div',null,'se-request');card.append(E('p',row.key.slice(row.key.indexOf('/draft/')+7)),
        E('small',row.updatedAt+' · '+(row.value.dirty?'contains unsaved changes':'saved selection')),
        button('Download complete editor',()=>saveFile('research-extraction-editor.json',row.value)));
      box.append(card);
    }return box;
  }

  async function renderTables(){
    const box=sectionBox('Author and publish evidence tables',
      'Choose exact result editions, define the columns and write the interpretation. A publication freezes the complete selected records and their source and review history.');
    const overview=await call('/publications'+params({revision:state.revision,section:'overview'}));
    const tables=A(overview.tables);
    if(!state.tableId&&!state.tableCreating&&tables.length)state.tableId=tables[0].id;
    const selected=tables.find(t=>t.id===state.tableId),selector=select([{value:'',label:'Choose an authored table'},
      ...tables.map(t=>({value:t.id,label:t.name+' · edition '+t.edition}))],state.tableId,'table-select');
    selector.onchange=()=>task(async()=>{await state.saveChain;state.tableId=selector.value;state.tableCreating=false;
      state.publicationId='';state.editorName=null;state.page=0;await render();});
    box.append(field('Evidence table',selector),button('New table',()=>task(async()=>{
      state.tableId='';state.tableCreating=true;state.publicationId='';state.editorName=null;state.page=0;await render();
    }),'table-new'));
    const key='table/'+(selected?.id??'new');
    if(state.editorName!==key)await useEditor(key,{
      definition:selected?clone(selected.definition):{name:'',description:'',questionIds:[],columns:[],notes:''},
      tableEditionId:selected?.editionId??'',reason:'',rows:{},title:'',summary:'',limitations:'',publicationReason:'',
      reviewNote:'',reviewContextFingerprint:'',againstPublicationId:''});
    const d=state.editor;
    box.append(upload('Load a complete authored table definition',async value=>{
      const definition=value.definition??value.data?.definition??value;
      if(!Array.isArray(definition.columns))throw new Error('Choose a complete evidence table definition.');
      d.definition=clone(definition);changed();await state.saveChain;await render();
    },'table-import'));
    const form=E('details');form.open=!selected;form.append(E('summary',selected?'Edit the next table definition':'Define this evidence table'));
    form.append(field('Table name',bind(input(d.definition.name,'text','table-name'),d.definition,'name')),
      field('Description',bind(area(d.definition.description,'table-description'),d.definition,'description')),
      field('Notes carried with every publication',bind(area(d.definition.notes,'table-notes'),d.definition,'notes')));
    const questions=E('fieldset');questions.append(E('legend','Research questions'));
    for(const q of A(getDossier()?.questions)){
      const check=input('','checkbox');check.checked=A(d.definition.questionIds).includes(q.id);
      check.onchange=()=>{
        d.definition.questionIds=check.checked?[...new Set([...A(d.definition.questionIds),q.id])]:A(d.definition.questionIds).filter(id=>id!==q.id);
        changed();
      };questions.append(field(q.text,check));
    }form.append(questions);
    form.append(table(['Column ID','Label','Pointer into the complete result record','Format','Description',''],d.definition.columns.map((c,index)=>[
      bind(input(c.id),c,'id'),bind(input(c.label),c,'label'),bind(input(c.pointer),c,'pointer'),
      bind(select(['text','typed','json'],c.format??'text'),c,'format'),bind(area(c.description??''),c,'description'),
      button('Remove',()=>task(async()=>{d.definition.columns.splice(index,1);changed();await state.saveChain;await render();}))
    ])));
    form.append(button('Add column',()=>task(async()=>{
      d.definition.columns.push({id:'column-'+(d.definition.columns.length+1),label:'',pointer:'',format:'text',description:''});
      changed();await state.saveChain;await render();
    }),'table-add-column'));
    if(selected)form.append(field('Reason for the new table edition',bind(area(d.reason,'table-reason'),d,'reason')));
    form.append(requestButton(selected?'Save next table edition':'Create evidence table',selected?'revise-table':'create-table',
      ()=>selected?{tableId:selected.id,expectedTableEditionId:d.tableEditionId,definition:d.definition,reason:d.reason}:{definition:d.definition},
      {publication:true,name:'table-save',after:async result=>{
        state.tableId=result.operation.result.tableEdition.tableId;state.tableCreating=false;state.editorName=null;
        await render();
      }}));box.append(form);
    if(!selected)return box;
    const [results,publications]=await Promise.all([
      all('results',{publication:true,tableId:selected.id}),all('publications',{publication:true,tableId:selected.id})
    ]);
    const current=results.filter(r=>r.current),byResult=new Map();
    for(const result of results){
      if(!byResult.has(result.resultId))byResult.set(result.resultId,[]);
      byResult.get(result.resultId).push(result);
    }
    const latest=publications.at(-1)??null;
    const publish=E('details');publish.append(E('summary','Prepare the next complete publication'));
    publish.append(E('p','Available: '+current.length+' current results; '+results.length+' retained result editions. Selected rows keep their exact original fingerprint.','se-muted'));
    const rowButtons=E('div',null,'se-button-row');
    rowButtons.append(button('Select all current results',()=>task(async()=>{
      d.rows=Object.fromEntries(current.map(r=>[r.resultId,{resultId:r.resultId,editionId:r.editionId,fingerprint:r.fingerprint}]));
      changed();await state.saveChain;await render();
    }),'table-select-current'),button('Clear row selection',()=>task(async()=>{d.rows={};changed();await state.saveChain;await render();}),'table-clear-rows'));
    publish.append(rowButtons);
    publish.append(table(['Include','Result','Exact retained edition','Source/review status'],[...byResult.entries()].map(([resultId,versions])=>{
      const selectedRow=d.rows[resultId],original=versions.find(r=>r.editionId===selectedRow?.editionId)??versions.find(r=>r.current)??versions.at(-1);
      const include=input('','checkbox');include.checked=!!selectedRow;include.dataset.se='table-include-'+resultId;
      include.onchange=()=>{if(include.checked)d.rows[resultId]={resultId,editionId:original.editionId,fingerprint:original.fingerprint};
        else delete d.rows[resultId];changed();};
      const edition=select(versions.map(r=>({value:r.editionId,label:(r.current?'Current · ':'Historical · ')+r.editionId})),
        original.editionId,'table-result-edition-'+resultId);
      edition.onchange=()=>{const r=versions.find(item=>item.editionId===edition.value);
        if(include.checked)d.rows[resultId]={resultId,editionId:r.editionId,fingerprint:r.fingerprint};changed();};
      return [include,original.label,edition,E('span',original.status)];
    })));
    publish.append(field('Publication title',bind(input(d.title,'text','publication-title'),d,'title')),
      field('Authored summary and interpretation',bind(area(d.summary,'publication-summary',5),d,'summary')),
      field('Limitations',bind(area(d.limitations,'publication-limitations',4),d,'limitations')),
      field('Reason for publication',bind(area(d.publicationReason,'publication-reason'),d,'publicationReason')),
      details('Current original review context',overview.reviewContext));
    publish.append(field('Review note for the selected results, unresolved items and source impacts',bind(area(d.reviewNote,'publication-review-note',4),d,'reviewNote')),
      button('Use this reviewed context',()=>{d.reviewContextFingerprint=overview.reviewContext.fingerprint;changed();
        say('The displayed review context is selected at revision '+state.revision+'.');},'publication-context-select'));
    publish.append(E('p',latest?'This edition follows '+latest.id+'. The previous publication remains available.':'This is the first publication of this table.','se-muted'));
    publish.append(requestButton('Publish complete selected table','publish-table',()=>{
      if(d.reviewContextFingerprint!==overview.reviewContext.fingerprint)
        throw new Error('Review and select the displayed current context before publication.');
      return {tableId:selected.id,tableEditionId:selected.editionId,previousPublicationId:latest?.id??null,
        rows:Object.values(d.rows),title:d.title,summary:d.summary,limitations:d.limitations,reason:d.publicationReason,
        review:{contextFingerprint:d.reviewContextFingerprint,note:d.reviewNote}};
    },{publication:true,name:'publication-save',after:async result=>{
      state.publicationId=result.operation.result.publication.id;state.editorName=null;await render();
    }}));box.append(publish);
    if(publications.length){
      if(!publications.some(p=>p.id===state.publicationId))state.publicationId=latest.id;
      const chooser=select(publications.map(p=>({value:p.id,label:p.title+' · publication '+p.edition})),state.publicationId,'publication-select');
      chooser.onchange=()=>task(async()=>{state.publicationId=chooser.value;state.page=0;await render();});
      box.append(field('Saved complete publication',chooser),exportControls(true));
      const publication=publications.find(p=>p.id===state.publicationId);
      const frozen=await page('rows',{publication:true,tableId:selected.id,publicationId:publication.id});
      const columns=publication.definition.columns;
      box.append(E('h4',publication.title),E('p',publication.summary),E('p',publication.limitations,'se-muted'),
        table(columns.map(c=>c.label),frozen.items.map(row=>columns.map(c=>{
          const cell=row.cells.find(value=>value.columnId===c.id);
          return !cell?.present?'Field absent':c.format==='typed'?typedText(cell.value):show(cell.value);
        }))),pager(frozen,render),details('Complete frozen publication and all original selected records',publication));
      const compare=select([{value:'',label:'Choose an earlier publication to compare'},...publications.filter(p=>p.id!==publication.id).map(p=>({
        value:p.id,label:p.title+' · '+p.edition}))],d.againstPublicationId,'publication-compare-select');
      bind(compare,d,'againstPublicationId');box.append(field('Compare full publication editions',compare));
      for(const format of ['json','csv','md','html'])box.append(button('Download '+format.toUpperCase()+' comparison',()=>task(async()=>{
        if(!d.againstPublicationId)throw new Error('Choose the earlier publication.');
        await download('/publications/export',{tableId:selected.id,publicationId:publication.id,
          againstPublicationId:d.againstPublicationId,format},'publication-comparison.'+format);
      }),'publication-compare-'+format));
      const impacts=await all('impact',{publication:true,tableId:selected.id,publicationId:publication.id});
      for(const impact of impacts){
        const card=E('article',null,'se-impact'),reason=area(''),disposition=select([
          {value:'reviewed',label:'Reviewed'},{value:'needs_review',label:'Needs further review'},{value:'not_applicable',label:'Not applicable'}],'reviewed');
        card.append(E('h5',impact.kind),details('Complete publication impact',impact),
          field('Disposition',disposition),field('Reason',reason),requestButton('Save publication impact review','review-impact',
            ()=>({publicationId:publication.id,impactId:impact.id,fingerprint:impact.fingerprint,disposition:disposition.value,reason:reason.value}),
            {publication:true,name:'publication-impact-'+impact.id}));box.append(card);
      }
      const withdrawal=E('details'),reason=area('');withdrawal.append(E('summary','Withdraw this publication'),
        E('p','The original publication remains in history with this reason and its withdrawn status.'),
        field('Withdrawal reason',reason),requestButton('Record withdrawal','withdraw-publication',
          ()=>({publicationId:publication.id,expectedPublicationSha256:publication.sha256,reason:reason.value}),
          {publication:true,name:'publication-withdraw'}));box.append(withdrawal);
    }else box.append(empty('This table has no published edition yet.'));
    box.append(details('Publication states',overview.statuses));return box;
  }
  function setDossier(dossier){
    const workspace=getWorkspace?.();
    const next=dossier&&workspace?.workspaceId?{dossierId:dossier.id,workspaceId:workspace.workspaceId}:null;
    if(state.scope?.dossierId===next?.dossierId&&state.scope?.workspaceId===next?.workspaceId)return;
    queueSave();state.epoch++;state.scope=next;state.loaded=false;state.loading=false;state.autoAttemptKey=null;state.revision=null;
    state.forms=[];state.formEditions=[];state.resultSets=[];state.studies=[];state.occurrences=[];
    state.formId='';state.formEditionId='';state.resultSetId='';state.rowId='';state.tableId='';state.publicationId='';
    state.editor=null;state.editorName=null;state.dirty=false;state.pending=null;state.page=0;
    state.sourceValues.clear();state.sourceRequests.clear();body.replaceChildren();
    updateStatus();
  }
  function showPanel(value){
    state.shown=value;ensureLoaded();
  }
  return {
    setDossier,show:showPanel,updateBusy,
    hasUnsaved:()=>state.dirty||['prepared','response-unknown'].includes(state.pending?.state),
    async refresh(){await loadCurrent();},
    dispose(){queueSave();state.epoch++;drafts.close();root.replaceChildren();},
  };
}
