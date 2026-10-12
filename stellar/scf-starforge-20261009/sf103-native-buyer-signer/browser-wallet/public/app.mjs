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
let timer,pulseTimer,checking=false,lastWalletCheck=0;
let clientId='',tabOwned=false,releaseTab=null,draft=null,storageReady=true;
let refreshStarted=0,refreshApplied=0;
const clientKey='sf103-browser-client',draftKey='sf103-browser-request';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const messages={
  WALLET_CONNECT_IN_BROWSER:'Connect the payer account in Freighter.',
  WALLET_ACCOUNT_MISMATCH:'Select the operation’s payer account in Freighter, then connect again.',
  WALLET_NETWORK_MISMATCH:'Select the operation’s Stellar network in Freighter, then connect again.',
  WALLET_CONNECTION_OWNED:'This wallet is connected in another tab. Return to that tab, or reconnect after its connection expires.',
  WALLET_BROWSER_DISCONNECTED:'The browser connection ended. This authorization remains interrupted.',
  WALLET_BUYER_DISCONNECTED:'The original buyer stopped polling. This authorization remains interrupted.',
  WALLET_STORAGE_REQUIRED:'Enable this browser’s private session storage to connect and recover wallet requests.',
  WALLET_TAB_LOCK_REQUIRED:'Open this page in a browser that supports Web Locks. This tab can still show the retained state.',
  WALLET_PROMPT_ALREADY_OPENED:'This reserved request has already opened Freighter. Complete that prompt or cancel this request; it will not open a second prompt.',
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
  const connection=state.connection,owned=Boolean(connection&&connection.clientId===clientId&&tabOwned);
  $('connection-status').textContent=connection?(owned?'Wallet connected':'Wallet connected in another tab'):'Wallet disconnected';
  $('wallet-state').textContent=connection?(owned?'Connected':'Another tab'):'Disconnected';
  $('wallet').replaceChildren();
  pair($('wallet'),'Payer',state.payer,true);
  pair($('wallet'),'Network',state.network);
  if(connection)pair($('wallet'),'Connected',date(connection.connectedAt));
  $('connect').disabled=busy||!tabOwned||!storageReady||Boolean(connection);
  $('disconnect').disabled=busy||!owned;
  const active=state.requests.find(r=>r.state==='PENDING'||r.state==='SIGNING');
  const recent=active??state.requests.at(-1);
  const saved=matchingDraft(recent);
  const key=JSON.stringify([recent,connection?.id,busy,owned,saved?.phase]);
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
        if(saved&&['CLAIMING','CLAIMED'].includes(saved.phase))sign.textContent='Continue reserved request';
        sign.disabled=busy||!owned||!storageReady;
        sign.addEventListener('click',()=>saved?recoverRequest(recent,connection,saved):signRequest(recent,connection));actions.append(sign);
        const reject=document.createElement('button');reject.type='button';reject.className='secondary';
        reject.textContent='Reject request';reject.disabled=busy||!tabOwned;
        reject.addEventListener('click',()=>rejectRequest(recent));actions.append(reject);
      } else if(recent.state==='SIGNING') {
        note.textContent=saved?.phase==='RESULT'
          ?'Freighter returned a signature for this exact request. Return those saved bytes to the original buyer without opening another prompt.'
          :saved&&['CLAIMING','CLAIMED'].includes(saved.phase)
            ?'This tab reserved the request before opening Freighter. Continue that same reservation when ready.'
            :'This request has opened a signing session. Complete the existing Freighter prompt. It will not open a second prompt after a reload.';
        if(saved&&owned) {
          const actions=document.createElement('div');actions.className='actions';area.append(actions);
          if(['CLAIMING','CLAIMED','RESULT','REJECTED'].includes(saved.phase)) {
            const resume=document.createElement('button');resume.type='button';
            resume.textContent=saved.phase==='RESULT'?'Return saved signature':
              saved.phase==='REJECTED'?'Return saved rejection':'Continue reserved request';
            resume.disabled=busy;resume.addEventListener('click',()=>recoverRequest(recent,connection,saved));actions.append(resume);
          }
          const cancel=document.createElement('button');cancel.type='button';cancel.className='secondary';
          cancel.textContent='Cancel authorization request';cancel.disabled=busy;
          cancel.addEventListener('click',()=>cancelRequest(recent,connection,saved));actions.append(cancel);
        }
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
function saveDraft(value) {
  draft=value;
  try {
    if(value===null)sessionStorage.removeItem(draftKey);
    else sessionStorage.setItem(draftKey,JSON.stringify(value));
  } catch {storageReady=false;throw coded('WALLET_STORAGE_REQUIRED');}
}
function matchingDraft(row) {
  return row&&draft&&draft.walletId===state.walletId&&draft.instanceId===state.instanceId&&
    draft.clientId===clientId&&draft.id===row.id&&
    draft.payloadSha256===row.details.payloadSha256 ? draft : null;
}
function connectionFor(saved) {
  const connection=state?.connection;
  if(!tabOwned||!connection||connection.clientId!==clientId||
    connection.id!==saved.connectionId)throw coded('WALLET_CONNECTION_CHANGED');
  return connection;
}
async function ownTab() {
  try {
    const previous=sessionStorage.getItem(clientKey);
    clientId=uuid.test(previous??'')?previous:crypto.randomUUID();
    sessionStorage.setItem(clientKey,clientId);
    const raw=sessionStorage.getItem(draftKey);
    if(raw&&raw.length<=524288) {
      const value=JSON.parse(raw);
      if(value&&value.schema==='stellar-forge.browser-wallet-draft.v1'&&value.clientId===clientId&&
        uuid.test(value.claimId??'')&&/^[a-f0-9]{64}$/.test(value.id??'')&&
        ['CLAIMING','CLAIMED','PROMPTED','RESULT','REJECTED'].includes(value.phase))draft=value;
    }
  } catch {storageReady=false;throw coded('WALLET_STORAGE_REQUIRED');}
  if(!navigator.locks?.request)throw coded('WALLET_TAB_LOCK_REQUIRED');
  const acquire=()=>new Promise(resolve=>{
    navigator.locks.request('sf103-browser-wallet:'+clientId,{ifAvailable:true},async lock=>{
      if(!lock||stopped){resolve(false);return;}
      const held=new Promise(done=>{releaseTab=done;});
      resolve(true);await held;
    }).catch(()=>resolve(false));
  });
  if(!await acquire()) {
    // Duplicate Tab can clone sessionStorage. A distinct Web Lock prevents the
    // cloned claim from becoming a second authorization popup.
    clientId=crypto.randomUUID();sessionStorage.setItem(clientKey,clientId);saveDraft(null);
    if(!await acquire())throw coded('WALLET_TAB_LOCK_REQUIRED');
  }
  tabOwned=true;
}
async function refresh() {
  const generation=++refreshStarted,value=await call('/api/state');
  if(generation<refreshApplied)return;
  refreshApplied=generation;state=value;
  if(draft&&draft.walletId===state.walletId) {
    const row=state.requests.find(r=>r.id===draft.id&&r.details.payloadSha256===draft.payloadSha256);
    if(row&&!['PENDING','SIGNING'].includes(row.state)) {
      try {saveDraft(null);} catch(error) {notice(explain(error));}
    }
  }
  render();
}
async function connect() {
  if(busy||!tabOwned||!storageReady)return;busy=true;render();
  try {
    if(!api)throw coded('WALLET_EXTENSION_UNAVAILABLE');
    const installed=extensionError(await api.isConnected());
    if(!installed.isConnected)throw coded('WALLET_EXTENSION_UNAVAILABLE');
    const account=extensionError(await api.requestAccess());
    const network=extensionError(await api.getNetworkDetails());
    if(account.address!==state.payer)throw coded('WALLET_ACCOUNT_MISMATCH');
    await call('/api/connect',{address:account.address,networkPassphrase:network.networkPassphrase,clientId});
    notice('Wallet connected. Start the original buyer operation from its terminal.');
  } catch(error) {notice(explain(error));}
  finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function disconnect() {
  if(busy||!tabOwned||state?.connection?.clientId!==clientId)return;busy=true;render();
  try {await call('/api/disconnect',{connectionId:state.connection.id,clientId});notice('Wallet disconnected.');}
  catch(error) {notice(explain(error));}
  finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function rejectRequest(row) {
  if(busy||!tabOwned)return;busy=true;render();
  try {await call('/api/requests/'+row.id+'/reject',{revision:row.revision});notice('Authorization request rejected.');}
  catch(error) {notice(explain(error));}
  finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function returnSaved(saved) {
  const connection=connectionFor(saved);
  if(saved.phase==='RESULT')await currentWallet(connection);
  await refresh();
  const row=state.requests.find(r=>r.id===saved.id);
  if(row?.state==='SIGNED'&&row.details.payloadSha256===saved.payloadSha256) {
    saveDraft(null);return row;
  }
  connectionFor(saved);
  if(row?.state!=='SIGNING'||row.details.payloadSha256!==saved.payloadSha256)
    throw coded('WALLET_SIGNING_CLAIM_CHANGED');
  const value={claimId:saved.claimId,connectionId:saved.connectionId,clientId};
  if(saved.phase==='RESULT')value.result=saved.result;
  else if(saved.phase==='REJECTED')value.error=saved.error;
  else throw coded('WALLET_PROMPT_ALREADY_OPENED');
  const outcome=await call('/api/requests/'+saved.id+'/complete',value);
  if(!['PENDING','SIGNING'].includes(outcome.state))saveDraft(null);
  notice(outcome.state==='SIGNED'?'Signature verified. The original buyer is continuing the operation.':
    (messages[outcome.error]??outcome.error??'The authorization ended.'));
  return outcome;
}
async function signRequest(row,connection,resume) {
  if(busy||!tabOwned||!connection||connection.clientId!==clientId||!storageReady)return;
  busy=true;render();
  let saved=resume;
  try {
    if(saved&&!['CLAIMING','CLAIMED'].includes(saved.phase))throw coded('WALLET_PROMPT_ALREADY_OPENED');
    await currentWallet(connection);
    if(!saved) {
      saved={schema:'stellar-forge.browser-wallet-draft.v1',walletId:state.walletId,
        instanceId:state.instanceId,clientId,connectionId:connection.id,id:row.id,
        revision:row.revision,payloadSha256:row.details.payloadSha256,
        claimId:crypto.randomUUID(),phase:'CLAIMING'};
      saveDraft(saved);
    }
    connectionFor(saved);
    const claim=await call('/api/requests/'+row.id+'/claim',{
      revision:saved.revision,payloadSha256:saved.payloadSha256,
      connectionId:saved.connectionId,clientId,claimId:saved.claimId,
    });
    if(claim.id!==saved.id||claim.claimId!==saved.claimId||
      claim.details.payloadSha256!==saved.payloadSha256)throw coded('WALLET_REQUEST_CHANGED');
    saved={...saved,phase:'CLAIMED'};saveDraft(saved);
    await currentWallet(connection);
    connectionFor(saved);
    // This durable phase is written BEFORE invoking the extension. A resumed
    // PROMPTED draft is never permitted to call signAuthEntry a second time.
    saved={...saved,phase:'PROMPTED'};saveDraft(saved);
    notice('Complete the existing authorization prompt in Freighter.');
    const result=extensionError(await api.signAuthEntry(claim.entryXdr,{
      address:claim.address,networkPassphrase:claim.networkPassphrase,
    }));
    saved={...saved,phase:'RESULT',result:{
      signedAuthEntry:result.signedAuthEntry,signerAddress:result.signerAddress,
    }};
    saveDraft(saved);
    await returnSaved(saved);
  } catch(error) {
    // Preserve an uncertain claim or returned signature. Recovery resubmits
    // the same claim/result only after an explicit operator action.
    if(saved&&['CLAIMED','PROMPTED'].includes(saved.phase)&&
      !['WALLET_NETWORK_ERROR','WALLET_STORAGE_REQUIRED'].includes(error.code)) {
      saved={...saved,phase:'REJECTED',
        error:/^[A-Z0-9_]{1,80}$/.test(error.code??'')?error.code:'WALLET_EXTENSION_REJECTED'};
      try {saveDraft(saved);await returnSaved(saved);} catch {}
    }
    notice(explain(error));
  } finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function recoverRequest(row,connection,saved) {
  if(busy||matchingDraft(row)!==saved)return;
  if(['CLAIMING','CLAIMED'].includes(saved.phase))return signRequest(row,connection,saved);
  busy=true;render();
  try {await returnSaved(saved);}
  catch(error) {notice(explain(error));}
  finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function cancelRequest(row,connection,saved) {
  if(busy||matchingDraft(row)!==saved||connection?.id!==saved.connectionId)return;
  busy=true;render();
  try {
    const rejected={...saved,phase:'REJECTED',error:'WALLET_OPERATOR_REJECTED'};delete rejected.result;
    saveDraft(rejected);await returnSaved(rejected);
  } catch(error) {notice(explain(error));}
  finally {busy=false;await refresh().catch(error=>notice(explain(error)));}
}
async function heartbeat() {
  if(stopped)return;
  const connection=state?.connection;
  try {
    if(tabOwned&&connection?.clientId===clientId) {
      // Keep liveness separate from extension RPC calls: an open wallet popup
      // may take longer than the connection deadline. Account/network are
      // checked before the prompt and again before returning its signature.
      await call('/api/heartbeat',{connectionId:connection.id,clientId,
        address:connection.address,networkPassphrase:connection.networkPassphrase});
    }
  } catch(error) {
    notice(explain(error));await refresh().catch(()=>{});
  } finally {if(!stopped)pulseTimer=setTimeout(heartbeat,3000);}
}
async function poll() {
  if(stopped)return;
  try {
    await refresh();
    if(!busy&&!checking&&tabOwned&&state.connection?.clientId===clientId&&Date.now()-lastWalletCheck>5000) {
      checking=true;lastWalletCheck=Date.now();const connection=state.connection;
      try {await currentWallet(connection);}
      catch(error) {
        const retained=state.requests.find(row=>row.state==='SIGNING'&&matchingDraft(row)?.phase==='RESULT');
        // A signature already returned by Freighter remains recoverable while
        // the operator restores its account/network. Delivery still rechecks.
        if(!retained)await call('/api/disconnect',{connectionId:connection.id,clientId}).catch(()=>{});
        notice(explain(error));await refresh();
      } finally {checking=false;}
    }
  } catch(error) {
    notice(explain(error));
    if(error.code==='WALLET_SESSION_REQUIRED') {
      stopped=true;clearTimeout(pulseTimer);releaseTab?.();tabOwned=false;
      state=null;$('connect').disabled=true;$('disconnect').disabled=true;
      $('connection-status').textContent='Session ended';
      $('request').replaceChildren();$('request-state').textContent='Closed';
    }
  }
  if(!stopped)timer=setTimeout(poll,1000);
}
$('connect').addEventListener('click',connect);
$('disconnect').addEventListener('click',disconnect);
window.addEventListener('pagehide',()=>{
  stopped=true;clearTimeout(timer);clearTimeout(pulseTimer);releaseTab?.();tabOwned=false;
});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
if(!/^[a-f0-9]{64}$/.test(token)) {
  notice(messages.WALLET_SESSION_REQUIRED);$('connect').disabled=true;
} else {
  ownTab().catch(error=>notice(explain(error))).then(()=>{
    if(stopped)return;
    heartbeat();
    poll();
  });
}
