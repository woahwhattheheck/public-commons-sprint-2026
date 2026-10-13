/** Water and Habitat Context operator. Authored by TokenJunkieLabs. */
import {createWaterContextMap} from './water_context_map.mjs';
const LABELS={wetlands:'NWI aquatic habitat inventory',mapping_status:'NWI mapping coverage',flowlines:'NHD mapped flowlines',
  waterbodies:'NHD waterbodies',protected_lands:'PAD-US inventory overlap',stream_order:'Authoritative stream order'};
const CATEGORIES=Object.keys(LABELS);
const number=value=>value===null||value===undefined?'—':new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(value);
function el(tag,text,className){
  const value=document.createElement(tag);
  if(text!==undefined)value.textContent=String(text);
  if(className)value.className=className;
  return value;
}
function button(text,handler){
  const value=el('button',text);value.type='button';value.addEventListener('click',handler);return value;
}
function input(label,type='text'){
  const wrap=el('label',undefined,'wc-field'),title=el('span',label),control=el('input');
  control.type=type;wrap.append(title,control);return {wrap,control};
}
function select(label,options=[]){
  const wrap=el('label',undefined,'wc-field'),title=el('span',label),control=el('select');
  for(const [value,text] of options){const item=el('option',text);item.value=value;control.append(item);}
  wrap.append(title,control);return {wrap,control};
}
function table(headers,rows){
  const value=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');
  for(const title of headers)tr.append(el('th',title));head.append(tr);
  for(const row of rows){const item=el('tr');for(const cell of row){const td=el('td');if(cell instanceof Node)td.append(cell);else td.textContent=String(cell??'');item.append(td);}body.append(item);}
  value.append(head,body);return value;
}
function detail(title){
  const section=el('details'),summary=el('summary',title);section.append(summary);return section;
}
function sourceKey(ref){return ref?JSON.stringify([ref.collection_id,ref.source_id]):'';}
function sourceReference(key){if(!key)return null;const [collection_id,source_id]=JSON.parse(key);return {collection_id,source_id};}
function typeValue(control,type){
  if(type==='null')return null;
  if(type==='number'){const value=Number(control);if(!control.trim()||!Number.isFinite(value))throw new Error('Enter a finite number for the selected native field.');return value;}
  if(type==='boolean'){if(control==='true')return true;if(control==='false')return false;throw new Error('Boolean native values must be true or false.');}
  return control;
}
function typeOf(value){if(value===null)return 'null';return typeof value==='number'?'number':typeof value==='boolean'?'boolean':'text';}

function referenceEditor(owner,key,title,{required=false,coverage=false,boundary=false}={}){
  const fieldset=el('fieldset',undefined,'wc-source-editor');fieldset.append(el('legend',title));
  const source=select(required?'Retained polygon source':'Retained source',[['',required?'Choose a reporting boundary':'Select an optional source']]);
  const details=detail('Native layer and selection');
  const layer=input('Layer name'),idField=input('Native feature ID field');
  const idsWrap=el('label',undefined,'wc-field'),ids=el('textarea');ids.rows=2;
  idsWrap.append(el('span','Selected native IDs (one per line or comma separated)'),ids);
  const filters=el('div',undefined,'wc-filters'),filterRows=[];
  const sample=el('div',undefined,'wc-source-sample'),info=el('p','', 'wc-note');
  const fieldNames=el('datalist');fieldNames.id='wc-fields-'+key+'-'+Math.random().toString(36).slice(2);
  function addFilter(field='',value=''){
    const row=el('div',undefined,'wc-filter-row'),name=input('Field'),type=select('Type',[['text','Text'],['number','Number'],['boolean','Boolean'],['null','Null']]),entry=input('Equals');
    name.control.setAttribute('list',fieldNames.id);name.control.value=field;type.control.value=typeOf(value);entry.control.value=value===null?'':String(value);
    const item={row,name:name.control,type:type.control,value:entry.control};
    const remove=button('Remove',()=>{filterRows.splice(filterRows.indexOf(item),1);row.remove();owner.changed();});
    row.append(name.wrap,type.wrap,entry.wrap,remove);filters.append(row);filterRows.push(item);
    row.addEventListener('input',owner.changed);row.addEventListener('change',owner.changed);
  }
  const add=button('Add field filter',()=>{addFilter();owner.changed();});
  const inspect=button('Inspect native fields and sample',async()=>{
    try{
      const ref=read();if(!ref)throw new Error('Select a retained source first.');
      const item=owner.sources().find(x=>sourceKey(x)===source.control.value);
      if(item?.kind==='raster'){info.textContent='This native grid is selected through the reporting boundary. Its class dictionary and paired mapping coverage travel with the retained source.';return;}
      inspect.disabled=true;
      const selectedSource=source.control.value,selectedLayer=layer.control.value.trim(),selectedIdField=idField.control.value.trim();
      const value=await owner.sourceInfo(ref);if(!value||source.control.value!==selectedSource||layer.control.value.trim()!==selectedLayer||idField.control.value.trim()!==selectedIdField)return;
      info.textContent=String(value.feature_count??'Unknown')+' retained features · '+String(value.geometry_type||'vector')+
        ' · '+(typeof value.crs==='object'?JSON.stringify(value.crs):String(value.crs||'source CRS'))+'. Showing up to '+String(value.sample_limit||20)+' native attribute records.';
      fieldNames.replaceChildren();
      for(const name of Object.keys(value.fields||{})){const option=el('option');option.value=name;fieldNames.append(option);}
      if(!layer.control.value&&value.selected_layer)layer.control.value=value.selected_layer;
      if(!idField.control.value&&(item?.id_field||value.source?.id_field))idField.control.value=item?.id_field||value.source.id_field;
      const names=Object.keys(value.fields||{}).slice(0,7);
      const rows=(value.sample||[]).map(record=>{
        const choose=el('input');choose.type='checkbox';
        const effectiveField=idField.control.value||item?.id_field||value.source?.id_field;
        const resolvedID=effectiveField&&record[effectiveField]!==undefined&&record[effectiveField]!==null?record[effectiveField]:record.native_id;
        const native=String(resolvedID??'');choose.checked=ids.value.split(/[\n,]/).map(x=>x.trim()).includes(native);
        choose.disabled=coverage||!native;
        choose.addEventListener('change',()=>{
          const selected=new Set(ids.value.split(/[\n,]/).map(x=>x.trim()).filter(Boolean));
          if(choose.checked)selected.add(native);else selected.delete(native);ids.value=[...selected].join('\n');owner.changed();
        });
        return [choose,native,...names.map(name=>typeof record[name]==='object'?JSON.stringify(record[name]):record[name])];
      });
      sample.replaceChildren(table(['Select','Native ID',...names],rows));
      const schema=detail('All native field names and types');schema.append(table(['Field','Type'],Object.entries(value.fields||{})));sample.append(schema);
      owner.changed();
    }catch(error){owner.error(error);}finally{inspect.disabled=false;}
  });
  details.append(layer.wrap,idField.wrap);
  if(!coverage)details.append(filters,add,idsWrap);
  else details.append(el('p','Mapping coverage uses all native status records inside the reporting boundary.','wc-note'));
  details.append(fieldNames,inspect,info,sample);fieldset.append(source.wrap,details);
  function changedSource(){
    filterRows.splice(0).forEach(row=>row.row.remove());ids.value='';layer.control.value='';idField.control.value='';
    sample.replaceChildren();info.textContent='';refreshMode();owner.changed();
  }
  function refreshMode(){
    const entry=owner.sources().find(x=>sourceKey(x)===source.control.value),raster=entry?.kind==='raster';
    for(const control of details.querySelectorAll('input,textarea,select,button'))control.disabled=!!raster;
    inspect.disabled=false;
    if(raster)info.textContent='Original NWI grid footprints use this reporting boundary. Its paired mapping-status layer is available automatically.';
  }
  source.control.addEventListener('change',changedSource);
  for(const control of [layer.control,idField.control])control.addEventListener('change',()=>{sample.replaceChildren();info.textContent='Inspect this native layer and ID field to refresh the attribute sample.';});
  fieldset.addEventListener('input',owner.changed);fieldset.addEventListener('change',owner.changed);
  function refresh(){
    const previous=source.control.value;source.control.replaceChildren();
    const placeholder=el('option',required?'Choose a reporting boundary':'Select an optional source');placeholder.value='';source.control.append(placeholder);
    const entries=owner.sources().filter(row=>boundary?row.kind==='vector':row.kind==='vector'||
      ((key==='wetlands'||coverage)&&row.kind==='raster'&&row.role==='NWI_CONTEXT'));
    entries.sort((a,b)=>Number(b.suggested_category===key)-Number(a.suggested_category===key)||String(a.title).localeCompare(String(b.title)));
    for(const row of entries){
      const option=el('option',row.title+' · '+(row.role||row.kind)+' · '+row.source_id+' ['+row.collection_id.slice(0,8)+']');
      option.value=sourceKey(row);source.control.append(option);
    }
    if(previous&&!entries.some(row=>sourceKey(row)===previous)){const missing=el('option','Saved source '+sourceReference(previous).source_id+' — refresh its source collection');missing.value=previous;source.control.append(missing);}
    source.control.value=previous;refreshMode();
  }
  function read(){
    const ref=sourceReference(source.control.value);if(!ref){if(required)throw new Error('Choose a retained polygon source for the reporting boundary.');return null;}
    const entry=owner.sources().find(x=>sourceKey(x)===source.control.value);
    if(coverage&&entry?.kind==='raster')ref.component='mapping_status';
    if(entry?.kind!=='raster'){
      if(layer.control.value.trim())ref.layer=layer.control.value.trim();
      if(idField.control.value.trim())ref.id_field=idField.control.value.trim();
      if(!coverage){
        const where={};
        for(const row of filterRows){
          const name=row.name.value.trim();if(!name)continue;if(Object.hasOwn(where,name))throw new Error('Each native field can appear once per source filter.');
          where[name]=typeValue(row.value.value,row.type.value);
        }
        if(Object.keys(where).length)ref.where=where;
        const values=ids.value.split(/[\n,]/).map(x=>x.trim()).filter(Boolean);if(values.length)ref.feature_ids=[...new Set(values)];
      }
    }
    return ref;
  }
  function write(ref){
    const value=sourceKey(ref);source.control.value=value;
    if(value&&source.control.value!==value){const option=el('option','Saved source '+ref.source_id);option.value=value;source.control.append(option);source.control.value=value;}
    layer.control.value=ref?.layer||'';idField.control.value=ref?.id_field||'';ids.value=(ref?.feature_ids||[]).join('\n');
    filterRows.splice(0).forEach(row=>row.row.remove());for(const [name,value] of Object.entries(ref?.where||{}))addFilter(name,value);
    sample.replaceChildren();info.textContent='';refreshMode();
  }
  return {node:fieldset,read,write,refresh};
}

export function attachWaterContext(host){
  let root=null,workspace=null,generation=0,latestState=null,sources=[],catalogue=null,current=null,map=null,openId=null,pendingTask=null;
  let editors={},titleInput=null,crsInput=null,statusNode=null,resultsNode=null,savedSelect=null,runButton=null,catalogButton=null,draftNote=null;
  let savedRows=[],autoOpenedTask=null,lastStateSignature=null,openRequest=0;
  const storageKey=()=> 'upstate.water-context.draft/v1:'+workspace;
  const currentWorkspace=()=>host.getState()?.workspace_key??null;
  const toast=error=>{const text=error?.message||String(error);if(statusNode){statusNode.textContent=text;statusNode.setAttribute('role','alert');}host.toast?.(text);};
  function assertCurrent(token,key){return root&&generation===token&&workspace===key&&currentWorkspace()===key;}
  async function read(path,payload={}){
    const token=generation,key=workspace;
    const value=await host.api(path,{method:'POST',body:{workspace:key,...payload}});
    return assertCurrent(token,key)?value:null;
  }
  function setStatus(text){if(statusNode){statusNode.textContent=text;statusNode.setAttribute('role','status');}}
  function spec(){
    const overlays={};for(const category of CATEGORIES){const value=editors[category].read();if(value)overlays[category]=value;}
    const relations=[];for(const kind of ['huc','utility']){const value=editors[kind].read();if(value)relations.push({kind,...value});}
    return {title:titleInput.value.trim()||'Water and Habitat Context',boundary:editors.boundary.read(),overlays,
      measurement_crs:crsInput.value.trim()||'EPSG:5070',relations};
  }
  function changed(){
    try{const selection=selectionWithAdditional();localStorage.setItem(storageKey(),JSON.stringify(selection));if(draftNote)draftNote.textContent='Selection draft saved on this browser. Completed analyses retain the selection in the scientific workspace.';}catch(_){}
  }
  function writeSelection(selection){
    titleInput.value=selection.title||'Water and Habitat Context';crsInput.value=selection.measurement_crs||'EPSG:5070';
    editors.boundary.write(selection.boundary);
    for(const category of CATEGORIES)editors[category].write(selection.overlays?.[category]||null);
    for(const kind of ['huc','utility']){
      const choices=(selection.relations||[]).filter(row=>row.kind===kind);
      editors[kind].write(choices[0]||null);
      // Preserve extra relation sources without silently dropping a saved selection.
      editors[kind].additional=choices.slice(1);
    }
    const extra=root?.querySelector('.wc-additional-relations');if(extra){extra.replaceChildren();
      for(const kind of ['huc','utility'])for(const ref of [...(editors[kind].additional||[])]){
        const row=el('p',kind+' additional retained source: '+ref.source_id+' ');
        row.append(button('Remove this additional source',()=>{editors[kind].additional=editors[kind].additional.filter(item=>item!==ref);row.remove();changed();}));extra.append(row);
      }
    }
    changed();
  }
  function selectionWithAdditional(){
    const value=spec();
    for(const kind of ['huc','utility'])for(const ref of editors[kind].additional||[])value.relations.push(ref);
    return value;
  }
  function selectionDetails(selection){
    const section=detail('Saved source and boundary selection');
    const pre=el('pre',JSON.stringify(selection,null,2));section.append(pre);return section;
  }
  async function sourceInfo(ref){
    const token=generation,key=workspace;
    const query=new URLSearchParams({workspace:key,collection:ref.collection_id,source:ref.source_id});
    if(ref.layer)query.set('layer',ref.layer);
    const value=await host.api('/api/source-info?'+query.toString());
    return assertCurrent(token,key)?value:null;
  }
  function updateSaved(rows){
    savedRows=rows||[];if(!savedSelect)return;
    const selected=savedSelect.value||openId||'';savedSelect.replaceChildren();
    const placeholder=el('option','Choose a saved analysis');placeholder.value='';savedSelect.append(placeholder);
    for(const row of savedRows){
      const label=(row.title||'Water and Habitat Context')+' · '+(row.state||'saved')+' · '+String(row.created_at||'')+' · '+row.id.slice(0,10);
      const option=el('option',label);option.value=row.id;savedSelect.append(option);
    }
    savedSelect.value=selected;
  }
  async function refreshCatalog(){
    if(!root)return;
    const token=generation,key=workspace;catalogButton.disabled=true;
    try{
      const value=await read('/api/water-context/catalog');if(!value)return;
      catalogue=value;sources=value.sources||[];
      for(const editor of Object.values(editors))editor.refresh();
      updateSaved(value.analyses||[]);
      setStatus(sources.length+' retained source entries available.');
    }catch(error){if(assertCurrent(token,key))toast(error);}
    finally{if(assertCurrent(token,key))catalogButton.disabled=false;}
  }
  function metricSection(record){
    const summary=record.summary||{},section=el('section',undefined,'wc-section');
    section.append(el('h3','Selected-area inventory'));
    section.append(el('p','Reporting selection: '+number(summary.boundary_area_ha)+' ha. Area uses '+record.selection.measurement_crs+
      '; line lengths use WGS84 ellipsoidal geodesic measurement.','wc-note'));
    section.append(table(['Source context','Status','Unique native features','Area (ha)','Length (km)','Share of selection'],CATEGORIES.map(role=>{
      const row=summary[role]||{};return [row.label||LABELS[role],row.status||'unavailable',number(row.feature_count),
        number(row.area_ha),number(row.length_km),row.area_pct==null?'—':number(row.area_pct)+'%'];
    })));
    const status=summary.mapping_status||{},wetlands=summary.wetlands||{};
    const coverage=el('section',undefined,'wc-section');coverage.append(el('h3','NWI coverage and selected occurrence'));
    if(status.status==='available'){
      const values=[['Digital-only coverage',status.digital_area_ha],['Provider No_Data only',status.provider_no_data_area_ha],
        ['Conflicting coverage',status.conflicting_area_ha],['Unknown coverage',status.unknown_area_ha]];
      const bar=el('div',undefined,'wc-coverage-bar');bar.setAttribute('aria-label','NWI coverage partition');
      values.forEach(([name,value],index)=>{const part=el('span');part.className='wc-coverage-'+index;part.style.flexGrow=String(value||0);part.title=name+': '+number(value)+' ha';bar.append(part);});
      coverage.append(bar,table(['Coverage class','Area (ha)','Share of selection'],values.map(([name,value])=>[name,number(value),number(summary.boundary_area_ha?100*value/summary.boundary_area_ha:0)+'%'])));
      if(wetlands.status==='available')coverage.append(table(['Selected NWI occurrence','Area (ha)'],[
        ['Occurrence inside Digital-only coverage',number(wetlands.mapped_occurrence_area_ha)],
        ['Digital coverage without selected NWI occurrence',number(wetlands.mapped_no_selected_occurrence_area_ha)],
        ['Selected occurrence outside Digital-only coverage',number(wetlands.published_occurrence_outside_mapped_area_ha)]
      ]));
      coverage.append(el('p','Positive NWI occurrence remains visible where the separately dated coverage is No_Data, conflicting or unknown. The occurrence complement refers to the selected retained inventory and its filters.','wc-note'));
    }else coverage.append(el('p','Select the retained NWI mapping-status source, or the paired status companion of a prepared NWI_CONTEXT grid, to calculate coverage.'));
    section.append(coverage);
    for(const role of CATEGORIES){
      const row=summary[role]||{};if(!row.classes?.length&&!row.manager_classes?.length)continue;
      const classes=detail((row.label||LABELS[role])+' — native classes');
      for(const [name,values] of [['Native class',row.classes],['Manager category',row.manager_classes]]){
        if(!values?.length)continue;
        classes.append(el('h4',name),table(['Native field','Value','Features','Area (ha)','Length (km)'],values.map(item=>[
          item.source_fields?.join(', ')||item.field||item.native_field||'',typeof item.value==='object'?JSON.stringify(item.value):String(item.value??item.label??''),
          number(item.feature_count),number(item.area_ha),number(item.length_km)])));
      }
      classes.append(el('p','Class and manager groups can overlap. The headline inventory uses their geometric union.','wc-note'));section.append(classes);
    }
    return section;
  }
  function boundariesSection(record){
    const section=detail('HUC, utility and reporting-boundary relationships');
    const rows=record.boundary_summaries?.boundaries||record.boundary_summaries||[];
    if(!Array.isArray(rows)||!rows.length){section.append(el('p','Per-boundary CSV and JSON exports contain the saved relationships.'));return section;}
    section.append(table(['Kind','Native source / ID','Name','Original area (ha)','Selected overlap (ha)','Share of selection','Share of original boundary'],
      rows.map(row=>[row.kind,row.source_id+' / '+row.feature_id,row.label,number(row.source_boundary_area_ha),
        number(row.selected_overlap_area_ha),number(row.selection_share_pct)+'%',number(row.source_boundary_share_pct)+'%'])));
    section.append(el('p','Each row uses its own original native boundary. Overlapping HUC and utility summaries are interpreted independently. Inventory percentages within a row use its selected overlap.','wc-note'));
    return section;
  }
  function sourcesSection(record){
    const section=detail('Source editions and acquisition scope');
    section.append(table(['Context role','Retained source','Edition / vintage','Original URI','SHA-256'],(record.sources||[]).map(source=>{
      const uri=el('span',source.uri||'');
      if(/^https?:\/\//i.test(source.uri||'')){const link=el('a',source.uri);link.href=source.uri;link.target='_blank';link.rel='noopener noreferrer';uri.replaceChildren(link);}
      return [source.context_role,source.title+' · '+source.source_id,source.vintage,uri,source.sha256];
    })));
    for(const source of record.sources||[]){
      const scope=source.coverage||source.metadata?.coverage||source.scope;
      if(scope){const item=detail(source.title+' — coverage and lineage');item.append(el('pre',JSON.stringify({coverage:scope,metadata:source.metadata,
        native_lineage:source.native_lineage,grid:source.grid,codes:source.codes,mapping_status_codes:source.mapping_status_codes},null,2)));section.append(item);}
    }
    section.append(el('p','Acquisition scope describes where a source was collected. Polygon occurrence alone does not establish complete acquisition coverage.','wc-note'));return section;
  }
  function downloadsSection(record){
    const section=el('section',undefined,'wc-section');section.append(el('h3','Exports'));
    const links=el('div',undefined,'wc-downloads');
    for(const item of record._downloads||[]){
      if(!item.url)continue;
      const parsed=new URL(item.url,location.href);if(parsed.origin!==location.origin)continue;
      const link=el('a',item.label||item.name||item.filename||item.path||'Download');
      link.href=item.url;link.setAttribute('download','');links.append(link);
    }
    section.append(links,el('p','The analysis ZIP carries full derived GIS, tables and source references. Use the existing workspace backup to transfer the retained original inputs and reopen the editable project.','wc-note'));
    return section;
  }
  async function openAnalysis(id,{restore=false}={}){
    if(!id)return;
    const token=generation,key=workspace,request=++openRequest;setStatus('Opening saved analysis…');
    try{
      const record=await read('/api/water-context/analysis',{analysis_id:id});if(!record||request!==openRequest)return;
      current=record;openId=record.id;savedSelect.value=record.id;map?.destroy();map=null;resultsNode.replaceChildren();
      const header=el('div',undefined,'wc-result-header');header.append(el('h2',record.title),el('span',record.state,'wc-status'));
      resultsNode.append(header,el('p','Saved '+String(record.created_at||'')+' · '+record.id,'wc-note'),
        button('Use this saved selection',()=>{writeSelection(record.selection);setStatus('Saved selection loaded for another run.');}),selectionDetails(record.selection));
      if(restore)writeSelection(record.selection);
      if(record.state!=='complete'){resultsNode.append(el('p',record.error?.message||(typeof record.error==='string'?record.error:null)||'This saved attempt retains its selected inputs. Reuse its selection to run again.'));setStatus('Saved '+record.state+' attempt opened.');return;}
      const mapSection=el('section',undefined,'wc-section'),mapNode=el('div');mapSection.append(el('h3','Context map'),mapNode);resultsNode.append(mapSection);
      resultsNode.append(metricSection(record),boundariesSection(record),sourcesSection(record),downloadsSection(record));
      const preview=await read('/api/water-context/preview',{analysis_id:id});
      if(preview&&assertCurrent(token,key)&&openId===id&&request===openRequest)map=createWaterContextMap(mapNode,preview);
      if(assertCurrent(token,key)&&request===openRequest)setStatus('Saved analysis opened.');
    }catch(error){if(assertCurrent(token,key)&&request===openRequest)toast(error);}
  }
  async function build(){
    const token=generation,key=workspace;
    try{
      const selection=selectionWithAdditional();runButton.disabled=true;setStatus('Submitting the selected context analysis…');
      const operation=globalThis.crypto?.randomUUID?crypto.randomUUID():('water-context-'+Date.now()+'-'+Math.random().toString(36).slice(2));
      const task=await host.api('/api/actions',{method:'POST',body:{workspace:key,action:'water-context.build',payload:{selection},operation_id:operation}});
      if(!assertCurrent(token,key))return;
      pendingTask=task.id;setStatus('Context analysis queued. The existing task desk shows its progress.');
      await (host.refreshState||host.refresh)?.();if(assertCurrent(token,key))await host.showTask?.(task.id);
    }catch(error){if(assertCurrent(token,key))toast(error);}
    finally{if(assertCurrent(token,key))runButton.disabled=false;}
  }

  function mount(node,state=host.getState()){
    detach();root=node;workspace=state.workspace_key??null;latestState=state;generation+=1;current=null;openId=null;pendingTask=null;autoOpenedTask=null;lastStateSignature=null;sources=[];catalogue=null;
    root.replaceChildren();root.classList.add('water-context-desk');
    const heading=el('header',undefined,'wc-heading');heading.append(el('h1','Water and Habitat Context'),
      el('p','Inspect retained water, aquatic habitat and land inventories within a reporting boundary. Save the selection, review its native context and export a complete analysis.'));
    statusNode=el('p','Opening retained source catalogue…','wc-live-status');statusNode.setAttribute('role','status');statusNode.setAttribute('aria-live','polite');
    root.append(heading,statusNode);
    if(!workspace){setStatus('Open a scientific workspace to select its retained source editions.');return;}
    const saved=el('section',undefined,'wc-saved-bar'),savedControl=select('Saved analysis');savedSelect=savedControl.control;
    saved.append(savedControl.wrap,button('Open saved analysis',()=>openAnalysis(savedSelect.value)),button('Refresh analyses and sources',refreshCatalog));
    root.append(saved);
    const layout=el('div',undefined,'wc-layout'),controls=el('section',undefined,'wc-controls'),form=el('form'),results=el('section',undefined,'wc-results');
    resultsNode=results;results.append(el('h2','Build a context analysis'),el('p','Choose the reporting boundary and available source inventories. Completed analyses appear here with their map, coverage, native classes and downloads.'));
    layout.append(controls,results);root.append(layout);
    const title=input('Analysis title');titleInput=title.control;titleInput.value='Water and Habitat Context';form.append(title.wrap);
    const owner={sources:()=>sources,changed,error:toast,sourceInfo};
    editors={boundary:referenceEditor(owner,'boundary','Reporting boundary',{required:true,boundary:true})};
    form.append(editors.boundary.node);
    const sourceGroup=el('section');sourceGroup.append(el('h2','Source inventories'));
    for(const category of CATEGORIES){editors[category]=referenceEditor(owner,category,LABELS[category],{coverage:category==='mapping_status'});sourceGroup.append(editors[category].node);}
    form.append(sourceGroup);
    const relations=detail('HUC and utility relationships');
    for(const kind of ['huc','utility']){editors[kind]=referenceEditor(owner,kind,kind==='huc'?'HUC boundary source':'Utility boundary source',{boundary:true});relations.append(editors[kind].node);}
    const extra=el('div',undefined,'wc-additional-relations');relations.append(extra);
    relations.append(el('p','These are geometric overlaps with the supplied native boundaries. A source-water protection buffer retains its original footprint meaning.','wc-note'));form.append(relations);
    const method=detail('Area measurement and saved selection');
    const crs=input('Projected area CRS with metre units');crsInput=crs.control;crsInput.value='EPSG:5070';method.append(crs.wrap);
    method.append(el('p','EPSG:5070 is the default area projection for this study. Line lengths use WGS84 geodesic measurement.','wc-note'));
    const selectionTools=el('div',undefined,'wc-toolbar');
    const upload=el('input');upload.type='file';upload.accept='.json,application/json';upload.hidden=true;
    upload.addEventListener('change',async()=>{
      const file=upload.files?.[0],token=generation,key=workspace;if(!file)return;
      try{const value=JSON.parse(await file.text());if(assertCurrent(token,key)){writeSelection(value.selection||value);setStatus('Selection file opened. Retained source IDs remain attached to their original collections.');}}
      catch(error){if(assertCurrent(token,key))toast(error);}finally{upload.value='';}
    });
    selectionTools.append(button('Export selection JSON',()=>{
      try{
        const url=URL.createObjectURL(new Blob([JSON.stringify(selectionWithAdditional(),null,2)+'\n'],{type:'application/json'}));
        const link=el('a');link.href=url;link.download='water-context-selection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }catch(error){toast(error);}
    }),button('Open selection JSON',()=>upload.click()),upload);
    method.append(selectionTools);form.append(method);
    draftNote=el('p','Completed analyses retain their source choices in the scientific workspace.','wc-note');form.append(draftNote);
    const actions=el('div',undefined,'wc-toolbar');runButton=button('Run context analysis',build);runButton.className='wc-primary';
    catalogButton=button('Refresh retained sources',refreshCatalog);actions.append(runButton,catalogButton);
    if(host.navigate)actions.append(button('Prepare sources',()=>host.navigate('source-preparation')));
    form.append(actions);form.addEventListener('submit',event=>{event.preventDefault();build();});
    titleInput.addEventListener('input',changed);crsInput.addEventListener('input',changed);controls.append(form);
    try{const draft=localStorage.getItem(storageKey());if(draft)writeSelection(JSON.parse(draft));}catch(_){}
    update(state);refreshCatalog();
  }
  function update(state=host.getState()){
    latestState=state;if(!root)return;
    if((state.workspace_key??null)!==workspace){detach();return;}
    const nativeState=state.data?.water_context||state.water_context;
    if(nativeState?.analyses)updateSaved(nativeState.analyses);
    const tasks=state.tasks||state.data?.tasks||[];
    const task=pendingTask&&tasks.find(item=>item.id===pendingTask);
    if(task){
      const signature=JSON.stringify([task.id,task.state,task.error?.message||task.error,task.result?.analysis_id||task.result?.id]);
      if(signature!==lastStateSignature){
        lastStateSignature=signature;
        if(task.state==='complete'){
          const id=task.result?.analysis_id||task.result?.id;
          setStatus('Context analysis completed.');pendingTask=null;
          refreshCatalog();if(id&&autoOpenedTask!==task.id){autoOpenedTask=task.id;openAnalysis(id);}
        }else if(task.state==='failed'){
          setStatus('Context analysis failed: '+String(task.error?.message||task.error||'Open its task detail for the recorded input error.'));pendingTask=null;
        }else setStatus('Context analysis '+task.state+'. Open the existing task desk for progress and messages.');
      }
    }
  }
  function detach(){
    if(root&&workspace){try{changed();}catch(_){}}
    generation+=1;map?.destroy();map=null;root?.classList.remove('water-context-desk');root=null;workspace=null;editors={};
  }
  return {mount,update,detach,open:openAnalysis};
}
