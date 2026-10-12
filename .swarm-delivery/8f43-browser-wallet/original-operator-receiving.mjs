// MIT. Continue an existing SF88 operator through its original browser-wallet preparation.
import { mkdir, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const args = new Map();
const supplied = process.argv.slice(2);
for (let i=0; i<supplied.length; i+=2) {
  const name=supplied[i], value=supplied[i+1];
  if (!['--source-root','--operator-workspace','--wallet','--result'].includes(name) ||
      args.has(name) || typeof value!=='string' || !isAbsolute(value) ||
      value!==resolve(value) || value.includes('\0')) throw new Error('Choose the original absolute receiving paths');
  args.set(name,value);
}
if (args.size!==4) throw new Error('Required: --source-root ROOT --operator-workspace DIR --wallet DIR --result FILE');
const sourceRoot=args.get('--source-root'), operatorWorkspace=args.get('--operator-workspace');
const directory=args.get('--wallet'), resultPath=args.get('--result');
const moduleAt=relative=>import(pathToFileURL(join(sourceRoot,relative)).href);
const {readPrivate,readJson,readWallet,writeNew,privateDirectory,digest}=await moduleAt('sf103-native-buyer-signer/browser-wallet/common.mjs');
const {prepareBrowserWallet,inspectWalletWorkspace,loadWalletOperator}=await moduleAt('sf103-native-buyer-signer/browser-wallet/workspace.mjs');
const {openWorkspace}=await moduleAt('sf88-operator-buyer-cli/workspace.mjs');
await privateDirectory(operatorWorkspace);
const reviewed=await openWorkspace(['--dir',operatorWorkspace]);
const originalFiles=[reviewed.configPath,join(operatorWorkspace,'workspace.json'),
  join(operatorWorkspace,reviewed.manifest.keys),reviewed.config.signerModule];
const fingerprints=async()=>Promise.all(originalFiles.map(async path=>digest(await readPrivate(path,65536))));
const before=await fingerprints();
let prepared;
try {await lstat(directory);}
catch(error) {
  if(error.code!=='ENOENT')throw error;
  await mkdir(dirname(directory),{recursive:true,mode:0o700});
  await privateDirectory(dirname(directory));
  prepared=await prepareBrowserWallet({buyerConfig:reviewed.configPath,output:directory});
}
const wallet=await readWallet(directory);
if(wallet.sourceBuyerConfig!==reviewed.configPath ||
   wallet.sourceBuyerSha256!==digest(await readPrivate(reviewed.configPath,65536)))
  throw new Error('The retained wallet belongs to a different original operator configuration');
const inspected=await inspectWalletWorkspace(directory);
const loaded=await loadWalletOperator(directory,operatorWorkspace);
const keyNames=Object.keys(loaded.original.operatorEnvironment).sort();
if(!isDeepStrictEqual(keyNames,[
  'SF36_AUDIT_KEY_B64','SF36_CONSENT_KEY_B64','SF36_OPERATOR_KEY_B64']))
  throw new Error('The original workspace must supply its exact three accounting keys');
if(!isDeepStrictEqual(before,await fingerprints()))
  throw new Error('Original operator source changed during receiving');
const bindings={
  actor:loaded.original.config.operator.actor,
  service:loaded.original.config.operator.service,
  payer:wallet.payer,network:wallet.network,intentId:wallet.operation.intentId,
  method:wallet.operation.method,url:wallet.operation.url,
  policy:loaded.original.config.operator.policy,ledger:loaded.original.config.operator.ledger,
  buyerTransport:loaded.original.config.buyerTransport??null,
};
const result={
  schema:'stellar-forge.browser-wallet-operator-receiving.v1',
  completedAt:new Date().toISOString(),sourceRoot,operatorWorkspace,walletDirectory:directory,
  phase:prepared?'PREPARED_AND_REOPENED':'ORIGINAL_WALLET_REOPENED',
  walletId:wallet.walletId,bindings,
  originalSourceFilesPreserved:true,operatorKeyNames:keyNames,
  connection:inspected.connection,requests:inspected.requests,
  nextOriginalCommand:['browser-wallet','serve','--workspace',directory],
  originalExecute:['browser-wallet','execute','--workspace',directory,'--operator-workspace',operatorWorkspace],
};
await privateDirectory(dirname(resultPath));
try {await writeNew(resultPath,result);}
catch(error) {
  if(error.code!=='EEXIST')throw error;
  const retained=await readJson(resultPath,65536);
  if(retained.schema!==result.schema || retained.walletId!==result.walletId ||
     retained.operatorWorkspace!==operatorWorkspace || !isDeepStrictEqual(retained.bindings,bindings))
    throw new Error('The receiving result path already belongs to another operation');
  process.stdout.write(JSON.stringify(retained,null,2)+'\n');
  process.exit(0);
}
process.stdout.write(JSON.stringify(result,null,2)+'\n');
