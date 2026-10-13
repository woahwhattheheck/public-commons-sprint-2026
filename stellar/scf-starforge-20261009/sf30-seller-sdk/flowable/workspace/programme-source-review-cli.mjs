// MIT. Complete local source-review commands over the original authoring and review engines.
import {constants} from 'node:fs';
import {open,link,unlink,lstat} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parseProgrammeDraft,serializeProgrammeDraft,compileProgrammeDraft} from './programme-authoring.mjs';
import {
 createProgrammeSourceIssue,createProgrammeSourceReturn,parseProgrammeSourceExchange,
 serializeProgrammeSourceExchange,programmeSourceReviewDraft,compareProgrammeSourceReturn,applyProgrammeSourceReturn,exportProgrammeSourceReviewBranch,
} from './programme-source-review.mjs';

const MAXIMUM=64*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const options={hash};
function need(ok,message){if(!ok)throw Object.assign(new Error(message),{code:'FLOWABLE_SOURCE_REVIEW_INPUT'});}
const identity=bytes=>({bytes:bytes.length,sha256:hash(bytes)});
const stable=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
async function readOriginal(filename,maximum=MAXIMUM){
 const path=resolve(filename),h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await h.stat();
  need(before.isFile()&&before.size<=maximum,'Select a complete bounded regular file.');
  const raw=Buffer.alloc(before.size);let at=0;
  while(at<raw.length){const {bytesRead}=await h.read(raw,at,raw.length-at,at);need(bytesRead>0,'The selected source was truncated.');at+=bytesRead;}
  const extra=Buffer.alloc(1),{bytesRead}=await h.read(extra,0,1,at),after=await h.stat(),named=await lstat(path);
  need(bytesRead===0&&stable(before,after)&&named.dev===before.dev&&named.ino===before.ino&&!named.isSymbolicLink(),'The complete source changed while being read.');
  return{path,raw,text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),...identity(raw)};
 }finally{await h.close();}
}
async function syncParent(path){const h=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);try{await h.sync();}finally{await h.close();}}
async function exists(path){try{return await lstat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function publish(path,raw){
 path=resolve(path);need(raw.length<=MAXIMUM,'The complete output exceeds the 64 MiB source-review limit.');
 const expected=identity(raw),pending=join(dirname(path),'.'+basename(path)+'.'+expected.sha256+'.source-review.pending');
 let target=await exists(path),temp=await exists(pending);
 if(target){
  const saved=await readOriginal(path);need(saved.raw.equals(raw),'The output already contains a different edition; select another filename.');
  if(temp){
   need(temp.isFile()&&!temp.isSymbolicLink()&&(temp.mode&0o777)===0o600&&
    (temp.nlink===1||temp.dev===target.dev&&temp.ino===target.ino&&temp.nlink===2)&&
    (typeof process.getuid!=='function'||temp.uid===process.getuid()),'A retained output temporary is not the original publication.');
   const held=await readOriginal(pending);need(held.raw.equals(raw),'The retained output temporary changed.');
   await unlink(pending);await syncParent(path);
  }
  return{path,...expected,reused:true};
 }
 let h;
 try{
  h=await open(pending,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
 }catch(e){
  if(e.code!=='EEXIST')throw e;
  h=await open(pending,constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 }
 try{
  const stat=await h.stat();need(stat.isFile()&&stat.nlink===1&&stat.size<=raw.length&&
   (stat.mode&0o777)===0o600&&(typeof process.getuid!=='function'||stat.uid===process.getuid()),
   'The retained output temporary is not a private original publication.');
  const prefix=Buffer.alloc(stat.size);let at=0;
  while(at<prefix.length){const n=await h.read(prefix,at,prefix.length-at,at);need(n.bytesRead>0,'The retained temporary was truncated.');at+=n.bytesRead;}
  need(raw.subarray(0,prefix.length).equals(prefix),'The retained temporary belongs to another complete output.');
  at=prefix.length;while(at<raw.length){const n=await h.write(raw,at,raw.length-at,at);need(n.bytesWritten>0,'Could not write the complete output.');at+=n.bytesWritten;}
  await h.chmod(0o600);await h.sync();
 }finally{await h.close();}
 const saved=await readOriginal(pending);need(saved.raw.equals(raw),'The complete pending output changed.');
 try{await link(pending,path);}catch(e){if(e.code!=='EEXIST')throw e;const current=await readOriginal(path);need(current.raw.equals(raw),'The output was concurrently published as another edition.');}
 await syncParent(path);
 const named=await lstat(path),staged=await lstat(pending);
 need(staged.nlink===1||named.dev===staged.dev&&named.ino===staged.ino&&staged.nlink===2,'The output and its retained publication differ.');
 await unlink(pending);await syncParent(path);
 return{path,...expected,reused:false};
}
function decodeDraft(source){
 const value=JSON.parse(source.text);
 return value?.schema==='stellar-forge.flowable-programme-source-adoption.v1'
  ?parseProgrammeDraft(JSON.stringify(value.draft)):parseProgrammeDraft(source.text);
}
async function decodeExchange(source){
 const value=JSON.parse(source.text);
 const text=value?.schema==='stellar-forge.flowable-programme-source-adoption.v1'?JSON.stringify(value.exchange):source.text;
 return parseProgrammeSourceExchange(text,options);
}
function returnedText(source){
 const value=JSON.parse(source.text);
 if(value?.schema==='stellar-forge.flowable-programme-source-adoption.v1'){
  need(typeof value.incomingText==='string','Retain the exact original incoming exchange text in the adopted handover.');return value.incomingText;
 }
 return source.text;
}
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
export async function runProgrammeSourceReviewCommand(command,args={}){
 const specifications={
  issue:['draft','metadata'],return:['draft','exchange','metadata'],draft:['exchange'],branch:['exchange'],
  inspect:['exchange'],compare:['draft','exchange','returned'],apply:['draft','exchange','returned','metadata'],compile:['draft'],
 };
 need(Object.hasOwn(specifications,command),'Select issue, return, draft, branch, inspect, compare, apply or compile.');
 need(args&&typeof args==='object'&&!Array.isArray(args),'Supply complete source-review arguments.');
 const required=specifications[command],allowed=[...required,'output',...(['draft','branch','compare','apply'].includes(command)?['returnId']:[]),...(command==='branch'?['adoptionId','branch']:[])];
 need(Object.keys(args).every(k=>allowed.includes(k)),'Unknown argument for the selected source-review command.');
 for(const key of [...required,'output'])need(typeof args[key]==='string'&&args[key].length>0,'Supply '+key+'.');
 for(const key of ['returnId','adoptionId','branch'])if(args[key]!==undefined)need(typeof args[key]==='string'&&args[key].length>0,'Supply the selected '+key+'.');
 const inputs={};
 for(const key of required)inputs[key]=await readOriginal(args[key],key==='metadata'?1024*1024:MAXIMUM);
 const selected=Object.fromEntries(Object.entries(inputs).map(([key,v])=>[key,{path:v.path,bytes:v.bytes,sha256:v.sha256}]));
 const output=resolve(args.output);need(!Object.values(inputs).some(v=>v.path===output),'Select a distinct output; original source files are preserved.');
 const draft=inputs.draft?decodeDraft(inputs.draft):undefined,exchange=inputs.exchange?await decodeExchange(inputs.exchange):undefined;
 const metadata=inputs.metadata?JSON.parse(inputs.metadata.text):undefined;
 if(inputs.metadata)need(metadata&&typeof metadata==='object'&&!Array.isArray(metadata),'Metadata must be a complete object.');
 if(command==='apply'&&args.returnId!==undefined&&metadata.returnId!==undefined)need(args.returnId===metadata.returnId,'The explicit return identity differs from the retained adoption intent.');
 const opts={...options,...(args.returnId===undefined?{}:{returnId:args.returnId})};
 const incoming=inputs.returned?returnedText(inputs.returned):undefined;
 let raw,result;
 if(command==='issue'){result=await createProgrammeSourceIssue(draft,metadata,options);raw=Buffer.from(await serializeProgrammeSourceExchange(result.exchange,options));}
 else if(command==='return'){result=await createProgrammeSourceReturn(exchange,draft,metadata,options);raw=Buffer.from(await serializeProgrammeSourceExchange(result.exchange,options));}
 else if(command==='draft'){result=await programmeSourceReviewDraft(exchange,{...(args.returnId===undefined?{}:{returnId:args.returnId})},options);raw=Buffer.from(serializeProgrammeDraft(result));}
 else if(command==='branch'){result=await exportProgrammeSourceReviewBranch(exchange,{...(args.returnId===undefined?{}:{returnId:args.returnId}),...(args.adoptionId===undefined?{}:{adoptionId:args.adoptionId}),...(args.branch===undefined?{}:{branch:args.branch})},options);raw=Buffer.from(serializeProgrammeDraft(result));}
 else if(command==='inspect'){raw=Buffer.from(await serializeProgrammeSourceExchange(exchange,options));}
 else if(command==='compare'){result=await compareProgrammeSourceReturn(draft,exchange,incoming,opts);raw=json(result);}
 else if(command==='apply'){
  result=await applyProgrammeSourceReturn(draft,exchange,incoming,{...metadata,...(args.returnId===undefined?{}:{returnId:args.returnId})},options);
  raw=json({schema:'stellar-forge.flowable-programme-source-adoption.v1',draft:result.draft,exchange:result.exchange,adoption:result.adoption,incomingText:incoming});
 }else{result=await compileProgrammeDraft(draft,options);raw=Buffer.from(result.programmeText);}
 const file=await publish(output,raw);
 return{schema:'stellar-forge.flowable-programme-source-review-command.v1',command,inputs:selected,output:file,
  nativeDispatch:false,...(result?.issue?{issue:result.issue}:{}),...(result?.returnRecord?{returnRecord:result.returnRecord}:{}),
  ...(result?.adoption?{adoption:result.adoption}:{}),...(command==='compile'?{programme:{sha256:result.sha256,bytes:result.bytes,steps:result.programme.steps.length}}:{})};
}
export const PROGRAMME_SOURCE_REVIEW_HELP=[
 'Flowable source review — complete original drafts, exchanges and explicit resolutions.',
 '',
 '  flowable-source-review issue --draft SOURCE.json --metadata ISSUE.json --output ISSUED.json',
 '  flowable-source-review return --exchange ISSUED.json --draft EDITED.json --metadata RETURN.json --output RETURNED.json',
 '  flowable-source-review draft --exchange ISSUED.json [--return-id ID] --output EDITABLE.json',
 '  flowable-source-review branch --exchange ADOPTED.json --adoption-id ID --branch result --output EDITABLE.json',
 '  flowable-source-review compare --draft CURRENT.json --exchange LOCAL.json --returned RETURNED.json [--return-id ID] --output COMPARISON.json',
 '  flowable-source-review apply --draft CURRENT.json --exchange LOCAL.json --returned RETURNED.json --metadata RESOLUTION.json [--return-id ID] --output ADOPTED.json',
 '  flowable-source-review compile --draft ADOPTED.json --output PROGRAMME.json',
 '  flowable-source-review inspect --exchange EXCHANGE.json --output VERIFIED.json',
 '',
 'Metadata carries explicit original stable id/at and the fields documented in SOURCE_REVIEW.md.',
 'Apply retains draft, complete exchange and adoption together. Draft inputs also accept that full adopted result.',
 'No native engine is contacted. Existing outputs must contain exactly the same bytes to be reused.',
].join('\n')+'\n';
export async function main(argv=process.argv.slice(2)){
 try{
  if(argv.length===0||argv.length===1&&['--help','help'].includes(argv[0])){process.stdout.write(PROGRAMME_SOURCE_REVIEW_HELP);return 0;}
  const command=argv[0],args={},names={'--draft':'draft','--exchange':'exchange','--returned':'returned','--metadata':'metadata','--output':'output','--return-id':'returnId','--adoption-id':'adoptionId','--branch':'branch'};
  for(let i=1;i<argv.length;i+=2){const key=names[argv[i]],value=argv[i+1];need(key&&typeof value==='string'&&value&&!value.startsWith('--')&&!Object.hasOwn(args,key),'Use distinct complete named arguments.');args[key]=value;}
  process.stdout.write(JSON.stringify(await runProgrammeSourceReviewCommand(command,args),null,2)+'\n');return 0;
 }catch(error){process.stderr.write(JSON.stringify({error:error.code??'FLOWABLE_SOURCE_REVIEW_FAILED',message:String(error.message??error)})+'\n');return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await main();
