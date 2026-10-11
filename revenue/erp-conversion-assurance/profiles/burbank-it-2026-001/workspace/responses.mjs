// MIT. Native response-cell transfers; source requirement cells are never edited.
import {requireValue} from './schema.mjs';
const columns=n=>{let s='';for(let x=n;x>0;x=Math.floor((x-1)/26))s=String.fromCharCode(65+(x-1)%26)+s;return s;};
const csvCell=value=>{let s=String(value??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
export const csv=rows=>rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
const phaseName=(p,id)=>p.phases[id]?`Phase ${p.phases[id].number}`:'';
export function responseTransfers(project,catalog) {
  const output={},patches={requirements:[],interfaces:[],staffing:[],price:[]};
  const cell=(kind,sheet,row,col,value,type='text')=>patches[kind].push({sheet,row,column:columns(col),value:value??'',type});
  const rows=[['Worksheet','Requirement #','Functional Area','Process','User Story','Response','Module/System','Phase','Comment','Owner','Delivery Status','Source Record']];
  for(const item of catalog.requirements) {
    const a=project.requirements[item.id]??{};
    rows.push([item.sheet,item.number,item.area,item.process,item.text,a.response,a.module,a.phase,a.comment,a.owner,a.status,item.sourceRecord]);
    for(const [i,key]of ['response','module','phase','comment'].entries())cell('requirements',item.sheet,item.row,5+i,a[key]);
  }
  output['acceptance-responses.csv']=csv(rows);
  const ir=[['Application','Application Description','Interface Description','FdL Comments','Respondent Interface Plan','Direction_R','Frequency_R','Method_R','Experience','Type of Solution','Type of Support','Comments','Owner','Delivery Status','Source Record']];
  for(const item of catalog.interfaces) {
    const a=project.interfaces[item.id]??{},values=['plan','direction','frequency','method','experience','solution','support','comments'].map(k=>a[k]??'');
    ir.push([item.application,item.description,item.interface,item.comments,...values,a.owner,a.status,item.sourceRecord]);
    values.forEach((value,i)=>cell('interfaces','Interfaces',item.row,5+i,value));
  }
  output['interface-responses.csv']=csv(ir);
  const phases=Object.values(project.phases).sort((a,b)=>a.number-b.number);
  output['delivery-phases.csv']=csv([['Proposed Phases','Phase Name','Phase Description','Requirement Phase','Owner','Start','End'],...phases.map(x=>['Phase '+x.number,x.name,x.description,x.requirementPhase,x.owner,x.start,x.end])]);
  for(let number=1;number<=10;number++){const p=phases.find(x=>x.number===number);cell('staffing','Phases',3+number,2,p?.name);cell('staffing','Phases',3+number,3,p?.description);}
  const capacity=[];
  for(const side of ['Offeror','City']) {
    const sheet=side+' Staffing',staff=Object.values(project.staffing).filter(x=>x.side===side);
    output[side.toLowerCase()+'-staffing.csv']=csv([['Phase','Resource Type','Resource Role',...Array.from({length:24},(_,i)=>'Month '+(i+1))],...staff.map(x=>[phaseName(project,x.phaseId),x.resource,x.role,...x.months])]);
    if(staff.length>30)capacity.push(sheet+' has '+staff.length+' entries; the original template has 30 input rows. The full CSV contains all entries.');
    for(let i=0;i<30;i++){const x=staff[i],values=x?[phaseName(project,x.phaseId),x.resource,x.role,...x.months]:Array(27).fill('');values.forEach((v,j)=>cell('staffing',sheet,7+i,j+1,v,j>=3?'number':'text'));}
  }
  const software=Object.values(project.software),services=Object.values(project.services),other=Object.values(project.other);
  output['software-fees.csv']=csv([['Product Name','Function','Included or Optional','License Metric','License Limitation','Initial Cost','Year 1','Year 2','Year 3','Year 4','Year 5','Comments'],...software.map(x=>[x.name,x.function,x.classification,x.metric,x.limitation,x.initial,...x.years,x.comments])]);
  output['service-fees.csv']=csv([['Payment #','Milestone','Project Phase','Included or Optional','Description','Amount','Comments'],...services.map(x=>[x.payment,x.milestone,phaseName(project,x.phaseId),x.classification,x.description,x.amount,x.comments])]);
  output['other-fees.csv']=csv([['Description','Included or Optional','Cost'],...other.map(x=>[x.description,x.classification,x.amount])]);
  for(const [name,items,max]of [['Software',software,27],['Services',services,27],['Other Fees',other,15]])if(items.length>max)capacity.push(name+' exceeds the original '+max+' input rows. The full CSV contains every entry.');
  for(let i=0;i<27;i++) {
    const x=software[i],values=x?[x.name,x.function,x.classification,x.metric,x.limitation,x.initial,...x.years]:Array(11).fill('');
    values.forEach((v,j)=>cell('price','2-Software',6+i,j+1,v,j>=5?'number':'text'));cell('price','2-Software',6+i,13,x?.comments);
    const y=services[i],sv=y?[y.payment,y.milestone,phaseName(project,y.phaseId),y.classification,y.description,y.amount,y.comments]:Array(7).fill('');
    sv.forEach((v,j)=>cell('price','3-Services',5+i,j+1,v,j===5?'number':'text'));
  }
  for(let i=0;i<15;i++){const x=other[i];[x?.description,x?.classification,x?.amount].forEach((v,j)=>cell('price','4-Other Fees',5+i,j+1,v,j===2?'number':'text'));}
  cell('price','1-Summary',3,2,project.metadata.organization);
  for(const row of [9,10,11,12,13,15,16,17])cell('price','1-Summary',row,4,project.priceSummary?.['summary-'+row]?.notes);
  output['price-summary-notes.csv']=csv([['Native row','Comments'],...[9,10,11,12,13,15,16,17].map(row=>[row,project.priceSummary?.['summary-'+row]?.notes??''])]);
  return {schema:'erp-burbank.native-response-transfers.v1',projectId:project.id,revision:project.revision,
    catalogSha256:catalog.catalogSha256,patches,capacity,files:output,
    notes:[
      'Worksheet numbers restart; each requirement is keyed by worksheet and native source row.',
      'Acceptance workbook code Y-WC differs from the RFP page 60 narrative Y-ND. The original workbook code is preserved.',
      'Interface instructions mention L–S; the actual response headers are E–L. Exports use the actual headers.',
      'Other Fees instructions describe Comments/Insurance, while the actual sheet has Cost in column C. Exports preserve the actual sheet.',
      'Staffing phases 1–10 map explicitly to requirement phases 1, 2 or X; they are different fields.',
      'CSV protects text beginning with spreadsheet formula characters. JSON retains the exact original response text.',
    ]};
}
export function importResponses(kind,values,project,catalog) {
  const get=(sheet,row,col)=>String(values[sheet]?.[row]?.[col]??'');
  const operations=[];
  if(kind==='requirements')for(const item of catalog.requirements) {
    const row={...project.requirements[item.id],id:item.id,response:get(item.sheet,item.row,'E'),module:get(item.sheet,item.row,'F'),phase:get(item.sheet,item.row,'G'),comment:get(item.sheet,item.row,'H')};
    if(row.response||row.module||row.phase||row.comment||project.requirements[item.id])operations.push({type:'upsert',section:'requirements',record:row});
  }
  else if(kind==='interfaces')for(const item of catalog.interfaces) {
    const row={...project.interfaces[item.id],id:item.id};['plan','direction','frequency','method','experience','solution','support','comments'].forEach((key,i)=>row[key]=get('Interfaces',item.row,columns(5+i)));
    if(Object.keys(row).some(k=>k!=='id'&&row[k]))operations.push({type:'upsert',section:'interfaces',record:row});
  }
  else throw new Error('Workbook response import supports Acceptance Requirements and Interfaces. Staffing and price entries are edited in their native planning forms.');
  requireValue(operations.length<=1200,'The workbook exceeds its native response population.');return operations;
}
