// MIT. Existing OAuth CLI's native QuickBooks company and accounting commands.
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privateDirectory, createFile, readJson, bytes } from '../postgres/publisher/files.mjs';
import { initializeOAuthConnection } from './connection.mjs';
import { readOAuthHostConnections, openOAuthConnectionRegistry } from './host.mjs';
import { createQuickBooksProfile, listQuickBooksConnections, previewQuickBooksSelection, saveQuickBooksSelection,
  readQuickBooksSelection, quickBooksSelectionSummary, startQuickBooksAccountingWorkspace, QUICKBOOKS_SELECTION_BYTES } from './quickbooks.mjs';

export const QUICKBOOKS_HELP=String.raw`QuickBooks authorization and original accounting:
  oauth-connection quickbooks init --directory PATH --client-id ID --client-secret-env NAME --environment sandbox|production --callback-origin ORIGIN [--label NAME]
  oauth-connection quickbooks list --connections FILE
  oauth-connection quickbooks preview --connections FILE --alias ALIAS --profile SHA256 --grant ID --realm ID --environment sandbox|production --actor NAME --reference TEXT --out FILE [--minor-version N]
  oauth-connection quickbooks select --connections FILE --selection-directory PATH --preview FILE --preview-sha SHA256 [--previous-sha SHA256]
  oauth-connection quickbooks status --selection-directory PATH
  oauth-connection quickbooks serve --connections FILE --selection-directory PATH --workspace PATH [ACCOUNTING OPTIONS]

Connect and approve the initialized provider through the existing OAuth connection
workspace or oauth-connection connect. Intuit's state-matched callback supplies
the company ID. preview reads the actual company, preferences and all account
pages using that reviewed grant. Review the displayed company, then select the
exact preview SHA. Replacement requires the current selection SHA.
serve opens the original accounting workspace at /qbo.html with the selected
company, native OAuth renewal and the original posting/return recovery.

Accounting options: --port, --outbox, --proof-dir, --terms, --recovered-dir,
--rpc-proxy-env, --recovery-state-root, --recovery-backup-root,
--recovery-pass-env, --recovery-start-paused.
--allow-loopback permits only an explicitly local OAuth peer for development.
`;
const fail=message=>{throw new TypeError(message);};
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
const safeCode=error=>/^(?:QBO|OAUTH)_[A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'QBO_OAUTH_COMMAND_FAILED';
function parse(argv) {
  const [command,...rest]=argv;if(!command||['help','--help'].includes(command))return {command:'help'};
  const allowed={
    init:['directory','client-id','client-secret-env','environment','callback-origin','label'],
    list:['connections','allow-loopback'],
    preview:['connections','alias','profile','grant','realm','environment','actor','reference','out','minor-version','allow-loopback'],
    select:['connections','selection-directory','preview','preview-sha','previous-sha','allow-loopback'],
    status:['selection-directory'],
    serve:['connections','selection-directory','workspace','outbox','proof-dir','terms','recovered-dir','rpc-proxy-env',
      'port','recovery-state-root','recovery-backup-root','recovery-pass-env','recovery-start-paused','allow-loopback'],
  }[command];
  if(!allowed)fail('Unknown QuickBooks command. Use quickbooks --help.');
  const result={command};
  for(let i=0;i<rest.length;i++){
    const key=rest[i].startsWith('--')?rest[i].slice(2):'';
    if(!allowed.includes(key)||Object.hasOwn(result,key))fail('Unknown or repeated QuickBooks option.');
    if(['allow-loopback','recovery-start-paused'].includes(key)){result[key]=true;continue;}
    const value=rest[++i];if(!value||value.startsWith('--'))fail('A QuickBooks option value is missing.');
    result[key]=value;
  }
  return result;
}
const required=(args,key)=>{if(typeof args[key]!=='string'||!args[key])fail('--'+key+' is required.');return args[key];};
async function registry(args) {
  return openOAuthConnectionRegistry({connections:await readOAuthHostConnections(resolve(required(args,'connections'))),
    env:process.env,allowLoopback:args['allow-loopback']===true});
}
function accountingOptions(args) {
  const result={directory:resolve(required(args,'workspace'))};
  const paths={outbox:'outboxDir','proof-dir':'proofDir',terms:'termsFile','recovered-dir':'recoveredDir',
    'recovery-state-root':'recoveryStateRoot','recovery-backup-root':'recoveryBackupRoot'};
  for(const [key,target] of Object.entries(paths))if(args[key])result[target]=resolve(args[key]);
  if(args['rpc-proxy-env'])result.rpcProxyEnv=args['rpc-proxy-env'];
  if(args['recovery-pass-env'])result.recoveryPassEnv=args['recovery-pass-env'];
  if(args['recovery-start-paused'])result.recoveryStartPaused=true;
  if(args.port!==undefined){
    if(!/^(?:0|[1-9][0-9]{0,4})$/.test(args.port)||Number(args.port)>65535)fail('--port must be 0 to 65535.');
    result.port=Number(args.port);
  }
  return result;
}
export async function quickbooksMain(argv=process.argv.slice(2)) {
  const args=parse(argv);
  if(args.command==='help'){process.stdout.write(QUICKBOOKS_HELP);return;}
  if(args.command==='init'){
    const profile=await createQuickBooksProfile({clientId:required(args,'client-id'),
      clientSecretEnv:required(args,'client-secret-env'),environment:required(args,'environment'),callbackOrigin:required(args,'callback-origin'),label:args.label??'QuickBooks Online'});
    print(await initializeOAuthConnection(resolve(required(args,'directory')),{profile}));return;
  }
  if(args.command==='status'){
    print(quickBooksSelectionSummary(await readQuickBooksSelection(resolve(required(args,'selection-directory')))));return;
  }
  if(args.command==='serve'){
    const connected=await startQuickBooksAccountingWorkspace({
      connectionsFile:resolve(required(args,'connections')),selectionDirectory:resolve(required(args,'selection-directory')),
      env:process.env,allowLoopback:args['allow-loopback']===true,...accountingOptions(args)});
    print({url:connected.accounting.url+'/qbo.html',selection:connected.selection});
    let stopped=false;
    const stop=()=>{
      if(stopped)return;stopped=true;
      process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
      connected.close().catch(error=>{process.stderr.write(safeCode(error)+'\n');process.exitCode=1;});
    };
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return connected;
  }
  const owner=await registry(args);
  try {
    if(args.command==='list'){print({connections:await listQuickBooksConnections(owner)});return;}
    if(args.command==='preview'){
      const output=resolve(required(args,'out'));await privateDirectory(dirname(output));
      const selection=await previewQuickBooksSelection({registry:owner,alias:required(args,'alias'),
        profileSha256:required(args,'profile'),grantId:required(args,'grant'),realmId:required(args,'realm'),
        environment:required(args,'environment'),actor:required(args,'actor'),reference:required(args,'reference'),
        minorVersion:args['minor-version']??null,env:process.env,allowLoopback:args['allow-loopback']===true});
      await createFile(output,bytes(selection));
      print({previewFile:output,...quickBooksSelectionSummary(selection)});return;
    }
    const selected=await saveQuickBooksSelection(resolve(required(args,'selection-directory')),{
      registry:owner,selection:await readJson(resolve(required(args,'preview')),QUICKBOOKS_SELECTION_BYTES),
      previewSha256:required(args,'preview-sha'),expectedSelectionSha256:args['previous-sha']??null});
    print({duplicate:selected.duplicate,...quickBooksSelectionSummary(selected.selection)});
  } finally {await owner.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  quickbooksMain().catch(error=>{process.stderr.write((error instanceof TypeError?error.message:safeCode(error))+'\n');process.exitCode=1;});
}
