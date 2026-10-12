import {mountPublisherIntake} from './browser.mjs';

const base='/api/extensions/publisher';
const hashPattern=/^[a-f0-9]{64}$/;
function identity(value,field) {
  const id=typeof value==='string'?value:value?.[field];
  if(!hashPattern.test(id||''))throw new Error('Reopen the original saved publisher record.');
  return id;
}
function compact(action,payload={}) {
  if(action==='review')return {preview:{previewHash:identity(payload.preview,'previewHash')},review:payload.review};
  if(action==='cohort')return {edition:{editionHash:identity(payload.edition,'editionHash')},selection:payload.selection};
  if(action==='compare')return {previous:{editionHash:identity(payload.previous,'editionHash')},current:{editionHash:identity(payload.current,'editionHash')}};
  if(action==='csv') {
    const value=payload.edition,kind=value?.kind==='cohort'?'cohort':'reviewed';
    return {edition:kind==='cohort'?{kind,cohortHash:identity(value,'cohortHash')}:{kind,editionHash:identity(value,'editionHash')}};
  }
  return payload;
}
function node(tag,text) {
  const el=document.createElement(tag);
  if(text!==undefined)el.textContent=text;
  return el;
}

/**
 * F11 original host bridge. request is its JSON HTTP function; mutate retains
 * the original operation ID/revision and returns {result,revision}. refresh(false)
 * updates parent state without destroying this active editor. onSource receives
 * {document,native,recordIds,firstRecordId} for original pricing navigation.
 */
export function mountPublisherBridge(element,{request,mutate,refresh,onSource,note}={}) {
  if(!(element instanceof Element)||typeof request!=='function'||typeof mutate!=='function')
    throw new TypeError('Publisher bridge requires the original element, request and mutate.');
  let disposed=false,inventory=null,inventoryRequest=null,inventoryGeneration=0,controller=null;
  const styleUrl=new URL('./style.css',import.meta.url).href;
  if(!Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(link=>link.href===styleUrl)) {
    const stylesheet=node('link');stylesheet.rel='stylesheet';stylesheet.href=styleUrl;document.head.append(stylesheet);
  }
  const host=document.createElement('div'),saved=node('section'),content=node('div'),status=node('p');
  saved.className='panel';
  saved.append(node('h3','Reopen saved publisher work'));
  const previewLabel=node('label','Source preview'),previewSelect=node('select');
  const cohortLabel=node('label','Peer cohort'),cohortSelect=node('select');
  const previewButton=node('button','Reopen source preview'),cohortButton=node('button','Reopen peer cohort');
  const reload=node('button','Refresh saved work');
  for(const b of [previewButton,cohortButton,reload])b.type='button';
  previewLabel.append(previewSelect);cohortLabel.append(cohortSelect);
  saved.append(previewLabel,previewButton,cohortLabel,cohortButton,reload,status);
  host.append(saved,content);element.replaceChildren(host);
  function statusText(message,error=false) {
    if(disposed)return;
    status.textContent=message;status.setAttribute('role',error?'alert':'status');
    if(error&&typeof note==='function')note(message,true);
  }
  function fill(select,items,emptyText) {
    const previous=select.value;
    select.replaceChildren();
    const empty=node('option',emptyText);empty.value='';select.append(empty);
    for(const item of items||[]) {
      const source=item.source||{};
      const option=node('option',[item.label||source.survey_name||source.survey_id,source.edition_id,
        source.publisher_name||source.publisher_id,String(item.rows||0)+' rows'].filter(Boolean).join(' · '));
      option.value=item.id;select.append(option);
    }
    if(Array.from(select.options).some(o=>o.value===previous))select.value=previous;
  }
  async function loadInventory() {
    if(inventoryRequest?.generation===inventoryGeneration)return inventoryRequest.promise;
    const generation=inventoryGeneration,pending={generation,promise:null};
    inventoryRequest=pending;
    pending.promise=request(base+'/state').then(value=>{
      if(generation===inventoryGeneration) {
        inventory=value;
        if(!disposed){fill(previewSelect,value.previews,'Select a retained source preview');
          fill(cohortSelect,value.cohorts,'Select a retained peer cohort');}
      }
      return value;
    }).finally(()=>{if(inventoryRequest===pending)inventoryRequest=null;});
    return pending.promise;
  }
  async function loadDocument(kind,id) {
    return request(base+'/document/'+kind+'/'+encodeURIComponent(identity(id,'id')));
  }
  async function loadEditions() {
    const state=await loadInventory(),items=state.editions||[],result=new Array(items.length);
    let next=0;
    await Promise.all(Array.from({length:Math.min(2,items.length)},async()=>{
      while(next<items.length) {const index=next++;result[index]=await loadDocument('edition',items[index].id);}
    }));
    return result;
  }
  async function change(action,payload) {
    if(disposed)throw new Error('Reopen Sources to continue this publisher operation.');
    const response=await mutate(base+'/'+encodeURIComponent(action),compact(action,payload));
    if(!response||!Object.prototype.hasOwnProperty.call(response,'result'))
      throw new Error('The original workspace did not return the publisher outcome. Resume its saved request.');
    inventoryGeneration++;inventory=null;
    if(typeof refresh==='function')await refresh(false);
    await loadInventory();
    return response.result;
  }
  async function selectOriginal(value,{navigate=false}={}) {
    if(typeof onSource!=='function')return;
    const kind=value.kind==='cohort'?'cohort':'edition';
    const id=identity(value,kind==='cohort'?'cohortHash':'editionHash');
    const native=await loadDocument(kind+'-records',id);
    const recordIds=Array.isArray(native.record_ids)?native.record_ids:Object.values(native.record_ids||{});
    if(!disposed)await onSource({document:value,native,recordIds,firstRecordId:recordIds[0]||null,navigate});
  }
  async function run(button,fn) {
    if(disposed)return;
    button.disabled=true;statusText('Opening the original saved work…');
    try{await fn();statusText('Original saved work reopened.');}
    catch(error){statusText(error.message||String(error),true);}
    finally{if(!disposed)button.disabled=false;}
  }
  async function openPreview(id) {
    id=identity(id,'previewHash');
    const value=await loadDocument('preview',id);
    const response=await fetch(base+'/download/original-preview/'+encodeURIComponent(id),{cache:'no-store'});
    if(!response.ok)throw new Error('The original source file could not be reopened.');
    const csv=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await response.arrayBuffer());
    if(!disposed)controller.openPreview(value,{csv});
    return value;
  }
  async function openCohort(value) {
    const complete=typeof value==='string'?await loadDocument('cohort',value):value;
    const edition=await loadDocument('edition',identity(complete,'editionHash'));
    if(!disposed){controller.openEdition(edition);controller.openCohort(complete);}
    return complete;
  }
  previewButton.addEventListener('click',()=>run(previewButton,async()=>{
    if(!previewSelect.value)throw new Error('Select a retained source preview.');
    await openPreview(previewSelect.value);
  }));
  cohortButton.addEventListener('click',()=>run(cohortButton,async()=>{
    if(!cohortSelect.value)throw new Error('Select a retained peer cohort.');
    await openCohort(cohortSelect.value);
  }));
  reload.addEventListener('click',()=>run(reload,()=>controller.refresh()));
  controller=mountPublisherIntake(content,{request:change,listEditions:loadEditions,onEdition:selectOriginal});
  const ready=loadInventory();
  ready.catch(error=>statusText(error.message||String(error),true));
  return {
    ready,
    async refresh(){if(!disposed){if(typeof refresh==='function')await refresh(false);await controller.refresh();}},
    async openEdition(value){const complete=typeof value==='string'?await loadDocument('edition',value):value;
      if(!disposed)controller.openEdition(complete);return complete;},
    openPreview,openCohort,
    destroy(){if(disposed)return;disposed=true;controller.destroy();host.remove();}
  };
}
