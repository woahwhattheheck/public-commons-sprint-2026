// MIT. Existing SF103/SF88 SEP-43 provider. This module never constructs a payment.
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { readWallet, readJson, requireValue, WalletError, LAUNCH_SCHEMA,
  PASSPHRASES, requestIdentity, object } from './common.mjs';
import { loadVerifier } from './verify.mjs';

// The dedicated execution child binds its original buyer cancellation before
// SDK simulation begins, including cancellation before signAuthEntry is called.
let activeExecutionSignal;
export function bindWalletExecution(signal) {
  requireValue(signal instanceof AbortSignal,'WALLET_ABORT_SIGNAL_INVALID');
  requireValue(activeExecutionSignal===undefined,'WALLET_EXECUTION_ALREADY_BOUND',409);
  activeExecutionSignal=signal;
  return ()=>{if(activeExecutionSignal===signal)activeExecutionSignal=undefined;};
}

export async function readWalletLaunch(config) {
  const launch = await readJson(join(config.directory,'launch.json'),16384);
  let url; try { url = new URL(launch.origin); } catch { throw new WalletError('WALLET_NOT_RUNNING',409); }
  requireValue(launch.schema === LAUNCH_SCHEMA && launch.state === 'LISTENING' &&
    launch.walletId === config.walletId && launch.buyerSha256 === config.buyerSha256 &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '' &&
    url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password &&
    typeof launch.providerToken === 'string' && /^[a-f0-9]{64}$/.test(launch.providerToken),
  'WALLET_LAUNCH_BINDING_INVALID',409);
  return launch;
}
async function call(launch, method, path, value, {signal,timeoutMs=5000}={}) {
  const encoded = value === undefined ? undefined : Buffer.from(JSON.stringify(value));
  return new Promise((resolve,reject) => {
    const url = new URL(path,launch.origin);
    const req = request({
      hostname:'127.0.0.1',port:url.port,path:url.pathname,method,agent:false,signal,
      headers:{authorization:'Bearer ' + launch.providerToken,
        ...(encoded ? {'content-type':'application/json','content-length':encoded.length} : {})},
    },res => {
      const chunks=[]; let size=0;
      res.on('data',chunk => {
        size += chunk.length;
        if (size > 262144) res.destroy(new WalletError('WALLET_RESPONSE_TOO_LARGE'));
        else chunks.push(chunk);
      });
      res.on('error',reject);
      res.on('end',() => {
        try {
          const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode < 200 || res.statusCode >= 300)
            return reject(new WalletError(/^[A-Z0-9_]{1,100}$/.test(data.error || '') ?
              data.error : 'WALLET_HTTP_FAILED',res.statusCode));
          resolve(data);
        } catch { reject(new WalletError('WALLET_RESPONSE_INVALID')); }
      });
    });
    req.setTimeout(timeoutMs,() => req.destroy(new WalletError('WALLET_HTTP_TIMEOUT')));
    req.on('error',e => reject(signal?.aborted ? new WalletError('WALLET_BUYER_CANCELLED',409) :
      e instanceof WalletError ? e : new WalletError('WALLET_CONNECTION_LOST',503)));
    req.end(encoded);
  });
}
export async function inspectBrowserWallet(directory) {
  const config=await readWallet(directory), launch=await readWalletLaunch(config);
  const ready=await call(launch,'GET','/provider/ready');
  requireValue(ready.walletId===config.walletId && ready.buyerSha256===config.buyerSha256 &&
    ready.instanceId===launch.instanceId && ready.payer===config.payer && ready.network===config.network,
  'WALLET_PROVIDER_BINDING_CHANGED',409);
  return ready;
}
/** Native contract: createSigner({network,payer}) -> {address,signAuthEntry}. */
export async function createBrowserSigner({directory, network, payer, verifier}={}) {
  const executionSignal=activeExecutionSignal;
  requireValue(!executionSignal?.aborted,'WALLET_BUYER_CANCELLED',409);
  const config=await readWallet(directory);
  requireValue(network===config.network && payer===config.payer,'WALLET_PROVIDER_IDENTITY_MISMATCH',409);
  verifier ??= await loadVerifier(config);
  const ready=await inspectBrowserWallet(directory);
  requireValue(ready.state==='CONNECTED','WALLET_CONNECT_IN_BROWSER',409);
  let attempted=false;
  return Object.freeze({
    address:payer,
    async signAuthEntry(entryXdr, opts) {
      requireValue(!executionSignal?.aborted,'WALLET_BUYER_CANCELLED',409);
      requireValue(!attempted,'WALLET_PROVIDER_ALREADY_ATTEMPTED',409);
      requireValue(opts===undefined || object(opts) && Object.keys(opts).every(k=>['networkPassphrase','address'].includes(k)),
        'WALLET_SIGN_OPTIONS_INVALID');
      requireValue(opts?.address===undefined || opts.address===payer,'WALLET_ACCOUNT_MISMATCH',409);
      requireValue(opts?.networkPassphrase===undefined || opts.networkPassphrase===PASSPHRASES[network],
        'WALLET_NETWORK_MISMATCH',409);
      verifier.inspect(entryXdr);
      attempted=true;
      const id=requestIdentity(config,entryXdr);
      const controller=new AbortController();
      const cancel=()=>controller.abort();
      process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
      executionSignal?.addEventListener('abort',cancel,{once:true});
      if(executionSignal?.aborted)cancel();
      try {
        const initial=await readWalletLaunch(config);
        let row;
        try {
          row=await call(initial,'POST','/provider/requests',{
            id,entryXdr,address:payer,networkPassphrase:PASSPHRASES[network],
          },{signal:controller.signal});
        } catch(error) {
          // Reconcile the exact ID after an uncertain POST, without another POST.
          if(!['WALLET_CONNECTION_LOST','WALLET_HTTP_TIMEOUT','WALLET_RESPONSE_INVALID'].includes(error.code))throw error;
          try {row=await call(await readWalletLaunch(config),'GET','/provider/requests/'+id,
            undefined,{signal:controller.signal});}
          catch {
            if(controller.signal.aborted)throw new WalletError('WALLET_BUYER_CANCELLED',409);
            throw new WalletError('WALLET_REQUEST_OUTCOME_UNCERTAIN',409);
          }
        }
        const deadline=Date.now()+config.requestLifetimeMs+5000;
        while(true) {
          requireValue(!controller.signal.aborted,'WALLET_BUYER_CANCELLED',409);
          requireValue(row.id===id,'WALLET_RESULT_ID_MISMATCH',409);
          if(row.state==='SIGNED')return verifier.verify(entryXdr,row.result);
          if(['REJECTED','EXPIRED','INTERRUPTED'].includes(row.state))
            throw new WalletError(row.error||'WALLET_REQUEST_ENDED',409);
          requireValue(['PENDING','SIGNING'].includes(row.state),'WALLET_RESULT_STATE_INVALID');
          requireValue(Date.now()<deadline,'WALLET_REQUEST_OUTCOME_UNCERTAIN',409);
          try {await delay(400,undefined,{signal:controller.signal});}
          catch {throw new WalletError('WALLET_BUYER_CANCELLED',409);}
          row=await call(await readWalletLaunch(config),'GET','/provider/requests/'+id,
            undefined,{signal:controller.signal});
        }
      } finally {
        process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
        executionSignal?.removeEventListener('abort',cancel);
        if(controller.signal.aborted) {
          try {
            await call(await readWalletLaunch(config),'POST','/provider/requests/'+id+'/cancel',{},
              {timeoutMs:2000});
          } catch {}
        }
      }
    },
  });
}
