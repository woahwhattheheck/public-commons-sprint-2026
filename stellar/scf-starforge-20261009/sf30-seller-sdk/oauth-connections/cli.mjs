// MIT. Operator CLI for source-bound OAuth authorization connections.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { initializeOAuthConnection, oauthConnectionStatus, openOAuthConnection } from './connection.mjs';

const fail=message=>{throw new TypeError(message);};
const help=String.raw`Usage:
  node cli.mjs init --directory PATH --profile FILE [--allow-loopback]
  node cli.mjs status --directory PATH [--allow-loopback]
  node cli.mjs connect --directory PATH --port N --actor NAME --reference TEXT [--allow-loopback]
  node cli.mjs refresh --directory PATH --revision N --grant ID --request-id ID [--allow-loopback]
  node cli.mjs disconnect --directory PATH --revision N --grant ID --request-id ID [--revoke] [--allow-loopback]
  node cli.mjs revoke --directory PATH --revision N --request-id ID [--revocation-grant ID] [--allow-loopback]

Profile files contain public registration data. Client secrets are read only from
the profile's named environment variable. The private directory stores grants.
connect requires an interactive terminal and an explicitly registered loopback
port. It displays a browser URL, receives the exact callback, then asks you to
review and approve the returned grant. No token is printed.
--allow-loopback permits a local HTTP OAuth provider only for development.
`;
function argumentsFor(argv) {
  const [command,...rest]=argv;
  if(!command||command==='--help'||command==='help')return {command:'help'};
  const allowed={
    init:['directory','profile','allow-loopback'],status:['directory','allow-loopback'],
    connect:['directory','port','actor','reference','allow-loopback'],
    refresh:['directory','revision','grant','request-id','allow-loopback'],
    disconnect:['directory','revision','grant','request-id','revoke','allow-loopback'],
    revoke:['directory','revision','request-id','revocation-grant','allow-loopback'],
  }[command];
  if(!allowed)fail('Unknown command. Use --help.');
  const out={command};
  for(let i=0;i<rest.length;i++){
    const key=rest[i].startsWith('--')?rest[i].slice(2):'';
    if(!allowed.includes(key)||Object.hasOwn(out,key))fail('Unknown or repeated command option.');
    if(['allow-loopback','revoke'].includes(key)){out[key]=true;continue;}
    const value=rest[++i];
    if(typeof value!=='string'||!value||value.startsWith('--'))fail('An option value is missing.');
    out[key]=value;
  }
  if(!out.directory)fail('--directory is required.');
  return out;
}
const print=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
const safeCode=error=>/^OAUTH_[A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'OAUTH_CONNECTION_COMMAND_FAILED';
function revision(value){
  if(typeof value!=='string'||!/^(?:0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value)))
    fail('--revision must be the exact current nonnegative revision.');
  return Number(value);
}
const page='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authorization returned</title><body><h1>Authorization returned</h1><p>Return to the terminal to review the connection. This page contains no grant or account credentials.</p></body></html>';
async function connect(directory,args,options){
  if(!process.stdin.isTTY||!process.stdout.isTTY)fail('connect requires an interactive terminal. Use the existing merchant workspace for browser-based operation.');
  if(!/^[1-9]\d{0,4}$/.test(args.port??'')||Number(args.port)>65535)fail('--port must be the registered loopback port.');
  if(!args.actor?.trim()||!args.reference?.trim())fail('--actor and --reference are required for an attributed grant review.');
  const connection=await openOAuthConnection(directory,options), initial=await connection.status();
  const origin='http://127.0.0.1:'+Number(args.port), redirectUri=origin+initial.callbackPath;
  let flowId=null, callbackState=null, callbackBusy=false, settled=false, timer=null, resolveReturn;
  const returned=new Promise(resolve=>{resolveReturn=resolve;});
  let resolveCallback,rejectCallback;
  const callback=new Promise((resolve,reject)=>{resolveCallback=resolve;rejectCallback=reject;});
  callback.catch(()=>{});
  const server=createServer({maxHeaderSize:16384},async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');
    const reject=()=>{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found.');};
    if(req.method!=='GET'||req.headers.host!=='127.0.0.1:'+Number(args.port)||typeof req.url!=='string'||req.url.length>16384)return reject();
    let url;try{url=new URL(req.url,origin);}catch{return reject();}
    if(url.origin!==origin)return reject();
    if(url.pathname==='/oauth-return'&&!url.search){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page);resolveReturn();return;}
    if(url.pathname!==initial.callbackPath||!flowId||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==callbackState)return reject();
    if(callbackBusy){res.writeHead(409,{'Content-Type':'text/plain; charset=utf-8'});res.end('Authorization is being processed. Return to the terminal.');return;}
    callbackBusy=true;
    try{
      await connection.complete({flowId,parameters:url.searchParams});
      const next=await connection.status({flowId});
      if(!settled){settled=true;resolveCallback(next);}
    }catch(error){if(!settled){settled=true;rejectCallback(Object.assign(new Error(safeCode(error)),{code:safeCode(error)}));}}
    finally{res.writeHead(303,{Location:'/oauth-return'});res.end();callbackBusy=false;}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
  const interrupted=()=>{if(!settled){settled=true;rejectCallback(Object.assign(new Error('OAUTH_CONNECTION_ABORTED'),{code:'OAUTH_CONNECTION_ABORTED'}));}};
  let terminal;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(args.port),'127.0.0.1',resolve);});
    process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
    const started=await connection.begin({expectedRevision:initial.revision,requestId:randomUUID(),redirectUri});
    flowId=started.flowId;callbackState=new URL(started.authorizationUrl).searchParams.get('state');
    if(typeof flowId!=='string'||typeof started.authorizationUrl!=='string')fail('Invalid connection response.');
    process.stdout.write('Registered callback: '+redirectUri+'\nOpen this authorization URL in your browser:\n'+started.authorizationUrl+'\n\n');
    timer=setTimeout(()=>{if(!settled){settled=true;rejectCallback(Object.assign(new Error('OAUTH_CONNECTION_FLOW_EXPIRED'),{code:'OAUTH_CONNECTION_FLOW_EXPIRED'}));}},Math.max(1,Date.parse(started.expiresAt)-Date.now()));
    const reviewed=await callback;clearTimeout(timer);
    print(reviewed);
    if(reviewed.flow?.phase!=='review_grant')fail('Authorization did not produce a grant for review. The existing approved connection remains unchanged.');
    terminal=createInterface({input:process.stdin,output:process.stdout});
    const answer=await terminal.question('Approve this exact returned grant for the displayed source, scopes and resource origins? Type approve: ');
    if(answer.trim()!=='approve'){await connection.discard({flowId});process.stdout.write('The proposed grant was discarded.\n');return;}
    const approval={flowId,reviewId:reviewed.flow.reviewId,expectedRevision:reviewed.revision,requestId:randomUUID(),
      review:{actor:args.actor,reference:args.reference}};
    for(;;){
      try{print(await connection.approve(approval));break;}
      catch(error){
        if(safeCode(error)!=='OAUTH_CONNECTION_SAVE_UNKNOWN')throw error;
        process.stdout.write('The saved result is uncertain. Request '+approval.requestId+' remains unchanged.\n');
        const retry=await terminal.question('Retry this exact approval and recover its saved result? Type retry: ');
        if(retry.trim()!=='retry')throw error;
      }
    }
  }finally{
    clearTimeout(timer);terminal?.close();process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);
    if(settled)await Promise.race([returned,new Promise(resolve=>setTimeout(resolve,1000))]);
    await connection.close();server.closeAllConnections();await new Promise(resolve=>server.close(()=>resolve()));
  }
}
export async function main(argv=process.argv.slice(2)){
  const args=argumentsFor(argv);if(args.command==='help'){process.stdout.write(help);return;}
  const options={allowLoopback:args['allow-loopback']===true,env:process.env};
  if(args.command==='init'){
    if(!args.profile)fail('--profile is required.');
    const info=await stat(args.profile);if(!info.isFile()||info.size>65536)fail('The public profile must be a JSON file up to 64 KiB.');
    const bytes=await readFile(args.profile);if(bytes.length>65536)fail('The public profile exceeds 64 KiB.');
    const profile=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    print(await initializeOAuthConnection(args.directory,{profile,allowLoopback:options.allowLoopback}));return;
  }
  if(args.command==='status'){print(await oauthConnectionStatus(args.directory,{allowLoopback:options.allowLoopback}));return;}
  if(args.command==='connect'){await connect(args.directory,args,options);return;}
  if(!args['request-id'])fail('--request-id is required; preserve it for an unchanged retry.');
  const payload={expectedRevision:revision(args.revision),requestId:args['request-id']};
  if(args.command!=='revoke'){if(!args.grant)fail('--grant is required.');payload.expectedGrantId=args.grant;}
  if(args.command==='disconnect')payload.revoke=args.revoke===true;
  if(args.command==='revoke'&&args['revocation-grant'])payload.expectedRevocationGrantId=args['revocation-grant'];
  const connection=await openOAuthConnection(args.directory,options);
  try{print(await connection[args.command](payload));}finally{await connection.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{
    // Unknown filesystem/provider errors may contain private paths or raw text.
    const text=error instanceof TypeError?error.message:safeCode(error);
    process.stderr.write(text+'\n');process.exitCode=1;
  });
}

