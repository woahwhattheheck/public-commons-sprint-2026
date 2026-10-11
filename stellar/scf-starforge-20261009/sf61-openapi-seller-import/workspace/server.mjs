#!/usr/bin/env node
// MIT. Loopback workspace for the original SF61/SF82/SF96 merchant runtime.
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectOpenApi, prepareMerchant, savePackage, readPackage, privateParent, packageName } from './model.mjs';
import { prepareMerchantOperationDirectories } from './operation-plan.mjs';
import { createMerchantTicketIssuer, saveMerchantTicket, readMerchantTicket, readMerchantOperationHandoff } from './operation-ticket.mjs';
import { readSellerConfig } from '../../sf30-seller-sdk/serve.mjs';
import { readUpstreamBindings } from '../../sf30-seller-sdk/upstream.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const STATIC = new Map([['/','index.html'],['/browser.mjs','browser.mjs'],['/authentication-browser.mjs','authentication-browser.mjs'],['/operation-panel.mjs','operation-panel.mjs'],['/style.css','style.css']]);
const MIME = {'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const HELP = 'node workspace/server.mjs --out-parent PRIVATE_DIRECTORY [--port 0]\nCreate a private directory first (mkdir -m 700 /path/to/merchant-projects).\nNode 22+; the console prints the local browser URL. Ctrl-C closes its managed seller.';
const limited = async req => {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) { const error = new Error('Request exceeds 10 MiB'); error.status=413; throw error; }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
const constantEqual = (a,b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startWorkspace({ parent, port=0, noSignals=false }={}) {
  const output = await privateParent(parent);
  if (!Number.isInteger(port) || port<0 || port>65535) throw new TypeError('Port must be 0–65535');
  const token = randomBytes(32).toString('hex');
  let origin, active=null, busy=false, shuttingDown=false, mutationDone=Promise.resolve();
  const cacheView = () => {
    const rows = active?.session.session?.upstreamSnapshot?.().bindings ?? [];
    return rows.filter(row=>row.cachePolicy).map(row=>({binding:row.name,method:row.method,routes:row.routes,
      policy:row.cachePolicy,activity:row.cache,source:{started:row.started,inFlight:row.inFlight},availability:row.availability ?? null}));
  };
  const credentialView = () => {
    const rows = active?.session.session?.upstreamSnapshot?.().bindings ?? [];
    return rows.filter(row=>row.oauth2).map(row=>({binding:row.name,method:row.method,routes:row.routes,
      oauth2:Object.fromEntries(['state','hasToken','expiresInMs','refreshInMs','retryInMs','waiters',
        'tokenRequests','cacheHits','renewals','failures','cancellations','rotations','invalidations','lastError']
        .filter(key=>Object.hasOwn(row.oauth2,key)).map(key=>[key,row.oauth2[key]]))}));
  };
  const view = () => active ? {name:active.name, mode:active.session.mode, seller:active.session.seller,
    operations:active.session.operationsDashboard, state:'RUNNING',runtimeId:active.runtimeId,caches:cacheView(),credentials:credentialView(),
    operationBindings:active.tickets.bindings,
    ...(active.tickets.bindings.length ? {operationConsole:active.session.operations.operationControlUrl ?? active.session.operations.merchantOperationsUrl} : {}),
    ...(active.acceptance?{acceptance:active.acceptance}:{})} : {state:'STOPPED'};
  async function list() {
    const entries = (await readdir(output,{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,200);
    const values=[];
    for (const entry of entries) {
      try { const p=await readPackage(output,entry.name); values.push({name:p.name, title:p.manifest.preview.title, createdAt:p.manifest.createdAt, routes:p.manifest.preview.routes.length}); }
      catch { /* Other private folders and incomplete packages are not workspace packages. */ }
    }
    return values;
  }
  const server = createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    try {
      if (shuttingDown) return send(503,{error:'Workspace is stopping'});
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return send(403,{error:'Use the exact local workspace origin'});
      const url=new URL(req.url,origin), pathname=url.pathname;
      if (req.method==='GET' && STATIC.has(pathname)) {
        const file=STATIC.get(pathname), extension=file.slice(file.lastIndexOf('.'));
        res.writeHead(200,{'Content-Type':MIME[extension]});res.end(await readFile(join(here,file)));return;
      }
      if (!pathname.startsWith('/api/')) return send(404,{error:'Not found'});
      if (!constantEqual(req.headers['x-workspace-token'],token)) return send(401,{error:'Open the complete workspace URL printed by the launcher'});
      if (req.method==='GET') {
        if (pathname==='/api/example') {
          const specText=await readFile(new URL('../../sf82-seller-pilot/examples/upstream-openapi.json',import.meta.url),'utf8');
          return send(200,{specText,plan:{schema:'stellar-forge.api-merchant-plan.v1',sellerServer:'https://merchant.example/api',
            serviceName:'Dataset example',payment:{network:'stellar:testnet',asset:'DEMO_NONPAYABLE_ASSET',payTo:'DEMO_NONPAYABLE_RECIPIENT',maxTimeoutSeconds:60},
            operations:[{method:'GET',path:'/dataset',amountAtomic:'20000',responseValidation:'declared'}],allowLoopbackUpstream:false}});
        }
        if (pathname==='/api/packages') return send(200,{packages:await list(),runtime:view(),output});
        if (pathname==='/api/status') return send(200,view());
        if (pathname==='/api/load') {
          const p=await readPackage(output,url.searchParams.get('name'));
          return send(200,{name:p.name,specText:p.specText,plan:p.plan,preview:p.manifest.preview});
        }
        return send(404,{error:'Not found'});
      }
      if (req.method!=='POST') return send(405,{error:'Use GET or POST'});
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')) return send(415,{error:'Use application/json'});
      const body=await limited(req);
      if (body===null || typeof body!=='object' || Array.isArray(body)) return send(400,{error:'Expected a JSON object'});
      if (pathname==='/api/inspect') return send(200,inspectOpenApi(body.specText));
      if (pathname==='/api/preview') return send(200,prepareMerchant(body.specText,body.plan).preview);
      if (!['/api/save','/api/start','/api/stop','/api/accept','/api/cache/invalidate','/api/operations/issue','/api/operations/download','/api/operations/handoff'].includes(pathname)) return send(404,{error:'Not found'});
      if (busy) return send(409,{error:'A workspace operation is in progress'});
      busy=true;
      let finishMutation;
      mutationDone=new Promise(yes=>{finishMutation=yes;});
      try {
        if (pathname==='/api/save') {
          const result=await savePackage({specText:body.specText,plan:body.plan,parent:output,name:body.name});
          return send(201,{name:result.name,folder:result.folder,command:result.command,preview:result.preview});
        }
        if (pathname==='/api/stop') {
          if (active) { await active.session.close(); active=null; }
          return send(200,view());
        }
        if (pathname==='/api/accept') {
          if (!active || active.session.mode!=='CHALLENGE_ONLY') return send(409,{error:'Start this package in challenge preview to check its unpaid routes'});
          const project=await readPackage(output,active.name);
          const {run}=await import('../../sf96-seller-acceptance/audit.mjs');
          const out=join(project.folder,'support','route-check-'+randomUUID());
          const result=await run({seller:active.session.seller,out,
            ...(Object.hasOwn(project.manifest.files,'operator-cases.json')?{casesPath:join(project.folder,'operator-cases.json')}:{})});
          const report=JSON.parse(await readFile(join(out,'audit.json'),'utf8'));
          active.acceptance={...result,routes:report.routes};
          return send(200,view());
        }
        if (pathname==='/api/cache/invalidate') {
          if (Object.keys(body).some(key=>!['runtimeId','binding'].includes(key)) ||
              typeof body.runtimeId!=='string' || typeof body.binding!=='string') return send(400,{error:'Select one cached binding in the current runtime'});
          if (!active || body.runtimeId!==active.runtimeId) return send(409,{error:'The managed runtime changed. Refresh its cache status before invalidating.'});
          if (!cacheView().some(row=>row.binding===body.binding)) return send(404,{error:'This runtime has no matching cached binding'});
          active.session.session.invalidateUpstreamCache(body.binding);
          return send(200,view());
        }
        if (['/api/operations/issue','/api/operations/download','/api/operations/handoff'].includes(pathname)) {
          if (typeof body.runtimeId!=='string' || !active || body.runtimeId!==active.runtimeId)
            return send(409,{error:'The managed runtime changed. Reopen its operation form.'});
          const {runtimeId,...request}=body;
          if (pathname!=='/api/operations/issue') {
            if (Object.keys(request).length!==1 || typeof request.fileId!=='string')
              return send(400,{error:'Select a ticket file issued by the current runtime'});
            return send(200,await (pathname==='/api/operations/handoff'?readMerchantOperationHandoff:readMerchantTicket)(active.project,runtimeId,request.fileId));
          }
          const document=active.tickets.issue(request);
          return send(201,await saveMerchantTicket(active.project,runtimeId,document));
        }
        packageName(body.name);
        if (active) return send(409,{error:'Stop the current managed seller before starting another package'});
        const project=await readPackage(output,body.name);
        const [service,upstreams]=await Promise.all([
          readSellerConfig(join(project.folder,'compiled','seller-service.json')),
          readUpstreamBindings(join(project.folder,'upstreams.json')),
        ]);
        const {launch}=await import('../../sf82-seller-pilot/pilot.mjs');
        const status=await launch(['--status',join(project.folder,'compiled')]);
        if (status.state==='RUNNING') return send(409,{error:'This saved seller is already running at '+status.listener+'. Stop its existing process before starting another.'});
        await prepareMerchantOperationDirectories(upstreams);
        const args=['--ops-port','0','--support-parent',join(project.folder,'support'),'--',
          '--resume',join(project.folder,'compiled'),'--upstreams',join(project.folder,'upstreams.json'),'--port','0'];
        if (project.plan.allowLoopbackUpstream===true) args.push('--allow-loopback-upstream');
        if (body.facilitator) {
          if (typeof body.facilitator!=='string' || body.facilitator.length>2048) throw new TypeError('Enter an authorized facilitator HTTPS URL');
          const target=new URL(body.facilitator);
          if (target.protocol!=='https:' || target.username || target.password || target.search || target.hash) throw new TypeError('Facilitator requires HTTPS without credentials or query');
          args.push('--facilitator',body.facilitator);
        } else args.push('--challenge-only');
        const {start}=await import('../../sf96-seller-pilot-ops/pilot-ops.mjs');
        const {startSellerOperations}=await import('../../sf30-seller-sdk/operations/server.mjs');
        const session=await start(args,{noSignals:true,
          startSellerOperations:(seller,options)=>startSellerOperations(seller,{...options,navigationOrigin:origin,
            operationControls:Object.values(upstreams.bindings).some(binding=>binding.idempotency)}),
          launchSeller:async forwarded=>{
          const original=await launch(forwarded), nativeClose=original.close.bind(original);
          let closed;
          original.close=()=>closed??=Promise.resolve().then(nativeClose);
          return original;
        }});
        if (shuttingDown) {await session.close();return send(503,{error:'Workspace stopped during startup'});}
        let tickets;
        try {
          // Validate against the exact public offers of the active original
          // seller, while retaining its configured upstream binding names.
          const offers=new Map(session.session.compiled.routes.map(route=>[route.id,route.offer]));
          const served={...service,routes:service.routes.map(route=>({...route,offer:offers.get(route.id)}))};
          tickets=createMerchantTicketIssuer({service:served,upstreams,control:session.session.operationControl});
        } catch(error) {await session.close();throw error;}
        active={name:body.name,project,session,runtimeId:randomUUID(),tickets};
        return send(200,view());
      } finally {busy=false;finishMutation();}
    } catch(error) {
      if (!res.headersSent) send(error.code==='EEXIST'?409:error.status??400,{error:error.code==='EEXIST'?'That package name exists. Choose a new name or reopen the existing package.':String(error.message)});
      else res.end();
    }
  });
  server.requestTimeout=30000;
  server.headersTimeout=15000;
  server.maxHeadersCount=40;
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});
  origin='http://127.0.0.1:'+server.address().port;
  let closing;
  const close=()=>closing??=(async()=>{
    shuttingDown=true;
    const closed=new Promise((yes,no)=>server.close(e=>e?no(e):yes()));
    await mutationDone;
    if (active) {await active.session.close();active=null;}
    await closed;
  })();
  if (!noSignals) for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>close().catch(()=>{process.exitCode=1;}));
  return {url:origin+'/#'+token,origin,token,close,output};
}
export async function main(args=process.argv.slice(2)) {
  if (args.length===1 && args[0]==='--help') {console.log(HELP);return;}
  const options=new Map();
  for(let i=0;i<args.length;i+=2) {
    if(!['--out-parent','--port'].includes(args[i]) || options.has(args[i]) || !args[i+1] || args[i+1].startsWith('--')) throw new TypeError(HELP);
    options.set(args[i],args[i+1]);
  }
  if(!options.has('--out-parent') || options.has('--port') && !/^\d{1,5}$/.test(options.get('--port'))) throw new TypeError(HELP);
  const session=await startWorkspace({parent:resolve(options.get('--out-parent')),port:Number(options.get('--port')??0)});
  console.log('API merchant workspace: '+session.url+'\nPrivate output: '+session.output+'\nCtrl-C closes the workspace and its managed seller.');
  return session;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(e=>{console.error(e.message);process.exitCode=1;});

