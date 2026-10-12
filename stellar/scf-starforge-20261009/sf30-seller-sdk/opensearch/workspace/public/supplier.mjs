// MIT. Supplier delivery and corrections in the existing industrial catalog workspace.
const pretty=value=>JSON.stringify(value,null,2);
const split=value=>value.split(',').map(item=>item.trim()).filter(Boolean);
const encoded=value=>encodeURIComponent(value);
function valueAt(value,path){
  if(path==='/')return value;
  let current=value;
  for(const key of path.slice(1).split('/').map(part=>part.replaceAll('~1','/').replaceAll('~0','~'))){
    if(current===null||typeof current!=='object'||!Object.hasOwn(current,key))return null;
    current=current[key];
  }
  return current;
}
export function createSupplierController({container,api,perform,host,notice,element,attempt}){
  const $=id=>container.querySelector('#sup-'+id);
  let catalog=null,editions=[],snapshot={plans:[],reviews:[]},template=null,plan=null,review=null;
  let reading=false,planDirty=false,patchDirty=false,offset=0,next=null,current=null,patches=[];
  let profileJsonDirty=false,bindingJsonDirty=false;
  container.innerHTML=[
    '<div class="section-heading"><div><h3>Supplier delivery</h3><p class="help">Choose a delivery profile, resolve product findings and download the reviewed submission.</p></div><button id="sup-refresh" type="button">Refresh delivery</button></div>',
    '<div class="two-column"><label>Saved submission<select id="sup-plan"></select></label><div class="actions"><button id="sup-new" type="button">New submission</button><button id="sup-reload" type="button">Reload saved submission</button></div></div>',
    '<p id="sup-identity" class="summary">Choose a saved material catalog first.</p>',
    '<article><h3>Submission settings</h3><div class="two-column"><label>Submission title<input id="sup-title" maxlength="120" autocomplete="off"></label><label>Catalog edition<select id="sup-edition"></select></label></div>',
    '<div class="two-column"><fieldset><legend>Delivery requirements</legend><label class="cat-check"><input id="sup-sonepar" type="checkbox">Sonepar product data, April 2026</label><label class="cat-check"><input id="sup-bmecat" type="checkbox">ETIM BMEcat 5.0</label></fieldset><div><label>Languages, ISO 639-2 codes separated by commas<input id="sup-languages" placeholder="eng, fra"></label><label>Target countries, separated by commas<input id="sup-countries" placeholder="CA"></label></div></div>',
    '<div class="two-column"><label>Default language<input id="sup-language" maxlength="3" placeholder="eng"></label><label>Supplier role<select id="sup-role"><option value="manufacturer">Manufacturer</option><option value="reseller">Reseller</option><option value="agency">Agency</option></select></label></div>',
    '<details><summary>Catalog and trading parties</summary><div class="two-column"><label>Supplier name<input id="sup-supplier-name"></label><label>Buyer name<input id="sup-buyer-name"></label><label>Delivery catalog ID<input id="sup-catalog-id"></label><label>Delivery catalog version<input id="sup-catalog-version"></label><label>Generation date<input id="sup-date" placeholder="YYYY-MM-DD"></label><label>Currency<input id="sup-currency" maxlength="3" placeholder="CAD"></label></div></details>',
    '<label>Previous supplier review for product changes<select id="sup-previous-review"></select><span class="help">Choose the prior delivered edition when reviewing identifier, brand and successor changes.</span></label>',
    '<details open><summary>Map supplier fields</summary><p class="help">Map each delivery field to an original material field. Use JSON pointers such as /brand and /attributes/brand. A fixed value includes its reason: {"constant":"Actual value","reason":"Supplier declaration"}.</p>',
    '<div id="sup-bindings" class="table-wrap"></div><button id="sup-add-binding" type="button">Add field mapping</button>',
    '<details><summary>Bulk mapping as JSON</summary><label>Field mappings<textarea id="sup-binding-json" class="code" rows="8" spellcheck="false"></textarea></label><button id="sup-use-binding-json" type="button">Apply mappings to table</button></details></details>',
    '<details><summary>Complete profile and local requirements</summary><p class="help">Set applicable documents, packaging conversions, classification definitions and any sourced local requirements. The complete saved values remain editable here.</p><label>Profile JSON<textarea id="sup-profile-json" class="code" rows="16" spellcheck="false"></textarea></label><button id="sup-use-profile-json" type="button">Apply profile to fields</button><details><summary>Available product fields</summary><pre id="sup-template"></pre></details><p id="sup-source" class="help"></p></details>',
    '<div class="actions"><button id="sup-save" type="button" class="primary">Save and review products</button><button id="sup-review" type="button">Review saved submission</button></div></article>',
    '<article><h3>Product review</h3><label>Retained review<select id="sup-review-select"></select></label><p id="sup-review-summary" class="summary">Save a submission to review its complete product edition.</p><div id="sup-counts" class="cat-counts"></div><section id="sup-delivery-findings" hidden></section>',
    '<div class="cat-table-controls"><label>Show<select id="sup-status"><option value="errors">Products with errors</option><option value="warnings">Products with warnings</option><option value="ready">Ready products</option><option value="all">All products</option></select></label><label>Material or supplier identifier<input id="sup-search" type="search"></label><button id="sup-find" type="button">Show products</button></div>',
    '<div id="sup-rows" class="table-wrap"></div><div class="actions"><button id="sup-back" type="button">Previous products</button><span id="sup-page" class="help"></span><button id="sup-next" type="button">Next products</button></div>',
    '<section id="sup-product" hidden><h4 id="sup-product-title"></h4><p id="sup-product-state" class="help"></p><div id="sup-findings"></div>',
    '<div class="two-column"><details><summary>Original mapped product</summary><pre id="sup-base"></pre></details><details><summary>Current corrected product</summary><pre id="sup-corrected"></pre></details></div>',
    '<h4>Correct a product field</h4><div class="two-column"><label>Field path<input id="sup-patch-path" placeholder="/descriptions/eng/short"></label><label>Value type<select id="sup-patch-type"><option value="text">Exact text</option><option value="json">Object, array, number or null as JSON</option></select></label></div>',
    '<label>Replacement value<textarea id="sup-patch-value" rows="4"></textarea></label><label>Reason for this correction<textarea id="sup-patch-reason" rows="2" maxlength="2000"></textarea></label>',
    '<button id="sup-add-patch" type="button">Add or update correction</button><div id="sup-patches" class="table-wrap"></div>',
    '<div class="actions"><button id="sup-save-patches" type="button" class="primary">Save corrections and review</button><button id="sup-reopen-product" type="button">Reopen current product</button></div></section></article>',
    '<article><h3>Delivery files</h3><p id="sup-export-note" class="help">Choose a retained review. Review data and correction findings are available throughout preparation.</p><div id="sup-exports" class="file-list"></div><p class="help">Use the complete catalog bundle in Search and handover to transfer the submission, every correction and all retained reviews.</p></article>'
  ].join('');
  function parseEditor(value,label){
    try{return JSON.parse(value);}catch{throw Error(label+' must be valid JSON. Your edits remain in the form.');}
  }
  function select(id,rows,label,chosen,empty){
    const node=$(id),old=chosen??node.value;
    node.replaceChildren(element('option',empty,{value:''}));
    for(const row of rows)node.append(element('option',label(row),{value:row.id}));
    if(rows.some(row=>row.id===old))node.value=old;
  }
  function setDirty(){planDirty=true;buttons();}
  function bindingValues(){
    const result={};
    for(const row of $('bindings').querySelectorAll('tbody tr')){
      const path=row.querySelector('[data-field="path"]').value.trim(),raw=row.querySelector('[data-field="value"]').value.trim();
      if(!path&&!raw)continue;
      if(!path||!raw)throw Error('Each mapping needs a delivery field and an original field or declared value.');
      if(Object.hasOwn(result,path))throw Error('The delivery field '+path+' is mapped more than once.');
      result[path]=raw.startsWith('{')?parseEditor(raw,'Declared value'):raw;
    }
    return result;
  }
  function renderBindings(bindings){
    const table=element('table'),head=element('thead'),heading=element('tr'),body=element('tbody');
    for(const title of ['Delivery field','Original field or declared value',''])heading.append(element('th',title));
    head.append(heading);table.append(head,body);$('bindings').replaceChildren(table);
    for(const [path,value]of Object.entries(bindings))addBinding(path,value);
    $('binding-json').value=pretty(bindings);bindingJsonDirty=false;
  }
  function addBinding(path='',value=''){
    const row=element('tr'),pathCell=element('td'),valueCell=element('td'),action=element('td');
    const first=element('input',undefined,{'data-field':'path','aria-label':'Delivery field',value:path});
    const second=element('input',undefined,{'data-field':'value','aria-label':'Original field or declared value',value:typeof value==='string'?value:JSON.stringify(value)});
    const remove=element('button','Remove',{type:'button'});
    remove.addEventListener('click',()=>{row.remove();bindingJsonDirty=false;setDirty();});
    for(const node of [first,second])node.addEventListener('input',()=>{bindingJsonDirty=false;setDirty();});
    pathCell.append(first);valueCell.append(second);action.append(remove);row.append(pathCell,valueCell,action);
    $('bindings').querySelector('tbody').append(row);
  }
  function displayedName(value,language){
    return value&&typeof value==='object'&&!Array.isArray(value)?value[language]??Object.values(value).find(item=>typeof item==='string')??'':value??'';
  }
  function editedName(value,next,language){
    if(value&&typeof value==='object'&&!Array.isArray(value))return next===displayedName(value,language)?value:{...value,[language]:next};
    return next;
  }
  function fillProfile(profile){
    $('sonepar').checked=profile.targets?.includes('sonepar')??false;$('bmecat').checked=profile.targets?.includes('bmecat-5.0')??false;
    $('languages').value=(profile.languages??[]).join(', ');$('countries').value=(profile.countries??[]).join(', ');
    $('language').value=profile.defaultLanguage??'';$('role').value=profile.role??'manufacturer';
    const envelope=profile.envelope??{};
    for(const [id,value]of [['supplier-name',envelope.supplier?.name],['buyer-name',envelope.buyer?.name],
      ['catalog-id',envelope.catalogId],['catalog-version',envelope.catalogVersion],['date',envelope.generationDate],['currency',envelope.currency]])
      $(id).value=displayedName(value,profile.defaultLanguage);
    $('profile-json').value=pretty(profile);profileJsonDirty=false;
  }
  function profileValues(){
    const profile=parseEditor($('profile-json').value,'Profile');
    if(profileJsonDirty)return profile;
    const previousLanguage=profile.defaultLanguage;
    profile.targets=[$('sonepar').checked?'sonepar':null,$('bmecat').checked?'bmecat-5.0':null].filter(Boolean);
    profile.languages=split($('languages').value);profile.countries=split($('countries').value);
    profile.defaultLanguage=$('language').value.trim();profile.role=$('role').value;
    profile.envelope??={};profile.envelope.supplier??={};profile.envelope.buyer??={};
    profile.envelope.supplier.name=editedName(profile.envelope.supplier.name,$('supplier-name').value,previousLanguage);
    profile.envelope.buyer.name=editedName(profile.envelope.buyer.name,$('buyer-name').value,previousLanguage);
    for(const [id,key]of [['catalog-id','catalogId'],['catalog-version','catalogVersion'],['date','generationDate'],['currency','currency']])
      profile.envelope[key]=$(id).value;
    return profile;
  }
  function renderSelections(){
    select('plan',snapshot.plans,item=>item.title+' · revision '+item.revision,plan?.id,'New submission');
    select('edition',editions,item=>item.id+' · '+item.counts.total+' materials',planDirty?$('edition').value:plan?.editionId??catalog?.activeEditionId,'Choose a retained catalog edition');
    const selected=snapshot.reviews.filter(item=>item.planId===plan?.id);
    select('review-select',selected,item=>item.createdAt+' · '+item.counts.errors+' errors',review?.id,'Choose a retained review');
    select('previous-review',selected,item=>item.createdAt+' · edition '+item.editionId,planDirty?$('previous-review').value:plan?.previousReviewId,'No earlier delivery selected');
  }
  function fillPlan(value){
    plan=value;planDirty=false;current=null;patches=[];patchDirty=false;$('product').hidden=true;
    $('title').value=value?.title??(catalog?catalog.title+' supplier delivery':'');
    fillProfile(value?.profile??template?.profile??{});renderBindings(value?.bindings??template?.bindings??{});
    renderSelections();$('identity').textContent=value?value.title+' · revision '+value.revision+' · saved '+value.updatedAt:
      catalog?'New supplier submission for '+catalog.title+'.':'Choose a saved material catalog first.';
    buttons();
  }
  function setCatalog(value,values=[]){
    const changed=value?.id!==catalog?.id;catalog=value;editions=values;
    if(changed){snapshot={plans:[],reviews:[]};plan=null;review=null;fillPlan(null);renderReview();}
    else renderSelections();
    buttons();
  }
  async function read(action){
    if(reading)return;reading=true;buttons();
    try{return await action();}finally{reading=false;buttons();}
  }
  async function sync(value,values=[]){
    setCatalog(value,values);
    if(!catalog)return;
    if(!template){
      template=await api('/api/catalog/supplier/profile');$('template').textContent=pretty(template.product);
      $('source').textContent='Profile '+template.profileId;
      if(!plan&&!planDirty)fillPlan(null);
    }
    snapshot=await api('/api/catalog/supplier/state?'+new URLSearchParams({catalogId:catalog.id}));
    renderSelections();
    if(plan&&!planDirty){
      const saved=snapshot.plans.find(item=>item.id===plan.id);
      if(saved&&saved.revision!==plan.revision)fillPlan(saved);
    }
    buttons();
  }
  async function openPlan(id,selectedReviewId){
    const value=await api('/api/catalog/supplier/plan?'+new URLSearchParams({planId:id}));
    fillPlan(value);review=null;offset=0;
    const latest=snapshot.reviews.find(item=>item.planId===value.id);
    if(selectedReviewId??latest?.id)await openReview(selectedReviewId??latest.id);else renderReview();
  }
  function renderReview(){
    const counts=review?.counts;$('counts').replaceChildren();$('exports').replaceChildren();
    const global=$('delivery-findings');global.replaceChildren();global.hidden=!review?.globalFindings?.length;
    if(!global.hidden){global.append(element('h4','Delivery requirements'));
      for(const finding of review.globalFindings){const item=element('p');item.append(element('strong',finding.severity+' · '+finding.code+': '),document.createTextNode(finding.message+' '));
        if(/^https?:\/\//i.test(finding.rule?.url??''))item.append(element('a',finding.rule.section??'Source rule',{href:finding.rule.url,target:'_blank',rel:'noreferrer'}));global.append(item);}}

    $('review-summary').textContent=review?review.createdAt+' · submission revision '+review.planRevision+' · '+review.counts.total+' products':
      'Save a submission to review its complete product edition.';
    if(counts)for(const [label,value]of [['Products',counts.total],['Ready',counts.readyProducts],['Errors',counts.errors],['Warnings',counts.warnings]]){
      const item=element('div');item.append(element('strong',String(value)),element('span',label));$('counts').append(item);
    }
    if(!review){$('rows').replaceChildren();$('page').textContent='';$('product').hidden=true;return;}
    const formats=[['review.json','Review summary'],['issues.csv','Correction findings (CSV)'],['products.jsonl','Complete reviewed product data (JSONL)']];
    if(!counts.errors&&counts.total&&review.plan.profile.targets.includes('bmecat-5.0'))formats.push(['bmecat.xml','BMEcat delivery (XML)']);
    for(const [format,label]of formats)$('exports').append(element('a',label,{href:'/api/catalog/supplier/export?'+new URLSearchParams({
      reviewId:review.id,expectedReviewSha256:review.sha256,format})}));
    $('export-note').textContent=counts.errors?counts.errors+' delivery errors remain. Resolve the delivery requirements or affected product fields, then review again.':
      'The selected review is ready for the chosen delivery requirements. Warnings remain visible in its review data.';
    renderSelections();buttons();
  }
  async function openReview(id){
    if(!id){review=null;current=null;renderReview();return;}
    review=await api('/api/catalog/supplier/review?'+new URLSearchParams({reviewId:id}));offset=0;next=null;current=null;$('product').hidden=true;
    if(!review.counts.errorProducts)$('status').value='all';
    renderReview();await loadRows();
  }
  async function loadRows(){
    if(!review)return;
    const result=await api('/api/catalog/supplier/rows?'+new URLSearchParams({reviewId:review.id,offset:String(offset),limit:'50',status:$('status').value,search:$('search').value}));
    next=result.nextOffset;
    const table=element('table'),head=element('thead'),hr=element('tr'),body=element('tbody');
    for(const name of ['Material','Supplier product','Errors','Warnings',''])hr.append(element('th',name));
    head.append(hr);table.append(head,body);
    for(const row of result.rows){
      const tr=element('tr'),action=element('td'),open=element('button','Review product',{type:'button'});
      for(const value of [row.materialId,row.product.supplierProductId??'',row.findings.filter(item=>item.severity==='error').length,row.findings.filter(item=>item.severity==='warning').length])
        tr.append(element('td',String(value)));
      open.addEventListener('click',()=>attempt(()=>read(()=>inspect(row))));action.append(open);tr.append(action);body.append(tr);
    }
    $('rows').replaceChildren(table);$('page').textContent=result.total?String(offset+1)+'–'+String(offset+result.rows.length)+' of '+result.total+' products':'No products in this view.';
    buttons();
  }
  function choosePath(path){
    if(!path||path==='/')return;
    if(path==='/profile'||path.startsWith('/profile/')||path==='/submission'||path.startsWith('/submission/')){
      const fields={'/profile/languages':'languages','/profile/countries':'countries',
        '/profile/defaultLanguage':'language','/profile/role':'role',
        '/profile/envelope/supplier/name':'supplier-name','/profile/envelope/buyer/name':'buyer-name',
        '/profile/envelope/catalogId':'catalog-id','/profile/envelope/catalogVersion':'catalog-version',
        '/profile/envelope/generationDate':'date','/profile/envelope/currency':'currency'};
      const field=$(fields[path]??'profile-json');
      for(let parent=field.parentElement;parent&&parent!==container;parent=parent.parentElement)
        if(parent.tagName==='DETAILS')parent.open=true;
      notice(path.startsWith('/submission/')?
        'Set the previous complete product identifiers in profile.envelope.previousProductIds, then save and review the submission.':
        'Update '+path.slice('/profile'.length)+' in the submission settings, then save and review the products.');
      field.focus();field.scrollIntoView({block:'center'});return;
    }
    const value=valueAt(current.product,path);$('patch-path').value=path;
    $('patch-type').value=typeof value==='string'?'text':'json';
    $('patch-value').value=typeof value==='string'?value:pretty(value);$('patch-reason').value='';
    $('patch-value').focus();
  }
  async function inspect(row){
    if(patchDirty&&!window.confirm('Reopen the product and discard its unsaved correction edits?'))return;
    const historical=row.planRevision!==undefined&&row.planRevision!==plan.revision;
    current=historical?{historical:true,material:{key:row.materialKey,materialId:row.materialId},base:row.product,product:row.product,correction:null}:
      await api('/api/catalog/supplier/product?'+new URLSearchParams({planId:plan.id,materialKey:row.materialKey}));
    patches=structuredClone(current.correction?.patches??[]);patchDirty=false;
    $('product').hidden=false;$('product-title').textContent='Material '+current.material.materialId;
    $('product-state').textContent=current.historical?'Retained historical review. Review the current saved submission to edit its products.':(current.correction?'Correction revision '+current.correction.revision:'No saved correction')+
      (current.correction&&!current.correctionApplicable?' · source changed; confirm the saved values before applying them.':'');
    $('base').textContent=pretty(current.base);$('corrected').textContent=pretty(current.product);$('findings').replaceChildren();
    for(const finding of row.findings){
      const item=element('div',undefined,{class:'sup-finding'}),button=element('button',finding.path==='/'?'Review product':finding.path,{type:'button'});
      button.addEventListener('click',()=>choosePath(finding.path));
      item.append(element('strong',finding.severity+' · '+finding.code),element('p',finding.message),button);
      if(/^https?:\/\//.test(finding.rule?.url??''))item.append(element('a',finding.rule.section??'Source requirement',{href:finding.rule.url,target:'_blank',rel:'noreferrer'}));
      $('findings').append(item);
    }
    $('patch-path').value='';$('patch-value').value='';$('patch-reason').value='';renderPatches();buttons();
  }
  function renderPatches(){
    const table=element('table'),head=element('thead'),hr=element('tr'),body=element('tbody');
    for(const title of ['Field','Saved replacement','Reason',''])hr.append(element('th',title));head.append(hr);table.append(head,body);
    for(const [index,patch]of patches.entries()){
      const row=element('tr'),action=element('td'),remove=element('button','Remove',{type:'button'});
      row.append(element('td',patch.path),element('td',typeof patch.value==='string'?patch.value:JSON.stringify(patch.value)),element('td',patch.reason));
      remove.addEventListener('click',()=>{patches.splice(index,1);patchDirty=true;renderPatches();buttons();});
      action.append(remove);row.append(action);body.append(row);
    }
    $('patches').replaceChildren(table);
  }
  async function reviewSaved(){
    if(!plan)throw Error('Save the supplier submission first.');
    await perform('catalog',{action:'supplier-review',planId:plan.id,expectedRevision:plan.revision});
  }
  function buttons(){
    const busy=reading||host.busy,held=busy||Boolean(host.pending),ready=Boolean(catalog&&template);
    for(const node of container.querySelectorAll('button,input,textarea,select'))node.disabled=held||!ready;
    $('refresh').disabled=busy||!catalog;$('new').disabled=held||!ready;
    $('reload').disabled=held||!plan;$('save').disabled=held||!ready;
    $('review').disabled=held||!plan||planDirty;$('find').disabled=held||!review;
    $('back').disabled=held||!review||offset===0;$('next').disabled=held||next===null;
    $('add-patch').disabled=held||!current||current.historical||planDirty;
    $('save-patches').disabled=held||!current||current.historical||planDirty;
    $('reopen-product').disabled=held||!current||current.historical;
  }
  for(const id of ['title','edition','sonepar','bmecat','languages','countries','language','role','supplier-name','buyer-name','catalog-id','catalog-version','date','currency','previous-review','profile-json','binding-json'])
    $(id).addEventListener('input',()=>{if(id==='profile-json')profileJsonDirty=true;else if(id==='binding-json')bindingJsonDirty=true;else if(!['title','edition','previous-review'].includes(id))profileJsonDirty=false;setDirty();});
  for(const id of ['patch-path','patch-type','patch-value','patch-reason'])$(id).addEventListener('input',()=>{patchDirty=true;buttons();});
  $('add-binding').addEventListener('click',()=>{addBinding();bindingJsonDirty=false;setDirty();});
  $('use-binding-json').addEventListener('click',()=>attempt(async()=>{renderBindings(parseEditor($('binding-json').value,'Mappings'));setDirty();}));
  $('use-profile-json').addEventListener('click',()=>attempt(async()=>{fillProfile(parseEditor($('profile-json').value,'Profile'));setDirty();}));
  $('refresh').addEventListener('click',()=>attempt(()=>read(()=>sync(catalog,editions))));
  $('new').addEventListener('click',()=>{if((planDirty||patchDirty)&&!window.confirm('Start another submission and discard unsaved edits?'))return;review=null;fillPlan(null);renderReview();});
  $('reload').addEventListener('click',()=>attempt(()=>read(async()=>{if((planDirty||patchDirty)&&!window.confirm('Reload the saved submission and discard unsaved edits?'))return;await openPlan(plan.id);})));
  $('plan').addEventListener('change',()=>attempt(()=>read(async()=>{const id=$('plan').value;if(!id)return;if((planDirty||patchDirty)&&!window.confirm('Open another submission and discard unsaved edits?')){$('plan').value=plan?.id??'';return;}await openPlan(id);})));
  $('save').addEventListener('click',()=>attempt(async()=>{
    const bindings=bindingJsonDirty?parseEditor($('binding-json').value,'Mappings'):bindingValues();$('binding-json').value=pretty(bindings);
    const outcome=await perform('catalog',{action:'supplier-save',...(plan?{planId:plan.id,expectedRevision:plan.revision}:{}),
      catalogId:catalog.id,title:$('title').value,editionId:$('edition').value,previousReviewId:$('previous-review').value||null,
      profile:profileValues(),bindings});
    if(outcome?.state==='COMPLETE'&&outcome.result?.supplierPlan)await reviewSaved();
  }));
  $('review').addEventListener('click',()=>attempt(reviewSaved));
  $('review-select').addEventListener('change',()=>attempt(()=>read(()=>openReview($('review-select').value))));
  $('find').addEventListener('click',()=>attempt(()=>read(async()=>{offset=0;await loadRows();})));
  $('search').addEventListener('keydown',event=>{if(event.key==='Enter'){$('find').click();event.preventDefault();}});
  $('back').addEventListener('click',()=>attempt(()=>read(async()=>{offset=Math.max(0,offset-50);await loadRows();})));
  $('next').addEventListener('click',()=>attempt(()=>read(async()=>{offset=next;await loadRows();})));
  $('add-patch').addEventListener('click',()=>attempt(async()=>{
    const path=$('patch-path').value.trim(),reason=$('patch-reason').value;
    if(!path.startsWith('/')||!reason.trim())throw Error('Choose a field path and give the reason for its correction.');
    if(path==='/profile'||path.startsWith('/profile/')||path==='/submission'||path.startsWith('/submission/')){
      choosePath(path);return;
    }
    const value=$('patch-type').value==='text'?$('patch-value').value:parseEditor($('patch-value').value,'Replacement value');
    const index=patches.findIndex(item=>item.path===path),patch={path,value,reason};
    if(index<0)patches.push(patch);else patches[index]=patch;patchDirty=true;renderPatches();buttons();
  }));
  $('save-patches').addEventListener('click',()=>attempt(async()=>{
    const outcome=await perform('catalog',{action:'supplier-correction',planId:plan.id,expectedPlanRevision:plan.revision,
      materialKey:current.material.key,expectedRevision:current.correction?.revision??0,
      expectedMaterialSha256:current.material.sha256,expectedBaseProductSha256:current.baseProductSha256,patches});
    if(outcome?.state==='COMPLETE'&&outcome.result?.supplierCorrection)await reviewSaved();
  }));
  $('reopen-product').addEventListener('click',()=>attempt(()=>read(()=>inspect({materialKey:current.material.key,findings:[]}))));
  buttons();
  return {setCatalog,sync,buttons,hasUnsaved:()=>planDirty||patchDirty,
    async acceptOperation(operation){
      const result=operation.result??{};
      if(result.supplierPlan){await sync(catalog,editions);await openPlan(result.supplierPlan.id);notice('Supplier submission saved.');return true;}
      if(result.supplierCorrection){
        await sync(catalog,editions);await openPlan(result.supplierCorrection.planId);
        notice('Saved product correction revision '+result.supplierCorrection.revision+'.');return true;
      }
      if(result.supplierReview){
        await sync(catalog,editions);await openPlan(result.supplierReview.planId,result.supplierReview.id);
        notice('Reviewed all '+result.supplierReview.counts.total+' supplier products.');return true;
      }
      return false;
    },
    restorePending(pending){
      if(pending?.kind!=='catalog'||!pending.payload?.action?.startsWith('supplier-'))return;
      const value=pending.payload;
      if(value.planId&&value.action!=='supplier-save'){
        const selected=snapshot.plans.find(item=>item.id===value.planId);if(selected)fillPlan(selected);
      }
      if(value.action==='supplier-save'){
        plan=value.planId?snapshot.plans.find(item=>item.id===value.planId)??null:null;
        $('title').value=value.title;fillProfile(value.profile);renderBindings(value.bindings);
        $('edition').value=value.editionId;$('previous-review').value=value.previousReviewId??'';planDirty=true;
      }
      if(value.action==='supplier-correction'){patches=structuredClone(value.patches);patchDirty=true;renderPatches();}
      buttons();
    }
  };
}
