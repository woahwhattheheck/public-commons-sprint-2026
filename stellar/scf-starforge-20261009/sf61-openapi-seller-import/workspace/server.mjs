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
import { stageMerchantFileRequest, loadMerchantFileRequest, listMerchantFileRequests } from './file-requests.mjs';
import { MAX_REQUEST_BODY_BYTES } from '../../sf31-buyer-client/request-body.mjs';
import { readSellerConfig } from '../../sf30-seller-sdk/serve.mjs';
import { readUpstreamBindings } from '../../sf30-seller-sdk/upstream.mjs';
import { reviewMerchantRevision, saveMerchantRevision, stageMerchantRevision, releaseCommands,
  saveMerchantRevisionDraft, readMerchantRevisionDraft, listMerchantRevisionDrafts } from './revisions.mjs';
import { describeMerchantStreamCustomers, createMerchantStreamCustomer, readMerchantStreamCustomer,
  prepareMerchantStreamCustomer } from './stream-customer.mjs';
import { openCommerce, completeCommerceShutdown } from '../../sf66-demo-launcher/commerce.mjs';
import { startCommerceConsole } from '../../sf66-demo-launcher/commerce-console.mjs';
import { inspectPostman, preparePostmanSource } from '../postman/collection.mjs';
import { openOAuthConnectionRegistry, readOAuthHostConnections } from '../../sf30-seller-sdk/oauth-connections/host.mjs';
import { createOAuthWorkspaceAdapter } from './oauth-http.mjs';
import { openCacheWorkspace } from '../../sf30-seller-sdk/response-cache/workspace/model.mjs';
import { cacheWorkspaceApi, serveCacheWorkspaceAsset, sendCacheWorkspaceResponse } from '../../sf30-seller-sdk/response-cache/workspace/http.mjs';
import { createMigrationRoutes } from '../blockworks/routes.mjs';
import { cachePackageBinding, cachePolicyRevisionApi } from './cache-policy-revisions.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const STATIC = new Map([['/','index.html'],['/browser.mjs','browser.mjs'],['/stream-browser.mjs','stream-browser.mjs'],['/stream-customer-browser.mjs','stream-customer-browser.mjs'],['/authentication-browser.mjs','authentication-browser.mjs'],['/oauth-browser.mjs','oauth-browser.mjs'],['/oauth.css','oauth.css'],['/operation-panel.mjs','operation-panel.mjs'],['/file-input-browser.mjs','file-input-browser.mjs'],['/style.css','style.css']]);
STATIC.set('/revision-browser.mjs','revision-browser.mjs');
STATIC.set('/postman-browser.mjs','../postman/browser.mjs');
STATIC.set('/migrations','../blockworks/index.html');
STATIC.set('/migrations/','../blockworks/index.html');
STATIC.set('/migrations/browser.mjs','../blockworks/browser.mjs');
STATIC.set('/migrations/style.css','../blockworks/style.css');
STATIC.set('/migrations/comparison-view.mjs','../blockworks/comparison-view.mjs');

const MIME = {'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const HELP = 'node workspace/server.mjs --out-parent PRIVATE_DIRECTORY [--port 0] [--oauth-connections HOST_JSON] [--allow-loopback-oauth]\nCreate a private directory first (mkdir -m 700 /path/to/merchant-projects).\nOAuth host JSON carries approved aliases and directory environment references only. Explicit loopback OAuth is for local development.\nNode 22+; the console prints the local browser URL. Ctrl-C closes its managed seller.';
const limited = async req => {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) { const error = new Error('Request exceeds 10 MiB'); error.status=413; throw error; }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
async function uploadSelection(req) {
  const contentType=req.headers['content-type']??'';
  if (!/^multipart\/form-data\s*;/i.test(contentType)||contentType.length>256) throw new TypeError('Select files using the multipart request form');
  const chunks=[]; let length=0;
  for await (const chunk of req) {
    length+=chunk.length;
    if (length>MAX_REQUEST_BODY_BYTES+65536) {const error=new Error('Upload intake exceeds 16 MiB plus request metadata');error.status=413;throw error;}
    chunks.push(chunk);
  }
  const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':contentType}}).formData();
  const selections=form.getAll('@selection');
  if (selections.length!==1||typeof selections[0]!=='string'||Buffer.byteLength(selections[0])>65536) throw new TypeError('One private request selection is required');
  const selection=JSON.parse(selections[0]);
  if (!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(key=>!['runtimeId','binding','request'].includes(key))) throw new TypeError('Invalid file request selection');
  const files=[];
  for (const [field,file] of form) {
    if (field==='@selection') continue;
    if (typeof file==='string'||files.length>=128) throw new TypeError('Upload parts must be selected files');
    files.push({field,filename:file.name,contentType:file.type||'application/octet-stream',bytes:new Uint8Array(await file.arrayBuffer())});
  }
  return {...selection,files};
}
const constantEqual = (a,b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startWorkspace({ parent, port=0, noSignals=false, oauthConnections=[], env=process.env, allowLoopbackOAuth=false, oauthLookup }={}) {
  const runtimeEnv={...env};
  const output = await privateParent(parent);
  if (!Number.isInteger(port) || port<0 || port>65535) throw new TypeError('Port must be 0–65535');
  const token = randomBytes(32).toString('hex');
  let origin, active=null, customerActive=null, busy=false, shuttingDown=false, mutationDone=Promise.resolve();
  if(typeof allowLoopbackOAuth!=='boolean')throw new TypeError('Loopback OAuth must be an explicit host option');
  const registry=await openOAuthConnectionRegistry({connections:oauthConnections,env:runtimeEnv,allowLoopback:allowLoopbackOAuth,lookup:oauthLookup});
  const oauth=createOAuthWorkspaceAdapter({registry,origin:()=>origin,allowLoopback:allowLoopbackOAuth});
  let migrationPromise, migrationInstance;
  const migrations = () => migrationPromise ??= createMigrationRoutes({parent:output,origin:()=>origin,parentRuntime:view,
    env:runtimeEnv,oauthConnections,allowLoopbackOAuth,oauthLookup,validatePlan:oauth.validatePlan})
    .then(value=>(migrationInstance=value)).catch(error=>{migrationPromise=null;throw error;});

  const cacheWorkspaces=new Map(), cacheRequests=new Set();
  function operatingWorkspace(name) {
    name=packageName(name);
    if(!cacheWorkspaces.has(name)) {
      const opening=(async()=>{
        const project=await readPackage(output,name);
        if(shuttingDown)throw Object.assign(new Error('Workspace is stopping'),{status:503});
        return openCacheWorkspace({directory:join(project.folder,'cache-operations'),
          sources:[{id:'merchant',label:project.name}],request:async(_source,command)=>{
            const management=active?.name===project.name?active.session.session?.cacheManagement:null;
            if(!management)throw Object.assign(new Error('Start this saved API package to operate its response cache.'),
              {code:'CACHE_WORKSPACE_SOURCE_OFFLINE',status:409});
            const result=await management.dispatch(command);
            return command.op==='inspect'?{...result,package:cachePackageBinding(project)}:result;
          }});
      })();
      cacheWorkspaces.set(name,opening);
      opening.catch(()=>{if(cacheWorkspaces.get(name)===opening)cacheWorkspaces.delete(name);});
    }
    return cacheWorkspaces.get(name);
  }
  function cacheOperation(req,res,url,body) {
    const operation=(async()=>{
      const baseName=url.searchParams.get('name'),workspace=await operatingWorkspace(baseName);
      const operation=url.pathname.slice('/api/cache-operations/'.length);
      const request={operation,method:req.method,query:url.searchParams,body};
      return sendCacheWorkspaceResponse(res,operation.startsWith('policy-')
        ?await cachePolicyRevisionApi({...request,parent:output,baseName,workspace,validatePlan:oauth.validatePlan})
        :await cacheWorkspaceApi(workspace,request));
    })();
    cacheRequests.add(operation);operation.finally(()=>cacheRequests.delete(operation)).catch(()=>{});
    return operation;
  }
  const cacheView = () => {
    const rows = active?.session.session?.upstreamSnapshot?.().bindings ?? [];
    return rows.filter(row=>row.cachePolicy).map(row=>({binding:row.name,method:row.method,routes:row.routes,
      policy:row.cachePolicy,activity:row.cache,source:{started:row.started,inFlight:row.inFlight},availability:row.availability ?? null}));
  };
  const credentialView = () => {
    const rows = active?.session.session?.upstreamSnapshot?.().bindings ?? [];
    return rows.filter(row=>row.oauth2||row.oauthConnection).map(row=>({binding:row.name,method:row.method,routes:row.routes,
      ...(row.oauth2?{oauth2:Object.fromEntries(['state','hasToken','expiresInMs','refreshInMs','retryInMs','waiters',
        'tokenRequests','cacheHits','renewals','failures','cancellations','rotations','invalidations','lastError']
        .filter(key=>Object.hasOwn(row.oauth2,key)).map(key=>[key,row.oauth2[key]]))}:{}),
      ...(row.oauthConnection?{oauthConnection:Object.fromEntries(['state','hasToken','expiresInMs','profileSha256','grantId','generation',
        'tokenRequests','cacheHits','renewals','failures','cancellations','invalidations','lastError']
        .filter(key=>Object.hasOwn(row.oauthConnection,key)).map(key=>[key,row.oauthConnection[key]]))}:{})}));
  };
  const customerView=()=>customerActive ? {packageName:customerActive.packageName,name:customerActive.name,
    configSha256:customerActive.configSha256,operatorUrl:customerActive.console.operatorUrl,
    directory:customerActive.directory,seller:customerActive.session.seller.url} : null;
  const view = () => ({...(active ? {name:active.name, mode:active.session.mode, seller:active.session.seller,
    operations:active.session.operationsDashboard, state:'RUNNING',runtimeId:active.runtimeId,caches:cacheView(),credentials:credentialView(),
    operationBindings:active.tickets.bindings,
    ...(active.tickets.bindings.length ? {operationConsole:active.session.operations.operationControlUrl ?? active.session.operations.merchantOperationsUrl} : {}),
    ...(active.acceptance?{acceptance:active.acceptance}:{})} : {state:'STOPPED'}),customer:customerView()});
  async function closeCustomer() {
    if(!customerActive) return;
    const result=await completeCommerceShutdown(customerActive.session,customerActive.console.close());
    if(result?.drained===false) throw new Error('The original customer session is still draining its native operation');
    customerActive=null;
  }
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
      const url=new URL(req.url,origin), pathname=url.pathname;
      if ((req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) &&
          !oauth.acceptCallbackRequest(req,url)) return send(403,{error:'Use the exact local workspace origin'});
      if(req.method==='GET'&&oauth.returned(res,url))return;
      if(await oauth.callback(req,res,url))return;
      if(await serveCacheWorkspaceAsset(req,res,pathname))return;
      if (req.method==='GET' && STATIC.has(pathname)) {
        const file=STATIC.get(pathname), extension=file.slice(file.lastIndexOf('.'));
        res.writeHead(200,{'Content-Type':MIME[extension]});res.end(await readFile(join(here,file)));return;
      }
      if (!pathname.startsWith('/api/')) return send(404,{error:'Not found'});
      if (!constantEqual(req.headers['x-workspace-token'],token)) return send(401,{error:'Open the complete workspace URL printed by the launcher'});
      if (req.method==='GET') {
        if(pathname.startsWith('/api/cache-operations/'))return await cacheOperation(req,res,url);
        if(pathname==='/api/oauth/connections')return send(200,await oauth.list());
        if(pathname==='/api/oauth/connection')return send(200,await oauth.status(url.searchParams.get('alias'),url.searchParams.get('flowId')));
        if (pathname.startsWith('/api/migrations/')) return await (await migrations()).get(pathname,url,send,res);
        if (pathname==='/api/example') {
          const specText=await readFile(new URL('../../sf82-seller-pilot/examples/upstream-openapi.json',import.meta.url),'utf8');
          return send(200,{specText,plan:{schema:'stellar-forge.api-merchant-plan.v1',sellerServer:'https://merchant.example/api',
            serviceName:'Dataset example',payment:{network:'stellar:testnet',asset:'DEMO_NONPAYABLE_ASSET',payTo:'DEMO_NONPAYABLE_RECIPIENT',maxTimeoutSeconds:60},
            operations:[{method:'GET',path:'/dataset',amountAtomic:'20000',responseValidation:'declared'}],allowLoopbackUpstream:false}});
        }
        if(pathname==='/api/stream-example') return send(200,{
          specText:await readFile(new URL('./examples/streaming-openapi.json',import.meta.url),'utf8'),
          plan:JSON.parse(await readFile(new URL('./examples/streaming-plan.json',import.meta.url),'utf8'))});
        if (pathname==='/api/packages') return send(200,{packages:await list(),runtime:view(),output});
        if (pathname==='/api/status') return send(200,view());
        if (pathname==='/api/revisions/drafts') return send(200,{drafts:await listMerchantRevisionDrafts(output)});
        if (pathname==='/api/revisions/load') return send(200,await readMerchantRevisionDraft(output,url.searchParams.get('name'),{validatePlan:oauth.validatePlan}));
        if (pathname==='/api/customer/options') {
          const project=await readPackage(output,url.searchParams.get('name'));
          return send(200,{...await describeMerchantStreamCustomers(project),customer:customerView(),
            sellerPort:active?.name===project.name?Number(new URL(active.session.seller).port):0});
        }
        if (pathname==='/api/customer/load') {
          const project=await readPackage(output,url.searchParams.get('name'));
          return send(200,await readMerchantStreamCustomer(project,url.searchParams.get('customer')));
        }
        if (pathname==='/api/operations/requests') {
          const selected=active;
          if (!selected||url.searchParams.get('runtimeId')!==selected.runtimeId) return send(409,{error:'The managed runtime changed. Reopen its operation form.'});
          const requests=await listMerchantFileRequests(selected.project);
          if (active!==selected) return send(409,{error:'The managed runtime changed. Refresh retained requests.'});
          return send(200,{requests});
        }
        if (pathname==='/api/load') {
          const p=await readPackage(output,url.searchParams.get('name'));
          return send(200,{name:p.name,specText:p.specText,plan:p.plan,preview:p.manifest.preview,
            ...(p.sourceRevision?{sourceRevision:p.sourceRevision,folder:p.folder,release:releaseCommands(p.folder,p.name)}:{})});
        }
        return send(404,{error:'Not found'});
      }
      if (req.method!=='POST') return send(405,{error:'Use GET or POST'});
      if (pathname==='/api/migrations/handover/import-file') {
        if (busy) return send(409,{error:'A workspace operation is in progress'});
        busy=true; let finishMutation;
        mutationDone=new Promise(yes=>{finishMutation=yes;});
        try { return await (await migrations()).upload(req,url,send); }
        finally {busy=false;finishMutation();}
      }

      if (pathname==='/api/operations/stage') {
        if (busy) return send(409,{error:'A workspace operation is in progress'});
        busy=true; let finishMutation;
        mutationDone=new Promise(yes=>{finishMutation=yes;});
        try {
          const selection=await uploadSelection(req);
          if (!active||selection.runtimeId!==active.runtimeId) return send(409,{error:'The managed runtime changed. Reopen its operation form.'});
          return send(201,await stageMerchantFileRequest(active.project,active.service,active.upstreams,selection));
        } finally {busy=false;finishMutation();}
      }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')) return send(415,{error:'Use application/json'});
      const body=await limited(req);
      if (body===null || typeof body!=='object' || Array.isArray(body)) return send(400,{error:'Expected a JSON object'});
      if(pathname.startsWith('/api/cache-operations/')) {
        if(busy)return send(409,{error:'A workspace operation is in progress'});
        busy=true;let finishMutation;mutationDone=new Promise(yes=>{finishMutation=yes;});
        try{return await cacheOperation(req,res,url,body);}
        finally{busy=false;finishMutation();}
      }
      if (pathname==='/api/postman/inspect') return send(200,inspectPostman(body));
      if (pathname==='/api/postman/prepare') return send(200,preparePostmanSource(body));
      if (pathname==='/api/inspect') return send(200,inspectOpenApi(body.specText));
      if (pathname==='/api/preview') {await oauth.validatePlan(body.specText,body.plan);return send(200,prepareMerchant(body.specText,body.plan).preview);}
      if (pathname==='/api/oauth/binding')return send(200,await oauth.binding(body));
      if (pathname==='/api/revisions/review')return send(200,await reviewMerchantRevision({...body,parent:output,validatePlan:oauth.validatePlan}));
      if (!['/api/save','/api/start','/api/stop','/api/accept','/api/cache/invalidate','/api/operations/issue','/api/operations/download','/api/operations/load','/api/operations/handoff',
        '/api/customer/create','/api/customer/prepare','/api/customer/open','/api/customer/close','/api/oauth/command',
        '/api/revisions/draft','/api/revisions/save','/api/revisions/stage'].includes(pathname) && !pathname.startsWith('/api/migrations/')) return send(404,{error:'Not found'});
      if (busy) return send(409,{error:'A workspace operation is in progress'});
      busy=true;
      let finishMutation;
      mutationDone=new Promise(yes=>{finishMutation=yes;});
      try {
        if (pathname.startsWith('/api/migrations/')) return await (await migrations()).post(pathname,body,send);
        if ((pathname==='/api/start'||pathname==='/api/customer/open') && migrationInstance?.app.releases.owned().length)
          return send(409,{error:'This workspace owns a running migration seller. Stop it in Data migrations before starting another merchant session.'});
        if(pathname==='/api/oauth/command')return send(200,await oauth.command(body));
        if(pathname==='/api/revisions/draft')return send(201,await saveMerchantRevisionDraft({...body,parent:output,validatePlan:oauth.validatePlan}));
        if(pathname==='/api/revisions/save')return send(201,await saveMerchantRevision({...body,parent:output,validatePlan:oauth.validatePlan}));
        if(pathname==='/api/revisions/stage')return send(201,await stageMerchantRevision({...body,parent:output,validatePlan:oauth.validatePlan}));
        if (pathname==='/api/save') {
          await oauth.validatePlan(body.specText,body.plan);
          const result=await savePackage({specText:body.specText,plan:body.plan,parent:output,name:body.name});
          return send(201,{name:result.name,folder:result.folder,command:result.command,preview:result.preview});
        }
        if(pathname.startsWith('/api/customer/')) {
          const project=await readPackage(output,body.packageName);
          if(pathname!=='/api/customer/close')await oauth.validatePlan(project.specText,project.plan);
          if(pathname==='/api/customer/create')
            return send(201,await createMerchantStreamCustomer(project,body.customer));
          if(pathname==='/api/customer/close') {
            if(!customerActive||customerActive.packageName!==project.name||
              customerActive.name!==body.customerName||customerActive.configSha256!==body.configSha256)
              return send(409,{error:'Select the customer console currently owned by this workspace'});
            await closeCustomer();return send(200,view());
          }
          const customer=await prepareMerchantStreamCustomer(project,body.customerName,body.configSha256);
          if(pathname==='/api/customer/prepare') return send(200,customer);
          if(customerActive) {
            if(customerActive.packageName===project.name&&customerActive.name===customer.name&&
              customerActive.configSha256===customer.configSha256) return send(200,customerView());
            return send(409,{error:'Close the current customer console before opening another saved session'});
          }
          if(active&&active.name!==project.name) return send(409,{error:'Stop the other managed seller before opening this customer session'});
          if(active) {await active.session.close();active=null;}
          const session=await openCommerce(customer.sessionDirectory,{environment:runtimeEnv});
          let console;
          try {console=await startCommerceConsole(session,{port:0});}
          catch(error) {await completeCommerceShutdown(session,session.close());throw error;}
          if(shuttingDown) {await completeCommerceShutdown(session,console.close());return send(503,{error:'Workspace stopped during customer startup'});}
          customerActive={packageName:project.name,name:customer.name,configSha256:customer.configSha256,
            directory:customer.directory,session,console};
          return send(200,customerView());
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
        if (['/api/operations/issue','/api/operations/download','/api/operations/load','/api/operations/handoff'].includes(pathname)) {
          if (typeof body.runtimeId!=='string' || !active || body.runtimeId!==active.runtimeId)
            return send(409,{error:'The managed runtime changed. Reopen its operation form.'});
          const {runtimeId,stagedFileId,...request}=body;
          if (pathname!=='/api/operations/issue') {
            if (Object.keys(request).length!==1 || typeof request.fileId!=='string')
              return send(400,{error:'Select a ticket file issued by the current runtime'});
            if (pathname==='/api/operations/load') {
              const {preparedBody,...retained}=await loadMerchantFileRequest(active.project,active.service,request.fileId);
              return send(200,retained);
            }
            return send(200,await (pathname==='/api/operations/handoff'?readMerchantOperationHandoff:readMerchantTicket)(active.project,runtimeId,request.fileId));
          }
          let preparedBody;
          if (stagedFileId!==undefined) {
            if (Object.hasOwn(request,'request')) throw new TypeError('Select retained bytes or a new request, not both');
            const retained=await loadMerchantFileRequest(active.project,active.service,stagedFileId);
            if (retained.binding!==request.binding) throw new TypeError('Retained request belongs to another operation');
            request.request=retained.request; preparedBody=retained.preparedBody;
          }
          const document=active.tickets.issue(request,{preparedBody});
          return send(201,await saveMerchantTicket(active.project,runtimeId,document));
        }
        packageName(body.name);
        if(customerActive) return send(409,{error:'Close the managed customer console before starting a separate seller'});
        if (active) return send(409,{error:'Stop the current managed seller before starting another package'});
        const project=await readPackage(output,body.name);
        await oauth.validatePlan(project.specText,project.plan);
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
          const original=await launch(forwarded,{upstreamServe:async args=>{
            const {main}=await import('../../sf30-seller-sdk/upstream-serve.mjs');
            return main(args,{env:runtimeEnv});
          }}), nativeClose=original.close.bind(original);
          let closed;
          original.close=()=>closed??=Promise.resolve().then(nativeClose);
          return original;
        }});
        if (shuttingDown) {await session.close();return send(503,{error:'Workspace stopped during startup'});}
        let tickets, served;
        try {
          // Validate against the exact public offers of the active original
          // seller, while retaining its configured upstream binding names.
          const offers=new Map(session.session.compiled.routes.map(route=>[route.id,route.offer]));
          served={...service,routes:service.routes.map(route=>({...route,offer:offers.get(route.id)}))};
          tickets=createMerchantTicketIssuer({service:served,upstreams,control:session.session.operationControl});
        } catch(error) {await session.close();throw error;}
        active={name:body.name,project,session,runtimeId:randomUUID(),tickets,service:served,upstreams};
        return send(200,view());
      } finally {busy=false;finishMutation();}
    } catch(error) {
      if (!res.headersSent) send(error.code==='EEXIST'?409:error.status??400,{error:error.code==='EEXIST'?'That package name exists. Choose a new name or reopen the existing package.':String(error.message),
        ...(typeof error.code==='string'?{code:error.code}:{}),...(error.outcomeUnknown?{outcomeUnknown:true}:{})});
      else res.end();
    }
  });
  server.requestTimeout=30000;
  server.headersTimeout=15000;
  server.maxHeadersCount=40;
  try {await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes();});});}
  catch(error){await oauth.close();throw error;}
  origin='http://127.0.0.1:'+server.address().port;
  let closing;
  const close=()=>closing??=(async()=>{
    shuttingDown=true;
    const errors=[];
    const attempt=async action=>{try{await action();}catch(error){errors.push(error);}};
    // Observe server closure immediately while preserving each original owner's
    // drain order. One failed optional application must not skip the others.
    const closed=new Promise((yes,no)=>server.close(e=>e?no(e):yes())).catch(error=>{errors.push(error);});
    await mutationDone;
    await Promise.allSettled([...cacheRequests]);
    for(const opening of cacheWorkspaces.values()) await attempt(async()=>{
      const workspace=await opening.catch(()=>null);if(workspace)await workspace.close();
    });
    cacheWorkspaces.clear();
    const migration=migrationPromise;
    if (migration) await attempt(async()=>{await (await migration).close();});
    await attempt(closeCustomer);
    await attempt(async()=>{if (active) {await active.session.close();active=null;}});
    await attempt(()=>oauth.close());
    await closed;
    if (errors.length===1) throw errors[0];
    if (errors.length>1) throw new AggregateError(errors,'Workspace sessions did not finish stopping.');
  })();
  if (!noSignals) for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>close().catch(()=>{process.exitCode=1;}));
  return {url:origin+'/#'+token,origin,token,close,output};
}
export async function main(args=process.argv.slice(2)) {
  if (args.length===1 && args[0]==='--help') {console.log(HELP);return;}
  const options=new Map();
  for(let i=0;i<args.length;) {
    const flag=args[i++];
    if(flag==='--allow-loopback-oauth'&&!options.has(flag)){options.set(flag,true);continue;}
    if(!['--out-parent','--port','--oauth-connections'].includes(flag)||options.has(flag)||!args[i]||args[i].startsWith('--'))throw new TypeError(HELP);
    options.set(flag,args[i++]);
  }
  if(!options.has('--out-parent') || options.has('--port') && !/^\d{1,5}$/.test(options.get('--port'))) throw new TypeError(HELP);
  const oauthConnections=options.has('--oauth-connections')?await readOAuthHostConnections(resolve(options.get('--oauth-connections'))):[];
  const session=await startWorkspace({parent:resolve(options.get('--out-parent')),port:Number(options.get('--port')??0),
    oauthConnections,allowLoopbackOAuth:options.has('--allow-loopback-oauth')});
  console.log('API merchant workspace: '+session.url+'\nPrivate output: '+session.output+'\nCtrl-C closes the workspace and its managed seller.');
  return session;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(e=>{console.error(e.message);process.exitCode=1;});

