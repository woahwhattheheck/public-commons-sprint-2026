// MIT. Full offline correspondence editor using the same original document and table functions.
export function labReconciliationEditor(api){
  const data=JSON.parse(document.getElementById('reconciliation-data').textContent),comparison=data.comparison;
  const baseline=new Map(comparison.baselineProjection.entities.map(entity=>[entity.entityId,entity]));
  const current=new Map(comparison.currentProjection.entities.map(entity=>[entity.entityId,entity]));
  let draft=api.normalizeReconciliation(comparison,data.review.document),page=0,selected=null,changed=false;
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const status=message=>$('status').textContent=message;
  function download(name,text,mime='application/json'){
    const url=URL.createObjectURL(new Blob([text],{type:mime})),link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),20000);
  }
  const label=entity=>[entity.fields.sys_sample_code?.value,entity.context.labSampleIds.join(' / '),
    entity.fields.lab_anl_method_name?.value,entity.fields.analysis_timestamp?.value,
    entity.fields.chemical_name?.value??entity.fields.cas_rn?.value,entity.fields.result_type_code?.value]
    .filter(Boolean).join(' · ');
  const choices=()=>new Map(draft.decisions.map(choice=>[choice.groupId,choice]));
  function filtered(){
    const query=$('search').value.toLowerCase(),kind=$('kind').value,state=$('candidate-state').value,disposition=$('disposition').value,selected=choices();
    return comparison.groups.filter(group=>(!kind||group.kind===kind)&&(!state||group.status===state)&&
      (!disposition||(disposition==='unreviewed'?!selected.has(group.groupId):selected.get(group.groupId)?.action===disposition))&&
      (!query||JSON.stringify(group.key).toLowerCase().includes(query)||[...group.baselineIds.map(id=>baseline.get(id)),...group.currentIds.map(id=>current.get(id))]
        .some(entity=>label(entity).toLowerCase().includes(query)||Object.values(entity.fields).some(value=>String(value.value??'').toLowerCase().includes(query)))));
  }
  function render(){
    const rows=filtered(),limit=50,map=choices();page=Math.min(page,Math.max(0,Math.ceil(rows.length/limit)-1));
    $('draft-count').textContent=draft.decisions.length+' explicit group decisions · '+draft.links.length+' explicit entity links'+(changed?' · unsaved draft':' · saved source review');
    $('page-info').textContent=rows.length?'Groups '+(page*limit+1)+'–'+Math.min(rows.length,(page+1)*limit)+' of '+rows.length:'No matching groups';
    $('previous').disabled=page===0;$('next').disabled=(page+1)*limit>=rows.length;
    $('groups').innerHTML=rows.slice(page*limit,(page+1)*limit).map(group=>{
      const entity=baseline.get(group.baselineIds[0])??current.get(group.currentIds[0]);
      return '<tr><td><button data-group="'+group.groupId+'">'+esc(label(entity)||group.groupId)+'</button></td><td>'+esc(group.kind)+'</td><td>'+group.baselineIds.length+'</td><td>'+group.currentIds.length+'</td><td>'+esc(group.status)+'</td><td>'+(group.changedFields??group.fields.filter(field=>field.status==='CHANGED').length)+'</td><td>'+esc(map.get(group.groupId)?.action??'unreviewed')+'</td></tr>';
    }).join('');
    for(const button of document.querySelectorAll('[data-group]'))button.onclick=()=>openGroup(button.dataset.group);
    $('links').innerHTML=draft.links.map((link,index)=>'<tr><td>'+esc(label(baseline.get(link.baselineId)))+'</td><td>'+esc(label(current.get(link.currentId)))+'</td><td>'+esc(link.reason)+'</td><td><button data-remove-link="'+index+'">Remove draft link</button></td></tr>').join('');
    for(const button of document.querySelectorAll('[data-remove-link]'))button.onclick=()=>replace({...draft,links:draft.links.filter((_,index)=>index!==Number(button.dataset.removeLink))},'The original entity link was removed from this draft.');
  }
  function sourceCard(entity,side,checked){
    const path=side==='baseline'?data.links.baselineReport:data.links.currentReport;
    return '<article><label><input type="checkbox" data-entity-side="'+side+'" value="'+entity.entityId+'" '+(checked?'checked':'')+'> '+esc(label(entity))+'</label>'+
      '<p class="identity">'+esc(entity.entityId)+' · '+esc(entity.entitySha256)+'</p><p>'+entity.rows.length+' original '+(entity.projection==='embedded-test'?'result rows carry this test projection':'physical row')+'</p>'+
      '<details><summary>Exact native identity and source rows</summary><pre>'+esc(JSON.stringify(entity.nativeKey,null,2))+'</pre>'+
      entity.rows.map(row=>'<a target="_blank" rel="noopener" href="'+esc(path)+'#record='+encodeURIComponent(row.recordId)+'">'+esc(row.filename+' : '+row.rowNumber)+'</a>').join('<br>')+
      '<pre>'+esc(JSON.stringify(entity.context,null,2))+'</pre></details></article>';
  }
  function fieldValue(variants){
    return variants.map(variant=>'<div>'+esc(variant.value===null?'Field absent':variant.value.value===null?'Unparsed original representation':variant.value.value===''?'(empty string)':variant.value.value)+
      '<small>'+esc(variant.entityIds.length+' entity variant · '+(variant.value?.kind??'absent'))+'</small>'+
      (variant.value?'<details><summary>Original fields</summary><pre>'+esc(JSON.stringify(variant.value.raw,null,2))+'</pre></details>':'')+'</div>').join('<hr>');
  }
  function openGroup(id){
    const group=comparison.groups.find(item=>item.groupId===id);if(!group)return;selected=id;$('detail').hidden=false;
    const choice=choices().get(id),pairs=choice?.pairs??[],a=new Set(pairs.map(pair=>pair.baselineId)),b=new Set(pairs.map(pair=>pair.currentId));
    $('detail-title').textContent=group.kind+' · '+group.status;
    $('group-identity').textContent=group.groupId+' · '+group.groupSha256;
    $('candidate-key').textContent=JSON.stringify(group.key,null,2);
    $('baseline-candidates').innerHTML=group.baselineIds.map(id=>sourceCard(baseline.get(id),'baseline',a.has(id))).join('')||'<p>No baseline entity in this candidate group.</p>';
    $('current-candidates').innerHTML=group.currentIds.map(id=>sourceCard(current.get(id),'current',b.has(id))).join('')||'<p>No current entity in this candidate group.</p>';
    $('reason').value=choice?.reason??'';$('pair').disabled=!group.baselineIds.length||!group.currentIds.length;
    const fields=group.fields??api.compareReconciliationFields(group.baselineIds.map(id=>baseline.get(id)),group.currentIds.map(id=>current.get(id)));
    $('field-differences').innerHTML=fields.map(field=>'<tr><td>'+esc(field.field)+'</td><td>'+esc(field.status)+'</td><td>'+fieldValue(field.baseline)+'</td><td>'+fieldValue(field.current)+'</td></tr>').join('');
    $('remove-group').disabled=!choice;
  }
  function replace(value,message){
    draft=api.normalizeReconciliation(comparison,value);changed=true;render();if(selected)openGroup(selected);status(message);
  }
  function record(action){
    try{
      const group=comparison.groups.find(item=>item.groupId===selected);if(!group)throw Error('Open an original candidate group.');
      const choice={groupId:group.groupId,groupSha256:group.groupSha256,action,reason:$('reason').value};
      if(action==='pair'){
        const a=[...document.querySelectorAll('[data-entity-side="baseline"]:checked')].map(input=>input.value);
        const b=[...document.querySelectorAll('[data-entity-side="current"]:checked')].map(input=>input.value);
        if(!a.length||!b.length)throw Error('Select the exact baseline and current entities first.');
        choice.pairs=a.flatMap(baselineId=>b.map(currentId=>({baselineId,currentId})));
        if(choice.pairs.length>100000)throw Error('The explicit selected correspondence set exceeds the source limit.');
      }
      replace({...draft,decisions:[...draft.decisions.filter(item=>item.groupId!==selected),choice]},
        'The explicit '+action+' disposition and reason are retained in this draft. Native field values remain controlled by their separate field decisions.');
    }catch(error){status(error.message);}
  }
  function manualChoices(side){
    const map=side==='baseline'?baseline:current,query=$(side+'-search').value.toLowerCase(),kind=$('link-kind').value;
    const rows=[...map.values()].filter(entity=>(!kind||entity.kind===kind)&&(!query||label(entity).toLowerCase().includes(query)||entity.entityId.includes(query)));
    $(side+'-select').innerHTML='<option value="">Select an exact original entity</option>'+rows.map(entity=>'<option value="'+entity.entityId+'">'+esc(entity.kind+' · '+label(entity)+' · '+entity.entityId.slice(-8))+'</option>').join('');
    $(side+'-matched').textContent=rows.length+' matching entities';
  }
  $('add-link').onclick=()=>{
    try{
      const a=baseline.get($('baseline-select').value),b=current.get($('current-select').value);
      if(!a||!b)throw Error('Select one complete entity on each side.');
      const link={baselineId:a.entityId,baselineSha256:a.entitySha256,currentId:b.entityId,currentSha256:b.entitySha256,reason:$('link-reason').value};
      replace({...draft,links:[...draft.links,link]},'The explicit cross-group correspondence is retained with both original entity hashes and its reason.');
      $('link-reason').value='';
    }catch(error){status(error.message);}
  };
  $('pair').onclick=()=>record('pair');$('separate').onclick=()=>record('separate');$('defer').onclick=()=>record('defer');
  $('remove-group').onclick=()=>{if(selected)replace({...draft,decisions:draft.decisions.filter(choice=>choice.groupId!==selected)},'The candidate group is unreviewed in this draft.');};
  $('close-detail').onclick=()=>{selected=null;$('detail').hidden=true;};
  $('kind').innerHTML='<option value="">Every section</option>'+Object.keys(comparison.byKind).map(kind=>'<option>'+esc(kind)+'</option>').join('');
  $('link-kind').innerHTML='<option value="">Every section</option>'+Object.keys(comparison.byKind).map(kind=>'<option>'+esc(kind)+'</option>').join('');
  $('candidate-state').innerHTML='<option value="">Every candidate state</option>'+[...new Set(comparison.groups.map(group=>group.status))].sort().map(value=>'<option>'+esc(value)+'</option>').join('');
  $('search').oninput=$('kind').onchange=$('candidate-state').onchange=$('disposition').onchange=()=>{page=0;render();};
  $('previous').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};
  $('baseline-search').oninput=()=>manualChoices('baseline');$('current-search').oninput=()=>manualChoices('current');
  $('link-kind').onchange=()=>{manualChoices('baseline');manualChoices('current');};
  $('download-json').onclick=()=>download('lab-edd-reconciliation.json',JSON.stringify(api.normalizeReconciliation(comparison,draft),null,2)+'\n');
  for(const format of ['csv','tsv'])$('download-'+format).onclick=()=>{
    try{const table=api.reconciliationTable(comparison,draft,{format});download(table.filename,table.text,table.mime);}catch(error){status(error.message);}
  };
  $('load-decisions').onchange=async event=>{
    try{
      const file=event.target.files[0];if(!file)return;if(file.size>16777216)throw Error('The complete correspondence file exceeds 16 MiB.');
      const text=await file.text(),format=/\.tsv$/i.test(file.name)?'tsv':/\.csv$/i.test(file.name)?'csv':'json';
      const value=format==='json'?JSON.parse(text):api.parseReconciliationTable(comparison,text,{format});
      replace(value,'The complete saved correspondence document is open against this exact source pair and mapping.');
    }catch(error){status(error.message);}finally{event.target.value='';}
  };
  window.addEventListener('beforeunload',event=>{if(changed){event.preventDefault();event.returnValue='';}});
  render();manualChoices('baseline');manualChoices('current');
}
