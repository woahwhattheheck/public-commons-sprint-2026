// One retained local OAuth protocol peer for the joined original-application workflow.
// Not a customer identity provider or a payment engine. All issued credentials stay private.
import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,open,rename,mkdir,chmod} from 'node:fs/promises';
import {join} from 'node:path';
const id=()=>randomBytes(24).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const records=[{id:'R-1001',name:'Meter reading'},{id:'R-1002',name:'Maintenance appointment'},{id:'R-1003',name:'Service inspection'}];
async function atomic(file,value){
 const temp=file+'.tmp-'+id(),handle=await open(temp,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 await rename(temp,file);const dir=await open(join(file,'..'),'r');try{await dir.sync();}finally{await dir.close();}
}
async function body(req){
 const parts=[];let count=0;for await(const part of req){count+=part.length;if(count>65536)throw Error('REQUEST_TOO_LARGE');parts.push(part);}
 return new URLSearchParams(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
}
export async function openProtocolPeer({directory,port,clientId,redirectUris}){
 await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
 const file=join(directory,'peer-state.json'),origin='http://127.0.0.1:'+port,issuer=origin+'/';
 const registration={clientId,redirectUris:[...redirectUris].sort(),scopes:['records.read']};
 let state;
 try{state=JSON.parse(await readFile(file,'utf8'));if(JSON.stringify(state.registration)!==JSON.stringify(registration))throw Error('PEER_REGISTRATION_CHANGED');}
 catch(error){if(error.code!=='ENOENT')throw error;state={schema:'stellar-forge.oauth-native-peer.v1',registration,requests:{},codes:{},access:{},refresh:{},flags:{loseNextRefresh:false,loseNextRevocation:false},commands:{},counters:{authorizationViews:0,consents:0,codeRequests:0,codeSuccesses:0,refreshRequests:0,refreshSuccesses:0,refreshRejections:0,revocationRequests:0,revocationEffects:0,recordsRequests:0,recordsAuthorized:0,recordsUnauthorized:0}};await atomic(file,state);}
 const save=()=>atomic(file,state);let closed=false,tail=Promise.resolve();
 const serial=fn=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;};
 const json=(res,status,data,extra={})=>{const bytes=Buffer.from(JSON.stringify(data));res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','content-length':bytes.length,...extra});res.end(bytes);};
 const html=(res,status,content)=>{const bytes=Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Records authorization</title><style>body{font:16px system-ui;max-width:640px;margin:48px auto;padding:24px;color:#202124;background:#f6f7f8}main{background:white;border:1px solid #ccd0d4;padding:24px}h1{font-size:24px}button{font:inherit;padding:10px 16px;margin:8px 8px 0 0;border:1px solid #333;background:#fff}small{display:block;color:#555;margin-top:24px}code{word-break:break-all}</style><main>'+content+'</main></html>');res.writeHead(status,{'content-type':'text/html; charset=utf-8','content-length':bytes.length,'cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(bytes);};
 const oauthError=(res,status,error)=>json(res,status,{error});
 function issue(family,scopes){
  const access=id(),refresh=id(),issuedAt=Date.now();
  state.access[access]={family,scopes,expiresAt:issuedAt+3600000,active:true};
  state.refresh[refresh]={family,scopes,active:true};
  return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,refresh_token_expires_in:86400,scope:scopes.join(' ')};
 }
 function prune(){for(const [key,value]of Object.entries(state.requests))if(value.expiresAt<Date.now()-600000)delete state.requests[key];for(const [key,value]of Object.entries(state.codes))if(value.expiresAt<Date.now()-600000)delete state.codes[key];}
 async function handle(req,res){
  if(closed)return json(res,503,{error:'closed'});
  if(req.headers.host!=='127.0.0.1:'+port)return json(res,400,{error:'host'});
  const url=new URL(req.url,origin);
  if(url.pathname==='/authorize'&&req.method==='GET'){
   const q=url.searchParams,scope=(q.get('scope')??'').split(' ').filter(Boolean);
   if(q.get('response_type')!=='code'||q.get('client_id')!==clientId||!redirectUris.includes(q.get('redirect_uri'))||
      q.get('code_challenge_method')!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge')??'')||
      !/^[A-Za-z0-9_-]{16,256}$/.test(q.get('state')??'')||!scope.length||scope.some(x=>!registration.scopes.includes(x))||
      new Set(scope).size!==scope.length||q.getAll('redirect_uri').length!==1||q.getAll('state').length!==1)
      return oauthError(res,400,'invalid_request');
   let requestId;
   await serial(async()=>{prune();requestId=id();state.requests[requestId]={redirectUri:q.get('redirect_uri'),state:q.get('state'),challenge:q.get('code_challenge'),scopes:scope,expiresAt:Date.now()+600000,used:false};state.counters.authorizationViews++;await save();});
   return html(res,200,'<h1>Authorize records access</h1><p>This is the retained local protocol account for the application walkthrough.</p><p>Application: <strong>'+esc(clientId)+'</strong></p><p>Requested permission: <code>records.read</code></p><form method="post" action="/consent"><input type="hidden" name="request" value="'+esc(requestId)+'"><button name="decision" value="allow">Allow records access</button><button name="decision" value="deny">Deny access</button></form><small>Local protocol fixture. This does not connect an external customer account.</small>');
  }
  if(url.pathname==='/consent'&&req.method==='POST'){
   if(req.headers.origin!==origin)return oauthError(res,403,'invalid_request');
   const form=await body(req);let destination;
   await serial(async()=>{
    const request=state.requests[form.get('request')];
    if(!request||request.used||request.expiresAt<=Date.now()||!['allow','deny'].includes(form.get('decision')))throw Error('CONSENT_STALE');
    request.used=true;destination=new URL(request.redirectUri);destination.searchParams.set('state',request.state);destination.searchParams.set('iss',issuer);
    if(form.get('decision')==='deny')destination.searchParams.set('error','access_denied');
    else{const code=id();state.codes[code]={...request,used:false,expiresAt:Date.now()+60000};destination.searchParams.set('code',code);state.counters.consents++;}
    await save();
   });
   res.writeHead(303,{location:destination.href,'cache-control':'no-store','referrer-policy':'no-referrer'});return res.end();
  }
  if(url.pathname==='/token'&&req.method==='POST'){
   const form=await body(req);
   if(form.get('client_id')!==clientId||req.headers.authorization)return oauthError(res,401,'invalid_client');
   let response,error,lose=false;
   await serial(async()=>{
    if(form.get('grant_type')==='authorization_code'){
     state.counters.codeRequests++;const code=form.get('code'),saved=state.codes[code],verifier=form.get('code_verifier')??'';
     if(!saved||saved.used||saved.expiresAt<=Date.now()||form.get('redirect_uri')!==saved.redirectUri||
       !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||!same(createHash('sha256').update(verifier).digest('base64url'),saved.challenge))error='invalid_grant';
     else{saved.used=true;response=issue(id(),saved.scopes);state.counters.codeSuccesses++;}
    }else if(form.get('grant_type')==='refresh_token'){
     state.counters.refreshRequests++;const saved=state.refresh[form.get('refresh_token')];
     if(!saved||!saved.active){error='invalid_grant';state.counters.refreshRejections++;}
     else{saved.active=false;for(const item of Object.values(state.access))if(item.family===saved.family)item.active=false;response=issue(saved.family,saved.scopes);state.counters.refreshSuccesses++;lose=state.flags.loseNextRefresh;state.flags.loseNextRefresh=false;}
    }else error='unsupported_grant_type';
    await save();
   });
   if(lose){res.socket.destroy();return;}
   return error?oauthError(res,400,error):json(res,200,response);
  }
  if(url.pathname==='/revoke'&&req.method==='POST'){
   const form=await body(req);if(form.get('client_id')!==clientId||req.headers.authorization)return oauthError(res,401,'invalid_client');
   let lose=false;await serial(async()=>{
    state.counters.revocationRequests++;const token=form.get('token'),saved=state.refresh[token]??state.access[token];
    if(saved){for(const item of [...Object.values(state.access),...Object.values(state.refresh)])if(item.family===saved.family)item.active=false;state.counters.revocationEffects++;}
    lose=state.flags.loseNextRevocation;state.flags.loseNextRevocation=false;await save();
   });
   if(lose){res.socket.destroy();return;}res.writeHead(200,{'cache-control':'no-store','content-length':'0'});return res.end();
  }
  if(['/records','/v2/records'].includes(url.pathname)&&req.method==='GET'){
   const token=(req.headers.authorization??'').replace(/^Bearer /,'');let authorized;
   await serial(async()=>{const access=state.access[token];authorized=access?.active&&access.expiresAt>Date.now()&&access.scopes.includes('records.read');state.counters.recordsRequests++;state.counters[authorized?'recordsAuthorized':'recordsUnauthorized']++;await save();});
   if(!authorized)return json(res,401,{error:'invalid_token'},{'www-authenticate':'Bearer error="invalid_token"'});
   return json(res,200,{records},{'cache-control':'public, max-age=120','etag':'"records-v1"','vary':'accept'});
  }
  if(url.pathname==='/health'&&req.method==='GET')return json(res,200,{ok:true,protocol:'local-retained-oauth-peer'});
  return json(res,404,{error:'not_found'});
 }
 const server=createServer({maxHeaderSize:16384},(req,res)=>handle(req,res).catch(()=>{if(!res.headersSent)json(res,400,{error:'invalid_request'});else res.destroy();}));
 server.requestTimeout=30000;server.headersTimeout=15000;server.keepAliveTimeout=1000;
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});
 let closing;
 return {origin,issuer,registration,
  snapshot:()=>({schema:'stellar-forge.oauth-native-peer-status.v1',capturedAt:new Date().toISOString(),counters:{...state.counters},flags:{...state.flags},activeAccessTokens:Object.values(state.access).filter(x=>x.active).length,activeRefreshTokens:Object.values(state.refresh).filter(x=>x.active).length}),
  control:({requestId,action})=>serial(async()=>{
   if(typeof requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)||!['invalidate_access','lose_next_refresh','lose_next_revocation','clear_failures'].includes(action))throw Error('PEER_CONTROL_INVALID');
   const inputHash=hash(JSON.stringify({requestId,action})),prior=state.commands[requestId];if(prior){if(prior.inputHash!==inputHash)throw Error('PEER_CONTROL_REPLAY_CHANGED');return prior.result;}
   if(action==='invalidate_access')for(const token of Object.values(state.access))token.active=false;
   else if(action==='lose_next_refresh')state.flags.loseNextRefresh=true;
   else if(action==='lose_next_revocation')state.flags.loseNextRevocation=true;
   else state.flags={loseNextRefresh:false,loseNextRevocation:false};
   const result={requestId,action,appliedAt:new Date().toISOString()};state.commands[requestId]={inputHash,result};await save();return result;
  }),
  close:()=>closing??=(async()=>{closed=true;server.closeIdleConnections();await new Promise((yes,no)=>server.close(e=>e?no(e):yes()));await tail;})()
 };
}
