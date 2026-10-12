// MIT. The receiving interface for the original compensation workbench.
import {receivingReport} from './report.mjs';

const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const fullSnapshot = value => Array.isArray(value?.rows) && value.rows.length > 0 &&
  value.rows.every(row=>row && Object.hasOwn(row,'data'));
const asText = value => value === undefined ? '[absent]' : value === null ? 'null' :
  typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const safeName = value => String(value || 'receiving').replace(/[^a-zA-Z0-9._-]/g,'_');
const RETURN_ACTIONS = [
  ['accept','Accept receiving values'],['request-pricing-review','Request pricing review'],
  ['exclude','Exclude from this receiving review'],['follow-up','Follow up with recipient']
];
const ANNUAL_ACTIONS = [
  ['accept-update','Accept current edition'],['keep-prior','Keep prior receiving reference'],
  ['needs-pricing-review','Request pricing review'],['exclude','Exclude from this receiving review']
];
const label = value => String(value ?? '').replaceAll('-',' ').replaceAll('_',' ');

/**
 * The host API commits create/review operations before returning their result.
 * api(action,payload) follows the original receiving wire API. The host supplies
 * metadata-only state. snapshot/document load complete original records on demand;
 * source revisions remain independent of receiving-only writes. Mutations send
 * compact original references; complete JSON downloads come from exportRecord.
 */
export function mountReceiving(target, {
  snapshots = [], state = {}, actor = '', api, download, onSaved, onOpenAnalysis
} = {}) {
  if (!target?.ownerDocument || typeof api !== 'function') throw new TypeError('Provide a receiving container and its original workspace API.');
  const document = target.ownerDocument, window = document.defaultView ?? globalThis;
  snapshots = snapshots.length ? snapshots : state.snapshots ?? [];
  let disposed = false, busy = false, tab = 'delivery', operator = typeof actor === 'function' ? actor() : actor;
  let snapshotId = snapshots[0]?.id ?? '', selectedRows = new Set(), fieldCatalog = [], fieldToken = 0;
  let profile = freshProfile(), handoffPreview = null, createdHandoff = null, returnPreview = null, annualComparison = null;
  let returnHandoffId = '', previousId = '', currentId = '';
  let returnedContent = '', returnedFilename = '', returnFormat = null, returnDecisions = new Map(), annualDecisions = new Map();
  let explicitPairs = false, pairs = [], openedRecord = null;
  let returnColumnMapping = {}, showColumnMapping = false, originalReturnColumns = [];
  let importContent = '', importFilename = '';
  const pageStates = new Map(), snapshotCache = new Map(), documentCache = new Map(), busyControls = new Map();
  let selectedInitializedFor = '';
  for (const snapshot of snapshots) if (fullSnapshot(snapshot)) snapshotCache.set(snapshot.id,snapshot);
  for (const [collection,kind] of [['handoffs','handoff'],['returnReviews','return-review'],['annualReviews','annual-review']]) {
    for (const record of state[collection] ?? []) if (Array.isArray(record.rows) || Array.isArray(record.entries))
      documentCache.set(kind+'/'+record.id,record);
  }
  const root = make('section',undefined,'receiving'), notice = make('div',undefined,'notice'), contents = make('div');
  root.setAttribute('aria-label','Compensation receiving workbench'); notice.setAttribute('role','status'); notice.setAttribute('aria-live','polite');
  const heading = make('div',undefined,'inline'), operatorInput = make('input'); operatorInput.value = operator || '';
  operatorInput.setAttribute('aria-label','Receiving operator'); operatorInput.addEventListener('input',()=>{operator=operatorInput.value;});
  heading.append(make('h3','Receiving and annual review'),labeled('Operator',operatorInput));
  const navigation = make('div',undefined,'actions'); navigation.setAttribute('role','tablist'); navigation.setAttribute('aria-label','Receiving workflow');
  const tabButtons = new Map();
  for (const [key,title] of [['delivery','Prepare handback'],['returns','Returned corrections'],['annual','Annual editions'],['history','Saved receiving history']]) {
    const control = button(title,async()=>{tab=key;render();await loadTab();}); control.id = 'receiving-tab-' + key;
    control.setAttribute('role','tab'); control.setAttribute('aria-controls','receiving-panel'); tabButtons.set(key,control); navigation.append(control);
  }
  contents.id = 'receiving-panel'; contents.setAttribute('role','tabpanel');
  root.append(heading,navigation,notice,contents); target.replaceChildren(root);
  const firstSnapshot = selectedSnapshot();
  if (firstSnapshot) {selectedRows = new Set(firstSnapshot.rows.map(row=>row.id));selectedInitializedFor=firstSnapshot.id;}

  function freshProfile() {
    return {id:'recipient-profile',label:'Receiving handback',recipient:'',format:'csv',lineEnding:'CRLF',bom:false,columns:[],sourceNote:''};
  }
  function make(tag,value,className) {
    const node=document.createElement(tag); if(value!==undefined)node.textContent=asText(value);if(className)node.className=className;return node;
  }
  function pre(value) { return make('pre',asText(value),'code'); }
  function small(value) {return make('span',value,'muted small');}
  function badge(value) {return make('span',label(value),'badge');}
  function line(name,value) {const p=make('p');p.append(make('strong',name+': '),make('span',value));return p;}
  function actions(...nodes) {const value=make('div',undefined,'actions');value.append(...nodes);return value;}
  function panel(title) {const value=make('section',undefined,'panel');if(title)value.append(make('h3',title));return value;}
  function labeled(title,input) {const value=make('label',title);value.append(input);return value;}
  function input(title,value,change,type='text') {
    const control=make(type==='textarea'?'textarea':'input');if(type!=='textarea')control.type=type;
    control.value=value??'';control.setAttribute('aria-label',title);
    control.addEventListener('input',()=>change(control.value));return control;
  }
  function select(title,value,options,change) {
    const control=make('select');control.setAttribute('aria-label',title);
    for(const [id,name] of options){const option=make('option',name);option.value=id;control.append(option);}
    control.value=value??'';control.addEventListener('change',()=>change(control.value));return control;
  }
  function checkbox(title,value,change) {
    const control=make('input');control.type='checkbox';control.checked=Boolean(value);control.setAttribute('aria-label',title);
    control.addEventListener('change',()=>change(control.checked));return control;
  }
  function button(title,work,className) {
    const control=make('button',title,className);control.type='button';
    control.addEventListener('click',()=>perform(work));return control;
  }
  function lazy(title,build) {
    const details=make('details'),summary=make('summary',title);let loaded=false;details.append(summary);
    details.addEventListener('toggle',()=>{if(details.open&&!loaded){loaded=true;details.append(build());}});return details;
  }
  function table(headers,rows,caption) {
    const wrap=make('div',undefined,'scroll'),element=make('table'),head=make('thead'),headRow=make('tr'),body=make('tbody');
    if(caption)element.append(make('caption',caption));
    for(const title of headers){const th=make('th',title);th.scope='col';headRow.append(th);}
    head.append(headRow);element.append(head,body);
    for(const row of rows){const tr=make('tr');for(const value of row){const td=make('td');td.append(value?.nodeType?value:document.createTextNode(asText(value)));tr.append(td);}body.append(tr);}
    wrap.append(element);return wrap;
  }
  function issueTable(issues=[]) {
    if(!issues.length)return small('No recorded issues.');
    return table(['Severity','Record / column','Issue'],issues.map(issue=>[
      badge(issue.severity??''),[issue.rowId,issue.header].filter(Boolean).join(' / '),issue.message??issue.code
    ]));
  }
  function showNotice(message,isError=false) {if(disposed)return;notice.className='notice'+(isError?' error':'');notice.textContent=message;}
  function lockControls() {
    for(const control of root.querySelectorAll('button,input,select,textarea')) {
      if(!busyControls.has(control))busyControls.set(control,control.disabled);
      control.disabled=true;
    }
  }
  function setDisabled(control,disabled) {
    if(busy){busyControls.set(control,Boolean(disabled));control.disabled=true;}
    else control.disabled=Boolean(disabled);
  }
  async function perform(work) {
    if(disposed||busy)return;
    busy=true;root.setAttribute('aria-busy','true');lockControls();
    try {return await work();}
    catch(error){showNotice(error.message??String(error),true);if(error.details)notice.append(pre(error.details));}
    finally {
      busy=false;root.removeAttribute('aria-busy');
      for(const [control,disabled] of busyControls)if(control.isConnected)control.disabled=disabled;
      busyControls.clear();
    }
  }
  async function call(action,payload) {
    const value=await api(action,payload);
    if(value?.error)throw Object.assign(new Error(value.error.message??value.error),{details:value.error.details??value.details});
    return value?.result && !value.kind ? value.result : value;
  }
  function reviewer() {const value=String(operator||'').trim();if(!value)throw new Error('Enter the operator recording this receiving decision.');return value;}
  function selectedSnapshot() {return snapshotCache.get(snapshotId);}
  function snapshotMetadata() {return snapshots.find(snapshot=>snapshot.id===snapshotId);}
  function sourceToken(value) {
    if(!value)return '';
    return JSON.stringify({id:value.id,revision:value.revision,label:value.label,cycle:value.cycle,asOf:value.asOf,
      analysisIds:value.analysisIds,review:value.review,rowCount:value.rowCount});
  }
  function handoffs() {return [...(state.handoffs??[])].sort((a,b)=>String(a.createdAt??'').localeCompare(String(b.createdAt??''))||String(a.id).localeCompare(String(b.id)));}
  function savedHandoff(id) {return documentCache.get('handoff/'+id);}
  function handoffLabel(value) {
    return [value.id,value.profile?.recipient??value.recipient,value.snapshot?.label??value.label,value.snapshot?.cycle??value.cycle].filter(Boolean).join(' / ');
  }
  async function ensureSnapshot(id,refresh=false) {
    if(!id)return null;
    const previous=snapshotCache.get(id);
    if(previous&&!refresh)return previous;
    const result=await call('snapshot',{id});
    if(result?.id!==id||!fullSnapshot(result))throw new Error('The selected reviewed pricing snapshot was not returned.');
    snapshotCache.set(id,result);
    if(id===snapshotId) {
      const changed=previous&&previous.revision!==result.revision;
      if(selectedInitializedFor!==id) {
        selectedRows=new Set(result.rows.map(row=>row.id));selectedInitializedFor=id;
      } else if(!previous||changed) {
        const ids=new Set(result.rows.map(row=>row.id));selectedRows=new Set([...selectedRows].filter(value=>ids.has(value)));
      }
      if(!previous||changed){fieldCatalog=[];fieldToken++;invalidateHandoff();}
    }
    return result;
  }
  async function ensureDocument(kind,id) {
    const key=kind+'/'+id,existing=documentCache.get(key);
    if(existing)return existing;
    const result=await call('document',{kind,id});
    if(result?.id!==id||result.kind!==kind)throw new Error('The selected original receiving record was not returned.');
    documentCache.set(key,result);return result;
  }
  const ensureHandoff=id=>ensureDocument('handoff',id);
  async function loadTab() {
    if(tab==='delivery'&&snapshotId) {await ensureSnapshot(snapshotId);await inspectFields();}
    else if(tab==='returns'&&handoffs().length) {
      if(!handoffs().some(value=>value.id===returnHandoffId))returnHandoffId=handoffs().at(-1).id;
      const value=await ensureHandoff(returnHandoffId);if(returnFormat===null)returnFormat=value.profile.format;
    } else if(tab==='annual'&&handoffs().length>=2) {
      if(!handoffs().some(value=>value.id===previousId))previousId=handoffs().at(-2).id;
      if(!handoffs().some(value=>value.id===currentId))currentId=handoffs().at(-1).id;
      await Promise.all([...new Set([previousId,currentId])].map(ensureHandoff));
    }
    render();
  }
  function adoptHostState(next={}) {
    const previous=sourceToken(snapshotMetadata());
    if(next.state)state=next.state;
    if(next.snapshots)snapshots=next.snapshots;else if(next.state?.snapshots)snapshots=next.state.snapshots;
    for(const value of snapshots)if(fullSnapshot(value))snapshotCache.set(value.id,value);
    if(!snapshots.some(value=>value.id===snapshotId)) {
      snapshotId=snapshots[0]?.id??'';selectedInitializedFor='';selectedRows.clear();
    }
    if(previous!==sourceToken(snapshotMetadata())) {
      const supplied=snapshots.find(value=>value.id===snapshotId);
      if(!fullSnapshot(supplied))snapshotCache.delete(snapshotId);
      handoffPreview=null;createdHandoff=null;fieldCatalog=[];fieldToken++;
    }
  }
  function savedMetadata(result) {
    return {id:result.id,kind:result.kind,createdAt:result.createdAt,createdBy:result.createdBy,sha256:result.sha256,
      handoffId:result.handoffId,summary:result.summary,
      profile:result.profile?{id:result.profile.id,label:result.profile.label,recipient:result.profile.recipient,format:result.profile.format}:undefined,
      snapshot:result.snapshot?{id:result.snapshot.id,label:result.snapshot.label,cycle:result.snapshot.cycle,asOf:result.snapshot.asOf}:undefined};
  }
  async function committed(action,result) {
    const collection=['createHandoff','importHandoff'].includes(action)?'handoffs':action==='reviewReturn'?'returnReviews':'annualReviews';
    documentCache.set(result.kind+'/'+result.id,result);
    const values=[...(state[collection]??[])];const index=values.findIndex(value=>value.id===result.id);
    if(index<0)values.push(savedMetadata(result));else values[index]=savedMetadata(result);
    state={...state,[collection]:values};
    if(typeof onSaved==='function') {
      const refreshed=await onSaved({action,result});
      if(refreshed?.state||refreshed?.snapshots)adoptHostState(refreshed);
    }
  }
  async function saveFile(value) {
    if(typeof download==='function')return download(value);
    if(typeof value.content!=='string'&&!(value.content instanceof Uint8Array))throw new Error('The complete receiving file was not returned.');
    const blob=new window.Blob([value.content],{type:value.mime??'application/octet-stream'}),url=window.URL.createObjectURL(blob),anchor=make('a');
    anchor.href=url;anchor.download=value.filename??'receiving-export';document.body.append(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>window.URL.revokeObjectURL(url),1000);
  }
  async function report(record) {
    await saveFile({filename:safeName(record.id??record.previewHash)+'-receiving-report.html',mime:'text/html;charset=utf-8',content:receivingReport(record)});
  }
  async function fullRecord(record) {
    if(record.id)return saveFile(await call('exportRecord',{kind:record.kind,id:record.id}));
    await saveFile({filename:safeName(record.previewHash)+'-'+record.kind+'.json',mime:'application/json;charset=utf-8',content:JSON.stringify(record,null,2)+'\n'});
  }
  function handoffReference(record) {return {id:record.id,sha256:record.sha256};}
  function summaryTable(value={}) {return table(['Recorded measure','Value'],Object.entries(value).map(([key,result])=>[label(key),result]));}
  function inspect(value,title='Original retained details') {return lazy(title,()=>pre(value));}
  function displayCell(cell) {
    if(!cell||cell.present===false)return small('[absent field]');
    if(cell.value===null||cell.type==='null')return small('null');
    if(cell.value===''&&cell.text==='')return small('[empty string]');
    return make('span',cell.text??asText(cell.value));
  }
  function paged(container,key,items,headers,renderRow,searchText=value=>JSON.stringify(value)) {
    const settings=pageStates.get(key)??{page:0,size:50,search:''};pageStates.set(key,settings);
    const controls=make('div',undefined,'inline'),search=input('Find receiving record',settings.search,value=>{settings.search=value;settings.page=0;draw();},'search');
    search.placeholder='Job, row, field or recorded value';
    const size=select('Records per page',String(settings.size),[25,50,100,250].map(value=>[String(value),String(value)]),value=>{settings.size=Number(value);settings.page=0;draw();});
    controls.append(labeled('Find receiving record',search),labeled('Records per page',size));
    const count=make('p',undefined,'muted small'),body=make('div'),nav=make('div',undefined,'pagination'),pageLabel=make('span');
    const previous=button('Previous page',()=>{settings.page--;draw();}),next=button('Next page',()=>{settings.page++;draw();});
    nav.append(previous,pageLabel,next);container.append(controls,count,nav,body);let visibleItems=items;
    function draw() {
      const query=settings.search.trim().toLowerCase();
      visibleItems=query?items.filter(value=>searchText(value).toLowerCase().includes(query)):items;
      const pages=Math.max(1,Math.ceil(visibleItems.length/settings.size));settings.page=Math.max(0,Math.min(settings.page,pages-1));
      const start=settings.page*settings.size,rows=visibleItems.slice(start,start+settings.size);
      setDisabled(previous,settings.page===0);setDisabled(next,settings.page+1>=pages);pageLabel.textContent='Page '+(settings.page+1)+' of '+pages;
      count.textContent=visibleItems.length+' of '+items.length+' records match. Showing '+(rows.length?start+1:0)+' through '+(start+rows.length)+'. Full exports retain every record.';
      body.replaceChildren(rows.length?table(headers,rows.map(renderRow)):make('p','No records match this view.','blank'));
      if(busy)lockControls();
    }
    draw();return {filtered:()=>visibleItems,refresh:draw};
  }
  function invalidateHandoff() {handoffPreview=null;createdHandoff=null;const area=root.querySelector('[data-receiving-preview]');if(area)area.replaceChildren(small('Preview the current row selection and recipient columns before creating its handback.'));}
  function sourceInfo(snapshot) {
    const value=make('div');if(!snapshot)return value;
    value.append(line('Source edition',snapshot.label??snapshot.id),line('Cycle / as of',[snapshot.cycle,snapshot.asOf].filter(Boolean).join(' / ')));
    if(snapshot.review)value.append(line('Source review',[snapshot.review.by,snapshot.review.at,snapshot.review.reference].filter(Boolean).join(' / ')));
    value.append(inspect({id:snapshot.id,revision:snapshot.revision,sourceRefs:snapshot.sourceRefs},'Original source identities'));return value;
  }
  async function inspectFields() {
    const snapshot=selectedSnapshot();if(!snapshot)return;
    const token=++fieldToken,result=await call('inspectSnapshot',{snapshot:{id:snapshot.id}});
    if(disposed||token!==fieldToken||selectedSnapshot()?.id!==snapshot.id||selectedSnapshot()?.revision!==snapshot.revision)return;
    fieldCatalog=result.fields??[];const list=root.querySelector('[data-receiving-fields]');if(list)fillFields(list);
  }
  function fillFields(list) {
    list.replaceChildren();for(const field of fieldCatalog){const option=make('option');option.value=field.pointer;option.label=(field.types??[]).join(', ')+'; present '+field.present;list.append(option);}
  }
  function render() {
    if(disposed)return;
    for(const [key,control]of tabButtons){control.setAttribute('aria-selected',String(key===tab));control.classList.toggle('primary',key===tab);}
    contents.setAttribute('aria-labelledby','receiving-tab-'+tab);contents.replaceChildren();
    if(tab==='delivery')renderDelivery();else if(tab==='returns')renderReturns();else if(tab==='annual')renderAnnual();else renderHistory();
    if(busy)lockControls();
  }
  function renderDelivery() {
    const sourcePanel=panel('1. Select reviewed pricing rows');
    if(!snapshots.length){sourcePanel.append(make('p','Accept an analysis in the market workbench to make its reviewed pricing rows available here.'));contents.append(sourcePanel);return;}
    if(!snapshots.some(value=>value.id===snapshotId))snapshotId=snapshots[0].id;
    const snapshot=selectedSnapshot(),edition=select('Reviewed source edition',snapshotId,snapshots.map(value=>[value.id,[value.label??value.id,value.cycle,value.asOf].filter(Boolean).join(' / ')]),value=>{
      snapshotId=value;selectedInitializedFor='';selectedRows.clear();fieldCatalog=[];invalidateHandoff();render();perform(loadTab);
    });
    sourcePanel.append(labeled('Reviewed source edition',edition),sourceInfo(snapshot??snapshotMetadata()));
    if(!snapshot) {
      sourcePanel.append(make('p','Open this reviewed source edition to select its original pricing rows.'),
        actions(button('Load reviewed pricing rows',loadTab,'primary')));contents.append(sourcePanel);return;
    }
    const selectedCount=small(selectedRows.size+' of '+snapshot.rows.length+' original rows selected');
    sourcePanel.append(actions(button('Select all rows',()=>{selectedRows=new Set(snapshot.rows.map(row=>row.id));invalidateHandoff();render();}),
      button('Clear selection',()=>{selectedRows.clear();invalidateHandoff();render();}),selectedCount));
    const rowView=make('div');sourcePanel.append(rowView);
    paged(rowView,'source-'+snapshot.id,snapshot.rows,['Include','Original row','Job identity','Source row'],row=>[
      checkbox('Include original row '+row.id,selectedRows.has(row.id),checked=>{if(checked)selectedRows.add(row.id);else selectedRows.delete(row.id);selectedCount.textContent=selectedRows.size+' of '+snapshot.rows.length+' original rows selected';invalidateHandoff();}),
      row.id,row.jobId,inspect(row,'Open original reviewed row')
    ]);
    contents.append(sourcePanel);
    const recipientPanel=panel('2. Configure recipient columns');
    const profileChoice=select('Reuse receiving profile','',[['','Current draft'],...handoffs().map(value=>[value.id,handoffLabel(value)])],value=>{
      if(value)perform(async()=>{profile=copy((await ensureHandoff(value)).profile);invalidateHandoff();render();});
    });
    recipientPanel.append(labeled('Reuse receiving profile',profileChoice));
    const grid=make('div',undefined,'grid');
    for(const [key,title]of [['id','Profile identity'],['label','Profile label'],['recipient','Recipient'],['sourceNote','Receiving source note']])grid.append(labeled(title,input(title,profile[key],value=>{profile[key]=value;invalidateHandoff();},key==='sourceNote'?'textarea':'text')));
    grid.append(labeled('Receiving format',select('Receiving format',profile.format,[['csv','CSV'],['tsv','TSV']],value=>{profile.format=value;invalidateHandoff();})),
      labeled('Line ending',select('Line ending',profile.lineEnding,[['CRLF','CRLF'],['LF','LF']],value=>{profile.lineEnding=value;invalidateHandoff();})));
    recipientPanel.append(grid,actions(labeled('Include a UTF-8 byte order mark',checkbox('Include a UTF-8 byte order mark',profile.bom,value=>{profile.bom=value;invalidateHandoff();}))));
    const dataList=make('datalist');dataList.id='receiving-field-pointers';dataList.dataset.receivingFields='';fillFields(dataList);recipientPanel.append(dataList);
    const columnRows=profile.columns.map((column,index)=>{
      const pointer=input('Column '+(index+1)+' original field',column.pointer,value=>{column.pointer=value;invalidateHandoff();});pointer.setAttribute('list',dataList.id);pointer.placeholder='/data/consensus/p50';
      return [input('Recipient header '+(index+1),column.header,value=>{column.header=value;invalidateHandoff();}),pointer,
        checkbox('Required column '+(index+1),column.required,value=>{column.required=value;invalidateHandoff();}),
        checkbox('Editable returned column '+(index+1),column.editable,value=>{column.editable=value;invalidateHandoff();}),
        button('Remove column',()=>{profile.columns.splice(index,1);invalidateHandoff();render();})];
    });
    recipientPanel.append(table(['Recipient header','Original field pointer','Required','Returned edits',''],columnRows));
    recipientPanel.append(actions(button('Add recipient column',()=>{profile.columns.push({header:'column_'+(profile.columns.length+1),pointer:'',required:false,editable:false});invalidateHandoff();render();}),
      button('Inspect available source fields',async()=>{await inspectFields();const view=panel('Original fields in this snapshot');view.append(table(['Pointer','Types','Present rows','Original samples'],fieldCatalog.map(field=>[field.pointer,(field.types??[]).join(', '),field.present,pre(field.samples)])));recipientPanel.append(view);})));
    recipientPanel.append(make('p','Receiving files carry handoff_id, row_id and row_version before the configured columns, followed by return_action and return_note. Set returned edits only for columns the recipient may propose for receiving review.','muted small'));
    contents.append(recipientPanel);
    const previewPanel=panel('3. Preview and create the complete handback'),area=make('div');area.dataset.receivingPreview='';
    previewPanel.append(actions(button('Preview receiving handback',async()=>{
      const previous=selectedSnapshot(),fresh=await ensureSnapshot(snapshotId,true);
      if(previous?.revision!==fresh.revision) {
        await inspectFields();render();throw new Error('The reviewed pricing source changed. Review its refreshed rows and preview the receiving handback again.');
      }
      handoffPreview=await call('previewHandoff',{snapshot:{id:fresh.id},profile:copy(profile),selectedRowIds:[...selectedRows]});
      createdHandoff=null;showNotice('Previewed '+handoffPreview.summary.rows+' receiving rows.');render();
    },'primary')),area);contents.append(previewPanel);
    if(createdHandoff)renderHandoff(area,createdHandoff);
    else if(handoffPreview) {
      renderHandoff(area,handoffPreview);
      const create=button('Create receiving handoff',async()=>{
        const result=await call('createHandoff',{preview:{snapshot:{id:handoffPreview.snapshot.id},profile:copy(handoffPreview.profile),
          rows:handoffPreview.rows.map(row=>({id:row.id}))},expectedPreviewHash:handoffPreview.previewHash,actor:reviewer(),at:new Date().toISOString()});
        await committed('createHandoff',result);createdHandoff=result;returnHandoffId=result.id;returnFormat=result.profile.format;showNotice('Saved receiving handoff '+result.id+'.');render();
      },'primary');setDisabled(create,handoffPreview.issues.some(issue=>issue.severity==='error'));
      area.append(actions(create));
    } else area.append(small('Preview the current row selection and recipient columns before creating its handback.'));
  }
  function renderHandoff(container,record) {
    container.append(sourceInfo(record.snapshot),line('Recipient',record.profile.recipient),
      line('Receiving identity',record.id??record.previewHash),badge(record.kind==='handoff'?'saved handoff':'preview'),
      summaryTable(record.summary??{rows:record.rows.length,excluded:record.excludedRows?.length??0}),
      issueTable(record.issues));
    const rowView=make('div');container.append(rowView);
    paged(rowView,'handoff-'+(record.id??record.previewHash),record.rows,['Original row','Job',...record.profile.columns.map(column=>column.header),'Original version'],row=>[
      row.id,row.jobId,...record.profile.columns.map(column=>displayCell(row.cells.find(cell=>cell.header===column.header))),make('span',row.version,'mono')
    ]);
    const controls=actions(button('Download printable receiving report',()=>report(record)));
    if(record.kind==='handoff')for(const format of ['csv','tsv','json'])controls.append(button(format==='json'?'Download complete handoff JSON':'Download '+format.toUpperCase(),async()=>saveFile(await call('exportHandoff',{handoff:handoffReference(record),format}))));
    container.append(controls,inspect({profile:record.profile,excludedRows:record.excludedRows,sha256:record.sha256,snapshotHash:record.snapshotHash},'Receiving definitions and original identities'));
  }
  function renderReturns() {
    const sourcePanel=panel('Review a returned receiving file');
    if(!handoffs().length){sourcePanel.append(make('p','Create a receiving handoff first. Its original row identities and versions will anchor the returned file.'));contents.append(sourcePanel);return;}
    if(!handoffs().some(value=>value.id===returnHandoffId))returnHandoffId=handoffs().at(-1).id;
    const handoff=savedHandoff(returnHandoffId);
    sourcePanel.append(labeled('Original receiving handoff',select('Original receiving handoff',returnHandoffId,handoffs().map(value=>[value.id,handoffLabel(value)]),value=>{
      returnHandoffId=value;returnFormat=null;returnPreview=null;returnDecisions=new Map();returnedContent='';returnedFilename='';
      returnColumnMapping={};showColumnMapping=false;originalReturnColumns=[];render();perform(loadTab);
    })));
    if(!handoff) {
      sourcePanel.append(actions(button('Load original receiving handoff',loadTab,'primary')));contents.append(sourcePanel);return;
    }
    if(returnFormat===null)returnFormat=handoff.profile.format;
    sourcePanel.append(sourceInfo(handoff.snapshot));
    const file=make('input');file.type='file';file.accept='.csv,.tsv,text/csv,text/tab-separated-values';file.setAttribute('aria-label','Returned receiving file');
    file.addEventListener('change',()=>perform(async()=>{
      const selected=file.files?.[0];if(!selected)return;
      returnedContent=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await selected.arrayBuffer());returnedFilename=selected.name;returnPreview=null;returnDecisions=new Map();
      returnColumnMapping={};originalReturnColumns=[];
      showNotice('Read the original returned file '+selected.name+'.');render();
    }));
    const filename=small(returnedFilename||'Choose the original returned file.');
    const grid=make('div',undefined,'grid');grid.append(labeled('Returned receiving file',file),
      labeled('Returned format',select('Returned format',returnFormat||handoff.profile.format,[['csv','CSV'],['tsv','TSV']],value=>{returnFormat=value;returnPreview=null;returnDecisions=new Map();render();})));
    sourcePanel.append(grid,filename);
    sourcePanel.append(actions(labeled('Assign renamed returned headers',checkbox('Assign renamed returned headers',showColumnMapping,value=>{
      showColumnMapping=value;if(!value)returnColumnMapping={};returnPreview=null;returnDecisions=new Map();render();
    }))));
    if(showColumnMapping) {
      const expected=['handoff_id','row_id','row_version',...handoff.profile.columns.map(column=>column.header),'return_action','return_note'];
      const list=make('datalist');list.id='receiving-original-return-headers';
      for(const header of originalReturnColumns){const option=make('option');option.value=header;list.append(option);}
      sourcePanel.append(list,table(['Expected receiving column','Original returned header'],expected.map(header=>{
        const control=input('Returned header for '+header,returnColumnMapping[header]??header,value=>{
          if(value&&value!==header)returnColumnMapping[header]=value;else delete returnColumnMapping[header];
          returnPreview=null;returnDecisions=new Map();const prior=root.querySelector('[data-return-review]');if(prior)prior.remove();
        });control.setAttribute('list',list.id);return [header,control];
      })),make('p','Assign each renamed receiving column to the header present in the original returned file. These assignments are retained with the reviewed source.','muted small'));
    }
    sourcePanel.append(actions(button('Preview returned corrections',async()=>{
      if(!returnedFilename)throw new Error('Choose the returned receiving file.');
      returnPreview=await call('previewReturn',{handoff:handoffReference(savedHandoff(returnHandoffId)),content:returnedContent,format:returnFormat,columnMapping:copy(returnColumnMapping)});
      originalReturnColumns=returnPreview.originalColumns??returnPreview.columns??[];
      returnDecisions=new Map();showNotice('Reviewed '+returnPreview.summary.records+' returned records against handoff '+returnHandoffId+'.');render();
    },'primary')));contents.append(sourcePanel);
    if(returnPreview)renderReturnReview(contents,returnPreview,true);
  }
  function canAccept(entry) {
    return ['unchanged','changed','duplicate'].includes(entry.status)&&
      !(entry.changes??[]).some(change=>!change.editable)&&
      !(entry.issues??[]).some(issue=>issue.severity==='error'&&issue.code!=='DUPLICATE_ROW');
  }
  function decisionControl(entry,collection,options,canUse=()=>true) {
    const value=collection.get(entry.key)??{key:entry.key,action:'',reason:''},container=make('div');
    const choice=select('Decision for '+entry.key,value.action,[['','Choose receiving decision'],...options],action=>{
      const next=collection.get(entry.key)??{key:entry.key,reason:''};next.action=action;collection.set(entry.key,next);
    });
    for(const option of choice.options)if(option.value&&!canUse(entry,option.value))option.disabled=true;
    const reason=input('Reason for '+entry.key,value.reason,text=>{const next=collection.get(entry.key)??{key:entry.key,action:''};next.reason=text;collection.set(entry.key,next);},'textarea');
    reason.placeholder='Record the receiving reason';container.append(choice,reason);return container;
  }
  function bulkControls(collection,options,filtered,canUse=()=>true) {
    const panel=make('div',undefined,'panel');let action='',reason='';
    const grid=make('div',undefined,'grid');grid.append(labeled('Decision for filtered records',select('Decision for filtered records','',[['','Choose decision'],...options],value=>{action=value;})),
      labeled('Reason for filtered records',input('Reason for filtered records','',value=>{reason=value;},'textarea')));
    panel.append(grid,actions(button('Apply decision to filtered records',()=>{
      if(!action||!reason.trim())throw new Error('Choose a decision and enter its reason.');
      const entries=filtered();if(entries.some(entry=>!canUse(entry,action)))throw new Error('This decision cannot apply to every filtered record. Review the locked values or original identities and choose the corresponding pricing-review or follow-up decision.');
      if(action==='accept'&&new Set(entries.map(entry=>entry.rowId)).size!==entries.length)
        throw new Error('Select one returned occurrence of each original row to accept. Record a separate decision for the other occurrences.');
      for(const entry of entries)collection.set(entry.key,{key:entry.key,action,reason:reason.trim()});
      render();showNotice('Applied the receiving decision to '+entries.length+' filtered records.');
    })));return panel;
  }
  function pricingReviewControls(record,entry,decision) {
    const controls=make('div',undefined,'actions');
    if(typeof onOpenAnalysis!=='function'||!record.id||!['request-pricing-review','needs-pricing-review'].includes(decision?.action))return controls;
    const originals=record.kind==='return-review'?[['original',entry.original]]:[['current',entry.current],['previous',entry.previous]];
    for(const [edition,row] of originals) {
      const sourceRow=row?.source,analysisId=sourceRow?.data?.id;
      if(typeof analysisId!=='string'||analysisId!==sourceRow.id)continue;
      controls.append(button(edition==='original'?'Open original pricing analysis':'Open '+edition+' pricing analysis',()=>onOpenAnalysis({
        analysisId,jobId:sourceRow.jobId,sourceRow:copy(sourceRow),
        receiving:{kind:record.kind,id:record.id,handoffId:record.handoffId??record[edition]?.id,
          entryKey:entry.key,decision:copy(decision),changes:copy(entry.changes??[]),
          sourceSha256:record.source?.sha256??null,edition}
      })));
    }
    return controls;
  }
  function returnDetails(entry) {
    const value=make('div');value.append(line('Original row / job',[entry.rowId,entry.jobId].filter(Boolean).join(' / ')),
      line('Original version',entry.rowVersion),line('Requested action / note',[entry.requestedAction,entry.note].filter(Boolean).join(' / ')),
      issueTable(entry.issues??[]));
    if(entry.changes?.length)value.append(table(['Recipient column','Original field','Original value','Returned text','Returned edits'],entry.changes.map(change=>[
      change.header,change.pointer,pre(change.before),pre(change.after),change.editable?'Editable receiving field':'Pricing review required'
    ])));
    if(entry.returned)value.append(lazy('Original returned columns',()=>table(['Header','Returned text'],Object.entries(entry.returned).map(([header,text])=>[header,pre(text)]))));
    return value;
  }
  function renderReturnReview(container,record,editable=false) {
    const section=panel(editable?'Returned records and decisions':'Saved returned correction review');section.dataset.returnReview='';
    section.append(line('Original receiving handoff',record.handoffId),summaryTable(record.summary),issueTable(record.issues??[]));
    if(record.source?.columnMapping&&Object.keys(record.source.columnMapping).length)
      section.append(lazy('Retained returned header assignments',()=>table(['Receiving column','Original returned header'],Object.entries(record.source.columnMapping))));
    if(record.entries.some(entry=>entry.status==='duplicate'))
      section.append(make('p','Choose at most one occurrence of a repeated original row for acceptance. Each remaining occurrence requires its own receiving decision.','muted small'));
    const decisions=new Map((record.decisions??[]).map(value=>[value.key,value])),filterKey='return-status-'+record.previewHash;
    let filterStatus=pageStates.get(filterKey)??'all';
    const filteredArea=make('div'),statusControl=select('Return status',filterStatus,[['all','All returned records'],...['unchanged','changed','missing','duplicate','unknown','invalid'].map(value=>[value,label(value)])],value=>{filterStatus=value;pageStates.set(filterKey,value);drawEntries();});
    section.append(labeled('Return status',statusControl),filteredArea);let list;
    const allow=(entry,action)=>action!=='accept'||canAccept(entry);
    function drawEntries() {
      filteredArea.replaceChildren();const entries=filterStatus==='all'?record.entries:record.entries.filter(entry=>entry.status===filterStatus);
      list=paged(filteredArea,'return-'+record.previewHash,entries,['Status','Original row / job','Record','Values and source','Receiving decision'],entry=>[
        badge(entry.status),[entry.rowId,entry.jobId].filter(Boolean).join(' / '),entry.recordNumber??'',
        lazy('Open returned record',()=>returnDetails(entry)),
        editable?decisionControl(entry,returnDecisions,RETURN_ACTIONS,allow):actions(
          pre(decisions.get(entry.key)??{status:'No recorded decision'}),pricingReviewControls(record,entry,decisions.get(entry.key)))
      ]);
    }
    drawEntries();
    if(editable)section.append(bulkControls(returnDecisions,RETURN_ACTIONS,()=>list.filtered(),allow),actions(button('Save returned correction review',async()=>{
      const result=await call('reviewReturn',{preview:{handoffId:record.handoffId,source:copy(record.source)},expectedPreviewHash:record.previewHash,actor:reviewer(),at:new Date().toISOString(),decisions:[...returnDecisions.values()].filter(value=>value.action)});
      await committed('reviewReturn',result);openedRecord=result;tab='history';showNotice('Saved returned correction review '+result.id+'.');render();
    },'primary')));
    section.append(actions(button('Download printable correction report',()=>report(record)),
      button(editable?'Download return preview JSON':'Download complete returned review JSON',()=>fullRecord(record)),
      button('Download original returned file',()=>saveFile({filename:'returned-'+safeName(record.id??record.previewHash)+'.'+record.source.format,
        mime:(record.source.format==='tsv'?'text/tab-separated-values':'text/csv')+';charset=utf-8',content:record.source.content}))),
      inspect({id:record.id,createdAt:record.createdAt,createdBy:record.createdBy,sha256:record.sha256,previewHash:record.previewHash,
        source:{format:record.source?.format,sha256:record.source?.sha256,bytes:record.source?.bytes}},'Returned source and review identities'));
    container.append(section);
  }
  function renderAnnual() {
    const section=panel('Compare reviewed annual receiving editions');
    if(handoffs().length<2){section.append(make('p','Create handoffs from two reviewed source editions to compare their stable job identities and original pricing rows.'));contents.append(section);return;}
    if(!handoffs().some(value=>value.id===previousId))previousId=handoffs().at(-2).id;if(!handoffs().some(value=>value.id===currentId))currentId=handoffs().at(-1).id;
    const options=handoffs().map(value=>[value.id,handoffLabel(value)]),grid=make('div',undefined,'grid');
    grid.append(labeled('Previous receiving edition',select('Previous receiving edition',previousId,options,value=>{previousId=value;pairs=[];annualComparison=null;annualDecisions=new Map();render();perform(loadTab);})),
      labeled('Current receiving edition',select('Current receiving edition',currentId,options,value=>{currentId=value;pairs=[];annualComparison=null;annualDecisions=new Map();render();perform(loadTab);})));
    section.append(grid);
    if(!savedHandoff(previousId)||!savedHandoff(currentId)) {
      section.append(actions(button('Load original receiving editions',loadTab,'primary')));contents.append(section);return;
    }
    section.append(make('p','Unique original job IDs match across editions. For several analyses of the same job, select explicit pairs of original row identities.','muted small'),
      actions(labeled('Use explicit original row pairs',checkbox('Use explicit original row pairs',explicitPairs,value=>{explicitPairs=value;annualComparison=null;annualDecisions=new Map();render();}))));
    if(explicitPairs) {
      const before=savedHandoff(previousId),after=savedHandoff(currentId);
      section.append(table(['Previous original row','Current original row',''],pairs.map((pair,index)=>[
        select('Previous row for pair '+(index+1),pair.previousRowId,[['','Choose previous row'],...before.rows.map(row=>[row.id,row.jobId+' / '+row.id])],value=>{pair.previousRowId=value;annualComparison=null;annualDecisions=new Map();render();}),
        select('Current row for pair '+(index+1),pair.currentRowId,[['','Choose current row'],...after.rows.map(row=>[row.id,row.jobId+' / '+row.id])],value=>{pair.currentRowId=value;annualComparison=null;annualDecisions=new Map();render();}),
        button('Remove pair',()=>{pairs.splice(index,1);annualComparison=null;annualDecisions=new Map();render();})
      ])),actions(button('Add original row pair',()=>{pairs.push({previousRowId:'',currentRowId:''});annualComparison=null;annualDecisions=new Map();render();})),
        make('p','Unpaired previous rows appear as removed; unpaired current rows appear as added.','muted small'));
    }
    section.append(actions(button('Compare receiving editions',async()=>{
      if(previousId===currentId)throw new Error('Choose two different receiving editions.');
      annualComparison=await call('compareHandoffs',{previous:handoffReference(savedHandoff(previousId)),current:handoffReference(savedHandoff(currentId)),...(explicitPairs?{pairs:copy(pairs)}:{})});
      annualDecisions=new Map();showNotice('Compared the complete previous and current receiving populations.');render();
    },'primary')));contents.append(section);
    if(annualComparison)renderAnnualReview(contents,annualComparison,true);
  }
  function annualDetails(entry) {
    const value=make('div');value.append(line('Job',entry.jobId),line('Previous original row',entry.previousRowId??entry.previous?.id),
      line('Current original row',entry.currentRowId??entry.current?.id));
    if(entry.changes?.length)value.append(table(['Original pointer','Previous value','Current value'],entry.changes.map(change=>[
      change.pointer,change.beforePresent===false?small('[absent field]'):pre(change.before),change.afterPresent===false?small('[absent field]'):pre(change.after)
    ])));
    value.append(inspect({previous:entry.previous,current:entry.current},'Original paired receiving rows'));return value;
  }
  function renderAnnualReview(container,record,editable=false) {
    const section=panel(editable?'Annual changes and receiving decisions':'Saved annual receiving review');
    section.append(line('Previous handoff',record.previous.id),line('Current handoff',record.current.id),summaryTable(record.summary));
    if(record.metadataChanges)section.append(inspect(record.metadataChanges,'Source and receiving format changes'));
    const decisions=new Map((record.decisions??[]).map(value=>[value.key,value])),area=make('div'),filterKey='annual-status-'+record.previewHash;
    const allow=(entry,action)=>(action!=='keep-prior'||Boolean(entry.previous))&&(action!=='accept-update'||Boolean(entry.current));
    let filterStatus=pageStates.get(filterKey)??'all',list;
    section.append(labeled('Annual result',select('Annual result',filterStatus,[['all','All jobs'],...['added','removed','changed','unchanged'].map(value=>[value,label(value)])],value=>{filterStatus=value;pageStates.set(filterKey,value);drawEntries();})),area);
    function drawEntries() {
      area.replaceChildren();const entries=filterStatus==='all'?record.entries:record.entries.filter(entry=>entry.status===filterStatus);
      list=paged(area,'annual-'+record.previewHash,entries,['Job','Status','Original row identities','Changed fields','Receiving decision'],entry=>[
        entry.jobId,badge(entry.status),make('span',[entry.previousRowId??entry.previous?.id??'',entry.currentRowId??entry.current?.id??''].join(' -> '),'mono'),
        lazy('Open edition changes',()=>annualDetails(entry)),
        editable?decisionControl(entry,annualDecisions,ANNUAL_ACTIONS,allow):actions(
          pre(decisions.get(entry.key)??{status:'No recorded decision'}),pricingReviewControls(record,entry,decisions.get(entry.key)))
      ]);
    }
    drawEntries();
    if(editable)section.append(bulkControls(annualDecisions,ANNUAL_ACTIONS,()=>list.filtered(),allow),actions(button('Save annual receiving review',async()=>{
      const result=await call('reviewAnnualChange',{comparison:{previous:handoffReference(record.previous),current:handoffReference(record.current),matching:copy(record.matching)},
        expectedPreviewHash:record.previewHash,actor:reviewer(),at:new Date().toISOString(),decisions:[...annualDecisions.values()].filter(value=>value.action)});
      await committed('reviewAnnualChange',result);openedRecord=result;tab='history';showNotice('Saved annual receiving review '+result.id+'.');render();
    },'primary')));
    section.append(actions(button('Download printable annual report',()=>report(record)),button(editable?'Download annual preview JSON':'Download complete annual review JSON',()=>fullRecord(record))),
      inspect({id:record.id,createdBy:record.createdBy,createdAt:record.createdAt,sha256:record.sha256,previewHash:record.previewHash,
        previous:record.previous,current:record.current},'Annual review and original edition identities'));container.append(section);
  }
  function renderHistory() {
    const section=panel('Saved receiving history'),records=[
      ...handoffs().map(value=>({...value,kind:'handoff'})),
      ...(state.returnReviews??[]).map(value=>({...value,kind:'return-review'})),
      ...(state.annualReviews??[]).map(value=>({...value,kind:'annual-review'}))
    ].sort((left,right)=>String(right.createdAt??'').localeCompare(String(left.createdAt??'')));
    section.append(line('Workspace receiving revision',state.revision??'Current saved workspace'));
    const imported=make('input');imported.type='file';imported.accept='.json,application/json';imported.setAttribute('aria-label','Complete handoff JSON');
    imported.addEventListener('change',()=>perform(async()=>{
      const file=imported.files?.[0];if(!file)return;
      importContent=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());importFilename=file.name;render();
    }));
    const importPanel=panel('Receive a complete retained handoff');
    importPanel.append(labeled('Complete handoff JSON',imported),small(importFilename||'Choose the complete handoff exported from the original workspace.'),
      actions(button('Import complete handoff JSON',async()=>{
        if(!importFilename)throw new Error('Choose the complete original handoff JSON.');
        const result=await call('importHandoff',{content:importContent,actor:reviewer(),at:new Date().toISOString(),filename:importFilename});
        await committed('importHandoff',result);openedRecord=result;returnHandoffId=result.id;returnFormat=result.profile.format;
        importContent='';importFilename='';showNotice('Retained original handoff '+result.id+' for receiving review.');render();
      })));
    section.append(importPanel);
    if(!records.length)section.append(make('p','Created handoffs and recorded correction or annual reviews appear here for reopening.','blank'));
    else {
      const area=make('div');section.append(area);paged(area,'history',records,['Recorded at','Kind','Identity','Recorded by','Open'],record=>[
        record.createdAt,badge(record.kind),make('span',record.id,'mono'),record.createdBy,button('Reopen receiving record',async()=>{openedRecord=await ensureDocument(record.kind,record.id);render();})
      ]);
    }
    if(state.history?.length)section.append(lazy('Original receiving operation history',()=>table(['Original event'],state.history.map(event=>[pre(event)]))));
    contents.append(section);
    if(openedRecord) {
      const holder=panel('Reopened '+label(openedRecord.kind));holder.append(actions(button('Close reopened record',()=>{openedRecord=null;render();})));contents.append(holder);
      if(openedRecord.kind==='handoff')renderHandoff(holder,openedRecord);
      else if(openedRecord.kind==='return-review')renderReturnReview(holder,openedRecord);
      else if(openedRecord.kind==='annual-review')renderAnnualReview(holder,openedRecord);
    }
  }
  render();
  if(snapshotId)perform(loadTab);
  return {
    update(next={}) {
      if(disposed)return;
      adoptHostState(next);
      if(next.actor!==undefined){operator=typeof next.actor==='function'?next.actor():next.actor;operatorInput.value=operator??'';}
      render();
      if(!busy)perform(loadTab);
    },
    dispose() {
      disposed=true;fieldToken++;returnedContent='';returnPreview=null;annualComparison=null;handoffPreview=null;openedRecord=null;
      snapshotCache.clear();documentCache.clear();busyControls.clear();importContent='';originalReturnColumns=[];
      if(target.contains(root))root.remove();
    }
  };
}
