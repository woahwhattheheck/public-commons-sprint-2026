// MIT. Review and capture complete edited companion trees in the original Applications desk.
const node=(tag,text)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;return value;};
const button=(text,action)=>{const value=node('button',text);value.type='button';value.addEventListener('click',action);return value;};
const copy=value=>JSON.parse(JSON.stringify(value));
export function createApplicationInputSetEditionsView({root,api,getWorkspaceId,readSaved,saveSaved,onError,onMessage,openSet,getSourceChoice}) {
 let workspace=getWorkspaceId(),epoch=0,busy=false,selectionRequestId=null,review=null,offset=0,rowsOffset=0,refreshVersion=0;
 const heading=node('h3','Edited source editions'),intro=node('p','Review an entire working folder and save its current files as a reusable source edition. Earlier originals and working folders remain available.');
 const name=node('input');name.maxLength=180;
 const nameLabel=node('label','New source edition name');nameLabel.append(name);
 const refreshReview=button('Review current working files',()=>perform(readReview));
 const save=button('Save reviewed source edition',()=>perform(capture));
 const resume=button('Continue retained edition capture',()=>perform(resumeCapture));
 const archive=button('Retain pending request and review another edition',()=>{
   const value=pending();if(!value)return;
   const prior=readSaved('input-set-edition-history',workspace)??[];
   if(!Array.isArray(prior)||!saveSaved('input-set-edition-history',prior.some(x=>x.requestId===value.requestId)?prior:[...prior,value],workspace))
     {onError(Error('The complete earlier request could not be retained. Download it before continuing.'));return;}
   if(!saveSaved('input-set-edition-capture',null,workspace)){onError(Error('The original pending request remains retained.'));return;}
   status.textContent='The earlier complete request remains in browser history and its native capture history. Review the current working files for another edition.';
   enabled();void refresh();
 });
 const downloadPending=button('Download retained capture request',()=>{const value=pending();if(value)download(value,'source-capture-request-'+value.requestId+'.json');});
 const status=node('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const summary=node('div'),details=node('div'),history=node('div'),received=node('div');
 const unchanged=node('input');unchanged.type='checkbox';
 const unchangedLabel=node('label','Include unchanged members');unchangedLabel.prepend(unchanged);
 const previous=button('Previous members',()=>{rowsOffset=Math.max(0,rowsOffset-50);renderReview();});
 const next=button('Next members',()=>{rowsOffset+=50;renderReview();});
 const page=node('span');
 const back=button('Previous editions',()=>{offset=Math.max(0,offset-20);void refresh();});
 const more=button('Next editions',()=>{offset+=20;void refresh();});
 const controls=node('div');controls.className='actions';controls.append(refreshReview,save,resume,downloadPending,archive);
 const pagination=node('div');pagination.className='actions';pagination.append(previous,next,page);
 const historyPages=node('div');historyPages.className='actions';historyPages.append(back,more);
 root.replaceChildren(heading,intro,nameLabel,controls,status,summary,unchangedLabel,details,pagination,
   node('h4','Saved and interrupted editions'),history,historyPages,node('h4','Received edition handoffs'),received);
 const scope=()=>({workspace,epoch});
 const current=value=>value.epoch===epoch&&value.workspace===workspace&&workspace===getWorkspaceId();
 const pending=()=>readSaved('input-set-edition-capture',workspace);
 function enabled(){name.disabled=busy;refreshReview.disabled=busy||!selectionRequestId;
   save.disabled=busy||!review;resume.disabled=archive.disabled=downloadPending.disabled=busy;
   resume.hidden=archive.hidden=downloadPending.hidden=!pending();}
 function download(value,label){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
   const a=node('a');a.href=url;a.download=label;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function perform(work) {
   if(busy)return;const own=scope();busy=true;enabled();
   try{await work();}catch(error){if(current(own)){status.textContent=error.message;onError(error);}}
   finally{if(current(own)){busy=false;enabled();await refresh();}}
 }
 function renderReview() {
   summary.replaceChildren();details.replaceChildren();
   const rows=(review?.changes??[]).filter(item=>unchanged.checked||item.change!=='UNCHANGED');
   rowsOffset=Math.min(rowsOffset,Math.max(0,Math.floor((rows.length-1)/50)*50));
   if(review) {
     const counts={ADDED:0,REMOVED:0,CHANGED:0,UNCHANGED:0};for(const row of review.changes)counts[row.change]++;
     summary.append(node('p',review.manifest.files.length+' files · '+review.manifest.files.reduce((sum,f)=>sum+f.bytes,0)+' bytes'),
       node('p',counts.ADDED+' added · '+counts.REMOVED+' removed · '+counts.CHANGED+' changed · '+counts.UNCHANGED+' unchanged members'),
       node('p','Original source: '+review.parentSetId),
       button('Download complete comparison',()=>download(review,'source-edition-review-'+review.reviewSha256+'.json')));
     const table=node('table'),thead=node('thead'),head=node('tr'),body=node('tbody');
     for(const title of ['Member','Change','Original bytes','Current bytes'])head.append(node('th',title));
     thead.append(head);table.append(thead,body);
     for(const row of rows.slice(rowsOffset,rowsOffset+50)) {
       const tr=node('tr');tr.append(node('td',row.path+(row.type==='directory'?'/':'')),node('td',row.change),
         node('td',row.before?.bytes??'—'),node('td',row.after?.bytes??'—'));body.append(tr);
     }
     details.append(table);
   }
   previous.disabled=rowsOffset===0;next.disabled=rowsOffset+50>=rows.length;
   page.textContent=rows.length?'Members '+(rowsOffset+1)+'–'+Math.min(rowsOffset+50,rows.length)+' of '+rows.length:'No changed members';
   enabled();
 }
 async function readReview() {
   if(!selectionRequestId)throw Error('Choose a retained working set to review.');
   const own=scope(),selected=selectionRequestId,label=name.value.trim();
   const value=await api('/api/application-input-set-editions/review',{selectionRequestId:selected,...(label?{name:label}:{})});
   if(!current(own)||selected!==selectionRequestId)return;
   review=value;name.value=value.manifest.name;rowsOffset=0;renderReview();
   status.textContent='Review the complete changes, then save this exact source edition. A later file change requires a fresh review.';
 }
 async function continueRequest(request) {
   const own=scope(),sourceChoice=getSourceChoice();
   const result=await api('/api/application-input-set-editions/capture',request);
   if(!current(own))return;
   if(pending()?.requestId===request.requestId)saveSaved('input-set-edition-capture',null,workspace);
   status.textContent='Source edition saved. It can be selected through the normal application review; the earlier working folder is retained.';
   onMessage(status.textContent);
   if(sourceChoice===getSourceChoice())await openSet(result.setId);
 }
 async function capture() {
   if(!review)throw Error('Review the complete current working folder first.');
   const previous=pending();
   if(previous&&previous.review.reviewSha256!==review.reviewSha256)
     throw Error('Continue or download the retained capture before starting a different edition. Its original request is kept in this browser.');
   const request=previous??{requestId:crypto.randomUUID(),review:copy(review)};
   if(!saveSaved('input-set-edition-capture',request,workspace))
     throw Error('The complete capture request could not be retained in this browser. Download the comparison and continue the same capture through the CLI.');
   await continueRequest(request);
 }
 async function resumeCapture() {
   const request=pending();if(!request)throw Error('No capture request is retained in this workspace.');
   await continueRequest(request);
 }
 async function refresh() {
   if(workspace!==getWorkspaceId())reset();
   const own=scope(),selected=selectionRequestId,position=offset,version=++refreshVersion;
   try {
     const result=await api('/api/application-input-set-editions?'+new URLSearchParams({offset,limit:20,
       ...(selected?{selectionRequestId:selected}:{})}));
     if(!current(own)||selected!==selectionRequestId||position!==offset||version!==refreshVersion)return;
     const local=readSaved('input-set-edition-history',workspace)??[];
     const localRows=(Array.isArray(local)?local:[]).filter(row=>!result.items.some(item=>item.requestId===row.requestId)).map(request=>{
       const row=node('article');row.className='operation';row.append(node('h4',request.review.manifest.name),
         node('p','Retained earlier browser request · '+request.requestId),
         button('Download earlier request',()=>download(request,'source-capture-request-'+request.requestId+'.json')),
         button('Continue earlier capture',()=>perform(async()=>{
           if(pending()&&pending().requestId!==request.requestId)throw Error('Retain the current pending request in history first.');
           if(!saveSaved('input-set-edition-capture',request,workspace))throw Error('The original request could not be retained.');
           await continueRequest(request);
         })));
       return row;
     });
     history.replaceChildren(...localRows,...result.items.map(item=>{
       const article=node('article');article.className='operation';article.append(node('h4',item.name),
         node('p',item.phase+' · '+item.files+' files · '+item.changes+' changed members'),node('code',item.requestId));
       if(item.phase==='CAPTURED')article.append(button('Open saved source edition',()=>perform(()=>openSet(item.setId))));
       else article.append(button('Continue exact capture',()=>perform(async()=>{
         const chosen=scope(),saved=await api('/api/application-input-set-editions/read?'+new URLSearchParams({requestId:item.requestId}));
         if(!current(chosen))return;
         const request={requestId:item.requestId,review:saved.intent.review};
         if(pending()&&pending().requestId!==request.requestId)throw Error('Retain the current pending request in history first.');
         if(!saveSaved('input-set-edition-capture',request,workspace))throw Error('Retain the exact capture request before continuing.');
         await continueRequest(request);
       })));
       article.append(button('Download complete edition record',()=>perform(async()=>{
         const chosen=scope(),record=await api('/api/application-input-set-editions/read?'+new URLSearchParams({requestId:item.requestId}));
         if(current(chosen))download(record,'source-edition-'+item.requestId+'.json');
       })));return article;
     }));
     received.replaceChildren(...result.received.items.map(item=>{
       const article=node('article');article.className='operation';article.append(node('h4',item.name),
         node('p',item.phase+' · original workspace '+item.originWorkspaceId));
       if(item.phase==='RECEIVED')article.append(button('Open received source edition',()=>perform(()=>openSet(item.setId))));
       article.append(button('Download original handoff record',()=>perform(async()=>{
         const chosen=scope(),value=await api('/api/application-input-set-editions/received?'+new URLSearchParams({requestId:item.requestId}));
         if(current(chosen))download(value,'received-source-edition-'+item.requestId+'.json');
       })));return article;
     }));
     back.disabled=offset===0;more.disabled=offset+20>=Math.max(result.total,result.received.total);enabled();
   }catch(error){if(current(own)&&version===refreshVersion)onError(error);}
 }
 function reset() {
   epoch++;refreshVersion++;workspace=getWorkspaceId();busy=false;selectionRequestId=null;review=null;offset=rowsOffset=0;
   name.value=status.textContent='';summary.replaceChildren();details.replaceChildren();history.replaceChildren();received.replaceChildren();
   unchanged.checked=false;renderReview();
 }
 name.addEventListener('input',()=>{review=null;renderReview();status.textContent='Review the current working files with this edition name before saving.';});
 unchanged.addEventListener('change',()=>{rowsOffset=0;renderReview();});
 enabled();
 return {refresh,reset,async open(selection) {
   epoch++;busy=false;selectionRequestId=selection.requestId;name.value=selection.manifest.name;review=null;offset=rowsOffset=0;
   renderReview();root.scrollIntoView?.({block:'nearest'});await perform(readReview);
 },update(){if(workspace!==getWorkspaceId())reset();enabled();}};
}
