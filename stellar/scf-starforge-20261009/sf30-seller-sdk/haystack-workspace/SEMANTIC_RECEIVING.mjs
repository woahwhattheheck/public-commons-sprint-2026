#!/usr/bin/env node
// MIT. One retained source-to-model-to-contractor-receiving operation.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve, join, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { startServer } from "./server.mjs";
import { HaystackWorkspace } from "./store.mjs";
import { HaystackClient } from "./client.mjs";
import { APPLICATION_FILES, verifyBundle, receiveBundle } from "./portable.mjs";
import { actions } from "./catalog.mjs";
import { parseGrid } from "./haystack-types.mjs";
import { stringifyJson, canonicalJson } from "./json-codec.mjs";
import { atomicWrite, createOnlyFile, plainRead, exists } from "./files.mjs";
import { runSemanticBrowser } from "./SEMANTIC_BROWSER.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FORMAT = "commons.haystack.semantic-operating.v1";
const INPUT_FORMAT = "commons.haystack.semantic-operating-input.v1";
const SOURCE_SHA = "c44a410c183f9ef9add5757955637d1ce0bad0dabf418f80e6b9a7b4a2b9afe9";
const SOURCE_URL = "https://project-haystack.org/example/download/charlie.json";
const BRICK = "https://brickschema.org/schema/Brick#";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const encoded = value => Buffer.from(stringifyJson(value, 2) + "\n");
const at = () => new Date().toISOString();
const same = (left, right, message) => assert.equal(canonicalJson(left), canonicalJson(right), message);
const outcome = value => { const copy = structuredClone(value); delete copy.replayed; return copy; };
const readJson = async path => JSON.parse(await plainRead(path));
const saveJson = (path, value) => atomicWrite(path, encoded(value));
async function completeFile(path, bytes) {
  bytes = Buffer.from(bytes); await fs.mkdir(dirname(path), {recursive:true, mode:0o700});
  if (await exists(path)) assert((await plainRead(path, bytes.length)).equals(bytes), "Retain exact completed bytes: " + path);
  else await createOnlyFile(path, bytes);
  return {path, bytes:bytes.length, sha256:sha(bytes)};
}
const completeJson = (path, value) => completeFile(path, encoded(value));
async function verifiedFile(file) {
  const bytes = await plainRead(file.path);
  assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256); return bytes;
}
async function nativeCommand(args, input = "") {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {stdio:["pipe","pipe","pipe"]});
    const stdout = [], stderr = []; let total = 0, overflow = false, killTimer;
    const stop = () => { child.kill("SIGTERM"); if (!killTimer) killTimer=setTimeout(()=>child.kill("SIGKILL"),10000); };
    const collect = output => bytes => {
      total += bytes.length;
      if (total > 32 * 1024 * 1024) { overflow = true; stop(); } else output.push(bytes);
    };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.once("error", error => { if(killTimer)clearTimeout(killTimer);fail(error); });
    child.stdin.on("error",error=>{ if(error.code!=="EPIPE")stop(); });
    child.once("close", (code, signal) => {
      if(killTimer)clearTimeout(killTimer);
      const result = {args, code, signal, stdout:Buffer.concat(stdout).toString("utf8"), stderr:Buffer.concat(stderr).toString("utf8")};
      if (overflow || code !== 0) fail(Object.assign(new Error("The original native operator command did not complete."), {result}));
      else done(result);
    });
    child.stdin.end(input);
  });
}
function sourceTable(rows, sourceId, delimiter) {
  // This writes a clearly identified source-derived programme input. The actual
  // CSV/TSV parser is the maintained Python adapter, never this writer.
  const headings = ["recordKey","nativeId","name","name","kind","equipRef","siteRef","unit"];
  const cells = rows.map((row,index) => [sourceId + ":" + index, row.id?.val || "", row.dis || "", row.dis || "",
    row.point ? "point" : row.equip ? "equip" : row.site ? "site" : "other",
    row.equipRef?.val || "", row.siteRef?.val || "", row.unit || ""]);
  const quote = value => '"' + String(value).replaceAll('"','""') + '"';
  return Buffer.from([headings,...cells].map(row=>row.map(quote).join(delimiter)).join("\r\n")+"\r\n");
}
function modelDecisions(preview, accepted = new Set()) {
  return preview.models.map(row => ({modelId:row.modelId, decision:accepted.has(row.modelId)?"adopt":"keep",
    expectedLocalHeadId:row.localHeadId, expectedIncomingHeadId:row.incomingHeadId}));
}
function countState(state) {
  const s = state.semantics;
  return {revision:state.revision, sources:state.sources.length, operations:state.operations.length,
    intakes:s?.intakes.length||0, models:s?.models.length||0, contexts:s?.contexts.length||0,
    versions:s?.versions.length||0, validations:s?.validations.length||0, reviews:s?.reviews.length||0, returns:s?.returns.length||0};
}
export async function main(inputPath) {
  assert(isAbsolute(inputPath), "Supply the complete original input JSON path.");
  const inputBytes = await plainRead(inputPath, 1024 * 1024), input = JSON.parse(inputBytes);
  assert.equal(input.schema, INPUT_FORMAT);
  assert.equal(input.operationId, "SCF-HAYSTACK-POINT-MODELLING-B3909-20261012");
  assert(isAbsolute(input.root) && isAbsolute(input.nativePython));
  assert(isAbsolute(input.browser?.playwrightModule) && isAbsolute(input.browser?.executablePath));
  const root = resolve(input.root), outputs = join(root,"outputs"), requests = join(root,"requests");
  for (const directory of [root,outputs,requests]) {
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const stat=await fs.lstat(directory); assert(stat.isDirectory()&&!stat.isSymbolicLink());
  }
  process.env.HAYSTACK_SEMANTIC_PYTHON = input.nativePython;
  const originalBytes = await plainRead(join(ROOT,"fixture-charlie.json"),32*1024*1024);
  assert.equal(originalBytes.length,257776);assert.equal(sha(originalBytes),SOURCE_SHA);
  const decoded=parseGrid(originalBytes,{format:"json-v4"});
  assert.equal(decoded.grid.rows.length,624);assert.equal(decoded.grid.cols.length,87);
  const application=[];
  for(const name of APPLICATION_FILES){const bytes=await plainRead(join(ROOT,name),8*1024*1024);application.push({name,bytes:bytes.length,sha256:sha(bytes)});}
  assert.equal(application.length,62);
  const workspaceDirectory=join(root,"workspace"), workspace=new HaystackWorkspace(workspaceDirectory);
  const initial=await workspace.initialize("Charlie building — point-list modelling");
  const journalPath=join(root,"semantic-programme.json");
  let journal;
  if(await exists(journalPath)){
    journal=await readJson(journalPath);assert.equal(journal.format,FORMAT);assert.equal(journal.operationId,input.operationId);
    assert.equal(journal.inputSha256,sha(inputBytes));assert.equal(journal.directory,root);assert.equal(journal.workspaceId,initial.workspaceId);
    same(journal.application,application,"Continue the same complete selected application source.");
  }else{
    journal={format:FORMAT,operationId:input.operationId,inputSha256:sha(inputBytes),directory:root,workspaceId:initial.workspaceId,
      startedAt:at(),application,source:{url:SOURCE_URL,sha256:SOURCE_SHA,bytes:originalBytes.length,rows:624,columns:87},stages:{},state:"CONTINUING"};
    await saveJson(journalPath,journal);
  }
  await completeFile(join(root,"original-input.json"),inputBytes);
  await completeFile(join(outputs,"originals","charlie.json"),originalBytes);
  if(journal.state==="COMPLETE"){
    const result=await readJson(join(root,"complete-result.json"));
    assert.equal(result.operationId,journal.operationId);assert.equal(result.workspaceId,journal.workspaceId);
    for(const file of Object.values(result.deliveries))await verifiedFile(file.file);
    await verifiedFile(result.browser.file);
    process.stdout.write(stringifyJson({completed:true,replayed:true,operationId:journal.operationId,result:join(root,"complete-result.json")})+"\n");
    return result;
  }
  let server=null,recipient=null,cold=null,client=null,recipientClient=null;
  async function closeTracked(){
    const errors=[];
    for(const[name,host]of[["received",cold],["contractor",recipient],["original",server]]){
      if(!host)continue;
      try{await host.close();if(name==="received")cold=null;else if(name==="contractor")recipient=null;else server=null;}
      catch(error){errors.push({host:name,message:error.message,code:error.code||null});}
    }
    if(errors.length)throw Object.assign(new Error("One or more original workspace servers did not close successfully."),{code:"HAYSTACK_SEMANTIC_PROGRAMME_CLOSE",details:{errors}});
  }
  const status=client=>client.request("workspace.status",{});
  const model=async(client,modelId)=>client.request("semantic.model.read",{expectedRevision:(await status(client)).revision,modelId});
  async function pages(client,action,fields={}){
    const rows=[],revision=(await status(client)).revision;
    for await(const page of client.pages(action,{...fields,expectedRevision:revision,limit:137}))rows.push(...page.items);
    return rows;
  }
  async function step(name,fn){
    if(Object.hasOwn(journal.stages,name))return structuredClone(journal.stages[name]);
    const value=await fn();journal.stages[name]=value;await saveJson(journalPath,journal);
    process.stdout.write(stringifyJson({operationId:journal.operationId,completedStage:name,at:at()})+"\n");
    return structuredClone(value);
  }
  async function observe(name,fn){
    const path=join(outputs,name+".json");if(await exists(path))return readJson(path);
    const value=await fn();await completeJson(path,value);return value;
  }
  async function requestFor(name,target,action,supply){
    assert(/^[a-z0-9-]+$/.test(name));const path=join(requests,name+".request.json");
    if(await exists(path)){const original=await readJson(path);assert.equal(original.action,action);assert.equal(original.workspaceId,journal.workspaceId);return original;}
    const fields=typeof supply==="function"?await supply():supply;
    assert(!Object.hasOwn(fields,"operationId")&&!Object.hasOwn(fields,"expectedRevision"));
    const original={format:"commons.haystack.semantic-programme-request.v1",programmeOperationId:journal.operationId,workspaceId:journal.workspaceId,
      action,args:{...structuredClone(fields),expectedRevision:(await status(target)).revision,operationId:randomUUID()}};
    await completeJson(path,original);return original;
  }
  async function originalOutcome(target,operationId){
    try{return await target.request("operation.read",{operationId});}
    catch(error){if(error.code==="HAYSTACK_OPERATION_MISSING"&&error.status===404)return null;throw error;}
  }
  async function mutation(name,target,action,supply,{loseResponse=false}={}){
    const original=await requestFor(name,target,action,supply),receiptPath=join(requests,name+".outcome.json");
    let receipt=await originalOutcome(target,original.args.operationId);
    if(!receipt){
      if(loseResponse){
        const normal=target.fetcher,lossPath=join(requests,name+".lost-response.json");
        assert(!(await exists(lossPath)),"An accepted lost response must reconcile its original operation.");
        target.fetcher=async(url,options)=>{
          const response=await normal(url,options);
          if(String(url).endsWith("/api/action")&&response.ok&&JSON.parse(options.body).args?.operationId===original.args.operationId){
            const bytes=Buffer.from(await response.arrayBuffer());
            await completeJson(lossPath,{operationId:original.args.operationId,responseStatus:response.status,responseSha256:sha(bytes),response:JSON.parse(bytes),receivedAt:at()});
            throw new Error("The programme deliberately loses this fully accepted response.");
          }
          return response;
        };
        try{await assert.rejects(()=>target.request(action,original.args),error=>error.code==="HAYSTACK_TRANSPORT"&&error.outcomeUnknown);}
        finally{target.fetcher=normal;}
        receipt=await originalOutcome(target,original.args.operationId);assert(receipt);
      }else receipt=await target.request(action,original.args);
    }
    const replayed=await target.request(action,original.args);assert.equal(replayed.replayed,true);same(outcome(receipt),outcome(replayed));
    await completeJson(receiptPath,outcome(receipt));return outcome(receipt);
  }
  async function saveModel(name,target,modelId,change,options){
    return mutation(name,target,"semantic.model.save",async()=>{
      const current=await model(target,modelId),content=structuredClone(current.version.content);
      await change(content,current);
      return{modelId,expectedHeadId:current.model.headId,contextId:current.contextId,content,author:"Point-model operating reviewer",note:name};
    },options);
  }
  async function delivery(name,target,fields){
    const receipt=await mutation(name,target,"delivery.prepare",fields);
    const bytes=Buffer.from(await target.deliveryBytes(receipt.operationId));assert.equal(bytes.length,receipt.bytes);assert.equal(sha(bytes),receipt.sha256);
    return{receipt,file:await completeFile(join(outputs,name+"-"+receipt.name),bytes)};
  }
  async function returnPreview(target,file){
    const bytes=await verifiedFile(file),value=await target.request("semantic.return.preview",{expectedRevision:(await status(target)).revision,base64:bytes.toString("base64")});
    assert.equal(value.packageSha256,sha(bytes));return value;
  }
  async function exactReceived(bundle,path){
    const receipt=await receiveBundle(bundle,path),verified=verifyBundle(bundle);
    for(const[name,bytes]of verified.application)assert((await plainRead(join(path,"application",name))).equals(bytes),name);
    return{receipt,verified};
  }
  try{
    const originalOrigin=journal.serverOrigin?new URL(journal.serverOrigin):null;
    if(originalOrigin){assert.equal(originalOrigin.protocol,"http:");assert.equal(originalOrigin.hostname,"127.0.0.1");assert.equal(originalOrigin.origin,journal.serverOrigin);assert(Number(originalOrigin.port)>0);}
    server=await startServer({directory:workspaceDirectory,host:"127.0.0.1",port:originalOrigin?Number(originalOrigin.port):0,expectedWorkspaceId:journal.workspaceId});
    if(originalOrigin)assert.equal(server.url,journal.serverOrigin);
    else{journal.serverOrigin=server.url;await saveJson(journalPath,journal);}
    client=new HaystackClient({url:server.url,workspaceId:journal.workspaceId});await client.connect();
    await saveJson(join(root,"current-connection.json"),server.identity);
    const seed=await step("complete-original-source-and-native-point-list",async()=>{
      await mutation("import-original-native-charlie",client,"source.import",{name:"charlie.json",sourceUrl:SOURCE_URL,format:"json-v4",select:true,base64:originalBytes.toString("base64")});
      const records=await observe("original-complete-records",()=>pages(client,"records.list"));
      assert.equal(records.length,624);same(records.map(row=>row.tags),decoded.grid.rows);
      const csv=sourceTable(decoded.grid.rows,SOURCE_SHA,","),tsv=sourceTable(decoded.grid.rows.slice(0,8),SOURCE_SHA,"\t");
      const csvFile=await completeFile(join(outputs,"Charlie_complete_source_derived_point_list.csv"),csv);
      const browserFile=await completeFile(join(outputs,"Charlie_first_eight_source_derived_rows.tsv"),tsv);
      const imported=await mutation("native-parse-complete-point-list",client,"semantic.intake.import",{name:"Charlie_complete_source_derived_point_list.csv",
        format:"csv",delimiter:",",base64:csv.toString("base64"),sourceUrl:SOURCE_URL});
      assert.equal(imported.intake.rowCount,624);assert.equal(imported.intake.columns[2],"name");assert.equal(imported.intake.columns[3],"name");
      const rows=await observe("complete-native-inspected-cells",()=>pages(client,"semantic.intake.read",{intakeId:imported.intake.id}));
      assert.equal(rows.length,624);assert.equal(rows[0].cells[0],SOURCE_SHA+":0");assert.equal(rows[623].cells[0],SOURCE_SHA+":623");
      assert(Buffer.from(await client.completeBytes("semantic.source.read",{intakeId:imported.intake.id})).equals(csv));
      const originalSource=Buffer.from(await client.sourceBytes(SOURCE_SHA));assert(originalSource.equals(originalBytes));
      const standard=await client.request("semantic.catalog");assert(standard.ok&&standard.action==="catalog");
      for(const key of["classes","properties","tags","units"])assert(Array.isArray(standard[key]),"Retain complete native catalogue "+key);
      const standardFile=await completeJson(join(outputs,"selected-complete-native-catalogue.json"),standard);
      return{sourceId:SOURCE_SHA,intakeId:imported.intake.id,intakeFile:csvFile,browserIntakeFile:browserFile,standardFile,sourceRows:624};
    });
    const mainModel=await step("reviewed-complete-point-model",async()=>{
      const selection={nativeSourceIds:[seed.sourceId],intakeIds:[seed.intakeId]};
      const naming={template:"{nativeId}_{name}",case:"preserve",separator:"_",description:"The programme proposes original native ID plus display name. Source identity stays independent of this editable display convention."};
      const mappings=[{intakeId:seed.intakeId,idColumn:1,nameColumn:2,kindColumn:4,equipmentColumn:5,siteColumn:6,unitColumn:7,kind:"other",defaultClass:""}];
      const preview=await observe("complete-model-source-preview",async()=>client.request("semantic.model.preview",{expectedRevision:(await status(client)).revision,
        title:"Charlie building — reviewed point-list model",namespace:"https://example.invalid/charlie-model/",selection,mappings,naming}));
      assert.equal(preview.content.entities.length,1248);
      const content=structuredClone(preview.content),nativeEntities=content.entities.filter(row=>row.sourceRefs[0].kind==="native");
      const intakeEntities=new Map(content.entities.filter(row=>row.sourceRefs[0].kind==="intake").map(row=>[row.sourceRefs[0].rowIndex,row]));
      const records=await readJson(join(outputs,"original-complete-records.json")),byOriginalId=new Map();
      for(const entity of nativeEntities){
        const index=entity.sourceRefs[0].rowIndex,derived=intakeEntities.get(index);
        assert(derived);entity.sourceRefs.push(structuredClone(derived.sourceRefs[0]));
        entity.note="The second source reference is the explicit CSV derivation of this exact original native row. Physical/liveness observation remains unreviewed.";
        const originalId=records[index].tags.id?.val;if(originalId)byOriginalId.set(originalId,entity.id);
      }
      content.entities=nativeEntities;
      for(const entity of content.entities){
        const row=records[entity.sourceRefs[0].rowIndex],target=row.tags.equipRef?.val;
        if(entity.kind==="point"&&target&&byOriginalId.has(target))content.relations.push({id:"equip-ref:"+row.key,subjectId:entity.id,predicate:BRICK+"isPointOf",
          objectId:byOriginalId.get(target),note:"Explicitly reviewed mapping of this original native equipRef; original typed reference remains in source context."});
      }
      const catalogue=await readJson(seed.standardFile.path);
      for(const[iri,kind]of[[BRICK+"Point","class"],[BRICK+"Equipment","class"],[BRICK+"isPointOf","relation"]]){
        const found=[...catalogue.classes,...catalogue.properties].find(row=>row.iri===iri);assert(found,"Use an actual selected ontology term: "+iri);
        content.dictionary.push({id:"standard:"+iri,term:found.label||iri.split("#").at(-1),iri,kind,definition:found.definition||"",
          sourceUrl:iri,note:"Definition and identity retained from the actual selected Brick 1.4.4 catalogue; generic classification is a reviewed programme proposal."});
      }
      content.notes="This complete demonstration uses the original public Charlie building source and its explicitly generated CSV. It does not assert a site visit or live connection. Distinct original rows keep distinct entities; only the known CSV derivation adds a second source reference to the same entity.";
      const assessed=await client.request("semantic.model.assess",{expectedRevision:(await status(client)).revision,contextId:preview.contextId,selection,content});
      assert.equal(assessed.assessment.entities,624);assert.equal(assessed.assessment.mappedSourceRows,1248);assert.equal(assessed.assessment.unmappedSourceRows,0);
      const created=await mutation("save-complete-original-model",client,"semantic.model.create",{selection,contextId:preview.contextId,content,author:"Point-model operating reviewer",note:"Reviewed explicit native-row/derived-CSV crosswalk."},{loseResponse:true});
      const current=await model(client,created.model.id);assert.equal(current.version.content.entities.length,624);assert.equal(current.assessment.sourceRows,1248);
      same(current.version.content.entities.map(row=>row.id),nativeEntities.map(row=>row.id));
      return{modelId:created.model.id,firstVersionId:created.version.id,contextId:created.contextId,
        sourceEntityId:nativeEntities.find(row=>row.kind==="point").id,sourceRows:1248,entities:624};
    });
    const nativeResult=await step("actual-brick-validation-and-exact-review",async()=>{
      const result=await mutation("validate-original-complete-model",client,"semantic.validate",async()=>{
        const current=await model(client,mainModel.modelId);return{modelId:mainModel.modelId,expectedHeadId:current.model.headId,author:"Point-model native operator"};
      });
      const full=(await client.request("semantic.validation.read",{expectedRevision:(await status(client)).revision,validationId:result.validation.id})).validation;
      assert.equal(typeof full.native.conforms,"boolean");assert.equal(full.versionId,mainModel.firstVersionId);
      same(full.outputs.map(file=>file.name).sort(),["model.ttl","model.json","validation-report.ttl","validation-report.txt","brick-wrapper-report.ttl","brick-wrapper-report.txt","validation-expanded.ttl"].sort(),"Retain all seven actual original native outputs.");
      const files=[];
      for(const file of full.outputs){
        const bytes=Buffer.from(await client.completeBytes("semantic.output.read",{validationId:full.id,name:file.name}));
        assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);files.push(await completeFile(join(outputs,"native",full.id,file.name),bytes));
      }
      const review=await mutation("review-exact-validated-model",client,"semantic.model.review",async()=>{
        const current=await model(client,mainModel.modelId);return{modelId:mainModel.modelId,expectedHeadId:current.model.headId,decision:full.conforms?"ready":"changes",
          validationId:full.id,author:"Point-model operating reviewer",note:"Review of the exact retained source mapping and native report. Actual conformance is "+String(full.conforms)+". Physical and live-site observations remain explicitly unreviewed."};
      });
      return{validationId:full.id,conforms:full.conforms,execution:full.execution,files,review:review.review||null,
        completeResult:await completeJson(join(outputs,"complete-original-native-validation.json"),full)};
    });
    const corrected=await step("immutable-model-correction-and-comparison",async()=>{
      const saved=await saveModel("save-reviewed-naming-correction",client,mainModel.modelId,(content)=>{
        const selected=content.entities.find(row=>row.id===mainModel.sourceEntityId);assert(selected);
        selected.name+="__reviewed";selected.note+=" Display naming corrected by the operating reviewer; the original source ID and both source references remain unchanged.";
        content.notes+="\nThe first point has a deliberate naming correction for immutable revision comparison.";
      });
      const comparison=await pages(client,"semantic.model.compare",{modelId:mainModel.modelId,beforeVersionId:mainModel.firstVersionId,afterVersionId:saved.version.id});
      assert(comparison.some(row=>row.kind==="entities"&&row.id===mainModel.sourceEntityId));
      const current=await model(client,mainModel.modelId);assert(current.history.some(row=>row.id===mainModel.firstVersionId));
      same(current.version.content.entities.map(row=>row.id),(await client.request("semantic.model.read",{expectedRevision:(await status(client)).revision,modelId:mainModel.modelId,versionId:mainModel.firstVersionId})).version.content.entities.map(row=>row.id));
      return{versionId:saved.version.id,comparison:await completeJson(join(outputs,"complete-naming-version-comparison.json"),comparison)};
    });
    const issued=await step("complete-contractor-workspace",()=>delivery("issued-point-model-workspace",client,{kind:"workspace"}));
    const issuedBytes=await verifiedFile(issued.file),recipientDirectory=join(root,"recipient");
    const received=await exactReceived(issuedBytes,recipientDirectory);assert.equal(received.receipt.workspaceId,journal.workspaceId);assert.equal(received.verified.application.size,62);
    const recipientRoot=join(recipientDirectory,"application");
    const {startServer:startRecipient}=await import(pathToFileURL(join(recipientRoot,"server.mjs")).href);
    const {HaystackClient:RecipientClient}=await import(pathToFileURL(join(recipientRoot,"client.mjs")).href);
    recipient=await startRecipient({directory:recipientDirectory,host:"127.0.0.1",port:0,expectedWorkspaceId:journal.workspaceId});
    recipientClient=new RecipientClient({url:recipient.url,workspaceId:journal.workspaceId});await recipientClient.connect();
    const returnedModels=await step("contractor-edits-and-new-model",async()=>{
      const changed=await saveModel("contractor-complete-model-edit",recipientClient,mainModel.modelId,content=>{
        content.title="Charlie building — contractor reviewed mapping";
        content.entities.reverse();
        content.notes+="\nThe contractor deliberately reordered the entity register and supplied this complete model for an explicit owner decision.";
        content.dictionary[0].note+=" Contractor reviewed the selected standard term.";
      });
      const current=await model(recipientClient,mainModel.modelId),content=structuredClone(current.version.content);
      content.title="Contractor point and equipment detail";
      const point=content.entities.find(row=>row.id===mainModel.sourceEntityId),relationship=content.relations.find(row=>row.subjectId===point.id);
      const ids=new Set([point.id,...(relationship?[relationship.objectId]:[])]);
      content.entities=content.entities.filter(row=>ids.has(row.id));content.relations=content.relations.filter(row=>ids.has(row.subjectId)&&ids.has(row.objectId));
      content.notes="A separate contractor-created detail model from the same complete source context. Its unmapped source rows remain visible and do not claim missing equipment.";
      const created=await mutation("contractor-new-detail-model",recipientClient,"semantic.model.create",{contextId:current.contextId,content,author:"Contractor operating reviewer",note:"Explicit new detail model for owner receiving."});
      return{changedVersionId:changed.version.id,returnModelId:created.model.id,returnVersionId:created.version.id};
    });
    const returned=await step("contractor-complete-return",()=>delivery("complete-contractor-return",recipientClient,{kind:"workspace"}));
    await recipient.close();recipient=null;recipientClient=null;
    const localChange=await step("owner-concurrent-model-edit",()=>saveModel("owner-concurrent-source-note",client,mainModel.modelId,content=>{
      content.notes+="\nThe owner retained a local review note while the contractor prepared its returned package.";
    }));
    const kept=await step("keep-local-head-retain-entire-returned-history",async()=>{
      const preview=await returnPreview(client,returned.file);
      assert.equal(preview.models.length,2);
      assert(preview.models.find(row=>row.modelId===mainModel.modelId).changes.some(row=>row.kind==="order"));
      const result=await mutation("retain-return-keep-both-active-heads",client,"semantic.return.apply",async()=>{
        const current=await returnPreview(client,returned.file);
        return{base64:(await verifiedFile(returned.file)).toString("base64"),decisions:modelDecisions(current),author:"Owner operating reviewer",
          note:"Keep the local active model and defer the incoming detail model. Retain every original returned source, version, validation and review for the later explicit decision."};
      },{loseResponse:true});
      const state=await workspace.read(),s=state.semantics;
      assert.equal(s.models.find(row=>row.id===mainModel.modelId).headId,localChange.version.id);
      assert(!s.models.some(row=>row.id===returnedModels.returnModelId));
      assert(s.versions.some(row=>row.id===returnedModels.changedVersionId));assert(s.versions.some(row=>row.id===returnedModels.returnVersionId));
      const receipt=s.returns.find(row=>row.id===result.return.id);assert(receipt.incomingModels.some(row=>row.id===returnedModels.returnModelId));
      assert.equal(receipt.application.length,62);
      return{returnId:result.return.id,retainedIncomingVersions:[returnedModels.changedVersionId,returnedModels.returnVersionId],
        preview:await completeJson(join(outputs,"complete-owner-return-comparison.json"),preview)};
    });
    await step("friendly-cli-and-original-http-mcp",async()=>{
      const cli=await nativeCommand([join(ROOT,"cli.mjs"),"models","--directory",workspaceDirectory]);
      const models=JSON.parse(cli.stdout);assert(Array.isArray(models.items)||Array.isArray(models));
      const current=await status(client),definition=actions.find(row=>row.action==="semantic.model.read");assert(definition);
      const rpc={jsonrpc:"2.0",id:1,method:"tools/call",params:{name:definition.name,arguments:{expectedRevision:current.revision,modelId:mainModel.modelId}}};
      const response=await fetch(server.url+"/mcp",{method:"POST",headers:{"Content-Type":"application/json","x-haystack-workspace":journal.workspaceId,"x-haystack-instance":server.identity.instanceId},body:stringifyJson(rpc)});
      assert.equal(response.status,200);const mcp=await response.json();assert.equal(mcp.result.structuredContent.model.id,mainModel.modelId);
      const stdio=await nativeCommand([join(ROOT,"cli.mjs"),"rpc","--directory",workspaceDirectory],stringifyJson(rpc)+"\n");
      assert.equal(JSON.parse(stdio.stdout).result.structuredContent.model.id,mainModel.modelId);
      return{file:await completeJson(join(outputs,"complete-cli-http-mcp-stdio.json"),{cli,mcp,stdio}),declaredSemanticActions:actions.filter(row=>row.action.startsWith("semantic.")).length};
    });
    const browser=await step("complete-browser-and-explicit-return-adoption",async()=>{
      const browserInput={schema:"commons.haystack.semantic-browser-input.v1",operationId:journal.operationId,url:server.url,workspaceId:journal.workspaceId,instanceId:server.identity.instanceId,token:"",
        outputRoot:join(root,"browser"),playwrightModule:input.browser.playwrightModule,executablePath:input.browser.executablePath,
        modelId:mainModel.modelId,sourceId:seed.sourceId,intakeId:seed.intakeId,intakeFile:seed.intakeFile.path,browserIntakeFile:seed.browserIntakeFile.path,
        returnFile:returned.file.path,returnModelId:returnedModels.returnModelId,sourceEntityId:mainModel.sourceEntityId,validationId:nativeResult.validationId,
        expectedEntities:624,expectedSourceRows:1248};
      await saveJson(join(root,"browser-input.json"),browserInput);
      const result=await runSemanticBrowser(browserInput);
      const current=await workspace.read();assert(current.semantics.models.some(row=>row.id===returnedModels.returnModelId),"The actual browser must adopt the selected returned detail model.");
      return{file:await completeJson(join(outputs,"complete-browser-result.json"),result)};
    });
    const deliveries={};
    for(const format of["json","csv","html"])deliveries["model-"+format]=await step("complete-model-report-"+format,()=>delivery("complete-model-report-"+format,client,{kind:"semantic-report",modelId:mainModel.modelId,format}));
    for(const format of["json","csv"])deliveries["dictionary-"+format]=await step("complete-dictionary-"+format,()=>delivery("complete-dictionary-"+format,client,{kind:"semantic-dictionary",modelId:mainModel.modelId,format}));
    deliveries.workspace=await step("final-complete-editable-workspace",()=>delivery("final-complete-editable-workspace",client,{kind:"workspace"}));
    await step("all-original-native-and-intake-output-bytes",async()=>{
      const state=await workspace.read(),files=[];
      for(const intake of state.semantics.intakes){
        const bytes=Buffer.from(await client.completeBytes("semantic.source.read",{intakeId:intake.id}));
        assert.equal(bytes.length,intake.bytes);assert.equal(sha(bytes),intake.assetId);
        files.push(await completeFile(join(outputs,"all-intakes",intake.id+"."+intake.format),bytes));
      }
      for(const validation of state.semantics.validations)for(const output of validation.outputs){
        const bytes=Buffer.from(await client.completeBytes("semantic.output.read",{validationId:validation.id,name:output.name}));
        assert.equal(bytes.length,output.bytes);assert.equal(sha(bytes),output.sha256);
        files.push(await completeFile(join(outputs,"all-native-outputs",validation.id,output.name),bytes));
      }
      assert(Buffer.from(await client.sourceBytes(SOURCE_SHA)).equals(originalBytes));
      const jsonReport=JSON.parse(await verifiedFile(deliveries["model-json"].file));
      const full=await model(client,mainModel.modelId),{workspaceId:ignoredWorkspace,revision:ignoredRevision,...modelBody}=full;same(jsonReport.model,modelBody);
      return{files,sourceSha256:SOURCE_SHA,counts:countState(state)};
    });
    const receivedFinal=await step("independent-complete-receiving-reopen-and-reexport",async()=>{
      const bytes=await verifiedFile(deliveries.workspace.file),path=join(root,"independent-received");
      const received=await exactReceived(bytes,path),replayed=await receiveBundle(bytes,path);assert(replayed.replayed);assert.equal(replayed.installationId,received.receipt.installationId);
      const app=join(path,"application"),{startServer:startCold}=await import(pathToFileURL(join(app,"server.mjs")).href),{HaystackClient:ColdClient}=await import(pathToFileURL(join(app,"client.mjs")).href);
      cold=await startCold({directory:path,host:"127.0.0.1",port:0,expectedWorkspaceId:journal.workspaceId});
      const coldClient=new ColdClient({url:cold.url,workspaceId:journal.workspaceId});await coldClient.connect();
      assert.equal((await status(coldClient)).sha256,received.verified.state.sha256);
      const sourceState=await workspace.read();same(sourceState,received.verified.state);
      for(const intake of sourceState.semantics.intakes)assert(Buffer.from(await coldClient.completeBytes("semantic.source.read",{intakeId:intake.id})).equals(Buffer.from(await client.completeBytes("semantic.source.read",{intakeId:intake.id}))));
      for(const validation of sourceState.semantics.validations)for(const output of validation.outputs)assert(Buffer.from(await coldClient.completeBytes("semantic.output.read",{validationId:validation.id,name:output.name})).equals(Buffer.from(await client.completeBytes("semantic.output.read",{validationId:validation.id,name:output.name}))));
      const original=await readJson(join(requests,"retain-return-keep-both-active-heads.request.json")),receipt=await coldClient.request(original.action,original.args);
      assert(receipt.replayed);same(outcome(receipt),await readJson(join(requests,"retain-return-keep-both-active-heads.outcome.json")));
      const reexport=await delivery("independent-complete-reexport",coldClient,{kind:"workspace"}),rebuilt=verifyBundle(await verifiedFile(reexport.file));
      same(rebuilt.state,sourceState);for(const[name,content]of received.verified.application)assert(rebuilt.application.get(name).equals(content),name);
      await cold.close();cold=null;
      // Start again through the received application to confirm process reopen.
      cold=await startCold({directory:path,host:"127.0.0.1",port:0,expectedWorkspaceId:journal.workspaceId});
      const reopened=new ColdClient({url:cold.url,workspaceId:journal.workspaceId});await reopened.connect();
      assert.equal((await status(reopened)).sha256,sourceState.sha256);
      await cold.close();cold=null;
      return{receipt:received.receipt,replayed,reexport,applicationFiles:received.verified.application.size,counts:countState(sourceState)};
    });
    const compatibility=await step("retained-historical-package-receiving",async()=>{
      const results=[];
      for(const entry of input.compatibilityInputs||[]){
        assert(isAbsolute(entry.path)&&/^[a-f0-9]{64}$/.test(entry.sha256));
        const bytes=await plainRead(entry.path);assert.equal(sha(bytes),entry.sha256);
        const body=JSON.parse(bytes);assert(["commons.haystack.package.v1","commons.haystack.package.v2"].includes(body.format));
        const verified=verifyBundle(bytes),path=join(root,"historical-receiving",entry.sha256),received=await exactReceived(bytes,path);
        results.push({format:body.format,sha256:sha(bytes),bytes:bytes.length,workspaceId:verified.state.workspaceId,applicationFiles:verified.application.size,receipt:received.receipt});
      }
      return{inputs:results,meaning:results.length?"Actual retained historical packages received without source replacement.":"No historical package was supplied; exact v1/v2 inventories remain supported, but this run claims no historical-package execution."};
    });
    const finalState=await workspace.read(),finalStatus=await status(client);
    await closeTracked();
    const result={format:FORMAT,completed:true,operationId:journal.operationId,workspaceId:journal.workspaceId,startedAt:journal.startedAt,completedAt:at(),
      source:journal.source,application:journal.application,counts:countState(finalState),status:finalStatus,
      model:mainModel,originalNativeValidation:nativeResult,contractorReturn:kept,browser,deliveries,received:receivedFinal,compatibility,stages:journal.stages,
      programmeJournal:journalPath,requestDirectory:requests,outputDirectory:outputs};
    await saveJson(join(root,"complete-result.json"),result);journal.state="COMPLETE";journal.completedAt=result.completedAt;await saveJson(journalPath,journal);
    process.stdout.write(stringifyJson({completed:true,operationId:journal.operationId,workspaceId:journal.workspaceId,sourceRows:624,
      models:result.counts.models,versions:result.counts.versions,actualValidationCount:result.counts.validations,
      nativeConforms:nativeResult.conforms,completeResult:join(root,"complete-result.json"),workspace:deliveries.workspace.file})+"\n");
    return result;
  }catch(error){
    let cleanupError=null;
    try{await closeTracked();}catch(cleanup){cleanupError={message:cleanup.message,code:cleanup.code||null,details:cleanup.details||null};}
    journal.lastFailure={at:at(),message:error.message,code:error.code||null,details:error.details||null,...(error.result?{nativeResult:error.result}:{}),cleanupError};
    try{await saveJson(journalPath,journal);}catch(persist){error.failurePersistence={message:persist.message,code:persist.code||null};}
    if(cleanupError)error.cleanupError=cleanupError;
    throw error;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3){process.stderr.write("Use node SEMANTIC_RECEIVING.mjs /absolute/original-semantic-input.json\n");process.exitCode=2;}
  else main(resolve(process.argv[2])).catch(error=>{process.stderr.write(stringifyJson({error:error.message,code:error.code||null,details:error.details||null,...(error.result?{nativeResult:error.result}:{}),cleanupError:error.cleanupError||null,failurePersistence:error.failurePersistence||null})+"\n");process.exitCode=1;});
}
