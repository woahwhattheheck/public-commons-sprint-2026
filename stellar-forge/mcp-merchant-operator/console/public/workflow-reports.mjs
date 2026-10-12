// MIT. Frozen comparisons and receiving in the original workflow history page.
import { reportDuration, reportValue, reportFilename, reportChangeRows,
  workflowReportHtml, workflowReportStepsCsv, workflowReportChangesCsv } from './workflow-report-format.mjs';

const MAX_BYTES=128*1024*1024;
export function createWorkflowReports({state,$,node,text,pretty,when,tag,properties,action,busy,api,notice,
  context,current,getRun,getRuns,loadProfiles,openRun,openCall,mutationActive=()=>false}) {
  const own={runId:null,packet:null,preview:null,sequence:0,fileSequence:0,working:false,receiving:false,
    baselineOptions:'',stepId:null,profileId:state.profile?.id??null,session:state.sessionEpoch};
  const panel=node('section',undefined,'panel');panel.id='workflow-report-panel';
  const heading=node('div',undefined,'section-heading'),headingText=node('div');
  headingText.append(node('h2','Workflow report'),node('p','Compare saved runs, review native results and receive complete selected history.','hint'));
  const buildButton=node('button','Build report');buildButton.type='button';buildButton.id='workflow-report-build';
  heading.append(headingText,buildButton);
  const controls=node('div',undefined,'columns'),baselineLabel=node('label','Baseline run');
  const baselineSelect=node('select');baselineSelect.id='workflow-report-baseline';baselineLabel.append(baselineSelect);
  const filterLabel=node('label',undefined,'checkbox'),changedOnly=node('input');changedOnly.type='checkbox';changedOnly.id='workflow-report-changed-only';
  filterLabel.append(changedOnly,document.createTextNode(' Show changed steps only'));controls.append(baselineLabel,filterLabel);
  const hint=node('p','Open a workflow run above to create its report.','hint');hint.id='workflow-report-hint';hint.setAttribute('aria-live','polite');
  const content=node('div');content.id='workflow-report-content';content.hidden=true;
  const title=node('h3'),summary=node('div',undefined,'table-wrap'),changesSummary=node('p',undefined,'hint');
  const downloads=node('div',undefined,'actions');
  const jsonButton=node('button','Download report JSON'),htmlButton=node('button','Download HTML'),
    stepsButton=node('button','Download steps CSV'),changesButton=node('button','Download changes CSV');
  for(const button of [jsonButton,htmlButton,stepsButton,changesButton]){button.type='button';downloads.append(button);}
  const stepTable=node('div',undefined,'table-wrap'),stepDetail=node('section',undefined,'subsection'),contextChanges=node('section',undefined,'subsection');
  const identity=node('dl',undefined,'properties');
  content.append(title,summary,changesSummary,downloads,stepTable,stepDetail,contextChanges,identity);
  const receiving=node('section',undefined,'subsection');receiving.append(node('h3','Receive a report'));
  receiving.append(node('p','Choose a report JSON file to preview its selected runs, original owner and source records. Receiving merges them into their saved profile.','hint'));
  const fileLabel=node('label','Report JSON file'),file=node('input');file.type='file';file.accept='.json,application/json';file.id='workflow-report-file';fileLabel.append(file);
  const receiveActions=node('div',undefined,'actions'),reviewButton=node('button','Review selected file'),receiveButton=node('button','Receive reviewed report');
  reviewButton.type=receiveButton.type='button';reviewButton.id='workflow-report-review';receiveButton.id='workflow-report-receive';receiveButton.disabled=true;
  receiveActions.append(reviewButton,receiveButton);
  const receiveHint=node('p','Complete report files can be up to 128 MiB.','hint'),preview=node('dl',undefined,'properties');preview.hidden=true;
  receiving.append(fileLabel,receiveActions,receiveHint,preview);
  panel.append(heading,controls,hint,content,receiving);$('workflow-run-detail').after(panel);

  function reset() {
    own.runId=null;own.packet=null;own.preview=null;own.sequence++;own.fileSequence++;own.stepId=null;
    own.profileId=state.profile?.id??null;own.session=state.sessionEpoch;own.baselineOptions='';
    content.hidden=true;preview.hidden=true;baselineSelect.replaceChildren(new Option('No baseline',''));
    text(hint,'Open a workflow run above to create its report.');text(receiveHint,'Complete report files can be up to 128 MiB.');
    if(!state.token)file.value='';
    sync();
  }
  function invalidateReport() {
    own.sequence++;own.packet=null;own.stepId=null;content.hidden=true;
    text(hint,getRun()?'Build a report of the selected run and baseline.':'Open a workflow run above to create its report.');
  }
  function table(headers,rows) {
    const value=node('table'),head=node('thead'),header=node('tr'),body=node('tbody');
    for(const label of headers)header.append(node('th',label));head.append(header);
    for(const cells of rows){
      const row=node('tr');
      for(const cell of cells){const item=node('td');item.append(cell instanceof Node?cell:document.createTextNode(String(cell??'—')));row.append(item);}
      body.append(row);
    }
    value.append(head,body);return value;
  }
  function valueNode(slot) {
    const value=reportValue(slot),pre=node('pre',value.length<=3000?value:value.slice(0,3000)+'\n…');
    if(value.length<=3000)return pre;
    const detail=node('details'),summary=node('summary','Full value · '+value.length.toLocaleString()+' characters');
    detail.append(summary,pre);detail.addEventListener('toggle',()=>{if(detail.open)text(pre,value);},{once:true});return detail;
  }
  function differenceView(items,label='Changed JSON values') {
    const section=node('details'),summary=node('summary',label+' · '+items.length),body=node('div',undefined,'table-wrap');
    const page=node('p',undefined,'hint'),next=node('button','Show next 30 changes');next.type='button';
    let offset=0;
    function show(){
      const selected=items.slice(offset,offset+30);
      body.replaceChildren(table(['Field / JSON pointer','Change','Baseline','Current'],selected.map(row=>[
        (row.field?row.field+' ':'')+(row.pointer||'(root)'),row.kind,valueNode(row.before),valueNode(row.after)
      ])));
      text(page,items.length?'Showing '+(offset+1)+'–'+Math.min(offset+30,items.length)+' of '+items.length+' changes. Complete values are included in the report downloads.':'No changed values.');
      next.hidden=items.length<=30;text(next,offset+30>=items.length?'Return to first 30 changes':'Show next 30 changes');
    }
    action(next,()=>{offset=offset+30>=items.length?0:offset+30;show();});
    section.append(summary,page,body,next);
    section.addEventListener('toggle',()=>{if(section.open&&!body.childElementCount)show();});return section;
  }
  function callButton(label,id) {
    const button=node('button',label);button.type='button';button.disabled=!id;
    if(id)action(button,()=>openCall(id));return button;
  }
  function renderStep(id) {
    own.stepId=id;stepDetail.replaceChildren();
    const step=own.packet?.report.steps.find(row=>row.id===id);if(!step)return;
    const currentStep=step.current,baselineStep=step.baseline;
    stepDetail.append(node('h4',(currentStep??baselineStep).name+' · '+step.id));
    const detail=node('dl',undefined,'properties');
    properties(detail,[
      ['Comparison',step.change],['Changed fields',step.flags.join(', ')||'—'],
      ['Current native tool',currentStep?.tool??'—',true],['Baseline native tool',baselineStep?.tool??'—',true],
      ['Current saved contract SHA-256',currentStep?.toolSchemaSha256??'—',true],
      ['Baseline saved contract SHA-256',baselineStep?.toolSchemaSha256??'—',true],
      ['Current contract source',currentStep?.contractDefinitionAvailable?'Saved complete native definition':'Saved native contract fingerprint'],
      ['Baseline contract source',baselineStep?(baselineStep.contractDefinitionAvailable?'Saved complete native definition':'Saved native contract fingerprint'):'—'],
      ['Current outcome',currentStep?.outcome??'—'],['Baseline outcome',baselineStep?.outcome??'—'],
      ['Current resolution',currentStep?.resolutionNote||'—'],['Baseline resolution',baselineStep?.resolutionNote||'—']
    ]);
    stepDetail.append(detail);
    const buttons=node('div',undefined,'actions');
    for(const [label,value] of [['Current',currentStep],['Baseline',baselineStep]])if(value){
      buttons.append(callButton(label+' original request',value.callId));
      if(value.resolvedCallId)buttons.append(callButton(label+' recovery result',value.resolvedCallId));
    }
    stepDetail.append(buttons);
    const differences=Object.entries(step.differences).flatMap(([field,rows])=>rows.map(row=>({field,...row})));
    stepDetail.append(differenceView(differences,'Step changes'));
    for(const [label,value] of [['Current',currentStep],['Baseline',baselineStep]])if(value){
      if(value.error)stepDetail.append(node('p',label+': '+value.error.code+' — '+value.error.message));
      if(value.expectationResults.length){
        stepDetail.append(node('h4',label+' required result values'));
        const rows=value.expectationResults.map(item=>[
          item.condition.pointer||'(root)',item.status,pretty(Object.hasOwn(item.condition,'equals')?item.condition.equals:item.condition.oneOf),valueNode(item.actual)
        ]);
        const wrap=node('div',undefined,'table-wrap');wrap.append(table(['JSON pointer','Status','Required value / one of','Returned value'],rows));stepDetail.append(wrap);
      }
      if(value.recoveries.length){
        stepDetail.append(node('h4',label+' linked recovery attempts'));
        const rows=value.recoveries.map(item=>[item.id,item.outcome,item.selected?'Selected':'Retained',
          when(item.startedAt),reportDuration(item.durationMs),callButton('Open recovery',item.id)]);
        const wrap=node('div',undefined,'table-wrap');wrap.append(table(['Call','Outcome','Resolution','Started','Recorded duration','Request'],rows));stepDetail.append(wrap);
      }
    }
  }
  function renderSteps() {
    const report=own.packet?.report;if(!report)return;
    const rows=report.steps.filter(row=>!report.baseline||!changedOnly.checked||!['UNCHANGED','CURRENT'].includes(row.change));
    if(!rows.length){stepTable.replaceChildren(node('p','No changed steps in this comparison.','empty'));return;}
    stepTable.replaceChildren(table(['Step','Comparison','Baseline → current state','Baseline → current outcome','Call duration delta','Details'],
      rows.map(row=>{
        const name=(row.current??row.baseline).name,label=node('div');
        label.append(node('strong',name),node('p',row.id,'mono'));
        const button=node('button','Open comparison');button.type='button';action(button,()=>renderStep(row.id));
        return [label,row.change,(row.baseline?.state??'—')+' → '+(row.current?.state??'—'),
          (row.baseline?.outcome??'—')+' → '+(row.current?.outcome??'—'),reportDuration(row.effectiveCallDurationDeltaMs),button];
      })));
  }
  function render() {
    const packet=own.packet;if(!packet){content.hidden=true;return;}
    const report=packet.report,a=report.baseline,b=report.current;content.hidden=false;
    text(title,b.name+' · '+b.id+(a?' compared with '+a.id:''));
    summary.replaceChildren(table(['Measure','Baseline','Current'],[
      ['Run revision',a?.revision,b.revision],['Saved workflow edition',a?.workflowRevision,b.workflowRevision],
      ['State',a?.state,b.state],['Completed steps',a?a.completedSteps+' / '+a.stepCount:null,b.completedSteps+' / '+b.stepCount],
      ['Recovered steps',a?.recoveredSteps,b.recoveredSteps],['Native calls',a?.nativeCalls,b.nativeCalls],
      ['Pending native calls',a?.pendingNativeCalls,b.pendingNativeCalls],['Failed or native-error calls',a?.failedNativeCalls,b.failedNativeCalls],
      ['Recorded through',when(a?.recordedThrough),when(b.recordedThrough)],
      ['Recorded run interval',reportDuration(a?.recordedDurationMs),reportDuration(b.recordedDurationMs)],
      ['Completed native call durations',reportDuration(a?.recordedNativeDurationMs),reportDuration(b.recordedNativeDurationMs)]
    ]));
    text(changesSummary,report.changes?
      report.changes.changed+' changed · '+report.changes.added+' added · '+report.changes.removed+' removed · '+report.changes.unchanged+
      ' unchanged steps. Run interval delta: '+reportDuration(report.changes.recordedDurationDeltaMs)+'.':
      'This report contains the selected run, its complete native calls and saved workflow source.');
    changesSummary.append(node('span',' Timing uses retained timestamps. An unfinished run is measured through its last saved update; completed-call totals include linked recovery attempts.'));
    renderSteps();stepDetail.replaceChildren();
    if(own.stepId&&report.steps.some(row=>row.id===own.stepId))renderStep(own.stepId);
    contextChanges.replaceChildren(node('h4','Inputs and execution context'),
      differenceView([...report.inputs.map(row=>({field:'inputs',...row})),...report.context.map(row=>({field:'context',...row}))]));
    properties(identity,[
      ['Report SHA-256',packet.contentSha256,true],['Profile archive SHA-256',packet.archive.contentSha256,true],
      ['Source workspace',packet.archive.sourceWorkspaceId,true],['Current run owner',b.ownerWorkspaceId,true],
      ['Included source',report.source.runs+' runs · '+report.source.definitions+' editions · '+report.source.drafts+' draft revisions · '+report.source.calls+' native calls · '+report.source.recipeInstallations+' recipe installations']
    ]);
    sync();
  }
  async function build() {
    const run=getRun(),ctx=context();if(!run)throw new Error('Open a saved workflow run first.');
    const selection={runId:run.id,baselineRunId:baselineSelect.value||null},sequence=++own.sequence;
    own.working=true;sync();
    try{
      const query=new URLSearchParams({run:selection.runId});if(selection.baselineRunId)query.set('baseline',selection.baselineRunId);
      const response=await api('workflow-report?'+query,{epoch:ctx.session});
      if(!current(ctx)||sequence!==own.sequence||getRun()?.id!==selection.runId||baselineSelect.value!==(selection.baselineRunId??''))return;
      own.packet=response.packet;render();notice('Workflow report ready · revision '+response.packet.report.current.revision+'.');
    }finally{own.working=false;sync();}
  }
  function download(suffix,mime,make) {
    const packet=own.packet;if(!packet)throw new Error('Build the displayed workflow report first.');
    const contents=make(packet),blob=new Blob([contents],{type:mime}),url=URL.createObjectURL(blob),link=node('a');
    link.href=url;link.download=reportFilename(packet)+suffix;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    notice('Downloaded '+link.download+' · '+blob.size.toLocaleString()+' bytes · report SHA-256 '+packet.contentSha256+'.');
  }
  async function review() {
    const selected=file.files?.[0];if(!selected)throw new Error('Choose a workflow report JSON file.');
    if(selected.size>MAX_BYTES)throw new Error('Choose a complete report up to 128 MiB.');
    const ctx=context(),sequence=++own.fileSequence;own.preview=null;preview.hidden=true;own.working=true;sync();
    try{
      let packet;try{packet=JSON.parse(await selected.text());}catch(error){throw new Error('The selected file must contain complete report JSON: '+error.message);}
      if(!current(ctx)||sequence!==own.fileSequence)return;
      const reviewed=await api('workflow-report-review',{method:'POST',body:{packet},epoch:ctx.session});
      if(!current(ctx)||sequence!==own.fileSequence)return;
      own.preview={packet,reviewed,context:ctx};preview.hidden=false;
      const a=reviewed.report.baseline,b=reviewed.report.current;
      properties(preview,[
        ['Profile',reviewed.profile.name+' · '+reviewed.profile.id],['Current run',b.id+' · r'+b.revision+' · '+b.state],
        ['Baseline',a?a.id+' · r'+a.revision+' · '+a.state:'Single run report'],
        ['Original workspace',reviewed.sourceWorkspaceId,true],['Current run owner',b.ownerWorkspaceId,true],
        ['Receiving workspace',reviewed.currentWorkspaceId,true],
        ['Native calls',reviewed.report.source.calls],['Source draft revisions',reviewed.report.source.drafts],
        ['Report SHA-256',reviewed.contentSha256,true],['Original archive SHA-256',reviewed.archiveSha256,true]
      ]);
      text(receiveHint,'Reviewed '+selected.name+'. Receive to merge the complete selected history into this workspace and open the original run.');
    }finally{own.working=false;sync();}
  }
  async function receive() {
    const selected=own.preview;if(!selected||!current(selected.context))throw new Error('Review the selected file on this operator connection.');
    const ctx=selected.context;own.receiving=true;sync();
    try{
      const result=await api('workflow-report-receive',{method:'POST',body:{packet:selected.packet,
        expectedContentSha256:selected.reviewed.contentSha256},epoch:ctx.session});
      if(!current(ctx))return;
      await loadProfiles(result.profile.id);
      if(state.sessionEpoch!==ctx.session||state.profile?.id!==result.profile.id)return;
      await openRun(result.selection.runId);
      if(state.sessionEpoch!==ctx.session||state.profile?.id!==result.profile.id)return;
      baselineSelect.value=result.selection.baselineRunId??'';
      own.preview=null;preview.hidden=true;file.value='';
      await build();
      if(state.sessionEpoch===ctx.session&&state.profile?.id===result.profile.id)
        notice((result.reused?'The report history is already received.':'Received the selected workflow history.')+
          ' Opened '+result.run.id+' at retained revision '+result.run.revision+' · '+result.run.state+'.');
    }finally{own.receiving=false;sync();}
  }
  function sync() {
    const run=getRun();
    if(own.session!==state.sessionEpoch||own.profileId!==(state.profile?.id??null)){
      reset();return;
    }
    if(own.runId!==(run?.id??null)){
      own.runId=run?.id??null;own.baselineOptions='';invalidateReport();
    }
    const candidates=run?getRuns().filter(row=>row.workflowId===run.workflowId&&row.id!==run.id)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)):[];
    const options=JSON.stringify(candidates.map(row=>[row.id,row.revision,row.state]));
    if(options!==own.baselineOptions){
      const prior=baselineSelect.value,hadOptions=Boolean(own.baselineOptions);own.baselineOptions=options;
      baselineSelect.replaceChildren(new Option('No baseline',''),...candidates.map(row=>new Option(
        when(row.createdAt)+' · '+row.state+' · r'+row.workflowRevision+' · '+row.id,row.id)));
      if(candidates.some(row=>row.id===prior))baselineSelect.value=prior;
      else if(!hadOptions&&run)baselineSelect.value=candidates.find(row=>row.createdAt<run.createdAt)?.id??'';
    }
    const connected=Boolean(state.token&&state.host&&!state.host.console.closing),working=own.working||own.receiving;
    buildButton.disabled=!connected||!run||working;baselineSelect.disabled=!run||working;changedOnly.disabled=!own.packet?.report.baseline;
    reviewButton.disabled=!connected||!file.files?.length||working;file.disabled=working;
    receiveButton.disabled=!connected||!own.preview||working||mutationActive();
    for(const button of [jsonButton,htmlButton,stepsButton,changesButton])button.disabled=!own.packet;
    if(own.packet){
      const saved=own.packet.report,latest=getRuns().find(row=>row.id===saved.current.id),
        latestBaseline=saved.baseline?getRuns().find(row=>row.id===saved.baseline.id):null;
      const advanced=latest&&latest.revision!==saved.current.revision||
        latestBaseline&&latestBaseline.revision!==saved.baseline.revision;
      text(hint,'Displaying saved run revision '+saved.current.revision+
        (saved.baseline?' against baseline revision '+saved.baseline.revision:'')+
        '. Downloads use this exact report.'+(advanced?' The retained history has advanced; build again to compare the new revisions.':''));
    }
  }
  action(buildButton,build);baselineSelect.addEventListener('change',()=>{invalidateReport();sync();});
  changedOnly.addEventListener('change',renderSteps);
  action(jsonButton,()=>download('.json','application/json;charset=utf-8',packet=>JSON.stringify(packet)));
  action(htmlButton,()=>download('.html','text/html;charset=utf-8',workflowReportHtml));
  action(stepsButton,()=>download('-steps.csv','text/csv;charset=utf-8',workflowReportStepsCsv));
  action(changesButton,()=>download('-changes.csv','text/csv;charset=utf-8',workflowReportChangesCsv));
  file.addEventListener('change',()=>{
    own.fileSequence++;own.preview=null;preview.hidden=true;text(receiveHint,'Review the selected file to inspect its original workflow history.');sync();
  });
  action(reviewButton,review);action(receiveButton,receive);
  sync();
  return {reset,sync};
}
