import {receivedObservedLandcoverHTML,openReceivedObservedLandcover} from './observed_landcover_received.mjs';
import {retainedStudyControl,openRetainedStudyRecord,receivedReviewHTML} from './study_report_navigation.mjs';
import {receivedGaugeHTML,openReceivedGauge} from './gauge_received_studies.mjs';
import {receivedNativeEnsembleHTML,openReceivedNativeEnsemble} from './ensemble_received_studies.mjs';
import {receivedComparabilityHTML,openReceivedComparability} from './comparability_received_studies.mjs';
/** Original selected-study receiving, reports and editable Implementation lineage. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=v=>Array.isArray(v)?v:[];
const button=(action,label,extra='')=>'<button type="button" data-received-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
const validID=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const families={report:'Implementation plan report',outcome:'Outcomes comparison',field:'Field observation context'};
function files(rows,primary=null) {
  const links=list(rows).filter(row=>!primary||primary.has(row.filename||row.label))
    .filter(row=>/^\/api\/file\/[0-9a-f]{64}$/.test(row.url||''));
  return links.length?'<ul class="st-received-files">'+links.map(row=>'<li><a href="'+esc(row.url)+'?download=1" download>'+
    esc(row.label||row.filename)+'</a><small>'+Number(row.bytes||0).toLocaleString()+' B</small></li>').join('')+'</ul>':'';
}
function allFiles(rows,label='Complete original files'){
  return '<details class="st-details"><summary>'+esc(label)+'</summary>'+files(rows)+'</details>';
}
export function receivedFieldworkPreview(rows) {
  if(!list(rows).length)return '';
  return '<section class="st-details"><h4>Editable fieldwork behind these reports</h4><ul>'+
    rows.map(row=>{const n=row.native_plan,b=row.source_identity?.plan_binding||row.source_identity?.plan;
      return '<li><strong>'+esc(n?.title||b?.title||b?.plan_id||b?.id)+'</strong> · '+esc(families[row.source_family]||row.source_family)+
        (n?' · source revision '+esc(n.selected_revision)+' · current revision '+esc(n.revision)+
          ' · '+esc(n.retained_deployment_ids?.length||0)+' retained crew packets':
          ' · original project '+esc(row.source_identity?.project_id))+'</li>';}).join('')+'</ul></section>';
}
export function attachReceivedStudies(host) {
  let root=null,workspace=null,epoch=0,serial=0,catalogSerial=0;
  let page={items:[],offset:0,limit:50,next_offset:null,total:0},opened=null,selected='',busy=false,loading=false,error='';
  const requests=new Set();
  const current=(ws,e)=>!!root&&workspace===ws&&epoch===e&&host.getWorkspace()===ws;
  const storageKey=()=> 'upstate-received-study:'+workspace;
  async function read(operation,values={}) {
    const controller=new AbortController();requests.add(controller);
    try{return await host.api('/api/study-transfer/'+operation+'?'+new URLSearchParams({workspace,...values}),{signal:controller.signal});}
    finally{requests.delete(controller);}
  }
  function render() {
    if(!root)return;
    const disabled=busy?'disabled':'';
    root.innerHTML='<div class="st-panel-heading"><div><h3>Received studies and original sources</h3>'+
      '<p>Open a saved study, its scientific reports, original editable plans, customer feedback, Gauge geography and selected watershed comparisons.</p></div>'+
      button('refresh','Refresh received studies')+'</div>'+
      (error?'<p class="st-row-error" role="alert">'+esc(error)+'</p>':'')+
      '<div class="st-table-scroll"><table class="st-table"><thead><tr><th>Study</th><th>Scientific reports</th><th>Editable plans</th><th>Gauge studies</th><th>Model studies</th><th>Reviews</th><th>Watershed comparisons</th><th>Open</th></tr></thead><tbody>'+
      page.items.map(row=>'<tr><td><strong>'+esc(row.title)+'</strong><small>'+esc(row.captured_at||'')+'</small>'+
        (row.error?'<p class="st-row-error">'+esc(row.error)+'</p>':'')+'</td><td>'+esc(row.report_count??'')+
        '</td><td>'+esc(row.editable_plan_count??'')+'</td><td>'+esc(row.editable_gauge_count??0)+'</td><td>'+esc(row.native_ensemble_source_count??0)+'</td><td>'+esc(row.customer_review_count??0)+'</td><td>'+esc(row.observed_landcover_source_count??0)+'</td><td>'+
        (row.state==='unreadable'?'Saved record needs repair':button('open',row.id===selected?'Reopen study':'Open study','data-id="'+esc(row.id)+'"'))+
        '</td></tr>').join('')+'</tbody></table></div>'+
      (!page.items.length?'<p class="st-empty">'+(loading?'Reading retained Study transfers…':'Receive a Study archive, switch to its restored Workspace, and open its saved study here.')+'</p>':'')+
      '<div class="st-pagination"><span>'+page.total+' retained studies</span><div>'+
      button('previous','Previous',page.offset===0||loading?'disabled':'')+
      button('next','Next',page.next_offset===null||loading?'disabled':'')+'</div></div>'+
      (busy?'<p role="status">Opening the original saved study and its retained fieldwork…</p>':'')+
      (opened?detailHTML(opened,disabled):'');
  }
  function detailHTML(value,disabled) {
    let html='<section class="st-received-detail" aria-label="Original received study"><h4>'+esc(value.title)+'</h4>'+
      '<p>'+esc(value.project.title||value.project.id)+' · '+esc(value.captured_at||'')+'</p>';
    for(const report of list(value.reports)){
      const primary=new Set(['report.pdf','report.html','scientific-report.html','report-files.zip']);
      html+='<article class="st-export"><div><h4>'+esc(report.title)+'</h4><p>'+esc(report.section_count)+' sections · '+
        esc(report.figure_count)+' figures · '+esc(report.source_count)+' original sources</p>'+
        '<div class="st-actions">'+retainedStudyControl(host,{kind:'scientific-report-editions',id:report.id},{prefix:'received',disabled:!!disabled})+'</div>'+files(report._downloads,primary)+allFiles(report._downloads)+'</div></article>';
    }
    if(!value.field_sources.length)html+='<p>This retained study records '+value.reports.length+' scientific reports. Its saved selection contains no linked editable Implementation plans.</p>';
    for(let index=0;index<value.field_sources.length;index++){
      const source=value.field_sources[index],native=source.native_plan,binding=source.source_identity?.plan_binding||source.source_identity?.plan;
      html+='<article class="st-received-source"><h4>'+esc(native?.title||binding?.title||source.source_id)+'</h4>'+
        '<p>'+esc(families[source.source_family]||source.source_family)+'</p>';
      if(!native){html+='<p>Source project '+esc(source.source_identity?.project_id)+'. The original report and contained plan remain with the scientific source files.</p></article>';continue;}
      html+='<p>The scientific source uses saved revision '+esc(native.selected_revision)+'. Latest editable revision: '+esc(native.revision)+'.</p>'+
        '<div class="st-actions">'+button('plan','Open source revision','data-index="'+index+'" '+disabled)+
        (native.revision!==native.selected_revision?button('current','Open latest editable plan','data-index="'+index+'" '+disabled):'')+'</div>'+
        '<p>'+Object.entries(native.record_counts||{}).filter(([,n])=>n).map(([name,n])=>esc(n)+' '+esc(name.replaceAll('_',' '))).join(' · ')+'</p>';
      for(const report of list(source.reports)){
        html+='<details class="st-details"'+(report.selected_source_report?' open':'')+'><summary>'+
          (report.selected_source_report?'Original source report':'Retained plan report')+' · revision '+esc(report.revision)+' · '+esc(report.as_of||'')+
          '</summary>'+files(report._downloads,new Set(['report.html']))+allFiles(report._downloads)+'</details>';
      }
      for(let p=0;p<source.deployments.length;p++){
        const packet=source.deployments[p];
        html+='<details class="st-details"><summary>'+esc(packet.selection?.title||'Crew packet')+' · revision '+esc(packet.plan.revision)+
          ' · '+esc(packet.summary?.visits??0)+' visits</summary>'+
          '<p>'+(packet.captured_with_study?'Retained with this Study transfer.':'Saved in the editable plan after this Study transfer.')+'</p>'+
          files(packet._downloads,new Set(['crew-packet.zip','crew-packet.html','field-workbench.html','original-plan.json','visits.ics','sites.geojson']))+
          '<p>Unzip the complete packet and open field-workbench.html. Choose Open JSON and load original-plan.json. Record the actual fieldwork, export the edited plan, and import it into this Workspace.</p>'+
          button('packet-plan','Open packet’s saved plan','data-index="'+index+'" data-packet="'+p+'" '+disabled)+
          allFiles(packet._downloads)+'</details>';
      }
      html+='</article>';
    }
    html+=receivedReviewHTML(host,value,!!disabled);
    html+=receivedGaugeHTML(value,!!disabled);
    html+=receivedNativeEnsembleHTML(value,!!disabled);
    html+=receivedComparabilityHTML(value,!!disabled);
    html+=receivedObservedLandcoverHTML(value,!!disabled);
    return html+'</section>';
  }
  async function loadPage(offset=0) {
    const ws=workspace,e=epoch,turn=++catalogSerial;loading=true;error='';render();
    try{const value=await read('received',{offset,limit:50});if(current(ws,e)&&turn===catalogSerial)page=value;}
    catch(reason){if(current(ws,e)&&turn===catalogSerial&&reason.name!=='AbortError')error=reason.message||String(reason);}
    finally{if(current(ws,e)&&turn===catalogSerial){loading=false;render();}}
  }
  async function open(id) {
    if(!validID(id))throw Error('Choose an original received Study.');
    const ws=workspace,e=epoch,turn=++serial;selected=id;opened=null;busy=true;error='';render();
    try{
      const value=await read('received-detail',{study_id:id});
      if(!current(ws,e)||turn!==serial)return;
      if(value.id!==id||value.workspace_key!==ws)throw Error('The received Study returned another Workspace or identity.');
      opened=value;
      try{sessionStorage.setItem(storageKey(),id);}catch{}
    }catch(reason){if(current(ws,e)&&turn===serial&&reason.name!=='AbortError')error=reason.message||String(reason);}
    finally{if(current(ws,e)&&turn===serial){busy=false;render();}}
  }
  async function dispatch(target) {
    const action=target.dataset.receivedAction;
    if(action==='refresh'){const ws=workspace,e=epoch;await loadPage(page.offset);if(current(ws,e)&&selected)await open(selected);return;}
    if(action==='previous')return loadPage(Math.max(0,page.offset-page.limit));
    if(action==='next'&&page.next_offset!==null)return loadPage(page.next_offset);
    if(action==='open')return open(target.dataset.id);
    if(action?.startsWith('landcover-')){
      const ws=workspace,e=epoch,value=opened;
      if(!value||value.id!==selected||value.workspace_key!==ws)
        throw Error('Reopen the original received Study.');
      return await openReceivedObservedLandcover(host,value,target,{
        workspace_key:ws,current:()=>current(ws,e)&&opened===value&&selected===value.id,
      });
    }
    if(action?.startsWith('cohort-')){
      const ws=workspace,e=epoch,value=opened;
      if(!value||value.id!==selected||value.workspace_key!==ws)
        throw Error('Reopen the original received Study.');
      return await openReceivedComparability(host,value,target,{
        workspace_key:ws,current:()=>current(ws,e)&&opened===value&&selected===value.id,
      });
    }
    if(action==='open-retained-report-review'){
      const ws=workspace,e=epoch,value=opened;
      if(!value||value.id!==selected||value.workspace_key!==ws)
        throw Error('Reopen the original received Study.');
      const kind=target.dataset.recordKind,id=target.dataset.recordId;
      const available=kind==='reviews'?list(value.customer_reviews).some(row=>row.id===id):
        kind==='scientific-report-editions'&&(list(value.reports).some(row=>row.id===id)||
          list(value.customer_reviews).some(row=>list(row.scientific_reports).some(source=>
            !source.external&&source.scientific_report_edition_id===id)));
      if(!available)throw Error('Choose a report or review retained with this Study.');
      return openRetainedStudyRecord(host,{kind,id,tab:target.dataset.recordTab},{
        workspace_key:ws,current:()=>current(ws,e)&&opened===value&&selected===value.id,
      });
    }
    if(action?.startsWith('native-ensemble-')){
      const ws=workspace,e=epoch,value=opened;
      if(!value||value.id!==selected||value.workspace_key!==ws)
        throw Error('Reopen the original received Study.');
      return await openReceivedNativeEnsemble(host,value,target,{
        workspace_key:ws,current:()=>current(ws,e)&&opened===value&&selected===value.id,
      });
    }
    if(action?.startsWith('gauge-')){
      const ws=workspace,e=epoch,value=opened;
      if(!value||value.id!==selected||value.workspace_key!==ws)
        throw Error('Reopen the original received Study.');
      return await openReceivedGauge(host,value,target,{
        workspace_key:ws,current:()=>current(ws,e)&&opened===value&&selected===value.id,
      });
    }
    if(!['plan','current','packet-plan'].includes(action))return;
    const ws=workspace,e=epoch,value=opened;
    if(!value||value.id!==selected||value.workspace_key!==ws)throw Error('Reopen the original received Study.');
    const index=Number(target.dataset.index),source=Number.isSafeInteger(index)?value.field_sources[index]:null;
    const native=source?.native_plan;
    if(!native)throw Error('Choose an original local Implementation plan.');
    let revision=action==='current'?native.revision:native.selected_revision;
    if(action==='packet-plan'){
      const n=Number(target.dataset.packet),packet=Number.isSafeInteger(n)?source.deployments[n]:null;
      if(!packet||packet.plan.plan_id!==native.plan_id)throw Error('Reopen the original crew packet.');
      revision=packet.plan.revision;
    }
    if(!Number.isSafeInteger(revision)||revision<1)throw Error('Choose an original saved revision.');
    if(!current(ws,e))return;
    if(typeof host.openExtension!=='function')throw Error('Reopen this Workspace in the maintained operator.');
    await host.openExtension('implementation','openSavedPlan',{workspace_key:ws,plan_id:native.plan_id,revision});
  }
  function click(event){
    const target=event.target.closest('[data-received-action]');
    if(!target||!root?.contains(target)||target.disabled)return;
    event.preventDefault();event.stopPropagation();
    const ws=workspace,e=epoch;
    dispatch(target).catch(reason=>{if(current(ws,e)&&reason.name!=='AbortError'){error=reason.message||String(reason);render();}});
  }
  function mount(container){
    detach();root=container;workspace=host.getWorkspace();epoch++;
    page={items:[],offset:0,limit:50,next_offset:null,total:0};opened=null;selected='';busy=false;loading=false;error='';
    root.addEventListener('click',click);render();loadPage();
    try{const saved=sessionStorage.getItem(storageKey());if(validID(saved))open(saved);}catch{}
  }
  function detach(){
    epoch++;serial++;catalogSerial++;for(const c of requests)c.abort();requests.clear();
    if(root)root.removeEventListener('click',click);root=null;busy=false;loading=false;
  }
  return {mount,detach,open,refresh:()=>loadPage(page.offset)};
}
