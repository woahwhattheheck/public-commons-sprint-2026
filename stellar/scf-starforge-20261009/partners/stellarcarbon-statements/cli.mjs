#!/usr/bin/env node
// MIT. Complete native command surface for original source, statements and customer receiving.
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {writeFile,mkdir} from 'node:fs/promises';
import {regular,privateDirectory} from '../../distribution/runtime-workspace/storage.mjs';
import {prepareReceivablesServer} from '../../merchant-settlement-accounting/receivables/server.mjs';
import {StellarcarbonWorkspace,readNativeDirectory,MAX_INPUT_BYTES} from './store.mjs';
import {need} from './source.mjs';
import {workspaceOverview,contributionsPage,contributionDetail,retirementsPage,retirementDetail,editionFor,statementVersion,compareEditions} from './engine.mjs';
import {statementFiles,comparisonCSV} from './exports.mjs';
import {captureNativeApi} from './capture.mjs';
import {createStatementInvoice} from './accounting.mjs';
import {createStellarcarbonServer} from './server.mjs';
export const HELP='Stellarcarbon contributions and statements\n\n'+
'  stellarcarbon-statements init --directory DIR --name NAME\n'+
'  stellarcarbon-statements import --directory DIR [--source NATIVE_TABLE_DIR | --retained] --label LABEL\n'+
'  stellarcarbon-statements capture --directory DIR --from YYYY-MM-DD --before YYYY-MM-DD --label LABEL [--resume] [--api OFFICIAL_BASE]\n'+
'  stellarcarbon-statements state --directory DIR\n'+
'  stellarcarbon-statements customer|project|assignment|statement --directory DIR --file JSON [--actor NAME]\n'+
'  stellarcarbon-statements contributions|retirements --directory DIR --edition ID [--from DATE --before DATE --customer ID --project ID --cursor EXACT_STRING --limit N]\n'+
'  stellarcarbon-statements contribution --directory DIR --edition ID --hash HASH\n'+
'  stellarcarbon-statements retirement --directory DIR --edition ID --certificate ID\n'+
'  stellarcarbon-statements statement-show --directory DIR --id ID [--version N]\n'+
'  stellarcarbon-statements compare --directory DIR --before-edition ID --after-edition ID [--format json|csv]\n'+
'  stellarcarbon-statements export --directory DIR --id ID --out NEW_DIRECTORY [--version N]\n'+
'  stellarcarbon-statements source --directory DIR --edition ID [--table NAME | --response INDEX]\n'+
'  stellarcarbon-statements invoice --directory DIR --accounting-directory ORIGINAL_DIR --id STATEMENT_ID --file JSON\n'+
'  stellarcarbon-statements handover --directory DIR --out NEW_FILE.json\n'+
'  stellarcarbon-statements receive --directory NEW_DIR --file WHOLE_WORKSPACE.json\n'+
'  stellarcarbon-statements serve --directory DIR [--port 0] [--accounting-directory ORIGINAL_DIR]\n\n'+
'Every date window includes --from and excludes --before. Native IDs and decimal amounts stay strings.\n'+
'Mutating JSON is the complete customer/project/assignment/statement value; existing records include id and expectedVersion.\n'+
'Statement JSON includes title, editionId, fromDate, beforeDate, optional customerId/projectId and note.\n'+
'Invoice JSON includes statementVersion, amount, currency:{code,scale}, issueDate, dueDate and optional taxAmount/note.\n'+
'--retained receives all seven unmodified tables from stellarcarbon/sc-data d7c10873e98993616af561dd3d00a6e0ae81e3cc.\n';
function parse(args){
  const command=args[0]||'help',options={};
  for(let index=1;index<args.length;index++){
    const key=args[index];need(key.startsWith('--'),'CLI_OPTION','Use named command options.');
    if(['--retained','--resume','--help'].includes(key)){options[key.slice(2)]=true;continue;}
    need(index+1<args.length&&!args[index+1].startsWith('--'),'CLI_OPTION','Provide a value for '+key+'.');
    options[key.slice(2)]=args[++index];
  }
  return {command,options};
}
const readJSON=async path=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await regular(resolve(path),MAX_INPUT_BYTES)));
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
export async function main(args=process.argv.slice(2)){
  const {command,options}=parse(args);
  if(command==='help'||command==='--help'||command==='-h'||options.help){process.stdout.write(HELP);return;}
  need(options.directory,'WORKSPACE_DIRECTORY_REQUIRED','Choose the original workspace directory.');
  const directory=resolve(options.directory);
  if(command==='init'||command==='receive'){
    const handover=command==='receive'?await readJSON(options.file):undefined;
    const workspace=await StellarcarbonWorkspace.create(directory,{name:options.name,handover});
    try{print(await workspace.overview());}finally{await workspace.close();}return;
  }
  if(command==='serve'){
    const service=await createStellarcarbonServer({directory,port:options.port||0,expectedWorkspaceId:options['expected-workspace-id'],
      accountingDirectory:options['accounting-directory'],expectedAccountingWorkspaceId:options['expected-accounting-workspace-id'],
      expectedAccountingSourcesSha256:options['expected-accounting-sources-sha256']});
    process.stdout.write(JSON.stringify(service.startup)+'\n');
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;try{await service.close();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
  }
  const workspace=await StellarcarbonWorkspace.open(directory);
  try{
    const operation={revision:workspace.state.revision,requestId:options['request-id']||randomUUID(),actor:options.actor||'Local operator'};
    const query={editionId:options.edition,fromDate:options.from,beforeDate:options.before,customerId:options.customer,
      projectId:options.project,cursor:options.cursor,limit:options.limit||50};
    if(command==='state')print(workspaceOverview(workspace.state));
    else if(command==='import'){
      need(Boolean(options.source)!==Boolean(options.retained),'SOURCE_SELECTION','Select --source or --retained.');
      const source=await readNativeDirectory(options.retained?fileURLToPath(new URL('./source-edition/',import.meta.url)):options.source);
      print(await workspace.import(source,options.label||'Imported native backup',operation));
    }else if(command==='capture'){
      const checkpoint=options.resume?await workspace.captureCheckpoint():undefined;
      const source=await captureNativeApi({baseUrl:options.api||'https://api.stellarcarbon.io',fromDate:options.from,beforeDate:options.before,
        pageSize:Number(options.limit||200),checkpoint,retain:progress=>workspace.saveCapture(progress)});
      print(await workspace.import(source,options.label||'Native API '+options.from+' to before '+options.before,operation));
    }else if(['customer','project','assignment','statement'].includes(command)){
      print(await workspace.apply(command,await readJSON(options.file),operation));
    }else if(command==='contributions')print(contributionsPage(workspace.state,query));
    else if(command==='contribution')print(contributionDetail(workspace.state,options.edition,options.hash));
    else if(command==='retirements')print(retirementsPage(workspace.state,query));
    else if(command==='retirement')print(retirementDetail(workspace.state,options.edition,options.certificate));
    else if(command==='statement-show')print(statementVersion(workspace.state,options.id,options.version));
    else if(command==='compare'){
      const comparison=compareEditions(workspace.state,options['before-edition'],options['after-edition']);
      if(options.format==='csv')process.stdout.write(comparisonCSV(comparison));else print(comparison);
    }else if(command==='export'){
      const output=resolve(options.out);await mkdir(output,{mode:0o700});await privateDirectory(output);
      const files=statementFiles(statementVersion(workspace.state,options.id,options.version),{statementId:options.id});
      for(const [name,file] of Object.entries(files))await writeFile(join(output,name),file.content,{flag:'wx',mode:0o600});
      print({directory:output,files:Object.keys(files)});
    }else if(command==='source'){
      const source=editionFor(workspace.state,options.edition);
      if(options.table){need(Object.hasOwn(source.files,options.table),'SOURCE_TABLE_UNAVAILABLE','Choose a retained native table.');process.stdout.write(source.files[options.table]);}
      else if(options.response!==undefined){const row=source.responses[Number(options.response)];need(row,'SOURCE_RESPONSE_UNAVAILABLE','Choose a retained response number.');process.stdout.write(row.content);}
      else print({metadata:source.metadata,tables:Object.keys(source.files),responses:source.responses.map((row,index)=>({index,url:row.url,retrievedAt:row.retrievedAt}))});
    }else if(command==='invoice'){
      need(options['accounting-directory'],'ACCOUNTING_DIRECTORY_REQUIRED','Select the original accounting directory.');
      const accounting=await prepareReceivablesServer({directory:options['accounting-directory'],port:0});
      try{print(await createStatementInvoice(workspace,accounting,{statementId:options.id,value:await readJSON(options.file),...operation}));}
      finally{await accounting.close();}
    }else if(command==='handover'){
      const output=resolve(options.out);await writeFile(output,JSON.stringify(await workspace.handover(),null,2)+'\n',{flag:'wx',mode:0o600});
      print({file:output,workspaceId:workspace.state.workspaceId});
    }else throw Object.assign(new Error('Choose a command from --help.'),{code:'UNKNOWN_COMMAND'});
  }finally{await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||'WORKSPACE_ERROR',message:error.message}})+'\n');process.exitCode=1;});
