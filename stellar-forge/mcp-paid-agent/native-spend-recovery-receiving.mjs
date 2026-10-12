/** MIT. One original native spending-owner receiving journey for the existing application runner. */
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
export async function runNativeMcpSpendingRecoveryReceiving({sourceRoot,work,python = '/usr/bin/python3'} = {}) {
const source=resolve(sourceRoot),operation=resolve(work);
await mkdir(operation,{mode:0o700,recursive:true});
await writeFile(join(operation,'fixture.py'),fixtureSource,{mode:0o600,flag:'wx'});
const native = await import(pathToFileURL(join(source,'stellar-forge/mcp-paid-agent/native-spend-recovery.mjs')));
const names=['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
const environment={...process.env,MCP_BACKUP_PASSPHRASE:randomBytes(32).toString('base64')};
for(const name of names)environment[name]=randomBytes(32).toString('base64');
const owner=join(operation,'owner'),bundle=join(operation,'encrypted');
const setup=spawnSync(python,['-I','-B',join(operation,'fixture.py'),source,owner],
 {env:environment,encoding:'utf8'});
assert.equal(setup.status,0,setup.stderr);
const fixture=JSON.parse(setup.stdout); const steps=[];
const snapshot=await native.snapshotNativeMcpSpendingRecovery({configFile:fixture.configFile,output:bundle,
 passphraseEnv:'MCP_BACKUP_PASSPHRASE',quiesced:true,operationId:'native-recovery-original-case',environment});
assert.deepEqual(snapshot.nativeState,{boundRequests:2,reservedRequests:1,finalityRecords:1});
assert.equal(snapshot.checkpoint.rows,2);
assert.equal(snapshot.boundRequestReferences.length,2);
for(let i=0;i<fixture.bindings.length;i++){
 const ref=snapshot.boundRequestReferences.find(ref=>ref.request_id===fixture.bindings[i].quoteId);
 assert.equal(ref.request_sha256,fixture.requestSha256s[i]);assert.equal(ref.actor,'demo-native');assert.equal(ref.service,'recovery-case');
}
steps.push('snapshot-original-reserved-and-settled');
const selected={bundle,passphraseEnv:'MCP_BACKUP_PASSPHRASE',expectedManifestSha256:snapshot.manifestSha256,
 expectedRecordSha256:snapshot.recordSha256,environment,temporaryDirectory:operation,python};
const verified=await native.verifyNativeMcpSpendingRecovery(selected);
assert.deepEqual(verified.checkpoint,snapshot.checkpoint);steps.push('authenticated-full-verification');
await assert.rejects(native.verifyNativeMcpSpendingRecovery({...selected,expectedManifestSha256:'0'.repeat(64)}));
await assert.rejects(native.verifyNativeMcpSpendingRecovery({...selected,environment:{...environment,MCP_BACKUP_PASSPHRASE:'incorrect passphrase value'}}));
steps.push('wrong-selection-and-passphrase-refused');
const existing=await native.restoreNativeMcpSpendingRecovery(selected);
assert.equal(existing.status,'NATIVE_SPENDING_OWNER_REATTACHED');assert.equal(existing.created.length,0);
steps.push('exact-existing-owner-reattachment');
await rename(fixture.stateDirectory,fixture.stateDirectory+'-before');await rename(fixture.configFile,fixture.configFile+'-before');
const partial=await native.restoreNativeMcpSpendingRecovery(selected);
assert.equal(partial.status,'NATIVE_SPENDING_OWNER_REATTACHED');
assert.equal(partial.currentLedgerIdentity.ino,snapshot.ledgerIdentity.ino);steps.push('shared-ledger-preserved-native-state-restored');
await rename(owner,owner+'-before');await mkdir(owner,{mode:0o700});
const restored=await native.restoreNativeMcpSpendingRecovery(selected);
assert.equal(restored.status,'NATIVE_SPENDING_OWNER_RESTORED');
assert.deepEqual(restored.checkpoint,snapshot.checkpoint);steps.push('canonical-complete-owner-restore');
const recoveredEnvironment={...environment};for(const name of names)delete recoveredEnvironment[name];
let retained;
await native.withNativeMcpSpendingRecoveryEnvironment({...selected,environment:recoveredEnvironment},async({environment:scoped})=>{
 retained=scoped;for(const name of names)assert.equal(scoped[name],environment[name]);
 const helper=join(source,'stellar-forge/mcp-paid-agent/native-spend-governor.py');
 const cfg=JSON.parse(await readFile(fixture.configFile,'utf8'));const s=cfg.spending;
 for(const binding of fixture.bindings){
  const replay=spawnSync(s.python,['-I','-B',helper,'--actor',s.actor,'--service',s.service,'--policy',s.policy,
   '--ledger',s.ledger,'--state-directory',s.stateDirectory],{env:scoped,encoding:'utf8',input:JSON.stringify({action:'reserve',binding})});
  assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).outcome,'IDEMPOTENT_EXISTING');
 }
});for(const name of names)assert.equal(retained[name],undefined);
steps.push('scoped-original-keys-and-no-fresh-replay-reservation');
const cfg=JSON.parse(await readFile(fixture.configFile,'utf8')),s=cfg.spending;
const bindings=fixture.bindings;const changed={...bindings[0],quoteId:randomUUID()};
changed.request={...changed.request,request_id:changed.quoteId};
const advance=spawnSync(s.python,['-I','-B',join(source,'stellar-forge/mcp-paid-agent/native-spend-governor.py'),'--actor',s.actor,
 '--service',s.service,'--policy',s.policy,'--ledger',s.ledger,'--state-directory',s.stateDirectory],
 {env:environment,encoding:'utf8',input:JSON.stringify({action:'reserve',binding:changed})});
assert.equal(advance.status,0,advance.stderr);assert.equal(JSON.parse(advance.stdout).outcome,'RESERVED');
await assert.rejects(native.restoreNativeMcpSpendingRecovery(selected));steps.push('advanced-original-history-retained');
const current=await native.verifyCurrentNativeMcpSpendingOwner(selected);
assert.equal(current.currentCheckpoint.rows,3);assert.deepEqual(current.archivePrefix,snapshot.checkpoint);
assert.equal(current.currentNativeState.boundRequests,3);steps.push('advanced-original-journal-prefix-and-native-state-verified');
const report={operation:'native-recovery-original-case',status:'PASSED',steps,checkpoint:snapshot.checkpoint,
 nativeState:snapshot.nativeState,recordSha256:snapshot.recordSha256,manifestSha256:snapshot.manifestSha256};
await writeFile(join(operation,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
return report;
}

const fixtureSource = "import importlib.util, json, os, sys\nfrom pathlib import Path\nfrom types import SimpleNamespace\nfrom uuid import uuid4\nsrc, home = map(Path, sys.argv[1:3]); os.umask(0o077)\nspec = importlib.util.spec_from_file_location('native_fixture',src/'stellar-forge/mcp-paid-agent/native-spend-governor.py')\nnative = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)\nhome.mkdir(mode=0o700); state=home/'native-state'; state.mkdir(mode=0o700)\nactor, service, payer, pay_to, asset='demo-native','recovery-case','G'+'A'*55,'G'+'B'*55,'C'+'C'*55\npolicy=home/'policy.json'; ledger=home/'ledger.sqlite'\npolicy.write_text(json.dumps({'schema':'stellar-spend-governor/v1','assets':[{'network':'stellar:testnet','asset':asset,\n  **{k:'1000' for k in ('max_single','max_total','max_per_utc_day','max_per_actor_utc_day','max_per_service_utc_day')}}]}))\nargs=SimpleNamespace(actor=actor,service=service,policy=policy,ledger=ledger,state_directory=state)\nnative.write_new(state/'configuration.json',{'schema':native.SCHEMA,'actor':actor,'service':service,'policy':str(policy),'ledger':str(ledger)})\nbindings=[]\nfor index in range(2):\n  quote=str(uuid4()); invocation={'endpoint':'https://merchant.example.com/mcp','transport':'streamable-http',\n    'toolName':'lookup','paymentResourceUrl':'https://merchant.example.com/mcp#lookup','arguments':{'selection':index},'inputSchemaSha256':'a'*64}\n  accepted={'scheme':'exact','network':'stellar:testnet','asset':asset,'amount':'7','payTo':pay_to,'maxTimeoutSeconds':60,\n    'extra':{'areFeesSponsored':True,'paymentFlow':'authorization'}}\n  invocation_json=json.dumps(invocation,separators=(',',':')); accepted_json=json.dumps(accepted,separators=(',',':'))\n  request=native.validate_request({'request_id':quote,'actor':actor,'service':service,'network':'stellar:testnet','asset':asset,\n    'scheme':'exact','max_amount':'7','resource':invocation['endpoint'],'pay_to':pay_to,'max_timeout_seconds':60,\n    'method':'POST','body_present':True,'body_bytes':len(invocation_json.encode()),'body_sha256':native.digest(invocation_json.encode()),\n    'accepted_terms_sha256':native.digest(accepted_json.encode())})\n  binding={'quoteId':quote,'payer':payer,'invocationJson':invocation_json,'acceptedJson':accepted_json,'request':request}\n  result=native.dispatch(args,{'action':'reserve','binding':binding}); assert result['outcome']=='RESERVED'\n  bindings.append(binding)\nbinding=bindings[1]; req=binding['request']; profile=native.NETWORKS['stellar:testnet']; tx='b'*64\ntransfer={'schema':'stellar-forge.sf86.rpc-reconciliation.v1','verdict':profile['transferVerdict'],'source':profile['rpcSource'],\n 'rpcEndpoint':profile['defaultRpc'],'networkPassphrase':profile['passphrase'],'intentId':req['request_id'],'transaction':tx,\n 'network':req['network'],'asset':asset,'payer':payer,'recipient':pay_to,'atomicAmount':'7','matchingTransfers':1,\n 'ledger':12345,'matchingEventId':'original-fixture-event'}\nproof={'schema':'stellar-forge.sf86.payment-attempt.v1','outcome':'TRANSFER_MATCHED','rpcStatus':'SUCCESS','transaction':tx,\n 'intentId':req['request_id'],'network':req['network'],'asset':asset,'payer':payer,'recipient':pay_to,'atomicAmount':'7',\n 'source':profile['rpcSource'],'rpcEndpoint':profile['defaultRpc'],'ledger':12345,'transfer':transfer}\nresult=native.dispatch(args,{'action':'finalize','binding':binding,'proof':proof}); assert result['reservation']['state']=='settled'\nconfig=home/'host.json'; config.write_text(json.dumps({'schema':'stellar-forge.mcp-spending-host.v1','payer':payer,\n 'signerSecretEnv':'RECOVERY_CASE_WALLET','rpcUrl':profile['defaultRpc'],'limits':{'network':'stellar:testnet','asset':asset,\n 'payTo':pay_to,'maxAtomic':'100','maxTimeoutSeconds':60},'spending':{'python':str(Path(sys.executable).resolve()),\n 'actor':actor,'service':service,'policy':str(policy),'ledger':str(ledger),'stateDirectory':str(state)}}))\nprint(json.dumps({'configFile':str(config),'ledger':str(ledger),'stateDirectory':str(state),'bindings':bindings,'requestSha256s':[native.digest(native.canonical(b['request'])) for b in bindings]}))\n";
