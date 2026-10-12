// Workbook receiving inside the original Records operator. The host owns all
// source revisions, authentication, previews, history and IndexedDB drafts.
export function createWorkbookPanel(h) {
  const {el,txt,small,mono,row,card,field,input,area,select,button,table,detail,dl,badge,empty,heading}=h;
  const copy=v=>structuredClone(v),json=v=>JSON.stringify(v,null,2);
  const roles=[['template','Blank or reference template'],['reference','Supporting workbook'],['transfer-request','Records transfer request'],['custody-inventory','Actual custody inventory']];
  const fields=[['temporary_box','Temporary box number'],['schedule','Retention schedule'],['series_code','Record series code'],['series_title','Record series title'],['sequence_range','Sequence / file range'],['year_in_box','Year in box'],['destroy_date','Scheduled destroy date'],['permanent_box','Assigned permanent box number'],['remarks','Remarks / index'],['request_date','Request date']];
  const canonical=[['carton_ref','Actual permanent carton ID'],['site_ref','Actual custody site ID'],['admitted_at','Actual admission (UTC)'],['terminated_at','Actual termination (UTC)'],['termination_kind','Actual termination kind']];
  const contexts=[['department','Department'],['division','Division / section'],['account','Records account'],['contact','Authorized contact'],['contactEmail','Contact email'],['contactPhone','Contact phone'],['retentionAuthority','Actual schedule authority / reference'],['rateAuthority','Actual rate / contract authority'],['preparedBy','Form preparer'],['verifiedBy','Independent inventory verifier'],['verifiedAt','Verifier date / reference'],['verificationReference','Label / list verification reference']];
  const documentKinds=[['instructions','Original instructions'],['retention-schedule','Retention authority'],['rate-authority','Contract / rate authority'],['custody-transfer','Completed custody-transfer evidence'],['custody-receipt','Actual admission / destination receipt'],['inventory','Actual inventory evidence'],['other','Other original document']];
  const custodyFields=[['requestDate','Original request date'],['fromDepartment','Transferring department'],['fromDivision','Transferring division'],['fromContact','Transferring contact'],['fromTitle','Transferring title'],['fromEmail','Transferring email'],['fromPhone','Transferring phone'],['toDepartment','Receiving department'],['toDivision','Receiving division'],['toContact','Receiving contact'],['toTitle','Receiving title'],['toEmail','Receiving email'],['toPhone','Receiving phone'],['recordTypes','Description / types of records'],['quantity','Volume / quantity'],['formats','Original formats'],['inventoryReference','Attached detailed inventory reference'],['reason','Reason for transfer'],['conditions','Conditions of transfer'],['securityPrivacy','Security / privacy requirements'],['method','Transfer method'],['specialInstructions','Special instructions']];
  const current=()=>h.edition(),books=()=>current()?.workbooks||[];
  const u=()=>{const ui=h.ui();return ui.workbook||(ui.workbook={id:null,sheet:'',offset:0,limit:100,query:'',selected:[],rowDraft:null,owner:'',note:'',documentKind:'instructions',directory:'',outputDirectory:'',focused:null});};
  const selected=()=>books().find(b=>b.id===u().id)||null;
  const set=(key,value)=>{u()[key]=value;h.persist();};
  const change=()=>{h.changed();h.persist();};
  const need=(value,label)=>{if(typeof value!=='string'||!value.trim())throw new Error(label+' is required.');return value;};
  const utcNow=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
  const shaPattern=/^[0-9a-f]{64}$/;
  const same=(a,b)=>h.canonical(a)===h.canonical(b);
  const getOutput=()=>h.output()?.schema==='tj.records-workbook-inspection.v1'?h.output():null;
  const output=()=>{const native=getOutput();if(native?.assessment?.id===u().id)return native;return null;};
  const sourceCurrent=()=>{const b=selected(),o=output();return Boolean(b&&b.selection&&o?.assessment&&b.sha256===o.assessment.sha256&&same(b.selection,o.assessment.selection));};
  const resultCurrent=()=>sourceCurrent()&&h.preview()?.revisionId===h.revision()?.id&&!h.dirty();
  const canEdit=()=>h.editable();
  function ids() {const b=selected();return {periodId:h.period().id,editionId:current().id,workbookId:b?.id};}
  function sourceFile(path){return h.draft()?.files[path]||null;}
  async function inspect({sheet=u().sheet,offset=0,query=u().query,exactRow}={}) {
    if(!selected())throw new Error('Choose a retained workbook.');
    set('sheet',sheet);set('offset',offset);
    const args={...ids(),offset,limit:Number(u().limit)};
    if(sheet)args.sheet=sheet;if(query)args.query=query;if(exactRow)args.row=exactRow;
    return h.startWorkbookPreview(args);
  }
  async function upload(list) {
    if(!h.mutable())throw new Error('Return to the working source to receive a workbook.');
    if(!current())throw new Error('Choose an existing named period and edition.');
    current().workbooks ||= [];
    for(const file of [...list]) {
      if(!/\.xlsx$/i.test(file.name))throw new Error('Choose the actual .xlsx workbook; CSV and JSON use Sources & contracts.');
      if(file.size>8*1024*1024)throw new Error(file.name+' exceeds the original 8 MiB per-file source limit.');
      const bytes=new Uint8Array(await file.arrayBuffer()),sha=await h.digest(bytes),path='captures/'+sha+'.xlsx';
      if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('The selected file is not an OOXML ZIP workbook. Keep the actual original file.');
      let id='workbook-'+sha.slice(0,12);if(books().some(row=>row.id===id))id+='-'+crypto.randomUUID().slice(0,8);
      h.draft().files[path]={base64:h.to64(bytes),sha256:sha,bytes:bytes.length};
      current().workbooks.push({id,label:file.name,path,bytes:bytes.length,sha256:sha,capturedAt:utcNow(),
        sourceKind:'operator-provided-original-workbook',role:'reference',fieldMap:{},mapping:{},constants:{},
        context:{},requiredContext:[],requiredFields:[],documents:[],rowDecisions:[],custody:{}});
      u().id=id;u().sheet='';u().offset=0;u().selected=[];u().focused=null;u().rowDraft=null;
    }
    change();h.notice('The exact binary workbook is retained in the draft. Save and inspect its original sheets before declaring a row range.');
  }
  async function attachDocuments(list) {
    const book=selected();if(!book)throw new Error('Choose a workbook before attaching its original documents.');
    book.documents ||= [];
    for(const file of [...list]) {
      if(file.size>8*1024*1024)throw new Error(file.name+' exceeds the native 8 MiB source limit.');
      const data=new Uint8Array(await file.arrayBuffer()),sha=await h.digest(data);
      const suffix=(/\.([A-Za-z0-9]{1,8})$/.exec(file.name)?.[1]||'bin').toLowerCase();
      const path='captures/'+sha+'.'+suffix;
      h.draft().files[path]={base64:h.to64(data),sha256:sha,bytes:data.length};
      const existing=book.documents.find(d=>d.path===path&&d.kind===u().documentKind);
      if(existing)continue;
      book.documents.push({id:'document-'+sha.slice(0,16),label:file.name,path,sha256:sha,bytes:data.length,
        kind:u().documentKind,capturedAt:utcNow(),sourceKind:'operator-provided-original-document'});
    }
    change();h.notice('Original document bytes are retained. Naming a document does not record a signature or actual custody event.');
  }
  function choose(id) {u().id=id;u().sheet=selected()?.selection?.sheet||'';u().offset=0;u().selected=[];u().rowDraft=null;u().focused=null;h.persist();}
  function columnChoices(book=selected()) {
    const selectedSheet=output()?.workbook?.sheets?.find(s=>s.name===(book?.selection?.sheet||u().sheet));
    const found=new Set();
    for(const r of output()?.page?.items||[])for(const key of Object.keys(r.cells||{}))found.add(key);
    if(book?.selection) {
      const count=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
      const name=n=>{let s='';while(n){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;};
      const a=count(book.selection.firstColumn||'A'),b=count(book.selection.lastColumn||'A');
      if(b>=a&&b-a<256)for(let n=a;n<=b;n++)found.add(name(n));
    }
    return [...found];
  }
  function copyBounds() {
    const book=selected(),sheet=output()?.workbook?.sheets?.find(s=>s.name===u().sheet);
    if(!sheet?.populatedBounds)throw new Error('Inspect this original sheet to obtain its actual populated bounds.');
    book.selection={sheet:sheet.name,...copy(sheet.populatedBounds)};
    change();h.notice('Copied the observed populated bounds into the draft. Set the exact data rows; headers, signatures and blank form lines remain in the original.');
  }
  function applyRange() {
    const book=selected(),d=u().range;
    if(!book||!d)throw new Error('Choose an original workbook and range.');
    for(const key of ['sheet','firstColumn','lastColumn'])need(d[key],'Range '+key);
    const first=Number(d.firstRow),last=Number(d.lastRow);
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<1||last<first||last-first+1>10000)throw new Error('Choose an explicit inclusive range of up to 10,000 rows.');
    book.selection={sheet:d.sheet,firstRow:first,lastRow:last,firstColumn:d.firstColumn.trim().toUpperCase(),lastColumn:d.lastColumn.trim().toUpperCase()};
    u().sheet=d.sheet;u().selected=[];u().focused=null;u().rowDraft=null;u().range=null;change();
    h.notice('Applied the exact source range. Earlier row reviews remain retained and will be identified if they no longer bind.');
  }
  function startRange() {
    const book=selected(),sheet=output()?.workbook?.sheets?.find(s=>s.name===u().sheet),bounds=sheet?.populatedBounds;
    u().range=copy(book.selection||{sheet:u().sheet||'',firstRow:bounds?.firstRow||1,lastRow:bounds?.lastRow||1,
      firstColumn:bounds?.firstColumn||'A',lastColumn:bounds?.lastColumn||'A'});h.persist();
  }
  function rowValues(original) {
    const book=selected(),out={...copy(book.constants||{})};
    for(const [key,column] of Object.entries(book.mapping||{}))out[key]=original.cells?.[column]?.value??null;
    Object.assign(out,copy(original.decision?.values||{}));return out;
  }
  function editRow(original) {
    if(!sourceCurrent())throw new Error('Inspect this exact workbook/range before recording a row decision.');
    u().rowDraft={row:original.row,sourceRowSha256:original.sourceRowSha256,status:original.decision?.status||'pending',
      owner:original.decision?.owner||u().owner,note:original.decision?.note||'',values:rowValues(original),
      evidence:copy(original.decision?.evidence||{documentId:'',reference:original.locator}),original:copy(original)};
    h.persist();
  }
  function saveRow() {
    const d=u().rowDraft,book=selected();if(!d||!book)throw new Error('Select an original worksheet row.');
    if(!sourceCurrent())throw new Error('The selected workbook/range changed; inspect its original row again.');
    const old=(output()?.page?.items||[]).find(r=>r.row===d.row);
    if(old&&old.sourceRowSha256!==d.sourceRowSha256)throw new Error('The original row changed before this decision.');
    if(!['pending','include','exclude'].includes(d.status))throw new Error('Choose a row disposition.');
    const next={row:d.row,status:d.status,sourceRowSha256:d.sourceRowSha256,owner:need(d.owner,'Row reviewer'),
      note:need(d.note,'Reason and source reference'),at:utcNow()};
    if(d.status==='include') {
      next.values={};for(const [key] of canonical) {
        const value=d.values[key];
        if(value!==undefined)next.values[key]=['terminated_at','termination_kind'].includes(key)&&value===''?null:value;
      }
      next.evidence={documentId:need(d.evidence.documentId,'Actual custody evidence'),reference:need(d.evidence.reference,'Exact evidence reference')};
    }
    book.rowDecisions ||= [];const index=book.rowDecisions.findIndex(x=>x.row===d.row);
    if(index<0)book.rowDecisions.push(next);else book.rowDecisions[index]=next;
    u().owner=d.owner;u().rowDraft=null;change();
    h.notice('Recorded this original row in the draft. Save and inspect to apply the original custody requirements.');
  }
  function toggleRow(r,checked) {
    if(!sourceCurrent())throw new Error('Inspect the current workbook/range before selecting rows.');
    const id=r.row+':'+r.sourceRowSha256,selected=u().selected;
    const index=selected.findIndex(x=>x.id===id);
    if(checked&&index<0)selected.push({id,row:r.row,sourceRowSha256:r.sourceRowSha256,locator:r.locator,blank:r.blank});
    if(!checked&&index>=0)selected.splice(index,1);h.persist();
  }
  function bulkExclude() {
    const book=selected(),owner=need(u().owner,'Named reviewer'),note=need(u().note,'Reason for the selected exclusions');
    if(!sourceCurrent()||!u().selected.length)throw new Error('Select the explicit original rows to exclude.');
    book.rowDecisions ||= [];const at=utcNow();
    for(const original of u().selected) {
      const item={row:original.row,sourceRowSha256:original.sourceRowSha256,status:'exclude',owner,note,at};
      const index=book.rowDecisions.findIndex(r=>r.row===item.row);
      if(index<0)book.rowDecisions.push(item);else book.rowDecisions[index]=item;
    }
    u().selected=[];change();h.notice('The named exclusions preserve all selected original rows and their source hashes.');
  }
  function excludeBlank() {
    const book=selected(),assessment=output()?.assessment;
    if(!resultCurrent()||!assessment?.selectionSha256)throw new Error('Save and inspect this original range before declaring its blank rows non-records.');
    book.excludeBlankRows={selectionSha256:assessment.selectionSha256,owner:need(u().owner,'Named reviewer'),
      note:need(u().note,'Reason that the blank rows are not records'),at:utcNow()};
    change();h.notice('Saved a source-bound decision for genuinely blank rows. Formula cells and nonblank rows are not included in this rule.');
  }
  function approveMapping() {
    if(!resultCurrent())throw new Error('Save and inspect the exact draft before recording its mapping review.');
    const book=selected(),a=output().assessment;
    book.review={bindingSha256:a.bindingSha256,owner:need(u().owner,'Mapping reviewer'),
      note:need(u().note,'Mapping review and source reference'),at:utcNow()};
    change();h.notice('Recorded the named review of this exact mapping and source. Save and inspect its reviewed edition before adding the custody source.');
  }
  function promote() {
    if(!resultCurrent())throw new Error('Open the saved current workbook assessment first.');
    const source=output()?.custodySource;
    if(!source||!output().assessment.readyForCustodySource)throw new Error('Resolve the displayed actual row/input decisions before projecting custody.');
    if(current().requestSource)throw new Error('This edition uses a complete original request. Use a correction edition with separate original ledgers before adding another custody source.');
    const previous=current().sources.find(s=>s.workbookId===selected().id);
    const conflicting=current().sources.find(s=>s.id===source.id&&s!==previous);
    if(conflicting)throw new Error('This source identity belongs to another ledger file. Choose a different workbook sourceId.');
    if(previous)Object.assign(previous,copy(source));else current().sources.push(copy(source));
    change();h.notice('Added the exact reviewed original XLSX custody source. The original Records engine still checks all four ledgers, IDs, period and source completeness.');
  }
  function setMap(group,key,value) {
    const book=selected();book[group] ||= {};
    if(value)book[group][key]=value.trim().toUpperCase();else delete book[group][key];
    change();
  }
  function setRequired(group,key,checked) {
    const book=selected();const values=new Set(book[group]||[]);
    if(checked)values.add(key);else values.delete(key);book[group]=[...values];change();
  }
  function mappingFields() {
    const book=selected(),choices=columnChoices(),disabled=!canEdit();
    const fieldMap=book.fieldMap||(book.fieldMap={}),mapping=book.mapping||(book.mapping={});
    return card(txt('h3','Explicit original field mapping'),
      txt('p','Choose exact Excel column letters after reading the actual workbook. A merged header does not fill down into a box row. Raw numbers, dates and formula caches stay visible.'),
      el('datalist',{id:'workbook-columns'},choices.map(value=>el('option',{value}))),
      table(['Transfer-list field','Original column','Required for an included row'],fields.map(([key,label])=>[
        label,input(fieldMap[key]||'',{list:'workbook-columns',disabled,oninput:e=>setMap('fieldMap',key,e.target.value)}),
        el('input',{type:'checkbox',checked:(book.requiredFields||[]).includes(key),disabled,onchange:e=>setRequired('requiredFields',key,e.target.checked)})
      ])),
      txt('h3','Actual custody projection'),
      txt('p','Map only fields that establish actual custody. Temporary request numbers, request dates and scheduled destruction dates do not establish these original-engine values. Per-row reviewed values can supply an actual authority-assigned ID or evidenced event.'),
      table(['Original custody field','Actual source column','Explicit constant'],canonical.map(([key,label])=>[
        el('div',{},label,small(key)),input(mapping[key]||'',{list:'workbook-columns',disabled,oninput:e=>setMap('mapping',key,e.target.value)}),
        input(book.constants?.[key]??'',{disabled:disabled||Boolean(mapping[key]),oninput:e=>{
          book.constants ||= {};if(e.target.value!=='')book.constants[key]=e.target.value;else delete book.constants[key];change();
        }})
      ])),
      small('All time values must be actual whole-second UTC timestamps. No local timezone, midnight, destruction period, site or permanent barcode is inferred.'));
  }
  function contextFields() {
    const book=selected(),context=book.context||(book.context={}),disabled=!canEdit();
    return card(txt('h3','Department, source authorities and verification'),
      txt('p','Record the actual department/account, applicable retention and rate authorities, and existing verification. These source inputs remain separate from the original four-ledger contract.'),
      el('div',{class:'grid'},contexts.map(([key,label])=>field(label,input(context[key]||'',{disabled,oninput:e=>{context[key]=e.target.value;change();}})))),
      el('details',{},txt('summary','Declare which context fields the original instructions require'),
        el('div',{class:'details-body'},contexts.map(([key,label])=>field(label,el('input',{type:'checkbox',
          checked:(book.requiredContext||[]).includes(key),disabled,onchange:e=>setRequired('requiredContext',key,e.target.checked)}))))),
      txt('p','Record contents stay in the authorized source. The application does not print content descriptions on the outside of boxes or assign county barcodes.'),
      book.context?.preparedBy&&book.context.preparedBy===book.context.verifiedBy?txt('p','The preparer and verifier names match. Check the original independent-verification requirement before recording completion.',{class:'inline-note'}):null);
  }
  function docs() {
    const book=selected();
    return card(txt('h3','Original supporting documents'),
      field('Document role',select(documentKinds,u().documentKind,{disabled:!canEdit(),onchange:e=>set('documentKind',e.target.value)})),
      field('Receive original supporting files',el('input',{type:'file',multiple:true,disabled:!canEdit(),id:'workbook-documents',
        onchange:e=>h.run(()=>attachDocuments(e.target.files))}),'Preserve the actual instructions, retention schedule, rate authority, signed custody record or destination receipt.'),
      book.documents?.length?table(['Document','Kind','Original bytes / SHA256','Open'],book.documents.map(d=>[
        el('div',{},d.label,small(d.id)),select(documentKinds,d.kind,{disabled:!canEdit(),onchange:e=>{d.kind=e.target.value;change();}}),
        el('div',{},small(h.bytes(d.bytes)),mono(d.sha256)),button('Download original',()=>h.downloadSource(d.path),{read:true})
      ])):empty('No supporting documents have been received for this workbook.'),
      txt('p','A blank custody form is a template. Recording an acknowledgment requires the actual completed evidence and named original parties; the application never signs it.'));
  }
  function custodyForm() {
    const book=selected(),custody=book.custody||(book.custody={}),disabled=!canEdit();
    const choices=[['','Choose retained actual custody evidence'],...(book.documents||[]).filter(d=>['custody-transfer','custody-receipt','inventory'].includes(d.kind)).map(d=>[d.id,d.label||d.id])];
    return card(txt('h3','Custody request and original acknowledgments'),
      txt('p','Retain the original request details and each department’s actual acknowledgment. An unsigned or one-sided request remains a request; it does not become admission, withdrawal, destruction or an accepted handoff checkpoint.'),
      el('div',{class:'grid'},custodyFields.map(([key,label])=>field(label,input(custody[key]||'',{disabled,oninput:e=>{custody[key]=e.target.value;change();}})))),
      field('This transfer requires both retained acknowledgments before custody-source adoption',el('input',{type:'checkbox',checked:custody.requireBothAcknowledgments===true,disabled,
        onchange:e=>{custody.requireBothAcknowledgments=e.target.checked;change();}}),'Choose this only when the original transfer workflow requires both sides. An independently evidenced warehouse admission remains a separate event; custody-source readiness does not by itself mean a complete signed form.'),
      field('Detailed inventory was attached to the original request',el('input',{type:'checkbox',checked:custody.inventoryAttached===true,disabled,
        onchange:e=>{custody.inventoryAttached=e.target.checked;change();}}),'Retain the inventory document and its box/record identifiers, labels and actual counts.'),
      el('details',{},txt('summary','Required original custody-request fields'),el('div',{class:'details-body'},custodyFields.map(([key,label])=>
        field(label,el('input',{type:'checkbox',checked:(custody.requiredFields||[]).includes(key),disabled,onchange:e=>{
          const set=new Set(custody.requiredFields||[]);if(e.target.checked)set.add(key);else set.delete(key);custody.requiredFields=[...set];change();
        }}))))),
      ...['transferring','receiving'].map(side=>{
        const a=custody[side]||(custody[side]={status:'not-recorded',evidence:{documentId:'',reference:''}});
        a.evidence ||= {documentId:'',reference:''};
        return el('section',{},txt('h3',side==='transferring'?'Transferring department acknowledgment':'Receiving department acknowledgment'),
          el('div',{class:'grid'},
            field('Recorded state',select([['not-recorded','No acknowledgment recorded'],['requested','Requested / unsigned'],['acknowledged','Actual acknowledgment retained']],a.status,
              {disabled,onchange:e=>{a.status=e.target.value;change();}})),
            ...[['department','Actual department'],['name','Actual signatory name'],['title','Actual title'],['at','Actual acknowledgment time (UTC)']].map(([key,label])=>
              field(label,input(a[key]||'',{disabled,oninput:e=>{a[key]=e.target.value;change();}}))),
            field('Retained acknowledgment evidence',select(choices,a.evidence.documentId||'',{disabled,onchange:e=>{a.evidence.documentId=e.target.value;change();}})),
            field('Exact original page / signature / receipt reference',input(a.evidence.reference||'',{disabled,oninput:e=>{a.evidence.reference=e.target.value;change();}}))));
      }),
      output()?.assessment?.custody?detail('Original acknowledgment assessment',output().assessment.custody):null);
  }
  function selectedRows() {
    const o=output(),book=selected(),rows=o?.page?.items||[];
    if(!o)return card(txt('h3','Original worksheet rows'),empty('Save and inspect the received workbook to read its original sheet and cell values.'));
    const choices=book.selection?Object.keys(book.fieldMap||{}):[];
    return card(txt('h3','Original worksheet rows'),
      o.inspectionScope?.complete===false?txt('p','This is a worksheet overview of the explicitly displayed range. The full original populated bounds are retained below; declare the exact intake range to review every intended row.',{class:'inline-note'}):null,
      o.inspectionScope?detail('Exact inspected range',o.inspectionScope):null,
      el('div',{class:'grid'},
        field('Literal search',input(u().query,{disabled:!canEdit(),oninput:e=>set('query',e.target.value)})),
        field('Rows per original page',select([25,50,100,250,500].map(n=>[String(n),String(n)]),String(u().limit),{onchange:e=>set('limit',Number(e.target.value))}))),
      row(button('Inspect exact saved selection',()=>inspect(),{read:true}),button('Previous page',()=>inspect({offset:Math.max(0,o.page.offset-Number(u().limit))}),{read:true,disabled:o.page.offset===0}),
        button('Next page',()=>inspect({offset:o.page.nextOffset}),{read:true,disabled:!o.page.hasMore})),
      small('Rows '+(o.page.total?o.page.offset+1:0)+'–'+(o.page.offset+o.page.items.length)+' of '+o.page.total+(o.page.byteLimited?' · native page byte limit; the next page continues the same original selection':'')),
      rows.length?table(['Select','Original row','Original fields / cells','Actual custody','Disposition / action'],rows.map(r=>[
        el('input',{type:'checkbox',checked:u().selected.some(s=>s.row===r.row&&s.sourceRowSha256===r.sourceRowSha256),disabled:!canEdit()||!sourceCurrent(),onchange:e=>toggleRow(r,e.target.checked)}),
        el('div',{},mono(r.locator||r.id),small(r.blank?'Blank row':r.hidden?'Hidden original row':'Original row'),small(r.present?'Stored in original sheet':'Blank position in explicit range')),
        el('div',{},...(choices.length?choices.slice(0,8).map(key=>small(key+': '+h.fmt(r.fields?.[key]??r.cells?.[book.fieldMap[key]]?.value))):
          Object.entries(r.cells||{}).slice(0,6).map(([key,c])=>small(key+': '+h.fmt(c.value))))),
        el('div',{},mono(r.values?.carton_ref),small(r.values?.site_ref||''),small(r.values?.admitted_at||'')),
        el('div',{},badge(r.disposition||'unassigned'),...(r.issues||[]).map(i=>small(i.message)),
          row(button('Read all original cells',()=>{u().focused=copy(r);h.persist();},{read:true}),
              button('Review this row',()=>editRow(r),{disabled:!sourceCurrent()||!canEdit()})))
      ])):empty('This exact original selection contains no rows.'),
      u().focused?card(txt('h3','Complete original row · '+u().focused.locator),
        table(['Cell','Original type','Retained value','Original numeric / cached lexeme','Formula / display format'],Object.values(u().focused.cells||{}).map(c=>[
          mono(c.cell),c.type,mono(c.value),mono(c.raw),el('div',{},c.formula?detail('Formula and attributes',c.formula):small('No formula'),
            small('Style '+h.fmt(c.styleIndex)+' · format '+h.fmt(c.numberFormatId)),c.numberFormat?small(c.numberFormat):null)
        ])),
        txt('p','Absent cell positions within this exact range remain blank. Merged cells do not copy their anchor into adjacent records.'),
        detail('Complete original row identity',u().focused),button('Close row detail',()=>{u().focused=null;h.persist();},{read:true})):null,
      u().selected.length?detail('Explicit selected rows retained across pages',u().selected):null,
      el('div',{class:'grid'},field('Named operator / reviewer',input(u().owner,{disabled:!canEdit(),oninput:e=>set('owner',e.target.value)})),
        field('Decision reason and source reference',area(u().note,{disabled:!canEdit(),oninput:e=>set('note',e.target.value)}))),
      row(button('Exclude these '+u().selected.length+' selected rows',bulkExclude,{disabled:!canEdit()||!u().selected.length||!sourceCurrent()}),
        button('Record blank rows as non-records',excludeBlank,{disabled:!canEdit()||!resultCurrent()}),
        button('Clear selected rows',()=>{u().selected=[];h.persist();},{read:true})),
      txt('p','Exclusions retain the original row and reason. The blank-row rule uses this original workbook and range hash and never excludes formulas or nonblank rows.'));
  }
  function rowEditor() {
    const d=u().rowDraft,book=selected();if(!d)return null;
    const documents=[['','Choose actual custody evidence'],...(book.role==='custody-inventory'?[['$workbook','This actual original custody inventory']]:[]),
      ...(book.documents||[]).filter(x=>['custody-transfer','custody-receipt','inventory'].includes(x.kind)).map(x=>[x.id,x.label||x.id])];
    return card(txt('h3','Review worksheet row '+d.row),mono(d.original.locator),detail('Original field values',d.original.fields||d.original.cells),
      el('div',{class:'grid'},
        field('Disposition',select([['pending','Pending original inputs'],['include','Include actual custody record'],['exclude','Exclude with reason']],d.status,{disabled:!canEdit(),onchange:e=>{d.status=e.target.value;h.persist();h.render();}})),
        field('Named reviewer',input(d.owner,{disabled:!canEdit(),oninput:e=>{d.owner=e.target.value;h.persist();}})),
        field('Reason and exact source reference',area(d.note,{disabled:!canEdit(),oninput:e=>{d.note=e.target.value;h.persist();}}),null,true)),
      d.status==='include'?el('div',{},txt('p','These are actual original custody values, not temporary labels or planned dates. Confirm each value against the retained evidence.'),
        el('div',{class:'grid'},canonical.map(([key,label])=>field(label,key==='termination_kind'?
          select([['','Active / no termination'],['WITHDRAWN','Actual withdrawal'],['DESTROYED','Actual destruction']],d.values[key]||'',{disabled:!canEdit(),onchange:e=>{d.values[key]=e.target.value;h.persist();}}):
          input(d.values[key]??'',{disabled:!canEdit(),placeholder:key.endsWith('_at')?'YYYY-MM-DDTHH:MM:SSZ':'',oninput:e=>{d.values[key]=e.target.value;h.persist();}})))),
        field('Actual custody evidence',select(documents,d.evidence.documentId||'',{disabled:!canEdit(),onchange:e=>{d.evidence.documentId=e.target.value;h.persist();}})),
        field('Exact evidence page / row / receipt reference',input(d.evidence.reference||'',{disabled:!canEdit(),oninput:e=>{d.evidence.reference=e.target.value;h.persist();}}))):null,
      row(button('Record row decision in draft',saveRow,{primary:true,disabled:!canEdit()}),button('Cancel row edit',()=>{u().rowDraft=null;h.persist();},{read:true})));
  }
  function rangeCard() {
    const book=selected(),o=output(),sheetNames=(o?.workbook?.sheets||[]).filter(s=>s.kind==='worksheet').map(s=>[s.name,s.name+(s.state==='visible'?'':' · '+s.state)]);
    const spec=o?.workbook?.sheets?.find(s=>s.name===(u().sheet||book.selection?.sheet));
    return card(txt('h3','Original workbook and data range'),
      el('div',{class:'grid'},
        field('Workbook role',select(roles,book.role,{disabled:!canEdit(),onchange:e=>{book.role=e.target.value;change();}})),
        field('Label',input(book.label||'',{disabled:!canEdit(),oninput:e=>{book.label=e.target.value;change();}})),
        field('Source captured at (UTC)',input(book.capturedAt||'',{disabled:!canEdit(),oninput:e=>{book.capturedAt=e.target.value;change();}})),
        field('Original source kind',input(book.sourceKind||'',{disabled:!canEdit(),oninput:e=>{book.sourceKind=e.target.value;change();}})),
        field('Exact original sheet',select([['','Read original sheet list'],...sheetNames],u().sheet||'',{onchange:e=>set('sheet',e.target.value)}))),
      row(button('Save and read original workbook',()=>inspect({sheet:u().sheet}),{primary:true,read:true}),
        button('Edit exact data range',startRange,{disabled:!canEdit()}),
        button('Use observed populated bounds',copyBounds,{disabled:!canEdit()||!spec?.populatedBounds}),
        button('Download original XLSX',()=>h.downloadSource(book.path),{read:true})),
      book.selection?detail('Declared original range',book.selection):empty('No worksheet row range is admitted. Receive and inspect the original first.'),
      u().range?el('div',{},txt('h3','Inclusive source range'),el('div',{class:'grid'},
        field('Exact sheet name',input(u().range.sheet,{disabled:!canEdit(),oninput:e=>{u().range.sheet=e.target.value;h.persist();}})),
        ...[['firstRow','First row'],['lastRow','Last row'],['firstColumn','First column'],['lastColumn','Last column']].map(([key,label])=>field(label,input(u().range[key],{disabled:!canEdit(),oninput:e=>{u().range[key]=e.target.value;h.persist();}})))),
        row(button('Apply explicit range',applyRange,{primary:true,disabled:!canEdit()}),button('Cancel range edit',()=>{u().range=null;h.persist();},{read:true}))):null,
      spec?detail('Original sheet dimensions, merged ranges, hidden columns and validations',spec):null,
      o?.workbook?detail('Original date system, calculation flags and named ranges',o.workbook):null);
  }
  function reviewCard() {
    const book=selected(),assessment=output()?.assessment;
    return card(txt('h3','Reviewed mapping and custody-source adoption'),
      assessment?dl([['Original rows in selection',assessment.rows],['Included / excluded / pending',assessment.included+' / '+assessment.excluded+' / '+assessment.pending],
        ['Blank / hidden rows',assessment.blankRows+' / '+assessment.hiddenRows],['Current named mapping review',assessment.reviewCurrent?'Retained':'Required / changed'],
        ['Ready for original custody input',assessment.readyForCustodySource?'Yes':'Inputs or row decisions remain'],
        ['Binding SHA256',mono(assessment.bindingSha256)]]):empty('Inspect this saved original to assess its mapping and row decisions.'),
      assessment?.issues?.length?table(['Original input / row','What remains'],assessment.issues.map(x=>[el('div',{},mono(x.code),small(x.row?'Worksheet row '+x.row:'')),x.message])):null,
      assessment&&assessment.issueCount>assessment.issues.length?small(assessment.issueCount+' total issues. Inspect exact rows or export the complete intake for every record.'):null,
      el('div',{class:'grid'},field('Named mapping reviewer',input(u().owner,{disabled:!canEdit(),oninput:e=>set('owner',e.target.value)})),
        field('Review reason and actual source reference',area(u().note,{disabled:!canEdit(),oninput:e=>set('note',e.target.value)}))),
      row(button('Record this exact mapping review',approveMapping,{disabled:!canEdit()||!resultCurrent()}),
        button('Save and assess reviewed source',()=>inspect(),{read:true}),
        button('Add / refresh original custody source',promote,{primary:true,disabled:!canEdit()||!resultCurrent()||!output()?.custodySource})),
      book.review?detail('Retained named source review',book.review):null,
      current().sources.some(s=>s.workbookId===book.id)?detail('Original custody source in this edition',current().sources.find(s=>s.workbookId===book.id)):null,
      txt('p','This records an operator’s source mapping decision. County approval, signatures, barcodes, dates, rates and actual movement remain their original separate facts. Reconciliation uses the existing four ledgers and preserves earlier revisions.'));
  }
  function deliveryCard() {
    const book=selected(),directory=u().directory||'/absolute/original-records-operation',out=u().outputDirectory||'/absolute/new-workbook-handoff';
    const selection=' --revision '+h.shell(h.revision()?.id||'SAVED_REVISION')+' --workbook '+h.shell(book.id)+' --period '+h.shell(h.period().id)+' --edition '+h.shell(current().id);
    const command='records-workspace workbook --dir '+h.shell(directory)+selection+' --out '+h.shell(out);
    return card(txt('h3','Complete original receiving and handoff'),
      txt('p','The complete workbook handoff includes original.xlsx, every supporting document, all selected original rows, named decisions, mapping status and any eligible custody projection. Its result can remain a fully retained request without claiming completed custody.'),
      el('div',{class:'grid'},field('Existing Records workbench directory',input(u().directory,{oninput:e=>set('directory',e.target.value)})),
        field('New complete workbook handoff directory',input(u().outputDirectory,{oninput:e=>set('outputDirectory',e.target.value)}))),
      txt('pre',command),
      row(button('Copy exact saved-source handoff command',async()=>{await navigator.clipboard.writeText(command);h.notice('Copied the command for the current original saved revision.');},{read:true}),
        button('Download full workspace portable',()=>h.download('/api/export','records-workbook-workspace.json'),{read:true}),
        button('Open original history / restore',()=>h.go('history'),{read:true})),
      txt('p','The native portable retains the original workbook bytes and every saved revision/preview. Use the complete Records operator handoff for the original application and its unchanged customer/AP projections. No workbook is rewritten and no custody form is submitted.'),
      detail('Original workbook descriptor and current decisions',book));
  }
  function render() {
    const book=selected();
    return [heading('Workbook receiving and custody','Receive the actual transfer workbook, inspect its original cells and map attributed custody records into the existing Records ledger.',
      button('Save working source',h.saveDraft,{disabled:!canEdit()})),
      card(txt('h3','Receive or reopen original workbooks'),
        field('Receive original XLSX files',el('input',{type:'file',accept:'.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',multiple:true,disabled:!canEdit(),id:'receive-workbook',
          onchange:e=>h.run(()=>upload(e.target.files))}),'Original bytes are retained once by SHA256. Excel formulas are not run, dates are not converted, and a blank template remains a reference.'),
        books().length?table(['Original workbook','Role / original identity','Select'],books().map(b=>[
          el('div',{},b.label||b.id,small(b.id)),el('div',{},small(roles.find(x=>x[0]===b.role)?.[1]||b.role),mono(b.sha256),small(h.bytes(b.bytes))),
          button(b.id===u().id?'Selected':'Open workbook',()=>choose(b.id),{read:true})
        ])):empty('No workbook originals are declared in this edition. The existing CSV/JSON ledger sources remain in Sources & contracts.')),
      !book?null:rangeCard(),!book?null:mappingFields(),!book?null:contextFields(),!book?null:docs(),
      !book?null:selectedRows(),!book?null:rowEditor(),!book?null:custodyForm(),!book?null:reviewCard(),!book?null:deliveryCard()];
  }
  function acceptPreview(value) {
    const next=u();next.id=value.workbookId||next.id;next.sheet=value.sheet||selected()?.selection?.sheet||'';
    next.offset=value.offset||0;next.limit=value.limit||100;next.query=value.query||'';next.focused=null;
  }
  return {render,acceptPreview};
}
