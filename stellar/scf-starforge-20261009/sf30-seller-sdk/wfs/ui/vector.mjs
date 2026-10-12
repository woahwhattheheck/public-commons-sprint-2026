// MIT. Native WFS vector controls over the original application and retained request IDs.
import { parseExactJSON,stringifyExactJSON,ExactNumber } from './vector-json.mjs';
export function initializeVectorPanel(ctx){
  const $=id=>document.getElementById(id);
  let projectId=null,ready=false,loading=false,fileLoading=0,active=null,pending=[],rows=[],
    historyOffset=0,historyNext=null,selected=null,comparison=null,changeOffset=0,changeNext=null,
    generation=0,selectionGeneration=0,profileGeneration=0,archiveGeneration=0,orderGeneration=0,draftTimer=null,
    mappingCapture=null,mappingTimer=null;
  const draftFields=['vector-order','vector-source-crs','vector-coordinate-order','vector-identity',
    'vector-capture','vector-profile','vector-before','vector-after','vector-manifest-sha'];
  const defaults=Object.fromEntries(draftFields.map(name=>[name,$(name).value]));
  const database=new Promise((done,reject)=>{
    const request=indexedDB.open('stellar-forge.wfs-native-vectors.v1',1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      db.createObjectStore('drafts',{keyPath:'projectId'});
      const requests=db.createObjectStore('requests',{keyPath:'key'});
      requests.createIndex('projectId','projectId',{unique:false});
    };
    request.onsuccess=()=>done(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(Error('Close an older native-vector tab so this request journal can open.'));
  });
  database.catch(()=>{});
  async function transaction(store,mode,work){
    const db=await database;
    return new Promise((done,reject)=>{
      const tx=db.transaction(store,mode),object=tx.objectStore(store);
      let value;
      tx.oncomplete=()=>done(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('The original request journal was not saved.'));
      try{const request=work(object);if(request){request.onsuccess=()=>{value=request.result;};request.onerror=()=>tx.abort();}}
      catch(error){tx.abort();reject(error);}
    });
  }
  const get=(store,key)=>transaction(store,'readonly',s=>s.get(key));
  const put=(store,value)=>transaction(store,'readwrite',s=>s.put(value));
  async function requests(id){
    const db=await database;
    return new Promise((done,reject)=>{
      const tx=db.transaction('requests','readonly'),request=tx.objectStore('requests').index('projectId').getAll(IDBKeyRange.only(id));
      request.onsuccess=()=>done(request.result);request.onerror=()=>reject(request.error);
    });
  }
  function assertProject(expected=projectId){
    if(!expected||ctx.getState()?.project.id!==expected||expected!==projectId)throw Error('Reload the original project before continuing its native work.');
  }
  function localStatus(message){$('vector-local-status').textContent=message;}
  function controls(){
    const base=!ready||loading||fileLoading>0||ctx.isWorking(),blocked=base||Boolean(active);
    for(const node of document.querySelectorAll('#vectors button,#vectors input,#vectors textarea,#vectors select'))node.disabled=base;
    for(const form of document.querySelectorAll('#vectors form')){
      for(const node of form.querySelectorAll('button,input,textarea,select'))node.disabled=blocked;
    }
    for(const name of ['vector-load-profile','vector-profile-download'])$(name).disabled=blocked;
    $('vector-retry').disabled=base||!active;
    $('vector-keep').disabled=base||!active;
    $('vector-history-previous').disabled=base||historyOffset===0;
    $('vector-history-next').disabled=base||historyNext===null;
    $('vector-changes-previous').disabled=base||changeOffset===0;
    $('vector-changes-next').disabled=base||changeNext===null;
    $('vector-selected-download').disabled=base||!selected?.receipt||selected.receipt.manifest.kind==='capture';
    $('vector-manifest-download').disabled=base||!selected?.receipt;
  }
  function choices(name,values,placeholder){
    ctx.options(name,values,placeholder);
  }
  function drawPending(){
    $('vector-pending-panel').hidden=pending.length===0;
    choices('vector-pending-select',pending.map(row=>({id:row.id,label:row.id+' · '+row.action})),'Choose a saved request');
    $('vector-pending-select').value=active?.id??'';
    $('vector-pending-description').textContent=active?
      active.id+' retains the exact '+active.action+' request. Retry uses those saved inputs.':
      'Earlier requests remain in this journal and in the original project when already received.';
    controls();
  }
  async function saveDraft(){
    if(!ready)return;
    const selectedProject=projectId;assertProject(selectedProject);
    const fields=Object.fromEntries(draftFields.map(name=>[name,$(name).value]));
    await put('drafts',{projectId:selectedProject,fields,activeId:active?.id??null,at:new Date().toISOString()});
    assertProject(selectedProject);
  }
  function scheduleDraft(){
    clearTimeout(draftTimer);
    draftTimer=setTimeout(()=>{void saveDraft().catch(error=>localStatus(error.message));},180);
  }
  async function loadProject(id){
    const token=++generation;
    ready=false;loading=true;projectId=id;active=null;pending=[];selected=null;comparison=null;
    historyOffset=0;historyNext=null;changeOffset=0;changeNext=null;mappingCapture=null;
    $('vector-inspection').hidden=true;$('vector-changes-panel').hidden=true;
    profileGeneration++;archiveGeneration++;selectionGeneration++;orderGeneration++;
    controls();
    try{
      const [draft,retained]=await Promise.all([get('drafts',id),requests(id)]);
      if(token!==generation)return;
      assertProject(id);
      for(const name of draftFields)$(name).value=typeof draft?.fields?.[name]==='string'?draft.fields[name]:defaults[name];
      pending=retained.filter(row=>row.state==='PENDING').sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      active=draft&&Object.hasOwn(draft,'activeId')?pending.find(row=>row.id===draft.activeId)??null:pending.at(-1)??null;
      ready=true;localStatus('Native requests and profiles are retained for this original project.');
      drawPending();await refreshHistory();
      if(token===generation&&draft?.fields){
        for(const name of ['vector-capture','vector-before','vector-after'])if(typeof draft.fields[name]==='string')$(name).value=draft.fields[name];
        if($('vector-capture').value)await loadMappingCapture($('vector-capture').value);
      }
    }catch(error){if(token===generation)localStatus(error.message);}
    finally{if(token===generation){loading=false;controls();}}
  }
  function updateState(value){
    if(!value?.project)return;
    choices('vector-order',value.project.orders.filter(row=>row.state==='READY').map(row=>({
      id:row.id,label:row.name+' · '+row.id.slice(0,12)})),'Choose a complete source order');
    if(projectId!==value.project.id)void loadProject(value.project.id);
    controls();
  }
  async function pendingSaved(request){
    assertProject();
    if(active)throw Error('Retry the saved request or keep it in history before starting a new operation.');
    const bodyText=JSON.stringify(request),row={key:projectId+'\0'+request.id,projectId,id:request.id,
      action:request.action,state:'PENDING',bodyText,createdAt:new Date().toISOString()};
    await put('requests',row);assertProject(row.projectId);
    pending.push(row);active=row;await saveDraft();drawPending();
    return row;
  }
  async function sendSaved(row=active){
    assertProject(row?.projectId);
    if(!row||row.state!=='PENDING'||typeof row.bodyText!=='string')throw Error('Choose the exact saved native request.');
    const request=JSON.parse(row.bodyText);
    if(JSON.stringify(request)!==row.bodyText||request.id!==row.id)throw Error('The original saved request bytes changed.');
    const result=await ctx.api('/api/action',request);
    assertProject(row.projectId);
    if(result.projectId!==row.projectId||result.id!==row.id||result.state!=='COMPLETE')
      throw Error('The returned native result belongs to a different original request.');
    await put('requests',{key:row.key,projectId:row.projectId,id:row.id,action:row.action,state:'COMPLETE',
      createdAt:row.createdAt,completedAt:new Date().toISOString(),receipt:result.receipt});
    pending=pending.filter(item=>item.id!==row.id);if(active?.id===row.id)active=null;
    await saveDraft();drawPending();await refreshHistory();
    await inspect(row.id);return result;
  }
  async function begin(action,input){
    assertProject();
    if(!ready||loading||fileLoading)throw Error('Finish opening the selected native inputs.');
    await saveDraft();
    const request={action,id:'native-'+crypto.randomUUID(),...input};
    const saved=await pendingSaved(request);return sendSaved(saved);
  }
  async function perform(work,message='Native operation completed.'){
    controls();
    const result=await ctx.perform(async()=>{controls();return work();},{target:'vector-result',message});
    controls();return result;
  }
  const button=(label,work)=>{
    const node=document.createElement('button');node.type='button';node.textContent=label;
    node.disabled=loading||ctx.isWorking();node.addEventListener('click',()=>void perform(work));return node;
  };
  async function refreshHistory(){
    assertProject();const selectedProject=projectId;
    const page=await ctx.query('vectors',{offset:historyOffset,limit:50});
    assertProject(selectedProject);if(page.projectId!==selectedProject)throw Error('The native history belongs to a different project.');
    rows=page.items;historyNext=page.nextOffset;
    $('vector-history-count').textContent=page.total+' original operations';
    ctx.table('vector-history',rows.map(row=>[row.id,row.kind,row.state,row.receipt?.manifest.sha256??'Pending',
      ctx.toolbar(button('Inspect',()=>inspect(row.id)),row.state==='PENDING'?button('Resume',async()=>{
        const saved=pending.find(item=>item.id===row.id);
        if(saved){active=saved;drawPending();return sendSaved(saved);}
        const result=await ctx.action('vector-resume',{id:row.id});await refreshHistory();await inspect(row.id);return result;
      }):row.receipt?.manifest.kind!=='capture'?button('Download ZIP',()=>ctx.download('vector',{id:row.id})):
        button('Use profile',()=>loadProfile(row.id)))]),5,'Capture a complete WFS order to create native vector work.');
    // Capture selectors need the whole retained collection; source history itself remains paged.
    const captures=[];let offset=0;
    do{
      const current=await ctx.query('vectors',{offset,limit:1000});assertProject(selectedProject);
      for(const row of current.items)if(row.kind==='capture'&&row.state==='COMPLETE')captures.push({
        id:row.id,label:row.id+' · '+(row.receipt?.sourceId??'native source')});
      offset=current.nextOffset;
    }while(offset!==null);
    for(const name of ['vector-capture','vector-before','vector-after'])choices(name,captures,'Choose a retained source capture');
    controls();return page;
  }
  async function inspect(id){
    assertProject();const token=++selectionGeneration,selectedProject=projectId;
    const result=await ctx.query('vector',{id});assertProject(selectedProject);
    if(token!==selectionGeneration)return result;
    selected=result;$('vector-inspection').hidden=false;
    ctx.facts('vector-selection-summary',[
      ['Original operation',id],['Native action',result.kind],['State',result.state],
      ['Manifest SHA256',result.receipt?.manifest.sha256??'Pending']]);
    $('vector-native-json').value=[result.inspectionJson,result.manifestJson,result.receivingJson].filter(Boolean).join('\n\n');
    const manifest=result.manifestJson?JSON.parse(result.manifestJson):{},inspection=result.inspectionJson?JSON.parse(result.inspectionJson):{};
    const nativeLayers=manifest.native?.layers??[];
    ctx.table('vector-layers',nativeLayers.map(layer=>[layer.layer??layer.id,layer.driver,layer.featureCount,
      layer.fields?.length??0,layer.crsWkt??'No declared CRS']),5,'The selected operation has no native output layers.');
    const fields=[];
    for(const layer of inspection.layers??[])for(const name of layer.fieldOrder??Object.keys(layer.fields??{})){
      const stat=layer.fields[name];fields.push([layer.id,name,Object.keys(stat.kinds??{}).join(', '),
        stat.requiresExactNumber?'Exact JSON codec required':'Native profile review']);
    }
    ctx.table('vector-fields',fields,4,'Original captured field kinds appear after source inspection.');
    comparison=result.receipt?.manifest.kind==='comparison'?id:null;changeOffset=0;changeNext=null;
    $('vector-changes-panel').hidden=!comparison;
    if(comparison)await changes();
    controls();return result;
  }
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof ExactNumber);
  function currentProfile(){
    const value=parseExactJSON($('vector-profile').value);
    if(!plain(value)||value.schema!=='starforge.vector-export-profile.v1'||value.layers!==undefined&&!plain(value.layers))
      throw Error('Load a complete original native export profile.');
    if(value.formats!==undefined&&(!Array.isArray(value.formats)||value.formats.some(name=>!['GPKG','ESRI Shapefile'].includes(name))))
      throw Error('Choose GeoPackage or Shapefile in the original profile formats.');
    if(value.shapefile!==undefined&&!plain(value.shapefile))
      throw Error('Keep the complete Shapefile settings as a JSON object.');
    return value;
  }
  function mappingInput(value,label,{maximum=128,select=null}={}){
    const node=document.createElement(select?'select':'input');node.setAttribute('aria-label',label);
    if(select)for(const [id,text]of select)node.append(new Option(text,id));
    else{node.type='text';node.maxLength=maximum;}
    node.value=value??'';return node;
  }
  function updateProfile(work){
    assertProject();
    if(!ready||loading||fileLoading||ctx.isWorking()||active)throw Error('Finish the current native operation before changing its profile.');
    const value=currentProfile();work(value);profileGeneration++;
    $('vector-profile').value=stringifyExactJSON(value,2);scheduleDraft();
    $('vector-mapping-status').textContent='The complete reviewed profile is saved with this project.';
  }
  function fieldChange(layerId,name,work){
    updateProfile(value=>{
      if(mappingCapture?.id!==$('vector-capture').value||$('vector-mapping-layer').value!==layerId)
        throw Error('Open this original source layer before changing its mapping.');
      value.layers??=Object.create(null);const layer=value.layers[layerId]??=Object.create(null);
      layer.fields??=Object.create(null);const rule=layer.fields[name]??=Object.create(null);
      if(!plain(rule)||rule.names!==undefined&&!plain(rule.names))throw Error('Keep this original field mapping as a JSON object.');
      work(rule);
    });
  }
  function localEdit(work){
    try{work();}catch(error){$('vector-mapping-status').textContent=error.message;}
  }
  function renderMapping(){
    if(!mappingCapture||mappingCapture.id!==$('vector-capture').value){
      ctx.table('vector-mapping-fields',[],6,'Choose and load a retained source capture.');controls();return;
    }
    let value;
    try{value=currentProfile();}
    catch(error){$('vector-mapping-status').textContent=error.message;controls();return;}
    const layers=mappingCapture.inspection.layers??[];
    choices('vector-mapping-layer',layers.map(layer=>({id:layer.id,label:layer.name??layer.id})),'Choose the original source layer');
    if(!$('vector-mapping-layer').value&&layers.length)$('vector-mapping-layer').value=layers[0].id;
    const layer=layers.find(item=>item.id===$('vector-mapping-layer').value);
    const formats=value.formats??['GPKG','ESRI Shapefile'];
    $('vector-format-gpkg').checked=formats.includes('GPKG');$('vector-format-shape').checked=formats.includes('ESRI Shapefile');
    $('vector-long-values').value=value.shapefile?.longValues??'reference';
    $('vector-collections').value=value.shapefile?.collections??'split';
    if(!layer){controls();return;}
    const rule=value.layers?.[layer.id]??{};
    if(!plain(rule)||rule.fields!==undefined&&!plain(rule.fields)){
      $('vector-mapping-status').textContent='Keep this original layer and its fields as JSON objects.';controls();return;
    }
    $('vector-layer-name').value=rule.name??'';
    $('vector-target-crs').value=rule.targetCrs??'';
    $('vector-target-crs').placeholder=value.targetCrs?'Inherit '+value.targetCrs:'Preserve the captured source CRS';
    const fields=(layer.fieldOrder??Object.keys(layer.fields??{})).map(name=>{
      const stat=layer.fields[name],selected=rule.fields?.[name]??{};
      if(!plain(selected)||selected.names!==undefined&&!plain(selected.names))throw Error('Keep the original mapping for '+name+' as a JSON object.');
      const gpkg=mappingInput(selected.names?.GPKG??selected.name,name+' GeoPackage name');
      const shape=mappingInput(selected.names?.['ESRI Shapefile']??selected.name,name+' Shapefile name',{maximum:10});
      gpkg.placeholder=selected.name??name;shape.placeholder=selected.name??'Native alias';
      for(const [input,format]of [[gpkg,'GPKG'],[shape,'ESRI Shapefile']])input.addEventListener('input',()=>localEdit(()=>fieldChange(layer.id,name,current=>{
        current.names??=Object.create(null);if(input.value)current.names[format]=input.value;else delete current.names[format];
      })));
      const mode=mappingInput(selected.mode??'auto',name+' representation',{select:[
        ['auto','Automatic native mapping'],['native','Explicit native type'],['json','Exact typed JSON'],['reference','Complete source reference']]});
      mode.addEventListener('change',()=>localEdit(()=>fieldChange(layer.id,name,current=>{current.mode=mode.value;})));
      const physical=mappingInput(selected.physicalType,name+' native type',{maximum:64});
      physical.placeholder='For explicit native mapping';
      physical.addEventListener('input',()=>localEdit(()=>fieldChange(layer.id,name,current=>{
        if(physical.value)current.physicalType=physical.value;else delete current.physicalType;
      })));
      return [name,Object.keys(stat.kinds??{}).join(', ')+(stat.requiresExactNumber?' · exact numeric storage':''),gpkg,shape,mode,physical];
    });
    ctx.table('vector-mapping-fields',fields,6,'The original source layer has no property fields.');
    $('vector-mapping-status').textContent=layer.id+' · '+fields.length+' original fields · '+mappingCapture.manifestSha256;
    controls();
  }
  async function loadMappingCapture(id,useOriginalProfile=false){
    if(!id){mappingCapture=null;renderMapping();return;}
    const token=++profileGeneration,selectedProject=projectId;
    const result=await ctx.query('vector',{id});assertProject(selectedProject);
    if(token!==profileGeneration)return result;
    if(result.kind!=='capture'||!result.receipt?.profileJson||!result.inspectionJson)
      throw Error('Choose a completed original native source capture.');
    if(useOriginalProfile){$('vector-capture').value=id;$('vector-profile').value=result.receipt.profileJson;}
    else if($('vector-capture').value!==id)return result;
    mappingCapture={id,manifestSha256:result.receipt.manifest.sha256,inspection:parseExactJSON(result.inspectionJson)};
    renderMapping();if(useOriginalProfile)await saveDraft();return result;
  }
  async function loadProfile(id=$('vector-capture').value){
    if(!id)throw Error('Choose a retained source capture.');
    const result=await loadMappingCapture(id,true);
    if(result&&mappingCapture?.id===id)await inspect(id);return result;
  }
  async function changes(){
    if(!comparison)return;
    const original=comparison,token=selectionGeneration;
    const result=await ctx.query('vector-changes',{id:original,offset:changeOffset,limit:100,
      ...($('vector-change-status').value?{status:$('vector-change-status').value}:{})});
    if(comparison!==original||token!==selectionGeneration)return;
    assertProject(result.projectId);
    const page=JSON.parse(result.resultJson);changeNext=page.nextOffset;
    $('vector-change-count').textContent=(page.offset+1)+'–'+(page.offset+page.changes.length)+' of '+page.total;
    ctx.table('vector-changes',page.changes.map(item=>{
      const value=JSON.parse(item.valueJson);
      return [value.rowKey,value.status,value.geometryChanged?'Changed':'Retained',value.propertyChanges?.length??0,
        (value.identityIssues??[]).join(', ')||value.identityBasis,
        button('Exact source JSON',async()=>{$('vector-change-json').value=item.valueJson;return {rowKey:value.rowKey};})];
    }),6,'No changes match the current selection.');
    controls();return result;
  }
  function chosen(name,label){const value=$(name).value;if(!value)throw Error('Choose '+label+'.');return value;}
  function jsonSyntax(value,label){
    try{parseExactJSON(value);}catch{throw Error('Choose complete valid '+label+' JSON.');}
    return value;
  }
  async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function base64(bytes){
    const parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
    return btoa(parts.join(''));
  }
  for(const name of draftFields)$(name).addEventListener('input',()=>{
    if(name==='vector-profile'){profileGeneration++;clearTimeout(mappingTimer);mappingTimer=setTimeout(()=>localEdit(renderMapping),250);}
    scheduleDraft();
  });
  $('vector-order').addEventListener('change',()=>void perform(async()=>{
    const id=chosen('vector-order','a complete source order'),token=++orderGeneration,selectedProject=projectId;
    const view=await ctx.query('order',{orderId:id});assertProject(selectedProject);
    if(token===orderGeneration&&$('vector-order').value===id)$('vector-order-details').textContent=JSON.stringify({
      requestedCrs:view.selection.srsName,responseCrs:view.responseCrs,coordinateDescription:view.coordinates,
      originalRows:view.rows,complete:view.complete},null,2);
    return view;
  },'Original coordinate description loaded.'));
  $('vector-capture-form').addEventListener('submit',event=>{
    event.preventDefault();void perform(()=>begin('vector-capture',{
      orderId:chosen('vector-order','a complete source order'),sourceCrs:chosen('vector-source-crs','the original source CRS'),
      coordinateOrder:chosen('vector-coordinate-order','the original coordinate order'),
      identityJson:jsonSyntax($('vector-identity').value,'feature identity')}),'Original native source captured.');
  });
  $('vector-export-form').addEventListener('submit',event=>{
    event.preventDefault();void perform(()=>begin('vector-export',{captureId:chosen('vector-capture','a retained source capture'),
      profileJson:jsonSyntax($('vector-profile').value,'native export profile')}),'Native files exported and reopened.');
  });
  $('vector-compare-form').addEventListener('submit',event=>{
    event.preventDefault();void perform(()=>begin('vector-compare',{
      before:chosen('vector-before','the earlier capture'),after:chosen('vector-after','the later capture')}),'Complete source editions compared.');
  });
  $('vector-profile-file').addEventListener('change',()=>{
    const file=$('vector-profile-file').files[0],token=++profileGeneration,selectedProject=projectId;
    if(!file)return;
    fileLoading++;controls();
    void (async()=>{
      try{
        if(file.size>4*1024*1024)throw Error('The native profile exceeds four MiB.');
        const value=await file.text();assertProject(selectedProject);
        if(token!==profileGeneration||$('vector-profile-file').files[0]!==file)return;
        jsonSyntax(value,'native export profile');$('vector-profile').value=value;renderMapping();await saveDraft();
      }catch(error){localStatus(error.message);}
      finally{fileLoading--;controls();}
    })();
  });
  $('vector-capture').addEventListener('change',()=>{
    mappingCapture=null;profileGeneration++;renderMapping();
    void perform(()=>loadMappingCapture($('vector-capture').value),'Original source fields opened.');
  });
  $('vector-mapping-layer').addEventListener('change',()=>localEdit(renderMapping));
  for(const name of ['vector-format-gpkg','vector-format-shape'])$(name).addEventListener('change',()=>localEdit(()=>updateProfile(value=>{
    value.formats=[$('vector-format-gpkg').checked?'GPKG':null,$('vector-format-shape').checked?'ESRI Shapefile':null].filter(Boolean);
  })));
  for(const [name,key]of [['vector-layer-name','name'],['vector-target-crs','targetCrs']])$(name).addEventListener('input',()=>localEdit(()=>updateProfile(value=>{
    const id=$('vector-mapping-layer').value;
    if(!id||mappingCapture?.id!==$('vector-capture').value)throw Error('Load the selected original source layer.');
    value.layers??=Object.create(null);const layer=value.layers[id]??=Object.create(null);
    if($(name).value)layer[key]=$(name).value;else delete layer[key];
  })));
  for(const [name,key]of [['vector-long-values','longValues'],['vector-collections','collections']])$(name).addEventListener('change',()=>localEdit(()=>updateProfile(value=>{
    value.shapefile??=Object.create(null);value.shapefile[key]=$(name).value;
  })));
  $('vector-archive').addEventListener('change',()=>{archiveGeneration++;});
  $('vector-receive-form').addEventListener('submit',event=>{
    event.preventDefault();void perform(async()=>{
      const file=$('vector-archive').files[0],token=archiveGeneration,selectedProject=projectId;
      if(!file||file.size===0||file.size>256*1024*1024)throw Error('Choose a complete native vector ZIP up to 256 MiB.');
      const pin=$('vector-manifest-sha').value.trim();
      if(pin&&!/^[a-f0-9]{64}$/.test(pin))throw Error('Use the supplied native manifest SHA256.');
      const buffer=await file.arrayBuffer(),archiveSha256=await digest(buffer);assertProject(selectedProject);
      if(token!==archiveGeneration||$('vector-archive').files[0]!==file)throw Error('The selected archive changed while it was being read.');
      return begin('vector-receive',{archiveBase64:base64(new Uint8Array(buffer)),archiveSha256,...(pin?{manifestSha256:pin}:{})});
    },'Complete native vector package received.');
  });
  $('vector-load-profile').addEventListener('click',()=>void perform(()=>loadProfile()));
  $('vector-profile-download').addEventListener('click',()=>void perform(()=>ctx.download('vector-document',{
    id:chosen('vector-capture','a retained source capture'),document:'profile'})));
  $('vector-pending-select').addEventListener('change',()=>{active=pending.find(row=>row.id===$('vector-pending-select').value)??null;drawPending();scheduleDraft();});
  $('vector-retry').addEventListener('click',()=>void perform(()=>sendSaved(),'The exact saved native request completed.'));
  $('vector-keep').addEventListener('click',()=>void perform(async()=>{
    active=null;await saveDraft();drawPending();return {state:'RETAINED_IN_HISTORY',requests:pending.map(row=>row.id)};
  },'The original request remains in history. A new operation can use your corrected inputs.'));
  $('vector-refresh').addEventListener('click',()=>void perform(refreshHistory,'Native history refreshed.'));
  $('vector-history-previous').addEventListener('click',()=>void perform(async()=>{historyOffset=Math.max(0,historyOffset-50);return refreshHistory();}));
  $('vector-history-next').addEventListener('click',()=>void perform(async()=>{if(historyNext!==null)historyOffset=historyNext;return refreshHistory();}));
  $('vector-selected-download').addEventListener('click',()=>void perform(()=>ctx.download('vector',{id:selected.id})));
  $('vector-manifest-download').addEventListener('click',()=>void perform(()=>ctx.download('vector-document',{id:selected.id,document:'manifest'})));
  $('vector-change-status').addEventListener('change',()=>void perform(async()=>{changeOffset=0;return changes();}));
  $('vector-changes-previous').addEventListener('click',()=>void perform(async()=>{changeOffset=Math.max(0,changeOffset-100);return changes();}));
  $('vector-changes-next').addEventListener('click',()=>void perform(async()=>{if(changeNext!==null)changeOffset=changeNext;return changes();}));
  $('vector-refresh').closest('section').addEventListener('focusin',controls);
  return {updateState,refresh:refreshHistory};
}
