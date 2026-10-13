#!/usr/bin/env node
// Receive and operate the complete original BroomDesk programme using installed runtimes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const COMMIT='b6aebaac0bb9a7c99bfdc094025c442d764bb0f7';
const PREFIX='https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/'+COMMIT+'/revenue/broomdesk_commissioning_20261013/';
const FILES=[{"path":"host/connected_sha256.cjs","bytes":18336,"sha256":"023b01f089168605a6153b9e5f3ccd7a66a0d0487fab3e79522897a1df226cc2"},{"path":"tools/revenue_owner_console_20261010/lead_fulfillment_core.cjs","bytes":81753,"sha256":"c683ae05e7a83e43ea8d5a3e7a0735f635d20954c1b7002c3c976e2e475b024d"},{"path":"tools/revenue_owner_console_20261010/lead_capture_core.cjs","bytes":12268,"sha256":"75b949c45a4b848671fd78c7b631794d27691b092549e4259edb017c0474fae2"},{"path":"tools/revenue_owner_console_20261010/lead_customer_files.cjs","bytes":19719,"sha256":"6fd989943d558d806cbb5cdb5e3bad9ee630950aebae13ba6a58dd373d897081"},{"path":"tools/revenue_owner_console_20261010/lead_reconciliation_core.cjs","bytes":20121,"sha256":"9225050eb8ea3a86fcc02e1845fbe0970473e7ae6bd08a858fb7c806f67562ad"},{"path":"tools/revenue_owner_console_20261010/lead_customer_requests.cjs","bytes":35457,"sha256":"e93569600867bc3da48d8063b5d62c318472f04cb0d2cc08762ed20d649e6a7f"},{"path":"tools/revenue_owner_console_20261010/capture/capture_core.cjs","bytes":9998,"sha256":"ab7c7ba6411f58f6fb6d15e20685fa3c75c090f3e6fc8bd6c88f7eaf2ce198f6"},{"path":"host/connected_zip.cjs","bytes":12090,"sha256":"857c79f789e9cf4f6321bf22804e1c8d55af6758495ae1ba09d4fa72fd97bb26"},{"path":"host/connected_gzip.cjs","bytes":47127,"sha256":"1fc9f3b218c60d029c96bf9f1c1e4de5fcb86918ed5a0570586dc81488440119"},{"path":"original-working-record.json","bytes":51832,"sha256":"982bac7bede702014040008878efe62be78a439e8aa45375b8f378d7bf62c67b"},{"path":"original-archives.json","bytes":226951,"sha256":"184ff00fb9659fa19b03408f7f1ccb192840a0d437c937f6447da79466583e37"},{"path":"commissioning-core.cjs","bytes":21507,"sha256":"457c46cfd678181a56b88f03208362a74fc920aba65c9bddc47ad1b082dddaea"},{"path":"styles.css","bytes":2879,"sha256":"0747d6db231ffeef2c9d4225af6f5813b3e3fc9ee4d7958782d3a68ae50ada15"},{"path":"app.js","bytes":26407,"sha256":"b334fa89aab176dff0c55ec14e8e509bbe138bf83aecb5284cf18535d6ab7e9d"},{"path":"render.cjs","bytes":2066,"sha256":"4ff8575f04634d5d4481c70539464313a1202fa9faae1f22cf30baf9edf19fea"},{"path":"BROOMDESK-COMMISSIONING-OPERATOR.md","bytes":12384,"sha256":"176598e2b02607b7ecfe3ad0066f0657669699bb2368700e5938d533fd4d1907"},{"path":"BROOMDESK-ACCEPTANCE.md","bytes":5746,"sha256":"d76001bc8caf79b7e910f780308552018cd423d87b290bdd1e338250363d4c7b"},{"path":"broomdesk-commissioning-fields.json","bytes":12240,"sha256":"793c44877bdaac39772ce02ca0dd8a177746ef0112d32832916ed78b4bf86491"},{"path":"BROOMDESK-SOURCES.json","bytes":9677,"sha256":"318cb5f777f1668d2b62f5794e4493fc65c56666efd9fdcc94de2b0f26d2b558"},{"path":"BROOMDESK-OPERATOR.md","bytes":20188,"sha256":"549c6552b0a7df595181e4787832e4110d56d82873a2628ce6db672a818f5362"},{"path":"BROOMDESK-CRITERIA.json","bytes":4045,"sha256":"8c10a470e4c8fb1c4e791016374ad7b5955af42edbf26f5c50369d71fdeecb1d"},{"path":"authored-receiving.json","bytes":209986,"sha256":"69708d1d8a1d4eb406fd13e71331988e29e06f25d24986809c6224261d4cf142"},{"path":"START-HERE.md","bytes":3643,"sha256":"071d9ae89fa96565b431415862e845e6c01053ecc86da0ddf0b79a3b39d75671"},{"path":"compose.cjs","bytes":7918,"sha256":"8f3db976d8f5027e2dc71cd78b4863d4889712117a3ccc5c3b19d20e0b4da278"},{"path":"working-record.json","bytes":1005842,"sha256":"feb09d21b02d68452e0c1fee64422f82a52d1d728f3adb71d7445c8cad924004"},{"path":"composition-receipt.json","bytes":5221,"sha256":"7c309bef0c1a79c07a1a5a6b13dec7d15ab243722035ea531de7265598e6b1f4"},{"path":"receiving.cjs","bytes":1790,"sha256":"13469fe1d1dd60051d3e15970fbb0f4bae8e7811735b82415880a677ea364818"},{"path":"build.cjs","bytes":2530,"sha256":"781b9a63be9bf074567ead8e7d61a71bb0234f14c65483ec2fd7a72f3d70b6c7"},{"path":"vendor/customer-package-panel.mjs","bytes":11168,"sha256":"ee435860b2359b2c422a5aee582c795fbbcfc5279e6d07893e44ac3f8c35b0b9"},{"path":"package-viewer.mjs","bytes":7275,"sha256":"a4f687b1ee0542e9e0ee583c93e48d9e23a301f332ec197dd4b93ca563c3f25c"},{"path":"build-package-viewer.mjs","bytes":5095,"sha256":"e172bec45c3f6a7c5dac74907e76086096d2d2d52836a8628fa55eb85fd285bb"},{"path":"make-envelope.cjs","bytes":964,"sha256":"8032227d50abc754f96e514a5d54aa6fb4d8a8546d5ee4ee1d6471f46c8081dc"},{"path":"browser-receiving.mjs","bytes":14921,"sha256":"43e0aaa138eeb7b419df436464dd3d5d2d99f1f5555728856062d798d2b05f79"},{"path":"browser-packages.mjs","bytes":8897,"sha256":"ce935fad078ad950c4cfc5aab85382bbd6999e619826670cc608cf768068c56e"},{"path":"README.md","bytes":14854,"sha256":"0cf5e07149da92cc93c98936a911f72a9d9cfc0896c034039f8e2d6ae006e7a9"},{"path":"sample-package-viewer-input.json","bytes":189553,"sha256":"5ef1c55a81c67d3b62620ee9fe6ee3f405ad60ee0a14a2e53684b2d9e9d572a8"},{"path":"BroomDesk-sample-complete-commissioning-package.html","bytes":204193,"sha256":"9eb099a2f730ccd5a503dbc099b4354daf4db64165cc00decda187c3bb97d8fd"},{"path":"paid-package-viewer-input.json","bytes":217303,"sha256":"2ed621061cd6a2e924ebc8b94d585044888bbc8befd2acfd9fba1a22b8a38a10"},{"path":"BroomDesk-paid-complete-commissioning-package.html","bytes":231945,"sha256":"04e7980a5fd5206e0147793fbff19e81d8f78ac4f546ab884ea8390971f80304"},{"path":"source-manifest.json","bytes":6477,"sha256":"b3060ec67db3d4cf0efcb82a51c3186fa006bb36a6444df1e7773626e71c182a"}];
const WHOLE={"bytes":2856213,"sha256":"90b6fa447baef3901df643558ad716cf0e2e020455ac841777b4d23b72775ac9"};
const SCHEMA="broomdesk.complete-commissioning-source.v1";
const opts={},args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])throw Error('Each option needs a value.');opts[args[i]]=args[i+1];}
for(const key of Object.keys(opts))if(!['--out','--playwright-module','--chromium','--cdp'].includes(key))throw Error('Unknown option '+key);
if(!opts['--out']||!opts['--playwright-module']||Boolean(opts['--chromium'])===Boolean(opts['--cdp']))throw Error('Use --out NEW_DIRECTORY --playwright-module EXISTING_ENTRY and exactly one of --chromium EXISTING_EXECUTABLE or --cdp ACCEPTED_ENDPOINT.');
const out=path.resolve(opts['--out']),playwright=path.resolve(opts['--playwright-module']);
if(fs.existsSync(out))throw Error('Choose a new owned output directory; existing work is preserved.');
fs.mkdirSync(out,{mode:0o700});
const source=path.join(out,'source'),delivery=path.join(out,'delivery'),views=path.join(out,'package-views');
fs.mkdirSync(source,{mode:0o700});
const hash=b=>createHash('sha256').update(b).digest('hex');
const ascii=value=>JSON.stringify(value).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const need=(ok,message)=>{if(!ok)throw Error(message);};
let interrupted=null,browserProcess=null,browserClosed=null,next=0;
const status={schema:'broomdesk.complete-original-host-receiving.v1',started_at:new Date().toISOString(),status:'source_receiving',public_commit:COMMIT,whole_source:WHOLE,source,delivery,received:[],stages:[],browser:null};
function checkpoint(){const temporary=path.join(out,'receiving-status.json.'+randomUUID());fs.writeFileSync(temporary,JSON.stringify(status,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,path.join(out,'receiving-status.json'));}
function stop(signal){interrupted=interrupted||signal;status.stop_requested=interrupted;checkpoint();}
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'));
function proceed(){if(interrupted)throw Error('Owner requested '+interrupted+'; all original source and current output are retained.');}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
checkpoint();
try{
 const ownSource=fs.readFileSync(fileURLToPath(import.meta.url));fs.writeFileSync(path.join(out,'receive-public-source.mjs'),ownSource,{flag:'wx',mode:0o600});
 const bodies=new Map();
 async function receive(){
  while(next<FILES.length){
   proceed();const f=FILES[next++],name=f.path;
   need(typeof name==='string'&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(x=>x&&x!=='.'&&x!=='..'),'Invalid original source path.');
   const response=await fetch(PREFIX+name.split('/').map(encodeURIComponent).join('/'),{redirect:'error',signal:AbortSignal.timeout(60000),headers:{accept:'text/plain'}});
   need(response.status===200,'Original source returned HTTP '+response.status+' for '+name);
   const bytes=Buffer.from(await response.arrayBuffer());
   need(bytes.length===f.bytes&&hash(bytes)===f.sha256,'Original source bytes differ: '+name);
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);need(Buffer.from(text,'utf8').equals(bytes),'Original source UTF-8 differs: '+name);
   const destination=path.join(source,name);fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});fs.writeFileSync(destination,bytes,{flag:'wx',mode:0o600});bodies.set(name,text);
   status.received.push({path:name,bytes:f.bytes,sha256:f.sha256});checkpoint();
  }
 }
 const received=await Promise.allSettled([receive(),receive(),receive()]);const failure=received.find(x=>x.status==='rejected');if(failure)throw failure.reason;
 proceed();const full=ascii({schema:SCHEMA,files:FILES.map(f=>({path:f.path,content:bodies.get(f.path),bytes:f.bytes,sha256:f.sha256}))});
 need(Buffer.byteLength(full)===WHOLE.bytes&&hash(full)===WHOLE.sha256,'The complete original source packet differs.');
 fs.writeFileSync(path.join(out,'complete-original-source.json'),full,{flag:'wx',mode:0o600});status.status='source_complete';checkpoint();
 async function run(name,argv){
  proceed();const stage={name,started_at:new Date().toISOString(),arguments:argv,status:'running'};status.stages.push(stage);checkpoint();
  const logPath=path.join(out,name+'.log'),fd=fs.openSync(logPath,'wx',0o600);let child;
  try{
   child=spawn(process.execPath,argv,{cwd:source,env:{...process.env},stdio:['ignore',fd,fd]});
   const result=await new Promise(resolve=>{let error=null;child.once('error',e=>{error=e;});child.once('close',(code,signal)=>resolve({code,signal,error:error?.message||null}));});
   stage.finished_at=new Date().toISOString();Object.assign(stage,result);stage.status=result.code===0&&!result.error?'PASS':'FAILED';checkpoint();
   need(stage.status==='PASS','Original '+name+' failed; complete log and outputs remain at '+logPath);proceed();
  }finally{fs.closeSync(fd);}
 }
 await run('build',['build.cjs',delivery]);
 await run('build-package-viewer',['build-package-viewer.mjs',delivery,views]);
 const built=JSON.parse(fs.readFileSync(path.join(delivery,'build-result.json'),'utf8'));
 need(built.validation.full_record_reopen_equal,'Whole record receiving did not match.');
 status.build=built;status.status='browser_preparation';checkpoint();proceed();
 let endpoint=opts['--cdp'];
 if(opts['--chromium']){
  const executable=path.resolve(opts['--chromium']);need(fs.statSync(executable).isFile(),'Use the installed Chromium executable.');
  const profile=path.join(out,'owned-browser-profile');fs.mkdirSync(profile,{mode:0o700});
  const fd=fs.openSync(path.join(out,'owned-chromium.log'),'wx',0o600);
  browserProcess=spawn(executable,['--headless','--no-sandbox','--disable-dev-shm-usage','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
  let browserError=null;browserProcess.once('error',e=>{browserError=e;});browserClosed=new Promise(resolve=>browserProcess.once('close',(code,signal)=>resolve({code,signal})));
  const activePort=path.join(profile,'DevToolsActivePort'),until=Date.now()+30000;
  while(!fs.existsSync(activePort)){proceed();if(browserError)throw browserError;if(browserProcess.exitCode!==null||browserProcess.signalCode)throw Error('Owned Chromium exited; read its retained log.');if(Date.now()>until)throw Error('Owned Chromium did not publish its local endpoint; read its retained log.');await delay(100);}
  const port=fs.readFileSync(activePort,'utf8').split(/\r?\n/)[0];need(/^\d+$/.test(port)&&+port>0&&+port<65536,'Owned Chromium port differs.');
  endpoint='http://127.0.0.1:'+port;status.browser={ownership:'owned_isolated_process',pid:browserProcess.pid,executable,profile};
 }else status.browser={ownership:'existing_operator_endpoint',attached_browser_preserved:true};
 status.status='original_browser_courses';checkpoint();
 await run('browser-application',['browser-receiving.mjs','--cdp',endpoint,'--delivery',delivery,'--out',path.join(out,'application-review'),'--playwright-module',playwright,'--page-source','supplied-html']);
 await run('browser-packages',['browser-packages.mjs','--cdp',endpoint,'--delivery',delivery,'--out',path.join(out,'package-review'),'--playwright-module',playwright,'--page-source','supplied-html']);
 for(const [kind,directory]of [['application','application-review'],['packages','package-review']]){const result=JSON.parse(fs.readFileSync(path.join(out,directory,'receiving.json'),'utf8'));need(result.status==='PASS','Original '+kind+' course did not complete.');status[kind]={status:result.status,views:result.views.length,downloads:result.downloads.length};}
 status.status='COURSES_COMPLETED_IMAGES_AWAIT_PRODUCER_INSPECTION';
}catch(error){status.status=interrupted?'INTERRUPTED':'FAILED';status.error={message:error.message,stack:error.stack};}
finally{
 if(browserProcess){try{if(browserProcess.exitCode===null&&!browserProcess.signalCode)browserProcess.kill('SIGTERM');let closed=false;await Promise.race([browserClosed.then(()=>{closed=true;}),delay(5000)]);if(!closed){browserProcess.kill('SIGKILL');await browserClosed;}status.owned_browser_closed=true;}catch(error){status.cleanup_error=error.message;status.status='FAILED';}}
 status.finished_at=new Date().toISOString();checkpoint();
 const guide='# Original BroomDesk receiving output\n\nComplete source, both exact original archives, full new packages, logs, authored operation and actual browser downloads/screens remain in this directory. Open application-review/receiving.json and package-review/receiving.json, then personally inspect their full PNG images and every outgoing/extracted document. The recorded course outcome and actual producing-peer image inspection are separate.\n\n'+JSON.stringify(status,null,2)+'\n';
 fs.writeFileSync(path.join(out,'READ-THIS-RECEIVING-RESULT.md'),guide,{flag:'wx',mode:0o600});
}
console.log(JSON.stringify({status:status.status,out,source_received:status.received.length,stages:status.stages.map(x=>({name:x.name,status:x.status})),error:status.error?.message||null}));
process.exitCode=status.status==='COURSES_COMPLETED_IMAGES_AWAIT_PRODUCER_INSPECTION'?0:1;
