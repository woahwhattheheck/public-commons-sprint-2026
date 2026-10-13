/**
 * Source-preserving intake for the genuine USGS 07144100 published calibration
 * table. This is an explicit projection into the existing Measurements parser,
 * not a claim that USGS published WQP rows or supplied original sensor files.
 */
import {parseCSV,InputError} from '../engine/parse.mjs';
import {parseSource,hash,stable} from '../engine/normalise.mjs';
import {buildSedimentPairs,buildSedimentPredictionInput,sedimentObservationCatalogue} from '../engine/sediment_pairs.mjs';
export const REFERENCE_ADAPTER='upstate.usgs-07144100-calibration-intake/v1';
const need=(v,m)=>{if(!v)throw new InputError(m);};
const clone=v=>JSON.parse(JSON.stringify(v));
const schema='upstate.public-sediment-reference/v1';
const encoder=new TextEncoder();
function file(name,content,mediaType){return {name,mediaType,bytes:encoder.encode(content).length,sha256:hash(content),content};}
function exactCSV(rows,headers){const q=x=>'"'+String(x??'').replace(/"/g,'""')+'"';return headers.map(q).join(',')+'\r\n'+rows.map(r=>headers.map(h=>q(r[h])).join(',')).join('\r\n')+'\r\n';}
function fromSources(csv,provenance,extraction){
 need(typeof csv==='string'&&typeof provenance==='string'&&typeof extraction==='string','Keep all three complete original reference files as UTF-8 text');
 const meta=JSON.parse(provenance);need(meta.schema===schema&&meta.station==='07144100'&&meta.analyte==='SSC','Select the actual retained USGS07144100 SSC source');
 need(meta.csv_sha256===hash(csv),'Reference CSV differs from its retained provenance checksum');
 need(meta.sensor?.unit==='FNU'&&meta.sensor?.id==='YSI 6600 / 6136'&&meta.sensor?.method==='Optical turbidity, YSI model 6136','Reference sensor binding differs from the original source');
 need(meta.discharge_conversion?.factor===.028316846592&&meta.discharge_conversion?.to==='m3/s','Preserve the exact documented cfs conversion');
 const input=parseCSV(csv),headers=['published_row','sample_date','ssc_mg_L','turbidity_FNU','discharge_ft3_s'];
 need(stable(input.headers)===stable(headers)&&input.rejected.length===0&&input.rows.length===120,'Keep all120 published rows and their exact original columns');
 const seen=new Set();for(const {raw}of input.rows){const n=Number(raw.published_row);need(Number.isSafeInteger(n)&&n>=1&&n<=120&&!seen.has(n),'Published row identities must remain complete and distinct');seen.add(n);for(const key of headers.slice(2))need(/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw[key])&&Number.isFinite(Number(raw[key])),'Keep each printed nonnegative source numeric token');}
 const originals=[file('usgs_07144100_sediment_2004_2014.csv',csv,'text/csv'),file('usgs_07144100_sediment_2004_2014.json',provenance,'application/json'),file('usgs_07144100_sediment_table_extraction.txt',extraction,'text/plain')];
 const constants={stationId:{value:meta.station,basis:meta.source_url+'; model '+meta.model_id},organization:{value:'USGS published calibration reference',basis:'Source attribution; this is an authored interchange field, not a native WQP organization ID'},sensorId:{value:meta.sensor.id,basis:'Original published model archive sensor declaration'},sensorMethod:{value:meta.sensor.method,basis:'Original published model archive sensor declaration'},sedimentAnalyte:{value:'SSC',basis:'Original SSC mg/L column; never TSS'},sedimentMethod:{value:'Published SSC; laboratory protocol not stated in selected table',basis:'Unknown laboratory protocol remains explicit; complete publication extraction is retained'},dischargeMethod:{value:'Published concurrent discharge; instrument protocol not stated in selected table',basis:'Original Q ft3/s column; no instrument inferred'},datePrecision:{value:'date',basis:'Original table has no clock time or timezone'},status:{value:'Published calibration reference',basis:'Requires an explicit original native reviewer decision; not substituted Approved'},eventMeaning:{value:'sample',basis:'Numbered original table row gives concurrent values, not a hydrologic-event identity'}};
 const output=[];
 for(const item of input.rows)for(const role of ['sediment','turbidity','discharge']){
  const raw=item.raw,key={sediment:'ssc_mg_L',turbidity:'turbidity_FNU',discharge:'discharge_ft3_s'}[role],event=meta.model_id+':published-row:'+raw.published_row;
  output.push({...raw,stationId:meta.station,organization:constants.organization.value,activityId:event,resultId:event+':'+role,sampledDate:raw.sample_date,sampledAt:'',timeZone:'',characteristic:{sediment:'Suspended sediment concentration',turbidity:'Turbidity',discharge:'Discharge'}[role],value:raw[key],unit:{sediment:'mg/L',turbidity:'FNU',discharge:'ft3/s'}[role],method:role==='turbidity'?meta.sensor.method:constants[role+'Method'].value,sensorId:role==='turbidity'?meta.sensor.id:'',analyte:role==='sediment'?'SSC':'',status:constants.status.value,medium:'Water',activityType:'Published environmental calibration sample',valueType:'Published measurement',fraction:'',detection:'',qualifier:'',referenceRole:role,referenceColumn:key,referenceOriginalLine:String(item.line),referenceOriginalRow:raw.published_row,referenceSourceURL:meta.source_url,referenceCSV_SHA256:originals[0].sha256,referenceMetadata_SHA256:originals[1].sha256,referenceExtraction_SHA256:originals[2].sha256,notes:'Authored long-table interchange from original published row '+raw.published_row+', column '+key+'. Full original CSV/provenance/table text retained. Unknown clock time, timezone, laboratory protocol and hydrologic event are not inferred.'});
 }
 const text=exactCSV(output,Object.keys(output[0])),mapping={_wqp_detection:'wqp-detection-conditions/v2',station:'stationId',organization:'organization',activity:'activityId',result:'resultId',date:'sampledDate',datetime:'sampledAt',time:'',zone:'timeZone',characteristic:'characteristic',value:'value',unit:'unit',detection:'detection',qualifier:'qualifier',fraction:'fraction',status:'status',valueType:'valueType',medium:'medium',activityType:'activityType',method:'method',laboratory:'',pcode:'',name:'',latitude:'',longitude:'',datum:'',comment:'notes'};
 const origin={type:'source-preserving-reference-projection',adapter:REFERENCE_ADAPTER,sourceUrl:meta.source_url,sourceMetadata:meta,constants,pages:originals.map(x=>({name:x.name,mediaType:x.mediaType,bytes:x.bytes,sha:x.sha256,text:x.content})),projection:{originalRows:120,rows:360,identity:'Original publication model + published row + original value column',pairing:'Explicit same published sample row; repeated dates remain separate',eventMeaning:'sample; hydrologic independence unassessed',sourceQC:'Published-reference status requires an explicit native review',originalWQPSource:false}};
 return {originals,metadata:meta,constants,input:{kind:'wqp',label:'USGS07144100 published120-sample sediment calibration (explicit360-row source projection)',text,mapping,origin}};
}
function views(input){
 const parsed=parseSource(input);need(parsed.rows.length===360&&parsed.rejected.length===0,'The unchanged native parser must retain all360 projected observations');
 const sha=hash(input.text),id=hash(stable([input.kind,sha,parsed.mapping]));
 const rows=parsed.rows.map(({row,line})=>{const recordId=hash(stable([row.sourceKind,row]));return {...row,id:recordId,review:{state:'pending'},selectedVersion:null,variants:[recordId],variantCount:1,sources:[{id,sha,label:input.label,source_line:line}]};});
 return {rows,importId:id,contentSha:sha,mapping:parsed.mapping};
}
function channel(role,sourceId){
 const b=path=>({path}),fields={value:b('/reportedValue'),unit:b('/reportedUnit'),siteId:b('/stationId'),method:b('/method'),sensorId:role==='turbidity'?b('/raw/sensorId'):null,analyte:role==='sediment'?b('/raw/analyte'):null,sampledDate:b('/sampledDate'),sampledAt:b('/sampledAt'),timeZone:b('/timeZone'),eventId:b('/activityId'),censor:b('/censor'),qualifier:b('/qualifier'),detection:b('/detection')};
 return {sourceIds:[sourceId],recordIds:null,filters:[{path:'/raw/referenceRole',equals:role}],fields,rationale:'Explicit original USGS07144100 published table '+role+' column, with complete originals, constants and row/column correspondence retained by '+REFERENCE_ADAPTER+'.'};
}
export function prepareSedimentReference({csv,provenance,extraction,reviewer,reason}){
 need(typeof reviewer==='string'&&reviewer.trim()&&reviewer.length<=4000&&typeof reason==='string'&&reason.trim()&&reason.length<=8000,'Select the actual source reviewer and their reason; review is not inferred from preparation');
 const prepared=fromSources(csv,provenance,extraction),native=views(prepared.input),selection={schema:'upstate.sediment-selection/v1',source_ids:[native.importId],siteId:prepared.metadata.station,target:'SSC',sensor:clone(prepared.metadata.sensor),from:null,to:null,channels:{sediment:channel('sediment',native.importId),turbidity:channel('turbidity',native.importId),discharge:channel('discharge',native.importId)},pairing:{mode:'same-event',maxDeltaSeconds:null,allowDateOnlySameEvent:true,eventMeaning:'sample'},choices:[],rationale:'Reproduce the genuine published120-row USGS model archive table at printed precision. Each numbered source row supplies concurrent SSC, FNU turbidity and Q. Dates remain dates; different samples sharing a date remain distinct; storm independence is unknown.'};
 const catalog=sedimentObservationCatalogue(native.rows,selection),byRole=Object.fromEntries(Object.entries(catalog.observations).map(([role,list])=>[role,new Map(list.map(x=>[x.eventSourceValue,x]))]));
 selection.choices=catalog.observations.sediment.map(s=>({sampleId:s.id,action:'select',turbidityId:byRole.turbidity.get(s.eventSourceValue).id,dischargeId:byRole.discharge.get(s.eventSourceValue).id,reason:'Exact concurrent columns of original published sample '+s.eventSourceValue+'; no matching by shared date.'}));
 const pairing=buildSedimentPairs(native.rows,selection),base={form:'log-log',includeDischarge:true,confidence:.95,rationale:'Genuine published table at printed precision, explicit SSC/FNU/YSI6136/source-row pairing; unknown hydrologic grouping retained.'};
 const calibration={...base,validationMode:'held-out',cohorts:pairing.rows.map(row=>({pairId:row.id,role:'train',reason:'All120 published samples selected for calibration reproduction; no independent validation claim.'}))};
 const temporal={...base,validationMode:'temporal',cohorts:pairing.rows.map(row=>({pairId:row.id,role:row.sampledDate<'2012-01-01'?'train':'validate',reason:'Explicit new calendar-date holdout at2012-01-01; not the original author cross-validation or new monitoring observations.'}))};
 return {schema:'upstate.sediment-reference-preparation/v1',adapter:REFERENCE_ADAPTER,...prepared,importIdentity:{id:native.importId,sha256:native.contentSha,rows:360},selection,modelSelections:{calibration,temporal},reviewRequests:native.rows.map(row=>({recordId:row.id,input:{state:'include',reviewer,reason,selectVersion:false}})),reviewRequired:true,pairingBeforeNativeReview:pairing,receiving:{sequence:['Retain all three exact originals and this complete preparation.','Import input through the unchanged original MeasurementWorkspace.import.','Inspect every source row; apply each explicit reviewRequest through original MeasurementWorkspace.review with the current workspace revision only after the named reviewer confirms that source.','Capture complete actual w.record views and rebuild buildSedimentPairs(rows,selection).','Select calibration or temporal modelSelections deliberately and call the maintained scientific core.','Save the complete named study through the original Measurements study service; export the whole workspace, receive it independently and compare complete outputs.'],warning:'Preparation does not create native include reviews or fitted results. Table120 omits seven samples previously removed by the original author; their full values are unavailable here. This is a public methodological reference, not Upper Savannah observations.'}};
}
export function verifySedimentReferenceImport(input){
 const origin=input?.origin;need(origin?.adapter===REFERENCE_ADAPTER&&Array.isArray(origin.pages)&&origin.pages.length===3,'Keep the complete reference adapter source declaration');
 const expectedNames=['usgs_07144100_sediment_2004_2014.csv','usgs_07144100_sediment_2004_2014.json','usgs_07144100_sediment_table_extraction.txt'];
 for(let i=0;i<3;i++){const p=origin.pages[i];need(p.name===expectedNames[i]&&typeof p.text==='string'&&hash(p.text)===p.sha&&encoder.encode(p.text).length===p.bytes,'Original reference attachment identity differs');}
 const recreated=fromSources(origin.pages[0].text,origin.pages[1].text,origin.pages[2].text).input;
 need(input.kind===recreated.kind&&input.text===recreated.text&&stable(input.mapping)===stable(recreated.mapping)&&stable(origin)===stable(recreated.origin),'The reference projection differs from its complete original source and declared adapter');
 return {schema:'upstate.sediment-reference-verification/v1',adapter:REFERENCE_ADAPTER,sourceSha256:hash(input.text),originals:origin.pages.map(({text,...d})=>clone(d)),originalRows:120,projectedRows:360};
}

/**
 * Rebuild the full source-bound science inputs from actual complete record views.
 * This never creates review decisions. A source-only exercise must label any
 * authored review contexts at its caller; a native study passes actual w.record.
 */
export function buildSedimentReferenceInputs(preparation,records){
 need(preparation?.schema==='upstate.sediment-reference-preparation/v1','Use the complete retained reference preparation');
 verifySedimentReferenceImport(preparation.input);
 const expected=views(preparation.input),actual=new Map();
 need(Array.isArray(records)&&records.length===360,'Keep every original projected record');
 for(const row of records){need(row&&typeof row.id==='string'&&!actual.has(row.id),'Reference record identity is duplicated');actual.set(row.id,row);}
 for(const row of expected.rows){
  const current=actual.get(row.id);need(current,'Reference record is missing');
  // Strip only maintained workspace context; canonical source values stay exact.
  const source={...current};for(const k of ['id','review','selectedVersion','variants','variantCount','sources','mapping','eligible','history'])delete source[k];
  need(hash(stable([source.sourceKind,source]))===row.id,'Reference canonical source record differs');
  need(Array.isArray(current.sources)&&current.sources.some(x=>x.id===expected.importId&&x.sha===expected.contentSha),'Reference record lost its original source binding');
 }
 const selection=clone(preparation.selection);
 need(selection.source_ids.length===1&&selection.source_ids[0]===expected.importId,'Reference selection must bind its original import');
 const pairing=buildSedimentPairs(records,selection);
 const later=pairing.observations.turbidity.filter(x=>x.sampledDate>='2012-01-01'),q=new Map(pairing.observations.discharge.map(x=>[x.eventSourceValue,x]));
 const deployment={schema:'upstate.sediment-deployment/v1',source_ids:[expected.importId],from:'2012-01-01',to:null,channels:{turbidity:clone(selection.channels.turbidity),discharge:clone(selection.channels.discharge)},pairing:clone(selection.pairing),choices:later.map(t=>({turbidityId:t.id,dischargeId:q.get(t.eventSourceValue)?.id||null,reason:'The concurrent discharge and turbidity columns of the exact later published sample row.'})),extrapolation:'block',rationale:'Use all52 original later-date surrogate observations to demonstrate both explicit deployment-range policies against the68-sample temporal training model. These remain held-out published data, not new live monitoring.'};
 deployment.channels.turbidity.recordIds=later.map(x=>x.recordId);
 deployment.channels.discharge.recordIds=later.map(x=>q.get(x.eventSourceValue).recordId);
 const flag={...clone(deployment),extrapolation:'flag'};
 const predictionBlock=buildSedimentPredictionInput(records,deployment,pairing),predictionFlag=buildSedimentPredictionInput(records,flag,pairing);
 return {schema:'upstate.sediment-reference-inputs/v1',pairing,fullModel:clone(preparation.modelSelections.calibration),temporalModel:clone(preparation.modelSelections.temporal),predictionBlock,predictionFlag,deploymentSelections:{block:deployment,flag},source:clone(preparation.originals),provenance:clone(preparation.metadata),reviewContexts:records.map(row=>({recordId:row.id,review:clone(row.review),selectedVersion:row.selectedVersion,variants:clone(row.variants)}))};
}

/**
 * Optional native caller join. The caller supplies its already-owned original
 * MeasurementWorkspace; this function opens no database, process, or controller.
 * Review mutation is explicitly opt-in and never replaces an existing decision.
 */
export function importSedimentReference(workspace,preparation,{applyReviews=false}={}){
 need(typeof applyReviews==='boolean','Choose whether the named original source review is being applied');
 need(workspace&&['import','source','record','review','revision','readConsistent'].every(k=>typeof workspace[k]==='function'),'Use the already-owned original MeasurementWorkspace');
 need(preparation?.schema==='upstate.sediment-reference-preparation/v1','Use the complete preparation');
 verifySedimentReferenceImport(preparation.input);
 const parsed=views(preparation.input),requests=preparation.reviewRequests;
 need(Array.isArray(requests)&&requests.length===360&&new Set(requests.map(x=>x.recordId)).size===360,'Keep the complete explicit source review requests');
 const selected=new Set(parsed.rows.map(x=>x.id));
 for(const q of requests){
  need(q&&selected.has(q.recordId)&&q.input?.state==='include'&&q.input.selectVersion===false&&typeof q.input.reviewer==='string'&&q.input.reviewer.trim()&&typeof q.input.reason==='string'&&q.input.reason.trim(),'Retain the explicit original source-review attribution and decision');
  need(Object.keys(q.input).sort().join(',')==='reason,reviewer,selectVersion,state','Do not inject undeclared review command fields');
 }
 const imported=workspace.import({...clone(preparation.input),contentSha:parsed.contentSha});
 need(imported.id===parsed.importId,'Native import identity differs');
 const source=workspace.source(imported.id),origin=typeof source.origin==='string'?JSON.parse(source.origin):source.origin,mapping=typeof source.mapping==='string'?JSON.parse(source.mapping):source.mapping;
 verifySedimentReferenceImport({kind:source.kind,text:source.content,mapping,origin});
 need(source.sha===parsed.contentSha,'Native original source checksum differs');
 let applied=0;const retained=[];
 if(applyReviews)for(const q of requests){
  const current=workspace.readConsistent(()=>({revision:workspace.revision(),record:workspace.record(q.recordId)}));
  if(current.record.review.state==='pending'){
   // The original CAS runs inside the existing native transaction and catches
   // any intervening source/review change; an interrupted call can be re-entered.
   workspace.review(q.recordId,{...clone(q.input),expectedRevision:current.revision});applied++;
  }else retained.push({recordId:q.recordId,review:clone(current.record.review)});
 }
 const current=workspace.readConsistent(()=>({revision:workspace.revision(),records:parsed.rows.map(row=>workspace.record(row.id))}));
 const inputs=buildSedimentReferenceInputs(preparation,current.records);
 return {schema:'upstate.sediment-reference-native-intake/v1',import:clone(imported),workspaceRevision:current.revision,reviewActions:{requested:applyReviews,applied,retainedExisting:retained},completeSourceReview:inputs.pairing.rows.every(row=>row.issues.length===0),inputs};
}
