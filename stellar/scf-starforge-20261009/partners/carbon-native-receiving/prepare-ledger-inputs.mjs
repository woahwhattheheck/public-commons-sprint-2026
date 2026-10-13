#!/usr/bin/env node
// MIT. Retain original public ledger responses and derive native capture hashes.
// This reader never signs, submits, classifies a donation, or changes a workspace.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,basename,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const SHA256=value=>createHash('sha256').update(value).digest('hex');
const HASH=/^[a-f0-9]{64}$/i;
function need(value,message){if(!value)throw new Error(message);}
function optionList(argv){
  const options={ledgerFiles:[]};
  for(let i=0;i<argv.length;i++){
    const key=argv[i],value=argv[++i];
    need(['--source-root','--output','--sdk-module','--source-manifest','--ledger-json'].includes(key)&&value&&!value.startsWith('--'),
      'Use --source-root, --output, --sdk-module, --source-manifest and one or more --ledger-json paths.');
    if(key==='--ledger-json')options.ledgerFiles.push(value);else options[key.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  }
  return options;
}
function get(value,name){return typeof value?.[name]==='function'?value[name]():value?.[name];}
function plain(value){return value!==null&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
function strings(value,found=new Set()){
  if(typeof value==='string')found.add(value);
  else if(Array.isArray(value))for(const v of value)strings(v,found);
  else if(value instanceof Map)for(const [k,v]of value){strings(k,found);strings(v,found);}
  else if(plain(value))for(const v of Object.values(value))strings(v,found);
  return found;
}
function baseAccount(sdk,value){
  if(typeof value!=='string')return value;
  if(value.startsWith('M')&&sdk.MuxedAccount?.fromAddress){
    try{return sdk.MuxedAccount.fromAddress(value,'0').baseAccount().accountId();}catch{}
  }
  return value;
}
function closeTime(row){
  const original=row.ts??row.created_at??row.createdAt;
  if(typeof original==='string'&&/^\d+$/.test(original)){
    const seconds=BigInt(original);
    need(seconds<=8640000000000n,'The original ledger timestamp is outside the civil date range.');
    return new Date(Number(seconds*1000n)).toISOString();
  }
  if(typeof original==='string'&&/^\d{4}-\d\d-\d\dT/.test(original)){
    const value=new Date(original);need(!Number.isNaN(value.getTime()),'The original ledger timestamp is invalid.');return value.toISOString();
  }
  throw new Error('The original ledger row must retain its native close timestamp.');
}
function inspectOperations(sdk,transaction,account,contract){
  const reasons=[];
  if(baseAccount(sdk,transaction.source)===account)reasons.push({kind:'transaction-source',account});
  for(const [index,operation]of transaction.operations.entries()){
    const seen=strings(operation);
    for(const address of seen)if(baseAccount(sdk,address)===account){
      reasons.push({kind:'native-operation-address',operationIndex:String(index),operationType:operation.type,account});break;
    }
    if(operation.type==='invokeHostFunction'){
      const fn=operation.func;
      const tag=get(fn,'switch');
      if((tag?.name||tag)==='hostFunctionTypeInvokeContract'){
        const call=get(fn,'invokeContract');
        const called=sdk.Address.fromScAddress(get(call,'contractAddress')).toString();
        if(called===contract)reasons.push({kind:'native-contract-call',operationIndex:String(index),contract:called,
          function:Buffer.from(get(call,'functionName')).toString('utf8')});
        const args=get(call,'args')||[];
        for(const arg of args){
          const values=strings(sdk.scValToNative(arg));
          if([...values].some(value=>baseAccount(sdk,value)===account)){
            reasons.push({kind:'native-contract-argument',operationIndex:String(index),contract:called,account});break;
          }
        }
      }
    }
  }
  return reasons;
}

/**
 * Prepare exact historical hashes for the unchanged captureLedger options.
 * Inputs are the whole original public /ledger/{sequence}/tx JSON responses.
 * The output must be a new private directory within the bootstrap-owned source
 * root so the native final archive includes every original file and selection.
 */
export async function prepareArchiveInputs(options={}){
  need(Number(process.versions.node.split('.')[0])>=22,'Use the existing Node 22 or newer runtime.');
  need(options.sourceRoot&&options.output&&options.ledgerFiles?.length,
    'Select the original source root, a new output directory and whole original ledger JSON files.');
  const sourceRoot=resolve(options.sourceRoot),output=resolve(options.output);
  need(output.startsWith(sourceRoot+'/')&&output!==sourceRoot,
    'Choose a new archive-input directory inside the original private bootstrap source root.');
  const partner=join(sourceRoot,'stellar/scf-starforge-20261009/partners/cfce-givecredit-statements');
  const [{CFCE_LEDGER_DEFAULTS:defaults},{parseNativeJSON}]=await Promise.all([
    import(pathToFileURL(join(partner,'ledger.mjs')).href),
    import(pathToFileURL(join(partner,'source.mjs')).href),
  ]);
  need(defaults.network==='mainnet','These retained original explorer responses are from mainnet.');
  const sdk=options.sdk||(options.sdkModule?await import(pathToFileURL(resolve(options.sdkModule)).href):await import('@stellar/stellar-sdk'));
  need(sdk.Networks.PUBLIC===defaults.networkPassphrase,'Use the original Stellar public network passphrase.');
  await mkdir(output,{mode:0o700});
  await mkdir(join(output,'originals'),{mode:0o700});
  const manifest={schema:'stellar-forge.givecredit-archive-inputs.v1',operation:'SCF-CARBON-NATIVE-8D45-20261012',
    startedAt:new Date().toISOString(),status:'reading',network:'mainnet',networkPassphrase:defaults.networkPassphrase,
    sourceRoot,output,account:defaults.account,contract:defaults.contractId,
    selectionBasis:'Exact original transaction source, native operation address, invoked contract or native contract argument.',
    sourceCoverage:'Only the supplied complete original ledger responses; the retained Horizon account history is a separate source scope.',
    files:[],selected:[],issues:[],totalRows:'0',decodedRows:'0'};
  const writeManifest=()=>writeFile(join(output,'archive-inputs.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  const originalLedgerSources=[];
  let total=0,decoded=0;
  try{
    need(options.sourceManifest,'Provide the retained public source supplement manifest for original URL and acquisition provenance.');
    const supplementRaw=await readFile(resolve(options.sourceManifest),'utf8');
    const supplement=JSON.parse(supplementRaw);
    need(supplement.schema==='stellar-forge.givecredit-public-source-supplement.v1'&&supplement.account===defaults.account,
      'Use the matching original GiveCredit public source supplement manifest.');
    await writeFile(join(output,'public-source-manifest.json'),supplementRaw,{flag:'wx',mode:0o600});
    manifest.sourceManifest={file:'public-source-manifest.json',bytes:Buffer.byteLength(supplementRaw),sha256:SHA256(supplementRaw)};
    const names=new Set(),seen=new Map();
    for(const supplied of options.ledgerFiles){
      const input=resolve(supplied),name=basename(input);
      need(!names.has(name),'Original ledger input filenames must be unique.');names.add(name);
      const raw=await readFile(input),text=raw.toString('utf8');
      need(Buffer.from(text,'utf8').equals(raw),'Original ledger responses must retain valid UTF-8 bytes.');
      const original=supplement.files.find(file=>file.filename===name&&file.kind==='explorer-ledger');
      need(original&&original.bytes===raw.length,'The supplied whole ledger file must match its retained source manifest and size.');
      const relative='originals/'+name;
      await writeFile(join(output,relative),raw,{flag:'wx',mode:0o600});
      const document=parseNativeJSON(text);
      const rows=Array.isArray(document)?document:document?._embedded?.records;
      need(Array.isArray(rows),'Expected the complete original ledger transaction array or its original record envelope.');
      const file={file:relative,bytes:raw.length,sha256:SHA256(raw),rows:String(rows.length),decodedRows:'0',selectedRows:'0'};
      const ledgerIds=[...new Set(rows.map(row=>String(row.ledger)))];
      need(ledgerIds.length===1&&/^[1-9]\d*$/.test(ledgerIds[0]),'Keep one complete original ledger per source response.');
      const sourceUrl=original.sourceRequest.url||original.sourceRequest.source_url;
      need(sourceUrl==='https://api.stellar.expert/explorer/public/ledger/'+ledgerIds[0]+'/tx',
        'The original source URL must identify the same native ledger as all retained rows.');
      const importedAt=new Date().toISOString();
      originalLedgerSources.push({format:'stellar-expert-ledger-json',sourceUrl,ledger:ledgerIds[0],content:text,retrievedAt:null,importedAt,
        acquisition:{transport:'notion-direct-source-url-import',fileUploadId:original.fileUploadId,
          sourceImportRecordedAt:original.sourceRequest.requestedAt||null},
        recordContainer:Array.isArray(document)?'array':'hal-records'});
      Object.assign(file,{ledger:ledgerIds[0],sourceUrl,importedAt,fileUploadId:original.fileUploadId});
      manifest.files.push(file);
      let selectedCount=0,fileDecoded=0;
      for(const [index,row]of rows.entries()){
        total++;
        try{
          need(plain(row)&&typeof row.body==='string','A native ledger record must contain its original body XDR.');
          const parsed=sdk.TransactionBuilder.fromXDR(row.body,defaults.networkPassphrase);
          const transaction=parsed.innerTransaction||parsed;
          const hash=Buffer.from(parsed.hash()).toString('hex');
          const aliases=[...new Set([hash,...(parsed.innerTransaction?[Buffer.from(transaction.hash()).toString('hex')]:[])])];
          need(!row.hash||HASH.test(row.hash)&&aliases.includes(row.hash.toLowerCase()),
            'The original transaction hash does not match the retained envelope and network.');
          const ledger=String(row.ledger);
          need(/^[1-9]\d*$/.test(ledger),'Retain the original ledger sequence on every transaction.');
          const createdAt=closeTime(row);
          const reasons=inspectOperations(sdk,transaction,defaults.account,defaults.contractId);
          decoded++;fileDecoded++;
          if(reasons.length){
            selectedCount++;
            const observation={hash,hashAliases:aliases,originalHash:row.hash||null,
              originalId:row.id===undefined?null:String(row.id),ledger,createdAt,
              sourceAccount:transaction.source,operationKinds:transaction.operations.map(op=>op.type),
              originalResultRetained:typeof row.result==='string',
              originalMetadataRetained:typeof row.meta==='string',
              sourceRef:relative+(Array.isArray(document)?'#/':'#/_embedded/records/')+index,sourceRow:String(index),reasons};
            const old=seen.get(hash);
            if(old){
              need(old.ledger===ledger&&old.createdAt===createdAt,'The same original envelope has inconsistent ledger identity.');
              old.additionalSourceRefs??=[];old.additionalSourceRefs.push(observation.sourceRef);
            }else{manifest.selected.push(observation);seen.set(hash,observation);}
          }
        }catch(error){manifest.issues.push({file:relative,row:String(index),message:error.message});}
      }
      file.decodedRows=String(fileDecoded);file.selectedRows=String(selectedCount);
      manifest.totalRows=String(total);manifest.decodedRows=String(decoded);await writeManifest();
    }
    need(!manifest.issues.length,'An original ledger record needs a decoder repair; read archive-inputs.json and retain its complete original source.');
    need(manifest.selected.length,'The supplied original ledgers contained no native match for the published account or contract.');
    const captureOptions={network:'mainnet',networkPassphrase:defaults.networkPassphrase,
      rpcUrl:defaults.rpcUrl,horizonUrl:defaults.horizonUrl,archiveRpcUrl:defaults.archiveRpcUrl,
      contractIds:[defaults.contractId],accounts:[defaults.account],
      transactionHashes:manifest.selected.map(row=>row.hash),originalLedgerSources};
    const capturePath=join(output,'capture-options.json');
    const content=JSON.stringify(captureOptions,null,2)+'\n';
    await writeFile(capturePath,content,{flag:'wx',mode:0o600});
    manifest.captureOptions={file:'capture-options.json',bytes:Buffer.byteLength(content),sha256:SHA256(content)};
    manifest.status='complete';manifest.completedAt=new Date().toISOString();await writeManifest();
    return {output,manifest:join(output,'archive-inputs.json'),captureOptions:capturePath,
      files:manifest.files.length,decodedRows:manifest.decodedRows,selectedTransactions:manifest.selected.length,
      transactionHashes:captureOptions.transactionHashes};
  }catch(error){
    manifest.status='interrupted';manifest.interruption={at:new Date().toISOString(),message:error.message};
    await writeManifest();throw error;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await prepareArchiveInputs(optionList(process.argv.slice(2))),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
