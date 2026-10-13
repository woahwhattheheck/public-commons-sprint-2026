#!/usr/bin/env node
// MIT. Whole native acquisition, operator work, complete export and independent receiving.
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {regular,privateDirectory} from '../../distribution/runtime-workspace/storage.mjs';
import {readNativeDirectory} from '../stellarcarbon-statements/store.mjs';
import {GiveCreditWorkspace,readJSONFile,MAX_INPUT_BYTES} from './store.mjs';
import {need,receiveRegistryFiles,receiveCarbon,REGISTRY_TABLES} from './source.mjs';
import {workspaceOverview,donationsPage,donationDetail,transfersPage,transferDetail,poolRegister,
  editionFor,prepareAllocation,prepareBridge,prepareStatement,statementVersion,compareEditions} from './engine.mjs';
import {statementFiles,comparisonCSV} from './exports.mjs';
import {captureRegistry} from './capture.mjs';
import {captureLedger,captureTransaction} from './ledger.mjs';
import {captureLedgerInterval,selectLedgerInterval,captureLedgerSelection} from './history.mjs';
import {createGiveCreditServer} from './server.mjs';
import {writeJSONFile} from './native-json.mjs';
export const HELP=String.raw`GiveCredit donor and initiative statements

  givecredit-statements init --directory NEW_DIR --name NAME
  givecredit-statements receive --directory NEW_DIR --file WHOLE_WORKSPACE.json
  givecredit-statements serve --directory DIR [--port 0]
  givecredit-statements state --directory DIR

  givecredit-statements import --directory DIR --file WHOLE_EDITION.json --label LABEL
  givecredit-statements import-registry --directory DIR --source ORIGINAL_TABLE_DIR --label LABEL [--metadata JSON]
  givecredit-statements import-carbon --directory DIR (--retained | --source NATIVE_TABLE_DIR | --file CARBON_EDITION.json) --label LABEL [--network mainnet]
  givecredit-statements capture-registry --directory DIR --file OPTIONS.json --label LABEL [--resume]
  givecredit-statements capture-ledger --directory DIR --file OPTIONS.json --label LABEL [--registry-edition ID] [--resume]
  givecredit-statements capture-transaction --directory DIR --hash ORIGINAL_HASH --label LABEL [--file OPTIONS.json]
  givecredit-statements checkpoint-status --directory DIR --kind ledger|registry
  givecredit-statements checkpoint-import --directory DIR --kind ledger|registry --file ORIGINAL_CHECKPOINT.json
  givecredit-statements checkpoint-export --directory DIR --kind ledger|registry --out NEW_CHECKPOINT.json

  givecredit-statements capture-history --file NATIVE_HISTORY_OPTIONS.json [--resume] [--sdk-module EXISTING_SDK.mjs]
  givecredit-statements select-history --file NATIVE_HISTORY_OPTIONS.json [--fetch-closures] [--sdk-module EXISTING_SDK.mjs]
  givecredit-statements capture-selected-ledgers --file NATIVE_HISTORY_OPTIONS.json [--resume] [--sdk-module EXISTING_SDK.mjs]

  givecredit-statements payment-link|allocation|bridge|statement|settings|carry-payment-links --directory DIR --file VALUE.json [--actor NAME] [--request-id ID]
  givecredit-statements preview --directory DIR --kind allocation|bridge|statement --file VALUE.json
  givecredit-statements donations --directory DIR --edition REGISTRY_ID [--ledger-edition ID --organization ID --initiative ID --donor ADDRESS --from DATE --before DATE --offset N --limit N]
  givecredit-statements donation --directory DIR --edition REGISTRY_ID --id DONATION_ID [--ledger-edition ID]
  givecredit-statements payments --directory DIR --edition LEDGER_ID [--kind payment|payout --address ADDRESS --from DATE --before DATE --offset N --limit N]
  givecredit-statements payment --directory DIR --edition LEDGER_ID --key TRANSFER_KEY
  givecredit-statements pools --directory DIR --edition LEDGER_ID [--contract ID --from DATE --before DATE]

  givecredit-statements statement-show --directory DIR --id STATEMENT_ID [--version N]
  givecredit-statements export --directory DIR --id STATEMENT_ID --out NEW_DIRECTORY [--version N]
  givecredit-statements source --directory DIR --edition ID [--table TABLE --offset N --limit N | --original-file NAME]
  givecredit-statements source-export --directory DIR --edition ID --out NEW_FILE.json
  givecredit-statements compare --directory DIR --before-edition ID --after-edition ID [--format json|csv]
  givecredit-statements handover --directory DIR --out NEW_FILE.json

Periods include --from and exclude --before. Registry creation dates, ledger close
dates and certificate retirement dates retain their own source basis.

The registry API key comes from the existing GIVECREDIT_REGISTRY_API_KEY environment
variable or the original local capture options file. Source editions omit auth headers.
Registry capture retains all original organization pages and later impact relations.

Ledger capture uses the original ^16.3.0 Stellar SDK peer, whole transaction XDR and
the public RPC/Horizon/archive sources. OPTIONS.json accepts network, contractId,
transactionHashes, accounts, source dates, original endpoints and ledger bounds.
originalLedgerSources retains complete original public ledger JSON responses as
{format:"stellar-expert-ledger-json",sourceUrl,ledger,content,retrievedAt?,acquisition?}.
The RPC source form is {format:"stellar-rpc-ledgers-json",sourceUrl,request,
requestContent?,content,status?,retrievedAt?,acquisition?}; retain the original
named-parameter getLedgers request and its whole base64-XDR response.
The native reader preserves original envelope/result/meta and provider provenance
when the live indexes have pruned an older transaction. Whole retained sources can
be prepared with the companion carbon-native-receiving/prepare-ledger-inputs.mjs.
--registry-edition adds every original Stellar receipt payment hash in that edition.
A failed acquisition saves its exact native checkpoint for --resume. Original response
and XDR strings are retained once beside a small atomic progress manifest. Existing
ledger-capture.json/registry-capture.json files reopen automatically and remain intact.
checkpoint-import receives a saved original file; checkpoint-export writes a complete
ordinary source checkpoint usable independently of the local storage layout.
checkpoint-status reports the last committed source/progress and physical writes.

Native history options select sourceRoot/output, SDK module, public archive URL,
accounts, contractIds and additional source addresses. capture-history includes
startLedger and excludes beforeLedger; select-history reuses complete local pages;
capture-selected-ledgers closes an existing native scan's exact ledgers array.
All original files stay under sourceRoot for the complete native receiving archive.
The resulting captureOptions path feeds ordinary capture-ledger or receive-native.

Mutation JSON uses exact amountAtoms strings, source edition IDs and original record
keys. Existing mappings include id and expectedVersion. The browser accepts ordinary
decimal token amounts and converts them using original asset precision.

Statement JSON: title, basis REGISTRY_CREATED|LEDGER_CLOSED, fromDate, beforeDate,
registryEditionId?, ledgerEditionId?, carbonEditionId?, organizationId?, initiativeId?,
donorAddress?, note?. Each saved version retains its source and allocation snapshots.

Exports contain HTML, JSON and seven CSV files. Receiving preserves all source bodies,
operator mappings, funding methods and statement versions in an independent workspace.
`;
function parse(args){
  const command=args[0]||'help',options={};
  for(let i=1;i<args.length;i++){
    const key=args[i];need(key.startsWith('--'),'CLI_OPTION','Use named command options.');
    if(['--retained','--resume','--fetch-closures','--help'].includes(key)){options[key.slice(2)]=true;continue;}
    need(i+1<args.length&&!args[i+1].startsWith('--'),'CLI_OPTION','Provide a value for '+key+'.');
    options[key.slice(2)]=args[++i];
  }
  return {command,options};
}
const required=(value,label)=>{need(typeof value==='string'&&value.length,'CLI_VALUE_REQUIRED','Provide '+label+'.');return value;};
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
async function originalRegistryDirectory(directory){
  const files={};directory=resolve(required(directory,'the original registry table directory'));
  for(const name of REGISTRY_TABLES)for(const extension of ['json','ndjson']){
    const filename=name+'.'+extension;
    try{files[filename]=new TextDecoder('utf-8',{fatal:true}).decode(await regular(join(directory,filename),MAX_INPUT_BYTES));}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return files;
}
async function writeNew(path,value){path=resolve(required(path,'a new output path'));if(typeof value==='string')await writeFile(path,value,{flag:'wx',mode:0o600});else await writeJSONFile(path,value);return path;}
export async function main(args=process.argv.slice(2)){
  const {command,options}=parse(args);
  if(['help','--help','-h'].includes(command)||options.help){process.stdout.write(HELP);return;}
  if(['capture-history','select-history','capture-selected-ledgers'].includes(command)){
    const input=await readJSONFile(required(options.file,'the complete native history options'));
    if(options.resume)input.resume=true;if(options['fetch-closures'])input.fetchClosures=true;
    if(options['sdk-module'])input.sdkModule=options['sdk-module'];
    input.onProgress=value=>process.stderr.write(JSON.stringify(value)+'\n');
    print(await (command==='capture-history'?captureLedgerInterval:command==='select-history'?selectLedgerInterval:captureLedgerSelection)(input));return;
  }
  const directory=resolve(required(options.directory,'the private workspace directory'));
  if(command==='init'||command==='receive'){
    const workspace=await GiveCreditWorkspace.create(directory,{name:options.name,handover:command==='receive'?await readJSONFile(required(options.file,'the complete handover file')):undefined});
    try{print(await workspace.overview());}finally{await workspace.close();}return;
  }
  if(command==='serve'){
    const service=await createGiveCreditServer({directory,port:options.port||0,expectedWorkspaceId:options['expected-workspace-id']});
    process.stdout.write(JSON.stringify(service.startup)+'\n');let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;try{await service.close();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
  }
  const workspace=await GiveCreditWorkspace.open(directory);
  try{
    const operation={revision:workspace.state.revision,requestId:options['request-id']||randomUUID(),actor:options.actor||'Local operator'};
    const query={editionId:options.edition,ledgerEditionId:options['ledger-edition'],organizationId:options.organization,initiativeId:options.initiative,
      donorAddress:options.donor,fromDate:options.from,beforeDate:options.before,offset:options.offset||0,limit:options.limit||50,
      search:options.search,address:options.address,kind:options.kind,contractId:options.contract};
    if(command==='state')print(workspaceOverview(workspace.state));
    else if(command==='checkpoint-status')print(await workspace.captureStatus(required(options.kind,'ledger or registry')));
    else if(command==='checkpoint-import')print(await workspace.importCapture(required(options.kind,'ledger or registry'),required(options.file,'the original checkpoint file')));
    else if(command==='checkpoint-export')print(await workspace.exportCapture(required(options.kind,'ledger or registry'),required(options.out,'a new complete checkpoint file')));
    else if(command==='import')print(await workspace.import(await readJSONFile(required(options.file,'the complete source edition file')),required(options.label,'the source edition label'),operation));
    else if(command==='import-registry'){
      const source=receiveRegistryFiles(await originalRegistryDirectory(options.source),options.metadata?await readJSONFile(options.metadata):{origin:'original-registry-export'});
      print(await workspace.import(source,required(options.label,'the source edition label'),operation));
    }else if(command==='import-carbon'){
      need([options.retained,options.source,options.file].filter(Boolean).length===1,'SOURCE_SELECTION','Select the retained original edition, a native table directory or a complete carbon source file.');
      const carbon=options.file?await readJSONFile(options.file):await readNativeDirectory(options.retained?
        fileURLToPath(new URL('../stellarcarbon-statements/source-edition/',import.meta.url)):options.source);
      print(await workspace.import(receiveCarbon(carbon,{network:options.network||'mainnet'}),required(options.label,'the source edition label'),operation));
    }else if(['capture-registry','capture-ledger','capture-transaction'].includes(command)){
      const kind=command==='capture-registry'?'registry':'ledger',input=options.file?await readJSONFile(options.file):{};
      if(kind==='registry')input.apiKey=input.apiKey||process.env.GIVECREDIT_REGISTRY_API_KEY;
      if(options['registry-edition'])input.registrySource=editionFor(workspace.state,options['registry-edition'],'registry');
      if(options.hash)input.hash=options.hash;
      if(options.resume)input.checkpoint=await workspace.captureCheckpoint(kind);
      input.checkpointMode='borrowed';
      input.onProgress=async value=>{if(value.checkpoint){const saved=await workspace.saveCapture(kind,value.checkpoint,{phase:value.phase});process.stderr.write(JSON.stringify({phase:value.phase,checkpoint:saved})+'\n');}};
      try{
        const source=await (command==='capture-registry'?captureRegistry:command==='capture-transaction'?captureTransaction:captureLedger)(input);
        print(await workspace.import(source,required(options.label,'the source edition label'),operation));
      }catch(error){if(error.checkpoint)await workspace.saveCapture(kind,error.checkpoint,{phase:'interrupted'});throw error;}
    }else if(['payment-link','allocation','bridge','statement','settings','carry-payment-links'].includes(command))
      print(await workspace.apply(command,await readJSONFile(required(options.file,'the complete operation value file')),operation));
    else if(command==='preview'){
      const value=await readJSONFile(required(options.file,'the complete statement or mapping value'));
      need(['allocation','bridge','statement'].includes(options.kind),'PREVIEW_KIND','Choose allocation, bridge or statement.');
      print((options.kind==='allocation'?prepareAllocation:options.kind==='bridge'?prepareBridge:prepareStatement)(workspace.state,value));
    }else if(command==='donations')print(donationsPage(workspace.state,query));
    else if(command==='donation')print(donationDetail(workspace.state,options.edition,options.id,options['ledger-edition']));
    else if(command==='payments')print(transfersPage(workspace.state,query));
    else if(command==='payment')print(transferDetail(workspace.state,options.edition,options.key));
    else if(command==='pools')print(poolRegister(workspace.state,options.edition,query));
    else if(command==='statement-show')print(statementVersion(workspace.state,options.id,options.version));
    else if(command==='compare'){
      const result=compareEditions(workspace.state,options['before-edition'],options['after-edition']);
      if(options.format==='csv')process.stdout.write(comparisonCSV(result));else print(result);
    }else if(command==='export'){
      const report=statementVersion(workspace.state,options.id,options.version),files=statementFiles(report);
      const out=resolve(required(options.out,'a new statement output directory'));await mkdir(out,{mode:0o700});await privateDirectory(out);
      for(const [name,file] of Object.entries(files))await writeFile(join(out,name),file.content,{flag:'wx',mode:0o600});
      print({directory:out,version:report.version,files:Object.keys(files)});
    }else if(command==='source'){
      const source=editionFor(workspace.state,options.edition);
      if(options['original-file']){
        const content=source.files[options['original-file']]??source.carbon?.files?.[options['original-file']];
        need(typeof content==='string','SOURCE_FILE_REQUIRED','Choose an exact retained original file name.');process.stdout.write(content);
      }else if(options.table){
        const rows=(source.kind==='carbon'?source.carbon.tables:source.tables)[options.table];
        need(Array.isArray(rows),'SOURCE_TABLE_REQUIRED','Choose an original source table.');
        const offset=Number(options.offset||0),limit=Number(options.limit||100);
        need(Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=500,'INVALID_PAGE','Choose a source page from 1 to 500 records.');
        print({table:options.table,total:rows.length,offset,limit,items:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null});
      }else print({id:source.id,label:source.label,kind:source.kind,metadata:source.metadata,files:Object.keys(source.files),
        tables:Object.fromEntries(Object.entries(source.kind==='carbon'?source.carbon.tables:source.tables).map(([name,rows])=>[name,rows.length]))});
    }else if(command==='source-export')print({file:await writeNew(options.out,editionFor(workspace.state,options.edition))});
    else if(command==='handover')print({file:await writeNew(options.out,await workspace.readonlyHandover()),workspaceId:workspace.state.workspaceId});
    else throw Object.assign(new Error('Choose a command from --help.'),{code:'UNKNOWN_COMMAND'});
  }finally{await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||'WORKSPACE_ERROR',message:error.message}})+'\n');process.exitCode=1;});
