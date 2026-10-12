// MIT. Maintained OAuth CLI's explicit Xero tenant selection and accounting launcher.
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateDirectory, createFile, readJson, bytes } from '../postgres/publisher/files.mjs';
import { initializeOAuthConnection } from './connection.mjs';
import { readOAuthHostConnections, openOAuthConnectionRegistry } from './host.mjs';
import { createXeroProfile, listXeroConnections, listXeroTenants, previewXeroSelection, saveXeroSelection,
  readXeroSelection, xeroSelectionSummary, startXeroAccountingWorkspace, XERO_SELECTION_BYTES } from './xero.mjs';

export const XERO_HELP=String.raw`Xero authorization, selected tenant and original accounting:
  oauth-connection xero init --directory PATH --client-id ID --client-secret-env NAME --callback-origin ORIGIN [--label NAME]
  oauth-connection xero list --connections FILE
  oauth-connection xero tenants --connections FILE --alias ALIAS --profile SHA256 --grant ID [--out FILE]
  oauth-connection xero preview --connections FILE --alias ALIAS --profile SHA256 --grant ID --connection-id UUID --tenant UUID --actor NAME --reference TEXT --out FILE
  oauth-connection xero select --connections FILE --selection-directory PATH --preview FILE --preview-sha SHA256 [--previous-sha SHA256]
  oauth-connection xero status --selection-directory PATH
  oauth-connection xero serve --connections FILE --selection-directory PATH --workspace PATH [ACCOUNTING OPTIONS]

Use the original OAuth workspace or oauth-connection connect to authorize the
registered callback and review its grant. tenants reads Xero's actual connection
array. Choose an organization by both connection-id and tenant; preview captures
its original organization and accounts. Review that source and save its exact
preview SHA. Replacing a saved selection requires the current selection SHA.

serve opens the original accounting workspace at /xero.html with the selected
tenant, managed token renewal, existing draft/read operations and accountant
return recovery. Native journal writes keep their original retained operation
and explicit reconciliation. Original grant revocation affects the whole Xero
authorization, including its connected tenants.

Accounting options: --port, --outbox, --proof-dir, --terms, --recovered-dir,
--rpc-proxy-env, --recovery-state-root, --recovery-backup-root,
--recovery-pass-env, --recovery-start-paused.
--allow-loopback enables an explicitly local OAuth peer for development.
`;
const fail=message=>{throw new TypeError(message);};
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
const safeCode=error=>/^(?:XERO|OAUTH)_[A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'XERO_OAUTH_COMMAND_FAILED';
function parse(argv) {
  const [command,...rest]=argv;if(!command||['help','--help'].includes(command))return {command:'help'};
  const allowed={
    init:['directory','client-id','client-secret-env','callback-origin','label'],
    list:['connections','allow-loopback'],
    tenants:['connections','alias','profile','grant','out','allow-loopback'],
    preview:['connections','alias','profile','grant','connection-id','tenant','actor','reference','out','allow-loopback'],
    select:['connections','selection-directory','preview','preview-sha','previous-sha','allow-loopback'],
    status:['selection-directory'],
    serve:['connections','selection-directory','workspace','outbox','proof-dir','terms','recovered-dir','rpc-proxy-env',
      'port','recovery-state-root','recovery-backup-root','recovery-pass-env','recovery-start-paused','allow-loopback'],
  }[command];
  if(!allowed)fail('Unknown Xero command. Use xero --help.');
  const args={command};
  for(let i=0;i<rest.length;i++){
    const key=rest[i].startsWith('--')?rest[i].slice(2):'';
    if(!allowed.includes(key)||Object.hasOwn(args,key))fail('Unknown or repeated Xero option.');
    if(['allow-loopback','recovery-start-paused'].includes(key)){args[key]=true;continue;}
    const value=rest[++i];if(!value||value.startsWith('--'))fail('A Xero option value is missing.');
    args[key]=value;
  }
  return args;
}
const required=(args,key)=>{if(typeof args[key]!=='string'||!args[key])fail('--'+key+' is required.');return args[key];};
const target=args=>({alias:required(args,'alias'),profileSha256:required(args,'profile'),grantId:required(args,'grant')});
async function registry(args) {
  return openOAuthConnectionRegistry({connections:await readOAuthHostConnections(resolve(required(args,'connections'))),
    env:process.env,allowLoopback:args['allow-loopback']===true});
}
function accountingOptions(args) {
  const result={directory:resolve(required(args,'workspace'))};
  const paths={outbox:'outboxDir','proof-dir':'proofDir',terms:'termsFile','recovered-dir':'recoveredDir',
    'recovery-state-root':'recoveryStateRoot','recovery-backup-root':'recoveryBackupRoot'};
  for(const [key,name]of Object.entries(paths))if(args[key])result[name]=resolve(args[key]);
  if(args['rpc-proxy-env'])result.rpcProxyEnv=args['rpc-proxy-env'];
  if(args['recovery-pass-env'])result.recoveryPassEnv=args['recovery-pass-env'];
  if(args['recovery-start-paused'])result.recoveryStartPaused=true;
  if(args.port!==undefined){
    if(!/^(?:0|[1-9][0-9]{0,4})$/.test(args.port)||Number(args.port)>65535)fail('--port must be 0 to 65535.');
    result.port=Number(args.port);
  }
  return result;
}
export async function xeroMain(argv=process.argv.slice(2)) {
  const args=parse(argv);
  if(args.command==='help'){process.stdout.write(XERO_HELP);return;}
  if(args.command==='init'){
    const profile=await createXeroProfile({clientId:required(args,'client-id'),clientSecretEnv:required(args,'client-secret-env'),
      callbackOrigin:required(args,'callback-origin'),label:args.label??'Xero accounting'});
    print(await initializeOAuthConnection(resolve(required(args,'directory')),{profile}));return;
  }
  if(args.command==='status'){
    print(xeroSelectionSummary(await readXeroSelection(resolve(required(args,'selection-directory')))));return;
  }
  if(args.command==='serve'){
    const connected=await startXeroAccountingWorkspace({connectionsFile:resolve(required(args,'connections')),
      selectionDirectory:resolve(required(args,'selection-directory')),env:process.env,
      allowLoopback:args['allow-loopback']===true,...accountingOptions(args)});
    print({url:connected.accounting.url+'/xero.html',selection:connected.selection});
    let stopped=false;
    const stop=()=>{
      if(stopped)return;stopped=true;
      process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
      connected.close().catch(error=>{process.stderr.write(safeCode(error)+'\n');process.exitCode=1;});
    };
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return connected;
  }
  const owner=await registry(args);
  try{
    if(args.command==='list'){print({connections:await listXeroConnections(owner)});return;}
    if(args.command==='tenants'){
      const current=await listXeroTenants({registry:owner,...target(args),env:process.env,allowLoopback:args['allow-loopback']===true});
      let sourceFile=null;
      if(args.out){sourceFile=resolve(args.out);await privateDirectory(dirname(sourceFile));await createFile(sourceFile,bytes(current));}
      const {json,...response}=current.response;
      print({schema:current.schema,alias:current.alias,profileSha256:current.profileSha256,grantId:current.grantId,
        capturedAt:current.capturedAt,connections:current.connections,response,integrity:current.integrity,sourceFile});return;
    }
    if(args.command==='preview'){
      const output=resolve(required(args,'out'));await privateDirectory(dirname(output));
      const selection=await previewXeroSelection({registry:owner,...target(args),connectionId:required(args,'connection-id'),
        tenantId:required(args,'tenant'),actor:required(args,'actor'),reference:required(args,'reference'),
        env:process.env,allowLoopback:args['allow-loopback']===true});
      await createFile(output,bytes(selection));
      print({previewFile:output,...xeroSelectionSummary(selection)});return;
    }
    const saved=await saveXeroSelection(resolve(required(args,'selection-directory')),{
      registry:owner,selection:await readJson(resolve(required(args,'preview')),XERO_SELECTION_BYTES),
      previewSha256:required(args,'preview-sha'),expectedSelectionSha256:args['previous-sha']??null});
    print({duplicate:saved.duplicate,...xeroSelectionSummary(saved.selection)});
  }finally{await owner.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  xeroMain().catch(error=>{process.stderr.write((error instanceof TypeError?error.message:safeCode(error))+'\n');process.exitCode=1;});
}
