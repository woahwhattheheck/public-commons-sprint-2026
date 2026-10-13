import {parseTable,sha256,selectedReview,selectedEdition,addEdition,freezeReview} from './source-table-workspace.mjs';
const stable=x=>JSON.stringify(x&&typeof x==='object'?(Array.isArray(x)?x.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(stable(x[k]))]))):x);
const clone=x=>JSON.parse(JSON.stringify(x)),fail=m=>{throw Error(m);};
export const INTAKE_SCHEMA='tjlabs.heritage-training-source-intake.v1';
function required(v,name){if(typeof v!=='string'||!v.trim())fail(name+' is required.');return v;}
export function mapSource(content,config,{HEADERS,DATA_TABLES}){
 if(!config||config.schema!==INTAKE_SCHEMA||!DATA_TABLES.includes(config.table)||config.table==='sources')fail('Choose a complete declared data-table intake mapping.');
 const parsed=parseTable(content,{delimiter:config.delimiter||',',header:true,skipEmptyRecords:config.skipEmptyRecords===true});
 if(new Set(parsed.headings).size!==parsed.headings.length)fail('Original source headings are duplicated; resolve the source selection explicitly.');
 const at=new Map(parsed.headings.map((x,i)=>[x,i])),column=name=>{if(!at.has(name))fail('Original source column is absent: '+name);return at.get(name);};
 if(!Array.isArray(config.keyColumns)||!config.keyColumns.length||new Set(config.keyColumns).size!==config.keyColumns.length)fail('Declare the original stable source key columns.');
 config.keyColumns.forEach(column);required(config.sourceId,'Original registered source ID');required(config.idPrefix,'Stable intake ID prefix');
 if(!/^[A-Za-z0-9_.:-]{1,60}$/.test(config.idPrefix))fail('Intake ID prefix uses ordinary record-ID characters.');
 if(!config.fieldMap||typeof config.fieldMap!=='object'||Array.isArray(config.fieldMap)||!config.constants||typeof config.constants!=='object'||Array.isArray(config.constants))fail('Declare both original fieldMap and explicit constants.');
 for(const [field,name] of Object.entries(config.fieldMap)){if(!HEADERS[config.table].includes(field)||['id','source_ids','source_id','origin_intake_id'].includes(field))fail('Mapped target field is invalid: '+field);column(name);}
 for(const [field,value] of Object.entries(config.constants)){if(!HEADERS[config.table].includes(field)||['id','source_ids','source_id','origin_intake_id'].includes(field)||typeof value!=='string'||Object.hasOwn(config.fieldMap,field))fail('Constant target field is invalid, duplicated or nontext: '+field);}
 const filters=config.filters||[];if(!Array.isArray(filters))fail('Selection filters must be explicit.');
 for(const f of filters){column(f.column);if(!['equals','one_of'].includes(f.operator)||!Array.isArray(f.values)||f.values.some(v=>typeof v!=='string')||!f.values.length||(f.operator==='equals'&&f.values.length!==1))fail('Use exact source-value equals or one_of filters.');}
 const ids=new Set(),selected=[];
 for(const record of parsed.rows){
 if(filters.some(f=>!f.values.includes(record.cells[column(f.column)])))continue;
 const key=config.keyColumns.map(k=>record.cells[column(k)]);if(key.some(x=>x===''))fail('Selected source key is blank at record '+record.record);const keyText=stable(key);if(ids.has(keyText))fail('Selected source key repeats at record '+record.record);ids.add(keyText);
 const row=Object.fromEntries(HEADERS[config.table].map(k=>[k,'']));
 Object.assign(row,config.constants);for(const [field,name] of Object.entries(config.fieldMap))row[field]=record.cells[column(name)];
 if(config.table==='coverage')row.source_id=config.sourceId;else row.source_ids=config.sourceId;row.id=config.idPrefix+':'+selected.length;
 if(config.table==='measures'){
 if(!config.measureValue||typeof config.measureValue.column!=='string'||!config.measureValue.statusTokens)fail('Measures require the exact source value column and explicit status-token contract.');
 const m=config.measureValue,token=record.cells[column(m.column)];row.original_token=token;
 if(Object.hasOwn(m.statusTokens,token)){const meaning=m.statusTokens[token];if(!meaning||typeof meaning.status!=='string')fail('Original status-token meaning is incomplete.');row.value_status=meaning.status;row.exact_value=meaning.value??'';row.rounding_base=meaning.roundingBase??'';}
 else{
 const normalized=m.thousandsSeparator?token.split(m.thousandsSeparator).join(''):token;
 if(!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(normalized))fail('Original numeric/status token is outside the declared contract at record '+record.record+': '+token);
 if(!['exact','rounded'].includes(m.numericStatus))fail('Declare whether numeric source values are exact or rounded.');
 row.value_status=m.numericStatus;row.exact_value=normalized;row.rounding_base=m.numericStatus==='rounded'?String(m.roundingBase??''):'';
 }
 }
 selected.push({row,sourceRecord:record.record,sourceLine:record.line,key});
 }
 if(!selected.length)fail('The explicit selection matched no source rows. Retain that coverage result separately rather than inventing a data record.');
 return {schema:INTAKE_SCHEMA,headings:parsed.headings,sourceRecords:parsed.sourceRecordCount,selectedRecords:selected.length,selection:clone(filters),rows:selected};
}
export async function deriveSource(content,config,contract){
 const result=mapSource(content,config,contract),intakeId='intake-'+await sha256(stable({sourceSha256:await sha256(content),configuration:config}));for(const item of result.rows){item.row.id=config.recordIds?.[stable(item.key)]||config.idPrefix+':'+(await sha256(stable(item.key))).slice(0,40);item.row.origin_intake_id=intakeId;}if(new Set(result.rows.map(x=>x.row.id)).size!==result.rows.length)fail('Explicit target record IDs collide within this source selection.');return result;
}
export async function receiveDataset(project,{filename,content,config},model){
 const {receiveResearch,rows,receiveTableEdition,csv,HEADERS,DATA_TABLES,documentFor}=model;const p=await receiveResearch(project);required(filename,'Original filename');required(content,'Original UTF-8 source');
 if(!rows(p,'sources').some(x=>x.id===config.sourceId))fail('Register the original source before dataset receiving.');
 const derived=await deriveSource(content,config,{HEADERS,DATA_TABLES}),current=rows(p,config.table),byId=new Map(current.map(r=>[r.id,r]));
 for(const item of derived.rows)byId.set(item.row.id,item.row);
 const originalDoc=documentFor(p,config.table),edition=await addEdition(p,originalDoc.id,{filename:selectedEdition(originalDoc).filename,sourceText:csv(HEADERS[config.table],[...byId.values()])}),next=(await freezeReview(edition.project,originalDoc.id)).project,d=documentFor(next,config.table),r=selectedReview(d);
 const sourceSha256=await sha256(content),configuration=clone(config),identity=await sha256(stable({sourceSha256,configuration})),id='intake-'+identity;
 const receipt={schema:INTAKE_SCHEMA,id,filename,sourceId:config.sourceId,content,sourceSha256,configuration,sourceRegister:((d,r)=>({documentId:d.id,reviewId:r.id,editionId:r.editionId,sourceSha256:r.sourceSha256,outputSha256:r.outputSha256}))(documentFor(p,'sources'),selectedReview(documentFor(p,'sources'))),sourceRecords:derived.sourceRecords,selectedRecords:derived.selectedRecords,originRows:derived.rows.map(x=>({id:x.row.id,sourceRecord:x.sourceRecord,sourceLine:x.sourceLine,key:x.key})),target:{table:config.table,documentId:d.id,reviewId:r.id,editionId:r.editionId,sourceSha256:r.sourceSha256,outputSha256:r.outputSha256},rows:derived.rows.map(x=>x.row),receivedAt:new Date().toISOString()};
 next.researchSourceIntakes=clone(p.researchSourceIntakes||[]);const existing=next.researchSourceIntakes.find(x=>x.id===id);
 if(existing){const a={...existing},b={...receipt};delete a.receivedAt;delete b.receivedAt;delete a.target;delete b.target;delete a.sourceRegister;delete b.sourceRegister;if(stable(a)!==stable(b))fail('Existing original intake identity differs.');}
 else next.researchSourceIntakes.push(receipt);
 return receiveResearch(next);
}
export async function validateSourceIntakes(project,{rows,documentFor,HEADERS,DATA_TABLES}){
 const intakes=project.researchSourceIntakes||[];if(!Array.isArray(intakes)||intakes.length>100)fail('Original source-intake history is malformed or exceeds100 selections.');const seen=new Set();
 for(const item of intakes){
 if(item.schema!==INTAKE_SCHEMA||seen.has(item.id)||typeof item.content!=='string'||typeof item.filename!=='string')fail('Original source intake is incomplete or repeated.');seen.add(item.id);
 const h=await sha256(item.content);if(h!==item.sourceSha256||item.id!=='intake-'+await sha256(stable({sourceSha256:h,configuration:item.configuration})))fail('Original intake source/configuration identity differs.');
 if(item.sourceId!==item.configuration.sourceId||!rows(project,'sources').some(x=>x.id===item.sourceId))fail('Original intake source register binding is absent.');
 const sr=item.sourceRegister,sd=documentFor(project,'sources'),srev=sd.reviews.find(x=>x.id===sr?.reviewId);if(!srev||sd.id!==sr.documentId||srev.editionId!==sr.editionId||srev.sourceSha256!==sr.sourceSha256||srev.outputSha256!==sr.outputSha256||!JSON.parse(srev.dataText).rows.some(x=>x.id===item.sourceId))fail('The original intake source-register edition is absent or differs.');
 const derived=await deriveSource(item.content,item.configuration,{HEADERS,DATA_TABLES}),target=item.target,d=documentFor(project,target.table),r=d.reviews.find(x=>x.id===target.reviewId);
 if(!r||d.id!==target.documentId||r.editionId!==target.editionId||r.sourceSha256!==target.sourceSha256||r.outputSha256!==target.outputSha256||target.table!==item.configuration.table)fail('Original intake target edition is absent or differs.');
 const old=JSON.parse(r.dataText).rows;
 if(derived.sourceRecords!==item.sourceRecords||derived.selectedRecords!==item.selectedRecords||stable(derived.rows.map(x=>x.row))!==stable(item.rows)||stable(derived.rows.map(x=>({id:x.row.id,sourceRecord:x.sourceRecord,sourceLine:x.sourceLine,key:x.key})))!==stable(item.originRows))fail('Original intake mapping no longer reproduces.');
 for(const row of item.rows)if(stable(old.find(x=>x.id===row.id))!==stable(row))fail('Original selected source row differs from its retained target edition.');
 }
 for(const table of DATA_TABLES){const d=documentFor(project,table);for(const review of d.reviews)for(const row of JSON.parse(review.dataText).rows)if(row.origin_intake_id){const original=intakes.find(x=>x.id===row.origin_intake_id);if(!original||original.configuration.table!==table||!original.rows.some(x=>stable(x)===stable(row)))fail('Original mapped row no longer matches its exact source-intake table and derived row. Clear provenance for a manual revision or receive the actual following source.');}}
 return project;
}
