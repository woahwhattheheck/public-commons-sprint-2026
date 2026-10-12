#!/usr/bin/env node
// MIT. Local developer/operator shell for the original CoCart workspace.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, dirname, join, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CartWorkspace, CartError, SOURCE} from './workspace.mjs';

const here=dirname(fileURLToPath(import.meta.url));
function args(argv) {
  const out={command:argv.shift()||'help'};
  while(argv.length){const key=argv.shift();if(!key?.startsWith('--')||!argv.length)throw new CartError('ARGUMENT_INVALID','Use --name value arguments.');out[key.slice(2)]=argv.shift();}
  return out;
}
export async function loadSDK(specifier='@cocartheadless/sdk') {
  const target=isAbsolute(specifier)?pathToFileURL(specifier).href:specifier;
  const sdk=await import(target);
  if(sdk.CoCart?.VERSION!==SOURCE.sdk.version||typeof sdk.MemoryStorage!=='function')throw new CartError('SDK_VERSION_MISMATCH','Load the original @cocartheadless/sdk 1.2.1 module.');
  return sdk;
}
const jsonFile=p=>JSON.parse(readFileSync(resolve(p),'utf8'));
export async function action(workspace,name,payload,version) {
  switch(name) {
    case 'cart.create':return workspace.createCart(payload,version);
    case 'cart.refresh':return workspace.refresh(payload.cart_id,version);
    case 'cart.mutate':return workspace.mutate(payload.cart_id,payload,version);
    case 'cart.prepare':return workspace.prepare(payload.cart_id,payload,version);
    case 'cart.apply':return workspace.apply(payload.cart_id,payload.operation_id,version);
    case 'cart.reconcile':return workspace.reconcile(payload.cart_id,payload.operation_id,payload,version);
    case 'catalog.load':return workspace.products(payload,version);
    case 'checkout.prepare':return workspace.prepareCheckout(payload.cart_id,payload,version);
    case 'woo.attach': {
      if(typeof payload.content_base64!=='string'||payload.content_base64.length>1500000)throw new CartError('HANDOFF_REQUIRED','Attach the original Woo JSON handoff.');
      return workspace.attachWooHandoff(payload.cart_id,payload.preview_id,Buffer.from(payload.content_base64,'base64'),version);
    }
    case 'transport.rebind':return workspace.rebindTransport(payload,version);
    default:throw new CartError('ACTION_UNKNOWN','The requested workspace action is not available.');
  }
}
export async function serve({workspace,port=0}) {
  const token=randomBytes(32).toString('hex');let origin;
  const server=createServer(async(req,res)=>{
    const send=(status,value,type='application/json',headers={})=>{
      const bytes=Buffer.isBuffer(value)?value:Buffer.from(type==='application/json'?JSON.stringify(value):value);
      res.writeHead(status,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",...headers});res.end(bytes);
    };
    try {
      const expectedHost=new URL(origin).host;
      if(req.headers.host!==expectedHost)throw new CartError('HOST_INVALID','Use the local URL printed by this server.',{},403);
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&url.pathname==='/api/workspace')return send(200,{workspace:workspace.view(),web_token:token});
      if(req.method==='GET'&&url.pathname==='/api/receiving')return send(200,workspace.receivingBundle(),'application/json',{'Content-Disposition':'attachment; filename="CoCart_Receiving_Workspace.json"'});
      if(req.method==='GET'&&url.pathname.startsWith('/api/objects/')) {
        const hash=url.pathname.slice('/api/objects/'.length);return send(200,workspace.readObject(hash),'application/json',{'Content-Disposition':'attachment; filename="'+hash+'.json"'});
      }
      if(req.method==='POST'&&url.pathname==='/api/action') {
        if(req.headers['x-cocart-workspace']!==token || (req.headers.origin && req.headers.origin!==origin))throw new CartError('LOCAL_ACTION_TOKEN','Refresh this local workspace before saving.',{},403);
        if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new CartError('JSON_REQUIRED','Send a JSON workspace action.');
        const chunks=[];let count=0;
        for await(const chunk of req){count+=chunk.length;if(count>2000000)throw new CartError('PAYLOAD_LIMIT','The workspace action exceeds 2 MB.',{},413);chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new CartError('JSON_INVALID','The workspace action is not valid JSON.');}
        const result=await action(workspace,body.action,body.payload||{},body.version);
        return send(200,result);
      }
      const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/app.css':['app.css','text/css; charset=utf-8']};
      if(req.method==='GET'&&files[url.pathname]){const [file,type]=files[url.pathname];return send(200,readFileSync(join(here,file)),type);}
      throw new CartError('NOT_FOUND','This local resource is unavailable.',{},404);
    }catch(e){const status=e instanceof CartError?e.status:500;send(status,e.toJSON?.()||{error:'LOCAL_OPERATION_FAILED',message:e.message});}
  });
  await new Promise((resolveStart,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolveStart);});
  origin='http://127.0.0.1:'+server.address().port;
  return {server,origin,close:()=>new Promise((yes,no)=>server.close(e=>e?no(e):yes()))};
}
export async function main(argv=process.argv.slice(2)) {
  const a=args([...argv]);
  if(a.command==='help'){
    console.log('CoCart integration workspace\n\ncreate --root DIR --profile FILE --sdk MODULE [--receiving-transport FILE]\nshow --root DIR\nact --root DIR --input FILE --sdk MODULE\nserve --root DIR --sdk MODULE [--port NUMBER]\nexport --root DIR --out FILE\nreceive --root DIR --input FILE [--sdk MODULE]\n\nThe act input is {action,payload,version}; version is the saved workspace hash.\nUse the original merchant mapping and original Woo checkout handoff.');return;
  }
  if(!a.root)throw new CartError('ROOT_REQUIRED','Select the original workspace directory with --root.');
  if(a['receiving-transport']&&a.command!=='create')throw new CartError('RECEIVING_TRANSPORT_CREATE_ONLY','Select the receiving transport when creating the workspace; rebind an existing local receiver through its retained action.');
  const offline=['show','export','receive'].includes(a.command),sdk=offline?{}:await loadSDK(a.sdk);
  if(a.command==='receive') {
    if(!a.input)throw new CartError('INPUT_REQUIRED','Select the original receiving export.');
    const w=CartWorkspace.receive({root:a.root,bytes:readFileSync(resolve(a.input)),...sdk});
    console.log(JSON.stringify({workspace:w.view(),received:true},null,2));return;
  }
  const w=new CartWorkspace({root:a.root,create:a.command==='create',profile:a.profile?jsonFile(a.profile):null,profileBytes:a.profile?readFileSync(resolve(a.profile)):null,receivingTransport:a['receiving-transport']?jsonFile(a['receiving-transport']):null,...sdk});
  if(a.command==='create'||a.command==='show')return console.log(JSON.stringify({workspace:w.view()},null,2));
  if(a.command==='act') {
    if(!a.input)throw new CartError('INPUT_REQUIRED','Select the original action JSON.');
    const input=jsonFile(a.input);return console.log(JSON.stringify(await action(w,input.action,input.payload||{},input.version),null,2));
  }
  if(a.command==='export') {
    if(!a.out)throw new CartError('OUTPUT_REQUIRED','Choose a new receiving export path.');
    const path=resolve(a.out);if(existsSync(path))throw new CartError('OUTPUT_EXISTS','Keep the existing export and choose a new filename.');
    const bytes=w.receivingBundle();writeFileSync(path,bytes,{flag:'wx',mode:0o600});return console.log(JSON.stringify({path,bytes:bytes.length,workspace_version:w.read().version}));
  }
  if(a.command==='serve'){
    const port=a.port===undefined?0:Number(a.port);if(!Number.isInteger(port)||port<0||port>65535)throw new CartError('PORT_INVALID','Use a valid local port.');
    const running=await serve({workspace:w,port});console.log(JSON.stringify({url:running.origin,root:resolve(a.root),source:SOURCE}));
    let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await running.close();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
  }
  throw new CartError('COMMAND_UNKNOWN','Use create, show, act, serve, export or receive.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify(e.toJSON?.()||{error:e.name,message:e.message}));process.exitCode=1;});
