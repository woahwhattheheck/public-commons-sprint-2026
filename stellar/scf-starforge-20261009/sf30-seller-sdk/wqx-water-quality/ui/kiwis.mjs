// MIT. Original private workspace controls for complete KiWIS commissioning.
const $=id=>document.getElementById(id);
const element=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,String(v));return node;};
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const canonical=value=>JSON.stringify(ordered(value));
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const byteHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const pathValue=(value,path)=>{for(const part of path.slice(1).split('/')){const key=part.replace(/~1/g,'/').replace(/~0/g,'~');if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return undefined;value=value[key];}return value;};
const paths=(value,prefix='')=>value===null||typeof value!=='object'?[prefix]:Object.entries(value).flatMap(([key,item])=>paths(item,prefix+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1')));
const download=(filename,value,mime='application/json')=>{const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'],{type:mime})),link=element('a','',{href:url,download:filename});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const options=(select,rows,chosen)=>{select.replaceChildren();for(const[value,label]of rows)select.append(element('option',label,{value}));if(chosen!==undefined)select.value=chosen;};
const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
const stale=()=>Object.assign(Error('A later source selection superseded this view request.'),{code:'KIWIS_VIEW_CHANGED'});
export function mountKiWIS({api,notice}){
  let inventory={sources:[],reviews:[]},source=null,sourceId=null,choices=null,preview=null,page=0,selectedRecord=null,comparison=null,fields=[],filtered=[];
  let generation=0,navigation=0,loading=null,revision=0,refreshSequence=0,comparisonSequence=0,savedReviewId=null,comparisonPage=0;
  let edits=Promise.resolve(),pendingEdits=0,activeCapture=null,sourceReceiving=false,bundleReceiving=false;
  const action=fn=>async event=>{event?.preventDefault();try{await fn(event);}catch(error){if(error.code!=='KIWIS_VIEW_CHANGED')notice(error.message,true);}};
  const draftState=element('p','',{id:'kiwis-draft-state',role:'status'});$('kiwis-save-form').before(draftState);
  const snapshot=()=>({generation,navigation,revision});
  const sameView=value=>value.generation===generation&&value.navigation===navigation&&value.revision===revision;
  function requireSource(){if(!source||!choices)throw Error('Open a complete original source pair.');}
  function controls(){
    const busy=pendingEdits>0||loading!==null;
    for(const id of ['kiwis-mapping-form','kiwis-quality-form','kiwis-time-form','kiwis-save-form','kiwis-records','kiwis-compare-form'])
      for(const node of $(id).querySelectorAll('input,select,textarea,button'))node.disabled=busy;
    for(const id of ['kiwis-mapping-series','kiwis-link-unique','kiwis-separate','kiwis-decisions-file'])$(id).disabled=busy;
    $('kiwis-adopt-comparison').disabled=busy||!comparison;
    for(const node of $('kiwis-source-form').querySelectorAll('input,select,textarea,button'))node.disabled=sourceReceiving;
    for(const node of $('kiwis-receive-form').querySelectorAll('input,select,textarea,button'))node.disabled=bundleReceiving;
    for(const node of $('kiwis-capture-form').querySelectorAll('input,select,textarea,button'))
      if(node.id!=='kiwis-capture-cancel')node.disabled=Boolean(activeCapture);
    $('kiwis-capture-cancel').disabled=!activeCapture;
    draftState.textContent=loading!==null?'Opening the selected complete source; the current validated draft is retained.':
      pendingEdits?'Validating the selected changes; the current complete draft is retained.':
      savedReviewId?'Saved edition '+savedReviewId+'. Changing decisions creates a new draft with a new review name.':
      source?'Editable draft for '+sourceId+'. Save a new review name to retain this complete edition.':'';
    $('kiwis-compare-state').textContent=savedReviewId?'Compare saved edition '+savedReviewId+' with the earlier saved review, including all decision changes.':
      source?'Compare this source with the earlier saved review. Save the current draft to include its decision changes.':'';
    timeMode();
  }
  async function refresh(){
    const selected=++refreshSequence,next=await api('/api/kiwis');
    if(selected!==refreshSequence)return;
    inventory=next;const chosen=$('kiwis-source').value;
    options($('kiwis-source'),[['','Choose an edition'],...inventory.sources.map(item=>[item.sourceId,item.sourceId+' · '+item.counterpart])],
      inventory.sources.some(item=>item.sourceId===chosen)?chosen:sourceId??'');
    for(const id of ['kiwis-review','kiwis-previous-review']){
      const value=$(id).value;options($(id),[['','Choose a review'],...inventory.reviews.map(item=>[item.reviewId,item.title+' · '+item.reviewId])],value);
    }
  }
  function markDraftChanged(){
    if(savedReviewId&&$('kiwis-save-id').value===savedReviewId)$('kiwis-save-id').value='';
    savedReviewId=null;$('kiwis-downloads').replaceChildren();comparison=null;$('kiwis-comparison').hidden=true;revision++;
  }
  function counts(){
    $('kiwis-counts').replaceChildren(...Object.entries(preview.counts).map(([key,value])=>{
      const node=element('div');node.append(element('strong',value),element('span',key));return node;}));
  }
  function enqueue(work){
    requireSource();if(loading!==null)throw Error('Wait for the selected source to open before changing its decisions.');
    const expected=generation;pendingEdits++;controls();
    const result=edits.catch(()=>{}).then(async()=>{
      if(expected!==generation)throw stale();
      try{return await work({generation:expected,source,sourceId});}
      catch(error){if(expected!==generation)throw stale();throw error;}
    });
    edits=result.catch(()=>{});
    return result.finally(()=>{pendingEdits--;controls();});
  }
  function changeDraft(prepare){
    return enqueue(async context=>{
      const candidate=clone(choices),prepared=await prepare(candidate,context),next=prepared??candidate;
      if(context.generation!==generation)throw stale();
      const result=await api('/api/kiwis/preview',{sourceId:context.sourceId,document:next});
      if(context.generation!==generation)throw stale();
      if(result.sourceSha256!==context.source.sourceSha256)throw Error('The returned preview belongs to another source edition.');
      const changed=canonical(result.document)!==canonical(choices);
      choices=result.document;preview=result;if(changed)markDraftChanged();counts();render();controls();return result;
    });
  }
  async function navigate(select){
    const request=++navigation,expected=++generation;loading=request;comparisonSequence++;controls();
    try{
      const selection=await select();if(request!==navigation)throw stale();
      if(!selection.id)throw Error('Choose a retained complete source edition.');
      const received=await api('/api/kiwis/source/'+encodeURIComponent(selection.id));if(request!==navigation)throw stale();
      const nextSource=received.source,nextDocument=selection.document??{schema:'starforge.kiwis-commissioning-decisions.v1',
        sourceSha256:nextSource.sourceSha256,profiles:[],times:[],correspondences:[],quality:[]};
      const nextPreview=await api('/api/kiwis/preview',{sourceId:selection.id,document:nextDocument});
      if(request!==navigation||expected!==generation)throw stale();
      if(nextPreview.sourceSha256!==nextSource.sourceSha256)throw Error('The returned preview differs from the selected original source.');
      if(selection.saved&&canonical(nextPreview)!==canonical(selection.saved.review))
        throw Error('The saved commissioning review does not reproduce this source edition.');
      source=nextSource;sourceId=selection.id;choices=nextPreview.document;preview=nextPreview;
      revision++;page=0;comparison=null;selectedRecord=null;savedReviewId=selection.saved?.reviewId??null;
      $('kiwis-record-detail').hidden=true;$('kiwis-comparison').hidden=true;$('kiwis-editor').hidden=false;$('kiwis-source').value=sourceId;
      $('kiwis-downloads').replaceChildren();
      fields=[...new Set(source.counterpart.records.flatMap(row=>paths(row.fields)))].sort();
      for(const id of ['kiwis-station-path','kiwis-parameter-path','kiwis-time-path','kiwis-date-path','kiwis-clock-path','kiwis-offset-path','kiwis-native-key','kiwis-time-decision-path'])
        options($(id),fields.map(path=>[path,path]));
      options($('kiwis-mapping-series'),source.kiwis.series.map(series=>{
        const metadata=series.returned.find(item=>item.metadata)?.metadata;
        return [series.seriesId,series.tsId+' · '+(metadata?.station_name??metadata?.ts_name??'Original selected series')];
      }));
      $('kiwis-inventory').replaceChildren(element('p',source.kiwis.observations.length+' observations · '+
        source.counterpart.records.length+' native records · '+source.kiwis.series.length+' selected series'));
      if(selection.saved){
        $('kiwis-save-id').value=selection.saved.reviewId;$('kiwis-save-title').value=selection.saved.title;links(selection.saved.reviewId);
      }else $('kiwis-save-id').value='';
      showSeries();refreshValues();counts();render();return true;
    }catch(error){if(request!==navigation)throw stale();throw error;}
    finally{if(loading===request)loading=null;controls();}
  }
  const openSource=(id,documentValue)=>navigate(async()=>({id,document:documentValue}));
  const openSaved=saved=>navigate(async()=>({id:saved.sourceId,document:saved.review.document,saved}));
  function refreshValues(){
    if(!source)return;
    for(const kind of ['station','parameter']){
      const path=$('kiwis-'+kind+'-path').value,values=[...new Set(source.counterpart.records.map(row=>pathValue(row.fields,path)).filter(value=>typeof value==='string'))].sort();
      $('kiwis-'+kind+'-options').replaceChildren(...values.map(value=>element('option',undefined,{value})));
    }
  }
  function timeMode(){
    const separate=$('kiwis-time-mode').value==='separate';$('kiwis-single-time').hidden=separate;$('kiwis-separate-time').hidden=!separate;
    const field=$('kiwis-offset-mode').value==='field';$('kiwis-fixed-offset').disabled=pendingEdits>0||loading!==null||field;
    $('kiwis-offset-path').disabled=pendingEdits>0||loading!==null||!field;
  }
  function showQuality(){
    const value=choices?.quality.find(item=>item.seriesId===$('kiwis-mapping-series').value&&item.code===$('kiwis-quality-code').value);
    $('kiwis-quality-action').value=value?.action??'retain';$('kiwis-quality-reason').value=value?.reason??'';
  }
  function showSeries(){
    if(!source)return;const series=source.kiwis.series.find(item=>item.seriesId===$('kiwis-mapping-series').value);
    $('kiwis-original-metadata').textContent=JSON.stringify({series,qualityCodes:source.kiwis.qualityCodes,releaseStateClasses:source.kiwis.releaseStateClasses},null,2);
    const quality=[...new Set(source.kiwis.observations.filter(row=>row.seriesId===series?.seriesId).map(row=>row.quality))].filter(value=>typeof value==='string').sort();
    options($('kiwis-quality-code'),quality.map(value=>[value,value===''?'(blank original code)':value]));
    $('kiwis-quality-form').hidden=!quality.length;showQuality();
    const profile=choices.profiles.find(item=>item.seriesId===series?.seriesId);
    for(const id of ['kiwis-station-value','kiwis-parameter-value','kiwis-mapping-reason','kiwis-fixed-offset'])$(id).value='';
    for(const option of $('kiwis-native-key').options)option.selected=false;
    $('kiwis-time-mode').value='single';$('kiwis-offset-mode').value='fixed';$('kiwis-window').value='0';
    if(profile){
      $('kiwis-station-path').value=profile.station.path;$('kiwis-station-value').value=profile.station.value;
      $('kiwis-parameter-path').value=profile.parameter.path;$('kiwis-parameter-value').value=profile.parameter.value;
      if(profile.timestamp.path){$('kiwis-time-path').value=profile.timestamp.path;$('kiwis-time-mode').value='single';}
      else{
        $('kiwis-time-mode').value='separate';$('kiwis-date-path').value=profile.timestamp.datePath;$('kiwis-clock-path').value=profile.timestamp.timePath;
        $('kiwis-offset-mode').value=profile.timestamp.offsetPath?'field':'fixed';$('kiwis-offset-path').value=profile.timestamp.offsetPath??'';
        $('kiwis-fixed-offset').value=profile.timestamp.offset??'';
      }
      $('kiwis-window').value=profile.windowSeconds;$('kiwis-mapping-reason').value=profile.reason;
      for(const option of $('kiwis-native-key').options)option.selected=profile.nativeKey.includes(option.value);
    }
    timeMode();refreshValues();
  }
  function renderDetail(){
    if(!selectedRecord||!source||!preview)return;
    const original=source.counterpart.records.find(row=>row.recordId===selectedRecord),row=preview.records.find(item=>item.recordId===selectedRecord);
    if(!original||!row){selectedRecord=null;$('kiwis-record-detail').hidden=true;return;}
    $('kiwis-record-source').textContent=JSON.stringify({original,correspondence:row},null,2);
  }
  function render(){
    if(!preview)return;
    const query=$('kiwis-search').value.toLowerCase(),status=$('kiwis-status-filter').value,
      originals=new Map(source.counterpart.records.map(row=>[row.recordId,row])),renderedGeneration=generation;
    filtered=preview.records.filter(row=>(status==='all'||status==='ambiguous'&&row.candidates.length>1||row.status===status)&&
      (!query||JSON.stringify(originals.get(row.recordId)).toLowerCase().includes(query)));
    page=Math.min(Math.max(page,0),Math.max(0,Math.ceil(filtered.length/40)-1));const list=filtered.slice(page*40,page*40+40);
    $('kiwis-records').replaceChildren();
    for(const row of list){
      const original=originals.get(row.recordId),tr=element('tr'),record=element('td'),value=element('td'),choiceCell=element('td'),reasonCell=element('td'),detail=element('td');
      record.append(element('code',row.recordId),element('p',row.status.replace(/_/g,' ')));
      if(row.reviewReason)record.append(element('p',row.reviewReason));value.textContent=JSON.stringify(original.fields).slice(0,320);
      const select=element('select',undefined,{'aria-label':'Correspondence '+row.recordId});
      const candidates=row.candidates.map(candidate=>[candidate.observationId,candidate.tsId+' · '+candidate.timestamp+' · '+
        String(candidate.value??'(blank)')+' · quality '+String(candidate.quality??'(absent)')]);
      if(row.choice?.action==='link'&&!row.candidates.some(candidate=>candidate.observationId===row.choice.observationId))
        candidates.unshift([row.choice.observationId,'Earlier selected observation · review required']);
      options(select,[['','Unresolved'],['SEPARATE','Keep separate'],...candidates],row.choice?.action==='separate'?'SEPARATE':row.choice?.observationId??'');
      const reason=element('input',undefined,{'aria-label':'Reason '+row.recordId});reason.value=row.choice?.reason??'';
      const apply=element('button','Apply',{type:'button'});
      apply.addEventListener('click',action(async()=>{
        if(renderedGeneration!==generation)throw stale();
        const selected=select.value,why=reason.value;
        if(selected&&!why.trim())throw Error('Record a reason for the correspondence.');
        const candidate=row.candidates.find(item=>item.observationId===selected);
        const observationSha256=candidate?.observationSha256??(row.choice?.observationId===selected?row.choice.observationSha256:undefined);
        await changeDraft(next=>{
          next.correspondences=next.correspondences.filter(item=>item.recordId!==row.recordId);
          if(selected)next.correspondences.push({recordId:row.recordId,rowSha256:row.rowSha256,action:selected==='SEPARATE'?'separate':'link',
            ...(selected!=='SEPARATE'?{observationId:selected,observationSha256}:{}),reason:why});
        });
      }));
      choiceCell.append(select);reasonCell.append(reason,apply);
      const inspect=element('button','Open original',{type:'button'});
      inspect.addEventListener('click',()=>{
        if(renderedGeneration!==generation)return;
        selectedRecord=original.recordId;$('kiwis-record-detail').hidden=false;$('kiwis-record-detail').open=true;
        options($('kiwis-time-decision-path'),paths(original.fields).map(path=>[path,path]));
        $('kiwis-time-instant').value='';$('kiwis-time-reason').value='';renderDetail();
      });
      detail.append(inspect);tr.append(record,value,choiceCell,reasonCell,detail);$('kiwis-records').append(tr);
    }
    $('kiwis-page').textContent=filtered.length?(page*40+1)+'–'+Math.min(filtered.length,(page+1)*40)+' of '+filtered.length:'No records';
    $('kiwis-previous').disabled=page===0;$('kiwis-next').disabled=(page+1)*40>=filtered.length;renderDetail();controls();
  }
  function links(reviewId){
    $('kiwis-downloads').replaceChildren(...['bundle','report','decisions','observations','counterparts','correspondences','series','review'].map(format=>
      element('a',format==='bundle'?'Complete project bundle':format,{href:'/api/kiwis/review/'+encodeURIComponent(reviewId)+'/'+format,download:''})));
  }
  $('kiwis-refresh').addEventListener('click',action(refresh));
  $('kiwis-open-source').addEventListener('click',action(()=>openSource($('kiwis-source').value)));
  $('kiwis-open-review').addEventListener('click',action(async()=>{
    const id=$('kiwis-review').value;
    await navigate(async()=>{if(!id)throw Error('Choose a saved commissioning review.');const saved=await api('/api/kiwis/review/'+encodeURIComponent(id));
      return {id:saved.sourceId,document:saved.review.document,saved};});
  }));
  $('kiwis-mapping-series').addEventListener('change',showSeries);
  $('kiwis-time-mode').addEventListener('change',timeMode);$('kiwis-offset-mode').addEventListener('change',timeMode);
  for(const kind of ['station','parameter'])$('kiwis-'+kind+'-path').addEventListener('change',refreshValues);
  $('kiwis-quality-code').addEventListener('change',showQuality);
  $('kiwis-mapping-form').addEventListener('submit',action(async()=>{
    requireSource();const seriesId=$('kiwis-mapping-series').value;
    const timestamp=$('kiwis-time-mode').value==='single'?{path:$('kiwis-time-path').value}:
      {datePath:$('kiwis-date-path').value,timePath:$('kiwis-clock-path').value,
        ...($('kiwis-offset-mode').value==='field'?{offsetPath:$('kiwis-offset-path').value}:{offset:$('kiwis-fixed-offset').value})};
    const fields={station:{path:$('kiwis-station-path').value,value:$('kiwis-station-value').value},
      parameter:{path:$('kiwis-parameter-path').value,value:$('kiwis-parameter-value').value},timestamp,
      nativeKey:[...$('kiwis-native-key').selectedOptions].map(option=>option.value),windowSeconds:Number($('kiwis-window').value),reason:$('kiwis-mapping-reason').value};
    await changeDraft(async(next,context)=>{
      const series=context.source.kiwis.series.find(item=>item.seriesId===seriesId);
      if(!series)throw Error('Select an original programme time series.');
      const profile={seriesId,seriesSha256:await hash(series),...fields};
      next.profiles=next.profiles.filter(item=>item.seriesId!==seriesId);next.profiles.push(profile);
    });
    notice('Validated the draft station, parameter and time mapping.');
  }));
  $('kiwis-quality-form').addEventListener('submit',action(async()=>{
    requireSource();const selected={seriesId:$('kiwis-mapping-series').value,code:$('kiwis-quality-code').value,
      action:$('kiwis-quality-action').value,reason:$('kiwis-quality-reason').value};
    await changeDraft(next=>{next.quality=next.quality.filter(item=>item.seriesId!==selected.seriesId||item.code!==selected.code);next.quality.push(selected);});
  }));
  $('kiwis-time-form').addEventListener('submit',action(async()=>{
    requireSource();const original=source.counterpart.records.find(row=>row.recordId===selectedRecord);
    if(!original)throw Error('Open an original record first.');
    const path=$('kiwis-time-decision-path').value,selected={recordId:original.recordId,rowSha256:original.rowSha256,path,
      before:pathValue(original.fields,path),instant:$('kiwis-time-instant').value,reason:$('kiwis-time-reason').value};
    await changeDraft(next=>{next.times=next.times.filter(item=>item.recordId!==selected.recordId||item.path!==path);next.times.push(selected);});
  }));
  for(const id of ['kiwis-search','kiwis-status-filter'])$(id).addEventListener('input',()=>{page=0;render();});
  $('kiwis-previous').addEventListener('click',()=>{page--;render();});$('kiwis-next').addEventListener('click',()=>{page++;render();});
  for(const[id,mode]of [['kiwis-link-unique','link'],['kiwis-separate','separate']])$(id).addEventListener('click',action(async()=>{
    requireSource();const reason=$('kiwis-batch-reason').value.trim();if(!reason)throw Error('Enter a reason for this batch decision.');
    const selectedRows=filtered.filter(row=>mode==='separate'||row.candidates.length===1).map(row=>clone(row)),ids=new Set(selectedRows.map(row=>row.recordId));
    await changeDraft(next=>{
      next.correspondences=next.correspondences.filter(item=>!ids.has(item.recordId));
      for(const row of selectedRows){const candidate=row.candidates[0];next.correspondences.push({recordId:row.recordId,rowSha256:row.rowSha256,action:mode,
        ...(mode==='link'?{observationId:candidate.observationId,observationSha256:candidate.observationSha256}:{}),reason});}
    });notice('Applied the explicit batch decision to '+selectedRows.length+' filtered records.');
  }));
  $('kiwis-save-form').addEventListener('submit',action(async()=>{
    const reviewId=$('kiwis-save-id').value,title=$('kiwis-save-title').value;
    await enqueue(async context=>{
      const document=clone(choices),fresh=await api('/api/kiwis/preview',{sourceId:context.sourceId,document});
      if(context.generation!==generation)throw stale();
      const saved=await api('/api/kiwis/reviews',{sourceId:context.sourceId,reviewId,title,document:fresh.document,expectedReviewSha256:fresh.reviewSha256});
      if(context.generation===generation){
        if(canonical(saved.review)!==canonical(fresh))throw Error('The saved review differs from the exact preview.');
        choices=fresh.document;preview=fresh;savedReviewId=saved.reviewId;
        $('kiwis-save-id').value=saved.reviewId;$('kiwis-save-title').value=saved.title;links(saved.reviewId);counts();render();
      }
      await refresh();notice('Saved the complete commissioning edition '+saved.reviewId+'.');
    });
  }));
  $('kiwis-download-decisions').addEventListener('click',action(()=>{requireSource();download(sourceId+'-editable-decisions.json',choices);}));
  $('kiwis-decisions-file').addEventListener('change',action(async()=>{
    requireSource();const file=$('kiwis-decisions-file').files[0];
    if(file){try{await changeDraft(async()=>JSON.parse(await file.text()));}finally{$('kiwis-decisions-file').value='';}}
  }));
  function renderComparison(){
    const review=comparison?.reviewComparison;
    $('kiwis-review-difference').hidden=!review;if(!review)return;
    const status=$('kiwis-comparison-filter').value,search=$('kiwis-comparison-search').value.toLowerCase(),
      rows=review.records.filter(row=>(!status||row.status===status)&&(!search||
        [row.previousRecordId,row.currentRecordId,row.before?.status,row.after?.status,...row.changedFields].join(' ').toLowerCase().includes(search))),
      pages=Math.max(1,Math.ceil(rows.length/40));
    comparisonPage=Math.max(0,Math.min(comparisonPage,pages-1));
    const body=$('kiwis-comparison-records');body.replaceChildren();
    for(const row of rows.slice(comparisonPage*40,(comparisonPage+1)*40)){
      const tr=element('tr');
      for(const value of [row.previousRecordId===row.currentRecordId?row.currentRecordId:
        (row.previousRecordId??'Absent')+' → '+(row.currentRecordId??'Absent'),row.before?.status??'Absent',
        row.after?.status??'Absent',row.changedFields.join(', ')||row.sourceMatch.reason])tr.append(element('td',value));
      const cell=element('td'),button=element('button','Open decision difference',{type:'button'});
      button.addEventListener('click',()=>{$('kiwis-comparison-record-detail').textContent=JSON.stringify(row,null,2);
        $('kiwis-comparison-record-detail').hidden=false;});
      cell.append(button);tr.append(cell);body.append(tr);
    }
    $('kiwis-comparison-page').textContent=rows.length+' records · Page '+(comparisonPage+1)+' of '+pages;
    $('kiwis-comparison-prev').disabled=comparisonPage===0;$('kiwis-comparison-next').disabled=comparisonPage>=pages-1;
  }
  for(const id of ['kiwis-comparison-filter','kiwis-comparison-search'])$(id).addEventListener('input',()=>{comparisonPage=0;renderComparison();});
  $('kiwis-comparison-prev').addEventListener('click',()=>{comparisonPage--;renderComparison();});
  $('kiwis-comparison-next').addEventListener('click',()=>{comparisonPage++;renderComparison();});
  $('kiwis-comparison-download').addEventListener('click',action(async()=>{
    if(!comparison)throw Error('Compare the selected editions first.');
    download((comparison.reviewComparison?.current.reviewId??sourceId)+'-complete-edition-comparison.json',comparison);
  }));
  $('kiwis-compare-form').addEventListener('submit',action(async()=>{
    requireSource();if(pendingEdits||loading!==null)throw Error('Wait for the current review to finish opening or validating.');
    const view=snapshot(),request=++comparisonSequence,id=sourceId,reviewId=savedReviewId,
      previousReviewId=$('kiwis-previous-review').value;
    if(!previousReviewId)throw Error('Select the earlier saved review.');
    const result=await api('/api/kiwis/compare',{sourceId:id,previousReviewId,...(reviewId?{reviewId}:{})});
    if(!sameView(view)||request!==comparisonSequence||savedReviewId!==reviewId)throw stale();
    if(result.currentSourceSha256!==source.sourceSha256||reviewId&&result.reviewComparison?.current.reviewId!==reviewId)
      throw Error('The comparison belongs to another complete source or saved review.');
    comparison=result;comparisonPage=0;const summary={};
    for(const row of comparison.changes){const key=row.kind+'/'+row.status;summary[key]=(summary[key]??0)+1;}
    const review=comparison.reviewComparison;
    $('kiwis-comparison-summary').textContent=JSON.stringify({
      mode:review?'Saved review decisions and source editions':'Source editions',
      ...(review?{previousReviewId:review.previous.reviewId,currentReviewId:review.current.reviewId,
        sameSource:review.sameSource,previousCounts:review.previous.counts,currentCounts:review.current.counts,countDelta:review.countDelta,
        reviewCoverage:review.coverage,statusTransitions:review.statusTransitions,
        decisionChanges:Object.fromEntries(Object.entries(review.decisionChanges).map(([name,{entries,...counts}])=>[name,counts]))}:{}),
      sourceChanges:summary,proposedCorrespondences:comparison.proposedDocument.correspondences.length,
      qualityCataloguesChanged:comparison.qualityCataloguesChanged,counterpartProfileChanged:comparison.counterpartProfileChanged??false,
      counterpartCoverage:comparison.counterpartCoverage??null},null,2);
    $('kiwis-comparison-record-detail').hidden=true;$('kiwis-comparison-filter').value='';$('kiwis-comparison-search').value='';
    $('kiwis-comparison').hidden=false;renderComparison();controls();download((reviewId??id)+'-complete-edition-comparison.json',comparison);
  }));
  $('kiwis-adopt-comparison').addEventListener('click',action(async()=>{
    requireSource();if(!comparison||comparison.currentSourceSha256!==source.sourceSha256)throw Error('Compare the original source editions first.');
    const document=clone(comparison.proposedDocument);await changeDraft(()=>document);
  }));
  $('kiwis-source-form').addEventListener('submit',action(async()=>{
    if(sourceReceiving)throw Error('This source pair is already being received.');
    const file=$('kiwis-counterpart-file').files[0],kind=$('kiwis-counterpart-kind').value,id=$('kiwis-source-id').value,
      captureFile=$('kiwis-capture-file').files[0],captureId=$('kiwis-retained-capture').value||undefined,view=snapshot();
    if(!file)throw Error('Select the complete companion result.');
    if(captureFile&&captureId)throw Error('Select one complete capture file or retained capture name.');
    sourceReceiving=true;controls();
    try{
      let counterpart;
      if(kind==='lab-edd-result'){const bytes=new Uint8Array(await file.arrayBuffer());counterpart={kind,bytes:bytes.length,sha256:await byteHash(bytes),base64:base64(bytes)};}
      else if(kind==='kiwis-wqm')counterpart={kind,response:JSON.parse(await file.text())};
      else counterpart={kind,bundle:JSON.parse(await file.text())};
      const capture=captureFile?JSON.parse(await captureFile.text()):undefined;
      const saved=await api('/api/kiwis/sources',{sourceId:id,capture,captureId,counterpart});
      if(sameView(view))await openSource(saved.sourceId);
      await refresh();notice('Received both complete original sources as '+saved.sourceId+'.');
    }finally{sourceReceiving=false;controls();}
  }));
  $('kiwis-receive-form').addEventListener('submit',action(async()=>{
    if(bundleReceiving)throw Error('This complete commissioning project is already being received.');
    const file=$('kiwis-receive-file').files[0],view=snapshot();if(!file)throw Error('Choose the complete project bundle.');
    bundleReceiving=true;controls();
    try{
      const saved=await api('/api/kiwis/receive',{bundle:JSON.parse(await file.text())});
      if(sameView(view))await openSaved(saved);
      await refresh();notice('Received and reopened the complete commissioning project '+saved.reviewId+'.');
    }finally{bundleReceiving=false;controls();}
  }));
  $('kiwis-capture-cancel').addEventListener('click',action(async()=>{
    const selected=activeCapture;if(!selected)throw Error('No source capture is running in this view.');
    await selected.start;if(activeCapture!==selected)return;
    const result=await api('/api/kiwis/capture/'+encodeURIComponent(selected.id)+'/cancel',{});
    if(activeCapture===selected)$('kiwis-capture-status').textContent=result.stopping?
      'Stopping '+selected.id+' after its retained requests.':'The original capture is already complete or stopped; its retained requests remain available.';
  }));
  $('kiwis-capture-form').addEventListener('submit',action(async()=>{
    if(activeCapture)throw Error('The original source capture is still running.');
    const id=$('kiwis-capture-id').value,datasource=$('kiwis-datasource').value,
      selection={endpoint:$('kiwis-endpoint').value,datasource:datasource.trim()===''?null:datasource,
      timezone:$('kiwis-timezone').value,series:JSON.parse($('kiwis-series').value)};
    const selected={id,retainedBefore:$('kiwis-retained-capture').value,start:null};activeCapture=selected;controls();
    try{
      selected.start=api('/api/kiwis/acquire',{sourceId:id,selection});const result=await selected.start;
      $('kiwis-capture-status').textContent='Acquiring '+id+'.';let status;
      do{
        await new Promise(resolve=>setTimeout(resolve,1000));status=(await api('/api/status')).jobs.find(job=>job.id===result.id);
        if(activeCapture!==selected)throw stale();
        $('kiwis-capture-status').textContent=id+' · '+(status?.status??'Reopening status')+
          (status?.progress?' · '+status.progress.completed+' / '+status.progress.requests+' requests':'');
      }while(status?.status==='RUNNING');
      if(status?.status!=='COMPLETE')throw Error(status?.error?.message??'Reopen the original capture status.');
      const capture=await api('/api/kiwis/capture/'+encodeURIComponent(id));
      if($('kiwis-retained-capture').value===selected.retainedBefore)$('kiwis-retained-capture').value=id;
      download(id+'-kiwis-source.json',capture);notice('Acquired every selected original source response.');
    }finally{if(activeCapture===selected)activeCapture=null;controls();}
  }));
  controls();return {refresh};
}
