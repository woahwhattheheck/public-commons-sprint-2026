// MIT. Continue one original OData source through its merchant and customer receiving.
import { readFile, writeFile, mkdir, realpath, access, open, link, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../');
const load = path => import(pathToFileURL(join(repository, path)).href);
const sdk = 'stellar/scf-starforge-20261009/';
const flags = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  if (!['--connection','--workspace','--edition','--profile','--fields','--name','--expected-semantic','--out'].includes(name) ||
      !value || flags.has(name)) throw new Error('Use distinct documented --name value arguments.');
  flags.set(name, value);
}
for (const name of ['--connection','--workspace','--edition','--profile','--expected-semantic','--out'])
  if (!flags.has(name)) throw new Error('Required original selection: ' + name);
const scope = flags.get('--workspace'), editionId = flags.get('--edition'), profile = flags.get('--profile');
const expectedSemantic = flags.get('--expected-semantic');
if (!/^[a-f0-9]{64}$/.test(expectedSemantic)) throw new Error('Use the original reviewed semantic SHA256.');
const fields = flags.has('--fields') ? flags.get('--fields').split(',').map(value=>value.trim()) : undefined;
if (fields && (fields.some(value=>!value) || new Set(fields).size !== fields.length))
  throw new Error('Select distinct original property paths.');
const output = resolve(flags.get('--out')), sourceConnection = await realpath(resolve(flags.get('--connection')));
const formatted = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const exists = path => access(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
async function digestFile(path) {
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { digest.update(chunk); bytes += chunk.length; }
  return {sha256:digest.digest('hex'),bytes};
}
async function retain(path, bytes) {
  bytes = Buffer.from(bytes); await mkdir(dirname(path),{recursive:true,mode:0o700});
  if (await exists(path)) {
    if ((await digestFile(path)).sha256 !== sha(bytes)) throw new Error('Original operation file changed: '+path);
    return {path,sha256:sha(bytes),bytes:bytes.length};
  }
  const temporary=path+'.writing-'+randomUUID(); let handle;
  try {
    handle=await open(temporary,'wx',0o600); await handle.writeFile(bytes); await handle.sync();
    await handle.close(); handle=null;
    try { await link(temporary,path); } catch(error) {
      if(error.code!=='EEXIST'||(await digestFile(path)).sha256!==sha(bytes))throw error;
    }
  } finally { await handle?.close(); await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
  return {path,sha256:sha(bytes),bytes:bytes.length};
}
await mkdir(output,{recursive:true,mode:0o700});
const originalConnectionBytes = await readFile(sourceConnection), originalConnection = JSON.parse(originalConnectionBytes);
const selected = structuredClone(originalConnection.workspaces?.[scope]);
if (originalConnection.schema !== 'stellar-forge.odata-workspace-connection.v1' || !selected?.directory || !selected.merchants?.[profile])
  throw new Error('Select the original declared workspace and merchant profile.');
selected.directory=await realpath(resolve(dirname(sourceConnection),selected.directory));
for (const kind of ['imports','responses']) for (const value of Object.values(selected[kind]||{}))
  value.file=await realpath(resolve(dirname(sourceConnection),value.file));
const customerScope = 'semantic-customer';
if (scope===customerScope) throw new Error('Keep the original source alias distinct from its receiving workspace.');
const sourceReceiver=join(output,'source-receiving');
await mkdir(sourceReceiver,{recursive:true,mode:0o700});
const connection={schema:originalConnection.schema,workspaces:{
  [scope]:selected,[customerScope]:{directory:sourceReceiver,services:selected.services||{}}
}};
const connectionPath=join(output,'connection.json');
await retain(connectionPath,formatted(connection));
const {initializeODataWorkspaceMerchant}=await load('stellar-forge/mcp-merchant-operator/config.mjs');
const {openMerchantOperator}=await load('stellar-forge/mcp-merchant-operator/operator.mjs');
const {inspectDatasetPage}=await load(sdk+'sf88-operator-buyer-cli/dataset-page.mjs');
const {prepareReview}=await load(sdk+'sf88-operator-buyer-cli/prepare.mjs');
const {compileHttpSellerOffer}=await load(sdk+'sf30-seller-sdk/seller.mjs');
const {init,append,scan,finalize}=await load(sdk+'sf100-buyer-dataset-delivery/deliver.mjs');
const configPath=join(output,'operator/merchant-mcp.json');
if (!await exists(configPath)) await initializeODataWorkspaceMerchant({
  directory:join(output,'operator'),connection:connectionPath,name:'Original OData semantic receiving'
});
const room=join(output,'customer-room'), steps=[], startedAt=new Date().toISOString();
const inputBindingSha256=sha(formatted({connection:sha(originalConnectionBytes),scope,editionId,profile,
  fields:fields??null,name:flags.get('--name')??null,expectedSemantic}));
if(await exists(join(output,'operation.json'))){
  const original=JSON.parse(await readFile(join(output,'operation.json')));
  if(original.inputBindingSha256!==inputBindingSha256)throw new Error('This operation directory belongs to a different original selection.');
  const received=await scan(room,{retainPayload:false}),transfer=await digestFile(original.sourceTransfer.path);
  if(!received.finalized||received.chain!==original.chain||received.count!==original.rows||
      transfer.sha256!==original.sourceTransfer.sha256||transfer.bytes!==original.sourceTransfer.bytes)
    throw new Error('The completed original receiving files changed.');
  console.log(JSON.stringify({state:'COMPLETE',reused:true,output,customerRoom:room,scanFile:original.scanFile,
    rows:original.rows,pages:original.pages,semanticSha256:expectedSemantic,sourceTransfer:original.sourceTransfer}));
  process.exit(0);
}
let operator, sourceInstance, customerInstance, merchant;
async function call(name,args={}) {
  const result=await operator.call(name,args);
  steps.push({name,action:args.action||null,workspace:args.workspace||null,completedAt:new Date().toISOString()});
  return result;
}
async function download(args,destination) {
  await mkdir(dirname(destination),{recursive:true,mode:0o700});
  const temporary=destination+'.writing-'+randomUUID();let handle,part,offset=0,digest=createHash('sha256');
  try {
    handle=await open(temporary,'wx',0o600);
    do {
      part=await call('merchant_odata_file',{...args,offset,limit:65536,
        ...(part?{readId:part.readId,expectedSha256:part.file.sha256}:{})});
      const bytes=Buffer.from(part.data,'base64');
      if(part.encoding!=='base64'||part.offset!==offset||part.bytesRead!==bytes.length)
        throw new Error('Original retained-file chunk changed.');
      digest.update(bytes);await handle.writeFile(bytes);offset+=bytes.length;
    }while(part.nextOffset!==null);
    if(digest.digest('hex')!==part.file.sha256||offset!==part.file.bytes)
      throw new Error('Original complete retained-file identity changed.');
    await handle.sync();await handle.close();handle=null;
    if(await exists(destination)){
      if((await digestFile(destination)).sha256!==part.file.sha256)throw new Error('Receiving filename belongs to different original bytes.');
    }else {
      try { await link(temporary,destination); } catch(error) {
        if(error.code!=='EEXIST'||(await digestFile(destination)).sha256!==part.file.sha256)throw error;
      }
    }
    return {path:destination,...part.file};
  }finally{
    await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(part?.nextOffset!==null&&part?.readId)await operator?.call('merchant_odata_file_release',{workspace:args.workspace,readId:part.readId}).catch(()=>{});
  }
}
try{
  operator=await openMerchantOperator(configPath);
  if(!operator.tools.some(tool=>tool.name==='merchant_odata_semantics'))throw new Error('The installed host lacks the original semantic preview operation.');
  const opened=await call('merchant_odata_open',{workspace:scope});sourceInstance=opened.instanceId;
  const edition=await call('merchant_odata_edition',{workspace:scope,action:'inspect',editionId,limit:100});
  const dictionary=await call('merchant_odata_semantics',{workspace:scope,editionId,...(fields?{fields}:{})});
  if(dictionary.sha256!==expectedSemantic||edition.status!=='COMPLETE'||!dictionary.primaryKey.complete)
    throw new Error('Original complete source/key or reviewed dictionary changed.');
  const exported=await call('merchant_odata_export',{workspace:scope,editionId,profile,
    ...(fields?{fields}:{}),...(flags.has('--name')?{name:flags.get('--name')}:{name:edition.label}),
    expectedSemanticSha256:expectedSemantic});
  if(exported.semantics.sha256!==expectedSemantic)throw new Error('Export lost its reviewed dictionary.');
  const exportedDirectory=join(output,'merchant-source',exported.id), files=[];
  for(const filename of exported.files)files.push(await download({workspace:scope,kind:'dataset',id:exported.id,filename},join(exportedDirectory,filename)));
  const dictionaryFile=join(exportedDirectory,'semantics.json');
  if(sha(await readFile(dictionaryFile))!==sha(formatted(dictionary)))throw new Error('Downloaded dictionary differs from its reviewed original.');
  const releaseId='semantic-'+exported.id.slice(0,32);
  let publisher=await call('merchant_odata_publisher',{workspace:scope,action:'status'});
  if(!publisher.releases.some(release=>release.id===releaseId))
    await call('merchant_odata_publisher',{workspace:scope,action:'prepare',exportId:exported.id,releaseId,label:exported.dataset.name});
  publisher=await call('merchant_odata_publisher',{workspace:scope,action:'status'});
  const inspected=await call('merchant_odata_publisher',{workspace:scope,action:'inspect',releaseId});
  if(publisher.state.active!==releaseId)
    await call('merchant_odata_publisher',{workspace:scope,action:'activate',releaseId,
      expectedGeneration:publisher.state.generation,reason:'Operate the original reviewed OData source and complete customer receiving'});
  publisher=await call('merchant_odata_publisher',{workspace:scope,action:'status'});
  merchant=await call('merchant_odata_publisher',{workspace:scope,action:'start',
    expectedGeneration:publisher.state.generation,expectedDigest:inspected.digest});
  const selection=new URLSearchParams({limit:'200',sort:dictionary.primaryKey.projected[0],snapshot:exported.dataset.snapshot,semantics:expectedSemantic});
  const challenge=await fetch(merchant.url+selected.merchants[profile].path+'?'+selection,{signal:AbortSignal.timeout(15000)});
  const challengeBytes=Buffer.from(await challenge.arrayBuffer());
  if(challenge.status!==402)throw new Error('Original dataset merchant did not return its native payment challenge.');
  const challengeFile=await retain(join(output,'seller-challenge.json'),challengeBytes);
  const stagedSeller=JSON.parse(await readFile(join(selected.directory,'publisher','packages',exported.id,'seller.json')));
  const route=stagedSeller.routes[0];
  const offer=route.offer||compileHttpSellerOffer({...route.definition,url:stagedSeller.publicOrigin+route.path});
  const discovery=formatted({resources:[offer]}),discoveryFile=await retain(join(output,'buyer-offers.json'),discovery);
  if(!await exists(join(room,'session.json')))await init(room);
  let received=await scan(room,{retainPayload:false}),previous=null;
  if(received.pages.length){
    const last=JSON.parse(await readFile(join(room,'pages',String(received.pages.length-1).padStart(5,'0')+'.json')));
    previous=inspectDatasetPage(formatted(last.payload),{expectedSnapshot:exported.dataset.snapshot});
  }
  while(!received.finalized&&(received.pages.length===0||received.nextCursor!==null)){
    const index=received.pages.length,cursor=received.nextCursor,query=new URLSearchParams(selection);
    if(cursor!==null)query.set('cursor',cursor);
    const response=await call('merchant_odata_query',{workspace:scope,exportId:exported.id,query:query.toString()});
    const url=stagedSeller.publicOrigin+route.path+'?'+query;
    if(response.status!==200||response.headers['x-dataset-semantics-sha256']!==expectedSemantic)
      throw new Error('Original semantic dataset response changed.');
    const raw=formatted(response.body);
    previous=inspectDatasetPage(raw,{url,previous,expectedSnapshot:exported.dataset.snapshot,responseHeaders:response.headers});
    const intent='odata-semantic-'+exported.id.slice(0,16)+'-'+String(index).padStart(5,'0');
    const prepared=prepareReview(discovery,{rowIndex:0,acceptIndex:0,intentId:intent,url,method:'GET'});
    const prefix=join(output,'customer-original-pages',String(index).padStart(5,'0'));
    const pageFile=await retain(prefix+'.json',raw),buyerFile=await retain(prefix+'-buyer.json',prepared.data);
    const evidence=await retain(prefix+'-source-response.json',formatted({
      schema:'stellar-forge.original-dataset-response.v1',status:response.status,headers:response.headers,
      url,exportId:exported.id,bodySha256:pageFile.sha256,buyerConfigSha256:prepared.configSha256,
      buyerConfig:buyerFile.path,sourceDictionarySha256:sha(formatted(dictionary))
    }));
    await append(room,{page:pageFile.path,evidence:evidence.path,intent,...(cursor===null?{}:{cursor})});
    received=await scan(room,{retainPayload:false});
  }
  if(!received.finalized)await finalize(room);
  const finalized=await scan(room,{retainPayload:false});
  if(!finalized.finalized||finalized.nextCursor!==null||finalized.count!==exported.dataset.rowCount)
    throw new Error('Original customer receiving remains incomplete.');
  if(sha(await readFile(join(room,'semantics.json')))!==sha(formatted(dictionary)))
    throw new Error('Customer receiving changed the original semantic dictionary.');
  await call('merchant_odata_publisher',{workspace:scope,action:'stop',instanceId:merchant.instanceId});merchant=null;
  const transferId='semantics-'+exported.id.slice(0,32);
  const transfer=await call('merchant_odata_transfer',{workspace:scope,action:'create',transferId});
  const transferFile=await download({workspace:scope,kind:'transfer',id:transferId},join(output,'source-workspace.json'));
  if(transferFile.sha256!==transfer.sha256)throw new Error('Original source transfer changed.');
  const customer=await call('merchant_odata_open',{workspace:customerScope});customerInstance=customer.instanceId;
  const restore=await call('merchant_odata_transfer',{workspace:customerScope,action:'restore',sourceWorkspace:scope,transferId});
  const repeat=await call('merchant_odata_transfer',{workspace:customerScope,action:'restore',sourceWorkspace:scope,transferId});
  if(JSON.stringify(restore)!==JSON.stringify(repeat))throw new Error('Exact source receiving changed on repeat.');
  await call('merchant_odata_close',{workspace:customerScope,instanceId:customerInstance});customerInstance=null;
  const reopened=await call('merchant_odata_open',{workspace:customerScope});customerInstance=reopened.instanceId;
  const reopenedMeaning=await call('merchant_odata_semantics',{workspace:customerScope,editionId,...(fields?{fields}:{})});
  const restoredDictionary=await download({workspace:customerScope,kind:'dataset',id:exported.id,filename:'semantics.json'},join(output,'received-semantics.json'));
  if(reopenedMeaning.sha256!==expectedSemantic||restoredDictionary.sha256!==sha(formatted(dictionary)))
    throw new Error('Reopen changed the original source meaning.');
  const scanFile=await retain(join(output,'finalized-scan.json'),formatted(finalized));
  const result={schema:'stellar-forge.odata-semantic-customer-operation.v1',startedAt,completedAt:new Date().toISOString(),
    node:process.version,inputBindingSha256,originalConnection:{path:sourceConnection,sha256:sha(originalConnectionBytes)},
    sourceWorkspace:selected.directory,workspaceAlias:scope,editionId,sourceRows:edition.rowCount,sourcePages:edition.pageCount,
    semanticSha256:expectedSemantic,definitionSha256:dictionary.definitionSha256,dictionarySha256:sha(formatted(dictionary)),
    exported,releaseId,releaseDigest:inspected.digest,challenge:{status:challenge.status,...challengeFile},
    files,discovery:discoveryFile,customerRoom:room,scanFile:scanFile.path,rows:finalized.count,pages:finalized.pages.length,
    chain:finalized.chain,sourceTransfer:transferFile,sourceReceiving:{directory:sourceReceiver,restore,repeat,reopened:true},
    steps};
  await retain(join(output,'operation.json'),formatted(result));
  console.log(JSON.stringify({state:'COMPLETE',output,customerRoom:room,scanFile:scanFile.path,
    rows:finalized.count,pages:finalized.pages.length,semanticSha256:expectedSemantic,sourceTransfer:transferFile}));
}finally{
  if(merchant)await operator?.call('merchant_odata_publisher',{workspace:scope,action:'stop',instanceId:merchant.instanceId}).catch(()=>{});
  if(customerInstance)await operator?.call('merchant_odata_close',{workspace:customerScope,instanceId:customerInstance}).catch(()=>{});
  if(sourceInstance)await operator?.call('merchant_odata_close',{workspace:scope,instanceId:sourceInstance}).catch(()=>{});
  await operator?.close();
}
