// MIT. Compile the original retained BPMN workflow cohort into operator programme actions.
import {validateFlowableProgramme,FLOWABLE_PROGRAMME_SCHEMA} from './programme-core.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_PROCESS_PROGRAMME_INVALID'});};
const ref=(step,document,pointer,extra={})=>({step,document,pointer,...extra});
function utf8Base64(text){
 const escaped=encodeURIComponent(text),bytes=[];
 for(let i=0;i<escaped.length;i++){if(escaped[i]==='%'){bytes.push(parseInt(escaped.slice(i+1,i+3),16));i+=2;}else bytes.push(escaped.charCodeAt(i));}
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';
 for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2],n=(a<<16)|((b??0)<<8)|(c??0);
  out+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(b===undefined?'=':alphabet[(n>>>6)&63])+(c===undefined?'=':alphabet[n&63]);}
 return out;
}
/**
 * Inputs are the complete original catalogue, XML and typed initial request files.
 * Author a separate source edition to change task topology or customer policy.
 * Family/source editions are local catalogue selections, never guessed engine version numbers.
 */
export function buildFlowableProcessProgramme({catalogText,members,inputs,operation,roles,familyKeys,migrateKeys,delegationKey,tenantId}){
 need(typeof catalogText==='string'&&typeof operation==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(operation),
  'Select the complete original process catalogue and a stable operation key.');
 const catalog=JSON.parse(catalogText),originalKeys=['sf_grant_review','sf_customer_onboarding','sf_vendor_approval'];
 need(catalog.schema==='stellar-forge.flowable-native-process-catalog.v1'&&Array.isArray(catalog.families)&&
  catalog.families.length===3&&new Set(catalog.families.map(f=>f.key)).size===3&&
  catalog.families.every(f=>originalKeys.includes(f.key))&&Array.isArray(catalog.resources)&&catalog.resources.length===6,
  'Use the original complete three-family, two-source-edition process catalogue.');
 need(roles&&['operator','reviewer'].every(k=>typeof roles[k]==='string'&&roles[k].trim()&&roles[k].length<=200),
  'Select the actual original native operator and reviewer identities.');
 need(tenantId===undefined||typeof tenantId==='string'&&tenantId.length>0&&tenantId.length<=200,
  'Supply an actual native tenant only when the selected engine uses one.');
 const selected=familyKeys??originalKeys;
 need(Array.isArray(selected)&&selected.length>0&&new Set(selected).size===selected.length&&selected.every(k=>originalKeys.includes(k)),
  'Select distinct original process families.');
 const migrations=migrateKeys??['sf_grant_review','sf_vendor_approval'].filter(k=>selected.includes(k));
 need(Array.isArray(migrations)&&new Set(migrations).size===migrations.length&&migrations.every(k=>selected.includes(k)),
  'Migrate only selected original process families.');
 const delegated=delegationKey??(selected.includes('sf_customer_onboarding')?'sf_customer_onboarding':selected[0]);
 need(selected.includes(delegated),'Select an original family for human delegation.');
 need(members&&typeof members==='object'&&!Array.isArray(members)&&inputs&&typeof inputs==='object'&&!Array.isArray(inputs),
  'Retain the complete original source members and typed-input mapping.');
 const sources=Object.entries(members).map(([name,source])=>({name,...copy(source)})),byName=new Map(sources.map(s=>[s.name,s]));
 need(sources.some(s=>s.text===catalogText),'Include the entire original catalogue in the source inventory.');
 for(const source of sources)if(source.text!==undefined)need(typeof source.text==='string'&&utf8Base64(source.text)===source.contentBase64,
  'Original text and exact byte source differ: '+source.name);
 const original=name=>{const source=byName.get(name);need(source&&typeof source.contentBase64==='string','Missing complete original source: '+name);return source;};
 const families=selected.map(key=>catalog.families.find(f=>f.key===key));
 const steps=[],definitions=new Map(),processes=new Map(),currentStates=new Map();let previous;
 const field=(name,from)=>({field:name,from}),token=(name,from)=>({token:name,from});
 function add(key,label,kind,selection,bindings=[]){
  steps.push({key,label,kind,selection,...(previous?{after:[previous]}:{}),...(bindings.length?{bindings}:{})});previous=key;return key;
 }
 const nativeId=(step,collection,where)=>ref(step,'after','/'+collection,{where,valuePointer:'/id'});
 function deploy(family,edition){
  const matches=catalog.resources.filter(r=>r.key===family.key&&r.version===edition);
  need(matches.length===1,'Select exactly one original model per family and source edition.');
  const resource=original(matches[0].filename),key=family.key+'-v'+edition+'-deploy';
  add(key,family.name+' · deploy source '+edition,'release',{action:'deploy',
   deploymentName:operation+' '+family.key+' source '+edition,deploymentKey:family.key,...(tenantId?{tenantId}:{}),
   resource:{filename:matches[0].filename,contentType:'application/xml',contentBase64:resource.contentBase64}});
  const definition=nativeId(key,'definitions',{key:family.key,deploymentId:ref(key,'reconciliation','/evidence/deploymentIds/0')});
  definitions.set(family.key+':'+edition,definition);return key;
 }
 function task(family,suffix,label,source,activity,action,extra={}){
  const processId=processes.get(family.key);
  return add(family.key+'-'+suffix,family.name+' · '+label,'task',{action,taskId:'__NATIVE_TASK__',bodyText:JSON.stringify({action,...extra})},
   [field('taskId',nativeId(source,'tasks',{processInstanceId:processId,taskDefinitionKey:activity}))]);
 }
 for(const family of families)deploy(family,1);
 for(const family of families){
  const source=original(inputs[family.key]);need(typeof source.text==='string','Retain complete typed process input text.');
  let bodyText=source.text;
  need(bodyText.includes('"__PROCESS_DEFINITION_ID__"')&&bodyText.includes('"__BUSINESS_KEY__"'),
   'Retain the exact original definition and business-key placeholders.');
  const parsed=JSON.parse(bodyText);
  need(parsed.processDefinitionId==='__PROCESS_DEFINITION_ID__'&&parsed.businessKey==='__BUSINESS_KEY__',
   'The original typed request must select its definition and stable business key.');
  bodyText=bodyText.split('"__BUSINESS_KEY__"').join(JSON.stringify(operation+':'+family.key+':source1'));
  if(tenantId!==undefined){
   need(parsed.tenantId==='__TENANT_ID__'||parsed.tenantId===tenantId,'Retain the explicit selected native tenant in the original input.');
   if(parsed.tenantId==='__TENANT_ID__')bodyText=bodyText.split('"__TENANT_ID__"').join(JSON.stringify(tenantId));
  }else need(parsed.tenantId===undefined,'Select the tenant declared by the complete original input.');
  const start=add(family.key+'-start',family.name+' · start selected source 1','process',{action:'start',bodyText},
   [token('__PROCESS_DEFINITION_ID__',definitions.get(family.key+':1'))]);
  processes.set(family.key,ref(start,'reconciliation','/evidence/processInstanceIds/0'));
  let state=task(family,'intake-claim','claim intake',start,'intake','claim',{assignee:roles.operator});
  if(family.key===delegated){
   state=task(family,'intake-unclaim','release intake claim',state,'intake','claim',{assignee:null});
   state=task(family,'intake-reclaim','reclaim intake',state,'intake','claim',{assignee:roles.operator});
   state=task(family,'intake-delegate','delegate intake review',state,'intake','delegate',{assignee:roles.reviewer});
   state=task(family,'intake-resolve','return delegated review',state,'intake','resolve',
    {variables:[{name:'intakeReviewed',type:'boolean',value:true}]});
  }
  state=task(family,'intake-complete','complete intake',state,'intake','complete',
   {variables:[{name:'intakeComplete',type:'boolean',value:true}]});
  currentStates.set(family.key,state);
 }
 for(const family of families)deploy(family,2);
 for(const family of families)if(migrations.includes(family.key)){
  const key=add(family.key+'-migrate-review',family.name+' · migrate running review to selected source 2','migration',
   {action:'migrate',processInstanceId:'__NATIVE_PROCESS__',
    bodyText:'{"toProcessDefinitionId":"__TARGET_DEFINITION_ID__","activityMappings":[{"fromActivityId":"review","toActivityId":"review"}]}'},
   [field('processInstanceId',processes.get(family.key)),token('__TARGET_DEFINITION_ID__',definitions.get(family.key+':2'))]);
  currentStates.set(family.key,key);
 }
 for(const family of families){
  let state=task(family,'review-claim','claim review',currentStates.get(family.key),'review','claim',{assignee:roles.operator});
  state=task(family,'review-complete','complete review',state,'review','complete',
   {variables:[{name:'decision',type:'string',value:'approved'}]});
  if(migrations.includes(family.key))state=task(family,'finalize-complete','complete source 2 final work',state,'finalize','complete',
   {variables:[{name:'commissioningComplete',type:'boolean',value:true}]});
  currentStates.set(family.key,state);
 }
 const programme={schema:FLOWABLE_PROGRAMME_SCHEMA,key:operation,label:'Process commissioning · '+operation,
  note:'Original authored BPMN workflow reference: exact retained XML and typed inputs, human assignment/delegation, selected running-process migrations and original task completion. Select actual native identities and review each prepared plan before dispatch. Customer policy and deployment approval are selected in the commissioning scope.',
  sources:sources.map(({text,...source})=>source),steps};
 validateFlowableProgramme(programme);return programme;
}
