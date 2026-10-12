// MIT. Merchant tools compose the retained PMTiles output and original SF88 engines.
import {resolve,join,sep,isAbsolute} from 'node:path';
import {realpath,lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {Buyer} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/client.mjs';
import {operation as originalOperation} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {privateDirectory,readJson,exists} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';
import {need,identifier,clone,digest,hash,plain} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/model.mjs';
import {retainJson} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/files.mjs';
import {PMTilesOutputController} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/commerce/controller.mjs';
import {prepareOutputPurchase,inspectOutputPurchase,runOutputPurchase,recoverOutputPurchase,
  adoptPurchasedMapResource,receivePurchasedMapOperations,selectOutputCatalog}
  from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/commerce/buyer.mjs';
import {fields,outputHash,OUTPUT_METADATA_BYTES}
  from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/pmtiles/commerce/model.mjs';
import {normalizeReleaseRuntime} from '../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';

const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value??{},key)).map(key=>[key,value[key]]));
function separate(a,b){need(a!==b&&!a.startsWith(b+sep)&&!b.startsWith(a+sep),'PMTILES_COMMERCE_SEPARATE_PATHS_REQUIRED');}
function hostPath(value,base){need(typeof value==='string'&&value.length>0&&!value.includes('\0'),'PMTILES_COMMERCE_HOST_PATH_REQUIRED');return resolve(base,value);}
async function canonicalDirectory(path,{privateState=false}={}){
  const info=await lstat(path);need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path,
    'PMTILES_COMMERCE_CANONICAL_DIRECTORY_REQUIRED');
  if(privateState)await privateDirectory(path,{create:false});return path;
}
async function privateConfig(path){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await file.stat();
    need(info.isFile()&&info.size<=65536&&(process.platform==='win32'||
      (info.mode&0o077)===0&&(!process.getuid||info.uid===process.getuid()))&&await realpath(path)===path,
      'PMTILES_COMMERCE_PRIVATE_CONFIGURATION_REQUIRED');
    const bytes=await file.readFile();need(bytes.length<=65536,'PMTILES_COMMERCE_CONFIGURATION_LIMIT');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    need(plain(value),'PMTILES_COMMERCE_CONFIGURATION_OBJECT_REQUIRED');return value;
  }finally{await file.close();}
}
export async function readPMTilesCommerceConfiguration(input,{base,directory,exportsDirectory}){
  input=clone(input??{});fields(input,['runtimes','buyers']);
  const runtimes=Object.create(null),buyers=Object.create(null);
  need(plain(input.runtimes??{})&&Object.keys(input.runtimes??{}).length<=32,'PMTILES_COMMERCE_RUNTIME_LIMIT');
  for(const [name,value]of Object.entries(input.runtimes??{})){
    identifier(name);fields(value,['port','facilitator','allowLocalFacilitator']);
    runtimes[name]=normalizeReleaseRuntime(value);
  }
  need(plain(input.buyers??{})&&Object.keys(input.buyers??{}).length<=32,'PMTILES_COMMERCE_BUYER_LIMIT');
  for(const [name,value]of Object.entries(input.buyers??{})){
    identifier(name);fields(value,['stateDirectory','runtimeDirectory','configuration','operatorProfile'],
      ['stateDirectory','runtimeDirectory','configuration']);
    const stateDirectory=await canonicalDirectory(hostPath(value.stateDirectory,base),{privateState:true});
    const runtimeDirectory=await canonicalDirectory(hostPath(value.runtimeDirectory,base));
    separate(stateDirectory,directory);separate(stateDirectory,runtimeDirectory);
    if(exportsDirectory)separate(stateDirectory,resolve(exportsDirectory));
    const configuration=hostPath(value.configuration,base);await privateConfig(configuration);
    const buyer={stateDirectory,runtimeDirectory,configuration};
    if(value.operatorProfile!==undefined){buyer.operatorProfile=hostPath(value.operatorProfile,base);await privateConfig(buyer.operatorProfile);}
    buyers[name]=buyer;
  }
  return {runtimes,buyers};
}
export function pmtilesCommerceSummary(entry){
  return {runtimes:Object.keys(entry.commerce?.runtimes??{}),buyers:Object.keys(entry.commerce?.buyers??{})};
}
/** Retain the host's original payment boundary, lowering only its visible selected price cap. */
function selectedConfiguration(base,catalog,objectId,requestId){
  base=clone(base);const {row}=selectOutputCatalog(catalog,objectId),op=originalOperation(base.operation);
  need(op.method==='GET'&&new URL(op.url).origin===new URL(row.url).origin&&
    BigInt(row.pricing.atomicPerRequest)<=BigInt(op.expect.maxAtomic)&&
    row.offer.accepts.some(payment=>payment.scheme===op.expect.scheme&&payment.network===op.expect.network&&
      payment.asset===op.expect.asset&&payment.payTo===op.expect.payTo&&
      (op.expect.maxTimeoutSeconds===undefined||payment.maxTimeoutSeconds<=op.expect.maxTimeoutSeconds)),
    'PMTILES_COMMERCE_HOST_PAYMENT_BOUNDARY_CHANGED');
  return {...base,operation:{...op,intentId:requestId,url:row.url,method:'GET',
    expect:{...op.expect,maxAtomic:row.pricing.atomicPerRequest}}};
}
export class MerchantPMTilesCommerce{
  #alias;#entry;#controller;#output;#directory;#packageSelection;#shutdown;
  constructor({alias,entry,controller,exportsDirectory,releaseStore,packageSelection,signal}){
    this.#alias=alias;this.#entry=clone(entry);this.#controller=controller;
    this.#directory=join(resolve(exportsDirectory),'pmtiles-output',identifier(alias));
    this.#output=new PMTilesOutputController({workspace:controller.workspace,directory:join(this.#directory,'merchant'),
      releaseStore,runtimes:entry.commerce?.runtimes??{}});
    this.#packageSelection=packageSelection;this.#shutdown=signal;
  }
  requestClose(){this.#output.requestClose();}
  close(){return this.#output.close();}
  async #buyer(name){
    const selected=this.#entry.commerce?.buyers?.[identifier(name)];
    need(selected,'PMTILES_COMMERCE_BUYER_NOT_CONFIGURED');
    return {selected,buyer:new Buyer(pick(selected,['stateDirectory','runtimeDirectory','operatorProfile']))};
  }
  #purchaseDirectory(requestId){return join(this.#directory,'purchases',identifier(requestId));}
  async #preparePurchase(args){
    const {selected,buyer}=await this.#buyer(args.buyer),requestId=identifier(args.requestId);
    need((args.outputRequestId!==undefined)!==(args.catalog!==undefined),'PMTILES_COMMERCE_ONE_CATALOG_REQUIRED');
    need(args.outputRequestId===undefined?args.manifestSha256===undefined:args.catalogSha256===undefined,
      'PMTILES_COMMERCE_CATALOG_FIELDS_INVALID');
    const root=await privateDirectory(this.#purchaseDirectory(requestId));
    const command={schema:'starforge.pmtiles-mcp-purchase-request.v1',workspace:this.#alias,
      workspaceId:this.#entry.expectedWorkspaceId,buyer:args.buyer,buyerConnection:selected,
      args:clone(args)};
    await retainJson(join(root,'merchant-request.json'),command);
    const preparedPath=join(root,'merchant-input.json');let input;
    if(await exists(preparedPath)){
      const saved=await readJson(preparedPath,OUTPUT_METADATA_BYTES);
      need(saved.commandSha256===digest(command),'PMTILES_COMMERCE_PURCHASE_COMMAND_CHANGED');input=saved.input;
    }else{
      let catalog,catalogSha256;
      if(args.outputRequestId!==undefined){
        const prepared=await this.#output.package(identifier(args.outputRequestId),outputHash(args.manifestSha256),{signal:this.#shutdown});
        catalog=clone(prepared.documents.catalog);catalogSha256=prepared.manifest.catalogSha256;
      }else{catalog=clone(args.catalog);catalogSha256=outputHash(args.catalogSha256);}
      const base=await privateConfig(selected.configuration);
      const configuration=await buyer._profile(selectedConfiguration(base,catalog,args.objectId,requestId));
      input={requestId,catalog,catalogSha256,objectId:args.objectId,configuration,operatorProfile:{},maxTotalAtomic:args.maxTotalAtomic};
      await retainJson(preparedPath,{commandSha256:digest(command),input});
    }
    return prepareOutputPurchase({buyer,directory:join(root,'native-purchase'),input,signal:this.#shutdown});
  }
  async execute(name,args){
    args=clone(args);const scope={expectedWorkspaceId:this.#entry.expectedWorkspaceId};
    const output=(action,input)=>this.#output.execute(action,{...input,...scope},{signal:this.#shutdown});
    const suffix=name.replace(/^merchant_pmtiles_/,'');
    if(suffix==='output_prepare'){
      const input=pick(args,['requestId','releaseId','releaseManifestSha256','offerId','title','origin','payment','chunkBytes']);
      need(Array.isArray(args.objects),'PMTILES_COMMERCE_OBJECTS_REQUIRED');input.objects=[];
      for(const row of args.objects){
        fields(row,['id','resourceId','packageRequestId','archiveSha256','amount','filename'],['id','amount']);
        need((row.resourceId!==undefined)!==(row.packageRequestId!==undefined),'PMTILES_COMMERCE_ONE_OUTPUT_SOURCE_REQUIRED');
        const item=pick(row,['id','resourceId','amount','filename']);
        if(row.packageRequestId!==undefined){
          const selected=await this.#packageSelection(identifier(row.packageRequestId));
          need(selected.result.archive.sha256===outputHash(row.archiveSha256),'PMTILES_COMMERCE_PACKAGE_CHANGED');
          item.package={requestId:row.packageRequestId,stagingDirectory:selected.paths.stagingDirectory,archiveSha256:row.archiveSha256};
        }else need(row.archiveSha256===undefined,'PMTILES_COMMERCE_PACKAGE_FIELDS_INVALID');
        input.objects.push(item);
      }
      return output('prepare',input);
    }
    if(suffix.startsWith('output_')){
      const action=suffix.slice('output_'.length);
      const selections={
        status:[],request:['requestId'],package:['outputRequestId','manifestSha256'],catalog:['outputRequestId','manifestSha256'],
        stage:['requestId','outputRequestId','manifestSha256','releaseId','label','runtime'],
        release:['releaseId','releaseDigest'],compare:['beforeReleaseId','releaseId','releaseDigest'],
        activate:['requestId','releaseId','releaseDigest','expectedGeneration','reason'],
        start:['requestId','releaseId','releaseDigest','expectedGeneration'],
        stop:['requestId','releaseId','releaseDigest','instanceId']};
      need(Object.hasOwn(selections,action),'PMTILES_COMMERCE_TOOL_INVALID');
      return output(action,pick(args,selections[action]));
    }
    if(suffix==='purchase_prepare')return this.#preparePurchase(args);
    const {buyer}=await this.#buyer(args.buyer);
    const purchaseRequestId=identifier(args.purchaseRequestId);
    const directory=join(this.#purchaseDirectory(purchaseRequestId),'native-purchase');
    const common={buyer,directory,requestId:purchaseRequestId,signal:this.#shutdown};
    if(suffix==='purchase_status')return inspectOutputPurchase(common);
    if(suffix==='purchase_run')return runOutputPurchase(common);
    if(suffix==='purchase_recover')return recoverOutputPurchase(common);
    if(suffix==='purchase_adopt')return adoptPurchasedMapResource({buyer,directory,purchaseRequestId,
      workspace:this.#controller.workspace,input:{...scope,requestId:identifier(args.requestId)},signal:this.#shutdown});
    if(suffix==='purchase_receive'){
      const target=this.#entry.receivingTargets[identifier(args.target)];
      need(target,'PMTILES_RECEIVING_TARGET_NOT_CONFIGURED');
      const root=join(target.directory,identifier(args.requestId));
      return receivePurchasedMapOperations({buyer,directory,purchaseRequestId,input:{requestId:args.requestId,
        directory:join(root,'installation'),workspaceDirectory:join(root,'workspace'),
        pythonExecutable:this.#controller.runtime.pythonExecutable.path},signal:this.#shutdown});
    }
    need(false,'PMTILES_COMMERCE_TOOL_INVALID');
  }
}
