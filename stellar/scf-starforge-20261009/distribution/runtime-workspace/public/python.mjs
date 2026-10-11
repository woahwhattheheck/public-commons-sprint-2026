// MIT. Python receiving and original customer tools in the existing runtime workspace.
const make=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const label=(text,input)=>{const node=make('label',text);node.append(input);return node;};
const input=(placeholder='',type='text')=>{const node=make('input');node.type=type;node.placeholder=placeholder;return node;};
const details=(title,value)=>{const node=make('details');node.append(make('summary',title),make('pre',JSON.stringify(value,null,2)));return node;};
const idText=value=>value?value.slice(0,12)+'…':'—';
const size=value=>Number.isFinite(value)?new Intl.NumberFormat().format(value)+' bytes':'—';
function facts(rows){const node=make('dl',undefined,'paths');for(const[key,value]of rows){const row=make('div');row.append(make('dt',key),make('dd',String(value??'—')));node.append(row);}return node;}
function table(headers,rows){const wrap=make('div',undefined,'table-wrap'),table=make('table'),head=make('thead'),body=make('tbody'),tr=make('tr');headers.forEach(item=>tr.append(make('th',item)));head.append(tr);for(const cells of rows){const row=make('tr');for(const item of cells){const cell=make('td');cell.append(item instanceof Node?item:document.createTextNode(String(item??'—')));row.append(cell);}body.append(row);}table.append(head,body);wrap.append(table);return wrap;}
export function createPythonWorkspaceView({api,getState,operation,refreshWorkspace,openLog,switchView,message,error,upload}) {
  const root=document.getElementById('python-workspace');
  let current=null,review=null,runtimeId=null,loading=false,again=false,working=false,signature=null,commandInstallation=null;
  const state=()=>getState(), selected=()=>state()?.selected;
  const button=(text,callback)=>{const node=make('button',text);node.type='button';node.addEventListener('click',()=>act(callback));return node;};
  async function act(callback){if(working)return;working=true;message('');controls();try{await callback();}catch(value){error(value);}finally{working=false;controls();}}
  const title=make('div',undefined,'section-title');title.append(make('h2','Python and workbooks'));
  const reload=button('Refresh Python inventory',()=>refresh(true));title.append(reload);
  const intro=make('p','Install and reopen the original buyer, Analysis and workbook tools with a selected Python interpreter and retained source release.','muted');
  const sourceFacts=make('div'),selectionPanel=make('section',undefined,'panel');
  selectionPanel.append(make('h3','Select interpreter and original extras'));
  const python=input('/usr/bin/python3');python.autocomplete='off';python.value='/usr/bin/python3';
  const extrasBox=make('div',undefined,'checks'),workbooks=input('','checkbox'),agents=input('','checkbox');
  workbooks.checked=true;extrasBox.append(label('Workbook building · openpyxl 3.1.5',workbooks),label('Original agent workflows',agents));
  const reviewButton=button('Review source and interpreter',reviewSelection),resolveButton=button('Resolve and retain exact wheels',async()=>{
    if(!review)throw new Error('Review this interpreter and source first.');
    await submit({operation:'python-resolve',reviewId:review.reviewId});
  });
  const reviewActions=make('div',undefined,'actions');reviewActions.append(reviewButton,resolveButton);
  const reviewDisplay=make('div',undefined,'result');reviewDisplay.hidden=true;
  selectionPanel.append(label('Python executable on this host',python),extrasBox,
    make('p','Resolution records the actual source, build backend and exact dependency wheels. Installation then uses those retained wheels offline in its own environment.','note'),
    reviewActions,reviewDisplay);
  const candidatesPanel=make('section',undefined,'panel'),candidatesBody=make('div');
  candidatesPanel.append(make('h3','Retained wheel candidates'),candidatesBody);
  const installsPanel=make('section',undefined,'panel'),installsBody=make('div');
  installsPanel.append(make('h3','Installed customer environments'),installsBody);
  const commandPanel=make('section',undefined,'panel');commandPanel.hidden=true;
  const commandTitle=make('h3','Original customer commands'),commandInfo=make('div'),commandKind=make('select');
  for(const [value,text]of [['analysis','Analysis workspace'],['workbooks','Workbook build or receiving'],['workbookDelivery','Workbook delivery'],['stellar-forge-buyer','Original buyer CLI'],['stellar-forge-agent','Original agent workflow']])commandKind.append(new Option(text,value));
  const commandArgs=make('textarea');commandArgs.rows=5;commandArgs.spellcheck=false;commandArgs.value='[]';
  const commandDisplay=make('div',undefined,'result');commandDisplay.hidden=true;
  const commandReview=button('Prepare original command handoff',async()=>{
    if(!commandInstallation)throw new Error('Choose an installed environment.');
    let args;try{args=JSON.parse(commandArgs.value);}catch{throw new Error('Enter the original argument vector as a JSON array.');}
    const result=await api('/api/python/command',{runtimeId,installationId:commandInstallation,command:commandKind.value,args});
    commandDisplay.hidden=false;commandDisplay.replaceChildren(
      facts([['Interpreter',result.executable],['Working directory',result.cwd],['Source',result.runtime.sourceCommit],['Installation',result.installationId]]),
      make('pre',JSON.stringify({executable:result.executable,args:result.argv,cwd:result.cwd},null,2)),
      make('p','This exact descriptor is consumed by the existing Applications runner. Its original terminal, stop, reopening and customer approval controls own execution.','note'),
      details('Complete retained command descriptor',result));
    const copy=button('Copy command descriptor',()=>navigator.clipboard.writeText(JSON.stringify(result,null,2)));
    commandDisplay.append(copy);
  });
  commandPanel.append(commandTitle,commandInfo,label('Original tool',commandKind),label('Original arguments (JSON array)',commandArgs),commandReview,commandDisplay);
  commandKind.addEventListener('change',()=>{commandDisplay.hidden=true;setCommandExample();});
  const receivePanel=make('section',undefined,'panel');
  receivePanel.append(make('h3','Receive a Python wheel bundle'));
  const archiveFile=input('','file');archiveFile.accept='.zip,application/zip';
  const archivePath=input('/srv/starforge/transfers/python-CANDIDATE.zip'),archiveSha=input('Published complete SHA-256');
  archiveSha.maxLength=64;archiveSha.spellcheck=false;archivePath.autocomplete='off';
  const receive=button('Receive and verify bundle',async()=>{
    const sha256=archiveSha.value.trim();
    if(!/^[a-f0-9]{64}$/.test(sha256))throw new Error('Enter the bundle’s original complete SHA-256.');
    let archive=archivePath.value.trim();
    if(archiveFile.files[0]){
      const file=archiveFile.files[0];
      if(file.size>2*1024*1024*1024)throw new Error('The Python bundle exceeds 2 GiB.');
      message('Receiving the exact Python bundle…');
      const received=await upload(file,sha256);archive=received.archive;
    }
    if(!archive)throw new Error('Choose a bundle or enter its existing absolute path.');
    await submit({operation:'python-receive',archive,sha256,python:python.value.trim()});
  });
  receivePanel.append(label('Original bundle file',archiveFile),label('Or an existing file on this host',archivePath),
    label('Original bundle SHA-256',archiveSha),make('p','The receiver retains exact Python source and wheel bytes, then installs the candidate into this runtime using the selected interpreter. The original merchant source release and profile stay bound to that candidate.','note'),receive);
  const operationPanel=make('section',undefined,'panel'),operationsBody=make('div');
  operationPanel.append(make('h3','Python operations and recovery'),operationsBody);
  root.replaceChildren(title,intro,sourceFacts,selectionPanel,candidatesPanel,installsPanel,commandPanel,receivePanel,operationPanel);
  function extras(){return[...(agents.checked?['agents']:[]),...(workbooks.checked?['workbooks']:[])].sort();}
  function selectedReview(){return review && review.python===python.value.trim() && JSON.stringify(review.extras)===JSON.stringify(extras()) && review.binding.runtimeId===runtimeId;}
  function invalidate(){review=null;reviewDisplay.hidden=true;controls();}
  python.addEventListener('input',invalidate);workbooks.addEventListener('change',invalidate);agents.addEventListener('change',invalidate);
  function isBusy(){return working||current?.operations.some(item=>item.workerActive||item.phase==='QUEUED');}
  function controls(){
    const available=Boolean(runtimeId && selected()),busy=isBusy();
    reviewButton.disabled=!available||working;
    resolveButton.disabled=!available||busy||!selectedReview();
    receive.disabled=!available||busy||!python.value.trim();
    reload.disabled=!available||working;
    commandReview.disabled=!available||working||!commandInstallation;
    for(const node of root.querySelectorAll('[data-python-mutation]'))node.disabled=!available||busy;
    for(const node of root.querySelectorAll('[data-python-recovery]'))node.disabled=!available||working||Boolean(current?.operations.some(job=>job.id!==node.dataset.pythonRecovery&&(job.workerActive||job.phase==='QUEUED')));
  }
  async function reviewSelection(){
    const id=runtimeId,chosen=extras(),executable=python.value.trim();
    const value=await api('/api/python/review',{runtimeId:id,python:executable,extras:chosen});
    if(runtimeId!==id||python.value.trim()!==executable||JSON.stringify(extras())!==JSON.stringify(chosen))return;
    review=value;reviewDisplay.hidden=false;
    reviewDisplay.replaceChildren(facts([
      ['Original package',value.project.name+' '+value.project.version],['Source release',value.binding.sourceCommit],
      ['Selected executable',value.python],['Actual Python',value.interpreter.version.join('.')],
      ['Environment prefix',value.interpreter.prefix],['pip',value.interpreter.pip??'Not installed'],
      ['Selected extras',value.extras.join(', ')||'Base customer tools'],
      ['Build backend',value.project.build?.['build-backend']??'Original declared backend'],
    ]));
    const requirements=value.extras.flatMap(extra=>(value.project.extras[extra]??[]).map(requirement=>[extra,requirement]));
    if(requirements.length)reviewDisplay.append(table(['Extra','Original requirement'],requirements));
    reviewDisplay.append(details('Complete source and interpreter selection',value));
    controls();
  }
  async function submit(value){
    if(!runtimeId)throw new Error('Open an original merchant runtime first.');
    await operation({runtimeId,...value});await refreshWorkspace();await refresh();
  }
  function setCommandExample(){
    if(commandKind.value==='analysis' && current?.binding)
      commandArgs.value=JSON.stringify(['--database','/srv/starforge/customer/analysis','--checkout',current.binding.sourceRoot,'serve','--port','0'],null,2);
    else if(commandKind.value==='workbooks')commandArgs.value=JSON.stringify(['inspect','--delivery','/srv/starforge/customer/workbook','--manifest-sha256','RETAINED_MANIFEST_SHA256'],null,2);
    else if(commandKind.value==='workbookDelivery')commandArgs.value=JSON.stringify(['--database','/srv/starforge/customer/analysis','--recipe','/srv/starforge/customer/recipe.json','--operation','/srv/starforge/customer/delivery'],null,2);
    else commandArgs.value=JSON.stringify(['--help']);
  }
  function chooseInstallation(item){
    commandInstallation=item.id;commandPanel.hidden=false;commandDisplay.hidden=true;
    commandInfo.replaceChildren(facts([['Installation',item.id],['Interpreter',item.python],['Source',item.source?.releaseId],['Extras',item.extras?.join(', ')||'Base']]));
    setCommandExample();controls();commandPanel.scrollIntoView({block:'nearest'});
  }
  async function install(item){
    if(!selectedReview()||JSON.stringify(item.extras??[])!==JSON.stringify(review.extras)){
      workbooks.checked=(item.extras??[]).includes('workbooks');agents.checked=(item.extras??[]).includes('agents');
      await reviewSelection();
    }
    await submit({operation:'python-install',candidateId:item.id,reviewId:review.reviewId});
  }
  function render(){
    if(!current)return;
    sourceFacts.replaceChildren(facts([
      ['Merchant source',current.binding.sourceCommit],['Original archive',current.binding.archiveSha256],
      ['Runtime profile',current.binding.profileId],['Python source',current.project],
      ['Last retained Python observation',current.observedAt?new Date(current.observedAt).toLocaleString():'No Python operation yet'],
    ]));
    const candidates=current.candidates.map(item=>{
      const actions=make('div',undefined,'actions');
      const installButton=button('Install offline',()=>install(item));installButton.dataset.pythonMutation='true';
      const exportButton=button('Export wheel bundle',()=>submit({operation:'python-bundle',candidateId:item.id,python:python.value.trim()}));exportButton.dataset.pythonMutation='true';
      actions.append(installButton,exportButton,button('Inspect candidate',()=>submit({operation:'python-inspect',candidateId:item.id,python:python.value.trim()})));
      return[idText(item.id),item.source?.version??'—',(item.extras??[]).join(', ')||'Base',size(item.wheelBytes),idText(item.lockSha256),actions];
    });
    candidatesBody.replaceChildren(candidates.length?table(['Candidate','Package','Extras','Wheel bytes','Lock','Actions'],candidates):make('p','Review and resolve original wheels, or receive an existing Python bundle.','empty'));
    const installations=current.installations.map(item=>{
      const actions=make('div',undefined,'actions'),active=current.active?.installation===item.id;
      const activate=button(active?'Selected':'Select this environment',()=>submit({
        operation:'python-activate',installationId:item.id,expectedInstallationId:current.active?.installation??null,python:python.value.trim(),
      }));
      activate.dataset.pythonMutation='true';activate.disabled=active;if(active)delete activate.dataset.pythonMutation;
      actions.append(activate,button('Original commands',()=>chooseInstallation(item)),
        button('Inspect installed tools',()=>submit({operation:'python-inspect',installationId:item.id,python:python.value.trim()})));
      return[idText(item.id),item.python,(item.extras??[]).join(', ')||'Base',item.capabilities?.workbooks?'Ready':'Base tools',actions];
    });
    installsBody.replaceChildren(installations.length?table(['Installation','Exact interpreter','Extras','Workbook building','Actions'],installations):make('p','Installed environments appear here with their own interpreter and original source identity.','empty'));
    const expanded=new Set([...operationsBody.querySelectorAll('article')].filter(node=>node.querySelector('details')?.open).map(node=>node.dataset.id));
    operationsBody.replaceChildren();
    for(const item of current.operations){
      const row=make('article',undefined,'operation');row.dataset.id=item.id;
      const heading=make('div',undefined,'section-title');heading.append(make('h4',item.operation),make('span',item.displayPhase,'status'));
      row.append(heading,make('p',item.id+' · '+new Date(item.createdAt).toLocaleString(),'muted'));
      if(item.pythonStage)row.append(make('p','Stage: '+item.pythonStage));
      if(item.error)row.append(make('p',item.error.code+': '+item.error.message));
      const actions=make('div',undefined,'actions');
      actions.append(button('Open original worker log',()=>openLog({operationId:item.id})));
      if(['FAILED','INTERRUPTED','QUEUED'].includes(item.displayPhase)){
        const recover=button('Continue this operation',async()=>{await api('/api/python/recover',{operationId:item.id});await refreshWorkspace();await refresh();});
        recover.dataset.pythonRecovery=item.id;actions.append(recover);
      }
      if(item.operation==='python-bundle' && item.phase==='SUCCEEDED')actions.append(button('Download exact bundle',async()=>{
        const value=await api('/api/python/download',{operationId:item.id});const link=make('a','Download '+value.file);
        link.href=value.url;link.download=value.file;link.rel='noopener';row.append(link,make('p','SHA-256 '+value.sha256+' · '+size(value.bytes),'note'));link.click();
      }));
      row.append(actions);
      if(item.result){const detail=details('Original engine result',item.result);detail.open=expanded.has(item.id);row.append(detail);}
      operationsBody.append(row);
    }
    if(!current.operations.length)operationsBody.append(make('p','All Python work uses the original workspace operation history.','empty'));
    controls();
  }
  async function refresh(inspect=false){
    const id=selected()?.id;
    if(!id){runtimeId=null;current=null;sourceFacts.replaceChildren(make('p','Open an original merchant runtime from the sidebar.','empty'));controls();return;}
    if(id!==runtimeId){
      runtimeId=id;current=null;review=null;signature=null;commandInstallation=null;commandPanel.hidden=true;reviewDisplay.hidden=true;
    }
    if(inspect){await submit({operation:'python-inspect',python:python.value.trim()});return;}
    if(loading){again=true;return;}
    loading=true;
    try{
      const value=await api('/api/python/state?'+new URLSearchParams({runtimeId:id}));
      if(runtimeId!==id)return;
      current=value;if(!python.dataset.initialized){python.value=value.python??python.value;python.dataset.initialized='true';}
      const next=JSON.stringify(value);if(next!==signature){signature=next;render();}else controls();
    }finally{loading=false;if(again){again=false;await refresh();}}
  }
  return {refresh,reset(){current=null;review=null;runtimeId=null;signature=null;commandInstallation=null;delete python.dataset.initialized;commandPanel.hidden=true;reviewDisplay.hidden=true;},
    async choose(id){if(id!==selected()?.id)throw new Error('Select that original runtime from the sidebar first.');switchView('python');await refresh();}};
}
