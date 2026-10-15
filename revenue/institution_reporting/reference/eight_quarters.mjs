#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function makeEightQuarterInput(sha256,entityCount=25){
  if(typeof sha256!=='function'||!Number.isInteger(entityCount)||entityCount<3||entityCount>50)throw Error('Use a UTF-8 SHA256 function and 3–50 institutions');
  const json=x=>JSON.stringify(x,null,2)+'\n';
  const sourcePeriods=['2024-09-30','2024-12-31','2025-03-31','2025-06-30','2025-09-30','2025-12-31','2026-03-31','2026-06-30','2026-09-30'];
  const fields=[
    ['assets','Total assets','instant'],['loans','Gross loans','instant'],['securities','Securities','instant'],
    ['deposits','Deposits','instant'],['borrowings','Borrowings','instant'],['equity','Equity','instant'],
    ['cash','Cash','instant'],['allowance','Loan allowance','instant'],['nonperforming','Nonperforming loans','instant'],
    ['income_ytd','Net income YTD','year_to_date'],['interest_income_ytd','Interest income YTD','year_to_date'],
    ['interest_expense_ytd','Interest expense YTD','year_to_date'],['noninterest_income_ytd','Noninterest income YTD','year_to_date'],
    ['noninterest_expense_ytd','Noninterest expense YTD','year_to_date']
  ];
  const institutions=Array.from({length:entityCount},(_,i)=>({id:'B'+String(i+1).padStart(3,'0'),name:'Authored institution '+String(i+1).padStart(2,'0'),family:'bank'}));
  const nativeMapping={table_id:'table-1',header_row:0,entity:{column:0},period:{column:1},
    metrics:fields.map(([label,,basis],i)=>({column:i+2,label,unit:'USD',basis,zero_policy:'reported',note:'Authored reference; not customer data'})),
    key_columns:[],missing_tokens:[],reporting_note:'Authored eight-quarter receiving reference',identity_kind:'provider_label'};
  const originals=[],views=[],sourceSelections=[];
  for(const period of sourcePeriods){
    const year=Number(period.slice(0,4)),q=['03-31','06-30','09-30','12-31'].indexOf(period.slice(5))+1,ix=(year-2024)*4+q;
    const rows=institutions.map((entity,i)=>{
      const assets=100000000+i*1000000+ix*1000000,quarterIncome=(100000+(year-2024)*10000)*(i+1);
      const values=[assets,assets*0.6,assets*0.2,i===entityCount-1&&period==='2026-06-30'?'':assets*0.8,assets*0.1,assets*0.1,assets*0.05,100000+i*1000,50000+i*500,
        i===1?0:quarterIncome*q,quarterIncome*5*q,quarterIncome*2*q,quarterIncome*q,quarterIncome*2*q];
      return [entity.id,period,...values.map(String)];
    });
    const body=[['institution','period',...fields.map(x=>x[0])].join(','),...rows.map(x=>x.join(','))].join('\n')+'\n',hash=sha256(body),filename='authored-'+period+'.csv';
    originals.push({filename,sha256:hash,text:body});
    const observations=[];
    rows.forEach((r,ri)=>fields.forEach(([metric,,basis],mi)=>{
      const raw=r[mi+2],present=raw!=='';
      observations.push({entity:r[0],period,period_raw:period,metric,raw,value:present?raw:null,status:present?(raw==='0'?'reported_zero':'reported'):'missing',
        comparable:present,unit:'USD',basis,zero_policy:'reported_zero',normalized_value:present?raw:null,normalized_unit:'USD',scale:'1',metric_note:'Authored reference',
        source:{sha256:hash,table_id:'table-1',row:ri+2,column:mi+3,line:ri+2,source_row:r.join(',')}});
    }));
    const view={schema:'commons.bankregdata-view.v1',source_sha256:hash,mapping:{authoredReference:true},observations,entities:institutions.map(x=>x.id),periods:[period],metrics:fields.map(x=>x[0]),observation_count:observations.length};
    const bodyView=json(view);views.push({sha256:sha256(bodyView),text:bodyView});
    fields.forEach(([metric,,basis])=>sourceSelections.push({metric,period,sourceSha256:hash,tableId:'table-1',definitionId:'authored-'+metric+'-v1',compatibility:{group:'authored-'+metric+'-v1',approvedBy:'Reference author',approvedAt:'2026-10-15',note:basis==='instant'?'Same authored quarter-end definition':'Same authored calendar-year cumulative definition'}}));
  }
  const measures=fields.map(([id,label,basis])=>({id,label,unit:'USD',decimals:2,operation:'reported',sourceMetric:id,sourceBasis:basis,sourceDefinitionGroup:'authored-'+id+'-v1',peerStatistic:'mean',rankDirection:'none',comparisonPolicy:basis==='year_to_date'?'same_calendar_quarter':'compatible',comparisonNote:basis==='year_to_date'?'Compare the same calendar quarter across years; cumulative durations differ between quarters.':'Compare explicitly selected quarter-end positions.'}));
  measures.push({id:'income_quarter',label:'Net income for the quarter',unit:'USD',decimals:2,operation:'quarter_from_ytd',sourceMetric:'income_ytd',sourceBasis:'year_to_date',sourceDefinitionGroup:'authored-income_ytd-v1',peerStatistic:'mean',rankDirection:'none',comparisonPolicy:'compatible',comparisonNote:'Each standalone calendar quarter uses its actual same-year predecessor.'});
  for(const [id,label,n,d,policy] of [
    ['loans_assets','Loans / assets','loans','assets','compatible'],
    ['deposits_assets','Deposits / assets','deposits','assets','compatible'],
    ['equity_assets','Equity / assets','equity','assets','compatible'],
    ['nonperforming_loans','Nonperforming / gross loans','nonperforming','loans','compatible'],
    ['income_assets_ytd','YTD income / period-end assets (unannualized)','income_ytd','assets','same_calendar_quarter']
  ])measures.push({id,label,unit:'percent',decimals:2,operation:'ratio',numerator:n,denominator:d,multiplier:'100',peerStatistic:'ratio_of_sums',rankDirection:'none',comparisonPolicy:policy,comparisonNote:policy==='same_calendar_quarter'?'Same calendar YTD duration and quarter-end denominator; not annualized return on average assets.':'Compare the selected quarter-end ratio; absolute changes are percentage points.'});
  const periods=sourcePeriods.slice(1),comparisonPairs=periods.slice(1).map((to,i)=>({id:'adjacent-'+(i+1),label:'Adjacent selected quarter',from:periods[i],to,measureIds:measures.filter(m=>m.comparisonPolicy==='compatible').map(m=>m.id)}));
  periods.slice(4).forEach((to,i)=>comparisonPairs.push({id:'year-'+(i+1),label:'Same quarter, prior year',from:periods[i],to}));
  return {schema:'commons.institution-report-input.v1',title:'Authored eight-quarter institution reporting example',reportLayout:'four_sections',periods,institutions,subjectIds:['B001'],
    cohorts:[{id:'authored-peers',subjectId:'B001',definition:'Fixed authored cohort; no financial recommendation',approvedBy:'Reference author',approvedAt:'2026-10-15',includeSubject:true,memberIds:institutions.map(x=>x.id)}],
    measures,comparisonPairs,originals,views,sourceSelections,
    review:{reviewer:null,reviewedAt:null,corrections:[],findings:[],note:'Authored reference. Actual firm review is completed separately.'},nativeMapping,
    authoredReceiving:{sourcePeriods,expectedInstitutionRows:entityCount*8*20,expectedPeerRows:160,expectedPeriodRows:178,
      checks:[{entity:'B001',period:'2024-12-31',measure:'income_quarter',display:'100000.00'},{subject:'B001',comparisonId:'year-1',measure:'income_ytd',absolute:'40000.00',relativePercent:'10.00'}]}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=process.argv[2],count=process.argv[3]===undefined?25:Number(process.argv[3]);
  if(!output||process.argv.length>4)throw Error('Use: node reference/eight_quarters.mjs NEW_INPUT_JSON [INSTITUTION_COUNT]');
  const input=makeEightQuarterInput(s=>createHash('sha256').update(s,'utf8').digest('hex'),count);
  const fd=await open(output,'wx',0o600);
  try{await fd.writeFile(JSON.stringify(input,null,2)+'\n','utf8');await fd.sync();}finally{await fd.close();}
  console.log(JSON.stringify({output:resolve(output),institutions:count,periods:input.periods.length,measures:input.measures.length}));
}
