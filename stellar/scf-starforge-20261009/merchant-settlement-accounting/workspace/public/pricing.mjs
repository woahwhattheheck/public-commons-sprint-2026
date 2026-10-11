// MIT. Original pricing-report custody and terms review in the merchant workspace.
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const exact=value=>value===null?'Unknown':value===undefined?'Not provided':typeof value==='object'?JSON.stringify(value,null,2):String(value);
const date=value=>value?new Date(value).toLocaleString():'Not provided';
const short=value=>value?String(value).slice(0,12)+'…':'Not provided';
const rows=values=>'<dl class="record-values">'+values.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(exact(value))+'</dd>').join('')+'</dl>';
const metrics=values=>values.map(([name,value])=>'<div class="metric"><span>'+esc(name)+'</span><strong>'+esc(exact(value))+'</strong></div>').join('');
const encode=value=>encodeURIComponent(value);
const PAGE=50;

export async function mountPricing({api,perform,operator,attempt,notify,openArea,loadRun}){
  const fragment=await fetch('/pricing.html',{cache:'no-store'});
  if(!fragment.ok)throw new Error('The original pricing workspace view could not be loaded.');
  $('area-pricing').innerHTML=await fragment.text();
  let state=null,busy=false,selected='',detail=null,pendingDetail=null,detailToken=0;
  let fileData=null,fileLoading=false,fileGeneration=0,reviewsLimit=24,optionOffset=0,optionSelected=null;
  let comparison=null,changeOffset=0,compareToken=0;

  function controls(){
    const usable=Boolean(state)&&!busy,chosen=Boolean(detail&&state?.termsSelection===detail.review.termsId);
    $('pricing-upload-form').querySelector('button[type=submit]').disabled=!usable||fileLoading||!fileData;
    $('pricing-select').disabled=!usable||!detail||chosen;
    $('pricing-run').disabled=!usable||!chosen||state.runs.some(run=>['queued','running'].includes(run.status));
    $('pricing-run-hint').textContent=chosen?'Captures these terms, their original pricing report, and the current selected merchant sources.':'Select these reviewed accounting terms before capturing a reconciliation.';
  }
  function selectedStatus(){
    if(!detail||!state)return;
    $('pricing-selection-state').textContent=state.termsSelection===detail.review.termsId?'Selected for future runs':'Retained review';
    controls();
  }
  function renderHistory(){
    if(!state)return;
    const search=$('pricing-history-search').value.trim().toLowerCase();
    const found=state.pricingImports.filter(record=>!search||[record.name,record.summary.merchantName,record.reportSha256,record.summary.observationKind].some(value=>String(value).toLowerCase().includes(search)));
    $('pricing-review-list').innerHTML=found.slice(0,reviewsLimit).map(record=>'<button type="button" data-pricing-review="'+esc(record.id)+'"'+(record.id===selected?' class="selected" aria-current="true"':'')+'><strong>'+esc(record.name)+'</strong><span>'+esc(record.summary.merchantName)+'</span><span>'+esc(date(record.createdAt))+' · '+esc(record.summary.paymentOptions)+' options</span></button>').join('')||'<p class="hint">No retained pricing reviews match this selection.</p>';
    $('pricing-reviews-more').hidden=found.length<=reviewsLimit;
    $('pricing-reviews-more').textContent='Show more ('+Math.max(0,found.length-reviewsLimit)+' remaining)';
  }
  function renderOptionDetail(){
    const option=detail?.options.find(item=>item.optionId===optionSelected);
    if(!option){$('pricing-option-detail').innerHTML='<p class="hint">Select an option to inspect its original terms and full quote description.</p>';return;}
    const source=detail.provenance.routes.find(item=>item.routeId===option.routeId&&item.method===option.method);
    $('pricing-option-detail').innerHTML='<h3>'+esc(option.method+' '+option.routeId)+'</h3>'+rows([
      ['Network',option.network],['Atomic amount',option.amountAtomic],['Asset',option.asset],['Recipient',option.payTo],
      ['Unit quote · USD',option.unitPriceUsd],['Unit variable cost · USD',option.unitCostUsd],['Accounting reference',option.priceBasis],
      ['Full original quote basis',source?.priceBasis],['Original route path',source?.path],['Original per-challenge cost · USD',source?.perChallengeUsd],['Payment option ID',option.optionId]
    ]);
  }
  function renderOptions(){
    if(!detail)return;
    const search=$('pricing-option-search').value.trim().toLowerCase(),found=detail.options.filter(option=>!search||JSON.stringify(option).toLowerCase().includes(search));
    optionOffset=Math.min(optionOffset,Math.max(0,Math.floor((found.length-1)/PAGE)*PAGE));
    $('pricing-options').innerHTML=found.slice(optionOffset,optionOffset+PAGE).map(option=>'<tr'+(option.optionId===optionSelected?' class="selected"':'')+'><td><button type="button" class="inspect" data-pricing-option="'+esc(option.optionId)+'">'+esc(option.method+' '+option.routeId)+'</button><span class="subtle">'+esc(option.network)+'</span><span class="subtle mono">'+esc(short(option.optionId))+'</span></td><td class="exact">'+esc(option.amountAtomic)+'</td><td class="exact">'+esc(exact(option.unitPriceUsd))+'</td><td class="exact">'+esc(exact(option.unitCostUsd))+'</td></tr>').join('')||'<tr><td colspan="4" class="empty">No payment options match this filter.</td></tr>';
    $('pricing-option-count').textContent=found.length?(optionOffset+1)+'–'+Math.min(optionOffset+PAGE,found.length)+' of '+found.length+' original options':'0 options';
    $('pricing-option-previous').disabled=optionOffset===0;$('pricing-option-next').disabled=optionOffset+PAGE>=found.length;
    renderOptionDetail();
  }
  function renderDetail(){
    $('pricing-empty').hidden=Boolean(detail);$('pricing-review-detail').hidden=!detail;$('pricing-compare-panel').hidden=!detail;
    if(!detail)return;
    const {review,provenance}=detail,summary=review.summary;
    $('pricing-review-title').textContent=review.name;
    $('pricing-review-by').textContent=review.actor+' · '+date(review.createdAt);
    $('pricing-metrics').innerHTML=metrics([['Original routes',summary.routes],['Payment options',summary.paymentOptions],['Options with unknown cost',summary.unknownUnitCostOptions]]);
    $('pricing-source-values').outerHTML=rows([
      ['Merchant',summary.merchantName],['Observation',summary.observationKind==='DURABLE_HISTORY'?'Retained merchant history':'Merchant session'],
      ['Observed from',summary.observedFrom],['Observed until',summary.observedUntil],['Accounting reference',summary.accountingReference??'Original route quote bases'],
      ['Original report SHA-256',review.reportSha256],['Accounting terms SHA-256',review.termsSha256]
    ]).replace('<dl ','<dl id="pricing-source-values" ');
    $('pricing-report-download').href='/api/pricing/reviews/'+encode(review.id)+'/download/report';
    $('pricing-terms-download').href='/api/pricing/reviews/'+encode(review.id)+'/download/terms';
    $('pricing-provenance').textContent=JSON.stringify(provenance,null,2);
    renderOptions();selectedStatus();
  }
  async function selectReview(id){
    if(!id)return;
    if(selected!==id){selected=id;comparison=null;changeOffset=0;optionOffset=0;optionSelected=null;renderComparison();}
    renderHistory();
    if(detail?.review.id===id){renderDetail();return;}
    if(pendingDetail?.id===id)return pendingDetail.promise;
    detail=null;renderDetail();const token=++detailToken;
    const promise=api('/api/pricing/reviews/'+encode(id)).then(result=>{
      if(token!==detailToken||selected!==id)return;detail=result;renderDetail();
    }).finally(()=>{if(pendingDetail?.token===token)pendingDetail=null;});
    pendingDetail={id,token,promise};return promise;
  }
  function renderComparison(){
    $('pricing-comparison').hidden=!comparison;if(!comparison)return;
    const kind=$('pricing-change-kind').value,found=comparison.items.filter(item=>kind==='all'||item.status===kind);
    changeOffset=Math.min(changeOffset,Math.max(0,Math.floor((found.length-1)/PAGE)*PAGE));
    $('pricing-comparison-metrics').innerHTML=metrics(Object.entries(comparison.summary).map(([key,value])=>[key[0].toUpperCase()+key.slice(1)+' options',value]));
    $('pricing-comparison-title').textContent=comparison.baseline.name+' → '+comparison.current.name+' · baseline SHA-256 '+comparison.baseline.sha256;
    const values=option=>option?'<dl class="changes">'+[['Atomic amount',option.amountAtomic],['Unit quote · USD',option.unitPriceUsd],['Unit variable cost · USD',option.unitCostUsd],['Accounting reference',option.priceBasis]].map(([key,value])=>'<dt>'+esc(key)+'</dt><dd>'+esc(exact(value))+'</dd>').join('')+'</dl>':'<span class="subtle">Option absent</span>';
    $('pricing-comparison-rows').innerHTML=found.slice(changeOffset,changeOffset+PAGE).map(item=>{
      const option=item.after||item.before;
      return '<tr><td><strong>'+esc(option.method+' '+option.routeId)+'</strong><span class="subtle">'+esc(option.network)+'</span><span class="subtle mono" title="'+esc(item.optionId)+'">'+esc(short(item.optionId))+'</span></td><td>'+esc(item.status)+(item.fields.length?'<span class="subtle">'+esc(item.fields.join(', '))+'</span>':'')+'</td><td>'+values(item.before)+'</td><td>'+values(item.after)+'</td></tr>';
    }).join('')||'<tr><td colspan="4" class="empty">No '+esc(kind==='all'?'payment':kind)+' options in this comparison.</td></tr>';
    $('pricing-change-count').textContent=found.length?(changeOffset+1)+'–'+Math.min(changeOffset+PAGE,found.length)+' of '+found.length+' options':'0 options';
    $('pricing-change-previous').disabled=changeOffset===0;$('pricing-change-next').disabled=changeOffset+PAGE>=found.length;
    $('pricing-comparison-context').textContent=JSON.stringify(comparison.provenance,null,2);
  }
  function currentUpload(){
    if(fileLoading||!fileData||$('pricing-report-file').files[0]!==fileData.file)throw new Error('Choose and finish loading the original pricing report.');
    const name=$('pricing-name').value.trim();if(!name)throw new Error('Name this pricing review.');
    return {name,reportBase64:fileData.base64,accountingReference:$('pricing-reference').value.trim()||undefined};
  }
  $('pricing-report-file').addEventListener('change',()=>attempt(async()=>{
    const file=$('pricing-report-file').files[0],generation=++fileGeneration;fileData=null;fileLoading=false;controls();
    if(!file){$('pricing-file-status').textContent='Use Report JSON from a saved merchant pricing version.';controls();return;}
    if(file.size===0||file.size>64*1024*1024)throw new Error('Choose a nonempty original pricing report up to 64 MiB.');
    fileLoading=true;controls();$('pricing-file-status').textContent='Loading the exact original file bytes…';
    try{
      const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The original report could not be read.'));reader.readAsDataURL(file);});
      if(generation!==fileGeneration)return;
      fileData={file,base64:String(url).slice(String(url).indexOf(',')+1)};
      if(!$('pricing-name').value.trim())$('pricing-name').value=file.name.replace(/\.json$/i,'').slice(0,130);
      $('pricing-file-status').textContent=file.name+' · '+file.size+' original bytes loaded';
    }finally{if(generation===fileGeneration){fileLoading=false;controls();}}
  }));
  $('pricing-upload-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    await perform({path:'/api/pricing/reviews',body:{revision:state.revision,actor:operator(),...currentUpload()},currentBody:currentUpload,
      description:'original pricing report review',message:result=>result.duplicate?'This exact report and accounting reference are already retained. Their existing selection is preserved.':'Original report and reviewed accounting terms retained. Inspect the options, then choose the terms for future reconciliations.',
      success:async result=>{await selectReview(result.review.id);$('pricing-review-title').scrollIntoView({block:'center',behavior:'smooth'});}});
  });});
  $('pricing-review-list').addEventListener('click',event=>{const button=event.target.closest('[data-pricing-review]');if(button)attempt(()=>selectReview(button.dataset.pricingReview));});
  $('pricing-history-search').addEventListener('input',()=>{reviewsLimit=24;renderHistory();});
  $('pricing-reviews-more').addEventListener('click',()=>{reviewsLimit+=24;renderHistory();});
  $('pricing-options').addEventListener('click',event=>{const button=event.target.closest('[data-pricing-option]');if(button){optionSelected=button.dataset.pricingOption;renderOptions();}});
  $('pricing-option-search').addEventListener('input',()=>{optionOffset=0;renderOptions();});
  $('pricing-option-previous').addEventListener('click',()=>{optionOffset=Math.max(0,optionOffset-PAGE);renderOptions();});
  $('pricing-option-next').addEventListener('click',()=>{optionOffset+=PAGE;renderOptions();});
  $('pricing-select').addEventListener('click',()=>attempt(async()=>{
    if(!detail)return;
    await perform({path:'/api/pricing/reviews/'+encode(detail.review.id)+'/selection',body:{revision:state.revision,actor:operator()},description:'reviewed pricing terms selection',message:'Reviewed accounting terms selected. The next reconciliation retains this original report with its terms.'});
  }));
  $('pricing-run-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    if(!detail)return;const selectedTerms=detail.review.termsId;
    const currentBody=()=>({name:$('pricing-run-name').value.trim(),expectedTermsSelection:selectedTerms});
    await perform({path:'/api/runs',body:{revision:state.revision,actor:operator(),...currentBody()},currentBody,description:'reconciliation with reviewed pricing',message:'Reconciliation queued with the selected terms and their original pricing report.',success:async result=>{await loadRun(result.run.id,{reset:true});openArea('reconcile');}});
  });});
  $('pricing-compare-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    if(!detail)return;const token=++compareToken,id=detail.review.id;
    const result=await api('/api/pricing/reviews/'+encode(id)+'/compare?'+new URLSearchParams({baseline:$('pricing-compare-baseline').value}));
    if(token!==compareToken||selected!==id)return;comparison=result;changeOffset=0;renderComparison();
  });});
  $('pricing-compare-baseline').addEventListener('change',()=>{comparison=null;++compareToken;renderComparison();});
  $('pricing-change-kind').addEventListener('change',()=>{changeOffset=0;renderComparison();});
  $('pricing-change-previous').addEventListener('click',()=>{changeOffset=Math.max(0,changeOffset-PAGE);renderComparison();});
  $('pricing-change-next').addEventListener('click',()=>{changeOffset+=PAGE;renderComparison();});

  return {
    render(next){
      state=next;
      const selectedTerms=state.termsImports.find(item=>item.id===state.termsSelection);
      $('pricing-saved-selection').textContent='Current accounting selection: '+(selectedTerms?.name??'Original source terms');
      const baseline=$('pricing-compare-baseline'),previous=baseline.value||state.termsSelection;
      const choices=[['source','Original source terms'],...state.termsImports.map(item=>[item.id,item.name])];
      const html=choices.map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');
      if(baseline.innerHTML!==html)baseline.innerHTML=html;
      baseline.value=choices.some(([id])=>id===previous)?previous:'source';
      if(!state.pricingImports.some(item=>item.id===selected))selected=state.pricingImports[0]?.id??'';
      renderHistory();selectedStatus();controls();if(selected)attempt(()=>selectReview(selected));
    },
    setBusy(value){busy=value;controls();},
    renderRun(result){
      const container=$('run-pricing'),pricing=result?.pricing;container.hidden=!pricing;
      if(!pricing){container.innerHTML='';return;}
      container.innerHTML='<h3>Captured pricing decision · '+esc(pricing.name)+'</h3>'+rows([
        ['Merchant',pricing.summary.merchantName],['Pricing observation',pricing.summary.observationKind],['Observed from',pricing.summary.observedFrom],['Observed until',pricing.summary.observedUntil],['Original report SHA-256',pricing.reportSha256],['Accounting terms SHA-256',pricing.termsSha256]
      ])+'<div class="actions"><a class="button" download href="/api/runs/'+encode(result.run.id)+'/pricing/download/report">Download captured pricing report</a><a class="button" download href="/api/runs/'+encode(result.run.id)+'/pricing/download/terms">Download captured accounting terms</a></div>';
    }
  };
}
