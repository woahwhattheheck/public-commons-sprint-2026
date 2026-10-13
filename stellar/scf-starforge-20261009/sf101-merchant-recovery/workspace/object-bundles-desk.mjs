// SPDX-License-Identifier: MIT
// Operator controls over the existing reviewed recovery queue and source delivery.
const HASH=/^[a-f0-9]{64}$/;
const encoded=value=>JSON.stringify(value);
const node=(tag,text,parent)=>{
  const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);parent?.append(el);return el;
};
const query=(path,args)=>path+'?'+new URLSearchParams(Object.entries(args).filter(([,v])=>v!==undefined));
function field(root,title,tag='input'){const label=node('label',title,root),input=node(tag,undefined,label);return input;}
function options(select,rows,value){
  select.replaceChildren();for(const row of rows){const option=node('option',row.label,select);option.value=row.id;}
  if(rows.some(row=>row.id===value))select.value=value;
}
const bundleAction=command=>['object-bundle-export','object-bundle-receive'].includes(command);
export function createObjectBundleDesk({root,api,post,refresh,notice,showDetails,download}){
  let state=null,profile=null,rows=[],generation=0,review=null,original=null,active=false,closed=false;
  let sourceTuple='',profileKey='',transfers=[],selectedSupport=null,pairPreview=null;
  node('h2','Encrypted Object backup transfer',root);
  node('p','Export every encrypted member from an existing recovery record, or receive a pinned archive into a host-declared bundle. Receiving authenticates the record and session. Canonical state-root acceptance and restore remain a separate explicit Object review.',root);
  const controls=node('div',undefined,root);controls.className='form-grid';
  const action=field(controls,'Transfer action','select');
  options(action,[{id:'object-bundle-export',label:'Export original encrypted backup'},{id:'object-bundle-receive',label:'Receive and authenticate archive'}]);
  const id=field(controls,'Retained transfer operation ID');id.autocomplete='off';
  const source=field(controls,'Original Object recovery or completed comparison request','select');
  const sourceSide=field(controls,'Original comparison edition','select');options(sourceSide,[{id:'before',label:'Before backup'},{id:'after',label:'After backup'}]);
  const archive=field(controls,'Host-declared archive','select');
  const destination=field(controls,'Declared Object-session bundle destination','select');
  const actions=node('div',undefined,root);actions.className='actions';
  const button=(text,fn,parent=actions)=>{const b=node('button',text,parent);b.type='button';b.addEventListener('click',()=>work(b,fn));return b;};
  const inspect=button('Inspect selected archive',async()=>{
    const selected=uiIdentity(),result=await api(query('/api/bundle-inspection',{profile:profile.id,archive:archive.value}));
    if(selected!==uiIdentity())return;
    showDetails('Structural archive inspection',result);
    notice('All ciphertext members were inspected. Authentication occurs during receive.');
  });
  const prepare=button('Review complete transfer',async()=>{
    const epoch=generation,selected=intent(),result=await post('/api/review',selected);
    if(epoch!==generation||encoded(selected)!==encoded(intent()))return;
    review=result;original=null;confirmed.checked=false;drawReview();
  });
  const confirmed=field(root,'I reviewed this exact archive/source identity and destination.');confirmed.type='checkbox';
  const start=button('Start reviewed transfer',async()=>{
    const chosen=review;if(!chosen||!confirmed.checked)return;
    const epoch=generation;
    const result=await post('/api/start',{selection:chosen.intent,expectedReviewHash:chosen.reviewHash});
    if(epoch!==generation)return;
    review=null;confirmed.checked=false;original=result;drawReview();drawOriginal();await refresh();
  });
  const reopen=button('Read retained operation',async()=>readOriginal());
  const continueButton=button('Continue selected original attempt',async()=>{
    const selected=original;if(!selected||!confirmed.checked)return;
    const tuple=encoded({profile:profile.id,id:selected.operationId,hash:selected.review.reviewHash,attempt:selected.attempts});
    const result=await post('/api/resume',{profileId:profile.id,id:selected.operationId,
      expectedReviewHash:selected.review.reviewHash,afterAttempt:selected.attempts});
    if(tuple!==encoded({profile:profile.id,id:original?.operationId,hash:original?.review.reviewHash,attempt:original?.attempts}))return;
    original=result;confirmed.checked=false;drawOriginal();await refresh();
  });
  const cancel=button('Stop selected transfer',async()=>{
    if(!original)return;const selected=uiIdentity(),result=await post('/api/cancel',{profileId:profile.id,id:original.operationId});
    if(selected!==uiIdentity())return;
    original=result;confirmed.checked=false;drawOriginal();await refresh();
  });
  const summary=node('pre',undefined,root),outcome=node('pre',undefined,root);
  const reports=node('div',undefined,root);reports.className='actions';
  const report=button('Read full transfer report',()=>readReport('report'),reports);
  const verification=button('Read full native verification',()=>readReport('verification'),reports);
  const publication=button('Read retained publication attempt',()=>readReport('publication'),reports);
  const artifact=button('Read exported archive identity',async()=>{
    const selected=uiIdentity(),result=await api(query('/api/bundle-artifact',{profile:profile.id,id:original.operationId}));
    if(selected===uiIdentity())showDetails('Complete encrypted archive',result);
  },reports);
  const saveFile=button('Download complete encrypted archive',async()=>{
    const selected=original,epoch=generation,selectedProfile=profile.id;
    await download(query('/api/commissioning/source-bundles/download',{id:selectedProfile,kind:'archive',name:selected.operationId}),
      {filename:'object-recovery-'+selected.operationId+'.tar',resolve:async()=>{
        const info=await api(query('/api/bundle-artifact',{profile:selectedProfile,id:selected.operationId}));
        if(epoch!==generation||original?.operationId!==selected.operationId)throw new Error('The selected transfer changed before download.');
        return info;
      }});
    if(epoch===generation&&original?.operationId===selected.operationId)
      notice('The complete encrypted archive was downloaded. Keep its SHA-256 and native record identity with it.');
  },reports);
  const support=node('details',undefined,root);node('summary','Attach the actual archive to an existing commissioned Support case',support);
  node('p','This optional path requires an already saved recovery or comparison Support transfer and that case’s actual commissioning terms. Standalone archive receiving above does not require terms. The original textual capture stays unchanged; source delivery adds the real binary archive, or both original archives together for a comparison.',support);
  const supportControls=node('div',undefined,support);supportControls.className='form-grid';
  const transfer=field(supportControls,'Saved recovery or comparison Support transfer','select');
  const beforeExport=field(supportControls,'Completed before-backup export','select');
  const afterExport=field(supportControls,'Completed after-backup export','select');
  const caseRevision=field(supportControls,'Exact current case revision SHA-256');
  const actor=field(supportControls,'Operator');
  const attachmentConfirmed=field(support,'I reviewed this saved transfer, exported archive and exact case revision.');attachmentConfirmed.type='checkbox';
  const supportActions=node('div',undefined,support);supportActions.className='actions';
  const refreshTransfers=button('Refresh saved Support transfers',loadSupportTransfers,supportActions);
  const supportRead=button('Read saved Support transfer',async()=>{
    const epoch=generation,selected=transfer.value;
    const result=await api(query('/api/support-transfer',{profile:profile.id,id:selected}));
    if(epoch!==generation||selected!==transfer.value)return;
    if(result.status!=='SAVED')throw new Error('Save the original reviewed Support transfer first.');
    selectedSupport=result;pairPreview=null;caseRevision.value=result.result.revision;attachmentConfirmed.checked=false;
    supportSummary.textContent=encoded(result);
  },supportActions);
  const readPair=button('Review complete archive pair',async()=>{
    const selected=uiIdentity(),value=await api(query('/api/bundle-pair',{profile:profile.id,before:beforeExport.value,after:afterExport.value}));
    if(selected!==uiIdentity())return;pairPreview=value;attachmentConfirmed.checked=false;
    supportSummary.textContent=JSON.stringify({support:selectedSupport,pair:value},null,2);sync();
  },supportActions);
  const attach=button('Attach complete encrypted source',async()=>{
    const context=uiIdentity(),selected=attachmentSelection();await post(comparisonSupport()?'/api/bundle-pair-attach':'/api/bundle-attach',selected);
    if(context!==uiIdentity())return;
    attachmentConfirmed.checked=false;notice('The original case contains the complete selected encrypted source attachment.');
    await readAttachment();
  },supportActions);
  const attachmentRead=button('Read retained attachment',readAttachment,supportActions);
  const caseExport=button('Export whole attached case',async()=>{
    const selected=uiIdentity(),value=await post('/api/bundle-case-export',{profileId:profile.id,transferId:transfer.value,...attachmentIdentity()});
    if(selected!==uiIdentity())return;
    showDetails('Whole case with original encrypted archive',value);
    notice('The complete attached case revision, history and original binary source editions were exported.');
  },supportActions);
  const supportSummary=node('pre',undefined,support);
  async function loadSupportTransfers(){
    if(!profile?.supportConfigured)return;
    const epoch=generation,selected=profile.id,previous=transfer.value;
    const page=await api(query('/api/support-transfers',{profile:selected}));
    if(epoch!==generation||profile?.id!==selected||transfer.value!==previous)return;
    transfers=page.transfers.filter(row=>row.status==='SAVED_RECORDED');
    options(transfer,transfers.map(row=>({id:row.transferId,label:row.transferId+' · '+row.requestId})),previous);
    if(transfer.value!==previous){selectedSupport=null;pairPreview=null;attachmentConfirmed.checked=false;supportSummary.textContent='';}
    sync();
  }
  function uiIdentity(){return encoded([generation,profile?.id,action.value,id.value,source.value,
    archive.value,destination.value,sourceSide.value,transfer.value,caseRevision.value,actor.value,beforeExport.value,afterExport.value,pairPreview?.pairSha256,original?.operationId]);}
  function clear(){
    generation++;review=null;original=null;selectedSupport=null;pairPreview=null;confirmed.checked=false;attachmentConfirmed.checked=false;
    summary.textContent='';outcome.textContent='';supportSummary.textContent='';sync();
  }
  function intent(){
    if(!profile)throw new Error('Select a configured profile.');
    const input={profileId:profile.id,action:action.value,id:id.value.trim()};
    if(action.value==='object-bundle-receive')return {...input,archiveId:archive.value,objectSessionId:destination.value};
    const request=rows.find(row=>row.operationId===source.value);
    if(!request)throw new Error('Select the retained original Object request.');
    return {...input,sourceRequestId:request.operationId,sourceReviewHash:request.review.reviewHash,sourceAttempt:request.attempts,
      ...(request.review.command==='object-compare'?{sourceSide:sourceSide.value}:{})};
  }
  function drawReview(){summary.textContent=review?JSON.stringify(review,null,2):'';sync();}
  function drawOriginal(){outcome.textContent=original?JSON.stringify(original,null,2):'';sync();}
  async function readOriginal(){
    const epoch=generation,p=profile.id,operation=id.value.trim();
    const result=await api(query('/api/request',{profile:p,id:operation}));
    if(epoch!==generation||p!==profile.id||operation!==id.value.trim())return;
    if(!bundleAction(result.review.command))throw new Error('Select the original encrypted-bundle transfer operation.');
    original=result;review=null;confirmed.checked=false;attachmentConfirmed.checked=false;selectedSupport=null;drawReview();drawOriginal();
  }
  async function readReport(kind){
    const selected=original,epoch=generation;if(!selected)return;
    const result=await api(query('/api/bundle-report',{profile:profile.id,id:selected.operationId,kind}));
    if(epoch===generation&&original?.operationId===selected.operationId)showDetails('Retained '+kind,JSON.parse(result.content));
  }
  function exportHash(){const hash=original?.operation?.archive?.sha256;
    if(original?.review.command!=='object-bundle-export'||original.operation?.status!=='COMPLETE'||!HASH.test(hash??''))
      throw new Error('Read the completed original archive export first.');return hash;
  }
  function comparisonSupport(){return selectedSupport?.review.command==='object-compare';}
  function attachmentIdentity(){
    if(comparisonSupport()){
      if(!pairPreview||pairPreview.archives.before.requestId!==beforeExport.value||pairPreview.archives.after.requestId!==afterExport.value)
        throw new Error('Review the exact completed before/after archive pair first.');
      return {pairSha256:pairPreview.pairSha256};
    }
    return {archiveSha256:exportHash()};
  }
  function attachmentSelection(){
    const selectedIdentity=attachmentIdentity();if(!attachmentConfirmed.checked||!selectedSupport||selectedSupport.review.transferId!==transfer.value)
      throw new Error('Read and confirm this original saved Support transfer.');
    if(!HASH.test(caseRevision.value)||!actor.value.trim())throw new Error('Enter the current case revision and actual operator.');
    return {profileId:profile.id,transferId:transfer.value,
      expectedReviewSha256:selectedSupport.review.reviewSha256,expectedRevision:caseRevision.value,actor:actor.value,
      ...(comparisonSupport()?{beforeId:beforeExport.value,afterId:afterExport.value,expectedPairSha256:selectedIdentity.pairSha256}:{id:original.operationId})};
  }
  async function readAttachment(){
    const selected=uiIdentity(),identity=attachmentIdentity(),value=await api(query('/api/bundle-attachment',{profile:profile.id,id:transfer.value,sha256:identity.archiveSha256,pair:identity.pairSha256}));
    if(selected!==uiIdentity())return;
    supportSummary.textContent=JSON.stringify(value,null,2);attachmentConfirmed.checked=false;
  }
  function sync(){
    const receive=action.value==='object-bundle-receive';
    source.parentElement.hidden=receive;archive.parentElement.hidden=!receive;destination.parentElement.hidden=!receive;
    sourceSide.parentElement.hidden=receive||rows.find(row=>row.operationId===source.value)?.review.command!=='object-compare';
    const paired=comparisonSupport();beforeExport.parentElement.hidden=!paired;afterExport.parentElement.hidden=!paired;readPair.hidden=!paired;
    readPair.disabled=active||!beforeExport.value||!afterExport.value||!selectedSupport;
    for(const b of [prepare,reopen])b.disabled=closed||active||!profile||state?.readOnly;
    inspect.disabled=closed||active||!receive||!archive.value||state?.readOnly;
    start.disabled=active||!review||!confirmed.checked||!!state?.active||state?.readOnly;
    continueButton.disabled=active||!original||!confirmed.checked||original.running||original.phase==='COMPLETE'||state?.readOnly;
    cancel.disabled=active||!original?.running||state?.readOnly;
    report.disabled=active||!original?.operation?.report;
    verification.disabled=active||!original?.operation?.verification;
    publication.disabled=active||!original?.operation?.publication;
    for(const b of [artifact,saveFile])b.disabled=active||original?.operation?.status!=='COMPLETE'||original?.review.command!=='object-bundle-export';
    support.hidden=!profile?.caseSourceConfigured;
    refreshTransfers.disabled=closed||active||!profile?.supportConfigured;
    for(const b of [supportRead,attachmentRead,caseExport])b.disabled=active||!transfer.value;
    attach.disabled=active||!attachmentConfirmed.checked||!selectedSupport||(paired&&!pairPreview)||state?.readOnly;
  }
  async function work(button,fn){
    if(active||closed)return;active=true;sync();const epoch=generation;
    try{await fn();}
    catch(error){if(epoch===generation){confirmed.checked=false;attachmentConfirmed.checked=false;
      notice((error.code?error.code+': ':'')+error.message,true);}}
    finally{active=false;sync();}
  }
  for(const input of [action,id,source,sourceSide,archive,destination])input.addEventListener('input',clear);
  for(const input of [transfer,caseRevision,actor,beforeExport,afterExport])input.addEventListener('input',()=>{
    attachmentConfirmed.checked=false;if(input===transfer){selectedSupport=null;pairPreview=null;}if(input===beforeExport||input===afterExport)pairPreview=null;sync();});
  confirmed.addEventListener('change',sync);attachmentConfirmed.addEventListener('change',sync);
  return {
    isRequest:row=>bundleAction(row.review?.command),
    requestCard(row){
      const card=node('article');card.className='operation-card';
      node('h3',row.operationId,card);node('p',row.review.command+' · '+row.phase+' · attempt '+row.attempts,card);
      const open=node('button','Open encrypted transfer',card);open.type='button';
      open.addEventListener('click',()=>work(open,async()=>{
        if(row.profileId!==profile?.id)throw new Error('Select this operation’s original profile first.');
        clear();id.value=row.operationId;action.value=row.review.command;await readOriginal();root.scrollIntoView({block:'start'});
      }));return card;
    },
    async update(next,profileId,requestRows=[]){
      const selected=next?.profiles.find(row=>row.id===profileId)??null;
      const key=selected?encoded({workspace:next.id,profile:selected}):'';
      const changed=key!==profileKey;
      state=next;profile=selected;if(changed){profileKey=key;clear();transfers=[];transfer.replaceChildren();}
      rows=requestRows.filter(row=>row.profileId===profileId&&(['object-snapshot','object-verify','object-restore'].includes(row.review?.command)||row.review?.command==='object-compare'&&row.phase==='COMPLETE'));
      const beforeValue=beforeExport.value,afterValue=afterExport.value;
      const exported=requestRows.filter(row=>row.profileId===profileId&&row.review?.command==='object-bundle-export'&&row.operation?.status==='COMPLETE');
      for(const [side,control]of [['before',beforeExport],['after',afterExport]])options(control,
        exported.filter(row=>row.operation.sourceComparison?.side===side).map(row=>({id:row.operationId,label:row.operationId+' · '+row.operation.originalRequest.id})),control.value);
      if(beforeValue!==beforeExport.value||afterValue!==afterExport.value){pairPreview=null;attachmentConfirmed.checked=false;}
      const selectedId=source.value,previousTuple=sourceTuple;
      options(source,rows.map(row=>({id:row.operationId,label:row.operationId+' · '+row.phase+' · attempt '+row.attempts})),selectedId);
      const current=rows.find(row=>row.operationId===source.value);
      sourceTuple=current?encoded([current.operationId,current.review.reviewHash,current.attempts]):'';
      if(previousTuple&&sourceTuple!==previousTuple){review=null;confirmed.checked=false;drawReview();}
      options(archive,(profile?.objectBundleArchives??[]).map(row=>({id:row.id,label:row.label})),archive.value);
      options(destination,(profile?.objectSessions??[]).map(row=>({id:row.id,label:row.label+' · '+row.sessionId})),destination.value);
      if(original){
        const currentRequest=requestRows.find(row=>row.profileId===profileId&&row.operationId===original.operationId);
        if(currentRequest){
          if(currentRequest.attempts!==original.attempts||currentRequest.phase!==original.phase){confirmed.checked=false;attachmentConfirmed.checked=false;}
          original=currentRequest;drawOriginal();
        }
      }
      if(changed&&profile?.supportConfigured){
        const epoch=generation;
        try{await loadSupportTransfers();}catch(error){if(epoch===generation)notice(error.message,true);}
      }
      sync();
    },
    close(){closed=true;generation++;sync();}
  };
}
