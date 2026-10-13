/** Editable source-bound quantities inside the original Economic draft. */
import {newQuantityEstimate,calculateQuantityEstimate,prepareQuantityCostWorksheet} from './economic_quantity_estimate.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=(rows,value)=>rows.map(([key,label])=>'<option value="'+esc(key)+'" '+(String(key)===String(value)?'selected':'')+'>'+esc(label)+'</option>').join('');
const input=(label,key,value='',type='text')=>'<label><span>'+esc(label)+'</span><input data-q-field="'+esc(key)+'" type="'+type+'" value="'+esc(value)+'"></label>';
const btn=(action,label,extra='')=>'<button type="button" data-q-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
const uid=()=>crypto.randomUUID();
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
async function shaBytes(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
const sha=text=>shaBytes(new TextEncoder().encode(text));
const cents=value=>Number.isSafeInteger(value)?new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(value/100):'Not calculated';

export function createQuantityEditor(container,adapters){
  let closed=false,generation=0,busy=false,status='',error=false;
  const ownedDraft=adapters.get().draft;
  const get=()=>adapters.get();
  const state=()=>{
    const {draft}=get();draft.quantityEstimates??=[];draft.quantityEditor??={run_id:'',footprint_id:'',active_id:'',choices:[]};
    return draft.quantityEditor;
  };
  const selected=()=>get().draft.quantityEstimates.find(row=>row.id===state().active_id)||null;
  const live=()=>!closed&&container.isConnected&&adapters.active()&&get().draft===ownedDraft;
  function capture(){
    if(closed||get().draft!==ownedDraft)return;
    const {draft}=get(),view=state(),estimate=selected();
    for(const element of container.querySelectorAll('[data-q-view]'))view[element.dataset.qView]=element.value;
    if(estimate){
      estimate.planning??={};
      for(const element of container.querySelectorAll('[data-q-planning]'))estimate.planning[element.dataset.qPlanning]=element.value;
      for(const row of container.querySelectorAll('[data-q-line]')){
        const line=estimate.lines.find(item=>item.id===row.dataset.qLine);if(!line)continue;
        for(const element of row.querySelectorAll('[data-q-field]')){
          const key=element.dataset.qField,value=element.value;
          if(key.startsWith('quantity.')){line.quantity??={};line.quantity[key.slice(9)]=value;}
          else if(key.startsWith('override.')){
            line.rate_override??={};line.rate_override[key.slice(9)]=value;
          }else line[key]=value;
        }
        if(line.quantity.kind==='native')line.quantity={kind:'native',key:line.quantity.key||''};
        else line.quantity={kind:'manual',value:line.quantity.value??'',unit:line.quantity.unit||'ha',reason:line.quantity.reason||''};
        if(line.rate_override&&['rate_cents','reason','source_ref'].every(key=>line.rate_override[key]===undefined||line.rate_override[key]===null||line.rate_override[key]===''))delete line.rate_override;
      }
    }
    return draft;
  }
  function changed(){generation++;adapters.changed(capture());}
  function notify(value,failed=false){status=value;error=failed;const box=container.querySelector('[data-q-status]');if(box){box.textContent=value;box.setAttribute('role',failed?'alert':'status');}}
  function bound(estimate){
    const {source,draft}=get(),b=estimate?.context?.binding;
    return b&&b.report_id===draft.reportId&&b.report_sha256===draft.reportSha&&b.zone_id===draft.zoneId&&
      source?.alternatives.some(row=>row.run_id===b.run_id&&row.scenario_id===b.scenario_id&&row.profile_id===b.profile_id);
  }
  function rowMarkup(line,estimate){
    const catalogues=estimate.context.catalogues||[],catalogue=catalogues.find(row=>row.id===line.catalogue_id);
    const rate=catalogue?.rows.find(row=>row.id===line.row_id),quantity=line.quantity||{};
    const source=catalogue?.sources.find(row=>row.id===rate?.source_id);
    return '<details class="econ-cost" data-q-line="'+esc(line.id)+'" open><summary>'+esc(line.title||rate?.title||'Unpriced item')+'</summary><div class="econ-fields">'+
      input('Item title','title',line.title)+
      '<label><span>Original rate catalogue</span><select data-q-field="catalogue_id">'+options([['','Choose a source catalogue'],...catalogues.map(row=>[row.id,row.id])],line.catalogue_id)+'</select></label>'+
      '<label><span>Original source rate</span><select data-q-field="row_id">'+options([['','Choose one sourced rate'],...(catalogue?.rows||[]).map(row=>[row.id,row.title+' · '+row.price_kind])],line.row_id)+'</select></label>'+
      '<label><span>Quantity basis</span><select data-q-field="quantity.kind">'+options([['native','Existing scenario quantity'],['manual','Explicit measured / design quantity']],quantity.kind||'native')+'</select></label>'+
      (quantity.kind==='manual'?input('Quantity','quantity.value',quantity.value)+
      '<label><span>Quantity unit</span><select data-q-field="quantity.unit">'+options(['ha','acre','m2','square_metre','square_foot','each','ft','foot','m','metre','mile','hour','week','DiaInFt'].map(x=>[x,x]),quantity.unit||'ha')+'</select></label>'+
      input('Measurement source and reason','quantity.reason',quantity.reason):
      '<label><span>Actual original quantity</span><select data-q-field="quantity.key">'+options([['','Choose native changed area'],...(estimate.context.quantities||[]).map(row=>[row.key,row.label+' · '+row.value+' '+row.unit])],quantity.key)+'</select></label>')+
      '<label><span>Cost treatment</span><select data-q-field="classification">'+options([['context','Reference only'],['capital','One-time implementation'],['annual','Explicit recurring annual expense']],line.classification||'context')+'</select></label>'+
      input('Why this source rate applies to this intervention','applicability_reason',line.applicability_reason)+
      (line.classification==='annual'?input('Occurrences per year','annual_occurrences',line.annual_occurrences)+input('Source / reason for annual recurrence','recurrence_reason',line.recurrence_reason):'')+
      input('Physical scope group (blank means same complete intervention)','scope_group',line.scope_group)+
      input('Review of any overlapping bundled components','overlap_reason',line.overlap_reason)+
      '</div><p class="econ-note">'+esc(rate?(rate.price_kind+' · '+cents(rate.pricing?.rate_cents??rate.rate_cents)+' / '+(rate.pricing?.type==='per_thousand'?String(rate.pricing.divisor??1000)+' ':'')+rate.quantity_unit+(rate.pricing?.minimum_quantity!==undefined?' · minimum '+rate.pricing.minimum_quantity+' '+rate.quantity_unit:'')+' · '+(rate.scope||'')):'No source rate selected.')+'</p>'+
      (rate?'<p class="econ-note">Exclusions: '+esc(rate.exclusions||'No additional exclusions recorded')+'</p><p>'+esc(source?.title||rate.source_id)+' · '+esc(source?.url||'')+'</p>':'')+
      '<details><summary>Explicit source-rate override</summary><p class="econ-note">Keep the original rate. An override must identify its actual source and reason; it cannot turn assistance into implementation cost.</p><div class="econ-fields">'+
      input('Override cents per '+(rate?(rate.pricing?.type==='per_thousand'?String(rate.pricing.divisor??1000)+' ':'')+rate.quantity_unit:'original rate unit'),'override.rate_cents',line.rate_override?.rate_cents)+input('Override reason','override.reason',line.rate_override?.reason)+input('Override source reference','override.source_ref',line.rate_override?.source_ref)+'</div></details>'+
      btn('remove','Remove this item','data-id="'+esc(line.id)+'"')+'</details>';
  }
  function render(){
    if(!live())return;
    const {source,draft}=get(),view=state(),estimate=selected(),all=draft.quantityEstimates;
    let calculation=null;try{if(estimate)calculation=calculateQuantityEstimate(estimate);}catch(e){calculation={ready:false,issues:[{message:e.message}]};}
    container.innerHTML='<h3>Intervention quantities and sourced rates</h3><p>Choose an existing scenario footprint and review actual implementation quantities. Reporting-zone hectares and modeled pollutant masses are not treatment quantities. Assistance remains reference context.</p>'+
      '<div class="econ-fields"><label><span>Original modeled alternative</span><select data-q-view="run_id">'+options([['','Choose original alternative'],...(source?.alternatives||[]).map(row=>[row.run_id,row.label])],view.run_id)+'</select></label></div>'+
      '<div class="econ-actions">'+btn('footprints','Read existing scenario footprints')+'</div>'+
      '<div class="econ-fields"><label><span>Original retained footprint</span><select data-q-view="footprint_id">'+options([['','Choose a retained footprint'],...(view.choices||[]).map(row=>[row.id,(row.title||row.id)+' · '+row.summary?.net_changed_hectares+' ha changed'])],view.footprint_id)+'</select></label></div>'+
      '<div class="econ-actions">'+btn('new','Start estimate from this verified source')+'</div><label>Open a complete saved estimate as a new working copy <input data-q-import type="file" accept=".json,application/json"></label>'+
      '<p data-q-status role="'+(error?'alert':'status')+'">'+esc(status)+'</p>'+
      (all.length?'<label><span>Retained editable estimates</span><select data-q-view="active_id">'+options([['','Choose an estimate'],...all.map(row=>[row.id,(row.title||row.id)+' · '+row.context.binding.run_id.slice(0,12)+' · '+row.lines.length+' items'])],view.active_id)+'</select></label>':'')+
      (estimate?'<p class="econ-note">'+esc(estimate.context.scope||'Whole original scenario intervention')+' Original footprint '+esc(estimate.context.binding.footprint_id)+'.</p>'+
      (!bound(estimate)?'<p role="alert">This retained estimate belongs to another original report or reporting-zone selection. Its sources and edits remain available. Return to that selection before applying it.</p>':'')+
      '<div class="econ-actions">'+btn('add','Add sourced cost item')+btn('download','Download full editable estimate')+'</div>'+
      estimate.lines.map(row=>rowMarkup(row,estimate)).join('')+
      '<section><h4>Reviewed gross cost totals</h4><p>Capital '+esc(cents(calculation?.totals?.capital_cents))+' · Annual '+esc(cents(calculation?.totals?.annual_cents))+'</p>'+
      '<ul>'+((calculation?.issues)||[]).map(row=>'<li>'+esc(typeof row==='string'?row:row.message||JSON.stringify(row))+'</li>').join('')+'</ul></section>'+
      '<details open><summary>Explicit decision planning inputs</summary><p>These values pass to the original Economic cost row only after worksheet review. They are not inferred from a survey rate.</p><div class="econ-fields">'+
      [['horizon_years','Planning horizon, years','text'],['discount_percent','Real discount rate, %','text'],['source_as_of','Estimate source as of','date'],['source_title','Estimate source title','text'],['source_uri','Estimate retained source reference','text']].map(([key,label,type])=>'<label><span>'+esc(label)+'</span><input data-q-planning="'+key+'" type="'+type+'" value="'+esc(estimate.planning?.[key]??'')+'"></label>').join('')+
      '</div></details><div class="econ-actions">'+btn('calculate','Review quantity calculation')+btn('worksheet','Preview totals in the original cost worksheet',!bound(estimate)?'disabled':'')+'</div>':'');
    refreshDisabled();
  }
  function refreshDisabled(){
    if(closed)return;
    const locked=busy||get().locked;
    for(const control of container.querySelectorAll('input,select,button,textarea'))control.disabled=locked||(control.dataset.qAction==='worksheet'&&!bound(selected()));
  }
  async function click(event){
    const target=event.target.closest('[data-q-action]');if(!target||!container.contains(target))return;
    event.preventDefault();event.stopPropagation();
    if(busy||get().locked)return;
    capture();const action=target.dataset.qAction;
    try{
      const view=state(),estimate=selected(),{source,draft}=get();
      if(action==='download'){if(estimate)adapters.download({filename:'quantity-estimate-'+estimate.id+'.json',content:JSON.stringify(estimate,null,2)+'\n',mimeType:'application/json'});return;}
      if(action==='add'){
        if(!estimate)throw Error('Choose a retained estimate.');
        estimate.lines.push({id:uid(),title:'',catalogue_id:'',row_id:'',quantity:{kind:'native',key:''},classification:'context',applicability_reason:''});
      }else if(action==='remove'){
        if(estimate)estimate.lines=estimate.lines.filter(row=>row.id!==target.dataset.id);
      }else if(action==='footprints'||action==='new'){
        if(!view.run_id)throw Error('Choose the original alternative.');
        if(action==='new'&&!view.footprint_id)throw Error('Choose an existing retained footprint.');
        const snapshot=JSON.stringify(draft),token=++generation;busy=true;render();notify('Verifying the original source and existing footprint…');
        try{
          const result=await adapters.load({report_id:draft.reportId,report_sha256:draft.reportSha,zone_id:draft.zoneId,run_id:view.run_id,...(action==='new'?{footprint_id:view.footprint_id}:{})});
          if(!live()||generation!==token||JSON.stringify(get().draft)!==snapshot||get().locked)return;
          view.choices=clone(result.footprint_choices);
          if(action==='new'){
            if(!result.context)throw Error('The complete selected source context is unavailable.');
            const next=newQuantityEstimate(result.context);next.id=uid();next.title=source.alternatives.find(row=>row.run_id===view.run_id).label;
            const old=draft.costs?.[view.run_id]||{};next.planning=Object.fromEntries(['horizon_years','discount_percent','source_as_of','source_title','source_uri'].map(key=>[key,old[key]??'']));
            draft.quantityEstimates.push(next);view.active_id=next.id;notify('Complete original footprint and rate sources retained. Choose applicable items and quantities explicitly.');
          }else{view.footprint_id='';notify(result.instruction);}
        }finally{if(live()&&generation===token){busy=false;adapters.changed(get().draft);render();}}
        return;
      }else if(action==='worksheet'){
        if(!estimate||!bound(estimate))throw Error('Return to this estimate’s original report and zone.');
        const economicDraft=clone(draft),run=estimate.context.binding.run_id;
        economicDraft.costs[run]={...economicDraft.costs[run],...clone(estimate.planning||{})};
        const prepared=prepareQuantityCostWorksheet(estimate,{source,economicDraft});
        await adapters.review(JSON.stringify(prepared,null,2)+'\n',estimate);
        return;
      }else if(action!=='calculate')return;
      changed();render();
    }catch(e){if(live()){notify(e.message||String(e),true);}}
  }
  async function importFile(event){
    const picker=event.target,file=picker.files?.[0];if(!file||busy||get().locked)return;
    capture();const token=++generation,snapshot=JSON.stringify(get().draft);busy=true;refreshDisabled();
    try{
      if(file.size>64*1024*1024)throw Error('Choose a complete estimate within 64 MiB.');
      const originalBytes=await file.arrayBuffer();
      if(originalBytes.byteLength!==file.size)throw Error('The selected original file byte count changed.');
      const original_text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(originalBytes);
      if(!live()||token!==generation||JSON.stringify(get().draft)!==snapshot||get().locked)return;
      const incoming=JSON.parse(original_text.replace(/^\uFEFF/,''));
      if(incoming.schema!=='upstate.economic-quantity-estimate/v1'||!incoming.context?.binding||!Array.isArray(incoming.lines))throw Error('Choose the original full quantity estimate.');
      const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
      const ids=new Set();
      for(const line of incoming.lines){
        if(!plain(line)||typeof line.id!=='string'||!line.id.trim()||ids.has(line.id))
          throw Error('Every imported item must be an object with its own nonempty, distinct ID.');
        ids.add(line.id);
        if(line.quantity!==undefined&&(!plain(line.quantity)||!['native','manual'].includes(line.quantity.kind)))throw Error('An imported quantity must retain its native or manual working object.');
        if(line.rate_override!==undefined&&line.rate_override!==null&&!plain(line.rate_override))throw Error('An imported rate override must retain its working object.');
      }
      if(incoming.planning!==undefined&&!plain(incoming.planning))throw Error('Imported planning inputs must retain their working object.');
      if(!bound(incoming))throw Error('Select this estimate’s original report, zone and alternative first.');
      const b=incoming.context.binding;
      const fresh=await adapters.load({report_id:b.report_id,report_sha256:b.report_sha256,zone_id:b.zone_id,run_id:b.run_id,footprint_id:b.footprint_id});
      if(!live()||token!==generation||JSON.stringify(get().draft)!==snapshot||get().locked)return;
      for(const key of ['binding','quantities','footprint','footprint_original'])
        if(canonical(incoming.context[key])!==canonical(fresh.context?.[key]))throw Error('The imported '+key+' differs from its complete verified original source.');
      const originals=incoming.context.catalogue_originals;
      if(!Array.isArray(originals)||originals.length!==incoming.context.catalogues?.length)throw Error('Retain every original catalogue body.');
      for(let index=0;index<originals.length;index++){
        const entry=originals[index],catalogue=incoming.context.catalogues[index];
        const currentCatalogue=fresh.context.catalogues.find(row=>row.id===catalogue.id);
        const currentOriginal=fresh.context.catalogue_originals.find(row=>row.path===entry.path);
        if(!currentCatalogue||!currentOriginal||canonical(catalogue)!==canonical(currentCatalogue)||canonical(entry)!==canonical(currentOriginal))
          throw Error('The imported dated catalogue differs from the verified installed original. Retain it as a separate source edition or use an explicit source-rate override.');
        if(typeof entry.original_text!=='string'||new TextEncoder().encode(entry.original_text).length!==entry.bytes||
           await sha(entry.original_text)!==entry.sha256||canonical(JSON.parse(entry.original_text))!==canonical(incoming.context.catalogues[index]))
          throw Error('An imported rate catalogue differs from its retained full source.');
      }
      const hash=await shaBytes(originalBytes);
      if(!live()||token!==generation||JSON.stringify(get().draft)!==snapshot||get().locked)return;
      incoming.imported_original={name:file.name,bytes:file.size,sha256:hash,original_text};
      incoming.copied_from=incoming.id;incoming.id=uid();
      get().draft.quantityEstimates.push(incoming);state().active_id=incoming.id;
      adapters.changed(get().draft);notify('Complete original estimate received as an independent working copy. Prior estimates remain retained.');
    }catch(e){if(live()&&token===generation&&!get().locked&&JSON.stringify(get().draft)===snapshot)notify(e.message||String(e),true);}
    finally{if(live()&&token===generation){busy=false;if(picker.files?.[0]===file)picker.value='';render();}}
  }
  function inputEvent(event){
    if(!event.target.matches('[data-q-field],[data-q-view],[data-q-planning]'))return;
    event.stopPropagation();if(busy||get().locked||event.target.matches('[data-q-view]'))return;
    changed();
  }
  function changeEvent(event){
    if(event.target.matches('[data-q-import]')){event.stopPropagation();void importFile(event);return;}
    if(!event.target.matches('[data-q-field],[data-q-view],[data-q-planning]'))return;
    event.stopPropagation();if(busy||get().locked)return;
    // Capture uses the previous selected form before changing the selected estimate.
    const view=state(),field=event.target.dataset.qView,chosen=event.target.value;
    if(field==='active_id'){event.target.value=view.active_id;capture();view.active_id=chosen;}
    else capture();
    if(field==='run_id'){view.choices=[];view.footprint_id='';}
    if(event.target.dataset.qField==='catalogue_id'){
      const line=selected()?.lines.find(row=>row.id===event.target.closest('[data-q-line]').dataset.qLine);
      if(line)line.row_id='';
    }
    generation++;adapters.changed(get().draft);render();
  }
  container.addEventListener('click',click);container.addEventListener('input',inputEvent);container.addEventListener('change',changeEvent);
  render();
  return {capture,render,refreshDisabled,close(){if(closed)return;capture();closed=true;generation++;container.removeEventListener('click',click);container.removeEventListener('input',inputEvent);container.removeEventListener('change',changeEvent);}};
}
