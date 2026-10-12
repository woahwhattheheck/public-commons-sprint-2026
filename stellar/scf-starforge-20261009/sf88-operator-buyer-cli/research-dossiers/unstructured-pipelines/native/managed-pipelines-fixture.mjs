// MIT. Retained manual HTTP fixture for the official managed Pipelines job lifecycle.
// Source contract: unstructured-python-client ba25d2537151e0cbd6bdfadd97167a47f1e7d948.
// The run's report records this local provider mode and every actual HTTP request.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const templateId = 'a1ccab48-0823-4f89-a1bb-980019428f71';
export const PIPELINE_NATIVE_SCENARIO = Object.freeze({
  schema: 'stellar-forge.managed-pipelines-native-scenario.v1',
  providerMode: 'official-model-local-http',
  providerContract: {
    repository: 'Unstructured-IO/unstructured-python-client',
    commit: 'ba25d2537151e0cbd6bdfadd97167a47f1e7d948',
    sdkVersion: '0.46.3',
    openapiVersion: '1.2.31',
    models: ['BodyCreateJob', 'JobInformation', 'JobDetails', 'JobNodeDetails', 'NodeFileMetadata'],
    serviceLimits: 'https://docs.unstructured.io/api-reference/workflow/overview',
  },
  profile: {
    id: 'local-file-partition',
    label: 'Reviewed local-file partition',
    requestData: {template_id: templateId},
  },
  inputs: [
    {filename: 'committee-brief.txt', contentType: 'text/plain',
      text: 'Committee brief\nThe selected plan retains the original document and the provider output.\nFunding review remains attached to the source record.\n'},
    {filename: 'source-appendix.txt', contentType: 'text/plain',
      text: 'Source appendix\nTwo source editions remain independently reviewable.\nThe appendix records the operating assumptions.\n'},
  ],
});

function metadata(file) {
  const body=Buffer.from(file.text,'utf8');
  return {filename:file.filename,contentType:file.contentType,bytes:body.length,sha256:digest(body)};
}
function elements(file,index,{intermediate=false}={}) {
  const paragraphs=file.text.trimEnd().split('\n');
  return paragraphs.map((text,position)=>({
    type:position===0?'Title':'NarrativeText',
    element_id:'fixture-'+index+'-'+position+(intermediate?'-partition':''),
    text,
    metadata:{filename:file.filename,page_number:position<2?1:2,
      languages:['eng'],filetype:file.contentType,
      ...(intermediate?{pipeline_stage:'partition'}:{})},
  }));
}
function json(res,status,value) {
  const body=Buffer.from(JSON.stringify(value)+'\n');
  res.writeHead(status,{'content-type':'application/json','content-length':body.length,
    'cache-control':'no-store','x-request-id':'local-fixture-'+randomUUID()});
  res.end(body);
}
async function requestBytes(req,maximum) {
  const chunks=[];let length=0;
  for await(const chunk of req){length+=chunk.length;assert(length<=maximum,'Fixture request exceeds declared small input');chunks.push(chunk);}
  return Buffer.concat(chunks,length);
}

/**
 * Mount handler on the caller's one local HTTPS server.
 * API credentials, CA, browser profile and listening port stay in the run process.
 * complete()/confirmStop() are explicit provider state advances; HTTP getters do not
 * manufacture progress merely because an operator repeats a refresh.
 */
export function createPipelineJobFixture({apiKey,pathPrefix='/enterprise/',stateFile=null,inputs=null}={}) {
  assert(typeof apiKey==='string'&&apiKey.length>=24);
  assert(/^\/[A-Za-z0-9/_-]*\/$/.test(pathPrefix));
  assert(stateFile===null||isAbsolute(stateFile));
  // A receiving consumer may select a retained UTF-8 file from its completed
  // acquisition. Default callers keep the original two-file scenario unchanged.
  let scenario=PIPELINE_NATIVE_SCENARIO;
  if(inputs!==null) {
    assert(Array.isArray(inputs)&&inputs.length>=1&&inputs.length<=10);
    let bytes=0;
    const received=inputs.map(file=>{
      assert(file&&Object.keys(file).length===3&&
        Object.keys(file).every(key=>['filename','contentType','text'].includes(key)));
      assert(typeof file.filename==='string'&&file.filename.length>0&&file.filename.length<=512&&
        !/[\\/\0-\x1f\x7f]/.test(file.filename));
      assert(typeof file.contentType==='string'&&file.contentType.length<=256&&
        /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[ -~]+)?$/.test(file.contentType));
      assert(typeof file.text==='string'&&file.text.isWellFormed()&&Buffer.byteLength(file.text)>0);
      bytes+=Buffer.byteLength(file.text);
      assert(bytes<=65536,'The retained manual fixture uses small reviewed source files');
      return clone(file);
    });
    scenario={...clone(PIPELINE_NATIVE_SCENARIO),inputs:received};
  }
  const scenarioSha256=digest(Buffer.from(JSON.stringify(scenario)));
  let restored=null;
  if(stateFile&&existsSync(stateFile)){
    const bytes=readFileSync(stateFile);assert(bytes.length<2*1024*1024);
    restored=JSON.parse(bytes);
    assert.equal(restored.schema,'stellar-forge.managed-pipelines-native-provider-state.v1');
    assert.equal(restored.scenarioSha256,scenarioSha256);assert.equal(restored.pathPrefix,pathPrefix);
    assert(Array.isArray(restored.jobs)&&restored.jobs.length<=2&&Array.isArray(restored.records)&&Array.isArray(restored.errors));
    for(const [index,record] of restored.jobs.entries()){
      assert.equal(typeof record.id,'string');
      assert(['SCHEDULED','IN_PROGRESS','COMPLETED','STOPPED'].includes(record.status));
      assert.deepEqual(record.inputs,index===0?scenario.inputs:scenario.inputs.slice(0,1));
      assert.equal(record.inputIds.length,record.inputs.length);
    }
  }
  const jobs=new Map((restored?.jobs??[]).map(record=>[record.id,record]));
  const records=restored?.records??[],errors=restored?.errors??[];
  const counters=restored?.counters??{create:0,list:0,get:0,details:0,cancel:0,download:0};
  for(const count of Object.values(counters))assert(Number.isSafeInteger(count)&&count>=0);
  assert.equal(counters.create,jobs.size);
  const creates=restored?.creates??[],clockId=randomUUID();
  let closed=false;
  function persist(){
    if(!stateFile)return;
    const state={schema:'stellar-forge.managed-pipelines-native-provider-state.v1',
      scenarioSha256,pathPrefix,jobs:[...jobs.values()],records,errors,counters,creates};
    const temporary=stateFile+'.'+randomUUID()+'.tmp';let fd;
    try{
      fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(state)+'\n');fsyncSync(fd);closeSync(fd);fd=undefined;
      renameSync(temporary,stateFile);const directory=openSync(dirname(stateFile),'r');try{fsyncSync(directory);}finally{closeSync(directory);}
    }finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
  }
  const jobRoot=pathPrefix+'api/v1/jobs/';
  function information(record) {
    return {
      id:record.id,workflow_id:record.workflowId,workflow_name:'Local-file partition fixture',
      status:record.status,created_at:record.createdAt,job_type:'ephemeral',
      runtime:record.status==='COMPLETED'?'0:00:01':null,
      // Deliberately independent of local input order. Consumers select these IDs.
      input_file_ids:[...record.inputIds].reverse(),
      output_node_files:record.status==='COMPLETED'?[{
        node_id:record.nodeId,file_id:record.nodeFileId,node_type:'partition',node_subtype:'unstructured_api',
      }]:[],
    };
  }
  function details(record) {
    const count=record.inputIds.length;
    return {id:record.id,
      processing_status:record.status==='COMPLETED'?'SUCCESS':record.status,
      message:record.status==='STOPPED'?'Stopped after the configured cancel request':null,
      node_stats:[{
        node_name:'Partition local files',node_type:'partition',node_subtype:'unstructured_api',
        ready:record.status==='SCHEDULED'?count:0,
        in_progress:record.status==='IN_PROGRESS'?count:0,
        success:record.status==='COMPLETED'?count:0,failure:0,
      }],
    };
  }
  function output(record,fileId,nodeId) {
    assert.equal(record.status,'COMPLETED','A provider output is available after this fixture completes');
    if(nodeId===null) {
      const index=record.inputIds.indexOf(fileId);
      assert(index>=0,'Default output file ID must come from the actual provider job');
      return Buffer.from(JSON.stringify(elements(record.inputs[index],index),null,2)+'\n');
    }
    assert.equal(nodeId,record.nodeId);assert.equal(fileId,record.nodeFileId);
    return Buffer.from(JSON.stringify(elements(record.inputs[0],0,{intermediate:true}),null,2)+'\n');
  }
  async function handle(req,res) {
    assert(!closed,'Fixture is closed');
    const url=new URL(req.url,'https://fixture.invalid');
    assert.equal(req.headers['unstructured-api-key'],apiKey,'Selected provider account must authenticate every request');
    assert.equal(req.headers.accept,'application/json');
    const observed={method:req.method,path:url.pathname,query:Object.fromEntries(url.searchParams),
      receivedAt:new Date().toISOString(),authenticated:true};
    records.push(observed);
    if(req.method==='POST'&&url.pathname===jobRoot) {
      assert.equal(url.search,'');
      const raw=await requestBytes(req,128*1024);
      const request=new Request('https://fixture.invalid'+url.pathname,
        {method:'POST',headers:req.headers,body:raw});
      const form=await request.formData();
      assert.deepEqual([...new Set(form.keys())].sort(),['input_files','request_data']);
      const data=form.getAll('request_data');
      assert.equal(data.length,1);assert.equal(typeof data[0],'string');
      const requestData=JSON.parse(data[0]);
      assert.deepEqual(requestData,scenario.profile.requestData);
      const files=form.getAll('input_files');
      assert(files.length>=1&&files.length<=10);
      const current=counters.create;
      assert(current<2,'This one native journey prepares exactly two original provider jobs');
      const expected=current===0?scenario.inputs:scenario.inputs.slice(0,1);
      assert.equal(files.length,expected.length);
      const captured=[];
      for(let index=0;index<files.length;index++){
        const file=files[index],wanted=expected[index],body=Buffer.from(await file.arrayBuffer());
        assert.equal(file.name,wanted.filename);assert.equal(file.type,wanted.contentType);
        assert.deepEqual(body,Buffer.from(wanted.text,'utf8'));
        captured.push({filename:file.name,contentType:file.type,bytes:body.length,sha256:digest(body)});
      }
      const launched=process.hrtime.bigint(),previous=creates.at(-1);
      const interval=previous?.clockId===clockId?Number(launched-BigInt(previous.monotonicNs))/1e6:null;
      if(interval!==null)assert(interval>=1000,
        'The original same-account launch gate must preserve the service one-second interval');
      creates.push({clockId,monotonicNs:String(launched),receivedAt:new Date().toISOString(),intervalMs:interval});counters.create++;
      const id=randomUUID(),record={
        id,workflowId:randomUUID(),createdAt:new Date().toISOString(),status:current===0?'SCHEDULED':'IN_PROGRESS',
        inputs:clone(expected),inputIds:expected.map(()=>randomUUID()),
        nodeId:randomUUID(),nodeFileId:randomUUID(),cancelAcknowledged:false,
      };
      jobs.set(id,record);
      Object.assign(observed,{jobId:id,requestDataSha256:digest(Buffer.from(data[0])),
        inputs:captured,response:current===0?'connection-lost-after-create':'200'});
      persist(); // Provider identity exists durably before either the lost response or the acknowledgement.
      if(current===0){res.destroy();return;}
      json(res,200,information(record));return;
    }
    if(req.method==='GET'&&url.pathname===jobRoot) {
      assert([...url.searchParams.keys()].every(k=>['workflow_id','status'].includes(k)));
      counters.list++;
      const rows=[...jobs.values()].filter(row=>
        (!url.searchParams.has('workflow_id')||row.workflowId===url.searchParams.get('workflow_id'))&&
        (!url.searchParams.has('status')||row.status===url.searchParams.get('status')));
      json(res,200,rows.map(information));return;
    }
    assert(url.pathname.startsWith(jobRoot),'Use the selected API path prefix');
    const parts=url.pathname.slice(jobRoot.length).split('/');
    assert(parts.length===1||parts.length===2);
    const id=decodeURIComponent(parts[0]),record=jobs.get(id);
    assert(record,'Read or control the retained original provider job ID');
    observed.jobId=id;
    if(req.method==='GET'&&parts.length===1) {
      assert.equal(url.search,'');counters.get++;observed.providerStatus=record.status;
      json(res,200,information(record));return;
    }
    if(req.method==='GET'&&parts[1]==='details') {
      assert.equal(url.search,'');counters.details++;json(res,200,details(record));return;
    }
    if(req.method==='POST'&&parts[1]==='cancel') {
      assert.equal(url.search,'');
      assert.equal((await requestBytes(req,1)).length,0);
      assert.equal(record.status,'IN_PROGRESS');
      assert.equal(record.cancelAcknowledged,false,'A local request replay must not submit cancel twice');
      record.cancelAcknowledged=true;counters.cancel++;persist();
      // The acknowledgement alone is not STOPPED. The next getter still observes IN_PROGRESS.
      json(res,200,{});return;
    }
    if(req.method==='GET'&&parts[1]==='download') {
      assert([...url.searchParams.keys()].every(k=>['file_id','node_id'].includes(k)));
      assert.equal(url.searchParams.getAll('file_id').length,1);
      assert(url.searchParams.getAll('node_id').length<=1);
      const fileId=url.searchParams.get('file_id'),nodeId=url.searchParams.get('node_id');
      const body=output(record,fileId,nodeId);counters.download++;
      Object.assign(observed,{fileId,nodeId,outputBytes:body.length,outputSha256:digest(body)});
      res.writeHead(200,{'content-type':'application/json','content-length':body.length,
        'x-request-id':'local-output-'+randomUUID()});res.end(body);return;
    }
    assert.fail('Unsupported method or endpoint in the declared official Jobs lifecycle');
  }
  return Object.freeze({
    handler(req,res){handle(req,res).catch(error=>{
      errors.push({at:new Date().toISOString(),code:error.code??'FIXTURE_CONTRACT_ERROR',message:error.message});
      if(!res.headersSent)json(res,500,{detail:'Retained fixture contract mismatch'});
      else res.destroy();
    }).finally(()=>{try{persist();}catch(error){errors.push({code:error.code??'FIXTURE_STATE_WRITE_FAILED',message:error.message});}});},
    inputs(){return scenario.inputs.map(file=>({...metadata(file),body:Buffer.from(file.text,'utf8')}));},
    jobs(){return [...jobs.values()].map(information);},
    job(id){const value=jobs.get(id);assert(value);return information(value);},
    complete(id){const value=jobs.get(id);assert(value);assert.equal(value.status,'SCHEDULED');value.status='COMPLETED';persist();return information(value);},
    confirmStop(id){const value=jobs.get(id);assert(value?.cancelAcknowledged);assert.equal(value.status,'IN_PROGRESS');value.status='STOPPED';persist();return information(value);},
    output(id,fileId,nodeId=null){const value=jobs.get(id);assert(value);return output(value,fileId,nodeId);},
    summary(){return {schema:'stellar-forge.managed-pipelines-fixture-result.v1',
      providerMode:scenario.providerMode,providerContract:clone(scenario.providerContract),
      scenarioSha256,inputs:scenario.inputs.map(metadata),
      counters:clone(counters),jobs:[...jobs.values()].map(information),requests:clone(records),
      launchIntervalsMs:creates.slice(1).map(value=>value.intervalMs),errors:clone(errors)};},
    close(){persist();closed=true;},
  });
}
