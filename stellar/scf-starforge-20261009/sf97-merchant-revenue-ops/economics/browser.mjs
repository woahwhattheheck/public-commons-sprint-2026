// MIT. Industrial local cost operations; all accounting and allocation math stays on the server.
const $=id=>document.getElementById(id);
const tabs=[['source','Saved pricing source'],['originals','Original files'],['mapping','Map charge columns'],
  ['charges','Charges and allocations'],['coverage','Cost scope and coverage'],['review','Review and save'],
  ['history','Saved editions'],['pricing','Apply costs to pricing'],['exports','Exports and recovery']];
let state,tab='source',busy=false,draft=null,draftDirty=false,pricing=null,selectedEdition=null,review=null,proposal=null;
let allSources=[],allPricing=[],allEditions=[],exportsList=[],selectedSource=null,inspection=null,selectedLine=null,chargeFilter='';
let pendingUpload=null,pendingSave=null,pendingApply=null,pendingExport=null,editRevision=null,comparison=null;
let mappingDraft={},mappingDelimiter=',',mappingSource=null,weightValues=new Map();
const show=v=>v===null||v===undefined?'Unknown':String(v);
function el(tag,attrs={},...children){
  const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k==='class')n.className=v;
    else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k in n)n[k]=v;else n.setAttribute(k,String(v));}
  for(const x of children.flat())if(x!==null&&x!==undefined)n.append(x instanceof Node?x:document.createTextNode(String(x)));return n;
}
function note(text){return el('p',{class:'note'},text);}
function muted(text){return el('p',{class:'muted'},text);}
function button(label,action,{primary=false,disabled=false}={}){return el('button',{type:'button',class:primary?'primary':'',disabled,
  onclick:()=>run(action)},label);}
function link(label,path){return el('a',{href:path,class:'file-link'},label);}
function section(title,...nodes){return el('section',{class:'panel'},el('h3',{},title),...nodes);}
function field(label,value,change,{type='text',max=2000,placeholder='',readonly=false}={}){
  const n=el(type==='textarea'?'textarea':'input',{...(type==='textarea'?{}:{type}),value:value??'',maxLength:max,placeholder,readOnly:readonly,
    oninput:e=>change?.(e.target.value)});
  return el('label',{},label,n);
}
function select(label,value,options,change){
  const n=el('select',{onchange:e=>change?.(e.target.value)});
  for(const [key,title]of options)n.append(el('option',{value:key,selected:key===value},title));return el('label',{},label,n);
}
function check(label,value,change){return el('label',{class:'check'},el('input',{type:'checkbox',checked:value,onchange:e=>change(e.target.checked)}),label);}
function inspect(title,value){const d=el('details',{},el('summary',{},title));let shown=false;
  d.addEventListener('toggle',()=>{if(d.open&&!shown){shown=true;d.append(el('pre',{},JSON.stringify(value,null,2)));}});return d;}
function facts(values){return el('div',{class:'facts'},values.map(([label,value])=>el('div',{class:'fact'},el('small',{},label),el('strong',{},show(value)))));}
function table(rows,columns,{size=50,empty='No retained rows.'}={}){
  if(!rows.length)return muted(empty);
  let page=0;const body=el('tbody'),caption=el('span');
  const previous=el('button',{type:'button',onclick:()=>{page--;draw();}},'Previous');
  const next=el('button',{type:'button',onclick:()=>{page++;draw();}},'Next');
  function draw(){body.replaceChildren(...rows.slice(page*size,(page+1)*size).map(row=>el('tr',{},columns.map(([,value])=>
    el('td',{},typeof value==='function'?value(row):show(row[value]))))));
    caption.textContent=(page*size+1)+'–'+Math.min(rows.length,(page+1)*size)+' of '+rows.length;
    previous.disabled=page===0;next.disabled=(page+1)*size>=rows.length;}
  draw();return el('div',{},el('div',{class:'table-scroll'},el('table',{},el('thead',{},el('tr',{},columns.map(([name])=>el('th',{scope:'col'},name)))),body)),
    el('div',{class:'paging'},previous,caption,next));
}
function status(message,error=false){$('message').textContent=message;$('message').dataset.error=String(error);}
function changed(){draftDirty=true;review=null;proposal=null;updateDraftStatus();}
function updateDraftStatus(){$('draft-status').textContent=draft?
  (draftDirty?'Unsaved cost edition':'Loaded cost edition')+' · '+(draft.label||'Unnamed')+
  (pendingSave?' · prior save can be recovered with the same request':''):'Choose a saved pricing source to begin.';}
async function api(path,input){
  const response=await fetch(path,{method:input===undefined?'GET':'POST',
    headers:input===undefined?{}:{'content-type':'application/json','x-sf97-workspace':state.token},
    ...(input===undefined?{}:{body:JSON.stringify(input)})});
  let value;try{value=await response.json();}catch{throw new Error('The response was interrupted. Retry the same saved action to recover its outcome.');}
  if(!response.ok)throw Object.assign(new Error(value.message??'Workspace operation failed.'),{code:value.code,status:response.status});return value;
}
async function cost(name,input){return api('/api/economics/'+name,input);}
async function run(action){
  if(busy)return;busy=true;document.querySelectorAll('button').forEach(n=>{n.dataset.wasDisabled=String(n.disabled);n.disabled=true;});
  try{await action();}catch(error){status(error.message,true);}finally{busy=false;document.querySelectorAll('button').forEach(n=>{
    if(n.dataset.wasDisabled!==undefined){n.disabled=n.dataset.wasDisabled==='true';delete n.dataset.wasDisabled;}});}
}
function goto(value){tab=value;render();}
function requireDraft(){if(!draft||!pricing)throw new Error('Choose and load an original saved pricing review first.');}
function sourceOptions(kinds=null){return [['','Choose original source'],...allSources.filter(x=>!kinds||kinds.includes(x.metadata.kind)).map(x=>[x.sourceId,x.metadata.label+' · '+x.metadata.kind])];}
async function refresh({preserveDraft=true}={}){
  state=await api('/api/economics/state');allSources=state.sources;allPricing=state.pricingReviews;allEditions=state.editions;exportsList=state.exports??exportsList;
  if(!draft||!preserveDraft)editRevision=state.revision;
  render();
}
async function loadMore(kind){
  const list=kind==='SOURCES'?allSources:kind==='PRICING'?allPricing:kind==='EXPORTS'?exportsList:allEditions;
  const value=await cost('list',{kind,after:String(list.length),limit:100});list.push(...value.items);render();
}
async function choosePricing(version){
  if(!version)throw new Error('Select an original saved pricing review.');
  pricing=await cost('pricing',{version});
  const report=pricing.report,range=report.usageHistory?.range;
  draft={label:'',pricingVersion:version,period:{from:range?.from??report.observedFrom.slice(0,10),through:range?.to??report.observedUntil.slice(0,10)},
    reason:'',periodAlignment:{confirmed:false,reason:''},contextSourceIds:[],imports:[],lines:[],
    coverage:report.routes.map(x=>({routeId:x.routeId,state:'UNKNOWN',note:'',zeroCostConfirmed:false}))};
  editRevision=state.revision;selectedEdition=null;review=null;proposal=null;selectedLine=null;draftDirty=true;pendingSave=null;pendingApply=null;
  render();status('Original pricing source loaded. Add source documents and review its cost scope.');
}
async function loadEdition(edition){
  selectedEdition=await cost('edition',{edition});pricing=await cost('pricing',{version:selectedEdition.pricingVersion});
  draft=structuredClone(selectedEdition.input);draftDirty=false;editRevision=state.revision;review={report:selectedEdition.report,context:selectedEdition.context};
  selectedLine=draft.lines[0]?.id??null;proposal=null;pendingSave=null;pendingApply=null;
  render();status('Saved edition loaded with its original source references and allocation history.');
}
function render(){
  $('page-title').textContent=tabs.find(([id])=>id===tab)?.[1]??'Supplier costs';
  $('navigation').replaceChildren(...tabs.map(([id,title])=>el('button',{type:'button','aria-current':id===tab?'page':'false',
    onclick:()=>{if(!busy)goto(id);}},title)));
  updateDraftStatus();$('content').replaceChildren();
  if(!state)return;
  ({source:renderSource,originals:renderOriginals,mapping:renderMapping,charges:renderCharges,coverage:renderCoverage,
    review:renderReview,history:renderHistory,pricing:renderPricing,exports:renderExports}[tab])();
}
function renderSource(){
  let selected=draft?.pricingVersion??allPricing[0]?.version??'';
  $('content').append(section('Saved pricing source',
    muted('Use the seller configuration, complete payment choices and operational observations retained in an original pricing review.'),
    select('Saved review',selected,[['','Choose a saved review'],...allPricing.map(x=>[x.version,x.label+' · '+x.savedAt])],v=>selected=v),
    el('div',{class:'actions'},button(draft?'Start a new cost edition from this source':'Load saved source',()=>choosePricing(selected),{primary:true}),
      allPricing.length<state.pricingReviewCount?button('Load more pricing reviews',()=>loadMore('PRICING')):null,
      link('Open merchant pricing','/'))));
  if(!pricing)return;
  const r=pricing.report;
  $('content').append(section(pricing.label,facts([['Routes',r.routes.length],['Source mode',r.originalSellerMode],['Saved source',r.observationKind??'SESSION']]),
    muted(r.observedFrom+' through '+r.observedUntil),
    pricing.sellerChanged?note('The current seller configuration differs from this saved review. A new pricing save must use its matching original configuration.'):null,
    table(r.routes,[['Route',x=>x.routeId+' · '+x.method+' '+x.path],['HTTP 2xx','actual2xx'],['Existing cost per fulfillment · USD','variablePerFulfilledUsd'],
      ['Merchant quote · USD','quoteUsd'],['Monthly target','paidTargetMonth']]),
    inspect('Original pricing report and source identities',r)));
}
function renderOriginals(){
  const meta={label:'',kind:'BILL',supplier:'',reference:'',period:draft?{...draft.period}:null,note:'',url:null};let file=null,hasPeriod=Boolean(meta.period);
  const fileInput=el('input',{type:'file',onchange:e=>{file=e.target.files[0]??null;if(file&&!meta.label)meta.label=file.name;}});
  const form=el('div',{class:'grid'},
    el('label',{},'Original file · up to 16 MiB',fileInput),
    field('Source label','',v=>meta.label=v,{max:160,placeholder:'Supplier invoice, credit note or published tariff'}),
    select('Source kind',meta.kind,state.sourceKinds.map(x=>[x,x.replaceAll('_',' ')]),v=>meta.kind=v),
    field('Supplier or account','',v=>meta.supplier=v,{max:160}),field('Document / tariff reference','',v=>meta.reference=v,{max:300}),
    field('Reference URL · optional','',v=>meta.url=v||null,{max:2000}),
    field('From day',meta.period?.from??'',v=>{meta.period??={from:'',through:''};meta.period.from=v;},{type:'date'}),
    field('Through day',meta.period?.through??'',v=>{meta.period??={from:'',through:''};meta.period.through=v;},{type:'date'}),
    field('Source note','',v=>meta.note=v,{type:'textarea'}));
  $('content').append(section('Retain an original source',form,
    note('Bills, credit notes and quotes keep distinct kinds. Operational usage and original accounting reports provide context; their counters do not establish provider charges.'),
    el('div',{class:'actions'},button(pendingUpload?'Recover pending upload':'Upload original',async()=>{
      if(!pendingUpload){if(!file)throw new Error('Choose an original file.');if(file.size>state.limits.sourceBytes)throw new Error('Choose a file of at most 16 MiB.');
        pendingUpload={requestId:crypto.randomUUID(),file,metadata:{...meta,label:meta.label||file.name,name:file.name,
          period:meta.period?.from&&meta.period?.through?meta.period:null}};}
      const pending=pendingUpload,response=await fetch('/api/economics/uploads/'+pending.requestId,{method:'POST',
        headers:{'x-sf97-workspace':state.token,'x-sf97-source':encodeURIComponent(JSON.stringify(pending.metadata)),
          'content-type':'application/octet-stream'},body:pending.file});
      let result;try{result=await response.json();}catch{throw new Error('Upload response interrupted. Recover the same upload before choosing another file.');}
      if(!response.ok){if(response.status<500)pendingUpload=null;throw new Error(result.message);}
      pendingUpload=null;selectedSource=result.sourceId;inspection=null;await refresh();status('Original source retained · '+result.sha256);
    },{primary:true}))));
  if(state.configuredCaptures.length)$('content').append(section('Configured original captures',muted('Capture the host-selected file without entering or changing a server path.'),
    el('div',{class:'actions'},state.configuredCaptures.map(kind=>button('Capture '+kind.toLowerCase(),async()=>{
      const result=await cost('capture',{requestId:crypto.randomUUID(),kind,period:draft?.period??null});
      selectedSource=result.sourceId;await refresh();status('Configured original captured. Inspect its source semantics before allocation.');
    })))));
  $('content').append(section('Original cost and usage files',
    table(allSources,[['Source',x=>x.metadata.label],['Kind',x=>x.metadata.kind],['Supplier',x=>x.metadata.supplier],
      ['Period',x=>x.metadata.period?x.metadata.period.from+' → '+x.metadata.period.through:'Not specified'],['Bytes','bytes'],
      ['Action',x=>el('div',{},button('Inspect',async()=>{selectedSource=x.sourceId;inspection=await cost('source-inspect',{sourceId:x.sourceId});render();}),
        link('Original','/cost-files/source/'+x.sourceId))]]),
    allSources.length<state.sourceCount?button('Load more originals',()=>loadMore('SOURCES')):null));
  if(inspection){
    const x=inspection.source;
    $('content').append(section('Source inspection · '+x.metadata.label,muted(x.sha256),
      inspection.semantics?note(inspection.semantics):null,
      inspection.format==='DELIMITED'?table(inspection.items,[['Original row','row'],['Exact cells',r=>el('code',{},JSON.stringify(r.cells))]]):null,
      el('div',{class:'actions'},['BILL','CREDIT_NOTE','QUOTE'].includes(x.metadata.kind)?button('Map this source',()=>{
        requireDraft();mappingSource=x.sourceId;mappingDraft={};goto('mapping');
      }):null,draft?button(draft.contextSourceIds.includes(x.sourceId)?'Remove from edition context':'Attach as edition context',()=>{
        const i=draft.contextSourceIds.indexOf(x.sourceId);if(i>=0)draft.contextSourceIds.splice(i,1);else draft.contextSourceIds.push(x.sourceId);
        changed();render();
      }):null),inspect('Complete retained source metadata and native summary',inspection)));
  }
}

function renderMapping(){
  if(!draft)return $('content').append(section('Choose a saved pricing source',button('Open saved source',()=>goto('source'))));
  let chosen=mappingSource??selectedSource??'',delimiter=mappingDelimiter;
  $('content').append(section('Map charge columns',
    select('Original charge source',chosen,sourceOptions(['BILL','CREDIT_NOTE','QUOTE']),v=>chosen=v),
    select('Delimiter',delimiter,[[',','Comma'],['\t','Tab'],[';','Semicolon'],['|','Pipe']],v=>delimiter=v),
    button('Read original columns',async()=>{
      if(!chosen)throw new Error('Choose a retained charge CSV.');
      inspection=await cost('source-inspect',{sourceId:chosen,delimiter});if(inspection.format!=='DELIMITED')
        throw new Error('Choose an original file named .csv or .tsv for column mapping. Other originals support explicit manual charge lines.');
      mappingSource=chosen;mappingDelimiter=delimiter;mappingDraft={};render();
    })));
  if(!inspection||inspection.source.sourceId!==mappingSource||inspection.format!=='DELIMITED')return;
  const meta=inspection.source.metadata;
  const defaults={supplier:meta.supplier,kind:meta.kind,currency:'',reference:null,amount:null,quantity:null,unit:'',description:''};
  const editor=el('div');
  for(const name of state.chargeFields){
    const existing=mappingDraft[name]??null;let mode=existing?.column??(existing?.constant!==undefined?'@constant':'');
    const column=el('select',{onchange:e=>{mode=e.target.value;mappingDraft[name]=mode==='@constant'?{constant:defaults[name]??'',trim:false}:
      mode?{column:mode,trim:false}:null;render();}});
    column.append(el('option',{value:'',selected:mode===''},'Not mapped'));
    column.append(el('option',{value:'@constant',selected:mode==='@constant'},'Explicit constant'));
    for(const header of inspection.headers)column.append(el('option',{value:header,selected:mode===header},header));
    editor.append(el('div',{class:'mapping-row'},el('strong',{},name),el('label',{},'Original column / constant',column),
      mode==='@constant'?field('Constant',existing?.constant??defaults[name]??'',v=>mappingDraft[name]={...mappingDraft[name],constant:v},{max:2000}):muted('Exact original text'),
      check('Trim',existing?.trim===true,v=>{if(mappingDraft[name])mappingDraft[name].trim=v;})));
  }
  $('content').append(section('Explicit field mapping',muted(inspection.rowCount+' original rows · '+inspection.headers.length+' columns'),
    note('Unmapped supplier and kind use the source metadata. Amount and currency require explicit fields. Trimming is optional and recorded. Every data row is retained.'),
    editor,el('div',{class:'actions'},button('Match exact field names',()=>{
      for(const name of state.chargeFields)mappingDraft[name]=inspection.headers.includes(name)?{column:name,trim:false}:
        defaults[name]!==null&&defaults[name]!==''?{constant:defaults[name],trim:false}:null;render();
    }),button('Import all charge rows into draft',async()=>{
      const result=await cost('map-charges',{sourceId:mappingSource,delimiter:mappingDelimiter,mapping:mappingDraft});
      if(draft.imports.some(x=>x.sourceId===result.sourceId))throw new Error('This original already has a mapping in the draft. Edit its retained lines or start another edition.');
      const ids=new Set(draft.lines.map(x=>x.id));if(result.lines.some(x=>ids.has(x.id)))throw new Error('An imported source row is already in this draft.');
      draft.lines.push(...result.lines);draft.imports.push({sourceId:result.sourceId,sourceSha256:result.sourceSha256,
        delimiter:result.delimiter,mapping:result.mapping,rowCount:result.rowCount,excludedRows:[]});
      selectedLine=result.lines[0]?.id??null;changed();goto('charges');status(result.rowCount+' complete original rows imported. Allocate and review them before saving.');
    },{primary:true})),inspect('First original rows',inspection.items)));
}
function selectCharge(lineId){selectedLine=lineId;weightValues=new Map();render();}
function setAllocation(line,routeId,key,value){
  let entry=line.allocations.find(x=>x.routeId===routeId);
  if(!entry){entry={routeId,amount:'',quantity:null,basis:'EXPLICIT_AMOUNT',weight:null,reason:''};line.allocations.push(entry);}
  entry[key]=key==='quantity'&&value===''?null:value;entry.basis='EXPLICIT_AMOUNT';entry.weight=null;
  if(entry.amount===''&&entry.quantity===null&&!entry.reason)line.allocations.splice(line.allocations.indexOf(entry),1);
  changed();
}
function renderCharges(){
  if(!draft)return $('content').append(section('Choose a saved pricing source',button('Open saved source',()=>goto('source'))));
  let manualSource=sourceOptions(['BILL','CREDIT_NOTE','QUOTE'])[1]?.[0]??'';
  $('content').append(section('Charge lines',el('div',{class:'grid'},field('Find a charge',chargeFilter,v=>{chargeFilter=v;drawList();}),
    select('Original for a new manual line',manualSource,sourceOptions(['BILL','CREDIT_NOTE','QUOTE']),v=>manualSource=v)),
    el('div',{class:'actions'},button('Add manual charge line',()=>{
      const source=allSources.find(x=>x.sourceId===manualSource);if(!source)throw new Error('Choose an original bill, credit note or quote.');
      const line={id:crypto.randomUUID(),sourceId:source.sourceId,sourceRow:null,reference:'',supplier:source.metadata.supplier,
        kind:source.metadata.kind,currency:'USD',amount:'',quantity:null,unit:'',description:'',allocations:[]};
      draft.lines.push(line);selectedLine=line.id;changed();render();
    }),button('Import a complete CSV',()=>goto('mapping'))),el('div',{id:'charge-list'})));
  function drawList(){
    const q=chargeFilter.toLowerCase(),rows=draft.lines.filter(x=>[x.id,x.supplier,x.reference,x.description].some(v=>String(v).toLowerCase().includes(q)));
    $('charge-list').replaceChildren(table(rows,[['Reference',r=>r.reference||r.id],['Supplier','supplier'],['Kind','kind'],
      ['Amount',r=>r.currency+' '+r.amount],['Allocations',r=>r.allocations.length],['Action',r=>button('Edit',()=>selectCharge(r.id))]]));
  }drawList();
  const line=draft.lines.find(x=>x.id===selectedLine);if(!line)return;
  const source=allSources.find(x=>x.sourceId===line.sourceId);
  const editor=section('Selected charge · '+(line.reference||line.id),muted(source?.metadata.label??line.sourceId),
    el('div',{class:'grid'},field('Stable line ID',line.id,null,{readonly:true}),
      field('Original row',line.sourceRow??'Manual entry',null,{readonly:true}),
      field('Original line reference',line.reference,v=>{line.reference=v;changed();},{max:300}),
      field('Supplier',line.supplier,v=>{line.supplier=v;changed();},{max:160}),
      select('Charge kind',line.kind,[['BILL','Bill'],['CREDIT_NOTE','Credit note'],['QUOTE','Quote']],v=>{line.kind=v;changed();}),
      field('Currency',line.currency,v=>{line.currency=v;changed();},{max:3}),
      field('Signed original amount',line.amount,v=>{line.amount=v;changed();}),
      field('Original quantity · optional',line.quantity,v=>{line.quantity=v===''?null:v;changed();}),
      field('Quantity unit',line.unit,v=>{line.unit=v;changed();},{max:80}),
      field('Description',line.description,v=>{line.description=v;changed();},{type:'textarea'})),
    note('Use a nonpositive amount for credits. Each allocation keeps that sign. Money and quantity units remain exact text until the server validates them.'),
    link('Download this original','/cost-files/source/'+line.sourceId));
  $('content').append(editor);
  const allocationRows=pricing.report.routes.map(route=>{
    const entry=line.allocations.find(x=>x.routeId===route.routeId);return {route,entry};});
  let fullRoute=allocationRows[0]?.route.routeId??'',weightReason='';
  $('content').append(section('Route allocations',table(allocationRows,[
    ['Route',x=>x.route.routeId],['Amount',x=>field('Signed amount',x.entry?.amount??'',v=>setAllocation(line,x.route.routeId,'amount',v))],
    ['Quantity',x=>field('Original units',x.entry?.quantity??'',v=>setAllocation(line,x.route.routeId,'quantity',v))],
    ['Reason',x=>field('Allocation note',x.entry?.reason??'',v=>setAllocation(line,x.route.routeId,'reason',v),{max:1000})]]),
    el('div',{class:'grid'},select('Full-line destination',fullRoute,pricing.report.routes.map(x=>[x.routeId,x.routeId]),v=>fullRoute=v)),
    button('Replace allocations with full line to this route',()=>{
      line.allocations=[{routeId:fullRoute,amount:line.amount,quantity:line.quantity,basis:'EXPLICIT_AMOUNT',weight:null,
        reason:'Operator assigned this entire original charge to the selected route.'}];changed();render();
    }),muted('Calculate the cost review to see exact allocated and remaining amounts.')));
  const weightPanel=el('details',{},el('summary',{},'Allocate by explicit weights'));let weightsShown=false;
  weightPanel.addEventListener('toggle',()=>{if(!weightPanel.open||weightsShown)return;weightsShown=true;
    weightPanel.append(note('This distributes one charge exactly. Original HTTP 2xx weights are an allocation convention, not supplier-billed request counts.'),
      field('Weight allocation reason','',v=>weightReason=v,{max:1000}),
      table(pricing.report.routes,[['Route','routeId'],['Original HTTP 2xx','actual2xx'],['Explicit weight',r=>
        field('Weight',weightValues.get(r.routeId)??'',v=>weightValues.set(r.routeId,v))]]),
      el('div',{class:'actions'},button('Use entered weights',async()=>{
        const weights=[...weightValues].filter(([,weight])=>weight!=='').map(([routeId,weight])=>({routeId,weight}));
        const result=await cost('weights',{pricingVersion:draft.pricingVersion,line,weights,basis:'OPERATOR_WEIGHT',reason:weightReason});
        line.allocations=result.allocations;changed();render();
      }),button('Use original HTTP 2xx weights across these routes',async()=>{
        const result=await cost('weights',{pricingVersion:draft.pricingVersion,line,routeIds:pricing.report.routes.map(x=>x.routeId),
          basis:'HTTP_2XX_WEIGHT',reason:weightReason});line.allocations=result.allocations;changed();render();
      })));});
  $('content').append(weightPanel);
  let removalReason='';
  $('content').append(section('Explicit exclusion',field('Why this line is outside the new edition','',v=>removalReason=v,{max:1000}),
    button('Exclude this line from the new edition',()=>{
      if(!removalReason.trim())throw new Error('Record why the original row is outside this edition.');
      if(line.sourceRow!==null){
        const mapping=draft.imports.find(x=>x.sourceId===line.sourceId);if(!mapping)throw new Error('Original mapping is missing; retain this line and inspect its source.');
        mapping.excludedRows??=[];mapping.excludedRows.push({row:line.sourceRow,reason:removalReason});
      }
      draft.lines=draft.lines.filter(x=>x.id!==line.id);selectedLine=draft.lines[0]?.id??null;changed();render();
    }),muted('The prior saved edition and complete original document remain retained.')));
}
function renderCoverage(){
  if(!draft)return $('content').append(section('Choose a saved pricing source',button('Open saved source',()=>goto('source'))));
  $('content').append(section('Cost period and source alignment',
    el('div',{class:'grid'},field('From day',draft.period.from,v=>{draft.period.from=v;draft.periodAlignment.confirmed=false;changed();},{type:'date'}),
      field('Through day',draft.period.through,v=>{draft.period.through=v;draft.periodAlignment.confirmed=false;changed();},{type:'date'})),
    muted('Original observation: '+pricing.report.observedFrom+' through '+pricing.report.observedUntil),
    check('I have checked that the selected source charges and original observations cover the same operational scope.',draft.periodAlignment.confirmed,v=>{
      draft.periodAlignment.confirmed=v;changed();}),
    field('Period and scope alignment explanation',draft.periodAlignment.reason,v=>{draft.periodAlignment.reason=v;changed();},{type:'textarea'}),
    note('Each allocated charge original must also declare this exact from/through period. A date-only agreement does not replace the operator’s scope review.')));
  $('content').append(section('Every route’s cost coverage',table(draft.coverage,[
    ['Route','routeId'],['Coverage',r=>select('Assessment',r.state,[['UNKNOWN','Unknown'],['PARTIAL','Partial'],['COMPLETE','Complete']],v=>{r.state=v;changed();})],
    ['Rationale',r=>field('What is covered or missing',r.note,v=>{r.note=v;changed();},{type:'textarea'})],
    ['Known zero',r=>check('I confirm zero cost if there is no selected USD allocation.',r.zeroCostConfirmed,v=>{r.zeroCostConfirmed=v;changed();})]]),
    muted('Complete means all supplier costs intended for the selected basis and period have been considered. Unassigned costs, incompatible currency, negative net credits and incomplete source observations remain visible in the proposal.')));
  $('content').append(section('Attached operational / accounting context',
    table(draft.contextSourceIds.map(sourceId=>allSources.find(x=>x.sourceId===sourceId)??{sourceId,metadata:{label:sourceId,kind:'UNKNOWN'}}),
      [['Source',r=>r.metadata.label],['Kind',r=>r.metadata.kind],['Action',r=>button('Remove context',()=>{
        draft.contextSourceIds=draft.contextSourceIds.filter(id=>id!==r.sourceId);changed();render();
      })]]),button('Choose original context files',()=>goto('originals'))));
}
function renderReport(report,context=[]){
  const result=el('div',{},section('Exact cost groups',table(report.groups,[['Basis','basis'],['Currency','currency'],['Original amount','amount'],
    ['Allocated','allocated'],['Unassigned','unassigned'],['Lines','lines']])));
  result.append(section('Route costs and pricing readiness',table(report.routes,[['Route','routeId'],['Original 2xx','actual2xx'],
    ['Cost scope',r=>r.coverage.state],['Billed cost per 2xx · USD',r=>r.proposals.BILLED.perFulfilledUsd??'Needs review'],
    ['Quoted cost per 2xx · USD',r=>r.proposals.QUOTED.perFulfilledUsd??'Needs review'],
    ['Details',r=>inspect('Route '+r.routeId,r)]]),note(report.semantics.revenue)));
  if(report.issues.length)result.append(section('Unassigned costs and source-period differences',
    table(report.issues,[['Issue',x=>x.code.replaceAll('_',' ')],['Line','lineId'],['Currency','currency'],['Amount','amount'],['Details','message']])));
  for(const value of context){
    result.append(section('Original context · '+value.source.metadata.label,value.semantics?note(value.semantics):null,
      value.format==='MERCHANT_ACCOUNTING'?table(value.options,[['Route','routeId'],['Network','network'],['Native matched atomic amount','officialMatchedAmountAtomic'],
        ['Matched transfers','officialTransferMatches'],['Original quoted USD','verifiedQuotedValueUsd'],['Option',r=>inspect('Full original option',r)]]):null,
      inspect('Complete retained native summary',value)));
  }
  return result;
}
function renderReview(){
  if(!draft)return $('content').append(section('Choose a saved pricing source',button('Open saved source',()=>goto('source'))));
  $('content').append(section('Review and save',field('Cost edition name',draft.label,v=>{draft.label=v;changed();},{max:160}),
    field('What was entered or corrected in this edition',draft.reason,v=>{draft.reason=v;changed();},{type:'textarea'}),
    el('div',{class:'actions'},button('Calculate cost review',async()=>{
      review=await cost('preview',{book:draft});render();status('Exact allocation, unassigned amounts, source periods and cost proposal readiness calculated.');
    }),button(pendingSave?'Recover previous save':'Save immutable edition',async()=>{
      const now=JSON.stringify(draft);
      pendingSave??={requestId:crypto.randomUUID(),expectedRevision:editRevision,book:structuredClone(draft)};
      const sent=pendingSave;let result;
      try{result=await cost('save',sent);}catch(error){
        if(error.status===409){pendingSave=null;state=await api('/api/economics/state');editRevision=state.revision;
          status('A newer edition is saved. Your draft remains; review it against the latest state before retrying.',true);}throw error;
      }
      pendingSave=null;editRevision=result.revision;selectedEdition=await cost('edition',{edition:result.edition});
      if(now===JSON.stringify(sent.book)){draft=structuredClone(selectedEdition.input);draftDirty=false;}
      review={report:selectedEdition.report,context:selectedEdition.context};await refresh();
      status(result.replayed?'The original save is recovered.':'Cost edition saved. Its original sources and allocations are retained.');
    },{primary:true})),
    facts([['Charge lines',draft.lines.length],['Mapped originals',draft.imports.length],['Context sources',draft.contextSourceIds.length]]),
    draft.imports.some(x=>x.excludedRows?.length)?inspect('Explicit original row exclusions',draft.imports.filter(x=>x.excludedRows?.length).map(x=>({
      sourceId:x.sourceId,excludedRows:x.excludedRows}))):null));
  if(review)$('content').append(renderReport(review.report,review.context));
}

let pricingBasis='BILLED',proposalRouteIds=new Set(),lastPricingSave=null,lastExport=null;
function editionOptions(){return [['','Choose saved cost edition'],...allEditions.map(x=>[x.edition,x.label+' · '+x.savedAt])];}
function renderHistory(){
  let before=allEditions[1]?.edition??'',after=selectedEdition?.edition??allEditions[0]?.edition??'';
  $('content').append(section('Immutable cost editions',
    muted('A correction creates another complete edition. Earlier original documents, source-row exclusions, allocations and pricing links stay available.'),
    table(allEditions,[['Name','label'],['Period',x=>x.period.from+' → '+x.period.through],['Lines','lineCount'],['Sources','sourceCount'],
      ['Source review items','issueCount'],['Saved','savedAt'],['Action',x=>button('Load edition',()=>loadEdition(x.edition))]]),
    allEditions.length<state.editionCount?button('Load more editions',()=>loadMore('EDITIONS')):null));
  if(selectedEdition){
    const x=selectedEdition;
    $('content').append(section('Selected edition · '+x.label,facts([['Lines',x.lineCount],['Sources',x.sourceCount],['Saved',x.savedAt]]),
      muted('Revision '+x.revision),
      el('div',{class:'actions'},button('Prepare a corrected edition',()=>{
        draft=structuredClone(x.input);draft.label=x.label+' · correction';draft.reason='';editRevision=state.revision;
        draftDirty=true;review=null;proposal=null;pendingSave=null;goto('charges');
      }),button('Review route cost proposals',()=>goto('pricing'))),
      el('div',{class:'files'},x.files.map(name=>link(name,'/cost-files/edition/'+x.edition+'/'+encodeURIComponent(name)))),
      x.pricingLinks.length?table(x.pricingLinks,[['Saved pricing review','label'],['Saved','savedAt'],['Pricing version','pricingVersion'],
        ['Proposal hash',r=>el('code',{},r.proposalSha256)]]):muted('No cost proposal has been saved into the original pricing workflow for this edition.'),
      inspect('Original source bindings',x.binding)));
  }
  if(allEditions.length>1)$('content').append(section('Compare two saved editions',
    el('div',{class:'grid'},select('Before',before,editionOptions(),v=>before=v),select('After',after,editionOptions(),v=>after=v)),
    button('Compare exact editions',async()=>{if(!before||!after||before===after)throw new Error('Choose two different saved editions.');
      comparison=await cost('compare',{before,after});render();})));
  if(comparison){
    const c=comparison;
    $('content').append(section('Saved-edition comparison',
      facts([['Same saved pricing source',c.compatibility.samePricingVersion?'Yes':'No'],['Same period',c.compatibility.samePeriod?'Yes':'No'],
        ['Changed source lines',c.changes.length]]),
      !c.compatibility.samePricingVersion||!c.compatibility.samePeriod?
        note('The source review or dates differ. Read both denominators and scopes before interpreting any amount difference.'):null,
      table(c.changes,[['Line','id'],['Change','change'],['Before source',x=>x.before?.sourceId??'Absent'],['After source',x=>x.after?.sourceId??'Absent'],
        ['Exact retained values',x=>inspect('Compare line',x)]]),
      inspect('Before groups and route assessments',c.before),inspect('After groups and route assessments',c.after),note(c.semantics)));
  }
}
function renderPricing(){
  let chosen=selectedEdition?.edition??allEditions[0]?.edition??'';
  $('content').append(section('Saved cost source for a pricing decision',
    select('Cost edition',chosen,editionOptions(),v=>chosen=v),
    el('div',{class:'actions'},button('Load saved cost edition',async()=>{
      await loadEdition(chosen);proposalRouteIds=new Set();pricingBasis='BILLED';tab='pricing';render();
    }),allEditions.length<state.editionCount?button('Load more editions',()=>loadMore('EDITIONS')):null),
    note('Select billed costs or a separate quoted sensitivity. The original pricing engine reviews the resulting per-fulfilled cost; its native payment options and exact atomic price decisions remain in the merchant pricing workspace.')));
  if(!selectedEdition)return;
  const saved=selectedEdition;
  if(draftDirty)$('content').append(note('This proposal uses the saved edition shown below. Save your edited draft as a new edition to include its corrections.'));
  const selector=select('Cost basis',pricingBasis,[['BILLED','Bills and credit notes'],['QUOTED','Quotes · pricing sensitivity']],v=>{
    pricingBasis=v;proposalRouteIds=new Set();proposal=null;pendingApply=null;render();
  });
  const rows=saved.report.routes;
  $('content').append(section('Select compatible route costs · '+saved.label,selector,
    table(rows,[['Select',r=>{
      const candidate=r.proposals[pricingBasis];
      const control=check('Use '+r.routeId,proposalRouteIds.has(r.routeId),on=>{
        if(candidate.status!=='AVAILABLE')return;
        if(on)proposalRouteIds.add(r.routeId);else proposalRouteIds.delete(r.routeId);proposal=null;
      });control.querySelector('input').disabled=candidate.status!=='AVAILABLE';return control;
    }],['Route',r=>r.method+' '+r.path],['Coverage',r=>r.coverage.state],['Original HTTP 2xx','actual2xx'],
      ['Allocated · USD',r=>r.proposals[pricingBasis].allocatedUsd],['Cost per fulfillment · USD',r=>r.proposals[pricingBasis].perFulfilledUsd],
      ['Assessment',r=>r.proposals[pricingBasis].status==='AVAILABLE'?'Available':r.proposals[pricingBasis].blockers.join(' · ')]]),
    button('Review in the original pricing engine',async()=>{
      if(!proposalRouteIds.size)throw new Error('Select at least one route with an available compatible cost.');
      proposal=await cost('proposal',{edition:saved.edition,basis:pricingBasis,routeIds:[...proposalRouteIds]});
      pendingApply=null;lastPricingSave=null;render();status('Original pricing review prepared. Inspect its exact cost inputs before saving.');
    },{primary:true}),
    inspect('Saved cost report and original operational scope',saved.report)));
  if(proposal){
    const p=proposal;let label=saved.label+' · '+p.basis.toLowerCase()+' costs';
    $('content').append(section('Original pricing review',
      facts([['Basis',p.basis],['Selected routes',p.routeIds.length],['Current seller matches original',p.sellerChanged?'No':'Yes']]),
      p.sellerChanged?note('The host-selected seller configuration differs from this saved source. Restore or capture the intended original configuration before saving a new pricing review.'):null,
      table(p.changes,[['Route','routeId'],['Previous per fulfillment · USD','beforePerFulfilledUsd'],
        ['Proposed per fulfillment · USD','afterPerFulfilledUsd'],['Allocated supplier amount · USD','allocatedUsd'],
        ['Original HTTP 2xx','originalHttp2xx'],['Rounding remainder · USD','roundedReconstructionDifferenceUsd']]),
      table(p.originalReview.routes,[['Route','routeId'],['Merchant quoted price · USD','quoteUsd'],
        ['Original cost input · USD','variablePerFulfilledUsd'],['Original forecast contribution · USD','plannedMonthlyTargetContributionBeforeFixedUsd'],
        ['Original flags',x=>(x.flags??[]).join(' · ')]]),
      inspect('Complete original pricing engine report',p.originalReview),muted('Proposal '+p.proposalSha256),
      field('New saved pricing review name',label,v=>label=v,{max:100}),
      el('div',{class:'actions'},button(pendingApply?'Recover this pricing save':'Save into merchant pricing',async()=>{
        if(!pendingApply)pendingApply={requestId:crypto.randomUUID(),edition:p.edition,basis:p.basis,routeIds:[...p.routeIds],
          proposalSha256:p.proposalSha256,expectedPricingRevision:state.pricingReviews[0]?.revision??null,label};
        try{lastPricingSave=await cost('apply-pricing',pendingApply);}
        catch(error){if(error.status===409){pendingApply=null;proposal=null;await refresh();
          throw new Error(error.message+' The current pricing head was refreshed. Review the saved source again before another save.');}throw error;}
        pendingApply=null;await refresh();
        status(lastPricingSave.replayed?'The original pricing save was recovered.':'Supplier cost proposal saved in the original merchant pricing workflow.');
      },{primary:true,disabled:p.sellerChanged&&!pendingApply}))));
  }
  if(lastPricingSave)$('content').append(section('Saved in merchant pricing',
    facts([['Review',lastPricingSave.pricing.label],['Saved',lastPricingSave.pricing.savedAt],['Version',lastPricingSave.pricing.version]]),
    el('div',{class:'actions'},link('Open merchant pricing',lastPricingSave.next.pricingWorkspace),
      link('Review exact payment-price decisions',lastPricingSave.next.paymentChanges)),
    inspect('Retained cost-to-pricing link',lastPricingSave.link)));
}
function renderExports(){
  let chosen=selectedEdition?.edition??allEditions[0]?.edition??'';
  $('content').append(section('Export a saved cost edition',
    muted('Contains its original files, exact mapped input, full allocations and unassigned amounts, source bindings, original pricing report and saved cost-to-pricing links.'),
    select('Saved cost edition',chosen,editionOptions(),v=>chosen=v),
    button(pendingExport?.kind==='COST_EDITION'?'Recover edition export':'Create cost edition package',async()=>{
      if(pendingExport&&pendingExport.kind!=='COST_EDITION')throw new Error('Recover the pending private workspace backup first.');
      if(!pendingExport){if(!chosen)throw new Error('Choose a saved cost edition.');pendingExport={requestId:crypto.randomUUID(),kind:'COST_EDITION',edition:chosen};}
      lastExport=await cost('export',pendingExport);pendingExport=null;await refresh();status('Exact cost edition package retained. Download its TAR below.');
    },{primary:true})));
  $('content').append(section('Back up the complete private workspace',
    muted('Retains committed original pricing reviews, price decisions, scenario plans and cost editions, their original files, source revisions and histories. Active seller processes and environment credentials remain host configuration.'),
    note('The archive contains the original supplier and merchant records. Keep it in your private operating environment.'),
    button(pendingExport?.kind==='WORKSPACE_BACKUP'?'Recover private backup':'Create complete private backup',async()=>{
      if(pendingExport&&pendingExport.kind!=='WORKSPACE_BACKUP')throw new Error('Recover the pending cost edition export first.');
      pendingExport??={requestId:crypto.randomUUID(),kind:'WORKSPACE_BACKUP'};
      lastExport=await cost('export',pendingExport);pendingExport=null;await refresh();status('Complete private workspace backup retained.');
    })));
  if(lastExport)$('content').append(section('Latest package',
    facts([['Kind',lastExport.kind],['Bytes',lastExport.bytes],['Files',lastExport.fileCount],['Created',lastExport.createdAt]]),
    muted('SHA-256 '+lastExport.sha256),link('Download '+lastExport.filename,lastExport.download)));
  $('content').append(section('Retained package history',
    table(exportsList,[['Kind','kind'],['Created','createdAt'],['Bytes','bytes'],['SHA-256',r=>el('code',{},r.sha256)],
      ['Download',r=>link(r.filename,r.download)]]),
    exportsList.length<(state.exportCount??0)?button('Load more packages',()=>loadMore('EXPORTS')):null));
  $('content').append(section('Restore and continue',
    muted('Start the original pricing workspace with the private backup, a new state directory and the original host-selected seller and observation files.'),
    el('pre',{},'node stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/workspace/cli.mjs --config ORIGINAL_SELLER.json --snapshot ORIGINAL_OPERATIONS.json --state NEW_PRIVATE_DIRECTORY --restore-cost-workspace PRIVATE_BACKUP.tar'),
    note('Use the same original history or Operations options instead of --snapshot when that is your configured source. A complete matching restore reopens its retained editions; an interrupted restore can resume only with the same archive and new destination.'),
    muted('The restored workspace keeps stable source and edition identities. Continue by saving a new correction or creating another original pricing review.')));
}
$('refresh').addEventListener('click',()=>run(async()=>{await refresh();status('Saved source and history refreshed. Your current draft remains in this tab.');}));
window.addEventListener('beforeunload',event=>{
  if(draftDirty||pendingSave||pendingApply||pendingUpload||pendingExport){event.preventDefault();event.returnValue='';}
});
run(async()=>{await refresh();status('Supplier cost workspace ready. Choose an original saved pricing review.');});
