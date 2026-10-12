/* MIT. Native WordPress catalog commissioning; original REST authority only. */
(() => {
  'use strict';
  const cfg = window.SF104Catalog;
  if (!cfg || !document.getElementById('sf104-catalog')) return;
  const root = document.getElementById('sf104-catalog');
  const main = document.getElementById('sfc-main');
  const key = 'sf104-catalog:' + location.origin + ':' + cfg.user;
  const state = {status:null, data:null, draft:null, dirty:false, busy:false, tab:'edit', listPage:1,
    products:null, productPage:1, search:'', selected:new Set(), pending:null, detail:null};
  const $ = id => document.getElementById(id);
  const copy = value => JSON.parse(JSON.stringify(value));
  const text = value => value === null || value === undefined ? '—' : String(value);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [name,value] of Object.entries(attrs)) {
      if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value);
      else if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = value;
      else if (name in node && !name.startsWith('aria-') && !name.startsWith('data-')) node[name] = value;
      else if (value !== null && value !== undefined && value !== false) node.setAttribute(name, String(value));
    }
    const add = child => {
      if (Array.isArray(child)) child.forEach(add);
      else if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    };
    children.forEach(add); return node;
  };
  const button = (label, action, attrs = {}) => el('button', {type:'button', class:'sfc-button', onclick:() => work(action), ...attrs}, label);
  const badge = (label, tone = '') => el('span', {class:'sfc-badge ' + tone}, label);
  const code = value => el('code', {class:'sfc-code'}, text(value));
  const small = value => el('span', {class:'sfc-muted'}, value);
  const when = value => value ? new Date(value).toLocaleString() : '—';
  const title = (heading, subtitle, actions = []) => el('div', {class:'sfc-section-head'},
    el('div', {}, el('h2', {}, heading), subtitle ? el('p', {class:'sfc-muted'}, subtitle) : null), el('div', {class:'sfc-actions'}, actions));
  function notice(message, error = false) {
    $('sfc-notice').replaceChildren(message ? el('div', {class:'sfc-notice ' + (error ? 'sfc-error' : ''), role:error ? 'alert' : 'status'}, message) : '');
  }
  async function work(fn) {
    if (state.busy) return;
    state.busy = true; root.setAttribute('aria-busy','true'); main.inert = true;
    try { await fn(); } catch (error) { notice(error.message || 'The request could not be completed.', true); }
    finally { state.busy = false; root.removeAttribute('aria-busy'); main.inert = false; }
  }
  async function api(path = '', body) {
    let response, value;
    try {
      response = await fetch(cfg.root + path, {method:body ? 'POST' : 'GET', credentials:'same-origin', redirect:'error',
        headers:{'X-WP-Nonce':cfg.nonce, Accept:'application/json', ...(body ? {'Content-Type':'application/json'} : {})},
        ...(body ? {body:JSON.stringify(body)} : {})});
      value = await response.json();
    } catch (cause) { throw Object.assign(new Error('The response was not received. Keep this original request and check its saved result.'), {unknown:true,cause}); }
    if (!response.ok) throw Object.assign(new Error(value.message || 'The original WordPress request was refused.'),
      {status:response.status, code:value.code, unknown:response.status >= 500});
    return value;
  }
  function download(name, content, type = 'application/json') {
    const blob = content instanceof Blob ? content : new Blob([typeof content === 'string' ? content : JSON.stringify(content,null,2) + '\n'], {type});
    const url = URL.createObjectURL(blob); const a = el('a',{href:url,download:name}); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url),30000);
  }
  async function sha(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2,'0')).join('');
  }
  function base64(bytes) {
    let out = ''; for (let i=0;i<bytes.length;i+=16384) out += String.fromCharCode(...bytes.subarray(i,i+16384));
    return btoa(out);
  }
  function sourceBlob(source) {
    const raw = atob(source.base64), bytes = new Uint8Array(raw.length);
    for (let i=0;i<raw.length;i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes],{type:'application/octet-stream'});
  }
  function savePending(value) {
    state.pending = value;
    try {
      if (!value) localStorage.removeItem(key + ':pending');
      else {
        const retained = copy(value);
        if (retained.request.source && retained.request.source.base64.length > 500000) {
          delete retained.request.source.base64; retained.sourceOmitted = true;
        }
        localStorage.setItem(key + ':pending', JSON.stringify(retained));
      }
    } catch { notice('Browser storage is unavailable. Download the retained request before leaving this page; WordPress keeps every committed result.', true); }
    renderPending();
  }
  async function mutation(request) {
    if (state.pending) throw new Error('Check or continue the retained request before starting another catalog change.');
    const pending = {request:copy({...request,requestId:crypto.randomUUID()}),at:new Date().toISOString()};
    savePending(pending);
    return continuePending();
  }
  async function continuePending() {
    const pending = state.pending; if (!pending) return null;
    if (pending.sourceOmitted || pending.request.source && !pending.request.source.base64)
      throw new Error('Select the exact original source file in the retained request panel before continuing.');
    try {
      const value = await api('', pending.request);
      if (!value.receipt || value.receipt.requestId !== pending.request.requestId)
        throw Object.assign(new Error('The response did not identify the original request. Check its saved result.'), {unknown:true});
      savePending(null);
      const result = value.receipt.result;
      if (result.projectId) await openProject(result.projectId, {discardDraft:true});
      if (pending.request.action === 'review') { state.tab = 'review'; renderProject(); }
      if (pending.request.action === 'apply') { state.tab = 'handoff'; renderProject(); }
      notice((value.reused ? 'Recovered the original result. ' : '') + result.status.replaceAll('_',' ').toLowerCase() + '.');
      return result;
    } catch (error) {
      if (!error.unknown && error.status >= 400 && error.status < 500) {
        savePending(null);
        if (state.data) await openProject(state.data.project.id, {discardDraft:false}).catch(() => {});
      }
      throw error;
    }
  }
  async function checkPending() {
    const p = state.pending; if (!p) return;
    const value = await api('/requests/' + p.request.requestId);
    if (!value.found) { notice('No committed result is present. Keep this exact request; use Continue when the original operation has finished.'); return; }
    if (value.receipt.requestId !== p.request.requestId) throw new Error('The saved request identity differs.');
    savePending(null);
    await openProject(value.receipt.projectId, {discardDraft:true});
    if (p.request.action === 'apply') state.tab = 'handoff';
    else if (p.request.action === 'review') state.tab = 'review';
    renderProject(); notice('Recovered the original committed result. No new catalog change was dispatched.');
  }
  function renderPending() {
    const target = $('sfc-pending'); const p = state.pending;
    if (!p) { target.replaceChildren(); return; }
    const file = el('input',{type:'file',accept:'.json,.csv',onchange:() => work(async () => {
      const selected = file.files[0]; if (!selected) return;
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (selected.name !== p.request.source.name || await sha(bytes) !== p.request.source.sha256)
        throw new Error('Select the same original file name and exact bytes.');
      p.request.source.base64 = base64(bytes); delete p.sourceOmitted; savePending(p);
      notice('The same source bytes are restored. Check the original result before continuing.');
    })});
    target.replaceChildren(el('section',{class:'sfc-panel sfc-pending'},
      title('Retained request', 'Check the saved result after a lost response or restart.'),
      el('p',{},badge(p.request.action), ' ', code(p.request.requestId), ' ', small(when(p.at))),
      el('div',{class:'sfc-actions'},button('Check original result',checkPending,{class:'sfc-button sfc-primary'}),
        button('Continue same request',continuePending,{disabled:!!p.sourceOmitted}),
        button('Download request',() => download('catalog-request-' + p.request.requestId + '.json',p))),
      p.sourceOmitted ? el('label',{class:'sfc-field'},'Restore the exact original source file',file) : null));
  }
  function dirty() {
    state.dirty = true;
    try { localStorage.setItem(key + ':draft:' + state.data.project.id, JSON.stringify({
      editionId:state.data.edition.id,revision:state.data.project.revision,plan:state.draft,at:new Date().toISOString()})); } catch {}
    const marker = $('sfc-draft-state'); if (marker) marker.textContent = 'Unsaved local changes';
  }
  function field(label, value, changed, attrs = {}) {
    const input = el('input',{type:'text',value:text(value) === '—' ? '' : text(value),...attrs,oninput:e => changed(e.target.value)});
    return el('label',{class:'sfc-field'},el('span',{},label),input);
  }
  function choice(label, value, choices, changed) {
    const select = el('select',{onchange:e => changed(e.target.value)}, choices.map(([id,name]) => el('option',{value:id,selected:id===value},name)));
    return el('label',{class:'sfc-field'},el('span',{},label),select);
  }
  function check(label, value, changed) {
    return el('label',{class:'sfc-check'},el('input',{type:'checkbox',checked:value,onchange:e=>changed(e.target.checked)}),el('span',{},label));
  }
  async function openProject(id, {discardDraft = false} = {}) {
    const previous = state.data?.project.id === id ? state.draft : null;
    const previousDirty = !!previous && state.dirty;
    const value = await api('/projects/' + encodeURIComponent(id));
    if (!value.project || value.project.id !== id) throw new Error('The saved catalog identity differs.');
    state.data = value; state.detail = null;
    if (discardDraft) {
      state.draft = copy(value.edition.plan); state.dirty = false;
      try { localStorage.removeItem(key + ':draft:' + id); } catch {}
    } else if (previousDirty) { state.draft = previous; state.dirty = true; }
    else {
      state.draft = copy(value.edition.plan); state.dirty = false;
      try {
        const local = JSON.parse(localStorage.getItem(key + ':draft:' + id) || 'null');
        if (local && local.editionId === value.edition.id && local.revision === value.project.revision) {
          state.draft = local.plan; state.dirty = true;
        } else if (local) notice('A local draft is based on an earlier saved revision. Export it from the History tab before replacing it.',true);
      } catch {}
    }
    history.replaceState(null,'', '#catalog=' + encodeURIComponent(id) + '&tab=' + state.tab);
    renderProject();
  }
  async function loadProjects() {
    const result = await api('/projects?page=' + state.listPage);
    state.data = null; state.draft = null; state.dirty = false; state.selected = new Set();
    history.replaceState(null,'',location.pathname + location.search);
    renderProjects(result);
  }
  function fileInput(label, existing = false) {
    const input = el('input',{type:'file',accept:'.json,.csv',onchange:() => work(async () => {
      const file = input.files[0]; if (!file) return;
      if (file.size < 1 || file.size > 16777216) throw new Error('Choose a complete catalog source or workspace up to 16 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const request = {action:'import',title:file.name.replace(/\.(json|csv)$/i,''),note:'Imported source ' + file.name,
        source:{name:file.name,base64:base64(bytes),sha256:await sha(bytes)}};
      if (existing && state.data) Object.assign(request,{projectId:state.data.project.id,expectedRevision:state.data.project.revision,title:state.data.project.title});
      await mutation(request);
    })});
    return el('label',{class:'sfc-file'},el('span',{},label),input);
  }
  function renderProjects(result) {
    const table = el('table',{class:'sfc-table'},el('thead',{},el('tr',{},['Catalog','Products','State','Updated',''].map(x=>el('th',{},x)))),
      el('tbody',{},result.projects.map(p=>el('tr',{},
        el('td',{},el('strong',{},p.title),el('div',{},small(p.id))),
        el('td',{},p.mappedProducts + ' mapped / ' + p.products + ' selected'),
        el('td',{},badge(p.latestApplication ? 'Applied history' : 'Saved plan')),
        el('td',{},when(p.updatedAt)),el('td',{},button('Open',()=>openProject(p.id)))))));
    const create = el('section',{class:'sfc-panel'},title('Start from existing Woo products','Product names, prices, files and stock remain in their original Woo editor.'),
      el('div',{class:'sfc-grid'},field('Catalog name','',()=>{},{id:'sfc-new-title',placeholder:'Digital editions — autumn catalog'}),
        field('Product IDs','',()=>{},{id:'sfc-new-ids',placeholder:'22, 23'})),
      el('div',{class:'sfc-actions'},button('Create saved plan',()=> {
        const ids = $('sfc-new-ids').value.split(/[,\s]+/).filter(Boolean);
        if (!ids.length || ids.length>64 || new Set(ids).size!==ids.length || ids.some(x=>!/^[1-9]\d{0,17}$/.test(x)))
          throw new Error('Enter 1–64 distinct existing Woo product IDs.');
        return mutation({action:'create',title:$('sfc-new-title').value,productIds:ids});
      },{class:'sfc-button sfc-primary'}),fileInput('Import plan, CSV or complete workspace')),
      el('details',{},el('summary',{},'Find products'),productSearch(false)));
    main.replaceChildren(el('section',{class:'sfc-panel'},
      title('Saved catalogs','Review and reopen the original plans and application history.',[button('Refresh',loadProjects)]),
      result.projects.length ? el('div',{class:'sfc-table-scroll'},table) : el('p',{class:'sfc-empty'},'No saved catalog plans yet. Select products below or import an exact source.'),
      pager(result,()=>{state.listPage--;return loadProjects();},()=>{state.listPage++;return loadProjects();})),create);
  }
  function pager(result, previous, next) {
    return el('div',{class:'sfc-pagination'},small('Page ' + result.page + ' · ' + result.total + ' records'),
      button('Previous',previous,{disabled:result.page<=1}),button('Next',next,{disabled:!result.hasNext}));
  }
  function productSearch(addToDraft) {
    const container = el('div',{class:'sfc-search-box'});
    const search = el('input',{type:'search',placeholder:'Product name or exact ID',value:state.search,'aria-label':'Search Woo products'});
    const results = el('div',{class:'sfc-product-results'});
    const load = async page => {
      state.search = search.value; state.productPage = page;
      const result = await api('/products?page=' + page + '&q=' + encodeURIComponent(state.search));
      const rows = result.products.map(p=>el('tr',{},el('td',{},code(p.productId),el('div',{},p.name)),
        el('td',{},p.type + (p.virtual ? ' · virtual' : ' · physical'),el('div',{},small(p.status))),
        el('td',{},p.price + ' ' + state.status.currency),
        el('td',{},badge(p.mapping ? 'Mapped' : 'Unmapped')),
        el('td',{},button(addToDraft ? 'Add row' : 'Select ID',()=> {
          if (addToDraft) {
            if (state.draft.products.some(r=>r.productId===p.productId)) throw new Error('That product is already selected.');
            if (state.draft.products.length>=64) throw new Error('A plan supports 64 selected products.');
            const terms = p.mapping ? copy(p.mapping) : {routeId:'product-'+p.productId,url:'',method:'GET',network:'stellar:testnet',
              asset:'',payTo:'',amountAtomic:'',maxTimeoutSeconds:60,storefront:{currency:state.status.currency,total:p.price}};
            delete terms.enabled; delete terms.approvedBy; delete terms.approvedAt;
            state.draft.products.push({productId:p.productId,enabled:!!p.mapping,terms}); dirty(); renderProject();
          } else {
            const input=$('sfc-new-ids'),ids=new Set(input.value.split(/[,\s]+/).filter(Boolean)); ids.add(p.productId);input.value=[...ids].join(', ');
          }
        }))));
      results.replaceChildren(el('div',{class:'sfc-table-scroll'},el('table',{class:'sfc-table'},
        el('thead',{},el('tr',{},['Product','Type','Current price','Mapping',''].map(x=>el('th',{},x)))),el('tbody',{},rows))),
        pager(result,()=>load(page-1),()=>load(page+1)));
    };
    container.append(el('div',{class:'sfc-actions'},search,button('Search',()=>load(1))),results);
    search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();work(()=>load(1));}});
    return container;
  }
  function nav() {
    return el('nav',{class:'sfc-nav','aria-label':'Catalog workspace'},[
      ['edit','Plan'],['review','Compare & apply'],['history','History & recovery'],['handoff','Seller handoff']
    ].map(([id,label])=>button(label,()=>{state.tab=id;state.detail=null;renderProject();history.replaceState(null,'','#catalog='+state.data.project.id+'&tab='+id);},
      {'aria-current':state.tab===id?'page':null})));
  }
  function renderProject() {
    if (!state.data) return;
    const p=state.data.project;
    main.replaceChildren(el('div',{class:'sfc-project-head'},button('← Saved catalogs',loadProjects),
      el('div',{},el('h2',{},p.title),el('p',{class:'sfc-muted'},'Revision '+p.revision+' · '+state.data.edition.plan.products.length+' products · '+when(p.updatedAt))),
      button('Refresh current data',()=>openProject(p.id))),nav(),
      state.tab==='edit'?editPanel():state.tab==='review'?reviewPanel():state.tab==='history'?historyPanel():handoffPanel());
  }
  function editPanel() {
    const d=state.draft, s=d.settings;
    const observed=new Map(state.data.current.content.products.map(p=>[p.productId,p]));
    const settings=el('section',{class:'sfc-panel'},title('Checkout settings','These are the original Woo gateway settings. A saved plan becomes active only after review and application.'),
      el('div',{class:'sfc-grid'},
        field('Store origin',d.storeOrigin,v=>{d.storeOrigin=v;dirty();}),
        field('Customer checkout label',s.title,v=>{s.title=v;dirty();})),
      el('label',{class:'sfc-field'},el('span',{},'Customer instructions'),
        el('textarea',{rows:3,value:s.description,oninput:e=>{s.description=e.target.value;dirty();}})),
      el('div',{class:'sfc-grid'},check('Enable Stellar checkout for mapped products',s.enabled,v=>{s.enabled=v;dirty();}),
        check('Enable a combined digital basket',s.basketEnabled,v=>{s.basketEnabled=v;dirty();renderProject();})),
      s.basketEnabled?el('div',{class:'sfc-inset'},el('div',{class:'sfc-grid'},
        field('Basket route ID',s.basketRouteId,v=>{s.basketRouteId=v;dirty();}),
        field('Basket endpoint',s.basketUrl,v=>{s.basketUrl=v;dirty();},{placeholder:'https://seller.example/digital-basket'}),
        choice('Basket HTTP method',s.basketMethod,[['GET','GET'],['HEAD','HEAD']],v=>{s.basketMethod=v;dirty();})),
        el('p',{class:'sfc-muted'},'Choose the approved products in the Basket column. They must share store currency, network, asset and recipient.')):null);
    const rows=d.products.map(row=>{
      const p=observed.get(row.productId);const t=row.terms;
      return el('tr',{},el('td',{},code(row.productId),el('div',{},state.data.links?.products?.[row.productId] ? el('a',{href:state.data.links.products[row.productId],target:'_blank',rel:'noopener'},el('strong',{},p?.name||'Product '+row.productId)) : el('strong',{},p?.name||'Product '+row.productId)),
        el('div',{},small(p?.missing?'Missing in this store':(p?.type||'Unobserved')+(p?.virtual?' · virtual':'')))),
        el('td',{},check('Mapped',row.enabled,v=>{row.enabled=v;dirty();})),
        el('td',{},t?el('div',{},code(t.amountAtomic||'—'),el('div',{},small(t.network))):'—'),
        el('td',{},t?.storefront?.total||'—',' ',t?.storefront?.currency||state.status.currency,
          el('div',{},small('Woo price: '+(p?.price||'—')))),
        el('td',{},code(t?.routeId||'—'),el('div',{class:'sfc-break'},small(t?.url||'Endpoint not set'))),
        el('td',{},check('In basket',s.basketProductIds.includes(row.productId),v=>{
          s.basketProductIds=v?[...new Set([...s.basketProductIds,row.productId])]:s.basketProductIds.filter(id=>id!==row.productId);dirty();
        })),
        el('td',{},el('div',{class:'sfc-actions'},button('Edit terms',()=>{state.detail=row.productId;renderProject();}),
          button('Remove',()=>{d.products=d.products.filter(r=>r!==row);s.basketProductIds=s.basketProductIds.filter(id=>id!==row.productId);dirty();renderProject();}))));
    });
    const table=el('section',{class:'sfc-panel'},title('Selected product terms','Amounts are exact strings in the asset’s atomic units. Store totals are explicit per-unit final prices, including applicable tax.',
      [fileInput('Import rows into this plan',true),button('Download plan',()=>download('catalog-plan-'+state.data.project.id+'.json',d)),
        button('CSV template',()=>download('catalog-products.csv',csv(d),'text/csv'))]),
      el('div',{class:'sfc-table-scroll'},el('table',{class:'sfc-table sfc-products'},
        el('thead',{},el('tr',{},['Product','Mapping','Atomic amount','Store total','Seller route','Basket',''].map(v=>el('th',{},v)))),el('tbody',{},rows))),
      el('details',{},el('summary',{},'Add existing Woo products'),productSearch(true)),
      sharedTerms(),
      state.detail?termsEditor(d.products.find(r=>r.productId===state.detail),observed.get(state.detail)):null);
    const note=el('textarea',{id:'sfc-edition-note',rows:2,placeholder:'Describe the intended terms change.'});
    return el('div',{},settings,table,el('section',{class:'sfc-panel sfc-savebar'},
      el('div',{},el('strong',{id:'sfc-draft-state'},state.dirty?'Unsaved local changes':'Saved edition '+state.data.edition.revision),
        el('p',{class:'sfc-muted'},'Save an immutable edition before comparing it with current Woo data.')),
      el('label',{class:'sfc-field'},el('span',{},'Edition note'),note),
      el('div',{class:'sfc-actions'},button('Save edition',()=>mutation({action:'save',projectId:state.data.project.id,
        expectedRevision:state.data.project.revision,plan:d,note:note.value}),{class:'sfc-button sfc-primary'}),
        button('Review saved edition',()=>{if(state.dirty)throw new Error('Save the current local edits before reviewing them.');return reviewNow();}))));
  }
  function sharedTerms() {
    let network='stellar:testnet',asset='',payTo='',timeout='60';
    return el('details',{class:'sfc-shared'},el('summary',{},'Set shared draft payment identity'),
      el('p',{class:'sfc-muted'},'This fills the current draft rows. Individual atomic amounts, store totals and routes stay explicit.'),
      el('div',{class:'sfc-grid'},choice('Network',network,[['stellar:testnet','Stellar testnet'],['stellar:pubnet','Stellar public network']],v=>network=v),
        field('SEP-41 asset',asset,v=>asset=v),field('Public recipient',payTo,v=>payTo=v),field('Timeout seconds',timeout,v=>timeout=v,{inputMode:'numeric'})),
      button('Fill draft rows',()=> {
        if(!/^\d{1,5}$/.test(timeout))throw new Error('Use a whole timeout in seconds.');
        for(const r of state.draft.products)if(r.terms)Object.assign(r.terms,{network,asset,payTo,maxTimeoutSeconds:Number(timeout)});
        dirty();renderProject();
      }));
  }
  function termsEditor(row, product) {
    if(!row||!row.terms)return null;
    const t=row.terms;
    return el('section',{class:'sfc-editor'},title('Exact terms · '+row.productId,product?.name||'Selected product',
      [button('Close editor',()=>{state.detail=null;renderProject();})]),
      el('div',{class:'sfc-grid'},field('Seller route ID',t.routeId,v=>{t.routeId=v;dirty();}),
        field('Exact HTTPS endpoint',t.url,v=>{t.url=v;dirty();},{placeholder:'https://seller.example/product'}),
        choice('HTTP method',t.method,[['GET','GET'],['HEAD','HEAD']],v=>{t.method=v;dirty();}),
        choice('Network',t.network,[['stellar:testnet','Stellar testnet'],['stellar:pubnet','Stellar public network']],v=>{t.network=v;dirty();}),
        field('SEP-41 asset contract',t.asset,v=>{t.asset=v;dirty();},{spellcheck:false}),
        field('Selected public recipient',t.payTo,v=>{t.payTo=v;dirty();},{spellcheck:false}),
        field('Exact atomic amount',t.amountAtomic,v=>{t.amountAtomic=v;dirty();},{inputMode:'numeric',spellcheck:false}),
        field('Maximum timeout (seconds)',t.maxTimeoutSeconds,v=>{t.maxTimeoutSeconds=/^\d{1,5}$/.test(v)?Number(v):0;dirty();},{inputMode:'numeric'}),
        field('Store currency',t.storefront.currency,v=>{t.storefront.currency=v;dirty();}),
        field('Per-unit final store total',t.storefront.total,v=>{t.storefront.total=v;dirty();},{inputMode:'decimal'})),
      product?el('p',{class:'sfc-muted'},'Current Woo price '+text(product.price)+' '+state.status.currency+' · tax '+text(product.taxStatus)+
        ' / '+(product.taxClass||'standard')+'. The original checkout compares the complete cart total.'):null);
  }
  function csv(plan) {
    const columns=['productId','enabled','routeId','url','method','network','asset','payTo','amountAtomic','maxTimeoutSeconds','currency','total'];
    const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';
    return [columns,...plan.products.map(r=>{const t=r.terms||{};return [r.productId,r.enabled,...['routeId','url','method','network','asset','payTo','amountAtomic','maxTimeoutSeconds'].map(k=>t[k]??''),t.storefront?.currency||'',t.storefront?.total||''];})]
      .map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
  }
  function reviewNow() {
    if(state.dirty)throw new Error('Save the local draft before comparing a saved edition.');
    return mutation({action:'review',projectId:state.data.project.id,expectedRevision:state.data.project.revision,editionId:state.data.edition.id});
  }
  function termsSummary(mapping) {
    if(!mapping)return el('p',{class:'sfc-muted'},'Mapping disabled');
    const m=copy(mapping);delete m.enabled;delete m.approvedBy;delete m.approvedAt;
    return el('dl',{class:'sfc-terms'},
      ['routeId','url','method','network','asset','payTo','amountAtomic','maxTimeoutSeconds'].map(k=>[el('dt',{},k),el('dd',{},code(m[k]))]),
      el('dt',{},'Store total'),el('dd',{},text(m.storefront?.total)+' '+text(m.storefront?.currency)));
  }
  function reviewPanel() {
    const r=state.data.review;
    if(!r)return el('section',{class:'sfc-panel'},title('Compare the saved edition','A current comparison is required before changing native product settings.'),
      button('Create current comparison',reviewNow,{class:'sfc-button sfc-primary',disabled:state.dirty}));
    const stale=r.projectRevision!==state.data.project.revision||r.editionId!==state.data.edition.id||state.dirty;
    const current=new Map(r.current.content.products.map(p=>[p.productId,p]));
    const rows=r.proposed.products.map(p=>el('section',{class:'sfc-compare-product'},
      el('h3',{},p.productId+' · '+(current.get(p.productId)?.name||'Missing product')),
      el('div',{class:'sfc-grid'},el('div',{},el('h4',{},'Current original mapping'),termsSummary(current.get(p.productId)?.mapping)),
        el('div',{},el('h4',{},'Proposed mapping'),termsSummary(p.enabled?p.terms:null)))));
    const confirm=el('input',{type:'checkbox',id:'sfc-apply-confirm'});
    const note=el('textarea',{rows:3,id:'sfc-apply-note',placeholder:'Record why these exact terms should become current.'});
    return el('div',{},el('section',{class:'sfc-panel'},
      title('Current-data comparison','Recorded '+when(r.at)+' · reviewer account '+r.actor,[button('Refresh comparison',reviewNow,{disabled:state.dirty})]),
      el('div',{class:'sfc-stats'},
        metric('Selected products',r.proposed.products.length),metric('Retained unpaid orders',r.retainedOrders.length),
        metric('Review',stale?'Stale':r.blockers.length?'Changes required':'Ready')),
      stale?el('p',{class:'sfc-notice sfc-error'},'The saved catalog revision changed after this comparison. Create a current comparison.'):null,
      r.blockers.length?el('ul',{class:'sfc-notice sfc-error'},r.blockers.map(x=>el('li',{},x))):null,
      r.warnings.length?el('ul',{class:'sfc-notice'},r.warnings.map(x=>el('li',{},x))):null,
      el('details',{},el('summary',{},'Gateway settings before and after'),
        el('div',{class:'sfc-grid'},el('pre',{},JSON.stringify(r.current.content.settings,null,2)),el('pre',{},JSON.stringify(r.proposed.settings,null,2)))),
      rows,
      retainedTable(r.retainedOrders)),
      el('section',{class:'sfc-panel'},title('Apply reviewed catalog','The native product metadata, gateway settings, application history and request result commit in one transaction.'),
        el('label',{class:'sfc-field'},el('span',{},'Application reason'),note),
        el('label',{class:'sfc-check'},confirm,el('span',{},'I reviewed these exact product terms and current settings. Apply this saved edition.')),
        el('p',{class:'sfc-muted'},'After applying, receive the seller handoff into the original merchant configuration. Earlier frozen order versions remain in the handoff.'),
        button('Apply exact reviewed terms',()=> {
          if(!confirm.checked||!note.value.trim())throw new Error('Record a reason and confirm the exact reviewed terms.');
          return mutation({action:'apply',projectId:state.data.project.id,expectedRevision:state.data.project.revision,
            reviewId:r.id,confirm:true,note:note.value});
        },{class:'sfc-button sfc-primary',disabled:stale||!!r.blockers.length})));
  }
  function metric(label,value){return el('div',{class:'sfc-metric'},el('span',{},label),el('strong',{},value));}
  function retainedTable(rows) {
    return el('details',{class:'sfc-retained'},el('summary',{},rows.length+' original unpaid order versions retained'),
      el('p',{class:'sfc-muted'},'The handoff retains their exact payment terms. Current order availability and merchant settlement review remain separate.'),
      rows.length?el('div',{class:'sfc-table-scroll'},el('table',{class:'sfc-table'},el('thead',{},el('tr',{},['Order','State','Availability','Frozen version'].map(x=>el('th',{},x)))),
        el('tbody',{},rows.map(r=>el('tr',{},el('td',{},code(r.orderReference)),el('td',{},r.status),
          el('td',{},r.availableNow?'Current saved order matches':r.availabilityReason),el('td',{},code(r.versionSha256))))))):null);
  }
  function historyPanel() {
    const p=state.data.project;
    const rows=state.data.history.map(r=>el('tr',{},el('td',{},badge(r.kind)),
      el('td',{},when(r.at),el('div',{},small('Account '+text(r.actor)))),
      el('td',{},r.note||'—',el('div',{},small(r.id))),
      el('td',{},button('Open record',async()=>{const v=await api('/records/'+r.id);state.detail=v.record;renderProject();}))));
    const detail=state.detail&&typeof state.detail==='object'?state.detail:null;
    let local=null;try{local=JSON.parse(localStorage.getItem(key+':draft:'+p.id)||'null');}catch{}
    return el('div',{},el('section',{class:'sfc-panel'},title('Saved history & complete recovery',
      'Historical reviews and imported records keep their original attribution. A received workspace requires a fresh current-store comparison.',
      [button('Download complete workspace',async()=>download('catalog-workspace-'+p.id+'.json',await api('/projects/'+p.id+'/export?kind=workspace'))),
        fileInput('Receive a complete workspace'),local?button('Download local draft',()=>download('catalog-local-draft-'+p.id+'.json',local.plan)):null]),
      p.origin?el('div',{class:'sfc-notice'},'Received from '+p.origin.storeOrigin+' · original catalog '+p.origin.projectId,
        el('p',{},p.origin.history)):null,
      el('div',{class:'sfc-table-scroll'},el('table',{class:'sfc-table'},el('thead',{},el('tr',{},['Record','Observed','Reason / identity',''].map(x=>el('th',{},x)))),el('tbody',{},rows))),
      el('h3',{},'Exact imported sources'),state.data.sources.length?el('ul',{class:'sfc-sources'},state.data.sources.map(s=>el('li',{},
        el('div',{},el('strong',{},s.name),el('div',{},small(s.bytes+' bytes · '+s.sourceKind)),code(s.sha256)),
        button('Download original',async()=>{const v=(await api('/records/'+s.id)).record;download(v.name,sourceBlob(v));})))):el('p',{class:'sfc-muted'},'No external source was imported.')),
      detail?el('section',{class:'sfc-panel'},title('Original retained record',detail.id||detail.requestId,[
        button('Download record',()=>download('catalog-record-'+(detail.id||detail.requestId)+'.json',detail)),
        detail.plan?button('Use as new draft',()=>{state.draft=copy(detail.plan);state.detail=null;state.tab='edit';dirty();renderProject();}):null,
        button('Close record',()=>{state.detail=null;renderProject();})]),
        el('pre',{class:'sfc-json'},JSON.stringify(detail.base64 ? {...detail,base64:'Exact source bytes retained; use Download original or Download record.'} : detail,null,2))):null);
  }
  function handoffPanel() {
    const app=state.data.application;
    if(!app)return el('section',{class:'sfc-panel'},title('Seller handoff','Apply a reviewed catalog to retain its exact original seller exports.'),
      el('p',{},'The setup receiver compiles the original merchant configuration without starting a seller, sending a webhook or authorizing a payment.'));
    const h=app.handoff,p=state.data.project;
    const current=app.after.sha256===state.data.current.sha256;
    const commands='node catalog-cli.mjs receive --handoff /private/catalog-handoff.json --existing-config /private/woo-merchant.json --out /private/woo-merchant-next.json\n'+
      'node seller.mjs inspect --config /private/woo-merchant-next.json\n\n'+
      '# For an initial merchant configuration:\n'+
      'node catalog-cli.mjs receive --handoff /private/catalog-handoff.json --outbox /private/sf98-outbox --out /private/woo-merchant.json';
    return el('div',{},el('section',{class:'sfc-panel'},
      title('Original seller handoff','Applied '+when(app.at)+' by account '+app.actor,
        [button('Download seller handoff',async()=>download('catalog-handoff-'+app.id+'.json',
          await api('/projects/'+p.id+'/export?kind=seller&applicationId='+app.id)),{class:'sfc-button sfc-primary'}),
          button('Download complete workspace',async()=>download('catalog-workspace-'+p.id+'.json',await api('/projects/'+p.id+'/export?kind=workspace')))]),
      badge(current?'Current product data matches':'Later product or gateway changes observed',current?'':'sfc-warn'),
      !current?el('p',{class:'sfc-notice'},'This is the exact previously applied handoff. Create a new saved edition and comparison to commission later native changes.'):null,
      el('div',{class:'sfc-stats'},metric('Current product routes',h.routes.length),metric('Retained route versions',h.routeVersions.length),
        metric('Basket versions',h.baskets.length)),
      el('p',{},'Handoff identity ',code(h.sha256)),
      el('h3',{},'Receive into the existing merchant'),
      el('p',{},'Use the original operator installation and preserve the current outbox, secret binding and other configured products. The receiver adds retained versions and replaces current routes only for this handoff’s selected products.'),
      el('pre',{class:'sfc-commands'},commands),
      el('p',{class:'sfc-muted'},'The original managed Applications workflow can use the resulting configuration. Select the existing merchant’s configured facilitator, secret environment and outbox; then complete its normal startup and delivery-worker handoff.'),
      retainedTable(h.retainedOrders)),
      el('section',{class:'sfc-panel'},title('Exact native exports','Each file is the declaration consumed by the original seller compiler.'),
        el('div',{class:'sfc-export-grid'},h.routes.map(r=>el('article',{class:'sfc-export'},
          el('h3',{},'Product '+r.productId),code(r.routeId),el('p',{class:'sfc-break'},r.url),
          el('p',{},r.expect.maxAtomic+' atomic · '+r.expect.network),
          button('Download route',()=>download('stellar-product-'+r.productId+'-route.json',r)))),
          h.baskets.map(c=>el('article',{class:'sfc-export'},el('h3',{},'Basket catalog'),code(c.catalogDigest),el('p',{class:'sfc-break'},c.url),
            el('p',{},c.products.length+' products · '+c.method),
            button('Download catalog',()=>download('stellar-basket-'+c.catalogDigest.slice(0,16)+'.json',c)))))));
  }
  async function start() {
    try { const p=JSON.parse(localStorage.getItem(key+':pending')||'null');if(p?.request?.requestId)state.pending=p; } catch {}
    renderPending(); state.status=await api('/status');
    const params=new URLSearchParams(location.hash.slice(1)),id=params.get('catalog'),tab=params.get('tab');
    if(['edit','review','history','handoff'].includes(tab))state.tab=tab;
    if(id&&/^[0-9a-f-]{36}$/.test(id))await openProject(id);else await loadProjects();
  }
  work(start);
})();
