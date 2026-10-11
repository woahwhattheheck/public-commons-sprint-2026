// MIT. Published MuniBilling dictionaries projected through explicit local identities.
import {TABLES} from './profile.mjs';
import {need,parseTable,decimal,date,zone,localDay,json,csv} from './util.mjs';
const KINDS={customer:'accounts',bills:'legacy_bills',payments:'payments',meter_readings:'readings',backflow_devices:'backflow'};
const by=(rows,key)=>{const result=new Map();for(const row of rows??[]){if(!row[key])continue;if(!result.has(row[key]))result.set(row[key],[]);result.get(row[key]).push(row);}return result;};
const unique=(index,key,label)=>{const rows=index.get(key)??[];need(rows.length===1,label+' must resolve to one retained identity.');return rows[0];};
const empty=kind=>Object.fromEntries(TABLES[kind].fields.map(k=>[k,'']));
const truth=value=>value==='1';
function nativeTime(value,options,label){
  need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value),label+' needs the original full native datetime.');
  date(value.slice(0,10),label);const normalized=value.replace(' ','T'),explicit=/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);
  need(explicit||typeof options.utcOffset==='string'&&/^[+-]\d{2}:\d{2}$/.test(options.utcOffset),'Select the actual UTC offset for native datetimes without an offset.');
  const result=explicit?normalized:normalized+options.utcOffset;zone(options.timezone);localDay(result,options.timezone);
  if(!explicit){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:options.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(result)).map(p=>[p.type,p.value])),clock=parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute+':'+parts.second;need(clock===normalized.slice(0,19),'The selected offset does not match this native clock in the configured time zone. Split the source by its actual offset when needed.');}
  return result;
}
function checkNative(row,dictionary){
  const findings=[];for(const field of dictionary.fields){const value=row[field.name];if(value===undefined||value==='')continue;try{
    const type=field.sql_type??'',match=/decimal\((\d+),\s*(\d+)\)/i.exec(type);
    if(match){const precision=Number(match[1]),scale=Number(match[2]),n=decimal(value,scale,field.name);need((n<0n?-n:n)<10n**BigInt(precision),field.name+' exceeds its published decimal precision.');}
    else if(/^tinyint\(1\)/i.test(type))need(value==='0'||value==='1',field.name+' is a published 0/1 flag.');
    else if(/^(?:bigint|smallint|int|tinyint)/i.test(type))need(/^-?\d+$/.test(value),field.name+' must retain an integer string.');
    else if(/^date$/i.test(type))date(value,field.name);
  }catch(error){findings.push(error.message);}}
  return findings;
}
export function projectMuniBilling(bytes,{dictionary:dictionaryName,format='csv',options={},tables={},contracts}){
  const dictionary=contracts.dictionaries.find(d=>d.name===dictionaryName),kind=KINDS[dictionaryName];need(dictionary&&kind,'Select a published MuniBilling source dictionary.');
  const table=parseTable(bytes,format),accountsByNative=by(tables.accounts,'native_customer_id'),metersByNative=by(tables.meters,'native_meter_id'),metersById=by(tables.meters,'meter_id');
  const rows=[],rowMap=[],bindings=[],findings=[],excluded=[];
  const servicesByAccount=by(tables.services,'account_id'),servicesByMeter=by(tables.services,'meter_id');
  const resolveAccount=native=>unique(accountsByNative,native,'Native customer_id '+native);
  function resolveService(raw,account,meter=null){
    const explicit=options.serviceByNativeId?.[raw.id];if(explicit){const found=(tables.services??[]).filter(s=>s.service_id===explicit);need(found.length===1&&(!account||found[0].account_id===account.account_id)&&(!meter||found[0].meter_id===meter.meter_id),'The explicit native record/service crosswalk conflicts with retained account or meter identity.');return found[0];}
    const pool=account?(servicesByAccount.get(account.account_id)??[]):meter?(servicesByMeter.get(meter.meter_id)??[]):[];
    const matches=pool.filter(s=>(!raw.parcel_id||s.address_id===raw.parcel_id)&&(!meter||s.meter_id===meter.meter_id));need(matches.length===1,'Native record '+raw.id+' needs an explicit service crosswalk when its account/parcel/meter identifies zero or multiple services.');return matches[0];
  }
  function append(data,index,binding={},role='record'){rows.push(data);rowMap.push({nativeRow:index+1,role});bindings.push(binding);}
  for(const [index,raw] of table.rows.entries()){
    const errors=checkNative(raw,dictionary),data=empty(kind),binding={};
    const put=(key,column,{readOnly=false}={})=>{data[key]=raw[column]??'';binding[key]={column,readOnly};};
    try{
      if(dictionaryName==='customer'){
        need(['id','legacy_customer_id','account_number'].includes(options.accountIdentity),'Choose native Customer ID, Legacy Customer ID or the source Account Number as the canonical customer identity.');
        need(raw[options.accountIdentity],'The selected native account identity is absent on this record.');put('account_id',options.accountIdentity,{readOnly:true});put('native_customer_id','id',{readOnly:true});put('legacy_customer_id','legacy_customer_id',{readOnly:true});put('location_account_number','account_number',{readOnly:true});put('address_id','parcel_id',{readOnly:true});
        data.customer_name=[raw.first_name,raw.last_name].filter(Boolean).join(' ');data.address=[raw.address_line1,raw.address_line2,raw.city,raw.zipcode].filter(Boolean).join(', ');
        put('email','email');put('phone',options.phoneField??'billing_phone');data.preference=[truth(raw.deliver_bill_email)?'Email':'',truth(raw.deliver_bill_mail)?'Mail':''].filter(Boolean).join(' / ');
        need(['initialized_balance','balance_current','net_due','gross_due'].includes(options.balanceField),'Select the exact opening-balance source field.');put('opening_balance',options.balanceField);data.opening_as_of=options.openingAsOf??'';date(data.opening_as_of,'Opening balance as-of date');
        data.status=raw.close_date?'Closed':'Source record';append(data,index,binding);
      }else if(dictionaryName==='bills'){
        const account=resolveAccount(raw.customer_id),service=resolveService(raw,account);put('bill_id','id',{readOnly:true});data.account_id=account.account_id;data.service_id=service.service_id;data.cycle=service.cycle;put('period_start','start_reading_date');put('period_end','end_reading_date');put('issue_date','bill_date');put('base_charge','base_charge');put('usage_charge','usage_charge');put('other_charge','extra_charge');put('total','amount');data.adjustments='';
        if(truth(raw.is_adjustment))errors.push('This native row is an adjustment bill. Retain it as an account adjustment or explicitly reviewed comparison input before adopting it as an ordinary period bill.');append(data,index,binding);
      }else if(dictionaryName==='payments'){
        const account=resolveAccount(raw.customer_id);need(options.provider&&typeof options.provider==='string','Name this original payment source provider.');
        data.provider=options.provider;put('transaction_id','id',{readOnly:true});data.account_id=account.account_id;put('amount','amount');data.currency='USD';data.kind=options.paymentTypeMap?.[raw.payment_type_id]??'';need(['payment','nsf','ach_return','chargeback','refund'].includes(data.kind),'Map native payment_type_id '+raw.payment_type_id+' to its reviewed transaction kind.');
        put('date','payment_date');put('bank_reference',options.bankReferenceField??'reference');put('batch_id','payment_post_batch_id',{readOnly:true});data.original_transaction_id=options.originalTransactionById?.[raw.id]??'';
        if(truth(raw.returned_payment)&&data.kind==='payment')errors.push('The native returned_payment flag conflicts with a normal payment mapping.');
        if(data.kind!=='payment'&&!data.original_transaction_id)errors.push('The return or refund needs the actual original transaction identity.');
        for(const flag of ['is_deposit','is_applied_deposit','is_write_off','is_tax','is_deposit_interest','is_discount','is_deferred','is_adjustment'])if(truth(raw[flag]))errors.push('Native '+flag+' requires separate reviewed ledger treatment; it is not automatically posted as an ordinary receipt.');
        append(data,index,binding);
      }else if(dictionaryName==='meter_readings'){
        if(raw.use_for_billing==='0'){excluded.push({record:index+1,nativeId:raw.id,reason:'The original use_for_billing flag is 0.'});continue;}
        need(raw.use_for_billing==='1'||options.includeUnmarkedReads===true,'Choose whether source reads without use_for_billing are included.');const meter=raw.meter_id?unique(metersByNative.has(raw.meter_id)?metersByNative:metersById,raw.meter_id,'Native meter_id '+raw.meter_id):null;need(meter,'The native reading has no meter identity.');
        if(raw.customer_id){const account=resolveAccount(raw.customer_id);need((servicesByAccount.get(account.account_id)??[]).some(s=>s.meter_id===meter.meter_id)||(tables.meter_history??[]).some(h=>h.meter_id===meter.meter_id&&(servicesByAccount.get(account.account_id)??[]).some(s=>s.service_id===h.service_id)),'The native customer does not own a retained service/meter assignment.');}
        need(raw.id,'Native reading ID is required.');for(const edge of ['start','end']){const value=raw[edge+'_reading'],at=raw[edge+'_reading_date'];if(value===''||value===undefined||!at){if(edge==='end')errors.push('The native end reading and timestamp are required.');continue;}const r=empty('readings');r.reading_id='muni-'+raw.id+'-'+edge;r.meter_id=meter.meter_id;r.read_at=nativeTime(at,options,'Native '+edge+' reading');r.kind=edge==='end'&&options.endReadKind==='final'?'final':'register';r.register=value;r.quality=truth(raw.estimated_reading)?'estimated':'actual';r.source_record=raw.id;r.reason=raw.note??'';append(r,index,{register:{column:edge+'_reading'},read_at:{column:edge+'_reading_date',type:'datetime'},source_record:{column:'id',readOnly:true}},edge);}
      }else{
        const meter=raw.meter_id?unique(metersByNative.has(raw.meter_id)?metersByNative:metersById,raw.meter_id,'Native meter_id '+raw.meter_id):null,service=resolveService(raw,null,meter);put('device_id','id',{readOnly:true});data.service_id=service.service_id;data.meter_id=meter?.meter_id??service.meter_id;data.status=raw.active==='1'?'Active inventory':raw.active==='0'?'Inactive inventory':'Source inventory';put('inspection_date','certificate_date');put('due_date','test_date_next');append(data,index,binding);
      }
    }catch(error){errors.push(error.message);if(!rowMap.some(r=>r.nativeRow===index+1))append(data,index,binding);}
    if(errors.length)findings.push({record:index+1,nativeId:raw.id??'',messages:errors});
  }
  return {kind,table:{headers:TABLES[kind].fields,rows},nativeHeaders:table.headers,rowMap,bindings,findings,excluded,sourceUrl:dictionary.source_url,options};
}
export function correctedMuniBilling({originalBytes,dataset,currentRows,tables,contracts}){
  need(dataset.nativeDictionary,'Select a dataset originally imported with its native MuniBilling dictionary.');const original=projectMuniBilling(originalBytes,{dictionary:dataset.nativeDictionary,format:dataset.nativeOriginalFormat,options:dataset.nativeOptions,tables,contracts}),table=parseTable(originalBytes,dataset.nativeOriginalFormat);
  need(original.table.rows.length===currentRows.length,'Native export must preserve the original projected row count.');const changed=[],writes=new Map();
  for(let i=0;i<currentRows.length;i++){const before=original.table.rows[i],after=currentRows[i],location=original.rowMap[i],binding=original.bindings[i];for(const key of TABLES[dataset.kind].fields){if((before[key]??'')===(after[key]??''))continue;const rule=binding[key];need(rule&&!rule.readOnly,'Corrected '+key+' in mapped row '+(i+1)+' is a derived or native identity field. Reimport the corrected original provider row to change it without guessing a native value.');
      let value=after[key]??'';if(rule.type==='datetime'){localDay(value,dataset.nativeOptions.timezone);const sourceValue=table.rows[location.nativeRow-1][rule.column],explicit=/(?:Z|[+-]\d{2}:\d{2})$/.test(sourceValue);need(explicit||value.endsWith(dataset.nativeOptions.utcOffset),'A corrected native datetime must use the retained source offset.');value=explicit?value:value.replace(/(?:Z|[+-]\d{2}:\d{2})$/,'');if(sourceValue.includes(' '))value=value.replace('T',' ');}
      const identity=json([location.nativeRow,rule.column]);need(!writes.has(identity)||writes.get(identity)===value,'Two mapped corrections disagree on one native provider field.');writes.set(identity,value);table.rows[location.nativeRow-1][rule.column]=value;changed.push({record:location.nativeRow,field:rule.column,canonical:key});
    }}
  const dictionary=contracts.dictionaries.find(d=>d.name===dataset.nativeDictionary);for(const [i,row]of table.rows.entries()){const findings=checkNative(row,dictionary);need(!findings.length,'Native output record '+(i+1)+': '+findings.join(' '));}
  const excluded=new Set(contracts.exclude_from_operational_presets),headers=table.headers.filter(k=>!excluded.has(k));need(headers.length,'No operational provider columns remain.');
  return {bytes:csv(table.rows,headers),manifest:{schema:'asheville.munibilling-corrected-export.v1',dictionary:dataset.nativeDictionary,sourceUrl:dictionary.source_url,originalSourceSha256:dataset.sourceSha256,datasetId:dataset.id,sourceRows:table.rows.length,columns:headers,changed,excludedCredentialColumns:table.headers.filter(k=>excluded.has(k)),scope:'The retained provider column names and source row order are preserved. Import acceptance depends on the receiving tenant’s selected File Format; no provider call is made.'}};
}
