// MIT. Original native catalog policy, version-bound discovery and complete receiving.
import {nextCatalogQuery, receiveNativeCatalogView} from './catalog-receiving.mjs';
export function createCatalogOperator({$, make, api, act, disabled, notice}) {
  let nextBinding = 0, current = null, retained = null, selection = '', history = [], at = -1;
  const policy = $('catalog-policy-fields'), bindings = $('catalog-merchants');
  const readControls = [...document.querySelectorAll('[data-catalog-read]')];
  const changed = () => $('profile-form').dispatchEvent(new Event('input',{bubbles:true}));

  function policyState() {
    const enabled = $('catalog-enabled').checked;
    policy.hidden = !enabled;
    for (const element of policy.querySelectorAll('input,button')) disabled(element,!enabled);
    disabled($('catalog-add-merchant'),!enabled || bindings.children.length >= 256);
  }
  function recipients() {
    const values = [...new Set($('recipients').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean))];
    const target = $('catalog-recipient-options');target.replaceChildren();
    for (const value of values) {const option=make('option');option.value=value;target.append(option);}
  }
  function addBinding(value = {}) {
    if (bindings.children.length >= 256) throw new Error('A native profile supports at most 256 merchant bindings.');
    const row=make('fieldset',undefined,'catalog-binding'), serial=++nextBinding;
    const heading=make('legend','Merchant binding'), fields=make('div',undefined,'grid');
    for (const [key,label,max] of [['sellerId','Seller identity',128],['signer','Catalog signer identity',256],
      ['origin','Merchant HTTPS origin',2048],['payTo','Allowed payment recipient',56]]) {
      const field=make('label',label), input=make('input');input.id='catalog-binding-'+serial+'-'+key;
      input.dataset.catalogField=key;input.value=value[key]??'';input.maxLength=max;input.spellcheck=false;
      field.htmlFor=input.id;
      if (key==='origin') input.type='url';
      if (key==='payTo') input.setAttribute('list','catalog-recipient-options');
      field.append(input);fields.append(field);
    }
    const remove=make('button','Remove this binding');remove.type='button';
    remove.addEventListener('click',()=>{row.remove();policyState();changed();});
    row.append(heading,fields,remove);bindings.append(row);policyState();
  }
  function fill(catalog) {
    if (catalog != null && (typeof catalog!=='object' || Array.isArray(catalog) ||
      !Array.isArray(catalog.merchants) || catalog.merchants.length>256))
      throw new Error('Import a native catalog object with its complete merchant bindings.');
    $('catalog-enabled').checked=catalog!=null;
    $('catalog-directory').value=catalog?.directory??'';
    bindings.replaceChildren();
    for (const merchant of catalog?.merchants??[]) addBinding(merchant);
    recipients();policyState();
  }
  function configuration() {
    if (!$('catalog-enabled').checked) return null;
    return {directory:$('catalog-directory').value.trim(),merchants:[...bindings.children].map(row=>{
      const value={};
      for (const input of row.querySelectorAll('[data-catalog-field]')) {
        const key=input.dataset.catalogField;
        // A configured signer is an exact catalog identity, including its spaces.
        value[key]=key==='signer'?input.value:input.value.trim();
      }
      return value;
    })};
  }
  function summaryRows(catalog) {
    if (!catalog) return [['Durable catalog','Disabled']];
    return [['Durable catalog journal',catalog.directory],...catalog.merchants.map((row,index)=>[
      'Catalog merchant '+(index+1),
      'Seller: '+row.sellerId+'\nCatalog signer: '+JSON.stringify(row.signer)+'\nOrigin: '+row.origin+'\nRecipient: '+row.payTo
    ])];
  }
  $('catalog-enabled').addEventListener('change',()=>{
    if ($('catalog-enabled').checked && !bindings.children.length) addBinding();
    policyState();changed();
  });
  $('catalog-add-merchant').addEventListener('click',()=>{addBinding();changed();});
  $('recipients').addEventListener('input',recipients);

  function parameters() {
    const params=new URLSearchParams();
    for (const [id,key] of [['catalog-query','query'],['catalog-type','type'],['catalog-scheme','scheme'],
      ['catalog-payto','payTo'],['catalog-asset','asset'],['catalog-extensions','extensions']]) {
      const value=$(id).value.trim();if(value)params.set(key,value);
    }
    params.set('limit',$('catalog-limit').value);
    return params;
  }
  function isReady() {
    return Boolean(current && !current.stopping && current.status.catalog?.enabled &&
      current.status.catalog.state==='READY');
  }
  function matchesCurrent() {
    return Boolean(retained && current?.id===retained.runtimeId &&
      current.status.catalog?.version===retained.catalog.version);
  }
  function refreshControls() {
    const ready=isReady(), unchanged=selection===parameters().toString(), live=matchesCurrent();
    for(const element of readControls)disabled(element,!ready);
    disabled($('catalog-previous'),!ready || !live || !unchanged || at<=0);
    disabled($('catalog-next'),!ready || !live || !unchanged || !retained || !nextCatalogQuery(retained));
    disabled($('catalog-download-page'),!retained);
    disabled($('catalog-download-view'),!ready || !live || !unchanged || !retained);
    const node=$('catalog-observation');
    if (!retained) node.textContent='Start a saved profile with catalog publication enabled, then read its current committed resources.';
    else {
      let text=retained.profile.name+' · '+retained.network+' · revision '+retained.catalog.version+
        ' · observed '+retained.observedAt+' · '+retained.page.resources.length+' resources on this retained page.';
      if(current?.id!==retained.runtimeId)text+=' This read belongs to the earlier runtime; its complete page remains downloadable.';
      else if(!live)text+=' The catalog has changed. Read the current catalog to start a new page selection.';
      else if(!unchanged)text+=' Filters have changed. Read the current catalog to apply them.';
      node.textContent=text;
    }
  }
  function status(runtime) {
    current=runtime;
    const catalog=runtime?.status.catalog, node=$('catalog-status');node.replaceChildren();
    $('catalog-state').textContent=!runtime?'Stopped':!catalog?.enabled?'Disabled':catalog.state;
    if(!catalog?.enabled)node.append(make('p',runtime?
      'This native profile has catalog publication disabled. Review a new profile with its original journal and merchant bindings to enable it.':
      'Catalog resources are read from the original running native backend.'));
    else {
      const table=make('table'), body=make('tbody'), batch=catalog.batch??{};
      const values=[['Committed resources',catalog.resources],['Catalog revision',catalog.version],
        ['Durable operations',catalog.operations],['Pending settlement metadata',catalog.pending],
        ['Queued metadata',batch.queued],['Metadata in the current group',batch.inFlight],
        ['Successful batch commits',batch.commits],['Durable journal head',catalog.head]];
      for(const [label,value]of values){const row=make('tr');row.append(make('th',label),make('td',String(value??'—')));body.append(row);}
      table.append(body);node.append(table);
      if(catalog.lastError)node.append(make('p','Latest catalog outcome: '+catalog.lastError,'hint'));
      if(catalog.state==='UNAVAILABLE')node.append(make('p',
        'Reconcile the original catalog journal, drain this runtime, and reopen its saved profile before resuming catalog operations.','hint'));
    }
    refreshControls();
  }
  async function read(query, expectedVersion = null) {
    if(!isReady())throw new Error('Start a catalog-enabled native profile before reading its catalog.');
    const runtimeId=current.id, params=new URLSearchParams(query);
    params.set('runtimeId',runtimeId);
    if(expectedVersion!==null)params.set('expectedVersion',String(expectedVersion));
    const value=await api('catalog?'+params.toString());
    if(value.runtimeId!==runtimeId || current?.id!==runtimeId)
      throw new Error('The native runtime changed during this catalog read. Read the current catalog again.');
    if(!Array.isArray(value.page?.resources))throw new Error('The native catalog returned an invalid page.');
    return value;
  }
  function renderPage(value) {
    const node=$('catalog-resources');node.replaceChildren();
    if(!value.page.resources.length)node.append(make('p','No committed resources match this selection.'));
    for(const resource of value.page.resources) {
      const card=make('article',undefined,'catalog-resource'), input=resource.extensions?.bazaar?.info?.input??{};
      const operation=input.type==='mcp'?'MCP '+(input.toolName??''):(input.method??'HTTP');
      card.append(make('h3',resource.resource?.serviceName??operation),make('p',resource.resource?.url??'','catalog-url'));
      if(resource.resource?.description)card.append(make('p',resource.resource.description));
      card.append(make('p','Discovery operation: '+operation,'hint'));
      const terms=make('div',undefined,'catalog-terms');
      for(const term of resource.accepts??[])terms.append(make('p',
        term.network+' · '+term.scheme+' · '+(term.amount??term.maxAmountRequired??'')+
        ' atomic units\nAsset: '+term.asset+'\nRecipient: '+term.payTo));
      const detail=make('details');detail.append(make('summary','Complete original discovery resource'),
        make('pre',JSON.stringify(resource,null,2)));card.append(terms,detail);node.append(card);
    }
    retained=value;refreshControls();
  }
  async function firstPage() {
    const query=parameters().toString(), value=await read(query);
    selection=query;history=[query];at=0;renderPage(value);
    $('catalog-export-progress').textContent='';
    notice('Read the committed catalog at revision '+value.catalog.version+'.');
  }
  async function move(delta) {
    const target=at+delta, query=delta>0?nextCatalogQuery(retained):history[target];
    if(query==null)return;
    const value=await read(query,retained.catalog.version);
    if(delta>0){history=history.slice(0,target);history.push(query);}
    at=target;renderPage(value);
    notice('Read the next selected catalog page at revision '+value.catalog.version+'.');
  }
  function download(parts,name) {
    const href=URL.createObjectURL(new Blob(parts,{type:'application/json;charset=utf-8'}));
    const link=make('a');link.href=href;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(href),60000);
  }
  function filename(value,suffix) {
    return 'native-catalog-'+value.network.replace(/[^A-Za-z0-9_-]/g,'-')+'-v'+value.catalog.version+'-'+suffix+'.json';
  }
  async function exportView() {
    if(!retained || !matchesCurrent())throw new Error('Read the current catalog before exporting its complete view.');
    const version=retained.catalog.version, runtimeId=retained.runtimeId;
    const received=await receiveNativeCatalogView({runtimeId,query:selection,expectedVersion:version,
      readPage:({runtimeId:selected,query,expectedVersion})=>{
        if(current?.id!==selected)throw new Error('The export belongs to another native runtime.');
        return read(query,expectedVersion);
      },
      onProgress:({resourceCount,pages})=>{
        $('catalog-export-progress').textContent='Received '+resourceCount+' complete resources across '+pages+
          ' original pages at revision '+version+'.';
      }});
    download(received.parts,filename(received.metadata,'complete-view'));
    notice('Downloaded all '+received.resourceCount+' resources in the selected catalog view at revision '+version+'.');
  }
  $('catalog-query-form').addEventListener('submit',event=>{event.preventDefault();act(firstPage);});
  $('catalog-query-form').addEventListener('input',refreshControls);
  $('catalog-clear').addEventListener('click',()=>act(async()=>{$('catalog-query-form').reset();await firstPage();}));
  $('catalog-previous').addEventListener('click',()=>act(()=>move(-1)));
  $('catalog-next').addEventListener('click',()=>act(()=>move(1)));
  $('catalog-download-page').addEventListener('click',()=>act(async()=>{
    if(!retained)return;
    download([JSON.stringify(retained,null,2)+'\n'],filename(retained,'page'));
    notice('Downloaded the complete retained page with its original runtime, profile, query and journal observation.');
  }));
  $('catalog-download-view').addEventListener('click',()=>act(async()=>{
    try {await exportView();}
    catch(error) {
      $('catalog-export-progress').textContent='Export stopped before publishing a file: '+error.message+
        '. Read the current catalog to select its current revision.';
      throw error;
    }
  }));
  fill(null);status(null);
  return Object.freeze({configuration,fill,summaryRows,status,reset:()=>fill(null)});
}
