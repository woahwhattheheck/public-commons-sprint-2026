// MIT. Receive a completed Laboratory result as a portable, immutable customer folder.
import { realpath } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { readLabResult } from './result.mjs';
import { canonicalJson, sha256, safeSourceName } from './model.mjs';
import { absolute, privateDirectory, writeBytes, exists } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { readSnapshot } from '../../sf88-operator-buyer-cli/resource-library/files.mjs';
import { renderReceivedLabResult } from './received-result-page.mjs';

export const LAB_RESULT_FOLDER_SCHEMA='starforge.lab-edd-received-result.v1';
export const LAB_RESULT_BINDING_SCHEMA='starforge.lab-edd-result-folder-binding.v1';
const MAX_RESULT_BYTES=67108864, META_BYTES=4194304;
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
function need(condition,code,message){if(!condition)throw Object.assign(new Error(message),{code});}
function expectedIdentity(value={}){
  need(value!==null&&typeof value==='object'&&!Array.isArray(value),'LAB_RESULT_EXPECTED','Use an expected identity object.');
  const allowed=new Set(['archiveSha256','archiveBytes','manifestSha256','functionId','jobId','reviewName','sourceSha256','documentSha256','reviewSha256',
    'baselineSourceSha256','baselineDocumentSha256','baselineReviewSha256','correspondenceReviewSha256']);
  const result={};
  for(const [key,item]of Object.entries(value)){
    need(allowed.has(key),'LAB_RESULT_EXPECTED','Unknown expected identity field: '+key);
    need(key==='archiveBytes'?Number.isSafeInteger(item)&&item>=0&&item<=MAX_RESULT_BYTES:
      key.endsWith('Sha256')?typeof item==='string'&&/^[a-f0-9]{64}$/.test(item):typeof item==='string'&&item.length>0&&item.length<=512,
    'LAB_RESULT_EXPECTED','Invalid expected identity: '+key);
    result[key]=item;
  }
  return Object.freeze(result);
}
function checkExpected(expected,identity){
  const flattened={...identity,baselineSourceSha256:identity.baseline?.sourceSha256,
    baselineDocumentSha256:identity.baseline?.documentSha256,baselineReviewSha256:identity.baseline?.reviewSha256,
    correspondenceReviewSha256:identity.reconciliation?.reviewSha256};
  for(const [key,value]of Object.entries(expected))need(flattened[key]===value,'LAB_RESULT_IDENTITY_CHANGED','The selected result identity differs: '+key);
}
function makePlan(bytes,expected,signal){
  signal?.throwIfAborted();
  const result=readLabResult(bytes,{signal}),m=result.manifest,byName=new Map(result.members.map(file=>[file.filename,file]));
  need(m.functionId==='laboratoryReview','LAB_RESULT_FUNCTION','Select a complete laboratoryReview result.');
  const identity={
    functionId:m.functionId,jobId:m.jobId??null,reviewName:m.reviewName??null,profile:m.profile,
    sourceSha256:m.sourceSha256,documentSha256:m.documentSha256,reviewSha256:m.reviewSha256,
    archiveBytes:bytes.length,archiveSha256:sha256(bytes),manifestSha256:byName.get('manifest.json').sha256,
    baseline:result.baseline?{profile:result.baseline.source.profile,sourceSha256:result.baseline.source.sourceSha256,
      documentSha256:result.baseline.review.documentSha256,reviewSha256:result.baseline.review.reviewSha256}:null,
    reconciliation:result.reconciliation?{
      comparisonSha256:result.reconciliation.comparison.comparisonSha256,
      documentSha256:result.reconciliation.review.documentSha256,reviewSha256:result.reconciliation.review.reviewSha256,
      outputComparisonSha256:result.reconciliation.outputComparison.comparisonSha256}:null,
  };
  checkExpected(expected,identity);
  const binding={schema:LAB_RESULT_BINDING_SCHEMA,layoutVersion:1,identity};
  const files=[],seen=new Set();
  function add(path,data,role){
    need(safeSourceName(path)===path&&!seen.has(path),'LAB_RESULT_MEMBER_PATH','A result folder path is invalid or repeated: '+path);
    seen.add(path);const raw=Buffer.isBuffer(data)?data:Buffer.from(data);
    files.push({path,bytes:raw.length,sha256:sha256(raw),role,data:raw});
  }
  add('binding.json',json(binding),'receiving-binding');
  add('original-result.zip',bytes,'complete-original-result');
  for(const member of result.members)add('result/'+member.filename,member.bytes,'original-result-member');
  const family=(name,review,prepared)=>({
    label:name==='current'?'Current':'Baseline',profile:review.source.profile,
    report:{disposition:review.review.report.disposition,counts:review.review.report.counts,summary:review.review.report.summary},preparation:review.nativePreparation,
    files:prepared.map(file=>{
      const path='native/'+name+'/'+file.filename;add(path,file.bytes,name+'-native-file');
      return {path,filename:file.filename,bytes:file.bytes.length,sha256:file.sha256,
        ...(file.sourceFile?{sourceFile:file.sourceFile,formatConversion:file.formatConversion}:{})};
    }),
  });
  const families=[family('current',result,result.prepared)];
  if(result.baseline)families.push(family('baseline',result.baseline,result.baseline.prepared));
  const originalSlots=new Set();
  const originals=(m.sourceFiles??[]).map(file=>{
    need(!originalSlots.has(file.slot),'LAB_RESULT_ORIGINAL_SLOT','The original result repeats a source slot.');
    originalSlots.add(file.slot);
    const member=byName.get(m.originalMembers?.[file.slot]);
    need(member,'LAB_RESULT_ORIGINAL_SLOT','The complete original input is absent: '+file.slot);
    return {slot:file.slot,path:'result/'+member.filename,filename:file.filename??member.filename,bytes:member.bytes.length,sha256:member.sha256};
  });
  const reports=[
    ['report.html','Open current review'],['baseline/report.html','Open baseline review'],['reconciliation.html','Open correspondence review'],
  ].filter(([path])=>byName.has(path)).map(([path,label])=>({path:'result/'+path,label}));
  const choiceNames=[
    ['decisions.json','Current field choices · JSON'],['decisions.csv','Current field choices · CSV'],['decisions.tsv','Current field choices · TSV'],
    ['baseline/decisions.json','Baseline field choices · JSON'],['baseline/decisions.csv','Baseline field choices · CSV'],['baseline/decisions.tsv','Baseline field choices · TSV'],
    ['reconciliation/decisions.json','Correspondence choices · JSON'],['reconciliation/decisions.csv','Correspondence choices · CSV'],['reconciliation/decisions.tsv','Correspondence choices · TSV'],
    ['reconciliation/fields.csv','Complete original field comparison · CSV'],
  ];
  const choices=choiceNames.filter(([path])=>byName.has(path)).map(([path,label])=>{
    const file=byName.get(path);return {path:'result/'+path,label,bytes:file.bytes.length,sha256:file.sha256};
  });
  const members=result.members.map(file=>({path:'result/'+file.filename,filename:file.filename,bytes:file.bytes.length,sha256:file.sha256}));
  const view={identity,families,originals,reports,choices,members};
  add('index.html',Buffer.from(renderReceivedLabResult(view)),'customer-entry-page');
  for(const {path}of files){
    for(let end=path.indexOf('/');end!==-1;end=path.indexOf('/',end+1))
      need(!seen.has(path.slice(0,end)),'LAB_RESULT_MEMBER_PATH','A file collides with a result directory: '+path.slice(0,end));
  }
  const declarations=files.map(({data,...file})=>file).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const receipt={
    schema:LAB_RESULT_FOLDER_SCHEMA,status:'COMPLETE',layoutVersion:1,identity,
    entryPage:'index.html',resultArchive:'original-result.zip',bindingSha256:sha256(json(binding)),
    originalResultMembers:members.length,originalInputFiles:originals.length,
    nativeFamilies:families.map(f=>({label:f.label,profile:f.profile,preparation:f.preparation,report:f.report,files:f.files})),
    files:declarations,managedFileBytes:declarations.reduce((sum,file)=>sum+file.bytes,0),
  };
  return {binding,files,receipt,receiptBytes:json(receipt)};
}
async function folder(path,{create}){
  path=await privateDirectory(absolute(path),{create});
  need(await realpath(path)===path,'LAB_RESULT_DIRECTORY','Use an owned real directory without symbolic-link ancestors.');
  return path;
}
async function parents(root,path,create){
  const rel=relative(root,dirname(path));
  need(rel!== '..'&&!rel.startsWith('..'+sep),'LAB_RESULT_DIRECTORY','A result file escaped its owned directory.');
  let current=await folder(root,{create:false});
  if(rel)for(const part of rel.split(sep)){current=join(current,part);await folder(current,{create});}
}
async function verify(path,expected,signal){
  signal?.throwIfAborted();
  const bytes=await readSnapshot(path,expected.bytes);
  need(bytes.length===expected.bytes&&sha256(bytes)===expected.sha256,'LAB_RESULT_FILE_CHANGED','A received file differs from its original bytes: '+path);
  signal?.throwIfAborted();return bytes;
}
async function immutable(root,file,signal){
  signal?.throwIfAborted();const path=join(root,file.path);
  await parents(root,path,true);
  let retained=await exists(path);
  if(!retained){
    try{await writeBytes(path,file.data,{exclusive:true,signal});}
    catch(error){if(error.code!=='EEXIST')throw error;retained=true;}
  }
  if(retained)await verify(path,file,signal);
  return retained;
}
function response(directory,receipt,extra={}){
  return {status:'COMPLETE',directory,entryPage:join(directory,'index.html'),archivePath:join(directory,'original-result.zip'),
    receiptPath:join(directory,'receipt.json'),receipt,...extra};
}
async function verifiedFolder(root,plan,signal){
  const stored=JSON.parse((await readSnapshot(join(root,'receipt.json'),META_BYTES)).toString('utf8'));
  need(same(stored,plan.receipt),'LAB_RESULT_RECEIPT_CHANGED','The received folder receipt differs from the original complete result.');
  for(const file of plan.files){
    const path=join(root,file.path);await parents(root,path,false);await verify(path,file,signal);
  }
  return stored;
}
/**
 * Install an already completed result. All names/bytes come from the original
 * readLabResult verifier; the original atomic writer publishes each complete file.
 * Existing exact members resume. A different result or altered member is refused.
 */
export async function receiveLabResult({file,directory,expected={},signal}={}){
  const selected=expectedIdentity(expected),input=absolute(file),rootPath=absolute(directory);
  signal?.throwIfAborted();
  const raw=await readSnapshot(input,MAX_RESULT_BYTES),plan=makePlan(raw,selected,signal);
  const root=await folder(rootPath,{create:true});
  const binding=plan.files.find(file=>file.path==='binding.json');
  const bindingRetained=await immutable(root,binding,signal);
  if(await exists(join(root,'receipt.json'))){
    const receipt=await verifiedFolder(root,plan,signal);
    return response(root,receipt,{reused:true,writtenFiles:0,retainedFiles:plan.files.length});
  }
  let writtenFiles=bindingRetained?0:1,retainedFiles=bindingRetained?1:0;
  for(const file of plan.files){
    if(file.path==='binding.json')continue;
    if(await immutable(root,file,signal))retainedFiles++;else writtenFiles++;
  }
  // Read every actual installed member before publishing the completed receipt.
  for(const file of plan.files)await verify(join(root,file.path),file,signal);
  await immutable(root,{path:'receipt.json',data:plan.receiptBytes,bytes:plan.receiptBytes.length,sha256:sha256(plan.receiptBytes)},signal);
  return response(root,plan.receipt,{reused:false,writtenFiles,retainedFiles});
}
/** Read-only cold reopen; the folder may be copied to another owned location. */
export async function openReceivedLabResult({directory,expected={},signal}={}){
  const selected=expectedIdentity(expected),root=await folder(absolute(directory),{create:false});
  signal?.throwIfAborted();
  const binding=JSON.parse((await readSnapshot(join(root,'binding.json'),META_BYTES)).toString('utf8'));
  need(binding.schema===LAB_RESULT_BINDING_SCHEMA&&binding.layoutVersion===1&&binding.identity,
    'LAB_RESULT_BINDING','Select a received Laboratory result folder.');
  const raw=await readSnapshot(join(root,'original-result.zip'),MAX_RESULT_BYTES);
  const plan=makePlan(raw,selected,signal);
  need(same(binding,plan.binding),'LAB_RESULT_BINDING_CHANGED','The result folder is bound to another original result.');
  const receipt=await verifiedFolder(root,plan,signal);
  return response(root,receipt,{readOnly:true});
}
