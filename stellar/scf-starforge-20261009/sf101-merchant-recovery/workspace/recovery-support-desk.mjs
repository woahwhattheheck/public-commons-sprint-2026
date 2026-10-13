// SPDX-License-Identifier: MIT
// Original SF101 recovery request -> reviewed existing Support case.
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e;};
const objectCommand=value=>['object-snapshot','object-verify','object-restore','object-compare'].includes(value);
const query=(path,value)=>path+'?'+new URLSearchParams(value);
export function createRecoverySupportDesk({root,api,post,notice,showDetails}){
  let state=null,profileId='',requests=[],cases=[],nextOffset=null,transfers=[],review=null,result=null;
  let generation=0,busy=false,loadedProfile=null;
  const heading=make('h2','Send recovery evidence to Support');
  const intro=make('p','Select a saved recovery or backup-comparison request and an existing Support case. Review the exact capture before saving it into the case’s before or after slot.','hint');
  const external=make('p','The capture retains the complete original request and every referenced evidence or comparison artifact. Encrypted backups remain external; their paths and original record identities are preserved.','hint');
  const controls=make('div',undefined,'actions'),reload=make('button','Refresh cases and saved transfers'),more=make('button','Load more cases');
  reload.type=more.type='button';controls.append(reload,more);
  const form=make('form'),requestSelect=make('select'),caseSelect=make('select'),slot=make('select'),transfer=make('input');
  requestSelect.id='support-source-request';caseSelect.id='support-existing-case';slot.id='support-capture-slot';transfer.id='support-transfer-id';
  slot.append(new Option('After','after'),new Option('Before','before'));
  transfer.maxLength=64;transfer.pattern='[a-z0-9][a-z0-9_-]{0,63}';transfer.autocomplete='off';transfer.spellcheck=false;
  function field(text,node){const label=make('label',text);label.htmlFor=node.id;form.append(label,node);}
  field('Original recovery or comparison request',requestSelect);field('Existing Support case',caseSelect);
  field('Case observation slot',slot);field('Transfer ID',transfer);
  form.append(make('p','Keep this transfer ID after a lost response. A later case revision is preserved; the original transfer remains readable.','hint'));
  const prepare=make('button','Review complete capture','primary');prepare.type='submit';form.append(prepare);
  const reviewPanel=make('section'),summary=make('dl',undefined,'key-values'),confirmLabel=make('label'),confirm=make('input');
  confirm.type='checkbox';confirmLabel.append(confirm,document.createTextNode(' I reviewed this exact request, complete evidence/artifact inventory, case revision and slot.'));
  const reviewButtons=make('div',undefined,'actions'),save=make('button','Save reviewed case','primary'),detail=make('button','Full review'),handoff=make('button','Download Support handoff'),pack=make('button','Export full case and history'),inspect=make('button','Inspect saved package');
  for(const button of [save,detail,handoff,pack,inspect])button.type='button';
  reviewButtons.append(save,detail,handoff,pack,inspect);reviewPanel.append(make('h3','Retained transfer review'),summary,confirmLabel,reviewButtons);
  const savedPanel=make('section'),savedList=make('div',undefined,'compact-list');
  savedPanel.append(make('h3','Original saved transfers'),savedList);
  const status=make('p',undefined,'hint');status.setAttribute('role','status');
  root.replaceChildren(heading,intro,external,controls,form,reviewPanel,status,savedPanel);

  const selectedProfile=()=>state?.profiles?.find(p=>p.id===profileId);
  const source=()=>requests.find(r=>r.profileId===profileId&&r.operationId===requestSelect.value);
  const selectedCase=()=>cases.find(c=>c.id===caseSelect.value);
  const transferId=()=>transfer.value.trim();
  function setStatus(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
  function invalidate(){review=null;result=null;confirm.checked=false;drawReview();}
  function enable(){
    const writable=!!selectedProfile()?.supportConfigured&&!state?.readOnly&&!busy;
    for(const node of [requestSelect,caseSelect,slot,transfer,prepare])node.disabled=!writable;
    prepare.disabled=!writable||(!form.dataset.frozenSelection&&(!source()||source()?.running===true||!selectedCase()));
    reload.disabled=more.disabled=busy;more.hidden=nextOffset===null;
    confirm.disabled=!review||busy||!!result||state?.readOnly;
    save.disabled=!writable||!review||!confirm.checked||!!result;
    detail.disabled=!review||busy;handoff.disabled=!result||busy;
    pack.disabled=!writable||!result;inspect.disabled=!result||busy;
  }
  function drawReview(){
    reviewPanel.hidden=!review;
    summary.replaceChildren();
    if(review){
      const rows=[
        ['Transfer',review.transferId],['Original request',review.selection.id],
        ['Saved phase / attempt',review.phase+' / '+review.attempts],['Action / session',review.command+' / '+review.sessionId],
        ['Complete request SHA-256',review.request.sha256],[review.command==='object-compare'?'Comparison artifacts':'Evidence files',review.evidence.length],
        ['Retained source bytes',review.evidence.reduce((total,row)=>total+row.bytes,review.request.bytes)],
        ['Case',review.case.name+' · '+review.case.id],['Selected case revision',review.selection.expectedRevision],
        ['Observation slot',review.selection.slot+(review.replacing.present?' · replaces current slot in a new retained revision':'')],
        ['Review SHA-256',review.reviewSha256],
        ...(review.command==='object-compare'?[
          ['Before declared backup',review.comparison.beforeObjectSessionId],['Before external path',review.bundles.before.path],
          ['Before reviewed record',review.comparison.beforeExpectedRecordSha256],
          ['After declared backup',review.comparison.afterObjectSessionId],['After external path',review.bundles.after.path],
          ['After reviewed record',review.comparison.afterExpectedRecordSha256],
          ['Saved observation',review.custodyNote]
        ]:[['External backup',review.bundle.path],['Backup record',review.bundle.recordSha256??'No successful record is claimed']]),
        ...(result?[['Saved revision',result.revision],['Later case state','Reopening this transfer preserves the case’s current head.']]:[])
      ];
      for(const [key,value]of rows)summary.append(make('dt',key),make('dd',value,'mono'));
    }
    enable();
  }
  function drawSources(){
    const selected=requestSelect.value;requestSelect.replaceChildren(new Option('Choose original request',''));
    for(const row of requests.filter(r=>r.profileId===profileId&&objectCommand(r.review?.command)))
      requestSelect.append(new Option(row.operationId+' · '+row.phase+' · attempt '+row.attempts,row.operationId));
    if([...requestSelect.options].some(o=>o.value===selected))requestSelect.value=selected;
  }
  function drawCases(){
    const selected=caseSelect.value;caseSelect.replaceChildren(new Option('Choose existing case',''));
    for(const row of cases)caseSelect.append(new Option(row.name+' · '+row.metadata.status+' · '+row.id,row.id));
    if([...caseSelect.options].some(o=>o.value===selected))caseSelect.value=selected;
    enable();
  }
  function restoreSelection(selected){
    requestSelect.value=selected.id;caseSelect.value=selected.caseId;slot.value=selected.slot;transfer.value=selected.transferId;
  }
  async function run(action){
    if(busy)return;const epoch=generation;busy=true;enable();
    try{await action(()=>epoch===generation);}
    catch(error){if(epoch===generation){setStatus((error.code?error.code+': ':'')+error.message,true);
      notice('Support transfer: '+error.message,true);}}
    finally{busy=false;enable();}
  }
  async function readSaved(id,stillCurrent){
    const value=await api(query('/api/support-transfer',{profile:profileId,id}));
    if(!stillCurrent())return;
    confirm.checked=false;
    if(value.status==='PREPARATION_INCOMPLETE'){
      invalidate();restoreSelection(value.selection);
      // The complete frozen selection is retained even if the source/case list
      // has advanced. Continue only that original preparation.
      form.dataset.frozenSelection=JSON.stringify(value.selection);
      setStatus('Preparation was interrupted. Continue the original frozen selection; no case save is being replayed.');
      prepare.disabled=state?.readOnly||busy;
    }else{
      delete form.dataset.frozenSelection;review=value.review;result=value.result;restoreSelection(review.selection);drawReview();
      setStatus(result?'The original saved case revision is retained.':'Review the saved capture, then explicitly confirm its case save.');
    }
  }
  function drawTransfers(){
    savedList.replaceChildren();
    if(!transfers.length)savedList.append(make('p','No Support transfer is retained for this profile.','empty'));
    for(const row of transfers){
      const card=make('article'),button=make('button','Open original transfer');button.type='button';
      card.append(make('h4',row.transferId,'mono'),make('p',row.status+(row.case?' · '+row.case.name:''),'hint'),button);
      button.disabled=busy;button.addEventListener('click',()=>run(current=>readSaved(row.transferId,current)));savedList.append(card);
    }
  }
  async function load(stillCurrent,append=false){
    const currentProfile=profileId;
    const page=await api(query('/api/support-cases',{profile:currentProfile,offset:append?nextOffset??0:0,limit:100}));
    const saved=append?null:await api(query('/api/support-transfers',{profile:currentProfile}));
    if(!stillCurrent()||currentProfile!==profileId)return;
    cases=append?[...cases,...page.cases.filter(row=>!cases.some(old=>old.id===row.id))]:page.cases;
    nextOffset=page.nextOffset;drawCases();
    if(saved){transfers=saved.transfers;drawTransfers();}
    loadedProfile=profileId;setStatus('Existing Support cases and retained transfers loaded.');
  }
  reload.addEventListener('click',()=>run(current=>load(current)));
  more.addEventListener('click',()=>run(current=>load(current,true)));
  for(const node of [requestSelect,caseSelect,slot,transfer])node.addEventListener('change',()=>{
    delete form.dataset.frozenSelection;invalidate();
  });
  transfer.addEventListener('input',()=>{delete form.dataset.frozenSelection;invalidate();});
  confirm.addEventListener('change',enable);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    run(async current=>{
      const row=source(),target=selectedCase();
      const selected=form.dataset.frozenSelection?JSON.parse(form.dataset.frozenSelection):
        {profileId,id:row?.operationId,transferId:transferId(),caseId:target?.id,expectedRevision:target?.revision,
          slot:slot.value,expectedReviewHash:row?.review.reviewHash,afterAttempt:row?.attempts};
      confirm.checked=false;
      const value=await post('/api/support-review',selected);
      if(!current())return;
      review=value;result=null;delete form.dataset.frozenSelection;drawReview();
      setStatus('Complete source capture retained. Confirm its exact case revision and slot before saving.');
    });
  });
  save.addEventListener('click',()=>run(async current=>{
    if(!review||!confirm.checked)return;
    const selected={profileId,transferId:review.transferId,expectedReviewSha256:review.reviewSha256};
    // Clear confirmation before dispatch. A lost response is read back explicitly.
    confirm.checked=false;
    const value=await post('/api/support-save',selected);
    if(current()){result=value;drawReview();setStatus('Saved the original Support case revision '+value.revision+'.');}
  }));
  detail.addEventListener('click',()=>{if(review)showDetails({review,result});});
  handoff.addEventListener('click',()=>run(async current=>{
    const value=await api(query('/api/support-handoff',{profile:profileId,id:review.transferId}));
    if(!current())return;
    const data=new TextEncoder().encode(value.content);
    if(data.length!==value.bytes)throw new Error('The full Support handoff length differs.');
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(digest!==value.sha256)throw new Error('The complete Support handoff digest differs.');
    if(!current())return;
    const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=make('a');
    a.href=url;a.download=value.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setStatus('Downloaded the complete original Support handoff. Its encrypted native backup bytes remain external.');
  }));
  pack.addEventListener('click',()=>run(async current=>{
    const value=await post('/api/support-export',{profileId,transferId:review.transferId,expectedReviewSha256:review.reviewSha256});
    if(current()){showDetails(value);setStatus('Full original case/history package completed at '+value.directory+'. Use the original Support package receiver for independent reopening.');}
  }));
  inspect.addEventListener('click',()=>run(async current=>{
    const value=await api(query('/api/support-package',{profile:profileId,id:review.transferId}));
    if(current()){showDetails(value);setStatus('The complete saved package has been independently rechecked.');}
  }));
  return {
    update(value,id,rows=value?.requests??[]){
      const changed=profileId!==id;state=value;profileId=id;requests=rows;
      root.hidden=!selectedProfile()?.supportConfigured;
      if(changed){generation++;cases=[];transfers=[];nextOffset=null;loadedProfile=null;invalidate();
        delete form.dataset.frozenSelection;transfer.value='recovery-'+Date.now().toString(36);drawCases();drawTransfers();}
      drawSources();enable();
      if(!root.hidden&&loadedProfile!==profileId&&!busy)run(current=>load(current));
    }
  };
}
