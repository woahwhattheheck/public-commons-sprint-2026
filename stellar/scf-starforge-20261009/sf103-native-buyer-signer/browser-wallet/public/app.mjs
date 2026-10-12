// MIT. Official Freighter API over one authenticated local operator session.
const $=id=>document.getElementById(id);
const api=window.freighterApi;
const sessionKey='sf103-browser-session';
const supplied=new URLSearchParams(location.hash.slice(1)).get('session');
if(location.hash) history.replaceState(null,'',location.pathname);
let token='';
try {
  if(/^[a-f0-9]{64}$/.test(supplied??'')) sessionStorage.setItem(sessionKey,supplied);
  token=sessionStorage.getItem(sessionKey)??'';
} catch {token=supplied??'';}
let state=null,busy=false,stopped=false,requestRenderKey='',historyRenderKey='',operationRenderKey='';
let timer,checking=false,lastWalletCheck=0;
const messages={
  WALLET_CONNECT_IN_BROWSER:'Connect the payer account in Freighter.',
  WALLET_ACCOUNT_MISMATCH:'Select the operation’s payer account in Freighter, then connect again.',
  WALLET_NETWORK_MISMATCH:'Select the operation’s Stellar network in Freighter, then connect again.',
  WALLET_CONNECTION_CHANGED:'The wallet connection changed. Reconnect the payer account.',
  WALLET_EXTENSION_UNAVAILABLE:'Open this page in a browser with the Freighter extension installed and enabled.',
  WALLET_EXTENSION_REJECTED:'Freighter declined or cancelled the authorization.',
  WALLET_REQUEST_CHANGED:'This request has changed. The current retained state is shown below.',
  WALLET_SIGNING_CLAIM_CHANGED:'This signing session ended. Review the retained activity below.',
  WALLET_REQUEST_EXPIRED:'The authorization request expired. Its state is retained below.',
  WALLET_BUYER_CANCELLED:'The buyer operation was cancelled. Its wallet request has ended.',
  WALLET_SESSION_REQUIRED:'Open the current private URL printed by browser-wallet serve.',
  WALLET_ORIGIN_REJECTED:'Open the local workspace directly in its browser tab.',
  WALLET_SIGNATURE_INVALID:'The returned signature did not match this payer and transfer.',
  WALLET_NETWORK_ERROR:'The local wallet service could not be reached. Reopen the current private URL after the service is available.',
};
const coded=code=>Object.assign(new Error(code),{code});
function notice(value) {$('notice').textContent=value;}
function explain(error) {return messages[error?.code]??(error?.code||'The operation could not be completed.');}
async function call(path,value) {
  let response;
  try {response=await fetch(path,{method:value===undefined?'GET':'POST',credentials:'omit',
    redirect:'error',cache:'no-store',headers:{authorization:'Bearer '+token,
      ...(value===undefined?{}:{'content-type':'application/json'})},
    ...(value===undefined?{}:{body:JSON.stringify(value)})});}
  catch {throw coded('WALLET_NETWORK_ERROR');}
  let data;try {data=await response.json();} catch {throw coded('WALLET_NETWORK_ERROR');}
  if(!response.ok) throw coded(/^[A-Z0-9_]{1,100}$/.test(data.error??'')?data.error:'WALLET_NETWORK_ERROR');
  return data;
}
function pair(list,label,value,mono=false) {
  const dt=document.createElement('dt'),dd=document.createElement('dd');
  dt.textContent=label;dd.textContent=value==null?'—':String(value);
  if(mono)dd.className='mono';list.append(dt,dd);
}
const date=value=>{const d=new Date(value);return Number.isFinite(d.valueOf())?d.toLocaleString():value;};
function renderOperation() {
  const key=JSON.stringify([state.walletId,state.operation]);
  if(operationRenderKey===key)return;operationRenderKey=key;
  $('operation').replaceChildren();
  const op=state.operation;
  pair($('operation'),'Intent',op.intentId,true);
  pair($('operation'),'Request',op.method+' '+op.url,true);
  pair($('operation'),'Asset',op.expect.asset,true);
  pair($('operation'),'Recipient',op.expect.payTo,true);
  pair($('operation'),'Spending cap',op.expect.maxAtomic+' atomic units');
  $('network').textContent=state.network;
  $('workspace-id').textContent='Workspace '+state.walletId;
  $('runtime').textContent='Freighter API '+state.freighterVersion;
}
function render() {
  if(!state)return;
  renderOperation();
  const connection=state.connection;
  $('connection-status').textContent=connection?'Wallet connected':'Wallet disconnected';
  $('wallet-state').textContent=connection?'Connected':'Disconnected';
  $('wallet').replaceChildren();
  pair($('wallet'),'Payer',state.payer,true);
  pair($('wallet'),'Network',state.network);
  if(connection)pair($('wallet'),'Connected',date(connection.connectedAt));
  $('connect').disabled=busy||Boolean(connection);
  $('disconnect').disabled=busy||!connection;
  const active=state.requests.find(r=>r.state==='PENDING'||r.state==='SIGNING');
  const recent=active??state.requests.at(-1);
  const key=JSON.stringify([recent,connection?.id,busy]);
  if(key!==requestRenderKey) {
    requestRenderKey=key;const area=$('request');area.replaceChildren();
    $('request-state').textContent=recent?.state??'Waiting';
    if(recent) {
      const dl=document.createElement('dl');area.append(dl);
      pair(dl,'Amount',recent.details.amountAtomic+' atomic units');
      pair(dl,'Recipient',recent.details.recipient,true);
      pair(dl,'Asset',recent.details.asset,true);
      pair(dl,'Nonce',recent.details.nonce,true);
      pair(dl,'Valid through','Ledger '+recent.details.expirationLedger);
      pair(dl,'Local deadline',date(recent.expiresAt));
      pair(dl,'Payload SHA-256',recent.details.payloadSha256,true);
      const note=document.createElement('p');note.className='request-note';area.append(note);
      if(recent.state==='PENDING') {
        note.textContent='Review the exact transfer, then open the Freighter authorization prompt.';
        const actions=document.createElement('div');actions.className='actions';area.append(actions);
        const sign=document.createElement('button');sign.type='button';sign.textContent='Sign in Freighter';
        sign.disabled=busy||!connection;sign.addEventListener('click',()=>signRequest(recent,connection));actions.append(sign);
        const reject=document.createElement('button');reject.type='button';reject.className='secondary';
        reject.textContent='Reject request';reject.disabled=busy;
        reject.addEventListener('click',()=>rejectRequest(recent));actions.append(reject);
      } else if(recent.state==='SIGNING') {
        note.textContent='This request has opened a signing session. Complete the existing Freighter prompt. The request will expire at its local deadline if the browser session was interrupted.';
      } else if(recent.state==='SIGNED') {
        note.textContent='The payer’s signature is verified and retained for the original buyer. Follow the buyer terminal for payment and delivery status.';
      } else {
        note.textContent=messages[recent.error]??(recent.error||'The request has ended.');
      }
    } else {
      const empty=document.createElement('p');empty.className='empty';
      empty.textContent='Connect your wallet, then run the original buyer operation from its terminal.';area.append(empty);
    }
  }
  const historyKey=JSON.stringify(state.requests.map(r=>[r.id,r.revision,r.state]));
  if(historyKey!==historyRenderKey) {
    historyRenderKey=historyKey;$('history').replaceChildren();
    for(const row of state.requests.slice().reverse()) {
      const tr=document.createElement('tr');
      for(const value of [date(row.createdAt),row.state,row.details.amountAtomic,row.id]) {
        const td=document.createElement('td');td.textContent=value;tr.append(td);
      }
      $('history').append(tr);
    }
    $('history-count').textContent=state.requests.length+' requests';
  }
}
function extensionError(result) {if(result?.error)throw coded('WALLET_EXTENSION_REJECTED');return result;}
async function currentWallet(expected) {
  if(!api)throw coded('WALLET_EXTENSION_UNAVAILABLE');
  const account=extensionError(await api.getAddress());
  const network=extensionError(await api.getNetworkDetails());
  if(account.address!==expected.address)throw coded('WALLET_ACCOUNT_MISMATCH');
  if(network.networkPassphrase!==expected.networkPassphrase)throw coded('WALLET_NETWORK_MISMATCH');
  return {address:account.address,networkPassphrase:network.networkPassphrase};
}
async function refresh() {state=await call('/api/state');render();}
async function connect() {
  if(busy)return;busy=true;render();
  try {
    if(!api)throw coded('WALLET_EXTENSION_UNAVAILABLE');
    const installed=extensionError(await api.isConnected());
    if(!installed.isConnected)throw coded('WALLET_EXTENSION_UNAVAILABLE');
    const account=extensionError(await api.requestAccess());
    const network=extensionError(await api.getNetworkDetails());
    if(account.address!==state.payer)throw coded('WALLET_ACCOUNT_MISMATCH');
    await call('/api/connect',{address:account.address,networkPassphrase:network.networkPassphrase});
    notice('Wallet connected. Start the original buyer operation from its terminal.');
  } catch(error) {notice(explain(error));}
  finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function disconnect() {
  if(busy||!state?.connection)return;busy=true;render();
  try {await call('/api/disconnect',{connectionId:state.connection.id});notice('Wallet disconnected.');}
  catch(error) {notice(explain(error));}
  finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function rejectRequest(row) {
  if(busy)return;busy=true;render();
  try {await call('/api/requests/'+row.id+'/reject',{revision:row.revision});notice('Authorization request rejected.');}
  catch(error) {notice(explain(error));}
  finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function signRequest(row,connection) {
  if(busy||!connection)return;busy=true;render();
  let claim,completed=false;
  try {
    await currentWallet(connection);
    claim=await call('/api/requests/'+row.id+'/claim',{
      revision:row.revision,payloadSha256:row.details.payloadSha256,connectionId:connection.id,
    });
    await currentWallet(connection);
    notice('Complete the existing authorization prompt in Freighter.');
    const result=extensionError(await api.signAuthEntry(claim.entryXdr,{
      address:claim.address,networkPassphrase:claim.networkPassphrase,
    }));
    await currentWallet(connection);
    const outcome=await call('/api/requests/'+row.id+'/complete',{
      claimId:claim.claimId,connectionId:connection.id,
      result:{signedAuthEntry:result.signedAuthEntry,signerAddress:result.signerAddress},
    });
    completed=true;
    notice(outcome.state==='SIGNED'?'Signature verified. The original buyer is continuing the operation.':
      (messages[outcome.error]??outcome.error??'The authorization ended.'));
  } catch(error) {
    // An exact claim can be ended, but a signing call is never retried here.
    if(claim&&!completed&&error.code!=='WALLET_NETWORK_ERROR') {
      await call('/api/requests/'+row.id+'/complete',{
        claimId:claim.claimId,connectionId:connection.id,
        error:/^[A-Z0-9_]{1,80}$/.test(error.code??'')?error.code:'WALLET_EXTENSION_REJECTED',
      }).catch(()=>{});
    }
    notice(explain(error));
  } finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function poll() {
  if(stopped)return;
  try {
    await refresh();
    if(!busy&&!checking&&state.connection&&Date.now()-lastWalletCheck>5000) {
      checking=true;lastWalletCheck=Date.now();const connection=state.connection;
      try {await currentWallet(connection);}
      catch(error) {
        await call('/api/disconnect',{connectionId:connection.id}).catch(()=>{});
        notice(explain(error));await refresh();
      } finally {checking=false;}
    }
  } catch(error) {
    notice(explain(error));
    if(error.code==='WALLET_SESSION_REQUIRED') {
      stopped=true;state=null;$('connect').disabled=true;$('disconnect').disabled=true;
      $('connection-status').textContent='Session ended';
      $('request').replaceChildren();$('request-state').textContent='Closed';
    }
  }
  if(!stopped)timer=setTimeout(poll,1000);
}
$('connect').addEventListener('click',connect);
$('disconnect').addEventListener('click',disconnect);
window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
if(!/^[a-f0-9]{64}$/.test(token)) {
  notice(messages.WALLET_SESSION_REQUIRED);$('connect').disabled=true;
} else {
  poll().then(()=>{if(state)notice('Review the retained operation and connect its payer account.');});
}
