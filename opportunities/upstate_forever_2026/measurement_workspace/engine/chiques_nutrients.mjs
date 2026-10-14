/** Source-specific receiving of the original USGS Chiques nutrient calibration tables.
 * This is a lossless, attributed projection into the maintained Measurements
 * parser and collection format. It does not fit a model or apply corrections.
 */
import {createHash} from 'node:crypto';
import {InputError,parseCSV,number} from './parse.mjs';
import {parseSource,hash,stable} from './normalise.mjs';
import {chiquesSourceHTML,chiquesSourceCSV} from './chiques_nutrient_reports.mjs';
export const CHIQUES_ADAPTER='upstate.chiques-nutrient-sources/v1';
export const CHIQUES_ITEM='65b170a2d34e36a39044c04d';
export const CHIQUES_STATION='USGS-01575900';
export const CHIQUES_CORRECTIONS='NitrateCorrectionsRef_01575900.xlsx';
const json=v=>JSON.stringify(v,null,2)+'\n';
const clone=v=>JSON.parse(JSON.stringify(v));
const need=(v,m)=>{if(!v)throw new InputError(m);};
const shaPattern=/^[a-f0-9]{64}$/;
const textNames=[
 '01575900_MASinput_lnTN.csv','01575900_MASinput_log10TP.csv',
 'README_ChiquesSedimentNutrientModels.txt','GEOREF_ChiquesSedimentNutrientModels.txt',
 'Schmer_ChiquesCreekSedimentNitrogenPhosphorusModels2023.xml','ScienceBase_item_original.json'
];
const roles={
 tn:[
  {column:'TN_mgL',log:'lnTN_mgL',transform:'ln',characteristic:'Total nitrogen',unit:'mg/L as N',fraction:'Total',clock:'sample_datetime',role:'laboratory-total-nitrogen'},
  {column:'NOx_mgLN',log:'lnNOx_mgLN',transform:'ln',characteristic:'Nitrate plus nitrite',unit:'mg/L as N',fraction:'',clock:'datetime',role:'continuous-nitrate-plus-nitrite'},
  {column:'Q_cfs',log:'lnQ_cfs',transform:'ln',characteristic:'Discharge',unit:'ft3/s',fraction:'',clock:'datetime',role:'continuous-discharge'}
 ],
 tp:[
  {column:'TP_mgL',log:'log10TP_mgL',transform:'log10',characteristic:'Total phosphorus',unit:'mg/L as P',fraction:'Total',clock:'sample_datetime',role:'laboratory-total-phosphorus'},
  {column:'TURB_FNU',log:'log10TURB_FNU',transform:'log10',characteristic:'Turbidity',unit:'FNU',fraction:'',clock:'datetime',role:'continuous-turbidity'},
  {column:'Q_cfs',log:'log10Q_cfs',transform:'log10',characteristic:'Discharge',unit:'ft3/s',fraction:'',clock:'datetime',role:'continuous-discharge'}
 ]
};
const metadata={
 title:'Chiques Creek nutrient calibration sources',
 station:CHIQUES_STATION,doi:'10.5066/P1HSE8TQ',
 sourceUrl:'https://www.sciencebase.gov/catalog/item/'+CHIQUES_ITEM,
 support:'Chiques Creek near Marietta, Pennsylvania, published 2021–2023 calibration samples; not Upper Savannah observations.',
 time:'The original README declares UTC. Laboratory TN/TP use sample_datetime; sensor NOx/turbidity/discharge use datetime, the publisher-selected nearest 15-minute observation. Neither clock is substituted for the other.',
 fractions:'TN and TP retain the explicitly total analytical quantity. NOx remains nitrate plus nitrite as N, with unspecified analytical fraction; it is not nitrate alone or total nitrogen.',
 corrections:'Published NOx values are received unchanged. The original nitrate-correction workbook is retained as evidence when supplied; this adapter never reapplies its corrections or claims to inspect its cells.',
 transforms:'Original ln and log10 columns remain source fields. Diagnostics compare each published transformed value to its corresponding original number; they never replace a source value or create an observed record.',
 sampling:'Rows sharing a date or sensor timestamp remain distinct original sample rows. No averaging, interpolation, censor substitution, hydrologic independence, model calibration or load estimation is performed.'
};
function safeName(name){
 need(typeof name==='string'&&name.length<=250&&!/[\/\\\x00-\x1f\x7f]/.test(name)&&name!=='.'&&name!=='..','Use an original filename without directories');
 return name;
}
function utc(text){
 need(typeof text==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text),'Keep the complete original Chiques UTC time');
 const iso=text.replace(' ','T')+'Z',date=new Date(iso);
 need(Number.isFinite(date.getTime())&&date.toISOString().replace('.000Z','Z')===iso,'Invalid original Chiques UTC time');
 return date.toISOString();
}
function csvExact(rows,fields){
 const q=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 return [fields.map(q).join(','),...rows.map(row=>fields.map(f=>q(row[f])).join(','))].join('\r\n')+'\r\n';
}
function canonicalBase64(text){
 need(typeof text==='string'&&text.length<=32*1024*1024&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text),'Use a complete canonical base64 original');
 const bytes=Buffer.from(text,'base64');need(bytes.toString('base64')===text,'Original binary encoding is not canonical');return bytes;
}
function sourceFiles(packet,attachments){
 need(packet?.schema==='commons.eco.original-source-transfer.v1'&&packet.sourceItem===CHIQUES_ITEM&&Array.isArray(packet.files),'Choose the complete retained Chiques original-source transfer');
 need(packet.files.length<=40&&Array.isArray(attachments)&&attachments.length<=10,'Too many original source members');
 const files=[],names=new Set();let total=0;
 for(const f of packet.files){
  const name=safeName(f.path);need(!names.has(name),'Duplicate original filename');names.add(name);
  need(typeof f.content==='string'&&shaPattern.test(f.sha256)&&Buffer.byteLength(f.content)===f.bytes&&hash(f.content)===f.sha256,'Original text identity differs: '+name);
  total+=f.bytes;need(total<=32*1024*1024,'Complete original sources exceed32MiB');
  files.push({name,bytes:f.bytes,sha256:f.sha256,text:f.content});
 }
 for(const name of textNames)need(names.has(name),'The full original source is missing '+name);
 const item=JSON.parse(files.find(f=>f.name==='ScienceBase_item_original.json').text);
 need(item.id===CHIQUES_ITEM&&Array.isArray(item.files)&&item.files.length>0,'Original ScienceBase item identity differs');
 const declared=new Map();
 for(const f of item.files){safeName(f.name);need(!declared.has(f.name),'Duplicate publisher filename');declared.set(f.name,f);}
 for(const f of attachments){
  const name=safeName(f.name);need(!names.has(name),'Duplicate original filename');names.add(name);
  const original=declared.get(name);need(original,'Attachment is not in the original publisher inventory: '+name);
  const bytes=canonicalBase64(f.base64);total+=bytes.length;need(total<=32*1024*1024,'Complete original sources exceed32MiB');
  if(f.bytes!==undefined)need(f.bytes===bytes.length,'Attachment byte count differs');
  if(f.sha256!==undefined)need(shaPattern.test(f.sha256)&&f.sha256===hash(bytes),'Attachment SHA256 differs');
  const textual=/\.(?:csv|txt|xml|json|html?)$/i.test(name);
  files.push({name,bytes:bytes.length,sha256:hash(bytes),...(textual?{text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}:{base64:f.base64})});
 }
 for(const f of files){
  const original=declared.get(f.name);if(!original)continue;
  need(original.size===f.bytes,'Original publisher byte count differs: '+f.name);
  need(original.checksum?.type==='MD5'&&/^[0-9a-f]{32}$/i.test(original.checksum.value),'Publisher MD5 is absent: '+f.name);
  const bytes=f.text===undefined?Buffer.from(f.base64,'base64'):Buffer.from(f.text,'utf8');
  const actual=createHash('md5').update(bytes).digest('hex');
  need(actual===original.checksum.value.toLowerCase(),'Original publisher MD5 differs: '+f.name);
  f.publisher={bytes:original.size,md5:original.checksum.value.toLowerCase(),url:original.url,dateUploaded:original.dateUploaded};
 }
 files.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
 const workbook=files.find(f=>f.name===CHIQUES_CORRECTIONS);
 const inventory=item.files.map(f=>({name:f.name,bytes:f.size,md5:f.checksum?.value||null,url:f.url,dateUploaded:f.dateUploaded,
  retained:files.some(v=>v.name===f.name),sha256:files.find(v=>v.name===f.name)?.sha256||null}));
 return {files,inventory,workbook:workbook?{name:workbook.name,bytes:workbook.bytes,sha256:workbook.sha256,md5:workbook.publisher.md5,status:'original-retained-unmodified',worksheetInterpretation:'not-performed'}:{name:CHIQUES_CORRECTIONS,status:'original-not-selected',worksheetInterpretation:'not-performed'},sourceItem:clone(item)};
}
function tableInput(file,kind,originals){
 const contextNames=new Set([...textNames.filter(name=>!name.endsWith('.csv')),file.name]);
 const contextFiles=originals.filter(f=>contextNames.has(f.name));
 const sourceIdentity=hash(stable(contextFiles.map(({name,bytes,sha256})=>({name,bytes,sha256}))));
 // This adapter edition binds original line numbers into retained event IDs.
 const parsed=parseCSV(file.text,{lineEndings:'legacy'});need(parsed.rejected.length===0,'An original table row has the wrong number of cells');
 const required=['datetime','sample_datetime','fines_percent','sand_percent','JulianDay','sin2piJD','cos2piJD',...roles[kind].flatMap(r=>[r.column,r.log])];
 need(required.every(h=>parsed.headers.includes(h)),'The selected '+kind.toUpperCase()+' table has a different original column contract');
 need(parsed.rows.length>0,'Original nutrient table is empty');
 const output=[],rows=[];
 for(const item of parsed.rows){
  const raw=item.raw,sensorAt=utc(raw.datetime),sampleAt=utc(raw.sample_datetime);
  const row={sourceFile:file.name,sourceSha256:file.sha256,line:item.line,sensorAt,sampleAt,deltaSeconds:(Date.parse(sensorAt)-Date.parse(sampleAt))/1000,raw:clone(raw),values:[]};
  for(const role of roles[kind]){
   const original=raw[role.column],value=number(original),transformed=number(raw[role.log]);
   let status='matches',expected=null;
   if(original==='')status=raw[role.log]===''?'both-missing':'transform-without-original';
   else if(value===null)status='original-not-plain-numeric';
   else if(value<=0)status='nonpositive-original';
   else{expected=role.transform==='ln'?Math.log(value):Math.log10(value);if(transformed===null)status='transformed-missing-or-nonnumeric';else if(Math.abs(transformed-expected)>1e-10*Math.max(1,Math.abs(expected)))status='differs';}
   row.values.push({column:role.column,characteristic:role.characteristic,unit:role.unit,role:role.role,clock:role.clock,sourceValue:original,value,transformColumn:role.log,transform:role.transform,publishedTransform:raw[role.log],expectedTransform:expected,status});
   const event=CHIQUES_ITEM+':'+file.name+':line'+item.line;
   output.push({stationId:CHIQUES_STATION,organization:'USGS',activityId:event,resultId:event+':'+role.column,
    sampledDate:(role.clock==='sample_datetime'?sampleAt:sensorAt).slice(0,10),sampledAt:role.clock==='sample_datetime'?sampleAt:sensorAt,timeZone:'UTC',
    characteristic:role.characteristic,value:original,unit:role.unit,fraction:role.fraction,
    status:'Published calibration source',medium:'Water',activityType:'Published calibration sample',valueType:'Published measurement',method:'',detection:'',qualifier:'',
    chiquesSourceFile:file.name,chiquesSourceSHA256:file.sha256,chiquesSourceContextSHA256:sourceIdentity,chiquesOriginalLine:String(item.line),chiquesOriginalColumn:role.column,chiquesRole:role.role,
    chiquesSampleTime:raw.sample_datetime,chiquesSensorTime:raw.datetime,chiquesClock:role.clock,chiquesOriginalRowJSON:JSON.stringify(raw),
    chiquesTransformedColumn:role.log,chiquesTransformedValue:raw[role.log],chiquesTransform:role.transform,
    notes:'Attributed source-table projection by '+CHIQUES_ADAPTER+'. Full original row/column and UTC clock are retained. Published source status requires explicit native review. Exact laboratory method/instrument model and hydrologic independence are not inferred.'});
  }
  rows.push(row);
 }
 const text=csvExact(output,Object.keys(output[0]));
 const mapping={_wqp_detection:'wqp-detection-conditions/v2',_wqp_characteristics:'wqp-characteristics/v2',
  station:'stationId',organization:'organization',activity:'activityId',result:'resultId',date:'sampledDate',datetime:'sampledAt',time:'',zone:'timeZone',
  characteristic:'characteristic',value:'value',unit:'unit',fraction:'fraction',status:'status',medium:'medium',activityType:'activityType',valueType:'valueType',
  method:'method',detection:'detection',qualifier:'qualifier',comment:'notes'};
 const origin={type:'source-preserving-calibration-projection',adapter:CHIQUES_ADAPTER,sourceItem:CHIQUES_ITEM,sourceIdentity,
  originalTable:{name:file.name,sha256:file.sha256,bytes:file.bytes},sourceURL:metadata.sourceUrl,
  pages:contextFiles.map(f=>({name:f.name,sha:f.sha256,bytes:f.bytes,text:f.text})),
  conventions:clone(metadata),projection:{rows:output.length,originalRows:rows.length,columns:roles[kind].map(r=>r.column),originalWQPSource:false}};
 const input={kind:'wqp',label:'Chiques01575900 '+kind.toUpperCase()+' calibration source — original row/column projection',text,mapping,origin};
 const native=parseSource({...input,lineEndings:'legacy'});need(native.rejected.length===0&&native.rows.length===output.length,'The maintained Measurements parser did not retain every projected cell');
 const sha256=hash(text),importId=hash(stable([input.kind,sha256,native.mapping]));
 return {kind,sourceFile:file.name,rows,summary:{originalRows:rows.length,projectedRows:output.length,missingValues:output.filter(v=>v.value==='').length,parameters:Object.fromEntries([...new Set(native.rows.map(x=>x.row.parameter))].map(k=>[k,native.rows.filter(x=>x.row.parameter===k).length])),transformDiagnostics:Object.fromEntries([...new Set(rows.flatMap(r=>r.values.map(v=>v.status)))].map(k=>[k,rows.flatMap(r=>r.values).filter(v=>v.status===k).length]))},input:{...input,mapping:native.mapping},sha256,importId,
  records:native.rows.map(({line,row})=>({id:hash(stable([row.sourceKind,row])),line,row}))};
}
export function prepareChiquesNutrients({sourcePacket,attachments=[]}={}){
 const source=sourceFiles(sourcePacket,attachments);
 const sourceIdentity=hash(stable({adapter:CHIQUES_ADAPTER,files:source.files.map(({name,bytes,sha256})=>({name,bytes,sha256})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)}));
 const tn=tableInput(source.files.find(f=>f.name==='01575900_MASinput_lnTN.csv'),'tn',source.files);
 const tp=tableInput(source.files.find(f=>f.name==='01575900_MASinput_log10TP.csv'),'tp',source.files);
 const report={schema:'upstate.chiques-nutrient-source-review/v1',adapter:CHIQUES_ADAPTER,sourceIdentity,metadata:clone(metadata),
  files:source.files.map(({text,base64,...f})=>f),publisherInventory:source.inventory,corrections:source.workbook,
  tables:[tn,tp].map(({input,records,...table})=>table),
  assessment:{measuredReview:'pending-original-Measurements-review',modelFitted:false,correctionsApplied:false,loadCalculated:false,
   missingPublisherFiles:source.inventory.filter(f=>!f.retained).map(f=>f.name),sourceFamilyIndependence:'The two tables share source families and repeated sensor values; distinct projected records are not independent replicates.'}};
 report.sha256=hash(stable(report));
 const files=source.files.map(f=>({path:'originals/'+f.name,kind:'companion',label:f.name,sha256:f.sha256,...(f.text===undefined?{base64:f.base64}:{text:f.text}),
  origin:{type:'publisher-original',sourceItem:CHIQUES_ITEM,...(f.publisher||{})}}));
 for(const table of [tn,tp])files.push({path:'projected/'+table.kind+'-measurements.csv',kind:'wqp',label:table.input.label,sha256:table.sha256,text:table.input.text,mapping:table.input.mapping,origin:table.input.origin});
 for(const [path,text] of [['nutrient-source-review.json',json(report)],['nutrient-source-diagnostics.csv',chiquesSourceCSV(report)],['nutrient-source-review.html',chiquesSourceHTML(report)]])files.push({path,kind:'companion',label:path,sha256:hash(text),text});
 return {schema:'upstate.chiques-nutrient-preparation/v1',adapter:CHIQUES_ADAPTER,sourceIdentity,report,
  collection:{format:'upper-savannah-measurement-collection/v1',title:metadata.title,files},
  imports:[tn,tp].map(t=>({kind:t.kind,id:t.importId,sha256:t.sha256,records:t.records.map(({id,line})=>({id,line})),rows:t.records.length}))};
}
/** Reconstruct selected originals, then re-run the maintained parser and identity checks.
 * Existing generic collection writer is the sole source/import mutation path.
 */
export function verifyChiquesPreparation(preparation){
 need(preparation?.schema==='upstate.chiques-nutrient-preparation/v1'&&preparation.adapter===CHIQUES_ADAPTER,'Choose a complete Chiques nutrient preparation');
 const files=preparation.collection?.files;need(Array.isArray(files),'Original collection is missing');
 const originals=files.filter(f=>f.path.startsWith('originals/'));
 const packet={schema:'commons.eco.original-source-transfer.v1',sourceItem:CHIQUES_ITEM,files:originals.filter(f=>f.text!==undefined).map(f=>({path:f.path.slice(10),content:f.text,bytes:Buffer.byteLength(f.text),sha256:f.sha256}))};
 const attachments=originals.filter(f=>f.base64!==undefined).map(f=>({name:f.path.slice(10),base64:f.base64,sha256:f.sha256}));
 const expected=prepareChiquesNutrients({sourcePacket:packet,attachments});
 need(stable(expected)===stable(preparation),'Prepared nutrient inputs differ from the full original source contract');
 return expected;
}
export function readChiquesImportedSources(workspace,preparation){
 const expected=verifyChiquesPreparation(preparation);
 return workspace.readConsistent(()=>{
  const imports=expected.imports.map(i=>{
   const source=workspace.source(i.id),file=expected.collection.files.find(f=>f.kind==='wqp'&&f.sha256===i.sha256);
   need(source.sha===i.sha256&&source.content===file.text&&stable(JSON.parse(source.mapping))===stable(file.mapping)&&stable(JSON.parse(source.origin))===stable(file.origin),'Retained nutrient import differs from the selected complete source');
   const records=i.records.map(({id})=>workspace.record(id));
   return {...i,records};
  });
  return {schema:'upstate.chiques-nutrient-received-view/v1',sourceIdentity:expected.sourceIdentity,workspaceRevision:workspace.revision(),report:expected.report,imports};
 });
}
