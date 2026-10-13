/** Complete receiving journey on the supplied original five-station population.
 * Only explicitly labelled internal review decisions are authored. Reported
 * measurements, original source bytes, limits and station geography stay exact.
 */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {performance} from 'node:perf_hooks';
import {MeasurementWorkspace} from '../measurement_workspace/engine/workspace.mjs';
import {receiveCollection,collectionFromFiles} from '../measurement_workspace/engine/collections.mjs';
import {exportEdition,receiveArchive,editionMemberFile} from '../measurement_workspace/engine/large_delivery.mjs';
import {planReturnedReviews,reviewDecisionTemplate,incorporateReturnedReviews,readJSONLines} from '../measurement_workspace/engine/returned_reviews.mjs';
import {fileDigest,copyVerified,atomicJSON} from '../measurement_workspace/engine/large_io.mjs';import {hash} from '../measurement_workspace/engine/normalise.mjs';
const [originalArg,outputArg]=process.argv.slice(2);if(!originalArg||!outputArg)throw Error('Use original-review-directory new-output-directory');
const original=path.resolve(originalArg),root=path.resolve(outputArg);if(fs.existsSync(root))throw Error('Choose a new owned output directory');fs.mkdirSync(root,{recursive:true});
const read=file=>JSON.parse(fs.readFileSync(file,'utf8')),times={},start=performance.now();
async function step(name,fn){const t=performance.now();const result=await fn();times[name]=Number(((performance.now()-t)/1000).toFixed(3));console.log(JSON.stringify({stage:name,seconds:times[name]}));return result;}
let baseline,returned,current,incorporated,cold;
function review(w,id,state,reason,{actor='Internal workflow reviewer',selectVersion=false}={}){w.review(id,{state,reviewer:actor,reason:'INTERNAL WORKFLOW DEMONSTRATION — '+reason,selectVersion,expectedRevision:w.revision()});}
async function archive(w,name){const edition=await exportEdition(w,{id:hash('returned-review-five-station-'+name)});const file=path.join(root,'input-archives',name+'.zip');copyVerified(editionMemberFile(w,edition.id,'project.zip').file,file,edition.files.find(f=>f.path==='project.zip'));return file;}
try{
 baseline=new MeasurementWorkspace(path.join(root,'branches','baseline'));
 const sourceProject=read(path.join(original,'project.json'));
 await step('receive_original_five_station_project',()=>{baseline.receive(sourceProject);fs.copyFileSync(path.join(original,'native-reaches.json'),path.join(baseline.directory,'reaches.json'));return receiveCollection(baseline,collectionFromFiles(read(path.join(original,'collection.json')),path.join(original,'sources')));});
 const records=[...baseline.db.prepare('SELECT id,logical_key,data FROM records GROUP BY logical_key ORDER BY logical_key').iterate()];assert.equal(records.length,533);
 const [A,B,C,D,E,F]=records.slice(0,6).map(r=>r.id);const stations=[...baseline.db.prepare('SELECT id FROM stations ORDER BY id').iterate()].map(r=>r.id);
 // A selected baseline version lets the return exercise native selection clearing.
 review(baseline,A,'include','Exercise an explicitly selected original version before review return',{selectVersion:true});
 const archives={baseline:await step('complete_baseline_export',()=>archive(baseline,'baseline'))};
 returned=new MeasurementWorkspace(path.join(root,'branches','returned'));current=new MeasurementWorkspace(path.join(root,'branches','current'));
 receiveArchive(returned,archives.baseline);receiveArchive(current,archives.baseline);
 review(returned,A,'pending','Clear the prior source selection using the original native review action');
 review(returned,A,'include','Exercise an explicitly selected original version before review return');
 review(current,B,'exclude','Keep the scientist’s independent current decision',{actor:'Internal current scientist'});
 review(returned,C,'include','Returned choice for an overlapping measurement',{selectVersion:true});
 review(current,C,'exclude','Current choice for the same overlapping measurement',{actor:'Internal current scientist'});
 review(returned,D,'include','Equivalent choice retained in both editions',{actor:'Internal shared reviewer'});
 review(current,D,'include','Equivalent choice retained in both editions',{actor:'Internal shared reviewer'});
 review(returned,E,'exclude','Returned proposal which the scientist explicitly declines');
 review(current,E,'include','Retain the scientist’s current selected original',{actor:'Internal current scientist',selectVersion:true});
 review(returned,F,'pending','Return a reasoned pending decision without changing the reported value');
 returned.mapping(stations[0],{reachId:'',reviewer:'Internal workflow reviewer',reason:'INTERNAL WORKFLOW DEMONSTRATION — retain explicit unassigned domain; no drainage relation inferred'},[]);
 current.mapping(stations[1],{reachId:'',reviewer:'Internal current scientist',reason:'INTERNAL WORKFLOW DEMONSTRATION — preserve independent current station note'},[]);
 archives.returned=await step('complete_returned_export',()=>archive(returned,'returned'));archives.current=await step('complete_current_export',()=>archive(current,'current'));
 const inputBefore=Object.fromEntries(Object.entries(archives).map(([role,file])=>[role,fileDigest(file)]));
 const plan=await step('three_way_complete_population',()=>planReturnedReviews(archives,path.join(root,'comparison'),{title:'Five-station observations — returned review exercise'}));
 assert.equal(plan.counts.comparedGroups,533);assert.equal(plan.counts.conflict,2);assert.equal(plan.counts['apply-return'],3);assert.equal(plan.counts['already-current'],1);assert.equal(plan.counts['source-needed'],0);
 const changes=[...readJSONLines(path.join(root,'comparison','changes.jsonl'))];
 const keyFor=id=>records.find(r=>r.id===id).logical_key;
 const choices=reviewDecisionTemplate(path.join(root,'comparison'));choices.reviewer='Internal incorporating scientist';choices.reason='INTERNAL WORKFLOW DEMONSTRATION — incorporate the specified returned deltas while preserving unrelated current work';
 for(const item of choices.decisions)if(item.choice==='')item.choice=item.key===keyFor(C)?'return':'current';
 atomicJSON(path.join(root,'decisions.json'),choices);
 const result=await step('incorporate_original_native_edits_and_export',()=>incorporateReturnedReviews(path.join(root,'comparison'),choices,path.join(root,'incorporated')));
 incorporated=new MeasurementWorkspace(path.join(root,'incorporated','measurements'));
 assert.equal(incorporated.record(A).selectedVersion,null);assert.equal(incorporated.record(A).review.state,'include');
 assert.equal(incorporated.record(B).review.state,'exclude');assert.equal(incorporated.record(C).review.state,'include');assert.equal(incorporated.record(C).selectedVersion,C);
 assert.equal(incorporated.record(E).review.state,'include');assert.equal(incorporated.record(E).selectedVersion,E);
 assert.equal(incorporated.record(F).review.state,'pending');
 assert.equal(incorporated.db.prepare('SELECT COUNT(*) n FROM mappings').get().n,2);
 assert.equal(incorporated.db.prepare('SELECT COUNT(*) n FROM records').get().n,533);
 // Every original row (including raw original source fields) must be byte-identical.
 for(const source of sourceProject.tables.records)assert.equal(incorporated.db.prepare('SELECT data FROM records WHERE id=?').get(source.id).data,source.data);
 for(const source of sourceProject.tables.imports)assert.equal(incorporated.source(source.id).sha,source.sha);
 const zip=path.join(root,'incorporated','edition','project.zip');cold=new MeasurementWorkspace(path.join(root,'cold-received'));
 await step('independent_native_cold_receiving',()=>receiveArchive(cold,zip));
 for(const row of incorporated.db.prepare('SELECT id,data FROM records ORDER BY id').iterate())assert.equal(cold.db.prepare('SELECT data FROM records WHERE id=?').get(row.id).data,row.data);
 for(const row of incorporated.db.prepare('SELECT record_id,data FROM reviews ORDER BY record_id').iterate())assert.equal(cold.db.prepare('SELECT data FROM reviews WHERE record_id=?').get(row.record_id).data,row.data);
 assert.equal(cold.db.prepare('SELECT COUNT(*) n FROM records').get().n,533);
 const before=incorporated.revision();review(incorporated,F,'exclude','A later independent recipient edit must survive replay',{actor:'Internal independent recipient'});assert.equal(incorporated.revision(),before+1);
 const repeated=await incorporateReturnedReviews(path.join(root,'comparison'),choices,path.join(root,'incorporated'));assert.equal(repeated.alreadyCompleted,true);assert.equal(incorporated.record(F).review.state,'exclude');
 assert.equal(planReturnedReviews(archives,path.join(root,'comparison'),{title:plan.title}).reused,true);
 for(const [role,file]of Object.entries(archives))assert.deepEqual(fileDigest(file),inputBefore[role]);
 const censored=sourceProject.tables.records.filter(x=>JSON.parse(x.data).censor!=='none').length;
 const report={format:'upper-savannah-returned-review-journey/v1',population:'ORIGINAL-FIVE-STATION-OBSERVATIONS',reviewDecisions:'INTERNAL-WORKFLOW-DEMONSTRATION',recordCount:533,stationCount:5,sourceCount:5,censoredRecordCount:censored,originalProject:fileDigest(path.join(original,'project.json')),originalCollectionId:read(path.join(original,'review-package.json')).collectionId,planId:plan.id,counts:plan.counts,incorporation:result,sourceValueIdentity:'all533 original stored records byte-identical',originalSourceIdentity:'all5 original sources unchanged',nativeSelectionCleared:true,concurrentCurrentPreserved:true,conflictsExplicitlyResolved:true,coldReceivingCompleted:true,replayPreservedIndependentEdit:true,inputArchivesUnchanged:true,times,totalSeconds:Number(((performance.now()-start)/1000).toFixed(3)),peakRSSKiB:process.resourceUsage().maxRSS};
 atomicJSON(path.join(root,'journey.json'),report);console.log(JSON.stringify(report));
}finally{for(const w of [baseline,returned,current,incorporated,cold])if(w?.db?.isOpen)w.close();}
