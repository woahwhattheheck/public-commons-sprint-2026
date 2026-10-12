// MIT. Complete reusable recipes over original Console drafts and workflow editions.
import { canonical, digest, fail } from './records.mjs';
import { WorkflowRecords, normalizeWorkflowSteps, workflowPointer } from './workflow-records.mjs';

export const WORKFLOW_RECIPE_SCHEMA='stellar-forge.merchant-workflow-recipe.v1';
export const WORKFLOW_RECIPE_REVIEW_SCHEMA='stellar-forge.merchant-workflow-recipe-review.v1';
export const WORKFLOW_RECIPE_INSTALL_SCHEMA='stellar-forge.merchant-workflow-recipe-install.v1';
export const MAX_WORKFLOW_RECIPE_BYTES=16*1024*1024;
export const MAX_WORKFLOW_RECIPE_REQUEST_BYTES=32*1024*1024;
const now=()=>new Date().toISOString();
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const clone=value=>JSON.parse(canonical(value));
const same=(a,b)=>canonical(a)===canonical(b);
const need=(condition,code,message,status=400)=>{if(!condition)throw fail(code,message,status);};
const fields=(value,allowed,label)=>{
  need(plain(value)&&Object.keys(value).every(key=>allowed.includes(key)),
    'CONSOLE_RECIPE_FIELDS','Use the supported '+label+' fields.');
  return value;
};
const id=value=>{
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value),
    'CONSOLE_RECIPE_ID','Use a saved workflow, profile or step identifier.');
  return value;
};
const sha=value=>{
  need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),
    'CONSOLE_RECIPE_DIGEST','Use the selected recipe or review SHA-256.');
  return value;
};
const revision=value=>{
  need(Number.isSafeInteger(value)&&value>0,'CONSOLE_RECIPE_REVISION','Use the original saved revision.');
  return value;
};
const label=value=>{
  need(typeof value==='string'&&value.trim()&&value.length<=160&&!/[\x00-\x1f]/.test(value),
    'CONSOLE_RECIPE_NAME','Use a name from 1 to 160 characters.');
  return value.trim();
};
const description=value=>{
  need(typeof value==='string'&&value.length<=8000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),
    'CONSOLE_RECIPE_DESCRIPTION','Use complete readable recipe notes up to 8000 characters.');
  return value;
};
const toolName=value=>{
  need(typeof value==='string'&&/^[-A-Za-z0-9_.]{1,128}$/.test(value),
    'CONSOLE_RECIPE_TOOL','Use the original native tool name.');
  return value;
};
const seal=value=>({...value,contentSha256:digest(canonical(value))});
const types=new Set(['string','number','integer','boolean','object','array','null','any']);
const typeMatches=(value,type)=>type==='any'||type==='null'&&value===null||
  type==='object'&&plain(value)||type==='array'&&Array.isArray(value)||
  type==='integer'&&Number.isSafeInteger(value)||
  type==='number'&&typeof value==='number'&&Number.isFinite(value)||
  ['string','boolean'].includes(type)&&typeof value===type;
const escaped=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
const pointerPrefix=(a,b)=>a.length<=b.length&&a.every((part,index)=>part===b[index]);

function selected(value,pointer){
  for(const part of workflowPointer(pointer)){
    if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))return {present:false};
    value=value[part];
  }
  return {present:true,value};
}
function argumentTarget(argumentsValue,pointer){
  const parts=workflowPointer(pointer);if(!parts.length)return;
  let parent=argumentsValue;
  for(const part of parts.slice(0,-1)){
    need(parent!==null&&typeof parent==='object'&&Object.hasOwn(parent,part),
      'CONSOLE_RECIPE_ARGUMENT_TARGET','Keep the original argument container for '+pointer+'.');
    parent=parent[part];
  }
  need(parent!==null&&typeof parent==='object','CONSOLE_RECIPE_ARGUMENT_TARGET','Choose an argument object or array at '+pointer+'.');
  if(Array.isArray(parent))need(/^(0|[1-9][0-9]*)$/.test(parts.at(-1))&&Number(parts.at(-1))<parent.length,
    'CONSOLE_RECIPE_ARGUMENT_TARGET','Choose an existing argument array position at '+pointer+'.');
}
function assign(value,pointer,replacement,{create=false}={}){
  const parts=workflowPointer(pointer);
  if(!parts.length){
    need(plain(replacement),'CONSOLE_RECIPE_INPUTS','Whole workflow inputs and native arguments must be JSON objects.');
    return clone(replacement);
  }
  if(!create)argumentTarget(value,pointer);
  let parent=value;
  for(const part of parts.slice(0,-1)){
    need(parent!==null&&typeof parent==='object','CONSOLE_RECIPE_INPUTS','Retain the input object for '+pointer+'.');
    if(!Object.hasOwn(parent,part)&&create){
      if(Array.isArray(parent))need(/^(0|[1-9][0-9]*)$/.test(part)&&Number(part)<parent.length,
        'CONSOLE_RECIPE_INPUTS','Supply the original input array before its nested defaults.');
      Object.defineProperty(parent,part,{value:{},enumerable:true,writable:true,configurable:true});
    }
    need(Object.hasOwn(parent,part),'CONSOLE_RECIPE_INPUTS','Supply the input container for '+pointer+'.');
    parent=parent[part];
  }
  need(parent!==null&&typeof parent==='object','CONSOLE_RECIPE_INPUTS','Retain the input container for '+pointer+'.');
  const leaf=parts.at(-1);
  if(Array.isArray(parent))need(/^(0|[1-9][0-9]*)$/.test(leaf)&&Number(leaf)<parent.length,
    'CONSOLE_RECIPE_INPUTS','Choose an existing input array position.');
  Object.defineProperty(parent,leaf,{value:clone(replacement),enumerable:true,writable:true,configurable:true});
  return value;
}
function inputFields(values,steps){
  need(Array.isArray(values)&&values.length<=256,'CONSOLE_RECIPE_INPUTS','Declare up to 256 workflow input fields.');
  const pointers=[];
  const result=values.map(value=>{
    fields(value,['pointer','label','description','type','required','default'],'recipe input');
    const parts=workflowPointer(value.pointer);
    need(!pointers.some(old=>pointerPrefix(old,parts)||pointerPrefix(parts,old)),
      'CONSOLE_RECIPE_INPUTS','Declare each input once; use one object field for its nested values.');
    pointers.push(parts);
    need(types.has(value.type),'CONSOLE_RECIPE_INPUT_TYPE','Select a supported JSON input type.');
    need(value.required===undefined||typeof value.required==='boolean','CONSOLE_RECIPE_INPUTS','Choose whether the input is required.');
    if(Object.hasOwn(value,'default'))need(typeMatches(value.default,value.type),
      'CONSOLE_RECIPE_INPUT_TYPE','The input default must have its declared JSON type.');
    return {pointer:value.pointer,label:label(value.label),description:description(value.description??''),
      type:value.type,required:value.required??true,...(Object.hasOwn(value,'default')?{default:clone(value.default)}:{})};
  });
  for(const step of steps)for(const binding of step.bindings)if(binding.from==='inputs'){
    const parts=workflowPointer(binding.pointer);
    need(pointers.some(field=>pointerPrefix(field,parts)),'CONSOLE_RECIPE_INPUTS',
      'Declare the workflow input '+binding.pointer+' used by '+step.name+'.');
  }
  return result;
}
function sourceReference(value){
  if(value===null)return null;
  fields(value,['workspaceId','profileId','workflowId','workflowRevision','workflowSha256'],'recipe source');
  return {workspaceId:id(value.workspaceId),profileId:id(value.profileId),workflowId:id(value.workflowId),
    workflowRevision:revision(value.workflowRevision),workflowSha256:sha(value.workflowSha256)};
}

/** Normalize a complete source recipe. The digest covers every original contract and argument. */
export function normalizeWorkflowRecipe(packet,{verify=true}={}){
  fields(packet,['schema','name','description','source','inputs','steps','contentSha256'],'recipe');
  need(packet.schema===WORKFLOW_RECIPE_SCHEMA,'CONSOLE_RECIPE_SCHEMA','Receive an original merchant workflow recipe.');
  need(Array.isArray(packet.steps)&&packet.steps.length>0&&packet.steps.length<=128,
    'CONSOLE_RECIPE_STEPS','Use a complete sequence of 1 to 128 original native requests.');
  const drafts=new Map(),contracts=new Map();
  const steps=packet.steps.map((step,index)=>{
    fields(step,['id','name','tool','definition','arguments','bindings','expect','pauseAfter'],'recipe step');
    const name=toolName(step.tool);
    need(plain(step.definition)&&step.definition.name===name&&plain(step.definition.inputSchema)&&plain(step.arguments),
      'CONSOLE_RECIPE_CONTRACT','Retain the complete native tool definition and argument object for '+name+'.');
    const definition=clone(step.definition),signature=digest(canonical(definition));
    need(!contracts.has(name)||contracts.get(name)===signature,'CONSOLE_RECIPE_CONTRACT',
      'Use one reviewed native contract per tool in a recipe.');
    contracts.set(name,signature);
    const draftId='recipe-source-'+index;
    drafts.set(draftId,{id:draftId,profileId:'recipe-source',revision:1});
    return {id:step.id,name:step.name,tool:name,definition,arguments:clone(step.arguments),
      draftId,draftRevision:1,bindings:step.bindings??[],expect:step.expect??[],pauseAfter:step.pauseAfter??false};
  });
  const normalized=normalizeWorkflowSteps(steps.map(({tool,definition,arguments:args,...step})=>step),
    'recipe-source',(id,revision)=>drafts.get(id));
  const fullSteps=steps.map((step,index)=>{
    const {draftId,draftRevision,...structure}=normalized[index];
    return {...structure,tool:step.tool,definition:step.definition,arguments:step.arguments};
  });
  const value={schema:WORKFLOW_RECIPE_SCHEMA,name:label(packet.name),description:description(packet.description??''),
    source:sourceReference(packet.source??null),inputs:inputFields(packet.inputs??[],fullSteps),steps:fullSteps};
  const result=seal(value);
  need(Buffer.byteLength(canonical(result))<=MAX_WORKFLOW_RECIPE_BYTES,'CONSOLE_RECIPE_SIZE',
    'Keep the complete recipe within 16 MiB.');
  if(verify)need(sha(packet.contentSha256)===result.contentSha256,'CONSOLE_RECIPE_CHANGED',
    'The full recipe differs from its selected digest. Export the edited source as a new recipe.');
  return result;
}
export const sealWorkflowRecipe=value=>normalizeWorkflowRecipe(value,{verify:false});

function inferredInputs(steps){
  const entries=new Map();
  for(const step of steps)for(const binding of step.bindings)if(binding.from==='inputs'){
    let schema=step.definition.inputSchema;
    for(const part of workflowPointer(binding.target)){
      if(plain(schema?.properties)&&Object.hasOwn(schema.properties,part))schema=schema.properties[part];
      else if(schema?.type==='array'&&/^(0|[1-9][0-9]*)$/.test(part))schema=Array.isArray(schema.prefixItems)?schema.prefixItems[Number(part)]:schema.items;
      else{schema=null;break;}
    }
    const type=typeof schema?.type==='string'&&types.has(schema.type)?schema.type:'any';
    const existing=entries.get(binding.pointer);
    if(existing){if(existing.type!==type)existing.type='any';continue;}
    const parts=workflowPointer(binding.pointer);
    entries.set(binding.pointer,{pointer:binding.pointer,label:(parts.at(-1)?.trim()||'Workflow inputs').slice(0,160),type,required:true,description:''});
  }
  // One parent object field covers its nested references in the same original input.
  return [...entries.values()].filter(value=>![...entries.keys()].some(other=>other!==value.pointer&&
    pointerPrefix(workflowPointer(other),workflowPointer(value.pointer))));
}
function resolvedInputs(recipe,value){
  need(plain(value),'CONSOLE_RECIPE_INPUTS','Supply the workflow inputs as one JSON object.');
  let inputs=clone(value);
  for(const field of recipe.inputs)if(!selected(inputs,field.pointer).present&&Object.hasOwn(field,'default'))
    inputs=assign(inputs,field.pointer,field.default,{create:true});
  need(Buffer.byteLength(canonical(inputs))<=MAX_WORKFLOW_RECIPE_BYTES,'CONSOLE_RECIPE_SIZE','Keep the complete input object within 16 MiB.');
  return inputs;
}
function requestFrom(input,{install=false}={}){
  fields(input,['id','profileId','name','recipe','inputs','acceptToolChanges',...(install?['expectedReviewSha256']:[])],'recipe installation request');
  const recipe=normalizeWorkflowRecipe(input.recipe),inputs=resolvedInputs(recipe,input.inputs??{});
  const accepted=input.acceptToolChanges??[];
  need(Array.isArray(accepted)&&accepted.length<=128,'CONSOLE_RECIPE_REVIEW','Select the reviewed changed native tools.');
  const names=new Set(recipe.steps.map(step=>step.tool));
  const acceptToolChanges=[...new Set(accepted.map(toolName))].sort();
  need(acceptToolChanges.every(name=>names.has(name)),'CONSOLE_RECIPE_REVIEW','Accept only a tool used by this complete recipe.');
  return {recipe,request:{id:id(input.id),profileId:id(input.profileId),name:label(input.name??recipe.name),
    recipeSha256:recipe.contentSha256,inputs,acceptToolChanges,...(install?{expectedReviewSha256:sha(input.expectedReviewSha256)}:{})}};
}
function changes(before,after){
  const rows=[];
  function visit(a,b,pointer,beforePresent=true,afterPresent=true){
    if(beforePresent&&afterPresent&&same(a,b))return;
    if(beforePresent&&afterPresent&&plain(a)&&plain(b)){
      for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()){
        const hasA=Object.hasOwn(a,key),hasB=Object.hasOwn(b,key);
        visit(a[key],b[key],pointer+'/'+escaped(key),hasA,hasB);
      }
      return;
    }
    rows.push({pointer,beforePresent,afterPresent,...(beforePresent?{before:a}:{}),...(afterPresent?{after:b}:{})});
  }
  visit(before,after,'');return {changes:rows.slice(0,256),changeCount:rows.length};
}
function reviewFor(recipe,request,{profile,host,definitions}){
  const issues=[],tools=[],contracts=new Map(),steps=[];
  const hostFingerprint=sha(host.configurationFingerprint);
  if(profile.hostFingerprint!==hostFingerprint)issues.push({code:'CONSOLE_RECIPE_HOST_BINDING',
    message:'Review and bind this profile to the current Host before installing the recipe.'});
  for(const field of recipe.inputs){
    const item=selected(request.inputs,field.pointer);
    if(!item.present&&field.required)issues.push({code:'CONSOLE_RECIPE_INPUT_REQUIRED',pointer:field.pointer,message:'Enter '+field.label+'.'});
    if(item.present&&!typeMatches(item.value,field.type))issues.push({code:'CONSOLE_RECIPE_INPUT_TYPE',pointer:field.pointer,
      message:field.label+' must be '+field.type+'.'});
  }
  for(const step of recipe.steps){
    if(!contracts.has(step.tool)){
      const sourceDefinition=step.definition,currentDefinition=definitions.get(step.tool)?clone(definitions.get(step.tool)):null;
      const sourceSha256=digest(canonical(sourceDefinition)),currentSha256=currentDefinition?digest(canonical(currentDefinition)):null;
      const status=!currentDefinition?'MISSING':sourceSha256===currentSha256?'MATCH':'CHANGED';
      const comparison=status==='CHANGED'?changes(sourceDefinition,currentDefinition):{changes:[],changeCount:0};
      const tool={name:step.tool,sourceSha256,currentSha256,status,sourceDefinition,currentDefinition,...comparison};
      contracts.set(step.tool,tool);tools.push(tool);
      if(status==='MISSING')issues.push({code:'CONSOLE_RECIPE_TOOL_MISSING',tool:step.tool,message:'This host does not provide '+step.tool+'.'});
      if(status==='CHANGED'&&!request.acceptToolChanges.includes(step.tool))issues.push({code:'CONSOLE_RECIPE_TOOL_REVIEW',tool:step.tool,
        message:'Review and accept the current native contract for '+step.tool+', then refresh the recipe review.'});
    }
    let args=clone(step.arguments);
    for(const binding of step.bindings){
      try{
        argumentTarget(args,binding.target);
        if(binding.from==='inputs'){
          const item=selected(request.inputs,binding.pointer);
          if(!item.present)issues.push({code:'CONSOLE_RECIPE_INPUT_REQUIRED',stepId:step.id,pointer:binding.pointer,
            message:'The actual input '+binding.pointer+' is required by '+step.name+'.'});
          else args=assign(args,binding.target,item.value);
        }
      }catch(error){issues.push({code:error.code??'CONSOLE_RECIPE_ARGUMENT_TARGET',stepId:step.id,pointer:binding.target,message:error.message});}
    }
    steps.push({id:step.id,name:step.name,tool:step.tool,arguments:args,bindings:step.bindings,expect:step.expect,pauseAfter:step.pauseAfter});
  }
  return seal({schema:WORKFLOW_RECIPE_REVIEW_SCHEMA,id:request.id,profileId:request.profileId,name:request.name,
    recipeSha256:recipe.contentSha256,profileRevision:revision(profile.revision),hostFingerprint,
    inputs:request.inputs,inputsSha256:digest(canonical(request.inputs)),acceptToolChanges:request.acceptToolChanges,
    tools,steps,issues,canInstall:issues.length===0});
}
const draftId=(workflowId,stepId)=>'recipe-draft-'+digest(canonical([workflowId,stepId])).slice(0,40);
const installationSummary=value=>({id:value.id,profileId:value.profileId,name:value.name,createdAt:value.createdAt,
  recipeSha256:value.recipeSha256,requestSha256:value.requestSha256,definitionRevision:value.definitionRevision,
  definitionSha256:value.definitionSha256,stepCount:value.recipe.steps.length,inputCount:value.recipe.inputs.length});

export function installWorkflowRecipeTables(db){
  db.exec('CREATE TABLE IF NOT EXISTS workflow_recipe_installs(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),value TEXT NOT NULL);'+
    'CREATE INDEX IF NOT EXISTS workflow_recipe_installs_profile ON workflow_recipe_installs(profile_id,id);');
}
export function archiveWorkflowRecipeRows(db,profileId){
  const installations=db.prepare('SELECT value FROM workflow_recipe_installs WHERE profile_id=? ORDER BY id').all(profileId).map(row=>JSON.parse(row.value));
  return installations.length?{schema:WORKFLOW_RECIPE_INSTALL_SCHEMA,installations}:undefined;
}
/** The complete profile must retain every recipe's exact first workflow and native draft editions. */
export function validateWorkflowRecipeRows(archive,{profile,drafts,workflowData}){
  if(archive===undefined)return undefined;
  fields(archive,['schema','installations'],'recipe receiving archive');
  need(archive.schema===WORKFLOW_RECIPE_INSTALL_SCHEMA&&Array.isArray(archive.installations)&&archive.installations.length<=10000,
    'CONSOLE_RECIPE_ARCHIVE','Receive complete original recipe installations.');
  const draftRows=new Map(drafts.map(row=>[row.id+':'+row.revision,row]));
  const definitions=new Map((workflowData?.definitions??[]).map(row=>[row.id+':'+row.revision,row]));
  const ids=new Set();
  for(const value of archive.installations){
    fields(value,['schema','id','profileId','workspaceId','name','createdAt','recipeSha256','requestSha256','request',
      'recipe','review','definitionId','definitionRevision','definitionSha256','drafts','contentSha256'],'saved recipe installation');
    id(value.id);id(value.workspaceId);label(value.name);
    need(value.schema===WORKFLOW_RECIPE_INSTALL_SCHEMA&&value.profileId===profile.id&&!ids.has(value.id)&&
      typeof value.createdAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)&&
      Number.isFinite(Date.parse(value.createdAt))&&new Date(value.createdAt).toISOString()===value.createdAt,
      'CONSOLE_RECIPE_ARCHIVE','Retain the original installation identity and creation time.');
    ids.add(value.id);
    const {contentSha256,...body}=value;
    need(digest(canonical(body))===sha(contentSha256),'CONSOLE_RECIPE_ARCHIVE_CHANGED','A saved recipe installation changed.');
    const recipe=normalizeWorkflowRecipe(value.recipe);
    fields(value.request,['id','profileId','name','recipeSha256','inputs','acceptToolChanges','expectedReviewSha256'],'saved recipe request');
    const {recipeSha256:originalRecipeSha256,...savedRequest}=value.request;
    const {request}=requestFrom({...savedRequest,recipe},{install:true});
    need(originalRecipeSha256===recipe.contentSha256,'CONSOLE_RECIPE_ARCHIVE_CHANGED','Retain the original recipe source digest.');
    need(same(request,value.request)&&value.id===request.id&&value.profileId===request.profileId&&value.name===request.name&&
      value.recipeSha256===recipe.contentSha256&&digest(canonical(request))===sha(value.requestSha256),
      'CONSOLE_RECIPE_ARCHIVE_CHANGED','Retain the complete original recipe request.');
    need(plain(value.review)&&Array.isArray(value.review.tools),'CONSOLE_RECIPE_ARCHIVE','Retain the full original native-contract review.');
    for(const tool of value.review.tools)need(plain(tool)&&plain(tool.currentDefinition)&&tool.currentDefinition.name===tool.name&&plain(tool.currentDefinition.inputSchema),
      'CONSOLE_RECIPE_ARCHIVE','Retain each installed current native tool definition.');
    const current=new Map(value.review.tools.map(tool=>[tool.name,tool.currentDefinition]));
    const reviewed=reviewFor(recipe,request,{profile:{revision:value.review.profileRevision,hostFingerprint:value.review.hostFingerprint},
      host:{configurationFingerprint:value.review.hostFingerprint},definitions:current});
    need(reviewed.canInstall&&same(reviewed,value.review)&&request.expectedReviewSha256===reviewed.contentSha256,
      'CONSOLE_RECIPE_ARCHIVE_CHANGED','The saved review must describe the installed original tool contracts and inputs.');
    const definition=definitions.get(value.definitionId+':'+value.definitionRevision);
    need(value.definitionId===value.id&&value.definitionRevision===1&&definition&&definition.name===value.name&&
      definition.contentSha256===sha(value.definitionSha256)&&Array.isArray(value.drafts)&&value.drafts.length===recipe.steps.length,
      'CONSOLE_RECIPE_ARCHIVE','Retain the complete original first workflow edition and all its drafts.');
    const steps=[];
    for(let index=0;index<recipe.steps.length;index++){
      const step=recipe.steps[index],reference=value.drafts[index];
      fields(reference,['stepId','id','revision','argumentsSha256','toolSchemaSha256'],'installed draft reference');
      need(reference.stepId===step.id&&reference.id===draftId(value.id,step.id)&&reference.revision===1,
        'CONSOLE_RECIPE_ARCHIVE_CHANGED','Keep each deterministic original recipe draft identity.');
      const draft=draftRows.get(reference.id+':1'),tool=current.get(step.tool);
      need(draft&&draft.profileId===profile.id&&draft.name===step.name&&draft.tool===step.tool&&draft.recoveryOf===undefined&&
        same(JSON.parse(draft.argumentsJson),step.arguments)&&draft.argumentsSha256===sha(reference.argumentsSha256)&&
        draft.toolSchemaSha256===sha(reference.toolSchemaSha256)&&draft.toolSchemaSha256===digest(canonical(tool)),
        'CONSOLE_RECIPE_ARCHIVE_CHANGED','Keep each full original installed native request.');
      steps.push({id:step.id,name:step.name,draftId:draft.id,draftRevision:1,bindings:step.bindings,expect:step.expect,pauseAfter:step.pauseAfter});
    }
    need(same(definition.steps,steps),'CONSOLE_RECIPE_ARCHIVE_CHANGED','The original workflow differs from its recipe installation.');
  }
  return clone(archive);
}
export function importWorkflowRecipeRows(db,value){
  if(value===undefined)return;
  for(const installation of value.installations){
    const prior=db.prepare('SELECT value FROM workflow_recipe_installs WHERE id=?').get(installation.id);
    if(prior)need(same(JSON.parse(prior.value),installation),'CONSOLE_RECIPE_IMPORT_CONFLICT',
      'This recipe installation identifier has different original source or review.',409);
    else db.prepare('INSERT INTO workflow_recipe_installs VALUES(?,?,?)').run(installation.id,installation.profileId,JSON.stringify(installation));
  }
}

export function createMerchantWorkflowRecipes({store,definitions,getHost,requireTool,requireOpen=()=>{}}){
  const workflows=new WorkflowRecords(store);
  const read=idValue=>{
    const row=store.db.prepare('SELECT value FROM workflow_recipe_installs WHERE id=?').get(id(idValue));
    if(!row)throw fail('CONSOLE_RECIPE_INSTALL_NOT_FOUND','Choose a saved recipe installation.',404);
    return JSON.parse(row.value);
  };
  async function authorize(recipe,inputs,context){
    for(const step of recipe.steps){
      let args=clone(step.arguments);
      for(const binding of step.bindings)if(binding.from==='inputs'){
        const input=selected(inputs,binding.pointer);
        if(input.present)try{args=assign(args,binding.target,input.value);}catch{}
      }
      await requireTool(context,step.tool,args);
    }
  }
  async function view(value,context){
    await authorize(value.recipe,value.request.inputs,context);
    // Original draft contracts remain readable even if this host's installed native contract changed.
    const definition=workflows.definition(value.definitionId,value.definitionRevision);
    return {installation:value,definition,runInputs:clone(value.request.inputs),reused:true,
      currentDefinitionRevision:workflows.definition(value.definitionId).revision};
  }
  return {
    async export(input,context){
      fields(input,['id','revision','name','description','inputs'],'recipe export');
      const definition=workflows.definition(id(input.id),input.revision===undefined?undefined:revision(input.revision));
      const steps=[];
      for(const step of definition.steps){
        const draft=store.draft(step.draftId,step.draftRevision),current=definitions.get(draft.tool);
        await requireTool(context,draft.tool,JSON.parse(draft.argumentsJson));
        need(current&&digest(canonical(current))===draft.toolSchemaSha256,'CONSOLE_RECIPE_SOURCE_CONTRACT',
          'Reopen '+draft.name+' and save its reviewed current native tool contract before recipe export.',409);
        const {draftId,draftRevision,...structure}=step;
        steps.push({...structure,tool:draft.tool,definition:clone(current),arguments:JSON.parse(draft.argumentsJson)});
      }
      const recipe=sealWorkflowRecipe({schema:WORKFLOW_RECIPE_SCHEMA,name:input.name??definition.name,
        description:input.description??'',source:{workspaceId:store.id,profileId:definition.profileId,
          workflowId:definition.id,workflowRevision:definition.revision,workflowSha256:definition.contentSha256},
        inputs:input.inputs??inferredInputs(steps),steps});
      return {recipe};
    },
    async review(input,context){
      const {recipe,request}=requestFrom(input);
      store.profile(request.profileId);
      await authorize(recipe,request.inputs,context);requireOpen();
      return {recipe,review:reviewFor(recipe,request,{profile:store.profile(request.profileId),host:getHost(),definitions})};
    },
    async install(input,context){
      const {recipe,request}=requestFrom(input,{install:true}),requestSha256=digest(canonical(request));
      let prior;try{prior=read(request.id);}catch(error){if(error.code!=='CONSOLE_RECIPE_INSTALL_NOT_FOUND')throw error;}
      if(prior){
        need(prior.requestSha256===requestSha256,'CONSOLE_RECIPE_INSTALL_CONFLICT',
          'That workflow identifier already belongs to a different original recipe installation.',409);
        return view(prior,context);
      }
      store.profile(request.profileId);
      await authorize(recipe,request.inputs,context);requireOpen();
      const {expectedReviewSha256,...reviewRequest}=request;
      const review=reviewFor(recipe,reviewRequest,{profile:store.profile(request.profileId),host:getHost(),definitions});
      need(review.canInstall,'CONSOLE_RECIPE_REVIEW_REQUIRED','Resolve the complete recipe review before saving its workflow.',409);
      need(review.contentSha256===expectedReviewSha256,'CONSOLE_RECIPE_REVIEW_CHANGED',
        'The target profile, host, native contracts or inputs changed. Review the complete recipe again.',409);
      const result=store.transaction(()=>{
        requireOpen();
        const existing=store.db.prepare('SELECT value FROM workflow_recipe_installs WHERE id=?').get(request.id);
        if(existing){
          const value=JSON.parse(existing.value);
          need(value.requestSha256===requestSha256,'CONSOLE_RECIPE_INSTALL_CONFLICT','Retain the original recipe installation request.',409);
          return {value,reused:true};
        }
        let found;try{found=workflows.definition(request.id);}catch(error){if(error.code!=='CONSOLE_WORKFLOW_NOT_FOUND')throw error;}
        need(!found,'CONSOLE_RECIPE_INSTALL_CONFLICT','Choose a new workflow identifier for this recipe installation.',409);
        const finalReview=reviewFor(recipe,reviewRequest,{profile:store.profile(request.profileId),host:getHost(),definitions});
        need(finalReview.contentSha256===review.contentSha256,'CONSOLE_RECIPE_REVIEW_CHANGED','Review the current target before installation.',409);
        const drafts=[],steps=[];
        for(const step of recipe.steps){
          const nativeId=draftId(request.id,step.id);
          need(!store.db.prepare('SELECT 1 FROM drafts WHERE id=? LIMIT 1').get(nativeId),
            'CONSOLE_RECIPE_INSTALL_CONFLICT','An original saved request already uses this installation identifier.',409);
          const draft=store.saveDraft({id:nativeId,profileId:request.profileId,name:step.name,tool:step.tool,arguments:clone(step.arguments)},definitions.get(step.tool));
          drafts.push({stepId:step.id,id:draft.id,revision:draft.revision,argumentsSha256:draft.argumentsSha256,toolSchemaSha256:draft.toolSchemaSha256});
          steps.push({id:step.id,name:step.name,draftId:draft.id,draftRevision:draft.revision,
            bindings:step.bindings,expect:step.expect,pauseAfter:step.pauseAfter});
        }
        const saved=workflows.save({id:request.id,profileId:request.profileId,name:request.name,steps});
        const value=seal({schema:WORKFLOW_RECIPE_INSTALL_SCHEMA,id:request.id,profileId:request.profileId,workspaceId:store.id,
          name:request.name,createdAt:now(),recipeSha256:recipe.contentSha256,requestSha256,request,recipe,review,
          definitionId:saved.definition.id,definitionRevision:saved.definition.revision,definitionSha256:saved.definition.contentSha256,drafts});
        store.db.prepare('INSERT INTO workflow_recipe_installs VALUES(?,?,?)').run(value.id,value.profileId,JSON.stringify(value));
        return {value,reused:false};
      });
      return {...await view(result.value,context),reused:result.reused};
    },
    async installation(id,context){return view(read(id),context);},
    async list(profileId,context){
      store.profile(profileId);
      const records=store.db.prepare('SELECT value FROM workflow_recipe_installs WHERE profile_id=? ORDER BY id').all(profileId).map(row=>JSON.parse(row.value));
      const installations=[];
      for(const value of records){
        await authorize(value.recipe,value.request.inputs,context);
        installations.push({...installationSummary(value),currentDefinitionRevision:workflows.definition(value.id).revision});
      }
      return {installations,limits:{recipeBytes:MAX_WORKFLOW_RECIPE_BYTES,requestBytes:MAX_WORKFLOW_RECIPE_REQUEST_BYTES}};
    }
  };
}
