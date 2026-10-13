// ES-SUPERVISION-20261012
import {attachNativeJobs} from './jobs.mjs';
import {attachWorkspaceFinder} from './workspace_finder.mjs';
import {attachDeliveryInspection} from './delivery_inspection.mjs';
import {attachRehearsal} from './rehearsal.mjs';
import {createSpatialWorkspace} from './spatial.mjs';
import {mountObservedSeries} from './observed_series.mjs';
import {mountObservedReports} from './observed_reports.mjs';
import {observedValueMarkup} from './observed_series.mjs';
import {supportFields,supportOptions,observationSupportMarkup,observationSupportSummary,observationContextMarkup,observationDiagnosticsMarkup} from './observation_support.mjs';
import {createDeliveryReview,deliveryRevision,deliveryChanged} from './delivery_review.mjs';
import {attachCommunity} from './community.mjs';
import {attachCustomerReviews} from './reviews.mjs';
import {attachReceivingWaters} from './receiving_waters.mjs';
import {createExtensionHost} from './extension_host.mjs';
import {attachExperiments} from './experiments.mjs';
import {attachParameterStudies} from './parameter_studies.mjs';
import {attachPortfolio} from './portfolio.mjs';
import {attachProgrammes} from './programmes.mjs';
import {attachSourceReports} from './source_reports.mjs';
import {createScenarioInputReview} from './scenario_input_review.mjs';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short = value => value ? String(value).slice(0,12) : '—';
const pretty = value => JSON.stringify(value, null, 2);
const human = value => String(value ?? '').replaceAll('_',' ').replaceAll('.',' · ');
const number = value => value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString(undefined,{maximumFractionDigits:6}) : esc(value);
const bytes = value => {if(value===undefined)return '—';const units=['B','KiB','MiB','GiB'];let n=Number(value),i=0;while(n>=1024&&i<3){n/=1024;i++;}return n.toLocaleString(undefined,{maximumFractionDigits:i?1:0})+' '+units[i];};
const when = value => value ? new Date(value).toLocaleString() : '—';
const safeURL = value => /^https?:\/\//i.test(value??'') ? value : null;
const external = value => safeURL(value) ? '<a href="'+esc(value)+'" target="_blank" rel="noopener noreferrer">'+esc(value)+'</a>' : esc(value??'');
const badge = value => '<span class="status '+esc(value)+'">'+esc(human(value))+'</span>';
const noRows = (title, description, action, label) => '<div class="empty"><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p>'+(action?'<button class="primary" data-action="'+action+'">'+esc(label)+'</button>':'')+'</div>';
const table = (heads, rows) => '<div class="table-scroll"><table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const defs = obj => '<dl class="definition">'+Object.entries(obj).map(([k,v])=>'<dt>'+esc(human(k))+'</dt><dd>'+(typeof v==='object'?'<span class="mono">'+esc(pretty(v))+'</span>':esc(v??'—'))+'</dd>').join('')+'</dl>';
const button = (action,label,extra='',style='') => '<button type="button" class="'+esc(style)+'" data-action="'+esc(action)+'" '+extra+'>'+esc(label)+'</button>';
const named = (kind,id) => {const row=state?.data?.[kind]?.find(x=>x.id===id);return row?.title||row?.metadata?.title||row?.spec?.title||row?.selection?.title||short(id);};
const viewLabels={'parameter-studies':'Parameter studies',portfolios:'Conservation portfolios',conservation:'Conservation plans',rehearsal:'Operator rehearsal','receiving-waters':'Receiving waters',experiments:'Scenario experiments',programmes:'Run programmes',overview:'Workspace overview',sources:'Original sources',profiles:'Parameter profiles',grids:'Model grids',scenarios:'Land-cover scenarios',runs:'Native model runs',comparisons:'Run comparisons',spatial:'Spatial review',communities:'Communities','customer-reviews':'Customer reviews',observations:'Observed water quality',deliveries:'Maps and delivery'};
const actionLabels={'report-changes.review':'Prepare report comparison review','community.report.handover.export':'Export Community source handover','community.report.handover.receive':'Receive Community report source','scenario.footprint.preview':'Preview native scenario inputs','source-reports.review':'Prepare saved scientific report review','conservation.report.source.prepare':'Prepare Conservation scientific report source','compute.programme.interaction':'Use conservation study','compute.programme.attach-interaction':'Attach conservation attribution','compute.programme.sync-interaction':'Reconcile conservation attribution','parameter-study.source.prepare':'Prepare Parameter scientific source','parameter-study.ensemble.continue':'Prepare scenario parameter studies','parameter-study.prepare':'Prepare parameter study','parameter-study.run':'Run parameter study','parameter-study.summarize':'Summarize parameter study','portfolio.inventory.build':'Build native planning inventory','portfolio.preview':'Analyze conservation choices','portfolio.save':'Save conservation portfolio','portfolio.scenario.prepare':'Prepare portfolio scenario','portfolio.run.prepare':'Prepare portfolio model run','portfolio.run.start':'Run portfolio native models','portfolio.report.build':'Build portfolio report','portfolio.decision.build':'Build portfolio economic comparison','conservation.catalog.export':'Export complete candidate rows','conservation.catalog.plan.save':'Save retained candidate plan','conservation.catalog.select':'Retain candidate selection','conservation.catalog.prepare':'Prepare candidate search','conservation.experiment.prepare':'Prepare paired conservation experiment','conservation.criteria.prepare':'Prepare original parcel criteria','conservation.prepare':'Prepare conservation study','conservation.build':'Build conservation inventory','conservation.plan.save':'Save conservation plan','conservation.export':'Export conservation packet','conservation.scenario.create':'Create selected-land scenario','compute.programme.pair-completion':'Prepare matching scenario baselines','rehearsal.save':'Save operator rehearsal','rehearsal.begin':'Begin walkthrough step','rehearsal.record':'Record actual step outcome','rehearsal.export':'Export walkthrough and media','paired_ensemble.build':'Build paired ensemble','paired_ensemble.resume':'Continue paired ensemble','paired_ensemble.export':'Export paired ensemble','paired_ensemble.receive':'Receive paired ensemble','receiving.water.catalog':'Compile published waters','receiving.water.plan':'Prepare receiving areas','receiving.water.profile':'Prepare utility areas','receiving.water.analyze':'Analyze receiving waters','experiment.save':'Save experiment design','experiment.run':'Run scenario experiment','experiment.summarize':'Build experiment report','compute.programme.experiment':'Use saved experiment','compute.programme.save':'Save run programme','compute.programme.run':'Continue run programme','compute.programme.report':'Build result catalogue','compute.programme.delivery':'Build programme delivery','customer.review.create':'Create customer review','customer.review.export':'Export customer review','customer.review.response.import':'Receive customer response','community.table.import':'Import community table','community.plan.save':'Save intervention plan','community.report.build':'Build community report','community.report.source.prepare':'Prepare Community scientific report source','spatial.review.save':'Save spatial review','spatial.review.export':'Export saved spatial review','source.import':'Import original sources','profile.save':'Save parameter profile','scenario.save':'Save land-cover scenario','grid.prepare':'Prepare model grid','run.prepare':'Prepare native run','run.start':'Run selected native models','run.compare':'Compare native runs','observation.import':'Import original observations','observation.compare':'Compare observed annual loads','delivery.build':'Build complete map delivery','workspace.backup':'Back up scientific workspace','workspace.restore':'Restore scientific workspace'};
Object.assign(actionLabels,{"workspace.snapshot":"Create complete project","workspace.receive":"Receive complete project","workspace.recovery.resume":"Resume received work","project.transfer.capture":"Create incremental project","project.transfer.capture-study":"Capture completed study","project.transfer.accept":"Receive project manifest","project.transfer.receive":"Receive project part","project.transfer.parts":"Prepare requested project parts","project.transfer.archive":"Build complete project archive","project.transfer.restore":"Restore incremental project","project.transfer.report":"Export project inventory","project.transfer.inspect":"Inspect received project","project.transfer.diff":"Compare project editions"});
const mapFamilies=['future_sediment_loss','future_nutrient_runoff','critical_drinking_water','high_quality_waters','current_nutrient_export','current_sediment_export','combined_pollutant_export'];
Object.assign(actionLabels,{"conservation.sources.capture":"Acquire soil and floodplain sources","conservation.optimization.preview":"Preview conservation portfolio","conservation.optimization.save":"Save optimized conservation portfolio","conservation.optimization.export":"Export conservation decision packet"});
const mapTitles={future_sediment_loss:'Future sediment loss',future_nutrient_runoff:'Future nutrient runoff',critical_drinking_water:'Critical drinking-water sources',high_quality_waters:'Designated high-quality waters',current_nutrient_export:'Current nutrient export',current_sediment_export:'Current sediment export',combined_pollutant_export:'Combined pollutant export'};
const keyName='upstate-operator-capability';
const fragment=new URLSearchParams(location.hash.slice(1));
let capability=fragment.get('token')||sessionStorage.getItem(keyName);
if(fragment.get('token')){sessionStorage.setItem(keyName,capability);history.replaceState(null,'','#overview');}
let workspace=sessionStorage.getItem('upstate-selected-workspace')||null;
let teamPerson=null,connectionEpoch=0;
let state=null,view=viewLabels[location.hash.slice(1)]?location.hash.slice(1):'overview',poll=null,refreshing=false,refreshQueued=false;
let formContext=null,detailContext=null,taskPanel=false,toastTimer=null,sourcePreview=null;
let lastTaskStates=new Map(),lastRendered='',logOffset=0,itemRequest=0,detailRequest=0;
let formRevision=0,navigationRevision=0,workspaceRevision=0,interactionRevision=0;
let formOpeningRequest=0;
const acceptedTasks=new Map();
const form=$('#operation-form'),formDialog=$('#form-dialog'),detailDialog=$('#detail-dialog');

const spatialWorkspace=createSpatialWorkspace({request:api,getWorkspace:()=>workspace,refreshState:refresh,showTask,openItem,toast});
const scenarioInputReview=createScenarioInputReview({getState:()=>state,esc,number,button,table,short,when,runTitle,nativeModels});

async function api(path,{method='GET',body,raw,filename,signal}={}){
  const epoch=connectionEpoch;
  const headers={Authorization:'Bearer '+capability,...(workspace?{'X-Workspace':workspace}:{})};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(filename)headers['X-Upload-Filename']=encodeURIComponent(filename);
  const response=await fetch(path,{method,headers,body:raw??(body===undefined?undefined:JSON.stringify(body)),credentials:'same-origin',signal});
  const text=await response.text();
  if(epoch!==connectionEpoch)throw Error('The connection changed while this request was running.');
  let value;try{value=JSON.parse(text);}catch{
    const error=new Error('The operator returned an unreadable response (HTTP '+response.status+'). Refresh the retained workspace; check Operations before repeating a submitted action.');
    error.code='RESPONSE_INVALID';error.status=response.status;throw error;
  }
  if(!response.ok){const error=new Error(value.error?.message||'HTTP '+response.status);error.code=value.error?.code;error.status=response.status;throw error;}
  return value;
}
const endpoint = (path, values={}) => path+'?'+new URLSearchParams({...(workspace?{workspace}:{}),...values});
async function rehearsalOpenControl(control){
 if(control.type==='view')return navigate(control.view);
 if(control.type==='item')return openItem(control.kind,control.id);
 const actions=new Set(['source-open','profile-new','grid-new','scenario-new','run-prepare','run-compare','delivery-new','backup','restore']);
 if(control.type!=='action'||!actions.has(control.action))throw Error('Choose an original operator control.');
 const button=document.createElement('button');button.dataset.action=control.action;
 for(const key of ['id','kind','collection'])if(control[key])button.dataset[key]=control[key];
 return dispatch(button);
}
const rehearsal=attachRehearsal({getState:()=>state,api,endpoint,openItem,showTask,fileList,toast,refreshState:()=>refresh({force:true}),navigate,openControl:rehearsalOpenControl});
const portfolio=attachPortfolio({getState:()=>state,refreshState:()=>refresh({force:true}),api,endpoint,openForm,submitAction,detail,fileList,sourceForm,toast,openItem,executeAction,showTask,openExtension:(...args)=>extensions.openExtension(...args)});
const parameterStudies=attachParameterStudies({getState:()=>state,api,endpoint,openForm,submitAction,executeAction,detail,fileList,openItem,toast,navigate,refreshState:()=>refresh({force:true}),openExtension:(...args)=>extensions.openExtension(...args),openScientificReport});
async function openScientificReport(selection){
 if(selection?.workspace_key!==workspace)throw Error('Open scientific report sources in their original Workspace.');
 detailDialog.close();detailContext=null;
 navigate('sources');
 return sourceReports.openForSources(selection,$('#content'));
}
async function openRetainedBuiltIn(selection,target,open){
 if(selection?.workspace_key!==workspace||!/^[0-9a-f]{64}$/.test(selection?.id||''))
  throw Error('Open the saved report or review in its original Workspace.');
 const request={workspace,workspaceRevision,connectionEpoch};
 const admitted=()=>capability&&workspace===request.workspace&&workspaceRevision===request.workspaceRevision&&connectionEpoch===request.connectionEpoch;
 if(!admitted())return null;
 detailDialog.close();detailContext=null;
 const navigation=navigate(target),targetNavigation=navigationRevision;
 await navigation;
 if(!admitted()||view!==target||navigationRevision!==targetNavigation)return null;
 const container=$('#content'),anchor=container?.firstChild;
 const isCurrent=()=>admitted()&&view===target&&navigationRevision===targetNavigation&&
  container?.isConnected&&$('#content')===container&&container.firstChild===anchor;
 if(!isCurrent())return null;
 try{return await open({...selection,isCurrent},container);}
 catch(error){if(!isCurrent())return null;toast(error.message||String(error));throw error;}
}
async function openSavedScientificReport(selection){
 return openRetainedBuiltIn(selection,'sources',(value,container)=>sourceReports.openForStudy(value,container));
}
async function openSavedCustomerReview(selection){
 return openRetainedBuiltIn(selection,'customer-reviews',value=>customerReviews.openForStudy(value));
}
async function prepareReportComparisonReview(selection){
 if(selection?.workspace_key!==workspace||!/^[0-9a-f]{64}$/.test(selection?.comparison_id||''))
  throw Error('Choose the saved report comparison in its original Workspace.');
 const opening=formOpening('report-changes.review');
 const current=()=>opening()&&(typeof selection.isCurrent!=='function'||selection.isCurrent());
 if(!current())return null;
 return customerReviews.prepareReportComparisonReview({...selection,isCurrent:current});
}
async function openSavedReportComparison(selection){
 if(selection?.workspace_key!==workspace||!/^[0-9a-f]{64}$/.test(selection?.id||''))
  throw Error('Open the saved report comparison in its original Workspace.');
 const request={workspace,workspaceRevision,connectionEpoch};
 const admitted=()=>capability&&workspace===request.workspace&&workspaceRevision===request.workspaceRevision&&connectionEpoch===request.connectionEpoch;
 if(!admitted())return null;
 detailDialog.close();detailContext=null;
 let targetNavigation=-1;
 const isCurrent=()=>admitted()&&view==='report-changes'&&navigationRevision===targetNavigation;
 const opening=extensions.openDesk('report-changes','openForStudy',{...selection,isCurrent});
 targetNavigation=navigationRevision;
 try{return await opening;}
 catch(error){if(!isCurrent())return null;toast(error.message||String(error));throw error;}
}
const community=attachCommunity({getState:()=>state,getOpeningContext:()=>({workspaceRevision,connectionEpoch,formRevision,navigationRevision,interactionRevision,detail_kind:detailContext?.kind,detail_id:detailContext?.id}),api,endpoint,openForm,submitAction,detail,fileList,sourceForm,toast,openItem,refreshState:refresh,openDelivery:selection=>deliveryForm(undefined,selection),openScientificReport,openStudyTransfer:selection=>extensions.openExtension('study-transfer','openForStudies',selection)});
const customerReviews=attachCustomerReviews({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,uploadFile,showTask,toast,openSavedScientificReport,openSavedReportComparison,closeForm:()=>{formDialog.close();formContext=null;},openStudyTransfer:async selection=>{await extensions.openExtension('study-transfer','openForStudies',selection);if(workspace===selection.workspace_key){detailDialog.close();detailContext=null;}}});
const receivingWaters=attachReceivingWaters({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast,navigate,openDelivery:selection=>deliveryForm(undefined,selection),openScientificReport});
const deliveryInspection=attachDeliveryInspection({getState:()=>state,api,endpoint,openItem,toast,
 openExtension:(...args)=>extensions.openExtension(...args),
 closeDetail:()=>{detailDialog.close();detailContext=null;},
 openReceivingPlan:id=>receivingWaters.openPlan(id),openReceivingAnalysis:id=>receivingWaters.openAnalysis(id)});
const experiments=attachExperiments({navigate,closeDetail:()=>{detailDialog.close();detailContext=null;},getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,toast,openItem,showTask});
const programmes=attachProgrammes({getState:()=>state,api,endpoint,openForm,submitAction,detail,fileList,showTask,toast,openItem,refreshState:refresh,navigate,closeDetail:()=>{detailDialog.close();detailContext=null;}});
let operatingJourney=null;
const journeyForm=async open=>{await open();return {operation_id:formContext?.operation_id};};
const extensions=createExtensionHost({
 openParameterStudy:selection=>parameterStudies.openSavedStudy(selection),
 openNativeProgramme:options=>experiments.openForInvestigation(options),
 openScientificReport,openSavedScientificReport,openSavedCustomerReview,prepareReportComparisonReview,openSavedReportComparison,
getState:()=>state,getWorkspace:()=>workspace,api,endpoint,toast,
 navigationRoot:'.sidebar',refreshState:refresh,openItem,showTask,showRunLog,navigate,
 openForm,submitAction,detail,fileList,uploadFile,sourceForm,
 closeDetail:()=>{detailDialog.close();detailContext=null;},
 openDelivery:selection=>deliveryForm(undefined,selection),
 openReceivingPlan:id=>receivingWaters.openPlan(id),
 getView:()=>view,reportError:globalError,selectWorkspace,
 setJourneyController:controller=>{operatingJourney=controller;},
 captureCommunityView:()=>community.capture(),
 validateCommunityView:value=>community.validateView(value),
 restoreCommunityView:value=>community.restoreView(value),
 openExperiment:id=>experiments.dispatch({dataset:{action:'experiment-show',id}}),
 openMap:async(kind,id)=>{const target={workspace,kind,id};detailDialog.close();detailContext=null;await spatialWorkspace.openTarget(target);return navigate('spatial');},
 openScenario:id=>journeyForm(()=>scenarioForm(id)),
 openProfile:id=>journeyForm(()=>profileForm(id)),
 openGrid:id=>journeyForm(()=>gridForm(id)),
 openRun:selection=>journeyForm(()=>runForm(selection)),
 openComparison:selection=>journeyForm(()=>compareForm(selection)),
 openJourneyDelivery:(id,selection)=>journeyForm(()=>deliveryForm(id,selection)),
 openBackup:()=>journeyForm(()=>backupForm()),
 openRestore:()=>journeyForm(()=>restoreForm()),
 getProgramme:()=>typeof programmes==='undefined'?null:programmes});
const sourceReports=attachSourceReports({
 getState:()=>state,getWorkspace:()=>workspace,api,endpoint,openItem,navigate,
 hasView:id=>extensions.hasView(id),openSourceImport:options=>sourceForm(options),
 showTask,refresh,openBackup:()=>backupForm(),
 prepareCustomerReview:value=>customerReviews.prepareScientificReportReview(value),
 openStudy:selection=>extensions.openExtension('study-transfer','openForStudies',selection)
});
const deliveryReview=createDeliveryReview({esc,button,bytes,number,when,runTitle,mapFamilies,mapTitles,section,pageHeader,table,
 getState:()=>state,getWorkspace:()=>workspace,api,endpoint,detail,refresh,showTask,revise:deliveryForm,
 setDetailFiles:files=>{if(detailContext)detailContext.files=files;},
 beginDetailRequest:()=>++itemRequest,isDetailRequest:request=>request===itemRequest&&detailDialog.open});
const nativeJobs=attachNativeJobs({api,endpoint,detail,refresh,getWorkspace:()=>workspace,getDetailContext:()=>detailContext,openItem,toast,getState:()=>state});
function finderDestination(open){
 itemRequest++;detailContext=null;deliveryInspection.detach();
 if(detailDialog.open)detailDialog.close();
 return open();
}
const workspaceFinder=attachWorkspaceFinder({
 getState:()=>state,getWorkspace:()=>workspace,
 getDesks:()=>$$('.sidebar [data-view]').filter(node=>viewLabels[node.dataset.view]||extensions.hasView(node.dataset.view))
  .map(node=>({id:node.dataset.view,title:node.textContent.trim()})),
 navigate:next=>finderDestination(()=>navigate(next)),
 openItem:(kind,id)=>finderDestination(()=>openItem(kind,id)),
 showTask:id=>finderDestination(()=>showTask(id)),
 taskLabel:action=>actionLabels[action]||human(action),
 canOpen:()=>!formDialog.open,reportError:error=>toast(error.message||String(error))
});
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function globalError(error){$('#global-error').textContent=error.message||String(error);$('#global-error').hidden=false;}
function clearError(){$('#global-error').hidden=true;$('#global-error').textContent='';}
async function refresh({force=false}={}){
  if(!capability)return;
  if(refreshing){if(force)refreshQueued=true;return;}
  refreshing=true;clearTimeout(poll);
  const requestedWorkspace=workspace;
  try{
    let data;
    try{data=await api('/api/state?compact=1'+(requestedWorkspace?'&workspace='+encodeURIComponent(requestedWorkspace):''));}
    catch(error){
      if(workspace!==requestedWorkspace)return;
      if(![403,404].includes(error.status)||!requestedWorkspace)throw error;
      data=await api('/api/state?compact=1');
    }
    if(workspace!==requestedWorkspace)return;
    state=data;workspace=data.workspace_key;sessionStorage.setItem('upstate-selected-workspace',workspace);
    teamPerson=data.person||teamPerson;
    const access=data.workspaces.find(x=>x.id===workspace)?.access_role||'administrator';
    $('#connection-state').textContent=access==='viewer'?'Viewer access · Inspect retained results and download available files.':'';
    $('#team-person').textContent=(teamPerson?.display_name||'Local installation owner')+' · '+access;
    $('#team-manage').hidden=!teamPerson?.administrator;
    $('#team-sign-out').hidden=false;
    const options=data.workspaces.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===workspace?'selected':'')+' '+(!x.available?'disabled':'')+'>'+esc(x.title)+(x.received?' · restored copy':'')+'</option>').join('');
    $('#workspace-select').innerHTML=options;
    for(const task of data.tasks){
      const taskKey=workspace+':'+task.id,before=lastTaskStates.get(taskKey);
      if(before&&before!==task.state&&task.state==='complete')toast(programmes.completionMessage(task)||(actionLabels[task.action]||task.action)+' completed.');
      lastTaskStates.set(taskKey,task.state);
    }
    renderTasks();
    extensions.update(state);
    workspaceFinder.update(state);
    const fingerprint=JSON.stringify({conservation_tasks:view==='conservation'?(data.tasks||[]).filter(t=>String(t.action||'').startsWith('conservation.')||['experiment.save','experiment.run','experiment.summarize'].includes(t.action)).map(t=>[t.id,t.state,t.updated_at||null,t.progress||null]):undefined,rehearsal_tasks:view==='rehearsal'?(data.tasks||[]).filter(t=>String(t.action||'').startsWith('rehearsal.')).map(t=>[t.id,t.state]):undefined,view,workspace,data:data.data});
    if(force||fingerprint!==lastRendered){render();lastRendered=fingerprint;}
    if(detailContext?.kind==='task')await showTask(detailContext.id,false);
    if(['runs','scenarios','comparisons','spatial_exports','deliveries'].includes(detailContext?.kind)&&detailDialog.open){const kind=detailContext.kind,row=(data.data[kind]||[]).find(x=>x.id===detailContext.id);if(row&&((kind==='deliveries'?deliveryChanged(row,detailContext):row.state!==detailContext.state)||(['runs','scenarios','comparisons'].includes(kind)&&detailContext.footprintRevision!==scenarioInputReview.revision())))await openItem(kind,row.id,false);}
  }catch(error){
    if(workspace===requestedWorkspace){
      if(error.status===401){showConnection(error.message);return;}
      $('#connection-state').textContent='Connection interrupted. Retained task state is preserved.';if(force)globalError(error);
    }
  }finally{
    refreshing=false;clearTimeout(poll);
    if(refreshQueued){refreshQueued=false;poll=setTimeout(()=>refresh({force:true}),0);}
    else poll=setTimeout(()=>refresh(),state?.tasks.some(x=>['queued','running'].includes(x.state))?2500:12000);
  }
}
function pageHeader(title,description,actions=''){return '<header class="page-header"><div><p class="eyebrow">UPPER SAVANNAH SCIENTIFIC WORKBENCH</p><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></div><div class="page-actions">'+actions+'</div></header>';}
function section(title,description,body,actions=''){return '<section class="section"><header class="section-header"><div><h3>'+esc(title)+'</h3>'+(description?'<p>'+esc(description)+'</p>':'')+'</div>'+actions+'</header>'+body+'</section>';}
function metaId(row){return '<small><span class="mono">'+esc(short(row.id))+'</span> · '+esc(when(row.created_at||row.captured_at))+'</small>';}
function itemButton(kind,id,label='Open'){return button('item',label,'data-kind="'+kind+'" data-id="'+id+'"','small')+(['sources','grids','runs','comparisons','deliveries'].includes(kind)?button('spatial-item','Map','data-kind="'+kind+'" data-id="'+id+'"','small'):'');}
function sourceDisplayTitle(entry){return entry?.id==='GURA_NLCD'?'Land cover':entry?.title||entry?.name||entry?.id||'—';}
function sourceName(collection,id){const entry=state?.data.sources.find(x=>x.id===collection)?.entries.find(x=>x.id===id);return entry?sourceDisplayTitle(entry):id||'—';}
function sumCell(artifact){return artifact?number(artifact.sum)+' <small>'+esc(artifact.sum_units||artifact.units||'')+'</small>':'—';}
function mountPortfolioDetail(){
  if(detailDialog.open&&['portfolios','portfolio_reports'].includes(detailContext?.kind)&&detailContext?.portfolio)portfolio.mountItem($('#detail-body'),detailContext.portfolio);
}
function render(){
  if(!state)return;
  // Cumulative lifecycle: detach only desks outside the selected view.
  if(view!=="experiments")experiments.detach();
  if(view!=="programmes")programmes.detach();
  if(!extensions.hasView(view))extensions.detach();
  if(view!=='sources')sourceReports.detach();
  if(view!=='portfolios')portfolio.detach();
  mountPortfolioDetail();
  if(view!=='parameter-studies')parameterStudies.detach();
  if(view==='rehearsal'){
    for(const node of document.querySelectorAll('[data-view]'))node.setAttribute('aria-current',node.dataset.view===view?'page':'false');
    if(typeof spatialWorkspace!=='undefined')spatialWorkspace.suspend();
    if(typeof community!=='undefined')community.detach();
    if(typeof customerReviews!=='undefined')customerReviews.detach();
    if(typeof programmes!=='undefined')programmes.detach();
    if(typeof scenarioAnalysis!=='undefined')scenarioAnalysis.detach();
    if(typeof experiments!=='undefined')experiments.detach();
    if(typeof experimentDiagnostics!=='undefined')experimentDiagnostics.detach();
    if(typeof receivingWaters!=='undefined')receivingWaters.detach();
    if(typeof extensions!=='undefined')extensions.detach();
    rehearsal.mount($('#content'));return;
  }
  rehearsal.detach();
  if(!extensions.hasView(view))extensions.detach();
  if(typeof experiments!=='undefined'&&view!=='experiments')experiments.detach();
  if(typeof experimentDiagnostics!=='undefined'&&view!=='experiment-diagnostics')experimentDiagnostics.detach();
  if(typeof receivingWaters!=='undefined'&&view!=='receiving-waters')receivingWaters.detach();
  for(const node of $$('[data-view]'))node.setAttribute('aria-current',node.dataset.view===view?'page':'false');
  // Registered desks retain sole ownership of their controller and actions.
  if(extensions.hasView(view)){
    community.detach();customerReviews.detach();spatialWorkspace.suspend();
    if(typeof programmes!=='undefined')programmes.detach();
    if(typeof experiments!=='undefined')experiments.detach();
    if(typeof experimentDiagnostics!=='undefined')experimentDiagnostics.detach();
    if(typeof receivingWaters!=='undefined')receivingWaters.detach();
    if(typeof rehearsal!=='undefined')rehearsal.detach();
    if(typeof journey!=='undefined'){journey.detach();journey.updateRail(view);}
    if(typeof scenarioAnalysis!=='undefined')scenarioAnalysis.detach();
    extensions.render(view,$('#content'),state);return;
  }
  if(view==='experiments'){extensions.detach();programmes.detach();spatialWorkspace.suspend();community.detach();customerReviews.detach();experiments.mount($('#content'),state);return;}
  experiments.detach();
  if(view==='spatial'){receivingWaters.detach();programmes.detach();community.detach();customerReviews.detach();spatialWorkspace.mount($('#content'),state);return;}
  spatialWorkspace.suspend();
  if(view==='programmes'){community.detach();customerReviews.detach();programmes.mount($('#content'),state);return;}
  programmes.detach();
  const d=state.data;let html='';
  if(view==='overview'){
    const complete=d.runs.filter(x=>x.state==='complete').length;
    html=pageHeader(d.project.title,'Original data, explicit model choices, retained native outputs and a complete receiving package.',button('source-open','Import sources','','primary'));
    html+='<div class="page-actions">'+button('journey-home','Open guided journey','','primary')+'</div>';
    html+='<div class="cards">'+[
      ['Source editions',d.sources.length,'Retained original files and provenance.'],
      ['Model grids',d.grids.filter(x=>x.state==='complete').length,'Aligned to each study’s original reference grid.'],
      ['Complete native runs',complete,'Completed outputs for each run’s selected native models.'],
      ['Complete deliveries',d.deliveries.filter(x=>x.state==='complete').length,'Seven map families, physical rasters and working archive.']
    ].map(x=>'<div class="card"><h3>'+x[0]+'</h3><strong class="number">'+number(x[1])+'</strong><p>'+x[2]+'</p></div>').join('')+'</div>';
    html+='<div class="two-columns">'+section('Continue the original workflow','Each saved selection remains available after reopening.','<div class="section-body flow-list">'+[
      ['1','Retain original source editions','Import a native source package or register a published table with its actual provenance.','source-open','Sources'],
      ['2','Select the biophysical profile and reporting grid','Choose real land-cover coefficients, hydrologic context, units and native parameters.','profile-new','Profile'],
      ['3','Compare explicit land-cover scenarios','Run the retained baseline and alternatives on the same source grid.','run-prepare','Prepare run'],
      ['4','Assemble the seven-map delivery','Join actual water-designation overlays, observations, report, metadata and a full working archive.','delivery-new','Delivery']
    ].map(x=>'<div class="flow-row"><span class="flow-step">'+x[0]+'</span><div><h3>'+x[1]+'</h3><p>'+x[2]+'</p></div>'+button(x[3],x[4],'','small')+'</div>').join('')+'</div>')+
    section('Workspace custody','Original identity is preserved by native backup and restore.','<div class="section-body">'+defs({project_id:d.project.id,created:when(d.project.created_at),source_editions:d.sources.length,observation_editions:d.observations.length,retained_comparisons:(d.comparisons||[]).length+(d.observation_comparisons||[]).length})+'<div class="page-actions">'+button('backup','Create complete backup')+button('restore','Restore an archive')+'</div></div>')+'</div>';
  }
  if(view==='sources'){
    html=pageHeader('Original sources','Retain the source URI, edition, units, exact bytes and native sidecars before selecting data for analysis.',button('source-open','Import source edition','','primary')+button('source-reports-open','Review retained reports'));
    html+=d.sources.length?section('Retained source editions','Select an edition to inspect its original files and native schema.',table(['Edition','Captured','Sources','Scope',''],d.sources.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.title)+'</strong>'+metaId(row)+'</td><td>'+esc(row.captured_at||'Not supplied')+'</td><td>'+row.entries.length+'</td><td>'+esc(typeof row.scope==='string'?row.scope:JSON.stringify(row.scope))+'</td><td class="actions-cell">'+itemButton('sources',row.id)+'</td></tr>'))):noRows('Import the original source data','A source edition retains its actual manifest and file bytes, including raster units and the biophysical CSV.','source-open','Import sources');
  }
  if(view==='profiles'){
    html=pageHeader('Parameter profiles','Use the original biophysical CSV and parameters for the selected native NDR/SDR models. Save revisions as new immutable profiles.',button('profile-new','New parameter profile','','primary'));
    html+=d.profiles.length?section('Retained parameter choices','The original table is preserved by source edition and content hash.',table(['Profile','Table codes','Flow routing','Model period',''],d.profiles.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.title)+'</strong>'+metaId(row)+'</td><td>'+number(row.table_summary?.rows)+'</td><td>'+nativeModels(row).map(name=>esc(name.toUpperCase())+' '+esc(row[name]?.flow_dir_algorithm?.toUpperCase()||'—')).join(' / ')+'</td><td>'+esc(typeof row.model_period==='object'?JSON.stringify(row.model_period):row.model_period||'Not supplied')+'</td><td class="actions-cell">'+itemButton('profiles',row.id)+button('profile-clone','Revise','data-id="'+row.id+'"','small')+'</td></tr>'))):noRows('Select real biophysical coefficients','Create a profile from an imported parameter table and its published references.','profile-new','New profile');
  }
  if(view==='grids'){
    html=pageHeader('Model grids','Align the selected models’ original rasters to the retained native grid, preserving its cell size, reporting mask and upstream model context. Extend an existing grid when additional model sources arrive.',button('grid-new','Prepare model grid','','primary'));
    html+=d.grids.length?section('Original grid preparations','Incomplete preparations retain their completed native files for continuation.',table(['Grid','State','Dimensions','Resolution','Source edition',''],d.grids.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.spec.title||'Model grid')+'</strong><small>'+esc(nativeModelLabel(row.spec))+'</small>'+metaId(row)+'</td><td>'+badge(row.state)+'</td><td>'+number(row.grid?.width)+' × '+number(row.grid?.height)+'</td><td>'+number(row.grid?.resolution_m)+' m</td><td>'+esc(named('sources',row.spec.source_collection_id))+'</td><td class="actions-cell">'+itemButton('grids',row.id)+button('grid-clone',row.state==='complete'?'Extend / revise':'Revise','data-id="'+row.id+'"','small')+'</td></tr>'))):noRows('Prepare the reporting and model grid','Select original rasters, the reporting boundary, the covering hydrologic domain and its explicit context distance.','grid-new','Prepare grid');
  }
  if(view==='scenarios'){
    html=pageHeader('Land-cover scenarios','Preserve the original baseline and describe each proposed land-cover change using an actual retained polygon mask.',button('scenario-new','New scenario','','primary'));
    html+=d.scenarios.length?section('Retained scenario assumptions','A revision creates a separate scenario with its original reasons and source masks.',table(['Scenario','Kind','Changes','Source edition',''],d.scenarios.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.title)+'</strong><small>'+esc(row.reason)+'</small></td><td>'+badge(row.kind)+'</td><td>'+number(row.patches.length)+'</td><td>'+esc(named('sources',row.source_collection_id))+'</td><td class="actions-cell">'+itemButton('scenarios',row.id)+button('scenario-clone','Revise','data-id="'+row.id+'"','small')+'</td></tr>'))):noRows('Retain a baseline and explicit alternatives','The baseline uses the actual land-cover edition; alternatives change only selected source masks and land-cover codes.','scenario-new','New scenario');
  }
  if(view==='runs'){
    html=pageHeader('Native model runs','Prepare a source-bound selection, then execute its original InVEST models. Completed native stages remain available for continuation and exact reuse.',button('run-compare','Compare completed runs')+button('run-prepare','Prepare native run','','primary'));
    html+=d.runs.length?section('Retained model runs','Annual export totals use the original reporting mask and physical units.',table(['Selection','State','Scenario inputs','Nitrogen','Phosphorus','Sediment',''],d.runs.map(row=>'<tr><td class="name-cell"><strong>'+esc(named('scenarios',row.selection.scenario_id))+'</strong><small>'+esc(named('profiles',row.selection.profile_id))+' · '+esc(named('grids',row.selection.grid_id))+' · '+esc(nativeModelLabel(row.selection))+'</small><small class="mono">'+short(row.id)+'</small></td><td>'+badge(row.state)+'</td><td>'+scenarioInputReview.compact(row)+'</td><td class="number-cell">'+nativeOutputCell(row,'ndr','nitrogen_export')+'</td><td class="number-cell">'+nativeOutputCell(row,'ndr','phosphorus_export')+'</td><td class="number-cell">'+nativeOutputCell(row,'sdr','sediment_export')+'</td><td class="actions-cell">'+itemButton('runs',row.id)+(row.state==='prepared'||row.state==='failed'?button('run-start',row.state==='prepared'?'Review & run':'Review & resume','data-id="'+row.id+'"','small'):'')+(canSelectCompletedModels(row)?button('run-completed-models','Use completed models','data-id="'+row.id+'"','small'):'')+'</td></tr>'))):noRows('Prepare the first native model run','Select a complete grid, retained coefficient profile and baseline or alternative scenario.','run-prepare','Prepare native run');
  }
  if(view==='comparisons'){
    html=pageHeader('Run comparisons','Compare completed original runs on the same retained grid. Signed changes are alternative minus baseline.',button('run-compare','Compare runs','','primary'));
    const rows=d.comparisons||[];
    html+=rows.length?section('Retained run comparisons','Profile changes remain explicit alongside land-cover changes.',table(['Baseline','Alternatives','Direction',''],rows.map(row=>'<tr><td class="name-cell"><strong>'+esc(runTitle(row.baseline_run_id))+'</strong><small class="mono">'+short(row.id)+'</small></td><td>'+row.alternatives.length+'</td><td>'+esc(row.direction)+'</td><td class="actions-cell">'+itemButton('comparisons',row.id)+'</td></tr>'))):noRows('Compare the completed baseline and alternatives','The comparison preserves the actual difference rasters and their valid-cell coverage.','run-compare','Compare runs');
  }
  if(view==='observations'){
    html=pageHeader('Observed water quality','Retain every original CSV row and its qualifier. Compare only explicitly derived annual N/P/sediment mass rates with full native catchment outputs.',button('observation-compare','Compare observations')+button('observation-new','Import observations','','primary'));
    html+=d.observations.length?section('Original observation editions','Context rows, including nonannual water-quality measurements, remain in the retained source.',table(['Edition','Rows','Annual loads admitted','Context rows','Source',''],d.observations.map(row=>'<tr><td class="name-cell"><strong>'+esc(row.metadata.title)+'</strong><small>'+esc(row.metadata.value_basis||'context')+'</small></td><td>'+number(row.row_count)+'</td><td>'+number(row.admitted_count)+'</td><td>'+number(row.context_count)+'</td><td>'+external(row.metadata.source_uri)+'</td><td class="actions-cell">'+itemButton('observations',row.id)+'</td></tr>'))):noRows('Import actual observation records','Preserve original station and catchment identities, units, dates, annualization methods and qualifiers.','observation-new','Import observations');
    const comparisons=d.observation_comparisons||[];
    if(comparisons.length)html+=section('Retained observed-versus-modeled comparisons','Review periods, spatial coverage and model assumptions with the residuals.',table(['Observation edition','Model run','Compared','Context / excluded',''],comparisons.map(row=>'<tr><td class="name-cell"><strong>'+esc(named('observations',row.observation_id))+'</strong><small class="mono">'+short(row.id)+'</small></td><td>'+esc(runTitle(row.run_id))+'</td><td>'+number(row.comparisons.length)+'</td><td>'+number(row.exclusions.length)+'</td><td class="actions-cell">'+itemButton('observation_comparisons',row.id)+'</td></tr>')));
  }
  if(view==='deliveries'){
    html=deliveryReview.overview(d);
  }
  if(view==='parameter-studies')html=parameterStudies.render();
  if(view==='portfolios')html=portfolio.render();
  if(view==='communities')html=community.render();
  if(view==='customer-reviews')html=customerReviews.render();
  if(view==='receiving-waters')html=receivingWaters.render();
  $('#content').innerHTML=html;
  if(view==='sources')sourceReports.mount($('#content')).catch(globalError);else sourceReports.detach();
  if(view==='receiving-waters')receivingWaters.mount($('#content'));else receivingWaters.detach();
  if(view==='runs'){const actions=$('.page-actions',$('#content'));if(actions)actions.insertAdjacentHTML('beforeend',button('programme-open','Run programmes'));}
  if(view==='parameter-studies')parameterStudies.mount($('#content'));else parameterStudies.detach();
  if(view==='portfolios')portfolio.mount($('#content'));else portfolio.detach();
  if(view==='communities')community.mount($('#content'));else community.detach();
  if(view==='customer-reviews')customerReviews.mount($('#content'));else customerReviews.detach();
}
function runTitle(id){const row=state?.data.runs.find(x=>x.id===id);return row?named('scenarios',row.selection.scenario_id)+' · '+named('profiles',row.selection.profile_id)+' · '+nativeModelLabel(row.selection):short(id);}
function renderTasks(){
  const tasks=state?.tasks||[],active=tasks.filter(x=>['queued','running'].includes(x.state));
  for(const row of tasks)acceptedTasks.delete(workspace+':'+row.id);
  const retained=[...acceptedTasks.values()].filter(row=>row.connectionEpoch===connectionEpoch);
  const retainedMarkup=retained.length?'<section class="section-body"><h3>Recently accepted operations</h3>'+retained.map(row=>'<article class="task-row"><h3>'+esc(actionLabels[row.action]||row.action)+'</h3><p>'+esc(row.workspaceTitle)+'</p><p class="note">Saved in its original workspace. Opening this record does not submit it again.</p>'+button('task-open-retained','Open saved operation','data-id="'+esc(row.id)+'" data-workspace="'+esc(row.workspace)+'"','small')+'</article>').join('')+'</section>':'';
  $('#task-count').textContent=active.length+retained.length;
  $('#task-banner').hidden=!active.length;
  if(active.length)$('#task-banner').innerHTML='<strong>'+esc(active[0].state==='running'?'Original operation running':'Original operation queued')+'</strong>'+esc(actionLabels[active[0].action]||active[0].action)+button('tasks','Inspect operations','','small');
  $('#task-list').innerHTML=retainedMarkup+(tasks.length?tasks.map(row=>'<article class="task-row"><h3>'+esc(actionLabels[row.action]||row.action)+badge(row.state)+'</h3><time>'+esc(when(row.created_at))+'</time>'+(row.error?'<p class="error-text">'+esc(row.error.message)+'</p>':'')+'<div class="task-actions">'+button('task-open','Details','data-id="'+row.id+'"','small')+(['failed','interrupted','cancelled'].includes(row.state)?button('task-resume','Resume original selection','data-id="'+row.id+'"','small'):'')+(row.state==='queued'?button('task-cancel','Cancel before start','data-id="'+row.id+'"','small'):'')+'</div></article>').join(''):'<div class="section-body note">Workspace operations will appear here with their selected inputs and retained attempts.</div>');
}
function fileList(files){
  if(!files?.length)return '';
  return '<div class="file-list">'+files.map(f=>'<div class="file-row"><div><strong>'+esc(f.label||f.filename)+'</strong><small>'+esc(f.filename)+' · '+bytes(f.bytes)+'</small><small class="mono">SHA256 '+esc(f.sha256)+'</small></div><div class="inline-actions">'+(f.filename.toLowerCase().endsWith('.pdf')?button('preview-file','Preview','data-file-id="'+f.id+'"','small'):'')+'<a href="'+esc(f.url)+'?download=1" download>Download</a></div></div>').join('')+'</div>';
}
function detail(title,body,{kind,id,state:status}={}){
  detailRequest=++itemRequest;if(kind!=='deliveries')deliveryInspection.detach();
  $('#detail-title').textContent=title;$('#detail-body').innerHTML=body;
  detailContext={kind,id,state:status,files:detailContext?.files||[]};
  if(!detailDialog.open)detailDialog.showModal();
}
async function openItem(kind,id,focus=true){
  const request=++itemRequest,requestedWorkspace=workspace;
  const inspected=kind==='deliveries'?await deliveryInspection.load(id,requestedWorkspace):null;
  const row=kind==='deliveries'?inspected?.record:await api(endpoint('/api/item',{kind,id}));
  if(!row||workspace!==requestedWorkspace||request!==itemRequest)return;
  if(kind!=='deliveries')deliveryInspection.detach();detailContext={kind,id,state:row.state,files:row._downloads||[]};
  let content='';
  if(kind==='portfolios'||kind==='portfolio_reports'){
    content=portfolio.renderItem(row,kind);
  }else if(kind==='sources'){
    content=defs({captured_at:row.captured_at,source_count:row.entries.length,scope:row.scope})+table(['Source','Kind / units','Edition','Original source',''],row.entries.map(e=>'<tr><td class="name-cell"><strong>'+esc(sourceDisplayTitle(e))+'</strong><small>'+esc(e.id)+'</small></td><td>'+esc(e.kind)+'<br>'+esc(e.units||'')+'</td><td>'+esc(e.vintage)+'</td><td>'+external(e.uri)+'</td><td>'+button('source-inspect','Inspect native file','data-collection="'+id+'" data-source="'+esc(e.id)+'"','small')+'</td></tr>'));
  }else if(kind==='profiles'){
    content='<div class="two-columns">'+nativeModels(row).map(name=>section(name==='ndr'?'Nutrient delivery ratio':'Sediment delivery ratio','Original '+name.toUpperCase()+' parameters.','<div class="section-body">'+defs(row[name]||{})+'</div>')).join('')+'</div>'+defs({selected_models:nativeModelLabel(row),biophysical_table:sourceName(row.source_collection_id,row.biophysical_source_id),land_cover_codes:row.table_summary.lucodes,model_period:row.model_period||'Not supplied',references:row.references})+button('source-inspect','Open original biophysical table','data-collection="'+esc(row.source_collection_id)+'" data-source="'+esc(row.biophysical_source_id)+'"')+button('profile-clone','Create revised profile','data-id="'+id+'"');
  }else if(kind==='grids'){
    content=defs({state:row.state,selected_models:nativeModelLabel(row.spec),reused_original_grid:row.spec.base_grid_id||'Prepared from the selected original sources',reused_inputs:Object.keys(row.reused_inputs||{}),crs:row.grid?.crs_name,dimensions:row.grid?.width+' × '+row.grid?.height,resolution_m:row.grid?.resolution_m,pixel_area_ha:row.grid?.pixel_area_ha,bounds:row.grid?.bounds,transform:row.grid?.transform,upstream_context_m:row.spec.upstream_buffer_m})+table(['Input','Source edition','Units / source','Native minimum','Native maximum'],Object.entries(row.inputs||{}).map(([name,input])=>'<tr><td>'+esc(name)+'</td><td>'+esc(input.vintage)+'</td><td>'+external(input.source_uri)+'</td><td>'+number(input.minimum)+'</td><td>'+number(input.maximum)+'</td></tr>'));
  }else if(kind==='scenarios'){
    content=defs({kind:row.kind,reason:row.reason,source_edition:named('sources',row.source_collection_id)})+table(['Original mask','From land-cover codes','To code','Reason','Selection'],row.patches.map(p=>'<tr><td>'+esc(sourceName(row.source_collection_id,p.mask_source_id))+'</td><td>'+esc(p.from_codes.join(', '))+'</td><td>'+p.to_code+'</td><td>'+esc(p.reason)+'</td><td>'+esc(pretty({layer:p.layer,where:p.where}))+'</td></tr>'))+button('scenario-clone','Create revised scenario','data-id="'+id+'"')+scenarioInputReview.scenarioPanel(row);
  }else if(kind==='runs'){
    content='<div class="meta">'+badge(row.state)+'<span>InVEST '+esc(row.selection.invest_version)+'</span><span>'+esc(runTitle(row.id))+'</span></div>';
    if(row.error)content+='<div class="notice error">'+esc(row.error.message)+'</div>';
    content+=table(['Native stage','Execution source','Started','Completed','Retained outputs'],Object.entries(row.stages||{}).map(([name,stage])=>'<tr><td>'+esc(human(name))+'</td><td>'+(stage.reused_from?'Reused from '+esc(short(stage.reused_from.run_id))+'<br><small>'+esc(when(stage.reused_at))+'</small>':'Calculated in this retained run')+'</td><td>'+esc(when(stage.started_at))+'</td><td>'+esc(when(stage.completed_at))+'</td><td>'+(Object.keys(stage.files||{}).length+(stage.artifact?1:0))+'</td></tr>'));
    content+=table(['Export','Annual reporting total','Valid cells'],Object.entries(row.artifacts||{}).map(([name,item])=>'<tr><td>'+esc(human(name))+'</td><td>'+sumCell(item)+'</td><td>'+number(item.valid_cells)+'</td></tr>'));
    content+=completedModelOrigins(row);
    content+=scenarioInputReview.runPanel(row);
    content+='<div class="page-actions">'+(['prepared','failed'].includes(row.state)?button('run-start-confirmed',row.state==='failed'?'Resume original models':'Run original models','data-id="'+id+'"','primary'):'')+(canSelectCompletedModels(row)?button('run-completed-models','Use completed models','data-id="'+id+'"'):'')+button('run-log','Read native log','data-id="'+id+'"')+'</div><pre id="native-log" class="logs" hidden></pre>';
    content+=nativeJobs.runActions(row);
  }else if(kind==='comparisons'){
    content=scenarioInputReview.comparisonPanel(row)+defs({baseline:runTitle(row.baseline_run_id),direction:row.direction,compared_outputs:row.common_artifacts||Object.keys(row.alternatives?.[0]?.artifacts||{})})+table(['Alternative','Export','Annual change','Valid cells','Profile also changes'],row.alternatives.flatMap(alt=>Object.entries(alt.artifacts).map(([name,item])=>'<tr><td>'+esc(runTitle(alt.run_id))+'</td><td>'+esc(human(name))+'</td><td>'+number(item.sum_change)+' '+esc((item.units||'').replace('/pixel',''))+'</td><td>'+number(item.valid_cells)+'</td><td>'+esc(alt.profile_changed?'Yes':'No')+'</td></tr>')));
  }else if(kind==='observations'){
    content=defs({source_uri:row.metadata.source_uri,value_basis:row.metadata.value_basis,annualization_method:row.metadata.annualization_method||'Context observations',rows:row.rows.length,admitted:row.admitted_count,context:row.context_count})+observationSupportSummary(row)+'<div id="observed-series"></div><div class="filters"><label>Find a record<input id="observation-search" placeholder="Station, catchment, parameter or qualifier"></label><label>Rows<select id="observation-filter"><option value="">All original rows</option value="admitted">Annual loads admitted</option><option value="context">Context and exclusions</option></select></label></div><div id="observation-records"></div>';
  }else if(kind==='observation_comparisons'){
     content='<p class="note">'+esc(row.interpretation)+'</p>'+defs({run:runTitle(row.run_id),observations:named('observations',row.observation_id),catchment_source:row.catchment_source,model_period:row.model_period||'Review original source vintages',selected_models:row.model_scope?.selected_models||'Review the retained run selection'});
     content+='<p class="note">'+esc(row.metrics_basis||'This retained comparison predates the complete-catchment coverage check. Create a comparison on the same retained run and observations to calculate current coverage.')+'</p>';
     content+=table(['Parameter',row.comparison_version>=2?'Complete comparisons':'Retained comparisons','Mean bias','RMSE','Nash–Sutcliffe efficiency','Catchments / periods'],Object.entries(row.metrics).map(([name,m])=>'<tr><td>'+esc(name)+'<br><small>'+esc(m.units)+'</small></td><td>'+m.n+'</td><td>'+number(m.mean_bias)+'</td><td>'+number(m.rmse)+'</td><td>'+number(m.nash_sutcliffe_efficiency)+'</td><td>'+number(m.unique_catchments??m.n)+' catchments<br><small>'+esc(m.repeated_catchments?'Includes repeated station periods':'Distinct catchments')+'</small></td></tr>'));
     content+=observationDiagnosticsMarkup(row);
     content+='<div class="filters"><label>Parameter<select id="comparison-parameter"></select></label><label>Station / catchment<select id="comparison-station"></select></label><label>Coverage<select id="comparison-coverage"><option value="">Every retained comparison</option><option value="complete">Complete catchments</option><option value="partial">Partial or legacy coverage</option></select></label></div><div id="observation-comparison-view"></div>';
     content+='<div class="page-actions">'+button('observation-comparison-csv','Download selected comparison rows')+(row.diagnostics?button('observation-diagnostics-json','Download complete cohort review'): '')+'</div>';
     if(row.exclusions.length)content+='<details class="technical"><summary>'+row.exclusions.length+' original context or excluded rows</summary><pre class="json-view">'+esc(pretty(row.exclusions))+'</pre></details>';
   }else if(kind==='spatial_exports'){
    content='<div class="meta">'+badge(row.state)+'</div>'+defs({saved_review:row.review_id,paper:row.selection?.paper,resolution_dpi:row.selection?.dpi,created_at:row.created_at});
    if(row.error)content+='<div class="notice error">'+esc(row.error.message||row.error)+'</div>';
    if(row.review_id)content+='<div class="page-actions">'+button('spatial-item','Open saved view','data-kind="spatial_reviews" data-id="'+esc(row.review_id)+'"')+'</div>';
    if(row.summary)content+=defs({map_mode:row.summary.mode,coordinate_system:row.summary.view?.crs,extent:row.summary.view?.bounds,annotations:row.summary.marker_count});
    content+=customerReviews.mapActions(row);
   }else if(kind==='deliveries'){
    content=deliveryReview.continuation(row,inspected.files)+inspected.html;
  }
  if(kind==='comparisons')content+='<div class="page-actions">'+button('comparison-delivery','Build delivery from this comparison','data-id="'+id+'"')+'</div>';
  if(kind==='runs'&&row.state==='complete')content+='<div class="page-actions">'+button('run-compare-selection','Compare this run','data-id="'+id+'"')+'</div>';
  if(['sources','grids','runs','comparisons','deliveries','spatial_reviews'].includes(kind))content='<div class="page-actions">'+button('spatial-item','Open in spatial review','data-kind="'+kind+'" data-id="'+id+'"')+'</div>'+content;
  if(kind!=='deliveries')content+='<h3 class="subheading">Retained files</h3>'+fileList(row._downloads)+'<details class="technical"><summary>Original record, selection and provenance</summary><pre class="json-view">'+esc(pretty(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='_downloads'))))+'</pre></details>';
  detail(row.title||row.metadata?.title||row.spec?.title||row.selection?.title||viewLabels[kind]||human(kind),content,{kind,id,state:row.state});detailContext.files=row._downloads;
  if(['runs','scenarios','comparisons'].includes(kind))detailContext.footprintRevision=scenarioInputReview.revision();
  if(kind==='deliveries'){detailContext.deliveryRevision=deliveryRevision(row);deliveryInspection.mount($('#detail-body'));}
  if(kind==='portfolios'||kind==='portfolio_reports'){detailContext.portfolio=row;mountPortfolioDetail();}
  if(kind==='observations'){detailContext.observation=row;mountObservedSeries($('#observed-series'),row);renderObservationRows();$('#observation-search').addEventListener('input',renderObservationRows);$('#observation-filter').addEventListener('change',renderObservationRows);}
  if(kind==='observation_comparisons'){
     detailContext.observationComparison=row;
     $('#comparison-parameter').innerHTML=[...new Set(row.comparisons.map(r=>r.parameter))].sort().map(x=>'<option value="'+esc(x)+'">'+esc(human(x))+'</option>').join('');
     $('#comparison-station').innerHTML='<option value="">All stations / catchments</option>'+[...new Set(row.comparisons.map(r=>r.station_id||r.catchment_id))].sort().map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');
     for(const id of ['comparison-parameter','comparison-station','comparison-coverage'])$('#'+id).addEventListener('change',renderObservationComparison);
     renderObservationComparison();
   }
   if(focus)$('#detail-body').scrollTop=0;
}
function renderObservationRows(){
  const row=detailContext.observation,q=$('#observation-search').value.trim().toLowerCase(),type=$('#observation-filter').value;
  const all=row.rows.filter(r=>(!q||JSON.stringify(r).toLowerCase().includes(q))&&(!type||(type==='admitted')===r.admitted));
  $('#observation-records').innerHTML='<p class="note">'+Math.min(150,all.length)+' of '+all.length+' matching retained rows. The original CSV download contains every source row.</p>'+table(['Record','Catchment / station','Measurement support','Parameter','Original value / unit','Period','Method / uncertainty','Disposition'],all.slice(0,150).map(r=>'<tr><td>'+esc(r.id)+'</td><td>'+esc(r.catchment_id)+'<br><small>'+esc(r.station_id)+'</small></td><td>'+observationSupportMarkup(r,row.metadata)+'</td><td>'+esc(r.parameter)+'</td><td>'+observedValueMarkup(r,row.metadata)+'</td><td>'+esc(r.period_start)+'<br>'+esc(r.period_end)+'</td><td>'+observationMethod(r)+'</td><td>'+badge(r.admitted?'admitted':'context')+'<small>'+esc(r.issues.join('; '))+'</small></td></tr>'));
}
function observationMethod(row){
 const method=row.method||'Original source method retained',uncertainty=row.uncertainty;
 return '<span>'+esc(typeof method==='string'?method:pretty(method))+'</span>'+
   (uncertainty!==undefined&&uncertainty!==null&&uncertainty!==''?'<details class="row-detail"><summary>Source uncertainty</summary><pre>'+esc(typeof uncertainty==='string'?uncertainty:pretty(uncertainty))+'</pre></details>':'<small>Source uncertainty not specified</small>')+
   (row.source_records?'<details class="row-detail"><summary>Original contributing records</summary><pre>'+esc(pretty(row.source_records))+'</pre></details>':'');
}
function comparisonRows(){
 const row=detailContext?.observationComparison;if(!row)return [];
 const parameter=$('#comparison-parameter').value,station=$('#comparison-station').value,coverage=$('#comparison-coverage').value;
 return row.comparisons.filter(r=>(!parameter||r.parameter===parameter)&&(!station||(r.station_id||r.catchment_id)===station)&&(!coverage||(coverage==='complete')===(r.included_in_metrics===true)));
}
function observationPlot(rows){
 const points=rows.filter(r=>r.included_in_metrics===true&&Number.isFinite(r.observed_annual_mass)&&Number.isFinite(r.modeled_annual_mass));
 if(!points.length)return '<p class="note">Select a complete source-catchment comparison to view the observed-versus-modeled plot.</p>';
 let maximum=1;for(const r of points)maximum=Math.max(maximum,r.observed_annual_mass,r.modeled_annual_mass);
 const maxValue=maximum*1.05,left=85,top=25,size=390,x=v=>left+v/maxValue*size,y=v=>top+size-v/maxValue*size;
 const ticks=Array.from({length:5},(_,i)=>i*maxValue/4),tick=v=>v>=1000000?v.toExponential(2):number(v);
 const grid=ticks.map(v=>'<line x1="'+x(v)+'" y1="'+top+'" x2="'+x(v)+'" y2="'+(top+size)+'" stroke="#dedede"/><line x1="'+left+'" y1="'+y(v)+'" x2="'+(left+size)+'" y2="'+y(v)+'" stroke="#dedede"/><text x="'+x(v)+'" y="'+(top+size+20)+'" text-anchor="middle">'+esc(tick(v))+'</text><text x="'+(left-9)+'" y="'+(y(v)+4)+'" text-anchor="end">'+esc(tick(v))+'</text>').join('');
 const circles=points.map(r=>'<circle cx="'+x(r.observed_annual_mass)+'" cy="'+y(r.modeled_annual_mass)+'" r="4" fill="#222" fill-opacity=".55" stroke="#fff" stroke-width=".7" tabindex="0"><title>'+esc((r.station_id||r.catchment_id)+'; '+r.period_start+' to '+r.period_end+'; observed '+number(r.observed_annual_mass)+'; modeled '+number(r.modeled_annual_mass)+' '+r.units)+'</title></circle>').join('');
 return '<figure class="observation-plot"><svg viewBox="0 0 525 485" role="img" aria-label="Observed versus modeled annual '+esc(points[0].parameter)+' loads for complete source catchments"><title>Observed versus modeled annual loads</title>'+grid+'<line x1="'+left+'" y1="'+(top+size)+'" x2="'+(left+size)+'" y2="'+top+'" stroke="#555" stroke-dasharray="5 4"/>'+circles+'<text x="'+(left+size/2)+'" y="468" text-anchor="middle">Observed annual mass ('+esc(points[0].units)+')</text><text transform="translate(17 220) rotate(-90)" text-anchor="middle">Modeled annual mass</text></svg><figcaption>'+points.length+' retained station-period comparisons. The dashed line represents equal annual mass. Point details retain each original period; repeated catchments share one selected model estimate.</figcaption></figure>';
}
function renderObservationComparison(){
 const rows=comparisonRows(),complete=rows.filter(r=>r.included_in_metrics===true).length;
 $('#observation-comparison-view').innerHTML='<p class="note">'+rows.length+' matching rows; '+complete+' complete catchments enter the plot and fit statistics. Other native partial totals remain visible below.</p>'+observationPlot(rows)+
 table(['Station / catchment','Original period','Observed annual mass','Modeled annual mass','Full-catchment residual','Whole-catchment coverage','Method / uncertainty'],rows.map(r=>{
   const c=r.spatial_coverage||{},legacy=r.included_in_metrics===undefined;
   const extent=c.raster_extent_coverage_fraction==null?'Not retained in this version':number(c.raster_extent_coverage_fraction*100)+'% of polygon inside raster extent';
   const grid=c.valid_fraction_of_selected_cells==null?'No selected grid cells':number(c.valid_cells)+' valid export cells of '+number(c.selected_cells)+' selected';
   const support=c.native_support_fraction==null?'':number(c.native_support_fraction*100)+'% expected native support; '+number(c.structural_stream_omission_cells)+' original stream omissions; '+number(c.unexpected_missing_cells)+' unexpected missing cells';
   return '<tr><td>'+esc(r.station_id||r.catchment_id)+'<br><small>'+esc(r.catchment_id)+'</small></td><td>'+esc(r.period_start)+'<br>'+esc(r.period_end)+'</td><td>'+number(r.observed_annual_mass)+'<br><small>'+esc(r.units)+'</small></td><td>'+number(r.modeled_annual_mass)+(r.included_in_metrics===false?'<small>Partial native total</small>':'')+'</td><td>'+(r.included_in_metrics===true?number(r.residual):'—')+'</td><td>'+badge(legacy?'legacy':r.coverage_status||'partial')+'<small>'+esc(extent)+'</small><small>'+esc(grid)+'</small>'+(support?'<small>'+esc(support)+'</small>':'')+'<small>'+esc((c.coverage_issues||[]).join('; '))+'</small></td><td>'+observationMethod(r)+'</td></tr>';
 }))+observationContextMarkup(detailContext.observationComparison.context_rows||[]);
}
function downloadObservationDiagnostics(){
 const comparison=detailContext?.observationComparison;
 if(!comparison?.diagnostics)return;
 const payload={comparison_id:comparison.id,diagnostics:comparison.diagnostics};
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\n'],{type:'application/json;charset=utf-8'})),a=document.createElement('a');
 a.href=url;a.download='annual-load-cohort-review-'+short(comparison.id)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadObservationComparison(){
 const selected=comparisonRows(),fields=['observation_id','station_id','catchment_id','parameter','measurement_support','species','support_origin','period_start','period_end','period_days','observed_annual_mass','modeled_annual_mass','units','residual','relative_residual','partial_catchment_difference','included_in_metrics','coverage_status','method','uncertainty','source_records','observed_value_text','observed_source_unit','observed_qualifier','spatial_coverage'];
 const cell=value=>'"'+String(value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):value).replaceAll('"','""')+'"';
 const text=[fields.map(cell).join(','),...selected.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';
 const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
 a.href=url;a.download='watershed-observation-comparison-'+short(detailContext.observationComparison.id)+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function showTask(id,focus=true,isCurrent=()=>true){
  if(!isCurrent())return;
  const request=++itemRequest,requestedWorkspace=workspace,row=await api(endpoint('/api/task',{id}));if(workspace!==requestedWorkspace||request!==itemRequest||!isCurrent())return;
  const registeredActions=await extensions.taskActions(row);if(workspace!==requestedWorkspace||request!==itemRequest||!isCurrent())return;
  const body='<div class="meta">'+badge(row.state)+'<span>'+esc(when(row.created_at))+'</span><span>'+row.attempts.length+' retained attempts</span></div>'+(row.error?'<div class="notice error">'+esc(row.error.message)+'</div>':'')+
  (row.result?.workspace_key?'<div class="notice"><strong>Original workspace restored</strong>'+button('workspace-select','Open restored copy','data-id="'+row.result.workspace_key+'"','small')+'</div>':'')+
  (row.action==='spatial.review.export'&&row.result?.id?'<div class="page-actions">'+itemButton('spatial_exports',row.result.id,'Open map pack')+'</div>':'')+
  (row._item?'<div class="page-actions">'+itemButton(row._item.kind,row._item.id,'Open saved result')+'</div>':'')+scenarioInputReview.taskActions(row)+community.taskActions(row)+programmes.taskActions(row)+(extensions.hasView('receiving-waters')?'':receivingWaters.taskActions(row))+nativeJobs.taskActions(row)+customerReviews.taskActions(row)+experiments.taskActions(row)+parameterStudies.taskActions(row)+registeredActions+fileList(row._downloads||[])+'<div class="page-actions">'+(['failed','interrupted','cancelled'].includes(row.state)?button('task-resume','Resume original selection','data-id="'+row.id+'"','primary'):'')+(row.state==='queued'?button('task-cancel','Cancel before start','data-id="'+row.id+'"'):'')+'</div><details class="technical" open><summary>Original selected inputs and attempts</summary><pre class="json-view">'+esc(pretty(row))+'</pre></details>';
  detail(actionLabels[row.action]||row.action,body,{kind:'task',id,state:row.state});detailContext.files=row._downloads||[];
  if(focus)$('#detail-body').scrollTop=0;
}

const input=(name,type='text',value='',attrs='')=>'<input name="'+esc(name)+'" type="'+esc(type)+'" value="'+esc(value??'')+'" '+attrs+'>';
const area=(name,value='',attrs='')=>'<textarea name="'+esc(name)+'" '+attrs+'>'+esc(value??'')+'</textarea>';
const field=(label,control,note='',wide=false)=>'<label class="'+(wide?'full':'')+'"><span>'+esc(label)+'</span>'+control+(note?'<small>'+esc(note)+'</small>':'')+'</label>';
const select=(name,rows,value='',required=true)=>'<select name="'+esc(name)+'" '+(required?'required':'')+'><option value="">Choose…</option>'+rows.map(x=>{const pair=Array.isArray(x)?x:[x.id,x.id==='GURA_NLCD'?sourceDisplayTitle(x):x.title||x.name||short(x.id)];return '<option value="'+esc(pair[0])+'" '+(String(pair[0])===String(value??'')?'selected':'')+'>'+esc(pair[1])+'</option>';}).join('')+'</select>';
const checks=(name,rows,chosen=[])=>'<div class="checkbox-list">'+rows.map(row=>'<label class="check"><input type="checkbox" name="'+esc(name)+'" value="'+esc(row.id)+'" '+(chosen.includes(row.id)?'checked':'')+'><span>'+esc(row.title||runTitle(row.id)||short(row.id))+'</span></label>').join('')+'</div>';
const val=(name,root=form)=>root.querySelector('[name="'+name+'"]')?.value??'';
const chosen=(name,root=form)=>$$('[name="'+name+'"]:checked',root).map(x=>x.value);
const num=(name,root=form,optional=false)=>{const text=val(name,root).trim();if(!text&&optional)return undefined;const n=Number(text);if(!text||!Number.isFinite(n))throw Error('Enter a finite value for '+human(name)+'.');return n;};
const lines=text=>text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const sources=()=>state.data.sources;
const collectionDefault=row=>row?.source_collection_id||((sources().length===1)?sources()[0].id:'');
const sourceRows=(collection,kind=null)=>{const edition=sources().find(x=>x.id===collection);return (edition?.entries||[]).filter(x=>!kind||kind.split('|').includes(x.kind));};
const requireSources=()=>{if(!sources().length)throw Error('Import an original source edition first.');};
function setOptions(node,rows,selected=node.value){node.innerHTML=select('_',rows,selected,node.required).replace(/^<select[^>]*>|<\/select>$/g,'');}
function openForm(title,description,html,submit,onSubmit,setup){
  formRevision++;
  formContext={workspace,operation_id:crypto.randomUUID(),onSubmit,busy:false};
  $('#form-title').textContent=title;$('#form-description').textContent=description;
  $('#form-body').innerHTML=html;$('#form-submit').textContent=submit;
  $('#form-error').hidden=true;$('#form-progress').textContent='';$('#form-submit').disabled=false;
  if(!formDialog.open)formDialog.showModal();
  if(setup)setup();
}
function admissionContext(action,operationId){
  return {workspace,workspaceRevision,connectionEpoch,formRevision,navigationRevision,
    itemRequest,operation_id:operationId,action,
    workspaceTitle:state?.workspaces?.find(row=>row.id===workspace)?.title||workspace};
}
function currentAdmission(ticket,{details=true}={}){
  return capability&&connectionEpoch===ticket.connectionEpoch&&workspace===ticket.workspace&&
    workspaceRevision===ticket.workspaceRevision&&formRevision===ticket.formRevision&&
    navigationRevision===ticket.navigationRevision&&(!details||itemRequest===ticket.itemRequest);
}
function retainedTaskNotice(ticket){
  return (actionLabels[ticket.action]||ticket.action)+' retained in '+ticket.workspaceTitle+
    '. Open Tasks to inspect the saved operation.';
}
async function presentAcceptedTask(ticket,result){
  // Acceptance is complete before any refresh, dialog or result inspection.
  // A later display failure must never turn this into a request to submit again.
  if(connectionEpoch!==ticket.connectionEpoch)return result;
  acceptedTasks.set(ticket.workspace+':'+result.id,{...ticket,id:result.id});
  if(currentAdmission(ticket)){
    taskPanel=true;$('#task-panel').hidden=false;
    for(const button of $$('[data-action="tasks"]'))button.setAttribute('aria-expanded','true');
  }
  renderTasks();toast(retainedTaskNotice(ticket));
  if(!currentAdmission(ticket))return result;
  try{
    await refresh({force:true});
    if(currentAdmission(ticket)&&!formDialog.open)
      await showTask(result.id,true,()=>currentAdmission(ticket,{details:false})&&!formDialog.open);
  }catch(error){
    if(connectionEpoch===ticket.connectionEpoch)
      toast(retainedTaskNotice(ticket)+' '+(error.message||String(error)));
  }
  return result;
}
async function submitAction(action,payload){
  const context=formContext;
  if(context&&context.workspace!==workspace)throw Error('The selected workspace changed. Reopen this form in the intended workspace.');
  const submittedOperation=context?.operation_id||crypto.randomUUID();
  const ticket=admissionContext(action,submittedOperation),journey=operatingJourney;
  const originalRequest={workspace:ticket.workspace,action,payload,operation_id:submittedOperation};
  const request=journey?journey.beforeSubmission(originalRequest):originalRequest;
  const result=await api('/api/actions',{method:'POST',body:request});
  if(context)context.acceptedTask={id:result.id,workspace:ticket.workspace};
  if(connectionEpoch!==ticket.connectionEpoch)return result;
  if(workspace===ticket.workspace&&workspaceRevision===ticket.workspaceRevision){
    try{journey?.acceptTask(result,submittedOperation);}
    catch(error){toast('Operation retained. Journey display: '+(error.message||String(error)));}
  }
  if(formContext===context&&currentAdmission(ticket,{details:false})){
    formDialog.close();formContext=null;
  }
  return presentAcceptedTask(ticket,result);
}
async function openAcceptedTask(id,targetWorkspace){
  const ticket=acceptedTasks.get(targetWorkspace+':'+id);
  if(!ticket||ticket.connectionEpoch!==connectionEpoch)return;
  if(formDialog.open)throw Error('Finish or close the current draft before opening the saved operation.');
  const epoch=connectionEpoch,revision=formRevision,selectedView=navigationRevision;
  const revisionWorkspace=workspaceRevision+(workspace!==targetWorkspace?1:0);
  if(workspace!==targetWorkspace)await selectWorkspace(targetWorkspace);
  if(connectionEpoch!==epoch||workspace!==targetWorkspace||workspaceRevision!==revisionWorkspace||
      formRevision!==revision||navigationRevision!==selectedView||formDialog.open)return;
  taskPanel=true;$('#task-panel').hidden=false;
  for(const button of $$('[data-action="tasks"]'))button.setAttribute('aria-expanded','true');
  await showTask(id,true,()=>connectionEpoch===epoch&&workspace===targetWorkspace&&
    workspaceRevision===revisionWorkspace&&formRevision===revision&&
    navigationRevision===selectedView&&!formDialog.open);
}
async function uploadFile(file){
  if(!file)throw Error('Choose the original file.');
  if(file.size>state.limits.upload_bytes)throw Error('This file is larger than this operator’s configured '+bytes(state.limits.upload_bytes)+' upload capacity.');
  $('#form-progress').textContent='Retaining '+file.name+' ('+bytes(file.size)+')…';
  return api('/api/upload',{method:'POST',raw:file,filename:file.name});
}
function filterEditor(name,value={}){
 return '<fieldset class="full" data-filter="'+esc(name)+'"><legend>Optional exact attribute selection</legend><p class="note">Use original field names and values. Leaving this empty uses the complete selected layer.</p><div data-filter-rows>'+Object.entries(value||{}).map(([key,value])=>filterRow(key,value)).join('')+'</div>'+button('filter-add','Add field selection','','small')+'</fieldset>';
}
function filterRow(name='',value=''){
 const type=value===null?'null':typeof value==='number'?'number':typeof value==='boolean'?'boolean':'text';
 return '<div class="repeat-row" data-filter-row>'+field('Field',input('filter_field','text',name,'required'))+field('Type',select('filter_type',[['text','Text'],['number','Number'],['boolean','True / false'],['null','Null']],type))+field('Exact value',input('filter_value','text',value===null?'':String(value)))+button('row-remove','Remove','','small')+'</div>';
}
function readFilter(name,root=form){
 const target=root.querySelector('[data-filter="'+name+'"]'),result={};
 for(const row of $$('[data-filter-row]',target)){
  const key=val('filter_field',row).trim(),type=val('filter_type',row),text=val('filter_value',row);
  if(!key)throw Error('Each selection needs its original field name.');
  if(Object.hasOwn(result,key))throw Error('A field appears twice in the exact selection: '+key);
  let value=text;
  if(type==='number'){value=Number(text);if(!text.trim()||!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))throw Error('Use a finite, safely representable number for '+key+'.');}
  if(type==='boolean'){if(!['true','false'].includes(text.toLowerCase()))throw Error('Use true or false for '+key+'.');value=text.toLowerCase()==='true';}
  if(type==='null')value=null;
  result[key]=value;
 }
 return Object.keys(result).length?result:undefined;
}
function vectorSelection(name,label,collection,value={}){
 return '<fieldset class="full" data-vector="'+esc(name)+'"><legend>'+esc(label)+'</legend><div class="form-grid">'+field('Original vector source',select(name+'_source',sourceRows(collection,'vector'),value.source_id))+field('Layer name',input(name+'_layer','text',value.layer||''),'Optional for a source with one layer.')+filterEditor(name,value.where)+'</div></fieldset>';
}
function readVector(name,root=form){const row={source_id:val(name+'_source',root)};const layer=val(name+'_layer',root).trim(),where=readFilter(name,root);if(layer)row.layer=layer;if(where)row.where=where;return row;}
function bindCollection(name,targets,chosenValues={}){
 const node=form.elements.namedItem(name);
 const update=()=>{const collection=node.value;for(const [target,kind] of targets){const el=form.elements.namedItem(target);if(el)setOptions(el,sourceRows(collection,kind),chosenValues[target]??el.value);}chosenValues={};};
 node.addEventListener('change',update);update();
}
function renderOriginalSourcePreview(preview){
 $('#source-preview').innerHTML='<h3 class="subheading">'+esc(preview.title)+'</h3><p class="note">'+preview.entries.length+' original sources · manifest <span class="mono">'+esc(short(preview.manifest_sha256))+'</span></p>'+table(['Source','Kind / role','Original URI','Vintage / units'],preview.entries.map(x=>'<tr><td>'+esc(sourceDisplayTitle(x))+'<small>'+esc(x.path)+'</small></td><td>'+esc(x.kind)+'<br>'+esc(x.role||'')+'</td><td>'+external(x.uri)+'</td><td>'+esc(x.vintage)+'<br>'+esc(x.units||'')+'</td></tr>'));
 $('#form-submit').textContent='Import this source edition';
 $('#form-progress').textContent='Preview retained. Review the exact source selection before import.';
}
function sourceForm(options={}){
 const included=options.includedArchive||null;
 if(included&&(included.workspace_key!==workspace||!included.archive||
  !/^[0-9a-f]{64}$/.test(included.archive_id||'')||
  !/^[0-9a-f]{64}$/.test(included.archive.sha256||'')||
  !Number.isSafeInteger(included.archive.bytes)||included.archive.bytes<0||
  included.preview?.kind!=='archive'||!/^[0-9a-f]{64}$/.test(included.preview.id||'')||
  included.preview.archive_sha256!==included.archive.sha256||
  included.preview.upload_id!==included.archive.id||!Array.isArray(included.preview.entries)))
  throw Error('Preview the included source archive again in the current Workspace.');
 sourcePreview=null;
 const registered=[...(state.registered_sources||[])];
 if(options.registeredManifest&&!registered.some(row=>row.id===options.registeredManifest.id))
  registered.push(options.registeredManifest);
 if(options.registeredId&&!registered.some(row=>row.id===options.registeredId))
  throw Error('Refresh and choose an available registered source edition.');
 openForm('Import original source data','Preview the original metadata and file selection, then retain the edition in the native workspace.',
 '<div class="form-grid">'+field('Source selection',select('source_mode',[...(included?[['included','Included source archive']]:[]),...(registered.length?[['registered','Registered source manifest']]:[]),['archive','Source archive (ZIP)'],['file','Single original table or file']],included?'included':options.mode==='archive'?'archive':options.mode==='registered'&&registered.length?'registered':registered.length?'registered':'archive'))+
 '<div id="source-selection-body" class="full"></div><div id="source-preview" class="full"></div></div>','Preview source',
 async()=>{
  if(included&&val('source_mode')==='included'&&included.workspace_key!==workspace)
   throw Error('Preview the included archive again in the current Workspace.');
  if(sourcePreview)return submitAction('source.import',{preview_id:sourcePreview.id});
  const context=formContext,generation=context.sourcePreviewGeneration,selectedWorkspace=workspace;
  const currentDraft=()=>{if(formContext!==context||workspace!==selectedWorkspace||context.sourcePreviewGeneration!==generation)throw Error('The source selection changed while it was being checked. Preview the current selection again.');};
  const mode=val('source_mode');let data;
  if(mode==='registered')data={registered_id:val('registered_id')};
  else{
   const file=form.elements.namedItem('source_file').files[0];
   data={};
   if(mode==='archive'&&val('manifest_member').trim())data.manifest_member=val('manifest_member').trim();
   if(mode==='file'){
    data.file_metadata={title:val('source_title'),uri:val('source_uri'),vintage:val('source_vintage'),kind:val('source_kind')};
    for(const [name,key] of [['source_units','units'],['source_role','role'],['source_layer','layer']])if(val(name).trim())data.file_metadata[key]=val(name).trim();
    data.notes=lines(val('source_notes'));
   }
   const uploaded=await uploadFile(file);currentDraft();data.upload_id=uploaded.id;
  }
  const preview=await api('/api/source-preview',{method:'POST',body:data});
  currentDraft();sourcePreview=preview;
  renderOriginalSourcePreview(sourcePreview);
 },()=>{
  const renderSource=()=>{
   formContext.sourcePreviewGeneration=(formContext.sourcePreviewGeneration||0)+1;
   sourcePreview=null;$('#source-preview').innerHTML='';$('#form-submit').textContent='Preview source';
   const mode=val('source_mode');
   if(mode==='included'){
    if(!included||included.workspace_key!==workspace)throw Error('Preview the included archive in the current Workspace.');
    $('#source-selection-body').innerHTML='<h3 class="subheading">'+esc(included.archive.filename)+'</h3>'+
     '<p class="note">Included source archive · '+included.archive.bytes.toLocaleString()+' bytes. The original ZIP has been retained for this preview; no source edition has been imported yet.</p>'+
     '<dl><dt>Archive SHA256</dt><dd class="mono">'+esc(included.archive.sha256)+'</dd>'+
     '<dt>Original import manifest</dt><dd class="mono">'+esc(included.preview.manifest_member)+'</dd></dl>';
    sourcePreview=included.preview;renderOriginalSourcePreview(sourcePreview);return;
   }
   $('#source-selection-body').innerHTML=mode==='registered'?field('Registered manifest',select('registered_id',registered.map(x=>[x.id,x.title+' · '+x.entries+' sources']),options.registeredId||registered[0]?.id),'',true):
    '<div class="form-grid">'+field(mode==='archive'?'Original source ZIP':'Original source file',input('source_file','file','','required '+(mode==='archive'?'accept=".zip"':'')),'Files are uploaded as their original bytes.',true)+
    (mode==='archive'?field('Manifest entry, when the ZIP has several manifests',input('manifest_member','text',options.manifestMember||''),'Optional. Use the exact original relative path.',true):
     field('Title',input('source_title','text','','required'))+field('Original source URI',input('source_uri','url','','required'))+field('Source vintage',input('source_vintage','text','','required'),'Edition, release date or actual observation period.')+field('Kind',select('source_kind',[['table','Table'],['raster','Raster'],['vector','Vector'],['document','Document']],'table'))+field('Units',input('source_units'))+field('Role',input('source_role'),'Optional original source role.')+field('Layer',input('source_layer'))+field('Source notes',area('source_notes'),'One note per line.',true))+'</div>';
  };
  form.elements.namedItem('source_mode').addEventListener('change',renderSource);renderSource();
  form.addEventListener('input',sourceDraftChanged,{once:false});
 });
}
function sourceDraftChanged(event){
 if(!formContext||!event.target.closest('#source-selection-body'))return;
 formContext.sourcePreviewGeneration=(formContext.sourcePreviewGeneration||0)+1;
 sourcePreview=null;$('#source-preview').innerHTML='';$('#form-submit').textContent='Preview source';
}
function nativeModels(record){
 const chosen=record?.models??['ndr','sdr'];
 return ['ndr','sdr'].filter(name=>Array.isArray(chosen)&&chosen.includes(name));
}
function nativeModelLabel(record){return nativeModels(record).map(x=>x.toUpperCase()).join(' + ');}
function nativeModelOptions(available=['ndr','sdr']){
 return [['ndr,sdr','NDR + SDR — nutrients and sediment'],['ndr','NDR — nitrogen and phosphorus'],['sdr','SDR — sediment']]
  .filter(([value])=>value.split(',').every(name=>available.includes(name)));
}
function nativeModelFields(value=val('models')){
 const chosen=String(value).split(',').filter(Boolean);
 if(!chosen.length||chosen.some(x=>!['ndr','sdr'].includes(x))||new Set(chosen).size!==chosen.length)throw Error('Select NDR, SDR, or both native models.');
 const models=['ndr','sdr'].filter(name=>chosen.includes(name));
 return models.length===2?{}:{models};
}
function bindNativeModelFields(){
 const control=form.elements.namedItem('models');
 const update=()=>{
  const chosen=control.value.split(',');
  for(const node of $$('[data-native-models]',form)){
   const active=node.dataset.nativeModels.split(' ').some(name=>chosen.includes(name));
   node.hidden=!active;
   for(const input of $$('input,select,textarea,button',node))input.disabled=!active;
  }
 };
 control.addEventListener('change',update);update();
}
function fullNativeRun(row){
 return row?.state==='complete'&&nativeModels(row.selection).length===2&&
  ['ndr','sdr'].every(name=>completedModelStage(row,name))&&
  ['nitrogen_export','phosphorus_export','sediment_export'].every(name=>row.artifacts?.[name]);
}
function nativeOutputCell(row,model,artifact){
 return nativeModels(row.selection).includes(model)?sumCell(row.artifacts?.[artifact]):'<span class="muted">Not selected</span>';
}

async function profileForm(id){
 requireSources();const current=formOpening('profile.save');
 let row;
 try{row=id?await api(endpoint('/api/item',{kind:'profiles',id})):null;}
 catch(error){if(current())throw error;return;}
 if(!current())return;
 const collection=collectionDefault(row);
 const parameter=(group,key,label,note='',attrs='')=>field(label,input(group+'_'+key,'number',row?.[group]?.[key]??'','required step="any" '+attrs),note);
 openForm(row?'Revise parameter profile':'New parameter profile','Select the original biophysical table, the native models to calculate and their published parameters. Each saved revision retains the complete original table and its own identity.',
 '<div class="form-grid">'+field('Profile title',input('title','text',row?.title?row.title+' · revision':'','required'),'',true)+
 field('Native models',select('models',nativeModelOptions(),nativeModels(row).join(',')),'NDR uses nutrient coefficients; SDR uses erosion coefficients.',true)+
 field('Source edition',select('collection',sources(),collection))+field('Original biophysical CSV',select('biophysical_source',sourceRows(collection,'table'),row?.biophysical_source_id))+
 field('Published references',area('references',(row?.references||[]).map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n'),'required'),'One source citation or URL per line.',true)+
 field('Model period',input('model_period','text',typeof row?.model_period==='object'?JSON.stringify(row.model_period):row?.model_period||''),'Retain the actual period represented by the selected source data.',true)+
 '<fieldset class="full" data-native-models="ndr"><legend>Nutrient Delivery Ratio</legend><div class="form-grid">'+
 parameter('ndr','threshold_flow_accumulation','Flow accumulation threshold','Pixels.','min="0"')+parameter('ndr','k_param','Connectivity k','Positive native parameter.','min="0"')+
 field('Flow direction',select('ndr_flow_dir_algorithm',[['mfd','Multiple flow direction'],['d8','D8']],row?.ndr?.flow_dir_algorithm))+
 parameter('ndr','subsurface_critical_length_n','Nitrogen subsurface critical length','Metres.','min="0"')+parameter('ndr','subsurface_eff_n','Nitrogen subsurface retention efficiency','Fraction from 0 to 1.','min="0" max="1"')+
 field('Runoff proxy average',input('ndr_runoff_proxy_av','number',row?.ndr?.runoff_proxy_av??'','step="any" min="0"'),'Optional original native override.')+'</div></fieldset>'+
 '<fieldset class="full" data-native-models="sdr"><legend>Sediment Delivery Ratio</legend><div class="form-grid">'+
 parameter('sdr','threshold_flow_accumulation','Flow accumulation threshold','Pixels.','min="0"')+parameter('sdr','k_param','Connectivity k','Positive native parameter.','min="0"')+
 field('Flow direction',select('sdr_flow_dir_algorithm',[['mfd','Multiple flow direction'],['d8','D8']],row?.sdr?.flow_dir_algorithm))+
 parameter('sdr','sdr_max','Maximum SDR','Fraction from 0 to 1.','min="0" max="1"')+parameter('sdr','ic_0_param','Connectivity midpoint')+parameter('sdr','l_max','Maximum RUSLE L-factor','Dimensionless.','min="0"')+'</div></fieldset>'+
 field('Notes',area('notes',(row?.notes||[]).join('\n')),'One note per line.',true)+'</div>','Save immutable profile',()=>{
  const modelFields=nativeModelFields(),active=nativeModels(modelFields),parameters={};
  if(active.includes('ndr')){
   const ndr={};for(const k of ['threshold_flow_accumulation','k_param','subsurface_critical_length_n','subsurface_eff_n'])ndr[k]=num('ndr_'+k);
   ndr.flow_dir_algorithm=val('ndr_flow_dir_algorithm');
   const runoff=num('ndr_runoff_proxy_av',form,true);if(runoff!==undefined)ndr.runoff_proxy_av=runoff;
   parameters.ndr=ndr;
  }
  if(active.includes('sdr')){
   const sdr={};for(const k of ['threshold_flow_accumulation','k_param','sdr_max','ic_0_param','l_max'])sdr[k]=num('sdr_'+k);
   sdr.flow_dir_algorithm=val('sdr_flow_dir_algorithm');parameters.sdr=sdr;
  }
  return submitAction('profile.save',{title:val('title'),source_collection_id:val('collection'),biophysical_source_id:val('biophysical_source'),references:lines(val('references')),...modelFields,...parameters,model_period:val('model_period'),notes:lines(val('notes'))});
 },()=>{bindCollection('collection',[['biophysical_source','table']],{biophysical_source:row?.biophysical_source_id});bindNativeModelFields();});
}
function bindGridResolution(original){
 const context=formContext,selectedWorkspace=workspace;
 let revision=0;
 const readReference=async()=>{
  const turn=++revision,collection=val('collection'),source=val('raster_NLCD'),node=form.elements.namedItem('resolution'),note=$('#grid-native-reference');
  context.nativeReferenceLoading=false;
  if(!collection||!source){note.textContent='Choose the original land-cover raster to read its native cell size.';return;}
  context.nativeReferenceLoading=true;note.textContent='Reading the selected original land-cover grid…';
  const current=()=>formContext===context&&workspace===selectedWorkspace&&turn===revision&&val('collection')===collection&&val('raster_NLCD')===source;
  try{
   const header=await api(endpoint('/api/source-info',{collection,source}));
   if(!current())return;
   const resolution=header.native_resolution_m;
   if(!Number.isFinite(resolution)||resolution<=0){note.textContent='This reference is not a square, north-up projected metre grid. Select the original model reference or inspect its source details.';return;}
   const unchanged=original?.spec?.source_collection_id===collection&&original?.spec?.input_sources?.NLCD===source;
   if(!unchanged)node.value=String(resolution);
   note.textContent='Original land cover: '+number(resolution)+' m cells; '+number(header.width)+' × '+number(header.height)+'; '+(header.crs||'CRS not supplied')+'.'+(unchanged?' The saved grid selection is preserved.':' The cell-size field now matches this source.');
  }catch(error){if(current())note.textContent='Read the original source header to confirm cell size: '+error.message;}
  finally{if(current())context.nativeReferenceLoading=false;}
 };
 form.elements.namedItem('collection').addEventListener('change',readReference);
 form.elements.namedItem('raster_NLCD').addEventListener('change',readReference);
 readReference();
}
async function gridForm(id){
 requireSources();const current=formOpening('grid.prepare');
 let original;
 try{original=id?await api(endpoint('/api/item',{kind:'grids',id})):null;}
 catch(error){if(current())throw error;return;}
 if(!current())return;
 const row=original?.spec,collection=collectionDefault(row);
 const rasterRoles=[['DEM','Elevation model','ndr sdr'],['NLCD','Original land cover','ndr sdr'],['PRECIPITATION','Precipitation','ndr'],['R_FACTOR','Rainfall erosivity','sdr'],['K_FACTOR','Soil erodibility','sdr']];
 const canReuse=original?.state==='complete',originalResolution=original?.grid?.resolution_m??row?.resolution_m??30;
 openForm(row?'Extend or revise native grid':'Prepare native model grid','Choose the native models and their original sources, reporting area and upstream context. A completed grid can supply its exact common inputs when the remaining model sources arrive.',
 '<div class="form-grid">'+field('Grid title',input('title','text',row?.title?row.title+' · revision':'','required'))+field('Source edition',select('collection',sources(),collection))+
 field('Native models',select('models',nativeModelOptions(),nativeModels(row).join(',')),'NDR requires elevation, land cover and precipitation. SDR requires elevation, land cover, rainfall erosivity and soil erodibility.',true)+
 field('Native cell size',input('resolution','number',row?(row.resolution_m??originalResolution):'','required min="0" step="any"'),'Metres per square cell, read from the selected original land-cover raster. The Upper Savannah production maps require 30 × 30 m cells (RFP p. 2). Each demonstration retains its source edition’s actual grid.')+
 '<p id="grid-native-reference" class="note full" role="status"></p>'+
 (canReuse?'<label class="full"><span>Reuse original grid preparation</span><span><input name="reuse_original_grid" type="checkbox" checked> Carry completed common files from '+esc(short(original.id))+'</span><small>Keep the original cell size, geometry, source selections and context buffer to reuse them. Clear this choice when changing the physical grid. New input roles are prepared in the new grid.</small></label>':'')+
 rasterRoles.map(([key,label,models])=>field(label,select('raster_'+key,sourceRows(collection,'raster'),row?.input_sources?.[key])).replace('<label','<label data-native-models="'+models+'"')).join('')+
 field('Upstream context buffer',input('buffer','number',row?.upstream_buffer_m??'','required min="0" max="999999" step="any"'),'Metres added around the selected hydrologic model domain. Zero retains that domain unchanged; a positive value expands it. Retain the catchment-specific rationale. Upper Savannah production requires an external modeling buffer without fixing its distance.')+
 vectorSelection('reporting','Reporting boundary',collection,row?.reporting_area)+vectorSelection('domain','Hydrologic model domain',collection,row?.model_domain)+'</div>',
 'Prepare original grid',()=>{
  if(formContext.nativeReferenceLoading)throw Error('The selected original raster header is still loading.');
  const modelFields=nativeModelFields(),active=nativeModels(modelFields),input_sources={},resolution=num('resolution');
  if(resolution<=0)throw Error('Enter a positive native cell size in metres that matches the original land-cover grid.');
  for(const [key,,models]of rasterRoles)if(models.split(' ').some(name=>active.includes(name)))input_sources[key]=val('raster_'+key);
  const selection={title:val('title'),source_collection_id:val('collection'),...modelFields,input_sources,reporting_area:readVector('reporting'),model_domain:readVector('domain'),upstream_buffer_m:num('buffer')};
  if(row?.resolution_m!==undefined||resolution!==30)selection.resolution_m=resolution;
  if(canReuse&&form.elements.namedItem('reuse_original_grid')?.checked){
   if(resolution!==Number(originalResolution))throw Error('A different native cell size needs a new grid preparation. Clear Reuse original grid preparation, then select the matching original land-cover source.');
   selection.base_grid_id=original.id;
  }
  return submitAction('grid.prepare',selection);
 },()=>{bindCollection('collection',[...rasterRoles.map(([key])=>['raster_'+key,'raster']),['reporting_source','vector'],['domain_source','vector']]);bindNativeModelFields();bindGridResolution(original);});
}
function scenarioMaskSources(collection){
 return sourceRows(collection,'vector|raster').map(row=>[row.id,
  (row.id==='GURA_NLCD'?sourceDisplayTitle(row):row.title||row.name||short(row.id))+
  (row.kind==='raster'?' · Binary raster mask':' · Polygon mask')]);
}
function scenarioMaskSource(collection,id){
 return sourceRows(collection,'vector|raster').find(row=>row.id===id);
}
function updatePatchMask(node,collection,enabled=true){
 const source=scenarioMaskSource(collection,val('mask_source',node)),raster=source?.kind==='raster';
 for(const section of $$('[data-patch-vector]',node)){
  section.hidden=raster;
  for(const control of $$('input,select,textarea,button',section))control.disabled=!enabled||raster;
 }
 const note=$('[data-patch-mask-note]',node);
 note.textContent=raster?
  'Binary raster: band 1 must match the selected native grid exactly and contain only valid 0/1 values. Cells equal to 1 select the change; zero and mask NoData are excluded. Native preparation checks the original raster.':
  source?'Polygon mask: cells are selected by the original pixel-centre rule. Optional layer and exact field selections apply to this vector source.':
  'Choose an original polygon source or an aligned binary raster mask.';
}
function patchRow(collection,row={}){
 const present=value=>value!==null&&typeof value==='object'?Object.keys(value).length>0:Boolean(value);
 if(scenarioMaskSource(collection,row.mask_source_id)?.kind==='raster'&&(present(row.layer)||present(row.where)))
  throw Error('This saved raster-mask patch contains a layer or attribute selection. Raster masks use band 1; correct the original scenario selection before revising it.');
 return '<fieldset class="patch" data-patch><div class="patch-header"><legend>Land-cover change</legend>'+button('row-remove','Remove change','','small')+'</div><div class="form-grid">'+
 field('Original polygon or binary raster mask',select('mask_source',scenarioMaskSources(collection),row.mask_source_id))+
 '<p class="note full" data-patch-mask-note role="status"></p>'+
 field('Layer name',input('mask_layer','text',row.layer||''),'Optional for a vector source with one layer.').replace('<label','<label data-patch-vector')+
 field('Original land-cover codes',input('from_codes','text',(row.from_codes||[]).join(', '),'required'),'Separate the exact integer codes with commas.')+field('Replacement land-cover code',input('to_code','number',row.to_code??'','required step="1"'))+
 field('Reason for this change',area('patch_reason',row.reason||'','required'),'',true)+filterEditor('patch',row.where).replace('<fieldset','<fieldset data-patch-vector')+'</div></fieldset>';
}
async function scenarioForm(id){
 requireSources();const current=formOpening('scenario.save');
 let row;
 try{row=id?await api(endpoint('/api/item',{kind:'scenarios',id})):null;}
 catch(error){if(current())throw error;return;}
 if(!current())return;
 const collection=collectionDefault(row);
 openForm(row?'Revise land-cover scenario':'New land-cover scenario','Keep an unchanged baseline or define ordered changes using original polygon or aligned binary raster masks and land-cover codes. The model records the scenario separately from the source data.',
 '<div class="form-grid">'+field('Scenario title',input('title','text',row?.title?row.title+' · revision':'','required'))+field('Scenario type',select('kind',[['baseline','Unchanged source baseline'],['landcover','Explicit land-cover changes']],row?.kind||'baseline'))+
 field('Original source edition',select('collection',sources(),collection))+field('Scenario reason',area('reason',row?.reason||'','required'),'',true)+
 '<div class="full" id="scenario-patches"><div id="patch-list">'+(row?.patches||[]).map(x=>patchRow(collection,x)).join('')+'</div>'+button('patch-add','Add land-cover change','','small')+'</div></div>',
 'Save immutable scenario',()=>{
  const kind=val('kind'),patches=[];
  if(kind==='landcover')for(const node of $$('[data-patch]',form)){
   const codes=val('from_codes',node).split(',').map(x=>x.trim());
   if(!codes.length||codes.some(x=>!x||!Number.isSafeInteger(Number(x))))throw Error('Enter the exact original integer land-cover codes.');
   const to=num('to_code',node);if(!Number.isSafeInteger(to))throw Error('The replacement land-cover code must be an integer.');
   const patch={mask_source_id:val('mask_source',node),from_codes:codes.map(Number),to_code:to,reason:val('patch_reason',node)};
   const source=scenarioMaskSource(val('collection'),patch.mask_source_id);
   if(!source)throw Error('Choose an original polygon or binary raster mask from this source edition.');
   if(source.kind==='vector'){
    const layer=val('mask_layer',node).trim(),where=readFilter('patch',node);if(layer)patch.layer=layer;if(where)patch.where=where;
   }
   patches.push(patch);
  }
  if(kind==='landcover'&&!patches.length)throw Error('Add at least one actual land-cover change.');
  return submitAction('scenario.save',{title:val('title'),kind,source_collection_id:val('collection'),reason:val('reason'),patches});
 },()=>{
  const update=()=>{
   const visible=val('kind')==='landcover';$('#scenario-patches').hidden=!visible;
   for(const el of $$('input,select,textarea,button', $('#scenario-patches')))el.disabled=!visible;
   for(const node of $$('[data-patch]',form))updatePatchMask(node,val('collection'),visible);
  };
  form.elements.namedItem('kind').addEventListener('change',update);
  form.elements.namedItem('collection').addEventListener('change',()=>{
   for(const el of $$('[name="mask_source"]',form))setOptions(el,scenarioMaskSources(val('collection')));
   update();
  });
  $('#patch-list').addEventListener('change',event=>{
   if(event.target.name==='mask_source')updatePatchMask(event.target.closest('[data-patch]'),val('collection'),val('kind')==='landcover');
  });
  update();
 });
}
function runForm(selection={}){
 const grids=state.data.grids.filter(x=>x.state==='complete').map(x=>({id:x.id,title:(x.spec.title||'Model grid')+' · '+nativeModelLabel(x.spec)})),profiles=state.data.profiles.map(x=>({id:x.id,title:x.title+' · '+nativeModelLabel(x)})),scenarios=state.data.scenarios;
 if(!grids.length||!profiles.length||!scenarios.length)throw Error('Prepare a model grid, an original parameter profile and a scenario before selecting a native run.');
 openForm('Prepare native model run','Bind the actual grid, parameter table, scenario and selected InVEST models. Prepare its retained identity, then preview actual eligible and changed cells before starting the native models.',
 '<div class="form-grid">'+field('Prepared model grid',select('grid',grids,selection.grid_id))+
 field('Parameter profile',select('profile',profiles,selection.profile_id))+field('Land-cover scenario',select('scenario',scenarios,selection.scenario_id))+
 field('Native models',select('models',[]),'The choices use models present in both the prepared grid and selected profile.')+
 '<p id="run-model-readiness" class="note full">Choose the grid and profile to see their available models.</p>'+
 '<div id="run-input-readiness" class="full"></div>'+
 '<p class="note full">Each native stage retains its actual arguments, engine source, logs and original outputs. Resuming uses completed stages. An exact stage from another retained run can also be reused with its original provenance.</p></div>','Prepare retained run',
 ()=>submitAction('run.prepare',{grid_id:val('grid'),profile_id:val('profile'),scenario_id:val('scenario'),...nativeModelFields()}),
 ()=>{
  const update=()=>{
   const grid=state.data.grids.find(x=>x.id===val('grid')),profile=state.data.profiles.find(x=>x.id===val('profile'));
   const available=grid&&profile?nativeModels(grid.spec).filter(x=>nativeModels(profile).includes(x)):[];
   const node=form.elements.namedItem('models'),previous=node.value?node.value.split(','):(Array.isArray(selection.models)&&selection.models.length?selection.models:available);
   const selected=previous.length&&previous.every(x=>available.includes(x))?previous.join(','):available.join(',');
   setOptions(node,nativeModelOptions(available),selected);
   $('#run-model-readiness').textContent=!grid||!profile?'Choose the grid and profile to see their available models.':available.length?'Ready to calculate '+available.map(x=>x.toUpperCase()).join(' and ')+'.':'These selections have no native model in common. Select a matching profile or extend the prepared grid.';
   updateInputReview();
  };
  const updateInputReview=()=>{$('#run-input-readiness').innerHTML=scenarioInputReview.selectionPanel({grid_id:val('grid'),profile_id:val('profile'),scenario_id:val('scenario'),models:val('models').split(',').filter(Boolean)});};
  form.elements.namedItem('grid').addEventListener('change',update);form.elements.namedItem('profile').addEventListener('change',update);form.elements.namedItem('scenario').addEventListener('change',updateInputReview);form.elements.namedItem('models').addEventListener('change',updateInputReview);update();
 });
}
function completedModelStage(row,model){
 const stage=row?.stages?.[model]||row?.stage_summary?.[model];
 return stage?.completed_at&&(stage.file_count??Object.keys(stage.files||{}).length)>0?stage:null;
}
function completedModelSources(target,model){
 const rows=(state?.data?.runs||[]).filter(row=>nativeModels(row.selection).includes(model)&&
  !['running','queued'].includes(row.state)&&completedModelStage(row,model));
 const rank=row=>(row.selection.scenario_id===target.selection.scenario_id?4:0)+
  (row.selection.grid_id===target.selection.grid_id?2:0)+
  (row.selection.profile_id===target.selection.profile_id?1:0);
 return rows.slice().sort((a,b)=>rank(b)-rank(a)||
  String(completedModelStage(b,model).completed_at).localeCompare(String(completedModelStage(a,model).completed_at))||
  a.id.localeCompare(b.id));
}
function canSelectCompletedModels(row){
 return ['prepared','failed'].includes(row?.state)&&nativeModels(row.selection).length===2&&
  ['ndr','sdr'].every(model=>completedModelSources(row,model).length);
}
function completedModelOrigins(row){
 if(!row.assembly?.models)return '';
 const rows=['ndr','sdr'].filter(model=>row.assembly.models[model]).map(model=>{
  const entry=row.assembly.models[model],stage=row.stages?.[model]||{};
  const source=entry.source_run_id||stage.reused_from?.run_id||row.id;
  const original=(state?.data?.runs||[]).find(value=>value.id===source);
  const selection=entry.source_selection||original?.selection;
  return '<tr><td>'+esc(model.toUpperCase())+'</td><td>'+esc(runTitle(source))+
   '<small class="mono">'+esc(short(source))+'</small></td><td>'+
   esc(selection?named('grids',selection.grid_id):'Retained original stage')+'</td><td>'+
   esc(selection?named('profiles',selection.profile_id):'Retained original stage')+
   '</td><td>'+number(entry.input_matches?.length||0)+' matched inputs</td><td>'+
   (original?itemButton('runs',source):'')+'</td></tr>';
 });
 return '<h3>Original completed models</h3><p class="note">This run retains the selected original model results and their matching input records.</p>'+
  table(['Model','Original run','Grid','Parameters','Inputs',''],rows);
}
async function completedModelsForm(id){
 const current=formOpening('run.start');
 let target;
 try{target=await api(endpoint('/api/item',{kind:'runs',id}));}
 catch(error){if(current())throw error;return;}
 if(!current())return;
 if(!['prepared','failed'].includes(target.state)||nativeModels(target.selection).length!==2)
  throw Error('Choose a prepared combined NDR and SDR run.');
 const candidates={ndr:completedModelSources(target,'ndr'),sdr:completedModelSources(target,'sdr')};
 if(!candidates.ndr.length||!candidates.sdr.length)
  throw Error('Complete the original NDR and SDR calculations before selecting their retained results.');
 const options=model=>candidates[model].map(row=>({id:row.id,
  title:runTitle(row.id)+' · '+named('grids',row.selection.grid_id)+' · '+short(row.id)}));
 detailDialog.close();
 openForm('Use completed models','Choose the original completed NDR and SDR calculations for this prepared combined run. The native operation checks their actual inputs, retains both results and completes the combined reporting outputs.',
 '<div class="form-grid"><div class="full">'+defs({combined_run:short(target.id),
  grid:named('grids',target.selection.grid_id),profile:named('profiles',target.selection.profile_id),
  scenario:named('scenarios',target.selection.scenario_id)})+'</div>'+
 field('Original completed NDR run',select('source_ndr',options('ndr'),candidates.ndr[0].id),
  'Nitrogen and phosphorus results.',true)+
 field('Original completed SDR run',select('source_sdr',options('sdr'),candidates.sdr[0].id),
  'Sediment results. A completed run containing both models can supply both selections.',true)+
 '<div id="completed-model-selection" class="full"></div>'+
 '<p class="note full">The original terrain, land cover, scenario changes, biophysical table and model parameters must match this combined run. The retained native operation checks the selected files and reports any input difference in the same task.</p></div>',
 'Use results and complete run',()=>{
  const source_runs={ndr:val('source_ndr'),sdr:val('source_sdr')};
  if(!['ndr','sdr'].every(model=>candidates[model].some(row=>row.id===source_runs[model])))
   throw Error('Choose the original completed source run for each model.');
  return submitAction('run.start',{run_id:target.id,source_runs});
 },()=>{
  const update=()=>{
   const rows=['ndr','sdr'].map(model=>{
    const row=candidates[model].find(item=>item.id===val('source_'+model));
    if(!row)return '';
    return '<tr><td>'+esc(model.toUpperCase())+'</td><td>'+esc(named('scenarios',row.selection.scenario_id))+
     '</td><td>'+esc(named('grids',row.selection.grid_id))+'</td><td>'+
     esc(named('profiles',row.selection.profile_id))+'</td><td>'+
     esc(when(completedModelStage(row,model)?.completed_at))+'</td></tr>';
   });
   $('#completed-model-selection').innerHTML=table(['Model','Scenario','Grid','Parameters','Completed'],rows);
  };
  form.elements.namedItem('source_ndr').addEventListener('change',update);
  form.elements.namedItem('source_sdr').addEventListener('change',update);update();
 });
}
function compareForm(selection={}){
 const complete=state.data.runs.filter(x=>x.state==='complete');
 if(complete.length<2)throw Error('Complete a baseline and at least one alternative on the same model grid.');
 openForm('Compare completed native runs','Choose runs on the same grid with at least one common native model. Signed differences retain the actual shared pollutants and exact run identities.',
 '<div class="form-grid">'+field('Baseline run',select('baseline',complete.map(x=>[x.id,runTitle(x.id)]),selection.baseline_run_id),'',true)+'<fieldset class="full"><legend>Alternatives on the same grid</legend><div id="compare-alternatives"></div></fieldset></div>','Compare original runs',
 ()=>{
  const other=chosen('alternatives');if(!other.length)throw Error('Select at least one completed alternative.');
  const ids=[val('baseline'),...other],runs=ids.map(id=>complete.find(x=>x.id===id));
  if(runs.some(x=>!x)||!['ndr','sdr'].some(model=>runs.every(x=>nativeModels(x.selection).includes(model))))throw Error('Choose a cohort sharing NDR, SDR, or both native models.');
  return submitAction('run.compare',{run_ids:ids});
 },
 ()=>{
  const update=()=>{
   const baseline=complete.find(x=>x.id===val('baseline'));
   $('#compare-alternatives').innerHTML=baseline?checks('alternatives',complete.filter(x=>x.id!==baseline.id&&x.selection.grid_id===baseline.selection.grid_id&&nativeModels(x.selection).some(model=>nativeModels(baseline.selection).includes(model))).map(x=>({id:x.id,title:runTitle(x.id)})),selection.run_ids||[]):'<p class="note">Choose the baseline first.</p>';
  };
  form.elements.namedItem('baseline').addEventListener('change',update);update();
 });
}
function columnControl(key,requiredField=false){
 return field(human(key),'<select name="column_'+esc(key)+'" '+(requiredField?'required':'')+'><option value="">Choose a CSV field…</option></select>',requiredField?'Required original column.':'Optional original column.');
}
function csvHeader(text){
 const result=[];let value='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){result.push(value);value='';}
  else if((c==='\n'||c==='\r')&&!quoted){result.push(value);return result;}
  else value+=c;
 }
 if(quoted)throw Error('The CSV header exceeds the preview window or contains an unfinished quoted field.');
 if(value||result.length)result.push(value);
 return result;
}
function parameterRow(from='',to='nitrogen'){
 return '<div class="repeat-row" data-parameter-row>'+field('Original parameter label',input('parameter_from','text',from,'required'))+field('Native annual-load parameter',select('parameter_to',[['nitrogen','Nitrogen'],['phosphorus','Phosphorus'],['sediment','Sediment']],to))+button('row-remove','Remove','','small')+'</div>';
}
function observationForm(){
 const keys=['record_id','station_id','catchment_id','parameter','value','unit','period_start','period_end','qualifier','method','uncertainty','source_records',...supportFields];
 openForm('Import original water-quality observations','Keep every original CSV row and its source provenance. The native comparison admits explicitly derived annual N/P/sediment mass rates; other measurements remain available as context.',
 '<div class="form-grid">'+field('Original observation CSV',input('observation_file','file','','required accept=".csv,text/csv"'),'The complete original file is retained.',true)+
  field('Prepared source-method JSON',input('observation_metadata','file','','accept=".json,application/json"'),'Optional. Loads the original source, annualization, column mapping and qualifier choices; its exact bytes stay with the edition.',true)+
 field('Observation title',input('title','text','','required'))+field('Original source URI',input('source_uri','url','','required'))+
 field('Physical measurement support',select('measurement_support',supportOptions,'other_context'),'Choose the original measurement quantity; per-row source columns can describe mixed editions.')+
 field('Measurement basis',select('basis',[['context','Original contextual measurements'],['annual_mass_rate','Derived annual mass-rate observations']],'context'))+
 field('Original annualization method',area('annualization_method'),'Required for derived annual loads; retain the source method, period and assumptions.',true)+
 field('Fallback period start',input('period_start','date'))+field('Fallback period end',input('period_end','date'),'Used when those period columns are absent.')+
 '<fieldset class="full"><legend>Original CSV columns</legend><p class="note" id="csv-header-note">Choose the original CSV to inspect its actual header.</p><div class="form-grid three">'+keys.map(k=>columnControl(k,['parameter','value','unit'].includes(k))).join('')+'</div></fieldset>'+
 '<fieldset class="full"><legend>Original parameter labels</legend><p class="note">The native names nitrogen, phosphorus and sediment already match. Map other exact source labels when they represent those same annual mass-rate parameters.</p><div id="parameter-rows"></div>'+button('parameter-add','Map an original label','','small')+'</fieldset>'+
 '<fieldset class="full"><legend>Accepted source qualifiers</legend><label class="check"><input name="blank_qualifier" type="checkbox" checked><span>Accept an empty source qualifier</span></label>'+field('Other accepted exact qualifiers',area('qualifiers'),'One original qualifier per line. Unselected qualifiers remain retained as context.',true)+'</fieldset></div>',
 'Retain original observations',async()=>{
  const context=formContext,selectedWorkspace=workspace;
  const csvControl=form.elements.namedItem('observation_file'),methodControl=form.elements.namedItem('observation_metadata');
  const file=csvControl.files[0],methodFile=methodControl.files[0],csvToken=context.observationCSVToken,methodToken=context.observationMetadataToken;
  const readMetadata=()=>{
   if(context.observationMetadataLoading)throw Error('The source-method document is still loading.');
   if(context.observationMetadataError)throw Error(context.observationMetadataError);
   if(context.observationCSVLoading)throw Error('The original CSV header is still loading.');
   if(context.observationCSVError)throw Error(context.observationCSVError);
   if(!file||context.observationCSVFile!==file)throw Error('Choose the original CSV and wait for its column mapping.');
   const columns={},parameter_mapping={};
   for(const key of keys)if(val('column_'+key))columns[key]=val('column_'+key);
   for(const node of $$('[data-parameter-row]',form)){
    const key=val('parameter_from',node).trim();if(Object.hasOwn(parameter_mapping,key))throw Error('An original parameter label is mapped twice.');parameter_mapping[key]=val('parameter_to',node);
   }
   const metadata={...(context.observationMetadata||{}),title:val('title'),source_uri:val('source_uri'),value_basis:val('basis'),measurement_support:val('measurement_support'),annualization_method:val('annualization_method'),columns,parameter_mapping,accepted_qualifiers:[...(form.elements.namedItem('blank_qualifier').checked?['']:[]),...lines(val('qualifiers'))]};
   if(val('period_start'))metadata.period_start=val('period_start');else delete metadata.period_start;if(val('period_end'))metadata.period_end=val('period_end');else delete metadata.period_end;
   if(context.observationMetadataFile)metadata.source_metadata_document=context.observationMetadataFile;
   if(metadata.value_basis==='annual_mass_rate'&&!metadata.annualization_method.trim())throw Error('Describe the original method that produced the annual mass-rate values.');
   return metadata;
  };
  const metadata=readMetadata(),selectedMetadata=JSON.stringify(metadata);
  const uploaded=await uploadFile(file);
  if(formContext!==context||workspace!==selectedWorkspace||csvControl.files[0]!==file||methodControl.files[0]!==methodFile||context.observationCSVToken!==csvToken||context.observationMetadataToken!==methodToken||JSON.stringify(readMetadata())!==selectedMetadata)throw Error('The observation selection changed during upload. Review the current CSV, source method and mapping, then import again.');
  return submitAction('observation.import',{upload_id:uploaded.id,metadata});
 },()=>{
  const syncContextColumns=()=>{const annual=val('basis')==='annual_mass_rate',constants=annual?{}:(formContext.observationMetadata?.constants||{});form.elements.namedItem('annualization_method').required=annual;for(const key of ['catchment_id','parameter','value','unit'])form.elements.namedItem('column_'+key).required=key==='catchment_id'?(annual&&val('measurement_support')==='catchment_export'):!Object.hasOwn(constants,key);};
  form.elements.namedItem('basis').addEventListener('change',syncContextColumns);
  form.elements.namedItem('measurement_support').addEventListener('change',syncContextColumns);syncContextColumns();
   form.elements.namedItem('observation_metadata').addEventListener('change',async()=>{
    const context=formContext,selectedWorkspace=workspace,control=form.elements.namedItem('observation_metadata'),file=control.files[0],token=crypto.randomUUID();context.observationMetadataToken=token;context.observationMetadataLoading=true;context.observationMetadataError=null;
    const current=()=>formContext===context&&workspace===selectedWorkspace&&context.observationMetadataToken===token&&control.files[0]===file;
    try{
     if(!file){context.observationMetadata=null;context.observationMetadataFile=null;return;}
     if(file.size>1024*1024)throw Error('Use a source-method JSON of at most 1 MiB; the original data CSV is selected separately.');
     const data=new Uint8Array(await file.arrayBuffer());if(!current())return;
     const value=JSON.parse(new TextDecoder().decode(data));
     if(!value||typeof value!=='object'||Array.isArray(value))throw Error('The source-method file must contain an observation metadata object.');
     for(const key of ['title','source_uri','annualization_method','period_start','period_end'])if(value[key]!==undefined){if(typeof value[key]!=='string')throw Error('Source metadata '+key+' must be text.');}
     if(value.measurement_support!==undefined&&!supportOptions.some(row=>row[0]===value.measurement_support))throw Error('Choose an original physical measurement support.');
     if(value.value_basis!==undefined){if(!['context','annual_mass_rate'].includes(value.value_basis))throw Error('The source method must declare context or annual_mass_rate.');}
     if(value.constants!==undefined&&(!value.constants||typeof value.constants!=='object'||Array.isArray(value.constants)||Object.values(value.constants).some(v=>typeof v!=='string')))throw Error('Context constants must be explicit source field values.');
     if(value.series_dimensions!==undefined&&(!Array.isArray(value.series_dimensions)||value.series_dimensions.some(v=>typeof v!=='string')))throw Error('Source series groups must name original CSV fields.');
     if(value.columns!==undefined&&(!value.columns||typeof value.columns!=='object'||Array.isArray(value.columns)||Object.values(value.columns).some(v=>typeof v!=='string')))throw Error('Original column mappings must use source field names.');
     if(value.parameter_mapping!==undefined&&(!value.parameter_mapping||typeof value.parameter_mapping!=='object'||Array.isArray(value.parameter_mapping)||Object.values(value.parameter_mapping).some(v=>!['nitrogen','phosphorus','sediment'].includes(v))))throw Error('Original parameter mappings must select nitrogen, phosphorus or sediment.');
     if(value.accepted_qualifiers!==undefined&&(!Array.isArray(value.accepted_qualifiers)||value.accepted_qualifiers.some(v=>typeof v!=='string')))throw Error('Accepted qualifiers must be exact source strings.');
     let binary='';for(let i=0;i<data.length;i+=16384)binary+=String.fromCharCode(...data.subarray(i,i+16384));
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(v=>v.toString(16).padStart(2,'0')).join('');
     if(!current())return;
     for(const key of ['title','source_uri','annualization_method','period_start','period_end'])if(value[key]!==undefined)form.elements.namedItem(key).value=value[key];
     if(value.value_basis!==undefined)form.elements.namedItem('basis').value=value.value_basis;
     form.elements.namedItem('measurement_support').value=value.measurement_support||(value.value_basis==='annual_mass_rate'?'catchment_export':'other_context');
     context.observationMetadata=value;context.observationMetadataFile={filename:file.name,bytes:data.length,sha256:hash,encoding:'base64',content:btoa(binary)};
     if(value.parameter_mapping)$('#parameter-rows').innerHTML=Object.entries(value.parameter_mapping).map(([from,to])=>parameterRow(from,to)).join('');
     if(value.accepted_qualifiers){form.elements.namedItem('blank_qualifier').checked=value.accepted_qualifiers.includes('');form.elements.namedItem('qualifiers').value=value.accepted_qualifiers.filter(Boolean).join('\n');}
     if(formContext.observationHeaders)for(const key of keys){const selected=value.columns?.[key]??key;setOptions(form.elements.namedItem('column_'+key),formContext.observationHeaders.map(x=>[x,x]),formContext.observationHeaders.includes(selected)?selected:'');}
     syncContextColumns();
     $('#form-error').hidden=true;
    }catch(error){if(current()){context.observationMetadata=null;context.observationMetadataFile=null;context.observationMetadataError=error.message;$('#form-error').textContent=error.message;$('#form-error').hidden=false;}}
    finally{if(current()){context.observationMetadataLoading=false;syncContextColumns();}}
   });
  form.elements.namedItem('observation_file').addEventListener('change',async()=>{
   const context=formContext,selectedWorkspace=workspace,control=form.elements.namedItem('observation_file'),file=control.files[0],token=crypto.randomUUID();
   context.observationCSVToken=token;context.observationCSVLoading=true;context.observationCSVError=null;context.observationCSVFile=null;context.observationHeaders=null;
   const current=()=>formContext===context&&workspace===selectedWorkspace&&context.observationCSVToken===token&&control.files[0]===file;
   for(const key of keys)setOptions(form.elements.namedItem('column_'+key),[]);
   $('#csv-header-note').textContent=file?'Reading the original CSV header…':'Choose the original CSV to inspect its actual header.';
   try{
    if(!file)return;
    const headers=csvHeader(await file.slice(0,256*1024).text());if(!current())return;
    if(!headers.length||new Set(headers).size!==headers.length)throw Error('The original CSV header is empty or repeats a column name.');
    context.observationHeaders=headers;context.observationCSVFile=file;
    for(const key of keys){const selected=context.observationMetadata?.columns?.[key]??key;setOptions(form.elements.namedItem('column_'+key),headers.map(x=>[x,x]),headers.includes(selected)?selected:'');}
    $('#csv-header-note').textContent=headers.length+' original CSV fields: '+headers.join(', ');syncContextColumns();
    $('#form-error').hidden=true;
   }catch(error){if(current()){context.observationCSVError=error.message;$('#form-error').textContent=error.message;$('#form-error').hidden=false;}}
   finally{if(current())context.observationCSVLoading=false;}
  });
 });
}
function observationCompareForm(id){
 requireSources();const complete=state.data.runs.filter(x=>x.state==='complete'),observations=state.data.observations.filter(x=>x.admitted_count>0);
 if(!complete.length||!observations.length)throw Error('Complete a native model run and import receiving-water annual catchment loads. Original outfall quantities and concentration records are available in the observation detail.');
 const collection=collectionDefault();
 openForm('Compare original annual loads','Aggregate the actual native model output over each full source catchment and preserve modeled-versus-observed residuals, coverage and excluded contextual records.',
 '<div class="form-grid">'+field('Completed native run',select('run',complete.map(x=>[x.id,runTitle(x.id)])))+
 field('Original observation edition',select('observation',observations.map(x=>[x.id,x.metadata.title]),id||''))+
 field('Catchment source edition',select('collection',sources(),collection))+
 field('Original catchment ID field',input('id_field','text','','required'),'Must match the catchment identifiers in the original observations.')+
 vectorSelection('catchments','Original catchment boundaries',collection)+
 '<div class="full">'+button('inspect-form-vector','Inspect native catchment fields','data-vector="catchments" data-collection="collection"','small')+'</div></div>',
 'Compare observed annual loads',()=>submitAction('observation.compare',{run_id:val('run'),observation_id:val('observation'),catchments:{source_collection_id:val('collection'),id_field:val('id_field'),...readVector('catchments')}}),
 ()=>bindCollection('collection',[['catchments_source','vector']]));
}
function deliverySource(name,label,choice={},requiredField=true,withFilters=false){
 const collection=choice.source_collection_id||collectionDefault(),source=choice.source_id||'';
 return '<fieldset class="full" data-delivery-source="'+esc(name)+'"><legend>'+esc(label)+'</legend>'+
 (!requiredField?'<label class="check"><input type="checkbox" name="'+esc(name)+'_enabled" '+(source?'checked':'')+'><span>Include this original source</span></label>':'')+
 '<div class="form-grid" data-source-fields>'+field('Source edition',select(name+'_collection',sources(),collection,requiredField))+
 field('Original source',select(name+'_source',sourceRows(collection,withFilters?'vector':null),source,requiredField))+
 (withFilters?field('Native layer name',input(name+'_layer','text',choice.layer||''),'Optional for a source with one layer.')+filterEditor(name,choice.where):'')+'</div></fieldset>';
}
function bindDeliverySource(name,requiredField,withFilters){
 const node=form.querySelector('[data-delivery-source="'+name+'"]'),collection=form.elements.namedItem(name+'_collection');
 collection.addEventListener('change',()=>setOptions(form.elements.namedItem(name+'_source'),sourceRows(collection.value,withFilters?'vector':null)));
 if(!requiredField){
  const update=()=>{const enabled=form.elements.namedItem(name+'_enabled').checked;for(const el of $$('[data-source-fields] input,[data-source-fields] select,[data-source-fields] textarea,[data-source-fields] button',node)){el.disabled=!enabled;if(el.name===name+'_collection'||el.name===name+'_source')el.required=enabled;}};
  form.elements.namedItem(name+'_enabled').addEventListener('change',update);update();
 }
}
function readDeliverySource(name,requiredField=true,withFilters=false,retained=null){
 if(!requiredField&&!form.elements.namedItem(name+'_enabled').checked)return null;
 const row={source_collection_id:val(name+'_collection'),source_id:val(name+'_source')};
 if(withFilters){const layer=val(name+'_layer').trim(),where=readFilter(name);if(layer)row.layer=layer;if(where)row.where=where;}
 if(!retained||row.source_collection_id!==retained.source_collection_id||row.source_id!==retained.source_id)return row;
 if(withFilters){
  const exact=value=>JSON.stringify(Object.entries(value||{}).sort(([a],[b])=>a.localeCompare(b)));
  if((row.layer||'')!==(retained.layer||'')||exact(row.where)!==exact(retained.where))return row;
 }
 return {...retained,...row};
}
function retainedDeliveryCohort(selection,baseline,alternatives){
 if(!selection?.source_scenario_analysis_id)return alternatives;
 const original=selection.scenario_run_ids||[];
 if(baseline!==selection.baseline_run_id||alternatives.length!==original.length||
    original.some(id=>!alternatives.includes(id))||new Set(alternatives).size!==alternatives.length)
  throw Error('Keep the attached analysis’s original baseline and alternatives. Start a separate delivery to choose another native cohort.');
 return [...original];
}
function formOpening(action){
 const request=++formOpeningRequest,ticket=admissionContext(action,null),interaction=interactionRevision;
 const context=formContext,formOpen=formDialog.open,detailOpen=detailDialog.open;
 const detailKind=detailContext?.kind,detailId=detailContext?.id;
 return ()=>request===formOpeningRequest&&currentAdmission(ticket,{details:false})&&interactionRevision===interaction&&
  detailContext?.kind===detailKind&&detailContext?.id===detailId&&
  formContext===context&&formDialog.open===formOpen&&detailDialog.open===detailOpen;
}
async function deliveryForm(id,initialSelection){
 requireSources();const current=formOpening('delivery.build');
 let saved;
 try{saved=id?await api(endpoint('/api/item',{kind:'deliveries',id})):null;}
 catch(error){if(current())throw error;return;}
 if(!current())return;
 const row=saved?.selection||initialSelection;
 const nativeStudy=row?.delivery_mode==='native_study',originalStudy=row?.native_study;
 if(row?.delivery_mode!==undefined&&!['regional_rfp','native_study'].includes(row.delivery_mode))throw Error('Open a regional or native-study delivery with its original mode.');
 if(nativeStudy&&(!originalStudy||['title','purpose'].some(key=>typeof originalStudy[key]!=='string'||!originalStudy[key].trim())||(originalStudy.reference!=null&&typeof originalStudy.reference!=='string')))throw Error('The native study must retain its original title, purpose and optional reference.');
 const complete=state.data.runs.filter(fullNativeRun);
 if(complete.length<2)throw Error('Complete both NDR and SDR for the original baseline and at least one alternative before assembling the complete scientific delivery.');
 const roles=[['PROTECTED_LANDS','Protected-lands source'],['PARCEL','Original parcel source'],['NHD','National Hydrography Dataset source'],['NWI','National Wetlands Inventory source']];
 const overlays=[['drinking_water','Critical drinking-water source boundaries',!nativeStudy],['high_quality_waters','Designated high-quality waters',!nativeStudy],['protected_lands','Protected-lands cartographic overlay',false],['parcels','Parcel priority inventory and GIS export',false]];
 const settings=row?.map_settings||{},weights=settings.weights||{};
 let observedReports;
 const attachedAnalysis=row?.source_scenario_analysis_id?{id:row.source_scenario_analysis_id,sha256:row.source_scenario_analysis_sha256,title:row.source_scenario_analysis_title||row.title||'Saved scenario analysis'}:null;
 openForm(saved?(nativeStudy?'Revise native-study delivery':'Revise complete map delivery'):(nativeStudy?'Build complete native-study delivery':'Build complete seven-map delivery'),nativeStudy?'Retain the original study context, completed native cohort and selected scientific sources. Supporting regional sources and overlays are optional; the complete study reports, maps and editable workspace follow the retained native study.':'Join the completed native baseline and alternatives with original water designations and supporting source data. The existing delivery engine writes the physical rasters, PDFs, report, metadata, parcel inventory when selected, and a restorable scientific workspace.',
 '<div class="form-grid">'+(nativeStudy?'<fieldset class="full"><legend>Original native study</legend><p><strong>'+esc(originalStudy.title)+'</strong></p><p>'+esc(originalStudy.purpose)+'</p>'+(originalStudy.reference?'<p class="note">Reference: '+esc(originalStudy.reference)+'</p>':'')+'<p class="note">This delivery keeps its original study context. Supporting regional source editions and overlays below are optional.</p></fieldset>':'')+(attachedAnalysis?'<fieldset class="full"><legend>Saved analysis attached</legend><p>'+esc(attachedAnalysis.title)+'</p><p class="note">Original analysis '+esc(attachedAnalysis.id)+'. The delivery retains its exact source areas, native cohort, settings and result files. Map settings below describe this delivery; the attached saved analysis preserves its original calculations.</p></fieldset>':'')+field('Delivery title',input('title','text',row?.title||'','required'),'',true)+
 field('Completed baseline run',select('baseline',complete.map(x=>[x.id,runTitle(x.id)]),row?.baseline_run_id),'',true)+
 '<fieldset class="full"><legend>Completed alternatives on the same grid</legend><div id="delivery-alternatives"></div></fieldset>'+
 receivingWaters.deliveryFields(row||{})+
 '<h3 class="subheading full">Actual supporting source editions</h3><p class="note full">The five modeled raster sources and computed LS factor come from the selected original run. Choose these additional original sources for the delivery lineage.</p>'+
 roles.map(([key,label])=>deliverySource('role_'+key,label,row?.source_roles?.[key],!nativeStudy)).join('')+
 '<div class="full" id="delivery-observed-reports"></div>'+
 '<h3 class="subheading full">Source-backed cartography and parcel priority</h3>'+
 overlays.map(([key,label,requiredField])=>deliverySource('overlay_'+key,label,row?.overlays?.[key],requiredField,true)).join('')+
 '<h3 class="subheading full">Combined export priority</h3><p class="note full">The original engine normalizes actual export values against each pollutant’s positive-cell 95th percentile unless an explicit cap is supplied. Weights are recorded in the retained delivery.</p>'+
 ['nitrogen_export','phosphorus_export','sediment_export'].map(key=>field(human(key)+' weight',input('weight_'+key,'number',weights[key]??1,'required min="0" step="any"'))).join('')+
 ['nitrogen_export','phosphorus_export','sediment_export'].map(key=>field(human(key)+' cap',input('cap_'+key,'number',settings.caps?.[key]??'','min="0" step="any"'),'Optional nonnegative cap in the actual export raster units; zero preserves an all-zero native reference.')).join('')+
 field('Map resolution',input('dpi','number',settings.dpi??200,'required min="72" max="600" step="1"'),'PDF rendering DPI; native analytical grids are unchanged.')+
 field('Map title',input('map_title','text',settings.title||''),'Optional title for the original map layouts.')+
 '<fieldset class="full"><legend>Retained observed-load comparisons</legend>'+checks('observation_comparisons',(state.data.observation_comparisons||[]).map(x=>({id:x.id,title:named('observations',x.observation_id)+' · '+runTitle(x.run_id)})),row?.observation_comparison_ids||[])+'</fieldset>'+
 '<fieldset class="full"><legend>Saved spatial review views</legend>'+checks('spatial_reviews',(state.data.spatial_reviews||[]).map(x=>({id:x.id,title:x.title})),row?.spatial_review_ids||[])+'<p class="note">Selected views carry their original sources, filters, markers, viewport and interpretation as working project assets.</p></fieldset>'+
 '<fieldset class="full"><legend>Printable map packs</legend>'+checks('spatial_exports',(state.data.spatial_exports||[]).filter(x=>x.state==='complete').map(x=>({id:x.id,title:x.title})),row?.spatial_export_ids||[])+'<p class="note">Include the retained PDF, vector and raster figures, annotations and complete map pack. Their original saved reviews are included with the delivery.</p></fieldset>'+
 '<h3 class="subheading full">Delivery contact and interpretation</h3>'+field('Contact name',input('contact_name','text',row?.contact?.name||'',nativeStudy?'':'required'))+
 field('Organization',input('contact_organization','text',row?.contact?.organization||'',nativeStudy?'':'required'))+field('Email',input('contact_email','email',row?.contact?.email||'',nativeStudy?'':'required'))+
 field('Delivery notes',area('notes',(row?.notes||[]).join('\n')),'One original interpretation or delivery note per line.',true)+'</div>',
 'Build complete original delivery',()=>{
  const alternatives=retainedDeliveryCohort(row,val('baseline'),chosen('alternatives'));if(!alternatives.length)throw Error('Select at least one completed alternative on the baseline grid.');
  const source_roles={...(row?.source_roles||{})},selectedOverlays={...(row?.overlays||{})},weights={},caps={};
  for(const [key]of roles){const choice=readDeliverySource('role_'+key,!nativeStudy,false,row?.source_roles?.[key]);if(choice)source_roles[key]=choice;else delete source_roles[key];}
  const observedReportSources=observedReports.selection();if(observedReportSources.length)source_roles.OBSERVED_CONTEXT=observedReportSources[0];else delete source_roles.OBSERVED_CONTEXT;
  for(const [key,,requiredField]of overlays){
   const x=readDeliverySource('overlay_'+key,requiredField,true,row?.overlays?.[key]);
   if(x)selectedOverlays[key]=x;else delete selectedOverlays[key];
  }
  for(const [key,role]of [['high_quality_waters','HIGH_QUALITY_WATERS'],['drinking_water','SOURCE_WATER_PROTECTION_AREAS'],['protected_lands','PROTECTED_LANDS_OVERLAY']]){
   if(selectedOverlays[key])source_roles[role]=selectedOverlays[key];else delete source_roles[role];
  }
  for(const key of ['nitrogen_export','phosphorus_export','sediment_export']){
   weights[key]=num('weight_'+key);const cap=num('cap_'+key,form,true);if(cap!==undefined){if(cap<0)throw Error('A priority cap must be nonnegative.');caps[key]=cap;}
  }
  if(Object.values(weights).every(x=>x===0))throw Error('At least one pollutant weight must be positive.');
  const map_settings={...(row?.map_settings||{}),weights,dpi:num('dpi')};delete map_settings.caps;delete map_settings.title;if(Object.keys(caps).length)map_settings.caps=caps;if(val('map_title').trim())map_settings.title=val('map_title').trim();
  const sourceBinding={...(nativeStudy?{delivery_mode:'native_study',native_study:{...originalStudy}}:(row?.delivery_mode?{delivery_mode:row.delivery_mode}:{})),...(row?.economic_edition_id?{economic_edition_id:row.economic_edition_id,...(row.economic_edition_sha256?{economic_edition_sha256:row.economic_edition_sha256}:{})}:{}),...(row?.source_report_id?{source_report_id:row.source_report_id,...(row.source_report_sha256?{source_report_sha256:row.source_report_sha256}:{})}:{}),...(attachedAnalysis?{source_scenario_analysis_id:attachedAnalysis.id,...(attachedAnalysis.sha256?{source_scenario_analysis_sha256:attachedAnalysis.sha256}:{})}:{})};
  return submitAction('delivery.build',{...sourceBinding,...receivingWaters.deliverySelection({baseline_run_id:val('baseline'),scenario_run_ids:alternatives},row||{}),title:val('title'),baseline_run_id:val('baseline'),scenario_run_ids:alternatives,source_roles,...(observedReportSources.length>1?{observed_context_sources:observedReportSources}:{}),overlays:selectedOverlays,map_settings,observation_comparison_ids:chosen('observation_comparisons'),spatial_review_ids:chosen('spatial_reviews'),spatial_export_ids:chosen('spatial_exports'),contact:{...JSON.parse(JSON.stringify(row?.contact||{})),name:val('contact_name'),organization:val('contact_organization'),email:val('contact_email')},notes:lines(val('notes'))});
 },()=>{
  observedReports=mountObservedReports($('#delivery-observed-reports'),state.data.sources,row||{});
  for(const [key]of roles)bindDeliverySource('role_'+key,!nativeStudy,false);
  for(const [key,,requiredField]of overlays)bindDeliverySource('overlay_'+key,requiredField,true);
  let initial=row?.scenario_run_ids||[];
  const update=()=>{
   const baseline=complete.find(x=>x.id===val('baseline'));
   $('#delivery-alternatives').innerHTML=baseline?checks('alternatives',complete.filter(x=>x.id!==baseline.id&&x.selection.grid_id===baseline.selection.grid_id).map(x=>({id:x.id,title:runTitle(x.id)})),initial):'<p class="note">Choose the original baseline first.</p>';initial=[];
   if(attachedAnalysis){form.elements.namedItem('baseline').disabled=true;for(const control of form.querySelectorAll('[name="alternatives"]'))control.disabled=true;}
  };
  form.elements.namedItem('baseline').addEventListener('change',update);update();
 });
}
function backupForm(){
 const savedJourney=operatingJourney?.capture?.()||null,journeyRevision=state.data.operator_session?.revision||null;
 openForm('Back up the original scientific workspace','Create an exact native archive containing the original project, source objects, selections, outputs and application. The same archive opens as a new receiving workspace.',
 '<div class="stack"><label class="check"><input type="checkbox" name="include_intermediates" checked><span>Include retained native model intermediates for continuation</span></label><p class="note">The completed archive includes the selected analysis and operating notes. Open its restored workspace to continue from the same view. Original run and source identities are preserved.</p></div>',
 'Create complete backup',()=>submitAction('workspace.backup',{include_intermediates:form.elements.namedItem('include_intermediates').checked,journey:savedJourney,journey_revision:journeyRevision}));
}
function restoreForm(){
 openForm('Restore an original workspace archive','Choose the exact native scientific-workspace ZIP. The original receiver verifies every member and creates a new directory with the same project identity.',
 field('Original scientific workspace ZIP',input('restore_file','file','','required accept=".zip"'),'The current workspace remains available in the workspace selector.',true),
 'Verify and restore original archive',async()=>{const upload=await uploadFile(form.elements.namedItem('restore_file').files[0]);return submitAction('workspace.restore',{upload_id:upload.id});});
}

async function inspectSource(collection,id,layer){
 const value=await api(endpoint('/api/source-info',{collection,source:id,...(layer?{layer}:{})}));
 const entry=value.source;
 let html='<div class="meta"><span>'+esc(entry.kind)+'</span><span>'+esc(entry.vintage)+'</span><span>'+esc(entry.units||'')+'</span></div><p>'+external(entry.uri)+'</p>';
 if(value.layers)html+='<div class="filters">'+field('Original native layer','<select id="source-layer">'+value.layers.map(x=>'<option value="'+esc(x)+'" '+(x===value.selected_layer?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select>')+'</div>'+
 defs({features:value.feature_count,geometry_type:value.geometry_type,coordinate_reference_system:value.crs,bounds:value.bounds})+'<h3 class="subheading">Original field schema</h3>'+table(['Field','Native type'],Object.entries(value.fields).map(([k,v])=>'<tr><td>'+esc(k)+'</td><td>'+esc(v)+'</td></tr>'));
 if(entry.kind==='raster')html+=defs({width:value.width,height:value.height,bands:value.count,coordinate_reference_system:value.crs,pixel_resolution:value.resolution,bounds:value.bounds,types:value.dtypes,nodata:value.nodata});
 if(value.sample){
  const columns=value.columns||Object.keys(value.sample[0]||{});
  html+='<h3 class="subheading">Original source preview</h3><p class="note">First '+value.sample.length+' retained rows. Download the original file for the complete source.</p>'+table(columns,value.sample.map(row=>'<tr>'+columns.map(k=>'<td>'+esc(typeof row[k]==='object'?JSON.stringify(row[k]):row[k])+'</td>').join('')+'</tr>'));
 }
 if(['raster','vector'].includes(entry.kind))html+='<div class="page-actions">'+button('spatial-item','Open in spatial review','data-kind="source-info" data-id="'+esc(id)+'" data-collection="'+esc(collection)+'"')+'</div>';
 html+='<h3 class="subheading">Exact original file</h3>'+fileList([value.download])+'<details class="technical"><summary>Retained metadata</summary><pre class="json-view">'+esc(pretty(value))+'</pre></details>';
 detail(entry.title,html,{kind:'source-info',id,collection});detailContext.files=[value.download];
 $('#source-layer')?.addEventListener('change',()=>inspectSource(collection,id,$('#source-layer').value).catch(globalError));
}
async function inspectFormVector(button){
 const name=button.dataset.vector,collection=val(button.dataset.collection);
 const id=val(name+'_source'),layer=val(name+'_layer').trim();
 if(!collection||!id)throw Error('Choose the source edition and original vector first.');
 return inspectSource(collection,id,layer||undefined);
}
async function showRunLog(id,append=false){
 if(!append){logOffset=0;detail('Original native model log','<p class="note">Retained output from the original selected NDR and SDR run.</p><pre id="native-log" class="logs"></pre>'+button('run-log-more','Read further log output','data-id="'+id+'"','small'),{kind:'run-log',id});}
 const value=await api(endpoint('/api/run-log',{id,offset:logOffset}));
 const text=value.text??value.content??'';
 $('#native-log').textContent+=text;
 logOffset=value.next_offset??value.offset??(logOffset+text.length);
 const b=$('[data-action="run-log-more"]',detailDialog);if(b)b.textContent=logOffset>=value.bytes?'Refresh retained log':'Read further log output';
}
function previewFile(id){
 const item=detailContext?.files?.find(x=>x.id===id);if(!item)throw Error('Reopen the retained item to obtain its current authenticated file link.');
 if(!item.filename.toLowerCase().endsWith('.pdf')){window.open(item.url+'?download=1','_blank','noopener');return;}
 detail(item.label||item.filename,'<div class="preview-options"><span>'+bytes(item.bytes)+' · <span class="mono">'+esc(short(item.sha256))+'</span></span><a class="button" href="'+esc(item.url)+'?download=1" download>Download original PDF</a></div><iframe class="preview-frame" title="'+esc(item.filename)+'" src="'+esc(item.url)+'"></iframe>',{kind:'file',id});detailContext.files=[item];
}
async function runtimeDialog(){
 const value=await api('/api/runtime');
 detail('Actual installed scientific runtime','<p class="note">Versions are read from this operator’s existing Python environment. Native run preparation verifies the selected original model installation.</p><pre class="json-view">'+esc(pretty(value))+'</pre>',{kind:'runtime'});
}
async function executeAction(action,payload){
 const ticket=admissionContext(action,crypto.randomUUID());
 const row=await api('/api/actions',{method:'POST',body:{workspace:ticket.workspace,action,payload,operation_id:ticket.operation_id}});
 return presentAcceptedTask(ticket,row);
}
async function navigate(next){
 if(!viewLabels[next]&&!extensions.hasView(next))return;
 navigationRevision++;
 view=next;operatingJourney?.updateRail(next);history.replaceState(null,'','#'+next);lastRendered='';render();$('#main').focus();
}
async function selectWorkspace(id){
 nativeJobs.detach();
 if(operatingJourney?.isBusy())throw Error('Wait for the current journey request before changing workspaces.');
 if(formDialog.open)throw Error('Finish or close the current draft before changing workspaces.');
 experiments.detach();
 programmes.detach();
 workspaceRevision++;
 workspaceFinder.reset();
 sourceReports.reset();
 rehearsal.detach();
 extensions.detach();
 spatialWorkspace.suspend();programmes.detach();community.detach();customerReviews.detach();experiments.detach();receivingWaters.detach();portfolio.detach();parameterStudies.detach();workspace=id;state=null;sessionStorage.setItem('upstate-selected-workspace',id);
 detailDialog.close();detailContext=null;lastRendered='';$('#content').innerHTML='<div class="empty"><h2>Opening selected workspace…</h2></div>';await refresh({force:true});
}
async function dispatch(button){
 interactionRevision++;
 const action=button.dataset.action,id=button.dataset.id;
 if(action?.startsWith('native-job-'))return nativeJobs.dispatch(button);
 if(await extensions.dispatch(button))return;
 if(action?.startsWith('delivery-inspection-'))return deliveryInspection.dispatch(button);
 if(action?.startsWith('parameter-study-'))return parameterStudies.dispatch(button);
 if(action?.startsWith('experiment-'))return experiments.dispatch(button);
 if(action?.startsWith('portfolio-'))return portfolio.dispatch(button);
 if(action?.startsWith('programme-'))return programmes.dispatch(button);
 if(action?.startsWith('community-'))return community.dispatch(button);
 if(action?.startsWith('review-'))return customerReviews.dispatch(button);
 if(action?.startsWith('water-'))return receivingWaters.dispatch(button);
 if(action==='task-open-retained')return openAcceptedTask(id,button.dataset.workspace);
 if(action==='refresh')return refresh({force:true});
 if(action==='tasks'||action==='tasks-close'){taskPanel=action==='tasks'?!taskPanel:false;$('#task-panel').hidden=!taskPanel;for(const b of $$('[data-action="tasks"]'))b.setAttribute('aria-expanded',String(taskPanel));return;}
 if(action==='form-close'){if(formContext?.busy)throw Error('The current request is being retained. Wait for its response before closing.');formDialog.close();formContext=null;return;}
 if(action==='detail-close'){detailDialog.close();detailContext=null;return;}
 if(action==='spatial-item'){
  const target={workspace,kind:button.dataset.kind,id,collection:button.dataset.collection,subject:button.dataset.subject,subject_kind:button.dataset.subjectKind,statistic:button.dataset.statistic,run:button.dataset.run,quantity:button.dataset.quantity};
  detailDialog.close();detailContext=null;await spatialWorkspace.openTarget(target);return navigate('spatial');
 }
 if(action==='item')return openItem(button.dataset.kind,id);
 if(action==='source-open')return sourceForm();
 if(action==='source-reports-open'){sourceReports.focus();return;}
 if(action==='source-inspect')return inspectSource(button.dataset.collection,button.dataset.source);
 if(action==='profile-new'||action==='profile-clone')return profileForm(id);
 if(action==='grid-new'||action==='grid-clone')return gridForm(id);
 if(action==='scenario-new'||action==='scenario-clone')return scenarioForm(id);
 if(action==='scenario-prepare-run'){detailDialog.close();detailContext=null;return runForm({scenario_id:id});}
 if(action==='run-prepare')return runForm();
 if(action==='run-input-preview')return executeAction('scenario.footprint.preview',{run_id:id});
 if(action==='run-input-footprint'){
  if(formDialog.open)throw Error('Finish or close the current draft before opening its retained footprint.');
  const selectedWorkspace=workspace,selectedRevision=workspaceRevision,selectedNavigation=navigationRevision,selectedDetail=detailContext;
  const current=()=>workspace===selectedWorkspace&&workspaceRevision===selectedRevision&&navigationRevision===selectedNavigation&&detailContext===selectedDetail&&!formDialog.open;
  try{
   const retained=await api(endpoint('/api/item',{kind:'runs',id}));
   if(!current())return;
   if(retained?.id!==id)throw Error('Open the retained run in its original workspace.');
   detailDialog.close();detailContext=null;
   return extensions.openExtension('scenario-footprint','openRun',id);
  }catch(error){if(current())throw error;}
 }
 if(action==='run-start')return openItem('runs',id);
 if(action==='run-start-confirmed')return executeAction('run.start',{run_id:id});
 if(action==='run-completed-models')return completedModelsForm(id);
 if(action==='run-compare')return compareForm();
 if(action==='run-compare-selection'){detailDialog.close();detailContext=null;return compareForm({baseline_run_id:id});}
 if(action==='comparison-delivery'){
  const current=formOpening('delivery.build');
  let comparison;
  try{comparison=await api(endpoint('/api/item',{kind:'comparisons',id}));}
  catch(error){if(current())throw error;return;}
  if(!current())return;
  detailDialog.close();detailContext=null;
  return deliveryForm(undefined,{baseline_run_id:comparison.baseline_run_id,scenario_run_ids:comparison.alternatives.map(x=>x.run_id)});
 }
 if(action==='run-log'||action==='run-log-more')return showRunLog(id,action==='run-log-more');
 if(action==='observation-new')return observationForm();
 if(action==='observation-compare')return observationCompareForm(id);
 if(action==='observation-comparison-csv')return downloadObservationComparison();
 if(action==='observation-diagnostics-json')return downloadObservationDiagnostics();
 if(['delivery-report','delivery-client-report','delivery-report-refresh','delivery-revise'].includes(action))return deliveryReview.handle(action,id);
 if(action==='delivery-new')return deliveryForm();
 if(action==='delivery-resume'){const row=await api(endpoint('/api/item',{kind:'deliveries',id}));return executeAction('delivery.build',row.selection);}
 if(action==='backup')return backupForm();
 if(action==='restore')return restoreForm();
 if(action==='preview-file')return previewFile(button.dataset.fileId);
 if(action==='task-open')return showTask(id);
 if(action==='task-resume'||action==='task-cancel'){await api('/api/task/'+(action==='task-resume'?'resume':'cancel'),{method:'POST',body:{id}});await refresh({force:true});return showTask(id);}
 if(action==='workspace-select')return selectWorkspace(id);
 if(action==='runtime')return runtimeDialog();
 if(action==='filter-add'){button.closest('[data-filter]').querySelector('[data-filter-rows]').insertAdjacentHTML('beforeend',filterRow());return;}
 if(action==='parameter-add'){$('#parameter-rows').insertAdjacentHTML('beforeend',parameterRow());return;}
 if(action==='patch-add'){const list=$('#patch-list');list.insertAdjacentHTML('beforeend',patchRow(val('collection')));updatePatchMask(list.lastElementChild,val('collection'),val('kind')==='landcover');return;}
 if(action==='row-remove'){button.closest('[data-filter-row],[data-parameter-row],[data-patch]').remove();return;}
 if(action==='inspect-form-vector')return inspectFormVector(button);
}
document.addEventListener('click',async event=>{
 const nav=event.target.closest('[data-view]');if(nav){event.preventDefault();try{clearError();await navigate(nav.dataset.view);}catch(error){globalError(error);}return;}
 const button=event.target.closest('[data-action]');if(!button)return;
 event.preventDefault();
 const interaction=admissionContext(button.dataset.action,null),context=formContext;
 try{clearError();await dispatch(button);}catch(error){
  if(currentAdmission(interaction,{details:false})){
   if(formDialog.open&&formContext===context){$('#form-error').textContent=error.message;$('#form-error').hidden=false;}
   else if(!formDialog.open)globalError(error);
  }
 }
});
form.addEventListener('submit',async event=>{
 event.preventDefault();if(!formContext||formContext.busy)return;
 if(!form.reportValidity())return;
 const current=formContext,epoch=connectionEpoch;current.busy=true;$('#form-submit').disabled=true;$('#form-error').hidden=true;$('#form-progress').textContent='Retaining the original selection…';
 try{await current.onSubmit();}
 catch(error){
  if(formContext===current&&workspace===current.workspace&&connectionEpoch===epoch){
   $('#form-error').textContent=error.message;$('#form-error').hidden=false;
   $('#form-progress').textContent=current.acceptedTask?
    'Operation retained. Open Tasks to inspect the saved operation.':
    'Draft retained in this form. Correct the selection or retry the same request.';
  }
 }
 finally{if(formContext===current){current.busy=false;$('#form-submit').disabled=false;}}
});
formDialog.addEventListener('cancel',event=>{if(formContext?.busy)event.preventDefault();else formContext=null;});
detailDialog.addEventListener('close',()=>{if(detailDialog.open||itemRequest!==detailRequest)return;itemRequest++;deliveryInspection.detach();detailContext=null;});
$('#workspace-select').addEventListener('change',event=>selectWorkspace(event.target.value).catch(globalError));
window.addEventListener('hashchange',()=>{const incoming=new URLSearchParams(location.hash.slice(1)).get('token');if(incoming){sessionStorage.setItem(keyName,incoming);sessionStorage.removeItem('upstate-selected-workspace');history.replaceState(null,'','/');location.reload();return;}const requested=location.hash.slice(1);if(viewLabels[requested]||extensions.hasView(requested))navigate(requested).catch(globalError);});
window.addEventListener('online',()=>refresh({force:true}));
function showConnection(message='Open your private access link or paste it below.'){
 connectionEpoch++;itemRequest++;
 nativeJobs.detach();rehearsal.detach();extensions.detach();spatialWorkspace.suspend();
 programmes.detach();community.detach();customerReviews.detach();experiments.detach();
 receivingWaters.detach();portfolio.detach();parameterStudies.detach();deliveryInspection.detach();
 capability=null;teamPerson=null;state=null;workspace=null;clearTimeout(poll);
 lastTaskStates.clear();acceptedTasks.clear();lastRendered='';refreshQueued=false;taskPanel=false;
 sessionStorage.removeItem(keyName);sessionStorage.removeItem('upstate-selected-workspace');
 if(formDialog.open)formDialog.close();if(detailDialog.open)detailDialog.close();formContext=null;detailContext=null;
 $('#task-panel').hidden=true;$('#task-list').replaceChildren();$('#task-count').textContent='0';
 $('#workspace-select').replaceChildren();$('#team-person').textContent='Disconnected';$('#team-manage').hidden=true;$('#team-sign-out').hidden=true;
 $('#connection-state').textContent='';
 $('#content').innerHTML='<div class="empty"><h1>Connect to the workbench</h1><p>'+esc(message)+'</p><form id="team-connect-form"><label for="team-access-link">Private access link</label><input id="team-access-link" type="password" required autocomplete="off"><button type="submit">Connect</button></form></div>';
 $('#team-connect-form').addEventListener('submit',event=>{
   event.preventDefault();const supplied=$('#team-access-link').value.trim();let selected;
   try{selected=new URL(supplied,location.origin).hash;selected=new URLSearchParams(selected.slice(1)).get('token');}catch{}
   if(!selected){globalError(Error('Paste the complete private access link supplied by your administrator.'));return;}
   sessionStorage.setItem(keyName,selected);location.replace('/');location.reload();
 });
}
$('#team-sign-out').addEventListener('click',async()=>{
 try{await api('/api/logout',{method:'POST',body:{}});}catch{}
 finally{showConnection('Signed out. Open a current private access link to reconnect.');}
});
if(capability){
 try{
  const session=await api('/api/session',{method:'POST',body:{}});teamPerson=session.person;
  if(!session.workspaces.some(row=>row.id===workspace))workspace=session.default_workspace;
  try{await extensions.load();const requested=location.hash.slice(1);if(extensions.hasView(requested))view=requested;}catch(error){toast('Additional desks: '+error.message);}
  await refresh({force:true});
 }catch(error){showConnection(error.message);}
}else showConnection();

