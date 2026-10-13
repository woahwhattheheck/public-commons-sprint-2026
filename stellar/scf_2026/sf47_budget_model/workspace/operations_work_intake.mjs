import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
import {mountEarlierStaffDesk} from './staff-desk-recovery.mjs';
// MIT. Complete work and invoice source intake in the original Operations case.
const FIELDS = {
  WORK:['externalId','contributor','costId','description','startDate','endDate','hours','fundingBasis'],
  INVOICES:['externalId','contributor','number','issuedDate','dueDate','lineId','description','amountUsd','currency','costId','workIds']
};
const REQUIRED = {
  WORK:['contributor','description','startDate','endDate','hours','fundingBasis'],
  INVOICES:['contributor','number','issuedDate','description','amountUsd','currency']
};
const LABELS = {externalId:'Source row ID',contributor:'Contributor / supplier',costId:'Work package',
  description:'Description',startDate:'Work start',endDate:'Work end',hours:'Recorded hours',fundingBasis:'Funding basis',
  number:'Invoice number',issuedDate:'Invoice date',dueDate:'Due date',lineId:'Invoice line ID',amountUsd:'Line amount · USD',
  currency:'Currency',workIds:'Linked work IDs'};
const DEFAULT_FORMAT = {encoding:'utf-8-sig',delimiter:',',headerRow:1,dateFormat:'ISO',decimalSeparator:'.',groupSeparator:''};
const FORMAT_CHOICES = {
  encoding:[['utf-8-sig','UTF-8'],['utf-16','UTF-16'],['cp1252','Windows-1252']],
  delimiter:[[',','Comma'],['\t','Tab'],[';','Semicolon'],['|','Pipe']],
  dateFormat:[['ISO','YYYY-MM-DD'],['DAY_FIRST','DD/MM/YYYY'],['MONTH_FIRST','MM/DD/YYYY']],
  decimalSeparator:[['.','Decimal point'],[',','Decimal comma']],
  groupSeparator:[['','No grouping'],[',','Comma'],['.','Point'],[' ','Space']]
};
const FORMAT_LABELS = {encoding:'Text encoding',delimiter:'Column separator',headerRow:'Header row · 0 for none',
  dateFormat:'Source date order',decimalSeparator:'Decimal separator',groupSeparator:'Thousands separator'};
const PAGE = 50, MAX_SOURCE = 8 * 1024 * 1024;
const copy = value => structuredClone(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const tidy = value => String(value ?? '').toLowerCase().replaceAll('_',' ').replace(/^./, c => c.toUpperCase());
const show = value => value === null || value === undefined || value === '' ? '—' : String(value);
const button = (label, action, value='', disabled=false, extra='') => '<button type="button" data-wi-action="'+esc(action)+'" data-value="'+esc(value)+'"'+(disabled?' disabled data-wi-fixed="true"':'')+' '+extra+'>'+esc(label)+'</button>';
const options = (rows,value) => rows.map(([id,label])=>'<option value="'+esc(id)+'"'+(String(value??'')===String(id)?' selected':'')+'>'+esc(label)+'</option>').join('');
const table = (head,rows) => '<div class="wi-table"><table><thead><tr>'+head.map(label=>'<th scope="col">'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const small = value => '<small>'+esc(value)+'</small>';
const badge = value => '<span class="wi-state">'+esc(tidy(value))+'</span>';
const blank = message => '<p class="wi-empty">'+esc(message)+'</p>';
function base64(buffer) {
  const bytes=new Uint8Array(buffer);let encoded='';
  for(let offset=0;offset<bytes.length;offset+=8192)encoded+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return btoa(encoded);
}
function download(raw,filename,type='application/json') {
  const url=URL.createObjectURL(raw instanceof Blob?raw:new Blob([raw],{type}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const intakeStores=new Map();
function intakeStore(name){
  if(intakeStores.has(name))return intakeStores.get(name);
let cacheDatabase;
function database() {
  if(!cacheDatabase)cacheDatabase=new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('cases');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Browser draft storage could not be opened.'));
    request.onblocked=()=>reject(new Error('Close the older intake view so browser draft storage can open.'));
  }).catch(error=>{cacheDatabase=null;throw error;});
  return cacheDatabase;
}
async function cacheRead(caseId) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('cases','readonly'),request=tx.objectStore('cases').get(caseId);
    request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);
  });
}
function cacheRevision(value) {
  const revision=value?.storageVersion??0;
  if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)
    throw new Error('The saved browser draft has an invalid storage revision.');
  return revision;
}
async function cacheWrite(caseId,value,expectedRevision) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('cases','readwrite'),store=tx.objectStore('cases'),read=store.get(caseId);
    let failure=null,savedRevision=null;
    read.onsuccess=()=>{
      try{
        const revision=cacheRevision(read.result);
        if(revision!==expectedRevision){
          failure=new Error('Another tab saved a newer complete draft. Download this tab’s draft and open the saved draft to continue.');
          failure.code='WORK_INTAKE_DRAFT_CONFLICT';tx.abort();return;
        }
        savedRevision=revision+1;store.put({...value,storageVersion:savedRevision},caseId);
      }catch(error){failure=error;tx.abort();}
    };
    tx.oncomplete=()=>resolve(savedRevision);
    tx.onerror=tx.onabort=()=>reject(failure||tx.error||new Error('Browser draft storage could not save this change.'));
  });
}
  const access={cacheRead,cacheWrite,cacheRevision};intakeStores.set(name,access);return access;
}

export function mountWorkIntake({container,current,saveApi,session={},mutationId,recordingActor,onCase,onOpen,staffContext=currentStaffContext()}) {
  const pinnedContext=staffContext?{...staffContext}:null;
  const {cacheRead,cacheWrite,cacheRevision}=intakeStore(staffDeskStorageKey('sf47-work-intake-drafts',pinnedContext));
  const root=document.createElement('section');root.className='work-intake-desk';
  root.setAttribute('aria-label','Work and invoice source intake');container.replaceChildren(root);
  if(!document.querySelector('link[data-work-intake-style]')) {
    const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./operations_work_intake.css',import.meta.url).href;
    link.dataset.workIntakeStyle='true';document.head.append(link);
  }
  const caseId=current.program.id,base='/api/operations/'+caseId,s=session;
  let active=true,busy=false,hostBusy=false,dialogKind=null,retainTimer=null;
  let selected=null,preview=null,revisionView=null,conflict=null,page=0,recordPage=0,filter='',tab='rows',message='',messageError=false;
  let caseView=current,cacheError=null;
  s.drafts??={};s.newSource??={kind:'WORK',name:'',sourceId:'',sourceUrl:'',format:copy(DEFAULT_FORMAT)};
  s.selectedId??=null;s.pending??=null;s.lastRequest??=null;s.lastReceipt??=null;s.uploadFile??=null;
  s.persistQueue??=Promise.resolve();s.storageVersion??=0;s.storageConflict??=null;
  const alive=()=>active&&root.isConnected;
  const $=selector=>root.querySelector(selector);
  const edit=()=>selected&&selected.intake.state==='DRAFT'&&revisionView===null&&!conflict&&caseView.program.state==='OPEN'&&!s.pending;
  const draft=()=>revisionView===null&&selected?.intake.state==='DRAFT'?s.drafts[s.selectedId]?.document:undefined;
  const currentDraft=()=>s.drafts[s.selectedId];
  const columns=()=>preview?.columns||selected?.columns||[];
  const sourceRows=()=>preview?.rows||selected?.rows||[];
  const people=()=>caseView.records.contributors.map(row=>[row.id,row.name+' · '+row.id]);
  const packages=()=>caseView.plan.scenario.future_costs.map(row=>[row.id,row.id]);
  function persistenceValue() {
    return copy({schema:'stellar-forge.sf47-work-intake-browser.v1',caseId,selectedId:s.selectedId,drafts:s.drafts,
      newSource:s.newSource,uploadFile:s.uploadFile,pending:s.pending,lastRequest:s.lastRequest,lastReceipt:s.lastReceipt});
  }
  function persist(value=persistenceValue(),afterCommit=null) {
    if(retainTimer!==null){clearTimeout(retainTimer);retainTimer=null;}
    s.persistQueue=s.persistQueue.catch(()=>{}).then(async()=>{
      s.storageVersion=await cacheWrite(caseId,value,s.storageVersion);s.storageConflict=null;
      if(afterCommit)afterCommit();
    }).catch(error=>{if(error.code==='WORK_INTAKE_DRAFT_CONFLICT')s.storageConflict=error.message;throw error;});
    return s.persistQueue;
  }
  function retain() {
    if(retainTimer!==null)clearTimeout(retainTimer);
    if(s.storageConflict){retainTimer=null;return;}
    retainTimer=setTimeout(()=>{
      retainTimer=null;
      persist().catch(error=>{cacheError=error;if(alive()){if(s.storageConflict)render();setMessage('The browser could not retain these unsaved changes: '+error.message,true);}});
    },200);
  }
  function setMessage(text,error=false) {
    message=text;messageError=error;
    const node=$('[data-wi-message]');
    if(node){node.textContent=text;node.setAttribute('role',error?'alert':'status');}
  }
  function controls() {
    if(!alive())return;
    root.setAttribute('aria-busy',String(busy||hostBusy));
    root.querySelectorAll('button,input,select,textarea').forEach(node=>{
      node.disabled=busy||hostBusy||node.dataset.wiFixed==='true';
    });
  }
  function setHostBusy(value){hostBusy=Boolean(value);controls();}
  function dispose(){earlier.dispose();active=false;if(retainTimer!==null)persist().catch(()=>{});const dialog=$('dialog');if(dialog?.open)dialog.close();}
  async function run(fn) {
    if(busy||hostBusy||!alive())return;busy=true;controls();
    try{await fn();}catch(error){if(alive()){if(s.storageConflict)render();setMessage(error.message,true);}}
    finally{busy=false;if(alive())controls();}
  }
  function markChanged() {
    const item=currentDraft();if(item)item.dirty=true;
    preview=null;page=0;recordPage=0;retain();
    const apply=$('[data-wi-action="apply"]');if(apply){apply.disabled=true;apply.dataset.wiFixed='true';}
  }
  function noteField(label,key,value,extra='') {
    return '<label>'+esc(label)+'<input data-wi-field="'+esc(key)+'" data-focus="'+esc(key)+'" value="'+esc(value)+'" '+extra+'></label>';
  }
  function formatForm(value,prefix,disabled=false) {
    return '<div class="wi-format">'+Object.keys(DEFAULT_FORMAT).map(key=>'<label>'+esc(FORMAT_LABELS[key])+
      (key==='headerRow'?'<input type="number" min="0" max="5001" step="1" data-wi-format="'+key+'" data-prefix="'+prefix+'" data-focus="'+prefix+key+'" value="'+esc(value[key])+'"':
        '<select data-wi-format="'+key+'" data-prefix="'+prefix+'" data-focus="'+prefix+key+'"')+
      (disabled?' disabled data-wi-fixed="true"':'')+'>'+
      (key==='headerRow'?'':options(FORMAT_CHOICES[key],value[key])+'</select>')+'</label>').join('')+'</div>';
  }
  function originValues(row) {
    const doc=draft()||selected.intake.document,values={};
    for(const field of FIELDS[selected.intake.kind]){
      const choice=doc.mapping[field];
      values[field]=choice?('value'in choice?choice.value:(row.cells[choice.column]||'').trim()):'';
    }
    const correction=doc.rowEdits.find(item=>item.row===row.row);
    if(correction)Object.assign(values,correction.values);
    return values;
  }
  function focusState() {
    const node=document.activeElement;
    return node&&root.contains(node)&&node.dataset.focus?{key:node.dataset.focus,start:node.selectionStart,end:node.selectionEnd}:null;
  }
  function restoreFocus(state) {
    if(!state)return;const node=[...root.querySelectorAll('[data-focus]')].find(x=>x.dataset.focus===state.key);
    if(node&&!node.disabled){node.focus();if(state.start!==null&&state.start!==undefined&&node.setSelectionRange)try{node.setSelectionRange(state.start,state.end);}catch{}}
  }
  function browserTransfer(value=persistenceValue()) {
    const desk=copy(value);
    if(desk.uploadFile){
      const file=desk.uploadFile;
      desk.uploadFile={name:file.name,type:file.type,bytes:file.bytes.byteLength,contentBase64:base64(file.bytes)};
    }
    return {schema:'stellar-forge.sf47-work-intake-browser-transfer.v1',caseId,exportedAt:new Date().toISOString(),desk};
  }
  function downloadBrowserDraft() {
    download(JSON.stringify(browserTransfer(),null,2)+'\n',caseId+'-complete-intake-draft.json');
  }
  function browserRecoveryPanel() {
    return '<section class="wi-section"><h4>Complete browser draft</h4><p>Keep every draft mapping, original selected file and pending request together. Opening another complete draft first downloads this tab’s current draft.</p>'+
      (s.storageConflict?'<p class="wi-notice">'+esc(s.storageConflict)+'</p>':'')+
      '<div class="wi-actions">'+button('Download complete draft','browser-download')+
      button('Open complete draft','browser-open','',Boolean(s.inFlight))+
      (s.storageConflict?button('Download this draft and open saved draft','browser-reconcile','',Boolean(s.inFlight)):'')+'</div></section>';
  }
  function restoreDesk(value) {
    for(const field of ['selectedId','drafts','newSource','uploadFile','pending','lastRequest','lastReceipt'])s[field]=copy(value[field]);
    selected=null;preview=null;revisionView=null;conflict=null;page=0;recordPage=0;
  }
  function readBrowserTransfer(value) {
    const object=item=>item!==null&&typeof item==='object'&&!Array.isArray(item);
    const require=(condition,message)=>{if(!condition)throw new Error(message);};
    require(object(value)&&value.schema==='stellar-forge.sf47-work-intake-browser-transfer.v1'&&value.caseId===caseId,
      'Open a complete work/invoice browser draft for this exact operating case.');
    const desk=copy(value.desk);
    require(object(desk)&&desk.schema==='stellar-forge.sf47-work-intake-browser.v1'&&desk.caseId===caseId&&
      object(desk.drafts)&&object(desk.newSource),'The complete draft is missing its original case or source controls.');
    require(desk.selectedId===null||/^intake-[a-f0-9]{32}$/.test(desk.selectedId),'The selected intake identity is invalid.');
    for(const [id,item] of Object.entries(desk.drafts)){
      require(/^intake-[a-f0-9]{32}$/.test(id)&&object(item)&&Number.isSafeInteger(item.baseRevision)&&item.baseRevision>0&&
        typeof item.dirty==='boolean'&&typeof item.note==='string'&&object(item.document),'A retained mapping edition is incomplete.');
      const doc=item.document;
      require(object(doc.format)&&object(doc.mapping)&&Array.isArray(doc.contributors)&&Array.isArray(doc.costs)&&
        Array.isArray(doc.rowEdits)&&Array.isArray(doc.recordDecisions)&&typeof doc.sourceSystem==='string',
        'Retain every mapping, identity choice, correction and record decision.');
    }
    const source=desk.newSource;
    require(['WORK','INVOICES'].includes(source.kind)&&typeof source.name==='string'&&typeof source.sourceId==='string'&&
      typeof source.sourceUrl==='string'&&object(source.format),'The original source controls are incomplete.');
    for(const [field,choices] of Object.entries(FORMAT_CHOICES))
      require(choices.some(([id])=>id===source.format[field]),'Choose an explicit supported source format.');
    require(Number.isSafeInteger(source.format.headerRow)&&source.format.headerRow>=0&&source.format.headerRow<=5001,
      'The source header position is invalid.');
    if(desk.uploadFile!==null){
      const file=desk.uploadFile;
      require(object(file)&&typeof file.name==='string'&&file.name.length>0&&typeof file.type==='string'&&
        Number.isSafeInteger(file.bytes)&&file.bytes>0&&file.bytes<=MAX_SOURCE&&typeof file.contentBase64==='string'&&
        file.contentBase64.length<=Math.ceil(MAX_SOURCE/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(file.contentBase64),
        'Retain the complete original selected file and its byte count.');
      let bytes;try{bytes=Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0));}catch{throw new Error('The retained source file is not complete base64.');}
      require(bytes.byteLength===file.bytes,'The original selected file differs from its complete byte count.');
      desk.uploadFile={name:file.name,type:file.type,bytes:bytes.buffer};
    }
    for(const field of ['pending','lastRequest']){
      const request=desk[field];if(request===null)continue;
      require(object(request)&&object(request.body)&&['work-intake.upload','work-intake.save','work-intake.apply'].includes(request.body.action)&&
        Number.isSafeInteger(request.body.expectedVersion)&&request.body.expectedVersion>0&&
        typeof request.body.requestId==='string'&&request.body.requestId.length>0&&typeof request.body.actor==='string'&&
        object(request.body.data),'The original retained intake request is incomplete.');
    }
    require(desk.lastReceipt===null||object(desk.lastReceipt),'The retained response must be a complete object.');
    if(desk.pending){
      assertStaffRequestActor(desk.pending.body,pinnedContext);
      // Reconcile an imported response through the same native request identity.
      desk.pending.receipt=null;desk.pending.state='PREPARED';
    }
    return desk;
  }
  async function openBrowserTransfer(file) {
    if(!file)return;if(file.size>64*1024*1024)throw new Error('Choose a complete browser draft within 64 MiB.');
    const raw=await file.text();if(!alive())return;
    const desk=readBrowserTransfer(JSON.parse(raw));
    await persist();if(!alive())return;downloadBrowserDraft();
    await persist(desk,()=>{restoreDesk(desk);cacheError=null;render();});
    await refreshCase();render();setMessage(s.pending?'Opened the complete draft. Resume its original request to read the native outcome.':'Opened the complete draft and retained every mapping and original selected file.');
  }
  async function reconcileBrowserDraft() {
    await s.persistQueue.catch(()=>{});downloadBrowserDraft();
    const saved=await cacheRead(caseId);
    if(saved?.caseId!==caseId||saved.schema!=='stellar-forge.sf47-work-intake-browser.v1')
      throw new Error('The saved complete draft could not be reopened. This tab’s downloaded draft is retained.');
    const revision=cacheRevision(saved);restoreDesk(saved);s.storageVersion=revision;s.storageConflict=null;cacheError=null;render();
    await refreshCase();render();setMessage('Downloaded this tab’s complete draft and opened the saved draft. Both original inputs remain available.');
  }
  function pendingPanel() {
    if(!s.pending)return '';
    const p=s.pending,committed=Boolean(p.receipt),rejected=p.state==='REJECTED';
    return '<section class="wi-notice"><h4>'+ (committed?'Saved change ready to reopen':rejected?'Saved request needs reconciliation':'A saved request is awaiting its result')+'</h4><p>'+
      esc(committed?'The original operation completed. Open its retained case and record links.':rejected?p.error:'Continue with the same saved request. Its original identity prevents duplicate records if the earlier save completed.')+'</p>'+
      '<div class="wi-actions">'+button(committed?'Open saved result':rejected?'Refresh and reconcile':'Resume saved request',rejected?'reconcile':'resume')+
      button('Download saved request','request-download')+'</div></section>';
  }
  function newSourcePanel() {
    const n=s.newSource,closed=caseView.program.state!=='OPEN'||Boolean(s.pending);
    return '<details class="wi-section" '+(!selected?'open':'')+'><summary>Open a work or invoice source</summary>'+
      '<p>Select the original CSV or TSV. Header positions, date order and decimal separators stay explicit. Source bytes remain attached to this case.</p>'+
      '<div class="wi-fields"><label>Intake name<input data-wi-new="name" data-focus="new-name" value="'+esc(n.name)+'" maxlength="300"'+(closed?' disabled data-wi-fixed="true"':'')+'></label>'+
      '<label>Record type<select data-wi-new="kind" data-focus="new-kind"'+(closed?' disabled data-wi-fixed="true"':'')+'>'+options([['WORK','Recorded work'],['INVOICES','Supplier invoices']],n.kind)+'</select></label>'+
      '<label>Existing case source<select data-wi-new="sourceId" data-focus="new-source"'+(closed?' disabled data-wi-fixed="true"':'')+'>'+options([['','Choose a file below'],...caseView.sources.map(row=>[row.id,row.filename+' · '+row.bytes+' bytes'])],n.sourceId)+'</select></label>'+
      '<label>Original source URL · optional<input type="url" data-wi-new="sourceUrl" data-focus="new-url" value="'+esc(n.sourceUrl)+'"'+(closed?' disabled data-wi-fixed="true"':'')+'></label></div>'+
      '<div class="wi-file"><label>Original delimited file<input type="file" data-wi-file accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"'+(closed||Boolean(n.sourceId)?' disabled data-wi-fixed="true"':'')+'></label>'+
      (s.uploadFile?'<p>'+esc(s.uploadFile.name)+' · '+s.uploadFile.bytes.byteLength+' bytes '+button('Clear file','clear-file','',closed)+'</p>':'')+'</div>'+
      formatForm(n.format,'new',closed)+'<div class="wi-actions">'+button('Attach source and open intake','upload','',closed)+
      button('Open contributors','open','contributors')+'</div></details>';
  }
  function listPanel() {
    const list=caseView.workIntakes||[];
    return '<section class="wi-section"><h4>Saved intakes</h4>'+(list.length?
      table(['Intake','Source kind','Edition / state','Last saved',''],list.map(row=>[
        '<strong>'+esc(row.name)+'</strong>'+small(row.id),esc(row.kind==='WORK'?'Recorded work':'Supplier invoices'),
        esc(row.revision)+' '+badge(row.state),esc(row.updatedAt)+small(row.actor),
        button(row.id===s.selectedId?'Reopen current':'Open','select',row.id,Boolean(s.pending))
      ])):blank('Attach the first recorded-work or invoice source to begin.'))+'</section>';
  }
  function mappingPanel() {
    const doc=draft()||selected.intake.document,disabled=!edit(),kind=selected.intake.kind;
    return '<section class="wi-section"><h4>Columns and source format</h4><p>Choose each field by its original column position or enter one explicit value for every row. Required fields are marked with an asterisk.</p>'+
      formatForm(doc.format,'document',disabled)+
      '<div class="wi-fields">'+noteField('Source system · optional namespace for original row IDs','sourceSystem',doc.sourceSystem,disabled?'disabled data-wi-fixed="true"':'')+'</div>'+
      table(['Native field','Original source','Explicit value'],FIELDS[kind].map(field=>{
        const choice=doc.mapping[field],mode=choice?('value'in choice?'literal':String(choice.column)):'';
        return [esc(LABELS[field]+(REQUIRED[kind].includes(field)?' *':'')),
          '<select aria-label="'+esc(LABELS[field])+' source" data-wi-mapping="'+field+'" data-focus="map-'+field+'"'+(disabled?' disabled data-wi-fixed="true"':'')+'>'+
          options([['','Unmapped'],['literal','One explicit value'],...columns().map(col=>[String(col.index),String(col.index+1)+' · '+(col.label||'(blank header)')])],mode)+'</select>',
          mode==='literal'?'<input aria-label="'+esc(LABELS[field])+' value" data-wi-literal="'+field+'" data-focus="literal-'+field+'" value="'+esc(choice.value)+'"'+(disabled?' disabled data-wi-fixed="true"':'')+'>':small('Read from each source row')];
      }))+
      '<p class="wi-help">'+(kind==='WORK'?'Funding basis uses PREAWARD, GRANT, CUSTOMER or INTERNAL. Recorded hours retain up to four decimals.':
        'Rows with the same supplier and invoice number become ordered lines of one invoice. Each line uses an explicit USD amount. Separate linked work IDs with semicolons.')+'</p></section>';
  }
  function identityPanel() {
    const doc=draft()||selected.intake.document,disabled=!edit();
    function group(field,property,idField,choices,label){
      const original=[...new Set(sourceRows().map(row=>originValues(row)[field]).filter(Boolean))].sort();
      const existing=new Map(doc[property].map(row=>[row.sourceValue,row[idField]])),native=new Set(choices.map(row=>row[0]));
      const listId='wi-'+caseId+'-'+property;
      return '<h5>'+label+'</h5>'+(original.length?
        '<datalist id="'+esc(listId)+'">'+choices.map(([id,name])=>'<option value="'+esc(id)+'" label="'+esc(name)+'"></option>').join('')+'</datalist>'+
        table(['Exact source value','Original case record'],original.map(value=>[
          '<span class="wi-break">'+esc(value)+'</span>',
          '<input list="'+esc(listId)+'" data-wi-identity="'+property+'" data-original="'+esc(value)+'" aria-label="'+esc(label+' for '+value)+'" value="'+esc(existing.get(value)||'')+'" placeholder="'+
          (native.has(value)?'Use source identity directly':'Choose an existing case identity')+'"'+(disabled?' disabled data-wi-fixed="true"':'')+'>'
        ])):blank('Map the source column to show its distinct values.'));
    }
    return '<details class="wi-section" open><summary>Match contributors and work packages</summary><p>Choose each existing case identity from its suggestions or enter its exact ID. A source value that is already a native record ID can remain unchanged.</p>'+
      group('contributor','contributors','contributorId',people(),'Contributors / suppliers')+
      group('costId','costs','costId',packages(),'Work packages')+
      '<div class="wi-actions">'+button('Open contributors','open','contributors')+'</div></details>';
  }
  function correctionsPanel(){
    const doc=draft()||selected.intake.document;
    if(!doc.rowEdits.length&&!doc.recordDecisions.length)return '';
    return '<details class="wi-section"><summary>Retained corrections and decisions</summary>'+
      (doc.rowEdits.length?table(['Source row','Correction / exclusion','Reason',''],doc.rowEdits.map(item=>[
        esc(item.row),esc(item.skip?'Excluded':Object.keys(item.values).map(key=>LABELS[key]).join(', ')),
        esc(item.reason),button('Remove correction','remove-correction',String(item.row),!edit())
      ])):'')+
      (doc.recordDecisions.length?table(['Proposed record','Decision','Reason',''],doc.recordDecisions.map(item=>[
        esc(item.key),esc(item.action)+(item.recordId?small(item.recordId):''),esc(item.reason),
        button('Remove decision','remove-decision',item.key,!edit())
      ])):'')+'</details>';
  }
  function pageButtons(length,which,currentPage){
    const count=Math.max(1,Math.ceil(length/PAGE));
    return '<div class="wi-pagination">'+button('Previous',which+'-previous','',currentPage<=0)+
      '<span>Page '+(currentPage+1)+' of '+count+' · '+length+' '+(which==='rows'?'source rows':'records')+'</span>'+
      button('Next',which+'-next','',currentPage+1>=count)+'</div>';
  }
  function rowsPanel(){
    const all=sourceRows(),query=filter.trim().toLowerCase();
    const rows=query?all.filter(row=>[row.row,...row.cells,...(row.errors||[])].join(' ').toLowerCase().includes(query)):all;
    page=Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE)-1));
    return '<section class="wi-section"><h4>Original source rows</h4><div class="wi-fields"><label>Find text or a row number<input data-wi-filter data-focus="row-filter" value="'+esc(filter)+'"></label></div>'+
      pageButtons(rows.length,'rows',page)+table(['Row / lines','Source values','Review',''],rows.slice(page*PAGE,(page+1)*PAGE).map(row=>{
        const vals=originValues(row),details=FIELDS[selected.intake.kind].filter(field=>vals[field]).map(field=>esc(LABELS[field])+': '+esc(vals[field].length>220?vals[field].slice(0,220)+'…':vals[field])).join('<br>');
        const status=row.excluded?'Excluded':row.errors?.length?'Needs correction':preview?'Parsed':'Awaiting preview';
        return [esc(row.row)+small('Lines '+row.lineStart+'–'+row.lineEnd),'<div class="wi-cells">'+details+'</div>',
          badge(status)+(row.errors?.length?'<ul>'+row.errors.map(value=>'<li>'+esc(value)+'</li>').join('')+'</ul>':row.exclusionReason?small(row.exclusionReason):''),
          button(edit()?'Review / correct':'Inspect source row','row',String(row.row))];
      }))+'</section>';
  }
  function candidatesPanel(){
    if(!preview)return blank('Preview the complete intake to inspect proposed records and duplicate matches.');
    const list=preview.candidates;recordPage=Math.min(recordPage,Math.max(0,Math.ceil(list.length/PAGE)-1));
    return '<section class="wi-section"><h4>Proposed native records</h4>'+pageButtons(list.length,'records',recordPage)+
      table(['Record / source rows','Business values','Selection','Review',''],list.slice(recordPage*PAGE,(recordPage+1)*PAGE).map(row=>{
        const data=row.data,person=caseView.records.contributors.find(item=>item.id===data.contributorId);
        const business=row.kind==='work'?esc(data.description)+small(data.startDate+' to '+data.endDate+' · '+data.hours+' hours · '+data.fundingBasis):
          esc(data.number)+small(data.issuedDate+' · '+(data.lines?.length||0)+' lines · USD '+show(data.totalUsd));
        return [esc(person?.name||data.contributorId)+small('Source rows '+row.rows.join(', ')),business,
          badge(row.action)+(row.recordId?small(row.recordId):''),
          badge(row.state)+(row.errors.length?'<ul>'+row.errors.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul>':'')+
          (row.matches.length?small(row.matches.length+' existing match'+(row.matches.length===1?'':'es')):''),
          button('Inspect / decide','decision',row.key,!edit())];
      }))+'</section>';
  }
  function reviewedPanel(){
    if(!preview)return '<section class="wi-notice"><p>Preview all source rows after changing mappings, corrections or matching choices.</p></section>';
    const t=preview.summary;
    return '<section class="wi-section"><h4>Complete intake review</h4><dl class="wi-totals">'+[
      ['Original source rows',t.sourceRows],['New records',t.newRecords],['Existing matches',t.matchedRecords],
      ['Excluded source rows',t.excludedRows],['Excluded records',t.excludedRecords],['Items to resolve',t.issueCount],
      ['New hours',t.newHours],['Matched hours',t.matchedHours],['New invoice USD',t.newInvoiceUsd],['Matched invoice USD',t.matchedInvoiceUsd]
    ].map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl>'+
      (preview.issues.length?'<h5>Items to resolve</h5><ul class="wi-issues">'+preview.issues.map(issue=>'<li>'+
        esc((issue.row?'Row '+issue.row+': ':issue.rows?'Rows '+issue.rows.join(', ')+': ':'')+issue.message)+'</li>').join('')+'</ul>':
        '<p>All included source rows are ready. Applying creates the listed work and invoice records together.</p>')+
      '<p class="wi-help">Reviewed against case version '+preview.caseVersion+' and intake edition '+preview.intakeRevision+'.</p></section>';
  }
  function appliedPanel(){
    const applied=selected.intake.applied;
    return '<section class="wi-section"><h4>Applied intake</h4><p>'+esc(applied.actor)+' applied this source at '+esc(applied.appliedAt)+
      ', case version '+applied.caseVersion+'.</p>'+
      table(['Original rows','Operation','Native record','Recorded values',''],applied.links.map(link=>{
        const row=link.snapshot;
        return [esc(link.rows.join(', ')),badge(link.operation),'<span class="wi-break">'+esc(link.recordId)+'</span>',
          link.kind==='work'?esc(row.description)+small(row.hours+' hours · '+row.startDate+' to '+row.endDate):
            esc(row.number)+small('USD '+row.totalUsd+' · '+row.lines.length+' lines'),
          button(link.kind==='work'?'Open work':'Open invoices','open',link.kind)];
      }))+
      '<div class="wi-actions">'+button('Download original source','source-download')+button('Export complete case','case-download')+'</div></section>';
  }
  function selectedPanel(){
    if(!selected)return '';
    const row=selected.intake,doc=draft()||row.document,head=(caseView.workIntakes||[]).find(x=>x.id===row.id);
    return '<section class="wi-selected"><div class="wi-heading"><div><h3>'+esc(row.name)+'</h3><p>'+
      esc(row.kind==='WORK'?'Recorded work':'Supplier invoices')+' · edition '+row.revision+' '+badge(row.state)+
      (revisionView===null&&currentDraft()?.dirty?' <strong>Unsaved draft</strong>':'')+'</p></div><div class="wi-actions">'+
      button('Download source','source-download')+button('Export complete case','case-download')+'</div></div>'+
      '<p>'+esc(selected.source.filename)+' · '+selected.source.bytes+' original bytes</p>'+
      '<details class="wi-source-details"><summary>Source identity and saved editions</summary><p class="wi-break">'+esc(row.sourceId)+'<br>SHA-256 '+esc(row.sourceSha256)+'</p>'+
      '<label>Saved edition<select data-wi-history'+(s.pending?' disabled data-wi-fixed="true"':'')+'>'+
      options([['current','Current saved edition'],...selected.history.slice().reverse().map(item=>[String(item.revision),'Edition '+item.revision+' · '+tidy(item.state)+' · '+item.actor])],revisionView===null?'current':String(revisionView))+'</select></label>'+
      '<div class="wi-actions">'+button('Download mapping document','document-download')+
      button('Load mapping document','document-load','',!edit())+'</div></details>'+
      (revisionView!==null?'<section class="wi-notice"><p>Viewing saved edition '+revisionView+'. Current edition: '+(head?.revision||row.revision)+'.</p>'+button('Return to current edition','select',row.id,Boolean(s.pending))+'</section>':'')+
      (conflict?'<section class="wi-notice"><h4>The saved intake changed</h4><p>Your local draft began at edition '+conflict.originalRevision+
        '. Edition '+row.revision+' is now saved. Compare the mapping document and choose the version to continue editing.</p><div class="wi-actions">'+
        button('Continue my draft on current edition','keep-draft')+button('Use current saved edition','use-saved')+'</div></section>':'')+
      (row.state==='APPLIED'?appliedPanel():mappingPanel()+identityPanel()+correctionsPanel()+
        '<div class="wi-actions wi-toolbar">'+button('Save draft','save','',!edit())+button('Preview complete intake','preview','',!edit())+
        button('Apply reviewed intake','apply','',!edit()||!preview?.summary.ready||preview.caseVersion!==caseView.program.version)+
        button('Refresh case and retain draft','refresh','',Boolean(s.pending))+'</div>'+
        '<div class="wi-fields"><label>Recording note<textarea data-wi-note data-focus="recording-note" rows="2"'+(!edit()?' disabled data-wi-fixed="true"':'')+'>'+esc(currentDraft()?.note||'')+'</textarea></label></div>'+
        reviewedPanel()+'<nav class="wi-tabs" aria-label="Intake detail views">'+button('Source rows','tab','rows',false,'aria-pressed="'+(tab==='rows')+'"')+
        button('Proposed records','tab','records',false,'aria-pressed="'+(tab==='records')+'"')+'</nav>'+
        (tab==='records'?candidatesPanel():rowsPanel()))+'</section>';
  }
  function render(){
    if(!alive())return;const focus=focusState();
    root.innerHTML='<div class="wi-heading"><div><h3>Work and invoice intake</h3><p>Turn original timesheets and supplier invoice lines into the case’s recorded work and invoices.</p></div><div class="wi-actions">'+button('Bulk ledger intake','open','ledger-intake')+'</div></div>'+
      '<p data-wi-message role="'+(messageError?'alert':'status')+'" aria-live="polite">'+esc(message)+'</p>'+
      pendingPanel()+browserRecoveryPanel()+(cacheError&&!s.storageConflict?'<p class="wi-notice">Browser draft storage: '+esc(cacheError.message)+'</p>':'')+
      (caseView.program.state==='CLOSED'?'<p class="wi-notice">This case is closed. Its saved sources and records remain available. Reopen the case to record changes.</p>':'')+
      newSourcePanel()+listPanel()+selectedPanel()+
      '<input type="file" data-wi-document hidden accept=".json,application/json"><input type="file" data-wi-browser-document hidden accept=".json,application/json">'+
      '<dialog class="wi-dialog" aria-labelledby="wi-dialog-title"><form data-wi-dialog-form><h3 id="wi-dialog-title"></h3>'+
      '<div data-wi-dialog-body></div><p data-wi-dialog-error role="alert"></p><div class="wi-actions">'+button('Close','dialog-close')+
      '<button type="submit" data-wi-dialog-save>Save decision</button></div></form></dialog>';
    controls();restoreFocus(focus);
  }
  async function openSelected(id,revision=null) {
    const value=await saveApi(base+'/work-intakes/'+encodeURIComponent(id)+(revision===null?'':'?revision='+revision));
    if(!alive())return;
    selected=value;s.selectedId=id;revisionView=revision;preview=null;conflict=null;page=0;recordPage=0;
    if(revision===null&&value.intake.state==='DRAFT'){
      const retained=s.drafts[id];
      if(retained?.dirty&&retained.baseRevision!==value.intake.revision)conflict={originalRevision:retained.baseRevision};
      if(!retained||!retained.dirty)s.drafts[id]={document:copy(value.intake.document),baseRevision:value.intake.revision,dirty:false,note:retained?.note||''};
    }
    retain();render();
  }
  async function refreshCase() {
    caseView=await saveApi(base);
    if(alive()&&s.selectedId)await openSelected(s.selectedId);
    if(alive()){preview=null;render();setMessage('Refreshed the case. Your unsaved mapping and corrections remain available.');}
  }
  async function getPreview() {
    if(!edit())throw new Error('Open the current draft edition to preview this intake.');
    const value=await saveApi(base+'/work-intake-preview',{expectedVersion:caseView.program.version,intakeId:s.selectedId,
      revision:selected.intake.revision,document:copy(draft())});
    if(!alive())return;
    preview=value;currentDraft().document=copy(value.document);page=0;recordPage=0;retain();render();
    setMessage(value.summary.ready?'The complete intake is ready to apply.':value.summary.issueCount+' item'+(value.summary.issueCount===1?'':'s')+' need attention.');
  }
  async function finish(receipt) {
    s.pending.receipt=copy(receipt);s.pending.state='COMMITTED';s.lastReceipt=copy(receipt);await persist();
    const updated=await saveApi(base);
    const received=await saveApi(base+'/work-intakes/'+encodeURIComponent(receipt.recordId));
    const action=s.pending.body.action;s.lastRequest=copy(s.pending);s.selectedId=receipt.recordId;
    delete s.drafts[receipt.recordId];
    if(received.intake.state==='DRAFT')s.drafts[receipt.recordId]={document:copy(received.intake.document),baseRevision:received.intake.revision,dirty:false,note:''};
    if(action==='work-intake.upload'){s.uploadFile=null;s.newSource.name='';s.newSource.sourceId='';}
    s.pending=null;await persist();
    if(!alive())return;
    selected=received;caseView=updated;preview=null;revisionView=null;conflict=null;
    render();setMessage(action==='work-intake.apply'?'Applied the complete source intake. Its native record links are saved.':'Saved intake edition '+receipt.revision+'.');
    await onCase?.(updated,receipt);
  }
  async function sendPending(){
    if(s.inFlight){
      await s.inFlight;
      if(alive()){
        caseView=await saveApi(base);
        if(s.selectedId)await openSelected(s.selectedId);
        if(s.lastReceipt)await onCase?.(caseView,s.lastReceipt);
      }
      return;
    }
    const running=dispatchPending();s.inFlight=running;
    try{return await running;}finally{if(s.inFlight===running)s.inFlight=null;}
  }
  async function dispatchPending(){
    const pending=s.pending;if(!pending)throw new Error('There is no retained request to resume.');
    if(pending.receipt)return finish(pending.receipt);
    try{
      assertStaffRequestActor(pending.body,pinnedContext);
      const receipt=await saveApi(base+'/command',copy(pending.body));
      return await finish(receipt);
    }catch(error){
      if(!pending.receipt&&[400,409,413,415,422].includes(error.status)){
        pending.state='REJECTED';pending.error=error.message;pending.status=error.status;pending.code=error.code||null;
      }else if(!pending.receipt){pending.state='UNCERTAIN';pending.error=error.message;}
      await persist().catch(()=>{});
      if(alive())render();throw error;
    }
  }
  async function change(action,data,note=''){
    if(s.pending)throw new Error('Continue the retained request before preparing another change.');
    const body={expectedVersion:caseView.program.version,actor:recordingActor(),note,action,data};
    body.requestId=await mutationId('work-intake:'+caseId,body);
    s.pending={body:copy(body),state:'PREPARED',createdAt:new Date().toISOString(),receipt:null};
    try{await persist();cacheError=null;}catch(error){
      s.pending=null;cacheError=error;throw new Error('The browser could not retain the original request before sending: '+error.message);
    }
    render();return sendPending();
  }
  async function upload(){
    const n=s.newSource;if(!n.name.trim())throw new Error('Enter an intake name.');
    const data={name:n.name.trim(),kind:n.kind,format:copy(n.format)};
    if(n.sourceId)data.sourceId=n.sourceId;
    else{
      if(!s.uploadFile)throw new Error('Choose the original source file.');
      data.file={filename:s.uploadFile.name,contentBase64:base64(s.uploadFile.bytes),
        mediaType:n.format.delimiter==='\t'?'text/tab-separated-values':'text/csv',sourceUrl:n.sourceUrl,
        observedAt:new Date().toISOString()};
    }
    await change('work-intake.upload',data,'Opened original '+(n.kind==='WORK'?'recorded-work':'invoice')+' source.');
  }
  function openDialog(title,body,kind,canSave=true){
    dialogKind=kind;$('#wi-dialog-title').textContent=title;$('[data-wi-dialog-body]').innerHTML=body;
    $('[data-wi-dialog-error]').textContent='';$('[data-wi-dialog-save]').hidden=!canSave;
    $('dialog').showModal();
  }
  function rowDialog(number){
    const row=sourceRows().find(item=>item.row===number);
    if(!row)throw new Error('This row is outside the current source format. Remove its old correction or preview the current format.');
    const doc=draft()||selected.intake.document,old=doc.rowEdits.find(item=>item.row===number),values=originValues(row),writable=edit();
    const original=table(['Column','Header','Original cell'],columns().map(col=>[esc(col.index+1),esc(col.label),'<span class="wi-pre">'+esc(row.cells[col.index]??'')+'</span>']));
    let fields='';
    if(writable)fields='<h4>Corrected values</h4><p>Check only the fields that should override the source mapping.</p>'+
      FIELDS[selected.intake.kind].map(field=>'<div class="wi-correction"><label class="wi-check"><input type="checkbox" name="replace-'+field+'"'+(old&&Object.hasOwn(old.values,field)?' checked':'')+'>Replace '+esc(LABELS[field])+'</label>'+
      '<textarea aria-label="'+esc(LABELS[field])+' corrected value" name="value-'+field+'" rows="'+(field==='description'?3:1)+'">'+esc(values[field])+'</textarea></div>').join('')+
      '<label class="wi-check"><input type="checkbox" name="exclude-row"'+(old?.skip?' checked':'')+'>Exclude this source row</label>'+
      '<label>Reason for correction or exclusion<textarea name="row-reason" rows="3">'+esc(old?.reason||'')+'</textarea></label>';
    openDialog('Original row '+number+' · lines '+row.lineStart+'–'+row.lineEnd,original+fields,{kind:'row',number},writable);
  }
  function decisionDialog(key){
    const candidate=preview?.candidates.find(row=>row.key===key);
    if(!candidate)throw new Error('Preview the complete intake before selecting a proposed record.');
    const decision=draft().recordDecisions.find(row=>row.key===key),data=candidate.data;
    const detail=candidate.kind==='work'?table(['Field','Recorded value'],Object.entries(data).filter(([key])=>!['sourceNote','sourceIds'].includes(key)).map(([key,value])=>[esc(key),esc(show(value))])):
      '<p>Invoice '+esc(data.number)+' · '+esc(data.issuedDate)+' · due '+esc(show(data.dueDate))+'</p>'+
      table(['Source line','Description','Package','USD','Work IDs'],(data.lines||[]).map(line=>[esc(line.id),esc(line.description),esc(show(line.costId)),esc(line.amountUsd),esc(line.workIds.join('; '))]));
    const matches=candidate.matches.length?table(['Existing record','State','Business values'],candidate.matches.map(row=>[
      '<span class="wi-break">'+esc(row.id)+'</span>',badge(row.state),esc(row.sameBusinessValues?'Exact match':'Different values')
    ])):blank('No equivalent native record is currently retained.');
    const matching=candidate.matches.filter(row=>row.sameBusinessValues&&row.state!=='VOID').map(row=>[row.id,row.description+' · '+row.id]);
    openDialog('Record decision · source rows '+candidate.rows.join(', '),detail+'<h4>Existing records</h4>'+matches+
      '<div class="wi-fields"><label>Decision<select name="decision-action">'+options([
        ['AUTO','Use normal matching'],['CREATE','Record separate work / new invoice'],['REUSE','Use the exact existing record'],['SKIP','Exclude proposed record']
      ],decision?.action||'AUTO')+'</select></label>'+
      '<label>Existing record<select name="decision-record">'+options([['','Choose a matching record'],...matching],decision?.recordId||'')+'</select></label></div>'+
      '<label>Reason<textarea name="decision-reason" rows="3">'+esc(decision?.reason||'')+'</textarea></label>',
      {kind:'decision',key},edit());
  }
  root.addEventListener('submit',event=>{
    if(!event.target.matches('[data-wi-dialog-form]'))return;
    event.preventDefault();
    try{
      if(!edit())throw new Error('The current intake is not editable.');
      const form=new FormData(event.target),doc=draft();
      if(dialogKind.kind==='row'){
        const values={};for(const field of FIELDS[selected.intake.kind])if(form.has('replace-'+field))values[field]=String(form.get('value-'+field)||'');
        const skip=form.has('exclude-row'),reason=String(form.get('row-reason')||'').trim();
        if((skip||Object.keys(values).length)&&!reason)throw new Error('Record a reason for the correction or exclusion.');
        doc.rowEdits=doc.rowEdits.filter(row=>row.row!==dialogKind.number);
        if(skip||Object.keys(values).length)doc.rowEdits.push({row:dialogKind.number,values,skip,reason});
      }else{
        const action=String(form.get('decision-action')),recordId=action==='REUSE'?String(form.get('decision-record')||''):'';
        const reason=String(form.get('decision-reason')||'').trim();
        if(action!=='AUTO'&&!reason)throw new Error('Record the reason for this decision.');
        if(action==='REUSE'&&!recordId)throw new Error('Select the exact existing record.');
        doc.recordDecisions=doc.recordDecisions.filter(row=>row.key!==dialogKind.key);
        if(action!=='AUTO')doc.recordDecisions.push({key:dialogKind.key,action,recordId,reason});
      }
      $('dialog').close();markChanged();render();setMessage('Retained this correction in your draft. Preview again to review all affected records.');
    }catch(error){$('[data-wi-dialog-error]').textContent=error.message;}
  });
  root.addEventListener('change',event=>{
    const node=event.target;
    if(node.matches('[data-wi-browser-document]'))return run(()=>openBrowserTransfer(node.files?.[0]));
    if(node.matches('[data-wi-file]'))return run(async()=>{
      const file=node.files?.[0];if(!file)return;
      if(!file.size||file.size>MAX_SOURCE)throw new Error('Choose a nonempty original file up to 8 MiB.');
      s.uploadFile={name:file.name,type:file.type,bytes:await file.arrayBuffer()};
      if(!s.newSource.name)s.newSource.name=file.name.replace(/\.[^.]+$/,'');
      if(file.name.toLowerCase().endsWith('.tsv'))s.newSource.format.delimiter='\t';
      await persist();render();
    });
    if(node.matches('[data-wi-document]'))return run(async()=>{
      const file=node.files?.[0];if(!file)return;
      if(file.size>32*1024*1024)throw new Error('The mapping document exceeds the original request size.');
      const value=JSON.parse(await file.text());
      if(!value||typeof value!=='object'||Array.isArray(value)||!value.format||!value.mapping||!Array.isArray(value.rowEdits)||!Array.isArray(value.recordDecisions))
        throw new Error('Choose a complete intake mapping document.');
      const reviewed=await saveApi(base+'/work-intake-preview',{expectedVersion:caseView.program.version,
        intakeId:s.selectedId,revision:selected.intake.revision,document:value});
      currentDraft().document=copy(reviewed.document);markChanged();preview=reviewed;render();
      setMessage('Loaded the mapping document and reviewed all original source rows.');
    });
    if(node.matches('[data-wi-history]'))return run(()=>openSelected(s.selectedId,node.value==='current'?null:Number(node.value)));
    if(node.matches('[data-wi-new]')){s.newSource[node.dataset.wiNew]=node.value;retain();render();return;}
    if(node.matches('[data-wi-format]')){
      const isNew=node.dataset.prefix==='new';if(!isNew&&!edit())return;
      const format=isNew?s.newSource.format:draft().format;
      format[node.dataset.wiFormat]=node.dataset.wiFormat==='headerRow'?Number(node.value):node.value;
      if(isNew)retain();else markChanged();render();return;
    }
    if(node.matches('[data-wi-filter]')){filter=node.value;page=0;render();return;}
    if(!edit())return;
    if(node.matches('[data-wi-field]'))draft()[node.dataset.wiField]=node.value;
    else if(node.matches('[data-wi-mapping]')){
      const field=node.dataset.wiMapping;
      if(node.value==='')delete draft().mapping[field];
      else if(node.value==='literal')draft().mapping[field]={value:''};
      else draft().mapping[field]={column:Number(node.value)};
    }else if(node.matches('[data-wi-literal]'))draft().mapping[node.dataset.wiLiteral]={value:node.value};
    else if(node.matches('[data-wi-identity]')){
      const property=node.dataset.wiIdentity,idField=property==='contributors'?'contributorId':'costId',original=node.dataset.original;
      draft()[property]=draft()[property].filter(row=>row.sourceValue!==original);
      if(node.value)draft()[property].push({sourceValue:original,[idField]:node.value});
    }else if(node.matches('[data-wi-note]')){currentDraft().note=node.value;retain();return;}
    else return;
    markChanged();render();
  });
  root.addEventListener('input',event=>{
    const node=event.target;
    // Text edits update the retained draft while keeping typing and selection in place.
    if(node.matches('[data-wi-note]')&&edit()){currentDraft().note=node.value;retain();}
    else if(node.matches('[data-wi-new]')&&node.tagName==='INPUT'){s.newSource[node.dataset.wiNew]=node.value;retain();}
    else if(node.matches('[data-wi-field]')&&edit()){draft()[node.dataset.wiField]=node.value;markChanged();}
    else if(node.matches('[data-wi-literal]')&&edit()){draft().mapping[node.dataset.wiLiteral]={value:node.value};markChanged();}
  });
  root.addEventListener('click',event=>{
    const node=event.target.closest('[data-wi-action]');if(!node||node.disabled||!root.contains(node))return;
    const action=node.dataset.wiAction,value=node.dataset.value;
    if(action==='dialog-close'){$('dialog').close();return;}
    run(async()=>{
      if(action==='browser-download'){downloadBrowserDraft();return;}
      if(action==='browser-open'){$('[data-wi-browser-document]').click();return;}
      if(action==='browser-reconcile')return reconcileBrowserDraft();
      if(action==='select')return openSelected(value);
      if(action==='upload')return upload();
      if(action==='clear-file'){s.uploadFile=null;await persist();render();return;}
      if(action==='preview')return getPreview();
      if(action==='refresh')return refreshCase();
      if(action==='resume')return sendPending();
      if(action==='reconcile'){
        if(s.pending?.state!=='REJECTED')throw new Error('The original request result is still uncertain. Resume that request.');
        s.lastRequest=copy(s.pending);s.pending=null;await persist();await refreshCase();return;
      }
      if(action==='save'||action==='apply'){
        if(!edit())throw new Error('Open the current draft edition to record changes.');
        const data={intakeId:s.selectedId,expectedRevision:selected.intake.revision,document:copy(draft())};
        if(action==='apply'){
          if(!preview?.summary.ready||preview.caseVersion!==caseView.program.version)throw new Error('Preview the current complete intake before applying.');
          data.expectedPreviewSha256=preview.previewSha256;
        }
        return change('work-intake.'+action,data,currentDraft()?.note||'');
      }
      if(action==='keep-draft'){currentDraft().baseRevision=selected.intake.revision;conflict=null;markChanged();render();return;}
      if(action==='use-saved'){s.drafts[s.selectedId]={document:copy(selected.intake.document),baseRevision:selected.intake.revision,dirty:false,note:''};conflict=null;preview=null;await persist();render();return;}
      if(action==='tab'){tab=value;render();return;}
      if(action==='rows-next'){page++;render();return;}if(action==='rows-previous'){page--;render();return;}
      if(action==='records-next'){recordPage++;render();return;}if(action==='records-previous'){recordPage--;render();return;}
      if(action==='row')return rowDialog(Number(value));
      if(action==='decision')return decisionDialog(value);
      if(action==='remove-correction'){if(!edit())return;draft().rowEdits=draft().rowEdits.filter(row=>row.row!==Number(value));markChanged();render();return;}
      if(action==='remove-decision'){if(!edit())return;draft().recordDecisions=draft().recordDecisions.filter(row=>row.key!==value);markChanged();render();return;}
      if(action==='open'){await persist();return onOpen?.(value);}
      if(action==='document-load'){$('[data-wi-document]').click();return;}
      if(action==='document-download'){download(JSON.stringify(draft()||selected.intake.document,null,2)+'\n',s.selectedId+'-mapping.json');return;}
      if(action==='request-download'){download(JSON.stringify({caseId,...(s.pending||s.lastRequest)},null,2)+'\n','work-intake-original-request.json');return;}
      if(action==='source-download'){
        const response=await saveApi(base+'/sources/'+selected.intake.sourceId,undefined,{download:true});
        if(alive())download(await response.blob(),selected.source.filename,'application/octet-stream');return;
      }
      if(action==='case-download'){
        const response=await saveApi(base+'/export.zip',undefined,{download:true});
        if(alive())download(await response.blob(),caseId+'.zip','application/zip');return;
      }
    });
  });
  const earlier=mountEarlierStaffDesk({root,staffContext:pinnedContext,title:'Work and invoice intake',
    readCopy:async()=>{const value=await intakeStore('sf47-work-intake-drafts').cacheRead(caseId);return value?browserTransfer(value):null;},
    isBusy:()=>busy||hostBusy||!s.loaded||!!s.inFlight,setDeskBusy:value=>{busy=value;if(value)controls();else render();},
    describeCopy:value=>(value.desk.uploadFile?.name||value.desk.newSource?.name||'Original work and invoice input')+' · '+Object.keys(value.desk.drafts||{}).length+' editable mappings'+(value.desk.pending?' · original save pending':''),
    filename:caseId+'-earlier-intake-draft.json',
    openCopy:value=>openBrowserTransfer(new File([JSON.stringify(value)],'earlier-intake-draft.json',{type:'application/json'}))
  });
  const ready=(async()=>{
    if(!s.loaded){
      try{const cached=await cacheRead(caseId);s.storageVersion=cacheRevision(cached);if(cached?.caseId===caseId&&cached.schema==='stellar-forge.sf47-work-intake-browser.v1')Object.assign(s,cached);}
      catch(error){cacheError=error;}
      s.loaded=true;
    }
    if(!alive())return;
    render();
    if(s.pending){setMessage(s.pending.receipt?'Open the retained result to continue.':'The original saved request is available to resume.');return;}
    const id=s.selectedId&&(caseView.workIntakes||[]).some(row=>row.id===s.selectedId)?s.selectedId:null;
    if(id)await openSelected(id);
  })();
  return {ready,dispose,setHostBusy};
}

export {intakeStore as workPreparationDraftStore};
