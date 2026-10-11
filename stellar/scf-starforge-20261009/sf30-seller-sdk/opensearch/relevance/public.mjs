// MIT. Relevance review is part of the original retained OpenSearch operator UI.
export function createRelevanceController({ host, api, perform, refresh, notice, view, element, attempt }) {
  const root=document.getElementById('view-relevance');
  const local={set:null,dirty:false,loading:false,caseId:null,page:0,result:null,variantId:null,caseResultId:null,buffers:new Map(),editions:new Map(),rawInputs:new Map(),rawMetric:''};
  const $=id=>document.getElementById('rel-'+id);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const pretty=value=>JSON.stringify(value,null,2);
  const empty=()=>({schema:'stellar-forge.opensearch-relevance-set.v1',title:'Search evaluation',description:'',
    metric:{precision:{k:10,relevant_rating_threshold:1,ignore_unlabeled:false}},variants:[],cases:[]});
  const held=()=>host.busy||Boolean(host.pending)||local.loading;
  const error=issue=>notice([issue.code,issue.message].filter(Boolean).join(' · '),true);
  async function loadAction(action) {
    if(local.loading)return;
    local.loading=true;buttons();
    try{return await action();}finally{local.loading=false;buttons();}
  }
  function button(label,action,attrs={}) {
    const node=element('button',label,{type:'button',...attrs});
    node.addEventListener('click',()=>attempt(()=>loadAction(action))); return node;
  }
  function input(label,id,tag='input',attrs={}) {
    const box=element('label',label),node=element(tag,undefined,{id:'rel-'+id,...attrs});
    box.append(node);return box;
  }
  function options(select,items,prompt) {
    const previous=select.value;
    select.replaceChildren(...(prompt?[element('option',prompt,{value:''})]:[]));
    for(const item of items)select.append(element('option',item.title,{value:item.id}));
    if(items.some(item=>item.id===previous))select.value=previous;
  }
  function link(label,path) {return element('a',label,{href:path,download:''});}
  function mark() {local.dirty=true;status();buttons();}
  function stash() {if(local.set&&local.dirty)local.buffers.set(local.set.id??'new',{
    definition:clone(local.set),rawInputs:[...local.rawInputs],rawMetric:local.rawMetric });}
  function status() {
    const selected=local.set,judged=selected?.cases.reduce((sum,item)=>sum+item.documents.filter(row=>row.rating!==null).length,0)??0;
    $('saved').textContent=selected?(selected.id?'Saved revision '+selected.revision:'New evaluation')+
      (local.dirty?' · unsaved changes':'')+' · '+selected.variants.length+' variants · '+selected.cases.length+' cases · '+judged+' judgments':'Create or open an evaluation set.';
    const id=selected?.id;$('set-download').hidden=!id;if(id)$('set-download').href='/api/relevance/sets/'+encodeURIComponent(id)+'/set.json';
  }
  function buttons() {
    const locked=held(),saved=Boolean(local.set?.id),clean=saved&&!local.dirty;
    for(const node of root.querySelectorAll('[data-rel-write]'))node.disabled=locked;
    $('save').disabled=locked||!local.set||!local.dirty;
    $('validate').disabled=locked||!clean;
    $('run').disabled=locked||!clean||Boolean(host.data?.nativeBusy);
    $('add-variant').disabled=locked||!local.set||!$('draft').value;
    $('seed').disabled=locked||!local.set||!$('edition').value;
    $('add-case').disabled=locked||!local.set;
    $('import-judgments').disabled=locked||!currentCase();
    $('add-document').disabled=locked||!currentCase();
    $('previous').disabled=!currentCase()||local.page===0;
    $('next').disabled=!currentCase()||(local.page+1)*50>=currentCase().documents.length;
  }
  function fill(value,{dirty=false}={}) {
    const buffer=value?.definition?value:null;
    local.set=clone(buffer?.definition??value);local.dirty=dirty;local.caseId=local.set.cases[0]?.id??null;local.page=0;
    local.rawInputs=new Map(buffer?.rawInputs??local.set.cases.map(item=>[item.id,pretty(item.input)]));
    local.rawMetric=buffer?.rawMetric??pretty(local.set.metric);
    $('title').value=local.set.title;$('description').value=local.set.description??'';
    $('metric').value=local.rawMetric;renderVariants();renderCases();status();buttons();
  }
  async function openSet(id) {
    if (!id) throw new Error('Choose a saved evaluation set.');
    stash();
    const value=local.buffers.get(id)??await api('/api/relevance/sets/'+encodeURIComponent(id));
    fill(value,{dirty:local.buffers.has(id)});view('relevance');
  }
  function newSet() {
    stash();fill(local.buffers.get('new')??empty(),{dirty:true});view('relevance');
    notice('New relevance evaluation. Add saved query variants and input cases, then assign document judgments.');
  }
  function uniqueId(prefix,items) {
    let number=1;while(items.some(item=>item.id===prefix+number))number++;
    return prefix+number;
  }
  async function addVariant() {
    if(!$('draft').value)return;
    const draft=await api('/api/drafts/'+encodeURIComponent($('draft').value));
    local.set.variants.push({id:uniqueId('variant-',local.set.variants),title:draft.title,queryName:draft.queryName,
      query:clone(draft.query),plan:clone(draft.plan),input:clone(draft.input),
      draft:{id:draft.id,revision:draft.revision,title:draft.title}});
    mark();renderVariants();
  }
  function renderVariants() {
    const target=$('variants');target.replaceChildren();
    if(!local.set?.variants.length)return target.append(element('p','Add one or more saved query drafts. Every variant retains its exact query, input contract and merchant plan.',{class:'empty'}));
    const table=element('table'),head=element('tr');
    for(const label of ['Variant','Query / saved revision','Definition',''])head.append(element('th',label));
    const thead=element('thead');thead.append(head);table.append(thead);const body=element('tbody');
    for(const variant of local.set.variants) {
      const row=element('tr'),titleCell=element('td'),title=element('input',undefined,{'aria-label':'Variant title',maxlength:120,'data-rel-write':''});
      title.value=variant.title;title.addEventListener('input',()=>{variant.title=title.value;mark();});
      titleCell.append(title,element('small',variant.id));
      const source=element('td',variant.queryName+(variant.draft?' · revision '+variant.draft.revision:' · imported definition'));
      const definition=element('td');definition.append(button('View query',()=>{$('definition-json').textContent=pretty(variant);$('definition').open=true;}));
      const remove=element('td');remove.append(button('Remove',()=>{local.set.variants=local.set.variants.filter(item=>item!==variant);mark();renderVariants();},{'data-rel-write':''}));
      row.append(titleCell,source,definition,remove);body.append(row);
    }
    table.append(body);target.append(table);buttons();
  }
  function currentCase() {return local.set?.cases.find(item=>item.id===local.caseId);}
  function selectCase(id) {local.caseId=id;local.page=0;renderCase();}
  function addCase() {
    const id=uniqueId('case-',local.set.cases);
    local.set.cases.push({id,title:'Input case '+(local.set.cases.length+1),
      input:clone(host.draft?.input??{}),documents:[]});
    mark();renderCases();selectCase(id);
  }
  async function seedCase() {
    const id=uniqueId('case-',local.set.cases),limit=Number($('seed-limit').value);
    const value=await api('/api/relevance/seed/'+encodeURIComponent($('edition').value)+'?caseId='+encodeURIComponent(id)+'&limit='+limit);
    local.set.cases.push(value);mark();renderCases();selectCase(id);
    notice('Added '+value.provenance.selectedDocuments+' of '+value.provenance.capturedDocuments+' captured documents. Empty ratings remain unrated until assigned.');
  }
  function renderCases() {
    const items=local.set?.cases??[];
    options($('case'),items.map(item=>({id:item.id,title:item.title+' · '+item.id})),items.length?null:'Add an input case');
    if(items.some(item=>item.id===local.caseId))$('case').value=local.caseId;
    else local.caseId=items[0]?.id??null;
    renderCase();
  }
  function renderCase() {
    const item=currentCase();$('case-editor').hidden=!item;
    if(!item){$('documents').replaceChildren();return buttons();}
    $('case-title').value=item.title;$('case-id').value=item.id;$('case-input').value=local.rawInputs.get(item.id)??pretty(item.input);
    $('case-provenance').textContent=item.provenance?
      'From capture '+item.provenance.editionId+' · '+item.provenance.capturedAt+
      ' · '+item.provenance.selectedDocuments+' / '+item.provenance.capturedDocuments+' selected documents':'Judgments supplied directly for this input.';
    renderDocuments();buttons();
  }
  function renderDocuments() {
    const item=currentCase();if(!item)return;
    const page=item.documents.slice(local.page*50,(local.page+1)*50);
    $('page').textContent=(item.documents.length?local.page*50+1:0)+'–'+Math.min((local.page+1)*50,item.documents.length)+' of '+item.documents.length;
    const target=$('documents');target.replaceChildren();
    if(!page.length)return target.append(element('p','Add document identities directly, import judgments, or create a case from a retained capture.',{class:'empty'}));
    const table=element('table'),head=element('tr');
    for(const value of ['Index','Document ID','Rating','Judgment note',''])head.append(element('th',value));
    const thead=element('thead');thead.append(head);table.append(thead);const body=element('tbody');
    for(const doc of page) {
      const row=element('tr');
      for(const [key,label]of [['_index','Original index'],['_id','Original document ID']]) {
        const cell=element('td'),field=element('input',undefined,{'aria-label':label,'data-rel-write':''});
        field.value=doc[key];field.addEventListener('input',()=>{doc[key]=field.value;delete doc.hit;mark();});cell.append(field);row.append(cell);
      }
      const ratingCell=element('td'),rating=element('input',undefined,{type:'number',min:'0',step:'1',placeholder:'Unrated','aria-label':'Document relevance rating','data-rel-write':''});
      rating.value=doc.rating===null?'':String(doc.rating);
      rating.addEventListener('input',()=>{doc.rating=rating.value===''?null:Number(rating.value);mark();});
      ratingCell.append(rating);row.append(ratingCell);
      const noteCell=element('td'),note=element('input',undefined,{'aria-label':'Judgment note',maxlength:'2000','data-rel-write':''});
      note.value=doc.note??'';note.addEventListener('input',()=>{doc.note=note.value;mark();});noteCell.append(note);row.append(noteCell);
      const actions=element('td');actions.append(button('Document',()=>openDocument(item,doc)),
        button('Remove',()=>{item.documents=item.documents.filter(value=>value!==doc);local.page=Math.min(local.page,Math.max(0,Math.ceil(item.documents.length/50)-1));mark();renderDocuments();buttons();},{'data-rel-write':''}));
      row.append(actions);body.append(row);
    }
    table.append(body);target.append(table);buttons();
  }
  async function openDocument(item,doc) {
    let hit=doc.hit;
    if(!hit&&item.provenance?.editionId) {
      const id=item.provenance.editionId;
      let edition=local.editions.get(id);
      if(!edition){edition=await api('/api/editions/'+encodeURIComponent(id));local.editions.set(id,edition);}
      if(edition.resultSha256!==item.provenance.resultSha256)throw new Error('The referenced capture differs from the saved judgment source.');
      hit=edition.result.hits.find(value=>value._index===doc._index&&value._id===doc._id);
    }
    $('document-json').textContent=pretty(hit??{_index:doc._index,_id:doc._id,rating:doc.rating,note:doc.note});
    $('document').open=true;
  }
  function addDocument() {
    const item=currentCase();
    item.documents.push({_index:'',_id:'',rating:null,note:''});
    local.page=Math.floor((item.documents.length-1)/50);mark();renderDocuments();buttons();
  }
  async function importJudgments(file) {
    if(!file)return;
    if(file.size>786432)throw new Error('Judgment JSON must fit within 768 KiB.');
    const value=JSON.parse(await file.text()),rows=Array.isArray(value)?value:value.ratings??value.documents;
    if(!Array.isArray(rows)||rows.length>5000)throw new Error('Import up to 5,000 {_index,_id,rating} judgments.');
    const item=currentCase(),existing=new Map(item.documents.map(row=>[JSON.stringify([row._index,row._id]),row])),seen=new Set();
    for(const row of rows) {
      if(!row||typeof row._index!=='string'||!row._index.length||typeof row._id!=='string'||!row._id.length)
        throw new Error('Each judgment needs its nonempty original native _index and _id.');
      if(row.rating!==undefined&&row.rating!==null&&(!Number.isInteger(row.rating)||row.rating<0||row.rating>2147483647))
        throw new Error('Imported ratings must be nonnegative integer numbers or null for unrated documents.');
      if(row.note!==undefined&&typeof row.note!=='string')throw new Error('Judgment notes must be text.');
      const key=JSON.stringify([row._index,row._id]),prior=existing.get(key);
      if(seen.has(key))throw new Error('The import contains a repeated index/document judgment. Keep one rating for each identity.');seen.add(key);
      const next={...prior,_index:row._index,_id:row._id,rating:row.rating??null,note:row.note??prior?.note??''};
      existing.set(key,next);
    }
    if(existing.size>5000)throw new Error('This import would exceed 5,000 document identities in the case.');
    item.documents=[...existing.values()];local.page=0;mark();renderDocuments();buttons();
    notice('Imported judgments by exact index and document ID; the case input is retained.');
  }
  async function importSet(file) {
    if(!file)return;
    if(file.size>33554432)throw new Error('Evaluation imports support files up to 32 MiB.');
    let value=JSON.parse(await file.text());if(value?.schema==='stellar-forge.opensearch-relevance-edition.v1')value=value.set;
    if(value?.schema!=='stellar-forge.opensearch-relevance-set.v1'||!Array.isArray(value.cases)||!Array.isArray(value.variants))
      throw new Error('Choose an exported OpenSearch evaluation set or evaluation edition.');
    stash();
    const importedFrom={setId:value.id??null,revision:value.revision??null,sourceProfileSha256:value.sourceProfileSha256??null};
    const {id,revision,createdAt,updatedAt,sourceProfileSha256,...definition}=value;
    const normalized=await api('/api/relevance/normalize',{set:{...definition,importedFrom}});
    fill(normalized,{dirty:true});view('relevance');
    notice('Imported a new editable evaluation set. Its native query definitions and exact judgments are retained.');
  }
  function metricPreset() {
    const kind=$('metric-kind').value,k=Number($('metric-k').value);
    if(!Number.isInteger(k)||k<1)throw new Error('Metric k must be a positive integer.');
    const parameters={k};
    if(['precision','recall','mean_reciprocal_rank'].includes(kind))parameters.relevant_rating_threshold=1;
    if(kind==='precision')parameters.ignore_unlabeled=false;
    if(kind==='dcg')parameters.normalize=true;
    if(kind==='expected_reciprocal_rank')parameters.maximum_relevance=3;
    local.set.metric={[kind]:parameters};local.rawMetric=pretty(local.set.metric);$('metric').value=local.rawMetric;mark();
  }
  function readEditor() {
    if(!local.set)throw new Error('Create or open an evaluation set.');
    local.set.title=$('title').value;local.set.description=$('description').value;
    local.set.metric=JSON.parse(local.rawMetric);
    for(const item of local.set.cases) {
      try{item.input=JSON.parse(local.rawInputs.get(item.id)??pretty(item.input));}
      catch{throw new Error('Case '+item.id+' has invalid query input JSON. Correct that case before saving.');}
    }
    return clone(local.set);
  }
  async function save() {
    const set=readEditor();
    await perform('relevance-save',{...(set.id?{setId:set.id,expectedRevision:set.revision}:{}),set});
  }
  async function validate() {
    const result=await api('/api/relevance/validate',{setId:local.set.id,expectedRevision:local.set.revision});
    $('validation-json').textContent=pretty(result);$('validation').open=true;
    notice('The original native relevance contract accepted this saved evaluation revision.');
  }
  async function run() {
    await perform('relevance-run',{setId:local.set.id,expectedRevision:local.set.revision});
  }
  function resultRows() {return local.result?.result.variants??[];}
  async function openResult(id) {
    local.result=await api('/api/relevance/editions/'+encodeURIComponent(id));
    local.variantId=resultRows()[0]?.id??null;
    $('result-title').textContent=local.result.title+' · evaluation revision '+local.result.setRevision;
    const native=local.result.result;
    $('result-summary').textContent=native.capturedAt+' · '+(native.complete?'All cases complete':'Completed with per-case failures or incomplete correspondence')+
      ' · '+native.variants.length+' query variants · cluster '+(native.source?.clusterFingerprint??'unavailable');
    $('result').hidden=false;
    const downloads=$('downloads');downloads.replaceChildren();
    const base='/api/relevance/editions/'+encodeURIComponent(id)+'/';
    for(const[name,label]of [['report.html','Customer report'],['edition.json','Full retained evaluation'],['native.json','Original native result'],['report.json','Customer report JSON'],['cases.csv','Case scores CSV']])
      downloads.append(link(label,base+name));
    $('result-meta').textContent=pretty({...local.result,result:undefined,set:undefined});
    renderScores();renderVariant();view('relevance');
  }
  function renderScores() {
    const target=$('scores');target.replaceChildren();
    const table=element('table'),head=element('tr');
    for(const title of ['Variant','Native score','Complete cases','Judged returned','Unrated returned',''])head.append(element('th',title));
    const thead=element('thead');thead.append(head);table.append(thead);const body=element('tbody');
    for(const variant of resultRows()) {
      const cases=variant.cases??[],complete=cases.filter(row=>row.status==='COMPLETE').length;
      const judged=cases.reduce((count,row)=>count+(row.judgedHitCount??0),0);
      const unjudged=cases.reduce((count,row)=>count+(row.unjudgedHitCount??0),0);
      const row=element('tr');
      for(const value of [variant.label??variant.id,variant.metricScore??'Unavailable',complete+' / '+cases.length,judged,unjudged])row.append(element('td',value));
      const action=element('td');action.append(button('Review',()=>{local.variantId=variant.id;renderVariant();}));row.append(action);body.append(row);
    }
    table.append(body);target.append(table);
  }
  function renderVariant() {
    const variant=resultRows().find(row=>row.id===local.variantId);
    if(!variant)return;
    $('variant-title').textContent=variant.label??variant.id;
    const target=$('case-results');target.replaceChildren();
    const table=element('table'),head=element('tr');
    for(const label of ['Case','Status','Native score','Returned / judged','Supplied judgments',''])head.append(element('th',label));
    const thead=element('thead');thead.append(head);table.append(thead);const body=element('tbody');
    for(const item of variant.cases??[]) {
      const row=element('tr'),original=local.result.set.cases.find(value=>value.id===item.id);
      for(const value of [original?.title??item.id,item.status,item.score??'Unavailable',
        (item.hitCount??0)+' / '+(item.judgedHitCount??0),item.judgmentCount??0])row.append(element('td',value));
      const action=element('td');action.append(button('Review results',()=>showCaseResult(variant,item)));
      action.append(button('Open merchant draft',()=>perform('relevance-promote',{editionId:local.result.id,variantId:variant.id,caseId:item.id}),{'data-rel-write':''}));
      row.append(action);body.append(row);
    }
    table.append(body);target.append(table);
    $('native-json').textContent=pretty({native:variant.native,exactIntegerPaths:variant.exactIntegerPaths??[]});
    buttons();
  }
  function showCaseResult(variant,item) {
    local.caseResultId=item.id;
    const detail=variant.native?.details?.[item.id],failure=variant.native?.failures?.[item.id];
    $('case-result-title').textContent=item.id+' · '+item.status;
    $('case-result-json').textContent=pretty({case:item,native:detail??null,failure:failure??null,
      exactIntegerPaths:variant.exactIntegerPaths??[]});
    $('case-result').open=true;
    const target=$('returned-hits');target.replaceChildren();
    if(!detail?.hits?.length)return;
    const table=element('table'),head=element('tr');
    for(const label of ['Rank','Index','Document ID','Judgment','Source'])head.append(element('th',label));
    const thead=element('thead');thead.append(head);table.append(thead);const body=element('tbody');
    detail.hits.forEach((item,index)=>{
      const row=element('tr');
      for(const value of [index+1,item.hit?._index,item.hit?._id,item.rating===null||item.rating===undefined?'Unrated':item.rating])row.append(element('td',value));
      const source=element('td');source.append(button('View',()=>{
        const escape=value=>value.replaceAll('~','~0').replaceAll('/','~1');
        const prefix='/details/'+escape(local.caseResultId??'')+'/hits/'+index;
        $('document-json').textContent=pretty({native:item,exactIntegerPaths:(variant.exactIntegerPaths??[])
          .filter(path=>path===prefix||path.startsWith(prefix+'/')).map(path=>path.slice(prefix.length))});$('document').open=true;
      }));
      row.append(source);body.append(row);
    });
    table.append(body);target.append(table);
  }
  async function compare() {
    const before=$('compare-before').value,after=$('compare-after').value;
    if(!before||!after)throw new Error('Choose two retained evaluations.');
    const path='/api/relevance/compare?before='+encodeURIComponent(before)+'&after='+encodeURIComponent(after);
    const result=await api(path);$('comparison').hidden=false;
    $('comparison-summary').textContent=result.scope.comparable?'Metric, judgments, case inputs and native cluster match; both runs completed.':
      'Review the retained comparison scope: '+Object.entries(result.scope).filter(([key,value])=>key!=='comparable'&&!value).map(([key])=>key).join(', ')+'.';
    $('comparison-json').textContent=pretty(result);$('comparison-download').href=path+'&download=1';
    const target=$('comparison-table');target.replaceChildren();const table=element('table'),head=element('tr');
    for(const label of ['Variant','Earlier score','Later score','Change','Query definition'])head.append(element('th',label));
    const thead=element('thead');thead.append(head);table.append(thead);const body=element('tbody');
    for(const item of result.variants){const row=element('tr');for(const value of [item.after?.label??item.before?.label??item.id,
      item.before?.score??'Unavailable',item.after?.score??'Unavailable',item.delta??'Review scope',item.queryChanged?'Changed':'Same'])row.append(element('td',value));body.append(row);}
    table.append(body);target.append(table);
  }
  function sync() {
    const data=host.data?.relevance??{sets:[],editions:[]};
    options($('saved-set'),data.sets.map(item=>({id:item.id,title:item.title+' · revision '+item.revision})),'Open a saved evaluation');
    options($('draft'),(host.data?.drafts??[]).map(item=>({id:item.id,title:item.title+' · revision '+item.revision})),'Choose a saved query draft');
    options($('edition'),(host.data?.editions??[]).map(item=>({id:item.id,title:item.title+' · '+item.capturedAt})),'Choose a captured result');
    const entries=(data.editions??[]).map(item=>({id:item.id,title:item.title+' · r'+item.setRevision+' · '+item.createdAt}));
    for(const id of ['saved-result','compare-before','compare-after'])options($(id),entries,'Choose a retained evaluation');
    if(!local.set)fill(empty(),{dirty:false});
    status();buttons();
  }
  async function acceptOperation(operation) {
    if(operation.result?.relevanceSet) {
      const value=operation.result.relevanceSet;
      const priorKey=local.set?.id??'new';local.buffers.delete(priorKey);local.buffers.delete(value.id);fill(value);
      view('relevance');notice('Saved evaluation '+value.title+' at revision '+value.revision+'.');return true;
    }
    if(operation.result?.relevanceEditionId) {
      await openResult(operation.result.relevanceEditionId);
      notice('Native evaluation is retained with its exact query variants, judgments, metric and complete per-case outcomes.');return true;
    }
    return false;
  }
  function restorePending(pending) {if(pending?.kind==='relevance-save'&&pending.payload?.set)fill(pending.payload.set,{dirty:true});}

  const heading=element('div',undefined,{class:'section-heading'});
  const title=element('div');title.append(element('h2','Search relevance'),element('p','Evaluate saved query variants against explicit document judgments and retain the native results.',{class:'muted'}));
  heading.append(title,button('Refresh saved work',refresh));root.append(heading);
  const library=element('div',undefined,{class:'two-column'});
  const sets=element('div');sets.append(input('Evaluation sets','saved-set','select'));
  const setActions=element('div',undefined,{class:'actions'});
  setActions.append(button('Open selected',()=>openSet($('saved-set').value)),button('New evaluation',newSet,{'data-rel-write':''}));
  sets.append(setActions);
  const imports=element('div');imports.append(input('Import evaluation JSON','import-set','input',{type:'file',accept:'.json,application/json','data-rel-write':''}),
    element('p','Imports create a new editable set from the complete saved query and judgment definitions.',{class:'help'}));
  library.append(sets,imports);root.append(library,element('p','',{id:'rel-saved',class:'summary'}));
  root.append(input('Evaluation title','title','input',{maxlength:120,'data-rel-write':''}),input('Purpose and judgment guidance','description','textarea',{rows:3,maxlength:4000,'data-rel-write':''}));
  const metric=element('details');metric.append(element('summary','Native metric and evaluation depth'));
  const metricControls=element('div',undefined,{class:'two-column'});
  metricControls.append(input('Metric preset','metric-kind','select'),input('Top results (k)','metric-k','input',{type:'number',min:'1',step:'1',value:'10','data-rel-write':''}));
  metric.append(metricControls,button('Use preset',metricPreset,{'data-rel-write':''}),input('Exact native metric configuration','metric','textarea',{rows:7,class:'code',spellcheck:'false','data-rel-write':''}),
    element('p','An empty judgment is unrated. Grade 0 is an explicit relevance judgment. The native metric controls how missing labels affect its score.',{class:'help'}));root.append(metric);
  const variantControls=element('div',undefined,{class:'actions'});
  variantControls.append(input('Saved query draft','draft','select'),button('Add query variant',addVariant,{id:'rel-add-variant','data-rel-write':''}));
  root.append(element('h3','Query variants'),variantControls,element('div',undefined,{id:'rel-variants',class:'table-wrap'}));
  const definition=element('details',undefined,{id:'rel-definition'});definition.append(element('summary','Frozen variant definition'),element('pre','',{id:'rel-definition-json'}));root.append(definition);
  root.append(element('h3','Input cases and document judgments'));
  const seedControls=element('div',undefined,{class:'rel-seed'});
  seedControls.append(input('Retained source capture','edition','select'),input('Captured documents to judge','seed-limit','input',{type:'number',min:'1',max:'1000',step:'1',value:'100','data-rel-write':''}),
    button('Add case from capture',seedCase,{id:'rel-seed','data-rel-write':''}));
  root.append(seedControls);
  const caseControls=element('div',undefined,{class:'actions'});
  caseControls.append(input('Case','case','select'),button('Add input case',addCase,{id:'rel-add-case','data-rel-write':''}),
    button('Remove selected case',()=>{local.set.cases=local.set.cases.filter(item=>item.id!==local.caseId);local.caseId=null;mark();renderCases();},{'data-rel-write':''}));
  root.append(caseControls);
  const editor=element('div',undefined,{id:'rel-case-editor',hidden:''});
  const caseLabels=element('div',undefined,{class:'two-column'});
  caseLabels.append(input('Case title','case-title','input',{maxlength:'120','data-rel-write':''}),input('Stable case ID','case-id','input',{maxlength:'80','data-rel-write':''}));
  editor.append(caseLabels,input('Typed query input','case-input','textarea',{rows:'6',class:'code',spellcheck:'false','data-rel-write':''}),
    element('p','',{id:'rel-case-provenance',class:'help'}),input('Import judgments JSON into this case','import-judgments','input',{type:'file',accept:'.json,application/json','data-rel-write':''}));
  const paging=element('div',undefined,{class:'actions'});
  paging.append(button('Add document',addDocument,{id:'rel-add-document','data-rel-write':''}),
    button('Previous judgments',()=>{local.page--;renderDocuments();buttons();},{id:'rel-previous'}),
    element('span','',{id:'rel-page'}),button('Next judgments',()=>{local.page++;renderDocuments();buttons();},{id:'rel-next'}));
  editor.append(paging,element('div',undefined,{id:'rel-documents',class:'table-wrap'}));root.append(editor);
  const actions=element('div',undefined,{class:'actions'});
  actions.append(button('Save evaluation',save,{id:'rel-save',class:'primary','data-rel-write':''}),
    button('Validate saved evaluation',validate,{id:'rel-validate','data-rel-write':''}),
    button('Run native evaluation',run,{id:'rel-run','data-rel-write':''}));
  const setDownload=element('a','Export saved evaluation set',{id:'rel-set-download',hidden:'',download:''});actions.append(setDownload);root.append(actions);
  const validation=element('details',undefined,{id:'rel-validation'});validation.append(element('summary','Saved contract validation'),element('pre','',{id:'rel-validation-json'}));root.append(validation);
  root.append(element('h3','Retained evaluation results'),input('Completed native evaluation','saved-result','select'));
  root.append(button('Open evaluation',()=>openResult($('saved-result').value)));
  const comparisonControls=element('div',undefined,{class:'two-column'});
  comparisonControls.append(input('Earlier evaluation','compare-before','select'),input('Later evaluation','compare-after','select'));root.append(comparisonControls,button('Compare evaluations',compare));
  const comparison=element('div',undefined,{id:'rel-comparison',hidden:''});
  comparison.append(element('h3','Evaluation comparison'),element('p','',{id:'rel-comparison-summary'}),
    element('a','Download comparison JSON',{id:'rel-comparison-download',download:''}),element('div',undefined,{id:'rel-comparison-table',class:'table-wrap'}));
  const comparisonDetail=element('details');comparisonDetail.append(element('summary','Per-case changes and complete scope'),element('pre','',{id:'rel-comparison-json'}));comparison.append(comparisonDetail);root.append(comparison);
  const result=element('article',undefined,{id:'rel-result',hidden:''});
  result.append(element('h3','',{id:'rel-result-title'}),element('p','',{id:'rel-result-summary',class:'help'}),
    element('div',undefined,{id:'rel-downloads',class:'actions'}),element('div',undefined,{id:'rel-scores',class:'table-wrap'}),
    element('h3','',{id:'rel-variant-title'}),element('div',undefined,{id:'rel-case-results',class:'table-wrap'}));
  const caseResult=element('details',undefined,{id:'rel-case-result'});
  caseResult.append(element('summary','Case results',{id:'rel-case-result-title'}),element('div',undefined,{id:'rel-returned-hits',class:'table-wrap'}),element('pre','',{id:'rel-case-result-json'}));result.append(caseResult);
  const native=element('details');native.append(element('summary','Complete original native response and exact integer paths'),element('pre','',{id:'rel-native-json'}));result.append(native);
  const metadata=element('details');metadata.append(element('summary','Retained evaluation identity'),element('pre','',{id:'rel-result-meta'}));result.append(metadata);root.append(result);
  const doc=element('details',undefined,{id:'rel-document'});doc.append(element('summary','Original document'),element('pre','',{id:'rel-document-json'}));root.append(doc);
  for(const[name,label]of [['precision','Precision'],['recall','Recall'],['mean_reciprocal_rank','Mean reciprocal rank'],['dcg','Normalized discounted cumulative gain'],['expected_reciprocal_rank','Expected reciprocal rank']])
    $('metric-kind').append(element('option',label,{value:name}));
  for(const id of ['title','description'])$(id).addEventListener('input',()=>{if(local.set)local.set[id]=$(id).value;mark();});
  $('metric').addEventListener('input',()=>{local.rawMetric=$('metric').value;try{local.set.metric=JSON.parse(local.rawMetric);}catch{}mark();});
  $('case-title').addEventListener('input',()=>{const item=currentCase();if(item){item.title=$('case-title').value;mark();}});
  $('case-id').addEventListener('change',()=>{const item=currentCase();if(item){const prior=item.id,next=$('case-id').value;
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(next)||['__proto__','constructor','prototype'].includes(next)||
      local.set.cases.some(value=>value!==item&&value.id===next)) {
      $('case-id').value=prior;notice('Use a unique case ID with letters, digits, dots, underscores or hyphens.',true);return;
    }
    if(next===prior)return;
    item.id=next;
    if(local.rawInputs.has(prior)){local.rawInputs.set(item.id,local.rawInputs.get(prior));local.rawInputs.delete(prior);}
    local.caseId=item.id;mark();renderCases();}});
  $('case-input').addEventListener('input',()=>{const item=currentCase();if(item){local.rawInputs.set(item.id,$('case-input').value);
    try{item.input=JSON.parse($('case-input').value);}catch{}mark();}});
  $('case').addEventListener('change',()=>selectCase($('case').value));
  for(const id of ['draft','edition'])$(id).addEventListener('change',buttons);
  $('import-set').addEventListener('change',()=>attempt(()=>loadAction(()=>importSet($('import-set').files[0]))));
  $('import-judgments').addEventListener('change',()=>attempt(()=>loadAction(()=>importJudgments($('import-judgments').files[0]))));
  return {sync,buttons,acceptOperation,restorePending,hasUnsaved:()=>local.dirty||local.buffers.size>0,
    updateLinks(){const id=local.set?.id;$('set-download').hidden=!id;if(id)$('set-download').href='/api/relevance/sets/'+encodeURIComponent(id)+'/set.json';},
    openResult};
}
