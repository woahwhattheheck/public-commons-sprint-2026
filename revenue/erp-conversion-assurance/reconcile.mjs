#!/usr/bin/env node
// MIT. Vendor-neutral source/target ERP reconciliation. Never sends or publishes customer records.
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';

const argv=process.argv.slice(2);
const opt=name=>{const i=argv.indexOf(name);return i<0?null:argv[i+1]};
const required=name=>{const v=opt(name);if(!v)throw Error('Required '+name);return v};
const fieldName=v=>typeof v==='string'&&v.trim()&&v.length<=160;
const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
const hashText=v=>createHash('sha256').update(v).digest('hex');
const sign=(key,parts)=>createHmac('sha256',key).update(JSON.stringify(parts)).digest('hex');
const captureHash=async path=>{const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex')};
const assert=(condition,message)=>{if(!condition)throw Error(message)};

// Streaming RFC 4180-style CSV parser: UTF-8, quoted newlines, escaped quotes, CRLF, BOM.
async function* csvRows(file){
 let row=[],field='',state=0,skipLf=false,atStart=true,seen=false,record=0;
 const finishField=()=>{row.push(field);field='';state=0};
 const finishRow=()=>{finishField();const out=row;row=[];record++;return out};
 for await(const chunk of createReadStream(file,{encoding:'utf8'})){
  for(const c of chunk){
   if(atStart){atStart=false;if(c==='\ufeff')continue}
   if(skipLf){skipLf=false;if(c==='\n')continue}
   seen=true;
   if(state===1){
    if(c==='"')state=2;
    else field+=c;
   }else if(state===2){
    if(c==='"'){field+='"';state=1}
    else if(c===',')finishField();
    else if(c==='\r'||c==='\n'){yield finishRow();if(c==='\r')skipLf=true}
    else throw Error('CSV unexpected content after quoted field in record '+(record+1));
   }else if(c==='"'){
    if(field.length)throw Error('CSV quote inside unquoted field in record '+(record+1));
    state=1;
   }else if(c===',')finishField();
   else if(c==='\r'||c==='\n'){yield finishRow();if(c==='\r')skipLf=true}
   else field+=c;
   assert(field.length<=4_000_000,'CSV field exceeds 4 MB');
  }
 }
 if(state===1)throw Error('CSV unclosed quote');
 if(seen&&(row.length||field.length||state===2))yield finishRow();
}

function fixed(v,scale){
 const raw=String(v??'').trim();
 assert(/^[+-]?\d+(?:\.\d+)?$/.test(raw),'Invalid numeric decimal');
 const neg=raw[0]==='-',number=raw.replace(/^[+-]/,''),[i,f='']=number.split('.');
 assert(f.length<=scale,'Numeric precision exceeds declared scale '+scale);
 const whole=BigInt(i)*10n**BigInt(scale)+BigInt((f+'0'.repeat(scale)).slice(0,scale)||'0');
 return neg?-whole:whole;
}
function render(n,scale){
 const v=n<0n?-n:n,denom=10n**BigInt(scale);
 const prefix=n<0n?'-':'';
 return prefix+(v/denom).toString()+(scale?'.'+(v%denom).toString().padStart(scale,'0'):'');
}
function compileCrosswalk(value, keys){
 if(value===undefined)return null;
 assert(isObj(value)&&Array.isArray(value.keys)&&value.keys.length&&
  new Set(value.keys).size===value.keys.length&&value.keys.every(k=>keys.includes(k)),
  'source_key_crosswalk.keys must select unique reconciliation keys');
 assert(Array.isArray(value.rows),'source_key_crosswalk.rows must be an array');
 const positions=value.keys.map(k=>keys.indexOf(k)),entries=new Map();
 const tuple=(parts,row,side)=>{
  assert(Array.isArray(parts)&&parts.length===positions.length&&parts.every(x=>typeof x==='string'),
   'Invalid crosswalk '+side+' tuple at mapping row '+row);
  const normalized=parts.map(x=>x.trim().normalize('NFC'));
  assert(normalized.every(Boolean),'Empty crosswalk value at mapping row '+row);
  return normalized;
 };
 for(let i=0;i<value.rows.length;i++){
  const row=value.rows[i];assert(isObj(row),'Invalid crosswalk mapping row '+(i+1));
  const source=JSON.stringify(tuple(row.source,i+1,'source')),target=tuple(row.target,i+1,'target');
  assert(!entries.has(source),'Duplicate crosswalk source tuple at mapping row '+(i+1));
  entries.set(source,target);
 }
 return {keys:value.keys,positions,entries};
}
function validate(spec){
 assert(isObj(spec)&&spec.version===1,'spec.version must equal 1');
 assert(fieldName(spec.dataset),'dataset required');
 assert(Array.isArray(spec.keys)&&spec.keys.length&&new Set(spec.keys).size===spec.keys.length&&spec.keys.every(fieldName),'unique keys required');
 assert(Array.isArray(spec.amounts)&&spec.amounts.every(x=>isObj(x)&&fieldName(x.name)&&Number.isInteger(x.scale)&&x.scale>=0&&x.scale<=8&&typeof x.tolerance==='string'),'amounts array with declared name, scale, tolerance required; use [] for key-only data');
 assert(new Set(spec.amounts.map(x=>x.name)).size===spec.amounts.length,'duplicate amount name');
 const attributes=spec.attributes??[];
 assert(Array.isArray(attributes)&&attributes.every(fieldName),'attributes must list logical text field names');
 const logicalFields=[...spec.keys,...spec.amounts.map(x=>x.name),...attributes];
 assert(new Set(logicalFields).size===logicalFields.length,'keys, amounts and attributes must have distinct logical names');
 assert(isObj(spec.source_columns)&&isObj(spec.target_columns),'explicit source_columns and target_columns maps required');
 assert(logicalFields.every(k=>fieldName(spec.source_columns[k])&&fieldName(spec.target_columns[k])),'every key, amount and attribute needs source and target column');
 assert(!spec.group_by||Array.isArray(spec.group_by)&&spec.group_by.every(k=>spec.keys.includes(k)),'group_by must select key columns');
 const withTol=spec.amounts.map(x=>({...x,toleranceUnits:fixed(x.tolerance,x.scale)}));
 assert(withTol.every(x=>x.toleranceUnits>=0n),'negative tolerance invalid');
 return {...spec,amounts:withTol,attributes,group_by:spec.group_by||[],crosswalk:compileCrosswalk(spec.source_key_crosswalk,spec.keys)};
}
const empty=(n)=>Array.from({length:n},()=>0n);
async function loadTable(file,keys,amounts,attributes,groupBy,mapping,key,crosswalk=null){
 const items=new Map(),groups=new Map(),total=empty(amounts.length),duplicates=[];
 let header=null,indices=[],rows=0,mappedRows=0,changedRows=0;
 for await(const columns of csvRows(file)){
  if(!header){
   header=columns.map(x=>x.trim());
   assert(new Set(header).size===header.length,'Duplicate input CSV header');
   indices=[...keys,...amounts.map(x=>x.name),...attributes].map(n=>{
    const i=header.indexOf(mapping[n]);assert(i>=0,'Missing declared input column '+mapping[n]);return i;
   });
   continue;
  }
  if(columns.length===1&&columns[0]===''&&header.length!==1)continue;
  rows++;
  assert(columns.length===header.length,'CSV column count mismatch at data record '+rows);
  const keyParts=indices.slice(0,keys.length).map(idx=>columns[idx].trim().normalize('NFC'));
  assert(keyParts.every(Boolean),'Empty reconciliation key at record '+rows);
  if(crosswalk){
   const lookup=JSON.stringify(crosswalk.positions.map(i=>keyParts[i]));
   const replacement=crosswalk.entries.get(lookup);
   assert(replacement,'Source key crosswalk missing tuple at data record '+rows);
   mappedRows++;
   if(crosswalk.positions.some((position,i)=>keyParts[position]!==replacement[i]))changedRows++;
   crosswalk.positions.forEach((position,i)=>{keyParts[position]=replacement[i]});
  }
  const internal=JSON.stringify(keyParts),safeKey=sign(key,keyParts);
  const values=amounts.map((x,j)=>{
   try{return fixed(columns[indices[keys.length+j]],x.scale)}
   catch(e){throw Error('Invalid amount '+x.name+' at record '+rows+': '+e.message)}
  });
  const textValues=attributes.map((_,j)=>columns[indices[keys.length+amounts.length+j]].normalize('NFC'));
  if(items.has(internal))duplicates.push({key_hmac_sha256:safeKey,record:rows,reason:'DUPLICATE_KEY'});
  else items.set(internal,{values,textValues,safeKey,record:rows});
  for(let j=0;j<values.length;j++)total[j]+=values[j];
  if(groupBy.length){
   const group=groupBy.map(k=>keyParts[keys.indexOf(k)]);
   const groupKey=JSON.stringify(group),g=groups.get(groupKey)||{safeKey:sign(key,group),values:empty(amounts.length),count:0};
   g.count++;for(let j=0;j<values.length;j++)g.values[j]+=values[j];groups.set(groupKey,g);
  }
 }
 assert(header,'CSV missing header');
 return {items,groups,total,rows,duplicates,mappedRows,changedRows,sha256:await captureHash(file)};
}
function reconcile(s,t,spec){
 const problems=[],stats={missing_in_target:0,unexpected_in_target:0,amount_delta:0,duplicate_in_source:s.duplicates.length,duplicate_in_target:t.duplicates.length,group_delta:0};
 if(spec.attributes.length)stats.attribute_delta=0;
 for(const [key,left] of s.items){
  const right=t.items.get(key);
  if(!right){stats.missing_in_target++;problems.push({kind:'MISSING_IN_TARGET',key_hmac_sha256:left.safeKey,source_record:left.record});continue}
  for(let j=0;j<spec.amounts.length;j++){
   const a=spec.amounts[j],delta=right.values[j]-left.values[j],mag=delta<0n?-delta:delta;
   if(mag>a.toleranceUnits){stats.amount_delta++;problems.push({kind:'AMOUNT_DELTA',key_hmac_sha256:left.safeKey,source_record:left.record,target_record:right.record,amount:a.name,delta_target_minus_source:render(delta,a.scale),tolerance:a.tolerance})}
  }
  for(let j=0;j<spec.attributes.length;j++)if(left.textValues[j]!==right.textValues[j]){
   stats.attribute_delta++;
   problems.push({kind:'ATTRIBUTE_DELTA',key_hmac_sha256:left.safeKey,source_record:left.record,target_record:right.record,attribute:spec.attributes[j]});
  }
 }
 for(const [key,right] of t.items)if(!s.items.has(key)){stats.unexpected_in_target++;problems.push({kind:'UNEXPECTED_IN_TARGET',key_hmac_sha256:right.safeKey,target_record:right.record})}
 for(const duplicate of s.duplicates)problems.push({...duplicate,side:'source'});
 for(const duplicate of t.duplicates)problems.push({...duplicate,side:'target'});
 const aggregates=spec.amounts.map((a,j)=>({amount:a.name,source:render(s.total[j],a.scale),target:render(t.total[j],a.scale),delta:render(t.total[j]-s.total[j],a.scale),tolerance:a.tolerance}));
 const groupReport=[];
 if(spec.group_by?.length){
  for(const k of new Set([...s.groups.keys(),...t.groups.keys()])){
   const left=s.groups.get(k),right=t.groups.get(k),safeKey=(left||right).safeKey;
   let mismatch=!left||!right||left.count!==right.count;
   const diffs=spec.amounts.map((a,j)=>{
    const delta=(right?.values[j]??0n)-(left?.values[j]??0n);
    if((delta<0n?-delta:delta)>a.toleranceUnits)mismatch=true;
    return {amount:a.name,delta:render(delta,a.scale)};
   });
   if(mismatch){stats.group_delta++;groupReport.push({group_hmac_sha256:safeKey,source_rows:left?.count||0,target_rows:right?.count||0,differences:diffs})}
  }
 }
 const totalWithinTolerance=spec.amounts.every((a,j)=>{const delta=t.total[j]-s.total[j];return (delta<0n?-delta:delta)<=a.toleranceUnits});
 const ok=Object.values(stats).every(v=>v===0)&&totalWithinTolerance;
 const result={status:ok?'PASS':'FAIL',counts:stats,source:{rows:s.rows,unique_keys:s.items.size,sha256:s.sha256},target:{rows:t.rows,unique_keys:t.items.size,sha256:t.sha256},totals:aggregates,discrepancies:problems,group_discrepancies:groupReport};
 if(spec.attributes.length)result.attributes=spec.attributes;
 if(spec.crosswalk)result.key_mapping={keys:spec.crosswalk.keys,configured_rows:spec.crosswalk.entries.size,
  source_rows_mapped:s.mappedRows,source_rows_changed:s.changedRows};
 return result;
}
async function main(){
 if(argv.includes('--help')){process.stdout.write('node reconcile.mjs --spec config.json --source source.csv --target target.csv --out PRIVATE_REPORT.json [--secret-env ERP_RECON_HMAC_KEY]\n');return}
 const configPath=resolve(required('--spec')),source=resolve(required('--source')),target=resolve(required('--target')),out=resolve(required('--out'));
 assert(source!==target,'Source and target must be distinct');
 const spec=validate(JSON.parse(await readFile(configPath,'utf8')));
 const secret=process.env[opt('--secret-env')||'ERP_RECON_HMAC_KEY'];
 assert(typeof secret==='string'&&secret.length>=20,'Set strong local ERP_RECON_HMAC_KEY before processing; never log or publish it');
 const s=await loadTable(source,spec.keys,spec.amounts,spec.attributes,spec.group_by,spec.source_columns,secret,spec.crosswalk);
 const t=await loadTable(target,spec.keys,spec.amounts,spec.attributes,spec.group_by,spec.target_columns,secret);
 const result=reconcile(s,t,spec);
 result.schema='ERP-CONVERSION-RECON-V1';result.dataset=spec.dataset;result.generated_at=new Date().toISOString();result.spec_sha256=hashText(await readFile(configPath));
 result.privacy='HMAC record/group keys; raw source/target identifiers omitted. Report amounts can remain confidential.';
 result.scope='Declared source/target dataset and selected key, amount and text fields.';
 await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(result,null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({status:result.status,dataset:result.dataset,source_rows:s.rows,target_rows:t.rows,counts:result.counts,report:out})+'\n');
 if(result.status==='FAIL')process.exitCode=2;
}
main().catch(e=>{process.stderr.write('ERP reconciliation error: '+(e?.message||String(e))+'\n');process.exitCode=1});

