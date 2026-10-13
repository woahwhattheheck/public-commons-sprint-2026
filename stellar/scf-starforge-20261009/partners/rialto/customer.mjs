#!/usr/bin/env node
// MIT — Rialto complete catalogue → original SF88 customer receiving.
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {SCHEMA,need,plan,pageUrl,page,catalogue,selection,challenge,compare,canonical} from './core.mjs';
import {sha,json,read,readJson,exists,privateDir,writeNew,retain,lock,http,ordinaryHeaders,verifyHttp,captureGet,pack,receive,copyOriginal} from './io.mjs';
import {reportHtml} from './report.mjs';
const NATIVE='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs';
function flags(args){
 const o={};for(let i=0;i<args.length;i+=2){need(args[i].startsWith('--')&&args[i+1]!==undefined&&!Object.hasOwn(o,args[i].slice(2)),'Flags must be distinct --name value pairs');o[args[i].slice(2)]=args[i+1];}return o;
}
function required(o,key){need(typeof o[key]==='string'&&o[key].length,'--'+key+' is required');return o[key];}
async function capture(o){
 const raw=o.plan?await readJson(o.plan):{},p=plan({...raw,...(o.discovery?{discovery:o.discovery}:{}),...(o.facilitator?{facilitator:o.facilitator}:{}),...(o.network?{network:o.network}:{}),...(o.limit?{limit:Number(o.limit)}:{})});
 const root=path.resolve(required(o,'directory'));if(!await exists(root))await privateDir(root,{create:true});else await privateDir(root);
 return lock(root,async()=>{
  await retain(path.join(root,'plan.json'),json(p));
  if(await exists(path.join(root,'catalogue.json'))){const c=await originalCatalogue(root);await retain(path.join(root,'report.html'),Buffer.from(reportHtml(c.value,c.sha256)));return inspect({directory:root});}
  const supported=await captureGet(root,p.facilitator+'/supported'),peers=await captureGet(root,p.discovery+'/federation/peers');
  const rows=[],sources=[];let offset=0;
  for(;;){
   const got=await captureGet(root,pageUrl(p,offset));sources.push(got.name);
   const value=page(got.value,p,offset);rows.push(got.value);
   if(value.terminal)break;offset=value.nextOffset;
  }
  const c=catalogue(p,rows);c.sourcePages=sources;c.supportedSource=supported.name;c.peersSource=peers.name;
  c.facilitatorReadStatus=supported.value.status;c.peersReadStatus=peers.value.status;
  await writeNew(path.join(root,'catalogue.json'),json(c));await writeNew(path.join(root,'report.html'),Buffer.from(reportHtml(c,sha(json(c)))));
  return inspect({directory:root});
 });
}
async function originalCatalogue(root){
 root=await privateDir(root);const raw=await read(path.join(root,'catalogue.json')),saved=JSON.parse(raw),p=plan(await readJson(path.join(root,'plan.json')));
 need(canonical(saved.plan)===canonical(p),'Capture plan differs from retained catalogue');
 need(Array.isArray(saved.sourcePages),'Original page list missing');const records=[];
 for(const name of saved.sourcePages){need(/^captures\/[a-f0-9]{64}-[0-9]{6}\.json$/.test(name),'Original page path invalid');records.push(verifyHttp(await readJson(path.join(root,name))));}
 const rebuilt=catalogue(p,records);for(const key of Object.keys(rebuilt))need(canonical(rebuilt[key])===canonical(saved[key]),'Catalogue differs from its original pages: '+key);
 return{root,raw,value:saved,sha256:sha(raw)};
}
async function inspect(o){
 const c=await originalCatalogue(required(o,'directory'));
 return{directory:c.root,catalogueSha256:c.sha256,resources:c.value.rows.length,pages:c.value.pageCount,enumerationComplete:c.value.enumerationComplete,sourceTotals:c.value.sourceTotals,findings:c.value.findings,observedFrom:c.value.firstObservedAt,observedThrough:c.value.lastObservedAt,report:path.join(c.root,'report.html')};
}
async function select(o){
 const c=await originalCatalogue(required(o,'source')),input=await readJson(required(o,'selection'));
 need(input.catalogueSha256===undefined||input.catalogueSha256===c.sha256,'Selected catalogue edition has changed');
 const s=selection(c.value,input,c.sha256),out=path.resolve(required(o,'directory'));
 need(out!==c.root&&!out.startsWith(c.root+path.sep),'Request destination must be outside original catalogue');
 need(!await exists(out),'Request destination already exists; reopen its original selection');
 const stage=path.join(path.dirname(out),'.rialto-selection-'+randomUUID());await privateDir(stage,{create:true});
 try{await copyOriginal(c.root,path.join(stage,'source'));
 let body;if(o['body-file']||input.requestBodyUtf8!==undefined){need(input.requestBodyUtf8===undefined||typeof input.requestBodyUtf8==='string','Request body text must be UTF-8 text');body=o['body-file']?await read(o['body-file']):Buffer.from(input.requestBodyUtf8,'utf8');need(body.length<=16*1024*1024,'Body exceeds native16MiB request limit');await writeNew(path.join(stage,'request.body'),body);s.body={path:'request.body',bytes:body.length,sha256:sha(body)};}
 const headers=o['headers-file']?await readJson(o['headers-file']):(input.headers??{});
 need(headers&&typeof headers==='object'&&!Array.isArray(headers)&&Object.values(headers).every(v=>typeof v==='string'),'Request headers must be string values');
 if(o['content-type'])headers['Content-Type']=o['content-type'];
 s.headers=ordinaryHeaders(headers);need(s.body===undefined||!['GET','HEAD'].includes(s.method),'Original GET and HEAD requests must have no body');await writeNew(path.join(stage,'request.headers.json'),json(s.headers));await writeNew(path.join(stage,'selection.json'),json(s));
 await fs.rename(stage,out);
 }catch(error){await fs.rm(stage,{recursive:true,force:true});throw error;}
 return{directory:out,intentId:s.intentId,url:s.url,method:s.method,selectedTerms:s.selectedTerms,maxAtomic:s.maxAtomic,selectionSha256:sha(json(s))};
}
async function selected(root){
 root=await privateDir(root);const saved=await readJson(path.join(root,'selection.json')),c=await originalCatalogue(path.join(root,'source'));
 const rebuilt=selection(c.value,saved,c.sha256);
 for(const key of Object.keys(rebuilt))need(canonical(rebuilt[key])===canonical(saved[key]),'Selected original request changed: '+key);
 const headers=ordinaryHeaders(await readJson(path.join(root,'request.headers.json')));need(canonical(headers)===canonical(saved.headers),'Selected request headers changed');
 let body;if(saved.body){need(saved.body.path==='request.body','Body path changed');body=await read(path.join(root,'request.body'));need(body.length===saved.body.bytes&&sha(body)===saved.body.sha256,'Original request body changed');}
 return{root,value:saved,body,headers};
}
function challengeName(o){const id=o['capture-id'];need(id===undefined||/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id),'Capture ID must use1..64 letters, digits, underscore or hyphen');return id===undefined?'challenge.http.json':'challenge-'+id+'.http.json';}
async function captureChallenge(o){
 const s=await selected(required(o,'directory'));
 return lock(s.root,async()=>{
  const base=path.join(s.root,challengeName(o));
  if(await exists(base)){const v=verifyHttp(await readJson(base));return{directory:s.root,status:v.status,challengeFile:base,capturedAt:v.retrievedAt,reused:true};}
  const attempted=base.replace(/\.http\.json$/,'.attempt.json'),identity={schema:SCHEMA,kind:'merchant-request-attempt',capture:challengeName(o),url:s.value.url,method:s.value.method,selectionSha256:sha(await read(path.join(s.root,'selection.json'))),headersSha256:sha(json(s.headers)),bodyPresent:s.body!==undefined,bodySha256:s.body===undefined?null:sha(s.body),bodyBytes:s.body===undefined?null:s.body.length};
  if(await exists(attempted)){const prior=await readJson(attempted);for(const [key,value]of Object.entries(identity))need(canonical(prior[key])===canonical(value),'Original attempted request changed: '+key);return{directory:s.root,status:'interrupted_response_unavailable',attemptFile:attempted,startedAt:prior.startedAt,reused:true,message:'Original request was attempted; inspect the merchant result before explicitly creating another capture ID'};}
  await writeNew(attempted,json({...identity,startedAt:new Date().toISOString()}));
  const value=await http(s.value.url,{method:s.value.method,body:s.body,headers:s.headers});
  await writeNew(base,json(value));
  return{directory:s.root,status:value.status,challengeFile:base,capturedAt:value.retrievedAt,paymentRequiredPresent:Boolean(value.headers?.['payment-required']),error:value.error??null};
 });
}
async function native(argv,cwd,logPath,lockFd){
 const startedAt=new Date().toISOString();
 return new Promise((resolve,reject)=>{
  need(Number.isInteger(lockFd),'Original native writer lock required');
  const child=spawn(argv[0],argv.slice(1),{cwd,stdio:['ignore','pipe','pipe',lockFd]});let stdout='',stderr='',size=0;
  const collect=kind=>chunk=>{size+=chunk.length;if(size>16*1024*1024){child.kill('SIGTERM');return;}if(kind==='out')stdout+=chunk;else stderr+=chunk;};
  child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
  child.on('error',reject);child.on('close',async(code,signal)=>{try{const record={argv,startedAt,finishedAt:new Date().toISOString(),code,signal,stdout,stderr};await writeNew(logPath,json(record));need(code===0,'Original native command failed; see '+logPath);resolve(record);}catch(e){reject(e);}});
 });
}
function checkNativeConfig(config,s,actual,envelope,body,headers,nativeRoot){
 const op=config.operation,origin=config.preparedFrom;
 need(op?.intentId===s.intentId&&op.url===s.url&&op.method===s.method,'Native operation changed original identity');
 const expected={scheme:actual.scheme,network:actual.network,asset:actual.asset,payTo:actual.payTo,maxAtomic:actual.amount,maxTimeoutSeconds:actual.maxTimeoutSeconds,...(actual.extra?.paymentFlow!==undefined?{paymentFlow:actual.extra.paymentFlow}:{})};
 need(canonical(op.expect)===canonical(expected),'Native selected payment requirements changed');
 need(origin?.discoveryFileSha256===sha(json(envelope))&&origin.rowIndex===0&&canonical(origin.originalListing)===canonical(envelope.originalListings[0]),'Native saved source changed');
 const normal=x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k.toLowerCase(),v]));need(canonical(normal(op.headers??{}))===canonical(normal(headers)),'Native request headers changed');
 if(body!==undefined)need(op.bodyBytes===body.length&&op.bodySha256===sha(body)&&op.bodyFile===path.join(nativeRoot,'request.body'),'Native original body binding changed');
 else need(op.bodyFile===undefined,'Unexpected native request body');
 need(config.responseFile?.destination===path.join(nativeRoot,'customer-result'),'Native response destination changed');
 need(!config.operator&&!config.signerModule&&!config.ledger,'Receiving preparation unexpectedly contains execution configuration');
}
async function prepare(o){
 const s=await selected(required(o,'directory')),checkout=path.resolve(required(o,'checkout')),cli=path.join(checkout,NATIVE),node=o.node??process.execPath;
 need(await exists(cli),'Original complete installed SF88 checkout required');
 return lock(s.root,async lockFd=>{
  const challengeFile=path.join(s.root,challengeName(o)),response=verifyHttp(await readJson(challengeFile));
  need(response.url===s.value.url&&response.method===s.value.method,'Challenge belongs to another request');
  if(s.body!==undefined)need(response.requestBodySha256===sha(s.body)&&response.requestBodyBytes===s.body.length,'Challenge request body changed');
  else need(response.requestBodySha256===undefined&&response.requestBodyBytes===undefined,'Challenge unexpectedly included a body');
  for(const [name,value]of Object.entries(s.headers))need(response.requestHeaders?.[name]===value,'Challenge request header changed: '+name);
  need(response.status===402,'Actual merchant HTTP402 required; inspect this response before explicitly capturing a fresh attempt with --capture-id ID');
  const header=response.headers?.['payment-required'];need(typeof header==='string'&&header.length<=262144,'Actual PAYMENT-REQUIRED header required');
  const bytes=Buffer.from(header,'base64');need(bytes.toString('base64')===header,'Invalid base64 PAYMENT-REQUIRED');
  const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),matched=challenge(s.value,decoded,Number(required(o,'accept')));
  const nroot=path.join(s.root,'native');if(!await exists(nroot))await privateDir(nroot,{create:true});else await privateDir(nroot);
  await retain(path.join(nroot,'payment-required.json'),bytes);await retain(path.join(nroot,'offers.json'),json(matched.envelope));await retain(path.join(nroot,'request.headers.json'),json(s.headers));
  if(s.body!==undefined)await retain(path.join(nroot,'request.body'),s.body);
  const configFile=path.join(nroot,'review.json'),handoff=path.join(nroot,'buyer-operation.json');
  const argv=[node,cli,'--prepare','--discovery',path.join(nroot,'offers.json'),'--row','0','--accept',String(matched.acceptIndex),'--intent-id',s.value.intentId,'--url',s.value.url,'--method',s.value.method,'--headers-file',path.join(nroot,'request.headers.json'),'--response-out',path.join(nroot,'customer-result'),'--out',configFile,...(s.body!==undefined?['--body-file',path.join(nroot,'request.body')]:[])];
  const logs=await fs.readdir(nroot),suffix=String(logs.filter(x=>x.startsWith('native-command-')).length).padStart(4,'0');let seq=Number(suffix);
  const run=async args=>native(args,checkout,path.join(nroot,'native-command-'+String(seq++).padStart(4,'0')+'.json'),lockFd);
  if(!await exists(configFile))await run(argv);
  const config=await readJson(configFile);checkNativeConfig(config,s.value,matched.actualTerms,matched.envelope,s.body,s.headers,nroot);
  need(config.preparedFrom.acceptIndex===matched.acceptIndex,'Previously selected challenge option differs; preserve this original preparation');
  await run([node,cli,'--review','--config',configFile]);
  if(!await exists(handoff))await run([node,cli,'--export-operation','--config',configFile,'--discovery',path.join(nroot,'offers.json'),'--out',handoff]);
  const h=await readJson(handoff);
  need(h.schema==='stellar-forge.operation-handoff.v2'&&h.intentId===s.value.intentId&&h.url===s.value.url&&h.method===s.value.method&&h.rowIndex===0&&h.ticketHeader===null&&h.files?.ticket===null,'Native handoff differs from selected operation');
  need(canonical(ordinaryHeaders(h.headers))===canonical(s.headers),'Native handoff headers changed');
  const packed=(item,expected,name)=>{need(item&&typeof item.base64==='string','Native handoff '+name+' missing');const raw=Buffer.from(item.base64,'base64');need(raw.toString('base64')===item.base64&&raw.equals(expected)&&sha(raw)===item.sha256,'Native handoff '+name+' changed');};
  packed(h.files.discovery,json(matched.envelope),'original discovery');
  if(s.body===undefined)need(h.files.body===null,'Unexpected native handoff body');else packed(h.files.body,s.body,'original body');
  const record={schema:SCHEMA,kind:'original-native-buyer-preparation',intentId:s.value.intentId,selectionSha256:sha(await read(path.join(s.root,'selection.json'))),challengeFile:challengeName(o),challengeSha256:sha(await read(challengeFile)),actualTerms:matched.actualTerms,changedAmount:matched.changedAmount,configSha256:sha(await read(configFile)),handoffSha256:sha(await read(handoff)),nativeCliSha256:sha(await read(cli)),checkout,configFile,handoff};
  if(!await exists(path.join(nroot,'preparation.json')))await writeNew(path.join(nroot,'preparation.json'),json(record));
  else need(canonical(await readJson(path.join(nroot,'preparation.json')))===canonical(record),'Original prepared edition differs');
  return record;
 });
}
async function main(){
 const [command,...rest]=process.argv.slice(2),o=flags(rest);
 const allowed={capture:['plan','discovery','facilitator','network','limit','directory'],inspect:['directory'],select:['source','selection','directory','body-file','headers-file','content-type'],challenge:['directory','capture-id'],prepare:['directory','checkout','accept','capture-id','node'],pack:['directory','out'],receive:['file','directory'],compare:['before','after','out'],report:['directory','out']};
 if(command!==undefined&&command!=='help'){need(Object.hasOwn(allowed,command),'Unknown command: '+command);for(const key of Object.keys(o))need(allowed[command].includes(key),'Unknown --'+key+' for '+command);}
 if(command==='capture')return capture(o);
 if(command==='inspect')return inspect(o);
 if(command==='select')return select(o);
 if(command==='challenge')return captureChallenge(o);
 if(command==='prepare')return prepare(o);
 if(command==='pack')return pack(required(o,'directory'),required(o,'out'));
 if(command==='receive')return receive(required(o,'file'),required(o,'directory'));
 if(command==='compare'){
  const a=await originalCatalogue(required(o,'before')),b=await originalCatalogue(required(o,'after')),out=compare(a.value,b.value);
  out.beforeSha256=a.sha256;out.afterSha256=b.sha256;await writeNew(required(o,'out'),json(out));return{...out,rows:undefined,output:path.resolve(o.out)};
 }
 if(command==='report'){const c=await originalCatalogue(required(o,'directory'));await writeNew(required(o,'out'),Buffer.from(reportHtml(c.value,c.sha256)));return{report:path.resolve(o.out),resources:c.value.rows.length};}
 return{usage:[
 'capture --directory NEW_OR_ORIGINAL [--plan plan.json]',
 'inspect --directory CATALOGUE',
 'compare --before FIRST --after SECOND --out comparison.json',
 'select --source CATALOGUE --selection saved-selection.json --directory NEW_REQUEST [--body-file FILE] [--headers-file FILE] [--content-type TYPE]',
 'challenge --directory ORIGINAL_REQUEST [--capture-id EXPLICIT_NEW_ATTEMPT]',
 'prepare --directory ORIGINAL_REQUEST --checkout ORIGINAL_INSTALLATION --accept EXACT_CHALLENGE_INDEX [--capture-id ORIGINAL_ATTEMPT] [--node PATH]',
 'pack --directory ORIGINAL --out OUTSIDE_PACKET.json',
 'receive --file PACKET.json --directory NEW_RECEIVING',
 'report --directory CATALOGUE --out NEW_REPORT.html'
 ]};
}
main().then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{process.stderr.write(JSON.stringify({error:String(error.message)})+'\n');process.exitCode=1;});
