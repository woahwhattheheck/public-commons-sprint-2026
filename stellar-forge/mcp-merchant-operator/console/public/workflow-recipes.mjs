// MIT. Portable workflow recipes over the original native console and action store.
const RECIPE_SCHEMA='stellar-forge.merchant-workflow-recipe.v1';
const REVIEW_SCHEMA='stellar-forge.merchant-workflow-recipe-review.v1';
const INSTALL_SCHEMA='stellar-forge.merchant-workflow-recipe-install.v1';
const INTENT='recipe-install';
const MAX_RECIPE_BYTES=16*1024*1024;
const MAX_REQUEST_BYTES=32*1024*1024;
const encoder=new TextEncoder();
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const ordered=value=>Array.isArray(value)?value.map(ordered):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const copy=value=>JSON.parse(JSON.stringify(value));
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(ordered(value)))))]
  .map(value=>value.toString(16).padStart(2,'0')).join('');
const recipeId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function parseObject(value,label,maximum=MAX_REQUEST_BYTES){
  if(encoder.encode(value).length>maximum)throw new Error(label+' exceeds '+Math.floor(maximum/1024/1024)+' MiB.');
  let result;try{result=JSON.parse(value);}catch(error){throw new Error(label+' must be complete JSON: '+error.message);}
  if(!plain(result))throw new Error(label+' must be a JSON object.');
  return result;
}
function parseRecipe(value){
  const recipe=parseObject(value,'Workflow recipe',MAX_RECIPE_BYTES);
  if(recipe.schema!==RECIPE_SCHEMA||!recipeId(recipe.contentSha256)||!Array.isArray(recipe.inputs)||!Array.isArray(recipe.steps))
    throw new Error('Load a complete exported workflow recipe with its original schema, steps, inputs and content digest.');
  return recipe;
}
function recipeText(recipe){
  const readable=JSON.stringify(recipe,null,2)+'\n';
  return encoder.encode(readable).length<=MAX_RECIPE_BYTES?readable:JSON.stringify(recipe);
}
function requestBytes(body){
  if(encoder.encode(JSON.stringify(body)).length>MAX_REQUEST_BYTES)
    throw new Error('The complete recipe request exceeds 32 MiB. Reduce this recipe or its supplied inputs before reviewing.');
}
export function createWorkflowRecipes({
  state,$,node,text,pretty,when,tag,properties,selectionList,action,busy,api,notice,uid,requireProfile,loadProfile,
  context,current,intentRecord,markAttempt,releaseIntent,mutate,mutationActive,openDefinition,getSelection,selectionCurrent,prefillInputs
}){
  const ui={},models=new Map();let model=null,identity=null,session=null,refreshSeq=0,openingSeq=0;
  function create(name,id,value,className){const valueNode=node(name,value,className);if(id){valueNode.id=id;ui[id]=valueNode;}return valueNode;}
  function button(id,label,fn){const value=create('button',id,label);value.type='button';action(value,fn);return value;}
  function field(parent,id,label,{area=false,rows=4,value='',maxLength,placeholder}={}){
    const labelNode=node('label',label),input=create(area?'textarea':'input',id);labelNode.htmlFor=id;
    if(area){input.rows=rows;input.spellcheck=false;input.className='code-input workflow-json';}
    if(maxLength)input.maxLength=maxLength;if(placeholder)input.placeholder=placeholder;input.value=value;
    parent.append(labelNode,input);return input;
  }
  function table(parent,id,headings){
    const wrap=node('div',undefined,'table-wrap'),value=node('table'),head=node('thead'),row=node('tr'),body=create('tbody',id);
    row.append(...headings.map(value=>node('th',value)));head.append(row);value.append(head,body);wrap.append(value);parent.append(wrap);return body;
  }
  function details(label,produce){
    const value=node('details');value.append(node('summary',label));let loaded=false;
    value.addEventListener('toggle',()=>{if(value.open&&!loaded){loaded=true;value.append(produce());}});
    return value;
  }
  const page=$('page-workflows'),header=page.querySelector('.section-heading .actions');
  const launcher=button('workflow-recipes-open','Recipes',()=>show());header.append(launcher);
  const panel=create('section','workflow-recipe-panel',undefined,'panel');panel.hidden=true;
  const heading=node('div',undefined,'section-heading'),headingText=node('div');
  headingText.append(node('p','Reusable native workflows','eyebrow'),node('h3','Workflow recipes'));
  heading.append(headingText,button('workflow-recipe-close','Close recipes',()=>{panel.hidden=true;}));
  panel.append(heading,node('p','Export a saved definition, review it against this profile’s configured native tools, and save a new workflow. Run the saved workflow through the existing Workflows controls.'));
  const pending=create('section','workflow-recipe-pending',undefined,'subsection');pending.hidden=true;
  pending.append(node('h4','Recover the original installation'),create('p','workflow-recipe-pending-id',undefined,'mono break'),
    node('p','The complete recipe, reviewed inputs and exact installation request are retained for this workspace and profile.'),
    button('workflow-recipe-recover','Recover original installation',()=>mutate(()=>install(true))),
    details('Complete retained installation request and review',()=>create('pre','workflow-recipe-pending-json',pretty({
      body:model?.pending?.body,review:model?.pending?.review
    }))));
  panel.append(pending);
  const exportSection=create('details','workflow-recipe-export-section');exportSection.append(node('summary','Export the selected saved workflow'));
  exportSection.append(create('p','workflow-recipe-export-selection',undefined,'hint'));
  field(exportSection,'workflow-recipe-export-name','Recipe name',{maxLength:160});
  field(exportSection,'workflow-recipe-export-description','Description',{area:true,rows:3,maxLength:8000});
  const advanced=node('details');advanced.append(node('summary','Input declarations'));
  advanced.append(node('p','Leave this empty to derive declarations from the saved workflow’s input mappings. To name and describe those inputs, supply the complete declarations returned by Prepare recipe. Defaults are explicit recipe values.'));
  field(advanced,'workflow-recipe-export-inputs','Declarations (JSON array)',{area:true,rows:7,placeholder:'Optional complete input declarations'});
  exportSection.append(advanced);
  const exportActions=node('div',undefined,'actions');
  exportActions.append(button('workflow-recipe-export-prepare','Prepare recipe',()=>prepareExport()),
    button('workflow-recipe-export-download','Download complete recipe',()=>downloadRecipe()),
    button('workflow-recipe-export-use','Use prepared recipe here',()=>useExport()));
  exportSection.append(exportActions,create('p','workflow-recipe-export-result',undefined,'hint break'));
  panel.append(exportSection);
  const intake=create('section','workflow-recipe-intake',undefined,'subsection');intake.append(node('h4','Load a complete recipe'));
  const fileLabel=node('label','Recipe file'),file=create('input','workflow-recipe-file');file.type='file';file.accept='.json,application/json';fileLabel.htmlFor=file.id;
  intake.append(fileLabel,file,node('p','The original UTF-8 JSON file can be up to 16 MiB.','hint'));
  const rawSource=node('details');rawSource.append(node('summary','Complete recipe JSON'));
  field(rawSource,'workflow-recipe-json','Recipe JSON',{area:true,rows:12});
  rawSource.append(button('workflow-recipe-load','Load recipe JSON',()=>loadText()));
  intake.append(rawSource,create('p','workflow-recipe-source',undefined,'hint break'));
  const definitionSummary=create('div','workflow-recipe-summary');intake.append(definitionSummary);
  field(intake,'workflow-recipe-name','New workflow name',{maxLength:160});
  const declarations=create('section','workflow-recipe-declarations',undefined,'subsection');declarations.hidden=true;
  declarations.append(node('h4','Declared inputs'));table(declarations,'workflow-recipe-input-declarations',['Input','Pointer','Type','Required','Declared default']);
  intake.append(declarations);
  field(intake,'workflow-recipe-inputs','Inputs for this workflow (JSON object)',{area:true,rows:7,value:'{}'});
  intake.append(node('p','Enter the values this profile should use. The native review applies only defaults declared in the recipe and shows the effective inputs and resolved step arguments.','hint'));
  const intakeActions=node('div',undefined,'actions');intakeActions.append(
    button('workflow-recipe-review','Review current host and inputs',()=>review()),
    button('workflow-recipe-install','Save as native workflow',()=>mutate(()=>install(false))));
  intake.append(intakeActions);
  panel.append(intake);
  const reviewSection=create('section','workflow-recipe-review-section',undefined,'subsection');reviewSection.hidden=true;
  reviewSection.append(node('h4','Native review'),create('p','workflow-recipe-review-status'),
    create('dl','workflow-recipe-review-properties',undefined,'properties'),create('div','workflow-recipe-issues'));
  reviewSection.append(node('h4','Tool contracts'),create('div','workflow-recipe-tools'));
  reviewSection.append(node('h4','Resolved native steps'));
  table(reviewSection,'workflow-recipe-steps',['Order','Step','Native tool','Prepared arguments and conditions']);
  reviewSection.append(details('Complete reviewed inputs',()=>create('pre','workflow-recipe-effective-inputs',pretty(model?.review?.review.inputs??{}))));
  panel.append(reviewSection);
  const accepted=create('section','workflow-recipe-accepted',undefined,'subsection');accepted.hidden=true;
  accepted.append(node('h4','Saved workflow'),create('p','workflow-recipe-accepted-summary'),
    create('dl','workflow-recipe-accepted-properties',undefined,'properties'));
  const acceptedActions=node('div',undefined,'actions');acceptedActions.append(
    button('workflow-recipe-open-installed','Open saved workflow',()=>openSaved()),
    button('workflow-recipe-new-copy','Prepare another workflow from this recipe',()=>newCopy()));
  accepted.append(acceptedActions);panel.append(accepted);
  const installations=node('details');installations.append(node('summary','Installed recipes in this profile'),
    create('p','workflow-recipe-list-status',undefined,'hint'),create('div','workflow-recipe-installations',undefined,'select-list'));
  panel.append(installations);
  page.insertBefore(panel,page.querySelector('.request-layout'));
  const exportButton=button('workflow-recipe-export-current','Export as recipe',()=>{show();exportSection.open=true;ui['workflow-recipe-export-name'].focus();});
  $('workflow-save').parentElement.append(exportButton);
  const values=()=>({
    recipeText:ui['workflow-recipe-json'].value,name:ui['workflow-recipe-name'].value,
    inputsText:ui['workflow-recipe-inputs'].value,exportName:ui['workflow-recipe-export-name'].value,
    exportDescription:ui['workflow-recipe-export-description'].value,exportInputs:ui['workflow-recipe-export-inputs'].value
  });
  function fresh(){return {
    recipe:null,recipeText:'',name:'',inputsText:'{}',id:uid(),acceptToolChanges:[],review:null,reviewVersion:null,
    version:0,loadSeq:0,reviewSeq:0,list:[],listError:null,pending:null,pendingViewBody:null,intentReady:false,pendingAnnounced:false,
    installation:null,installing:false,exportName:'',exportDescription:'',exportInputs:'',exportRecipe:null,exportVersion:0,
    exportSelected:null,exportSeq:0,exporting:false,reviewing:false
  };}
  function remember(){if(model)Object.assign(model,values());}
  function show(){profileChanged();panel.hidden=false;panel.scrollIntoView({block:'nearest'});}
  function writeForm(){
    if(!model)return;
    for(const [id,key]of [['workflow-recipe-json','recipeText'],['workflow-recipe-name','name'],['workflow-recipe-inputs','inputsText'],
      ['workflow-recipe-export-name','exportName'],['workflow-recipe-export-description','exportDescription'],['workflow-recipe-export-inputs','exportInputs']])
      ui[id].value=model[key];
    file.value='';renderSource();renderReview();renderPending();renderAccepted();renderList();renderExport();
  }
  function profileChanged(){
    const ctx=context(),key=ctx.workspaceId&&ctx.profileId?[ctx.workspaceId,ctx.profileId].join('/'):null;
    if(identity!==key||session!==ctx.session){
      remember();identity=key;session=ctx.session;refreshSeq++;openingSeq++;
      model=key?(models.get(key)??fresh()):null;if(key&&!models.has(key))models.set(key,model);
      if(model){model.intentReady=false;writeForm();}
      else{panel.hidden=true;for(const id of ['workflow-recipe-summary','workflow-recipe-tools','workflow-recipe-steps','workflow-recipe-input-declarations','workflow-recipe-installations'])ui[id].replaceChildren();}
    }
    syncSelection();sync();
  }
  function reset(){remember();identity=null;session=null;model=null;refreshSeq++;openingSeq++;panel.hidden=true;sync();}
  function invalidate(){
    if(!model)return;remember();model.version++;model.reviewSeq++;renderReview();sync();
  }
  function syncSelection(){
    if(!model)return;const selection=getSelection();
    const key=selection.id&&selection.revision?selection.id+'/'+selection.revision:null;
    if(model.exportSelected!==key){
      model.exportSelected=key;model.exportSeq++;model.exportVersion++;model.exportRecipe=null;
      model.exportName=selection.name??'';model.exportDescription='';model.exportInputs='';
      ui['workflow-recipe-export-name'].value=model.exportName;ui['workflow-recipe-export-description'].value='';ui['workflow-recipe-export-inputs'].value='';
      renderExport();
    }
    text(ui['workflow-recipe-export-selection'],selection.id?
      selection.name+' · revision '+selection.revision+(selection.dirty?' · save the current edits before exporting':''):
      'Open a saved workflow to export its original definition and native request contracts.');
  }
  function renderSource(){
    const recipe=model?.recipe,summary=ui['workflow-recipe-summary'];summary.replaceChildren();
    ui['workflow-recipe-declarations'].hidden=!recipe;
    text(ui['workflow-recipe-source'],recipe?recipe.name+' · '+recipe.steps.length+' steps · '+recipe.contentSha256:'Load an exported recipe to prepare a new native workflow.');
    ui['workflow-recipe-input-declarations'].replaceChildren();
    if(!recipe)return;
    if(recipe.description)summary.append(node('p',recipe.description));
    const identity=node('dl',undefined,'properties');
    properties(identity,[['Original workflow',recipe.source?.workflowId,true],['Original revision',recipe.source?.workflowRevision],
      ['Source profile',recipe.source?.profileId,true],['Recipe SHA-256',recipe.contentSha256,true]]);
    summary.append(details('Original source and complete recipe',()=>{const box=node('div');box.append(identity,node('pre',pretty(recipe)));return box;}));
    for(const input of recipe.inputs){
      const row=node('tr'),label=node('td',input.label??input.pointer);
      if(input.description)label.append(node('p',input.description,'hint'));
      row.append(label,node('td',input.pointer===''?'(complete inputs object)':input.pointer,'mono break'),node('td',input.type),
        node('td',input.required===false?'Optional':'Required'),
        node('td',Object.hasOwn(input,'default')?pretty(input.default):'—','mono break'));
      ui['workflow-recipe-input-declarations'].append(row);
    }
    if(!recipe.inputs.length){const row=node('tr'),cell=node('td','This recipe declares no workflow input mappings.');cell.colSpan=5;row.append(cell);ui['workflow-recipe-input-declarations'].append(row);}
  }
  function renderExport(){
    const prepared=model?.exportRecipe;
    text(ui['workflow-recipe-export-result'],prepared?'Prepared '+prepared.name+' · '+prepared.steps.length+' steps · '+prepared.contentSha256:'');
  }
  function renderPending(){
    const retained=model?.pending;pending.hidden=!retained;
    text(ui['workflow-recipe-pending-id'],retained?retained.body.id+' · '+retained.body.name+' · '+retained.body.recipe.contentSha256:'');
    const complete=ui['workflow-recipe-pending-json'];if(complete)text(complete,pretty(retained?{body:retained.body,review:retained.review}:{}));
    if(retained&&!model.pendingAnnounced){model.pendingAnnounced=true;panel.hidden=false;}
    text(launcher,retained?'Recipes · installation pending':'Recipes');
  }
  function renderReview(){
    const selected=model?.review,reviewed=selected?.review;reviewSection.hidden=!reviewed;
    if(!reviewed)return;
    const fresh=model.reviewVersion===model.version&&reviewed.profileRevision===state.profile?.revision&&reviewed.hostFingerprint===state.host?.configurationFingerprint;
    text(ui['workflow-recipe-review-status'],model.pending?'This is the retained original review. Recovery reads or replays its exact saved installation request.':!fresh?'The recipe, inputs, profile or contract choices changed. Review the current host again.':
      reviewed.canInstall?'Review complete. Save the prepared native drafts and workflow when these inputs and tool contracts are correct.':
      'Resolve the listed input or native tool issues, then review again.');
    const hostCurrent=reviewed.hostFingerprint===state.host?.configurationFingerprint;
    properties(ui['workflow-recipe-review-properties'],[
      ['New workflow',reviewed.name],['Target profile',reviewed.profileId,true],['Profile revision',reviewed.profileRevision],
      ['Configured host',state.host?.merchant??''],['Current profile matches review',reviewed.profileRevision===state.profile?.revision?'Yes':'Review the current profile again'],['Current host matches review',hostCurrent?'Yes':'Review the current host again'],
      ['Host binding',reviewed.hostFingerprint,true],['Review SHA-256',reviewed.contentSha256,true]
    ]);
    const issues=ui['workflow-recipe-issues'];issues.replaceChildren();
    if(reviewed.issues?.length){
      const list=node('ul');
      for(const issue of reviewed.issues)list.append(node('li',[issue.stepId,issue.tool,issue.pointer,issue.code,issue.message].filter(value=>value!==undefined&&value!=='').join(' · ')));
      issues.append(list);
    }
    const tools=ui['workflow-recipe-tools'];tools.replaceChildren();
    for(const contract of reviewed.tools){
      const section=node('section',undefined,'workflow-step'),heading=node('div',undefined,'section-heading'),title=node('strong',contract.name);
      heading.append(title,tag(contract.status));section.append(heading);
      if(contract.status==='CHANGED'){
        section.append(node('p',contract.changeCount+' native contract changes. Inspect the changes and explicitly select acceptance before reviewing again.'));
        const label=node('label',undefined,'checkbox'),checkbox=node('input');checkbox.type='checkbox';
        checkbox.dataset.recipeAcceptTool=contract.name;checkbox.checked=model.acceptToolChanges.includes(contract.name);
        checkbox.disabled=Boolean(model.pending)||model.installing;
        checkbox.addEventListener('change',()=>{
          const choices=new Set(model.acceptToolChanges);if(checkbox.checked)choices.add(contract.name);else choices.delete(contract.name);
          model.acceptToolChanges=[...choices].sort();invalidate();
        });
        label.append(checkbox,node('span','Accept the displayed contract changes for '+contract.name));section.append(label);
      }else if(contract.status==='MISSING')section.append(node('p','This native tool is absent from the configured host. Configure the corresponding provider or load a compatible complete recipe, then review again.'));
      else section.append(node('p','The saved and configured native tool contracts match.','hint'));
      section.append(details('Native contract changes and complete definitions',()=>{
        const box=node('div');
        if(contract.changes?.length){
          const changes=node('table'),head=node('thead'),row=node('tr');row.append(node('th','Field'),node('th','Recipe contract'),node('th','Current native contract'));head.append(row);changes.append(head);
          const body=node('tbody');
          for(const change of contract.changes){const row=node('tr');row.append(node('td',change.pointer||'(complete definition)','mono break'),
            node('td',change.beforePresent===false?'(absent)':pretty(change.before),'mono break'),node('td',change.afterPresent===false?'(absent)':pretty(change.after),'mono break'));body.append(row);}
          changes.append(body);const wrap=node('div',undefined,'table-wrap');wrap.append(changes);box.append(wrap);
          if(contract.changeCount>contract.changes.length)box.append(node('p','Showing the first '+contract.changes.length+' of '+contract.changeCount+' changes. Both complete native definitions are retained below.','hint'));
        }
        box.append(node('h5','Recipe definition'),node('pre',pretty(contract.sourceDefinition)),
          node('h5','Configured native definition'),node('pre',pretty(contract.currentDefinition)));return box;
      }));
      tools.append(section);
    }
    ui['workflow-recipe-steps'].replaceChildren();
    for(const [index,step]of reviewed.steps.entries()){
      const row=node('tr'),detail=node('td');
      detail.append(details('Inspect prepared request',()=>node('pre',pretty({arguments:step.arguments,bindings:step.bindings,
        expect:step.expect,pauseAfter:step.pauseAfter}))));
      row.append(node('td',String(index+1)),node('td',step.name+' · '+step.id),node('td',step.tool,'mono break'),detail);ui['workflow-recipe-steps'].append(row);
    }
    const effective=ui['workflow-recipe-effective-inputs'];if(effective)text(effective,pretty(reviewed.inputs));
  }
  function renderAccepted(){
    const packet=model?.installation,record=packet?.installation;accepted.hidden=!record;
    if(!record)return;
    text(ui['workflow-recipe-accepted-summary'],record.name+' is saved as workflow '+record.definitionId+
      ' · recipe revision '+record.definitionRevision+' · current revision '+packet.currentDefinitionRevision+'.');
    properties(ui['workflow-recipe-accepted-properties'],[
      ['Workflow',record.definitionId,true],['Saved',when(record.createdAt)],['Native requests',record.drafts.length],
      ['Recipe SHA-256',record.recipeSha256,true],['Installation request SHA-256',record.requestSha256,true]
    ]);
  }
  function renderList(){
    text(ui['workflow-recipe-list-status'],model?.listError??(model?.list.length?model.list.length+' installed recipes':''));
    selectionList(ui['workflow-recipe-installations'],model?.list??[],model?.installation?.installation.id,(button,value)=>{
      button.append(node('strong',value.name),node('p','Workflow '+value.id+' · original revision '+value.definitionRevision+' · '+when(value.createdAt)),
        node('p',value.recipeSha256,'mono hint break'));
    },value=>openInstallation(value.id),state.profile?'No recipe installations in this profile.':'Select a profile.');
  }
  function adoptRecipe(recipe,sourceText){
    if(!model?.intentReady)throw new Error('Let this profile’s original recipe action load first.');
    if(model.pending)throw new Error('Recover the retained original installation before replacing its recipe.');
    model.recipe=copy(recipe);model.recipeText=sourceText??recipeText(recipe);model.name=recipe.name;
    model.inputsText='{}';model.id=uid();model.acceptToolChanges=[];model.review=null;model.reviewVersion=null;
    model.installation=null;model.version++;model.reviewSeq++;
    writeForm();show();sync();
  }
  async function loadText(){
    requireProfile();remember();const recipe=parseRecipe(model.recipeText);adoptRecipe(recipe,model.recipeText);
    notice('Loaded complete recipe '+recipe.name+'. Review this profile’s inputs and native tool contracts.');
  }
  async function loadFile(){
    requireProfile();const ctx=context(),selectedModel=model,sequence=++selectedModel.loadSeq,selected=file.files?.[0];if(!selected)return;
    if(selected.size>MAX_RECIPE_BYTES)throw new Error('The complete recipe file exceeds 16 MiB.');
    const bytes=await selected.arrayBuffer();let source;
    try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('The complete recipe file must be valid UTF-8 JSON.');}
    const recipe=parseRecipe(source);
    if(!current(ctx)||model!==selectedModel||sequence!==selectedModel.loadSeq)return;
    adoptRecipe(recipe,source);notice('Loaded '+selected.name+' · '+recipe.steps.length+' native steps.');
  }
  async function prepareExport(){
    requireProfile();const ctx=context(),selectedModel=model,selection=getSelection(),version=model.exportVersion,sequence=++model.exportSeq;
    if(!selection.id||selection.dirty)throw new Error('Open a saved workflow revision before exporting a recipe.');
    remember();const body={id:selection.id,revision:selection.revision,name:model.exportName,description:model.exportDescription};
    if(model.exportInputs.trim()){
      let inputs;try{inputs=JSON.parse(model.exportInputs);}catch(error){throw new Error('Input declarations must be complete JSON: '+error.message);}
      if(!Array.isArray(inputs))throw new Error('Input declarations must be a JSON array.');body.inputs=inputs;
    }
    requestBytes(body);model.exporting=true;sync();
    try{
      const packet=await api('workflow-recipe-export',{method:'POST',body,epoch:ctx.session});
      if(!current(ctx)||model!==selectedModel||sequence!==model.exportSeq||version!==model.exportVersion||!selectionCurrent(selection))return;
      model.exportRecipe=parseRecipe(JSON.stringify(packet.recipe));renderExport();
      notice('Prepared complete recipe '+packet.recipe.name+'. Download it or review it in this profile.');
    }finally{selectedModel.exporting=false;if(current(ctx)&&model===selectedModel)sync();}
  }
  function downloadRecipe(){
    const recipe=model?.exportRecipe;if(!recipe)throw new Error('Prepare the selected saved workflow recipe first.');
    const bytes=recipeText(recipe),url=URL.createObjectURL(new Blob([bytes],{type:'application/json'})),link=node('a');
    link.href=url;link.download=(recipe.name.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'merchant-workflow')+'-recipe.json';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    notice('Downloaded '+link.download+' · complete recipe '+recipe.contentSha256+'.');
  }
  function useExport(){if(!model?.exportRecipe)throw new Error('Prepare a complete recipe first.');adoptRecipe(model.exportRecipe);}
  function reviewRequest(){
    remember();const profile=requireProfile();if(!model.recipe)throw new Error('Load a complete recipe first.');
    const recipe=parseRecipe(model.recipeText),inputs=parseObject(model.inputsText,'Workflow inputs');
    const name=model.name.trim();if(!name)throw new Error('Name the new native workflow.');
    const request={id:model.id,profileId:profile.id,name,recipe,inputs,acceptToolChanges:[...model.acceptToolChanges].sort()};requestBytes(request);return request;
  }
  async function review(){
    const ctx=context(),selectedModel=model;if(!model?.intentReady)throw new Error('Let this profile’s original recipe action load first.');
    if(model.pending)throw new Error('Recover the retained original installation before preparing another review.');
    const request=reviewRequest(),version=model.version,sequence=++model.reviewSeq;model.reviewing=true;sync();
    try{
      const packet=await api('workflow-recipe-review',{method:'POST',body:request,epoch:ctx.session});
      if(packet.review?.schema!==REVIEW_SCHEMA||packet.review.id!==request.id||packet.review.profileId!==request.profileId||
        packet.review.name!==request.name||packet.review.recipeSha256!==request.recipe.contentSha256||
        !equal(packet.review.acceptToolChanges,request.acceptToolChanges)||!plain(packet.review.inputs)||
        packet.review.inputsSha256!==await digest(packet.review.inputs)||!recipeId(packet.review.contentSha256)||
        parseRecipe(JSON.stringify(packet.recipe)).contentSha256!==request.recipe.contentSha256)
        throw new Error('The host returned a review for a different recipe request.');
      if(!current(ctx)||model!==selectedModel||version!==model.version||sequence!==model.reviewSeq)return;
      model.recipe=copy(packet.recipe);model.review={request,review:packet.review};model.reviewVersion=version;
      renderSource();renderReview();notice(packet.review.canInstall?'Review ready. Inspect the native contracts and prepared arguments, then save the workflow.':'The native review returned issues to resolve.');
    }finally{selectedModel.reviewing=false;if(current(ctx)&&model===selectedModel)sync();}
  }
  async function restoreIntent(ctx,selectedModel){
    const retained=await intentRecord(ctx,INTENT);
    if(!current(ctx)||model!==selectedModel)return;
    model.pending=retained;model.intentReady=true;
    if(retained&&(!model.recipe||!equal(model.pendingViewBody,retained.body))){
      model.pendingViewBody=copy(retained.body);
      const body=retained.body;model.recipe=copy(body.recipe);model.recipeText=recipeText(body.recipe);model.name=body.name;
      model.inputsText=pretty(body.inputs);model.id=body.id;model.acceptToolChanges=[...(body.acceptToolChanges??[])];
      model.review=retained.review?{request:copy(body),review:retained.review}:null;model.reviewVersion=null;model.version++;
      writeForm();
    }
    if(!retained)model.pendingViewBody=null;
    renderPending();sync();
  }
  async function matchesInstallation(packet,retained){
    const value=packet?.installation,body=retained.body,reviewed=retained.review;
    if(!value||value.schema!==INSTALL_SCHEMA||!reviewed||reviewed.contentSha256!==body.expectedReviewSha256)
      throw new Error('The original installation readback is missing its retained request or review.');
    const expected={id:body.id,profileId:body.profileId,name:body.name.trim(),recipeSha256:body.recipe.contentSha256,
      inputs:reviewed.inputs,acceptToolChanges:[...(body.acceptToolChanges??[])].sort(),expectedReviewSha256:body.expectedReviewSha256};
    if(value.id!==body.id||value.profileId!==body.profileId||!equal(value.request,expected)||
      value.requestSha256!==await digest(expected)||value.recipeSha256!==expected.recipeSha256||
      value.review?.contentSha256!==body.expectedReviewSha256||value.definitionId!==body.id)
      throw new Error('This ID belongs to a different saved recipe request. The retained original intent is available for inspection.');
    return packet;
  }
  async function reconcile(ctx,retained){
    const packet=await api('workflow-recipe-install/'+encodeURIComponent(retained.body.id),{epoch:ctx.session});
    return matchesInstallation(packet,retained);
  }
  async function install(recover){
    const profile=requireProfile(),ctx=context(),selectedModel=model,selection=getSelection();
    if(!model?.intentReady)throw new Error('Let this profile’s retained recipe action load first.');
    let retained;
    if(recover){retained=await intentRecord(ctx,INTENT);if(!retained)throw new Error('There is no retained original recipe installation.');}
    else{
      if(model.pending)throw new Error('Recover the displayed original installation first.');
      if(!model.review||model.reviewVersion!==model.version||!model.review.review.canInstall)
        throw new Error('Review the current recipe, inputs and native tool contracts first.');
      if(model.review.review.hostFingerprint!==state.host?.configurationFingerprint||model.review.review.profileRevision!==state.profile?.revision)
        throw new Error('The configured host or profile changed. Review the current target again.');
      const body={...copy(model.review.request),expectedReviewSha256:model.review.review.contentSha256};
      if(body.profileId!==profile.id)throw new Error('Review this recipe in the selected profile.');
      requestBytes(body);
      retained=await intentRecord(ctx,INTENT,old=>old??{kind:INTENT,body,review:copy(model.review.review),attempts:0,createdAt:new Date().toISOString()});
      if(!current(ctx)||model!==selectedModel)return;
      model.pending=retained;renderPending();sync();
      if(!equal(retained.body,body)){
        await restoreIntent(ctx,selectedModel);
        if(current(ctx)&&model===selectedModel)notice('Another tab retained the displayed original installation. Use Recover original installation to continue that exact request.');
        return;
      }
    }
    selectedModel.installing=true;if(current(ctx)&&model===selectedModel){model.pending=retained;renderPending();sync();}
    let result,attempt;
    try{
      // A read can finish an interrupted saved installation without replaying a mutation.
      if(recover){
        try{result=await reconcile(ctx,retained);}
        catch(error){if(error.status!==404)throw error;}
      }
      if(!result){
        attempt=await markAttempt(ctx,INTENT,retained.body);
        if(!current(ctx)||model!==selectedModel)return;
        try{
          const packet=await api('workflow-recipe-install',{method:'POST',body:retained.body,epoch:ctx.session});
          result=await matchesInstallation(packet,retained);
        }catch(error){
          try{result=await reconcile(ctx,retained);}catch{}
          if(!result){
            if(!attempt.prior&&error.status>=400&&error.status<500){
              await releaseIntent(ctx,INTENT,retained.body,attempt);
              if(current(ctx)&&model===selectedModel){
                await restoreIntent(ctx,selectedModel);model.reviewVersion=null;model.version++;renderReview();
                notice('The original host rejected this installation. Your recipe and inputs remain editable; review the current profile before saving again.',true);
              }
            }
            throw error;
          }
        }
      }
      await releaseIntent(ctx,INTENT,retained.body);
      selectedModel.pending=null;selectedModel.installation=result;selectedModel.pendingAnnounced=false;
      if(!current(ctx)||model!==selectedModel)return;
      await restoreIntent(ctx,selectedModel);renderAccepted();renderPending();sync();
      await loadProfile();
      if(!current(ctx)||model!==selectedModel)return;
      if(selectionCurrent(selection))await openDefinition(result.installation.definitionId);
      if(current(ctx)&&model===selectedModel)notice((result.reused?'Recovered':'Saved')+' native workflow '+result.installation.name+'. Open its saved definition and run it when ready.');
    }finally{selectedModel.installing=false;if(current(ctx)&&model===selectedModel)sync();}
  }
  async function openInstallation(id){
    requireProfile();const ctx=context(),selectedModel=model,sequence=++openingSeq;
    const packet=await api('workflow-recipe-install/'+encodeURIComponent(id),{epoch:ctx.session});
    if(!current(ctx)||model!==selectedModel||sequence!==openingSeq)return;
    model.installation=packet;renderAccepted();renderList();show();notice('Opened the original recipe installation for '+packet.installation.name+'.');
  }
  async function openSaved(){
    const packet=model?.installation;if(!packet)throw new Error('Open a saved recipe installation first.');
    const ctx=context(),selectedModel=model,selection=getSelection();await loadProfile();
    if(current(ctx)&&model===selectedModel&&selectionCurrent(selection))await openDefinition(packet.installation.definitionId);
  }
  function newCopy(){
    requireProfile();if(model.pending)throw new Error('Recover the retained original installation first.');
    const selected=model.installation?.installation.recipe??model.recipe;
    if(!selected)throw new Error('Load an original recipe first.');
    const inputs=model.installation?.runInputs??parseObject(ui['workflow-recipe-inputs'].value,'Workflow inputs');
    adoptRecipe(selected);model.inputsText=pretty(inputs);ui['workflow-recipe-inputs'].value=model.inputsText;model.name=selected.name;
    ui['workflow-recipe-name'].focus();notice('Prepared a new workflow identity. Review its current native contracts and inputs before saving.');
  }
  async function prefillDefinition(definition,selection){
    const ctx=context();let packet;
    try{packet=await api('workflow-recipe-install/'+encodeURIComponent(definition.id),{epoch:ctx.session});}
    catch(error){
      if(error.status!==404&&current(ctx)&&selectionCurrent(selection))
        notice('The saved workflow is open. Its recipe input readback could not be loaded: '+error.message,true);
      return;
    }
    if(!current(ctx)||!selectionCurrent(selection))return;
    const installed=packet.installation;
    if(installed?.definitionId!==definition.id||installed.definitionRevision!==definition.revision||
      installed.definitionSha256!==definition.contentSha256)return;
    prefillInputs(packet.runInputs,selection);
  }
  async function refresh(){
    profileChanged();const ctx=context(),selectedModel=model;if(!selectedModel)return;const sequence=++refreshSeq;
    const outcomes=await Promise.allSettled([
      restoreIntent(ctx,selectedModel),
      api('workflow-recipes?'+new URLSearchParams({profile:ctx.profileId}),{epoch:ctx.session})
    ]);
    if(!current(ctx)||model!==selectedModel||sequence!==refreshSeq)return;
    if(outcomes[0].status==='rejected'){model.intentReady=false;notice('The original recipe intent could not be opened: '+outcomes[0].reason.message,true);}
    if(outcomes[1].status==='fulfilled'){
      model.list=outcomes[1].value.installations;model.listError=null;
      model.limits=outcomes[1].value.limits;
    }else model.listError='Installed recipes could not be refreshed: '+outcomes[1].reason.message;
    renderPending();renderList();sync();
  }
  function sync(){
    const ctx=context(),selected=Boolean(state.profile&&model&&identity===[ctx.workspaceId,ctx.profileId].join('/')&&session===ctx.session),
      ready=selected&&Boolean(model?.intentReady),selection=getSelection(),pending=Boolean(model?.pending),
      writing=Boolean(model?.installing)||mutationActive(),reviewed=model?.review?.review;
    panel.dataset.profileId=selected?ctx.profileId:'';
    panel.dataset.intentReady=String(ready);
    panel.setAttribute('aria-busy',String(Boolean(selected&&(!ready||writing||model?.reviewing||model?.exporting))));
    syncSelection();
    launcher.disabled=!selected;exportButton.disabled=!selected||!selection.id||selection.dirty;
    for(const id of ['workflow-recipe-file','workflow-recipe-json','workflow-recipe-load','workflow-recipe-name','workflow-recipe-inputs'])
      ui[id].disabled=!ready||pending||writing;
    ui['workflow-recipe-review'].disabled=!ready||!model?.recipe||pending||writing||Boolean(model?.reviewing);
    ui['workflow-recipe-install'].disabled=!selected||!model?.intentReady||pending||writing||!reviewed?.canInstall||
      model?.reviewVersion!==model?.version||reviewed?.hostFingerprint!==state.host?.configurationFingerprint||
      reviewed?.profileRevision!==state.profile?.revision||Boolean(state.host?.console.closing)||
      Boolean(model?.installation?.installation.id===model?.id);
    ui['workflow-recipe-recover'].disabled=!selected||!model?.intentReady||!pending||writing;
    ui['workflow-recipe-open-installed'].disabled=!selected||!model?.installation||writing;
    ui['workflow-recipe-new-copy'].disabled=!ready||(!model?.recipe&&!model?.installation)||pending||writing;
    ui['workflow-recipe-export-prepare'].disabled=!selected||!selection.id||selection.dirty||model?.exporting;
    ui['workflow-recipe-export-download'].disabled=!model?.exportRecipe;ui['workflow-recipe-export-use'].disabled=!ready||!model?.exportRecipe||pending||writing;
    for(const checkbox of ui['workflow-recipe-tools'].querySelectorAll('[data-recipe-accept-tool]'))checkbox.disabled=pending||writing;
  }
  for(const id of ['workflow-recipe-json','workflow-recipe-name','workflow-recipe-inputs'])ui[id].addEventListener('input',invalidate);
  for(const id of ['workflow-recipe-export-name','workflow-recipe-export-description','workflow-recipe-export-inputs'])
    ui[id].addEventListener('input',()=>{if(!model)return;remember();model.exportVersion++;model.exportRecipe=null;renderExport();sync();});
  file.addEventListener('change',()=>busy(file,loadFile));
  async function useRecipe(recipe,inputs){
    requireProfile();const ctx=context();
    await refresh();
    if(!current(ctx))throw new Error('The operator profile changed before recipe intake.');
    const parsed=parseRecipe(JSON.stringify(recipe)),selectedInputs=parseObject(JSON.stringify(inputs),'Workflow inputs');
    adoptRecipe(parsed);model.inputsText=pretty(selectedInputs);writeForm();show();sync();
    return {recipeSha256:parsed.contentSha256,profileId:ctx.profileId};
  }
  return {refresh,profileChanged,reset,sync,syncSelection,prefillDefinition,useRecipe};
}
