// MIT. Shared project rules and exact decimal planning arithmetic.
import {RESPONSE_CODES,REQUIREMENT_PHASES,DELIVERY_STATES,INTERFACE_OPTIONS,RESOURCE_TYPES} from './profile.mjs';
export const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const SHA = /^[a-f0-9]{64}$/;
export const SECTIONS = ['requirements','interfaces','phases','staffing','software','services','other','milestones','priceSummary'];
export function requireValue(condition,message) {if(!condition)throw new Error(message);}
export function text(value='',maximum=8000) {
  requireValue(typeof value==='string'&&value.length<=maximum&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),'Use plain text within the field limit.');return value.trim();
}
const choice=(value,choices,label)=>{value=text(value,160);requireValue(choices.includes(value),'Choose a listed '+label+'.');return value;};
const ids=value=>{requireValue(Array.isArray(value)&&value.length<=1000,'Choose at most 1,000 records.');return [...new Set(value.map(x=>{requireValue(typeof x==='string'&&ID.test(x),'Invalid record ID.');return x;}))];};
export function decimalUnits(value,scale=2) {
  value=text(value,40);if(value==='')return null;
  const match=/^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  requireValue(match&&(!match[2]||match[2].length<=scale),'Use a nonnegative decimal with at most '+scale+' decimal places.');
  return BigInt(match[1])*10n**BigInt(scale)+BigInt((match[2]??'').padEnd(scale,'0'));
}
export function formatUnits(units,scale=2) {const s=units.toString().padStart(scale+1,'0');return s.slice(0,-scale)+'.'+s.slice(-scale);}
const amount=(v='')=>{v=text(v,40);decimalUnits(v);return v;};
export function normalizeRecord(section,input,catalog) {
  requireValue(input&&typeof input==='object'&&!Array.isArray(input),'A record is required.');
  requireValue(ID.test(input.id??''),'Use a stable record ID.');
  const base={id:input.id};
  if(section==='priceSummary') {
    const row=Number(input.row);requireValue([9,10,11,12,13,15,16,17].includes(row)&&base.id==='summary-'+row,'Choose a native price summary note row.');
    return {...base,row,notes:text(input.notes??'')};
  }
  if(section==='requirements') {
    requireValue(catalog.requirementIds.has(base.id),'Choose a requirement from the original workbook.');
    return {...base,response:choice(input.response??'',RESPONSE_CODES,'response'),module:text(input.module??'',500),
      phase:choice(input.phase??'',REQUIREMENT_PHASES,'requirement phase'),comment:text(input.comment??''),
      owner:text(input.owner??'',200),status:choice(input.status??'Unassigned',DELIVERY_STATES,'delivery status'),
      implementation:text(input.implementation??''),assetIds:ids(input.assetIds??[])};
  }
  if(section==='interfaces') {
    requireValue(catalog.interfaceIds.has(base.id),'Choose an interface from the original workbook.');
    return {...base,...Object.fromEntries(Object.entries(INTERFACE_OPTIONS).map(([k,v])=>[k,choice(input[k]??'',v,k)])),
      frequency:text(input.frequency??'',300),comments:text(input.comments??''),owner:text(input.owner??'',200),
      status:choice(input.status??'Unassigned',DELIVERY_STATES,'delivery status'),mapping:text(input.mapping??''),
      recovery:text(input.recovery??''),result:text(input.result??''),assetIds:ids(input.assetIds??[])};
  }
  if(section==='phases') {
    const number=Number(input.number);requireValue(Number.isInteger(number)&&number>=1&&number<=10,'Staffing phases are numbered 1 through 10.');
    return {...base,number,name:text(input.name??'',300),description:text(input.description??''),
      requirementPhase:choice(input.requirementPhase??'',REQUIREMENT_PHASES,'requirement phase'),owner:text(input.owner??'',200),
      start:text(input.start??'',40),end:text(input.end??'',40)};
  }
  if(section==='staffing') {
    requireValue(Array.isArray(input.months)&&input.months.length===24,'Enter the 24 native monthly hour values.');
    return {...base,side:choice(input.side,['Offeror','City'],'staffing side'),phaseId:text(input.phaseId??'',80),
      resource:choice(input.resource??'Other',RESOURCE_TYPES,'resource type'),role:text(input.role??'',500),months:input.months.map(amount)};
  }
  if(['software','services','other'].includes(section)) {
    const row={...base,classification:choice(input.classification??'Included',['Included','Optional'],'price classification')};
    if(section==='software') {
      requireValue(Array.isArray(input.years)&&input.years.length===5,'Enter five annual software fee values.');
      return {...row,name:text(input.name??'',500),function:text(input.function??'',1000),metric:text(input.metric??'',300),
        limitation:text(input.limitation??'',300),initial:amount(input.initial),years:input.years.map(amount),comments:text(input.comments??'')};
    }
    if(section==='services')return {...row,payment:text(input.payment??'',80),milestone:text(input.milestone??'',500),
      phaseId:text(input.phaseId??'',80),description:text(input.description??''),amount:amount(input.amount),comments:text(input.comments??'')};
    return {...row,description:text(input.description??''),amount:amount(input.amount)};
  }
  if(section==='milestones')return {...base,name:text(input.name??'',300),owner:text(input.owner??'',200),date:text(input.date??'',40),
    phaseId:text(input.phaseId??'',80),status:choice(input.status??'Planned',DELIVERY_STATES,'delivery status'),criteria:text(input.criteria??''),notes:text(input.notes??'')};
  throw new Error('Unknown project section.');
}
export function responseIssues(row) {
  const result=[];if(!row?.response)return ['Response not entered'];
  if(['Y','Y-WC'].includes(row.response)) {if(!row.module)result.push('Licensed module/system is required');if(!row.phase)result.push('Delivery phase is required');}
  if(['Y-WC','I'].includes(row.response)&&!row.comment)result.push(row.response==='I'?'Explain the information needed':'Describe every condition and impact');
  return result;
}
export function projectIssues(project,catalog) {
  const issues=[];
  for(const item of catalog.requirements)for(const message of responseIssues(project.requirements[item.id]))issues.push({section:'requirements',id:item.id,message});
  const phaseNumbers=new Set();
  for(const phase of Object.values(project.phases)) {
    if(phaseNumbers.has(phase.number))issues.push({section:'phases',id:phase.id,message:'Staffing phase number is repeated'});phaseNumbers.add(phase.number);
    if(!phase.name)issues.push({section:'phases',id:phase.id,message:'Phase name is empty'});
  }
  for(const section of ['staffing','services','milestones'])for(const row of Object.values(project[section]))
    if(row.phaseId&&!project.phases[row.phaseId])issues.push({section,id:row.id,message:'Select an existing delivery phase'});
  for(const section of ['software','services','other'])for(const row of Object.values(project[section])) {
    const values=section==='software'?[row.initial,...row.years]:[row.amount];
    if(values.some(v=>v===''))issues.push({section,id:row.id,message:'A price is blank; enter 0 explicitly when there is no charge'});
  }
  return issues;
}
export function planningTotals(project) {
  const result={Included:{},Optional:{}};
  for(const classification of ['Included','Optional']) {
    const categories={initial:[],annual:[],services:[],other:[]};
    for(const row of Object.values(project.software).filter(x=>x.classification===classification)) {categories.initial.push(row.initial);categories.annual.push(...row.years);}
    for(const row of Object.values(project.services).filter(x=>x.classification===classification))categories.services.push(row.amount);
    for(const row of Object.values(project.other).filter(x=>x.classification===classification))categories.other.push(row.amount);
    let total=0n,blank=0;
    for(const [name,values]of Object.entries(categories)) {let sum=0n,missing=0;for(const v of values){const n=decimalUnits(v);if(n===null)missing++;else sum+=n;}result[classification][name]={known:formatUnits(sum),blank:missing};total+=sum;blank+=missing;}
    result[classification].fiveYear={known:formatUnits(total),blank};
  }
  const staffing={};
  for(const side of ['Offeror','City']) {const months=Array(24).fill(0n);let blank=0;for(const row of Object.values(project.staffing).filter(x=>x.side===side))row.months.forEach((v,i)=>{const n=decimalUnits(v);if(n===null)blank++;else months[i]+=n;});
    staffing[side]={months:months.map(x=>formatUnits(x)),total:formatUnits(months.reduce((a,b)=>a+b,0n)),blank};}
  return {prices:result,staffing};
}
export function summarize(project,catalog) {
  const rows=Object.values(project.requirements),issues=projectIssues(project,catalog);
  return {requirements:catalog.requirements.length,answered:rows.filter(x=>x.response).length,
    completeResponses:rows.filter(x=>responseIssues(x).length===0).length,accepted:rows.filter(x=>x.status==='Accepted').length,
    interfaces:catalog.interfaces.length,plannedInterfaces:Object.values(project.interfaces).filter(x=>x.plan).length,
    reviews:project.reviews.length,issueCount:issues.length,issues,totals:planningTotals(project)};
}
