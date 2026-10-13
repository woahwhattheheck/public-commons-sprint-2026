import {SCHEMA,COLLECTIONS,clone,esc,today,uid,makePlan,parseMoney,money,validatePlan,schedulePlan,summarize,applyMethod,updateRow,deleteRow,csvPlan,reportHtml,fieldSheetHtml,safeLink} from './implementation_core.mjs';
import {openImplementationDialog,saveImplementationForm,implementationSourceChoices,previewImplementationSource,syncImplementationSource} from './implementation_forms.mjs';
import {attachImplementationEvidence} from './implementation_evidence_ui.mjs';
import {briefingFollowup} from './implementation_briefing.mjs';
import {normalizeResultsView,reviewResults,renderResults,resultInspectionHtml,inspectResult,matchingResultsCsv,matchingResultsDocument} from './implementation_results.mjs';

const TABS=[['overview','Overview'],['tasks','Work plan'],['budget','Costs'],['sites','Sites & monitoring'],['field','Field records'],['outcomes','Outcomes'],['sources','Source selections'],['handover','Handover']];
const LABELS={tasks:'task',budget_lines:'cost entry',sites:'site',monitoring_plans:'monitoring plan',visits:'visit',activities:'activity',observations:'result',candidates:'candidate',source_links:'source reference'};
const button=(action,label,extra='',classes='')=>'<button type="button" data-impl="'+esc(action)+'" '+extra+' class="'+esc(classes)+'">'+esc(label)+'</button>';
const empty=text=>'<p class="iw-empty">'+esc(text)+'</p>';
const format=value=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
const options=(rows,selected,blank=true)=> (blank?'<option value="">—</option>':'')+rows.map(r=>'<option value="'+esc(r[0])+'" '+(String(r[0])===String(selected)?'selected':'')+'>'+esc(r[1])+'</option>').join('');
const field=(label,input,help='')=>'<label class="iw-field"><span>'+esc(label)+'</span>'+input+(help?'<small>'+esc(help)+'</small>':'')+'</label>';
const input=(name,value='',type='text',attr='')=>'<input name="'+esc(name)+'" type="'+esc(type)+'" value="'+esc(value??'')+'" '+attr+'>';
const area=(name,value='',attr='')=>'<textarea name="'+esc(name)+'" '+attr+'>'+esc(value??'')+'</textarea>';
const select=(name,rows,value='',attr='')=>'<select name="'+esc(name)+'" '+attr+'>'+options(rows,value)+'</select>';
function download(name,text,type='text/plain;charset=utf-8'){
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function finite(value,label){if(value==='')return null;const n=Number(value);if(!Number.isFinite(n))throw Error(label+' must be a finite number.');return n;}
function list(text){return String(text||'').split(/[\n,]/).map(x=>x.trim()).filter(Boolean);}
function textObject(value){return typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');}
function parseOptionalObject(value){const s=String(value||'').trim();if(!s)return '';if(s.startsWith('{')||s.startsWith('[')){try{return JSON.parse(s);}catch{throw Error('The structured method or reference is not valid JSON.');}}return s;}
function docEqual(a,b){return JSON.stringify(a)===JSON.stringify(b);}
export class ImplementationWorkbench {
  constructor(root,host={},catalog=null){
    this.root=root;this.host=host;this.native=typeof host.api==='function';this.catalog=catalog;this.plan=null;this.nativePlan=null;this.tab='overview';this.asOf=today();this.dirty=false;this.pending=null;this.importedFile=false;this.filter='';this.gone=false;this.generation=0;this.message='';this.error='';this.offlineCopies={};this.planList=[];this.selectionDraft=null;this.selectionPreviewTurn=0;this.observationFlow=null;this.observationReceipts=[];this.labIntake=null;this.labModule=null;this.briefingIntake=null;this.outcomeController=null;this.outcomeModule=null;this.qcModule=null;this.qcEditor=null;this.labDispatch=null;this.dispatchModule=null;this.resultView=normalizeResultsView();this.planReportSource=null;this.fieldDeployment=null;this.deploymentModule=null;
    this.onClick=e=>{const b=e.target.closest('[data-impl]');if(!b||!this.root.contains(b))return;this.act(b).catch(x=>this.fail(x));};
    this.onChange=e=>this.change(e).catch(x=>this.fail(x));
    this.onInput=e=>{if(e.target.name==='source_filter')this.syncSourceSelection();};
    this.onOutcomeInput=e=>{if(e.target.matches('[data-outcome-control]'))this.outcomeController?.capture();};
    this.onResultsKey=e=>{if(e.key==='Enter'&&e.target.matches('[data-result-filter="query"]')){e.preventDefault();this.change(e).catch(x=>this.fail(x));}};
    this.onSubmit=e=>{if(e.target.matches('[data-impl-form]')){e.preventDefault();this.saveForm(e.target).catch(x=>this.fail(x));}};
    this.root.addEventListener('click',this.onClick);this.root.addEventListener('change',this.onChange);this.root.addEventListener('input',this.onInput);this.root.addEventListener('keydown',this.onResultsKey);this.root.addEventListener('submit',this.onSubmit);this.root.addEventListener('input',this.onOutcomeInput);
    this.beforeUnload=e=>{if(this.dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',this.beforeUnload);
    this.workspace=host.getState?.()?.workspace_key||'offline';this.storageKey='upstate.implementation.drafts/v1/'+this.workspace;this.readLocal();this.evidence=attachImplementationEvidence(this);this.readEconomic();
  }
  async start(){
    this.render();
    if(this.native){await this.reloadList();if(!this.catalog){const c=await this.read('/api/implementation/catalog');this.catalog=c.catalog||c;}}
    if(!this.plan){const first=(this.economicHandoff?.plan_id&&this.offlineCopies[this.economicHandoff.plan_id]?this.economicHandoff.plan_id:null)||this.planList[0]?.id||Object.keys(this.offlineCopies)[0];if(first)await this.openPlan(first);else{this.plan=makePlan();this.briefingIntake=null;this.dirty=true;this.cache();}}
    this.render();
  }
  readEconomic(){
    this.economicHandoff=null;
    try{const value=JSON.parse(localStorage.getItem(this.storageKey+'/economic-handoff')||'null');if(value?.binding?.workspace_key===this.workspace)this.economicHandoff=value;}catch{}
  }
  cacheEconomic(){
    try{if(this.economicHandoff)localStorage.setItem(this.storageKey+'/economic-handoff',JSON.stringify(this.economicHandoff));else localStorage.removeItem(this.storageKey+'/economic-handoff');}
    catch{this.message='Keep this view open until the native import completes; the browser could not retain the handoff.';}
  }
  async receiveEconomicScenario(payload){
    if(!this.native||this.gone||payload?.workspace_key!==this.workspace||this.host.getState?.()?.workspace_key!==this.workspace)throw Error('Open this economic scenario in its original native workspace.');
    const binding=Object.fromEntries(['workspace_key','edition_id','run_id','report_id','report_sha256','zone_id'].map(key=>[key,payload[key]]));
    const old=this.economicHandoff;
    if(old&&old.stage!=='complete'&&!docEqual(old.binding,binding))throw Error('Finish or dismiss the retained economic scenario before opening another.');
    const turn=this.generation;
    const edition=await this.read('/api/economic-desk/edition',{edition_id:binding.edition_id});
    const module=await import('./economic_implementation.mjs');
    if(this.gone||turn!==this.generation||this.host.getState?.()?.workspace_key!==this.workspace)throw Error('The selected workspace or plan changed while opening this economic scenario. Open it again.');
    const choices=module.economicImplementationOptions(edition,this.workspace);
    const actual=module.economicImplementationSelection(choices,binding.run_id);
    if(!docEqual(actual,binding))throw Error('The handoff differs from the original saved edition, native report or zone.');
    const choice=choices.alternatives.find(row=>row.run_id===binding.run_id);
    this.economicHandoff={...(old&&docEqual(old.binding,binding)?old:{}),binding,
      review:{title:choices.edition_title,zone_title:choices.zone_title,alternative:choice},
      stage:old&&docEqual(old.binding,binding)?old.stage:'review'};
    this.tab='sources';this.cacheEconomic();
    if(!this.root.querySelector('dialog[open]'))this.render();
    else this.host.toast?.('The economic scenario is retained. Close the current editor to review its import.');
    return {accepted:true,edition_id:binding.edition_id,run_id:binding.run_id};
  }
  economicPanel(){
    const h=this.economicHandoff;if(!h)return '';
    const alternative=h.review?.alternative||{},binding=h.binding;
    const costs=alternative.original_cost;
    const saving=h.stage==='saving'||h.stage==='importing';
    const summary=alternative.outputs?.map(output=>'<li>'+esc(output.label||output.metric)+': '+esc(output.reduction??'Unavailable')+' '+esc(output.units||'')+' avoided export</li>').join('')||'';
    return '<section class="iw-notice" aria-label="Economic scenario handoff"><div class="iw-section-head"><h3>'+esc(h.stage==='complete'?'Economic source imported':'Plan one retained economic scenario')+'</h3>'+button('economic-dismiss',h.stage==='complete'?'Close':'Dismiss selection','',saving?'iw-disabled':'')+'</div><p><b>'+esc(alternative.label||binding.run_id)+'</b> · '+esc(h.review?.zone_title||binding.zone_id)+'</p><p>'+esc(h.review?.title||binding.edition_id)+'</p>'+(summary?'<ul>'+summary+'</ul>':'')+'<p>'+esc(costs?'Original '+costs.currency+' estimate: capital '+costs.capital+'; annual operating '+costs.annual_operating+'. Cost source and footprint travel with this scenario.':'This scenario has no supplied implementation cost.')+'</p><p>One complete scenario becomes one source-linked candidate. Its reporting area, signed physical changes and original assumptions are retained. Choose tasks, field methods and cost ledger entries in this plan.</p>'+(alternative.eligible===false?'<p>Saved screening: '+esc((alternative.decision?.reasons||[]).join('; ')||'outside the edition’s prepared criteria')+'.</p>':'')+'<details><summary>Original scenario and cost context</summary><pre class="iw-json">'+esc(JSON.stringify({binding,original_cost:costs||null,calculated_cost:alternative.cost||null,outputs:alternative.outputs||[]},null,2))+'</pre></details>'+
      (h.stage==='complete'?'<p>Attached to plan '+esc(h.plan_id)+' at native revision '+esc(h.revision)+'. Open the source register below or use Add method workflow to plan its work.</p>':
      saving?'<p>The original '+esc(h.stage==='saving'?'plan save':'source import')+' operation is retained. Its native task and browser draft remain available.</p>':
      '<div class="iw-actions">'+button('economic-import',this.dirty||!this.nativePlan?'Save this plan and import scenario':'Import scenario into this plan','','iw-primary')+button('economic-new','Create a new plan for this scenario')+'</div><p>Current plan: '+esc(this.plan?.title||'')+'. Use Saved plan above to choose another existing plan.</p>')+'</section>';
  }
  async importEconomicScenario(){
    const h=this.economicHandoff;
    if(!h||!this.native||this.gone)throw Error('Open a retained economic scenario first.');
    if(this.pending)throw Error('Finish the retained native plan operation before importing this scenario.');
    if(this.root.querySelector('dialog[open]'))throw Error('Finish the current plan editor before importing this scenario.');
    if(h.binding.workspace_key!==this.workspace||this.host.getState?.()?.workspace_key!==this.workspace)throw Error('The scenario belongs to another workspace.');
    if(h.stage==='complete')return;
    if(['saving','importing'].includes(h.stage))throw Error('Reopen the retained plan and finish its original economic import operation.');
    h.plan_id=this.plan.id;h.stage=this.dirty||!this.nativePlan?'saving':'importing';h.operation_id=null;this.cacheEconomic();
    try{
      if(h.stage==='saving'){
        const kind=this.importedFile?'implementation.plan.import':this.nativePlan?'implementation.plan.save':'implementation.plan.create';
        await this.queue(kind,{document:this.plan,expected_revision:this.plan.revision});
      }else{
        await this.queue('implementation.source.import',{
          kind:'economic_scenario',source_id:h.binding.edition_id,...h.binding,
          selected_ids:[h.binding.run_id],plan_id:this.plan.id,expected_revision:this.plan.revision
        });
      }
    }catch(error){
      if(!this.pending&&!h.operation_id){h.stage='review';this.cacheEconomic();}
      throw error;
    }
  }
  async finishEconomicOperation(pending){
    const h=this.economicHandoff;
    if(!h||h.operation_id!==pending.operation_id||h.plan_id!==pending.plan_id)return;
    if(pending.action==='implementation.source.import'&&h.stage==='importing'){
      h.stage='complete';h.revision=this.nativePlan?.revision;this.tab='sources';this.cacheEconomic();this.render();return;
    }
    if(h.stage==='saving'){
      h.operation_id=null;h.stage='review';this.cacheEconomic();
      if(this.dirty||this.plan.id!==h.plan_id){this.message='The plan revision was saved. Review the retained browser changes, then import the economic scenario.';this.render();return;}
      await this.importEconomicScenario();
    }
  }

  closeSampleQC(){if(this.qcModule)this.qcModule.detachImplementationQC(this);else{this.qcEditor?.close();this.qcEditor=null;}}
  async openSampleQC(){
    if(!this.native||!this.nativePlan?.revision)throw Error('Save or reopen the original native plan before reviewing sample quality control.');
    if(this.pending)throw Error('Finish the retained plan operation before opening its saved-revision quality review.');
    if(this.root.querySelector('dialog[open]'))throw Error('Finish the current field editor before opening sample quality control.');
    const turn=this.generation,selected=this.plan.id,revision=this.nativePlan.revision,workspace=this.workspace;
    if(!this.qcModule)this.qcModule=await import('./implementation_qc.mjs');
    if(this.gone||turn!==this.generation||this.plan?.id!==selected||this.nativePlan?.revision!==revision||this.workspace!==workspace||this.host.getState?.()?.workspace_key!==workspace)return;
    await this.qcModule.openImplementationQC(this);
  }
  async deploymentCapability(){
    if(!this.native)throw Error('Open the original native workspace to prepare field crew packets.');
    if(!this.deploymentModule)this.deploymentModule=await import('./implementation_deployment.mjs');
    return this.deploymentModule;
  }
  deploymentPanel(){
    if(!this.native)return '';
    if(this.deploymentModule)return this.deploymentModule.render(this);
    return '<section class="iw-notice"><h3>Field crew packets</h3><p>Retain a saved visit selection with crew sheets, protocols, calendar, site geometry and the complete offline field editor.</p>'+button('deployment-open','Prepare or reopen crew packet')+'</section>';
  }
  async dispatchCapability(){
    if(!this.native)throw Error('Open the original native workspace to prepare retained laboratory requests.');
    if(!this.dispatchModule)this.dispatchModule=await import('./implementation_dispatch.mjs');
    return this.dispatchModule;
  }
  dispatchPanel(){
    if(!this.native)return '';
    if(this.dispatchModule)return this.dispatchModule.render(this);
    return '<section class="iw-notice"><h3>Laboratory requests and returns</h3><p>Choose original saved samples, explicitly request analyses and retain their submission files and returned-result comparison.</p>'+button('dispatch-open',this.labDispatch?'Reopen laboratory requests':'Prepare or reopen laboratory request')+'</section>';
  }
  async labCapability(){
    if(!this.native)throw Error('Laboratory source intake uses the original native workspace. Keep offline field changes in the complete plan JSON.');
    if(!this.labModule)this.labModule=await import('./implementation_lab.mjs');
    return this.labModule;
  }
  labPanel(){
    if(!this.native)return '';
    if(this.labModule)return this.labModule.render(this);
    return '<section class="iw-notice"><h3>Laboratory CSV results</h3><p>Import an original laboratory file into existing samples and activities through explicit mapping, source review and one saved revision.</p>'+button('lab-open',this.labIntake?'Reopen laboratory intake':'Import laboratory CSV')+'</section>';
  }
  observationBindingCurrent(flow=this.observationFlow){
    return !!flow?.preview && flow.preview.workspace_key===this.workspace &&
      flow.preview.plan_id===this.plan?.id && flow.preview.revision===this.plan?.revision &&
      !this.dirty && !!this.nativePlan && docEqual(this.plan,this.nativePlan);
  }
  async reviewFieldObservations(){
    if(!this.native||this.gone||this.host.getState?.()?.workspace_key!==this.workspace)throw Error('Open the original native workspace to register field observations.');
    if(this.pending)throw Error('Finish the retained plan operation first.');
    if(this.root.querySelector('dialog[open]'))throw Error('Finish the current field editor first.');
    if(this.dirty||!this.nativePlan){
      this.observationFlow={stage:'saving',plan_id:this.plan.id,operation_id:null};
      this.cache();
      try{
        const kind=this.importedFile?'implementation.plan.import':this.nativePlan?'implementation.plan.save':'implementation.plan.create';
        await this.queue(kind,{document:this.plan,expected_revision:this.plan.revision});
      }catch(error){if(!this.pending){this.observationFlow=null;this.cache();}throw error;}
      return;
    }
    const turn=this.generation,selected=clone(this.plan);
    this.observationFlow={stage:'previewing',plan_id:selected.id};this.cache();this.render();
    try{
      const result=await this.read('/api/implementation/observations-preview',{plan_id:selected.id,revision:selected.revision});
      if(this.gone||turn!==this.generation||this.host.getState?.()?.workspace_key!==this.workspace)return;
      if(!docEqual(this.plan,selected)||this.dirty)throw Error('Field records changed while the preview opened. Save and review their new revision.');
      if(result.schema!=='upstate.implementation-observation-context/v1'||result.workspace_key!==this.workspace||
        result.plan_id!==selected.id||result.revision!==selected.revision||!result.document_digest||!result.operation_id||
        result.plan?.id!==selected.id||result.plan?.revision!==selected.revision)throw Error('The observation preview does not match this saved plan revision.');
      this.observationFlow={stage:'review',plan_id:selected.id,preview:result};this.tab='field';this.cache();this.render();
    }catch(error){
      if(this.gone||turn!==this.generation)return;
      this.observationFlow=null;this.cache();
      throw error;
    }
  }
  async registerFieldObservations(){
    const flow=this.observationFlow;
    if(!this.observationBindingCurrent(flow))throw Error('Save and review the current field revision before registering its observations.');
    if(this.pending)throw Error('Finish the retained plan operation first.');
    if(!(flow.preview.summary?.row_count>0))throw Error('Record an observation before registering this field revision.');
    flow.stage='importing';flow.operation_id=null;this.cache();
    try{
      await this.queue('implementation.observations.import',{
        plan_id:flow.preview.plan_id,revision:flow.preview.revision,
        document_digest:flow.preview.document_digest,observation_operation_id:flow.preview.operation_id
      });
    }catch(error){if(!this.pending&&!flow.operation_id){flow.stage='review';this.cache();}throw error;}
  }
  async finishObservationSave(pending){
    const flow=this.observationFlow;
    if(!flow||flow.stage!=='saving'||flow.operation_id!==pending.operation_id||flow.plan_id!==pending.plan_id)return;
    this.observationFlow=null;this.cache();
    if(this.dirty){this.message='The field revision is saved. Later browser edits remain available; save and review them when ready.';this.render();return;}
    await this.reviewFieldObservations();
  }
  completeObservationImport(pending,result){
    const selected=pending.payload;
    if(result?.schema!=='upstate.implementation-observation-context/v1'||
      result.workspace_key!==this.workspace||result.plan_id!==selected.plan_id||
      result.revision!==selected.revision||result.document_digest!==selected.document_digest||result.operation_id!==selected.observation_operation_id||
      !Array.isArray(result.observation_ids)||!result.source_collection_id)throw Error('The completed observation import does not match its retained revision.');
    this.observationReceipts=this.observationReceipts||[];
    const existing=this.observationReceipts.find(row=>row.operation_id===result.operation_id);
    if(existing&&JSON.stringify(existing.observation_ids)!==JSON.stringify(result.observation_ids))throw Error('This retained field-source operation already refers to a different observation edition.');
    if(!existing)this.observationReceipts.push(clone(result));
    this.observationFlow={stage:'complete',plan_id:pending.plan_id,preview:clone(result)};
    this.pending=null;this.error='';this.message='Field revision '+result.revision+' is registered in Observed water quality. Its original plan and report source are retained.';
    this.tab='field';this.cache();this.render();
  }
  async openFieldObservation(index,source=false){
    const receipt=(this.observationReceipts||[]).at(-1);
    if(!receipt||receipt.workspace_key!==this.workspace||this.host.getState?.()?.workspace_key!==this.workspace)throw Error('Open the registered field edition in its original workspace.');
    if(typeof this.host.openItem!=='function')throw Error('This operator needs its original item opener.');
    const id=source?(receipt.report_source?.source_collection_id||receipt.source_collection_id):receipt.observation_ids[index];
    if(typeof id!=='string'||!id)throw Error('Choose a retained observation item.');
    this.cache();
    await (this.host.refresh?.({force:true})||this.host.refreshState?.({force:true}));
    if(this.gone||this.host.getState?.()?.workspace_key!==this.workspace)return;
    if(!source)this.host.navigate?.('observations');
    await this.host.openItem(source?'sources':'observations',id);
  }
  async prepareFieldObservationReport(){
    const receipt=(this.observationReceipts||[]).at(-1),selection=receipt?.report_source?.delivery_selection;
    if(!receipt||receipt.workspace_key!==this.workspace||this.host.getState?.()?.workspace_key!==this.workspace)throw Error('Open the registered field edition in its original workspace.');
    if(!selection||typeof selection!=='object'||Array.isArray(selection))throw Error('The retained field report selection is unavailable.');
    if(typeof this.host.openDelivery!=='function')throw Error('This operator needs its original delivery preparation capability.');
    if(document.querySelector('dialog[open]'))throw Error('Finish the current report or field editor before preparing another report.');
    this.cache();
    await this.host.openDelivery(clone(selection));
  }
  async publishFieldObservationReport(){
    const receipt=(this.observationReceipts||[]).at(-1),source=receipt?.report_source;
    if(!receipt||receipt.workspace_key!==this.workspace||receipt.plan_id!==this.plan?.id||this.host.getState?.()?.workspace_key!==this.workspace)throw Error('Open the registered field edition in its original workspace and plan.');
    if(this.root.querySelector('dialog[open]'))throw Error('Finish the current field editor before opening the report publisher.');
    const turn=this.generation,planId=this.plan.id;
    const module=await import('./implementation_source_reports.mjs');
    if(this.gone||turn!==this.generation||this.plan?.id!==planId||this.host.getState?.()?.workspace_key!==this.workspace)return;
    await module.openImplementationSourceReport(this,[source],{title:'Field observations · saved revision '+receipt.revision});
  }
  fieldObservationPanel(){
    if(!this.native)return '';
    const flow=this.observationFlow,receipt=(this.observationReceipts||[]).at(-1);
    const summary=flow?.preview?.summary,working=['saving','previewing','importing'].includes(flow?.stage);
    const counts=summary?'<dl>'+[['Original records',summary.row_count],['Numeric',summary.numeric_count],['Censored',summary.censored_count],['Text',summary.text_count],['Missing',summary.missing_count],['Sites',summary.site_count],['Activities',summary.activity_count],['Records without collection time',summary.collection_time_missing_count],['Sites without coordinates',summary.coordinate_missing_site_count]].map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value??'')+'</dd>').join('')+'</dl>':'';
    const review=flow?.stage==='review'?'<p>Saved revision '+esc(flow.preview.revision)+'. Review the original records and their coverage before registering this edition.</p>'+counts+
      '<div class="iw-actions">'+button('observations-import','Register saved field observations','',this.observationBindingCurrent(flow)&&summary?.row_count>0?'iw-primary':'iw-disabled')+button('observations-dismiss','Dismiss preview')+'</div>':'';
    const ready=receipt?'<section><h4>Registered field revision '+esc(receipt.revision)+'</h4><p>'+esc(receipt.summary?.row_count??'')+' original records. This edition remains tied to its saved plan revision even after later field edits.</p><div class="iw-actions">'+receipt.observation_ids.map((id,index)=>button('observations-open','Open observed data'+(receipt.observation_ids.length>1?' '+(index+1):''),'data-index="'+index+'"')).join('')+button('observations-source','Open retained source and report')+(receipt.report_source?.delivery_selection&&typeof this.host.openDelivery==='function'?button('observations-report','Prepare client report'):'')+(receipt.report_source?.source_id&&typeof this.host.openScientificReport==='function'?button('observations-publish','Prepare standalone scientific report'):'')+button('observations-details','Inspect observation edition')+'</div></section>':'';
    return '<section class="iw-notice" aria-label="Field observations in the scientific workspace"><h3>Use saved field records in Observed water quality</h3><p>Register the actual observations with their sites, collection times, sample relationships, methods and original qualifiers. Censored, text and missing results retain their original meaning. The same saved revision also supplies its field-observation report source.</p>'+
      (working?'<p>'+esc(flow.stage==='saving'?'Saving the field revision before review.':flow.stage==='previewing'?'Reading the original saved field revision.':'Registering the retained field revision through its original native operation.')+'</p>':
      '<div class="iw-actions">'+button('observations-review',this.dirty||!this.nativePlan?'Save and review field observations':'Review saved field observations','','iw-primary')+'</div>')+review+ready+'</section>';
  }

  readLocal(){try{const data=JSON.parse(localStorage.getItem(this.storageKey)||'{"plans":{}}');this.offlineCopies=data.plans||{};}catch(e){this.message='Browser storage could not be read. Export JSON to retain your work.';}}
  cache(){if(!this.plan)return;this.offlineCopies[this.plan.id]={document:clone(this.plan),dirty:this.dirty,pending:this.pending?clone(this.pending):null,observationFlow:this.observationFlow?clone(this.observationFlow):null,observationReceipts:clone(this.observationReceipts||[]),labIntake:this.labIntake?clone(this.labIntake):null,briefingIntake:this.briefingIntake?clone(this.briefingIntake):null,labDispatch:this.labDispatch?clone(this.labDispatch):null,planReportSource:this.planReportSource?clone(this.planReportSource):null,fieldDeployment:this.fieldDeployment?.plan_id===this.plan.id?clone(this.fieldDeployment):null,resultView:normalizeResultsView(this.resultView),updated_at:new Date().toISOString()};try{localStorage.setItem(this.storageKey,JSON.stringify({schema:'upstate.implementation-drafts/v1',plans:this.offlineCopies}));}catch(e){this.message='Browser storage is full or unavailable. Use Export JSON to save the current plan.';}}
  status(message){this.message=message;this.error='';this.render();}
  fail(error){if(this.gone)return;this.error=error?.message||String(error);const dialog=this.root.querySelector('dialog[open]');if(dialog){let notice=dialog.querySelector('.iw-form-error');if(!notice){notice=document.createElement('pre');notice.className='iw-error iw-form-error';notice.setAttribute('role','alert');dialog.querySelector('[data-impl-dialog]').prepend(notice);}notice.textContent=this.error;}else this.render();this.host.toast?.(this.error.slice(0,180));}
  async outcomeCapability(){
    if(!this.native)throw Error('Open the saved implementation plan in its native workspace.');
    if(!this.outcomeModule)this.outcomeModule=await import('./implementation_outcomes.mjs');
    if(!this.outcomeController)this.outcomeController=this.outcomeModule.createOutcomeController(this);
    return this.outcomeController;
  }
  outcomePanel(){
    if(!this.native)return '<p>Receive the complete field plan into its original native Workspace, then open its saved revision to compare observations.</p>';
    if(this.outcomeController)return this.outcomeController.render();
    return '<section><h3>Observed implementation outcomes</h3><p>Compare before and after observations from an exact saved revision, with optional original control sites, measurement support and intervention evidence.</p>'+button('outcomes-open','Open saved-revision observations')+'</section>';
  }
  async read(path,args={}){return this.host.api(this.host.endpoint?this.host.endpoint(path,args):path+'?'+new URLSearchParams({workspace:this.workspace,...args}));}
  async reloadList(){if(this.native){const r=await this.read('/api/implementation/list');if(this.gone)return;this.planList=r.plans||r.implementation_plans||[];}else this.planList=Object.values(this.offlineCopies).map(x=>x.document);}
  async openPlan(id,preferNative=false,revision=null){
    this.closeSampleQC();
    const turn=++this.generation;this.cache();let remote=null,history=[],downloads=[],reports=[];
    if(this.native){try{const r=await this.read('/api/implementation/detail',{id,...(revision===null?{}:{revision})});remote=r.plan||r.document||null;history=r.history||[];downloads=r._downloads||[];reports=r.reports||[];}catch(e){if(preferNative||!this.offlineCopies[id])throw e;}}
    if(this.gone||turn!==this.generation)return;
    const local=this.offlineCopies[id];
    if(preferNative&&remote){if(local?.dirty)this.preserveDraft(local.document,'before-native-reopen');this.plan=clone(remote);this.dirty=false;}
    else if(local?.dirty){this.plan=clone(local.document);this.dirty=true;}
    else if(remote){this.plan=clone(remote);this.dirty=false;}
    else if(local){this.plan=clone(local.document);this.dirty=!!local.dirty;}
    else throw Error('This plan is not available in the selected workspace.');
    this.history=history;this.downloads=downloads;this.reports=reports;this.nativePlan=remote?clone(remote):null;this.importedFile=!remote&&this.native&&this.plan.revision>0;this.pending=local?.pending||null;this.observationFlow=local?.observationFlow||null;this.observationReceipts=local?.observationReceipts||[];this.labIntake=local?.labIntake||null;this.briefingIntake=local?.briefingIntake||null;if(['uploading','opening','previewing'].includes(this.briefingIntake?.stage)){this.briefingIntake.stage='selecting';this.briefingIntake.preview=null;}this.fieldDeployment=local?.fieldDeployment||null;if(this.fieldDeployment&&['previewing','opening'].includes(this.fieldDeployment.stage)){this.fieldDeployment.stage='selecting';this.fieldDeployment.preview=null;}this.planReportSource=local?.planReportSource||null;if(this.planReportSource?.stage==='previewing')this.planReportSource=null;this.labDispatch=local?.labDispatch||null;if(['loading','previewing','reconciling','opening','report-previewing'].includes(this.labDispatch?.stage)){this.labDispatch.stage='editing';this.labDispatch.preview=null;this.labDispatch.reconciliation=null;if(this.labDispatch.reportFlow?.stage==='previewing'){this.labDispatch.reportFlow.preview=null;this.labDispatch.reportFlow.stage='idle';}}this.resultView=normalizeResultsView(local?.resultView);if(['uploading','inspecting','previewing'].includes(this.labIntake?.stage)){this.labIntake.stage='mapping';this.labIntake.preview=null;}if(this.observationFlow?.stage==='previewing')this.observationFlow=null;this.error='';this.message=remote&&local?.dirty&&remote.revision!==local.document.revision?'A newer native revision exists. Your browser draft is retained; export it before choosing Reopen native.':'';this.cache();this.render();
  }
  async receiveSavedPlan(payload){
    if(!this.native||this.gone||payload?.workspace_key!==this.workspace||this.host.getState?.()?.workspace_key!==this.workspace)throw Error('Open the saved plan in its received workspace.');
    if(typeof payload.plan_id!=='string'||!payload.plan_id)throw Error('Choose the original saved plan.');
    const revision=payload.revision??null;
    if(revision!==null&&(!Number.isSafeInteger(revision)||revision<1))throw Error('Choose the original saved revision.');
    if(this.root.querySelector('dialog[open]'))throw Error('Close the current plan editor before opening the received plan.');
    await this.openPlan(payload.plan_id,true,revision);
    if(this.gone||this.plan?.id!==payload.plan_id||revision!==null&&this.plan.revision!==revision)throw Error('The saved plan changed while opening its original revision.');
    this.tab='handover';this.message='Opened the original saved plan at native revision '+this.plan.revision+'. Its retained reports and source files are available below.';this.render();
    return {accepted:true,workspace_key:this.workspace,plan_id:this.plan.id,revision:this.plan.revision};
  }
  nativeDownloads(rows){
    return (rows||[]).map(row=>{
      if(typeof row.url!=='string'||!/^\/api\/file\/[0-9a-f]{64}$/.test(row.url))return '';
      return '<a href="'+esc(row.url+'?download=1')+'" download>'+esc(row.label||row.filename||row.name||'Original file')+'</a>';
    }).filter(Boolean).join(' · ');
  }
  planReportSourcePanel(){
    const flow=this.planReportSource;
    if(!flow||flow.plan_id!==this.plan?.id)return '';
    const preview=flow.preview,ready=flow.result;
    return '<section class="iw-notice" aria-label="Implementation report source"><h3>Whole plan in the scientific report</h3>'+
      (preview?'<p><b>'+esc(preview.title)+'</b> · saved revision '+esc(preview.plan_binding.revision)+' · original report date '+esc(preview.as_of)+'</p>'+
      '<p>'+Object.entries(preview.counts).map(([name,count])=>esc(count)+' '+esc(name.replaceAll('_',' '))).join(' · ')+'</p>'+
      '<p>'+esc(preview.original_report_member_count)+' original report files and '+esc(preview.attachment_count)+' available original attachments. Other source references remain listed with their actual availability.</p>'+
      this.table(['Original attachment','State'],preview.attachment_inventory.map(row=>[esc(row.label),esc(row.state.replaceAll('_',' '))])):'')+
      '<p>The selected report stays at its original saved revision. Your editable plan and browser draft remain available.</p>'+
      (flow.stage==='registering'?'<p>The original source registration is retained in the task queue.</p>':
       ready?'<p>'+this.nativeDownloads(ready._downloads)+'</p><div class="iw-actions">'+button('plan-report-open','Open scientific report','','iw-primary')+'</div>':
       preview?'<div class="iw-actions">'+button('plan-report-register','Register reviewed report source','','iw-primary')+'</div>':'<p>Opening the selected original report…</p>')+
      (!this.pending?'<div class="iw-actions">'+button('plan-report-dismiss','Close report review')+'</div>':'')+'</section>';
  }
  async previewPlanReportSource(reportId){
    if(!this.native||this.pending)throw Error('Finish the retained native operation before reviewing another report.');
    const row=(this.reports||[]).find(item=>item.id===reportId);
    if(!row)throw Error('Choose an original report retained with this plan.');
    const planId=this.plan.id,workspace=this.workspace,turn=this.generation;
    this.planReportSource={stage:'previewing',plan_id:planId,report_id:reportId};this.cache();this.render();
    try{
      const result=await this.host.api('/api/implementation/report-source-preview',{method:'POST',body:{workspace,plan_id:planId,report_id:reportId}});
      if(this.gone||turn!==this.generation||this.workspace!==workspace||this.plan?.id!==planId||this.planReportSource?.report_id!==reportId)return;
      if(result.report_id!==reportId||result.plan_binding?.plan_id!==planId||result.plan_binding?.revision!==row.revision||result.workspace_key!==workspace)throw Error('The report preview names another saved plan edition.');
      this.planReportSource={stage:'review',plan_id:planId,report_id:reportId,preview:result};this.cache();this.render();
    }catch(error){if(!this.gone&&turn===this.generation&&this.planReportSource?.report_id===reportId){this.planReportSource=null;this.cache();}throw error;}
  }
  async registerPlanReportSource(){
    const flow=this.planReportSource;
    if(!flow?.preview||flow.stage!=='review'||flow.plan_id!==this.plan?.id)throw Error('Review the original saved report first.');
    flow.stage='registering';this.cache();
    try{await this.queue('implementation.report-source.import',{plan_id:flow.plan_id,report_id:flow.report_id,expected_operation_id:flow.preview.operation_id});}
    catch(error){if(!this.pending&&this.planReportSource===flow){flow.stage='review';this.cache();}throw error;}
  }
  finishPlanReportSource(pending,result){
    const flow=this.planReportSource;
    if(!flow||result?.workspace_key!==this.workspace||result.plan_id!==pending.plan_id||
       result.report_id!==pending.payload.report_id||result.operation_id!==pending.payload.expected_operation_id||
       result.plan_binding?.document_digest!==flow.preview?.plan_binding?.document_digest||
       result.plan_binding?.revision!==flow.preview?.plan_binding?.revision)
      throw Error('The completed source registration differs from the reviewed original report.');
    flow.result=clone(result);flow.stage='complete';this.pending=null;this.error='';
    this.message='The complete original plan report is registered. Open it in the ordered scientific report composer.';
    this.cache();this.render();
  }
  async openPlanReportSource(){
    const flow=this.planReportSource;
    if(!flow?.result||flow.plan_id!==this.plan?.id)throw Error('Register the reviewed report source first.');
    const turn=this.generation,workspace=this.workspace;
    const result=await this.read('/api/implementation/report-source-detail',{source_key:flow.result.source_key,operation_id:flow.result.operation_id});
    if(this.gone||turn!==this.generation||this.workspace!==workspace||this.planReportSource!==flow)return;
    if(result.plan_id!==flow.plan_id||result.report_id!==flow.report_id||result.operation_id!==flow.preview.operation_id)throw Error('The retained report handoff changed.');
    flow.result=clone(result);this.cache();
    const choice={source_collection_id:result.source_collection_id,source_id:result.source_id};
    const {openImplementationSourceReport}=await import('./implementation_source_reports.mjs');
    if(this.gone||turn!==this.generation||this.workspace!==workspace||this.planReportSource!==flow)return;
    await openImplementationSourceReport(this,[choice],{title:flow.preview.title+' — implementation and fieldwork'});
  }
  retainedReports(){
    if(!this.native)return '';
    return '<h3>Retained original files</h3><p>'+this.nativeDownloads(this.downloads)+'</p><h3>Saved native report editions</h3><p>These complete reports retain their exact native revision and original report date. They reopen from this Workspace after transfer.</p>'+this.table(['Revision','Report date','Files','Original downloads','Scientific report'],(this.reports||[]).map(row=>[esc(row.revision),esc(row.as_of),esc(row.files),this.nativeDownloads(row._downloads),button('plan-report-preview','Review whole plan report','data-report-id="'+esc(row.id)+'"')]),'Create a Native report package to retain its complete edition with this plan.')+this.planReportSourcePanel();
  }
  preserveDraft(doc,reason){try{const key=this.storageKey+'/preserved/'+doc.id+'/'+Date.now();localStorage.setItem(key,JSON.stringify({reason,document:doc}));}catch{}download(doc.id+'-'+reason+'.json',JSON.stringify(doc,null,2),'application/json');}
  commitLocal(next,message='Draft saved in this browser.'){
    const issues=validatePlan(next);if(issues.length)throw Error(issues.map(x=>x.path+': '+x.message).join('\n'));
    this.plan=clone(next);this.plan.updated_at=new Date().toISOString();this.dirty=true;this.cache();this.message=message;this.error='';this.render();
  }
  async queue(action,payload){
    if(['implementation.plan.create','implementation.plan.save','implementation.plan.import'].includes(action)&&this.evidence&&await this.evidence.saveIfNeeded())return;
    if(this.pending)throw Error('The previous plan operation is still retained. Open its task or retry its original operation before starting another.');
    const issues=validatePlan(this.plan);if(issues.length)throw Error(issues.map(x=>x.path+': '+x.message).join('\n'));
    this.pending={id:null,operation_id:uid('implementation-op'),action,payload:clone(payload),snapshot:clone(this.plan),plan_id:this.plan.id};
    if(this.economicHandoff&&['saving','importing'].includes(this.economicHandoff.stage)&&this.economicHandoff.plan_id===this.plan.id&&!this.economicHandoff.operation_id){this.economicHandoff.operation_id=this.pending.operation_id;this.cacheEconomic();}
    if(this.observationFlow&&['saving','importing'].includes(this.observationFlow.stage)&&this.observationFlow.plan_id===this.plan.id&&!this.observationFlow.operation_id){this.observationFlow.operation_id=this.pending.operation_id;}
    if(this.labIntake&&['saving','importing'].includes(this.labIntake.stage)&&this.labIntake.plan_id===this.plan.id&&!this.labIntake.operation_id)this.labIntake.operation_id=this.pending.operation_id;
    if(this.briefingIntake&&['saving','importing'].includes(this.briefingIntake.stage)&&this.briefingIntake.plan_id===this.plan.id&&!this.briefingIntake.operation_id)this.briefingIntake.operation_id=this.pending.operation_id;
    if(this.labDispatch&&['saving','preparing'].includes(this.labDispatch.stage)&&this.labDispatch.plan_id===this.plan.id&&!this.labDispatch.operation_id)this.labDispatch.operation_id=this.pending.operation_id;
    if(this.labDispatch?.reportFlow?.stage==='registering'&&!this.labDispatch.reportFlow.operation_id)this.labDispatch.reportFlow.operation_id=this.pending.operation_id;
    this.cache();await this.submitPending();
  }
  async submitPending(){
    if(!this.pending)return;
    const selected=this.pending;
    try{
      const result=await this.host.api('/api/actions',{method:'POST',body:{workspace:this.workspace,action:selected.action,payload:selected.payload,operation_id:selected.operation_id}});
      if(this.gone||this.pending?.operation_id!==selected.operation_id)return;
      const task=result.task||result;this.pending.id=task.id;this.pending.state=task.state;
      this.message='Native operation retained. The current browser draft stays available.';this.cache();
      if(!this.root.querySelector('dialog[open]'))this.render();
      await (this.host.refresh?.({force:true})||this.host.refreshState?.({force:true}));
      if(this.pending?.id&&!this.root.querySelector('dialog[open]'))this.host.showTask?.(this.pending.id);
    }catch(e){
      if(!this.gone&&this.pending?.operation_id===selected.operation_id){this.cache();this.message='The original operation is retained for retry with the same identity.';}
      throw e;
    }
  }
  async resumePending(){
    const selected=this.pending;
    if(!selected?.id||selected.state!=='interrupted')throw Error('Select the retained interrupted operation to resume.');
    const turn=this.generation;
    const result=await this.host.api('/api/task/resume',{method:'POST',body:{id:selected.id}});
    if(this.gone||turn!==this.generation||this.pending?.operation_id!==selected.operation_id)return;
    const task=result.task||result;this.pending.state=task.state;this.error='';this.message='The original native operation has resumed.';this.cache();
    if(!this.root.querySelector('dialog[open]'))this.render();
    await (this.host.refresh?.({force:true})||this.host.refreshState?.({force:true}));
  }
  async update(state){
    if(this.gone||!this.native)return;
    if(state?.workspace_key&&state.workspace_key!==this.workspace){this.detach();return;}
    this.lastState=state;this.planList=state?.data?.implementation_plans||this.planList;
    if(this.outcomeController)await this.outcomeController.update(state);
    if(this.gone||state?.workspace_key&&state.workspace_key!==this.workspace)return;
    const pending=this.pending;if(!pending)return;
    const task=(state.tasks||[]).find(t=>(pending.id&&t.id===pending.id)||t.operation_id===pending.operation_id);if(!task)return;
    pending.id=task.id;pending.state=task.state;
    if(task.state==='interrupted'){
      this.error=task.error?.message||'The native operation was interrupted. Resume its original task to continue.';
      this.message='The original operation and browser draft are retained.';this.cache();
      if(!this.root.querySelector('dialog[open]'))this.render();
      return;
    }
    if(['failed','cancelled'].includes(task.state)){
      this.error=task.error?.message||'The native operation '+task.state+'. Your browser draft is retained.';
      if(task.error?.code==='IMPLEMENTATION_REVISION_CONFLICT')this.error+=' Reopen the current native plan to compare; export this draft to retain all field changes.';
      if(this.economicHandoff?.operation_id===pending.operation_id){this.economicHandoff.stage='review';this.economicHandoff.operation_id=null;this.cacheEconomic();}
      if(this.observationFlow?.operation_id===pending.operation_id){this.observationFlow.stage=this.observationFlow.preview?'review':'idle';this.observationFlow.operation_id=null;}
      if(this.labIntake?.operation_id===pending.operation_id){this.labIntake.stage=this.labIntake.preview?'review':'mapping';this.labIntake.operation_id=null;}
      if(this.briefingIntake?.operation_id===pending.operation_id){this.briefingIntake.stage=this.briefingIntake.preview?'review':'selecting';this.briefingIntake.operation_id=null;}
      if(this.labDispatch?.operation_id===pending.operation_id){this.labDispatch.stage=this.labDispatch.preview?'review':'editing';this.labDispatch.operation_id=null;this.labDispatch.after_save=null;}
      if(this.labDispatch?.reportFlow?.operation_id===pending.operation_id){this.labDispatch.reportFlow.operation_id=null;this.labDispatch.reportFlow.stage=this.labDispatch.reportFlow.preview?'review':'idle';this.labDispatch.stage='editing';}
      if(pending.action==='implementation.report-source.import'&&this.planReportSource)this.planReportSource.stage='review';
      if(pending.action==='implementation.field-deployment.prepare'&&this.fieldDeployment)this.fieldDeployment.stage=this.fieldDeployment.preview?'review':'selecting';
      this.pending=null;this.cache();if(!this.root.querySelector('dialog[open]'))this.render();return;
    }
    if(task.state!=='complete')return;
    this.cache();
    if(this.root.querySelector('dialog[open]')||this.resolvingOperation===pending.operation_id)return;
    this.resolvingOperation=pending.operation_id;const turn=this.generation;
    const current=()=>!this.gone&&turn===this.generation&&this.plan?.id===pending.plan_id&&this.pending?.operation_id===pending.operation_id;
    try{
      if(pending.action==='implementation.field-deployment.prepare'){const deployment=await this.deploymentCapability();if(!current())return;deployment.finish(this,pending,task.result);return;}
      if(pending.action==='implementation.report-source.import'){if(!current())return;this.finishPlanReportSource(pending,task.result);return;}
      if(pending.action==='implementation.observations.import'){
        if(!current())return;
        this.completeObservationImport(pending,task.result);return;
      }
      if(pending.action==='implementation.lab.dispatch-report'){const dispatch=await this.dispatchCapability();if(!current())return;dispatch.finishReport(this,pending,task.result);return;}
      if(pending.action==='implementation.lab.dispatch'){const dispatch=await this.dispatchCapability();if(!current())return;dispatch.validateReceipt(this,pending,task.result);await dispatch.finish(this,pending,task.result);return;}
      if(pending.action==='implementation.briefing.import')briefingFollowup.validateReceipt(this,pending,task.result);
      if(pending.action==='implementation.lab.import'){const lab=await this.labCapability();if(!current())return;lab.validateReceipt(this,pending,task.result);}
      await this.reloadList();if(!current())return;
      const r=await this.read('/api/implementation/detail',{id:pending.plan_id});
      if(!current()||this.root.querySelector('dialog[open]'))return;
      this.nativePlan=clone(r.plan||r.document);this.history=r.history||[];this.downloads=r._downloads||[];this.reports=r.reports||[];this.pending=null;this.error='';
      if(docEqual(this.plan,pending.snapshot)){this.plan=clone(this.nativePlan);this.dirty=false;this.importedFile=false;this.message=pending.action==='implementation.plan.report'?'Native report package is ready for revision '+this.plan.revision+'.':'Native revision '+this.plan.revision+' saved and reopened.';}
      else this.message='Native revision '+this.nativePlan.revision+' saved. Later browser edits are retained separately; export or reconcile them before the next commit.';
      this.cache();this.render();await this.finishEconomicOperation(pending);await this.finishObservationSave(pending);
      if(this.briefingIntake?.operation_id===pending.operation_id)await briefingFollowup.finish(this,pending,task.result);
      if(this.labIntake?.operation_id===pending.operation_id){const lab=await this.labCapability();if(!this.gone&&this.plan?.id===pending.plan_id)await lab.finish(this,pending,task.result);}
      if(this.labDispatch?.operation_id===pending.operation_id){const dispatch=await this.dispatchCapability();if(!this.gone&&this.plan?.id===pending.plan_id)await dispatch.finish(this,pending,task.result);}
    }catch(e){
      if(current()){this.error=e?.message||String(e);this.message='The completed native operation remains retained. Retry reopening its saved result.';this.cache();if(!this.root.querySelector('dialog[open]'))this.render();}
    }finally{if(this.resolvingOperation===pending.operation_id)this.resolvingOperation=null;}
  }
  detach(){if(this.gone)return;this.closeSampleQC();this.evidence?.detach();this.outcomeController?.detach();this.cache();this.gone=true;this.generation++;this.root.removeEventListener('click',this.onClick);this.root.removeEventListener('change',this.onChange);this.root.removeEventListener('input',this.onInput);this.root.removeEventListener('keydown',this.onResultsKey);this.root.removeEventListener('submit',this.onSubmit);this.root.removeEventListener('input',this.onOutcomeInput);window.removeEventListener('beforeunload',this.beforeUnload);}
  render(){
    if(this.gone)return;this.closeSampleQC();this.evidence?.beforeRender();const p=this.plan;
    if(!p){this.root.innerHTML='<section class="iw"><h2>Implementation & fieldwork</h2><p>Opening retained plans…</p>'+(this.error?'<pre role="alert">'+esc(this.error)+'</pre>':'')+'</section>';return;}
    let stats=null,validation=validatePlan(p);try{if(!validation.length)stats=summarize(p,this.asOf);}catch(e){validation=[{path:'calendar',message:e.message}];}
    const plans=new Map([...this.planList.map(x=>[x.id,x]),...Object.values(this.offlineCopies).map(x=>[x.document.id,x.document]),[p.id,p]]);
    this.root.innerHTML='<section class="iw"><header class="iw-header"><div><p class="iw-eyebrow">UPPER SAVANNAH · IMPLEMENTATION</p><h2>'+esc(p.title)+'</h2><p class="iw-muted">'+esc(this.native?'Native workspace · '+this.workspace:'Portable field workspace')+' · revision '+p.revision+(this.dirty?' · browser draft':'')+'</p></div><div class="iw-actions">'+button('new','New plan')+button('import','Open JSON')+button('settings','Plan settings')+'</div></header><div class="iw-toolbar">'+field('Saved plan','<select data-impl-change="plan">'+options([...plans.values()].map(x=>[x.id,x.title]),p.id,false)+'</select>')+field('Report date','<input type="date" value="'+esc(this.asOf)+'" data-impl-change="asof">')+'<div class="iw-actions">'+button('save',this.native?'Save native revision':'Save browser draft','','iw-primary')+button('export-json','Export JSON')+(this.native?button('reopen','Reopen native'):'')+'</div></div>'+(this.message?'<p class="iw-notice" role="status">'+esc(this.message)+'</p>':'')+(this.error?'<pre class="iw-error" role="alert">'+esc(this.error)+'</pre>':'')+(validation.length?'<div class="iw-error"><b>Complete these fields</b><ul>'+validation.map(v=>'<li>'+esc(v.path+': '+v.message)+'</li>').join('')+'</ul></div>':'')+(this.pending?'<p class="iw-notice">Native operation '+esc(this.pending.id||this.pending.operation_id)+' is retained. '+(!this.pending.id?button('retry-submit','Retry original operation'):this.pending.state==='interrupted'?button('resume-task','Resume original task'):this.pending.state==='complete'?button('refresh-result','Reopen completed result'):'')+'</p>':'') +this.economicPanel()+'<nav class="iw-tabs" aria-label="Implementation views">'+TABS.map(([id,label])=>'<button type="button" data-impl="tab" data-tab="'+id+'" aria-current="'+(this.tab===id?'page':'false')+'">'+label+'</button>').join('')+'</nav><main class="iw-body">'+this.body(stats)+'</main><footer class="iw-footer"><span>'+esc(p.id)+'</span><span>Original candidate sources, dated work and field results remain linked.</span></footer><dialog class="iw-dialog" aria-label="Edit implementation record"><div data-impl-dialog></div></dialog><input hidden type="file" accept=".json,application/json" data-impl-file></section>';
  }
  table(headers,rows,emptyText='No records yet.'){
    return rows.length?'<div class="iw-table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':empty(emptyText);
  }
  editButton(collection,id,label='Edit'){return button('edit',label,'data-collection="'+collection+'" data-id="'+esc(id)+'"');}
  addButton(collection,label){return button('add',label||'Add '+LABELS[collection],'data-collection="'+collection+'"');}
  body(stats){
    const p=this.plan;
    if(this.tab==='overview'){
      const s=stats;
      return '<div class="iw-section-head"><h3>Delivery at a glance</h3>'+button('method','Add method workflow','','iw-primary')+'</div><p>'+esc(p.description||'Link a saved conservation or community intervention selection, assign the work, and record costs and field results in one plan.')+'</p>'+(s?'<div class="iw-stats">'+[['Tasks complete',s.tasks.complete+' / '+s.tasks.total],['Budget',money(s.budget.budget)],['Committed',money(s.budget.commitment)],['Actual cost',money(s.budget.actual)],['Completed visits',s.field.complete_visits+' / '+s.field.visits],['Recorded results',s.field.observations]].map(([l,v])=>'<div><span>'+esc(l)+'</span><strong>'+esc(v)+'</strong></div>').join('')+'</div>':'')+'<div class="iw-two"><section><h3>Work needing attention</h3>'+(s?this.table(['Task','Assigned to','Status'],p.tasks.filter(t=>t.status!=='complete'&&t.status!=='cancelled').slice(0,12).map(t=>[this.editButton('tasks',t.id,t.title),esc(t.assignee||'Unassigned'),esc(t.status.replaceAll('_',' '))]),'All recorded work is complete.'):empty('Complete the plan fields above to calculate the schedule.'))+'</section><section><h3>Upcoming field visits</h3>'+this.table(['Date','Site','Observer'],p.visits.filter(v=>v.status==='planned').sort((a,b)=>(a.planned_date||'9999').localeCompare(b.planned_date||'9999')).slice(0,12).map(v=>[this.editButton('visits',v.id,v.planned_date||'Choose date'),esc(p.sites.find(s=>s.id===v.site_id)?.label||v.site_id),esc(v.observer||'Unassigned')]),'Add a site and plan its first visit.')+'</section></div>'+(s?.schedule.issues.length?'<section><h3>Schedule inputs to finish</h3><ul class="iw-issue-list">'+s.schedule.issues.slice(0,30).map(i=>'<li>'+this.editButton('tasks',i.task_id,p.tasks.find(t=>t.id===i.task_id)?.title||i.task_id)+'<span>'+esc(i.message)+'</span></li>').join('')+'</ul></section>':'');
    }
    if(this.tab==='tasks'){
      const schedule=new Map((stats?.schedule.tasks||[]).map(t=>[t.id,t]));
      return '<div class="iw-section-head"><h3>Assigned work and dependencies</h3><div class="iw-actions">'+this.addButton('tasks')+button('method','Add method workflow')+button('csv','Export tasks','data-collection="tasks"')+'</div></div><p class="iw-muted">Durations are working days on this plan’s calendar. Enter zero for a milestone. A blank duration stays open until estimated.</p>'+this.table(['Task / candidate','Phase','Owner','Status','Days','Scheduled dates','Progress',''],p.tasks.map(t=>{const s=schedule.get(t.id);return ['<b>'+esc(t.title)+'</b><small>'+esc(p.candidates.find(c=>c.id===t.candidate_id)?.label||'')+'</small>',esc(t.phase||''),esc(t.assignee||'Unassigned'),'<span class="iw-state">'+esc(t.status.replaceAll('_',' '))+'</span>',esc(t.duration_days??'Estimate'),s?.start?esc(s.start)+(s.last_work_date&&s.last_work_date!==s.start?'<br>'+esc(s.last_work_date):'')+(s.overdue?'<small>Overdue</small>':''):esc('Awaiting predecessor dates'),'<progress max="100" value="'+t.progress_pct+'"></progress><small>'+t.progress_pct+'%</small>',this.editButton('tasks',t.id)+this.evidence.recordButton('tasks',t.id)];}));
    }
    if(this.tab==='budget'){
      return '<div class="iw-section-head"><h3>Cost ledger · USD</h3><div class="iw-actions">'+this.addButton('budget_lines')+button('csv','Export costs','data-collection="budget_lines"')+'</div></div><p class="iw-muted">Record budget estimates, contractual commitments and actual costs in separate ledger rows. Amounts are preserved as exact cents.</p>'+(stats?'<div class="iw-stats">'+[['Budget',money(stats.budget.budget)],['Committed',money(stats.budget.commitment)],['Actual cost',money(stats.budget.actual)],['Budget less actual',money(stats.budget.remaining)]].map(([l,v])=>'<div><span>'+l+'</span><strong>'+v+'</strong></div>').join('')+'</div>':'')+this.table(['Kind','Description','Task','Amount','Date','Reference',''],p.budget_lines.map(b=>[esc(b.kind),esc(b.label),esc(p.tasks.find(t=>t.id===b.task_id)?.title||''),money(b.amount_minor),esc(b.date||''),esc(b.reference||''),this.editButton('budget_lines',b.id)]));
    }
    if(this.tab==='sites'){
      return '<div class="iw-section-head"><h3>Sites</h3>'+this.addButton('sites')+'</div>'+this.table(['Site','Coordinates','Candidate',''],p.sites.map(s=>[esc(s.label),esc(s.latitude===null||s.latitude===undefined?'':s.latitude+', '+s.longitude),esc(p.candidates.find(c=>c.id===s.candidate_id)?.label||''),this.editButton('sites',s.id)]))+'<div class="iw-section-head"><h3>Monitoring questions</h3>'+this.addButton('monitoring_plans')+'</div>'+this.table(['Plan','Objective','Sites','Parameters','Frequency',''],p.monitoring_plans.map(m=>[esc(m.title),esc(m.objective),(m.site_ids||[]).map(id=>esc(p.sites.find(s=>s.id===id)?.label||id)).join('<br>'),esc((m.parameters||[]).join(', ')),esc(m.frequency||''),this.editButton('monitoring_plans',m.id)]));
    }
    if(this.tab==='outcomes')return this.outcomePanel();
    if(this.tab==='field'){
      const show=(collection,heads,cells,label)=>'<div class="iw-section-head"><h3>'+label+'</h3><div class="iw-actions">'+this.addButton(collection)+button('csv','Export','data-collection="'+collection+'"')+'</div></div>'+this.table(heads,p[collection].map(cells));
      return this.deploymentPanel()+this.dispatchPanel()+this.labPanel()+this.fieldObservationPanel()+'<div class="iw-section-head"><h3>Field capture</h3>'+button('field-form','Use a structured field form','','iw-primary')+(this.native?button('sample-qc','Sample quality control'):'')+'</div>'+show('visits',['Planned','Site','Observer','Status','Actual time',''],v=>[esc(v.planned_date||''),esc(p.sites.find(s=>s.id===v.site_id)?.label||v.site_id),esc(v.observer||''),esc(v.status),esc(v.visited_at||''),this.editButton('visits',v.id)+this.evidence.recordButton('visits',v.id)+button('field-sheet','Field sheet','data-id="'+esc(v.id)+'"')],'Field visits')+show('activities',['Activity','Visit','Kind','Sample ID','Collected',''],a=>[esc(a.id),esc(a.visit_id),esc(a.kind),esc(a.sample_id||''),esc(a.collected_at||''),this.editButton('activities',a.id)+this.evidence.recordButton('activities',a.id)],'Samples and activities')+renderResults(this);
    }
    if(this.tab==='sources'){
      return briefingFollowup.render(this)+'<div class="iw-section-head"><h3>Conservation and intervention selections</h3><div class="iw-actions">'+(this.native?button('source-import','Import native selection','','iw-primary'):'')+this.addButton('candidates','Add source-linked candidate')+'</div></div><p class="iw-muted">Selected rows retain the original scientific source and model references. Community-area totals stay with their original area; source snapshots can be inspected below.</p>'+this.table(['Candidate','Whole area (ha)','Source / native identity','Retained quantities',''],p.candidates.map(c=>[esc(c.label),esc(c.area_ha??''),'<code>'+esc(textObject(c.source))+'</code>','<code>'+esc(textObject(c.modeled_benefits||[]))+'</code>',button('inspect','Inspect source','data-collection="candidates" data-id="'+esc(c.id)+'"')]))+'<div class="iw-section-head"><h3>Source register</h3>'+this.addButton('source_links')+'</div>'+this.table(['Reference','Kind','Location',''],p.source_links.map(s=>{const link=safeLink(s.reference);return [esc(s.label),esc(s.kind),link?'<a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">'+esc(s.reference)+'</a>':esc(format(s.reference)),button('inspect','Inspect','data-collection="source_links" data-id="'+esc(s.id)+'"')];}));
    }
    if(this.tab==='handover'){
      return this.evidence.body()+'<h3>Save and hand over the complete plan</h3><p>Export JSON carries every original record, source snapshot, native revision and additional field. The HTML report is self-contained and printable. CSV tables preserve all original columns and protect spreadsheet text fields.</p><div class="iw-actions">'+button('export-json','Complete plan JSON','','iw-primary')+button('report','Print-ready HTML report')+(this.native?button('native-report','Native report package'):'')+'</div><h3>Field package</h3><p>Open the portable workbench, import the same plan JSON, and record visits offline. Its JSON export retains the source revision for the native return. When a newer native revision exists, both versions are preserved for reconciliation.</p><div class="iw-actions">'+COLLECTIONS.map(c=>button('csv',c.replaceAll('_',' '),'data-collection="'+c+'"')).join('')+'</div>'+this.retainedReports()+'<h3>Plan history</h3>'+this.table(['Revision','When','Action'],(this.history||[]).map(h=>[esc(h.revision??h.event?.revision??''),esc(h.committed_at??h.created_at??h.event?.at??h.updated_at??''),esc(h.operation??h.action??h.event?.action??'')]),this.native?'Save this plan to start its native revision history.':'Native revision history accompanies the receiving workspace; browser drafts preserve the originating revision.')+'<h3>Methods</h3>'+this.table(['Method','Purpose'],(this.catalog?.method_templates||[]).map(m=>[esc(m.label),esc(m.purpose)]));
    }
    return '';
  }
  sourceChoices(){return implementationSourceChoices.call(this);}
  async previewSourceSelection(choice){return previewImplementationSource.call(this,choice);}
  syncSourceSelection(){return syncImplementationSource.call(this);}
  async act(b){
    if(b.dataset.impl.startsWith('briefing-')){await briefingFollowup.act(this,b);return;}
    const action=b.dataset.impl;
    if(action.startsWith('deployment-')){const turn=this.generation,selected=this.plan?.id;const deployment=await this.deploymentCapability();if(!this.gone&&turn===this.generation&&this.plan?.id===selected)await deployment.act(this,b);return;}
    if(action==='plan-report-preview'){await this.previewPlanReportSource(b.dataset.reportId);return;}
    if(action==='plan-report-register'){await this.registerPlanReportSource();return;}
    if(action==='plan-report-open'){await this.openPlanReportSource();return;}
    if(action==='plan-report-dismiss'){if(this.pending)throw Error('Finish the retained report operation first.');this.planReportSource=null;this.cache();this.render();return;}
    if(action==='sample-qc'){await this.openSampleQC();return;}
    if(action.startsWith('outcomes-')){const controller=await this.outcomeCapability();if(!this.gone)await controller.act(b);return;}
    if(action==='results-clear'){this.resultView=normalizeResultsView();this.cache();this.render();return;}
    if(action==='results-prev'||action==='results-next'){const current=reviewResults(this.plan,this.resultView);this.resultView={...current.view,page:Math.max(0,Math.min(current.page_count-1,current.view.page+(action==='results-prev'?-1:1)))};this.cache();this.render();return;}
    if(action==='results-inspect'){this.dialog(resultInspectionHtml(this,b.dataset.id));return;}
    if(action==='results-inspect-json'){download(this.plan.id+'-'+b.dataset.id+'-original-record.json',JSON.stringify(inspectResult(this.plan,b.dataset.id),null,2)+'\n','application/json');return;}
    if(action==='results-csv'){download(this.plan.id+'-matching-results.csv',matchingResultsCsv(this.plan,this.resultView),'text/csv;charset=utf-8');return;}
    if(action==='results-json'){download(this.plan.id+'-matching-results-and-sources.json',JSON.stringify(matchingResultsDocument(this.plan,this.resultView,this.dirty?'browser_draft':this.native?'saved_native_revision':'portable_plan'),null,2)+'\n','application/json');return;}
    if(action.startsWith('dispatch-')){const turn=this.generation,selected=this.plan?.id;const dispatch=await this.dispatchCapability();if(!this.gone&&turn===this.generation&&this.plan?.id===selected)await dispatch.act(this,b);return;}
    if(action.startsWith('lab-')){const lab=await this.labCapability();if(!this.gone)await lab.act(this,b);return;}
    if(action==='observations-review'){await this.reviewFieldObservations();return;}
    if(action==='observations-import'){await this.registerFieldObservations();return;}
    if(action==='observations-dismiss'){if(this.pending)throw Error('Finish the retained operation before dismissing its preview.');this.observationFlow=null;this.cache();this.render();return;}
    if(action==='observations-open'){await this.openFieldObservation(Number(b.dataset.index));return;}
    if(action==='observations-report'){await this.prepareFieldObservationReport();return;}
    if(action==='observations-publish'){await this.publishFieldObservationReport();return;}
    if(action==='observations-source'){await this.openFieldObservation(0,true);return;}
    if(action==='observations-details'){this.dialog('<h3>Retained observation edition</h3><pre class="iw-json">'+esc(JSON.stringify((this.observationReceipts||[]).at(-1),null,2))+'</pre>'+button('close-dialog','Close'));return;}
    if(action==='economic-dismiss'){if(this.economicHandoff&&['saving','importing'].includes(this.economicHandoff.stage))throw Error('Finish the retained source operation before dismissing its selection.');this.economicHandoff=null;this.cacheEconomic();this.render();return;}
    if(action==='economic-import'){await this.importEconomicScenario();return;}
    if(action==='economic-new'){if(this.pending)throw Error('Finish the retained plan operation first.');const h=this.economicHandoff;if(!h)throw Error('Open a saved economic scenario first.');if(['saving','importing'].includes(h.stage))throw Error('Finish the retained economic import on its original plan first.');this.cache();this.generation++;this.history=[];this.downloads=[];this.reports=[];this.plan=makePlan();this.briefingIntake=null;this.labIntake=null;this.labDispatch=null;this.resultView=normalizeResultsView();this.observationFlow=null;this.observationReceipts=[];this.plan.title=h.review?.alternative?.label||'Economic scenario implementation';this.plan.description='Implementation of the retained complete scenario for '+(h.review?.zone_title||h.binding.zone_id)+'.';this.nativePlan=null;this.importedFile=false;this.dirty=true;this.pending=null;h.stage='review';h.plan_id=this.plan.id;this.cache();this.cacheEconomic();this.render();await this.importEconomicScenario();return;}
    if(action==='retry-submit'){await this.submitPending();return;}
    if(action==='resume-task'){await this.resumePending();return;}
    if(action==='refresh-result'){await this.update(this.lastState||this.host.getState?.()||{});return;}
    if(action==='tab'){this.tab=b.dataset.tab;this.render();return;}
    if(action==='new'){this.cache();this.generation++;this.history=[];this.downloads=[];this.reports=[];this.plan=makePlan();this.briefingIntake=null;this.labIntake=null;this.labDispatch=null;this.resultView=normalizeResultsView();this.observationFlow=null;this.observationReceipts=[];this.nativePlan=null;this.importedFile=false;this.dirty=true;this.pending=null;this.message='New plan created. Choose Plan settings, then import a selection or add a method workflow.';this.cache();this.render();return;}
    if(action==='save'){if(await this.evidence.saveIfNeeded())return;if(this.native){const kind=this.importedFile?'implementation.plan.import':this.nativePlan?'implementation.plan.save':'implementation.plan.create';await this.queue(kind,{document:this.plan,expected_revision:this.plan.revision});}else{this.cache();this.status('Draft saved in this browser. Export JSON for a portable copy.');}return;}
    if(action==='export-json'){download(this.plan.id+'.json',JSON.stringify(this.plan,null,2)+'\n','application/json');this.message='Complete plan JSON exported.';this.render();return;}
    if(action==='report'){download(this.plan.id+'-report-'+this.asOf+'.html',reportHtml(this.plan,this.asOf),'text/html');return;}
    if(action==='csv'){download(this.plan.id+'-'+b.dataset.collection+'.csv',csvPlan(this.plan,b.dataset.collection,this.asOf),'text/csv;charset=utf-8');return;}
    if(action==='field-sheet'){download(this.plan.id+'-'+b.dataset.id+'-field-sheet.html',fieldSheetHtml(this.plan,b.dataset.id),'text/html');return;}
    if(action==='import'){this.root.querySelector('[data-impl-file]').click();return;}
    if(action==='reopen'){await this.openPlan(this.plan.id,true);return;}
    if(action==='close-dialog'){this.selectionPreviewTurn++;this.root.querySelector('dialog').close();if(this.native)await this.update(this.lastState||this.host.getState?.()||{});return;}
    if(action==='settings'){this.openDialog('settings');return;}
    if(action==='method'){if(!this.catalog)throw Error('The methods catalog is still loading. Reopen this view after it is available.');this.openDialog('method');return;}
    if(action==='field-form'){if(!this.catalog)throw Error('The field forms catalog is still loading.');this.openDialog('field-form');return;}
    if(action==='source-import'){
      if(!this.native)throw Error('Native source selections are available in their original workspace.');
      if(this.dirty||!this.nativePlan)throw Error('Save this plan’s native revision before attaching a native source selection.');
      if(this.pending)throw Error('Finish the retained plan operation before importing another source selection.');
      const turn=this.generation,id=this.plan.id,choices=await this.read('/api/implementation/selections');
      if(this.gone||turn!==this.generation||this.plan.id!==id||this.root.querySelector('dialog[open]'))return;
      this.selectionChoices=choices;this.selectionDraft=null;
      await this.previewSourceSelection(this.sourceChoices()[0]?.choice||'');return;
    }
    if(action==='source-preview-retry'){await this.previewSourceSelection(this.selectionDraft?.choice||'');return;}
    if(action==='source-select-visible'||action==='source-clear'){
      const form=this.root.querySelector('dialog[open] [data-impl-form="source-import"]');if(!form)return;
      for(const row of form.querySelectorAll('[data-source-row]')){const input=row.querySelector('input[name="source_row"]');if(input&&(action==='source-clear'||!row.hidden))input.checked=action!=='source-clear';}
      this.syncSourceSelection();return;
    }
    if(action==='native-report'){if(this.dirty)throw Error('Save the native revision before creating its report package.');await this.queue('implementation.plan.report',{id:this.plan.id,revision:this.plan.revision,as_of:this.asOf});return;}
    if(action==='add'||action==='edit'){this.openDialog(b.dataset.collection,b.dataset.id);return;}
    if(action==='inspect'){const row=this.plan[b.dataset.collection].find(x=>x.id===b.dataset.id);this.dialog('<h3>Retained original record</h3><pre class="iw-json">'+esc(JSON.stringify(row,null,2))+'</pre><div class="iw-actions">'+button('close-dialog','Close')+'</div>');return;}
    if(action==='delete'){const collection=b.dataset.collection,id=b.dataset.id;this.commitLocal(deleteRow(this.plan,collection,id),'Record removed from this draft; native revision history remains retained.');return;}
  }
  async change(e){
    if(e.target.matches('[data-deployment-filter],[data-deployment-title],[data-deployment-visit]')){const turn=this.generation,selected=this.plan?.id;const deployment=await this.deploymentCapability();if(!this.gone&&turn===this.generation&&this.plan?.id===selected)await deployment.change(this,e);return;}
    if(e.target.matches('[data-outcome-control]')){const controller=await this.outcomeCapability();if(!this.gone)controller.change(e);return;}
    if(e.target.dataset.resultFilter){const key=e.target.dataset.resultFilter;this.resultView=normalizeResultsView({...this.resultView,[key]:key==='page_size'?Number(e.target.value):e.target.value,page:0});this.cache();this.render();return;}
    if(e.target.matches('[data-briefing-file],[data-briefing-field],[data-briefing-entry]')){await briefingFollowup.change(this,e);return;}
    if(e.target.matches('[data-dispatch-field],[data-dispatch-filter],[data-dispatch-campaign],[data-dispatch-sample],[data-dispatch-analyte],[data-dispatch-order],[data-dispatch-attachment],[data-dispatch-report-selection]')){const turn=this.generation,selected=this.plan?.id;const dispatch=await this.dispatchCapability();if(!this.gone&&turn===this.generation&&this.plan?.id===selected)await dispatch.change(this,e);return;}
    if(e.target.matches('[data-lab-file],[data-lab-mapping-file],[data-lab-map],[data-lab-format],[data-lab-json],[data-lab-issue-filter]')){const lab=await this.labCapability();if(!this.gone)await lab.change(this,e);return;}
    if(e.target.matches('[data-impl-file]')){
      const file=e.target.files[0];if(!file)return;if(file.size>30*1024*1024)throw Error('Use a plan JSON smaller than 30 MB in this browser.');
      const doc=JSON.parse(await file.text()),issues=validatePlan(doc);if(issues.length)throw Error(issues.map(x=>x.path+': '+x.message).join('\n'));
      const existing=this.offlineCopies[doc.id];if(existing?.dirty&&!docEqual(existing.document,doc))this.preserveDraft(existing.document,'before-file-import');
      this.cache();this.generation++;this.downloads=[];this.reports=[];this.plan=clone(doc);this.briefingIntake=null;this.labIntake=null;this.labDispatch=null;this.resultView=normalizeResultsView();this.observationFlow=null;this.observationReceipts=clone(existing?.observationReceipts||[]);this.nativePlan=null;this.importedFile=true;this.dirty=true;this.pending=null;this.history=[];this.cache();this.message='Original plan loaded. Its native revision is preserved for the return.';this.render();return;
    }
    if(e.target.dataset.implChange==='plan'){await this.openPlan(e.target.value);return;}
    if(e.target.dataset.implChange==='asof'){this.asOf=e.target.value||today();this.render();return;}
    if(e.target.name==='source_choice'){await this.previewSourceSelection(e.target.value);return;}
    if(e.target.name==='source_row'||e.target.name==='source_filter'){this.syncSourceSelection();return;}
    if(e.target.name==='fieldform_template'){this.activeFormId=e.target.value;this.openDialog('field-form');return;}
    if(e.target.name==='result_type'){
      const form=e.target.form,value=form.elements.value;if(value){value.disabled=e.target.value!=='numeric';if(value.disabled)value.value='';}
    }
    if(e.target.name==='visit_id'){const v=this.plan.visits.find(x=>x.id===e.target.value);if(v&&e.target.form.elements.site_id)e.target.form.elements.site_id.value=v.site_id;}
  }
  dialog(html){const d=this.root.querySelector('dialog');d.querySelector('[data-impl-dialog]').innerHTML=html;d.showModal();setTimeout(()=>d.querySelector('input,select,textarea,button')?.focus(),0);}
  openDialog(kind,id){return openImplementationDialog.call(this,kind,id);}
  async saveForm(form){const result=await saveImplementationForm.call(this,form);if(this.native&&!this.root.querySelector('dialog[open]'))await this.update(this.lastState||this.host.getState?.()||{});return result;}

}
export function attachImplementationWorkbench(host){
  let workbench=null,ready=null,request=null;
  async function consume(){
    const selected=request,instance=workbench,start=ready;
    if(!selected||!instance||!start||selected.consuming)return;
    selected.consuming=true;
    try{
      await start;
      if(request!==selected)return;
      if(workbench!==instance){selected.consuming=false;return consume();}
      const value=selected.kind==='saved-plan'?await instance.receiveSavedPlan(selected.payload):await instance.receiveEconomicScenario(selected.payload);
      if(request===selected){request=null;selected.resolve(value);}
    }catch(error){
      if(request===selected&&workbench!==instance){selected.consuming=false;return consume();}
      if(request===selected){request=null;selected.reject(error);}instance.fail(error);
    }
  }
  return {
    mount(node,state){
      workbench?.detach();
      const instance=new ImplementationWorkbench(node,host);workbench=instance;
      ready=instance.start().then(()=>instance.update(host.getState?.()||state||{}));ready.catch(error=>instance.fail(error));
      consume();
    },
    update(state){const instance=workbench;instance?.update(state).catch(error=>instance.fail(error));},
    detach(){
      workbench?.detach();workbench=null;ready=null;
      if(request){request.reject(Error('The implementation desk was closed before the scenario opened.'));request=null;}
    },
    openSavedPlan(payload){
      if(payload?.workspace_key!==host.getState?.()?.workspace_key)return Promise.reject(Error('Open the saved plan in its received workspace.'));
      if(typeof host.navigate!=='function')return Promise.reject(Error('The extension host needs its original desk navigation capability.'));
      if(request)return Promise.reject(Error('The previous saved selection is still opening.'));
      return new Promise((resolve,reject)=>{
        request={kind:'saved-plan',payload:clone(payload),resolve,reject};
        try{
          const navigation=host.navigate('implementation');
          Promise.resolve(navigation).then(()=>consume()).catch(error=>{if(request){const selected=request;request=null;selected.reject(error);}});
          consume();
        }catch(error){request=null;reject(error);}
      });
    },
    openEconomicScenario(payload){
      if(payload?.workspace_key!==host.getState?.()?.workspace_key)return Promise.reject(Error('Open the selected economic edition in its original workspace.'));
      if(typeof host.navigate!=='function')return Promise.reject(Error('The extension host needs its original desk navigation capability.'));
      if(request)return Promise.reject(Error('The previous economic scenario is still opening.'));
      return new Promise((resolve,reject)=>{
        request={payload:clone(payload),resolve,reject};
        try{
          const navigation=host.navigate('implementation');
          Promise.resolve(navigation).then(()=>consume()).catch(error=>{if(request){const selected=request;request=null;selected.reject(error);}});
          consume();
        }catch(error){request=null;reject(error);}
      });
    },
    dispatch(){return false;}
  };
}
export function mountPortableImplementation(node,catalog){const w=new ImplementationWorkbench(node,{},catalog);w.start().catch(e=>w.fail(e));return w;}
