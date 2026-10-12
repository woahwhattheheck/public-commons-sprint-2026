// MIT. Dedicated native execution process; SF103's lazy signer session is local.
import { loadWalletOperator } from './workspace.mjs';
import { inspectBrowserWallet, bindWalletExecution } from './client.mjs';
import { requireValue } from './common.mjs';

async function run() {
  const args=process.argv.slice(2);
  requireValue(args.length===4 && args[0]==='--workspace' && args[2]==='--operator-workspace',
    'WALLET_EXECUTION_ARGUMENTS_INVALID');
  const {config,original,derived,rpcUrl}=await loadWalletOperator(args[1],args[3]);
  requireValue(process.env.SF103_SIGNER_CONFIG===config.nativeSignerConfig,
    'WALLET_PROCESS_BINDING_CHANGED');
  const {inspectNativeSignerRuntime}=await import('../../sf88-operator-buyer-cli/native-signer.mjs');
  await inspectNativeSignerRuntime(config.network);
  const ready=await inspectBrowserWallet(config.directory);
  requireValue(ready.state==='CONNECTED','WALLET_CONNECT_IN_BROWSER');
  const {execute}=await import('../../sf88-operator-buyer-cli/execute.mjs');
  const controller=new AbortController();
  let signalExit;
  const interrupt=()=>{signalExit??=130;controller.abort();};
  const terminate=()=>{signalExit??=143;controller.abort();};
  process.on('SIGINT',interrupt); process.on('SIGTERM',terminate);
  const unbind=bindWalletExecution(controller.signal);
  try {
    await execute(derived,{
      signal:controller.signal,environment:original.operatorEnvironment,evidenceRpcEndpoint:rpcUrl,
    });
  } finally {
    unbind();
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
    if(signalExit)process.exitCode=signalExit;
  }
}
run().catch(error=>{
  process.stderr.write((/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?
    error.code:'WALLET_NATIVE_EXECUTION_FAILED')+'\n');
  if(!process.exitCode)process.exitCode=1;
});
