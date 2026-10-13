// MIT. One browser operator over the original merchant, output and SF88 requests.
const SCHEMA='starforge.pmtiles-commerce-browser.v1';
const copy=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?
  '['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const identifier=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/,objectId=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const atomic=/^(0|[1-9][0-9]{0,38})$/,sha=/^[a-f0-9]{64}$/;
const mutationTools=new Set(['output_prepare','output_stage','output_activate','output_start','output_stop',
  'purchase_prepare','purchase_run','purchase_recover','purchase_adopt','purchase_receive','purchase_finalize','package']);
const formFields={offerId:'paidOfferId',title:'paidOfferTitle',origin:'paidOrigin',network:'paidNetwork',
  asset:'paidAsset',payTo:'paidPayTo',timeout:'paidTimeout',extra:'paidExtra',chunkBytes:'paidChunkBytes',
  runtime:'paidRuntime',sellerId:'paidSellerId',sellerLabel:'paidSellerLabel',changeReason:'paidChangeReason',
  buyer:'paidBuyer',budget:'paidBudget',target:'paidTarget',adoptRequestId:'paidAdoptRequestId',receiveRequestId:'paidReceiveRequestId',
  accountOffset:'paidAccountOffset',accountLimit:'paidAccountLimit'};
const defaults={offerId:'map-delivery',title:'Regional map delivery',origin:'',network:'',asset:'',payTo:'',
  timeout:'300',extra:'{}',chunkBytes:'921600',runtime:'',sellerId:'',sellerLabel:'',changeReason:'Select reviewed map output',
  buyer:'',budget:'',target:'',adoptRequestId:'',receiveRequestId:'',accountOffset:'0',accountLimit:'100'};
function unique(prefix){return prefix+'-'+crypto.randomUUID().replaceAll('-','');}
function must(condition,message){if(!condition)throw Error(message);}
function safeMessage(error){return String(error?.message??error).slice(0,1500);}
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function download(value,name){const body=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(body),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function details(node,title,value){const block=element('details'),summary=element('summary',title),pre=element('pre',JSON.stringify(value,null,2));
  block.append(summary,pre);node.append(block);return block;}
function definitions(node,rows){const list=element('dl',undefined,'definition');
  for(const [name,value]of rows)list.append(element('dt',name),element('dd',value===null||value===undefined?'—':String(value)));
  node.append(list);
}
function options(node,rows,selected,{empty='Select a saved item'}={}){
  node.replaceChildren();const first=element('option',empty);first.value='';node.append(first);
  for(const row of rows){const option=element('option',row.label);option.value=row.id;option.disabled=!!row.disabled;node.append(option);}
  if(selected&&!rows.some(row=>row.id===selected)){const held=element('option',selected+' · retained selection');held.value=selected;node.append(held);}
  node.value=selected??'';
}
export function createPMTilesCommerceUI({api,onWorkspaceChange=async()=>{}}){
  const panel=document.getElementById('commercePanel');must(panel,'The paid-output panel is unavailable.');
  panel.innerHTML=String.raw`<div class="sectionHeader"><h2>Paid map delivery</h2><button id="paidRefresh" type="button">Refresh merchant</button></div>
<p id="paidIdentity" class="meta"></p><div id="paidMessage" role="status" aria-live="polite"></div>
<nav class="paidTabs" aria-label="Paid map delivery"><button type="button" data-paid-tab="offer" id="paidTabOffer">Offer</button><button type="button" data-paid-tab="seller" id="paidTabSeller">Seller</button><button type="button" data-paid-tab="customer" id="paidTabCustomer">Customer</button><button type="button" data-paid-tab="work" id="paidTabWork">Saved work</button></nav>
<div class="paidPending" id="paidPendingPanel" hidden><div id="paidPending"></div><div class="row"><button id="paidResumePending" type="button">Recover this request</button><button id="paidKeepPending" type="button">Keep request and continue editing</button><button id="paidDownloadRequest" type="button">Download request</button></div></div>
<div data-paid-page="offer">
<h3>Select published outputs</h3><p id="paidPublication"></p><button id="paidUsePublication" type="button">Use current publication</button>
<div class="grid"><label>Offer ID<input id="paidOfferId" maxlength="64"></label><label>Offer name<input id="paidOfferTitle" maxlength="240"></label></div>
<div class="row"><label class="grow">Published source or complete package<select id="paidSource"></select></label><button id="paidAddSource" type="button">Add output</button><button id="paidMoreSources" type="button">Load more sources</button></div>
<div class="row"><button id="paidBuildPackage" type="button">Prepare complete operations package</button><span class="hint">Uses this merchant's configured export directory.</span></div>
<div class="paidTableWrap"><table><thead><tr><th>Original output</th><th>Public ID and filename</th><th>Atomic units per request</th><th>Complete download</th><th></th></tr></thead><tbody id="paidObjects"></tbody></table></div>
<h3>Payment terms</h3><label>Use a configured buyer's public terms<select id="paidPaymentPreset"></select></label>
<label>Public merchant HTTPS origin<input id="paidOrigin" type="url" placeholder="https://maps.example.com"></label>
<div class="grid"><label>Network<input id="paidNetwork"></label><label>Asset<input id="paidAsset"></label></div>
<label>Recipient<input id="paidPayTo"></label>
<div class="grid"><label>Maximum payment timeout, seconds<input id="paidTimeout" type="number" min="1" step="1"></label><label>Bytes per paid request<input id="paidChunkBytes" type="number" min="1" max="1048576" step="1"></label></div>
<details><summary>Additional payment fields</summary><p class="hint">The original offer compiler validates these exact payment fields.</p><label>Payment extra JSON<textarea id="paidExtra" rows="3" spellcheck="false"></textarea></label></details>
<div id="paidOfferCosts" class="meta"></div><div class="row"><button id="paidPrepare" type="button">Prepare priced offer</button><button id="paidDraftDownload" type="button">Download offer draft</button></div>
</div>
<div data-paid-page="seller" hidden>
<h3>Retained offer</h3><div class="row"><label class="grow">Prepared offer<select id="paidOfferSelect"></select></label><button id="paidOpenOffer" type="button">Open offer</button><button id="paidVerifyOffer" type="button">Verify retained files</button><button id="paidDownloadCatalog" type="button">Download buyer catalog</button></div><div id="paidOfferDetails"></div>
<h3>Stage and review seller</h3><div class="grid"><label>Configured runtime<select id="paidRuntime"></select></label><label>Seller release ID<input id="paidSellerId" maxlength="120"></label></div>
<label>Release label<input id="paidSellerLabel" maxlength="240"></label><button id="paidStage" type="button">Stage selected offer</button>
<div class="row"><label class="grow">Saved seller release<select id="paidSellerSelect"></select></label><button id="paidCompare" type="button">Compare with active seller</button></div>
<div id="paidCompareResult"></div><label>Selection reason<input id="paidChangeReason" maxlength="100"></label>
<div class="row"><button id="paidActivate" type="button">Activate reviewed seller</button><button id="paidStart" type="button">Start selected seller</button><button id="paidStop" type="button">Stop owned seller</button></div><div id="paidSellerStatus"></div>
</div>
<div data-paid-page="customer" hidden>
<h3>Review a complete purchase</h3><label>Prepared offer<select id="paidPurchaseOffer"></select></label>
<div class="grid"><label>Output<select id="paidObject"></select></label><label>Configured buyer<select id="paidBuyer"></select></label></div>
<div id="paidBuyerTerms"></div><div class="row"><label class="grow">Total budget, atomic units<input id="paidBudget" inputmode="numeric"></label><button id="paidUseBudget" type="button">Use complete download cost</button><button id="paidPreparePurchase" type="button">Prepare purchase</button></div>
<h3>Original customer operation</h3><div class="row"><label class="grow">Saved purchase<select id="paidPurchaseSelect"></select></label><button id="paidOpenPurchase" type="button">Open purchase</button><button id="paidRunPurchase" type="button">Receive purchased file</button><button id="paidRecoverPurchase" type="button">Recover original purchase</button></div>
<div id="paidPurchaseDetails"></div><div class="grid"><label>Map adoption request ID<input id="paidAdoptRequestId" maxlength="120" placeholder="Generated when first submitted"></label><label>Operations receiving request ID<input id="paidReceiveRequestId" maxlength="120" placeholder="Generated when first submitted"></label></div><p class="hint">Keep the original request ID to reopen the same imported source or customer installation.</p><div class="row"><button id="paidAdopt" type="button">Adopt received map source</button><label class="grow">Customer receiving target<select id="paidTarget"></select></label><button id="paidReceive" type="button">Receive complete operations</button></div>
<h3>Original accounting</h3><div class="grid"><label>First request offset<input id="paidAccountOffset" type="number" min="0" step="1"></label><label>Requests in this range<input id="paidAccountLimit" type="number" min="1" max="250" step="1"></label></div>
<div class="row"><button id="paidReadAccounting" type="button">Read accounting range</button><button id="paidRecoverAccounting" type="button">Recover accounting command</button><button id="paidFinalizeRange" type="button">Finalize this range</button><button id="paidNextAccounting" type="button">Use next range</button></div><div id="paidAccountingDetails"></div>
</div>
<div data-paid-page="work" hidden>
<h3>Reopen saved work</h3><div class="row"><label class="grow">Original records<select id="paidWorkKind"><option value="offers">Priced offers</option><option value="purchases">Customer purchases</option><option value="operations">Seller operations</option><option value="packages">Operations packages</option><option value="browser">Retained browser requests</option></select></label><button id="paidLoadWork" type="button">Read records</button><button id="paidMoreWork" type="button">Load more</button></div>
<div id="paidSavedWork" class="paidSavedWork"></div>
<div class="grid"><label>Record type<select id="paidReadKind"><option value="offer">Priced offer</option><option value="purchase">Purchase</option><option value="operation">Seller operation</option><option value="package">Operations package</option></select></label><label>Exact request ID<input id="paidReadId" maxlength="120"></label></div><button id="paidReadRecord" type="button">Read exact request</button>
<div id="paidRecordDetails"></div><button id="paidResumeRecord" type="button">Resume selected original request</button>
</div>
<div class="row paidFooter"><button id="paidLastResultDownload" type="button">Download selected result</button></div>`;
  const $=id=>document.getElementById(id);
  let host=null,current=null,key=null,local=null,summary=null,selectedOffer=null,purchase=null,comparison=null,accounting=null,record=null,lastResult=null;
  let active=true,connecting=null,refreshing=null,running=null,readEpoch=0,lastRefresh=0,recordRead=0,sellerRead=0;
  const indexes={offers:[],purchases:[],operations:[],packages:[]},cursors={};
  function note(text,error=false){$('paidMessage').textContent=text;$('paidMessage').className=error?'error':'meta';}
  function readForm(){return Object.fromEntries(Object.entries(formFields).map(([name,id])=>[name,$(id).value]));}
  function applyForm(value){for(const [name,id]of Object.entries(formFields))$(id).value=value[name]??defaults[name];}
  function save(){
    if(!local||!key)return;local.form=readForm();
    localStorage.setItem(key,JSON.stringify(local));
    renderPending();
  }
  function saveSafely(){try{save();}catch(error){note('Browser storage could not retain the current edit. Download the draft or request. '+safeMessage(error),true);}}
  function selectPurchase(ref){
    if(same(local.purchase,ref))return;
    local.customerRequests??={};
    const old=local.purchase;
    if(old?.buyer)local.customerRequests[old.buyer+':'+old.requestId]={adopt:$('paidAdoptRequestId').value,receive:$('paidReceiveRequestId').value};
    local.purchase=copy(ref);
    const held=ref?.buyer?local.customerRequests[ref.buyer+':'+ref.requestId]:null;
    $('paidAdoptRequestId').value=held?.adopt??'';$('paidReceiveRequestId').value=held?.receive??'';
  }
  function freshLocal(){return {schema:SCHEMA,workspace:host.workspace,workspaceId:current.id,form:copy(defaults),
    publication:null,objects:[],offer:null,seller:null,purchase:null,objectId:'',pending:null,jobs:[],tab:'offer'};}
  function scope(){must(host?.configured&&current?.id===host.workspaceId,'Open this workspace through its configured merchant.');return {workspace:host.workspace};}
  async function tool(suffix,args={}){
    const name=suffix.startsWith('merchant_pmtiles_')?suffix:'merchant_pmtiles_'+suffix;
    must(host?.tools.includes(name),'The selected merchant does not provide this operation.');
    return api('/api/merchant',{method:'POST',body:{workspaceId:current.id,tool:name,args:{...copy(args),...scope()}}});
  }
  const read=(section,extra={})=>tool('output_workbench',{section,...extra});
  function tab(name){
    if(local)local.tab=name;
    for(const page of panel.querySelectorAll('[data-paid-page]'))page.hidden=page.dataset.paidPage!==name;
    for(const button of panel.querySelectorAll('[data-paid-tab]'))button.setAttribute('aria-current',button.dataset.paidTab===name?'page':'false');
    saveSafely();
  }
  function renderPending(){
    const job=local?.pending;$('paidPendingPanel').hidden=!job;
    panel.dataset.operationState=running?'RUNNING':job?'RETAINED':'IDLE';
    $('paidPending').textContent=job?(running?.id===job.id?'Running ':'Retained ')+job.tool.replace('merchant_pmtiles_','')+' · '+
      (job.args.requestId??job.args.purchaseRequestId??job.id)+(job.error?' · '+job.error:''):'';
    $('paidResumePending').disabled=!job||!!running;$('paidKeepPending').disabled=!job||!!running;
    $('paidDownloadRequest').disabled=!job;$('paidLastResultDownload').disabled=!lastResult;
  }
  function currentOutput(){return selectedOffer?.objects?.find(row=>row.id===$('paidObject').value)??null;}
  function currentBuyer(){return summary?.buyers.find(row=>row.name===$('paidBuyer').value)??null;}
  function sourceOptions(){
    const choices=(summary?.sources??[]).map(row=>({id:'resource:'+row.id,label:row.name+' · '+row.bytes.toLocaleString()+' bytes'}));
    for(const row of indexes.packages.filter(row=>row.state==='COMPLETE'))
      choices.push({id:'package:'+row.requestId,label:'Complete operations '+row.requestId+' · '+row.bytes.toLocaleString()+' bytes'});
    options($('paidSource'),choices,$('paidSource').value,{empty:'Select a published source or prepared package'});
    $('paidMoreSources').disabled=summary?.sourceNextAfter===null||!summary;
  }
  function offerOptions(){
    const selected=local.offer?.requestId??'';
    const rows=indexes.offers.filter(row=>row.state==='COMPLETE').map(row=>({id:row.requestId,label:row.title+' · '+row.requestId}));
    if(selectedOffer&&!rows.some(row=>row.id===selectedOffer.requestId))rows.push({id:selectedOffer.requestId,label:selectedOffer.offerId+' · '+selectedOffer.requestId});
    options($('paidOfferSelect'),rows,selected);options($('paidPurchaseOffer'),rows,selected);
  }
  function publishedMatches(){return !!local?.publication&&local.publication.id===summary?.currentRelease?.id&&
    local.publication.manifestSha256===summary.currentRelease.manifestSha256;}
  function renderPublication(){
    const selected=local?.publication,live=summary?.currentRelease;
    $('paidPublication').textContent=selected?'Draft source: '+selected.editionId+' v'+selected.editionVersion+' · '+selected.id+
      (publishedMatches()?' · current publication':'. The current publication has changed; select it before preparing a new offer.'):
      live?'Use the current publication to select its original outputs.':'Publish a reviewed map edition to prepare an output offer.';
    $('paidUsePublication').disabled=!live||!!running;
  }
  function requestCosts(){
    const chunk=Number($('paidChunkBytes').value);must(Number.isSafeInteger(chunk)&&chunk>=1&&chunk<=1048576,'Choose 1–1,048,576 bytes per paid request.');
    let bytes=0,count=0,total=0n;
    const rows=local.objects.map(row=>{
      must(Number.isSafeInteger(row.bytes)&&row.bytes>0,'The selected original file size is unavailable.');
      must(atomic.test(row.amount),'Enter an exact nonnegative atomic price for every output.');
      const requests=Math.ceil(row.bytes/chunk),cost=BigInt(row.amount)*BigInt(requests);bytes+=row.bytes;count+=requests;total+=cost;
      return {requests,cost:cost.toString()};
    });
    must(local.objects.length<=64&&bytes<=34359738368&&count<=131072,'Select at most 64 outputs, 32 GiB total and 131,072 paid requests. Increase bytes per request when needed.');
    return {rows,bytes,count,total:total.toString()};
  }
  function renderCosts(){
    try{const value=requestCosts();$('paidOfferCosts').textContent=value.bytes.toLocaleString()+' original bytes · '+value.count.toLocaleString()+
      ' paid requests · '+value.total+' atomic units to receive every output.';
      for(const [index,row]of value.rows.entries()){const node=$('paidCost-'+index);if(node)node.textContent=row.requests.toLocaleString()+' request(s) · '+row.cost+' atomic units';}
    }catch(error){$('paidOfferCosts').textContent=safeMessage(error);}
    renderButtons();
  }
  function renderObjects(){
    $('paidObjects').replaceChildren();
    local.objects.forEach((row,index)=>{
      const tr=element('tr'),source=element('td'),name=element('strong',row.name),meta=element('div',row.kind+' · '+row.bytes.toLocaleString()+' bytes','meta');
      source.append(name,meta,element('div',row.sourceSha256,'paidHash'));
      const names=element('td'),id=document.createElement('input'),filename=document.createElement('input');id.value=row.id;filename.value=row.filename;
      id.setAttribute('aria-label','Output ID for '+row.name);filename.setAttribute('aria-label','Download filename for '+row.name);names.append(id,filename);
      const price=element('td'),amount=document.createElement('input');amount.value=row.amount;amount.inputMode='numeric';amount.setAttribute('aria-label','Atomic units per request for '+row.name);price.append(amount);
      const cost=element('td');cost.id='paidCost-'+index;
      const control=element('td'),remove=element('button','Remove');remove.type='button';remove.onclick=()=>{local.objects.splice(index,1);saveSafely();renderObjects();};control.append(remove);
      for(const [node,field]of [[id,'id'],[filename,'filename'],[amount,'amount']])node.addEventListener('input',()=>{row[field]=node.value;saveSafely();renderCosts();});
      tr.append(source,names,price,cost,control);$('paidObjects').append(tr);
    });renderCosts();
  }

  function renderOffer(){
    const node=$('paidOfferDetails');node.replaceChildren();offerOptions();
    const selected=selectedOffer;
    if(!selected){node.append(element('p','Open a retained priced offer to review its exact files and terms.'));renderBuyerTerms();return;}
    definitions(node,[['Offer',selected.offerId],['Original request',selected.requestId],['Package manifest',selected.manifestSha256],
      ['Map release',selected.release?.releaseId],['Catalog',selected.catalogSha256]]);
    const table=element('table'),head=element('tr');for(const label of ['Output','Original bytes','Requests','Atomic units per request','Complete cost'])head.append(element('th',label));
    table.append(head);for(const row of selected.objects){const tr=element('tr');
      for(const value of [row.name,row.bytes.toLocaleString(),row.pricing.requests.toLocaleString(),row.pricing.atomicPerRequest,row.pricing.completeDownloadAtomic])tr.append(element('td',value));
      table.append(tr);
    }
    const wrap=element('div',undefined,'paidTableWrap');wrap.append(table);node.append(wrap);
    details(node,'Selected source identities and rights',selected.objects.map(row=>({id:row.id,snapshot:row.snapshot,sha256:row.expectedSha256,product:row.product})));
    options($('paidObject'),selected.objects.map(row=>({id:row.id,label:row.name+' · '+row.pricing.completeDownloadAtomic+' atomic units'})),
      local.objectId||selected.objects[0]?.id,{empty:'Select a complete output'});
    local.objectId=$('paidObject').value;renderBuyerTerms();renderButtons();
  }
  function renderSeller(){
    const status=summary?.output,node=$('paidSellerStatus');node.replaceChildren();
    if(!status){renderButtons();return;}
    options($('paidSellerSelect'),status.releases.map(row=>({id:row.id,label:row.label+' · '+row.id})),local.seller?.id);
    const current=status.runtime,observed=current.observed;
    definitions(node,[['Current seller',current.state],['Active release',status.state.active],['Selection generation',status.state.generation],
      ['Owned by this merchant',current.owned?'Yes':'No'],['Current instance',observed?.instanceId],['Listener',observed?.listener]]);
    if(status.errors?.length)details(node,'Original release observations',status.errors);
    $('paidCompareResult').replaceChildren();
    if(comparison){
      const stillSelected=comparison.releaseId===local.seller?.id&&comparison.releaseDigest===local.seller?.digest&&
        comparison.value.state.generation===status.state.generation&&comparison.value.state.active===status.state.active;
      $('paidCompareResult').append(element('p',stillSelected?'Comparison matches the current selection.':
        'The saved comparison belongs to an earlier selection. Compare the current seller before activation.','meta'));
      details($('paidCompareResult'),'Original seller comparison',comparison.value).open=true;
    }
    renderButtons();
  }
  function renderBuyerTerms(){
    const row=currentOutput(),buyer=currentBuyer(),node=$('paidBuyerTerms');node.replaceChildren();
    if(!row){node.append(element('p','Choose a prepared offer and its complete output.'));renderButtons();return;}
    definitions(node,[['File',row.filename],['Original bytes',row.bytes.toLocaleString()],['Requests',row.pricing.requests.toLocaleString()],
      ['Price per request',row.pricing.atomicPerRequest+' atomic units'],['Complete download',row.pricing.completeDownloadAtomic+' atomic units'],
      ['Snapshot',row.snapshot],['File SHA256',row.expectedSha256]]);
    if(buyer)definitions(node,[['Buyer',buyer.name],['Buyer per-request cap',buyer.maxAtomic??'Unavailable'],
      ['Merchant origin',buyer.origin??'Unavailable'],['Original accounting',buyer.accounting?'Configured':'No operator workspace selected']]);
    renderButtons();
  }
  function renderPurchase(){
    const node=$('paidPurchaseDetails');node.replaceChildren();
    options($('paidPurchaseSelect'),indexes.purchases.map(row=>({id:row.requestId,
      label:row.objectId+' · '+row.buyer+' · '+row.state+' · '+row.requestId})),local.purchase?.requestId);
    if(!purchase){node.append(element('p','Open the original purchase to receive its remaining bytes or recover its receipts.'));renderButtons();return;}
    const obj=purchase.object??purchase;
    definitions(node,[['Request',purchase.requestId],['Buyer',local.purchase?.buyer],['Current purchase',purchase.status??purchase.state??'PREPARED'],
      ['Output',purchase.objectId??obj.id],['Original bytes',obj.bytes?.toLocaleString()],['Complete price',obj.pricing?.completeDownloadAtomic],
      ['Source SHA256',obj.expectedSha256??purchase.sha256],['Retained destination',purchase.destination??purchase.delivery?.path]]);
    if(purchase.delivery){definitions(node,[['Received bytes',purchase.delivery.assembly?.bytes??purchase.delivery.bytes],
      ['Received SHA256',purchase.delivery.assembly?.sha256??purchase.delivery.sha256]]);}
    if(purchase.native||purchase.process)details(node,'Original purchase progress',{native:purchase.native,process:purchase.process});
    renderButtons();
  }
  function accountingResult(value=accounting){
    const result=value?.accounting;
    return result?.native?result:result?.result??result?.lastComplete??null;
  }
  function renderAccounting(){
    const node=$('paidAccountingDetails');node.replaceChildren();const recovered=accounting?.accounting,result=accountingResult(),native=result?.native;
    if(!recovered){node.append(element('p','Read or recover this purchase’s original accounting command.'));renderButtons();return;}
    definitions(node,[['Original command',recovered.commandId??result?.commandId],['Recovery status',recovered.status??result?.viewStatus],
      ['Mode',native?.mode],['Session',native?.sessionId],['Configuration',native?.configurationSha256],
      ['Native exit',result?.process?.exitCode],['Interrupted',native?.interrupted],['Next range',native?.range?.nextOffset]]);
    if(native?.range)definitions(node,[['First request',native.range.offset],['Requests in range',native.entries.length],['Total requests',native.range.total]]);
    if(native?.entries){
      const table=element('table'),heading=element('tr');for(const title of ['Index','Intent','Native outcome'])heading.append(element('th',title));table.append(heading);
      for(const row of native.entries){const tr=element('tr');for(const value of [row.index,row.intentId??row.intent_id??row.id??'',row.outcome])tr.append(element('td',String(value)));table.append(tr);}
      const wrap=element('div',undefined,'paidTableWrap');wrap.append(table);node.append(wrap);
    }
    if(result)details(node,'Complete original range',result);
    if(recovered.status&&recovered.result===null)node.append(element('p','The latest command has no complete native output. Its retained command remains selected; continue this same range when its original operation can proceed.','meta'));
    renderButtons();
  }
  function renderButtons(){
    if(!local)return;
    const busy=!!running||!!local.pending,status=summary?.output,selected=local.seller;
    const liveSelected=selected&&sha.test(selected.digest??'')&&status?.state.active===selected.id;
    const own=status?.runtime.owned&&status.runtime.observed?.instanceId;
    const prepared=!!selectedOffer,currentPurchase=!!local.purchase&&identifier.test(local.purchase.buyer??'')&&purchase?.requestId===local.purchase.requestId;
    const obj=purchase?.product??purchase?.object?.product;
    const buyer=summary?.buyers.find(row=>row.name===local.purchase?.buyer);
    const reviewed=comparison&&selected&&comparison.releaseId===selected.id&&comparison.releaseDigest===selected.digest&&
      comparison.value.state.generation===status?.state.generation&&comparison.value.state.active===status?.state.active;
    $('paidPrepare').disabled=busy||!publishedMatches()||!local.objects.length;
    $('paidBuildPackage').disabled=busy||!summary?.currentRelease;
    $('paidStage').disabled=busy||!prepared||!$('paidRuntime').value;
    $('paidActivate').disabled=busy||!reviewed;
    $('paidStart').disabled=busy||!liveSelected||['RUNNING','RESTART_REQUIRED'].includes(status?.runtime.state);
    $('paidStop').disabled=busy||!own;
    $('paidVerifyOffer').disabled=!!running||!prepared;$('paidDownloadCatalog').disabled=!!running||!prepared;
    $('paidCompare').disabled=!!running||!selected||!sha.test(selected.digest??'');
    $('paidPreparePurchase').disabled=busy||!currentOutput()||!currentBuyer()?.available;
    for(const id of ['paidOpenPurchase','paidRunPurchase','paidRecoverPurchase'])$(id).disabled=!!running||!currentPurchase||(id!=='paidOpenPurchase'&&!!local.pending);
    $('paidAdopt').disabled=busy||!obj?.resource||!purchase?.delivery;
    $('paidReceive').disabled=busy||!obj?.package||!purchase?.delivery||!$('paidTarget').value;
    for(const id of ['paidReadAccounting','paidFinalizeRange'])$(id).disabled=busy||!currentPurchase||!buyer?.accounting;
    $('paidRecoverAccounting').disabled=!!running||!currentPurchase;
    $('paidNextAccounting').disabled=!!running||!accountingResult()?.native?.range||accountingResult().native.range.nextOffset===null;
    $('paidResumeRecord').disabled=busy||!record?.resume;
    $('paidAddSource').disabled=!$('paidSource').value||!!running;
    renderPending();
  }
  function mergeIndex(section,rows){
    const values=new Map(indexes[section].map(row=>[row.requestId,row]));
    for(const row of rows)values.set(row.requestId,row);
    indexes[section]=[...values.values()].sort((a,b)=>a.requestId.localeCompare(b.requestId));
  }
  async function page(section,{reset=false}={}){
    if(section==='browser'){renderWork();return;}
    const epoch=readEpoch,after=reset?null:cursors[section];
    if(!reset&&after===null)return;
    const value=await read(section,{limit:20,...(after?{after}:{} )});
    if(epoch!==readEpoch||!active)return;
    must(value.workspaceId===current.id&&value.section===section,'The saved merchant page changed.');
    if(reset)indexes[section]=[];
    mergeIndex(section,value.items);cursors[section]=value.nextAfter;
    sourceOptions();offerOptions();renderPurchase();renderWork();
  }
  function renderWork(){
    const section=$('paidWorkKind').value,node=$('paidSavedWork');node.replaceChildren();
    const rows=section==='browser'?[...(local?.jobs??[])].reverse():indexes[section]??[];
    for(const row of rows){
      const item=element('div',undefined,'item'),title=element('strong',section==='browser'?row.tool.replace('merchant_pmtiles_',''):
        (row.title??row.objectId??row.action??row.packageId??row.requestId)+' · '+row.state);
      item.append(title,element('div',row.requestId??row.args?.requestId??row.args?.purchaseRequestId??row.id,'meta'));
      if(row.error)item.append(element('div',typeof row.error==='string'?row.error:row.error.message,'meta'));
      const button=element('button',section==='browser'?'Reopen browser request':'Read original request');button.type='button';
      button.onclick=()=>runRead(async()=>{
        if(section==='browser'){record={kind:'browser',requestId:row.args.requestId??row.args.purchaseRequestId??row.id,
          state:row.phase,resume:{tool:row.tool,args:copy(row.args)},request:copy(row.args),browserJob:copy(row)};renderRecord();}
        else await loadRecord(row.kind,row.requestId);
      });item.append(button);node.append(item);
    }
    if(!rows.length)node.append(element('p','No records are loaded in this view.'));
    $('paidMoreWork').disabled=section==='browser'||cursors[section]===null||!!running;
  }
  function renderRecord(){
    const node=$('paidRecordDetails');node.replaceChildren();
    if(record){definitions(node,[['Record',record.kind],['Original request',record.requestId],['State',record.state]]);
      if(record.buyerAvailable===false)node.append(element('p','The current host configuration no longer selects this original buyer. Restore that exact configured alias before continuing this purchase.','meta'));
      details(node,'Original public request',record.request??record.resume?.args??{}).open=true;
      if(record.complete)details(node,'First retained result',record.complete);
      if(record.delivery)details(node,'Retained original assembly',record.delivery);
    }
    renderButtons();
  }
  async function loadRecord(kind,requestId){
    must(identifier.test(requestId),'Enter an exact retained request ID.');
    const epoch=readEpoch,ticket=++recordRead;
    if(kind==='offer'){selectedOffer=null;local.offer={requestId,manifestSha256:null};renderOffer();}
    if(kind==='purchase'){selectPurchase({requestId,buyer:indexes.purchases.find(row=>row.requestId===requestId)?.buyer??''});
      purchase=null;accounting=null;renderPurchase();renderAccounting();}
    const value=await read('request',{kind,requestId});if(epoch!==readEpoch||ticket!==recordRead||!active)return;
    must(value.record?.requestId===requestId,'The original request identity changed.');
    record=value.record;lastResult=value;
    $('paidReadKind').value=kind;$('paidReadId').value=requestId;renderRecord();
    if(kind==='offer'&&record.prepared){selectedOffer=record.prepared;local.offer={requestId,manifestSha256:record.prepared.manifestSha256};renderOffer();}
    if(kind==='purchase'){
      selectPurchase({requestId,buyer:record.buyer});purchase=record;accounting=null;
      renderPurchase();renderAccounting();
    }
    if(kind==='operation'&&record.complete?.result?.id&&record.complete.result.digest){
      local.seller={id:record.complete.result.id,digest:record.complete.result.digest};renderSeller();
    }
    saveSafely();return record;
  }
  async function runRead(work){
    try{return await work();}catch(error){note(safeMessage(error),true);}
  }
  async function refresh({history=false,force=false}={}){
    if(!host?.configured||!active)return;
    if(refreshing)return refreshing;
    if(running&&!force)return;
    const epoch=readEpoch;
    const task=(async()=>{
      const value=await read('summary');if(epoch!==readEpoch||!active)return;
      must(value.workspaceId===current.id,'The selected merchant workspace changed.');
      const previous=summary;
      if(previous?.currentRelease?.id===value.currentRelease?.id&&previous?.currentRelease?.manifestSha256===value.currentRelease?.manifestSha256){
        const sources=new Map((previous?.sources??[]).map(row=>[row.id,row]));for(const row of value.sources)sources.set(row.id,row);
        value.sources=[...sources.values()];if(previous)value.sourceNextAfter=previous.sourceNextAfter;
      }
      summary=value;lastRefresh=Date.now();
      $('paidIdentity').textContent=summary.title+' · '+host.workspace+' · '+current.id;
      options($('paidRuntime'),summary.output.runtimes.map(row=>({id:row.name,label:row.name+' · port '+row.port})),
        $('paidRuntime').value||local.form.runtime);
      options($('paidBuyer'),summary.buyers.map(row=>({id:row.name,label:row.name+(row.available?'':' · unavailable'),disabled:!row.available})),
        $('paidBuyer').value||local.form.buyer,{empty:'Select a configured buyer'});
      options($('paidTarget'),summary.receivingTargets.map(name=>({id:name,label:name})),$('paidTarget').value||local.form.target);
      options($('paidPaymentPreset'),summary.buyers.filter(row=>row.available).map(row=>({id:row.name,label:row.name+' · '+row.origin})),
        $('paidPaymentPreset').value,{empty:'Enter merchant terms below'});
      if(!local.publication&&summary.currentRelease)local.publication=copy(summary.currentRelease);
      sourceOptions();renderPublication();renderSeller();renderBuyerTerms();saveSafely();
      if(history)for(const section of ['offers','purchases','packages'])await page(section,{reset:true});
    })().catch(error=>{if(epoch===readEpoch)note(safeMessage(error),true);throw error;})
      .finally(()=>{if(refreshing===task)refreshing=null;});
    refreshing=task;return task;
  }

  function jobBinding(suffix){
    if(!suffix.startsWith('purchase_')||!purchase)return null;
    return {purchaseRequestId:purchase.requestId,requestSha256:purchase.requestSha256??null,
      catalogSha256:purchase.catalogSha256??null,requests:purchase.pricing?.requests??purchase.object?.pricing?.requests??null};
  }
  function retainedJob(toolName,args,binding=null){
    must(!running,'Wait for the accepted merchant operation to return.');
    must(!local.pending,'Recover the retained request or keep it in Saved work before starting another.');
    const name=toolName.startsWith('merchant_pmtiles_')?toolName:'merchant_pmtiles_'+toolName;
    const job={id:unique('browser'),tool:name,args:{...copy(args),...scope()},workspaceId:current.id,
      createdAt:new Date().toISOString(),phase:'SAVED',binding:binding??jobBinding(name.replace('merchant_pmtiles_','')),
      selection:{offer:copy(local.offer),seller:copy(local.seller),purchase:copy(local.purchase)}};
    local.pending=job;local.jobs.push(copy(job));
    // Completed browser views are a convenience cache. Every server request remains
    // in its original directory and is available through the Saved work reader.
    const completed=local.jobs.filter(row=>['COMPLETE','RECONCILED'].includes(row.phase));
    if(completed.length>100){const drop=new Set(completed.slice(0,completed.length-100).map(row=>row.id));local.jobs=local.jobs.filter(row=>!drop.has(row.id));}
    save();return job;
  }
  function rangeComplete(value,job){
    const result=value?.accounting,native=result?.native,range=native?.range;
    const finalize=job.tool.endsWith('_finalize'),binding=job.binding;
    if(!binding?.requestSha256||!Number.isSafeInteger(binding.requests))return false;
    const end=Math.min(binding.requests,job.args.offset+job.args.limit);
    return value.requestId===job.args.purchaseRequestId&&value.requestSha256===binding.requestSha256&&
      native?.kind==='object'&&native.mode===(finalize?'FINALIZE':'VIEW')&&
      range?.offset===job.args.offset&&range.limit===job.args.limit&&range.total===binding.requests&&
      range.nextOffset===(end<binding.requests?end:null)&&native.interrupted===false&&
      result.process?.exitCode===0&&!result.process.errorCode&&Array.isArray(native.entries)&&
      native.entries.length===end-job.args.offset&&(!finalize||native.entries.every(row=>['FINALIZED','IDEMPOTENT_FINALIZED'].includes(row.outcome)));
  }
  async function originalRange(job,{recover=false,dispatchOriginal}={}){
    if(recover||job.tool.endsWith('_finalize')){
      const recovered=await dispatchOriginal('purchase_accounting_recover',{buyer:job.args.buyer,purchaseRequestId:job.args.purchaseRequestId});
      const original=recovered.accounting?.lastComplete;
      const selected=original?{...recovered,accounting:original}:null;
      if(rangeComplete(selected,job))return selected;
    }
    const result=await dispatchOriginal(job.tool,job.args);
    if(!rangeComplete(result,job))throw Object.assign(new Error('The original accounting range is retained but unfinished. Recover this same request to continue its exact native range.'),{originalAccounting:result});
    return result;
  }
  function applyResult(job,result){
    const suffix=job.tool.replace('merchant_pmtiles_','');lastResult=result;
    panel.dataset.lastTool=suffix;panel.dataset.lastRequestId=job.args.requestId??job.args.purchaseRequestId??job.id;
    if(suffix==='output_prepare'){
      must(result.state==='COMPLETE'&&result.requestId===job.args.requestId&&sha.test(result.manifestSha256),'The prepared offer response changed.');
      const selection={requestId:result.requestId,manifestSha256:result.manifestSha256};
      mergeIndex('offers',[{kind:'offer',state:'COMPLETE',requestId:result.requestId,title:result.offerId,...selection}]);
      if(!local.offer||same(local.offer,job.selection?.offer??null)){selectedOffer=result;local.offer=selection;}
      renderOffer();
      if(!$('paidSellerId').value)$('paidSellerId').value=result.offerId+'-seller';
      if(!$('paidSellerLabel').value)$('paidSellerLabel').value=job.args.title;
    }
    if(suffix==='package'){
      must(result.state==='COMPLETE'&&result.requestId===job.args.requestId&&sha.test(result.archive?.sha256),'The complete package response changed.');
      mergeIndex('packages',[{kind:'package',state:'COMPLETE',requestId:result.requestId,packageId:result.packageId,
        archiveSha256:result.archive.sha256,bytes:result.archive.bytes,releaseId:result.workspaceSnapshot.currentRelease}]);sourceOptions();
      $('paidSource').value='package:'+result.requestId;
    }
    if(['output_stage','output_activate','output_start','output_stop'].includes(suffix)){
      must(result.requestId===job.args.requestId&&result.result,'The retained seller operation response changed.');
      if(suffix==='output_stage'){
        must(result.result.id===job.args.releaseId&&sha.test(result.result.digest),'The staged seller selection changed.');
        if(!local.seller||same(local.seller,job.selection?.seller??null)){local.seller={id:result.result.id,digest:result.result.digest};comparison=null;}
      }
    }
    if(['purchase_prepare','purchase_run','purchase_recover'].includes(suffix)){
      const id=job.args.requestId??job.args.purchaseRequestId;
      must(result.requestId===id,'The original purchase response changed.');
      if(!local.purchase||local.purchase.requestId===id||suffix==='purchase_prepare'&&same(local.purchase,job.selection?.purchase??null)){
        selectPurchase({requestId:id,buyer:job.args.buyer});purchase=result;accounting=null;renderPurchase();renderAccounting();
      }
    }
    if(suffix==='purchase_accounting'||suffix==='purchase_finalize'||suffix==='purchase_accounting_recover'){
      must(result.requestId===job.args.purchaseRequestId,'The accounting purchase identity changed.');
      if(local.purchase?.requestId===job.args.purchaseRequestId&&local.purchase?.buyer===job.args.buyer){accounting=result;renderAccounting();}
    }
    renderSeller();renderButtons();
  }
  async function sendJob(job,{recover=false}={}){
    must(!running,'The original merchant request is still running.');
    must(job.workspaceId===current.id&&job.args.workspace===host.workspace,'This retained request belongs to another merchant workspace.');
    const selectedKey=key,epoch=readEpoch;
    const dispatchOriginal=(name,args)=>{
      must(active&&key===selectedKey&&epoch===readEpoch&&current?.id===job.workspaceId&&host?.workspace===job.args.workspace,
        'The selected merchant connection changed. Reopen the original workspace and recover this retained request.');
      return tool(name,args);
    };
    running=copy(job);renderButtons();note('Running '+job.tool.replace('merchant_pmtiles_','')+' using its retained request…');
    try{
      const suffix=job.tool.replace('merchant_pmtiles_','');
      let result;
      if(suffix==='purchase_accounting'||suffix==='purchase_finalize')result=await originalRange(job,{recover,dispatchOriginal});
      else if(recover&&suffix==='purchase_run')result=await dispatchOriginal('purchase_recover',job.args);
      else result=await dispatchOriginal(job.tool,job.args);
      if(key!==selectedKey||epoch!==readEpoch||!active)return result;
      applyResult(job,result);
      const saved=local.jobs.find(row=>row.id===job.id);
      if(saved){saved.phase=recover&&suffix==='purchase_run'&&!result.delivery?'RECONCILED':'COMPLETE';delete saved.error;}
      if(local.pending?.id===job.id)local.pending=null;
      save();renderWork();
      note(suffix==='purchase_run'&&recover&&!result.delivery?'Recovered the original purchase state. Receive purchased file continues that same purchase.':
        'Saved original result for '+(job.args.requestId??job.args.purchaseRequestId??suffix)+'.');
      if(['purchase_adopt','package'].includes(suffix))await onWorkspaceChange();
      return result;
    }catch(error){
      if(key===selectedKey&&epoch===readEpoch){
        if(error.originalAccounting&&local.purchase?.requestId===job.args.purchaseRequestId&&local.purchase?.buyer===job.args.buyer){accounting=error.originalAccounting;lastResult=accounting;renderAccounting();}
        const saved=local.jobs.find(row=>row.id===job.id);if(saved){saved.phase='RETAINED';saved.error=safeMessage(error);}
        if(local.pending?.id===job.id){local.pending.phase='RETAINED';local.pending.error=safeMessage(error);}
        saveSafely();note(safeMessage(error),true);
      }
      throw error;
    }finally{
      if(running?.id===job.id)running=null;
      if(key===selectedKey&&epoch===readEpoch&&active){renderButtons();await refresh({force:true}).catch(()=>{});}
    }
  }
  async function dispatch(suffix,args,binding){const job=retainedJob(suffix,args,binding);return sendJob(job);}
  function originalReference(){
    must(local.purchase&&identifier.test(local.purchase.requestId),'Select an original purchase.');
    return {buyer:local.purchase.buyer,purchaseRequestId:local.purchase.requestId};
  }
  async function openPurchase(){
    const args=originalReference(),epoch=readEpoch;const value=await tool('purchase_status',args);
    if(epoch!==readEpoch||!active||local.purchase?.requestId!==args.purchaseRequestId||local.purchase?.buyer!==args.buyer)return;
    must(value.requestId===args.purchaseRequestId,'The original purchase identity changed.');
    purchase=value;lastResult=value;renderPurchase();saveSafely();return value;
  }
  async function openOffer(id){
    must(identifier.test(id),'Choose a retained priced offer.');
    const selected=await loadRecord('offer',id);if(!selected)return;
    must(selectedOffer?.requestId===id,'This offer is still preparing. Open its exact saved request to resume it.');
  }
  function paymentTerms(){
    const timeout=Number($('paidTimeout').value);
    must(Number.isSafeInteger(timeout)&&timeout>=1,'Enter a positive whole-second payment timeout.');
    const extra=JSON.parse($('paidExtra').value||'{}');must(extra&&typeof extra==='object'&&!Array.isArray(extra),'Additional payment fields must be a JSON object.');
    return {scheme:'exact',network:$('paidNetwork').value.trim(),asset:$('paidAsset').value.trim(),payTo:$('paidPayTo').value.trim(),
      maxTimeoutSeconds:timeout,...(Object.keys(extra).length?{extra}:{})};
  }
  function prepareInput(){
    must(publishedMatches(),'Use the current published map selection before preparing this new offer.');
    must(objectId.test($('paidOfferId').value),'Use a lowercase offer ID with letters, numbers, underscores or hyphens.');
    must($('paidOfferTitle').value.trim().length>0,'Enter the offer name.');
    const origin=new URL($('paidOrigin').value);
    must(origin.protocol==='https:'&&origin.pathname==='/'&&!origin.username&&!origin.password&&!origin.search&&!origin.hash,'Use the exact public HTTPS merchant origin.');
    must(local.objects.length>0,'Add at least one original output.');requestCosts();
    const ids=new Set();
    const objects=local.objects.map(row=>{
      must(objectId.test(row.id)&&!ids.has(row.id),'Every output needs a distinct lowercase public ID.');ids.add(row.id);
      return {id:row.id,amount:row.amount,filename:row.filename,
        ...(row.resourceId?{resourceId:row.resourceId}:{packageRequestId:row.packageRequestId,archiveSha256:row.sourceSha256})};
    });
    return {requestId:unique('browser-offer'),releaseId:local.publication.id,releaseManifestSha256:local.publication.manifestSha256,
      offerId:$('paidOfferId').value,title:$('paidOfferTitle').value.trim(),origin:origin.origin,payment:paymentTerms(),
      chunkBytes:Number($('paidChunkBytes').value),objects};
  }
  async function addSource(){
    const value=$('paidSource').value;must(value,'Select an original source or complete package.');
    let source,selected;
    if(value.startsWith('resource:')){
      source=summary.sources.find(row=>row.id===value.slice(9));must(source,'Reload the selected published source.');
      selected={resourceId:source.id,kind:source.kind,name:source.name,bytes:source.bytes,sourceSha256:source.sha256};
    }else{
      source=indexes.packages.find(row=>row.requestId===value.slice(8)&&row.state==='COMPLETE');
      must(source,'Reopen the complete original package first.');
      must(source.releaseId===local.publication?.id,'The selected operations package contains a different map publication.');
      selected={packageRequestId:source.requestId,kind:'operations',name:'Complete map operations',bytes:source.bytes,sourceSha256:source.archiveSha256};
    }
    must(local.objects.length<64,'One offer can select at most 64 original outputs.');
    const base=(selected.kind==='operations'?'operations':selected.kind.replace(/[^a-z0-9_-]/g,'-'))+'-'+(local.objects.length+1);
    const ext={pmtiles:'pmtiles',style:'json','sprite-json':'json','sprite-png':'png',glyph:'pbf',document:'bin',operations:'zip'}[selected.kind];
    local.objects.push({...selected,id:base,filename:base+'.'+ext,amount:'0'});save();renderObjects();
  }
  async function moreSources(){
    if(summary?.sourceNextAfter===null||!summary)return;
    const selected=summary.currentRelease,epoch=readEpoch,value=await read('sources',{after:String(summary.sourceNextAfter),limit:50});
    if(epoch!==readEpoch||!active)return;
    must(value.releaseId===selected.id&&value.releaseManifestSha256===selected.manifestSha256,'The published source selection changed; refresh before loading more.');
    const rows=new Map(summary.sources.map(row=>[row.id,row]));for(const row of value.items)rows.set(row.id,row);
    summary.sources=[...rows.values()];summary.sourceNextAfter=value.nextAfter===null?null:Number(value.nextAfter);sourceOptions();
  }
  async function selectSeller(id){
    const epoch=readEpoch,ticket=++sellerRead;
    local.seller={id,digest:null};comparison=null;renderSeller();
    const status=await tool('output_status'),selected=status.releases.find(row=>row.id===id);
    if(epoch!==readEpoch||ticket!==sellerRead||!active)return;
    must(selected,'The selected seller release is unavailable.');local.seller={id,digest:selected.digest};summary.output=status;save();renderSeller();
  }
  async function compareSeller(){
    must(local.seller,'Select an exact staged seller release.');
    const selected=copy(local.seller),status=await tool('output_status');
    const value=await tool('output_compare',{beforeReleaseId:status.state.active,releaseId:selected.id,releaseDigest:selected.digest});
    must(local.seller?.id===selected.id&&local.seller?.digest===selected.digest,'The selected seller changed during comparison.');
    comparison={releaseId:selected.id,releaseDigest:selected.digest,value};lastResult=value;summary.output=status;renderSeller();
  }
  async function preparePurchase(){
    const row=currentOutput(),buyer=currentBuyer();must(row&&selectedOffer,'Choose a complete output from a retained offer.');
    must(buyer?.available,'Choose a configured original buyer.');const budget=$('paidBudget').value.trim();
    must(atomic.test(budget)&&BigInt(budget)>=BigInt(row.pricing.completeDownloadAtomic),'Enter a total budget covering every original paid request.');
    must(BigInt(row.pricing.atomicPerRequest)<=BigInt(buyer.maxAtomic),'The exact per-request price exceeds this buyer’s configured cap.');
    const matches=row.offer.accepts.some(value=>['scheme','network','asset','payTo'].every(key=>value[key]===buyer.payment[key])&&
      (buyer.payment.maxTimeoutSeconds===undefined||value.maxTimeoutSeconds<=buyer.payment.maxTimeoutSeconds));
    must(matches&&new URL(row.url).origin===buyer.origin,'Select a buyer whose configured origin, asset, recipient and timeout match this output.');
    return dispatch('purchase_prepare',{requestId:unique('browser-purchase'),buyer:buyer.name,outputRequestId:selectedOffer.requestId,
      manifestSha256:selectedOffer.manifestSha256,objectId:row.id,maxTotalAtomic:budget});
  }
  async function accountingAction(suffix){
    const ref=originalReference(),observed=await openPurchase();
    must(observed&&same(ref,originalReference()),'The selected purchase changed while reading its original accounting identity.');
    const offset=Number($('paidAccountOffset').value),limit=Number($('paidAccountLimit').value);
    must(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=250,'Choose an original range of 1–250 requests.');
    must(Number.isSafeInteger(purchase.pricing?.requests)&&offset<=purchase.pricing.requests,'The accounting offset is outside this original purchase.');
    return dispatch(suffix,{...ref,offset,limit},jobBinding(suffix));
  }

  function bind(id,work){$(id).addEventListener('click',()=>runRead(work));}
  for(const button of panel.querySelectorAll('[data-paid-tab]'))button.addEventListener('click',()=>tab(button.dataset.paidTab));
  for(const id of Object.values(formFields))$(id).addEventListener('input',()=>{
    saveSafely();if(id==='paidChunkBytes')renderCosts();else if(id==='paidBuyer'||id==='paidBudget')renderBuyerTerms();else renderButtons();
  });
  $('paidSource').addEventListener('change',renderButtons);
  $('paidObject').addEventListener('change',()=>{if(local)local.objectId=$('paidObject').value;saveSafely();renderBuyerTerms();});
  $('paidPaymentPreset').addEventListener('change',()=>{
    const selected=summary?.buyers.find(row=>row.name===$('paidPaymentPreset').value);if(!selected?.available)return;
    for(const [field,id]of [['network','paidNetwork'],['asset','paidAsset'],['payTo','paidPayTo']])$(id).value=selected.payment[field];
    $('paidOrigin').value=selected.origin;$('paidTimeout').value=String(selected.payment.maxTimeoutSeconds??300);
    $('paidExtra').value='{}';saveSafely();
  });
  $('paidOfferSelect').addEventListener('change',()=>runRead(()=>openOffer($('paidOfferSelect').value)));
  $('paidPurchaseOffer').addEventListener('change',()=>runRead(()=>openOffer($('paidPurchaseOffer').value)));
  $('paidSellerSelect').addEventListener('change',()=>runRead(()=>selectSeller($('paidSellerSelect').value)));
  $('paidPurchaseSelect').addEventListener('change',()=>runRead(async()=>{
    const id=$('paidPurchaseSelect').value;if(!id)return;await loadRecord('purchase',id);await openPurchase();
  }));
  $('paidWorkKind').addEventListener('change',()=>runRead(async()=>{renderWork();if($('paidWorkKind').value!=='browser')await page($('paidWorkKind').value,{reset:true});}));
  bind('paidRefresh',()=>refresh({history:true,force:true}));
  bind('paidUsePublication',()=>{must(summary?.currentRelease,'Publish a reviewed map first.');
    local.publication=copy(summary.currentRelease);save();renderPublication();note('The draft now selects '+local.publication.id+'. Review its output sources and prices.');});
  bind('paidAddSource',addSource);bind('paidMoreSources',moreSources);
  bind('paidBuildPackage',()=>dispatch('package',{requestId:unique('browser-package')}));
  bind('paidPrepare',()=>dispatch('output_prepare',prepareInput()));
  bind('paidDraftDownload',()=>download({schema:SCHEMA,workspace:host.workspace,workspaceId:current.id,
    publication:local.publication,form:readForm(),objects:local.objects},'map-offer-draft.json'));
  bind('paidOpenOffer',()=>openOffer($('paidOfferSelect').value));
  bind('paidVerifyOffer',async()=>{
    must(local.offer,'Open a retained offer.');const ref=copy(local.offer);
    const result=await tool('output_package',{outputRequestId:ref.requestId,manifestSha256:ref.manifestSha256});
    if(same(local.offer,ref)){selectedOffer=result;lastResult=result;renderOffer();note('Verified the original retained output files and package manifest.');}
  });
  bind('paidDownloadCatalog',async()=>{
    must(local.offer,'Open a retained offer.');const selected=copy(local.offer),filename=(selectedOffer?.offerId??selected.requestId)+'-buyer-catalog.json';
    const value=await tool('output_catalog',{outputRequestId:selected.requestId,manifestSha256:selected.manifestSha256});
    lastResult=value;download(value,filename);renderPending();
  });
  bind('paidStage',()=>{
    must(local.offer,'Open a retained priced offer.');must(identifier.test($('paidSellerId').value),'Enter a valid seller release ID.');
    return dispatch('output_stage',{requestId:unique('browser-stage'),outputRequestId:local.offer.requestId,
      manifestSha256:local.offer.manifestSha256,releaseId:$('paidSellerId').value,label:$('paidSellerLabel').value||$('paidSellerId').value,
      runtime:$('paidRuntime').value});
  });
  bind('paidCompare',compareSeller);
  bind('paidActivate',async()=>{
    must(comparison&&local.seller&&comparison.releaseId===local.seller.id&&comparison.releaseDigest===local.seller.digest,'Compare the selected seller first.');
    const selected=copy(local.seller),review=copy(comparison),reason=$('paidChangeReason').value.trim();must(reason,'Enter the selection reason.');
    const currentStatus=await tool('output_status');
    must(same(local.seller,selected)&&same(comparison,review),'The reviewed seller selection changed before activation.');
    must(currentStatus.state.generation===review.value.state.generation&&currentStatus.state.active===review.value.state.active,
      'The active seller changed. Compare its current selection before activation.');
    return dispatch('output_activate',{requestId:unique('browser-activate'),releaseId:selected.id,releaseDigest:selected.digest,
      expectedGeneration:review.value.state.generation,reason});
  });
  bind('paidStart',async()=>{
    must(local.seller,'Select a retained seller release.');const selected=copy(local.seller),status=await tool('output_status');
    must(same(local.seller,selected)&&status.state.active===selected.id,'The active seller selection changed.');
    return dispatch('output_start',{requestId:unique('browser-start'),releaseId:selected.id,releaseDigest:selected.digest,expectedGeneration:status.state.generation});
  });
  bind('paidStop',async()=>{
    const status=await tool('output_status'),observed=status.runtime.observed;
    must(status.runtime.owned&&observed?.instanceId,'This merchant must own the current seller instance to stop it.');
    return dispatch('output_stop',{requestId:unique('browser-stop'),releaseId:observed.releaseId,
      releaseDigest:observed.releaseDigest,instanceId:observed.instanceId});
  });
  bind('paidUseBudget',()=>{must(currentOutput(),'Choose a complete output.');$('paidBudget').value=currentOutput().pricing.completeDownloadAtomic;save();renderBuyerTerms();});
  bind('paidPreparePurchase',preparePurchase);bind('paidOpenPurchase',openPurchase);
  bind('paidRunPurchase',()=>dispatch('purchase_run',originalReference()));
  bind('paidRecoverPurchase',()=>dispatch('purchase_recover',originalReference()));
  function customerRequest(field,prefix){const node=$(field);if(!node.value)node.value=unique(prefix);
    must(identifier.test(node.value),'Keep a valid original customer request ID.');save();return node.value;}
  bind('paidAdopt',()=>dispatch('purchase_adopt',{requestId:customerRequest('paidAdoptRequestId','browser-adopt'),...originalReference()}));
  bind('paidReceive',()=>dispatch('purchase_receive',{requestId:customerRequest('paidReceiveRequestId','browser-receive'),...originalReference(),target:$('paidTarget').value}));
  bind('paidReadAccounting',()=>accountingAction('purchase_accounting'));
  bind('paidFinalizeRange',()=>accountingAction('purchase_finalize'));
  bind('paidRecoverAccounting',async()=>{
    const selected=originalReference(),epoch=readEpoch,value=await tool('purchase_accounting_recover',selected);
    if(epoch!==readEpoch||!active||local.purchase?.requestId!==selected.purchaseRequestId||local.purchase?.buyer!==selected.buyer)return;
    must(value.requestId===selected.purchaseRequestId,'The recovered accounting purchase changed.');
    accounting=value;lastResult=value;renderAccounting();note('Reopened the original accounting command and its latest complete native response.');
  });
  bind('paidNextAccounting',()=>{
    const range=accountingResult()?.native?.range;must(range&&range.nextOffset!==null,'This original accounting response has no next range.');
    $('paidAccountOffset').value=String(range.nextOffset);save();note('The next original range is selected. Read or finalize it to continue.');
  });
  bind('paidLoadWork',()=>page($('paidWorkKind').value,{reset:true}));bind('paidMoreWork',()=>page($('paidWorkKind').value));
  bind('paidReadRecord',()=>loadRecord($('paidReadKind').value,$('paidReadId').value.trim()));
  bind('paidResumeRecord',async()=>{
    must(record?.resume,'Read an exact original request first.');must(record.buyerAvailable!==false,'The original buyer alias must be selected in the current host configuration.');
    if(record.browserJob){
      must(!running&&!local.pending,'Recover or retain the current browser request first.');
      local.pending=copy(record.browserJob);save();return sendJob(copy(local.pending),{recover:true});
    }
    const job=retainedJob(record.resume.tool,record.resume.args);return sendJob(job,{recover:true});
  });
  bind('paidResumePending',()=>{must(local.pending,'There is no retained browser request.');return sendJob(copy(local.pending),{recover:true});});
  bind('paidKeepPending',()=>{
    must(local.pending&&!running,'Wait for the accepted request to return before changing its browser selection.');
    const old=local.jobs.find(row=>row.id===local.pending.id);if(old)old.phase='RETAINED';local.pending=null;save();renderButtons();renderWork();
    note('The original request remains in Saved work. The offer draft and selected purchase are retained.');
  });
  bind('paidDownloadRequest',()=>{must(local.pending,'There is no selected browser request.');download(local.pending,'pmtiles-original-request.json');});
  bind('paidLastResultDownload',()=>{must(lastResult,'Read an original result first.');download(lastResult,'pmtiles-selected-result.json');});
  async function connect(value){
    if(connecting)return connecting;
    const promise=(async()=>{
      const selected=await api('/api/merchant');
      must(selected.schema==='starforge.pmtiles-browser-merchant.v1'&&selected.workspaceId===value.id,'The merchant workspace descriptor changed.');
      if(!selected.configured){panel.hidden=true;host=null;return;}
      must(Array.isArray(selected.tools)&&selected.tools.includes('merchant_pmtiles_output_workbench'),'The selected merchant needs its current paid-output workbench module.');
      const selectedKey=SCHEMA+':'+location.origin+':'+value.id+':'+selected.workspace;
      active=true;host=selected;current=copy(value);panel.hidden=false;panel.dataset.workspaceId=value.id;
      if(key!==selectedKey){
        readEpoch++;refreshing=null;key=selectedKey;summary=null;selectedOffer=null;purchase=null;comparison=null;accounting=null;record=null;
        for(const name of Object.keys(indexes)){indexes[name]=[];delete cursors[name];}
        const raw=localStorage.getItem(key),saved=raw?JSON.parse(raw):null;
        if(saved){must(saved.schema===SCHEMA&&saved.workspace===host.workspace&&saved.workspaceId===value.id&&
          Array.isArray(saved.objects)&&Array.isArray(saved.jobs),'The retained commerce draft has a different workspace identity.');local=saved;}
        else local=freshLocal();
        applyForm({...defaults,...local.form});renderObjects();renderRecord();renderAccounting();
      }
      await refresh({history:true,force:true});tab(local.tab??'offer');
      if(local.offer)await openOffer(local.offer.requestId).catch(error=>note(safeMessage(error),true));
      if(local.purchase)await openPurchase().catch(error=>note(safeMessage(error),true));
      renderPending();renderButtons();
      if(local.pending)note('An original request is retained. Recover this request to read or continue its same operation.');
    })();
    connecting=promise;try{return await promise;}finally{if(connecting===promise)connecting=null;}
  }
  return Object.freeze({
    connect,
    observe(value){
      active=true;
      if(!host?.configured)return;
      if(value.id!==host.workspaceId){readEpoch++;panel.hidden=true;host=null;return;}
      const changed=current?.currentRelease!==value.currentRelease;current=copy(value);
      if(!running&&(changed||Date.now()-lastRefresh>15000))void refresh().catch(()=>{});
    },
    refresh:()=>refresh({history:true,force:true}),
    close(){saveSafely();active=false;readEpoch++;},
    report(error){note(safeMessage(error),true);}
  });
}
