// MIT. Route inventory and price authoring joined to the original merchant form.
import {routeKey,atomicPrice,routeSheetSnapshot,normalizeRouteSheet,importRouteSheet,
  routeSheetChanges,validateRouteSheet,changeRoutePrices,rebaseRouteSheet,routeSheetText,
  ROUTE_SHEET_BYTES} from './route-sheet-model.mjs';

const PREFIX='starforge.api-route-sheet:';
const DRAFT_SCHEMA='stellar-forge.api-route-sheet-draft.v1';
const clone=value=>structuredClone(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const stamp=()=>new Date().toISOString();
export function createRouteSheetPanel({container,make,field,selectField,act,notice,
  snapshot,compile,apply,focusRoute}) {
  let source=null,base=null,draft=null,origin=null,recordId=null,locked=false,review=null,page=0,
    stale=false,configurationChanged=false,pendingRebase=null,choices={},storageIssue='';
  const panel=make('details');panel.append(make('summary','Route inventory and pricing worksheet'));
  const introduction=make('p','Select routes and author prices in one inventory. Review the complete change through the merchant compiler, then apply it to the original configuration.','hint');
  const status=make('p',undefined,'small'),tools=make('div',undefined,'inline');
  const query=field('Find a route',''),method=selectField('HTTP method',[['','All methods']],''),
    filter=selectField('Show',[['','All routes'],['included','Included'],['excluded','Excluded'],['unpriced','Included without a price'],['changed','Changed in worksheet']],'');
  query.input.type='search';query.input.placeholder='Path, method or source summary';
  tools.append(query.container,method.container,filter.container);
  const selection=make('div',undefined,'inline'),include=button('Include filtered routes'),exclude=button('Exclude filtered routes');
  selection.append(include,exclude);
  const pricing=make('details'),priceFields=make('div',undefined,'fields');
  const scope=selectField('Apply prices to',[['included-filtered','Included routes matching the filter'],['filtered','All supported routes matching the filter'],['included','Every included route']],'included-filtered');
  const kind=selectField('Price change',[['fixed','Set an atomic-unit price'],['percent','Change existing prices by a percentage']],'fixed');
  const amount=field('Atomic price',''),rounding=selectField('Percentage rounding',[['up','Up to the next atomic unit'],['nearest','Nearest atomic unit'],['down','Down to the previous atomic unit']],'up');
  amount.input.inputMode='decimal';amount.input.placeholder='20000';
  priceFields.append(scope.container,kind.container,amount.container,rounding.container);
  const priceButton=button('Stage price change');
  pricing.append(make('summary','Change several prices'),priceFields,
    make('p','Atomic values stay decimal text. Percentage calculations use whole-number arithmetic; the chosen rounding is explicit.','hint'),priceButton);
  const tableHost=make('div',undefined,'table-wrap'),pager=make('div',undefined,'inline'),back=button('Previous page'),forward=button('Next page'),pageText=make('span',undefined,'small');
  tableHost.tabIndex=0;tableHost.setAttribute('role','region');tableHost.setAttribute('aria-label','API route pricing inventory');
  pager.append(back,pageText,forward);
  const files=make('div',undefined,'inline'),download=button('Download worksheet'),upload=make('label','Import a source-bound worksheet'),file=make('input');
  file.type='file';file.accept='.json,application/json';upload.append(file);
  const reset=button('Reset worksheet to current form');
  files.append(download,upload,reset);
  const changeActions=make('div',undefined,'inline'),rebase=button('Reconcile current form'),validate=button('Review configuration changes'),applyButton=button('Apply reviewed worksheet');
  applyButton.className='primary';changeActions.append(rebase,validate,applyButton);
  const conflicts=make('div'),reviewHost=make('div'),savedHost=make('div');
  panel.append(introduction,status,tools,selection,pricing,tableHost,pager,files,changeActions,conflicts,reviewHost,savedHost);
  container.append(panel);container.hidden=true;

  function button(text) {const value=make('button',text);value.type='button';return value;}
  function disable(element,value) {element.dataset.routeSheetDisabled=value?'1':'0';element.disabled=locked||value;}
  function available(value) {
    locked=value;
    for(const element of container.querySelectorAll('input,select,button'))
      element.disabled=locked||element.dataset.routeSheetDisabled==='1';
  }
  function current() {
    const value=snapshot();if(!value?.sourceSha256)throw new Error('Load an API source first.');
    return {source:value,sheet:routeSheetSnapshot(value)};
  }
  function safe(work) {try{return work();}catch(error){notice(error.message,true);}}
  function savedRows() {
    const rows=[];
    try {
      for(let index=0;index<localStorage.length;index++) {
        const key=localStorage.key(index);if(!key?.startsWith(PREFIX))continue;
        try {
          const value=JSON.parse(localStorage.getItem(key));
          if(value.schema===DRAFT_SCHEMA&&value.workspace===source?.workspace&&typeof value.id==='string'&&key===PREFIX+value.id)
            rows.push(value);
        }catch{}
      }
    }catch(error){storageIssue='Browser storage is unavailable. Download the worksheet to retain it.';}
    return rows.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  function retain(savedPackage=null) {
    if(!draft||!source)return;
    recordId??=crypto.randomUUID();
    const record={schema:DRAFT_SCHEMA,id:recordId,workspace:source.workspace,
      createdFrom:origin.title,base:clone(origin),sheet:clone(draft),updatedAt:stamp(),savedPackage};
    try {
      const text=JSON.stringify(record);
      if(new Blob([routeSheetText(draft)]).size>ROUTE_SHEET_BYTES)throw new Error('Worksheet is too large');
      localStorage.setItem(PREFIX+recordId,text);storageIssue='';
    }catch{storageIssue='This worksheet could not be retained in browser storage. Download it before leaving this page.';}
  }
  function saveFile(sheet) {
    const text=routeSheetText(sheet);
    if(new Blob([text]).size>ROUTE_SHEET_BYTES)throw new Error('The complete worksheet exceeds 4 MiB.');
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=make('a');
    link.href=url;link.download='api-route-prices-'+sheet.sourceSha256.slice(0,12)+'.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function contextMatches(sheet) {
    return sheet?.sourceSha256===base?.sourceSha256&&equal(sheet?.currency,base?.currency);
  }
  function renderSaved() {
    savedHost.replaceChildren();
    const records=savedRows();
    if(!records.length)return;
    const details=make('details');details.append(make('summary','Retained worksheets ('+records.length+')'));
    for(const record of records) {
      const row=make('div',undefined,'route'),heading=make('p',record.sheet?.title||'API worksheet');
      row.append(heading,make('p',(record.sheet?.sourceSha256||'')+' · '+record.updatedAt+
        (record.savedPackage?' · saved package '+record.savedPackage:''),'hint wrap'));
      const actions=make('div',undefined,'inline'),restore=button('Restore worksheet'),get=button('Download'),remove=button('Remove retained worksheet');
      disable(restore,!contextMatches(record.sheet));
      restore.addEventListener('click',()=>safe(()=>{
        const now=current();
        const original=normalizeRouteSheet(record.base),chosen=importRouteSheet(record.sheet,now.sheet,now.source.operations);
        const reconciled=rebaseRouteSheet(original,chosen,now.sheet,now.source.operations);
        recordId=record.id;origin=original;source=now.source;base=original;draft=chosen;review=null;
        pendingRebase={base:original,draft:chosen,current:now.sheet};choices={};
        if(reconciled.conflicts.length){renderConflicts(reconciled.conflicts);stale=true;render();}
        else finishRebase(reconciled.sheet);
        notice('Restored the retained worksheet against the current source and payment asset.');
      }));
      get.addEventListener('click',()=>safe(()=>saveFile(record.sheet)));
      remove.addEventListener('click',()=>safe(()=>{
        localStorage.removeItem(PREFIX+record.id);if(recordId===record.id)recordId=null;renderSaved();available(locked);
        notice('Removed that retained worksheet.');
      }));
      actions.append(restore,get,remove);row.append(actions);
      if(!contextMatches(record.sheet))row.append(make('p','Reopen its original API source and payment asset to restore these prices.','hint'));
      details.append(row);
    }
    savedHost.append(details);
  }
  function filtered() {
    if(!draft)return [];
    const originals=new Map(source.operations.map(row=>[routeKey(row),row])),before=new Map(base.rows.map(row=>[routeKey(row),row]));
    const needle=query.input.value.trim().toLocaleLowerCase();
    return draft.rows.filter(row=>{
      const op=originals.get(routeKey(row)),prior=before.get(routeKey(row));
      return (!method.input.value||row.method===method.input.value)&&
        (!needle||(row.method+' '+row.path+' '+(op?.summary||'')).toLocaleLowerCase().includes(needle))&&
        (filter.input.value!=='included'||row.selected)&&
        (filter.input.value!=='excluded'||!row.selected)&&
        (filter.input.value!=='unpriced'||row.selected&&!row.amountAtomic)&&
        (filter.input.value!=='changed'||!equal(row,prior));
    }).map(row=>({row,operation:originals.get(routeKey(row))}));
  }
  function stage(next) {
    draft=normalizeRouteSheet(next);review=null;pendingRebase=null;conflicts.replaceChildren();
    reviewHost.replaceChildren(make('p','Worksheet changed. Review its current values before applying.','hint'));
    retain();render();
  }
  function render() {
    if(!base||!draft)return;
    const list=filtered(),selected=draft.rows.filter(row=>row.selected).length,changes=routeSheetChanges(base,draft).length;
    page=Math.min(page,Math.max(0,Math.ceil(list.length/50)-1));
    status.textContent=selected+' / 64 merchant routes included · '+list.length+' matching source operations · '+changes+' changed rows'+
      (stale?' · Current form changed; reconcile before review.':'')+
      (configurationChanged?' · Merchant settings changed; review again before applying.':'')+
      (storageIssue?' · '+storageIssue:'');
    const table=make('table'),head=make('thead'),header=make('tr');
    for(const name of ['Include','Operation','Atomic price','Source / settings'])header.append(make('th',name));
    head.append(header);table.append(head);const body=make('tbody');
    for(const {row,operation} of list.slice(page*50,page*50+50)) {
      const tr=make('tr'),choiceCell=make('td'),check=make('input');check.type='checkbox';check.checked=row.selected;
      check.setAttribute('aria-label','Include '+row.method+' '+row.path+' in merchant');disable(check,!operation?.supported);
      check.addEventListener('change',()=>safe(()=>stage({...draft,rows:draft.rows.map(item=>routeKey(item)===routeKey(row)?{...item,selected:check.checked}:item)})));
      choiceCell.append(check);tr.append(choiceCell,make('td',row.method+' '+row.path));
      const priceCell=make('td'),price=make('input');price.value=row.amountAtomic;price.inputMode='numeric';
      price.setAttribute('aria-label','Atomic price for '+row.method+' '+row.path);disable(price,!operation?.supported);
      price.addEventListener('change',()=>safe(()=>{
        const value=atomicPrice(price.value,{blank:true});
        stage({...draft,rows:draft.rows.map(item=>routeKey(item)===routeKey(row)?{...item,amountAtomic:value}:item)});
      }));
      priceCell.append(price);tr.append(priceCell);
      const details=make('td');details.append(make('span',operation?.summary||operation?.error||''));
      if(operation?.supported) {
        const open=button('Open full settings');open.addEventListener('click',()=>focusRoute(routeKey(row)));details.append(open);
      } else details.append(make('p',operation?.error||'Unsupported source operation','hint'));
      tr.append(details);body.append(tr);
    }
    table.append(body);tableHost.replaceChildren(table);
    if(!list.length)tableHost.append(make('p','No source routes match these filters.','empty'));
    pageText.textContent=list.length?'Rows '+(page*50+1)+'–'+Math.min((page+1)*50,list.length)+' of '+list.length:'0 routes';
    disable(back,page===0);disable(forward,(page+1)*50>=list.length);
    include.textContent='Include filtered routes ('+list.filter(item=>item.operation?.supported).length+')';
    exclude.textContent='Exclude filtered routes ('+list.filter(item=>item.operation?.supported).length+')';
    disable(include,!list.some(item=>item.operation?.supported));disable(exclude,!list.some(item=>item.operation?.supported));
    disable(validate,stale||Boolean(pendingRebase));disable(applyButton,!review||stale||configurationChanged);
    disable(rebase,!stale&&!configurationChanged);rounding.container.hidden=kind.input.value!=='percent';
    amount.container.firstChild.textContent=kind.input.value==='percent'?'Percentage change':'Atomic price';
    renderSaved();available(locked);
  }
  function renderConflicts(rows) {
    conflicts.replaceChildren();
    if(!rows.length)return;
    conflicts.append(make('h3','Resolve the prices changed in both places'));
    for(const row of rows) {
      const control=selectField(row.method+' '+row.path+' · '+(row.field==='selected'?'Inclusion':'Atomic price'),
        [['','Choose which value to keep'],['CURRENT','Current form: '+row.current],['SHEET','Worksheet: '+row.sheet]],choices[row.id]||'');
      control.input.addEventListener('change',()=>{choices[row.id]=control.input.value;});
      conflicts.append(control.container);
    }
    const resolve=button('Keep these choices and reconcile');resolve.addEventListener('click',()=>safe(()=>{
      const now=current();
      if(!equal(now.sheet,pendingRebase.current))throw new Error('The form changed again. Reconcile its latest values.');
      const result=rebaseRouteSheet(pendingRebase.base,pendingRebase.draft,now.sheet,now.source.operations,choices);
      if(result.conflicts.length)throw new Error('Choose current form or worksheet for every conflicting value.');
      finishRebase(result.sheet);
    }));conflicts.append(resolve);available(locked);
  }
  function finishRebase(value) {
    const now=current();source=now.source;base=now.sheet;draft=value;stale=false;configurationChanged=false;
    pendingRebase=null;choices={};review=null;conflicts.replaceChildren();reviewHost.replaceChildren();retain();render();
  }
  function reconcile() {
    const now=current(),result=rebaseRouteSheet(base,draft,now.sheet,now.source.operations);
    pendingRebase={base:clone(base),draft:clone(draft),current:now.sheet};choices={};
    if(result.conflicts.length){stale=true;review=null;renderConflicts(result.conflicts);render();}
    else finishRebase(result.sheet);
  }
  function renderReview(value) {
    reviewHost.replaceChildren(make('h3','Configuration change review'));
    const summary=make('p',value.selected+' routes accepted by the original merchant compiler. Review each changed inclusion and atomic price before applying.');
    const wrap=make('div',undefined,'table-wrap'),table=make('table'),header=make('tr');
    for(const name of ['Operation','Current inclusion','Worksheet inclusion','Current atomic price','Worksheet atomic price'])header.append(make('th',name));
    const head=make('thead');head.append(header);table.append(head);const body=make('tbody');
    for(const change of value.changes) {
      const row=make('tr');for(const text of [change.method+' '+change.path,change.before.selected?'Included':'Excluded',
        change.after.selected?'Included':'Excluded',change.before.amountAtomic||'—',change.after.amountAtomic||'—'])row.append(make('td',text));body.append(row);
    }
    table.append(body);wrap.append(table);reviewHost.append(summary,wrap);
    if(!value.changes.length)reviewHost.append(make('p','The worksheet matches the current route selection and prices.','hint'));
    for(const item of value.compiled.preview.routes||[])
      reviewHost.append(make('p',item.method+' '+item.path+' · '+item.amountAtomic+' atomic · '+item.network+' · '+item.upstream,'hint wrap'));
  }
  query.input.addEventListener('input',()=>{page=0;render();});
  for(const input of [method.input,filter.input])input.addEventListener('change',()=>{page=0;render();});
  kind.input.addEventListener('change',()=>{amount.input.value='';amount.input.placeholder=kind.input.value==='percent'?'12.50 or -5':'20000';render();});
  for(const [button,value] of [[include,true],[exclude,false]])button.addEventListener('click',()=>safe(()=>{
    const targets=new Set(filtered().filter(item=>item.operation?.supported).map(item=>routeKey(item.row)));
    stage({...draft,rows:draft.rows.map(row=>targets.has(routeKey(row))?{...row,selected:value}:row)});
  }));
  priceButton.addEventListener('click',()=>safe(()=>{
    const list=scope.input.value==='included'?draft.rows.filter(row=>row.selected).map(row=>({row,operation:{supported:true}})):filtered();
    const keys=list.filter(item=>item.operation?.supported&&(scope.input.value!=='included-filtered'||item.row.selected)).map(item=>routeKey(item.row));
    stage(changeRoutePrices(draft,keys,{kind:kind.input.value,value:amount.input.value,rounding:rounding.input.value}));
    notice('Staged prices for '+keys.length+' routes. Review the configuration before applying.');
  }));
  back.addEventListener('click',()=>{page--;render();});forward.addEventListener('click',()=>{page++;render();});
  download.addEventListener('click',()=>safe(()=>saveFile(draft)));
  file.addEventListener('change',()=>act(async()=>{
    const selected=file.files[0];if(!selected)return;
    if(selected.size>ROUTE_SHEET_BYTES)throw new Error('Choose a complete worksheet of at most 4 MiB.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer()),incoming=JSON.parse(text);
    stage(importRouteSheet(incoming,draft,source.operations));file.value='';notice('Imported the source-bound worksheet. Review its changes before applying.');
  }));
  reset.addEventListener('click',()=>safe(()=>{load();notice('Worksheet reset to the current form. Earlier retained worksheets remain available below.');}));
  rebase.addEventListener('click',()=>safe(reconcile));
  validate.addEventListener('click',()=>act(async()=>{
    const now=current();
    if(!equal(base,now.sheet))throw new Error('The form changed. Reconcile current form before reviewing this worksheet.');
    const value=validateRouteSheet(draft,now.sheet,now.source.operations);
    const compiled=await compile(value.sheet);
    review={...value,compiled,current:clone(now.sheet)};configurationChanged=false;
    renderReview(review);render();notice('Original merchant compiler accepted the worksheet. Review the exact changes, then apply.');
  }));
  applyButton.addEventListener('click',()=>act(async()=>{
    if(!review)throw new Error('Review the worksheet first.');
    if(!equal(current().sheet,review.current))throw new Error('The form changed. Reconcile and review its latest values.');
    const accepted=review;await apply(accepted.sheet,accepted.compiled);
    const now=current();source=now.source;base=now.sheet;draft=clone(now.sheet);review=null;stale=false;configurationChanged=false;
    retain();render();reviewHost.replaceChildren(make('p','Applied to the original merchant configuration. Save a new package to retain and run these terms.','hint'));
    notice('Applied the reviewed routes and exact prices. Save a new package with the existing controls.');
  }));
  function load() {
    const now=snapshot();container.hidden=!now?.sourceSha256;if(container.hidden)return;
    source=now;base=routeSheetSnapshot(now);draft=clone(base);origin=clone(base);recordId=null;
    review=null;stale=false;configurationChanged=false;pendingRebase=null;choices={};page=0;query.input.value='';filter.input.value='';
    method.input.replaceChildren();for(const value of ['',...new Set(base.rows.map(row=>row.method))]){const option=make('option',value||'All methods');option.value=value;method.input.append(option);}
    conflicts.replaceChildren();reviewHost.replaceChildren();render();
  }
  function changed() {
    if(!base||!draft)return;
    configurationChanged=true;review=null;
    try{stale=!equal(base,current().sheet);}catch{stale=true;}
    disable(applyButton,true);disable(validate,stale);disable(rebase,false);
    reviewHost.replaceChildren(make('p','Merchant form changed. Review the current configuration before applying the worksheet.','hint'));
    status.textContent=stale?'Current form changed. Reconcile its route selection and prices with the worksheet.':'Merchant settings changed. Review again before applying the worksheet.';
  }
  function saved(name) {
    if(!recordId||!draft)return;
    try{if(equal(current().sheet,draft)){retain(name);renderSaved();available(locked);}}catch{}
  }
  return {load,changed,available,saved};
}
