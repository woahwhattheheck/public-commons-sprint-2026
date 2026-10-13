// MIT. Compile the complete retained case cohort into the existing operator programme.
import {validateFlowableProgramme,FLOWABLE_PROGRAMME_SCHEMA} from './programme-core.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_CASE_PROGRAMME_INVALID'});};
const baseSource=(step,document,pointer,extra={})=>({step,document,pointer,...extra});
function utf8Base64(text){
 const escaped=encodeURIComponent(text),bytes=[];
 for(let i=0;i<escaped.length;i++){
  if(escaped[i]==='%'){bytes.push(parseInt(escaped.slice(i+1,i+3),16));i+=2;}
  else bytes.push(escaped.charCodeAt(i));
 }
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';
 for(let i=0;i<bytes.length;i+=3){
  const a=bytes[i],b=bytes[i+1],c=bytes[i+2],n=(a<<16)|((b??0)<<8)|(c??0);
  out+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(b===undefined?'=':alphabet[(n>>>6)&63])+(c===undefined?'=':alphabet[n&63]);
 }return out;
}
export function buildFlowableCaseProgramme({catalogText,members,operation,roles,tenantId}){
 need(typeof catalogText==='string'&&typeof operation==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(operation),'Select the exact complete cohort and a stable operation key.');
 const catalog=JSON.parse(catalogText);
 need(catalog.engineVersion==='8.0.0'||catalog.engine?.version==='8.0.0','Use the authored original Flowable 8 case cohort.');
 need(Array.isArray(catalog.families)&&catalog.families.length>0&&catalog.families.length<=12,'Select the complete agreed case families.');
 need(roles&&['reviewer','specialist','approver'].every(k=>typeof roles[k]==='string'&&roles[k].trim()&&roles[k].length<=200),'Name the original human roles.');
 need(tenantId===undefined||typeof tenantId==='string'&&tenantId.length>0&&tenantId.length<=200,'Use an actual native tenant ID when supplied.');
 const sources=Object.entries(members).map(([name,source])=>({name,...copy(source)})),byName=new Map(sources.map(source=>[source.name,source]));
 need(sources.some(source=>source.text===catalogText),'Include the complete original catalogue in the source members.');
 for(const source of sources)if(source.text!==undefined)need(typeof source.text==='string'&&utf8Base64(source.text)===source.contentBase64,'The original text and complete byte source differ: '+source.name);
 const steps=[];let previous;
 function add(key,label,kind,selection,bindings=[]){
  const step={key,label,kind,selection,...(previous?{after:[previous]}:{}),...(bindings.length?{bindings}:{})};
  steps.push(step);previous=key;return key;
 }
 const bindField=(field,from)=>({field,from}),bindToken=(token,from)=>({token,from});
 function nativeId(step,collection,where){
  return baseSource(step,'after','/'+collection,{where,valuePointer:'/id'});
 }
 function original(name){
  const source=byName.get(name);need(source&&typeof source.contentBase64==='string','The complete source member is missing: '+name);
  return source;
 }
 function sourceText(name){
  const source=original(name);
  // The caller supplies UTF-8 source text separately; the exact byte/hash inventory is retained at intake.
  need(typeof members[name].text==='string','Supply the complete UTF-8 text for '+name);
  return members[name].text;
 }
 for(const edition of [1,2])for(const family of catalog.families){
  need(typeof family.id==='string'&&typeof family.key==='string'&&family.model,'Select original family IDs, keys and native model fields.');
  const item=(family.resources??family.files).find(value=>value.edition===edition);
  need(item,'The original cohort must include both complete source editions.');
  const path=item.path??item.filename,resource=original(path),deployment=family.id+'-v'+edition+'-deploy';
  add(deployment,family.title+' · source '+edition,'caseRelease',{action:'deploy',deploymentName:operation+' '+family.id+' v'+edition,
   deploymentKey:family.key,...(tenantId?{tenantId}:{}),resource:{filename:path.split('/').at(-1),contentType:'application/xml',contentBase64:resource.contentBase64}});
  const definition=nativeId(deployment,'definitions',{key:family.key,deploymentId:baseSource(deployment,'reconciliation','/evidence/deploymentIds/0')});
  const scenarios=family.cases??[{id:'original',input:family.input.filename,exceptionRequired:family.expected?.edition2?.exceptionRequired===true}];
  for(const scenario of scenarios){
   const prefix=family.id+'-v'+edition+'-'+scenario.id,start=prefix+'-start';
   let bodyText=sourceText(scenario.input),parsed=JSON.parse(bodyText);
   need(bodyText.includes('"__CASE_DEFINITION_ID__"')&&bodyText.includes('"__BUSINESS_KEY__"'),'Retain original complete definition and business-key placeholders.');
   bodyText=bodyText.split('"__BUSINESS_KEY__"').join(JSON.stringify(operation+':'+prefix));
   for(const role of ['reviewer','specialist','approver']){
    const token='"__'+role.toUpperCase()+'_ID__"';
    if(bodyText.includes(token))bodyText=bodyText.split(token).join(JSON.stringify(roles[role]));
    else need(parsed.variables?.some(value=>value.name===role&&value.type==='string'&&value.value===roles[role]),
     'This original input already selects '+role+'; use that exact role or author a new input edition.');
   }
   add(start,family.title+' · '+scenario.id+' · start source '+edition,'caseInstance',{action:'startCase',bodyText},
    [bindToken('__CASE_DEFINITION_ID__',definition)]);
   const caseId=baseSource(start,'reconciliation','/evidence/caseInstanceIds/0');
   function caseAction(suffix,label,action,body){
    return add(prefix+'-'+suffix,label,'caseInstance',{action,caseInstanceId:'__NATIVE_CASE__',bodyText:JSON.stringify(body)},
     [bindField('caseInstanceId',caseId)]);
   }
   function plan(suffix,label,action,definitionKey,state){
    const source=previous;
    return add(prefix+'-'+suffix,label,'casePlanItem',{action,caseInstanceId:'__NATIVE_CASE__',planItemInstanceId:'__NATIVE_ITEM__',
     bodyText:JSON.stringify({action:{startPlanItem:'start',triggerPlanItem:'trigger'}[action]})},
     [bindField('caseInstanceId',caseId),bindField('planItemInstanceId',nativeId(source,'planItems',{planItemDefinitionId:definitionKey,state}))]);
   }
   function task(suffix,label,action,definitionKey,extra){
    const source=previous;
    return add(prefix+'-'+suffix,label,'caseTask',{action,caseInstanceId:'__NATIVE_CASE__',taskId:'__NATIVE_TASK__',
     bodyText:JSON.stringify({action:action==='unclaim'?'claim':action,...extra})},
     [bindField('caseInstanceId',caseId),bindField('taskId',nativeId(source,'tasks',{taskDefinitionKey:definitionKey}))]);
   }
   caseAction('name','Name the selected case','updateCase',{name:(family.subject??family.title)+' / '+scenario.id+' / source '+edition});
   caseAction('criteria','Evaluate original case criteria','evaluateCaseCriteria',{action:'evaluateCriteria'});
   plan('activate-review','Activate evidence review','startPlanItem',family.model.reviewDefinition,'enabled');
   task('claim-review','Claim evidence review','claim',family.model.reviewDefinition,{assignee:roles.reviewer});
   if(edition===1&&family===catalog.families[0]&&scenario===scenarios[0]){
    task('unclaim-review','Release original review claim','unclaim',family.model.reviewDefinition,{assignee:null});
    task('reclaim-review','Reclaim evidence review','claim',family.model.reviewDefinition,{assignee:roles.reviewer});
    task('delegate-review','Delegate source review','delegate',family.model.reviewDefinition,{assignee:roles.specialist});
    task('resolve-review','Return specialist findings','resolve',family.model.reviewDefinition,{variables:[{name:'specialistFinding',type:'string',value:'Source review returned for the selected commissioning programme'}]});
   }
   task('complete-review','Complete evidence review','complete',family.model.reviewDefinition,{variables:[{name:'evidenceReviewed',type:'boolean',value:true}]});
   plan('confirm-source','Confirm the selected original source','triggerPlanItem',family.model.verificationDefinition,'active');
   if(edition===2&&scenario.exceptionRequired){
    plan('activate-exception','Activate exception review','startPlanItem',family.model.exceptionDefinition,'enabled');
    task('claim-exception','Claim exception review','claim',family.model.exceptionDefinition,{assignee:roles.specialist});
    task('complete-exception','Complete exception review','complete',family.model.exceptionDefinition,{variables:[{name:'exceptionResolved',type:'boolean',value:true}]});
   }
   task('claim-approval','Claim handover approval','claim',family.model.approvalDefinition,{assignee:roles.approver});
   task('complete-approval','Complete handover approval','complete',family.model.approvalDefinition,{variables:[{name:'handoverApproved',type:'boolean',value:true}]});
  }
 }
 // Text helpers are used only by this compiler. The portable programme retains exact original bytes.
 const portableSources=sources.map(({text,...source})=>source);
 const programme={schema:FLOWABLE_PROGRAMME_SCHEMA,key:operation,label:'Case commissioning · '+operation,
  note:'Original editable case cohort, two source editions, complete typed inputs and deliberate human/native operations. Review the authored commissioning values before dispatch.',
  sources:portableSources,steps};
 validateFlowableProgramme(programme);return programme;
}
