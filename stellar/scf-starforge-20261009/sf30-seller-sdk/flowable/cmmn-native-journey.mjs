// MIT. Three original Flowable 8 CMMN case families, versioned sources and retained native lifecycle.
import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ref=record=>({kind:record.kind,id:record.id,revision:record.revision,sha256:record.sha256});
const need=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{code:'FLOWABLE_CMMN_JOURNEY_FAILED'});};
const collections=['deployments','definitions','cases','planItems','tasks','variables','historicCases','historicPlanItems','historicTasks','historicVariables','milestones'];
const exactLong='9223372036854775806';
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);

export async function runFlowableCmmnNativeJourney({
  configuration,directory,connectionId,call,source,operation,prepare,dispatch,
  retainReview,step,freeze,requestId,client,browserUrl,signal
}) {
  need(typeof call==='function'&&typeof operation==='function'&&typeof step==='function',
    'Use the original saved Flowable workspace and native journey helpers.');
  const catalogBytes=await readFile(new URL('./fixtures/cases/case-catalog.json',import.meta.url));
  const catalog=JSON.parse(catalogBytes);
  need(catalog.schema==='stellar-forge.flowable-cmmn-native-fixtures.v1'&&catalog.engineVersion==='8.0.0'&&
    catalog.nativeSourceRevision==='0779d68e5a3385b74d8acb8bc37901ff54513249'&&catalog.families.length===3,
    'Use the complete original Flowable 8 case cohort and its pinned native engine source.');
  const models=new Map(),inputs=new Map();
  for(const family of catalog.families) {
    need(family.files.length===2&&family.key&&family.model&&family.input,'Each case family retains two editions and its typed input.');
    for(const member of [...family.files,family.input]) {
      need(typeof member.filename==='string'&&!member.filename.startsWith('/')&&!member.filename.includes('\\')&&
        member.filename.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Use the original cohort member path.');
      const bytes=await readFile(new URL('./fixtures/cases/'+member.filename,import.meta.url));
      need(bytes.length===member.bytes&&hash(bytes)===member.sha256,'The original case source changed: '+member.filename);
      if(member.edition)models.set(family.id+':'+member.edition,{...member,content:bytes});
      else inputs.set(family.id,{...member,content:bytes.toString('utf8')});
    }
  }
  await mkdir(join(directory,'downloads'),{recursive:true});
  const phase=(label,run)=>step('cmmn:'+label,run);
  const frozen=(label,value)=>freeze('cmmn:'+label,value);
  async function capture(label) {
    const record=await call('captureCasePortfolio',await frozen(label+':capture',{
      requestId:requestId('cmmn:'+label+':capture'),connectionId,label:configuration.operation+' '+label}));
    need(record.kind==='casePortfolio'&&record.value.state==='CAPTURED',
      'Complete all original native case collections: '+JSON.stringify(record.value.failure??record.value.summary));
    return ref(record);
  }
  async function pageAll(portfolio,collection) {
    const items=[];let offset=0;
    for(;;) {
      const page=await call('readCasePortfolio',{id:portfolio.id,revision:portfolio.revision,collection,offset,limit:37});
      need(page.complete===true&&page.offset===offset&&Array.isArray(page.items),
        'Read a complete original captured case '+collection+' page.');
      items.push(...page.items);
      if(page.nextOffset===null){need(items.length===page.total,'Receive every native '+collection+' member.');return items;}
      need(page.nextOffset>offset,'The original case portfolio cursor must advance.');offset=page.nextOffset;
    }
  }
  async function caseAt(portfolio,id) {
    const value=await call('readCaseInstance',{portfolioId:portfolio.id,revision:portfolio.revision,caseInstanceId:id});
    need(value.caseInstance?.id===id||value.historicCase?.id===id,'Read the exact selected native case.');
    return value;
  }
  const planItem=(value,definition,state)=>{
    const matches=(value.related.planItems??[]).filter(item=>item.planItemDefinitionId===definition&&
      (state===undefined||item.state===state));
    need(matches.length===1,'Select one original '+definition+' plan item'+(state?' in '+state:'')+'.');
    return matches[0];
  };
  const task=(value,definition)=>{
    const matches=(value.related.tasks??[]).filter(item=>item.taskDefinitionKey===definition);
    need(matches.length===1,'Select one original human task for '+definition+'.');
    return matches[0];
  };
  async function act(label,kind,selection) {
    const selected=await frozen(label+':selection',selection);
    const received=await operation('cmmn '+label,kind,selected,connectionId);
    const record=await call('getRecord',{kind,id:received.id});
    need(record.kind===kind&&record.value.state==='CONFIRMED'&&record.value.reconciliation,
      'Resolve the original saved '+label+' outcome before further work: '+record.value.state);
    const retained=await source(record.value.selection),reconciliation=await source(record.value.reconciliation);
    need(canonical(retained)===canonical(selected)&&reconciliation.state==='CONFIRMED',
      'The native operation must retain its complete exact original selection and confirmed readback.');
    await retainReview(record);
    return {record:ref(record),action:selected.action,selection:record.value.selection,
      response:record.value.response??null,reconciliation:record.value.reconciliation,evidence:reconciliation.evidence};
  }
  function startSelection(family,definitionId,businessKey) {
    let bodyText=inputs.get(family.id).content;
    for(const [token,value]of [['__CASE_DEFINITION_ID__',definitionId],['__BUSINESS_KEY__',businessKey]]) {
      const original=JSON.stringify(token);
      need(bodyText.split(original).length===2,'The typed start has one explicit '+token+' placeholder.');
      bodyText=bodyText.replace(original,JSON.stringify(value));
    }
    need(bodyText.includes(exactLong),'Keep the original 64-bit numeric token without a JavaScript number round trip.');
    return {action:'startCase',bodyText};
  }
  async function start(family,edition,definitionId,label) {
    const businessKey=configuration.operation+':cmmn:'+family.id+':v'+edition+':'+label;
    const selection=startSelection(family,definitionId,businessKey);
    const action=await act(label+' start','caseInstance',selection);
    const ids=action.evidence.caseInstanceIds;
    need(Array.isArray(ids)&&ids.length===1,'The original start reconciliation must identify one native case.');
    const portfolio=await capture(label+' started'),current=await caseAt(portfolio,ids[0]);
    need(current.caseInstance?.state==='active'&&current.caseInstance.caseDefinitionId===definitionId&&
      current.caseInstance.businessKey===businessKey,'The native case starts under the selected source edition and original business key.');
    planItem(current,family.model.reviewDefinition,'enabled');
    need(!(current.related.tasks??[]).some(item=>item.taskDefinitionKey===family.model.reviewDefinition),
      'A manually activated human task must wait for the original plan-item start.');
    return {caseInstanceId:ids[0],definitionId,edition,businessKey,selection,action,portfolio,
      inputSource:{filename:family.input.filename,bytes:family.input.bytes,sha256:family.input.sha256}};
  }
  function planSelection(action,caseInstanceId,planItemInstanceId) {
    const native={startPlanItem:'start',triggerPlanItem:'trigger',disablePlanItem:'disable'};
    return {action,caseInstanceId,planItemInstanceId,bodyText:JSON.stringify({action:native[action]})};
  }
  function taskSelection(action,caseInstanceId,taskId,extra={}) {
    return {action,caseInstanceId,taskId,bodyText:JSON.stringify({action:action==='unclaim'?'claim':action,...extra})};
  }
  async function release(edition) {
    const results=[];
    for(const family of catalog.families) {
      const member=models.get(family.id+':'+edition),label=family.id+' release v'+edition;
      const action=await act(label,'caseRelease',{action:'deploy',
        deploymentName:configuration.operation+' '+family.id+' v'+edition,
        deploymentKey:family.key,
        resource:{filename:member.filename,contentType:'application/xml',contentBase64:member.content.toString('base64')}});
      results.push({family:family.id,edition,action,source:{filename:member.filename,bytes:member.bytes,sha256:member.sha256}});
    }
    const portfolio=await capture('case source editions '+edition),definitions=await pageAll(portfolio,'definitions'),selected=[];
    for(const family of catalog.families) {
      const candidates=definitions.filter(item=>item.key===family.key);
      need(candidates.length===edition&&Math.max(...candidates.map(item=>Number(item.version)))===edition,
        'The original engine must retain each actual deployed edition for '+family.id+'.');
      for(const definition of candidates) {
        const original=await call('readCaseDefinition',{portfolioId:portfolio.id,revision:portfolio.revision,definitionId:definition.id});
        const member=models.get(family.id+':'+Number(definition.version));
        const resources=original.resources.filter(resource=>resource.kind==='cmmn-definition-resource'&&
          resource.bytes===member.bytes&&resource.sha256===member.sha256);
        need(resources.length===1&&resources[0].originalResource,
          'Receive the exact original CMMN resource for its native definition and deployment.');
        const file=await client.downloadSource(resources[0].originalResource,
          join(directory,'downloads','cmmn-'+member.sha256+'.cmmn'),{signal});
        need(file.bytes===member.bytes&&file.sha256===member.sha256,'Receive the complete original case XML bytes.');
        selected.push({family:family.id,id:definition.id,key:definition.key,version:Number(definition.version),
          deploymentId:definition.deploymentId,sourceDefinition:resources[0].originalResource,source:file});
      }
    }
    return {edition,results,portfolio,definitions:selected};
  }
  async function finishCase(family,edition,definitionId,label) {
    const begun=await phase(label+' start',()=>start(family,edition,definitionId,label));
    const actions=[begun.action],id=begun.caseInstanceId;
    let current=await caseAt(begun.portfolio,id);
    actions.push(await act(label+' name','caseInstance',{action:'updateCase',caseInstanceId:id,
      bodyText:JSON.stringify({name:family.subject+' / edition '+edition})}));
    actions.push(await act(label+' criteria','caseInstance',{action:'evaluateCaseCriteria',caseInstanceId:id,
      bodyText:'{"action":"evaluateCriteria"}'}));
    const reviewItem=planItem(current,family.model.reviewDefinition,'enabled');
    actions.push(await act(label+' activate review','casePlanItem',planSelection('startPlanItem',id,reviewItem.id)));
    let portfolio=await capture(label+' review active');current=await caseAt(portfolio,id);
    let reviewTask=task(current,family.model.reviewDefinition);
    actions.push(await act(label+' claim review','caseTask',taskSelection('claim',id,reviewTask.id,{assignee:'case-reviewer'})));
    if(edition===1&&family.id==='grant-due-diligence') {
      actions.push(await act(label+' unclaim review','caseTask',taskSelection('unclaim',id,reviewTask.id,{assignee:null})));
      actions.push(await act(label+' reclaim review','caseTask',taskSelection('claim',id,reviewTask.id,{assignee:'case-reviewer'})));
      actions.push(await act(label+' delegate review','caseTask',taskSelection('delegate',id,reviewTask.id,{assignee:'case-specialist'})));
      const delegated=await caseAt(await capture(label+' delegated review'),id),delegatedTask=task(delegated,family.model.reviewDefinition);
      need(delegatedTask.assignee==='case-specialist'&&String(delegatedTask.delegationState).toLowerCase()==='pending',
        'The native case task is delegated to the selected specialist.');
      actions.push(await act(label+' resolve review','caseTask',taskSelection('resolve',id,reviewTask.id,
        {variables:[{name:'specialistFinding',type:'string',value:'Original source evidence reviewed'}]})));
      const resolved=await caseAt(await capture(label+' resolved review'),id),resolvedTask=task(resolved,family.model.reviewDefinition);
      need(resolvedTask.assignee==='case-reviewer'&&String(resolvedTask.delegationState).toLowerCase()==='resolved',
        'The native task returns to its original owner after specialist resolution.');
    }
    actions.push(await act(label+' complete evidence','caseTask',taskSelection('complete',id,reviewTask.id,
      {variables:[{name:'evidenceReviewed',type:'boolean',value:true}]})));
    portfolio=await capture(label+' evidence reviewed');current=await caseAt(portfolio,id);
    const confirmation=planItem(current,family.model.verificationDefinition,'active');
    actions.push(await act(label+' confirm source','casePlanItem',planSelection('triggerPlanItem',id,confirmation.id)));
    portfolio=await capture(label+' source confirmed');current=await caseAt(portfolio,id);
    need((current.related.milestones??[]).some(item=>item.name===family.milestone),
      'Source confirmation must reach the original evidence milestone.');
    if(edition===2) {
      const exceptionItem=planItem(current,family.model.exceptionDefinition,'enabled');
      planItem(current,family.model.approvalDefinition,'available');
      need(!(current.related.tasks??[]).some(item=>item.taskDefinitionKey===family.model.approvalDefinition),
        'The second edition must defer final approval until its required exception review completes.');
      actions.push(await act(label+' activate exception','casePlanItem',planSelection('startPlanItem',id,exceptionItem.id)));
      portfolio=await capture(label+' exception active');current=await caseAt(portfolio,id);
      const exceptionTask=task(current,family.model.exceptionDefinition);
      actions.push(await act(label+' claim exception','caseTask',taskSelection('claim',id,exceptionTask.id,{assignee:'case-specialist'})));
      actions.push(await act(label+' complete exception','caseTask',taskSelection('complete',id,exceptionTask.id,
        {variables:[{name:'exceptionResolved',type:'boolean',value:true}]})));
      portfolio=await capture(label+' exception resolved');current=await caseAt(portfolio,id);
    }
    const approval=task(current,family.model.approvalDefinition);
    actions.push(await act(label+' claim approval','caseTask',taskSelection('claim',id,approval.id,{assignee:'case-approver'})));
    actions.push(await act(label+' complete approval','caseTask',taskSelection('complete',id,approval.id,
      {variables:[{name:'handoverApproved',type:'boolean',value:true}]})));
    portfolio=await capture(label+' completed');current=await caseAt(portfolio,id);
    need(!current.caseInstance&&current.historicCase?.state==='completed'&&current.historicCase.endTime,
      'All required case work must complete in the original native engine and retain completed history.');
    const historicTasks=(current.related.historicTasks??[]).filter(item=>item.endTime&&
      [null,undefined,'completed'].includes(item.deleteReason));
    need(historicTasks.length===family.expected['edition'+edition].completedHumanTasks,
      'The original case history retains each completed edition-specific human task.');
    for(const name of [family.milestone,family.ready])need((current.related.milestones??[]).some(item=>item.name===name),
      'Retain the original case milestone '+name+'.');
    const histories=current.related.historicPlanItems??[];
    need(histories.some(item=>item.planItemDefinitionId===family.model.verificationDefinition&&item.state==='completed'),
      'The blocking original source-confirmation plan item completed through the native trigger.');
    const variables=(current.related.historicVariables??[]).map(item=>item.variable??item);
    need(variables.some(item=>item.name==='evidenceReviewed'&&item.type==='boolean'&&item.value===true)&&
      variables.some(item=>item.name==='handoverApproved'&&item.type==='boolean'&&item.value===true),
      'The original typed case variables remain in complete historic state.');
    if(edition===2)need(variables.some(item=>item.name==='exceptionResolved'&&item.type==='boolean'&&item.value===true),
      'The second-edition exception decision remains in native history.');
    return {...begun,portfolio,actions,state:'completed',
      history:{case:current.historicCase,humanTasks:historicTasks,planItems:histories,
        milestones:current.related.milestones,variables:current.related.historicVariables},
      changedWork:edition===2?{requiredTask:family.model.exceptionDefinition,sourceRule:'exceptionRequired',resolved:true}:null};
  }

  const initial=await phase('original case-key ownership',async()=>{
    const portfolio=await capture('original case-key ownership'),definitions=await pageAll(portfolio,'definitions');
    need(!definitions.some(item=>catalog.families.some(family=>family.key===item.key)),
      'The new original programme requires unused fixture keys; reopen this same saved programme for recovery.');
    return {portfolio,keys:catalog.families.map(family=>family.key)};
  });
  const first=await phase('three first case releases',()=>release(1)),familyResults=[];
  for(const family of catalog.families) {
    const definition=first.definitions.find(item=>item.family===family.id&&item.version===1);
    const completed=await phase(family.id+' v1 lifecycle',()=>finishCase(family,1,definition.id,family.id+' v1'));
    familyResults.push({id:family.id,key:family.key,input:family.input,releases:[definition],editions:[completed]});
  }
  const second=await phase('three second case releases',()=>release(2));
  for(const family of catalog.families) {
    const definition=second.definitions.find(item=>item.family===family.id&&item.version===2);
    const completed=await phase(family.id+' v2 lifecycle',()=>finishCase(family,2,definition.id,family.id+' v2'));
    const result=familyResults.find(item=>item.id===family.id);result.releases.push(definition);result.editions.push(completed);
  }
  const termination=await phase('native controlled case termination',async()=>{
    const family=catalog.families[0],definition=second.definitions.find(item=>item.family===family.id&&item.version===2);
    const begun=await phase('termination start',()=>start(family,2,definition.id,'controlled termination'));
    let current=await caseAt(begun.portfolio,begun.caseInstanceId);
    const selected=planItem(current,family.model.reviewDefinition,'enabled');
    const disabled=await act('controlled termination disable review','casePlanItem',
      planSelection('disablePlanItem',begun.caseInstanceId,selected.id));
    const disabledPortfolio=await capture('controlled review disabled');current=await caseAt(disabledPortfolio,begun.caseInstanceId);
    const disabledItem=(current.related.planItems??[]).find(item=>item.id===selected.id)??
      (current.related.historicPlanItems??[]).find(item=>item.id===selected.id);
    need(disabledItem?.state==='disabled'||disabledItem?.lastDisabledTime,
      'The selected original manual plan item retains its disabled transition.');
    const terminated=await act('controlled case termination','caseInstance',
      {action:'terminateCase',caseInstanceId:begun.caseInstanceId});
    const portfolio=await capture('controlled case terminated');current=await caseAt(portfolio,begun.caseInstanceId);
    need(!current.caseInstance&&current.historicCase?.state==='terminated'&&current.historicCase.endTime,
      'Native termination retains the original ended case history.');
    return {...begun,disabled,terminated,portfolio,state:'terminated',history:current.historicCase};
  });
  const continuation=await phase('active v2 case for original receiving',async()=>{
    const family=catalog.families.find(item=>item.id==='onboarding-investigation');
    const definition=second.definitions.find(item=>item.family===family.id&&item.version===2);
    const begun=await phase('receiving case start',()=>start(family,2,definition.id,'receiving continuation'));
    const current=await caseAt(begun.portfolio,begun.caseInstanceId);
    const selected=planItem(current,family.model.reviewDefinition,'enabled');
    const activated=await act('receiving activate review','casePlanItem',
      planSelection('startPlanItem',begun.caseInstanceId,selected.id));
    const portfolio=await capture('receiving active original case'),active=await caseAt(portfolio,begun.caseInstanceId);
    const activeItem=planItem(active,family.model.reviewDefinition,'active'),activeTask=task(active,family.model.reviewDefinition);
    const followingItem=planItem(active,family.model.verificationDefinition,'available');
    need(active.caseInstance?.state==='active','The selected receiving case stays active under its original engine.');
    return {connectionId,portfolio,definitionId:definition.id,caseInstanceId:begun.caseInstanceId,
      planItemId:activeItem.id,taskId:activeTask.id,taskDefinitionKey:activeTask.taskDefinitionKey,
      taskCompletionBodyText:JSON.stringify({action:'complete',variables:[{name:'evidenceReviewed',type:'boolean',value:true}]}),
      expectedCaseStateAfterTask:'active',followingPlanItemId:followingItem.id,
      followingPlanItemDefinitionId:followingItem.planItemDefinitionId,followingPlanItemStateAfterTask:'active',
      selection:begun.selection,sourceDefinition:definition.sourceDefinition,
      family:family.id,edition:2,startRecord:begun.action.record,activationRecord:activated.record,
      inputSource:begun.inputSource,businessKey:begun.businessKey,
      native:{case:active.caseInstance,planItem:activeItem,task:activeTask},model:family.model};
  });
  const complete=await phase('all original case collections and histories',async()=>{
    const portfolio=await capture('complete original case programme'),counts={};
    for(const collection of collections)counts[collection]=(await pageAll(portfolio,collection)).length;
    const ownCaseIds=new Set([...familyResults.flatMap(family=>family.editions.map(item=>item.caseInstanceId)),
      termination.caseInstanceId,continuation.caseInstanceId]);
    need(ownCaseIds.size===8,'The original programme has six completed cases, one terminated case and one receiving continuation.');
    const definitions=await pageAll(portfolio,'definitions'),histories=await pageAll(portfolio,'historicCases');
    need(definitions.filter(item=>catalog.families.some(family=>family.key===item.key)).length===6,
      'All six original native case definitions remain captured.');
    need(histories.filter(item=>ownCaseIds.has(item.id)&&item.state==='completed').length===6&&
      histories.filter(item=>ownCaseIds.has(item.id)&&item.state==='terminated').length===1,
      'The full native case history retains actual completion and termination states.');
    const active=await caseAt(portfolio,continuation.caseInstanceId);
    need(active.caseInstance?.state==='active'&&
      (active.related.tasks??[]).some(item=>item.id===continuation.taskId),
      'The independent receiving continuation retains its exact active task.');
    return {portfolio,counts,caseInstanceIds:[...ownCaseIds]};
  });
  return {schema:'stellar-forge.flowable-cmmn-native-journey.v1',state:'PASSED',
    nativeVersion:catalog.engineVersion,nativeSourceRevision:catalog.nativeSourceRevision,
    catalogSha256:hash(catalogBytes),portfolio:complete.portfolio,families:familyResults,
    completedCases:6,terminatedCases:1,activeReceivingCases:1,releaseVersions:6,
    exactTypedStart:{type:'long',originalNumericToken:exactLong,source:'three complete original input files'},
    initial,first,second,termination,continuation:{...continuation,portfolio:complete.portfolio},complete};
}
