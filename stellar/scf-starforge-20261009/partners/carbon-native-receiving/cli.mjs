#!/usr/bin/env node
// MIT. Installed command for original source receiving, full native execution and delivery inspection.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CarbonNativeReceivingClient,RUN_FLAGS} from './client.mjs';

export const HELP=String.raw`Carbon reporting native receiving

  starforge carbon-native-receiving source --downloads DIR --source-root NEW_DIR
  starforge carbon-native-receiving inspect-source --source-root DIR
  starforge carbon-native-receiving sdk --bundle ORIGINAL_JS --metadata ORIGINAL_NPM_JSON --output NEW_DIR
  starforge carbon-native-receiving archive-inputs --source-root DIR --source-manifest ORIGINAL_JSON --ledger-json ORIGINAL_LEDGER_JSON [--ledger-json ANOTHER_JSON] --output NEW_DIR [--sdk-module FILE]
  starforge carbon-native-receiving run --source-root DIR --output NEW_DIR [options]
  starforge carbon-native-receiving status --output DIR [--archive-path FILE]
  starforge carbon-native-receiving verify --output DIR [--archive-path FILE]

Source receiving validates all original source parts and the complete editable
customer handover. The selected source root contains receiving/source-manifest.json,
receiving/receive-native.mjs and the two original applications under stellar/.
A toolkit installation is the launcher; use the selected complete source parcel.

Run options:
  --chromium FILE                    Existing native Chromium executable
  --sdk-module FILE                  Existing Stellar SDK ESM entry point
  --actor NAME                       Native operator attribution
  --ledger-source FILE               Complete existing original ledger edition
  --registry-source FILE             Complete authorized original registry edition
  --capture-options FILE             Original capture selection, including archive inputs
  --capture-checkpoint FILE          Retained checkpoint for that same capture query
  --resume-from DIR                  Preserved original receiving output to continue
  --from YYYY-MM-DD --before YYYY-MM-DD  Included start and excluded end of statement
  --accounting-directory DIR         Original maintained accounting case
  --expected-accounting-workspace-id ID
  --expected-accounting-sources-sha256 SHA256
  --accounting-config FILE           Original customer and proposed billing selection
  --archive-path FILE                New archive outside the source and output
  --keep-open                        Reopen received desks after the closed archive

Use new private source/output paths and preserve earlier attempts. --resume-from
selects the original OUTPUT containing receiving.json and its complete workspaces.
Receive the current source packet with preserved-output-v1 recovery first. The
continuation copies and reopens saved stages, reuses the original accounting draft,
and finishes the remaining journey in --output NEW_DIR. A matching saved capture
checkpoint is reused; --capture-checkpoint can select an explicit matching file.
The original output stays intact. An observed live original process is rejected.
The run retains complete source/workspaces, original report files, receiving edits
and browser downloads; it streams the closed archive.

Status joins receiving.json with its sibling archive descriptor, archive file and
immutable archived snapshot. Verify additionally streams SHA256 over the entire
archive. Both commands are read-only and never start or repeat a receiving run.
A saved complete receiving.json can precede archive completion. Live desk URLs
retain separate process state after the archived delivery.

Node 22 or newer and the host's existing Chromium and Stellar SDK are used.
`;
const need=(condition,code,message)=>{if(!condition)throw Object.assign(new Error(message),{code});};
const runNames=Object.fromEntries(Object.entries(RUN_FLAGS).map(([key,flag])=>[flag,key]));
const commandNames={
  source:{downloads:'downloads','source-root':'sourceRoot'},
  'inspect-source':{'source-root':'sourceRoot'},
  sdk:{bundle:'bundle',metadata:'metadata',output:'output'},
  'archive-inputs':{'source-root':'sourceRoot','source-manifest':'sourceManifest','ledger-json':'ledgerFiles',output:'output','sdk-module':'sdkModule'},
  run:runNames,
  status:{output:'output','archive-path':'archivePath'},
  verify:{output:'output','archive-path':'archivePath'}
};
export function parseReceivingCommand(args=[]){
  const command=args[0]||'help';
  if(['help','--help','-h'].includes(command))return {command:'help',options:{}};
  need(Object.hasOwn(commandNames,command),'UNKNOWN_COMMAND','Choose a command from --help.');
  const options={},seen=new Set();
  for(let i=1;i<args.length;i++){
    const argument=args[i];
    if(argument==='--help')return {command:'help',options:{}};
    need(argument.startsWith('--'),'CLI_OPTION','Use named command options.');
    const flag=argument.slice(2),many=command==='archive-inputs'&&flag==='ledger-json';
    need(many||!seen.has(flag),'CLI_OPTION','Provide '+argument+' once.');seen.add(flag);
    if(command==='run'&&flag==='keep-open'){options.keepOpen=true;continue;}
    need(Object.hasOwn(commandNames[command],flag),'CLI_OPTION','Unknown option for '+command+': '+argument);
    need(i+1<args.length&&!args[i+1].startsWith('--'),'CLI_VALUE','Provide a value for '+argument+'.');
    const value=args[++i];if(many){options.ledgerFiles??=[];options.ledgerFiles.push(value);}else options[commandNames[command][flag]]=value;
  }
  return {command,options};
}
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
export async function main(args=process.argv.slice(2)){
  const {command,options}=parseReceivingCommand(args);
  if(command==='help'){process.stdout.write(HELP);return;}
  const client=new CarbonNativeReceivingClient();
  if(command==='source')print(await client.receiveSource({...options,onStderr:chunk=>process.stderr.write(chunk)}));
  else if(command==='inspect-source')print(await client.inspectSource(options));
  else if(command==='sdk')print(await client.prepareSdk(options));
  else if(command==='archive-inputs')print(await client.prepareLedgerInputs(options));
  else if(command==='status'||command==='verify'){
    const value=await client[command](options);print(value);
    if(command==='verify'&&!value.archive.complete)process.exitCode=1;
  }else{
    const run=await client.start({...options,onStdout:chunk=>process.stdout.write(chunk),onStderr:chunk=>process.stderr.write(chunk)});
    const interrupt=()=>run.stop('SIGINT'),terminate=()=>run.stop('SIGTERM');
    process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
    try{print(await run.completion);}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code||'CARBON_RECEIVING_ERROR',message:error.message},...(error.status?{status:error.status}:{})})+'\n');process.exitCode=1;});
