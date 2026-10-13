const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const present=value=>value!==null&&value!==undefined&&String(value)!=='';
const text=(root,name)=>root.querySelector('[name="'+name+'"]')?.value??'';
const selected=(root,name)=>[...(root.querySelector('[name="'+name+'"]')?.selectedOptions||[])].map(row=>row.value);
const optional=(root,name)=>text(root,name).trim()||null;
const currencyCode=value=>String(value||'').trim().toUpperCase();

export function formatNativeMoney(amount,currency){
  if(!present(amount))return 'Amount not entered';
  const raw=String(amount),match=/^([+-]?)(\d+)(\.\d+)?$/.exec(raw);
  const number=match?match[1]+match[2].replace(/\B(?=(\d{3})+(?!\d))/g,',')+(match[3]||''):raw;
  return (currencyCode(currency)||'Unspecified currency')+' '+number;
}
export function formatCurrencyValuation(amountUsd){
  return present(amountUsd)?formatNativeMoney(amountUsd,'USD'):'Unvalued';
}

export function createForecastCurrencyUI({current,field,table,button,usd}){
  const cashById=new Map((current.records?.cash||[]).map(row=>[row.id,row]));
  const invoicesById=new Map((current.records?.invoices||[]).map(row=>[row.id,row]));
  const attachments=new Map((current.sources||[]).map(row=>[row.id,row]));
  function refreshCurrent(){
    for(const [map,rows] of [[cashById,current.records?.cash||[]],[invoicesById,current.records?.invoices||[]],[attachments,current.sources||[]]]){
      map.clear();for(const row of rows)map.set(row.id,row);
    }
  }
  const money=(amount,currency)=>esc(formatNativeMoney(amount,currency));
  const valuation=amount=>esc(formatCurrencyValuation(amount));
  const allocation=(amount,currency,known)=>present(amount)?money(amount,currency):'<span class="forecast-unvalued">Unresolved native allocation</span>'+(present(known)?'<small>Known credited portion: '+money(known,currency)+'</small>':'');
  const foreign=currency=>currencyCode(currency)!==''&&currencyCode(currency)!=='USD';
  const setActive=(node,enabled,busy)=>{
    node.disabled=busy||!enabled;
    node.dataset.forecastFixed=String(!enabled);
  };
  const originalLink=url=>{
    if(!url)return '';
    try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)return esc(url);}
    catch{return esc(url);}
    return '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(url)+'</a>';
  };
  const nativeOrigin=row=>{
    if(!row)return 'Original record unavailable';
    const amount=row.amount??row.amountNative;
    const denomination=row.currency||row.assetCode||row.asset;
    return (present(amount)&&denomination?formatNativeMoney(amount,denomination)+' · ':'')+'recorded '+usd(row.usdValue);
  };
  function sourceOptions(ids=[]){
    const rows=[...attachments.values()].map(row=>[row.id,row.filename+' · '+row.sha256.slice(0,12)]);
    for(const id of ids)if(!attachments.has(id))rows.push([id,'Retained attachment '+id+' (unavailable in current case)']);
    return rows;
  }
  function rateOptions(rates,currency,rateId){
    const denomination=currencyCode(currency),rows=[['','Leave unvalued until a rate is selected']];
    for(const rate of rates){
      const base=currencyCode(rate.baseCurrency),quote=currencyCode(rate.quoteCurrency);
      if(denomination&&denomination!=='USD'&&!((base===denomination&&quote==='USD')||(quote===denomination&&base==='USD')))continue;
      rows.push([rate.id,rate.id+' · 1 '+(base||'base')+' = '+(rate.rate||'?')+' '+(quote||'quote')+' · '+(rate.observationDate||'observation date not entered')]);
    }
    if(rateId&&!rows.some(row=>row[0]===rateId))rows.push([rateId,rateId+' · selected rate is missing or has a different currency pair']);
    return rows;
  }
  function rateEditor(rate){
    return '<fieldset data-forecast-fx class="forecast-fx-rate"><legend>Original exchange-rate source</legend><div class="forecast-actions">'+button('Remove rate','remove-fx')+'</div><div class="forecast-fields">'
      +field('Rate identity','fxId',rate.id||'',{required:true,help:'Keep this identity when correcting the same source; saved forecasts retain their original rate.'})
      +field('Source basis','fxBasis',rate.basis||'',{required:true,options:[['','Choose the source basis'],['REFERENCE_OBSERVATION','Published reference observation'],['PLANNING_ASSUMPTION','Explicit planning assumption']]})
      +field('Base currency','fxBaseCurrency',rate.baseCurrency||'',{required:true,placeholder:'ZAR',help:'Three-letter code. Exactly one side must be USD.'})
      +field('Quote currency','fxQuoteCurrency',rate.quoteCurrency||'',{required:true,placeholder:'USD'})
      +field('Quote units per 1 base unit','fxRate',rate.rate||'',{required:true,help:'Enter the original positive decimal, up to 18 decimal places. No current rate is fetched.'})
      +field('USD cent rounding','fxRounding',rate.rounding||'HALF_UP',{required:true,options:[['HALF_UP','Half up'],['HALF_EVEN','Half even']]})
      +field('Original observation date','fxObservationDate',rate.observationDate||'',{type:'date',required:true})
      +field('Publication date, if applicable','fxPublicationDate',rate.publicationDate||'',{type:'date',help:'The observation, publication and forecast as-of dates must stay in chronological order.'})
      +field('Original source URL','fxSourceUrl',rate.sourceUrl||'',{type:'url',wide:true})
      +field('Retained rate source attachments','fxSourceIds',rate.sourceIds||[],{options:sourceOptions(rate.sourceIds),multiple:true,wide:true})
      +field('Original publication, table or quotation reference','fxSourceReference',rate.sourceReference||'',{wide:true})
      +field('Assumption or source note','fxNote',rate.note||'',{area:true,wide:true,help:'Required for a planning assumption. Describe the assumption without presenting it as an observed current rate.'})
      +'</div><p class="forecast-fx-direction" data-forecast-fx-direction></p></fieldset>';
  }
  function ratesEditor(inputs){
    const rates=inputs.fxRates||[];
    return '<details'+(rates.length?' open':'')+'><summary>Original currencies and rate sources</summary><p>Each native quote retains its original amount. Select an explicit dated source to value it in USD. A missing rate leaves the USD amount unvalued.</p><div data-forecast-fx-rates>'+rates.map(rateEditor).join('')+'</div>'+button('Add exchange-rate source','add-fx')+'</details>';
  }
  function readRates(form){
    return [...form.querySelectorAll('[data-forecast-fx]')].map(row=>({
      id:text(row,'fxId'),baseCurrency:text(row,'fxBaseCurrency'),quoteCurrency:text(row,'fxQuoteCurrency'),rate:text(row,'fxRate'),
      observationDate:text(row,'fxObservationDate'),publicationDate:optional(row,'fxPublicationDate'),
      basis:text(row,'fxBasis'),rounding:text(row,'fxRounding'),sourceUrl:text(row,'fxSourceUrl'),
      sourceIds:selected(row,'fxSourceIds'),sourceReference:text(row,'fxSourceReference'),note:text(row,'fxNote')
    }));
  }
  function pricingEditor(project,rates){
    const native=project.nativePricing,price=native?.price||{},cost=native?.deliveryCost||{};
    return '<section class="forecast-currency-entry"><div class="forecast-currency-mode">'+field('Quote and delivery-cost entry','pricingMode',native?'NATIVE':'LEGACY_USD',{options:[['LEGACY_USD','Original USD amounts'],['NATIVE','Native currency amounts with explicit valuation']]})+'</div>'
      +'<div data-forecast-legacy-pricing class="forecast-fields">'
      +field('Original total quoted price (USD)','priceUsd',project.priceUsd??'',{required:!native})
      +field('Current total customer-specific delivery cost (USD)','totalDeliveryCostUsd',project.totalDeliveryCostUsd??'',{required:!native,help:'Includes linked invoices and assigned direct payments. Existing reusable product development stays in its original scope.'})+'</div>'
      +'<div data-forecast-native-pricing'+(native?'':' hidden')+'><p class="forecast-currency-explanation">Enter the original quoted units deliberately. Switching entry modes keeps the other mode’s unsaved fields separate; it does not convert or relabel them.</p><div class="forecast-fields">'
      +'<section class="forecast-currency-price"><h5>Original customer price</h5><div class="forecast-fields">'
      +field('Original native price','nativePriceAmount',price.amount??'',{required:!!native})
      +field('Quoted currency','nativePriceCurrency',price.currency||'',{required:!!native,placeholder:'ZAR'})
      +field('Rate used for the price','nativePriceRate',price.fxRateId||'',{options:rateOptions(rates,price.currency,price.fxRateId),wide:true,help:'USD uses its original units. A foreign quote can remain unvalued until an explicit source is selected.'})+'</div></section>'
      +'<section class="forecast-currency-cost"><h5>Customer-specific delivery cost</h5><div class="forecast-fields">'
      +field('Original native delivery cost','nativeCostAmount',cost.amount??'',{required:!!native})
      +field('Delivery-cost currency','nativeCostCurrency',cost.currency||'',{required:!!native,placeholder:'USD'})
      +field('Rate used for the delivery cost','nativeCostRate',cost.fxRateId||'',{options:rateOptions(rates,cost.currency,cost.fxRateId),wide:true,help:'Price and cost may use different currencies and different retained rates.'})+'</div></section></div></div></section>';
  }
  function receiptFields(receipt,native){
    return '<span data-forecast-legacy-receipt'+(native?' hidden':'')+'><input name="receiptAmount" aria-label="Quoted milestone USD" value="'+esc(receipt.amountUsd??'')+'"'+(native?'':' required')+'></span>'
      +'<span data-forecast-native-receipt'+(native?'':' hidden')+'><input name="receiptAmountNative" aria-label="Original native milestone amount" value="'+esc(receipt.amountNative??'')+'"'+(native?' required':'')+'></span>';
  }
  function priceCreditRow(id,credit={}){
    const original=cashById.get(id);
    return '<div class="forecast-currency-credit" data-native-price-credit="'+esc(id)+'"><p><strong>'+esc(original?.externalRef||id)+'</strong><small>'+esc((original?.date||'Undated')+' · '+nativeOrigin(original))+'</small><small>Original cash ID: '+esc(id)+'</small></p>'
      +field('Credit in quoted currency','priceCreditAmount',credit.amount??'')
      +field('Original allocation basis','priceCreditNote',credit.note||'',{area:true,help:'State how these original quoted units correspond to this recorded receipt.'})+'</div>';
  }
  function costCreditRow(kind,id,credit={}){
    const original=kind==='INVOICE'?invoicesById.get(id):cashById.get(id);
    const label=kind==='INVOICE'?(original?.number||id):(original?.externalRef||id);
    const basis=kind==='INVOICE'?('Original invoice total '+usd(original?.totalUsd)+' · '+(original?.state||'unavailable')):nativeOrigin(original);
    return '<div class="forecast-currency-credit" data-native-cost-credit="'+esc(kind+':'+id)+'" data-credit-kind="'+kind+'" data-credit-id="'+esc(id)+'"><p><strong>'+esc(label)+'</strong><small>'+esc(basis)+'</small><small>'+esc(kind==='INVOICE'?'Original invoice ID: ':'Original cash ID: ')+esc(id)+'</small></p>'
      +field('Credit in delivery-cost currency','costCreditAmount',credit.amount??'')
      +field('Original allocation basis','costCreditNote',credit.note||'',{area:true,help:'Retain the basis for assigning these original cost units; recorded invoice and cash values stay unchanged.'})+'</div>';
  }
  function creditEditor(project){
    const native=project.nativePricing||{},prices=new Map((native.priceCredits||[]).map(row=>[row.cashId,row])),costs=new Map((native.costCredits||[]).map(row=>[row.kind+':'+row.id,row]));
    const priceIds=[...new Set([...(project.cashIds||[]),...prices.keys()])];
    const costIds=[...(project.invoiceIds||[]).filter(id=>invoicesById.get(id)?.state!=='VOID').map(id=>['INVOICE',id]),...(project.directCashIds||[]).map(id=>['DIRECT_CASH',id])];
    for(const row of costs.values())if(!costIds.some(([kind,id])=>kind===row.kind&&id===row.id))costIds.push([row.kind,row.id]);
    return '<section class="forecast-currency-credits" data-forecast-native-credits'+(project.nativePricing?'':' hidden')+'><h5>Original receipt and cost allocations</h5><p>Foreign-currency allocations need an explicit amount in the quote or cost currency and a basis note. Leave both blank while unresolved. Original recorded USD is retained separately.</p>'
      +'<div data-native-price-credits><h5>Customer receipts in quoted units</h5><p data-native-price-credit-empty class="forecast-muted">Select original customer cash records above to allocate receipts.</p><div data-native-price-credit-rows>'+priceIds.map(id=>priceCreditRow(id,prices.get(id))).join('')+'</div></div>'
      +'<div data-native-cost-credits><h5>Invoices and direct payments in cost units</h5><p data-native-cost-credit-empty class="forecast-muted">Select original invoices or direct payments above to allocate delivery costs.</p><div data-native-cost-credit-rows>'+costIds.map(([kind,id])=>costCreditRow(kind,id,costs.get(kind+':'+id))).join('')+'</div></div>'
      +'<p data-native-usd-credit-note class="forecast-muted">For USD amounts, the original eligible cash and invoice values are applied automatically.</p></section>';
  }
  function selectedCostKeys(project){
    return new Set([...selected(project,'invoiceIds').filter(id=>invoicesById.get(id)?.state!=='VOID').map(id=>'INVOICE:'+id),...selected(project,'directCashIds').map(id=>'DIRECT_CASH:'+id)]);
  }
  function syncCredits(project,{busy=false}={}){
    const native=text(project,'pricingMode')==='NATIVE',priceForeign=foreign(text(project,'nativePriceCurrency')),costForeign=foreign(text(project,'nativeCostCurrency'));
    const priceIds=new Set(selected(project,'cashIds')),costIds=selectedCostKeys(project);
    const priceContainer=project.querySelector('[data-native-price-credit-rows]'),costContainer=project.querySelector('[data-native-cost-credit-rows]');
    for(const id of priceIds)if(![...priceContainer.children].some(row=>row.dataset.nativePriceCredit===id))priceContainer.insertAdjacentHTML('beforeend',priceCreditRow(id));
    for(const key of costIds)if(![...costContainer.children].some(row=>row.dataset.nativeCostCredit===key)){
      const split=key.indexOf(':');costContainer.insertAdjacentHTML('beforeend',costCreditRow(key.slice(0,split),key.slice(split+1)));
    }
    for(const row of priceContainer.children){
      const enabled=native&&priceForeign&&priceIds.has(row.dataset.nativePriceCredit);row.hidden=!enabled;
      row.querySelectorAll('input,textarea,select').forEach(node=>setActive(node,enabled,busy));
    }
    for(const row of costContainer.children){
      const enabled=native&&costForeign&&costIds.has(row.dataset.nativeCostCredit);row.hidden=!enabled;
      row.querySelectorAll('input,textarea,select').forEach(node=>setActive(node,enabled,busy));
    }
    project.querySelector('[data-forecast-native-credits]').hidden=!native;
    project.querySelector('[data-native-price-credits]').hidden=!priceForeign;
    project.querySelector('[data-native-cost-credits]').hidden=!costForeign;
    project.querySelector('[data-native-price-credit-empty]').hidden=priceIds.size>0;
    project.querySelector('[data-native-cost-credit-empty]').hidden=costIds.size>0;
    project.querySelector('[data-native-usd-credit-note]').hidden=priceForeign&&costForeign;
    for(const input of priceContainer.querySelectorAll('[name=priceCreditAmount]'))input.setAttribute('aria-label','Credit in '+(currencyCode(text(project,'nativePriceCurrency'))||'quoted currency'));
    for(const input of costContainer.querySelectorAll('[name=costCreditAmount]'))input.setAttribute('aria-label','Credit in '+(currencyCode(text(project,'nativeCostCurrency'))||'delivery-cost currency'));
  }
  function syncPricing(project,{busy=false}={}){
    const native=text(project,'pricingMode')==='NATIVE';
    const legacy=project.querySelector('[data-forecast-legacy-pricing]'),nativeBlock=project.querySelector('[data-forecast-native-pricing]');
    legacy.hidden=native;nativeBlock.hidden=!native;
    legacy.querySelectorAll('input,select,textarea').forEach(node=>{node.required=!native;setActive(node,!native,busy);});
    nativeBlock.querySelectorAll('input,select,textarea').forEach(node=>{
      const isRate=['nativePriceRate','nativeCostRate'].includes(node.name),denomination=text(project,node.name==='nativePriceRate'?'nativePriceCurrency':'nativeCostCurrency');
      node.required=native&&!isRate;setActive(node,native&&(!isRate||currencyCode(denomination)!=='USD'),busy);
    });
    for(const row of project.querySelectorAll('[data-forecast-receipt]')){
      row.querySelector('[data-forecast-legacy-receipt]').hidden=native;row.querySelector('[data-forecast-native-receipt]').hidden=!native;
      for(const [name,enabled] of [['receiptAmount',!native],['receiptAmountNative',native]]){
        const node=row.querySelector('[name="'+name+'"]');node.required=enabled;setActive(node,enabled,busy);
      }
      row.querySelector('[name=receiptAmountNative]').setAttribute('aria-label','Original milestone in '+(currencyCode(text(project,'nativePriceCurrency'))||'quoted currency'));
    }
    project.querySelector('[data-forecast-receipt-amount-heading]').textContent=native?'Quoted '+(currencyCode(text(project,'nativePriceCurrency'))||'native amount'):'Quoted USD';
    syncCredits(project,{busy});
  }
  function readPricing(project,{forRecovery=false}={}){
    if(text(project,'pricingMode')!=='NATIVE')return {priceUsd:text(project,'priceUsd'),totalDeliveryCostUsd:text(project,'totalDeliveryCostUsd')};
    const priceCurrency=text(project,'nativePriceCurrency'),costCurrency=text(project,'nativeCostCurrency');
    const priceIds=new Set(selected(project,'cashIds')),costIds=selectedCostKeys(project);
    function completeCredit(row,amountName,noteName,label){
      const amount=text(row,amountName),note=text(row,noteName);
      if(!amount.trim()&&!note.trim())return null;
      if(!forRecovery&&(!amount.trim()||!note.trim()))throw new Error(label+' needs both a native amount and its original allocation basis. Leave both blank if unresolved.');
      return {amount,note};
    }
    const priceCredits=[],costCredits=[];
    if(foreign(priceCurrency))for(const row of project.querySelectorAll('[data-native-price-credit]')){
      if(!priceIds.has(row.dataset.nativePriceCredit))continue;
      const entry=completeCredit(row,'priceCreditAmount','priceCreditNote','Customer cash '+row.dataset.nativePriceCredit);if(entry)priceCredits.push({cashId:row.dataset.nativePriceCredit,...entry});
    }
    if(foreign(costCurrency))for(const row of project.querySelectorAll('[data-native-cost-credit]')){
      if(!costIds.has(row.dataset.nativeCostCredit))continue;
      const entry=completeCredit(row,'costCreditAmount','costCreditNote','Delivery cost '+row.dataset.creditId);if(entry)costCredits.push({kind:row.dataset.creditKind,id:row.dataset.creditId,...entry});
    }
    return {nativePricing:{
      price:{amount:text(project,'nativePriceAmount'),currency:priceCurrency,fxRateId:currencyCode(priceCurrency)==='USD'?null:optional(project,'nativePriceRate')},
      deliveryCost:{amount:text(project,'nativeCostAmount'),currency:costCurrency,fxRateId:currencyCode(costCurrency)==='USD'?null:optional(project,'nativeCostRate')},
      priceCredits,costCredits
    }};
  }
  function readReceiptAmount(project,receipt){
    return text(project,'pricingMode')==='NATIVE'?{amountNative:text(receipt,'receiptAmountNative')}:{amountUsd:text(receipt,'receiptAmount')};
  }
  function syncRates(form,{busy=false}={}){
    if(!form)return;
    const rates=readRates(form),asOf=text(form,'asOfDate');
    for(const row of form.querySelectorAll('[data-forecast-fx]')){
      const base=currencyCode(text(row,'fxBaseCurrency'))||'base',quote=currencyCode(text(row,'fxQuoteCurrency'))||'quote',rate=text(row,'fxRate')||'?';
      row.querySelector('[data-forecast-fx-direction]').textContent='Direction: 1 '+base+' = '+rate+' '+quote+'. Observation: '+(text(row,'fxObservationDate')||'not entered')+'.';
      const observation=row.querySelector('[name=fxObservationDate]'),publication=row.querySelector('[name=fxPublicationDate]');
      observation.max=publication.value||asOf;publication.max=asOf;publication.min=observation.value;
      row.querySelector('[name=fxNote]').required=text(row,'fxBasis')==='PLANNING_ASSUMPTION';
    }
    for(const project of form.querySelectorAll('[data-forecast-commercial]')){
      for(const [name,currencyName] of [['nativePriceRate','nativePriceCurrency'],['nativeCostRate','nativeCostCurrency']]){
        const select=project.querySelector('[name="'+name+'"]'),prior=select.value;
        select.innerHTML=rateOptions(rates,text(project,currencyName),prior).map(([id,label])=>'<option value="'+esc(id)+'"'+(id===prior?' selected':'')+'>'+esc(label)+'</option>').join('');
      }
      syncPricing(project,{busy});
    }
  }
  function handleAction(action,target,form,{busy=false}={}){
    if(!form)return false;
    if(action==='add-fx'){
      form.querySelector('[data-forecast-fx-rates]').insertAdjacentHTML('beforeend',rateEditor({id:'fx-'+crypto.randomUUID()}));
      form.dataset.forecastFxTouched='true';syncRates(form,{busy});return true;
    }
    if(action==='remove-fx'){
      target.closest('[data-forecast-fx]').remove();form.dataset.forecastFxTouched='true';syncRates(form,{busy});return true;
    }
    return false;
  }
  function handleChange(target,form,{busy=false}={}){
    if(!form)return;
    if(target.closest('[data-forecast-fx]')||target.name==='asOfDate'||['nativePriceCurrency','nativeCostCurrency'].includes(target.name)){syncRates(form,{busy});return;}
    if(['pricingMode','cashIds','invoiceIds','directCashIds'].includes(target.name)){
      const project=target.closest('[data-forecast-commercial]');if(project)syncPricing(project,{busy});
    }
  }
  function rateDetail(rate){
    if(!rate)return 'No retained rate selected';
    return '1 '+esc(rate.baseCurrency)+' = '+esc(rate.rate)+' '+esc(rate.quoteCurrency)+'<small>Observed '+esc(rate.observationDate)+(rate.publicationDate?' · published '+esc(rate.publicationDate):'')+' · '+esc(rate.basis==='PLANNING_ASSUMPTION'?'Planning assumption':'Reference observation')+'</small><small>'+esc(rate.rounding==='HALF_EVEN'?'Half-even USD cent rounding':'Half-up USD cent rounding')+'</small>';
  }
  function reportCoverage(report){
    const coverage=report.currencyValuation;if(!coverage)return '';
    const rates=coverage.rates||[];
    return '<section class="forecast-currency-coverage" aria-label="Native currency valuation coverage"><h5>Currency valuation and dated cash coverage</h5><p class="forecast-coverage-state">'+esc(coverage.complete?'Complete native scope valuation':'Native scope valuation incomplete')+'</p><p>'+esc(coverage.datedCashComplete?'Every dated customer amount is valued in USD.':'Dated customer cash is incomplete. The displayed known portion excludes unresolved native amounts and allocations.')+'</p>'
      +((coverage.unresolvedProjectIds||[]).length?'<p>Unresolved project identities: '+esc(coverage.unresolvedProjectIds.join(', '))+'</p>':'')
      +'<p>'+esc(coverage.basis||'Original quoted units and historical recorded USD remain distinct.')+'</p>'
      +(rates.length?'<details><summary>Exact retained rate sources ('+rates.length+')</summary>'+table(['Rate / direction','Observation / publication','Source and original attachment IDs','Rounding / source identity'],rates.map(rate=>[
        '<strong>'+esc(rate.id)+'</strong><small>1 '+esc(rate.baseCurrency)+' = '+esc(rate.rate)+' '+esc(rate.quoteCurrency)+'</small>',
        esc(rate.observationDate)+(rate.publicationDate?'<small>Published '+esc(rate.publicationDate)+'</small>':'')+(rate.ageDays!==null&&rate.ageDays!==undefined?'<small>'+esc(rate.ageDays)+' days old at forecast as-of</small>':''),
        originalLink(rate.sourceUrl)+(rate.sourceReference?'<small>'+esc(rate.sourceReference)+'</small>':'')+(rate.sourceIds?.length?'<small>Attachments: '+esc(rate.sourceIds.join(', '))+'</small>':'')+'<small>'+esc(rate.note||'')+'</small>',
        esc(rate.basis==='PLANNING_ASSUMPTION'?'Planning assumption':'Reference observation')+'<small>'+esc(rate.rounding)+'</small>'+(rate.sourceSha256?'<small>Source SHA-256: '+esc(rate.sourceSha256)+'</small>':'')
      ]))+'</details>':'<p class="forecast-muted">No foreign exchange source is retained in this forecast.</p>')+'</section>';
  }
  function nativeSummary(project){
    const c=project.currencyValuation,p=project.nativePricing;if(!c||!p)return null;
    return {
      price:'<strong class="forecast-currency-original">'+money(p.price.amount,p.price.currency)+'</strong><small>Price valuation: '+valuation(c.price?.amountUsd)+'</small>',
      cost:'<strong>'+valuation(project.totalRemainingCashCostUsd)+'</strong><small>Quoted cost remaining: '+allocation(c.remainingCostNative,p.deliveryCost.currency)+'</small>',
      uncollected:'<strong>'+allocation(c.uncollectedPriceNative,p.price.currency)+'</strong><small>USD valuation: '+valuation(project.uncollectedPriceUsd)+'</small>'
    };
  }
  function projectReports(report){
    return report.commercial.filter(project=>project.nativePricing&&project.currencyValuation).map(project=>{
      const p=project.nativePricing,c=project.currencyValuation;
      const priceCredits=c.priceCredits||p.priceCredits||[],costCredits=c.costCredits||p.costCredits||[];
      const missingPrice=c.missingPriceCreditCashIds||[],missingCost=c.missingCostCredits||[];
      const values=[['Original price',c.price,p.price],['Total delivery cost',c.deliveryCost,p.deliveryCost]];
      const creditRows=[...priceCredits.map(row=>['Customer cash',esc(row.cashId),money(row.amount,p.price.currency),esc(row.note)]),...costCredits.map(row=>[esc(row.kind==='INVOICE'?'Invoice':'Direct cash'),esc(row.id),money(row.amount,p.deliveryCost.currency),esc(row.note)])];
      const residual=value=>present(value)?money(value,'USD'):'Unvalued';
      return '<details class="forecast-currency-project"><summary>'+esc(project.title)+' — original currencies, rates and allocations</summary>'
        +table(['Amount','Original native amount','USD valuation / state','Exact selected rate / formula'],values.map(([label,v,native])=>[
          esc(label),money(native.amount,native.currency),valuation(v?.amountUsd)+'<small>'+esc(v?.state||'Unvalued')+'</small>',
          (native.currency==='USD'?'Original USD units':rateDetail(v?.rate))+(v?.formula?'<small>'+esc(v.formula)+'</small>':'')
        ]))
        +'<div class="forecast-stats"><div><span>Price credited in original units</span><strong>'+allocation(c.creditedPriceNative,p.price.currency,c.knownCreditedPriceNative)+'</strong></div><div><span>Price remaining in original units</span><strong>'+allocation(c.uncollectedPriceNative,p.price.currency)+'</strong></div><div><span>Price over-credit in original units</span><strong>'+allocation(c.overCreditNative,p.price.currency)+'</strong></div><div><span>Cost credited in original units</span><strong>'+allocation(c.creditedCostNative,p.deliveryCost.currency,c.knownCreditedCostNative)+'</strong></div><div><span>Quoted cost remaining</span><strong>'+allocation(c.remainingCostNative,p.deliveryCost.currency)+'</strong></div><div><span>Cost overrun in original units</span><strong>'+allocation(c.costOverrunNative,p.deliveryCost.currency)+'</strong></div></div>'
        +'<p>Original recorded customer USD without a native allocation: '+valuation(c.unallocatedObservedUsd)+'. Original total cost valuation: '+valuation(c.quotedTotalDeliveryCostUsd)+'. Effective total cost valuation: '+valuation(c.effectiveTotalDeliveryCostUsd)+'.</p>'
        +(missingPrice.length?'<p class="forecast-valuation-warning">Customer cash needs a native allocation: '+esc(missingPrice.join(', '))+'</p>':'')
        +(missingCost.length?'<p class="forecast-valuation-warning">Delivery cost needs a native allocation: '+esc(missingCost.map(row=>typeof row==='string'?row:row.kind+':'+row.id).join(', '))+'</p>':'')
        +'<h5>Original milestone amounts and settlement</h5>'+table(['Milestone / forecast date','Original quoted units','Native credited / remaining','USD quote / credit valuation / remaining','Signed USD cent allocation residuals'],(project.receipts||[]).map(row=>[
          esc(row.label)+'<small>'+esc(row.id)+' · '+esc(row.date||row.forecastDate||'Collection date not entered')+'</small>',
          money(row.amountNative,p.price.currency),
          allocation(row.appliedNative,p.price.currency)+'<small>Remaining: '+allocation(row.remainingNative,p.price.currency)+'</small>',
          valuation(row.amountUsd)+'<small>Native credit valuation: '+valuation(row.valuedNativeCreditUsd)+'</small><small>Remaining: '+valuation(row.remainingUsd)+'</small><small>Original recorded USD applied: '+(row.appliedObservedUsd===null?'Separate from foreign native allocation':esc(usd(row.appliedObservedUsd)))+'</small>',
          'Quote: '+residual(row.valuationRoundingUsd)+'<small>Credit: '+residual(row.creditRoundingUsd)+'</small><small>Remaining: '+residual(row.remainingRoundingUsd)+'</small><small>Settlement: '+residual(row.settlementRoundingUsd)+'</small>'
        ]))
        +'<p class="forecast-muted">'+esc(c.milestoneRounding==='CUMULATIVE_NATIVE_TOTAL_TO_USD_CENTS'?'Quote, credit and remaining totals use cumulative native-to-USD cent allocation; milestone amounts conserve their respective totals.':c.milestoneRounding||'')+'</p>'
        +(c.settlementRoundingBasis?'<p class="forecast-muted">'+esc(c.settlementRoundingBasis)+'</p>':'')
        +'<h5>Explicit original record credits</h5>'+(creditRows.length?table(['Original record type','Original identity','Native amount','Retained allocation basis'],creditRows):'<p class="forecast-muted">No explicit foreign-currency credits. Eligible USD records are applied in their original units.</p>')
        +'<p>'+esc(c.creditBasis||'')+'</p></details>';
    }).join('');
  }
  return {refreshCurrent,ratesEditor,readRates,pricingEditor,receiptFields,creditEditor,syncPricing,readPricing,readReceiptAmount,syncRates,handleAction,handleChange,reportCoverage,nativeSummary,projectReports};
}
