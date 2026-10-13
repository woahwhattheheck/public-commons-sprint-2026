// MIT. Customer Pollar portal with original SDK custody and durable operation recovery.
import {createPollarBrowserBridge} from '/browser-bridge.mjs';
import {POLLAR_BROWSER_ACTIONS,validatePollarArguments,publicPollarArguments} from '/catalogue.mjs';
import {openPollarJournal,requestJSON,id,now,sha256,errorValue,pretty,parseObject,exampleValue,downloadResponse,downloadJSON} from '/journal.mjs';
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)],copy=value=>structuredClone(value);
const AUTH=new Set(['sdk.auth.login','sdk.auth.beginEmail','sdk.auth.sendCode','sdk.auth.verifyCode','sdk.auth.providerAction','sdk.auth.passkeyLogin','sdk.auth.passkeyCreate']);
const PUBLIC_READ=new Set(['sdk.auth.state','sdk.auth.refresh','sdk.network.read','sdk.application.read','sdk.wallet.adapters','sdk.auth.cancel']);
const TERMINAL=new Set(['COMPLETE','FAILED','CANCELED']);
let app,journal,bridge,sdkState,session=null,revision=0,verification=null,ready=false,selectedSDK=null,historyRows=[],historyPage=0,hostCursor=null,hostRows=[];
const localForOperation=new Map(),active=new Set();
function status(message,error=false){$('#status').textContent=message;$('#status').classList.toggle('error',error);}
function problem(error){status((error.code?error.code+': ':'')+error.message,true);}
async function perform(work){try{return await work();}catch(error){problem(error);return null;}finally{await renderPending().catch(()=>{});}}
function node(tag,text,attributes={}){const item=document.createElement(tag);if(text!==undefined)item.textContent=text;
 for(const [key,value]of Object.entries(attributes))key==='class'?item.className=value:item.setAttribute(key,value);return item;}
function button(label,work){const item=node('button',label,{type:'button'});item.onclick=()=>perform(work);return item;}
function row(...items){const item=node('div',undefined,{class:'row'});for(const child of items)if(child)item.append(child);return item;}
function table(target,values,columns){const root=typeof target==='string'?$(target):target;root.replaceChildren();
 if(!values.length){root.append(node('div','No records in this selection.',{class:'empty'}));return;}
 const wrap=node('div',undefined,{class:'table-wrap'}),grid=node('table'),head=node('thead'),hr=node('tr');
 for(const column of columns)hr.append(node('th',column.label));head.append(hr);grid.append(head);
 const body=node('tbody');for(const value of values){const tr=node('tr');for(const column of columns){const cell=node('td'),content=column.value(value);
  if(content instanceof Node)cell.append(content);else cell.textContent=content??'';tr.append(cell);}body.append(tr);}grid.append(body);wrap.append(grid);root.append(wrap);
}
function showTab(name){for(const panel of $$('[data-panel]'))panel.hidden=panel.dataset.panel!==name;
 for(const button of $$('[data-tab]'))button.setAttribute('aria-current',button.dataset.tab===name?'page':'false');journal?.view('tab',name).catch(problem);}
function hostHeaders(extra={}){return {'X-Pollar-Workspace-ID':app.workspaceId,...extra};}
function providerUser(){return sdkState?.scope?.userId??null;}
function authenticated(){return sdkState?.auth?.step==='authenticated'&&sdkState.auth.verified===true;}
async function refreshRevision(){
 const result=await requestJSON('/api/portal/bootstrap?application='+encodeURIComponent(app.applicationId)+'&version='+app.applicationVersion);
 if(result.application.workspaceId!==app.workspaceId)throw Object.assign(new Error('This address now serves a different partner workspace. Reopen the saved application link.'),{code:'WORKSPACE_IDENTITY_MISMATCH'});
 revision=result.application.revision;return revision;
}
async function ensureSession(){
 if(!bridge||!authenticated())return null;
 if(session&&session.userId===providerUser()&&session.applicationId===app.applicationId&&session.applicationVersion===app.applicationVersion&&session.expiresAt>Date.now()+30000)return session;
 if(verification)return verification;
 verification=(async()=>{
  const accessToken=await bridge.verificationToken();if(!accessToken)return null;
  const tokenSha256=await sha256(accessToken),identity={applicationId:app.applicationId,applicationVersion:app.applicationVersion,userId:providerUser(),tokenSha256};
  let original=await journal.view('verification');
  if(!original||JSON.stringify(original.identity)!==JSON.stringify(identity)){original={requestId:id(),identity,createdAt:now()};await journal.view('verification',original);}
  const result=await requestJSON('/api/portal/session',{method:'POST',headers:hostHeaders(),
   body:{requestId:original.requestId,applicationId:app.applicationId,applicationVersion:app.applicationVersion,accessToken}});
  session=result.session;revision=Math.max(revision,result.revision??0);
  await journal.view('session',{participantId:session.participantId,applicationId:session.applicationId,applicationVersion:session.applicationVersion,
   userId:session.userId,expiresAt:session.expiresAt});renderSession();return session;
 })();
 try{return await verification;}finally{verification=null;}
}
async function requireSession(){const selected=await ensureSession();if(!selected)throw Object.assign(new Error('Finish signing in to your wallet.'),{code:'PORTAL_SESSION_REQUIRED'});return selected;}
async function sendHost(record){
 return requestJSON('/api/portal/invoke',{method:'POST',headers:hostHeaders(),body:{method:record.method,args:record.args}});
}
async function applyHost(result,record){
 if(Number.isSafeInteger(result.revision))revision=Math.max(revision,result.revision);
 const metadata=record.metadata??{};
 if(metadata.sdkId){
  let saved=await journal.getSDK(metadata.sdkId);if(saved){
   if(result.operation){saved.hostOperationId=result.operation.id;saved.operationId=result.operation.id;if((saved.hostRevision??-1)<=(result.revision??0)){saved.hostState=result.operation.state;saved.hostRevision=result.revision??0;}
    saved.participantId=result.operation.participantId??saved.participantId;localForOperation.set(result.operation.id,saved.id);}
   if(metadata.step==='prepare'){saved.hostPrepared=true;if(!saved.checkpoint&&saved.phase!=='SDK_DISPATCH_BOUNDARY')saved.phase='HOST_PREPARED';}
   if(metadata.step==='start'){saved.hostAttemptId=result.attempt.id;if(!saved.checkpoint&&saved.phase!=='SDK_DISPATCH_BOUNDARY')saved.phase='HOST_STARTED';}
   if(metadata.step==='observed'&&result.operation){saved.hostPrepared=true;saved.hostAttemptId=result.operation.attemptIds.at(-1);
    saved.publishedSequence=Math.max(saved.publishedSequence??-1,metadata.sequence??-1);}
   if(metadata.step==='outcome')saved.publishedSequence=Math.max(saved.publishedSequence??-1,metadata.sequence??-1);
   await journal.saveSDK(saved);
  }
 }
 if(result.snapshot)status('Your complete activity snapshot was saved.');
 if(result.report)status('Your activity report is ready.');
 return result;
}
async function executeHost(record){
 try{return await journal.execute(record,sendHost,applyHost);}
 catch(error){
  if(error.code==='REVISION_CONFLICT'){
   await refreshRevision();const fixed=await journal.rebase(record,revision);return journal.execute(fixed,sendHost,applyHost);
  }throw error;
 }
}
async function hostWrite(method,args={},metadata={}){
 const requestId=args.requestId??id(),selected={...args,requestId,expectedRevision:args.expectedRevision??revision};
 const original=await journal.enqueue({requestId,method,args:selected,route:'/api/portal/invoke',metadata});
 return executeHost(original);
}
async function hostRead(method,args={}){
 await requireSession();const result=await requestJSON('/api/portal/invoke',{method:'POST',headers:hostHeaders(),body:{method,args}});
 if(Number.isSafeInteger(result.revision))revision=Math.max(revision,result.revision);return result;
}
async function findSDK(operationId){
 const local=localForOperation.get(operationId);if(local)return journal.getSDK(local);
 const records=await journal.sdkOperations(),selected=records.find(item=>item.operationId===operationId||item.id===operationId);
 if(selected)localForOperation.set(operationId,selected.id);return selected;
}
function safeOutcome(outcome){const selected=copy(outcome);delete selected.checkpoint;return selected;}
async function publishOutcome(saved){
 if(!saved.outcome)return saved;
 const sequence=saved.checkpoint?.sequence??0;if((saved.publishedSequence??-1)>=sequence)return saved;
 const retainedUser=saved.checkpoint?.scope?.userId??saved.checkpoint?.intentScope?.userId??null;
 const sameParticipant=session&&saved.participantId===session.participantId;
 const selected=session&&session.expiresAt>Date.now()&&(session.userId===providerUser()||sameParticipant&&(!providerUser()||providerUser()===session.userId))?session:await ensureSession();
 if(!selected)return saved;
 if(retainedUser&&retainedUser!==selected.userId)return saved;
 if(AUTH.has(saved.action)&&!retainedUser){
  const flow=saved.authFlowId?await journal.view('authFlow:'+saved.authFlowId):null;
  if(flow?.userId!==selected.userId)return saved;
 }
 saved.participantId??=selected.participantId;await journal.saveSDK(saved);
 if(saved.hostAttemptId){
  const requestId=saved.outcomeRequests?.[String(sequence)]??id();saved.outcomeRequests??={};saved.outcomeRequests[String(sequence)]=requestId;await journal.saveSDK(saved);
  await hostWrite('browser.outcome',{requestId,operationId:saved.operationId,attemptId:saved.hostAttemptId,outcome:saved.outcome},
   {sdkId:saved.id,step:'outcome',sequence});
 }else if(AUTH.has(saved.action)||saved.action.startsWith('sdk.auth.')){
  saved.observeRequestId??=id();await journal.saveSDK(saved);
  await hostWrite('browser.observed',{requestId:saved.observeRequestId,operationId:saved.operationId,action:saved.action,args:saved.publicArgs,
   applicationId:app.applicationId,participantId:selected.participantId,startedAt:saved.createdAt,outcome:saved.outcome},
   {sdkId:saved.id,step:'observed',sequence});
 }
 return journal.getSDK(saved.id);
}
async function onOutcome(outcome){
 let saved=await findSDK(outcome.operationId);
 if(!saved)throw Object.assign(new Error('The browser could not recover the saved wallet action.'),{code:'JOURNAL_OPERATION_REQUIRED'});
 const selected=safeOutcome(outcome);selected.checkpointSha256=await sha256(outcome.checkpoint);
 saved={...saved,checkpoint:copy(outcome.checkpoint),outcome:selected,state:outcome.state,phase:outcome.checkpoint.phase,
  providerIds:copy(outcome.providerIds),updatedAt:now()};
 saved=await journal.saveSDK(saved);
 if(saved.authFlowId&&outcome.scope?.userId){
  const flow=await journal.view('authFlow:'+saved.authFlowId);
  if(flow?.userId&&flow.userId!==outcome.scope.userId)throw Object.assign(new Error('This sign-in belongs to a different verified account.'),{code:'PORTAL_PARTICIPANT_MISMATCH'});
  await journal.view('authFlow:'+saved.authFlowId,{...flow,id:saved.authFlowId,userId:outcome.scope.userId,verifiedAt:now()});
 }
 renderOutcome(saved);
 await publishOutcome(saved);await renderPending();
}
async function onState(value){
 sdkState=copy(value);await journal.view('lastState',sdkState);renderState();
 if(ready&&authenticated())queueMicrotask(()=>ensureSession().catch(problem));
}
function canUsePublic(action){return AUTH.has(action)||PUBLIC_READ.has(action)||action==='sdk.auth.logout'||action==='sdk.auth.logoutEverywhere';}
async function prepareHost(saved){
 const selected=await requireSession();saved.participantId=selected.participantId;
 if(!saved.hostPrepared){
  saved.prepareRequestId??=id();await journal.saveSDK(saved);
  await hostWrite('operation.prepare',{requestId:saved.prepareRequestId,mode:'browser',applicationId:app.applicationId,
   action:saved.action,args:saved.publicArgs},{sdkId:saved.id,step:'prepare'});saved=await journal.getSDK(saved.id);
 }
 if(!saved.hostAttemptId){
  saved.startRequestId??=id();await journal.saveSDK(saved);
  await hostWrite('browser.start',{requestId:saved.startRequestId,operationId:saved.operationId},{sdkId:saved.id,step:'start'});saved=await journal.getSDK(saved.id);
 }
 return saved;
}
async function runAction(action,args={}){
 if(!ready)throw new Error('Wait for your wallet to open.');
 validatePollarArguments(action,args,{surface:'browser'});
 return journal.exclusive('sdk-dispatch',async()=>{
  const publicInput=publicPollarArguments(action,args),localId=id(),isAuth=AUTH.has(action),spec=POLLAR_BROWSER_ACTIONS.find(item=>item.action===action);
  let saved={id:localId,workspaceId:app.workspaceId,applicationId:app.applicationId,applicationVersion:app.applicationVersion,
   createdAt:now(),updatedAt:now(),operationId:localId,action,args:isAuth?copy(publicInput.args):copy(args),
   publicArgs:copy(publicInput.args),ephemeralFields:publicInput.redacted,mutates:spec.mutates,state:'PREPARED',phase:'LOCAL_PREPARED',
   participantId:null,providerIds:{},checkpoint:null,outcome:null,publishedSequence:-1,hostPrepared:false,hostAttemptId:null};
  if(isAuth){
   let flow=await journal.view('currentAuthFlow');
   if(!flow||spec.authFlow==='start'){flow={id:id(),createdAt:now(),userId:null};await journal.view('currentAuthFlow',flow);await journal.view('authFlow:'+flow.id,flow);}
   saved.authFlowId=flow.id;
  }
  saved=await journal.saveSDK(saved);localForOperation.set(saved.operationId,saved.id);active.add(saved.id);
  try{
   if(!canUsePublic(action)||authenticated()){
    const original=await ensureSession();
    if(original)saved=await prepareHost(saved);else if(!canUsePublic(action))await requireSession();
   }
   saved=await journal.getSDK(saved.id);localForOperation.set(saved.operationId,saved.id);
   saved.phase='SDK_DISPATCH_BOUNDARY';await journal.saveSDK(saved);
   const result=await bridge.invoke({action,args:copy(args),operationId:saved.operationId});
   saved=await journal.getSDK(saved.id);saved.lastNativeReturnAt=now();await journal.saveSDK(saved);
   if(action==='sdk.auth.logout'||action==='sdk.auth.logoutEverywhere'){
    await requestJSON('/api/portal/session',{method:'DELETE',headers:hostHeaders()});session=null;renderSession();
   }
   status(result.state==='COMPLETE'?'Wallet action completed.':result.state==='FAILED'?'The provider returned a failed outcome.':'Your request is saved. Check its status in Pending operations.',result.state==='FAILED');
   return result;
  }catch(error){
   const latest=await journal.getSDK(saved.id);latest.lastError=errorValue(error);
   if(!latest.checkpoint){latest.state=latest.phase==='LOCAL_PREPARED'?'FAILED':'UNCERTAIN';}
   await journal.saveSDK(latest);throw error;
  }finally{active.delete(saved.id);await renderPending();}
 });
}
async function resumeSDK(saved,{automatic=false}={}){
 saved=await journal.getSDK(saved.id);
 if(saved.applicationVersion!==app.applicationVersion)throw Object.assign(new Error('Open the saved application version to recover this action.'),{code:'APPLICATION_VERSION_REQUIRED'});
 if(saved.checkpoint?.scope?.userId&&saved.checkpoint.scope.userId!==providerUser())return;
 if(active.has(saved.id))return;
 return journal.exclusive('sdk-dispatch',async()=>{
  active.add(saved.id);
  try{
   if(saved.outcome)await publishOutcome(saved);
   saved=await journal.getSDK(saved.id);
   if(TERMINAL.has(saved.state))return saved.outcome;
   if(saved.checkpoint){
    const result=await bridge.reconcile({operation:{operationId:saved.operationId,action:saved.action,checkpoint:saved.checkpoint}});
    status('Payment or service status refreshed.');return result;
   }
   if(automatic)return null;
   if(saved.phase==='LOCAL_PREPARED'||saved.phase==='HOST_PREPARED'||saved.phase==='HOST_STARTED'){
    if(saved.ephemeralFields.length)throw new Error('Enter your current sign-in code or continue the provider step.');
    if(!canUsePublic(saved.action)||authenticated())saved=await prepareHost(saved);
    saved.phase='SDK_DISPATCH_BOUNDARY';await journal.saveSDK(saved);
    return bridge.invoke({operationId:saved.operationId,action:saved.action,args:copy(saved.args)});
   }
   throw Object.assign(new Error('The wallet request was sent but its reply was interrupted. Check transaction history and service status before starting it again.'),{code:'ORIGINAL_OUTCOME_REQUIRED'});
  }finally{active.delete(saved.id);await renderPending();}
 });
}
async function recover(){
 if(!ready)return;
 if(authenticated())await ensureSession();
 for(const request of await journal.requests()){
  if(request.state==='COMPLETE'){await applyHost(request.result,request);continue;}
  if(!session||!['READY','SENDING','UNCERTAIN','REVISION_CONFLICT'].includes(request.state))continue;
  try{if(request.state==='REVISION_CONFLICT'){await refreshRevision();await executeHost(await journal.rebase(request,revision));}else await executeHost(request);}
  catch(error){problem(error);if(['PORTAL_SESSION_REQUIRED','WORKSPACE_IDENTITY_MISMATCH'].includes(error.code))break;}
 }
 for(const saved of await journal.sdkOperations()){
  localForOperation.set(saved.operationId,saved.id);if(saved.applicationVersion!==app.applicationVersion)continue;
  try{if(saved.outcome)await publishOutcome(saved);if(saved.checkpoint&&!TERMINAL.has(saved.state))await resumeSDK(saved,{automatic:true});}
  catch(error){problem(error);}
 }
 await renderPending();
}
function renderSession(){
 const auth=sdkState?.auth??{step:'idle'},identity=providerUser();$('#customer-identity').textContent=authenticated()?(sdkState?.profile?.name??sdkState?.profile?.email??'Signed in'):'Signed out';
 $('#session-summary').replaceChildren(node('p',authenticated()?'Your wallet session is verified.':'Sign in to view and save your activity.'),
  node('p',session&&session.userId===identity?'Partner session verified until '+new Date(session.expiresAt).toLocaleString()+'.':'Partner session verification follows successful sign-in.'));
 $('#auth-progress').textContent=auth.message??auth.step.replace(/_/g,' ');
 $('#email-form').hidden=auth.step!=='entering_email'&&auth.step!=='sending_email';
 $('#code-form').hidden=!['entering_code','verifying_email_code'].includes(auth.step);
 if(auth.email)$('#email-form').elements.email.value=auth.email;
 const records=sdkState?.sessions?.data??sdkState?.sessions?.sessions??[];
 const sessions=Array.isArray(records)?records:Array.isArray(records.sessions)?records.sessions:[];
 table('#sessions-table',sessions,[{label:'Device / family',value:item=>item.deviceLabel??item.familyId??item.id},{label:'Created',value:item=>item.createdAt??''},
  {label:'Action',value:item=>item.familyId?button('Revoke this session',()=>runAction('sdk.session.revoke',{familyId:item.familyId})):''}]);
}
function wallets(){
 const items=Array.isArray(sdkState?.wallets)?[...sdkState.wallets]:[];if(!items.length&&sdkState?.wallet)items.push(sdkState.wallet);
 return items.filter(item=>item&&typeof item==='object');
}
function renderWallets(){
 const values=wallets(),selected=$('#receive-wallet').value;$('#receive-wallet').replaceChildren();
 for(const wallet of values)$('#receive-wallet').append(node('option',(wallet.chain??'STELLAR')+' · '+wallet.type+' · '+(wallet.address??'Not created'),{value:JSON.stringify([wallet.chain??'STELLAR',wallet.address])}));
 if([...$('#receive-wallet').options].some(item=>item.value===selected))$('#receive-wallet').value=selected;
 renderAddress();
 const wallet=sdkState?.wallet;$('#provisioning').textContent=wallet?((wallet.provisioning??(wallet.existsOnStellar?'READY':'NONE'))+
  (wallet.fundingMode?' · '+wallet.fundingMode:'')+(wallet.address?'':' · Create the application wallet when you are ready.')):'Sign in to see your wallet.';
 const balances=sdkState?.balance?.data?.balances??[];
 table('#balances-table',balances,[{label:'Asset',value:item=>item.code},{label:'Chain',value:item=>item.chain??'STELLAR'},
  {label:'Balance',value:item=>item.balance??'Unavailable'},{label:'Available',value:item=>item.available??'Unavailable'},
  {label:'Issuer / mint',value:item=>item.issuer??'Native'}]);
 const assets=sdkState?.assets?.data?.assets??[];
 table('#assets-table',assets,[{label:'Asset',value:item=>item.name??item.code},{label:'Chain',value:item=>item.chain??'STELLAR'},
  {label:'Trustline',value:item=>item.trustlineEstablished===undefined?'—':item.trustlineEstablished?'Established':'Not established'},
  {label:'Action',value:item=>(item.chain??'STELLAR')==='STELLAR'&&item.issuer?button(item.trustlineEstablished?'Manage trustline':'Add trustline',
   ()=>selectAction('sdk.wallet.trustline',{asset:{code:item.code,issuer:item.issuer},options:{}})):''}]);
 const selection=$('#payment-asset').value;$('#payment-asset').replaceChildren(node('option','Native XLM',{value:'native'}),node('option','Other asset',{value:'custom'}));
 for(const asset of assets.filter(item=>(item.chain??'STELLAR')==='STELLAR'&&item.issuer))$('#payment-asset').append(node('option',asset.code+' · '+asset.issuer.slice(0,12),
  {value:JSON.stringify({type:asset.code.length<=4?'credit_alphanum4':'credit_alphanum12',code:asset.code,issuer:asset.issuer})}));
 if([...$('#payment-asset').options].some(item=>item.value===selection))$('#payment-asset').value=selection;
 $('#wallet-detail').textContent=pretty({wallet:sdkState?.wallet,wallets:values,balance:sdkState?.balance,assets:sdkState?.assets});
 const adapters=Array.isArray(sdkState?.walletAdapters)?sdkState.walletAdapters:[];
 $('#wallet-adapters').replaceChildren(...adapters.map(adapter=>button(adapter.name??adapter.type??adapter.id,()=>runAction('sdk.auth.login',{options:{provider:adapter.type??adapter.id}}))));
 if(!adapters.length)$('#wallet-adapters').append(node('p','No compatible browser wallet has been detected yet.',{class:'muted'}));
}
function renderAddress(){
 let selected;try{selected=JSON.parse($('#receive-wallet').value);}catch{}
 $('#receive-address').textContent=selected?.[1]??'No wallet address yet.';$('#copy-address').disabled=!selected?.[1];
}
function renderState(){
 if(!sdkState)return;renderSession();renderWallets();
 const transaction=sdkState.transaction??{step:'idle'};
 $('#transaction-summary').textContent=transaction.step==='idle'?'No payment is in progress.':
  String(transaction.step).replaceAll('_',' ')+(transaction.hash?' · '+transaction.hash:'');
 $('#transaction-detail').textContent=pretty(transaction);$('#connection-detail').textContent=pretty(sdkState);
 if(sdkState.history?.step==='loaded'&&!selectedSDK?.action.startsWith('sdk.history.collect'))setHistory(sdkState.history.data.records,
  {offset:sdkState.history.data.offset,total:sdkState.history.data.total,limit:sdkState.history.data.limit},sdkState.history);
 if(sdkState.storageDegradation)status('Wallet storage reported '+sdkState.storageDegradation.reason+'. Keep this page open while recovering the selected operation.',true);
}
function setHistory(records,coverage,detail){
 historyRows=records??[];historyPage=0;
 const count=coverage.retainedRecords??historyRows.length,total=coverage.total??coverage.observedTotals?.at(-1),parts=[count.toLocaleString()+' transactions loaded'];
 if(Number.isSafeInteger(total))parts.push(total.toLocaleString()+' reported by the provider');
 if(Number.isSafeInteger(coverage.retainedPages))parts.push(coverage.retainedPages.toLocaleString()+' pages');
 if(coverage.complete===true)parts.push('History collection complete');
 else if(coverage.nextParams)parts.push('More history is available from the saved next page');
 if(coverage.partialReason)parts.push('Collection paused: '+String(coverage.partialReason).replaceAll('_',' ').toLowerCase());
 $('#history-coverage').textContent=parts.join(' · ');$('#history-detail').textContent=pretty(detail);renderHistoryPage();
}
function renderHistoryPage(){
 const start=historyPage*100,selected=historyRows.slice(start,start+100);
 table('#history-table',selected,[{label:'Transaction',value:item=>item.hash??item.txHash??item.id??''},{label:'Chain',value:item=>item.chain??'STELLAR'},
  {label:'Status / type',value:item=>item.status??item.type??item.operation??''},{label:'Amount',value:item=>typeof item.amount==='object'?pretty(item.amount):item.amount??''},
  {label:'Created',value:item=>item.createdAt??item.timestamp??''},
  {label:'Open',value:item=>button('Transaction details',()=>{$('#history-detail').textContent=pretty(item);})}]);
 if(historyRows.length){const controls=row(node('span',(start+1)+'–'+(start+selected.length)+' of '+historyRows.length+' retained rows'),
  historyPage?button('Previous rows',()=>{historyPage--;renderHistoryPage();}):null,
  start+100<historyRows.length?button('Next rows',()=>{historyPage++;renderHistoryPage();}):null);$('#history-table').append(controls);}
}
function renderOutcome(saved){
 selectedSDK=saved;$('#service-summary').textContent=(POLLAR_BROWSER_ACTIONS.find(item=>item.action===saved.action)?.title??saved.action)+' · '+saved.state.toLowerCase();$('#service-result').textContent=pretty(saved.outcome??saved.lastError??{state:saved.state});$('#service-actions').replaceChildren();
 if(saved.checkpoint)$('#service-actions').append(button('Download wallet result',()=>downloadJSON(saved.checkpoint.originalResult??saved.checkpoint.nativeResult,'private-wallet-result-'+saved.operationId+'.json')));
 if(saved.action.startsWith('sdk.history.')&&saved.checkpoint?.history){
  const history=saved.checkpoint.history;setHistory(history.pages.flatMap(page=>page.value.data.records),{
   complete:history.complete,retainedPages:history.pages.length,retainedRecords:history.recordCount,uniqueRecords:history.uniqueRecordCount,nextParams:history.nextParams,
   observedTotals:history.observedTotals,partialReason:history.partialReason},history);
 }else if(saved.action==='sdk.history.page'&&saved.outcome?.result?.data)setHistory(saved.outcome.result.data.records,saved.outcome.result.data,saved.outcome.result);
 $('#transaction-actions').replaceChildren();
 if(saved.providerIds?.transactionHash)$('#transaction-actions').append(button('Read this transaction status',()=>runAction('sdk.transaction.status',{hash:saved.providerIds.transactionHash})));
}
function visibleOperation(saved){const user=saved.checkpoint?.scope?.userId;return !user||user===providerUser();}
async function renderPending(){
 if(!journal)return;const saved=(await journal.sdkOperations()).filter(visibleOperation).reverse();
 table('#sdk-operations',saved,[{label:'Action',value:item=>item.action},{label:'State',value:item=>item.state},{label:'Operation',value:item=>item.operationId},
  {label:'Recovery',value:item=>row(button('Inspect',()=>selectOperation(item)),
   item.applicationVersion!==app.applicationVersion?button('Open saved version',()=>{location.href='/portal?application='+app.applicationId+'&version='+item.applicationVersion;}):
    !TERMINAL.has(item.state)||item.publishedSequence<(item.checkpoint?.sequence??0)?button('Check status',()=>resumeSDK(item)):null)}]);
 const requests=(await journal.requests()).filter(item=>!['COMPLETE','CANCELED'].includes(item.state));
 table('#host-requests',requests,[{label:'Request',value:item=>item.id},{label:'Action',value:item=>item.method},{label:'State',value:item=>item.state},
  {label:'Recovery',value:item=>row(button('Retry saved request',()=>executeHost(item)),item.state==='REVISION_CONFLICT'?button('Refresh rejected revision',async()=>{
   await refreshRevision();return executeHost(await journal.rebase(item,revision));}):null)}]);
}
function selectOperation(saved){
 selectedSDK=saved;$('#selected-operation').hidden=false;$('#selected-operation-detail').textContent=pretty({operationId:saved.operationId,
  action:saved.action,state:saved.state,phase:saved.phase,publicArgs:saved.publicArgs,providerIds:saved.providerIds,
  outcome:saved.outcome,hostOperationId:saved.hostOperationId,hostAttemptId:saved.hostAttemptId,lastError:saved.lastError});
 $('#selected-operation-actions').replaceChildren(button('Read provider outcome',()=>resumeSDK(saved)));
 if(saved.checkpoint)$('#selected-operation-actions').append(button('Download private result',()=>downloadJSON(saved.checkpoint.originalResult??saved.checkpoint.nativeResult,'private-wallet-result-'+saved.operationId+'.json')));
 if(saved.hostOperationId)$('#selected-operation-actions').append(button('Read saved full source records',async()=>{
  const result=await hostRead('operation.read',{operationId:saved.hostOperationId});$('#selected-operation-detail').textContent=pretty(result);
  for(const sourceId of result.operation.sourceIds)$('#selected-operation-actions').append(button('Source '+sourceId.slice(0,8),
   ()=>download('/api/portal/sources/'+sourceId+'/source','pollar-source-'+sourceId+'.json')));
 }));
 showTab('pending');
}
async function loadHostOperations({more=false}={}){
 const result=await hostRead('records.page',{table:'operations',limit:100,...(more&&hostCursor?{after:hostCursor}:{})});
 hostRows=more?[...hostRows,...result.rows]:result.rows;hostCursor=result.nextCursor;$('#more-host-operations').hidden=!hostCursor;
 table('#host-operations',hostRows,[{label:'Action',value:item=>item.action},{label:'State',value:item=>item.state},{label:'Created',value:item=>item.createdAt},
  {label:'Open',value:item=>button('View details',async()=>{$('#selected-operation').hidden=false;$('#selected-operation-detail').textContent=pretty(await hostRead('operation.read',{operationId:item.id}));})}]);
}
async function download(route,filename){const response=await requestJSON(route,{binary:true});return downloadResponse(response,filename);}
async function loadReports(){
 for(const [name,target]of [['snapshots','#customer-snapshots'],['reports','#customer-reports']]){
  let after=null,rows=[];do{const page=await hostRead('records.page',{table:name,limit:100,...(after?{after}:{})});rows.push(...page.rows);after=page.nextCursor;}while(after);
  table(target,rows,[{label:name==='snapshots'?'Snapshot':'Report',value:item=>item.name},{label:'Created',value:item=>item.createdAt},
   {label:'Download',value:item=>name==='snapshots'?button('Create activity report',async()=>{await hostWrite('report.create',{snapshotId:item.id,name:item.name});await loadReports();}):
    row(...item.formats.map(format=>button(format.toUpperCase(),()=>download('/api/portal/reports/'+item.id+'/'+format,'my-pollar-activity-'+item.id+'.'+format))))}]);
 }
}
function selectAction(action,args){
 $('#sdk-action').value=action;$('#sdk-args').value=pretty(args??exampleValue(POLLAR_BROWSER_ACTIONS.find(item=>item.action===action)?.inputSchema)??{});
 $('#sdk-contract').textContent=pretty(POLLAR_BROWSER_ACTIONS.find(item=>item.action===action));showTab('advanced');
}
function paymentFields(){
 const solana=$('#payment-chain').value==='SOLANA',custom=$('#payment-asset').value==='custom';
 $('#payment-mint-label').hidden=!solana;$('#payment-options-label').hidden=solana;
 $('#payment-code-label').hidden=solana||!custom;$('#payment-issuer-label').hidden=solana||!custom;
 $('#payment-asset').disabled=solana;$('#payment-amount-help').textContent=solana?'Enter an integer in base units. SOL uses 1,000,000,000 base units per SOL.':'Enter the Stellar amount in asset units.';
}
function bind(){
 for(const tab of $$('[data-tab]'))tab.onclick=()=>perform(async()=>{showTab(tab.dataset.tab);if(tab.dataset.tab==='pending')await renderPending();if(tab.dataset.tab==='reports'&&authenticated())await loadReports();});
 for(const control of $$('[data-sdk-action]'))control.onclick=()=>perform(()=>runAction(control.dataset.sdkAction,
  control.dataset.provider?{options:{provider:control.dataset.provider}}:{}));
 $('#refresh-wallet').onclick=()=>perform(async()=>{await runAction('sdk.wallet.provisioning');await runAction('sdk.wallet.balance');await runAction('sdk.wallet.assets');});
 $('#verify-session').onclick=()=>perform(async()=>{await runAction('sdk.auth.refresh');await ensureSession();status('Wallet and partner session checked.');});
 $('#email-form').onsubmit=event=>{event.preventDefault();const email=event.currentTarget.elements.email.value;perform(()=>runAction('sdk.auth.sendCode',{email}));};
 $('#code-form').onsubmit=event=>{event.preventDefault();const code=event.currentTarget.elements.code.value;event.currentTarget.elements.code.value='';perform(()=>runAction('sdk.auth.verifyCode',{code}));};
 $('#receive-wallet').onchange=renderAddress;$('#copy-address').onclick=()=>perform(async()=>{const selected=JSON.parse($('#receive-wallet').value);await navigator.clipboard.writeText(selected[1]);status('Receive address copied.');});
 $('#payment-chain').onchange=paymentFields;$('#payment-asset').onchange=paymentFields;
 $('#payment-form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;
  perform(async()=>{let params;
   if(form.elements.chain.value==='SOLANA')params={chain:'SOLANA',destination:form.elements.destination.value,amount:form.elements.amount.value,mint:form.elements.mint.value||null};
   else{let asset;if(form.elements.assetSelection.value==='native')asset={type:'native'};else if(form.elements.assetSelection.value==='custom')
     asset={type:form.elements.code.value.length<=4?'credit_alphanum4':'credit_alphanum12',code:form.elements.code.value,issuer:form.elements.issuer.value};
    else asset=JSON.parse(form.elements.assetSelection.value);
    params={chain:'STELLAR',destination:form.elements.destination.value,amount:form.elements.amount.value,asset,options:parseObject(form.elements.options.value||'{}')};
   }
   await runAction('sdk.payment.send',{params});
  });
 };
 $('#history-form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget,mode=event.submitter?.value??'collect';
  const params={limit:Number(form.elements.limit.value),offset:Number(form.elements.offset.value)};if(form.elements.chain.value)params.chain=form.elements.chain.value;
  perform(()=>runAction(mode==='page'?'sdk.history.page':'sdk.history.collect',{params}));
 };
 $('#recover-operations').onclick=()=>perform(recover);$('#load-host-operations').onclick=()=>perform(()=>loadHostOperations());$('#more-host-operations').onclick=()=>perform(()=>loadHostOperations({more:true}));
 $('#sdk-action').onchange=()=>selectAction($('#sdk-action').value);$('#sdk-form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;
  perform(()=>runAction(form.elements.action.value,parseObject(form.elements.args.value)));};
 $('#sdk-args-file').onchange=()=>perform(async()=>{const file=$('#sdk-args-file').files[0];if(file)$('#sdk-args').value=pretty(parseObject(await file.text()));});
 $('#customer-snapshot-form').onsubmit=event=>{event.preventDefault();const name=event.currentTarget.elements.name.value;
  perform(async()=>{await requireSession();await hostWrite('snapshot.create',{applicationId:app.applicationId,name});await loadReports();});};
 $('#load-reports').onclick=()=>perform(loadReports);
}
async function main(){
 const query=new URLSearchParams(location.search),application=query.get('application'),version=query.get('version');
 const bootstrap=await requestJSON('/api/portal/bootstrap'+(application?'?application='+encodeURIComponent(application)+(version?'&version='+encodeURIComponent(version):''):''));
 app=bootstrap.application;revision=app.revision;session=bootstrap.session;
 if(session)session={...session,workspaceId:app.workspaceId};
 journal=await openPollarJournal({workspaceId:app.workspaceId,scope:'portal:'+app.applicationId});
 $('#portal-title').textContent=app.name;$('#portal-network').textContent=app.configuration.stellarNetwork==='testnet'?'Testnet wallet':'Mainnet wallet';
 $('#portal-footer').textContent=app.name+' · '+app.configuration.stellarNetwork+' · Connected wallet';
 $('#sdk-action').replaceChildren(...POLLAR_BROWSER_ACTIONS.map(item=>node('option',item.title+' · '+item.action,{value:item.action})));
 const css=document.createElement('link');css.rel='stylesheet';css.href=app.configuration.runtimeModuleUrl.replace(/pollar-runtime\.mjs$/,'pollar-runtime.css');document.head.append(css);
 for(const saved of await journal.sdkOperations())localForOperation.set(saved.operationId,saved.id);
 const original=await journal.view('lastState');if(original){sdkState=original;renderState();}
 bind();paymentFields();selectAction('sdk.wallet.read');showTab(await journal.view('tab')??'connect');
 bridge=await createPollarBrowserBridge({configuration:app.configuration,onState,onOutcome});ready=true;
 sdkState=await bridge.describe();renderState();status('Wallet opened.');
 if(authenticated())await ensureSession();await recover();
 addEventListener('pagehide',()=>{ready=false;bridge.close().catch(()=>{});},{once:true});
}
main().catch(problem);
