// MIT. Retained capture intake beside the original merchant source editor.
const make = (tag,text,cls) => {
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(cls)node.className=cls;
  return node;
};
const button = text => {const node=make('button',text);node.type='button';return node;};
const field = (title,type='text') => {
  const label=make('label',title), input=make('input');input.type=type;label.append(input);return {label,input};
};
function select(title,values) {
  const label=make('label',title), input=make('select');
  for(const [value,text] of values){const option=make('option',text);option.value=value;input.append(option);}
  label.append(input);return {label,input};
}
function sourceIdentity(text) {
  try {
    const value=JSON.parse(text)?.['x-starforge-har'];
    return value?.schema==='stellar.har-source.v1'?value:null;
  } catch {return null;}
}
function query(selected) {
  const result=new URLSearchParams({kind:selected.kind,id:selected.id});
  if(selected.revision)result.set('revision',selected.revision);
  return result.toString();
}

/** Keep commercial choices only for the same approved source or unchanged reviewed routes. */
export function mergeHarMerchantPlan({currentSource,currentPlan,prepared}) {
  const before=sourceIdentity(currentSource), after=sourceIdentity(prepared.specText);
  const same=Boolean(before && after && currentSource===prepared.specText);
  const previous=prepared.previous;
  const continuing=Boolean(before && previous &&
    before.sourceSha256===previous.previousSourceSha256 && before.reviewSha256===previous.previousReviewSha256);
  const carried=new Map((prepared.carry??[]).map(row=>[row.method+' '+row.path,row]));
  const saved=new Map((currentPlan.operations??[]).map(row=>[String(row.method).toUpperCase()+' '+row.path,row]));
  let preserved=0;
  const operations=prepared.operations.map(seed=>{
    const match=carried.get(seed.method+' '+seed.path);
    const old=saved.get(seed.method+' '+(continuing && match?match.previousPath:seed.path));
    if(!old || !same && !(continuing && match))return {...structuredClone(seed),amountAtomic:''};
    preserved++;
    const headers=new Map(Object.entries(old.headerEnv??{}).map(([name,value])=>[name.toLowerCase(),value]));
    for(const [name,value] of Object.entries(seed.headerEnv??{}))headers.set(name.toLowerCase(),value);
    return {...structuredClone(seed),...structuredClone(old),method:seed.method,path:seed.path,
      headerEnv:Object.fromEntries(headers),amountAtomic:old.amountAtomic??''};
  });
  const plan={...structuredClone(currentPlan),operations};
  if(plan.transports!==undefined) {
    const used=new Set(operations.map(row=>row.transport).filter(value=>value!==undefined));
    const profiles=Object.entries(plan.transports).filter(([alias])=>used.has(alias));
    if(profiles.length)plan.transports=Object.fromEntries(profiles);else delete plan.transports;
  }
  return {plan,preserved,needsPrice:operations.length-preserved};
}

export function createHarPanel({container,api,act,notice,token,onSource}) {
  let busy=false, selected=null, active=null, cursor='', history=[], next=null, reviewNext=null;
  const details=make('details');
  details.append(make('summary','Captured API sources'),
    make('p','Retain an original HAR capture, review the operations and use the approved source in this merchant. Later captures keep the selected review and its authored route decisions.','hint'));
  const activeLabel=make('p','','small wrap');
  const uploadArea=make('div',undefined,'fields');
  const original=field('Original HAR capture','file');original.input.accept='.har,.json,application/json';
  const title=field('Capture label');title.input.maxLength=160;title.input.placeholder='Provider and capture date';
  const edition=field('Use as the next capture edition','checkbox');edition.label.className='check wide';
  edition.label.replaceChildren(edition.input,make('span','Compare with the selected saved review'));
  const upload=button('Retain capture');
  uploadArea.append(original.label,title.label,edition.label,upload);
  details.append(activeLabel,make('h3','Retain a capture'),uploadArea,
    make('p','Original file limit: 128 MiB. Retained originals stay in the private output directory.','hint'));

  const controls=make('div',undefined,'inline'), reload=button('Refresh captures'),
    earlier=button('Earlier page'), more=button('More captures'), count=make('p','','small');
  controls.append(reload,earlier,more);
  const library=make('div',undefined,'project-list'), libraryPath=make('p','','hint wrap');
  details.append(make('h3','Retained captures and refresh packets'),controls,count,library,libraryPath);

  const selectionArea=make('div');selectionArea.hidden=true;
  const heading=make('h3'), sourceSummary=make('p','','small wrap'), reviewChoice=select('Saved decisions',[['','New draft']]);
  const moreReviews=button('More saved reviews'), revisionSummary=make('p','','hint'), comparisons=make('div');
  const reviewTools=make('div',undefined,'inline'), review=button('Download review page'), sourceDownload=button('Download approved OpenAPI');
  reviewTools.append(review,sourceDownload);
  const decisions=field('Completed reviewed decisions JSON','file');decisions.input.accept='.json,application/json';
  const save=button('Retain reviewed decisions'), use=button('Use approved source');
  const decisionTools=make('div',undefined,'inline');decisionTools.append(decisions.label,save,use);
  const receiving=make('details'), destination=field('Receiving directory on this host'), copy=button('Copy retained source');
  destination.input.placeholder='/private/receiving/provider-capture';destination.label.className='wide';
  const receivingResult=make('pre','','wrap');receivingResult.hidden=true;
  receiving.append(make('summary','Copy to a receiving workspace'),
    make('p','Choose a directory beneath an existing private parent. Reuse the same original receiving copy to retain later reviews. A refresh copy includes both source editions, its original comparison and all saved reviews.','hint'),
    destination.label,copy,receivingResult);
  selectionArea.append(heading,sourceSummary,reviewChoice.label,moreReviews,revisionSummary,comparisons,reviewTools,
    make('p','Open the downloaded HTML file, complete its source and route decisions, then download reviewed decisions. Return that JSON file here to save its immutable revision.','hint'),
    decisionTools,receiving);
  details.append(selectionArea);

  const adoption=make('details'), kind=select('Original workspace type',[['capture','HAR capture workspace'],['refresh','HAR refresh packet']]),
    directory=field('Original private directory on this host'), adoptionTitle=field('Retained label'), adopt=button('Adopt existing source');
  directory.input.placeholder='/private/existing-har-workspace';directory.label.className='wide';
  adoptionTitle.input.maxLength=160;
  const adoptionFields=make('div',undefined,'fields');adoptionFields.append(kind.label,adoptionTitle.label,directory.label,adopt);
  adoption.append(make('summary','Adopt an existing private HAR workspace'),
    make('p','Use the complete directory created by the original HAR commands or a receiving copy. Re-adoption retains additional immutable reviews for that same source.','hint'),adoptionFields);
  details.append(adoption);container.append(details);

  function available(value=busy) {
    busy=value;
    for(const control of details.querySelectorAll('input,select,textarea,button'))control.disabled=busy;
    earlier.disabled=busy||!history.length;more.disabled=busy||!next;
    upload.disabled=busy||!original.input.files.length||edition.input.checked&&!selected?.revision;
    upload.textContent=edition.input.checked?'Prepare next capture edition':'Retain capture';
    review.disabled=busy||!selected;
    save.disabled=busy||!selected||!decisions.input.files.length;
    use.disabled=busy||!selected?.revision;
    sourceDownload.disabled=busy||!selected?.revision;
    moreReviews.disabled=busy||!reviewNext;
    copy.disabled=busy||!selected||!destination.input.value.trim();
    adopt.disabled=busy||!directory.input.value.trim()||!adoptionTitle.input.value.trim();
    reviewChoice.input.disabled=busy||!selected;
  }
  async function responseValue(response) {
    const value=await response.json();
    if(!response.ok)throw new Error(value.error??'Capture operation failed');
    return value;
  }
  async function fileUpload(path,file,limit) {
    if(!file||file.size<1||file.size>limit)throw new Error('Choose a nonempty file within the displayed limit');
    return responseValue(await fetch('/api/har/'+path,{method:'POST',
      headers:{'x-workspace-token':token,'content-type':'application/octet-stream'},body:file}));
  }
  async function download(path,body,limit,fallback) {
    const response=await fetch('/api/har/'+path,{method:'POST',
      headers:{'x-workspace-token':token,'content-type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok){await responseValue(response);return;}
    const blob=await response.blob();
    if(blob.size>limit)throw new Error('Download exceeds its original source limit');
    const match=/filename="([A-Za-z0-9_.-]+)"/.exec(response.headers.get('content-disposition')??'');
    const url=URL.createObjectURL(blob), link=make('a');
    link.href=url;link.download=match?.[1]??fallback;link.hidden=true;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function addReviews(result,reset=false) {
    if(reset)reviewChoice.input.replaceChildren();
    if(reset){const draft=make('option',selected?.kind==='refresh'?'Original refresh draft':'New capture draft');draft.value='';reviewChoice.input.append(draft);}
    const existing=new Set([...reviewChoice.input.options].map(option=>option.value));
    for(const row of result.reviews)if(!existing.has(row.revision)) {
      const option=make('option',row.title+' · '+row.operations.length+' routes · '+row.revision.slice(0,12)+
        (row.usable?'':' · different refresh lineage'));
      option.value=row.revision;option.disabled=!row.usable;reviewChoice.input.append(option);
    }
    if(selected?.revision&&!existing.has(selected.revision)&&![...reviewChoice.input.options].some(option=>option.value===selected.revision)) {
      const option=make('option','Selected saved review · '+selected.revision.slice(0,12));
      option.value=selected.revision;reviewChoice.input.append(option);
    }
    reviewChoice.input.value=selected?.revision??'';
    reviewNext=result.next;
    revisionSummary.textContent=result.totalReviews+' saved review'+(result.totalReviews===1?'':'s')+
      (selected?.revision?' · Selected: '+selected.revision:' · Select a saved review to use this source or compare a later capture.');
  }
  function renderComparison(info) {
    comparisons.replaceChildren();
    if(!info.summary)return;
    const value=info.summary;
    comparisons.append(make('p',value.carried+' unchanged · '+value.changed+' changed · '+value.notObserved+
      ' not observed · '+value.returned+' returned · '+value.unselectedGroups+' unselected groups.','small'));
    const rows=info.changes??[];
    if(rows.length) {
      const table=make('table'), head=make('tr'), body=make('tbody'), thead=make('thead');
      for(const title of ['Operation','Capture comparison','Review sections'])head.append(make('th',title));
      thead.append(head);table.append(thead,body);
      for(const row of rows.slice(0,100)) {
        const tr=make('tr');
        for(const text of [row.method+' '+row.path+' · '+row.operationId,row.status,row.sections.join(', ')||'No changed observations'])
          tr.append(make('td',text));
        body.append(tr);
      }
      const wrap=make('div',undefined,'table-wrap');wrap.tabIndex=0;wrap.setAttribute('aria-label','Capture edition comparison');wrap.append(table);comparisons.append(wrap);
      if(rows.length>100)comparisons.append(make('p','Showing the first 100 retained operations. The downloaded review contains the full comparison.','hint'));
    }
    if(info.ambiguousGroups)comparisons.append(make('p',info.ambiguousGroups+' groups need explicit operation selection in the review.','hint'));
  }
  function present(info,chosen=info.selection) {
    selected={kind:chosen.kind,id:chosen.id,...(chosen.revision?{revision:chosen.revision}:{})};
    selectionArea.hidden=false;details.open=true;
    heading.textContent=info.label;
    sourceSummary.textContent=info.totalEntries+' captured entries · '+info.groups+' groups · '+info.rejectedEntries+
      ' rejected entries · '+info.sourceBytes+' original bytes\nSource SHA256: '+info.sourceSha256+'\nPrivate source: '+info.directory;
    addReviews(info,true);renderComparison(info);receivingResult.hidden=true;available();
  }
  async function open(selectedValue) {
    const info=await api('har/inspect?'+query(selectedValue));
    present(info,selectedValue);
  }
  async function list() {
    const result=await api('har/library?'+new URLSearchParams({after:cursor,limit:'25'}));
    next=result.next;library.replaceChildren();
    count.textContent=result.total+' retained capture'+(result.total===1?'':'s')+' and refresh packets';
    libraryPath.textContent='Private capture library: '+result.root;
    for(const row of result.items) {
      const item=button('');item.className='project';
      item.append(make('strong',row.label),make('span',row.selection.kind+' · '+row.selection.id.slice(0,12)+
        (row.available?' · '+row.totalEntries+' entries · '+row.groups+' groups':' · '+row.error)));
      item.addEventListener('click',()=>act(()=>open(row.selection)));library.append(item);
    }
    if(!result.items.length)library.append(make('p','Retain a capture or adopt an existing original workspace.','small'));
    available();
  }

  original.input.addEventListener('change',()=>{
    if(!title.input.value.trim()&&original.input.files[0])title.input.value=original.input.files[0].name.slice(0,160);
    available();
  });
  edition.input.addEventListener('change',()=>available());
  for(const control of [decisions.input,destination.input,directory.input,adoptionTitle.input])control.addEventListener('input',()=>available());
  upload.addEventListener('click',()=>act(async()=>{
    const file=original.input.files[0];
    const parameters=new URLSearchParams({label:title.input.value.trim()});
    if(edition.input.checked) {
      if(!selected?.revision)throw new Error('Select the previous saved review first');
      parameters.set('previousKind',selected.kind);parameters.set('previousId',selected.id);parameters.set('previousRevision',selected.revision);
    }
    const result=await fileUpload('upload?'+parameters,file,128*1024*1024);
    present(result);original.input.value='';edition.input.checked=false;await list();
    notice(result.reused?'Reopened the same retained source edition.':'Capture retained. Download its review page to select and review the source operations.');
  }));
  reload.addEventListener('click',()=>act(list));
  earlier.addEventListener('click',()=>act(async()=>{cursor=history.pop()??'';await list();}));
  more.addEventListener('click',()=>act(async()=>{if(!next)return;history.push(cursor);cursor=next;await list();}));
  reviewChoice.input.addEventListener('change',()=>{
    if(!selected)return;
    selected={kind:selected.kind,id:selected.id,...(reviewChoice.input.value?{revision:reviewChoice.input.value}:{})};
    revisionSummary.textContent=selected.revision?'Selected immutable review: '+selected.revision:'The next download opens the original draft for this source.';
    available();
  });
  moreReviews.addEventListener('click',()=>act(async()=>{
    if(!reviewNext||!selected)return;
    const result=await api('har/inspect?'+query(selected)+'&after='+reviewNext);
    addReviews(result);available();
  }));
  review.addEventListener('click',()=>act(async()=>{
    await download('reviewer',{selection:selected},32*1024*1024,'har-review.html');
    notice('Review page downloaded. Open it locally, complete the decisions, then return its reviewed JSON here.');
  }));
  sourceDownload.addEventListener('click',()=>act(()=>download('export',{selection:selected},4*1024*1024,'har-openapi.json')));
  save.addEventListener('click',()=>act(async()=>{
    const result=await fileUpload('decisions?'+query(selected),decisions.input.files[0],4*1024*1024);
    await open(result.selection);decisions.input.value='';
    notice('Retained immutable review '+result.revision+'. Use this approved source or compare its next capture edition.');
  }));
  use.addEventListener('click',()=>act(async()=>{
    const prepared=await api('har/source?'+query(selected));
    if(prepared.operations.length>64)throw new Error('Save a capture review with at most 64 operations for the original merchant package');
    const result=await onSource(prepared);
    notice('Approved source loaded. '+(result?.preserved??0)+' unchanged route settings retained; '+
      (result?.needsPrice??prepared.operations.length)+' routes need a price. Review the merchant terms, validate and save.');
  }));
  copy.addEventListener('click',()=>act(async()=>{
    const result=await api('har/copy',{selection:selected,destination:destination.input.value.trim()});
    receivingResult.textContent='Retained '+result.receivingKind+' copied to:\n'+result.destination+
      '\n\nAdopt that complete directory in the receiving merchant workspace.';
    receivingResult.hidden=false;
    notice('Receiving source copied with its immutable reviews.');
  }));
  adopt.addEventListener('click',()=>act(async()=>{
    const result=await api('har/adopt',{kind:kind.input.value,directory:directory.input.value.trim(),label:adoptionTitle.input.value.trim()});
    present(result);await list();notice('Original workspace adopted with its retained reviews. Select the review to continue.');
  }));
  available();
  return {
    refresh:available,
    list,
    async reopen(text,known) {
      const identity=sourceIdentity(text);
      active=known===undefined?(identity?(await api('har/locate',{specText:text})).capturedSource:null):known;
      activeLabel.textContent=active?'Merchant source uses retained '+active.kind+' '+active.id.slice(0,12)+' · saved review '+active.revision+'.'
        :identity?'This merchant source retains capture '+identity.sourceSha256+' and review '+identity.reviewSha256+
          '. Adopt its complete private source workspace to continue capture editions here.':'';
      if(active)await open(active);
      return active;
    },
  };
}
