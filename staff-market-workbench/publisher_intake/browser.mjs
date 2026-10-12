// MIT. Browser operator for the existing FSU publisher-intake service and project store.
const FIELDS = [
  ['survey_job_code','Publisher job code',true],['survey_job_title','Publisher job title',true],
  ['job_description','Publisher job description'],['scope_cut','Survey data cut',true],
  ['industry','Industry'],['geography','Geography'],['size_band','Organization size'],
  ['peer_id','Participant / peer ID'],['currency','Currency',true],['pay_period','Pay period',true],
  ['unit_multiplier','Source unit multiplier',true],['annual_hours','Annual hours basis'],
  ['annual_periods','Periods per year'],['effective_date','Effective date',true],
  ['p25','25th percentile'],['p50','Median / 50th percentile',true],['p75','75th percentile'],
  ['organization_count','Organizations reported'],['incumbent_count','Incumbents reported']
];
const FILTERS = ['industry','geography','size_band','peer_id','scope_cut','currency','survey_job_code'];
const LABELS = Object.fromEntries(FIELDS.map(([key,label])=>[key,label]));
const DECLARATIONS = new Set(['scope_cut','industry','geography','size_band','peer_id','currency',
  'pay_period','unit_multiplier','annual_hours','annual_periods','effective_date']);
const EMPTY_DEFAULTS = Object.fromEntries([...DECLARATIONS].map(field=>[field,'']));
let mountNumber = 0;

function node(tag,attributes={},...children) {
  const result=document.createElement(tag);
  for(const [key,value] of Object.entries(attributes)) {
    if(value===null||value===undefined||key==='value')continue;
    if(key.startsWith('on')&&typeof value==='function')result.addEventListener(key.slice(2).toLowerCase(),value);
    else if(key==='className')result.className=value;
    else if(['disabled','required','checked','multiple','hidden','open'].includes(key))result[key]=Boolean(value);
    else result.setAttribute(key,String(value));
  }
  for(const child of children.flat(Infinity)) {
    if(child===null||child===undefined||child===false)continue;
    result.append(child instanceof Node?child:document.createTextNode(String(child)));
  }
  if(Object.hasOwn(attributes,'value'))result.value=attributes.value??'';
  return result;
}
const option=(value,label)=>node('option',{value},label);
const textValue=value=>value===null||value===undefined||value===''?'Not reported':String(value);
function numberText(value) {
  return value===null||value===undefined?'Not reported':
    Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
}
function exactDecimalText(value) {
  const match=/^([+-]?)(\d+)(?:\.(\d+))?$/u.exec(String(value));
  if(!match)return String(value);
  return match[1]+match[2].replace(/\B(?=(\d{3})+(?!\d))/gu,',')+(match[3]!==undefined?'.'+match[3]:'');
}
function payText(row,key='p50') {
  const normalized=row?.normalized??row;
  const exact=normalized?.annualized_exact?.[key];
  const value=exact??normalized?.annualized?.[key];
  const currency=normalized?.currency??'';
  return value===null||value===undefined?'Not reported':
    (exact!==null&&exact!==undefined?exactDecimalText(exact):numberText(value))+(currency?' '+currency:'');
}
function cents(value) {
  if(value===null||value===undefined)return null;
  const match=/^(-?)(\d+)(?:\.(\d{1,2}))?$/u.exec(String(value));
  if(!match)return null;
  return (match[1]?-1n:1n)*(BigInt(match[2])*100n+BigInt((match[3]||'').padEnd(2,'0')));
}
function medianDifference(previous,current) {
  const beforeExact=cents(previous?.annualized_exact?.p50),afterExact=cents(current?.annualized_exact?.p50);
  if(beforeExact!==null&&afterExact!==null) {
    const difference=afterExact-beforeExact,absolute=difference<0n?-difference:difference;
    return (difference>0n?'+':difference<0n?'-':'')+
      exactDecimalText(String(absolute/100n)+'.'+String(absolute%100n).padStart(2,'0'));
  }
  const before=previous?.annualized?.p50,after=current?.annualized?.p50;
  if(before===null||before===undefined||after===null||after===undefined)return '—';
  const difference=after-before;
  return (difference>0?'+':'')+numberText(difference);
}
const displayDate=value=>value?String(value).replace('T',' ').replace(/\.\d+Z$/u,' UTC'):'Not reported';
const messageText=error=>error?.message||error?.error||String(error);
const safeName=value=>String(value||'publisher-data').normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/gu,'-').replace(/^-+|-+$/gu,'').slice(0,180)||'publisher-data';
const sameSurvey=(a,b)=>a?.source?.publisher_id===b?.source?.publisher_id&&a?.source?.survey_id===b?.source?.survey_id;
const editionLabel=edition=>[edition.source.publisher_name,edition.source.survey_name,edition.source.edition_id].join(' / ');

/**
 * Mount into the original workbench. request(action,payload) returns the direct
 * intake.mjs result after the host has retained the source/preview/review/cohort.
 * Review and cohort requests carry the explicit operator reviewer entered in this interface.
 * listEditions() returns complete reviewed editions, or {editions:[...]}.
 * onEdition(reviewedEditionOrCohort) selects that retained source in parent pricing.
 * Include publisher_intake/style.css in the original host.
 */
export function mountPublisherIntake(element,{request,listEditions,onEdition}={}) {
  if(!(element instanceof Element))throw new TypeError('Publisher intake needs a container element.');
  if(typeof request!=='function')throw new TypeError('Publisher intake needs the existing host request function.');
  const prefix='publisher-intake-'+(++mountNumber);
  let alive=true,operation=0,optionCache=new Map(),previewGroups=new Map(),previewGroupsHash='';
  const downloads=new Set();
  const state={
    tab:'source',busy:false,status:'',error:'',notice:'',reviewer:'',
    source:{publisher_id:'',publisher_name:'',survey_id:'',survey_name:'',edition_id:'',
      effective_date:'',license_reference:'',source_reference:'',filename:''},
    defaults:{currency:'USD',pay_period:'annual',unit_multiplier:'1',annual_hours:'',
      annual_periods:'',scope_cut:'',industry:'',geography:'',size_band:'',peer_id:''},
    csv:'',sourceFile:null,headers:[],sourceRows:null,delimiter:',',numberStyle:'plain',mapping:{},
    draftVersion:0,previewVersion:-1,preview:null,selected:new Set(),reviewReason:'',
    previewFilter:'all',previewQuery:'',previewPage:0,pageSize:25,detail:null,
    editions:new Map(),editionHash:'',cohort:null,cohortDirty:false,
    cohortForm:{id:'',label:'',reason:'',minOrganizations:''},
    filters:Object.fromEntries(FILTERS.map(key=>[key,new Set()])),
    filterEditor:null,filterQuery:'',filterPage:0,
    peerFilter:'included',peerQuery:'',peerPage:0,
    previousHash:'',currentHash:'',comparison:null,comparisonFilter:'all',comparisonQuery:'',
    comparisonPage:0,comparisonDetail:null
  };
  element.classList.add('publisher-intake');
  element.setAttribute('data-publisher-intake',prefix);

  const edition=()=>state.editions.get(state.editionHash)||null;
  const allEditions=()=>[...state.editions.values()].sort((a,b)=>
    String(b.review?.reviewedAt||'').localeCompare(String(a.review?.reviewedAt||'')));
  const previewStale=()=>Boolean(state.preview&&state.previewVersion!==state.draftVersion);
  function changed() { state.draftVersion++;state.notice=''; }
  function cohortChanged() {
    const previous=state.cohortDirty;state.cohortDirty=Boolean(state.cohort);state.notice='';
    if(!previous&&state.cohortDirty)render();
  }
  function button(label,action,{primary=false,disabled=false,className='',focusKey='action-'+safeName(label)}={}) {
    return node('button',{type:'button',className:(primary?'pi-primary ':'')+className,
      disabled:state.busy||disabled,'data-focus':focusKey,onClick:action},label);
  }
  function input(name,value,{type='text',required=false,maxLength=undefined,...attrs}={},update=()=>{}) {
    return node('input',{type,name,'data-focus':name,value,required,maxlength:maxLength,
      disabled:state.busy,...attrs,onInput:event=>update(event.target.value)});
  }
  function select(name,value,options,update,{multiple=false,...attrs}={}) {
    return node('select',{name,'data-focus':name,value,multiple,disabled:state.busy,...attrs,
      onChange:event=>update(event.target.value)},options.map(([key,label])=>option(key,label)));
  }
  function field(label,control,hint='') {
    const identifier=prefix+'-'+control.getAttribute('name');
    control.id=identifier;
    if(hint)control.setAttribute('aria-describedby',identifier+'-hint');
    return node('div',{className:'pi-field'},node('label',{for:identifier},label),control,
      hint?node('p',{id:identifier+'-hint',className:'pi-help'},hint):null);
  }
  const paragraph=(text,className='pi-help')=>node('p',{className},text);
  function stat(label,value) {
    return node('div',{className:'pi-stat'},node('strong',{},numberText(value)),node('span',{},label));
  }
  function section(title,...children) {
    return node('section',{className:'pi-section'},node('h3',{},title),...children);
  }
  function empty(title,description,action) {
    return node('div',{className:'pi-empty'},node('h3',{},title),node('p',{},description),action||null);
  }
  function setTab(tab) { state.tab=tab;state.detail=null;render(); }
  async function notifyEdition(result,{navigate=false}={}) {
    if(typeof onEdition!=='function')return;
    try { await onEdition(result,{navigate}); }
    catch(error) { state.notice='The source was retained. Parent selection needs another attempt: '+messageText(error); }
  }
  async function invoke(action,payload) {
    const value=await request(action,payload);
    if(value&&typeof value==='object'&&value.error)throw new Error(messageText(value));
    return value;
  }
  async function run(label,work) {
    if(state.busy||!alive)return;
    const current=++operation;
    state.busy=true;state.status=label;state.error='';state.notice='';render();
    try { await work(); }
    catch(error) { if(alive&&current===operation){state.error=messageText(error);state.status='';} }
    finally { if(alive&&current===operation){state.busy=false;render();} }
  }
  function rememberEdition(value) {
    if(value?.kind!=='reviewed'||!value.editionHash||!Array.isArray(value.rows))
      throw new Error('The host must return the complete reviewed edition.');
    state.editions.set(value.editionHash,value);
    return value;
  }
  function useEdition(value) {
    rememberEdition(value);state.editionHash=value.editionHash;state.cohort=null;state.cohortDirty=false;
    state.filters=Object.fromEntries(FILTERS.map(key=>[key,new Set()]));
    state.cohortForm={id:'',label:'',reason:'',minOrganizations:''};
    state.filterEditor=null;state.peerPage=0;state.detail=null;optionCache=new Map();
  }
  function setDefaultsFromPreview(preview) {
    state.source={...preview.source};
    state.mapping={...preview.mapping};state.defaults={...EMPTY_DEFAULTS,...preview.defaults};
    state.delimiter=preview.format.delimiter;state.numberStyle=preview.format.numberStyle;
    state.headers=[...preview.headers];state.sourceRows=preview.rows.length;
  }
  function seedSelection(preview) {
    const keys=new Set(),selected=new Set();
    for(const row of preview.rows) {
      if(!row.errors.length&&!row.conflictWith.length&&!keys.has(row.stableKey)) {
        keys.add(row.stableKey);selected.add(row.id);
      }
    }
    return selected;
  }
  async function readColumns() {
    if(!state.csv)throw new Error('Choose the original UTF-8 survey file first.');
    const result=await invoke('columns',{csv:state.csv,delimiter:state.delimiter});
    if(!Array.isArray(result?.headers)||result.headers.some(header=>typeof header!=='string'))
      throw new Error('The host columns action must return the original headers.');
    state.headers=[...result.headers];state.sourceRows=Array.isArray(result.rows)?result.rows.length:result.rows??null;
    const simplify=value=>value.toLowerCase().replace(/[\s_-]+/gu,'');
    const mapping={};
    for(const [key,label] of FIELDS) {
      if(Object.hasOwn(state.mapping,key)&&(state.mapping[key]===null||state.headers.includes(state.mapping[key])))
        mapping[key]=state.mapping[key];
      else {
        const matches=state.headers.filter(header=>[simplify(key),simplify(label)].includes(simplify(header)));
        mapping[key]=matches.length===1?matches[0]:null;
      }
    }
    state.mapping=mapping;
  }
  async function loadSource(file) {
    await run('Reading the original survey file…',async()=>{
      if(!file)throw new Error('Choose a survey CSV or tab-separated file.');
      if(file.size>25*1024*1024)throw new Error('The source file must be at most 25 MiB.');
      const bytes=await file.arrayBuffer();
      try { state.csv=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
      catch { throw new Error('The source file must use UTF-8. Export a UTF-8 CSV from the publisher file.'); }
      state.sourceFile={name:file.name,size:file.size,lastModified:file.lastModified};
      state.source.filename=file.name;changed();
      await readColumns();
      state.status='Source loaded. Review the metadata and exact column assignments.';
    });
  }
  function buildDefaults() {
    const result={};
    for(const [key,value] of Object.entries(state.defaults)) {
      if(value===''||value===null||value===undefined)continue;
      // Preserve the operator's decimal lexeme; the source engine validates
      // declaration numbers independently of the uploaded file's locale.
      result[key]=String(value);
    }
    return result;
  }
  async function makePreview() {
    await run('Preparing the retained import preview…',async()=>{
      if(!state.csv)throw new Error('Choose the original source file before generating a new preview.');
      const result=await invoke('preview',{csv:state.csv,source:{...state.source},
        mapping:{...state.mapping},defaults:buildDefaults(),delimiter:state.delimiter,numberStyle:state.numberStyle});
      if(result?.kind!=='preview'||!Array.isArray(result.rows)||!result.previewHash)
        throw new Error('The host must return the complete retained preview.');
      state.preview=result;state.previewVersion=state.draftVersion;state.selected=seedSelection(result);
      state.previewPage=0;state.previewFilter='all';state.previewQuery='';state.detail=null;
      state.tab='review';state.status='Preview ready. Review errors, source conflicts and the selected rows.';
    });
  }
  async function reviewPreview() {
    await run('Retaining the reviewed publisher edition…',async()=>{
      if(previewStale())throw new Error('Generate a fresh preview after changing source metadata or mapping.');
      if(!state.selected.size)throw new Error('Select at least one valid source row.');
      if(!state.reviewReason.trim())throw new Error('Enter the reason for this source-row selection.');
      if(!state.reviewer.trim())throw new Error('Enter the operator reviewer for this source selection.');
      const result=await invoke('review',{preview:state.preview,review:{
        expectedHash:state.preview.previewHash,reviewer:state.reviewer.trim(),reason:state.reviewReason.trim(),includeRows:[...state.selected]}});
      useEdition(result);state.tab='peers';state.status='Publisher edition reviewed and retained.';
      await notifyEdition(result);
    });
  }
  function identityRows(row) {
    if(previewGroupsHash!==state.preview.previewHash) {
      previewGroups=new Map();previewGroupsHash=state.preview.previewHash;
      for(const item of state.preview.rows) {
        const group=previewGroups.get(item.stableKey)||[];group.push(item);previewGroups.set(item.stableKey,group);
      }
    }
    return previewGroups.get(row.stableKey)||[row];
  }
  function chooseRow(row,include) {
    if(include) {
      for(const other of identityRows(row))state.selected.delete(other.id);
      state.selected.add(row.id);
    } else state.selected.delete(row.id);
    render();
  }
  async function createCohort() {
    await run('Reviewing and retaining the peer cohort…',async()=>{
      const source=edition();if(!source)throw new Error('Select a reviewed publisher edition.');
      const filters=Object.fromEntries(FILTERS.filter(key=>state.filters[key].size)
        .map(key=>[key,[...state.filters[key]]]));
      const minimum=state.cohortForm.minOrganizations===''?null:Number(state.cohortForm.minOrganizations);
      const result=await invoke('cohort',{edition:source,selection:{
        id:state.cohortForm.id,label:state.cohortForm.label,reviewer:state.reviewer.trim(),reason:state.cohortForm.reason,
        filters,minOrganizations:minimum}});
      if(result?.kind!=='cohort'||!Array.isArray(result.rows)||!Array.isArray(result.decisions))
        throw new Error('The host must return the complete retained cohort and row decisions.');
      state.cohort=result;state.cohortDirty=false;state.peerFilter='included';state.peerPage=0;
      state.status='Peer cohort reviewed and retained.';await notifyEdition(result);
    });
  }
  async function exportCsv(value) {
    await run('Preparing publisher CSV…',async()=>{
      const result=await invoke('csv',{edition:value});
      const csv=typeof result==='string'?result:result?.csv;
      if(typeof csv!=='string')throw new Error('The host CSV action must return CSV text or {csv}.');
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));downloads.add(url);
      const link=node('a',{href:url,download:safeName([value.source.publisher_id,value.source.survey_id,
        value.source.edition_id,value.kind==='cohort'?value.id:'reviewed'].join('-'))+'.csv'});
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},1000);
      state.status='CSV export prepared from the selected retained source.';
    });
  }
  async function compare() {
    await run('Comparing the retained annual editions…',async()=>{
      const previous=state.editions.get(state.previousHash),current=state.editions.get(state.currentHash);
      if(!previous||!current)throw new Error('Choose both reviewed editions.');
      if(previous.editionHash===current.editionHash)throw new Error('Choose two different editions.');
      const result=await invoke('compare',{previous,current});
      if(result?.kind!=='refresh-comparison'||!Array.isArray(result.changes))
        throw new Error('The host must return the complete edition comparison.');
      state.comparison=result;state.comparisonPage=0;state.comparisonFilter='all';
      state.comparisonQuery='';state.comparisonDetail=null;state.status='Edition comparison ready.';
    });
  }
  function startNextEdition() {
    const selected=edition();if(!selected)return;
    state.source={...selected.source,edition_id:'',effective_date:'',filename:'',source_reference:''};
    state.mapping={...selected.mapping};state.defaults={...EMPTY_DEFAULTS,...selected.defaults};
    state.delimiter=selected.format.delimiter;state.numberStyle=selected.format.numberStyle;
    state.csv='';state.sourceFile=null;state.headers=[];state.sourceRows=null;state.preview=null;
    state.selected=new Set();state.reviewReason='';changed();state.tab='source';
    state.status='Publisher and survey lineage retained. Choose the next edition’s original file.';render();
  }
  function sourcePanel() {
    const fileInput=node('input',{type:'file',name:'source-file','data-focus':'source-file',
      accept:'.csv,.tsv,text/csv,text/tab-separated-values',disabled:state.busy,
      onChange:event=>loadSource(event.target.files?.[0])});
    const metadata=[
      ['publisher_name','Publisher name'],['publisher_id','Publisher ID'],
      ['survey_name','Survey name'],['survey_id','Survey ID'],['edition_id','Edition ID'],
      ['effective_date','File effective date','date'],
      ['license_reference','License reference'],['source_reference','Source reference']
    ];
    const form=node('form',{onSubmit:event=>{event.preventDefault();setTab('mapping');}},
      section('Original publisher source',
        field('Survey CSV or tab-separated file',fileInput,'UTF-8, up to 25 MiB. The original file is retained by the workbench.'),
        state.source.filename?node('div',{className:'pi-file-summary'},
          node('strong',{},state.source.filename),
          paragraph((state.sourceFile?numberText(state.sourceFile.size)+' bytes · ':'')+
            (state.sourceRows===null?'Headers ready':numberText(state.sourceRows)+' source records')+
            ' · '+state.headers.length+' columns')):null,
        node('div',{className:'pi-grid pi-grid-2'},
          field('Column delimiter',select('delimiter',state.delimiter,[[',','Comma'],['\t','Tab'],[';','Semicolon']],
            value=>{state.delimiter=value;changed();if(state.csv)run('Reading source columns…',async()=>{await readColumns();state.status='Column delimiter updated.';});else render();})),
          field('Numeric convention',select('number-style',state.numberStyle,
            [['plain','Plain decimal: 1234.56'],['us','Comma groups, decimal point: 1,234.56'],['eu','Point groups, decimal comma: 1.234,56']],
            value=>{state.numberStyle=value;changed();}),
            'Choose the convention actually used in the source.'))),
      section('Publisher, survey and edition',
        paragraph('Publisher and survey IDs establish the lineage for annual comparisons. Reuse the same IDs for the next edition.'),
        node('div',{className:'pi-grid pi-grid-2'},metadata.map(([key,label,type])=>
          field(label,input('source-'+key,state.source[key],{type:type||'text',required:key!=='effective_date',
            maxLength:key.includes('reference')?2000:240},value=>{state.source[key]=value;changed();}),
            key==='effective_date'?'Used when an effective-date column is not mapped.':'')))),
      node('div',{className:'pi-actions'},
        node('button',{type:'submit',className:'pi-primary',disabled:state.busy||!state.headers.length},'Review column mapping')));
    return form;
  }
  function mappingPanel() {
    if(!state.headers.length)return empty('Choose the original source file','Column mapping uses the actual headers from the selected publisher file.',
      button('Choose source file',()=>setTab('source'),{primary:true}));
    const declarations=[
      ['currency','Currency','text'],['pay_period','Pay period','period'],['unit_multiplier','Unit multiplier','number'],
      ['annual_hours','Annual hours basis','number'],['annual_periods','Periods per year','number'],
      ['scope_cut','File data cut','text'],['industry','Industry','text'],['geography','Geography','text'],
      ['size_band','Organization size','text'],['peer_id','Participant / peer ID','text']
    ];
    const table=node('table',{className:'pi-table pi-mapping'},node('thead',{},node('tr',{},
      node('th',{scope:'col'},'Normalized field'),node('th',{scope:'col'},'Exact source column'),
      node('th',{scope:'col'},'When no column is mapped'))),
      node('tbody',{},FIELDS.map(([key,label,required])=>node('tr',{},
        node('th',{scope:'row'},label,required?node('span',{className:'pi-required'},' Required'):null),
        node('td',{},select('map-'+key,state.mapping[key]??'',
          [['',DECLARATIONS.has(key)?'Use file declaration':'Not supplied'],...state.headers.map(header=>[header,header])],
          value=>{state.mapping[key]=value||null;changed();},{'aria-label':'Source column for '+label})),
        node('td',{className:'pi-muted'},key==='effective_date'?textValue(state.source.effective_date):
          DECLARATIONS.has(key)?textValue(state.defaults[key]):required?'A source column is required':'Not reported')))));
    const defaults=node('div',{className:'pi-grid pi-grid-3'},declarations.map(([key,label,type])=>{
      const change=value=>{state.defaults[key]=value;changed();};
      const control=type==='period'?select('default-'+key,state.defaults[key],
        [['annual','Annual'],['hourly','Hourly'],['monthly','Monthly'],['weekly','Weekly'],['periodic','Other periodic']],change):
        input('default-'+key,state.defaults[key],{type:type==='number'?'number':'text',
          ...(type==='number'?{min:key==='unit_multiplier'?'0.000001':'1',step:'any'}:{maxLength:1000})},change);
      return field(label,control,key==='unit_multiplier'?'Use 1000 only for amounts reported in thousands.':
        key==='annual_hours'?'Required when hourly pay is supplied.':
        key==='annual_periods'?'Required for weekly and other periodic pay.':'');
    }));
    return node('form',{onSubmit:event=>{event.preventDefault();makePreview();}},
      section('Column assignments',
        paragraph('Matching column names may be preselected. Review each assignment against the publisher source. A mapped column takes precedence over its file declaration, including an empty source cell.'),
        node('div',{className:'pi-table-wrap',tabindex:'0','aria-label':'Column mapping table'},table)),
      section('Declarations for this file',
        paragraph('Apply these values only where they describe the entire file. Map the corresponding column when values vary by record.'),
        defaults),
      node('div',{className:'pi-actions'},button('Back to source',()=>setTab('source')),
        node('button',{type:'submit',className:'pi-primary',disabled:state.busy||!state.csv},'Generate import preview')));
  }
  function paginator(total,pageKey,{size=state.pageSize,onSize=null}={}) {
    const pages=Math.max(1,Math.ceil(total/size));state[pageKey]=Math.min(state[pageKey],pages-1);
    const page=state[pageKey];
    return node('div',{className:'pi-pagination'},
      node('span',{},total?(page*size+1)+'–'+Math.min(total,(page+1)*size)+' of '+numberText(total)+' records':'0 records'),
      node('div',{className:'pi-inline'},button('Previous',()=>{state[pageKey]--;render();},{disabled:page===0,focusKey:pageKey+'-previous'}),
        node('span',{},'Page '+(page+1)+' of '+pages),
        button('Next',()=>{state[pageKey]++;render();},{disabled:page>=pages-1,focusKey:pageKey+'-next'}),
        onSize?select('page-size-'+pageKey,String(size),[['25','25 per page'],['50','50 per page'],['100','100 per page']],
          value=>{onSize(Number(value));state[pageKey]=0;render();},{'aria-label':'Records per page'}):null));
  }
  function rowStatus(row) {
    if(row.errors.length)return 'Needs correction';
    if(row.conflictWith.length)return 'Conflicting source rows';
    if(row.duplicateOf)return 'Exact duplicate';
    if(row.warnings.length)return 'Review source notes';
    return 'Ready';
  }
  function sourceDetails(row,{decision=null,preview=false}={}) {
    const normalized=row.normalized;
    const items=[...row.errors,...row.warnings];
    const conflict=preview&&row.conflictWith.length?
      node('section',{className:'pi-detail-section'},node('h4',{},'Choose the retained source row'),
        paragraph('Only one record can be selected for this publisher job, data cut, peer and currency. Compare the source values before choosing.'),
        node('div',{className:'pi-choice-list'},[...identityRows(row)]
          .sort((a,b)=>a.inputRow-b.inputRow).map(other=>
            node('label',{className:'pi-choice'},node('input',{type:'radio',name:'conflict-'+row.stableKey,
              'data-focus':'conflict-row-'+other.id,checked:state.selected.has(other.id),disabled:state.busy||Boolean(other.errors.length)||previewStale(),
              onChange:()=>chooseRow(other,true)}),
              'Source record '+other.inputRow+' · '+textValue(other.normalized?.survey_job_title)+
              ' · annualized median '+payText(other)+' · organizations '+textValue(other.normalized?.organization_count)))),
        button('Exclude this identity',()=>{for(const other of identityRows(row))state.selected.delete(other.id);render();})):null;
    return node('div',{className:'pi-record-detail'},
      node('div',{className:'pi-detail-heading'},node('h4',{},'Original source record '+row.inputRow),
        button('Close details',()=>{state.detail=null;render();})),
      items.length?node('ul',{className:'pi-notes'},items.map(item=>node('li',{},(item.field?(LABELS[item.field]||item.field)+': ':'')+item.message))):null,
      decision?.reasons?.length?node('section',{},node('h4',{},'Cohort exclusion'),
        node('ul',{},decision.reasons.map(reason=>node('li',{},reason.code==='FILTER_MISMATCH'?
          (LABELS[reason.field]||reason.field)+' is '+textValue(reason.value)+'; it does not match the selected values.':
          reason.code==='SAMPLE_COUNT_UNKNOWN'?'The source does not report an organization count.':
          'Reported organizations '+reason.actual+' is below the selected minimum '+reason.minimum+'.')))):null,
      conflict,
      normalized?node('div',{className:'pi-grid pi-grid-2'},
        section('Reported and annualized pay',
          node('table',{className:'pi-table'},node('thead',{},node('tr',{},node('th',{},'Percentile'),node('th',{},'Reported'),node('th',{},'Annualized'))),
            node('tbody',{},['p25','p50','p75'].map(key=>node('tr',{},node('th',{scope:'row'},LABELS[key]),
              node('td',{},numberText(normalized[key])+' '+normalized.currency),node('td',{},payText(row,key)))))),
          paragraph('Period: '+normalized.pay_period+' · multiplier: '+normalized.unit_multiplier+
            ' · annualization factor: '+(normalized.annualization_factor_exact??normalized.annualization_factor)+' · effective date: '+normalized.effective_date)),
        section('Publisher job content',node('p',{className:'pi-prewrap'},textValue(normalized.job_description)),
          paragraph('Survey cut: '+normalized.scope_cut+' · peer: '+textValue(normalized.peer_id)))):null,
      section('Original column values',node('dl',{className:'pi-values'},Object.entries(row.raw).flatMap(([key,value])=>[
        node('dt',{},key),node('dd',{className:'pi-prewrap'},value===''?'(empty source cell)':value)]))),
      node('details',{className:'pi-provenance'},node('summary',{},'Source identifiers'),
        node('dl',{className:'pi-values'},node('dt',{},'Row ID'),node('dd',{},row.id),
          node('dt',{},'Normalized row fingerprint'),node('dd',{},textValue(row.fingerprint)))));
  }
  function rowsTable(rows,{pageKey,context='preview',decisions=new Map()}={}) {
    const preview=context==='preview';
    const total=rows.length,pages=Math.max(1,Math.ceil(total/state.pageSize));
    state[pageKey]=Math.min(state[pageKey],pages-1);
    const visible=rows.slice(state[pageKey]*state.pageSize,(state[pageKey]+1)*state.pageSize);
    const body=node('tbody');
    for(const row of visible) {
      const decision=decisions.get(row.id);
      body.append(node('tr',{'data-selected':preview?String(state.selected.has(row.id)):undefined},
        preview?node('td',{},node('input',{type:'checkbox',checked:state.selected.has(row.id),
          disabled:state.busy||Boolean(row.errors.length)||previewStale(),
          'aria-label':'Include source record '+row.inputRow,'data-focus':'source-row-'+row.id,
          onChange:event=>chooseRow(row,event.target.checked)})):null,
        node('td',{},row.inputRow),
        node('td',{},node('strong',{},textValue(row.normalized?.survey_job_code)),
          node('span',{className:'pi-secondary'},textValue(row.normalized?.survey_job_title))),
        node('td',{},textValue(row.normalized?.scope_cut),
          node('span',{className:'pi-secondary'},textValue(row.normalized?.peer_id))),
        node('td',{className:'pi-number'},payText(row)),
        node('td',{className:'pi-number'},textValue(row.normalized?.organization_count)),
        node('td',{},preview?rowStatus(row):decision?decision.included?'Included':'Excluded':'Reviewed'),
        node('td',{},button(state.detail===context+':'+row.id?'Hide':'Details',
          ()=>{state.detail=state.detail===context+':'+row.id?null:context+':'+row.id;render();},{focusKey:'details-'+context+'-'+row.id}))));
      if(state.detail===context+':'+row.id)body.append(node('tr',{className:'pi-detail-row'},
        node('td',{colspan:preview?8:7},sourceDetails(row,{decision,preview}))));
    }
    return node('div',{},
      node('div',{className:'pi-table-wrap',tabindex:'0','aria-label':preview?'Publisher source row review':'Reviewed publisher records'},
        node('table',{className:'pi-table'},node('thead',{},node('tr',{},
          preview?node('th',{scope:'col'},'Use'):null,node('th',{scope:'col'},'Record'),
          node('th',{scope:'col'},'Publisher job'),node('th',{scope:'col'},'Cut / peer'),
          node('th',{scope:'col',className:'pi-number'},'Annualized median'),
          node('th',{scope:'col',className:'pi-number'},'Organizations'),
          node('th',{scope:'col'},'Review'),node('th',{scope:'col'},'Details'))),body)),
      !visible.length?paragraph('No records match this view.'):null,
      paginator(total,pageKey,{onSize:size=>{state.pageSize=size;}}));
  }
  function rowSearch(row,query) {
    if(!query)return true;
    return [row.inputRow,row.normalized?.survey_job_code,row.normalized?.survey_job_title,
      row.normalized?.scope_cut,row.normalized?.peer_id,...Object.values(row.raw)].some(value=>String(value??'').toLowerCase().includes(query));
  }
  function previewPanel() {
    const preview=state.preview;
    if(!preview)return empty('Generate the import preview','The preview preserves every original source row and shows normalization errors and conflicting publisher records.',
      button('Review column mapping',()=>setTab('mapping'),{primary:true}));
    const query=state.previewQuery.toLowerCase().trim();
    const rows=preview.rows.filter(row=>{
      if(state.previewFilter==='errors'&&!row.errors.length)return false;
      if(state.previewFilter==='conflicts'&&!row.conflictWith.length)return false;
      if(state.previewFilter==='attention'&&!row.errors.length&&!row.warnings.length&&!row.conflictWith.length&&!row.duplicateOf)return false;
      if(state.previewFilter==='selected'&&!state.selected.has(row.id))return false;
      if(state.previewFilter==='excluded'&&state.selected.has(row.id))return false;
      return rowSearch(row,query);
    });
    const reason=node('textarea',{name:'review-reason','data-focus':'review-reason',rows:'3',maxlength:'4000',
      required:true,disabled:state.busy,value:state.reviewReason,onInput:event=>{state.reviewReason=event.target.value;}});
    return node('div',{},
      previewStale()?node('div',{className:'pi-callout',role:'status'},node('strong',{},'Source settings changed. '),
        'This is the earlier retained preview. Generate a fresh preview to review the changed source.',
        button('Generate fresh preview',makePreview,{primary:true,disabled:!state.csv})):null,
      node('div',{className:'pi-stats'},stat('Source records',preview.summary.rows),stat('Invalid',preview.summary.invalid),
        stat('Exact duplicates',preview.summary.duplicate),stat('Conflicting records',preview.summary.conflicting),stat('Selected',state.selected.size)),
      paragraph('Valid identities without conflicts are preselected once. Conflicting identities begin excluded. Selecting another row for the same identity replaces the earlier choice. Correct invalid source data through a new preview.'),
      node('div',{className:'pi-toolbar'},
        field('Show',select('preview-filter',state.previewFilter,[['all','All source records'],['attention','Needs attention'],['errors','Invalid records'],
          ['conflicts','Conflicting records'],['selected','Selected records'],['excluded','Excluded records']],
          value=>{state.previewFilter=value;state.previewPage=0;render();})),
        field('Find a record',input('preview-search',state.previewQuery,{type:'search',placeholder:'Job, title, cut, peer or original value'},
          value=>{state.previewQuery=value;state.previewPage=0;render();})),
        button('Select valid rows without conflicts',()=>{state.selected=seedSelection(preview);render();},{disabled:previewStale()}),
        button('Clear selection',()=>{state.selected.clear();render();},{disabled:previewStale()})),
      rowsTable(rows,{pageKey:'previewPage'}),
      node('form',{className:'pi-section',onSubmit:event=>{event.preventDefault();reviewPreview();}},
        node('h3',{},'Retain the reviewed edition'),
        field('Operator reviewer',input('reviewer',state.reviewer,{required:true,maxLength:240},value=>{state.reviewer=value;}),
          'The name or operator ID recorded with this source review.'),
        field('Reason for source-row selection',reason,'Describe the source choices, exclusions and conflict decisions. The reviewer and reason are retained with this edition.'),
        node('div',{className:'pi-actions'},button('Return to mapping',()=>setTab('mapping')),
          node('button',{type:'submit',className:'pi-primary',disabled:state.busy||previewStale()||!state.selected.size},
            'Retain '+numberText(state.selected.size)+' reviewed rows'))));
  }
  function editionMetadata(value) {
    return node('details',{className:'pi-provenance'},node('summary',{},'Publisher source and review'),
      node('dl',{className:'pi-values'},
        node('dt',{},'Publisher'),node('dd',{},value.source.publisher_name+' ('+value.source.publisher_id+')'),
        node('dt',{},'Survey'),node('dd',{},value.source.survey_name+' ('+value.source.survey_id+')'),
        node('dt',{},'Edition'),node('dd',{},value.source.edition_id),
        node('dt',{},'Original file'),node('dd',{},value.source.filename),
        node('dt',{},'License reference'),node('dd',{},value.source.license_reference),
        node('dt',{},'Source reference'),node('dd',{},value.source.source_reference),
        node('dt',{},'Source SHA-256'),node('dd',{},value.sourceSha256),
        node('dt',{},'Reviewer'),node('dd',{},textValue(value.review?.reviewer??value.reviewer)),
        node('dt',{},'Review date'),node('dd',{},displayDate(value.review?.reviewedAt)),
        node('dt',{},'Review reason'),node('dd',{className:'pi-prewrap'},value.review?.reason??value.reason)));
  }
  function filterValues(key) {
    const current=edition(),cacheKey=current.editionHash+':'+key;
    if(!optionCache.has(cacheKey)) {
      const values=new Map();let missing=0;
      for(const row of current.rows) {
        const value=row.normalized[key];
        if(typeof value!=='string'||!value.trim()){missing++;continue;}
        values.set(value,(values.get(value)||0)+1);
      }
      optionCache.set(cacheKey,{values:[...values.entries()].sort((a,b)=>a[0].localeCompare(b[0])),missing});
    }
    return optionCache.get(cacheKey);
  }
  function filterEditorPanel() {
    const key=state.filterEditor;if(!key)return null;
    const values=filterValues(key),query=state.filterQuery.toLowerCase().trim();
    const visible=values.values.filter(([value])=>!query||value.toLowerCase().includes(query));
    const size=50,pages=Math.max(1,Math.ceil(visible.length/size));
    state.filterPage=Math.min(state.filterPage,pages-1);
    return node('section',{className:'pi-filter-editor'},
      node('div',{className:'pi-detail-heading'},node('h4',{},'Select '+LABELS[key].toLowerCase()+' values'),
        button('Done',()=>{state.filterEditor=null;render();})),
      paragraph('No selected values means this criterion is open. Values come directly from the reviewed publisher edition.'),
      field('Find a source value',input('filter-query',state.filterQuery,{type:'search'},
        value=>{state.filterQuery=value;state.filterPage=0;render();})),
      node('div',{className:'pi-choice-list'},visible.slice(state.filterPage*size,(state.filterPage+1)*size)
        .map(([value,count])=>node('label',{className:'pi-choice'},
          node('input',{type:'checkbox','data-focus':'filter-value-'+key+':'+value,checked:state.filters[key].has(value),disabled:state.busy,
            onChange:event=>{if(event.target.checked)state.filters[key].add(value);else state.filters[key].delete(value);cohortChanged();render();}}),
          node('span',{},value),node('span',{className:'pi-muted'},numberText(count)+' records')))),
      paginator(visible.length,'filterPage',{size}),
      node('div',{className:'pi-actions'},
        button('Include shown values',()=>{for(const [value] of visible.slice(state.filterPage*size,(state.filterPage+1)*size))state.filters[key].add(value);cohortChanged();render();}),
        button('Use all values',()=>{state.filters[key].clear();cohortChanged();render();})),
      values.missing?paragraph(numberText(values.missing)+' records have no reported value for this criterion. An open criterion includes them.'):null);
  }
  function peerPanel() {
    const options=allEditions(),current=edition();
    const chooser=node('div',{className:'pi-toolbar'},
      field('Reviewed publisher edition',select('edition',state.editionHash,
        [['','Choose an edition'],...options.map(value=>[value.editionHash,editionLabel(value)])],
        value=>{if(state.editions.has(value))useEdition(state.editions.get(value));else state.editionHash='';render();})),
      typeof listEditions==='function'?button('Refresh retained editions',refresh):null);
    if(!current)return node('div',{},chooser,empty('Review a publisher edition','The peer selector works with the publisher’s reviewed records, original cuts, percentiles and sample counts.',
      button('Review source rows',()=>setTab('review'),{primary:true})));
    const cohort=state.cohort;
    const decisions=new Map((cohort?.decisions||[]).map(value=>[value.rowId,value]));
    const query=state.peerQuery.toLowerCase().trim();
    const rows=current.rows.filter(row=>{
      if(cohort&&state.peerFilter==='included'&&!decisions.get(row.id)?.included)return false;
      if(cohort&&state.peerFilter==='excluded'&&decisions.get(row.id)?.included)return false;
      return rowSearch(row,query);
    });
    const cohortForm=node('form',{onSubmit:event=>{event.preventDefault();createCohort();}},
      field('Operator reviewer',input('cohort-reviewer',state.reviewer,{required:true,maxLength:240},value=>{state.reviewer=value;cohortChanged();}),
        'The name or operator ID recorded with this cohort review.'),
      node('div',{className:'pi-grid pi-grid-3'},
        field('Cohort ID',input('cohort-id',state.cohortForm.id,{required:true,maxLength:120},
          value=>{state.cohortForm.id=value;cohortChanged();})),
        field('Cohort label',input('cohort-label',state.cohortForm.label,{required:true,maxLength:240},
          value=>{state.cohortForm.label=value;cohortChanged();})),
        field('Minimum reported organizations',input('cohort-minimum',state.cohortForm.minOrganizations,
          {type:'number',min:'1',max:'10000000',step:'1'},
          value=>{state.cohortForm.minOrganizations=value;cohortChanged();}),'Optional. An active minimum excludes unknown counts.')),
      node('div',{className:'pi-filter-grid'},FILTERS.map(key=>
        node('div',{className:'pi-filter'},node('strong',{},LABELS[key]),
          node('span',{className:'pi-muted'},state.filters[key].size?numberText(state.filters[key].size)+' selected values':'Any source value'),
          state.filters[key].size?node('p',{className:'pi-filter-values'},[...state.filters[key]].slice(0,4).join(' · ')+(state.filters[key].size>4?' · …':'')):null,
          button('Choose values',()=>{state.filterEditor=key;state.filterQuery='';state.filterPage=0;render();})))),
      filterEditorPanel(),
      field('Reason for peer selection',node('textarea',{name:'cohort-reason','data-focus':'cohort-reason',
        rows:'3',maxlength:'4000',required:true,disabled:state.busy,value:state.cohortForm.reason,
        onInput:event=>{state.cohortForm.reason=event.target.value;cohortChanged();}}),
        'Record why the selected industry, geography, size and participant cuts fit the analysis.'),
      node('div',{className:'pi-actions'},node('button',{type:'submit',className:'pi-primary',disabled:state.busy},'Review and retain peer cohort')));
    return node('div',{},chooser,editionMetadata(current),
      node('div',{className:'pi-actions'},button('Use full reviewed edition',()=>run('Selecting the retained edition…',async()=>{
        await notifyEdition(current,{navigate:true});state.status='Reviewed publisher edition selected.';})),
        button('Export reviewed edition CSV',()=>exportCsv(current)),button('Import next edition',startNextEdition)),
      section('Define the peer cohort',
        paragraph('Select existing publisher cuts. Reported sample counts stay with each record; counts across overlapping survey cuts are kept separate.'),cohortForm),
      cohort?node('div',{},state.cohortDirty?node('div',{className:'pi-callout'},'Peer settings changed. Review the cohort again to update its retained selection.'):null,
        node('div',{className:'pi-stats'},stat('Included',cohort.summary.included),stat('Excluded',cohort.summary.excluded),
          stat('Included with unknown sample count',cohort.summary.unknownSampleCounts)),
        node('div',{className:'pi-actions'},button('Use this peer cohort',()=>run('Selecting the retained cohort…',async()=>{
          await notifyEdition(cohort,{navigate:true});state.status='Peer cohort selected.';}),{disabled:state.cohortDirty}),
          button('Export peer cohort CSV',()=>exportCsv(cohort),{primary:true,disabled:state.cohortDirty}))):null,
      section(cohort?'Peer selection and exclusions':'Reviewed publisher records',
        node('div',{className:'pi-toolbar'},
          cohort?field('Show',select('peer-filter',state.peerFilter,[['included','Included records'],['excluded','Excluded records'],['all','All reviewed records']],
            value=>{state.peerFilter=value;state.peerPage=0;render();})):null,
          field('Find a record',input('peer-search',state.peerQuery,{type:'search',placeholder:'Job, title, cut or peer'},
            value=>{state.peerQuery=value;state.peerPage=0;render();}))),
        rowsTable(rows,{pageKey:'peerPage',context:'peers',decisions})));
  }
  function comparisonDetails(change) {
    const keys=[...new Set([...Object.keys(change.previous||{}),...Object.keys(change.current||{})])];
    const format=value=>value===null||value===undefined?'Not reported':
      typeof value==='object'?Object.entries(value).map(([key,item])=>(LABELS[key]||key)+': '+textValue(item)).join(' · '):String(value);
    return node('div',{className:'pi-record-detail'},
      node('div',{className:'pi-detail-heading'},node('h4',{},change.survey_job_code+' / '+change.scope_cut),
        button('Close details',()=>{state.comparisonDetail=null;render();})),
      node('table',{className:'pi-table'},node('thead',{},node('tr',{},node('th',{},'Publisher field'),
        node('th',{},'Previous edition'),node('th',{},'Current edition'))),
        node('tbody',{},keys.map(key=>node('tr',{'data-changed':String(change.changedFields.includes(key))},
          node('th',{scope:'row'},LABELS[key]||key.replaceAll('_',' ')),
          node('td',{className:'pi-prewrap'},format(change.previous?.[key])),
          node('td',{className:'pi-prewrap'},format(change.current?.[key])))))));
  }
  function annualPanel() {
    const editions=allEditions(),previous=state.editions.get(state.previousHash);
    const candidates=previous?editions.filter(value=>sameSurvey(previous,value)):editions;
    const current=state.comparison;
    const selector=node('form',{onSubmit:event=>{event.preventDefault();compare();}},
      node('div',{className:'pi-grid pi-grid-2'},
        field('Previous reviewed edition',select('previous-edition',state.previousHash,
          [['','Choose an edition'],...editions.map(value=>[value.editionHash,editionLabel(value)])],
          value=>{state.previousHash=value;if(state.currentHash&&!sameSurvey(state.editions.get(value),state.editions.get(state.currentHash)))state.currentHash='';state.comparison=null;render();})),
        field('Current reviewed edition',select('current-edition',state.currentHash,
          [['','Choose an edition'],...candidates.map(value=>[value.editionHash,editionLabel(value)])],
          value=>{state.currentHash=value;state.comparison=null;render();}))),
      node('div',{className:'pi-actions'},
        node('button',{type:'submit',className:'pi-primary',disabled:state.busy||!state.previousHash||!state.currentHash||state.previousHash===state.currentHash},'Compare editions'),
        typeof listEditions==='function'?button('Refresh retained editions',refresh):null));
    if(!current)return section('Annual survey editions',
      paragraph('Compare two retained editions of the same publisher and survey. Renamed job codes or cuts appear as added and retired records and can be crosswalked in the parent workbench.'),
      selector,editions.length<2?empty('Retain both editions','Import and review the next survey edition with the same publisher and survey IDs.',
        button('Import source file',()=>setTab('source'))):null);
    const query=state.comparisonQuery.toLowerCase().trim();
    const changes=current.changes.filter(change=>(state.comparisonFilter==='all'||state.comparisonFilter===change.status)&&
      (!query||[change.survey_job_code,change.scope_cut,change.previous?.survey_job_title,change.current?.survey_job_title]
        .some(value=>String(value??'').toLowerCase().includes(query))));
    const pages=Math.max(1,Math.ceil(changes.length/state.pageSize));
    state.comparisonPage=Math.min(state.comparisonPage,pages-1);
    const body=node('tbody');
    for(const change of changes.slice(state.comparisonPage*state.pageSize,(state.comparisonPage+1)*state.pageSize)) {
      const difference=medianDifference(change.previous,change.current);
      body.append(node('tr',{},node('td',{},change.status),
        node('td',{},node('strong',{},change.survey_job_code),node('span',{className:'pi-secondary'},
          change.current?.survey_job_title||change.previous?.survey_job_title)),
        node('td',{},change.scope_cut),node('td',{className:'pi-number'},payText(change.previous)),
        node('td',{className:'pi-number'},payText(change.current)),
        node('td',{className:'pi-number'},difference),
        node('td',{},change.changedFields.length?change.changedFields.map(key=>LABELS[key]||key.replaceAll('_',' ')).join(', '):'—'),
        node('td',{},button('Details',()=>{state.comparisonDetail=state.comparisonDetail===change.stableKey?null:change.stableKey;render();}))));
      if(state.comparisonDetail===change.stableKey)body.append(node('tr',{className:'pi-detail-row'},
        node('td',{colspan:'8'},comparisonDetails(change))));
    }
    return node('div',{},section('Annual survey editions',selector),
      node('h3',{},current.previousEdition+' → '+current.currentEdition),
      node('div',{className:'pi-stats'},['added','unchanged','changed','retired'].map(status=>stat(status[0].toUpperCase()+status.slice(1),current.summary[status]))),
      node('div',{className:'pi-toolbar'},field('Show',select('comparison-filter',state.comparisonFilter,
        [['all','All records'],['added','Added'],['changed','Changed'],['retired','Retired'],['unchanged','Unchanged']],
        value=>{state.comparisonFilter=value;state.comparisonPage=0;render();})),
        field('Find a publisher job',input('comparison-search',state.comparisonQuery,{type:'search'},
          value=>{state.comparisonQuery=value;state.comparisonPage=0;render();}))),
      node('div',{className:'pi-table-wrap',tabindex:'0','aria-label':'Annual edition comparison'},
        node('table',{className:'pi-table'},node('thead',{},node('tr',{},
          ['Change','Publisher job','Data cut','Previous annual median','Current annual median','Median change','Changed fields','Details']
            .map(label=>node('th',{scope:'col'},label)))),body)),
      !changes.length?paragraph('No edition changes match this view.'):null,
      paginator(changes.length,'comparisonPage',{onSize:size=>{state.pageSize=size;}}));
  }
  function render() {
    if(!alive)return;
    const active=document.activeElement,focus=element.contains(active)?active.getAttribute('data-focus'):null;
    const selection=focus&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null;
    const scrolls=[...element.querySelectorAll('.pi-table-wrap')].map(wrapper=>wrapper.scrollLeft);
    const tabs=[['source','1 Source'],['mapping','2 Columns'],['review','3 Row review'],['peers','4 Peer cohorts'],['annual','5 Annual editions']];
    const panels={source:sourcePanel,mapping:mappingPanel,review:previewPanel,peers:peerPanel,annual:annualPanel};
    element.replaceChildren(
      node('header',{className:'pi-header'},node('div',{},node('h2',{},'Publisher data and peer cohorts'),
        paragraph('Import survey editions, review source rows and retain the data used in compensation analysis.')),
        node('span',{className:'pi-edition-count'},state.editions.size+' retained '+(state.editions.size===1?'edition':'editions'))),
      node('nav',{className:'pi-tabs','aria-label':'Publisher intake workflow'},tabs.map(([key,label])=>
        node('button',{type:'button','aria-current':key===state.tab?'step':undefined,
          className:key===state.tab?'pi-current':'','data-focus':'nav-'+key,onClick:()=>setTab(key)},label))),
      node('div',{className:'pi-live',role:'status','aria-live':'polite','aria-atomic':'true'},state.status),
      state.error?node('div',{className:'pi-error',role:'alert'},node('strong',{},'Operation needs attention. '),state.error):null,
      state.notice?node('div',{className:'pi-callout',role:'status'},state.notice):null,
      node('div',{className:'pi-panel','aria-busy':String(state.busy)},panels[state.tab]()));
    if(focus) {
      const next=[...element.querySelectorAll('[data-focus]')].find(control=>control.getAttribute('data-focus')===focus);
      if(next&&!next.disabled) {
        next.focus({preventScroll:true});
        if(selection&&typeof next.setSelectionRange==='function')try{next.setSelectionRange(...selection);}catch{}
      }
    }
    [...element.querySelectorAll('.pi-table-wrap')].forEach((wrapper,index)=>{wrapper.scrollLeft=scrolls[index]||0;});
  }
  async function refresh() {
    if(typeof listEditions!=='function'){render();return;}
    await run('Loading retained publisher editions…',async()=>{
      const result=await listEditions(),values=Array.isArray(result)?result:result?.editions;
      if(!Array.isArray(values))throw new Error('The host listEditions callback must return complete reviewed editions.');
      const oldSelection=state.editionHash,next=new Map();
      for(const value of values) {
        if(value?.kind==='reviewed'&&value.editionHash&&Array.isArray(value.rows))next.set(value.editionHash,value);
        else throw new Error('A retained edition is missing its complete reviewed source.');
      }
      state.editions=next;
      if(!next.has(oldSelection)) {
        const first=allEditions()[0];if(first)useEdition(first);else state.editionHash='';
      }
      if(state.previousHash&&!next.has(state.previousHash))state.previousHash='';
      if(state.currentHash&&!next.has(state.currentHash))state.currentHash='';
      state.status='Retained publisher editions loaded.';
    });
  }
  render();
  if(typeof listEditions==='function')refresh();
  return {
    refresh,
    openEdition(value) { useEdition(value);state.tab='peers';render(); },
    openPreview(value,{csv=''}={}) {
      if(value?.kind!=='preview'||!Array.isArray(value.rows)||!value.previewHash)
        throw new TypeError('Open the original complete retained preview.');
      setDefaultsFromPreview(value);state.csv=csv;state.sourceFile=null;state.preview=value;state.previewVersion=state.draftVersion;
      state.selected=seedSelection(value);state.reviewReason='';state.previewPage=0;state.tab='review';render();
    },
    openCohort(value,sourceEdition) {
      if(value?.kind!=='cohort'||value.editionHash!==sourceEdition?.editionHash)
        throw new TypeError('Open the retained cohort with its exact reviewed publisher edition.');
      useEdition(sourceEdition);state.cohort=value;state.cohortDirty=false;
      state.cohortForm={id:value.id,label:value.label,reason:value.reason,minOrganizations:value.minOrganizations??''};
      state.filters=Object.fromEntries(FILTERS.map(key=>[key,new Set(value.filters[key]||[])]));
      state.tab='peers';render();
    },
    destroy() {
      alive=false;operation++;
      for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();
      element.replaceChildren();element.classList.remove('publisher-intake');element.removeAttribute('data-publisher-intake');
    }
  };
}
