// Expectations come only from the pinned original CSV; native results remain separate.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {check,digest} from '../native/files.mjs';
export const MODEL='dbt/models/regional_sales.yml';
export const CHART='dbt/charts/regional-sales-total-row-total-demo.yml';
export const CHART_SLUG='regional-sales-total-row-total-demo';
export function csvRows(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
 else if(c==='"'){check(field==='','LIGHTDASH_CSV','Unexpected quote in original CSV.');quoted=true;}else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field.endsWith('\r')?field.slice(0,-1):field);rows.push(row);row=[];field='';}else field+=c;}
 check(!quoted,'LIGHTDASH_CSV','Incomplete original CSV quote.');if(field||row.length){row.push(field.endsWith('\r')?field.slice(0,-1):field);rows.push(row);}return rows;
}
export async function expectedSales(exampleRoot){
 const file=path.join(exampleRoot,'dbt/data/raw_regional_sales.csv'),bytes=await readFile(file);
 const blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
 check(blob==='ba0c5e1b23283543b23e4957fd1fc2e4431aefd4','LIGHTDASH_EXAMPLE','Original sales CSV changed.');
 const [headers,...data]=csvRows(bytes.toString('utf8'));check(headers.join(',')==='id,sale_date,region,product_category,units_sold,revenue,customer_id','LIGHTDASH_EXAMPLE','Original sales fields changed.');
 const groups=new Map(),ids=new Set(),dates=[];let units=0,revenue=0;
 for(const row of data){check(row.length===headers.length,'LIGHTDASH_EXAMPLE','Incomplete original CSV row.');const d=Object.fromEntries(headers.map((h,i)=>[h,row[i]]));
  check(!ids.has(d.id)&&/^\d{4}-\d{2}-\d{2}$/.test(d.sale_date),'LIGHTDASH_EXAMPLE','Invalid original transaction identity/date.');ids.add(d.id);dates.push(d.sale_date);
  const u=Number(d.units_sold),v=Number(d.revenue);check(Number.isSafeInteger(u)&&Number.isSafeInteger(v)&&u>=0&&v>=0,'LIGHTDASH_EXAMPLE','Invalid original unit/revenue values.');
  const month=d.sale_date.slice(0,7),key=month+'\0'+d.region,g=groups.get(key)??{month,region:d.region,units:0,revenue:0,sales:0};g.units+=u;g.revenue+=v;g.sales++;groups.set(key,g);units+=u;revenue+=v;
 }
 dates.sort();const expected={source:{file,bytes:bytes.length,sha256:digest(bytes),gitBlob:blob},rows:data.length,minDate:dates[0],maxDate:dates.at(-1),groups:[...groups.values()].sort((a,b)=>(a.month+'\0'+a.region).localeCompare(b.month+'\0'+b.region)).map(g=>({...g,usdPerUnit:g.units?g.revenue/g.units:null})),totals:{units,revenue,usdPerUnit:units?revenue/units:null},basis:'Calculated from complete original fixture CSV, not an executed provider result.'};
 check(expected.rows===72&&expected.groups.length===18&&units===14395&&revenue===1127250,'LIGHTDASH_EXAMPLE','Pinned complete regional source totals changed.');return expected;
}
function raw(row,key){check(Object.hasOwn(row,key)&&row[key]&&Object.hasOwn(row[key].value??{},'raw'),'LIGHTDASH_NATIVE_ROWS','Native row lacks the requested original field.',{field:key});return row[key].value.raw;}
function month(value){check(typeof value==='string'&&/^\d{4}-\d{2}(?:-\d{2}(?:[T ].*)?)?$/.test(value),'LIGHTDASH_NATIVE_ROWS','Native month has an unsupported actual date representation.');return value.slice(0,7);}
function numeric(value,label){check(typeof value==='number'||(typeof value==='string'&&value.trim()!==''),'LIGHTDASH_NATIVE_ROWS','Native '+label+' is not numeric.');const n=Number(value);check(Number.isFinite(n),'LIGHTDASH_NATIVE_ROWS','Native '+label+' is not finite.');return n;}
function near(actual,expected,label){check(Math.abs(actual-expected)<=Math.max(1e-8,Math.abs(expected)*1e-10),'LIGHTDASH_NATIVE_ROWS','Native '+label+' differs from the original complete data.',{actual,expected});}
export function compareNativeSales(payload,expected,{candidate=true}={}){
 check(payload.ready===true&&Array.isArray(payload.result?.rows),'LIGHTDASH_NATIVE_ROWS','The original query is not READY.');
 const rows=payload.result.rows;check(rows.length===expected.groups.length,'LIGHTDASH_NATIVE_ROWS','The native result does not include all original month/region groups.');
 const seen=new Set(),out=[];
 for(const row of rows){
  const m=month(raw(row,'regional_sales_sale_date_month')),region=raw(row,'regional_sales_region'),key=m+'\0'+region;
  check(!seen.has(key),'LIGHTDASH_NATIVE_ROWS','Native query duplicated a month/region group.');seen.add(key);
  const e=expected.groups.find(g=>g.month===m&&g.region===region);check(e,'LIGHTDASH_NATIVE_ROWS','Native query returned another source group.');
  const revenue=numeric(raw(row,'regional_sales_total_revenue'),'revenue');near(revenue,e.revenue,'USD revenue');const actual={month:m,region,revenue};
  if(candidate){const units=numeric(raw(row,'regional_sales_total_units'),'units'),yieldValue=raw(row,'regional_sales_revenue_per_unit');near(units,e.units,'units');if(e.units===0)check(yieldValue===null,'LIGHTDASH_NATIVE_ROWS','Zero-unit revenue must remain null.');else near(numeric(yieldValue,'USD per unit'),e.usdPerUnit,'weighted USD per unit');actual.units=units;actual.usdPerUnit=yieldValue===null?null:Number(yieldValue);}
  out.push(actual);
 }
 return {projectUuid:payload.projectUuid,queryUuid:payload.queryUuid,rows:rows.length,groups:out.sort((a,b)=>(a.month+'\0'+a.region).localeCompare(b.month+'\0'+b.region)),sourceTransactions:expected.rows,sourceDateRange:[expected.minDate,expected.maxDate],revenueCurrency:'USD',unitRevenueDefinition:candidate?'sum(revenue in USD) / sum(units_sold), within each selected month and region; zero denominator is null':null,completeSelectedQuery:true};
}
