// MIT. Mount the original CSP-pinned HAR review in the maintained merchant console.
import { mountHarReview } from './ui.js';

const make=(document,tag,text,cls)=>{
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;
};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const checkedSelection=value=>{
  if(!plain(value)||!['capture','refresh'].includes(value.kind)||!/^[a-f0-9]{64}$/.test(value.id)||
      value.revision!==undefined&&!/^[a-f0-9]{64}$/.test(value.revision))
    throw new Error('Open the original retained capture and review.');
  return {kind:value.kind,id:value.id,...(value.revision?{revision:value.revision}:{})};
};
const contextOf=review=>review['x-har-refresh']?Object.fromEntries(
  ['schema','previousSourceSha256','previousReviewSha256','candidateSourceSha256'].map(key=>[key,review['x-har-refresh'][key]])):null;

/**
 * page is the complete HTML returned by the original authenticated /api/har/reviewer.
 * The original server/model supply all observations, comparisons, controls and validation.
 * run joins the merchant console's existing busy/drain lifecycle; save uses its native writer.
 */
export async function createHarReviewDesk({container,page,selection,sourceSha256,workspace,run,save,notice}={}) {
  if(typeof page!=='string'||!page||page.length>32*1024*1024||typeof workspace!=='string'||!workspace)
    throw new Error('Load the complete original reviewer from this private workspace.');
  const selected=checkedSelection(selection),document=container.ownerDocument;
  const parsed=new DOMParser().parseFromString(page,'text/html');
  const embedded=parsed.querySelector('script#source-data[type="application/json"]');
  let initial;try{initial=JSON.parse(embedded?.textContent??'');}catch{}
  if(!plain(initial)||!plain(initial.inventory)||!plain(initial.review)||
      initial.inventory.sourceSha256!==sourceSha256||initial.review.sourceSha256!==sourceSha256||
      selected.kind==='capture'&&selected.id!==sourceSha256)
    throw new Error('The returned review does not match this retained source.');
  if(selected.kind==='refresh'&&initial.review['x-har-refresh']?.candidateSourceSha256!==sourceSha256)
    throw new Error('The original refresh lineage is missing from its review.');
  const header=parsed.querySelector('header'),main=parsed.querySelector('main');
  if(!header||!main)throw new Error('The installed original reviewer is incomplete.');

  const host=make(document,'div'),shadow=host.attachShadow({mode:'open'}),sheet=make(document,'link');
  sheet.rel='stylesheet';sheet.href=new URL('./review.css',import.meta.url).href;
  const loaded=new Promise((yes,no)=>{sheet.onload=yes;sheet.onerror=()=>no(new Error('The installed HAR review stylesheet could not be loaded.'));});
  shadow.append(sheet);container.replaceChildren(host);
  try{await loaded;}catch(error){host.remove();throw error;}
  const shell=make(document,'fieldset',undefined,'har-review-shell');
  shell.append(document.importNode(header,true),document.importNode(main,true));
  const recovery=make(document,'section',undefined,'har-review-recovery'),pendingList=make(document,'div');
  recovery.append(make(document,'h2','Retained save requests'),
    make(document,'p','An interrupted save resumes the exact reviewed decisions and source selection. The native writer reopens the same immutable revision.'),pendingList);
  recovery.hidden=true;
  const close=make(document,'button','Close review','har-review-close');close.type='button';
  shadow.append(close,recovery,shell);
  const prefix='stellar.har.console.'+encodeURIComponent(JSON.stringify({workspace,kind:selected.kind,id:selected.id}))+'.';
  const draftKey=prefix+'draft.'+(selected.revision||'original');
  const pendingPrefix=prefix+'pending.';
  let closed=false,storageWarning=false,editor,working=false,externalBusy=false;
  function warnStorage() {
    if(storageWarning)return;storageWarning=true;
    notice?.('This browser could not retain the review draft. Download the draft or reviewed decisions to keep a local copy.',true);
  }
  function storageRead(key) {
    try{const value=localStorage.getItem(key);return value===null?null:JSON.parse(value);}
    catch{return null;}
  }
  function storageWrite(key,value) {
    try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{warnStorage();return false;}
  }
  function storageRemove(key) {try{localStorage.removeItem(key);}catch{warnStorage();}}
  function boundReview(review) {
    return plain(review)&&review.schema===initial.review.schema&&Array.isArray(review.operations)&&review.operations.every(plain)&&
      review.sourceSha256===sourceSha256&&
      (!contextOf(initial.review)||same(contextOf(review),contextOf(initial.review)));
  }
  function requests() {
    const result=[];
    try {
      for(let i=0;i<localStorage.length;i++) {
        const key=localStorage.key(i);if(!key?.startsWith(pendingPrefix))continue;
        const value=storageRead(key);
        if(value?.schema!=='stellar.har.pending-review.v1'||!boundReview(value.review)||
            value.selection?.kind!==selected.kind||value.selection?.id!==selected.id||typeof value.useSource!=='boolean'||
            typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))continue;
        try{checkedSelection(value.selection);}catch{continue;}
        result.push({key,value});
      }
    }catch{warnStorage();}
    return result.sort((a,b)=>a.value.createdAt.localeCompare(b.value.createdAt));
  }
  function download(name,value) {
    const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=make(document,'a');link.href=url;link.download=name;
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function available() {
    shell.disabled=working||externalBusy;close.disabled=working||externalBusy;
    for(const control of pendingList.querySelectorAll('button'))control.disabled=working||externalBusy;
  }
  function presentRequests() {
    if(closed)return;
    const values=requests();pendingList.replaceChildren();recovery.hidden=values.length===0;
    for(const {key,value}of values) {
      const row=make(document,'div',undefined,'har-review-pending');
      const summary=make(document,'p',value.review.operations.filter(operation=>operation.enabled).length+
        ' reviewed routes · '+value.createdAt+' · '+(value.selection.revision?'based on '+value.selection.revision.slice(0,12):'original draft')+
        (value.useSource?' · use in merchant':' · retain review'));
      const controls=make(document,'div',undefined,'toolbar'),resume=make(document,'button','Resume saved request'),
        exportRequest=make(document,'button','Download original decisions');
      resume.type=exportRequest.type='button';
      resume.addEventListener('click',()=>commit(value,{key}));
      exportRequest.addEventListener('click',()=>download('har-pending-decisions.json',value.review));
      controls.append(resume,exportRequest);row.append(summary,controls);pendingList.append(row);
    }
    available();
  }
  async function commit(request,{key}={}) {
    if(working||externalBusy)return;
    working=true;available();
    try {
      if(!key) {
        const prior=requests().find(row=>same(row.value.selection,request.selection)&&
          row.value.useSource===request.useSource&&same(row.value.review,request.review));
        if(prior){key=prior.key;request=prior.value;}
        else {
          key=pendingPrefix+crypto.randomUUID();
          if(!storageWrite(key,request))download('har-pending-decisions.json',request.review);
        }
      }
      const result=await run(()=>save(copy(request.selection),copy(request.review),{useSource:request.useSource}));
      if(!result?.selection?.revision)throw new Error('The original writer has not returned the saved review. Resume this same request.');
      storageRemove(key);
      if(!closed) {
        presentRequests();
        editor.message('Retained immutable review '+result.selection.revision+'.');
      }
      return result;
    }catch(error) {
      if(!closed){presentRequests();editor?.message(error.message,true);}
      notice?.(error.message,true);
      return undefined;
    }finally{working=false;available();}
  }
  editor=mountHarReview({root:shadow,initial,
    readDraft(){
      const saved=storageRead(draftKey);
      if(saved?.schema!=='stellar.har.browser-draft.v1'||!same(saved.selection,selected)||!boundReview(saved.review))
        return null;
      return saved.review;
    },
    writeDraft(review){
      storageWrite(draftKey,{schema:'stellar.har.browser-draft.v1',selection:copy(selected),sourceSha256,
        updatedAt:new Date().toISOString(),review});
    },
    onSave(review,{useSource}){
      if(useSource&&review.operations.filter(operation=>operation.enabled).length>64)
        throw new Error('Select at most 64 reviewed operations for the original merchant package. Save the full review separately if needed.');
      return commit({schema:'stellar.har.pending-review.v1',selection:copy(selected),sourceSha256,
        createdAt:new Date().toISOString(),review,useSource});
    },
  });
  function dispose() {
    if(closed)return;closed=true;host.remove();
    globalThis.removeEventListener('storage',onStorage);
  }
  function onStorage(event){if(event.key?.startsWith(pendingPrefix))presentRequests();}
  globalThis.addEventListener('storage',onStorage);
  close.addEventListener('click',()=>{
    const draft=editor.review();
    if(storageWarning)download('har-review-draft.json',draft);
    dispose();notice?.(storageWarning?'Review draft downloaded.':'Review closed. Its browser draft is retained for the same source selection.');
  });
  presentRequests();
  const draft=storageRead(draftKey);
  if(draft?.schema==='stellar.har.browser-draft.v1'&&same(draft.selection,selected)&&boundReview(draft.review))
    editor.message('A browser draft is available for this source selection. Choose Restore browser draft to continue it.');
  return Object.freeze({
    setBusy(value){externalBusy=Boolean(value);available();},
    close:dispose,
    selection:copy(selected),
    sourceSha256,
  });
}
