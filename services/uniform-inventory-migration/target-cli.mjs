#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as E from './engine.mjs';
import {projectTarget,compareReadback,targetContractTemplate} from './target-contract.mjs';

const need=(ok,message)=>{if(!ok)throw Error(message);};
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const MAX=512*1024*1024;
const APP=['engine.mjs','sha256.mjs','target-contract.mjs','target-cli.mjs','TARGET_CONTRACT.md'];
const APP_ROOT=path.dirname(fileURLToPath(import.meta.url));
function absolute(value){need(typeof value==='string'&&path.isAbsolute(value),'Choose an explicit absolute path.');return path.resolve(value);}
function ordinary(file,max=E.LIMITS.workspaceBytes){
 const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.size<=max,'Choose one complete ordinary file within its input limit: '+file);
 const body=fs.readFileSync(file);need(body.length<=max,'The complete original file exceeds its input limit.');return body;
}
function text(body){const value=body.toString('utf8');need(Buffer.from(value,'utf8').equals(body),'Keep complete original UTF-8 bytes.');return value;}
function optional(file){try{return ordinary(file,MAX);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function syncDirectory(dir){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}catch(e){if(!['EINVAL','EPERM','EISDIR','ENOTSUP'].includes(e.code))throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}}
function mkdirOrdinary(root){
 const parsed=path.parse(root);let current=parsed.root;
 for(const piece of root.slice(parsed.root.length).split(path.sep).filter(Boolean)){current=path.join(current,piece);try{fs.mkdirSync(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const s=fs.lstatSync(current);need(s.isDirectory()&&!s.isSymbolicLink(),'Keep the output in ordinary directories: '+current);}
}
function scoped(root,relative){
 need(typeof relative==='string'&&relative.length>0&&!path.isAbsolute(relative)&&!relative.includes('\\')&&relative.split('/').every(p=>p!==''&&p!=='.'&&p!=='..'),'Use an ordinary relative member path.');
 const target=path.resolve(root,...relative.split('/'));need(target.startsWith(root+path.sep),'Keep complete members inside the original directory.');return target;
}
function sourceMember(root,relative,max){
 const file=scoped(root,relative);let parent=path.dirname(file);
 while(parent!==root){const s=fs.lstatSync(parent);need(s.isDirectory()&&!s.isSymbolicLink(),'Keep selected source evidence inside its ordinary input directory.');parent=path.dirname(parent);}
 need(fs.realpathSync(root)===root,'Keep the original source directory ordinary.');return{file,body:ordinary(file,max)};
}
function publish(root,relative,body){
 const file=scoped(root,relative);mkdirOrdinary(path.dirname(file));const old=optional(file);if(old){need(old.equals(body),'An original output contains another complete edition: '+relative);syncDirectory(path.dirname(file));return;}
 const candidate=file+'.'+randomUUID()+'.candidate';let fd;
 try{fd=fs.openSync(candidate,'wx',0o600);fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;try{fs.linkSync(candidate,file);}catch(e){if(e.code!=='EEXIST'||!optional(file)?.equals(body))throw e;}syncDirectory(path.dirname(file));}
 finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(candidate,{force:true});}
}
function memberRecords(files){return [...files].map(([p,b])=>({path:p,bytes:b.length,sha256:sha(b)}));}
function sameRecords(actual,expected){return JSON.stringify(actual)===JSON.stringify(expected);}
function total(files){let bytes=0;for(const body of files.values())bytes+=body.length;need(bytes<=MAX,'Retain the complete original and derived bundle within512MiB.');return bytes;}
function application(){
 const files=new Map();for(const name of APP)files.set('application/'+name,sourceMember(APP_ROOT,name,4*1024*1024).body);return files;
}
function parse(argv){
 const command=argv.shift(),o={};need(['template','project','compare','replay'].includes(command),'Choose template, project, compare or replay.');need(argv.length%2===0,'Supply each named flag with one value.');
 for(let i=0;i<argv.length;i+=2){need(['--workspace','--contract','--crosswalks','--bundle','--out'].includes(argv[i])&&!Object.hasOwn(o,argv[i]),'Use each supported flag once.');o[argv[i]]=argv[i+1];}
 need(o['--out'],'Supply --out.');
 if(command==='replay'){need(o['--bundle']&&!o['--workspace']&&!o['--contract']&&!o['--crosswalks'],'Replay uses exactly --bundle and --out.');}
 else{need(o['--workspace']&&!o['--bundle'],'Select --workspace for template/project/compare.');if(command!=='template')need(o['--contract'],'Supply the complete approved --contract JSON.');}
 return{command,o};
}
function collect(workspacePath,contractPath,crosswalkPath){
 const workspaceBytes=ordinary(workspacePath),workspace=E.importWorkspace(text(workspaceBytes)),contractBytes=ordinary(contractPath,4*1024*1024),contract=JSON.parse(text(contractBytes)),files=new Map();
 files.set('inputs/workspace.json',workspaceBytes);files.set('inputs/target-contract.json',contractBytes);
 const evidence=[];
 need(Array.isArray(contract.sourceEvidence)&&contract.sourceEvidence.length>0,'Select the complete original prime-supplied target contract evidence.');
 for(let i=0;i<contract.sourceEvidence.length;i++){const item=contract.sourceEvidence[i];need(typeof item.path==='string','Retain each original contract evidence file under its contract directory and name its relative path.');
  const {body}=sourceMember(path.dirname(contractPath),item.path,32*1024*1024);need(sha(body)===item.sha256,'The original native contract source changed: '+item.name);
  const ext=path.extname(item.path);need(/^\.[A-Za-z0-9]{1,12}$/.test(ext),'Keep an ordinary source extension.');const destination='inputs/native-evidence/'+String(i+1).padStart(3,'0')+ext.toLowerCase();files.set(destination,body);evidence.push({name:item.name,locator:item.locator,path:destination,bytes:body.length,sha256:sha(body)});
 }
 let walks=[];
 if(crosswalkPath){const original=ordinary(crosswalkPath,4*1024*1024),definitions=JSON.parse(text(original));need(Array.isArray(definitions),'The crosswalk manifest is an array of complete original file selections.');files.set('inputs/crosswalks.json',original);
  walks=definitions.map((w,i)=>{need(w&&typeof w==='object'&&w.text===undefined,'Select an original crosswalk CSV by relative path; keep its full text in that file.');const {body}=sourceMember(path.dirname(crosswalkPath),w.path,E.LIMITS.csvBytes);need(sha(body)===w.sha256,'The original crosswalk CSV changed.');files.set('inputs/crosswalks/'+String(i+1).padStart(3,'0')+'.csv',body);return{...w,text:text(body)};});
 }
 total(files);return{workspace,contract,walks,files,evidence};
}
function readBundle(root){
 need(fs.realpathSync(root)===root&&fs.lstatSync(root).isDirectory(),'Open the ordinary complete original bundle directory.');
 const manifestBytes=sourceMember(root,'MANIFEST.json',4*1024*1024).body,manifest=JSON.parse(text(manifestBytes));
 need(manifest.schema==='tjlabs.uniform-target-files.v1'&&['project','compare'].includes(manifest.command)&&Array.isArray(manifest.files),'Open a complete native-file projection/readback bundle.');
 const files=new Map(),names=new Set();let count=0;
 for(const f of manifest.files){need(f&&typeof f.path==='string'&&!names.has(f.path.toLowerCase()),'Retain distinct complete member paths.');names.add(f.path.toLowerCase());need(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&/^[a-f0-9]{64}$/.test(f.sha256),'Keep complete member lengths and hashes.');count+=f.bytes;need(count<=MAX,'The complete bundle exceeds512MiB.');const body=sourceMember(root,f.path,Math.min(MAX,f.bytes)).body;need(body.length===f.bytes&&sha(body)===f.sha256,'A complete saved member changed: '+f.path);files.set(f.path,body);}
 const requestBytes=files.get('request.json');need(requestBytes&&sha(requestBytes)===manifest.requestSha256,'Retain the original complete request bytes.');
 const request=JSON.parse(text(requestBytes));need(request.schema==='tjlabs.uniform-target-cli-request.v1'&&request.command===manifest.command&&Array.isArray(request.inputs)&&Array.isArray(request.application)&&Array.isArray(request.evidence),'Retain the complete original request shape.');
 const current=application();need(sameRecords(memberRecords(current),request.application),'Use the complete original delivered application revision for exact replay.');
 for(const [p,b]of current)need(files.get(p)?.equals(b),'A delivered original application file changed: '+p);
 const inputs=new Map();for(const f of request.inputs){need(typeof f.path==='string'&&f.path.startsWith('inputs/')&&!inputs.has(f.path),'Retain distinct original input members.');const body=files.get(f.path);need(body&&body.length===f.bytes&&sha(body)===f.sha256,'A retained original input changed.');inputs.set(f.path,body);}
 const selected=fromRetained(inputs,request.evidence);
 return{manifest,manifestBytes,request,requestBytes,files,selected,current};
}
function fromRetained(files,evidence){
 const bytes=p=>{const b=files.get(p);need(b,'Retain complete input member '+p+'.');return b;};
 const workspace=E.importWorkspace(text(bytes('inputs/workspace.json'))),contract=JSON.parse(text(bytes('inputs/target-contract.json')));
 need(Array.isArray(contract.sourceEvidence)&&contract.sourceEvidence.length===evidence.length,'Retain every original native-contract source.');
 const expected=new Map([['inputs/workspace.json',bytes('inputs/workspace.json')],['inputs/target-contract.json',bytes('inputs/target-contract.json')]]);
 for(let i=0;i<evidence.length;i++){const selected=evidence[i],original=contract.sourceEvidence[i],b=bytes(selected.path);need(selected.name===original.name&&selected.locator===original.locator&&selected.sha256===original.sha256&&sha(b)===original.sha256&&b.length===selected.bytes,'An original native-contract source or locator changed.');expected.set(selected.path,b);}
 let walks=[];if(files.has('inputs/crosswalks.json')){const b=bytes('inputs/crosswalks.json'),definitions=JSON.parse(text(b));need(Array.isArray(definitions),'Keep the original crosswalk selection array.');expected.set('inputs/crosswalks.json',b);
  walks=definitions.map((w,i)=>{need(w&&typeof w==='object'&&w.text===undefined,'Keep the original crosswalk file selection.');const p='inputs/crosswalks/'+String(i+1).padStart(3,'0')+'.csv',body=bytes(p);need(sha(body)===w.sha256,'The complete selected crosswalk bytes changed.');expected.set(p,body);return{...w,text:text(body)};});
 }
 need(sameRecords(memberRecords(expected),memberRecords(files)),'Retain exactly the original ordered input cohort.');return{workspace,contract,walks,files,evidence};
}
function compose(command,selected,current){
 const request={schema:'tjlabs.uniform-target-cli-request.v1',command,inputs:memberRecords(selected.files),evidence:selected.evidence,application:memberRecords(current)},requestBytes=json(request),requestSha256=sha(requestBytes);
 const result=(command==='project'?projectTarget:compareReadback)(selected.workspace,selected.contract,selected.walks),all=new Map([['request.json',requestBytes],...selected.files,...current]);
 for(const f of result.files){const body=Buffer.from(f.text,'utf8');need(body.length===f.bytes&&sha(body)===f.sha256,'The complete generated member differs.');const old=all.get(f.path);need(!old||old.equals(body),'A complete member collides with another original source.');all.set(f.path,body);}
 total(all);
 const manifest={schema:'tjlabs.uniform-target-files.v1',command,requestSha256,resultId:result.id,status:result.status,ready:command==='project'?result.readyForPrimeLoad:result.technicalReady,files:memberRecords(all),meaning:result.meaning};
 return{request,requestBytes,requestSha256,result,all,manifest,manifestBytes:json(manifest)};
}
function save(root,command,selected,current,original=null){
 const request={schema:'tjlabs.uniform-target-cli-request.v1',command,inputs:memberRecords(selected.files),evidence:selected.evidence,application:memberRecords(current)},requestBytes=json(request),requestSha256=sha(requestBytes);
 publish(root,'request.json',requestBytes);for(const[p,b]of selected.files)publish(root,p,b);for(const[p,b]of current)publish(root,p,b);
 try{
  const complete=compose(command,selected,current);
  if(original){need(complete.manifestBytes.equals(original.manifestBytes),'The complete regenerated manifest differs from its original.');for(const[p,b]of complete.all)need(original.files.get(p)?.equals(b),'The original saved output differs from its full regeneration: '+p);need(complete.all.size===original.files.size,'Retain every complete original output.');}
  const existed=optional(path.join(root,'MANIFEST.json'));
  for(const[p,b]of complete.all)publish(root,p,b);publish(root,'MANIFEST.json',complete.manifestBytes);
  return{status:complete.manifest.status,reused:!!existed,root,requestSha256,ready:complete.manifest.ready,files:complete.all.size,manifestSha256:sha(complete.manifestBytes),...(original?{originalFullyRegenerated:true}:{})};
 }catch(error){const failure={schema:'tjlabs.uniform-target-failure.v1',requestSha256,code:error.code||error.name,message:error.message,details:error.details||null};try{publish(root,'failures/'+sha(json(failure))+'.json',json(failure));}catch{}throw error;}
}
export function main(argv=process.argv.slice(2)){
 const {command,o}=parse(argv.slice()),root=absolute(o['--out']);mkdirOrdinary(root);
 if(command==='replay'){const original=readBundle(absolute(o['--bundle']));return save(root,original.manifest.command,original.selected,original.current,original);}
 const workspacePath=absolute(o['--workspace']);
 if(command==='template'){
  need(!o['--contract']&&!o['--crosswalks'],'Template needs only the selected workspace and output directory.');const original=ordinary(workspacePath),workspace=E.importWorkspace(text(original)),value=targetContractTemplate(workspace);
  publish(root,'original-workspace.json',original);publish(root,'target-contract-template.json',json(value));return{status:'template-prepared',root,workspaceId:workspace.id,revision:workspace.revision,meaning:'Populate actual native columns, original evidence paths and attributed contract choices before projection.'};
 }
 const selected=collect(workspacePath,absolute(o['--contract']),o['--crosswalks']?absolute(o['--crosswalks']):null);
 return save(root,command,selected,application());
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(main(),null,2)+'\n');}
 catch(error){process.stderr.write(JSON.stringify({error:error.code||error.name,message:error.message,details:error.details||null})+'\n');process.exitCode=1;}
}
