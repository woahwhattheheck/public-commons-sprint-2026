// MIT. Runtime support in the original SF74 workspace; same-origin file APIs only.
import {encodeSource,parseWorkspace} from './workspace-file.mjs';

const SCHEMA='stellar-forge.merchant-runtime-case.v1';
const PACKET=['bundle.json','operator-brief.md','metrics.prom','manifest.json'];
const PERIOD=['history.json','report.json'];
const MAX_FILE=2_000_000,MAX_PERIOD=64*1024*1024,MAX_HANDOFF=224*1024*1024;
const add=(parent,tag,text,cls='')=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;parent.append(n);return n;};
const button=(parent,text,action,cls='secondary')=>{const b=add(parent,'button',text,cls);b.type='button';b.addEventListener('click',action);return b;};
const download=(text,name,type)=>{
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const slug=name=>String(name||'merchant-case').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,70);
const humanTime=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'medium'});
const bindingLabel=value=>({CURRENT_ROUTE:'Current saved route',HISTORICAL_ROUTE_VARIANT:'Earlier method or path',REMOVED_ROUTE:'Removed from current report'}[value]??value);
const coverageLabel=value=>({RECORDED:'Recorded',NOT_RECORDED:'Not recorded for this route',LEGACY_UNKNOWN:'Earlier export: route membership unavailable'}[value]??value);

export function mountRuntimeDesk({root,readInputs,onChange=()=>{},exportCase,importCase}) {
  let captures={before:null,after:null},review=null,busy=false,generation=0,selected=null,draft=false;
  let lastExport=null;
  const controller=new AbortController();
  root.id='runtime';root.className='card runtime-desk';
  const head=add(root,'div',undefined,'section-heading'),heading=add(head,'div');
  add(heading,'p','Merchant operations','eyebrow');add(heading,'h2','Runtime support');
  add(heading,'p','Attach an original seller packet or retained period, review repair and delivery outcomes, and keep the sources with this case.');
  add(head,'span','Original file intake','stage-hint');
  const status=add(root,'p','Select the four original packet files to begin. Importing files makes no seller request.','status');
  status.id='runtime-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const intake=add(root,'div',undefined,'runtime-intake');
  const grid=add(intake,'div',undefined,'form-grid');
  const sideLabel=add(grid,'label','Capture position'),side=add(sideLabel,'select');side.id='runtime-side';
  add(side,'option','Before / baseline').value='before';add(side,'option','After / follow-up').value='after';
  const kindLabel=add(grid,'label','Observation source'),kind=add(kindLabel,'select');kind.id='runtime-source-kind';
  add(kind,'option','One original seller session').value='session';
  add(kind,'option','Retained period across restarts').value='period';
  const packetLabel=add(grid,'label','Original support packet files');
  add(packetLabel,'small','Select bundle.json, operator-brief.md, metrics.prom and manifest.json together.');
  const packet=add(packetLabel,'input');packet.type='file';packet.multiple=true;packet.id='runtime-packet';
  const periodLabel=add(grid,'label','Original retained period files');periodLabel.hidden=true;
  add(periodLabel,'small','Select the original history.json and the SF97 report.json created from those exact bytes.');
  const period=add(periodLabel,'input');period.type='file';period.multiple=true;period.id='runtime-period';
  const advanced=add(intake,'details',undefined,'source-details');add(advanced,'summary','Optional native delivery records');
  const nativeHint=add(advanced,'p','Use the original SF97 report and both copied SF98 journals from this same seller session. The original reconciler keeps each report’s own observation window.');
  const nativeGrid=add(advanced,'div',undefined,'form-grid'),native={},nativeLabels={};
  for(const [key,label] of [['report.json','SF97 report.json'],['events.ndjson','SF98 events.ndjson'],['deliveries.ndjson','SF98 deliveries.ndjson']]) {
    const wrap=add(nativeGrid,'label',label),input=add(wrap,'input');input.type='file';
    input.id='runtime-'+key.split('.')[0];native[key]=input;nativeLabels[key]=wrap;
  }
  const actions=add(intake,'div',undefined,'actions');
  const inspect=button(actions,'Inspect selected files',()=>inspectFiles(),'');inspect.id='runtime-inspect';
  const clearDraft=button(actions,'Clear selected files',()=>resetDraft());
  const limitHint=add(actions,'span','Maximum 2 MB per packet file. Original file bytes are retained.','hint');
  const mapping=add(intake,'div',undefined,'runtime-mapping');mapping.hidden=true;
  const mappingInfo=add(mapping,'p','','hint');
  const routeLabel=add(mapping,'label','Map this capture to the current case route'),route=add(routeLabel,'select');route.id='runtime-route';
  const attach=button(mapping,'Attach to case',()=>attachFiles(),'');attach.id='runtime-attach';
  const loaded=add(root,'div',undefined,'runtime-captures');
  const reportActions=add(root,'div',undefined,'actions');
  const refresh=button(reportActions,'Review attached captures',()=>refreshReview());refresh.id='runtime-review';
  const exportButton=button(reportActions,'Prepare support handoff',()=>prepareExport());exportButton.id='runtime-export';
  const handoffDownloads=add(root,'div',undefined,'actions runtime-downloads');handoffDownloads.hidden=true;
  button(handoffDownloads,'Download readable support report',()=>lastExport&&download(lastExport.html,slug(lastExport.name)+'-runtime-support.html','text/html'));
  button(handoffDownloads,'Download complete support handoff',()=>lastExport&&download(lastExport.handoff,slug(lastExport.name)+'.merchant-support.json','application/json'));
  const transfer=add(root,'details',undefined,'source-details');add(transfer,'summary','Open a complete support handoff');
  const importLabel=add(transfer,'label','Previously exported .merchant-support.json'),importFile=add(importLabel,'input');importFile.type='file';importFile.accept='.json,application/json';importFile.id='runtime-handoff';
  add(transfer,'p','Opens as a new case draft with the original captures, runtime files, notes and follow-up details. Saved cases are retained.');
  const importButton=button(transfer,'Open handoff as new case',()=>openHandoff());importButton.id='runtime-import';
  const result=add(root,'div');result.id='runtime-result';

  function say(message,error=false){status.textContent=message;status.className=error?'status error':'status';}
  function invalidate(){review=null;lastExport=null;handoffDownloads.hidden=true;}
  function changed(){generation++;draft=true;selected=null;mapping.hidden=true;invalidate();controls();onChange();}
  function controls(){
    inspect.disabled=busy||!(kind.value==='period'?period:packet).files.length;attach.disabled=busy||!selected||!route.value;
    clearDraft.disabled=busy&&!draft;refresh.disabled=busy||(!captures.before&&!captures.after);
    exportButton.disabled=busy||(!captures.before&&!captures.after);importButton.disabled=busy||!importFile.files.length;
    for(const n of loaded.querySelectorAll('button'))n.disabled=busy;
  }
  function resetDraft(){
    generation++;packet.value='';period.value='';for(const input of Object.values(native))input.value='';
    selected=null;draft=false;mapping.hidden=true;controls();
    say('Selected files cleared. Attached captures are unchanged.');
  }
  async function api(path,payload){
    const response=await fetch(path,{method:'POST',credentials:'omit',cache:'no-store',signal:controller.signal,
      headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const body=await response.json();
    if(!response.ok)throw new Error(body.detail||body.error||'Runtime support unavailable');
    return body;
  }
  async function readFile(file,name){
    const maximum=kind.value==='period'?MAX_PERIOD:MAX_FILE;
    if(!file||file.size>maximum)throw new Error(name+' exceeds the '+maximum.toLocaleString()+' byte source limit.');
    return encodeSource(new Uint8Array(await file.arrayBuffer()));
  }
  async function inspectFiles(){
    if(busy)return;busy=true;controls();const epoch=++generation;
    try{
      const isPeriod=kind.value==='period',required=isPeriod?PERIOD:PACKET;
      const chosen=[...(isPeriod?period:packet).files],names=chosen.map(f=>f.name);
      if(chosen.length!==required.length||new Set(names).size!==required.length||required.some(n=>!names.includes(n)))
        throw new Error(isPeriod?'Select original history.json and its matching SF97 report.json together.':'Select exactly the four original SF93 packet files together.');
      const pickedNative=Object.entries(native).filter(([name,input])=>input.files.length&&(!isPeriod||name!=='report.json')).map(([name,input])=>[name,input.files[0]]);
      if(isPeriod&&[...chosen,...pickedNative.map(([,file])=>file)].reduce((sum,file)=>sum+file.size,0)>MAX_PERIOD)
        throw new Error('This period exceeds 64 MiB of combined original sources. Export fewer retained days or one route.');
      const files=Object.fromEntries(await Promise.all([...chosen.map(f=>[f.name,f]),...pickedNative].map(async([name,file])=>[name,await readFile(file,name)])));
      const information=await api('/api/runtime/inspect',{files});
      if(epoch!==generation)return;
      selected={files,information};route.replaceChildren();
      add(route,'option','Choose an original runtime route').value='';
      const inputs=readInputs();
      for(const [index,row] of information.routes.entries()){
        const option=add(route,'option',row.id+' · '+row.method+(information.kind==='DURABLE_PERIOD'?' '+row.path+' · '+bindingLabel(row.binding):''));option.value=String(index);
        option.disabled=row.method!==inputs.method;
      }
      mappingInfo.textContent=(information.kind==='DURABLE_PERIOD'?
        information.range.from+' → '+information.range.to+' UTC · '+information.mode+' · '+information.sessionIds.length+' original sessions':
        humanTime(information.capturedAt)+' · '+information.mode+' · Session '+information.sessionId)+
        '. Current case: '+(inputs.resource||'resource not entered')+' · '+inputs.method+'.';
      mapping.hidden=false;draft=true;
      say(information.kind==='DURABLE_PERIOD'?'Original history bytes match the SF97 report and its retained coverage. Select the exact method/path and attach it to this case.':
        'Original packet files match their manifest. Select its route and attach to the current case.');
    }catch(error){if(epoch===generation){selected=null;mapping.hidden=true;say(error.message,true);}}
    finally{busy=false;controls();}
  }
  async function attachFiles(){
    if(busy||!selected)return;busy=true;controls();const epoch=++generation;
    const target=side.value,inputs=readInputs(),selection=selected,selectedRoute=selection.information.routes[Number(route.value)];
    try{
      const checked=await api('/api/runtime/inspect',{files:selection.files,inputs,routeId:selectedRoute.id,
        ...(selection.information.kind==='DURABLE_PERIOD'?{path:selectedRoute.path}:{})});
      if(epoch!==generation||JSON.stringify(inputs)!==JSON.stringify(readInputs()))
        throw new Error('Case inputs or files changed during attachment. Inspect and attach again.');
      captures={...captures,[target]:checked.capture};invalidate();onChange();
      resetDraft();renderCaptures();say((target==='before'?'Before':'After')+' capture attached. Save case to retain it across restarts.');
    }catch(error){if(epoch===generation)say(error.message,true);}
    finally{busy=false;controls();}
    await refreshReview();
  }
  function renderCaptures(){
    loaded.replaceChildren();
    for(const position of ['before','after']) {
      const capture=captures[position],box=add(loaded,'section',undefined,'runtime-capture');
      add(box,'h3',position==='before'?'Before / baseline':'After / follow-up');
      if(!capture){add(box,'p','No runtime capture attached.','hint');continue;}
      add(box,'p',capture.scope.routeId+' · '+capture.scope.inputs.method+(capture.scope.path?' '+capture.scope.path:''));
      if(capture.files['history.json'])add(box,'p','Retained period · exact original history and report','hint');
      add(box,'p',capture.scope.inputs.resource||'No external resource mapping recorded.','hint');
      add(box,'p',Object.keys(capture.files).length+' original files · '+Object.values(capture.files).reduce((sum,f)=>sum+f.bytes,0).toLocaleString()+' bytes','hint');
      const buttons=add(box,'div',undefined,'actions');
      button(buttons,'Remove '+position,()=>{
        if(busy)return;generation++;captures={...captures,[position]:null};invalidate();onChange();renderCaptures();renderReport();controls();
        say('Capture removed from this draft. Previously saved versions retain their files.');
      });
      const files=add(box,'details',undefined,'source-details');add(files,'summary','Download original files');
      for(const [name,file] of Object.entries(capture.files))button(files,name,()=>{
        const bytes=Uint8Array.from(atob(file.data),c=>c.charCodeAt(0));
        download(bytes,position+'-'+name,'application/octet-stream');
      },'text-button');
    }
  }
  function rawText(){return captures.before||captures.after?JSON.stringify({schema:SCHEMA,...captures})+'\n':null;}
  async function refreshReview(){
    if(busy||(!captures.before&&!captures.after))return;
    busy=true;controls();const epoch=generation,inputs=readInputs();
    try{
      const {report}=await api('/api/runtime/review',{supportText:rawText(),inputs});
      if(epoch!==generation||JSON.stringify(inputs)!==JSON.stringify(readInputs()))return;
      review=report;renderReport();say('Runtime review is current for these case inputs. The original capture files are unchanged.');
    }catch(error){if(epoch===generation)say(error.message,true);}
    finally{busy=false;controls();}
  }
  function table(parent,headers,rows){
    const wrap=add(parent,'div',undefined,'case-table-wrap'),table=add(wrap,'table',undefined,'case-table');
    const tr=add(add(table,'thead'),'tr');for(const h of headers)add(tr,'th',h).scope='col';
    const body=add(table,'tbody');for(const row of rows){const tr=add(body,'tr');for(const c of row)add(tr,'td',String(c??'—'));}
  }
  function renderPeriod(capture) {
    const p=capture.period;if(!p)return;
    add(result,'h3','Retained UTC selection');
    add(result,'p',p.range.from+' → '+p.range.to+' · Effective '+(p.range.effectiveFrom??'none')+' → '+(p.range.effectiveTo??'none')+
      ' · Exported '+humanTime(p.exportedAt),'hint');
    add(result,'p',capture.route.method+' '+capture.route.path+' · '+bindingLabel(capture.route.binding)+
      '. Saved days without this route are unavailable; starts and completions can belong to different requests.','hint');
    table(result,['UTC day','Started','Completed','Responses','2xx','402','5xx','Disconnected','P95 upper ms'],p.days.map(day=>[day.day,
      ...['started','completed','responses','success','challenge','serverError','disconnected','latencyP95UpperBoundMs'].map(key=>day.route?.[key]??null)]));
    const sessions=add(result,'details',undefined,'source-details');add(sessions,'summary','Original saved sessions and coverage');
    table(sessions,['Session','Mode / state','Saved interval','Selected-route coverage','Outstanding / errors'],p.sessions.map(session=>[
      session.sessionId,session.mode+' / '+session.state,session.startedAt+' → '+session.capturedAt,
      coverageLabel(session.selectedRouteCoverage)+(session.selectedRouteDays?.length?' · '+session.selectedRouteDays.join(', '):''),
      session.outstandingAtCheckpoint+' / '+session.observerErrors]));
    const variants=add(result,'details',undefined,'source-details');add(variants,'summary','Retained method and path variants');
    table(variants,['Method / path','Binding','Started','Completed','2xx','402','5xx'],p.variants.map(row=>[
      row.method+' '+row.path,bindingLabel(row.binding)+(row.hasSavedCoverage?'':' / no saved observations'),
      row.started,row.completed,row.success,row.challenge,row.serverError]));
    add(result,'p','Session gaps remain uncovered. Interrupted sessions end at their saved checkpoint. '+
      (p.coverageFormat?'The original export supplies exact session/day route membership.':'This earlier original export has coarser session/day coverage.'),'hint');
  }
  function renderNative(capture) {
    const n=capture.native,selected=row=>row.routeId===capture.scope.routeId&&row.method===capture.route.method;
    const options=n?n.options.filter(selected):capture.period?.paymentOptions??[];
    if(options.length) {
      const detail=add(result,'details',undefined,'source-details');add(detail,'summary','Current saved report payment options');
      add(detail,'p','Original option identities for '+(capture.period?.currentReportPath??capture.scope.routeId)+
        '. HTTP counts stay on their observed route. Full original terms and extra metadata are in report.json.');
      table(detail,['Option','Network','Atomic amount / timeout','Asset SHA-256','Recipient SHA-256','Extra'],options.map(option=>[
        option.optionIndex,option.network,option.amountAtomic+' / '+(option.maxTimeoutSeconds??'unknown')+'s',
        option.assetDigest,option.recipientDigest,option.hasExtra?'Present in original report':'None']));
    }
    if(!n){add(result,'p','No original native journals attached to this capture.','hint');return;}
    add(result,'h3','Original native delivery reconciliation');
    add(result,'p',humanTime(n.observedFrom)+' → '+humanTime(n.observedUntil)+' · '+
      (n.snapshotRelation==='EXACT_RETAINED_HISTORY'?'Exact retained history and original saved coverage':
        n.snapshotRelation==='SAME_SOURCE_SNAPSHOT'?'Same original snapshot':'Separate capture from the same runtime session'),'hint');
    const current=!capture.period||capture.route.binding==='CURRENT_ROUTE';
    if(current)table(result,['Matched notices','Inbox accepted','Pending','Exhausted'],n.routes.filter(selected).map(row=>[
      row.nativeSuccessEvents,row.acceptedByMerchantInbox,row.pendingDelivery,row.exhaustedDelivery]));
    else add(result,'p','The selected historical method/path has no current payment-option attribution. Event decisions retain the recorded route coverage.','hint');
    const detail=add(result,'details',undefined,'source-details');add(detail,'summary','Original option outcomes and native event decisions');
    table(detail,['Current option','Matched notices','Inbox accepted','Pending','Exhausted'],options.map(option=>[
      option.optionIndex,option.nativeSuccessEvents,option.acceptedByMerchantInbox,option.pendingDelivery,option.exhaustedDelivery]));
    table(detail,['Event / time','Terms decision','Option / delivery','Observed coverage'],n.events.filter(selected).map(event=>[
      event.eventId+' / '+event.at,event.termsMatch,(event.optionId??'Unassigned')+' / '+event.deliveryState,
      (event.coverageBasis??event.observationMatch)+' · '+(event.observedSessionIds??[]).join(', ')]));
    const pre=add(detail,'pre',JSON.stringify({options,events:n.events.filter(selected)},null,2));pre.tabIndex=0;
    if(n.excludedEvents) {
      const excluded=add(result,'details',undefined,'source-details');add(excluded,'summary','Original events outside this period coverage');
      table(excluded,['Event','Time','Reason'],n.excludedEvents.filter(selected).map(event=>[event.eventId,event.at,event.reason]));
    }
    add(result,'p','Merchant inbox acceptance records callback delivery. Customer fulfillment and independent chain reconciliation remain separate.','hint');
  }
  function renderReport(){
    result.replaceChildren();
    if(!review){if(captures.before||captures.after)add(result,'p','Review attached captures to show outcomes for the current case inputs.','hint');return;}
    add(result,'h3','Runtime comparison');add(result,'p',review.comparison.detail);
    const interval=review.comparison.interval;
    if(interval)table(result,['Starts','Completions','2xx','402','5xx','Disconnected'],[['started','completed','success','challenge','serverError','disconnected'].map(k=>interval[k])]);
    if(review.comparison.periods) {
      const p=review.comparison.periods;
      const rows=[['started','Started'],['completed','Completed'],['responses','HTTP responses'],['httpSuccessPercent','2xx share %'],
        ['httpChallengePercent','402 share %'],['httpServerErrorPercent','5xx share %'],['disconnectPercent','Disconnected share %']];
      table(result,['Observed measure','Before','After','Change in percentage points'],rows.map(([key,label])=>[
        label,p.before[key],p.after[key],p.percentagePointChange?.[key]??null]));
    }
    add(result,'h3','Operator review queue');
    if(review.queue.length){const ul=add(result,'ul');for(const q of review.queue)add(ul,'li',q.source+' · '+q.routeId+': '+q.action);}
    else add(result,'p','No additional repair action identified from the attached sources.');
    for(const position of ['before','after']) {
      const capture=review[position];if(!capture)continue;
      add(result,'h3',(position==='before'?'Before':'After')+' · '+capture.route.id);
      add(result,'p',humanTime(capture.startedAt)+' → '+humanTime(capture.capturedAt)+' · '+capture.mode,'hint');
      if(!capture.caseMatches)add(result,'p','Saved scope differs from this case’s current inputs.','status error');
      table(result,['Started','Completed',capture.period?'Responses':'In flight','2xx','402','5xx','Disconnected'],[
        ['started','completed',capture.period?'responses':'inFlight','success','challenge','serverError','disconnected'].map(k=>capture.route[k])]);
      renderPeriod(capture);renderNative(capture);
      const original=add(result,'details',undefined,'source-details');add(original,'summary','Original runtime alerts and source identities');
      const ul=add(original,'ul');for(const alert of capture.alerts)add(ul,'li',alert);
      table(original,['File','Bytes','SHA-256'],capture.files.map(f=>[f.name,f.bytes,f.sha256]));
    }
    add(result,'p',review.interpretation,'hint');
  }
  async function prepareExport(){
    if(busy)return;busy=true;controls();const epoch=generation;
    try{
      const supportText=getText(),snapshot=await exportCase();
      const data=await api('/api/runtime/export',{...snapshot,supportText});
      if(epoch!==generation)return;
      lastExport={...data,name:(await parseWorkspace(snapshot.workspaceText)).name};
      review=data.report;renderReport();handoffDownloads.hidden=false;
      say('Support handoff prepared from this draft. Review the readable report, then download the complete source handoff.');
    }catch(error){if(epoch===generation)say(error.message,true);}
    finally{busy=false;controls();}
  }
  async function openHandoff(){
    if(busy||!importFile.files.length)return;busy=true;controls();const epoch=++generation;
    try{
      const file=importFile.files[0];if(!file.size||file.size>MAX_HANDOFF)throw new Error('Support handoff must be at most 224 MiB.');
      const imported=await api('/api/runtime/import',{handoffText:await file.text()});
      const workspace=await parseWorkspace(imported.workspaceText);
      if(epoch!==generation)return;
      // Case desk owns the existing unsaved-draft transition and stable identity.
      busy=false;controls();
      if(await importCase(workspace,imported)){importFile.value='';say('Complete support handoff opened as a new case draft. Save case to retain it here.');}
    }catch(error){if(epoch===generation)say(error.message,true);}
    finally{busy=false;controls();}
  }
  function getText(){
    if(draft||selected)throw new Error('Attach or clear the selected runtime files before saving or exporting this case.');
    return rawText();
  }
  for(const field of [packet,period,...Object.values(native)])field.addEventListener('change',changed,{signal:controller.signal});
  kind.addEventListener('change',()=>{
    resetDraft();const isPeriod=kind.value==='period';packetLabel.hidden=isPeriod;periodLabel.hidden=!isPeriod;
    nativeLabels['report.json'].hidden=isPeriod;
    nativeHint.textContent=isPeriod?'Optionally attach both copied original SF98 journals. The report retains its actual saved session/day/route coverage; no outbox is inferred when files are absent.':
      'Use the original SF97 report and both copied SF98 journals from this same seller session. The original reconciler keeps each report’s own observation window.';
    limitHint.textContent=isPeriod?'Maximum 64 MiB of combined period sources. Original bytes and source hashes are retained.':'Maximum 2 MB per packet file. Original file bytes are retained.';
    controls();say(isPeriod?'Select original history.json and matching report.json. Existing case captures are unchanged.':'Select the four original packet files. Existing case captures are unchanged.');
  },{signal:controller.signal});
  side.addEventListener('change',()=>{generation++;controls();},{signal:controller.signal});
  route.addEventListener('change',()=>{generation++;controls();},{signal:controller.signal});
  importFile.addEventListener('change',()=>{generation++;controls();},{signal:controller.signal});
  renderCaptures();controls();
  return {
    getText,
    async prepare(text,inputs){return text===null?null:(await api('/api/runtime/review',{supportText:text,inputs})).report;},
    apply(text,report){
      generation++;const file=text===null?{before:null,after:null}:JSON.parse(text);
      captures={before:file.before,after:file.after};resetDraft();review=report;lastExport=null;
      handoffDownloads.hidden=true;renderCaptures();renderReport();controls();
    },
    inputsChanged(){generation++;invalidate();renderReport();controls();},
    destroy(){generation++;controller.abort();root.replaceChildren();},
  };
}
