// MIT. ETIM xChange delivery settings and recipient effects in the original supplier operator.
const PROFILE='stellar-forge.supplier-xchange-profile.v1';
const NUMBER=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const pretty=value=>JSON.stringify(value,null,2);
const escapePointer=value=>String(value).replaceAll('~','~0').replaceAll('/','~1');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>structuredClone(value);
export const isXChangeProfile=profile=>profile?.schema===PROFILE;
export function parseExactJSON(text){
  if(typeof text!=='string'||text.length>2097152)throw Error('Enter a complete JSON value up to 2 MiB.');
  let at=0;const numberTokens={};
  const white=()=>{while(at<text.length&&/[\x20\t\r\n]/.test(text[at]))at++;};
  const fail=message=>{throw Error(message+' at character '+(at+1)+'.');};
  function string(){
    const start=at++;
    while(at<text.length){
      const c=text[at++];
      if(c==='"'){try{return JSON.parse(text.slice(start,at));}catch{fail('Invalid JSON string');}}
      if(c==='\\'){if(at>=text.length)fail('Unfinished JSON escape');at++;}
      else if(c.charCodeAt(0)<32)fail('Control character in JSON string');
    }
    fail('Unfinished JSON string');
  }
  function value(path,depth){
    if(depth>96)fail('JSON nesting exceeds 96 levels');white();
    const c=text[at];
    if(c==='"')return string();
    if(c==='{'){
      at++;white();const result={};
      if(text[at]==='}'){at++;return result;}
      for(;;){
        white();if(text[at]!=='"')fail('Expected an object key');
        const key=string();if(Object.hasOwn(result,key))fail('Duplicate object key '+key);
        white();if(text[at++]!==':')fail('Expected a colon');
        Object.defineProperty(result,key,{value:value(path+'/'+escapePointer(key),depth+1),writable:true,enumerable:true,configurable:true});
        white();const end=text[at++];if(end==='}')return result;if(end!==',')fail('Expected a comma or closing brace');
      }
    }
    if(c==='['){
      at++;white();const result=[];if(text[at]===']'){at++;return result;}
      for(;;){result.push(value(path+'/'+result.length,depth+1));white();const end=text[at++];if(end===']')return result;if(end!==',')fail('Expected a comma or closing bracket');}
    }
    for(const [literal,result]of [['true',true],['false',false],['null',null]])
      if(text.startsWith(literal,at)){at+=literal.length;return result;}
    const match=text.slice(at).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if(!match)fail('Expected a JSON value');
    const token=match[0];at+=token.length;numberTokens[path]=token;return token;
  }
  const result=value('',0);white();if(at!==text.length)fail('Unexpected content after JSON value');
  return {value:result,numberTokens};
}
export function stringifyExactJSON(value,numberTokens={}){
  const seen=new Set();
  function emit(item,path,depth){
    if(depth>96)throw Error('JSON nesting exceeds 96 levels.');
    if(Object.hasOwn(numberTokens,path)){
      const token=numberTokens[path];
      if(typeof token!=='string'||!NUMBER.test(token)||String(item)!==token)throw Error('Numeric provenance does not match '+(path||'/')+'.');
      seen.add(path);return token;
    }
    if(item===null||typeof item==='boolean'||typeof item==='string')return JSON.stringify(item);
    if(typeof item==='number')throw Error('A native numeric value needs its original decimal token at '+(path||'/')+'.');
    const pad='  '.repeat(depth),childPad=pad+'  ';
    if(Array.isArray(item))return item.length?'[\n'+item.map((entry,index)=>childPad+emit(entry,path+'/'+index,depth+1)).join(',\n')+'\n'+pad+']':'[]';
    if(!object(item))throw Error('Unsupported JSON value at '+(path||'/')+'.');
    const entries=Object.entries(item);
    return entries.length?'{\n'+entries.map(([key,entry])=>childPad+JSON.stringify(key)+': '+emit(entry,path+'/'+escapePointer(key),depth+1)).join(',\n')+'\n'+pad+'}':'{}';
  }
  const result=emit(value,'',0);
  for(const path of Object.keys(numberTokens))if(!seen.has(path))throw Error('Numeric provenance points outside the edited value: '+path+'.');
  return result;
}
function under(path,parent){return path===parent||path.startsWith(parent+'/');}
function replacePatch(patches,patch){
  const index=patches.findIndex(item=>item.path===patch.path);
  if(index<0)patches.push(patch);else patches[index]=patch;
}
export function xChangeCorrection({path,text,kind,reason,product,base=product,patches}){
  const result=copy(patches),root='/xChange/product';
  if(!under(path,root))return null;
  const relative=path.slice(root.length);
  let parsed;
  if(kind==='text')parsed={value:text,numberTokens:{}};
  else if(kind==='number'){
    if(!NUMBER.test(text))throw Error('Enter the exact JSON number, including its exponent when present.');
    parsed={value:text,numberTokens:{'':text}};
  }else parsed=parseExactJSON(text);
  const metadata=result.find(item=>item.path==='/xChange/numberTokens');
  const tokens=copy(metadata?.value??base.xChange?.numberTokens??{});
  for(const key of Object.keys(tokens))if(under(key,relative))delete tokens[key];
  for(const [key,token]of Object.entries(parsed.numberTokens))tokens[relative+key]=token;
  replacePatch(result,{path,value:parsed.value,reason});
  replacePatch(result,{path:'/xChange/numberTokens',value:tokens,reason});
  return result;
}
export function removeXChangeCorrection({patches,index,base}){
  const result=copy(patches),patch=result[index];if(!patch)return result;
  result.splice(index,1);
  if(!under(patch.path,'/xChange/product'))return result;
  const relative=patch.path.slice('/xChange/product'.length),metadata=result.find(item=>item.path==='/xChange/numberTokens');
  if(!metadata)return result;
  const tokens=copy(metadata.value);
  for(const key of Object.keys(tokens))if(under(key,relative))delete tokens[key];
  for(const [key,token]of Object.entries(base?.xChange?.numberTokens??{}))if(under(key,relative))tokens[key]=token;
  metadata.value=tokens;
  if(!result.some(item=>under(item.path,'/xChange/product')))return result.filter(item=>item.path!=='/xChange/numberTokens');
  return result;
}
export function createXChangeController({container,api,element,attempt,read,changed,notice}){
  const $=id=>container.querySelector('#sup-x-'+id);
  let profile=null,overrides=[],sourceProduct=null,review=null,offset=0,next=null,held=true,supplierEditDirty=false;
  const settings=element('section',undefined,{id:'sup-x-settings',hidden:''});
  settings.innerHTML=[
    '<h4>ETIM xChange delivery</h4><p class="help">Original source headers are inherited. An override changes the complete selected header and records its reason in this submission revision.</p>',
    '<label class="cat-check"><input id="sup-x-inherit" type="checkbox" checked>Use the original catalogue header</label>',
    '<div id="sup-x-header-editor" hidden><label>Complete catalogue header, without Supplier<textarea id="sup-x-header" class="code" rows="14" spellcheck="false"></textarea></label><label>Reason for overriding the catalogue header<input id="sup-x-header-reason" maxlength="2000"></label></div>',
    '<details><summary>Supplier header overrides</summary><p class="help">Each supplier keeps its complete original header unless it has an explicit override here. Open a product below to load its original supplier header.</p>',
    '<label>Retained override<select id="sup-x-supplier-select"><option value="">New supplier header override</option></select></label>',
    '<label>Supplier key<input id="sup-x-supplier-key" spellcheck="false"></label>',
    '<label>Complete supplier header, without Product<textarea id="sup-x-supplier-header" class="code" rows="12" spellcheck="false">{}</textarea></label>',
    '<label>Reason for this supplier header override<input id="sup-x-supplier-reason" maxlength="2000"></label>',
    '<div class="actions"><button id="sup-x-supplier-load" type="button">Use original supplier header</button><button id="sup-x-supplier-keep" type="button">Keep header override</button><button id="sup-x-supplier-remove" type="button">Restore inherited header</button></div><p id="sup-x-supplier-summary" class="help"></p></details>',
    '<section id="sup-x-2ba" hidden><h4>2BA recipient settings</h4><p class="help">Map the xChange status names with the original 2BA version 2.0 code tables. Retain their source URL, revision and SHA-256 with the mapping.</p>',
    '<div class="two-column"><label>Mapping source URL<input id="sup-x-map-url" type="url"></label><label>Mapping revision<input id="sup-x-map-revision"></label></div>',
    '<label>Original mapping SHA-256<input id="sup-x-map-sha" class="code" maxlength="64" spellcheck="false"></label>',
    '<div class="two-column"><label>Product status mapping<textarea id="sup-x-product-status" class="code" rows="8" spellcheck="false">{}</textarea></label><label>Trade item status mapping<textarea id="sup-x-trade-status" class="code" rows="8" spellcheck="false">{}</textarea></label></div>',
    '<label>Released ETIM modelling classes as JSON<textarea id="sup-x-mc" class="code" rows="5" spellcheck="false">[]</textarea></label>',
    '<label>Keep original attachment URLs for these MDX codes<input id="sup-x-keep-url" placeholder="MDX054"><span class="help">Retained as the 2BA KeepMimeURL requirement for the receiving operator.</span></label>',
    '<p class="help"><a href="https://www.2ba.nl/en/documentation/file-exchange/etim-xchange-v2-0/" target="_blank" rel="noreferrer">2BA xChange 2.0 receiving rules</a></p></section>',
    '<details><summary>Original catalogue and supplier context</summary><p id="sup-x-source-note" class="help">Open a product in the selected review to inspect its original context.</p><pre id="sup-x-source"></pre><button id="sup-x-catalogue-load" type="button">Use original catalogue header as an override</button></details>'
  ].join('');
  container.querySelector('#sup-profile-json').closest('details').before(settings);
  const impact=element('article',undefined,{id:'sup-x-impact',hidden:''});
  impact.innerHTML=[
    '<h3>Recipient effects</h3><p id="sup-x-review" class="summary"></p><div id="sup-x-counts" class="cat-counts"></div>',
    '<p id="sup-x-rules" class="help"></p>',
    '<div class="cat-table-controls"><label>Record type<select id="sup-x-kind"><option value="all">All records</option><option value="product">Products</option><option value="tradeItem">Trade items</option></select></label>',
    '<label>Change<select id="sup-x-change"><option value="all">All changes</option><option value="added">Added</option><option value="changed">Changed</option><option value="unchanged">Unchanged</option><option value="expired">Expired</option><option value="deleted">Deleted</option></select></label>',
    '<label>Identifier or supplier<input id="sup-x-search" type="search"></label><button id="sup-x-find" type="button">Show recipient effects</button></div>',
    '<div id="sup-x-rows" class="table-wrap"></div><div class="actions"><button id="sup-x-back" type="button">Previous records</button><span id="sup-x-page" class="help"></span><button id="sup-x-next" type="button">Next records</button></div>',
    '<section id="sup-x-detail" hidden><h4 id="sup-x-detail-title"></h4><div class="two-column"><details open><summary>Previous recipient record</summary><pre id="sup-x-before"></pre></details><details open><summary>Selected recipient record</summary><pre id="sup-x-after"></pre></details></div><details><summary>Complete record identity</summary><pre id="sup-x-row-meta"></pre></details></section>'
  ].join('');
  container.lastElementChild.before(impact);
  function json(id,label){try{return JSON.parse($(id).value);}catch{throw Error(label+' must be complete JSON. Your edits remain in the form.');}}
  function nativeHeader(id,label){
    const parsed=parseExactJSON($(id).value);
    if(!object(parsed.value))throw Error(label+' must be a JSON object.');
    return parsed;
  }
  function renderOverrides(selected=''){
    $('supplier-select').replaceChildren(element('option','New supplier header override',{value:''}));
    for(const item of overrides)$('supplier-select').append(element('option',item.supplierKey,{value:item.supplierKey}));
    $('supplier-select').value=selected;
    $('supplier-summary').textContent=overrides.length+' explicit supplier header override'+(overrides.length===1?'':'s')+'.';
  }
  function showOverride(key){
    const value=overrides.find(item=>item.supplierKey===key);
    $('supplier-key').value=value?.supplierKey??'';$('supplier-reason').value=value?.reason??'';
    $('supplier-header').value=value?stringifyExactJSON(value.value,value.numberTokens??{}):'{}';supplierEditDirty=false;
  }
  function keepOverride(){
    const supplierKey=$('supplier-key').value.trim(),reason=$('supplier-reason').value.trim();
    if(!supplierKey||!reason)throw Error('Give this supplier header its original supplier key and an override reason.');
    const parsed=nativeHeader('supplier-header','Supplier header');
    if(Object.hasOwn(parsed.value,'Product'))throw Error('A supplier header override excludes Product; product corrections belong to the selected products.');
    const value={supplierKey,...parsed,reason},index=overrides.findIndex(item=>item.supplierKey===supplierKey);
    if(index<0)overrides.push(value);else overrides[index]=value;
    renderOverrides(supplierKey);supplierEditDirty=false;changed();
  }
  function setProfile(value){
    profile=isXChangeProfile(value)?copy(value):null;settings.hidden=!profile;
    if(!profile)return;
    $('inherit').checked=profile.header===null||profile.header===undefined;
    $('header-editor').hidden=$('inherit').checked;
    $('header').value=profile.header?stringifyExactJSON(profile.header.value,profile.header.numberTokens??{}):'{}';
    $('header-reason').value=profile.header?.reason??'';
    overrides=copy(profile.supplierHeaders??[]);renderOverrides();showOverride('');
    $('2ba').hidden=profile.target!=='2ba-xchange-2.0';
    const mapping=profile.statusMapping;
    $('map-url').value=mapping?.source?.url??'';$('map-sha').value=mapping?.source?.sha256??'';$('map-revision').value=mapping?.source?.revision??'';
    $('product-status').value=pretty(mapping?.product??{});$('trade-status').value=pretty(mapping?.tradeItem??{});
    $('mc').value=pretty(profile.releasedModellingClasses??[]);$('keep-url').value=(profile.attachmentPolicy?.keepMimeUrlCodes??[]).join(', ');
    buttons(held);
  }
  function getProfile(){
    if(!profile)return null;
    const value=copy(profile);
    if($('inherit').checked)value.header=null;
    else{
      const parsed=nativeHeader('header','Catalogue header'),reason=$('header-reason').value.trim();
      if(Object.hasOwn(parsed.value,'Supplier'))throw Error('A catalogue header override excludes Supplier.');
      if(!reason)throw Error('Give the catalogue header override a reason.');
      value.header={...parsed,reason};
    }
    if(supplierEditDirty)keepOverride();
    value.supplierHeaders=copy(overrides);
    if(value.target==='2ba-xchange-2.0'){
      const product=json('product-status','Product status mapping'),tradeItem=json('trade-status','Trade item status mapping');
      if(!object(product)||!object(tradeItem))throw Error('Each status mapping must be a JSON object.');
      const url=$('map-url').value.trim(),sha256=$('map-sha').value.trim(),revision=$('map-revision').value.trim();
      if(url||sha256||revision||Object.keys(product).length||Object.keys(tradeItem).length){
        if(!/^https?:\/\//i.test(url)||!/^[a-f0-9]{64}$/.test(sha256)||!revision)throw Error('Retain the status mapping source URL, SHA-256 and revision together.');
        if(Object.values(product).some(v=>typeof v!=='string')||Object.values(tradeItem).some(v=>typeof v!=='string'))throw Error('2BA internal status codes are exact strings, including any leading zeros.');
        value.statusMapping={source:{url,sha256,revision},product,tradeItem};
      }else value.statusMapping=null;
      value.releasedModellingClasses=json('mc','Released modelling classes');
      if(!Array.isArray(value.releasedModellingClasses))throw Error('Released modelling classes must be an array.');
      value.attachmentPolicy={...(value.attachmentPolicy??{}),keepMimeUrlCodes:$('keep-url').value.split(',').map(s=>s.trim()).filter(Boolean)};
    }
    return value;
  }
  function setProduct(product){
    sourceProduct=product?.xChange??null;
    $('source').textContent=sourceProduct?pretty({catalogue:sourceProduct.catalogue,supplier:sourceProduct.supplier,source:sourceProduct.source}):'';
    $('source-note').textContent=typeof sourceProduct?.supplier?.key==='string'?'Original supplier '+sourceProduct.supplier.key+' · source context retained with this product.':sourceProduct?'This product has incomplete xChange context. Its complete mapped value and findings remain editable below.':'Open an xChange product in the selected review to inspect its original context.';
    buttons(held);
  }
  function setReview(value){
    review=value?.recipient?value:null;impact.hidden=!review;offset=0;next=null;
    $('rows').replaceChildren();$('detail').hidden=true;$('page').textContent='';$('counts').replaceChildren();
    if(!review){buttons(held);return;}
    const recipient=review.recipient;
    $('review').textContent=recipient.target+' · '+recipient.catalogueType+' · review '+review.id;
    $('rules').textContent=(recipient.catalogueType==='FULL'?
      'FULL compares the complete selected delivery with the prior recipient state. Omitted 2BA products expire; omitted trade items are deleted.':
      'CHANGE applies the supplied product and trade-item records to the explicitly selected previous review. Status mappings determine the 2BA trade-item mutations.')+
      (recipient.previousReviewId?' Previous review '+recipient.previousReviewId+' · '+recipient.previousReviewSha256+'.':' This is the first retained recipient state.');
    const labels={productsAdded:'Products added',productsChanged:'Products changed',productsUnchanged:'Products unchanged',productsExpired:'Products expired',tradeItemsAdded:'Trade items added',tradeItemsChanged:'Trade items changed',tradeItemsUnchanged:'Trade items unchanged',tradeItemsDeleted:'Trade items deleted',productsTotal:'Recipient products',tradeItemsTotal:'Recipient trade items'};
    for(const [key,label]of Object.entries(labels)){
      const count=recipient.counts[key];if(count===undefined)continue;
      const node=element('div');node.append(element('strong',String(count)),element('span',label));$('counts').append(node);
    }
    buttons(held);
  }
  async function loadRows(){
    if(!review)return;
    const selected=review.id;
    const page=await api('/api/catalog/supplier/recipient-rows?'+new URLSearchParams({reviewId:selected,kind:$('kind').value,change:$('change').value,search:$('search').value,offset:String(offset),limit:'50'}));
    if(review?.id!==selected)return;
    next=page.nextOffset??null;
    const table=element('table'),head=element('thead'),line=element('tr'),body=element('tbody');
    for(const label of ['Type','Identifier','Supplier','Effect',''])line.append(element('th',label));
    head.append(line);table.append(head,body);
    for(const row of page.rows){
      const tr=element('tr'),action=element('td'),inspect=element('button','Inspect record',{type:'button'});
      for(const value of [row.kind,row.identifier,row.supplierKey,row.action])tr.append(element('td',String(value??'')));
      inspect.addEventListener('click',()=>{
        $('detail').hidden=false;$('detail-title').textContent=row.kind+' '+row.identifier+' · '+row.action;
        $('before').textContent=pretty(row.before);$('after').textContent=pretty(row.after);
        const {before,after,...identity}=row;$('row-meta').textContent=pretty(identity);
        $('detail').scrollIntoView({block:'nearest'});
      });
      action.append(inspect);tr.append(action);body.append(tr);
    }
    $('rows').replaceChildren(table);
    $('page').textContent=page.total?String(offset+1)+'–'+String(offset+page.rows.length)+' of '+page.total+' records':'No recipient records match this view.';
    buttons(held);
  }
  function buttons(disabled){
    held=disabled;
    for(const node of [...settings.querySelectorAll('input,select,textarea,button'),...impact.querySelectorAll('input,select,textarea,button')])node.disabled=held;
    $('supplier-load').disabled=held||typeof sourceProduct?.supplier?.key!=='string'||!object(sourceProduct?.supplier?.header);
    $('catalogue-load').disabled=held||!object(sourceProduct?.catalogue?.header);
    $('supplier-remove').disabled=held||!$('supplier-select').value;
    $('find').disabled=held||!review;$('back').disabled=held||!review||offset===0;$('next').disabled=held||!review||next===null;
  }
  for(const node of settings.querySelectorAll('input,textarea'))node.addEventListener('input',changed);
  $('inherit').addEventListener('change',()=>{$('header-editor').hidden=$('inherit').checked;changed();});
  for(const id of ['supplier-key','supplier-header','supplier-reason'])$(id).addEventListener('input',()=>{supplierEditDirty=true;});
  $('supplier-select').addEventListener('change',()=>attempt(async()=>{
    const key=$('supplier-select').value;if(supplierEditDirty)keepOverride();showOverride(key);$('supplier-select').value=key;buttons(held);
  }));
  $('supplier-keep').addEventListener('click',()=>attempt(async()=>{keepOverride();notice('The supplier header override is in the submission editor. Save and review the submission to retain it.');}));
  $('supplier-remove').addEventListener('click',()=>{const key=$('supplier-select').value;overrides=overrides.filter(item=>item.supplierKey!==key);renderOverrides();showOverride('');changed();});
  $('supplier-load').addEventListener('click',()=>attempt(async()=>{
    if(typeof sourceProduct?.supplier?.key!=='string'||!object(sourceProduct?.supplier?.header))return;const source=sourceProduct.supplier;
    $('supplier-key').value=source.key;$('supplier-header').value=stringifyExactJSON(source.header,source.numberTokens??{});$('supplier-reason').value='';supplierEditDirty=true;changed();
    notice('The original supplier header is in the editor. Add the reason and keep the override when it is ready.');
  }));
  $('catalogue-load').addEventListener('click',()=>attempt(async()=>{
    if(!object(sourceProduct?.catalogue?.header))return;const source=sourceProduct.catalogue;
    $('inherit').checked=false;$('header-editor').hidden=false;$('header').value=stringifyExactJSON(source.header,source.numberTokens??{});$('header-reason').value='';changed();
  }));
  $('find').addEventListener('click',()=>attempt(()=>read(async()=>{offset=0;await loadRows();})));
  $('back').addEventListener('click',()=>attempt(()=>read(async()=>{offset=Math.max(0,offset-50);await loadRows();})));
  $('next').addEventListener('click',()=>attempt(()=>read(async()=>{offset=next;await loadRows();})));
  $('search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('find').click();}});
  return {setProfile,getProfile,setProduct,setReview,loadRows,buttons};
}
