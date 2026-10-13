/** Exact native input navigation; calculations and collection exports stay native. */
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const serial=value=>JSON.stringify(value);
const validId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>serial(a)===serial(b);

export function createLineageNavigator({host,onSelectRefs,onOpenCollection,onNotice=()=>{}}){
 const doc=host.document||document,storage=host.storage||globalThis.sessionStorage;
 let root=null,workspace=null,generation=0,flight=0,detailFlight=0,graph=null,selected=null,pinned=null;
 let history=[],message='',detail=null,filter='',busy=false;
 const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!=null)n.textContent=String(text);if(cls)n.className=cls;return n;};
 const button=(label,fn,action)=>{const n=el('button',label);n.type='button';if(action)n.dataset.lineageAction=action;
  n.addEventListener('click',()=>{const g=generation,w=workspace;Promise.resolve().then(()=>{
   if(root&&g===generation&&workspace===w)return fn();
  }).catch(error=>{if(root&&g===generation&&workspace===w){message=error.message;render();onNotice(message);}});});return n;};
 const details=(title,value)=>{const n=el('details');n.append(el('summary',title),el('pre',JSON.stringify(value,null,2)));return n;};
 const key=w=>'upstate-investigation-lineage:'+w;
 function retain(){
  if(!workspace)return;
  const value={schema:'upstate.investigation-lineage-working/v1',workspace_key:workspace,
   selected,pinned,history,filter};
  try{storage.setItem(key(workspace),serial(value));
   if(storage.getItem(key(workspace))!==serial(value))throw Error('readback');
  }catch{message='The current source view could not be retained in this browser. Keep its displayed selection before leaving.';onNotice(message);}
 }
 function load(w){
  const raw=storage.getItem(key(w));if(!raw)return;
  const value=JSON.parse(raw);
  if(value.schema!=='upstate.investigation-lineage-working/v1'||value.workspace_key!==w||!Array.isArray(value.history))
   throw Error('The saved source navigation belongs to another workspace.');
  selected=value.selected||null;pinned=value.pinned||null;history=value.history;filter=value.filter||'';
 }
 const endpoint=(name,payload,w)=>'/api/intelligence/'+name+'?'+new URLSearchParams(Object.entries({workspace:w,...payload}).filter(([,value])=>value!=null));
 function scope(extra={}){
  if(!graph)throw Error('Open an original run or prepared grid first.');
  return {...graph.selected,lineage_sha256:graph.lineage_sha256,...extra};
 }
 function link(file,label){
  if(!/^\/api\/file\/[a-f0-9]{64}(?:\?.*)?$/.test(file?.url||''))return null;
  const a=el('a',label||file.label||file.filename||'Download original');
  a.href=file.url+(file.url.includes('?')?'&':'?')+'download=1';a.download='';
  a.dataset.lineageDownload=file.sha256||'';return a;
 }
 function changed(){retain();render();}
 async function open(selection,{expected=null}={}){
  if(!root||!workspace)throw Error('Open Investigations in an original workspace.');
  const query={};
  for(const key of ['grid_id','run_id'])if(selection?.[key]!=null){if(!validId(selection[key]))throw Error('Choose an original grid or run ID.');query[key]=selection[key];}
  if(!Object.keys(query).length)throw Error('Choose a native run or a prepared-grid resource.');
  const g=generation,w=workspace,id=++flight;detailFlight++;busy=true;graph=null;detail=null;message='';
  selected=query;pinned=expected;changed();
  try{
   const value=await host.api(endpoint('lineage',{...query,...(expected?{lineage_sha256:expected}:{})},w));
   if(g!==generation||w!==workspace||id!==flight)return null;
   if(value.workspace_key!==w||!validId(value.lineage_sha256)||
      (query.run_id&&value.selected?.run_id!==query.run_id)||
      (query.grid_id&&value.selected?.grid_id!==query.grid_id))
    throw Error('The original source view returned another selection.');
   graph=value;selected=clone(value.selected);pinned=value.lineage_sha256;
   const item={selected:clone(selected),lineage_sha256:pinned,label:query.run_id?'Run '+query.run_id:'Grid '+query.grid_id};
   if(!history.some(row=>same(row.selected,item.selected)&&row.lineage_sha256===item.lineage_sha256))history.push(item);
   return value;
  }catch(error){if(g===generation&&w===workspace&&id===flight)message=error.message;throw error;}
  finally{if(g===generation&&w===workspace&&id===flight){busy=false;changed();}}
 }
 async function source(row){
  const g=generation,w=workspace,id=++detailFlight,sha=graph.lineage_sha256,selectedKey=row.key;
  detail={loading:true,key:selectedKey};render();
  try{
   const value=await host.api(endpoint('lineage-source',scope({collection_id:row.collection_id,source_id:row.id}),w));
   if(g!==generation||w!==workspace||id!==detailFlight||graph?.lineage_sha256!==sha)return;
   if(value.workspace_key!==w||value.lineage_sha256!==sha||value.source?.key!==selectedKey)
    throw Error('The selected source details belong to another original edition.');
   detail=value;message='';render();root.querySelector('[data-lineage-detail]')?.focus({preventScroll:true});
  }catch(error){if(g===generation&&w===workspace&&id===detailFlight){detail={error:error.message,key:selectedKey};render();}throw error;}
 }
 async function prepared(row){
  const g=generation,w=workspace,id=++detailFlight,sha=graph.lineage_sha256;
  detail={loading:true};render();
  const value=await host.api(endpoint('lineage-file',scope({dataset_id:row.ref.id}),w));
  if(g!==generation||w!==workspace||id!==detailFlight||graph?.lineage_sha256!==sha)return;
  if(value.workspace_key!==w||value.lineage_sha256!==sha||value.file?.ref?.id!==row.ref.id)
   throw Error('The prepared file belongs to another original selection.');
  detail={prepared:value};render();
 }
 function selectRefs(refs){
  if(!Array.isArray(refs)||!refs.length)throw Error('No complete registered originals are selected.');
  onSelectRefs(clone(refs));onOpenCollection();
 }
 function sourceCard(row){
  const card=el('article',null,'intelligence-plan');card.dataset.lineageSource=row.key;
  card.append(el('h4',row.title||row.id),el('p',(row.collection_title||row.collection_id)+' · '+row.id),
   el('p',[row.kind,row.vintage,row.units||row.unit].filter(Boolean).join(' · '),'intelligence-muted'));
  const list=el('ul');for(const use of row.uses||[])list.append(el('li',use));card.append(list);
  card.append(button('Open original files and companions',()=>source(row),'open-source'));
  const add=button('Add this source and companions to collection',()=>selectRefs(row.files.map(file=>file.ref)),'select-source');
  add.disabled=!row.export_complete;card.append(add);
  for(const file of row.files||[])card.append(el('p',(file.role==='primary'?'Original':'Companion')+': '+file.member+
   ' · '+file.bytes+' bytes · SHA-256 '+file.sha256,'intelligence-id'));
  if(!row.export_complete)card.append(el('p','A member is unavailable. Open its original metadata before selecting a partial collection.','intelligence-notice'));
  return card;
 }
 function renderDetail(target){
  target.dataset.lineageDetail='true';target.tabIndex=-1;
  if(!detail)return;
  if(detail.loading){target.append(el('p','Verifying the selected original bodies…'));return;}
  if(detail.error){target.append(el('p',detail.error,'intelligence-notice'));return;}
  if(detail.prepared){const v=detail.prepared;target.append(el('h3','Prepared '+v.file.role));
   const a=link(v.download);if(a)target.append(a);
   target.append(details('Complete prepared member and byte identity',v.file));return;
  }
  target.dataset.lineageDetailSource=detail.source.key;
  target.append(el('h3',detail.source.title||detail.source.id),el('p','Original collection '+detail.source.collection_id,'intelligence-id'));
  for(const file of detail.source.files){
   const row=el('div',null,'intelligence-retained-source');
   row.append(el('strong',(file.role==='primary'?'Original file':'Required companion')+' · '+file.member));
   const a=link(file.download);if(a)row.append(a);
   row.append(el('small',file.bytes+' bytes · SHA-256 '+file.sha256));
   if(file.issue)row.append(el('p',file.issue));target.append(row);
  }
  const original=link(detail.original_manifest,'Download complete original collection manifest');
  if(original)target.append(original);
  target.append(details('Complete source metadata and original use links',detail.source),
   details('Complete collection provenance',detail.collection),
   details('Ordered selected dependencies',detail.dependencies));
 }
 function render(){
  if(!root)return;root.replaceChildren();delete root.dataset.lineageSha;
  const head=el('div',null,'intelligence-inline');head.append(el('h2','Original input lineage'));
  if(selected){head.append(button('Reopen this source edition',()=>open(selected,{expected:pinned}),'reopen'));
   head.append(button('Read current original selection',()=>open(selected),'refresh'));}
  root.append(head,el('p','Follow the selected grid, profile and ordered scenario masks to their exact retained source editions. Opening a file verifies its bytes; adding originals uses the existing collection exporter.','intelligence-muted'));
  if(message){const n=el('p',message,'intelligence-notice');n.setAttribute('role','status');root.append(n);}
  if(history.length){const label=el('label','Retained source views'),choose=el('select');choose.dataset.lineageField='history';
   const placeholder=el('option','Choose an earlier original selection');placeholder.value='';choose.append(placeholder);
   history.forEach((item,index)=>{const o=el('option',item.label+' · '+item.lineage_sha256.slice(0,12));o.value=String(index);choose.append(o);});
   choose.addEventListener('change',()=>{if(choose.value==='')return;const index=Number(choose.value);if(!Number.isInteger(index)||index<0||index>=history.length)return;const item=history[index];open(item.selected,{expected:item.lineage_sha256}).catch(error=>onNotice(error.message));});
   label.append(choose);root.append(label);}
  if(busy){root.append(el('p','Reading original scientific inputs…'));return;}
  if(!graph){root.append(el('p','Choose a native run or prepared-grid resource, then Open input lineage.','intelligence-muted'));return;}
  root.dataset.lineageSha=graph.lineage_sha256;
  root.append(el('p',(graph.selected.run_id?'Run '+graph.selected.run_id:'Prepared grid '+graph.selected.grid_id),'intelligence-id'),
   el('p','Source view SHA-256 '+graph.lineage_sha256,'intelligence-id'));
  const add=button('Add all original inputs and companions to collection',()=>selectRefs(graph.original_refs),'select-all');
  add.disabled=!graph.export_complete;root.append(add);
  if(!graph.export_complete)root.append(el('p','The complete selection has unavailable inputs. Each issue below retains its original selection; resolved sources can be opened individually.','intelligence-notice'));
  for(const issue of [...graph.issues,...graph.registry_issues])root.append(el('p',(issue.id||issue.source_key||'Original input')+': '+issue.message,'intelligence-notice'));
  const dependencies=el('ol');dependencies.dataset.lineageDependencies='true';
  for(const edge of graph.dependencies){const li=el('li');li.dataset.lineageDependency=edge.id;
   li.append(el('strong',edge.use),el('p',String(edge.collection_id)+' / '+String(edge.source_id),'intelligence-id'));
   const row=graph.sources.find(source=>source.key===edge.source_key);
   if(row)li.append(button('Open this exact source',()=>source(row),'open-dependency'));
   else li.append(el('p',edge.issue?.message||'The selected original is unavailable.','intelligence-notice'));
   if(edge.patch)li.append(details('Original ordered patch '+(edge.patch_index+1),edge.patch));dependencies.append(li);}
  root.append(el('h3','Selected uses in native order'),dependencies);
  root.append(details('Original grid preparation and spatial support',graph.grid),
   details('Original profile parameters and biophysical selection',graph.profiles),
   details('Complete original scenarios',graph.scenarios),
   details('Native run selections',graph.runs));
  const search=el('label','Find an original input'),input=el('input');input.type='search';input.value=filter;
  input.dataset.lineageField='filter';search.append(input);root.append(search);
  const cards=el('div');root.append(cards);
  const fill=()=>{cards.replaceChildren();const term=filter.toLowerCase();for(const row of graph.sources)
   if(!term||serial([row.id,row.title,row.collection_id,row.collection_title,row.uses]).toLowerCase().includes(term))cards.append(sourceCard(row));};
  input.addEventListener('input',()=>{filter=input.value;retain();fill();});fill();
  const preparedList=el('details');preparedList.append(el('summary','Prepared grid files ('+graph.prepared_files.length+')'));
  for(const row of graph.prepared_files){const item=el('div',null,'intelligence-inline');
   item.append(el('span',row.role+' · '+row.bytes+' bytes'));
   if(row.ref){item.append(button('Open verified prepared file',()=>prepared(row),'open-prepared'),
    button('Add prepared file to collection',()=>selectRefs([row.ref]),'select-prepared'));}
   else item.append(el('p',row.issue));preparedList.append(item);}
  root.append(preparedList);
  const target=el('section',null,'intelligence-plan');renderDetail(target);root.append(target);
 }
 return {
  async mount(node,w){this.detach();root=node;workspace=w;generation++;selected=null;pinned=null;history=[];filter='';message='';
   try{load(w);}catch(error){message=error.message;}
   render();if(selected)await open(selected,{expected:pinned}).catch(error=>{message=error.message;render();});},
  open,
  async openResource(resource,state){
   if(resource?.kind==='job')return open({run_id:resource.id});
   const row=state?.catalog?.inventory?.datasets?.find(row=>row.id===resource?.id);
   const grid=row?.metadata?.grid_id;
   if(grid)return open({grid_id:grid});
   throw Error('Choose a native run or prepared-grid resource to open its exact inputs.');
  },
  detach(){generation++;flight++;detailFlight++;if(root)retain();root=null;workspace=null;graph=null;detail=null;busy=false;},
  snapshot(){return clone({workspace,selected,pinned,graph,detail,history});}
 };
}
