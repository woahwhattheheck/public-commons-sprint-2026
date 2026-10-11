// MIT. Customer contract receiving and original-purchase operations in the private console.
export function createCustomerWorkbenchUI({api,token,refresh,notify}) {
  const $=selector=>document.querySelector(selector);
  const node=(tag,text,className)=>{const element=document.createElement(tag);
    if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
  const copy=value=>JSON.parse(JSON.stringify(value));
  const valuesFor=form=>Object.fromEntries([...form.elements].filter(field=>field.name)
    .map(field=>[field.name,field.value]));
  const short=value=>value?value.slice(0,12)+'…':'—';
  const form=$('#cw-configuration-form');
  let latest=null,draft=null,editorRevision=null,editorDirty=false,localBusy=false,jobRows=[];
  let selectionProfileId=null,historyOffset=0,historyPage=null;
  const running=()=>jobRows.some(job=>job.state==='RUNNING');
  const newPurchaseId=()=>'purchase-'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'-'+crypto.randomUUID().slice(0,8);
  const isValid=row=>!['CONTRACT_REVIEW_REQUIRED','PREPARATION_INCOMPLETE'].includes(row.phase);
  function locks() {
    $('#cw-fetch-fields').disabled=localBusy;
    $('#cw-intake-fields').disabled=localBusy;
    $('#cw-configuration-fields').disabled=localBusy;
    $('#cw-purchase-fields').disabled=localBusy || running() || !latest?.profile;
    $('#cw-load-saved').disabled=localBusy || !latest?.profile;
    $('#cw-refresh-contract').disabled=localBusy || !latest?.profile;
    $('#cw-previous').disabled=localBusy || historyOffset===0;
    $('#cw-next').disabled=localBusy || historyPage?.nextOffset==null;
    for(const control of document.querySelectorAll('[data-cw-operation]'))
      control.disabled=localBusy || running();
  }
  async function run(work) {
    if(localBusy)return;localBusy=true;locks();
    try{return await work();}
    catch(error){notify(error.message);}
    finally{localBusy=false;selectActiveProfile();locks();}
  }
  function bind(selector,event,handler) {
    $(selector).addEventListener(event,eventValue=>{eventValue.preventDefault();run(()=>handler(eventValue));});
  }
  function button(label,handler,{operation=false}={}) {
    const control=node('button',label);control.type='button';
    if(operation)control.dataset.cwOperation='';
    control.addEventListener('click',()=>run(handler));return control;
  }
  function showDetails(row) {
    $('#cw-purchase-details').textContent=JSON.stringify(row,null,2);
    $('#cw-purchase-detail').open=true;
  }
  function editStatus() {
    if(!draft)return;
    const stale=latest && editorRevision!==latest.revision;
    $('#cw-edit-status').textContent=stale?
      'Workspace revision changed. Load the saved configuration or review the imported contract again before saving.':
      'Editing revision '+editorRevision+' · '+(editorDirty?'Unsaved changes':'Ready to save');
    $('#cw-edit-status').classList.toggle('cw-stale',Boolean(stale));
  }
  function loadDraft(value,revision,difference) {
    draft=copy(value);editorRevision=revision;editorDirty=false;
    $('#cw-draft').hidden=false;
    $('#cw-draft-title').textContent=draft.contract.title+' · '+draft.contract.origin+
      ' · '+draft.contract.offers.length+' offers · contract '+short(draft.contract.sha256);
    const config=draft.configuration;
    const values={...config.operator,...config.signer,dependencyRoot:config.dependencyRoot,
      rpcUrl:config.rpcUrl??'',proxyEnv:config.transport?.proxyEnv??'',proxyUrl:config.transport?.proxyUrl??''};
    for(const [name,value]of Object.entries(values)){const field=form.elements.namedItem(name);if(field)field.value=value;}
    const body=$('#cw-limits');body.replaceChildren();
    config.assetLimits.forEach((limit,index)=>{
      const tr=node('tr'),asset=node('td');asset.append(node('strong',limit.network),node('small',limit.currency));
      tr.append(asset,node('td',String(limit.decimals)));
      for(const name of ['maxAtomic','maxFeeStroops']) {
        const td=node('td'),input=node('input');input.name=name+'-'+index;input.value=limit[name]??'100000';
        input.required=true;input.inputMode='numeric';input.pattern='[1-9][0-9]{0,18}';
        input.setAttribute('aria-label',(name==='maxAtomic'?'Maximum token amount':'Maximum network fee')+' for '+limit.currency);
        td.append(input);tr.append(td);
      }
      body.append(tr);
    });
    $('#cw-difference-content').textContent=difference?
      JSON.stringify(difference,null,2):'This is the first customer contract in the workspace.';
    $('#cw-difference').open=Boolean(difference?.changed);
    $('#cw-fetch-form').elements.namedItem('origin').value=draft.contract.origin;
    $('#cw-fetch-form').elements.namedItem('proxyEnv').value=config.transport?.proxyEnv??'';
    $('#cw-fetch-form').elements.namedItem('proxyUrl').value=config.transport?.proxyUrl??'';
    editStatus();locks();
  }
  function offerChanged({reset=false}={}) {
    const offer=latest?.profile?.contract.offers.find(value=>value.id===$('#cw-offer').value);
    if(!offer)return;
    if(reset){$('#cw-query').value='{}';$('#cw-body').value='';$('#cw-challenge-id').value='';
      $('#cw-purchase-id').value=newPurchaseId();}
    $('#cw-body').disabled=offer.method!=='POST';
    if(offer.method!=='POST')$('#cw-body').value='';
    const payment=offer.payment,digits=payment.amountAtomic.padStart(payment.decimals+1,'0');
    const amount=payment.decimals?digits.slice(0,-payment.decimals)+'.'+digits.slice(-payment.decimals):digits;
    $('#cw-offer-summary').textContent=offer.description+' · '+offer.method+' '+offer.url;
    const facts=$('#cw-offer-terms');facts.replaceChildren();
    for(const [label,value]of [['Price',amount+' ('+payment.amountAtomic+' atomic units)'],
      ['Network',payment.network],['Token',payment.currency],['Recipient',payment.recipient]]) {
      facts.append(node('dt',label),node('dd',value));
    }
    $('#cw-request-preview').textContent='Preview this offer with the selected query and body.';
  }
  function selectActiveProfile() {
    if(localBusy || !latest?.profile || latest.profileId===selectionProfileId)return;
    const old=$('#cw-offer').value;
    $('#cw-offer').replaceChildren(...latest.profile.contract.offers.map(offer=>{
      const option=node('option',offer.id+' · '+offer.description);option.value=offer.id;return option;
    }));
    if(latest.profile.contract.offers.some(offer=>offer.id===old))$('#cw-offer').value=old;
    selectionProfileId=latest.profileId;offerChanged({reset:true});
  }
  function requestInputs() {
    if(!latest?.profile || !selectionProfileId)throw new Error('Save a customer configuration first.');
    const query=JSON.parse($('#cw-query').value.trim()||'{}'),body=$('#cw-body').value.trim();
    return {query,...(body?{json:JSON.parse(body)}:{})};
  }
  async function start(path,body,message) {
    const job=await api('/api/customer-workbench/'+path,body);
    notify(message+' Operation '+job.id+'.');
    historyOffset=0;await refresh();return job;
  }
  async function resourcePreview(row) {
    const result=await api('/api/customer-workbench/purchases/'+encodeURIComponent(row.id)+'/preview');
    const {preview,...metadata}=result;
    $('#cw-resource-metadata').textContent=JSON.stringify(metadata,null,2);
    $('#cw-resource-preview').textContent=preview.kind==='text'?
      preview.text+(preview.truncated?'\n\nPreview truncated. Download the complete response.':''):
      'Binary resource. Download the original response to open it.';
    $('#cw-resource-detail').open=true;
  }
  async function download(row) {
    const response=await fetch('/api/customer-workbench/purchases/'+encodeURIComponent(row.id)+'/response',
      {headers:{authorization:'Bearer '+token}});
    if(!response.ok)throw new Error((await response.json()).error);
    const objectURL=URL.createObjectURL(await response.blob()),link=node('a');
    link.href=objectURL;link.download=row.id+'.bin';link.click();
    setTimeout(()=>URL.revokeObjectURL(objectURL),1000);
    notify('Original purchased response downloaded for '+row.id+'.');
  }
  function renderHistory(page) {
    historyPage=page;const body=$('#cw-purchases');body.replaceChildren();
    if(!page.items.length) {
      const tr=node('tr'),td=node('td','Prepare an offer to start the customer purchase history.','empty');
      td.colSpan=6;tr.append(td);body.append(tr);
    }
    for(const row of page.items) {
      const tr=node('tr'),identity=node('td'),controls=node('td');
      identity.append(node('strong',row.id),node('small',row.customer?.merchant??row.customer?.origin??'Merchant'));
      if(row.customer?.activeContractChanged)identity.append(node('small','Retained original contract'));
      controls.append(button('Details',()=>showDetails(row)));
      if(row.retryPreparation)controls.append(button('Retry preparation',
        ()=>start('retry-prepare',{id:row.id},'Original preparation queued'),{operation:true}));
      if(isValid(row) && ['REVIEW_READY','RESERVING','RESERVED','SIGNING'].includes(row.phase))
        controls.append(button('Execute',()=>start('execute',{id:row.id},
          'Purchase execution queued. Review the exact purchase in the operator terminal'),{operation:true}));
      if(isValid(row) && row.transaction) {
        controls.append(button('Recover',()=>start('resume',{id:row.id},'Original signed purchase recovery queued'),{operation:true}),
          button('Reconcile',()=>start('finalize',{id:row.id},'Original transfer reconciliation queued'),{operation:true}));
      }
      if(row.resourceReady)controls.append(button('View resource',()=>resourcePreview(row)),button('Download',()=>download(row)));
      const stage=node('td');stage.append(node('span',row.phase,'badge'));
      if(row.customer?.error || row.lastError)stage.append(node('small',row.customer?.error??row.lastError));
      tr.append(identity,node('td',row.customer?.offerId??'—'),stage,
        node('td',row.resourceReady?row.response.bytes+' bytes':row.response?
          'HTTP '+row.response.status+' · awaiting completed resource':'Awaiting response'),
        node('td',row.finality?.outcome??'Pending'),controls);
      body.append(tr);
    }
    $('#cw-page').textContent=page.total?
      (historyOffset+1)+'–'+Math.min(historyOffset+page.items.length,page.total)+' of '+page.total+' customer purchases':
      'No customer purchases yet';
    locks();
  }
  async function page(offset) {
    const view=await api('/api/customer-workbench?offset='+offset+'&limit=50');
    historyOffset=offset;renderHistory(view.purchases);
  }
  function render(value,jobs=[]) {
    if(!value)return;latest=value;
    jobRows=jobs.filter(job=>/customer/i.test(job.kind));
    $('#cw-status').textContent=value.profile?
      value.profile.contract.title+' · '+value.profile.contract.offers.length+' offers · saved contract '+
        short(value.profile.contract.sha256)+' · revision '+value.revision:
      'Import a customer contract or package to begin.';
    if(!draft && value.profile && !localBusy)loadDraft(value.profile,value.revision,null);
    selectActiveProfile();
    if(historyOffset===0)renderHistory(value.purchases);
    $('#cw-jobs').replaceChildren(...jobRows.slice(-6).reverse().map(job=>{
      const line=node('div',undefined,'job');
      line.append(node('strong',job.kind),node('span',job.error??job.state,'mono'),
        button('Details',()=>showDetails(job)));
      return line;
    }));
    editStatus();locks();
  }
  bind('#cw-document-file','change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    if(file.size>2*1024*1024)throw new Error('Customer document exceeds 2 MiB.');
    $('#cw-document').value=await file.text();
    notify('Customer document loaded. Review the imported contract to configure it.');
  });
  bind('#cw-intake-form','submit',async()=>{
    const documentValue=JSON.parse($('#cw-document').value);
    const result=await api('/api/customer-workbench/intake',{document:documentValue});
    loadDraft(result.draft,result.revision,result.difference);
    notify('Contract loaded for review. Set the customer limits and save the configuration.');
  });
  bind('#cw-fetch-form','submit',async event=>{
    const values=valuesFor(event.target),origin=values.origin;
    if(values.proxyEnv && values.proxyUrl)throw new Error('Choose one explicit proxy source.');
    const result=await api('/api/customer-workbench/fetch',{origin,...(values.proxyEnv || values.proxyUrl?
      {transport:{mode:'explicit-connect',origin,...(values.proxyEnv?{proxyEnv:values.proxyEnv}:{proxyUrl:values.proxyUrl})}}:{})});
    loadDraft(result.draft,result.revision,result.difference);
    notify('Current public merchant contract loaded for review.');
  });
  bind('#cw-load-saved','click',()=>{
    if(!latest?.profile)throw new Error('Save a customer configuration first.');
    loadDraft(latest.profile,latest.revision,null);
    notify('Saved customer configuration loaded.');
  });
  bind('#cw-refresh-contract','click',async()=>{
    const result=await api('/api/customer-workbench/refresh',{profileId:latest?.profileId});
    loadDraft(result.draft,result.revision,result.difference);
    notify(result.difference?.changed?'Merchant contract changed. Review its offers and save the selected limits.':
      'The current merchant contract matches the saved contract.');
  });
  form.addEventListener('input',()=>{editorDirty=true;editStatus();});
  bind('#cw-configuration-form','submit',async()=>{
    if(!draft)throw new Error('Receive a merchant contract first.');
    const values=valuesFor(form);
    const configuration={...copy(draft.configuration),
      operator:{python:values.python,ledger:values.ledger,policy:values.policy,actor:values.actor,service:values.service},
      signer:{payer:values.payer,keyEnv:values.keyEnv},dependencyRoot:values.dependencyRoot,
      assetLimits:draft.configuration.assetLimits.map((limit,index)=>({...limit,
        maxAtomic:values['maxAtomic-'+index],maxFeeStroops:values['maxFeeStroops-'+index]}))};
    delete configuration.rpcUrl;delete configuration.transport;
    if(values.rpcUrl)configuration.rpcUrl=values.rpcUrl;
    if(values.proxyEnv && values.proxyUrl)throw new Error('Choose one explicit proxy source.');
    if(values.proxyEnv || values.proxyUrl)configuration.transport={mode:'explicit-connect',origin:draft.contract.origin,
      ...(values.proxyEnv?{proxyEnv:values.proxyEnv}:{proxyUrl:values.proxyUrl})};
    const profile={...copy(draft),configuration};
    const result=await api('/api/customer-workbench/configure',{profile,revision:editorRevision});
    editorRevision=result.revision;editorDirty=false;draft=profile;
    historyOffset=0;await refresh();
    notify('Customer contract and limits saved. Select an offer to prepare.');
  });
  bind('#cw-offer','change',()=>offerChanged({reset:true}));
  bind('#cw-new-id','click',()=>{$('#cw-purchase-id').value=newPurchaseId();});
  bind('#cw-preview','click',async()=>{
    const result=await api('/api/customer-workbench/preview',{profileId:selectionProfileId,
      offerId:$('#cw-offer').value,inputs:requestInputs()});
    $('#cw-request-preview').textContent=JSON.stringify(result,null,2);
    $('#cw-request-detail').open=true;
    notify('Exact request and payment limits are ready to review.');
  });
  bind('#cw-purchase-form','submit',async()=>{
    const options={purchaseId:$('#cw-purchase-id').value,...requestInputs()};
    if($('#cw-challenge-id').value)options.challengeId=$('#cw-challenge-id').value;
    await start('prepare',{profileId:selectionProfileId,offerId:$('#cw-offer').value,options},
      'Original purchase preparation queued');
  });
  bind('#cw-refresh-history','click',async()=>{await refresh();if(historyOffset)await page(historyOffset);});
  bind('#cw-previous','click',()=>page(Math.max(0,historyOffset-50)));
  bind('#cw-next','click',()=>page(historyPage.nextOffset));
  return Object.freeze({render});
}
