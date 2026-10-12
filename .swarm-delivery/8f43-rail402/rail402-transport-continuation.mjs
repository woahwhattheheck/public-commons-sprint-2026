// MIT. Continue the original Rail operator through native CONNECT and retained checkout attempts.
import { readFile, open, mkdir, lstat, link, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const root='/workspace/scratch/8f4370a17e6f/rail402-native-live';
const native='/dev/shm/routescan-native-runtime-39da/stellar/scf-starforge-20261009';
const needed={'sf88-operator-buyer-cli/config.mjs':'55c0bcf95c6c42d9a49656590fcea46f0d6dbf42','sf88-operator-buyer-cli/execute.mjs':'0197005bba9821b71ebfed87428440da851c9dfa','sf88-operator-buyer-cli/workspace.mjs':'cae26863eb594f4c970d694d69de9de1a820f0ab','sf31-buyer-client/public-transport.mjs':'0ef8f66231dfd5131ca0f440ac1a64e40bb1b287','sf82-checkout-evidence/evidence.mjs':'b741de742cd347e119ba5dd797445ad3b7edb942','sf81-buyer-operator-bridge/bridge.mjs':'a3ab5ba295579435fff03d4c42f05072688cd017'};
const reviewed=Object.keys(needed);
const routes={weather:['GET','https://demo.rail402.dev/weather?city=Ankara','10000'],profile:['GET','https://demo.rail402.dev/users/42','10000'],translate:['POST','https://demo.rail402.dev/translate','20000']};
const payer='GDCPSCLRFZFT3RCAJ67DCNCTBQW3DLMRZYM4OWXCZI7J6XC3ZZKMGQOG';
const asset='CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',payTo='GBSVTVRQ4AEFRNGH2MIOOWZSAVLZKOKNKI4UAGSMBZSNRP4I3FL3ELYP';
const need=(value,message)=>{if(!value)throw new Error(message);};
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
async function privateBytes(path){
 const info=await lstat(path);need(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&info.size<=1048576,'Use the original private operator file.');
 return readFile(path);
}
async function retain(path,raw){
 const temporary=path+'.'+randomUUID()+'.tmp';let file,owned=false;
 try{
  file=await open(temporary,'wx',0o600);owned=true;await file.writeFile(raw);await file.sync();await file.close();file=undefined;
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
  need((await privateBytes(path)).equals(raw),'Retained native transport selection differs.');
 }finally{
  if(file)await file.close().catch(()=>{});
  if(owned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
}
async function main(){
 const [action,route]=process.argv.slice(2);
 need(['prepare','execute'].includes(action)&&Object.hasOwn(routes,route),'Use prepare|execute weather|profile|translate.');
 const sourcePins={};
 for(const name of reviewed){
  const raw=await readFile(join(native,name));const git=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
  if(needed[name])need(git===needed[name],'The reviewed original native source changed.');
  sourcePins[name]={gitBlob:git,sha256:hash(raw),bytes:raw.length};
 }
 const {openWorkspace}=await import(pathToFileURL(join(native,'sf88-operator-buyer-cli/workspace.mjs')).href);
 const {config,execution}=await import(pathToFileURL(join(native,'sf88-operator-buyer-cli/config.mjs')).href);
 const {normalizeBuyerTransport,resolveBuyerProxy}=await import(pathToFileURL(join(native,'sf31-buyer-client/public-transport.mjs')).href);
 const directory=join(root,'operations',route),operator=join(directory,'operator'),transportRoot=join(directory,'native-transport');
 let out=join(transportRoot,'checkout-continuation-v1');
 const originalRaw=await privateBytes(join(operator,'operator.json'));
 const opened=await openWorkspace(['--dir',operator]);
 need(json(opened.config).equals(json(JSON.parse(originalRaw))),'Original workspace config changed while opening.');
 const [method,url,maxAtomic]=routes[route],op=opened.config.operation;
 need(op.intentId==='rail402-'+route+'-receiving-20261012-8f43'&&op.method===method&&op.url===url&&op.expect.network==='stellar:testnet'&&op.expect.asset===asset&&op.expect.payTo===payTo&&op.expect.maxAtomic===maxAtomic&&opened.config.trustedPayer===payer,'Preserve the original Rail request, terms and funded payer.');
 need(opened.manifest.sourceConfig===join(directory,'request','review.json')&&opened.config.operator.actor==='rail402-receiver-8f43'&&opened.config.operator.service==='rail402-merchant','Preserve the original customer and operator.');
 need(opened.config.buyerTransport===undefined,'Preserve an already selected original transport.');
 const transport=normalizeBuyerTransport({mode:'explicit-connect',origin:'https://demo.rail402.dev',proxyEnv:'HTTPS_PROXY'});
 resolveBuyerProxy(transport,process.env);
 const terminalPath=join(opened.config.evidenceDir,hash(Buffer.from(op.intentId))+'.json');
 let retainedFailure=null;
 try{
  const raw=await privateBytes(terminalPath),terminal=JSON.parse(raw);
  need(terminal.schema==='scf82.checkout-evidence.v1'&&terminal.intentId===op.intentId,'Reopen the original checkout evidence for this exact request.');
  if(route==='weather'&&hash(raw)==='b82a27493651145d440fdbf32a49916564e699dd517bf5da2e43c8a92ff82bd1'&&
    terminal.operatorReservation===null&&terminal.report?.counts?.signedAttempts===0&&
    terminal.report?.counts?.verifiedTransfers===0&&terminal.report?.counts?.uncertainOrPending===0&&
    terminal.observation?.buyer?.status==='BLOCKED_BEFORE_SIGNATURE'&&
    terminal.observation?.buyer?.reason==='INITIAL_TRANSPORT_FAILED'&&
    terminal.observation?.buyer?.attempts===0){
   retainedFailure={path:terminalPath,sha256:hash(raw),intentId:op.intentId,
    reason:terminal.observation.buyer.reason,bytes:raw.length};
   out=join(transportRoot,'after-initial-transport-failure');
  }else{
   console.log(JSON.stringify({status:'RAIL402_ORIGINAL_CHECKOUT_AVAILABLE',route,evidencePath:terminalPath,
    intentId:op.intentId,action:'Continue the original saved checkout and its SF36 ledger.'}));
   return;
  }
 }catch(error){if(error.code!=='ENOENT')throw error;}
 try{await mkdir(transportRoot,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const transportInfo=await lstat(transportRoot);need(transportInfo.isDirectory()&&!transportInfo.isSymbolicLink()&&!(transportInfo.mode&0o077),'Keep the original transport directory private.');
 const derived={...opened.config,buyerTransport:transport,...(retainedFailure?{evidenceDir:join(out,'evidence')}:{})};execution(derived);
 try{await mkdir(out,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const info=await lstat(out);need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077),'Keep the selected transport directory private.');
 if(retainedFailure){
  try{await mkdir(derived.evidenceDir,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const evidence=await lstat(derived.evidenceDir);need(evidence.isDirectory()&&!evidence.isSymbolicLink()&&!(evidence.mode&0o077),'Keep this native checkout output private.');
 }
 const derivedRaw=json(derived),manifest={schema:'commons.rail402.original-operator-transport.v1',operator,originalConfigSha256:hash(originalRaw),derivedConfigSha256:hash(derivedRaw),difference:retainedFailure?['buyerTransport','evidenceDir']:['buyerTransport'],transport,sourcePins,intentId:op.intentId,publicKey:payer,retainedFailure,originalLedger:opened.config.operator.ledger};
 await retain(join(out,'buyer.json'),derivedRaw);
 await retain(join(out,'derivation.json'),json(manifest));
 const saved=await config(join(out,'buyer.json'));
 const {buyerTransport:removed,evidenceDir:selectedEvidence,...rest}=saved;
 const {evidenceDir:originalEvidence,...originalRest}=opened.config;
 need(json(rest).equals(json(originalRest))&&json(removed).equals(json(transport))&&selectedEvidence===(retainedFailure?join(out,'evidence'):originalEvidence),'Preserve the original operation and SF36 ledger; select only transport and this retained attempt output.');
 if(retainedFailure){
  const path=retainedFailure.path;
  const prior=join(out,'initial-unpaid-evidence.json');
  try{await privateBytes(prior);}catch(error){
   if(error.code!=='ENOENT')throw error;
   const raw=await privateBytes(path);await retain(prior,raw);
  }
 }
 console.log(JSON.stringify({status:'RAIL402_NATIVE_TRANSPORT_PREPARED',route,intentId:op.intentId,originalConfigSha256:manifest.originalConfigSha256,derivedConfigSha256:manifest.derivedConfigSha256,evidenceDir:saved.evidenceDir,originalLedger:manifest.originalLedger,retainedFailureSha256:retainedFailure?.sha256??null}));
 if(action==='prepare')return;
 try{
  await privateBytes(saved.responseFile.destination);
  console.log(JSON.stringify({status:'RAIL402_ORIGINAL_RESPONSE_AVAILABLE',route,destination:saved.responseFile.destination,action:'Use the original receiving result command.'}));
  return;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 for(const folder of [...new Set([transportRoot,out])])for(const name of await readdir(folder)){
  if(!/^native-outcome-[a-f0-9]{64}\.json$/.test(name))continue;
  const raw=await privateBytes(join(folder,name));need(name==='native-outcome-'+hash(raw)+'.json','Retained native outcome changed.');
  const prior=JSON.parse(raw);
  need(prior.intentId===op.intentId,'The original outcome belongs to a different request.');
  if(prior.operatorReservation||prior.originalOutcomeReport?.counts?.signedAttempts>0||prior.error?.paymentSent===true){
   console.log(JSON.stringify({status:'RAIL402_ORIGINAL_OUTCOME_AVAILABLE',route,outcomeFile:join(folder,name),action:'Continue original outcome and merchant response receiving.'}));
   return;
  }
 }
 try{
  const selectedTerminal=join(saved.evidenceDir,hash(Buffer.from(op.intentId))+'.json');
  await privateBytes(selectedTerminal);
  console.log(JSON.stringify({status:'RAIL402_SELECTED_CHECKOUT_AVAILABLE',route,evidencePath:selectedTerminal,
   intentId:op.intentId,action:'Continue this retained checkout result and original SF36 ledger.'}));
  return;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 need(process.stdin.isTTY,'Use the original controlling operator terminal.');
 const account=JSON.parse(await privateBytes(join(root,'funding','testnet-account.json')));
 need(account.publicKey===payer&&account.network==='stellar:testnet','Use the same retained private testnet payer.');
 const previousSecret=process.env.RAIL402_TESTNET_SECRET;
 process.env.RAIL402_TESTNET_SECRET=account.secret;
 const current=await openWorkspace(['--dir',operator],{execute:true});
 need(hash(await privateBytes(join(operator,'operator.json')))===manifest.originalConfigSha256&&json(current.config).equals(json(opened.config)),'Original operator changed after transport review.');
 const {execute}=await import(pathToFileURL(join(native,'sf88-operator-buyer-cli/execute.mjs')).href);
 const {selectStellarEvidenceEndpoint}=await import(pathToFileURL(join(native,'sf43-agent-commerce/verify.mjs')).href);
 const controller=new AbortController();let cancelled;
 const interrupt=()=>{cancelled??=130;controller.abort();},terminate=()=>{cancelled??=143;controller.abort();};
 process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
 try{
  const result=await execute(saved,{environment:current.operatorEnvironment,signal:controller.signal,evidenceRpcEndpoint:selectStellarEvidenceEndpoint(current.manifest.network,current.manifest.signer.rpcUrl)});
  await retain(join(out,'native-outcome-'+hash(json(result))+'.json'),json(result));
 }finally{
  if(previousSecret===undefined)delete process.env.RAIL402_TESTNET_SECRET;
  else process.env.RAIL402_TESTNET_SECRET=previousSecret;
  process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);
  if(cancelled!==undefined)process.exitCode=cancelled;
 }
}
main().catch(error=>{console.error(JSON.stringify({status:'RAIL402_NATIVE_TRANSPORT_CONTINUES',message:error.code??error.message}));process.exitCode||=1;});
