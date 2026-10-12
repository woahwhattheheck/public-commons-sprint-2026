// MIT. Complete paired scientific review in the original private WQX workspace.
const $=id=>document.getElementById(id),PAGE=40;
const text=value=>value===null||value===undefined?'—':value===''?'(empty)':typeof value==='object'?JSON.stringify(value):String(value);
const metric=value=>value?.display??value?.decimal??text(value);
const make=(tag,value,attributes={})=>{const node=document.createElement(tag);if(value!==undefined)node.textContent=text(value);
  for(const [key,val]of Object.entries(attributes))node.setAttribute(key,String(val));return node;};
const lines=value=>String(value??'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const append=(row,...values)=>{for(const value of values){const cell=make('td');cell.append(value instanceof Node?value:document.createTextNode(text(value)));row.append(cell);}return row;};
function setOptions(element,rows,blank) {
  const selected=element.value;element.replaceChildren(make('option',blank,{value:''}));
  for(const row of rows)element.append(make('option',row.title??row.reviewId,{value:row.reviewId}));
  if(rows.some(row=>row.reviewId===selected))element.value=selected;
}
function pageRows(rows,page,body,render,prefix) {
  const pages=Math.max(1,Math.ceil(rows.length/PAGE)),selected=Math.min(Math.max(page,0),pages-1);
  body.replaceChildren(...rows.slice(selected*PAGE,(selected+1)*PAGE).map(render));
  if(!rows.length){const row=make('tr'),cell=make('td','No matching rows.',{colspan:'8'});row.append(cell);body.append(row);}
  $(prefix+'-page').textContent=rows.length+' rows · page '+(selected+1)+' of '+pages;
  $(prefix+'-prev').disabled=selected===0;$(prefix+'-next').disabled=selected+1===pages;return selected;
}
export function mountStandardizedAnalysis({api,notice,refresh}) {
  let workspace=null,record=null,preview=null,busy=false,dirty=false,groupPage=0,rowPage=0,changePage=0;
  const controls=$('sa-controls');
  function renderState() {
    controls.disabled=busy;$('sa-saved').querySelectorAll('button').forEach(button=>{button.disabled=busy;});
    $('sa-save').disabled=busy||dirty||!preview||Boolean(record?.reviewSha256);
    $('sa-state').textContent=busy?'Working':record?.reviewSha256&&!dirty?'Saved complete review':dirty?'Preview changes':preview?'Preview ready':'Select complete decisions';
    $('sa-selection').textContent=busy?'Reading the complete original source and reviewed quantities.':
      dirty?'These settings have changed. Preview them before saving.':
      record?.reviewSha256?'This scientific review is immutable. Use a new review name for changes.':
      'The selected complete receiving review binds original source values and every explicit unit choice.';
    $('sa-draft-note').textContent=dirty?'Displayed analysis is the previous result. Preview the changed settings to update it.':
      record?.reviewSha256?'Saved complete scientific review. All downloads retain its original source and choices.':'Complete scientific preview. Save it to retain downloads and receiving.';
    $('sa-downloads').hidden=!record?.reviewSha256||dirty;
  }
  async function run(work) {
    if(busy)return;
    busy=true;renderState();
    try{return await work();}catch(error){notice(error.message,true);}finally{busy=false;renderState();}
  }
  function selectedRequest() {
    const decision=(workspace?.reviewSheets??[]).find(row=>row.reviewId===$('sa-decision').value&&row.status==='COMPLETE');
    if(!decision)throw new Error('Select a complete saved receiving decision review.');
    const previous=(workspace?.standardizedReviews??[]).find(row=>row.reviewId===$('sa-previous').value);
    if($('sa-previous').value&&!previous)throw new Error('Refresh the selected previous scientific edition.');
    function window(prefix){const start=$(prefix+'start').value,end=$(prefix+'end').value;
      if(start&&end&&start>end)throw new Error('A scientific period starts after its final date.');return start||end?{start:start||null,end:end||null}:null;}
    return {reviewId:$('sa-id').value,decisionReviewId:decision.reviewId,expectedDecisionReviewSha256:decision.reviewSha256,
      title:$('sa-title').value,note:$('sa-note').value,options:{window:window('sa-'),baselineWindow:window('sa-baseline-'),
        includeEstimated:$('sa-estimated').checked,characteristics:lines($('sa-characteristics').value),siteIds:lines($('sa-sites').value),
        allowedQualifiers:lines($('sa-qualifiers').value)},
      previousReviewId:previous?.reviewId??null,expectedPreviousReviewSha256:previous?.reviewSha256??null};
  }
  function applyRequest(request) {
    $('sa-id').value=request.reviewId;$('sa-title').value=request.title;$('sa-note').value=request.note??'';
    $('sa-decision').value=request.decisionReviewId;$('sa-previous').value=request.previousReviewId??'';
    const options=request.options??{};
    for(const [prefix,window]of [['sa-',options.window],['sa-baseline-',options.baselineWindow]]) {
      $(prefix+'start').value=window?.start??'';$(prefix+'end').value=window?.end??'';
    }
    $('sa-estimated').checked=options.includeEstimated===true;
    $('sa-characteristics').value=(options.characteristics??[]).join('\n');$('sa-sites').value=(options.siteIds??[]).join('\n');
    $('sa-qualifiers').value=(options.allowedQualifiers??[]).join('\n');
  }
  function counts(parent,values) {
    parent.replaceChildren(...Object.entries(values).map(([label,value])=>{const item=make('div');item.append(make('span',label),make('strong',value));return item;}));
  }
  function groups() {
    if(!record?.analysis)return;
    const representation=$('sa-group-representation').value,analysis=record.analysis,rows=analysis[representation].groups;
    groupPage=pageRows(rows,groupPage,$('sa-groups'),group=>{
      const row=make('tr'),d=group.dimensions,s=group.summary,link=analysis.groups.find(x=>x.reportingGroupId===group.id);
      return append(row,d.characteristic+' / '+text(d.locationId),[d.methodIdentifier,d.methodContext].filter(Boolean).join(' / '),d.unit,s.count,
        metric(s.mean),metric(s.min)+' / '+metric(s.max),representation==='reviewed'?link?.sourceGroups.map(x=>text(x.unit)+' ('+x.count+')').join('; '):'Original');
    },'sa-groups');
  }
  function observations() {
    if(!record?.analysis)return;
    const query=$('sa-search').value.trim().toLowerCase(),filter=$('sa-row-filter').value;
    const rows=record.analysis.observations.filter(row=>{
      if(query&&![row.id,row.characteristic,row.locationId,row.locationName,row.resultId].some(value=>String(value??'').toLowerCase().includes(query)))return false;
      return filter==='all'||filter==='converted'&&row.reporting.conversion||filter==='censored'&&row.analysis.censoring!=='none'||
        filter==='qualified'&&row.analysis.qualified||filter==='included'&&row.reporting.analysis.included||
        filter==='excluded'&&!row.reporting.analysis.included;
    });
    rowPage=pageRows(rows,rowPage,$('sa-observations'),row=>{
      const button=make('button','Open result',{type:'button'});
      button.addEventListener('click',()=>{$('sa-row-detail').hidden=false;$('sa-row-detail').open=true;$('sa-row-json').textContent=JSON.stringify(row,null,2);});
      return append(make('tr'),row.date+' / '+text(row.locationId),row.characteristic,text(row.value)+' '+text(row.unit),
        text(row.reporting.value)+' '+text(row.reporting.unit),row.analysis.classification+' / '+(row.reporting.analysis.included?'included':text(row.reporting.analysis.exclusion)),
        (row.limits??[]).length+' original / '+(row.reporting.limits??[]).length+' reporting',button);
    },'sa-rows');
  }
  function period() {
    const rows=record?.analysis?.reviewed?.comparison??[];$('sa-period').hidden=!rows.length;
    $('sa-period-rows').replaceChildren(...rows.map(row=>append(make('tr'),row.label,row.dimensions.unit,row.currentCount+' / '+row.baselineCount,
      metric(row.currentMean)+' / '+metric(row.baselineMean),row.comparable?metric(row.change)+' '+text(row.changeUnit):row.reason,
      row.percentChange?metric(row.percentChange)+'%':row.relativeChangeReason??'—')));
  }
  function comparisons() {
    const comparison=record?.comparison;$('sa-comparison').hidden=!comparison;if(!comparison)return;
    $('sa-comparison-options').textContent='Previous edition: '+record.previous.reviewId+'. '+(comparison.optionsEquivalent?'The scientific selections match.':'Scientific selections differ; both are retained in the complete report.');
    counts($('sa-change-counts'),{'Added':comparison.counts.added,'Removed':comparison.counts.removed,'Source changed':comparison.counts.sourceChanged,
      'Choices changed':comparison.counts.choiceChanged,'Representation changed':comparison.counts.representationChanged,'Ambiguous':comparison.counts.ambiguous});
    changePage=pageRows(comparison.rows,changePage,$('sa-changes'),row=>append(make('tr'),row.resultKey,row.sourceChanged??row.status,
      row.choiceChanged??'—',row.representationChanged??'—',(row.changedSourceParts??[]).join(', ')),'sa-changes');
  }
  function render() {
    $('sa-output').hidden=!record;if(!record){renderState();return;}
    const analysis=record.analysis,i=analysis.inventory;
    $('sa-output-title').textContent=record.request.title;$('sa-result-state').textContent=record.reviewSha256?'Saved':'Preview';
    counts($('sa-metrics'),{'Selected results':i.selectedRows,'Original reported limits':i.selectedReportedLimits,'Reviewed quantities':i.convertedResults,
      'Reporting limits converted':i.convertedReportedLimits,'Arithmetic results':i.arithmeticRows,'Censored':i.censored,'Qualified':i.qualified,'Source-labelled estimates':i.estimated});
    $('sa-identities').textContent=JSON.stringify({reviewId:record.request.reviewId,reviewSha256:record.reviewSha256??null,
      analysisSha256:analysis.analysisSha256,decision:record.decision,options:analysis.options,previous:record.previous?{reviewId:record.previous.reviewId,reviewSha256:record.previous.reviewSha256}:null},null,2);
    $('sa-downloads').replaceChildren(...(record.files??[]).map(file=>make('a',file.format,{class:'download',
      href:'/api/standardized-analysis/'+encodeURIComponent(record.reviewId)+'/'+file.format,download:file.filename})));
    groups();observations();period();comparisons();renderState();
  }
  function accept(value) {
    record=value;preview=value.reviewSha256?null:value;dirty=false;groupPage=0;rowPage=0;changePage=0;
    applyRequest(value.request);$('sa-row-detail').hidden=true;render();
  }
  function changed() {if(busy)return;dirty=true;preview=null;renderState();}
  function savedList() {
    const rows=workspace?.standardizedReviews??[];
    $('sa-saved').replaceChildren(...rows.map(row=>{
      const element=make('div',undefined,{class:'record'}),open=make('button','Open scientific review',{type:'button'});
      open.disabled=busy;open.addEventListener('click',()=>run(async()=>{
        const value=await api('/api/standardized-analysis/'+encodeURIComponent(row.reviewId));
        if(value.reviewSha256!==row.reviewSha256)throw new Error('This scientific edition changed. Refresh the saved list.');
        accept(value);notice('Complete scientific review reopened.');
      }));
      element.append(make('strong',row.title),make('p',row.reviewId+' · '+row.inventory.selectedRows+' results · '+row.inventory.convertedResults+' reviewed quantities'),open);return element;
    }));
  }
  $('sa-form').addEventListener('input',changed);$('sa-form').addEventListener('change',changed);
  $('sa-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    const request=selectedRequest(),result=await api('/api/standardized-analysis/preview',request);
    if(result.request.reviewId!==request.reviewId)throw new Error('The returned scientific preview belongs to another request.');
    accept(result);notice('Complete scientific preview is ready to save.');
  });});
  $('sa-save').addEventListener('click',()=>run(async()=>{
    if(!preview||dirty)throw new Error('Preview the current scientific settings before saving.');
    const selected=preview,result=await api('/api/standardized-analysis',{...selected.request,expectedPreviewSha256:selected.previewSha256});
    accept(result);await refresh();notice('Complete scientific review saved as '+result.reviewId+'.');
  }));
  $('sa-new').addEventListener('click',()=>{
    if(busy)return;record=record?{...record,reviewSha256:undefined,files:undefined}:null;preview=null;dirty=true;
    $('sa-id').value='';$('sa-id').focus();renderState();
  });
  $('sa-receive-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    const file=$('sa-receive-file').files[0];if(!file)throw new Error('Select the complete scientific review bundle.');
    if(file.size>128*1024*1024)throw new Error('This complete scientific bundle exceeds 128 MiB.');
    const bundle=JSON.parse(await file.text()),result=await api('/api/standardized-analysis/receive',{bundle});
    await refresh();accept(result);notice('Both selected source editions and the complete scientific review reopened.');
  });});
  $('sa-search').addEventListener('input',()=>{rowPage=0;observations();});
  $('sa-row-filter').addEventListener('change',()=>{rowPage=0;observations();});
  $('sa-group-representation').addEventListener('change',()=>{groupPage=0;groups();});
  for(const [prefix,renderPage,get,set]of [['sa-groups',groups,()=>groupPage,value=>groupPage=value],
    ['sa-rows',observations,()=>rowPage,value=>rowPage=value],['sa-changes',comparisons,()=>changePage,value=>changePage=value]])
    for(const [suffix,delta]of [['prev',-1],['next',1]])$(prefix+'-'+suffix).addEventListener('click',()=>{set(get()+delta);renderPage();});
  return {update(value) {
    workspace=value;setOptions($('sa-decision'),(value.reviewSheets??[]).filter(row=>row.status==='COMPLETE'),'Select saved decisions');
    setOptions($('sa-previous'),value.standardizedReviews??[],'No previous edition');savedList();renderState();
  },open(value){if(busy)throw new Error('Wait for the current scientific operation to finish.');accept(value);}};
}
