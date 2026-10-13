// MIT. Named Workbook setup and original verified file results in Applications.
const node=(tag,text,className)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(className)value.className=className;return value;};
const action=(title,work)=>{const value=node('button',title);value.type='button';value.addEventListener('click',work);return value;};
const facts=rows=>{const list=node('dl',undefined,'paths');for(const [label,value] of rows){const item=node('div');item.append(node('dt',label),node('dd',value??'—'));list.append(item);}return list;};
const workbookCommands=new Set(['workbooks','workbookDelivery']);
export const isWorkbookApplication=(app,run)=>workbookCommands.has(run?.command) || /^python-workbook(?:s|-)/.test(app?.kind??'');

export function workbookFormFromDescriptor(descriptor) {
  if(!workbookCommands.has(descriptor?.command) || !Array.isArray(descriptor.args))return null;
  const input=[...descriptor.args],options={},command=descriptor.command;
  const chosen=command==='workbooks'?input.shift():null;
  const allowed=command==='workbooks'?
    chosen==='receive'?['--archive','--destination','--sha256','--max-bytes']:
      chosen==='copy'?['--delivery','--destination','--manifest-sha256']:
        chosen==='inspect'?['--delivery','--manifest-sha256']:[]:
    ['--database','--recipe','--refresh-recipe','--operation','--wait-seconds'];
  if(!allowed.length)return null;
  for(let index=0;index<input.length;index++){
    const part=input[index];if(typeof part!=='string')return null;
    const equals=part.indexOf('='),flag=equals<0?part:part.slice(0,equals);
    const value=equals<0?input[++index]:part.slice(equals+1);
    if(!allowed.includes(flag) || Object.hasOwn(options,flag) || typeof value!=='string' || !value)return null;
    options[flag]=value;
  }
  let kind,values={installationId:descriptor.installationId};
  if(command==='workbookDelivery'){
    if(!options['--database'] || !options['--operation'] ||
      Boolean(options['--recipe'])===Boolean(options['--refresh-recipe']))return null;
    kind=options['--refresh-recipe']?'python-workbook-refresh':'python-workbook-build';
    Object.assign(values,{databaseDirectory:options['--database'],recipeFile:options['--recipe']||options['--refresh-recipe'],
      operationDirectory:options['--operation']});
    if(options['--wait-seconds'])values.waitSeconds=options['--wait-seconds'];
  }else if(chosen==='receive'){
    if(!options['--archive'] || !options['--destination'])return null;
    kind='python-workbook-receive';
    Object.assign(values,{archiveFile:options['--archive'],destinationDirectory:options['--destination']});
    if(options['--sha256'])values.archiveSha256=options['--sha256'];
    if(options['--max-bytes'])values.maxBytes=options['--max-bytes'];
  }else{
    if(!options['--delivery'] || chosen==='copy'&&!options['--destination'])return null;
    kind='python-workbook-'+chosen;values.deliveryDirectory=options['--delivery'];
    if(options['--destination'])values.destinationDirectory=options['--destination'];
    if(options['--manifest-sha256'])values.manifestSha256=options['--manifest-sha256'];
  }
  return {kind,values};
}

export function renderWorkbookReview(review) {
  const selected=review?.command?.workbook;if(!selected)return document.createDocumentFragment();
  const root=node('section',undefined,'result');
  root.append(node('h4','Selected workbook'));
  const manifest=selected.manifest;
  root.append(facts([
    ['Action',selected.action],['Output directory',selected.directory],
    ...(selected.operation?[['Original delivery operation',selected.operation]]:[]),
    ...(selected.recipeFile?[['Recipe source',selected.originalRecipeFile??selected.recipeFile],['Retained recipe',selected.recipeFile],['Reviewed recipe SHA-256',selected.recipeSha256]]:[]),
    ...(manifest?[['Workbook',manifest.title||manifest.name],['Saved name / revision',manifest.name+' / '+manifest.revision],
      ['Original workspace',manifest.workspace_id],['Manifest SHA-256',selected.manifest_sha256],
      ['Rows / sheets',manifest.row_count+' / '+(manifest.sheets?.length??0)]]:[]),
    ...(selected.archive?[['Archive',selected.archive],['Archive SHA-256',selected.archive_sha256],
      ['Archive bytes',selected.archive_bytes]]:[]),
  ]));
  if(selected.recipe){
    const details=node('details');details.append(node('summary',selected.action==='refresh'?'Original refresh recipe':'Original workbook recipe'),
      node('pre',JSON.stringify(selected.recipe,null,2)));root.append(details);
  }
  return root;
}

export function createWorkbookResultsView({api,message,error}) {
  const root=node('section',undefined,'result');root.hidden=true;
  root.setAttribute('aria-label','Saved workbook result');
  let selection=null,value=null,signature=null,generation=0,loading=false;
  function reset(){generation++;selection=value=signature=null;loading=false;root.hidden=true;root.replaceChildren();}
  async function download(file) {
    const own=generation,current=selection,saved=value;
    if(!current || saved?.state!=='VERIFIED')return;
    try{
      const received=await api('/api/applications/workbook-download',{
        applicationId:current.applicationId,operationId:current.operationId,
        file:file.name,manifestSha256:saved.manifest_sha256});
      if(own!==generation)return;
      if(received.sha256!==file.sha256 || received.bytes!==file.bytes)throw new Error('The verified original download identity changed. Inspect the workbook again.');
      const url=new URL(received.url,window.location.href);
      if(url.origin!==window.location.origin || !/^\/workbook-download\/[a-f0-9]{64}$/.test(url.pathname) || url.search || url.hash)
        throw new Error('The workbook download did not return this workspace’s original file route.');
      const link=node('a');link.href=url.href;link.download=received.file;root.append(link);link.click();link.remove();
      message('Opening '+file.name+' · '+file.bytes+' original bytes.');
    }catch(issue){if(own===generation)error(issue);}
  }
  function render() {
    root.hidden=!selection;if(!selection)return;
    root.replaceChildren();
    const heading=node('div',undefined,'section-title');
    heading.append(node('h3',value?.state==='VERIFIED'?'Saved workbook verified':'Workbook result'));
    const refresh=action(loading?'Verifying…':'Inspect saved files',()=>load(true));refresh.disabled=loading;
    heading.append(refresh);root.append(heading);
    if(loading){root.append(node('p','Reading the selected original workbook and checking its retained files.','note'));return;}
    if(!value)return;
    const command=value.command;
    if(command)root.append(node('p','Application operation '+selection.operationId+' · '+command.phase+
      (command.result?.exitCode!==null&&command.result?.exitCode!==undefined?' · command exit '+command.result.exitCode:''),'note'));
    if(value.state!=='VERIFIED'){
      const labels={RUNNING:'The original application is still running.',
        NOT_CREATED:'No complete workbook has been published by this operation yet.',
        DELIVERY_PENDING:'The original Analysis build or receiving is still pending.',
        REVIEW_REQUIRED:'The original refresh requires source projection review.'};
      root.append(node('p',value.message||labels[value.state]||'The original saved result is unavailable.','note'));
      if(value.job_id)root.append(facts([['Original workbook job',value.job_id],['Original workspace',value.workspace_id]]));
      if(value.review){
        const details=node('details');details.open=true;
        details.append(node('summary',value.review_scope==='retained-operation'?'Retained operation review · current recipe not linked':'Original refresh review'),node('pre',JSON.stringify(value.review,null,2)));root.append(details);
      }
      if(value.failure)root.append(node('p',value.failure,'note'));
      return;
    }
    const manifest=value.manifest;
    root.append(facts([['Workbook',manifest.title||manifest.name],['Saved name / revision',manifest.name+' / '+manifest.revision],
      ['Original build',manifest.id],['Original workspace',manifest.workspace_id],['Rows',manifest.row_count],
      ['Verified directory',value.directory],['Manifest SHA-256',value.manifest_sha256],
      ['Python installation',value.installation?.id]]));
    if(!value.selection_pinned)root.append(node('p','These current files are verified. This earlier command did not retain a manifest checksum for its input selection.','note'));
    if(['build','refresh'].includes(value.action)&&!value.receipt)
      root.append(node('p','The complete files match the original saved build request. The delivery client has no final delivery.json receipt yet.','note'));
    const sheets=node('table'),head=node('thead'),body=node('tbody'),header=node('tr');
    for(const label of ['Sheet','Rows','Original source'])header.append(node('th',label));
    head.append(header);sheets.append(head,body);
    for(const sheet of manifest.sheets??[]){
      const row=node('tr');row.append(node('td',sheet.name),
        node('td',sheet.row_count),node('td',[sheet.source?.kind,sheet.source?.job_id??sheet.source?.id].filter(Boolean).join(' · ')||'Retained source'));
      body.append(row);
    }
    if(body.childElementCount){root.append(node('h4','Workbook sheets'),sheets);}
    const table=node('table'),tableHead=node('thead'),tableBody=node('tbody'),headers=node('tr');
    for(const label of ['Original file','Bytes','SHA-256',''])headers.append(node('th',label));
    tableHead.append(headers);table.append(tableHead,tableBody);
    for(const file of value.files){
      const row=node('tr'),checksum=node('td');checksum.append(node('code',file.sha256));
      const controls=node('td');controls.append(action('Download',()=>download(file)));
      row.append(node('td',file.name),node('td',String(file.bytes)),checksum,controls);tableBody.append(row);
    }
    root.append(node('h4','Verified files'),table);
    const definition=node('details');definition.append(node('summary','Saved definition and source selections'),
      node('pre',JSON.stringify(value.definition,null,2)));root.append(definition);
    if(manifest.definition_history?.length){
      const history=node('details');history.append(node('summary','Retained workbook editions'),
        node('pre',JSON.stringify(manifest.definition_history,null,2)));root.append(history);
    }
  }
  async function load(force=false) {
    if(!selection || loading&&!force)return;
    const own=++generation,current={...selection};loading=true;render();
    try{
      const result=await api('/api/applications/workbook-result?'+new URLSearchParams(current));
      if(own!==generation)return;
      if(result.applicationId!==current.applicationId || result.operationId!==current.operationId)
        throw new Error('The workbook result belongs to another application operation.');
      value=result.available?result:null;if(!result.available){reset();return;}
    }catch(issue){if(own===generation)value={state:'UNAVAILABLE',failure:issue.message||String(issue)};}
    finally{if(own===generation){loading=false;render();}}
  }
  return {root,reset,
    async update(app,run,output){
      if(!isWorkbookApplication(app,run)){reset();return;}
      const next={applicationId:app.id,operationId:run.id};
      const selectedSignature=JSON.stringify([next,output.phase,output.active,output.result]);
      if(signature===selectedSignature)return;
      const switched=selection?.applicationId!==next.applicationId || selection?.operationId!==next.operationId;
      if(switched){generation++;value=null;loading=false;}
      selection=next;signature=selectedSignature;root.hidden=false;
      if(output.active || ['PENDING','QUEUED'].includes(output.phase)){
        generation++;loading=false;value={state:'RUNNING',command:{phase:output.phase,active:output.active,result:output.result}};render();return;
      }
      await load(true);
    },
  };
}
