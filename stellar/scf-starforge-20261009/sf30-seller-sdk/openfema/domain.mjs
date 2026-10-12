// MIT. Exact-value Public Assistance portfolio calculations; source records remain attached.
export const PORTFOLIO_SCHEMA='stellar-forge.openfema-portfolio.v1';
export const REVIEW_STATES=['open','reviewed','follow_up','resolved'];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const copy=x=>JSON.parse(JSON.stringify(x));
const text=(v)=>v===null||v===undefined?'':String(v);
export function stable(value){
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function fault(code,message,status=400){return Object.assign(new Error(message),{code,status});}
export function string(value,label,max=4000,{empty=false}={}){
  if(typeof value!=='string'||(!empty&&!value.trim())||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw fault('OPENFEMA_INPUT','Invalid '+label+'.');
  return value.trim();
}
export function identifier(value,label='identifier'){
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value))throw fault('OPENFEMA_ID','Choose a valid '+label+'.');return value;
}
export function decimalMinor(value,{scale=2}={}){
  if(value===null||value===undefined||value==='')return null;
  if(!Number.isSafeInteger(scale)||scale<0||scale>12)throw fault('OPENFEMA_AMOUNT_SCALE','Invalid exact amount scale.');
  const raw=typeof value==='number'?String(value):value;
  if(typeof raw!=='string'||raw.length>200)throw fault('OPENFEMA_AMOUNT','Amount must retain its original numeric text.');
  const m=/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(raw);
  if(!m)throw fault('OPENFEMA_AMOUNT','The original amount is not a decimal number: '+raw.slice(0,80));
  const exp=Number(m[4]??0);if(!Number.isSafeInteger(exp)||Math.abs(exp)>100)throw fault('OPENFEMA_AMOUNT','Amount exponent is outside the supported exact range.');
  let digits=(m[2]+(m[3]??'')).replace(/^0+/,'')||'0',shift=scale+exp-(m[3]?.length??0);
  if(shift<0){const remove=-shift;if(remove>digits.length){if(digits!=='0')throw fault('OPENFEMA_AMOUNT_PRECISION','This source amount has a fraction below one cent.');digits='0';}
    else{if(/[1-9]/.test(digits.slice(digits.length-remove)))throw fault('OPENFEMA_AMOUNT_PRECISION','This source amount has a fraction below one cent.');digits=digits.slice(0,digits.length-remove)||'0';}}
  else digits+='0'.repeat(shift);
  if(digits.length>60)throw fault('OPENFEMA_AMOUNT','Amount exceeds the exact portfolio range.');
  return ((m[1]==='-'?-1n:1n)*BigInt(digits)).toString();
}
export function formatMinor(value,{scale=2}={}){
  if(value===null||value===undefined)return '';
  let n=BigInt(value),sign=n<0n?'-':'';if(n<0n)n=-n;
  const s=n.toString().padStart(scale+1,'0');return sign+(scale?s.slice(0,-scale)+'.'+s.slice(-scale):s);
}
const totalMinor=values=>values.reduce((n,x)=>x===null?n:n+BigInt(x),0n).toString();
const compareValue=(a,b)=>a===b?0:a===null||a===undefined?1:b===null||b===undefined?-1:a<b?-1:1;
const splitList=(value,label,pattern,max=5000)=>{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'||!pattern.test(v)))throw fault('OPENFEMA_SELECTION','Invalid '+label+'.');
  return [...new Set(value)].sort();
};
export function validatePortfolio(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fault('OPENFEMA_PORTFOLIO','Provide portfolio criteria.');
  const permitted=['name','states','disasters','applicants','categories','counties','declarationFrom','declarationTo','minimumFederal','maximumFederal','includeUnjoined','note'];
  if(Object.keys(input).some(k=>!permitted.includes(k)))throw fault('OPENFEMA_PORTFOLIO','Unknown portfolio criterion.');
  const p={
    name:string(input.name,'portfolio name',160),
    states:splitList(input.states,'state codes',/^[A-Z]{2}$/,60),
    disasters:splitList(input.disasters,'disaster numbers',/^[1-9][0-9]{0,7}$/),
    applicants:splitList(input.applicants,'applicant IDs',/^[^\x00-\x1f]{1,120}$/),
    categories:splitList(input.categories,'work categories',/^[A-Za-z0-9 -]{1,30}$/,50),
    counties:splitList(input.counties,'original county names',/^[^\x00-\x1f]{1,200}$/,5000),
    declarationFrom:input.declarationFrom??'',declarationTo:input.declarationTo??'',
    minimumFederal:input.minimumFederal??'',maximumFederal:input.maximumFederal??'',
    includeUnjoined:input.includeUnjoined??true,note:input.note??''
  };
  for(const k of ['declarationFrom','declarationTo'])if(p[k]&&!/^\d{4}-\d{2}-\d{2}$/.test(p[k]))throw fault('OPENFEMA_DATE','Use ISO calendar dates.');
  if(p.declarationFrom&&p.declarationTo&&p.declarationFrom>p.declarationTo)throw fault('OPENFEMA_DATE','Portfolio date range is reversed.');
  if(typeof p.includeUnjoined!=='boolean')throw fault('OPENFEMA_PORTFOLIO','includeUnjoined must be a boolean.');
  for(const k of ['minimumFederal','maximumFederal'])if(p[k]!==''){if(typeof p[k]!=='string')throw fault('OPENFEMA_AMOUNT','Enter an exact decimal dollar amount.');decimalMinor(p[k]);}
  if(p.minimumFederal!==''&&p.maximumFederal!==''&&BigInt(decimalMinor(p.minimumFederal))>BigInt(decimalMinor(p.maximumFederal)))throw fault('OPENFEMA_AMOUNT','Portfolio amount range is reversed.');
  p.note=string(p.note,'portfolio note',12000,{empty:true});return p;
}
export const FIELD_MAP={
  declarations:{key:['disasterNumber','placeCode'],id:'id',disaster:'disasterNumber',state:'state',title:'declarationTitle',type:'declarationType',incident:'incidentType',date:'declarationDate',begin:'incidentBeginDate',end:'incidentEndDate',area:'designatedArea',fipsState:'fipsStateCode',fipsCounty:'fipsCountyCode',place:'placeCode',pa:'paProgramDeclared',ia:'iaProgramDeclared',hm:'hmProgramDeclared',close:'disasterCloseoutDate'},
  applicants:{key:['disasterNumber','applicantId'],id:'id',disaster:'disasterNumber',applicant:'applicantId',name:'applicantName',state:'state',address1:'addressLine1',address2:'addressLine2',city:'city',zip:'zipCode'},
  projects:{key:['gmProjectId'],id:'gmProjectId',disaster:'disasterNumber',applicant:'applicantId',state:'stateAbbreviation',county:'county',number:'pwNumber',title:'applicationTitle',category:'damageCategoryCode',categoryDescription:'damageCategoryDescrip',size:'projectSize',cost:'projectAmount',federal:'federalShareObligated',total:'totalObligated',mitigation:'mitigationAmount',funded:'lastObligationDate',firstFunded:'firstObligationDate',status:'projectStatus',process:'projectProcessStep',declaration:'declarationDate',incident:'incidentType'}
};
export function fieldValue(record,name){return own(record,name)?{state:record[name]===null?'null':'value',value:record[name]}:{state:'missing',value:null};}
function scalar(record,name){if(!name)return '';const v=record[name];if(v===null||v===undefined)return '';if(typeof v==='object')throw fault('OPENFEMA_FIELD','Expected scalar field '+name+'.');return String(v);}
function reference(item){return {sourcePageSha256:item.sourcePageSha256,sourceRow:item.sourceRow,sourceUrl:item.sourceUrl??null};}
function sourceItem(item,kind,index){
  if(!item||!item.record||typeof item.record!=='object'||Array.isArray(item.record)||typeof item.sourcePageSha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sourcePageSha256)||!Number.isSafeInteger(item.sourceRow)||item.sourceRow<0)
    throw fault('OPENFEMA_SOURCE_RECORD','A '+kind+' record has no original page and row.');
  return {...item,_index:index};
}
const composite=(disaster,applicant)=>JSON.stringify([disaster,applicant]);
const rowIdentity=(record,map,ref)=>{
  const values=(map.key||[map.id]).map(k=>scalar(record,k));
  if(values.some(v=>v===''))return 'unkeyed:'+ref.sourcePageSha256+':'+ref.sourceRow;
  return values.length===1?values[0]:JSON.stringify(values);
};
function issue(list,code,subject,message,details={}){
  list.push({id:code+':'+subject,code,subject,message,...details});
}
function exactAmount(record,field,issues,subject){
  const v=fieldValue(record,field);
  if(v.state!=='value'||v.value==='')return {field,state:v.state,raw:v.value,minor:null,decimal:null};
  try{const minor=decimalMinor(v.value);return {field,state:'value',raw:v.value,minor,decimal:formatMinor(minor)};}
  catch(error){issue(issues,'AMOUNT_REVIEW',subject,error.message,{field,original:v});return {field,state:'invalid',raw:v.value,minor:null,decimal:null};}
}
function deduplicate(items,kind,map,issues){
  const groups=new Map();
  for(const [i,input]of items.entries()){
    const item=sourceItem(input,kind,i),key=rowIdentity(item.record,map,reference(item));
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
  }
  const unique=[];
  for(const [key,values]of groups){
    if(values.length>1){
      const distinct=new Set(values.map(v=>stable(v.record))).size;
      issue(issues,distinct===1?'DUPLICATE_SOURCE_ROW':'CONFLICTING_SOURCE_ID',kind+':'+key,
        distinct===1?'The same original source ID appeared more than once; it contributes once.':'One original source ID has conflicting records; resolve the source edition before interpreting its amount.',{count:values.length,sourceRows:values.map(reference)});
      if(distinct>1){unique.push({...values[0],conflict:true,alternatives:values.map(v=>({record:v.record,...reference(v)}))});continue;}
    }
    unique.push({...values[0],conflict:false});
  }
  return unique;
}
export function analyzePortfolio({edition,tables,spec,annotations=[],fieldMap=FIELD_MAP}){
  const criteria=validatePortfolio(spec),issues=[],required=['declarations','applicants','projects'];
  for(const kind of required)if(!Array.isArray(tables[kind]))throw fault('OPENFEMA_TABLE','Supply the complete retained '+kind+' table.');
  const unique=Object.fromEntries(required.map(k=>[k,deduplicate(tables[k],k,fieldMap[k],issues)]));
  const declarations=[],declarationsByDisaster=new Map();
  for(const item of unique.declarations){
    const r=item.record,m=fieldMap.declarations,ref=reference(item),id=rowIdentity(r,m,ref);
    const row={id,subject:'declaration:'+id,disasterNumber:scalar(r,m.disaster),state:scalar(r,m.state),title:scalar(r,m.title),declarationType:scalar(r,m.type),incidentType:scalar(r,m.incident),declarationDate:scalar(r,m.date),incidentBeginDate:scalar(r,m.begin),incidentEndDate:scalar(r,m.end),designatedArea:scalar(r,m.area),fipsStateCode:scalar(r,m.fipsState),fipsCountyCode:scalar(r,m.fipsCounty),placeCode:scalar(r,m.place),publicAssistance:fieldValue(r,m.pa),individualAssistance:fieldValue(r,m.ia),hazardMitigation:fieldValue(r,m.hm),closeoutDate:scalar(r,m.close),conflict:item.conflict,original:r,...ref};
    declarations.push(row);if(!declarationsByDisaster.has(row.disasterNumber))declarationsByDisaster.set(row.disasterNumber,[]);declarationsByDisaster.get(row.disasterNumber).push(row);
  }
  const applicantSources=new Map();
  for(const item of unique.applicants){const m=fieldMap.applicants,r=item.record,key=composite(scalar(r,m.disaster),scalar(r,m.applicant));if(!applicantSources.has(key))applicantSources.set(key,[]);applicantSources.get(key).push(item);}
  const selectedProjects=[],allProjects=[],min=criteria.minimumFederal===''?null:BigInt(decimalMinor(criteria.minimumFederal)),max=criteria.maximumFederal===''?null:BigInt(decimalMinor(criteria.maximumFederal));
  const annotationBySubject=new Map(annotations.map(a=>[a.subject,a]));
  for(const item of unique.projects){
    const r=item.record,m=fieldMap.projects,ref=reference(item),id=rowIdentity(r,m,ref),subject='project:'+id,disaster=scalar(r,m.disaster),applicant=scalar(r,m.applicant),key=composite(disaster,applicant),joined=applicantSources.get(key)||[],areas=declarationsByDisaster.get(disaster)||[];
    const names=[...new Set(joined.map(a=>scalar(a.record,fieldMap.applicants.name)).filter(Boolean))];
    const applicantMatch=joined.length===1&&!joined[0].conflict?'matched':joined.length===0?'missing':'ambiguous';
    const ownName=scalar(r,m.name),name=ownName||names[0]||'';
    const state=scalar(r,m.state),county=scalar(r,m.county),category=scalar(r,m.category),date=scalar(r,m.declaration)||areas[0]?.declarationDate||'';
    const cost=exactAmount(r,m.cost,issues,subject),federal=exactAmount(r,m.federal,issues,subject),total=exactAmount(r,m.total,issues,subject),mitigation=exactAmount(r,m.mitigation,issues,subject);
    if(applicantMatch!=='matched')issue(issues,'APPLICANT_'+applicantMatch.toUpperCase(),subject,applicantMatch==='missing'?'The project’s applicant is absent from the retained applicant scope.':'More than one applicant source record matches this project’s disaster and applicant ID.',{disasterNumber:disaster,applicantId:applicant,candidates:joined.map(a=>({id:rowIdentity(a.record,fieldMap.applicants,reference(a)),...reference(a)}))});
    if(!areas.length)issue(issues,'DECLARATION_MISSING',subject,'The project has no declaration-area record in this retained edition.',{disasterNumber:disaster});
    if(ownName&&names.length===1&&ownName!==names[0])issue(issues,'APPLICANT_NAME_DIFFERENCE',subject,'The project and applicant source use different applicant names.',{projectName:ownName,applicantName:names[0]});
    const annotation=annotationBySubject.get(subject)||null;
    const matches=(!criteria.states.length||criteria.states.includes(state))&&(!criteria.disasters.length||criteria.disasters.includes(disaster))&&(!criteria.applicants.length||criteria.applicants.includes(applicant))&&(!criteria.categories.length||criteria.categories.includes(category))&&(!criteria.counties.length||criteria.counties.includes(county))&&(!criteria.declarationFrom||date.slice(0,10)>=criteria.declarationFrom)&&(!criteria.declarationTo||date.slice(0,10)<=criteria.declarationTo)&&(min===null||federal.minor!==null&&BigInt(federal.minor)>=min)&&(max===null||federal.minor!==null&&BigInt(federal.minor)<=max)&&(criteria.includeUnjoined||applicantMatch==='matched');
    const excluded=annotation?.disposition==='exclude';
    const row={id,subject,key:composite(disaster,applicant),disasterNumber:disaster,applicantId:applicant,applicantName:name,applicantMatch,applicantSourceIds:joined.map(a=>rowIdentity(a.record,fieldMap.applicants,reference(a))),state,county,projectNumber:scalar(r,m.number),projectTitle:scalar(r,m.title),workCategory:category,projectSize:scalar(r,m.size),projectStatus:scalar(r,m.status),processStep:scalar(r,m.process),categoryDescription:scalar(r,m.categoryDescription),firstObligationDate:scalar(r,m.firstFunded),fundedDate:scalar(r,m.funded),declarationDate:date,incidentType:scalar(r,m.incident)||areas[0]?.incidentType||'',declarationAreaIds:areas.map(a=>a.id),projectCost:cost,federalObligated:federal,totalObligated:total,mitigation:mitigation,conflict:item.conflict,alternatives:item.alternatives||[],annotation:annotation?copy(annotation):null,inScope:matches,included:matches&&!excluded&&!item.conflict,original:r,...ref};
    allProjects.push(row);if(row.inScope)selectedProjects.push(row);
  }
  const included=selectedProjects.filter(r=>r.included),selectedApplicantKeys=new Set(selectedProjects.map(r=>r.key)),selectedDisasters=new Set(selectedProjects.map(r=>r.disasterNumber));
  const projectGroups=new Map(),disasterGroups=new Map();
  for(const p of selectedProjects){if(!projectGroups.has(p.key))projectGroups.set(p.key,[]);projectGroups.get(p.key).push(p);if(!disasterGroups.has(p.disasterNumber))disasterGroups.set(p.disasterNumber,[]);disasterGroups.get(p.disasterNumber).push(p);}
  const applicants=[];
  for(const key of selectedApplicantKeys){
    const projects=projectGroups.get(key),sources=applicantSources.get(key)||[],first=projects[0],rows=projects.filter(p=>p.included),m=fieldMap.applicants,applicant=sources.length===1?sources[0]:null;
    applicants.push({key,subject:'applicant:'+key,disasterNumber:first.disasterNumber,applicantId:first.applicantId,name:applicant?scalar(applicant.record,m.name):first.applicantName,addressLine1:applicant?scalar(applicant.record,m.address1):'',addressLine2:applicant?scalar(applicant.record,m.address2):'',city:applicant?scalar(applicant.record,m.city):'',zipCode:applicant?scalar(applicant.record,m.zip):'',state:applicant?scalar(applicant.record,m.state):first.state,county:first.county,joinState:sources.length===1&&!sources[0].conflict?'matched':sources.length?'ambiguous':'missing',projects:projects.length,includedProjects:rows.length,projectCostMinor:totalMinor(rows.map(p=>p.projectCost.minor)),federalObligatedMinor:totalMinor(rows.map(p=>p.federalObligated.minor)),totalObligatedMinor:totalMinor(rows.map(p=>p.totalObligated.minor)),mitigationMinor:totalMinor(rows.map(p=>p.mitigation.minor)),sources:sources.map(a=>({id:rowIdentity(a.record,m,reference(a)),original:a.record,...reference(a)})),annotation:annotationBySubject.get('applicant:'+key)||null});
  }
  const disasters=[];
  for(const n of selectedDisasters){
    const areas=declarationsByDisaster.get(n)||[],projects=disasterGroups.get(n),rows=projects.filter(p=>p.included);
    disasters.push({disasterNumber:n,subject:'disaster:'+n,title:areas[0]?.title||'',state:areas[0]?.state||projects[0]?.state||'',incidentType:areas[0]?.incidentType||projects[0]?.incidentType||'',declarationDate:areas[0]?.declarationDate||projects[0]?.declarationDate||'',designatedAreas:areas.length,applicants:new Set(projects.map(p=>p.key)).size,projects:projects.length,includedProjects:rows.length,projectCostMinor:totalMinor(rows.map(p=>p.projectCost.minor)),federalObligatedMinor:totalMinor(rows.map(p=>p.federalObligated.minor)),totalObligatedMinor:totalMinor(rows.map(p=>p.totalObligated.minor)),mitigationMinor:totalMinor(rows.map(p=>p.mitigation.minor)),annotation:annotationBySubject.get('disaster:'+n)||null});
  }
  const categories=[];
  for(const key of [...new Set(included.map(p=>p.workCategory))].sort()){
    const rows=included.filter(p=>p.workCategory===key);categories.push({category:key||'(missing)',projects:rows.length,applicants:new Set(rows.map(p=>p.key)).size,projectCostMinor:totalMinor(rows.map(p=>p.projectCost.minor)),federalObligatedMinor:totalMinor(rows.map(p=>p.federalObligated.minor)),totalObligatedMinor:totalMinor(rows.map(p=>p.totalObligated.minor))});
  }
  const subjects=new Set(selectedProjects.map(p=>p.subject)),selectedIssues=issues.filter(i=>subjects.has(i.subject)||!i.subject.startsWith('project:'));
  for(const i of selectedIssues)i.review=annotationBySubject.get(i.subject)||null;
  return {schema:PORTFOLIO_SCHEMA,editionId:edition.id,sourceSha256:edition.sourceSha256,sourceScope:copy(edition.scope),sourceCompletedAt:edition.completedAt??null,criteria,fieldMap:copy(fieldMap),summary:{sourceProjects:tables.projects.length,uniqueSourceProjects:allProjects.length,selectedProjects:selectedProjects.length,includedProjects:included.length,excludedProjects:selectedProjects.filter(p=>p.annotation?.disposition==='exclude').length,conflictingProjects:selectedProjects.filter(p=>p.conflict).length,applicants:applicants.length,disasters:disasters.length,declarationAreas:declarations.filter(d=>selectedDisasters.has(d.disasterNumber)).length,projectCostMinor:totalMinor(included.map(p=>p.projectCost.minor)),federalObligatedMinor:totalMinor(included.map(p=>p.federalObligated.minor)),totalObligatedMinor:totalMinor(included.map(p=>p.totalObligated.minor)),mitigationMinor:totalMinor(included.map(p=>p.mitigation.minor)),missingProjectCosts:included.filter(p=>p.projectCost.minor===null).length,missingFederalAmounts:included.filter(p=>p.federalObligated.minor===null).length,missingTotalAmounts:included.filter(p=>p.totalObligated.minor===null).length,missingMitigationAmounts:included.filter(p=>p.mitigation.minor===null).length,openIssues:selectedIssues.filter(i=>!['reviewed','resolved'].includes(i.review?.status)).length,currency:'USD'},
    projects:selectedProjects,applicants,disasters,declarations:declarations.filter(d=>selectedDisasters.has(d.disasterNumber)),categories,issues:selectedIssues,annotations:copy(annotations),
    methodology:{join:'Applicant ID within the same disaster. A project contributes once, regardless of the number of designated declaration areas.',amounts:'Project cost, federal obligations, total obligations including administrative costs, and mitigation amounts are separate measures, each summed in exact integer USD cents. The measures are not added together. Missing, invalid and conflicting source values are counted explicitly. Negative adjustments remain negative.',scope:'The saved portfolio filters this retained source edition. Source filters, dataset refresh observations and completion records travel with the original capture.',source:'FEMA Public Assistance Funded Projects Details contains obligated projects. Pre-obligation projects are outside that dataset; source financial amounts represent obligations to grantees.'}};
}
export function validateAnnotation(input){
  const subject=string(input.subject,'review subject',300),note=string(input.note??'','review note',12000,{empty:true}),status=input.status??'open',disposition=input.disposition??'include',priority=input.priority??'normal';
  if(!REVIEW_STATES.includes(status)||!['include','exclude'].includes(disposition)||!['low','normal','high'].includes(priority))throw fault('OPENFEMA_REVIEW','Choose a supported review state, disposition and priority.');
  if((status!=='open'||disposition==='exclude')&&!note.trim())throw fault('OPENFEMA_REVIEW_NOTE','Explain this review decision.');
  return {subject,note,status,disposition,priority,owner:string(input.owner??'','review owner',200,{empty:true}),dueDate:input.dueDate?string(input.dueDate,'review due date',10):''};
}
export function comparePortfolios(before,after){
  if(before.schema!==PORTFOLIO_SCHEMA||after.schema!==PORTFOLIO_SCHEMA)throw fault('OPENFEMA_COMPARE','Select two complete portfolio versions.');
  const selection=({name,note,...rest})=>rest,sourceSelection=({pageSize,...rest})=>rest;
  const scopeSame=stable(selection(before.criteria))===stable(selection(after.criteria))&&stable(sourceSelection(before.sourceScope))===stable(sourceSelection(after.sourceScope));
  const a=new Map(before.projects.map(p=>[p.id,p])),b=new Map(after.projects.map(p=>[p.id,p]));
  const added=[],removed=[],changed=[];
  for(const [id,p]of a){const next=b.get(id);if(!next){removed.push(p);continue;}
    const fields=[...new Set([...Object.keys(p.original),...Object.keys(next.original)])].filter(k=>!['hash','lastRefresh'].includes(k)).filter(k=>stable(fieldValue(p.original,k))!==stable(fieldValue(next.original,k))).map(field=>({field,before:fieldValue(p.original,field),after:fieldValue(next.original,field)}));
    const operationalChanges=['included','applicantMatch','applicantName'].filter(k=>stable(p[k])!==stable(next[k])).map(field=>({field,before:p[field],after:next[field]}));
    if(fields.length||operationalChanges.length)changed.push({id,disasterNumber:next.disasterNumber,applicantId:next.applicantId,projectNumber:next.projectNumber,fields,operationalChanges,before:reference(p),after:reference(next),federalDeltaMinor:p.federalObligated.minor===null||next.federalObligated.minor===null?null:(BigInt(next.federalObligated.minor)-BigInt(p.federalObligated.minor)).toString()});
  }
  for(const [id,p]of b)if(!a.has(id))added.push(p);
  return {schema:'stellar-forge.openfema-comparison.v1',beforeEditionId:before.editionId,afterEditionId:after.editionId,sameScope:scopeSame,scopeMeaning:scopeSame?'Changes within the same saved source and portfolio selection.':'Source or portfolio selection changed; additions and absences also reflect the different selection.',beforeCriteria:before.criteria,afterCriteria:after.criteria,added,removed,changed,summary:{added:added.length,removed:removed.length,changed:changed.length,beforeIncluded:before.summary.includedProjects,afterIncluded:after.summary.includedProjects,federalDeltaMinor:(BigInt(after.summary.federalObligatedMinor)-BigInt(before.summary.federalObligatedMinor)).toString(),projectCostDeltaMinor:(BigInt(after.summary.projectCostMinor)-BigInt(before.summary.projectCostMinor)).toString(),totalObligatedDeltaMinor:(BigInt(after.summary.totalObligatedMinor)-BigInt(before.summary.totalObligatedMinor)).toString()}};
}
export const TABLE_COLUMNS={
  projects:['id','disasterNumber','applicantId','applicantName','state','county','projectNumber','projectTitle','workCategory','projectSize','projectStatus','processStep','declarationDate','firstObligationDate','fundedDate','projectCost','federalObligated','totalObligated','mitigation','applicantMatch','included','reviewStatus','priority','sourcePageSha256','sourceRow'],
  applicants:['disasterNumber','applicantId','name','addressLine1','addressLine2','city','zipCode','state','county','joinState','projects','includedProjects','projectCost','federalObligated','totalObligated','mitigation'],
  disasters:['disasterNumber','title','state','incidentType','declarationDate','designatedAreas','applicants','projects','includedProjects','projectCost','federalObligated','totalObligated','mitigation'],
  declarations:['id','disasterNumber','state','title','declarationType','incidentType','declarationDate','incidentBeginDate','incidentEndDate','designatedArea','fipsStateCode','fipsCountyCode','placeCode','publicAssistance','individualAssistance','hazardMitigation','closeoutDate','sourcePageSha256','sourceRow'],
  categories:['category','projects','applicants','projectCost','federalObligated','totalObligated','mitigation'],
  issues:['code','subject','message','reviewStatus']
};
export function displayRow(row){
  const o={...row};
  for(const field of ['projectCost','federalObligated','totalObligated','mitigation']){
    if(own(row,field+'Minor'))o[field]=formatMinor(row[field+'Minor']);
    else if(row[field]&&typeof row[field]==='object')o[field]=row[field].decimal??'';
  }
  for(const field of ['publicAssistance','individualAssistance','hazardMitigation'])if(row[field]&&typeof row[field]==='object')o[field]=row[field].state==='value'?String(row[field].value):row[field].state;
  o.reviewStatus=row.annotation?.status??row.review?.status??'open';o.priority=row.annotation?.priority??'normal';
  return o;
}
export function tableView(portfolio,{table='projects',search='',sort='',direction='asc',offset=0,limit=100}={}){
  if(!own(TABLE_COLUMNS,table))throw fault('OPENFEMA_TABLE','Select a portfolio table.');
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw fault('OPENFEMA_PAGE','Choose a valid portfolio page.');
  if(typeof search!=='string'||search.length>500||!['asc','desc'].includes(direction)||sort&&!TABLE_COLUMNS[table].includes(sort))throw fault('OPENFEMA_QUERY','Choose a valid search and table ordering.');
  let rows=portfolio[table].map(displayRow),term=search.trim().toLowerCase();
  if(term)rows=rows.filter(row=>TABLE_COLUMNS[table].some(k=>text(row[k]).toLowerCase().includes(term)));
  if(sort)rows=rows.map((row,index)=>({row,index})).sort((a,b)=>{
    let av=a.row[sort],bv=b.row[sort],c;
    if(['projectCost','federalObligated','totalObligated','mitigation'].includes(sort)){av=av===''?null:BigInt(decimalMinor(av));bv=bv===''?null:BigInt(decimalMinor(bv));}
    c=compareValue(av,bv);return (direction==='desc'?-c:c)||a.index-b.index;
  }).map(x=>x.row);
  return {table,columns:TABLE_COLUMNS[table],total:rows.length,offset,limit,rows:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null};
}
export function csv(columns,rows,{spreadsheet=false}={}){
  const cell=v=>{let s=v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);if(spreadsheet&&/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
  return columns.map(cell).join(',')+'\r\n'+rows.map(r=>columns.map(k=>cell(r[k])).join(',')).join('\r\n')+(rows.length?'\r\n':'');
}
export function datasetProjection(portfolio,table='projects'){
  if(!own(TABLE_COLUMNS,table))throw fault('OPENFEMA_DATASET','Select a portfolio table.');
  const rows=portfolio[table].map(displayRow).map(r=>Object.fromEntries(TABLE_COLUMNS[table].map(k=>[k,r[k]===undefined?'':r[k]])));
  const columns=TABLE_COLUMNS[table],numeric=new Set(['projects','includedProjects','applicants','designatedAreas','sourceRow']);
  const declaration=Object.fromEntries(columns.map(k=>[k,numeric.has(k)?'integer':k==='included'?'boolean':'string']));
  const filters=['disasterNumber','applicantId','state','county','workCategory','applicantMatch','reviewStatus','included','category','code'].filter(k=>columns.includes(k)).slice(0,8);
  const ranges=['declarationDate','fundedDate'].filter(k=>columns.includes(k)).slice(0,2);
  const sorts=['disasterNumber','applicantId','state','county','workCategory','declarationDate'].filter(k=>columns.includes(k)).slice(0,8);
  return {columns,rows,declaration,filters,ranges,sorts,csv:csv(columns,rows),meaning:{amounts:'Exact USD decimal strings. Amount columns preserve decimal precision and are not advertised with lexical numerical sorting.',source:'Retained official OpenFEMA rows and the saved portfolio edition remain in the complete source package.',review:'Included indicates portfolio treatment; original source rows and review decisions are retained together.'}};
}
