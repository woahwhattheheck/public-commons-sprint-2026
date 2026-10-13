/**
 * Grant Operations section and saved-case search model.
 * Pure data functions shared by the browser shell and native callers.
 * Search is local to the complete supplied case response; attached file bytes
 * are not decoded or indexed.
 */
export const NAVIGATION_SCHEMA = 'stellar-forge.sf47-operating-desk.v1';

export const NAVIGATION_GROUPS = [
  {id:'planning',label:'Planning and resources'},
  {id:'people',label:'People and work'},
  {id:'cash',label:'Cash and accounts'},
  {id:'delivery',label:'Customers and delivery'},
  {id:'review',label:'Review and results'},
  {id:'other',label:'Other sections'},
];

const sectionDetails = {
  overview:['planning','Compare the pinned plan with recorded work, invoices and observed cash.','home overview actual results totals'],
  amendments:['planning','Review changes to the retained plan and preserve the original operating history.','baseline budget revision change'],
  performance:['planning','Inspect budget performance and its original work and payment sources.','budget variance cost performance'],
  funding:['planning','Review how original costs are funded and retain the selected funding sources.','cost funding request contribution grant customer'],
  forecast:['planning','Prepare a complete operating forecast with cash dates, currencies and retained assumptions.','cashflow cash flow forecast runway exchange fx'],
  portfolio:['planning','Allocate original delivery resources across saved forecast alternatives.','resource staffing capacity allocation alternative'],
  contributors:['people','Find the people, teams and suppliers attached to recorded work and invoices.','person organization supplier contact'],
  engagements:['people','Retain contributor agreements, acceptance and availability with their original sources.','agreement contract engagement availability acceptance'],
  risks:['delivery','Review dated delivery risks, current issues, owners, mitigation actions and their original source evidence.','risk issue mitigation action assessment likelihood impact priority overdue resolution register'],
  work:['people','Record and review completed contributor work against the original work packages.','timesheet time hours task effort'],
  invoices:['people','Record supplier invoices, original lines and links to completed work.','bill invoice expense liability'],
  'supplier-account':['people','Inspect supplier balances, invoice payments and the original account history.','accounts payable supplier balance dispute payment'],
  workbook:['people','Prepare and exchange complete editable work and invoice workbooks, then review returned changes.','xlsx workbook timesheet supplier invoice return'],
  'supplier-statements':['people','Reconcile original supplier statements with invoices, payments and refunds.','supplier statement accounts payable reconciliation'],
  'work-intake':['people','Receive complete original timesheet and supplier invoice files with reviewed mappings.','timesheet invoice csv tsv import intake'],
  'ledger-intake':['people','Inspect and receive complete source tables through the original ledger writers.','bulk ledger csv tsv json import source'],
  'expense-billing':['cash','Review customer recovery of original buyer expense portions, customer terms, native invoices and corrections.','expense recovery recharge reimbursement customer billing credit replacement'],
  expenses:['cash','Attribute original issued buyer expenses and credits to retained work packages with their accountant sources.','buyer expense credit accountant issued allocation valuation cost'],
  settlements:['cash','Open the original merchant settlement receiving desk.','merchant settlement receipt cash payment'],
  'award-terms':['cash','Open the retained issuer terms and their original operating context.','issuer grant award terms tranche'],
  cash:['cash','Inspect observed cash movements, original corrections and issuer events.','bank cash payment receipt refund award issuer'],
  statements:['cash','Inspect original CSV, OFX, QFX and MT940 statements and receive reviewed cash movements.','bank statement account ofx qfx mt940 csv import'],
  'account-reconciliation':['cash','Match original statement rows and observed cash, then export or reopen the full account.','reconcile matching account statement outstanding period close'],
  calendar:['delivery','Inspect dated grant delivery and payment obligations with their original sources.','calendar deadline payment date tranche schedule'],
  'cohort-planning':['delivery','Plan customer adoption using complete customer requests and the original proposal rules.','adoption customer plan cohort proposal'],
  'cohort-delivery':['delivery','Continue the original customer cohort delivery workflow.','customer cohort delivery execution'],
  procedures:['delivery','Open the original operating procedures for customer work.','procedure instructions customer operating work'],
  delivery:['delivery','Inspect deployments, native purchase observations and their delivered outcomes.','deployment buyer merchant purchase intent outcome'],
  installations:['delivery','Commission customer installations and retain the selected operating and receiving work.','installation commission customer workshare handover'],
  commercial:['delivery','Review milestone customer billing, receipts and the full customer account.','commercial customer billing receivable invoice milestone'],
  'customer-use':['delivery','Inspect saved customer-use calendars and the corresponding original native receipts.','customer use calendar request allowance purchase'],
  'installation-returns':['delivery','Receive returned customer work and review it against the original installation.','return receiving acceptance handover installation'],
  dispatch:['delivery','Open the complete dated delivery queue and its original work references.','queue dispatch overdue task delivery'],
  support:['delivery','Receive the original merchant support source and review the delivery it describes.','merchant support incident request'],
  buyer:['delivery','Receive original native buyer results with their purchase and delivery identities.','buyer native receiving receipt dataset output'],
  'task-outcomes':['review','Compare the complete prior and installed customer methods using retained measurements.','task outcome before after effort time cost comparison'],
  implementation:['review','Review original implementation evidence and retain the full selected sources.','implementation evidence result acceptance'],
  cohort:['review','Review measured cohorts and the original native purchase and output observations.','cohort acceptance measured result customer adoption'],
  completion:['review','Prepare tranche completion from the current original delivery and selected sources.','tranche completion application submission grant form'],
  sources:['review','Find and download the exact documents and source metadata retained in this case.','source document file attachment original sha256'],
  reviews:['review','Open frozen reviews and the original versioned case history.','review history audit event version reopen'],
};

const recordKinds = {
  contributors:{label:'Contributor',section:'contributors',title:['name'],subtitle:['kind','contact']},
  work:{label:'Recorded work',section:'work',title:['description'],subtitle:['startDate','endDate','hours','fundingBasis']},
  invoices:{label:'Supplier invoice',section:'invoices',title:['number'],subtitle:['issuedDate','dueDate','state']},
  cash:{label:'Cash movement',section:'cash',title:['externalRef'],subtitle:['date','direction','amount','currency','category']},
  awards:{label:'Issuer event',section:'cash',title:['reference'],subtitle:['date','stage','amountUsd']},
  deployments:{label:'Deployment',section:'delivery',title:['name'],subtitle:['operator','environment','state']},
  purchases:{label:'Purchase observation',section:'delivery',title:['transactionHash','intentId'],subtitle:['network','attemptStatus','settlementStatus','outputStatus']},
  outcomes:{label:'Delivery outcome',section:'delivery',title:['description'],subtitle:['date','state','tranche']},
};

const summaryKinds = {
  installations:{label:'Saved installation',section:'installations',title:['name','title','id']},
  workIntakes:{label:'Saved work / invoice intake',section:'work-intake',title:['name','filename','title','id']},
  forecasts:{label:'Saved forecast',section:'forecast',title:['name','title','id']},
  portfolios:{label:'Saved portfolio',section:'portfolio',title:['name','title','id']},
  amendments:{label:'Saved plan amendment',section:'amendments',title:['name','title','id']},
  reviews:{label:'Saved review',section:'reviews',title:['note','purpose','id']},
};

const omittedContentKeys = new Set(['contentBase64','bodyBase64','rawBase64','bytesBase64']);
const text = value => value === null || value === undefined ? '' : String(value);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const display = value => text(value).replace(/\s+/g,' ').trim();
export const normalizeSearchText = value => text(value).normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en-US').replace(/\s+/g,' ').trim();

function searchable(value) {
  const values=[],queue=[value],seen=new Set();
  while(queue.length) {
    const current=queue.pop();
    if(current===null||current===undefined)continue;
    if(typeof current!=='object'){values.push(text(current));continue;}
    if(seen.has(current))continue;
    seen.add(current);
    if(Array.isArray(current)) {for(let i=current.length-1;i>=0;i--)queue.push(current[i]);}
    else for(const [key,item] of Object.entries(current)) {
      if(omittedContentKeys.has(key))continue;
      values.push(key);queue.push(item);
    }
  }
  return normalizeSearchText(values.join(' '));
}

export function defineSections(pairs) {
  if(!Array.isArray(pairs))throw new TypeError('Supply the current Operations section list.');
  const seen=new Set();
  return pairs.map(pair=>{
    if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||typeof pair[1]!=='string'||
       !/^[a-z][a-z0-9-]*$/.test(pair[0])||!pair[1].trim()||seen.has(pair[0]))
      throw new TypeError('Every Operations section needs a unique identifier and label.');
    seen.add(pair[0]);
    const detail=sectionDetails[pair[0]]||['other','Open this Operations section.',pair[1]];
    return {id:pair[0],label:pair[1],group:detail[0],description:detail[1],keywords:detail[2]};
  });
}

export function groupedSections(sections) {
  return NAVIGATION_GROUPS.map(group=>({...group,sections:sections.filter(section=>section.group===group.id)}))
    .filter(group=>group.sections.length);
}

export function normalizeNavigationState(value,sections) {
  const raw=plain(value)?value:{},ids=new Set(sections.map(section=>section.id));
  const unique=items=>[...new Set(Array.isArray(items)?items.filter(item=>typeof item==='string'&&ids.has(item)):[])];
  const activeSection=ids.has(raw.activeSection)?raw.activeSection:(ids.has('overview')?'overview':sections[0]?.id||'');
  const groups=new Set(NAVIGATION_GROUPS.map(group=>group.id));
  return {schema:NAVIGATION_SCHEMA,activeSection,
    favorites:unique(raw.favorites),
    recent:unique(raw.recent).slice(0,8),
    collapsedGroups:[...new Set(Array.isArray(raw.collapsedGroups)?raw.collapsedGroups.filter(id=>groups.has(id)):
      NAVIGATION_GROUPS.map(group=>group.id).filter(id=>id!==sections.find(section=>section.id===activeSection)?.group))],
    compactCollapsed:raw.compactCollapsed!==false};
}

export function visitSection(value,sectionId,sections) {
  const result=normalizeNavigationState(value,sections);
  if(!sections.some(section=>section.id===sectionId))return result;
  result.activeSection=sectionId;
  result.recent=[sectionId,...result.recent.filter(id=>id!==sectionId)].slice(0,8);
  const group=sections.find(section=>section.id===sectionId).group;
  result.collapsedGroups=result.collapsedGroups.filter(id=>id!==group);
  return result;
}

export function toggleFavorite(value,sectionId,sections) {
  const result=normalizeNavigationState(value,sections);
  if(!sections.some(section=>section.id===sectionId))return result;
  result.favorites=result.favorites.includes(sectionId)
    ?result.favorites.filter(id=>id!==sectionId):[...result.favorites,sectionId];
  return result;
}

function first(row,keys) {
  for(const key of keys)if(row[key]!==null&&row[key]!==undefined&&display(row[key]))return display(row[key]);
  return display(row.id)||'Original record';
}
function subtitle(row,keys) {
  return keys.map(key=>row[key]===0?'0':display(row[key])).filter(Boolean).join(' · ');
}
function reviewSection(row) {
  const purpose=text(row.purpose);
  if(purpose==='DELIVERY_RISK_REGISTER')return 'risks';
  if(purpose==='TRANCHE_COMPLETION')return 'completion';
  if(purpose==='COHORT_EVALUATION')return 'cohort';
  if(purpose.includes('IMPLEMENTATION'))return 'implementation';
  if(purpose.includes('ENGAGEMENT'))return 'engagements';
  return 'reviews';
}

export const WORKFLOW_INDEX_SCHEMA = 'stellar-forge.sf47-operating-workflows.v1';
const workflowCollections = {
  statements:{section:'statements',kind:'statement-original',fields:['kind','sourceId']},
  reconciliations:{section:'account-reconciliation',kind:'account-reconciliation',fields:['kind','reconciliationId','revision']},
  funding:{section:'funding',kind:'cost-funding',fields:['kind','revision']},
  awardTerms:{section:'award-terms',kind:'award-terms',fields:['kind','id','revision']},
  cohortDelivery:{section:'cohort-delivery',kind:'cohort-delivery',fields:['kind','sourceId']},
  procedures:{section:'procedures',kind:'grant-procedure',fields:['kind','sourceId']},
};

export function validateOperatingWorkflows(value,current) {
  const fail=()=>{throw new TypeError('Reload the complete saved-workflow index for this original case and version.');};
  if(!plain(value)||value.schema!==WORKFLOW_INDEX_SCHEMA||!plain(value.case)||
     value.case.id!==current.program.id||value.case.version!==current.program.version||
     !Array.isArray(value.populations)||!Array.isArray(value.entries))fail();
  const populations=new Map(),keys=new Set(),counts=new Map();
  for(const row of value.populations) {
    const definition=plain(row)&&Object.prototype.hasOwnProperty.call(workflowCollections,row.key)?workflowCollections[row.key]:null;
    if(!definition||row.section!==definition.section||typeof row.label!=='string'||
       !Number.isSafeInteger(row.count)||row.count<0||populations.has(row.key))fail();
    populations.set(row.key,row);counts.set(row.key,0);
  }
  for(const row of value.entries) {
    const definition=plain(row)&&Object.prototype.hasOwnProperty.call(workflowCollections,row.collection)?workflowCollections[row.collection]:null;
    if(!definition||!populations.has(row.collection)||row.section!==definition.section||
       typeof row.key!=='string'||!row.key||keys.has(row.key)||
       typeof row.id!=='string'||!row.id||typeof row.label!=='string'||typeof row.kindLabel!=='string'||
       !(row.revision===null||Number.isSafeInteger(row.revision)&&row.revision>0)||
       !plain(row.summary)||!plain(row.selection)||row.selection.kind!==definition.kind||
       Object.keys(row.selection).length!==definition.fields.length||
       definition.fields.some(key=>!Object.prototype.hasOwnProperty.call(row.selection,key)))fail();
    const selection=row.selection;
    if('revision'in selection&&(!Number.isSafeInteger(selection.revision)||selection.revision<=0||selection.revision!==row.revision))fail();
    for(const key of ['sourceId','reconciliationId','id'])if(key in selection&&
      (typeof selection[key]!=='string'||!selection[key]||selection[key]!==row.id))fail();
    keys.add(row.key);counts.set(row.collection,counts.get(row.collection)+1);
  }
  for(const [key,row]of populations)if(row.count!==counts.get(key))fail();
  return value;
}

export function buildCaseIndex(current,sections,workflows=null) {
  if(!plain(current)||!plain(current.program)||typeof current.program.id!=='string')
    throw new TypeError('Open the complete original Operations case before searching.');
  const sectionMap=new Map(sections.map(section=>[section.id,section]));
  const entries=[],byKey=new Map(),byId=new Map();
  function add(entry) {
    if(byKey.has(entry.key)||!sectionMap.has(entry.section))return;
    entry.sectionLabel=sectionMap.get(entry.section)?.label||entry.section;
    entry.label=display(entry.label);
    entry.subtitle=display(entry.subtitle);
    entry.searchText=normalizeSearchText(entry.label+' '+entry.subtitle+' '+entry.kindLabel+' '+entry.sectionLabel+' '+(entry.keywords||''))+' '+searchable(entry.data);
    entry.titleText=normalizeSearchText(entry.label);
    entries.push(entry);byKey.set(entry.key,entry);
    if(entry.id&&!byId.has(entry.id))byId.set(entry.id,entry);
  }
  for(const section of sections)add({key:'section:'+section.id,id:section.id,type:'section',kindLabel:'Section',
    collection:'sections',section:section.id,label:section.label,subtitle:section.description,
    keywords:section.keywords,data:{section:section.id}});
  const contributors=new Map((Array.isArray(current.records?.contributors)?current.records.contributors:[]).map(row=>[row.id,row]));
  for(const [kind,definition] of Object.entries(recordKinds)) {
    const records=Array.isArray(current.records?.[kind])?current.records[kind]:[];
    for(const row of records) {
      if(!plain(row)||typeof row.id!=='string')continue;
      const contributor=kind==='work'||kind==='invoices'
        ?contributors.get(row.contributorId):null;
      const identity=kind==='work'&&contributor?contributor.name+' · ':'';
      add({key:'record:'+kind+':'+row.id,id:row.id,type:'record',collection:kind,kindLabel:definition.label,
        section:definition.section,label:identity+first(row,definition.title),
        subtitle:subtitle(row,definition.subtitle),keywords:contributor?[contributor.name,contributor.contact].filter(Boolean).join(' '):'',data:row});
    }
  }
  for(const row of Array.isArray(current.sources)?current.sources:[]) {
    if(!plain(row)||typeof row.id!=='string')continue;
    add({key:'source:'+row.id,id:row.id,type:'source',collection:'sources',kindLabel:'Retained source',
      section:'sources',label:first(row,['filename']),subtitle:subtitle(row,['kind','observedAt','mediaType']),data:row});
  }
  for(const [collection,definition] of Object.entries(summaryKinds)) {
    for(const row of Array.isArray(current[collection])?current[collection]:[]) {
      if(!plain(row)||typeof row.id!=='string')continue;
      add({key:'saved:'+collection+':'+row.id,id:row.id,type:'saved',collection,kindLabel:definition.label,
        section:collection==='reviews'?reviewSection(row):definition.section,
        label:first(row,definition.title),subtitle:subtitle(row,['state','status','revision','version','createdAt','updatedAt']),data:row});
    }
  }
  const workflowPopulations=[];
  if(workflows!==null) {
    validateOperatingWorkflows(workflows,current);
    for(const row of workflows.entries) {
      add({key:'workflow:'+row.key,id:row.id,type:'saved',collection:row.collection,
        kindLabel:row.kindLabel,section:row.section,label:row.label,
        subtitle:subtitle(row.summary,['state','status','stage','revision','version','savedAt','createdAt','recordedAt','observedAt']),
        data:row.summary,workflowSelection:row.selection,workflowRevision:row.revision});
    }
    workflowPopulations.push(...workflows.populations.filter(row=>sectionMap.has(row.section)));
  }
  const counts=entries.reduce((result,entry)=>(result[entry.type]=(result[entry.type]||0)+1,result),{section:0,record:0,source:0,saved:0});
  return {schema:NAVIGATION_SCHEMA,caseId:current.program.id,version:current.program.version,caseName:current.program.name,
    entries,byKey,byId,counts,workflowPopulations,
    coverage:'Available sections, their native case records, retained source metadata and saved installation, intake, forecast, portfolio, amendment and review summaries. Attached file contents are available through their original downloads.' + (workflows!==null?' Additional complete saved populations: '+(workflowPopulations.map(row=>row.label+' ('+row.count+')').join(', ')||'none available to this profile')+'.':'')};
}

export function searchCaseIndex(index,{query='',kind='all',section='',page=0,pageSize=25}={}) {
  const normalized=normalizeSearchText(text(query).slice(0,200));
  const terms=normalized?normalized.split(' '):[];
  const types=new Set(['all','section','record','source','saved']);
  const selectedKind=types.has(kind)?kind:'all';
  const matches=[];
  for(const [position,entry] of index.entries.entries()) {
    if(section&&entry.section!==section)continue;
    if(terms.some(term=>!entry.searchText.includes(term)))continue;
    let score=0;
    if(normalized) {
      if(entry.titleText===normalized)score+=100;
      else if(entry.titleText.startsWith(normalized))score+=50;
      if(normalizeSearchText(entry.id)===normalized)score+=150;
      for(const term of terms)if(entry.titleText.includes(term))score+=10;
    }
    if(entry.type==='section')score+=2;
    matches.push({entry,score,position});
  }
  const facets=matches.reduce((result,{entry})=>(result[entry.type]=(result[entry.type]||0)+1,result),{section:0,record:0,source:0,saved:0});
  const selected=matches.filter(({entry})=>selectedKind==='all'||entry.type===selectedKind)
    .sort((a,b)=>b.score-a.score||a.position-b.position);
  const size=Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=100?pageSize:25;
  const pages=Math.max(1,Math.ceil(selected.length/size));
  const currentPage=Math.min(Math.max(0,Number.isInteger(page)?page:0),pages-1);
  return {caseId:index.caseId,version:index.version,query:normalized,kind:selectedKind,section,
    total:selected.length,matched:matches.length,indexed:index.entries.length,facets,page:currentPage,pages,pageSize:size,
    from:selected.length?currentPage*size+1:0,to:Math.min((currentPage+1)*size,selected.length),
    entries:selected.slice(currentPage*size,(currentPage+1)*size).map(({entry})=>entry)};
}

export function resolveEntry(index,key) {
  return typeof key==='string'?index.byKey.get(key)||null:null;
}
