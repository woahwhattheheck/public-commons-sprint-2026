// SPDX-License-Identifier: MIT
import {AnalysisMerchantClient,parsePrivateLink,sha256} from '/analysis/merchant/client.mjs';
const $=s=>document.querySelector(s),S={client:null,overview:null,page:'publications',project:'',record:'',inbox:null,inputs:null,case:null,preview:null,busy:false};
function el(tag,attributes={},...children){
  const n=document.createElement(tag);for(const [key,value]of Object.entries(attributes)){
    if(key.startsWith('on'))n.addEventListener(key.slice(2),value);
    else if(key==='class')n.className=value;else if(key==='text')n.textContent=value;
    else if(key in n)n[key]=value;else n.setAttribute(key,String(value));
  }
  for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)n.append(child instanceof Node?child:document.createTextNode(String(child)));
  return n;
}
const code=x=>el('code',{},x??''),json=x=>el('pre',{},JSON.stringify(x,null,2)),pill=x=>el('span',{class:'pill'},x),
  card=(title,...body)=>el('section',{class:'card'},el('h2',{},title),...body),
  empty=t=>el('p',{class:'empty'},t),hint=t=>el('p',{class:'muted'},t);
function notice(message,error=false){$('#notice').hidden=false;$('#notice').className=error?'error':'';$('#notice').textContent=message;}
function error(e){notice((e.code?e.code+': ':'')+e.message,true);}
function button(label,run,props={}){return el('button',{type:'button',...props,onclick:async event=>{
  const b=event.currentTarget;b.disabled=true;try{await run();}catch(e){error(e);}finally{if(b.isConnected)b.disabled=false;}
}},label);}
function field(name,label,{type='text',value='',required=true,options=null,wide=false,help='',...rest}={}){
  const input=options?el('select',{name,id:name,required,...rest},options.map(x=>el('option',{value:String(x.value),disabled:!!x.disabled},x.label))):
    type==='textarea'?el('textarea',{name,id:name,required,...rest}):el('input',{name,id:name,type,required,...rest});
  input.value=String(value);return el('label',{class:wide?'wide':''},label,input,help?el('small',{},help):null);
}
function value(form,name){const node=form.elements.namedItem(name);return node?.value??'';}
const integer=(form,name)=>Number(value(form,name));
function table(head,rows){return el('div',{class:'table-wrap'},el('table',{},el('thead',{},el('tr',{},head.map(t=>el('th',{},t)))),
  el('tbody',{},rows.map(row=>el('tr',{},row.map(cell=>el('td',{},cell)))))));}
function details(title,value){$('#detail-title').textContent=title;$('#detail-content').replaceChildren(json(value));$('#detail').showModal();}
function storageKey(suffix){return 'sensorthings-merchant:'+S.client.key+':'+suffix;}
function readStored(suffix,fallback){const raw=localStorage.getItem(storageKey(suffix));if(raw===null)return fallback;
  try{return JSON.parse(raw);}catch{throw Error('The retained local '+suffix+' is incomplete. Preserve it before continuing.');}}
function saveStored(suffix,value){localStorage.setItem(storageKey(suffix),JSON.stringify(value));}
function bindDraft(name,form){
  const data=readStored('draft:'+name,{});
  for(const node of form.elements)if(node.name&&node.type!=='file'&&node.type!=='password'&&Object.hasOwn(data,node.name)){
    if(node.type==='checkbox')node.checked=Array.isArray(data[node.name])?data[node.name].includes(node.value):data[node.name]===true;
    else if(node.tagName!=='SELECT'||[...node.options].some(x=>x.value===String(data[node.name])))node.value=data[node.name];
  }
  form.addEventListener('input',()=>{const result={};for(const node of form.elements)if(node.name&&node.type!=='file'&&node.type!=='password'){
    if(node.type==='checkbox'){result[node.name]??=[];if(node.checked)result[node.name].push(node.value);}else result[node.name]=node.value;
  }saveStored('draft:'+name,result);});
}
function actor(){const x=$('#actor').value.trim();if(!x)throw Error('Enter the operator name recorded with this action.');return x;}
async function refresh({render=true}={}){
  S.overview=await S.client.overview();if(S.overview.workspaceId!==S.client.workspaceId)throw Error('Workspace identity changed.');
  $('#identity').textContent='Workspace '+S.overview.workspaceId+' · revision '+S.overview.revision+' · original source and request history';
  if(!S.overview.sourceProjects.some(x=>x.id===S.project))S.project=S.overview.sourceProjects[0]?.id??'';
  if(render)await draw();
}
function journal(){return readStored('requests',[]);}
function putRequest(record){const records=journal(),index=records.findIndex(x=>x.operationId===record.operationId);
  if(index>=0){if(records[index].raw!==record.raw||records[index].dispatchUrl!==record.dispatchUrl)throw Error('The original local request identity changed.');records[index]=record;}
  else records.push(record);saveStored('requests',records);}
async function submit(action,payload){
  if(S.busy)throw Error('Wait for the current original request response, or recover it from Requests & recovery.');
  const operationId='analysis-delivery-'+crypto.randomUUID(),request={action,operationId,expectedRevision:S.overview.revision,payload},
    raw=JSON.stringify(request),entry={operationId,raw,dispatchUrl:S.client.origin+'/api/action',workspaceId:S.client.workspaceId,
      state:'PREPARED',createdAt:new Date().toISOString()};
  putRequest(entry);return dispatch(entry);
}
async function dispatch(entry){
  if(entry.dispatchUrl!==S.client.origin+'/api/action'||entry.workspaceId!==S.client.workspaceId)throw Error('This retained request belongs to another original workspace.');
  S.busy=true;entry={...entry,state:'DISPATCHED'};putRequest(entry);
  try{
    const response=await S.client.actionRaw(entry.raw);
    entry={...entry,state:response.state==='RUNNING'?'RUNNING':'COMPLETE',observedAt:new Date().toISOString(),
      resultId:response.result?.id??null};putRequest(entry);
    notice(entry.state==='COMPLETE'?'Original request completed: '+entry.operationId:'The original request is still running: '+entry.operationId);
    await refresh();return response;
  }catch(e){putRequest({...entry,state:'UNCONFIRMED',error:{code:e.code??null,message:e.message}});await refresh({render:false}).catch(()=>{});throw e;}
  finally{S.busy=false;}
}
async function recover(entry,{continueOriginal=false}={}){
  let original;
  try{original=await S.client.operation(entry.operationId);}
  catch(e){if(e.status!==404)throw e;
    if(!continueOriginal){details('Original operation is not currently recorded',{operationId:entry.operationId,request:JSON.parse(entry.raw),state:'NOT_RECORDED',meaning:'Choose Send exact original request to dispatch these same bytes.'});return;}
    return dispatch(entry);
  }
  putRequest({...entry,state:original.state,observedAt:new Date().toISOString()});
  if(original.state==='COMPLETE'){details('Original completed result',original);await refresh();return original;}
  if(continueOriginal&&original.state==='RUNNING')return dispatch(entry);
  details('Original request and status',original);
  if(original.state==='FAILED')notice('The original operation failed. Inspect its exact request, then use the attributed Continue original delivery form for merchant actions.');
}
async function filesPanel(id){
  const listed=await S.client.files(id);
  return table(['Original file / selector','Bytes / SHA256','Download'],listed.files.map(file=>[
    el('div',{},file.name,el('div',{class:'hint'},code(file.selection.file))),el('div',{},file.bytes,el('div',{},code(file.sha256))),
    button('Download exact file',async()=>{const download=await S.client.download(file),url=URL.createObjectURL(new Blob([download.raw],{type:download.type}));
      const a=el('a',{href:url,download:download.name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notice('Verified '+download.bytes+' bytes · '+download.sha256);},{class:'small',disabled:file.bytes>256*1024*1024})
  ]));
}
async function showFiles(id){$('#detail-title').textContent='Original retained files';$('#detail-content').replaceChildren(hint('Loading verified file selectors…'));
  $('#detail').showModal();$('#detail-content').replaceChildren(await filesPanel(id),hint('Files above 256 MiB use the complete streaming CLI download described in the operator guide.'));}
function projectPicker(){
  const select=el('select',{id:'project-selector',onchange:async e=>{S.project=e.target.value;saveStored('project',S.project);await draw();}},
    S.overview.sourceProjects.map(p=>el('option',{value:p.id},p.title+' · '+p.id)));select.value=S.project;
  return el('label',{},'Original analysis project',select);
}
async function publicationsPage(root){
  root.append(card('Select an approved publication',hint('Select an existing immutable publication and a complete original project export that contains it. The original accepted source review must still be current.'),projectPicker()));
  if(!S.project){root.append(empty('No retained analysis project is available. Open Observation analysis to work with the existing source.'));return;}
  const pubs=S.overview.publications.filter(x=>x.projectId===S.project),exports=S.overview.exports.filter(x=>x.projectId===S.project);
  root.append(card('Original project handover',hint('A project export keeps original source bytes, saved versions, publications and the delivery history selected at its revision.'),
    button('Export current complete project',()=>submit('analysis.export',{projectId:S.project,actor:actor(),note:'Complete project handover selected in Publication delivery.'}),{id:'export-project'}),
    exports.length?table(['Original export','Archive','Inspect'],exports.map(x=>[code(x.id),el('div',{},x.file.bytes+' bytes',el('div',{},code(x.file.sha256))),
      button('Files',()=>showFiles(x.id),{class:'small'})])):empty('No complete project export is retained yet.')));
  if(!pubs.length){root.append(empty('This project has no approved publication. Use the original analysis publication workflow.'));return;}
  const selected=readStored('publication:'+S.project,pubs[0].id),p=pubs.find(x=>x.id===selected)??pubs[0];
  const chooser=el('select',{id:'publication-selector',onchange:async e=>{saveStored('publication:'+S.project,e.target.value);await draw();}},
    pubs.map(x=>el('option',{value:x.id},(x.title??x.id)+' · '+x.id)));chooser.value=p.id;
  const pub=await S.client.request('/api/analysis/publications/'+encodeURIComponent(p.id));
  root.append(card('Selected original publication',el('label',{},'Publication',chooser),
    el('dl',{},el('dt',{},'Version'),el('dd',{},code(pub.versionId)),el('dt',{},'Source edition'),el('dd',{},code(pub.editionId)),
      el('dt',{},'Review SHA256'),el('dd',{},code(pub.sourceReviewSha256)),el('dt',{},'Publication SHA256'),el('dd',{},code(p.publicationSha256))),
    el('div',{class:'actions'},button('Inspect original publication',()=>details('Original publication',pub),{class:'secondary'}),button('Original files',()=>showFiles(pub.id),{class:'secondary'}))));
  const form=el('form',{id:'offer-form'}),fields=el('div',{class:'fields'});
  fields.append(field('exportId','Complete original project export',{value:exports.at(-1)?.id??'',options:exports.map(x=>({value:x.id,label:x.id+' · '+x.file.bytes+' bytes'})),wide:true}),
    field('title','Native service title',{value:(pub.title??'Approved analysis').slice(0,32),maxlength:32}),
    field('origin','Actual public HTTPS origin',{placeholder:'https://…',help:'The public deployment origin supplied by the operator; the local listener still binds loopback.'}),
    field('routePrefix','Fixed versioned route prefix',{placeholder:'/analysis/selected-version',wide:true}),
    field('description','Public file description',{type:'textarea',wide:true,maxlength:1400}),
    field('license','Release and attribution statement',{type:'textarea',wide:true,maxlength:1500,help:'Retain the original source terms and the operator’s authority for this publication.'}),
    field('scheme','Native payment scheme',{placeholder:'Exact selected scheme'}),
    field('network','Native Stellar network',{options:[{value:'stellar:testnet',label:'Stellar testnet'},{value:'stellar:pubnet',label:'Stellar public network'}],value:'stellar:testnet'}),
    field('asset','Exact native asset identifier'),field('amount','Atomic amount as a decimal string',{pattern:'[0-9]+'}),
    field('payTo','Original seller recipient'),field('maxTimeoutSeconds','Native maximum timeout (seconds)',{type:'number',min:1,max:86400,step:1}),
    field('extra','Additional native payment fields (JSON object)',{type:'textarea',value:'{}',wide:true}),
    field('reason','Reason for this delivery edition',{type:'textarea',wide:true,maxlength:12000}));
  form.append(fields,el('h3',{},'Optional original publication files'),hint('The complete project archive is always included. Select companions by their exact original names.'),
    el('div',{class:'check-list'},pub.files.map(x=>el('label',{},el('input',{type:'checkbox',name:'companions',value:x.name}),x.name+' · '+x.bytes+' bytes'))),
    el('p',{class:'hint'},'Native capacity: '+S.overview.limits.fileBytes+' bytes per file; '+S.overview.limits.totalRouteBytes+' bytes across routes. Full files must fit.'),
    el('button',{type:'submit',disabled:exports.length===0},'Prepare native offer'));
  bindDraft('offer:'+p.id,form);form.addEventListener('submit',async e=>{e.preventDefault();try{
    const exported=exports.find(x=>x.id===value(form,'exportId'));if(!exported)throw Error('Select the complete original project export.');
    const extra=JSON.parse(value(form,'extra'));if(!extra||Array.isArray(extra)||typeof extra!=='object')throw Error('Payment extra must be an explicit JSON object.');
    const result=await submit('analysis.merchant.offer',{publicationId:pub.id,expectedPublicationSha256:p.publicationSha256,
      exportId:exported.id,expectedArchiveSha256:exported.file.sha256,title:value(form,'title'),description:value(form,'description'),
      license:value(form,'license'),reason:value(form,'reason'),origin:value(form,'origin'),routePrefix:value(form,'routePrefix'),
      payment:{scheme:value(form,'scheme'),network:value(form,'network'),asset:value(form,'asset'),amount:value(form,'amount'),
        payTo:value(form,'payTo'),maxTimeoutSeconds:integer(form,'maxTimeoutSeconds'),extra},
      companions:[...form.querySelectorAll('input[name=companions]:checked')].map(x=>x.value),actor:actor()});
    if(result.result?.id){S.record=result.result.id;S.page='offers';await draw();}
  }catch(err){error(err);}});
  root.append(card('Prepare an explicit file offer',form));
}
async function offersPage(root){
  const offers=S.overview.records.filter(x=>x.kind==='offer');
  root.append(card('Native file offers',hint('Prepared offers retain the original SF30 bundle and catalog. Service readiness is observed separately in the current workspace process.'),
    offers.length?table(['Offer','Original publication','Service','Open'],offers.map(x=>[
      el('div',{},x.title,el('div',{},code(x.id))),code(x.publicationId),pill(S.overview.services.find(s=>s.offerId===x.id)?.mode??'Inactive'),
      button('Inspect & operate',async()=>{S.record=x.id;await draw();},{class:'small','data-offer-id':x.id})
    ])):empty('No native offer has been prepared. Select an approved publication first.')));
  const selected=offers.find(x=>x.id===S.record)??offers[0];if(!selected)return;
  const checked=await S.client.record(selected.id),offer=checked.record,v=offer.value;
  root.append(card('Selected exact offer',el('dl',{},el('dt',{},'Offer SHA256'),el('dd',{},code(checked.recordSha256)),
    el('dt',{},'Archive'),el('dd',{},code(v.binding.archive.sha256)),el('dt',{},'Native configuration'),el('dd',{},code(v.bundle.configSha256))),
    table(['Native route','Original file','Size / SHA'],v.routes.map(x=>[el('div',{},x.url,el('div',{},code(x.key))),x.name,el('div',{},x.bytes,el('div',{},code(x.sha256)))])),
    el('div',{class:'actions'},button('Original record',()=>details('Native offer and frozen source',checked),{class:'secondary'}),
      button('Bundle, catalog & complete files',()=>showFiles(offer.id),{class:'secondary'}))));
  const live=checked.service,serviceForm=el('form',{id:'service-form'},field('note','Operator service note',{type:'textarea'}));
  serviceForm.append(el('div',{class:'actions'},button('Start selected native service',async()=>submit('analysis.merchant.start',{
    offerId:offer.id,expectedOfferSha256:checked.recordSha256,actor:actor(),note:value(serviceForm,'note')}),{id:'start-offer',disabled:live.running}),
    button('Stop and drain original service',async()=>submit('analysis.merchant.stop',{offerId:offer.id,actor:actor(),note:value(serviceForm,'note')}),{id:'stop-offer',class:'secondary'})));
  bindDraft('service:'+offer.id,serviceForm);
  root.append(card('Current native service',pill(live.mode??'INACTIVE'),hint(live.meaning),
    live.origin?el('p',{},'Local listener: ',code(live.origin)):null,
    hint(S.overview.runtime.nativePaymentConfigured?'The host supplied the original native payment factory.':'The host has no native payment factory. Starting the original service exposes its challenge-only mode; it cannot settle a purchase.'),serviceForm));
  const buyer=el('form',{id:'buyer-form'},el('div',{class:'fields'},
    field('file','Exact file route',{options:v.routes.map((x,i)=>({value:String(i),label:x.name+' · '+x.url})),value:'0',wide:true}),
    field('acceptIndex','Original catalog payment option index',{type:'number',min:0,step:1,value:'0'}),
    field('intentId','Original selected buyer intent ID'),field('responseOut','Original absolute response output path',{wide:true}),
    field('note','Preparation note',{type:'textarea',wide:true})),el('button',{type:'submit'},'Prepare original SF88 review'));
  bindDraft('buyer:'+offer.id,buyer);
  buyer.addEventListener('submit',async e=>{e.preventDefault();try{const index=integer(buyer,'file'),route=v.routes[index];
    if(!route)throw Error('Select a native route.');
    await submit('analysis.merchant.buyer.prepare',{offerId:offer.id,expectedOfferSha256:checked.recordSha256,file:route.key,rowIndex:index,
      acceptIndex:integer(buyer,'acceptIndex'),intentId:value(buyer,'intentId'),responseOut:value(buyer,'responseOut'),actor:actor(),note:value(buyer,'note')});
  }catch(err){error(err);}});
  root.append(card('Existing buyer handoff',hint('This prepares the maintained SF88 review file. Its original buyer operator owns any purchase dispatch.'),button('Inspect actual native catalog',()=>details('Native catalog',checked.catalog),{class:'secondary'}),buyer));
  const capture=el('form',{id:'capture-form'},field('intentIds','Existing completed Inbox intent IDs, one per line',{type:'textarea'}),
    field('note','Original source selection note',{type:'textarea'}),el('button',{type:'submit',disabled:!S.overview.runtime.buyerInboxBound},'Export selected original Inbox records'));
  bindDraft('capture:'+offer.id,capture);capture.addEventListener('submit',async e=>{e.preventDefault();try{
    await submit('analysis.merchant.inbox.capture',{projectId:offer.projectId,versionId:offer.versionId,publicationId:offer.publicationId,
      intentIds:value(capture,'intentIds').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),actor:actor(),note:value(capture,'note')});
  }catch(err){error(err);}});
  root.append(card('Read original saved buyer outcomes',hint('Uses the configured existing Inbox and original verified response reader. It does not enqueue, retry or finalize a purchase.'),capture));
  const related=S.overview.records.filter(x=>x.publicationId===offer.publicationId&&x.id!==offer.id);
  if(related.length)root.append(card('Retained preparation and outcome records',
    table(['Kind','Operation','Original files'],related.map(x=>[
      x.kind,code(x.operationId),el('div',{class:'actions'},
        button('Inspect',async()=>details('Original delivery record',await S.client.record(x.id)),{class:'small'}),
        button('Files',()=>showFiles(x.id),{class:'small secondary'}))
    ]))));
}

async function inboxForm(title,id,parts,onSubmit){
  const form=el('form',{id}),files=S.inbox.files.filter(x=>x.available!==false);
  for(const [key,label]of parts)form.append(field(key,label,{options:[{value:'',label:'Select original file'},...files.map(x=>({value:x.name,label:x.name+' · '+x.bytes+' bytes'}))]}));
  form.append(el('button',{type:'submit'},'Inspect exact selected inputs'));
  bindDraft(id,form);form.addEventListener('submit',async e=>{e.preventDefault();try{const selected={};
    for(const [key]of parts){const x=files.find(x=>x.name===value(form,key));if(!x)throw Error('Select the original '+key+' file.');
      selected[key]={filename:x.name,bytes:x.bytes,sha256:x.sha256};}
    await onSubmit(selected);
  }catch(err){error(err);}});return card(title,form);
}
function paymentOptions(row){const values=Array.isArray(row?.accepts)?row.accepts:[];return values.map((v,i)=>({value:String(i),label:i+' · '+(v.network??'')+' · '+(v.maxAmountRequired??v.amount??'')+' '+(v.asset??'')}));}
async function receivingPage(root){
  S.inbox=await S.client.inbox();
  root.append(card('Receive the original paid-file output',hint('Place the existing native catalog, saved SF88 handoff and exact saved response in the host-bound source inbox. The full original project receiver verifies every member and citation before local adoption.'),
    pill(S.inbox.bound?'Original inbox configured':'Inbox not configured'),button('Refresh original inbox',async()=>{S.inputs=null;S.preview=null;await draw();},{class:'secondary'})));
  if(!S.inbox.bound)return;
  root.append(await inboxForm('1 · Select complete retained files','receiving-inputs',[['catalog','Original native catalog'],['handoff','Original SF88 handoff'],['response','Original response archive']],async selected=>{
    const [catalog,handoff,project]=await Promise.all([S.client.inspectInput({kind:'catalog',file:selected.catalog}),S.client.inspectInput({kind:'handoff',file:selected.handoff}),S.client.inspectInput({kind:'project',file:selected.response})]);
    S.inputs={selected,catalog,handoff,project};S.preview=null;S.case=null;await draw();
  }));
  if(!S.inputs)return;
  const x=S.inputs,form=el('form',{id:'receiving-review'}),resources=x.catalog.value.resources,rows=x.handoff.report.rows,pubs=x.project.publications;
  form.append(el('div',{class:'fields'},
    field('rowIndex','Original native catalog row',{options:resources.map((r,i)=>({value:String(i),label:i+' · '+(r.resource?.url??JSON.stringify(r.resource??r))})),value:'0',wide:true}),
    field('acceptIndex','Original payment option',{options:paymentOptions(resources[0]),value:'0',wide:true}),
    field('jobId','Original verified native job',{options:rows.map(r=>({value:r.jobId,label:r.jobId+' · '+r.intentId+' · '+(r.canReceive?'receivable':'requires resolution'),disabled:!r.canReceive})),value:rows.find(r=>r.canReceive)?.jobId??'',wide:true}),
    field('publicationId','Original delivered publication',{options:pubs.map(p=>({value:p.id,label:(p.title??p.id)+' · '+p.id})),value:pubs[0]?.id??'',wide:true}),
    field('decision','Attributed receiving decision',{options:[{value:'received',label:'Received exact files'},{value:'changes_requested',label:'Changes requested'}],value:'received'}),
    field('reason','Receiving reason',{type:'textarea',wide:true}),
    field('caseId','Optional original SF47 case ID',{required:false,placeholder:'operation-…',wide:true,
      help:'Use a case returned by the configured original Operations reader. Leave empty for analysis-only receiving.'})));
  const casePane=el('div',{id:'case-pane'}),previewPane=el('div',{id:'receiving-preview'});
  form.append(button('Read original Operations cases',async()=>details('Original Operations case index',await S.client.request('/api/analysis/merchant/operations-cases')),{class:'secondary',disabled:!S.overview.runtime.operationsBound}),
    button('Load selected original case',async()=>{
      const id=value(form,'caseId');S.case=await S.client.request('/api/analysis/merchant/operations-cases/'+encodeURIComponent(id));S.preview=null;renderCase();
    },{id:'load-case',class:'secondary',disabled:!S.overview.runtime.operationsBound}),casePane,
    el('div',{class:'actions'},el('button',{type:'submit',id:'preview-receiving'},'Preview exact receiving'),
      button('Receive and record this selection',async()=>{
        if(!S.preview)throw Error('Preview the exact original files and selected case first.');
        const p=selection();if(JSON.stringify(p)!==S.preview.selectionJSON)throw Error('The selection changed after preview. Preview it again.');
        if(S.case){
          const o=S.preview.value.operations;if(!o||o.program.id!==value(form,'caseId'))throw Error('The selected original case has no current matching preview.');
          p.operations={caseId:value(form,'caseId'),deploymentId:value(form,'deploymentId'),purchaseId:value(form,'purchaseId')||null,
            expectedCaseVersion:o.program.version,expectedPreviewSha256:o.preview.previewSha256,origin:o.origin};
        }
        p.actor=actor();const completed=await submit('analysis.merchant.receive',p);S.inputs=null;S.preview=null;
        if(completed.result?.id){S.record=completed.result.id;S.page='history';await draw();}
      },{id:'receive-commit',disabled:true})),previewPane);
  bindDraft('receiving-review',form);
  function renderCase(){
    casePane.replaceChildren();if(!S.case)return;
    const current=S.case.value;if(current.program?.id!==value(form,'caseId')||!Array.isArray(current.records?.deployments)||!Array.isArray(current.records?.purchases))
      throw Error('The original Operations reader returned a different case or record schema.');
    casePane.append(el('p',{},'Original case ',code(current.program.id),' · version '+current.program.version),
      field('deploymentId','Existing buyer deployment',{options:current.records.deployments.map(d=>({value:d.id,label:(d.name??d.title??d.id)+' · '+d.id})),value:current.records.deployments[0]?.id??''}),
      field('purchaseId','Purchase association',{options:[{value:'',label:'Let the original native receiver create or match this buyer purchase'},...current.records.purchases.map(p=>({value:p.id,label:p.id+' · '+(p.intentId??'')}))],required:false}),
      button('Inspect original case records',()=>details('Current original Operations case',S.case),{class:'secondary'}));
  }
  function selection(){
    const p=pubs.find(p=>p.id===value(form,'publicationId'));if(!p)throw Error('Select the exact delivered publication.');
    const caseId=value(form,'caseId').trim();if(caseId&&(!S.case||S.case.value.program.id!==caseId))throw Error('Load the exact selected Operations case.');
    return {projectId:p.projectId,versionId:p.versionId,...x.selected,rowIndex:integer(form,'rowIndex'),acceptIndex:integer(form,'acceptIndex'),
      jobId:value(form,'jobId'),publicationId:p.id,expectedPublicationSha256:p.publicationSha256,decision:value(form,'decision'),reason:value(form,'reason'),
      operations:caseId?{caseId}:null};
  }
  function selectPaymentOptions({retain=false}={}){
    const a=form.elements.acceptIndex,prior=a.value,options=paymentOptions(resources[integer(form,'rowIndex')]);
    a.replaceChildren(...options.map(o=>el('option',{value:o.value},o.label)));
    if(retain&&options.some(o=>o.value===prior))a.value=prior;
  }
  selectPaymentOptions({retain:true});
  form.elements.rowIndex.addEventListener('change',()=>selectPaymentOptions());
  form.addEventListener('input',()=>{S.preview=null;$('#receive-commit').disabled=true;previewPane.replaceChildren(hint('Selection changed. Preview its exact current binding again.'));});
  form.addEventListener('submit',async e=>{e.preventDefault();try{
    const p=selection(),out=await S.client.preview(p);S.preview={selectionJSON:JSON.stringify(p),value:out};
    previewPane.replaceChildren(card('Read-only receiving preview',el('p',{},'Project ',code(out.binding.projectId),' · publication ',code(out.binding.publicationId)),
      el('p',{},'Archive ',code(out.binding.archive.sha256)),json({inspection:out.inspection,buyer:out.buyer,operations:out.operations}),
      hint(out.meaning)));$('#receive-commit').disabled=false;
  }catch(err){error(err);}});
  root.append(card('2 · Bind the original job, publication and receiving decision',form));
  if(S.case)renderCase();
  root.append(card('Original input identities',json({files:x.selected,project:x.project.project,inspection:x.project.inspection})));
}
async function historyPage(root){
  const history=await S.client.operations(),local=journal();
  root.append(card('Retained browser requests',hint('Each exact request body and destination is saved before dispatch. Reopening this page never sends a request.'),
    local.length?table(['Operation / state','Original request','Recovery'],[...local].reverse().map(x=>[
      el('div',{},code(x.operationId),el('div',{},pill(x.state))),button('Inspect saved bytes',()=>details('Exact original request',{dispatchUrl:x.dispatchUrl,workspaceId:x.workspaceId,raw:x.raw}),{class:'small secondary'}),
      el('div',{class:'actions'},button('Read original result',()=>recover(x),{class:'small'}),
        button('Send exact original request',()=>recover(x,{continueOriginal:true}),{class:'small secondary'}))
    ])):empty('No delivery request has been saved in this browser. Server history remains authoritative.')));
  root.append(card('Original workspace delivery operations',history.operations.length?table(['Original operation','State','Inspect'],history.operations.map(x=>[
    el('div',{},x.action,el('div',{},code(x.operationId))),pill(x.state),button('Original request & availability',async()=>details('Original operation',await S.client.merchantOperation(x.operationId)),{class:'small'})
  ])):empty('No local merchant operation is retained.')));
  const resumable=history.operations.filter(x=>x.action!=='analysis.merchant.resume'),form=el('form',{id:'resume-form'},
    field('originalOperationId','Original local operation',{options:resumable.map(x=>({value:x.operationId,label:x.operationId+' · '+x.action+' · '+x.state})),value:resumable[0]?.operationId??''}),
    field('reason','Attributed continuation reason',{type:'textarea'}),el('button',{type:'submit',disabled:!resumable.length},'Continue original delivery request'));
  bindDraft('resume',form);form.addEventListener('submit',async e=>{e.preventDefault();try{const op=resumable.find(x=>x.operationId===value(form,'originalOperationId'));
    if(!op)throw Error('Select an original local delivery operation.');
    await submit('analysis.merchant.resume',{originalOperationId:op.operationId,expectedRequestSha256:op.requestSha256,actor:actor(),reason:value(form,'reason')});
  }catch(err){error(err);}});
  root.append(card('Explicit original-operation continuation',hint('The original request and phase identities stay unchanged. A missing saved capture or interrupted service start may require the original file or a separately selected new service start.'),form));
  root.append(card('Imported operation history',hint('Imported requests are evidence from their original workspace. They cannot dispatch native services, buyer actions or Operations commands here.'),
    history.importedHistory.length?table(['Origin / operation','State','History'],history.importedHistory.map(x=>[
      el('div',{},code(x.originWorkspaceId),el('div',{},code(x.original.operationId))),pill(x.original.state),
      button('Read imported history',async()=>details('Imported original history',await S.client.request('/api/analysis/merchant/history/'+x.id)),{class:'small secondary'})
    ])):empty('No imported delivery history is retained.')));
  const records=S.overview.records;
  root.append(card('Complete retained delivery records',records.length?table(['Kind / publication','Operation','Record / files'],records.map(x=>[
    el('div',{},x.kind,el('div',{},code(x.publicationId))),code(x.operationId),
    el('div',{class:'actions'},button('Inspect',async()=>details('Original delivery record',await S.client.record(x.id)),{class:'small secondary'}),
      button('Files',()=>showFiles(x.id),{class:'small'}))
  ])):empty('No delivery record has completed.')));
}
async function handoverPage(root){
  root.append(card('Complete analysis project handover',hint('Use the maintained full project export. It retains original source objects, asset bytes, saved analyses, publications and delivery requests. Receiving adds history to the existing workspace and preserves a later local project head.'),projectPicker()));
  if(S.project){root.append(card('Freeze a complete current project',button('Export complete project and delivery history',()=>submit('analysis.export',{projectId:S.project,actor:actor(),note:'Complete analysis and merchant delivery history for independent receiving.'}),{id:'handover-export'}),
    ...S.overview.exports.filter(x=>x.projectId===S.project).map(x=>el('div',{class:'actions'},code(x.id),x.file.bytes+' bytes',button('Original export file',()=>showFiles(x.id),{class:'small secondary'})))));}
  S.inbox=await S.client.inbox();
  if(S.inbox.bound)root.append(await inboxForm('Receive a complete project through the original importer','project-receiving',[['archive','Original project archive']],async selected=>{
    const out=await S.client.inspectInput({kind:'project',file:selected.archive});
    const form=el('form',{id:'project-import-form'},json(out),field('note','Receiving note',{type:'textarea'}),
      el('button',{type:'submit'},'Receive complete project'));
    form.addEventListener('submit',async e=>{e.preventDefault();try{await submit('analysis.import',{filename:selected.archive.filename,expectedSha256:selected.archive.sha256,expectedBytes:selected.archive.bytes,
      actor:actor(),note:value(form,'note')});}catch(err){error(err);}});
    // Exact original importer fields: filename, expectedSha256, expectedBytes, actor, note.
    $('#detail-title').textContent='Original complete project receiving';$('#detail-content').replaceChildren(form);$('#detail').showModal();
  }));
  else root.append(empty('The host must configure its original source inbox for project receiving.'));
  root.append(card('Reopen and continue',hint('A received project requires its original local source review before preparing a new seller offer. Existing historical offers can be inspected and their full files downloaded. Starting a local service is an explicit operator action.'),
    el('a',{href:S.client.privateLink('/analysis/')},'Open the original analysis workspace'),hint('The operator guide contains the exact host configuration, streaming download, installed client and same-workspace continuation commands.')));
}
async function draw(){
  if(!S.client||!S.overview)return;
  for(const b of document.querySelectorAll('[data-page]'))b.setAttribute('aria-current',b.dataset.page===S.page?'page':'false');
  $('#content').replaceChildren(hint('Reading retained original records…'));
  const requestPage=S.page,version=(S.renderVersion??0)+1,client=S.client,root=el('div',{class:'page'});
  S.renderVersion=version;
  // Prepare a detached view, then publish only the latest selected page.
  // Reading a page never dispatches a domain action.
  await ({publications:publicationsPage,offers:offersPage,receiving:receivingPage,history:historyPage,handover:handoverPage}[requestPage]??publicationsPage)(root);
  if(S.client===client&&S.renderVersion===version&&S.page===requestPage)$('#content').replaceChildren(...root.childNodes);
}
async function connect(link){
  const selected=parsePrivateLink(link);if(selected.origin!==location.origin)throw Error('Open this desk at the original private workspace origin first.');
  const client=new AnalysisMerchantClient(selected);await client.connect();
  S.client=client;history.replaceState(null,'',location.pathname+location.search);
  $('#private-link').value='';$('#connection').hidden=true;$('#app').hidden=false;$('#refresh').disabled=false;$('#lock').disabled=false;
  S.project=readStored('project','');$('#actor').value=readStored('actor','');$('#back-analysis').href=client.privateLink('/analysis/');
  await refresh();notice('Connected to the existing workspace. Saved requests are available for explicit recovery.');
}
$('#connect-form').addEventListener('submit',async e=>{e.preventDefault();try{await connect($('#private-link').value);}catch(err){error(err);}});
$('#actor').addEventListener('input',()=>{if(S.client)saveStored('actor',$('#actor').value);});
$('#refresh').addEventListener('click',()=>refresh().catch(error));
$('#lock').addEventListener('click',()=>{S.client?.close();Object.assign(S,{client:null,overview:null,inputs:null,case:null,preview:null});$('#content').replaceChildren();
  $('#app').hidden=true;$('#connection').hidden=false;$('#lock').disabled=true;$('#refresh').disabled=true;$('#back-analysis').href='/analysis/';
  $('#identity').textContent='Private session closed in this browser.';});
$('#detail-close').addEventListener('click',()=>$('#detail').close());
for(const b of document.querySelectorAll('[data-page]'))b.addEventListener('click',async()=>{S.page=b.dataset.page;try{await draw();}catch(err){error(err);}});
if(/^[A-Za-z0-9_-]{32,200}$/.test(location.hash.slice(1)))connect(location.href).catch(error);
